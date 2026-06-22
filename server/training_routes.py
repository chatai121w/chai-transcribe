"""
Training routes — wires LoRA fine-tuning into the local Flask server.

Endpoints (all under the main Flask app):
    POST /training/start          → spawn a training subprocess from a manifest
    GET  /training/status/<id>    → live progress (read from progress.json)
    POST /training/cancel/<id>    → terminate a running job
    GET  /training/jobs           → list known jobs (local on-disk)
    POST /training/upload-pair    → upload one (audio + text) pair to the dataset
    POST /training/dataset/finalize  → write manifest.jsonl from staged pairs
    GET  /training/checkpoints    → list completed adapters / CT2 models
    POST /training/set-active-model  → tell the server to use a custom CT2 model

State on disk:
    server/lora_runs/                 # base dir for everything
        datasets/<dataset_id>/
            audio/<n>.wav
            texts/<n>.txt
            manifest.jsonl
        jobs/<job_id>/
            progress.json
            adapter/                  # PEFT adapter (after training)
            ct2/                      # CTranslate2 model (if merged+converted)
            stdout.log
        active_model.json             # {"ct2_path": "..."} — picked up by transcribe_server
"""

import json
import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from flask import jsonify, request, send_file


BASE_DIR = Path(__file__).resolve().parent / "lora_runs"
DATASETS_DIR = BASE_DIR / "datasets"
JOBS_DIR = BASE_DIR / "jobs"
ACTIVE_MODEL_FILE = BASE_DIR / "active_model.json"
for _d in (BASE_DIR, DATASETS_DIR, JOBS_DIR):
    _d.mkdir(parents=True, exist_ok=True)


# job_id → {"proc": Popen, "started": ts, "manifest": path, "args": {...}}
_running_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


# ─────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────

def _read_progress(job_id: str) -> dict:
    path = JOBS_DIR / job_id / "progress.json"
    if not path.is_file():
        return {"status": "unknown", "progress": 0, "log_tail": ""}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return {"status": "error", "error": f"progress parse: {e}"}


def _safe_id(s: str) -> str:
    keep = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
    return "".join(c for c in s if c in keep)[:80] or uuid.uuid4().hex[:12]


# ─────────────────────────────────────────────────────────────────────
#  Route registration — call from transcribe_server.py
# ─────────────────────────────────────────────────────────────────────

def register_training_routes(app):
    # ── Dataset staging ───────────────────────────────────────────────

    @app.route("/training/dataset/new", methods=["POST"])
    def dataset_new():
        body = request.get_json(silent=True) or {}
        name = _safe_id(body.get("name") or f"ds_{int(time.time())}")
        ds_dir = DATASETS_DIR / name
        (ds_dir / "audio").mkdir(parents=True, exist_ok=True)
        (ds_dir / "texts").mkdir(parents=True, exist_ok=True)
        return jsonify({"dataset_id": name, "path": str(ds_dir)})

    @app.route("/training/dataset/upload-pair", methods=["POST"])
    def dataset_upload_pair():
        ds_id = _safe_id(request.form.get("dataset_id") or "")
        if not ds_id:
            return jsonify({"error": "dataset_id required"}), 400
        text = (request.form.get("text") or "").strip()
        if not text:
            return jsonify({"error": "text required"}), 400
        audio = request.files.get("audio")
        if audio is None:
            return jsonify({"error": "audio file required"}), 400
        ds_dir = DATASETS_DIR / ds_id
        if not ds_dir.is_dir():
            return jsonify({"error": "unknown dataset"}), 404
        idx = len(list((ds_dir / "audio").glob("*"))) + 1
        suffix = Path(audio.filename or "clip.wav").suffix.lower() or ".wav"
        if suffix not in {".wav", ".mp3", ".m4a", ".webm", ".ogg", ".flac", ".mp4"}:
            suffix = ".wav"
        audio_path = ds_dir / "audio" / f"{idx:05d}{suffix}"
        text_path = ds_dir / "texts" / f"{idx:05d}.txt"
        audio.save(str(audio_path))
        text_path.write_text(text, encoding="utf-8")
        return jsonify({"index": idx, "audio": str(audio_path), "text": str(text_path)})

    @app.route("/training/dataset/<ds_id>/stats", methods=["GET"])
    def dataset_stats(ds_id):
        ds_id = _safe_id(ds_id)
        ds_dir = DATASETS_DIR / ds_id
        if not ds_dir.is_dir():
            return jsonify({"error": "not found"}), 404
        audio_files = sorted((ds_dir / "audio").glob("*"))
        return jsonify({
            "dataset_id": ds_id,
            "path": str(ds_dir),
            "count": len(audio_files),
            "samples": [p.name for p in audio_files[:20]],
        })

    @app.route("/training/dataset/<ds_id>/finalize", methods=["POST"])
    def dataset_finalize(ds_id):
        ds_id = _safe_id(ds_id)
        ds_dir = DATASETS_DIR / ds_id
        if not ds_dir.is_dir():
            return jsonify({"error": "not found"}), 404
        manifest = ds_dir / "manifest.jsonl"
        rows = 0
        with open(manifest, "w", encoding="utf-8") as f:
            for audio_path in sorted((ds_dir / "audio").glob("*")):
                stem = audio_path.stem
                text_path = ds_dir / "texts" / f"{stem}.txt"
                if not text_path.is_file():
                    continue
                text = text_path.read_text(encoding="utf-8").strip()
                if not text:
                    continue
                f.write(json.dumps({"audio": str(audio_path.resolve()), "text": text}, ensure_ascii=False) + "\n")
                rows += 1
        return jsonify({"manifest": str(manifest), "rows": rows})

    @app.route("/training/datasets", methods=["GET"])
    def list_datasets():
        out = []
        for d in sorted(DATASETS_DIR.iterdir()):
            if not d.is_dir():
                continue
            out.append({
                "dataset_id": d.name,
                "count": len(list((d / "audio").glob("*"))) if (d / "audio").is_dir() else 0,
                "has_manifest": (d / "manifest.jsonl").is_file(),
            })
        return jsonify({"datasets": out})

    # ── Job control ───────────────────────────────────────────────────

    @app.route("/training/start", methods=["POST"])
    def training_start():
        body = request.get_json(silent=True) or {}
        manifest = body.get("manifest")
        dataset_id = body.get("dataset_id")
        if not manifest and dataset_id:
            ds_dir = DATASETS_DIR / _safe_id(dataset_id)
            manifest_path = ds_dir / "manifest.jsonl"
            # Auto-finalize if dataset dir exists but manifest hasn't been written yet
            if not manifest_path.is_file() and (ds_dir / "audio").is_dir():
                rows = 0
                with open(manifest_path, "w", encoding="utf-8") as mf:
                    for audio_path in sorted((ds_dir / "audio").glob("*")):
                        stem = audio_path.stem
                        text_path = ds_dir / "texts" / f"{stem}.txt"
                        if not text_path.is_file():
                            continue
                        text = text_path.read_text(encoding="utf-8").strip()
                        if not text:
                            continue
                        mf.write(json.dumps({"audio": str(audio_path.resolve()), "text": text}, ensure_ascii=False) + "\n")
                        rows += 1
                if rows == 0:
                    return jsonify({"error": "dataset is empty — upload audio+text pairs first"}), 400
            manifest = str(manifest_path)
        if not manifest or not Path(manifest).is_file():
            return jsonify({"error": "manifest not found (provide 'manifest' or 'dataset_id' first)"}), 400

        job_id = _safe_id(body.get("job_name") or f"lora_{int(time.time())}")
        job_dir = JOBS_DIR / job_id
        if job_dir.exists() and (job_dir / "progress.json").is_file():
            cur = _read_progress(job_id)
            if cur.get("status") in ("training", "preparing", "merging", "converting"):
                # Only block if the process is actually alive
                with _jobs_lock:
                    entry = _running_jobs.get(job_id)
                proc_alive = entry is not None and entry["proc"].poll() is None
                if proc_alive:
                    return jsonify({"error": f"job '{job_id}' is already running"}), 409
                # Process died but progress.json wasn't updated — mark as failed and allow restart
                cur["status"] = "failed"
                cur["error"] = cur.get("error") or "trainer process exited unexpectedly"
                (job_dir / "progress.json").write_text(
                    json.dumps(cur, ensure_ascii=False, indent=2), encoding="utf-8"
                )
        job_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            sys.executable, str(Path(__file__).resolve().parent / "train_lora.py"),
            "--dataset", str(manifest),
            "--base-model", body.get("base_model") or "ivrit-ai/whisper-large-v3",
            "--job-name", job_id,
            "--output-dir", str(JOBS_DIR),
            "--epochs", str(int(body.get("epochs") or 3)),
            "--batch-size", str(int(body.get("batch_size") or 8)),
            "--lr", str(float(body.get("lr") or 1e-4)),
            "--lora-r", str(int(body.get("lora_r") or 32)),
            "--lora-alpha", str(int(body.get("lora_alpha") or 64)),
            "--lora-dropout", str(float(body.get("lora_dropout") or 0.05)),
        ]
        if body.get("merge_and_convert"):
            cmd.append("--merge-and-convert")
        if body.get("max_samples"):
            cmd.extend(["--max-samples", str(int(body["max_samples"]))])

        log_path = job_dir / "stdout.log"
        log_f = open(log_path, "ab")
        env = os.environ.copy()
        env.setdefault("PYTHONUNBUFFERED", "1")
        env["PYTHONIOENCODING"] = "utf-8"
        try:
            proc = subprocess.Popen(cmd, stdout=log_f, stderr=subprocess.STDOUT, env=env)
        except Exception as e:
            log_f.close()
            return jsonify({"error": f"failed to spawn trainer: {e}"}), 500

        with _jobs_lock:
            _running_jobs[job_id] = {"proc": proc, "started": time.time(), "cmd": cmd}

        # Seed progress.json so the UI can poll immediately
        (job_dir / "progress.json").write_text(
            json.dumps({"status": "preparing", "progress": 0, "log_tail": f"Launching trainer pid={proc.pid}"},
                       ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return jsonify({"job_id": job_id, "pid": proc.pid, "log": str(log_path)})

    @app.route("/training/status/<job_id>", methods=["GET"])
    def training_status(job_id):
        job_id = _safe_id(job_id)
        state = _read_progress(job_id)
        # Reflect process liveness
        with _jobs_lock:
            entry = _running_jobs.get(job_id)
        if entry is not None:
            proc = entry["proc"]
            rc = proc.poll()
            if rc is not None and state.get("status") not in ("done", "failed", "cancelled"):
                state["status"] = "failed" if rc != 0 else "done"
                state["error"] = state.get("error") or (f"trainer exited with code {rc}" if rc else None)
                # Write back so subsequent polls see the terminal state.
                try:
                    (JOBS_DIR / job_id / "progress.json").write_text(
                        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
                    )
                except Exception:
                    pass
        return jsonify(state)

    @app.route("/training/cancel/<job_id>", methods=["POST"])
    def training_cancel(job_id):
        job_id = _safe_id(job_id)
        with _jobs_lock:
            entry = _running_jobs.get(job_id)
        if entry is None:
            return jsonify({"error": "no such running job"}), 404
        try:
            entry["proc"].terminate()
            time.sleep(0.5)
            if entry["proc"].poll() is None:
                entry["proc"].kill()
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        state = _read_progress(job_id)
        state["status"] = "cancelled"
        (JOBS_DIR / job_id / "progress.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        return jsonify({"ok": True})

    @app.route("/training/jobs", methods=["GET"])
    def training_list_jobs():
        out = []
        for d in sorted(JOBS_DIR.iterdir(), reverse=True):
            if not d.is_dir():
                continue
            prog = _read_progress(d.name)
            out.append({
                "job_id": d.name,
                "status": prog.get("status"),
                "progress": prog.get("progress"),
                "wer_before": prog.get("wer_before"),
                "wer_after": prog.get("wer_after"),
                "adapter_path": prog.get("adapter_path") or (str(d / "adapter") if (d / "adapter").is_dir() else None),
                "ct2_model_path": prog.get("ct2_model_path") or (str(d / "ct2") if (d / "ct2").is_dir() else None),
                "updated_at": prog.get("updated_at"),
            })
        return jsonify({"jobs": out})

    @app.route("/training/log/<job_id>", methods=["GET"])
    def training_log(job_id):
        job_id = _safe_id(job_id)
        path = JOBS_DIR / job_id / "stdout.log"
        if not path.is_file():
            return jsonify({"error": "no log"}), 404
        return send_file(str(path), mimetype="text/plain")

    # ── Active model (point faster-whisper at a trained CT2) ──────────

    @app.route("/training/set-active-model", methods=["POST"])
    def set_active_model():
        body = request.get_json(silent=True) or {}
        ct2 = body.get("ct2_path")
        if ct2 == "" or ct2 is None:
            if ACTIVE_MODEL_FILE.is_file():
                ACTIVE_MODEL_FILE.unlink()
            return jsonify({"ok": True, "active": None})
        if not Path(ct2).is_dir():
            return jsonify({"error": f"ct2_path not a directory: {ct2}"}), 400
        ACTIVE_MODEL_FILE.write_text(json.dumps({"ct2_path": ct2}, ensure_ascii=False), encoding="utf-8")
        return jsonify({"ok": True, "active": ct2})

    @app.route("/training/active-model", methods=["GET"])
    def get_active_model():
        if not ACTIVE_MODEL_FILE.is_file():
            return jsonify({"active": None})
        try:
            return jsonify(json.loads(ACTIVE_MODEL_FILE.read_text(encoding="utf-8")))
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return app


def get_active_ct2_path() -> Optional[str]:
    """Called by transcribe_server.load_model() to override the base model
    when the user has activated a fine-tuned CT2 build."""
    try:
        if ACTIVE_MODEL_FILE.is_file():
            data = json.loads(ACTIVE_MODEL_FILE.read_text(encoding="utf-8"))
            p = data.get("ct2_path")
            if p and Path(p).is_dir():
                return p
    except Exception:
        pass
    return None

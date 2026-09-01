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
import hashlib
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
TRAINED_MODELS_FILE = BASE_DIR / "trained_models.json"
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


def _audio_duration(path: Path) -> Optional[float]:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=15, check=True,
        )
        return float(json.loads(result.stdout)["format"]["duration"])
    except Exception:
        return None


def _evaluation_fingerprint(rows: list[dict]) -> str:
    """Stable identity for the exact holdout rows used by an experiment."""
    canonical = [
        {
            "audio_sha256": row.get("audio_sha256") or hashlib.sha256(Path(row["audio"]).read_bytes()).hexdigest(),
            "text": row["text"],
            "group_id": row.get("group_id") or row.get("metadata", {}).get("groupId") or "",
        }
        for row in rows
    ]
    canonical.sort(key=lambda row: (row["group_id"], row["audio_sha256"], row["text"]))
    payload = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _model_quality_gate(progress: dict) -> tuple[bool, list[str]]:
    """Reject models with missing, incomparable, or regressing holdout results."""
    reasons = []
    required = ("wer_before", "wer_after", "cer_before", "cer_after")
    if any(progress.get(key) is None for key in required):
        reasons.append("missing WER/CER holdout metrics")
        return False, reasons
    if not progress.get("eval_fingerprint") or not progress.get("eval_sample_count"):
        reasons.append("evaluation set identity is missing")
    if progress["wer_after"] > progress["wer_before"]:
        reasons.append("holdout WER regressed")
    if progress["cer_after"] > progress["cer_before"]:
        reasons.append("holdout CER regressed")
    if progress.get("eval_term_count", 0) > 0:
        if progress.get("term_recall_before") is None or progress.get("term_recall_after") is None:
            reasons.append("terminology recall is missing")
        elif progress["term_recall_after"] < progress["term_recall_before"]:
            reasons.append("holdout terminology recall regressed")
    if progress["wer_after"] == progress["wer_before"] and progress["cer_after"] == progress["cer_before"]:
        reasons.append("model did not improve WER or CER")
    return not reasons, reasons


def _recording_group_id(metadata: dict) -> str:
    """Return the canonical full-recording identity used for leakage-safe splits."""
    return str(
        metadata.get("sourceRecordingId")
        or metadata.get("source_recording_id")
        or metadata.get("groupId")
        or metadata.get("group_id")
        or ""
    ).strip()


def _finalize_dataset(ds_dir: Path) -> dict:
    rows = []
    total_duration = 0.0
    for audio_path in sorted((ds_dir / "audio").glob("*")):
        text_path = ds_dir / "texts" / f"{audio_path.stem}.txt"
        if not text_path.is_file():
            continue
        text = text_path.read_text(encoding="utf-8").strip()
        if not text:
            continue
        duration = _audio_duration(audio_path)
        if duration:
            total_duration += duration
        metadata_path = ds_dir / "metadata" / f"{audio_path.stem}.json"
        metadata = {}
        if metadata_path.is_file():
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            except Exception:
                metadata = {}
        group_id = _recording_group_id(metadata)
        rows.append({
            "audio": str(audio_path.resolve()), "text": text, "duration": duration,
            "audio_sha256": hashlib.sha256(audio_path.read_bytes()).hexdigest(),
            "group_id": group_id, "metadata": metadata,
        })

    rows.sort(key=lambda row: hashlib.sha256(f'{row["group_id"]}|{row["audio"]}|{row["text"]}'.encode()).hexdigest())
    groups = {}
    for row in rows:
        if row["group_id"]:
            groups.setdefault(row["group_id"], []).append(row)
    reserved_groups = {
        row["group_id"]
        for row in rows
        if row["group_id"] and str(row["metadata"].get("benchmarkRole") or "").strip()
    }
    fixed_eval_groups = {
        row["group_id"]
        for row in rows
        if row["group_id"] and row["metadata"].get("benchmarkRole") == "failure-holdout"
    }
    # Prefer smaller recordings for holdout so most approved audio remains
    # available for training while every recording stays entirely in one split.
    trainable_groups = {key: value for key, value in groups.items() if key not in reserved_groups}
    ordered_groups = sorted(
        trainable_groups.items(),
        key=lambda item: (len(item[1]), hashlib.sha256(item[0].encode()).hexdigest()),
    )
    eval_rows = [row for row in rows if row["group_id"] in fixed_eval_groups]
    if not eval_rows and len(rows) >= 10 and len(ordered_groups) >= 2:
        target_eval_count = max(1, round(len(rows) * 0.15))
        for _, group_rows in ordered_groups[:-1]:
            eval_rows.extend(group_rows)
            if len(eval_rows) >= target_eval_count:
                break
    eval_audio = {row["audio"] for row in eval_rows}
    train_rows = [
        row for row in rows
        if row["audio"] not in eval_audio and row["group_id"] not in reserved_groups
    ]
    eval_count = len(eval_rows)
    quality_counts = {"gold": 0, "silver": 0, "bronze": 0, "unknown": 0}
    label_source_counts = {}
    for row in rows:
        tier = str(row["metadata"].get("qualityTier") or row["metadata"].get("quality_tier") or "unknown").lower()
        quality_counts[tier if tier in quality_counts else "unknown"] += 1
        source = str(row["metadata"].get("labelSource") or row["metadata"].get("label_source") or "unknown")
        label_source_counts[source] = label_source_counts.get(source, 0) + 1

    def write_manifest(name: str, values: list[dict]):
        path = ds_dir / name
        with path.open("w", encoding="utf-8") as handle:
            for row in values:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        return path

    manifest = write_manifest("manifest.jsonl", rows)
    write_manifest("manifest.train.jsonl", train_rows)
    eval_path = ds_dir / "manifest.eval.jsonl"
    if eval_rows:
        write_manifest(eval_path.name, eval_rows)
    elif eval_path.exists():
        eval_path.unlink()
    warnings = []
    unknown_group_count = sum(1 for row in rows if not row["group_id"])
    if len(rows) < 20:
        warnings.append("At least 20 approved clips are required for a real training run")
    if unknown_group_count:
        warnings.append(
            f"{unknown_group_count} legacy clips have no source recording identity; "
            "recover or review their provenance before training"
        )
    if not eval_rows:
        warnings.append("At least 10 clips from 2 different recordings are required for a leakage-safe holdout split")
    if reserved_groups:
        warnings.append(f"{len(reserved_groups)} frozen benchmark recording groups are excluded from training")
    meta = {
        "count": len(rows), "train_count": len(train_rows),
        "eval_count": eval_count, "recording_groups": len(groups), "duration_seconds": round(total_duration, 2),
        "eval_fingerprint": _evaluation_fingerprint(eval_rows) if eval_rows else None,
        "quality_counts": quality_counts, "label_source_counts": label_source_counts,
        "unknown_group_count": unknown_group_count,
        "reserved_benchmark_groups": len(reserved_groups),
        "ready_for_training": (len(train_rows) + len(eval_rows)) >= 20 and bool(eval_rows) and unknown_group_count == 0,
        "warnings": warnings,
    }
    (ds_dir / "dataset_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"manifest": str(manifest), "rows": len(rows), **meta}


def resolve_trained_model(model_id: str) -> Optional[str]:
    if not model_id.startswith("lora:") or not TRAINED_MODELS_FILE.is_file():
        return None
    try:
        for item in json.loads(TRAINED_MODELS_FILE.read_text(encoding="utf-8")):
            quality_passed, _ = _model_quality_gate(item)
            if item.get("model_id") == model_id and quality_passed and Path(item.get("ct2_path", "")).is_dir():
                return item["ct2_path"]
    except Exception:
        pass
    return None


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
        ds_id = _safe_id(request.form.get("dataset_id") or "approved-ground-truth")
        text = (request.form.get("text") or "").strip()
        if not text:
            return jsonify({"error": "text required"}), 400
        audio = request.files.get("audio")
        if audio is None:
            return jsonify({"error": "audio file required"}), 400
        ds_dir = DATASETS_DIR / ds_id
        if not ds_dir.is_dir():
            return jsonify({"error": "unknown dataset"}), 404
        raw_metadata = request.form.get("metadata")
        try:
            metadata = json.loads(raw_metadata) if raw_metadata else {}
            if not isinstance(metadata, dict):
                raise ValueError("metadata is not an object")
        except (TypeError, ValueError, json.JSONDecodeError):
            return jsonify({"error": "metadata must be a valid JSON object"}), 400
        if not _recording_group_id(metadata):
            return jsonify({
                "error": "metadata.sourceRecordingId or metadata.groupId is required "
                         "so clips from one recording cannot leak across train and evaluation"
            }), 400
        idx = len(list((ds_dir / "audio").glob("*"))) + 1
        suffix = Path(audio.filename or "clip.wav").suffix.lower() or ".wav"
        if suffix not in {".wav", ".mp3", ".m4a", ".webm", ".ogg", ".flac", ".mp4"}:
            suffix = ".wav"
        audio_path = ds_dir / "audio" / f"{idx:05d}{suffix}"
        text_path = ds_dir / "texts" / f"{idx:05d}.txt"
        metadata_path = ds_dir / "metadata" / f"{idx:05d}.json"
        audio.save(str(audio_path))
        duration = _audio_duration(audio_path)
        if duration is None or duration < 0.25 or duration > 35:
            audio_path.unlink(missing_ok=True)
            return jsonify({"error": "audio must be readable and between 0.25 and 35 seconds"}), 400
        digest = hashlib.sha256(audio_path.read_bytes()).hexdigest()
        for existing in (ds_dir / "audio").glob("*"):
            if existing != audio_path and hashlib.sha256(existing.read_bytes()).hexdigest() == digest:
                audio_path.unlink(missing_ok=True)
                return jsonify({"error": "this audio clip is already in the dataset"}), 409
        text_path.write_text(text, encoding="utf-8")
        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        stats = _finalize_dataset(ds_dir)
        return jsonify({"index": idx, "audio": str(audio_path), "text": str(text_path), "duration": duration, **stats})

    @app.route("/training/dataset/approved-pair", methods=["POST"])
    def dataset_approved_pair():
        ds_id = _safe_id(request.form.get("dataset_id") or "approved-ground-truth")
        ds_dir = DATASETS_DIR / ds_id
        (ds_dir / "audio").mkdir(parents=True, exist_ok=True)
        (ds_dir / "texts").mkdir(parents=True, exist_ok=True)
        return dataset_upload_pair()

    @app.route("/training/dataset/<ds_id>/stats", methods=["GET"])
    def dataset_stats(ds_id):
        ds_id = _safe_id(ds_id)
        ds_dir = DATASETS_DIR / ds_id
        if not ds_dir.is_dir():
            return jsonify({"error": "not found"}), 404
        audio_files = sorted((ds_dir / "audio").glob("*"))
        stats = _finalize_dataset(ds_dir)
        return jsonify({
            "dataset_id": ds_id,
            "path": str(ds_dir),
            "count": len(audio_files),
            "samples": [p.name for p in audio_files[:20]], **stats,
        })

    @app.route("/training/dataset/<ds_id>/finalize", methods=["POST"])
    def dataset_finalize(ds_id):
        ds_id = _safe_id(ds_id)
        ds_dir = DATASETS_DIR / ds_id
        if not ds_dir.is_dir():
            return jsonify({"error": "not found"}), 404
        return jsonify(_finalize_dataset(ds_dir))

    @app.route("/training/datasets", methods=["GET"])
    def list_datasets():
        out = []
        for d in sorted(DATASETS_DIR.iterdir()):
            if not d.is_dir():
                continue
            stats = _finalize_dataset(d)
            out.append({
                "dataset_id": d.name,
                "count": len(list((d / "audio").glob("*"))) if (d / "audio").is_dir() else 0,
                "has_manifest": (d / "manifest.jsonl").is_file(), **stats,
            })
        return jsonify({"datasets": out})

    # ── Job control ───────────────────────────────────────────────────

    @app.route("/training/start", methods=["POST"])
    def training_start():
        body = request.get_json(silent=True) or {}
        smoke_test = bool(body.get("smoke_test"))
        manifest = body.get("manifest")
        dataset_id = body.get("dataset_id")
        eval_manifest = None
        count_manifest = manifest
        if not manifest and dataset_id:
            ds_dir = DATASETS_DIR / _safe_id(dataset_id)
            manifest_path = ds_dir / "manifest.train.jsonl"
            if not (ds_dir / "audio").is_dir():
                return jsonify({"error": "dataset not found"}), 404
            stats = _finalize_dataset(ds_dir)
            if not stats["rows"]:
                return jsonify({"error": "dataset is empty — upload audio+text pairs first"}), 400
            if not smoke_test and not stats["ready_for_training"]:
                return jsonify({"error": "; ".join(stats["warnings"])}), 400
            manifest = str(manifest_path)
            count_manifest = str(ds_dir / "manifest.jsonl")
            eval_path = ds_dir / "manifest.eval.jsonl"
            if eval_path.is_file():
                eval_manifest = str(eval_path)
        if not manifest or not Path(manifest).is_file():
            return jsonify({"error": "manifest not found (provide 'manifest' or 'dataset_id' first)"}), 400
        row_count_path = Path(count_manifest or manifest)
        row_count = sum(1 for line in row_count_path.read_text(encoding="utf-8").splitlines() if line.strip())
        if row_count < 20 and not smoke_test:
            return jsonify({"error": f"real training requires at least 20 approved clips; found {row_count}. Use smoke_test only to verify the pipeline."}), 400
        if dataset_id and not eval_manifest and not smoke_test:
            return jsonify({"error": "real training requires approved clips from at least 2 different recordings for a leakage-safe evaluation set"}), 400

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
            "--eval-split", "0" if smoke_test else str(float(body.get("eval_split") or 0.15)),
        ]
        if eval_manifest and not smoke_test:
            cmd.extend(["--eval-dataset", eval_manifest, "--eval-split", "0"])
        if body.get("merge_and_convert"):
            cmd.append("--merge-and-convert")
        if body.get("max_samples"):
            cmd.extend(["--max-samples", str(int(body["max_samples"]))])
        elif smoke_test:
            cmd.extend(["--max-samples", "1"])

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
        return jsonify({"job_id": job_id, "pid": proc.pid, "log": str(log_path), "smoke_test": smoke_test})

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
                "cer_before": prog.get("cer_before"),
                "cer_after": prog.get("cer_after"),
                "eval_sample_count": prog.get("eval_sample_count"),
                "eval_fingerprint": prog.get("eval_fingerprint"),
                "quality_gate": _model_quality_gate(prog)[0],
                "quality_gate_reasons": _model_quality_gate(prog)[1],
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
        job_id = _safe_id(body.get("job_id") or Path(ct2).parent.name)
        progress = _read_progress(job_id)
        quality_passed, quality_reasons = _model_quality_gate(progress)
        if not quality_passed and not body.get("force"):
            return jsonify({
                "error": "model failed the holdout quality gate",
                "reasons": quality_reasons,
            }), 400
        models = []
        if TRAINED_MODELS_FILE.is_file():
            models = json.loads(TRAINED_MODELS_FILE.read_text(encoding="utf-8"))
        model_id = f"lora:{job_id}"
        models = [m for m in models if m.get("model_id") != model_id]
        models.append({
            "model_id": model_id,
            "ct2_path": str(Path(ct2).resolve()),
            "wer_before": progress["wer_before"], "wer_after": progress["wer_after"],
            "cer_before": progress["cer_before"], "cer_after": progress["cer_after"],
            "eval_sample_count": progress.get("eval_sample_count"),
            "eval_fingerprint": progress.get("eval_fingerprint"),
        })
        TRAINED_MODELS_FILE.write_text(json.dumps(models, ensure_ascii=False, indent=2), encoding="utf-8")
        ACTIVE_MODEL_FILE.write_text(json.dumps({
            "active": model_id,
            "ct2_path": str(Path(ct2).resolve()),
        }, ensure_ascii=False), encoding="utf-8")
        return jsonify({"ok": True, "active": model_id, "model_id": model_id})

    @app.route("/training/active-model", methods=["GET"])
    def get_active_model():
        if not ACTIVE_MODEL_FILE.is_file():
            return jsonify({"active": None})
        try:
            data = json.loads(ACTIVE_MODEL_FILE.read_text(encoding="utf-8"))
            active = data.get("active")
            if active and active.startswith("lora:") and not resolve_trained_model(active):
                return jsonify({
                    "active": None,
                    "suspended": active,
                    "reason": "the previously active model does not have a passing comparable WER/CER holdout",
                })
            return jsonify(data)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/training/models", methods=["GET"])
    def get_trained_models():
        try:
            models = json.loads(TRAINED_MODELS_FILE.read_text(encoding="utf-8")) if TRAINED_MODELS_FILE.is_file() else []
            for model in models:
                model["quality_gate"], model["quality_gate_reasons"] = _model_quality_gate(model)
            return jsonify({"models": models})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return app


def get_active_ct2_path() -> Optional[str]:
    """Called by transcribe_server.load_model() to override the base model
    when the user has activated a fine-tuned CT2 build."""
    try:
        if ACTIVE_MODEL_FILE.is_file():
            data = json.loads(ACTIVE_MODEL_FILE.read_text(encoding="utf-8"))
            active = data.get("active")
            p = resolve_trained_model(active) if isinstance(active, str) else None
            if p and Path(p).is_dir():
                return p
    except Exception:
        pass
    return None

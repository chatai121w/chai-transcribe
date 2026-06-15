"""Benchmark 3-speaker diarization accuracy on local /diarize engines.

Creates a synthetic 3-speaker WAV by concatenating existing Hebrew fixtures:
- speaker 1: hebrew_short.wav
- speaker 2: hebrew_medium.wav
- speaker 3: hebrew_long.wav

Then runs /diarize for available engines and computes timeline accuracy (%).
"""

from __future__ import annotations

import itertools
import json
import os
import wave
from pathlib import Path
from typing import Dict, List, Tuple

import requests

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "e2e" / "fixtures"
OUT_WAV = FIX / "hebrew_three_speakers.wav"
OUT_META = FIX / "hebrew_three_speakers.timeline.json"
SERVER = os.environ.get("WHISPER_SERVER_URL", "http://localhost:3000")
HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()

SRC_FILES = [
    ("דובר 1", FIX / "hebrew_short.wav"),
    ("דובר 2", FIX / "hebrew_medium.wav"),
    ("דובר 3", FIX / "hebrew_long.wav"),
]

SILENCE_SECONDS = 1.8
STEP = 0.1  # timeline step for accuracy


def read_wav_mono_16k(path: Path) -> Tuple[bytes, int, int, int]:
    with wave.open(str(path), "rb") as w:
        return w.readframes(w.getnframes()), w.getframerate(), w.getnchannels(), w.getsampwidth()


def make_fixture() -> List[Dict[str, float | str]]:
    chunks: List[bytes] = []
    timeline: List[Dict[str, float | str]] = []

    base_rate = None
    base_channels = None
    base_samp = None

    cursor = 0.0
    for idx, (speaker, src) in enumerate(SRC_FILES):
        data, rate, channels, samp = read_wav_mono_16k(src)
        if base_rate is None:
            base_rate, base_channels, base_samp = rate, channels, samp
        if (rate, channels, samp) != (base_rate, base_channels, base_samp):
            raise RuntimeError(f"WAV format mismatch in {src}")

        duration = len(data) / (rate * channels * samp)
        start = cursor
        end = cursor + duration
        timeline.append({"speaker_label": speaker, "start": round(start, 3), "end": round(end, 3)})
        chunks.append(data)
        cursor = end

        if idx < len(SRC_FILES) - 1:
            silence_frames = int(SILENCE_SECONDS * rate)
            chunks.append((b"\x00" * samp * channels) * silence_frames)
            cursor += SILENCE_SECONDS

    assert base_rate and base_channels and base_samp
    FIX.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT_WAV), "wb") as out:
        out.setnchannels(base_channels)
        out.setsampwidth(base_samp)
        out.setframerate(base_rate)
        out.writeframes(b"".join(chunks))

    OUT_META.write_text(json.dumps({"timeline": timeline, "step": STEP}, ensure_ascii=False, indent=2), encoding="utf-8")
    return timeline


def speaker_at(segments: List[Dict], t: float) -> str | None:
    for s in segments:
        if float(s.get("start", 0.0)) <= t < float(s.get("end", 0.0)):
            return str(s.get("speaker_label") or s.get("speaker") or "")
    return None


def best_mapped_accuracy(pred_segments: List[Dict], gt_segments: List[Dict], duration: float, step: float) -> Tuple[float, float, Dict[str, str]]:
    ts = []
    x = 0.0
    while x < duration:
        ts.append(round(x, 3))
        x += step

    pred_labels = sorted({speaker_at(pred_segments, t) for t in ts if speaker_at(pred_segments, t)})
    gt_labels = sorted({speaker_at(gt_segments, t) for t in ts if speaker_at(gt_segments, t)})

    if not pred_labels or not gt_labels:
        return 0.0, {}

    best = 0
    best_balanced = 0.0
    best_map: Dict[str, str] = {}

    for perm in itertools.permutations(gt_labels, min(len(pred_labels), len(gt_labels))):
        mapping = {pred_labels[i]: perm[i] for i in range(len(perm))}
        ok = 0
        total = 0
        per_gt_total: Dict[str, int] = {}
        per_gt_ok: Dict[str, int] = {}
        for t in ts:
            gt = speaker_at(gt_segments, t)
            if not gt:
                continue
            total += 1
            per_gt_total[gt] = per_gt_total.get(gt, 0) + 1
            pr = speaker_at(pred_segments, t)
            mapped = mapping.get(pr or "", "")
            if mapped == gt:
                ok += 1
                per_gt_ok[gt] = per_gt_ok.get(gt, 0) + 1
        recalls = []
        for g in gt_labels:
            denom = per_gt_total.get(g, 0)
            if denom > 0:
                recalls.append(per_gt_ok.get(g, 0) / denom)
        balanced = (sum(recalls) / len(recalls) * 100.0) if recalls else 0.0
        if ok > best:
            best = ok
            best_map = mapping
            best_balanced = balanced

    total = sum(1 for t in ts if speaker_at(gt_segments, t))
    acc = (best / total * 100.0) if total else 0.0
    return round(acc, 2), round(best_balanced, 2), best_map


def call_engine(engine: str, audio_path: Path) -> Dict:
    data = {
        "language": "he",
        "diarization_engine": engine,
        "min_gap": "1.2",
    }
    if engine == "pyannote" and HF_TOKEN:
        data["hf_token"] = HF_TOKEN

    with audio_path.open("rb") as f:
        r = requests.post(
            f"{SERVER}/diarize",
            files={"file": (audio_path.name, f, "audio/wav")},
            data=data,
            timeout=600,
        )
    out = {"status": r.status_code}
    try:
        body = r.json()
    except Exception:
        body = {"error": r.text[:500]}
    out["body"] = body
    return out


def main() -> int:
    print("[1/4] Building 3-speaker fixture...")
    gt_timeline = make_fixture()
    total_duration = gt_timeline[-1]["end"] if gt_timeline else 0.0

    print(f"Fixture: {OUT_WAV}")
    print(f"Duration: {total_duration:.2f}s")

    engines = ["silence-gap", "whisperx", "auto", "pyannote"]
    results = []

    print("[2/4] Checking server health...")
    h = requests.get(f"{SERVER}/health", timeout=30)
    print(f"Health status: {h.status_code}")
    if h.status_code != 200:
        print("Server is not healthy. Aborting.")
        return 2

    print("[3/4] Running diarization engines...")
    for eng in engines:
        if eng == "pyannote" and not HF_TOKEN:
            print("- pyannote: skipped (HF_TOKEN missing)")
            continue

        print(f"- {eng}: running...")
        res = call_engine(eng, OUT_WAV)
        status = res["status"]
        body = res["body"]

        if status != 200:
            print(f"  -> failed ({status})")
            results.append({"engine": eng, "ok": False, "status": status, "error": body.get("error", "unknown")})
            continue

        segs = body.get("segments", [])
        acc, balanced_acc, mapping = best_mapped_accuracy(segs, gt_timeline, float(total_duration), STEP)
        results.append({
            "engine": eng,
            "ok": True,
            "accuracy_pct": acc,
            "balanced_accuracy_pct": balanced_acc,
            "speaker_count": body.get("speaker_count"),
            "method": body.get("diarization_method"),
            "processing_time": body.get("processing_time"),
            "mapping": mapping,
        })
        print(
            f"  -> ok | accuracy={acc}% | balanced={balanced_acc}% | "
            f"speakers={body.get('speaker_count')} | method={body.get('diarization_method')}"
        )

    ok_results = [r for r in results if r.get("ok")]
    best = max(ok_results, key=lambda x: x.get("balanced_accuracy_pct", x.get("accuracy_pct", 0)), default=None)

    summary = {
        "fixture": str(OUT_WAV),
        "ground_truth": gt_timeline,
        "results": results,
        "best_engine": best,
    }

    out_json = FIX / "hebrew_three_speakers.benchmark.json"
    out_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print("[4/4] Summary")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"Saved benchmark: {out_json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Recover recording provenance for legacy ASR clips by waveform matching.

The tool is intentionally conservative: it writes metadata only for clips with
a high normalized correlation against a full source recording. Recovered clips
remain `needs-review`; source recovery is not evidence that their text is Gold.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve


SAMPLE_RATE = 1000


def decode_audio(path: Path) -> np.ndarray:
    result = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1",
            "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1",
        ],
        check=True,
        capture_output=True,
    )
    return np.frombuffer(result.stdout, dtype="<f4").astype(np.float64)


def content_fingerprint(path: Path) -> str:
    size = path.stat().st_size
    with path.open("rb") as handle:
        head = handle.read(256 * 1024)
    return hashlib.sha256(head + f"|len={size}".encode()).hexdigest()[:16]


def best_waveform_match(source: np.ndarray, clip: np.ndarray) -> tuple[float, float]:
    if clip.size < SAMPLE_RATE // 4 or source.size < clip.size:
        return 0.0, 0.0
    clip = clip - clip.mean()
    clip_energy = float(np.dot(clip, clip))
    if clip_energy <= 1e-12:
        return 0.0, 0.0

    numerator = fftconvolve(source, clip[::-1], mode="valid")
    window = np.ones(clip.size, dtype=np.float64)
    local_sum = fftconvolve(source, window, mode="valid")
    local_sq = fftconvolve(source * source, window, mode="valid")
    local_energy = np.maximum(local_sq - (local_sum * local_sum) / clip.size, 1e-12)
    scores = numerator / np.sqrt(local_energy * clip_energy)
    index = int(np.nanargmax(scores))
    return float(scores[index]), index / SAMPLE_RATE


def overlap_pairs(rows: list[dict]) -> list[dict]:
    overlaps = []
    ordered = sorted(rows, key=lambda row: row["start"])
    for index, left in enumerate(ordered):
        for right in ordered[index + 1:]:
            overlap = min(left["end"], right["end"]) - max(left["start"], right["start"])
            if overlap <= 0:
                if right["start"] >= left["end"]:
                    break
                continue
            overlaps.append({
                "left": left["stem"],
                "right": right["stem"],
                "seconds": round(overlap, 3),
            })
    return overlaps


def recover(dataset: Path, source_root: Path, threshold: float, write: bool, max_unmatched: int) -> dict:
    audio_dir = dataset / "audio"
    metadata_dir = dataset / "metadata"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    pending = [
        path for path in sorted(audio_dir.glob("*"))
        if not (metadata_dir / f"{path.stem}.json").is_file()
    ]
    # Full recordings are necessarily larger than the short training clips.
    # This also avoids decoding IndexedDB thumbnails and tiny auxiliary blobs.
    minimum_source_size = max((path.stat().st_size for path in pending), default=0)
    source_paths = [
        path for path in source_root.rglob("*")
        if path.is_file() and path.stat().st_size > minimum_source_size
    ]
    decoded_clips = {path.stem: decode_audio(path) for path in pending}
    assignments: list[dict] = []
    rejected: list[dict] = []
    unmatched_anchors = 0

    while pending:
        anchor = pending[0]
        anchor_audio = decoded_clips[anchor.stem]
        best: tuple[float, float, Path, np.ndarray] | None = None
        for source_path in source_paths:
            try:
                source_audio = decode_audio(source_path)
            except (subprocess.CalledProcessError, OSError):
                continue
            score, start = best_waveform_match(source_audio, anchor_audio)
            if best is None or score > best[0]:
                best = (score, start, source_path, source_audio)
            if score >= 0.999:
                break

        if best is None or best[0] < threshold:
            rejected.append({
                "stem": anchor.stem,
                "bestScore": round(best[0], 6) if best else 0.0,
                "bestSource": str(best[2].resolve()) if best else None,
            })
            pending.remove(anchor)
            unmatched_anchors += 1
            if unmatched_anchors >= max_unmatched:
                rejected.extend({"stem": path.stem, "reason": "scan stopped after unmatched anchors"} for path in pending)
                pending.clear()
            continue

        _, _, source_path, source_audio = best
        fingerprint = content_fingerprint(source_path)
        matched = []
        for clip_path in list(pending):
            score, start = best_waveform_match(source_audio, decoded_clips[clip_path.stem])
            if score < threshold:
                continue
            duration = decoded_clips[clip_path.stem].size / SAMPLE_RATE
            row = {
                "stem": clip_path.stem,
                "source": str(source_path.resolve()),
                "sourceRecordingId": fingerprint,
                "start": round(start, 6),
                "end": round(start + duration, 6),
                "score": round(score, 6),
            }
            matched.append(row)
            assignments.append(row)
            pending.remove(clip_path)
            if write:
                metadata = {
                    "schemaVersion": 2,
                    "sourceRecordingId": fingerprint,
                    "groupId": fingerprint,
                    "sourceKind": "recovered-local-recording",
                    "sourceRef": str(source_path.resolve()),
                    "labelSource": "legacy-unreviewed",
                    "qualityTier": "unknown",
                    "reviewStatus": "needs-review",
                    "start": row["start"],
                    "end": row["end"],
                    "recoveryCorrelation": row["score"],
                }
                (metadata_dir / f"{clip_path.stem}.json").write_text(
                    json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8",
                )

        source_paths = [path for path in source_paths if path != source_path]

    grouped: dict[str, list[dict]] = {}
    for row in assignments:
        grouped.setdefault(row["sourceRecordingId"], []).append(row)
    overlaps = [
        {"sourceRecordingId": group_id, **overlap}
        for group_id, rows in grouped.items()
        for overlap in overlap_pairs(rows)
    ]
    return {
        "dataset": str(dataset.resolve()),
        "threshold": threshold,
        "write": write,
        "matched": len(assignments),
        "rejected": rejected,
        "recordingGroups": len(grouped),
        "assignments": assignments,
        "overlaps": overlaps,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--threshold", type=float, default=0.985)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--max-unmatched", type=int, default=3)
    args = parser.parse_args()
    if not 0.8 <= args.threshold <= 1.0:
        raise SystemExit("--threshold must be between 0.8 and 1.0")
    result = recover(args.dataset, args.sources, args.threshold, args.write, max(1, args.max_unmatched))
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(payload, encoding="utf-8")
    print(payload)


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .common import file_sha256, write_json


def audit_dataset(dataset_dir: Path, known_trained_hashes: set[str] | None = None) -> dict[str, Any]:
    known_trained_hashes = known_trained_hashes or set()
    manifest = dataset_dir / "manifest.jsonl"
    rows = []
    for line_number, raw in enumerate(manifest.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            rows.append(json.loads(raw))
        except json.JSONDecodeError as exc:
            raise ValueError(f"{manifest}:{line_number}: invalid JSON") from exc

    hashes: set[str] = set()
    groups: set[str] = set()
    missing_audio = 0
    hash_mismatches = 0
    human_gold = 0
    clean_holdout_candidates = 0
    previously_trained_gold = 0
    for row in rows:
        metadata = row.get("metadata") or {}
        audio = Path(str(row.get("audio", "")))
        expected_hash = str(row.get("audio_sha256", ""))
        group = str(row.get("group_id") or metadata.get("groupId") or metadata.get("sourceRecordingId") or "")
        if group:
            groups.add(group)
        if not audio.is_file():
            missing_audio += 1
            continue
        actual_hash = file_sha256(audio)
        if expected_hash and expected_hash != actual_hash:
            hash_mismatches += 1
        hashes.add(actual_hash)
        is_gold = metadata.get("qualityTier") == "gold" and metadata.get("labelSource") == "human-approved"
        if is_gold:
            human_gold += 1
            if actual_hash in known_trained_hashes:
                previously_trained_gold += 1
            elif group:
                clean_holdout_candidates += 1

    warnings = []
    if human_gold < 2:
        warnings.append("fewer than two human-approved Gold clips")
    if len(groups) < 2:
        warnings.append("fewer than two source recording groups")
    if clean_holdout_candidates == 0:
        warnings.append("no clean holdout candidate after known training history")
    if missing_audio or hash_mismatches:
        warnings.append("audio integrity failures detected")
    return {
        "dataset": dataset_dir.name,
        "samples": len(rows),
        "unique_audio_hashes": len(hashes),
        "recording_groups": len(groups),
        "human_approved_gold": human_gold,
        "previously_trained_gold": previously_trained_gold,
        "clean_holdout_candidates": clean_holdout_candidates,
        "missing_audio": missing_audio,
        "hash_mismatches": hash_mismatches,
        "ready_for_proof_of_learning": not warnings,
        "warnings": warnings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit legacy datasets without importing them into the isolated lab.")
    parser.add_argument("dataset_dirs", nargs="+", type=Path)
    parser.add_argument("--known-trained-audio", action="append", default=[], type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    known_hashes = {file_sha256(path) for path in args.known_trained_audio}
    audits = [audit_dataset(path, known_hashes) for path in args.dataset_dirs]
    result = {"schema_version": 1, "datasets": audits, "all_ready": all(item["ready_for_proof_of_learning"] for item in audits)}
    write_json(args.output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

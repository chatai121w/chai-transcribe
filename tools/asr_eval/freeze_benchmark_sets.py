#!/usr/bin/env python3
"""Freeze leakage-safe ASR benchmark snapshots from reviewed evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def load_rows(dataset: Path) -> list[dict]:
    rows = []
    metadata_dir = dataset / "metadata"
    for audio in sorted((dataset / "audio").glob("*")):
        text_path = dataset / "texts" / f"{audio.stem}.txt"
        metadata_path = metadata_dir / f"{audio.stem}.json"
        if not text_path.is_file() or not metadata_path.is_file():
            continue
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        group_id = str(
            metadata.get("sourceRecordingId") or metadata.get("groupId") or ""
        ).strip()
        rows.append({
            "stem": audio.stem,
            "audio": str(audio.resolve()),
            "audio_sha256": hashlib.sha256(audio.read_bytes()).hexdigest(),
            "text": text_path.read_text(encoding="utf-8").strip(),
            "group_id": group_id,
            "metadata": metadata,
        })
    return rows


def freeze(dataset: Path, output: Path, failure_groups: int, write_roles: bool) -> dict:
    rows = load_rows(dataset)
    reviewed = [
        row for row in rows
        if row["group_id"]
        and row["metadata"].get("qualityTier") == "gold"
        and row["metadata"].get("reviewStatus") == "human-approved-after-listening"
        and int(row["metadata"].get("acousticEvidence") or 0) == 1
    ]
    grouped: dict[str, list[dict]] = {}
    for row in reviewed:
        grouped.setdefault(row["group_id"], []).append(row)

    failure_candidates = [
        (group_id, values)
        for group_id, values in grouped.items()
        if any(value["metadata"].get("editClassification") == "acoustic-word-correction" for value in values)
    ]
    failure_candidates.sort(key=lambda item: min(
        str(row["metadata"].get("approvedAt") or row["stem"]) for row in item[1]
    ))
    failure_ids = {group_id for group_id, _ in failure_candidates[:failure_groups]}
    sentinel_ids = {
        group_id for group_id, values in grouped.items()
        if any(bool(value["metadata"].get("representativeSentinel")) for value in values)
    }
    if failure_ids & sentinel_ids:
        raise RuntimeError("a recording group cannot belong to both benchmark sets")

    selected = []
    for row in reviewed:
        role = (
            "failure-holdout" if row["group_id"] in failure_ids
            else "representative-sentinel" if row["group_id"] in sentinel_ids
            else None
        )
        if not role:
            continue
        selected.append({**row, "benchmark_role": role})
        if write_roles:
            metadata_path = dataset / "metadata" / f'{row["stem"]}.json'
            metadata = row["metadata"] | {"benchmarkRole": role}
            metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    canonical = [
        {key: row[key] for key in ("audio", "audio_sha256", "text", "group_id", "benchmark_role")}
        for row in selected
    ]
    canonical.sort(key=lambda row: (row["benchmark_role"], row["group_id"], row["audio_sha256"]))
    fingerprint = hashlib.sha256(json.dumps(
        canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()).hexdigest()
    snapshot = {
        "schemaVersion": 1,
        "fingerprint": fingerprint,
        "failureHoldoutGroups": len(failure_ids),
        "representativeSentinelGroups": len(sentinel_ids),
        "rows": canonical,
        "warnings": [],
    }
    if len(failure_ids) < failure_groups:
        snapshot["warnings"].append("not enough reviewed acoustic-failure recording groups")
    if not sentinel_ids:
        snapshot["warnings"].append("no representative sentinel recording has been explicitly approved")
    if output.exists():
        existing = json.loads(output.read_text(encoding="utf-8"))
        if existing.get("fingerprint") != fingerprint:
            raise RuntimeError(f"refusing to overwrite frozen benchmark: {output}")
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    return snapshot


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--failure-groups", type=int, default=2)
    parser.add_argument("--write-roles", action="store_true")
    args = parser.parse_args()
    print(json.dumps(
        freeze(args.dataset, args.output, args.failure_groups, args.write_roles),
        ensure_ascii=False,
        indent=2,
    ))


if __name__ == "__main__":
    main()

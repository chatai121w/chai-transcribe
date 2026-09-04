from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from .common import read_jsonl, validate_samples, write_json


def prepare(manifest: Path, output_dir: Path, verify_audio: bool = True) -> dict:
    validated = validate_samples(read_jsonl(manifest), verify_audio=verify_audio)
    canonical = json.dumps(validated["samples"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    snapshot = {
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_manifest": str(manifest.resolve()),
        "dataset_fingerprint": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "gold_source": "human_verified",
        "train_test_isolation": validated["isolation"],
        "split_counts": validated["split_counts"],
        "samples": validated["samples"],
    }
    write_json(output_dir / "snapshot.json", snapshot)
    return snapshot


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate and freeze an isolated Audio + Gold dataset snapshot.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--skip-audio-hash-verification", action="store_true", help="For manifest linting only; never use for a real run.")
    args = parser.parse_args()
    snapshot = prepare(args.manifest, args.output_dir, not args.skip_audio_hash_verification)
    print(json.dumps({key: snapshot[key] for key in ("dataset_fingerprint", "split_counts", "train_test_isolation")}, indent=2))


if __name__ == "__main__":
    main()

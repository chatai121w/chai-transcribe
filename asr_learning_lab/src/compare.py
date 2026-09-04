from __future__ import annotations

import argparse
import json
from pathlib import Path

from .common import write_json


def compare(baseline: dict, candidate: dict, max_relative_regression: float = 0.0) -> dict:
    splits = {}
    for split in ("train", "test"):
        before = baseline["splits"][split]
        after = candidate["splits"][split]
        splits[split] = {
            "before_wer": before["wer"], "after_wer": after["wer"],
            "before_cer": before["cer"], "after_cer": after["cer"],
            "wer_delta": after["wer"] - before["wer"],
            "cer_delta": after["cer"] - before["cer"],
        }
    train_improved = splits["train"]["after_wer"] < splits["train"]["before_wer"]
    allowed_test_wer = splits["test"]["before_wer"] * (1.0 + max_relative_regression)
    holdout_passed = splits["test"]["after_wer"] <= allowed_test_wer
    checkpoint_created = candidate.get("checkpoint_created") == "PASS"
    checkpoint_reload = candidate.get("checkpoint_reload") == "PASS"
    isolated = candidate.get("train_test_isolation") == "PASS"
    passed = train_improved and holdout_passed and checkpoint_created and checkpoint_reload and isolated
    return {
        "schema_version": 1,
        "splits": splits,
        "checkpoint_created": candidate.get("checkpoint_created", "UNKNOWN"),
        "checkpoint_reload": candidate.get("checkpoint_reload", "UNKNOWN"),
        "train_test_isolation": candidate.get("train_test_isolation", "UNKNOWN"),
        "regression_gate": "PASS" if passed else "FAIL",
        "conclusion": "LEARNING PIPELINE VERIFIED" if passed else "NOT VERIFIED",
        "reasons": {
            "train_wer_improved": train_improved,
            "holdout_wer_within_gate": holdout_passed,
            "checkpoint_created": checkpoint_created,
            "checkpoint_reloaded": checkpoint_reload,
            "train_test_isolated": isolated,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare Base and Candidate with a frozen-holdout regression gate.")
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--run-status", type=Path, help="Checkpoint/reload/isolation evidence produced by train_lora.")
    parser.add_argument("--config", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-relative-regression", type=float, default=0.0)
    args = parser.parse_args()
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
    if args.run_status:
        status = json.loads(args.run_status.read_text(encoding="utf-8"))
        for field in ("checkpoint_created", "checkpoint_reload", "train_test_isolation"):
            candidate[field] = status.get(field, "UNKNOWN")
    max_relative_regression = args.max_relative_regression
    if args.config:
        from .transcribe_baseline import load_config
        gate = load_config(args.config).get("regression_gate", {})
        max_relative_regression = float(gate.get("max_relative_regression", max_relative_regression))
    report = compare(baseline, candidate, max_relative_regression)
    write_json(args.output, report)
    print(report["conclusion"])


if __name__ == "__main__":
    main()

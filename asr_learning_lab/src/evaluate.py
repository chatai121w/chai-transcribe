from __future__ import annotations

import argparse
from pathlib import Path

from .common import edit_counts, normalized_text, read_jsonl, write_json


def evaluate(manifest: Path, predictions: Path) -> dict:
    gold = {row["id"]: row for row in read_jsonl(manifest)}
    predicted_rows = read_jsonl(predictions)
    predicted = {row["id"]: row for row in predicted_rows}
    if len(predicted) != len(predicted_rows):
        raise ValueError("prediction ids must be unique")
    if gold.keys() != predicted.keys():
        missing = sorted(gold.keys() - predicted.keys())
        extra = sorted(predicted.keys() - gold.keys())
        raise ValueError(f"prediction coverage mismatch; missing={missing}, extra={extra}")

    totals = {split: {"words": 0, "chars": 0, "word_errors": 0, "char_errors": 0,
                      "substitutions": 0, "deletions": 0, "insertions": 0, "samples": 0}
              for split in ("train", "test")}
    for sample_id, reference_row in gold.items():
        split = reference_row["split"]
        reference = normalized_text(str(reference_row["text"]))
        hypothesis = normalized_text(str(predicted[sample_id].get("text", "")))
        word = edit_counts(reference.split(), hypothesis.split())
        char = edit_counts(list(reference.replace(" ", "")), list(hypothesis.replace(" ", "")))
        bucket = totals[split]
        bucket["samples"] += 1
        bucket["words"] += len(reference.split())
        bucket["chars"] += len(reference.replace(" ", ""))
        bucket["word_errors"] += word["errors"]
        bucket["char_errors"] += char["errors"]
        for field in ("substitutions", "deletions", "insertions"):
            bucket[field] += word[field]

    for bucket in totals.values():
        bucket["wer"] = bucket["word_errors"] / bucket["words"] if bucket["words"] else 0.0
        bucket["cer"] = bucket["char_errors"] / bucket["chars"] if bucket["chars"] else 0.0
    return {"schema_version": 1, "normalization": "unicode_nfkc_whitespace", "splits": totals}


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure raw transcript WER/CER without production corrections.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = evaluate(args.manifest, args.predictions)
    write_json(args.output, report)
    print(args.output)


if __name__ == "__main__":
    main()

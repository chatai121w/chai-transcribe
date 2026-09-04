from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Iterable


REQUIRED_FIELDS = {
    "id", "audio_path", "text", "split", "sha256",
    "speaker_id", "source_id", "gold_source",
    "previously_used_for_training", "holdout_eligible",
}
ALLOWED_SPLITS = {"train", "test"}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{line_number}: invalid JSON: {exc.msg}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number}: expected a JSON object")
        rows.append(value)
    if not rows:
        raise ValueError(f"{path}: manifest is empty")
    return rows


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_text(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).split())


def edit_counts(reference: list[str], hypothesis: list[str]) -> dict[str, int]:
    # Dynamic-programming cells contain (cost, substitutions, deletions, insertions).
    previous = [(i, 0, i, 0) for i in range(len(reference) + 1)]
    for j, hyp_token in enumerate(hypothesis, 1):
        current = [(j, 0, 0, j)]
        for i, ref_token in enumerate(reference, 1):
            if ref_token == hyp_token:
                diagonal = previous[i - 1]
            else:
                cell = previous[i - 1]
                diagonal = (cell[0] + 1, cell[1] + 1, cell[2], cell[3])
            cell = previous[i]
            insertion = (cell[0] + 1, cell[1], cell[2], cell[3] + 1)
            cell = current[i - 1]
            deletion = (cell[0] + 1, cell[1], cell[2] + 1, cell[3])
            current.append(min((diagonal, insertion, deletion), key=lambda item: item[0]))
        previous = current
    cost, substitutions, deletions, insertions = previous[-1]
    return {"errors": cost, "substitutions": substitutions, "deletions": deletions, "insertions": insertions}


def validate_samples(samples: list[dict[str, Any]], verify_audio: bool = True) -> dict[str, Any]:
    ids: set[str] = set()
    hashes: dict[str, str] = {}
    source_splits: dict[str, set[str]] = {}
    split_counts = {"train": 0, "test": 0}
    normalized: list[dict[str, Any]] = []

    for index, raw in enumerate(samples, 1):
        missing = REQUIRED_FIELDS - raw.keys()
        if missing:
            raise ValueError(f"sample {index}: missing fields: {', '.join(sorted(missing))}")
        row = dict(raw)
        if row["split"] not in ALLOWED_SPLITS:
            raise ValueError(f"sample {row['id']}: split must be train or test")
        if row["gold_source"] != "human_verified":
            raise ValueError(f"sample {row['id']}: Phase A accepts only human_verified Gold")
        if not isinstance(row["previously_used_for_training"], bool) or not isinstance(row["holdout_eligible"], bool):
            raise ValueError(f"sample {row['id']}: training-history fields must be explicit booleans")
        if row["split"] == "test" and row["previously_used_for_training"]:
            raise ValueError(f"sample {row['id']}: previously trained audio cannot enter the holdout")
        if row["split"] == "test" and not row["holdout_eligible"]:
            raise ValueError(f"sample {row['id']}: test audio must be explicitly holdout_eligible")
        if row["id"] in ids:
            raise ValueError(f"duplicate sample id: {row['id']}")
        if not SHA256_RE.fullmatch(str(row["sha256"])):
            raise ValueError(f"sample {row['id']}: sha256 must be 64 lowercase hex characters")
        previous_split = hashes.get(row["sha256"])
        if previous_split is not None:
            raise ValueError(f"audio hash overlap/duplicate: {row['sha256']} appears in {previous_split} and {row['split']}")
        audio_path = Path(row["audio_path"]).expanduser().resolve()
        if verify_audio:
            if not audio_path.is_file():
                raise ValueError(f"sample {row['id']}: audio file not found: {audio_path}")
            actual_hash = file_sha256(audio_path)
            if actual_hash != row["sha256"]:
                raise ValueError(f"sample {row['id']}: audio sha256 mismatch")
        row["audio_path"] = str(audio_path)
        row["text"] = normalized_text(str(row["text"]))
        if not row["text"]:
            raise ValueError(f"sample {row['id']}: Gold text is empty")
        ids.add(row["id"])
        hashes[row["sha256"]] = row["split"]
        source_splits.setdefault(str(row["source_id"]), set()).add(row["split"])
        split_counts[row["split"]] += 1
        normalized.append(row)

    if not all(split_counts.values()):
        raise ValueError("both train and test must contain at least one sample")
    crossed_sources = sorted(source for source, splits in source_splits.items() if len(splits) > 1)
    if crossed_sources:
        raise ValueError("source_id leakage across train/test: " + ", ".join(crossed_sources))
    return {"samples": normalized, "split_counts": split_counts, "isolation": "PASS"}

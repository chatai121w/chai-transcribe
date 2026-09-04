import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from asr_learning_lab.src.prepare_dataset import prepare


class DatasetIsolationTests(unittest.TestCase):
    def _row(self, sample_id, audio, split, source):
        return {
            "id": sample_id, "audio_path": str(audio), "text": "תמלול זהב",
            "split": split, "sha256": hashlib.sha256(audio.read_bytes()).hexdigest(),
            "speaker_id": "speaker-1", "source_id": source, "gold_source": "human_verified",
            "previously_used_for_training": False, "holdout_eligible": split == "test",
        }

    def test_snapshot_passes_for_disjoint_sources_and_audio(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            train, test = root / "train.wav", root / "test.wav"
            train.write_bytes(b"train-audio")
            test.write_bytes(b"test-audio")
            manifest = root / "manifest.jsonl"
            rows = [self._row("train-1", train, "train", "lesson-train"), self._row("test-1", test, "test", "lesson-test")]
            manifest.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows), encoding="utf-8")
            snapshot = prepare(manifest, root / "out")
            self.assertEqual(snapshot["train_test_isolation"], "PASS")
            self.assertEqual(snapshot["split_counts"], {"train": 1, "test": 1})

    def test_rejects_source_leakage(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            train, test = root / "train.wav", root / "test.wav"
            train.write_bytes(b"train-audio")
            test.write_bytes(b"test-audio")
            manifest = root / "manifest.jsonl"
            rows = [self._row("train-1", train, "train", "same-lesson"), self._row("test-1", test, "test", "same-lesson")]
            manifest.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "source_id leakage"):
                prepare(manifest, root / "out")

    def test_rejects_previously_trained_holdout(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            train, test = root / "train.wav", root / "test.wav"
            train.write_bytes(b"train-audio")
            test.write_bytes(b"test-audio")
            rows = [self._row("train-1", train, "train", "lesson-train"), self._row("test-1", test, "test", "lesson-test")]
            rows[1]["previously_used_for_training"] = True
            manifest = root / "manifest.jsonl"
            manifest.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "cannot enter the holdout"):
                prepare(manifest, root / "out")


if __name__ == "__main__":
    unittest.main()

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from asr_learning_lab.src.audit_legacy_dataset import audit_dataset


class LegacyAuditTests(unittest.TestCase):
    def test_known_trained_gold_is_not_a_holdout_candidate(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            audio = root / "audio.wav"
            audio.write_bytes(b"gold-audio")
            digest = hashlib.sha256(audio.read_bytes()).hexdigest()
            row = {"audio": str(audio), "audio_sha256": digest, "group_id": "source-1",
                   "metadata": {"qualityTier": "gold", "labelSource": "human-approved"}}
            (root / "manifest.jsonl").write_text(json.dumps(row), encoding="utf-8")
            report = audit_dataset(root, {digest})
            self.assertEqual(report["previously_trained_gold"], 1)
            self.assertEqual(report["clean_holdout_candidates"], 0)
            self.assertFalse(report["ready_for_proof_of_learning"])


if __name__ == "__main__":
    unittest.main()

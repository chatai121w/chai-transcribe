import unittest

from asr_learning_lab.src.compare import compare


class RegressionGateTests(unittest.TestCase):
    def test_promotes_only_train_improvement_without_holdout_regression(self):
        base = {"splits": {"train": {"wer": 0.20, "cer": 0.10}, "test": {"wer": 0.19, "cer": 0.09}}}
        candidate = {"splits": {"train": {"wer": 0.05, "cer": 0.03}, "test": {"wer": 0.14, "cer": 0.07}},
                     "checkpoint_created": "PASS", "checkpoint_reload": "PASS", "train_test_isolation": "PASS"}
        self.assertEqual(compare(base, candidate)["conclusion"], "LEARNING PIPELINE VERIFIED")

    def test_rejects_holdout_regression(self):
        base = {"splits": {"train": {"wer": 0.20, "cer": 0.10}, "test": {"wer": 0.19, "cer": 0.09}}}
        candidate = {"splits": {"train": {"wer": 0.05, "cer": 0.03}, "test": {"wer": 0.20, "cer": 0.10}}}
        self.assertEqual(compare(base, candidate)["regression_gate"], "FAIL")

    def test_rejects_missing_checkpoint_evidence(self):
        base = {"splits": {"train": {"wer": 0.20, "cer": 0.10}, "test": {"wer": 0.19, "cer": 0.09}}}
        candidate = {"splits": {"train": {"wer": 0.05, "cer": 0.03}, "test": {"wer": 0.14, "cer": 0.07}}}
        self.assertEqual(compare(base, candidate)["conclusion"], "NOT VERIFIED")


if __name__ == "__main__":
    unittest.main()

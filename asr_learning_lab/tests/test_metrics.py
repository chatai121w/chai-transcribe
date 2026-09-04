import unittest

from asr_learning_lab.src.common import edit_counts, normalized_text


class MetricsTests(unittest.TestCase):
    def test_word_edit_counts(self):
        counts = edit_counts("אחד שני שלוש".split(), "אחד ארבע שלוש חמש".split())
        self.assertEqual(counts, {"errors": 2, "substitutions": 1, "deletions": 0, "insertions": 1})

    def test_normalization_is_limited_and_deterministic(self):
        self.assertEqual(normalized_text("  שלום\n  עולם  "), "שלום עולם")


if __name__ == "__main__":
    unittest.main()

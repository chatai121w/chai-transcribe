import unittest

from server.transcript_quality import is_degenerate_transcript, lexical_diversity_score


class TranscriptQualityTests(unittest.TestCase):
    def test_flags_prompt_repetition(self):
        repeated = " ".join((["תורה"] * 30) + (["אבות"] * 25) + [f"מילה{i}" for i in range(20)])
        self.assertTrue(is_degenerate_transcript(repeated))

    def test_accepts_normal_hebrew_transcript(self):
        sentence = "ברכי נפשי את יהוה הוד והדר לבשת נוטה שמים כיריעה המהלך על כנפי רוח"
        normal = f"{sentence} " + " ".join(f"פסוק{i} מילה{i}" for i in range(30))
        self.assertFalse(is_degenerate_transcript(normal))

    def test_scores_diverse_text_above_repetition(self):
        repeated = "תורה " * 80
        diverse = " ".join(f"מילה{i}" for i in range(80))
        self.assertGreater(lexical_diversity_score(diverse), lexical_diversity_score(repeated))


if __name__ == "__main__":
    unittest.main()

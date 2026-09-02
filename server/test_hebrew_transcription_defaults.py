import unittest

from server.hebrew_transcription_defaults import (
    DEFAULTS,
    HEBREW_DEFAULT_HOTWORDS,
    LOSHON_KODESH_HOTWORDS,
    LOSHON_KODESH_PROMPT,
)


class HebrewTranscriptionDefaultsTest(unittest.TestCase):
    def test_exports_are_derived_from_the_shared_document(self):
        self.assertEqual(LOSHON_KODESH_PROMPT, DEFAULTS["loshonKodeshPrompt"])
        self.assertEqual(
            LOSHON_KODESH_HOTWORDS.split(", "),
            DEFAULTS["loshonKodeshHotwords"],
        )
        self.assertEqual(
            HEBREW_DEFAULT_HOTWORDS.split(", "),
            DEFAULTS["hebrewDefaultHotwords"],
        )

    def test_canonical_lists_have_no_duplicates(self):
        for key in ("loshonKodeshHotwords", "hebrewDefaultHotwords"):
            self.assertEqual(len(DEFAULTS[key]), len(set(DEFAULTS[key])))


if __name__ == "__main__":
    unittest.main()

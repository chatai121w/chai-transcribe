import os
import sys
import unittest
from pathlib import Path


SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

os.environ.pop("ENABLE_LEGACY_LK_API", None)

from transcribe_server import LEGACY_LK_API_ENABLED, app  # noqa: E402


class LegacyLkApiTest(unittest.TestCase):
    def test_legacy_routes_are_disabled_by_default(self):
        self.assertFalse(LEGACY_LK_API_ENABLED)
        response = app.test_client().get("/lk/dictionary")
        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.get_json()["error"], "legacy_lk_api_disabled")

    def test_canonical_routes_are_not_blocked(self):
        rules = {rule.rule for rule in app.url_map.iter_rules()}
        self.assertIn("/health", rules)
        self.assertIn("/transcribe-stream", rules)


if __name__ == "__main__":
    unittest.main()

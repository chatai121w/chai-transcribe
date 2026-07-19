import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from training_routes import _finalize_dataset


class DatasetSplitTests(unittest.TestCase):
    @patch('training_routes._audio_duration', return_value=5.0)
    def test_recording_groups_never_cross_train_and_eval(self, _duration):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for folder in ('audio', 'texts', 'metadata'):
                (root / folder).mkdir()

            for index in range(20):
                stem = f'{index:05d}'
                (root / 'audio' / f'{stem}.wav').write_bytes(b'audio')
                (root / 'texts' / f'{stem}.txt').write_text(f'text {index}', encoding='utf-8')
                group_id = 'recording-a' if index < 10 else 'recording-b'
                (root / 'metadata' / f'{stem}.json').write_text(
                    json.dumps({'groupId': group_id}), encoding='utf-8',
                )

            stats = _finalize_dataset(root)
            train = {
                json.loads(line)['audio']
                for line in (root / 'manifest.train.jsonl').read_text(encoding='utf-8').splitlines()
            }
            evaluation = {
                json.loads(line)['audio']
                for line in (root / 'manifest.eval.jsonl').read_text(encoding='utf-8').splitlines()
            }

            self.assertEqual(stats['recording_groups'], 2)
            self.assertTrue(stats['ready_for_training'])
            self.assertTrue(train)
            self.assertTrue(evaluation)
            self.assertTrue(train.isdisjoint(evaluation))


if __name__ == '__main__':
    unittest.main()

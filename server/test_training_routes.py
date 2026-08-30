import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from training_routes import _evaluation_fingerprint, _finalize_dataset, _model_quality_gate, resolve_trained_model


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

            manifest_row = json.loads((root / 'manifest.jsonl').read_text(encoding='utf-8').splitlines()[0])
            self.assertIn('audio_sha256', manifest_row)
            self.assertIn('metadata', manifest_row)
            self.assertEqual(manifest_row['metadata']['groupId'], manifest_row['group_id'])
            self.assertEqual(stats['eval_fingerprint'], _evaluation_fingerprint([
                json.loads(line)
                for line in (root / 'manifest.eval.jsonl').read_text(encoding='utf-8').splitlines()
            ]))

    @patch('training_routes._audio_duration', return_value=5.0)
    def test_smaller_recording_is_used_for_evaluation(self, _duration):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for folder in ('audio', 'texts', 'metadata'):
                (root / folder).mkdir()

            for index in range(30):
                stem = f'{index:05d}'
                (root / 'audio' / f'{stem}.wav').write_bytes(b'audio')
                (root / 'texts' / f'{stem}.txt').write_text(f'text {index}', encoding='utf-8')
                group_id = 'large-recording' if index < 22 else 'small-recording'
                (root / 'metadata' / f'{stem}.json').write_text(
                    json.dumps({'groupId': group_id}), encoding='utf-8',
                )

            stats = _finalize_dataset(root)
            self.assertEqual(stats['train_count'], 22)
            self.assertEqual(stats['eval_count'], 8)


class ModelQualityGateTests(unittest.TestCase):
    def test_requires_comparable_wer_and_cer(self):
        passed, reasons = _model_quality_gate({
            'wer_before': 30.0, 'wer_after': 20.0,
        })
        self.assertFalse(passed)
        self.assertIn('missing WER/CER holdout metrics', reasons)

    def test_rejects_cer_regression_even_when_wer_improves(self):
        passed, reasons = _model_quality_gate({
            'wer_before': 30.0, 'wer_after': 20.0,
            'cer_before': 10.0, 'cer_after': 11.0,
            'eval_sample_count': 12, 'eval_fingerprint': 'fixed-holdout',
        })
        self.assertFalse(passed)
        self.assertIn('holdout CER regressed', reasons)

    def test_accepts_non_regressing_model_with_one_real_improvement(self):
        passed, reasons = _model_quality_gate({
            'wer_before': 30.0, 'wer_after': 25.0,
            'cer_before': 10.0, 'cer_after': 10.0,
            'eval_sample_count': 12, 'eval_fingerprint': 'fixed-holdout',
        })
        self.assertTrue(passed)
        self.assertEqual(reasons, [])

    def test_legacy_registry_model_without_comparable_metrics_cannot_resolve(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ct2 = root / 'ct2'
            ct2.mkdir()
            registry = root / 'trained_models.json'
            registry.write_text(json.dumps([{
                'model_id': 'lora:legacy', 'ct2_path': str(ct2),
                'wer_before': 30.0, 'wer_after': 20.0,
            }]), encoding='utf-8')
            with patch('training_routes.TRAINED_MODELS_FILE', registry):
                self.assertIsNone(resolve_trained_model('lora:legacy'))

    def test_passing_registry_model_resolves(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ct2 = root / 'ct2'
            ct2.mkdir()
            registry = root / 'trained_models.json'
            registry.write_text(json.dumps([{
                'model_id': 'lora:passing', 'ct2_path': str(ct2),
                'wer_before': 30.0, 'wer_after': 20.0,
                'cer_before': 12.0, 'cer_after': 10.0,
                'eval_sample_count': 8, 'eval_fingerprint': 'fixed',
            }]), encoding='utf-8')
            with patch('training_routes.TRAINED_MODELS_FILE', registry):
                self.assertEqual(resolve_trained_model('lora:passing'), str(ct2))


if __name__ == '__main__':
    unittest.main()

import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from training_routes import (
    _evaluation_fingerprint,
    _finalize_dataset,
    _model_quality_gate,
    register_training_routes,
    resolve_trained_model,
)


class DatasetUploadTests(unittest.TestCase):
    def test_upload_requires_recording_identity_before_writing_files(self):
        with tempfile.TemporaryDirectory() as tmp, patch('training_routes.DATASETS_DIR', Path(tmp)), patch(
            'training_routes._audio_duration', return_value=1.0,
        ):
            dataset = Path(tmp) / 'test-dataset'
            (dataset / 'audio').mkdir(parents=True)
            (dataset / 'texts').mkdir()
            app = Flask(__name__)
            register_training_routes(app)

            response = app.test_client().post('/training/dataset/upload-pair', data={
                'dataset_id': 'test-dataset',
                'text': 'טקסט',
                'audio': (BytesIO(b'audio'), 'clip.wav'),
            })

            self.assertEqual(response.status_code, 400)
            self.assertIn('groupId', response.get_json()['error'])
            self.assertEqual(list((dataset / 'audio').iterdir()), [])

    def test_identical_audio_and_text_is_an_idempotent_success(self):
        with tempfile.TemporaryDirectory() as tmp, patch('training_routes.DATASETS_DIR', Path(tmp)), patch(
            'training_routes._audio_duration', return_value=1.0,
        ):
            app = Flask(__name__)
            register_training_routes(app)
            client = app.test_client()
            payload = lambda text: {
                'dataset_id': 'approved-ground-truth',
                'text': text,
                'metadata': json.dumps({'groupId': 'recording-1'}),
                'audio': (BytesIO(b'same-audio'), 'clip.wav'),
            }

            first = client.post('/training/dataset/approved-pair', data=payload('טקסט אמת'))
            second = client.post('/training/dataset/approved-pair', data=payload('טקסט אמת'))

            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            self.assertTrue(second.get_json()['duplicate'])
            audio_dir = Path(tmp) / 'approved-ground-truth' / 'audio'
            self.assertEqual(len(list(audio_dir.iterdir())), 1)

    def test_identical_audio_with_different_text_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp, patch('training_routes.DATASETS_DIR', Path(tmp)), patch(
            'training_routes._audio_duration', return_value=1.0,
        ):
            app = Flask(__name__)
            register_training_routes(app)
            client = app.test_client()

            first = client.post('/training/dataset/approved-pair', data={
                'dataset_id': 'approved-ground-truth',
                'text': 'טקסט ראשון',
                'metadata': json.dumps({'groupId': 'recording-1'}),
                'audio': (BytesIO(b'same-audio'), 'clip.wav'),
            })
            conflicting = client.post('/training/dataset/approved-pair', data={
                'dataset_id': 'approved-ground-truth',
                'text': 'טקסט אחר',
                'metadata': json.dumps({'groupId': 'recording-1'}),
                'audio': (BytesIO(b'same-audio'), 'clip.wav'),
            })

            self.assertEqual(first.status_code, 200)
            self.assertEqual(conflicting.status_code, 409)
            self.assertIn('different ground-truth', conflicting.get_json()['error'])



class DatasetSplitTests(unittest.TestCase):
    @patch('training_routes._audio_duration', return_value=5.0)
    def test_missing_recording_identity_blocks_training(self, _duration):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for folder in ('audio', 'texts'):
                (root / folder).mkdir()
            for index in range(20):
                stem = f'{index:05d}'
                (root / 'audio' / f'{stem}.wav').write_bytes(f'audio-{index}'.encode())
                (root / 'texts' / f'{stem}.txt').write_text(f'text {index}', encoding='utf-8')

            stats = _finalize_dataset(root)

            self.assertEqual(stats['unknown_group_count'], 20)
            self.assertEqual(stats['recording_groups'], 0)
            self.assertFalse(stats['ready_for_training'])
            self.assertTrue(any('provenance' in warning for warning in stats['warnings']))

    @patch('training_routes._audio_duration', return_value=5.0)
    def test_source_recording_id_is_canonical(self, _duration):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for folder in ('audio', 'texts', 'metadata'):
                (root / folder).mkdir()
            (root / 'audio' / '00001.wav').write_bytes(b'audio')
            (root / 'texts' / '00001.txt').write_text('text', encoding='utf-8')
            (root / 'metadata' / '00001.json').write_text(json.dumps({
                'sourceRecordingId': 'content-fingerprint',
                'groupId': 'legacy-name',
            }), encoding='utf-8')

            _finalize_dataset(root)
            row = json.loads((root / 'manifest.jsonl').read_text(encoding='utf-8'))
            self.assertEqual(row['group_id'], 'content-fingerprint')

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

    @patch('training_routes._audio_duration', return_value=5.0)
    def test_frozen_benchmark_group_is_never_used_for_training(self, _duration):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for folder in ('audio', 'texts', 'metadata'):
                (root / folder).mkdir()
            for index in range(30):
                stem = f'{index:05d}'
                (root / 'audio' / f'{stem}.wav').write_bytes(f'audio-{index}'.encode())
                (root / 'texts' / f'{stem}.txt').write_text(f'text {index}', encoding='utf-8')
                metadata = {'groupId': 'training-recording' if index < 22 else 'holdout-recording'}
                if index >= 22:
                    metadata['benchmarkRole'] = 'failure-holdout'
                (root / 'metadata' / f'{stem}.json').write_text(json.dumps(metadata), encoding='utf-8')

            stats = _finalize_dataset(root)
            train = [json.loads(line) for line in (root / 'manifest.train.jsonl').read_text(encoding='utf-8').splitlines()]
            evaluation = [json.loads(line) for line in (root / 'manifest.eval.jsonl').read_text(encoding='utf-8').splitlines()]

            self.assertEqual(stats['reserved_benchmark_groups'], 1)
            self.assertEqual({row['group_id'] for row in train}, {'training-recording'})
            self.assertEqual({row['group_id'] for row in evaluation}, {'holdout-recording'})


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

    def test_rejects_terminology_regression(self):
        passed, reasons = _model_quality_gate({
            'wer_before': 30.0, 'wer_after': 25.0,
            'cer_before': 10.0, 'cer_after': 9.0,
            'eval_sample_count': 12, 'eval_fingerprint': 'fixed-holdout',
            'eval_term_count': 8, 'term_recall_before': 75.0, 'term_recall_after': 62.5,
        })
        self.assertFalse(passed)
        self.assertIn('holdout terminology recall regressed', reasons)

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

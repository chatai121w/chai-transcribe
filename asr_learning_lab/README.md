# ASR Learning Lab

This directory is an isolated proof-of-learning lab. It is deliberately not imported by, called from, or configured in the production application.

The single Phase A question is whether a base Whisper/Ivrit model can learn from `Audio + human Gold`, survive checkpoint save/reload, and improve numerically on a frozen holdout set.

## Non-negotiable boundaries

- Work only on `lab/proof-of-learning-isolated`; do not merge this POC into `main`.
- Gold is verbatim, human-verified speech. No AI rewrite is Gold.
- A sample belongs to exactly one of `train` or `test`; duplicate audio hashes across splits fail preparation.
- Baseline and candidate use the same audio, Gold, decoding settings, and metric normalization.
- Raw model output is evaluated as-is: no production post-processing, hotwords, dictionary, teachers, or UI.
- Change one experimental variable at a time.
- A candidate is rejected when the frozen-test regression gate fails.

The full source-of-truth plan is in [PROOF_OF_LEARNING_PLAN.md](PROOF_OF_LEARNING_PLAN.md).

## Manifest

Create JSON Lines manifests following [data/README.md](data/README.md), then run:

```powershell
python -m asr_learning_lab.src.prepare_dataset --manifest asr_learning_lab/data/manifests/run-001.jsonl --output-dir asr_learning_lab/artifacts/dataset-run-001
python -m asr_learning_lab.src.transcribe_baseline --snapshot asr_learning_lab/artifacts/dataset-run-001/snapshot.json --config asr_learning_lab/configs/baseline.yaml --output asr_learning_lab/artifacts/run-001/baseline.jsonl
python -m asr_learning_lab.src.train_lora --snapshot asr_learning_lab/artifacts/dataset-run-001/snapshot.json --config asr_learning_lab/configs/poc_lora.yaml --output-dir asr_learning_lab/artifacts/run-001/candidate
python -m asr_learning_lab.src.transcribe_baseline --snapshot asr_learning_lab/artifacts/dataset-run-001/snapshot.json --config asr_learning_lab/configs/baseline.yaml --adapter asr_learning_lab/artifacts/run-001/candidate/adapter --output asr_learning_lab/artifacts/run-001/candidate.jsonl
python -m asr_learning_lab.src.evaluate --manifest asr_learning_lab/data/manifests/run-001.jsonl --predictions asr_learning_lab/artifacts/run-001/baseline.jsonl --output asr_learning_lab/artifacts/run-001/baseline-metrics.json
python -m asr_learning_lab.src.evaluate --manifest asr_learning_lab/data/manifests/run-001.jsonl --predictions asr_learning_lab/artifacts/run-001/candidate.jsonl --output asr_learning_lab/artifacts/run-001/candidate-metrics.json
python -m asr_learning_lab.src.compare --baseline asr_learning_lab/artifacts/run-001/baseline-metrics.json --candidate asr_learning_lab/artifacts/run-001/candidate-metrics.json --run-status asr_learning_lab/artifacts/run-001/candidate/run-status.json --config asr_learning_lab/configs/poc_lora.yaml --output asr_learning_lab/reports/run-001.json
```

Heavy audio, model caches, datasets, checkpoints, and generated reports stay under ignored `artifacts/` or local storage. Only manifests, hashes, configs, code, tests, and intentionally selected reports belong in Git.

## Verification

The dependency-light safety tests do not download a model or require a GPU:

```powershell
python -m unittest discover -s asr_learning_lab/tests -v
```

Model training is intentionally explicit and requires the optional ML stack named by `train_lora.py`. A run is not "verified" until its report records baseline metrics, candidate metrics, checkpoint creation, successful reload, train/test isolation, and the regression-gate result.

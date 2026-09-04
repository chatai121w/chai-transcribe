# Dataset contract

Manifests are UTF-8 JSON Lines. Each non-empty line must contain:

```json
{"id":"lesson-001-0001","audio_path":"D:/asr-gold/lesson-001/0001.wav","text":"תמלול נאמן לדיבור","split":"train","sha256":"64 lowercase hex characters","speaker_id":"speaker-01","source_id":"lesson-001","gold_source":"human_verified","previously_used_for_training":false,"holdout_eligible":false}
```

Required fields are `id`, `audio_path`, `text`, `split`, `sha256`, `speaker_id`, `source_id`, `gold_source`, `previously_used_for_training`, and `holdout_eligible`.

- `split` is exactly `train` or `test` in Phase A.
- `gold_source` is exactly `human_verified`.
- Training history must be explicit. Previously trained audio is allowed only in `train`, never in `test`.
- Every `test` row must explicitly set `holdout_eligible: true`; new Train rows should set it to `false` once the first training run starts.
- `sha256` is calculated from the audio bytes, not the filename.
- IDs and hashes must be unique. The same audio hash in Train and Test is a hard failure.
- For the frozen benchmark, do not split adjacent chunks from the same source across Train and Test. Prefer separation by source and, when evaluating speaker generalization, by speaker.
- Gold must be verbatim speech, not a summary, punctuation rewrite, dictionary correction, teacher output, or production transcript.
- Large audio files are local and are never committed.

`prepare_dataset.py` verifies hashes, rejects overlap, and records a deterministic dataset fingerprint. Once a run begins, freeze its manifest and do not change preprocessing while comparing Base with Candidate.

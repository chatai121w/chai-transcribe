# Torah ASR benchmark

This directory is the single frozen regression benchmark for transcription models.
Do not train on its recordings or copy its transcripts into a training dataset.

Each real sample must belong to exactly one recording and speaker group and one slice:
`modern-hebrew`, `torah-lesson`, `gemara-aramaic`, `ashkenazi-pronunciation`, `noisy-audio`, or `long-form`.
Store consent and license provenance with the source recording. Do not commit private audio.

Run a completed comparison with:

```powershell
npm run quality:compare -- benchmarks/torah-asr.local.json
```

The local JSON follows `asr-quality.example.json`: every sample contains the same human-approved
reference, the base-model transcript, and the candidate-model transcript. Activation is allowed
only when the fixed holdout identity is present and neither WER nor CER regresses.

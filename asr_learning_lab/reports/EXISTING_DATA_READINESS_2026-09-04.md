# Existing data readiness — 2026-09-04

This is a provenance/readiness audit only. No production dataset was copied into the lab, no model was trained, and no existing transcript was relabeled.

| Local dataset | Samples | Human-approved Gold | Independent groups | POC readiness |
| --- | ---: | ---: | ---: | --- |
| `approved-ground-truth` | 19 | 1 | 2 | Not ready: 18 clips are not approved Gold; the sole Gold clip (`00019`) has already been used for training/smoke work and cannot be an independent holdout. |
| `psalm-chant-ashkenazi` | 99 | 0 | 2 | Not ready: all labels have unknown provenance and none is approved Gold. |
| `smoke-terms-20260903` | 1 | 1 | 1 | Training-smoke only: it is a controlled copy of `approved-ground-truth/00019`, has no independent holdout, and is historically contaminated for evaluation. |

The local machine is technically capable of running the POC: the project environment contains PyTorch, Transformers, Datasets, PEFT, Accelerate, PyYAML and SoundFile; CUDA detects an NVIDIA GeForce RTX 5050 Laptop GPU with 8 GB VRAM.

## Required next data action

Record or approve at least two source-separated sets of verbatim Audio + human Gold. Assign complete hashes and provenance before training. The frozen Test source must never have appeared in earlier training, smoke training, dictionary construction, or manual model selection. More than two recordings is strongly preferred for a meaningful generalization claim.

Until that condition is met, the correct experiment status is `NOT VERIFIED`.

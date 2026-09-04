from __future__ import annotations

import argparse
import json
from pathlib import Path

from .common import write_jsonl


def load_config(path: Path) -> dict:
    try:
        import yaml
    except ImportError as exc:
        raise SystemExit("Install PyYAML in the lab environment: python -m pip install pyyaml") from exc
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Save raw baseline ASR output for every frozen sample.")
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--adapter", type=Path, help="Optional saved LoRA adapter for Candidate inference.")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    if snapshot.get("train_test_isolation") != "PASS":
        raise SystemExit("Refusing inference: snapshot did not pass train/test isolation")
    config = load_config(args.config)
    try:
        import torch
        from transformers import WhisperForConditionalGeneration, WhisperProcessor, pipeline
    except ImportError as exc:
        raise SystemExit("Install the isolated ML dependencies: torch, transformers, accelerate, pyyaml") from exc

    model_config = config["model"]
    requested_device = model_config.get("device", "auto")
    device = 0 if requested_device == "auto" and torch.cuda.is_available() else -1
    dtype = torch.float16 if device == 0 and model_config.get("dtype", "auto") in ("auto", "float16") else torch.float32
    pipeline_args = {"task": "automatic-speech-recognition", "device": device, "torch_dtype": dtype}
    model_label = model_config["id"]
    if args.adapter:
        try:
            from peft import PeftModel
        except ImportError as exc:
            raise SystemExit("Candidate inference requires peft") from exc
        processor = WhisperProcessor.from_pretrained(model_config["id"], language=model_config.get("language", "he"), task=model_config.get("task", "transcribe"))
        base_model = WhisperForConditionalGeneration.from_pretrained(model_config["id"], torch_dtype=dtype)
        pipeline_args.update({
            "model": PeftModel.from_pretrained(base_model, args.adapter),
            "tokenizer": processor.tokenizer,
            "feature_extractor": processor.feature_extractor,
        })
        model_label = f"{model_config['id']} + {args.adapter.resolve()}"
    else:
        pipeline_args["model"] = model_config["id"]
    transcriber = pipeline(**pipeline_args)
    generate_kwargs = {
        "language": model_config.get("language", "he"),
        "task": model_config.get("task", "transcribe"),
        "num_beams": config.get("decoding", {}).get("num_beams", 1),
    }
    rows = []
    for sample in snapshot["samples"]:
        result = transcriber(sample["audio_path"], generate_kwargs=generate_kwargs, return_timestamps=False)
        rows.append({
            "id": sample["id"], "split": sample["split"], "sha256": sample["sha256"],
            "text": result["text"], "model_id": model_label,
            "dataset_fingerprint": snapshot["dataset_fingerprint"], "post_processing": "none",
        })
    write_jsonl(args.output, rows)
    print(args.output)


if __name__ == "__main__":
    main()

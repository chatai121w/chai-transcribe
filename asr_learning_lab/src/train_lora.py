from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .common import write_json
from .transcribe_baseline import load_config


@dataclass
class WhisperCollator:
    processor: Any

    def __call__(self, features: list[dict[str, Any]]) -> dict[str, Any]:
        input_features = [{"input_features": feature["input_features"]} for feature in features]
        batch = self.processor.feature_extractor.pad(input_features, return_tensors="pt")
        labels = self.processor.tokenizer.pad(
            [{"input_ids": feature["labels"]} for feature in features], return_tensors="pt"
        )["input_ids"]
        labels = labels.masked_fill(labels == self.processor.tokenizer.pad_token_id, -100)
        if (labels[:, 0] == self.processor.tokenizer.bos_token_id).all().cpu().item():
            labels = labels[:, 1:]
        batch["labels"] = labels
        return batch


def main() -> None:
    parser = argparse.ArgumentParser(description="Train an isolated LoRA using train Audio + human Gold only.")
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    if snapshot.get("train_test_isolation") != "PASS":
        raise SystemExit("Refusing training: snapshot did not pass train/test isolation")
    config = load_config(args.config)
    train_split = config["training"].get("train_split", "train")
    forbidden = set(config["training"].get("forbidden_splits", ["test"]))
    train_rows = [row for row in snapshot["samples"] if row["split"] == train_split]
    if not train_rows or any(row["split"] in forbidden for row in train_rows):
        raise SystemExit("Refusing training: train selection is empty or includes a forbidden split")

    try:
        import torch
        from datasets import Audio, Dataset
        from peft import LoraConfig, PeftModel, get_peft_model
        from transformers import Seq2SeqTrainer, Seq2SeqTrainingArguments, WhisperForConditionalGeneration, WhisperProcessor
    except ImportError as exc:
        raise SystemExit("Install the isolated ML dependencies: torch, transformers, datasets[audio], accelerate, peft, pyyaml") from exc

    seed = int(config["experiment"].get("seed", 17))
    random.seed(seed)
    torch.manual_seed(seed)
    model_id = config["model"]["id"]
    language = config["model"].get("language", "he")
    task = config["model"].get("task", "transcribe")
    processor = WhisperProcessor.from_pretrained(model_id, language=language, task=task)
    base_model = WhisperForConditionalGeneration.from_pretrained(model_id)
    base_model.config.forced_decoder_ids = None
    base_model.config.suppress_tokens = []
    lora = config["lora"]
    model = get_peft_model(base_model, LoraConfig(
        r=int(lora["rank"]), lora_alpha=int(lora["alpha"]), lora_dropout=float(lora["dropout"]),
        target_modules=list(lora["target_modules"]), bias="none", task_type="SEQ_2_SEQ_LM",
    ))

    dataset = Dataset.from_list([{"audio": row["audio_path"], "text": row["text"], "id": row["id"]} for row in train_rows])
    dataset = dataset.cast_column("audio", Audio(sampling_rate=16_000))

    def encode(row: dict[str, Any]) -> dict[str, Any]:
        audio = row["audio"]
        row["input_features"] = processor.feature_extractor(audio["array"], sampling_rate=audio["sampling_rate"]).input_features[0]
        row["labels"] = processor.tokenizer(row["text"]).input_ids
        return row

    dataset = dataset.map(encode, remove_columns=dataset.column_names)
    training = config["training"]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    trainer = Seq2SeqTrainer(
        model=model,
        args=Seq2SeqTrainingArguments(
            output_dir=str(args.output_dir / "trainer"), max_steps=int(training["max_steps"]),
            learning_rate=float(training["learning_rate"]), warmup_steps=int(training["warmup_steps"]),
            per_device_train_batch_size=int(training["per_device_batch_size"]),
            gradient_accumulation_steps=int(training["gradient_accumulation_steps"]),
            fp16=bool(training.get("fp16", True) and torch.cuda.is_available()),
            save_steps=int(training["save_steps"]), logging_steps=int(training["log_steps"]),
            report_to=[], remove_unused_columns=False, seed=seed,
        ),
        train_dataset=dataset,
        data_collator=WhisperCollator(processor),
    )
    trainer.train()
    adapter_dir = args.output_dir / "adapter"
    model.save_pretrained(adapter_dir)
    processor.save_pretrained(adapter_dir)
    reloaded_base = WhisperForConditionalGeneration.from_pretrained(model_id)
    reloaded = PeftModel.from_pretrained(reloaded_base, adapter_dir)
    reloaded.eval()
    status = {
        "schema_version": 1, "base_model": model_id,
        "dataset_fingerprint": snapshot["dataset_fingerprint"],
        "trained_sample_ids": [row["id"] for row in train_rows],
        "forbidden_splits_seen": [], "train_test_isolation": "PASS",
        "checkpoint_created": "PASS" if (adapter_dir / "adapter_config.json").is_file() else "FAIL",
        "checkpoint_reload": "PASS", "adapter_dir": str(adapter_dir.resolve()),
    }
    write_json(args.output_dir / "run-status.json", status)
    print(args.output_dir / "run-status.json")


if __name__ == "__main__":
    main()

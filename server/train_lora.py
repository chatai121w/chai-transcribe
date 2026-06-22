"""
Whisper LoRA Fine-Tuning — runs on the user's local GPU.

Usage (standalone):
    python server/train_lora.py \
        --dataset /path/to/manifest.jsonl \
        --base-model ivrit-ai/whisper-large-v3 \
        --job-name my_lora \
        --output-dir server/lora_adapters \
        --epochs 3 --batch-size 8 --lr 1e-4

Manifest format (one JSON object per line):
    {"audio": "/abs/path/to/clip.wav", "text": "תמלול אמת בעברית"}

Audio: any format librosa can load; auto-resampled to 16kHz mono.

Output: a LoRA PEFT adapter at
    {output_dir}/{job_name}/adapter/
Plus a progress JSON at
    {output_dir}/{job_name}/progress.json    (continuously updated)

Optionally also produces a merged + CTranslate2 model ready for
faster-whisper inference at
    {output_dir}/{job_name}/ct2/
(pass --merge-and-convert).
"""

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path


# ─────────────────────────────────────────────────────────────────────
#  Progress mirror — both stdout (line-prefixed) and progress.json
# ─────────────────────────────────────────────────────────────────────

class ProgressMirror:
    def __init__(self, path: Path):
        self.path = path
        self.state = {
            "status": "preparing",
            "progress": 0.0,
            "current_step": 0,
            "total_steps": 0,
            "current_epoch": 0.0,
            "train_loss": None,
            "eval_loss": None,
            "wer_before": None,
            "wer_after": None,
            "cer_before": None,
            "cer_after": None,
            "log_tail": "",
            "error": None,
            "updated_at": time.time(),
        }
        self._log_lines: list[str] = []
        self._flush()

    def update(self, **patch):
        self.state.update(patch)
        self.state["updated_at"] = time.time()
        self._flush()

    def log(self, msg: str):
        line = f"[{time.strftime('%H:%M:%S')}] {msg}"
        print(f"PROGRESS {line}", flush=True)
        self._log_lines.append(line)
        if len(self._log_lines) > 200:
            self._log_lines = self._log_lines[-200:]
        self.state["log_tail"] = "\n".join(self._log_lines[-40:])
        self._flush()

    def _flush(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.state, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(self.path)
        except Exception as e:
            print(f"PROGRESS_WRITE_ERR {e}", flush=True)


# ─────────────────────────────────────────────────────────────────────
#  Dataset loader
# ─────────────────────────────────────────────────────────────────────

def load_manifest(path: str) -> list[dict]:
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            obj = json.loads(ln)
            if not obj.get("audio") or not obj.get("text"):
                continue
            if not Path(obj["audio"]).is_file():
                continue
            rows.append({"audio": obj["audio"], "text": obj["text"].strip()})
    return rows


# ─────────────────────────────────────────────────────────────────────
#  Main training entrypoint
# ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, help="Path to manifest.jsonl")
    parser.add_argument("--base-model", default="ivrit-ai/whisper-large-v3")
    parser.add_argument("--job-name", required=True)
    parser.add_argument("--output-dir", default="server/lora_adapters")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--lora-r", type=int, default=32)
    parser.add_argument("--lora-alpha", type=int, default=64)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--language", default="he")
    parser.add_argument("--task", default="transcribe")
    parser.add_argument("--eval-split", type=float, default=0.1,
                        help="Fraction of dataset used for evaluation (0 disables eval)")
    parser.add_argument("--max-samples", type=int, default=0,
                        help="If >0, cap dataset to this many rows (useful for smoke tests)")
    parser.add_argument("--merge-and-convert", action="store_true",
                        help="After training, merge LoRA into base and convert to CTranslate2 for faster-whisper")
    args = parser.parse_args()

    job_dir = Path(args.output_dir) / args.job_name
    job_dir.mkdir(parents=True, exist_ok=True)
    progress = ProgressMirror(job_dir / "progress.json")

    try:
        progress.log(f"Job '{args.job_name}' starting — base={args.base_model}")
        progress.update(status="preparing")

        # Lazy heavy imports so the file is loadable even when training deps
        # are not installed (e.g. when the Flask server just lists job status).
        import numpy as np
        import torch
        import librosa
        from datasets import Dataset, Audio
        from transformers import (
            WhisperFeatureExtractor, WhisperTokenizer, WhisperProcessor,
            WhisperForConditionalGeneration,
            Seq2SeqTrainer, Seq2SeqTrainingArguments,
            TrainerCallback,
        )
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        import evaluate

        # ── 1. Load + validate dataset ─────────────────────────────────
        rows = load_manifest(args.dataset)
        if args.max_samples > 0:
            rows = rows[: args.max_samples]
        if len(rows) < 1:
            raise RuntimeError(f"Dataset too small: {len(rows)} valid rows. Need at least 1.")
        progress.log(f"Loaded {len(rows)} valid (audio,text) pairs")
        progress.update(dataset_size=len(rows))

        ds = Dataset.from_list(rows).cast_column("audio", Audio(sampling_rate=16000))
        if args.eval_split > 0 and len(rows) >= 10:
            split = ds.train_test_split(test_size=args.eval_split, seed=42)
            train_ds, eval_ds = split["train"], split["test"]
        else:
            train_ds, eval_ds = ds, None

        # ── 2. Load processor + base model ─────────────────────────────
        progress.log("Loading feature extractor / tokenizer / processor…")
        feature_extractor = WhisperFeatureExtractor.from_pretrained(args.base_model)
        tokenizer = WhisperTokenizer.from_pretrained(args.base_model, language=args.language, task=args.task)
        processor = WhisperProcessor.from_pretrained(args.base_model, language=args.language, task=args.task)

        progress.log(f"Loading base model (this can take a minute)…")
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        model = WhisperForConditionalGeneration.from_pretrained(args.base_model, torch_dtype=dtype)
        model.config.forced_decoder_ids = None
        model.config.suppress_tokens = []
        if device == "cuda":
            model = model.to(device)

        # ── 3. Wrap with LoRA ──────────────────────────────────────────
        progress.log(f"Attaching LoRA (r={args.lora_r}, alpha={args.lora_alpha}, dropout={args.lora_dropout})")
        lora_cfg = LoraConfig(
            r=args.lora_r, lora_alpha=args.lora_alpha, lora_dropout=args.lora_dropout,
            target_modules=["q_proj", "v_proj"],
            bias="none", task_type="SEQ_2_SEQ_LM",
        )
        model = get_peft_model(model, lora_cfg)
        trainable, total = 0, 0
        for p in model.parameters():
            total += p.numel()
            if p.requires_grad:
                trainable += p.numel()
        progress.log(f"Trainable params: {trainable:,} / {total:,} ({100*trainable/total:.3f}%)")

        # ── 4. Preprocess (audio → log-mel; text → label ids) ──────────
        def _prepare(batch):
            audio = batch["audio"]
            batch["input_features"] = feature_extractor(
                audio["array"], sampling_rate=audio["sampling_rate"]
            ).input_features[0]
            batch["labels"] = tokenizer(batch["text"]).input_ids
            return batch

        progress.log("Pre-processing audio (mel spectrograms)…")
        train_ds = train_ds.map(_prepare, remove_columns=train_ds.column_names, num_proc=1)
        if eval_ds is not None:
            eval_ds = eval_ds.map(_prepare, remove_columns=eval_ds.column_names, num_proc=1)

        # ── 5. Data collator ───────────────────────────────────────────
        class DataCollatorSpeechSeq2SeqWithPadding:
            def __init__(self, processor):
                self.processor = processor

            def __call__(self, features):
                input_features = [{"input_features": f["input_features"]} for f in features]
                batch = self.processor.feature_extractor.pad(input_features, return_tensors="pt")
                label_features = [{"input_ids": f["labels"]} for f in features]
                labels_batch = self.processor.tokenizer.pad(label_features, return_tensors="pt")
                labels = labels_batch["input_ids"].masked_fill(
                    labels_batch.attention_mask.ne(1), -100
                )
                if (labels[:, 0] == self.processor.tokenizer.bos_token_id).all().cpu().item():
                    labels = labels[:, 1:]
                batch["labels"] = labels
                return batch

        collator = DataCollatorSpeechSeq2SeqWithPadding(processor=processor)

        # ── 6. Metrics (WER/CER) ───────────────────────────────────────
        metric_wer = evaluate.load("wer")
        metric_cer = evaluate.load("cer")

        def compute_metrics(pred):
            pred_ids = pred.predictions
            label_ids = pred.label_ids
            label_ids[label_ids == -100] = tokenizer.pad_token_id
            pred_str = tokenizer.batch_decode(pred_ids, skip_special_tokens=True)
            label_str = tokenizer.batch_decode(label_ids, skip_special_tokens=True)
            wer = 100 * metric_wer.compute(predictions=pred_str, references=label_str)
            cer = 100 * metric_cer.compute(predictions=pred_str, references=label_str)
            return {"wer": wer, "cer": cer}

        # ── 7. Baseline eval (WER/CER before training) ─────────────────
        if eval_ds is not None:
            progress.log("Running baseline evaluation (WER/CER before training)…")
            try:
                model.eval()
                base_preds, base_refs = [], []
                with torch.no_grad():
                    for i, row in enumerate(eval_ds):
                        inp = torch.tensor(row["input_features"]).unsqueeze(0).to(device).to(dtype)
                        gen = model.generate(input_features=inp, max_new_tokens=225, language=args.language, task=args.task)
                        base_preds.append(tokenizer.decode(gen[0], skip_special_tokens=True))
                        labels = list(row["labels"])
                        labels = [t for t in labels if t != -100]
                        base_refs.append(tokenizer.decode(labels, skip_special_tokens=True))
                        if i >= 30:  # cap baseline eval to keep startup fast
                            break
                wer_before = 100 * metric_wer.compute(predictions=base_preds, references=base_refs)
                cer_before = 100 * metric_cer.compute(predictions=base_preds, references=base_refs)
                progress.log(f"Baseline  WER={wer_before:.2f}%  CER={cer_before:.2f}%")
                progress.update(wer_before=wer_before, cer_before=cer_before)
            except Exception as e:
                progress.log(f"Baseline eval skipped: {e}")

        # ── 8. Trainer + progress callback ─────────────────────────────
        class ProgressCallback(TrainerCallback):
            def on_train_begin(self, args_, state, control, **kw):
                progress.update(status="training", total_steps=state.max_steps or 0)
                progress.log(f"Training started — {state.max_steps} steps planned")

            def on_step_end(self, args_, state, control, **kw):
                if state.max_steps:
                    pct = (state.global_step / state.max_steps) * 100
                else:
                    pct = 0
                patch = {
                    "current_step": state.global_step,
                    "total_steps": state.max_steps,
                    "current_epoch": float(state.epoch or 0),
                    "progress": round(pct, 2),
                }
                if state.log_history:
                    last = state.log_history[-1]
                    if "loss" in last:
                        patch["train_loss"] = last["loss"]
                    if "eval_loss" in last:
                        patch["eval_loss"] = last["eval_loss"]
                progress.update(**patch)

            def on_log(self, args_, state, control, logs=None, **kw):
                if logs:
                    keep = {k: v for k, v in logs.items() if k in ("loss", "eval_loss", "eval_wer", "eval_cer", "learning_rate")}
                    if keep:
                        progress.log(" ".join(f"{k}={v}" for k, v in keep.items()))

        train_args = Seq2SeqTrainingArguments(
            output_dir=str(job_dir / "checkpoints"),
            per_device_train_batch_size=args.batch_size,
            per_device_eval_batch_size=max(1, args.batch_size // 2),
            gradient_accumulation_steps=1,
            learning_rate=args.lr,
            warmup_steps=max(10, int(len(train_ds) * 0.05)),
            num_train_epochs=args.epochs,
            fp16=device == "cuda",
            eval_strategy="epoch" if eval_ds is not None else "no",
            save_strategy="epoch",
            save_total_limit=2,
            logging_steps=10,
            report_to=[],
            predict_with_generate=True,
            generation_max_length=225,
            remove_unused_columns=False,
            label_names=["labels"],
        )

        trainer = Seq2SeqTrainer(
            args=train_args,
            model=model,
            train_dataset=train_ds,
            eval_dataset=eval_ds,
            data_collator=collator,
            compute_metrics=compute_metrics if eval_ds is not None else None,
            tokenizer=processor.feature_extractor,
            callbacks=[ProgressCallback()],
        )

        # ── 9. Train ───────────────────────────────────────────────────
        trainer.train()
        progress.log("Training loop finished.")

        # ── 10. Final eval ─────────────────────────────────────────────
        if eval_ds is not None:
            progress.log("Running final evaluation…")
            metrics = trainer.evaluate()
            progress.update(
                wer_after=metrics.get("eval_wer"),
                cer_after=metrics.get("eval_cer"),
                eval_loss=metrics.get("eval_loss"),
            )
            progress.log(f"Final  WER={metrics.get('eval_wer'):.2f}%  CER={metrics.get('eval_cer'):.2f}%")

        # ── 11. Save adapter ───────────────────────────────────────────
        adapter_path = job_dir / "adapter"
        adapter_path.mkdir(parents=True, exist_ok=True)
        model.save_pretrained(str(adapter_path))
        processor.save_pretrained(str(adapter_path))
        progress.log(f"LoRA adapter saved to {adapter_path}")
        progress.update(adapter_path=str(adapter_path))

        # ── 12. Optional merge + CT2 conversion for faster-whisper ────
        if args.merge_and_convert:
            try:
                progress.update(status="merging")
                progress.log("Merging LoRA weights into base model…")
                merged_dir = job_dir / "merged_hf"
                merged_dir.mkdir(parents=True, exist_ok=True)
                merged = model.merge_and_unload()
                merged.save_pretrained(str(merged_dir), safe_serialization=True)
                processor.save_pretrained(str(merged_dir))

                progress.update(status="converting")
                progress.log("Converting merged model → CTranslate2 (for faster-whisper)…")
                ct2_dir = job_dir / "ct2"
                from ctranslate2.converters import TransformersConverter  # noqa: WPS433
                conv = TransformersConverter(model_name_or_path=str(merged_dir), copy_files=["tokenizer.json", "preprocessor_config.json"])
                conv.convert(output_dir=str(ct2_dir), quantization="float16" if device == "cuda" else "int8", force=True)
                progress.update(ct2_model_path=str(ct2_dir))
                progress.log(f"CT2 model ready at {ct2_dir}")
            except Exception as e:
                progress.log(f"Merge/convert failed (adapter still saved): {e}")

        progress.update(status="done", progress=100.0)
        progress.log("✅ Job complete.")
        sys.exit(0)

    except Exception as e:
        tb = traceback.format_exc(limit=8)
        progress.log(f"❌ FAILED: {e}\n{tb}")
        progress.update(status="failed", error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()

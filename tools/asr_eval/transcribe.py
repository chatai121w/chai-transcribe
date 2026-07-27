# -*- coding: utf-8 -*-
"""
דוגמת pipeline מלאה לתמלול: faster-whisper + מודל ivrit.ai + initial_prompt
+ hotwords + החלת מילון תיקונים.

מוציא שורה אחת לכל קובץ אודיו (כל הסגמנטים מאוחדים) — מיושר לקובץ אמת
שבו שורה אחת לכל קובץ אודיו, כך שאפשר להזין ישר ל-evaluate_asr.py.

הערה על המודל:
  faster-whisper דורש מודל בפורמט CTranslate2.
  • הקל ביותר: התחל מהמרה מוכנה, למשל
      sivan22/faster-whisper-ivrit-ai-whisper-large-v2-tuned
  • לשימוש ב-large-v3 העדכני (ivrit-ai/whisper-large-v3) — המר פעם אחת:
      ct2-transformers-converter --model ivrit-ai/whisper-large-v3 \
          --output_dir ivrit-v3-ct2 --quantization float16
    ואז העבר --model ivrit-v3-ct2

שימוש:
  python transcribe.py golden/*.wav > hyp.txt
  python transcribe.py golden/*.wav --no-prompt --no-corrections > hyp_baseline.txt
"""
import argparse
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL = "sivan22/faster-whisper-ivrit-ai-whisper-large-v2-tuned"


def load_prompt(path):
    if path and os.path.exists(path):
        return open(path, encoding="utf-8").read().strip()
    return None


def load_corrections(path):
    if not (path and os.path.exists(path)):
        return {}, []
    data = json.load(open(path, encoding="utf-8"))
    return data.get("word_replacements", {}), data.get("regex_replacements", [])


def load_hotwords(path, limit=120):
    if not (path and os.path.exists(path)):
        return None
    words = []
    for ln in open(path, encoding="utf-8"):
        ln = ln.strip()
        if ln and not ln.startswith("#"):
            words.append(ln)
    return " ".join(words[:limit]) if words else None


def apply_corrections(text, word_map, regex_list):
    # החלפת מילה שלמה
    if word_map:
        def repl(m):
            return word_map.get(m.group(0), m.group(0))
        # בנה תבנית של כל המפתחות (מילים שלמות)
        keys = sorted(word_map.keys(), key=len, reverse=True)
        if keys:
            pat = r"(?<!\S)(" + "|".join(re.escape(k) for k in keys) + r")(?!\S)"
            text = re.sub(pat, repl, text)
    for pattern, replacement in regex_list:
        text = re.sub(pattern, replacement, text)
    return text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", nargs="+", help="קבצי אודיו (אפשר עם תבנית, למשל golden/*.wav)")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="מודל CT2 (faster-whisper)")
    ap.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    ap.add_argument("--compute-type", default="float16")
    ap.add_argument("--prompt", default=os.path.join(HERE, "initial_prompt_ashkenazi.txt"))
    ap.add_argument("--corrections", default=os.path.join(HERE, "corrections.json"))
    ap.add_argument("--terms", default=os.path.join(HERE, "target_terms.txt"))
    ap.add_argument("--no-prompt", action="store_true", help="כבה initial_prompt (לבדיקת baseline)")
    ap.add_argument("--no-hotwords", action="store_true", help="כבה hotwords")
    ap.add_argument("--no-corrections", action="store_true", help="כבה מילון תיקונים")
    ap.add_argument("--beam-size", type=int, default=5)
    args = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("חסר faster-whisper. התקן: pip install faster-whisper")

    prompt = None if args.no_prompt else load_prompt(args.prompt)
    hotwords = None if args.no_hotwords else load_hotwords(args.terms)
    word_map, regex_list = ({}, []) if args.no_corrections else load_corrections(args.corrections)

    files = []
    for a in args.audio:
        files.extend(sorted(glob.glob(a)) if any(c in a for c in "*?[") else [a])

    print(f"[טוען מודל: {args.model} על {args.device}]", file=sys.stderr)
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)

    for path in files:
        segments, _info = model.transcribe(
            path,
            language="he",
            initial_prompt=prompt,
            hotwords=hotwords,
            beam_size=args.beam_size,
            vad_filter=True,
            condition_on_previous_text=True,
        )
        text = " ".join(s.text.strip() for s in segments)
        text = re.sub(r"\s+", " ", text).strip()
        if not args.no_corrections:
            text = apply_corrections(text, word_map, regex_list)
        print(text)
        print(f"  ✓ {os.path.basename(path)}", file=sys.stderr)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""הורדת שאר מה שצריך למנוע ההקראה.

שלושה דברים נפרדים:

  1. מצפין הקול (כ-102 מגה) — ההמרה מהקלטה של המשתמש לייצוג שהמנוע
     מבין. בלעדיו אפשר להשתמש רק בקולות המוכנים.

     הגילוי שחסך 400 מגה: חשבנו שצריך את המצפין בגרסת הספרייה הכבדה,
     כי בייצוא לגרפים יש רק את הצד שממיר ייצוג לקול. למעשה יש גרף
     מוכן שעושה את זה, והקיפול והנרמול כבר מוטבעים בתוכו.

  2. שני מצפיני הסגנון — אחד לזהות הקול ואחד לקצב הדיבור.

  3. המנקד האוטומטי (כ-294 מגה) — כדי שאפשר יהיה להדביק טקסט **בלי
     ניקוד** והמערכת תנקד אותו לבד. בלי זה חייבים להדביק טקסט מנוקד,
     וזה מגביל מאוד.

     למנקד יש מלכודת: ההתקנה הרגילה של חבילת ההמרה מתקינה בשקט גרסה
     1.0 שהיא חבילה אחרת לגמרי, בלי פעולת ההמרה בכלל. הסיבה: החבילה
     הנכונה מוגדרת לפייתון קטן מ-3.13, וכאן יש 3.13. היא כתובה כולה
     בפייתון בלי חלקים מהודרים, ולכן המגבלה הצהרתית ולא טכנית.

    python scripts/download_tts_extras.py
"""
import os
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "server", "models")
PY = sys.executable

#: קובצי שכפול הקול. שמות הקבצים אומתו מול המחסן בפועל.
CLONE_FILES = [
    "codec_encoder.onnx",
    "style_encoder.onnx",
    "duration_style_encoder.onnx",
    "tts.json",
]

#: המנקד. קובץ אחד, והוא גדול.
NIKUD_REPO = "Phonikud/phonikud-onnx"
NIKUD_FILE = "phonikud-1.0.int8.onnx"

#: המפענח שחבילת המנקד מורידה לבד בהרצה הראשונה. מורידים אותו מראש,
#: כדי שההרצה הראשונה לא תיכשל בלי חיבור לרשת.
TOKENIZER_REPO = "dicta-il/dictabert-large-char-menaked"


def human(n):
    return f"{n / 1e6:.1f} מגה"


def step(title):
    print()
    print("=" * 70)
    print(title)
    print("=" * 70)
    sys.stdout.flush()


def download_clone_files():
    from huggingface_hub import hf_hub_download
    step("1. מצפין הקול ומצפיני הסגנון — לשכפול קול")
    dest = os.path.join(MODELS, "blue-onnx-v2")
    os.makedirs(dest, exist_ok=True)
    total = 0
    for fn in CLONE_FILES:
        t0 = time.time()
        try:
            p = hf_hub_download("notmax123/blue-onnx-v2", fn, local_dir=dest)
            size = os.path.getsize(p)
            total += size
            print(f"  {fn:32} {human(size):>12}  ({time.time() - t0:.0f} שניות)")
        except Exception as exc:
            print(f"  {fn:32} נכשל: {type(exc).__name__}: {str(exc)[:120]}")
            return False
        sys.stdout.flush()
    print(f"  סך הכל: {human(total)}")
    return True


def download_nikud_model():
    from huggingface_hub import hf_hub_download
    step("2. המנקד האוטומטי")
    dest = os.path.join(MODELS, "phonikud")
    os.makedirs(dest, exist_ok=True)
    t0 = time.time()
    try:
        p = hf_hub_download(NIKUD_REPO, NIKUD_FILE, local_dir=dest)
        print(f"  {NIKUD_FILE}  {human(os.path.getsize(p))}  "
              f"({time.time() - t0:.0f} שניות)")
    except Exception as exc:
        print(f"  נכשל: {type(exc).__name__}: {str(exc)[:200]}")
        return False

    # ההורדה הנסתרת: חבילת המנקד מורידה את המפענח לבד בהרצה הראשונה.
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(TOKENIZER_REPO, allow_patterns=["tokenizer.json"])
        print(f"  המפענח של {TOKENIZER_REPO} — הורד מראש")
    except Exception as exc:
        print(f"  המפענח לא הורד: {str(exc)[:120]}")
        print("  זה יעבוד בהרצה הראשונה אם יש חיבור לרשת.")
    return True


def install_phonemizer():
    step("3. חבילות ההמרה לצלילים")
    # הגרסה ננעצת במפורש. בלי זה מותקנת גרסה אחרת לגמרי.
    pkgs = [
        ("phonikud==0.4.1", True),    # דורש עקיפת מגבלת הגרסה
        ("phonikud-onnx", False),
        ("resampy", False),           # לדגימה מחדש זהה לקוד המקור
    ]
    ok = True
    for spec, needs_override in pkgs:
        cmd = [PY, "-m", "pip", "install", "--quiet", spec]
        if needs_override:
            # החבילה מוגדרת לפייתון קטן מ-3.13 אבל כתובה כולה בפייתון
            # בלי חלקים מהודרים, ולכן המגבלה הצהרתית.
            cmd.insert(4, "--ignore-requires-python")
        print(f"  מתקין {spec} ...")
        sys.stdout.flush()
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"    נכשל: {(r.stderr or r.stdout)[-400:]}")
            ok = False
        else:
            print("    הותקן.")
    return ok


def verify():
    step("4. אימות")
    good = True

    try:
        import phonikud
        out = phonikud.phonemize("שָׁלוֹם עוֹלָם")
        print(f"  המרה לצלילים: 'שלום עולם' -> {out!r}")
        if not out or "ʃ" not in out:
            print("    !! הפלט אינו נראה כמו צלילים.")
            good = False
    except Exception as exc:
        print(f"  המרה לצלילים נכשלה: {type(exc).__name__}: {str(exc)[:200]}")
        good = False

    nikud_path = os.path.join(MODELS, "phonikud", NIKUD_FILE)
    if os.path.exists(nikud_path):
        try:
            from phonikud_onnx import Phonikud
            t0 = time.time()
            m = Phonikud(nikud_path)
            v = m.add_diacritics("שלום עולם")
            print(f"  ניקוד אוטומטי: 'שלום עולם' -> {v!r}  "
                  f"({time.time() - t0:.0f} שניות לטעינה)")
            if not any("֑" <= c <= "ׇ" for c in v):
                print("    !! לא נוסף ניקוד.")
                good = False
        except Exception as exc:
            print(f"  ניקוד אוטומטי נכשל: {type(exc).__name__}: {str(exc)[:200]}")
            good = False
    else:
        print("  קובץ המנקד אינו קיים.")
        good = False

    enc = os.path.join(MODELS, "blue-onnx-v2", "codec_encoder.onnx")
    if os.path.exists(enc):
        try:
            import onnxruntime as ort
            ort.set_default_logger_severity(3)
            s = ort.InferenceSession(enc, providers=["CPUExecutionProvider"])
            i = s.get_inputs()[0]
            o = s.get_outputs()[0]
            print(f"  מצפין הקול: קלט {i.name}{i.shape} -> פלט {o.name}{o.shape}")
            if o.shape[1] != 144:
                print("    !! הפלט אינו ב-144 ערוצים כצפוי.")
                good = False
        except Exception as exc:
            print(f"  מצפין הקול נכשל: {type(exc).__name__}: {str(exc)[:200]}")
            good = False
    else:
        print("  מצפין הקול אינו קיים.")
        good = False

    return good


def main():
    print("הורדת שאר מה שצריך למנוע ההקראה")
    results = {
        "שכפול קול": download_clone_files(),
        "המנקד": download_nikud_model(),
        "חבילות ההמרה": install_phonemizer(),
    }
    results["אימות"] = verify()

    step("סיכום")
    for name, ok in results.items():
        print(f"  {name:16} {'תקין' if ok else 'נכשל'}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())

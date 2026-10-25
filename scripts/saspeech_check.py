# -*- coding: utf-8 -*-
"""מודד את המנוע על מדגם ההקראה saspeech.

למה המדגם הזה
--------------
מדגם הבדיקה שלנו היה 349 מילים — שלוש דקות. בגודל כזה טווח
אי-הוודאות הוא כ-4.5 נקודות, ושני קטעים נושאים שליש מהשגיאות.
אי אפשר לקבוע ממנו דבר.

saspeech נותן כ-4 שעות, 2,986 אמירות, בדובר אחד. הוא פתוח לגמרי
והמודל לא אומן עליו.

שלוש הסתייגויות, וכולן כתובות בתיאור המדגם עצמו
-----------------------------------------------
1. **ההפניה מעוגנת בתמלול מכונה.** התמלולים נוצרו בתיקון ידני של
   פלט Whisper large-v2. המודל שלנו הוא נגזרת של ויספר, ולכן
   ייתכן שהוא "מסכים" עם ההפניה יותר ממה שמגיע לו. המספר שיוצא
   מכאן אופטימי במידה לא ידועה.

2. **מוסכמת מספרים מפורשת.** מספרים קטנים מעשר נכתבו במילים,
   גדולים יותר בספרות. אצלנו המנוע כותב לפי שיקולו, וזה בדיוק
   מקור השגיאות שזוהה במדידות קודמות. לכן נמדד גם בלי המוסכמה.

3. **דובר אחד באולפן.** הגייה נקייה מדי. המספר כאן טוב יותר ממה
   שיתקבל על הקלטה אמיתית, והוא מתאים לתפיסת נסיגות — לא לקביעת
   "כמה אנחנו טובים בשטח".

שימוש
-----
    python scripts/saspeech_check.py --limit 200 --save בסיס-saspeech
"""
from __future__ import annotations

import argparse
import io
import os
import re
import sys
import time

sys.path.insert(0, "scripts")
sys.path.insert(0, "server")
import regression_check as rc  # noqa: E402

rc.require_project_python()
rc.add_gpu_dll_dirs()

DATA_DIR = os.path.join("benchmark_private", "saspeech")

# מילות המילוי שהמדגם מסמן במפורש. המנוע שלנו לרוב אינו מתמלל
# אותן כלל, וספירתן כשגיאה מודדת מוסכמת סימון ולא איכות תמלול.
FILLERS = {"אה", "אהמ", "אמ", "המ"}

NUM_WORDS = {
    "אפס": 0, "אחת": 1, "אחד": 1, "שתיים": 2, "שניים": 2, "שתי": 2, "שני": 2,
    "שלוש": 3, "שלושה": 3, "ארבע": 4, "ארבעה": 4, "חמש": 5, "חמישה": 5,
    "שש": 6, "שישה": 6, "שבע": 7, "שבעה": 7, "שמונה": 8, "תשע": 9, "תשעה": 9,
    "עשר": 10, "עשרה": 10,
}


def fold_numbers(tokens):
    """מאחד מספר בספרות ומספר במילים לצורה אחת.

    המדגם כותב מתחת לעשר במילים ומעליו בספרות. המנוע אינו מכיר
    את המוסכמה הזאת, וכל פער כזה נספר כשגיאה אף שהתמלול נכון.
    """
    out = []
    for t in tokens:
        if t.isdigit():
            out.append("<מספר:%d>" % int(t))
        elif t in NUM_WORDS:
            out.append("<מספר:%d>" % NUM_WORDS[t])
        else:
            out.append(t)
    return out


def drop_fillers(tokens):
    return [t for t in tokens if t not in FILLERS]


def load_rows(limit=None):
    import pyarrow.parquet as pq
    files = sorted(f for f in os.listdir(DATA_DIR) if f.endswith(".parquet"))
    if not files:
        raise SystemExit("אין קובצי מדגם ב-%s" % DATA_DIR)
    rows = []
    for name in files:
        table = pq.read_table(os.path.join(DATA_DIR, name))
        data = table.to_pylist()
        for r in data:
            rows.append(r)
            if limit and len(rows) >= limit:
                return rows
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None,
                    help="כמה אמירות למדוד. בלי זה — כל המדגם")
    ap.add_argument("--save", default=None, help="שם לרישום ביומן")
    args = ap.parse_args()

    print("קורא את המדגם...")
    rows = load_rows(args.limit)
    print("   %d אמירות" % len(rows))

    import numpy as np
    import soundfile as sf
    from faster_whisper import WhisperModel

    print("טוען את המנוע...")
    model = WhisperModel("ivrit-ai/whisper-large-v3-ct2",
                         device="cuda", compute_type="float16")
    print("נטען.")
    print()

    strict = {"c": 0, "n": 0}
    folded = {"c": 0, "n": 0}
    audio_s = 0.0
    t0 = time.time()
    tmp = os.path.join(DATA_DIR, "_current.wav")

    for i, row in enumerate(rows, 1):
        a = row["audio"]
        # המדגם שומר את השמע כבתים בתוך הטבלה
        if isinstance(a, dict) and a.get("bytes"):
            data, sr = sf.read(io.BytesIO(a["bytes"]), dtype="float32")
        elif isinstance(a, dict) and a.get("array") is not None:
            data, sr = np.asarray(a["array"], dtype="float32"), a.get("sampling_rate", 44100)
        else:
            continue
        if data.ndim > 1:
            data = data.mean(axis=1)
        audio_s += len(data) / float(sr)
        sf.write(tmp, data, sr)

        segs, _ = model.transcribe(tmp, language="he")
        heard = " ".join(s.text.strip() for s in segs)

        ref = drop_fillers(rc.normalise(row["text"]))
        hyp = drop_fillers(rc.normalise(heard))
        strict["c"] += rc.count_correct(ref, hyp)
        strict["n"] += len(ref)

        rf, hf = fold_numbers(ref), fold_numbers(hyp)
        folded["c"] += rc.count_correct(rf, hf)
        folded["n"] += len(rf)

        if i % 50 == 0:
            print("   %d/%d · %d מתוך 100"
                  % (i, len(rows), round(100.0 * strict["c"] / max(1, strict["n"]))))

    elapsed = time.time() - t0
    if os.path.exists(tmp):
        os.unlink(tmp)

    def pct(d):
        return 100.0 * d["c"] / d["n"] if d["n"] else 0.0

    print()
    print("=" * 70)
    print("כמה מילים יצאו נכון")
    print("=" * 70)
    print("  אמירות:        %d" % len(rows))
    print("  שמע:           %.1f דקות" % (audio_s / 60))
    print("  מילים במבחן:   %d" % strict["n"])
    print()
    print("  כפי שהוא:                  %d מתוך %d = %.0f מתוך 100"
          % (strict["c"], strict["n"], pct(strict)))
    print("  אחרי איחוד צורת מספרים:    %d מתוך %d = %.0f מתוך 100"
          % (folded["c"], folded["n"], pct(folded)))
    print()
    lo, hi = rc.wilson(strict["c"], strict["n"])[1:]
    print("  טווח אי-ודאות: %.1f עד %.1f" % (lo, hi))
    print("  זמן עיבוד: %.1f דקות · יחס %.3f"
          % (elapsed / 60, elapsed / audio_s if audio_s else 0))
    print()
    print("  לשם השוואה, הרף למדגם מהסוג הזה (הקראת ספר): 94 מתוך 100.")
    print("  שימו לב: ההפניה כאן נוצרה בתיקון ידני של תמלול מכונה")
    print("  מוויספר, והמודל שלנו הוא נגזרת של ויספר — ייתכן שהמספר")
    print("  מחמיא לנו במידה שאי אפשר לכמת.")

    if args.save:
        rc.record_simple(
            label=args.save, topic="modern-hebrew",
            correct=strict["c"], total=strict["n"],
            benchmark="saspeech-%d" % len(rows),
            extra={
                "utterances": len(rows),
                "audio_seconds": round(audio_s, 1),
                "realtime_factor": round(elapsed / audio_s, 3) if audio_s else None,
                "folded_numbers_correct": folded["c"],
                "normalisation": rc.normalisation_fingerprint(),
                "note": "ההפניה נוצרה בתיקון ידני של תמלול מכונה מוויספר",
            },
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

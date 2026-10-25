# -*- coding: utf-8 -*-
"""מפרק את המילים השגויות לפי סוג, ואומר כמה מהן ניתנות לתיקון.

למה זה קיים
-----------
"78 מתוך 100 מילים נכונות" הוא מספר נכון, אבל הוא לא אומר מה
לעשות. 22 המילים השגויות אינן מאותו סוג, והטיפול בהן שונה לגמרי:

    כתיב שונה    המנוע שמע נכון וכתב אחרת: "יתכן" מול "ייתכן".
                 נפתר אצלנו בשכבת נרמול, לא במנוע.
    מילה אחרת    שמע משהו אחר. זאת שגיאה אמיתית של המנוע.
    לועזי        שם לועזי או מספר בספרות מול מספר במילים.
    לא תומללה    מילה שנעלמה.
    נוספה        מילה שהמנוע המציא.

הכלי אומר כמה מילים בכל קבוצה, וכמה היה אחוז ההצלחה אילו הקבוצה
הראשונה הייתה נספרת כנכונה — כלומר כמה שווה לבנות את שכבת הנרמול.

הכל באחוזי הצלחה ובמספר מילים, כמו שאר הכלים: כמה מתוך כמה יצאו
נכון, ולא כמה נכשלו.

שימוש
-----
    python scripts/error_breakdown.py
    python scripts/error_breakdown.py --show 30
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys

sys.path.insert(0, "scripts")
import regression_check as rc  # noqa: E402

rc.require_project_python()
rc.add_gpu_dll_dirs()

from faster_whisper import WhisperModel  # noqa: E402

APPROVED = os.path.join("benchmark_private", "approved")
AUDIO = os.path.join("benchmark_private", "audio")

LATIN = set("abcdefghijklmnopqrstuvwxyz0123456789")

LABELS = {
    "כתיב": "כתיב שונה — המנוע שמע נכון",
    "לועזי": "מילה לועזית או מספר בספרות",
    "אחרת": "שמע מילה אחרת — שגיאה אמיתית",
    "חסרה": "מילה שלא תומללה",
    "נוספה": "מילה שהמנוע הוסיף",
}
ORDER = ["כתיב", "לועזי", "אחרת", "חסרה", "נוספה"]


def is_latin(w):
    return any(c in LATIN for c in w)


def one_letter_apart(a, b):
    """האם שתי המילים נבדלות באות אחת בלבד.

    זה הסימן המובהק לכתיב מלא מול חסר, לתחילית שנוספה, ולאם קריאה
    שהושמטה — כלומר למקרים שבהם נאמרה אותה מילה בדיוק.
    """
    if abs(len(a) - len(b)) > 1:
        return False
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] <= 1


def align(ref, hyp):
    """יישור מילה-למילה. מחזיר (סוג, מילה שציפינו, מילה שנשמעה)."""
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1,
                          d[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]))
    steps, i, j = [], n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]):
            steps.append(("נכון" if ref[i - 1] == hyp[j - 1] else "החלפה",
                          ref[i - 1], hyp[j - 1]))
            i -= 1
            j -= 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            steps.append(("חסרה", ref[i - 1], None))
            i -= 1
        else:
            steps.append(("נוספה", None, hyp[j - 1]))
            j -= 1
    return list(reversed(steps))


def classify(kind, r, h):
    if kind == "חסרה":
        return "לועזי" if is_latin(r) else "חסרה"
    if kind == "נוספה":
        return "לועזי" if is_latin(h) else "נוספה"
    if is_latin(r) or is_latin(h):
        return "לועזי"
    return "כתיב" if one_letter_apart(r, h) else "אחרת"


def main(show):
    print("טוען את המנוע...")
    model = WhisperModel("ivrit-ai/whisper-large-v3-ct2",
                         device="cuda", compute_type="float16")
    print("נטען.")
    print()

    groups = {k: [] for k in LABELS}
    words = correct = 0

    for name in sorted(os.listdir(APPROVED)):
        if not name.endswith(".json"):
            continue
        meta = json.load(io.open(os.path.join(APPROVED, name), encoding="utf-8"))
        wav = os.path.join(AUDIO, meta["audio"])
        if not os.path.exists(wav):
            continue
        segs, _ = model.transcribe(wav, language="he")
        heard = " ".join(s.text.strip() for s in segs)
        ref = rc.normalise(meta["text"])
        hyp = rc.normalise(heard)
        words += len(ref)
        for kind, r, h in align(ref, hyp):
            if kind == "נכון":
                correct += 1
            else:
                groups[classify(kind, r, h)].append((meta["name"], r or "—", h or "—"))

    def pct(n):
        return 100.0 * n / words if words else 0.0

    print("=" * 72)
    print("כמה מילים יצאו נכון")
    print("=" * 72)
    print("  מילים במבחן:   %d" % words)
    print("  יצאו נכון:     %d" % correct)
    print("  יצאו שגוי:     %d" % (words - correct))
    print()
    print("  >>> מתוך כל 100 מילים, %.0f יצאו נכון." % pct(correct))
    print()

    print("=" * 72)
    print("מה היו המילים השגויות")
    print("=" * 72)
    print("  %-38s %7s %10s" % ("", "מילים", "מתוך 100"))
    for k in ORDER:
        print("  %-38s %7d %10.0f" % (LABELS[k], len(groups[k]), pct(len(groups[k]))))
    print()

    # ------------------------------------------- כמה שווה לתקן את הכתיב
    fixable = len(groups["כתיב"])
    after = correct + fixable
    print("=" * 72)
    print("כמה שווה לבנות שכבת איחוד כתיב")
    print("=" * 72)
    print("  היום:              %d מתוך %d מילים = %.0f מתוך 100"
          % (correct, words, pct(correct)))
    print("  אחרי איחוד כתיב:   %d מתוך %d מילים = %.0f מתוך 100"
          % (after, words, pct(after)))
    print("  ההפרש:             %d מילים = %.0f נקודות" % (fixable, pct(fixable)))
    print()
    print("  לשם השוואה, הרף למבחן מסוג החומר הזה: 83 מתוך 100.")
    print("  (המספר המפורסם, 91, הוא ממוצע של חמישה מבחנים שונים —")
    print("   מ-95 על דיבור נקי ועד 83 על משפטי ויקיפדיה עם שמות לועזיים,")
    print("   וזה מה שיש אצלנו.)")
    print()

    for k in ORDER:
        if not groups[k]:
            continue
        print("-" * 72)
        print("%s  (%d מילים)" % (LABELS[k], len(groups[k])))
        for clip, r, h in groups[k][:show]:
            print("   %-16s  %-22s ->  %s" % (clip, r, h))
        if len(groups[k]) > show:
            print("   ... ועוד %d" % (len(groups[k]) - show))
        print()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", type=int, default=20,
                    help="כמה דוגמאות להציג מכל קבוצה")
    sys.exit(main(ap.parse_args().show))

# -*- coding: utf-8 -*-
"""בודק איך המנוע מתנהג על קובץ ארוך.

מה נבדק כאן, ולמה דווקא זה
--------------------------
על קובץ ארוך הכישלונות אינם "טעה במילה". הם אחרים, והם חמורים
יותר, כי הם שקטים — התמלול חוזר מלא וקריא, ורק מי שמשווה לשמע
מגלה שחסר בו רבע שעה:

    דילוג      חלק מהשמע לא תומלל בכלל. בתמלול זה לא נראה.
    לולאה      המנוע נתקע וחוזר על אותו משפט שוב ושוב.
    התדרדרות   הסוף גרוע מההתחלה, כי כל קטע נשען על קודמו.
    איטיות     קובץ של שעתיים שלוקח שעתיים אינו שימושי.

מה לא נבדק כאן
--------------
שיעור דיוק. הפרוטוקול של הכנסת ערוך ואינו מילה במילה, והמודל
אומן על ועדות הכנסת. כל מספר דיוק שייצא מכאן יהיה חסר משמעות,
ולכן הוא לא מחושב — עדיף בלי מספר מאשר מספר שמטעה.

שימוש
-----
    python scripts/long_audio_check.py benchmark_private/knesset/2245389
"""
from __future__ import annotations

import io
import json
import os
import sys
import time
from collections import Counter

sys.path.insert(0, "scripts")
import regression_check as rc  # noqa: E402

rc.require_project_python()
rc.add_gpu_dll_dirs()

from faster_whisper import WhisperModel  # noqa: E402

MODEL = "ivrit-ai/whisper-large-v3-ct2"

# פער שמעליו אנחנו מניחים שהמנוע דילג, ולא שהייתה שתיקה.
GAP_SECONDS = 20.0

# משפט שחוזר יותר מזה הוא כמעט תמיד לולאה, לא דיבור.
REPEAT_LIMIT = 4


def machine_state():
    """מצב המחשב בזמן המדידה.

    בלי זה מספר המהירות חסר משמעות: אותו קובץ יכול לקחת פי עשרה
    כשכרטיס המסך תפוס בתהליך אחר, וזה נראה כמו רגרסיה.
    """
    import subprocess
    out = {}
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=20)
        used, total = 0, 0
        parts = r.stdout.strip().split(",")
        if len(parts) >= 3:
            out["ניצול כרטיס המסך באחוזים"] = int(parts[0])
            used, total = int(parts[1]), int(parts[2])
            out["זיכרון כרטיס המסך"] = "%d מתוך %d" % (used, total)
            out["כרטיס המסך עמוס"] = used > total * 0.5
    except Exception:
        out["כרטיס המסך"] = "לא נקרא"
    return out


def analyse(folder):
    wav = os.path.join(folder, "audio.wav")
    if not os.path.exists(wav):
        print("אין קובץ שמע ב-%s" % folder)
        return 1

    meta_path = os.path.join(folder, "meta.json")
    meta = json.load(io.open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}

    print("מצב המחשב לפני המדידה:")
    for k, v in machine_state().items():
        print("   %-32s %s" % (k, v))
    print()

    print("טוען את המנוע...")
    model = WhisperModel(MODEL, device="cuda", compute_type="float16")

    print("מתמלל...")
    t0 = time.time()
    segs, info = model.transcribe(wav, language="he")
    segs = list(segs)
    elapsed = time.time() - t0

    dur = info.duration
    text = " ".join(s.text.strip() for s in segs)
    words = rc.normalise(text)

    print()
    print("=" * 70)
    print("מהירות")
    print("=" * 70)
    print("  אורך השמע:        %.1f דקות" % (dur / 60))
    print("  זמן העיבוד:       %.1f דקות" % (elapsed / 60))
    print("  יחס:              %.3f  (כל שנייה של שמע עולה כך בעיבוד)" % (elapsed / dur))
    print("  מהירות:           פי %.1f מהזמן האמיתי" % (dur / elapsed))
    print()

    # ---------------------------------------------------------- כיסוי
    print("=" * 70)
    print("כיסוי — האם משהו לא תומלל")
    print("=" * 70)
    covered = sum(s.end - s.start for s in segs)
    gaps = []
    prev_end = 0.0
    for s in segs:
        if s.start - prev_end >= GAP_SECONDS:
            gaps.append((prev_end, s.start))
        prev_end = max(prev_end, s.end)
    if dur - prev_end >= GAP_SECONDS:
        gaps.append((prev_end, dur))

    print("  קטעים שיצאו:      %d" % len(segs))
    print("  מילים:            %d" % len(words))
    print("  זמן מכוסה:        %.1f מתוך %.1f דקות  (%.1f%%)"
          % (covered / 60, dur / 60, 100.0 * covered / dur))
    if gaps:
        print("  >>> נמצאו %d פערים מעל %d שניות:" % (len(gaps), GAP_SECONDS))
        for a, b in gaps[:10]:
            print("        מדקה %.1f עד %.1f  (%.0f שניות)" % (a / 60, b / 60, b - a))
        if len(gaps) > 10:
            print("        ... ועוד %d" % (len(gaps) - 10))
    else:
        print("  אין פערים — שום חלק מהשמע לא נשמט.")
    print()

    # ---------------------------------------------------------- לולאות
    print("=" * 70)
    print("יציבות — האם המנוע נתקע וחזר על עצמו")
    print("=" * 70)
    norm = [" ".join(rc.normalise(s.text)) for s in segs]
    repeats = Counter(t for t in norm if len(t.split()) >= 3)
    loops = [(t, c) for t, c in repeats.items() if c > REPEAT_LIMIT]
    runs = []
    run_start, run_len = 0, 1
    for i in range(1, len(norm)):
        if norm[i] and norm[i] == norm[i - 1]:
            run_len += 1
        else:
            if run_len >= 3:
                runs.append((segs[run_start].start, run_len, norm[run_start]))
            run_start, run_len = i, 1

    if not loops and not runs:
        print("  לא נמצאו לולאות.")
    else:
        for t, c in sorted(loops, key=lambda x: -x[1])[:5]:
            print("  משפט שחזר %d פעמים: %s" % (c, t[:70]))
        for start, n, t in runs[:5]:
            print("  %d חזרות רצופות בדקה %.1f: %s" % (n, start / 60, t[:60]))
    print()

    # ------------------------------------------------------ התדרדרות
    print("=" * 70)
    print("האם הסוף גרוע מההתחלה")
    print("=" * 70)
    third = dur / 3.0
    parts = [[], [], []]
    for s in segs:
        parts[min(2, int(s.start // third))].append(s)
    names = ["שליש ראשון", "שליש אמצעי", "שליש אחרון"]
    for name, group in zip(names, parts):
        if not group:
            print("  %-14s אין קטעים כלל" % name)
            continue
        span = sum(g.end - g.start for g in group)
        wc = sum(len(rc.normalise(g.text)) for g in group)
        print("  %-14s %4d קטעים · %5d מילים · %.2f מילים לשנייה"
              % (name, len(group), wc, wc / span if span else 0))
    print()

    # ------------------------------------------- מול הפרוטוקול, בזהירות
    proto = os.path.join(folder, "protocol.txt")
    if os.path.exists(proto):
        pwords = rc.normalise(io.open(proto, encoding="utf-8").read())
        print("=" * 70)
        print("מול הפרוטוקול הרשמי")
        print("=" * 70)
        print("  מילים בפרוטוקול: %d  (הישיבה המלאה)" % len(pwords))
        print("  מילים בתמלול:    %d  (%.1f הדקות שהורדנו)" % (len(words), dur / 60))
        full = meta.get("audio_seconds")
        if meta.get("truncated_to_minutes"):
            print()
            print("  שימו לב: הורדנו רק חלק מהישיבה, והפרוטוקול הוא של כולה.")
            print("  לכן אי אפשר להשוות את המספרים האלה ישירות.")
        print()
        print("  אין כאן שיעור דיוק, בכוונה: הפרוטוקול ערוך ואינו מילה")
        print("  במילה, והמודל אומן על ועדות הכנסת. מספר דיוק מכאן היה")
        print("  מטעה לשני הכיוונים.")
    print()

    out = os.path.join(folder, "transcript.txt")
    io.open(out, "w", encoding="utf-8").write(text)
    print("התמלול המלא נשמר ב-%s" % out)
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(analyse(sys.argv[1]))

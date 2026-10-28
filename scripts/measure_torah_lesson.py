# -*- coding: utf-8 -*-
"""מדידת שיעורי תורה, עם יומן והשוואה לשיא.

עד היום היה מספר לעברית רגילה בלבד — שמונים אחוז על חדשות. על שיעור
תורה לא היה כלום, וכל שינוי נבחן בעין: "נראה לי יותר טוב".

כאן נמדד מול תמלול שתוקן ואושר ביד: כמה מהמילים שנאמרו באמת יצאו
נכון. התוצאה נרשמת ביומן המדידות של הפרויקט, ומושווית **לשיא
ההיסטורי** ולא למדידה הקודמת — אחרת אפשר לסגת פעמיים ברציפות
ולחשוב שהשתפרנו.

    python scripts/measure_torah_lesson.py                    כל המנועים
    python scripts/measure_torah_lesson.py --only "מהיר"       מנוע אחד
    python scripts/measure_torah_lesson.py --hotwords "קדירה, בליעות"
    python scripts/measure_torah_lesson.py --label "עם מונחים"
    python scripts/measure_torah_lesson.py --history           ההיסטוריה
"""
import argparse
import glob
import hashlib
import json
import os
import re
import sys
import unicodedata
from difflib import SequenceMatcher

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APPROVED = os.path.join(ROOT, "benchmark_private", "approved")
AUDIO = os.path.join(ROOT, "benchmark_private", "audio")
SERVER = os.environ.get("WHISPER_SERVER", "http://127.0.0.1:3000")
TOPIC = "torah-lesson"

sys.path.insert(0, os.path.join(ROOT, "scripts"))

ENGINES = {
    "מדויק": {
        "model": "ivrit-ai/whisper-large-v3-ct2",
        "fast_mode": "0", "beam_size": "5", "preset": "accurate",
    },
    "מהיר": {
        "model": "ivrit-ai/whisper-large-v3-turbo-ct2",
        "fast_mode": "1", "preset": "balanced",
    },
    "כללי": {
        "model": "large-v3-turbo",
        "fast_mode": "1", "preset": "balanced",
    },
    # ההגייה האשכנזית קרובה פונטית ליידיש, והמודל הזה אומן עליה.
    "יידיש": {
        "model": "ivrit-ai/yi-whisper-large-v3-ct2",
        "fast_mode": "0", "beam_size": "5", "preset": "accurate",
    },
}


def norm(text):
    """משווים מילים, בלי ניקוד ובלי פיסוק."""
    t = unicodedata.normalize("NFKC", text or "")
    t = re.sub(r"[֑-ׇ]", "", t)
    t = re.sub(r"[׳״\"']", "", t)
    t = re.sub(r"[^\w\s֐-׿]", " ", t)
    return [w for w in t.split() if w]


def hits(truth, guess):
    """כמה מילים מהאמת יצאו נכון, ובאותו סדר."""
    a, b = norm(truth), norm(guess)
    m = SequenceMatcher(None, a, b, autojunk=False)
    return sum(x.size for x in m.get_matching_blocks()), len(a)


def fingerprint(clips):
    """טביעת אצבע של החומר. שתי מדידות על קבצים שונים אינן בנות השוואה."""
    h = hashlib.sha256()
    for c in sorted(clips, key=lambda x: x["name"]):
        h.update((c["name"] + "|" + c["text"]).encode("utf-8"))
    return f"shiur-{len(clips)}-{h.hexdigest()[:8]}"


def transcribe(path, cfg, hotwords=None):
    data = {"language": "he"}
    data.update(cfg)
    if hotwords:
        data["hotwords"] = hotwords
    with open(path, "rb") as f:
        r = requests.post(SERVER + "/transcribe-stream",
                          files={"file": (os.path.basename(path), f, "audio/wav")},
                          data=data, stream=True, timeout=900)
    for line in r.iter_lines(decode_unicode=True):
        if line and line.startswith("data: "):
            e = json.loads(line[6:])
            if e["type"] == "done":
                return e.get("text", "")
            if e["type"] == "error":
                raise RuntimeError(e.get("error"))
    return ""


def load_clips():
    files = sorted(glob.glob(os.path.join(APPROVED, "shiur_siman93_*.json")))
    if not files:
        sys.exit("אין קטעים מאושרים. אשר קטעים בדף התיקון קודם.")
    return [json.load(open(f, encoding="utf-8")) for f in files]


def show_history():
    from regression_check import read_journal, TOPICS
    rows = [r for r in read_journal() if r.get("topic") == TOPIC]
    if not rows:
        print("אין עדיין מדידות לשיעורי תורה.")
        return
    best = max(rows, key=lambda r: r.get("percent") or 0)
    print(f"היסטוריית {TOPICS.get(TOPIC, TOPIC)} — {len(rows)} מדידות\n")
    for r in rows:
        star = "  ← השיא" if r is best else ""
        print(f"  {r['stamp']}  {r.get('percent'):>6.2f}%  "
              f"{r.get('correct')}/{r.get('words')}  {r['label']}{star}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--only", help="שם מנוע אחד: מדויק / מהיר / כללי")
    p.add_argument("--hotwords", help="מילות הטיה לבדיקה")
    p.add_argument("--label", help="שם המדידה ביומן")
    p.add_argument("--history", action="store_true", help="מציג את ההיסטוריה ויוצא")
    p.add_argument("--no-journal", action="store_true", help="בלי רישום")
    p.add_argument("--extra", action="append", default=[],
                   help="הגדרה נוספת, בצורה שם=ערך. אפשר כמה פעמים")
    a = p.parse_args()

    if a.history:
        show_history()
        return

    clips = load_clips()
    mark = fingerprint(clips)
    words = sum(len(norm(c["text"])) for c in clips)
    print(f"אבן הבוחן: {len(clips)} קטעים, {words} מילים שתוקנו ביד")
    print(f"טביעת אצבע: {mark}\n")

    engines = {a.only: dict(ENGINES[a.only])} if a.only else {k: dict(v) for k, v in ENGINES.items()}
    for item in a.extra:
        k, _, v = item.partition("=")
        for cfg in engines.values():
            cfg[k.strip()] = v.strip()
    results = {}
    for label, cfg in engines.items():
        tot = total = 0
        rows = []
        for c in clips:
            got = transcribe(os.path.join(AUDIO, c["audio"]), cfg, a.hotwords)
            h, n = hits(c["text"], got)
            tot += h
            total += n
            rows.append((c["name"][-3:], h, n))
        pct = 100.0 * tot / total if total else 0
        results[label] = (tot, total, pct)
        print(f"{label}: {tot} מתוך {total} = {pct:.1f} אחוז")
        for name, h, n in rows:
            print(f"   {name}  {h:3d}/{n:3d}  {100*h/n:5.1f}%")
        print()

    if len(results) > 1:
        best = max(results.items(), key=lambda x: x[1][2])
        print(f"הטוב ביותר: {best[0]} — {best[1][2]:.1f} אחוז\n")

    if a.no_journal:
        return

    # ── רישום והשוואה לשיא ──
    from regression_check import record_simple, read_journal

    name, (tot, total, pct) = max(results.items(), key=lambda x: x[1][2])
    label = a.label or (f"{name}" + (" + מונחים" if a.hotwords else ""))
    extra = {"engine": name}
    if a.hotwords:
        extra["hotwords"] = a.hotwords

    prev = [r for r in read_journal()
            if r.get("topic") == TOPIC and r.get("benchmark") == mark]
    record_simple(label, TOPIC, tot, total, benchmark=mark, extra=extra)

    if prev:
        peak = max(prev, key=lambda r: r.get("percent") or 0)
        d = pct - (peak.get("percent") or 0)
        print()
        print(f"השיא עד כה: {peak['percent']:.2f} אחוז  ({peak['label']}, {peak['stamp']})")
        if d > 0.05:
            print(f"שיא חדש: {d:+.2f} נקודות אחוז")
        elif d < -0.05:
            print(f"נסיגה מהשיא: {d:+.2f} נקודות אחוז")
        else:
            print("ללא שינוי מהשיא")
    else:
        print("\nזאת המדידה הראשונה על החומר הזה — היא קו הבסיס.")


if __name__ == "__main__":
    main()

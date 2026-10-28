# -*- coding: utf-8 -*-
"""בונה אבן בוחן לשיעורי תורה מתוך הקלטה אמיתית.

למה זה נחוץ
------------
יש לנו אבן בוחן לעברית רגילה — חדשות — ועליה המנוע מצליח בשמונים
אחוז. על שיעור תורה אין לנו שום מספר, ולכן כל שינוי נמדד בעין:
"נראה לי יותר טוב". זה לא מספיק כדי לדעת אם אימון המנוע עזר או הזיק.

התקלה שזה מונע: לאמן, להסתכל על התוצאה, להתרשם שהשתפר — ולגלות
חודש אחר כך שדווקא נסוגנו. בלי מספר אי אפשר לדעת.

איך זה עובד
------------
לוקחים הקלטה אמיתית, חותכים ממנה קטעים קצרים, מתמללים אותם במנוע
הטוב ביותר שיש — וזה **טיוטה בלבד**. אחר כך בן אדם מתקן את הטקסט,
והתיקון שלו הוא האמת שמולה מודדים מכאן והלאה.

למה דווקא קטעים קצרים: קטע ארוך שבור בהתחלה גורר את כל השאר, ואז
מספר אחד מסתיר את מה שבאמת קרה. קטעים קצרים מראים איפה בדיוק נשבר.

חשוב: אסור למדוד על חומר שאימנו עליו. הקטעים כאן נועדו למדידה בלבד.

הרצה
-----
    python scripts/build_lesson_benchmark.py <קובץ שמע> <שם> [--clips 20]

נוצרים:
    benchmark_private/audio/<שם>_NNN.wav      קטעי השמע
    benchmark_private/pending/<שם>.txt        הטיוטה לתיקון
אחרי התיקון:
    python scripts/build_lesson_benchmark.py --approve <שם>
"""
import argparse
import json
import os
import subprocess
import sys

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(ROOT, "benchmark_private", "audio")
PENDING_DIR = os.path.join(ROOT, "benchmark_private", "pending")
APPROVED_DIR = os.path.join(ROOT, "benchmark_private", "approved")
SERVER = os.environ.get("WHISPER_SERVER", "http://127.0.0.1:3000")

# המנוע הטוב ביותר שנמדד לשיעורים. הטיוטה טובה יותר — פחות לתקן.
BEST = {
    "model": "ivrit-ai/whisper-large-v3-ct2",
    "fast_mode": "0",
    "beam_size": "5",
    "preset": "accurate",
    "language": "he",
}

# אורך קטע. מספיק כדי שיהיה משפט שלם, קצר מספיק כדי שתקלה אחת
# לא תגרור את כל השאר.
CLIP_SECONDS = 15

# מדלגים על ההתחלה: בשיעורים היא כמעט תמיד רעש, כיסאות והתארגנות.
SKIP_START_SECONDS = 120


def probe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def cut(src, dst, start, seconds):
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(start), "-t", str(seconds), "-i", src,
         "-ar", "16000", "-ac", "1", dst],
        capture_output=True, check=True)


def transcribe(path):
    with open(path, "rb") as f:
        r = requests.post(f"{SERVER}/transcribe-stream",
                          files={"file": (os.path.basename(path), f, "audio/wav")},
                          data=dict(BEST), stream=True, timeout=1800)
    for line in r.iter_lines(decode_unicode=True):
        if line and line.startswith("data: "):
            e = json.loads(line[6:])
            if e["type"] == "done":
                return e.get("text", "").strip()
            if e["type"] == "error":
                raise RuntimeError(e.get("error"))
    return ""


def build(source, name, clips):
    os.makedirs(AUDIO_DIR, exist_ok=True)
    os.makedirs(PENDING_DIR, exist_ok=True)

    total = probe_duration(source)
    usable = total - SKIP_START_SECONDS
    if usable < clips * CLIP_SECONDS:
        clips = max(1, int(usable // CLIP_SECONDS))
        print(f"ההקלטה קצרה — יורדים ל-{clips} קטעים")

    # פרוסים על פני כל ההקלטה ולא רצופים, כדי שלא ימדדו דקה אחת
    # מקרית אלא את השיעור כולו.
    step = usable / clips
    lines = []
    for i in range(clips):
        start = SKIP_START_SECONDS + i * step
        clip_name = f"{name}_{i+1:03d}"
        wav = os.path.join(AUDIO_DIR, clip_name + ".wav")
        cut(source, wav, start, CLIP_SECONDS)
        text = transcribe(wav)
        lines.append((clip_name, round(start, 1), text))
        print(f"  {clip_name}  {int(start//60):02d}:{int(start%60):02d}  {text[:60]}")

    out = os.path.join(PENDING_DIR, name + ".txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write("# תיקון אבן הבוחן — שיעור תורה\n")
        f.write("#\n")
        f.write("# כל שורה היא קטע של 15 שניות. השמע נמצא ב-benchmark_private/audio.\n")
        f.write("# תקן את הטקסט אחרי הסימן | כך שיהיה בדיוק מה שנאמר.\n")
        f.write("# מה שכתוב עכשיו הוא ניחוש של המנוע — הוא ישגה, וזאת כל הנקודה.\n")
        f.write("# שורה שאי אפשר לתקן (רעש, דיבור חתוך) — מחק אותה לגמרי.\n")
        f.write("#\n")
        f.write("# אל תוסיף פיסוק שלא נאמר, ואל תתקן שפה. רק מה שהאוזן שומעת.\n")
        f.write("#\n")
        for clip_name, start, text in lines:
            f.write(f"{clip_name} [{int(start//60):02d}:{int(start%60):02d}] | {text}\n")

    print(f"\nנוצרו {len(lines)} קטעים.")
    print(f"הקובץ לתיקון: {out}")
    print(f"אחרי התיקון:  python scripts/build_lesson_benchmark.py --approve {name}")


def approve(name):
    src = os.path.join(PENDING_DIR, name + ".txt")
    if not os.path.exists(src):
        sys.exit(f"אין קובץ מתוקן ב-{src}")
    os.makedirs(APPROVED_DIR, exist_ok=True)

    kept = 0
    for raw in open(src, encoding="utf-8"):
        raw = raw.strip()
        if not raw or raw.startswith("#") or "|" not in raw:
            continue
        head, text = raw.split("|", 1)
        clip_name = head.split("[")[0].strip()
        text = text.strip()
        if not text:
            continue
        wav = os.path.join(AUDIO_DIR, clip_name + ".wav")
        if not os.path.exists(wav):
            print(f"  מדלג על {clip_name} — אין קובץ שמע")
            continue
        seconds = probe_duration(wav)
        words = len(text.split())
        meta = {
            "name": clip_name,
            "tier": "torah-lesson",
            "audio": clip_name + ".wav",
            "seconds": round(seconds, 2),
            "words": words,
            "words_per_second": round(words / seconds, 2) if seconds else 0,
            "text": text,
            "source": "שיעור אמיתי — תמלול שתוקן ביד",
        }
        with open(os.path.join(APPROVED_DIR, clip_name + ".json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        kept += 1

    print(f"אושרו {kept} קטעים כאבן בוחן לשיעורי תורה.")
    print("מעכשיו אפשר למדוד כל שינוי מולם.")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("source", nargs="?", help="קובץ השמע של השיעור")
    p.add_argument("name", nargs="?", help="שם קצר באנגלית, למשל shiur_siman93")
    p.add_argument("--clips", type=int, default=20)
    p.add_argument("--approve", metavar="שם", help="לאחר תיקון הקובץ")
    a = p.parse_args()

    if a.approve:
        approve(a.approve)
    elif a.source and a.name:
        build(a.source, a.name, a.clips)
    else:
        p.print_help()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""הורדת מנוע ההקראה BlueTTS 2.5.

    BlueTTS2.5-onnx   כ-282 מגה  — ההקראה עצמה. בלעדיו אין כלום.

לשכפול קול ולניקוד אוטומטי יש תסריט נפרד:

    python scripts/download_tts_extras.py

ההורדה מדווחת לקובץ יומן, כדי שאפשר יהיה לעקוב בלי לחכות.

    python scripts/download_bluetts.py
"""
import argparse
import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server", "models")

#: מנוע ההקראה בלבד.
#:
#: המחסן notmax123/blue-v2 הוסר מכאן ב-24 באוקטובר 2026. הוא שוקל 422
#: מגה, והורד מתוך הנחה שצריך את המקודד בגרסה הכבדה כדי לשכפל קול.
#: ההנחה הופרכה: יש גרף מוכן בשם codec_encoder.onnx ששוקל 102 מגה
#: ועושה בדיוק את זה, כולל הקיפול והנרמול. הוא מורד על ידי התסריט
#: download_tts_extras.py.
REPOS = [
    ("notmax123/BlueTTS2.5-onnx", "bluetts25", 282),
]


def human(n):
    return f"{n / 1e6:.1f} מגה"


def dir_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def download(repo_id, folder, expected_mb):
    from huggingface_hub import snapshot_download

    dest = os.path.join(BASE, folder)
    os.makedirs(dest, exist_ok=True)
    before = dir_size(dest)
    print(f"[{time.strftime('%H:%M:%S')}] מוריד {repo_id} (כ-{expected_mb} מגה) אל {dest}")
    print(f"    כבר קיים בתיקייה: {human(before)}")
    sys.stdout.flush()

    started = time.time()
    # local_dir ולא המחסן המשותף: אנחנו רוצים את הקבצים בתוך הפרויקט,
    # כדי שהשרת ימצא אותם בנתיב קבוע ולא יהיה תלוי במחסן של המשתמש.
    snapshot_download(
        repo_id=repo_id,
        local_dir=dest,
        max_workers=4,
    )
    took = time.time() - started
    after = dir_size(dest)
    print(f"[{time.strftime('%H:%M:%S')}] הסתיים. בתיקייה כעת {human(after)} "
          f"(נוספו {human(after - before)}) בתוך {took:.0f} שניות")
    sys.stdout.flush()
    return after


def main():
    ap = argparse.ArgumentParser(description="הורדת מנוע ההקראה")
    ap.parse_args()

    repos = REPOS
    total = 0
    for repo_id, folder, mb in repos:
        try:
            total += download(repo_id, folder, mb)
        except Exception as exc:
            print(f"!! נכשל {repo_id}: {type(exc).__name__}: {exc}")
            sys.stdout.flush()
            return 1

    print(f"== סך הכל על הכונן: {human(total)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

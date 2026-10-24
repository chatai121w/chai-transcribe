#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""האם לחץ על זיכרון הכרטיס הוא מה שהאט את התמלול פי שלושה עשר.

ההשערה:
    לכרטיס שמונה ג׳יגה. המנוע תופס כשלושה. בזמן המדידה האיטית רצו
    במקביל שרת ההפעלה והדפדפן, ושניהם משתמשים בכרטיס.

    כשזיכרון הכרטיס נגמר, ווינדוס אינה נכשלת — היא **גולשת לזיכרון
    המערכת הרגיל**. זה עובד, אבל איטי בסדר גודל. זה בדיוק סוג
    הכשל שמסביר פי שלושה עשר בלי שום הודעת שגיאה.

הניסוי:
    מודדים את אותם קטעים פעמיים: פעם כשהכרטיס פנוי, ופעם כשתופסים
    בכוונה חלק גדול מהזיכרון שלו. אם ההאטה חוזרת — ההשערה אושרה.

    python scripts/gpu_pressure_test.py
"""
import argparse
import glob
import io
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BENCH_DIR = os.path.join(HERE, "benchmark_private", "approved")
AUDIO_DIR = os.path.join(HERE, "benchmark_private", "audio")


def gpu_mem():
    """כמה זיכרון תפוס ופנוי בכרטיס, במגה."""
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5)
        used, total = [float(x.strip()) for x in r.stdout.strip().split(",")]
        return used, total
    except Exception:
        return None, None


def load_clips(limit):
    out = []
    for p in sorted(glob.glob(os.path.join(BENCH_DIR, "*.json")))[:limit]:
        m = json.load(io.open(p, encoding="utf-8"))
        a = os.path.join(AUDIO_DIR, m["audio"])
        if os.path.exists(a):
            out.append((m["name"], a, float(m.get("seconds", 0) or 0)))
    return out


def transcribe_all(model, clips, label):
    used, total = gpu_mem()
    print(f"\n  {label}")
    print(f"     זיכרון הכרטיס לפני: {used:.0f} מתוך {total:.0f} מגה "
          f"({total - used:.0f} פנוי)")
    t0 = time.time()
    audio = 0.0
    for name, path, secs in clips:
        segs, _ = model.transcribe(path, language="he", beam_size=5,
                                   vad_filter=False)
        _ = " ".join(s.text for s in segs)
        audio += secs
    took = time.time() - t0
    used2, _ = gpu_mem()
    print(f"     זיכרון בשיא:        {used2:.0f} מגה")
    print(f"     {audio:.1f} שניות שמע ב-{took:.1f} שניות — יחס {took/audio:.3f}")
    return took / audio


def main():
    ap = argparse.ArgumentParser(description="בדיקת לחץ זיכרון בכרטיס")
    ap.add_argument("--limit", type=int, default=6)
    ap.add_argument("--hog-gb", type=float, default=4.0,
                    help="כמה ג׳יגה לתפוס בכוונה")
    args = ap.parse_args()

    print("=" * 74)
    print("האם לחץ על זיכרון הכרטיס מאט את התמלול")
    print("=" * 74)

    import torch
    from faster_whisper import WhisperModel

    clips = load_clips(args.limit)
    print(f"\n{len(clips)} קטעים, {sum(c[2] for c in clips):.0f} שניות שמע.")

    used, total = gpu_mem()
    print(f"זיכרון הכרטיס: {used:.0f} מתוך {total:.0f} מגה תפוס.")

    print("\nטוען את המנוע...")
    t0 = time.time()
    model = WhisperModel("ivrit-ai/whisper-large-v3-ct2",
                         device="cuda", compute_type="float16")
    print(f"  נטען ב-{time.time() - t0:.1f} שניות")

    # --- חימום, כדי שהמדידה לא תכלול בניית גרעינים חד-פעמית
    print("\nחימום...")
    segs, _ = model.transcribe(clips[0][1], language="he", beam_size=5,
                               vad_filter=False)
    _ = " ".join(s.text for s in segs)

    print("\n" + "-" * 74)
    print("שלב 1 — הכרטיס פנוי")
    print("-" * 74)
    free_ratio = transcribe_all(model, clips, "בלי לחץ")

    # --- תופסים זיכרון בכוונה
    print("\n" + "-" * 74)
    print(f"שלב 2 — תופסים {args.hog_gb} ג׳יגה בכוונה")
    print("-" * 74)
    hogs = []
    try:
        n = int(args.hog_gb * 1024 ** 3 / 2)   # חצי דיוק, שני בתים לערך
        hogs.append(torch.empty(n, dtype=torch.float16, device="cuda"))
        torch.cuda.synchronize()
        u, t = gpu_mem()
        print(f"  נתפסו. זיכרון כעת: {u:.0f} מתוך {t:.0f} מגה "
              f"({t - u:.0f} פנוי)")
    except Exception as e:
        print(f"  לא ניתן לתפוס: {type(e).__name__}: {str(e)[:120]}")
        print("  הכרטיס כנראה כבר מלא. זה כשלעצמו ממצא.")

    pressure_ratio = transcribe_all(model, clips, "תחת לחץ")

    # --- משחררים ומודדים שוב, כדי לוודא שזה חוזר
    print("\n" + "-" * 74)
    print("שלב 3 — משחררים וחוזרים")
    print("-" * 74)
    hogs.clear()
    torch.cuda.empty_cache()
    torch.cuda.synchronize()
    back_ratio = transcribe_all(model, clips, "אחרי השחרור")

    print("\n" + "=" * 74)
    print("מסקנה")
    print("=" * 74)
    print(f"  בלי לחץ:      יחס {free_ratio:.3f}")
    print(f"  תחת לחץ:      יחס {pressure_ratio:.3f}")
    print(f"  אחרי השחרור:  יחס {back_ratio:.3f}")
    print()
    if pressure_ratio > free_ratio * 1.8:
        print(f"  ההשערה אושרה: לחץ על זיכרון הכרטיס מאט פי "
              f"{pressure_ratio / free_ratio:.1f}.")
        print("  כשהזיכרון נגמר ווינדוס גולשת לזיכרון המערכת, וזה איטי")
        print("  בסדר גודל — בלי שום הודעת שגיאה.")
        if back_ratio < pressure_ratio * 0.7:
            print("  ואחרי השחרור המהירות חוזרת, מה שמחזק את ההסבר.")
    elif pressure_ratio > free_ratio * 1.2:
        print(f"  לחץ מאט פי {pressure_ratio / free_ratio:.1f} — השפעה קיימת")
        print("  אבל קטנה מכדי להסביר פי שלושה עשר. יש גורם נוסף.")
    else:
        print("  ההשערה הופרכה: לחץ על הזיכרון כמעט אינו משפיע.")
        print("  הסיבה להאטה שנצפתה היא משהו אחר.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

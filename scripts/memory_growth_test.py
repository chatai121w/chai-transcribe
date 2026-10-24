#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""האם זיכרון הכרטיס תופח לאורך העבודה, ובכך מאט אותה.

מה שנצפה:
    שלושה ניסויים ברצף על אותם קטעים. בשניים הראשונים הזיכרון נשאר
    סביב 4200 מגה והיחס היה 0.22. בשלישי הזיכרון תפח ל-7889 מתוך
    8151 — כמעט הגבול — והיחס קפץ ל-0.70.

ההשערה:
    הזיכרון בכרטיס אינו משוחרר בין תמלול לתמלול, אלא מצטבר. כשהוא
    מתקרב לגבול, ווינדוס אינה נכשלת — היא גולשת לזיכרון המערכת
    הרגיל. זה עובד, אבל איטי בסדר גודל, ובלי שום הודעת שגיאה.

    אם זה נכון, זה מסביר גם את המדידה המקורית: עשרים קטעים ברצף,
    הזיכרון תופח, והיחס מגיע ל-3.2 במקום 0.22.

הניסוי:
    מתמללים עשרים קטעים ברצף, ומודדים אחרי **כל אחד** גם את הזמן
    וגם את הזיכרון התפוס. אם השניים עולים יחד — ההשערה אושרה.

    python scripts/memory_growth_test.py
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


def gpu():
    """זיכרון, חום ותדר בכרטיס."""
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total,"
             "temperature.gpu,clocks.sm,utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5)
        p = [float(x.strip()) for x in r.stdout.strip().split(",")]
        return {"used": p[0], "total": p[1], "temp": p[2],
                "clock": p[3], "util": p[4]}
    except Exception:
        return None


def load_clips(limit):
    out = []
    for p in sorted(glob.glob(os.path.join(BENCH_DIR, "*.json")))[:limit]:
        m = json.load(io.open(p, encoding="utf-8"))
        a = os.path.join(AUDIO_DIR, m["audio"])
        if os.path.exists(a):
            out.append((m["name"], a, float(m.get("seconds", 0) or 0)))
    return out


def main():
    ap = argparse.ArgumentParser(description="בדיקת תפיחת זיכרון בכרטיס")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--free-every", type=int, default=0,
                    help="לשחרר את הזיכרון כל כמה קטעים. אפס פירושו בכלל לא")
    args = ap.parse_args()

    print("=" * 78)
    print("האם זיכרון הכרטיס תופח ומאט את העבודה")
    print("=" * 78)

    import torch
    from faster_whisper import WhisperModel

    clips = load_clips(args.limit)
    g0 = gpu()
    print(f"\nלפני הטעינה: {g0['used']:.0f} מתוך {g0['total']:.0f} מגה תפוס")

    t0 = time.time()
    model = WhisperModel("ivrit-ai/whisper-large-v3-ct2",
                         device="cuda", compute_type="float16")
    g1 = gpu()
    print(f"אחרי הטעינה: {g1['used']:.0f} מגה  (המנוע תפס "
          f"{g1['used'] - g0['used']:.0f}) · נטען ב-{time.time()-t0:.1f} שניות")

    print(f"\n{len(clips)} קטעים, {sum(c[2] for c in clips):.0f} שניות שמע.")
    if args.free_every:
        print(f"משחררים את הזיכרון כל {args.free_every} קטעים.")
    print()
    print(f"  {'#':>3} {'קטע':18} {'שמע':>6} {'זמן':>7} {'יחס':>6} "
          f"{'זיכרון':>8} {'פנוי':>7} {'חום':>5} {'תדר':>6}")
    print("  " + "-" * 74)

    rows = []
    for i, (name, path, secs) in enumerate(clips, 1):
        t = time.time()
        segs, _ = model.transcribe(path, language="he", beam_size=5,
                                   vad_filter=False)
        _ = " ".join(s.text for s in segs)
        took = time.time() - t
        g = gpu()
        free = g["total"] - g["used"]
        rows.append({"i": i, "name": name, "secs": secs, "took": took,
                     "ratio": took / secs, "used": g["used"], "free": free,
                     "temp": g["temp"], "clock": g["clock"]})
        warn = ""
        if free < 800:
            warn = "  << זיכרון כמעט גמור"
        elif took / secs > 0.5:
            warn = "  << איטי"
        print(f"  {i:3} {name:18} {secs:6.1f} {took:7.2f} {took/secs:6.2f} "
              f"{g['used']:8.0f} {free:7.0f} {g['temp']:5.0f} {g['clock']:6.0f}{warn}")

        if args.free_every and i % args.free_every == 0:
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
            g = gpu()
            print(f"      -- שוחרר. זיכרון כעת {g['used']:.0f} מגה --")

    print()
    print("=" * 78)
    print("ניתוח")
    print("=" * 78)

    first3 = rows[:3]
    last3 = rows[-3:]
    r_first = sum(r["ratio"] for r in first3) / len(first3)
    r_last = sum(r["ratio"] for r in last3) / len(last3)
    m_first = sum(r["used"] for r in first3) / len(first3)
    m_last = sum(r["used"] for r in last3) / len(last3)
    t_first = sum(r["temp"] for r in first3) / len(first3)
    t_last = sum(r["temp"] for r in last3) / len(last3)

    print(f"  שלושת הראשונים:  יחס {r_first:.3f} · זיכרון {m_first:.0f} מגה"
          f" · חום {t_first:.0f}")
    print(f"  שלושת האחרונים:  יחס {r_last:.3f} · זיכרון {m_last:.0f} מגה"
          f" · חום {t_last:.0f}")
    print()
    slow = r_last / r_first if r_first else 0
    grew = m_last - m_first
    print(f"  האטה לאורך הריצה: פי {slow:.1f}")
    print(f"  תפיחת זיכרון:     {grew:+.0f} מגה")
    print(f"  עליית חום:        {t_last - t_first:+.0f} מעלות")
    print()

    min_free = min(r["free"] for r in rows)
    print(f"  הזיכרון הפנוי ירד עד {min_free:.0f} מגה.")

    if slow > 1.5 and grew > 1000:
        print()
        print("  ההשערה אושרה: הזיכרון תופח והמהירות יורדת יחד איתו.")
        print("  ככל שהזיכרון מתמלא, ווינדוס גולשת לזיכרון המערכת — וזה")
        print("  איטי בסדר גודל, בלי שום הודעת שגיאה.")
    elif slow > 1.5 and t_last - t_first > 8:
        print()
        print("  ההאטה קיימת אבל הזיכרון לא תפח במיוחד. החום עלה —")
        print("  כלומר זאת האטה בגלל חום ולא בגלל זיכרון.")
    elif slow > 1.5:
        print()
        print("  יש האטה, אבל לא הזיכרון ולא החום מסבירים אותה.")
    else:
        print()
        print("  אין האטה משמעותית לאורך הריצה בהרצה הזאת.")

    out = os.path.join(HERE, "benchmark_private", "regression",
                       "memory_growth.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({"rows": rows, "free_every": args.free_every},
              io.open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\nהנתונים נשמרו: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

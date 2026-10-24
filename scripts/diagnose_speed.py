#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""אבחון מהירות התמלול.

מה שמחפשים:
    אותה עבודה בדיוק — אותו מנוע, אותם קטעים — נמדדה פעם ב-584
    שניות ופעם ב-45. פי שלושה עשר הבדל. טעינת המנוע אינה ההסבר:
    היא לקחה 12 עד 14 שניות בשתי הפעמים.

    משהו גורם לתמלול להיות איטי פי שלושה עשר, ואנחנו לא יודעים מה.
    כל עוד לא יודעים, כל מדידה של מהירות חסרת ערך — היא עלולה
    למדוד את הגורם הנסתר במקום את מה שרצינו.

מה נבדק:
    1. האם התמלול באמת רץ על הכרטיס, או נופל למעבד.
    2. כמה מהכרטיס מנוצל בזמן התמלול.
    3. האם משהו אחר תופס את הכרטיס.
    4. האם הכרטיס מאט בגלל חום או הגבלת חשמל.
    5. האם הקטע הראשון איטי והשאר מהירים, או שכולם איטיים.
    6. האם הגדרת החיפוש משפיעה.

    python scripts/diagnose_speed.py
"""
import argparse
import glob
import io
import json
import os
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "server"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BENCH_DIR = os.path.join(HERE, "benchmark_private", "approved")
AUDIO_DIR = os.path.join(HERE, "benchmark_private", "audio")


# ------------------------------------------------------- מעקב אחרי הכרטיס

class GpuWatcher:
    """דוגם את מצב הכרטיס ברקע תוך כדי העבודה.

    בלי זה אי אפשר לדעת אם הכרטיס עובד, יושב בטל, או מואט בגלל
    חום. ממוצע אחרי הכל מסתיר את התמונה: צריך לראות את העקומה.
    """

    def __init__(self, interval=0.5):
        self.interval = interval
        self.samples = []
        self._stop = threading.Event()
        self._thread = None

    def _read(self):
        try:
            r = subprocess.run(
                ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,"
                 "temperature.gpu,clocks.sm,power.draw,"
                 "clocks_throttle_reasons.active",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5)
            if r.returncode != 0:
                return None
            parts = [p.strip() for p in r.stdout.strip().split(",")]
            return {
                "util": float(parts[0]), "mem_mb": float(parts[1]),
                "temp": float(parts[2]), "clock": float(parts[3]),
                "power": float(parts[4]) if parts[4] not in ("[N/A]", "") else None,
                "throttle": parts[5] if len(parts) > 5 else "",
                "t": time.time(),
            }
        except Exception:
            return None

    def _loop(self):
        while not self._stop.is_set():
            s = self._read()
            if s:
                self.samples.append(s)
            self._stop.wait(self.interval)

    def __enter__(self):
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *a):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)

    def summary(self):
        if not self.samples:
            return None
        u = [s["util"] for s in self.samples]
        m = [s["mem_mb"] for s in self.samples]
        t = [s["temp"] for s in self.samples]
        c = [s["clock"] for s in self.samples]
        throttles = {s["throttle"] for s in self.samples if s["throttle"]
                     and s["throttle"] not in ("0x0000000000000000", "Not Active")}
        return {
            "samples": len(u),
            "util_avg": round(sum(u) / len(u), 1),
            "util_max": max(u),
            "util_zero_pct": round(100 * sum(1 for x in u if x < 5) / len(u), 1),
            "mem_min": round(min(m)), "mem_max": round(max(m)),
            "temp_min": round(min(t)), "temp_max": round(max(t)),
            "clock_min": round(min(c)), "clock_max": round(max(c)),
            "throttle": sorted(throttles),
        }


def who_uses_gpu():
    """אילו תהליכים תופסים את הכרטיס."""
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-compute-apps=pid,process_name,used_memory",
             "--format=csv,noheader"],
            capture_output=True, text=True, timeout=8)
        if r.returncode != 0:
            return []
        return [l.strip() for l in r.stdout.strip().split("\n") if l.strip()]
    except Exception:
        return []


def gpu_snapshot():
    w = GpuWatcher()
    return w._read()


# ------------------------------------------------------------- הניסויים

def load_clips(limit=None):
    clips = []
    for path in sorted(glob.glob(os.path.join(BENCH_DIR, "*.json"))):
        meta = json.load(io.open(path, encoding="utf-8"))
        audio = os.path.join(AUDIO_DIR, meta["audio"])
        if os.path.exists(audio):
            clips.append((meta["name"], audio, float(meta.get("seconds", 0) or 0)))
    return clips[:limit] if limit else clips


def run_experiment(name, model, clips, **kw):
    """מתמלל ומודד כל קטע בנפרד, עם מעקב אחרי הכרטיס."""
    print(f"\n{'=' * 74}")
    print(f"ניסוי: {name}")
    print("=" * 74)

    times, audio_total = [], 0.0
    with GpuWatcher() as w:
        for i, (cname, path, secs) in enumerate(clips, 1):
            t0 = time.time()
            segments, _info = model.transcribe(path, language="he", **kw)
            _ = " ".join(s.text for s in segments)   # הפענוח עצל
            took = time.time() - t0
            times.append((cname, took, secs))
            audio_total += secs
            flag = ""
            if i == 1:
                flag = "  <- הראשון"
            elif took > (times[0][1] * 1.5) and i > 1:
                flag = "  <- חריג"
            print(f"  {i:2}. {cname:18} {secs:5.1f} שניות שמע -> "
                  f"{took:7.2f} שניות (יחס {took / secs:5.2f}){flag}")

    total = sum(t for _, t, _ in times)
    g = w.summary()
    print(f"\n  סך הכל: {audio_total:.1f} שניות שמע ב-{total:.1f} שניות "
          f"(יחס {total / audio_total:.3f})")
    if g:
        print(f"  הכרטיס: ניצול ממוצע {g['util_avg']}% · שיא {g['util_max']}% · "
              f"בטל {g['util_zero_pct']}% מהזמן")
        print(f"          זיכרון {g['mem_min']} עד {g['mem_max']} מגה · "
              f"חום {g['temp_min']} עד {g['temp_max']} מעלות")
        print(f"          תדר {g['clock_min']} עד {g['clock_max']} מגהרץ")
        if g["throttle"]:
            print(f"          !! האטה פעילה: {', '.join(g['throttle'])}")
    return {"name": name, "total": total, "audio": audio_total,
            "ratio": total / audio_total, "times": times, "gpu": g}


def main():
    ap = argparse.ArgumentParser(description="אבחון מהירות התמלול")
    ap.add_argument("--model", default="ivrit-ai/whisper-large-v3-ct2")
    ap.add_argument("--limit", type=int, default=8)
    args = ap.parse_args()

    print("=" * 74)
    print("אבחון מהירות התמלול")
    print("=" * 74)

    # --- מי תופס את הכרטיס לפני שהתחלנו
    print("\nמצב הכרטיס לפני ההתחלה:")
    snap = gpu_snapshot()
    if snap:
        print(f"  ניצול {snap['util']}% · זיכרון תפוס {snap['mem_mb']:.0f} מגה · "
              f"חום {snap['temp']:.0f} מעלות · תדר {snap['clock']:.0f} מגהרץ")
        if snap.get("throttle") and snap["throttle"] not in ("Not Active", "0x0000000000000000"):
            print(f"  !! האטה פעילה כבר עכשיו: {snap['throttle']}")
    users = who_uses_gpu()
    if users:
        print("  תהליכים שתופסים את הכרטיס:")
        for u in users:
            print("     " + u)
    else:
        print("  אף תהליך אינו תופס את הכרטיס.")

    clips = load_clips(args.limit)
    print(f"\nנבדקים {len(clips)} קטעים, "
          f"{sum(c[2] for c in clips):.0f} שניות שמע.")

    from faster_whisper import WhisperModel

    results = []

    # --- ניסוי 1: כרטיס מסך, ההגדרה הרגילה
    print("\nטוען את המנוע על הכרטיס...")
    t0 = time.time()
    m = WhisperModel(args.model, device="cuda", compute_type="float16")
    print(f"  נטען ב-{time.time() - t0:.1f} שניות")

    results.append(run_experiment("כרטיס · חיפוש רחב 5", m, clips,
                                  beam_size=5, vad_filter=False))

    # --- ניסוי 2: אותו דבר שוב. אם הפעם השנייה מהירה בהרבה,
    #     ההסבר הוא חימום ולא הגדרה.
    results.append(run_experiment("כרטיס · חיפוש רחב 5 · הרצה שנייה", m, clips,
                                  beam_size=5, vad_filter=False))

    # --- ניסוי 3: בלי חיפוש רחב. אם זה מהיר בהרבה, ההגדרה אשמה.
    results.append(run_experiment("כרטיס · בלי חיפוש רחב", m, clips,
                                  beam_size=1, vad_filter=False))

    del m

    print(f"\n{'=' * 74}")
    print("סיכום")
    print("=" * 74)
    for r in results:
        print(f"  {r['name']:38} יחס {r['ratio']:.3f}  "
              f"({r['total']:.0f} שניות)")

    print()
    first, second = results[0], results[1]
    gap = first["ratio"] / second["ratio"] if second["ratio"] else 0
    print("מסקנות:")
    if gap > 1.5:
        print(f"  ההרצה הראשונה איטית פי {gap:.1f} מהשנייה, באותה הגדרה.")
        print("  כלומר יש עלות חד-פעמית שאינה טעינת המנוע — כנראה בניית")
        print("  גרעיני חישוב בפעם הראשונה שהכרטיס נדרש לצורה מסוימת.")
    else:
        print("  ההרצה הראשונה והשנייה דומות. אין עלות חד-פעמית משמעותית.")

    beam = results[2]
    if beam["ratio"] < second["ratio"] * 0.7:
        print(f"  חיפוש רחב מאט פי {second['ratio'] / beam['ratio']:.1f}. "
              "אפשר לשקול להוריד אותו.")

    g = first.get("gpu")
    if g:
        if g["util_avg"] < 30:
            print(f"  הכרטיס מנוצל רק {g['util_avg']}% בממוצע — "
                  "הצוואר אינו בכרטיס.")
        if g["throttle"]:
            print(f"  !! הכרטיס מואט: {', '.join(g['throttle'])}")
        if g["clock_max"] and g["clock_min"] < g["clock_max"] * 0.6:
            print(f"  התדר צנח מ-{g['clock_max']} ל-{g['clock_min']} מגהרץ — "
                  "סימן להאטה בגלל חום או חשמל.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

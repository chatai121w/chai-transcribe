#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ניטור מצב המחשב תוך כדי מדידה.

למה זה הכרחי:
    מדידת מהירות על מחשב עמוס אינה ניתנת להשוואה למדידה על מחשב
    פנוי. אותה עבודה בדיוק נמדדה פעם ב-584 שניות ופעם ב-45 — פי
    שלושה עשר — ובלי לדעת מה רץ במקביל אי אפשר לדעת למה.

    בלי הנתונים האלה, כל מדידת מהירות היא ניחוש. אפשר "לשפר" משהו
    ולראות שיפור שכולו נובע מכך שבמקרה סגרנו דפדפן.

מה נמדד:
    המעבד      ניצול ממוצע ושיא, וכמה ליבות יש
    הזיכרון    כמה פנוי, וכמה המדידה עצמה תפסה
    הכרטיס     ניצול, זיכרון, חום, תדר, והאם הוא מואט
    השכנים     אילו תוכנות אחרות תפסו מעבד או כרטיס

    python scripts/machine_state.py          מצב רגעי
    python scripts/machine_state.py --watch 10   מעקב עשר שניות
"""
import argparse
import json
import subprocess
import sys
import threading
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

#: תהליכים שתופסים יותר מזה נחשבים "שכנים כבדים".
HEAVY_CPU_PCT = 8.0
HEAVY_MEM_MB = 500

#: סיבות ההאטה של הכרטיס, לפי הקוד שהיצרן מחזיר.
THROTTLE_REASONS = {
    0x0001: "הכרטיס בטל",
    0x0002: "הגדרת תדר של התוכנה",
    0x0004: "הגבלת חשמל בתוכנה",
    0x0008: "האטה בחומרה",
    0x0010: "סנכרון בין כרטיסים",
    0x0020: "האטה בגלל חום, בתוכנה",
    0x0040: "האטה בגלל חום, בחומרה",
    0x0080: "בלם חשמל בחומרה",
    0x0100: "הגדרת תדר של המסך",
}


def decode_throttle(raw):
    """מתרגם את קוד ההאטה להסבר בעברית."""
    if not raw or raw in ("Not Active", "N/A", ""):
        return []
    try:
        value = int(str(raw).strip(), 16) if str(raw).startswith("0x") else int(raw)
    except (TypeError, ValueError):
        return [str(raw)]
    out = [name for bit, name in THROTTLE_REASONS.items() if value & bit]
    unknown = value & ~sum(THROTTLE_REASONS)
    if unknown:
        out.append(f"סיבה שאינה מוכרת ({hex(unknown)})")
    return out


def gpu_now():
    """מצב רגעי של הכרטיס."""
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total,"
             "temperature.gpu,clocks.sm,clocks.max.sm,power.draw,"
             "clocks_throttle_reasons.active",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=6)
        if r.returncode != 0:
            return None
        p = [x.strip() for x in r.stdout.strip().split(",")]
        def num(x):
            try:
                return float(x)
            except ValueError:
                return None
        return {
            "util": num(p[0]), "mem_used": num(p[1]), "mem_total": num(p[2]),
            "temp": num(p[3]), "clock": num(p[4]), "clock_max": num(p[5]),
            "power": num(p[6]),
            "throttle_raw": p[7] if len(p) > 7 else "",
            "throttle": decode_throttle(p[7] if len(p) > 7 else ""),
        }
    except Exception:
        return None


def gpu_processes():
    """אילו תהליכים מחזיקים זיכרון בכרטיס."""
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-compute-apps=pid,process_name,used_memory",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=6)
        out = []
        for line in r.stdout.strip().split("\n"):
            if not line.strip():
                continue
            parts = [x.strip() for x in line.split(",")]
            if len(parts) >= 3:
                try:
                    mb = float(parts[2])
                except ValueError:
                    mb = None
                out.append({"pid": parts[0], "name": parts[1].split("\\")[-1],
                            "mem_mb": mb})
        return out
    except Exception:
        return []


def heavy_neighbours(sample_seconds=1.0):
    """אילו תוכנות אחרות תופסות מעבד או זיכרון.

    הדגימה הראשונה של ניצול המעבד תמיד מחזירה אפס, ולכן צריך לדגום
    פעמיים עם המתנה ביניהן. בלי זה הרשימה תמיד תצא ריקה.
    """
    try:
        import psutil
    except ImportError:
        return []
    procs = []
    for p in psutil.process_iter(["pid", "name"]):
        try:
            p.cpu_percent(None)       # דגימה ראשונה, לאיפוס
            procs.append(p)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    time.sleep(sample_seconds)
    out = []
    cores = psutil.cpu_count() or 1
    for p in procs:
        try:
            cpu = p.cpu_percent(None) / cores
            mem = p.memory_info().rss / 1048576
            if cpu >= HEAVY_CPU_PCT or mem >= HEAVY_MEM_MB:
                out.append({"pid": p.pid, "name": p.info["name"],
                            "cpu_pct": round(cpu, 1), "mem_mb": round(mem)})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    out.sort(key=lambda x: (-x["cpu_pct"], -x["mem_mb"]))
    return out[:12]


def snapshot(with_neighbours=True):
    """תמונת מצב מלאה של המחשב."""
    try:
        import psutil
        vm = psutil.virtual_memory()
        cpu = {
            "cores": psutil.cpu_count(logical=True),
            "physical": psutil.cpu_count(logical=False),
            "percent": psutil.cpu_percent(interval=0.6),
        }
        mem = {
            "total_gb": round(vm.total / 1073741824, 1),
            "free_gb": round(vm.available / 1073741824, 1),
            "used_pct": vm.percent,
        }
    except ImportError:
        cpu, mem = None, None

    return {
        "stamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "cpu": cpu,
        "memory": mem,
        "gpu": gpu_now(),
        "gpu_processes": gpu_processes(),
        "neighbours": heavy_neighbours() if with_neighbours else [],
    }


class Monitor:
    """דוגם את מצב המחשב ברקע תוך כדי עבודה.

    ממוצע אחרי הכל מסתיר את התמונה: עומס שנמשך שתי דקות מתוך עשר
    נעלם בממוצע, ובדיוק הוא זה שהאט את המדידה. לכן נשמרות גם
    הפסגות וגם כמה מהזמן המחשב היה עמוס.
    """

    def __init__(self, interval=1.0):
        self.interval = interval
        self.samples = []
        self._stop = threading.Event()
        self._thread = None

    def _tick(self):
        try:
            import psutil
            cpu = psutil.cpu_percent(None)
            vm = psutil.virtual_memory()
            free_gb = vm.available / 1073741824
        except Exception:
            cpu, free_gb = None, None
        g = gpu_now() or {}
        return {"t": time.time(), "cpu": cpu, "free_gb": free_gb,
                "gpu_util": g.get("util"), "gpu_mem": g.get("mem_used"),
                "gpu_temp": g.get("temp"), "gpu_clock": g.get("clock"),
                "throttle": g.get("throttle", [])}

    def _loop(self):
        try:
            import psutil
            psutil.cpu_percent(None)      # איפוס המונה
        except Exception:
            pass
        while not self._stop.is_set():
            self.samples.append(self._tick())
            self._stop.wait(self.interval)

    def __enter__(self):
        self.before = snapshot()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *a):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=4)
        self.after = snapshot(with_neighbours=False)

    def summary(self):
        if not self.samples:
            return None

        def stat(key):
            vals = [s[key] for s in self.samples if s.get(key) is not None]
            if not vals:
                return None
            return {"avg": round(sum(vals) / len(vals), 1),
                    "max": round(max(vals), 1), "min": round(min(vals), 1)}

        cpu = [s["cpu"] for s in self.samples if s.get("cpu") is not None]
        busy_pct = (round(100 * sum(1 for c in cpu if c > 60) / len(cpu), 1)
                    if cpu else None)
        throttles = set()
        for s in self.samples:
            for t in s.get("throttle") or []:
                if t != "הכרטיס בטל":
                    throttles.add(t)
        return {
            "samples": len(self.samples),
            "seconds": round(self.samples[-1]["t"] - self.samples[0]["t"], 1),
            "cpu": stat("cpu"),
            "cpu_busy_pct_of_time": busy_pct,
            "free_gb": stat("free_gb"),
            "gpu_util": stat("gpu_util"),
            "gpu_mem": stat("gpu_mem"),
            "gpu_temp": stat("gpu_temp"),
            "gpu_clock": stat("gpu_clock"),
            "throttle": sorted(throttles),
            "neighbours_before": self.before.get("neighbours", []),
            "gpu_processes_before": self.before.get("gpu_processes", []),
        }


def verdict(summary):
    """האם המדידה נלקחה בתנאים נקיים.

    זאת המסקנה המעשית: מדידה שנלקחה תחת עומס אינה ניתנת להשוואה,
    וצריך לומר זאת במפורש ולא לרשום אותה כאילו היא שווה לאחרות.
    """
    if not summary:
        return "לא ידוע", []
    problems = []
    cpu = summary.get("cpu") or {}
    if (cpu.get("avg") or 0) > 55:
        problems.append(f"המעבד היה עמוס {cpu['avg']}% בממוצע")
    if (summary.get("cpu_busy_pct_of_time") or 0) > 25:
        problems.append(
            f"המעבד היה מעל 60% במשך {summary['cpu_busy_pct_of_time']}% מהזמן")
    free = summary.get("free_gb") or {}
    if free.get("min") is not None and free["min"] < 2.0:
        problems.append(f"הזיכרון הפנוי ירד ל-{free['min']} ג׳יגה")
    gmem = summary.get("gpu_mem") or {}
    if gmem.get("max") and gmem["max"] > 7000:
        problems.append(f"זיכרון הכרטיס הגיע ל-{gmem['max']:.0f} מגה")
    if summary.get("throttle"):
        problems.append("הכרטיס הואט: " + ", ".join(summary["throttle"]))
    others = [p for p in summary.get("gpu_processes_before", [])
              if "python" not in p["name"].lower()]
    if others:
        problems.append(
            "תוכנות אחרות החזיקו את הכרטיס: "
            + ", ".join(p["name"] for p in others[:4]))

    if not problems:
        return "נקי", []
    heavy = [p for p in problems if "עמוס" in p or "ירד" in p or "הגיע" in p]
    return ("תחת עומס" if heavy else "עם הסתייגות"), problems


def print_snapshot(s):
    print("=" * 74)
    print(f"מצב המחשב — {s['stamp']}")
    print("=" * 74)
    c, m, g = s.get("cpu"), s.get("memory"), s.get("gpu")
    if c:
        print(f"  מעבד:    {c['percent']}% · {c['cores']} ליבות "
              f"({c['physical']} פיזיות)")
    if m:
        print(f"  זיכרון:  {m['free_gb']} ג׳יגה פנוי מתוך {m['total_gb']} "
              f"({m['used_pct']}% בשימוש)")
    if g:
        free = (g["mem_total"] or 0) - (g["mem_used"] or 0)
        print(f"  כרטיס:   ניצול {g['util']}% · זיכרון {g['mem_used']:.0f} "
              f"מתוך {g['mem_total']:.0f} מגה ({free:.0f} פנוי)")
        print(f"           חום {g['temp']:.0f} מעלות · תדר {g['clock']:.0f} "
              f"מתוך {g['clock_max']:.0f} מגהרץ"
              + (f" · חשמל {g['power']:.1f} ואט" if g.get("power") else ""))
        if g["throttle"]:
            print(f"           האטה: {', '.join(g['throttle'])}")
    if s.get("gpu_processes"):
        print("  מחזיקים את הכרטיס:")
        for p in s["gpu_processes"]:
            mb = f"{p['mem_mb']:.0f} מגה" if p["mem_mb"] else "לא ידוע"
            print(f"     {p['name']}  ({mb})")
    if s.get("neighbours"):
        print("  תוכנות כבדות שרצות במקביל:")
        for n in s["neighbours"]:
            print(f"     {n['name']:28} מעבד {n['cpu_pct']:5.1f}% · "
                  f"זיכרון {n['mem_mb']:6} מגה")


def main():
    ap = argparse.ArgumentParser(description="מצב המחשב")
    ap.add_argument("--watch", type=float, help="לעקוב כמה שניות")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if args.watch:
        with Monitor() as mon:
            time.sleep(args.watch)
        s = mon.summary()
        if args.json:
            print(json.dumps(s, ensure_ascii=False, indent=2))
            return 0
        v, problems = verdict(s)
        print("=" * 74)
        print(f"מעקב של {s['seconds']} שניות — {s['samples']} דגימות")
        print("=" * 74)
        for label, key in (("מעבד", "cpu"), ("זיכרון פנוי", "free_gb"),
                           ("ניצול הכרטיס", "gpu_util"),
                           ("זיכרון הכרטיס", "gpu_mem"),
                           ("חום הכרטיס", "gpu_temp"),
                           ("תדר הכרטיס", "gpu_clock")):
            st = s.get(key)
            if st:
                print(f"  {label:16} ממוצע {st['avg']:8} · "
                      f"מ-{st['min']} עד {st['max']}")
        print(f"\n  מצב המדידה: {v}")
        for p in problems:
            print("     - " + p)
        return 0

    s = snapshot()
    if args.json:
        print(json.dumps(s, ensure_ascii=False, indent=2))
    else:
        print_snapshot(s)
    return 0


if __name__ == "__main__":
    sys.exit(main())

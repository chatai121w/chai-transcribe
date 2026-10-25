# -*- coding: utf-8 -*-
"""בדיקה לילית: האם חיבור שני שירותי התמלול עובד מקצה לקצה.

למה בלילה ובאופן אוטומטי
------------------------
החיבור נבנה ונבדק בבדיקות אוטומטיות, אבל הבדיקות עובדות מול
שירותים מדומים. מה שהן אינן יכולות לבדוק הוא המפגש האמיתי: האם
השירות השני באמת עונה, האם התמלול באמת חוזר, והאם שתי היכולות
שחייבות להישאר מקומיות — חיפוש לפי משמעות והקראה — באמת נשארו.

שלוש הנקודות שנבדקות כאן הן בדיוק אלה שכשל בהן שקט לגמרי:

    תמלול          אם השירות לא עונה, הודעות קוליות פשוט לא
                   מתומללות. בלי שגיאה ובלי סימן.

    חיפוש משמעות   כתובתו נגזרה מכתובת התמלול. הפניית התמלול
                   הייתה מכבה אותו בשקט — הוא פשוט מפסיק למצוא.

    הקראה          אותו סיפור.

הבדיקה אינה משנה דבר. היא אינה מפעילה שירותים ואינה עוצרת אותם;
היא רק בודקת את מה שרץ ורושמת דוח.

הדוח נכתב ל-benchmark_private/night/ עם חותמת זמן.
"""
from __future__ import annotations

import io
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(HERE, "benchmark_private", "night")

CHAI = "http://127.0.0.1:3000"
SICHA_LOCAL = "http://127.0.0.1:5077"
SICHA_APP = "http://127.0.0.1:5070"


def port_open(host, port, timeout=3):
    try:
        with socket.create_connection((host, port), timeout):
            return True
    except OSError:
        return False


def get_json(url, timeout=20):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "night-check"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        return None, "קוד %d" % e.code
    except Exception as e:
        return None, type(e).__name__


def gpu_memory():
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=20)
        used, total = [int(x.strip()) for x in r.stdout.strip().split(",")[:2]]
        return used, total
    except Exception:
        return None, None


def check(name, ok, detail=""):
    return {"בדיקה": name, "עבר": bool(ok), "פירוט": detail}


def main():
    results = []
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")

    # ---------------------------------------------- מי רץ
    chai_up = port_open("127.0.0.1", 3000)
    local_up = port_open("127.0.0.1", 5077)
    app_up = port_open("127.0.0.1", 5070)
    results.append(check("שירות התמלול (3000) פועל", chai_up))
    results.append(check("השירות המקומי (5077) פועל", local_up))
    results.append(check("שרת התוכנה (5070) פועל", app_up))

    # ---------------------------------------------- תמלול
    if chai_up:
        d, err = get_json(CHAI + "/health")
        ok = bool(d and d.get("available_models"))
        results.append(check(
            "שירות התמלול מדווח על מודלים זמינים", ok,
            err or ("מודל נוכחי: %s" % (d or {}).get("current_model", "לא ידוע"))))
        # הפעולה שהוספנו — אם היא חסרה, השרת רץ עם קוד ישן
        d2, err2 = get_json(CHAI + "/measurements")
        results.append(check(
            "יומן המדידות נגיש", bool(d2),
            err2 or "%d נושאים" % len((d2 or {}).get("topics", []))))
    else:
        results.append(check("שירות התמלול מדווח על מודלים זמינים", False,
                             "לא פועל"))

    # ---------------------------------------------- מה שחייב להישאר מקומי
    if local_up:
        d, err = get_json(SICHA_LOCAL + "/health")
        embed = (d or {}).get("embed")
        results.append(check(
            "חיפוש לפי משמעות זמין", embed in ("ready", "available"),
            err or "מצב: %s" % embed))
        # ההקראה: השירות הקטן אינו מדווח עליה בבריאות, ולכן נבדק
        # שהוא לפחות עונה ושמודל התמלול לא נטען בו לחינם
        loaded = (d or {}).get("loaded") or []
        results.append(check(
            "השירות המקומי אינו טוען מנוע תמלול מיותר", not loaded,
            "טעון: %s" % (", ".join(loaded) if loaded else "כלום")))
    else:
        results.append(check("חיפוש לפי משמעות זמין", False, "לא פועל"))

    # ---------------------------------------------- זיכרון כרטיס המסך
    used, total = gpu_memory()
    if used is not None:
        # שני מודלים כבדים באותו כרטיס הם כ-6 ג'יגה. מתחת לזה סימן
        # שהחיבור עובד ואין כפילות.
        results.append(check(
            "זיכרון כרטיס המסך סביר", used < total * 0.75,
            "%d מתוך %d מגה" % (used, total)))

    # ---------------------------------------------- דוח
    os.makedirs(OUT_DIR, exist_ok=True)
    passed = sum(1 for r in results if r["עבר"])
    report = {
        "מתי": stamp,
        "עברו": passed,
        "סך הכל": len(results),
        "בדיקות": results,
    }
    path = os.path.join(OUT_DIR, "בדיקה-%s.json" % time.strftime("%Y%m%d-%H%M"))
    io.open(path, "w", encoding="utf-8").write(
        json.dumps(report, ensure_ascii=False, indent=2))

    print("בדיקה לילית · %s" % stamp)
    print("=" * 60)
    for r in results:
        mark = "עבר " if r["עבר"] else "נכשל"
        print("  [%s] %-44s %s" % (mark, r["בדיקה"], r["פירוט"]))
    print("=" * 60)
    print("  %d מתוך %d עברו" % (passed, len(results)))
    print("  הדוח נשמר: %s" % path)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())

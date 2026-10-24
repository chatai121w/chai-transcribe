#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""בדיקת רגרסיה — מודד את המערכת כולה לפני ואחרי שינוי.

למה זה קיים:
    שינוי בסביבה — החלפת ספרייה, עדכון גרסה — יכול לשבור דברים
    רחוק מהמקום שנגעו בו. הדרך היחידה לדעת היא למדוד את אותם
    דברים בדיוק לפני ואחרי, ולהשוות מספרים.

    בלי מדידת "לפני" אי אפשר להוכיח שלא הייתה רגרסיה. אפשר רק
    לקוות.

מה נמדד:
    1. תמלול עברית רגילה — ספירת מילים נכונות מול תמלול מאומת.
    2. מהירות התמלול.
    3. מהירות ההקראה.
    4. הניקוד האוטומטי.
    5. שכפול הקול.
    6. מה רץ על כרטיס המסך ומה על המעבד.

ההשוואה היא מול השיא ההיסטורי, ולא מול המדידה הקודמת:
    אם היינו ב-60, ירדנו ל-50 והגענו ל-55 — ההשוואה לקודמת מראה
    שיפור, אבל אנחנו חמש מילים מתחת למה שכבר הושג. זאת רגרסיה,
    והיא חייבת להיות מדווחת ככזאת.

    python scripts/regression_check.py --save לפני
    python scripts/regression_check.py --save אחרי
    python scripts/regression_check.py --compare אחרי
    python scripts/regression_check.py --history
"""
import argparse
import glob
import io
import json
import os
import re
import sys
import time
import unicodedata

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "server"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np  # noqa: E402

BENCH_DIR = os.path.join(HERE, "benchmark_private", "approved")
AUDIO_DIR = os.path.join(HERE, "benchmark_private", "audio")
RESULTS_DIR = os.path.join(HERE, "benchmark_private", "regression")

#: יומן כל המדידות, לפי הסדר. שורה אחת לכל מדידה.
#:
#: למה יומן ולא שתי תמונות מצב: השוואה בין שתי מדידות סמוכות
#: מסתירה את הטעות המסוכנת ביותר. אם היינו ב-60, ירדנו ל-50
#: והגענו ל-55 — ההשוואה האחרונה מראה שיפור, בעוד שבפועל אנחנו
#: 5 מילים מתחת למה שכבר היה לנו.
#:
#: לכן ההשוואה כאן היא תמיד **מול השיא ההיסטורי**, ולא מול הקודם.
JOURNAL = os.path.join(RESULTS_DIR, "journal.jsonl")

NIKUD = re.compile(r"[֑-ׇ]")
FINALS = {"ך": "כ", "ם": "מ", "ן": "נ",
          "ף": "פ", "ץ": "צ"}


def normalise(text):
    """משווה בלי ניקוד, בלי פיסוק ובלי הבדל באותיות סופיות."""
    text = unicodedata.normalize("NFC", text or "")
    text = NIKUD.sub("", text)
    text = re.sub(r"[^א-תA-Za-z0-9\s]", " ", text)
    text = "".join(FINALS.get(c, c) for c in text)
    return [w for w in text.lower().split() if w]


def count_correct(ref, hyp):
    """כמה מילים נכונות, לפי יישור מילה-למילה.

    ספירה פשוטה של מילים משותפות אינה מספיקה: היא סופרת מילה
    שהופיעה במקום הלא נכון כנכונה.
    """
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    # מהלך אחורה כדי לספור התאמות מדויקות
    i, j, correct = n, m, 0
    while i > 0 and j > 0:
        if ref[i - 1] == hyp[j - 1] and d[i][j] == d[i - 1][j - 1]:
            correct += 1
            i -= 1
            j -= 1
        elif d[i][j] == d[i - 1][j - 1] + 1:
            i -= 1
            j -= 1
        elif d[i][j] == d[i - 1][j] + 1:
            i -= 1
        else:
            j -= 1
    return correct


def wilson(c, n, z=1.96):
    if not n:
        return 0.0, 0.0, 0.0
    import math
    p = c / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return p * 100, max(0.0, centre - half) * 100, min(1.0, centre + half) * 100


# ------------------------------------------------------------------ המדידות

def measure_environment():
    import importlib.metadata as md
    out = {}
    for n in ("torch", "faster-whisper", "ctranslate2", "onnxruntime",
              "onnxruntime-gpu", "transformers", "numpy"):
        try:
            out[n] = md.version(n)
        except Exception:
            out[n] = None
    try:
        import onnxruntime as ort
        out["onnx_providers"] = ort.get_available_providers()
    except Exception as e:
        out["onnx_providers"] = [f"שגיאה: {type(e).__name__}"]
    try:
        import torch
        out["cuda_available"] = bool(torch.cuda.is_available())
        out["cuda_version"] = torch.version.cuda
    except Exception:
        out["cuda_available"] = False
        out["cuda_version"] = None
    try:
        import ctranslate2 as ct2
        out["ct2_cuda_devices"] = ct2.get_cuda_device_count()
    except Exception:
        out["ct2_cuda_devices"] = 0
    return out


def measure_transcription(model_name, device, compute_type, limit=None):
    """תמלול עברית רגילה מול תמלול מאומת."""
    from faster_whisper import WhisperModel

    clips = sorted(glob.glob(os.path.join(BENCH_DIR, "*.json")))
    if limit:
        clips = clips[:limit]
    if not clips:
        return {"error": "אין קטעי בדיקה"}

    t0 = time.time()
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    load_s = time.time() - t0

    correct = total = 0
    audio_s = 0.0
    work_s = 0.0
    per_clip = []

    for path in clips:
        meta = json.load(io.open(path, encoding="utf-8"))
        audio = os.path.join(AUDIO_DIR, meta["audio"])
        if not os.path.exists(audio):
            continue
        ref = normalise(meta["text"])
        t0 = time.time()
        segments, _info = model.transcribe(audio, language="he", beam_size=5,
                                           vad_filter=False)
        heard = " ".join(s.text.strip() for s in segments)
        work_s += time.time() - t0
        audio_s += float(meta.get("seconds", 0) or 0)

        c = count_correct(ref, normalise(heard))
        correct += c
        total += len(ref)
        per_clip.append({"name": meta["name"], "correct": c, "words": len(ref)})

    pct, lo, hi = wilson(correct, total)
    return {
        "model": model_name, "device": device, "compute_type": compute_type,
        "clips": len(per_clip), "correct": correct, "words": total,
        "percent": round(pct, 2), "ci_low": round(lo, 2), "ci_high": round(hi, 2),
        "load_seconds": round(load_s, 1),
        "transcribe_seconds": round(work_s, 1),
        "audio_seconds": round(audio_s, 1),
        "realtime_factor": round(work_s / audio_s, 3) if audio_s else None,
        "per_clip": per_clip,
    }


def measure_tts(runs=3):
    try:
        import bluetts_engine as be
        import hebrew_phonemes as hp
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}
    engine = be.get_engine()
    if not engine.available():
        return {"error": "מנוע ההקראה אינו מותקן"}
    engine.load()
    ipa = hp.phonemize("בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ",
                       "ashkenazi").ipa
    engine.synthesize(ipa, voice="female", steps=8, seed=1)   # חימום
    times, secs = [], 0.0
    for _ in range(runs):
        t0 = time.time()
        wav, sr = engine.synthesize(ipa, voice="female", steps=16, seed=1)
        times.append(time.time() - t0)
        secs = len(wav) / sr
    avg = sum(times) / len(times)
    return {
        "providers": engine.providers(),
        "audio_seconds": round(secs, 2),
        "seconds_per_run": round(avg, 2),
        "realtime_factor": round(avg / secs, 2) if secs else None,
        "ipa": ipa,
    }


def measure_nikud():
    try:
        from hebrew_nikud import get_nikud, strip_helpers, coverage
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}
    n = get_nikud()
    if not n.available():
        return {"error": "המנקד אינו מותקן"}
    t0 = time.time()
    n.load()
    load_s = time.time() - t0
    text = "הגמרא אומרת שהדבר תלוי במחלוקת רבי יוחנן ורבי שמעון"
    t0 = time.time()
    out = strip_helpers(n.add_nikud(text))
    work_s = time.time() - t0
    return {
        "load_seconds": round(load_s, 2),
        "seconds": round(work_s, 2),
        "coverage": coverage(out)[2],
        "output": out,
    }


def measure_cloning():
    try:
        import voice_cloning as vc
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}
    c = vc.get_cloner()
    if not c.available():
        return {"error": "שכפול הקול אינו מותקן"}
    rng = np.random.default_rng(3)
    wav = (rng.standard_normal(int(6 * vc.SAMPLE_RATE)) * 0.1).astype(np.float32)
    t0 = time.time()
    z = c.encode(wav)
    ttl, dp = c.style_from_latent(z)
    work_s = time.time() - t0
    return {
        "seconds": round(work_s, 2),
        "frames": int(z.shape[-1]),
        "identity_std": round(float(np.std(ttl)), 5),
        "problems": c._sanity_check(ttl, dp),
    }


def measure_phonemes():
    """ממיר הצלילים אינו תלוי בספריות חיצוניות, ולכן חייב להיות זהה.

    שינוי כאן פירושו שמשהו אחר נשבר.
    """
    try:
        import hebrew_phonemes as hp
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}
    words = ["תּוֹרָה", "שַׁבָּת", "אֱמֶת", "קוֹלוֹת", "מַלְכוּת", "גְּמָרָא"]
    return {w: hp.phonemize(w, "ashkenazi").ipa for w in words}


# ------------------------------------------------------------------- הרצה

def run_all(args):
    print("=" * 74)
    print("בדיקת רגרסיה")
    print("=" * 74)

    result = {"environment": measure_environment()}
    env = result["environment"]
    print("\nסביבה:")
    for k in ("torch", "ctranslate2", "onnxruntime", "onnxruntime-gpu", "faster-whisper"):
        print(f"  {k:20} {env.get(k) or 'לא מותקן'}")
    print(f"  {'כרטיס מסך':20} {'זמין' if env['cuda_available'] else 'אינו זמין'}")
    print(f"  {'מנוע הגרפים על':20} {', '.join(env['onnx_providers'])}")

    print("\n" + "-" * 74)
    print("תמלול עברית רגילה")
    print("-" * 74)
    result["transcription"] = measure_transcription(
        args.model, args.device, args.compute_type, args.limit)
    t = result["transcription"]
    if "error" in t:
        print("  שגיאה:", t["error"])
    else:
        print(f"  {t['correct']} מתוך {t['words']} מילים = {t['percent']}%")
        print(f"  רווח סמך: {t['ci_low']}% עד {t['ci_high']}%")
        print(f"  {t['clips']} קטעים · {t['audio_seconds']} שניות שמע "
              f"תומללו ב-{t['transcribe_seconds']} שניות (יחס {t['realtime_factor']})")

    print("\n" + "-" * 74)
    print("הקראה")
    print("-" * 74)
    result["tts"] = measure_tts()
    s = result["tts"]
    if "error" in s:
        print("  שגיאה:", s["error"])
    else:
        print(f"  רץ על: {', '.join(s['providers'])}")
        print(f"  {s['audio_seconds']} שניות קול ב-{s['seconds_per_run']} שניות "
              f"(יחס {s['realtime_factor']})")

    print("\n" + "-" * 74)
    print("ניקוד אוטומטי")
    print("-" * 74)
    result["nikud"] = measure_nikud()
    k = result["nikud"]
    print("  שגיאה: " + k["error"] if "error" in k
          else f"  {k['seconds']} שניות · כיסוי {k['coverage']}%\n  {k['output']}")

    print("\n" + "-" * 74)
    print("שכפול קול")
    print("-" * 74)
    result["cloning"] = measure_cloning()
    cl = result["cloning"]
    print("  שגיאה: " + cl["error"] if "error" in cl
          else f"  {cl['seconds']} שניות · {cl['frames']} מסגרות · "
               f"פיזור {cl['identity_std']} · בעיות: {cl['problems'] or 'אין'}")

    print("\n" + "-" * 74)
    print("ממיר הצלילים (חייב להיות זהה)")
    print("-" * 74)
    result["phonemes"] = measure_phonemes()
    for w, ipa in result["phonemes"].items():
        if w != "error":
            print(f"  {w:12} {ipa}")

    if args.save:
        os.makedirs(RESULTS_DIR, exist_ok=True)
        path = os.path.join(RESULTS_DIR, f"{args.save}.json")
        json.dump(result, io.open(path, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=2)
        print(f"\nנשמר: {path}")
    return 0



# ===================================================================
#  קישור בין מדידה למצב הקוד
# ===================================================================
#
# הבעיה שזה פותר: מספר לבדו אינו שימושי. לדעת ש"לפני עשרה ימים
# היינו ב-280 מילים ועכשיו ב-265" אינו עוזר אם אי אפשר לדעת **מה
# השתנה בינתיים** ואיך לחזור.
#
# לכן כל מדידה נקשרת לנקודת שמירה בגיט. השיא אינו רק מספר — הוא
# מצביע על מצב קוד מדויק. מזה נובעות שלוש יכולות:
#
#   1. לראות בדיוק אילו קבצים השתנו מאז השיא.
#   2. לחזור לאותו מצב בפקודה אחת.
#   3. לדעת אם המדידה בכלל ניתנת לשחזור — מדידה שנלקחה כשהיו
#      שינויים לא שמורים אינה ניתנת לשחזור, והיא מסומנת ככזאת.


def git(*args):
    """מריץ פקודת גיט ומחזיר את הפלט, או None אם נכשל."""
    import subprocess
    try:
        r = subprocess.run(["git"] + list(args), capture_output=True,
                           text=True, cwd=HERE, timeout=20)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def git_state():
    """מצב הקוד ברגע המדידה."""
    commit = git("rev-parse", "--short=12", "HEAD")
    if not commit:
        return {"available": False}
    status = git("status", "--porcelain") or ""
    dirty_files = [l[3:] for l in status.split("\n") if l.strip()]
    # קבצים שאינם משפיעים על התוצאה אינם הופכים מדידה ללא ניתנת
    # לשחזור. תוצאות מדידה, יומנים וקבצים זמניים הם כאלה.
    relevant = [f for f in dirty_files
                if not f.startswith(("benchmark_private/", "docs/"))
                and not f.endswith((".log", ".md"))]
    return {
        "available": True,
        "commit": commit,
        "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
        "subject": git("log", "-1", "--format=%s"),
        "date": git("log", "-1", "--format=%cI"),
        "dirty": bool(relevant),
        "dirty_files": relevant[:30],
        "dirty_count": len(relevant),
    }


def describe_changes(from_commit, to_commit="HEAD"):
    """מה השתנה בין שתי נקודות שמירה."""
    if not from_commit:
        return None
    stat = git("diff", "--stat", f"{from_commit}..{to_commit}")
    names = git("diff", "--name-status", f"{from_commit}..{to_commit}")
    log = git("log", "--oneline", f"{from_commit}..{to_commit}")
    if stat is None and names is None:
        return None
    return {
        "files": [l for l in (names or "").split("\n") if l.strip()],
        "commits": [l for l in (log or "").split("\n") if l.strip()],
        "stat_tail": (stat or "").split("\n")[-1] if stat else "",
    }


def print_rollback_help(entry):
    """איך חוזרים למצב של מדידה מסוימת."""
    g = entry.get("git") or {}
    if not g.get("commit"):
        print("     אין נקודת שמירה למדידה הזאת — אי אפשר לחזור אליה אוטומטית.")
        return
    print(f"     נקודת השמירה: {g['commit']}  ({g.get('subject', '')[:50]})")
    if g.get("dirty"):
        print(f"     !! במדידה הזאת היו {g['dirty_count']} קבצים לא שמורים,")
        print("        ולכן היא אינה ניתנת לשחזור מדויק.")
    print()
    print("     לראות מה השתנה מאז:")
    print(f"        git diff {g['commit']}..HEAD --stat")
    print("     לחזור לשם בענף נפרד, בלי לאבד את מה שיש עכשיו:")
    print(f"        git switch -c חזרה-{g['commit'][:7]} {g['commit']}")


def append_journal(label, result):
    """מוסיף מדידה ליומן. שורה אחת לכל מדידה, לפי הסדר."""
    os.makedirs(RESULTS_DIR, exist_ok=True)
    t = result.get("transcription", {})
    entry = {
        "label": label,
        "stamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        # בלי זה המספר חסר משמעות: אי אפשר לדעת מה השתנה ואיך לחזור.
        "git": git_state(),
        "correct": t.get("correct"),
        "words": t.get("words"),
        "percent": t.get("percent"),
        "clips": t.get("clips"),
        "model": t.get("model"),
        "device": t.get("device"),
        "compute_type": t.get("compute_type"),
        "realtime_factor": t.get("realtime_factor"),
        "tts_factor": (result.get("tts") or {}).get("realtime_factor"),
        "tts_providers": (result.get("tts") or {}).get("providers"),
        "onnx_providers": (result.get("environment") or {}).get("onnx_providers"),
        "versions": {k: v for k, v in (result.get("environment") or {}).items()
                     if k in ("torch", "ctranslate2", "onnxruntime",
                              "onnxruntime-gpu", "faster-whisper", "transformers")},
    }
    with io.open(JOURNAL, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def read_journal():
    if not os.path.exists(JOURNAL):
        return []
    rows = []
    for line in io.open(JOURNAL, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def comparable(rows, words):
    """רק מדידות על אותו מספר מילים ניתנות להשוואה.

    השוואה בין מדידה על 340 מילים למדידה על 100 היא חסרת משמעות:
    אפשר לקבל אחוז גבוה יותר פשוט בגלל קטעים קלים יותר. מדידה
    חלקית נרשמת ביומן אבל אינה נכנסת לחישוב השיא.
    """
    return [r for r in rows if r.get("words") == words and r.get("correct") is not None]


def best_ever(rows, words):
    pool = comparable(rows, words)
    return max(pool, key=lambda r: r["correct"]) if pool else None


def significant(c1, n1, c2, n2, z=1.96):
    """האם ההפרש חורג מהרעש, או שהוא בתוכו.

    במדגם קטן, הפרש של כמה מילים אינו אומר כלום. בלי הבדיקה הזאת
    כל תנודה אקראית נראית כשיפור או כרגרסיה.
    """
    import math
    if not n1 or not n2:
        return False, 0.0, 0.0
    p1, p2 = c1 / n1, c2 / n2
    se = math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    noise = z * se * 100
    diff = (p2 - p1) * 100
    return abs(diff) > noise, diff, noise


def show_history(args):
    """כל ההיסטוריה, עם סימון השיא."""
    rows = read_journal()
    if not rows:
        print("היומן ריק.")
        return 0
    print("=" * 78)
    print("היסטוריית המדידות")
    print("=" * 78)
    best = {}
    for r in rows:
        w = r.get("words")
        if r.get("correct") is None:
            continue
        if w not in best or r["correct"] > best[w]["correct"]:
            best[w] = r

    print(f"  {'מתי':20} {'שם':14} {'נכונות':12} {'אחוז':7} {'הקראה':8}  הערה")
    print("  " + "-" * 74)
    for r in rows:
        c, w = r.get("correct"), r.get("words")
        score = f"{c}/{w}" if c is not None else "—"
        pct = f"{r['percent']}%" if r.get("percent") is not None else "—"
        tts = f"{r['tts_factor']}" if r.get("tts_factor") else "—"
        mark = ""
        if c is not None and w in best and best[w] is r:
            mark = "<- השיא"
        print(f"  {r['stamp']:20} {r['label'][:14]:14} {score:12} {pct:7} {tts:8}  {mark}")

    print()
    for w, b in sorted(best.items()):
        print(f"  השיא על {w} מילים: {b['correct']} ({b['percent']}%) "
              f"במדידה {b['label']!r} מ-{b['stamp']}")
    return 0


def compare(args):
    """משווה מדידה מול השיא ההיסטורי, לא מול הקודמת.

    זאת הנקודה המרכזית של הכלי. אם היינו ב-60, ירדנו ל-50 והגענו
    ל-55 — ההשוואה לקודמת מראה שיפור, אבל אנחנו 5 מילים מתחת למה
    שכבר הושג. זאת רגרסיה, והיא חייבת להיות מדווחת ככזאת.
    """
    name = args.compare
    path = os.path.join(RESULTS_DIR, f"{name}.json")
    if not os.path.exists(path):
        print(f"חסר: {path}")
        return 1
    current = json.load(io.open(path, encoding="utf-8"))
    cur_t = current.get("transcription", {})
    rows = read_journal()

    print("=" * 78)
    print(f"בדיקת רגרסיה — המדידה {name!r} מול כל ההיסטוריה")
    print("=" * 78)

    problems, notes = [], []

    if cur_t.get("correct") is None:
        print("  אין נתוני תמלול במדידה הזאת.")
    else:
        c, w = cur_t["correct"], cur_t["words"]
        pool = [r for r in comparable(rows, w) if r.get("label") != name]
        best = max(pool, key=lambda r: r["correct"]) if pool else None
        prev = pool[-1] if pool else None

        print(f"\nתמלול עברית רגילה — {w} מילים")
        print(f"  עכשיו:         {c}/{w} = {cur_t['percent']}%")
        if prev:
            print(f"  המדידה הקודמת: {prev['correct']}/{w} = {prev['percent']}%"
                  f"   ({prev['label']}, {prev['stamp']})")
        if best:
            bg = best.get("git") or {}
            print(f"  השיא ההיסטורי: {best['correct']}/{w} = {best['percent']}%"
                  f"   ({best['label']}, {best['stamp']})")
            if bg.get("commit"):
                print(f"                 נקודת שמירה {bg['commit']}"
                      f"{'  (היו שינויים לא שמורים)' if bg.get('dirty') else ''}")

        if best:
            gap = c - best["correct"]
            sig, diff, noise = significant(best["correct"], w, c, w)
            print(f"\n  מול השיא: {gap:+d} מילים ({diff:+.1f} נקודות אחוז, "
                  f"גבול הרעש {noise:.1f})")
            if gap < 0 and sig:
                problems.append(
                    f"ירידה של {-gap} מילים מתחת לשיא ההיסטורי "
                    f"({best['correct']} במדידה {best['label']!r}). "
                    f"ההפרש חורג מהרעש — זאת רגרסיה אמיתית.")
            elif gap < 0:
                notes.append(
                    f"נמוך ב-{-gap} מילים מהשיא, אבל ההפרש בתוך הרעש "
                    f"({noise:.1f} נקודות). אי אפשר להסיק.")
            elif gap == 0:
                print("  זהה לשיא — אין רגרסיה.")
            else:
                print("  שיא חדש.")

            # גם אם לא ירדנו מתחת לשיא, כדאי לראות אם ירדנו מהקודמת
            if prev and prev is not best and c < prev["correct"]:
                notes.append(
                    f"נמוך ב-{prev['correct'] - c} מילים גם מהמדידה הקודמת.")

            # קטעים ספציפיים שנשברו — גם כשהסכום זהה
            if best.get("label"):
                bpath = os.path.join(RESULTS_DIR, f"{best['label']}.json")
                if os.path.exists(bpath):
                    bdata = json.load(io.open(bpath, encoding="utf-8"))
                    pb = {x["name"]: x["correct"]
                          for x in bdata.get("transcription", {}).get("per_clip", [])}
                    pc = {x["name"]: x["correct"] for x in cur_t.get("per_clip", [])}
                    worse = [(n, pb[n], pc[n]) for n in pb
                             if n in pc and pc[n] < pb[n]]
                    better = [(n, pb[n], pc[n]) for n in pb
                              if n in pc and pc[n] > pb[n]]
                    same = len(pb) - len(worse) - len(better)
                    print("\n  השוואה מזווגת, קטע מול קטע:")
                    print(f"     זהים: {same} · הורעו: {len(worse)} · "
                          f"השתפרו: {len(better)}")
                    for n, x, y in worse:
                        print(f"     הורע  {n}: {x} -> {y}")
                    for n, x, y in better:
                        print(f"     השתפר {n}: {x} -> {y}")

                    lost = sum(x - y for _, x, y in worse)
                    gained = sum(y - x for _, x, y in better)

                    if getattr(args, "environment_change", False):
                        # שינוי סביבה אינו אמור לשנות את הפלט בכלל.
                        # כל שינוי כאן הוא סימן, ולא עניין של מובהקות.
                        if worse:
                            problems.append(
                                f"{len(worse)} קטעים הורעו ({lost} מילים) בשינוי "
                                f"סביבה בלבד. החלפת ספרייה אינה אמורה לשנות את "
                                f"הפלט — זה מצביע על חישוב שונה.")
                        elif better:
                            notes.append(
                                f"{len(better)} קטעים השתפרו ({gained} מילים) "
                                f"בשינוי סביבה. גם שיפור לא צפוי הוא סימן שהחישוב "
                                f"השתנה — כדאי להבין למה.")
                        else:
                            print("     כל הקטעים זהים בדיוק — בדיוק מה שמצפים "
                                  "משינוי סביבה.")
                    elif worse:
                        # קטע שאיבד יותר ממחצית המילים לא "הורע קצת" —
                        # הוא נשבר. זה לא עניין של מובהקות סטטיסטית:
                        # המבחן הסטטיסטי מניח שתי מדידות עצמאיות, אבל
                        # כאן זה אותו קטע באותו מנוע, ולכן נפילה חדה
                        # בקטע בודד היא ראיה ישירה שמשהו נשבר.
                        broken = [(n, x, y) for n, x, y in worse if y < x * 0.5]
                        if broken:
                            problems.append(
                                f"{len(broken)} קטעים נשברו — איבדו יותר ממחצית "
                                f"המילים: " + ", ".join(
                                    f"{n} ({x}->{y})" for n, x, y in broken[:5]))
                        mild = [w for w in worse if w not in broken]
                        if mild:
                            notes.append(
                                f"{len(mild)} קטעים הורעו מעט מול השיא.")
        else:
            print("\n  אין מדידה קודמת להשוואה. זאת נקודת הבסיס.")

    # --- מה השתנה מאז השיא, ואיך חוזרים לשם.
    #
    # זה מה שהופך את היומן משימושי למועיל: לא רק "היינו טוב יותר",
    # אלא "היינו טוב יותר בנקודה הזאת, ואלה הקבצים שהשתנו מאז".
    if cur_t.get("correct") is not None:
        pool_g = [r for r in comparable(rows, cur_t["words"])
                  if r.get("label") != name]
        best_g = max(pool_g, key=lambda r: r["correct"]) if pool_g else None
        if best_g and (best_g.get("git") or {}).get("commit"):
            if best_g["correct"] > cur_t["correct"]:
                print("\n" + "-" * 78)
                print("מה השתנה מאז השיא")
                print("-" * 78)
                ch = describe_changes((best_g["git"] or {})["commit"])
                if ch is None:
                    print("  לא ניתן להשוות — נקודת השמירה אינה זמינה.")
                else:
                    if ch["commits"]:
                        print(f"  {len(ch['commits'])} שמירות מאז:")
                        for c in ch["commits"][:10]:
                            print("     " + c[:90])
                        if len(ch["commits"]) > 10:
                            print(f"     ועוד {len(ch['commits']) - 10}")
                    if ch["files"]:
                        print(f"\n{len(ch['files'])} קבצים השתנו:")
                        for f in ch["files"][:20]:
                            print("     " + f[:90])
                        if len(ch["files"]) > 20:
                            print(f"     ועוד {len(ch['files']) - 20}")
                    if ch["stat_tail"]:
                        print("     " + ch["stat_tail"])
                print("\nאיך חוזרים:")
                print_rollback_help(best_g)

    # --- מהירות. איטיות אינה רגרסיה בדיוק, אבל כדאי לדעת.
    prev_rows = [r for r in rows if r.get("label") != name and r.get("tts_factor")]
    cur_tts = (current.get("tts") or {}).get("realtime_factor")
    if cur_tts and prev_rows:
        fastest = min(prev_rows, key=lambda r: r["tts_factor"])
        print(f"\nהקראה:")
        print(f"  עכשיו:      יחס {cur_tts}")
        print(f"  הטוב ביותר: יחס {fastest['tts_factor']} ({fastest['label']})")
        if cur_tts > fastest["tts_factor"] * 1.15:
            notes.append(f"ההקראה איטית ב-"
                         f"{cur_tts / fastest['tts_factor']:.1f} מהטוב ביותר.")
        elif cur_tts < fastest["tts_factor"]:
            print(f"  מהיר פי {fastest['tts_factor'] / cur_tts:.1f} — שיא חדש.")

    # --- ממיר הצלילים. אינו תלוי בספריות חיצוניות, וחייב להיות זהה.
    for other in sorted(glob.glob(os.path.join(RESULTS_DIR, "*.json"))):
        if os.path.basename(other) == f"{name}.json":
            continue
        try:
            o = json.load(io.open(other, encoding="utf-8"))
        except Exception:
            continue
        fa, fb = o.get("phonemes", {}), current.get("phonemes", {})
        if not fa or not fb:
            continue
        diffs = [k for k in fa if k != "error" and fa.get(k) != fb.get(k)]
        if diffs:
            problems.append(
                f"הצלילים השתנו מול {os.path.basename(other)[:-5]!r} "
                f"ב-{len(diffs)} מילים. ממיר הצלילים אינו תלוי בספריות "
                f"חיצוניות, ולכן שינוי כאן פירושו שמשהו אחר נשבר.")
            for k in diffs:
                print(f"     {k}: {fa[k]} -> {fb.get(k)}")
        break

    print("\n" + "=" * 78)
    if problems:
        print("נמצאה רגרסיה:")
        for p in problems:
            print("  -", p)
        print("\nכדאי לחזור אחורה.")
        return 1
    if notes:
        print("אין רגרסיה מובהקת, אבל כדאי לשים לב:")
        for n in notes:
            print("  -", n)
        return 0
    print("אין רגרסיה בשום מדד, גם לא מול השיא ההיסטורי.")
    return 0


def main():
    ap = argparse.ArgumentParser(description="בדיקת רגרסיה")
    ap.add_argument("--save", help="שם לשמירת התוצאה ולרישום ביומן")
    ap.add_argument("--compare", metavar="שם",
                    help="להשוות מדידה מול השיא ההיסטורי")
    ap.add_argument("--history", action="store_true", help="להציג את כל ההיסטוריה")
    ap.add_argument("--model", default="ivrit-ai/whisper-large-v3-ct2")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--compute-type", default="float16")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    if args.history:
        return show_history(args)
    if args.compare:
        return compare(args)
    return run_all(args)


if __name__ == "__main__":
    sys.exit(main())

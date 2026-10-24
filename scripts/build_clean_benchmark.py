#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""בניית סדרת מדידה נקייה — אודיו משלך עם תמלול שאתה מאשר.

למה זה נחוץ:
  1. סדרת המדידה הקיימת שבורה. ב-17 מתוך 19 הקטעים טקסט האמת מכסה רק חלק
     מהאודיו, ולכן מילים שתומללו נכון נספרות כשגיאות וכל מספר יוצא מנופח.
  2. אין מאגר מדידה עברי ציבורי שאפשר לסמוך עליו. כל המאגרים הגדולים עשויים
     להיות בתוך נתוני האימון של המודלים, ואז המדידה בודקת שינון ולא דיוק.
  סדרה פרטית שלך, שאינה מתפרסמת, פותרת את שתי הבעיות.

איך עובדים:
    python scripts/build_clean_benchmark.py add <קובץ-אודיו> --tier lecture
        מתמלל, חותך לקטעים, וכותב קובץ עריכה לתיקון ידני.

    python scripts/build_clean_benchmark.py approve <שם-הקטע>
        אחרי שתיקנת — בודק כיסוי ומכניס לסדרה רק אם הוא תקין.

    python scripts/build_clean_benchmark.py status
        מראה כמה נאסף בכל רמת קושי.

    python scripts/build_clean_benchmark.py measure
        מודד את המודלים מול הסדרה המאושרת.

שלוש רמות הקושי נמדדות בנפרד, כי ממוצע אחד מסתיר את הפער:
    plain    עברית רגילה
    lecture  שיעור תורה מדובר
    lk       לשון הקודש בהגייה אשכנזית
"""
import argparse, io, json, mimetypes, os, re, sys, time, urllib.request, wave

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BENCH = os.path.join(ROOT, "benchmark_private")
SERVER = os.environ.get("TRANSCRIBE_URL", "http://127.0.0.1:3000")

TIERS = {"plain": "עברית רגילה",
         "lecture": "שיעור תורה מדובר",
         "lk": "לשון הקודש בהגייה אשכנזית"}

# דיבור עברי טבעי הוא 2-3 מילים לשנייה. מתחת לסף הזה הטקסט כנראה חלקי,
# וקטע כזה יזהם כל מדידה שהוא נכנס אליה.
MIN_WORDS_PER_SECOND = 1.6

MODELS = ["ivrit-ai/whisper-large-v3-ct2",
          "ivrit-ai/whisper-large-v3-turbo-ct2"]


# ───────────────────────────── עזר ─────────────────────────────

def ensure_dirs():
    for sub in ("pending", "approved", "audio"):
        os.makedirs(os.path.join(BENCH, sub), exist_ok=True)


def normalize(text):
    text = re.sub(r"[^֐-׿\s]", " ", text or "")
    text = text.replace("׳", "").replace("״", "")
    return re.sub(r"\s+", " ", text).strip()


def audio_seconds(path):
    """אורך האודיו בשניות.

    ספריית ה-wave הבסיסית קוראת רק קבצים בתסדיר PCM שלם, ונכשלת על
    קבצים בנקודה צפה ועל כל תסדיר דחוס. לכן יש מסלול גיבוי דרך soundfile
    ואחריו דרך ffprobe — בלי זה קטעים תקינים לגמרי נדחים מהסדרה.
    """
    try:
        with wave.open(path) as handle:
            return handle.getnframes() / handle.getframerate()
    except Exception:
        pass
    try:
        import soundfile
        info = soundfile.info(path)
        return info.frames / info.samplerate
    except Exception:
        pass
    try:
        import subprocess
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=60)
        value = (out.stdout or "").strip()
        return float(value) if value else None
    except Exception:
        return None


def server_alive():
    try:
        urllib.request.urlopen(SERVER + "/health", timeout=10)
        return True
    except Exception:
        return False


def transcribe(path, model=None, language="he"):
    boundary = "----bench" + str(int(time.time() * 1000))
    fields = {"language": language, "preset": "balanced",
              "initial_prompt": "תמלול שיעור תורה בעברית תקנית."}
    if model:
        fields["model"] = model
    body = b""
    for key, value in fields.items():
        body += (f"--{boundary}\r\nContent-Disposition: form-data; "
                 f"name=\"{key}\"\r\n\r\n{value}\r\n").encode()
    name = os.path.basename(path)
    ctype = mimetypes.guess_type(name)[0] or "audio/wav"
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
             f"filename=\"{name}\"\r\nContent-Type: {ctype}\r\n\r\n").encode()
    body += io.open(path, "rb").read() + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        SERVER + "/transcribe", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(request, timeout=1800) as response:
        payload = json.load(response)
    if isinstance(payload.get("text"), str) and payload["text"].strip():
        return payload["text"].strip()
    return " ".join(s.get("text", "") for s in payload.get("segments") or []).strip()


def align_counts(ref_words, hyp_words):
    """כמה נכונות, הוחלפו, נבלעו, נוספו."""
    n, m = len(ref_words), len(hyp_words)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if ref_words[i - 1] == hyp_words[j - 1]:
                d[i][j] = d[i - 1][j - 1]
            else:
                d[i][j] = 1 + min(d[i - 1][j - 1], d[i - 1][j], d[i][j - 1])
    correct = swapped = dropped = added = 0
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and ref_words[i - 1] == hyp_words[j - 1] and d[i][j] == d[i - 1][j - 1]:
            correct += 1; i -= 1; j -= 1
        elif i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + 1:
            swapped += 1; i -= 1; j -= 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            dropped += 1; i -= 1
        else:
            added += 1; j -= 1
    return correct, swapped, dropped, added


# ──────────────────────────── פקודות ────────────────────────────

def cmd_add(args):
    if not os.path.exists(args.audio):
        print("לא נמצא קובץ:", args.audio)
        return 1
    if args.tier not in TIERS:
        print("רמת קושי לא מוכרת. אפשרויות:", ", ".join(TIERS))
        return 1
    if not server_alive():
        print("שרת התמלול אינו פעיל. הפעל אותו ונסה שוב:")
        print("   cd server && ..\\.venv\\Scripts\\python.exe transcribe_server.py")
        return 1

    seconds = audio_seconds(args.audio) or 0
    name = args.name or os.path.splitext(os.path.basename(args.audio))[0]

    print("מתמלל את %s (%.1f שניות)..." % (os.path.basename(args.audio), seconds))
    draft = transcribe(args.audio)

    # שומרים עותק של האודיו, כדי שהסדרה תהיה עצמאית
    dest_audio = os.path.join(BENCH, "audio", name + os.path.splitext(args.audio)[1])
    if os.path.abspath(dest_audio) != os.path.abspath(args.audio):
        io.open(dest_audio, "wb").write(io.open(args.audio, "rb").read())

    out = os.path.join(BENCH, "pending", name + ".txt")
    io.open(out, "w", encoding="utf-8").write(
        "# קטע: %s\n"
        "# רמת קושי: %s (%s)\n"
        "# אודיו: %s  (%.1f שניות)\n"
        "#\n"
        "# הטקסט למטה הוא תמלול מכונה. הקשב לאודיו ותקן אותו כך שיהיה\n"
        "# מדויק למה שנאמר — כל מילה, כולל חזרות וגמגומים.\n"
        "# אל תשמיט ואל תייפה: טקסט מקוצר הורס את המדידה.\n"
        "# שורות שמתחילות בסולמית לא נקראות.\n"
        "#\n"
        "# כשסיימת:  python scripts/build_clean_benchmark.py approve %s\n"
        "\n%s\n" % (name, args.tier, TIERS[args.tier],
                    os.path.basename(dest_audio), seconds, name, draft))

    print()
    print("נוצר קובץ לעריכה:")
    print("   ", out)
    print()
    print("פתח אותו, תקן לפי האודיו, ואז הרץ:")
    print("    python scripts/build_clean_benchmark.py approve %s" % name)
    return 0


def cmd_approve(args):
    pending = os.path.join(BENCH, "pending", args.name + ".txt")
    if not os.path.exists(pending):
        print("לא נמצא קטע בשם:", args.name)
        return 1

    lines = io.open(pending, encoding="utf-8").read().splitlines()
    meta = {}
    for line in lines:
        m = re.match(r"#\s*(רמת קושי|אודיו):\s*(.+)", line)
        if m:
            meta[m.group(1)] = m.group(2).strip()
    text = "\n".join(l for l in lines if not l.strip().startswith("#")).strip()

    if not text:
        print("הקובץ ריק. אין מה לאשר.")
        return 1

    tier = (meta.get("רמת קושי", "") or "").split()[0] or "lecture"
    audio_name = (meta.get("אודיו", "") or "").split("  ")[0].strip()
    audio_path = os.path.join(BENCH, "audio", audio_name)
    seconds = audio_seconds(audio_path)

    words = len(normalize(text).split())
    if not seconds:
        print("לא הצלחתי לקרוא את אורך האודיו — מאשר בלי בדיקת כיסוי.")
        ratio = None
    else:
        ratio = words / seconds
        print("בדיקת כיסוי: %d מילים ב-%.1f שניות = %.2f מילים לשנייה"
              % (words, seconds, ratio))
        if ratio < MIN_WORDS_PER_SECOND:
            print()
            print("❌ נדחה — הטקסט קצר מדי ביחס לאודיו.")
            print("   דיבור עברי טבעי הוא 2-3 מילים לשנייה; הסף כאן %.1f."
                  % MIN_WORDS_PER_SECOND)
            print("   כנראה חסר חלק מהדיבור. השלם ונסה שוב.")
            print("   (אם האודיו באמת כולל שתיקות ארוכות — חתוך אותן קודם.)")
            return 1
        print("✓ הכיסוי תקין")

    row = {"name": args.name, "tier": tier, "audio": audio_name,
           "seconds": round(seconds, 2) if seconds else None,
           "words": words, "words_per_second": round(ratio, 2) if ratio else None,
           "text": text}
    io.open(os.path.join(BENCH, "approved", args.name + ".json"),
            "w", encoding="utf-8").write(json.dumps(row, ensure_ascii=False, indent=2) + "\n")
    os.remove(pending)
    print()
    print("הקטע אושר ונכנס לסדרה:", args.name)
    return 0


def load_approved():
    folder = os.path.join(BENCH, "approved")
    if not os.path.isdir(folder):
        return []
    out = []
    for f in sorted(os.listdir(folder)):
        if f.endswith(".json"):
            out.append(json.load(io.open(os.path.join(folder, f), encoding="utf-8")))
    return out


def cmd_status(args):
    rows = load_approved()
    pending = []
    pfolder = os.path.join(BENCH, "pending")
    if os.path.isdir(pfolder):
        pending = [f[:-4] for f in os.listdir(pfolder) if f.endswith(".txt")]

    print("סדרת המדידה הפרטית")
    print("=" * 56)
    for tier, label in TIERS.items():
        sub = [r for r in rows if r.get("tier") == tier]
        secs = sum(r.get("seconds") or 0 for r in sub)
        words = sum(r.get("words") or 0 for r in sub)
        print("  %-28s %2d קטעים · %5.1f דקות · %5d מילים"
              % (label, len(sub), secs / 60, words))
    print("-" * 56)
    total_s = sum(r.get("seconds") or 0 for r in rows)
    print("  סה\"כ מאושר: %d קטעים · %.1f דקות" % (len(rows), total_s / 60))
    if pending:
        print()
        print("  ממתינים לתיקון ידני: %s" % ", ".join(pending))
    print()
    if total_s < 1800:
        print("  היעד: 2-5 שעות. כרגע יש פחות מחצי שעה —")
        print("  מספיק לבדיקה מהירה, לא מספיק להכרעה סטטיסטית.")
    return 0


def cmd_measure(args):
    rows = load_approved()
    if not rows:
        print("אין עדיין קטעים מאושרים. התחל ב-add.")
        return 1
    if not server_alive():
        print("שרת התמלול אינו פעיל.")
        return 1

    models = args.models.split(",") if args.models else MODELS
    print("מודד %d מודלים על %d קטעים מאושרים\n" % (len(models), len(rows)))

    table = {}
    for model in models:
        label = model.split("/")[-1][:26]
        for tier, tier_label in TIERS.items():
            sub = [r for r in rows if r.get("tier") == tier]
            if not sub:
                continue
            tot_c = tot_r = 0
            for row in sub:
                audio = os.path.join(BENCH, "audio", row["audio"])
                try:
                    hyp = transcribe(audio, model=model)
                except Exception as error:
                    print("  שגיאה (%s): %s" % (label, type(error).__name__))
                    continue
                c, _, _, _ = align_counts(normalize(row["text"]).split(),
                                          normalize(hyp).split())
                tot_c += c
                tot_r += len(normalize(row["text"]).split())
            if tot_r:
                table.setdefault(label, {})[tier] = (tot_c, tot_r)
                print("  %-26s %-28s %4d מתוך %4d נכונות (%5.1f%%)"
                      % (label, tier_label, tot_c, tot_r, tot_c / tot_r * 100))
        print()

    print("=" * 70)
    print("  טבלה מסכמת — כמה מילים יצאו נכון")
    print("=" * 70)
    names = [t for t in TIERS if any(t in v for v in table.values())]
    print("  %-26s%s" % ("מודל", "".join("%-20s" % TIERS[t][:18] for t in names)))
    for label, cells in table.items():
        line = ""
        for t in names:
            if t in cells:
                c, r = cells[t]
                line += "%-20s" % ("%d/%d (%.0f%%)" % (c, r, c / r * 100))
            else:
                line += "%-20s" % "—"
        print("  %-26s%s" % (label, line))
    return 0


def main():
    ensure_dirs()
    parser = argparse.ArgumentParser(description="סדרת מדידה נקייה")
    sub = parser.add_subparsers(dest="cmd")

    p_add = sub.add_parser("add", help="להוסיף הקלטה חדשה")
    p_add.add_argument("audio")
    p_add.add_argument("--tier", default="lecture", help="plain / lecture / lk")
    p_add.add_argument("--name", default=None)

    p_ok = sub.add_parser("approve", help="לאשר קטע אחרי תיקון ידני")
    p_ok.add_argument("name")

    sub.add_parser("status", help="מה נאסף עד כה")

    p_m = sub.add_parser("measure", help="למדוד מודלים מול הסדרה")
    p_m.add_argument("--models", default=None, help="רשימה מופרדת בפסיקים")

    args = parser.parse_args()
    if args.cmd == "add":
        return cmd_add(args)
    if args.cmd == "approve":
        return cmd_approve(args)
    if args.cmd == "measure":
        return cmd_measure(args)
    if args.cmd == "status":
        return cmd_status(args)
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""בדיקת התאמה בין טקסט האמת לאודיו בקבצי האימון.

הבעיה שהכלי מאתר: טקסט האמת של קטע מכסה רק חלק מהאודיו. אז כל מילה
שתומללה נכון אך אינה בטקסט החלקי נספרת כשגיאה, ושיעור השגיאות מנופח.
קטע כזה גם לא כשיר לאימון — הוא מלמד את המודל לעצור באמצע משפט.

הכלי מתמלל את האודיו המלא ומשווה. הוא **אינו** דורס טקסט אנושי:
הוא כותב קובץ הצעות לעיון, והאדם מחליט.

    python scripts/check_gold_alignment.py                    בדיקה בלבד
    python scripts/check_gold_alignment.py --suggest          + קובץ הצעות
    python scripts/check_gold_alignment.py --dataset שם       מאגר אחר

קוד יציאה = מספר הקטעים הבעייתיים.
"""
import argparse, io, json, mimetypes, os, re, sys, time, urllib.request, wave

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASETS = os.path.join(ROOT, "server", "lora_runs", "datasets")
SERVER = os.environ.get("TRANSCRIBE_URL", "http://127.0.0.1:3000")

# דיבור עברי טבעי הוא 2-3 מילים לשנייה. מתחת לסף הזה הטקסט כנראה חלקי.
MIN_WORDS_PER_SECOND = 1.6


def normalize(text):
    text = re.sub(r"[^֐-׿\s]", " ", text or "")
    text = text.replace("׳", "").replace("״", "")
    return re.sub(r"\s+", " ", text).strip()


def audio_seconds(path):
    try:
        with wave.open(path) as handle:
            return handle.getnframes() / handle.getframerate()
    except Exception:
        return None


def transcribe(path):
    """תמלול מלא בתצורה שנמדדה כטובה ביותר: הנחיה עברית קצרה, בלי רשימת מונחים."""
    boundary = "----gold" + str(int(time.time() * 1000))
    fields = {"language": "he", "preset": "accurate",
              "initial_prompt": "תמלול שיעור תורה בעברית תקנית."}
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
    with urllib.request.urlopen(request, timeout=900) as response:
        payload = json.load(response)
    if isinstance(payload.get("text"), str) and payload["text"].strip():
        return payload["text"].strip()
    return " ".join(s.get("text", "") for s in payload.get("segments") or []).strip()


def coverage(reference, hypothesis):
    """איזה חלק ממילות האמת מופיע בתמלול המלא."""
    ref = set(normalize(reference).split())
    hyp = set(normalize(hypothesis).split())
    return (len(ref & hyp) / len(ref)) if ref else 0.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="approved-ground-truth")
    parser.add_argument("--suggest", action="store_true",
                        help="לכתוב קובץ הצעות לעיון אנושי")
    args = parser.parse_args()

    folder = os.path.join(DATASETS, args.dataset)
    manifest_path = os.path.join(folder, "manifest.jsonl")
    if not os.path.exists(manifest_path):
        print("לא נמצא מאגר בשם", args.dataset)
        return 1

    rows = [json.loads(line) for line in io.open(manifest_path, encoding="utf-8") if line.strip()]

    server_up = False
    try:
        urllib.request.urlopen(SERVER + "/health", timeout=10)
        server_up = True
    except Exception:
        print("שרת התמלול אינו פעיל — מדווח יחס מילים בלבד, בלי תמלול מלא.\n")

    problems, suggestions = [], []
    print("  קטע      אודיו   מילים  מילים/שנייה   כיסוי    מצב")
    print("  " + "-" * 62)

    for row in sorted(rows, key=lambda r: r.get("audio", "")):
        rel = row.get("audio", "").replace("\\", os.sep)
        path = os.path.join(folder, rel)
        if not os.path.exists(path):
            continue
        seconds = audio_seconds(path)
        reference = (row.get("text") or row.get("sentence") or "").strip()
        words = len(normalize(reference).split())
        if not seconds or not words:
            continue

        ratio = words / seconds
        short = ratio < MIN_WORDS_PER_SECOND

        cover_txt, full = "   -  ", None
        if server_up and short:
            try:
                full = transcribe(path)
                cover_txt = "%5.0f%%" % (coverage(reference, full) * 100)
            except Exception as error:
                cover_txt = "שגיאה"
                print("      (תמלול נכשל: %s)" % type(error).__name__)

        state = "⚠ טקסט חלקי" if short else "✓ תקין"
        if short:
            problems.append(os.path.basename(path))
            if full:
                suggestions.append({"audio": rel, "seconds": round(seconds, 1),
                                    "reference_words": words,
                                    "words_per_second": round(ratio, 2),
                                    "existing_reference": reference,
                                    "full_transcription": full,
                                    "coverage": round(coverage(reference, full), 3)})

        print("  %-8s %5.1fש  %4d   %5.2f       %s   %s"
              % (os.path.basename(path)[:8], seconds, words, ratio, cover_txt, state))

    print()
    print("  %d מתוך %d קטעים עם טקסט חלקי" % (len(problems), len(rows)))
    print("  (הסף: %.1f מילים לשנייה. דיבור עברי טבעי: 2-3)" % MIN_WORDS_PER_SECOND)

    if args.suggest and suggestions:
        out = os.path.join(folder, "alignment_suggestions.json")
        io.open(out, "w", encoding="utf-8").write(
            json.dumps(suggestions, ensure_ascii=False, indent=2) + "\n")
        print()
        print("  נכתבו %d הצעות לעיון:" % len(suggestions))
        print("   ", out)
        print("  הקובץ אינו משנה דבר. כל שורה מציגה את הטקסט הקיים מול")
        print("  התמלול המלא, כדי שתחליט ידנית מה להשלים.")
    elif args.suggest:
        print()
        print("  אין הצעות לכתוב (השרת כבוי או שאין קטעים בעייתיים).")

    return len(problems)


if __name__ == "__main__":
    sys.exit(main())

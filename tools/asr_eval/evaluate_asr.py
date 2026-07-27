# -*- coding: utf-8 -*-
"""
כלי מדידת התקדמות לתמלול עברי (הגייה אשכנזית / תלמוד).

מחשב על סט הזהב הקפוא:
  - WER  (שגיאה ברמת מילה)
  - CER  (שגיאה ברמת תו) — בעברית לרוב המדד האינפורמטיבי יותר
  - דיוק מונחים (term recall) מול רשימת-מטרה (שמות אמוראים, ארמית, מונחי הלכה)
  - יחס אורך (גלאי הזיות/חיתוכים)
ורושם שורה אוטומטית ל-results.csv — זו "עקומת הלמידה" שלך.

שימוש:
  python evaluate_asr.py --ref golden_ref.txt --hyp hyp.txt --label "ivrit.ai + prompt"

קבצי --ref ו---hyp: שורה לכל אמירה (utterance), מיושרים שורה-מול-שורה.
"""
import argparse
import csv
import datetime as _dt
import os
import sys
from collections import Counter

try:
    import jiwer
except ImportError:
    sys.exit("חסר jiwer. התקן: pip install jiwer")

from hebrew_utils import normalize

RESULTS_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.csv")
CSV_FIELDS = [
    "timestamp", "label", "n_utts", "ref_words", "wer", "cer",
    "term_recall", "terms_total", "terms_missed", "len_ratio", "notes",
]


def read_lines(path):
    with open(path, encoding="utf-8") as f:
        return [ln.rstrip("\n") for ln in f if ln.strip() != ""]


def load_target_terms(path):
    if not path or not os.path.exists(path):
        return []
    terms = []
    for ln in read_lines(path):
        ln = ln.strip()
        if ln and not ln.startswith("#"):
            terms.append(normalize(ln))
    return terms


def term_recall(ref_norm_all, hyp_norm_all, terms):
    """לכל מונח-מטרה: כמה מופעים באמת הותאמו בפלט. מחזיר (recall, total, missed)."""
    ref_words = Counter(ref_norm_all.split())
    hyp_words = Counter(hyp_norm_all.split())
    total = 0
    matched = 0
    missed = []
    for t in terms:
        rc = ref_words.get(t, 0)
        if rc == 0:
            continue  # מונח שלא הופיע בסט הזהב — לא נמדד
        hc = hyp_words.get(t, 0)
        total += rc
        matched += min(rc, hc)
        if hc < rc:
            missed.append(t)
    recall = (matched / total) if total else float("nan")
    return recall, total, missed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True, help="קובץ תמלול-אמת (שורה לכל אמירה)")
    ap.add_argument("--hyp", required=True, help="קובץ פלט המודל (שורה לכל אמירה)")
    ap.add_argument("--label", required=True, help="תווית הניסוי, למשל 'ivrit.ai + prompt'")
    ap.add_argument("--terms", default="target_terms.txt", help="רשימת מונחי-מטרה")
    ap.add_argument("--notes", default="", help="הערות חופשיות לשורת הלוג")
    ap.add_argument("--no-log", action="store_true", help="אל תוסיף שורה ל-results.csv")
    args = ap.parse_args()

    ref_raw = read_lines(args.ref)
    hyp_raw = read_lines(args.hyp)
    if len(ref_raw) != len(hyp_raw):
        print(f"[אזהרה] מספר שורות שונה: ref={len(ref_raw)} hyp={len(hyp_raw)}. "
              f"משווה כמסמך אחד מאוחד.", file=sys.stderr)
        ref_raw = [" ".join(ref_raw)]
        hyp_raw = [" ".join(hyp_raw)]

    ref_norm = [normalize(x) for x in ref_raw]
    hyp_norm = [normalize(x) for x in hyp_raw]
    # סנן זוגות שבהם האמת ריקה אחרי נורמליזציה (jiwer לא אוהב reference ריק)
    pairs = [(r, h) for r, h in zip(ref_norm, hyp_norm) if r.strip()]
    ref_norm = [r for r, _ in pairs]
    hyp_norm = [h for _, h in pairs]

    wer = jiwer.wer(ref_norm, hyp_norm)
    cer = jiwer.cer(ref_norm, hyp_norm)

    ref_all = " ".join(ref_norm)
    hyp_all = " ".join(hyp_norm)
    n_ref_words = len(ref_all.split())
    n_hyp_words = len(hyp_all.split())
    len_ratio = (n_hyp_words / n_ref_words) if n_ref_words else float("nan")

    terms = load_target_terms(args.terms)
    recall, terms_total, missed = term_recall(ref_all, hyp_all, terms)

    print("=" * 56)
    print(f"  ניסוי: {args.label}")
    print("=" * 56)
    print(f"  אמירות שנמדדו : {len(ref_norm)}")
    print(f"  מילים באמת    : {n_ref_words}")
    print(f"  WER           : {wer*100:6.2f}%   (שגיאת מילה)")
    print(f"  CER           : {cer*100:6.2f}%   (שגיאת תו — המדד המרכזי בעברית)")
    if terms_total:
        print(f"  דיוק מונחים   : {recall*100:6.2f}%   ({terms_total} מופעים נמדדו)")
        if missed:
            shown = ", ".join(missed[:15])
            more = "" if len(missed) <= 15 else f" (+{len(missed)-15})"
            print(f"  מונחים שהוחמצו: {shown}{more}")
    else:
        print("  דיוק מונחים   : (אף מונח-מטרה לא הופיע בסט הזהב)")
    print(f"  יחס אורך      : {len_ratio:6.3f}   (רחוק מ-1.0 = הזיות/חיתוכים)")
    print("=" * 56)

    if not args.no_log:
        new = not os.path.exists(RESULTS_CSV)
        with open(RESULTS_CSV, "a", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
            if new:
                w.writeheader()
            w.writerow({
                "timestamp": _dt.datetime.now().isoformat(timespec="seconds"),
                "label": args.label,
                "n_utts": len(ref_norm),
                "ref_words": n_ref_words,
                "wer": round(wer * 100, 2),
                "cer": round(cer * 100, 2),
                "term_recall": (round(recall * 100, 2) if terms_total else ""),
                "terms_total": terms_total,
                "terms_missed": len(missed),
                "len_ratio": round(len_ratio, 3),
                "notes": args.notes,
            })
        print(f"נרשם ל: {RESULTS_CSV}")


if __name__ == "__main__":
    main()

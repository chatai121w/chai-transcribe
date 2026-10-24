#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""יומן ניסויים — מעקב מסודר אחרי כל מדידה, עם הגנה מפני אשליית התקדמות.

הבעיה שזה פותר:
    ניסוי 1 → 60    ניסוי 2 → 30    ניסוי 3 → 50
    נדמה ש"התקדמנו" מ-30 ל-50. בפועל ירדנו מ-60 ל-50.
    בלי היסטוריה מסודרת הטעות הזו קורית כמעט תמיד.

לכן כל מדידה כאן נשמרת עם:
    • התצורה המלאה שבה רצה (מודל, הגדרות, מונחים, הנחיה)
    • טביעת אצבע של סדרת הבדיקה — כדי שלא נשווה תפוחים לתפוזים
    • התוצאה לכל רמת קושי בנפרד
וכל השוואה היא תמיד **מול השיא**, לא מול הניסוי הקודם.

    python scripts/experiment_log.py run --label "תיאור הניסוי"
    python scripts/experiment_log.py history
    python scripts/experiment_log.py best
    python scripts/experiment_log.py compare <מזהה> <מזהה>
"""
import argparse, hashlib, io, json, os, re, sys, time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BENCH = os.path.join(ROOT, "benchmark_private")
LOG = os.path.join(BENCH, "experiments.jsonl")

TIERS = {"plain": "עברית רגילה",
         "lecture": "שיעור תורה",
         "lk": "לשון הקודש"}


def normalize(text):
    text = re.sub(r"[^֐-׿\s]", " ", text or "")
    text = text.replace("׳", "").replace("״", "")
    return re.sub(r"\s+", " ", text).strip()


def align_correct(ref_words, hyp_words):
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
    correct, i, j = 0, n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and ref_words[i - 1] == hyp_words[j - 1] and d[i][j] == d[i - 1][j - 1]:
            correct += 1; i -= 1; j -= 1
        elif i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + 1:
            i -= 1; j -= 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            i -= 1
        else:
            j -= 1
    return correct


def load_benchmark():
    folder = os.path.join(BENCH, "approved")
    if not os.path.isdir(folder):
        return []
    rows = []
    for f in sorted(os.listdir(folder)):
        if f.endswith(".json"):
            rows.append(json.load(io.open(os.path.join(folder, f), encoding="utf-8")))
    return rows


def benchmark_fingerprint(rows):
    """טביעת אצבע של סדרת הבדיקה.

    בלי זה אפשר בטעות להשוות ריצה על 20 קטעים לריצה על 40, ולחשוב
    שהמודל השתפר כשבעצם רק סדרת הבדיקה השתנתה.
    """
    payload = json.dumps(
        sorted([(r["name"], r["tier"], normalize(r["text"])) for r in rows]),
        ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]


def wilson_interval(correct, total, z=1.96):
    """רווח סמך של 95 אחוז לשיעור ההצלחה (שיטת ווילסון).

    למה זה חובה כאן: בסדרה של 112 מילים, הפרש של 2 מילים הוא 1.8 נקודות
    אחוז — ונמצא לגמרי בתוך הרעש. בלי רווח סמך קל מאוד להכריז על "שיפור"
    שהוא בעצם תנודה אקראית, ואז לבנות עליו החלטות.
    ווילסון נבחר ולא הנוסחה הפשוטה כי הוא נשאר אמין גם בשיעורים קיצוניים
    (17 אחוז בלשון הקודש) ובמדגמים קטנים.
    """
    if not total:
        return (0.0, 0.0)
    p = correct / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    margin = z * ((p * (1 - p) / total + z * z / (4 * total * total)) ** 0.5) / denom
    return (max(0.0, (centre - margin) * 100), min(100.0, (centre + margin) * 100))


def significant_difference(c1, n1, c2, n2):
    """האם ההפרש בין שתי מדידות חורג מהרעש.

    מחזיר (מובהק, הפרש באחוזים, רוחב הרעש). ההשוואה היא בין שני שיעורים
    בלתי תלויים; אם רווחי הסמך נחתכים — ההפרש אינו מובהק ואין להציג אותו
    כשיפור או כנסיגה.
    """
    if not n1 or not n2:
        return (False, 0.0, 0.0)
    p1, p2 = c1 / n1, c2 / n2
    se = ((p1 * (1 - p1) / n1) + (p2 * (1 - p2) / n2)) ** 0.5
    diff = (p2 - p1) * 100
    noise = 1.96 * se * 100
    return (abs(diff) > noise, diff, noise)


def min_detectable(total, p=0.5):
    """כמה נקודות אחוז צריך הפרש כדי להיות מובהק בגודל המדגם הזה."""
    if not total:
        return 100.0
    return 1.96 * ((2 * p * (1 - p) / total) ** 0.5) * 100


def load_log():
    if not os.path.exists(LOG):
        return []
    out = []
    for line in io.open(LOG, encoding="utf-8"):
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def append_log(entry):
    os.makedirs(BENCH, exist_ok=True)
    with io.open(LOG, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def best_per_tier(entries, fingerprint=None):
    """השיא שהושג בכל רמה — רק מריצות על אותה סדרת בדיקה."""
    best = {}
    for e in entries:
        if fingerprint and e.get("benchmark") != fingerprint:
            continue
        # ריצה חלקית לא יכולה להיות שיא — חלק מהקטעים לא נמדדו בה כלל,
        # ולכן התוצאה שלה אינה מושווה לריצה מלאה.
        if e.get("reliable") is False:
            continue
        for tier, res in (e.get("results") or {}).items():
            if not res.get("ref"):
                continue
            pct = res["correct"] / res["ref"] * 100
            if tier not in best or pct > best[tier]["pct"]:
                best[tier] = {"pct": pct, "id": e["id"], "label": e.get("label", ""),
                              "correct": res["correct"], "ref": res["ref"]}
    return best


# ──────────────────────────── פקודות ────────────────────────────

def cmd_run(args):
    from build_clean_benchmark import transcribe, server_alive

    rows = load_benchmark()
    if not rows:
        print("סדרת הבדיקה ריקה. הוסף קטעים עם build_clean_benchmark.py")
        return 1
    if not server_alive():
        print("שרת התמלול אינו פעיל.")
        return 1

    fingerprint = benchmark_fingerprint(rows)
    entries = load_log()
    previous_best = best_per_tier(entries, fingerprint)

    config = {"model": args.model, "preset": args.preset,
              "language": args.language, "hotwords": args.hotwords or None,
              "prompt": args.prompt or None}

    print("ניסוי: %s" % (args.label or "ללא תיאור"))
    print("מודל : %s" % args.model)
    print("סדרה : %s (%d קטעים)" % (fingerprint, len(rows)))
    print()

    results = {}
    failures = 0
    attempted = 0
    for tier in TIERS:
        sub = [r for r in rows if r.get("tier") == tier]
        if not sub:
            continue
        total_c = total_r = 0
        for row in sub:
            attempted += 1
            audio = os.path.join(BENCH, "audio", row["audio"])
            fields = {"model": args.model, "preset": args.preset,
                      "language": args.language}
            if args.hotwords:
                fields["hotwords"] = args.hotwords
            if args.prompt:
                fields["initial_prompt"] = args.prompt
            try:
                hyp = transcribe(audio, model=args.model, language=args.language)
            except Exception as error:
                failures += 1
                print("  שגיאה בקטע %s: %s" % (row.get("name", "?"),
                                               type(error).__name__))
                continue
            total_c += align_correct(normalize(row["text"]).split(),
                                     normalize(hyp).split())
            total_r += len(normalize(row["text"]).split())
        if total_r:
            results[tier] = {"correct": total_c, "ref": total_r}

    # ניסוי שנכשל אסור שייכנס ליומן כאילו רץ. בפעם הראשונה שזה קרה, כל
    # הבקשות החזירו שגיאה והיומן שמר רשומה ריקה שנראית בהיסטוריה כמו ניסוי
    # תקין — וזו בדיוק הדרך שבה מצטבר בלגן.
    if failures:
        print()
        print("  ❌ %d מתוך %d הקטעים נכשלו." % (failures, attempted))
        if not results:
            print("     לא התקבלה אף תוצאה — הניסוי לא נרשם ביומן.")
            print("     בדוק את יומן השרת וחזור על הניסוי.")
            return 1
        print("     ההרצה חלקית. היא תירשם, אבל מסומנת כלא אמינה.")

    entry = {"id": time.strftime("%Y%m%d-%H%M%S"),
             "label": args.label or "",
             "benchmark": fingerprint,
             "clips": len(rows),
             "attempted": attempted,
             "failures": failures,
             "reliable": failures == 0,
             "config": config,
             "results": results}
    append_log(entry)

    print("=" * 86)
    print("  %-14s %-20s %-22s %s" % ("רמה", "התוצאה", "רווח סמך 95%", "מול השיא"))
    print("  " + "-" * 82)
    regressed, improved = [], []
    for tier, label in TIERS.items():
        if tier not in results:
            continue
        c, r = results[tier]["correct"], results[tier]["ref"]
        pct = c / r * 100
        low, high = wilson_interval(c, r)
        now = "%d/%d  %.2f%%" % (c, r, pct)
        band = "%.1f%% – %.1f%%" % (low, high)

        if tier in previous_best:
            pb = previous_best[tier]
            sig, diff, noise = significant_difference(pb["correct"], pb["ref"], c, r)
            if not sig:
                verdict = "= בתוך הרעש (%+.2f, רעש ±%.2f)" % (diff, noise)
            elif diff > 0:
                verdict = "▲ שיא חדש %+.2f  מובהק" % diff
                improved.append(tier)
            else:
                verdict = "▼ נסיגה   %+.2f  מובהק" % diff
                regressed.append(tier)
        else:
            verdict = "ראשון — אין מול מה להשוות"
        print("  %-14s %-20s %-22s %s" % (label, now, band, verdict))

    print()
    print("  רגישות המדידה — ההפרש המזערי שניתן להוכיח בגודל המדגם הזה:")
    for tier, label in TIERS.items():
        if tier in results:
            r = results[tier]["ref"]
            print("     %-14s %d מילים → צריך הפרש של %.1f נקודות לפחות"
                  % (label, r, min_detectable(r)))

    print()
    print("  נשמר כ: %s" % entry["id"])

    if regressed:
        print()
        print("  ⚠️  נסיגה מובהקת מול השיא ב: %s"
              % ", ".join(TIERS[t] for t in regressed))
        print("      אל תתאר את הניסוי הזה כשיפור בשום צורה.")
    if not improved and not regressed and previous_best:
        print()
        print("  ℹ️  שום הפרש כאן אינו מובהק. אם נדמה שהשתפרת — לא השתפרת.")
        print("      להגדיל את סדרת הבדיקה כדי שאפשר יהיה להכריע.")
    return 0


def cmd_history(args):
    entries = load_log()
    if not entries:
        print("אין עדיין ניסויים.")
        return 0
    print("  %-17s %-26s %s" % ("מזהה", "תיאור",
                                "".join("%-20s" % TIERS[t] for t in TIERS)))
    print("  " + "-" * 104)
    for e in entries:
        cells = ""
        for tier in TIERS:
            res = (e.get("results") or {}).get(tier)
            if res and res.get("ref"):
                cells += "%-20s" % ("%d/%d %.2f%%" % (res["correct"], res["ref"],
                                                      res["correct"] / res["ref"] * 100))
            else:
                cells += "%-20s" % "—"
        flag = "" if e.get("reliable", True) else "  ⚠ חלקי"
        print("  %-17s %-26s %s%s" % (e["id"], (e.get("label") or "")[:26],
                                      cells, flag))

    print()
    print("  השיא בכל רמה, מתוך כל ההיסטוריה:")
    for fp in {e.get("benchmark") for e in entries}:
        sub = [e for e in entries if e.get("benchmark") == fp]
        for tier, res in best_per_tier(sub, fp).items():
            low, high = wilson_interval(res["correct"], res["ref"])
            print("     %-14s %d/%d  %.2f%%  (רווח סמך %.1f–%.1f)  ניסוי %s"
                  % (TIERS[tier], res["correct"], res["ref"], res["pct"],
                     low, high, res["id"]))
    print()
    groups = {}
    for e in entries:
        groups.setdefault(e.get("benchmark", "?"), 0)
        groups[e["benchmark"]] += 1
    if len(groups) > 1:
        print("  ⚠️  הניסויים רצו על %d סדרות בדיקה שונות:" % len(groups))
        for fp, n in groups.items():
            print("        %s — %d ניסויים" % (fp, n))
        print("      אסור להשוות בין סדרות שונות. ההשוואה תקפה רק בתוך אותה סדרה.")
    return 0


def cmd_best(args):
    entries = load_log()
    if not entries:
        print("אין עדיין ניסויים.")
        return 0
    groups = {}
    for e in entries:
        groups.setdefault(e.get("benchmark", "?"), []).append(e)
    for fp, sub in groups.items():
        print("סדרת בדיקה %s — %d ניסויים" % (fp, len(sub)))
        for tier, res in best_per_tier(sub, fp).items():
            print("   %-16s %d/%d (%.1f%%)   ניסוי %s  %s"
                  % (TIERS[tier], res["correct"], res["ref"], res["pct"],
                     res["id"], res["label"][:28]))
        print()
    return 0


def cmd_compare(args):
    entries = {e["id"]: e for e in load_log()}
    a, b = entries.get(args.first), entries.get(args.second)
    if not a or not b:
        print("לא נמצא ניסוי. הרץ history לרשימה.")
        return 1
    if a.get("benchmark") != b.get("benchmark"):
        print("⚠️  שני הניסויים רצו על סדרות בדיקה שונות — ההשוואה חסרת משמעות.")
        return 1
    print("  %s   %s" % (a["id"], a.get("label", "")))
    print("  %s   %s" % (b["id"], b.get("label", "")))
    print()
    print("  %-14s %-16s %-16s %s" % ("רמה", "ניסוי א", "ניסוי ב", "הכרעה"))
    print("  " + "-" * 74)
    for tier, label in TIERS.items():
        ra = (a.get("results") or {}).get(tier)
        rb = (b.get("results") or {}).get(tier)
        if not ra or not rb:
            continue
        pa = ra["correct"] / ra["ref"] * 100
        pb = rb["correct"] / rb["ref"] * 100
        sig, diff, noise = significant_difference(ra["correct"], ra["ref"],
                                                  rb["correct"], rb["ref"])
        left = "%d/%d %.2f%%" % (ra["correct"], ra["ref"], pa)
        right = "%d/%d %.2f%%" % (rb["correct"], rb["ref"], pb)
        if not sig:
            verdict = "בתוך הרעש (%+.2f, ±%.2f)" % (diff, noise)
        else:
            verdict = ("ב' עדיף %+.2f מובהק" if diff > 0
                       else "א' עדיף %+.2f מובהק") % diff
        print("  %-14s %-16s %-16s %s" % (label, left, right, verdict))
    print()
    print("  הכרעה מובהקת פירושה שההפרש חורג מרווח הסמך של שתי המדידות.")
    print("  הפרש שאינו מובהק אינו ראיה לשיפור ואינו ראיה לנסיגה.")
    return 0


def main():
    parser = argparse.ArgumentParser(description="יומן ניסויים")
    sub = parser.add_subparsers(dest="cmd")

    p = sub.add_parser("run", help="להריץ מדידה ולרשום ביומן")
    p.add_argument("--label", default="")
    p.add_argument("--model", default="ivrit-ai/whisper-large-v3-ct2")
    p.add_argument("--preset", default="balanced")
    p.add_argument("--language", default="he")
    p.add_argument("--hotwords", default=None)
    p.add_argument("--prompt", default=None)

    sub.add_parser("history", help="כל הניסויים לפי סדר")
    sub.add_parser("best", help="השיא בכל רמה")

    pc = sub.add_parser("compare", help="להשוות שני ניסויים")
    pc.add_argument("first")
    pc.add_argument("second")

    args = parser.parse_args()
    if args.cmd == "run":
        return cmd_run(args)
    if args.cmd == "history":
        return cmd_history(args)
    if args.cmd == "best":
        return cmd_best(args)
    if args.cmd == "compare":
        return cmd_compare(args)
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())

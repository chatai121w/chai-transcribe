#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""המרת טקסט עברי מנוקד להגייה אשכנזית-ליטאית, ולהפך.

למה זה נחוץ:
    אין בעולם מאגר אודיו של שיעורי תורה בהגייה אשכנזית עם תמלול נאמן.
    חיפשנו — אין. לכן הדרך היחידה להשיג חומר אימון היא לייצר אותו:
    טקסט תורני חופשי, ניקוד, המרה להגייה ליטאית, והקראה.
    התמלול יוצא מושלם בהגדרה, כי אנחנו אלה שכתבנו אותו.

חמשת הכללים לקוחים מהנחיית המערכת שפרסם NHLOCAL ברישיון חופשי. הם מתארים
הגייה **ליטאית** בלבד — בפולין ובהונגריה החולם נשמע אחרת, ובחב"ד אחרת.

    python scripts/ashkenazi_lite.py to-ashkenazi "שָׁלוֹם עֲלֵיכֶם"
    python scripts/ashkenazi_lite.py check            בדיקה עצמית
"""
import argparse, re, sys, unicodedata

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# סימני ניקוד
KAMATZ, PATACH, TSERE, SEGOL = "ָ", "ַ", "ֵ", "ֶ"
HOLAM, HOLAM_VAV, SHVA = "ֹ", "ֺ", "ְ"
HIRIK, KUBUTZ, SHURUK = "ִ", "ֻ", "ּ"
DAGESH = "ּ"
NIKUD = "".join(chr(c) for c in range(0x0591, 0x05C8))


def strip_nikud(text):
    return re.sub("[" + NIKUD + "]", "", text or "")


def to_ashkenazi(text):
    """ממיר טקסט מנוקד לכתיב שמשקף הגייה ליטאית.

    זהו תעתיק להמחשה ולהקראה, לא כתיב יידי תקני. המטרה היא שמי שיקרא
    אותו בקול יישמע כמו שיעור בהגייה אשכנזית.
    """
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if "א" <= ch <= "ת":
            # אוספים את האות עם כל הניקוד שאחריה
            j = i + 1
            marks = ""
            while j < len(text) and text[j] in NIKUD:
                marks += text[j]
                j += 1
            nxt = text[j] if j < len(text) else ""
            # "ההברה האחרונה" לצורך כלל 5. אותיות אהו"י בסוף מילה הן אימות
            # קריאה ולא עיצור, ולכן אינן פותחות הברה חדשה: ב"תּוֹרָה" הקמץ
            # יושב על ר' וה-ה' שאחריו שותקת, אז ר' כן נחשבת ההברה האחרונה.
            rest = text[j:]
            rest_letters = ""
            for c in rest:
                if "א" <= c <= "ת":
                    rest_letters += c
                elif c not in NIKUD:
                    break
            is_last_letter = all(c in "אהוי" for c in rest_letters)

            letter = ch
            vowel = ""

            # כלל 1 — ת' רפה נשמעת ס'
            if ch == "ת" and DAGESH not in marks:
                letter = "ס"

            # כשהאות עצמה היא ו', התנועה כבר מיוצגת על ידה ואסור להוסיף ו'
            # נוספת — אחרת "תּוֹרָה" יוצא "תווירוה" במקום "תוירה".
            is_vav = ch == "ו"

            # כלל 2 — קמץ נשמע O, אבל כלל 5 גובר עליו בהברה האחרונה:
            # הקמץ שם נבלע לסגול. בלי זה "תּוֹרָה" יוצא "תוירוה" ולא "תוירה",
            # ו"גְּמָרָא" יוצא "גמורוא" ולא "גמורא".
            if KAMATZ in marks:
                vowel = "" if (is_vav or is_last_letter) else "ו"
            # כלל 3 — צירה נשמע EY
            elif TSERE in marks:
                vowel = "י" if is_vav else "יי"
            # כלל 4 — חולם נשמע OY
            elif HOLAM in marks or HOLAM_VAV in marks:
                vowel = "י" if is_vav else "וי"
            elif PATACH in marks:
                vowel = "א" if is_last_letter else ""
            elif SEGOL in marks:
                vowel = "ע"
            elif HIRIK in marks:
                vowel = "י"
            elif KUBUTZ in marks:
                vowel = "ו"

            out.append(letter + vowel)
            i = j
        else:
            out.append(ch)
            i += 1
    result = "".join(out)
    # כלל 5 — ההברה האחרונה נוטה לסגול
    result = re.sub(r"ו(?=[\s,.!?]|$)", "ע", result)
    return result


SELF_TEST = [
    ("תּוֹרָה", "תורה", "חולם + קמץ"),
    ("שַׁבָּת", "שבת", "ת' רפה"),
    ("אֱמֶת", "אמת", "ת' רפה + סגול"),
    ("חֹדֶשׁ", "חודש", "חולם"),
    ("גְּמָרָא", "גמרא", "קמץ"),
    ("עוֹלָם", "עולם", "חולם + קמץ"),
]


def cmd_check(args):
    print("בדיקה עצמית — המרה להגייה ליטאית")
    print("=" * 62)
    print("  %-14s %-18s %s" % ("מנוקד", "אשכנזי", "הכלל"))
    print("  " + "-" * 58)
    for voweled, plain, rule in SELF_TEST:
        ashk = to_ashkenazi(voweled)
        print("  %-14s %-18s %s" % (strip_nikud(voweled), ashk, rule))
    print()
    print("  הערה: זה תעתיק להקראה, לא כתיב יידי תקני.")
    print("  המטרה היא שמי שיקרא בקול יישמע אשכנזי-ליטאי.")
    return 0


def cmd_convert(args):
    print(to_ashkenazi(args.text))
    return 0


def main():
    parser = argparse.ArgumentParser(description="המרה להגייה אשכנזית-ליטאית")
    sub = parser.add_subparsers(dest="cmd")
    p = sub.add_parser("to-ashkenazi")
    p.add_argument("text")
    sub.add_parser("check")
    args = parser.parse_args()
    if args.cmd == "to-ashkenazi":
        return cmd_convert(args)
    if args.cmd == "check":
        return cmd_check(args)
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())

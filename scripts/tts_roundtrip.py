#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""בדיקת מעגל סגור: הקראה ואז תמלול בחזרה.

למה זאת הבדיקה האמיתית:
    "יש קול" ו"האורך תואם" אינם אומרים שהקול נשמע כמו מילים בעברית.
    אפשר להפיק רעש באורך הנכון ובעוצמה הנכונה. הדרך היחידה לדעת
    אובייקטיבית אם יצאה עברית מובנת היא לתת למנוע תמלול להאזין לה
    ולראות מה הוא שומע.

    אם התמלול מחזיר את המילים שכתבנו — הקול עברית. אם הוא מחזיר
    ג'יבריש, הקול אינו עברית, ולא משנה כמה הוא נשמע חלק.

    וזה גם בדיוק המדד שמעניין אותנו לאימון: טקסט מלאכותי שהמנוע
    שלנו לא מצליח לתמלל אינו שווה כלום כחומר אימון.

    python scripts/tts_roundtrip.py
"""
import argparse
import os
import re
import sys
import time
import wave
import unicodedata

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "server"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np  # noqa: E402

#: פסוקים ומשפטים מנוקדים, שהתמלול שלהם ידוע לנו בוודאות.
SENTENCES = [
    ("בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ",
     "בראשית ברא אלהים את השמים ואת הארץ"),
    ("שַׁבָּת שָׁלוֹם וּמְבֹרָךְ",
     "שבת שלום ומבורך"),
    ("בָּרוּךְ אַתָּה אֲדֹנָי אֱלֹהֵינוּ מֶלֶךְ הָעוֹלָם",
     "ברוך אתה אדני אלהינו מלך העולם"),
    ("הַגְּמָרָא אוֹמֶרֶת שֶׁהַדָּבָר תָּלוּי בְּמַחֲלֹקֶת",
     "הגמרא אומרת שהדבר תלוי במחלוקת"),
]

NIKUD = re.compile(r"[֑-ׇ]")


def normalise(text):
    """משווה מילים בלי ניקוד, בלי פיסוק ובלי אותיות סופיות שונות."""
    text = unicodedata.normalize("NFC", text or "")
    text = NIKUD.sub("", text)
    text = re.sub(r"[^א-ת\s]", " ", text)
    finals = {"ך": "כ", "ם": "מ", "ן": "נ",
              "ף": "פ", "ץ": "צ"}
    text = "".join(finals.get(c, c) for c in text)
    return [w for w in text.split() if w]


def align(ref, hyp):
    """מיישר מילה-למילה ומחזיר כמה נכונות.

    ספירה פשוטה של מילים זהות אינה מספיקה: מילה שהוחלפה ומילה
    שנשמטה הן שתי תקלות שונות, וצריך להבדיל ביניהן.
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

    i, j = n, m
    correct = sub = dele = ins = 0
    pairs = []
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1):
            if ref[i - 1] == hyp[j - 1]:
                correct += 1
                pairs.append((ref[i - 1], hyp[j - 1], "נכון"))
            else:
                sub += 1
                pairs.append((ref[i - 1], hyp[j - 1], "הוחלף"))
            i -= 1
            j -= 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            dele += 1
            pairs.append((ref[i - 1], "—", "נשמט"))
            i -= 1
        else:
            ins += 1
            pairs.append(("—", hyp[j - 1], "נוסף"))
            j -= 1
    pairs.reverse()
    return {"correct": correct, "substituted": sub, "deleted": dele,
            "inserted": ins, "total": n, "pairs": pairs}


def save_wav(path, wav, sr):
    pcm = (np.clip(wav, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def main():
    ap = argparse.ArgumentParser(description="הקראה ותמלול בחזרה")
    ap.add_argument("--out", default=os.path.join(HERE, "scripts", "_roundtrip"))
    ap.add_argument("--steps", type=int, default=24)
    ap.add_argument("--cfg", type=float, default=3.0)
    ap.add_argument("--accent", default="ashkenazi",
                    choices=["ashkenazi", "israeli", "ashkenazi-polish", "all"])
    ap.add_argument("--level", default="prayer",
                    choices=["reading", "prayer", "lesson"])
    ap.add_argument("--model", default=None, help="מנוע התמלול")
    args = ap.parse_args()

    import bluetts_engine as be
    import hebrew_phonemes as hp

    engine = be.get_engine()
    if engine.missing_files():
        print("מנוע ההקראה אינו מותקן:", engine.missing_files())
        return 1

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("חבילת התמלול אינה מותקנת. אי אפשר לסגור את המעגל.")
        return 1

    os.makedirs(args.out, exist_ok=True)
    accents = (["ashkenazi", "israeli", "ashkenazi-polish"]
               if args.accent == "all" else [args.accent])

    print("=" * 74)
    print("בדיקת מעגל סגור — הקראה ואז תמלול בחזרה")
    print("=" * 74)
    engine.load()
    print("ההקראה תרוץ על:", ", ".join(engine.providers()))

    model_name = args.model or "ivrit-ai/whisper-large-v3-ct2"
    print(f"מנוע התמלול: {model_name}")
    print(f"רמת הלשון: {hp.LEVELS[args.level]['label']}")
    t0 = time.time()
    asr = WhisperModel(model_name, device="cuda", compute_type="float16")
    print(f"נטען בתוך {time.time() - t0:.0f} שניות.")
    print()

    grand = {a: {"correct": 0, "total": 0, "sub": 0, "del": 0, "ins": 0} for a in accents}

    for accent in accents:
        label = hp.ACCENTS[accent].label
        print("=" * 74)
        print(f"הגייה: {label}")
        print("=" * 74)

        for idx, (voweled, plain) in enumerate(SENTENCES, 1):
            pr = hp.phonemize(voweled, accent=accent, level=args.level)
            if pr.unsupported:
                print(f"{idx}. דילוג — סימנים שאינם בטבלה: {pr.unsupported}")
                continue

            t0 = time.time()
            wav, sr = engine.synthesize(
                pr.ipa, voice="female", steps=args.steps, cfg=args.cfg, seed=1234)
            synth_time = time.time() - t0

            path = os.path.join(args.out, f"{accent}_{idx}.wav")
            save_wav(path, wav, sr)

            t0 = time.time()
            segments, _info = asr.transcribe(
                path, language="he", beam_size=5, vad_filter=False)
            heard = " ".join(s.text.strip() for s in segments).strip()
            asr_time = time.time() - t0

            ref, hyp = normalise(plain), normalise(heard)
            a = align(ref, hyp)
            pct = (a["correct"] / a["total"] * 100) if a["total"] else 0.0

            g = grand[accent]
            g["correct"] += a["correct"]; g["total"] += a["total"]
            g["sub"] += a["substituted"]; g["del"] += a["deleted"]; g["ins"] += a["inserted"]

            print(f"{idx}. {plain}")
            print(f"   צלילים:  {pr.ipa}")
            print(f"   נשמע:    {heard or '(שקט)'}")
            print(f"   תוצאה:   {a['correct']} מתוך {a['total']} מילים נכונות "
                  f"({pct:.0f} אחוז) · הוחלפו {a['substituted']} · "
                  f"נשמטו {a['deleted']} · נוספו {a['inserted']}")
            print(f"   זמנים:   הקראה {synth_time:.1f} שניות, תמלול {asr_time:.1f} שניות, "
                  f"קול {len(wav)/sr:.1f} שניות")
            bad = [p for p in a["pairs"] if p[2] != "נכון"]
            if bad:
                print("   פירוט:   " + " · ".join(f"{r}→{h} ({k})" for r, h, k in bad[:6]))
            print()

    print("=" * 74)
    print("סיכום")
    print("=" * 74)
    for accent in accents:
        g = grand[accent]
        if not g["total"]:
            continue
        pct = g["correct"] / g["total"] * 100
        print(f"{hp.ACCENTS[accent].label}:")
        print(f"   {g['correct']} מתוך {g['total']} מילים נכונות = {pct:.1f} אחוז")
        print(f"   הוחלפו {g['sub']} · נשמטו {g['del']} · נוספו {g['ins']}")
    print()
    print("מה המספר הזה אומר:")
    print("  גבוה  — הקול עברית מובנת, והוא שווה כחומר אימון.")
    print("  נמוך  — או שההקראה אינה מובנת, או שהמנוע אינו מכיר את ההגייה.")
    print("  בהגייה אשכנזית מספר נמוך הוא בדיוק מה שמצפים: המנוע לא")
    print("  אומן עליה. זאת הבעיה שאנחנו באים לפתור, ולא תקלה.")
    print(f"\nהקבצים נשמרו ב: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

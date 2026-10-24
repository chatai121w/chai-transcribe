#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""בדיקת קצה-לקצה של מנוע ההקראה.

מה זה בודק בפועל, ולא רק "לא קרסה":

    1. שהקול שיצא אינו שקט. מנוע תקוע מחזיר אפסים, וזה עובר כל
       בדיקה שרק סופרת שניות.
    2. שאורך הקול תואם למה שחזאי האורך הבטיח. פער גדול פירושו
       שהקיפול בין הצירים שגוי, וזה יוצר רעש שנשמע כמו דיבור.
    3. שהפסגות בטווח. המנוע הזה מוציא עד 1.5, ושמירה בלי הגבלה
       חותכת אותן בשקט.
    4. שהגייה אשכנזית וישראלית מפיקות קול **שונה**. אם הן זהות,
       הצלילים לא הגיעו למנוע — והמתג בממשק אינו עושה כלום.

    python scripts/test_bluetts.py
    python scripts/test_bluetts.py --out C:\\temp   שמירת הקבצים
"""
import argparse
import os
import sys
import time
import wave

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np  # noqa: E402

VERSE = "בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ"
SHORT = "שַׁבָּת שָׁלוֹם"


def save_wav(path, wav, sr):
    pcm = (np.clip(wav, -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def describe(wav, sr, label):
    """מודד את הקול ואומר בעברית אם הוא תקין."""
    n = len(wav)
    seconds = n / sr if sr else 0.0
    peak = float(np.max(np.abs(wav))) if n else 0.0
    rms = float(np.sqrt(np.mean(wav.astype(np.float64) ** 2))) if n else 0.0
    # שקט מוחלט או כמעט-שקט הוא הכשל הנפוץ, והוא עובר כל בדיקה
    # שרק סופרת שניות.
    silent = rms < 1e-4
    # חלק אפסי גדול פירושו שהקול נקטע.
    zero_frac = float(np.mean(np.abs(wav) < 1e-5)) if n else 1.0

    print(f"  {label}")
    print(f"     אורך:        {seconds:7.2f} שניות ({n} דגימות)")
    print(f"     פסגה:        {peak:7.4f}  {'תקין' if peak <= 1.0 else 'חורג מהטווח'}")
    print(f"     עוצמה:       {rms:7.4f}  {'שקט!' if silent else 'יש קול'}")
    print(f"     חלק שקט:     {zero_frac * 100:6.1f} אחוז")
    return {"seconds": seconds, "peak": peak, "rms": rms,
            "silent": silent, "zero_frac": zero_frac, "wav": wav}


def main():
    ap = argparse.ArgumentParser(description="בדיקת מנוע ההקראה")
    ap.add_argument("--out", default=None, help="תיקייה לשמירת הקבצים")
    ap.add_argument("--steps", type=int, default=16)
    ap.add_argument("--cfg", type=float, default=3.0)
    ap.add_argument("--voice", default=None)
    args = ap.parse_args()

    import bluetts_engine as be
    import hebrew_phonemes as hp

    print("=" * 70)
    print("בדיקת מנוע ההקראה")
    print("=" * 70)

    engine = be.get_engine()
    missing = engine.missing_files()
    if missing:
        print("המנוע אינו מותקן במלואו. חסרים:")
        for m in missing:
            print("   ", m)
        return 1
    print("כל הקבצים קיימים.")

    t0 = time.time()
    engine.load()
    print(f"הטעינה לקחה {time.time() - t0:.1f} שניות.")
    print("ירוץ על:", ", ".join(engine.providers()))

    voices = engine.list_voices()
    print(f"קולות זמינים ({len(voices)}):")
    hebrew_voice = None
    for v in voices:
        info = engine.voice_info(v)
        src = str(info.get("source") or "")
        is_he = "hebrew" in src.lower()
        if is_he and hebrew_voice is None:
            hebrew_voice = v
        print(f"    {v:22} {'עברי' if is_he else 'אנגלי'}  ({os.path.basename(src)})")

    voice = args.voice or hebrew_voice or (voices[0] if voices else None)
    if not voice:
        print("אין אף קול. אי אפשר להקריא.")
        return 1
    print(f"נבחר הקול: {voice}")

    # ---------------------------------------------------- המרת הצלילים
    print()
    print("-" * 70)
    print("המרת הצלילים")
    print("-" * 70)
    results = {}
    for accent in ("ashkenazi", "israeli"):
        pr = hp.phonemize(VERSE, accent=accent)
        label = hp.ACCENTS[accent].label
        print(f"  {label}:")
        print(f"     {pr.ipa}")
        if pr.unsupported:
            print(f"     !! סימנים שאינם בטבלת המנוע: {pr.unsupported}")
            return 1
        if pr.warnings:
            for w in pr.warnings:
                print(f"     אזהרה: {w}")
        results[accent] = pr

    if results["ashkenazi"].ipa == results["israeli"].ipa:
        print("  !! שתי ההגיות הפיקו צלילים זהים. זה באג.")
        return 1
    print("  שתי ההגיות שונות, כצפוי.")

    # ---------------------------------------------------- ההקראה בפועל
    print()
    print("-" * 70)
    print(f"הקראה בפועל (צעדים={args.steps}, היצמדות={args.cfg})")
    print("-" * 70)

    measured = {}
    for accent in ("ashkenazi", "israeli"):
        ipa = results[accent].ipa
        label = hp.ACCENTS[accent].label
        t0 = time.time()
        try:
            wav, sr = engine.synthesize(
                ipa, voice=voice, steps=args.steps, cfg=args.cfg, seed=1234)
        except be.BlueTtsError as exc:
            print(f"  {label}: נכשל — {exc}")
            return 1
        took = time.time() - t0
        info = describe(wav, sr, f"{label}  (נוצר ב-{took:.1f} שניות)")
        measured[accent] = info

        # האורך שהמנוע חזה מול האורך שיצא
        ids = engine.encode_text(ipa)
        want = engine.predict_duration(ids, engine.load_voice(voice)["style_dp"])
        gap = abs(info["seconds"] - want)
        status = "תקין" if gap < 0.35 else "פער גדול — הקיפול בין הצירים חשוד"
        print(f"     אורך שנחזה: {want:7.2f} שניות, פער {gap:.3f} — {status}")
        print()

        if args.out:
            os.makedirs(args.out, exist_ok=True)
            path = os.path.join(args.out, f"bluetts_{accent}.wav")
            save_wav(path, wav, sr)
            print(f"     נשמר: {path}")

    # ---------------------------------------------------- המסקנות
    print("-" * 70)
    print("מסקנות")
    print("-" * 70)
    failures = []
    for accent, info in measured.items():
        label = hp.ACCENTS[accent].label
        if info["silent"]:
            failures.append(f"{label}: הקול שקט — המנוע לא הפיק דבר.")
        if info["peak"] > 1.0:
            failures.append(f"{label}: פסגה {info['peak']:.2f} מעל הטווח.")
        if info["zero_frac"] > 0.5:
            failures.append(f"{label}: יותר ממחצית הקול שקטה.")
        if info["seconds"] < 0.5:
            failures.append(f"{label}: הקול קצר מחצי שנייה.")

    # שתי ההגיות חייבות להפיק קול שונה. אם הן זהות, הצלילים לא
    # הגיעו למנוע — והמתג בממשק אינו עושה כלום.
    a, i = measured["ashkenazi"]["wav"], measured["israeli"]["wav"]
    n = min(len(a), len(i))
    if n:
        diff = float(np.mean(np.abs(a[:n] - i[:n])))
        print(f"  הפרש בין שתי ההגיות: {diff:.5f}")
        if diff < 1e-4:
            failures.append("שתי ההגיות הפיקו קול זהה — הצלילים לא הגיעו למנוע.")
        else:
            print("  שתי ההגיות מפיקות קול שונה — הצלילים אכן מגיעים למנוע.")

    print()
    if failures:
        print("נכשל:")
        for f in failures:
            print("   ", f)
        return 1
    print("כל הבדיקות עברו. המנוע מקריא עברית בשתי ההגיות.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

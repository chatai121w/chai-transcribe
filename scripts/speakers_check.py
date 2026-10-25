# -*- coding: utf-8 -*-
"""מודד כמה טוב המערכת מזהה מי מדבר.

למה זה חסר היום
---------------
בפרויקט יש מערכת מלאה לזיהוי דוברים, ואין שום מדידה כמה טוב היא
עובדת. אפשר להסתכל על התוצאה ולהגיד "נראה סביר", וזה בדיוק מה
שאי אפשר לסמוך עליו: התקלה הנפוצה היא שהמערכת מפצלת אדם אחד
לשניים, או מאחדת שניים לאחד, והתוצאה נראית מסודרת לגמרי.

מאיפה מגיעה ההפניה
------------------
פרוטוקול ועדה של הכנסת מסמן מי אמר כל משפט. זה נותן בחינם את מה
שהכי קשה להשיג: רשימת הדוברים האמיתית ומספר המעברים ביניהם.

הבעיה שהכלי הזה פותר
--------------------
אם הורדנו חלק מישיבה, הפרוטוקול עדיין מתאר את כולה. השוואה ישירה
של מספר הדוברים תהיה שגויה — בפרוטוקול יהיו אנשים שדיברו רק אחרי
שהקובץ שלנו נגמר, והמערכת תיראה גרועה בלי סיבה.

לכן הכלי מוצא קודם איפה בפרוטוקול נגמר השמע שהורדנו. הוא לוקח את
סוף התמלול שלנו ומחפש אותו בתוך הפרוטוקול, וסופר רק עד הנקודה
הזאת.

מה לא נמדד כאן
--------------
המיקום המדויק בזמן של כל מעבר בין דוברים. הפרוטוקול אינו כותב
באיזו שנייה כל אחד דיבר, ובלי זה אי אפשר למדוד אם הקו נמתח במקום
הנכון. מה שנמדד כאן — כמה דוברים וכמה מעברים — הוא החלק שאפשר
לקבוע בלי ניחוש.

שימוש
-----
    python scripts/speakers_check.py benchmark_private/knesset/2245389
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import time
from collections import Counter

sys.path.insert(0, "scripts")
import regression_check as rc  # noqa: E402

rc.require_project_python()
rc.add_gpu_dll_dirs()

PYANNOTE_MODEL = "pyannote/speaker-diarization-community-1"

# כמה מילים מסוף התמלול משמשות כדי למצוא את נקודת הסיום בפרוטוקול.
# קצר מדי יימצא במקומות רבים, ארוך מדי לא יימצא בכלל בגלל הבדלי כתיב.
TAIL_WORDS = 12

# "קריאה" אינו שם של אדם — כך הפרוטוקול מסמן קריאת ביניים של מישהו
# שלא זוהה. ספירתו כדובר נפרד תנפח את המספר האמיתי.
NOT_A_PERSON = {"קריאה", "קריאות", "דובר", "דוברת"}


def load_turns(folder):
    path = os.path.join(folder, "protocol.jsonl")
    with io.open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def clean_name(name):
    """מאחד צורות של אותו שם.

    בפרוטוקול אותו אדם מופיע גם כ'היו"ר אלון שוסטר' וגם כ'אלון
    שוסטר'. בלי איחוד הוא נספר כשני אנשים, וזה בדיוק סוג הטעות
    שהכלי הזה אמור למצוא — לא ליצור.
    """
    n = name.strip()
    # שם המפלגה או התפקיד בסוגריים: "מוחמד אבו אל היג'א (יש עתיד)".
    # אותו אדם מופיע במקומות אחרים בלי זה, ובלי הסרה הוא נספר פעמיים.
    n = re.sub(r"\([^)]*\)", "", n).strip()
    for prefix in ('היו"ר', "היו\"ר", "יו\"ר", "מ\"מ היו\"ר", "ח\"כ", "השר", "השרה"):
        if n.startswith(prefix):
            n = n[len(prefix):].strip()
    return re.sub(r"\s+", " ", n).strip()


def find_cut_point(turns, transcript_words):
    """כמה תורי דיבור מכוסים בשמע שהורדנו.

    מחפש את סוף התמלול שלנו בתוך הפרוטוקול. מחזיר את מספר התורים
    עד שם, או None אם לא נמצא — ואז עדיף לומר שלא ידוע מאשר לנחש.
    """
    if len(transcript_words) < TAIL_WORDS:
        return None
    tail = transcript_words[-TAIL_WORDS:]

    # בונה את הפרוטוקול כרצף מילים, ושומר לכל מילה לאיזה תור היא שייכת.
    words, owner = [], []
    for i, t in enumerate(turns):
        for w in rc.normalise(t["text"]):
            words.append(w)
            owner.append(i)

    # חיפוש גמיש: די בכך שרוב מילות הזנב מופיעות ברצף קצר.
    best_pos, best_hits = None, 0
    window = TAIL_WORDS * 3
    tail_set = set(tail)
    for start in range(0, max(1, len(words) - window)):
        hits = sum(1 for w in words[start:start + window] if w in tail_set)
        if hits > best_hits:
            best_hits, best_pos = hits, start + window

    if best_pos is None or best_hits < TAIL_WORDS * 0.5:
        return None
    return owner[min(best_pos, len(owner) - 1)] + 1


def load_waveform(path):
    """מפענח את השמע בעצמנו ומוסר אותו מוכן.

    בווינדוס הספרייה אינה מצליחה לקרוא קובץ שמע בכוחות עצמה. השרת
    של הפרויקט כבר נתקל בזה ופתר באותה דרך: לפענח פעם אחת ולהעביר
    את הגלים ישירות, במקום לתת לה לפתוח את הקובץ.
    """
    import torch
    import whisperx
    audio = whisperx.load_audio(path)
    return {"waveform": torch.from_numpy(audio).unsqueeze(0), "sample_rate": 16000}


def iter_tracks(output):
    """קורא את התוצאה בכל אחת מגרסאות הספרייה.

    הגרסה החדשה מחזירה מבנה עטוף ולא את הסימון עצמו, ובתוכו יש
    שתי תצוגות. אנחנו רוצים את זו שאין בה חפיפה בין דוברים, כי
    היא זו שמיועדת להצמדה לתמלול. זה בדיוק מה שהשרת של הפרויקט
    עושה, וההיגיון הועתק משם כדי ששניהם לא יתפצלו.
    """
    annotation = getattr(output, "exclusive_speaker_diarization", None)
    if annotation is None:
        annotation = getattr(output, "speaker_diarization", output)
    return annotation.itertracks(yield_label=True)


def run_pyannote(wav):
    from pyannote.audio import Pipeline
    import torch

    print("טוען את מודל זיהוי הדוברים (מהמחשב, בלי הורדה)...")
    pipe = Pipeline.from_pretrained(PYANNOTE_MODEL)
    if torch.cuda.is_available():
        pipe.to(torch.device("cuda"))
        print("   רץ על כרטיס המסך.")
    else:
        print("   רץ על המעבד — יהיה איטי.")

    print("מפענח את השמע...")
    audio = load_waveform(wav)

    print("מנתח...")
    t0 = time.time()
    result = pipe(audio)
    elapsed = time.time() - t0

    segs = [(s.start, s.end, lbl)
            for s, _, lbl in iter_tracks(result)]
    return segs, elapsed


def main(folder):
    wav = os.path.join(folder, "audio.wav")
    if not os.path.exists(wav):
        print("אין קובץ שמע ב-%s" % folder)
        return 1

    meta_path = os.path.join(folder, "meta.json")
    meta = json.load(io.open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}
    turns = load_turns(folder)

    # ---------------------------------------- כמה מהפרוטוקול רלוונטי
    tr_path = os.path.join(folder, "transcript.txt")
    cut = None
    if os.path.exists(tr_path):
        tw = rc.normalise(io.open(tr_path, encoding="utf-8").read())
        cut = find_cut_point(turns, tw)

    if cut:
        used = turns[:cut]
        print("השמע שהורדנו מכסה %d מתוך %d תורי הדיבור בפרוטוקול."
              % (cut, len(turns)))
    else:
        used = turns
        if meta.get("truncated_to_minutes"):
            print("אזהרה: הורדנו רק חלק מהישיבה ולא הצלחתי למצוא איפה")
            print("הוא נגמר בפרוטוקול. ההשוואה שלהלן על הישיבה המלאה,")
            print("ולכן מספר הדוברים הצפוי גבוה מדי. להרצה מדויקת צריך")
            print("להוריד את הישיבה במלואה (בלי --minutes).")
        else:
            print("הפרוטוקול והשמע שניהם של הישיבה המלאה.")
    print()

    named = [clean_name(t["speaker"]) for t in used]
    people = [n for n in named if n not in NOT_A_PERSON]
    expected_speakers = sorted(set(people))
    # מעבר = שינוי דובר מתור לתור, ולא מספר התורים.
    switches = sum(1 for a, b in zip(named, named[1:]) if a != b)

    # ---------------------------------------------------- המדידה
    segs, elapsed = run_pyannote(wav)
    found_labels = Counter(lbl for _, _, lbl in segs)
    found_switches = sum(1 for a, b in zip(segs, segs[1:]) if a[2] != b[2])
    total_speech = sum(e - s for s, e, _ in segs)
    audio_secs = meta.get("audio_seconds") or 0

    print()
    print("=" * 70)
    print("כמה דוברים")
    print("=" * 70)
    print("  בפרוטוקול:   %d אנשים" % len(expected_speakers))
    print("  המערכת מצאה: %d" % len(found_labels))
    diff = len(found_labels) - len(expected_speakers)
    if diff == 0:
        print("  >>> מספר נכון.")
    elif diff > 0:
        print("  >>> %d יותר מדי — כנראה פיצלה אדם לשניים." % diff)
    else:
        print("  >>> %d חסרים — כנראה איחדה שני אנשים לאחד." % -diff)
    print()
    print("  לפי הפרוטוקול דיברו:")
    for n in expected_speakers[:14]:
        print("     %s" % n)
    if len(expected_speakers) > 14:
        print("     ... ועוד %d" % (len(expected_speakers) - 14))
    print()

    print("=" * 70)
    print("כמה פעמים הדיבור עבר מאחד לשני")
    print("=" * 70)
    print("  בפרוטוקול:   %d מעברים" % switches)
    print("  המערכת מצאה: %d" % found_switches)
    if switches:
        ratio = found_switches / float(switches)
        if ratio > 1.5:
            print("  >>> פי %.1f יותר מדי — מקטעת דיבור רצוף." % ratio)
        elif ratio < 0.6:
            print("  >>> רק %.0f%% — מפספסת מעברים." % (ratio * 100))
        else:
            print("  >>> בטווח סביר.")
    print()

    print("=" * 70)
    print("חלוקת זמן הדיבור")
    print("=" * 70)
    by_speaker = {}
    for s, e, lbl in segs:
        by_speaker[lbl] = by_speaker.get(lbl, 0.0) + (e - s)
    for lbl, secs in sorted(by_speaker.items(), key=lambda x: -x[1])[:12]:
        share = 100.0 * secs / total_speech if total_speech else 0
        print("  %-14s %6.1f דקות  (%4.1f%%)" % (lbl, secs / 60, share))
    print()
    if audio_secs:
        print("  זמן דיבור בסך הכול: %.1f מתוך %.1f דקות  (%.0f%% מהקובץ)"
              % (total_speech / 60, audio_secs / 60,
                 100.0 * total_speech / audio_secs))
    print("  זמן הניתוח: %.1f דקות" % (elapsed / 60))
    print()
    print("  לא נמדד כאן: האם כל מעבר נמצא במקום הנכון בזמן. הפרוטוקול")
    print("  אינו כותב באיזו שנייה כל אחד דיבר, ולכן זה דורש הצמדה של")
    print("  התמלול לפרוטוקול מילה במילה.")

    out = os.path.join(folder, "speakers.json")
    io.open(out, "w", encoding="utf-8").write(json.dumps({
        "expected_speakers": expected_speakers,
        "expected_switches": switches,
        "found_speakers": len(found_labels),
        "found_switches": found_switches,
        "turns_covered": cut,
        "turns_total": len(turns),
        "segments": [{"start": s, "end": e, "speaker": l} for s, e, l in segs],
    }, ensure_ascii=False, indent=2))
    print()
    print("נשמר ב-%s" % out)
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1]))

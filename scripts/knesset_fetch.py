# -*- coding: utf-8 -*-
"""מוריד ישיבות ועדה של הכנסת עם הפרוטוקול הרשמי שלהן.

למה זה קיים
-----------
מדגם הבדיקה שלנו הוא שלוש דקות בסך הכול, והקטעים בו קצרים.
כדי לדעת איך המנוע מתנהג על קובץ ארוך, עם כמה דוברים שנכנסים
זה לדברי זה, צריך חומר אמיתי שיש לצדו תמלול שאדם כתב.

ישיבות ועדה של הכנסת הן בדיוק זה: ההקלטה פתוחה לכל אחד, והפרוטוקול
הרשמי מתפרסם לצדה.

שתי אזהרות שחייבים לדעת לפני שמשתמשים במספרים
---------------------------------------------
1. הפרוטוקול אינו מילה במילה. הוא ערוך: מוציאים ממנו מילות מילוי,
   חזרות ומשפטים שנקטעו, ומתקנים דקדוק. לכן אם המנוע יתמלל נכון
   בדיוק את מה שנאמר, הוא ייראה שגוי מול הפרוטוקול. המספר שיוצא
   מכאן מנופח, ואינו שיעור השגיאות האמיתי.

2. המודל שאנחנו מריצים אומן על הקלטות של ועדות הכנסת. מדידת דיוק
   על חומר שהמודל אומן עליו נותנת ציון טוב מדי שאינו מייצג קבצים
   אמיתיים.

המסקנה המעשית: החומר הזה מצוין לבדיקת אורך, מהירות, יציבות, ודילוג
על קטעים. הוא אינו מתאים לקביעת שיעור הדיוק של המנוע.

איך זה מתחבר
------------
    ממשק הנתונים של הכנסת          שרת הווידאו של הכנסת
    KNS_DocumentCommitteeSession   video.knesset.gov.il
            |                              |
            | מספר ישיבה + קובץ פרוטוקול   | אותו מספר ישיבה
            +---------------+--------------+
                            |
                  benchmark_private/knesset/<מספר>/
                      audio.wav        שמע, ערוץ אחד, 16 אלף דגימות
                      protocol.txt     רק הדיבור
                      protocol.jsonl   תור דיבור לכל דובר
                      meta.json        מאיפה הכול הגיע

שימוש
-----
    python scripts/knesset_fetch.py --list 20
    python scripts/knesset_fetch.py --fetch 2245389
    python scripts/knesset_fetch.py --fetch 2245389 --minutes 15
    python scripts/knesset_fetch.py --auto 3
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import zipfile

ODATA = "https://knesset.gov.il/Odata/ParliamentInfo.svc"
VIDEO = "https://video.knesset.gov.il/KnsVod/_definst_/mp4:vod/CMT/CmtSession_%d.mp4/manifest.mpd"
OUT_ROOT = os.path.join("benchmark_private", "knesset")

# בממשק הנתונים של הכנסת זה הקוד של "פרוטוקול ועדה".
PROTOCOL_GROUP_TYPE = 23

# הפרוטוקול מסמן כל תור דיבור בתווית סוג הדובר.
SPEAKER_MARKS = ("יור", "דובר", "אורח", "קריאה")

UA = {"User-Agent": "Mozilla/5.0 (benchmark fetcher)"}


# --------------------------------------------------------------- רשת


def _get(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as f:
        return f.read()


def odata(entity, **params):
    """שאילתה לממשק הנתונים הפתוח של הכנסת."""
    q = {"$format": "json"}
    q.update({("$" + k if not k.startswith("$") else k): v for k, v in params.items()})
    url = "%s/%s?%s" % (ODATA, entity, urllib.parse.urlencode(q))
    return json.loads(_get(url).decode("utf-8")).get("value", [])


def video_exists(session_id, timeout=15):
    """בודק אם יש הקלטה לישיבה הזאת."""
    try:
        return len(_get(VIDEO % session_id, timeout=timeout)) > 50
    except Exception:
        return False


# ------------------------------------------------------- פרוטוקול


def protocol_turns(blob):
    """מפריד את הפרוטוקול לתורי דיבור.

    קובץ הפרוטוקול הוא קובץ וורד דחוס. אפשר היה למשוך ממנו את כל
    הטקסט ברצף, אבל אז רשימת הנוכחים ותיאורי התפקידים היו נספרים
    כדיבור, והם מאות מילים שאיש לא אמר בקול.

    לכן ההפרדה נשענת על הסימון של הכנסת עצמה: כל תור דיבור פותח
    בתווית סוג דובר. מה שלפני התווית הראשונה — הכותרת ורשימת
    הנוכחים — נזרק.
    """
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        xml = z.read("word/document.xml").decode("utf-8")

    turns = []
    speaker = None
    buf = []

    for para in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S):
        text = "".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", para, re.S))
        for a, b in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"')):
            text = text.replace(a, b)
        text = text.strip()
        if not text:
            continue

        mark = re.match(r"<<\s*(%s)\s*>>\s*(.*)" % "|".join(SPEAKER_MARKS), text)
        if mark:
            if speaker and buf:
                turns.append({"speaker": speaker, "text": " ".join(buf)})
            name = re.sub(r"<<[^>]*>>", "", mark.group(2)).strip().rstrip(":").strip()
            speaker = name or mark.group(1)
            buf = []
            continue

        if re.match(r"<<\s*(נושא|סיום)\s*>>", text):
            continue
        if speaker is None:
            continue  # עדיין בכותרת וברשימת הנוכחים

        text = re.sub(r"<<[^>]*>>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            buf.append(text)

    if speaker and buf:
        turns.append({"speaker": speaker, "text": " ".join(buf)})
    return turns


# ----------------------------------------------------------- שמע


def fetch_audio(session_id, dest, minutes=None):
    """מוריד את פס הקול בלבד, בצורה שהמנוע מצפה לה.

    ערוץ אחד ו-16 אלף דגימות בשנייה — זה מה שהמנוע עובד איתו ממילא,
    והמרה כאן חוסכת המרה חוזרת בכל הרצה.
    """
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
           "-i", VIDEO % session_id]
    if minutes:
        cmd += ["-t", str(int(minutes * 60))]
    cmd += ["-vn", "-ac", "1", "-ar", "16000", dest]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                       errors="replace")
    if r.returncode != 0 or not os.path.exists(dest):
        raise RuntimeError("ההורדה נכשלה: %s" % (r.stderr or "")[:400])
    return os.path.getsize(dest)


def audio_seconds(path):
    r = subprocess.run(
        ["ffprobe", "-hide_banner", "-loglevel", "error", "-show_entries",
         "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


# -------------------------------------------------------- פקודות


def find_sessions(limit):
    """ישיבות שיש להן גם פרוטוקול וגם הקלטה.

    לא לכל ישיבה יש את שניהם: פרוטוקול מתפרסם ימים אחרי הישיבה,
    וחלק מההקלטות הישנות כבר אינן בשרת. לכן כל מועמד נבדק בפועל.
    """
    docs = odata("KNS_DocumentCommitteeSession",
                 filter="GroupTypeID eq %d" % PROTOCOL_GROUP_TYPE,
                 orderby="LastUpdatedDate desc",
                 top=str(limit * 4))
    seen, found = set(), []
    for d in docs:
        sid = d["CommitteeSessionID"]
        if sid in seen:
            continue
        seen.add(sid)
        if not video_exists(sid):
            continue
        found.append({"session_id": sid, "protocol_url": d["FilePath"]})
        if len(found) >= limit:
            break
    return found


def session_info(session_id):
    rows = odata("KNS_CommitteeSession",
                 filter="CommitteeSessionID eq %d" % session_id)
    return rows[0] if rows else {}


def fetch(session_id, minutes=None, protocol_url=None):
    out = os.path.join(OUT_ROOT, str(session_id))
    os.makedirs(out, exist_ok=True)

    if not protocol_url:
        docs = odata("KNS_DocumentCommitteeSession",
                     filter="CommitteeSessionID eq %d and GroupTypeID eq %d"
                            % (session_id, PROTOCOL_GROUP_TYPE))
        if not docs:
            raise RuntimeError("אין פרוטוקול לישיבה %d" % session_id)
        protocol_url = docs[0]["FilePath"]

    print("  מוריד את הפרוטוקול...")
    turns = protocol_turns(_get(protocol_url))
    words = sum(len(t["text"].split()) for t in turns)
    if not turns:
        raise RuntimeError("לא נמצא דיבור בפרוטוקול — ייתכן שהמבנה שלו שונה")

    with io.open(os.path.join(out, "protocol.jsonl"), "w", encoding="utf-8") as f:
        for t in turns:
            f.write(json.dumps(t, ensure_ascii=False) + "\n")
    with io.open(os.path.join(out, "protocol.txt"), "w", encoding="utf-8") as f:
        f.write(" ".join(t["text"] for t in turns))
    print("     %d תורי דיבור, %d מילים" % (len(turns), words))

    print("  מוריד את השמע%s..." % ("" if not minutes else " (%d דקות)" % minutes))
    wav = os.path.join(out, "audio.wav")
    fetch_audio(session_id, wav, minutes)
    secs = audio_seconds(wav)
    print("     %.1f דקות" % (secs / 60))

    info = session_info(session_id)
    meta = {
        "session_id": session_id,
        "committee_session_start": info.get("StartDate"),
        "location": info.get("Location"),
        "session_page": info.get("SessionUrl"),
        "protocol_url": protocol_url,
        "video_url": VIDEO % session_id,
        "audio_seconds": secs,
        "protocol_turns": len(turns),
        "protocol_words": words,
        "truncated_to_minutes": minutes,
        "אזהרה": "הפרוטוקול ערוך ואינו מילה במילה. המודל אומן על "
                 "ועדות הכנסת. אין להשתמש בזה לקביעת שיעור דיוק.",
    }
    with io.open(os.path.join(out, "meta.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(meta, ensure_ascii=False, indent=2))

    # אם השמע נחתך, יחס המילים לדקה מאבד משמעות — נאמר את זה ולא נסתיר.
    if secs > 0 and not minutes:
        print("     %.1f מילים לשנייה בפרוטוקול" % (words / secs))
    return out


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--list", type=int, nargs="?", const=10, metavar="כמה")
    ap.add_argument("--fetch", type=int, metavar="מספר-ישיבה")
    ap.add_argument("--auto", type=int, metavar="כמה")
    ap.add_argument("--minutes", type=float, default=None,
                    help="להוריד רק את תחילת הישיבה")
    args = ap.parse_args()

    if args.list:
        print("מחפש ישיבות עם פרוטוקול והקלטה...")
        for s in find_sessions(args.list):
            info = session_info(s["session_id"])
            print("  %-10d %-20s %s" % (s["session_id"],
                                        (info.get("StartDate") or "")[:16],
                                        info.get("Location", "")[:40]))
        return 0

    if args.fetch:
        print("ישיבה %d" % args.fetch)
        print("נשמר ב-%s" % fetch(args.fetch, args.minutes))
        return 0

    if args.auto:
        print("מחפש %d ישיבות..." % args.auto)
        for s in find_sessions(args.auto):
            print()
            print("ישיבה %d" % s["session_id"])
            try:
                fetch(s["session_id"], args.minutes, s["protocol_url"])
            except Exception as e:
                print("  נכשל: %s" % e)
        return 0

    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())

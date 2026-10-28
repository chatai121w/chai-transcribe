# -*- coding: utf-8 -*-
"""תמלול כמשימה עם מספר — כדי שסגירת הדף לא תאבד את העבודה.

מה הייתה הבעיה
---------------
התמלול הרגיל נשלח אל הדף בחיבור חי: כל קטע שמסתיים נשלח מיד, והדף
אוסף אותם. כל עוד הדף פתוח זה עובד מצוין.

אבל אם סוגרים את הדף באמצע, או שהמחשב נכנס לשינה, או שהרשת מתנתקת
לשנייה — החיבור נסגר. השרת ממשיך לעבוד (הוא תוכנית נפרדת), אבל אין
לאן להחזיר את מה שהוא מוציא. התוצאה נזרקת, והעבודה הייתה לשווא.

זה לא נזק תיאורטי: בקובץ של שעתיים זה אומר לחזור להתחלה.

מה נעשה כאן
------------
העבודה מקבלת מספר. כל מה שהיא מוציאה נשמר כאן לפי הסדר, והדף יכול
להתחבר בכל רגע ולבקש "תן לי הכל מהתחלה" או "תן לי מהקטע ה-40 והלאה".
הדף יכול להיסגר ולהיפתח, ולקבל את כל מה שהוחמץ בבת אחת.

למה שומרים את השורות כמו שהן
-----------------------------
כל שורה נשמרת בדיוק באותו פורמט שהדף מצפה לו. ככה הדף שמתחבר מחדש
מריץ את אותו קוד קריאה בדיוק — בלי מסלול שני שצריך לתחזק במקביל,
ובלי הסיכון ששני המסלולים ייפרדו בשקט.

מה שומר על הזיכרון
-------------------
משימות שנגמרו נמחקות אחרי שעתיים, ובכל מקרה נשמרות רק האחרונות.
בלי זה, כל תמלול היה נשאר בזיכרון לנצח — וקובץ ארוך מוציא אלפי
שורות עם תזמון לכל מילה.

הקובץ הזה לא יודע דבר על השרת עצמו, ולכן אפשר לבדוק אותו בלי
כרטיס מסך ובלי להפעיל כלום.
"""
import json
import threading
import time
import uuid

# כמה זמן משימה שנגמרה נשמרת לפני שהיא נמחקת.
#
# שעתיים: מספיק כדי לקום מהמחשב, לחזור, ולמצוא את התמלול מחכה —
# וקצר מספיק שלא נשמור בזיכרון עבודה של אתמול.
JOB_TTL_SECONDS = 2 * 60 * 60

# כמה משימות נשמרות בכל מקרה, גם אם כולן טריות.
# משימות שעוד רצות אינן נמחקות לעולם, בלי קשר למספר הזה.
MAX_JOBS = 12

# גבול עליון למספר השורות השמורות במשימה אחת.
#
# קובץ של שלוש שעות מוציא כמה אלפי שורות, ולכן המספר הזה לא ייגע
# בשום עבודה אמיתית. הוא קיים כדי שתקלה שמוציאה שורות בלי סוף לא
# תמלא את הזיכרון בשקט.
MAX_EVENTS_PER_JOB = 100_000


class TranscribeJobs:
    """מחזיק את המשימות הפעילות והאחרונות שנגמרו."""

    def __init__(self, ttl_seconds: int = JOB_TTL_SECONDS, max_jobs: int = MAX_JOBS):
        self._jobs: dict = {}
        self._lock = threading.Lock()
        self._ttl = ttl_seconds
        self._max_jobs = max_jobs

    # ── פתיחה וסגירה ──────────────────────────────────────────────

    def create(self, filename: str = "", model: str = "", language: str = "",
               duration: float = 0.0, now: float = None) -> str:
        """פותח משימה חדשה ומחזיר את המספר שלה."""
        ts = time.time() if now is None else now
        job_id = uuid.uuid4().hex[:16]
        with self._lock:
            self._jobs[job_id] = {
                "id": job_id,
                "status": "running",
                "filename": filename,
                "model": model,
                "language": language,
                "duration": duration,
                "progress": 0,
                "processed_sec": 0.0,
                "segments": 0,
                "words": 0,
                "error": None,
                "cancelled": False,
                "truncated": False,
                "created_at": ts,
                "updated_at": ts,
                "finished_at": None,
                "events": [],
            }
            self._prune_locked(ts)
        return job_id

    def record(self, job_id: str, chunk: str, now: float = None) -> None:
        """שומר שורה שהעבודה הוציאה, ומעדכן לפיה את תמונת המצב.

        השורה נשמרת כמו שהיא. התקציר שמתעדכן לידה הוא בשביל מי
        שרק רוצה לדעת "איפה זה עומד" בלי לקרוא את הכל.
        """
        ts = time.time() if now is None else now
        payload = _parse_chunk(chunk)
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            if len(job["events"]) < MAX_EVENTS_PER_JOB:
                job["events"].append(chunk)
            else:
                job["truncated"] = True
            job["updated_at"] = ts
            _apply_summary(job, payload)

    def finish(self, job_id: str, status: str = "done", error: str = None,
               now: float = None) -> None:
        """סוגר את המשימה. אחרי זה היא קריאה אבל לא מתעדכנת."""
        ts = time.time() if now is None else now
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            # שורת שגיאה או סיום שהגיעה מהעבודה עצמה קובעת, ולא
            # הסגירה הכללית בסוף.
            if job["status"] == "running":
                job["status"] = status
            if error and not job["error"]:
                job["error"] = error
            job["finished_at"] = ts
            job["updated_at"] = ts

    # ── ביטול ─────────────────────────────────────────────────────

    def cancel(self, job_id: str) -> bool:
        """מסמן שהמשתמש ביקש לעצור.

        העצירה עצמה נעשית במי שמריץ את העבודה: הוא בודק את הסימון
        הזה בין שורה לשורה. בלי זה, לחיצה על "עצור" הייתה סוגרת רק
        את החיבור והעבודה הייתה ממשיכה לרוץ עד הסוף.
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return False
            job["cancelled"] = True
            job["updated_at"] = time.time()
            return True

    def is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            return bool(job and job["cancelled"])

    # ── קריאה ─────────────────────────────────────────────────────

    def snapshot(self, job_id: str) -> dict:
        """תמונת מצב בלי השורות עצמן — זה מה שמתאים לבדיקה מהירה."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            return _summary(job)

    def events_from(self, job_id: str, index: int):
        """מחזיר את השורות מהמקום המבוקש והלאה, ואת מצב המשימה.

        מחזיר (שורות, מצב). אם אין משימה כזאת — (None, None).
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None, None
            start = max(0, int(index))
            return list(job["events"][start:]), job["status"]

    def listing(self, now: float = None) -> list:
        """כל המשימות, החדשה ראשונה. בלי השורות."""
        ts = time.time() if now is None else now
        with self._lock:
            self._prune_locked(ts)
            jobs = sorted(self._jobs.values(), key=lambda j: j["created_at"], reverse=True)
            return [_summary(j) for j in jobs]

    def running(self, now: float = None) -> list:
        """רק מה שעוד רץ עכשיו."""
        return [j for j in self.listing(now) if j["status"] == "running"]

    # ── ניקיון ────────────────────────────────────────────────────

    def prune(self, now: float = None) -> int:
        ts = time.time() if now is None else now
        with self._lock:
            return self._prune_locked(ts)

    def _prune_locked(self, now: float) -> int:
        """מוחק משימות שנגמרו ואינן נחוצות. משימה שרצה לא נמחקת.

        קודם לפי זמן, ואחר כך לפי מספר — כדי שעשרים תמלולים רצופים
        לא ישאירו את כולם בזיכרון.
        """
        removed = 0
        for job_id, job in list(self._jobs.items()):
            if job["status"] == "running":
                continue
            finished = job["finished_at"] or job["updated_at"]
            if now - finished > self._ttl:
                del self._jobs[job_id]
                removed += 1

        finished_jobs = [j for j in self._jobs.values() if j["status"] != "running"]
        extra = len(self._jobs) - self._max_jobs
        if extra > 0 and finished_jobs:
            finished_jobs.sort(key=lambda j: j["finished_at"] or j["updated_at"])
            for job in finished_jobs[:extra]:
                del self._jobs[job["id"]]
                removed += 1
        return removed


# ── פונקציות עזר ──────────────────────────────────────────────────

def _parse_chunk(chunk: str) -> dict:
    """מוציא את התוכן מתוך שורה.

    השורה מגיעה בפורמט של חיבור חי: "data: {...}". אם משהו בה אינו
    כצפוי פשוט מחזירים כלום — שמירת השורה חשובה יותר מהתקציר, ולכן
    תקציר שנכשל לא יפיל את העבודה.
    """
    try:
        text = chunk.strip()
        if not text.startswith("data:"):
            return {}
        return json.loads(text[5:].strip()) or {}
    except Exception:
        return {}


def _apply_summary(job: dict, payload: dict) -> None:
    """מעדכן את התקציר לפי שורה אחת. נקרא כשהמנעול מוחזק."""
    kind = payload.get("type")
    if kind == "source" or kind == "info":
        if payload.get("duration"):
            job["duration"] = payload["duration"]
        if payload.get("model"):
            job["model"] = payload["model"]
        if payload.get("language"):
            job["language"] = payload["language"]
    elif kind == "segment":
        job["segments"] += 1
        job["words"] += len(payload.get("words") or [])
        if payload.get("progress") is not None:
            job["progress"] = payload["progress"]
        if payload.get("segEnd") is not None:
            job["processed_sec"] = payload["segEnd"]
    elif kind == "done":
        job["status"] = "done"
        job["progress"] = 100
        if payload.get("duration"):
            job["duration"] = payload["duration"]
        if payload.get("model"):
            job["model"] = payload["model"]
    elif kind == "error":
        job["status"] = "error"
        job["error"] = payload.get("error") or "שגיאה לא מזוהה"


def _summary(job: dict) -> dict:
    """תמונת מצב בלי השורות, ועם מספרן."""
    out = {k: v for k, v in job.items() if k != "events"}
    out["event_count"] = len(job["events"])
    return out


# המחזיק המשותף לכל השרת.
jobs = TranscribeJobs()

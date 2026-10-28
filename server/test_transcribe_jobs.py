# -*- coding: utf-8 -*-
"""תמלול כמשימה עם מספר.

הבדיקות כאן אינן מתמללות דבר — תמלול אמיתי דורש כרטיס מסך. הן על
ההבטחות שאפשר לשבור בשקט, ושאם הן נשברות המשתמש מאבד עבודה:

  כלום לא נעלם       אם סוגרים את הדף באמצע ופותחים מחדש, כל השורות
                     שהוחמצו חייבות להיות שם — בדיוק לפי הסדר.

  אפשר להמשיך        דף שקיבל 40 שורות ומבקש "מ-40 והלאה" אינו אמור
  מהאמצע             לקבל אותן שוב, ולא לדלג על אף אחת.

  הזיכרון לא נפוח    משימה שנגמרה נמחקת. בלי זה כל תמלול נשאר בזיכרון
                     לנצח, וקובץ ארוך הוא אלפי שורות עם תזמון לכל מילה.

  משימה שרצה         זאת התקלה הגרועה ביותר שאפשר לכתוב כאן: ניקיון
  לא נמחקת           שמוחק עבודה שרצה הורג אותה באמצע.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from transcribe_jobs import TranscribeJobs  # noqa: E402


def line(payload: dict) -> str:
    """בונה שורה באותו פורמט שהשרת מוציא."""
    return f"data: {json.dumps(payload)}\n\n"


def payload_of(chunk: str) -> dict:
    """קורא את התוכן מתוך שורה שמורה.

    העברית נשמרת בשורה כרצף סימנים ולא כאותיות, ולכן חיפוש טקסט
    בשורה הגולמית אינו עובד — צריך לפרק אותה כמו שהדף עושה.
    """
    return json.loads(chunk.strip()[5:].strip())


def seg(text: str, progress: int, words: int = 2) -> str:
    return line({
        "type": "segment", "text": text, "progress": progress,
        "segEnd": progress, "words": [{"word": "x"}] * words,
    })


@pytest.fixture
def jobs():
    return TranscribeJobs()


class Testשומרהכלולאמאבד:
    """מה שהעבודה הוציאה חייב להיות קריא אחר כך."""

    def test_שורות_חוזרות_לפי_הסדר(self, jobs):
        job_id = jobs.create(filename="שיעור.mp3")
        for i in range(5):
            jobs.record(job_id, seg(f"קטע {i}", i * 20))

        events, status = jobs.events_from(job_id, 0)
        assert len(events) == 5
        assert status == "running"
        assert payload_of(events[0])["text"] == "קטע 0"
        assert payload_of(events[4])["text"] == "קטע 4"

    def test_המשך_מהאמצע_לא_חוזר_ולא_מדלג(self, jobs):
        # זה הלב של ההתחברות מחדש: דף שכבר ראה שורות אינו אמור
        # לקבל אותן שוב, ושורה שהוחמצה אינה אמורה להיעלם.
        job_id = jobs.create()
        for i in range(10):
            jobs.record(job_id, seg(f"קטע {i}", i * 10))

        first, _ = jobs.events_from(job_id, 0)
        rest, _ = jobs.events_from(job_id, 4)

        assert len(first) == 10
        assert len(rest) == 6
        assert payload_of(rest[0])["text"] == "קטע 4"
        # ביחד, בלי כפילות ובלי חור
        assert first[:4] + rest == first

    def test_בקשה_מעבר_לסוף_מחזירה_ריק_ולא_שגיאה(self, jobs):
        job_id = jobs.create()
        jobs.record(job_id, seg("אחד", 10))
        events, status = jobs.events_from(job_id, 99)
        assert events == []
        assert status == "running"

    def test_מספר_שאינו_קיים_מוחזר_כחסר(self, jobs):
        events, status = jobs.events_from("אין-כזה", 0)
        assert events is None
        assert status is None
        assert jobs.snapshot("אין-כזה") is None


class Testתמונתהמצב:
    """מי שרק רוצה לדעת איפה זה עומד, בלי לקרוא את כל השורות."""

    def test_התקדמות_ומילים_נספרות(self, jobs):
        job_id = jobs.create(filename="שיעור.mp3")
        jobs.record(job_id, line({"type": "info", "duration": 600, "model": "turbo"}))
        jobs.record(job_id, seg("אחד", 25, words=3))
        jobs.record(job_id, seg("שתיים", 50, words=4))

        s = jobs.snapshot(job_id)
        assert s["progress"] == 50
        assert s["segments"] == 2
        assert s["words"] == 7
        assert s["duration"] == 600
        assert s["model"] == "turbo"
        assert s["status"] == "running"

    def test_שורת_סיום_מסמנת_שנגמר(self, jobs):
        job_id = jobs.create()
        jobs.record(job_id, seg("אחד", 50))
        jobs.record(job_id, line({"type": "done", "text": "אחד", "duration": 120}))

        s = jobs.snapshot(job_id)
        assert s["status"] == "done"
        assert s["progress"] == 100

    def test_שורת_שגיאה_נשמרת_עם_הנוסח(self, jobs):
        job_id = jobs.create()
        jobs.record(job_id, line({"type": "error", "error": "כרטיס המסך מלא"}))

        s = jobs.snapshot(job_id)
        assert s["status"] == "error"
        assert s["error"] == "כרטיס המסך מלא"

    def test_שגיאה_שנרשמה_אינה_נדרסת_בסגירה(self, jobs):
        # הסגירה הכללית בסוף אומרת "נגמר". אם היא תדרוס את השגיאה,
        # המשתמש יראה "הסתיים בהצלחה" על תמלול שנפל.
        job_id = jobs.create()
        jobs.record(job_id, line({"type": "error", "error": "קובץ פגום"}))
        jobs.finish(job_id, status="done")

        s = jobs.snapshot(job_id)
        assert s["status"] == "error"
        assert s["error"] == "קובץ פגום"

    def test_שורה_פגומה_אינה_מפילה_ואינה_נעלמת(self, jobs):
        # תקציר שנכשל אסור לו למנוע את שמירת השורה עצמה.
        job_id = jobs.create()
        jobs.record(job_id, "data: {לא תקין")
        jobs.record(job_id, "משהו אחר לגמרי")
        events, _ = jobs.events_from(job_id, 0)
        assert len(events) == 2
        assert jobs.snapshot(job_id)["status"] == "running"


class Testביטול:
    """לחיצה על עצור צריכה לעצור באמת."""

    def test_הסימון_נקרא_בחזרה(self, jobs):
        job_id = jobs.create()
        assert jobs.is_cancelled(job_id) is False
        assert jobs.cancel(job_id) is True
        assert jobs.is_cancelled(job_id) is True

    def test_ביטול_משימה_שאינה_קיימת_אינו_מפיל(self, jobs):
        assert jobs.cancel("אין-כזה") is False
        assert jobs.is_cancelled("אין-כזה") is False


class Testנקיון:
    """הזיכרון לא אמור לתפוח, והעבודה הרצה לא אמורה להיפגע."""

    def test_משימה_שרצה_אינה_נמחקת_גם_אחרי_הרבה_זמן(self, jobs):
        # התקלה הגרועה ביותר שאפשר לכתוב כאן.
        job_id = jobs.create(now=0)
        jobs.record(job_id, seg("אחד", 10), now=0)
        jobs.prune(now=100_000)
        assert jobs.snapshot(job_id) is not None
        assert jobs.snapshot(job_id)["status"] == "running"

    def test_משימה_שנגמרה_נמחקת_אחרי_הזמן(self, jobs):
        job_id = jobs.create(now=0)
        jobs.finish(job_id, now=0)
        jobs.prune(now=100_000)
        assert jobs.snapshot(job_id) is None

    def test_משימה_שנגמרה_עכשיו_נשארת(self, jobs):
        job_id = jobs.create(now=0)
        jobs.finish(job_id, now=0)
        jobs.prune(now=60)
        assert jobs.snapshot(job_id) is not None

    def test_רק_האחרונות_נשמרות(self, jobs):
        small = TranscribeJobs(max_jobs=3)
        ids = []
        for i in range(6):
            job_id = small.create(now=i)
            small.finish(job_id, now=i)
            ids.append(job_id)
        small.prune(now=10)

        kept = [j["id"] for j in small.listing(now=10)]
        assert len(kept) == 3
        # הנשמרות הן החדשות, לא הישנות
        assert set(kept) == set(ids[-3:])

    def test_הגבול_אינו_דוחק_עבודה_שרצה(self, jobs):
        small = TranscribeJobs(max_jobs=2)
        running = small.create(now=0)
        for i in range(1, 6):
            done = small.create(now=i)
            small.finish(done, now=i)
        small.prune(now=10)

        assert small.snapshot(running) is not None
        assert len(small.running(now=10)) == 1

    def test_מספר_השורות_מוגבל_ומסומן(self, jobs):
        import transcribe_jobs as tj
        original = tj.MAX_EVENTS_PER_JOB
        tj.MAX_EVENTS_PER_JOB = 3
        try:
            job_id = jobs.create()
            for i in range(10):
                jobs.record(job_id, seg(f"קטע {i}", i))
            events, _ = jobs.events_from(job_id, 0)
            assert len(events) == 3
            # חשוב שזה לא יקרה בשקט
            assert jobs.snapshot(job_id)["truncated"] is True
        finally:
            tj.MAX_EVENTS_PER_JOB = original


class Testרשימה:
    def test_החדשה_ראשונה(self, jobs):
        a = jobs.create(filename="ראשון.mp3", now=1)
        b = jobs.create(filename="שני.mp3", now=2)
        names = [j["filename"] for j in jobs.listing(now=3)]
        assert names == ["שני.mp3", "ראשון.mp3"]
        assert [j["id"] for j in jobs.listing(now=3)] == [b, a]

    def test_רק_מה_שרץ(self, jobs):
        a = jobs.create(now=1)
        b = jobs.create(now=2)
        jobs.finish(a, now=3)
        running = jobs.running(now=4)
        assert len(running) == 1
        assert running[0]["id"] == b

    def test_הרשימה_אינה_נושאת_את_השורות(self, jobs):
        # שורות עם תזמון לכל מילה הן מגה-בייטים. רשימה שגוררת אותן
        # הופכת בדיקת מצב פשוטה להעברה כבדה.
        job_id = jobs.create()
        for i in range(50):
            jobs.record(job_id, seg(f"קטע {i}", i * 2))
        entry = jobs.listing()[0]
        assert "events" not in entry
        assert entry["event_count"] == 50

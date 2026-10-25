# -*- coding: utf-8 -*-
"""שחרור מנוע ההקראה מהזיכרון אחרי אי-שימוש.

למה זה נבנה
-----------
מנוע ההקראה נטען פעם אחת ונשאר לנצח. הוא תופס כשני ג'יגה בזיכרון
כרטיס המסך, ובכרטיס של שמונה זה רבע מהכול — גם כשאיש לא הקריא
דבר כבר שעות.

זה אינו חשש תיאורטי. ביום אחד נתקלנו שלוש פעמים בכרטיס מסך מלא:
מדידה שקרסה מחוסר זיכרון, תהליך שהחזיק שלושה ג'יגה אחרי שמת,
ומודל שפה חיצוני שתפס חמישה וחצי.

מודלי התמלול כבר שוחררו אוטומטית אחרי שלושים דקות. מנוע ההקראה
לא היה מכוסה כלל.

למה ההמתנה שלו ארוכה יותר
--------------------------
טעינת המנוע עולה כשבעים שניות, מול שניות בודדות למודל תמלול.
שחרור אחרי המתנה קצרה היה הופך כל הקראה שנייה להמתנה ארוכה —
וזה גרוע יותר מלהחזיק את הזיכרון. לכן שעה, ולא שלושים דקות.

הבדיקות כאן אינן טוענות את המנוע האמיתי: טעינה אמיתית דורשת
כרטיס מסך ושבעים שניות. הן בודקות את ההיגיון של ההחזקה והשחרור,
שהוא מה שנשבר בשקט.
"""
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bluetts_engine as be  # noqa: E402


class FakeEngine:
    """עומד במקום המנוע האמיתי. אין צורך בכרטיס מסך כדי לבדוק
    מתי משחררים ומתי לא."""
    pass


@pytest.fixture(autouse=True)
def clean():
    """כל בדיקה מתחילה בלי מנוע טעון, ומחזירה את המצב אחריה."""
    saved = be._engine
    be._engine = None
    be._engine_last_used = 0.0
    yield
    be._engine = saved


def test_אין_מנוע_טעון_אין_מה_לשחרר():
    assert be.idle_seconds() is None
    assert be.release_engine() is False


def test_מנוע_טעון_משוחרר():
    be._engine = FakeEngine()
    be._engine_last_used = time.time()
    assert be.release_engine() is True
    assert be._engine is None


def test_מנוע_שבשימוש_לא_משוחרר():
    # זאת ההגנה שמונעת שחרור באמצע עבודה.
    be._engine = FakeEngine()
    be._engine_last_used = time.time()
    assert be.release_engine(min_idle_seconds=3600) is False
    assert be._engine is not None


def test_מנוע_בטל_מספיק_זמן_משוחרר():
    be._engine = FakeEngine()
    be._engine_last_used = time.time() - 7200  # שעתיים
    assert be.release_engine(min_idle_seconds=3600) is True
    assert be._engine is None


def test_הזמן_מתעדכן_בכל_שימוש():
    # בלי זה מנוע שבשימוש רצוף היה משוחרר באמצע, כי הזמן נמדד
    # מהטעינה ולא מהשימוש האחרון.
    be._engine = FakeEngine()
    be._engine_last_used = time.time() - 7200
    assert be.idle_seconds() > 7000
    be.get_engine()  # מחזיר את הקיים ומעדכן את הזמן
    assert be.idle_seconds() < 5


def test_get_engine_אינו_בונה_מחדש_מנוע_קיים():
    first = FakeEngine()
    be._engine = first
    assert be.get_engine() is first


def test_אחרי_שחרור_נבנה_מחדש():
    be._engine = FakeEngine()
    be.release_engine()
    # הפונקציה תנסה לבנות BlueTts אמיתי, ולכן לא נקרא לה כאן —
    # מספיק לוודא שהמצב נקי ושהבנייה תופעל בפעם הבאה.
    assert be._engine is None
    assert be.idle_seconds() is None


def test_השרת_מגדיר_המתנה_ארוכה_יותר_להקראה():
    """הקבוע עצמו הוא ההחלטה, ולכן הוא נבדק.

    אם מישהו ישווה אותו להמתנה של מודלי התמלול, כל הקראה שנייה
    תתחיל בהמתנה של שבעים שניות.
    """
    import io
    import re
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "transcribe_server.py")
    src = io.open(path, encoding="utf-8").read()
    tts = re.search(r"TTS_TTL_SECONDS\s*=\s*(\d+)\s*\*\s*(\d+)", src)
    mdl = re.search(r"MODEL_TTL_SECONDS\s*=\s*(\d+)\s*\*\s*(\d+)", src)
    assert tts and mdl, "אחד הקבועים חסר"
    tts_s = int(tts.group(1)) * int(tts.group(2))
    mdl_s = int(mdl.group(1)) * int(mdl.group(2))
    assert tts_s > mdl_s, "המתנת ההקראה חייבת להיות ארוכה מזו של התמלול"


def test_חוט_השחרור_מטפל_גם_בהקראה():
    """בלי החיבור הזה הקוד קיים ולא נקרא לעולם."""
    import io
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "transcribe_server.py")
    src = io.open(path, encoding="utf-8").read()
    i = src.index("def _evict_stale_models")
    block = src[i:i + 2500]
    assert "release_engine" in block, "חוט השחרור אינו נוגע במנוע ההקראה"
    assert "TTS_TTL_SECONDS" in block, "ההמתנה הייעודית אינה בשימוש"
    # אסור שהבדיקה תייבא את המנוע ובכך תגרום לטעינה שאנחנו נמנעים ממנה
    assert "sys.modules.get" in block, "חייב לבדוק אם נטען, לא לייבא"

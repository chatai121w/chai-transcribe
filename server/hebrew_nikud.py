#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ניקוד אוטומטי לטקסט עברי.

למה זה נחוץ:
    ממיר הצלילים חייב ניקוד. בלי ניקוד אין מאיפה לדעת את התנועות,
    והפלט הוא עיצורים בלבד — "שלום עולם" יוצא ʃˈlm ʔˈlm, חסר ערך.
    אבל אף אחד לא מדביק טקסט מנוקד. שיעור תורה, גמרא, כל מה שרוצים
    להקריא — הכל בא בלי ניקוד.

    המנקד הזה סוגר את הפער. הוא גם מסמן הטעמה ושווא נע, כלומר נותן
    בדיוק את המידע שממיר הצלילים צריך.

שלוש הערות מהמקור:
    1. יש מגבלה של 2046 תווים לכל מקטע, והחבילה חותכת לבד.
    2. בהרצה הראשונה היא מורידה בעצמה מפענח נוסף מהרשת. הורדנו
       אותו מראש, כך שאין תלות ברשת.
    3. סימן ניקוד לא תקני אחד (U+05AB) משמש לסימון ההטעמה, וסימן
       אחר (U+05AF) לסימון אם קריאה. הם אינם ניקוד אמיתי ועלולים
       לבלבל קוד אחר, ולכן יש פעולה שמסירה אותם.
"""
from __future__ import annotations

import os
import re
import threading
from typing import List, Optional, Tuple

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "phonikud")
MODEL_FILE = "phonikud-1.0.int8.onnx"

#: סימני העזר שהמנקד מוסיף ואינם ניקוד אמיתי.
#:
#: שלושת הראשונים הם סימני ניקוד לא תקניים: הטעמה, אם קריאה ומתג.
#: הרביעי הוא הקו האנכי שהמנקד שם בין תחילית לשורש — הוא נחוץ
#: לממיר הצלילים, אבל בטקסט שמוצג למשתמש הוא נראה כתקלה.
HELPER_MARKS = "ֽ֫֯|"

#: המגבלה שהמנקד עובד בה. חותכים לפניו כדי לשלוט על מקום החיתוך.
MAX_CHUNK = 1800

NIKUD_RE = re.compile(r"[֑-ׇ]")
HEB_RE = re.compile(r"[א-ת]")


class NikudError(RuntimeError):
    """שגיאה שאפשר להציג למשתמש כמו שהיא."""


class HebrewNikud:
    """עוטף את המנקד ומחזיק אותו בזיכרון.

    הטעינה נעשית בפעם הראשונה שצריך ולא בהפעלת השרת: הקובץ כ-308
    מגה, ואין טעם לשלם עליו אם אף אחד לא מבקש ניקוד.
    """

    def __init__(self, model_dir: str = MODEL_DIR):
        self.model_dir = model_dir
        self.model_path = os.path.join(model_dir, MODEL_FILE)
        self._lock = threading.Lock()
        self._model = None

    def available(self) -> bool:
        return os.path.exists(self.model_path)

    def size_mb(self) -> float:
        try:
            return os.path.getsize(self.model_path) / 1e6
        except OSError:
            return 0.0

    def load(self) -> None:
        with self._lock:
            if self._model is not None:
                return
            if not self.available():
                raise NikudError(
                    f"המנקד אינו מותקן. חסר הקובץ {MODEL_FILE}."
                )
            try:
                from phonikud_onnx import Phonikud
            except ImportError as exc:
                raise NikudError(
                    "חבילת הניקוד אינה מותקנת."
                ) from exc
            try:
                self._model = Phonikud(self.model_path)
            except Exception as exc:
                raise NikudError(f"טעינת המנקד נכשלה: {exc}") from exc

    @staticmethod
    def _split_chunks(text: str) -> List[str]:
        """חותך לפי משפטים, לא לפי תווים.

        למנקד יש מגבלת אורך והוא חותך לבד — אבל חיתוך באמצע מילה
        מקלקל את הניקוד שלה, ולכן עדיף לחתוך כאן, במקום הגיוני.
        """
        if len(text) <= MAX_CHUNK:
            return [text]
        chunks, current = [], ""
        # משפטים, ואם אין פיסוק אז לפי שורות, ואם אין אז לפי רווחים.
        parts = re.split(r"(?<=[.!?:;\n])\s+", text)
        for part in parts:
            if len(current) + len(part) + 1 <= MAX_CHUNK:
                current = f"{current} {part}".strip()
                continue
            if current:
                chunks.append(current)
            if len(part) <= MAX_CHUNK:
                current = part
                continue
            # משפט בודד ארוך מהמגבלה. חותכים לפי רווחים.
            current = ""
            for word in part.split():
                if len(current) + len(word) + 1 > MAX_CHUNK:
                    chunks.append(current)
                    current = word
                else:
                    current = f"{current} {word}".strip()
        if current:
            chunks.append(current)
        return chunks

    def add_nikud(self, text: str, keep_helpers: bool = True) -> str:
        """מנקד טקסט.

        keep_helpers שומר את סימני ההטעמה ושווא נע שהמנקד מוסיף.
        הם נחוצים לממיר הצלילים אבל מבלבלים קוד שמצפה לניקוד רגיל.
        """
        if not text or not text.strip():
            return text or ""
        if not HEB_RE.search(text):
            return text
        self.load()

        out = []
        for chunk in self._split_chunks(text):
            try:
                out.append(self._model.add_diacritics(chunk))
            except Exception as exc:
                raise NikudError(f"הניקוד נכשל: {exc}") from exc
        result = " ".join(out)
        if not keep_helpers:
            result = strip_helpers(result)
        return result

    def add_nikud_if_missing(self, text: str, keep_helpers: bool = True) -> Tuple[str, bool]:
        """מנקד רק אם צריך.

        מחזיר גם האם הניקוד נוסף, כדי שאפשר יהיה לומר למשתמש
        שהטקסט שלו נוקד אוטומטית — ושכדאי לו לבדוק.
        """
        if coverage(text)[2] >= 95:
            return text, False
        return self.add_nikud(text, keep_helpers=keep_helpers), True


def strip_helpers(text: str) -> str:
    """מסיר את סימני העזר שאינם ניקוד אמיתי.

    הבריחה נחוצה: הסימנים נכנסים לתוך מחלקת תווים בביטוי רגולרי,
    ויש ביניהם תווים בעלי משמעות מיוחדת.
    """
    if not text:
        return text or ""
    return re.sub(f"[{re.escape(HELPER_MARKS)}]", "", text)


def coverage(text: str) -> Tuple[int, int, int]:
    """כמה מילים מנוקדות: (מנוקדות, סך הכל, אחוז)."""
    words = [w for w in (text or "").split() if HEB_RE.search(w)]
    total = len(words)
    voweled = sum(1 for w in words if NIKUD_RE.search(w))
    return voweled, total, (round(voweled / total * 100) if total else 0)


_instance: Optional[HebrewNikud] = None
_instance_lock = threading.Lock()


def get_nikud() -> HebrewNikud:
    global _instance
    with _instance_lock:
        if _instance is None:
            _instance = HebrewNikud()
        return _instance

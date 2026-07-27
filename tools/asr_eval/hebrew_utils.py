# -*- coding: utf-8 -*-
"""
נורמליזציה של טקסט עברי לצורך מדידת WER/CER.

החלטת הנורמליזציה חייבת להיות זהה לחלוטין על תמלול-האמת ועל הפלט,
אחרת המספרים יזוזו בלי קשר ללמידה. כל ההחלטות מרוכזות כאן וניתנות לכיבוי/הדלקה.
"""
import re
import unicodedata

# טווח ניקוד עברי (נקודות וטעמים): U+0591..U+05C7
NIKUD_PATTERN = re.compile(r"[֑-ׇ]")

# גרש/גרשיים בעברית (U+05F3, U+05F4) + מקבילות ASCII
GERESH = "׳"
GERSHAYIM = "״"

# מיפוי אותיות סופיות -> רגילות (כדי שלא ייחשבו כתווים שונים)
FINALS = {
    "ך": "כ",  # ך -> כ
    "ם": "מ",  # ם -> מ
    "ן": "נ",  # ן -> נ
    "ף": "פ",  # ף -> פ
    "ץ": "צ",  # ץ -> צ
}

PUNCT_PATTERN = re.compile(r"[.,;:!?\"'`׳״()\[\]{}<>–—\-…/\\|*=+_~^]")


def strip_nikud(text: str) -> str:
    return NIKUD_PATTERN.sub("", text)


def normalize_finals(text: str) -> str:
    return "".join(FINALS.get(ch, ch) for ch in text)


def normalize(
    text: str,
    remove_nikud: bool = True,
    fold_finals: bool = True,
    remove_punct: bool = True,
    collapse_ws: bool = True,
) -> str:
    """
    מנרמל טקסט עברי. ברירות המחדל מתאימות למדידת ASR על כתב חסר ניקוד.
    שנה את הדגלים אם אתה רוצה למדוד אחרת — אבל החל בדיוק אותו דבר על שני הצדדים.
    """
    if text is None:
        return ""
    text = unicodedata.normalize("NFC", text)
    if remove_nikud:
        text = strip_nikud(text)
    # אחד גרשיים/גרש לצורות ASCII לפני הסרת פיסוק
    text = text.replace(GERSHAYIM, '"').replace(GERESH, "'")
    if remove_punct:
        text = PUNCT_PATTERN.sub(" ", text)
    if fold_finals:
        text = normalize_finals(text)
    if collapse_ws:
        text = re.sub(r"\s+", " ", text).strip()
    return text


def tokenize_words(text: str):
    return normalize(text).split()


if __name__ == "__main__":
    demo = "אָמַר רָבָא: הָכִי קָאָמַר. (גמ׳)"
    print("גולמי:   ", demo)
    print("מנורמל: ", normalize(demo))

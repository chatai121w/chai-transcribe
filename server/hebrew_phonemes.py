#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""המרת עברית מנוקדת לצלילים, בהגייה ישראלית או אשכנזית.

למה ישר לצלילים ולא דרך הכתיב:
    הדרך הקודמת הייתה לכתוב את העברית מחדש ("תּוֹרָה" -> "תוירה") ולתת
    לקול לקרוא. זה עובד, אבל בעקיפין: אנחנו מקווים שהקול יפרש את הכתיב
    החדש כמו שהתכוונו. מנוע ההקראה מקבל צלילים ישירות, ולכן אפשר לומר
    לו בדיוק מה להשמיע — כולל איפה ההטעמה, שאי אפשר לבטא בכתיב.

מקור הכללים:
    "מדריך לעברית ולארמית אשכנזית" מאת דוד קאץ, בלשן יידיש שעשה
    דוקטורט על הרכיב השמי ביידיש. המדריך כולל טבלת תנועות מלאה, פרק
    עיצורים, שלוש רמות לשון, חוסמי הטעמה ותמלולים מלאים בגרסה
    הצפונית (וילנה) — כלומר בדיוק הליטאית. אישור עצמאי לתנועות
    מטבלת הרכיב העברי בתורת ההגה של היידיש.

**תיקון חשוב מול גרסה קודמת של הקוד הזה:**
    בליטאית **צירה וחולם מתלכדים לצליל אחד, [ɛj]**. כלומר תּוֹרָה היא
    tEYre ולא tOYre. הצורה [ɔj] לחולם היא **פולנית-גליצאית**, לא
    ליטאית. ההוכחה של קאץ היא חריזה: בשיר של משה קולבק מתחרזת
    בְּאֵרִי (צירה) עם מְזוֹרִי (חולם). דוגמאות מפורשות שלו:
    קוֹלוֹת = keyleys, חֲלוֹמוֹת = khaleymeys, לָשׁוֹן = lósheyn,
    חֹשֶׁךְ = khéyshekh.

    הקוד הקודם הפיק [ɔj], כלומר מבטא גליצאי-חסידי — בדיוק מה שלא
    התבקש. הצורה הפולנית נשמרה כאן כאפשרות נפרדת, מסומנת בשמה.

מלכודת שחייבת טיפול:
    טבלת הצלילים של מנוע ההקראה זורקת סימן שאינו מוכר **בשקט**, בלי
    שגיאה. לכן כל פלט כאן עובר אימות מול הטבלה.
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set, Tuple

# ----------------------------------------------------------------- סימני ניקוד

SHEVA = "ְ"
HATAF_SEGOL = "ֱ"
HATAF_PATACH = "ֲ"
HATAF_KAMATZ = "ֳ"
HIRIK = "ִ"
TSERE = "ֵ"
SEGOL = "ֶ"
PATACH = "ַ"
KAMATZ = "ָ"
HOLAM = "ֹ"
HOLAM_HASER = "ֺ"
KUBUTZ = "ֻ"
DAGESH = "ּ"
METEG = "ֽ"
RAFE = "ֿ"
SHIN_DOT = "ׁ"
SIN_DOT = "ׂ"
KAMATZ_KATAN = "ׇ"

VOWEL_MARKS = (
    SHEVA, HATAF_SEGOL, HATAF_PATACH, HATAF_KAMATZ, HIRIK, TSERE, SEGOL,
    PATACH, KAMATZ, HOLAM, HOLAM_HASER, KUBUTZ, KAMATZ_KATAN,
)

NIKUD_RE = re.compile(r"[֑-ׇ]")
HEB_LETTER_RE = re.compile(r"[א-ת]")

ALEF, BET, GIMEL, DALET, HE, VAV, ZAYIN, HET, TET, YOD = (
    "א", "ב", "ג", "ד", "ה", "ו",
    "ז", "ח", "ט", "י",
)
KAF_F, KAF, LAMED, MEM_F, MEM, NUN_F, NUN = (
    "ך", "כ", "ל", "ם", "מ", "ן", "נ",
)
SAMECH, AYIN, PE_F, PE, TSADI_F, TSADI, QOF, RESH, SHIN, TAV = (
    "ס", "ע", "ף", "פ", "ץ", "צ",
    "ק", "ר", "ש", "ת",
)

FINAL_FORMS = {KAF_F: KAF, MEM_F: MEM, NUN_F: NUN, PE_F: PE, TSADI_F: TSADI}

#: בגדכפ"ת — האותיות שהדגש משנה את הגייתן.
BEGEDKEFET = {BET, GIMEL, DALET, KAF, PE, TAV}

#: אהח"ע ור' — אינן מקבלות דגש חזק. הנקודה ב-ה' היא מפיק.
NO_DAGESH_HAZAK = {ALEF, HE, HET, AYIN, RESH, VAV}

MATRES = {ALEF, HE, VAV, YOD}

# ------------------------------------------------------------ תנועה מקור

#: מאיזה סימן ניקוד באה התנועה. נחוץ לכלל קיצור ההברה הסגורה, שבו
#: אותה תנועה מתקצרת אחרת לפי מקורה: [ɛj] מצירה הופך ל-[ɛ], אבל
#: [ɛj] מחולם הופך ל-[ɔ]. בלי לדעת את המקור אין דרך להבדיל.
SRC_KAMATZ = "kamatz"
SRC_TSERE = "tsere"
SRC_HOLAM = "holam"
SRC_OTHER = "other"


# ------------------------------------------------------------------ מבטאים

@dataclass(frozen=True)
class Accent:
    name: str
    label: str
    region: str
    consonants: Dict[str, str]
    soft: Dict[str, str]
    vowels: Dict[str, str]
    #: מאיזה סימן באה כל תנועה, לכלל הקיצור.
    vowel_source: Dict[str, str]
    sheva_na: str
    ayin_sounds: bool
    alef_sounds: bool
    #: 'penultimate' מלעיל, 'final' מלרע.
    stress: str
    #: האם דגש חזק נשמע כהארכת העיצור.
    geminate: bool
    #: האם נוצרת [aj] כשאלף או עין נעלמת בין פתח לחטף.
    gap_diphthong: bool


ISRAELI = Accent(
    name="israeli",
    label="עברית ישראלית",
    region="ישראל",
    consonants={
        ALEF: "", BET: "b", GIMEL: "ɡ", DALET: "d", HE: "h", VAV: "v",
        ZAYIN: "z", HET: "χ", TET: "t", YOD: "j", KAF: "k", LAMED: "l",
        MEM: "m", NUN: "n", SAMECH: "s", AYIN: "", PE: "p", TSADI: "ʦ",
        QOF: "k", RESH: "ʁ", SHIN: "ʃ", TAV: "t",
    },
    soft={BET: "v", GIMEL: "ɡ", DALET: "d", KAF: "χ", PE: "f", TAV: "t"},
    vowels={
        PATACH: "a", KAMATZ: "a", KAMATZ_KATAN: "o", SEGOL: "e", TSERE: "e",
        HIRIK: "i", HOLAM: "o", HOLAM_HASER: "o", KUBUTZ: "u",
        HATAF_PATACH: "a", HATAF_SEGOL: "e", HATAF_KAMATZ: "o",
    },
    vowel_source={},
    sheva_na="e",
    ayin_sounds=False,
    alef_sounds=False,
    stress="final",
    geminate=False,
    gap_diphthong=False,
)

#: הגייה אשכנזית ליטאית, מטיפוס וילנה.
#:
#: זאת הגרסה שקאץ מתמלל במלואה, והיא גם זו שהפכה לבסיס ההגייה של
#: היידיש התקנית. באזור ז'מוד שבמערב ליטא החולם קרוב יותר ל-ou, ולכן
#: מגדירים את המטרה כ"ליטאית מטיפוס וילנה" ולא "ליטאית" סתם.
#:
#: שלוש התנועות שמשתנות מול ישראלית: קמץ, צירה וחולם. קאץ עצמו מנסח
#: את זה לישראלי שרוצה לקרוא שירה אשכנזית: בָּ כ-bo, בֵּ כ-bey,
#: ו-בּוֹ כ-bey גם כן.
#:
#: אין בליטאית הבחנת אורך תנועה. ההבחנות האלה הן דרומיות — פולניות
#: ואוקראיניות. אין בה גם חילוף סופי לאטום: "לֵב טוֹב" ליטאית היא
#: leyv teyv, ופולנית leyv tef.
ASHKENAZI_LITHUANIAN = Accent(
    name="ashkenazi",
    label="אשכנזית ליטאית (וילנה)",
    region="ליטא",
    consonants={
        ALEF: "", BET: "b", GIMEL: "ɡ", DALET: "d", HE: "h", VAV: "v",
        ZAYIN: "z", HET: "χ", TET: "t", YOD: "j", KAF: "k", LAMED: "l",
        MEM: "m", NUN: "n", SAMECH: "s", AYIN: "", PE: "p", TSADI: "ʦ",
        QOF: "k", RESH: "r", SHIN: "ʃ", TAV: "t",
    },
    soft={BET: "v", GIMEL: "ɡ", DALET: "d", KAF: "χ", PE: "f", TAV: "s"},
    vowels={
        PATACH: "a",
        KAMATZ: "ɔ",
        KAMATZ_KATAN: "ɔ",
        SEGOL: "ɛ",
        TSERE: "ɛj",
        HIRIK: "ɪ",
        HOLAM: "ɛj",
        HOLAM_HASER: "ɛj",
        KUBUTZ: "ʊ",
        HATAF_PATACH: "a",
        HATAF_SEGOL: "ɛ",
        HATAF_KAMATZ: "ɔ",
    },
    vowel_source={
        KAMATZ: SRC_KAMATZ, KAMATZ_KATAN: SRC_KAMATZ, HATAF_KAMATZ: SRC_KAMATZ,
        TSERE: SRC_TSERE,
        HOLAM: SRC_HOLAM, HOLAM_HASER: SRC_HOLAM,
    },
    sheva_na="ə",
    ayin_sounds=False,
    alef_sounds=False,
    stress="penultimate",
    geminate=False,
    gap_diphthong=True,
)

#: הגייה אשכנזית פולנית-גליצאית, לשם השוואה.
#:
#: נשמרת כאן כי זה מה שהקוד הקודם הפיק בטעות, וכדי שאפשר יהיה לשמוע
#: את ההבדל. צירה [aj], חולם [ɔj], קמץ ארוך. זה המבטא ה"חסידי"
#: המוכר — Toyre, Moyshe — ואינו ליטאי.
ASHKENAZI_POLISH = Accent(
    name="ashkenazi-polish",
    label="אשכנזית פולנית-גליצאית",
    region="פולין וגליציה",
    consonants=dict(ASHKENAZI_LITHUANIAN.consonants),
    soft=dict(ASHKENAZI_LITHUANIAN.soft),
    vowels={
        PATACH: "a",
        KAMATZ: "u",
        KAMATZ_KATAN: "ɔ",
        SEGOL: "ɛ",
        TSERE: "aj",
        HIRIK: "i",
        HOLAM: "ɔj",
        HOLAM_HASER: "ɔj",
        KUBUTZ: "i",
        HATAF_PATACH: "a",
        HATAF_SEGOL: "ɛ",
        HATAF_KAMATZ: "ɔ",
    },
    vowel_source={
        KAMATZ: SRC_KAMATZ, KAMATZ_KATAN: SRC_KAMATZ, HATAF_KAMATZ: SRC_KAMATZ,
        TSERE: SRC_TSERE,
        HOLAM: SRC_HOLAM, HOLAM_HASER: SRC_HOLAM,
    },
    sheva_na="ə",
    ayin_sounds=False,
    alef_sounds=False,
    stress="penultimate",
    geminate=False,
    gap_diphthong=True,
)

ACCENTS: Dict[str, Accent] = {
    ASHKENAZI_LITHUANIAN.name: ASHKENAZI_LITHUANIAN,
    ISRAELI.name: ISRAELI,
    ASHKENAZI_POLISH.name: ASHKENAZI_POLISH,
}


# ------------------------------------------------------------- רמות לשון

#: שלוש רמות הלשון של קאץ. זאת ההבחנה שהופכת את זה משימושי לשיעור.
#:
#:   קריאה  — קריאה פורמלית בתורה ובטקסט מנוקד. הטעמה סופית, בלי
#:            החלשה. זאת הרמה של ציטוט פסוק.
#:   תפילה  — תפילה, לימוד מקרא, שירה. הטעמה מלעילית, בלי החלשה.
#:   שיעור  — לימוד תלמוד וקבלה בטקסט לא מנוקד, תפילה אינטימית.
#:            הטעמה מלעילית, החלשת כל תנועה שאחרי ההטעמה ל-[ə],
#:            וקיצור הברה סגורה.
#:
#: הדוגמה של קאץ ל"מַלְכוּת אֲחַשְׁוֵרוֹשׁ וְלֵב טוֹב" בליטאית:
#:   קריאה  malkhús akhashveyréysh, leyv teyv
#:   תפילה  málkhus akhashvéyreysh, leyv teyv
#:   שיעור  málkhus akhashvéyrəsh, lev tov
#:
#: בשיעור תורה ליטאי אמיתי שתי הרמות מתערבבות: הפסוק נקרא ברמת
#: "קריאה", והדיבור סביבו ברמת "שיעור".
LEVEL_READING = "reading"
LEVEL_PRAYER = "prayer"
LEVEL_LESSON = "lesson"

LEVELS = {
    LEVEL_READING: {
        "label": "קריאה בתורה",
        "note": "הטעמה סופית, בלי החלשה. הרמה של ציטוט פסוק מדויק.",
        "stress": "final",
        "reduce": False,
        "shorten": False,
    },
    LEVEL_PRAYER: {
        "label": "תפילה ולימוד מקרא",
        "note": "הטעמה מלעילית, בלי החלשה.",
        "stress": "penultimate",
        "reduce": False,
        "shorten": False,
    },
    LEVEL_LESSON: {
        "label": "שיעור תלמוד",
        "note": "הטעמה מלעילית, החלשת תנועות אחרי ההטעמה, וקיצור הברה סגורה. "
                "זאת הרמה של דיבור בשיעור.",
        "stress": "penultimate",
        "reduce": True,
        "shorten": True,
    },
}


# ------------------------------------------------------- חוסמי הטעמה

#: חוסם 3 — "הטעמה מקודשת". רשימה סגורה של מילים שמוטעמות בסוף.
SACRED_FINAL_STRESS: Set[str] = {
    "אמן", "יי", "אדני", "אדושם", "אלהים", "אלוהים", "יעמוד",
}

#: חוסם 4 — ראשי תיבות. אלה מוטעמים בסוף.
ACRONYM_FINAL: Set[str] = {
    "חבד", "חזל", "רמא", "רחש", "שלה", "שסה", "תנך", "רמבן",
}

#: ואלה נשארים מלעיליים, אף שהם ראשי תיבות.
ACRONYM_PENULT: Set[str] = {
    "רשי", "רמבם", "מלבים", "מהרשא", "יעבץ",
}

#: חוסם 2 — תחיליות שאינן שורש ואינן מוטעמות.
#:
#: זה אינו מיושם כסינון אוטומטי של אותיות, כי "בית" מתחילה ב-ב' ואינה
#: מילה עם תחילית. מה שמיושם הוא ה-ה' הידיעה בלבד, שאותה אפשר לזהות
#: בבטחה לפי הניקוד: ה' עם פתח או קמץ ואחריה אות דגושה או גרונית.
PREFIX_LETTERS = {BET, KAF, LAMED, MEM, SHIN, VAV, HE}

#: "תנועה דרך פער" — כשאלף או עין נעלמת בין פתח לחטף או שווא, נוצרת
#: [aj] בליטאית. מילים תכופות מאוד בשיעור. בלי הכלל הזה המבטא
#: נשמע שבור.
GAP_WORDS: Set[str] = {
    "גאוה", "דאגה", "טענה", "מאדים", "מאמין", "מהפך", "מעשה", "תענוג",
}

#: אי-סדירות שאין לה כלל וחייבת רשימה. פתח בהברה פתוחה וחטף פתח
#: מתפצלים בלתי צפוי בין [a] ל-[ɔ].
#:
#: הערכים הם הצלילים המלאים, כולל הטעמה, כפי שקאץ מתמלל אותם.
WORD_OVERRIDES: Dict[str, Dict[str, str]] = {
    "ashkenazi": {
        "נחת": "ˈnaχəs",
        "קדחת": "kaˈdɔχəs",
        "חתנה": "ˈχasənə",
        "מעשה": "ˈmajsɛ",
        "טענה": "ˈtajnɛ",
        "תענוג": "ˈtajnuɡ",
        "אמן": "ɔˈmɛjn",
    },
}


# ----------------------------------------------------------------------- תוצאה

@dataclass
class PhonemeResult:
    ipa: str
    accent: str
    level: str
    per_word: List[Tuple[str, str]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    unsupported: List[str] = field(default_factory=list)
    voweled_words: int = 0
    total_words: int = 0

    def as_dict(self) -> dict:
        return {
            "ipa": self.ipa,
            "accent": self.accent,
            "level": self.level,
            "perWord": [{"word": w, "ipa": p} for w, p in self.per_word],
            "warnings": self.warnings,
            "unsupported": self.unsupported,
            "voweledWords": self.voweled_words,
            "totalWords": self.total_words,
        }


# ------------------------------------------------------------------ פירוק מילה

@dataclass
class Unit:
    letter: str
    marks: str

    @property
    def has_dagesh(self) -> bool:
        return DAGESH in self.marks

    @property
    def vowel(self) -> Optional[str]:
        for m in self.marks:
            if m in VOWEL_MARKS:
                return m
        return None

    @property
    def is_shin(self) -> bool:
        return SHIN_DOT in self.marks

    @property
    def is_sin(self) -> bool:
        return SIN_DOT in self.marks


def split_units(word: str) -> Tuple[List[Unit], int]:
    """מפרק מילה לאותיות עם הניקוד שלהן.

    מחזיר גם כמה אותיות שייכות לתחילית, לפי הסימן שהמנקד האוטומטי
    מוסיף. אפס פירושו שאין תחילית מסומנת.
    """
    units: List[Unit] = []
    prefix_len = 0
    i = 0
    while i < len(word):
        ch = word[i]
        if ch == PREFIX_MARK:
            # כל מה שנאסף עד כאן הוא התחילית.
            prefix_len = len(units)
            i += 1
            continue
        if not HEB_LETTER_RE.match(ch):
            i += 1
            continue
        ch = FINAL_FORMS.get(ch, ch)
        j = i + 1
        marks = ""
        while j < len(word) and NIKUD_RE.match(word[j]):
            marks += word[j]
            j += 1
        units.append(Unit(ch, marks))
        i = j
    return units, prefix_len


def strip_nikud(text: str) -> str:
    return NIKUD_RE.sub("", text or "")


def has_nikud(text: str) -> bool:
    return bool(NIKUD_RE.search(text or ""))


def _is_sheva_na(units: Sequence[Unit], idx: int) -> bool:
    """האם השווא נשמע.

    שווא בתחילת מילה נשמע, שווא באות דגושה נשמע, ושווא ראשון מתוך
    שניים רצופים אינו נשמע. בסוף מילה אינו נשמע.

    זה אינו כל הדקדוק: שווא אחרי תנועה ארוכה נשמע גם הוא, אבל אורך
    התנועה אינו מסומן בניקוד ואין דרך להחליט כאן.
    """
    if idx == 0:
        return True
    if idx == len(units) - 1:
        return False
    if units[idx].has_dagesh:
        return True
    return False


# ------------------------------------------------------------- בניית הצלילים

#: הסימן שהמנקד האוטומטי מוסיף בין תחילית לשורש.
#:
#: הוא אינו ניקוד, והוא מתנה: חוסם ההטעמה השני של קאץ אומר
#: שתחיליות שאינן שורש אינן מוטעמות — הַבֵּן = habéyn, הָעָם = hoóm,
#: שֶבָּא = shebó. בלי הסימן אין דרך בטוחה לזהות תחילית, כי "בית"
#: מתחילה ב-ב' ואינה מילה עם תחילית.
PREFIX_MARK = "|"


@dataclass
class Piece:
    """חלק אחד בצלילים — עיצור או תנועה."""
    ipa: str
    is_vowel: bool
    #: מאיזה סימן ניקוד באה התנועה, לכלל הקיצור.
    source: str = SRC_OTHER
    #: האם זאת תנועת שווא. שווא אינו מוטעם מעולם.
    is_sheva: bool = False
    #: האם החלק שייך לתחילית. תחילית אינה מוטעמת.
    in_prefix: bool = False


def word_to_pieces(word: str, accent: Accent) -> Tuple[List[Piece], List[str]]:
    """מפרק מילה לחלקים, בלי הטעמה ובלי החלשה."""
    units, prefix_len = split_units(word)
    if not units:
        return [], []

    warnings: List[str] = []
    out: List[Piece] = []
    plain = strip_nikud(word).replace(PREFIX_MARK, "")
    use_gap = accent.gap_diphthong and plain in GAP_WORDS

    idx = 0
    while idx < len(units):
        u = units[idx]
        last = idx == len(units) - 1
        in_prefix = idx < prefix_len
        letter, marks = u.letter, u.marks
        vowel_mark = u.vowel

        # --- "תנועה דרך פער": אלף או עין בין פתח לחטף או שווא.
        #     מַעֲשֶׂה הופכת ל-mayse ולא ma'ase. מילים תכופות בשיעור.
        if (use_gap and letter in (ALEF, AYIN) and idx > 0
                and units[idx - 1].vowel == PATACH
                and vowel_mark in (HATAF_PATACH, SHEVA, PATACH)):
            # הפתח שלפני כבר נוסף. מוסיפים לו j והאות עצמה נעלמת.
            for p in reversed(out):
                if p.is_vowel:
                    p.ipa = "aj"
                    break
            idx += 1
            continue

        # --- העיצור
        cons = ""
        if letter == SHIN:
            if u.is_sin:
                cons = "s"
            else:
                cons = accent.consonants[SHIN]
                if not u.is_shin:
                    warnings.append(f"ב{word}: ש' בלי נקודה מבדילה — הונח שי״ן ימנית.")
        elif letter in BEGEDKEFET:
            cons = accent.consonants[letter] if u.has_dagesh else accent.soft[letter]
        elif letter == AYIN:
            cons = "ʕ" if accent.ayin_sounds else ""
        elif letter == ALEF:
            cons = "ʔ" if accent.alef_sounds else ""
        elif letter == HE:
            # ה' בסוף מילה בלי מפיק שותקת.
            cons = "" if (last and not u.has_dagesh) else accent.consonants[HE]
        elif letter == VAV:
            if u.has_dagesh and vowel_mark is None:
                out.append(Piece(accent.vowels[KUBUTZ], True, SRC_OTHER, in_prefix=in_prefix))
                idx += 1
                continue
            if vowel_mark in (HOLAM, HOLAM_HASER):
                out.append(Piece(accent.vowels[vowel_mark], True,
                                 accent.vowel_source.get(vowel_mark, SRC_OTHER),
                                 in_prefix=in_prefix))
                idx += 1
                continue
            # ו' בלי ניקוד אחרי חולם או קובוץ היא אם קריאה ולא עיצור.
            #
            # המנקד האוטומטי מנקד טקסט בכתיב מלא, כלומר הוי"ו כבר
            # קיימת בטקסט המקורי והוא רק מוסיף סימן על האות שלפניה.
            # כך נוצרות שתי צורות שנראות מוזרות ושתיהן תקינות:
            #
            #   "מחלוקת"  ->  מַחְלֹוקֶת   חולם על ל' ואחריו ו' ריקה
            #   "לכולם"   ->  לְכֻולָּם    קובוץ על כ' ואחריו ו' ריקה
            #
            # בלי הכלל הזה נוסף v: maχlɔvkəs במקום maχlɔjkəs,
            # ləχʊvlɔm במקום ləχʊlɔm.
            #
            # הקובוץ נוסף אחרי שהמקרה הראשון כבר תוקן — אותו באג
            # בדיוק, רק עם תנועה אחרת, ולכן הוא לא נתפס אז.
            prev_vowel = units[idx - 1].vowel if idx > 0 else None
            if vowel_mark is None and prev_vowel in (HOLAM, HOLAM_HASER, KUBUTZ):
                idx += 1
                continue
            cons = accent.consonants[VAV]
        elif letter == YOD:
            # י' בלי ניקוד אחרי חיריק, צירה או סגול היא אם קריאה.
            prev_vowel = units[idx - 1].vowel if idx > 0 else None
            if vowel_mark is None and prev_vowel in (HIRIK, TSERE, SEGOL):
                idx += 1
                continue
            cons = accent.consonants[YOD]
        else:
            cons = accent.consonants.get(letter, "")
            if not cons and letter not in (ALEF, AYIN):
                warnings.append(f"ב{word}: לאות {letter} אין צליל בטבלה.")

        if cons:
            out.append(Piece(cons, False, in_prefix=in_prefix))
            # דגש חזק. בליטאית הוא אינו נשמע כהארכה — קאץ מתמלל
            # שַׁבָּת כ-shabos בבי"ת אחת, ותִּקְוָתֵנוּ כ-tikvoseynu.
            if (accent.geminate and u.has_dagesh
                    and letter not in BEGEDKEFET and letter not in NO_DAGESH_HAZAK):
                out.append(Piece("ː", False, in_prefix=in_prefix))

        # --- התנועה
        if vowel_mark is not None:
            if vowel_mark == SHEVA:
                if _is_sheva_na(units, idx):
                    out.append(Piece(accent.sheva_na, True, SRC_OTHER, is_sheva=True, in_prefix=in_prefix))
            else:
                v = accent.vowels.get(vowel_mark, "")
                if v:
                    out.append(Piece(v, True, accent.vowel_source.get(vowel_mark, SRC_OTHER), in_prefix=in_prefix))

        idx += 1

    return out, warnings


# ------------------------------------------------------------------- הטעמה

#: תנועות, לזיהוי גרעיני הברות.
VOWEL_START = set("aeiouɔəɛɪʊɐʌ")


def _vowel_indices(pieces: Sequence[Piece]) -> List[int]:
    return [i for i, p in enumerate(pieces) if p.is_vowel]


def _syllable_is_closed(pieces: Sequence[Piece], vowel_idx: int) -> bool:
    """האם ההברה סגורה — כלומר נגמרת בעיצור.

    נחוץ לכלל קיצור ההברה הסגורה ברמת השיעור.
    """
    nxt = vowel_idx + 1
    if nxt >= len(pieces):
        return True              # סוף מילה אחרי תנועה בלי עיצור — פתוחה
    if not pieces[nxt].is_vowel:
        # יש עיצור אחרי. ההברה סגורה אם אין תנועה מיד אחרי העיצור.
        after = nxt + 1
        while after < len(pieces) and pieces[after].ipa == "ː":
            after += 1
        return after >= len(pieces) or not pieces[after].is_vowel
    return False


def pick_stress(pieces: Sequence[Piece], plain_word: str, level: str,
                accent: Accent) -> Optional[int]:
    """בוחר על איזו תנועה ההטעמה, או None אם אין בכלל תנועה.

    זאת הנקודה שההגייה נשמעת או נשברת עליה. ההבדל בין מלעיל ומלרע
    הוא לא ניואנס — הוא מה שמזהה את המבטא.

    חשוב: גם במילה חד-הברתית מוחזר מקום. ההברה היחידה **היא**
    המוטעמת, גם אם לא מדפיסים סימן. בלי זה כלל קיצור ההברה הסגורה
    לא חל על מילים חד-הברתיות — ודווקא הן הדוגמאות של קאץ:
    דָּם, שֵׁם, סוֹד, לֵב, טוֹב. ההחלטה אם להדפיס סימן נעשית בנפרד.
    """
    vidx = _vowel_indices(pieces)
    if not vidx:
        return None

    # חוסם 1 — שווא אינו מוטעם מעולם.
    usable = [i for i in vidx if not pieces[i].is_sheva]

    # חוסם 2 — תחיליות שאינן שורש אינן מוטעמות.
    #
    # הַבֵּן = habéyn ולא hábeyn. הָעָם = hoóm. שֶבָּא = shebó.
    # הסימון בא מהמנקד האוטומטי, שמסמן במפורש איפה התחילית נגמרת —
    # ובלעדיו אין דרך בטוחה לזהות אותה, כי "בית" מתחילה ב-ב' ואינה
    # מילה עם תחילית.
    #
    # הסינון נעשה רק אם נשאר ממה לבחור: מילה שכולה תחילית, אם תיווצר
    # כזאת, עדיין צריכה הטעמה.
    without_prefix = [i for i in usable if not pieces[i].in_prefix]
    if without_prefix:
        usable = without_prefix

    if not usable:
        return None
    if len(usable) == 1:
        return usable[0]

    # חוסם 3 — הטעמה מקודשת.
    if plain_word in SACRED_FINAL_STRESS:
        return usable[-1]

    # חוסם 4 — ראשי תיבות.
    if plain_word in ACRONYM_FINAL:
        return usable[-1]
    if plain_word in ACRONYM_PENULT:
        return usable[-2]

    want = LEVELS[level]["stress"] if level in LEVELS else accent.stress
    return usable[-1] if want == "final" else usable[-2]


def apply_level(pieces: List[Piece], stress_idx: Optional[int], level: str) -> None:
    """מחיל את כללי רמת הלשון. משנה את החלקים במקום.

    שני כללים, ושניהם קיימים רק ברמת השיעור:

    קיצור הברה סגורה — בהברה סגורה מוטעמת, [ɔ] מקמץ הופך ל-[a],
    [ɛj] מצירה הופך ל-[ɛ], ו-[ɛj] מחולם הופך ל-[ɔ]. דוגמאות של קאץ:
    דָּם = dom בקריאה, dam בשיעור. שֵׁם = sheym אבל shem. סוֹד = seyd
    אבל sod.

    החלשה אחרי ההטעמה — כל תנועה אחרי ההברה המוטעמת הופכת ל-[ə].
    אֲחַשְׁוֵרוֹשׁ = akhashveyreysh בתפילה, akhashveyrəsh בשיעור.
    """
    rules = LEVELS.get(level)
    if not rules or stress_idx is None:
        return

    if rules["shorten"] and _syllable_is_closed(pieces, stress_idx):
        p = pieces[stress_idx]
        if p.source == SRC_KAMATZ:
            p.ipa = "a"
        elif p.source == SRC_TSERE:
            p.ipa = "ɛ"
        elif p.source == SRC_HOLAM:
            p.ipa = "ɔ"

    if rules["reduce"]:
        for i, p in enumerate(pieces):
            if i <= stress_idx or not p.is_vowel or p.is_sheva:
                continue
            # [ʊ] משורוק וקובוץ עומד בפני ההחלשה.
            #
            # הכלל כפי שקאץ מנסח אותו הוא "כל תנועה אחרי ההטעמה",
            # אבל הדוגמה המרכזית שלו עצמו סותרת: מַלְכוּת היא
            # málkhus ברמת השיעור ולא málkhəs, בעוד שבאותו משפט
            # אֲחַשְׁוֵרוֹשׁ כן הופכת ל-akhashvéyrəsh.
            #
            # נבחרה ההתנהגות שמתאימה לדוגמה המעובדת שלו, כי דוגמה
            # מעובדת עדיפה על ניסוח כללי. זאת נקודה שהמקור אינו
            # חד-משמעי בה.
            if p.ipa == "ʊ":
                continue
            p.ipa = "ə"


def render(pieces: Sequence[Piece], stress_idx: Optional[int]) -> str:
    """מחבר את החלקים לטקסט צלילים, עם סימן ההטעמה במקום הנכון.

    סימן ההטעמה נכנס לפני העיצורים שפותחים את ההברה המוטעמת, ולא
    לפני התנועה עצמה. המקור של ממיר הצלילים העברי מנסח זאת כך:
    "Stress should be placed in the syllable always before vowel and
    NOT in the first character of the syllable".

    במילה עם הברה אחת אין מה לסמן — הסימן מבדיל בין הברות, ובלי
    השוואה הוא רק מוסיף סימן מיותר שהמנוע יפרש כהדגשה.
    """
    if stress_idx is None:
        return "".join(p.ipa for p in pieces)

    # הברה אחת בלבד בכל המילה: ההטעמה שם, אבל אין מה לסמן.
    #
    # נספרות כל ההברות כולל שווא, ולא רק אלה שיכולות להיות מוטעמות:
    # ב"וְאֵת" יש שתי הברות והסימן דרוש, כי בלעדיו המנוע קורא אותה
    # שטוחה. ב"דָּם" יש אחת, והסימן מיותר.
    if len([p for p in pieces if p.is_vowel]) < 2:
        return "".join(p.ipa for p in pieces)

    # נסיגה אחורה אל תחילת ההברה.
    #
    # עיצור אחד לפני התנועה שייך להברה שלה. אבל צרור של שניים
    # מתחלק: הראשון סוגר את ההברה הקודמת והשני פותח את זו. בלי
    # החלוקה הזאת "מַלְכוּת" יוצא ma-ˈlχʊs במקום mal-ˈχʊs, כלומר
    # הסימן נופל באמצע ההברה הקודמת.
    start = stress_idx
    while start > 0 and not pieces[start - 1].is_vowel:
        start -= 1
    cluster = stress_idx - start
    if cluster >= 2 and start > 0:
        # יש תנועה לפני הצרור, ולכן העיצור הראשון שייך לה.
        start += cluster - 1

    out = []
    for i, p in enumerate(pieces):
        if i == start:
            out.append("ˈ")
        out.append(p.ipa)
    return "".join(out)


def word_to_ipa(word: str, accent: Accent, level: str = LEVEL_PRAYER,
                stress: bool = True) -> Tuple[str, List[str]]:
    plain = strip_nikud(word)

    # מילים שאין להן כלל ויש להן רשימה.
    override = WORD_OVERRIDES.get(accent.name, {}).get(plain)
    if override:
        return override, []

    pieces, warnings = word_to_pieces(word, accent)
    if not pieces:
        return "", warnings

    stress_idx = pick_stress(pieces, plain, level, accent) if stress else None
    apply_level(pieces, stress_idx, level)
    return render(pieces, stress_idx), warnings


# -------------------------------------------------------------- אימות מול המנוע

_VOCAB_CACHE: Optional[Dict[str, int]] = None


def engine_vocab(model_dir: Optional[str] = None) -> Dict[str, int]:
    global _VOCAB_CACHE
    if _VOCAB_CACHE is not None:
        return _VOCAB_CACHE
    base = model_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "models", "bluetts25")
    path = os.path.join(base, "vocab.json")
    if not os.path.exists(path):
        _VOCAB_CACHE = {}
        return _VOCAB_CACHE
    raw = json.load(open(path, encoding="utf-8"))
    _VOCAB_CACHE = raw.get("char_to_id", {})
    return _VOCAB_CACHE


def unsupported_symbols(ipa: str, model_dir: Optional[str] = None) -> List[str]:
    """הסימנים שהמנוע יזרוק בשקט.

    בלי הבדיקה הזאת סימן לא מוכר נעלם, ההקראה יוצאת עם מילה חסרה,
    וזה נשמע כמו שגיאת הקראה ולא כמו באג בקוד.
    """
    vocab = engine_vocab(model_dir)
    if not vocab:
        return []
    bad = []
    for ch in ipa:
        if ch in (" ", "\n", "\t"):
            continue
        if ch not in vocab and ch not in bad:
            bad.append(ch)
    return bad


# ----------------------------------------------------------------- הממשק הראשי

def phonemize(
    text: str,
    accent: str = "ashkenazi",
    level: str = LEVEL_PRAYER,
    stress: bool = True,
    model_dir: Optional[str] = None,
) -> PhonemeResult:
    """ממיר טקסט עברי מנוקד לצלילים."""
    acc = ACCENTS.get(accent)
    if acc is None:
        raise ValueError(f"מבטא לא מוכר: {accent}")
    if level not in LEVELS:
        raise ValueError(f"רמת לשון לא מוכרת: {level}")

    text = unicodedata.normalize("NFC", text or "")
    result = PhonemeResult(ipa="", accent=accent, level=level)

    # הסימן של המנקד נכלל בתוך המילה בכוונה. בלי זה "הָ|אָרֶץ"
    # מתפצלת לשתי מילים, ה-ה' נחשבת סוף מילה ולכן שותקת, והמילה
    # מקבלת שני סימני הטעמה.
    tokens = re.findall(
        r"[א-ת֑-ׇ|\"']+|[^\sא-ת֑-ׇ|]+|\s+", text)
    pieces: List[str] = []
    all_warnings: List[str] = []

    for tok in tokens:
        if tok.isspace():
            pieces.append(" ")
            continue
        if not HEB_LETTER_RE.search(tok):
            keep = "".join(c for c in tok if c in ".,!?;:()-")
            if keep:
                pieces.append(keep)
            continue

        result.total_words += 1
        if NIKUD_RE.search(tok):
            result.voweled_words += 1

        ipa, warns = word_to_ipa(tok, acc, level=level, stress=stress)
        pieces.append(ipa)
        result.per_word.append((tok, ipa))
        all_warnings.extend(warns)

    result.ipa = re.sub(r"\s+", " ", "".join(pieces)).strip()

    if result.total_words and result.voweled_words == 0:
        result.warnings.append(
            "הטקסט אינו מנוקד. בלי ניקוד אין מאיפה לדעת את התנועות, "
            "והצלילים שיצאו הם עיצורים בלבד — ההקראה תהיה חסרת משמעות."
        )
    elif result.total_words and result.voweled_words < result.total_words:
        missing = result.total_words - result.voweled_words
        result.warnings.append(
            f"{missing} מתוך {result.total_words} מילים אינן מנוקדות, "
            "והן ייצאו בלי תנועות."
        )

    seen: List[str] = []
    for w in all_warnings:
        if w not in seen:
            seen.append(w)
    result.warnings.extend(seen[:3])
    if len(seen) > 3:
        result.warnings.append(f"ועוד {len(seen) - 3} הערות דומות.")

    result.unsupported = unsupported_symbols(result.ipa, model_dir)
    if result.unsupported:
        result.warnings.append(
            "הסימנים האלה אינם בטבלת המנוע והוא יזרוק אותם בשקט: "
            + " ".join(result.unsupported)
        )

    return result


def accent_options() -> List[dict]:
    return [
        {
            "id": a.name,
            "label": a.label,
            "region": a.region,
            "stress": "מלעיל" if a.stress == "penultimate" else "מלרע",
        }
        for a in ACCENTS.values()
    ]


def level_options() -> List[dict]:
    return [
        {"id": k, "label": v["label"], "note": v["note"],
         "stress": "מלרע" if v["stress"] == "final" else "מלעיל"}
        for k, v in LEVELS.items()
    ]

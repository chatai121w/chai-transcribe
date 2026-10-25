#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""בדיקות לממיר הצלילים.

הבדיקות האלה הן השומר על ההגייה. אם מישהו ישנה ערך בטבלה, ההקראה
תישמע אחרת — וזאת תקלה שאי אפשר לראות בקוד ואפשר רק לשמוע.

רוב המילים כאן מתומללות אצל דוד קאץ מילה במילה, בגרסה הצפונית
(וילנה). כלומר הן אינן ניחוש שלנו אלא מקור.

    python -m pytest server/test_hebrew_phonemes.py -q
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hebrew_phonemes import (  # noqa: E402
    ACCENTS, ASHKENAZI_LITHUANIAN, WORD_OVERRIDES,
    LEVEL_LESSON, LEVEL_PRAYER, LEVEL_READING,
    accent_options, engine_vocab, has_nikud, level_options, phonemize,
    split_units, strip_nikud, unsupported_symbols, word_to_ipa,
)


def ashk(word, level=LEVEL_PRAYER):
    return phonemize(word, "ashkenazi", level=level).ipa


# ===================================================================
#  מילים שקאץ מתמלל מילה במילה — אלה הבטוחות ביותר
# ===================================================================

#: (מנוקד, צלילים, התמלול הלטיני של קאץ)
KATZ_CASES = [
    ("קוֹלוֹת",      "ˈkɛjlɛjs",                      "keyleys"),
    ("חֲלוֹמוֹת",    "χaˈlɛjmɛjs",               "khaleymeys"),
    ("לָשׁוֹן",      "ˈlɔʃɛjn",                  "losheyn"),
    ("מַלְכוּת",     "ˈmalχʊs",                       "malkhus"),
    ("תִּקְוָתֵנוּ", "tɪkvɔˈsɛjnʊ",         "tikvoseynu"),
    ("לְבָנָה",      "ləˈvɔnɔ",                  "levono"),
    ("מְנוֹרָה",     "məˈnɛjrɔ",                 "meneyro"),
    ("חֶסֶד",        "ˈχɛsɛd",                   "khesed"),
    ("סֵדֶר",        "ˈsɛjdɛr",                       "seyder"),
]


@pytest.mark.parametrize("voweled,expected,latin", KATZ_CASES)
def test_katz_transcriptions(voweled, expected, latin):
    got = ashk(voweled)
    assert got == expected, (
        f"{strip_nikud(voweled)} ({latin}): יצא {got}, צפוי {expected}"
    )


# ===================================================================
#  מילים תכופות בשיעור
# ===================================================================

COMMON_CASES = [
    ("תּוֹרָה",   "ˈtɛjrɔ",                 "teyro"),
    ("עוֹלָם",    "ˈɛjlɔm",                 "eylom"),
    ("קֹדֶשׁ",    "ˈkɛjdɛʃ",           "keydesh"),
    ("שַׁבָּת",   "ˈʃabɔs",                 "shabos"),
    ("אֱמֶת",     "ˈɛmɛs",                  "emes"),
    ("גְּמָרָא",  "ɡəˈmɔrɔ",      "gemoro"),
    ("מִצְוָה",   "ˈmɪʦvɔ",            "mitzvo"),
    ("בְּרָכָה",  "bəˈrɔχɔ",      "brocho"),
    ("מֶלֶךְ",    "ˈmɛlɛχ",            "melekh"),
    ("בָּרוּךְ",  "ˈbɔrʊχ",            "borukh"),
    ("שָׁלוֹם",   "ˈʃɔlɛjm",           "sholeym"),
]


@pytest.mark.parametrize("voweled,expected,latin", COMMON_CASES)
def test_common_words(voweled, expected, latin):
    got = ashk(voweled)
    assert got == expected, (
        f"{strip_nikud(voweled)} ({latin}): יצא {got}, צפוי {expected}"
    )


# ===================================================================
#  הסימן המובהק של הליטאית: צירה וחולם מתלכדים
# ===================================================================

class TestLithuanianMerger:
    """צירה וחולם נשמעים אותו דבר בליטאית — זה הסימן המובהק.

    ההוכחה של קאץ היא חריזה: בשיר של משה קולבק מתחרזת בְּאֵרִי
    (צירה) עם מְזוֹרִי (חולם).

    הצורה [ɔj] לחולם היא **פולנית-גליצאית**. גרסה קודמת של הקוד
    הזה הפיקה אותה, כלומר מבטא חסידי ולא ליטאי.
    """

    def test_tsere_and_holam_sound_the_same(self):
        assert "ɛj" in ashk("אֵת")
        assert "ɛj" in ashk("אוֹת")

    def test_holam_is_not_the_polish_form(self):
        # תּוֹרָה ליטאית היא teyro ולא toyro.
        lit = ashk("תּוֹרָה")
        assert "ɔj" not in lit, f"יצאה הצורה הפולנית: {lit}"
        assert "ɛj" in lit

    def test_polish_variant_does_give_the_other_form(self):
        pol = phonemize("תּוֹרָה", "ashkenazi-polish").ipa
        assert "ɔj" in pol, f"הצורה הפולנית צריכה oy: {pol}"

    def test_the_two_accents_differ(self):
        assert ashk("תּוֹרָה") != phonemize("תּוֹרָה", "ashkenazi-polish").ipa

    def test_kolos_has_the_merger_twice(self):
        # קוֹלוֹת = keyleys. שני חולמים, שניהם ey.
        assert ashk("קוֹלוֹת").count("ɛj") == 2


# ===================================================================
#  שלוש רמות הלשון
# ===================================================================

class TestLanguageLevels:
    """הדוגמה של קאץ לשלוש הרמות, בצפונית:

        קריאה  malkhús akhashveyréysh, leyv teyv
        תפילה  málkhus akhashvéyreysh, leyv teyv
        שיעור  málkhus akhashvéyrəsh, lev tov

    זאת ההבחנה שהופכת את זה שימושי לשיעור תורה: הפסוק המדויק נקרא
    ברמת הקריאה, והדיבור סביבו ברמת השיעור.
    """

    def test_reading_level_is_final_stress(self):
        ipa = ashk("מַלְכוּת", LEVEL_READING)
        assert ipa.index("ˈ") > 0, f"ההטעמה לא זזה לסוף: {ipa}"

    def test_prayer_level_is_penultimate(self):
        assert ashk("מַלְכוּת", LEVEL_PRAYER).startswith("ˈ")

    def test_the_two_levels_differ(self):
        assert ashk("מַלְכוּת", LEVEL_READING) != ashk("מַלְכוּת", LEVEL_PRAYER)

    def test_lesson_level_reduces_after_stress(self):
        """החלשה אחרי ההטעמה — אֲחַשְׁוֵרוֹשׁ הופכת ל-akhashveyrəsh."""
        prayer = ashk("אֲחַשְׁוֵרוֹשׁ", LEVEL_PRAYER)
        lesson = ashk("אֲחַשְׁוֵרוֹשׁ", LEVEL_LESSON)
        assert lesson != prayer
        assert "ə" in lesson, f"לא הייתה החלשה: {lesson}"

    def test_lesson_shortens_closed_kamatz(self):
        """דָּם = dom בתפילה, dam בשיעור."""
        assert "ɔ" in ashk("דָּם", LEVEL_PRAYER)
        assert "a" in ashk("דָּם", LEVEL_LESSON)

    def test_lesson_shortens_closed_tsere(self):
        """שֵׁם = sheym בתפילה, shem בשיעור."""
        assert "ɛj" in ashk("שֵׁם", LEVEL_PRAYER)
        assert "ɛj" not in ashk("שֵׁם", LEVEL_LESSON)

    def test_lesson_shortens_closed_holam(self):
        """סוֹד = seyd בתפילה, sod בשיעור.

        כאן נחוץ לדעת מאיזה סימן באה התנועה: [ɛj] מצירה מתקצר ל-[ɛ]
        אבל [ɛj] מחולם מתקצר ל-[ɔ]. בלי המקור אין דרך להבדיל.
        """
        assert "ɛj" in ashk("סוֹד", LEVEL_PRAYER)
        lesson = ashk("סוֹד", LEVEL_LESSON)
        assert "ɛj" not in lesson
        assert "ɔ" in lesson, f"סוֹד בשיעור צריך o: {lesson}"

    def test_lev_tov_across_levels(self):
        """לֵב טוֹב = leyv teyv בתפילה, lev tov בשיעור."""
        prayer = ashk("לֵב טוֹב", LEVEL_PRAYER)
        lesson = ashk("לֵב טוֹב", LEVEL_LESSON)
        assert prayer.count("ɛj") == 2, f"בתפילה צריך שני ey: {prayer}"
        assert "ɛj" not in lesson, f"בשיעור אין ey: {lesson}"

    def test_level_options_are_in_hebrew(self):
        opts = level_options()
        assert len(opts) == 3
        for o in opts:
            assert o["stress"] in ("מלעיל", "מלרע")
            assert o["label"] and o["note"]

    def test_unknown_level_raises(self):
        with pytest.raises(ValueError):
            phonemize("שַׁבָּת", "ashkenazi", level="hungarian")


# ===================================================================
#  חוסמי ההטעמה
# ===================================================================

class TestStressBlockers:
    def test_sheva_is_never_stressed(self):
        """בלי הכלל הזה "וְאֵת" יוצא עם ההטעמה על השווא."""
        for word in ("וְאֵת", "בְּרָכָה", "גְּמָרָא", "לְשׁוֹן", "מְנוֹרָה"):
            ipa = ashk(word)
            pos = ipa.find("ˈ")
            assert pos >= 0, f"{word}: חסר סימן הטעמה"
            assert ipa[pos + 1] != "ə", f"{word}: ההטעמה נפלה על השווא"

    def test_sacred_words_take_final_stress(self):
        """אָמֵן = oméyn, אֱלֹהִים = eleyhím — רשימה סגורה."""
        for word in ("אָמֵן", "אֱלֹהִים"):
            ipa = ashk(word)
            assert ipa.index("ˈ") > 0, f"{word} צריך הטעמה סופית: {ipa}"

    def test_three_letter_acronyms_are_final(self):
        """חב"ד = khabád, תנ"ך = tanákh."""
        for word in ("חַבָּד", "תַּנָךְ"):
            ipa = ashk(word)
            assert ipa.index("ˈ") > 0, f"{word} צריך הטעמה סופית: {ipa}"

    def test_other_acronyms_stay_penultimate(self):
        """רש"י = Ráshi, רמב"ם = Rámbam."""
        assert ashk("רַשִׁי").startswith("ˈ")
        assert ashk("רַמְבַּם").startswith("ˈ")

    def test_gap_vowel_rule(self):
        """מַעֲשֶׂה = máyse. מילים תכופות מאוד בשיעור."""
        for word, want in (("מַעֲשֶׂה", "majs"), ("טַעֲנָה", "tajn"),
                           ("תַּעֲנוּג", "tajnu")):
            ipa = ashk(word)
            assert want in ipa, f"{word}: יצא {ipa}, צריך להכיל {want}"

    def test_word_overrides_for_the_irregular_patach(self):
        """נַחַת מול קַדַּחַת — אין כלל, יש רשימה."""
        assert ashk("נַחַת").startswith("ˈna")
        assert not ashk("קַדַּחַת").startswith("ˈka")


# ===================================================================
#  עיצורים
# ===================================================================

class TestConsonants:
    def test_soft_tav_is_samech(self):
        assert ashk("שַׁבָּת").endswith("s")
        assert phonemize("שַׁבָּת", "israeli").ipa.endswith("t")

    def test_dagesh_tav_stays_t(self):
        ipa = ashk("תּוֹרָה")
        assert "t" in ipa and "s" not in ipa

    def test_alef_and_ayin_are_silent(self):
        assert ashk("עוֹלָם").startswith("ˈɛj")
        assert not ashk("אֱמֶת").startswith("ʔ")

    def test_het_and_soft_kaf_merge(self):
        assert "χ" in ashk("חֹדֶשׁ")
        assert "χ" in ashk("בָּרוּךְ")

    def test_no_pharyngeals_in_lithuanian(self):
        """העיצורים הגרוניים העתיקים אבדו באשכנז בתחילת האלף השני."""
        ipa = ashk("חֶסֶד עוֹלָם אֱמֶת חֲלוֹמוֹת עַיִן")
        assert "ħ" not in ipa
        assert "ʕ" not in ipa

    def test_resh_is_alveolar_not_uvular(self):
        """ʁ הענבלית מקושרת לגרמניה ולקורלנד, לא לליבה הליטאית."""
        assert "r" in ashk("גְּמָרָא")
        assert "ʁ" not in ashk("גְּמָרָא")
        assert "ʁ" in phonemize("גְּמָרָא", "israeli").ipa

    def test_no_final_devoicing(self):
        """לֵב ליטאית = leyv, פולנית = leyf."""
        assert "v" in ashk("לֵב")

    def test_shin_stays_shin(self):
        """לא להשתמש באיחוד השורקות הווילנאי — הוא נשמע כפרודיה."""
        assert "ʃ" in ashk("שַׁבָּת")

    def test_final_he_is_silent(self):
        assert not ashk("תּוֹרָה").endswith("h")

    def test_mapiq_he_sounds_and_is_not_lengthened(self):
        ipa = ashk("לָהּ")
        assert ipa.endswith("h"), f"ה' עם מפיק לא נשמעה: {ipa}"
        assert "hː" not in ipa

    def test_no_gemination_in_ashkenazi(self):
        """קאץ מתמלל שַׁבָּת כ-shabos בבי"ת אחת."""
        for word in ("שַׁבָּת", "הַשָּׁמַיִם", "תִּקְוָתֵנוּ"):
            assert "ː" not in ashk(word), f"{word} הוארך"

    def test_shuruk_is_a_vowel(self):
        ipa = ashk("בָּרוּךְ")
        assert "ʊ" in ipa and "v" not in ipa

    def test_holam_vav_adds_no_consonant(self):
        assert ashk("שָׁלוֹם").count("v") == 0

    def test_mater_yod_is_not_a_consonant(self):
        """בלי הכלל הזה "אֱלֹהֵינוּ" יוצא עם יו"ד כפולה."""
        assert "jj" not in ashk("אֱלֹהֵינוּ")
        assert "jj" not in ashk("בְּרֵאשִׁית")

    def test_no_doubled_j_in_a_long_text(self):
        text = (
            "בָּרוּךְ אַתָּה אֲדֹנָי אֱלֹהֵינוּ מֶלֶךְ הָעוֹלָם "
            "אֱלֹהֵי אַבְרָהָם אֱלֹהֵי יִצְחָק וֵאלֹהֵי יַעֲקֹב"
        )
        for accent in ACCENTS:
            assert "jj" not in phonemize(text, accent).ipa, f"{accent}"


# ===================================================================
#  תנועות
# ===================================================================

class TestVowels:
    def test_three_vowels_change_from_israeli(self):
        """קמץ, צירה וחולם — אלה שלוש התנועות שמשתנות."""
        assert "ɔ" in ashk("בָּרָא")
        assert "ɛj" in ashk("אֵת")
        assert "ɛj" in ashk("אוֹת")

    def test_patach_hirik_shuruk_are_similar(self):
        assert "a" in ashk("יַד")
        assert "ɪ" in ashk("אִם")
        assert "ʊ" in ashk("הוּא")

    def test_no_vowel_length_marks(self):
        """הבחנות האורך דרומיות — פולניות ואוקראיניות."""
        assert "ː" not in ashk("שִׁבְעָה כְּתִיבָה חֻפָּה תּוֹרָה שַׁבָּת")

    def test_sheva_na_is_a_mid_vowel(self):
        """[ə] הוא כשלעצמו סימן אשכנזי — אין אותו בישראלית."""
        assert "ə" in ashk("בְּרָכָה")
        assert "ə" not in phonemize("בְּרָכָה", "israeli").ipa


# ===================================================================
#  התנהגות כללית
# ===================================================================

def test_unvocalised_text_warns():
    r = phonemize("שלום עולם", "ashkenazi")
    assert r.warnings and "אינו מנוקד" in r.warnings[0]
    assert r.voweled_words == 0 and r.total_words == 2


def test_partial_vocalisation_warns():
    r = phonemize("שַׁבָּת שלום לכל בית ישראל", "ashkenazi")
    assert any("אינן מנוקדות" in w for w in r.warnings)


def test_fully_vocalised_does_not_warn():
    r = phonemize("שַׁבָּת שָׁלוֹם", "ashkenazi")
    assert r.voweled_words == r.total_words == 2
    assert not any("מנוקד" in w for w in r.warnings)


def test_empty_input():
    r = phonemize("", "ashkenazi")
    assert r.ipa == "" and r.total_words == 0


def test_punctuation_survives():
    r = phonemize("שַׁבָּת, שָׁלוֹם!", "ashkenazi")
    assert "," in r.ipa and "!" in r.ipa


def test_unknown_accent_raises():
    with pytest.raises(ValueError):
        phonemize("שַׁבָּת", "yemenite")


def test_per_word_breakdown():
    r = phonemize("שַׁבָּת שָׁלוֹם", "ashkenazi")
    assert len(r.per_word) == 2
    assert r.per_word[0][1] == "ˈʃabɔs"


def test_accent_options_are_in_hebrew():
    opts = accent_options()
    assert len(opts) >= 3
    for o in opts:
        assert o["stress"] in ("מלעיל", "מלרע")
        assert o["region"]


def test_monosyllable_gets_no_mark():
    assert "ˈ" not in ashk("בֵּן")


def test_nikud_detection():
    assert has_nikud("שַׁבָּת")
    assert not has_nikud("שבת")


def test_split_units_handles_dagesh_and_vowel():
    units, prefix_len = split_units("תּוֹרָה")
    assert units[0].letter == "ת" and units[0].has_dagesh
    assert len(units) == 4
    assert prefix_len == 0


def test_split_units_reads_the_prefix_mark():
    """המנקד האוטומטי מסמן איפה התחילית נגמרת."""
    units, prefix_len = split_units("הָ|אָרֶץ")
    assert prefix_len == 1
    assert len(units) == 4


class TestPrefixStress:
    """חוסם ההטעמה השני: תחילית אינה מוטעמת.

    הַבֵּן = habéyn ולא hábeyn. הסימון בא מהמנקד האוטומטי.
    """

    def test_definite_article_is_not_stressed(self):
        ipa = ashk("הַ|בֵּן")
        assert ipa.index("ˈ") > 0, f"ההטעמה נפלה על התחילית: {ipa}"

    def test_prefix_he_still_sounds(self):
        """ה' של תחילית אינה בסוף מילה ולכן אינה שותקת.

        בלי טיפול בסימן התחילית, "הָ|אָרֶץ" התפצלה לשתי מילים,
        ה-ה' נחשבה סוף מילה ונעלמה.
        """
        assert ashk("הָ|אָרֶץ").startswith("h")

    def test_only_one_stress_mark_per_word(self):
        """מילה מפוצלת קיבלה שני סימני הטעמה."""
        for word in ("הָ|אָרֶץ", "שֶׁהַ|דָּבָר", "וְ|אֶת", "בַּ|מַחֲלֹקֶת"):
            assert ashk(word).count("ˈ") <= 1, f"{word}: יותר מסימן אחד"

    def test_vav_after_holam_is_a_mater(self):
        """המנקד כותב "מחלוקת" כ-מַחְלֹוקֶת — ו' ריקה אחרי חולם.

        בלי הכלל הזה נוסף v והמילה יוצאת maχlɔvkəs.
        """
        assert "v" not in ashk("מַחְלֹוקֶת")


def test_word_to_ipa_reports_missing_shin_dot():
    _, warns = word_to_ipa("שבת", ASHKENAZI_LITHUANIAN)
    assert any("נקודה מבדילה" in w for w in warns)


# ===================================================================
#  אימות מול טבלת הצלילים של המנוע
# ===================================================================

@pytest.mark.skipif(not engine_vocab(), reason="טבלת הצלילים של המנוע אינה מותקנת")
class TestAgainstEngineVocab:
    """כל צליל שאנחנו מפיקים חייב להיות בטבלה של המנוע.

    המנוע זורק סימן שאינו מכיר **בשקט**. בלי הבדיקה הזאת מילה
    תיעלם מההקראה בלי שום הודעה.
    """

    LONG_TEXT = (
        "בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ. "
        "וְהָאָרֶץ הָיְתָה תֹהוּ וָבֹהוּ וְחֹשֶׁךְ עַל פְּנֵי תְהוֹם. "
        "בָּרוּךְ אַתָּה אֲדֹנָי אֱלֹהֵינוּ מֶלֶךְ הָעוֹלָם. "
        "שְׁמַע יִשְׂרָאֵל אֲדֹנָי אֱלֹהֵינוּ אֲדֹנָי אֶחָד. "
        "הַגְּמָרָא אוֹמֶרֶת שֶׁהַדָּבָר תָּלוּי בְּמַחֲלֹקֶת. "
        "מַעֲשֶׂה טַעֲנָה תַּעֲנוּג קוֹלוֹת חֲלוֹמוֹת מַלְכוּת"
    )

    @pytest.mark.parametrize("accent", list(ACCENTS))
    @pytest.mark.parametrize("level", [LEVEL_READING, LEVEL_PRAYER, LEVEL_LESSON])
    def test_output_is_fully_supported(self, accent, level):
        r = phonemize(self.LONG_TEXT, accent, level=level)
        assert r.unsupported == [], f"{accent}/{level}: {r.unsupported}"

    def test_every_table_value_is_in_the_vocab(self):
        vocab = engine_vocab()
        for accent in ACCENTS.values():
            for table in (accent.consonants, accent.soft, accent.vowels):
                for key, value in table.items():
                    for ch in value:
                        assert ch in vocab, (
                            f"{accent.name}: הצליל {value!r} של {key!r} "
                            f"מכיל את {ch!r} שאינו בטבלת המנוע"
                        )
            if accent.sheva_na:
                assert accent.sheva_na in vocab

    def test_word_overrides_are_in_the_vocab(self):
        """גם רשימת החריגים, שנכתבה ביד ולכן חשופה לטעות הקלדה."""
        vocab = engine_vocab()
        for accent, table in WORD_OVERRIDES.items():
            for word, ipa in table.items():
                for ch in ipa:
                    assert ch in vocab, f"{accent}/{word}: {ch!r} אינו בטבלה"

    def test_stress_mark_is_in_the_vocab(self):
        assert "ˈ" in engine_vocab()

    def test_detector_catches_a_bad_symbol(self):
        """הבדיקה עצמה חייבת לעבוד — אחרת היא שומרת על כלום."""
        assert "א" in unsupported_symbols("ʃabɔs א")


class TestNikudHelpers:
    """סימני העזר של המנקד אינם ניקוד ואסור שיוצגו למשתמש.

    המנקד מוסיף קו אנכי בין תחילית לשורש. הקו נחוץ לממיר הצלילים —
    הוא מה שמאפשר לדעת שתחילית אינה מוטעמת — אבל בטקסט שמוצג
    למשתמש הוא נראה כתקלה.
    """

    def test_strip_removes_the_prefix_mark(self):
        from hebrew_nikud import strip_helpers
        assert "|" not in strip_helpers("שֶׁ|הַ|דָּבָר")
        assert strip_helpers("שֶׁ|הַ|דָּבָר") == "שֶׁהַדָּבָר"

    def test_strip_removes_the_non_standard_marks(self):
        from hebrew_nikud import strip_helpers
        # הטעמה, אם קריאה ומתג — שלושתם אינם ניקוד אמיתי.
        assert strip_helpers("רַ֫בִּי") == "רַבִּי"
        assert strip_helpers("א֯ב") == "אב"
        assert strip_helpers("יְֽהוּ") == "יְהוּ"

    def test_strip_keeps_real_nikud(self):
        from hebrew_nikud import strip_helpers
        assert strip_helpers("שַׁבָּת") == "שַׁבָּת"

    def test_strip_handles_empty(self):
        from hebrew_nikud import strip_helpers
        assert strip_helpers("") == ""
        assert strip_helpers(None) == ""

    def test_the_phonemizer_still_needs_the_mark(self):
        """הקו נשאר לממיר הצלילים — אחרת חוסם ההטעמה השני לא עובד."""
        with_mark = ashk("הַ|בֵּן")
        without = ashk("הַבֵּן")
        assert with_mark != without, "הקו חייב להשפיע על ההטעמה"
        assert with_mark.index("ˈ") > 0


class TestMatresLectionis:
    """אותיות שנכתבות ואינן נשמעות.

    המנקד האוטומטי מנקד טקסט בכתיב מלא: הוי"ו כבר קיימת בטקסט
    המקורי, והוא רק מוסיף סימן תנועה על האות שלפניה. כך נוצרות
    צורות שנראות מוזרות אך תקינות — ושבהן הוי"ו היא אם קריאה
    ולא עיצור.

    בלי הכללים האלה נוסף עיצור v שלא נאמר כלל.
    """

    def test_vav_after_holam_is_silent(self):
        assert ashk("מַחְלֹוקֶת") == ashk("מַחְלֹקֶת")

    def test_vav_after_kubutz_is_silent(self):
        """הבאג שנתפס בבדיקה מקצה לקצה.

        המנקד הוציא "לכולם" כ-לְכֻולָּם, והתוצאה הייתה ləχʊvlɔm
        עם v באמצע. הכלל לחולם היה קיים, לקובוץ לא.
        """
        assert ashk("לְכֻולָּם") == ashk("לְכֻלָּם")

    def test_no_stray_v_in_either_spelling(self):
        for word in ("לְכֻולָּם", "לְכֻלָּם", "מַחְלֹוקֶת", "שָׁלוֹם"):
            assert "v" not in ashk(word), word

    def test_vav_at_the_start_is_still_a_consonant(self):
        """אסור שהתיקון ישתיק וי"ו שכן נשמעת."""
        assert ashk("וְאָהַבְתָּ").startswith("v")

    def test_vav_between_vowels_is_still_a_consonant(self):
        # מִצְוָה — הוי"ו נושאת תנועה משלה ולכן היא עיצור.
        assert "v" in ashk("מִצְוָה")

    def test_shuruk_is_not_affected(self):
        assert ashk("הוּא") == "hʊ"

    def test_yod_rule_still_holds(self):
        # הכלל המקביל ליו"ד, שהיה קיים לפני כן.
        assert ashk("בַּיִת") != ashk("בֵּית")

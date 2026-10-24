#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""בדיקות לשכפול הקול.

הבדיקה המרכזית כאן היא בחירת הקטע. בהקלטת שיעור של שעה וחצי, לקיחת
עשרים השניות הראשונות היא כמעט תמיד טעות: ההתחלה היא שקט, פתיח, או
מישהו אחר שמדבר. הקול שייחלץ ממנה לא יהיה הקול שרצינו — וזה כשל
שנראה כאילו המנוע גרוע.

    python -m pytest server/test_voice_cloning.py -q
"""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from voice_cloning import (  # noqa: E402
    BUILTIN_VOICES, CHUNK_COMPRESS, CloningError, MAX_SECONDS, SAMPLE_RATE,
    VoiceCloner, _safe_name,
)


def make_audio(segments):
    """בונה הקלטה מרשימה של (שניות, עוצמה).

    עוצמה אפס היא שקט. כך אפשר לבנות הקלטה שההתחלה שלה שקטה
    והדיבור באמצע, ולבדוק שהבחירה מוצאת אותו.
    """
    rng = np.random.default_rng(7)
    parts = []
    for seconds, level in segments:
        n = int(seconds * SAMPLE_RATE)
        if level <= 0:
            parts.append(np.zeros(n, dtype=np.float32))
        else:
            parts.append((rng.standard_normal(n) * level).astype(np.float32))
    return np.concatenate(parts)


class TestWindowPicking:
    def test_short_audio_is_returned_whole(self):
        wav = make_audio([(5, 0.2)])
        out, start = VoiceCloner.pick_best_window(wav)
        assert len(out) == len(wav)
        assert start == 0.0

    def test_window_is_the_requested_length(self):
        wav = make_audio([(60, 0.2)])
        out, _ = VoiceCloner.pick_best_window(wav, seconds=20)
        assert abs(len(out) - 20 * SAMPLE_RATE) < SAMPLE_RATE

    def test_silence_at_the_start_is_skipped(self):
        """זה המקרה האמיתי: הקלטת שיעור שמתחילה בשקט.

        בלי הבחירה, הקול היה מחולץ מהשקט — והתוצאה חסרת ערך.
        """
        wav = make_audio([(40, 0.0), (40, 0.3)])
        _out, start = VoiceCloner.pick_best_window(wav, seconds=20)
        assert start >= 30, f"הקטע נבחר מהשנייה {start}, בתוך השקט"

    def test_quiet_intro_is_skipped(self):
        """פתיח חלש בהתחלה ודיבור חזק אחר כך."""
        wav = make_audio([(30, 0.01), (30, 0.4), (30, 0.01)])
        _out, start = VoiceCloner.pick_best_window(wav, seconds=20)
        assert 25 <= start <= 45, f"הקטע נבחר מהשנייה {start}"

    def test_manual_start_overrides_the_choice(self):
        wav = make_audio([(90, 0.2)])
        _out, start = VoiceCloner.pick_best_window(wav, seconds=20, start_seconds=50)
        assert abs(start - 50) < 1

    def test_manual_start_past_the_end_is_clamped(self):
        """בקשה להתחיל אחרי סוף הקובץ אינה אמורה להפיל כלום."""
        wav = make_audio([(30, 0.2)])
        out, start = VoiceCloner.pick_best_window(wav, seconds=20, start_seconds=9999)
        assert abs(len(out) - 20 * SAMPLE_RATE) < SAMPLE_RATE
        assert start <= 10

    def test_negative_start_is_clamped(self):
        wav = make_audio([(30, 0.2)])
        _out, start = VoiceCloner.pick_best_window(wav, seconds=20, start_seconds=-5)
        assert start == 0.0

    def test_the_chosen_window_has_less_silence(self):
        """הבדיקה המהותית: הקטע שנבחר באמת טוב יותר מההתחלה."""
        wav = make_audio([(40, 0.0), (40, 0.3)])
        first = wav[: int(20 * SAMPLE_RATE)]
        best, _ = VoiceCloner.pick_best_window(wav, seconds=20)
        silence_first = float(np.mean(np.abs(first) < 0.01))
        silence_best = float(np.mean(np.abs(best) < 0.01))
        assert silence_best < silence_first


class TestFeatureFrames:
    def test_frames_must_divide_by_six(self):
        """הגרף מקפל שש מסגרות לאחת.

        מספר שאינו מתחלק בשש מפיל את הגרף בשגיאת צורה שאינה מסבירה
        מה הבעיה. החיתוך הוא לכל היותר חמש מסגרות, פחות מ-0.06 שניות.
        """
        assert CHUNK_COMPRESS == 6
        for frames in (1034, 1035, 1036, 1037, 1038, 1039):
            usable = frames - (frames % CHUNK_COMPRESS)
            assert usable % CHUNK_COMPRESS == 0
            assert frames - usable < CHUNK_COMPRESS


class TestInspection:
    def test_short_recording_warns(self):
        wav = make_audio([(1, 0.2)])
        warnings, _ = VoiceCloner.inspect(wav, SAMPLE_RATE)
        assert any("אינו מספיק" in w for w in warnings)

    def test_quiet_recording_warns(self):
        wav = make_audio([(10, 0.002)])
        warnings, _ = VoiceCloner.inspect(wav, SAMPLE_RATE)
        assert any("חלשה" in w for w in warnings)

    def test_clipped_recording_warns(self):
        wav = make_audio([(10, 0.3)])
        wav[: SAMPLE_RATE] = 1.0
        warnings, _ = VoiceCloner.inspect(wav, SAMPLE_RATE)
        assert any("חתוכה בפסגות" in w for w in warnings)

    def test_low_sample_rate_warns(self):
        """הקלטה ב-16000 אינה מכילה תדרים גבוהים, והמנוע ימציא אותם."""
        wav = make_audio([(10, 0.2)])
        warnings, _ = VoiceCloner.inspect(wav, 16000)
        assert any("44100" in w for w in warnings)

    def test_mostly_silent_warns(self):
        wav = make_audio([(9, 0.0), (1, 0.3)])
        warnings, _ = VoiceCloner.inspect(wav, SAMPLE_RATE)
        assert any("שקט" in w for w in warnings)

    def test_good_recording_has_no_length_or_level_warning(self):
        wav = make_audio([(10, 0.15)])
        warnings, _ = VoiceCloner.inspect(wav, SAMPLE_RATE)
        assert not any("אינו מספיק" in w or "חלשה" in w for w in warnings)

    def test_all_warnings_are_in_hebrew(self):
        """המשתמש אינו קורא אנגלית."""
        wav = make_audio([(1, 0.001)])
        warnings, _ = VoiceCloner.inspect(wav, 8000)
        assert warnings
        for w in warnings:
            assert any("א" <= c <= "ת" for c in w), w


class TestSanityCheck:
    def test_flat_identity_is_rejected(self):
        """זהות קול שטוחה פירושה שההקלטה לא נתנה כלום."""
        ttl = np.zeros((1, 50, 256), dtype=np.float32)
        dp = np.zeros((1, 8, 16), dtype=np.float32)
        problems = VoiceCloner._sanity_check(ttl, dp)
        assert any("שטוחה" in p for p in problems)

    def test_invalid_numbers_are_rejected(self):
        ttl = np.full((1, 50, 256), np.nan, dtype=np.float32)
        dp = np.zeros((1, 8, 16), dtype=np.float32)
        assert VoiceCloner._sanity_check(ttl, dp)

    def test_extreme_values_are_rejected(self):
        rng = np.random.default_rng(1)
        ttl = (rng.standard_normal((1, 50, 256)) * 10).astype(np.float32)
        dp = np.zeros((1, 8, 16), dtype=np.float32)
        assert any("חריגים" in p for p in VoiceCloner._sanity_check(ttl, dp))

    def test_a_normal_identity_passes(self):
        """להשוואה: קול מוכן נמדד בפיזור 0.0634."""
        rng = np.random.default_rng(2)
        ttl = (rng.standard_normal((1, 50, 256)) * 0.06).astype(np.float32)
        dp = (rng.standard_normal((1, 8, 16)) * 0.1).astype(np.float32)
        assert VoiceCloner._sanity_check(ttl, dp) == []


class TestNaming:
    def test_path_characters_are_removed(self):
        assert "/" not in _safe_name("a/b")
        assert "\\" not in _safe_name("a\\b")
        assert ".." not in _safe_name("a..b")

    def test_hebrew_is_kept(self):
        assert "הרב" in _safe_name("הרב מהשיעור")

    def test_spaces_become_underscores(self):
        assert " " not in _safe_name("שם עם רווחים")

    def test_name_is_capped(self):
        assert len(_safe_name("א" * 200)) <= 60

    def test_builtin_voices_cannot_be_overwritten(self):
        c = VoiceCloner()
        with pytest.raises(CloningError) as e:
            c.clone("ignored.wav", "female")
        assert "בא עם המנוע" in str(e.value)

    def test_builtin_voices_cannot_be_deleted(self):
        c = VoiceCloner()
        with pytest.raises(CloningError):
            c.delete_voice("female")

    def test_empty_name_is_rejected(self):
        c = VoiceCloner()
        with pytest.raises(CloningError):
            c.clone("ignored.wav", "   ")

    def test_the_builtin_list_matches_the_shipped_voices(self):
        """הרשימה נכתבה ביד ועלולה להתיישן."""
        c = VoiceCloner()
        if not os.path.isdir(c.voices_dir):
            pytest.skip("הקולות אינם מותקנים")
        on_disk = {f[:-5] for f in os.listdir(c.voices_dir) if f.endswith(".json")}
        assert BUILTIN_VOICES <= on_disk, (
            f"חסרים על הכונן: {BUILTIN_VOICES - on_disk}")


def test_max_seconds_is_sane():
    assert 5 <= MAX_SECONDS <= 60

# -*- coding: utf-8 -*-
"""בדיקות לבחירת ספק החישוב במנוע ההקראה.

למה הקובץ הזה קיים: המנוע נסוג למעבד **בשקט**. אם ספריית החישוב
אינה בנתיב החיפוש של חלונות, טעינת ספק כרטיס המסך נכשלת, מנוע
ההרצה חוזר למעבד, ולא נזרקת שום שגיאה ולא מודפסת שום אזהרה.

התוצאה: עבודה איטית פי אחת עשרה בלי שאף אחד יודע למה. בדיוק זה
קרה כאן — וזה נתפס רק כי נבדק איזה ספק פועל בפועל, ולא רק כמה
זמן זה לקח.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bluetts_engine as be


class TestProviderChoice:
    def test_gpu_is_preferred_when_available(self):
        class FakeOrt:
            @staticmethod
            def get_available_providers():
                return ["CUDAExecutionProvider", "CPUExecutionProvider"]

        picked = be.BlueTts._pick_providers(FakeOrt)
        assert picked[0] == "CUDAExecutionProvider"

    def test_cpu_stays_as_the_fallback(self):
        """המעבד נשאר ברשימה — נסיגה אליו עדיפה על כישלון."""
        class FakeOrt:
            @staticmethod
            def get_available_providers():
                return ["CUDAExecutionProvider", "CPUExecutionProvider"]

        assert "CPUExecutionProvider" in be.BlueTts._pick_providers(FakeOrt)

    def test_cpu_only_when_nothing_else(self):
        class FakeOrt:
            @staticmethod
            def get_available_providers():
                return ["CPUExecutionProvider"]

        assert be.BlueTts._pick_providers(FakeOrt) == ["CPUExecutionProvider"]

    def test_directx_is_the_second_choice(self):
        class FakeOrt:
            @staticmethod
            def get_available_providers():
                return ["DmlExecutionProvider", "CPUExecutionProvider"]

        assert be.BlueTts._pick_providers(FakeOrt)[0] == "DmlExecutionProvider"


class TestDllDirectories:
    """הנתיבים שבלעדיהם הנסיגה השקטה קורית."""

    def test_adding_dirs_does_not_raise(self):
        # גם כשאין חבילת חישוב כלל — אסור שזה יפיל את הטעינה.
        assert isinstance(be.BlueTts._add_gpu_dll_dirs(), list)

    def test_it_runs_before_the_providers_are_chosen(self):
        """הסדר הוא כל העניין.

        הוספת הנתיבים אחרי יצירת ההפעלה לא עוזרת: באותו רגע
        ההחלטה כבר נפלה והמנוע כבר על המעבד.
        """
        src = open(be.__file__, encoding="utf-8").read()
        add_at = src.index("self._add_gpu_dll_dirs()")
        pick_at = src.index("self._pick_providers(ort)")
        assert add_at < pick_at, "הוספת הנתיבים חייבת לקדום לבחירת הספק"

    @pytest.mark.skipif(sys.platform != "win32", reason="נוגע לחלונות בלבד")
    def test_the_compute_library_is_findable(self):
        """אם החבילה מותקנת — הספרייה חייבת להימצא.

        כשל כאן פירושו שההקראה תרוץ על המעבד, ולא יהיה שום סימן
        לכך מלבד האיטיות.
        """
        try:
            import torch
        except Exception:
            pytest.skip("חבילת החישוב אינה מותקנת")
        lib = os.path.join(os.path.dirname(torch.__file__), "lib")
        if not os.path.isdir(lib):
            pytest.skip("אין תיקיית ספריות")
        names = os.listdir(lib)
        assert any(n.startswith("cublasLt64_") for n in names), \
            "ספריית החישוב חסרה — ההקראה תיסוג למעבד בשקט"

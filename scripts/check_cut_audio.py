"""בודק שהקבצים שיצאו מהחיתוך באמת מכילים את מה שהם אמורים להכיל.

הבדיקות בדפדפן מורידות את הקבצים לתיקייה. הכלי הזה מודד כל קובץ:
אורך, ואילו צלילים נמצאים בו ובאיזה סדר. כך "עבר" אינו תלוי בשום
כתובית על המסך, אלא באודיו עצמו.

הרצה:
    python -I scripts/check_cut_audio.py <תיקייה>
"""

from __future__ import annotations

import sys
import wave
from pathlib import Path

import numpy as np

# חלון הפקודות של חלונות אינו מציג עברית בברירת המחדל, ואז הכלי
# קורס על ההדפסה הראשונה במקום לדווח על האודיו.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# חמשת הצלילים שמהם בנוי קובץ הבדיקה, לפי סדר הזמן
TONES = {
    300: "אחת",
    600: "שתיים",
    1200: "שלוש",
    2400: "ארבע",
    3600: "חמש",
}

# מה כל מקרה אמור להפיק: לכל קובץ — הצלילים שבו לפי הסדר, והאורך
# הצפוי בשניות.
#
# שימו לב להבדל בין מחיקה לייצוא, שנלמד מטעות בבדיקה הזאת עצמה:
# בייצוא יוצא רק מה שסומן, ולכן האורך הוא אורך הצליל. במחיקה נשמר
# *כל* שאר הקובץ — כולל השתיקות שבין הצלילים — ולכן האורך הוא חמש
# שניות פחות מה שנמחק, ולא סכום הצלילים.
EXPECTED: dict[str, list[tuple[list[int], float]]] = {
    # 5.00 פחות קטע אחד שנמחק (כשנייה)
    "מחיקה-אחד": [([300, 1200, 2400, 3600], 4.0)],
    # 5.00 פחות שני קטעים שנמחקו
    "מחיקה-שניים": [([300, 1200, 3600], 3.0)],
    # אותם חלקים בדיוק, אבל כל אחד כקובץ נפרד
    "מחיקה-נפרד": [([300], 1.0), ([1200], 1.05), ([3600], 1.05)],
    # בייצוא יוצא רק הצליל עצמו
    "ייצוא-אחד": [([1200], 0.95)],
    "ייצוא-שניים-נפרד": [([600], 0.95), ([2400], 0.95)],
    "ייצוא-שניים-מחובר": [([600, 2400], 1.9)],
}

TOLERANCE_SEC = 0.35


def load(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        frames = handle.getnframes()
        rate = handle.getframerate()
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        raw = handle.readframes(frames)
    dtype = np.int16 if width == 2 else np.int32
    data = np.frombuffer(raw, dtype=dtype).astype(np.float64)
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data / (2 ** (8 * width - 1)), rate


def tone_energy(samples: np.ndarray, rate: int, hz: int, bandwidth: int = 80) -> float:
    """העוצמה סביב תדר מסוים. אפס כשהצליל אינו שם."""
    if len(samples) < 64:
        return 0.0
    spectrum = np.abs(np.fft.rfft(samples * np.hanning(len(samples))))
    freqs = np.fft.rfftfreq(len(samples), 1 / rate)
    band = (freqs >= hz - bandwidth) & (freqs <= hz + bandwidth)
    return float(spectrum[band].max()) if band.any() else 0.0


def tones_in_order(samples: np.ndarray, rate: int, count: int) -> list[int]:
    """מחלק את הקובץ ל-count חלקים שווים ומזהה את הצליל השולט בכל חלק."""
    found: list[int] = []
    size = len(samples) // max(1, count)
    for index in range(count):
        chunk = samples[index * size:(index + 1) * size]
        # מתעלמים מהקצוות, שם יושבות התפרים
        margin = len(chunk) // 6
        core = chunk[margin:len(chunk) - margin] if len(chunk) > 4 * margin else chunk
        energies = {hz: tone_energy(core, rate, hz) for hz in TONES}
        found.append(max(energies, key=energies.get))
    return found


def check_case(folder: Path, name: str, expected_files: list[tuple[list[int], float]]) -> list[str]:
    problems: list[str] = []
    print(f"\n── {name} ──")

    for file_index, (expected_tones, expected_sec) in enumerate(expected_files, start=1):
        path = folder / f"{name}-{file_index}.wav"
        if not path.is_file():
            problems.append(f"{name}: הקובץ {path.name} לא נוצר")
            print(f"  ✗ {path.name} — חסר")
            continue

        samples, rate = load(path)
        seconds = len(samples) / rate
        order = tones_in_order(samples, rate, len(expected_tones))

        # הצלילים שהיו אמורים להימחק
        removed = [hz for hz in TONES if hz not in expected_tones]
        strongest = max((tone_energy(samples, rate, hz) for hz in expected_tones), default=0.0)
        leaks = []
        for hz in removed:
            level = tone_energy(samples, rate, hz)
            if strongest > 0 and level / strongest > 0.05:
                leaks.append(f"{TONES[hz]} ({hz} הרץ) נשאר ב-{level / strongest:.0%}")

        length_ok = abs(seconds - expected_sec) <= TOLERANCE_SEC
        order_ok = order == expected_tones
        clean = not leaks

        print(f"  {path.name}")
        print(f"     אורך   : {seconds:.2f} שניות (צפוי {expected_sec:.2f})"
              f"  {'תקין' if length_ok else '✗ חורג'}")
        print(f"     סדר    : {' ← '.join(TONES[h] for h in order)}"
              f"  {'תקין' if order_ok else '✗ צפוי ' + ' ← '.join(TONES[h] for h in expected_tones)}")
        print(f"     נקיון  : {'אין שאריות של מה שנמחק' if clean else '✗ ' + ', '.join(leaks)}")

        if not length_ok:
            problems.append(f"{name}/{path.name}: אורך {seconds:.2f} במקום {expected_sec:.2f}")
        if not order_ok:
            problems.append(f"{name}/{path.name}: סדר הצלילים שגוי")
        if not clean:
            problems.append(f"{name}/{path.name}: {'; '.join(leaks)}")

    return problems


def main() -> int:
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "test-results/audio-cases")
    if not folder.is_dir():
        print(f"אין תיקייה: {folder}")
        return 2

    all_problems: list[str] = []
    for name, expected in EXPECTED.items():
        all_problems.extend(check_case(folder, name, expected))

    print("\n" + "=" * 60)
    if all_problems:
        print(f"נמצאו {len(all_problems)} בעיות:")
        for problem in all_problems:
            print(f"  • {problem}")
        return 1
    print("כל הקבצים נכונים: אורך, סדר הצלילים, ואין שאריות של מה שנמחק.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

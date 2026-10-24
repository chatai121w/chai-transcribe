#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""שכפול קול — מהקלטה של המשתמש לקול שהמנוע יכול להקריא בו.

מה זה עושה:
    לוקח הקלטה של דובר, מחלץ ממנה את "זהות הקול", ושומר אותה כקול
    חדש. מאותו רגע אפשר להקריא כל טקסט באותו קול.

    **מה שנשמר הוא זהות הקול בלבד, לא ההגייה.** אם ההקלטה בהגייה
    אשכנזית, הקול החדש לא ידבר אשכנזית מעצמו — ההגייה נקבעת על ידי
    הצלילים שנשלחים, וזה חלק אחר לגמרי של המערכת. זאת נקודה שקל
    לטעות בה ולצפות שההקלטה "תלמד" את המבטא.

השרשרת:
    הקלטה  ->  תכונות שמע (1253 ערוצים)  ->  ייצוג הקול (144 ערוצים)
           ->  זהות הקול (50 על 256) + קצב הדיבור (8 על 16)

שלוש מלכודות:
    1. קדם-העיבוד חייב להיות זהה בדיוק לזה שהמנוע אומן עליו. פרמטר
       אחד שונה ומקבלים קול שנשמע דומה לדובר אחר לגמרי.
    2. ההקלטה חייבת להיות ב-44100 דגימות בשנייה. הקלטה ב-16000
       עובדת, אבל אין בה שום תוכן מעל 8000 הרץ, והמנוע ימציא שם
       תוכן — כלומר הקול ייצא דומה פחות.
    3. הייצוג חייב להיות מנורמל עם קובץ הנתונים הנכון. יש שני קבצים
       כאלה בשני המחסנים, הם שונים, והקובץ הלא נכון מייצר הסחה.
       כאן זה אינו רלוונטי: הנרמול מוטבע בתוך הגרף.
"""
from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "blue-onnx-v2")
VOICES_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "models", "bluetts25", "voices")

SAMPLE_RATE = 44100
N_FFT = 2048
WIN_LENGTH = 2048
HOP_LENGTH = 512
N_MELS = 228
#: 1025 ערוצי עוצמת ההתמרה ועוד 228 ערוצי מל.
FEATURE_CHANNELS = N_FFT // 2 + 1 + N_MELS
#: הגרף מקפל שש מסגרות של 24 ערוצים לאחת של 144, ולכן מספר המסגרות
#: חייב להתחלק בשש.
CHUNK_COMPRESS = 6
LOG_FLOOR = 1e-5

#: אורך מינימלי להקלטת ייחוס. קצר מזה אינו מספיק לזהות קול.
MIN_SECONDS = 2.0
#: אורך מקסימלי. ארוך מזה אינו משפר, ורק מאט.
MAX_SECONDS = 20.0

#: שמות שאסור לדרוס — אלה הקולות המוכנים שבאו עם המנוע.
BUILTIN_VOICES = {
    "female", "libri_female_1088", "libri_female_6147",
    "libri_male_6209", "libri_male_8088",
}


class CloningError(RuntimeError):
    """שגיאה שאפשר להציג למשתמש כמו שהיא."""


@dataclass
class CloneReport:
    """מה נמדד בהקלטה, להצגה למשתמש."""
    name: str
    seconds: float
    source_rate: int
    frames: int
    #: עוצמת הקול. נמוכה מדי פירושה הקלטה חלשה.
    rms: float
    peak: float
    #: חלק ההקלטה שהוא שקט. גבוה פירושו שיש הרבה שקט מיותר.
    silence_fraction: float
    #: אורך הקובץ המקורי, לפני שנבחר ממנו קטע.
    source_seconds: float
    #: באיזו שנייה בקובץ המקורי הקטע מתחיל.
    window_start: float
    #: כמה תוכן יש בתדרים הגבוהים. נמוך פירושו הקלטה דחוסה או דגומה נמוך.
    high_freq_energy: float
    warnings: List[str]
    path: str

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "seconds": round(self.seconds, 2),
            "sourceRate": self.source_rate,
            "frames": self.frames,
            "rms": round(self.rms, 4),
            "peak": round(self.peak, 4),
            "silenceFraction": round(self.silence_fraction, 3),
            "sourceSeconds": round(self.source_seconds, 1),
            "windowStart": round(self.window_start, 1),
            "highFreqEnergy": round(self.high_freq_energy, 4),
            "warnings": self.warnings,
            "path": self.path,
        }


class VoiceCloner:
    def __init__(self, model_dir: str = MODEL_DIR, voices_dir: str = VOICES_DIR):
        self.model_dir = model_dir
        self.voices_dir = voices_dir
        self._lock = threading.Lock()
        self._sessions: Dict[str, object] = {}
        self._mel_fb: Optional[np.ndarray] = None

    # --------------------------------------------------------------- התקנה

    def missing_files(self) -> List[str]:
        needed = ["codec_encoder.onnx", "style_encoder.onnx", "duration_style_encoder.onnx"]
        return [n for n in needed if not os.path.exists(os.path.join(self.model_dir, n))]

    def available(self) -> bool:
        return not self.missing_files()

    def load(self) -> None:
        with self._lock:
            if self._sessions:
                return
            missing = self.missing_files()
            if missing:
                raise CloningError(
                    "שכפול הקול אינו מותקן. חסרים: " + ", ".join(missing))
            try:
                import onnxruntime as ort
            except ImportError as exc:
                raise CloningError("חסרה חבילת ההרצה.") from exc

            opts = ort.SessionOptions()
            opts.log_severity_level = 3
            have = ort.get_available_providers()
            providers = (["CUDAExecutionProvider", "CPUExecutionProvider"]
                         if "CUDAExecutionProvider" in have else ["CPUExecutionProvider"])
            for name in ("codec_encoder", "style_encoder", "duration_style_encoder"):
                path = os.path.join(self.model_dir, f"{name}.onnx")
                self._sessions[name] = ort.InferenceSession(
                    path, sess_options=opts, providers=providers)

    # ------------------------------------------------------- קדם-העיבוד

    def _mel_filterbank(self) -> np.ndarray:
        """מסננת המל, בדיוק כמו בקוד המקור.

        htk=True ו-norm=None אינם ברירת המחדל של הספרייה. פרמטר אחד
        שונה כאן מייצר תכונות שאינן מה שהמנוע אומן עליו, והקול יוצא
        של דובר אחר.
        """
        if self._mel_fb is not None:
            return self._mel_fb
        try:
            import librosa
        except ImportError as exc:
            raise CloningError("חסרה חבילת עיבוד השמע.") from exc
        self._mel_fb = librosa.filters.mel(
            sr=SAMPLE_RATE, n_fft=N_FFT, n_mels=N_MELS,
            fmin=0.0, fmax=None, htk=True, norm=None,
        ).astype(np.float32)
        return self._mel_fb

    def features(self, wav: np.ndarray) -> np.ndarray:
        """הקלטה -> תכונות שמע בצורה [1, 1253, T]."""
        try:
            import librosa
        except ImportError as exc:
            raise CloningError("חסרה חבילת עיבוד השמע.") from exc

        stft = librosa.stft(
            wav.astype(np.float32), n_fft=N_FFT, hop_length=HOP_LENGTH,
            win_length=WIN_LENGTH, window="hann", center=True, pad_mode="reflect",
        )
        mag = np.abs(stft).astype(np.float32)
        mel = self._mel_filterbank() @ mag

        log_mag = np.log(np.maximum(mag, LOG_FLOOR))
        log_mel = np.log(np.maximum(mel, LOG_FLOOR))
        feats = np.concatenate([log_mag, log_mel], axis=0).astype(np.float32)

        if feats.shape[0] != FEATURE_CHANNELS:
            raise CloningError(
                f"התכונות יצאו ב-{feats.shape[0]} ערוצים ולא {FEATURE_CHANNELS}."
            )
        return np.ascontiguousarray(feats[None, :, :], dtype=np.float32)

    # ----------------------------------------------------------- טעינת שמע

    @staticmethod
    def read_audio(path: str) -> Tuple[np.ndarray, int]:
        """קורא קובץ שמע, ממיר לחד-ערוצי, ומדגם מחדש ל-44100."""
        try:
            import librosa
            import soundfile as sf
        except ImportError as exc:
            raise CloningError("חסרה חבילת קריאת השמע.") from exc

        try:
            wav, sr = sf.read(path, dtype="float32", always_2d=True)
        except Exception:
            # קבצים דחוסים שהספרייה הראשונה אינה קוראת.
            try:
                wav, sr = librosa.load(path, sr=None, mono=False)
                wav = np.atleast_2d(wav).T if wav.ndim == 1 else wav.T
            except Exception as exc:
                raise CloningError(f"לא ניתן לקרוא את קובץ השמע: {exc}") from exc

        wav = np.mean(wav, axis=1) if wav.ndim > 1 else wav
        original_rate = int(sr)
        if original_rate != SAMPLE_RATE:
            wav = librosa.resample(
                wav.astype(np.float32), orig_sr=original_rate,
                target_sr=SAMPLE_RATE, res_type="kaiser_best")
        return np.ascontiguousarray(wav, dtype=np.float32), original_rate

    # --------------------------------------------------------- אבחון ההקלטה

    @staticmethod
    def pick_best_window(
        wav: np.ndarray,
        seconds: float = MAX_SECONDS,
        start_seconds: Optional[float] = None,
    ) -> Tuple[np.ndarray, float]:
        """בוחר את הקטע הטוב ביותר בהקלטה.

        למה זה נחוץ: לקיחת ההתחלה היא טעות בהקלטה ארוכה. בשיעור של
        ארבעים דקות עשרים השניות הראשונות הן בדרך כלל שקט, פתיח,
        או מישהו אחר שמדבר. הקול שייחלץ מהן לא יהיה הקול שרצינו.

        השיטה: מחלקים לחלונות חופפים, ולכל חלון נותנים ציון לפי
        כמה דיבור רצוף יש בו. דיבור רצוף — ולא רק עוצמה — כי קטע
        רועש בלי דיבור מקבל עוצמה גבוהה ואינו שווה כלום לזיהוי קול.

        מחזיר את הקטע ואת הזמן שבו הוא מתחיל, כדי שאפשר יהיה לומר
        למשתמש מאיפה נלקח.
        """
        want = int(seconds * SAMPLE_RATE)
        if len(wav) <= want:
            return wav, 0.0

        if start_seconds is not None:
            start = max(0, min(len(wav) - want, int(start_seconds * SAMPLE_RATE)))
            return wav[start:start + want], start / SAMPLE_RATE

        # עוצמה בחלונות קצרים, כדי לזהות היכן יש דיבור.
        frame = SAMPLE_RATE // 20          # חצי עשירית שנייה
        n_frames = len(wav) // frame
        if n_frames < 4:
            return wav[:want], 0.0
        frames = wav[: n_frames * frame].reshape(n_frames, frame)
        energy = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))

        # סף הדיבור נגזר מההקלטה עצמה ולא ממספר קבוע, כי הקלטה
        # שקטה והקלטה חזקה דורשות ספים שונים.
        #
        # הסף נגזר מהאחוזון ה-75 ולא מהחציון. ההבדל חשוב: כשרוב
        # ההקלטה חלשה — פתיח ארוך, הקדמה, שקט — החציון עצמו חלש,
        # והחלקים החלשים עוברים את הסף ונחשבים דיבור. האחוזון
        # הגבוה מייצג את עוצמת הדיבור האמיתית ולא את הממוצע.
        loud = float(np.percentile(energy, 75))
        speech_floor = max(loud * 0.35, float(np.median(energy)) * 0.6, 1e-4)
        is_speech = (energy > speech_floor).astype(np.float64)

        win_frames = max(1, want // frame)
        if win_frames >= n_frames:
            return wav[:want], 0.0

        # סכום רץ, כדי לא לחשב כל חלון מחדש.
        cumulative = np.concatenate([[0.0], np.cumsum(is_speech)])
        # סכום העוצמה משמש לשבירת שוויון: כשלשני חלונות אותו מספר
        # מסגרות דיבור, עדיף זה שהדיבור בו חזק יותר.
        energy_sum = np.concatenate([[0.0], np.cumsum(energy)])

        step = max(1, win_frames // 8)
        best_start, best_score, best_energy = 0, -1.0, -1.0
        for i in range(0, n_frames - win_frames + 1, step):
            score = cumulative[i + win_frames] - cumulative[i]
            level = energy_sum[i + win_frames] - energy_sum[i]
            if score > best_score or (score == best_score and level > best_energy):
                best_score, best_energy, best_start = score, level, i

        start = best_start * frame
        start = min(start, len(wav) - want)
        return wav[start:start + want], start / SAMPLE_RATE

    @staticmethod
    def inspect(wav: np.ndarray, source_rate: int) -> Tuple[List[str], Dict[str, float]]:
        """מודד את ההקלטה ומזהיר על מה שיפגע בתוצאה.

        האזהרות האלה חוסכות זמן: הקלטה גרועה מייצרת קול גרוע, וקל
        מאוד לחשוב שהמנוע גרוע כשבעצם ההקלטה הייתה.
        """
        warnings: List[str] = []
        seconds = len(wav) / SAMPLE_RATE
        rms = float(np.sqrt(np.mean(wav.astype(np.float64) ** 2))) if len(wav) else 0.0
        peak = float(np.max(np.abs(wav))) if len(wav) else 0.0
        silence = float(np.mean(np.abs(wav) < 0.01)) if len(wav) else 1.0

        # תוכן בתדרים גבוהים. הקלטה דגומה נמוך או דחוסה חזק ריקה שם.
        high = 0.0
        if len(wav) >= N_FFT:
            spec = np.abs(np.fft.rfft(wav[: SAMPLE_RATE * 4] * np.hanning(
                min(len(wav), SAMPLE_RATE * 4))))
            if spec.size:
                half = spec.size // 2
                total = float(np.sum(spec)) or 1.0
                high = float(np.sum(spec[half:]) / total)

        if seconds < MIN_SECONDS:
            warnings.append(
                f"ההקלטה {seconds:.1f} שניות בלבד. פחות מ-{MIN_SECONDS:.0f} "
                "שניות אינו מספיק לזהות קול, והתוצאה תהיה רחוקה מהדובר."
            )
        if seconds > MAX_SECONDS:
            warnings.append(
                f"ההקלטה {seconds:.0f} שניות. מעבר ל-{MAX_SECONDS:.0f} שניות "
                "אין שיפור, רק איטיות. נחתך לקטע הראשון."
            )
        if source_rate < 32000:
            warnings.append(
                f"ההקלטה המקורית ב-{source_rate} דגימות בשנייה, והמנוע עובד "
                "ב-44100. אין בה תוכן בתדרים הגבוהים, והמנוע ימציא שם תוכן — "
                "הקול יהיה דומה פחות לדובר."
            )
        if rms < 0.01:
            warnings.append(
                "ההקלטה חלשה מאוד. כדאי להגביר אותה או להקליט מחדש קרוב יותר "
                "למיקרופון."
            )
        if peak >= 0.999:
            warnings.append(
                "ההקלטה חתוכה בפסגות. זה מעוות את הקול, והעיוות ייכנס לקול "
                "המשוכפל."
            )
        if silence > 0.5:
            warnings.append(
                f"{round(silence * 100)} אחוז מההקלטה שקט. כדאי לחתוך את השקט "
                "ולהשאיר דיבור רצוף."
            )
        if high < 0.005:
            warnings.append(
                "אין כמעט תוכן בתדרים הגבוהים. ההקלטה כנראה דחוסה חזק."
            )

        return warnings, {"rms": rms, "peak": peak, "silence": silence, "high": high}

    # ---------------------------------------------------------- השכפול עצמו

    def encode(self, wav: np.ndarray) -> np.ndarray:
        """הקלטה -> ייצוג הקול בצורה [1, 144, T].

        הקיפול ל-144 ערוצים והנרמול מוטבעים בתוך הגרף, ולכן אין
        לעשות אותם כאן. עשייה כפולה שלהם מייצרת ייצוג שגוי שעדיין
        מפיק קול — כלומר נכשלת בשקט.
        """
        self.load()
        feats = self.features(wav)

        # מספר המסגרות חייב להתחלק בשש, כי הגרף מקפל שש מסגרות של 24
        # ערוצים לאחת של 144. מספר שאינו מתחלק מפיל את הגרף בשגיאת
        # צורה שאינה מסבירה מה הבעיה.
        #
        # החיתוך הוא מהסוף, והוא לכל היותר חמש מסגרות — פחות מ-0.06
        # שניות. אין לו שום השפעה על זהות הקול.
        frames = feats.shape[-1]
        usable = frames - (frames % CHUNK_COMPRESS)
        if usable < CHUNK_COMPRESS:
            raise CloningError(
                f"ההקלטה קצרה מדי: {frames} מסגרות בלבד, וצריך לפחות "
                f"{CHUNK_COMPRESS}."
            )
        if usable != frames:
            feats = np.ascontiguousarray(feats[:, :, :usable], dtype=np.float32)

        sess = self._sessions["codec_encoder"]
        z = sess.run(None, {"mel": feats})[0]
        z = np.asarray(z, dtype=np.float32)
        if z.ndim != 3 or z.shape[1] != 144:
            raise CloningError(
                f"הייצוג יצא בצורה {z.shape} ולא [1, 144, T] כצפוי.")
        return np.ascontiguousarray(z[:1], dtype=np.float32)

    def style_from_latent(self, z_ref: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """ייצוג הקול -> זהות הקול וקצב הדיבור."""
        self.load()
        mask = np.ones((1, 1, z_ref.shape[-1]), dtype=np.float32)
        ttl = self._sessions["style_encoder"].run(
            None, {"z_ref": z_ref, "ref_mask": mask})[0]
        dp = self._sessions["duration_style_encoder"].run(
            None, {"z_ref": z_ref, "ref_mask": mask})[0]
        ttl = np.asarray(ttl, dtype=np.float32)
        dp = np.asarray(dp, dtype=np.float32)
        if ttl.shape != (1, 50, 256):
            raise CloningError(f"זהות הקול יצאה בצורה {ttl.shape} ולא (1, 50, 256).")
        if dp.shape != (1, 8, 16):
            raise CloningError(f"קצב הדיבור יצא בצורה {dp.shape} ולא (1, 8, 16).")
        return ttl, dp

    @staticmethod
    def _sanity_check(ttl: np.ndarray, dp: np.ndarray) -> List[str]:
        """בודק שהתוצאה אינה זבל.

        פלט מספרי תקין אינו מוכיח שהקול שימושי, אבל פלט שקרס לאפס או
        מלא מספרים לא חוקיים כן מוכיח שהוא לא.

        להשוואה: קול מוכן שבא עם המנוע נמדד בסטיית תקן 0.0634 וטווח
        מ-0.654- עד 0.651.
        """
        problems: List[str] = []
        if not np.all(np.isfinite(ttl)) or not np.all(np.isfinite(dp)):
            problems.append("בזהות הקול יש מספרים לא חוקיים.")
        std = float(np.std(ttl))
        if std < 0.005:
            problems.append(
                f"זהות הקול שטוחה כמעט לגמרי (פיזור {std:.4f}). "
                "זה קורה כשההקלטה שקטה או קצרה מדי.")
        peak = float(np.max(np.abs(ttl)))
        if peak > 5.0:
            problems.append(
                f"בזהות הקול יש ערכים חריגים (עד {peak:.2f}). "
                "ההקלטה כנראה מעוותת.")
        return problems

    def clone(
        self,
        audio_path: str,
        name: str,
        note: str = "",
        overwrite: bool = False,
        start_seconds: Optional[float] = None,
    ) -> CloneReport:
        """יוצר קול חדש מהקלטה ושומר אותו."""
        safe = _safe_name(name)
        if not safe:
            raise CloningError("צריך לתת לקול שם.")
        if safe in BUILTIN_VOICES:
            raise CloningError(
                f"השם {safe!r} שייך לקול שבא עם המנוע. צריך שם אחר.")
        target = os.path.join(self.voices_dir, f"{safe}.json")
        if os.path.exists(target) and not overwrite:
            raise CloningError(f"כבר קיים קול בשם {safe!r}.")

        wav, source_rate = self.read_audio(audio_path)
        if not len(wav):
            raise CloningError("קובץ השמע ריק.")

        source_seconds = len(wav) / SAMPLE_RATE

        # בוחרים את הקטע לפני האבחון, כדי שהמדידות יתארו את מה
        # שבאמת נכנס ולא את כל הקובץ. בהקלטת שיעור של ארבעים דקות
        # המדידה על כל הקובץ חסרת משמעות.
        wav, window_start = self.pick_best_window(
            wav, seconds=MAX_SECONDS, start_seconds=start_seconds)

        warnings, stats = self.inspect(wav, source_rate)
        if source_seconds > MAX_SECONDS + 1 and start_seconds is None:
            warnings.insert(0, (
                f"הקובץ באורך {source_seconds / 60:.1f} דקות. נבחר ממנו "
                f"הקטע הרצוף ביותר של דיבור, מהשנייה {window_start:.0f}. "
                "אם רוצים קטע אחר אפשר לציין מאיפה להתחיל."
            ))

        z_ref = self.encode(wav)
        ttl, dp = self.style_from_latent(z_ref)

        problems = self._sanity_check(ttl, dp)
        if problems:
            raise CloningError(
                "הקול שיצא אינו שימושי: " + " ".join(problems))

        os.makedirs(self.voices_dir, exist_ok=True)
        payload = {
            "style_ttl": {"data": ttl.tolist(), "dims": list(ttl.shape)},
            "style_dp": {"data": dp.tolist(), "dims": list(dp.shape)},
            "source": os.path.basename(audio_path),
            "ref_frames": int(z_ref.shape[-1]),
            "cloned": True,
            "note": note,
            "source_rate": source_rate,
        }
        tmp = target + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        os.replace(tmp, target)

        return CloneReport(
            name=safe,
            seconds=len(wav) / SAMPLE_RATE,
            source_rate=source_rate,
            frames=int(z_ref.shape[-1]),
            rms=stats["rms"],
            peak=stats["peak"],
            silence_fraction=stats["silence"],
            high_freq_energy=stats["high"],
            source_seconds=source_seconds,
            window_start=window_start,
            warnings=warnings,
            path=target,
        )

    def delete_voice(self, name: str) -> bool:
        """מוחק קול משוכפל. קול שבא עם המנוע אינו נמחק."""
        safe = _safe_name(name)
        if safe in BUILTIN_VOICES:
            raise CloningError("אי אפשר למחוק קול שבא עם המנוע.")
        path = os.path.join(self.voices_dir, f"{safe}.json")
        if not os.path.exists(path):
            return False
        os.unlink(path)
        return True


def _safe_name(name: str) -> str:
    """שם קובץ בטוח, שעדיין קריא בעברית."""
    bad = '\\/:*?"<>|'
    cleaned = "".join("_" if c in bad else c for c in (name or "").strip())
    cleaned = cleaned.replace("..", "_").replace(" ", "_")
    return cleaned[:60]


_cloner: Optional[VoiceCloner] = None
_cloner_lock = threading.Lock()


def get_cloner() -> VoiceCloner:
    global _cloner
    with _cloner_lock:
        if _cloner is None:
            _cloner = VoiceCloner()
        return _cloner

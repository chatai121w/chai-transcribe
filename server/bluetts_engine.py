#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""מנוע ההקראה BlueTTS 2.5 — הפעלה מקומית.

המנוע מורכב מחמישה חלקים נפרדים שעובדים בשרשרת:

    duration_predictor_style   טקסט + סגנון  ->  כמה שניות ייקח להקריא
    text_encoder               צלילים + סגנון ->  ייצוג של הטקסט
    vector_estimator           רעש + הייצוג   ->  ייצוג הקול, בלופ של צעדים
    vocoder                    ייצוג הקול     ->  גלי קול בפועל
    reference_encoder          הקלטת ייחוס    ->  סגנון, לשכפול קול

ארבע מלכודות שכתובות במפורש בקובץ ההסבר של המנוע, וכל אחת מהן נראית
כמו הצלחה אם לא מטפלים בה:

 1. **סימן שאינו בטבלה נזרק בשקט.** המנוע אינו מתלונן. הוא פשוט מקריא
    מילה חסרה, והתוצאה נשמעת כמו שגיאת הקראה ולא כמו באג. לכן כאן
    הבדיקה חוסמת ומודיעה, במקום להמשיך.

 2. **מעריך הווקטור כבר מבצע את צעד האינטגרציה.** הוא מחזיר
    x + v/total_step ולא את v. הנחיית הקול דורשת לערבב מהירויות,
    ולכן חייבים לחלץ חזרה את v לפני הערבוב.

 3. **צירי הייצוג אינם זהים בין החלקים.** מעריך הווקטור עובד על 144
    ערוצים בקצב 14.36 פעמים בשנייה, וממיר הגלים רוצה 24 ערוצים בקצב
    שש פעמים גדול יותר. הקיפול ביניהם אינו שינוי צורה פשוט.

 4. **הפלט יכול לעבור את הטווח המותר.** נמדד עד 1.5. שמירה לקובץ
    בלי הגבלה חותכת את הפסגות בשקט, והתוצאה נשמעת מעוותת.
"""
from __future__ import annotations

import json
import os
import sys
import threading
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "bluetts25")

SAMPLE_RATE = 44100
HOP_LENGTH = 512
CHUNK_COMPRESS = 6
#: קצב הייצוג הפנימי, פעמים בשנייה. 44100 / 512 / 6
LATENT_RATE = SAMPLE_RATE / HOP_LENGTH / CHUNK_COMPRESS

DEFAULT_STEPS = 16
DEFAULT_CFG = 3.0

#: הגבול שמעליו הקול נחתך בשמירה לקובץ.
PEAK_TARGET = 0.97


class BlueTtsError(RuntimeError):
    """שגיאה שאפשר להציג למשתמש כמו שהיא."""


def _tensor(raw, label: str, expect: Optional[Tuple[int, ...]] = None) -> np.ndarray:
    """קורא מערך מקובץ הקול.

    קבצי הקול שומרים כל מערך כמילון עם ``data`` ו-``dims`` ולא כרשימה
    מקוננת פשוטה. קריאה ישירה מחזירה מילון ומפילה את ההמרה למספרים
    בהודעה שאינה מסבירה כלום.
    """
    if isinstance(raw, dict):
        if "data" not in raw:
            raise BlueTtsError(f"המערך {label} בקובץ הקול חסר את השדה data.")
        arr = np.asarray(raw["data"], dtype=np.float32)
        dims = raw.get("dims")
        if dims is not None:
            want = tuple(int(d) for d in np.asarray(dims).reshape(-1))
            if arr.size != int(np.prod(want)):
                raise BlueTtsError(
                    f"המערך {label} בקובץ הקול אינו בגודל שהוא מצהיר עליו: "
                    f"{arr.size} מספרים מול {want}."
                )
            arr = arr.reshape(want)
    else:
        arr = np.asarray(raw, dtype=np.float32)

    if expect is not None and arr.shape != expect:
        raise BlueTtsError(
            f"המערך {label} בקובץ הקול בצורה {arr.shape} ולא {expect} כצפוי."
        )
    return np.ascontiguousarray(arr, dtype=np.float32)


@dataclass
class UnknownSymbols:
    """סימנים שאינם בטבלה, עם המקום שבו הם הופיעו."""
    symbols: List[str]
    positions: List[int]

    def message(self) -> str:
        uniq = sorted(set(self.symbols))
        return (
            "בטקסט הצלילים יש סימנים שהמנוע אינו מכיר: "
            + " ".join(f"{s!r}" for s in uniq[:12])
            + (" ועוד" if len(uniq) > 12 else "")
            + ". המנוע זורק סימנים כאלה בשקט, ולכן ההקראה הייתה יוצאת "
            "חסרה בלי שום הודעה. צריך לתקן את המרת הצלילים."
        )


class BlueTts:
    """עוטף את חמשת החלקים ומחזיק אותם בזיכרון.

    הטעינה נעשית בפעם הראשונה שצריך, ולא בהפעלת השרת: ארבעה קבצים
    בסך כ-280 מגה, ואין טעם לשלם עליהם אם אף אחד לא מבקש הקראה.
    """

    def __init__(self, model_dir: str = MODEL_DIR, providers: Optional[List[str]] = None):
        self.model_dir = model_dir
        self._providers = providers
        self._lock = threading.Lock()
        self._loaded = False
        self._sessions: Dict[str, object] = {}
        self._vocab: Dict[str, int] = {}
        self._pad = 0
        self._bos = 1
        self._eos = 2
        self._mean: Optional[np.ndarray] = None
        self._std: Optional[np.ndarray] = None
        self._normalizer_scale = 0.25
        self._u_text: Optional[np.ndarray] = None
        self._u_ref: Optional[np.ndarray] = None
        self._voices: Dict[str, Dict[str, np.ndarray]] = {}
        #: שמות הקלט והפלט האמיתיים של כל גרף, כפי שהם בקובץ.
        self._io: Dict[str, Tuple[List[str], List[str]]] = {}

    # ------------------------------------------------------------------ טעינה

    def available(self) -> bool:
        """האם הקבצים קיימים על הכונן."""
        needed = [
            "text_encoder.onnx", "vector_estimator.onnx", "vocoder.onnx",
            "duration_predictor_style.onnx", "vocab.json", "stats.npz", "uncond.npz",
        ]
        return all(os.path.exists(os.path.join(self.model_dir, n)) for n in needed)

    def missing_files(self) -> List[str]:
        needed = [
            "text_encoder.onnx", "vector_estimator.onnx", "vocoder.onnx",
            "duration_predictor_style.onnx", "duration_predictor.onnx",
            "reference_encoder.onnx", "vocab.json", "stats.npz", "uncond.npz",
        ]
        return [n for n in needed if not os.path.exists(os.path.join(self.model_dir, n))]

    def load(self) -> None:
        with self._lock:
            if self._loaded:
                return
            if not self.available():
                raise BlueTtsError(
                    "מנוע ההקראה אינו מותקן. חסרים הקבצים: "
                    + ", ".join(self.missing_files())
                )
            try:
                import onnxruntime as ort
            except ImportError as exc:
                raise BlueTtsError("חסרה חבילת ההרצה של המנוע.") from exc

            self._add_gpu_dll_dirs()
            providers = self._providers or self._pick_providers(ort)
            opts = ort.SessionOptions()
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            # הודעות המערכת על חלקים שלא נתמכים בכרטיס המסך אינן שגיאות,
            # והן ממלאות את היומן ללא תועלת.
            opts.log_severity_level = 3

            for name in ("text_encoder", "vector_estimator", "vocoder",
                         "duration_predictor_style", "duration_predictor",
                         "reference_encoder"):
                path = os.path.join(self.model_dir, f"{name}.onnx")
                if not os.path.exists(path):
                    continue
                sess = ort.InferenceSession(path, sess_options=opts, providers=providers)
                self._sessions[name] = sess
                self._io[name] = (
                    [i.name for i in sess.get_inputs()],
                    [o.name for o in sess.get_outputs()],
                )

            raw = json.load(open(os.path.join(self.model_dir, "vocab.json"), encoding="utf-8"))
            self._vocab = raw["char_to_id"]
            self._pad = int(raw.get("pad_id", 0))
            self._bos = int(raw.get("bos_id", 1))
            self._eos = int(raw.get("eos_id", 2))

            stats = np.load(os.path.join(self.model_dir, "stats.npz"))
            self._mean = np.asarray(stats["mean"], dtype=np.float32)
            self._std = np.asarray(stats["std"], dtype=np.float32)
            if "normalizer_scale" in stats:
                self._normalizer_scale = float(np.asarray(stats["normalizer_scale"]).reshape(-1)[0])

            unc = np.load(os.path.join(self.model_dir, "uncond.npz"))
            self._u_text = np.asarray(unc["u_text"], dtype=np.float32)
            self._u_ref = np.asarray(unc["u_ref"], dtype=np.float32)

            self._loaded = True

    @staticmethod
    def _add_gpu_dll_dirs() -> List[str]:
        """מוסיף את נתיבי ספריות החישוב של כרטיס המסך.

        בלי זה מנוע ההרצה טוען את ספק כרטיס המסך, נכשל על
        cublasLt64_12.dll שאינה בנתיב החיפוש של חלונות, **וחוזר
        בשקט למעבד**. אין שגיאה, אין אזהרה — רק עבודה איטית פי
        כמה בלי שאף אחד יודע למה.

        הספריות אינן חסרות: הן יושבות בתוך חבילת החישוב הראשית.
        חלונות פשוט אינו מחפש שם.

        זאת בדיוק אותה תקלה שנתפסה בכלי המדידה, ומאותה סיבה: שם
        היא נראתה ככישלון גלוי, וכאן כנסיגה שקטה — וזה גרוע יותר.
        """
        if sys.platform != "win32":
            return []
        added: List[str] = []
        for pkg, sub in (("torch", "lib"), ("nvidia.cublas", "bin"),
                         ("nvidia.cudnn", "bin"), ("nvidia.cufft", "bin")):
            try:
                mod = __import__(pkg, fromlist=[""])
                d = os.path.join(mod.__path__[0], sub)
                if os.path.isdir(d):
                    os.add_dll_directory(d)
                    os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
                    added.append(d)
            except Exception:
                pass
        return added

    @staticmethod
    def _pick_providers(ort) -> List[str]:
        have = ort.get_available_providers()
        # כרטיס המסך מהיר בהרבה, אבל אם הוא אינו זמין אין טעם להיכשל.
        for wanted in ("CUDAExecutionProvider", "DmlExecutionProvider"):
            if wanted in have:
                return [wanted, "CPUExecutionProvider"]
        return ["CPUExecutionProvider"]

    def providers(self) -> List[str]:
        sess = self._sessions.get("text_encoder")
        return list(sess.get_providers()) if sess else []

    # ------------------------------------------------------------------ קולות

    def list_voices(self) -> List[str]:
        d = os.path.join(self.model_dir, "voices")
        if not os.path.isdir(d):
            return []
        return sorted(f[:-5] for f in os.listdir(d) if f.endswith(".json"))

    def load_voice(self, name: str) -> Dict[str, np.ndarray]:
        if name in self._voices:
            return self._voices[name]
        path = os.path.join(self.model_dir, "voices", f"{name}.json")
        if not os.path.exists(path):
            raise BlueTtsError(
                f"הקול {name!r} אינו קיים. הקולות הזמינים: "
                + ", ".join(self.list_voices())
            )
        raw = json.load(open(path, encoding="utf-8"))
        voice = {
            "style_ttl": _tensor(raw["style_ttl"], "style_ttl", (1, 50, 256)),
            "style_dp": _tensor(raw["style_dp"], "style_dp", (1, 8, 16)),
            "source": str(raw.get("source", "")),
            "ref_frames": raw.get("ref_frames"),
            # קול שנוצר משכפול מסומן, כדי שאפשר יהיה למחוק אותו ולא
            # לנסות למחוק קול שבא עם המנוע.
            "cloned": bool(raw.get("cloned")),
            "note": str(raw.get("note") or ""),
        }
        self._voices[name] = voice
        return voice

    def voice_info(self, name: str) -> Dict[str, object]:
        v = self.load_voice(name)
        return {
            "name": name,
            "source": v["source"],
            "ref_frames": v["ref_frames"],
            "cloned": v.get("cloned", False),
            "note": v.get("note", ""),
        }

    def forget_voice(self, name: str) -> None:
        """מוציא קול מהזיכרון.

        נחוץ אחרי שכפול או מחיקה: בלי זה הקול הישן נשאר בזיכרון
        וההקראה ממשיכה להשתמש בו, וזה נראה כאילו השכפול לא עבד.
        """
        self._voices.pop(name, None)

    # ------------------------------------------------------------------ צלילים

    def check_symbols(self, ipa: str) -> Optional[UnknownSymbols]:
        """מחזיר את הסימנים שאינם בטבלה, או None אם הכל תקין.

        זאת הבדיקה שמונעת את המלכודת הראשונה. בלעדיה סימן לא מוכר
        פשוט נעלם, וההקראה יוצאת עם מילה חסרה בלי הודעה.
        """
        bad, pos = [], []
        for i, ch in enumerate(ipa):
            if ch in (" ", "\n", "\t"):
                continue
            if ch not in self._vocab:
                bad.append(ch)
                pos.append(i)
        return UnknownSymbols(bad, pos) if bad else None

    def encode_text(self, ipa: str, strict: bool = True) -> np.ndarray:
        unknown = self.check_symbols(ipa)
        if unknown and strict:
            raise BlueTtsError(unknown.message())
        ids = [self._bos]
        for ch in ipa:
            got = self._vocab.get(ch)
            if got is not None:
                ids.append(int(got))
        ids.append(self._eos)
        return np.asarray([ids], dtype=np.int64)

    # ------------------------------------------------------------------ הקראה

    def _run(self, name: str, **inputs) -> List[np.ndarray]:
        """מפעיל חלק אחד, בדרישה ששמות הקלט יתאימו בדיוק.

        שמות הקלט של כל ששת הגרפים נבדקו מול הקבצים בפועל והם תואמים
        לתיעוד. לכן אין שום סיבה להתאים לפי סדר: התאמה כזאת מאכילה את
        המנוע בנתון הלא נכון ומחזירה קול, כלומר נכשלת בשקט. חוסר התאמה
        בשם הוא באג בקוד שלנו, ועדיף שהוא ייפול כאן.
        """
        sess = self._sessions.get(name)
        if sess is None:
            raise BlueTtsError(f"החלק {name} אינו נטען.")
        want, _ = self._io[name]
        missing = [k for k in want if k not in inputs]
        extra = [k for k in inputs if k not in want]
        if missing or extra:
            raise BlueTtsError(
                f"אי-התאמה בקלט של {name}. הגרף מבקש {want}; "
                f"חסר: {missing or 'כלום'}; מיותר: {extra or 'כלום'}."
            )
        return sess.run(None, {k: inputs[k] for k in want})

    def predict_duration(self, text_ids: np.ndarray, style_dp: np.ndarray) -> float:
        out = self._run(
            "duration_predictor_style",
            text_ids=text_ids,
            style_dp=style_dp,
            text_mask=np.ones((1, 1, text_ids.shape[1]), dtype=np.float32),
        )
        return float(np.asarray(out[0]).reshape(-1)[0])

    def synthesize(
        self,
        ipa: str,
        voice: str = "female",
        steps: int = DEFAULT_STEPS,
        cfg: float = DEFAULT_CFG,
        speed: float = 1.0,
        seed: Optional[int] = None,
        strict_symbols: bool = True,
    ) -> Tuple[np.ndarray, int]:
        """מקריא טקסט צלילים ומחזיר גלי קול ואת תדר הדגימה."""
        if not ipa or not ipa.strip():
            raise BlueTtsError("אין טקסט להקראה.")
        self.load()

        v = self.load_voice(voice)
        style_ttl, style_dp = v["style_ttl"], v["style_dp"]
        text_ids = self.encode_text(ipa, strict=strict_symbols)

        seconds = self.predict_duration(text_ids, style_dp)
        if speed and speed > 0:
            seconds = seconds / float(speed)
        n_lat = max(8, int(round(seconds * LATENT_RATE)))

        text_mask = np.ones((1, 1, text_ids.shape[1]), dtype=np.float32)
        lat_mask = np.ones((1, 1, n_lat), dtype=np.float32)

        text_emb = self._run(
            "text_encoder",
            text_ids=text_ids, style_ttl=style_ttl, text_mask=text_mask,
        )[0].astype(np.float32)

        # הייצוג חסר התנאי, לצורך הנחיית הקול. הוא נמתח לאורך הטקסט
        # הנוכחי, כי הוא נשמר כווקטור אחד ולא כרצף.
        u_text = self._broadcast_uncond(self._u_text, text_emb.shape)
        u_ref = self._u_ref if self._u_ref is not None else style_ttl
        if u_ref.shape != style_ttl.shape:
            u_ref = np.broadcast_to(u_ref.reshape(1, -1, u_ref.shape[-1]), style_ttl.shape)
            u_ref = np.ascontiguousarray(u_ref, dtype=np.float32)

        rng = np.random.default_rng(seed)
        x = rng.standard_normal((1, 144, n_lat)).astype(np.float32)

        total = self._step_array(steps, "total_step")
        use_cfg = bool(cfg) and abs(cfg - 1.0) > 1e-6

        for i in range(steps):
            cur = self._step_array(i, "current_step")
            out_c = self._run(
                "vector_estimator",
                noisy_latent=x, text_emb=text_emb, style_ttl=style_ttl,
                latent_mask=lat_mask, text_mask=text_mask,
                current_step=cur, total_step=total,
            )[0]
            if not use_cfg:
                x = np.ascontiguousarray(out_c, dtype=np.float32)
                continue
            # המנוע מחזיר את הצעד ולא את המהירות. ערבוב הנחיית הקול
            # חייב להיות על המהירות עצמה, ולכן מחלצים אותה חזרה.
            v_c = (out_c - x) * steps
            out_u = self._run(
                "vector_estimator",
                noisy_latent=x, text_emb=u_text, style_ttl=u_ref,
                latent_mask=lat_mask, text_mask=text_mask,
                current_step=cur, total_step=total,
            )[0]
            v_u = (out_u - x) * steps
            v_mix = v_u + cfg * (v_c - v_u)
            x = np.ascontiguousarray(x + v_mix / steps, dtype=np.float32)

        wav = self.decode_latent(x)
        return wav, SAMPLE_RATE

    def _step_array(self, value: int, which: str) -> np.ndarray:
        """בונה את מספר הצעד בטיפוס שהגרף באמת מבקש.

        הגרף עלול לבקש מספר שלם או מספר עשרוני. הזנה בטיפוס הלא נכון
        נכשלת בהודעה שאינה מסבירה מה הבעיה.
        """
        sess = self._sessions.get("vector_estimator")
        dtype = np.float32
        if sess is not None:
            for i in sess.get_inputs():
                if i.name == which:
                    dtype = np.int64 if "int" in str(i.type) else np.float32
                    break
        return np.asarray([value], dtype=dtype)

    def _broadcast_uncond(self, u: Optional[np.ndarray], shape: Tuple[int, ...]) -> np.ndarray:
        if u is None:
            return np.zeros(shape, dtype=np.float32)
        u = np.asarray(u, dtype=np.float32)
        if u.shape == shape:
            return u
        flat = u.reshape(-1)
        if flat.size == shape[1]:
            return np.ascontiguousarray(
                np.broadcast_to(flat.reshape(1, shape[1], 1), shape), dtype=np.float32)
        if u.ndim == 3 and u.shape[:2] == shape[:2]:
            return np.ascontiguousarray(
                np.broadcast_to(u[:, :, :1], shape), dtype=np.float32)
        return np.zeros(shape, dtype=np.float32)

    def decode_latent(self, x: np.ndarray) -> np.ndarray:
        """ממיר את הייצוג לגלי קול, כולל ביטול הנרמול והקיפול."""
        # הקבצים נשמרים כבר בצורה (1, 144, 1), ושינוי צורה נוסף כאן
        # היה משנה את משמעות הצירים.
        mean = self._mean if self._mean is not None else np.float32(0.0)
        std = self._std if self._std is not None else np.float32(1.0)
        z = (x / self._normalizer_scale) * std + mean

        # 144 ערוצים בקצב T הם למעשה 24 ערוצים בקצב 6T, אבל הסדר
        # הפנימי אינו רציף — ולכן זה אינו שינוי צורה פשוט.
        n = z.shape[-1]
        z = z.reshape(1, 24, CHUNK_COMPRESS, n).transpose(0, 1, 3, 2).reshape(1, 24, CHUNK_COMPRESS * n)
        z = np.ascontiguousarray(z, dtype=np.float32)

        name = self._io["vocoder"][0][0]
        wav = self._run("vocoder", **{name: z})[0]
        return self.limit_peak(np.asarray(wav, dtype=np.float32).reshape(-1))

    @staticmethod
    def limit_peak(wav: np.ndarray, target: float = PEAK_TARGET) -> np.ndarray:
        """מגביל את הפסגות.

        נמדדו פסגות עד 1.5 בקבצים האלה. שמירה לקובץ בלי הגבלה חותכת
        אותן בשקט, והתוצאה נשמעת מעוותת בלי שום הודעת שגיאה.
        """
        peak = float(np.max(np.abs(wav))) if wav.size else 0.0
        if peak > target:
            wav = wav * (target / peak)
        return wav


_engine: Optional[BlueTts] = None
_engine_lock = threading.Lock()


def get_engine() -> BlueTts:
    global _engine
    with _engine_lock:
        if _engine is None:
            _engine = BlueTts()
        return _engine

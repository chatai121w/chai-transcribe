"""
Server configuration constants and model registry.
Pure data — no dependencies on Flask, torch, or other modules.
"""

import os

# ═══════════════════════════════════════════════════════════════════
#  Model Registry
# ═══════════════════════════════════════════════════════════════════

MODEL_REGISTRY = {
    # Standard Whisper models
    "tiny": "tiny",
    "base": "base",
    "small": "small",
    "medium": "medium",
    "large-v2": "large-v2",
    "large-v3": "large-v3",
    "large-v3-turbo": "large-v3-turbo",
    # Distil-Whisper: faster, smaller, ~99% accuracy of large-v3
    "distil-large-v3": "deepdml/faster-whisper-large-v3-turbo-ct2",
    "distil-medium.en": "Systran/faster-distil-whisper-medium.en",
    "distil-small.en": "Systran/faster-distil-whisper-small.en",
    # ── Hebrew. Measured 24.10.2026 on 112 words of verified external Hebrew,
    #    then across three difficulty tiers. Correct words, higher is better:
    #
    #      whisper-large-v3-ct2 ......... 102/112   plain · 19/28 lecture · 6/35 LK
    #      whisper-large-v3-turbo-ct2 ....  99/112   plain · 16/28 lecture · 4/35 LK
    #      faster-whisper-v2-d4 .......... (removed)  90/112 — worst of all, oldest
    #      kabbalah fine-tune ............ (removed)  92/112, and lost on LK too
    #
    #    Only these two remain: the full model is the most accurate everywhere,
    #    the turbo one is a third of the memory for ~3 words. Anything added back
    #    here should beat 102/112 on the same clips first.
    "ivrit-ai/whisper-large-v3-turbo-ct2": "ivrit-ai/whisper-large-v3-turbo-ct2",
    "ivrit-ai/whisper-large-v3-ct2": "ivrit-ai/whisper-large-v3-ct2",
    # ── הוסר 24.10.2026 אחרי מדידה: הכיול הישיבתי של TorahAnytime.
    #    נמדד על אותה סדרה, אותן הגדרות, 336 מילות ייחוס:
    #
    #      קו בסיס (large-v3)   273/336 = 81.25%   רווח סמך 76.7–85.1
    #      כיול ישיבתי          251/336 = 74.70%   רווח סמך 69.8–79.1
    #
    #    נסיגה של 6.55 נקודות, מובהקת (הרגישות בגודל המדגם הזה 7.6 נקודות,
    #    וההפרש חורג מרווחי הסמך). ההמרה המקומית נשמרה ב-server/models אם
    #    ירצו לחזור ולבדוק, אבל אין להציע אותו למשתמש.
    #    יומן הניסוי: 20261023-171103.
    # ⚠️ YIDDISH models. The "yi-" prefix means Yiddish, NOT a newer Hebrew version.
    # Selecting one of these for Hebrew audio produces near-total garbage on its own.
    # Labels below deliberately lead with the language so they cannot be mistaken for
    # a "more accurate Hebrew" option in the model picker.
    # ── הוסרו 24.10.2026 אחרי מדידה: דגמי היידיש של ivrit-ai.
    #    ההשערה הייתה שהם יעזרו להגייה אשכנזית, כי יידיש קרובה אליה פונטית
    #    ושומרת מילים ממקור עברי בכתיב המסורתי. המדידה הפריכה זאת:
    #
    #      קטע            עברי מלא      יידיש/עברית   יידיש/יידיש
    #      00019          6/35 (17%)    1/35 ( 3%)    3/35 ( 9%)
    #      00013          5/9  (56%)    1/9  (11%)    1/9  (11%)
    #
    #    הדגם אינו רק כותב בכתיב יידי — הוא מחליף מילים עבריות במילים יידיות
    #    ("נסתא ווען עלו, דארטעט א בן") ונכנס ללולאות חזרה. פי 3 עד פי 5 גרוע
    #    יותר מהבסיס, בשתי הגדרות השפה. אין להחזיר בלי מדידה חדשה.
}

# Measured 24.10.2026: the full model gets 102/112 words right on plain Hebrew
# against 99/112 for turbo, and leads on Torah lecture (19/28 vs 16/28) and on
# Loshon Kodesh (6/35 vs 4/35) too. It needs ~5.9 GB against ~2.1 GB, which fits
# this machine's 7.93 GB as long as nothing else is holding GPU memory. Switch
# back to the turbo one if memory pressure becomes a problem in practice.
DEFAULT_MODEL = "ivrit-ai/whisper-large-v3-ct2"

# Models that need HF→CT2 conversion (not available as pre-converted on HF Hub)
MODELS_NEEDING_CONVERSION = {
    "ivrit-ai/whisper-large-v3-turbo",
}

# ═══════════════════════════════════════════════════════════════════
#  Transcription Presets
# ═══════════════════════════════════════════════════════════════════

TRANSCRIPTION_PRESETS = {
    "fast": {
        "label": "מהיר",
        "label_en": "Fast",
        "description": "מהירות מקסימלית — עיבוד מקבילי, beam=1, דילוג שקט אגרסיבי",
        "fast_mode": True,
        "beam_size": 1,
        "batch_size": 24,
        "condition_on_previous_text": False,
        "vad_aggressive": True,
        "compute_type": "int8_float16",
    },
    "balanced": {
        "label": "מאוזן",
        "label_en": "Balanced",
        "description": "איזון טוב בין מהירות לדיוק — ברירת מחדל מומלצת",
        "fast_mode": True,
        "beam_size": 3,         # was 1 — beam=3 improves Hebrew WER significantly
        "batch_size": 16,
        # Disabled 2026-10-23. Was True. Carrying the previous segment's text forward
        # lets a single bad segment contaminate every segment after it, which drives
        # Whisper into a repetition loop — the measured 137% WER run with repeated
        # output. The ivrit-ai large-v3-turbo model card also advises against it.
        "condition_on_previous_text": False,
        "vad_aggressive": False,
        "compute_type": "int8_float16",
    },
    "accurate": {
        "label": "מדויק",
        "label_en": "Accurate",
        "description": "דיוק מקסימלי — עיבוד סדרתי, beam=5",
        "fast_mode": False,
        "beam_size": 5,
        "batch_size": 8,
        # Disabled 2026-10-23 for the same reason as "balanced" above.
        "condition_on_previous_text": False,
        "vad_aggressive": False,
        "compute_type": "float16",
    },
}

DEFAULT_PRESET = "balanced"

# ═══════════════════════════════════════════════════════════════════
#  Upload / Server Limits
# ═══════════════════════════════════════════════════════════════════

MAX_UPLOAD_SIZE_MB = 500
WAITRESS_CHANNEL_TIMEOUT = 600
WAITRESS_RECV_BYTES = 524288

# Model eviction
MODEL_TTL_SECONDS = 30 * 60  # 30 minutes — evict unused models to free VRAM

# Staged audio files TTL
STAGE_TTL_SECONDS = 5 * 60  # 5 minutes — auto-cleanup staged files

# Allowed audio/video file extensions for upload
ALLOWED_SUFFIXES = frozenset({
    ".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".wma", ".opus", ".webm",
    ".mp4", ".avi", ".mov", ".mkv", ".ts", ".mts", ".3gp",
})

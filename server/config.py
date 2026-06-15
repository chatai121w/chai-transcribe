"""
Server configuration constants and model registry.
Pure data — no dependencies on Flask, torch, or other modules.
"""

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
    # Ivrit.ai Hebrew-optimized models (pre-converted CT2 format on HuggingFace)
    "ivrit-ai/faster-whisper-v2-d4": "ivrit-ai/faster-whisper-v2-d4",
    "ivrit-ai/whisper-large-v3-ct2": "ivrit-ai/whisper-large-v3-ct2",
    # ivrit-ai/whisper-large-v3-turbo — requires local HF→CT2 conversion
    # Yiddish-optimized (ivrit-ai fine-tune) — pre-converted CT2, ready for faster-whisper
    "ivrit-ai/yi-whisper-large-v3-turbo-ct2": "ivrit-ai/yi-whisper-large-v3-turbo-ct2",  # יידיש turbo (מהיר)
    "ivrit-ai/yi-whisper-large-v3-ct2": "ivrit-ai/yi-whisper-large-v3-ct2",              # יידיש מלא (מדויק)
    # ivrit-ai/yi-whisper-large-v3-turbo — non-CT2, requires local HF→CT2 conversion
    "ivrit-ai/yi-whisper-large-v3-turbo": "ivrit-ai/yi-whisper-large-v3-turbo",
}

DEFAULT_MODEL = "ivrit-ai/whisper-large-v3-turbo-ct2"  # matches transcribe_server.py default

# Models that need HF→CT2 conversion (not available as pre-converted on HF Hub)
MODELS_NEEDING_CONVERSION = {
    "ivrit-ai/whisper-large-v3-turbo",
    "ivrit-ai/yi-whisper-large-v3-turbo",
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
        "condition_on_previous_text": True,  # was False — context between segments helps Hebrew
        "vad_aggressive": False,
        "compute_type": "int8_float16",
    },
    "accurate": {
        "label": "מדויק",
        "label_en": "Accurate",
        "description": "דיוק מקסימלי — עיבוד סדרתי, beam=5, הקשר טקסט מלא",
        "fast_mode": False,
        "beam_size": 5,
        "batch_size": 8,
        "condition_on_previous_text": True,
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

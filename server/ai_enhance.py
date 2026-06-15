"""
AI-powered Audio Enhancement Engine
====================================
Provides neural noise reduction and speech enhancement for the transcription server.
Uses SpeechBrain MetricGAN-U (GPU-accelerated) and noisereduce (CPU spectral gating)
to deliver significantly better results than FFmpeg's afftdn, especially for Hebrew speech.

Available engines:
  - metricgan: SpeechBrain MetricGAN-U — deep learning speech enhancement (GPU)
  - spectral:  noisereduce spectral gating — fast statistical noise reduction (CPU)

Each engine exposes a simple function: enhance(input_path, output_path) -> bool
"""

import os
import logging
import shutil
import sys
import tempfile
import time
import types
from pathlib import Path

import numpy as np

# ── Windows symlink workaround ──────────────────────────────────────
# SpeechBrain defaults to LocalStrategy.SYMLINK when fetching HF models.
# On Windows this fails with WinError 1314 unless Developer Mode is on.
# Monkey-patch os.symlink to fall back to shutil.copy2 on failure.
if os.name == "nt":
    _orig_symlink = os.symlink

    def _safe_symlink(src, dst, target_is_directory=False, *, dir_fd=None):
        try:
            _orig_symlink(src, dst, target_is_directory, dir_fd=dir_fd)
        except OSError:
            shutil.copy2(str(src), str(dst))

    os.symlink = _safe_symlink

# ── SpeechBrain 1.1.x lazy-import bug workaround ────────────
# inspect.getmodule() accidentally triggers speechbrain's lazy import of
# k2_fsa via hasattr(module, '__file__'), which crashes if k2 isn't installed.
# Providing a stub k2 module prevents the ImportError.
if "k2" not in sys.modules:
    sys.modules["k2"] = types.ModuleType("k2")


def _neutralize_speechbrain_lazy_modules():
    """Replace all SpeechBrain lazy/deprecated stubs in sys.modules with real modules.

    SpeechBrain 1.1.x registers DeprecatedModuleRedirect and LazyModule objects
    in sys.modules for deprecated and optional sub-packages.  Python's
    inspect.getmodule() walks sys.modules and calls hasattr(mod, '__file__')
    which triggers lazy loading, crashing if optional deps aren't installed.

    This function must be called AFTER 'import speechbrain' so that all stubs
    are already registered, then replaces them with harmless empty modules.
    """
    dangerous_classes = {"DeprecatedModuleRedirect", "LazyModule", "_LazyModule", "LazyModuleMixin"}
    to_replace = []
    for name, mod in list(sys.modules.items()):
        if not name.startswith("speechbrain"):
            continue
        cls = type(mod).__name__
        if cls in dangerous_classes:
            to_replace.append(name)
    for name in to_replace:
        stub = types.ModuleType(name)
        stub.__file__ = f"<speechbrain-stub:{name}>"
        stub.__path__ = []
        stub.__package__ = name.rsplit(".", 1)[0] if "." in name else name
        sys.modules[name] = stub
    if to_replace:
        _log.info(f"[ai_enhance] Neutralized {len(to_replace)} SpeechBrain lazy stubs: {to_replace}")

_log = logging.getLogger("ai_enhance")

# ────────────────────────────────────────────────────────────────────
#  Lazy-loaded singletons
# ────────────────────────────────────────────────────────────────────
_metricgan_model = None
_metricgan_lock = None          # threading.Lock – created on first use

_SAMPLE_RATE_METRICGAN = 16_000  # MetricGAN-U operates at 16 kHz


def _get_lock():
    global _metricgan_lock
    if _metricgan_lock is None:
        import threading
        _metricgan_lock = threading.Lock()
    return _metricgan_lock


def _load_metricgan():
    """Lazy-load the SpeechBrain MetricGAN-U model (downloads on first call)."""
    global _metricgan_model
    if _metricgan_model is not None:
        return _metricgan_model

    with _get_lock():
        if _metricgan_model is not None:
            return _metricgan_model

        _log.info("[ai_enhance] Loading SpeechBrain MetricGAN-U model (first time may download ~100 MB)...")
        t0 = time.time()

        import torch
        # Pre-import submodules to prevent SpeechBrain 1.1.x lazy-import bug:
        # inspect.getmodule() walks sys.modules and accidentally triggers
        # unrelated lazy imports whose optional dependencies are missing.
        import speechbrain.nnet.RNN           # noqa: F401
        import speechbrain.nnet.linear        # noqa: F401
        import speechbrain.nnet.containers    # noqa: F401
        import speechbrain.lobes.models.MetricGAN  # noqa: F401
        from speechbrain.inference import SpectralMaskEnhancement

        # Neutralize lazy stubs BEFORE from_hparams (which calls inspect)
        _neutralize_speechbrain_lazy_modules()

        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = SpectralMaskEnhancement.from_hparams(
            source="speechbrain/metricgan-plus-voicebank",
            savedir=str(Path(__file__).parent / "models" / "metricgan"),
            run_opts={"device": device},
        )

        # Neutralize AGAIN — from_hparams may register new lazy stubs
        _neutralize_speechbrain_lazy_modules()
        _metricgan_model = model
        _log.info(f"[ai_enhance] MetricGAN-U loaded on {device} in {time.time() - t0:.1f}s")
        return model


def _read_audio(path: str, target_sr: int = None):
    """Read audio file, resample if needed. Returns (numpy_array, sample_rate)."""
    import soundfile as sf

    data, sr = sf.read(path, dtype="float32")

    # Mono
    if data.ndim > 1:
        data = data.mean(axis=1)

    # Resample if target_sr specified and different
    if target_sr and sr != target_sr:
        from scipy.signal import resample_poly
        from math import gcd
        g = gcd(sr, target_sr)
        data = resample_poly(data, target_sr // g, sr // g).astype(np.float32)
        sr = target_sr

    return data, sr


def _write_audio(path: str, data: np.ndarray, sr: int):
    """Write audio to WAV file."""
    import soundfile as sf
    sf.write(path, data, sr, subtype="FLOAT")


def _convert_to_wav(input_path: str) -> str:
    """Convert any audio format to 16-bit WAV using FFmpeg. Returns path to temp WAV."""
    import subprocess
    wav_path = input_path + ".ai_input.wav"
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-vn", "-acodec", "pcm_s16le",
         "-ar", "16000", "-ac", "1", wav_path],
        capture_output=True, timeout=120,
    )
    if result.returncode != 0 or not os.path.exists(wav_path):
        raise RuntimeError(f"FFmpeg conversion failed: {result.stderr.decode('utf-8', errors='replace')[-500:]}")
    return wav_path


def _encode_output(wav_path: str, output_path: str, output_format_args: list):
    """Encode WAV back to target format using FFmpeg."""
    import subprocess
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", wav_path, "-vn", *output_format_args, output_path],
        capture_output=True, timeout=120,
    )
    if result.returncode != 0 or not os.path.exists(output_path):
        raise RuntimeError(f"FFmpeg encode failed: {result.stderr.decode('utf-8', errors='replace')[-500:]}")


# ────────────────────────────────────────────────────────────────────
#  Engine: MetricGAN-U (SpeechBrain) — GPU deep learning enhancement
# ────────────────────────────────────────────────────────────────────

def enhance_metricgan(input_path: str, output_wav_path: str) -> bool:
    """Enhance audio using MetricGAN-U (16kHz, mono).

    This model is trained on VoiceBank-DEMAND and learns a spectral mask
    that maximally improves PESQ scores. It excels at:
    - Stationary noise (AC, fans, hum)
    - Non-stationary noise (street, babble)
    - Preserving speech formants critical for Hebrew consonants (ח,כ,שׂ,שׁ)

    Args:
        input_path: Path to input audio file (any format FFmpeg supports)
        output_wav_path: Path to write enhanced 16kHz mono WAV

    Returns:
        True on success
    """
    model = _load_metricgan()

    import torch

    # Load and prepare audio
    wav_tmp = _convert_to_wav(input_path)
    try:
        # Bypass model.load_audio() which uses speechbrain.fetch() —
        # that function incorrectly joins source='./' with absolute Windows
        # paths, producing invalid double-rooted paths like C:\cwd\C:\temp\...
        # Instead, load directly with soundfile and apply the model's normalizer.
        import soundfile as sf
        data, sr = sf.read(wav_tmp, dtype="float32")
        signal = torch.from_numpy(data).unsqueeze(-1).to(model.device)  # (samples, 1)
        noisy = model.audio_normalizer(signal, sr)
        noisy = noisy.unsqueeze(0)  # Add batch dimension

        # Enhance
        with torch.no_grad():
            enhanced = model.enhance_batch(noisy, lengths=torch.tensor([1.0]))

        # Save
        enhanced_np = enhanced.squeeze().cpu().numpy()

        # Normalize to prevent clipping
        peak = np.abs(enhanced_np).max()
        if peak > 0.95:
            enhanced_np = enhanced_np * (0.95 / peak)

        _write_audio(output_wav_path, enhanced_np, _SAMPLE_RATE_METRICGAN)
        return True
    finally:
        try:
            os.unlink(wav_tmp)
        except OSError:
            pass


# ────────────────────────────────────────────────────────────────────
#  Engine: Spectral Gating (noisereduce) — fast CPU-based
# ────────────────────────────────────────────────────────────────────

def enhance_spectral(input_path: str, output_wav_path: str,
                     prop_decrease: float = 0.85,
                     stationary: bool = False) -> bool:
    """Enhance audio using spectral gating noise reduction.

    Uses noisereduce library with adaptive noise profile estimation.
    Works at any sample rate, preserves original quality.

    For Hebrew speech:
    - stationary=False uses non-stationary reduction (better for varied noise)
    - prop_decrease=0.85 removes most noise while preserving fricatives

    Args:
        input_path: Path to input audio
        output_wav_path: Path to write enhanced WAV
        prop_decrease: Noise reduction strength (0.0-1.0, default 0.85)
        stationary: If True, use stationary noise model (faster, less adaptive)

    Returns:
        True on success
    """
    import noisereduce as nr

    wav_tmp = _convert_to_wav(input_path)
    try:
        data, sr = _read_audio(wav_tmp)

        enhanced = nr.reduce_noise(
            y=data,
            sr=sr,
            prop_decrease=prop_decrease,
            stationary=stationary,
            n_fft=2048,
            hop_length=512,
        )

        # Normalize
        peak = np.abs(enhanced).max()
        if peak > 0.95:
            enhanced = enhanced * (0.95 / peak)

        _write_audio(output_wav_path, enhanced, sr)
        return True
    finally:
        try:
            os.unlink(wav_tmp)
        except OSError:
            pass


# ────────────────────────────────────────────────────────────────────
#  Combined pipeline: spectral + MetricGAN-U for maximum quality
# ────────────────────────────────────────────────────────────────────

def enhance_full_pipeline(input_path: str, output_wav_path: str) -> bool:
    """Two-stage enhancement: spectral gating → MetricGAN-U.

    Stage 1: Spectral gating removes broadband noise (CPU, fast)
    Stage 2: MetricGAN-U polishes residual noise and restores speech quality (GPU)

    This combination avoids MetricGAN-U spending capacity on obvious noise,
    letting it focus on subtle artifacts and speech restoration.

    Returns:
        True on success
    """
    stage1_path = output_wav_path + ".stage1.wav"
    try:
        # Stage 1: Spectral gating (moderate, preserve detail for MetricGAN)
        enhance_spectral(input_path, stage1_path, prop_decrease=0.65, stationary=False)

        # Stage 2: MetricGAN-U polish
        enhance_metricgan(stage1_path, output_wav_path)

        return True
    finally:
        try:
            os.unlink(stage1_path)
        except OSError:
            pass


# ────────────────────────────────────────────────────────────────────
#  Hebrew-optimized preset: tuned for Hebrew speech characteristics
# ────────────────────────────────────────────────────────────────────

def enhance_hebrew_speech(input_path: str, output_wav_path: str) -> bool:
    """Hebrew-optimized enhancement pipeline.

    Hebrew has specific phonetic characteristics that require careful handling:
    - Fricatives (כ/ח/שׁ/שׂ) occupy 2-8 kHz — aggressive denoising can destroy them
    - Guttural stops (ע/ק) have low-frequency energy that overlaps with noise
    - Rapid consonant clusters need temporal preservation

    Strategy:
    1. Light spectral gating (prop_decrease=0.55) preserves consonant detail
    2. MetricGAN-U handles the remaining noise while boosting speech clarity
    3. Post-processing: gentle high-frequency preservation via FFmpeg EQ

    Returns:
        True on success
    """
    stage1_path = output_wav_path + ".heb_stage1.wav"
    stage2_path = output_wav_path + ".heb_stage2.wav"
    try:
        # Stage 1: Gentle spectral gating — preserve Hebrew fricatives
        enhance_spectral(input_path, stage1_path, prop_decrease=0.55, stationary=False)

        # Stage 2: MetricGAN-U neural enhancement
        enhance_metricgan(stage1_path, stage2_path)

        # Stage 3: Post-EQ — restore high-freq clarity for fricatives
        import subprocess
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", stage2_path, "-vn",
             "-af", "equalizer=f=3500:t=q:w=1.5:g=2,equalizer=f=6000:t=q:w=2.0:g=1.5,loudnorm=I=-16:TP=-1.5:LRA=11",
             "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
             output_wav_path],
            capture_output=True, timeout=120,
        )
        if result.returncode != 0:
            # Fallback: use stage2 output without EQ
            import shutil
            shutil.copy2(stage2_path, output_wav_path)

        return True
    finally:
        for p in (stage1_path, stage2_path):
            try:
                os.unlink(p)
            except OSError:
                pass


# ────────────────────────────────────────────────────────────────────
#  Preset dispatcher
# ────────────────────────────────────────────────────────────────────

AI_ENHANCE_PRESETS = {
    "ai_denoise":  {
        "func": enhance_spectral,
        "label": "AI ניקוי רעש",
        "description": "ניקוי רעשי רקע חכם (מהיר, CPU)",
    },
    "ai_enhance": {
        "func": enhance_metricgan,
        "label": "AI שיפור דיבור",
        "description": "שיפור עמוק עם MetricGAN-U (GPU)",
    },
    "ai_full": {
        "func": enhance_full_pipeline,
        "label": "AI שיפור מלא",
        "description": "ניקוי + שיפור דו-שלבי (GPU)",
    },
    "ai_hebrew": {
        "func": enhance_hebrew_speech,
        "label": "AI עברית",
        "description": "מותאם לדיבור עברי — שומר על עיצורים חיכוכיים",
    },
}


def run_ai_enhance(preset: str, input_path: str, output_wav_path: str) -> bool:
    """Run an AI enhancement preset.

    Args:
        preset: One of the AI_ENHANCE_PRESETS keys
        input_path: Input audio file path
        output_wav_path: Output WAV path

    Returns:
        True on success

    Raises:
        ValueError: Unknown preset
        RuntimeError: Enhancement failed
    """
    info = AI_ENHANCE_PRESETS.get(preset)
    if not info:
        raise ValueError(f"Unknown AI preset: {preset}. Available: {list(AI_ENHANCE_PRESETS.keys())}")

    _log.info(f"[ai_enhance] Running {preset} on {Path(input_path).name}")
    t0 = time.time()

    success = info["func"](input_path, output_wav_path)

    _log.info(f"[ai_enhance] {preset} completed in {time.time() - t0:.1f}s")
    return success


def get_ai_presets_info() -> list:
    """Return info about available AI presets (for API responses)."""
    return [
        {
            "id": k,
            "label": v["label"],
            "description": v["description"],
            "ai": True,
        }
        for k, v in AI_ENHANCE_PRESETS.items()
    ]


def is_available() -> dict:
    """Check which AI engines are available."""
    result = {"spectral": False, "metricgan": False}

    try:
        import noisereduce
        result["spectral"] = True
    except ImportError:
        pass

    try:
        import speechbrain
        import torch
        result["metricgan"] = True
        result["gpu"] = torch.cuda.is_available()
        if result["gpu"]:
            result["gpu_name"] = torch.cuda.get_device_name(0)
    except ImportError:
        pass

    return result

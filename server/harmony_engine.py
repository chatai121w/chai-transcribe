"""
Harmony Engine — Server-side pitch shifting & harmony generation.

Three quality tiers:
  - "basic"   : stftPitchShift (fast, formant preservation via cepstral liftering)
  - "pro"     : WORLD vocoder (high quality, natural formant preservation)
  - "studio"  : Demucs vocal separation → WORLD vocoder → remix

All functions operate on numpy arrays (float64, mono, any sample rate).
"""

import io
import numpy as np
import soundfile as sf
import librosa

# ── Scale / pitch helpers ─────────────────────────────────────────

ROOT_INDEX = {
    "C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
    "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11,
}

SCALE_INTERVALS = {
    "chromatic":      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    "major":          [0, 2, 4, 5, 7, 9, 11],
    "minor":          [0, 2, 3, 5, 7, 8, 10],
    "dorian":         [0, 2, 3, 5, 7, 9, 10],
    "mixolydian":     [0, 2, 4, 5, 7, 9, 10],
    "harmonic-minor": [0, 2, 3, 5, 7, 8, 11],
}


def snap_semitones(semitones: float, scale: str, root: str) -> int:
    """Snap a semitone offset to the nearest note in the given scale."""
    if scale == "chromatic":
        return round(semitones)
    intervals = SCALE_INTERVALS.get(scale, SCALE_INTERVALS["chromatic"])
    root_offset = ROOT_INDEX.get(root, 0)
    target = round(semitones)
    pc = ((target - root_offset) % 12 + 12) % 12
    best_interval = intervals[0]
    best_dist = 12
    for interval in intervals:
        up = ((interval - pc) % 12 + 12) % 12
        down = ((pc - interval) % 12 + 12) % 12
        dist = min(up, down)
        if dist < best_dist:
            best_dist = dist
            best_interval = interval
    up = ((best_interval - pc) + 12) % 12
    down = ((pc - best_interval) + 12) % 12
    delta = up if up <= down else -down
    return target + delta


# ── Audio I/O ─────────────────────────────────────────────────────

def load_audio(file_bytes: bytes, sr: int = 44100, max_duration: float | None = None) -> tuple[np.ndarray, int]:
    """Load audio bytes into mono float64 numpy array."""
    audio, orig_sr = sf.read(io.BytesIO(file_bytes), dtype="float64", always_2d=False)
    # Convert to mono
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    # Resample if needed
    if orig_sr != sr:
        audio = librosa.resample(audio, orig_sr=orig_sr, target_sr=sr)
    # Trim duration
    if max_duration and max_duration > 0:
        max_samples = int(sr * max_duration)
        if len(audio) > max_samples:
            audio = audio[:max_samples]
    return audio, sr


def audio_to_wav_bytes(audio: np.ndarray, sr: int) -> bytes:
    """Encode numpy array to WAV bytes."""
    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return buf.read()


# ── Tier 1: Basic (stftPitchShift) ───────────────────────────────

def render_basic(audio: np.ndarray, sr: int, voices: list[dict],
                 dry_gain: float, wet_gain: float,
                 scale: str, root: str) -> np.ndarray:
    """
    Fast pitch shifting using STFT phase vocoder with formant preservation.
    """
    from stftpitchshift import StftPitchShift

    frame_size = 4096
    hop_size = frame_size // 4
    shifter = StftPitchShift(frame_size, hop_size, sr)

    # Start with dry signal
    mix = audio.copy() * dry_gain

    for voice in voices:
        semitones = snap_semitones(voice["semitones"], scale, root)
        gain = voice.get("gain", 0.7) * wet_gain
        if semitones == 0:
            mix += audio * gain
            continue
        factor = 2.0 ** (semitones / 12.0)
        # Use quefrency for formant preservation (1ms works well for most voices)
        shifted = shifter.shiftpitch(audio, factor, quefrency=0.001)
        mix += shifted * gain

    # Normalize to avoid clipping
    peak = np.max(np.abs(mix))
    if peak > 0.99:
        mix = mix * (0.99 / peak)
    return mix


# ── Tier 2: Pro (WORLD Vocoder) ──────────────────────────────────

def render_pro(audio: np.ndarray, sr: int, voices: list[dict],
               dry_gain: float, wet_gain: float,
               scale: str, root: str) -> np.ndarray:
    """
    High-quality pitch shifting using WORLD vocoder.
    Formants are preserved naturally because we only modify F0
    while keeping the spectral envelope (SP) and aperiodicity (AP) intact.
    """
    import pyworld as pw

    # WORLD requires float64
    audio_f64 = audio.astype(np.float64)

    # Analysis: extract F0, spectral envelope, aperiodicity
    f0, t = pw.dio(audio_f64, sr)
    f0 = pw.stonemask(audio_f64, f0, t, sr)
    sp = pw.cheaptrick(audio_f64, f0, t, sr)
    ap = pw.d4c(audio_f64, f0, t, sr)

    # Start with dry signal
    mix = audio.copy() * dry_gain

    for voice in voices:
        semitones = snap_semitones(voice["semitones"], scale, root)
        gain = voice.get("gain", 0.7) * wet_gain
        if semitones == 0:
            mix += audio * gain
            continue
        # Shift only F0 — SP and AP stay the same = formant preservation!
        factor = 2.0 ** (semitones / 12.0)
        f0_shifted = f0.copy()
        voiced_mask = f0_shifted > 0
        f0_shifted[voiced_mask] *= factor
        # Synthesize with shifted F0 but original spectral envelope
        shifted = pw.synthesize(f0_shifted, sp, ap, sr)
        # Match length
        min_len = min(len(mix), len(shifted))
        mix[:min_len] += shifted[:min_len] * gain

    # Normalize
    peak = np.max(np.abs(mix))
    if peak > 0.99:
        mix = mix * (0.99 / peak)
    return mix


# ── Tier 3: Studio (Demucs + WORLD) ──────────────────────────────

_demucs_available = None


def _check_demucs():
    global _demucs_available
    if _demucs_available is not None:
        return _demucs_available
    try:
        import demucs.api
        _demucs_available = True
    except ImportError:
        try:
            import demucs.separate
            _demucs_available = True
        except ImportError:
            _demucs_available = False
    return _demucs_available


def _separate_vocals(audio: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """
    Separate vocals from accompaniment using Demucs.
    Returns (vocals, accompaniment) as float64 arrays.
    """
    import tempfile
    import os
    import torch

    # Write to temp wav
    tmp_path = os.path.join(tempfile.gettempdir(), "_harmony_demucs_input.wav")
    sf.write(tmp_path, audio, sr, format="WAV")

    try:
        # Use the direct Demucs model API — avoids torchaudio.save() / torchcodec issues
        from demucs.pretrained import get_model
        from demucs.apply import apply_model

        model = get_model("htdemucs")
        model.eval()
        if torch.cuda.is_available():
            model.cuda()

        # Load audio as tensor: (channels, samples)
        audio_data, file_sr = sf.read(tmp_path, dtype="float32")
        if audio_data.ndim == 1:
            audio_data = audio_data[np.newaxis, :]  # mono → (1, samples)
        else:
            audio_data = audio_data.T  # (samples, channels) → (channels, samples)

        wav_tensor = torch.tensor(audio_data, dtype=torch.float32)

        # Resample to model's sample rate if needed
        if file_sr != model.samplerate:
            import torchaudio
            wav_tensor = torchaudio.functional.resample(wav_tensor, file_sr, model.samplerate)

        # Ensure stereo (Demucs expects 2 channels)
        if wav_tensor.shape[0] == 1:
            wav_tensor = wav_tensor.repeat(2, 1)

        # Add batch dimension: (1, channels, samples)
        ref = wav_tensor.unsqueeze(0)
        if torch.cuda.is_available():
            ref = ref.cuda()

        # Apply model — returns (1, num_sources, channels, samples)
        with torch.no_grad():
            sources = apply_model(model, ref, segment=7, overlap=0.25)

        # Find vocals index
        sources = sources.squeeze(0).cpu().numpy()  # (num_sources, channels, samples)
        vocal_idx = model.sources.index("vocals")

        vocals = sources[vocal_idx].mean(axis=0)  # stereo → mono

        # Sum everything except vocals for accompaniment
        accompaniment = np.zeros_like(vocals)
        for i, name in enumerate(model.sources):
            if name != "vocals":
                accompaniment += sources[i].mean(axis=0)

        # Resample back to original sr if needed
        if file_sr != model.samplerate:
            from scipy.signal import resample as sci_resample
            target_len = int(len(vocals) * file_sr / model.samplerate)
            vocals = sci_resample(vocals, target_len)
            accompaniment = sci_resample(accompaniment, target_len)

        return vocals.astype(np.float64), accompaniment.astype(np.float64)
    finally:
        # Cleanup
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def render_studio(audio: np.ndarray, sr: int, voices: list[dict],
                  dry_gain: float, wet_gain: float,
                  scale: str, root: str) -> np.ndarray:
    """
    Studio-quality: Demucs source separation → WORLD pitch shifting → remix.
    Harmonies are applied only to isolated vocals, then remixed with accompaniment.
    """
    import pyworld as pw

    # Step 1: Separate vocals from accompaniment
    vocals, accompaniment = _separate_vocals(audio, sr)

    # Step 2: WORLD analysis on isolated vocals
    vocals_f64 = vocals.astype(np.float64)
    f0, t = pw.dio(vocals_f64, sr)
    f0 = pw.stonemask(vocals_f64, f0, t, sr)
    sp = pw.cheaptrick(vocals_f64, f0, t, sr)
    ap = pw.d4c(vocals_f64, f0, t, sr)

    # Step 3: Generate harmony voices from vocals
    vocal_mix = vocals.copy() * dry_gain

    for voice in voices:
        semitones = snap_semitones(voice["semitones"], scale, root)
        gain = voice.get("gain", 0.7) * wet_gain
        if semitones == 0:
            vocal_mix += vocals * gain
            continue
        factor = 2.0 ** (semitones / 12.0)
        f0_shifted = f0.copy()
        voiced_mask = f0_shifted > 0
        f0_shifted[voiced_mask] *= factor
        shifted = pw.synthesize(f0_shifted, sp, ap, sr)
        min_len = min(len(vocal_mix), len(shifted))
        vocal_mix[:min_len] += shifted[:min_len] * gain

    # Step 4: Remix — harmonized vocals + original accompaniment
    min_len = min(len(vocal_mix), len(accompaniment))
    mix = np.zeros(max(len(vocal_mix), len(accompaniment)))
    mix[:len(vocal_mix)] += vocal_mix
    mix[:len(accompaniment)] += accompaniment * dry_gain

    # Normalize
    peak = np.max(np.abs(mix))
    if peak > 0.99:
        mix = mix * (0.99 / peak)
    return mix


# ── Main dispatcher ───────────────────────────────────────────────

def render_harmony(audio_bytes: bytes, voices: list[dict],
                   scale: str = "major", root: str = "C",
                   dry_gain: float = 0.85, wet_gain: float = 0.7,
                   quality: str = "basic",
                   max_duration: float | None = None,
                   sr: int = 44100) -> bytes:
    """
    Main entry point. Returns WAV bytes.

    quality: "basic" | "pro" | "studio"
    """
    audio, sr = load_audio(audio_bytes, sr=sr, max_duration=max_duration)

    if quality == "studio" and _check_demucs():
        result = render_studio(audio, sr, voices, dry_gain, wet_gain, scale, root)
    elif quality == "pro":
        result = render_pro(audio, sr, voices, dry_gain, wet_gain, scale, root)
    else:
        result = render_basic(audio, sr, voices, dry_gain, wet_gain, scale, root)

    return audio_to_wav_bytes(result, sr)

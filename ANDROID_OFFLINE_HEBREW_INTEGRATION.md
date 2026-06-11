# Android Offline Hebrew Integration (Whisper.cpp)

This repository now contains a dedicated Android module for full offline Hebrew transcription:

- Folder: `android-offline-whisper`
- Stack: Kotlin + Compose + JNI/NDK + whisper.cpp
- Offline runtime: fully local after model download/import

## What was implemented

1. Android app scaffold with Gradle and Compose UI.
2. Local model manager:
   - Download multilingual models (`ggml-tiny.bin`, `ggml-base.bin`, `ggml-small.bin`, `ggml-medium.bin`, `ggml-large-v3.bin`).
   - Manual model import from device storage.
3. Audio input:
   - File picker for audio/video.
   - Microphone recording.
4. Preprocessing:
   - FFmpegKit conversion to WAV 16kHz mono PCM.
5. Native transcription engine:
   - whisper.cpp integration via JNI/NDK.
   - `language=he`, `translate=false`.
   - Segment timestamps for SRT export.
   - Progress callback + cancellation support.
6. Export:
   - TXT
   - SRT
   - DOCX

7. Production hardening:
   - Device capability evaluator (RAM/CPU based quality gating).
   - Model SHA-256 validation after download.
   - Foreground transcription service with progress notification.

## Important runtime requirement

Before first Android build, place whisper.cpp source code here:

- `android-offline-whisper/third_party/whisper.cpp`

Example:

```bash
git clone https://github.com/ggml-org/whisper.cpp.git android-offline-whisper/third_party/whisper.cpp
```

## Notes for professional Hebrew quality

- Use multilingual models only (never `*.en`).
- Keep default language fixed to Hebrew (`he`).
- Use `small` as practical default for production quality/speed.
- Use `medium`/`large-v3` only on strong devices due RAM and thermals.
- Keep preprocessing enabled (16k mono PCM) for consistent recognition quality.

## Suggested next hardening pass

1. Add quantized GGUF/GGML presets for very low-memory devices.
2. Add resumable HTTP downloads with partial file continuation.
3. Add optional battery/thermal-aware throttling profile.
4. Add benchmark screen to compare Hebrew WER/latency per model on-device.

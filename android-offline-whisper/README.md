# Offline Hebrew Whisper for Android

This module adds a fully offline Android app with Hebrew transcription using whisper.cpp.

## Features

- File picker for audio/video transcription.
- Microphone recording.
- On-device transcription using whisper.cpp via JNI/NDK.
- Hebrew-first configuration: `language=he`, `task=transcribe`.
- One-time model download or manual model import.
- Export transcript to TXT, SRT, and DOCX.
- Cancel running transcription.
- Device capability gating (RAM/CPU aware quality limits).
- Model checksum verification (SHA-256) after download.
- Foreground service progress notifications for long transcription runs.

## Important

No external server, cloud API, Groq, or OpenAI is used during transcription.
After model download/import, transcription runs fully offline.

## Setup

1. Open this folder in Android Studio:
   - `android-offline-whisper`
2. Add whisper.cpp source code under:
   - `android-offline-whisper/third_party/whisper.cpp`
3. Sync Gradle and build.

## Getting whisper.cpp source

Option A (recommended):

```bash
git clone https://github.com/ggml-org/whisper.cpp.git android-offline-whisper/third_party/whisper.cpp
```

Option B:

- Download ZIP from GitHub and extract it into `android-offline-whisper/third_party/whisper.cpp`.

## Recommended multilingual models for Hebrew

- ggml-tiny.bin
- ggml-base.bin
- ggml-small.bin
- ggml-medium.bin
- ggml-large-v3.bin

Do not use `*.en` models for Hebrew.

## Performance presets

- Fast: tiny/base
- Balanced: small
- Accurate: medium/large-v3 (high RAM devices)

## Notes

- Audio is normalized to WAV 16kHz mono PCM before whisper.cpp.
- Supported input containers include wav/mp3/m4a/mp4 via FFmpegKit preprocessing.
- The app blocks heavy quality profiles automatically on low-memory devices.
- Model downloads are verified with SHA-256 when checksum data is available.

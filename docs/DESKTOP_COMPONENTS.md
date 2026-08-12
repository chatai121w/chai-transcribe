# Desktop installation architecture

The Windows application uses a small Tauri shell and downloads local speech
components only when the user enables them. Users do not need to install Node,
Python, CUDA Toolkit, or edit `PATH`.

## Base installer

The NSIS installer contains:

- The Tauri desktop shell and compiled web application.
- The local transcription server source files.
- The first-run component manager and hardware detector.

The installer uses the current Windows user and does not require a machine-wide
installation.

## Downloaded components

Components are isolated under:

`%LOCALAPPDATA%\SmartHebrewTranscriber`

| Component | Purpose | Approximate size |
| --- | --- | ---: |
| Core runtime | Private Python, faster-whisper, CTranslate2 and local server | 650 MB |
| NVIDIA acceleration | Application-local CUDA 12 libraries | 1.1 GB |
| Hebrew model | Pinned ivrit-ai large-v3-turbo CTranslate2 model | 1.65 GB |
| Advanced speech | WhisperX, pyannote and hardware-specific PyTorch | 3.5-6.5 GB |

The first run selects the core runtime and Hebrew model. NVIDIA acceleration is
selected only when the GPU, driver and VRAM pass the compatibility check. The
advanced package remains optional and can be installed later from `/setup`.

Python downloads resume from a `.partial` file. Pip and Hugging Face use their
own caches, so interrupted component downloads can continue without reinstalling
the desktop application.

## Runtime behavior

- The local server searches ports `3000-3019` and writes the selected port to
  `server-port.txt`.
- The web layer receives the selected port and does not assume port 3000.
- A previous partial installation is repaired automatically when required
  server modules are missing.
- If local setup is deferred, cloud transcription engines remain available.

## Build and verification

From the repository root:

```powershell
npm run desktop:validate
npm run desktop:build
```

`desktop:build` verifies every bundled server resource, compiles TypeScript,
runs Rust tests, builds Tauri, and fails unless an NSIS EXE artifact exists.
Artifacts are written below `src-tauri/target/release/bundle`.

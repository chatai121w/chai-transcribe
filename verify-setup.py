import sys, time

def line(s): print(s, flush=True)

ok = True
line("=== Smart Hebrew Transcriber - health check ===")

# 1. torch + CUDA
try:
    import torch
    line(f"[torch] version       : {torch.__version__}")
    avail = torch.cuda.is_available()
    line(f"[torch] cuda available: {avail}")
    line(f"[torch] cuda runtime  : {torch.version.cuda}")
    if avail:
        line(f"[torch] gpu           : {torch.cuda.get_device_name(0)}")
        vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        line(f"[torch] vram          : {vram:.1f} GB")
    else:
        ok = False
        line("[torch] !! CUDA not available - running on CPU")
except Exception as e:
    ok = False
    line(f"[torch] ERROR: {e}")

# 2. ctranslate2 CUDA support (this is what faster-whisper uses on the GPU)
try:
    import ctranslate2
    line(f"[ctranslate2] version : {ctranslate2.__version__}")
    types = ctranslate2.get_supported_compute_types("cuda")
    line(f"[ctranslate2] cuda    : {sorted(types)}")
except Exception as e:
    ok = False
    line(f"[ctranslate2] ERROR: {e}")

# 3. faster-whisper: load the accurate model + run a real test inference
try:
    import numpy as np
    from faster_whisper import WhisperModel
    line("[model] loading ivrit-ai/whisper-large-v3-ct2 on GPU (float16)...")
    t0 = time.time()
    m = WhisperModel("ivrit-ai/whisper-large-v3-ct2", device="cuda", compute_type="float16")
    line(f"[model] loaded in {time.time()-t0:.1f}s")
    audio = np.zeros(16000 * 2, dtype=np.float32)  # 2 seconds of silence
    line("[model] running a test inference on the GPU...")
    t0 = time.time()
    segs, info = m.transcribe(audio, language="he")
    _ = list(segs)
    line(f"[model] inference OK in {time.time()-t0:.1f}s (lang={info.language})")
except Exception as e:
    ok = False
    import traceback
    traceback.print_exc()
    line(f"[model] ERROR: {e}")

line("")
line("RESULT: " + ("ALL GOOD" if ok else "PROBLEMS FOUND - see errors above"))
sys.exit(0 if ok else 1)

import sys
print("Loading faster_whisper...", flush=True)
try:
    from faster_whisper import WhisperModel
    print("Downloading + loading ivrit-ai/whisper-large-v3-ct2 on GPU (float16)...", flush=True)
    m = WhisperModel("ivrit-ai/whisper-large-v3-ct2", device="cuda", compute_type="float16")
    print("OK - downloaded and loaded on GPU", flush=True)
except Exception as e:
    import traceback
    print("ERROR:", type(e).__name__, str(e), flush=True)
    traceback.print_exc()
    sys.exit(1)

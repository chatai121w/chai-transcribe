"""
Local Hebrew Transcription Server (CUDA)
=========================================
Runs ivrit-ai Whisper models on your GPU with word-level timestamps.
Serves a REST API for the Smart Hebrew Transcriber app.

Models supported:
- ivrit-ai/whisper-v2-d4-e3 (best for Hebrew, ~1.5GB)
- ivrit-ai/whisper-large-v3-turbo (fast + Hebrew optimized, ~800MB)
- openai/whisper-large-v3-turbo (general purpose, ~800MB)
- openai/whisper-large-v3 (highest accuracy, ~1.5GB)

Usage:
  python scripts/whisper_server.py
  python scripts/whisper_server.py --model ivrit-ai/whisper-large-v3-turbo --port 8787
"""

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

# Check dependencies
try:
    from faster_whisper import WhisperModel
except ImportError:
    print("ERROR: faster-whisper not installed. Run: pip install faster-whisper")
    sys.exit(1)

try:
    from flask import Flask, request, jsonify
    from flask_cors import CORS
except ImportError:
    print("ERROR: flask/flask-cors not installed. Run: pip install flask flask-cors")
    sys.exit(1)

# ──────────────────────────────────
# Available models
# ──────────────────────────────────
MODELS = {
    "ivrit-ai/whisper-v2-d4-e3": {
        "name": "Ivrit.ai Whisper V2 🇮🇱",
        "size": "~1.5GB",
        "description": "הכי מדויק לעברית דבורה",
    },
    "ivrit-ai/whisper-large-v3-turbo": {
        "name": "Ivrit.ai Turbo V3 🇮🇱⚡",
        "size": "~800MB",
        "description": "מהיר ומדויק לעברית",
    },
    "openai/whisper-large-v3-turbo": {
        "name": "Whisper Large V3 Turbo",
        "size": "~800MB",
        "description": "מודל כללי מהיר",
    },
    "openai/whisper-large-v3": {
        "name": "Whisper Large V3",
        "size": "~1.5GB",
        "description": "דיוק מקסימלי",
    },
}

# ──────────────────────────────────
# Server
# ──────────────────────────────────
app = Flask(__name__)
CORS(app)

# Global model reference
loaded_model = None
loaded_model_id = None


def load_model(model_id: str):
    """Load a Whisper model with CUDA if available."""
    global loaded_model, loaded_model_id

    if loaded_model_id == model_id and loaded_model:
        return loaded_model

    print(f"\n🔄 Loading model: {model_id}")
    start = time.time()

    # Try CUDA first, fall back to CPU
    try:
        loaded_model = WhisperModel(
            model_id,
            device="cuda",
            compute_type="float16",
        )
        device_label = "CUDA (GPU)"
    except Exception as e:
        print(f"⚠️  CUDA failed ({e}), falling back to CPU...")
        loaded_model = WhisperModel(
            model_id,
            device="cpu",
            compute_type="int8",
        )
        device_label = "CPU"

    loaded_model_id = model_id
    elapsed = time.time() - start
    print(f"✅ Model loaded on {device_label} in {elapsed:.1f}s")
    return loaded_model


@app.route("/api/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "model": loaded_model_id,
        "models_available": list(MODELS.keys()),
    })


@app.route("/api/models", methods=["GET"])
def list_models():
    """List available models and which is loaded."""
    result = []
    for mid, info in MODELS.items():
        result.append({
            "id": mid,
            "name": info["name"],
            "size": info["size"],
            "description": info["description"],
            "loaded": mid == loaded_model_id,
        })
    return jsonify(result)


@app.route("/api/load", methods=["POST"])
def load_model_endpoint():
    """Load/switch a model."""
    data = request.get_json() or {}
    model_id = data.get("model_id", "ivrit-ai/whisper-large-v3-turbo")

    if model_id not in MODELS:
        return jsonify({"error": f"Unknown model: {model_id}"}), 400

    try:
        load_model(model_id)
        return jsonify({"status": "ok", "model": model_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/transcribe", methods=["POST"])
def transcribe():
    """Transcribe audio file. Returns text + word-level timestamps."""
    if not loaded_model:
        return jsonify({"error": "No model loaded"}), 503

    # Get audio file from request
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    audio_file = request.files["file"]
    language = request.form.get("language", "he")

    # Save to temp file
    suffix = Path(audio_file.filename or "audio.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        print(f"🎙️  Transcribing: {audio_file.filename} (lang={language})")
        start = time.time()

        # Transcribe with word timestamps
        segments, info = loaded_model.transcribe(
            tmp_path,
            language=language if language != "auto" else None,
            word_timestamps=True,
            beam_size=5,
            vad_filter=True,  # Voice Activity Detection - removes silence
            vad_parameters=dict(
                min_silence_duration_ms=500,
                speech_pad_ms=200,
            ),
        )

        # Collect results
        full_text = []
        word_timings = []

        for segment in segments:
            full_text.append(segment.text.strip())
            if segment.words:
                for w in segment.words:
                    word_timings.append({
                        "word": w.word.strip(),
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                    })

        text = " ".join(full_text)  
        elapsed = time.time() - start
        
        print(f"✅ Done in {elapsed:.1f}s — {len(word_timings)} words, "
              f"duration {info.duration:.1f}s, lang={info.language}")

        return jsonify({
            "text": text,
            "wordTimings": word_timings,
            "duration": info.duration,
            "language": info.language,
            "model": loaded_model_id,
            "processingTime": round(elapsed, 2),
        })

    except Exception as e:
        print(f"❌ Transcription error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)


@app.route("/api/download-model", methods=["POST"])
def download_model():
    """Pre-download a model (loads it then unloads current if different)."""
    data = request.get_json() or {}
    model_id = data.get("model_id")
    
    if not model_id or model_id not in MODELS:
        return jsonify({"error": f"Unknown model: {model_id}"}), 400

    try:
        print(f"⬇️  Downloading model: {model_id}")
        load_model(model_id)
        return jsonify({"status": "ok", "model": model_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ──────────────────────────────────
# Main
# ──────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Local Hebrew Whisper Server")
    parser.add_argument("--model", default="ivrit-ai/whisper-large-v3-turbo",
                        help="Initial model to load")
    parser.add_argument("--port", type=int, default=8787,
                        help="Server port (default: 8787)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="Host to bind (default: 127.0.0.1)")
    args = parser.parse_args()

    print("=" * 50)
    print("  🎙️  Local Hebrew Whisper Server")
    print("=" * 50)
    print(f"  Model:  {args.model}")
    print(f"  URL:    http://{args.host}:{args.port}")
    print(f"  GPU:    CUDA (NVIDIA RTX)")
    print("=" * 50)

    # Pre-load model
    load_model(args.model)

    print(f"\n🚀 Server running at http://{args.host}:{args.port}")
    print("   Endpoints:")
    print("   GET  /api/health     - Health check")
    print("   GET  /api/models     - List models")
    print("   POST /api/load       - Load/switch model")
    print("   POST /api/transcribe - Transcribe audio")
    print("   POST /api/download-model - Pre-download model")
    print()

    app.run(host=args.host, port=args.port, debug=False)

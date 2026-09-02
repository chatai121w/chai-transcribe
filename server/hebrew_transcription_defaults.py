"""Load the versioned Hebrew ASR prompt and hotwords shared with the web app."""

import json
from pathlib import Path


DEFAULTS_PATH = (
    Path(__file__).resolve().parent.parent / "shared" / "hebrew_transcription_defaults.json"
)


def load_hebrew_transcription_defaults():
    with DEFAULTS_PATH.open("r", encoding="utf-8") as source:
        payload = json.load(source)
    if payload.get("schemaVersion") != 1:
        raise RuntimeError("Unsupported Hebrew transcription defaults schema")
    if not isinstance(payload.get("loshonKodeshPrompt"), str):
        raise RuntimeError("Missing canonical Loshon Kodesh prompt")
    for key in ("loshonKodeshHotwords", "hebrewDefaultHotwords"):
        if not isinstance(payload.get(key), list) or not all(
            isinstance(term, str) and term.strip() for term in payload[key]
        ):
            raise RuntimeError(f"Invalid canonical Hebrew defaults list: {key}")
        if len(payload[key]) != len(set(payload[key])):
            raise RuntimeError(f"Duplicate terms in canonical Hebrew defaults list: {key}")
    return payload


DEFAULTS = load_hebrew_transcription_defaults()
LOSHON_KODESH_PROMPT = DEFAULTS["loshonKodeshPrompt"]
LOSHON_KODESH_HOTWORDS = ", ".join(DEFAULTS["loshonKodeshHotwords"])
HEBREW_DEFAULT_HOTWORDS = ", ".join(DEFAULTS["hebrewDefaultHotwords"])

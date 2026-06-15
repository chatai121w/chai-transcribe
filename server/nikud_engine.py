"""
Hebrew Nikud (Diacritization) Engine
====================================
Adds nikud (vowel diacritics) to Hebrew text using DICTA's open-source model
`dicta-il/dictabert-large-char-menaked` — SOTA for modern Hebrew vocalization
(beats commercial LLMs as of 2025-03, per DICTA).

The model is a lightweight (~0.3B) char-level BERT that runs locally on CPU or GPU.
It is loaded lazily on first request and cached for subsequent calls.

Note: this model targets MODERN Hebrew prose. It is NOT intended for Biblical,
Rabbinic, Premodern, or poetic Hebrew.

Public API:
  - is_available() -> bool           : whether transformers is installed
  - add_nikud(text, keep_meteg=...) -> str : add nikud to a block of text
  - get_status() -> dict             : engine/model load status for diagnostics
"""

import logging
import threading

_log = logging.getLogger("whisper-server")

MODEL_NAME = "dicta-il/dictabert-large-char-menaked"

# Lazy-loaded singletons
_model = None
_tokenizer = None
_load_lock = threading.Lock()
_load_error: str | None = None
_device: str = "cpu"

# Matres lectionis letters (אימות קריאה)
_MATRES_LETTERS = frozenset("אוי")


def _remove_nikud(s: str) -> str:
    """Strip existing Hebrew points (U+0591..U+05C7) so the model re-vocalizes cleanly."""
    return "".join(c for c in s if not ("\u0591" <= c <= "\u05C7"))


def _is_hebrew_letter(c: str) -> bool:
    return "\u05D0" <= c <= "\u05EA"


def is_available() -> bool:
    """Return True if the transformers library is importable."""
    try:
        import transformers  # noqa: F401
        return True
    except ImportError:
        return False


def warmup() -> None:
    """Eagerly load the model (safe to call from a background thread).

    Used to eliminate the one-time cold-start latency (~5s) on the first
    /nikud request by pre-loading when the user opens the text editor.
    """
    try:
        _ensure_loaded()
    except Exception as e:  # pragma: no cover - defensive
        _log.warning(f"[nikud] warmup failed: {e}")


def _ensure_loaded() -> None:
    """Load the DictaBERT menaked model once (thread-safe, lazy)."""
    global _model, _tokenizer, _load_error, _device
    if _model is not None or _load_error is not None:
        return
    with _load_lock:
        if _model is not None or _load_error is not None:
            return
        try:
            from transformers import AutoModel, AutoTokenizer
            try:
                import torch
                _device = "cuda" if torch.cuda.is_available() else "cpu"
            except ImportError:
                _device = "cpu"

            _log.info(f"[nikud] Loading {MODEL_NAME} on {_device} …")
            tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
            model = AutoModel.from_pretrained(MODEL_NAME, trust_remote_code=True)
            model.eval()
            if _device == "cuda":
                try:
                    model = model.to("cuda")
                except Exception as e:  # pragma: no cover - GPU edge case
                    _log.warning(f"[nikud] GPU move failed, using CPU: {e}")
                    _device = "cpu"
            _tokenizer = tokenizer
            _model = model
            _log.info(f"[nikud] Model ready on {_device}")
        except Exception as e:
            _load_error = str(e)
            _log.error(f"[nikud] Failed to load model: {e}")


def add_nikud(
    text: str,
    style: str = "male",
    mark_matres_lectionis: str | None = None,
) -> str:
    """
    Add nikud to Hebrew `text`.

    Args:
        text: Hebrew text (may contain multiple lines).
        style: output spelling style:
            - "male" (default): כתיב מלא — keep every original letter and only
              add vowel points. Nothing is deleted from the user's text.
            - "haser": כתיב חסר — drop matres lectionis (אמות קריאה)
              that the model deems redundant, producing tighter vocalized text.
        mark_matres_lectionis: advanced override — if provided (e.g. '|'),
            matres lectionis are kept and marked with this symbol. Takes
            precedence over `style`.

    Returns:
        The diacritized text. Line structure is preserved.

    Raises:
        RuntimeError: if the model could not be loaded.
    """
    if not text or not text.strip():
        return text

    _ensure_loaded()
    if _model is None:
        raise RuntimeError(_load_error or "Nikud model unavailable")

    # Resolve the matres-lectionis handling from style / explicit override.
    if mark_matres_lectionis is not None:
        mark = mark_matres_lectionis
    elif style == "haser":
        mark = None          # drop redundant matres letters
    else:                    # "male" (default) — keep all letters untouched
        mark = ""

    # Preserve line breaks: diacritize each non-empty line independently.
    lines = text.split("\n")
    nonempty_idx = [i for i, ln in enumerate(lines) if ln.strip()]
    sentences = [lines[i] for i in nonempty_idx]
    if not sentences:
        return text

    results = _predict_chars(sentences, mark)

    out = list(lines)
    for idx, res in zip(nonempty_idx, results):
        out[idx] = res
    return "\n".join(out)


def _predict_chars(sentences: list[str], mark_matres_lectionis: str | None = None) -> list[str]:
    """
    Diacritize sentences using manual char-level tokenization.

    DictaBERT-char-menaked is a character-level model, but the HF *fast*
    tokenizer (tokenizers >= 0.22 / transformers 5.x) groups whole words into
    single tokens and returns word-span offsets instead of per-character
    offsets. The model's bundled ``predict()`` relies on those per-character
    offsets and therefore emits duplicated, unvocalized output on transformers
    5.x. We bypass that by building char-level ``input_ids`` ourselves so each
    Hebrew character maps to exactly one logits position.
    """
    import torch

    cls_id = _tokenizer.cls_token_id
    sep_id = _tokenizer.sep_token_id
    pad_id = _tokenizer.pad_token_id

    clean = [_remove_nikud(s) for s in sentences]
    max_len = max((len(s) for s in clean), default=0)

    ids_batch, attn_batch = [], []
    for s in clean:
        ids = [cls_id] + [_tokenizer.convert_tokens_to_ids(c) for c in s] + [sep_id]
        attn = [1] * len(ids)
        pad_n = (max_len + 2) - len(ids)
        if pad_n > 0:
            ids += [pad_id] * pad_n
            attn += [0] * pad_n
        ids_batch.append(ids)
        attn_batch.append(attn)

    input_ids = torch.tensor(ids_batch, device=_model.device)
    attention_mask = torch.tensor(attn_batch, device=_model.device)

    with torch.no_grad():
        logits = _model.forward(
            input_ids=input_ids, attention_mask=attention_mask, return_dict=True
        ).logits
    nikud_pred = logits.nikud_logits.argmax(dim=-1).tolist()
    shin_pred = logits.shin_logits.argmax(dim=-1).tolist()

    cfg = _model.config
    results: list[str] = []
    for si, s in enumerate(clean):
        out_chars: list[str] = []
        for idx, char in enumerate(s):
            tok_idx = idx + 1  # account for leading [CLS]
            if not _is_hebrew_letter(char):
                out_chars.append(char)
                continue
            nikud = cfg.nikud_classes[nikud_pred[si][tok_idx]]
            shin = "" if char != "\u05E9" else cfg.shin_classes[shin_pred[si][tok_idx]]
            if nikud == cfg.mat_lect_token:
                if char not in _MATRES_LETTERS:
                    nikud = ""
                elif mark_matres_lectionis is not None:
                    nikud = mark_matres_lectionis
                else:
                    continue  # drop the matres letter entirely
            out_chars.append(char + shin + nikud)
        results.append("".join(out_chars))
    return results


def get_status() -> dict:
    """Return diagnostic info about the nikud engine."""
    return {
        "available": is_available(),
        "model": MODEL_NAME,
        "loaded": _model is not None,
        "device": _device,
        "error": _load_error,
    }

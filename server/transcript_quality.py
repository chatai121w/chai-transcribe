"""Reference-free guards for obviously degenerate ASR output."""

import re
from collections import Counter


def lexical_diversity_score(text: str) -> float:
    """Higher is better; penalizes a transcript dominated by repeated tokens."""
    tokens = re.findall(r"[\u0590-\u05FFA-Za-z0-9]+", (text or "").lower())
    if not tokens:
        return -1.0
    counts = Counter(tokens)
    unique_ratio = len(counts) / len(tokens)
    dominant_ratio = max(counts.values()) / len(tokens)
    return unique_ratio - (2.0 * dominant_ratio)


def is_degenerate_transcript(text: str) -> bool:
    tokens = re.findall(r"[\u0590-\u05FFA-Za-z0-9]+", (text or "").lower())
    if len(tokens) < 50:
        return False
    counts = Counter(tokens)
    unique_ratio = len(counts) / len(tokens)
    dominant_ratio = max(counts.values()) / len(tokens)
    return unique_ratio < 0.35 or dominant_ratio >= 0.12

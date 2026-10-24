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
    """Detect repetition-loop output.

    Fixed 2026-10-23. The old version returned False for anything under 50 tokens,
    so a 22-token transcript that was one word repeated passed the guard and no
    neutral retry was triggered. Short clips are now checked with stricter
    thresholds instead of being skipped: a short transcript needs a far higher
    share of one repeated token before it looks like speech rather than a loop.
    """
    tokens = re.findall(r"[\u0590-\u05FFA-Za-z0-9]+", (text or "").lower())
    if len(tokens) < 6:
        # Too little signal to judge \u2014 a 3-word clip may legitimately repeat.
        return False

    counts = Counter(tokens)
    unique_ratio = len(counts) / len(tokens)
    dominant_ratio = max(counts.values()) / len(tokens)

    if len(tokens) >= 50:
        return unique_ratio < 0.35 or dominant_ratio >= 0.12

    # Short output: require clearer evidence so ordinary speech is not flagged.
    if unique_ratio < 0.40 or dominant_ratio >= 0.40:
        return True

    # An immediately repeated run (a word or phrase looping) is degenerate at any
    # length, even when the overall ratios still look acceptable.
    run = best = 1
    for i in range(1, len(tokens)):
        run = run + 1 if tokens[i] == tokens[i - 1] else 1
        best = max(best, run)
    return best >= 4

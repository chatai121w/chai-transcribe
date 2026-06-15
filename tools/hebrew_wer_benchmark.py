"""
Hebrew WER Benchmark — 50-word ground truth with 10 trap words.

The script:
  1. Defines a 50-word Hebrew sentence with 10 phonetically tricky "trap" words.
  2. Generates audio via Microsoft edge-tts (he-IL-AvriNeural) — no internet API key needed.
  3. Sends the audio to every Whisper preset + /transcribe direct.
  4. Calculates WER, trap-word accuracy, and highlights differences.

Trap words chosen because Hebrew ASR models frequently confuse them:
  ┌──────────────┬───────────────┬───────────────────────────────────────┐
  │  Trap word   │  Common error │  Why confusable                       │
  ├──────────────┼───────────────┼───────────────────────────────────────┤
  │  ערכות        │  הלכות        │  similar phonemes, different meaning  │
  │  ממשק         │  ממשל         │  final consonant drop                 │
  │  עיבוד        │  עיכוב        │  bet/kaf swap                         │
  │  אבטחה        │  בטחה         │  aleph-drop at start                  │
  │  מפגש         │  מפגע         │  shin/ayin confusion                  │
  │  תהליך        │  הליך         │  tav-drop at start                    │
  │  מסמכים       │  מסמכי        │  plural vs. construct state           │
  │  שיפור        │  שיבוש        │  resh/shin swap                       │
  │  חיפוש        │  חיפוס        │  shin/samech confusion                │
  │  קבוצות       │  קבוצת        │  plural vs. construct state           │
  └──────────────┴───────────────┴───────────────────────────────────────┘

Usage:
  python tools/hebrew_wer_benchmark.py [--keep-audio]
"""

import asyncio
import sys
import os
import re
import json
import time
import tempfile
import difflib
import requests
from pathlib import Path

SERVER = "http://localhost:3000"
AUDIO_OUT = Path("tools/benchmark_audio.wav")
AUDIO_NOISY = Path("tools/benchmark_noisy.wav")

# ─── Ground truth ────────────────────────────────────────────────────────────
# 50 words.  Trap words marked with *** in comments below — not in actual text.
GROUND_TRUTH = (
    "המערכת מבצעת עיבוד"           # עיבוד *** (bet/kaf)
    " חכם של מסמכים"               # מסמכים *** (plural vs construct)
    " ושומרת על אבטחה"             # אבטחה *** (aleph-drop)
    " גבוהה. הממשק"                # ממשק *** (final consonant drop)
    " בין המשתמש למערכת"
    " עובד דרך ערכות"               # ערכות *** (ערכות vs הלכות)
    " כלים מתקדמות."
    " תהליך ההגדרה"                 # תהליך *** (tav-drop)
    " פשוט וידידותי"
    " ומאפשר שיפור"                 # שיפור *** (resh/shin)
    " מתמיד בדרך של חיפוש"         # חיפוש *** (shin/samech)
    " פתרונות חדשים."
    " מפגש הצוותים"                 # מפגש *** (shin/ayin)
    " מתקיים בכל שבוע"
    " ובו נדונות קבוצות"            # קבוצות *** (plural vs construct)
    " נושאים שונות."
)

# Normalize for clean comparison
def _normalize(text: str) -> str:
    """Remove punctuation, extra spaces; lowercase — for WER calculation."""
    text = re.sub(r'[.,!?;:\-\"\']', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

GROUND_TRUTH_WORDS = _normalize(GROUND_TRUTH).split()

# The 10 trap words (exact strings as they appear in ground truth after normalize)
TRAP_WORDS = {
    "עיבוד", "מסמכים", "אבטחה", "ממשק", "ערכות",
    "תהליך", "שיפור", "חיפוש", "מפגש", "קבוצות",
}

# Expected wrong transcriptions for each trap word
COMMON_ERRORS = {
    "עיבוד": "עיכוב",
    "מסמכים": "מסמכי",
    "אבטחה": "בטחה",
    "ממשק": "ממשל",
    "ערכות": "הלכות",
    "תהליך": "הליך",
    "שיפור": "שיבוש",
    "חיפוש": "חיפוס",
    "מפגש": "מפגע",
    "קבוצות": "קבוצת",
}

# ─── TTS + noise ─────────────────────────────────────────────────────────────
async def _generate_audio_edge(text: str, output_path: Path):
    """Generate Hebrew speech using Microsoft edge-tts (he-IL-AvriNeural)."""
    import edge_tts
    communicate = edge_tts.Communicate(text, voice="he-IL-AvriNeural")
    mp3_path = str(output_path).replace(".wav", ".mp3")
    await communicate.save(mp3_path)
    import subprocess
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", mp3_path, "-ar", "16000", "-ac", "1",
         "-acodec", "pcm_s16le", str(output_path)],
        capture_output=True, timeout=30,
    )
    os.unlink(mp3_path)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg conversion failed: {result.stderr.decode(errors='replace')[:300]}")
    print(f"  נקי: {output_path} ({output_path.stat().st_size // 1024} KB)")

def _add_noise(clean_path: Path, noisy_path: Path, noise_db: float = -18.0):
    """Mix pink noise at noise_db dBFS into clean audio — simulates office environment."""
    import subprocess
    result = subprocess.run(
        ["ffmpeg", "-y",
         "-i", str(clean_path),
         "-filter_complex",
         f"aevalsrc=random(0)*2-1:s=16000:c=mono[noise];[noise]aresample=16000,volume={noise_db}dB[n];[0:a][n]amix=inputs=2:duration=first",
         "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le",
         str(noisy_path)],
        capture_output=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Noise mix failed: {result.stderr.decode(errors='replace')[:300]}")
    print(f"  רועש ({noise_db}dB): {noisy_path} ({noisy_path.stat().st_size // 1024} KB)")

# ─── WER calculation ─────────────────────────────────────────────────────────
def word_error_rate(reference: list, hypothesis: list) -> dict:
    """
    Compute WER using dynamic programming (Levenshtein on word lists).
    Returns: {'wer': float, 'insertions': int, 'deletions': int, 'substitutions': int}
    """
    r, h = reference, hypothesis
    d = [[0] * (len(h) + 1) for _ in range(len(r) + 1)]
    for i in range(len(r) + 1):
        d[i][0] = i
    for j in range(len(h) + 1):
        d[0][j] = j
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            if r[i - 1] == h[j - 1]:
                d[i][j] = d[i - 1][j - 1]
            else:
                d[i][j] = 1 + min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1])

    # Backtrack to count op types
    i, j = len(r), len(h)
    subs = ins = dels = 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and r[i-1] == h[j-1]:
            i -= 1; j -= 1
        elif i > 0 and j > 0 and d[i][j] == d[i-1][j-1] + 1:
            subs += 1; i -= 1; j -= 1
        elif j > 0 and d[i][j] == d[i][j-1] + 1:
            ins += 1; j -= 1
        else:
            dels += 1; i -= 1

    errors = subs + ins + dels
    wer = errors / max(len(r), 1)
    return {"wer": round(wer * 100, 1), "substitutions": subs, "insertions": ins, "deletions": dels}

def _strip_definite_article(word: str) -> str:
    """Strip any Hebrew service-letter prefix chain (ב,ל,כ,ו,מ,ש,ה) from a word.
    e.g. לניהול → ניהול, באחריות → אחריות, ולהממשק → ממשק"""
    SERVICE = set('בלכומשה')
    i = 0
    while i < len(word) - 1 and word[i] in SERVICE:
        i += 1
    return word[i:]

def trap_score(hypothesis_words: list) -> dict:
    """
    Check how many of the 10 trap words were correctly transcribed.
    Strips Hebrew service-letter prefixes (ב,ל,כ,ו,מ,ש,ה) from both
    hypothesis and trap words before comparing, so 'לניהול' counts as 'ניהול'.
    """
    results = {}
    # Build normalized set with all prefix-stripped variants
    hyp_set = set(hypothesis_words) | {_strip_definite_article(w) for w in hypothesis_words}
    for trap in TRAP_WORDS:
        trap_bare = _strip_definite_article(trap)
        correct = trap in hyp_set or trap_bare in hyp_set
        wrong = COMMON_ERRORS[trap]
        wrong_bare = _strip_definite_article(wrong)
        wrong_found = wrong in hyp_set or wrong_bare in hyp_set
        results[trap] = {
            "correct": correct,
            "wrong_word_found": wrong if wrong_found else None,
        }
    correct_count = sum(1 for v in results.values() if v["correct"])
    return {"score": f"{correct_count}/10", "correct_count": correct_count, "details": results}

def highlight_diff(reference: list, hypothesis: list) -> str:
    """Return colored diff string showing errors inline."""
    matcher = difflib.SequenceMatcher(None, reference, hypothesis)
    parts = []
    for opcode, i1, i2, j1, j2 in matcher.get_opcodes():
        if opcode == "equal":
            parts.append(" ".join(reference[i1:i2]))
        elif opcode == "replace":
            ref_str = " ".join(reference[i1:i2])
            hyp_str = " ".join(hypothesis[j1:j2])
            parts.append(f"[❌{ref_str}→{hyp_str}]")
        elif opcode == "delete":
            ref_str = " ".join(reference[i1:i2])
            parts.append(f"[🗑️{ref_str}]")
        elif opcode == "insert":
            hyp_str = " ".join(hypothesis[j1:j2])
            parts.append(f"[➕{hyp_str}]")
    return " ".join(parts)

# ─── Transcription calls ─────────────────────────────────────────────────────
def run_plain(audio_path: Path, beam_size: int) -> tuple[str, float]:
    with open(audio_path, "rb") as f:
        t0 = time.time()
        r = requests.post(
            f"{SERVER}/transcribe",
            files={"file": (audio_path.name, f, "audio/wav")},
            data={"language": "he", "normalize": "1", "beam_size": str(beam_size)},
            timeout=180,
        )
    elapsed = time.time() - t0
    r.raise_for_status()
    return r.json().get("text", ""), elapsed

def run_stream(audio_path: Path, preset: str) -> tuple[str, float]:
    with open(audio_path, "rb") as f:
        t0 = time.time()
        r = requests.post(
            f"{SERVER}/transcribe-stream",
            files={"file": (audio_path.name, f, "audio/wav")},
            data={"language": "he", "normalize": "1", "preset": preset},
            stream=True,
            timeout=180,
        )
    r.raise_for_status()
    segments = []
    for line in r.iter_lines():
        if not line:
            continue
        if line.startswith(b"data: "):
            try:
                obj = json.loads(line[6:])
                if "text" in obj and obj.get("type") != "done":
                    segments.append(obj["text"].strip())
                if obj.get("type") == "done":
                    break
            except json.JSONDecodeError:
                pass
    elapsed = time.time() - t0
    return " ".join(segments), elapsed

# ─── Main ─────────────────────────────────────────────────────────────────────
SEP = "═" * 75
SEP2 = "─" * 75

SYSTEMS = [
    ("fast   (stream)",    "stream", "fast",      None),
    ("balanced (stream)",  "stream", "balanced",  None),
    ("accurate (stream)",  "stream", "accurate",  None),
    ("/transcribe beam=3", "plain",  None,        3),
    ("/transcribe beam=5", "plain",  None,        5),
]

def _run_systems(audio_path: Path, label_suffix: str) -> list:
    results = []
    for label, mode, preset, beam in SYSTEMS:
        full_label = f"{label} [{label_suffix}]"
        print(f"  ► {full_label:38s} ...", end="", flush=True)
        try:
            if mode == "stream":
                text, elapsed = run_stream(audio_path, preset)
            else:
                text, elapsed = run_plain(audio_path, beam)
            hyp_words = _normalize(text).split()
            wer_data = word_error_rate(GROUND_TRUTH_WORDS, hyp_words)
            trap_data = trap_score(hyp_words)
            results.append({
                "label": full_label, "text": text, "elapsed": elapsed,
                "hyp_words": hyp_words, "audio": label_suffix,
                "wer": wer_data, "trap": trap_data,
            })
            print(f" ✓  {elapsed:.1f}s | WER={wer_data['wer']}% | trap={trap_data['score']}")
        except Exception as e:
            print(f" ✗  {e}")
            results.append({"label": full_label, "audio": label_suffix, "text": f"[ERROR: {e}]", "error": True})
    return results

def _print_results(results: list, title: str):
    print(f"\n{SEP}")
    print(f"  {title}")
    print(SEP)
    for r in results:
        if r.get("error"):
            print(f"\n  [{r['label']}]  ✗ שגיאה")
            continue
        print(f"\n  ┌─ {r['label']}")
        print(f"  │  {r['elapsed']:.1f}s | WER: {r['wer']['wer']}% | מילות מלכודת: {r['trap']['score']}")
        print(f"  │  טקסט: {r['text']}")
        diff_str = highlight_diff(GROUND_TRUTH_WORDS, r["hyp_words"])
        if "[❌" in diff_str or "[🗑️" in diff_str:
            print(f"  │  הבדלים: {diff_str}")
        print(f"  │  שגיאות: sub={r['wer']['substitutions']} ins={r['wer']['insertions']} del={r['wer']['deletions']}")
        trap_detail = r["trap"]["details"]
        wrong = [(t, v["wrong_word_found"] or "?") for t, v in trap_detail.items() if not v["correct"]]
        correct_traps = [t for t, v in trap_detail.items() if v["correct"]]
        if wrong:
            print(f"  │  ❌ שגויות: " + ", ".join(f"{t}→{w}" for t, w in wrong))
        if correct_traps:
            print(f"  │  ✅ נכונות:  " + ", ".join(correct_traps))
        print(f"  └{'─'*70}")

def _print_leaderboard(all_results: list):
    print(f"\n{SEP}")
    print("  🏆 LEADERBOARD סופי — השוואה נקי vs. רועש")
    print(SEP)

    # Group by audio type
    for audio_type in ["נקי", "רועש"]:
        group = [r for r in all_results if r.get("audio") == audio_type and not r.get("error")]
        if not group:
            continue
        group.sort(key=lambda r: (-r["trap"]["correct_count"], r["wer"]["wer"], r["elapsed"]))
        print(f"\n  אודיו {audio_type}:")
        print(f"  {'#':<3} {'מערכת':<28} {'WER':>6} {'מלכודות':>9} {'זמן':>7}")
        print(f"  {'-'*58}")
        medals = ["🥇", "🥈", "🥉", "4️⃣ ", "5️⃣ "]
        for i, r in enumerate(group):
            medal = medals[i] if i < len(medals) else "  "
            # Strip the [נקי]/[רועש] suffix for display
            label_clean = r['label'].replace(f' [{audio_type}]', '')
            print(f"  {medal} {label_clean:<28} {r['wer']['wer']:>5}% {r['trap']['score']:>9} {r['elapsed']:>6.1f}s")

    # Delta table: noisy WER - clean WER per preset
    clean_map = {r["label"].replace(" [נקי]", ""): r for r in all_results if r.get("audio") == "נקי" and not r.get("error")}
    noisy_map = {r["label"].replace(" [רועש]", ""): r for r in all_results if r.get("audio") == "רועש" and not r.get("error")}
    if clean_map and noisy_map:
        print(f"\n  ירידת ביצועים ברעש (ΔWer = רועש−נקי, ΔTrap = נקי−רועש):")
        print(f"  {'מערכת':<28} {'ΔWer':>7} {'ΔTrap':>7}")
        print(f"  {'-'*46}")
        for key in clean_map:
            if key in noisy_map:
                c = clean_map[key]
                n = noisy_map[key]
                delta_wer = n["wer"]["wer"] - c["wer"]["wer"]
                delta_trap = c["trap"]["correct_count"] - n["trap"]["correct_count"]
                sign = "+" if delta_wer > 0 else ""
                arrow = "↓" if delta_trap > 0 else ("↑" if delta_trap < 0 else "=")
                print(f"  {key:<28} {sign}{delta_wer:>5.1f}% {arrow}{abs(delta_trap):>5} מלכודות")

    print(f"\n  Ground truth: {len(GROUND_TRUTH_WORDS)} מילים | 10 מילות מלכודת")
    print(f"  WER = (sub + ins + del) / מילים × 100")
    print(SEP)

def main():
    keep_audio = "--keep-audio" in sys.argv
    run_noisy = "--noisy" in sys.argv or AUDIO_NOISY.exists()

    print(f"\n{SEP}")
    print("  Hebrew WER Benchmark — 50 מילים, 10 מילות מלכודת")
    print(SEP)
    print(f"\n  Ground truth ({len(GROUND_TRUTH_WORDS)} מילים):")
    print(f"  {GROUND_TRUTH}")
    print(f"\n  מילות מלכודת (10):")
    for trap, error in COMMON_ERRORS.items():
        print(f"    {trap:12s} ← מודלים לרוב כותבים: {error}")

    # ── Generate / reuse audio ────────────────────────────────────
    print(f"\n{SEP2}")
    print("  שלב 1: יצירת אודיו...")
    AUDIO_OUT.parent.mkdir(parents=True, exist_ok=True)
    if not AUDIO_OUT.exists():
        asyncio.run(_generate_audio_edge(GROUND_TRUTH, AUDIO_OUT))
    else:
        print(f"  נקי: {AUDIO_OUT} (קיים — {AUDIO_OUT.stat().st_size // 1024} KB)")
    if run_noisy and not AUDIO_NOISY.exists():
        _add_noise(AUDIO_OUT, AUDIO_NOISY, noise_db=-18.0)
    elif run_noisy:
        print(f"  רועש (-18dB): {AUDIO_NOISY} (קיים — {AUDIO_NOISY.stat().st_size // 1024} KB)")

    all_results = []

    # ── Clean audio pass ──────────────────────────────────────────
    print(f"\n{SEP2}")
    print("  שלב 2a: תמלול — אודיו נקי (TTS)")
    clean_results = _run_systems(AUDIO_OUT, "נקי")
    all_results.extend(clean_results)
    _print_results(clean_results, "תוצאות אודיו נקי")

    # ── Noisy audio pass ──────────────────────────────────────────
    if run_noisy and AUDIO_NOISY.exists():
        print(f"\n{SEP2}")
        print("  שלב 2b: תמלול — אודיו עם רעש רקע (-18dBFS pink noise)")
        noisy_results = _run_systems(AUDIO_NOISY, "רועש")
        all_results.extend(noisy_results)
        _print_results(noisy_results, "תוצאות אודיו רועש")

    # ── Final leaderboard ─────────────────────────────────────────
    _print_leaderboard(all_results)

    # Cleanup
    if not keep_audio:
        for p in [AUDIO_OUT, AUDIO_NOISY]:
            try:
                p.unlink()
            except OSError:
                pass

if __name__ == "__main__":
    main()

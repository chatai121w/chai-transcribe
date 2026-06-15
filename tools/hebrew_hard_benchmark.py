"""
Hebrew Hard WER Benchmark — newsroom language with minimal-pair trap words.

What makes this HARD compared to the basic benchmark:
  - Text is formal news/policy language (not simple tech description)
  - Trap words are minimal pairs: differ by ONE phoneme only
  - Several traps exploit Hebrew-specific confusions:
      * Construct state vs. base form  (מגמת ↔ מגמה)
      * ח/ג swap                       (צמיחה ↔ צמיגה)
      * ח/י swap                       (ביטוח ↔ ביטוי)
      * Prefix elision                  (אחריות ↔ אחרות)
      * ת/צ swap inside word           (פיתוח ↔ פיצוח)
      * Plural vs. singular suffix      (תשתיות ↔ תשתית)
  - Three noise levels: light / medium / heavy
  - Tests WITH and WITHOUT normalize to show impact of our FFmpeg fix
  - Includes ai_denoise comparison on the hardest noise level

Trap words table (10):
  ┌────────────────┬──────────────┬────────────────────────────────────────┐
  │ Ground truth   │ Common error │ Confusion type                         │
  ├────────────────┼──────────────┼────────────────────────────────────────┤
  │ מדיניות        │ מדינות       │ י-drop: policy → countries             │
  │ כלכלית         │ כלכלה        │ adj→noun suffix: economic → economy    │
  │ ביטוח          │ ביטוי        │ ח/י swap: insurance → expression       │
  │ פיתוח          │ פיצוח        │ ת/צ swap: development → cracking       │
  │ השקעה          │ השקיה        │ ע/י swap: investment → irrigation      │
  │ תשתיות         │ תשתית        │ plural drop: infra (pl) → infra (sg)   │
  │ ניהול          │ ניהוג        │ ל/ג end: management → driving          │
  │ אחריות         │ אחרות        │ יו-drop: responsibility → others       │
  │ מגמת           │ מגמה         │ construct state ת→ה: trend-of → trend  │
  │ צמיחה          │ צמיגה        │ ח/ג swap: growth → tire                │
  └────────────────┴──────────────┴────────────────────────────────────────┘

Usage:
  python tools/hebrew_hard_benchmark.py                  # all tests
  python tools/hebrew_hard_benchmark.py --quick          # clean + medium noise only
  python tools/hebrew_hard_benchmark.py --keep-audio
"""

import asyncio, sys, os, re, json, time, difflib, requests
from pathlib import Path

SERVER  = "http://localhost:3000"
AUDIO   = {
    "clean":  Path("tools/hard_clean.wav"),
    "light":  Path("tools/hard_light.wav"),   # -24 dBFS noise
    "medium": Path("tools/hard_medium.wav"),  # -18 dBFS noise
    "heavy":  Path("tools/hard_heavy.wav"),   # -12 dBFS noise
}

# ─── Ground truth (51 words) ─────────────────────────────────────────────────
GROUND_TRUTH = (
    "הממשלה הכריזה על מדיניות"      # מדיניות *** policy vs מדינות countries
    " כלכלית חדשה שתשפיע"           # כלכלית *** econ-adj vs כלכלה economy-noun
    " ישירות על ביטוח"               # ביטוח   *** insurance vs ביטוי expression
    " הבריאות הלאומי ועל מערכת החינוך."
    " מוסדות הפיתוח"                 # פיתוח   *** development vs פיצוח cracking
    " הטכנולוגי יקבלו השקעה"         # השקעה   *** investment vs השקיה irrigation
    " משמעותית לבניית תשתיות"        # תשתיות  *** infra-plural vs תשתית sg
    " דיגיטליות ברחבי הארץ."
    " הוועדה לניהול"                  # ניהול   *** management vs ניהוג driving
    " משאבי המדינה דנה באחריות"      # אחריות  *** responsibility vs אחרות others
    " כל משרד ממשלתי."
    " מגמת הצמיחה"                   # מגמת    *** construct-state vs מגמה base
    " השנתית מראה שיפור ניכר"        # צמיחה   *** growth vs צמיגה tire
    " בכלכלה הלאומית."
)

# ─── Trap definitions ─────────────────────────────────────────────────────────
TRAP_WORDS = {
    "מדיניות", "כלכלית", "ביטוח", "פיתוח", "השקעה",
    "תשתיות",  "ניהול",  "אחריות", "מגמת", "צמיחה",
}

COMMON_ERRORS = {
    "מדיניות": "מדינות",
    "כלכלית":  "כלכלה",
    "ביטוח":   "ביטוי",
    "פיתוח":   "פיצוח",
    "השקעה":   "השקיה",
    "תשתיות":  "תשתית",
    "ניהול":   "ניהוג",
    "אחריות":  "אחרות",
    "מגמת":    "מגמה",
    "צמיחה":   "צמיגה",
}

def _normalize(text: str) -> str:
    text = re.sub(r'[.,!?;:\-\"\']', '', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

GROUND_TRUTH_WORDS = _normalize(GROUND_TRUTH).split()

def _strip_he(word: str) -> str:
    """Strip any Hebrew service-letter prefix chain (ב,ל,כ,ו,מ,ש,ה) from a word.
    e.g. לניהול → ניהול, באחריות → אחריות, ולהממשק → ממשק"""
    SERVICE = set('בלכומשה')
    i = 0
    while i < len(word) - 1 and word[i] in SERVICE:
        i += 1
    return word[i:]

# ─── TTS & noise generation ──────────────────────────────────────────────────
async def _tts(text: str, path: Path):
    import edge_tts
    communicate = edge_tts.Communicate(text, voice="he-IL-AvriNeural")
    mp3 = str(path).replace(".wav", ".mp3")
    await communicate.save(mp3)
    import subprocess
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", mp3, "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le", str(path)],
        capture_output=True, timeout=30,
    )
    os.unlink(mp3)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode(errors='replace')[:300])
    print(f"  נקי: {path.name}  {path.stat().st_size//1024} KB")

def _mix_noise(src: Path, dst: Path, db: float):
    import subprocess
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src),
         "-filter_complex",
         f"aevalsrc=random(0)*2-1:s=16000:c=mono[noise];"
         f"[noise]aresample=16000,volume={db}dB[n];"
         f"[0:a][n]amix=inputs=2:duration=first",
         "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", str(dst)],
        capture_output=True, timeout=30,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode(errors='replace')[:300])
    label = {-24: "קל", -18: "בינוני", -12: "כבד"}.get(int(db), str(db))
    print(f"  רעש {label} ({db}dB): {dst.name}  {dst.stat().st_size//1024} KB")

# ─── WER ─────────────────────────────────────────────────────────────────────
def wer(ref: list, hyp: list) -> dict:
    r, h = ref, hyp
    d = [[0]*(len(h)+1) for _ in range(len(r)+1)]
    for i in range(len(r)+1): d[i][0] = i
    for j in range(len(h)+1): d[0][j] = j
    for i in range(1, len(r)+1):
        for j in range(1, len(h)+1):
            d[i][j] = d[i-1][j-1] if r[i-1]==h[j-1] else 1+min(d[i-1][j], d[i][j-1], d[i-1][j-1])
    i, j = len(r), len(h)
    s = ins = d = 0
    i2, j2 = len(r), len(h)
    matrix = [[0]*(len(h)+1) for _ in range(len(r)+1)]
    for x in range(len(r)+1): matrix[x][0] = x
    for y in range(len(h)+1): matrix[0][y] = y
    for x in range(1, len(r)+1):
        for y in range(1, len(h)+1):
            matrix[x][y] = matrix[x-1][y-1] if ref[x-1]==hyp[y-1] else 1+min(matrix[x-1][y], matrix[x][y-1], matrix[x-1][y-1])
    subs = ins = dels = 0
    x, y = len(ref), len(hyp)
    while x > 0 or y > 0:
        if x>0 and y>0 and ref[x-1]==hyp[y-1]:
            x -= 1; y -= 1
        elif x>0 and y>0 and matrix[x][y]==matrix[x-1][y-1]+1:
            subs += 1; x -= 1; y -= 1
        elif y>0 and matrix[x][y]==matrix[x][y-1]+1:
            ins += 1; y -= 1
        else:
            dels += 1; x -= 1
    errors = subs + ins + dels
    return {"wer": round(errors/max(len(ref),1)*100, 1), "sub": subs, "ins": ins, "del": dels}

def trap_score(hyp_words: list) -> dict:
    raw = set(hyp_words)
    stripped = {_strip_he(w) for w in raw}
    combined = raw | stripped
    details = {}
    for trap in TRAP_WORDS:
        trap_bare = _strip_he(trap)
        ok = trap in combined or trap_bare in combined
        wrong = COMMON_ERRORS[trap]
        wrong_found = wrong in combined or _strip_he(wrong) in combined
        details[trap] = {"correct": ok, "wrong": wrong if wrong_found else None}
    n = sum(1 for v in details.values() if v["correct"])
    return {"score": f"{n}/10", "n": n, "details": details}

def diff_str(ref: list, hyp: list) -> str:
    parts = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ref, hyp).get_opcodes():
        if op == "equal":   parts.append(" ".join(ref[i1:i2]))
        elif op == "replace": parts.append(f"[❌{' '.join(ref[i1:i2])}→{' '.join(hyp[j1:j2])}]")
        elif op == "delete":  parts.append(f"[🗑{' '.join(ref[i1:i2])}]")
        elif op == "insert":  parts.append(f"[➕{' '.join(hyp[j1:j2])}]")
    return " ".join(parts)

# ─── Server calls ─────────────────────────────────────────────────────────────
def call_plain(path: Path, beam: int, normalize: bool = True) -> tuple[str, float]:
    with open(path, "rb") as f:
        t0 = time.time()
        r = requests.post(f"{SERVER}/transcribe",
            files={"file": (path.name, f, "audio/wav")},
            data={"language": "he", "normalize": "1" if normalize else "0", "beam_size": str(beam)},
            timeout=180)
    r.raise_for_status()
    return r.json().get("text", ""), time.time() - t0

def call_stream(path: Path, preset: str, normalize: bool = True) -> tuple[str, float]:
    with open(path, "rb") as f:
        t0 = time.time()
        r = requests.post(f"{SERVER}/transcribe-stream",
            files={"file": (path.name, f, "audio/wav")},
            data={"language": "he", "normalize": "1" if normalize else "0", "preset": preset},
            stream=True, timeout=180)
    r.raise_for_status()
    segs = []
    for line in r.iter_lines():
        if line.startswith(b"data: "):
            try:
                obj = json.loads(line[6:])
                if "text" in obj and obj.get("type") != "done": segs.append(obj["text"].strip())
                if obj.get("type") == "done": break
            except: pass
    return " ".join(segs), time.time() - t0

def call_denoise(path: Path, preset: str) -> tuple[str, float]:
    """Call with ai_denoise=1 (SpeechBrain spectral gating before Whisper)."""
    with open(path, "rb") as f:
        t0 = time.time()
        r = requests.post(f"{SERVER}/transcribe",
            files={"file": (path.name, f, "audio/wav")},
            data={"language": "he", "normalize": "1", "beam_size": "5", "ai_denoise": "1"},
            timeout=300)
    r.raise_for_status()
    return r.json().get("text", ""), time.time() - t0

# ─── Test matrix ──────────────────────────────────────────────────────────────
SYSTEMS = [
    # (id,            label,                    fn,          kwargs)
    ("fast",          "fast (stream)",           call_stream, {"preset":"fast"}),
    ("balanced",      "balanced (stream)",       call_stream, {"preset":"balanced"}),
    ("accurate",      "accurate (stream)",       call_stream, {"preset":"accurate"}),
    ("beam3",         "/transcribe beam=3",      call_plain,  {"beam":3}),
    ("beam5",         "/transcribe beam=5",      call_plain,  {"beam":5}),
    ("beam5_nonorm",  "/transcribe beam=5 raw",  call_plain,  {"beam":5, "normalize":False}),
]

NOISE_LEVELS = [
    ("clean",  "נקי",           None),
    ("light",  "רעש קל -24dB",  -24),
    ("medium", "רעש בינ' -18dB",-18),
    ("heavy",  "רעש כבד -12dB", -12),
]

SEP  = "═" * 78
SEP2 = "─" * 78

def run_test(path: Path, sys_id: str, label: str, fn, kwargs: dict, noise_label: str) -> dict:
    full_label = f"{label} [{noise_label}]"
    print(f"  ► {full_label:46s}", end="", flush=True)
    try:
        text, elapsed = fn(path, **kwargs)
        hyp = _normalize(text).split()
        w = wer(GROUND_TRUTH_WORDS, hyp)
        t = trap_score(hyp)
        print(f" ✓  {elapsed:.1f}s | WER={w['wer']}% | trap={t['score']}")
        return {"sys_id": sys_id, "label": full_label, "noise": noise_label, "text": text,
                "hyp": hyp, "elapsed": elapsed, "wer": w, "trap": t}
    except Exception as e:
        print(f" ✗  {e}")
        return {"sys_id": sys_id, "label": full_label, "noise": noise_label, "error": str(e)}

def print_detail(r: dict):
    if r.get("error"):
        print(f"\n  [{r['label']}]  ✗ {r['error']}")
        return
    print(f"\n  ┌─ {r['label']}")
    print(f"  │  {r['elapsed']:.1f}s | WER: {r['wer']['wer']}% "
          f"(sub={r['wer']['sub']} ins={r['wer']['ins']} del={r['wer']['del']}) "
          f"| מלכודות: {r['trap']['score']}")
    print(f"  │  {r['text']}")
    d = diff_str(GROUND_TRUTH_WORDS, r["hyp"])
    if "❌" in d or "🗑" in d:
        print(f"  │  הבדלים: {d}")
    td = r["trap"]["details"]
    wrong = [f"{t}→{v['wrong'] or '?'}" for t,v in td.items() if not v["correct"]]
    right = [t for t,v in td.items() if v["correct"]]
    if wrong: print(f"  │  ❌ שגויות: {', '.join(wrong)}")
    if right:  print(f"  │  ✅ נכונות: {', '.join(right)}")
    print(f"  └{'─'*73}")

def print_heatmap(all_results: list):
    """Print WER heatmap: systems × noise levels."""
    print(f"\n{SEP}")
    print("  📊 HEATMAP — WER% לכל מערכת × רמת רעש")
    print(SEP)

    noise_labels = [n for _, n, _ in NOISE_LEVELS]
    # header
    print(f"  {'מערכת':<34}", end="")
    for nl in noise_labels:
        print(f" {nl[:12]:>14}", end="")
    print()
    print(f"  {'-'*76}")

    sys_ids = [s[0] for s in SYSTEMS]
    sys_labels = {s[0]: s[1] for s in SYSTEMS}

    for sid in sys_ids:
        print(f"  {sys_labels[sid]:<34}", end="")
        for _, nl, _ in NOISE_LEVELS:
            match = [r for r in all_results if r.get("sys_id")==sid and r.get("noise")==nl and not r.get("error")]
            if match:
                w = match[0]["wer"]["wer"]
                t = match[0]["trap"]["n"]
                # Color: 0%=great, 10-20%=ok, >20%=bad
                marker = "🟢" if w == 0 else ("🟡" if w <= 15 else "🔴")
                print(f" {marker}{w:>4}% {t}/10    ", end="")
            else:
                print(f" {'—':>14}", end="")
        print()

def print_leaderboard(all_results: list, noise_label: str):
    valid = [r for r in all_results if r.get("noise")==noise_label and not r.get("error")]
    if not valid:
        return
    valid.sort(key=lambda r: (-r["trap"]["n"], r["wer"]["wer"], r["elapsed"]))
    medals = ["🥇","🥈","🥉","4️⃣ ","5️⃣ ","6️⃣ "]
    print(f"\n  {noise_label}:")
    print(f"  {'':3} {'מערכת':<34} {'WER':>6} {'מלכודות':>9} {'זמן':>7}")
    print(f"  {'-'*60}")
    for i, r in enumerate(valid):
        m = medals[i] if i < len(medals) else "  "
        lbl = r["label"].replace(f" [{noise_label}]", "")
        print(f"  {m} {lbl:<34} {r['wer']['wer']:>5}% {r['trap']['score']:>9} {r['elapsed']:>6.1f}s")

def print_normalize_impact(all_results: list):
    """Show normalized vs raw on heavy noise."""
    print(f"\n{SEP}")
    print("  🔧 השפעת normalize — beam=5, רעש כבד -12dB")
    print(SEP)
    norm_key = "רעש כבד -12dB"
    norm   = next((r for r in all_results if r.get("sys_id")=="beam5" and r.get("noise")==norm_key and not r.get("error")), None)
    raw    = next((r for r in all_results if r.get("sys_id")=="beam5_nonorm" and r.get("noise")==norm_key and not r.get("error")), None)
    if norm and raw:
        delta_wer = norm["wer"]["wer"] - raw["wer"]["wer"]
        delta_trap = norm["trap"]["n"] - raw["trap"]["n"]
        sign = "+" if delta_wer > 0 else ""
        print(f"  עם normalize (highpass+afftdn+loudnorm):  WER={norm['wer']['wer']}%  trap={norm['trap']['score']}")
        print(f"  ללא normalize (ישיר לוויספר):             WER={raw['wer']['wer']}%  trap={raw['trap']['score']}")
        print(f"  ── שינוי: ΔWER={sign}{delta_wer:.1f}%  ΔTrap={'+' if delta_trap>0 else ''}{delta_trap}")

def main():
    quick      = "--quick"      in sys.argv
    keep_audio = "--keep-audio" in sys.argv
    no_denoise = "--no-denoise" in sys.argv

    levels_to_run = NOISE_LEVELS if not quick else [NOISE_LEVELS[0], NOISE_LEVELS[2]]

    print(f"\n{SEP}")
    print("  Hebrew Hard WER Benchmark — שפת עיתון + מלכודות מינימליות")
    print(SEP)
    print(f"\n  Ground truth ({len(GROUND_TRUTH_WORDS)} מילים):")
    print(f"  {GROUND_TRUTH}")
    print(f"\n  מלכודות (10 מינימאל-פייר):")
    for trap, err in COMMON_ERRORS.items():
        confusion = {
            "מדיניות":"י-drop","כלכלית":"סיומת adj→noun","ביטוח":"ח/י","פיתוח":"ת/צ",
            "השקעה":"ע/י","תשתיות":"רבים→יחיד","ניהול":"ל/ג","אחריות":"יו-drop",
            "מגמת":"סמיכות ת→ה","צמיחה":"ח/ג"
        }.get(trap, "")
        print(f"    {trap:12s} → {err:12s}  ({confusion})")

    # ── Build audio ────────────────────────────────────────────────
    print(f"\n{SEP2}\n  שלב 1: יצירת אודיו...")
    Path("tools").mkdir(exist_ok=True)
    if not AUDIO["clean"].exists():
        asyncio.run(_tts(GROUND_TRUTH, AUDIO["clean"]))
    else:
        print(f"  נקי (קיים): {AUDIO['clean'].name}")
    noise_map = {-24: "light", -18: "medium", -12: "heavy"}
    for _, _, db in NOISE_LEVELS:
        if db is not None:
            key = noise_map[db]
            if not AUDIO[key].exists():
                _mix_noise(AUDIO["clean"], AUDIO[key], db)
            else:
                lbl = {-24:"קל",-18:"בינוני",-12:"כבד"}[db]
                print(f"  רעש {lbl} (קיים): {AUDIO[key].name}")

    # ── Run all tests ──────────────────────────────────────────────
    all_results = []
    for audio_key, noise_label, db in levels_to_run:
        path = AUDIO[audio_key]
        print(f"\n{SEP2}\n  שלב 2: תמלול — {noise_label}")
        for sys_id, label, fn, kwargs in SYSTEMS:
            r = run_test(path, sys_id, label, fn, kwargs, noise_label)
            all_results.append(r)

        # ai_denoise test only on heavy noise (slowest, most impactful)
        if db == -12 and not no_denoise:
            print(f"  ► ai_denoise (spectral) [רעש כבד -12dB]       ", end="", flush=True)
            try:
                text, elapsed = call_denoise(path, "accurate")
                hyp = _normalize(text).split()
                w = wer(GROUND_TRUTH_WORDS, hyp)
                t = trap_score(hyp)
                print(f" ✓  {elapsed:.1f}s | WER={w['wer']}% | trap={t['score']}")
                all_results.append({
                    "sys_id": "ai_denoise", "label": f"ai_denoise+beam5 [{noise_label}]",
                    "noise": noise_label, "text": text, "hyp": hyp, "elapsed": elapsed, "wer": w, "trap": t
                })
            except Exception as e:
                print(f" ✗  {e}")

    # ── Detailed results ───────────────────────────────────────────
    for _, noise_label, _ in levels_to_run:
        print(f"\n{SEP}\n  תוצאות מפורטות — {noise_label}\n{SEP}")
        for r in all_results:
            if r.get("noise") == noise_label:
                print_detail(r)

    # ── Heatmap ────────────────────────────────────────────────────
    print_heatmap(all_results)

    # ── Leaderboard per noise level ────────────────────────────────
    print(f"\n{SEP}\n  🏆 LEADERBOARD — לפי רמת רעש\n{SEP}")
    for _, noise_label, _ in levels_to_run:
        print_leaderboard(all_results, noise_label)

    # ── Normalize impact ───────────────────────────────────────────
    if any(r.get("noise") == "רעש כבד -12dB" for r in all_results):
        print_normalize_impact(all_results)

    # ── Summary per trap word ──────────────────────────────────────
    print(f"\n{SEP}\n  🔍 דיוק לכל מילת מלכודת — אודיו נקי בלבד\n{SEP}")
    clean_results = [r for r in all_results if r.get("noise")=="נקי" and not r.get("error")]
    print(f"  {'מלכודת':12s} {'שגיאה נפוצה':12s}", end="")
    for r in clean_results[:5]:
        lbl = r["label"].replace(" [נקי]", "")[:16]
        print(f" {lbl:>16}", end="")
    print()
    print(f"  {'-'*90}")
    for trap in TRAP_WORDS:
        print(f"  {trap:12s} {COMMON_ERRORS[trap]:12s}", end="")
        for r in clean_results[:5]:
            d = r["trap"]["details"].get(trap, {})
            mark = "✅" if d.get("correct") else f"❌{d.get('wrong','?')}"
            print(f" {mark:>16}", end="")
        print()

    print(f"\n  Ground truth: {len(GROUND_TRUTH_WORDS)} מילים | 10 מלכודות מינימאל-פייר")
    print(f"  WER = (sub+ins+del) / מילים × 100")
    print(SEP)

    if not keep_audio:
        for p in AUDIO.values():
            try: p.unlink()
            except: pass

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Re-derive the status of every open finding from the CURRENT code.

The point: a hand-written status table decays. This re-runs the checks so the
summary is GENERATED, never asserted. Run it before quoting any finding.

    python verify_findings.py            # table
    python verify_findings.py --md       # markdown, paste into the report

Exit code = number of findings still OPEN.
"""
import io, json, os, re, subprocess, sys, datetime

REPO = r"C:\Users\jj121\chai-transcribe"
os.chdir(REPO)
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def read(path):
    try:
        return io.open(os.path.join(REPO, path), encoding="utf-8", errors="replace").read()
    except OSError:
        return None


def jload(path):
    t = read(path)
    try:
        return json.loads(t) if t else None
    except json.JSONDecodeError:
        return None


# Each check returns (state, detail).
# state: OPEN | FIXED | GONE (file vanished — the check itself is stale)

def c_hotword_order():
    s = read("server/transcribe_server.py")
    if not s:
        return "GONE", "transcribe_server.py missing"
    m = re.search(r"sources = \[\](.{0,600}?)if sources:", s, re.S)
    if not m:
        return "GONE", "_resolve_prompt_and_hotwords shape changed"
    blk = m.group(1)
    pos = {n: blk.find(n) for n in ("user_hotwords", "HEBREW_DEFAULT_HOTWORDS", "LOSHON_KODESH_HOTWORDS")}
    if -1 in pos.values():
        return "GONE", "one of the three sources no longer appended"
    order = sorted(pos, key=pos.get)
    lk_last = order[-1] == "LOSHON_KODESH_HOTWORDS"
    heb_before_lk = pos["HEBREW_DEFAULT_HOTWORDS"] < pos["LOSHON_KODESH_HOTWORDS"]
    if lk_last and heb_before_lk:
        return "OPEN", "append order: " + " -> ".join(o.replace("_HOTWORDS", "") for o in order)
    return "FIXED", "append order: " + " -> ".join(o.replace("_HOTWORDS", "") for o in order)


def c_trace_hotwords():
    s = read("src/lib/transcriptionPipeline.ts")
    if not s:
        return "GONE", "transcriptionPipeline.ts missing"
    cnt = len(re.findall(r"hotwords_?[Cc]ount", s))
    has_list = bool(re.search(r"\bhotwords:\s*hotwords\b|hotwordsHash|hotwordsList|configHash", s))
    if has_list:
        return "FIXED", f"list/hash present ({cnt} count refs remain)"
    return "OPEN", f"{cnt} count-only refs, no list and no hash"


def c_server_echo():
    s = read("server/transcribe_server.py")
    if not s:
        return "GONE", "transcribe_server.py missing"
    if re.search(r"effective_hotwords|effective_prompt|hotwords_dropped|dropped_count", s):
        return "FIXED", "server echoes effective decode config"
    return "OPEN", "no effective_hotwords / dropped_count in any response"


def c_degenerate():
    s = read("server/transcript_quality.py")
    if not s:
        return "GONE", "transcript_quality.py missing"
    m = re.search(r"len\(tokens\)\s*<\s*(\d+)", s)
    if not m:
        return "FIXED", "no short-output early return"
    return "OPEN", f"early return when tokens < {m.group(1)} (22-token degenerate output passes)"


def c_masking():
    """Masking must protect the EDITED OCCURRENCE, not every literal match.

    Do not loosen this to 'does the word offset appear somewhere in the file' —
    that reported FIXED while replaceLiteralDetailed was still masking by value.
    Scope the check to the function body.
    """
    s = read("src/lib/transcriptionKnowledge.ts")
    if not s:
        return "GONE", "transcriptionKnowledge.ts missing"
    # Slice to the NEXT top-level declaration, not the first nested `}` —
    # stopping at an inner brace truncated the body and hid the value-mask.
    m = re.search(r"function protectLearnedOutputs\(", s)
    if not m:
        return "GONE", "protectLearnedOutputs no longer defined"
    rest = s[m.end():]
    nxt = re.search(r"\n(?:export |function |const |async function )", rest)
    body = rest[:nxt.start()] if nxt else rest[:2500]
    # any whole-text literal replace keyed on the corrected VALUE
    by_value = re.search(r"replaceLiteralDetailed\(\s*protectedText\s*,\s*corrected|"
                         r"\.split\(\s*corrected\s*\)\.join\(|"
                         r"replaceAll\(\s*corrected", body)
    by_occurrence = re.search(r"\b(start|end|index|offset|range)\b\s*[,:)]", body)
    if by_value:
        return "OPEN", "masks by VALUE — every literal match of the corrected string"
    if by_occurrence:
        return "FIXED", "masks by occurrence/offset"
    return "OPEN", "no value-mask found, but no occurrence logic either — inspect manually"


def c_word_boundary():
    s = read("src/lib/loshonKodesh.ts")
    if not s:
        return "GONE", "loshonKodesh.ts missing"
    m = re.search(r"\(\?<!\[([^\]]*)\]\)(.{0,80}?)\(\?!\[([^\]]*)\]\)", s, re.S)
    if not m:
        return "GONE", "boundary regex shape changed"
    before, after = m.group(1), m.group(3)
    heb = "05D0" in before or "\u05d0" in before
    heb_after = "05D0" in after or "\u05d0" in after
    if heb and not heb_after:
        return "OPEN", "lookbehind excludes Hebrew, lookahead does not (asymmetric)"
    return "FIXED", "boundary symmetric"


def c_patch_validation():
    s = read("server/transcribe_server.py")
    if not s:
        return "GONE", "transcribe_server.py missing"
    m = re.search(r"@app\.(?:route|patch)\([^\)]*lk/rules[^\)]*\).{0,2500}?(?=@app\.)", s, re.S)
    if not m:
        return "GONE", "PATCH /lk/rules route not found"
    blk = m.group(0)
    if re.search(r"re\.compile|_validate_regex|validate_pattern", blk):
        return "FIXED", "PATCH validates the regex"
    return "OPEN", "PATCH /lk/rules accepts a pattern without compiling it"


def c_changerate():
    s = read("tools/asr_eval/compare_torah_lexicon.ts")
    if not s:
        return "GONE", "compare_torah_lexicon.ts missing"
    blind = "referenceAvailable: false" in s or "referenceAvailable:false" in s
    has_wer = re.search(r"\bwer\b", s, re.I) is not None
    if blind and not has_wer:
        return "OPEN", "hardcodes referenceAvailable:false and scores only changeRate"
    if blind:
        return "OPEN", "still reference-blind, though wer appears in the file"
    return "FIXED", "reference-based scoring present"


def c_main_path_lk():
    """Bias must actually be SENT, not merely toggled.

    Counting bare `customVocabulary` mentions reported FIXED off an import,
    a useState and a checkbox. Only count real transmission.
    """
    s = read("src/pages/Index.tsx")
    if not s:
        return "GONE", "Index.tsx missing"
    sends = len(re.findall(
        r"(?:formData|fd|form|body|payload)\.append\(\s*['\"](?:hotwords|prompt|initial_prompt)['\"]", s))
    passed = len(re.findall(r"customVocabulary\s*:", s))          # passed into a request object
    toggles = len(re.findall(r"customVocabulary", s)) - passed
    if sends or passed:
        return "FIXED", f"{sends} bias appends, {passed} customVocabulary passed"
    return "OPEN", f"no bias transmitted ({toggles} customVocabulary refs are UI/import only)"


def c_detected_language():
    s = read("src/lib/transcriptionPipeline.ts")
    if not s:
        return "GONE", "transcriptionPipeline.ts missing"
    if re.search(r"detected_?[Ll]anguage", s):
        return "FIXED", "detected language recorded"
    return "OPEN", "trace records requested language only, never what was detected"


def c_gold_atomic():
    s = read("src/pages/TranscriptionLab.tsx")
    if not s:
        return "GONE", "TranscriptionLab.tsx missing"
    if re.search(r"gold_approval_id|goldApprovalId", s):
        return "FIXED", "canonical gold approval id present"
    return "OPEN", "cloud save and local clip write are not one atomic operation"


def c_dead_pages():
    app = read("src/App.tsx")
    if not app:
        return "GONE", "App.tsx missing"
    dead = []
    pdir = os.path.join(REPO, "src", "pages")
    for f in sorted(os.listdir(pdir)):
        if not f.endswith(".tsx"):
            continue
        name = f[:-4]
        if name in app:
            continue
        # a component living in pages/ but mounted elsewhere is not dead
        hits = subprocess.run(["git", "grep", "-l", name, "--", "src"],
                              capture_output=True, text=True, encoding="utf-8", errors="replace")
        others = [p for p in hits.stdout.split() if not p.endswith(f"pages/{f}")]
        if not others:
            n = sum(1 for _ in io.open(os.path.join(pdir, f), encoding="utf-8", errors="replace"))
            dead.append(f"{name} ({n}L)")
    if not dead:
        return "FIXED", "every page is routed or mounted"
    return "OPEN", "unreachable: " + ", ".join(dead)


def c_dataset_gate(ds):
    def check():
        m = jload(f"server/lora_runs/datasets/{ds}/dataset_meta.json")
        if not m:
            return "GONE", f"{ds} has no dataset_meta.json"
        ready = m.get("ready_for_training")
        q = m.get("quality_counts") or {}
        state = "FIXED" if ready is False else "OPEN"
        return state, (f"ready={ready}, n={m.get('count')}, gold={q.get('gold', 0)}, "
                       f"groups={m.get('recording_groups')}")
    return check


def c_lk_rules():
    s = read("src/lib/loshonKodesh.ts")
    if not s:
        return "GONE", "loshonKodesh.ts missing"
    n = len(re.findall(r"^\s*\{\s*from:", s, re.M))
    return "INFO", f"{n} replacement rules defined"


CHECKS = [
    ("hotword ordering puts LK last",            "P0", c_hotword_order),
    ("trace stores hotword count, not the list", "P0", c_trace_hotwords),
    ("server never echoes effective config",     "P0", c_server_echo),
    ("trace omits detected_language",            "P1", c_detected_language),
    ("short degenerate output not caught",       "P1", c_degenerate),
    ("learned-correction masking is by value",   "P1", c_masking),
    ("LK word boundary asymmetric",              "P1", c_word_boundary),
    ("main screen sends no decode bias",         "P1", c_main_path_lk),
    ("PATCH /lk/rules skips regex validation",   "P2", c_patch_validation),
    ("changeRate used as a quality score",       "P2", c_changerate),
    ("Gold write is not atomic",                 "P2", c_gold_atomic),
    ("unreachable pages still in tree",          "P2", c_dead_pages),
    ("psalm-chant blocked by gate",              "--", c_dataset_gate("psalm-chant-ashkenazi")),
    ("approved-ground-truth blocked by gate",    "--", c_dataset_gate("approved-ground-truth")),
    ("LK replacement rule count",                "--", c_lk_rules),
]

head = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                      capture_output=True, text=True).stdout.strip()
dirty = subprocess.run(["git", "status", "--porcelain"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
ndirty = len([l for l in dirty.stdout.splitlines() if l and not l.startswith("??")])
stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

rows = []
for name, pri, fn in CHECKS:
    try:
        state, detail = fn()
    except Exception as exc:
        state, detail = "ERROR", f"{type(exc).__name__}: {exc}"
    rows.append((state, pri, name, detail))

md = "--md" in sys.argv
icon = {"OPEN": "🔴", "FIXED": "🟢", "GONE": "⚪", "INFO": "ℹ️", "ERROR": "⚠️"}

if md:
    print(f"<!-- generated {stamp} by verify_findings.py -->")
    print(f"**נבדק:** {stamp} · HEAD `{head}` · {ndirty} קבצים משתנים\n")
    print("| | עדיפות | ממצא | מצב בקוד |")
    print("|---|---|---|---|")
    for s, p, n, d in rows:
        print(f"| {icon[s]} | {p} | {n} | {d} |")
else:
    print(f"verify_findings.py   {stamp}   HEAD {head}   dirty={ndirty}\n")
    for s, p, n, d in rows:
        print(f"  {icon.get(s,'?')} {s:<5} {p:<3} {n:<42} {d}")

n_open = sum(1 for s, *_ in rows if s == "OPEN")
n_gone = sum(1 for s, *_ in rows if s == "GONE")
print(f"\n{'<!-- ' if md else ''}open={n_open}  fixed={sum(1 for s,*_ in rows if s=='FIXED')}  "
      f"stale-check={n_gone}{' -->' if md else ''}")
if n_gone:
    print(("<!-- " if md else "") + f"{n_gone} check(s) no longer match the code — "
          f"update the predicate before trusting this table" + (" -->" if md else ""))
sys.exit(n_open)

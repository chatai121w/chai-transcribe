#!/usr/bin/env python3
"""
smart_compare.py — כלי השוואת תמלול חכם לעברית
================================================

Usage:
  python tools/smart_compare.py recording.wav
  python tools/smart_compare.py --record [--dur 30]
  python tools/smart_compare.py --history [--n 20]
"""

import argparse
import array
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
import tempfile
import time
import wave
import webbrowser
from datetime import datetime
from pathlib import Path

import requests

# ── Configuration ─────────────────────────────────────────────────────────────
SERVER = "http://localhost:3000"
DB_PATH = Path(__file__).parent / "transcription_feedback.db"
REPORT_DIR = Path(__file__).parent / "reports"
SUPABASE_PROJECT = "wunvdxfnmamnyiyuvlul"
SUPABASE_PAT = "sbp_v0_7d035602aaa48c59cc245948fd58d86872199690"
SUPABASE_QUERY_URL = (
    f"https://api.supabase.com/v1/projects/{SUPABASE_PROJECT}/database/query"
)

# ── 12 test systems (id, label, type, preset_or_beam, normalize, ai_denoise) ──
SYSTEMS = [
    ("fast_n",   "⚡ Fast · norm",         "stream",     "fast",     True,  False),
    ("fast_r",   "⚡ Fast · raw",          "stream",     "fast",     False, False),
    ("bal_n",    "⚖ Balanced · norm",     "stream",     "balanced", True,  False),
    ("bal_r",    "⚖ Balanced · raw",      "stream",     "balanced", False, False),
    ("acc_n",    "🎯 Accurate · norm",     "stream",     "accurate", True,  False),
    ("acc_r",    "🎯 Accurate · raw",      "stream",     "accurate", False, False),
    ("b3_n",     "B3 · norm",             "transcribe", 3,          True,  False),
    ("b3_r",     "B3 · raw",              "transcribe", 3,          False, False),
    ("b5_n",     "B5 · norm",             "transcribe", 5,          True,  False),
    ("b5_r",     "B5 · raw",              "transcribe", 5,          False, False),
    ("b5_dn",    "B5 + denoise · norm",   "transcribe", 5,          True,  True),
    ("b5_dr",    "B5 + denoise · raw",    "transcribe", 5,          False, True),
]
SYS_BY_ID = {s[0]: s for s in SYSTEMS}


# ══════════════════════════════════════════════════════════════════════════════
#  AUDIO ANALYSIS
# ══════════════════════════════════════════════════════════════════════════════

def analyze_audio(path: str) -> dict:
    """Return rich audio metadata + quality metrics."""
    info = {
        "path": path,
        "filename": Path(path).name,
        "duration_s": 0.0,
        "channels": 0,
        "sample_rate": 0,
        "bit_depth": 0,
        "dynamic_range_db": 25.0,
        "snr_estimate_db": 40.0,
        "noise_rms": 0.0,
        "peak_db": 0.0,
        "rms_db": -20.0,
        "clipping_count": 0,
        "is_stereo": False,
        "noise_level_label": "נקי",
    }

    try:
        with wave.open(path, "rb") as wf:
            info["channels"] = wf.getnchannels()
            info["sample_rate"] = wf.getframerate()
            info["bit_depth"] = wf.getsampwidth() * 8
            info["is_stereo"] = wf.getnchannels() > 1
            n_frames = wf.getnframes()
            info["duration_s"] = n_frames / wf.getframerate()

            if wf.getsampwidth() == 2:
                raw = wf.readframes(n_frames)
                samples = array.array("h", raw)
                # mix to mono if stereo
                if info["channels"] == 2:
                    mono = [int((samples[i] + samples[i + 1]) / 2)
                            for i in range(0, len(samples) - 1, 2)]
                else:
                    mono = list(samples)

                if mono:
                    sq_sum = sum(s * s for s in mono)
                    rms = math.sqrt(sq_sum / len(mono))
                    peak = max(abs(s) for s in mono)
                    clip_thresh = 32600
                    info["clipping_count"] = sum(1 for s in mono if abs(s) >= clip_thresh)

                    if rms > 1:
                        info["rms_db"] = 20 * math.log10(rms / 32768)
                    if peak > 1:
                        info["peak_db"] = 20 * math.log10(peak / 32768)
                        info["dynamic_range_db"] = max(0.0, info["peak_db"] - info["rms_db"])

                    # Estimate noise floor from quietest 10% of 100ms frames
                    frame_size = max(1, info["sample_rate"] // 10)
                    frames = [mono[i:i + frame_size]
                              for i in range(0, len(mono), frame_size) if len(mono[i:i + frame_size]) == frame_size]
                    frame_rms = sorted(
                        math.sqrt(sum(s * s for s in fr) / len(fr))
                        for fr in frames if fr
                    )
                    if frame_rms:
                        noise_floor = sum(frame_rms[:max(1, len(frame_rms) // 10)]) / max(1, len(frame_rms) // 10)
                        signal_rms = sum(frame_rms[len(frame_rms) // 2:]) / max(1, len(frame_rms) // 2)
                        if noise_floor > 1 and signal_rms > noise_floor:
                            info["snr_estimate_db"] = 20 * math.log10(signal_rms / noise_floor)
                            info["noise_rms"] = noise_floor / 32768
    except Exception as e:
        print(f"  [ניתוח אודיו] שגיאה: {e}")

    # Classify noise level
    dr = info["dynamic_range_db"]
    if dr >= 16:
        info["noise_level_label"] = "נקי"
    elif dr >= 15:
        info["noise_level_label"] = "רעש קל"
    elif dr >= 14:
        info["noise_level_label"] = "רעש בינוני"
    else:
        info["noise_level_label"] = "רעש כבד"

    return info


# ══════════════════════════════════════════════════════════════════════════════
#  TRANSCRIPTION CALLERS
# ══════════════════════════════════════════════════════════════════════════════

def _call_stream(path: str, preset: str, normalize: bool) -> tuple[str, float]:
    with open(path, "rb") as f:
        t0 = time.time()
        r = requests.post(
            f"{SERVER}/transcribe-stream",
            files={"file": (Path(path).name, f, "audio/wav")},
            data={"language": "he",
                  "normalize": "1" if normalize else "0",
                  "preset": preset},
            stream=True, timeout=180,
        )
    r.raise_for_status()
    segs = []
    for line in r.iter_lines():
        if line.startswith(b"data: "):
            try:
                obj = json.loads(line[6:])
                if "text" in obj and obj.get("type") != "done":
                    segs.append(obj["text"].strip())
                if obj.get("type") == "done":
                    break
            except Exception:
                pass
    return " ".join(segs), time.time() - t0


def _call_transcribe(path: str, beam: int, normalize: bool, ai_denoise: bool) -> tuple[str, float]:
    with open(path, "rb") as f:
        t0 = time.time()
        r = requests.post(
            f"{SERVER}/transcribe",
            files={"file": (Path(path).name, f, "audio/wav")},
            data={"language": "he",
                  "normalize": "1" if normalize else "0",
                  "beam_size": str(beam),
                  "ai_denoise": "1" if ai_denoise else "0"},
            timeout=300,
        )
    r.raise_for_status()
    return r.json().get("text", ""), time.time() - t0


def run_all_systems(audio_path: str, audio_info: dict) -> list[dict]:
    """Run all 12 systems and return results list."""
    results = []
    print(f"\n  {'מערכת':<28} {'תוצאה':>6}  {'זמן':>5}")
    print(f"  {'─'*28} {'─'*6}  {'─'*5}")

    # Warn about potentially problematic combinations
    dr = audio_info["dynamic_range_db"]
    if dr < 14:
        print(f"\n  ⚠  Dynamic range נמוך ({dr:.1f}dB) — מצבים עם normalize עלולים להיפגע\n")

    for sid, label, stype, preset_or_beam, normalize, ai_denoise in SYSTEMS:
        try:
            if stype == "stream":
                text, elapsed = _call_stream(audio_path, preset_or_beam, normalize)
            else:
                text, elapsed = _call_transcribe(audio_path, preset_or_beam, normalize, ai_denoise)

            status = "✓"
            error = None
        except Exception as e:
            text, elapsed, status, error = "", 0.0, "✗", str(e)

        # Quick word count
        word_count = len(text.split()) if text else 0
        print(f"  {label:<28} {status}  {elapsed:>4.1f}s  {word_count} מילים")

        results.append({
            "id": sid,
            "label": label,
            "type": stype,
            "preset_or_beam": str(preset_or_beam),
            "normalize": normalize,
            "ai_denoise": ai_denoise,
            "text": text,
            "elapsed_s": round(elapsed, 2),
            "word_count": word_count,
            "error": error,
        })

    return results


# ══════════════════════════════════════════════════════════════════════════════
#  DATABASE  (SQLite primary + Supabase sync)
# ══════════════════════════════════════════════════════════════════════════════

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       TEXT UNIQUE,
    created_at       TEXT,
    audio_hash       TEXT,
    audio_filename   TEXT,
    duration_s       REAL,
    channels         INTEGER,
    sample_rate      INTEGER,
    dynamic_range_db REAL,
    snr_estimate_db  REAL,
    noise_rms        REAL,
    noise_level      TEXT,
    results_json     TEXT,
    recommended_id   TEXT,
    user_chosen_id   TEXT,
    user_notes       TEXT
);
"""


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(SCHEMA)
    conn.commit()
    conn.close()


def save_session(session: dict):
    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """INSERT OR REPLACE INTO sessions
           (session_id, created_at, audio_hash, audio_filename,
            duration_s, channels, sample_rate, dynamic_range_db,
            snr_estimate_db, noise_rms, noise_level,
            results_json, recommended_id, user_chosen_id, user_notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            session["session_id"],
            session["created_at"],
            session["audio_hash"],
            session["audio_filename"],
            session["duration_s"],
            session["channels"],
            session["sample_rate"],
            session["dynamic_range_db"],
            session["snr_estimate_db"],
            session["noise_rms"],
            session["noise_level"],
            json.dumps(session["results"], ensure_ascii=False),
            session["recommended_id"],
            session.get("user_chosen_id"),
            session.get("user_notes"),
        ),
    )
    conn.commit()
    conn.close()


def load_sessions(n: int = 200) -> list[dict]:
    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?", (n,)
    ).fetchall()
    conn.close()
    sessions = []
    for row in rows:
        d = dict(row)
        d["results"] = json.loads(d["results_json"] or "[]")
        sessions.append(d)
    return sessions


def supabase_sync(session: dict) -> bool:
    """Sync session to Supabase via management API. Returns True on success."""
    sql = """
    CREATE TABLE IF NOT EXISTS transcription_sessions (
        session_id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ,
        audio_filename TEXT,
        duration_s REAL,
        channels INTEGER,
        sample_rate INTEGER,
        dynamic_range_db REAL,
        snr_estimate_db REAL,
        noise_level TEXT,
        recommended_id TEXT,
        user_chosen_id TEXT,
        user_notes TEXT,
        results_json TEXT
    );
    INSERT INTO transcription_sessions
    (session_id, created_at, audio_filename, duration_s, channels, sample_rate,
     dynamic_range_db, snr_estimate_db, noise_level, recommended_id,
     user_chosen_id, user_notes, results_json)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (session_id) DO UPDATE SET
        user_chosen_id = EXCLUDED.user_chosen_id,
        user_notes     = EXCLUDED.user_notes;
    """
    try:
        r = requests.post(
            SUPABASE_QUERY_URL,
            headers={"Authorization": f"Bearer {SUPABASE_PAT}",
                     "Content-Type": "application/json"},
            json={"query": sql, "params": [
                session["session_id"],
                session["created_at"],
                session["audio_filename"],
                session["duration_s"],
                session["channels"],
                session["sample_rate"],
                session["dynamic_range_db"],
                session["snr_estimate_db"],
                session["noise_level"],
                session["recommended_id"],
                session.get("user_chosen_id"),
                session.get("user_notes"),
                json.dumps(session["results"], ensure_ascii=False),
            ]},
            timeout=15,
        )
        return r.status_code < 300
    except Exception:
        return False


# ══════════════════════════════════════════════════════════════════════════════
#  k-NN RECOMMENDER
# ══════════════════════════════════════════════════════════════════════════════

# Rule-based baseline (from benchmark data):
# dynamic_range >= 16 → fast_n best (clean audio)
# dynamic_range 14-16 → bal_n or b5_n (light noise)
# dynamic_range < 14  → fast_r / bal_r (skip afftdn)
RULE_TABLE = [
    (16.0, "fast_n"),
    (15.0, "bal_n"),
    (14.0, "b5_n"),
    (0.0,  "fast_r"),
]


def _feature_vec(dynamic_range: float, snr_db: float, duration_s: float) -> list[float]:
    """Normalized feature vector for k-NN distance calculation."""
    return [
        min(1.0, dynamic_range / 30.0),          # 0–1, higher = cleaner
        min(1.0, snr_db / 40.0),                 # 0–1, higher = less noise
        min(1.0, math.log1p(duration_s) / 6.0),  # 0–1 (log scale, ~400s → 1)
    ]


def _euclidean(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def recommend(audio_info: dict, past_sessions: list[dict]) -> tuple[str, str, float]:
    """
    Returns (system_id, explanation, confidence).
    Uses k-NN (k=5) when enough labeled data exists, else rule-based.
    """
    dr = audio_info["dynamic_range_db"]
    snr = audio_info["snr_estimate_db"]
    dur = audio_info["duration_s"]

    # Filter past sessions that have user feedback
    labeled = [s for s in past_sessions if s.get("user_chosen_id")]

    # k-NN: need at least 3 labeled examples
    K = 5
    if len(labeled) >= 3:
        vec = _feature_vec(dr, snr, dur)
        neighbors = []
        for s in labeled:
            s_vec = _feature_vec(
                s.get("dynamic_range_db", 20),
                s.get("snr_estimate_db", 30),
                s.get("duration_s", 30),
            )
            dist = _euclidean(vec, s_vec)
            neighbors.append((dist, s["user_chosen_id"]))

        neighbors.sort(key=lambda x: x[0])
        top_k = neighbors[:K]
        # Weighted vote (1/dist weight, guard div-by-zero)
        votes: dict[str, float] = {}
        for dist, chosen in top_k:
            w = 1.0 / (dist + 0.01)
            votes[chosen] = votes.get(chosen, 0) + w

        best_id = max(votes, key=lambda k: votes[k])
        total_weight = sum(votes.values())
        confidence = votes[best_id] / total_weight if total_weight else 0.0

        # Reject k-NN if confidence is low, fall through to rules
        if confidence >= 0.5 and best_id in SYS_BY_ID:
            label = SYS_BY_ID[best_id][1]
            return (
                best_id,
                f"k-NN ({len(labeled)} דוגמאות) → {label} "
                f"(ביטחון {confidence:.0%})",
                confidence,
            )

    # Rule-based fallback
    for threshold, sys_id in RULE_TABLE:
        if dr >= threshold:
            label = SYS_BY_ID[sys_id][1]
            reason = (
                f"חוקים (dynamic range={dr:.1f}dB, "
                f"{'נקי' if dr >= 16 else 'רעש קל' if dr >= 15 else 'רעש בינוני' if dr >= 14 else 'רעש כבד'})"
            )
            return sys_id, reason, 0.6

    return "fast_r", "ברירת מחדל (רעש גבוה מאוד)", 0.4


# ══════════════════════════════════════════════════════════════════════════════
#  HTML REPORT
# ══════════════════════════════════════════════════════════════════════════════

def _noise_bar(noise_rms: float) -> str:
    """Visual noise bar (5 segments)."""
    level = min(5, int(noise_rms * 100))
    filled = "█" * level
    empty = "░" * (5 - level)
    return filled + empty


def _esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def generate_html_report(
    audio_info: dict,
    results: list[dict],
    recommended_id: str,
    rec_reason: str,
    session_id: str,
) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = REPORT_DIR / f"report_{session_id}.html"

    # Build results cards HTML
    cards_html = ""
    for i, r in enumerate(results, 1):
        is_rec = r["id"] == recommended_id
        border = "#2ecc71" if is_rec else "#ddd"
        bg = "#f0fff4" if is_rec else "#fff"
        badge = '<span style="background:#2ecc71;color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;margin-right:6px">✨ מומלץ</span>' if is_rec else ""
        norm_badge = (
            '<span style="background:#3498db;color:#fff;padding:1px 6px;border-radius:8px;font-size:11px">norm</span>'
            if r["normalize"] else
            '<span style="background:#95a5a6;color:#fff;padding:1px 6px;border-radius:8px;font-size:11px">raw</span>'
        )
        denoise_badge = (
            '<span style="background:#9b59b6;color:#fff;padding:1px 6px;border-radius:8px;font-size:11px">denoise</span>'
            if r["ai_denoise"] else ""
        )
        text_esc = _esc(r["text"]) if r["text"] else '<span style="color:#aaa">— אין תוצאה —</span>'
        cards_html += f"""
        <div style="border:2px solid {border};border-radius:10px;padding:16px;background:{bg};margin-bottom:14px" id="sys-{i}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div>
              {badge}
              <strong style="font-size:15px">{i}. {_esc(r['label'])}</strong>
              &nbsp;{norm_badge}{denoise_badge}
            </div>
            <div style="color:#888;font-size:13px">⏱ {r['elapsed_s']:.1f}s &nbsp; 📝 {r['word_count']} מילים</div>
          </div>
          <div dir="rtl" style="font-size:15px;line-height:1.7;color:#222;background:#fafafa;padding:10px;border-radius:6px;border-right:3px solid {border}">
            {text_esc}
          </div>
        </div>"""

    # Duration formatting
    dur = audio_info["duration_s"]
    dur_str = f"{int(dur // 60)}:{int(dur % 60):02d}"

    # Noise level color
    noise_color = {"נקי": "#2ecc71", "רעש קל": "#f39c12",
                   "רעש בינוני": "#e67e22", "רעש כבד": "#e74c3c"}.get(
        audio_info["noise_level_label"], "#888")

    html = f"""<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>דוח תמלול — {_esc(audio_info['filename'])}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0;
         background: #f5f7fa; color: #222; direction: rtl; }}
  .header {{ background: linear-gradient(135deg,#1a1a2e,#16213e);
             color: #fff; padding: 28px 40px; }}
  .header h1 {{ margin: 0 0 6px; font-size: 22px; }}
  .header .sub {{ color: #aaa; font-size: 13px; }}
  .container {{ max-width: 960px; margin: 0 auto; padding: 30px 20px; }}
  .panel {{ background: #fff; border-radius: 12px; padding: 20px 24px;
            box-shadow: 0 2px 12px rgba(0,0,0,.08); margin-bottom: 24px; }}
  .panel h2 {{ margin: 0 0 16px; font-size: 16px; color: #555;
               border-bottom: 2px solid #f0f0f0; padding-bottom: 8px; }}
  .info-grid {{ display: grid; grid-template-columns: repeat(auto-fit,minmax(160px,1fr));
                gap: 12px; }}
  .info-cell {{ background: #f8f9fa; border-radius: 8px; padding: 12px;
                text-align: center; }}
  .info-cell .val {{ font-size: 22px; font-weight: bold; color: #2c3e50; }}
  .info-cell .lbl {{ font-size: 12px; color: #888; margin-top: 2px; }}
  .rec-box {{ background: linear-gradient(135deg,#0f3460,#16213e);
              color: #fff; border-radius: 12px; padding: 20px 24px;
              margin-bottom: 24px; }}
  .rec-box h2 {{ margin: 0 0 8px; font-size: 16px; color: #a0c4ff; }}
  .rec-box .rec-name {{ font-size: 22px; font-weight: bold; }}
  .rec-box .rec-reason {{ color: #ccc; font-size: 13px; margin-top: 6px; }}
  .feedback {{ background: #fff; border-radius: 12px; padding: 20px 24px;
               box-shadow: 0 2px 12px rgba(0,0,0,.08); margin-bottom: 24px;
               border-right: 4px solid #3498db; }}
  .badge {{ display:inline-block; background:#e8f4fd; color:#2980b9;
            border-radius:6px; padding:2px 8px; font-size:12px; margin:2px; }}
  @media(max-width:600px) {{ .container {{ padding:16px 10px; }} }}
</style>
</head>
<body>

<div class="header">
  <h1>🎙 דוח השוואת תמלול</h1>
  <div class="sub">
    {_esc(audio_info['filename'])} &nbsp;·&nbsp;
    {datetime.now().strftime('%d/%m/%Y %H:%M')} &nbsp;·&nbsp;
    Session: {session_id[:8]}
  </div>
</div>

<div class="container">

  <!-- Audio Analysis -->
  <div class="panel">
    <h2>🔍 ניתוח הקלטה</h2>
    <div class="info-grid">
      <div class="info-cell">
        <div class="val">{dur_str}</div>
        <div class="lbl">משך</div>
      </div>
      <div class="info-cell">
        <div class="val">{'סטריאו' if audio_info['is_stereo'] else 'מונו'}</div>
        <div class="lbl">ערוצים</div>
      </div>
      <div class="info-cell">
        <div class="val">{audio_info['sample_rate'] // 1000}kHz</div>
        <div class="lbl">קצב דגימה</div>
      </div>
      <div class="info-cell">
        <div class="val">{audio_info['bit_depth']}bit</div>
        <div class="lbl">עומק סיביות</div>
      </div>
      <div class="info-cell">
        <div class="val">{audio_info['dynamic_range_db']:.1f}dB</div>
        <div class="lbl">טווח דינמי</div>
      </div>
      <div class="info-cell">
        <div class="val">{audio_info['snr_estimate_db']:.1f}dB</div>
        <div class="lbl">יחס אות/רעש (SNR)</div>
      </div>
      <div class="info-cell">
        <div class="val" style="color:{noise_color}">{audio_info['noise_level_label']}</div>
        <div class="lbl">רמת רעש</div>
      </div>
      <div class="info-cell">
        <div class="val" style="color:{'#e74c3c' if audio_info['clipping_count'] > 50 else '#2ecc71'}">
          {'⚠ קליפינג' if audio_info['clipping_count'] > 50 else '✓ תקין'}
        </div>
        <div class="lbl">רמת שיא ({audio_info['peak_db']:.1f}dB)</div>
      </div>
    </div>
  </div>

  <!-- Recommendation -->
  <div class="rec-box">
    <h2>💡 המלצת המערכת</h2>
    <div class="rec-name">{_esc(SYS_BY_ID[recommended_id][1]) if recommended_id in SYS_BY_ID else recommended_id}</div>
    <div class="rec-reason">{_esc(rec_reason)}</div>
  </div>

  <!-- Feedback note -->
  <div class="feedback">
    <strong>📋 משוב</strong> — לאחר עיון בתוצאות, חזור לחלון הטרמינל ובחר את המספר של התמלול הטוב ביותר.
    המשוב שלך ישפר את ההמלצות העתידיות.
  </div>

  <!-- Results -->
  <div class="panel">
    <h2>📊 תוצאות 12 המערכות</h2>
    {cards_html}
  </div>

</div>

<script>
  // Highlight anchor on click
  document.querySelectorAll('[id^=sys-]').forEach(el => {{
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {{
      document.querySelectorAll('[id^=sys-]').forEach(e => e.style.outline = '');
      el.style.outline = '3px solid #3498db';
    }});
  }});
</script>
</body>
</html>"""

    out_path.write_text(html, encoding="utf-8")
    return out_path


# ══════════════════════════════════════════════════════════════════════════════
#  LIVE RECORDING
# ══════════════════════════════════════════════════════════════════════════════

def record_audio(duration: int = 30) -> str:
    """Record from microphone. Returns path to .wav file."""
    try:
        import sounddevice as sd  # type: ignore
        import numpy as np
    except ImportError:
        print("  ⚠  sounddevice לא מותקן. מתקין...")
        os.system(f"{sys.executable} -m pip install sounddevice numpy -q")
        import sounddevice as sd
        import numpy as np

    RATE = 16000
    print(f"\n  🎙  מקליט {duration} שניות... (לחץ Ctrl+C להפסקה מוקדמת)\n")
    try:
        audio = sd.rec(int(duration * RATE), samplerate=RATE,
                       channels=1, dtype="int16")
        for i in range(duration):
            remaining = duration - i
            print(f"\r  ⏺  {remaining:3d}s נותרו...", end="", flush=True)
            time.sleep(1)
        sd.wait()
        print("\r  ✓  הקלטה הסתיימה              ")
    except KeyboardInterrupt:
        sd.stop()
        print("\r  ✓  הקלטה הופסקה              ")

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    with wave.open(tmp.name, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(RATE)
        wf.writeframes(audio.tobytes())
    return tmp.name


# ══════════════════════════════════════════════════════════════════════════════
#  HISTORY VIEW
# ══════════════════════════════════════════════════════════════════════════════

def show_history(n: int = 20):
    sessions = load_sessions(n)
    if not sessions:
        print("  אין היסטוריה שמורה עדיין.")
        return

    print(f"\n  {'תאריך':<20} {'קובץ':<28} {'רעש':<14} {'מומלץ':<16} {'נבחר':<16}")
    print(f"  {'─'*20} {'─'*28} {'─'*14} {'─'*16} {'─'*16}")
    for s in sessions[:n]:
        date = s["created_at"][:16] if s["created_at"] else "—"
        fname = (s["audio_filename"] or "—")[:26]
        noise = (s["noise_level"] or "—")[:12]
        rec = (s["recommended_id"] or "—")[:14]
        chosen = (s["user_chosen_id"] or "—")[:14]
        match = "✅" if rec == chosen else ("📚" if chosen != "—" else "")
        print(f"  {date:<20} {fname:<28} {noise:<14} {rec:<16} {chosen:<16} {match}")

    labeled = sum(1 for s in sessions if s.get("user_chosen_id"))
    print(f"\n  סה\"כ: {len(sessions)} סשנים | {labeled} עם משוב | "
          f"כ-NN זמין: {'✓' if labeled >= 3 else f'עוד {3-labeled} דוגמאות'}")


# ══════════════════════════════════════════════════════════════════════════════
#  PRINT HELPERS
# ══════════════════════════════════════════════════════════════════════════════

SEP = "═" * 78


def _print_audio_summary(info: dict):
    dur = info["duration_s"]
    dur_str = f"{int(dur // 60)}:{int(dur % 60):02d}"
    print(f"\n  📁  {info['filename']}")
    print(f"  ⏱  {dur_str}  |  "
          f"{'סטריאו' if info['is_stereo'] else 'מונו'}  |  "
          f"{info['sample_rate'] // 1000}kHz  |  "
          f"{info['bit_depth']}bit")
    print(f"  📶  Dynamic range: {info['dynamic_range_db']:.1f}dB  |  "
          f"SNR: {info['snr_estimate_db']:.1f}dB  |  "
          f"רעש: {info['noise_level_label']}")
    if info["clipping_count"] > 50:
        print(f"  ⚠   קליפינג: {info['clipping_count']} דגימות!")


def _ask_feedback(results: list[dict], recommended_id: str) -> tuple[str | None, str | None]:
    """Prompt user for feedback. Returns (chosen_id, notes)."""
    print(f"\n{SEP}")
    print("  📋  משוב — איזה תמלול עשה את העבודה הכי טוב?")
    print(f"  (Enter = קבל המלצה [{recommended_id}]  |  0 = דלג)")
    print()
    for i, r in enumerate(results, 1):
        is_rec = "★ " if r["id"] == recommended_id else "  "
        print(f"  {is_rec}{i:2d}. {r['label']:<28} {r['word_count']} מילים")
    print()

    while True:
        raw = input("  בחירה: ").strip()
        if raw == "":
            return recommended_id, None
        if raw == "0":
            return None, None
        try:
            idx = int(raw) - 1
            if 0 <= idx < len(results):
                chosen_id = results[idx]["id"]
                notes = input("  הערות (אופציונלי, Enter לדילוג): ").strip() or None
                return chosen_id, notes
        except ValueError:
            pass
        print("  ⚠  הכנס מספר בין 1 ל-12")


# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="כלי השוואת תמלול חכם לעברית",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("audio", nargs="?", help="קובץ אודיו להשוואה")
    parser.add_argument("--record", action="store_true", help="הקלט מהמיקרופון")
    parser.add_argument("--dur", type=int, default=30, help="אורך הקלטה בשניות (ברירת מחדל: 30)")
    parser.add_argument("--history", action="store_true", help="הצג היסטוריית סשנים")
    parser.add_argument("--n", type=int, default=20, help="כמות היסטוריה להציג")
    parser.add_argument("--no-browser", action="store_true", help="אל תפתח דפדפן")
    parser.add_argument("--no-supabase", action="store_true", help="אל תסנכרן ל-Supabase")
    args = parser.parse_args()

    print(f"\n{SEP}")
    print("  🎙  Smart Hebrew Transcription Comparator")
    print(SEP)

    # History mode
    if args.history:
        show_history(args.n)
        return

    # Get audio path
    tmp_recording = None
    if args.record:
        tmp_recording = record_audio(args.dur)
        audio_path = tmp_recording
    elif args.audio:
        audio_path = args.audio
        if not Path(audio_path).exists():
            print(f"  ✗  קובץ לא נמצא: {audio_path}")
            sys.exit(1)
    else:
        parser.print_help()
        sys.exit(0)

    # Check server
    try:
        requests.get(f"{SERVER}/health", timeout=5).raise_for_status()
    except Exception:
        print(f"  ✗  שרת לא זמין ב-{SERVER} — הפעל את השרת תחילה")
        sys.exit(1)

    # Analyze audio
    print("\n  📊  מנתח הקלטה...")
    audio_info = analyze_audio(audio_path)
    _print_audio_summary(audio_info)

    # File hash
    h = hashlib.sha256()
    with open(audio_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    audio_hash = h.hexdigest()[:16]

    # Session ID
    session_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{audio_hash[:6]}"

    # Load past sessions for k-NN
    past = load_sessions(200)

    # Recommend
    recommended_id, rec_reason, confidence = recommend(audio_info, past)

    print(f"\n  💡  המלצה: {SYS_BY_ID[recommended_id][1]}")
    print(f"      ({rec_reason})")

    # Run all 12 systems
    print(f"\n{SEP}")
    print("  ⚙  מריץ 12 מערכות תמלול...")
    print(SEP)

    results = run_all_systems(audio_path, audio_info)

    # Build session
    session = {
        "session_id": session_id,
        "created_at": datetime.now().isoformat(),
        "audio_hash": audio_hash,
        "audio_filename": audio_info["filename"],
        "duration_s": audio_info["duration_s"],
        "channels": audio_info["channels"],
        "sample_rate": audio_info["sample_rate"],
        "dynamic_range_db": audio_info["dynamic_range_db"],
        "snr_estimate_db": audio_info["snr_estimate_db"],
        "noise_rms": audio_info["noise_rms"],
        "noise_level": audio_info["noise_level_label"],
        "results": results,
        "recommended_id": recommended_id,
        "user_chosen_id": None,
        "user_notes": None,
    }

    # Generate + open HTML report
    print(f"\n{SEP}")
    print("  📄  מייצר דוח HTML...")
    report_path = generate_html_report(
        audio_info, results, recommended_id, rec_reason, session_id
    )
    print(f"  ✓   {report_path}")

    if not args.no_browser:
        webbrowser.open(report_path.as_uri())

    # Save (before feedback)
    save_session(session)

    # Ask for feedback
    chosen_id, notes = _ask_feedback(results, recommended_id)
    if chosen_id:
        session["user_chosen_id"] = chosen_id
        session["user_notes"] = notes
        save_session(session)

        # Sync to Supabase
        if not args.no_supabase:
            print("  ☁   מסנכרן ל-Supabase...", end=" ")
            ok = supabase_sync(session)
            print("✓" if ok else "✗ (נשמר מקומית)")

        # Regenerate report with user choice marked
        generate_html_report(audio_info, results, chosen_id, rec_reason, session_id)
        if recommended_id == chosen_id:
            print(f"\n  ✅  המלצה הייתה נכונה! ({SYS_BY_ID[chosen_id][1]})")
        else:
            print(f"\n  📚  למדתי: {SYS_BY_ID[chosen_id][1]} עדיף על {SYS_BY_ID[recommended_id][1]}")
            print(f"      (דוח עודכן)")
    else:
        print("  (ללא משוב — הסשן נשמר ללא תיוג)")

    # Cleanup tmp recording
    if tmp_recording:
        try:
            os.unlink(tmp_recording)
        except Exception:
            pass

    # Show stats
    labeled_count = sum(1 for s in load_sessions(200) if s.get("user_chosen_id"))
    print(f"\n  📈  מאגר: {labeled_count} דוגמאות מתויגות "
          f"({'k-NN פעיל ✓' if labeled_count >= 3 else f'עוד {3-labeled_count} לk-NN'})")
    print(f"\n{SEP}\n")


if __name__ == "__main__":
    main()

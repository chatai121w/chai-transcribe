import json
import time
import urllib.request
import urllib.error
import statistics
import re
from pathlib import Path

MODELS = [
    "command-r:35b",
    "qwen2.5:14b",
    "aya:8b",
    "gemma2:9b",
    "mistral-nemo:12b",
]

CASES = [
    {
        "name": "case1",
        "text": "שלום לכולם היום אנחנו ניפגש בשעה שמונה בערב ונדון על התוכנית החדשה אני מבקש מכל אחד לשלוח את העידכון שלו עד מחר בבוקר תודה רבה",
    },
    {
        "name": "case2",
        "text": "אתמול דברתי עם הלקוח והוא אמר שהמערכת עובדת טוב אבל יש כמה בעיות קטנות בממשק משתמש שצריך לטפל בהם בהקדם האפשרי כדי לא לעכב את העליה לאוויר",
    },
    {
        "name": "case3",
        "text": "בישיבה האחרונה החלטנו להעביר את הנתונים לשרת חדש כי השרת הישן נהיה איטי מאוד וזה משפיע על כל הצוות במיוחד בשעות עומס ולכן חשוב לסיים את המעבר השבוע",
    },
]

SYSTEM_PROMPT = (
    "אתה עורך לשון מקצועי בעברית. "
    "המשימה: לתקן ניסוח, שגיאות כתיב, דקדוק ופיסוק בלבד. "
    "כללי חובה: "
    "1) אסור להוסיף מידע חדש. "
    "2) אסור למחוק מידע מהותי. "
    "3) אסור לקצר או להרחיב תוכן. "
    "4) שמור ככל האפשר על אותה משמעות, אותה רשימת עובדות ואותו סדר. "
    "החזר רק את הטקסט המתוקן."
)


def tokenize(text: str) -> list[str]:
    cleaned = re.sub(r"[^\w\s\u0590-\u05FF]", " ", text.lower(), flags=re.UNICODE)
    return [t for t in cleaned.split() if t]


def call_ollama(model: str, user_text: str) -> tuple[bool, str, str]:
    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_text},
        ],
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        "http://localhost:11434/api/chat",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        out = (body.get("message") or {}).get("content", "")
        if not out.strip():
            return False, "", "Empty output"
        return True, out, ""
    except urllib.error.HTTPError as e:
        return False, "", f"HTTP {e.code}: {e.reason}"
    except Exception as e:
        return False, "", str(e)


def main() -> None:
    results = []

    for model in MODELS:
        for case in CASES:
            start = time.perf_counter()
            ok, out, err = call_ollama(model, case["text"])
            latency_ms = round((time.perf_counter() - start) * 1000)

            in_len = max(1, len(case["text"]))
            out_len = max(1, len(out))
            len_drift_pct = round(abs(out_len - in_len) / in_len * 100, 2)

            in_tokens = tokenize(case["text"])
            out_tokens = tokenize(out)
            in_set = set(in_tokens)
            out_set = set(out_tokens)
            overlap = len(in_set.intersection(out_set))
            preserve_pct = round((overlap / len(in_set) * 100), 2) if in_set else 0.0

            results.append(
                {
                    "model": model,
                    "case": case["name"],
                    "ok": ok,
                    "latency_ms": latency_ms,
                    "preserve_pct": preserve_pct,
                    "len_drift_pct": len_drift_pct,
                    "input_text": case["text"],
                    "output_text": out,
                    "error": err,
                }
            )

    summary = []
    for model in MODELS:
        group = [r for r in results if r["model"] == model]
        latencies = [r["latency_ms"] for r in group]
        preserves = [r["preserve_pct"] for r in group]
        drifts = [r["len_drift_pct"] for r in group]
        success_count = sum(1 for r in group if r["ok"])

        summary.append(
            {
                "model": model,
                "success_rate_pct": round((success_count / len(group)) * 100, 2),
                "avg_latency_ms": round(statistics.mean(latencies), 0),
                "avg_preserve_pct": round(statistics.mean(preserves), 2),
                "avg_len_drift_pct": round(statistics.mean(drifts), 2),
            }
        )

    summary.sort(key=lambda x: (x["avg_preserve_pct"], -x["avg_len_drift_pct"]), reverse=True)

    Path("offline_edit_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    Path("offline_edit_results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("BENCHMARK_DONE")
    print("offline_edit_summary.json")
    print("offline_edit_results.json")


if __name__ == "__main__":
    main()

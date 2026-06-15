"""Quick test of /diarize endpoint."""
import requests, json

r = requests.post(
    "http://localhost:3000/diarize",
    files={"file": open("e2e/fixtures/hebrew_two_speakers.wav", "rb")},
    data={"diarization_engine": "silence-gap", "min_gap": "1.5"},
    timeout=120,
)
print(f"Status: {r.status_code}")
try:
    d = r.json()
    print(json.dumps(d, ensure_ascii=False, indent=2)[:2000])
except:
    print("Raw:", r.text[:1000])

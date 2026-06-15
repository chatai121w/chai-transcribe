"""
Generate Hebrew speech WAV files for E2E benchmark testing.
Uses edge-tts (Microsoft Azure TTS) with Hebrew voices.
"""
import asyncio
import edge_tts
import subprocess
import os
import sys

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "e2e", "fixtures")

# Hebrew text samples for benchmarking
SAMPLES = [
    {
        "id": "short",
        "text": "שלום, זוהי בדיקה של מערכת התמלול.",
        "description": "Short sentence (~3s)",
    },
    {
        "id": "medium",
        "text": (
            "היום אנחנו בודקים את מערכת התמלול החכמה. "
            "המערכת משתמשת במודל וויספר של אופן איי איי, "
            "ותומכת בשלוש ערכות תמלול שונות: מהיר, מאוזן ומדויק. "
            "כל ערכה מותאמת לצרכים שונים של המשתמש."
        ),
        "description": "Medium paragraph (~10s)",
    },
    {
        "id": "long",
        "text": (
            "ברוכים הבאים למערכת התמלול החכמה בעברית. "
            "מערכת זו פותחה כדי לספק תמלול מדויק ומהיר של הקלטות קוליות בשפה העברית. "
            "היא משתמשת בטכנולוגיית בינה מלאכותית מתקדמת, "
            "כולל מודלים של וויספר שאומנו במיוחד על שפה עברית. "
            "המערכת תומכת בזיהוי דוברים, חלוקה לפסקאות, והוספת פיסוק אוטומטית. "
            "בנוסף, ניתן לערוך את הטקסט באמצעות כלי עריכה מבוססי בינה מלאכותית, "
            "כמו תיקון שגיאות כתיב ודקדוק, סיכום טקסט, והפיכה לנקודות תבליט."
        ),
        "description": "Long paragraph (~25s)",
    },
]

VOICE = "he-IL-AvriNeural"  # Hebrew male voice


async def generate_samples():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for sample in SAMPLES:
        mp3_path = os.path.join(OUTPUT_DIR, f"hebrew_{sample['id']}.mp3")
        wav_path = os.path.join(OUTPUT_DIR, f"hebrew_{sample['id']}.wav")
        txt_path = os.path.join(OUTPUT_DIR, f"hebrew_{sample['id']}.expected.txt")

        print(f"\n🎙️  Generating: {sample['description']}")
        print(f"   Text: {sample['text'][:60]}...")

        # Generate MP3 with edge-tts
        communicate = edge_tts.Communicate(sample["text"], VOICE)
        await communicate.save(mp3_path)
        print(f"   ✅ MP3 saved: {mp3_path}")

        # Convert MP3 to WAV (16kHz mono - optimal for Whisper)
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", mp3_path,
                    "-ar", "16000", "-ac", "1", "-sample_fmt", "s16",
                    wav_path,
                ],
                capture_output=True, check=True,
            )
            os.remove(mp3_path)
            print(f"   ✅ WAV saved: {wav_path}")
        except FileNotFoundError:
            print("   ⚠️  ffmpeg not found — keeping MP3 (server accepts both)")
            wav_path = mp3_path
        except subprocess.CalledProcessError as e:
            print(f"   ⚠️  ffmpeg failed — keeping MP3: {e.stderr.decode()[:100]}")
            wav_path = mp3_path

        # Save expected text for accuracy comparison
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(sample["text"])
        print(f"   ✅ Expected text saved: {txt_path}")

        # Get file size and duration info
        size_kb = os.path.getsize(wav_path) / 1024
        print(f"   📦 Size: {size_kb:.1f} KB")

    print("\n✅ All Hebrew audio samples generated!")
    print(f"   Output directory: {OUTPUT_DIR}")


if __name__ == "__main__":
    asyncio.run(generate_samples())

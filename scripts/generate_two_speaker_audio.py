"""
Generate a two-speaker Hebrew conversation audio fixture for diarization testing.

Uses edge-tts with two distinct Hebrew voices (male + female) and
concatenates them with silence gaps into a single WAV file.
"""

import asyncio
import os
import io
import struct
import tempfile

# ── Conversation lines with alternating speakers ──
SPEAKER_A_VOICE = "he-IL-AvriNeural"    # male
SPEAKER_B_VOICE = "he-IL-HilaNeural"    # female

CONVERSATION = [
    ("A", "שלום, אני רוצה לקבוע תור לרופא בבקשה."),
    ("B", "בוקר טוב. בשמחה, לאיזה רופא תרצה לקבוע?"),
    ("A", "לרופא המשפחה, דוקטור כהן."),
    ("B", "יש לי תור פנוי ביום שלישי בשעה עשר בבוקר. מתאים לך?"),
    ("A", "כן, זה מצוין. תודה רבה."),
    ("B", "בבקשה, נרשם. יום נעים!"),
]

SILENCE_BETWEEN_MS = 1500  # 1.5 seconds silence between speakers
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "e2e", "fixtures")
OUTPUT_WAV = os.path.join(OUTPUT_DIR, "hebrew_two_speakers.wav")
OUTPUT_TXT = os.path.join(OUTPUT_DIR, "hebrew_two_speakers.expected.txt")


def create_silence_wav_bytes(duration_ms: int, sample_rate: int = 24000) -> bytes:
    """Create raw PCM silence bytes (16-bit mono)."""
    num_samples = int(sample_rate * duration_ms / 1000)
    return b'\x00\x00' * num_samples


def write_wav(pcm_data: bytes, sample_rate: int, filepath: str):
    """Write raw 16-bit mono PCM data to a WAV file."""
    data_size = len(pcm_data)
    file_size = 44 + data_size

    with open(filepath, 'wb') as f:
        # RIFF header
        f.write(b'RIFF')
        f.write(struct.pack('<I', file_size - 8))
        f.write(b'WAVE')
        # fmt chunk
        f.write(b'fmt ')
        f.write(struct.pack('<I', 16))       # chunk size
        f.write(struct.pack('<H', 1))        # PCM
        f.write(struct.pack('<H', 1))        # mono
        f.write(struct.pack('<I', sample_rate))
        f.write(struct.pack('<I', sample_rate * 2))  # byte rate
        f.write(struct.pack('<H', 2))        # block align
        f.write(struct.pack('<H', 16))       # bits per sample
        # data chunk
        f.write(b'data')
        f.write(struct.pack('<I', data_size))
        f.write(pcm_data)


async def generate_speech(text: str, voice: str) -> bytes:
    """Generate speech using edge-tts and return raw PCM bytes."""
    import edge_tts

    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
        tmp_path = tmp.name

    try:
        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(tmp_path)

        # Convert MP3 to raw PCM via pydub
        from pydub import AudioSegment
        audio = AudioSegment.from_mp3(tmp_path)
        audio = audio.set_channels(1).set_frame_rate(24000).set_sample_width(2)
        return audio.raw_data
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


async def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("Generating two-speaker Hebrew conversation...")
    silence = create_silence_wav_bytes(SILENCE_BETWEEN_MS, 24000)
    all_pcm = b''

    for i, (speaker, text) in enumerate(CONVERSATION):
        voice = SPEAKER_A_VOICE if speaker == "A" else SPEAKER_B_VOICE
        print(f"  [{speaker}] {voice}: {text}")
        pcm = await generate_speech(text, voice)
        all_pcm += pcm
        if i < len(CONVERSATION) - 1:
            all_pcm += silence

    # Write WAV
    write_wav(all_pcm, 24000, OUTPUT_WAV)
    print(f"\nWAV saved: {OUTPUT_WAV}")

    # Write expected text (all lines combined + speaker info)
    expected_lines = []
    for speaker, text in CONVERSATION:
        label = "דובר 1" if speaker == "A" else "דובר 2"
        expected_lines.append(f"{label}: {text}")

    with open(OUTPUT_TXT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(expected_lines))
    print(f"Expected: {OUTPUT_TXT}")
    print(f"\nDuration: ~{len(all_pcm) / (24000 * 2):.1f}s")
    print("Done!")


if __name__ == '__main__':
    asyncio.run(main())

# 🎵 תוכנית שדרוג שרת הרמוניה - השוואות והמלצות

## מצב נוכחי
העיבוד מתבצע בדפדפן בלבד באמצעות **Tone.js PitchShift** (Phase Vocoder).
- ✅ אין צורך בשרת
- ❌ איכות pitch shifting בינונית (עיוותים בהזזה גדולה)
- ❌ אין שימור פורמנטים (אפקט "מיקי מאוס" בהזזה למעלה)
- ❌ אין הפרדת קולות (vocals isolation)
- ❌ ביצועים מוגבלים - תלוי בכוח המחשב של המשתמש

---

## סקירת ספריות וכלים

### 1. stftPitchShift (Python + C++)
| פרמטר | ערך |
|---|---|
| **GitHub** | github.com/jurihock/stftPitchShift |
| **⭐ Stars** | 181 |
| **רישיון** | MIT ✅ |
| **שפה** | C++ + Python (`pip install stftpitchshift`) |
| **טכנולוגיה** | STFT-based Phase Vocoder |
| **תכונות** | Poly pitch shifting (מספר גבהים בו-זמנית), שימור פורמנטים (Cepstral liftering) |
| **איכות** | ⭐⭐⭐ טובה - שימור פורמנטים מפחית עיוותים |
| **מהירות** | ⭐⭐⭐⭐ מהיר מאוד |
| **התאמה לפרויקט** | גבוהה - API פשוט, pip install |

**קוד לדוגמה:**
```python
from stftpitchshift import StftPitchShift
pitchshifter = StftPitchShift(1024, 256, 44100)
y = pitchshifter.shiftpitch(x, 1.5)  # shift up by factor 1.5
# Poly: multiple pitches at once
y = pitchshifter.shiftpitch(x, [0.5, 1, 2])  # octave down + original + octave up
```

---

### 2. Rubber Band Library (pyrubberband)
| פרמטר | ערך |
|---|---|
| **GitHub** | github.com/breakfastquay/rubberband |
| **⭐ Stars** | 723 |
| **רישיון** | GPL-2.0 ⚠️ (רישיון מסחרי זמין בתשלום) |
| **שפה** | C++ עם wrapper Python (`pip install pyrubberband`) |
| **טכנולוגיה** | STFT עם 2 מנועים: R2 (Faster) ו-R3 (Finer) |
| **תכונות** | Time-stretching + Pitch-shifting, מנוע R3 באיכות גבוהה מאוד |
| **איכות** | ⭐⭐⭐⭐⭐ הכי טוב בתעשייה - סטנדרט מקצועי |
| **מהירות** | ⭐⭐⭐ R2 מהיר, R3 איטי יותר אבל איכותי |
| **התאמה לפרויקט** | גבוהה - אבל צריך להתקין rubberband-cli על המערכת |

**קוד לדוגמה:**
```python
import pyrubberband as pyrb
import soundfile as sf

audio, sr = sf.read('input.wav')
shifted = pyrb.pitch_shift(audio, sr, n_steps=4)  # shift up 4 semitones
sf.write('output.wav', shifted, sr)
```

**הערה חשובה:** pyrubberband דורש התקנת rubberband binary על המערכת (לא רק pip). ב-Windows צריך להוריד את ה-exe בנפרד.

---

### 3. WORLD Vocoder (pyworld)
| פרמטר | ערך |
|---|---|
| **GitHub** | github.com/mmorise/World + Python wrapper |
| **⭐ Stars** | 1,300 (C++) + 786 (Python wrapper) |
| **רישיון** | Modified-BSD ✅ |
| **שפה** | C++ עם Python wrapper (`pip install pyworld`) |
| **טכנולוגיה** | Vocoder - ניתוח/סינתזה מלאים (F0 + Spectral Envelope + Aperiodicity) |
| **תכונות** | שליטה מלאה על pitch, spectral envelope, aperiodicity - שימור פורמנטים מובנה |
| **איכות** | ⭐⭐⭐⭐⭐ מצוינת לקולות - שימור פורמנטים טבעי |
| **מהירות** | ⭐⭐⭐⭐ מהיר (מיועד ל-real-time) |
| **התאמה לפרויקט** | גבוהה מאוד - pip install, API פשוט |

**קוד לדוגמה:**
```python
import pyworld as pw
import numpy as np

# ניתוח
f0, sp, ap = pw.wav2world(x, fs)

# שינוי pitch (הזזה 4 חצאי טונים למעלה)
f0_shifted = f0 * (2 ** (4/12))

# סינתזה מחדש - הפורמנטים נשמרים אוטומטית!
y = pw.synthesize(f0_shifted, sp, ap, fs)
```

**יתרון ייחודי:** שימור פורמנטים מובנה - כשמשנים את ה-F0 בלבד, ה-spectral envelope (שמגדיר את אופי הקול) לא משתנה. זה גורם לקול להישמע טבעי גם בהזזות גדולות.

---

### 4. PyHarmonize
| פרמטר | ערך |
|---|---|
| **GitHub** | github.com/juliankappler/PyHarmonize |
| **⭐ Stars** | 5 |
| **רישיון** | לא מוגדר |
| **שפה** | Python (תלוי ב-librosa, scipy, numpy) |
| **טכנולוגיה** | Pitch detection + shifting מבוסס librosa |
| **תכונות** | הרמוניה לפי סולם ומפתח - API פשוט במיוחד |
| **איכות** | ⭐⭐⭐ סבירה - מבוסס על librosa |
| **מהירות** | ⭐⭐⭐ סבירה |
| **התאמה לפרויקט** | גבוהה - API הכי קרוב למה שאנחנו צריכים |

**קוד לדוגמה:**
```python
import PyHarmonize

params = {
    'input_filename': 'melody.wav',
    'output_filename': 'harmony.wav',
    'key': 'C',
    'mode': 'major'
}
gen = PyHarmonize.harmony_generator(parameters=params)
result = gen.add_harmonies(scale_degrees=[3, 5, 8])  # third + fifth + octave
```

---

### 5. PSOLA (TD-PSOLA via Praat/Parselmouth)
| פרמטר | ערך |
|---|---|
| **GitHub** | github.com/maxrmorrison/psola |
| **⭐ Stars** | 90 |
| **רישיון** | GPL-3.0 ⚠️ |
| **שפה** | Python (`pip install psola`) |
| **טכנולוגיה** | Time-Domain Pitch-Synchronous Overlap-Add |
| **תכונות** | Pitch shifting + Time stretching, מבוסס Praat |
| **איכות** | ⭐⭐⭐⭐ מצוינת לדיבור וקול |
| **מהירות** | ⭐⭐⭐⭐ מהיר |
| **התאמה לפרויקט** | בינונית - מותאם יותר לדיבור מאשר למוזיקה |

---

### 6. Demucs (Meta/Facebook) - הפרדת מקורות
| פרמטר | ערך |
|---|---|
| **GitHub** | github.com/adefossez/demucs |
| **⭐ Stars** | 2,600 |
| **רישיון** | MIT ✅ |
| **שפה** | Python (PyTorch) |
| **טכנולוגיה** | Hybrid Transformer U-Net (HTDemucs v4) |
| **תכונות** | הפרדת vocals/drums/bass/other, SDR 9.0 dB state-of-the-art |
| **איכות** | ⭐⭐⭐⭐⭐ הטוב ביותר בעולם להפרדת קולות |
| **מהירות** | ⭐⭐ איטי (GPU מומלץ, ~1.5x משך השיר ב-CPU) |
| **זיכרון** | 3-7GB GPU RAM |
| **התאמה לפרויקט** | תוספת אופציונלית - בידוד קול לפני הרמוניה |

**קוד לדוגמה:**
```python
import demucs.separate
demucs.separate.main(["--two-stems", "vocals", "-n", "htdemucs", "input.mp3"])
# מפיק: separated/htdemucs/input/vocals.wav + no_vocals.wav
```

**שימוש בפרויקט שלנו:** ניתן קודם להפריד את הקול מהליווי, ליצור הרמוניה רק על הקול, ואז לערבב מחדש. זה ישפר דרמטית את האיכות.

---

### 7. Basic Pitch (Spotify) - זיהוי תווים
| פרמטר | ערך |
|---|---|
| **GitHub** | github.com/spotify/basic-pitch |
| **⭐ Stars** | 4,900 |
| **רישיון** | Apache-2.0 ✅ |
| **שפה** | Python (TF/ONNX/CoreML) |
| **טכנולוגיה** | Neural network - Automatic Music Transcription |
| **תכונות** | Audio → MIDI עם pitch bends, polyphonic, instrument-agnostic |
| **איכות** | ⭐⭐⭐⭐⭐ state-of-the-art בזיהוי תווים |
| **מהירות** | ⭐⭐⭐⭐ מהיר (lightweight model) |
| **התאמה לפרויקט** | תוספת - לזיהוי מדויק של תווים לפני יצירת הרמוניה |

---

## 🏆 טבלת השוואה מסכמת

| ספרייה | איכות | מהירות | פורמנטים | Poly | רישיון | pip install | GPU |
|---|---|---|---|---|---|---|---|
| **stftPitchShift** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ (Cepstral) | ✅ | MIT | ✅ | ❌ |
| **Rubber Band** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ✅ (R3) | ❌ | GPL | ⚠️ needs binary | ❌ |
| **WORLD (pyworld)** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ (מובנה) | ❌* | BSD | ✅ | ❌ |
| **PyHarmonize** | ⭐⭐⭐ | ⭐⭐⭐ | ❌ | ✅ | ? | ⚠️ manual | ❌ |
| **PSOLA** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | חלקי | ❌ | GPL | ✅ | ❌ |
| **Demucs** | ⭐⭐⭐⭐⭐ | ⭐⭐ | N/A | N/A | MIT | ✅ | ⭐⭐⭐⭐ |
| **Basic Pitch** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | N/A | N/A | Apache | ✅ | ❌ |

\* WORLD לא עושה poly ישירות, אבל אפשר לייצר כמה גרסאות בלולאה ולערבב

---

## 📋 3 תוכניות לשדרוג

### 🥉 תוכנית A: שדרוג מהיר (קל ליישום)
**עקרון:** החלפת Tone.js PitchShift ב-stftPitchShift בצד שרת

**רכיבים:**
- `stftpitchshift` (pip install)
- `soundfile` (pip install)
- Endpoint חדש בשרת Whisper הקיים (port 3000)

**יתרונות:**
- ✅ שיפור משמעותי באיכות (שימור פורמנטים)
- ✅ Poly pitch shifting מובנה
- ✅ התקנה פשוטה (pip install בלבד)
- ✅ MIT license
- ✅ יישום תוך שעות בודדות
- ✅ CPU בלבד - אין צורך ב-GPU

**חסרונות:**
- ❌ אין הפרדת קולות
- ❌ פורמנט preservation לא מושלם בכל המקרים

**זמני עיבוד משוערים:** 2-5 שניות לשיר של 3 דקות

---

### 🥈 תוכנית B: שדרוג מקצועי (מומלץ ✅)
**עקרון:** WORLD Vocoder + stftPitchShift + אופציונלי Demucs

**רכיבים:**
- `pyworld` - ניתוח/סינתזה עם שימור פורמנטים מלא
- `stftpitchshift` - poly pitch shifting מהיר
- `librosa` - טעינה ועיבוד אודיו
- `demucs` - (אופציונלי) הפרדת קול מליווי

**Pipeline:**
```
קובץ אודיו
    ↓
[אופציונלי: Demucs → הפרדת vocals]
    ↓
WORLD Vocoder → ניתוח (F0, SP, AP)
    ↓
שינוי F0 לפי סולם והרמוניה (SP ו-AP נשארים = פורמנטים שמורים!)
    ↓
WORLD Synthesize → קול הרמוניה #1
WORLD Synthesize → קול הרמוניה #2
WORLD Synthesize → קול הרמוניה #3
    ↓
ערבוב כל הקולות + מקור (+ ליווי מ-Demucs)
    ↓
WAV output
```

**יתרונות:**
- ✅ איכות מקצועית - שימור פורמנטים מלא
- ✅ קול טבעי גם בהזזות גדולות (±12 חצאי טונים)
- ✅ אופציה להפרדת קולות (Demucs) לאיכות מקסימלית
- ✅ רישיונות: BSD + MIT
- ✅ pip install לכל הרכיבים
- ✅ ניצול ה-GPU של ה-RTX 5050 (ל-Demucs)

**חסרונות:**
- ⚠️ Demucs דורש PyTorch (כבר מותקן בשרת Whisper!)
- ⚠️ Demucs איטי (30-90 שניות לשיר של 3 דקות)
- ⚠️ יישום ייקח יותר זמן

**זמני עיבוד משוערים:**
- ללא Demucs: 3-8 שניות
- עם Demucs (GPU): 30-90 שניות
- עם Demucs (CPU): 3-5 דקות

---

### 🥇 תוכנית C: סטודיו מלא (הכי משוכלל)
**עקרון:** Pipeline מלא עם AI - הפרדת קולות + זיהוי תווים + הרמוניה חכמה

**רכיבים:**
- `demucs` - הפרדת vocals/drums/bass/other
- `basic-pitch` - זיהוי תווים מדויק (Audio → MIDI)
- `pyworld` - pitch manipulation עם שימור פורמנטים
- `stftpitchshift` - poly pitch shifting
- `librosa` - ניתוח מוזיקלי (key detection, tempo)

**Pipeline:**
```
קובץ אודיו
    ↓
Demucs → הפרדת vocals / accompaniment
    ↓
Basic Pitch → זיהוי תווים מדויק (MIDI + pitch bends)
    ↓
ניתוח אוטומטי: זיהוי מפתח + סולם (librosa chroma analysis)
    ↓
חישוב הרמוניות חכמות: snap לסולם + voice leading rules
    ↓
WORLD Vocoder → pitch shift לכל הרמוניה בנפרד (עם שימור פורמנטים)
    ↓
ערבוב: vocals מקוריים + הרמוניות + ליווי
    ↓
WAV/MP3 output
```

**תכונות ייחודיות:**
- 🎯 **Auto-Harmony**: זיהוי אוטומטי של מפתח וסולם
- 🎯 **Smart Voice Leading**: הרמוניות שעוקבות אחרי כללי הרמוניה מוזיקלית
- 🎯 **Note-Level Accuracy**: כל תו מקבל הרמוניה מדויקת (לא shift קבוע)
- 🎯 **Stem Separation**: הרמוניה רק על הקול, הליווי נשאר נקי
- 🎯 **Export Options**: WAV, MP3, MIDI, stems בנפרד

**יתרונות:**
- ✅ איכות ברמת סטודיו מקצועי
- ✅ הרמוניה חכמה - לא רק pitch shift עיוור
- ✅ כל הספריות עם רישיונות פתוחים
- ✅ ניצול מלא של ה-GPU

**חסרונות:**
- ⚠️ עיבוד ארוך (1-3 דקות לשיר)
- ⚠️ צריכת זיכרון גבוהה (GPU)
- ⚠️ יישום מורכב - שבועות עבודה
- ⚠️ Basic Pitch דורש TensorFlow/ONNX

**זמני עיבוד משוערים (GPU):**
- Demucs: 30-60 שניות
- Basic Pitch: 5-10 שניות
- WORLD: 3-5 שניות
- סה"כ: 40-80 שניות

---

## 📊 המלצה

### למי שרוצה שיפור מיידי → **תוכנית A** (stftPitchShift)
- יישום ב-2-3 שעות
- שיפור ניכר באיכות מול Tone.js
- אפס dependencies חדשות מלבד pip

### למי שרוצה איכות מקצועית → **תוכנית B** (WORLD + Demucs) ⭐ מומלץ
- יישום ביום-יומיים
- איכות מקצועית עם שימור פורמנטים
- ניצול ה-GPU שכבר קיים בשרת
- האיזון הטוב ביותר בין איכות לזמן פיתוח

### למי שרוצה את המקסימום → **תוכנית C** (Full AI Studio)
- יישום בשבוע+
- איכות ברמת סטודיו
- דורש משאבי GPU משמעותיים

---

## 🔧 ארכיטקטורה טכנית מוצעת (תוכנית B)

```
Frontend (React)                     Backend (Python/Waitress)
┌─────────────────┐                 ┌──────────────────────────┐
│  Harmonika.tsx  │  POST /api/     │  harmony_server.py       │
│                 │  harmonize      │                          │
│  - Upload file  │ ──────────────> │  1. Load audio (librosa) │
│  - Choose preset│  FormData:      │  2. [Demucs] separate    │
│  - Set voices   │  - audio file   │  3. WORLD analyze (f0,sp)│
│  - Set scale    │  - voices[]     │  4. Shift f0 per voice   │
│  - Preview/     │  - scale        │  5. WORLD synthesize     │
│    Render       │  - root         │  6. Mix all voices       │
│                 │  - dryGain      │  7. Return WAV           │
│  Player         │ <────────────── │                          │
│  (WaveSurfer)   │  WAV blob       │  הרצה על port 3000       │
└─────────────────┘                 │  (אותו שרת Whisper)      │
                                    └──────────────────────────┘
```

### Endpoint API:
```
POST /api/harmonize
Content-Type: multipart/form-data

Fields:
  - audio: File (WAV/MP3/OGG)
  - voices: JSON array [{semitones: 4, gain: 0.8}, {semitones: 7, gain: 0.7}]
  - scale: string ("major" | "minor" | "chromatic" | ...)
  - root: string ("C" | "C#" | "D" | ...)
  - dryGain: float (0-1)
  - wetGain: float (0-1)
  - maxDuration: float (seconds, optional - for preview)
  - useSeparation: boolean (optional - use Demucs)

Response:
  Content-Type: audio/wav
  Body: WAV file bytes
```

---

## 📦 Dependencies להוספה (pip)

### תוכנית A:
```
stftpitchshift
soundfile
```

### תוכנית B (מומלץ):
```
pyworld
stftpitchshift
soundfile
librosa
# demucs כבר מותקן עם PyTorch
```

### תוכנית C:
```
pyworld
stftpitchshift
soundfile
librosa
demucs
basic-pitch[onnx]
```

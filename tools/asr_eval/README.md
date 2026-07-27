# ASR Eval — מדידת התקדמות לתמלול עברי / תלמודי

ערכת המדידה האובייקטיבית של המערכת. מבוססת על המדריך
`README_מדריך.md` (שיפור Whisper לשיעורי תלמוד בהגייה אשכנזית).

## מה יש כאן

| קובץ | תפקיד |
|---|---|
| `evaluate_asr.py` | מחשב WER, CER, term-recall, len-ratio ורושם שורה ל-`results.csv` |
| `hebrew_utils.py` | נורמליזציה אחידה לעברית (ניקוד, סופיות, פיסוק) — חובה זהה לשני הצדדים |
| `target_terms.txt` | רשימת מונחי-מטרה (אמוראים, ארמית, מונחי הלכה) למדידת term-recall |
| `initial_prompt_ashkenazi.txt` | prompt תלמודי-אשכנזי. **כבר מובנה בשרת** (`server/transcribe_server.py`) — קובץ זה הוא רפרנס/גיבוי |
| `corrections.json` | מילון post-correction לתלמודית. כבר נטען אוטומטית לקליינט דרך `src/utils/talmudicCorrectionsSeed.ts` |
| `transcribe.py` | דוגמת pipeline עצמאי (`faster-whisper + ivrit.ai + hotwords`). השרת הראשי שלך כבר עושה את כל זה — הקובץ כאן לרפרנס בלבד |
| `golden/` | תיקייה לסט הזהב הקפוא (`ref.txt` + `hyp.txt` שורה-מול-שורה) |

## למה זה לא כפילות

המערכת כבר כוללת:
- ✅ ivrit.ai + CTranslate2 + Flash Attention (`server/transcribe_server.py`)
- ✅ initial_prompt + hotwords + Loshon Kodesh hotwords
- ✅ Silero VAD + aggressive preset
- ✅ Correction learning + personal pronunciation model
- ✅ Hebrew WER benchmarks (`tools/hebrew_hard_benchmark.py`, `hebrew_wer_benchmark.py`)

מה שלא היה ונוסף כאן:
- **סט זהב קפוא + עקומת למידה ב-CSV** (`evaluate_asr.py` + `results.csv`)
- **נורמליזציה אחידה לעברית** (`hebrew_utils.py`) — קיפול סופיות + הסרת ניקוד עקבית
- **seed תלמודי-ספציפי** למערכת התיקונים (גמרה→גמרא, מתניתן→מתניתין וכו') — נטען אוטומטית בקליינט

## שימוש

```bash
# התקנה חד-פעמית
python -m pip install jiwer

# הכן ref.txt ו-hyp.txt בתיקיית golden/ (שורה לכל אמירה, מיושרים)
# ואז:
cd tools/asr_eval
python evaluate_asr.py \
  --ref golden/ref.txt \
  --hyp golden/hyp.txt \
  --terms target_terms.txt \
  --label "ivrit-v3-turbo + prompt + hotwords + corrections"
```

הפלט נרשם ל-`tools/asr_eval/results.csv`. כל הרצה = שורה חדשה = נקודה
על עקומת הלמידה שלך.

## טיפ: יצירת hyp.txt מהשרת המקומי

השרת ב-`server/transcribe_server.py` חושף `/transcribe`. כתוב סקריפט קצר
שמריץ את כל קבצי `golden/*.wav` דרך השרת ומייצר `hyp.txt` שורה-לכל-קובץ,
ואז העבר ל-`evaluate_asr.py`. הפרמטרים שכבר נשלחים אוטומטית בשרת:
`initial_prompt` תלמודי, `hotwords`, VAD agressive — אתה לא צריך
להגדיר אותם שוב.

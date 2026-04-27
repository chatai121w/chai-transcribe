# Tauri Desktop Build — Smart Hebrew Transcriber

## דרישות

- **Rust** 1.77+ (`rustc --version`) — מותקן ✅
- **Node.js** 20+ ✅
- **Visual Studio Build Tools** עם C++ (לרוב כבר מותקן עם Rust) ✅
- **WebView2** — מובנה ב-Windows 11 ✅
- **Smart App Control** — חייב להיות **OFF** (מקומפל קוד Rust)

## סקריפטים

תיקיית build של Cargo הוזזה ל-`C:\rust-builds\` (מהיר יותר ופחות בעיות עם Defender).
**חשוב**: לפני כל פקודת `tauri:dev` או `tauri:build` הגדר את משתנה הסביבה:

```powershell
$env:CARGO_TARGET_DIR = "C:\rust-builds\smart-hebrew-transcriber"
```

או הוסף לפרופיל PowerShell שלך כדי שיהיה תמיד פעיל.

### פיתוח (חלון Tauri עם hot-reload)

```powershell
$env:CARGO_TARGET_DIR = "C:\rust-builds\smart-hebrew-transcriber"
npm run tauri:dev
```

### בנייה ל-installer (NSIS + MSI)

```powershell
$env:CARGO_TARGET_DIR = "C:\rust-builds\smart-hebrew-transcriber"
npm run tauri:build
```

ה-installers ייווצרו תחת:
```
C:\rust-builds\smart-hebrew-transcriber\release\bundle\
  ├── nsis\Smart Hebrew Transcriber_0.1.0_x64-setup.exe
  └── msi\Smart Hebrew Transcriber_0.1.0_x64_en-US.msi
```

## ארכיטקטורה

```
Smart Hebrew Transcriber.exe (Tauri ~10 MB)
├── WebView2 (Edge מובנה) → React UI
├── First-run setup wizard:
│   ├── מוריד Python 3.12 embeddable (~30 MB)
│   ├── מתקין pip + virtualenv
│   ├── יוצר venv ב-%LOCALAPPDATA%\SmartHebrewTranscriber\venv
│   ├── מתקין PyTorch+CUDA (~2.5 GB)
│   └── מתקין faster-whisper + Flask
├── מעתיק transcribe_server.py מתוך resources
└── מפעיל את Python כתת-תהליך אוטומטית בכל פתיחה
```

## נתיבי משתמש

- **בינארי**: `C:\Program Files\Smart Hebrew Transcriber\`
- **נתוני משתמש**: `%LOCALAPPDATA%\SmartHebrewTranscriber\`
  - `python\` — Python embeddable
  - `venv\` — סביבה וירטואלית
  - `server\transcribe_server.py` — שרת התמלול
- **מודלים**: `%USERPROFILE%\.cache\huggingface\` (faster-whisper default)

## פתרון בעיות

### "An Application Control policy has blocked this file" (os error 4551)
Smart App Control חוסם הרצת קוד לא חתום. כבה אותו: `Windows Security → App & browser control → Smart App Control settings → Off`.
⚠️ **הכיבוי הוא חד-כיווני** עד reinstall של Windows.

### בנייה ראשונה איטית (10-20 דק׳)
זה נורמלי - Cargo מקמפל ~400 קריטים. בניות הבאות לוקחות שניות.

### IPC commands זמינים מ-React
```typescript
import { invoke } from "@tauri-apps/api/core";

await invoke("is_setup_complete");           // boolean
await invoke("run_setup");                   // string (or throws)
await invoke("start_whisper_server");        // string
await invoke("stop_whisper_server");         // string
await invoke("get_app_data_dir");            // string
```

## שלב הבא: חתימה דיגיטלית (אופציונלי)

ל-distribution המוני, מומלץ לחתום על ה-installer:

1. רכוש EV Code Signing Certificate (~$300/year)
2. הוסף ל-`tauri.conf.json`:
   ```json
   "windows": {
     "certificateThumbprint": "YOUR_CERT_THUMBPRINT",
     "digestAlgorithm": "sha256",
     "timestampUrl": "http://timestamp.digicert.com"
   }
   ```
3. משתמשים יוכלו להתקין ללא אזהרת SmartScreen.

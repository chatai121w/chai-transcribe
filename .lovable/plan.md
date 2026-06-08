# תוכנית: שיפור ביצועים ואמינות העלאות

## מטרה
1. שחרור ה-UI מקיפאון בזמן עיבוד כבד (תמלול ארוך / diarization / spell check).
2. השלמה אוטומטית של העלאות Drive שנכשלו עקב נפילת רשת, גם כשהלשונית סגורה.

ללא שינוי בהתנהגות תצוגה/עיצוב.

---

## חלק א׳ — Web Worker לעיבוד כבד (ללא SW, בטוח לחלוטין)

קובץ חדש: `src/workers/heavyProcessing.worker.ts`
- מטפל ב: נירמול טקסט תמלול, מיזוג סגמנטים, חישובי diarization בצד לקוח, פירוק טקסט ארוך ל-chunks ל-spell check.
- תקשורת דרך `postMessage` עם טיפוסים משותפים.

קובץ חדש: `src/lib/heavyProcessingClient.ts`
- מנהל יחיד של ה-Worker (singleton), עם API מבוסס Promise (`runTask(name, payload)`).
- מטפל ב-fallback: אם Worker נכשל לעלות, מריץ את אותה לוגיקה ב-main thread (ללא שבירה).

שילוב במקומות הקיימים:
- `src/lib/personalPronunciationModel.ts` / spell check pipeline — להעביר את הנירמול הכבד ל-Worker.
- `src/lib/whisperAlignment.ts` — חישובי alignment כבדים.

יתרון: אין שום מגע עם Service Worker → אפס סיכון לחוויית פיתוח.

---

## חלק ב׳ — Background Sync להעלאות Drive (SW, עם הגנות)

### עקרונות בטיחות SW (לא לפגוע בפיתוח)
- ה-SW הקיים ב-`public/sw.js` נשאר רשום **רק ב-production** (כפי שכבר מוגדר ב-`index.html`).
- **לא** מוסיפים cache של navigation/HTML — רק רישום `sync` event.
- ב-dev/preview/iframe ה-SW לא נרשם בכלל, ולכן Background Sync פשוט יקפוץ ל-fallback מיידי (retry בזיכרון של ה-tab).
- kill switch קיים (`?sw=off`) ממשיך לעבוד.

### שינויים
עדכון `public/sw.js`:
- הוספת `self.addEventListener('sync', ...)` לתג `drive-upload-retry`.
- ב-handler: קריאה ל-IndexedDB (store חדש `pending-drive-uploads`), שליפת ג׳ובים, ניסיון POST חוזר ל-edge function `google-drive`.
- אם מצליח — מסיר מה-store ושולח `postMessage` ל-clients (אם פתוחים) לעדכון UI.
- אם נכשל — משאיר ב-store, ה-browser ינסה שוב.
- **לא** מוסיף `fetch` listener כללי — רק `sync`. כך אין שום ערבוב גרסאות chunks.

עדכון `src/lib/driveUploadQueue.ts`:
- בכשל רשת (network error, לא 4xx) — שמירת הג׳וב ב-IndexedDB (`localDb` הקיים, store חדש).
- רישום `registration.sync.register('drive-upload-retry')` אם זמין.
- האזנה ל-`navigator.serviceWorker` messages לעדכון סטטוס הג׳וב ב-UI.

עדכון `src/components/file-manager/DriveUploadStatus.tsx`:
- הצגת סטטוס "ממתין להתחברות מחדש" לג׳ובים שעברו ל-background sync.

### Fallback ידני (לכל הסביבות כולל preview)
- `online` event listener ב-`driveUploadQueue.ts` — בעת חזרת רשת, ניסיון אוטומטי לכל ג׳וב במצב `error` שנכשל ברשת.
- כך גם בלי SW (dev/preview) המשתמש מקבל retry אוטומטי כשהלשונית פתוחה.

---

## פרטים טכניים

- IndexedDB: שימוש ב-`localDb.ts` הקיים, הוספת store `drive_pending` עם {id, request, attempts, lastError}.
- ה-edge function `google-drive` כבר מטפל ב-overwrite/duplicate — אין שינוי שם.
- אין שינוי בעיצוב או ב-flows קיימים מעבר לתוספת סטטוס.

## מה לא נעשה
- אין הפעלת cache של נכסים/HTML ב-SW.
- אין `vite-plugin-pwa`.
- אין רישום SW בפיתוח/preview.
- אין נגיעה ב-firebase-messaging-sw אם קיים.

## בדיקות
1. preview: העלאה רגילה ל-Drive עובדת, ניתוק רשת → סטטוס "ממתין", החזרת רשת → השלמה אוטומטית (fallback online event).
2. production: אותו תרחיש + סגירת tab → פתיחה מחדש מאוחר יותר → הקובץ כבר ב-Drive (SW sync).
3. עיבוד תמלול ארוך — ה-UI נשאר רספונסיבי (Web Worker).
4. `?sw=off` מבטל את ה-SW לחלוטין ללא שבירה.
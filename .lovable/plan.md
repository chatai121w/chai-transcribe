## מטרה
מצב תצוגה חדש "**יישור עם שורות-רפאים**" ב-`SyncMirrorLayout`: צד אחד נעול, צד שני נערך, **והשורות נשארות מיושרות 1:1** גם אחרי שמוסיפים/מוחקים מילים — באמצעות שורות ריק שמוזרקות אוטומטית לעמודה הקצרה יותר. בנוסף, מערכת **עיגוני אודיו ברמת מילה** עם סימון ויזואלי דק לשורות שנערכו.

## מה משתנה

### 1. כפתור toggle חדש בסרגל הצף
- אייקון חדש (`AlignJustify` או `Rows`) ליד כפתורי הנעילה הקיימים.
- מצב: `alignmentMode: 'free' | 'mirrored-padded'`, נשמר ב-localStorage.
- כש-`mirrored-padded` פעיל **ויש צד נעול**: מופעלת לוגיקת היישור. אחרת — מצב חופשי כמו היום.

### 2. לוגיקת יישור עם שורות-רפאים
- שימוש ב-`diff.worker.ts` הקיים (line-level diff) כדי לחשב alignment בין `text` (הצד הנערך) ל-`lockedSnapshot` (snapshot של הצד הנעול שנלקח ברגע הנעילה).
- אלגוריתם בנוי על LCS: לכל "insert" בצד הנערך מוזרקת שורת ריק (`""`) באותו אינדקס בצד הנעול, ולהפך עבור "delete".
- שני מערכים נגזרים: `leftDisplayLines[]` ו-`rightDisplayLines[]` באותו אורך בדיוק. כל אינדקס N מבטיח שורה N בימין מקבילה לשורה N בשמאל.
- חישוב ב-debounce של 200ms כדי לא לחנוק את הקלדה.

### 3. רינדור שורות-רפאים
- שורת רפאים = `<div>` ריק עם `min-height: 1lh` (תואם לגובה שורת טקסט רגילה ב-`lineHeight` הנוכחי).
- **לפי בחירת המשתמש: ריק לגמרי** — בלי רקע, בלי גבול, בלי טקסט. רק שומר מקום.
- העמודה הנערכת ממשיכה לקבל קלט נורמלי; השורות החדשות (שלא היו ב-snapshot) מסומנות פנימית כ-`isEditedLine`.

### 4. סימון שורות שנערכו (נקודה כחולה)
- בשולי כל שורה שנערכה: `<span>` קטן עם `bg-[#0a1d3f]` בקוטר 6px, מיקום absolute בצד החיצוני של העמודה (`right: -12px` בעמודה הימנית, `left: -12px` בשמאלית).
- מבוסס על תוצאת ה-diff: שורות מסוג `insert` או `change` מקבלות את הנקודה.

### 5. עיגוני אודיו ברמת מילה
- מבנה נתונים חדש: `wordAnchors: Map<wordId, {time: number, text: string}>` — מאוכלס מ-Whisper word timestamps אם זמינים בקובץ התמלול הנוכחי.
- כל מילה ב-`renderLine` מקבלת `data-word-id` ו-`data-anchor-time` כך שלחיצה (או shortcut) קופצת לזמן באודיו.
- כשמוסיפים/מוחקים מילים: עוגנים של מילים שלא שונו נשמרים (מזוהים דרך ה-LCS של ה-diff ברמת מילה). מילים חדשות יורשות את העוגן של המילה הקודמת בשורה.
- **Fallback ברמת שורה**: אם אין word timestamps בקובץ — עיגון לפי תחילת שורה (זמן ההתחלה של המילה הראשונה בשורה המקבילה בצד הנעול/snapshot).
- אינדיקציה: אייקון `Anchor` זעיר ושקוף ליד כל שורה עם עוגן תקף; hover מראה tooltip עם הזמן.

## פרטים טכניים

**קבצים שמושפעים:**
- `src/components/SyncMirrorLayout.tsx` — state חדש, render עם `leftDisplayLines`/`rightDisplayLines`, כפתור toggle, אינדיקציות, חיווט עוגנים.
- `src/hooks/useAlignmentDiff.ts` (חדש) — wraps `diff.worker.ts`, מחזיר `{leftLines, rightLines, editedLineIndices}` עם debounce.
- `src/hooks/useWordAnchors.ts` (חדש) — קורא word timestamps מהתמלול הפעיל, מתחזק `Map` של עוגנים, מעדכן ב-LCS אחרי עריכה.
- אין שינוי ב-schema, ב-backend או בלוגיקה של שמירה/baseline.

**חישוב ה-alignment:**
```text
diff(lockedSnapshot, currentText) at line level →
  EQUAL → leftLines.push(line); rightLines.push(line)
  INSERT (in current) → leftLines.push(""); rightLines.push(line); markEdited(rightIdx)
  DELETE (from snapshot) → leftLines.push(line); rightLines.push(""); markEdited(leftIdx-1)
```

**מילים → עוגנים אחרי עריכה:**
```text
diff(snapshotWords, currentWords) at word level →
  EQUAL → המילה החדשה יורשת את אותו anchorTime
  INSERT → המילה החדשה יורשת את anchorTime של השכן הקודם
  DELETE → העוגן נמחק
```

## אימות
- הקלדה בצד הנערך → השורה המתאימה בצד הנעול שומרת על אותו offset אנכי בדיוק.
- מחיקת שורה → מופיעה שורת ריק בצד הנערך באותו מקום, לא קפיצה.
- נקודה כחולה מופיעה רק בשורות עם הבדל מ-snapshot.
- לחיצה על מילה עם עוגן → ה-audio player קופץ לזמן הנכון, גם אחרי הוספה/מחיקה של מילים אחרות בשורה.
- כיבוי ה-toggle → חזרה להתנהגות הנוכחית בלי שינוי.

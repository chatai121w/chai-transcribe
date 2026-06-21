/**
 * Hebrew Rule Engine — דטרמיניסטי, ללא AI
 *
 * אוסף חוקים לתיקון שגיאות נפוצות בעברית שיוצאות ממנועי ASR (Whisper וכו').
 * החוקים פועלים על ההיפותזה לפני ה-diff מול הטקסט הקנוני, כדי לסלק
 * רעש "טכני" (סופיות, רווחים כפולים) ולתת ביטחון גבוה לתיקונים בטוחים.
 *
 * מקורות השראה:
 * - github.com/ivrit-ai/whisper        — דפוסי טעויות עבריות
 * - github.com/Dicta-Israel-Center     — נורמליזציה
 * - github.com/eyaler/hspell           — חוקי סופיות
 */

export interface RuleHit {
  from: string;       // המילה הלא-נכונה
  to: string;         // המילה המתוקנת
  ruleId: string;     // מזהה החוק שהפעיל
  confidence: number; // 0-100
  reason: string;     // הסבר קצר בעברית
}

// אותיות סופיות וגרסאותיהן הרגילות
const FINAL_MAP: Record<string, string> = {
  'כ': 'ך',
  'מ': 'ם',
  'נ': 'ן',
  'פ': 'ף',
  'צ': 'ץ',
};
const NORMAL_MAP: Record<string, string> = {
  'ך': 'כ',
  'ם': 'מ',
  'ן': 'נ',
  'ף': 'פ',
  'ץ': 'צ',
};

// סטריפ ניקוד/טעמים לבדיקת אותיות בלבד
const stripNikud = (s: string): string => s.replace(/[\u0591-\u05C7]/g, '');
const isHebrewLetter = (ch: string): boolean => /^[\u05D0-\u05EA]$/.test(ch);

/**
 * חוק #1: אות סופית חייבת בסוף מילה.
 *   "אומרים" עם 'מ' בסוף → 'ם'.
 *   "מלכ" → "מלך".
 */
export function ruleFinalLetterRequired(word: string): RuleHit | null {
  const stripped = stripNikud(word);
  if (stripped.length < 2) return null;
  const last = stripped.slice(-1);
  if (FINAL_MAP[last]) {
    // אם האות הקודמת היא אות עברית רגילה — סביר שזו טעות סופית
    const prev = stripped.slice(-2, -1);
    if (isHebrewLetter(prev)) {
      const corrected = word.slice(0, -1) + FINAL_MAP[last];
      return {
        from: word,
        to: corrected,
        ruleId: 'final-letter-required',
        confidence: 95,
        reason: `אות "${last}" בסוף מילה חייבת להיות "${FINAL_MAP[last]}"`,
      };
    }
  }
  return null;
}

/**
 * חוק #2: אות סופית באמצע מילה היא טעות.
 *   "ךתב" → "כתב", "םילה" → "מילה".
 */
export function ruleFinalLetterMisplaced(word: string): RuleHit | null {
  const stripped = stripNikud(word);
  if (stripped.length < 2) return null;
  let corrected = '';
  let hit = false;
  for (let i = 0; i < word.length; i += 1) {
    const ch = word[i];
    const sChar = stripNikud(ch);
    const isLast = i === word.length - 1;
    if (!isLast && NORMAL_MAP[sChar]) {
      corrected += NORMAL_MAP[sChar];
      hit = true;
    } else {
      corrected += ch;
    }
  }
  if (!hit) return null;
  return {
    from: word,
    to: corrected,
    ruleId: 'final-letter-misplaced',
    confidence: 95,
    reason: 'אות סופית הופיעה באמצע מילה',
  };
}

/**
 * חוק #3: רווחים כפולים ופיסוק.
 *   רץ על המשפט כולו, לא על מילה.
 */
export function ruleNormalizeSpacing(text: string): { text: string; changed: boolean } {
  let next = text;
  let changed = false;
  const before = next;
  next = next.replace(/[ \t]{2,}/g, ' ');
  next = next.replace(/\s+([,.!?;:׃])/g, '$1');
  next = next.replace(/([(\[])\s+/g, '$1');
  next = next.replace(/\s+([)\]])/g, '$1');
  if (next !== before) changed = true;
  return { text: next, changed };
}

/**
 * חוק #4: "ו" כפולה בתחילת מילה בעברית רגילה היא לרוב טעות.
 *   "ווידוי" → "וידוי" (רק כשמילה ארוכה מ-3 ויש לפחות 2 תנועות אחר כך).
 *   זהיר! יש שמות פרטיים עם וו כפולה ("שלמה ווייס"), אז ביטחון נמוך.
 */
export function ruleDoubleVavStart(word: string): RuleHit | null {
  const stripped = stripNikud(word);
  if (stripped.length < 4) return null;
  if (stripped.startsWith('וו') && !stripped.startsWith('ווא')) {
    const corrected = word.replace(/^וו/, 'ו');
    return {
      from: word,
      to: corrected,
      ruleId: 'double-vav-start',
      confidence: 55,
      reason: 'וו כפולה בתחילת מילה — לרוב צריך וו אחת',
    };
  }
  return null;
}

const CORRECTION_DICT: Array<{ from: RegExp; to: string; ruleId: string; reason: string; confidence: number }> = [
  { from: /^ארהב$/, to: 'ארה״ב', ruleId: 'abbrev-usa', reason: 'ראשי תיבות', confidence: 90 },
  { from: /^צהל$/, to: 'צה״ל', ruleId: 'abbrev-idf', reason: 'ראשי תיבות', confidence: 90 },
  { from: /^בעהמ$/, to: 'בע״מ', ruleId: 'abbrev-ltd', reason: 'ראשי תיבות', confidence: 90 },
  { from: /^וכו$/, to: 'וכו׳', ruleId: 'abbrev-etc', reason: 'קיצור', confidence: 85 },
];

export function ruleAbbreviations(word: string): RuleHit | null {
  const stripped = stripNikud(word);
  for (const rule of CORRECTION_DICT) {
    if (rule.from.test(stripped)) {
      return {
        from: word,
        to: rule.to,
        ruleId: rule.ruleId,
        confidence: rule.confidence,
        reason: rule.reason,
      };
    }
  }
  return null;
}

/**
 * מריץ את כל החוקים על מילה אחת ומחזיר את התיקון הראשון שנמצא.
 */
export function applyRulesToWord(word: string): RuleHit | null {
  if (!word || word.length < 2) return null;
  // בודק שלא רק סימני פיסוק
  if (!/[\u05D0-\u05EA]/.test(word)) return null;

  return (
    ruleFinalLetterMisplaced(word) ??
    ruleFinalLetterRequired(word) ??
    ruleAbbreviations(word) ??
    ruleDoubleVavStart(word)
  );
}

/**
 * מריץ את כל החוקים על טקסט שלם ומחזיר רשימת תיקונים + טקסט מתוקן.
 */
export function applyRulesToText(text: string): { fixedText: string; hits: RuleHit[] } {
  const { text: spaced } = ruleNormalizeSpacing(text);
  const tokens = spaced.split(/(\s+)/); // שומר רווחים
  const hits: RuleHit[] = [];
  const out: string[] = [];
  for (const tok of tokens) {
    if (/^\s+$/.test(tok) || !tok) {
      out.push(tok);
      continue;
    }
    // הסר סימני פיסוק בקצוות לפני בדיקה
    const m = tok.match(/^(\p{P}*)(.*?)(\p{P}*)$/u);
    if (!m) {
      out.push(tok);
      continue;
    }
    const [, pre, core, post] = m;
    const hit = applyRulesToWord(core);
    if (hit) {
      hits.push(hit);
      out.push(pre + hit.to + post);
    } else {
      out.push(tok);
    }
  }
  return { fixedText: out.join(''), hits };
}

/**
 * האם זוג wrong→correct תואם לחוק עברי כלשהו?
 * משמש לחישוב ביטחון של תיקון שכבר נמצא ב-diff.
 */
export function matchesHebrewRule(wrong: string, correct: string): RuleHit | null {
  const hit = applyRulesToWord(wrong);
  if (hit && stripNikud(hit.to) === stripNikud(correct)) return hit;
  return null;
}

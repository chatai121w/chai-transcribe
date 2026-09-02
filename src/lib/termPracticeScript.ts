export type TermPracticeMode = 'terms' | 'natural';

export function splitPracticeTerms(value: string): string[] {
  return [...new Set(value.split(/[,;\n]+/).map((term) => term.trim()).filter(Boolean))];
}

export function buildPracticeScriptPrompt(mode: TermPracticeMode): string {
  const formatInstruction = mode === 'terms'
    ? 'כתוב משפט קצר ונפרד לכל מושג, כך שהמושג יישמע בבירור בתוך הקשר טבעי.'
    : 'כתוב פסקה תורנית טבעית, רציפה וקצרה בת 3 עד 6 משפטים, המשלבת את כל המושגים בהקשר.';

  return [
    'צור טקסט אמת להקלטה ולבדיקת מערכת תמלול בעברית ובלשון הקודש.',
    formatInstruction,
    'כל שורה בקלט היא מושג יעד. כל מושג חייב להופיע בפלט לפחות פעם אחת, בדיוק באותו כתיב וללא שינוי.',
    'אל תציג רשימה, כותרת, הסבר או מירכאות. אל תוסיף ניקוד. החזר רק את הטקסט המוכן להקראה.',
  ].join(' ');
}

export function buildFallbackPracticeScript(terms: string[], mode: TermPracticeMode): string {
  if (mode === 'terms') {
    if (terms.length === 1) {
      return `בשיעור נעסוק ב${terms[0]} ונבחן את משמעותו בהקשר הרחב של הדברים.`;
    }
    if (terms.length === 2) {
      return `בשיעור נעסוק ב${terms[0]} ונבחן את הקשר בינו לבין ${terms[1]}.`;
    }

    const middle = terms.slice(1, -2).map((term) => `ב${term}`).join(' וגם ');
    const comparison = `ונבחן את הקשר בין ${terms.at(-2)} לבין ${terms.at(-1)}`;
    return `בשיעור נעסוק ב${terms[0]}, ${middle ? `נעמיק ${middle}, ` : ''}${comparison}.`;
  }

  return `במהלך הדברים נעסוק במושגים הבאים בהקשרם. ${terms
    .map((term, index) => `${index === 0 ? 'תחילה' : 'בהמשך'} נתייחס אל ${term} ונבחן את משמעותו בתוך הנושא.`)
    .join(' ')}`;
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findMissingPracticeTerms(script: string, terms: string[]): string[] {
  const normalizedScript = normalizeForMatch(script);
  return terms.filter((term) => !normalizedScript.includes(normalizeForMatch(term)));
}

export function cleanGeneratedPracticeScript(value: string): string {
  return value
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^["'“”״]+|["'“”״]+$/g, '')
    .trim();
}

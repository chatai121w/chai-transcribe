/**
 * Hebrew first-names dictionary — Hasidic/Yiddish forms → standard Hebrew.
 * Applied after transcription when the ff_names_dictionary flag is on.
 *
 * Whole-word replacement only (Hebrew word boundaries), case-insensitive
 * (Hebrew is unicased but we still normalize maqaf/geresh).
 */

export const HEBREW_NAMES_MAP: Record<string, string> = {
  // Common Yiddish/Hasidic forms
  "מויישע": "משה",
  "מוישע": "משה",
  "מוישי": "משה",
  "יענקל": "יעקב",
  "יענקעלע": "יעקב",
  "יענקי": "יעקב",
  "שמילק": "שמואל",
  "שמיליק": "שמואל",
  "שמילקה": "שמואל",
  "מענדל": "מנחם",
  "מענדי": "מנחם",
  "בערל": "דב",
  "בערי": "דב",
  "וועלוול": "זאב",
  "וועלוועל": "זאב",
  "וועלי": "זאב",
  "הערשל": "צבי",
  "הערשי": "צבי",
  "ליבל": "אריה",
  "לייבל": "אריה",
  "לייבי": "אריה",
  "אלטר": "אלתר",
  "פייוול": "פינחס",
  "פייוועל": "פינחס",
  "זיסל": "אלעזר",
  "זושע": "מאיר",
  "אנשיל": "אשר",
  "אנשעל": "אשר",
  "זלמן": "שלמה",
  "זלמל": "שלמה",
  // Female
  "ריזל": "רחל",
  "ריזעל": "רחל",
  "פיגע": "ציפורה",
  "פייגע": "ציפורה",
  "פייגי": "ציפורה",
  "פעסל": "פסיה",
  "ביילע": "ביילא",
  "פרומע": "פרומא",
  "פרומי": "פרומא",
  "גיטל": "גיטה",
  "מאלקע": "מלכה",
  "טויבע": "טובה",
  "טויבי": "טובה",
  "פרעדל": "פרידה",
  "פרעדי": "פרידה",
};

/** Replace Yiddish/Hasidic first-names with standard Hebrew forms. */
export function applyNamesDictionary(text: string): { text: string; replacements: number } {
  if (!text) return { text, replacements: 0 };
  let replacements = 0;
  // Word boundary that works for Hebrew: split on whitespace + common punctuation.
  const out = text.replace(/[\u0590-\u05FF]+/g, (match) => {
    const replacement = HEBREW_NAMES_MAP[match];
    if (replacement && replacement !== match) {
      replacements += 1;
      return replacement;
    }
    return match;
  });
  return { text: out, replacements };
}

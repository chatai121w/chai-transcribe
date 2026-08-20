export type AdjudicationUnit = {
  id: string;
  kind: "equal" | "conflict";
  leftText: string;
  rightText: string;
};

export type AdjudicationResolution = {
  choice: "left" | "right" | "custom";
  customText?: string;
};

export type GlobalReplacementRule = {
  source: string;
  replacement: string;
};

type AlignmentToken = {
  text: string;
  key: string;
};

const HEBREW_NIKUD_RE = /[\u0591-\u05C7]/g;
const HEBREW_QUOTE_RE = /[\u05F3\u05F4'"״׳`´]/g;
const OUTER_PUNCT_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function tokenKey(value: string): string {
  const normalized = value
    .trim()
    .normalize("NFKC")
    .replace(HEBREW_NIKUD_RE, "")
    .replace(HEBREW_QUOTE_RE, "")
    .replace(OUTER_PUNCT_RE, "")
    .toLocaleLowerCase("he");

  return normalized ? `word:${normalized}` : `punct:${value.trim()}`;
}

function tokenize(text: string): AlignmentToken[] {
  return (text.match(/\S+\s*/g) || []).map((part) => ({
    text: part,
    key: tokenKey(part),
  }));
}

function appendUnit(units: AdjudicationUnit[], kind: AdjudicationUnit["kind"], leftText: string, rightText: string) {
  if (!leftText && !rightText) return;
  const previous = units.at(-1);
  if (kind === "equal" && previous?.kind === "equal") {
    previous.leftText += leftText;
    previous.rightText += rightText;
    return;
  }
  units.push({ id: `conflict-${units.length}`, kind, leftText, rightText });
}

/**
 * Aligns two texts into stable decision units. A unit is one changed word when
 * possible, and a phrase only when insertions/deletions make one-to-one
 * alignment impossible.
 */
export function buildAdjudicationUnits(left: string, right: string): AdjudicationUnit[] {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  const dp = Array.from(
    { length: leftTokens.length + 1 },
    () => new Uint16Array(rightTokens.length + 1),
  );

  for (let i = leftTokens.length - 1; i >= 0; i--) {
    for (let j = rightTokens.length - 1; j >= 0; j--) {
      dp[i][j] = leftTokens[i].key === rightTokens[j].key
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const units: AdjudicationUnit[] = [];
  let i = 0;
  let j = 0;

  while (i < leftTokens.length || j < rightTokens.length) {
    if (i < leftTokens.length && j < rightTokens.length && leftTokens[i].key === rightTokens[j].key) {
      const leftText = leftTokens[i].text;
      const rightText = rightTokens[j].text;
      appendUnit(units, leftText === rightText ? "equal" : "conflict", leftText, rightText);
      i++;
      j++;
      continue;
    }

    const leftStart = i;
    const rightStart = j;
    while (i < leftTokens.length || j < rightTokens.length) {
      if (i < leftTokens.length && j < rightTokens.length && leftTokens[i].key === rightTokens[j].key) break;
      if (j >= rightTokens.length || (i < leftTokens.length && dp[i + 1][j] >= dp[i][j + 1])) i++;
      else j++;
    }

    appendUnit(
      units,
      "conflict",
      leftTokens.slice(leftStart, i).map((token) => token.text).join(""),
      rightTokens.slice(rightStart, j).map((token) => token.text).join(""),
    );
  }

  return units.map((unit, index) => ({ ...unit, id: `unit-${index}` }));
}

export function composeAdjudicatedText(
  units: AdjudicationUnit[],
  resolutions: Record<string, AdjudicationResolution>,
  replacementRules: GlobalReplacementRule[] = [],
): string {
  const composed = units.map((unit) => {
    if (unit.kind === "equal") return unit.rightText;
    const resolution = resolutions[unit.id];
    if (resolution?.choice === "left") return unit.leftText;
    if (resolution?.choice === "custom") return resolution.customText || "";
    return unit.rightText;
  }).join("");

  return replacementRules.reduce(
    (text, rule) => replaceExactTextOccurrences(text, rule.source, rule.replacement),
    composed,
  );
}

/**
 * Builds one corrected comparison side without borrowing unresolved text from
 * the other side. This is used by the immediate-save action: only the selected
 * conflict changes, while every other difference remains exactly as it was in
 * that source version.
 */
export function composeCorrectedSideText(
  units: AdjudicationUnit[],
  side: "left" | "right",
  unitId: string,
  replacement: string,
  replaceAllSource?: string,
): string {
  const corrected = units.map((unit) => {
    if (unit.id === unitId) return replacement;
    return side === "left" ? unit.leftText : unit.rightText;
  }).join("");

  return replaceAllSource
    ? replaceExactTextOccurrences(corrected, replaceAllSource, replacement)
    : corrected;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replaces a complete word or phrase without touching it inside another word. */
export function replaceExactTextOccurrences(text: string, source: string, replacement: string): string {
  const cleanSource = source.trim().replace(OUTER_PUNCT_RE, "");
  if (!cleanSource) return text;
  const flexibleWhitespace = cleanSource
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${flexibleWhitespace}(?![\\p{L}\\p{N}])`, "gu");
  return text.replace(pattern, replacement.trim());
}

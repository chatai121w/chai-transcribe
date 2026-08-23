const FORMAT_ONLY_ACTIONS = new Set([
  'punctuation',
  'paragraphs',
  'split_paragraphs',
  'fix_and_split',
]);

export function transcriptWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .replace(/[\u0591-\u05C7]/g, '')
    .match(/[\p{L}\p{N}]+/gu)?.map((word) => word.toLocaleLowerCase('he-IL')) ?? [];
}

export function preservesTranscriptWords(source: string, formatted: string): boolean {
  const sourceWords = transcriptWords(source);
  const formattedWords = transcriptWords(formatted);
  return sourceWords.length === formattedWords.length
    && sourceWords.every((word, index) => word === formattedWords[index]);
}

export function requiresExactWordPreservation(action: string): boolean {
  return FORMAT_ONLY_ACTIONS.has(action);
}

export function chooseTranscriptFormattingModel(models: Array<{ name: string }>): string | undefined {
  const names = models.map((model) => model.name);
  const priorities = [
    /^hf\.co\/dicta-il\/DictaLM-3\.0-Nemotron-12B-Instruct-GGUF:Q4_K_M$/i,
    /^gemma3:4b$/i,
    /^gemma3:12b$/i,
    /^qwen3\.5:9b$/i,
  ];
  for (const pattern of priorities) {
    const match = names.find((name) => pattern.test(name));
    if (match) return match;
  }
  return names.find((name) => !/embedding|translate|dolphin/i.test(name));
}

export function splitExportParagraphs(text: string): string[] {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.split('\n').map((line) => line.trim()).filter(Boolean).join(' '))
    .filter(Boolean);
  if (normalized.length > 1 || transcriptWords(text).length < 80) return normalized;

  const sentences = normalized[0].match(/.*?(?:[.!?…]+(?:["'״׳)]*)|$)(?:\s+|$)/gu)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? normalized;
  if (sentences.length < 2) return normalized;

  const paragraphs: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const sentence of sentences) {
    current.push(sentence);
    words += transcriptWords(sentence).length;
    if (words >= 45 || current.length >= 4) {
      paragraphs.push(current.join(' '));
      current = [];
      words = 0;
    }
  }
  if (current.length) paragraphs.push(current.join(' '));
  return paragraphs;
}

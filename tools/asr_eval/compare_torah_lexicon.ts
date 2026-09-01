import fs from 'node:fs/promises';
import path from 'node:path';
import { TORAH_LEXICON_SEED } from '../../src/data/torahLexiconSeed';

const SERVER = process.env.WHISPER_SERVER_URL || 'http://localhost:3000';
const MODEL = process.env.WHISPER_MODEL || 'ivrit-ai/whisper-large-v3-turbo-ct2';
const HOTWORD_LIMIT = Math.max(1, Number(process.env.HOTWORD_LIMIT) || 60);

type TranscriptionResult = {
  text: string;
  processing_time?: number;
  duration?: number;
  cache_hit?: boolean;
};

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[\u05F3\u05F4"'.,!?;:()[\]{}\-–—]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('he');
}

function levenshteinWords(left: string, right: string): number {
  const a = normalize(left).split(' ').filter(Boolean);
  const b = normalize(right).split(' ').filter(Boolean);
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function recognizedTerms(text: string): string[] {
  const normalizedText = ` ${normalize(text)} `;
  return TORAH_LEXICON_SEED
    .map(entry => entry.term)
    .filter(term => normalizedText.includes(` ${normalize(term)} `));
}

async function transcribe(
  audioPath: string,
  options: { hotwords?: string; loshonKodesh?: boolean } = {},
): Promise<TranscriptionResult> {
  const bytes = await fs.readFile(audioPath);
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: 'audio/mpeg' }), path.basename(audioPath));
  form.set('language', 'he');
  form.set('model', MODEL);
  form.set('beam_size', '3');
  form.set('normalize', '0');
  form.set('loshon_kodesh', options.loshonKodesh ? '1' : '0');
  if (options.hotwords) form.set('hotwords', options.hotwords);

  const startedAt = performance.now();
  const response = await fetch(`${SERVER}/transcribe`, { method: 'POST', body: form });
  const body = await response.json() as TranscriptionResult & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return { ...body, processing_time: body.processing_time ?? (performance.now() - startedAt) / 1000 };
}

async function main() {
  const audioFiles = process.argv.slice(2).map(file => path.resolve(file));
  if (audioFiles.length === 0) {
    console.error('Usage: npx tsx tools/asr_eval/compare_torah_lexicon.ts <audio...>');
    process.exit(1);
  }

  Object.defineProperty(globalThis, 'localStorage', { value: createMemoryStorage(), configurable: true });
  localStorage.setItem('loshon_kodesh_mode', '1');
  const [
    { seedTorahLexicon },
    { buildTranscriptionHotwords },
    { seedTalmudicCorrections },
    { applyTranscriptionKnowledge },
  ] = await Promise.all([
    import('../../src/utils/customVocabulary'),
    import('../../src/lib/transcriptionHotwords'),
    import('../../src/utils/talmudicCorrectionsSeed'),
    import('../../src/lib/transcriptionKnowledge'),
  ]);
  seedTorahLexicon(true);
  seedTalmudicCorrections(true);

  const reports = [];
  for (const audioPath of audioFiles) {
    const context = path.basename(audioPath);
    const lexiconHotwords = buildTranscriptionHotwords({ context, loshonKodesh: false, limit: HOTWORD_LIMIT });
    const hotwords = buildTranscriptionHotwords({ context, loshonKodesh: true, limit: HOTWORD_LIMIT });
    console.log(`\n${context}`);
    console.log('  baseline...');
    const baseline = await transcribe(audioPath);
    console.log('  lexicon only...');
    const lexiconOnlyRaw = await transcribe(audioPath, { hotwords: lexiconHotwords });
    console.log('  Loshon Kodesh only...');
    const loshonKodeshOnlyRaw = await transcribe(audioPath, { loshonKodesh: true });
    console.log(`  enhanced (${hotwords?.split(', ').length || 0} unique hotwords)...`);
    const enhancedRaw = await transcribe(audioPath, { hotwords, loshonKodesh: true });
    const knowledge = applyTranscriptionKnowledge(enhancedRaw.text, 'Local CUDA');
    const enhanced = { ...enhancedRaw, text: knowledge.text };

    const baselineTerms = recognizedTerms(baseline.text);
    const enhancedTerms = recognizedTerms(enhanced.text);
    const addedTerms = enhancedTerms.filter(term => !baselineTerms.includes(term));
    const removedTerms = baselineTerms.filter(term => !enhancedTerms.includes(term));
    const maxWords = Math.max(normalize(baseline.text).split(' ').length, normalize(enhanced.text).split(' ').length, 1);
    const changeRate = levenshteinWords(baseline.text, enhanced.text) / maxWords;

    reports.push({
      audio: audioPath,
      model: MODEL,
      lexiconHotwordsCount: lexiconHotwords?.split(', ').length || 0,
      hotwordsCount: hotwords?.split(', ').length || 0,
      baseline,
      lexiconOnlyRaw,
      loshonKodeshOnlyRaw,
      enhanced,
      enhancedRawText: enhancedRaw.text,
      knowledgeApplied: knowledge,
      comparison: {
        changeRate,
        baselineTermCount: baselineTerms.length,
        enhancedTermCount: enhancedTerms.length,
        baselineTerms,
        enhancedTerms,
        addedTerms,
        removedTerms,
        referenceAvailable: false,
      },
    });

    console.log(`  changed: ${(changeRate * 100).toFixed(1)}% | terms: ${baselineTerms.length} -> ${enhancedTerms.length}`);
    console.log(`  added terms: ${addedTerms.join(', ') || 'none'}`);
    console.log(`  removed terms: ${removedTerms.join(', ') || 'none'}`);
    console.log(`  BASE: ${baseline.text}`);
    console.log(`  NEW : ${enhanced.text}`);
  }

  const outputDir = path.resolve('בדיקות איכות תמלול', 'results');
  await fs.mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(outputDir, `torah-lexicon-ab-${stamp}.json`);
  await fs.writeFile(outputPath, JSON.stringify({ createdAt: new Date().toISOString(), reports }, null, 2), 'utf8');
  console.log(`\nReport: ${outputPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

type TranscriptDisplayFields = {
  title?: unknown;
  text?: unknown;
  edited_text?: unknown;
};

export const safeTranscriptString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

export const getTranscriptDisplay = (transcript: TranscriptDisplayFields) => {
  const title = safeTranscriptString(transcript.title).trim();
  const text = safeTranscriptString(transcript.text).trim();
  const editedText = safeTranscriptString(transcript.edited_text).trim();
  const content = editedText || text;

  return {
    title: title || content.substring(0, 60) || 'ללא כותרת',
    content,
  };
};

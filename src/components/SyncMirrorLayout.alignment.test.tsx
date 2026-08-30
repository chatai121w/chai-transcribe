import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncMirrorLayout } from './SyncMirrorLayout';

vi.mock('./ExportButton', () => ({ ExportButton: () => null }));

const makeTranscript = () => Array.from({ length: 5_619 }, (_, index) => (
  index % 60 === 59 ? `word-${index}.` : `word-${index}`
));

const makeTimings = (words: readonly string[]) => words.map((word, index) => ({
  word,
  start: index * 0.25,
  end: index * 0.25 + 0.2,
}));

describe('SyncMirrorLayout padded alignment', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('sync_mirror_locked_pane', 'right');
    localStorage.setItem('sync_mirror_alignment_mode', 'mirrored-padded');
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('builds synthetic timings when a transcript has no word timings', async () => {
    const text = 'תמלול ללא חותמות זמן שעדיין צריך להופיע בעורך';
    const view = render(
      <SyncMirrorLayout
        wordTimings={[]}
        currentTime={0}
        text={text}
        syncEnabled={false}
        onTextChange={vi.fn()}
        onWordReplace={vi.fn()}
        onWordClick={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(view.container.textContent).toContain(text);
    });
  });

  it('keeps a large locked snapshot block-aligned after distant edits', async () => {
    const originalWords = makeTranscript();
    const originalText = originalWords.join(' ');
    const callbacks = {
      onTextChange: vi.fn(),
      onWordReplace: vi.fn(),
      onWordClick: vi.fn(),
    };
    const view = render(
      <SyncMirrorLayout
        wordTimings={makeTimings(originalWords)}
        currentTime={0}
        text={originalText}
        syncEnabled={false}
        {...callbacks}
      />,
    );

    await waitFor(() => {
      expect(view.container.querySelectorAll('[data-line]').length).toBeGreaterThan(120);
    }, { timeout: 10_000 });

    const editedWords = [...originalWords];
    editedWords[80] = 'edited-near-start';
    editedWords[5_500] = 'edited-near-end';
    view.rerender(
      <SyncMirrorLayout
        wordTimings={makeTimings(editedWords)}
        currentTime={0}
        text={editedWords.join(' ')}
        syncEnabled={false}
        {...callbacks}
      />,
    );

    await waitFor(() => {
      const editedMarkers = view.container.querySelectorAll('[title="שורה שנערכה"]');
      expect(editedMarkers.length).toBeGreaterThan(0);
      expect(editedMarkers.length).toBeLessThanOrEqual(8);
    }, { timeout: 10_000 });
  });
});

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findTextareaWordRange, replaceAllTextareaWordOccurrences, SyncMirrorLayout } from './SyncMirrorLayout';

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

  it('finds the word under the full-editor caret or selection', () => {
    expect(findTextareaWordRange('שלום עולם טוב', 7, 7)).toEqual({ start: 5, end: 9, word: 'עולם' });
    expect(findTextareaWordRange('שלום עולם טוב', 5, 9)).toEqual({ start: 5, end: 9, word: 'עולם' });
    expect(findTextareaWordRange('שלום עולם טוב', 4, 4)).toEqual({ start: 0, end: 4, word: 'שלום' });
  });

  it('replaces every exact word occurrence while preserving adjacent punctuation', () => {
    expect(replaceAllTextareaWordOccurrences('מומן אמר מומן, אבל מומנים נשאר', 'מומן', 'ממון')).toEqual({
      text: 'ממון אמר ממון, אבל מומנים נשאר',
      count: 2,
    });
  });

  it('reduces an accidental multi-word selection to one anchored word', () => {
    expect(findTextareaWordRange('מומן אמר ממון', 0, 8, 'forward')).toEqual({
      start: 0,
      end: 4,
      word: 'מומן',
    });
    expect(findTextareaWordRange('מומן אמר ממון', 0, 8, 'backward')).toEqual({
      start: 5,
      end: 8,
      word: 'אמר',
    });
  });

  it('opens one precise word on double click without native multi-word selection', async () => {
    const text = 'שלום עולם טוב';
    const user = userEvent.setup();
    const onWordReplace = vi.fn();
    const view = render(
      <SyncMirrorLayout
        wordTimings={makeTimings(text.split(' '))}
        currentTime={0}
        text={text}
        syncEnabled={false}
        onTextChange={vi.fn()}
        onWordReplace={onWordReplace}
        onWordClick={vi.fn()}
      />,
    );

    const word = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('[data-word-index="1"][data-word-side="left"]');
      expect(element).not.toBeNull();
      return element!;
    });
    expect(fireEvent.mouseDown(word, { detail: 2, button: 0 })).toBe(false);
    fireEvent.doubleClick(word, { clientX: 40, clientY: 40 });

    const menu = await screen.findByRole('menu');
    const panel = screen.getByTestId('floating-word-correction');
    const dragHandle = screen.getByTestId('word-correction-drag-handle');
    expect(panel).toHaveStyle({ resize: 'both' });
    fireEvent.pointerDown(dragHandle, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(dragHandle, { pointerId: 1, clientX: 40, clientY: 30 });
    fireEvent.pointerUp(dragHandle, { pointerId: 1, clientX: 40, clientY: 30 });
    expect(panel.style.translate).not.toBe('0px 0px');

    await user.click(screen.getByRole('button', { name: 'מזער חלון תיקון' }));
    expect(screen.queryByRole('textbox', { name: 'תיקון מהיר' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'שחזר חלון תיקון' }));
    expect(await screen.findByRole('textbox', { name: 'תיקון מהיר' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'הגדל חלון תיקון' }));
    expect(panel).toHaveStyle({ resize: 'none' });
    await user.click(screen.getByRole('button', { name: 'החזר לגודל רגיל' }));
    expect(panel).toHaveStyle({ resize: 'both' });

    expect(within(menu).getByRole('textbox', { name: 'תיקון מהיר' })).toHaveValue('עולם');
    expect(within(menu).queryByText('שלום עולם טוב', { exact: true })).not.toBeInTheDocument();

    const nextWord = view.container.querySelector<HTMLElement>('[data-word-index="2"][data-word-side="left"]');
    expect(nextWord).not.toBeNull();
    fireEvent.mouseDown(nextWord!, { detail: 2, button: 0 });
    fireEvent.doubleClick(nextWord!, { clientX: 80, clientY: 40 });

    await waitFor(() => {
      expect(within(screen.getByRole('menu')).getByRole('textbox', { name: 'תיקון מהיר' })).toHaveValue('טוב');
    });

    const quickInput = screen.getByRole('textbox', { name: 'תיקון מהיר' });
    await waitFor(() => expect(quickInput).toHaveFocus());
    await user.keyboard('חדש{Enter}');
    expect(onWordReplace).toHaveBeenCalledWith(2, 'חדש');
  });

  it('opens the shared correction menu in full edit mode', async () => {
    const text = 'שלום עולם טוב';
    const onTextChange = vi.fn();
    const onWordClick = vi.fn();
    render(
      <SyncMirrorLayout
        wordTimings={makeTimings(text.split(' '))}
        currentTime={0}
        text={text}
        syncEnabled={false}
        onTextChange={onTextChange}
        onWordReplace={vi.fn()}
        onWordClick={onWordClick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'עריכה מלאה' }));
    const originalWord = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-full-edit-original-word="true"][data-word-index="1"]');
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.click(originalWord);
    expect(onWordClick).toHaveBeenCalledWith(0.25);

    const textarea = await screen.findByTestId('full-edit-textarea') as HTMLTextAreaElement;
    textarea.setSelectionRange(5, 9);
    fireEvent.contextMenu(textarea);

    expect(await screen.findByText('מחק מילה', { exact: true })).toBeVisible();
    expect(within(screen.getByRole('menu')).getByRole('textbox', { name: 'תיקון מהיר' })).toHaveValue('עולם');
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]).toHaveTextContent('מילים דומות');
    fireEvent.click(screen.getByText('מחק מילה', { exact: true }));
    expect(onTextChange).toHaveBeenCalledWith('שלום טוב');
  });

  it('opens the RTL correction menu on double click and can replace all occurrences', async () => {
    const user = userEvent.setup();
    const text = 'מומן אמר מומן';
    const onTextChange = vi.fn();
    render(
      <SyncMirrorLayout
        wordTimings={makeTimings(text.split(' '))}
        currentTime={0}
        text={text}
        syncEnabled={false}
        onTextChange={onTextChange}
        onWordReplace={vi.fn()}
        onWordClick={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'עריכה מלאה' }));
    const textarea = await screen.findByTestId('full-edit-textarea') as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 4);
    fireEvent.doubleClick(textarea, { clientX: 40, clientY: 40 });

    const replaceAll = await screen.findByText('תקן בכל הטקסט', { exact: true });
    expect(screen.getByRole('menu')).toHaveAttribute('dir', 'rtl');
    await user.click(replaceAll);
    const menus = await screen.findAllByRole('menu');
    const replaceAllMenu = menus[menus.length - 1];
    const input = within(replaceAllMenu).getByDisplayValue('מומן');
    fireEvent.change(input, { target: { value: 'ממון' } });
    expect(within(replaceAllMenu).getByRole('menuitem', { name: 'החלף הכל' })).not.toHaveAttribute('data-disabled');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(onTextChange).toHaveBeenCalledWith('ממון אמר ממון'));
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

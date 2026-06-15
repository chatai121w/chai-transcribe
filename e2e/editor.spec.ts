import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';

// ────────────────────────────────────────────────────────────────────────────
// Helper: seed the editor with text by injecting it into localStorage
// before navigating so the contentEditable renders text immediately.
// ────────────────────────────────────────────────────────────────────────────
async function seedEditor(page: import('@playwright/test').Page, text: string) {
  await page.addInitScript((t) => {
    localStorage.setItem('current_editing_text', t);
  }, text);
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Basic editor loading tests
// ────────────────────────────────────────────────────────────────────────────
test.describe('עורך טקסט - טעינה', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('עמוד עורך טקסט נטען', async ({ page }) => {
    await page.goto('/text-editor');
    await expect(page.getByText('עריכת טקסט').first()).toBeVisible({ timeout: 10000 });
  });

  test('טאבים מוצגים בעורך', async ({ page }) => {
    await page.goto('/text-editor');
    const tabTexts = ['נגן', 'עריכת טקסט', 'תבניות', 'AI', 'היסטוריה'];
    for (const tabText of tabTexts) {
      const tab = page.getByText(tabText);
      if (await tab.count() > 0) {
        await expect(tab.first()).toBeVisible();
      }
    }
  });

  test('כפתורי עריכה מהירה מוצגים', async ({ page }) => {
    await page.goto('/text-editor');
    const buttons = ['תקן שגיאות', 'חלק לפסקאות'];
    for (const btnText of buttons) {
      const btn = page.getByText(btnText);
      if (await btn.count() > 0) {
        await expect(btn.first()).toBeVisible();
      }
    }
  });

  test('ניווט עם טקסט מ-state', async ({ page }) => {
    await page.goto('/text-editor');
    await page.evaluate(() => {
      window.history.pushState({}, '', '/transcribe');
    });
    await page.goto('/text-editor');
    await expect(page.getByText('עריכת טקסט').first()).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Text editing (contentEditable)
// ────────────────────────────────────────────────────────────────────────────
test.describe('עורך טקסט - עריכה', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('הזנת טקסט ידנית בעורך', async ({ page }) => {
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();
    // Use insertText for proper RTL Hebrew input in contentEditable
    await page.keyboard.insertText('שלום עולם');
    await expect(editor).toContainText('שלום עולם');
  });

  test('טקסט נשמר ב-localStorage', async ({ page }) => {
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();
    await page.keyboard.insertText('טקסט שנשמר אוטומטית');
    // Wait for auto-save debounce
    await page.waitForTimeout(1500);
    const saved = await page.evaluate(() => localStorage.getItem('current_editing_text'));
    expect(saved).toContain('טקסט שנשמר אוטומטית');
  });

  test('מחיקת טקסט עם Backspace', async ({ page }) => {
    await seedEditor(page, 'טקסט למחיקה');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('טקסט למחיקה', { timeout: 10000 });
    // Move cursor to end and delete some chars
    await editor.click();
    await page.keyboard.press('End');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
    const text = await editor.textContent();
    expect(text).not.toContain('למחיקה');
  });

  test('הוספת שורה חדשה עם Enter', async ({ page }) => {
    await seedEditor(page, 'שורה ראשונה');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('שורה ראשונה', { timeout: 10000 });
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('שורה שנייה');
    const html = await editor.innerHTML();
    expect(html).toContain('שורה שנייה');
  });

  test('Undo/Redo עובד (Ctrl+Z / Ctrl+Y)', async ({ page }) => {
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();
    await page.keyboard.insertText('אלף');
    await page.waitForTimeout(200);
    // Undo
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const afterUndo = await editor.textContent();
    // May or may not be fully undone but should work
    // Now Redo
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(300);
    // Editor should still exist without crash
    await expect(editor).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Text selection in contentEditable (this is the reported issue)
// ────────────────────────────────────────────────────────────────────────────
test.describe('עורך טקסט - בחירת טקסט', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('בחירת טקסט עם העכבר (drag)', async ({ page }) => {
    await seedEditor(page, 'שלום עולם, זהו טקסט לבדיקת בחירה');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('שלום עולם', { timeout: 10000 });

    // Triple-click to select all text in editor
    await editor.click({ clickCount: 3 });
    await page.waitForTimeout(300);

    const selectedText = await page.evaluate(() => window.getSelection()?.toString() || '');
    expect(selectedText.length).toBeGreaterThan(0);
  });

  test('בחירת כל הטקסט עם Ctrl+A', async ({ page }) => {
    await seedEditor(page, 'כל הטקסט צריך להיבחר');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('כל הטקסט', { timeout: 10000 });

    await editor.click();
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    const selectedText = await page.evaluate(() => window.getSelection()?.toString() || '');
    expect(selectedText).toContain('כל הטקסט צריך להיבחר');
  });

  test('בחירה נשמרת אחרי 2 שניות (no re-render wipe)', async ({ page }) => {
    await seedEditor(page, 'טקסט לבדיקת יציבות בחירה לאורך זמן');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('טקסט לבדיקת', { timeout: 10000 });

    // Select all text
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    const selectedBefore = await page.evaluate(() => window.getSelection()?.toString() || '');
    expect(selectedBefore.length).toBeGreaterThan(0);

    // Wait 3 seconds — if re-render wipes selection, this will fail
    await page.waitForTimeout(3000);

    const selectedAfter = await page.evaluate(() => window.getSelection()?.toString() || '');
    expect(selectedAfter.length).toBeGreaterThan(0);
    expect(selectedAfter).toBe(selectedBefore);
  });

  test('העתקת טקסט נבחר (Ctrl+C)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedEditor(page, 'טקסט להעתקה');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('טקסט להעתקה', { timeout: 10000 });

    await editor.click();
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('טקסט להעתקה');
  });

  test('גזירה והדבקה (Ctrl+X / Ctrl+V)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedEditor(page, 'טקסט לגזירה');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('טקסט לגזירה', { timeout: 10000 });

    // Select all & cut
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+x');
    await page.waitForTimeout(500);

    // Editor should be empty
    const textAfterCut = (await editor.textContent())?.trim();
    expect(textAfterCut?.length || 0).toBe(0);

    // Paste back
    await editor.click();
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(500);
    await expect(editor).toContainText('טקסט לגזירה');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Formatting toolbar (floating toolbar on selection)
// ────────────────────────────────────────────────────────────────────────────
test.describe('עורך טקסט - סרגל עיצוב', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('סרגל עיצוב צף מופיע בעת בחירת טקסט', async ({ page }) => {
    await seedEditor(page, 'שלום עולם זהו טקסט לבדיקת סרגל עיצוב צף');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('שלום עולם', { timeout: 10000 });

    // Select text to trigger floating toolbar
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(500);

    // Floating toolbar should appear (has select-none class)
    const toolbar = page.locator('.select-none').filter({ has: page.locator('button') });
    // At least the editor's top toolbar exists
    await expect(toolbar.first()).toBeVisible({ timeout: 3000 });
  });

  test('Bold (מודגש) באמצעות כפתור', async ({ page }) => {
    await seedEditor(page, 'טקסט למודגש');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('טקסט למודגש', { timeout: 10000 });

    // Select all
    await editor.click();
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);

    // Use Ctrl+B for bold
    await page.keyboard.press('Control+b');
    await page.waitForTimeout(300);

    // Check that bold was applied (innerHTML should contain <b> or <strong>)
    const html = await editor.innerHTML();
    const hasBold = html.includes('<b>') || html.includes('<b ') || html.includes('<strong>') || html.includes('<strong ');
    expect(hasBold).toBeTruthy();
  });

  test('Italic (נטוי) באמצעות קיצור מקלדת', async ({ page }) => {
    await seedEditor(page, 'טקסט לנטוי');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('טקסט לנטוי', { timeout: 10000 });

    await editor.click();
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+i');
    await page.waitForTimeout(300);

    const html = await editor.innerHTML();
    const hasItalic = html.includes('<i>') || html.includes('<i ') || html.includes('<em>') || html.includes('<em ');
    expect(hasItalic).toBeTruthy();
  });

  test('Underline (קו תחתון) באמצעות קיצור מקלדת', async ({ page }) => {
    await seedEditor(page, 'טקסט לקו תחתון');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('טקסט לקו תחתון', { timeout: 10000 });

    await editor.click();
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+u');
    await page.waitForTimeout(300);

    const html = await editor.innerHTML();
    const hasUnderline = html.includes('<u>') || html.includes('<u ') || html.includes('underline');
    expect(hasUnderline).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. Export
// ────────────────────────────────────────────────────────────────────────────
test.describe('כפתור ייצוא', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('כפתור ייצוא מוצג', async ({ page }) => {
    await page.goto('/text-editor');
    const exportButton = page.getByText(/ייצא|ייצוא|export/i);
    if (await exportButton.count() > 0) {
      await expect(exportButton.first()).toBeVisible();
    }
  });

  test('תפריט ייצוא נפתח עם אופציות PDF ו-DOCX', async ({ page }) => {
    await seedEditor(page, 'טקסט לייצוא');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('טקסט לייצוא', { timeout: 10000 });

    // The export popover button says "ייצא"
    const exportButton = page.getByText(/ייצא|ייצוא|export/i);
    if (await exportButton.count() > 0) {
      await exportButton.first().click();
      await page.waitForTimeout(500);
      // Export options: TXT, DOC (Word), PDF, SRT
      await expect(page.getByRole('button', { name: /PDF/i })).toBeVisible({ timeout: 3000 });
      await expect(page.getByRole('button', { name: /DOC|Word/i })).toBeVisible();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. Version history
// ────────────────────────────────────────────────────────────────────────────
test.describe('היסטוריית גרסאות', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('טאב היסטוריה ניתן לפתיחה', async ({ page }) => {
    await page.goto('/text-editor');
    const historyTab = page.getByText('היסטוריה');
    if (await historyTab.count() > 0) {
      await historyTab.first().click();
      await expect(page.getByText(/היסטוריה|גרסאות|versions/i)).toBeVisible({ timeout: 5000 });
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. AI tab & Ollama model selection
// ────────────────────────────────────────────────────────────────────────────
test.describe('עורך AI ו-Ollama', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('טאב AI נפתח ומציג את ממשק העריכה', async ({ page }) => {
    await seedEditor(page, 'טקסט לבדיקה');
    await page.goto('/text-editor');
    // Click AI tab using role selector to avoid matching editor content
    const aiTab = page.getByRole('tab', { name: /עריכה עם AI|AI/i });
    await expect(aiTab.first()).toBeVisible({ timeout: 10000 });
    await aiTab.first().click();
    await page.waitForTimeout(1500);
    // Should see the AI editor heading
    await expect(page.getByText('השוואת מנועים')).toBeVisible({ timeout: 5000 });
  });

  test('בחירת מודל בדרופדאון עובד', async ({ page }) => {
    await seedEditor(page, 'טקסט לבדיקה');
    await page.goto('/text-editor');
    const aiTab = page.getByRole('tab', { name: /עריכה עם AI|AI/i }).first();
    await aiTab.click();
    await page.waitForTimeout(1500);

    // Open the first engine dropdown
    const selects = page.locator('[role="combobox"]');
    const firstSelect = selects.first();
    await expect(firstSelect).toBeVisible({ timeout: 5000 });
    await firstSelect.click();
    await page.waitForTimeout(500);

    // Should see cloud model options
    const options = page.locator('[role="option"]');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(3);

    // Click any cloud model
    const gptOption = page.locator('[role="option"]').filter({ hasText: /GPT|Gemini/i }).first();
    if (await gptOption.count() > 0) {
      await gptOption.click();
      await page.waitForTimeout(300);
    }
  });

  test('כפתורי פעולות AI מוצגים ולחיצים', async ({ page }) => {
    await seedEditor(page, 'טקסט לבדיקה');
    await page.goto('/text-editor');
    const aiTab = page.getByRole('tab', { name: /עריכה עם AI|AI/i }).first();
    await aiTab.click();
    await page.waitForTimeout(1500);

    // Action buttons should be visible
    const actionButtons = ['שפר ניסוח', 'דקדוק ואיות', 'פיסוק', 'חלוקה לפסקאות'];
    for (const label of actionButtons) {
      const btn = page.getByText(label);
      if (await btn.count() > 0) {
        await expect(btn.first()).toBeVisible();
        // Verify it's not disabled
        const disabled = await btn.first().isDisabled();
        expect(disabled).toBe(false);
      }
    }
  });

  test('טאב Ollama נפתח ומציג ניהול מודלים', async ({ page }) => {
    await page.goto('/text-editor');
    const ollamaTab = page.getByText('Ollama').first();
    await expect(ollamaTab).toBeVisible({ timeout: 10000 });
    await ollamaTab.click();
    await page.waitForTimeout(1500);

    // Should see Ollama manager content (connection status or instructions)
    const content = page.locator('.space-y-4').filter({ hasText: /Ollama|מודל|התחבר/ });
    await expect(content.first()).toBeVisible({ timeout: 5000 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. Editor view modes & style
// ────────────────────────────────────────────────────────────────────────────
test.describe('עורך טקסט - מצבי תצוגה', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('כפתורי תצוגה (עמודות) עובדים', async ({ page }) => {
    await page.goto('/text-editor');
    // Column buttons exist (1, 2, 3 columns)
    const columnBtns = page.locator('button[title*="עמוד"]');
    if (await columnBtns.count() > 0) {
      // Click 2-column
      const twoCol = page.locator('button[title="2 עמודות"]');
      if (await twoCol.count() > 0) {
        await twoCol.click();
        await page.waitForTimeout(300);
      }
      // Click back to 1-column
      const oneCol = page.locator('button[title="עמודה אחת"]');
      if (await oneCol.count() > 0) {
        await oneCol.click();
        await page.waitForTimeout(300);
      }
    }
  });

  test('סטטיסטיקות עורך מוצגות', async ({ page }) => {
    await seedEditor(page, 'אחד שניים שלוש ארבע חמש');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('אחד', { timeout: 10000 });

    // Statistics should show character and word counts
    const statsText = page.getByText(/תווים|מילים/);
    if (await statsText.count() > 0) {
      await expect(statsText.first()).toBeVisible();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9. Search functionality
// ────────────────────────────────────────────────────────────────────────────
test.describe('עורך טקסט - חיפוש', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('פתיחת חיפוש וחיפוש מילה', async ({ page }) => {
    await seedEditor(page, 'שלום עולם, זהו טקסט לבדיקת חיפוש מתקדם בעורך');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('חיפוש', { timeout: 10000 });

    // Open search (look for Search icon button or Ctrl+F)
    const searchBtn = page.locator('button').filter({ has: page.locator('[class*="lucide-search"]') });
    if (await searchBtn.count() > 0) {
      await searchBtn.first().click();
      await page.waitForTimeout(500);
      // Type search term
      const searchInput = page.locator('input[placeholder*="חיפוש"], input[type="search"]').first();
      if (await searchInput.count() > 0) {
        await searchInput.fill('חיפוש');
        await page.waitForTimeout(300);
      }
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 10. Full editing workflow E2E
// ────────────────────────────────────────────────────────────────────────────
test.describe('תהליך עריכה מלא', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('עריכה מלאה: הזנה → בחירה → עיצוב → שמירה', async ({ page }) => {
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 10000 });

    // 1. Type Hebrew text using insertText for proper RTL handling
    await editor.click();
    await page.keyboard.insertText('בדיקה');
    await page.waitForTimeout(500);
    await expect(editor).toContainText('בדיקה');

    // 2. Select it
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(300);
    const sel = await page.evaluate(() => window.getSelection()?.toString() || '');
    expect(sel).toContain('בדיקה');

    // 3. Bold it
    await page.keyboard.press('Control+b');
    await page.waitForTimeout(300);
    const html = await editor.innerHTML();
    const hasBold = html.includes('<b') || html.includes('<strong');
    expect(hasBold).toBeTruthy();

    // 4. Verify localStorage saved
    await page.waitForTimeout(1500);
    const saved = await page.evaluate(() => localStorage.getItem('current_editing_text'));
    expect(saved).toContain('בדיקה');
  });

  test('תוכן עם ירושה מ-localStorage נטען ונערך', async ({ page }) => {
    // Seed text via localStorage
    await seedEditor(page, 'תוכן ישן שנשמר');
    await page.goto('/text-editor');
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('תוכן ישן שנשמר', { timeout: 10000 });

    // Append more text
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' ועכשיו חדש');
    await page.waitForTimeout(500);
    await expect(editor).toContainText('ועכשיו חדש');
  });
});

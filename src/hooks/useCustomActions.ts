/**
 * Persistent custom AI edit actions — user can add, edit, delete, reorder.
 * Stored in localStorage. Built-in actions can be hidden but not deleted.
 */

import { useState, useCallback, useEffect } from 'react';

export type ActionCategory = 'language' | 'structure' | 'length' | 'special' | 'custom';

export interface CustomAction {
  id: string;
  label: string;
  prompt: string;
  icon: string;  // lucide icon name or emoji
  category: ActionCategory;
  builtin: boolean;  // true = default actions, can hide but not delete
  hidden: boolean;
  order: number;
}

const STORAGE_KEY = 'ai_editor_custom_actions_v1';
const VIEW_MODE_KEY = 'ai_editor_view_mode';

export type ViewMode = 'grid' | 'compact' | 'list' | 'masonry';

// ── Built-in defaults ──────────────────────────────────────

const BUILTIN_ACTIONS: CustomAction[] = [
  // ניסוח ושפה
  { id: 'improve', label: 'שפר ניסוח', prompt: 'אתה עורך מקצועי. שפר את הניסוח של הטקסט הבא כך שיהיה ברור ומקצועי יותר. השאר את המשמעות והתוכן זהים, רק שפר את הניסוח והדקדוק.', icon: 'Wand2', category: 'language', builtin: true, hidden: false, order: 0 },
  { id: 'grammar', label: 'דקדוק ואיות', prompt: 'אתה מגיה מקצועי. תקן שגיאות דקדוק, כתיב ואיות בטקסט הבא. אל תשנה את המשמעות או הסגנון, רק תקן שגיאות שפה. החזר את הטקסט המתוקן בלבד.', icon: 'CheckCheck', category: 'language', builtin: true, hidden: false, order: 1 },
  { id: 'punctuation', label: 'פיסוק', prompt: 'אתה עורך מקצועי. הוסף סימני פיסוק מתאימים לטקסט הבא — נקודות, פסיקים, סימני שאלה וקריאה. וודא שהפיסוק תקין ומשפר את הקריאות. החזר את הטקסט עם הפיסוק בלבד.', icon: 'Quote', category: 'language', builtin: true, hidden: false, order: 2 },
  { id: 'readable', label: 'זורם לקריאה', prompt: 'אתה עורך מקצועי. עשה את הטקסט הבא קריא וזורם יותר. חלק למשפטים קצרים, הוסף סימני פיסוק מתאימים, וודא שהטקסט קל לקריאה ולהבנה.', icon: 'BookOpen', category: 'language', builtin: true, hidden: false, order: 3 },
  // מבנה
  { id: 'paragraphs', label: 'חלק לפסקאות', prompt: 'אתה עורך מקצועי. חלק את הטקסט הבא לפסקאות לוגיות. הוסף שורה ריקה בין פסקאות. אל תשנה את התוכן עצמו, רק את המבנה.', icon: 'AlignJustify', category: 'structure', builtin: true, hidden: false, order: 10 },
  { id: 'headings', label: 'כותרות', prompt: 'אתה עורך מקצועי. הוסף כותרת ראשית ותתי-כותרות מתאימות לטקסט הבא. השתמש בסימון: # לכותרת ראשית, ## לתת-כותרת. שמור על כל התוכן המקורי.', icon: 'Heading', category: 'structure', builtin: true, hidden: false, order: 11 },
  { id: 'bullets', label: 'נקודות מפתח', prompt: 'אתה עורך מקצועי. הפק רשימת נקודות מפתח (bullet points) מהטקסט הבא. כל נקודה תהיה משפט קצר וברור. השתמש בתבליטים (•). שמור על כל המידע החשוב.', icon: 'List', category: 'structure', builtin: true, hidden: false, order: 12 },
  // אורך
  { id: 'expand', label: 'הרחב', prompt: 'אתה עורך מקצועי. הרחב את הטקסט הבא — הוסף פרטים, הסברים ודוגמאות. שמור על הנושא והסגנון המקורי. הפוך כל נקודה למפורטת יותר.', icon: 'Maximize2', category: 'length', builtin: true, hidden: false, order: 20 },
  { id: 'shorten', label: 'קצר', prompt: 'אתה עורך מקצועי. קצר את הטקסט הבא לכמחצית מאורכו המקורי. שמור על הנקודות החשובות ביותר. הסר חזרות ומידע משני.', icon: 'Minimize2', category: 'length', builtin: true, hidden: false, order: 21 },
  { id: 'summarize', label: 'סכם', prompt: 'אתה עוזר שמסכם טקסטים בעברית. צור סיכום תמציתי של 3-5 משפטים, תוך שמירה על נקודות המפתח החשובות ביותר. הסיכום חייב להיות בעברית.', icon: 'FileText', category: 'length', builtin: true, hidden: false, order: 22 },
  // מיוחד
  { id: 'sources', label: 'הוסף מקורות', prompt: 'אתה עורך מחקרי. הוסף הערות ומקורות אפשריים לטקסט הבא. סמן מקומות שבהם כדאי להוסיף מקורות או ציטוטים עם [מקור נדרש]. אל תמציא מקורות, רק ציין היכן הם נחוצים.', icon: 'FileText', category: 'special', builtin: true, hidden: false, order: 30 },
  { id: 'speakers', label: 'זהה דוברים', prompt: 'אתה מומחה בזיהוי דוברים. נתח את הטקסט הבא (שנוצר מתמלול שיחה) וזהה את הדוברים השונים. סמן כל דובר עם תווית (דובר 1:, דובר 2: וכו\') בתחילת כל קטע דיבור שלו. אם לא ניתן להבחין — סמן עם [החלפת דובר].', icon: 'Users', category: 'special', builtin: true, hidden: false, order: 31 },
];

const CATEGORY_LABELS: Record<ActionCategory, string> = {
  language: 'ניסוח ושפה',
  structure: 'מבנה',
  length: 'אורך',
  special: 'מיוחד',
  custom: 'מותאם אישית',
};

const CATEGORY_ORDER: ActionCategory[] = ['language', 'structure', 'length', 'special', 'custom'];

// ── Hook ─────────────────────────────────────────────────────

export function useCustomActions() {
  const [actions, setActions] = useState<CustomAction[]>(() => loadActions());
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) || 'grid'
  );

  // Persist on change
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(actions)); } catch {}
  }, [actions]);

  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch {}
  }, [viewMode]);

  const visibleActions = actions.filter(a => !a.hidden).sort((a, b) => a.order - b.order);

  const groupedActions = CATEGORY_ORDER
    .map(cat => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      actions: visibleActions.filter(a => a.category === cat),
    }))
    .filter(g => g.actions.length > 0);

  const addAction = useCallback((action: Omit<CustomAction, 'id' | 'builtin' | 'hidden' | 'order'>) => {
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const maxOrder = Math.max(...actions.map(a => a.order), 0);
    setActions(prev => [...prev, { ...action, id, builtin: false, hidden: false, order: maxOrder + 1 }]);
    return id;
  }, [actions]);

  const updateAction = useCallback((id: string, updates: Partial<Pick<CustomAction, 'label' | 'prompt' | 'icon' | 'category'>>) => {
    setActions(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  }, []);

  const deleteAction = useCallback((id: string) => {
    setActions(prev => {
      const action = prev.find(a => a.id === id);
      if (!action) return prev;
      if (action.builtin) {
        // Built-in: just hide
        return prev.map(a => a.id === id ? { ...a, hidden: true } : a);
      }
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const toggleHidden = useCallback((id: string) => {
    setActions(prev => prev.map(a => a.id === id ? { ...a, hidden: !a.hidden } : a));
  }, []);

  const resetToDefaults = useCallback(() => {
    setActions(BUILTIN_ACTIONS.map(a => ({ ...a })));
  }, []);

  const getActionPrompt = useCallback((id: string): string => {
    const action = actions.find(a => a.id === id);
    return action?.prompt || '';
  }, [actions]);

  return {
    actions,
    visibleActions,
    groupedActions,
    viewMode,
    setViewMode,
    addAction,
    updateAction,
    deleteAction,
    toggleHidden,
    resetToDefaults,
    getActionPrompt,
    CATEGORY_LABELS,
  };
}

// ── Load from localStorage ───────────────────────────────────

function loadActions(): CustomAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: CustomAction[] = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Merge: ensure all built-in actions exist (user may have old version)
        const existingIds = new Set(parsed.map(a => a.id));
        const missing = BUILTIN_ACTIONS.filter(b => !existingIds.has(b.id));
        return [...parsed, ...missing];
      }
    }
  } catch {}
  return BUILTIN_ACTIONS.map(a => ({ ...a }));
}

export { CATEGORY_LABELS, CATEGORY_ORDER, BUILTIN_ACTIONS };

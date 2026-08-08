// Design Mode overrides — calc unique selectors, store per-element/per-class CSS,
// and inject them as a <style> tag on the live app.

export type OverrideScope = 'element' | 'class' | 'global';

export interface DesignOverride {
  id: string;
  scope: OverrideScope;
  selector: string;        // CSS selector
  label?: string;          // human label for UI list
  css: Record<string, string>; // property -> value
  createdAt: number;
}

const STORAGE_KEY = 'design_overrides_v1';
const STYLE_ELEMENT_ID = 'design-mode-overrides';

/** Compute a stable unique CSS selector for an element. */
export function computeSelector(el: Element): string {
  // 1. id wins
  if (el.id) return `#${CSS.escape(el.id)}`;
  // 2. data-testid
  const testid = el.getAttribute('data-testid');
  if (testid) return `[data-testid="${testid}"]`;

  // 3. walk up max 5 levels building nth-child path; stop on id/testid
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur !== document.body && depth < 6) {
    if (cur.id) { parts.unshift(`#${CSS.escape(cur.id)}`); break; }
    const tid = cur.getAttribute('data-testid');
    if (tid) { parts.unshift(`[data-testid="${tid}"]`); break; }
    const parent = cur.parentElement;
    if (!parent) break;
    const idx = Array.from(parent.children).indexOf(cur) + 1;
    parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`);
    cur = parent;
    depth++;
  }
  return parts.join(' > ');
}

/** Class-signature selector for "all same kind on page". */
export function computeClassSelector(el: Element): string {
  const cls = (el.getAttribute('class') || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter(c => !c.startsWith('hover:') && !c.startsWith('focus:') && c.length < 40)
    .slice(0, 6);
  const tag = el.tagName.toLowerCase();
  if (cls.length === 0) return tag;
  return tag + cls.map(c => `.${CSS.escape(c)}`).join('');
}

/**
 * Tags that already identify what an element *is*. For these, the tag alone is a
 * meaningful "everything of this kind" selector.
 */
const SEMANTIC_TAGS = new Set([
  'button', 'a', 'input', 'textarea', 'select', 'label', 'table', 'th', 'td',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'nav', 'header',
  'footer', 'aside', 'section', 'article', 'form', 'fieldset', 'legend',
  'summary', 'details', 'dialog', 'img', 'svg', 'code', 'pre', 'blockquote',
]);

/** Utility classes that describe layout or spacing rather than identity. */
const LAYOUT_CLASS = /^(flex|grid|block|inline|hidden|absolute|relative|fixed|sticky|static|[mp][trblxy]?-|gap-|space-|w-|h-|min-|max-|top-|left-|right-|bottom-|inset-|z-|order-|col-|row-|justify-|items-|self-|content-|place-|overflow-|shrink|grow|basis-|truncate|whitespace-|break-)/;

/**
 * Broadest selector: "everything of this kind, anywhere".
 *
 * Distinct from computeClassSelector, which pins the element's whole class
 * signature and therefore only matches elements styled exactly the same way. This
 * one reaches variants too — every button rather than every button that happens to
 * share six utility classes.
 *
 * Generic containers get one identifying class attached, because a bare `div`
 * selector would match essentially the whole page.
 */
export function computeGlobalSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (SEMANTIC_TAGS.has(tag)) return tag;

  const classes = (el.getAttribute('class') || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter(c => !c.startsWith('hover:') && !c.startsWith('focus:') && c.length < 40)
    .filter(c => !LAYOUT_CLASS.test(c));

  // No identity to hold on to — fall back to the exact signature rather than
  // emitting a bare tag that would repaint the entire page.
  if (classes.length === 0) return computeClassSelector(el);
  return `${tag}.${CSS.escape(classes[0])}`;
}

/** How many elements a selector currently matches — used to label the scope buttons. */
export function countMatches(selector: string): number {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

/** Short human label for an element. */
export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  return `${tag}${id}${cls ? '.' + cls : ''}`;
}

export function loadOverrides(): DesignOverride[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveOverrides(list: DesignOverride[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  applyOverridesToDom(list);
}

export function applyOverridesToDom(list: DesignOverride[]) {
  let style = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    document.head.appendChild(style);
  }
  const css = list.map(o => {
    const decls = Object.entries(o.css).map(([k, v]) => `  ${k}: ${v} !important;`).join('\n');
    return `${o.selector} {\n${decls}\n}`;
  }).join('\n\n');
  style.textContent = css;
}

/** Init on app boot. */
export function initDesignOverrides() {
  applyOverridesToDom(loadOverrides());
}

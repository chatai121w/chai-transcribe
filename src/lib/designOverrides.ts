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

/**
 * סל השוואת A/B — אוסף תמלולים שהמשתמש סימן להשוואה.
 * נשמר ב-localStorage; שונה גודל מקסימלי 10.
 * תומך בהאזנה לשינויים דרך subscribe (event-based).
 */

export interface ABCartItem {
  id: string;
  label: string;
  text: string;
  addedAt: number;
}

const KEY = "ab_compare_cart_v1";
const MAX_ITEMS = 10;
const EVENT = "ab-compare-cart-changed";

function read(): ABCartItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(items: ABCartItem[], opts?: { silent?: boolean }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { silent: !!opts?.silent } }));
  } catch {
    /* ignore */
  }
}

export const abCart = {
  list(): ABCartItem[] {
    return read();
  },
  add(label: string, text: string): ABCartItem {
    const items = read();
    const item: ABCartItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: label || `פריט ${items.length + 1}`,
      text,
      addedAt: Date.now(),
    };
    write([item, ...items]);
    return item;
  },
  remove(id: string) {
    write(read().filter((i) => i.id !== id));
  },
  clear() {
    write([]);
  },
  count(): number {
    return read().length;
  },
  subscribe(cb: () => void): () => void {
    const handler = () => cb();
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  },
};

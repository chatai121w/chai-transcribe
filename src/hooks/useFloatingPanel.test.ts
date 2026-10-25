import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFloatingPanel } from './useFloatingPanel';

function pointer(type: string, x: number, y: number) {
  const e = new Event(type, { bubbles: true }) as PointerEvent & { clientX: number; clientY: number };
  Object.defineProperty(e, 'clientX', { value: x });
  Object.defineProperty(e, 'clientY', { value: y });
  return e;
}

/** אירוע שמגיע מהרכיב — צריך רק את השדות שההוק קורא. */
function reactPointer(x: number, y: number) {
  return { clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} } as unknown as React.PointerEvent;
}

function setViewport(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, writable: true, configurable: true });
}

const BASE = {
  storageKey: 'בדיקה',
  defaultSize: { width: 400, height: 300 },
  minSize: { width: 200, height: 150 },
  maxSize: { width: 800, height: 700 },
};

beforeEach(() => {
  window.localStorage.clear();
  setViewport(1200, 900);
});
afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('גודל ומיקום התחלתיים', () => {
  it('מתחיל בגודל שנקבע', () => {
    const { result } = renderHook(() => useFloatingPanel(BASE));
    expect(result.current.size).toEqual({ width: 400, height: 300 });
  });

  it('גודל גדול ממסך מצטמצם אליו', () => {
    // חלונית גדולה מהמסך אינה ניתנת לשימוש — אי אפשר להגיע לקצה.
    setViewport(360, 300);
    const { result } = renderHook(() => useFloatingPanel(BASE));
    expect(result.current.size.width).toBeLessThanOrEqual(360);
    expect(result.current.size.height).toBeLessThanOrEqual(300);
  });

  it('לא יורד מתחת למינימום', () => {
    setViewport(100, 100);
    const { result } = renderHook(() => useFloatingPanel(BASE));
    expect(result.current.size.width).toBe(200);
    expect(result.current.size.height).toBe(150);
  });
});

describe('גרירה', () => {
  it('מזיזה את החלונית', () => {
    const { result } = renderHook(() => useFloatingPanel(BASE));
    const start = { ...result.current.pos };
    act(() => { result.current.startMove(reactPointer(100, 100)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 160, 140)); });
    expect(result.current.pos.left).toBe(start.left + 60);
    expect(result.current.pos.top).toBe(start.top + 40);
  });

  it('אינה יוצאת מגבולות המסך', () => {
    // חלונית שנגררה החוצה אבודה: אין לאן ללחוץ כדי להחזיר אותה.
    const { result } = renderHook(() => useFloatingPanel(BASE));
    act(() => { result.current.startMove(reactPointer(0, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 9000, 9000)); });
    expect(result.current.pos.left + result.current.size.width).toBeLessThanOrEqual(1200);
    expect(result.current.pos.top + result.current.size.height).toBeLessThanOrEqual(900);
  });

  it('אינה יוצאת מהצד השני', () => {
    const { result } = renderHook(() => useFloatingPanel(BASE));
    act(() => { result.current.startMove(reactPointer(0, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', -9000, -9000)); });
    expect(result.current.pos.left).toBeGreaterThanOrEqual(0);
    expect(result.current.pos.top).toBeGreaterThanOrEqual(0);
  });

  it('משחררת ומפסיקה לעקוב', () => {
    const { result } = renderHook(() => useFloatingPanel(BASE));
    act(() => { result.current.startMove(reactPointer(0, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 50, 50)); });
    const after = { ...result.current.pos };
    act(() => { window.dispatchEvent(new Event('pointerup')); });
    act(() => { window.dispatchEvent(pointer('pointermove', 400, 400)); });
    expect(result.current.pos).toEqual(after);
  });
});

describe('שינוי גודל', () => {
  it('משיכה ימינה מרחיבה', () => {
    const { result } = renderHook(() => useFloatingPanel(BASE));
    act(() => { result.current.startResize('e', 'ew-resize')(reactPointer(0, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 80, 0)); });
    expect(result.current.size.width).toBe(480);
  });

  it('משיכה למטה מגביהה', () => {
    const { result } = renderHook(() => useFloatingPanel(BASE));
    act(() => { result.current.startResize('s', 'ns-resize')(reactPointer(0, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 0, 60)); });
    expect(result.current.size.height).toBe(360);
  });

  it('משיכה משמאל מזיזה גם את הפינה', () => {
    // בלי זה הקצה הנגדי זז במקום להישאר במקומו.
    //
    // החלונית מוזזת קודם למרכז: צמוד לקצה המסך ההגבלה גוברת
    // בצדק, והקצה הנגדי כן זז — וזאת התנהגות נכונה ולא באג.
    const { result } = renderHook(() => useFloatingPanel(BASE));
    act(() => { result.current.startMove(reactPointer(0, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 300, 200)); });
    act(() => { window.dispatchEvent(new Event('pointerup')); });
    const before = { left: result.current.pos.left, right: result.current.pos.left + result.current.size.width };
    act(() => { result.current.startResize('w', 'ew-resize')(reactPointer(500, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 460, 0)); });
    const after = { left: result.current.pos.left, right: result.current.pos.left + result.current.size.width };
    expect(after.right).toBe(before.right);
    expect(after.left).toBeLessThan(before.left);
  });

  it('פינה משנה את שני הממדים', () => {
    const { result } = renderHook(() => useFloatingPanel(BASE));
    act(() => { result.current.startResize('se', 'nwse-resize')(reactPointer(0, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 50, 40)); });
    expect(result.current.size).toEqual({ width: 450, height: 340 });
  });

  it('אינו עובר את המקסימום', () => {
    const { result } = renderHook(() => useFloatingPanel(BASE));
    act(() => { result.current.startResize('se', 'nwse-resize')(reactPointer(0, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 9000, 9000)); });
    expect(result.current.size.width).toBeLessThanOrEqual(800);
    expect(result.current.size.height).toBeLessThanOrEqual(700);
  });

  it('אינו יורד מתחת למינימום', () => {
    const { result } = renderHook(() => useFloatingPanel(BASE));
    act(() => { result.current.startResize('se', 'nwse-resize')(reactPointer(0, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', -9000, -9000)); });
    expect(result.current.size).toEqual({ width: 200, height: 150 });
  });
});

describe('שמירה והחזרה', () => {
  it('הגודל נשמר ונטען', () => {
    const { result, unmount } = renderHook(() => useFloatingPanel(BASE));
    act(() => { result.current.startResize('e', 'ew-resize')(reactPointer(0, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 100, 0)); });
    unmount();

    const again = renderHook(() => useFloatingPanel(BASE));
    expect(again.result.current.size.width).toBe(500);
  });

  it('ההחזרה מחזירה לגודל המקורי', () => {
    const { result } = renderHook(() => useFloatingPanel(BASE));
    act(() => { result.current.startResize('e', 'ew-resize')(reactPointer(0, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 200, 0)); });
    expect(result.current.size.width).toBe(600);
    act(() => { result.current.reset(); });
    expect(result.current.size).toEqual({ width: 400, height: 300 });
  });

  it('אחסון חסום אינו מפיל כלום', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('חסום'); },
      setItem: () => { throw new Error('חסום'); },
      removeItem: () => { throw new Error('חסום'); },
      clear: () => {},
    });
    expect(() => renderHook(() => useFloatingPanel(BASE))).not.toThrow();
  });
});

describe('כשהגרירה כבויה', () => {
  it('אין תזוזה', () => {
    const { result } = renderHook(() => useFloatingPanel({ ...BASE, enabled: false }));
    const before = { ...result.current.pos };
    act(() => { result.current.startMove(reactPointer(0, 0)); });
    act(() => { window.dispatchEvent(pointer('pointermove', 200, 200)); });
    expect(result.current.pos).toEqual(before);
  });
});

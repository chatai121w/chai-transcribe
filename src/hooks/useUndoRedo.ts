import { useState, useCallback, useRef } from "react";

interface UndoRedoResult<T> {
  value: T;
  setValue: (v: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Drop-in replacement for useState that adds undo/redo.
 * Debounces rapid changes (e.g. typing) into single entries.
 */
export function useUndoRedo<T>(initial: T, maxHistory = 100, debounceMs = 600): UndoRedoResult<T> {
  const [value, setValueInternal] = useState(initial);
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);
  const lastPush = useRef(0);
  const currentRef = useRef(initial);

  const setValue = useCallback((v: T | ((prev: T) => T)) => {
    setValueInternal(prev => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      if (next === prev) return prev;

      const now = Date.now();
      // Debounce: only push to undo stack if enough time elapsed
      if (now - lastPush.current > debounceMs) {
        undoStack.current.push(currentRef.current);
        if (undoStack.current.length > maxHistory) undoStack.current.shift();
        redoStack.current = [];
      }
      lastPush.current = now;
      currentRef.current = next;
      return next;
    });
  }, [maxHistory, debounceMs]);

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current.pop()!;
    redoStack.current.push(currentRef.current);
    currentRef.current = prev;
    setValueInternal(prev);
  }, []);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(currentRef.current);
    currentRef.current = next;
    setValueInternal(next);
  }, []);

  return {
    value,
    setValue,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}

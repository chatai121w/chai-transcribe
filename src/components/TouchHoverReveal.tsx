import { useEffect, useRef } from "react";

const HOLD_MS = 450;
const REVEAL_MS = 2000;
const MOVE_CANCEL_PX = 10;

const isTouchLikeDevice = (): boolean => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
};

const hasRevealableHoverContent = (group: HTMLElement): boolean => {
  return Boolean(
    group.querySelector(
      [
        '[class*="group-hover:opacity-100"]',
        '[class*="group-hover:flex"]',
        '[class*="group-hover:block"]',
        '[class*="group-hover:pointer-events-auto"]',
        '[class*="group-hover:translate-y-0"]',
        '[class*="group-hover/"]',
      ].join(", "),
    ),
  );
};

const findRevealGroup = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof HTMLElement)) return null;

  let cursor: HTMLElement | null = target;
  while (cursor && cursor !== document.body) {
    const isTailwindGroup = Array.from(cursor.classList).some(
      (cls) => cls === "group" || cls.startsWith("group/"),
    );

    if (isTailwindGroup && hasRevealableHoverContent(cursor)) {
      return cursor;
    }
    cursor = cursor.parentElement;
  }

  return null;
};

const TouchHoverReveal = () => {
  const holdTimerRef = useRef<number | null>(null);
  const hideTimerByGroupRef = useRef(new Map<HTMLElement, number>());
  const pressedGroupRef = useRef<HTMLElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const suppressGroupRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isTouchLikeDevice()) return;

    const clearHoldTimer = () => {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };

    const revealGroup = (group: HTMLElement) => {
      group.classList.add("touch-reveal-active");

      const existingTimer = hideTimerByGroupRef.current.get(group);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      const hideTimer = window.setTimeout(() => {
        group.classList.remove("touch-reveal-active");
        hideTimerByGroupRef.current.delete(group);
      }, REVEAL_MS);

      hideTimerByGroupRef.current.set(group, hideTimer);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;

      const group = findRevealGroup(event.target);
      if (!group) return;

      const touch = event.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      pressedGroupRef.current = group;

      clearHoldTimer();
      holdTimerRef.current = window.setTimeout(() => {
        if (!pressedGroupRef.current) return;
        revealGroup(group);
        suppressGroupRef.current = group;
        suppressClickUntilRef.current = Date.now() + 700;
        clearHoldTimer();
      }, HOLD_MS);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!touchStartRef.current) return;
      if (event.touches.length !== 1) return;

      const touch = event.touches[0];
      const dx = Math.abs(touch.clientX - touchStartRef.current.x);
      const dy = Math.abs(touch.clientY - touchStartRef.current.y);

      if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
        clearHoldTimer();
      }
    };

    const onTouchEnd = () => {
      clearHoldTimer();
      touchStartRef.current = null;
      pressedGroupRef.current = null;
    };

    const onClickCapture = (event: MouseEvent) => {
      if (Date.now() > suppressClickUntilRef.current) return;
      const group = suppressGroupRef.current;
      if (!group) return;
      if (!(event.target instanceof Node) || !group.contains(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      suppressClickUntilRef.current = 0;
      suppressGroupRef.current = null;
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true, capture: true });
    document.addEventListener("click", onClickCapture, true);

    return () => {
      clearHoldTimer();
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", onTouchEnd, true);
      document.removeEventListener("click", onClickCapture, true);

      hideTimerByGroupRef.current.forEach((timerId, group) => {
        window.clearTimeout(timerId);
        group.classList.remove("touch-reveal-active");
      });
      hideTimerByGroupRef.current = new Map<HTMLElement, number>();
    };
  }, []);

  return null;
};

export default TouchHoverReveal;

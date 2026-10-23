import { useEffect, useRef, useState, type PointerEvent } from "react";

const THRESHOLD = 5; // pixels of movement before a press becomes a drag

/** Dragging one card onto another with plain pointer events. A press that barely moves stays an ordinary click. */
export function useCardDrag(enabled: boolean, onDrop: (from: number, to: number) => void) {
  const [ghost, setGhost] = useState<{ id: number; x: number; y: number } | null>(null);
  const dropped = useRef(onDrop);
  dropped.current = onDrop;
  const justDragged = useRef(false);
  const cancel = useRef<() => void>(() => {});
  useEffect(() => () => cancel.current(), []);

  const start = (e: PointerEvent, id: number) => {
    // On touch screens tap-then-tap is the way to link, and a finger on a card moves the tree instead.
    if (!enabled || e.button !== 0 || e.pointerType === "touch") return;
    const from = { x: e.clientX, y: e.clientY };
    let active = false;
    const move = (ev: globalThis.PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < THRESHOLD) return;
      active = true;
      setGhost({ id, x: ev.clientX, y: ev.clientY });
    };
    const end = (ev: globalThis.PointerEvent | null) => {
      cancel.current();
      if (!active) return;
      justDragged.current = true; // the click that follows a drag must not open a profile
      setTimeout(() => (justDragged.current = false), 0);
      if (!ev) return;
      const under = typeof document.elementFromPoint === "function" ? document.elementFromPoint(ev.clientX, ev.clientY) : null;
      const target = ((under ?? ev.target) as Element | null)?.closest?.("[data-person-id]");
      const to = target ? Number(target.getAttribute("data-person-id")) : NaN;
      if (to && to !== id) dropped.current(id, to);
    };
    const up = (ev: globalThis.PointerEvent) => end(ev);
    const abort = () => end(null);
    cancel.current();
    cancel.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", abort);
      setGhost(null);
      cancel.current = () => {};
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", abort);
  };

  /** True once, right after a drag, so the card's click handler can ignore it. */
  const consumeClick = () => {
    const was = justDragged.current;
    justDragged.current = false;
    return was;
  };
  return { ghost, start, consumeClick };
}

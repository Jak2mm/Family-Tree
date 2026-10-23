import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fitView } from "../layout/fit";

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2;
const clamp = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(k * 1000) / 1000));
const STEP = 60;
const MOVE_SLOP = 5; // pixels a finger may wander before a tap counts as a swipe

type Point = { x: number; y: number };
/** One step of a two-finger pinch: the zoom factor and the midpoint before and after. Null if the fingers touch. */
export function pinchStep(a0: Point, b0: Point, a1: Point, b1: Point): { factor: number; from: Point; to: Point } | null {
  const before = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const after = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  if (before < 1 || after < 1) return null;
  return { factor: after / before, from: { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }, to: { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 } };
}

/** Pan and zoom for the tree canvas: drag the background, wheel or buttons to zoom, arrow keys to move. */
export function usePanZoom() {
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewport = useRef<HTMLDivElement>(null);

  const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = viewport.current;
    const px = cx ?? (el?.clientWidth ?? 0) / 2;
    const py = cy ?? (el?.clientHeight ?? 0) / 2;
    setView((v) => {
      const k = clamp(v.k * factor);
      const ratio = k / v.k; // keep the point under the cursor where it is
      return { k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
    });
  }, []);

  const centreOn = useCallback((x: number, y: number) => {
    const el = viewport.current;
    setView((v) => ({ ...v, x: (el?.clientWidth ?? 0) / 2 - x * v.k, y: (el?.clientHeight ?? 0) / 2 - y * v.k }));
  }, []);

  /** Show the whole tree, or if it is too big, the smallest zoom centred on `anchor`. */
  const fit = useCallback((width: number, height: number, anchor: [number, number] | null) => {
    const el = viewport.current;
    const next = el && fitView(el.clientWidth, el.clientHeight, width, height, anchor, MIN_ZOOM);
    if (next) setView(next);
  }, []);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // zoom the tree, not the page
      const box = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - box.left, e.clientY - box.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // Fingers (or the mouse) currently pressed on the tree, and where each one last was.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const stop = useRef<() => void>(() => {});
  const justPanned = useRef(false);
  useEffect(() => () => stop.current(), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const touch = e.pointerType === "touch";
    // A mouse press on a card is a click or drag-to-link; a finger on a card moves the tree like anywhere else.
    if (!touch && (e.target as Element).closest("[data-person-id]")) return;
    const active = pointers.current;
    if (!touch) active.clear();
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (active.size > 1) return; // the listeners below already follow every finger
    const origin = { x: e.clientX, y: e.clientY };
    let moved = false;

    const move = (ev: globalThis.PointerEvent) => {
      const before = active.get(ev.pointerId);
      if (!before) return;
      if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) > MOVE_SLOP) moved = true;
      const [first, second] = [...active.keys()];
      if (second === undefined) {
        active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        setView((v) => ({ ...v, x: v.x + ev.clientX - before.x, y: v.y + ev.clientY - before.y }));
        return;
      }
      if (ev.pointerId !== first && ev.pointerId !== second) return;
      // Two fingers: zoom by how far apart they moved, keeping the point between them under the fingers.
      const a0 = active.get(first)!, b0 = active.get(second)!;
      active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const a1 = active.get(first)!, b1 = active.get(second)!;
      const pinch = pinchStep(a0, b0, a1, b1);
      if (!pinch) return;
      moved = true;
      const box = viewport.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const [m0, m1] = [{ x: pinch.from.x - box.left, y: pinch.from.y - box.top }, { x: pinch.to.x - box.left, y: pinch.to.y - box.top }];
      setView((v) => {
        const k = clamp(v.k * pinch.factor);
        const ratio = k / v.k;
        return { k, x: m1.x - (m0.x - v.x) * ratio, y: m1.y - (m0.y - v.y) * ratio };
      });
    };
    const lift = (ev: globalThis.PointerEvent) => {
      active.delete(ev.pointerId);
      if (active.size === 0) end();
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", lift);
      window.removeEventListener("pointercancel", lift);
      active.clear();
      stop.current = () => {};
      if (moved) {
        justPanned.current = true; // the click that ends a swipe over a card must not open a profile
        setTimeout(() => (justPanned.current = false), 0);
      }
    };
    stop.current();
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stop.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", lift);
    window.addEventListener("pointercancel", lift);
  };

  /** True once, right after a swipe or pinch, so a card's click handler can ignore it. */
  const consumeClick = useCallback(() => {
    const was = justPanned.current;
    justPanned.current = false;
    return was;
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // arrows on a focused card keep their usual meaning
    const moves: Record<string, [number, number]> = { ArrowLeft: [STEP, 0], ArrowRight: [-STEP, 0], ArrowUp: [0, STEP], ArrowDown: [0, -STEP] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setView((v) => ({ ...v, x: v.x + m[0], y: v.y + m[1] }));
  };

  return { view, viewport, zoomBy, centreOn, fit, consumeClick, handlers: { onPointerDown, onKeyDown } };
}

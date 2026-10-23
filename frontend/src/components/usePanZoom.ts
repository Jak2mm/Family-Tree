import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2;
const clamp = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(k * 1000) / 1000));
const STEP = 60;

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

  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest("[data-person-id]")) return;
    let last = { x: e.clientX, y: e.clientY };
    const move = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - last.x, dy = ev.clientY - last.y;
      last = { x: ev.clientX, y: ev.clientY };
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    };
    stop.current();
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stop.current = () => {};
    };
    stop.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // arrows on a focused card keep their usual meaning
    const moves: Record<string, [number, number]> = { ArrowLeft: [STEP, 0], ArrowRight: [-STEP, 0], ArrowUp: [0, STEP], ArrowDown: [0, -STEP] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setView((v) => ({ ...v, x: v.x + m[0], y: v.y + m[1] }));
  };

  return { view, viewport, zoomBy, centreOn, handlers: { onPointerDown, onKeyDown } };
}

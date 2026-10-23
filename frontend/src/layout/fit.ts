export interface View { x: number; y: number; k: number }

const round = (k: number) => Math.round(k * 1000) / 1000;

/**
 * The view that shows a whole tree of `width` x `height` in a screen area of `vw` x `vh`, centred and never
 * enlarged beyond real size. If the tree is too big even at the smallest zoom, it shows the smallest zoom
 * centred on `anchor` (the oldest person) instead. Gives null while the screen area has no size.
 */
export function fitView(vw: number, vh: number, width: number, height: number, anchor: [number, number] | null, minZoom: number): View | null {
  if (vw <= 0 || vh <= 0 || width <= 0 || height <= 0) return null;
  const k = round(Math.min(1, vw / width, vh / height));
  if (k >= minZoom) return { k, x: (vw - width * k) / 2, y: (vh - height * k) / 2 };
  if (anchor) return { k: minZoom, x: vw / 2 - anchor[0] * minZoom, y: vh / 2 - anchor[1] * minZoom };
  return { k: minZoom, x: (vw - width * minZoom) / 2, y: (vh - height * minZoom) / 2 };
}

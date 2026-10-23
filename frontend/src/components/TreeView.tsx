import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMe } from "../me";
import { edgesFor } from "../layout/edges";
import { CARD_H, CARD_W, layoutTree, type LayoutId } from "../layout/layoutTree";
import { navigate } from "../router";
import { DisplayMenu } from "./DisplayMenu";
import { ErrorMessage } from "./ErrorMessage";
import { LinkPopup } from "./LinkPopup";
import { PersonCard } from "./PersonCard";
import { useCardDrag } from "./useCardDrag";
import { usePanZoom } from "./usePanZoom";
import { useTreeData, useTreePrefs } from "./useTreeData";

const LAYOUTS: [LayoutId, string][] = [
  [1, "By generation, top to bottom"],
  [2, "By generation, side to side"],
  [3, "By birth year, top to bottom"],
  [4, "By birth year, side to side"],
];

export function TreeView() {
  const { can, dateFormat } = useMe();
  const { data, error, reload } = useTreeData();
  const { prefs, error: prefsError, save } = useTreePrefs();
  const { view, viewport, zoomBy, centreOn, fit, consumeClick: panned, handlers } = usePanZoom();
  const [linkMode, setLinkMode] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [pair, setPair] = useState<{ a: number; b: number } | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);

  const layout = (LAYOUTS.some(([id]) => id === prefs.layout) ? prefs.layout : 1) as LayoutId;
  const canLink = can("add");
  const drag = useCardDrag(canLink, (a, b) => (setPair({ a, b }), setPicked(null)));

  const laid = useMemo(() => (data ? layoutTree(data, layout) : null), [data, layout]);
  const edges = useMemo(() => (data && laid ? edgesFor(data, laid.nodes, layout) : []), [data, laid, layout]);
  const people = useMemo(() => new Map(data?.people.map((p) => [p.id, p])), [data]);
  const byName = useMemo(() => [...(data?.people ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [data]);

  // The oldest person with no parents in the tree: where a tree too big for the screen is centred.
  const anchor = useMemo((): [number, number] | null => {
    if (!data || !laid) return null;
    const children = new Set(data.parent_links.map(([, c]) => c));
    const roots = data.people.filter((p) => !children.has(p.id)).sort((a, b) => (a.birth_year ?? Infinity) - (b.birth_year ?? Infinity) || a.id - b.id);
    const node = laid.nodes.find((n) => n.id === roots[0]?.id);
    return node ? [node.x + CARD_W / 2, node.y + CARD_H / 2] : null;
  }, [data, laid]);
  const fitTree = () => laid && fit(laid.width, laid.height, anchor);

  // Let the tree fill the window below the toolbar.
  const hasTree = !!laid && laid.nodes.length > 0;
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const size = () => (el.style.height = `${Math.max(320, Math.round(window.innerHeight - el.getBoundingClientRect().top - window.scrollY - 16))}px`);
    size();
    window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
  }, [hasTree, viewport]);

  // Show the whole tree when it first appears and whenever the layout changes, unless a person is in focus.
  const fittedLayout = useRef<LayoutId | null>(null);
  useEffect(() => {
    if (!laid || laid.nodes.length === 0 || fittedLayout.current === layout) return;
    fittedLayout.current = layout;
    if (focusId === null) fit(laid.width, laid.height, anchor);
  }, [laid, layout, focusId, anchor, fit]);

  // Re-centre on the chosen person, also after the layout changes their position.
  useEffect(() => {
    const node = laid?.nodes.find((n) => n.id === focusId);
    if (node) centreOn(node.x + CARD_W / 2, node.y + CARD_H / 2);
  }, [focusId, laid, centreOn]);

  useEffect(() => {
    if (!linkMode) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pair && setPicked(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linkMode, pair]);

  const toggleLinkMode = () => {
    setLinkMode(!linkMode);
    setPicked(null);
  };
  const activate = (id: number) => {
    if (drag.consumeClick() || panned()) return;
    if (!linkMode) return navigate(`/person/${id}`);
    if (picked === null) setPicked(id);
    else if (picked === id) setPicked(null);
    else (setPair({ a: picked, b: id }), setPicked(null));
  };
  const closePopup = () => (setPair(null), setPicked(null));

  const pairPeople = pair && people.get(pair.a) && people.get(pair.b) ? { a: people.get(pair.a)!, b: people.get(pair.b)! } : null;
  const hint = picked === null ? "Choose the first person." : `Now choose who ${people.get(picked)?.name ?? "they"} is related to.`;

  return (
    <div>
      <div className="page-head">
        <h1>Family tree</h1>
      </div>
      <div className="tree-toolbar">
        <label>
          Layout
          <select value={layout} onChange={(e) => save({ layout: Number(e.target.value) })}>
            {LAYOUTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <DisplayMenu fields={prefs.card_fields} onChange={(card_fields) => save({ card_fields })} />
        <label>
          Focus on
          <select value={focusId ?? ""} onChange={(e) => setFocusId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Nobody in particular</option>
            {byName.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {canLink && (
          <button type="button" aria-pressed={linkMode} className={linkMode ? "primary" : undefined} onClick={toggleLinkMode}>
            Link people
          </button>
        )}
        <div className="button-row" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button>
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
          <button type="button" aria-label="Fit tree to screen" onClick={fitTree}>Fit</button>
        </div>
      </div>
      {linkMode && <p className="hint" role="status">{hint} Press Escape to start again.</p>}
      <ErrorMessage message={error || prefsError} />
      {data === null && !error && <p className="muted">Loading…</p>}
      {data && data.people.length === 0 && <p className="muted">No one has been added yet.</p>}
      {laid && laid.nodes.length > 0 && data && (
        <div
          ref={viewport}
          className="tree-viewport"
          role="group"
          aria-label="Family tree. Drag the background to move around, or use the arrow keys."
          tabIndex={0}
          {...handlers}
        >
          <div data-testid="tree-stage" className="tree-stage" style={{ width: laid.width, height: laid.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
            <svg className="tree-lines" width={laid.width} height={laid.height} aria-hidden="true">
              {laid.bands.map((b, i) => {
                const rows = layout === 1 || layout === 3;
                return (
                  <g key={b.label}>
                    {i % 2 === 0 && <rect className="band" x={rows ? 0 : b.start} y={rows ? b.start : 0} width={rows ? laid.width : b.size} height={rows ? b.size : laid.height} />}
                    <text className="band-label" x={rows ? 8 : b.start + 8} y={rows ? b.start + 18 : 18}>{b.label}</text>
                  </g>
                );
              })}
              {edges.map((e, i) => <polyline key={i} className={`edge ${e.kind}`} points={e.points.map((p) => p.join(",")).join(" ")} />)}
            </svg>
            {laid.nodes.map((n) => (
              <PersonCard
                key={n.id}
                person={people.get(n.id)!}
                x={n.x}
                y={n.y}
                fields={prefs.card_fields}
                dateFormat={dateFormat}
                picked={linkMode ? picked === n.id : null}
                focused={focusId === n.id}
                onActivate={() => activate(n.id)}
                onPointerDown={(e) => drag.start(e, n.id)}
              />
            ))}
          </div>
        </div>
      )}
      {drag.ghost && (
        <div data-testid="drag-ghost" className="drag-ghost" style={{ left: drag.ghost.x + 12, top: drag.ghost.y + 12 }}>
          {people.get(drag.ghost.id)?.name}
        </div>
      )}
      {pairPeople && <LinkPopup key={`${pair!.a}-${pair!.b}`} a={pairPeople.a} b={pairPeople.b} people={byName} onClose={closePopup} onChanged={reload} />}
    </div>
  );
}

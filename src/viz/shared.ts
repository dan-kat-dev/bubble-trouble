/**
 * Helpers shared by the views: props, colors, layout input and a tweener.
 */

import type { PropType } from 'vue';
import { hierarchy, type HierarchyNode } from 'd3-hierarchy';
import type { OutlineNode } from '../model/outline';

/** Every view draws into this coordinate space and scales to fit the panel. */
export const VIEW_W = 400;
export const VIEW_H = 480;

// ---------------------------------------------------------------------------
// Props and events every view takes
// ---------------------------------------------------------------------------

export const vizProps = {
  tree: { type: Object as PropType<OutlineNode>, required: true },
  selectedIds: { type: Object as PropType<Set<number>>, required: true },
  /** Instances of this definition get highlighted (the hovered one's). */
  hoverDefinitionId: { type: Number as PropType<number | null>, default: null },
  search: { type: String, default: '' },
  /** The group open for editing in SketchUp: the view zooms onto it. */
  focusKey: { type: String as PropType<string | null>, default: null },
} as const;

export const vizEmits = {
  select: (_node: OutlineNode | null) => true,
  hover: (_node: OutlineNode | null) => true,
};

/** CSS classes for a shape: group or component, selected, twin of the hovered one, or dimmed by search. */
export function shapeClass(
  node: OutlineNode,
  props: { selectedIds: Set<number>; hoverDefinitionId: number | null; search: string }
): Record<string, boolean> {
  const query = props.search.trim().toLowerCase();
  const matches =
    !query || node.name.toLowerCase().includes(query) || node.definitionName.toLowerCase().includes(query);
  return {
    group: node.kind === 'group',
    selected: props.selectedIds.has(node.entityId),
    twin: props.hoverDefinitionId !== null && node.definitionId === props.hoverDefinitionId,
    dim: !matches,
  };
}

/** Hover text for a shape. */
export function tooltip(node: OutlineNode): string {
  const kind = node.kind === 'group' ? 'Group' : `Component: ${node.definitionName}`;
  return `${node.name}\n${kind}\n${node.faces.toLocaleString()} faces · ${node.edges.toLocaleString()} edges`;
}

/** Cut a label to roughly fit a width (in view units). */
export function fitLabel(text: string, width: number): string {
  const max = Math.floor((width - 6) / 6.5);
  if (max < 3) return '';
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

// ---------------------------------------------------------------------------
// Colors: one per component definition or top-level group, same in every view
// ---------------------------------------------------------------------------

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6', '#008300', '#e34948'];
export const NEUTRAL = '#888780';

/**
 * Node key → color. A component takes its definition's color, so every copy
 * matches, and so does everything inside it. Anything else takes its
 * top-level group's color. Picked from ids, not positions, so colors don't
 * reshuffle when something is added or removed.
 */
export function nodeColors(tree: OutlineNode): Map<string, string> {
  const colors = new Map<string, string>();
  const pick = (id: number) => PALETTE[id % PALETTE.length];
  const visit = (node: OutlineNode, color: string, inComponent: boolean) => {
    if (!inComponent && node.kind === 'component') {
      color = pick(node.definitionId!);
      inComponent = true;
    } else if (node.depth === 1) {
      color = pick(node.entityId);
    }
    colors.set(node.key, color);
    for (const child of node.children) visit(child, color, inComponent);
  };
  for (const child of tree.children) visit(child, NEUTRAL, false);
  return colors;
}

// ---------------------------------------------------------------------------
// Zoom: fill the view with the group open for editing
// ---------------------------------------------------------------------------

export interface Bounds {
  key: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A CSS transform that zooms onto the focused shape and everything inside it
 * (its key's descendants), plus the scale, so labels can stay the same size.
 * No focus, or nothing to focus on: no zoom. The rest of the shapes stay put.
 */
export function focusZoom(shapes: Bounds[], focusKey: string | null): { k: number; transform: string } {
  const inside = focusKey ? shapes.filter((s) => s.key === focusKey || s.key.startsWith(focusKey + '/')) : [];
  if (inside.length === 0) return { k: 1, transform: 'none' };

  const x0 = Math.min(...inside.map((s) => s.x0));
  const y0 = Math.min(...inside.map((s) => s.y0));
  const x1 = Math.max(...inside.map((s) => s.x1));
  const y1 = Math.max(...inside.map((s) => s.y1));
  const k = Math.max(1, 0.92 * Math.min(VIEW_W / Math.max(1, x1 - x0), VIEW_H / Math.max(1, y1 - y0)));
  // Center on it, but never pan past the drawing's edges into empty space.
  const tx = Math.min(0, Math.max(VIEW_W * (1 - k), VIEW_W / 2 - (k * (x0 + x1)) / 2));
  const ty = Math.min(0, Math.max(VIEW_H * (1 - k), VIEW_H / 2 - (k * (y0 + y1)) / 2));
  return { k, transform: `translate(${tx}px, ${ty}px) scale(${k})` };
}

// ---------------------------------------------------------------------------
// Layout input
// ---------------------------------------------------------------------------

/**
 * The tree as a d3 hierarchy, sized by faces + edges. d3's sum() adds each
 * node's own count to its children's, which gives the nested totals. Minimum 1
 * so empty containers still show up.
 */
export function hierarchyFor(tree: OutlineNode): HierarchyNode<OutlineNode> {
  return hierarchy(tree, (node) => node.children)
    .sum((node) => Math.max(1, node.ownFaces + node.ownEdges))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
}

// ---------------------------------------------------------------------------
// Tweener: animates shapes from where they are to where they should be
// ---------------------------------------------------------------------------

/** easeOutBack: arrives with a small overshoot, which reads as springy. */
function ease(t: number): number {
  const c1 = 1.3;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

/**
 * Each shape is a key plus a list of numbers (say [x, y, r, opacity]).
 * animateTo() moves every shape from its current numbers to its target:
 * new keys start from enter(key), removed keys go to exit(key) and then
 * disappear. onFrame runs on every animation frame; read `current` there.
 */
export class Tweener {
  current = new Map<string, number[]>();

  private from = new Map<string, number[]>();
  private to = new Map<string, number[]>();
  private leaving = new Set<string>();
  private startTime = 0;
  private frameId = 0;
  private onFrame: () => void;
  private duration: number;

  constructor(onFrame: () => void, duration = 700) {
    this.onFrame = onFrame;
    this.duration = duration;
  }

  animateTo(
    targets: Map<string, number[]>,
    enter: (key: string) => number[],
    exit: (key: string, current: number[]) => number[]
  ): void {
    this.from = new Map();
    this.to = new Map(targets);
    this.leaving = new Set();
    for (const key of targets.keys()) {
      this.from.set(key, this.current.get(key) ?? enter(key));
    }
    for (const [key, value] of this.current) {
      if (targets.has(key)) continue;
      this.from.set(key, value);
      this.to.set(key, exit(key, value));
      this.leaving.add(key);
    }
    this.startTime = performance.now();
    cancelAnimationFrame(this.frameId);
    this.frame();
  }

  stop(): void {
    cancelAnimationFrame(this.frameId);
  }

  private frame = (): void => {
    const t = Math.min(1, (performance.now() - this.startTime) / this.duration);
    const k = ease(t);
    const next = new Map<string, number[]>();
    for (const [key, to] of this.to) {
      if (t === 1 && this.leaving.has(key)) continue;
      const from = this.from.get(key)!;
      next.set(key, to.map((v, i) => from[i] + (v - from[i]) * k));
    }
    this.current = next;
    this.onFrame();
    if (t < 1) this.frameId = requestAnimationFrame(this.frame);
  };
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Helpers shared by the views: props, colors, layout input and a tweener.
 */

import type { PropType } from 'vue';
import { hierarchy, type HierarchyNode } from 'd3-hierarchy';
import type { OutlineNode, SizeMetric } from '../model/outline';

/** Every view draws into this coordinate space and scales to fit the panel. */
export const VIEW_W = 400;
export const VIEW_H = 480;

// ---------------------------------------------------------------------------
// Props and events every view takes
// ---------------------------------------------------------------------------

export const vizProps = {
  tree: { type: Object as PropType<OutlineNode>, required: true },
  metric: { type: String as PropType<SizeMetric>, required: true },
  selectedIds: { type: Object as PropType<Set<number>>, required: true },
  /** Instances of this definition get highlighted (the hovered one's). */
  hoverDefinitionId: { type: Number as PropType<number | null>, default: null },
  search: { type: String, default: '' },
} as const;

export const vizEmits = {
  select: (_node: OutlineNode | null) => true,
  hover: (_node: OutlineNode | null) => true,
};

/** CSS classes for a shape: selected, twin of the hovered one, or dimmed by search. */
export function shapeClass(
  node: OutlineNode,
  props: { selectedIds: Set<number>; hoverDefinitionId: number | null; search: string }
): Record<string, boolean> {
  const query = props.search.trim().toLowerCase();
  const matches =
    !query || node.name.toLowerCase().includes(query) || node.definitionName.toLowerCase().includes(query);
  return {
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
// Colors: one per top-level branch, so a branch keeps its color in every view
// ---------------------------------------------------------------------------

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6', '#008300', '#e34948'];
export const NEUTRAL = '#888780';

/**
 * Top-level entity id → color. A node's color is its top-level ancestor's.
 * Picked from the entity id, not the position, so colors don't reshuffle when
 * something is added or removed.
 */
export function branchColors(tree: OutlineNode): Map<number, string> {
  return new Map(tree.children.map((child) => [child.entityId, PALETTE[child.entityId % PALETTE.length]]));
}

// ---------------------------------------------------------------------------
// Layout input
// ---------------------------------------------------------------------------

/**
 * The tree as a d3 hierarchy, sized by the chosen metric. d3's sum() adds each
 * node's own count to its children's, which gives the nested totals. Minimum 1
 * so empty containers still show up.
 */
export function hierarchyFor(tree: OutlineNode, metric: SizeMetric): HierarchyNode<OutlineNode> {
  return hierarchy(tree, (node) => node.children)
    .sum((node) => Math.max(1, metric === 'faces' ? node.ownFaces : node.ownEdges))
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

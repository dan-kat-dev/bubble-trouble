<script lang="ts">
/**
 * Free bubbles: one bubble per group or component, not nested, with real
 * physics (d3-force). Bubbles push each other apart and drift toward the
 * center of their cluster. When the model changes, existing bubbles keep
 * their place, new ones grow out of their parent, and removed ones shrink away.
 * Every tick, the bubbles go to the canvas renderer (see CanvasView).
 */
import { defineComponent, markRaw, type PropType } from 'vue';
import {
  forceCollide,
  forceSimulation,
  forceX,
  forceY,
  type ForceCollide,
  type Simulation,
  type SimulationNodeDatum,
} from 'd3-force';
import { descendants, parentKey, type OutlineNode } from '../model/outline';
import type { Shape } from './canvas';
import CanvasView from './canvas-view';
import { type Bounds, NEUTRAL, VIEW_H, VIEW_W, nodeColors } from './shared';

export type ClusterBy = 'branch' | 'definition' | 'kind';

interface Bubble extends SimulationNodeDatum {
  key: string;
  node: OutlineNode;
  r: number;
  targetR: number;
  leaving: boolean;
}

function clusterOf(node: OutlineNode, by: ClusterBy): string {
  if (by === 'definition') return node.kind === 'group' ? 'group' : String(node.definitionId);
  if (by === 'kind') return node.kind;
  return String(node.path[0]);
}

export default defineComponent({
  extends: CanvasView,

  props: {
    clusterBy: { type: String as PropType<ClusterBy>, default: 'branch' },
  },

  data() {
    return {
      // Not reactive: the simulation mutates these many times a second.
      bubbles: markRaw(new Map<string, Bubble>()),
      simulation: null as Simulation<Bubble, undefined> | null,
      collide: null as ForceCollide<Bubble> | null,
      colors: markRaw(new Map<string, string>()),
    };
  },

  watch: {
    maxDepth() {
      this.update();
    },
    palette() {
      this.update();
    },
    tree() {
      this.update();
    },
    clusterBy() {
      this.update();
    },
  },

  created() {
    this.collide = markRaw(forceCollide<Bubble>((b) => b.r + 1.5).iterations(2));
    this.simulation = markRaw(
      forceSimulation<Bubble>()
        .force('collide', this.collide)
        .alphaDecay(0.02)
        .on('tick', () => this.tick())
    );
  },

  mounted() {
    this.update();
  },

  beforeUnmount() {
    this.simulation?.stop();
  },

  methods: {
    /** Sync bubbles with the tree, then reheat the simulation. */
    update() {
      const nodes = descendants(this.tree).filter((n) => n.depth <= this.maxDepth);
      const size = (n: OutlineNode) => Math.max(1, n.faces + n.edges);

      // Scale radii so all the bubbles together fill about 40% of the view.
      const totalSize = nodes.reduce((sum, n) => sum + size(n), 0);
      const k = Math.sqrt((0.4 * VIEW_W * VIEW_H) / (Math.PI * totalSize));

      const seen = new Set<string>();
      for (const node of nodes) {
        seen.add(node.key);
        const targetR = Math.max(2.5, k * Math.sqrt(size(node)));
        const existing = this.bubbles.get(node.key);
        if (existing) {
          Object.assign(existing, { node, targetR, leaving: false });
          continue;
        }
        // New bubbles start at their parent's bubble (or the center), at size 0.
        const parent = this.bubbles.get(parentKey(node.key) ?? '');
        this.bubbles.set(node.key, {
          key: node.key,
          node,
          r: 0,
          targetR,
          leaving: false,
          x: (parent?.x ?? VIEW_W / 2) + Math.random() * 10 - 5,
          y: (parent?.y ?? VIEW_H / 2) + Math.random() * 10 - 5,
        });
      }
      for (const bubble of this.bubbles.values()) {
        if (!seen.has(bubble.key)) Object.assign(bubble, { targetR: 0, leaving: true });
      }

      // Cluster centers on a grid, one cell per cluster.
      const clusterKeys = [...new Set(nodes.map((n) => clusterOf(n, this.clusterBy)))];
      const cols = Math.ceil(Math.sqrt(clusterKeys.length));
      const rows = Math.ceil(clusterKeys.length / cols);
      const centers = new Map(
        clusterKeys.map((key, i) => [
          key,
          { x: ((i % cols) + 0.5) * (VIEW_W / cols), y: (Math.floor(i / cols) + 0.5) * (VIEW_H / rows) },
        ])
      );
      const centerOf = (b: Bubble) => centers.get(clusterOf(b.node, this.clusterBy)) ?? { x: VIEW_W / 2, y: VIEW_H / 2 };

      this.colors = markRaw(new Map([...this.colors, ...nodeColors(this.tree, this.palette)])); // keep colors of leaving shapes
      this.simulation!.force('x', forceX<Bubble>((b) => centerOf(b).x).strength(0.07))
        .force('y', forceY<Bubble>((b) => centerOf(b).y).strength(0.07))
        .nodes([...this.bubbles.values()])
        .alpha(0.8)
        .restart();
    },

    /** Each physics step: ease radii toward their targets, keep bubbles in view, redraw. */
    tick() {
      let removed = false;
      for (const b of this.bubbles.values()) {
        b.r += (b.targetR - b.r) * 0.15;
        b.x = Math.max(b.r, Math.min(VIEW_W - b.r, b.x ?? 0));
        b.y = Math.max(b.r, Math.min(VIEW_H - b.r, b.y ?? 0));
        if (b.leaving && b.r < 0.5) {
          this.bubbles.delete(b.key);
          removed = true;
        }
      }
      if (removed) this.simulation!.nodes([...this.bubbles.values()]);
      this.collide!.radius((b) => b.r + 1.5); // radii change while growing

      const shapes: Shape[] = [];
      for (const b of this.bubbles.values()) {
        shapes.push({
          node: b.node,
          x: b.x ?? 0,
          y: b.y ?? 0,
          r: b.r,
          opacity: b.leaving ? 0.45 : 1,
          color: this.colors.get(b.key) ?? NEUTRAL,
          container: false,
          label: 'center',
        });
      }
      this.renderer?.setShapes(shapes);
      this.updateZoom(); // bubbles drift, so the zoom follows them
    },

    /** Full-grown radii, so the zoom doesn't chase bubbles that are still growing. */
    zoomBounds(): Bounds[] {
      return [...this.bubbles.values()].map((b) => ({
        key: b.key,
        x0: (b.x ?? 0) - b.targetR,
        y0: (b.y ?? 0) - b.targetR,
        x1: (b.x ?? 0) + b.targetR,
        y1: (b.y ?? 0) + b.targetR,
      }));
    },
  },
});
</script>

<template>
  <canvas ref="canvas" class="viz" />
</template>

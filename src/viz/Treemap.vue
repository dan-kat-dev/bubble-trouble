<script lang="ts">
/**
 * Treemap: nested rectangles. Same data and animation as the nested bubbles,
 * laid out with d3's treemap() instead of pack().
 */
import { defineComponent, markRaw } from 'vue';
import { treemap } from 'd3-hierarchy';
import { parentKey, type OutlineNode } from '../model/outline';
import type { Shape } from './canvas';
import CanvasView from './canvas-view';
import { type Bounds, NEUTRAL, Tweener, VIEW_H, VIEW_W, clamp01, hierarchyFor, nodeColors } from './shared';

/** Room at the top of a group for its name. */
const HEADER = 14;

export default defineComponent({
  extends: CanvasView,

  data() {
    return {
      // Not reactive: nothing in the template reads these.
      /** Where every box ends up, for zooming without chasing the animation. */
      targetBounds: markRaw([] as Bounds[]),
      tweener: null as Tweener | null,
      nodes: markRaw(new Map<string, OutlineNode>()),
      colors: markRaw(new Map<string, string>()),
    };
  },

  watch: {
    maxDepth() {
      this.layout();
    },
    palette() {
      this.layout();
    },
    tree() {
      this.layout();
    },
  },

  created() {
    this.tweener = markRaw(new Tweener(() => this.draw()));
  },

  mounted() {
    this.layout();
  },

  beforeUnmount() {
    this.tweener?.stop();
  },

  methods: {
    layout() {
      const tweener = this.tweener!;
      const root = treemap<OutlineNode>()
        .size([VIEW_W, VIEW_H])
        .paddingOuter(2)
        .paddingTop((d) => (d.depth > 0 && d.children ? HEADER : 2))
        .paddingInner(1)(hierarchyFor(this.tree));

      const targets = new Map<string, number[]>();
      for (const d of root.descendants()) {
        if (d.depth === 0 || d.depth > this.maxDepth) continue;
        targets.set(d.data.key, [d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0, 1]);
        this.nodes.set(d.data.key, d.data);
      }
      this.targetBounds = markRaw([...targets].map(([key, [x, y, w, h]]) => ({ key, x0: x, y0: y, x1: x + w, y1: y + h })));
      this.colors = markRaw(new Map([...this.colors, ...nodeColors(this.tree, this.palette)])); // keep colors of leaving shapes
      this.updateZoom();

      tweener.animateTo(
        // New boxes grow from the middle of the nearest ancestor on screen.
        targets,
        (key) => {
          for (let p = parentKey(key); p; p = parentKey(p)) {
            const at = tweener.current.get(p) ?? targets.get(p);
            if (at) return [at[0] + at[2] / 2, at[1] + at[3] / 2, 0, 0, 0];
          }
          return [VIEW_W / 2, VIEW_H / 2, 0, 0, 0];
        },
        // Removed boxes shrink into their middle and fade.
        (_key, [x, y, w, h]) => [x + w / 2, y + h / 2, 0, 0, 0]
      );
    },

    draw() {
      const current = this.tweener!.current;
      for (const key of this.nodes.keys()) if (!current.has(key)) this.nodes.delete(key);

      const shapes: Shape[] = [];
      for (const [key, [x, y, w, h, opacity]] of current) {
        const node = this.nodes.get(key)!;
        shapes.push({
          node,
          x,
          y,
          w: Math.max(0, w),
          h: Math.max(0, h),
          opacity: clamp01(opacity),
          color: this.colors.get(key) ?? NEUTRAL,
          // Nodes at the depth limit hide their insides, so they're drawn as leaves.
          container: node.children.length > 0 && node.depth < this.maxDepth,
          label: 'corner',
        });
      }
      this.renderer?.setShapes(shapes);
    },

    zoomBounds(): Bounds[] {
      return this.targetBounds;
    },
  },
});
</script>

<template>
  <canvas ref="canvas" class="viz" />
</template>

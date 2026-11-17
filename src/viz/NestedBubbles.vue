<script lang="ts">
/**
 * Nested bubbles: circle packing. Bubbles inside bubbles show nesting.
 *
 * d3's pack() computes where every circle goes. When the model changes, the
 * tweener glides each circle from its old spot to its new one; new circles
 * grow out of their parent and removed ones pop. Every frame, the circles go
 * to the canvas renderer (see CanvasView).
 */
import { defineComponent, markRaw } from 'vue';
import { pack } from 'd3-hierarchy';
import { parentKey, type OutlineNode } from '../model/outline';
import type { Shape } from './canvas';
import CanvasView from './canvas-view';
import { type Bounds, NEUTRAL, Tweener, VIEW_H, VIEW_W, clamp01, hierarchyFor, nodeColors } from './shared';

export default defineComponent({
  extends: CanvasView,

  data() {
    return {
      // Not reactive: nothing in the template reads these.
      /** Where every circle ends up, for zooming without chasing the animation. */
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
      const root = pack<OutlineNode>().size([VIEW_W, VIEW_H]).padding(3)(hierarchyFor(this.tree));

      const targets = new Map<string, number[]>();
      for (const d of root.descendants()) {
        if (d.depth === 0 || d.depth > this.maxDepth) continue; // the model itself isn't drawn
        targets.set(d.data.key, [d.x, d.y, d.r, 1]);
        this.nodes.set(d.data.key, d.data);
      }
      this.targetBounds = markRaw(
        [...targets].map(([key, [x, y, r]]) => ({ key, x0: x - r, y0: y - r, x1: x + r, y1: y + r }))
      );
      this.colors = markRaw(new Map([...this.colors, ...nodeColors(this.tree, this.palette)])); // keep colors of leaving shapes
      this.updateZoom();

      tweener.animateTo(
        targets,
        // New circles grow out of the nearest ancestor that's already on screen.
        (key) => {
          for (let p = parentKey(key); p; p = parentKey(p)) {
            const at = tweener.current.get(p) ?? targets.get(p);
            if (at) return [at[0], at[1], 0, 0];
          }
          return [VIEW_W / 2, VIEW_H / 2, 0, 0];
        },
        // Removed circles swell a little and fade: a pop.
        (_key, [x, y, r]) => [x, y, r * 1.3, 0]
      );
    },

    draw() {
      const current = this.tweener!.current;
      // Forget nodes that finished leaving.
      for (const key of this.nodes.keys()) if (!current.has(key)) this.nodes.delete(key);

      const shapes: Shape[] = [];
      for (const [key, [x, y, r, opacity]] of current) {
        const node = this.nodes.get(key)!;
        // Nodes at the depth limit hide their insides, so they're drawn as leaves.
        const container = node.children.length > 0 && node.depth < this.maxDepth;
        shapes.push({
          node,
          x,
          y,
          r: Math.max(0, r),
          opacity: clamp01(opacity),
          color: this.colors.get(key) ?? NEUTRAL,
          container,
          label: container ? 'none' : 'center',
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

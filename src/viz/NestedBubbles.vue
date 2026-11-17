<script lang="ts">
/**
 * Nested bubbles: circle packing. Bubbles inside bubbles show nesting.
 *
 * d3's pack() computes where every circle goes. When the model changes, the
 * tweener glides each circle from its old spot to its new one; new circles
 * grow out of their parent and removed ones pop.
 */
import { defineComponent, markRaw } from 'vue';
import { pack } from 'd3-hierarchy';
import { parentKey, type OutlineNode } from '../model/outline';
import {
  type Bounds,
  NEUTRAL,
  Tweener,
  VIEW_H,
  VIEW_W,
  nodeColors,
  clamp01,
  fitLabel,
  focusZoom,
  hierarchyFor,
  shapeClass,
  tooltip,
  vizEmits,
  vizProps,
} from './shared';

interface Circle {
  key: string;
  node: OutlineNode;
  x: number;
  y: number;
  r: number;
  opacity: number;
  color: string;
  isGroup: boolean;
}

export default defineComponent({
  props: vizProps,
  emits: vizEmits,

  data() {
    return {
      width: VIEW_W,
      height: VIEW_H,
      circles: [] as Circle[],
      /** Where every circle ends up, for zooming without chasing the animation. */
      targetBounds: [] as Bounds[],
      // Not reactive: helpers the template never reads directly.
      tweener: null as Tweener | null,
      nodes: markRaw(new Map<string, OutlineNode>()),
      colors: markRaw(new Map<string, string>()),
    };
  },

  computed: {
    zoom() {
      return focusZoom(this.targetBounds, this.focusKey);
    },
  },

  watch: {
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
        if (d.depth === 0) continue; // the model itself isn't drawn
        targets.set(d.data.key, [d.x, d.y, d.r, 1]);
        this.nodes.set(d.data.key, d.data);
      }
      this.targetBounds = markRaw(
        [...targets].map(([key, [x, y, r]]) => ({ key, x0: x - r, y0: y - r, x1: x + r, y1: y + r }))
      );
      this.colors = markRaw(new Map([...this.colors, ...nodeColors(this.tree, this.palette)])); // keep colors of leaving shapes

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

      this.circles = [...current].map(([key, [x, y, r, opacity]]) => {
        const node = this.nodes.get(key)!;
        return {
          key,
          node,
          x,
          y,
          r: Math.max(0, r),
          opacity: clamp01(opacity),
          color: this.colors.get(node.key) ?? NEUTRAL,
          isGroup: node.children.length > 0,
        };
      });
    },

    shapeClass(node: OutlineNode) {
      return shapeClass(node, this);
    },

    tooltip,
    fitLabel,
  },
});
</script>

<template>
  <svg class="viz" :viewBox="`0 0 ${width} ${height}`" @click.self="$emit('select', null)">
    <!-- Shapes zoomed past the drawing's edges get clipped. -->
    <clipPath id="nested-clip"><rect :width="width" :height="height" /></clipPath>
    <g clip-path="url(#nested-clip)">
      <g class="zoom" :style="{ transform: zoom.transform }">
        <g
          v-for="c in circles"
          :key="c.key"
          class="shape"
          :class="shapeClass(c.node)"
          :opacity="c.opacity"
          @click.stop="$emit('select', c.node)"
          @mouseenter="$emit('hover', c.node)"
          @mouseleave="$emit('hover', null)"
        >
          <title>{{ tooltip(c.node) }}</title>
          <circle :cx="c.x" :cy="c.y" :r="c.r" :fill="c.color" :fill-opacity="c.isGroup ? 0.12 : 0.6" :stroke="c.color" />
          <text
            v-if="!c.isGroup && c.r * zoom.k > 16"
            :x="c.x"
            :y="c.y"
            dy="0.35em"
            text-anchor="middle"
            :style="{ fontSize: `${11 / zoom.k}px` }"
          >
            {{ fitLabel(c.node.name, c.r * 2 * zoom.k) }}
          </text>
        </g>
      </g>
    </g>
  </svg>
</template>

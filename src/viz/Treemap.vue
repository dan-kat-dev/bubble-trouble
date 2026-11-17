<script lang="ts">
/**
 * Treemap: nested rectangles. Same data and animation as the nested bubbles,
 * laid out with d3's treemap() instead of pack().
 */
import { defineComponent, markRaw } from 'vue';
import { treemap } from 'd3-hierarchy';
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
  solidFill,
  tooltip,
  vizEmits,
  vizProps,
} from './shared';

/** Room at the top of a group for its name. */
const HEADER = 14;

interface Box {
  key: string;
  node: OutlineNode;
  x: number;
  y: number;
  w: number;
  h: number;
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
      boxes: [] as Box[],
      /** Where every box ends up, for zooming without chasing the animation. */
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

      this.boxes = [...current].map(([key, [x, y, w, h, opacity]]) => {
        const node = this.nodes.get(key)!;
        return {
          key,
          node,
          x,
          y,
          w: Math.max(0, w),
          h: Math.max(0, h),
          opacity: clamp01(opacity),
          color: this.colors.get(node.key) ?? NEUTRAL,
          // Nodes at the depth limit hide their insides, so they're drawn as leaves.
          isGroup: node.children.length > 0 && node.depth < this.maxDepth,
        };
      });
    },

    shapeClass(node: OutlineNode) {
      return shapeClass(node, this);
    },

    tooltip,
    fitLabel,
    solidFill,
  },
});
</script>

<template>
  <svg class="viz" :viewBox="`0 0 ${width} ${height}`" @click.self="$emit('select', null)">
    <!-- Shapes zoomed past the drawing's edges get clipped. -->
    <clipPath id="treemap-clip"><rect :width="width" :height="height" /></clipPath>
    <g clip-path="url(#treemap-clip)">
      <g class="zoom" :style="{ transform: zoom.transform }">
        <g
          v-for="b in boxes"
          :key="b.key"
          class="shape"
          :class="shapeClass(b.node)"
          :opacity="b.opacity"
          @click.stop="$emit('select', b.node)"
          @mouseenter="$emit('hover', b.node)"
          @mouseleave="$emit('hover', null)"
        >
          <title>{{ tooltip(b.node) }}</title>
          <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="2" :style="{ fill: solidFill(b.color, b.isGroup) }" :stroke="b.color" />
          <text
            v-if="b.h * zoom.k > (b.isGroup ? 16 : 14)"
            :x="b.x + 4 / zoom.k"
            :y="b.y + 11 / zoom.k"
            :style="{ fontSize: `${11 / zoom.k}px` }"
          >
            {{ fitLabel(b.node.name, b.w * zoom.k) }}
          </text>
        </g>
      </g>
    </g>
  </svg>
</template>

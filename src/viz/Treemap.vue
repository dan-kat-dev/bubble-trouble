<script lang="ts">
/**
 * Treemap: nested rectangles. Same data and animation as the nested bubbles,
 * laid out with d3's treemap() instead of pack().
 */
import { defineComponent, markRaw } from 'vue';
import { treemap } from 'd3-hierarchy';
import { parentKey, type OutlineNode } from '../model/outline';
import {
  NEUTRAL,
  Tweener,
  VIEW_H,
  VIEW_W,
  nodeColors,
  clamp01,
  fitLabel,
  hierarchyFor,
  shapeClass,
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
      // Not reactive: helpers the template never reads directly.
      tweener: null as Tweener | null,
      nodes: markRaw(new Map<string, OutlineNode>()),
      colors: markRaw(new Map<string, string>()),
    };
  },

  watch: {
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
        if (d.depth === 0) continue;
        targets.set(d.data.key, [d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0, 1]);
        this.nodes.set(d.data.key, d.data);
      }
      this.colors = markRaw(new Map([...this.colors, ...nodeColors(this.tree)])); // keep colors of leaving shapes

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
      <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="2" :fill="b.color" :fill-opacity="b.isGroup ? 0.12 : 0.6" :stroke="b.color" />
      <text v-if="b.isGroup ? b.h > 16 : b.h > 14" :x="b.x + 4" :y="b.y + 11">
        {{ fitLabel(b.node.name, b.w) }}
      </text>
    </g>
  </svg>
</template>

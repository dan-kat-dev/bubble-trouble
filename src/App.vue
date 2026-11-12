<script lang="ts">
import { defineComponent, markRaw } from 'vue';
import { descendants, type OutlineNode, type SizeMetric } from './model/outline';
import { createSource } from './sketchup/create-source';
import type { ModelSource } from './sketchup/source';
import FreeBubbles, { type ClusterBy } from './viz/FreeBubbles.vue';
import NestedBubbles from './viz/NestedBubbles.vue';
import Treemap from './viz/Treemap.vue';

/** Re-reading the model is heavy, so wait for a burst of edits to settle. */
const RELOAD_DEBOUNCE_MS = 250;

type Mode = 'free' | 'nested' | 'treemap';
const MODES: { id: Mode; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'nested', label: 'Nested' },
  { id: 'treemap', label: 'Treemap' },
];

export default defineComponent({
  components: { FreeBubbles, NestedBubbles, Treemap },

  data() {
    return {
      modes: MODES,
      mode: 'nested' as Mode,
      metric: 'faces' as SizeMetric,
      clusterBy: 'branch' as ClusterBy,
      hoverNode: null as OutlineNode | null,
      // markRaw: Vue shouldn't wrap the source or the tree in reactive proxies.
      // The tree is replaced whole on every reload, never edited in place.
      source: markRaw(createSource()) as ModelSource,
      tree: null as OutlineNode | null,
      selectedIds: new Set<number>(),
      status: 'connecting' as 'connecting' | 'ready' | 'error',
      error: '',
      unsubscribers: [] as (() => void)[],
      reloadTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
  },

  computed: {
    nodeCount(): number {
      return this.tree ? descendants(this.tree).length : 0;
    },

    /** The props every view takes. Only used once the tree has loaded. */
    viewProps(): { tree: OutlineNode; metric: SizeMetric; selectedIds: Set<number>; hoverDefinitionId: number | null } {
      return {
        tree: this.tree!,
        metric: this.metric,
        selectedIds: this.selectedIds,
        hoverDefinitionId: this.hoverNode?.definitionId ?? null,
      };
    },
  },

  async mounted() {
    try {
      await this.source.connect();
      await this.reload();
      this.unsubscribers.push(this.source.onModelChanged(() => this.scheduleReload()));
      this.unsubscribers.push(this.source.onSelectionChanged((ids) => (this.selectedIds = ids)));
      this.status = 'ready';
    } catch (e) {
      this.fail('Failed to connect', e);
    }
  },

  beforeUnmount() {
    clearTimeout(this.reloadTimer);
    this.unsubscribers.forEach((stop) => stop());
  },

  methods: {
    async reload() {
      try {
        this.tree = markRaw(await this.source.load());
      } catch (e) {
        this.fail('Failed to read the model', e);
      }
    },

    scheduleReload() {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => this.reload(), RELOAD_DEBOUNCE_MS);
    },

    async select(node: OutlineNode | null) {
      try {
        await this.source.select(node);
      } catch (e) {
        console.error('Bubble Trouble: selection failed', e);
      }
    },

    fail(what: string, e: unknown) {
      console.error(`Bubble Trouble: ${what}`, e);
      this.error = e instanceof Error ? e.message : String(e);
      this.status = 'error';
    },
  },
});
</script>

<template>
  <p v-if="status === 'connecting'" class="muted">Connecting…</p>
  <p v-else-if="status === 'error'" class="error">Couldn't read the model: {{ error }}</p>
  <template v-else-if="tree">
    <div class="toolbar">
      <div class="modes">
        <button
          v-for="m in modes"
          :key="m.id"
          class="button"
          :class="{ secondary: mode !== m.id }"
          @click="mode = m.id"
        >
          {{ m.label }}
        </button>
      </div>
      <label>
        Size
        <select v-model="metric">
          <option value="faces">Faces</option>
          <option value="edges">Edges</option>
        </select>
      </label>
      <label v-if="mode === 'free'">
        Group by
        <select v-model="clusterBy">
          <option value="branch">Top-level</option>
          <option value="definition">Definition</option>
          <option value="kind">Type</option>
        </select>
      </label>
    </div>

    <p class="muted info">
      {{ tree.name }} · {{ nodeCount }} groups and components · {{ tree.faces.toLocaleString() }} faces
      <span v-if="source.kind === 'mock'"> · fake model</span>
    </p>

    <FreeBubbles v-if="mode === 'free'" v-bind="viewProps" :cluster-by="clusterBy" @select="select" @hover="hoverNode = $event" />
    <NestedBubbles v-else-if="mode === 'nested'" v-bind="viewProps" @select="select" @hover="hoverNode = $event" />
    <Treemap v-else v-bind="viewProps" @select="select" @hover="hoverNode = $event" />
  </template>
</template>

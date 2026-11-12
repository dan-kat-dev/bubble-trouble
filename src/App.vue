<script lang="ts">
import { defineComponent, markRaw } from 'vue';
import { descendants, type OutlineNode } from './model/outline';
import { createSource } from './sketchup/create-source';
import type { ModelSource } from './sketchup/source';

/** Re-reading the model is heavy, so wait for a burst of edits to settle. */
const RELOAD_DEBOUNCE_MS = 250;

export default defineComponent({
  data() {
    return {
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
    <h2>{{ tree.name }}</h2>
    <p class="muted">
      {{ nodeCount }} groups and components · {{ tree.faces.toLocaleString() }} faces
      <span v-if="source.kind === 'mock'"> · fake model</span>
    </p>
  </template>
</template>

<script lang="ts">
import { defineComponent, markRaw } from 'vue';
import { descendants, type OutlineNode } from './model/outline';
import { createSource } from './sketchup/create-source';
import { MockSource } from './sketchup/mock-source';
import type { ModelSource } from './sketchup/source';
import FreeBubbles, { type ClusterBy } from './viz/FreeBubbles.vue';
import NestedBubbles from './viz/NestedBubbles.vue';
import Treemap from './viz/Treemap.vue';
import { PALETTES, type PaletteId } from './viz/shared';

/**
 * How many levels to draw below the group in focus (or the top level).
 * Big models get slow with every nested bubble drawn; deeper ones appear as
 * you zoom into their parents.
 */
const VISIBLE_LEVELS = 4;

/** Re-reading the model is heavy, so wait for a burst of edits to settle. */
const RELOAD_DEBOUNCE_MS = 250;

/** Settings are remembered per browser. Storage can be blocked, so never rely on it. */
function loadSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`bubble-trouble:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveSetting(key: string, value: string): void {
  try {
    localStorage.setItem(`bubble-trouble:${key}`, value);
  } catch {
    // Not remembered; fine.
  }
}
const savedPalette = loadSetting('palette', 'pastel');

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
      clusterBy: 'branch' as ClusterBy,
      zoomToSelection: loadSetting('zoom-to-selection', 'on') !== 'off',
      palettes: PALETTES,
      palette: (savedPalette in PALETTES ? savedPalette : 'pastel') as PaletteId,
      search: '',
      hoverNode: null as OutlineNode | null,
      // markRaw: Vue shouldn't wrap the source or the tree in reactive proxies.
      // The tree is replaced whole on every reload, never edited in place.
      source: markRaw(createSource()) as ModelSource,
      tree: null as OutlineNode | null,
      selectedIds: new Set<number>(),
      /** Entity ids of the groups open for editing in SketchUp, outermost first. */
      activePath: [] as number[],
      status: 'connecting' as 'connecting' | 'ready' | 'error',
      error: '',
      unsubscribers: [] as (() => void)[],
      reloadTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
  },

  computed: {
    /** The fake model, when running outside SketchUp. Its edit buttons show up then. */
    mock(): MockSource | null {
      return this.source instanceof MockSource ? this.source : null;
    },

    nodeCount(): number {
      return this.tree ? descendants(this.tree).length : 0;
    },

    /** The props every view takes. Only used once the tree has loaded. */
    viewProps(): {
      tree: OutlineNode;
      selectedKeys: Set<string>;
      maxDepth: number;
      hoverDefinitionId: number | null;
      search: string;
      focusKey: string | null;
      palette: PaletteId;
    } {
      return {
        tree: this.tree!,
        selectedKeys: this.selectedKeys,
        maxDepth: this.maxDepth,
        hoverDefinitionId: this.hoverNode?.definitionId ?? null,
        search: this.search,
        // Node keys are entity-id paths, so the open group's key is its path.
        focusKey: this.activePath.length > 0 ? this.activePath.join('/') : null,
        palette: this.palette,
      };
    },

    /** Nodes deeper than this aren't drawn. */
    maxDepth(): number {
      return this.activePath.length + VISIBLE_LEVELS;
    },

    /**
     * Keys of the shapes to highlight. A selected node that's too deep to be
     * drawn highlights its deepest drawn ancestor instead.
     */
    selectedKeys(): Set<string> {
      const keys = new Set<string>();
      if (!this.tree || this.selectedIds.size === 0) return keys;
      for (const node of descendants(this.tree)) {
        if (this.selectedIds.has(node.entityId)) keys.add(node.path.slice(0, this.maxDepth).join('/'));
      }
      return keys;
    },

    /** Definition id → how many instances of it are in the model. */
    instanceCounts(): Map<number, number> {
      const counts = new Map<number, number>();
      if (!this.tree) return counts;
      for (const node of descendants(this.tree)) {
        if (node.definitionId !== null) counts.set(node.definitionId, (counts.get(node.definitionId) ?? 0) + 1);
      }
      return counts;
    },

    /** The line under the toolbar: the hovered thing, or a summary of the model. */
    info(): string {
      const node = this.hoverNode;
      const tree = this.tree;
      if (!tree) return '';
      if (!node) {
        const mock = this.source.kind === 'mock' ? ' · fake model' : '';
        return `${tree.name} · ${this.nodeCount} groups and components · ${tree.faces.toLocaleString()} faces${mock}`;
      }
      const count = node.kind === 'component' ? this.instanceCounts.get(node.definitionId!) ?? 1 : 1;
      const copies = count > 1 ? ` · ${count} copies` : '';
      return `${node.name} · ${node.faces.toLocaleString()} faces · ${node.edges.toLocaleString()} edges${copies}`;
    },
  },

  async mounted() {
    try {
      await this.source.connect();
      await this.reload();
      this.unsubscribers.push(this.source.onModelChanged(() => this.scheduleReload()));
      this.unsubscribers.push(this.source.onSelectionChanged((ids) => this.selectionChanged(ids)));
      this.unsubscribers.push(this.source.onActivePathChanged((path) => (this.activePath = path)));
      this.status = 'ready';
    } catch (e) {
      this.fail('Failed to connect', e);
    }
  },

  beforeUnmount() {
    clearTimeout(this.reloadTimer);
    this.unsubscribers.forEach((stop) => stop());
  },

  watch: {
    zoomToSelection(on: boolean) {
      saveSetting('zoom-to-selection', on ? 'on' : 'off');
    },
    palette(id: PaletteId) {
      saveSetting('palette', id);
    },
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

    /** Highlight the selection here, and frame it in SketchUp if that's on. */
    selectionChanged(ids: Set<number>) {
      this.selectedIds = ids;
      if (this.zoomToSelection && ids.size > 0) {
        this.source.zoomToSelection().catch((e) => console.error('Bubble Trouble: zoom failed', e));
      }
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
      <label v-if="mode === 'free'">
        Group by
        <select v-model="clusterBy">
          <option value="branch">Top-level</option>
          <option value="definition">Definition</option>
          <option value="kind">Type</option>
        </select>
      </label>
      <label title="Component colors. Groups are always gray.">
        Colors
        <select v-model="palette">
          <option v-for="(p, id) in palettes" :key="id" :value="id">{{ p.label }}</option>
        </select>
      </label>
      <label title="Zoom SketchUp's camera to whatever is selected">
        <input v-model="zoomToSelection" type="checkbox" />
        Zoom to selection
      </label>
    </div>

    <input v-model="search" class="search" type="search" placeholder="Search by name" />
    <p class="muted info">{{ info }}</p>

    <FreeBubbles v-if="mode === 'free'" v-bind="viewProps" :cluster-by="clusterBy" @select="select" @hover="hoverNode = $event" />
    <NestedBubbles v-else-if="mode === 'nested'" v-bind="viewProps" @select="select" @hover="hoverNode = $event" />
    <Treemap v-else v-bind="viewProps" @select="select" @hover="hoverNode = $event" />

    <div v-if="mock" class="mock-tools">
      <span class="muted">Fake edits:</span>
      <button class="button secondary" @click="mock.deleteRandom()">Delete</button>
      <button class="button secondary" @click="mock.explodeRandom()">Explode</button>
      <button class="button secondary" @click="mock.addRandom()">Add</button>
      <button class="button secondary" @click="mock.openRandom()">Open group</button>
    </div>
  </template>
</template>

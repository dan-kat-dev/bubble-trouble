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
      /** Key of the group or component the view is zoomed onto (null: the whole model). */
      focusKey: null as string | null,
      /** Open paths we caused ourselves, so they don't move the view (see activePathChanged). A double-click causes the same one twice, so it's a list. */
      ownActivePaths: markRaw([] as string[]),
      /** When the panel last selected something, so SketchUp's echo of it doesn't zoom twice. */
      panelSelectAt: 0,
      /** The panel's SketchUp calls, run one at a time (see run). */
      queue: Promise.resolve() as Promise<void>,
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
        focusKey: this.focusKey,
        palette: this.palette,
      };
    },

    /** Nodes deeper than this aren't drawn. */
    maxDepth(): number {
      return (this.focusKey ? this.focusKey.split('/').length : 0) + VISIBLE_LEVELS;
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
      this.unsubscribers.push(this.source.onActivePathChanged((path) => this.activePathChanged(path)));
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

    /**
     * Highlight the selection here, and frame it in SketchUp if that's on.
     * Clicks in the panel zoom by themselves (see select), so this only zooms
     * for selections made in SketchUp.
     */
    selectionChanged(ids: Set<number>) {
      this.selectedIds = ids;
      const fromPanel = performance.now() - this.panelSelectAt < 1000;
      if (this.zoomToSelection && ids.size > 0 && !fromPanel) this.run(() => this.source.zoomToSelection(), 'zoom');
    },

    /**
     * Run a SketchUp call after the ones before it have finished. They're
     * async, and a double-click sends select, select, open in quick
     * succession: without this, a zoom could read the selection after the
     * open had already cleared it, and zoom to nothing.
     */
    run(task: () => Promise<void>, what: string): Promise<void> {
      this.queue = this.queue.then(task).catch((e) => console.error(`Bubble Trouble: ${what} failed`, e));
      return this.queue;
    },

    /**
     * Click: select in SketchUp. Selecting something nested opens its parents
     * there, but that isn't the user opening a group, so the view stays put.
     * Null (empty space, or the × button) also goes back to the whole model.
     *
     * Every click zooms SketchUp's camera (if that's on), even onto what's
     * already selected: SketchUp doesn't report a selection that didn't change.
     */
    select(node: OutlineNode | null) {
      this.expectActivePath(node ? node.path.slice(0, -1).join('/') : '');
      if (!node) this.focusKey = null;
      this.panelSelectAt = performance.now();
      // Highlight it now, without waiting for SketchUp to report it back: it may not.
      this.selectedIds = new Set(node ? [node.entityId] : []);
      return this.run(async () => {
        await this.source.select(node);
        if (!this.zoomToSelection) return;
        await (node ? this.source.zoomToSelection() : this.source.zoomExtents());
      }, 'selection');
    },

    /**
     * Double-click: open it for editing in SketchUp and zoom the view onto it.
     * The double-click's own two clicks already selected it and zoomed
     * SketchUp's camera onto it, in order, before this runs.
     */
    open(node: OutlineNode) {
      this.focusKey = node.key;
      this.expectActivePath(node.key);
      return this.run(() => this.source.open(node), 'open');
    },

    /** The user opened or closed a group in SketchUp: zoom onto it (or back out). */
    activePathChanged(path: number[]) {
      // Node keys are entity-id paths, so the open group's key is its path.
      const key = path.join('/');
      if (this.forgetActivePath(key)) return; // caused by select() or open()
      this.focusKey = key || null;
    },

    /** Remember an open path we're about to cause; forgotten after a moment in case SketchUp never reports it. */
    expectActivePath(key: string) {
      this.ownActivePaths.push(key);
      setTimeout(() => this.forgetActivePath(key), 1500);
    },

    forgetActivePath(key: string): boolean {
      const i = this.ownActivePaths.indexOf(key);
      if (i !== -1) this.ownActivePaths.splice(i, 1);
      return i !== -1;
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

    <div class="viz-wrap">
      <FreeBubbles v-if="mode === 'free'" v-bind="viewProps" :cluster-by="clusterBy" @select="select" @open="open" @hover="hoverNode = $event" />
      <NestedBubbles v-else-if="mode === 'nested'" v-bind="viewProps" @select="select" @open="open" @hover="hoverNode = $event" />
      <Treemap v-else v-bind="viewProps" @select="select" @open="open" @hover="hoverNode = $event" />
      <button v-if="focusKey" class="zoom-out" title="Deselect and show the whole model" @click="select(null)">×</button>
    </div>

    <div v-if="mock" class="mock-tools">
      <span class="muted">Fake edits:</span>
      <button class="button secondary" @click="mock.deleteRandom()">Delete</button>
      <button class="button secondary" @click="mock.explodeRandom()">Explode</button>
      <button class="button secondary" @click="mock.addRandom()">Add</button>
      <button class="button secondary" @click="mock.openRandom()">Open group</button>
    </div>
  </template>
</template>

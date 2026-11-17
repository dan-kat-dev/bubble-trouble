/**
 * CanvasView: what every view has in common. Each view `extends` it, lays out
 * its shapes, and hands them to this.renderer.
 *
 * It makes the renderer, redraws when highlights change (selection, hover,
 * search), and zooms onto the focused group using the view's zoomBounds().
 * Each view's template is just <canvas ref="canvas" class="viz" />.
 */

import { defineComponent, markRaw } from 'vue';
import { CanvasRenderer } from './canvas';
import { focusZoom, vizEmits, vizProps, type Bounds } from './shared';

export default defineComponent({
  props: vizProps,
  emits: vizEmits,

  data() {
    return {
      renderer: null as CanvasRenderer | null,
    };
  },

  watch: {
    selectedKeys() {
      this.renderer?.requestDraw();
    },
    hoverDefinitionId() {
      this.renderer?.requestDraw();
    },
    search() {
      this.renderer?.requestDraw();
    },
    focusKey() {
      this.updateZoom();
    },
  },

  // Runs before the view's own mounted(), so the renderer is ready for its first layout.
  mounted() {
    this.renderer = markRaw(
      new CanvasRenderer(this.$refs.canvas as HTMLCanvasElement, () => this, {
        select: (node) => this.$emit('select', node),
        open: (node) => this.$emit('open', node),
        hover: (node) => this.$emit('hover', node),
      })
    );
  },

  beforeUnmount() {
    this.renderer?.destroy();
  },

  methods: {
    /** Where every shape ends up. Each view overrides this. */
    zoomBounds(): Bounds[] {
      return [];
    },

    /** Zoom onto the focused group, or back out. Call after a layout too. */
    updateZoom() {
      this.renderer?.zoomTo(focusZoom(this.zoomBounds(), this.focusKey));
    },
  },
});

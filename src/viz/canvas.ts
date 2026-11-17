/**
 * CanvasRenderer: draws every view's shapes on one <canvas>.
 *
 * The views used to be SVG, one element per bubble. Vue diffing thousands of
 * them on every animation frame and hover took ~500ms on a big model; drawing
 * the same shapes on a canvas takes a few ms. So the views still do their own
 * layout and animation, and hand this a plain list of shapes to draw.
 *
 *   1. Shapes and setup
 *   2. Drawing
 *   3. Zoom
 *   4. Mouse: hover, click, double-click
 */

import type { OutlineNode } from '../model/outline';
import { VIEW_H, VIEW_W, fitLabel, tooltip, type Zoom } from './shared';

// ---------------------------------------------------------------------------
// 1. Shapes and setup
// ---------------------------------------------------------------------------

/** A circle (r) or a rectangle (w, h), in view coordinates (VIEW_W × VIEW_H). */
export interface Shape {
  node: OutlineNode;
  x: number;
  y: number;
  r?: number;
  w?: number;
  h?: number;
  color: string;
  /** Has drawn children: a light tint, so what's inside stands out. */
  container: boolean;
  opacity: number;
  label: 'center' | 'corner' | 'none';
}

/** What decides how shapes are highlighted. Read on every draw. */
export interface Look {
  selectedKeys: Set<string>;
  hoverDefinitionId: number | null;
  search: string;
}

export interface Events {
  select(node: OutlineNode | null): void;
  open(node: OutlineNode): void;
  hover(node: OutlineNode | null): void;
}

const FONT = '11px system-ui, sans-serif';

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private look: () => Look;
  private events: Events;
  /** Drawn in order, so parents (earlier) end up under their children. */
  private shapes: Shape[] = [];
  private zoom: Zoom = { k: 1, tx: 0, ty: 0 };
  private zoomTarget: Zoom = { k: 1, tx: 0, ty: 0 };
  private hovered: Shape | null = null;
  private frameId = 0;
  private resizeObserver: ResizeObserver;
  private fills = new Map<string, string>();
  private fillsBackground = '';

  constructor(canvas: HTMLCanvasElement, look: () => Look, events: Events) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.look = look;
    this.events = events;
    this.resizeObserver = new ResizeObserver(() => this.requestDraw());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('mousemove', this.onMove);
    canvas.addEventListener('mouseleave', this.onLeave);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('dblclick', this.onDoubleClick);
  }

  destroy(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('mousemove', this.onMove);
    this.canvas.removeEventListener('mouseleave', this.onLeave);
    this.canvas.removeEventListener('click', this.onClick);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
  }

  setShapes(shapes: Shape[]): void {
    this.shapes = shapes;
    this.requestDraw();
  }

  /** Redraw on the next frame. Cheap to call often: frames are never doubled up. */
  requestDraw(): void {
    if (!this.frameId) this.frameId = requestAnimationFrame(this.draw);
  }

  // -------------------------------------------------------------------------
  // 2. Drawing
  // -------------------------------------------------------------------------

  /** View coordinates → canvas pixels: fit VIEW_W × VIEW_H in the canvas, centered. */
  private fit() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const s = Math.min(w / VIEW_W, h / VIEW_H);
    return { dpr, w, h, s, ox: (w - VIEW_W * s) / 2, oy: (h - VIEW_H * s) / 2 };
  }

  private draw = (): void => {
    this.frameId = 0;
    this.stepZoom();
    const { ctx, canvas } = this;
    const { dpr, w, h, s, ox, oy } = this.fit();
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Colors come from SketchUp's CSS (see .viz in styles.css), so dark mode follows along.
    const css = getComputedStyle(canvas);
    const text = css.color;
    const accent = css.outlineColor;
    const background = getComputedStyle(document.body).backgroundColor;

    const { k, tx, ty } = this.zoom;
    const px = 1 / (s * k); // one screen pixel, in view units
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip(); // shapes zoomed past the drawing's edges get cut off
    ctx.translate(tx, ty);
    ctx.scale(k, k);
    ctx.font = FONT.replace('11px', `${11 * px}px`);
    ctx.textBaseline = 'middle';

    const look = this.look();
    const query = look.search.trim().toLowerCase();
    // The part of the drawing on screen, in shape coordinates.
    const left = -tx / k;
    const top = -ty / k;
    const right = (VIEW_W - tx) / k;
    const bottom = (VIEW_H - ty) / k;

    for (const shape of this.shapes) {
      if (shape.opacity <= 0) continue;
      // Skip what can't be seen: big models are mostly specks, and zoomed in, mostly off screen.
      const halfW = shape.r ?? shape.w! / 2;
      const halfH = shape.r ?? shape.h! / 2;
      const cx = shape.r !== undefined ? shape.x : shape.x + halfW;
      const cy = shape.r !== undefined ? shape.y : shape.y + halfH;
      const screenSize = Math.min(halfW, halfH) * s * k;
      const node = shape.node;
      const selected = look.selectedKeys.has(node.key);
      if (screenSize < 0.5 && !selected) continue;
      if (cx + halfW < left || cx - halfW > right || cy + halfH < top || cy - halfH > bottom) continue;
      const matches =
        !query || node.name.toLowerCase().includes(query) || node.definitionName.toLowerCase().includes(query);
      ctx.globalAlpha = shape.opacity * (matches ? 1 : 0.15);

      ctx.beginPath();
      if (shape.r !== undefined) ctx.arc(shape.x, shape.y, Math.max(0, shape.r), 0, 2 * Math.PI);
      else ctx.roundRect(shape.x, shape.y, Math.max(0, shape.w!), Math.max(0, shape.h!), 2);
      ctx.fillStyle = this.solidFill(shape.color, shape.container, background);
      ctx.fill();

      // Outline: selected beats hover-twin beats plain. Groups are dashed.
      // Specks skip the plain outline: it would just cover the fill.
      const twin = look.hoverDefinitionId !== null && node.definitionId === look.hoverDefinitionId;
      if (!selected && !twin && screenSize < 2) continue;
      ctx.strokeStyle = selected ? accent : twin ? text : shape.color;
      ctx.lineWidth = (selected ? 3 : twin ? 2 : 1) * px;
      ctx.setLineDash(node.kind === 'group' ? [4 * px, 2 * px] : []);
      ctx.stroke();

      this.drawLabel(shape, s * k, px, text);
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    if (this.zoomMoving()) this.requestDraw();
  };

  /** Labels stay 11px on screen at any zoom, and only show when there's room. */
  private drawLabel(shape: Shape, scale: number, px: number, color: string): void {
    if (shape.label === 'none') return;
    const { ctx } = this;
    ctx.fillStyle = color;
    if (shape.r !== undefined) {
      if (shape.r * scale < 16) return;
      const label = fitLabel(shape.node.name, shape.r * 2 * scale);
      if (!label) return;
      ctx.textAlign = 'center';
      ctx.fillText(label, shape.x, shape.y);
    } else {
      if (shape.h! * scale < (shape.container ? 16 : 14)) return;
      const label = fitLabel(shape.node.name, shape.w! * scale);
      if (!label) return;
      ctx.textAlign = 'left';
      ctx.fillText(label, shape.x + 4 * px, shape.y + 7 * px);
    }
  }

  /**
   * The color mixed with the panel background: looks like a see-through tint,
   * but stacked shapes don't muddy each other. Cached; reset if the
   * background changes (light/dark mode).
   */
  private solidFill(color: string, container: boolean, background: string): string {
    if (background !== this.fillsBackground) {
      this.fills.clear();
      this.fillsBackground = background;
    }
    const key = color + (container ? '/c' : '');
    let fill = this.fills.get(key);
    if (!fill) {
      const bg = background.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255];
      const fg = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
      const t = container ? 0.15 : 0.6;
      fill = `rgb(${fg.map((v, i) => Math.round(v * t + bg[i] * (1 - t))).join(',')})`;
      this.fills.set(key, fill);
    }
    return fill;
  }

  // -------------------------------------------------------------------------
  // 3. Zoom: eases toward the target every frame, so it can follow moving shapes
  // -------------------------------------------------------------------------

  zoomTo(target: Zoom): void {
    this.zoomTarget = target;
    this.requestDraw();
  }

  private stepZoom(): void {
    const z = this.zoom;
    const t = this.zoomTarget;
    const ease = 0.18;
    this.zoom = { k: z.k + (t.k - z.k) * ease, tx: z.tx + (t.tx - z.tx) * ease, ty: z.ty + (t.ty - z.ty) * ease };
    if (!this.zoomMoving()) this.zoom = { ...t };
  }

  private zoomMoving(): boolean {
    const z = this.zoom;
    const t = this.zoomTarget;
    return Math.abs(z.k - t.k) > 0.001 || Math.abs(z.tx - t.tx) > 0.1 || Math.abs(z.ty - t.ty) > 0.1;
  }

  // -------------------------------------------------------------------------
  // 4. Mouse
  // -------------------------------------------------------------------------

  /** The topmost shape under the mouse: the last drawn one that contains it. */
  private shapeAt(event: MouseEvent): Shape | null {
    const rect = this.canvas.getBoundingClientRect();
    const { s, ox, oy } = this.fit();
    const { k, tx, ty } = this.zoom;
    const vx = (event.clientX - rect.left - ox) / s;
    const vy = (event.clientY - rect.top - oy) / s;
    if (vx < 0 || vy < 0 || vx > VIEW_W || vy > VIEW_H) return null;
    const x = (vx - tx) / k;
    const y = (vy - ty) / k;
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const shape = this.shapes[i];
      if (shape.opacity < 0.5) continue; // leaving or still arriving
      if (shape.r !== undefined) {
        if ((x - shape.x) ** 2 + (y - shape.y) ** 2 <= shape.r ** 2) return shape;
      } else if (x >= shape.x && y >= shape.y && x <= shape.x + shape.w! && y <= shape.y + shape.h!) {
        return shape;
      }
    }
    return null;
  }

  private onMove = (event: MouseEvent): void => {
    const shape = this.shapeAt(event);
    if (shape?.node.key === this.hovered?.node.key) return;
    this.hovered = shape;
    this.canvas.style.cursor = shape ? 'pointer' : '';
    this.canvas.title = shape ? tooltip(shape.node) : '';
    this.events.hover(shape?.node ?? null);
  };

  private onLeave = (): void => {
    this.hovered = null;
    this.events.hover(null);
  };

  private onClick = (event: MouseEvent): void => {
    this.events.select(this.shapeAt(event)?.node ?? null);
  };

  private onDoubleClick = (event: MouseEvent): void => {
    const shape = this.shapeAt(event);
    if (shape) this.events.open(shape.node);
  };
}

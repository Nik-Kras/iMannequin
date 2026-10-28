// Draws the paper doll: the body (photo cut-out or outline, D13) and the garments in layer order, each as a paper
// cut-out with a white scissor margin and a soft shadow (design §1). Built layers are cached, so changing one garment
// only rebuilds that layer.
import { CANON } from './body';
import { DESIGN_BODY_PATH, DESIGN_HEAD, DESIGN_TO_CANON } from './defaultBody';
import type { Piece } from './fit';
import { compose, transformRect, translate, type Mat } from './geom';
import { ctx2d, makeCanvas, type Drawable, type LoadedBody } from './assets';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Canonical → canvas pixels: x·s + ox, y·s + oy, on a w × h canvas. */
export interface View { s: number; ox: number; oy: number; w: number; h: number }

const INK = '#141414';
/** Style unit: the board draws the mannequin 440 px tall; margins and shadows scale with the size. */
const unit = (v: View) => (v.s * CANON.height) / 440;
const viewMat = (v: View): Mat => [v.s, 0, 0, v.s, v.ox, v.oy];
const viewKey = (v: View) => `${v.s.toFixed(5)}:${v.ox.toFixed(1)}:${v.oy.toFixed(1)}:${v.w}x${v.h}`;

export interface LayerInput {
  /** Identifies the garment image (photo id and version). */
  key: string;
  itemId: string;
  image: Drawable;
  pieces: Piece[];
  /** The garment's bounding box in image pixels (for the selection outline). */
  box?: { x0: number; y0: number; x1: number; y1: number };
}

interface Built { canvas: AnyCanvas; x: number; y: number; used: number }

function setShadow(g: CanvasRenderingContext2D, k: number, alpha = 0.24) {
  g.shadowColor = `rgba(20,20,20,${alpha})`;
  g.shadowOffsetX = 1 * k;
  g.shadowOffsetY = 2 * k;
  g.shadowBlur = 1.5 * k;
}
function noShadow(g: CanvasRenderingContext2D) {
  g.shadowColor = 'transparent';
  g.shadowOffsetX = 0;
  g.shadowOffsetY = 0;
  g.shadowBlur = 0;
}

/** The silhouette of `src` grown by `r` px, in one colour (stamped copies around a circle). */
function grow(src: AnyCanvas, r: number, colour: string): AnyCanvas {
  const out = makeCanvas(src.width, src.height);
  const g = ctx2d(out);
  const n = 12;
  for (const rr of r > 1.5 ? [r, r * 0.55] : [r]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.drawImage(src as CanvasImageSource, Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }
  g.drawImage(src as CanvasImageSource, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = colour;
  g.fillRect(0, 0, out.width, out.height);
  return out;
}

/** A cut-out sticker: white margin of `margin` px under the art, with a paper shadow. */
function sticker(art: AnyCanvas, margin: number, k: number, edge = '#ffffff', shadowAlpha = 0.24): AnyCanvas {
  const out = makeCanvas(art.width, art.height);
  const g = ctx2d(out);
  const rim = grow(art, margin, edge);
  setShadow(g, k, shadowAlpha);
  g.drawImage(rim as CanvasImageSource, 0, 0);
  noShadow(g);
  g.drawImage(art as CanvasImageSource, 0, 0);
  return out;
}

export class Compositor {
  private body?: { key: string; canvas: AnyCanvas };
  private layers = new Map<string, Built>();
  private frame = 0;

  /** Draws the scene onto `target` (sized to the view). Returns the selected item's outline rect in canvas px. */
  draw(target: CanvasRenderingContext2D, view: View, body: LoadedBody, mode: 'photo' | 'outline', layers: LayerInput[], selectedItemId?: string) {
    this.frame++;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, view.w, view.h);
    const b = this.bodyLayer(view, body, mode);
    target.drawImage(b as CanvasImageSource, 0, 0);
    let selected: { x: number; y: number; w: number; h: number } | undefined;
    for (const L of layers) {
      const built = this.layer(view, L);
      target.drawImage(built.canvas as CanvasImageSource, built.x, built.y);
      if (L.itemId === selectedItemId) selected = union(selected, layerBox(view, L));
    }
    if (selected) {
      const k = unit(view);
      target.save();
      target.setLineDash([4 * k, 3 * k]);
      target.lineWidth = Math.max(1, 1 * k);
      target.strokeStyle = INK;
      const p = 3 * k;
      target.strokeRect(Math.round(selected.x - p) + 0.5, Math.round(selected.y - p) + 0.5, Math.round(selected.w + 2 * p), Math.round(selected.h + 2 * p));
      target.restore();
    }
    this.evict();
    return selected;
  }

  private bodyLayer(view: View, body: LoadedBody, mode: 'photo' | 'outline'): AnyCanvas {
    const key = `${body.key}|${body.kind === 'default' ? 'outline' : mode}|${viewKey(view)}`;
    if (this.body?.key === key) return this.body.canvas;
    const k = unit(view);
    let canvas: AnyCanvas;
    if (body.kind === 'default' || !body.cutout || !body.mask) {
      canvas = makeCanvas(view.w, view.h);
      const g = ctx2d(canvas);
      const m = compose(viewMat(view), DESIGN_TO_CANON);
      g.setTransform(...m);
      const head = new Path2D();
      head.ellipse(DESIGN_HEAD.cx, DESIGN_HEAD.cy, DESIGN_HEAD.rx, DESIGN_HEAD.ry, 0, 0, Math.PI * 2);
      const figure = new Path2D(DESIGN_BODY_PATH);
      g.lineJoin = 'round';
      g.lineWidth = 1.6;
      g.fillStyle = '#ffffff';
      g.strokeStyle = INK;
      // Shadow under the whole figure, then the ink edges on top.
      setShadow(g, k, 0.2);
      g.fill(head);
      g.fill(figure);
      noShadow(g);
      g.stroke(head);
      g.fill(figure);
      g.stroke(figure);
    } else if (mode === 'outline') {
      // The same mask as white paper with a black edge and a soft shadow (D13).
      const sil = makeCanvas(view.w, view.h);
      ctx2d(sil).drawImage(body.mask as CanvasImageSource, view.ox, view.oy, CANON.width * view.s, CANON.height * view.s);
      const white = grow(sil, 0, '#ffffff');
      const edge = grow(sil, Math.max(1, 1.3 * k), INK);
      canvas = makeCanvas(view.w, view.h);
      const g = ctx2d(canvas);
      setShadow(g, k, 0.2);
      g.drawImage(edge as CanvasImageSource, 0, 0);
      noShadow(g);
      g.drawImage(white as CanvasImageSource, 0, 0);
    } else {
      const art = makeCanvas(view.w, view.h);
      const g0 = ctx2d(art);
      g0.imageSmoothingQuality = 'high';
      g0.drawImage(body.cutout as CanvasImageSource, view.ox, view.oy, CANON.width * view.s, CANON.height * view.s);
      canvas = sticker(art, 1.3 * k, k, '#ffffff', 0.2);
    }
    this.body = { key, canvas };
    return canvas;
  }

  private layer(view: View, L: LayerInput): Built {
    const key = `${L.key}|${L.pieces.map((p) => p.m.map((v) => v.toFixed(3)).join(',') + (p.clip ? `[${p.clip.x0},${p.clip.x1}]` : '') + (p.polys ? `{${p.polys.pts.length}${p.polys.evenOdd ? 'e' : ''}${p.within ? 'w' : ''}}` : '')).join(';')}|${viewKey(view)}`;
    const hit = this.layers.get(key);
    if (hit) { hit.used = this.frame; return hit; }
    const built = buildLayer(view, L);
    built.used = this.frame;
    this.layers.set(key, built);
    return built;
  }

  /** Keeps layers drawn in the last few frames (switching back and forth stays instant). */
  private evict() {
    if (this.layers.size < 48) return;
    for (const [k, v] of this.layers) if (this.frame - v.used > 6) this.layers.delete(k);
  }
}

function union(a: { x: number; y: number; w: number; h: number } | undefined, b: { x: number; y: number; w: number; h: number }) {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** The part of the image a piece can show (its clip rectangle, or its polygons' bounds unless it's the even-odd body). */
function pieceRect(p: Piece, box: { x0: number; y0: number; x1: number; y1: number }) {
  let r = { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 };
  if (p.clip) r = { x0: Math.max(r.x0, p.clip.x0), y0: Math.max(r.y0, p.clip.y0), x1: Math.min(r.x1, p.clip.x1), y1: Math.min(r.y1, p.clip.y1) };
  if (p.polys && !p.polys.evenOdd) {
    const xs = p.polys.pts.flat().map((q) => q.x);
    const ys = p.polys.pts.flat().map((q) => q.y);
    r = { x0: Math.max(r.x0, Math.min(...xs)), y0: Math.max(r.y0, Math.min(...ys)), x1: Math.min(r.x1, Math.max(...xs)), y1: Math.min(r.y1, Math.max(...ys)) };
  }
  return r;
}

/** Bounding box of a layer's garment pixels in canvas px. */
export function layerBox(view: View, L: LayerInput): { x: number; y: number; w: number; h: number } {
  let out: { x: number; y: number; w: number; h: number } | undefined;
  const box = L.box ?? { x0: 0, y0: 0, x1: L.image.width, y1: L.image.height };
  for (const p of L.pieces) {
    const { x0, y0, x1, y1 } = pieceRect(p, box);
    if (x1 <= x0 || y1 <= y0) continue;
    out = union(out, transformRect(compose(viewMat(view), p.m), x0, y0, x1 - x0, y1 - y0));
  }
  return out ?? { x: 0, y: 0, w: 0, h: 0 };
}

function buildLayer(view: View, L: LayerInput): Built {
  const k = unit(view);
  const margin = 1.3 * k;
  const pad = Math.ceil(margin + 5 * k);
  const fullBox = { x0: 0, y0: 0, x1: L.image.width, y1: L.image.height };
  let bounds: { x: number; y: number; w: number; h: number } | undefined;
  for (const p of L.pieces) {
    const c = pieceRect(p, fullBox);
    if (c.x1 <= c.x0 || c.y1 <= c.y0) continue;
    bounds = union(bounds, transformRect(compose(viewMat(view), p.m), c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0));
  }
  const b = bounds ?? { x: 0, y: 0, w: 1, h: 1 };
  // Never build a layer far bigger than the canvas (a wild manual scale), only the part that can be seen.
  const x0 = Math.max(-pad, Math.floor(b.x) - pad);
  const y0 = Math.max(-pad, Math.floor(b.y) - pad);
  const x1 = Math.min(view.w + pad, Math.ceil(b.x + b.w) + pad);
  const y1 = Math.min(view.h + pad, Math.ceil(b.y + b.h) + pad);
  const art = makeCanvas(Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  const g = ctx2d(art);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  for (const p of L.pieces) {
    g.save();
    g.setTransform(...compose(translate(-x0, -y0), compose(viewMat(view), p.m)));
    if (p.clip) {
      g.beginPath();
      g.rect(p.clip.x0, p.clip.y0, p.clip.x1 - p.clip.x0, p.clip.y1 - p.clip.y0);
      g.clip();
    }
    if (p.polys) {
      g.beginPath();
      for (const poly of p.polys.pts) {
        poly.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
        g.closePath();
      }
      g.clip(p.polys.evenOdd ? 'evenodd' : 'nonzero');
    }
    if (p.within) {
      g.beginPath();
      p.within.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
      g.closePath();
      g.clip();
    }
    g.drawImage(L.image as CanvasImageSource, 0, 0);
    g.restore();
  }
  return { canvas: sticker(art, margin, k), x: x0, y: y0, used: 0 };
}

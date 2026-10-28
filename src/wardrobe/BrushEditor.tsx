// Erase / restore brush on a cut-out's alpha channel (F4, D19), with undo/redo and pinch-to-zoom.
// Restore paints the original photo back when it lines up with the cut-out (same framing);
// otherwise it brings back the cut-out's own pixels, so it can undo erasing and firm up soft edges.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { canvasToBlob } from './images';

export type BrushTool = 'erase' | 'restore';
export interface BrushApi {
  undo: () => void;
  redo: () => void;
  zoomBy: (factor: number) => void;
  /** The edited cut-out as a PNG, trimmed to the garment with a small margin. */
  export: () => Promise<{ blob: Blob; width: number; height: number } | undefined>;
}

interface Patch { x: number; y: number; w: number; h: number; before: Uint8ClampedArray; after: Uint8ClampedArray }
interface State {
  /** Offscreen canvas holding the cut-out as edited. */
  off: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** The visible canvas: a transparency checker with the cut-out drawn over it (always opaque). */
  view: CanvasRenderingContext2D;
  checker: CanvasPattern | null;
  img: ImageData;
  /** Initial cut-out pixels, or the aligned original photo. */
  src: Uint8ClampedArray;
  srcIsOriginal: boolean;
  w: number;
  h: number;
  undo: Patch[];
  redo: Patch[];
  pre: Uint8ClampedArray | null;
  dirty: { x0: number; y0: number; x1: number; y1: number } | null;
  last: { x: number; y: number } | null;
}

const MAX_UNDO = 30;
const MIN_Z = 1;
const MAX_Z = 8;

function region(data: Uint8ClampedArray, W: number, x: number, y: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(data.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + w) * 4), r * w * 4);
  return out;
}
function writeRegion(data: Uint8ClampedArray, W: number, p: { x: number; y: number; w: number; h: number }, src: Uint8ClampedArray) {
  for (let r = 0; r < p.h; r++) data.set(src.subarray(r * p.w * 4, (r + 1) * p.w * 4), ((p.y + r) * W + p.x) * 4);
}

export const BrushEditor = forwardRef<BrushApi, {
  cutout: Blob;
  original?: Blob;
  tool: BrushTool;
  /** Brush diameter in screen pixels. */
  size: number;
  label: string;
  onHistory: (h: { canUndo: boolean; canRedo: boolean }) => void;
  onZoom: (z: number) => void;
}>(function BrushEditor({ cutout, original, tool, size, label, onHistory, onZoom }, ref) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const st = useRef<State | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [dims, setDims] = useState<{ w: number; h: number }>();
  const [view, setView] = useState({ z: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; mx: number; my: number; z0: number; tx0: number; ty0: number } | null>(null);
  const painting = useRef(false);
  const raf = useRef(0);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Load the cut-out (and, if it lines up, the original) into pixel buffers.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bmp = await createImageBitmap(cutout);
      if (cancelled) return;
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      let src = img.data.slice();
      let srcIsOriginal = false;
      if (original) {
        try {
          const ob = await createImageBitmap(original);
          // Same framing (the cut-out wasn't cropped): the original can paint garment pixels back.
          if (Math.abs(ob.width / ob.height - bmp.width / bmp.height) < 0.005) {
            const oc = document.createElement('canvas');
            oc.width = bmp.width;
            oc.height = bmp.height;
            const octx = oc.getContext('2d')!;
            octx.drawImage(ob, 0, 0, bmp.width, bmp.height);
            src = octx.getImageData(0, 0, bmp.width, bmp.height).data;
            srcIsOriginal = true;
          }
          ob.close();
        } catch { /* keep the cut-out's own pixels */ }
      }
      bmp.close();
      if (cancelled) return;
      const vc = canvasRef.current!;
      vc.width = c.width;
      vc.height = c.height;
      const view = vc.getContext('2d')!;
      st.current = { off: c, ctx, view, checker: null, img, src, srcIsOriginal, w: c.width, h: c.height, undo: [], redo: [], pre: null, dirty: null, last: null };
      setDims({ w: c.width, h: c.height });
      setView({ z: 1, tx: 0, ty: 0 });
      onHistory({ canUndo: false, canRedo: false });
    })();
    return () => { cancelled = true; };
  }, [cutout, original]);

  // Fit the image in the box.
  const base = dims && box.w ? Math.min(box.w / dims.w, box.h / dims.h) * 0.92 : 1;
  const ox = dims ? (box.w - dims.w * base) / 2 : 0;
  const oy = dims ? (box.h - dims.h * base) / 2 : 0;

  // First paint, and again when the box size changes the checker scale.
  useEffect(() => {
    const s = st.current;
    if (!s || !dims || !box.w) return;
    s.checker = null;
    paint();
    // paint() reads the current base through closure.
  }, [dims, box.w, box.h]);

  const toImage = (bx: number, by: number) => {
    const { z, tx, ty } = viewRef.current;
    return { x: ((bx - tx) / z - ox) / base, y: ((by - ty) / z - oy) / base };
  };

  /** Redraws the visible canvas: checker squares about 8 CSS px wide, then the cut-out. */
  function paint() {
    const s = st.current;
    if (!s) return;
    if (!s.checker) {
      const cell = Math.max(2, Math.round(8 / base));
      const tile = document.createElement('canvas');
      tile.width = tile.height = cell * 2;
      const tc = tile.getContext('2d')!;
      tc.fillStyle = '#ffffff';
      tc.fillRect(0, 0, cell * 2, cell * 2);
      tc.fillStyle = '#ECEAE4';
      tc.fillRect(0, 0, cell, cell);
      tc.fillRect(cell, cell, cell, cell);
      s.checker = s.view.createPattern(tile, 'repeat');
    }
    s.view.fillStyle = s.checker ?? '#ffffff';
    s.view.fillRect(0, 0, s.w, s.h);
    s.view.drawImage(s.off, 0, 0);
  }

  function flush() {
    const s = st.current;
    if (!s || !s.dirty) return;
    const { x0, y0, x1, y1 } = s.dirty;
    s.ctx.putImageData(s.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    paint();
  }
  function schedule() {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; flush(); });
  }

  function stamp(cx: number, cy: number, r: number) {
    const s = st.current!;
    const { w, h, img, src } = s;
    const d = img.data;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return;
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy > r2) continue;
        const i = (y * w + x) * 4;
        if (tool === 'erase') d[i + 3] = 0;
        else if (s.srcIsOriginal) { d[i] = src[i]; d[i + 1] = src[i + 1]; d[i + 2] = src[i + 2]; d[i + 3] = 255; }
        else if (src[i + 3] > 0) { d[i] = src[i]; d[i + 1] = src[i + 1]; d[i + 2] = src[i + 2]; d[i + 3] = Math.max(d[i + 3], src[i + 3]); }
      }
    }
    const b = s.dirty;
    s.dirty = b ? { x0: Math.min(b.x0, x0), y0: Math.min(b.y0, y0), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) } : { x0, y0, x1, y1 };
  }

  function paintTo(p: { x: number; y: number }) {
    const s = st.current!;
    const r = Math.max(0.75, size / 2 / (base * viewRef.current.z));
    const from = s.last ?? p;
    const dist = Math.hypot(p.x - from.x, p.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / Math.max(0.5, r / 3)));
    for (let k = 1; k <= steps; k++) stamp(from.x + ((p.x - from.x) * k) / steps, from.y + ((p.y - from.y) * k) / steps, r);
    if (!s.last) stamp(p.x, p.y, r);
    s.last = p;
    schedule();
  }

  function beginStroke(p: { x: number; y: number }) {
    const s = st.current;
    if (!s) return;
    s.pre = s.img.data.slice();
    s.dirty = null;
    s.last = null;
    painting.current = true;
    paintTo(p);
  }

  function endStroke(commit: boolean) {
    const s = st.current;
    painting.current = false;
    if (!s || !s.pre) return;
    if (s.dirty) {
      const { x0, y0, x1, y1 } = s.dirty;
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      if (commit) {
        s.undo.push({ x: x0, y: y0, w, h, before: region(s.pre, s.w, x0, y0, w, h), after: region(s.img.data, s.w, x0, y0, w, h) });
        if (s.undo.length > MAX_UNDO) s.undo.shift();
        s.redo = [];
      } else {
        writeRegion(s.img.data, s.w, { x: x0, y: y0, w, h }, region(s.pre, s.w, x0, y0, w, h));
      }
      flush();
    }
    s.pre = null;
    s.dirty = null;
    s.last = null;
    onHistory({ canUndo: s.undo.length > 0, canRedo: s.redo.length > 0 });
  }

  function applyPatch(p: Patch, data: Uint8ClampedArray) {
    const s = st.current!;
    writeRegion(s.img.data, s.w, p, data);
    s.ctx.putImageData(s.img, 0, 0, p.x, p.y, p.w, p.h);
    paint();
  }

  const setZoom = (z: number, cx: number, cy: number) => {
    const v = viewRef.current;
    const nz = Math.min(MAX_Z, Math.max(MIN_Z, z));
    const px = (cx - v.tx) / v.z, py = (cy - v.ty) / v.z;
    const next = nz === 1 ? { z: 1, tx: 0, ty: 0 } : { z: nz, tx: cx - px * nz, ty: cy - py * nz };
    setView(next);
    onZoom(nz);
  };

  useImperativeHandle(ref, () => ({
    undo() {
      const s = st.current;
      const p = s?.undo.pop();
      if (!s || !p) return;
      applyPatch(p, p.before);
      s.redo.push(p);
      onHistory({ canUndo: s.undo.length > 0, canRedo: true });
    },
    redo() {
      const s = st.current;
      const p = s?.redo.pop();
      if (!s || !p) return;
      applyPatch(p, p.after);
      s.undo.push(p);
      onHistory({ canUndo: true, canRedo: s.redo.length > 0 });
    },
    zoomBy(f) { setZoom(viewRef.current.z * f, box.w / 2, box.h / 2); },
    async export() {
      const s = st.current;
      if (!s) return undefined;
      // Trim to the garment plus a small margin, like the AI's cut-outs.
      const d = s.img.data;
      let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        if (d[(y * s.w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) return undefined;
      const m = Math.round(Math.max(s.w, s.h) * 0.02);
      x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(s.w - 1, x1 + m); y1 = Math.min(s.h - 1, y1 + m);
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.putImageData(s.img, -x0, -y0, x0, y0, w, h);
      return { blob: await canvasToBlob(c, 'image/png'), width: w, height: h };
    },
  }));

  const local = (e: RPointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function onDown(e: RPointerEvent<HTMLDivElement>) {
    if (!st.current) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      // A second finger: this is a pinch, not a stroke.
      if (painting.current) endStroke(false);
      const [a, b] = [...pointers.current.values()];
      const v = viewRef.current;
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, z0: v.z, tx0: v.tx, ty0: v.ty };
      setCursor(null);
    } else if (pointers.current.size === 1) {
      setCursor(p);
      beginStroke(toImage(p.x, p.y));
    }
  }

  function onMove(e: RPointerEvent<HTMLDivElement>) {
    const p = local(e);
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === 'mouse') setCursor(p);
      return;
    }
    pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const pc = pinch.current;
      const z = Math.min(MAX_Z, Math.max(MIN_Z, (pc.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / pc.d0));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const cx = (pc.mx - pc.tx0) / pc.z0, cy = (pc.my - pc.ty0) / pc.z0;
      setView(z === 1 ? { z, tx: mx - cx, ty: my - cy } : { z, tx: mx - cx * z, ty: my - cy * z });
      onZoom(z);
      return;
    }
    if (painting.current) {
      setCursor(p);
      paintTo(toImage(p.x, p.y));
    }
  }

  function onUp(e: RPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (painting.current) endStroke(true);
    if (pointers.current.size < 2) pinch.current = null;
    if (e.pointerType !== 'mouse') setCursor(null);
  }

  return (
    <div ref={boxRef} className="wd-brush" role="img" aria-label={label}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setCursor(null); }}>
      <div className="wd-brush__layer" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.z})` }}>
        <canvas ref={canvasRef} className="wd-brush__canvas"
          style={dims ? { left: ox, top: oy, width: dims.w * base, height: dims.h * base } : { visibility: 'hidden' }} />
      </div>
      {cursor && <span className="wd-brush__cursor" style={{ left: cursor.x, top: cursor.y, width: size, height: size }} aria-hidden="true" />}
    </div>
  );
});

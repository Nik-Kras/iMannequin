// The paper mannequin wearing a draft outfit, drawn on a canvas at the device's pixel ratio.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSettings } from '../data/repo';
import type { FitAdjustment, OutfitDraft } from '../domain/types';
import { useI18n, type Key } from '../i18n';
import { useBody, type LoadedBody } from './assets';
import { CANON } from './body';
import { Compositor, type View } from './compositor';
import { draftItemIds, loadSceneData, prepareScene, type PreparedScene } from './scene';
import { zoneRects, type MannequinZone } from './zones';

/** Canvas overflow around the 1000 × 2000 canonical box (canonical units), so a hat's top or a sleeve isn't clipped. */
export const STAGE_PAD = 60;

export interface StageLayout {
  /** CSS px per canonical unit. */
  scale: number;
  body: LoadedBody;
  scene: PreparedScene;
}

export interface StageProps {
  draft: OutfitDraft;
  height: number;
  mode?: 'photo' | 'outline';
  onTapZone?: (zone: MannequinZone) => void;
  selectedItemId?: string;
  className?: string;
  /** Draw this item with a fit that isn't saved yet (Adjust fit, live). */
  fitOverride?: { itemId: string; fit?: FitAdjustment };
  onLayout?: (layout: StageLayout) => void;
  /** Overlay drawn in the stage's CSS box (0..height/2 × 0..height). */
  children?: ReactNode;
}

const ZONE_LABEL: Record<MannequinZone, Key> = {
  head: 'dressup.tapZone.head', neck: 'dressup.tapZone.neck', torso: 'dressup.tapZone.torso',
  hands: 'dressup.tapZone.hands', legs: 'dressup.tapZone.legs', feet: 'dressup.tapZone.feet',
};

export function MannequinStage({ draft, height, mode, onTapZone, selectedItemId, className, fitOverride, onLayout, children }: StageProps) {
  const { t } = useI18n();
  const settings = useSettings();
  const body = useBody();
  const drawMode = mode ?? settings?.mannequin ?? 'photo';
  const ids = useMemo(() => draftItemIds(draft), [draft]);
  const idsKey = ids.join(',');
  const data = useLiveQuery(() => loadSceneData(ids), [idsKey]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const comp = useRef<Compositor>(null);
  if (!comp.current) comp.current = new Compositor();
  const run = useRef(0);
  const [dpr, setDpr] = useState(() => Math.min(3, window.devicePixelRatio || 1));
  const layoutCb = useRef(onLayout);
  layoutCb.current = onLayout;

  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const on = () => setDpr(Math.min(3, window.devicePixelRatio || 1));
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [dpr]);

  const width = height / 2;
  const scale = height / CANON.height;
  const padCss = STAGE_PAD * scale;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !body) return;
    const id = ++run.current;
    const W = Math.round((width + 2 * padCss) * dpr);
    const H = Math.round((height + 2 * padCss) * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const view: View = { s: scale * dpr, ox: padCss * dpr, oy: padCss * dpr, w: W, h: H };
    const g = canvas.getContext('2d');
    if (!g) return;
    const empty: PreparedScene = { layers: [], placements: {}, anchors: {} };
    const paint = (scene: PreparedScene) => {
      if (id !== run.current) return;
      comp.current!.draw(g, view, body, drawMode, scene.layers, selectedItemId);
      layoutCb.current?.({ scale, body, scene });
    };
    if (!data) { paint(empty); return; }
    prepareScene(draft, data, body, fitOverride).then(paint, () => paint(empty));
  }, [body, data, draft, fitOverride, drawMode, selectedItemId, height, width, scale, padCss, dpr]);

  const zones = useMemo(() => (body && onTapZone ? zoneRects(body) : []), [body, onTapZone]);

  return (
    <div className={`mannequin${className ? ` ${className}` : ''}`} style={{ position: 'relative', width, height }}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ position: 'absolute', left: -padCss, top: -padCss, width: width + 2 * padCss, height: height + 2 * padCss, pointerEvents: 'none' }}
      />
      {/* A tap on the body opens its slot. Out of VoiceOver's and the keyboard's way: Dress-up's slot column is the
          accessible path, and these zones are as small as 29 × 15 px (bug-audit #28). */}
      {zones.map((z, i) => (
        <button
          key={i}
          type="button"
          className="mannequin__zone"
          aria-label={t(ZONE_LABEL[z.zone])}
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => onTapZone?.(z.zone)}
          style={{ position: 'absolute', left: z.x * scale, top: z.y * scale, width: z.w * scale, height: z.h * scale, background: 'transparent', border: 0, padding: 0, borderRadius: 6 }}
        />
      ))}
      {children}
    </div>
  );
}

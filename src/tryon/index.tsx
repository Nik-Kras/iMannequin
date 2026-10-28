// Public API of the try-on module (docs/try-on.md). Screens import only from here.
// OWNER: the try-on module. Signatures are the contract other modules code against; keep them stable.
import type { BodyRecord, OutfitDraft, Slot } from '../domain/types';
import { currentBody, ctx2d, makeCanvas } from './assets';
import { CANON, type PoseIssue as BodyPoseIssue } from './body';
import { Compositor } from './compositor';
import { MannequinStage } from './Mannequin';
import { processBodyPhoto as processPhoto } from './process';
import { draftItemIds, loadSceneData, prepareScene } from './scene';

export type MannequinZone = 'head' | 'neck' | 'torso' | 'hands' | 'legs' | 'feet';

export interface MannequinProps {
  draft: OutfitDraft;
  /** Rendered height in CSS px; width follows the canonical 1:2 canvas. */
  height: number;
  mode?: 'photo' | 'outline';
  /** Called when the user taps a body zone (Dress-up). */
  onTapZone?: (zone: MannequinZone) => void;
  /** Item to outline as selected (Dress-up sheet open, Adjust fit). */
  selectedItemId?: string;
  className?: string;
}

/** The paper mannequin wearing a draft outfit. Falls back to a default outline body before the body photo exists. */
export function Mannequin(props: MannequinProps) {
  return <MannequinStage {...props} />;
}

/** Renders an outfit to an image (share card, thumbnails). */
export async function renderOutfitImage(draft: OutfitDraft, opts: { height: number; mode: 'photo' | 'outline' }): Promise<Blob> {
  const height = Math.max(64, Math.round(opts.height));
  const width = Math.round(height / 2);
  // A little room around the canonical box (100 units top and bottom) so hats and sleeves aren't clipped.
  const s = height / (CANON.height + 200);
  const view = { s, ox: (width - CANON.width * s) / 2, oy: 100 * s, w: width, h: height };
  const body = await currentBody();
  const data = await loadSceneData(draftItemIds(draft));
  const scene = await prepareScene(draft, data, body);
  const canvas = makeCanvas(width, height);
  new Compositor().draw(ctx2d(canvas), view, body, opts.mode, scene.layers);
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise<Blob>((res, rej) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

export type PoseIssue = BodyPoseIssue;

/**
 * Turns a body photo into the canonical body record, or reports what to fix (try-on §2.2). The record is returned,
 * not stored: the Check screen stores it with `saveBodyRecord` once the user accepts it.
 */
export async function processBodyPhoto(photo: Blob): Promise<{ body?: BodyRecord; issues: PoseIssue[] }> {
  return processPhoto(photo);
}

export type { Slot };

// Extra exports for the try-on screens (Dress-up, See all, Adjust fit, Body photo).
export { MannequinStage, STAGE_PAD, type StageLayout, type StageProps } from './Mannequin';
export { prepareBodyPhoto, saveBodyRecord } from './process';
export { useBody, type LoadedBody } from './assets';
export { calloutPoints, zoneRects } from './zones';
export { fitGarment, offsetForHandle, isNeutralFit, NEUTRAL_FIT, type Placement, type Handle } from './fit';
export { armAngles, LM, POSE_LIMITS, CANON as CANONICAL } from './body';
export { DESIGN_BODY_PATH, DESIGN_HEAD } from './defaultBody';

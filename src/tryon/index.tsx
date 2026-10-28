// Public API of the try-on module (docs/try-on.md). Screens import only from here.
// OWNER: the try-on module. Signatures are the contract other modules code against; keep them stable.
import type { BodyRecord, OutfitDraft, Slot } from '../domain/types';

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
export function Mannequin({ height, className }: MannequinProps) {
  return <div className={className} style={{ width: height / 2, height }} aria-hidden="true" />;
}

/** Renders an outfit to an image (share card, thumbnails). */
export async function renderOutfitImage(_draft: OutfitDraft, _opts: { height: number; mode: 'photo' | 'outline' }): Promise<Blob> {
  throw new Error('try-on: renderOutfitImage not implemented yet');
}

export interface PoseIssue { code: 'visibility' | 'armAngle' | 'facing' | 'framing'; detail?: string }

/** Turns a body photo into the canonical body record, or reports what to fix (try-on §2.2). */
export async function processBodyPhoto(_photo: Blob): Promise<{ body?: BodyRecord; issues: PoseIssue[] }> {
  throw new Error('try-on: processBodyPhoto not implemented yet');
}

export type { Slot };

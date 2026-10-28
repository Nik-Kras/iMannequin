// Public API of the on-device AI module (architecture §4). Screens import only from here.
// OWNER: the AI module. Signatures are the contract other modules code against; keep them stable.
import type { CategoryId, ColourName, Landmark, Season } from '../domain/types';

export interface CutoutResult {
  /** PNG with a transparent background, cropped to the garment with a small margin. */
  cutout: Blob;
  width: number;
  height: number;
  /** Model id that produced it, e.g. 'plain-bg', 'birefnet-lite'. */
  model: string;
  ms: number;
}

export interface GarmentAnalysis {
  categories: { id: CategoryId; score: number }[];
  colours: ColourName[];
  seasons: Season[];
  embedding?: Float32Array;
  embeddingModel?: string;
  model: string;
}

export interface PoseResult {
  /** 33 MediaPipe points, x/y normalised 0–1 to the photo. */
  landmarks: Landmark[];
  /** Person mask at photo size: alpha/intensity > 127 = body. */
  mask: ImageData;
  width: number;
  height: number;
  model: string;
}

export interface SearchHit { itemId: string; score: number }

export interface ModelInfo {
  id: string;
  task: 'cutout' | 'classify' | 'search' | 'describe' | 'pose';
  label: string;
  licence: string;
  /** Approximate download in MB, or undefined when unknown. */
  sizeMb?: number;
  /** Hugging Face repo id, or a self-hosted path. */
  source: string;
  default?: boolean;
}

const notReady = (what: string) => Promise.reject(new Error(`AI module: ${what} not implemented yet`));

/** Cuts the garment out of a flat-lay photo. Tries the plain-background fast path first, then the chosen model. */
export function cutOutGarment(_photo: Blob, _opts?: { model?: string }): Promise<CutoutResult> {
  return notReady('cutOutGarment');
}

/** Category (top-3), colours, seasons and an image embedding for a cut-out. */
export function analyseGarment(_cutout: Blob): Promise<GarmentAnalysis> {
  return notReady('analyseGarment');
}

/** The most similar existing item in the same zone, when it looks like the same physical piece (D9). */
export function findSameItem(_embedding: Float32Array, _category: CategoryId, _excludeItemId?: string): Promise<SearchHit | null> {
  return Promise.resolve(null);
}

/** Body key points and person mask from the A-pose photo. */
export function detectPose(_photo: Blob): Promise<PoseResult> {
  return notReady('detectPose');
}

/** Search the active wardrobe by description, in English or Ukrainian (D32). */
export function searchWardrobe(_query: string): Promise<SearchHit[]> {
  return Promise.resolve([]);
}

export const MODELS: ModelInfo[] = [];

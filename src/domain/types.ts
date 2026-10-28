// Records stored on the phone (architecture §7). Ids are random strings from newId().

export type Lang = 'en' | 'uk';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Where a piece is worn (PRD §5). `full` = dresses and jumpsuits; `acc` = accessories (side button, D17). */
export type Zone = 'head' | 'neck' | 'torso' | 'full' | 'legs' | 'feet' | 'hands' | 'acc';
export type Layer = 'base' | 'mid' | 'outer';
/** One item per slot (try-on §6); accessories can be several. */
export type Slot = 'head' | 'neck' | 'base' | 'mid' | 'outer' | 'full' | 'legs' | 'feet' | 'hands';
export const SLOTS: Slot[] = ['head', 'neck', 'base', 'mid', 'outer', 'full', 'legs', 'feet', 'hands'];

export type CategoryId =
  | 'tshirt' | 'top' | 'shirt' | 'blouse' | 'swimtop'
  | 'sweater' | 'hoodie' | 'cardigan'
  | 'jacket' | 'coat' | 'blazer'
  | 'dress' | 'jumpsuit' | 'swimsuit'
  | 'trousers' | 'jeans' | 'shorts' | 'skirt' | 'leggings' | 'swimshorts'
  | 'sneakers' | 'shoes' | 'boots' | 'sandals'
  | 'hat' | 'cap' | 'scarf' | 'tie' | 'gloves'
  | 'bag' | 'belt' | 'glasses' | 'jewellery';

/** Named colour palette used for suggestions, filters and search (architecture §4). */
export type ColourName =
  | 'black' | 'white' | 'grey' | 'cream' | 'beige' | 'brown' | 'tan'
  | 'red' | 'burgundy' | 'pink' | 'orange' | 'rust' | 'yellow' | 'mustard'
  | 'green' | 'olive' | 'khaki' | 'teal' | 'blue' | 'navy' | 'denim' | 'purple' | 'multi';

export interface Point { x: number; y: number }

/** Anchor points found on a garment cut-out (try-on §3), in the cut-out's pixel coordinates. */
export interface GarmentAnchors {
  group: AnchorGroup;
  /** Named points, e.g. shoulderL, shoulderR, armpitL, hemC, waistL, crotch, hemL… */
  points: Record<string, Point>;
  /** Size of the cut-out image the points refer to. */
  width: number;
  height: number;
}
export type AnchorGroup = 'top' | 'bottom' | 'skirt' | 'shoes' | 'hat' | 'scarf' | 'tie' | 'gloves' | 'glasses' | 'belt' | 'bag' | 'jewellery';

/** User's correction of the automatic fit, in units of the garment's reference length (try-on §5). */
export interface FitAdjustment {
  dx: number;
  dy: number;
  scale: number; // multiplier, 1 = automatic
  rotate: number; // degrees
  points?: Record<string, { dx: number; dy: number }>;
}

export type ItemStatus = 'review' | 'active' | 'archived';

export interface Item {
  id: string;
  name: string;
  category: CategoryId;
  colours: ColourName[];
  seasons: Season[];
  locationId?: string;
  brand?: string;
  notes?: string;
  /** The photo used on the mannequin; other photos of the same item are a gallery (D43). */
  tryOnPhotoId?: string;
  status: ItemStatus;
  fit?: FitAdjustment;
  /** AI suggestions kept for the review form (R5: every AI result is editable). */
  suggestion?: ItemSuggestion;
  createdAt: number;
  updatedAt: number;
  lastWornAt?: number;
}

export interface ItemSuggestion {
  categories?: { id: CategoryId; score: number }[];
  colours?: ColourName[];
  seasons?: Season[];
  /** Possible same physical item already in the wardrobe (D9). */
  sameItemId?: string;
  sameItemScore?: number;
  /** Which fields the AI filled, so the form can mark them. */
  aiFields?: ('name' | 'category' | 'colours' | 'seasons')[];
}

export interface Photo {
  id: string;
  itemId?: string;
  original: Blob;
  /** PNG with transparent background. */
  cutout?: Blob;
  /** Small JPEG/PNG for grids. */
  thumb?: Blob;
  width: number;
  height: number;
  cutoutModel?: string;
  cutoutApproved: boolean;
  anchors?: GarmentAnchors;
  embedding?: Float32Array;
  embeddingModel?: string;
  createdAt: number;
}

export interface Landmark { x: number; y: number; z: number; visibility: number }

/** The user's body photo, processed (try-on §2). Single record with id 'current'. */
export interface BodyRecord {
  id: 'current';
  photo: Blob;
  /** Body cut-out on the canonical canvas (PNG with alpha). */
  cutout: Blob;
  /** Body mask on the canonical canvas (PNG, white = body). */
  mask: Blob;
  /** 33 MediaPipe points in canonical canvas coordinates. */
  landmarks: Landmark[];
  canonical: { width: number; height: number };
  metrics?: Record<string, number>;
  createdAt: number;
}

export interface Location { id: string; name: string; order: number }

export interface OutfitToggles { tuckIn: boolean; intoBoots: boolean }

export interface Outfit {
  id: string;
  name: string;
  slots: Partial<Record<Slot, string>>;
  accessories: string[];
  toggles: OutfitToggles;
  createdAt: number;
  updatedAt: number;
}

/** The outfit currently on the mannequin (not necessarily saved). */
export interface OutfitDraft {
  slots: Partial<Record<Slot, string>>;
  accessories: string[];
  toggles: OutfitToggles;
  /** Set when the draft was loaded from (and still matches) a saved outfit. */
  outfitId?: string;
}

export interface WearEntry { id: string; date: string; outfitId?: string; itemIds: string[]; createdAt: number }

export interface TripEntry { id: string; kind: 'item' | 'outfit'; refId: string; packed: boolean }
export interface Trip { id: string; name: string; start: string; end: string; entries: TripEntry[]; archived: boolean; createdAt: number }

export type QueueState = 'waiting' | 'working' | 'done' | 'failed';
/** Why a queue job failed; the review inbox shows a message and an action for each (bug-audit #16). */
export type QueueError = 'no-garment' | 'models' | 'network' | 'storage' | 'photo-lost' | 'unreadable' | 'other';

export interface QueueJob {
  id: string;
  kind: 'garment';
  blob: Blob;
  state: QueueState;
  error?: string;
  errorCode?: QueueError;
  itemId?: string;
  createdAt: number;
}

export type AiTask = 'cutout' | 'classify' | 'search' | 'describe' | 'pose';

export interface AppSettings {
  id: 'app';
  lang: Lang;
  mannequin: 'photo' | 'outline';
  weather: { enabled: boolean; lat?: number; lon?: number };
  models: Partial<Record<AiTask, string>>;
  notWornMonths: number;
  onboarded: boolean;
  modelsReady: boolean;
  installGuideDismissed: boolean;
  /** The default places were made once (D22); deleted ones never come back (bug-audit #34). */
  placesSeeded?: boolean;
  /** Crash reports to Sentry (D50): technical data only, on by default, switchable in Settings. */
  diagnostics: boolean;
  lastBackupAt?: number;
  backupReminderAt?: number;
  draft: OutfitDraft;
}

export interface CalibrationRun {
  id: string;
  task: AiTask;
  modelId: string;
  photos: number;
  msPerPhoto: number;
  editedRate?: number;
  device: string;
  createdAt: number;
}

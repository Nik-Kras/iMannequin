// Synthetic sample wardrobe drawn from the design canvas's paper garments (R2: no real photos).
// Load it with ?seed in the URL (dev, e2e tests and README screenshots).
import { db, getSettings, newId, updateSettings } from '../data/db';
import { ensureDefaultPlaces } from '../data/repo';
import type { CategoryId, ColourName, Item, Photo, Season } from '../domain/types';
import { SHAPES as G } from './shapes';

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** Renders one garment shape to a transparent PNG, the same way a real cut-out is stored. */
export async function renderGarmentPng(kind: string, color: string, width = 640): Promise<{ blob: Blob; width: number; height: number }> {
  const g = G[kind];
  const [, , vw, vh] = g.vb.split(' ').map(Number);
  const height = Math.round((width * vh) / vw);
  const detail = luminance(color) < 0.35 ? 'rgba(255,255,255,.38)' : 'rgba(20,20,20,.28)';
  const sw = (vw / width) * 2.4;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${g.vb}" width="${width}" height="${height}"><path d="${g.d}" fill="${color}" fill-rule="${g.rule ?? 'nonzero'}"/><path d="${g.x}" fill="none" stroke="${detail}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
  return { blob, width, height };
}

type Sample = [kind: string, color: string, name: string, category: CategoryId, colours: ColourName[], seasons: Season[], place: number, wornDaysAgo?: number];
export const SAMPLES: Sample[] = [
  ['tee', '#EFE6D2', 'Cream T-shirt', 'tshirt', ['cream'], ['spring', 'summer'], 1, 2],
  ['tee', '#1E1E1E', 'Black T-shirt', 'tshirt', ['black'], ['spring', 'summer', 'autumn'], 1, 9],
  ['tee', '#9AA88A', 'Sage T-shirt', 'tshirt', ['green'], ['summer'], 1],
  ['sweater', '#B5562F', 'Rust sweater', 'sweater', ['rust'], ['autumn', 'winter'], 5, 16],
  ['sweater', '#2F3E5C', 'Navy sweater', 'sweater', ['navy'], ['autumn', 'winter'], 2, 200],
  ['jacket', '#4A6A8F', 'Denim jacket', 'jacket', ['denim'], ['spring', 'autumn'], 4, 1],
  ['coat', '#B08A5A', 'Camel coat', 'coat', ['tan'], ['autumn', 'winter'], 4, 25],
  ['dress', '#A8323A', 'Red dress', 'dress', ['red'], ['summer'], 0, 39],
  ['jeans', '#3E5B85', 'Blue jeans', 'jeans', ['denim'], ['spring', 'autumn', 'winter'], 1, 1],
  ['jeans', '#232323', 'Black jeans', 'jeans', ['black'], ['autumn', 'winter'], 1, 6],
  ['skirt', '#6B6B3A', 'Olive skirt', 'skirt', ['olive'], ['spring', 'summer'], 0, 230],
  ['shorts', '#C9B48E', 'Beige shorts', 'shorts', ['beige'], ['summer'], 3],
  ['sneakers', '#F2F1EC', 'White sneakers', 'sneakers', ['white'], ['spring', 'summer', 'autumn'], 4, 1],
  ['boots', '#1E1E1E', 'Black boots', 'boots', ['black'], ['autumn', 'winter'], 4, 6],
  ['beanie', '#C9962F', 'Mustard beanie', 'hat', ['mustard'], ['winter'], 2],
  ['scarf', '#A8323A', 'Red scarf', 'scarf', ['red'], ['winter'], 2, 30],
  ['bag', '#C8B08A', 'Canvas tote', 'bag', ['beige'], ['spring', 'summer'], 4],
];

export async function seedSampleWardrobe(): Promise<void> {
  const s = await getSettings();
  await ensureDefaultPlaces(s.lang);
  const places = await db.locations.orderBy('order').toArray();
  const now = Date.now();
  for (const [kind, color, name, category, colours, seasons, place, worn] of SAMPLES) {
    const { blob, width, height } = await renderGarmentPng(kind, color);
    const itemId = newId();
    const photo: Photo = { id: newId(), itemId, original: blob, cutout: blob, thumb: blob, width, height, cutoutModel: 'sample', cutoutApproved: true, createdAt: now };
    const item: Item = {
      id: itemId, name, category, colours, seasons, locationId: places[place]?.id, tryOnPhotoId: photo.id,
      status: 'active', createdAt: now, updatedAt: now, lastWornAt: worn === undefined ? undefined : now - worn * 86_400_000,
    };
    await db.photos.put(photo);
    await db.items.put(item);
  }
  await updateSettings({ onboarded: true, modelsReady: true, installGuideDismissed: true });
}

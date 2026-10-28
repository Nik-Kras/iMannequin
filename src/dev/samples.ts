// Synthetic sample wardrobe drawn from the design canvas's paper garments (R2: no real photos).
// Load it with ?seed in the URL (dev, e2e tests and README screenshots).
import { db, getSettings, newId, updateSettings } from '../data/db';
import { ensureDefaultPlaces } from '../data/repo';
import type { CategoryId, ColourName, Item, Photo, Season } from '../domain/types';

interface Shape { vb: string; d: string; x: string; rule?: string }
// Paths in a 200 x 400 body space; vb is the garment's own crop.
const G: Record<string, Shape> = {
      tee: { vb: '40 54 120 124', d: 'M92 60Q100 70 108 60L132 68L155 108L137 119L127 101L126 168Q100 173 74 168L73 101L63 119L45 108L68 68Z', x: 'M94 61Q100 67 106 61M74 161Q100 166 126 161' },
      sweater: { vb: '4 50 192 138', d: 'M91 59Q100 68 109 59L134 67Q142 72 145 82L166 124L189 171L176 180L152 135L130 104L129 166L130 176Q100 180 70 176L71 166L70 104L48 135L24 180L11 171L34 124L55 82Q58 72 66 67Z', x: 'M93 60Q100 66 107 60M71 166Q100 170 129 166M183 165L171 174M17 165L29 174' },
      jacket: { vb: '2 50 196 154', d: 'M90 56L99 120L99 197Q82 198 66 195L67 108L47 137L23 183L8 174L32 124L52 80Q56 69 66 64ZM110 56L101 120L101 197Q118 198 134 195L133 108L153 137L177 183L192 174L168 124L148 80Q144 69 134 64Z', x: 'M90 56L84 84L97 108M110 56L116 84L103 108M74 168L90 168M110 168L126 168M31 170L19 178M169 170L181 178' },
      coat: { vb: '2 50 196 242', d: 'M90 56L99 120L99 285Q80 287 62 283L65 108L47 137L23 183L8 174L32 124L52 80Q56 69 66 64ZM110 56L101 120L101 285Q120 287 138 283L135 108L153 137L177 183L192 174L168 124L148 80Q144 69 134 64Z', x: 'M90 56L84 84L97 108M110 56L116 84L103 108M70 150L96 150M104 150L130 150M72 196L88 196M112 196L128 196' },
      jeans: { vb: '60 166 80 194', d: 'M75 172L125 172L127 200L124 270L122 353L108 353L104 272L100 214L96 272L92 353L78 353L76 270L73 200Z', x: 'M75 180L125 180M100 180L100 206M79 182Q84 192 90 182M121 182Q116 192 110 182' },
      shorts: { vb: '64 166 72 70', d: 'M75 172L125 172L128 200L129 228L105 230L100 212L95 230L71 228L72 200Z', x: 'M75 180L125 180M100 180L100 204' },
      skirt: { vb: '56 164 88 110', d: 'M77 170L123 170L136 262Q100 268 64 262Z', x: 'M77 178L123 178M92 180L86 262M108 180L114 262M100 180L100 265' },
      leggings: { vb: '62 166 76 192', d: 'M75 172L125 172L126 205L122 270L120 352L110 352L105 272L100 214L95 272L90 352L80 352L78 270L74 205Z', x: 'M75 179L125 179' },
      dress: { vb: '48 54 104 260', d: 'M91 60Q100 70 109 60L130 67L146 92L133 101L124 100L121 140L140 300Q100 308 60 300L79 140L76 100L67 101L54 92L70 67Z', x: 'M79 140Q100 145 121 140M93 61Q100 67 107 61' },
      sneakers: { vb: '62 344 76 40', d: 'M70 362Q70 352 80 352L91 352Q96 356 95 366L95 377L69 377ZM130 362Q130 352 120 352L109 352Q104 356 105 366L105 377L131 377Z', x: 'M69 371L95 371M105 371L131 371M80 357L90 357M80 361L90 361M110 357L120 357M110 361L120 361' },
      boots: { vb: '60 294 80 90', d: 'M75 300L92 300L93 362Q97 368 96 378L68 378Q67 368 72 362ZM125 300L108 300L107 362Q103 368 104 378L132 378Q133 368 128 362Z', x: 'M68 372L96 372M104 372L132 372M75 308L92 308M108 308L125 308' },
      beanie: { vb: '76 -6 48 40', d: 'M83 26Q84 6 100 6Q116 6 117 26L118 30L82 30ZM95 2A5 5 0 1 0 105 2A5 5 0 1 0 95 2Z', x: 'M82 23L118 23M88 23L88 30M94 23L94 30M100 23L100 30M106 23L106 30M112 23L112 30' },
      scarf: { vb: '78 44 44 82', d: 'M86 50Q100 62 114 50L116 63Q100 74 84 63ZM90 64L99 66L100 116L88 116Z', x: 'M88 116L88 121M92 116L92 121M96 116L96 121M100 116L100 121M86 56Q100 66 114 56' },
      gloves: { vb: '2 168 196 40', d: 'M12 176L26 178L27 194Q26 203 17 202Q9 201 9 192ZM188 176L174 178L173 194Q174 203 183 202Q191 201 191 192Z', x: 'M11 181L26 183M189 181L174 183' },
      bag: { vb: '156 160 48 74', d: 'M167 190L197 190L199 229L165 229Z', x: 'M173 190Q182 164 191 190M165 199L199 199' },
      belt: { vb: '68 162 64 26', d: 'M74 172L126 172L126 180L74 180Z', x: 'M96 171L104 171L104 181L96 181Z' },
      glasses: { vb: '82 20 36 22', d: 'M86.5 31A6 6 0 1 0 98.5 31A6 6 0 1 0 86.5 31ZM88 31A4.5 4.5 0 1 0 97 31A4.5 4.5 0 1 0 88 31ZM101.5 31A6 6 0 1 0 113.5 31A6 6 0 1 0 101.5 31ZM103 31A4.5 4.5 0 1 0 112 31A4.5 4.5 0 1 0 103 31Z', x: 'M98.5 30.5L101.5 30.5', rule: 'evenodd' }
    };

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

// Synthetic garment shapes for the try-on tests: the design canvas's paper garments (Garment board, 200 × 400 body
// space), rasterised the same way the sample wardrobe renders them (640 px wide, cropped to their own box). R2: no photos.
import { emptyMask, fillPolys, flattenPath, mapPolys, type Mask } from '../../src/tryon/raster';

export const SHAPES: Record<string, { vb: string; d: string; rule?: 'evenodd' }> = {
  tee: { vb: '40 54 120 124', d: 'M92 60Q100 70 108 60L132 68L155 108L137 119L127 101L126 168Q100 173 74 168L73 101L63 119L45 108L68 68Z' },
  sweater: { vb: '4 50 192 138', d: 'M91 59Q100 68 109 59L134 67Q142 72 145 82L166 124L189 171L176 180L152 135L130 104L129 166L130 176Q100 180 70 176L71 166L70 104L48 135L24 180L11 171L34 124L55 82Q58 72 66 67Z' },
  jacket: { vb: '2 50 196 154', d: 'M90 56L99 120L99 197Q82 198 66 195L67 108L47 137L23 183L8 174L32 124L52 80Q56 69 66 64ZM110 56L101 120L101 197Q118 198 134 195L133 108L153 137L177 183L192 174L168 124L148 80Q144 69 134 64Z' },
  dress: { vb: '48 54 104 260', d: 'M91 60Q100 70 109 60L130 67L146 92L133 101L124 100L121 140L140 300Q100 308 60 300L79 140L76 100L67 101L54 92L70 67Z' },
  tank: { vb: '60 54 80 120', d: 'M88 60L94 60Q100 70 106 60L112 60L114 80Q118 96 126 100L126 168L74 168L74 100Q82 96 86 80Z' },
  jeans: { vb: '60 166 80 194', d: 'M75 172L125 172L127 200L124 270L122 353L108 353L104 272L100 214L96 272L92 353L78 353L76 270L73 200Z' },
  shorts: { vb: '64 166 72 70', d: 'M75 172L125 172L128 200L129 228L105 230L100 212L95 230L71 228L72 200Z' },
  skirt: { vb: '56 164 88 110', d: 'M77 170L123 170L136 262Q100 268 64 262Z' },
  sneakers: { vb: '62 344 76 40', d: 'M70 362Q70 352 80 352L91 352Q96 356 95 366L95 377L69 377ZM130 362Q130 352 120 352L109 352Q104 356 105 366L105 377L131 377Z' },
  beanie: { vb: '76 -6 48 40', d: 'M83 26Q84 6 100 6Q116 6 117 26L118 30L82 30ZM95 2A5 5 0 1 0 105 2A5 5 0 1 0 95 2Z' },
  scarf: { vb: '78 44 44 82', d: 'M86 50Q100 62 114 50L116 63Q100 74 84 63ZM90 64L99 66L100 116L88 116Z' },
  gloves: { vb: '2 168 196 40', d: 'M12 176L26 178L27 194Q26 203 17 202Q9 201 9 192ZM188 176L174 178L173 194Q174 203 183 202Q191 201 191 192Z' },
  belt: { vb: '68 162 64 26', d: 'M74 172L126 172L126 180L74 180Z' },
  glasses: { vb: '82 20 36 22', d: 'M86.5 31A6 6 0 1 0 98.5 31A6 6 0 1 0 86.5 31ZM88 31A4.5 4.5 0 1 0 97 31A4.5 4.5 0 1 0 88 31ZM101.5 31A6 6 0 1 0 113.5 31A6 6 0 1 0 101.5 31ZM103 31A4.5 4.5 0 1 0 112 31A4.5 4.5 0 1 0 103 31Z', rule: 'evenodd' },
};

/** A garment's cut-out mask and the map from its pixels back to the design body space (where the designer drew it). */
export function garmentMask(kind: string, width = 640): { mask: Mask; toDesign: (p: { x: number; y: number }) => { x: number; y: number } } {
  const g = SHAPES[kind];
  const [vx, vy, vw, vh] = g.vb.split(' ').map(Number);
  const height = Math.round((width * vh) / vw);
  const k = width / vw;
  const polys = mapPolys(flattenPath(g.d, 16), (p) => ({ x: (p.x - vx) * k, y: (p.y - vy) * k }));
  const mask = fillPolys(emptyMask(width, height), polys, { evenOdd: g.rule === 'evenodd' });
  return { mask, toDesign: (p) => ({ x: p.x / k + vx, y: p.y / k + vy }) };
}

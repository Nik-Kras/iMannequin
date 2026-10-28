// Swatch colours for the named garment palette. These are clothes' colours, so they may appear on screen (D27).
import type { ColourName } from '../domain/types';

export const COLOUR_HEX: Record<ColourName, string> = {
  black: '#1E1E1E',
  white: '#F4F2EC',
  grey: '#8C8C8C',
  cream: '#EFE6D2',
  beige: '#C9B48E',
  brown: '#6B4A32',
  tan: '#B08A5A',
  red: '#A8323A',
  burgundy: '#6E2233',
  pink: '#E3A3B4',
  orange: '#D9782F',
  rust: '#B5562F',
  yellow: '#E8C547',
  mustard: '#C9962F',
  green: '#5E8C61',
  olive: '#6B6B3A',
  khaki: '#A39A6B',
  teal: '#2E7D7A',
  blue: '#3E6FB0',
  navy: '#2F3E5C',
  denim: '#4A6A8F',
  purple: '#6E4A8F',
  multi: '#A8323A',
};

/** CSS background for a swatch: one flat colour, or hard colour stops for multicolour pieces. */
export function swatchBackground(c: ColourName): string {
  if (c === 'multi') return 'conic-gradient(#A8323A 0 33%, #E8C547 0 66%, #3E6FB0 0)';
  return COLOUR_HEX[c];
}

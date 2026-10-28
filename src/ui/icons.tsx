// One stroke icon set (24 × 24, 1.8 stroke), drawn to match the paper style. Decorative by default.
import type { SVGProps } from 'react';

const P: Record<string, string> = {
  dressup: 'M12 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM8.5 9.5h7l1 5h-9ZM10 14.5 9.5 21M14 14.5l.5 6.5M8.5 9.5 5.5 15M15.5 9.5l3 5.5',
  wardrobe: 'M10 5a2 2 0 1 1 2 2v2l8.6 6.3c.9.7.4 2.2-.7 2.2H4.1c-1.1 0-1.6-1.5-.7-2.2L12 9',
  outfits: 'M6 4h12v17l-6-4-6 4Z',
  trips: 'M4 8h16v11H4ZM9 8V5h6v3M8 8v11M16 8v11',
  plus: 'M12 5v14M5 12h14',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1',
  back: 'M15 6l-6 6 6 6',
  chevron: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  share: 'M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v7h14v-7',
  bag: 'M5 9h14l-1 11H6ZM9 9V7a3 3 0 0 1 6 0v2',
  fit: 'M5 5h14v14H5Z',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.5 15.5 20 20',
  camera: 'M4 8h3l2-2.5h6L17 8h3v11H4ZM12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  gallery: 'M4 5h16v14H4ZM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 8.5h.01',
  scissors: 'M6 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM8.2 8.3 20 18M8.2 15.7 20 6',
  brush: 'M14.5 4.5l5 5L10 19l-5 1 1-5ZM12.5 6.5l5 5',
  undo: 'M4 9h11a5 5 0 0 1 0 10H8M8 5 4 9l4 4',
  redo: 'M20 9H9a5 5 0 0 0 0 10h7M16 5l4 4-4 4',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
  pin: 'M12 21s6-6.1 6-11a6 6 0 0 0-12 0c0 4.9 6 11 6 11ZM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  lock: 'M6 11h12v9H6ZM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  weather: 'M7 15h10a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 8 9.5 2.8 2.8 0 0 0 7 15ZM9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5',
  calendar: 'M4 6h16v14H4ZM4 10h16M8 3v5M16 3v5',
  wifi: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.6 15.8a5 5 0 0 1 6.8 0M12 19h.01',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14',
  upload: 'M12 20V9M7.5 13.5 12 9l4.5 4.5M5 4h14',
  flask: 'M9 3h6M10 3v6l-5 9.5A1.7 1.7 0 0 0 6.5 21h11a1.7 1.7 0 0 0 1.5-2.5L14 9V3',
  warning: 'M12 4 2.5 20h19ZM12 10v4.5M12 17.5h.01',
  move: 'M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5',
  rotate: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  tap: 'M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.6-2.2L4.6 15a1.5 1.5 0 0 1 2.3-1.9L9 15',
  none: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.6 5.6l12.8 12.8',
  sparkle: 'M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8Z',
  timer: 'M12 8v5l3 2M9 2.5h6M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
  flip: 'M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5M4 20v-4.5h4.5',
};
export type IconName = keyof typeof P;

export function Icon({ name, size = 22, strokeWidth = 1.8, ...rest }: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  const filled = name === 'sparkle';
  const dashed = name === 'fit';
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d={P[name]} strokeDasharray={dashed ? '2.5 2.5' : undefined} />
      {dashed && <path d="M5 5h.01M19 5h.01M5 19h.01M19 19h.01" strokeWidth={4.5} />}
    </svg>
  );
}

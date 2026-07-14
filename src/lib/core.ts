export const PALETTE = [
  {
    id: 'violet',
    label: 'Violet',
    soft: 'var(--cat-violet-soft)',
    base: 'var(--cat-violet)',
    ink: 'var(--cat-violet-ink)',
    hex: '#A185E4',
  },
  {
    id: 'green',
    label: 'Green',
    soft: 'var(--cat-green-soft)',
    base: 'var(--cat-green)',
    ink: 'var(--cat-green-ink)',
    hex: '#6FB97A',
  },
  {
    id: 'blue',
    label: 'Blue',
    soft: 'var(--cat-blue-soft)',
    base: 'var(--cat-blue)',
    ink: 'var(--cat-blue-ink)',
    hex: '#57A7D2',
  },
  {
    id: 'orange',
    label: 'Orange',
    soft: 'var(--cat-orange-soft)',
    base: 'var(--cat-orange)',
    ink: 'var(--cat-orange-ink)',
    hex: '#F79A4E',
  },
  { id: 'cocoa', label: 'Cocoa', soft: '#F2E5DA', base: '#A9744F', ink: '#6E472C', hex: '#A9744F' },
  { id: 'rose', label: 'Rose', soft: '#FBE3DD', base: '#DC6A52', ink: '#a23a25', hex: '#DC6A52' },
] as const;

export type PaletteEntry = (typeof PALETTE)[number];

export const colorOf = (id: string | null | undefined): PaletteEntry =>
  (PALETTE.find((p) => p.id === id) as PaletteEntry | undefined) ?? PALETTE[0];

export const ICON_TINT = (color: string | null | undefined): { background: string; color: string } => {
  const c = colorOf(color);
  return { background: c.soft, color: c.ink };
};

export const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

export const iso = (d: Date | string | number): string => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export const addDays = (d: Date | string | number, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export function makeCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s.slice(0, 3) + '-' + s.slice(3);
}

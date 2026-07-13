// src/lib/core.js — shared domain primitives: the category palette, date helpers,
// invite-code generation, and the icon tint used across screens.

// ---- Category color palette (maps to DS category hues) ----
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
];

export const colorOf = (id) => PALETTE.find((p) => p.id === id) || PALETTE[0];

// Soft background + ink foreground for tinted icon chips.
export const ICON_TINT = (color) => {
  const c = colorOf(color);
  return { background: c.soft, color: c.ink };
};

// ---- Date helpers (anchored to "today" for a stable demo) ----
export const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

export const iso = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

// ---- One-time invite codes (XXX-XXX, no ambiguous chars) ----
export function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s.slice(0, 3) + '-' + s.slice(3);
}

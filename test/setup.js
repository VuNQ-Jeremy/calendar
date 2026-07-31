import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { vi, beforeEach, afterEach } from 'vitest';

export const EMPTY_STATE = {
  classes: [],
  students: [],
  users: [],
  parents: [],
  events: [],
  materials: [],
  invites: [],
  feedback: [],
  theme: {
    bg: '#FFFCF8',
    gridLine: '#ECE0CF',
    today: '#FFE7D1',
    header: '#FDF6EC',
    bgImage: '',
    bgOpacity: 0.12,
  },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => ({
      ok: true,
      json: async () => (String(url).endsWith('/state') ? EMPTY_STATE : {}),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

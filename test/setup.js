import React from 'react';
import ReactDOM from 'react-dom';
import '@testing-library/jest-dom/vitest';
import { vi, beforeEach, afterEach } from 'vitest';

window.React = React;
window.ReactDOM = ReactDOM;

// Load the DS bundle (IIFE that reads window.React and attaches window.MochiDesignSystem_472b36).
// Must come after the globals above.
await import('../public/_ds/mochi-design-system-472b365a-31b5-44c2-8b48-4d5ab7945e52/_ds_bundle.js');

if (!window.MochiDesignSystem_472b36?.Button) {
  throw new Error(
    'DS bundle failed to attach window.MochiDesignSystem_472b36.Button — check the bundle path',
  );
}

export const EMPTY_STATE = {
  classes: [],
  students: [],
  users: [],
  parents: [],
  events: [],
  homework: [],
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
  vi.unstubAllGlobals();
});

/**
 * Fonts for the video catalog.
 *
 * The app's display face is Fredoka, but **Fredoka ships no Vietnamese subset**
 * (@fontsource/fredoka metadata: hebrew, latin, latin-ext) — every "Điểm danh"
 * would render with fallback diacritics. Baloo Two is the closest rounded
 * geometric face that does have `vietnamese`, so it carries all Vietnamese
 * display text; Fredoka survives for the latin-only "Mochi" wordmark, where the
 * brand shape matters and no diacritic can appear.
 *
 * DM Mono is also latin-only, which is fine: it is used for digits, times and
 * dates, never for prose.
 */
import { loadFont as loadBaloo } from '@remotion/google-fonts/Baloo2';
import { loadFont as loadNunito } from '@remotion/google-fonts/NunitoSans';
import { loadFont as loadMono } from '@remotion/google-fonts/DMMono';
import { loadFont as loadFredoka } from '@remotion/google-fonts/Fredoka';

/** Vietnamese display text — headings, titles, big numbers. */
export const display = loadBaloo('normal', {
  weights: ['500', '600', '700'],
  subsets: ['latin', 'latin-ext', 'vietnamese'],
});

/** Captions and body copy. */
export const body = loadNunito('normal', {
  weights: ['400', '600', '700'],
  subsets: ['latin', 'latin-ext', 'vietnamese'],
});

/** Digits, times, dates, version numbers. Never prose. */
export const mono = loadMono('normal', {
  weights: ['400', '500'],
  subsets: ['latin', 'latin-ext'],
});

/** The "Mochi" wordmark only — latin-safe by construction. */
export const wordmark = loadFredoka('normal', {
  weights: ['500', '600'],
  subsets: ['latin'],
});

export const font = {
  display: display.fontFamily,
  body: body.fontFamily,
  mono: mono.fontFamily,
  wordmark: wordmark.fontFamily,
} as const;

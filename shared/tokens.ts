/**
 * MIRROR of the Mochi Design System tokens, as plain JS values.
 *
 *   src/ds/styles/tokens/{colors,spacing,effects,typography}.css  = source of truth for WEB
 *   this file                                                     = source of truth for MOBILE
 *
 * React Native cannot read CSS custom properties, so the values are duplicated here as
 * literals. **Keep them in sync by hand — change one, change the other.**
 *
 * Every value below was copied from the CSS, not invented. The design system is a binding
 * contract: no new colors, ever.
 */

/** Raw color ramps — colors.css lines 10-67. */
export const ramp = {
  orange: {
    50: '#FFF4EA',
    100: '#FFE7D1',
    200: '#FFD0A8',
    300: '#FCB377',
    400: '#F79A4E', // base
    500: '#EF8434',
    600: '#D96B1C',
    700: '#B0521A', // text-safe on cream
  },
  violet: {
    50: '#F4F0FE',
    100: '#E8E0FD',
    200: '#D4C6F7',
    300: '#BBA6EF',
    400: '#A185E4', // base
    500: '#8A6BD6',
    700: '#5E45A0', // text-safe
  },
  green: {
    50: '#EEF8EE',
    100: '#D9F0DB',
    200: '#B6E0BA',
    300: '#8ECC95',
    400: '#6FB97A', // base
    500: '#519A5D',
    700: '#356B40', // text-safe
  },
  blue: {
    50: '#ECF6FB',
    100: '#D6ECF6',
    200: '#ADD8EC',
    300: '#7EBFDF',
    400: '#57A7D2', // base
    500: '#3B89B8',
    700: '#265E80', // text-safe
  },
  cocoa: { 100: '#F2E5DA', 300: '#D3A981', 500: '#A9744F', 700: '#6E472C' },
  cream: { 50: '#FFFCF8', 100: '#FDF6EC', 200: '#F6EDDF' },
  sand: { 300: '#ECE0CF', 400: '#DBCBB4' },
  taupe: { 400: '#B8A893', 500: '#8C7C68' },
  ink: { 700: '#5C4F42', 900: '#3A312A' },
} as const;

/** Status colors — colors.css lines 64-67. */
export const status = {
  success: '#519A5D',
  warning: '#E0A02E',
  danger: '#DC6A52',
  info: '#3B89B8',
} as const;

/** Semantic aliases — colors.css lines 73-97. Use these, not the raw ramps. */
export const semantic = {
  // Surfaces
  bgPage: ramp.cream[50],
  surfaceCard: '#FFFFFF',
  surfaceRaised: ramp.cream[100],
  surfaceSunken: ramp.cream[200],
  surfaceHover: ramp.cream[200],
  // Text
  textStrong: ramp.ink[900],
  textBody: ramp.ink[700],
  textMuted: ramp.taupe[500],
  textDisabled: ramp.taupe[400],
  textOnBrand: '#FFFFFF',
  textLink: ramp.orange[700],
  // Borders
  borderSubtle: ramp.sand[300],
  borderStrong: ramp.sand[400],
  borderFocus: ramp.orange[400],
  // Brand
  brand: ramp.orange[400],
  brandHover: ramp.orange[500],
  brandPress: ramp.orange[600],
  brandSoft: ramp.orange[100],
  brandSoftInk: ramp.orange[700],
} as const;

/**
 * Category colors, keyed by the six `ColorId` values in shared/schemas.ts.
 *
 * These strings are stored in the database (staff.color, students.color, classes.color,
 * events.color, flashcard_topics.color) — they are a DATA contract, not a styling choice.
 * Values mirror PALETTE in src/lib/core.ts, with the CSS vars resolved to literals.
 */
export const categoryColor = {
  violet: { soft: ramp.violet[100], base: ramp.violet[400], ink: ramp.violet[700] },
  green: { soft: ramp.green[100], base: ramp.green[400], ink: ramp.green[700] },
  blue: { soft: ramp.blue[100], base: ramp.blue[400], ink: ramp.blue[700] },
  orange: { soft: ramp.orange[100], base: ramp.orange[400], ink: ramp.orange[700] },
  cocoa: { soft: '#F2E5DA', base: '#A9744F', ink: '#6E472C' },
  rose: { soft: '#FBE3DD', base: '#DC6A52', ink: '#a23a25' },
} as const;

export type ColorIdKey = keyof typeof categoryColor;

/** Font families. Mobile loads these via @expo-google-fonts, not @fontsource. */
export const typography = {
  display: 'Fredoka',
  body: 'Nunito Sans',
  mono: 'DM Mono',
} as const;

/** Corner radii — effects.css. Numbers, since RN has no `px`. */
export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, xxl: 36, pill: 999 } as const;

/** 4px base grid — spacing.css, converted from rem to px. */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
} as const;

/**
 * Warm cocoa-tinted shadows — effects.css. Expressed as React Native shadow props rather
 * than CSS strings; `elevation` is the Android equivalent.
 */
export const shadow = {
  xs: {
    shadowColor: '#6E472C',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  sm: {
    shadowColor: '#6E472C',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#6E472C',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  lg: {
    shadowColor: '#6E472C',
    shadowOpacity: 0.12,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  xl: {
    shadowColor: '#6E472C',
    shadowOpacity: 0.16,
    shadowRadius: 60,
    shadowOffset: { width: 0, height: 26 },
    elevation: 16,
  },
} as const;

/** Motion — effects.css. Durations in ms; mobile maps the easings to Reanimated curves. */
export const motion = {
  durFast: 120,
  durBase: 200,
  durSlow: 320,
  easeSoft: [0.34, 1.18, 0.64, 1],
  easeOut: [0.22, 0.61, 0.36, 1],
  easeInOut: [0.65, 0.05, 0.36, 1],
} as const;

import { createContext, useContext } from 'react';
import {
  ramp,
  semantic,
  status,
  categoryColor,
  radius,
  spacing,
  shadow,
  motion,
} from '@mochi/shared/tokens';

/**
 * The mobile face of the Mochi design system.
 *
 * Every value comes from `shared/tokens.ts`, which mirrors the CSS custom properties in
 * `src/ds/styles/tokens/`. Nothing here invents a color, a radius, or a spacing step — the
 * design system is a binding contract. If a screen needs a value that is not here, the value
 * gets added to shared/tokens.ts AND to the CSS, or it does not exist.
 */

/**
 * Font family names as `expo-font` sees them once loaded. These are the @expo-google-fonts
 * export names, NOT the CSS family names in tokens.typography — React Native resolves a
 * loaded font by the key it was registered under, and a space in the name silently fails to
 * match on Android.
 */
export const font = {
  display: 'Fredoka_500Medium',
  displayBold: 'Fredoka_600SemiBold',
  body: 'NunitoSans_400Regular',
  bodyMedium: 'NunitoSans_600SemiBold',
  bodyBold: 'NunitoSans_700Bold',
  mono: 'DMMono_400Regular',
} as const;

/**
 * Type scale. The web scale is in rem; these are the px equivalents at the 16px root, with
 * line heights as absolute numbers because React Native has no unitless line-height.
 */
export const text = {
  xs: { fontSize: 12, lineHeight: 16 },
  sm: { fontSize: 14, lineHeight: 20 },
  base: { fontSize: 16, lineHeight: 24 },
  lg: { fontSize: 18, lineHeight: 26 },
  xl: { fontSize: 22, lineHeight: 30 },
  xxl: { fontSize: 28, lineHeight: 36 },
} as const;

/**
 * Minimum tappable edge, in dp.
 *
 * 48, not the web DS's 44. 44 is the iOS floor; Android Material asks for 48 and this app
 * ships to Android phones. The web `is-sm` 36px button variant is deliberately NOT ported as
 * a tappable control — anything that small gets `hitSlop` instead.
 */
export const TOUCH = 48;

export const theme = {
  color: semantic,
  status,
  ramp,
  category: categoryColor,
  radius,
  spacing,
  shadow,
  motion,
  font,
  text,
  touch: TOUCH,
} as const;

export type Theme = typeof theme;

const ThemeCtx = createContext<Theme>(theme);

export const ThemeProvider = ThemeCtx.Provider;

/**
 * There is exactly one theme (a warm cream light theme; the web has no dark mode either), so
 * this never returns null and screens never need a null check. The context exists so a future
 * per-school theme override has somewhere to go.
 */
export function useTheme(): Theme {
  return useContext(ThemeCtx);
}

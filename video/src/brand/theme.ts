/**
 * Video theme = the app's design tokens, plus the few things only video needs.
 *
 * `@shared/tokens` is the same module the Expo app reads, so colours and motion
 * curves here are the product's, not a lookalike. The design system is a binding
 * contract ("no new colors, ever") — additions below are layout/timing only.
 */
import { ramp, semantic, categoryColor, radius, spacing, motion } from '@shared/tokens';
import { Easing } from 'remotion';

export { ramp, semantic, categoryColor, radius, spacing, motion };

/** CSS box-shadows equivalent to shared/tokens' React Native shadow props. */
export const shadowCss = {
  sm: '0 2px 6px rgba(110, 71, 44, 0.08)',
  md: '0 6px 18px rgba(110, 71, 44, 0.10)',
  lg: '0 14px 34px rgba(110, 71, 44, 0.12)',
  xl: '0 26px 60px rgba(110, 71, 44, 0.16)',
} as const;

/** The app's easing curves, as Remotion `Easing` functions. */
export const ease = {
  soft: Easing.bezier(...(motion.easeSoft as unknown as [number, number, number, number])),
  out: Easing.bezier(...(motion.easeOut as unknown as [number, number, number, number])),
  inOut: Easing.bezier(...(motion.easeInOut as unknown as [number, number, number, number])),
} as const;

/** Spring config tuned to feel like the app's `--ease-soft` (gentle, slight overshoot). */
export const softSpring = { damping: 14, mass: 0.7, stiffness: 110 } as const;

/**
 * Frames, at 30fps.
 *
 * `PawSting` runs a fixed internal timeline — the paw draws over frames 8–34 and the
 * wordmark springs up from frame 20 — so both sting slots have to be long enough to
 * contain it and then hold. Anything under ~75 frames cuts away mid-draw.
 */
export const timing = {
  stingIn: 60,
  stingOut: 85,
  captionIn: 12,
  captionOut: 10,
  zoom: 24,
} as const;

/**
 * The mobile primitive set.
 *
 * The eleven names mirror the web design system's exports (`src/ds/index.d.ts`) on purpose:
 * a screen reads the same in both codebases, and there is one place to look when a visual
 * drifts. The props are React Native props, not DOM props — the shared thing is the vocabulary
 * and the tokens, not the implementation.
 *
 * Two web components are deliberately NOT here: the 36px `is-sm` Button variant (below the
 * Android touch floor) and anything hover-only.
 */
export { Avatar } from './Avatar';
export { Badge } from './Badge';
export { Button } from './Button';
export { Card } from './Card';
export { Checkbox } from './Checkbox';
export { ColorPicker, COLOR_IDS } from './ColorPicker';
export { IconButton } from './IconButton';
export { Input } from './Input';
export { ProgressBar } from './ProgressBar';
export { Switch } from './Switch';
export { Tabs } from './Tabs';
export { Tag } from './Tag';

// Layout and typography helpers — mobile-only, no web counterpart.
export { Screen } from './Screen';
export { Placeholder } from './Placeholder';
export { Body, Heading, Mono, Muted, Title } from './Type';

export type { AvatarProps } from './Avatar';
export type { BadgeProps } from './Badge';
export type { ButtonProps } from './Button';
export type { CardProps } from './Card';
export type { CheckboxProps } from './Checkbox';
export type { IconButtonProps } from './IconButton';
export type { InputProps } from './Input';
export type { ProgressBarProps } from './ProgressBar';
export type { SwitchProps } from './Switch';
export type { TabItem, TabsProps } from './Tabs';
export type { TagProps } from './Tag';

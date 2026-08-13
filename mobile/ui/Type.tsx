import { Text } from 'react-native';
import type { TextProps } from 'react-native';
import { useTheme } from '~/theme';

/**
 * Text with the design system's families applied. React Native does NOT inherit fontFamily
 * down the tree the way CSS does, so every Text needs it set — hence these wrappers rather
 * than a global style.
 */

export function Title({ style, ...rest }: TextProps) {
  const th = useTheme();
  return (
    <Text
      style={[{ fontFamily: th.font.display, color: th.color.textStrong, ...th.text.xl }, style]}
      {...rest}
    />
  );
}

export function Heading({ style, ...rest }: TextProps) {
  const th = useTheme();
  return (
    <Text
      style={[
        { fontFamily: th.font.displayBold, color: th.color.textStrong, ...th.text.lg },
        style,
      ]}
      {...rest}
    />
  );
}

export function Body({ style, ...rest }: TextProps) {
  const th = useTheme();
  return (
    <Text
      style={[{ fontFamily: th.font.body, color: th.color.textBody, ...th.text.base }, style]}
      {...rest}
    />
  );
}

export function Muted({ style, ...rest }: TextProps) {
  const th = useTheme();
  return (
    <Text
      style={[{ fontFamily: th.font.body, color: th.color.textMuted, ...th.text.sm }, style]}
      {...rest}
    />
  );
}

/** DM Mono — version stamps, invite codes, scores. Never for prose. */
export function Mono({ style, ...rest }: TextProps) {
  const th = useTheme();
  return (
    <Text
      style={[{ fontFamily: th.font.mono, color: th.color.textMuted, ...th.text.xs }, style]}
      {...rest}
    />
  );
}

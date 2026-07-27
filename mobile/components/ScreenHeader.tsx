import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useTheme, TOUCH } from '~/theme';
import { Muted, Title } from '~/ui';

/**
 * A pushed screen's header: back chevron, title, optional subtitle and right-hand actions.
 *
 * The stack's own header is disabled everywhere (`headerShown: false`) so titles use the
 * display font and the design system's spacing rather than the platform default.
 */
export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onBack?: () => void;
}) {
  const th = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: th.spacing[2],
        paddingHorizontal: th.spacing[3],
        paddingVertical: th.spacing[2],
        borderBottomWidth: 1,
        borderBottomColor: th.color.borderSubtle,
        backgroundColor: th.color.surfaceCard,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => (onBack ? onBack() : router.back())}
        hitSlop={8}
        style={{ width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' }}
      >
        <ChevronLeft size={24} color={th.color.textBody} />
      </Pressable>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Title style={{ ...th.text.lg }} numberOfLines={1}>
          {title}
        </Title>
        {subtitle ? <Muted numberOfLines={1}>{subtitle}</Muted> : null}
      </View>

      {right}
    </View>
  );
}

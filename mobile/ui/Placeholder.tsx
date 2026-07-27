import { View } from 'react-native';
import { Construction } from 'lucide-react-native';
import { useTheme } from '~/theme';
import { useLang } from '~/lib/i18n';
import { Screen } from './Screen';
import { Heading, Muted } from './Type';

/**
 * A labelled "not built yet" screen.
 *
 * Every route in the phase-2 navigation exists so the tab bar and the More list are real and
 * testable; the ones whose content arrives in phases 3-5 render this. It is deliberately
 * explicit rather than a blank screen — a blank screen reads as a bug.
 */
export function Placeholder({ titleKey, phase }: { titleKey: string; phase: string }) {
  const th = useTheme();
  const { t } = useLang();

  return (
    <Screen>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: th.spacing[8],
          gap: th.spacing[3],
        }}
      >
        <Construction size={40} color={th.color.textDisabled} />
        <Heading>{t(titleKey)}</Heading>
        <Muted style={{ textAlign: 'center' }}>{t('m_coming_soon', { phase })}</Muted>
      </View>
    </Screen>
  );
}

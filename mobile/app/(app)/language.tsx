import { Pressable, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { LANGUAGES, useLang } from '~/lib/i18n';
import type { LangId } from '~/lib/i18n';
import { useTheme, TOUCH } from '~/theme';
import { Body, Card, Muted, Screen, Title } from '~/ui';

/**
 * The language picker.
 *
 * The default on a fresh install is **vi**, seeded from the device locale only when no choice
 * has been stored — see lib/i18n.tsx. Once the user picks, their choice wins over the handset
 * setting permanently, and it survives a restart.
 */
export default function Language() {
  const th = useTheme();
  const { t, lang, setLang } = useLang();

  return (
    // `top`: no ScreenHeader here, so the title would sit under the status bar without it.
    <Screen scroll edges={{ top: true }}>
      <Title>{t('language')}</Title>
      <Muted>{t('prof_lang_sub')}</Muted>

      <Card flat style={{ padding: 0, overflow: 'hidden' }}>
        {LANGUAGES.map((l, i) => {
          const active = l.id === lang;
          return (
            <Pressable
              key={l.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => setLang(l.id as LangId)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: TOUCH + 4,
                paddingHorizontal: th.spacing[5],
                gap: th.spacing[3],
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: th.color.borderSubtle,
                backgroundColor: pressed ? th.color.surfaceHover : 'transparent',
              })}
            >
              <Body style={{ flex: 1, color: active ? th.color.textStrong : th.color.textBody }}>
                {l.label}
              </Body>
              {active ? <Check size={20} color={th.color.brand} /> : null}
            </Pressable>
          );
        })}
      </Card>

      <View style={{ height: th.spacing[4] }} />
    </Screen>
  );
}

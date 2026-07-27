import { Link } from 'expo-router';
import { View } from 'react-native';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Button, Heading, Muted, Screen } from '~/ui';

/** Reached by a bad deep link. Uses the web app's existing 404 strings. */
export default function NotFound() {
  const th = useTheme();
  const { t } = useLang();

  return (
    <Screen edges={{ top: true }}>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: th.spacing[3],
          padding: th.spacing[8],
        }}
      >
        <Heading>{t('err_not_found_title')}</Heading>
        <Muted style={{ textAlign: 'center' }}>{t('err_not_found_msg')}</Muted>
        <Link href="/" asChild>
          <Button variant="secondary">{t('err_go_home')}</Button>
        </Link>
      </View>
    </Screen>
  );
}

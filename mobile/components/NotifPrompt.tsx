import React from 'react';
import { View } from 'react-native';
import { Bell } from 'lucide-react-native';
import { hasBeenAsked, markAsked, permissionState, requestAndRegister } from '~/lib/push';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Body, Button, Card, Heading, Muted } from '~/ui';

/**
 * The one time the app asks for notification permission.
 *
 * Not on first launch. It renders where the user has just done the thing notifications are
 * about — finished a round of flashcards, or opened a class — and it explains what will be sent
 * before the system dialog appears.
 *
 * This matters more on Android than the usual UX advice suggests: since Android 13,
 * `POST_NOTIFICATIONS` is a runtime permission and a denial is **sticky**. There is no second
 * prompt. Burn the one ask on a cold launch and the answer is no, permanently, for that install.
 *
 * Renders nothing if permission is already resolved either way, or if the ask has been spent.
 */
export function NotifPrompt() {
  const th = useTheme();
  const { t } = useLang();
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [state, asked] = await Promise.all([permissionState(), hasBeenAsked()]);
      if (!cancelled) setShow(state === 'undetermined' && !asked);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  return (
    <Card style={{ gap: th.spacing[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
        <Bell size={20} color={th.color.brand} />
        <Heading style={{ flex: 1 }}>{t('notif_title')}</Heading>
      </View>
      <Body>{t('notif_why')}</Body>
      <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
        <Button
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => {
            void markAsked();
            setShow(false);
          }}
        >
          {t('notif_not_now')}
        </Button>
        <Button
          style={{ flex: 1 }}
          loading={busy}
          onPress={() => {
            setBusy(true);
            void requestAndRegister().finally(() => {
              setBusy(false);
              setShow(false);
            });
          }}
        >
          {t('notif_enable')}
        </Button>
      </View>
      <Muted>{t('notif_sub')}</Muted>
    </Card>
  );
}

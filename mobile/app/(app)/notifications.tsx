import React from 'react';
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react-native';
import type { NotifPrefsInput } from '@mochi/shared/schemas';
import { ChipSelect } from '~/components/ChipSelect';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useLang } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import { permissionState, requestAndRegister, type PermissionState } from '~/lib/push';
import { useTheme } from '~/theme';
import { Body, Button, Card, Heading, Muted, Screen, Switch } from '~/ui';

/**
 * Task 6.5 — notification preferences, plus the honest answer about OS-level permission.
 *
 * The two are separate and both matter. In-app toggles decide what the cron jobs are allowed to
 * send; the Android permission decides whether anything arrives at all. A screen that offered
 * only the toggles would let someone carefully configure notifications that the OS silently
 * drops, and conclude the app is broken. So permission state is shown first, and when it has
 * been denied the only useful control is a button into system settings — because on Android 13+
 * a denial cannot be re-prompted from inside the app.
 *
 * The lead-time options start at 15 minutes because the sweep cron runs every 15; anything
 * shorter could not be honoured, and offering it would be a lie.
 */
const LEAD_OPTIONS = [15, 30, 60, 120];

export default function NotificationSettings() {
  const th = useTheme();
  const { t } = useLang();
  const qc = useQueryClient();

  const [perm, setPerm] = React.useState<PermissionState | null>(null);
  React.useEffect(() => {
    void permissionState().then(setPerm);
  }, []);

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['notifPrefs'],
    queryFn: api.settings.getNotifPrefs,
  });

  const update = useMutation({
    mutationFn: (patch: Partial<NotifPrefsInput>) => api.settings.updateNotifPrefs(patch),
    onSuccess: (next) => qc.setQueryData(['notifPrefs'], next),
  });

  const set = (patch: Partial<NotifPrefsInput>) => update.mutate(patch);
  const off = perm !== 'granted';

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('notif_title')} subtitle={t('notif_sub')} />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ---- OS permission ---- */}
        <Card style={{ gap: th.spacing[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
            {perm === 'granted' ? (
              <Bell size={20} color={th.status.success} />
            ) : (
              <BellOff size={20} color={th.color.textMuted} />
            )}
            <Heading style={{ flex: 1 }}>{t('notif_title')}</Heading>
          </View>

          {perm === 'granted' ? (
            <Muted>{t('notif_on')}</Muted>
          ) : perm === 'denied' ? (
            <>
              <Body>{t('notif_blocked')}</Body>
              <Button variant="secondary" onPress={() => void Linking.openSettings()}>
                {t('notif_open_settings')}
              </Button>
            </>
          ) : perm === 'undetermined' ? (
            <>
              <Body>{t('notif_why')}</Body>
              <Button onPress={() => void requestAndRegister().then(setPerm)}>
                {t('notif_enable')}
              </Button>
            </>
          ) : (
            <ActivityIndicator color={th.color.brand} />
          )}
        </Card>

        {/* ---- What may be sent ---- */}
        {isLoading && !prefs ? <ActivityIndicator color={th.color.brand} /> : null}

        {prefs ? (
          <Card style={{ gap: th.spacing[2], opacity: off ? 0.6 : 1 }}>
            <Switch
              label={t('notif_class')}
              checked={prefs.classReminders}
              onChange={(v) => set({ classReminders: v })}
            />
            <Muted>{t('notif_class_sub')}</Muted>

            {prefs.classReminders ? (
              <ChipSelect
                label={t('notif_lead')}
                value={String(prefs.classLeadMinutes)}
                onChange={(v) => set({ classLeadMinutes: Number(v) })}
                options={LEAD_OPTIONS.map((n) => ({
                  value: String(n),
                  label: t('notif_lead_min', { n }),
                }))}
              />
            ) : null}

            <View style={{ height: 1, backgroundColor: th.color.borderSubtle }} />

            <Switch
              label={t('notif_preview')}
              checked={prefs.previewEvening}
              onChange={(v) => set({ previewEvening: v })}
            />
            <Muted>{t('notif_preview_sub')}</Muted>

            <View style={{ height: 1, backgroundColor: th.color.borderSubtle }} />

            <Switch
              label={t('notif_study')}
              checked={prefs.studyNudges}
              onChange={(v) => set({ studyNudges: v })}
            />
            <Muted>{t('notif_study_sub')}</Muted>

            <View style={{ height: 1, backgroundColor: th.color.borderSubtle }} />

            <Switch
              label={t('notif_practice_reminders')}
              checked={prefs.practiceReminders}
              onChange={(v) => set({ practiceReminders: v })}
            />
            <Muted>{t('notif_practice_reminders_sub')}</Muted>
          </Card>
        ) : null}

        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}

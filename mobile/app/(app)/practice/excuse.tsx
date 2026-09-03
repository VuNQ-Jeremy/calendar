import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useLang } from '~/lib/i18n';
import { usePracticeMy, useRequestExcuse } from '~/lib/use-practice';
import { useTheme } from '~/theme';
import { Body, Button, Card, Heading, Input, Muted, Screen, Tag, Title } from '~/ui';

/**
 * "Xin phép" — ask to be let off one practice day.
 *
 * The date list is the server's own `practiceDays` for the class, not a free calendar: a day that
 * is not a practice day cannot be missed, so offering it would produce a request nothing acts on.
 * Anything before `todayIct` is refused here as well as on the server (decision #18).
 */
export default function PracticeExcuseScreen() {
  const th = useTheme();
  const { t } = useLang();
  const { data } = usePracticeMy();
  const request = useRequestExcuse();

  const classes = data?.classes ?? [];
  const today = data?.todayIct ?? '';
  const [classId, setClassId] = React.useState<string>('');
  const [date, setDate] = React.useState<string>('');
  const [reason, setReason] = React.useState('');
  const [sent, setSent] = React.useState(false);

  const active = classes.find((c) => c.classId === classId) ?? classes[0];
  React.useEffect(() => {
    if (!classId && classes[0]) setClassId(classes[0].classId);
  }, [classes.length]);

  const days = (active?.practiceDays ?? []).filter((d) => d >= today);
  const late = !!date && date < today;
  const canSend = !!active && !!date && !late && reason.trim().length > 0 && !request.isPending;

  const send = () => {
    if (!canSend || !active) return;
    request.mutate(
      { classId: active.classId, date, reason: reason.trim() },
      {
        onSuccess: () => {
          setSent(true);
          setReason('');
        },
      },
    );
  };

  return (
    <Screen edges={{ top: true }}>
      <ScrollView contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}>
        <Pressable
          onPress={() => router.back()}
          style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}
        >
          <ChevronLeft size={18} color={th.color.textMuted} />
          <Muted>{t('m_pr_tab')}</Muted>
        </Pressable>

        <Title>{t('m_pr_request_excuse')}</Title>

        {classes.length > 1 ? (
          <View style={{ gap: th.spacing[2] }}>
            <Muted>{t('pr_pick_class')}</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[2] }}>
              {classes.map((c) => (
                <Pressable key={c.classId} onPress={() => setClassId(c.classId)}>
                  <Tag color={c.classId === active?.classId ? 'green' : 'neutral'}>
                    {c.className}
                  </Tag>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ gap: th.spacing[2] }}>
          <Muted>{t('ev_date')}</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[2] }}>
            {days.length ? (
              days.map((d) => (
                <Pressable key={d} onPress={() => setDate(d)}>
                  <Tag color={d === date ? 'green' : 'neutral'}>{dm(d)}</Tag>
                </Pressable>
              ))
            ) : (
              <Muted>{t('pr_no_tasks_day')}</Muted>
            )}
          </View>
        </View>

        <Input label={t('m_pr_excuse_reason')} value={reason} onChangeText={setReason} multiline />

        {late ? <Muted>{t('m_pr_excuse_late')}</Muted> : null}
        {sent ? <Muted>{t('m_pr_excuse_sent')}</Muted> : null}

        <Button block disabled={!canSend} loading={request.isPending} onPress={send}>
          {t('m_pr_request_excuse')}
        </Button>

        {active?.excuses.length ? (
          <Card style={{ gap: th.spacing[3] }}>
            <Heading>{t('pr_excuses_pending')}</Heading>
            {active.excuses.map((e) => (
              <View key={e.id} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
                  <Body>{dm(e.date)}</Body>
                  <Tag
                    color={
                      e.status === 'approved'
                        ? 'green'
                        : e.status === 'rejected'
                          ? 'rose'
                          : 'orange'
                    }
                  >
                    {t(
                      e.status === 'approved'
                        ? 'm_pr_excuse_approved'
                        : e.status === 'rejected'
                          ? 'm_pr_excuse_rejected'
                          : 'm_pr_excuse_pending',
                    )}
                  </Tag>
                </View>
                <Muted>{e.reason}</Muted>
              </View>
            ))}
          </Card>
        ) : null}

        <View style={{ height: th.spacing[10] }} />
      </ScrollView>
    </Screen>
  );
}

const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

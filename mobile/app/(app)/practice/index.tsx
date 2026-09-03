import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { ClipboardCheck, Link2 } from 'lucide-react-native';
import { useLang } from '~/lib/i18n';
import { usePracticeMy } from '~/lib/use-practice';
import { useTheme } from '~/theme';
import { Body, Button, Card, Heading, Muted, Screen, Tag, Title } from '~/ui';
import type { PracticeClassBlock, PracticeStudentTask } from '~/lib/types';

/**
 * "Nhiệm vụ" — the student's own practice list.
 *
 * Every date decision on this screen is made against `todayIct` from the response, never the
 * device clock: the deadline is an ICT midnight the Worker applies, and a phone in the wrong
 * timezone would otherwise draw a day that does not exist for the server.
 */
export default function PracticeListScreen() {
  const th = useTheme();
  const { t, lang } = useLang();
  const { data, isLoading, isRefetching, refetch, isError } = usePracticeMy();

  const today = data?.todayIct ?? '';
  const todays = (data?.tasks ?? []).filter((x) => x.date === today);
  const upcoming = (data?.tasks ?? []).filter((x) => x.date > today);
  const overdue = (data?.tasks ?? []).filter((x) => x.date < today);
  const groups = groupByDate(upcoming);

  return (
    <Screen edges={{ top: true }}>
      <View
        style={{
          paddingHorizontal: th.spacing[5],
          paddingTop: th.spacing[4],
          paddingBottom: th.spacing[2],
        }}
      >
        <Title>{t('m_pr_tab')}</Title>
        <Muted>{t('m_pr_deadline')}</Muted>
      </View>

      {isLoading && !data ? (
        <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={th.color.brand}
            />
          }
        >
          {isError ? (
            <Card
              style={{ alignItems: 'center', gap: th.spacing[2], paddingVertical: th.spacing[8] }}
            >
              <Muted>{t('m_pr_offline')}</Muted>
              <Button variant="secondary" onPress={() => void refetch()}>
                {t('m_retry')}
              </Button>
            </Card>
          ) : null}

          {(data?.classes ?? []).map((c) => (
            <BalanceCard key={c.classId} block={c} />
          ))}

          <Button variant="secondary" onPress={() => router.push('/practice/excuse')}>
            {t('m_pr_request_excuse')}
          </Button>

          {!data?.tasks.length ? (
            <Card
              style={{ alignItems: 'center', gap: th.spacing[2], paddingVertical: th.spacing[8] }}
            >
              <ClipboardCheck size={32} color={th.color.textDisabled} />
              <Heading>{t('m_pr_empty')}</Heading>
            </Card>
          ) : null}

          {overdue.length ? (
            <View style={{ gap: th.spacing[3] }}>
              <Body style={{ fontFamily: th.font.bodyBold }}>{t('m_pr_excuse_late')}</Body>
              {overdue.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </View>
          ) : null}

          {todays.length ? (
            <View style={{ gap: th.spacing[3] }}>
              <Body style={{ fontFamily: th.font.bodyBold }}>{t('m_pr_today')}</Body>
              {todays.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </View>
          ) : null}

          {groups.length ? (
            <View style={{ gap: th.spacing[3] }}>
              <Body style={{ fontFamily: th.font.bodyBold }}>{t('m_pr_upcoming')}</Body>
              {groups.map(([date, items]) => (
                <View key={date} style={{ gap: th.spacing[2] }}>
                  <Muted>{dayLabel(date, lang)}</Muted>
                  {items.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </View>
              ))}
            </View>
          ) : null}

          <View style={{ height: th.spacing[10] }} />
        </ScrollView>
      )}
    </Screen>
  );
}

/** The month's standing for one class: excused balance, the ×N owed, and the warning level. */
function BalanceCard({ block }: { block: PracticeClassBlock }) {
  const th = useTheme();
  const { t } = useLang();
  const s = block.summary;
  return (
    <Card style={{ gap: th.spacing[2] }}>
      <Heading numberOfLines={1}>{block.className}</Heading>
      <Muted>
        {t('m_pr_balance', { used: s.excusedUsed, quota: s.excusedQuota, unexcused: s.unexcused })}
      </Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[2] }}>
        {s.pendingMultiplier > 0 && s.pendingForDate ? (
          <Tag color="rose">
            {t('m_pr_penalty', { n: s.pendingMultiplier, date: dm(s.pendingForDate) })}
          </Tag>
        ) : null}
        {s.level > 0 ? <Tag color="orange">{t('m_pr_warning', { n: s.level })}</Tag> : null}
      </View>
    </Card>
  );
}

function TaskCard({ task }: { task: PracticeStudentTask }) {
  const th = useTheme();
  const { t } = useLang();
  const statusKey: Record<PracticeStudentTask['status'], string | null> = {
    open: null,
    submitted: 'm_pr_submitted',
    accepted: 'pr_status_accepted',
    rejected: 'pr_status_rejected',
    teacher_done: 'pr_status_teacher_done',
  };
  const tag = statusKey[task.status];

  return (
    <Pressable onPress={() => router.push(`/practice/${task.id}`)}>
      <Card style={{ gap: th.spacing[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Heading numberOfLines={2}>{task.title}</Heading>
            <Muted numberOfLines={1}>{task.className}</Muted>
          </View>
          {tag ? <Tag color={task.status === 'rejected' ? 'rose' : 'green'}>{t(tag)}</Tag> : null}
        </View>

        {task.materialTitle || task.url ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
            <Link2 size={14} color={th.color.textMuted} />
            <Muted numberOfLines={1}>{task.materialTitle ?? task.url}</Muted>
          </View>
        ) : null}

        {task.feedback ? <Body numberOfLines={2}>{task.feedback}</Body> : null}
        {task.status === 'rejected' && task.rejectReason ? (
          <Muted>{t('m_pr_rejected', { reason: task.rejectReason })}</Muted>
        ) : null}
      </Card>
    </Pressable>
  );
}

/** The server already sorted by (date, sortOrder); preserve it. */
function groupByDate(items: PracticeStudentTask[]): [string, PracticeStudentTask[]][] {
  const out: [string, PracticeStudentTask[]][] = [];
  for (const s of items) {
    const last = out[out.length - 1];
    if (last && last[0] === s.date) last[1].push(s);
    else out.push([s.date, [s]]);
  }
  return out;
}

const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

function dayLabel(date: string, lang: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}

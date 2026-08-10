import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react-native';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useLang } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import { qk } from '~/lib/query';
import { fmtTime } from '~/lib/cal';
import { useTheme } from '~/theme';
import { Body, Card, Heading, IconButton, Muted, Screen, Tabs, Tag } from '~/ui';
import { monthLabel, shiftMonth } from '@mochi/shared/logic/month';
import { formatVnd } from '@mochi/shared/logic/fees';
import { ATTENDANCE_META } from '@mochi/shared/logic/assess';
import { ictDateOf } from '@mochi/shared/logic/tests';
import type { AttendanceStatusId } from '@mochi/shared/logic/assess';
import type { AttendanceHistoryRow, ParentReportResponse } from '~/lib/types';

type TabId = 'attendance' | 'report' | 'fees';

/**
 * One child, one month — the parent portal's detail screen.
 *
 * Everything is rendered NATIVELY rather than opening the web slips in a browser: those routes sit
 * behind the session cookie and a phone would land on the login wall (the same reason
 * assessments.tsx has no print action). The payloads come from `/api/parent/report/*` and
 * `/api/parent/tuition/*`, which share their builders with the printed documents, so the numbers
 * cannot drift from the slip a parent may also receive over Zalo.
 *
 * Three tabs rather than one long scroll: attendance is a list, the report is a form-shaped
 * document, and fees are a table. Each fetches only when its tab is open.
 */
export default function ChildDetail() {
  const th = useTheme();
  const { t, lang } = useLang();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const studentId = params.id ?? '';
  const [tab, setTab] = React.useState<TabId>('attendance');
  // The ICT month, not the device's — a phone in another timezone must still open on the month
  // the school is in.
  const [month, setMonth] = React.useState(() => ictDateOf(new Date().toISOString()).slice(0, 7));

  // The name rides in as a param so the header has something to draw before any request resolves;
  // /api/parent/home already had it. Falls back to the report's copy once that lands.
  const report = useQuery({
    queryKey: qk.parentReport(studentId, month),
    queryFn: () => api.parent.report(studentId, month),
    enabled: !!studentId && tab === 'report',
  });

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader
        title={params.name ?? report.data?.student.name ?? ''}
        subtitle={monthLabel(month, lang)}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton
              size="sm"
              label={monthLabel(shiftMonth(month, -1), lang)}
              onPress={() => setMonth((m) => shiftMonth(m, -1))}
            >
              <ChevronLeft size={20} color={th.color.textBody} />
            </IconButton>
            <IconButton
              size="sm"
              label={monthLabel(shiftMonth(month, 1), lang)}
              onPress={() => setMonth((m) => shiftMonth(m, 1))}
            >
              <ChevronRight size={20} color={th.color.textBody} />
            </IconButton>
          </View>
        }
      />

      <Tabs
        style={{ marginHorizontal: th.spacing[5], marginTop: th.spacing[4] }}
        value={tab}
        onChange={(id) => setTab(id as TabId)}
        tabs={[
          { id: 'attendance', label: t('ch_attendance_title') },
          { id: 'report', label: t('ch_report_card') },
          { id: 'fees', label: t('ch_fee_slip') },
        ]}
      />

      <ScrollView contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}>
        {tab === 'attendance' && <AttendanceTab studentId={studentId} month={month} lang={lang} />}
        {tab === 'report' && (
          <ReportTab
            loading={report.isLoading}
            data={report.data}
            criteria={report.data?.criteria ?? []}
          />
        )}
        {tab === 'fees' && <FeesTab studentId={studentId} month={month} />}
        <View style={{ height: th.spacing[10] }} />
      </ScrollView>
    </Screen>
  );
}

function AttendanceTab({
  studentId,
  month,
  lang,
}: {
  studentId: string;
  month: string;
  lang: string;
}) {
  const th = useTheme();
  const { t } = useLang();
  const { data, isLoading } = useQuery({
    queryKey: qk.parentAttendance(studentId, month),
    queryFn: () => api.parent.attendance(studentId, month),
    enabled: !!studentId,
  });

  if (isLoading && !data) return <ActivityIndicator color={th.color.brand} />;
  const rows = data?.attendance ?? [];
  if (!rows.length) return <Muted>{t('ch_attendance_none')}</Muted>;

  return (
    <Card style={{ gap: th.spacing[3] }}>
      {rows.map((r) => (
        <AttendanceLine key={`${r.eventId}:${r.date}`} row={r} lang={lang} />
      ))}
    </Card>
  );
}

function AttendanceLine({ row, lang }: { row: AttendanceHistoryRow; lang: string }) {
  const th = useTheme();
  const { t } = useLang();
  // A status this build does not know still prints its raw value rather than an empty chip.
  const meta = ATTENDANCE_META[row.status as AttendanceStatusId];
  const [y, m, d] = row.date.split('-').map(Number);
  const when = new Date(y, m - 1, d).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
      <Body style={{ width: 92 }}>{when}</Body>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body numberOfLines={1}>{row.className ?? row.eventTitle}</Body>
        {row.startTime ? <Muted>{fmtTime(row.startTime)}</Muted> : null}
      </View>
      <Tag color={meta?.color}>{meta ? t(meta.tk) : row.status}</Tag>
    </View>
  );
}

function ReportTab({
  loading,
  data,
  criteria,
}: {
  loading: boolean;
  data: ParentReportResponse | undefined;
  criteria: { id: string; name: string }[];
}) {
  const th = useTheme();
  const { t } = useLang();

  if (loading && !data) return <ActivityIndicator color={th.color.brand} />;
  // A month the teacher has not written yet is a valid month, not an error — say so plainly
  // instead of drawing five empty stars per criterion.
  if (!data?.remark) return <Muted>{t('ch_report_none')}</Muted>;

  const { ratings, comment } = data.remark;
  return (
    <Card style={{ gap: th.spacing[4] }}>
      {criteria.map((c) => (
        <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
          <Body style={{ flex: 1 }}>{c.name}</Body>
          <ReadOnlyStars value={ratings[c.id] ?? 0} />
        </View>
      ))}
      {comment ? (
        <View style={{ gap: 2 }}>
          <Muted style={{ fontSize: th.text.xs.fontSize }}>{t('ch_report_comment')}</Muted>
          <Body>{comment}</Body>
        </View>
      ) : null}
    </Card>
  );
}

/** Five stars, `value` of them lit. The read-only twin of assessments.tsx's RatingStars. */
function ReadOnlyStars({ value }: { value: number }) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={18}
          color={i <= value ? th.category.orange.base : th.color.borderSubtle}
          fill={i <= value ? th.category.orange.base : 'transparent'}
        />
      ))}
    </View>
  );
}

function FeesTab({ studentId, month }: { studentId: string; month: string }) {
  const th = useTheme();
  const { t } = useLang();
  const { data, isLoading } = useQuery({
    queryKey: qk.parentTuition(studentId, month),
    queryFn: () => api.parent.tuition(studentId, month),
    enabled: !!studentId,
  });

  if (isLoading && !data) return <ActivityIndicator color={th.color.brand} />;
  const fee = data?.fee;
  if (!fee) return <Muted>{t('ch_fees_none')}</Muted>;

  return (
    <Card style={{ gap: th.spacing[3] }}>
      {fee.lines.map((l) => (
        <View
          key={l.classId}
          style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Body numberOfLines={1}>{l.className}</Body>
            <Muted>{t('ch_fees_sessions', { n: l.sessions })}</Muted>
          </View>
          <Body>{formatVnd(l.amountVnd)}</Body>
        </View>
      ))}

      {!fee.lines.length ? <Muted>{t('ch_fees_none')}</Muted> : null}

      <View style={{ height: 1, backgroundColor: th.color.borderSubtle }} />

      <FeeRow label={t('ch_fees_billed')} value={formatVnd(fee.billedVnd)} />
      {fee.adjustmentVnd !== 0 ? (
        <FeeRow label={t('ch_fees_adjustment')} value={formatVnd(fee.adjustmentVnd)} />
      ) : null}
      <FeeRow label={t('ch_fees_due')} value={formatVnd(fee.dueVnd)} strong />
      <FeeRow label={t('ch_fees_paid')} value={formatVnd(fee.paidVnd)} />
      <FeeRow
        label={t('ch_fees_outstanding')}
        value={formatVnd(fee.outstandingVnd)}
        strong
        tag={
          <Tag
            color={fee.status === 'paid' ? 'green' : fee.status === 'partial' ? 'orange' : 'rose'}
          >
            {t(`ch_fees_status_${fee.status}`)}
          </Tag>
        }
      />
      {/* The notes the printed slip carries — a parent already receives these over Zalo. */}
      {fee.adjustmentNote ? <Muted>{fee.adjustmentNote}</Muted> : null}
      {fee.paymentNote ? <Muted>{fee.paymentNote}</Muted> : null}
    </Card>
  );
}

function FeeRow({
  label,
  value,
  strong,
  tag,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tag?: React.ReactNode;
}) {
  const th = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
      <Body style={{ flex: 1 }}>{label}</Body>
      {tag}
      {strong ? <Heading>{value}</Heading> : <Body>{value}</Body>}
    </View>
  );
}

import React from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { AttendanceEditor } from '~/components/AttendanceEditor';
import { DateTimeField } from '~/components/DateTimeField';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useLang } from '~/lib/i18n';
import { iso, todayDate } from '~/lib/cal';
import { useClasses, useEvents } from '~/lib/staff-data';
import { useTheme } from '~/theme';
import { Card, Heading, Muted, Screen } from '~/ui';

/**
 * Task 4.5 — the register, two taps from launch: Dashboard → today's class → here.
 *
 * The route takes `eventId` and an optional `date`, which is all a deep link needs; the class and
 * the roster come from the events and classes queries the dashboard has already warmed. The date
 * is editable because a missed day gets marked retroactively far more often than anyone plans for.
 *
 * The register itself is `AttendanceEditor`, shared with the Attendance tab of the event detail —
 * one implementation, so the two can never disagree about what a mark means.
 */
export default function Attendance() {
  const th = useTheme();
  const { t } = useLang();
  const params = useLocalSearchParams<{ eventId?: string; date?: string }>();
  const eventId = params.eventId ?? '';

  const [date, setDate] = React.useState(params.date || iso(todayDate()));

  const { data: events } = useEvents();
  const { data: classes } = useClasses();
  const event = events?.find((e) => e.id === eventId);
  const cls = classes?.find((c) => c.id === event?.classId);

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader
        title={event?.title ?? t('att_tab')}
        subtitle={cls?.name ?? (event ? t('ev_class_personal') : undefined)}
      />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
          <DateTimeField mode="date" label={t('ev_date')} value={date} onChange={setDate} />
        </View>

        {!eventId || !event ? (
          <Card>
            <Heading>{t('att_no_event')}</Heading>
            <Muted>{t('att_no_event_sub')}</Muted>
          </Card>
        ) : (
          <AttendanceEditor
            // Remounting on a date change is intentional: the register is a different set of rows
            // for every occurrence, and a fresh mount reseeds it from that occurrence's query.
            key={`${event.id}:${date}`}
            eventId={event.id}
            date={date}
            classId={event.classId ?? null}
          />
        )}

        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}

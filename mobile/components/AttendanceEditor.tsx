import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Check, Clock, FileText, X } from 'lucide-react-native';
import { useLang } from '~/lib/i18n';
import { ATTENDANCE_META, ATTENDANCE_STATUSES, type AttendanceStatusId } from '~/lib/cal';
import {
  rosterOf,
  useAttendance,
  useClasses,
  useSaveAttendance,
  useStudents,
} from '~/lib/staff-data';
import { useTheme, TOUCH } from '~/theme';
import { Avatar, Body, Button, Card, Heading, Muted } from '~/ui';
import type { ColorIdKey } from '@mochi/shared/tokens';

/**
 * The register. The highest-value screen in the mobile app, and the one thing here a teacher does
 * standing up in front of a class.
 *
 * Interaction decisions, all deliberate:
 *
 *   - **Autosave, optimistic.** Settled in the phase-4 pre-flight and not re-opened: a teacher
 *     marking a register walks away mid-list, and an explicit Save button loses the whole thing to
 *     a locked screen. Every tap persists immediately; a failure keeps the local marks and shows
 *     a retry. Nothing is ever silently dropped.
 *   - **Mark all present first, then correct exceptions.** Most days most students are present,
 *     so that is the primary action, not a convenience.
 *   - **Icon-only status buttons with a legend above them.** Four Vietnamese status labels
 *     ("Vắng không phép") cannot sit side by side on a 360dp screen without clipping, and a
 *     clipped label is worse than a legend. Each button is 48dp and carries its label as its
 *     accessibility name.
 *   - **Tapping the active status clears it**, exactly as the web modal does. A cleared student is
 *     omitted from the payload, and the server's delete-then-insert unmarks them.
 */

const ICONS: Record<AttendanceStatusId, React.ComponentType<{ size: number; color: string }>> = {
  present: Check,
  late: Clock,
  absent: X,
  excused: FileText,
};

type Marks = Record<string, AttendanceStatusId>;

export function AttendanceEditor({
  eventId,
  date,
  classId,
}: {
  eventId: string;
  date: string;
  classId: string | null;
}) {
  const th = useTheme();
  const { t } = useLang();

  const { data: classes } = useClasses();
  const { data: students } = useStudents();
  const { data: records, isLoading } = useAttendance(eventId, date);
  const save = useSaveAttendance(eventId, date);

  const cls = classes?.find((c) => c.id === classId);
  const roster = rosterOf(cls, students);

  const [marks, setMarks] = React.useState<Marks>({});

  /**
   * Seed from the server ONCE per (event, date). A later refetch must not overwrite marks the
   * teacher has just made — and it does not need to: a successful save writes its own reply into
   * this query's cache, so the two are already in step.
   */
  const seededFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!records) return;
    const key = `${eventId}:${date}`;
    if (seededFor.current === key) return;
    seededFor.current = key;
    const seeded: Marks = {};
    for (const r of records) seeded[r.studentId] = r.status as AttendanceStatusId;
    setMarks(seeded);
  }, [records, eventId, date]);

  const persist = (next: Marks) => {
    save.mutate(Object.entries(next).map(([studentId, status]) => ({ studentId, status })));
  };

  const setMark = (studentId: string, status: AttendanceStatusId) => {
    const next = { ...marks };
    if (next[studentId] === status) delete next[studentId];
    else next[studentId] = status;
    setMarks(next);
    persist(next);
  };

  const markAllPresent = () => {
    const next: Marks = { ...marks };
    for (const s of roster) next[s.id] = 'present';
    setMarks(next);
    persist(next);
  };

  const counts = ATTENDANCE_STATUSES.map((st) => ({
    st,
    n: roster.filter((s) => marks[s.id] === st).length,
  }));
  const marked = counts.reduce((sum, c) => sum + c.n, 0);
  const summary =
    counts
      .filter((c) => c.n > 0)
      .map((c) => `${c.n} ${t(ATTENDANCE_META[c.st].tk).toLowerCase()}`)
      .join(' · ') || t('att_none_marked');

  if (isLoading && !records) {
    return <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />;
  }

  if (!classId || !roster.length) {
    return (
      <Card>
        <Heading>{t('att_empty_roster')}</Heading>
        <Muted>{classId ? t('att_empty_roster_sub') : t('att_no_class_sub')}</Muted>
      </Card>
    );
  }

  return (
    <View style={{ gap: th.spacing[4] }}>
      {/* Live count and save state. One line, always visible: a half-saved register is worse
          than no register, so the teacher never has to wonder which they have. */}
      <Card flat style={{ padding: th.spacing[4], gap: th.spacing[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
          <Body style={{ flex: 1, fontFamily: th.font.bodyBold }}>{summary}</Body>
          {save.isPending ? (
            <Muted>{t('att_saving')}</Muted>
          ) : save.isError ? (
            <Muted style={{ color: th.status.danger }}>{t('att_save_failed')}</Muted>
          ) : marked > 0 ? (
            <Muted style={{ color: th.status.success }}>{t('att_saved')}</Muted>
          ) : null}
        </View>
        <Muted>{t('att_marked_of', { done: marked, total: roster.length })}</Muted>

        {save.isError ? (
          <Button
            variant="secondary"
            onPress={() => persist(marks)}
            style={{ marginTop: th.spacing[2] }}
          >
            {t('m_retry')}
          </Button>
        ) : null}
      </Card>

      <Button variant="primary" block onPress={markAllPresent}>
        {t('att_mark_all')}
      </Button>

      {/* Legend for the icon-only buttons below. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[3] }}>
        {ATTENDANCE_STATUSES.map((st) => {
          const meta = ATTENDANCE_META[st];
          const cat = th.category[meta.color as ColorIdKey];
          const Icon = ICONS[st];
          return (
            <View
              key={st}
              style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[1] }}
            >
              <Icon size={14} color={cat.ink} />
              <Muted style={{ fontSize: th.text.xs.fontSize }}>{t(meta.tk)}</Muted>
            </View>
          );
        })}
      </View>

      {roster.map((s) => {
        const current = marks[s.id];
        return (
          <Card key={s.id} flat style={{ padding: th.spacing[3], gap: th.spacing[3] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
              <Avatar name={s.name} color={s.color} size="sm" />
              <Body style={{ flex: 1, fontFamily: th.font.bodyBold }} numberOfLines={1}>
                {s.name}
              </Body>
            </View>

            <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
              {ATTENDANCE_STATUSES.map((st) => {
                const meta = ATTENDANCE_META[st];
                const cat = th.category[meta.color as ColorIdKey];
                const active = current === st;
                const Icon = ICONS[st];
                return (
                  <Pressable
                    key={st}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${s.name} — ${t(meta.tk)}`}
                    onPress={() => setMark(s.id, st)}
                    style={{
                      flex: 1,
                      height: TOUCH,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: th.radius.md,
                      borderWidth: 1.5,
                      borderColor: active ? cat.base : th.color.borderSubtle,
                      backgroundColor: active ? cat.base : cat.soft,
                    }}
                  >
                    <Icon size={22} color={active ? '#FFFFFF' : cat.ink} />
                  </Pressable>
                );
              })}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

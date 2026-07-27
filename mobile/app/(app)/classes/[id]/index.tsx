import React from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { ChevronRight, Plus, Trash2, Users } from 'lucide-react-native';
import { ChipSelect } from '~/components/ChipSelect';
import { DateTimeField } from '~/components/DateTimeField';
import { ScreenHeader } from '~/components/ScreenHeader';
import { getCal, useLang } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import { rosterOf, useClasses, useInvalidateStaff, useStudents } from '~/lib/staff-data';
import { useTheme, TOUCH } from '~/theme';
import { Avatar, Body, Button, Card, ColorPicker, Heading, IconButton, Input, Muted, Screen } from '~/ui';
import type { ColorIdValue } from '~/lib/types';
import type { ClassInput, ScheduleItem } from '@mochi/shared/schemas';

/**
 * Task 4.4 — one class: identity, weekly schedule, roster.
 *
 * The schedule editor is new on the phone. `class_schedule` has existed since the first migration
 * and `ScheduleItem` validates it (`shared/schemas.ts:42`), but no web screen ever edited it — the
 * rows only arrived through the seed. `day` is 0–6 with **0 = Sunday**, matching `Date.getDay()` and
 * the seed data (`seed.sql:39-43`, weekdays 1–5), which is also what the `dow` label array uses.
 *
 * The roster is a separate pushed screen. A searchable multi-select of every student in the school
 * is not an inline list on a 360dp screen, and it writes directly — which is why `studentIds` is
 * NOT part of this screen's PATCH: sending a stale copy back would silently undo the picker's work.
 */
export default function ClassDetail() {
  const th = useTheme();
  const { t, lang } = useLang();
  const { dow } = getCal(lang);
  const invalidate = useInvalidateStaff();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = rawId ?? 'new';
  const isNew = id === 'new';

  const { data: classes } = useClasses();
  const { data: students } = useStudents();
  const cls = isNew ? undefined : classes?.find((c) => c.id === id);

  const [name, setName] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [room, setRoom] = React.useState('');
  const [color, setColor] = React.useState<ColorIdValue>('green');
  const [schedule, setSchedule] = React.useState<ScheduleItem[]>([]);

  const seeded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!cls || seeded.current === cls.id) return;
    seeded.current = cls.id;
    setName(cls.name);
    setSubject(cls.subject ?? '');
    setRoom(cls.room ?? '');
    setColor((cls.color ?? 'green') as ColorIdValue);
    setSchedule(cls.schedule);
  }, [cls]);

  const save = useMutation({
    mutationFn: async () => {
      const base = {
        name: name.trim() || t('cls_default_name'),
        subject: subject || null,
        room: room || null,
        color,
        schedule,
      };
      if (isNew) {
        // A new class starts with an empty roster; the picker fills it once there is an id.
        return api.classes.create({ ...base, studentIds: [] } as ClassInput);
      }
      // `studentIds` deliberately omitted — see the note above. PATCH is a true partial.
      return api.classes.update(id, base);
    },
    onSuccess: () => {
      void invalidate();
      router.back();
    },
  });

  const del = useMutation({
    mutationFn: () => api.classes.remove(id),
    onSuccess: () => {
      void invalidate();
      router.back();
    },
  });

  const confirmDelete = () =>
    Alert.alert(t('cls_delete_q'), t('cls_delete_msg', { name: name || t('cls_default_name') }), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => del.mutate() },
    ]);

  const roster = rosterOf(cls, students);

  const setRow = (i: number, patch: Partial<ScheduleItem>) =>
    setSchedule((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader
        title={isNew ? t('cls_new_class') : t('cls_edit_class')}
        subtitle={isNew ? undefined : (cls?.subject || t('cls_general'))}
      />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
        keyboardShouldPersistTaps="handled"
      >
        <Input
          label={t('cls_name')}
          placeholder={t('cls_name_ph')}
          value={name}
          onChangeText={setName}
        />
        <Input
          label={t('cls_subject')}
          placeholder={t('cls_subject_ph')}
          value={subject}
          onChangeText={setSubject}
        />
        <Input
          label={t('cls_room')}
          placeholder={t('cls_room_ph')}
          value={room}
          onChangeText={setRoom}
        />
        <ColorPicker label={t('color')} value={color} onChange={setColor} />

        {/* ---- Weekly schedule ---- */}
        <Heading style={{ ...th.text.base, marginTop: th.spacing[2] }}>
          {t('cls_weekly_schedule')}
        </Heading>

        {schedule.length ? (
          schedule.map((row, i) => (
            <Card key={i} flat style={{ padding: th.spacing[3], gap: th.spacing[3] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
                <View style={{ flex: 1 }}>
                  <ChipSelect
                    value={String(row.day)}
                    options={dow.map((label, d) => ({ value: String(d), label }))}
                    onChange={(v) => setRow(i, { day: Number(v) })}
                  />
                </View>
                <IconButton
                  label={t('remove')}
                  onPress={() => setSchedule((rows) => rows.filter((_, j) => j !== i))}
                >
                  <Trash2 size={18} color={th.status.danger} />
                </IconButton>
              </View>
              <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
                <DateTimeField
                  mode="time"
                  label={t('ev_start')}
                  value={row.start}
                  onChange={(v) => setRow(i, { start: v })}
                />
                <DateTimeField
                  mode="time"
                  label={t('ev_end')}
                  value={row.end}
                  onChange={(v) => setRow(i, { end: v })}
                />
              </View>
            </Card>
          ))
        ) : (
          <Muted>{t('cls_no_schedule_yet')}</Muted>
        )}

        <Button
          variant="secondary"
          iconLeft={<Plus size={16} color={th.color.textStrong} />}
          onPress={() =>
            setSchedule((rows) => [...rows, { day: 1, start: '09:00', end: '10:00' }])
          }
        >
          {t('cls_add_time')}
        </Button>

        {/* ---- Roster ---- */}
        <Heading style={{ ...th.text.base, marginTop: th.spacing[2] }}>
          {t('cls_roster_n', { n: roster.length })}
        </Heading>

        {isNew ? (
          <Muted>{t('cls_roster_after_save')}</Muted>
        ) : (
          <>
            {roster.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[2] }}>
                {roster.map((s) => (
                  <View
                    key={s.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: th.spacing[2],
                      paddingRight: th.spacing[3],
                      paddingVertical: th.spacing[1],
                      paddingLeft: th.spacing[1],
                      borderRadius: th.radius.pill,
                      backgroundColor: th.color.surfaceSunken,
                    }}
                  >
                    <Avatar name={s.name} color={s.color} size="sm" />
                    <Body style={{ fontSize: th.text.sm.fontSize }}>{s.name}</Body>
                  </View>
                ))}
              </View>
            ) : (
              <Muted>{t('cls_no_students_assigned')}</Muted>
            )}

            <Card
              flat
              onPress={() => router.push(`/classes/${id}/roster`)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: th.spacing[3],
                minHeight: TOUCH,
                padding: th.spacing[4],
              }}
            >
              <Users size={18} color={th.color.textMuted} />
              <Body style={{ flex: 1 }}>{t('cls_roster_edit')}</Body>
              <ChevronRight size={18} color={th.color.textDisabled} />
            </Card>
          </>
        )}

        <Button
          variant="primary"
          block
          loading={save.isPending}
          onPress={() => save.mutate()}
          style={{ marginTop: th.spacing[2] }}
        >
          {t('cls_save')}
        </Button>

        {!isNew ? (
          <Button
            variant="secondary"
            block
            onPress={confirmDelete}
            iconLeft={<Trash2 size={16} color={th.status.danger} />}
          >
            {t('delete')}
          </Button>
        ) : null}

        <View style={{ height: th.spacing[10] }} />
      </ScrollView>
    </Screen>
  );
}

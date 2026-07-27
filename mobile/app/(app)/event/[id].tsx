import React from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronRight, FileText, Trash2 } from 'lucide-react-native';
import { AttendanceEditor } from '~/components/AttendanceEditor';
import { ChipSelect } from '~/components/ChipSelect';
import { DateTimeField } from '~/components/DateTimeField';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useLang } from '~/lib/i18n';
import { addMin, iso, RECURRENCES, RECURRENCE_TK, todayDate } from '~/lib/cal';
import {
  rosterOf,
  useClasses,
  useEventMaterials,
  useEventMutations,
  useEvents,
  useHomework,
  useHomeworkGrades,
  useMaterials,
  useStudents,
} from '~/lib/staff-data';
import { useTheme, TOUCH } from '~/theme';
import { Body, Button, Card, ColorPicker, Heading, Input, Muted, Screen, Tabs } from '~/ui';
import type { ColorIdValue, EventRow, HomeworkRow, MaterialRow } from '~/lib/types';
import type { EventInput } from '@mochi/shared/schemas';

/**
 * Task 4.3 — the event, as a full-screen route with top tabs.
 *
 * `id` is either an event id or the literal `new`; `date` is the occurrence being looked at, which
 * for a recurring event is not the same as the stored `event.date`. Attendance and the register are
 * per-occurrence, so that distinction is load-bearing, not cosmetic.
 *
 * The web's save/delete go through `useFetcher().submit()` with an `intent`
 * (`src/calendar/index.tsx:89-124`); here they are React Query mutations against `/api/events`,
 * invalidating per the phase-2 key map.
 *
 * The tabs appear only for a saved event that has a class — the same `showTabs` rule as the web
 * modal. Attendance, homework and materials all hang off a class; a personal event has none of them.
 */

type TabId = 'details' | 'homework' | 'materials' | 'attendance';

interface Draft {
  title: string;
  date: string;
  start: string;
  end: string;
  color: ColorIdValue;
  classId: string;
  location: string;
  recurrence: string;
  notes: string;
}

function draftFrom(ev: EventRow): Draft {
  return {
    title: ev.title,
    date: ev.date,
    start: ev.start ?? '',
    end: ev.end ?? '',
    color: (ev.color ?? 'orange') as ColorIdValue,
    classId: ev.classId ?? '',
    location: ev.location ?? '',
    recurrence: ev.recurrence || 'none',
    notes: ev.notes ?? '',
  };
}

export default function EventDetail() {
  const th = useTheme();
  const { t } = useLang();
  const params = useLocalSearchParams<{ id?: string; date?: string; start?: string }>();
  const id = params.id ?? 'new';
  const isNew = id === 'new';

  const { data: events } = useEvents();
  const { data: classes } = useClasses();
  const { create, update, remove } = useEventMutations();

  const event = isNew ? undefined : events?.find((e) => e.id === id);
  /** The occurrence under inspection. Defaults to the stored date, then today. */
  const occurrence = params.date || event?.date || iso(todayDate());

  const [tab, setTab] = React.useState<TabId>('details');
  const [draft, setDraft] = React.useState<Draft>(() => ({
    title: '',
    date: params.date || iso(todayDate()),
    start: params.start || '09:00',
    end: addMin(params.start || '09:00', 60),
    color: 'orange',
    classId: '',
    location: '',
    recurrence: 'none',
    notes: '',
  }));

  // Seed once the event arrives from cache or network. Keyed so a different event reseeds, but a
  // background refetch of the same one does not discard in-progress edits.
  const seeded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!event || seeded.current === event.id) return;
    seeded.current = event.id;
    setDraft(draftFrom(event));
  }, [event]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const cls = classes?.find((c) => c.id === draft.classId);
  const showTabs = !isNew && !!event && !!draft.classId;
  const saving = create.isPending || update.isPending;

  const save = () => {
    const input: EventInput = {
      title: draft.title.trim() || t('ev_untitled'),
      date: draft.date,
      start: draft.start || null,
      end: draft.end || null,
      color: draft.color,
      classId: draft.classId || null,
      location: draft.location || null,
      recurrence: draft.recurrence as EventInput['recurrence'],
      notes: draft.notes || null,
    };
    if (isNew) {
      create.mutate(input, { onSuccess: () => router.back() });
    } else {
      update.mutate({ id, patch: input }, { onSuccess: () => router.back() });
    }
  };

  const confirmDelete = () => {
    Alert.alert(t('ev_delete_q'), draft.title || t('ev_untitled'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => remove.mutate(id, { onSuccess: () => router.back() }),
      },
    ]);
  };

  const classOptions = [
    { value: '', label: t('ev_class_personal') },
    ...(classes ?? []).map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader
        title={isNew ? t('ev_new') : t('ev_edit')}
        subtitle={[occurrence, cls?.name].filter(Boolean).join(' · ')}
      />

      {showTabs ? (
        <View style={{ paddingHorizontal: th.spacing[4], paddingTop: th.spacing[3] }}>
          <Tabs
            value={tab}
            onChange={(v) => setTab(v as TabId)}
            tabs={[
              { id: 'details', label: t('ev_details') },
              { id: 'attendance', label: t('att_tab') },
              { id: 'homework', label: t('hw_tab') },
              { id: 'materials', label: t('mat_tab') },
            ]}
          />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
        keyboardShouldPersistTaps="handled"
      >
        {tab === 'details' ? (
          <>
            <Input
              label={t('ev_title')}
              placeholder={t('ev_title_ph')}
              value={draft.title}
              onChangeText={(v) => set('title', v)}
            />

            <DateTimeField
              mode="date"
              label={t('ev_date')}
              value={draft.date}
              onChange={(v) => set('date', v)}
            />

            <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
              <DateTimeField
                mode="time"
                label={t('ev_start')}
                value={draft.start}
                dateContext={draft.date}
                onChange={(v) => {
                  set('start', v);
                  // Keep the end after the start, as the web's openNew does with addMin(start, 60).
                  if (!draft.end || draft.end <= v) set('end', addMin(v, 60));
                }}
              />
              <DateTimeField
                mode="time"
                label={t('ev_end')}
                value={draft.end}
                dateContext={draft.date}
                onChange={(v) => set('end', v)}
              />
            </View>

            <ChipSelect
              label={t('class')}
              value={draft.classId}
              options={classOptions}
              onChange={(v) => {
                set('classId', v);
                // Adopting the class's colour matches the web modal's class-select behaviour.
                const picked = classes?.find((c) => c.id === v);
                if (picked) set('color', picked.color as ColorIdValue);
              }}
            />

            <ChipSelect
              label={t('ev_repeat')}
              value={draft.recurrence}
              options={RECURRENCES.map((r) => ({ value: r, label: t(RECURRENCE_TK[r]) }))}
              onChange={(v) => set('recurrence', v)}
            />

            <Input
              label={t('ev_location')}
              placeholder={t('ev_location_ph')}
              value={draft.location}
              onChangeText={(v) => set('location', v)}
            />

            <ColorPicker
              label={t('color')}
              value={draft.color}
              onChange={(v) => set('color', v)}
            />

            <Input
              label={t('ev_notes')}
              placeholder={t('ev_notes_ph')}
              value={draft.notes}
              onChangeText={(v) => set('notes', v)}
              multiline
              numberOfLines={5}
              style={{ height: 120, textAlignVertical: 'top', paddingTop: th.spacing[3] }}
            />

            <Button variant="primary" block loading={saving} onPress={save}>
              {isNew ? t('ev_add') : t('save')}
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
          </>
        ) : tab === 'attendance' ? (
          <AttendanceEditor
            key={`${id}:${occurrence}`}
            eventId={id}
            date={occurrence}
            classId={draft.classId || null}
          />
        ) : tab === 'homework' ? (
          <EventHomeworkTab classId={draft.classId} />
        ) : (
          <EventMaterialsTab eventId={id} classId={draft.classId} />
        )}

        <View style={{ height: th.spacing[10] }} />
      </ScrollView>
    </Screen>
  );
}

/**
 * The class's homework, each row showing how much of the roster is graded — the same
 * `hw_graded_n` summary as `src/calendar/homework-tab.tsx`. Tapping opens the grading screen
 * rather than a side panel: the web's `.evm-split` two-pane layout has nowhere to go at 360dp.
 */
function EventHomeworkTab({ classId }: { classId: string }) {
  const th = useTheme();
  const { t } = useLang();
  const { data: homework } = useHomework();
  const { data: classes } = useClasses();
  const { data: students } = useStudents();

  const roster = rosterOf(
    classes?.find((c) => c.id === classId),
    students,
  );
  const list = (homework ?? [])
    .filter((h) => h.classId === classId)
    .sort((a, b) => (b.due ?? '').localeCompare(a.due ?? ''));

  if (!list.length) {
    return (
      <Card>
        <Muted>{t('hw_list_empty')}</Muted>
      </Card>
    );
  }

  return (
    <View style={{ gap: th.spacing[3] }}>
      {list.map((h) => (
        <HomeworkGradeRow key={h.id} homework={h} rosterSize={roster.length} />
      ))}
    </View>
  );
}

/** One homework row, with its graded count. Split out so each row owns its own grades query. */
function HomeworkGradeRow({
  homework,
  rosterSize,
}: {
  homework: HomeworkRow;
  rosterSize: number;
}) {
  const th = useTheme();
  const { t } = useLang();
  const { data: grades } = useHomeworkGrades(homework.id);
  const graded = (grades ?? []).filter((g) => g.score != null || g.comment).length;

  return (
    <Card
      flat
      onPress={() => router.push(`/homework/${homework.id}/grade`)}
      style={{ padding: th.spacing[4], flexDirection: 'row', alignItems: 'center', gap: th.spacing[3], minHeight: TOUCH }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Body style={{ fontFamily: th.font.bodyBold }} numberOfLines={2}>
          {homework.title}
        </Body>
        <Muted numberOfLines={1}>
          {[homework.due ?? '', t('hw_graded_n', { done: graded, total: rosterSize })]
            .filter(Boolean)
            .join(' · ')}
        </Muted>
      </View>
      <ChevronRight size={18} color={th.color.textDisabled} />
    </Card>
  );
}

/**
 * Materials for the event: the class's own, plus anything explicitly attached to this event —
 * the same two groups the web shows. Tapping opens the viewer.
 */
function EventMaterialsTab({ eventId, classId }: { eventId: string; classId: string }) {
  const th = useTheme();
  const { t } = useLang();
  const { data: materials } = useMaterials();
  const { data: attachedIds } = useEventMaterials(eventId);

  const isClassMat = (m: MaterialRow) => m.scope === 'class' && m.classId === classId;
  const classMats = (materials ?? []).filter(isClassMat);
  const eventMats = (attachedIds ?? [])
    .map((mid) => materials?.find((m) => m.id === mid))
    .filter((m): m is MaterialRow => !!m && !isClassMat(m));

  const groups: { label: string; items: MaterialRow[] }[] = [
    { label: t('ev_mat_class_group'), items: classMats },
    { label: t('ev_mat_event_group'), items: eventMats },
  ];

  if (!classMats.length && !eventMats.length) {
    return (
      <Card>
        <Muted>{t('mat_list_empty')}</Muted>
      </Card>
    );
  }

  return (
    <View style={{ gap: th.spacing[4] }}>
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <View key={g.label} style={{ gap: th.spacing[2] }}>
            <Heading style={{ ...th.text.base }}>{g.label}</Heading>
            {g.items.map((m) => (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={m.title}
                onPress={() => router.push(`/material/${m.id}`)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: th.spacing[3],
                  minHeight: TOUCH,
                  paddingHorizontal: th.spacing[4],
                  borderRadius: th.radius.md,
                  borderWidth: 1.5,
                  borderColor: th.color.borderSubtle,
                  backgroundColor: pressed ? th.color.surfaceHover : th.color.surfaceCard,
                })}
              >
                <FileText size={18} color={th.color.textMuted} />
                <Body style={{ flex: 1 }} numberOfLines={2}>
                  {m.title}
                </Body>
                <ChevronRight size={18} color={th.color.textDisabled} />
              </Pressable>
            ))}
          </View>
        ))}
    </View>
  );
}

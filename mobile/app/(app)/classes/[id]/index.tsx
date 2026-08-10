import React from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { ChevronRight, Trash2, Users } from 'lucide-react-native';
import { NotifPrompt } from '~/components/NotifPrompt';
import { ChipSelect } from '~/components/ChipSelect';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useLang } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import {
  rosterOf,
  useClasses,
  useInvalidateStaff,
  useStudents,
  useSubjects,
} from '~/lib/staff-data';
import { useTheme, TOUCH } from '~/theme';
import { Avatar, Body, Button, Card, ColorPicker, Heading, Input, Muted, Screen } from '~/ui';
import type { ColorIdValue } from '~/lib/types';
import type { ClassInput } from '@mochi/shared/schemas';

/**
 * Task 4.4 — one class: identity and roster.
 *
 * This screen used to carry a weekly-schedule editor and a Room field. Both are gone: they were
 * phone-only, the web had no equivalent, and a field only one client can set is a field that
 * silently diverges. `class_schedule` and `classes.room` survive in the database, dormant.
 *
 * The roster is a separate pushed screen. A searchable multi-select of every student in the school
 * is not an inline list on a 360dp screen, and it writes directly — which is why `studentIds` is
 * NOT part of this screen's PATCH: sending a stale copy back would silently undo the picker's work.
 */
export default function ClassDetail() {
  const th = useTheme();
  const { t } = useLang();
  const invalidate = useInvalidateStaff();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = rawId ?? 'new';
  const isNew = id === 'new';

  const { data: classes } = useClasses();
  const { data: students } = useStudents();
  const { data: subjects } = useSubjects();
  const cls = isNew ? undefined : classes?.find((c) => c.id === id);
  const subjectName = subjects?.find((s) => s.id === cls?.subjectId)?.name;

  const [name, setName] = React.useState('');
  const [subjectId, setSubjectId] = React.useState('');
  const [color, setColor] = React.useState<ColorIdValue>('green');

  const seeded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!cls || seeded.current === cls.id) return;
    seeded.current = cls.id;
    setName(cls.name);
    setSubjectId(cls.subjectId ?? '');
    setColor((cls.color ?? 'green') as ColorIdValue);
  }, [cls]);

  const save = useMutation({
    mutationFn: async () => {
      const base = {
        name: name.trim() || t('cls_default_name'),
        subjectId: subjectId || null,
        color,
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

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader
        title={isNew ? t('cls_new_class') : t('cls_edit_class')}
        subtitle={isNew ? undefined : subjectName || t('cls_general')}
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
        <ChipSelect
          label={t('cls_subject')}
          value={subjectId}
          onChange={setSubjectId}
          options={[
            { value: '', label: t('cls_general') },
            // A deactivated subject stays offered on a class that already uses it, so editing
            // the name does not silently move the class to "General".
            ...(subjects ?? [])
              .filter((s) => s.active || s.id === subjectId)
              .map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <ColorPicker label={t('color')} value={color} onChange={setColor} />

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

        {/*
          The other contextual moment for the notification ask (phase 6.1): a teacher who has
          just opened a class is being offered reminders about that class. Renders nothing once
          the single ask has been spent.
        */}
        <NotifPrompt />

        <View style={{ height: th.spacing[10] }} />
      </ScrollView>
    </Screen>
  );
}

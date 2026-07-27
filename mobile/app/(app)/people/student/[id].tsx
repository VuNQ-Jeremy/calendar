import React from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { ScreenHeader } from '~/components/ScreenHeader';
import { TokenSearch } from '~/components/TokenSearch';
import { useLang, locale } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import {
  useClasses,
  useCollectionMutations,
  useStudentFlashcardStats,
  useStudents,
} from '~/lib/staff-data';
import type { ColorIdValue } from '~/lib/types';
import { useTheme } from '~/theme';
import {
  Body,
  Button,
  Card,
  ColorPicker,
  Heading,
  IconButton,
  Input,
  Muted,
  Screen,
} from '~/ui';

/**
 * Student detail: edit, class memberships, flashcard stats, delete.
 *
 * `id === 'new'` is the create form. One screen for both, because the fields are identical and
 * two files that must be kept in sync is how the "add" form quietly stops matching the "edit"
 * one.
 *
 * **Class membership writes `class_students`, the same join table the class roster
 * (Phase 4, `classes/[id]/roster.tsx`) writes.** Both go through the coarse
 * `invalidateQueries()`, so editing enrolment here refreshes `['classes']` as well as
 * `['people']` — the roster screen cannot be left showing a student who is no longer in the
 * class. Narrowing either side of that invalidation is how the two screens start disagreeing.
 */
export default function StudentDetail() {
  const th = useTheme();
  const { t, lang } = useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const { data: students } = useStudents();
  const { data: classes } = useClasses();
  const { data: stats } = useStudentFlashcardStats();
  const { create, update, remove } = useCollectionMutations(api.students);

  const existing = students?.find((s) => s.id === id);

  const [name, setName] = React.useState('');
  const [grade, setGrade] = React.useState('');
  const [guardian, setGuardian] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [color, setColor] = React.useState<ColorIdValue>('blue');
  const [classIds, setClassIds] = React.useState<string[]>([]);
  const [hydrated, setHydrated] = React.useState(false);

  // Seed once, when the row arrives. Re-seeding on every render of `existing` would overwrite
  // whatever the user has typed each time a background refetch lands.
  React.useEffect(() => {
    if (isNew || hydrated || !existing) return;
    setName(existing.name);
    setGrade(existing.grade ?? '');
    setGuardian(existing.guardian ?? '');
    setEmail(existing.email ?? '');
    setColor(existing.color);
    setClassIds(existing.classIds ?? []);
    setHydrated(true);
  }, [existing, isNew, hydrated]);

  const mine = stats?.find((s) => s.studentId === id);
  const busy = create.isPending || update.isPending;

  const save = () => {
    const input = {
      name: name.trim() || t('sm_default_name'),
      grade: grade.trim() || null,
      guardian: guardian.trim() || null,
      email: email.trim() || null,
      color,
      classIds,
    };
    const opts = { onSuccess: () => router.back() };
    if (isNew) create.mutate(input, opts);
    else update.mutate({ id: id!, patch: input }, opts);
  };

  const confirmDelete = () =>
    Alert.alert(t('student_remove_q'), t('student_remove_msg', { name: existing?.name ?? '' }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('remove'),
        style: 'destructive',
        onPress: () => remove.mutate(id!, { onSuccess: () => router.back() }),
      },
    ]);

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader
        title={isNew ? t('sm_add') : t('sm_edit')}
        subtitle={isNew ? undefined : existing?.name}
        right={
          isNew ? undefined : (
            <IconButton label={t('delete')} onPress={confirmDelete}>
              <Trash2 size={20} color={th.status.danger} />
            </IconButton>
          )
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={{ gap: th.spacing[4] }}>
          <Input label={t('prof_fullname')} value={name} onChangeText={setName} autoFocus={isNew} />
          <Input label={t('sm_grade')} value={grade} onChangeText={setGrade} />
          <Input
            label={t('sm_guardian')}
            value={guardian}
            onChangeText={setGuardian}
            placeholder={t('sm_guardian_ph')}
          />
          <Input
            label={t('prof_email')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <ColorPicker label={t('prof_avatar_color')} value={color} onChange={setColor} />
        </Card>

        <Card style={{ gap: th.spacing[3] }}>
          <TokenSearch
            label={t('sm_enrolled')}
            items={classes ?? []}
            selectedIds={classIds}
            onToggle={(cid) =>
              setClassIds((prev) =>
                prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid],
              )
            }
            placeholder={t('sm_search_classes')}
            emptyHint={t('sm_all_classes_added')}
          />
        </Card>

        {!isNew ? (
          <Card style={{ gap: th.spacing[3] }}>
            <Heading>{t('nav_flashcards')}</Heading>
            {mine ? (
              <View style={{ flexDirection: 'row', gap: th.spacing[6], flexWrap: 'wrap' }}>
                <StatBlock value={String(mine.rounds)} label={t('fc_stats_rounds')} />
                <StatBlock value={`${mine.avgPct}%`} label={t('fc_stats_avg')} />
                {mine.lastPlayedAt ? (
                  <StatBlock
                    value={new Date(mine.lastPlayedAt).toLocaleDateString(locale(lang), {
                      month: 'short',
                      day: 'numeric',
                    })}
                    label={t('fc_stats_last')}
                  />
                ) : null}
              </View>
            ) : (
              <Muted>{t('fc_stats_none')}</Muted>
            )}
          </Card>
        ) : null}

        <Button block loading={busy} onPress={save}>
          {t('save')}
        </Button>
        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}

function StatBlock({ value, label }: { value: string; label: string }) {
  const th = useTheme();
  return (
    <View>
      <Body style={{ fontFamily: th.font.bodyBold, color: th.color.textStrong }}>{value}</Body>
      <Muted>{label}</Muted>
    </View>
  );
}

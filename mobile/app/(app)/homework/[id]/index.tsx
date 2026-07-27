import React from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { ChipSelect } from '~/components/ChipSelect';
import { DateTimeField } from '~/components/DateTimeField';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useLang } from '~/lib/i18n';
import { iso, todayDate } from '~/lib/cal';
import * as api from '~/lib/endpoints';
import {
  useAssessmentTypes,
  useClasses,
  useHomework,
  useInvalidateStaff,
} from '~/lib/staff-data';
import { useTheme } from '~/theme';
import { Button, ColorPicker, Input, Muted, Screen } from '~/ui';
import type { ColorIdValue } from '~/lib/types';
import type { HomeworkInput } from '@mochi/shared/schemas';

/**
 * Create or edit one homework. `id` is an id or the literal `new`.
 *
 * The web does this in a 480px modal; the fields are the same, one per row. Points is a numeric
 * keyboard rather than a spinner — there is no `<input type=number>` on a phone.
 */
export default function HomeworkEdit() {
  const th = useTheme();
  const { t } = useLang();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = rawId ?? 'new';
  const isNew = id === 'new';
  const invalidate = useInvalidateStaff();

  const { data: homework } = useHomework();
  const { data: classes } = useClasses();
  const { data: types } = useAssessmentTypes();
  const hw = isNew ? undefined : homework?.find((h) => h.id === id);

  const [title, setTitle] = React.useState('');
  const [classId, setClassId] = React.useState('');
  const [due, setDue] = React.useState(iso(todayDate()));
  const [points, setPoints] = React.useState('10');
  const [notes, setNotes] = React.useState('');
  const [color, setColor] = React.useState<ColorIdValue>('orange');
  const [typeId, setTypeId] = React.useState('');

  const seeded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!hw || seeded.current === hw.id) return;
    seeded.current = hw.id;
    setTitle(hw.title);
    setClassId(hw.classId ?? '');
    setDue(hw.due ?? '');
    setPoints(hw.points != null ? String(hw.points) : '');
    setNotes(hw.notes ?? '');
    setColor((hw.color ?? 'orange') as ColorIdValue);
    setTypeId(hw.assessmentTypeId ?? '');
  }, [hw]);

  const save = useMutation({
    mutationFn: () => {
      const input: HomeworkInput = {
        title: title.trim() || t('hw_untitled'),
        classId: classId || null,
        due: due || null,
        points: points === '' ? null : Number(points),
        notes: notes || null,
        color,
        done: hw?.done ?? false,
        assessmentTypeId: typeId || null,
      };
      return isNew ? api.homework.create(input) : api.homework.update(id, input);
    },
    onSuccess: () => {
      void invalidate();
      router.back();
    },
  });

  const classOptions = [
    { value: '', label: t('no_class') },
    ...(classes ?? []).map((c) => ({ value: c.id, label: c.name })),
  ];

  const typeOptions = [
    { value: '', label: t('assess_type_none') },
    ...(types ?? [])
      .filter((tp) => tp.active || tp.id === typeId)
      .map((tp) => ({ value: tp.id, label: tp.name })),
  ];

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={isNew ? t('hw_new_task') : t('hw_edit_task')} />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
        keyboardShouldPersistTaps="handled"
      >
        <Input label={t('hw_task')} value={title} onChangeText={setTitle} />

        <ChipSelect
          label={t('class')}
          value={classId}
          options={classOptions}
          onChange={(v) => {
            setClassId(v);
            const picked = classes?.find((c) => c.id === v);
            if (picked) setColor(picked.color as ColorIdValue);
          }}
        />

        <DateTimeField mode="date" label={t('hw_due')} value={due} onChange={setDue} />

        <Input
          label={t('hw_points')}
          value={points}
          onChangeText={(v) => setPoints(v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
        />

        <ChipSelect
          label={t('assess_score_label')}
          value={typeId}
          options={typeOptions}
          onChange={setTypeId}
        />
        <Muted>{t('hw_grade_synced')}</Muted>

        <ColorPicker label={t('color')} value={color} onChange={setColor} />

        <Input
          label={t('hw_notes')}
          placeholder={t('hw_notes_ph')}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={4}
          style={{ height: 100, textAlignVertical: 'top', paddingTop: th.spacing[3] }}
        />

        <Button variant="primary" block loading={save.isPending} onPress={() => save.mutate()}>
          {t('save')}
        </Button>

        <View style={{ height: th.spacing[10] }} />
      </ScrollView>
    </Screen>
  );
}

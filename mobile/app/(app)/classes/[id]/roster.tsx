import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react-native';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useLang } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import { useClasses, useInvalidateStaff, useStudents } from '~/lib/staff-data';
import { useTheme, TOUCH } from '~/theme';
import { Avatar, Body, Card, Input, Muted, Screen } from '~/ui';

/**
 * The roster: a searchable multi-select of every student in the school.
 *
 * A pushed screen, not an inline list. The web renders all students as a two-column grid of toggle
 * buttons inside a 600px modal; at 360dp that is a list of unknown length buried under the rest of
 * a form, with no way to find one student among two hundred.
 *
 * Each tap PATCHes immediately rather than collecting a draft. There is no Save button to lose, and
 * the class detail screen deliberately omits `studentIds` from its own PATCH so the two cannot
 * fight over the same field.
 */
export default function ClassRoster() {
  const th = useTheme();
  const { t } = useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const invalidate = useInvalidateStaff();

  const { data: classes } = useClasses();
  const { data: students, isLoading } = useStudents();
  const cls = classes?.find((c) => c.id === id);

  const [query, setQuery] = React.useState('');

  /**
   * Optimistic local copy. The mutation invalidates on success, but a roster tap has to feel
   * instant — this is a checkbox, not a form submission.
   */
  const [ids, setIds] = React.useState<string[] | null>(null);
  const current = ids ?? cls?.studentIds ?? [];

  const setRoster = useMutation({
    mutationFn: (next: string[]) => api.classes.update(id!, { studentIds: next }),
    onSuccess: () => void invalidate(),
    onError: () => {
      // Drop the optimistic copy so the list falls back to what the server actually has.
      setIds(null);
    },
  });

  const toggle = (studentId: string) => {
    const next = current.includes(studentId)
      ? current.filter((x) => x !== studentId)
      : [...current, studentId];
    setIds(next);
    setRoster.mutate(next);
  };

  const needle = query.trim().toLowerCase();
  const list = (students ?? []).filter(
    (s) =>
      !needle ||
      s.name.toLowerCase().includes(needle) ||
      (s.grade ?? '').toLowerCase().includes(needle),
  );

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader
        title={t('cls_roster_edit')}
        subtitle={`${cls?.name ?? ''} · ${t('cls_students_n', { n: current.length })}`}
      />

      <View style={{ padding: th.spacing[5], paddingBottom: 0 }}>
        <Input
          placeholder={t('cls_roster_search')}
          value={query}
          onChangeText={setQuery}
          iconLeft={<Search size={18} color={th.color.textMuted} />}
          autoCorrect={false}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[2] }}
        keyboardShouldPersistTaps="handled"
      >
        {isLoading && !students ? (
          <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[6] }} />
        ) : null}

        {!list.length && students ? (
          <Card flat>
            <Muted>{t('cls_no_students_assigned')}</Muted>
          </Card>
        ) : null}

        {list.map((s) => {
          const on = current.includes(s.id);
          return (
            <Pressable
              key={s.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={s.name}
              onPress={() => toggle(s.id)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: th.spacing[3],
                minHeight: TOUCH,
                paddingHorizontal: th.spacing[4],
                paddingVertical: th.spacing[2],
                borderRadius: th.radius.md,
                borderWidth: 1.5,
                borderColor: on ? th.color.brand : th.color.borderSubtle,
                backgroundColor: on
                  ? th.color.brandSoft
                  : pressed
                    ? th.color.surfaceHover
                    : th.color.surfaceCard,
              })}
            >
              <Avatar name={s.name} color={s.color} size="sm" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Body style={{ fontFamily: th.font.bodyBold }} numberOfLines={1}>
                  {s.name}
                </Body>
                {s.grade ? <Muted numberOfLines={1}>{s.grade}</Muted> : null}
              </View>
              {on ? <Check size={20} color={th.color.brandSoftInk} /> : null}
            </Pressable>
          );
        })}

        <View style={{ height: th.spacing[10] }} />
      </ScrollView>
    </Screen>
  );
}

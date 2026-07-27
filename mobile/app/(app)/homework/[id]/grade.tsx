import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MessageSquare } from 'lucide-react-native';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useLang } from '~/lib/i18n';
import {
  rosterOf,
  useClasses,
  useHomework,
  useHomeworkGrades,
  useSaveGrades,
  useStudents,
} from '~/lib/staff-data';
import { useTheme, TOUCH } from '~/theme';
import { Avatar, Body, Button, Card, Heading, IconButton, Input, Muted, Screen } from '~/ui';

/**
 * Grading: one row per student, a numeric keypad for the score, the comment behind a tap.
 *
 * Maps to `intent=save-grades` / `POST /api/homework/:id/grades` and `HomeworkGradesSaveInput`
 * (`shared/schemas.ts:194`). The **whole roster goes in one request**, as on the web — and that is
 * not just a performance choice: `saveGrades` treats a student with neither score nor comment as a
 * deletion, and also maintains a linked `score_records` row (created iff `score != null`) so the
 * Assessment charts include assignment grades. Sending one student at a time would still work, but
 * the invariant is easier to reason about when the payload is the full set, exactly as the server
 * documents it (`server/services/homework.ts`).
 *
 * Explicit Save here, not the autosave the register uses. Grading is done sitting down with a pile
 * of work, corrections are common mid-entry, and a visible dirty state is the clearer contract.
 */
export default function GradeHomework() {
  const th = useTheme();
  const { t } = useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const homeworkId = id ?? '';

  const { data: homework } = useHomework();
  const { data: classes } = useClasses();
  const { data: students } = useStudents();
  const { data: grades, isLoading } = useHomeworkGrades(homeworkId);
  const save = useSaveGrades(homeworkId);

  const hw = homework?.find((h) => h.id === homeworkId);
  const roster = rosterOf(
    classes?.find((c) => c.id === hw?.classId),
    students,
  );

  const [rows, setRows] = React.useState<Record<string, { score: string; comment: string }>>({});
  const [dirty, setDirty] = React.useState(false);
  const [openComment, setOpenComment] = React.useState<string | null>(null);

  // Seed once per assignment. A refetch must not overwrite half-typed scores.
  const seeded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!grades || !roster.length || seeded.current === homeworkId) return;
    seeded.current = homeworkId;
    const next: Record<string, { score: string; comment: string }> = {};
    for (const s of roster) {
      const g = grades.find((x) => x.studentId === s.id);
      next[s.id] = { score: g?.score != null ? String(g.score) : '', comment: g?.comment ?? '' };
    }
    setRows(next);
  }, [grades, roster, homeworkId]);

  const set = (sid: string, patch: Partial<{ score: string; comment: string }>) => {
    setRows((p) => ({ ...p, [sid]: { ...{ score: '', comment: '' }, ...p[sid], ...patch } }));
    setDirty(true);
  };

  /** Digits and at most one decimal point, capped at 10 — the server's own bound. */
  const cleanScore = (raw: string): string => {
    const kept = raw.replace(/[^0-9.]/g, '');
    const parts = kept.split('.');
    const joined = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : kept;
    if (joined === '' || joined === '.') return '';
    const n = Number(joined);
    if (Number.isFinite(n) && n > 10) return '10';
    return joined;
  };

  const submit = () => {
    const records = roster.map((s) => {
      const row = rows[s.id];
      const raw = row?.score ?? '';
      return {
        studentId: s.id,
        score: raw === '' ? null : Number(raw),
        comment: row?.comment?.trim() ? row.comment.trim() : null,
      };
    });
    save.mutate(records, {
      onSuccess: () => {
        setDirty(false);
        router.back();
      },
    });
  };

  const gradedCount = roster.filter((s) => {
    const row = rows[s.id];
    return !!row && (row.score !== '' || !!row.comment.trim());
  }).length;

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader
        title={hw?.title ?? t('hw_grade')}
        subtitle={t('hw_graded_n', { done: gradedCount, total: roster.length })}
      />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[3] }}
        keyboardShouldPersistTaps="handled"
      >
        {isLoading && !grades ? (
          <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[6] }} />
        ) : null}

        {!roster.length ? (
          <Card>
            <Heading>{t('att_empty_roster')}</Heading>
            <Muted>{hw?.classId ? t('att_empty_roster_sub') : t('att_no_class_sub')}</Muted>
          </Card>
        ) : null}

        {roster.map((s) => {
          const row = rows[s.id] ?? { score: '', comment: '' };
          const commentOpen = openComment === s.id || !!row.comment;
          return (
            <Card key={s.id} flat style={{ padding: th.spacing[3], gap: th.spacing[3] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
                <Avatar name={s.name} color={s.color} size="sm" />
                <Body style={{ flex: 1, fontFamily: th.font.bodyBold }} numberOfLines={1}>
                  {s.name}
                </Body>

                <Input
                  value={row.score}
                  onChangeText={(v) => set(s.id, { score: cleanScore(v) })}
                  keyboardType="decimal-pad"
                  placeholder="—"
                  containerStyle={{ width: 76 }}
                  style={{ textAlign: 'center', fontFamily: th.font.mono }}
                  accessibilityLabel={`${s.name} — ${t('hw_grade')}`}
                />

                <IconButton
                  label={t('hw_comment')}
                  onPress={() => setOpenComment(openComment === s.id ? null : s.id)}
                >
                  <MessageSquare
                    size={18}
                    color={row.comment ? th.color.brand : th.color.textMuted}
                  />
                </IconButton>
              </View>

              {commentOpen ? (
                <Input
                  placeholder={t('hw_comment')}
                  value={row.comment}
                  onChangeText={(v) => set(s.id, { comment: v })}
                />
              ) : null}
            </Card>
          );
        })}

        {roster.length ? (
          <View style={{ gap: th.spacing[2], marginTop: th.spacing[2], minHeight: TOUCH }}>
            {save.isError ? (
              <Body style={{ color: th.status.danger }}>{t('m_server_error')}</Body>
            ) : dirty ? (
              <Muted>{t('hw_unsaved')}</Muted>
            ) : null}
            <Button variant="primary" block loading={save.isPending} onPress={submit}>
              {t('hw_grade_save')}
            </Button>
          </View>
        ) : null}

        <View style={{ height: th.spacing[10] }} />
      </ScrollView>
    </Screen>
  );
}

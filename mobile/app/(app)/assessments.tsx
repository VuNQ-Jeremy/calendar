import React from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { BarChart3, Pencil, Plus, Trash2 } from 'lucide-react-native';
import {
  BEHAVIOR_META,
  BEHAVIOR_TYPES,
  NEGATIVE_TYPES,
  bucketBehaviorByWeek,
  scoreStats,
  type BehaviorTypeId,
} from '@mochi/shared/logic/assess';
import { ProgressLineChart, StackedBarChart } from '~/components/Charts';
import { ChipSelect } from '~/components/ChipSelect';
import { DateTimeField } from '~/components/DateTimeField';
import { ScreenHeader } from '~/components/ScreenHeader';
import { SearchField, matches } from '~/components/SearchField';
import { iso, todayDate } from '~/lib/cal';
import * as api from '~/lib/endpoints';
import { useLang, locale } from '~/lib/i18n';
import {
  useAssessmentTypes,
  useBehavior,
  useClasses,
  useInvalidateStaff,
  useScores,
  useStudents,
} from '~/lib/staff-data';
import type { BehaviorRecordRow, ScoreRecordRow } from '~/lib/types';
import { useTheme } from '~/theme';
import { Body, Button, Card, Heading, IconButton, Input, Muted, Screen, Tabs, Tag } from '~/ui';

/**
 * Task 5.3 — Assessments: score records and behaviour records, per student.
 *
 * Port of `src/screens-assessments.tsx`. Two changes of form, both because a phone is not a desk:
 *
 *   - **The wide score table becomes a card list.** Five columns at 360dp is either unreadable or
 *     scrolls sideways, and a page that scrolls sideways is a bug. Each record is a card with the
 *     score as the biggest thing on it.
 *   - **The two modals become inline forms** that expand under the Add button. A modal on a phone
 *     is a full screen with worse back behaviour.
 *
 * The charts are the same charts — `components/Charts.tsx` is the web's SVG maths against
 * `react-native-svg` — and the bucketing is literally the same function, now in
 * `@mochi/shared/logic/assess`.
 */

const INCIDENT_WEEKS = 12;

type Draft =
  | {
      kind: 'score';
      id?: string;
      date: string;
      score: string;
      classId: string;
      typeId: string;
      notes: string;
    }
  | {
      kind: 'behavior';
      id?: string;
      date: string;
      type: BehaviorTypeId;
      classId: string;
      notes: string;
    };

export default function Assessments() {
  const th = useTheme();
  const { t, lang } = useLang();
  const invalidate = useInvalidateStaff();

  const { data: students, isLoading: loadingStudents } = useStudents();
  const { data: classes } = useClasses();
  const { data: types } = useAssessmentTypes();
  const { data: scores, isRefetching: rs } = useScores();
  const { data: behavior, isRefetching: rb } = useBehavior();

  const [tab, setTab] = React.useState<'scores' | 'behavior'>('scores');
  const [classFilter, setClassFilter] = React.useState('all');
  const [q, setQ] = React.useState('');
  const [studentId, setStudentId] = React.useState('');
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const today = iso(todayDate());

  const visibleStudents = (students ?? []).filter(
    (s) => (classFilter === 'all' || s.classIds.includes(classFilter)) && matches(q, s.name, s.grade),
  );
  // Follows the web exactly: if the current pick is filtered out, fall back to the first one left
  // rather than showing an empty screen against a stale selection.
  const activeId = visibleStudents.some((s) => s.id === studentId)
    ? studentId
    : (visibleStudents[0]?.id ?? '');
  const active = visibleStudents.find((s) => s.id === activeId);

  const inScope = (r: { studentId: string; classId?: string | null }) =>
    r.studentId === activeId && (classFilter === 'all' || r.classId === classFilter);
  const myScores = (scores ?? []).filter(inScope);
  const myBehavior = (behavior ?? []).filter(inScope);

  const stats = scoreStats(myScores);
  const buckets = bucketBehaviorByWeek(myBehavior, INCIDENT_WEEKS, today);
  const windowStart = buckets[0]?.key;
  const typeCounts: Record<string, number> = {};
  for (const b of buckets) {
    for (const ty of NEGATIVE_TYPES) typeCounts[ty] = (typeCounts[ty] ?? 0) + (b.counts[ty] ?? 0);
  }
  const praiseCount = myBehavior.filter(
    (r) => r.type === 'praise' && (!windowStart || r.date >= windowStart),
  ).length;

  const classOf = (id: string | null | undefined) => classes?.find((c) => c.id === id)?.name;
  const typeOf = (id: string | null | undefined) => types?.find((tp) => tp.id === id)?.name;
  const fmtShort = (d: string) =>
    new Date(d).toLocaleDateString(locale(lang), { day: 'numeric', month: 'short' });
  const fmtWeek = (d: string) =>
    new Date(d).toLocaleDateString(locale(lang), { day: 'numeric', month: 'numeric' });

  /** The class a new record defaults to: the filter if one is set, else the student's first. */
  const defaultClassId = () => (classFilter !== 'all' ? classFilter : (active?.classIds[0] ?? ''));

  const saveScore = useMutation({
    mutationFn: (d: Extract<Draft, { kind: 'score' }>) => {
      const input = {
        studentId: activeId,
        date: d.date,
        score: Number(d.score),
        classId: d.classId || null,
        assessmentTypeId: d.typeId || null,
        notes: d.notes.trim() || null,
      };
      return d.id ? api.scores.update(d.id, input) : api.scores.create(input);
    },
    onSuccess: () => {
      setDraft(null);
      void invalidate();
    },
  });

  const saveBehavior = useMutation({
    mutationFn: (d: Extract<Draft, { kind: 'behavior' }>) => {
      const input = {
        studentId: activeId,
        date: d.date,
        type: d.type,
        classId: d.classId || null,
        notes: d.notes.trim() || null,
      };
      return d.id ? api.behavior.update(d.id, input) : api.behavior.create(input);
    },
    onSuccess: () => {
      setDraft(null);
      void invalidate();
    },
  });

  const removeScore = useMutation({
    mutationFn: (id: string) => api.scores.remove(id),
    onSuccess: () => void invalidate(),
  });
  const removeBehavior = useMutation({
    mutationFn: (id: string) => api.behavior.remove(id),
    onSuccess: () => void invalidate(),
  });

  const confirmDelete = (label: string, onYes: () => void) =>
    Alert.alert(t('delete'), label, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: onYes },
    ]);

  if (!loadingStudents && !(students ?? []).length) {
    return (
      <Screen edges={{ top: true }}>
        <ScreenHeader title={t('assess_title')} subtitle={t('assess_sub')} />
        <View style={{ padding: th.spacing[5] }}>
          <Card>
            <Heading>{t('assess_no_students')}</Heading>
            <Muted>{t('assess_no_students_sub')}</Muted>
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('assess_title')} subtitle={t('assess_sub')} />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[4], gap: th.spacing[4] }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={rs || rb}
            onRefresh={() => void invalidate()}
            tintColor={th.color.brand}
          />
        }
      >
        {/* ---- Who, and which class ---- */}
        <Card style={{ gap: th.spacing[3] }}>
          <ChipSelect
            label={t('assess_class')}
            value={classFilter}
            onChange={setClassFilter}
            options={[
              { value: 'all', label: t('assess_all_classes') },
              ...(classes ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <SearchField value={q} onChange={setQ} placeholder={t('assess_search_ph')} />
          {visibleStudents.length ? (
            <ChipSelect
              label={t('assess_student')}
              value={activeId}
              onChange={setStudentId}
              options={visibleStudents.map((s) => ({ value: s.id, label: s.name }))}
            />
          ) : (
            <Muted>{t('ppl_no_match', { q })}</Muted>
          )}
        </Card>

        {loadingStudents && !students ? <ActivityIndicator color={th.color.brand} /> : null}

        <Tabs
          value={tab}
          onChange={(id) => {
            setTab(id as 'scores' | 'behavior');
            setDraft(null);
          }}
          tabs={[
            { id: 'scores', label: t('assess_tab_scores') },
            { id: 'behavior', label: t('assess_tab_behavior') },
          ]}
        />

        {!activeId ? null : tab === 'scores' ? (
          <>
            <Button
              block
              iconLeft={<Plus size={18} color={th.color.textOnBrand} />}
              onPress={() =>
                setDraft({
                  kind: 'score',
                  date: today,
                  score: '',
                  classId: defaultClassId(),
                  typeId: '',
                  notes: '',
                })
              }
            >
              {t('assess_add_score')}
            </Button>

            {draft?.kind === 'score' ? (
              <ScoreForm
                draft={draft}
                setDraft={setDraft}
                classes={(classes ?? []).map((c) => ({ value: c.id, label: c.name }))}
                types={(types ?? [])
                  .filter((tp) => tp.active || tp.id === draft.typeId)
                  .map((tp) => ({ value: tp.id, label: tp.name }))}
                busy={saveScore.isPending}
                onCancel={() => setDraft(null)}
                onSave={() => saveScore.mutate(draft)}
              />
            ) : null}

            <Card style={{ gap: th.spacing[3] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
                <BarChart3 size={18} color={th.color.textMuted} />
                <Heading style={{ flex: 1 }}>{t('assess_progress_chart')}</Heading>
              </View>
              <View style={{ flexDirection: 'row', gap: th.spacing[4] }}>
                <Muted>{`${t('assess_avg')}: ${stats.average ?? '—'}`}</Muted>
                <Muted>{`${t('assess_latest')}: ${stats.latest ?? '—'}`}</Muted>
              </View>
              <ProgressLineChart
                points={myScores.map((r) => ({
                  x: r.date,
                  y: r.score,
                  label: typeOf(r.assessmentTypeId),
                }))}
                formatX={fmtShort}
                emptyLabel={t('assess_no_scores')}
              />
            </Card>

            {myScores.length ? (
              [...myScores].reverse().map((r) => (
                <ScoreCard
                  key={r.id}
                  row={r}
                  typeName={typeOf(r.assessmentTypeId)}
                  className={classOf(r.classId)}
                  dateLabel={fmtShort(r.date)}
                  onEdit={() =>
                    setDraft({
                      kind: 'score',
                      id: r.id,
                      date: r.date,
                      score: String(r.score),
                      classId: r.classId ?? '',
                      typeId: r.assessmentTypeId ?? '',
                      notes: r.notes ?? '',
                    })
                  }
                  onDelete={() =>
                    confirmDelete(`${r.score} · ${fmtShort(r.date)}`, () => removeScore.mutate(r.id))
                  }
                />
              ))
            ) : (
              <Card>
                <Heading>{t('assess_no_scores')}</Heading>
                <Muted>{t('assess_no_scores_sub')}</Muted>
              </Card>
            )}
          </>
        ) : (
          <>
            <Button
              block
              iconLeft={<Plus size={18} color={th.color.textOnBrand} />}
              onPress={() =>
                setDraft({
                  kind: 'behavior',
                  date: today,
                  type: 'late',
                  classId: defaultClassId(),
                  notes: '',
                })
              }
            >
              {t('assess_add_behavior')}
            </Button>

            {draft?.kind === 'behavior' ? (
              <BehaviorForm
                draft={draft}
                setDraft={setDraft}
                classes={(classes ?? []).map((c) => ({ value: c.id, label: c.name }))}
                busy={saveBehavior.isPending}
                onCancel={() => setDraft(null)}
                onSave={() => saveBehavior.mutate(draft)}
              />
            ) : null}

            <View style={{ flexDirection: 'row', gap: th.spacing[2], flexWrap: 'wrap' }}>
              <CountTile n={typeCounts.late ?? 0} label={t('bh_late')} color="orange" />
              <CountTile n={typeCounts.absent ?? 0} label={t('bh_absent')} color="rose" />
              <CountTile
                n={typeCounts.missing_homework ?? 0}
                label={t('bh_missing_homework')}
                color="violet"
              />
              <CountTile n={praiseCount} label={t('assess_praise_count')} color="green" />
            </View>

            <Card style={{ gap: th.spacing[3] }}>
              <Heading>{t('assess_incidents_chart', { n: INCIDENT_WEEKS })}</Heading>
              <StackedBarChart
                buckets={buckets.map((b) => ({
                  key: b.key,
                  label: fmtWeek(b.key),
                  segments: NEGATIVE_TYPES.map((ty) => ({
                    type: ty,
                    count: b.counts[ty] ?? 0,
                    color: th.category[BEHAVIOR_META[ty].color as keyof typeof th.category].base,
                  })),
                }))}
              />
              <View style={{ flexDirection: 'row', gap: th.spacing[3], flexWrap: 'wrap' }}>
                {NEGATIVE_TYPES.map((ty) => (
                  <View
                    key={ty}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[1] }}
                  >
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        backgroundColor:
                          th.category[BEHAVIOR_META[ty].color as keyof typeof th.category].base,
                      }}
                    />
                    <Muted style={{ fontSize: th.text.xs.fontSize }}>{t(BEHAVIOR_META[ty].tk)}</Muted>
                  </View>
                ))}
              </View>
            </Card>

            {myBehavior.length ? (
              [...myBehavior].reverse().map((r) => (
                <BehaviorCard
                  key={r.id}
                  row={r}
                  className={classOf(r.classId)}
                  dateLabel={fmtShort(r.date)}
                  onEdit={() =>
                    setDraft({
                      kind: 'behavior',
                      id: r.id,
                      date: r.date,
                      type: r.type as BehaviorTypeId,
                      classId: r.classId ?? '',
                      notes: r.notes ?? '',
                    })
                  }
                  onDelete={() => confirmDelete(fmtShort(r.date), () => removeBehavior.mutate(r.id))}
                />
              ))
            ) : (
              <Card>
                <Heading>{t('assess_no_behavior')}</Heading>
                <Muted>{t('assess_no_behavior_sub')}</Muted>
              </Card>
            )}
          </>
        )}

        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}

// ---- Pieces ----

/** Score colour thresholds, identical to the web's `ScoreBadge`. */
function scoreColor(score: number): string {
  return score >= 8 ? 'green' : score >= 6.5 ? 'blue' : score >= 5 ? 'orange' : 'rose';
}

function CountTile({ n, label, color }: { n: number; label: string; color: string }) {
  const th = useTheme();
  const cat = th.category[color as keyof typeof th.category];
  return (
    <Card
      flat
      style={{
        flexGrow: 1,
        flexBasis: '45%',
        padding: th.spacing[4],
        gap: th.spacing[1],
        backgroundColor: cat.soft,
        borderColor: 'transparent',
      }}
    >
      <Body
        style={{ fontFamily: th.font.displayBold, fontSize: th.text.xl.fontSize, color: cat.ink }}
      >
        {n}
      </Body>
      <Muted style={{ color: cat.ink }}>{label}</Muted>
    </Card>
  );
}

function ScoreCard({
  row,
  typeName,
  className,
  dateLabel,
  onEdit,
  onDelete,
}: {
  row: ScoreRecordRow;
  typeName?: string;
  className?: string;
  dateLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const th = useTheme();
  const { t } = useLang();
  const cat = th.category[scoreColor(row.score) as keyof typeof th.category];

  return (
    <Card flat style={{ padding: th.spacing[4], gap: th.spacing[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
        <View
          style={{
            minWidth: 52,
            paddingVertical: th.spacing[2],
            paddingHorizontal: th.spacing[3],
            borderRadius: th.radius.md,
            backgroundColor: cat.soft,
            alignItems: 'center',
          }}
        >
          <Body
            style={{
              fontFamily: th.font.displayBold,
              fontSize: th.text.lg.fontSize,
              color: cat.ink,
            }}
          >
            {row.score}
          </Body>
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: th.spacing[1] }}>
          <Body style={{ fontFamily: th.font.bodyBold }} numberOfLines={1}>
            {typeName ?? t('assess_type_none')}
          </Body>
          <View style={{ flexDirection: 'row', gap: th.spacing[1], flexWrap: 'wrap' }}>
            <Muted>{dateLabel}</Muted>
            {className ? <Tag>{className}</Tag> : null}
          </View>
        </View>

        <IconButton label={t('edit')} onPress={onEdit}>
          <Pencil size={18} color={th.color.textMuted} />
        </IconButton>
        <IconButton label={t('delete')} onPress={onDelete}>
          <Trash2 size={18} color={th.status.danger} />
        </IconButton>
      </View>
      {row.notes ? <Muted numberOfLines={3}>{row.notes}</Muted> : null}
    </Card>
  );
}

function BehaviorCard({
  row,
  className,
  dateLabel,
  onEdit,
  onDelete,
}: {
  row: BehaviorRecordRow;
  className?: string;
  dateLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const th = useTheme();
  const { t } = useLang();
  const meta = BEHAVIOR_META[row.type as BehaviorTypeId] ?? BEHAVIOR_META.other;

  return (
    <Card flat style={{ padding: th.spacing[4], gap: th.spacing[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
        <View style={{ flex: 1, minWidth: 0, gap: th.spacing[1] }}>
          <View style={{ flexDirection: 'row', gap: th.spacing[1], flexWrap: 'wrap' }}>
            <Tag color={meta.color}>{t(meta.tk)}</Tag>
            {className ? <Tag>{className}</Tag> : null}
          </View>
          <Muted>{dateLabel}</Muted>
        </View>
        <IconButton label={t('edit')} onPress={onEdit}>
          <Pencil size={18} color={th.color.textMuted} />
        </IconButton>
        <IconButton label={t('delete')} onPress={onDelete}>
          <Trash2 size={18} color={th.status.danger} />
        </IconButton>
      </View>
      {row.notes ? <Muted numberOfLines={3}>{row.notes}</Muted> : null}
    </Card>
  );
}

function ScoreForm({
  draft,
  setDraft,
  classes,
  types,
  busy,
  onCancel,
  onSave,
}: {
  draft: Extract<Draft, { kind: 'score' }>;
  setDraft: (d: Draft) => void;
  classes: { value: string; label: string }[];
  types: { value: string; label: string }[];
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const th = useTheme();
  const { t } = useLang();
  const n = Number(draft.score);
  const valid = draft.score !== '' && Number.isFinite(n) && n >= 0 && n <= 10;

  return (
    <Card style={{ gap: th.spacing[4] }}>
      <Heading>{draft.id ? t('assess_edit_score') : t('assess_new_score')}</Heading>

      <DateTimeField
        mode="date"
        label={t('assess_date')}
        value={draft.date}
        onChange={(v) => setDraft({ ...draft, date: v })}
      />
      <Input
        label={t('assess_score')}
        value={draft.score}
        onChangeText={(v) => setDraft({ ...draft, score: v })}
        keyboardType="decimal-pad"
        placeholder="0 – 10"
        error={draft.score !== '' && !valid ? t('assess_score_range') : undefined}
      />
      <ChipSelect
        label={t('class')}
        value={draft.classId}
        onChange={(v) => setDraft({ ...draft, classId: v })}
        options={[{ value: '', label: t('assess_no_class') }, ...classes]}
      />
      <ChipSelect
        label={t('assess_score_label')}
        value={draft.typeId}
        onChange={(v) => setDraft({ ...draft, typeId: v })}
        options={[{ value: '', label: t('assess_type_none') }, ...types]}
      />
      <Input
        label={t('assess_notes')}
        value={draft.notes}
        onChangeText={(v) => setDraft({ ...draft, notes: v })}
        placeholder={t('assess_notes_ph')}
        multiline
        style={{ height: 84, textAlignVertical: 'top', paddingTop: th.spacing[2] }}
      />

      <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
        <Button variant="secondary" style={{ flex: 1 }} onPress={onCancel}>
          {t('cancel')}
        </Button>
        <Button style={{ flex: 1 }} disabled={!valid} loading={busy} onPress={onSave}>
          {t('save')}
        </Button>
      </View>
    </Card>
  );
}

function BehaviorForm({
  draft,
  setDraft,
  classes,
  busy,
  onCancel,
  onSave,
}: {
  draft: Extract<Draft, { kind: 'behavior' }>;
  setDraft: (d: Draft) => void;
  classes: { value: string; label: string }[];
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const th = useTheme();
  const { t } = useLang();

  return (
    <Card style={{ gap: th.spacing[4] }}>
      <Heading>{draft.id ? t('assess_edit_behavior') : t('assess_new_behavior')}</Heading>

      <DateTimeField
        mode="date"
        label={t('assess_date')}
        value={draft.date}
        onChange={(v) => setDraft({ ...draft, date: v })}
      />
      <ChipSelect
        label={t('assess_type')}
        value={draft.type}
        onChange={(v) => setDraft({ ...draft, type: v as BehaviorTypeId })}
        options={BEHAVIOR_TYPES.map((ty) => ({ value: ty, label: t(BEHAVIOR_META[ty].tk) }))}
      />
      <ChipSelect
        label={t('class')}
        value={draft.classId}
        onChange={(v) => setDraft({ ...draft, classId: v })}
        options={[{ value: '', label: t('assess_no_class') }, ...classes]}
      />
      <Input
        label={t('assess_notes')}
        value={draft.notes}
        onChangeText={(v) => setDraft({ ...draft, notes: v })}
        placeholder={t('assess_notes_ph')}
        multiline
        style={{ height: 84, textAlignVertical: 'top', paddingTop: th.spacing[2] }}
      />

      <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
        <Button variant="secondary" style={{ flex: 1 }} onPress={onCancel}>
          {t('cancel')}
        </Button>
        <Button style={{ flex: 1 }} loading={busy} onPress={onSave}>
          {t('save')}
        </Button>
      </View>
    </Card>
  );
}

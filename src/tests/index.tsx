import React from 'react';
import { useLoaderData, useFetcher, useNavigate } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect, PageHeader, Empty, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { isWindowOpen } from '../../shared/logic/tests.js';
import type { TestRow, TestQuestionRow } from '../../server/services/tests.js';
import type { ClassRow } from '../../server/services/classes.js';
import type { GradeLevelRow } from '../../server/services/grade-levels.js';
import type { AssessmentTypeRow } from '../../server/services/assessment-types.js';

const { Card: MC, Button: MBtn, IconButton: MIB, Tag: MTag, Badge: MBadge } = DS;

type Summary = Record<string, { total: number; needsGrading: number; graded: number }>;

interface TestsLoaderData {
  tests: TestRow[];
  links: TestQuestionRow[];
  classes: ClassRow[];
  gradeLevels: GradeLevelRow[];
  types: AssessmentTypeRow[];
  summary: Summary;
}

type NewDraft = {
  title: string;
  mode: 'online' | 'paper';
  classId: string;
  gradeLevelId: string;
  assessmentTypeId: string;
};

const WIN_TK = {
  upcoming: 'tests_win_upcoming',
  open: 'tests_win_open',
  closed: 'tests_win_closed',
} as const;

const WIN_COLOR = { upcoming: 'blue', open: 'green', closed: 'cocoa' } as const;

export function TestsScreen() {
  const { tests, links, classes, gradeLevels, types, summary } = useLoaderData() as TestsLoaderData;
  const fetcher = useFetcher<{ ok?: boolean; error?: string; test?: TestRow }>();
  const navigate = useNavigate();
  const { t } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const [draft, setDraft] = React.useState<NewDraft | null>(null);
  const [fStatus, setFStatus] = React.useState<'all' | 'draft' | 'published'>('all');
  const [fMode, setFMode] = React.useState('');

  // The create action returns the new row; jump straight into its detail page.
  const createdId = fetcher.data?.ok ? fetcher.data.test?.id : undefined;
  React.useEffect(() => {
    if (createdId) navigate(`/tests/${createdId}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdId]);

  const counts = React.useMemo(() => {
    const out: Record<string, { n: number; points: number }> = {};
    for (const l of links) {
      const b = (out[l.testId] ??= { n: 0, points: 0 });
      b.n += 1;
      b.points += l.points;
    }
    return out;
  }, [links]);

  const now = new Date();

  const filtered = tests.filter((x) => {
    if (fStatus !== 'all' && x.status !== fStatus) return false;
    if (fMode && x.mode !== fMode) return false;
    return true;
  });

  const create = (d: NewDraft) => {
    const fd = new FormData();
    fd.set('intent', 'create');
    fd.set('title', d.title.trim() || t('tests_title_ph'));
    fd.set('mode', d.mode);
    fd.set('classId', d.classId);
    fd.set('gradeLevelId', d.gradeLevelId);
    fd.set('assessmentTypeId', d.assessmentTypeId);
    fetcher.submit(fd, { action: '/tests', method: 'post' });
    setDraft(null);
  };

  const del = async (x: TestRow) => {
    if (
      await confirm({
        title: t('tests_delete_confirm'),
        message: x.title,
        confirmLabel: t('delete'),
        danger: true,
      })
    ) {
      const fd = new FormData();
      fd.set('intent', 'delete');
      fd.set('id', x.id);
      fetcher.submit(fd, { action: '/tests', method: 'post' });
    }
  };

  return (
    <div className="content">
      <PageHeader
        title={t('tests_title')}
        subtitle={t('tests_subtitle')}
        actions={
          <MBtn
            variant="primary"
            iconLeft={<MIcon name="plus" size={18} />}
            onClick={() =>
              setDraft({
                title: '',
                mode: 'paper',
                classId: '',
                gradeLevelId: '',
                assessmentTypeId: '',
              })
            }
          >
            {t('tests_add')}
          </MBtn>
        }
      />

      <MC style={{ padding: 14, marginBottom: 16 }}>
        <DS.Tabs
          value={fStatus}
          onChange={(id: string) => setFStatus(id as 'all' | 'draft' | 'published')}
          tabs={[
            { id: 'all', label: t('tests_status_all') },
            { id: 'draft', label: t('tests_status_draft') },
            { id: 'published', label: t('tests_status_published') },
          ]}
        />
        <div style={{ maxWidth: 240, marginTop: 12 }}>
          <MSelect
            label={t('tests_mode_label')}
            value={fMode}
            onChange={setFMode}
            options={[
              { value: '', label: t('tests_mode_all') },
              { value: 'online', label: t('tests_mode_online') },
              { value: 'paper', label: t('tests_mode_paper') },
            ]}
          />
        </div>
      </MC>

      {filtered.length === 0 ? (
        <Empty icon="clipboard" title={t('tests_empty')} />
      ) : (
        <div className="m-grid cols-3">
          {filtered.map((x) => {
            const cls = classes.find((c) => c.id === x.classId);
            const c = counts[x.id] ?? { n: 0, points: 0 };
            const s = summary[x.id] ?? { total: 0, needsGrading: 0, graded: 0 };
            const win = x.status === 'published' && x.mode === 'online';
            const winState = win ? isWindowOpen(x.openAt, x.closeAt, now) : null;
            return (
              <MC key={x.id} interactive style={{ padding: 16 }}>
                <div className="m-spread" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <div
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                    onClick={() => navigate(`/tests/${x.id}`)}
                  >
                    <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-lg)' }}>{x.title}</h3>
                    <div className="m-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {cls && <MTag color={cls.color}>{cls.name}</MTag>}
                      <MBadge color={x.mode === 'online' ? 'blue' : 'orange'}>
                        {t(x.mode === 'online' ? 'tests_mode_online' : 'tests_mode_paper')}
                      </MBadge>
                      <MBadge color={x.status === 'published' ? 'green' : 'cocoa'}>
                        {t(
                          x.status === 'published'
                            ? 'tests_status_published'
                            : 'tests_status_draft',
                        )}
                      </MBadge>
                      {winState && (
                        <MBadge color={WIN_COLOR[winState]}>{t(WIN_TK[winState])}</MBadge>
                      )}
                    </div>
                    <div
                      className="m-muted"
                      style={{ fontSize: 'var(--text-xs)', fontWeight: 700, marginTop: 10 }}
                    >
                      {t('tests_q_count', { n: c.n })} · {t('tests_total_points', { n: c.points })}
                      {x.date ? ` · ${x.date}` : ''}
                    </div>
                    <div
                      className="m-muted"
                      style={{ fontSize: 'var(--text-xs)', fontWeight: 700, marginTop: 4 }}
                    >
                      {x.mode === 'paper'
                        ? t('tests_graded_count', { done: s.graded, total: s.total })
                        : `${t('tests_attempts_count', { n: s.total })} · ${t('tests_needs_grading', { n: s.needsGrading })}`}
                    </div>
                  </div>
                  <div className="lrow__actions" style={{ flexShrink: 0 }}>
                    <MIB label={t('delete')} size="sm" onClick={() => del(x)}>
                      <MIcon name="trash" size={16} />
                    </MIB>
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <MBtn
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(`/tests/${x.id}`)}
                    iconRight={<MIcon name="chevronRight" size={14} />}
                  >
                    {t('tests_open_btn')}
                  </MBtn>
                </div>
              </MC>
            );
          })}
        </div>
      )}

      {draft && (
        <NewTestModal
          draft={draft}
          setDraft={setDraft}
          classes={classes}
          gradeLevels={gradeLevels}
          types={types}
          onClose={() => setDraft(null)}
          onSave={create}
        />
      )}
      {confirmNode}
    </div>
  );
}

interface NewTestModalProps {
  draft: NewDraft;
  setDraft: React.Dispatch<React.SetStateAction<NewDraft | null>>;
  classes: ClassRow[];
  gradeLevels: GradeLevelRow[];
  types: AssessmentTypeRow[];
  onClose: () => void;
  onSave: (d: NewDraft) => void;
}

function NewTestModal({
  draft,
  setDraft,
  classes,
  gradeLevels,
  types,
  onClose,
  onSave,
}: NewTestModalProps) {
  const { t } = useLang();
  const set = <K extends keyof NewDraft>(k: K, v: NewDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <Modal
      open
      onClose={onClose}
      title={t('tests_new_title')}
      width={520}
      footer={
        <>
          <MBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </MBtn>
          <MBtn variant="primary" onClick={() => onSave(draft)}>
            {t('save')}
          </MBtn>
        </>
      }
    >
      <div className="mochi-field">
        <label className="mochi-field__label">{t('tests_title_label')}</label>
        <input
          className="mochi-input"
          autoFocus
          placeholder={t('tests_title_ph')}
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </div>
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <MSelect
          label={t('tests_mode_label')}
          value={draft.mode}
          onChange={(v) => set('mode', v as NewDraft['mode'])}
          options={[
            { value: 'paper', label: t('tests_mode_paper') },
            { value: 'online', label: t('tests_mode_online') },
          ]}
        />
        <MSelect
          label={t('tests_class_label')}
          value={draft.classId}
          onChange={(v) => set('classId', v)}
          options={[
            { value: '', label: t('no_class') },
            ...classes.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <MSelect
          label={t('tests_grade_label')}
          value={draft.gradeLevelId}
          onChange={(v) => set('gradeLevelId', v)}
          options={[
            { value: '', label: t('qb_grade_none') },
            ...gradeLevels
              .filter((g) => g.active || g.id === draft.gradeLevelId)
              .map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
        <MSelect
          label={t('tests_type_label')}
          value={draft.assessmentTypeId}
          onChange={(v) => set('assessmentTypeId', v)}
          options={[
            { value: '', label: t('assess_type_none') },
            ...types
              .filter((x) => x.active || x.id === draft.assessmentTypeId)
              .map((x) => ({ value: x.id, label: x.name })),
          ]}
        />
      </div>
    </Modal>
  );
}

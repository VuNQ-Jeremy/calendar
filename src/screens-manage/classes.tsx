import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, ColorPicker, PageHeader, useConfirm, MSelect } from '../ui.jsx';
import { MaterialSearchDropdown } from '../material-search.jsx';
import { colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import { MAT_TYPES } from '../lib/mat-types.js';
import type { IconName } from '../icons.jsx';
import type { ClassRow } from '../../server/services/classes.js';
import type { StudentRow } from '../../server/services/people.js';
import type { MaterialRow } from '../../server/services/materials.js';
import type { TestRow } from '../../server/services/tests.js';
import type { GradeLevelRow } from '../../server/services/grade-levels.js';
import type { ClassLevelRow } from '../../server/services/class-levels.js';
import type { SubjectRow } from '../../server/services/subjects.js';

const { Card: MC, Button: MBtn, IconButton: MIB, Tag: MTag, Avatar: MAv } = DS;

interface ClassesLoaderData {
  classes: ClassRow[];
  students: StudentRow[];
  materials: MaterialRow[];
  tests: TestRow[];
  gradeLevels: GradeLevelRow[];
  classLevels: ClassLevelRow[];
  subjects: SubjectRow[];
}

type ClassDraft = {
  id?: string;
  name: string;
  subjectId?: string | null;
  color: string;
  gradeLevelId?: string | null;
  classLevelId?: string | null;
  studentIds: string[];
};

export function ClassesScreen() {
  const { classes, students, materials, tests, gradeLevels, classLevels, subjects } =
    useLoaderData() as ClassesLoaderData;
  const fetcher = useFetcher();
  const { t } = useLang();
  const [modal, setModal] = React.useState<ClassDraft | null>(null);
  const [detail, setDetail] = React.useState<ClassRow | null>(null);
  const [confirm, confirmNode] = useConfirm();

  const studentsOf = (c: ClassRow) => students.filter((s) => c.studentIds.includes(s.id));

  // Cohort labels for the cards. Deactivated levels still resolve — a class keeps showing the
  // khối/trình độ it was filed under even after that level is retired from the pickers.
  const gradeName = React.useMemo(
    () => new Map(gradeLevels.map((g) => [g.id, g.name])),
    [gradeLevels],
  );
  const levelName = React.useMemo(
    () => new Map(classLevels.map((c) => [c.id, c.name])),
    [classLevels],
  );
  const subjectName = React.useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);

  const openNew = () =>
    setModal({
      name: '',
      subjectId: null,
      color: 'green',
      gradeLevelId: null,
      classLevelId: null,
      studentIds: [],
    });

  const save = (f: ClassDraft) => {
    const name = f.name.trim() || t('cls_default_name');
    const fd = new FormData();
    fd.set('intent', f.id ? 'update' : 'create');
    if (f.id) fd.set('id', f.id);
    fd.set('name', name);
    fd.set('subjectId', f.subjectId ?? '');
    fd.set('color', f.color || 'green');
    fd.set('gradeLevelId', f.gradeLevelId ?? '');
    fd.set('classLevelId', f.classLevelId ?? '');
    fd.set('studentIds', JSON.stringify(f.studentIds || []));
    fetcher.submit(fd, { action: '/classes', method: 'post' });
    setModal(null);
  };

  const del = async (c: ClassRow) => {
    if (
      await confirm({
        title: t('cls_delete_q'),
        message: t('cls_delete_msg', { name: c.name }),
        confirmLabel: t('delete'),
        danger: true,
      })
    ) {
      const fd = new FormData();
      fd.set('intent', 'delete');
      fd.set('id', c.id);
      fetcher.submit(fd, { action: '/classes', method: 'post' });
    }
  };

  return (
    <div className="content">
      <PageHeader
        title={t('cls_title')}
        subtitle={t('cls_sub')}
        actions={
          <MBtn variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openNew}>
            {t('cls_new')}
          </MBtn>
        }
      />
      <div className="m-grid cols-3">
        {classes.map((c) => {
          const col = colorOf(c.color);
          const roster = studentsOf(c);
          return (
            <MC key={c.id} interactive style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ height: 8, background: col.base }} />
              <div
                style={{ padding: 18, cursor: 'pointer' }}
                onClick={() => setDetail(c)}
                title={t('cls_view_details')}
              >
                <div className="m-spread" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ margin: '0 0 6px', fontSize: 'var(--text-lg)' }}>{c.name}</h3>
                    <div className="m-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <MTag color={c.color}>
                        {subjectName.get(c.subjectId ?? '') || t('cls_general')}
                      </MTag>
                      {gradeName.get(c.gradeLevelId ?? '') && (
                        <MTag color="blue">{gradeName.get(c.gradeLevelId ?? '')}</MTag>
                      )}
                      {levelName.get(c.classLevelId ?? '') && (
                        <MTag color="violet">{levelName.get(c.classLevelId ?? '')}</MTag>
                      )}
                    </div>
                  </div>
                  <div className="lrow__actions" style={{ flexShrink: 0 }}>
                    <MIB
                      label={t('edit')}
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal({ ...c });
                      }}
                    >
                      <MIcon name="edit" size={16} />
                    </MIB>
                    <MIB
                      label={t('delete')}
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        del(c);
                      }}
                    >
                      <MIcon name="trash" size={16} />
                    </MIB>
                  </div>
                </div>
                <div className="m-spread">
                  <div className="avatar-stack">
                    {roster.slice(0, 5).map((s) => (
                      <MAv key={s.id} name={s.name} color={s.color} size="sm" />
                    ))}
                  </div>
                  <span className="m-muted" style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                    {t('cls_students_n', { n: roster.length })}
                  </span>
                </div>
              </div>
            </MC>
          );
        })}
      </div>
      {modal && (
        <ClassModal
          draft={modal}
          setDraft={setModal}
          onClose={() => setModal(null)}
          onSave={save}
          students={students}
          gradeLevels={gradeLevels}
          classLevels={classLevels}
          subjects={subjects}
        />
      )}
      {detail && (
        <ClassDetailModal
          cls={detail}
          classes={classes}
          gradeName={gradeName.get(detail.gradeLevelId ?? '')}
          levelName={levelName.get(detail.classLevelId ?? '')}
          subjectName={subjectName.get(detail.subjectId ?? '')}
          students={students}
          materials={materials}
          tests={tests}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setModal({ ...detail });
            setDetail(null);
          }}
        />
      )}
      {confirmNode}
    </div>
  );
}

interface ClassDetailModalProps {
  cls: ClassRow;
  classes: ClassRow[];
  /** Resolved cohort labels, or undefined when the class has no khối / trình độ set. */
  gradeName?: string;
  levelName?: string;
  subjectName?: string;
  students: StudentRow[];
  materials: MaterialRow[];
  tests: TestRow[];
  onClose: () => void;
  onEdit: () => void;
}

function ClassDetailModal({
  cls,
  classes,
  gradeName,
  levelName,
  subjectName,
  students,
  materials,
  tests,
  onClose,
  onEdit,
}: ClassDetailModalProps) {
  const { t } = useLang();
  const matFetcher = useFetcher();
  const [ov, setOv] = React.useState<
    Record<string, { scope: 'class' | 'event'; classId: string | null }>
  >({});
  const effScope = (m: MaterialRow) => ov[m.id]?.scope ?? m.scope;
  const effClassId = (m: MaterialRow) => (ov[m.id] ? ov[m.id].classId : m.classId);
  const isClassMat = (m: MaterialRow) => effScope(m) === 'class' && effClassId(m) === cls.id;

  const roster = students.filter((s) => cls.studentIds.includes(s.id));
  const clsMaterials = materials.filter(isClassMat);
  const clsTests = tests.filter((x) => x.classId === cls.id && x.status === 'published').length;

  const setScope = (m: MaterialRow, scope: 'class' | 'event', moveToClass = false) => {
    setOv((p) => ({ ...p, [m.id]: { scope, classId: moveToClass ? cls.id : effClassId(m) } }));
    const fd = new FormData();
    fd.set('intent', 'update');
    fd.set('id', m.id);
    fd.set('scope', scope);
    if (moveToClass) fd.set('classId', cls.id);
    matFetcher.submit(fd, { action: '/materials', method: 'post' });
  };
  const attachClass = (m: MaterialRow) => setScope(m, 'class', effClassId(m) !== cls.id);
  const detachClass = (m: MaterialRow) => setScope(m, 'event');

  const Stat = (icon: IconName, label: string, val: number) => (
    <div
      style={{
        flex: 1,
        background: 'var(--surface-sunken)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
      }}
    >
      <div
        className="m-row"
        style={{
          gap: 7,
          color: 'var(--text-muted)',
          fontSize: 'var(--text-xs)',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wide)',
        }}
      >
        <MIcon name={icon} size={14} />
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-xl)',
          color: 'var(--text-strong)',
          marginTop: 2,
        }}
      >
        {val}
      </div>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={cls.name}
      width={600}
      footer={
        <>
          <MBtn variant="secondary" onClick={onClose}>
            {t('close')}
          </MBtn>
          <MBtn variant="primary" iconLeft={<MIcon name="edit" size={16} />} onClick={onEdit}>
            {t('cls_edit_class')}
          </MBtn>
        </>
      }
    >
      <div className="m-row" style={{ gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <MTag color={cls.color}>{subjectName || t('cls_general')}</MTag>
        {gradeName && <MTag color="blue">{gradeName}</MTag>}
        {levelName && <MTag color="violet">{levelName}</MTag>}
      </div>
      <div className="m-row" style={{ gap: 10, marginBottom: 20 }}>
        {Stat('users', t('stat_students'), roster.length)}
        {Stat('clipboard', t('cls_stat_tests'), clsTests)}
        {Stat('folder', t('stat_materials'), clsMaterials.length)}
      </div>
      <div className="mochi-eyebrow" style={{ marginBottom: 8 }}>
        {t('cls_roster_n', { n: roster.length })}
      </div>
      {roster.length ? (
        <div className="m-grid cols-2" style={{ gap: 8, marginBottom: 20 }}>
          {roster.map((s) => (
            <div key={s.id} className="m-row" style={{ gap: 10, padding: '6px 4px' }}>
              <MAv name={s.name} color={s.color} size="sm" />
              <span
                style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-strong)' }}
              >
                {s.name}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
          {t('cls_no_students_assigned')}
        </span>
      )}
      <div className="mochi-eyebrow" style={{ margin: '4px 0 8px' }}>
        {t('cls_materials_n', { n: clsMaterials.length })}
      </div>
      <MaterialSearchDropdown
        items={materials.filter((m) => !isClassMat(m))}
        placeholder={t('ev_mat_search_ph')}
        hint={(m) => {
          const src = effClassId(m);
          return src && src !== cls.id ? (classes.find((c) => c.id === src)?.name ?? '') : '';
        }}
        renderAction={(m) => (
          <MBtn variant="secondary" size="sm" onClick={() => attachClass(m)}>
            {t('mat_btn_add')}
          </MBtn>
        )}
      />
      {clsMaterials.length > 0 && (
        <div className="m-stack" style={{ gap: 6, marginTop: 10 }}>
          {clsMaterials.map((m) => {
            const mt = MAT_TYPES[m.type] ?? MAT_TYPES.notes;
            return (
              <div
                key={m.id}
                className="lrow"
                style={{ border: '1.5px solid var(--border-subtle)' }}
              >
                <MIcon name={mt.icon} size={16} />
                <span style={{ flex: 1 }} className="lrow__title">
                  {m.title}
                </span>
                <MIB label={t('delete')} size="sm" onClick={() => detachClass(m)}>
                  <MIcon name="x" size={14} />
                </MIB>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

interface ClassModalProps {
  draft: ClassDraft;
  setDraft: React.Dispatch<React.SetStateAction<ClassDraft | null>>;
  onClose: () => void;
  onSave: (f: ClassDraft) => void;
  students: StudentRow[];
  gradeLevels: GradeLevelRow[];
  classLevels: ClassLevelRow[];
  subjects: SubjectRow[];
}

function ClassModal({
  draft,
  setDraft,
  onClose,
  onSave,
  students,
  gradeLevels,
  classLevels,
  subjects,
}: ClassModalProps) {
  const { t } = useLang();
  // Both halves of the cohort are required going forward. Legacy classes stored NULLs, so
  // editing one now forces a choice before anything else can be saved — deliberate backfill.
  const cohortSet = Boolean(draft.gradeLevelId && draft.classLevelId);
  const set = <K extends keyof ClassDraft>(k: K, v: ClassDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  const toggleStudent = (id: string) =>
    set(
      'studentIds',
      draft.studentIds.includes(id)
        ? draft.studentIds.filter((x) => x !== id)
        : [...draft.studentIds, id],
    );

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.id ? t('cls_edit_class') : t('cls_new_class')}
      width={600}
      footer={
        <>
          <MBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </MBtn>
          <MBtn variant="primary" disabled={!cohortSet} onClick={() => onSave(draft)}>
            {t('cls_save')}
          </MBtn>
        </>
      }
    >
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('cls_name')}</label>
          <input
            className="mochi-input"
            autoFocus
            placeholder={t('cls_name_ph')}
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <MSelect
          label={t('cls_subject')}
          value={draft.subjectId ?? ''}
          onChange={(v: string) => set('subjectId', v || null)}
          options={[
            { value: '', label: t('cls_general') },
            ...subjects
              .filter((s) => s.active || s.id === draft.subjectId)
              .map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
      </div>
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <MSelect
          label={t('cls_grade')}
          value={draft.gradeLevelId ?? ''}
          onChange={(v: string) => set('gradeLevelId', v || null)}
          options={[
            { value: '', label: t('cls_pick_one') },
            ...gradeLevels
              .filter((g) => g.active || g.id === draft.gradeLevelId)
              .map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
        <MSelect
          label={t('cls_level')}
          value={draft.classLevelId ?? ''}
          onChange={(v: string) => set('classLevelId', v || null)}
          options={[
            { value: '', label: t('cls_pick_one') },
            ...classLevels
              .filter((c) => c.active || c.id === draft.classLevelId)
              .map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      </div>
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <ColorPicker label={t('color')} value={draft.color} onChange={(v) => set('color', v)} />
      </div>
      <hr className="divider" />
      <label className="mochi-field__label">
        {t('cls_roster_assigned', { n: draft.studentIds.length })}
      </label>
      <div className="m-grid cols-2" style={{ gap: 8, marginTop: 8 }}>
        {students.map((s) => {
          const on = draft.studentIds.includes(s.id);
          return (
            <button
              key={s.id}
              onClick={() => toggleStudent(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1.5px solid',
                borderColor: on ? 'var(--brand)' : 'var(--border-subtle)',
                background: on ? 'var(--brand-soft)' : 'var(--surface-card)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
              }}
            >
              <MAv name={s.name} color={s.color} size="sm" />
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-strong)',
                  flex: 1,
                }}
              >
                {s.name}
              </span>
              {on && <MIcon name="check" size={16} style={{ color: 'var(--brand-soft-ink)' }} />}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, ColorPicker, PageHeader, useConfirm } from '../ui.jsx';
import { colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import type { IconName } from '../icons.jsx';
import type { ClassRow } from '../../server/services/classes.js';
import type { StudentRow } from '../../server/services/people.js';
import type { MaterialRow } from '../../server/services/materials.js';
import type { HomeworkRow } from '../../server/services/homework.js';

const { Card: MC, Button: MBtn, IconButton: MIB, Tag: MTag, Avatar: MAv } = DS;

interface ClassesLoaderData {
  classes: ClassRow[];
  students: StudentRow[];
  materials: MaterialRow[];
  homework: HomeworkRow[];
}

type ClassDraft = {
  id?: string;
  name: string;
  subject?: string | null;
  color: string;
  room?: string | null;
  studentIds: string[];
};

export function ClassesScreen() {
  const { classes, students, materials, homework } = useLoaderData() as ClassesLoaderData;
  const fetcher = useFetcher();
  const { t } = useLang();
  const [modal, setModal] = React.useState<ClassDraft | null>(null);
  const [detail, setDetail] = React.useState<ClassRow | null>(null);
  const [confirm, confirmNode] = useConfirm();

  const studentsOf = (c: ClassRow) => students.filter((s) => c.studentIds.includes(s.id));

  const openNew = () =>
    setModal({ name: '', subject: '', color: 'green', room: '', studentIds: [] });

  const save = (f: ClassDraft) => {
    const name = f.name.trim() || t('cls_default_name');
    const fd = new FormData();
    fd.set('intent', f.id ? 'update' : 'create');
    if (f.id) fd.set('id', f.id);
    fd.set('name', name);
    if (f.subject) fd.set('subject', f.subject);
    fd.set('color', f.color || 'green');
    if (f.room) fd.set('room', f.room);
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
                    <MTag color={c.color}>{c.subject || t('cls_general')}</MTag>
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
                <div className="lrow__meta" style={{ margin: '14px 0' }}>
                  <span className="m-row" style={{ gap: 5 }}>
                    <MIcon name="mapPin" size={14} />
                    {c.room || t('cls_no_room')}
                  </span>
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
        />
      )}
      {detail && (
        <ClassDetailModal
          cls={detail}
          students={students}
          materials={materials}
          homework={homework}
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
  students: StudentRow[];
  materials: MaterialRow[];
  homework: HomeworkRow[];
  onClose: () => void;
  onEdit: () => void;
}

function ClassDetailModal({
  cls,
  students,
  materials,
  homework,
  onClose,
  onEdit,
}: ClassDetailModalProps) {
  const { t } = useLang();
  const roster = students.filter((s) => cls.studentIds.includes(s.id));
  const clsMaterials = materials.filter((m) => m.classId === cls.id);
  const clsHomework = homework.filter((h) => h.classId === cls.id);
  const openHw = clsHomework.filter((h) => !h.done).length;

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
      <div className="m-row" style={{ gap: 10, marginBottom: 16 }}>
        <MTag color={cls.color}>{cls.subject || t('cls_general')}</MTag>
        <span className="m-row m-muted" style={{ gap: 5, fontSize: 'var(--text-sm)' }}>
          <MIcon name="mapPin" size={14} />
          {cls.room || t('cls_no_room')}
        </span>
      </div>
      <div className="m-row" style={{ gap: 10, marginBottom: 20 }}>
        {Stat('users', t('stat_students'), roster.length)}
        {Stat('clipboard', t('cls_stat_openwork'), openHw)}
        {Stat('folder', t('stat_materials'), clsMaterials.length)}
      </div>
      <div className="mochi-eyebrow" style={{ marginBottom: 8 }}>
        {t('cls_roster_n', { n: roster.length })}
      </div>
      {roster.length ? (
        <div
          className="m-grid cols-2"
          style={{ gap: 8, marginBottom: clsMaterials.length ? 20 : 0 }}
        >
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
      {clsMaterials.length > 0 && (
        <>
          <div className="mochi-eyebrow" style={{ margin: '4px 0 8px' }}>
            {t('cls_materials_n', { n: clsMaterials.length })}
          </div>
          <div className="tablebar">
            {clsMaterials.map((m) => (
              <span key={m.id} className="mchip">
                <MIcon
                  name={m.type === 'link' ? 'link' : m.type === 'video' ? 'video' : 'file'}
                  size={12}
                />
                {m.title}
              </span>
            ))}
          </div>
        </>
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
}

function ClassModal({ draft, setDraft, onClose, onSave, students }: ClassModalProps) {
  const { t } = useLang();
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
          <MBtn variant="primary" onClick={() => onSave(draft)}>
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
        <div className="mochi-field">
          <label className="mochi-field__label">{t('cls_subject')}</label>
          <input
            className="mochi-input"
            placeholder={t('cls_subject_ph')}
            value={draft.subject ?? ''}
            onChange={(e) => set('subject', e.target.value)}
          />
        </div>
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

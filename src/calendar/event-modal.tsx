import React from 'react';
import { useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect, MDatePicker, MTimePicker, ColorPicker, Empty } from '../ui.jsx';
import { colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import { ATTENDANCE_META, ATTENDANCE_STATUSES, type AttendanceStatusId } from '../lib/assess.js';
import { MAT_TYPES } from '../lib/mat-types.js';
import { HomeworkTab } from './homework-tab.jsx';
import type { ClassRow } from '../../server/services/classes.js';
import type { EventRow } from '../../server/services/events.js';
import type { StudentRow } from '../../server/services/people.js';
import type { AttendanceRow } from '../../server/services/attendance.js';
import type { MaterialRow } from '../../server/services/materials.js';

const { Button: CBtn, Tabs: CTabs } = DS;

type EventDraft = Partial<EventRow> & { recurrence?: string };

interface EventModalProps {
  open: boolean;
  onClose: () => void;
  draft: EventDraft | null;
  onSave: (f: EventDraft) => void;
  onDelete: (id: string) => void;
  classes: ClassRow[];
  students: StudentRow[];
  materials: MaterialRow[];
}

interface AttendanceTabProps {
  eventId: string;
  date: string;
  classId: string;
  classes: ClassRow[];
  students: StudentRow[];
}

function AttendanceTab({ eventId, date, classId, classes, students }: AttendanceTabProps) {
  const { t } = useLang();
  const loadFetcher = useFetcher<{ records: AttendanceRow[] }>();
  const saveFetcher = useFetcher<{ ok: boolean }>();
  const [marks, setMarks] = React.useState<Record<string, AttendanceStatusId>>({});

  React.useEffect(() => {
    loadFetcher.load(
      `/attendance?eventId=${encodeURIComponent(eventId)}&date=${encodeURIComponent(date)}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, date]);

  React.useEffect(() => {
    if (!loadFetcher.data) return;
    const seeded: Record<string, AttendanceStatusId> = {};
    for (const r of loadFetcher.data.records) {
      seeded[r.studentId] = r.status as AttendanceStatusId;
    }
    setMarks(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFetcher.data]);

  const roster = (classes.find((c) => c.id === classId)?.studentIds ?? [])
    .map((sid) => students.find((s) => s.id === sid))
    .filter((s): s is StudentRow => !!s);

  const persist = (next: Record<string, AttendanceStatusId>) => {
    const fd = new FormData();
    fd.set('intent', 'save');
    fd.set('eventId', eventId);
    fd.set('date', date);
    fd.set(
      'records',
      JSON.stringify(Object.entries(next).map(([studentId, status]) => ({ studentId, status }))),
    );
    saveFetcher.submit(fd, { action: '/attendance', method: 'post' });
  };

  const setMark = (studentId: string, status: AttendanceStatusId) => {
    const next = { ...marks };
    if (next[studentId] === status) delete next[studentId];
    else next[studentId] = status;
    setMarks(next);
    persist(next);
  };

  const markAllPresent = () => {
    const next: Record<string, AttendanceStatusId> = { ...marks };
    for (const s of roster) next[s.id] = 'present';
    setMarks(next);
    persist(next);
  };

  if (!roster.length) {
    return <Empty icon="users" title={t('att_empty_roster')} />;
  }

  return (
    <div className="m-stack">
      <div className="m-row" style={{ justifyContent: 'flex-end', gap: 10 }}>
        {saveFetcher.data?.ok && saveFetcher.state === 'idle' && (
          <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('att_saved')}
          </span>
        )}
        <CBtn variant="secondary" size="sm" onClick={markAllPresent}>
          {t('att_mark_all')}
        </CBtn>
      </div>
      {roster.map((s) => (
        <div key={s.id} className="lrow">
          <div style={{ flex: 1 }} className="lrow__title">
            {s.name}
          </div>
          <div className="m-row" style={{ gap: 6 }}>
            {ATTENDANCE_STATUSES.map((st) => {
              const active = marks[s.id] === st;
              const c = colorOf(ATTENDANCE_META[st].color);
              return (
                <button
                  key={st}
                  type="button"
                  className="mchip"
                  style={{
                    background: active ? c.base : c.soft,
                    color: active ? '#fff' : c.ink,
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: 'none',
                  }}
                  onClick={() => setMark(s.id, st)}
                >
                  {t(ATTENDANCE_META[st].tk)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

interface EventMaterialsPickerProps {
  eventId: string;
  classId: string;
  materials: MaterialRow[];
}

function EventMaterialsPicker({ eventId, classId, materials }: EventMaterialsPickerProps) {
  const { t } = useLang();
  const loadFetcher = useFetcher<{ materialIds: string[] }>();
  const saveFetcher = useFetcher();
  const [ids, setIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    loadFetcher.load(`/event-materials?eventId=${encodeURIComponent(eventId)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  React.useEffect(() => {
    if (loadFetcher.data) setIds(loadFetcher.data.materialIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFetcher.data]);

  const classMats = materials
    .filter((m) => m.classId === classId)
    .sort((a, b) => Number(b.type === 'curriculum') - Number(a.type === 'curriculum'));

  const toggle = (materialId: string) => {
    const next = ids.includes(materialId)
      ? ids.filter((x) => x !== materialId)
      : [...ids, materialId];
    setIds(next);
    const fd = new FormData();
    fd.set('intent', 'save');
    fd.set('eventId', eventId);
    fd.set('materialIds', JSON.stringify(next));
    saveFetcher.submit(fd, { action: '/event-materials', method: 'post' });
  };

  return (
    <div className="mochi-field">
      <label className="mochi-field__label">{t('ev_materials')}</label>
      {classMats.length ? (
        <div className="m-stack" style={{ gap: 6 }}>
          {classMats.map((m) => {
            const on = ids.includes(m.id);
            const mt = MAT_TYPES[m.type] ?? MAT_TYPES.notes;
            return (
              <button
                key={m.id}
                type="button"
                className="lrow"
                onClick={() => toggle(m.id)}
                style={{
                  cursor: 'pointer',
                  textAlign: 'left',
                  border: on ? '1.5px solid var(--brand)' : '1.5px solid var(--border-subtle)',
                  background: 'transparent',
                }}
              >
                <MIcon name={on ? 'check' : mt.icon} size={16} />
                <span style={{ flex: 1 }} className="lrow__title">
                  {m.title}
                </span>
                <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
                  {t(mt.tk)}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
          {t('ev_materials_empty')}
        </span>
      )}
    </div>
  );
}

export function EventModal({
  open,
  onClose,
  draft,
  onSave,
  onDelete,
  classes,
  students,
  materials,
}: EventModalProps) {
  const { t } = useLang();
  const [f, setF] = React.useState<EventDraft>(draft || {});
  const [tab, setTab] = React.useState<'details' | 'attendance' | 'homework'>('details');
  React.useEffect(() => {
    setF(draft || {});
    setTab('details');
  }, [draft, open]);
  if (!open) return null;
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const isNew = !f.id;
  const classOpts = [
    { value: '', label: t('ev_class_personal') },
    ...classes.map((c) => ({ value: c.id, label: c.name })),
  ];
  const showTabs = !isNew && !!f.classId;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? t('ev_new') : t('ev_edit')}
      width={540}
      size={isNew ? 'default' : 'full'}
      footer={
        tab === 'details' ? (
          <>
            {!isNew && (
              <CBtn
                variant="danger"
                onClick={() => onDelete(f.id!)}
                iconLeft={<MIcon name="trash" size={16} />}
              >
                {t('delete')}
              </CBtn>
            )}
            <span style={{ flex: 1 }} />
            <CBtn variant="secondary" onClick={onClose}>
              {t('cancel')}
            </CBtn>
            <CBtn variant="primary" onClick={() => onSave(f)}>
              {isNew ? t('ev_add') : t('save')}
            </CBtn>
          </>
        ) : (
          <>
            <span style={{ flex: 1 }} />
            <CBtn variant="secondary" onClick={onClose}>
              {t('cancel')}
            </CBtn>
          </>
        )
      }
    >
      {showTabs && (
        <CTabs
          value={tab}
          onChange={(id: string) => setTab(id as 'details' | 'attendance' | 'homework')}
          tabs={[
            { id: 'details', label: t('ev_details') },
            { id: 'attendance', label: t('att_tab') },
            { id: 'homework', label: t('hw_tab') },
          ]}
        />
      )}

      {tab === 'attendance' && showTabs ? (
        <div className="evm-pane-scroll">
          <AttendanceTab
            eventId={f.id!}
            date={f.date || ''}
            classId={f.classId || ''}
            classes={classes}
            students={students}
          />
        </div>
      ) : tab === 'homework' && showTabs ? (
        <HomeworkTab
          eventId={f.id!}
          classId={f.classId || ''}
          classes={classes}
          students={students}
          materials={materials}
        />
      ) : (
        <div className="evm-pane-scroll">
          <div
            className={showTabs ? 'm-grid cols-2' : ''}
            style={showTabs ? { gap: 24, alignItems: 'start' } : undefined}
          >
            <div>
              <div className="mochi-field">
                <label className="mochi-field__label">{t('ev_title')}</label>
                <input
                  className="mochi-input"
                  placeholder={t('ev_title_ph')}
                  value={f.title || ''}
                  autoFocus
                  onChange={(e) => set('title', e.target.value)}
                />
              </div>
              <div className="m-grid cols-3" style={{ gap: 14 }}>
                <MDatePicker
                  label={t('ev_date')}
                  value={f.date || ''}
                  onChange={(v) => set('date', v)}
                />
                <MTimePicker
                  label={t('ev_start')}
                  value={f.start || ''}
                  onChange={(v) => set('start', v)}
                />
                <MTimePicker
                  label={t('ev_end')}
                  value={f.end || ''}
                  onChange={(v) => set('end', v)}
                />
              </div>
              <div className="m-grid cols-2" style={{ gap: 14 }}>
                <MSelect
                  label={t('class')}
                  value={f.classId || ''}
                  onChange={(v) => {
                    set('classId', v);
                    const c = classes.find((x) => x.id === v);
                    if (c) set('color', c.color);
                  }}
                  options={classOpts}
                />
                <MSelect
                  label={t('ev_repeat')}
                  value={f.recurrence || 'none'}
                  onChange={(v) => set('recurrence', v)}
                  options={[
                    { value: 'none', label: t('ev_repeat_none') },
                    { value: 'daily', label: t('ev_repeat_daily') },
                    { value: 'weekly', label: t('ev_repeat_weekly') },
                  ]}
                />
              </div>
              <div className="mochi-field">
                <label className="mochi-field__label">{t('ev_location')}</label>
                <input
                  className="mochi-input"
                  placeholder={t('ev_location_ph')}
                  value={f.location || ''}
                  onChange={(e) => set('location', e.target.value)}
                />
              </div>
              <ColorPicker
                label={t('color')}
                value={f.color || 'orange'}
                onChange={(v) => set('color', v)}
              />
            </div>
            <div>
              <div className="mochi-field">
                <label className="mochi-field__label">{t('ev_notes')}</label>
                <textarea
                  className="mochi-input"
                  rows={6}
                  placeholder={t('ev_notes_ph')}
                  value={f.notes || ''}
                  onChange={(e) => set('notes', e.target.value)}
                  style={{ resize: 'vertical', minHeight: 120 }}
                />
              </div>
              {showTabs && (
                <EventMaterialsPicker eventId={f.id!} classId={f.classId!} materials={materials} />
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

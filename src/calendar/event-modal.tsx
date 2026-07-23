import React from 'react';
import { createPortal } from 'react-dom';
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

const { Button: CBtn, Tabs: CTabs, IconButton: CIBtn } = DS;

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
  eventMaterials: { eventId: string; materialId: string }[];
  events: EventRow[];
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
  classes: ClassRow[];
  materials: MaterialRow[];
  eventMaterials: { eventId: string; materialId: string }[];
  events: EventRow[];
}

function EventMaterialsPicker({
  eventId,
  classId,
  classes,
  materials,
  eventMaterials,
  events,
}: EventMaterialsPickerProps) {
  const { t } = useLang();
  const loadFetcher = useFetcher<{ materialIds: string[] }>();
  const saveFetcher = useFetcher();
  const [ids, setIds] = React.useState<string[]>([]);

  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const fieldRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    loadFetcher.load(`/event-materials?eventId=${encodeURIComponent(eventId)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  React.useEffect(() => {
    if (loadFetcher.data) setIds(loadFetcher.data.materialIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFetcher.data]);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const el = e.target as Node;
      if (wrapRef.current?.contains(el) || menuRef.current?.contains(el)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = fieldRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const isClassMat = (m: MaterialRow) => m.scope === 'class' && m.classId === classId;
  const classMats = materials.filter(isClassMat);
  const attachedMats = ids
    .map((id) => materials.find((m) => m.id === id))
    .filter((m): m is MaterialRow => !!m && !isClassMat(m));
  const ql = q.trim().toLowerCase();
  const pool = materials.filter(
    (m) =>
      !isClassMat(m) &&
      !ids.includes(m.id) &&
      (ql === '' || m.title.toLowerCase().includes(ql)),
  );

  const saveJoin = (next: string[]) => {
    setIds(next);
    const fd = new FormData();
    fd.set('intent', 'save');
    fd.set('eventId', eventId);
    fd.set('materialIds', JSON.stringify(next));
    saveFetcher.submit(fd, { action: '/event-materials', method: 'post' });
  };

  const pickEvent = (m: MaterialRow) => {
    if (!ids.includes(m.id)) saveJoin([...ids, m.id]);
  };

  const detachEvent = (materialId: string) => {
    saveJoin(ids.filter((x) => x !== materialId));
  };

  const usageLabel = (m: MaterialRow) => {
    const otherDates = eventMaterials
      .filter((em) => em.materialId === m.id && em.eventId !== eventId)
      .map((em) => events.find((e) => e.id === em.eventId)?.date)
      .filter((d): d is string => !!d)
      .sort();
    const latest = otherDates[otherDates.length - 1];
    if (!latest) return '';
    const [y, mo, d] = latest.split('-');
    return t('ev_mat_used_on', { date: `${d}/${mo}/${y.slice(2)}` });
  };

  if (!materials.length) {
    return (
      <div className="mochi-field">
        <label className="mochi-field__label">{t('ev_materials')}</label>
        <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
          {t('ev_materials_empty')}
        </span>
      </div>
    );
  }

  return (
    <div className="mochi-field">
      <label className="mochi-field__label">{t('ev_materials')}</label>
      <div className="tokensearch" ref={wrapRef}>
        <div className="tokensearch__field" ref={fieldRef}>
          <MIcon name="search" size={17} />
          <input
            className="tokensearch__input"
            placeholder={t('ev_mat_search_ph')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
        </div>
        {open &&
          pos &&
          createPortal(
            <div
              ref={menuRef}
              className="tokensearch__menu"
              style={{ top: pos.top, left: pos.left, width: pos.width }}
            >
              {pool.length > 0 ? (
                pool.slice(0, 8).map((m) => {
                  const mt = MAT_TYPES[m.type] ?? MAT_TYPES.notes;
                  const srcClass =
                    m.classId && m.classId !== classId
                      ? (classes.find((c) => c.id === m.classId)?.name ?? '')
                      : '';
                  const hint = [srcClass, usageLabel(m)].filter(Boolean).join(' · ');
                  return (
                    <div key={m.id} className="tokensearch__opt" style={{ cursor: 'default' }}>
                      <MIcon name={mt.icon} size={16} />
                      <span style={{ flex: 1, textAlign: 'left' }}>
                        {m.title}
                        {hint && (
                          <span
                            className="m-muted"
                            style={{ fontSize: 'var(--text-sm)', marginLeft: 6 }}
                          >
                            {hint}
                          </span>
                        )}
                      </span>
                      <CBtn variant="secondary" size="sm" onClick={() => pickEvent(m)}>
                        {t('ev_mat_btn_event')}
                      </CBtn>
                    </div>
                  );
                })
              ) : (
                <div className="tokensearch__empty">
                  {ql ? t('ts_no_match', { q }) : t('ts_nothing_left')}
                </div>
              )}
            </div>,
            document.body,
          )}
      </div>
      {classMats.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="m-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 6 }}>
            {t('ev_mat_class_group')}
          </div>
          <div className="m-stack" style={{ gap: 6 }}>
            {classMats.map((m) => {
              const mt = MAT_TYPES[m.type] ?? MAT_TYPES.notes;
              return (
                <div key={m.id} className="lrow" style={{ border: '1.5px solid var(--border-subtle)' }}>
                  <MIcon name={mt.icon} size={16} />
                  <span style={{ flex: 1 }} className="lrow__title">
                    {m.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {attachedMats.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="m-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 6 }}>
            {t('ev_mat_event_group')}
          </div>
          <div className="m-stack" style={{ gap: 6 }}>
            {attachedMats.map((m) => {
              const mt = MAT_TYPES[m.type] ?? MAT_TYPES.notes;
              return (
                <div key={m.id} className="lrow" style={{ border: '1.5px solid var(--brand)' }}>
                  <MIcon name={mt.icon} size={16} />
                  <span style={{ flex: 1 }} className="lrow__title">
                    {m.title}
                  </span>
                  <CIBtn label={t('delete')} size="sm" onClick={() => detachEvent(m.id)}>
                    <MIcon name="x" size={14} />
                  </CIBtn>
                </div>
              );
            })}
          </div>
        </div>
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
  eventMaterials,
  events,
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
                <EventMaterialsPicker
                  eventId={f.id!}
                  classId={f.classId!}
                  classes={classes}
                  materials={materials}
                  eventMaterials={eventMaterials}
                  events={events}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

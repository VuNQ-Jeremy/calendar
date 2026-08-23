import React from 'react';
import { useFetcher } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect, MDatePicker, MTimePicker, ColorPicker, Empty } from '../ui.jsx';
import { colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import { ATTENDANCE_META, ATTENDANCE_STATUSES, type AttendanceStatusId } from '../lib/assess.js';
import { MAT_TYPES } from '../lib/mat-types.js';
import { MaterialsTab } from './materials-tab.jsx';
import { MaterialSearchDropdown } from '../material-search.jsx';
import { useCachedLoad } from '../lib/use-cached-load.js';
import { cacheSet, markStale } from '../lib/cache.js';
import { noteLocalMutation } from '../lib/route-cache.js';
import { KioskModal } from '../kiosk/kiosk.jsx';
import { nextOccurrenceDate } from '../../shared/logic/checkin.js';
import type { CheckPhase } from '../../shared/logic/checkin.js';
import type { ClassRow } from '../../server/services/classes.js';
import type { EventRow } from '../../server/services/events.js';
import type { StudentRow } from '../../server/services/people.js';
import type { AttendanceRow } from '../../server/services/attendance.js';
import type { SessionPreviewRow } from '../../server/services/session-preview.js';
import type { MaterialRow } from '../../server/services/materials.js';
import type { ChecklistItemRow, CheckRow, OccurrenceFlags } from '../../server/services/checkin.js';
import type { ActivityTypeRow } from '../../server/services/checkin-activity-types.js';
import type { VocabAssignmentRow } from '../../server/services/garden.js';
import { AssignModal } from '../garden/assign-modal.jsx';

const { Button: CBtn, Tabs: CTabs, IconButton: CIBtn } = DS;

type EventDraft = Partial<EventRow> & { recurrence?: string };

type EventModalTab = 'details' | 'attendance' | 'materials' | 'preview' | 'checkin';

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
  classMaterials: { classId: string; materialId: string }[];
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
  const attKey = `att:${eventId}:${date}`;
  const { data } = useCachedLoad<{ records: AttendanceRow[] }>(
    attKey,
    `/attendance?eventId=${encodeURIComponent(eventId)}&date=${encodeURIComponent(date)}`,
  );
  const saveFetcher = useFetcher<{ ok: boolean; records: AttendanceRow[] }>();
  const [marks, setMarks] = React.useState<Record<string, AttendanceStatusId>>({});

  React.useEffect(() => {
    if (!data) return;
    const seeded: Record<string, AttendanceStatusId> = {};
    for (const r of data.records) {
      seeded[r.studentId] = r.status as AttendanceStatusId;
    }
    setMarks(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    if (saveFetcher.data?.ok && saveFetcher.data.records) {
      cacheSet(attKey, { records: saveFetcher.data.records });
      // The save response IS the fresh state, so ignore the server's broadcast
      // of our own write rather than refetching it.
      noteLocalMutation('attendance');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.data]);

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

type PreviewPayload = {
  preview: SessionPreviewRow | null;
  topics: { id: string; name: string }[];
};

/**
 * "Buổi sau" — what this ONE occurrence will cover, and which vocabulary to revise.
 *
 * Keyed on (eventId, date) like the attendance tab beside it: a weekly class is a single event
 * row, so anything written here has to belong to the instance the teacher clicked, not the series
 * (that is what the Details tab's Notes field is for).
 *
 * Saved on a button rather than on every keystroke, unlike attendance — this is prose, and
 * autosaving prose means saving half-written sentences into something a parent may be reading.
 */
function PreviewTab({ eventId, date }: { eventId: string; date: string }) {
  const { t } = useLang();
  const prevKey = `prev:${eventId}:${date}`;
  const { data } = useCachedLoad<PreviewPayload>(
    prevKey,
    `/event-previews?eventId=${encodeURIComponent(eventId)}&date=${encodeURIComponent(date)}`,
  );
  const saveFetcher = useFetcher<{ ok: boolean; preview: SessionPreviewRow }>();
  const [focusText, setFocusText] = React.useState('');
  const [vocabTopicId, setVocabTopicId] = React.useState('');
  const [homeworkText, setHomeworkText] = React.useState('');

  React.useEffect(() => {
    if (!data) return;
    setFocusText(data.preview?.focusText ?? '');
    setVocabTopicId(data.preview?.vocabTopicId ?? '');
    setHomeworkText(data.preview?.homeworkText ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  React.useEffect(() => {
    if (saveFetcher.data?.ok && saveFetcher.data.preview) {
      cacheSet(prevKey, { preview: saveFetcher.data.preview, topics: data?.topics ?? [] });
      // The save response IS the fresh state, so ignore the server's broadcast of our own write.
      noteLocalMutation('previews');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.data]);

  const save = () => {
    const fd = new FormData();
    fd.set('intent', 'save');
    fd.set('eventId', eventId);
    fd.set('date', date);
    fd.set('focusText', focusText);
    fd.set('vocabTopicId', vocabTopicId);
    fd.set('homeworkText', homeworkText);
    saveFetcher.submit(fd, { action: '/event-previews', method: 'post' });
  };

  const topicOpts = [
    { value: '', label: t('prev_vocab_none') },
    ...(data?.topics ?? []).map((x) => ({ value: x.id, label: x.name })),
  ];
  return (
    <div className="m-stack">
      <div className="mochi-field">
        <label className="mochi-field__label">{t('prev_focus_label')}</label>
        <textarea
          className="mochi-input"
          rows={5}
          placeholder={t('prev_focus_ph')}
          value={focusText}
          onChange={(e) => setFocusText(e.target.value)}
          style={{ resize: 'vertical', minHeight: 110 }}
        />
      </div>
      <div className="mochi-field">
        <label className="mochi-field__label">{t('prev_homework_label')}</label>
        <textarea
          className="mochi-input"
          rows={2}
          placeholder={t('prev_homework_ph')}
          value={homeworkText}
          onChange={(e) => setHomeworkText(e.target.value)}
          style={{ resize: 'vertical', minHeight: 56 }}
        />
      </div>
      <MSelect
        label={t('prev_vocab_label')}
        value={vocabTopicId}
        onChange={setVocabTopicId}
        options={topicOpts}
      />
      <p className="m-muted" style={{ fontSize: 'var(--text-sm)', margin: 0 }}>
        {t('prev_tests_auto')}
      </p>
      <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
        <CBtn variant="primary" size="sm" onClick={save} disabled={saveFetcher.state !== 'idle'}>
          {t('save')}
        </CBtn>
        {saveFetcher.data?.ok && saveFetcher.state === 'idle' && (
          <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('prev_saved')}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <a
          className="m-textlink"
          href={`/session-preview/${encodeURIComponent(eventId)}/${encodeURIComponent(date)}/print`}
          target="_blank"
          rel="noreferrer"
        >
          {t('prev_make_image')}
        </a>
      </div>
    </div>
  );
}

interface EventMaterialsPickerProps {
  eventId: string;
  classId: string;
  classes: ClassRow[];
  materials: MaterialRow[];
  eventMaterials: { eventId: string; materialId: string }[];
  classMaterials: { classId: string; materialId: string }[];
  events: EventRow[];
}

function EventMaterialsPicker({
  eventId,
  classId,
  classes,
  materials,
  eventMaterials,
  classMaterials,
  events,
}: EventMaterialsPickerProps) {
  const { t } = useLang();
  const evmatKey = `evmat:${eventId}`;
  const { data } = useCachedLoad<{ materialIds: string[] }>(
    evmatKey,
    `/event-materials?eventId=${encodeURIComponent(eventId)}`,
  );
  const saveFetcher = useFetcher();
  const [ids, setIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (data) setIds(data.materialIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // A material belongs to this event's class through the join — and may belong to other classes
  // too, which is fine: it simply shows under each of them.
  const classMatIds = React.useMemo(
    () => new Set(classMaterials.filter((l) => l.classId === classId).map((l) => l.materialId)),
    [classMaterials, classId],
  );
  const isClassMat = (m: MaterialRow) => classMatIds.has(m.id);
  const classMats = materials.filter(isClassMat);
  const attachedMats = ids
    .map((id) => materials.find((m) => m.id === id))
    .filter((m): m is MaterialRow => !!m && !isClassMat(m));
  const candidates = materials.filter((m) => !isClassMat(m) && !ids.includes(m.id));

  const saveJoin = (next: string[]) => {
    setIds(next);
    cacheSet(evmatKey, { materialIds: next });
    // Stale, not invalidate: the calendar keeps rendering instantly and
    // refreshes its 6-query loader in the background.
    markStale('route:calendar');
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
      <MaterialSearchDropdown
        items={candidates}
        placeholder={t('ev_mat_search_ph')}
        hint={(m) => {
          const srcClasses = classMaterials
            .filter((l) => l.materialId === m.id && l.classId !== classId)
            .map((l) => classes.find((c) => c.id === l.classId)?.name)
            .filter(Boolean)
            .join(' · ');
          return [srcClasses, usageLabel(m)].filter(Boolean).join(' · ');
        }}
        renderAction={(m) => (
          <CBtn variant="secondary" size="sm" onClick={() => pickEvent(m)}>
            {t('mat_btn_add')}
          </CBtn>
        )}
      />
      {classMats.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="m-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 6 }}>
            {t('ev_mat_class_group')}
          </div>
          <div className="m-stack" style={{ gap: 6 }}>
            {classMats.map((m) => {
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

type CheckinPayload = {
  items: ChecklistItemRow[];
  checks: CheckRow[];
  activityTypes: ActivityTypeRow[];
  flags: OccurrenceFlags;
  openAssignments?: VocabAssignmentRow[];
};

/**
 * One phase's editable list for one occurrence: activity-type picker (check-in) or free
 * label (check-out), add/remove rows. Edits submit item-level intents to /checkin.
 */
function ChecklistItemsEditor({
  eventId,
  date,
  phase,
  items,
  activityTypes,
  onMutated,
}: {
  eventId: string;
  date: string;
  phase: 'checkin' | 'checkout';
  items: ChecklistItemRow[];
  activityTypes: ActivityTypeRow[];
  onMutated: () => void;
}) {
  const { t } = useLang();
  const fetcher = useFetcher();
  const submit = (fd: FormData) => fetcher.submit(fd, { action: '/checkin', method: 'post' });

  // Fires once the write actually lands — not at click time, so the subsequent refetch
  // (triggered by markStale in onMutated) sees the new row rather than racing it.
  React.useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data) onMutated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  const rows = items
    .filter((i) => i.phase === phase && i.kind === 'custom')
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const typeOpts = [
    { value: '', label: t('ck_activity_none') },
    ...activityTypes.map((a) => ({ value: a.id, label: a.name })),
  ];

  const addItem = () => {
    const fd = new FormData();
    fd.set('intent', 'create-item');
    fd.set('eventId', eventId);
    fd.set('date', date);
    fd.set('phase', phase);
    // No activity type: seeding the first one made every added row look like a copy of the
    // one above it, and a teacher scanning the list can't tell "not chosen yet" from "chosen".
    fd.set('label', '');
    submit(fd);
  };

  const setType = (id: string, activityTypeId: string) => {
    const fd = new FormData();
    fd.set('intent', 'update-item');
    fd.set('id', id);
    fd.set('activityTypeId', activityTypeId);
    submit(fd);
  };

  const setLabel = (id: string, label: string) => {
    const fd = new FormData();
    fd.set('intent', 'update-item');
    fd.set('id', id);
    fd.set('label', label);
    submit(fd);
  };

  const removeItem = (id: string) => {
    const fd = new FormData();
    fd.set('intent', 'delete-item');
    fd.set('id', id);
    submit(fd);
  };

  return (
    <div className="m-stack" style={{ gap: 8 }}>
      {phase === 'checkin' &&
        items
          .filter((i) => i.phase === 'checkin' && i.kind !== 'custom')
          .map((i) => (
            <div key={i.id} className="ck-special-chip" data-kind={i.kind}>
              <MIcon name={i.kind === 'homework' ? 'book' : 'star'} size={16} />
              <b>{t(i.kind === 'homework' ? 'ck_sq_homework' : 'ck_sq_vocab')}</b>
              <span>{i.label}</span>
              <span className="ck-special-chip__auto">{t('ck_special_hint')}</span>
            </div>
          ))}
      {rows.map((row) => (
        <div key={row.id} className="ck-item-row">
          {phase === 'checkin' ? (
            <div className="ck-item-row__type">
              <MSelect
                label={t('ck_activity_type')}
                value={row.activityTypeId ?? ''}
                onChange={(v) => setType(row.id, v)}
                options={typeOpts}
              />
            </div>
          ) : null}
          {/* No label above the detail box — it read the placeholder back at you. */}
          <input
            className="mochi-input ck-item-row__label"
            defaultValue={row.label}
            placeholder={t('ck_label_ph')}
            onBlur={(e) => {
              if (e.target.value !== row.label) setLabel(row.id, e.target.value);
            }}
          />
          <CIBtn label={t('delete')} size="sm" onClick={() => removeItem(row.id)}>
            <MIcon name="trash" size={16} />
          </CIBtn>
        </div>
      ))}
      <div>
        <CBtn
          variant="secondary"
          size="sm"
          iconLeft={<MIcon name="plus" size={16} />}
          onClick={addItem}
        >
          {t('ck_add_item')}
        </CBtn>
      </div>
    </div>
  );
}

/**
 * "Check-in buổi sau": a separate component (not an inline branch) so the conditional
 * mount — only when the event recurs — never turns into a conditional hook call. Its own
 * occurrence key, since it authors items for a DIFFERENT date than the one open in the modal.
 */
function NextCheckinEditor({ eventId, nextDate }: { eventId: string; nextDate: string }) {
  const { t } = useLang();
  const nextKey = `ck:${eventId}:${nextDate}`;
  const { data } = useCachedLoad<CheckinPayload>(
    nextKey,
    `/checkin?eventId=${encodeURIComponent(eventId)}&date=${encodeURIComponent(nextDate)}`,
  );
  const onMutated = () => {
    noteLocalMutation('checkin');
    markStale(nextKey);
  };

  return (
    <div className="ck-section ck-section--next">
      <h4 style={{ margin: '0 0 8px' }}>{t('ck_items_next')}</h4>
      {data ? (
        <ChecklistItemsEditor
          eventId={eventId}
          date={nextDate}
          phase="checkin"
          items={data.items}
          activityTypes={data.activityTypes}
          onMutated={onMutated}
        />
      ) : null}
    </div>
  );
}

interface CheckinTabProps {
  eventId: string;
  date: string;
  classId: string;
  recurrence: string | undefined;
  classes: ClassRow[];
  students: StudentRow[];
}

/**
 * Authoring + live flag view for check-in (home activities) and check-out (what was
 * learned). "Check-in buổi sau" is a SEPARATE occurrence key: the teacher authors next
 * week's home-activity list at the end of this session, exactly the feedback board's idea.
 */
function CheckinTab({ eventId, date, classId, recurrence, classes, students }: CheckinTabProps) {
  const { t } = useLang();
  const [kiosk, setKiosk] = React.useState<CheckPhase | null>(null);
  const ckKey = `ck:${eventId}:${date}`;
  const { data } = useCachedLoad<CheckinPayload>(
    ckKey,
    `/checkin?eventId=${encodeURIComponent(eventId)}&date=${encodeURIComponent(date)}`,
  );
  const nextDate = nextOccurrenceDate(recurrence ?? 'none', date);

  // Edits go straight through /checkin; withLiveAction's own broadcast would also mark 'ck:'
  // stale, but that lands after a round trip through the hub — marking it here means THIS
  // tab's list updates the moment the fetcher settles, not a beat later. noteLocalMutation
  // suppresses the echo when the broadcast does arrive.
  const onMutated = () => {
    noteLocalMutation('checkin');
    markStale(ckKey);
  };

  const roster = (classes.find((c) => c.id === classId)?.studentIds ?? [])
    .map((sid) => students.find((s) => s.id === sid))
    .filter((s): s is StudentRow => !!s);

  // "Giao từ vựng" — the check-in surface's own assign dialog. Topics ride on the SAME cached
  // payload the Preview tab already loads for this occurrence, so opening this needs no new
  // endpoint.
  const [assignOpen, setAssignOpen] = React.useState(false);
  const { data: prevData } = useCachedLoad<{ topics: { id: string; name: string }[] }>(
    `prev:${eventId}:${date}`,
    `/event-previews?eventId=${encodeURIComponent(eventId)}&date=${encodeURIComponent(date)}`,
  );
  const assignFetcher = useFetcher<{ ok: boolean }>();
  React.useEffect(() => {
    if (assignFetcher.state === 'idle' && assignFetcher.data?.ok) {
      setAssignOpen(false);
      onMutated(); // refresh openAssignments in the ck: payload
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignFetcher.data, assignFetcher.state]);

  if (!roster.length) {
    return <Empty icon="users" title={t('att_empty_roster')} />;
  }

  const activityTypes = data?.activityTypes ?? [];
  const flags = data?.flags ?? [];

  return (
    <div className="m-stack" style={{ gap: 20 }}>
      {kiosk && (
        <KioskModal
          eventId={eventId}
          date={date}
          classId={classId}
          classes={classes}
          students={students}
          initialPhase={kiosk}
          onClose={() => setKiosk(null)}
        />
      )}
      <div className="ck-section ck-section--this">
        <div className="m-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h4 style={{ margin: 0 }}>{t('ck_items_this')}</h4>
          <CBtn variant="secondary" size="sm" onClick={() => setKiosk('checkin')}>
            {t('ck_open_kiosk_in')}
          </CBtn>
        </div>
        {data ? (
          <ChecklistItemsEditor
            eventId={eventId}
            date={date}
            phase="checkin"
            items={data.items}
            activityTypes={activityTypes}
            onMutated={onMutated}
          />
        ) : null}
      </div>

      {nextDate && <NextCheckinEditor eventId={eventId} nextDate={nextDate} />}

      <div className="ck-section ck-section--checkout">
        <div className="m-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h4 style={{ margin: 0 }}>{t('ck_checkout_title')}</h4>
          <CBtn variant="secondary" size="sm" onClick={() => setKiosk('checkout')}>
            {t('ck_open_kiosk_out')}
          </CBtn>
        </div>
        {data ? (
          <ChecklistItemsEditor
            eventId={eventId}
            date={date}
            phase="checkout"
            items={data.items}
            activityTypes={activityTypes}
            onMutated={onMutated}
          />
        ) : null}
      </div>

      <div className="ck-section ck-section--assign">
        <div className="m-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h4 style={{ margin: 0 }}>{t('ck_assign_vocab')}</h4>
          <CBtn variant="secondary" size="sm" onClick={() => setAssignOpen(true)}>
            {t('ck_assign_vocab')}
          </CBtn>
        </div>
        <div className="m-stack" style={{ gap: 6 }}>
          {(data?.openAssignments ?? []).length === 0 ? (
            <p className="m-muted" style={{ fontSize: 'var(--text-sm)', margin: 0 }}>
              {t('ck_assign_none')}
            </p>
          ) : (
            (data?.openAssignments ?? []).map((a) => (
              <div key={a.id} className="lrow">
                <span style={{ flex: 1 }} className="lrow__title">
                  {a.topicName}
                </span>
                <span className="m-muted">{a.deadline}</span>
                <span className="mchip">
                  {a.studentIds.length === 0
                    ? t('garden_scope_all')
                    : t('garden_scope_count', { n: a.studentIds.length })}
                </span>
              </div>
            ))
          )}
        </div>
        {assignOpen && (
          <AssignModal
            topics={prevData?.topics ?? []}
            classes={classes.filter((c) => c.id === classId)}
            today={date}
            onClose={() => setAssignOpen(false)}
            onSubmit={(fd) => assignFetcher.submit(fd, { action: '/vocabulary', method: 'post' })}
            rosterStudents={roster.map((s) => ({ id: s.id, name: s.name }))}
          />
        )}
      </div>

      <div className="ck-section ck-section--flags">
        <h4 style={{ margin: '0 0 8px' }}>{t('ck_flags_title')}</h4>
        <div className="m-stack" style={{ gap: 6 }}>
          {roster.map((s) => {
            const f = flags.find((x) => x.studentId === s.id);
            const missing = f?.uncheckedCheckout ?? [];
            const labels = missing
              .map((id) => data?.items.find((i) => i.id === id)?.label)
              .filter((l): l is string => !!l && l.length > 0);
            const clear = missing.length === 0;
            const c = colorOf(clear ? 'green' : 'rose');
            return (
              <div key={s.id} className="lrow">
                <span style={{ flex: 1 }} className="lrow__title">
                  {s.name}
                </span>
                <span
                  className="mchip"
                  style={{ background: c.soft, color: c.ink, fontWeight: 700 }}
                >
                  {clear ? t('ck_all_clear') : labels.join(', ') || missing.length}
                </span>
              </div>
            );
          })}
        </div>
      </div>
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
  classMaterials,
  events,
}: EventModalProps) {
  const { t } = useLang();
  const [f, setF] = React.useState<EventDraft>(draft || {});
  const [tab, setTab] = React.useState<EventModalTab>('details');
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

  const subtitleParts: string[] = [];
  if (f.date) {
    const [y, mo, d] = f.date.split('-');
    subtitleParts.push(`${d}/${mo}/${y.slice(2)}`);
  }
  const clsName = classes.find((c) => c.id === f.classId)?.name;
  if (clsName) subtitleParts.push(clsName);
  const subtitle = subtitleParts.join(' · ') || undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? t('ev_new') : t('ev_edit')}
      subtitle={subtitle}
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
          onChange={(id: string) => setTab(id as EventModalTab)}
          tabs={[
            { id: 'details', label: t('ev_details') },
            { id: 'attendance', label: t('att_tab') },
            { id: 'checkin', label: t('ck_tab') },
            { id: 'preview', label: t('prev_tab') },
            { id: 'materials', label: t('mat_tab') },
          ]}
        />
      )}

      {tab === 'preview' && showTabs ? (
        <div className="evm-pane-scroll">
          <PreviewTab eventId={f.id!} date={f.date || ''} />
        </div>
      ) : tab === 'attendance' && showTabs ? (
        <div className="evm-pane-scroll">
          <AttendanceTab
            eventId={f.id!}
            date={f.date || ''}
            classId={f.classId || ''}
            classes={classes}
            students={students}
          />
        </div>
      ) : tab === 'checkin' && showTabs ? (
        <div className="evm-pane-scroll">
          <CheckinTab
            eventId={f.id!}
            date={f.date || ''}
            classId={f.classId || ''}
            recurrence={f.recurrence}
            classes={classes}
            students={students}
          />
        </div>
      ) : tab === 'materials' && showTabs ? (
        <MaterialsTab
          eventId={f.id!}
          classId={f.classId || ''}
          materials={materials}
          classMaterials={classMaterials}
        />
      ) : (
        <div className="evm-pane-scroll">
          <div
            className={showTabs ? 'm-grid cols-2' : ''}
            style={showTabs ? { gap: 24, alignItems: 'start' } : undefined}
          >
            <div>
              <div className="mochi-field">
                <label className="mochi-field__label is-required">{t('ev_title')}</label>
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
                  required
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
                  classMaterials={classMaterials}
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

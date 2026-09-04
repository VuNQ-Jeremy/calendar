import React from 'react';
import { Link, useLoaderData } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Empty, Modal, MSelect, PageHeader, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { getCal } from '../../shared/i18n/strings.js';
import { DONE_STATUSES } from '../../shared/logic/practice.js';
import type {
  PracticeSettingsRow,
  PracticeTaskRow,
  StudentTaskRow,
} from '../../server/services/practice.js';
import type { ClassRow } from '../../server/services/classes.js';
import type { MaterialRow } from '../../server/services/materials.js';
import {
  dm,
  proofOptions,
  shiftDays,
  StatusTag,
  TextArea,
  usePracticeSubmit,
  type PracticeSubmit,
} from './common.jsx';

const { Card, Button, IconButton, Tag } = DS;

interface WeekLoaderData {
  classId: string;
  monday: string;
  sunday: string;
  today: string;
  cls: ClassRow;
  settings: PracticeSettingsRow | null;
  overrides: { date: string; isPractice: boolean }[];
  practiceDays: string[];
  tasks: PracticeTaskRow[];
  copies: StudentTaskRow[];
  roster: { classId: string; id: string; name: string }[];
  materials: MaterialRow[];
}

const NO_MATERIAL = '__none__';

/**
 * The teacher's planning surface: one week, seven columns, the tasks on each.
 *
 * Everything a column needs is already in the loader (tasks AND copies), so opening a day, adding
 * three tasks and marking a student done never round-trips for a read — which matters because
 * this is the screen used every evening.
 *
 * The `data-testid` / `aria-label` strings here are the e2e spec's handles; see
 * e2e/crud-practice.spec.ts before renaming one.
 */
export function PracticeWeekScreen() {
  const data = useLoaderData() as WeekLoaderData;
  const { classId, monday, today, cls, settings, practiceDays, tasks, copies, roster, materials } =
    data;
  const { t, lang } = useLang();
  const submit = usePracticeSubmit();
  const [confirm, confirmNode] = useConfirm();

  const cal = getCal(lang);
  const days = Array.from({ length: 7 }, (_, i) => shiftDays(monday, i));
  const practice = new Set(practiceDays);

  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<PracticeTaskRow | null>(null);
  const [students, setStudents] = React.useState<string | null>(null);

  if (!settings || !settings.enabled) {
    return (
      <div className="content pr-week">
        <PageHeader
          breadcrumbs={[{ label: t('pr_title'), to: '/practice' }, { label: cls.name }]}
          title={cls.name}
          subtitle={t('pr_title')}
        />
        <Empty
          icon="repeat"
          title={t('pr_not_enabled')}
          action={
            <Link to="/practice">
              <Button>{t('pr_enable')}</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const setOverride = (date: string, value: 'true' | 'false' | 'null') => {
    setMenuFor(null);
    submit({ intent: 'day-override', classId, date, isPractice: value });
  };

  const deleteTask = async (task: PracticeTaskRow) => {
    const ok = await confirm({
      title: t('pr_delete_task'),
      message: t('pr_delete_task_confirm'),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    submit({ intent: 'delete-task', id: task.id });
  };

  const materialName = (id: string | null) =>
    id ? (materials.find((m) => m.id === id)?.title ?? null) : null;

  return (
    <div className="content pr-week">
      <PageHeader
        breadcrumbs={[{ label: t('pr_title'), to: '/practice' }, { label: cls.name }]}
        title={cls.name}
        subtitle={`${dm(monday)} – ${dm(shiftDays(monday, 6))}`}
        actions={
          <>
            <Link to={`/practice/${classId}/week/${shiftDays(monday, -7)}`}>
              <Button variant="secondary">{t('pr_week_prev')}</Button>
            </Link>
            <Link to={`/practice/${classId}/week/${shiftDays(monday, 7)}`}>
              <Button variant="secondary">{t('pr_week_next')}</Button>
            </Link>
            <Link to={`/practice/${classId}/ledger/${today.slice(0, 7)}`}>
              <Button variant="secondary">{t('pr_ledger')}</Button>
            </Link>
          </>
        }
      />

      <div className="pr-week__grid">
        {days.map((date) => {
          const isPractice = practice.has(date);
          const dayTasks = tasks.filter((x) => x.date === date);
          const dayCopies = copies.filter((c) => c.date === date);
          return (
            <section
              key={date}
              className="pr-week__col"
              data-testid="pr-day"
              data-date={date}
              data-today={date === today ? 'true' : 'false'}
            >
              <header className="pr-week__colhead">
                <span className="pr-week__dow">
                  {cal.dow[new Date(`${date}T00:00:00Z`).getUTCDay()]}
                </span>
                <span className="pr-week__date">{dm(date)}</span>
                {!isPractice && <Tag>{t('pr_day_off')}</Tag>}
                <span className="pr-week__menu">
                  <IconButton
                    label="Day menu"
                    aria-haspopup="menu"
                    aria-expanded={menuFor === date}
                    onClick={() => setMenuFor(menuFor === date ? null : date)}
                  >
                    <MIcon name="more" size={16} />
                  </IconButton>
                  {menuFor === date && (
                    <div className="pr-week__menu-pop" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="pr-week__menu-item"
                        onClick={() => setOverride(date, 'false')}
                      >
                        {t('pr_day_off')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="pr-week__menu-item"
                        onClick={() => setOverride(date, 'true')}
                      >
                        {t('pr_make_practice_day')}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="pr-week__menu-item"
                        onClick={() => setOverride(date, 'null')}
                      >
                        {t('pr_remove_override')}
                      </button>
                    </div>
                  )}
                </span>
              </header>

              <div className="pr-week__tasks">
                {dayTasks.length === 0 && (
                  <div className="pr-week__empty">{t('pr_no_tasks_day')}</div>
                )}
                {dayTasks.map((task) => {
                  const mine = dayCopies.filter((c) => c.taskId === task.id);
                  const done = mine.filter((c) => DONE_STATUSES.has(c.status)).length;
                  return (
                    <Card key={task.id} flat className="pr-week__task">
                      <div className="pr-week__task-title">{task.title}</div>
                      <div className="pr-week__task-meta">
                        <Tag color="blue">
                          {t(
                            task.proofType === 'photo'
                              ? 'pr_proof_photo'
                              : task.proofType === 'video'
                                ? 'pr_proof_video'
                                : task.proofType === 'none'
                                  ? 'pr_proof_none'
                                  : 'pr_proof_either',
                          )}
                        </Tag>
                        {materialName(task.materialId) && (
                          <Tag>{materialName(task.materialId)}</Tag>
                        )}
                        {task.url && <MIcon name="link" size={14} />}
                        <span className="pr-week__count">{`${done}/${mine.length} ✓`}</span>
                      </div>
                      <div className="pr-week__task-actions">
                        <IconButton label={t('pr_edit_task')} onClick={() => setEditing(task)}>
                          <MIcon name="edit" size={15} />
                        </IconButton>
                        <IconButton
                          label={t('pr_delete_task')}
                          onClick={() => void deleteTask(task)}
                        >
                          <MIcon name="trash" size={15} />
                        </IconButton>
                      </div>
                    </Card>
                  );
                })}
              </div>

              <footer className="pr-week__colfoot">
                <Button size="sm" variant="secondary" onClick={() => setAdding(date)}>
                  {t('pr_add_tasks')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setStudents(date)}>
                  {t('pr_students_on_day')}
                </Button>
              </footer>
            </section>
          );
        })}
      </div>

      {adding && (
        <AddTasksDialog
          classId={classId}
          date={adding}
          materials={materials}
          onClose={() => setAdding(null)}
          submit={submit}
        />
      )}
      {editing && (
        <EditTaskDialog
          task={editing}
          materials={materials}
          onClose={() => setEditing(null)}
          submit={submit}
        />
      )}
      {students && (
        <StudentsDialog
          classId={classId}
          date={students}
          roster={roster}
          copies={copies.filter((c) => c.date === students)}
          onClose={() => setStudents(null)}
          submit={submit}
        />
      )}
      {confirmNode}
    </div>
  );
}

function AddTasksDialog({
  classId,
  date,
  materials,
  onClose,
  submit,
}: {
  classId: string;
  date: string;
  materials: MaterialRow[];
  onClose: () => void;
  submit: PracticeSubmit;
}) {
  const { t } = useLang();
  const [lines, setLines] = React.useState('');
  const [materialId, setMaterialId] = React.useState(NO_MATERIAL);
  const [proofType, setProofType] = React.useState('either');

  const save = () => {
    if (!lines.trim()) return;
    onClose();
    const fields: Record<string, string> = { intent: 'quick-add', classId, date, lines, proofType };
    if (materialId !== NO_MATERIAL) fields.materialId = materialId;
    submit(fields);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('pr_add_tasks')}
      subtitle={dm(date)}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={save}>{t('save')}</Button>
        </>
      }
    >
      <TextArea
        label={t('pr_lines')}
        value={lines}
        onChange={setLines}
        placeholder={t('pr_lines_ph')}
        rows={6}
      />
      <MSelect
        label={t('pr_material')}
        value={materialId}
        onChange={setMaterialId}
        options={[
          { value: NO_MATERIAL, label: t('pr_material_none') },
          ...materials.map((m) => ({ value: m.id, label: m.title })),
        ]}
      />
      <MSelect
        label={t('pr_proof')}
        value={proofType}
        onChange={setProofType}
        options={proofOptions(t)}
      />
    </Modal>
  );
}

function EditTaskDialog({
  task,
  materials,
  onClose,
  submit,
}: {
  task: PracticeTaskRow;
  materials: MaterialRow[];
  onClose: () => void;
  submit: PracticeSubmit;
}) {
  const { t } = useLang();
  const [title, setTitle] = React.useState(task.title);
  const [url, setUrl] = React.useState(task.url ?? '');
  const [materialId, setMaterialId] = React.useState(task.materialId ?? NO_MATERIAL);
  const [proofType, setProofType] = React.useState(task.proofType);

  const save = () => {
    if (!title.trim()) return;
    onClose();
    submit({
      intent: 'update-task',
      id: task.id,
      title,
      url,
      materialId: materialId === NO_MATERIAL ? '' : materialId,
      proofType,
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('pr_edit_task')}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={save}>{t('save')}</Button>
        </>
      }
    >
      <DS.Input
        label={t('pr_task_title')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <MSelect
        label={t('pr_material')}
        value={materialId}
        onChange={setMaterialId}
        options={[
          { value: NO_MATERIAL, label: t('pr_material_none') },
          ...materials.map((m) => ({ value: m.id, label: m.title })),
        ]}
      />
      <DS.Input label={t('pr_url')} value={url} onChange={(e) => setUrl(e.target.value)} />
      <MSelect
        label={t('pr_proof')}
        value={proofType}
        onChange={setProofType}
        options={proofOptions(t)}
      />
    </Modal>
  );
}

/**
 * The per-student view of one day: who has what, and the two overrides a teacher needs — drop a
 * copy for one student, or record one as done on their behalf (decision #15).
 */
function StudentsDialog({
  classId,
  date,
  roster,
  copies,
  onClose,
  submit,
}: {
  classId: string;
  date: string;
  roster: { id: string; name: string }[];
  copies: StudentTaskRow[];
  onClose: () => void;
  submit: PracticeSubmit;
}) {
  const { t } = useLang();
  const [studentId, setStudentId] = React.useState(roster[0]?.id ?? '');
  const [title, setTitle] = React.useState('');
  const [proofType, setProofType] = React.useState('either');

  const addOne = () => {
    if (!title.trim() || !studentId) return;
    const value = title;
    setTitle('');
    submit({ intent: 'create-task', classId, date, title: value, proofType, studentId });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('pr_students_on_day')}
      subtitle={dm(date)}
      width={640}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('close')}
        </Button>
      }
    >
      <div className="pr-week__roster">
        {roster.map((s) => {
          const mine = copies.filter((c) => c.studentId === s.id);
          const done = mine.filter((c) => DONE_STATUSES.has(c.status)).length;
          return (
            <div key={s.id} className="pr-week__student" data-testid="pr-student-row">
              <div className="pr-week__student-head">
                <strong>{s.name}</strong>
                <span className="pr-week__count">{`${done}/${mine.length}`}</span>
              </div>
              {mine.map((c) => (
                <div key={c.id} className="pr-week__copy" data-testid="pr-copy">
                  <span className="pr-week__copy-title">{c.title}</span>
                  <StatusTag status={c.status} t={t} />
                  {c.recordedByTeacher && <Tag>{t('pr_recorded_by_teacher')}</Tag>}
                  {c.status === 'open' && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          submit({
                            intent: 'review',
                            studentTaskId: c.id,
                            decision: 'teacher_done',
                          })
                        }
                      >
                        {t('pr_mark_done')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => submit({ intent: 'remove-copy', id: c.id })}
                      >
                        {t('pr_remove_copy')}
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="pr-week__addone">
        <h4>{t('pr_add_task_for')}</h4>
        <MSelect
          label={t('pr_student')}
          value={studentId}
          onChange={setStudentId}
          options={roster.map((s) => ({ value: s.id, label: s.name }))}
        />
        <DS.Input
          label={t('pr_task_title')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <MSelect
          label={t('pr_proof')}
          value={proofType}
          onChange={setProofType}
          options={proofOptions(t)}
        />
        <Button variant="secondary" onClick={addOne}>
          {t('add')}
        </Button>
      </div>
    </Modal>
  );
}

import React from 'react';
import { createPortal } from 'react-dom';
import { useLoaderData, useFetcher, useOutletContext } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect, ColorPicker, PageHeader, Empty, useConfirm } from '../ui.jsx';
import { colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import type { ClassLite } from '../../server/services/classes.js';
import type { StudentRow, StaffRow, ParentRow } from '../../server/services/people.js';
import type { InviteRow } from '../../server/services/invites.js';
import type { StudentFlashcardStats } from '../../server/services/flashcards.js';
import type { AppUser } from '../screens-core.jsx';

const {
  Card: MC,
  Button: MBtn,
  IconButton: MIB,
  Tag: MTag,
  Badge: MBadge,
  Avatar: MAv,
  Checkbox: MCheck,
} = DS;

interface PeopleLoaderData {
  students: StudentRow[];
  staff: StaffRow[];
  parents: ParentRow[];
  invites: InviteRow[];
  classes: ClassLite[];
  flashcardStats: StudentFlashcardStats[];
}

type StudentDraft = {
  id?: string;
  name: string;
  grade?: string | null;
  guardian?: string | null;
  email?: string | null;
  color: string;
  classIds: string[];
  /**
   * Only filled when adding: the parent becomes a real `parents` row linked to this
   * student, and gets a login code of their own. Editing a student does not touch
   * parents — that is the Parents tab's job.
   *
   * `parentLink` picks which half applies — a new parent, or an existing one (`parentId`)
   * for the sibling case, where a second row for the same mother would be wrong.
   */
  parentLink?: 'new' | 'existing';
  parentId?: string;
  parentName?: string;
  parentRelation?: string;
  parentPhone?: string;
};

/** What the /people action hands back after a create. See app/routes/people.tsx. */
type NewInvite = { role: string; code: string };
type PeopleActionData = { ok?: boolean; invites?: NewInvite[] } | undefined;

type StaffDraft = {
  id?: string;
  name: string;
  email?: string | null;
  role: string;
  color: string;
  phone?: string | null;
};

type ParentDraft = {
  id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  relation?: string | null;
  color: string;
  studentIds: string[];
};

export function StudentsScreen() {
  const { students, staff, parents, invites, classes, flashcardStats } =
    useLoaderData() as PeopleLoaderData;
  // The _app layout puts its loader's user straight on the context (app/routes/_app.tsx
  // `AppContext`), so this is the flat user — NOT the server's nested SessionUser. Typing it as
  // AppUser rather than an inline shape is what makes tsc catch that difference: useOutletContext's
  // generic is an unchecked assertion, and a hand-written nested one read as undefined at runtime
  // and 500'd the page on every render.
  const { user } = useOutletContext<{ user: AppUser }>();
  const isAdmin = user.role === 'Admin';
  const fetcher = useFetcher();
  const resetLoginFetcher = useFetcher<{ ok?: boolean; code?: string; error?: string }>();
  const [resetLoginResult, setResetLoginResult] = React.useState<NewInvite[] | null>(null);
  const [resetLoginRole, setResetLoginRole] = React.useState<string>('Student');
  const { t } = useLang();
  const relLabel = (r: string | null | undefined) =>
    t('rel_' + String(r || 'guardian').toLowerCase());
  const roleLabel = (r: string | null | undefined) => t('role_' + String(r || '').toLowerCase());
  const [tab, setTab] = React.useState('students');
  const [modal, setModal] = React.useState<StudentDraft | null>(null);
  const [staffModal, setStaffModal] = React.useState<StaffDraft | null>(null);
  const [parentModal, setParentModal] = React.useState<ParentDraft | null>(null);
  const [confirm, confirmNode] = useConfirm();

  const classNames = (ids: string[]) =>
    classes.filter((c) => ids.includes(c.id)).map((c) => c.name);

  const openNew = () =>
    setModal({
      name: '',
      grade: '',
      color: 'blue',
      email: '',
      classIds: [],
      parentLink: 'new',
      parentId: '',
      parentName: '',
      parentRelation: 'Guardian',
      parentPhone: '',
    });

  const del = async (s: StudentRow) => {
    if (
      await confirm({
        title: t('student_remove_q'),
        message: t('student_remove_msg', { name: s.name }),
        confirmLabel: t('remove'),
        danger: true,
      })
    ) {
      const fd = new FormData();
      fd.set('entity', 'student');
      fd.set('intent', 'delete');
      fd.set('id', s.id);
      fetcher.submit(fd, { action: '/people', method: 'post' });
    }
  };

  const openNewStaff = () =>
    setStaffModal({ name: '', email: '', role: 'Teacher', color: 'violet', phone: '' });

  const delStaff = async (u: StaffRow) => {
    if (
      await confirm({
        title: t('staff_remove_q'),
        message: t('staff_remove_msg', { name: u.name }),
        confirmLabel: t('remove'),
        danger: true,
      })
    ) {
      const fd = new FormData();
      fd.set('entity', 'staff');
      fd.set('intent', 'delete');
      fd.set('id', u.id);
      fetcher.submit(fd, { action: '/people', method: 'post' });
    }
  };

  const openNewParent = () =>
    setParentModal({
      name: '',
      email: '',
      phone: '',
      relation: 'Guardian',
      color: 'green',
      studentIds: [],
    });

  const delParent = async (p: ParentRow) => {
    if (
      await confirm({
        title: t('parent_remove_q'),
        message: t('parent_remove_msg', { name: p.name }),
        confirmLabel: t('remove'),
        danger: true,
      })
    ) {
      const fd = new FormData();
      fd.set('entity', 'parent');
      fd.set('intent', 'delete');
      fd.set('id', p.id);
      fetcher.submit(fd, { action: '/people', method: 'post' });
    }
  };

  /**
   * The escape hatch for "neither the old password nor Zalo/Google works anymore": wipes the
   * person's login and hands back a fresh invite code, exactly like adding them fresh. Destroys
   * every live session for them, hence the danger confirm.
   */
  const ENTITY_ROLE = { student: 'Student', staff: 'Staff', parent: 'Parent' } as const;

  const resetLogin = async (entity: keyof typeof ENTITY_ROLE, id: string, name: string) => {
    if (
      await confirm({
        title: t('reset_login_q'),
        message: t('reset_login_msg', { name }),
        confirmLabel: t('reset_login_confirm'),
        danger: true,
      })
    ) {
      setResetLoginRole(ENTITY_ROLE[entity]);
      const fd = new FormData();
      fd.set('entity', entity);
      fd.set('intent', 'reset-login');
      fd.set('id', id);
      resetLoginFetcher.submit(fd, { action: '/people', method: 'post' });
    }
  };

  React.useEffect(() => {
    if (resetLoginFetcher.state === 'idle' && resetLoginFetcher.data?.code) {
      setResetLoginResult([{ role: resetLoginRole, code: resetLoginFetcher.data.code }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetLoginFetcher.state, resetLoginFetcher.data]);

  return (
    <div className="content">
      <PageHeader
        title={t('ppl_title')}
        subtitle={t('ppl_sub')}
        actions={
          /* No "generate invite" button: adding a person mints their code, so a code that
             belongs to nobody is not a thing this screen can make any more. */
          <div className="m-row">
            {tab === 'students' && (
              <MBtn variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openNew}>
                {t('ppl_add_student')}
              </MBtn>
            )}
            {tab === 'staff' && (
              <MBtn
                variant="primary"
                iconLeft={<MIcon name="plus" size={18} />}
                onClick={openNewStaff}
              >
                {t('ppl_add_staff')}
              </MBtn>
            )}
            {tab === 'parents' && (
              <MBtn
                variant="primary"
                iconLeft={<MIcon name="plus" size={18} />}
                onClick={openNewParent}
              >
                {t('ppl_add_parent')}
              </MBtn>
            )}
          </div>
        }
      />
      <DS.Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'students', label: t('ppl_tab_students', { n: students.length }) },
          { id: 'staff', label: t('ppl_tab_staff', { n: staff.length }) },
          { id: 'parents', label: t('ppl_tab_parents', { n: parents.length }) },
          {
            id: 'invites',
            label: t('ppl_tab_invites', { n: invites.filter((i) => !i.used).length }),
          },
        ]}
      />

      {tab === 'students' && (
        <div className="m-stack">
          {students.map((s) => {
            // Linked parents first; `guardian` is the free-text column the form no longer
            // writes, kept so students added before this still show one.
            const guardians =
              parents
                .filter((p) => p.studentIds.includes(s.id))
                .map((p) => p.name)
                .join(', ') || s.guardian;
            return (
              <div key={s.id} className="lrow">
                <MAv name={s.name} color={s.color} size="md" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="lrow__title">{s.name}</div>
                  <div className="lrow__meta">
                    <span>{t('ppl_grade', { g: s.grade ?? '' })}</span>
                    {guardians && (
                      <span className="m-row" style={{ gap: 5 }}>
                        <MIcon name="users" size={13} />
                        {guardians}
                      </span>
                    )}
                  </div>
                </div>
                <div className="tablebar" style={{ maxWidth: 320, justifyContent: 'flex-end' }}>
                  {classNames(s.classIds)
                    .slice(0, 3)
                    .map((n, i) => (
                      <MTag key={i} dot={false}>
                        {n}
                      </MTag>
                    ))}
                  {s.classIds.length > 3 && (
                    <span className="mchip">{`+${s.classIds.length - 3}`}</span>
                  )}
                </div>
                <div className="lrow__actions">
                  <MIB
                    label={t('edit')}
                    size="sm"
                    onClick={() => setModal({ ...s, classIds: s.classIds })}
                  >
                    <MIcon name="edit" size={16} />
                  </MIB>
                  {isAdmin && (
                    <MIB
                      label={t('reset_login')}
                      size="sm"
                      onClick={() => resetLogin('student', s.id, s.name)}
                    >
                      <MIcon name="key" size={16} />
                    </MIB>
                  )}
                  <MIB label={t('delete')} size="sm" onClick={() => del(s)}>
                    <MIcon name="trash" size={16} />
                  </MIB>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'staff' && (
        <div className="m-stack">
          {staff.map((u) => (
            <div key={u.id} className="lrow">
              <MAv name={u.name} color={u.color} size="md" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="lrow__title">{u.name}</div>
                <div className="lrow__meta">
                  <span className="m-row" style={{ gap: 5 }}>
                    <MIcon name="mail" size={13} />
                    {u.email}
                  </span>
                  {u.phone && (
                    <span className="m-row" style={{ gap: 5 }}>
                      <MIcon name="clock" size={13} />
                      {u.phone}
                    </span>
                  )}
                </div>
              </div>
              <MBadge color={u.role === 'Admin' ? 'brand' : 'violet'}>{roleLabel(u.role)}</MBadge>
              <div className="lrow__actions">
                <MIB label={t('edit')} size="sm" onClick={() => setStaffModal({ ...u })}>
                  <MIcon name="edit" size={16} />
                </MIB>
                {/* Not for yourself — the action deletes your own account mid-session, and the
                    server refuses it anyway (people.tsx `cannot_reset_self`). */}
                {isAdmin && u.id !== user.id && (
                  <MIB
                    label={t('reset_login')}
                    size="sm"
                    onClick={() => resetLogin('staff', u.id, u.name)}
                  >
                    <MIcon name="key" size={16} />
                  </MIB>
                )}
                <MIB label={t('delete')} size="sm" onClick={() => delStaff(u)}>
                  <MIcon name="trash" size={16} />
                </MIB>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'invites' && <InvitesPanel />}

      {tab === 'parents' && (
        <div className="m-stack">
          {parents.length === 0 && <div className="m-empty">{t('ppl_no_parents')}</div>}
          {parents.map((p) => {
            const kids = students.filter((s) => (p.studentIds || []).includes(s.id));
            return (
              <div key={p.id} className="lrow">
                <MAv name={p.name} color={p.color} size="md" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="lrow__title">{p.name}</div>
                  <div className="lrow__meta">
                    <span className="m-row" style={{ gap: 5 }}>
                      <MIcon name="mail" size={13} />
                      {p.email || '—'}
                    </span>
                    {p.phone && (
                      <span className="m-row" style={{ gap: 5 }}>
                        <MIcon name="clock" size={13} />
                        {p.phone}
                      </span>
                    )}
                  </div>
                </div>
                <div className="tablebar" style={{ maxWidth: 320, justifyContent: 'flex-end' }}>
                  {kids.length ? (
                    kids.slice(0, 3).map((s) => (
                      <MTag key={s.id} color={s.color}>
                        {s.name}
                      </MTag>
                    ))
                  ) : (
                    <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
                      {t('ppl_no_children')}
                    </span>
                  )}
                  {kids.length > 3 && <span className="mchip">{`+${kids.length - 3}`}</span>}
                </div>
                <MBadge color="green">{relLabel(p.relation)}</MBadge>
                <div className="lrow__actions">
                  <MIB
                    label="Edit"
                    size="sm"
                    onClick={() => setParentModal({ ...p, studentIds: p.studentIds })}
                  >
                    <MIcon name="edit" size={16} />
                  </MIB>
                  {isAdmin && (
                    <MIB
                      label={t('reset_login')}
                      size="sm"
                      onClick={() => resetLogin('parent', p.id, p.name)}
                    >
                      <MIcon name="key" size={16} />
                    </MIB>
                  )}
                  <MIB label="Delete" size="sm" onClick={() => delParent(p)}>
                    <MIcon name="trash" size={16} />
                  </MIB>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <StudentModal
          draft={modal}
          setDraft={setModal}
          onClose={() => setModal(null)}
          classes={classes}
          parents={parents}
          stats={modal.id ? flashcardStats.find((s) => s.studentId === modal.id) : undefined}
        />
      )}
      {staffModal && (
        <StaffModal
          draft={staffModal}
          setDraft={setStaffModal}
          onClose={() => setStaffModal(null)}
        />
      )}
      {parentModal && (
        <ParentModal
          draft={parentModal}
          setDraft={setParentModal}
          onClose={() => setParentModal(null)}
          students={students}
        />
      )}
      {resetLoginResult && (
        <InviteCodesModal invites={resetLoginResult} onClose={() => setResetLoginResult(null)} />
      )}
      {confirmNode}
    </div>
  );
}

/**
 * Submit a create/edit and, for a create, hold the modal open on the codes the server
 * just minted.
 *
 * The fetcher belongs to the modal rather than the screen on purpose: saving revalidates
 * the People loader, and anything keyed off loader data would blink away the codes before
 * they could be copied. An edit has nothing to show, so it closes as it always did.
 */
function useCreateFetcher(isNew: boolean, onClose: () => void) {
  const fetcher = useFetcher<PeopleActionData>();
  const idle = fetcher.state === 'idle';
  const codes = isNew && idle && fetcher.data?.invites?.length ? fetcher.data.invites : null;
  React.useEffect(() => {
    if (!isNew && idle && fetcher.data?.ok) onClose();
  }, [isNew, idle, fetcher.data, onClose]);
  return { fetcher, codes, busy: !idle };
}

interface StudentModalProps {
  draft: StudentDraft;
  setDraft: React.Dispatch<React.SetStateAction<StudentDraft | null>>;
  onClose: () => void;
  classes: ClassLite[];
  parents: ParentRow[];
  stats?: StudentFlashcardStats;
}

function StudentModal({ draft, setDraft, onClose, classes, parents, stats }: StudentModalProps) {
  const { t } = useLang();
  const isNew = !draft.id;
  const { fetcher, codes, busy } = useCreateFetcher(isNew, onClose);
  const set = <K extends keyof StudentDraft>(k: K, v: StudentDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  const toggle = (id: string) =>
    set(
      'classIds',
      draft.classIds.includes(id)
        ? draft.classIds.filter((x) => x !== id)
        : [...draft.classIds, id],
    );

  const save = () => {
    const fd = new FormData();
    fd.set('entity', 'student');
    fd.set('intent', isNew ? 'create' : 'update');
    if (draft.id) fd.set('id', draft.id);
    fd.set('name', draft.name.trim() || t('sm_default_name'));
    if (draft.grade) fd.set('grade', draft.grade);
    if (draft.guardian) fd.set('guardian', draft.guardian);
    fd.set('email', draft.email || '');
    fd.set('color', draft.color || 'blue');
    fd.set('classIds', JSON.stringify(draft.classIds || []));
    if (isNew && draft.parentLink === 'existing') {
      if (draft.parentId) fd.set('parentId', draft.parentId);
    } else if (isNew && draft.parentName?.trim()) {
      fd.set('parentName', draft.parentName.trim());
      fd.set('parentRelation', draft.parentRelation || 'Guardian');
      if (draft.parentPhone) fd.set('parentPhone', draft.parentPhone);
    }
    fetcher.submit(fd, { action: '/people', method: 'post' });
  };

  if (codes) return <InviteCodesModal invites={codes} onClose={onClose} />;

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.id ? t('sm_edit') : t('sm_add')}
      width={540}
      footer={
        <>
          <MBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </MBtn>
          <MBtn variant="primary" onClick={save} disabled={busy}>
            {t('save')}
          </MBtn>
        </>
      }
    >
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('prof_fullname')}</label>
          <input
            className="mochi-input"
            autoFocus
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('prof_email')}</label>
          <input
            className="mochi-input"
            type="email"
            value={draft.email ?? ''}
            onChange={(e) => set('email', e.target.value)}
          />
        </div>
      </div>
      <ColorPicker
        label={t('prof_avatar_color')}
        value={draft.color}
        onChange={(v) => set('color', v)}
      />
      <hr className="divider" />
      {/* Grade and classes are one decision — which year they are in and which of this
          year's classes they sit in — so they are one section. */}
      <label className="mochi-field__label">{t('sm_grade_classes')}</label>
      <div className="m-grid cols-3" style={{ gap: 14, marginTop: 8 }}>
        <div className="mochi-field">
          <input
            className="mochi-input"
            placeholder={t('sm_grade')}
            value={draft.grade ?? ''}
            onChange={(e) => set('grade', e.target.value)}
          />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <TokenSearch
            items={classes}
            selectedIds={draft.classIds}
            onToggle={toggle}
            placeholder={t('sm_search_classes')}
            emptyHint={t('sm_all_classes_added')}
          />
        </div>
      </div>
      {isNew && (
        <>
          <hr className="divider" />
          <label className="mochi-field__label">{t('sm_parent_section')}</label>
          <p className="m-muted" style={{ fontSize: 'var(--text-sm)', margin: '4px 0 8px' }}>
            {t('sm_parent_hint')}
          </p>
          {/* Siblings share a parent, and entering the same mother twice would make two
              records of her. Offered only when there is somebody to link to. */}
          {parents.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <MCheck
                label={t('sm_parent_link_existing')}
                checked={draft.parentLink === 'existing'}
                onChange={() =>
                  set('parentLink', draft.parentLink === 'existing' ? 'new' : 'existing')
                }
              />
            </div>
          )}
          {draft.parentLink === 'existing' ? (
            <MSelect
              value={draft.parentId ?? ''}
              onChange={(v: string) => set('parentId', v)}
              options={[
                { value: '', label: t('sm_parent_pick') },
                ...parents.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          ) : (
            <div className="m-grid cols-3" style={{ gap: 14 }}>
              <div className="mochi-field">
                <input
                  className="mochi-input"
                  placeholder={t('sm_parent_name')}
                  value={draft.parentName ?? ''}
                  onChange={(e) => set('parentName', e.target.value)}
                />
              </div>
              <MSelect
                value={draft.parentRelation ?? 'Guardian'}
                onChange={(v: string) => set('parentRelation', v)}
                options={[
                  { value: 'Mother', label: t('rel_mother') },
                  { value: 'Father', label: t('rel_father') },
                  { value: 'Guardian', label: t('rel_guardian') },
                  { value: 'Other', label: t('rel_other') },
                ]}
              />
              <div className="mochi-field">
                <input
                  className="mochi-input"
                  type="tel"
                  placeholder={t('prof_phone')}
                  value={draft.parentPhone ?? ''}
                  onChange={(e) => set('parentPhone', e.target.value)}
                />
              </div>
            </div>
          )}
        </>
      )}
      {draft.id && (
        <>
          <hr className="divider" />
          <label className="mochi-field__label">{t('nav_flashcards')}</label>
          {stats ? (
            <div className="m-row" style={{ gap: 20, marginTop: 8, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{stats.rounds}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  {t('fc_stats_rounds')}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{stats.avgPct}%</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  {t('fc_stats_avg')}
                </div>
              </div>
              {stats.lastPlayedAt && (
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text-strong)' }}>
                    {new Date(stats.lastPlayedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                    {t('fc_stats_last')}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginTop: 8 }}>
              {t('fc_stats_none')}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

interface StaffModalProps {
  draft: StaffDraft;
  setDraft: React.Dispatch<React.SetStateAction<StaffDraft | null>>;
  onClose: () => void;
}

function StaffModal({ draft, setDraft, onClose }: StaffModalProps) {
  const { t } = useLang();
  const isNew = !draft.id;
  const { fetcher, codes, busy } = useCreateFetcher(isNew, onClose);
  const set = <K extends keyof StaffDraft>(k: K, v: StaffDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = () => {
    const fd = new FormData();
    fd.set('entity', 'staff');
    fd.set('intent', isNew ? 'create' : 'update');
    if (draft.id) fd.set('id', draft.id);
    fd.set('name', draft.name.trim() || t('stf_default_name'));
    fd.set('email', draft.email || '');
    fd.set('role', draft.role || 'Teacher');
    fd.set('color', draft.color || 'violet');
    if (draft.phone) fd.set('phone', draft.phone);
    fetcher.submit(fd, { action: '/people', method: 'post' });
  };

  if (codes) return <InviteCodesModal invites={codes} onClose={onClose} />;

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.id ? t('stf_edit') : t('stf_add')}
      width={520}
      footer={
        <>
          <MBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </MBtn>
          <MBtn variant="primary" onClick={save} disabled={busy}>
            {t('save')}
          </MBtn>
        </>
      }
    >
      <div className="mochi-field">
        <label className="mochi-field__label">{t('prof_fullname')}</label>
        <input
          className="mochi-input"
          autoFocus
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </div>
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('prof_email')}</label>
          <input
            className="mochi-input"
            type="email"
            value={draft.email ?? ''}
            onChange={(e) => set('email', e.target.value)}
          />
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('prof_phone')}</label>
          <input
            className="mochi-input"
            type="tel"
            value={draft.phone || ''}
            onChange={(e) => set('phone', e.target.value)}
          />
        </div>
      </div>
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <MSelect
          label={t('stf_role')}
          value={draft.role}
          onChange={(v) => set('role', v)}
          options={[
            { value: 'Teacher', label: t('role_teacher') },
            { value: 'Admin', label: t('role_admin') },
            { value: 'Assistant', label: t('role_assistant') },
          ]}
        />
        <ColorPicker
          label={t('prof_avatar_color')}
          value={draft.color}
          onChange={(v) => set('color', v)}
        />
      </div>
    </Modal>
  );
}

// ---- Reusable token search (type-ahead multi-select) ----
interface TokenSearchItem {
  id: string;
  name: string;
  color?: string | null;
}

interface TokenSearchProps {
  items: TokenSearchItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  placeholder?: string;
  emptyHint?: string;
}

function TokenSearch({ items, selectedIds, onToggle, placeholder, emptyHint }: TokenSearchProps) {
  const { t } = useLang();
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const fieldRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
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
  }, [open, selectedIds]);
  const selected = items.filter((i) => selectedIds.includes(i.id));
  const ql = q.trim().toLowerCase();
  const matches = items.filter(
    (i) => !selectedIds.includes(i.id) && (ql === '' || i.name.toLowerCase().includes(ql)),
  );
  const pick = (id: string) => {
    onToggle(id);
    setQ('');
    setOpen(true);
  };
  return (
    <div className="tokensearch" ref={wrapRef}>
      {selected.length > 0 && (
        <div className="tablebar" style={{ marginBottom: 8 }}>
          {selected.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => onToggle(i.id)}
              className="mchip"
              style={{
                cursor: 'pointer',
                gap: 6,
                border: '1.5px solid',
                borderColor: colorOf(i.color).base,
                background: colorOf(i.color).soft,
                color: colorOf(i.color).ink,
              }}
            >
              {i.name}
              <MIcon name="x" size={13} />
            </button>
          ))}
        </div>
      )}
      <div className="tokensearch__field" ref={fieldRef}>
        <MIcon name="search" size={17} />
        <input
          className="tokensearch__input"
          placeholder={placeholder || t('search')}
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
            {matches.length > 0 ? (
              matches.slice(0, 6).map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className="tokensearch__opt"
                  onClick={() => pick(i.id)}
                >
                  <span
                    className="tokensearch__dot"
                    style={{ background: colorOf(i.color).base }}
                  />
                  <span style={{ flex: 1, textAlign: 'left' }}>{i.name}</span>
                </button>
              ))
            ) : (
              <div className="tokensearch__empty">
                {ql ? t('ts_no_match', { q }) : emptyHint || t('ts_nothing_left')}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

interface ParentModalProps {
  draft: ParentDraft;
  setDraft: React.Dispatch<React.SetStateAction<ParentDraft | null>>;
  onClose: () => void;
  students: StudentRow[];
}

function ParentModal({ draft, setDraft, onClose, students }: ParentModalProps) {
  const { t } = useLang();
  const isNew = !draft.id;
  const { fetcher, codes, busy } = useCreateFetcher(isNew, onClose);
  const set = <K extends keyof ParentDraft>(k: K, v: ParentDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  const toggleKid = (id: string) =>
    set(
      'studentIds',
      (draft.studentIds || []).includes(id)
        ? draft.studentIds.filter((x) => x !== id)
        : [...(draft.studentIds || []), id],
    );

  const save = () => {
    const fd = new FormData();
    fd.set('entity', 'parent');
    fd.set('intent', isNew ? 'create' : 'update');
    if (draft.id) fd.set('id', draft.id);
    fd.set('name', draft.name.trim() || t('par_default_name'));
    fd.set('email', draft.email || '');
    if (draft.phone) fd.set('phone', draft.phone);
    fd.set('color', draft.color || 'green');
    if (draft.relation) fd.set('relation', draft.relation);
    fd.set('studentIds', JSON.stringify(draft.studentIds || []));
    fetcher.submit(fd, { action: '/people', method: 'post' });
  };

  if (codes) return <InviteCodesModal invites={codes} onClose={onClose} />;

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.id ? t('par_edit') : t('par_add')}
      width={540}
      footer={
        <>
          <MBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </MBtn>
          <MBtn variant="primary" onClick={save} disabled={busy}>
            {t('save')}
          </MBtn>
        </>
      }
    >
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('prof_fullname')}</label>
          <input
            className="mochi-input"
            autoFocus
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <MSelect
          label={t('par_relation')}
          value={draft.relation ?? ''}
          onChange={(v) => set('relation', v)}
          options={[
            { value: 'Mother', label: t('rel_mother') },
            { value: 'Father', label: t('rel_father') },
            { value: 'Guardian', label: t('rel_guardian') },
            { value: 'Other', label: t('rel_other') },
          ]}
        />
      </div>
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('prof_email')}</label>
          <input
            className="mochi-input"
            type="email"
            value={draft.email ?? ''}
            onChange={(e) => set('email', e.target.value)}
          />
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('prof_phone')}</label>
          <input
            className="mochi-input"
            type="tel"
            value={draft.phone || ''}
            onChange={(e) => set('phone', e.target.value)}
          />
        </div>
      </div>
      <ColorPicker
        label={t('prof_avatar_color')}
        value={draft.color}
        onChange={(v) => set('color', v)}
      />
      <hr className="divider" />
      <label className="mochi-field__label">{t('par_children')}</label>
      <div style={{ marginTop: 8 }}>
        <TokenSearch
          items={students}
          selectedIds={draft.studentIds || []}
          onToggle={toggleKid}
          placeholder={t('par_search_students')}
          emptyHint={t('par_all_linked')}
        />
      </div>
    </Modal>
  );
}

// ---- Invites ----
function InvitesPanel() {
  const { invites, classes } = useLoaderData() as PeopleLoaderData;
  const fetcher = useFetcher();
  const { t } = useLang();
  const roleLabel = (r: string | null | undefined) => t('role_' + String(r || '').toLowerCase());
  const [copied, setCopied] = React.useState<string | null>(null);
  const copy = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };
  const classOf = (id: string | null) => classes.find((c) => c.id === id)?.name;
  const removeInvite = (id: string) => {
    const fd = new FormData();
    fd.set('entity', 'invite');
    fd.set('intent', 'delete');
    fd.set('id', id);
    fetcher.submit(fd, { action: '/people', method: 'post' });
  };
  if (!invites.length)
    return (
      <MC>
        <Empty icon="key" title={t('inv_none_title')} sub={t('inv_none_sub')} />
      </MC>
    );
  return (
    <div className="m-stack">
      {invites.map((inv) => (
        <div key={inv.id} className="lrow">
          <div
            className="iconwrap"
            style={{
              background: inv.used ? 'var(--cream-200)' : 'var(--orange-100)',
              color: inv.used ? 'var(--taupe-500)' : 'var(--orange-700)',
            }}
          >
            <MIcon name="key" size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="m-row" style={{ gap: 10 }}>
              <span
                className="m-mono"
                style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 500,
                  letterSpacing: '0.08em',
                  color: inv.used ? 'var(--text-disabled)' : 'var(--text-strong)',
                  textDecoration: inv.used ? 'line-through' : 'none',
                }}
              >
                {inv.code}
              </span>
              <MBadge color={inv.role === 'Parent' ? 'violet' : 'blue'}>
                {roleLabel(inv.role)}
              </MBadge>
              {inv.used && <MBadge color="neutral">{t('inv_used')}</MBadge>}
            </div>
            <div className="lrow__meta">
              {/* personName for a linked code; `name` is the free-text label legacy codes
                  (and the mobile app's) carry instead. */}
              {inv.personName || inv.name || t('inv_unassigned')}
              {inv.classId && ` · ${classOf(inv.classId)}`}
            </div>
          </div>
          <div className="lrow__actions">
            {!inv.used && (
              <MBtn
                variant="soft"
                size="sm"
                iconLeft={<MIcon name={copied === inv.code ? 'check' : 'copy'} size={15} />}
                onClick={() => copy(inv.code)}
              >
                {copied === inv.code ? t('copied') : t('copy')}
              </MBtn>
            )}
            <MIB label={t('delete')} size="sm" onClick={() => removeInvite(inv.id)}>
              <MIcon name="trash" size={16} />
            </MIB>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The step a creation modal ends on: the codes the server just minted for the person who
 * was added, ready to copy. One for a student, two when a parent was entered with them.
 *
 * This is the only place a code is shown at full size, and the only moment it is offered
 * without being hunted for — which is the point of minting it here rather than leaving
 * staff to remember to generate one afterwards.
 */
function InviteCodesModal({ invites, onClose }: { invites: NewInvite[]; onClose: () => void }) {
  const { t } = useLang();
  const [copied, setCopied] = React.useState<string | null>(null);
  const roleLabel = (r: string) => t('role_' + String(r || '').toLowerCase());
  const copy = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('invs_success_title')}
      width={480}
      footer={
        <MBtn variant="primary" onClick={onClose}>
          {t('done')}
        </MBtn>
      }
    >
      <p className="m-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 12 }}>
        {t('invs_share_hint')}
      </p>
      {invites.map((inv) => (
        <div key={inv.code} style={{ textAlign: 'center', marginBottom: 16 }}>
          <label className="mochi-field__label">
            {t('invs_code_for', { role: roleLabel(inv.role) })}
          </label>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-4xl)',
              fontWeight: 500,
              letterSpacing: '0.12em',
              color: 'var(--brand-soft-ink)',
              background: 'var(--orange-100)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              margin: '8px 0',
            }}
          >
            {inv.code}
          </div>
          <MBtn
            variant="soft"
            iconLeft={<MIcon name={copied === inv.code ? 'check' : 'copy'} size={16} />}
            onClick={() => copy(inv.code)}
          >
            {copied === inv.code ? t('copied') : t('invm_copy_clip')}
          </MBtn>
        </div>
      ))}
    </Modal>
  );
}

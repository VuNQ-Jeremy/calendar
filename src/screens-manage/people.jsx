import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useStore } from '../store.jsx';
import { Modal, MSelect, ColorPicker, PageHeader, Empty, useConfirm } from '../ui.jsx';
import { colorOf, iso, TODAY, makeCode } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';

const { Card: MC, Button: MBtn, IconButton: MIB, Tag: MTag, Badge: MBadge, Avatar: MAv } = DS;

export function StudentsScreen() {
  const { data, add, update, remove } = useStore();
  const { t } = useLang();
  const relLabel = (r) => t('rel_' + String(r || 'guardian').toLowerCase());
  const roleLabel = (r) => t('role_' + String(r || '').toLowerCase());
  const [tab, setTab] = React.useState('students');
  const [modal, setModal] = React.useState(null);
  const [staffModal, setStaffModal] = React.useState(null);
  const [parentModal, setParentModal] = React.useState(null);
  const [inviteModal, setInviteModal] = React.useState(false);
  const [confirm, confirmNode] = useConfirm();

  const classNames = (ids) => data.classes.filter((c) => ids.includes(c.id)).map((c) => c.name);
  const openNew = () =>
    setModal({ name: '', grade: '9', color: 'blue', guardian: '', email: '', classIds: [] });
  const save = (f) => {
    if (!f.name.trim()) f.name = t('sm_default_name');
    if (f.id) update('students', f.id, f);
    else add('students', f);
    setModal(null);
  };
  const del = async (s) => {
    if (
      await confirm({
        title: t('student_remove_q'),
        message: t('student_remove_msg', { name: s.name }),
        confirmLabel: t('remove'),
        danger: true,
      })
    )
      remove('students', s.id);
  };
  const openNewStaff = () =>
    setStaffModal({ name: '', email: '', role: 'Teacher', color: 'violet', phone: '' });
  const saveStaff = (f) => {
    if (!f.name.trim()) f.name = t('stf_default_name');
    if (f.id) update('users', f.id, f);
    else add('users', f);
    setStaffModal(null);
  };
  const delStaff = async (u) => {
    if (
      await confirm({
        title: t('staff_remove_q'),
        message: t('staff_remove_msg', { name: u.name }),
        confirmLabel: t('remove'),
        danger: true,
      })
    )
      remove('users', u.id);
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
  const saveParent = (f) => {
    if (!f.name.trim()) f.name = t('par_default_name');
    if (f.id) update('parents', f.id, f);
    else add('parents', f);
    setParentModal(null);
  };
  const delParent = async (p) => {
    if (
      await confirm({
        title: t('parent_remove_q'),
        message: t('parent_remove_msg', { name: p.name }),
        confirmLabel: t('remove'),
        danger: true,
      })
    )
      remove('parents', p.id);
  };

  return (
    <div className="content">
      <PageHeader
        title={t('ppl_title')}
        subtitle={t('ppl_sub')}
        actions={
          <div className="m-row">
            <MBtn
              variant="secondary"
              iconLeft={<MIcon name="key" size={17} />}
              onClick={() => setInviteModal(true)}
            >
              {t('ppl_gen_invite')}
            </MBtn>
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
          { id: 'students', label: t('ppl_tab_students', { n: data.students.length }) },
          { id: 'staff', label: t('ppl_tab_staff', { n: data.users.length }) },
          { id: 'parents', label: t('ppl_tab_parents', { n: (data.parents || []).length }) },
          {
            id: 'invites',
            label: t('ppl_tab_invites', { n: data.invites.filter((i) => !i.used).length }),
          },
        ]}
      />

      {tab === 'students' && (
        <div className="m-stack">
          {data.students.map((s) => (
            <div key={s.id} className="lrow">
              <MAv name={s.name} color={s.color} size="md" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="lrow__title">{s.name}</div>
                <div className="lrow__meta">
                  <span>{t('ppl_grade', { g: s.grade })}</span>
                  {s.guardian && (
                    <span className="m-row" style={{ gap: 5 }}>
                      <MIcon name="users" size={13} />
                      {s.guardian}
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
                <MIB label={t('edit')} size="sm" onClick={() => setModal({ ...s })}>
                  <MIcon name="edit" size={16} />
                </MIB>
                <MIB label={t('delete')} size="sm" onClick={() => del(s)}>
                  <MIcon name="trash" size={16} />
                </MIB>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'staff' && (
        <div className="m-stack">
          {data.users.map((u) => (
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
          {(data.parents || []).length === 0 && (
            <div className="m-empty">{t('ppl_no_parents')}</div>
          )}
          {(data.parents || []).map((p) => {
            const kids = data.students.filter((s) => (p.studentIds || []).includes(s.id));
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
                  <MIB label="Edit" size="sm" onClick={() => setParentModal({ ...p })}>
                    <MIcon name="edit" size={16} />
                  </MIB>
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
          onSave={save}
          classes={data.classes}
        />
      )}
      {staffModal && (
        <StaffModal
          draft={staffModal}
          setDraft={setStaffModal}
          onClose={() => setStaffModal(null)}
          onSave={saveStaff}
        />
      )}
      {parentModal && (
        <ParentModal
          draft={parentModal}
          setDraft={setParentModal}
          onClose={() => setParentModal(null)}
          onSave={saveParent}
          students={data.students}
        />
      )}
      {inviteModal && <InviteModal onClose={() => setInviteModal(false)} />}
      {confirmNode}
    </div>
  );
}

function StudentModal({ draft, setDraft, onClose, onSave, classes }) {
  const { t } = useLang();
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const toggle = (id) =>
    set(
      'classIds',
      draft.classIds.includes(id)
        ? draft.classIds.filter((x) => x !== id)
        : [...draft.classIds, id],
    );
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
          <MBtn variant="primary" onClick={() => onSave(draft)}>
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
          <label className="mochi-field__label">{t('sm_grade')}</label>
          <input
            className="mochi-input"
            value={draft.grade}
            onChange={(e) => set('grade', e.target.value)}
          />
        </div>
      </div>
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('sm_guardian')}</label>
          <input
            className="mochi-input"
            placeholder={t('sm_guardian_ph')}
            value={draft.guardian}
            onChange={(e) => set('guardian', e.target.value)}
          />
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('prof_email')}</label>
          <input
            className="mochi-input"
            type="email"
            value={draft.email}
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
      <label className="mochi-field__label">{t('sm_enrolled')}</label>
      <div style={{ marginTop: 8 }}>
        <TokenSearch
          items={classes}
          selectedIds={draft.classIds}
          onToggle={toggle}
          placeholder={t('sm_search_classes')}
          emptyHint={t('sm_all_classes_added')}
        />
      </div>
    </Modal>
  );
}

function StaffModal({ draft, setDraft, onClose, onSave }) {
  const { t } = useLang();
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
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
          <MBtn variant="primary" onClick={() => onSave(draft)}>
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
            value={draft.email}
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
function TokenSearch({ items, selectedIds, onToggle, placeholder, emptyHint }) {
  const { t } = useLang();
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const selected = items.filter((i) => selectedIds.includes(i.id));
  const ql = q.trim().toLowerCase();
  const matches = items.filter(
    (i) => !selectedIds.includes(i.id) && (ql === '' || i.name.toLowerCase().includes(ql)),
  );
  const pick = (id) => {
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
      <div className="tokensearch__field">
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
      {open && (
        <div className="tokensearch__menu">
          {matches.length > 0 ? (
            matches.slice(0, 6).map((i) => (
              <button
                key={i.id}
                type="button"
                className="tokensearch__opt"
                onClick={() => pick(i.id)}
              >
                <span className="tokensearch__dot" style={{ background: colorOf(i.color).base }} />
                <span style={{ flex: 1, textAlign: 'left' }}>{i.name}</span>
                <MIcon name="plus" size={14} />
              </button>
            ))
          ) : (
            <div className="tokensearch__empty">
              {ql ? t('ts_no_match', { q }) : emptyHint || t('ts_nothing_left')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ParentModal({ draft, setDraft, onClose, onSave, students }) {
  const { t } = useLang();
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const toggleKid = (id) =>
    set(
      'studentIds',
      (draft.studentIds || []).includes(id)
        ? draft.studentIds.filter((x) => x !== id)
        : [...(draft.studentIds || []), id],
    );
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
          <MBtn variant="primary" onClick={() => onSave(draft)}>
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
          value={draft.relation}
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
            value={draft.email}
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
  const { data, remove } = useStore();
  const { t } = useLang();
  const roleLabel = (r) => t('role_' + String(r || '').toLowerCase());
  const [copied, setCopied] = React.useState(null);
  const copy = (code) => {
    navigator.clipboard && navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };
  const classOf = (id) => (data.classes.find((c) => c.id === id) || {}).name;
  if (!data.invites.length)
    return (
      <MC>
        <Empty icon="key" title={t('inv_none_title')} sub={t('inv_none_sub')} />
      </MC>
    );
  return (
    <div className="m-stack">
      {data.invites.map((inv) => (
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
              {inv.name || t('inv_unassigned')}
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
            <MIB label={t('delete')} size="sm" onClick={() => remove('invites', inv.id)}>
              <MIcon name="trash" size={16} />
            </MIB>
          </div>
        </div>
      ))}
    </div>
  );
}

function InviteModal({ onClose }) {
  const { data, add } = useStore();
  const { t } = useLang();
  const [role, setRole] = React.useState('Student');
  const [name, setName] = React.useState('');
  const [classId, setClassId] = React.useState('');
  const [generated, setGenerated] = React.useState(null);
  const roleLabel = (r) => t('role_' + String(r || '').toLowerCase());
  const gen = () => {
    const code = makeCode();
    const item = { code, role, name, classId: classId || null, createdAt: iso(TODAY), used: false };
    add('invites', item);
    setGenerated(code);
  };
  const copy = () => navigator.clipboard && navigator.clipboard.writeText(generated);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('invm_title')}
      width={480}
      footer={
        generated ? (
          <MBtn variant="primary" onClick={onClose}>
            {t('done')}
          </MBtn>
        ) : (
          <>
            <MBtn variant="secondary" onClick={onClose}>
              {t('cancel')}
            </MBtn>
            <MBtn variant="primary" iconLeft={<MIcon name="sparkle" size={16} />} onClick={gen}>
              {t('invm_generate')}
            </MBtn>
          </>
        )
      }
    >
      {generated ? (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <p className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('invm_share', { role: roleLabel(role).toLowerCase() })}
          </p>
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
              margin: '12px 0',
            }}
          >
            {generated}
          </div>
          <MBtn variant="soft" iconLeft={<MIcon name="copy" size={16} />} onClick={copy}>
            {t('invm_copy_clip')}
          </MBtn>
        </div>
      ) : (
        <>
          <div className="mochi-field">
            <label className="mochi-field__label">{t('invm_invite_as')}</label>
            <DS.Tabs
              value={role}
              onChange={setRole}
              tabs={[
                { id: 'Student', label: t('role_student') },
                { id: 'Staff', label: t('role_staff') },
                { id: 'Parent', label: t('role_parent') },
              ]}
            />
          </div>
          <div className="mochi-field">
            <label className="mochi-field__label">{t('invm_name_opt')}</label>
            <input
              className="mochi-input"
              placeholder={t('invm_name_ph', { role: roleLabel(role) })}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <MSelect
            label={t('invm_link_class')}
            value={classId}
            onChange={setClassId}
            options={[
              { value: '', label: t('invm_no_class') },
              ...data.classes.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </>
      )}
    </Modal>
  );
}

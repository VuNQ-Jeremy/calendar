import { React, DS } from './lib/globals.js';
import { MIcon } from './icons.js';
import { useStore } from './store.js';
import { Modal, MSelect, ColorPicker, PageHeader, Empty, useConfirm } from './ui.js';
import { colorOf, iso, TODAY, makeCode } from './lib/core.js';
import { useLang } from './lib/i18n.js';

// app/screens-manage.jsx — Classes, Students/Users (with invite codes), Materials
const { Card: MC, Button: MBtn, IconButton: MIB, Tag: MTag, Badge: MBadge, Avatar: MAv, Switch: MSw } = DS;

// ============================================================ CLASSES ============================================================
function ClassesScreen() {
  const { data, add, update, remove } = useStore();
  const { t } = useLang();
  const [modal, setModal] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [confirm, confirmNode] = useConfirm();
  const studentsOf = (c) => data.students.filter(s => c.studentIds.includes(s.id));

  const openNew = () => setModal({ name: '', subject: '', color: 'green', room: '', studentIds: [] });
  const save = (f) => { if (!f.name.trim()) f.name = t('cls_default_name'); if (f.id) update('classes', f.id, f); else add('classes', f); setModal(null); };
  const del = async (c) => { if (await confirm({ title: t('cls_delete_q'), message: t('cls_delete_msg', { name: c.name }), confirmLabel: t('delete'), danger: true })) remove('classes', c.id); };

  return React.createElement('div', { className: 'content' },
    React.createElement(PageHeader, {
      title: t('cls_title'), subtitle: t('cls_sub'),
      actions: React.createElement(MBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'plus', size: 18 }), onClick: openNew }, t('cls_new')),
    }),
    React.createElement('div', { className: 'm-grid cols-3' },
      data.classes.map(c => {
        const col = colorOf(c.color);
        const roster = studentsOf(c);
        return React.createElement(MC, { key: c.id, interactive: true, style: { padding: 0, overflow: 'hidden' } },
          React.createElement('div', { style: { height: 8, background: col.base } }),
          React.createElement('div', { style: { padding: 18, cursor: 'pointer' }, onClick: () => setDetail(c), title: t('cls_view_details') },
            React.createElement('div', { className: 'm-spread', style: { alignItems: 'flex-start' } },
              React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                React.createElement('h3', { style: { margin: '0 0 6px', fontSize: 'var(--text-lg)' } }, c.name),
                React.createElement(MTag, { color: c.color }, c.subject || t('cls_general')),
              ),
              React.createElement('div', { className: 'lrow__actions', style: { flexShrink: 0 } },
                React.createElement(MIB, { label: t('edit'), size: 'sm', onClick: (e) => { e.stopPropagation(); setModal({ ...c }); } }, React.createElement(MIcon, { name: 'edit', size: 16 })),
                React.createElement(MIB, { label: t('delete'), size: 'sm', onClick: (e) => { e.stopPropagation(); del(c); } }, React.createElement(MIcon, { name: 'trash', size: 16 })),
              ),
            ),
            React.createElement('div', { className: 'lrow__meta', style: { margin: '14px 0' } },
              React.createElement('span', { className: 'm-row', style: { gap: 5 } }, React.createElement(MIcon, { name: 'mapPin', size: 14 }), c.room || t('cls_no_room')),
            ),
            React.createElement('div', { className: 'm-spread' },
              React.createElement('div', { className: 'avatar-stack' },
                roster.slice(0, 5).map(s => React.createElement(MAv, { key: s.id, name: s.name, color: s.color, size: 'sm' })),
              ),
              React.createElement('span', { className: 'm-muted', style: { fontSize: 'var(--text-xs)', fontWeight: 700 } }, t('cls_students_n', { n: roster.length })),
            ),
          ),
        );
      }),
    ),
    modal && React.createElement(ClassModal, { draft: modal, setDraft: setModal, onClose: () => setModal(null), onSave: save, students: data.students }),
    detail && React.createElement(ClassDetailModal, { cls: detail, onClose: () => setDetail(null), onEdit: () => { setModal({ ...detail }); setDetail(null); } }),
    confirmNode,
  );
}

function ClassDetailModal({ cls, onClose, onEdit }) {
  const { data } = useStore();
  const { t } = useLang();
  const col = colorOf(cls.color);
  const roster = data.students.filter(s => cls.studentIds.includes(s.id));
  const materials = data.materials.filter(m => m.classId === cls.id);
  const homework = data.homework.filter(h => h.classId === cls.id);
  const openHw = homework.filter(h => !h.done).length;

  const Stat = (icon, label, val) => React.createElement('div', { style: { flex: 1, background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)', padding: '12px 14px' } },
    React.createElement('div', { className: 'm-row', style: { gap: 7, color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' } }, React.createElement(MIcon, { name: icon, size: 14 }), label),
    React.createElement('div', { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', color: 'var(--text-strong)', marginTop: 2 } }, val),
  );

  return React.createElement(Modal, {
    open: true, onClose, title: cls.name, width: 600,
    footer: React.createElement(React.Fragment, null,
      React.createElement(MBtn, { variant: 'secondary', onClick: onClose }, t('close')),
      React.createElement(MBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'edit', size: 16 }), onClick: onEdit }, t('cls_edit_class')),
    ),
  },
    React.createElement('div', { className: 'm-row', style: { gap: 10, marginBottom: 16 } },
      React.createElement(MTag, { color: cls.color }, cls.subject || t('cls_general')),
      React.createElement('span', { className: 'm-row m-muted', style: { gap: 5, fontSize: 'var(--text-sm)' } }, React.createElement(MIcon, { name: 'mapPin', size: 14 }), cls.room || t('cls_no_room')),
    ),
    React.createElement('div', { className: 'm-row', style: { gap: 10, marginBottom: 20 } },
      Stat('users', t('stat_students'), roster.length),
      Stat('clipboard', t('cls_stat_openwork'), openHw),
      Stat('folder', t('stat_materials'), materials.length),
    ),
    React.createElement('div', { className: 'mochi-eyebrow', style: { marginBottom: 8 } }, t('cls_roster_n', { n: roster.length })),
    roster.length ? React.createElement('div', { className: 'm-grid cols-2', style: { gap: 8, marginBottom: materials.length ? 20 : 0 } },
      roster.map(s => React.createElement('div', { key: s.id, className: 'm-row', style: { gap: 10, padding: '6px 4px' } },
        React.createElement(MAv, { name: s.name, color: s.color, size: 'sm' }),
        React.createElement('span', { style: { fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-strong)' } }, s.name),
      )),
    ) : React.createElement('span', { className: 'm-muted', style: { fontSize: 'var(--text-sm)' } }, t('cls_no_students_assigned')),
    materials.length > 0 && React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'mochi-eyebrow', style: { margin: '4px 0 8px' } }, t('cls_materials_n', { n: materials.length })),
      React.createElement('div', { className: 'tablebar' },
        materials.map(m => React.createElement('span', { key: m.id, className: 'mchip' }, React.createElement(MIcon, { name: m.type === 'link' ? 'link' : m.type === 'video' ? 'video' : 'file', size: 12 }), m.title)),
      ),
    ),
  );
}

function ClassModal({ draft, setDraft, onClose, onSave, students }) {
  const { t } = useLang();
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const toggleStudent = (id) => set('studentIds', draft.studentIds.includes(id) ? draft.studentIds.filter(x => x !== id) : [...draft.studentIds, id]);

  return React.createElement(Modal, {
    open: true, onClose, title: draft.id ? t('cls_edit_class') : t('cls_new_class'), width: 600,
    footer: React.createElement(React.Fragment, null,
      React.createElement(MBtn, { variant: 'secondary', onClick: onClose }, t('cancel')),
      React.createElement(MBtn, { variant: 'primary', onClick: () => onSave(draft) }, t('cls_save')),
    ),
  },
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' },
        React.createElement('label', { className: 'mochi-field__label' }, t('cls_name')),
        React.createElement('input', { className: 'mochi-input', autoFocus: true, placeholder: t('cls_name_ph'), value: draft.name, onChange: e => set('name', e.target.value) }),
      ),
      React.createElement('div', { className: 'mochi-field' },
        React.createElement('label', { className: 'mochi-field__label' }, t('cls_subject')),
        React.createElement('input', { className: 'mochi-input', placeholder: t('cls_subject_ph'), value: draft.subject, onChange: e => set('subject', e.target.value) }),
      ),
    ),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement(ColorPicker, { label: t('color'), value: draft.color, onChange: v => set('color', v) }),
    ),
    React.createElement('hr', { className: 'divider' }),
    React.createElement('label', { className: 'mochi-field__label' }, t('cls_roster_assigned', { n: draft.studentIds.length })),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 8, marginTop: 8 } },
      students.map(s => {
        const on = draft.studentIds.includes(s.id);
        return React.createElement('button', { key: s.id, onClick: () => toggleStudent(s.id), style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1.5px solid', borderColor: on ? 'var(--brand)' : 'var(--border-subtle)', background: on ? 'var(--brand-soft)' : 'var(--surface-card)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' } },
          React.createElement(MAv, { name: s.name, color: s.color, size: 'sm' }),
          React.createElement('span', { style: { fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-strong)', flex: 1 } }, s.name),
          on && React.createElement(MIcon, { name: 'check', size: 16, style: { color: 'var(--brand-soft-ink)' } }),
        );
      }),
    ),
  );
}

// ============================================================ STUDENTS / USERS ============================================================
function StudentsScreen() {
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

  const classNames = (ids) => data.classes.filter(c => ids.includes(c.id)).map(c => c.name);
  const openNew = () => setModal({ name: '', grade: '9', color: 'blue', guardian: '', email: '', classIds: [] });
  const save = (f) => { if (!f.name.trim()) f.name = t('sm_default_name'); if (f.id) update('students', f.id, f); else add('students', f); setModal(null); };
  const del = async (s) => { if (await confirm({ title: t('student_remove_q'), message: t('student_remove_msg', { name: s.name }), confirmLabel: t('remove'), danger: true })) remove('students', s.id); };
  const openNewStaff = () => setStaffModal({ name: '', email: '', role: 'Teacher', color: 'violet', phone: '' });
  const saveStaff = (f) => { if (!f.name.trim()) f.name = t('stf_default_name'); if (f.id) update('users', f.id, f); else add('users', f); setStaffModal(null); };
  const delStaff = async (u) => { if (await confirm({ title: t('staff_remove_q'), message: t('staff_remove_msg', { name: u.name }), confirmLabel: t('remove'), danger: true })) remove('users', u.id); };
  const openNewParent = () => setParentModal({ name: '', email: '', phone: '', relation: 'Guardian', color: 'green', studentIds: [] });
  const saveParent = (f) => { if (!f.name.trim()) f.name = t('par_default_name'); if (f.id) update('parents', f.id, f); else add('parents', f); setParentModal(null); };
  const delParent = async (p) => { if (await confirm({ title: t('parent_remove_q'), message: t('parent_remove_msg', { name: p.name }), confirmLabel: t('remove'), danger: true })) remove('parents', p.id); };

  return React.createElement('div', { className: 'content' },
    React.createElement(PageHeader, {
      title: t('ppl_title'), subtitle: t('ppl_sub'),
      actions: React.createElement('div', { className: 'm-row' },
        React.createElement(MBtn, { variant: 'secondary', iconLeft: React.createElement(MIcon, { name: 'key', size: 17 }), onClick: () => setInviteModal(true) }, t('ppl_gen_invite')),
        tab === 'students' && React.createElement(MBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'plus', size: 18 }), onClick: openNew }, t('ppl_add_student')),
        tab === 'staff' && React.createElement(MBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'plus', size: 18 }), onClick: openNewStaff }, t('ppl_add_staff')),
        tab === 'parents' && React.createElement(MBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'plus', size: 18 }), onClick: openNewParent }, t('ppl_add_parent')),
      ),
    }),
    React.createElement(DS.Tabs, { value: tab, onChange: setTab, tabs: [{ id: 'students', label: t('ppl_tab_students', { n: data.students.length }) }, { id: 'staff', label: t('ppl_tab_staff', { n: data.users.length }) }, { id: 'parents', label: t('ppl_tab_parents', { n: (data.parents || []).length }) }, { id: 'invites', label: t('ppl_tab_invites', { n: data.invites.filter(i => !i.used).length }) }] }),

    tab === 'students' && React.createElement('div', { className: 'm-stack' },
      data.students.map(s => React.createElement('div', { key: s.id, className: 'lrow' },
        React.createElement(MAv, { name: s.name, color: s.color, size: 'md' }),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { className: 'lrow__title' }, s.name),
          React.createElement('div', { className: 'lrow__meta' },
            React.createElement('span', null, t('ppl_grade', { g: s.grade })),
            s.guardian && React.createElement('span', { className: 'm-row', style: { gap: 5 } }, React.createElement(MIcon, { name: 'users', size: 13 }), s.guardian),
          ),
        ),
        React.createElement('div', { className: 'tablebar', style: { maxWidth: 320, justifyContent: 'flex-end' } },
          classNames(s.classIds).slice(0, 3).map((n, i) => React.createElement(MTag, { key: i, dot: false }, n)),
          s.classIds.length > 3 && React.createElement('span', { className: 'mchip' }, `+${s.classIds.length - 3}`),
        ),
        React.createElement('div', { className: 'lrow__actions' },
          React.createElement(MIB, { label: t('edit'), size: 'sm', onClick: () => setModal({ ...s }) }, React.createElement(MIcon, { name: 'edit', size: 16 })),
          React.createElement(MIB, { label: t('delete'), size: 'sm', onClick: () => del(s) }, React.createElement(MIcon, { name: 'trash', size: 16 })),
        ),
      )),
    ),

    tab === 'staff' && React.createElement('div', { className: 'm-stack' },
      data.users.map(u => React.createElement('div', { key: u.id, className: 'lrow' },
        React.createElement(MAv, { name: u.name, color: u.color, size: 'md' }),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { className: 'lrow__title' }, u.name),
          React.createElement('div', { className: 'lrow__meta' },
            React.createElement('span', { className: 'm-row', style: { gap: 5 } }, React.createElement(MIcon, { name: 'mail', size: 13 }), u.email),
            u.phone && React.createElement('span', { className: 'm-row', style: { gap: 5 } }, React.createElement(MIcon, { name: 'clock', size: 13 }), u.phone),
          ),
        ),
        React.createElement(MBadge, { color: u.role === 'Admin' ? 'brand' : 'violet' }, roleLabel(u.role)),
        React.createElement('div', { className: 'lrow__actions' },
          React.createElement(MIB, { label: t('edit'), size: 'sm', onClick: () => setStaffModal({ ...u }) }, React.createElement(MIcon, { name: 'edit', size: 16 })),
          React.createElement(MIB, { label: t('delete'), size: 'sm', onClick: () => delStaff(u) }, React.createElement(MIcon, { name: 'trash', size: 16 })),
        ),
      )),
    ),

    tab === 'invites' && React.createElement(InvitesPanel, {}),

    tab === 'parents' && React.createElement('div', { className: 'm-stack' },
      (data.parents || []).length === 0 && React.createElement('div', { className: 'm-empty' }, t('ppl_no_parents')),
      (data.parents || []).map(p => {
        const kids = data.students.filter(s => (p.studentIds || []).includes(s.id));
        return React.createElement('div', { key: p.id, className: 'lrow' },
          React.createElement(MAv, { name: p.name, color: p.color, size: 'md' }),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', { className: 'lrow__title' }, p.name),
            React.createElement('div', { className: 'lrow__meta' },
              React.createElement('span', { className: 'm-row', style: { gap: 5 } }, React.createElement(MIcon, { name: 'mail', size: 13 }), p.email || '—'),
              p.phone && React.createElement('span', { className: 'm-row', style: { gap: 5 } }, React.createElement(MIcon, { name: 'clock', size: 13 }), p.phone),
            ),
          ),
          React.createElement('div', { className: 'tablebar', style: { maxWidth: 320, justifyContent: 'flex-end' } },
            kids.length ? kids.slice(0, 3).map(s => React.createElement(MTag, { key: s.id, color: s.color }, s.name))
              : React.createElement('span', { className: 'm-muted', style: { fontSize: 'var(--text-sm)' } }, t('ppl_no_children')),
            kids.length > 3 && React.createElement('span', { className: 'mchip' }, `+${kids.length - 3}`),
          ),
          React.createElement(MBadge, { color: 'green' }, relLabel(p.relation)),
          React.createElement('div', { className: 'lrow__actions' },
            React.createElement(MIB, { label: 'Edit', size: 'sm', onClick: () => setParentModal({ ...p }) }, React.createElement(MIcon, { name: 'edit', size: 16 })),
            React.createElement(MIB, { label: 'Delete', size: 'sm', onClick: () => delParent(p) }, React.createElement(MIcon, { name: 'trash', size: 16 })),
          ),
        );
      }),
    ),

    modal && React.createElement(StudentModal, { draft: modal, setDraft: setModal, onClose: () => setModal(null), onSave: save, classes: data.classes }),
    staffModal && React.createElement(StaffModal, { draft: staffModal, setDraft: setStaffModal, onClose: () => setStaffModal(null), onSave: saveStaff }),
    parentModal && React.createElement(ParentModal, { draft: parentModal, setDraft: setParentModal, onClose: () => setParentModal(null), onSave: saveParent, students: data.students }),
    inviteModal && React.createElement(InviteModal, { onClose: () => setInviteModal(false) }),
    confirmNode,
  );
}

function StudentModal({ draft, setDraft, onClose, onSave, classes }) {
  const { t } = useLang();
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const toggle = (id) => set('classIds', draft.classIds.includes(id) ? draft.classIds.filter(x => x !== id) : [...draft.classIds, id]);
  return React.createElement(Modal, {
    open: true, onClose, title: draft.id ? t('sm_edit') : t('sm_add'), width: 540,
    footer: React.createElement(React.Fragment, null,
      React.createElement(MBtn, { variant: 'secondary', onClick: onClose }, t('cancel')),
      React.createElement(MBtn, { variant: 'primary', onClick: () => onSave(draft) }, t('save')),
    ),
  },
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, t('prof_fullname')), React.createElement('input', { className: 'mochi-input', autoFocus: true, value: draft.name, onChange: e => set('name', e.target.value) })),
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, t('sm_grade')), React.createElement('input', { className: 'mochi-input', value: draft.grade, onChange: e => set('grade', e.target.value) })),
    ),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, t('sm_guardian')), React.createElement('input', { className: 'mochi-input', placeholder: t('sm_guardian_ph'), value: draft.guardian, onChange: e => set('guardian', e.target.value) })),
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, t('prof_email')), React.createElement('input', { className: 'mochi-input', type: 'email', value: draft.email, onChange: e => set('email', e.target.value) })),
    ),
    React.createElement(ColorPicker, { label: t('prof_avatar_color'), value: draft.color, onChange: v => set('color', v) }),
    React.createElement('hr', { className: 'divider' }),
    React.createElement('label', { className: 'mochi-field__label' }, t('sm_enrolled')),
    React.createElement('div', { style: { marginTop: 8 } },
      React.createElement(TokenSearch, { items: classes, selectedIds: draft.classIds, onToggle: toggle, placeholder: t('sm_search_classes'), emptyHint: t('sm_all_classes_added') }),
    ),
  );
}

function StaffModal({ draft, setDraft, onClose, onSave }) {
  const { t } = useLang();
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  return React.createElement(Modal, {
    open: true, onClose, title: draft.id ? t('stf_edit') : t('stf_add'), width: 520,
    footer: React.createElement(React.Fragment, null,
      React.createElement(MBtn, { variant: 'secondary', onClick: onClose }, t('cancel')),
      React.createElement(MBtn, { variant: 'primary', onClick: () => onSave(draft) }, t('save')),
    ),
  },
    React.createElement('div', { className: 'mochi-field' },
      React.createElement('label', { className: 'mochi-field__label' }, t('prof_fullname')),
      React.createElement('input', { className: 'mochi-input', autoFocus: true, value: draft.name, onChange: e => set('name', e.target.value) }),
    ),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, t('prof_email')), React.createElement('input', { className: 'mochi-input', type: 'email', value: draft.email, onChange: e => set('email', e.target.value) })),
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, t('prof_phone')), React.createElement('input', { className: 'mochi-input', type: 'tel', value: draft.phone || '', onChange: e => set('phone', e.target.value) })),
    ),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement(MSelect, { label: t('stf_role'), value: draft.role, onChange: v => set('role', v), options: [{ value: 'Teacher', label: t('role_teacher') }, { value: 'Admin', label: t('role_admin') }, { value: 'Assistant', label: t('role_assistant') }] }),
      React.createElement(ColorPicker, { label: t('prof_avatar_color'), value: draft.color, onChange: v => set('color', v) }),
    ),
  );
}

// ---- Reusable token search (type-ahead multi-select) ----
function TokenSearch({ items, selectedIds, onToggle, placeholder, emptyHint }) {
  const { t } = useLang();
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const selected = items.filter(i => selectedIds.includes(i.id));
  const ql = q.trim().toLowerCase();
  const matches = items.filter(i => !selectedIds.includes(i.id) && (ql === '' || i.name.toLowerCase().includes(ql)));
  const pick = (id) => { onToggle(id); setQ(''); setOpen(true); };
  return React.createElement('div', { className: 'tokensearch', ref: wrapRef },
    selected.length > 0 && React.createElement('div', { className: 'tablebar', style: { marginBottom: 8 } },
      selected.map(i => React.createElement('button', { key: i.id, type: 'button', onClick: () => onToggle(i.id), className: 'mchip', style: { cursor: 'pointer', gap: 6, border: '1.5px solid', borderColor: colorOf(i.color).base, background: colorOf(i.color).soft, color: colorOf(i.color).ink } },
        i.name,
        React.createElement(MIcon, { name: 'x', size: 13 }),
      )),
    ),
    React.createElement('div', { className: 'tokensearch__field' },
      React.createElement(MIcon, { name: 'search', size: 17 }),
      React.createElement('input', { className: 'tokensearch__input', placeholder: placeholder || t('search'), value: q,
        onChange: e => { setQ(e.target.value); setOpen(true); }, onFocus: () => setOpen(true) }),
    ),
    open && React.createElement('div', { className: 'tokensearch__menu' },
      matches.length > 0
        ? matches.slice(0, 6).map(i => React.createElement('button', { key: i.id, type: 'button', className: 'tokensearch__opt', onClick: () => pick(i.id) },
            React.createElement('span', { className: 'tokensearch__dot', style: { background: colorOf(i.color).base } }),
            React.createElement('span', { style: { flex: 1, textAlign: 'left' } }, i.name),
            React.createElement(MIcon, { name: 'plus', size: 14 }),
          ))
        : React.createElement('div', { className: 'tokensearch__empty' }, ql ? t('ts_no_match', { q }) : (emptyHint || t('ts_nothing_left'))),
    ),
  );
}

function ParentModal({ draft, setDraft, onClose, onSave, students }) {
  const { t } = useLang();
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const toggleKid = (id) => set('studentIds', (draft.studentIds || []).includes(id) ? draft.studentIds.filter(x => x !== id) : [...(draft.studentIds || []), id]);
  return React.createElement(Modal, {
    open: true, onClose, title: draft.id ? t('par_edit') : t('par_add'), width: 540,
    footer: React.createElement(React.Fragment, null,
      React.createElement(MBtn, { variant: 'secondary', onClick: onClose }, t('cancel')),
      React.createElement(MBtn, { variant: 'primary', onClick: () => onSave(draft) }, t('save')),
    ),
  },
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, t('prof_fullname')), React.createElement('input', { className: 'mochi-input', autoFocus: true, value: draft.name, onChange: e => set('name', e.target.value) })),
      React.createElement(MSelect, { label: t('par_relation'), value: draft.relation, onChange: v => set('relation', v), options: [{ value: 'Mother', label: t('rel_mother') }, { value: 'Father', label: t('rel_father') }, { value: 'Guardian', label: t('rel_guardian') }, { value: 'Other', label: t('rel_other') }] }),
    ),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, t('prof_email')), React.createElement('input', { className: 'mochi-input', type: 'email', value: draft.email, onChange: e => set('email', e.target.value) })),
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, t('prof_phone')), React.createElement('input', { className: 'mochi-input', type: 'tel', value: draft.phone || '', onChange: e => set('phone', e.target.value) })),
    ),
    React.createElement(ColorPicker, { label: t('prof_avatar_color'), value: draft.color, onChange: v => set('color', v) }),
    React.createElement('hr', { className: 'divider' }),
    React.createElement('label', { className: 'mochi-field__label' }, t('par_children')),
    React.createElement('div', { style: { marginTop: 8 } },
      React.createElement(TokenSearch, { items: students, selectedIds: draft.studentIds || [], onToggle: toggleKid, placeholder: t('par_search_students'), emptyHint: t('par_all_linked') }),
    ),
  );
}

// ---- Invites ----
function InvitesPanel() {
  const { data, remove } = useStore();
  const { t } = useLang();
  const roleLabel = (r) => t('role_' + String(r || '').toLowerCase());
  const [copied, setCopied] = React.useState(null);
  const copy = (code) => { navigator.clipboard && navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(null), 1500); };
  const classOf = (id) => (data.classes.find(c => c.id === id) || {}).name;
  if (!data.invites.length) return React.createElement(MC, null, React.createElement(Empty, { icon: 'key', title: t('inv_none_title'), sub: t('inv_none_sub') }));
  return React.createElement('div', { className: 'm-stack' },
    data.invites.map(inv => React.createElement('div', { key: inv.id, className: 'lrow' },
      React.createElement('div', { className: 'iconwrap', style: { background: inv.used ? 'var(--cream-200)' : 'var(--orange-100)', color: inv.used ? 'var(--taupe-500)' : 'var(--orange-700)' } }, React.createElement(MIcon, { name: 'key', size: 18 })),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { className: 'm-row', style: { gap: 10 } },
          React.createElement('span', { className: 'm-mono', style: { fontSize: 'var(--text-lg)', fontWeight: 500, letterSpacing: '0.08em', color: inv.used ? 'var(--text-disabled)' : 'var(--text-strong)', textDecoration: inv.used ? 'line-through' : 'none' } }, inv.code),
          React.createElement(MBadge, { color: inv.role === 'Parent' ? 'violet' : 'blue' }, roleLabel(inv.role)),
          inv.used && React.createElement(MBadge, { color: 'neutral' }, t('inv_used')),
        ),
        React.createElement('div', { className: 'lrow__meta' }, inv.name || t('inv_unassigned'), inv.classId && ` · ${classOf(inv.classId)}`),
      ),
      React.createElement('div', { className: 'lrow__actions' },
        !inv.used && React.createElement(MBtn, { variant: 'soft', size: 'sm', iconLeft: React.createElement(MIcon, { name: copied === inv.code ? 'check' : 'copy', size: 15 }), onClick: () => copy(inv.code) }, copied === inv.code ? t('copied') : t('copy')),
        React.createElement(MIB, { label: t('delete'), size: 'sm', onClick: () => remove('invites', inv.id) }, React.createElement(MIcon, { name: 'trash', size: 16 })),
      ),
    )),
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
  const gen = () => { const code = makeCode(); const item = { code, role, name, classId: classId || null, createdAt: iso(TODAY), used: false }; add('invites', item); setGenerated(code); };
  const copy = () => navigator.clipboard && navigator.clipboard.writeText(generated);

  return React.createElement(Modal, {
    open: true, onClose, title: t('invm_title'), width: 480,
    footer: generated
      ? React.createElement(MBtn, { variant: 'primary', onClick: onClose }, t('done'))
      : React.createElement(React.Fragment, null,
          React.createElement(MBtn, { variant: 'secondary', onClick: onClose }, t('cancel')),
          React.createElement(MBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'sparkle', size: 16 }), onClick: gen }, t('invm_generate')),
        ),
  },
    generated
      ? React.createElement('div', { style: { textAlign: 'center', padding: '10px 0' } },
          React.createElement('p', { className: 'm-muted', style: { fontSize: 'var(--text-sm)' } }, t('invm_share', { role: roleLabel(role).toLowerCase() })),
          React.createElement('div', { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-4xl)', fontWeight: 500, letterSpacing: '0.12em', color: 'var(--brand-soft-ink)', background: 'var(--orange-100)', borderRadius: 'var(--radius-lg)', padding: '20px', margin: '12px 0' } }, generated),
          React.createElement(MBtn, { variant: 'soft', iconLeft: React.createElement(MIcon, { name: 'copy', size: 16 }), onClick: copy }, t('invm_copy_clip')),
        )
      : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'mochi-field' },
            React.createElement('label', { className: 'mochi-field__label' }, t('invm_invite_as')),
            React.createElement(DS.Tabs, { value: role, onChange: setRole, tabs: [{ id: 'Student', label: t('role_student') }, { id: 'Staff', label: t('role_staff') }, { id: 'Parent', label: t('role_parent') }] }),
          ),
          React.createElement('div', { className: 'mochi-field' },
            React.createElement('label', { className: 'mochi-field__label' }, t('invm_name_opt')),
            React.createElement('input', { className: 'mochi-input', placeholder: t('invm_name_ph', { role: roleLabel(role) }), value: name, onChange: e => setName(e.target.value) }),
          ),
          React.createElement(MSelect, { label: t('invm_link_class'), value: classId, onChange: setClassId, options: [{ value: '', label: t('invm_no_class') }, ...data.classes.map(c => ({ value: c.id, label: c.name }))] }),
        ),
  );
}


export { ClassesScreen, StudentsScreen };

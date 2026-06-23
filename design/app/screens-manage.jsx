// app/screens-manage.jsx — Classes, Students/Users (with invite codes), Materials
const { Card: MC, Button: MBtn, IconButton: MIB, Tag: MTag, Badge: MBadge, Avatar: MAv, Switch: MSw } = window.MochiDesignSystem_472b36;
const { iso } = window.MOCHI_DATE;
const WK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ============================================================ CLASSES ============================================================
function ClassesScreen() {
  const { data, add, update, remove } = useStore();
  const [modal, setModal] = React.useState(null);
  const [detail, setDetail] = React.useState(null);
  const [confirm, confirmNode] = window.useConfirm();
  const studentsOf = (c) => data.students.filter(s => c.studentIds.includes(s.id));

  const openNew = () => setModal({ name: '', subject: '', color: 'green', room: '', schedule: [], studentIds: [] });
  const save = (f) => { if (!f.name.trim()) f.name = 'New class'; if (f.id) update('classes', f.id, f); else add('classes', f); setModal(null); };
  const del = async (c) => { if (await confirm({ title: 'Delete class?', message: `“${c.name}” and its schedule will be removed. Students stay in the system.`, confirmLabel: 'Delete', danger: true })) remove('classes', c.id); };

  return React.createElement('div', { className: 'content' },
    React.createElement(window.PageHeader, {
      title: 'Classes', subtitle: 'Subjects, schedules, and rosters',
      actions: React.createElement(MBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'plus', size: 18 }), onClick: openNew }, 'New class'),
    }),
    React.createElement('div', { className: 'm-grid cols-3' },
      data.classes.map(c => {
        const col = window.colorOf(c.color);
        const roster = studentsOf(c);
        return React.createElement(MC, { key: c.id, interactive: true, style: { padding: 0, overflow: 'hidden' } },
          React.createElement('div', { style: { height: 8, background: col.base } }),
          React.createElement('div', { style: { padding: 18, cursor: 'pointer' }, onClick: () => setDetail(c), title: 'View class details' },
            React.createElement('div', { className: 'm-spread', style: { alignItems: 'flex-start' } },
              React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                React.createElement('h3', { style: { margin: '0 0 6px', fontSize: 'var(--text-lg)' } }, c.name),
                React.createElement(MTag, { color: c.color }, c.subject || 'General'),
              ),
              React.createElement('div', { className: 'lrow__actions', style: { flexShrink: 0 } },
                React.createElement(MIB, { label: 'Edit', size: 'sm', onClick: (e) => { e.stopPropagation(); setModal({ ...c }); } }, React.createElement(MIcon, { name: 'edit', size: 16 })),
                React.createElement(MIB, { label: 'Delete', size: 'sm', onClick: (e) => { e.stopPropagation(); del(c); } }, React.createElement(MIcon, { name: 'trash', size: 16 })),
              ),
            ),
            React.createElement('div', { className: 'lrow__meta', style: { margin: '14px 0' } },
              React.createElement('span', { className: 'm-row', style: { gap: 5 } }, React.createElement(MIcon, { name: 'mapPin', size: 14 }), c.room || 'No room'),
              React.createElement('span', { className: 'm-row', style: { gap: 5 } }, React.createElement(MIcon, { name: 'clock', size: 14 }), `${c.schedule.length}×/week`),
            ),
            React.createElement('div', { className: 'm-stack', style: { gap: 4, marginBottom: 14 } },
              c.schedule.length ? c.schedule.map((s, i) => React.createElement('div', { key: i, className: 'm-row m-mono', style: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)', gap: 8 } },
                React.createElement('span', { style: { fontWeight: 700, color: col.ink, minWidth: 32 } }, WK[s.day]),
                `${s.start}–${s.end}`,
              )) : React.createElement('span', { className: 'm-muted', style: { fontSize: 'var(--text-xs)' } }, 'No schedule set'),
            ),
            React.createElement('div', { className: 'm-spread' },
              React.createElement('div', { className: 'avatar-stack' },
                roster.slice(0, 5).map(s => React.createElement(MAv, { key: s.id, name: s.name, color: s.color, size: 'sm' })),
              ),
              React.createElement('span', { className: 'm-muted', style: { fontSize: 'var(--text-xs)', fontWeight: 700 } }, `${roster.length} students`),
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
  const col = window.colorOf(cls.color);
  const roster = data.students.filter(s => cls.studentIds.includes(s.id));
  const materials = data.materials.filter(m => m.classId === cls.id);
  const homework = data.homework.filter(h => h.classId === cls.id);
  const openHw = homework.filter(h => !h.done).length;

  const Stat = (icon, label, val) => React.createElement('div', { style: { flex: 1, background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)', padding: '12px 14px' } },
    React.createElement('div', { className: 'm-row', style: { gap: 7, color: 'var(--text-muted)', fontSize: 'var(--text-xs)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' } }, React.createElement(MIcon, { name: icon, size: 14 }), label),
    React.createElement('div', { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', color: 'var(--text-strong)', marginTop: 2 } }, val),
  );

  return React.createElement(window.Modal, {
    open: true, onClose, title: cls.name, width: 600,
    footer: React.createElement(React.Fragment, null,
      React.createElement(MBtn, { variant: 'secondary', onClick: onClose }, 'Close'),
      React.createElement(MBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'edit', size: 16 }), onClick: onEdit }, 'Edit class'),
    ),
  },
    React.createElement('div', { className: 'm-row', style: { gap: 10, marginBottom: 16 } },
      React.createElement(MTag, { color: cls.color }, cls.subject || 'General'),
      React.createElement('span', { className: 'm-row m-muted', style: { gap: 5, fontSize: 'var(--text-sm)' } }, React.createElement(MIcon, { name: 'mapPin', size: 14 }), cls.room || 'No room'),
    ),
    React.createElement('div', { className: 'm-row', style: { gap: 10, marginBottom: 20 } },
      Stat('users', 'Students', roster.length),
      Stat('clipboard', 'Open work', openHw),
      Stat('folder', 'Materials', materials.length),
    ),
    React.createElement('div', { className: 'mochi-eyebrow', style: { marginBottom: 8 } }, 'Weekly schedule'),
    React.createElement('div', { className: 'm-stack', style: { gap: 6, marginBottom: 20 } },
      cls.schedule.length ? cls.schedule.map((s, i) => React.createElement('div', { key: i, className: 'm-row', style: { gap: 12, padding: '8px 12px', background: col.soft, borderRadius: 'var(--radius-md)' } },
        React.createElement('span', { style: { fontWeight: 800, color: col.ink, minWidth: 42 } }, WK[s.day]),
        React.createElement('span', { className: 'm-mono', style: { color: 'var(--text-body)' } }, `${s.start} – ${s.end}`),
      )) : React.createElement('span', { className: 'm-muted', style: { fontSize: 'var(--text-sm)' } }, 'No schedule set yet.'),
    ),
    React.createElement('div', { className: 'mochi-eyebrow', style: { marginBottom: 8 } }, `Roster · ${roster.length}`),
    roster.length ? React.createElement('div', { className: 'm-grid cols-2', style: { gap: 8, marginBottom: materials.length ? 20 : 0 } },
      roster.map(s => React.createElement('div', { key: s.id, className: 'm-row', style: { gap: 10, padding: '6px 4px' } },
        React.createElement(MAv, { name: s.name, color: s.color, size: 'sm' }),
        React.createElement('span', { style: { fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-strong)' } }, s.name),
      )),
    ) : React.createElement('span', { className: 'm-muted', style: { fontSize: 'var(--text-sm)' } }, 'No students assigned.'),
    materials.length > 0 && React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'mochi-eyebrow', style: { margin: '4px 0 8px' } }, `Materials · ${materials.length}`),
      React.createElement('div', { className: 'tablebar' },
        materials.map(m => React.createElement('span', { key: m.id, className: 'mchip' }, React.createElement(MIcon, { name: m.type === 'link' ? 'link' : m.type === 'video' ? 'video' : 'file', size: 12 }), m.title)),
      ),
    ),
  );
}

function ClassModal({ draft, setDraft, onClose, onSave, students }) {
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const addSlot = () => set('schedule', [...draft.schedule, { day: 1, start: '09:00', end: '09:45' }]);
  const setSlot = (i, k, v) => set('schedule', draft.schedule.map((s, j) => j === i ? { ...s, [k]: v } : s));
  const rmSlot = (i) => set('schedule', draft.schedule.filter((_, j) => j !== i));
  const toggleStudent = (id) => set('studentIds', draft.studentIds.includes(id) ? draft.studentIds.filter(x => x !== id) : [...draft.studentIds, id]);

  return React.createElement(window.Modal, {
    open: true, onClose, title: draft.id ? 'Edit class' : 'New class', width: 600,
    footer: React.createElement(React.Fragment, null,
      React.createElement(MBtn, { variant: 'secondary', onClick: onClose }, 'Cancel'),
      React.createElement(MBtn, { variant: 'primary', onClick: () => onSave(draft) }, 'Save class'),
    ),
  },
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' },
        React.createElement('label', { className: 'mochi-field__label' }, 'Class name'),
        React.createElement('input', { className: 'mochi-input', autoFocus: true, placeholder: 'e.g. Biology 9A', value: draft.name, onChange: e => set('name', e.target.value) }),
      ),
      React.createElement('div', { className: 'mochi-field' },
        React.createElement('label', { className: 'mochi-field__label' }, 'Subject'),
        React.createElement('input', { className: 'mochi-input', placeholder: 'e.g. Science', value: draft.subject, onChange: e => set('subject', e.target.value) }),
      ),
    ),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' },
        React.createElement('label', { className: 'mochi-field__label' }, 'Room'),
        React.createElement('input', { className: 'mochi-input', placeholder: 'e.g. Room 204', value: draft.room, onChange: e => set('room', e.target.value) }),
      ),
      React.createElement(window.ColorPicker, { label: 'Color', value: draft.color, onChange: v => set('color', v) }),
    ),
    React.createElement('hr', { className: 'divider' }),
    React.createElement('div', { className: 'm-spread', style: { marginBottom: 10 } },
      React.createElement('label', { className: 'mochi-field__label', style: { margin: 0 } }, 'Weekly schedule'),
      React.createElement(MBtn, { variant: 'soft', size: 'sm', iconLeft: React.createElement(MIcon, { name: 'plus', size: 15 }), onClick: addSlot }, 'Add time'),
    ),
    draft.schedule.map((s, i) => React.createElement('div', { key: i, className: 'sched-row' },
      React.createElement(window.MSelect, { value: String(s.day), onChange: v => setSlot(i, 'day', Number(v)), options: WK.map((d, idx) => ({ value: String(idx), label: d })) }),
      React.createElement('input', { type: 'time', className: 'mochi-input', value: s.start, onChange: e => setSlot(i, 'start', e.target.value) }),
      React.createElement('input', { type: 'time', className: 'mochi-input', value: s.end, onChange: e => setSlot(i, 'end', e.target.value) }),
      React.createElement(MIB, { label: 'Remove', size: 'sm', onClick: () => rmSlot(i) }, React.createElement(MIcon, { name: 'x', size: 16 })),
    )),
    React.createElement('hr', { className: 'divider' }),
    React.createElement('label', { className: 'mochi-field__label' }, `Roster · ${draft.studentIds.length} assigned`),
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
  const [tab, setTab] = React.useState('students');
  const [modal, setModal] = React.useState(null);
  const [staffModal, setStaffModal] = React.useState(null);
  const [parentModal, setParentModal] = React.useState(null);
  const [inviteModal, setInviteModal] = React.useState(false);
  const [confirm, confirmNode] = window.useConfirm();

  const classNames = (ids) => data.classes.filter(c => ids.includes(c.id)).map(c => c.name);
  const openNew = () => setModal({ name: '', grade: '9', color: 'blue', guardian: '', email: '', classIds: [] });
  const save = (f) => { if (!f.name.trim()) f.name = 'New student'; if (f.id) update('students', f.id, f); else add('students', f); setModal(null); };
  const del = async (s) => { if (await confirm({ title: 'Remove student?', message: `${s.name} will be removed from all classes.`, confirmLabel: 'Remove', danger: true })) remove('students', s.id); };
  const openNewStaff = () => setStaffModal({ name: '', email: '', role: 'Teacher', color: 'violet', phone: '' });
  const saveStaff = (f) => { if (!f.name.trim()) f.name = 'New staff'; if (f.id) update('users', f.id, f); else add('users', f); setStaffModal(null); };
  const delStaff = async (u) => { if (await confirm({ title: 'Remove staff member?', message: `${u.name} will lose access.`, confirmLabel: 'Remove', danger: true })) remove('users', u.id); };
  const openNewParent = () => setParentModal({ name: '', email: '', phone: '', relation: 'Guardian', color: 'green', studentIds: [] });
  const saveParent = (f) => { if (!f.name.trim()) f.name = 'New parent'; if (f.id) update('parents', f.id, f); else add('parents', f); setParentModal(null); };
  const delParent = async (p) => { if (await confirm({ title: 'Remove parent?', message: `${p.name} will lose portal access.`, confirmLabel: 'Remove', danger: true })) remove('parents', p.id); };

  return React.createElement('div', { className: 'content' },
    React.createElement(window.PageHeader, {
      title: 'People', subtitle: 'Students, staff, and onboarding invites',
      actions: React.createElement('div', { className: 'm-row' },
        React.createElement(MBtn, { variant: 'secondary', iconLeft: React.createElement(MIcon, { name: 'key', size: 17 }), onClick: () => setInviteModal(true) }, 'Generate invite'),
        tab === 'students' && React.createElement(MBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'plus', size: 18 }), onClick: openNew }, 'Add student'),
        tab === 'staff' && React.createElement(MBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'plus', size: 18 }), onClick: openNewStaff }, 'Add staff'),
        tab === 'parents' && React.createElement(MBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'plus', size: 18 }), onClick: openNewParent }, 'Add parent'),
      ),
    }),
    React.createElement(window.MochiDesignSystem_472b36.Tabs, { value: tab, onChange: setTab, tabs: [{ id: 'students', label: `Students · ${data.students.length}` }, { id: 'staff', label: `Staff · ${data.users.length}` }, { id: 'parents', label: `Parents · ${(data.parents || []).length}` }, { id: 'invites', label: `Invites · ${data.invites.filter(i => !i.used).length}` }] }),

    tab === 'students' && React.createElement('div', { className: 'm-stack' },
      data.students.map(s => React.createElement('div', { key: s.id, className: 'lrow' },
        React.createElement(MAv, { name: s.name, color: s.color, size: 'md' }),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { className: 'lrow__title' }, s.name),
          React.createElement('div', { className: 'lrow__meta' },
            React.createElement('span', null, `Grade ${s.grade}`),
            s.guardian && React.createElement('span', { className: 'm-row', style: { gap: 5 } }, React.createElement(MIcon, { name: 'users', size: 13 }), s.guardian),
          ),
        ),
        React.createElement('div', { className: 'tablebar', style: { maxWidth: 320, justifyContent: 'flex-end' } },
          classNames(s.classIds).slice(0, 3).map((n, i) => React.createElement(MTag, { key: i, dot: false }, n)),
          s.classIds.length > 3 && React.createElement('span', { className: 'mchip' }, `+${s.classIds.length - 3}`),
        ),
        React.createElement('div', { className: 'lrow__actions' },
          React.createElement(MIB, { label: 'Edit', size: 'sm', onClick: () => setModal({ ...s }) }, React.createElement(MIcon, { name: 'edit', size: 16 })),
          React.createElement(MIB, { label: 'Delete', size: 'sm', onClick: () => del(s) }, React.createElement(MIcon, { name: 'trash', size: 16 })),
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
        React.createElement(MBadge, { color: u.role === 'Admin' ? 'brand' : 'violet' }, u.role),
        React.createElement('div', { className: 'lrow__actions' },
          React.createElement(MIB, { label: 'Edit', size: 'sm', onClick: () => setStaffModal({ ...u }) }, React.createElement(MIcon, { name: 'edit', size: 16 })),
          React.createElement(MIB, { label: 'Delete', size: 'sm', onClick: () => delStaff(u) }, React.createElement(MIcon, { name: 'trash', size: 16 })),
        ),
      )),
    ),

    tab === 'invites' && React.createElement(InvitesPanel, {}),

    tab === 'parents' && React.createElement('div', { className: 'm-stack' },
      (data.parents || []).length === 0 && React.createElement('div', { className: 'm-empty' }, 'No parents yet. Add one or generate a parent invite code.'),
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
              : React.createElement('span', { className: 'm-muted', style: { fontSize: 'var(--text-sm)' } }, 'No children linked'),
            kids.length > 3 && React.createElement('span', { className: 'mchip' }, `+${kids.length - 3}`),
          ),
          React.createElement(MBadge, { color: 'green' }, p.relation || 'Guardian'),
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
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const toggle = (id) => set('classIds', draft.classIds.includes(id) ? draft.classIds.filter(x => x !== id) : [...draft.classIds, id]);
  return React.createElement(window.Modal, {
    open: true, onClose, title: draft.id ? 'Edit student' : 'Add student', width: 540,
    footer: React.createElement(React.Fragment, null,
      React.createElement(MBtn, { variant: 'secondary', onClick: onClose }, 'Cancel'),
      React.createElement(MBtn, { variant: 'primary', onClick: () => onSave(draft) }, 'Save'),
    ),
  },
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, 'Full name'), React.createElement('input', { className: 'mochi-input', autoFocus: true, value: draft.name, onChange: e => set('name', e.target.value) })),
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, 'Grade'), React.createElement('input', { className: 'mochi-input', value: draft.grade, onChange: e => set('grade', e.target.value) })),
    ),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, 'Guardian'), React.createElement('input', { className: 'mochi-input', placeholder: 'Parent / guardian', value: draft.guardian, onChange: e => set('guardian', e.target.value) })),
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, 'Email'), React.createElement('input', { className: 'mochi-input', type: 'email', value: draft.email, onChange: e => set('email', e.target.value) })),
    ),
    React.createElement(window.ColorPicker, { label: 'Avatar color', value: draft.color, onChange: v => set('color', v) }),
    React.createElement('hr', { className: 'divider' }),
    React.createElement('label', { className: 'mochi-field__label' }, 'Enrolled classes'),
    React.createElement('div', { style: { marginTop: 8 } },
      React.createElement(TokenSearch, { items: classes, selectedIds: draft.classIds, onToggle: toggle, placeholder: 'Search classes by name\u2026', emptyHint: 'All classes added' }),
    ),
  );
}

function StaffModal({ draft, setDraft, onClose, onSave }) {
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  return React.createElement(window.Modal, {
    open: true, onClose, title: draft.id ? 'Edit staff' : 'Add staff', width: 520,
    footer: React.createElement(React.Fragment, null,
      React.createElement(MBtn, { variant: 'secondary', onClick: onClose }, 'Cancel'),
      React.createElement(MBtn, { variant: 'primary', onClick: () => onSave(draft) }, 'Save'),
    ),
  },
    React.createElement('div', { className: 'mochi-field' },
      React.createElement('label', { className: 'mochi-field__label' }, 'Full name'),
      React.createElement('input', { className: 'mochi-input', autoFocus: true, value: draft.name, onChange: e => set('name', e.target.value) }),
    ),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, 'Email'), React.createElement('input', { className: 'mochi-input', type: 'email', value: draft.email, onChange: e => set('email', e.target.value) })),
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, 'Phone'), React.createElement('input', { className: 'mochi-input', type: 'tel', value: draft.phone || '', onChange: e => set('phone', e.target.value) })),
    ),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement(window.MSelect, { label: 'Role', value: draft.role, onChange: v => set('role', v), options: [{ value: 'Teacher', label: 'Teacher' }, { value: 'Admin', label: 'Admin' }, { value: 'Assistant', label: 'Assistant' }] }),
      React.createElement(window.ColorPicker, { label: 'Avatar color', value: draft.color, onChange: v => set('color', v) }),
    ),
  );
}

// ---- Reusable token search (type-ahead multi-select) ----
function TokenSearch({ items, selectedIds, onToggle, placeholder, emptyHint }) {
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
      selected.map(i => React.createElement('button', { key: i.id, type: 'button', onClick: () => onToggle(i.id), className: 'mchip', style: { cursor: 'pointer', gap: 6, border: '1.5px solid', borderColor: window.colorOf(i.color).base, background: window.colorOf(i.color).soft, color: window.colorOf(i.color).ink } },
        i.name,
        React.createElement(MIcon, { name: 'x', size: 13 }),
      )),
    ),
    React.createElement('div', { className: 'tokensearch__field' },
      React.createElement(MIcon, { name: 'search', size: 17 }),
      React.createElement('input', { className: 'tokensearch__input', placeholder: placeholder || 'Search\u2026', value: q,
        onChange: e => { setQ(e.target.value); setOpen(true); }, onFocus: () => setOpen(true) }),
    ),
    open && React.createElement('div', { className: 'tokensearch__menu' },
      matches.length > 0
        ? matches.slice(0, 6).map(i => React.createElement('button', { key: i.id, type: 'button', className: 'tokensearch__opt', onClick: () => pick(i.id) },
            React.createElement('span', { className: 'tokensearch__dot', style: { background: window.colorOf(i.color).base } }),
            React.createElement('span', { style: { flex: 1, textAlign: 'left' } }, i.name),
            React.createElement(MIcon, { name: 'plus', size: 14 }),
          ))
        : React.createElement('div', { className: 'tokensearch__empty' }, ql ? `No match for \u201c${q}\u201d` : (emptyHint || 'Nothing left to add')),
    ),
  );
}

function ParentModal({ draft, setDraft, onClose, onSave, students }) {
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const toggleKid = (id) => set('studentIds', (draft.studentIds || []).includes(id) ? draft.studentIds.filter(x => x !== id) : [...(draft.studentIds || []), id]);
  return React.createElement(window.Modal, {
    open: true, onClose, title: draft.id ? 'Edit parent' : 'Add parent', width: 540,
    footer: React.createElement(React.Fragment, null,
      React.createElement(MBtn, { variant: 'secondary', onClick: onClose }, 'Cancel'),
      React.createElement(MBtn, { variant: 'primary', onClick: () => onSave(draft) }, 'Save'),
    ),
  },
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, 'Full name'), React.createElement('input', { className: 'mochi-input', autoFocus: true, value: draft.name, onChange: e => set('name', e.target.value) })),
      React.createElement(window.MSelect, { label: 'Relation', value: draft.relation, onChange: v => set('relation', v), options: [{ value: 'Mother', label: 'Mother' }, { value: 'Father', label: 'Father' }, { value: 'Guardian', label: 'Guardian' }, { value: 'Other', label: 'Other' }] }),
    ),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, 'Email'), React.createElement('input', { className: 'mochi-input', type: 'email', value: draft.email, onChange: e => set('email', e.target.value) })),
      React.createElement('div', { className: 'mochi-field' }, React.createElement('label', { className: 'mochi-field__label' }, 'Phone'), React.createElement('input', { className: 'mochi-input', type: 'tel', value: draft.phone || '', onChange: e => set('phone', e.target.value) })),
    ),
    React.createElement(window.ColorPicker, { label: 'Avatar color', value: draft.color, onChange: v => set('color', v) }),
    React.createElement('hr', { className: 'divider' }),
    React.createElement('label', { className: 'mochi-field__label' }, 'Children'),
    React.createElement('div', { style: { marginTop: 8 } },
      React.createElement(TokenSearch, { items: students, selectedIds: draft.studentIds || [], onToggle: toggleKid, placeholder: 'Search students by name\u2026', emptyHint: 'All students linked' }),
    ),
  );
}

// ---- Invites ----
function InvitesPanel() {
  const { data, remove } = useStore();
  const [copied, setCopied] = React.useState(null);
  const copy = (code) => { navigator.clipboard && navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(null), 1500); };
  const classOf = (id) => (data.classes.find(c => c.id === id) || {}).name;
  if (!data.invites.length) return React.createElement(MC, null, React.createElement(window.Empty, { icon: 'key', title: 'No invite codes yet', sub: 'Generate a one-time code to onboard a student or parent.' }));
  return React.createElement('div', { className: 'm-stack' },
    data.invites.map(inv => React.createElement('div', { key: inv.id, className: 'lrow' },
      React.createElement('div', { className: 'iconwrap', style: { background: inv.used ? 'var(--cream-200)' : 'var(--orange-100)', color: inv.used ? 'var(--taupe-500)' : 'var(--orange-700)' } }, React.createElement(MIcon, { name: 'key', size: 18 })),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { className: 'm-row', style: { gap: 10 } },
          React.createElement('span', { className: 'm-mono', style: { fontSize: 'var(--text-lg)', fontWeight: 500, letterSpacing: '0.08em', color: inv.used ? 'var(--text-disabled)' : 'var(--text-strong)', textDecoration: inv.used ? 'line-through' : 'none' } }, inv.code),
          React.createElement(MBadge, { color: inv.role === 'Parent' ? 'violet' : 'blue' }, inv.role),
          inv.used && React.createElement(MBadge, { color: 'neutral' }, 'Used'),
        ),
        React.createElement('div', { className: 'lrow__meta' }, inv.name || 'Unassigned', inv.classId && ` · ${classOf(inv.classId)}`),
      ),
      React.createElement('div', { className: 'lrow__actions' },
        !inv.used && React.createElement(MBtn, { variant: 'soft', size: 'sm', iconLeft: React.createElement(MIcon, { name: copied === inv.code ? 'check' : 'copy', size: 15 }), onClick: () => copy(inv.code) }, copied === inv.code ? 'Copied' : 'Copy'),
        React.createElement(MIB, { label: 'Revoke', size: 'sm', onClick: () => remove('invites', inv.id) }, React.createElement(MIcon, { name: 'trash', size: 16 })),
      ),
    )),
  );
}

function InviteModal({ onClose }) {
  const { data, add } = useStore();
  const [role, setRole] = React.useState('Student');
  const [name, setName] = React.useState('');
  const [classId, setClassId] = React.useState('');
  const [generated, setGenerated] = React.useState(null);
  const gen = () => { const code = window.makeCode(); const item = { code, role, name, classId: classId || null, createdAt: iso(window.MOCHI_DATE.TODAY), used: false }; add('invites', item); setGenerated(code); };
  const copy = () => navigator.clipboard && navigator.clipboard.writeText(generated);

  return React.createElement(window.Modal, {
    open: true, onClose, title: 'Generate invite code', width: 480,
    footer: generated
      ? React.createElement(MBtn, { variant: 'primary', onClick: onClose }, 'Done')
      : React.createElement(React.Fragment, null,
          React.createElement(MBtn, { variant: 'secondary', onClick: onClose }, 'Cancel'),
          React.createElement(MBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'sparkle', size: 16 }), onClick: gen }, 'Generate code'),
        ),
  },
    generated
      ? React.createElement('div', { style: { textAlign: 'center', padding: '10px 0' } },
          React.createElement('p', { className: 'm-muted', style: { fontSize: 'var(--text-sm)' } }, `Share this one-time code with your ${role.toLowerCase()}. It works once.`),
          React.createElement('div', { style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-4xl)', fontWeight: 500, letterSpacing: '0.12em', color: 'var(--brand-soft-ink)', background: 'var(--orange-100)', borderRadius: 'var(--radius-lg)', padding: '20px', margin: '12px 0' } }, generated),
          React.createElement(MBtn, { variant: 'soft', iconLeft: React.createElement(MIcon, { name: 'copy', size: 16 }), onClick: copy }, 'Copy to clipboard'),
        )
      : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'mochi-field' },
            React.createElement('label', { className: 'mochi-field__label' }, 'Invite as'),
            React.createElement(window.MochiDesignSystem_472b36.Tabs, { value: role, onChange: setRole, tabs: [{ id: 'Student', label: 'Student' }, { id: 'Staff', label: 'Staff' }, { id: 'Parent', label: 'Parent' }] }),
          ),
          React.createElement('div', { className: 'mochi-field' },
            React.createElement('label', { className: 'mochi-field__label' }, 'Name (optional)'),
            React.createElement('input', { className: 'mochi-input', placeholder: `${role} name`, value: name, onChange: e => setName(e.target.value) }),
          ),
          React.createElement(window.MSelect, { label: 'Link to class (optional)', value: classId, onChange: setClassId, options: [{ value: '', label: 'No class' }, ...data.classes.map(c => ({ value: c.id, label: c.name }))] }),
        ),
  );
}

window.ClassesScreen = ClassesScreen;
window.StudentsScreen = StudentsScreen;

import { React, DS } from './lib/globals.js';
import { MIcon } from './icons.js';
import { useStore } from './store.js';
import { Modal, MSelect, ColorPicker, PageHeader, Empty } from './ui.js';
import { colorOf, iso, TODAY, ICON_TINT } from './lib/core.js';
import { useLang, LanguageToggle } from './lib/i18n.js';

// app/screens-extra.jsx — Materials (with download) + reusable Calendar theme panel + Profile page
const { Card: XC, Button: XBtn, IconButton: XIB, Tag: XTag, Badge: XBadge, Switch: XSw, Avatar: XAvatar } = DS;

const MAT_TYPES = {
  notes:     { icon: 'file',      tk: 'type_notes',     color: 'blue' },
  worksheet: { icon: 'clipboard', tk: 'type_worksheet', color: 'green' },
  video:     { icon: 'video',     tk: 'type_video',     color: 'violet' },
  link:      { icon: 'link',      tk: 'type_link',      color: 'orange' },
};

function downloadMaterial(m) {
  let href = m.fileData;
  let revoke = false;
  let name = m.fileName || (m.title || 'material').replace(/\s+/g, '_');
  if (!href) {
    const blob = new Blob([`Mochi material\n\nTitle: ${m.title}\nType: ${m.type}\n\n(This demo did not store the original file bytes. Re-upload the file to download the real document.)`], { type: 'text/plain' });
    href = URL.createObjectURL(blob); revoke = true;
    if (!/\.\w+$/.test(name)) name += '.txt';
  }
  const a = document.createElement('a');
  a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 2000);
}

// ============================================================ MATERIALS ============================================================
function MaterialsScreen() {
  const { data, add, update, remove } = useStore();
  const { t } = useLang();
  const [filterClass, setFilterClass] = React.useState('all');
  const [filterType, setFilterType] = React.useState('all');
  const [favOnly, setFavOnly] = React.useState(false);
  const [modal, setModal] = React.useState(null);
  const className = (id) => (data.classes.find(c => c.id === id) || {}).name || t('mat_unfiled');

  let list = data.materials;
  if (filterClass !== 'all') list = list.filter(m => m.classId === filterClass);
  if (filterType !== 'all') list = list.filter(m => m.type === filterType);
  if (favOnly) list = list.filter(m => m.favorite);

  const openNew = () => setModal({ title: '', type: 'notes', classId: data.classes[0]?.id || '', url: '', fileName: '', fileData: '', favorite: false, addedAt: iso(TODAY) });
  const save = (f) => { if (!f.title.trim()) f.title = t('mat_untitled'); if (f.id) update('materials', f.id, f); else add('materials', f); setModal(null); };

  return React.createElement('div', { className: 'content' },
    React.createElement(PageHeader, {
      title: t('mat_title'), subtitle: t('mat_sub'),
      actions: React.createElement(XBtn, { variant: 'primary', iconLeft: React.createElement(MIcon, { name: 'plus', size: 18 }), onClick: openNew }, t('mat_add')),
    }),
    React.createElement('div', { className: 'cal-toolbar' },
      React.createElement('div', { style: { minWidth: 180 } }, React.createElement(MSelect, { value: filterClass, onChange: setFilterClass, options: [{ value: 'all', label: t('mat_all_classes') }, ...data.classes.map(c => ({ value: c.id, label: c.name }))] })),
      React.createElement('div', { style: { minWidth: 150 } }, React.createElement(MSelect, { value: filterType, onChange: setFilterType, options: [{ value: 'all', label: t('mat_all_types') }, ...Object.entries(MAT_TYPES).map(([k, v]) => ({ value: k, label: t(v.tk) }))] })),
      React.createElement('span', { style: { flex: 1 } }),
      React.createElement(XSw, { checked: favOnly, onChange: e => setFavOnly(e.target.checked), label: t('mat_fav_only') }),
    ),
    list.length ? React.createElement('div', { className: 'm-grid cols-3' },
      list.map(m => {
        const mt = MAT_TYPES[m.type];
        const isLink = m.type === 'link' || m.type === 'video';
        return React.createElement(XC, { key: m.id, interactive: true },
          React.createElement('div', { className: 'm-spread', style: { alignItems: 'flex-start', marginBottom: 12 } },
            React.createElement('div', { className: 'iconwrap', style: { width: 44, height: 44, ...ICON_TINT(mt.color) } }, React.createElement(MIcon, { name: mt.icon, size: 20 })),
            React.createElement('button', { className: 'starbtn' + (m.favorite ? ' is-on' : ''), onClick: () => update('materials', m.id, { favorite: !m.favorite }), title: t('mat_fav_only') }, React.createElement(MIcon, { name: m.favorite ? 'starFill' : 'star', size: 18 })),
          ),
          React.createElement('h3', { style: { margin: '0 0 6px', fontSize: 'var(--text-md)' } }, m.title),
          React.createElement('div', { className: 'lrow__meta', style: { marginBottom: 14 } },
            React.createElement('span', { className: 'mchip' }, t(mt.tk)),
            React.createElement(XTag, { dot: true, color: (data.classes.find(c => c.id === m.classId) || {}).color || 'neutral' }, className(m.classId)),
          ),
          React.createElement('div', { className: 'm-spread' },
            isLink
              ? React.createElement('a', { href: m.url || '#', target: '_blank', rel: 'noreferrer', className: 'm-row', style: { gap: 6, fontSize: 'var(--text-sm)', fontWeight: 700 } }, React.createElement(MIcon, { name: 'link', size: 14 }), t('mat_open_link'))
              : React.createElement('button', { className: 'm-row', style: { gap: 6, fontSize: 'var(--text-sm)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-link)', padding: 0, fontFamily: 'inherit' }, onClick: () => downloadMaterial(m), title: t('mat_download') }, React.createElement(MIcon, { name: 'download', size: 15 }), t('mat_download')),
            React.createElement('div', { className: 'lrow__actions' },
              React.createElement(XIB, { label: t('edit'), size: 'sm', onClick: () => setModal({ ...m }) }, React.createElement(MIcon, { name: 'edit', size: 15 })),
              React.createElement(XIB, { label: t('delete'), size: 'sm', onClick: () => remove('materials', m.id) }, React.createElement(MIcon, { name: 'trash', size: 15 })),
            ),
          ),
        );
      }),
    ) : React.createElement(XC, null, React.createElement(Empty, { icon: 'folder', title: t('mat_none_title'), sub: t('mat_none_sub') })),

    modal && React.createElement(MaterialModal, { draft: modal, setDraft: setModal, onClose: () => setModal(null), onSave: save, classes: data.classes }),
  );
}

function MaterialModal({ draft, setDraft, onClose, onSave, classes }) {
  const { t } = useLang();
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const isLink = draft.type === 'link' || draft.type === 'video';
  const onFile = (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 4 * 1024 * 1024) { setDraft(d => ({ ...d, fileName: f.name, fileData: '' })); return; } // too big to embed; keep name only
    const r = new FileReader(); r.onload = () => setDraft(d => ({ ...d, fileName: f.name, fileData: r.result })); r.readAsDataURL(f);
  };
  return React.createElement(Modal, {
    open: true, onClose, title: draft.id ? t('mat_edit') : t('mat_add'), width: 520,
    footer: React.createElement(React.Fragment, null,
      React.createElement(XBtn, { variant: 'secondary', onClick: onClose }, t('cancel')),
      React.createElement(XBtn, { variant: 'primary', onClick: () => onSave(draft) }, t('save')),
    ),
  },
    React.createElement('div', { className: 'mochi-field' },
      React.createElement('label', { className: 'mochi-field__label' }, t('mat_title_lbl')),
      React.createElement('input', { className: 'mochi-input', autoFocus: true, value: draft.title, onChange: e => set('title', e.target.value) }),
    ),
    React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
      React.createElement(MSelect, { label: t('mat_type'), value: draft.type, onChange: v => set('type', v), options: Object.entries(MAT_TYPES).map(([k, v]) => ({ value: k, label: t(v.tk) })) }),
      React.createElement(MSelect, { label: t('class'), value: draft.classId, onChange: v => set('classId', v), options: classes.map(c => ({ value: c.id, label: c.name })) }),
    ),
    isLink
      ? React.createElement('div', { className: 'mochi-field' },
          React.createElement('label', { className: 'mochi-field__label' }, t('mat_url')),
          React.createElement('input', { className: 'mochi-input', placeholder: 'https://…', value: draft.url, onChange: e => set('url', e.target.value) }),
        )
      : React.createElement('div', { className: 'mochi-field' },
          React.createElement('label', { className: 'mochi-field__label' }, t('mat_file')),
          React.createElement('label', { className: 'm-row', style: { gap: 10, padding: '14px', border: '1.5px dashed var(--border-strong)', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--text-muted)' } },
            React.createElement(MIcon, { name: draft.fileName ? 'file' : 'upload', size: 18 }),
            React.createElement('span', { style: { fontSize: 'var(--text-sm)', fontWeight: 600, color: draft.fileName ? 'var(--text-strong)' : 'var(--text-muted)' } }, draft.fileName || t('mat_choose_file')),
            React.createElement('input', { type: 'file', style: { display: 'none' }, onChange: onFile }),
          ),
          draft.fileName && React.createElement('span', { className: 'mochi-field__hint' }, draft.fileData ? t('mat_stored') : t('mat_too_large')),
        ),
  );
}

// ============================================================ CALENDAR THEME (reusable) ============================================================
const PRESETS = {
  cream:    { tk: 'preset_cream', bg: '#FFFCF8', gridLine: '#ECE0CF', today: '#FFE7D1', header: '#FDF6EC', swatches: ['#FFFCF8', '#FFE7D1', '#F79A4E'] },
  sky:      { tk: 'preset_sky',   bg: '#F4FAFD', gridLine: '#D6ECF6', today: '#D6ECF6', header: '#ECF6FB', swatches: ['#F4FAFD', '#D6ECF6', '#57A7D2'] },
  meadow:   { tk: 'preset_meadow', bg: '#F5FBF5', gridLine: '#D9F0DB', today: '#D9F0DB', header: '#EEF8EE', swatches: ['#F5FBF5', '#D9F0DB', '#6FB97A'] },
  lavender: { tk: 'preset_lavender', bg: '#F8F6FE', gridLine: '#E8E0FD', today: '#E8E0FD', header: '#F4F0FE', swatches: ['#F8F6FE', '#E8E0FD', '#A185E4'] },
  dusk:     { tk: 'preset_dusk',  bg: '#2E2A33', gridLine: '#43404B', today: '#3C3845', header: '#34303B', swatches: ['#2E2A33', '#43404B', '#A185E4'] },
};

// A single color row. Defined at module scope (stable identity) so live theme
// updates re-render via props instead of remounting the <input type=color>.
function ThemeColorRow({ value, label, sub, onChange }) {
  return React.createElement('div', { className: 'colorrow' },
    React.createElement('input', { type: 'color', value, onChange: e => onChange(e.target.value) }),
    React.createElement('div', { style: { flex: 1 } },
      React.createElement('div', { className: 'colorrow__label' }, label),
      React.createElement('div', { className: 'colorrow__sub' }, sub),
    ),
    React.createElement('span', { className: 'm-mono m-muted', style: { fontSize: 'var(--text-xs)' } }, String(value).toUpperCase()),
  );
}

// Renders the full theme editor body (presets + color pickers + background image). Used inside the Calendar "Customize" modal.
function CalendarThemePanel() {
  const { data, setTheme } = useStore();
  const { t } = useLang();
  const theme = data.theme;
  const matchPreset = Object.entries(PRESETS).find(([, p]) => p.bg === theme.bg && p.gridLine === theme.gridLine && p.today === theme.today)?.[0];
  const applyPreset = (key) => { const p = PRESETS[key]; setTheme({ bg: p.bg, gridLine: p.gridLine, today: p.today, header: p.header }); };

  return React.createElement('div', null,
    React.createElement('div', { className: 'mochi-eyebrow', style: { marginBottom: 8 } }, t('theme_presets')),
    React.createElement('div', { className: 'theme-preset', style: { marginBottom: 20 } },
      Object.entries(PRESETS).map(([key, p]) =>
        React.createElement('button', { key, className: 'preset' + (matchPreset === key ? ' is-active' : ''), onClick: () => applyPreset(key) },
          React.createElement('div', { className: 'preset__swatches' }, p.swatches.map((s, i) => React.createElement('span', { key: i, style: { background: s } }))),
          React.createElement('div', { className: 'preset__name' }, t(p.tk)),
        ),
      ),
    ),
    React.createElement('div', { className: 'mochi-eyebrow', style: { marginBottom: 4 } }, t('theme_finetune')),
    React.createElement(ThemeColorRow, { value: theme.bg, label: t('theme_canvas'), sub: t('theme_canvas_sub'), onChange: v => setTheme({ bg: v }) }),
    React.createElement(ThemeColorRow, { value: theme.header, label: t('theme_dayheader'), sub: t('theme_dayheader_sub'), onChange: v => setTheme({ header: v }) }),
    React.createElement(ThemeColorRow, { value: theme.gridLine, label: t('theme_grid'), sub: t('theme_grid_sub'), onChange: v => setTheme({ gridLine: v }) }),
    React.createElement(ThemeColorRow, { value: theme.today, label: t('theme_today'), sub: t('theme_today_sub'), onChange: v => setTheme({ today: v }) }),
    React.createElement('hr', { className: 'divider', style: { margin: '18px 0 14px' } }),
    React.createElement('div', { className: 'mochi-eyebrow', style: { marginBottom: 8 } }, t('theme_bgimage')),
    React.createElement('div', { className: 'mochi-field' },
      React.createElement('label', { className: 'mochi-field__label' }, t('theme_imgurl')),
      React.createElement('input', { className: 'mochi-input', placeholder: t('theme_imgurl_ph'), value: theme.bgImage, onChange: e => setTheme({ bgImage: e.target.value }) }),
    ),
    React.createElement('label', { className: 'm-row', style: { gap: 10, padding: '12px', border: '1.5px dashed var(--border-strong)', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--text-muted)', marginBottom: 14 } },
      React.createElement(MIcon, { name: 'upload', size: 18 }),
      React.createElement('span', { style: { fontSize: 'var(--text-sm)', fontWeight: 600 } }, t('theme_upload_img')),
      React.createElement('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: e => { const f = e.target.files[0]; if (f) { const r = new FileReader(); r.onload = () => setTheme({ bgImage: r.result }); r.readAsDataURL(f); } } }),
    ),
    React.createElement('div', { className: 'mochi-field' },
      React.createElement('div', { className: 'm-spread' },
        React.createElement('label', { className: 'mochi-field__label', style: { margin: 0 } }, t('theme_opacity')),
        React.createElement('span', { className: 'm-mono m-muted', style: { fontSize: 'var(--text-xs)' } }, Math.round(theme.bgOpacity * 100) + '%'),
      ),
      React.createElement('input', { type: 'range', min: 0, max: 0.6, step: 0.02, value: theme.bgOpacity, onChange: e => setTheme({ bgOpacity: Number(e.target.value) }), style: { width: '100%', accentColor: 'var(--brand)' } }),
    ),
    theme.bgImage && React.createElement(XBtn, { variant: 'ghost', size: 'sm', iconLeft: React.createElement(MIcon, { name: 'x', size: 15 }), onClick: () => setTheme({ bgImage: '' }) }, t('theme_remove_img')),
  );
}

// ============================================================ PROFILE ============================================================
function ProfileScreen({ user, onSave, onLogout }) {
  const { t } = useLang();
  const [f, setF] = React.useState(() => ({ name: user.name, email: user.email || '', phone: user.phone || '', color: user.color || 'orange' }));
  const [saved, setSaved] = React.useState(false);
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setSaved(false); };
  const dirty = f.name !== user.name || f.email !== (user.email || '') || f.phone !== (user.phone || '') || f.color !== user.color;
  const doSave = () => { onSave({ name: f.name.trim() || user.name, email: f.email, phone: f.phone, color: f.color }); setSaved(true); };

  return React.createElement('div', { className: 'content', style: { maxWidth: 920 } },
    React.createElement(PageHeader, { title: t('prof_title'), subtitle: t('prof_sub') }),
    React.createElement('div', { className: 'm-grid profile-grid', style: { gridTemplateColumns: 'minmax(0,300px) minmax(0,1fr)' } },
      // Avatar card
      React.createElement(XC, { style: { textAlign: 'center' } },
        React.createElement('div', { style: { display: 'grid', placeItems: 'center', marginBottom: 16 } },
          React.createElement(XAvatar, { name: f.name, color: f.color, size: 'xl' }),
        ),
        React.createElement('div', { style: { fontWeight: 800, color: 'var(--text-strong)', fontSize: 'var(--text-lg)' } }, f.name),
        React.createElement('div', { className: 'm-muted', style: { fontSize: 'var(--text-sm)', marginBottom: 16 } }, t('role_' + String(user.role || '').toLowerCase())),
        React.createElement('div', { style: { display: 'grid', placeItems: 'center' } },
          React.createElement(ColorPicker, { label: t('prof_avatar_color'), value: f.color, onChange: v => set('color', v) }),
        ),
      ),
      // Details card
      React.createElement('div', { className: 'm-stack', style: { gap: 20 } },
        React.createElement(XC, null,
          React.createElement('h2', { style: { margin: '0 0 16px', fontSize: 'var(--text-xl)' } }, t('prof_personal')),
          React.createElement('div', { className: 'mochi-field' },
            React.createElement('label', { className: 'mochi-field__label' }, t('prof_fullname')),
            React.createElement('input', { className: 'mochi-input', value: f.name, onChange: e => set('name', e.target.value) }),
          ),
          React.createElement('div', { className: 'm-grid cols-2', style: { gap: 14 } },
            React.createElement('div', { className: 'mochi-field' },
              React.createElement('label', { className: 'mochi-field__label' }, t('prof_email')),
              React.createElement('input', { className: 'mochi-input', type: 'email', value: f.email, onChange: e => set('email', e.target.value) }),
            ),
            React.createElement('div', { className: 'mochi-field' },
              React.createElement('label', { className: 'mochi-field__label' }, t('prof_phone')),
              React.createElement('input', { className: 'mochi-input', type: 'tel', value: f.phone, onChange: e => set('phone', e.target.value) }),
            ),
          ),
          React.createElement('div', { className: 'm-row', style: { gap: 12, marginTop: 6 } },
            React.createElement(XBtn, { variant: 'primary', onClick: doSave, disabled: !dirty }, saved && !dirty ? t('prof_saved') : t('prof_save')),
            saved && !dirty && React.createElement('span', { className: 'm-muted', style: { fontSize: 'var(--text-sm)' } }, t('prof_uptodate')),
          ),
        ),
        React.createElement(XC, null,
          React.createElement('div', { className: 'm-spread' },
            React.createElement('div', null,
              React.createElement('h2', { style: { margin: '0 0 4px', fontSize: 'var(--text-xl)' } }, t('language')),
              React.createElement('p', { className: 'm-muted', style: { fontSize: 'var(--text-sm)', margin: 0 } }, t('prof_lang_sub')),
            ),
            React.createElement(LanguageToggle, null),
          ),
        ),
        React.createElement(XC, null,
          React.createElement('h2', { style: { margin: '0 0 4px', fontSize: 'var(--text-xl)' } }, t('prof_account')),
          React.createElement('p', { className: 'm-muted', style: { fontSize: 'var(--text-sm)', marginTop: 0 } }, t('prof_account_sub')),
          React.createElement('div', { className: 'm-row', style: { gap: 12 } },
            React.createElement(XBtn, { variant: 'danger', iconLeft: React.createElement(MIcon, { name: 'logout', size: 16 }), onClick: onLogout }, t('prof_logout')),
          ),
        ),
      ),
    ),
  );
}


export { MaterialsScreen, CalendarThemePanel, ProfileScreen };

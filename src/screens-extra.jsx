import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { Modal, MSelect, ColorPicker, PageHeader, Empty } from './ui.jsx';
import { iso, TODAY, ICON_TINT } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';

// app/screens-extra.jsx — Materials (with download) + reusable Calendar theme panel + Profile page
const { Card: XC, Button: XBtn, IconButton: XIB, Tag: XTag, Switch: XSw, Avatar: XAvatar } = DS;

const MAT_TYPES = {
  notes: { icon: 'file', tk: 'type_notes', color: 'blue' },
  worksheet: { icon: 'clipboard', tk: 'type_worksheet', color: 'green' },
  video: { icon: 'video', tk: 'type_video', color: 'violet' },
  link: { icon: 'link', tk: 'type_link', color: 'orange' },
};

// ============================================================ MATERIALS ============================================================
function MaterialCard({ m, classes, onEdit, onDelete, t }) {
  const favFetcher = useFetcher();
  const optimisticFav = favFetcher.formData
    ? favFetcher.formData.get('favorite') === 'true'
    : m.favorite;
  const mt = MAT_TYPES[m.type] || MAT_TYPES.notes;
  const isLink = m.type === 'link' || m.type === 'video';
  const cls = classes.find((c) => c.id === m.classId);

  const toggleFav = () => {
    const fd = new FormData();
    fd.set('intent', 'update');
    fd.set('id', m.id);
    fd.set('favorite', String(!optimisticFav));
    favFetcher.submit(fd, { action: '/materials', method: 'post' });
  };

  return (
    <XC interactive>
      <div className="m-spread" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
        <div className="iconwrap" style={{ width: 44, height: 44, ...ICON_TINT(mt.color) }}>
          <MIcon name={mt.icon} size={20} />
        </div>
        <button
          className={'starbtn' + (optimisticFav ? ' is-on' : '')}
          onClick={toggleFav}
          title={t('mat_fav_only')}
        >
          <MIcon name={optimisticFav ? 'starFill' : 'star'} size={18} />
        </button>
      </div>
      <h3 style={{ margin: '0 0 6px', fontSize: 'var(--text-md)' }}>{m.title}</h3>
      <div className="lrow__meta" style={{ marginBottom: 14 }}>
        <span className="mchip">{t(mt.tk)}</span>
        <XTag dot color={cls?.color || 'neutral'}>
          {cls?.name || t('mat_unfiled')}
        </XTag>
      </div>
      <div className="m-spread">
        {isLink ? (
          <a
            href={m.url || '#'}
            target="_blank"
            rel="noreferrer"
            className="m-row"
            style={{ gap: 6, fontSize: 'var(--text-sm)', fontWeight: 700 }}
          >
            <MIcon name="link" size={14} />
            {t('mat_open_link')}
          </a>
        ) : m.fileKey ? (
          <a
            href={`/materials/${m.id}/download`}
            className="m-row"
            style={{ gap: 6, fontSize: 'var(--text-sm)', fontWeight: 700 }}
            title={t('mat_download')}
          >
            <MIcon name="download" size={15} />
            {t('mat_download')}
          </a>
        ) : null}
        <div className="lrow__actions">
          <XIB label={t('edit')} size="sm" onClick={onEdit}>
            <MIcon name="edit" size={15} />
          </XIB>
          <XIB label={t('delete')} size="sm" onClick={onDelete}>
            <MIcon name="trash" size={15} />
          </XIB>
        </div>
      </div>
    </XC>
  );
}

function MaterialsScreen() {
  const { materials: matList, classes } = useLoaderData();
  const fetcher = useFetcher();
  const { t } = useLang();
  const [filterClass, setFilterClass] = React.useState('all');
  const [filterType, setFilterType] = React.useState('all');
  const [favOnly, setFavOnly] = React.useState(false);
  const [modal, setModal] = React.useState(null);

  let list = matList;
  if (filterClass !== 'all') list = list.filter((m) => m.classId === filterClass);
  if (filterType !== 'all') list = list.filter((m) => m.type === filterType);
  if (favOnly) list = list.filter((m) => m.favorite);

  const openNew = () =>
    setModal({
      title: '',
      type: 'notes',
      classId: classes[0]?.id || '',
      url: '',
      fileName: '',
      favorite: false,
      addedAt: iso(TODAY),
    });

  const save = (f) => {
    const title = f.title.trim() || t('mat_untitled');
    const fd = new FormData();
    fd.set('intent', f.id ? 'update' : 'create');
    if (f.id) fd.set('id', f.id);
    fd.set('title', title);
    fd.set('type', f.type);
    if (f.classId) fd.set('classId', f.classId);
    if (f.url) fd.set('url', f.url);
    if (f.fileField) {
      fd.set('file', f.fileField, f.fileField.name);
    } else if (f.fileName) {
      fd.set('fileName', f.fileName);
    }
    fd.set('favorite', String(!!f.favorite));
    if (f.addedAt) fd.set('addedAt', f.addedAt);
    fetcher.submit(fd, { action: '/materials', method: 'post' });
    setModal(null);
  };

  const removeMat = (id) => {
    const fd = new FormData();
    fd.set('intent', 'delete');
    fd.set('id', id);
    fetcher.submit(fd, { action: '/materials', method: 'post' });
  };

  return (
    <div className="content">
      <PageHeader
        title={t('mat_title')}
        subtitle={t('mat_sub')}
        actions={
          <XBtn variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openNew}>
            {t('mat_add')}
          </XBtn>
        }
      />
      <div className="cal-toolbar">
        <div style={{ minWidth: 180 }}>
          <MSelect
            value={filterClass}
            onChange={setFilterClass}
            options={[
              { value: 'all', label: t('mat_all_classes') },
              ...classes.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <div style={{ minWidth: 150 }}>
          <MSelect
            value={filterType}
            onChange={setFilterType}
            options={[
              { value: 'all', label: t('mat_all_types') },
              ...Object.entries(MAT_TYPES).map(([k, v]) => ({ value: k, label: t(v.tk) })),
            ]}
          />
        </div>
        <span style={{ flex: 1 }} />
        <XSw
          checked={favOnly}
          onChange={(e) => setFavOnly(e.target.checked)}
          label={t('mat_fav_only')}
        />
      </div>
      {list.length ? (
        <div className="m-grid cols-3">
          {list.map((m) => (
            <MaterialCard
              key={m.id}
              m={m}
              classes={classes}
              onEdit={() => setModal({ ...m })}
              onDelete={() => removeMat(m.id)}
              t={t}
            />
          ))}
        </div>
      ) : (
        <XC>
          <Empty icon="folder" title={t('mat_none_title')} sub={t('mat_none_sub')} />
        </XC>
      )}

      {modal && (
        <MaterialModal
          draft={modal}
          setDraft={setModal}
          onClose={() => setModal(null)}
          onSave={save}
          classes={classes}
        />
      )}
    </div>
  );
}

function MaterialModal({ draft, setDraft, onClose, onSave, classes }) {
  const { t } = useLang();
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const isLink = draft.type === 'link' || draft.type === 'video';
  const [fileSizeError, setFileSizeError] = React.useState(false);
  const MAX_UPLOAD = 20 * 1024 * 1024;
  const onFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_UPLOAD) {
      setFileSizeError(true);
      return;
    }
    setFileSizeError(false);
    setDraft((d) => ({ ...d, fileName: f.name, fileField: f }));
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={draft.id ? t('mat_edit') : t('mat_add')}
      width={520}
      footer={
        <>
          <XBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </XBtn>
          <XBtn variant="primary" onClick={() => onSave(draft)}>
            {t('save')}
          </XBtn>
        </>
      }
    >
      <div className="mochi-field">
        <label className="mochi-field__label">{t('mat_title_lbl')}</label>
        <input
          className="mochi-input"
          autoFocus
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </div>
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <MSelect
          label={t('mat_type')}
          value={draft.type}
          onChange={(v) => set('type', v)}
          options={Object.entries(MAT_TYPES).map(([k, v]) => ({ value: k, label: t(v.tk) }))}
        />
        <MSelect
          label={t('class')}
          value={draft.classId}
          onChange={(v) => set('classId', v)}
          options={classes.map((c) => ({ value: c.id, label: c.name }))}
        />
      </div>
      {isLink ? (
        <div className="mochi-field">
          <label className="mochi-field__label">{t('mat_url')}</label>
          <input
            className="mochi-input"
            placeholder="https://…"
            value={draft.url}
            onChange={(e) => set('url', e.target.value)}
          />
        </div>
      ) : (
        <div className="mochi-field">
          <label className="mochi-field__label">{t('mat_file')}</label>
          <label
            className="m-row"
            style={{
              gap: 10,
              padding: '14px',
              border: '1.5px dashed var(--border-strong)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              color: 'var(--text-muted)',
            }}
          >
            <MIcon name={draft.fileName ? 'file' : 'upload'} size={18} />
            <span
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: draft.fileName ? 'var(--text-strong)' : 'var(--text-muted)',
              }}
            >
              {draft.fileName || t('mat_choose_file')}
            </span>
            <input type="file" style={{ display: 'none' }} onChange={onFile} />
          </label>
          {fileSizeError && (
            <span className="mochi-field__hint" style={{ color: 'var(--color-red-600)' }}>
              {t('mat_too_large')}
            </span>
          )}
          {!fileSizeError && draft.fileField && (
            <span className="mochi-field__hint">{t('mat_stored')}</span>
          )}
        </div>
      )}
    </Modal>
  );
}

// ============================================================ CALENDAR THEME (reusable) ============================================================
const PRESETS = {
  cream: {
    tk: 'preset_cream',
    bg: '#FFFCF8',
    gridLine: '#ECE0CF',
    today: '#FFE7D1',
    header: '#FDF6EC',
    swatches: ['#FFFCF8', '#FFE7D1', '#F79A4E'],
  },
  sky: {
    tk: 'preset_sky',
    bg: '#F4FAFD',
    gridLine: '#D6ECF6',
    today: '#D6ECF6',
    header: '#ECF6FB',
    swatches: ['#F4FAFD', '#D6ECF6', '#57A7D2'],
  },
  meadow: {
    tk: 'preset_meadow',
    bg: '#F5FBF5',
    gridLine: '#D9F0DB',
    today: '#D9F0DB',
    header: '#EEF8EE',
    swatches: ['#F5FBF5', '#D9F0DB', '#6FB97A'],
  },
  lavender: {
    tk: 'preset_lavender',
    bg: '#F8F6FE',
    gridLine: '#E8E0FD',
    today: '#E8E0FD',
    header: '#F4F0FE',
    swatches: ['#F8F6FE', '#E8E0FD', '#A185E4'],
  },
  dusk: {
    tk: 'preset_dusk',
    bg: '#2E2A33',
    gridLine: '#43404B',
    today: '#3C3845',
    header: '#34303B',
    swatches: ['#2E2A33', '#43404B', '#A185E4'],
  },
};

// A single color row. Defined at module scope (stable identity) so live theme
// updates re-render via props instead of remounting the <input type=color>.
function ThemeColorRow({ value, label, sub, onChange, onCommit }) {
  return (
    <div className="colorrow">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit ? (e) => onCommit(e.target.value) : undefined}
      />
      <div style={{ flex: 1 }}>
        <div className="colorrow__label">{label}</div>
        <div className="colorrow__sub">{sub}</div>
      </div>
      <span className="m-mono m-muted" style={{ fontSize: 'var(--text-xs)' }}>
        {String(value).toUpperCase()}
      </span>
    </div>
  );
}

// Renders the full theme editor body (presets + color pickers + background image). Used inside the Calendar "Customize" modal.
function CalendarThemePanel() {
  const { theme } = useLoaderData();
  const fetcher = useFetcher();
  const { t } = useLang();
  // Local draft for live preview. Initialized once from loader; not re-synced on
  // revalidation so in-progress edits are not clobbered by the server round-trip.
  const draftRef = React.useRef({ ...theme });
  const [draft, setDraftState] = React.useState(() => ({ ...theme }));

  const setField = (key, value) => {
    draftRef.current = { ...draftRef.current, [key]: value };
    setDraftState({ ...draftRef.current });
  };

  const submitNow = (patch = {}) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraftState(next);
    const fd = new FormData();
    fd.set('intent', 'theme');
    Object.entries(next).forEach(([k, v]) => {
      if (v !== null && v !== undefined) fd.set(k, String(v));
    });
    fetcher.submit(fd, { action: '/calendar', method: 'post' });
  };

  const matchPreset = Object.entries(PRESETS).find(
    ([, p]) => p.bg === draft.bg && p.gridLine === draft.gridLine && p.today === draft.today,
  )?.[0];

  const applyPreset = (key) => {
    const p = PRESETS[key];
    submitNow({ bg: p.bg, gridLine: p.gridLine, today: p.today, header: p.header });
  };

  return (
    <div>
      <div className="mochi-eyebrow" style={{ marginBottom: 8 }}>
        {t('theme_presets')}
      </div>
      <div className="theme-preset" style={{ marginBottom: 20 }}>
        {Object.entries(PRESETS).map(([key, p]) => (
          <button
            key={key}
            className={'preset' + (matchPreset === key ? ' is-active' : '')}
            onClick={() => applyPreset(key)}
          >
            <div className="preset__swatches">
              {p.swatches.map((s, i) => (
                <span key={i} style={{ background: s }} />
              ))}
            </div>
            <div className="preset__name">{t(p.tk)}</div>
          </button>
        ))}
      </div>
      <div className="mochi-eyebrow" style={{ marginBottom: 4 }}>
        {t('theme_finetune')}
      </div>
      <ThemeColorRow
        value={draft.bg}
        label={t('theme_canvas')}
        sub={t('theme_canvas_sub')}
        onChange={(v) => setField('bg', v)}
        onCommit={(v) => submitNow({ bg: v })}
      />
      <ThemeColorRow
        value={draft.header}
        label={t('theme_dayheader')}
        sub={t('theme_dayheader_sub')}
        onChange={(v) => setField('header', v)}
        onCommit={(v) => submitNow({ header: v })}
      />
      <ThemeColorRow
        value={draft.gridLine}
        label={t('theme_grid')}
        sub={t('theme_grid_sub')}
        onChange={(v) => setField('gridLine', v)}
        onCommit={(v) => submitNow({ gridLine: v })}
      />
      <ThemeColorRow
        value={draft.today}
        label={t('theme_today')}
        sub={t('theme_today_sub')}
        onChange={(v) => setField('today', v)}
        onCommit={(v) => submitNow({ today: v })}
      />
      <hr className="divider" style={{ margin: '18px 0 14px' }} />
      <div className="mochi-eyebrow" style={{ marginBottom: 8 }}>
        {t('theme_bgimage')}
      </div>
      <div className="mochi-field">
        <label className="mochi-field__label">{t('theme_imgurl')}</label>
        <input
          className="mochi-input"
          placeholder={t('theme_imgurl_ph')}
          value={draft.bgImage}
          onChange={(e) => setField('bgImage', e.target.value)}
          onBlur={() => submitNow()}
        />
      </div>
      <label
        className="m-row"
        style={{
          gap: 10,
          padding: '12px',
          border: '1.5px dashed var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          marginBottom: 14,
        }}
      >
        <MIcon name="upload" size={18} />
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{t('theme_upload_img')}</span>
        <input
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files[0];
            if (f) {
              const r = new FileReader();
              // Bump opacity to a clearly visible level on upload if it's still at
              // the subtle default, so the image is actually seen (not washed out).
              r.onload = () =>
                submitNow({
                  bgImage: r.result,
                  ...(draftRef.current.bgOpacity <= 0.15 ? { bgOpacity: 0.6 } : {}),
                });
              r.readAsDataURL(f);
            }
            e.target.value = '';
          }}
        />
      </label>
      <div className="mochi-field">
        <div className="m-spread">
          <label className="mochi-field__label" style={{ margin: 0 }}>
            {t('theme_opacity')}
          </label>
          <span className="m-mono m-muted" style={{ fontSize: 'var(--text-xs)' }}>
            {Math.round(draft.bgOpacity * 100) + '%'}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={draft.bgOpacity}
          onChange={(e) => setField('bgOpacity', Number(e.target.value))}
          onPointerUp={(e) => submitNow({ bgOpacity: Number(e.target.value) })}
          style={{ width: '100%', accentColor: 'var(--brand)' }}
        />
      </div>
      {draft.bgImage && (
        <XBtn
          variant="ghost"
          size="sm"
          iconLeft={<MIcon name="x" size={15} />}
          onClick={() => submitNow({ bgImage: '' })}
        >
          {t('theme_remove_img')}
        </XBtn>
      )}
    </div>
  );
}

// ============================================================ PROFILE ============================================================
function ProfileScreen({ user, onSave, onLogout }) {
  const { t } = useLang();
  const [f, setF] = React.useState(() => ({
    name: user.name,
    email: user.email || '',
    phone: user.phone || '',
    color: user.color || 'orange',
  }));
  const [saved, setSaved] = React.useState(false);
  const set = (k, v) => {
    setF((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };
  const dirty =
    f.name !== user.name ||
    f.email !== (user.email || '') ||
    f.phone !== (user.phone || '') ||
    f.color !== user.color;
  const doSave = () => {
    onSave({ name: f.name.trim() || user.name, email: f.email, phone: f.phone, color: f.color });
    setSaved(true);
  };

  return (
    <div className="content" style={{ maxWidth: 920 }}>
      <PageHeader title={t('prof_title')} subtitle={t('prof_sub')} />
      <div
        className="m-grid profile-grid"
        style={{ gridTemplateColumns: 'minmax(0,300px) minmax(0,1fr)' }}
      >
        {/* Avatar card */}
        <XC style={{ textAlign: 'center' }}>
          <div style={{ display: 'grid', placeItems: 'center', marginBottom: 16 }}>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={f.name}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <XAvatar name={f.name} color={f.color} size="xl" />
              )}
              <label
                title={t('prof_upload_avatar')}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 28,
                  height: 28,
                  background: 'var(--brand)',
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  border: '2.5px solid var(--surface-card)',
                  boxSizing: 'border-box',
                }}
              >
                <MIcon name="upload" size={13} style={{ color: '#fff' }} />
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const r = new FileReader();
                    r.onload = () => {
                      onSave({ avatar: r.result });
                    };
                    r.readAsDataURL(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
          {user.avatar && (
            <div style={{ marginBottom: 8 }}>
              <XBtn variant="ghost" size="sm" onClick={() => onSave({ avatar: '' })}>
                {t('prof_remove_avatar')}
              </XBtn>
            </div>
          )}
          <div style={{ fontWeight: 800, color: 'var(--text-strong)', fontSize: 'var(--text-lg)' }}>
            {f.name}
          </div>
          <div className="m-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 16 }}>
            {t('role_' + String(user.role || '').toLowerCase())}
          </div>
          <div style={{ display: 'grid', placeItems: 'center' }}>
            <ColorPicker
              label={t('prof_avatar_color')}
              value={f.color}
              onChange={(v) => set('color', v)}
            />
          </div>
        </XC>
        {/* Details card */}
        <div className="m-stack" style={{ gap: 20 }}>
          <XC>
            <h2 style={{ margin: '0 0 16px', fontSize: 'var(--text-xl)' }}>{t('prof_personal')}</h2>
            <div className="mochi-field">
              <label className="mochi-field__label">{t('prof_fullname')}</label>
              <input
                className="mochi-input"
                value={f.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div className="m-grid cols-2" style={{ gap: 14 }}>
              <div className="mochi-field">
                <label className="mochi-field__label">{t('prof_email')}</label>
                <input
                  className="mochi-input"
                  type="email"
                  value={f.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>
              <div className="mochi-field">
                <label className="mochi-field__label">{t('prof_phone')}</label>
                <input
                  className="mochi-input"
                  type="tel"
                  value={f.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </div>
            </div>
            <div className="m-row" style={{ gap: 12, marginTop: 6 }}>
              <XBtn variant="primary" onClick={doSave} disabled={!dirty}>
                {saved && !dirty ? t('prof_saved') : t('prof_save')}
              </XBtn>
              {saved && !dirty && (
                <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
                  {t('prof_uptodate')}
                </span>
              )}
            </div>
          </XC>
          <XC>
            <h2 style={{ margin: '0 0 4px', fontSize: 'var(--text-xl)' }}>{t('prof_account')}</h2>
            <p className="m-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 0 }}>
              {t('prof_account_sub')}
            </p>
            <div className="m-row" style={{ gap: 12 }}>
              <XBtn
                variant="danger"
                iconLeft={<MIcon name="logout" size={16} />}
                onClick={onLogout}
              >
                {t('prof_logout')}
              </XBtn>
            </div>
          </XC>
        </div>
      </div>
    </div>
  );
}

export { MaterialsScreen, CalendarThemePanel, ProfileScreen };

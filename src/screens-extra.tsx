import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { Modal, MSelect, ColorPicker, PageHeader, Empty } from './ui.jsx';
import { iso, TODAY, ICON_TINT } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';
import { MAT_TYPES } from './lib/mat-types.js';
import type { ClassLite } from '../server/services/classes.js';
import type { MaterialRow } from '../server/services/materials.js';
import type { AppUser } from './screens-core.jsx';

const {
  Card: XC,
  Button: XBtn,
  IconButton: XIB,
  Tag: XTag,
  Switch: XSw,
  Avatar: XAvatar,
  Tabs: XTabs,
} = DS;

interface MaterialLoaderData {
  materials: MaterialRow[];
  classes: ClassLite[];
  /** Read-only here: this page is the library, and attaching happens on the class page. */
  classMaterials: { classId: string; materialId: string }[];
}

type MaterialDraft = Partial<MaterialRow> & {
  title: string;
  type: string;
  url: string;
  fileName: string;
  favorite: boolean;
  fileField?: File;
};

// ============================================================ MATERIALS ============================================================
interface MaterialCardProps {
  m: MaterialRow;
  /** Every class this material is filed under — a material can be shared by several. */
  linkedClasses: ClassLite[];
  onEdit: () => void;
  onDelete: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function MaterialCard({ m, linkedClasses, onEdit, onDelete, t }: MaterialCardProps) {
  const favFetcher = useFetcher();
  const optimisticFav = favFetcher.formData
    ? favFetcher.formData.get('favorite') === 'true'
    : m.favorite;
  const mt = MAT_TYPES[m.type] ?? MAT_TYPES.notes;
  const isLink = m.type === 'link' || m.type === 'video';

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
        {linkedClasses.length ? (
          linkedClasses.map((c) => (
            <XTag key={c.id} dot color={c.color || 'neutral'}>
              {c.name}
            </XTag>
          ))
        ) : (
          <XTag dot color="neutral">
            {t('mat_unfiled')}
          </XTag>
        )}
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
            download={m.fileName ?? true}
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
  const { materials: matList, classes, classMaterials } = useLoaderData() as MaterialLoaderData;
  const fetcher = useFetcher();
  const { t } = useLang();
  const [filterClass, setFilterClass] = React.useState('all');
  const [filterType, setFilterType] = React.useState('all');
  const [favOnly, setFavOnly] = React.useState(false);
  const [modal, setModal] = React.useState<MaterialDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveFailed, setSaveFailed] = React.useState(false);

  // Close the modal only once the save round-trip has actually finished
  // (uploads can take seconds); watch the non-idle → idle transition so a
  // stale fetcher.data from a previous save can't close it prematurely.
  const prevFetcherState = React.useRef(fetcher.state);
  React.useEffect(() => {
    if (saving && prevFetcherState.current !== 'idle' && fetcher.state === 'idle') {
      setSaving(false);
      if ((fetcher.data as { ok?: boolean } | undefined)?.ok) setModal(null);
      else setSaveFailed(true);
    }
    prevFetcherState.current = fetcher.state;
  }, [saving, fetcher.state, fetcher.data]);

  // One material can be filed under several classes, so both the filter and the card chips read
  // the join rather than a column on the row.
  const classesOf = React.useCallback(
    (id: string) =>
      classMaterials
        .filter((l) => l.materialId === id)
        .map((l) => classes.find((c) => c.id === l.classId))
        .filter((c): c is ClassLite => !!c),
    [classMaterials, classes],
  );

  let list = matList;
  if (filterClass !== 'all')
    list = list.filter((m) =>
      classMaterials.some((l) => l.materialId === m.id && l.classId === filterClass),
    );
  if (filterType !== 'all') list = list.filter((m) => m.type === filterType);
  if (favOnly) list = list.filter((m) => m.favorite);

  const openNew = () => {
    setSaveFailed(false);
    setModal({
      title: '',
      type: 'notes',
      url: '',
      fileName: '',
      favorite: false,
      addedAt: iso(TODAY),
    });
  };

  const save = (f: MaterialDraft) => {
    const title = f.title.trim() || t('mat_untitled');
    const fd = new FormData();
    fd.set('intent', f.id ? 'update' : 'create');
    if (f.id) fd.set('id', f.id);
    fd.set('title', title);
    fd.set('type', f.type);
    if (f.url) fd.set('url', f.url);
    if (f.fileField) {
      fd.set('file', f.fileField, f.fileField.name);
    } else if (f.fileName) {
      fd.set('fileName', f.fileName);
    }
    fd.set('favorite', String(!!f.favorite));
    if (f.addedAt) fd.set('addedAt', f.addedAt);
    // multipart is required whenever a File is attached: the urlencoded
    // default serializes File entries to plain strings and the upload is lost.
    fetcher.submit(fd, { action: '/materials', method: 'post', encType: 'multipart/form-data' });
    setSaveFailed(false);
    setSaving(true);
  };

  const removeMat = (id: string) => {
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
              linkedClasses={classesOf(m.id)}
              onEdit={() => {
                setSaveFailed(false);
                setModal({
                  ...m,
                  title: m.title,
                  type: m.type,
                  url: m.url ?? '',
                  fileName: m.fileName ?? '',
                  favorite: m.favorite,
                });
              }}
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
          busy={saving}
          error={saveFailed}
        />
      )}
    </div>
  );
}

/**
 * Pure CRUD over one library entry — title, kind, and either a link or a file. No class picker
 * and no scope: which classes and events carry the material is decided on those pages.
 */
interface MaterialModalProps {
  draft: MaterialDraft;
  setDraft: React.Dispatch<React.SetStateAction<MaterialDraft | null>>;
  onClose: () => void;
  onSave: (f: MaterialDraft) => void;
  busy: boolean;
  error: boolean;
}

function MaterialModal({ draft, setDraft, onClose, onSave, busy, error }: MaterialModalProps) {
  const { t } = useLang();
  const set = <K extends keyof MaterialDraft>(k: K, v: MaterialDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  const isLink = draft.type === 'link' || draft.type === 'video';
  const [fileSizeError, setFileSizeError] = React.useState(false);
  const MAX_UPLOAD = 20 * 1024 * 1024;
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_UPLOAD) {
      setFileSizeError(true);
      return;
    }
    setFileSizeError(false);
    setDraft((d) => (d ? { ...d, fileName: f.name, fileField: f } : d));
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={draft.id ? t('mat_edit') : t('mat_add')}
      width={520}
      footer={
        <>
          <XBtn variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </XBtn>
          <XBtn
            variant="primary"
            onClick={() => onSave(draft)}
            disabled={busy}
            iconLeft={busy ? <span className="mspin" /> : undefined}
          >
            {busy ? t('mat_saving') : t('save')}
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
      <MSelect
        label={t('mat_type')}
        value={draft.type}
        onChange={(v) => set('type', v)}
        options={Object.entries(MAT_TYPES).map(([k, v]) => ({ value: k, label: t(v.tk) }))}
      />
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
        </div>
      )}
      {error && !busy && (
        <div className="auth-error" style={{ marginTop: 12 }}>
          {t('mat_save_failed')}
        </div>
      )}
    </Modal>
  );
}

// ============================================================ CALENDAR THEME (reusable) ============================================================
interface Preset {
  tk: string;
  bg: string;
  gridLine: string;
  today: string;
  header: string;
  swatches: string[];
}

const PRESETS: Record<string, Preset> = {
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

interface ThemeColorRowProps {
  value: string;
  label: string;
  sub: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
}

function ThemeColorRow({ value, label, sub, onChange, onCommit }: ThemeColorRowProps) {
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

interface Theme {
  bg: string;
  gridLine: string;
  today: string;
  header: string;
  bgImage: string;
  bgOpacity: number;
  defaultView: 'day' | 'week' | 'month' | 'agenda';
}

export function CalendarThemePanel() {
  const { theme } = useLoaderData() as { theme: Theme };
  const fetcher = useFetcher();
  const { t } = useLang();
  const draftRef = React.useRef<Theme>({ ...theme });
  const [draft, setDraftState] = React.useState<Theme>(() => ({ ...theme }));

  const setField = <K extends keyof Theme>(key: K, value: Theme[K]) => {
    draftRef.current = { ...draftRef.current, [key]: value };
    setDraftState({ ...draftRef.current });
  };

  const submitNow = (patch: Partial<Theme> = {}) => {
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

  const applyPreset = (key: string) => {
    const p = PRESETS[key];
    submitNow({ bg: p.bg, gridLine: p.gridLine, today: p.today, header: p.header });
  };

  return (
    <div>
      <div className="mochi-eyebrow" style={{ marginBottom: 4 }}>
        {t('theme_defaultview')}
      </div>
      <div className="m-muted" style={{ fontSize: 'var(--text-xs)', marginBottom: 8 }}>
        {t('theme_defaultview_sub')}
      </div>
      <XTabs
        value={draft.defaultView || 'week'}
        onChange={(v: string) => submitNow({ defaultView: v as Theme['defaultView'] })}
        tabs={[
          { id: 'day', label: t('view_day') },
          { id: 'week', label: t('view_week') },
          { id: 'month', label: t('view_month') },
          { id: 'agenda', label: t('view_agenda') },
        ]}
        style={{ marginBottom: 20 }}
      />
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
            const f = e.target.files?.[0];
            if (f) {
              const r = new FileReader();
              r.onload = () =>
                submitNow({
                  bgImage: r.result as string,
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
          onPointerUp={(e) =>
            submitNow({ bgOpacity: Number((e.target as HTMLInputElement).value) })
          }
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
interface ProfileFields {
  name: string;
  email: string;
  phone: string;
  color: string;
}

interface PwStatus {
  busy: boolean;
  ok: boolean;
  error: string | null;
}

interface ZaloStatus {
  paired: boolean;
  hasPassword: boolean;
  busy: boolean;
  code: string | null;
}

interface EmailVerifyStatus {
  hasRealEmail: boolean;
  verified: boolean;
  busy: boolean;
  sent: boolean;
  devUrl: string | null;
}

interface GoogleStatus {
  show: boolean;
  linked: boolean;
  busy: boolean;
  error: string | null;
}

interface RemovePwStatus {
  busy: boolean;
  error: string | null;
}

interface ProfileScreenProps {
  user: AppUser;
  onSave: (updates: Partial<AppUser> & Record<string, unknown>) => void;
  onLogout: () => void;
  onChangePassword: (currentPassword: string, newPassword: string) => void;
  pwStatus: PwStatus;
  zaloStatus: ZaloStatus;
  onZaloPair: () => void;
  emailVerifyStatus: EmailVerifyStatus;
  onVerifyEmail: () => void;
  googleStatus: GoogleStatus;
  onUnlinkGoogle: () => void;
  onRemovePassword: () => void;
  removePwStatus: RemovePwStatus;
}

function ProfileScreen({
  user,
  onSave,
  onLogout,
  onChangePassword,
  pwStatus,
  zaloStatus,
  onZaloPair,
  emailVerifyStatus,
  onVerifyEmail,
  googleStatus,
  onUnlinkGoogle,
  onRemovePassword,
  removePwStatus,
}: ProfileScreenProps) {
  const { t } = useLang();
  const [f, setF] = React.useState<ProfileFields>(() => ({
    name: user.name,
    email: user.email || '',
    phone: user.phone || '',
    color: user.color || 'orange',
  }));
  const [saved, setSaved] = React.useState(false);
  const [curPw, setCurPw] = React.useState('');
  const [newPw, setNewPw] = React.useState('');
  const [confirmPw, setConfirmPw] = React.useState('');
  const [showPw, setShowPw] = React.useState(false);
  const [clientErr, setClientErr] = React.useState<string | null>(null);
  const set = <K extends keyof ProfileFields>(k: K, v: ProfileFields[K]) => {
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

  const submitPw = () => {
    setClientErr(null);
    if (newPw !== confirmPw) return setClientErr('auth_pw_nomatch');
    if (newPw.length < 8) return setClientErr('auth_pw_short');
    onChangePassword(curPw, newPw);
  };

  React.useEffect(() => {
    if (pwStatus.ok) {
      setCurPw('');
      setNewPw('');
      setConfirmPw('');
      setClientErr(null);
    }
  }, [pwStatus.ok]);

  const pwErr = clientErr ?? pwStatus.error;

  return (
    <div className="content" style={{ maxWidth: 1320 }}>
      <PageHeader title={t('prof_title')} subtitle={t('prof_sub')} />
      <div className="m-grid profile-grid">
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
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const r = new FileReader();
                    r.onload = () => {
                      onSave({ avatar: r.result as string });
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
        {/* Account card */}
        <XC>
          <h2 style={{ margin: '0 0 4px', fontSize: 'var(--text-xl)' }}>{t('prof_account')}</h2>
          <p className="m-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 0 }}>
            {t('prof_account_sub')}
          </p>
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 'var(--text-md)', fontWeight: 600 }}>
              {zaloStatus.hasPassword ? t('prof_change_pw') : t('prof_set_pw')}
            </h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitPw();
              }}
            >
              {zaloStatus.hasPassword && (
                <div className="mochi-field" style={{ marginBottom: 12 }}>
                  <label className="mochi-field__label">{t('prof_current_pw')}</label>
                  <div className="auth-field">
                    <input
                      className="mochi-input auth-input"
                      type={showPw ? 'text' : 'password'}
                      value={curPw}
                      onChange={(e) => setCurPw(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                </div>
              )}
              <div className="mochi-field" style={{ marginBottom: 12 }}>
                <label className="mochi-field__label">{t('prof_new_pw')}</label>
                <div className="auth-field">
                  <input
                    className="mochi-input auth-input"
                    type={showPw ? 'text' : 'password'}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="auth-field__eye"
                    onClick={() => setShowPw((s) => !s)}
                    aria-label="Toggle password"
                  >
                    <MIcon name={showPw ? 'eyeOff' : 'eye'} size={18} />
                  </button>
                </div>
              </div>
              <div className="mochi-field" style={{ marginBottom: 12 }}>
                <label className="mochi-field__label">{t('auth_confirm_pw')}</label>
                <div className="auth-field">
                  <input
                    className="mochi-input auth-input"
                    type={showPw ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              {pwErr && (
                <div className="auth-error" style={{ marginBottom: 12 }}>
                  {t(pwErr)}
                </div>
              )}
              {pwStatus.ok && (
                <div
                  style={{ color: 'var(--brand)', fontSize: 'var(--text-sm)', marginBottom: 12 }}
                >
                  {t('prof_pw_changed')}
                </div>
              )}
              <div className="m-row" style={{ gap: 12 }}>
                <XBtn
                  type="submit"
                  variant="primary"
                  disabled={
                    pwStatus.busy ||
                    (zaloStatus.hasPassword && !curPw) ||
                    !newPw ||
                    !confirmPw
                  }
                >
                  {zaloStatus.hasPassword ? t('prof_change_pw') : t('prof_set_pw')}
                </XBtn>
              </div>
            </form>
            {zaloStatus.hasPassword && (
              <div style={{ marginTop: 14 }}>
                {removePwStatus.error && (
                  <div className="auth-error" style={{ marginBottom: 8 }}>
                    {t(removePwStatus.error)}
                  </div>
                )}
                <XBtn
                  variant="secondary"
                  size="sm"
                  onClick={onRemovePassword}
                  disabled={removePwStatus.busy}
                >
                  {t('prof_remove_pw')}
                </XBtn>
              </div>
            )}
          </div>
          <div
            style={{
              marginBottom: 24,
              paddingTop: 24,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: 'var(--text-md)', fontWeight: 600 }}>
              {t('prof_login_security')}
            </h3>
            <div className="m-row" style={{ gap: 8, marginBottom: 10, alignItems: 'center' }}>
              <MIcon
                name={zaloStatus.paired ? 'check' : 'message'}
                size={16}
                style={{ color: zaloStatus.paired ? 'var(--brand)' : 'var(--text-muted)' }}
              />
              <span style={{ fontSize: 'var(--text-sm)' }}>
                {zaloStatus.paired ? t('prof_zalo_paired') : t('prof_zalo_not_paired')}
              </span>
            </div>
            {!zaloStatus.paired && (
              <XBtn variant="secondary" size="sm" onClick={onZaloPair} disabled={zaloStatus.busy}>
                {t('prof_zalo_connect')}
              </XBtn>
            )}
            {zaloStatus.code && (
              <div className="auth-hint-code" style={{ marginTop: 10 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-lg)',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                  }}
                >
                  {zaloStatus.code}
                </div>
                <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                  {t('prof_zalo_code_hint')}
                </div>
              </div>
            )}
            <div className="m-row" style={{ gap: 8, marginTop: 14 }}>
              <span style={{ fontSize: 'var(--text-sm)' }}>
                {t('prof_password_status')}:{' '}
                <strong>
                  {zaloStatus.hasPassword ? t('prof_password_set') : t('prof_password_unset')}
                </strong>
              </span>
            </div>
            {emailVerifyStatus.hasRealEmail && (
              <div style={{ marginTop: 14 }}>
                <div className="m-row" style={{ gap: 8, alignItems: 'center' }}>
                  <MIcon
                    name={emailVerifyStatus.verified ? 'check' : 'mail'}
                    size={16}
                    style={{
                      color: emailVerifyStatus.verified ? 'var(--brand)' : 'var(--text-muted)',
                    }}
                  />
                  <span style={{ fontSize: 'var(--text-sm)' }}>
                    {emailVerifyStatus.verified
                      ? t('prof_email_verified')
                      : t('prof_email_not_verified')}
                  </span>
                </div>
                {!emailVerifyStatus.verified && !emailVerifyStatus.sent && (
                  <XBtn
                    variant="secondary"
                    size="sm"
                    style={{ marginTop: 8 }}
                    onClick={onVerifyEmail}
                    disabled={emailVerifyStatus.busy}
                  >
                    {t('prof_verify_email')}
                  </XBtn>
                )}
                {emailVerifyStatus.sent && (
                  <p className="m-muted" style={{ fontSize: 'var(--text-sm)', marginTop: 8 }}>
                    {t('auth_sent_to')} {user.email}
                    {emailVerifyStatus.devUrl && (
                      <>
                        {' '}
                        <strong>[dev]</strong>{' '}
                        <a href={emailVerifyStatus.devUrl} style={{ color: 'var(--brand)' }}>
                          {emailVerifyStatus.devUrl}
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
            )}
            {googleStatus.show && (
              <div style={{ marginTop: 14 }}>
                <div className="m-row" style={{ gap: 8, alignItems: 'center' }}>
                  <MIcon
                    name={googleStatus.linked ? 'check' : 'mail'}
                    size={16}
                    style={{
                      color: googleStatus.linked ? 'var(--brand)' : 'var(--text-muted)',
                    }}
                  />
                  <span style={{ fontSize: 'var(--text-sm)' }}>
                    {googleStatus.linked ? t('prof_google_linked') : t('prof_google_not_linked')}
                  </span>
                </div>
                {googleStatus.error && (
                  <div className="auth-error" style={{ marginTop: 8 }}>
                    {t(googleStatus.error)}
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  {googleStatus.linked ? (
                    <XBtn
                      variant="secondary"
                      size="sm"
                      onClick={onUnlinkGoogle}
                      disabled={googleStatus.busy}
                    >
                      {t('prof_unlink_google')}
                    </XBtn>
                  ) : (
                    <a className="mochi-btn is-secondary is-sm" href="/auth/google?link=1">
                      {t('prof_link_google')}
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="m-row" style={{ gap: 12 }}>
            <XBtn variant="danger" iconLeft={<MIcon name="logout" size={16} />} onClick={onLogout}>
              {t('prof_logout')}
            </XBtn>
          </div>
        </XC>
      </div>
    </div>
  );
}

export { MaterialsScreen, ProfileScreen };

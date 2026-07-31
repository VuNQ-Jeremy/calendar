import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PageHeader, Empty, Modal, useConfirm } from './ui.jsx';
import { useLang } from './lib/i18n.jsx';
import type { AssessmentTypeRow } from '../server/services/assessment-types.js';
import type { GradeLevelRow } from '../server/services/grade-levels.js';
import { TAB_BAR_STYLES } from '../shared/schemas.js';
import type { ScrollbarStyle, TabBarStyle } from '../shared/schemas.js';

const { Card, Button, IconButton, Badge } = DS;

interface ConfigLoaderData {
  types: AssessmentTypeRow[];
  gradeLevels: GradeLevelRow[];
  uiPrefs: { scrollbar: ScrollbarStyle; mobileTabBar: TabBarStyle };
}

// Mock colors are hardcoded hex (same values as the DS tokens) so each card
// always previews its own style regardless of the currently active preset.
const SB_PRESETS: Record<ScrollbarStyle, { tk: string; track: string; thumb: string; barW: number }> = {
  slim: { tk: 'cfg_sb_slim', track: 'transparent', thumb: '#B8A893', barW: 6 },
  inset: { tk: 'cfg_sb_inset', track: '#F6EDDF', thumb: '#DBCBB4', barW: 9 },
  brand: { tk: 'cfg_sb_brand', track: 'transparent', thumb: '#F79A4E', barW: 6 },
  ghost: { tk: 'cfg_sb_ghost', track: 'transparent', thumb: 'rgba(184,168,147,0.35)', barW: 6 },
};

/**
 * Labels for the phone's tab-bar variants. Unlike the scrollbar presets there is nothing to
 * preview inline — the styling lives in mobile/components/TabBar.tsx and cannot run here — so
 * each mock is drawn in CSS (`.tbmock--<id>`) instead, keyed off the same ids the phone uses.
 */
const TB_LABEL: Record<TabBarStyle, string> = {
  pill: 'cfg_tb_pill',
  dock: 'cfg_tb_dock',
  indicator: 'cfg_tb_indicator',
};

type TypeDraft = { id?: string; name: string };

/**
 * Managed grade levels (Khối 6..9). Structural clone of the assessment-types card above,
 * kept as its own component so the two cards' drag/modal state can't collide.
 */
function GradeLevelsSection({ levels }: { levels: GradeLevelRow[] }) {
  const fetcher = useFetcher<{ error?: string }>();
  const { t } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const [modal, setModal] = React.useState<TypeDraft | null>(null);

  const submit = (fd: FormData) => fetcher.submit(fd, { action: '/config', method: 'post' });

  const openAdd = () => setModal({ name: '' });
  const openRename = (gl: GradeLevelRow) => setModal({ id: gl.id, name: gl.name });

  const save = (draft: TypeDraft) => {
    const fd = new FormData();
    fd.set('intent', draft.id ? 'update-level' : 'create-level');
    if (draft.id) fd.set('id', draft.id);
    fd.set('name', draft.name.trim());
    submit(fd);
    setModal(null);
  };

  const toggleActive = async (gl: GradeLevelRow) => {
    if (gl.active) {
      const ok = await confirm({
        title: t('cfg_deactivate'),
        message: gl.name + '?',
        danger: true,
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set('intent', 'update-level');
    fd.set('id', gl.id);
    fd.set('active', String(!gl.active));
    submit(fd);
  };

  const del = async (gl: GradeLevelRow) => {
    const ok = await confirm({
      title: t('gl_delete_confirm'),
      message: gl.name + '?',
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'delete-level');
    fd.set('id', gl.id);
    submit(fd);
  };

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [localOrder, setLocalOrder] = React.useState<string[] | null>(null);
  const reorderPending = React.useRef(false);

  const ordered = React.useMemo(() => {
    if (!localOrder) return levels;
    const byId = new Map(levels.map((gl) => [gl.id, gl]));
    const rows = localOrder.flatMap((id) => byId.get(id) ?? []);
    for (const gl of levels) if (!localOrder.includes(gl.id)) rows.push(gl);
    return rows;
  }, [levels, localOrder]);

  React.useEffect(() => {
    if (fetcher.state === 'idle' && reorderPending.current) {
      reorderPending.current = false;
      setLocalOrder(null);
    }
  }, [fetcher.state]);

  const previewMove = (srcId: string, overId: string) => {
    setLocalOrder((prev) => {
      const cur = prev ?? levels.map((gl) => gl.id);
      const from = cur.indexOf(srcId);
      const to = cur.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = cur.slice();
      next.splice(from, 1);
      next.splice(to, 0, srcId);
      return next;
    });
  };

  const commitOrder = () => {
    setDragId(null);
    if (!localOrder) return;
    if (localOrder.join('|') === levels.map((gl) => gl.id).join('|')) {
      setLocalOrder(null);
      return;
    }
    const fd = new FormData();
    fd.set('intent', 'reorder-levels');
    fd.set('ids', JSON.stringify(localOrder));
    submit(fd);
    reorderPending.current = true;
  };

  return (
    <Card style={{ padding: 18, marginTop: 16 }}>
      <div
        className="m-row"
        style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('gl_title')}</h2>
          <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
            {t('gl_subtitle')}
          </p>
        </div>
        <Button variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openAdd}>
          {t('gl_add')}
        </Button>
      </div>
      {ordered.length ? (
        <div className="m-stack">
          {ordered.map((gl) => (
            <div
              key={gl.id}
              className={'lrow' + (dragId === gl.id ? ' is-dragging' : '')}
              draggable
              onDragStart={(e) => {
                setDragId(gl.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', gl.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragId && dragId !== gl.id) previewMove(dragId, gl.id);
              }}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={commitOrder}
            >
              <span className="lrow__grip" title={t('cfg_drag_reorder')} aria-hidden="true">
                <MIcon name="grip" size={16} />
              </span>
              <div className="m-row" style={{ flex: 1, gap: 10 }}>
                <span className="lrow__title">{gl.name}</span>
                <Badge color={gl.active ? 'green' : 'neutral'}>
                  {gl.active ? t('cfg_active') : t('cfg_inactive')}
                </Badge>
              </div>
              <div className="lrow__actions">
                <IconButton label={t('cfg_rename')} size="sm" onClick={() => openRename(gl)}>
                  <MIcon name="edit" size={16} />
                </IconButton>
                <Button variant="secondary" size="sm" onClick={() => toggleActive(gl)}>
                  {gl.active ? t('cfg_deactivate') : t('cfg_activate')}
                </Button>
                <IconButton label={t('delete')} size="sm" onClick={() => del(gl)}>
                  <MIcon name="trash" size={16} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="settings" title={t('gl_empty')} />
      )}

      {modal && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={modal.id ? t('cfg_rename') : t('gl_add')}
          width={420}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" disabled={!modal.name.trim()} onClick={() => save(modal)}>
                {t('save')}
              </Button>
            </>
          }
        >
          <div className="mochi-field">
            <label className="mochi-field__label">{t('gl_name_ph')}</label>
            <input
              className="mochi-input"
              autoFocus
              value={modal.name}
              onChange={(e) => setModal((m) => (m ? { ...m, name: e.target.value } : m))}
            />
          </div>
          {fetcher.data?.error && (
            <div className="m-muted" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
              {fetcher.data.error}
            </div>
          )}
        </Modal>
      )}
      {confirmNode}
    </Card>
  );
}

function SystemConfigScreen() {
  const { types, gradeLevels, uiPrefs } = useLoaderData() as ConfigLoaderData;
  const fetcher = useFetcher<{ error?: string }>();
  const { t } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const [modal, setModal] = React.useState<TypeDraft | null>(null);

  const submit = (fd: FormData) => fetcher.submit(fd, { action: '/config', method: 'post' });

  const [sbLocal, setSbLocal] = React.useState<ScrollbarStyle | null>(null);
  const scrollbar = sbLocal ?? uiPrefs.scrollbar;

  const pickScrollbar = (key: ScrollbarStyle) => {
    setSbLocal(key);
    document.documentElement.dataset.scrollbar = key; // instant whole-app preview
    const fd = new FormData();
    fd.set('intent', 'ui-prefs');
    fd.set('scrollbar', key);
    submit(fd);
  };

  // Optimistic local state as above, but there is nothing to preview on this screen — the change
  // shows up on a phone, which picks it up on its next fetch of /api/settings/ui-prefs.
  const [tbLocal, setTbLocal] = React.useState<TabBarStyle | null>(null);
  const mobileTabBar = tbLocal ?? uiPrefs.mobileTabBar;

  const pickTabBar = (key: TabBarStyle) => {
    setTbLocal(key);
    const fd = new FormData();
    fd.set('intent', 'ui-prefs');
    fd.set('mobileTabBar', key);
    submit(fd);
  };

  const openAdd = () => setModal({ name: '' });
  const openRename = (tp: AssessmentTypeRow) => setModal({ id: tp.id, name: tp.name });

  const save = (draft: TypeDraft) => {
    const fd = new FormData();
    fd.set('intent', draft.id ? 'update-type' : 'create-type');
    if (draft.id) fd.set('id', draft.id);
    fd.set('name', draft.name.trim());
    submit(fd);
    setModal(null);
  };

  const toggleActive = async (tp: AssessmentTypeRow) => {
    if (tp.active) {
      const ok = await confirm({
        title: t('cfg_deactivate'),
        message: tp.name + '?',
        danger: true,
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set('intent', 'update-type');
    fd.set('id', tp.id);
    fd.set('active', String(!tp.active));
    submit(fd);
  };

  const del = async (tp: AssessmentTypeRow) => {
    const ok = await confirm({
      title: t('cfg_delete_q'),
      message: t('cfg_delete_msg', { name: tp.name }),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'delete-type');
    fd.set('id', tp.id);
    submit(fd);
  };

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [localOrder, setLocalOrder] = React.useState<string[] | null>(null);
  const reorderPending = React.useRef(false);

  // Show the in-progress drag order; fall back to server order.
  const ordered = React.useMemo(() => {
    if (!localOrder) return types;
    const byId = new Map(types.map((tp) => [tp.id, tp]));
    const rows = localOrder.flatMap((id) => byId.get(id) ?? []);
    for (const tp of types) if (!localOrder.includes(tp.id)) rows.push(tp);
    return rows;
  }, [types, localOrder]);

  React.useEffect(() => {
    if (fetcher.state === 'idle' && reorderPending.current) {
      reorderPending.current = false;
      setLocalOrder(null);
    }
  }, [fetcher.state]);

  const previewMove = (srcId: string, overId: string) => {
    setLocalOrder((prev) => {
      const cur = prev ?? types.map((tp) => tp.id);
      const from = cur.indexOf(srcId);
      const to = cur.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = cur.slice();
      next.splice(from, 1);
      next.splice(to, 0, srcId);
      return next;
    });
  };

  const commitOrder = () => {
    setDragId(null);
    if (!localOrder) return;
    if (localOrder.join('|') === types.map((tp) => tp.id).join('|')) {
      setLocalOrder(null);
      return;
    }
    const fd = new FormData();
    fd.set('intent', 'reorder-types');
    fd.set('ids', JSON.stringify(localOrder));
    submit(fd);
    reorderPending.current = true;
  };

  return (
    <div className="content">
      <PageHeader title={t('cfg_title')} subtitle={t('cfg_sub')} />
      <Card style={{ padding: 18 }}>
        <div
          className="m-row"
          style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}
        >
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('cfg_types_title')}</h2>
          <Button variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openAdd}>
            {t('cfg_add_type')}
          </Button>
        </div>
        {ordered.length ? (
          <div className="m-stack">
            {ordered.map((tp) => (
              <div
                key={tp.id}
                className={'lrow' + (dragId === tp.id ? ' is-dragging' : '')}
                draggable
                onDragStart={(e) => {
                  setDragId(tp.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', tp.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragId && dragId !== tp.id) previewMove(dragId, tp.id);
                }}
                onDrop={(e) => e.preventDefault()}
                onDragEnd={commitOrder}
              >
                <span className="lrow__grip" title={t('cfg_drag_reorder')} aria-hidden="true">
                  <MIcon name="grip" size={16} />
                </span>
                <div className="m-row" style={{ flex: 1, gap: 10 }}>
                  <span className="lrow__title">{tp.name}</span>
                  <Badge color={tp.active ? 'green' : 'neutral'}>
                    {tp.active ? t('cfg_active') : t('cfg_inactive')}
                  </Badge>
                </div>
                <div className="lrow__actions">
                  <IconButton label={t('cfg_rename')} size="sm" onClick={() => openRename(tp)}>
                    <MIcon name="edit" size={16} />
                  </IconButton>
                  <Button variant="secondary" size="sm" onClick={() => toggleActive(tp)}>
                    {tp.active ? t('cfg_deactivate') : t('cfg_activate')}
                  </Button>
                  <IconButton label={t('delete')} size="sm" onClick={() => del(tp)}>
                    <MIcon name="trash" size={16} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="settings" title={t('cfg_no_types')} />
        )}
      </Card>

      <GradeLevelsSection levels={gradeLevels} />

      <Card style={{ padding: 18, marginTop: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('cfg_sb_title')}</h2>
          <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
            {t('cfg_sb_sub')}
          </p>
        </div>
        <div className="theme-preset">
          {(Object.keys(SB_PRESETS) as ScrollbarStyle[]).map((key) => {
            const p = SB_PRESETS[key];
            return (
              <button
                key={key}
                type="button"
                className={'preset preset--sb' + (scrollbar === key ? ' is-active' : '')}
                onClick={() => pickScrollbar(key)}
              >
                <div className="sbmock">
                  <div className="sbmock__lines">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="sbmock__bar" style={{ background: p.track, width: p.barW }}>
                    <span style={{ background: p.thumb }} />
                  </div>
                </div>
                <div className="preset__name">{t(p.tk)}</div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card style={{ padding: 18, marginTop: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('cfg_tb_title')}</h2>
          <p className="m-muted" style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)' }}>
            {t('cfg_tb_sub')}
          </p>
        </div>
        <div className="theme-preset">
          {TAB_BAR_STYLES.map((key) => (
            <button
              key={key}
              type="button"
              className={'preset preset--tb' + (mobileTabBar === key ? ' is-active' : '')}
              onClick={() => pickTabBar(key)}
            >
              <div className={'tbmock tbmock--' + key}>
                <div className="tbmock__bar">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={'tbmock__item' + (i === 1 ? ' is-active' : '')}>
                      <i className="tbmock__ico" />
                      <i className="tbmock__lbl" />
                    </span>
                  ))}
                </div>
                <div className="tbmock__nav" />
              </div>
              <div className="preset__name">{t(TB_LABEL[key])}</div>
            </button>
          ))}
        </div>
      </Card>

      {modal && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={modal.id ? t('cfg_rename') : t('cfg_add_type')}
          width={420}
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" disabled={!modal.name.trim()} onClick={() => save(modal)}>
                {t('save')}
              </Button>
            </>
          }
        >
          <div className="mochi-field">
            <label className="mochi-field__label">{t('cfg_type_name')}</label>
            <input
              className="mochi-input"
              autoFocus
              value={modal.name}
              onChange={(e) => setModal((m) => (m ? { ...m, name: e.target.value } : m))}
            />
          </div>
          {fetcher.data?.error && (
            <div className="m-muted" style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
              {fetcher.data.error}
            </div>
          )}
        </Modal>
      )}
      {confirmNode}
    </div>
  );
}

export { SystemConfigScreen };

import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PageHeader, Empty, Modal, useConfirm } from './ui.jsx';
import { useLang } from './lib/i18n.jsx';
import type { AssessmentTypeRow } from '../server/services/assessment-types.js';

const { Card, Button, IconButton, Badge } = DS;

interface ConfigLoaderData {
  types: AssessmentTypeRow[];
}

type TypeDraft = { id?: string; name: string };

function SystemConfigScreen() {
  const { types } = useLoaderData() as ConfigLoaderData;
  const fetcher = useFetcher<{ error?: string }>();
  const { t } = useLang();
  const [confirm, confirmNode] = useConfirm();
  const [modal, setModal] = React.useState<TypeDraft | null>(null);

  const submit = (fd: FormData) => fetcher.submit(fd, { action: '/config', method: 'post' });

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

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

  const move = (tp: AssessmentTypeRow, dir: -1 | 1) => {
    const idx = types.findIndex((x) => x.id === tp.id);
    const neighbor = types[idx + dir];
    if (!neighbor) return;
    const fdA = new FormData();
    fdA.set('intent', 'update-type');
    fdA.set('id', tp.id);
    fdA.set('sortOrder', String(neighbor.sortOrder));
    submit(fdA);
    const fdB = new FormData();
    fdB.set('intent', 'update-type');
    fdB.set('id', neighbor.id);
    fdB.set('sortOrder', String(tp.sortOrder));
    submit(fdB);
  };

  return (
    <div className="content">
      <PageHeader
        title={t('cfg_title')}
        subtitle={t('cfg_sub')}
        actions={
          <Button variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openAdd}>
            {t('cfg_add_type')}
          </Button>
        }
      />
      <Card style={{ padding: 18 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 'var(--text-xl)' }}>{t('cfg_types_title')}</h2>
        {types.length ? (
          <div className="m-stack">
            {types.map((tp, idx) => (
              <div key={tp.id} className="lrow">
                <div className="m-row" style={{ flex: 1, gap: 10 }}>
                  <span className="lrow__title">{tp.name}</span>
                  <Badge color={tp.active ? 'green' : 'neutral'}>
                    {tp.active ? t('cfg_active') : t('cfg_inactive')}
                  </Badge>
                </div>
                <div className="lrow__actions">
                  <IconButton
                    label={t('cfg_move_up')}
                    size="sm"
                    disabled={idx === 0}
                    onClick={() => move(tp, -1)}
                  >
                    <MIcon name="chevronDown" size={16} style={{ transform: 'rotate(180deg)' }} />
                  </IconButton>
                  <IconButton
                    label={t('cfg_move_down')}
                    size="sm"
                    disabled={idx === types.length - 1}
                    onClick={() => move(tp, 1)}
                  >
                    <MIcon name="chevronDown" size={16} />
                  </IconButton>
                  <IconButton label={t('cfg_rename')} size="sm" onClick={() => openRename(tp)}>
                    <MIcon name="edit" size={16} />
                  </IconButton>
                  <Button variant="secondary" size="sm" onClick={() => toggleActive(tp)}>
                    {tp.active ? t('cfg_deactivate') : t('cfg_activate')}
                  </Button>
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

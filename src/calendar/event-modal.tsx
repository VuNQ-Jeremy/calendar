import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect, ColorPicker } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import type { ClassLite } from '../../server/services/classes.js';
import type { EventRow } from '../../server/services/events.js';

const { Button: CBtn } = DS;

type EventDraft = Partial<EventRow> & { recurrence?: string };

interface EventModalProps {
  open: boolean;
  onClose: () => void;
  draft: EventDraft | null;
  onSave: (f: EventDraft) => void;
  onDelete: (id: string) => void;
  classes: ClassLite[];
}

export function EventModal({ open, onClose, draft, onSave, onDelete, classes }: EventModalProps) {
  const { t } = useLang();
  const [f, setF] = React.useState<EventDraft>(draft || {});
  React.useEffect(() => {
    setF(draft || {});
  }, [draft, open]);
  if (!open) return null;
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const isNew = !f.id;
  const classOpts = [
    { value: '', label: t('ev_class_personal') },
    ...classes.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? t('ev_new') : t('ev_edit')}
      width={540}
      footer={
        <>
          {!isNew && (
            <CBtn
              variant="danger"
              onClick={() => onDelete(f.id!)}
              iconLeft={<MIcon name="trash" size={16} />}
            >
              {t('delete')}
            </CBtn>
          )}
          <span style={{ flex: 1 }} />
          <CBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </CBtn>
          <CBtn variant="primary" onClick={() => onSave(f)}>
            {isNew ? t('ev_add') : t('save')}
          </CBtn>
        </>
      }
    >
      <div className="mochi-field">
        <label className="mochi-field__label">{t('ev_title')}</label>
        <input
          className="mochi-input"
          placeholder={t('ev_title_ph')}
          value={f.title || ''}
          autoFocus
          onChange={(e) => set('title', e.target.value)}
        />
      </div>
      <div className="m-grid cols-3" style={{ gap: 14 }}>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('ev_date')}</label>
          <input
            type="date"
            className="mochi-input"
            value={f.date || ''}
            onChange={(e) => set('date', e.target.value)}
          />
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('ev_start')}</label>
          <input
            type="time"
            className="mochi-input"
            value={f.start || ''}
            onChange={(e) => set('start', e.target.value)}
          />
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('ev_end')}</label>
          <input
            type="time"
            className="mochi-input"
            value={f.end || ''}
            onChange={(e) => set('end', e.target.value)}
          />
        </div>
      </div>
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <MSelect
          label={t('class')}
          value={f.classId || ''}
          onChange={(v) => {
            set('classId', v);
            const c = classes.find((x) => x.id === v);
            if (c) set('color', c.color);
          }}
          options={classOpts}
        />
        <MSelect
          label={t('ev_repeat')}
          value={f.recurrence || 'none'}
          onChange={(v) => set('recurrence', v)}
          options={[
            { value: 'none', label: t('ev_repeat_none') },
            { value: 'daily', label: t('ev_repeat_daily') },
            { value: 'weekly', label: t('ev_repeat_weekly') },
          ]}
        />
      </div>
      <div className="mochi-field">
        <label className="mochi-field__label">{t('ev_location')}</label>
        <input
          className="mochi-input"
          placeholder={t('ev_location_ph')}
          value={f.location || ''}
          onChange={(e) => set('location', e.target.value)}
        />
      </div>
      <ColorPicker
        label={t('color')}
        value={f.color || 'orange'}
        onChange={(v) => set('color', v)}
      />
    </Modal>
  );
}

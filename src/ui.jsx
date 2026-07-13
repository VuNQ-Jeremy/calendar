import React from 'react';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PALETTE } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';

// app/ui.jsx — shared UI helpers (Modal, Select, ColorPicker, PageHeader, Empty, Field)
const { Button, IconButton } = DS;

// ---- Modal / dialog ----
function Modal({ open, onClose, title, children, footer, width = 520 }) {
  const { t } = useLang();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="m-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose && onClose();
      }}
    >
      <div className="m-dialog" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="m-dialog__head">
          <h3 className="m-dialog__title">{title}</h3>
          <IconButton label={t('close')} size="sm" onClick={onClose}>
            <MIcon name="x" size={18} />
          </IconButton>
        </div>
        <div className="m-dialog__body">{children}</div>
        {footer && <div className="m-dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---- Labeled select ----
function Select({ label, value, onChange, options, hint }) {
  return (
    <div className="mochi-field">
      {label && <label className="mochi-field__label">{label}</label>}
      <div className="m-select">
        <select className="m-select__el" value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => {
            const val = typeof o === 'string' ? o : o.value;
            const lab = typeof o === 'string' ? o : o.label;
            return (
              <option key={val} value={val}>
                {lab}
              </option>
            );
          })}
        </select>
        <MIcon name="chevronDown" size={16} className="m-select__chev" />
      </div>
      {hint && <span className="mochi-field__hint">{hint}</span>}
    </div>
  );
}

// ---- Category color picker (swatch grid) ----
function ColorPicker({ value, onChange, label }) {
  return (
    <div className="mochi-field">
      {label && <label className="mochi-field__label">{label}</label>}
      <div className="m-swatches">
        {PALETTE.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.label}
            className={'m-swatch' + (value === p.id ? ' is-active' : '')}
            style={{ background: p.base }}
            onClick={() => onChange(p.id)}
          >
            {value === p.id && <MIcon name="check" size={16} style={{ color: '#fff' }} />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Page header (title + subtitle + actions) ----
function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="m-pagehead">
      <div>
        <h1 className="m-pagehead__title">{title}</h1>
        {subtitle && <div className="m-pagehead__sub">{subtitle}</div>}
      </div>
      {actions && <div className="m-pagehead__actions">{actions}</div>}
    </div>
  );
}

// ---- Empty state ----
function Empty({ icon = 'sparkle', title, sub, action }) {
  return (
    <div className="m-empty">
      <div className="m-empty__icon">
        <MIcon name={icon} size={28} />
      </div>
      <div className="m-empty__title">{title}</div>
      {sub && <div className="m-empty__sub">{sub}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

// ---- Confirm dialog hook ----
function useConfirm() {
  const { t } = useLang();
  const [state, setState] = React.useState(null);
  const confirm = (opts) =>
    new Promise((resolve) => {
      setState({ ...opts, resolve });
    });
  const node = state && (
    <Modal
      open={true}
      onClose={() => {
        state.resolve(false);
        setState(null);
      }}
      title={state.title}
      width={420}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              state.resolve(false);
              setState(null);
            }}
          >
            {t('cancel')}
          </Button>
          <Button
            variant={state.danger ? 'danger' : 'primary'}
            onClick={() => {
              state.resolve(true);
              setState(null);
            }}
          >
            {state.confirmLabel || t('confirm')}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--text-body)' }}>{state.message}</p>
    </Modal>
  );
  return [confirm, node];
}

export { Modal, Select as MSelect, ColorPicker, PageHeader, Empty, useConfirm };

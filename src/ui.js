import { React, DS } from './lib/globals.js';
import { MIcon } from './icons.js';
import { PALETTE } from './lib/core.js';
import { useLang } from './lib/i18n.js';

// app/ui.jsx — shared UI helpers (Modal, Select, ColorPicker, PageHeader, Empty, Field)
const { Button, IconButton, Card } = DS;

// ---- Modal / dialog ----
function Modal({ open, onClose, title, children, footer, width = 520 }) {
  const { t } = useLang();
  const dialogRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return React.createElement('div', {
    className: 'm-overlay',
    onClick: (e) => { if (dialogRef.current && !dialogRef.current.contains(e.target)) onClose && onClose(); },
  },
    React.createElement('div', { className: 'm-dialog', ref: dialogRef, style: { maxWidth: width }, role: 'dialog', 'aria-modal': 'true' },
      React.createElement('div', { className: 'm-dialog__head' },
        React.createElement('h3', { className: 'm-dialog__title' }, title),
        React.createElement(IconButton, { label: t('close'), size: 'sm', onClick: onClose }, React.createElement(MIcon, { name: 'x', size: 18 })),
      ),
      React.createElement('div', { className: 'm-dialog__body' }, children),
      footer && React.createElement('div', { className: 'm-dialog__foot' }, footer),
    ),
  );
}

// ---- Labeled select ----
function Select({ label, value, onChange, options, hint }) {
  return React.createElement('div', { className: 'mochi-field' },
    label && React.createElement('label', { className: 'mochi-field__label' }, label),
    React.createElement('div', { className: 'm-select' },
      React.createElement('select', { className: 'm-select__el', value, onChange: (e) => onChange(e.target.value) },
        options.map(o => {
          const val = typeof o === 'string' ? o : o.value;
          const lab = typeof o === 'string' ? o : o.label;
          return React.createElement('option', { key: val, value: val }, lab);
        }),
      ),
      React.createElement(MIcon, { name: 'chevronDown', size: 16, className: 'm-select__chev' }),
    ),
    hint && React.createElement('span', { className: 'mochi-field__hint' }, hint),
  );
}

// ---- Category color picker (swatch grid) ----
function ColorPicker({ value, onChange, label }) {
  return React.createElement('div', { className: 'mochi-field' },
    label && React.createElement('label', { className: 'mochi-field__label' }, label),
    React.createElement('div', { className: 'm-swatches' },
      PALETTE.map(p =>
        React.createElement('button', {
          key: p.id, type: 'button', title: p.label,
          className: 'm-swatch' + (value === p.id ? ' is-active' : ''),
          style: { background: p.base },
          onClick: () => onChange(p.id),
        }, value === p.id && React.createElement(MIcon, { name: 'check', size: 16, style: { color: '#fff' } })),
      ),
    ),
  );
}

// ---- Page header (title + subtitle + actions) ----
function PageHeader({ title, subtitle, actions }) {
  return React.createElement('div', { className: 'm-pagehead' },
    React.createElement('div', null,
      React.createElement('h1', { className: 'm-pagehead__title' }, title),
      subtitle && React.createElement('div', { className: 'm-pagehead__sub' }, subtitle),
    ),
    actions && React.createElement('div', { className: 'm-pagehead__actions' }, actions),
  );
}

// ---- Empty state ----
function Empty({ icon = 'sparkle', title, sub, action }) {
  return React.createElement('div', { className: 'm-empty' },
    React.createElement('div', { className: 'm-empty__icon' }, React.createElement(MIcon, { name: icon, size: 28 })),
    React.createElement('div', { className: 'm-empty__title' }, title),
    sub && React.createElement('div', { className: 'm-empty__sub' }, sub),
    action && React.createElement('div', { style: { marginTop: 16 } }, action),
  );
}

// ---- Confirm dialog hook ----
function useConfirm() {
  const { t } = useLang();
  const [state, setState] = React.useState(null);
  const confirm = (opts) => new Promise((resolve) => {
    setState({ ...opts, resolve });
  });
  const node = state && React.createElement(Modal, {
    open: true, onClose: () => { state.resolve(false); setState(null); },
    title: state.title, width: 420,
    footer: React.createElement(React.Fragment, null,
      React.createElement(Button, { variant: 'secondary', onClick: () => { state.resolve(false); setState(null); } }, t('cancel')),
      React.createElement(Button, { variant: state.danger ? 'danger' : 'primary', onClick: () => { state.resolve(true); setState(null); } }, state.confirmLabel || t('confirm')),
    ),
  }, React.createElement('p', { style: { margin: 0, color: 'var(--text-body)' } }, state.message));
  return [confirm, node];
}


export { Modal, Select as MSelect, ColorPicker, PageHeader, Empty, useConfirm };

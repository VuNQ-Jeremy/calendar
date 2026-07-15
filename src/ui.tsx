import React from 'react';
import { createPortal } from 'react-dom';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PALETTE } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';

const { Button, IconButton } = DS;

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}

function Modal({ open, onClose, title, children, footer, width = 520 }: ModalProps) {
  const { t } = useLang();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
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

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: (string | SelectOption)[];
  hint?: string;
}

function Select({ label, value, onChange, options, hint }: SelectProps) {
  const norm = options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o,
  );
  const selected = norm.find((o) => o.value === value);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [pos, setPos] = React.useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();

  const openMenu = () => {
    const r = triggerRef.current!.getBoundingClientRect();
    const menuH = Math.min(norm.length * 40 + 12, 280);
    const up = window.innerHeight - r.bottom < menuH + 8 && r.top > menuH + 8;
    setPos({ top: up ? r.top - menuH - 6 : r.bottom + 6, left: r.left, width: r.width, up });
    setActive(Math.max(0, norm.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  const pick = (v: string) => { onChange(v); close(); };

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) &&
          !triggerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openMenu(); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive((i) => Math.min(i + 1, norm.length - 1)); break;
      case 'ArrowUp':   e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); break;
      case 'Home':      e.preventDefault(); setActive(0); break;
      case 'End':       e.preventDefault(); setActive(norm.length - 1); break;
      case 'Enter': case ' ': e.preventDefault(); pick(norm[active].value); break;
      case 'Escape':    e.preventDefault(); close(); break;
      case 'Tab':       setOpen(false); break;
    }
  };

  return (
    <div className="mochi-field">
      {label && <label className="mochi-field__label">{label}</label>}
      <button
        type="button"
        ref={triggerRef}
        className={'m-select__trigger' + (open ? ' is-open' : '')}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={id}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="m-select__value">{selected?.label ?? ''}</span>
        <MIcon name="chevronDown" size={16} className="m-select__chev" />
      </button>
      {hint && <span className="mochi-field__hint">{hint}</span>}
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            id={id}
            role="listbox"
            className={'m-select__menu' + (pos.up ? ' is-up' : '')}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            {norm.map((o, i) => (
              <div
                key={o.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={o.value === value}
                className={
                  'm-select__option' +
                  (o.value === value ? ' is-selected' : '') +
                  (i === active ? ' is-active' : '')
                }
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
              >
                <span>{o.label}</span>
                {o.value === value && <MIcon name="check" size={16} />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

interface ColorPickerProps {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}

function ColorPicker({ value, onChange, label }: ColorPickerProps) {
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

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}

function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
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

interface EmptyProps {
  icon?: import('./icons.jsx').IconName;
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
}

function Empty({ icon = 'sparkle', title, sub, action }: EmptyProps) {
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

interface ConfirmOpts {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

function useConfirm(): [(opts: ConfirmOpts) => Promise<boolean>, React.ReactElement | null] {
  const { t } = useLang();
  const [state, setState] = React.useState<
    (ConfirmOpts & { resolve: (v: boolean) => void }) | null
  >(null);
  const confirm = (opts: ConfirmOpts) =>
    new Promise<boolean>((resolve) => {
      setState({ ...opts, resolve });
    });
  const node = state ? (
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
  ) : null;
  return [confirm, node];
}

export { Modal, Select as MSelect, ColorPicker, PageHeader, Empty, useConfirm };

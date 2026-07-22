import React from 'react';
import { createPortal } from 'react-dom';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { PALETTE, iso, addDays, TODAY } from './lib/core.js';
import { useLang, getCal } from './lib/i18n.jsx';
import { startOfWeek, parseISO, toMin, fmtTime } from './calendar/utils.js';

const { Button, IconButton } = DS;

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  size?: 'default' | 'full';
}

function Modal({ open, onClose, title, children, footer, width = 520, size = 'default' }: ModalProps) {
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
      <div
        className={'m-dialog' + (size === 'full' ? ' m-dialog--full' : '')}
        style={size === 'full' ? undefined : { maxWidth: width }}
        role="dialog"
        aria-modal="true"
      >
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
  const norm = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const selected = norm.find((o) => o.value === value);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [pos, setPos] = React.useState<{
    top: number;
    left: number;
    width: number;
    up: boolean;
  } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();

  const openMenu = () => {
    const r = triggerRef.current!.getBoundingClientRect();
    const menuH = Math.min(norm.length * 40 + 12, 280);
    const up = window.innerHeight - r.bottom < menuH + 8 && r.top > menuH + 8;
    setPos({ top: up ? r.top - menuH - 6 : r.bottom + 6, left: r.left, width: r.width, up });
    setActive(
      Math.max(
        0,
        norm.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const pick = (v: string) => {
    onChange(v);
    close();
  };

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const onScroll = (e: Event) => {
      // Ignore scrolling that happens inside the menu itself (e.g. a long
      // time-picker list); only close when the underlying page/modal scrolls.
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    // Scroll the menu directly instead of scrollIntoView(): the latter can
    // also scroll ancestor containers / the document (notably for fixed-
    // position menus in Chrome), which fires a page-level scroll event that
    // the close-on-scroll handler sees and instantly dismisses the menu.
    const menu = menuRef.current;
    const el = menu?.querySelector<HTMLElement>('.is-active');
    if (!menu || !el) return;
    const viewTop = menu.scrollTop;
    const viewBot = viewTop + menu.clientHeight;
    if (el.offsetTop < viewTop) menu.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > viewBot)
      menu.scrollTop = el.offsetTop + el.offsetHeight - menu.clientHeight;
  }, [open, active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => Math.min(i + 1, norm.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(norm.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        pick(norm[active].value);
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        setOpen(false);
        break;
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
      {open &&
        pos &&
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

interface DatePickerProps {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  clearable?: boolean;
}

function DatePicker({ label, value, onChange, hint, clearable }: DatePickerProps) {
  const { t, lang } = useLang();
  const { months, monthsShort, dowMon } = getCal(lang);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number; up: boolean } | null>(null);
  const [cursor, setCursor] = React.useState<Date>(TODAY);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const MENU_W = 272;
  const MENU_H = 332;

  const openMenu = () => {
    const r = triggerRef.current!.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < MENU_H + 8 && r.top > MENU_H + 8;
    const left = Math.min(r.left, window.innerWidth - MENU_W - 8);
    setPos({ top: up ? r.top - MENU_H - 6 : r.bottom + 6, left, up });
    setCursor(value ? parseISO(value) : TODAY);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const pick = (d: Date) => {
    onChange(iso(d));
    close();
  };

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      )
        setOpen(false);
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

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const cells = React.useMemo(() => {
    if (!open) return [];
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [open, cursor]);
  const todayKey = iso(TODAY);

  return (
    <div className="mochi-field">
      {label && <label className="mochi-field__label">{label}</label>}
      <button
        type="button"
        ref={triggerRef}
        className={'m-select__trigger' + (open ? ' is-open' : '')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openMenu())}
      >
        <span
          className="m-select__value"
          style={!value ? { color: 'var(--text-muted)' } : undefined}
        >
          {value
            ? `${parseISO(value).getDate()} ${monthsShort[parseISO(value).getMonth()]} ${parseISO(value).getFullYear()}`
            : t('dp_pick_date')}
        </span>
        <MIcon name="calendar" size={16} className="m-select__chev" />
      </button>
      {hint && <span className="mochi-field__hint">{hint}</span>}
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            className={'m-datepicker__menu' + (pos.up ? ' is-up' : '')}
            style={{ top: pos.top, left: pos.left, width: MENU_W }}
          >
            <div className="m-datepicker__head">
              <button
                type="button"
                className="m-datepicker__nav"
                aria-label={t('dp_prev_month')}
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              >
                <MIcon name="chevronLeft" size={16} />
              </button>
              <span className="m-datepicker__title">
                {months[cursor.getMonth()]} {cursor.getFullYear()}
              </span>
              <button
                type="button"
                className="m-datepicker__nav"
                aria-label={t('dp_next_month')}
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              >
                <MIcon name="chevronRight" size={16} />
              </button>
            </div>
            <div className="m-datepicker__dow">
              {dowMon.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="m-datepicker__grid">
              {cells.map((d, i) => {
                const dk = iso(d);
                const out = d.getMonth() !== cursor.getMonth();
                return (
                  <button
                    key={i}
                    type="button"
                    className={
                      'm-datepicker__day' +
                      (out ? ' is-out' : '') +
                      (dk === todayKey ? ' is-today' : '') +
                      (dk === value ? ' is-selected' : '')
                    }
                    aria-label={dk}
                    aria-pressed={dk === value}
                    onClick={() => pick(d)}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="m-datepicker__foot">
              <button type="button" onClick={() => pick(TODAY)}>
                {t('today')}
              </button>
              {clearable && (
                <button
                  type="button"
                  onClick={() => {
                    onChange('');
                    close();
                  }}
                >
                  {t('dp_clear')}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

interface TimePickerProps {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}

function TimePicker({ label, value, onChange, hint }: TimePickerProps) {
  const options = React.useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (let m = 0; m < 24 * 60; m += 15) {
      const v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      opts.push({ value: v, label: fmtTime(v, true) });
    }
    if (value && !opts.some((o) => o.value === value)) {
      opts.push({ value, label: fmtTime(value, true) });
      opts.sort((a, b) => toMin(a.value) - toMin(b.value));
    }
    return opts;
  }, [value]);
  return <Select label={label} value={value} onChange={onChange} options={options} hint={hint} />;
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

export {
  Modal,
  Select as MSelect,
  DatePicker as MDatePicker,
  TimePicker as MTimePicker,
  ColorPicker,
  PageHeader,
  Empty,
  useConfirm,
};

import React from 'react';
import { createPortal } from 'react-dom';
import { MIcon } from './icons.jsx';
import { useLang } from './lib/i18n.jsx';
import { MAT_TYPES } from './lib/mat-types.js';
import type { MaterialRow } from '../server/services/materials.js';

interface MaterialSearchDropdownProps {
  /** Candidate materials (already excluding attached ones); query filtering happens inside. */
  items: MaterialRow[];
  placeholder: string;
  /** Optional muted hint rendered after the title (e.g. source class, last usage). */
  hint?: (m: MaterialRow) => string;
  /** Action button(s) rendered at the right edge of each row. */
  renderAction: (m: MaterialRow) => React.ReactNode;
}

export function MaterialSearchDropdown({
  items,
  placeholder,
  hint,
  renderAction,
}: MaterialSearchDropdownProps) {
  const { t } = useLang();
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const fieldRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const el = e.target as Node;
      if (wrapRef.current?.contains(el) || menuRef.current?.contains(el)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = fieldRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const ql = q.trim().toLowerCase();
  const pool = items.filter((m) => ql === '' || m.title.toLowerCase().includes(ql));

  return (
    <div className="tokensearch" ref={wrapRef}>
      <div className="tokensearch__field" ref={fieldRef}>
        <MIcon name="search" size={17} />
        <input
          className="tokensearch__input"
          placeholder={placeholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="tokensearch__menu"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            {pool.length > 0 ? (
              pool.slice(0, 8).map((m) => {
                const mt = MAT_TYPES[m.type] ?? MAT_TYPES.notes;
                const h = hint?.(m) ?? '';
                return (
                  <div key={m.id} className="tokensearch__opt" style={{ cursor: 'default' }}>
                    <MIcon name={mt.icon} size={16} />
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      {m.title}
                      {h && (
                        <span
                          className="m-muted"
                          style={{ fontSize: 'var(--text-sm)', marginLeft: 6 }}
                        >
                          {h}
                        </span>
                      )}
                    </span>
                    {renderAction(m)}
                  </div>
                );
              })
            ) : (
              <div className="tokensearch__empty">
                {ql ? t('ts_no_match', { q }) : t('ts_nothing_left')}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

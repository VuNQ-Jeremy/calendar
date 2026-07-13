import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { CalendarThemePanel } from '../screens-extra.jsx';

const { Button: CBtn, IconButton: CIBtn } = DS;

// Renders the theme editor as a right-hand drawer so internal clicks never
// risk dismissing it. Closes only via the X button, the backdrop, or Escape.
export function CalendarThemeDrawer({ onClose }) {
  const { t } = useLang();
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="drawer-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer__head">
          <h3 className="drawer__title">{t('theme_title')}</h3>
          <CIBtn label={t('close')} size="sm" onClick={onClose}>
            <MIcon name="x" size={18} />
          </CIBtn>
        </div>
        <div className="drawer__body">
          <CalendarThemePanel />
        </div>
        <div className="drawer__foot">
          <CBtn variant="primary" onClick={onClose}>
            {t('done')}
          </CBtn>
        </div>
      </aside>
    </div>
  );
}

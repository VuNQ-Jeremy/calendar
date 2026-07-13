// src/instructions.jsx — welcome / how-to-use modal, organized by feature and
// translated. Shown automatically on a user's first visit (flag in localStorage)
// and reopenable from the help (?) button in the sidebar.
import React from 'react';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { Modal } from './ui.jsx';
import { ICON_TINT } from './lib/core.js';
import { useLang } from './lib/i18n.jsx';

const { Button } = DS;

// One category per feature; titles/text come from the i18n dictionary.
const FEATURES = [
  { key: 'dashboard', icon: 'home', color: 'orange' },
  { key: 'calendar', icon: 'calendar', color: 'blue' },
  { key: 'classes', icon: 'book', color: 'green' },
  { key: 'people', icon: 'users', color: 'violet' },
  { key: 'materials', icon: 'folder', color: 'cocoa' },
  { key: 'homework', icon: 'clipboard', color: 'orange' },
  { key: 'feedback', icon: 'message', color: 'rose' },
];

export const SEEN_INTRO_KEY = 'mochi_seen_intro_v1';

export function InstructionsModal({ onClose }) {
  const { t } = useLang();
  return (
    <Modal open={true} onClose={onClose} title={t('intro_title')} width={580} footer={<Button variant="primary" onClick={onClose}>{t('intro_get_started')}</Button>}>
      <p className="m-muted" style={{ marginTop: 0, fontSize: 'var(--text-sm)' }}>
        {t('intro_lead')}
      </p>
      <div className="m-stack" style={{ gap: 14 }}>
        {FEATURES.map((f) => (
          <div key={f.key} className="m-row" style={{ gap: 14, alignItems: 'flex-start' }}>
            <div className="iconwrap" style={{ width: 44, height: 44, ...ICON_TINT(f.color) }}>
              <MIcon name={f.icon} size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 800, color: 'var(--text-strong)' }}>
                {t('feat_' + f.key + '_title')}
              </div>
              <div
                className="m-muted"
                style={{ fontSize: 'var(--text-sm)', marginTop: 2, textWrap: 'pretty' }}
              >
                {t('feat_' + f.key + '_text')}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div
        className="m-row"
        style={{ gap: 8, marginTop: 18, color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}
      >
        <MIcon name="sparkle" size={14} />
        {t('intro_footer')}
      </div>
    </Modal>
  );
}

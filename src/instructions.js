// src/instructions.js — welcome / how-to-use modal, organized by feature and
// translated. Shown automatically on a user's first visit (flag in localStorage)
// and reopenable from the help (?) button in the sidebar.
import React from 'react';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { Modal } from './ui.js';
import { ICON_TINT } from './lib/core.js';
import { useLang } from './lib/i18n.js';

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
  return React.createElement(
    Modal,
    {
      open: true,
      onClose,
      title: t('intro_title'),
      width: 580,
      footer: React.createElement(
        Button,
        { variant: 'primary', onClick: onClose },
        t('intro_get_started'),
      ),
    },
    React.createElement(
      'p',
      { className: 'm-muted', style: { marginTop: 0, fontSize: 'var(--text-sm)' } },
      t('intro_lead'),
    ),
    React.createElement(
      'div',
      { className: 'm-stack', style: { gap: 14 } },
      FEATURES.map((f) =>
        React.createElement(
          'div',
          { key: f.key, className: 'm-row', style: { gap: 14, alignItems: 'flex-start' } },
          React.createElement(
            'div',
            { className: 'iconwrap', style: { width: 44, height: 44, ...ICON_TINT(f.color) } },
            React.createElement(MIcon, { name: f.icon, size: 20 }),
          ),
          React.createElement(
            'div',
            null,
            React.createElement(
              'div',
              { style: { fontWeight: 800, color: 'var(--text-strong)' } },
              t('feat_' + f.key + '_title'),
            ),
            React.createElement(
              'div',
              {
                className: 'm-muted',
                style: { fontSize: 'var(--text-sm)', marginTop: 2, textWrap: 'pretty' },
              },
              t('feat_' + f.key + '_text'),
            ),
          ),
        ),
      ),
    ),
    React.createElement(
      'div',
      {
        className: 'm-row',
        style: { gap: 8, marginTop: 18, color: 'var(--text-muted)', fontSize: 'var(--text-xs)' },
      },
      React.createElement(MIcon, { name: 'sparkle', size: 14 }),
      t('intro_footer'),
    ),
  );
}

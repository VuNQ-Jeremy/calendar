// src/main.js — application root: auth gate, session persistence, app-shell mount.

import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/400-italic.css';
import '@fontsource/nunito-sans/500.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import './ds/styles/styles.css';
import './styles/app.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { LanguageProvider } from './lib/i18n.js';
import { StoreProvider } from './store.js';
import { AppShell } from './shell.js';
import { AuthScreen } from './auth.jsx';

const SESSION_KEY = 'mochi_session_v1';

// Layout/brand defaults (the prototype exposed these via a dev "tweaks" panel;
// here they are fixed app defaults, surfaced as CSS variables by the shell).
const TWEAKS = {
  accent: '#F79A4E',
  sidebar: 'regular',
  rounding: 'soft',
  density: 'regular',
};

function Root() {
  const [user, setUser] = React.useState(() => {
    try {
      const r = localStorage.getItem(SESSION_KEY);
      return r ? JSON.parse(r) : null;
    } catch {
      return null;
    }
  });

  const login = (u, remember) => {
    setUser(u);
    if (remember) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(u));
      } catch {
        /* storage unavailable */
      }
    }
  };
  const logout = () => {
    setUser(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
  };
  const updateUser = (patch) =>
    setUser((u) => {
      const nu = { ...u, ...patch };
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(nu));
      } catch {
        /* storage unavailable */
      }
      return nu;
    });

  return React.createElement(
    LanguageProvider,
    null,
    React.createElement(
      StoreProvider,
      null,
      user
        ? React.createElement(AppShell, {
            user,
            onLogout: logout,
            onUpdateUser: updateUser,
            tweaks: TWEAKS,
          })
        : React.createElement(AuthScreen, { onLogin: login }),
    ),
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Root));

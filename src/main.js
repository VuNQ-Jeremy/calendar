// src/main.js — application root: auth gate, session persistence, app-shell mount.

import './styles/app.css';
import { React, ReactDOM } from './lib/globals.js';
import { LanguageProvider } from './lib/i18n.js';
import { StoreProvider } from './store.js';
import { AppShell } from './shell.js';
import { AuthScreen } from './auth.js';

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
    try { const r = localStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  });

  const login = (u, remember) => {
    setUser(u);
    if (remember) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(u)); } catch (e) { /* storage unavailable */ } }
  };
  const logout = () => { setUser(null); try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* storage unavailable */ } };
  const updateUser = (patch) => setUser((u) => {
    const nu = { ...u, ...patch };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(nu)); } catch (e) { /* storage unavailable */ }
    return nu;
  });

  return React.createElement(LanguageProvider, null,
    React.createElement(StoreProvider, null,
      user
        ? React.createElement(AppShell, { user, onLogout: logout, onUpdateUser: updateUser, tweaks: TWEAKS })
        : React.createElement(AuthScreen, { onLogin: login }),
    ),
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Root));

// app/main.jsx — root: auth gate, session persistence, tweaks wiring
const { useTweaks, TweaksPanel, TweakSection, TweakColor, TweakRadio } = window;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#F79A4E",
  "sidebar": "regular",
  "rounding": "soft",
  "density": "regular"
}/*EDITMODE-END*/;

const SESSION_KEY = 'mochi_session_v1';

function Root() {
  const [user, setUser] = React.useState(() => {
    try { const r = localStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  });
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const login = (u, remember) => {
    setUser(u);
    if (remember) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(u)); } catch (e) {} }
  };
  const logout = () => { setUser(null); try { localStorage.removeItem(SESSION_KEY); } catch (e) {} };
  const updateUser = (patch) => setUser(u => { const nu = { ...u, ...patch }; try { localStorage.setItem(SESSION_KEY, JSON.stringify(nu)); } catch (e) {} return nu; });

  const panel = React.createElement(TweaksPanel, null,
    React.createElement(TweakSection, { label: 'Brand' }),
    React.createElement(TweakColor, { label: 'Accent', value: t.accent, options: ['#F79A4E', '#57A7D2', '#6FB97A', '#A185E4', '#DC6A52'], onChange: v => setTweak('accent', v) }),
    React.createElement(TweakSection, { label: 'Layout' }),
    React.createElement(TweakRadio, { label: 'Sidebar', value: t.sidebar, options: ['compact', 'regular', 'wide'], onChange: v => setTweak('sidebar', v) }),
    React.createElement(TweakRadio, { label: 'Corners', value: t.rounding, options: ['sharp', 'soft', 'round'], onChange: v => setTweak('rounding', v) }),
    React.createElement(TweakRadio, { label: 'Density', value: t.density, options: ['compact', 'regular', 'comfy'], onChange: v => setTweak('density', v) }),
  );

  return React.createElement(window.StoreProvider, null,
    user
      ? React.createElement(window.AppShell, { user, onLogout: logout, onUpdateUser: updateUser, tweaks: t })
      : React.createElement(window.AuthScreen, { onLogin: login }),
    panel,
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Root));

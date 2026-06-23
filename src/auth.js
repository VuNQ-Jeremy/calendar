import { React, DS } from './lib/globals.js';
import { MIcon } from './icons.js';
import { useStore } from './store.js';

// app/auth.jsx — login / signup / forgot password / onboarding via one-time code
const { Button: AButton, Input: AInput, Switch: ASwitch, Tag: ATag } = DS;

function AuthField({ icon, ...props }) {
  return React.createElement('div', { className: 'auth-field' },
    React.createElement(MIcon, { name: icon, size: 18, className: 'auth-field__icon' }),
    React.createElement('input', { className: 'mochi-input auth-input', ...props }),
  );
}

function AuthScreen({ onLogin }) {
  const { data } = useStore();
  const [mode, setMode] = React.useState('login'); // login | signup | forgot | code
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [name, setName] = React.useState('');
  const [remember, setRemember] = React.useState(true);
  const [showPw, setShowPw] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [codeOk, setCodeOk] = React.useState(null); // matched invite

  const reset = () => { setError(''); setSent(false); setCodeOk(null); };

  const doLogin = () => {
    if (!email || !pw) { setError('Enter your email and password.'); return; }
    const user = data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    onLogin(user || { id: 'u1', name: email.split('@')[0].replace(/^./, c => c.toUpperCase()), email, role: 'Teacher', color: 'orange' }, remember);
  };
  const doSignup = () => {
    if (!name || !email || !pw) { setError('Fill in your name, email, and password.'); return; }
    if (pw !== pw2) { setError('Passwords don’t match.'); return; }
    onLogin({ id: 'new', name, email, role: 'Teacher', color: 'violet' }, true);
  };
  const checkCode = () => {
    const norm = code.trim().toUpperCase().replace(/\s/g, '');
    const match = data.invites.find(i => i.code.replace('-', '') === norm.replace('-', '') && !i.used);
    if (match) { setCodeOk(match); setError(''); }
    else { setError('That code isn’t valid or has already been used.'); setCodeOk(null); }
  };
  const finishOnboard = () => {
    if (!name || !pw) { setError('Add your name and a password to finish.'); return; }
    onLogin({ id: 'invited', name, email: email || codeOk.name, role: codeOk.role, color: 'green', invited: true }, true);
  };

  const sampleInvite = data.invites.find(i => !i.used);

  // ---- panels ----
  const Brand = React.createElement('div', { className: 'auth-brand' },
    React.createElement('div', { className: 'auth-brand__mark' }, React.createElement(MIcon, { name: 'paw', size: 30 })),
    React.createElement('div', { className: 'auth-brand__name' }, 'Mochi'),
    React.createElement('p', { className: 'auth-brand__tag' }, 'A calm home for classes, calendars, and coursework — for your whole school family.'),
    React.createElement('div', { className: 'auth-brand__chips' },
      React.createElement(ATag, { color: 'green' }, 'Classes'),
      React.createElement(ATag, { color: 'blue' }, 'Calendar'),
      React.createElement(ATag, { color: 'violet' }, 'Materials'),
      React.createElement(ATag, { color: 'orange' }, 'Homework'),
    ),
    React.createElement('div', { className: 'auth-brand__paws' },
      React.createElement(MIcon, { name: 'paw', size: 16 }),
      React.createElement(MIcon, { name: 'paw', size: 22 }),
      React.createElement(MIcon, { name: 'paw', size: 16 }),
    ),
  );

  let form;
  if (mode === 'login') {
    form = React.createElement(React.Fragment, null,
      React.createElement('h2', { className: 'auth-title' }, 'Welcome back'),
      React.createElement('p', { className: 'auth-sub' }, 'Sign in to pick up where you left off.'),
      React.createElement(AuthField, { icon: 'mail', type: 'email', placeholder: 'you@school.edu', value: email, onChange: e => setEmail(e.target.value) }),
      React.createElement('div', { className: 'auth-field' },
        React.createElement(MIcon, { name: 'lock', size: 18, className: 'auth-field__icon' }),
        React.createElement('input', { className: 'mochi-input auth-input', type: showPw ? 'text' : 'password', placeholder: 'Password', value: pw, onChange: e => setPw(e.target.value), onKeyDown: e => e.key === 'Enter' && doLogin() }),
        React.createElement('button', { type: 'button', className: 'auth-field__eye', onClick: () => setShowPw(s => !s), 'aria-label': 'Toggle password' }, React.createElement(MIcon, { name: showPw ? 'eyeOff' : 'eye', size: 18 })),
      ),
      error && React.createElement('div', { className: 'auth-error' }, error),
      React.createElement('div', { className: 'auth-row' },
        React.createElement(ASwitch, { checked: remember, onChange: e => setRemember(e.target.checked), label: 'Remember me' }),
        React.createElement('button', { className: 'auth-link', onClick: () => { reset(); setMode('forgot'); } }, 'Forgot password?'),
      ),
      React.createElement(AButton, { variant: 'primary', block: true, onClick: doLogin }, 'Sign in'),
      React.createElement('div', { className: 'auth-divider' }, React.createElement('span', null, 'or')),
      React.createElement(AButton, { variant: 'secondary', block: true, onClick: () => { reset(); setMode('code'); }, iconLeft: React.createElement(MIcon, { name: 'key', size: 18 }) }, 'I have an invite code'),
      React.createElement('p', { className: 'auth-foot' }, 'New here? ',
        React.createElement('button', { className: 'auth-link', onClick: () => { reset(); setMode('signup'); } }, 'Create an account')),
    );
  } else if (mode === 'signup') {
    form = React.createElement(React.Fragment, null,
      React.createElement('h2', { className: 'auth-title' }, 'Create your account'),
      React.createElement('p', { className: 'auth-sub' }, 'For teachers and staff. Takes about a minute.'),
      React.createElement(AuthField, { icon: 'users', placeholder: 'Full name', value: name, onChange: e => setName(e.target.value) }),
      React.createElement(AuthField, { icon: 'mail', type: 'email', placeholder: 'you@school.edu', value: email, onChange: e => setEmail(e.target.value) }),
      React.createElement(AuthField, { icon: 'lock', type: 'password', placeholder: 'Password', value: pw, onChange: e => setPw(e.target.value) }),
      React.createElement(AuthField, { icon: 'lock', type: 'password', placeholder: 'Confirm password', value: pw2, onChange: e => setPw2(e.target.value) }),
      error && React.createElement('div', { className: 'auth-error' }, error),
      React.createElement(AButton, { variant: 'primary', block: true, onClick: doSignup }, 'Create account'),
      React.createElement('p', { className: 'auth-foot' }, 'Already have an account? ',
        React.createElement('button', { className: 'auth-link', onClick: () => { reset(); setMode('login'); } }, 'Sign in')),
    );
  } else if (mode === 'forgot') {
    form = React.createElement(React.Fragment, null,
      React.createElement('h2', { className: 'auth-title' }, 'Reset your password'),
      React.createElement('p', { className: 'auth-sub' }, sent ? 'Check your inbox for a reset link.' : 'We’ll send a reset link to your email.'),
      !sent && React.createElement(AuthField, { icon: 'mail', type: 'email', placeholder: 'you@school.edu', value: email, onChange: e => setEmail(e.target.value) }),
      error && React.createElement('div', { className: 'auth-error' }, error),
      sent
        ? React.createElement('div', { className: 'auth-success' }, React.createElement(MIcon, { name: 'check', size: 18 }), 'Sent to ', React.createElement('strong', null, email || 'your email'))
        : React.createElement(AButton, { variant: 'primary', block: true, onClick: () => { if (!email) { setError('Enter your email.'); return; } setError(''); setSent(true); } }, 'Send reset link'),
      React.createElement('p', { className: 'auth-foot' },
        React.createElement('button', { className: 'auth-link', onClick: () => { reset(); setMode('login'); } }, '← Back to sign in')),
    );
  } else if (mode === 'code') {
    form = codeOk
      ? React.createElement(React.Fragment, null,
          React.createElement('h2', { className: 'auth-title' }, 'You’re invited 🎉'),
          React.createElement('p', { className: 'auth-sub' }, 'Joining as ', React.createElement('strong', null, codeOk.role.toLowerCase()), codeOk.name ? ` · ${codeOk.name}` : ''),
          React.createElement(AuthField, { icon: 'users', placeholder: 'Your name', value: name, onChange: e => setName(e.target.value) }),
          React.createElement(AuthField, { icon: 'mail', type: 'email', placeholder: 'Email (optional)', value: email, onChange: e => setEmail(e.target.value) }),
          React.createElement(AuthField, { icon: 'lock', type: 'password', placeholder: 'Choose a password', value: pw, onChange: e => setPw(e.target.value) }),
          error && React.createElement('div', { className: 'auth-error' }, error),
          React.createElement(AButton, { variant: 'primary', block: true, onClick: finishOnboard }, 'Join Mochi'),
        )
      : React.createElement(React.Fragment, null,
          React.createElement('h2', { className: 'auth-title' }, 'Enter your invite code'),
          React.createElement('p', { className: 'auth-sub' }, 'Your school admin gave you a one-time code to get started.'),
          React.createElement('input', { className: 'mochi-input auth-code', placeholder: 'ABC-123', value: code, maxLength: 7, onChange: e => setCode(e.target.value.toUpperCase()), onKeyDown: e => e.key === 'Enter' && checkCode() }),
          error && React.createElement('div', { className: 'auth-error' }, error),
          sampleInvite && React.createElement('div', { className: 'auth-hint-code' }, 'Demo code: ', React.createElement('button', { className: 'auth-link', onClick: () => setCode(sampleInvite.code) }, sampleInvite.code)),
          React.createElement(AButton, { variant: 'primary', block: true, onClick: checkCode }, 'Continue'),
          React.createElement('p', { className: 'auth-foot' },
            React.createElement('button', { className: 'auth-link', onClick: () => { reset(); setMode('login'); } }, '← Back to sign in')),
        );
  }

  return React.createElement('div', { className: 'auth-wrap' },
    React.createElement('div', { className: 'auth-card' },
      React.createElement('div', { className: 'auth-card__brand' }, Brand),
      React.createElement('div', { className: 'auth-card__form' }, form),
    ),
  );
}

export { AuthScreen };

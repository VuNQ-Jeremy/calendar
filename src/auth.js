import React from 'react';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { useStore } from './store.js';
import { useLang } from './lib/i18n.js';

// app/auth.jsx — login / signup / forgot password / onboarding via one-time code
const { Button: AButton, Switch: ASwitch, Tag: ATag } = DS;

function AuthField({ icon, ...props }) {
  return React.createElement(
    'div',
    { className: 'auth-field' },
    React.createElement(MIcon, { name: icon, size: 18, className: 'auth-field__icon' }),
    React.createElement('input', { className: 'mochi-input auth-input', ...props }),
  );
}

function AuthScreen({ onLogin }) {
  const { data } = useStore();
  const { t } = useLang();
  const roleLabel = (r) => t('role_' + String(r || '').toLowerCase());
  const [mode, setMode] = React.useState('login'); // login | code
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [name, setName] = React.useState('');
  const [remember, setRemember] = React.useState(true);
  const [showPw, setShowPw] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState('');
  const [codeOk, setCodeOk] = React.useState(null); // matched invite

  const reset = () => {
    setError('');
    setCodeOk(null);
  };

  const doLogin = () => {
    if (!email || !pw) {
      setError(t('auth_enter_both'));
      return;
    }
    const user = data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    onLogin(
      user || {
        id: 'u1',
        name: email.split('@')[0].replace(/^./, (c) => c.toUpperCase()),
        email,
        role: 'Teacher',
        color: 'orange',
      },
      remember,
    );
  };
  const checkCode = () => {
    const norm = code.trim().toUpperCase().replace(/\s/g, '');
    const match = data.invites.find(
      (i) => i.code.replace('-', '') === norm.replace('-', '') && !i.used,
    );
    if (match) {
      setCodeOk(match);
      setError('');
    } else {
      setError(t('auth_invite_invalid'));
      setCodeOk(null);
    }
  };
  const finishOnboard = () => {
    if (!name || !pw) {
      setError(t('auth_add_name_pw'));
      return;
    }
    onLogin(
      {
        id: 'invited',
        name,
        email: email || codeOk.name,
        role: codeOk.role,
        color: 'green',
        invited: true,
      },
      true,
    );
  };

  const sampleInvite = data.invites.find((i) => !i.used);

  // ---- panels ----
  const Brand = React.createElement(
    'div',
    { className: 'auth-brand' },
    React.createElement(
      'div',
      { className: 'auth-brand__mark' },
      React.createElement(MIcon, { name: 'paw', size: 30 }),
    ),
    React.createElement('div', { className: 'auth-brand__name' }, 'Mochi'),
    React.createElement('p', { className: 'auth-brand__tag' }, t('auth_tagline')),
    React.createElement(
      'div',
      { className: 'auth-brand__chips' },
      React.createElement(ATag, { color: 'green' }, t('chip_classes')),
      React.createElement(ATag, { color: 'blue' }, t('chip_calendar')),
      React.createElement(ATag, { color: 'violet' }, t('chip_materials')),
      React.createElement(ATag, { color: 'orange' }, t('chip_homework')),
    ),
    React.createElement(
      'div',
      { className: 'auth-brand__paws' },
      React.createElement(MIcon, { name: 'paw', size: 16 }),
      React.createElement(MIcon, { name: 'paw', size: 22 }),
      React.createElement(MIcon, { name: 'paw', size: 16 }),
    ),
  );

  let form;
  if (mode === 'login') {
    form = React.createElement(
      React.Fragment,
      null,
      React.createElement('h2', { className: 'auth-title' }, t('auth_welcome')),
      React.createElement('p', { className: 'auth-sub' }, t('auth_welcome_sub')),
      React.createElement(AuthField, {
        icon: 'mail',
        type: 'email',
        placeholder: 'you@school.edu',
        value: email,
        onChange: (e) => setEmail(e.target.value),
      }),
      React.createElement(
        'div',
        { className: 'auth-field' },
        React.createElement(MIcon, { name: 'lock', size: 18, className: 'auth-field__icon' }),
        React.createElement('input', {
          className: 'mochi-input auth-input',
          type: showPw ? 'text' : 'password',
          placeholder: t('auth_password'),
          value: pw,
          onChange: (e) => setPw(e.target.value),
          onKeyDown: (e) => e.key === 'Enter' && doLogin(),
        }),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'auth-field__eye',
            onClick: () => setShowPw((s) => !s),
            'aria-label': 'Toggle password',
          },
          React.createElement(MIcon, { name: showPw ? 'eyeOff' : 'eye', size: 18 }),
        ),
      ),
      error && React.createElement('div', { className: 'auth-error' }, error),
      React.createElement(
        'div',
        { className: 'auth-row' },
        React.createElement(ASwitch, {
          checked: remember,
          onChange: (e) => setRemember(e.target.checked),
          label: t('auth_remember'),
        }),
      ),
      React.createElement(
        AButton,
        { variant: 'primary', block: true, onClick: doLogin },
        t('auth_signin'),
      ),
      React.createElement(
        'div',
        { className: 'auth-divider' },
        React.createElement('span', null, t('auth_or')),
      ),
      React.createElement(
        AButton,
        {
          variant: 'secondary',
          block: true,
          onClick: () => {
            reset();
            setMode('code');
          },
          iconLeft: React.createElement(MIcon, { name: 'key', size: 18 }),
        },
        t('auth_have_code'),
      ),
    );
  } else if (mode === 'code') {
    form = codeOk
      ? React.createElement(
          React.Fragment,
          null,
          React.createElement('h2', { className: 'auth-title' }, t('auth_invited_title')),
          React.createElement(
            'p',
            { className: 'auth-sub' },
            t('auth_joining_as'),
            ' ',
            React.createElement('strong', null, roleLabel(codeOk.role).toLowerCase()),
            codeOk.name ? ` · ${codeOk.name}` : '',
          ),
          React.createElement(AuthField, {
            icon: 'users',
            placeholder: t('auth_your_name'),
            value: name,
            onChange: (e) => setName(e.target.value),
          }),
          React.createElement(AuthField, {
            icon: 'mail',
            type: 'email',
            placeholder: t('auth_email_optional'),
            value: email,
            onChange: (e) => setEmail(e.target.value),
          }),
          React.createElement(AuthField, {
            icon: 'lock',
            type: 'password',
            placeholder: t('auth_choose_pw'),
            value: pw,
            onChange: (e) => setPw(e.target.value),
          }),
          error && React.createElement('div', { className: 'auth-error' }, error),
          React.createElement(
            AButton,
            { variant: 'primary', block: true, onClick: finishOnboard },
            t('auth_join'),
          ),
        )
      : React.createElement(
          React.Fragment,
          null,
          React.createElement('h2', { className: 'auth-title' }, t('auth_invite_title')),
          React.createElement('p', { className: 'auth-sub' }, t('auth_invite_sub')),
          React.createElement('input', {
            className: 'mochi-input auth-code',
            placeholder: 'ABC-123',
            value: code,
            maxLength: 7,
            onChange: (e) => setCode(e.target.value.toUpperCase()),
            onKeyDown: (e) => e.key === 'Enter' && checkCode(),
          }),
          error && React.createElement('div', { className: 'auth-error' }, error),
          sampleInvite &&
            React.createElement(
              'div',
              { className: 'auth-hint-code' },
              t('auth_demo_code'),
              ' ',
              React.createElement(
                'button',
                { className: 'auth-link', onClick: () => setCode(sampleInvite.code) },
                sampleInvite.code,
              ),
            ),
          React.createElement(
            AButton,
            { variant: 'primary', block: true, onClick: checkCode },
            t('auth_continue'),
          ),
          React.createElement(
            'p',
            { className: 'auth-foot' },
            React.createElement(
              'button',
              {
                className: 'auth-link',
                onClick: () => {
                  reset();
                  setMode('login');
                },
              },
              t('auth_back_signin'),
            ),
          ),
        );
  }

  return React.createElement(
    'div',
    { className: 'auth-wrap' },
    React.createElement(
      'div',
      { className: 'auth-card' },
      React.createElement('div', { className: 'auth-card__brand' }, Brand),
      React.createElement('div', { className: 'auth-card__form' }, form),
    ),
  );
}

export { AuthScreen };

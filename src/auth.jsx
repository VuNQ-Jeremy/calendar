import React from 'react';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { useStore } from './store.jsx';
import { useLang } from './lib/i18n.jsx';

// app/auth.jsx — login / signup / forgot password / onboarding via one-time code
const { Button: AButton, Switch: ASwitch, Tag: ATag } = DS;

function AuthField({ icon, ...props }) {
  return (
    <div className="auth-field">
      <MIcon name={icon} size={18} className="auth-field__icon" />
      <input className="mochi-input auth-input" {...props} />
    </div>
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
  const Brand = (
    <div className="auth-brand">
      <div className="auth-brand__mark">
        <MIcon name="paw" size={30} />
      </div>
      <div className="auth-brand__name">Mochi</div>
      <p className="auth-brand__tag">{t('auth_tagline')}</p>
      <div className="auth-brand__chips">
        <ATag color="green">{t('chip_classes')}</ATag>
        <ATag color="blue">{t('chip_calendar')}</ATag>
        <ATag color="violet">{t('chip_materials')}</ATag>
        <ATag color="orange">{t('chip_homework')}</ATag>
      </div>
      <div className="auth-brand__paws">
        <MIcon name="paw" size={16} />
        <MIcon name="paw" size={22} />
        <MIcon name="paw" size={16} />
      </div>
    </div>
  );

  let form;
  if (mode === 'login') {
    form = (
      <>
        <h2 className="auth-title">{t('auth_welcome')}</h2>
        <p className="auth-sub">{t('auth_welcome_sub')}</p>
        <AuthField
          icon="mail"
          type="email"
          placeholder="you@school.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="auth-field">
          <MIcon name="lock" size={18} className="auth-field__icon" />
          <input
            className="mochi-input auth-input"
            type={showPw ? 'text' : 'password'}
            placeholder={t('auth_password')}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doLogin()}
          />
          <button
            type="button"
            className="auth-field__eye"
            onClick={() => setShowPw((s) => !s)}
            aria-label="Toggle password"
          >
            <MIcon name={showPw ? 'eyeOff' : 'eye'} size={18} />
          </button>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <div className="auth-row">
          <ASwitch
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            label={t('auth_remember')}
          />
        </div>
        <AButton variant="primary" block={true} onClick={doLogin}>
          {t('auth_signin')}
        </AButton>
        <div className="auth-divider">
          <span>{t('auth_or')}</span>
        </div>
        <AButton
          variant="secondary"
          block={true}
          onClick={() => {
            reset();
            setMode('code');
          }}
          iconLeft={<MIcon name="key" size={18} />}
        >
          {t('auth_have_code')}
        </AButton>
      </>
    );
  } else if (mode === 'code') {
    form = codeOk ? (
      <>
        <h2 className="auth-title">{t('auth_invited_title')}</h2>
        <p className="auth-sub">
          {t('auth_joining_as')} <strong>{roleLabel(codeOk.role).toLowerCase()}</strong>
          {codeOk.name ? ` · ${codeOk.name}` : ''}
        </p>
        <AuthField
          icon="users"
          placeholder={t('auth_your_name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <AuthField
          icon="mail"
          type="email"
          placeholder={t('auth_email_optional')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <AuthField
          icon="lock"
          type="password"
          placeholder={t('auth_choose_pw')}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        {error && <div className="auth-error">{error}</div>}
        <AButton variant="primary" block={true} onClick={finishOnboard}>
          {t('auth_join')}
        </AButton>
      </>
    ) : (
      <>
        <h2 className="auth-title">{t('auth_invite_title')}</h2>
        <p className="auth-sub">{t('auth_invite_sub')}</p>
        <input
          className="mochi-input auth-code"
          placeholder="ABC-123"
          value={code}
          maxLength={7}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && checkCode()}
        />
        {error && <div className="auth-error">{error}</div>}
        {sampleInvite && (
          <div className="auth-hint-code">
            {t('auth_demo_code')}{' '}
            <button className="auth-link" onClick={() => setCode(sampleInvite.code)}>
              {sampleInvite.code}
            </button>
          </div>
        )}
        <AButton variant="primary" block={true} onClick={checkCode}>
          {t('auth_continue')}
        </AButton>
        <p className="auth-foot">
          <button
            className="auth-link"
            onClick={() => {
              reset();
              setMode('login');
            }}
          >
            {t('auth_back_signin')}
          </button>
        </p>
      </>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-card__brand">{Brand}</div>
        <div className="auth-card__form">{form}</div>
      </div>
    </div>
  );
}

export { AuthScreen };

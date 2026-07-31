import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Eye, EyeOff, KeyRound, Lock, Mail, PawPrint, UserRound } from 'lucide-react-native';
import { router } from 'expo-router';
import { ApiError } from '~/lib/api';
import * as api from '~/lib/endpoints';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import {
  Body,
  Button,
  Card,
  IconButton,
  Input,
  Muted,
  Screen,
  Tag,
  Title,
} from '~/ui';

/**
 * Port of `app/routes/login.tsx`. Four modes, minus one.
 *
 *   sign-in           email + password
 *   invite redemption XXX-XXX code, name, optional email, password
 *   forgot password   email -> POST /api/auth/request-reset
 *   reset with token  NOT SHIPPED — see below
 *
 * The web has a two-step invite flow (an `intent=redeem-check` round trip that looks the code
 * up and shows the role before asking for a password). The JSON API has no such endpoint —
 * `POST /api/auth/redeem-invite` takes everything at once — so this is one form. Nothing is
 * lost: an invalid code still fails with the same `auth_invite_invalid` message.
 *
 * **Reset-with-token is deliberately deferred.** It only arrives by email link, which needs an
 * Android app link (a verified https intent filter plus assetlinks.json served from the
 * domain), and phase 2's job is to get an APK onto a phone. The plan sanctions deferring it
 * provided the UI says so rather than showing a broken flow — hence `m_reset_on_web`.
 */

type Mode = 'login' | 'invite' | 'forgot';

export default function Login() {
  const th = useTheme();
  const { t } = useLang();
  const { login, redeemInvite, expired, status } = useAuth();

  const [mode, setMode] = React.useState<Mode>('login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPw, setShowPw] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  // A successful sign-in flips auth status; the index route then routes by role.
  React.useEffect(() => {
    if (status === 'signed-in') router.replace('/');
  }, [status]);

  /** Runs a request, mapping any failure to an i18n key. `missingKey` guards the empty form. */
  const run = async (missingKey: string | null, fn: () => Promise<void>) => {
    if (missingKey) {
      setError(missingKey);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      // ApiError carries an i18n key, but a 401 HERE is a wrong password, not an expired
      // session — the generic 401 message would be actively misleading on a login form.
      if (err instanceof ApiError) {
        setError(
          err.status === 401 || err.status === 400 || err.status === 422
            ? 'auth_wrong_creds'
            : err.messageKey,
        );
      } else {
        setError('err_generic_msg');
      }
    } finally {
      setBusy(false);
    }
  };

  const onSignIn = () =>
    run(!email.trim() || !password ? 'auth_enter_both' : null, () =>
      login({ email: email.trim(), password }),
    );

  const onRedeem = () =>
    run(!name.trim() || !password ? 'auth_add_name_pw' : null, () =>
      redeemInvite({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        // An empty string would fail the API's .email() check — omit the key instead.
        ...(email.trim() ? { email: email.trim() } : {}),
        password,
      }),
    );

  const onForgot = () =>
    run(!email.trim() ? 'auth_enter_email' : null, async () => {
      await api.requestReset(email.trim());
      // Always reports success — the endpoint never reveals whether the address exists.
      setSentTo(email.trim());
    });

  const reset = (next: Mode) => {
    setMode(next);
    setError(null);
    setSentTo(null);
    setPassword('');
  };

  const pwToggle = (
    <IconButton
      size="sm"
      label={t('auth_password')}
      onPress={() => setShowPw((s) => !s)}
    >
      {showPw ? (
        <EyeOff size={18} color={th.color.textMuted} />
      ) : (
        <Eye size={18} color={th.color.textMuted} />
      )}
    </IconButton>
  );

  return (
    // Both insets: this screen is outside the tab group, so there is no tab bar below it to pad
    // the bottom one.
    <Screen edges={{ top: true, bottom: true }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[5], flexGrow: 1, justifyContent: 'center' }}
        >
          {/* Brand block — the same paw mark and chips as the web auth screen. */}
          <View style={{ alignItems: 'center', gap: th.spacing[3] }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: th.radius.xl,
                backgroundColor: th.color.brand,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <PawPrint size={32} color={th.color.textOnBrand} />
            </View>
            <Title style={{ fontSize: 30, lineHeight: 38 }}>Mochi</Title>
            <Muted style={{ textAlign: 'center' }}>{t('auth_tagline')}</Muted>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: th.spacing[2],
                justifyContent: 'center',
              }}
            >
              <Tag color="green">{t('chip_classes')}</Tag>
              <Tag color="blue">{t('chip_calendar')}</Tag>
              <Tag color="violet">{t('chip_materials')}</Tag>
              <Tag color="orange">{t('chip_tests')}</Tag>
            </View>
          </View>

          <Card style={{ gap: th.spacing[4] }}>
            {expired ? (
              <Body style={{ color: th.status.warning }}>{t('m_session_expired')}</Body>
            ) : null}

            {mode === 'login' ? (
              <>
                <Title>{t('auth_welcome')}</Title>
                <Muted>{t('auth_welcome_sub')}</Muted>
                <Input
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@school.edu"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  iconLeft={<Mail size={18} color={th.color.textMuted} />}
                />
                <Input
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('auth_password')}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoComplete="current-password"
                  textContentType="password"
                  onSubmitEditing={onSignIn}
                  returnKeyType="go"
                  iconLeft={<Lock size={18} color={th.color.textMuted} />}
                  iconRight={pwToggle}
                />
                {error ? <Body style={{ color: th.status.danger }}>{t(error)}</Body> : null}
                {/* No "remember me" switch. The API issues a 90-day sliding session for every
                    mobile login (api.auth.login.tsx sets ttlDays: 90 unconditionally), so the
                    control would have nothing to toggle — and on a personal phone, always
                    remembering is the right behavior anyway. */}
                <Button block loading={busy} onPress={onSignIn}>
                  {t('auth_signin')}
                </Button>
                <Button variant="ghost" block onPress={() => reset('forgot')}>
                  {t('auth_forgot')}
                </Button>
                <Muted style={{ textAlign: 'center' }}>{t('auth_or')}</Muted>
                <Button
                  variant="secondary"
                  block
                  onPress={() => reset('invite')}
                  iconLeft={<KeyRound size={18} color={th.color.textStrong} />}
                >
                  {t('auth_have_code')}
                </Button>
              </>
            ) : null}

            {mode === 'invite' ? (
              <>
                <Title>{t('auth_invite_title')}</Title>
                <Muted>{t('auth_invite_sub')}</Muted>
                <Input
                  value={code}
                  onChangeText={(v) => setCode(v.toUpperCase())}
                  placeholder="ABC-123"
                  maxLength={7}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={{ fontFamily: th.font.mono, letterSpacing: 2 }}
                  iconLeft={<KeyRound size={18} color={th.color.textMuted} />}
                />
                <Input
                  value={name}
                  onChangeText={setName}
                  placeholder={t('auth_your_name')}
                  autoComplete="name"
                  iconLeft={<UserRound size={18} color={th.color.textMuted} />}
                />
                <Input
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('auth_email_optional')}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  iconLeft={<Mail size={18} color={th.color.textMuted} />}
                />
                <Input
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('auth_choose_pw')}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  iconLeft={<Lock size={18} color={th.color.textMuted} />}
                  iconRight={pwToggle}
                />
                {error ? <Body style={{ color: th.status.danger }}>{t(error)}</Body> : null}
                <Button block loading={busy} onPress={onRedeem}>
                  {t('auth_join')}
                </Button>
                <Button variant="ghost" block onPress={() => reset('login')}>
                  {t('auth_back_signin')}
                </Button>
              </>
            ) : null}

            {mode === 'forgot' ? (
              <>
                <Title>{t('auth_reset_title')}</Title>
                {sentTo ? (
                  <>
                    <Muted>{t('auth_reset_sub_sent')}</Muted>
                    <Body>
                      {t('auth_sent_to')} {sentTo}
                    </Body>
                    {/* Reset links open in a browser, not here — see the note at the top. */}
                    <Muted>{t('m_reset_on_web')}</Muted>
                  </>
                ) : (
                  <>
                    <Muted>{t('auth_reset_sub')}</Muted>
                    <Input
                      value={email}
                      onChangeText={setEmail}
                      placeholder="you@school.edu"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      iconLeft={<Mail size={18} color={th.color.textMuted} />}
                    />
                    {error ? <Body style={{ color: th.status.danger }}>{t(error)}</Body> : null}
                    <Button block loading={busy} onPress={onForgot}>
                      {t('auth_send_reset')}
                    </Button>
                  </>
                )}
                <Button variant="ghost" block onPress={() => reset('login')}>
                  {t('auth_back_signin')}
                </Button>
              </>
            ) : null}
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

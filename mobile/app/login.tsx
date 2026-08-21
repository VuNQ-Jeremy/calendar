import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import {
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  MessageCircle,
  PawPrint,
  UserRound,
  Users,
} from 'lucide-react-native';
import { router } from 'expo-router';
import { ApiError } from '~/lib/api';
import * as api from '~/lib/endpoints';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Body, Button, Card, IconButton, Input, Muted, Screen, Tabs, Tag, Title } from '~/ui';
import type { OtpCandidate } from '~/lib/types';

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

type Mode = 'login' | 'invite' | 'forgot' | 'otp-phone' | 'otp-code' | 'otp-pick';

export default function Login() {
  const th = useTheme();
  const { t } = useLang();
  const { login, redeemInvite, requestOtp, verifyOtp, pickOtpAccount, expired, status } =
    useAuth();

  // Zalo (phone + code) is the default landing screen, same as the web login page — this
  // audience is Zalo-native.
  const [mode, setMode] = React.useState<Mode>('otp-phone');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPw, setShowPw] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [redeemPasswordless, setRedeemPasswordless] = React.useState(false);
  const [invitePhone, setInvitePhone] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [otpPhone, setOtpPhone] = React.useState('');
  const [otpCode, setOtpCode] = React.useState('');
  const [otpChallengeId, setOtpChallengeId] = React.useState<string | null>(null);
  const [otpPick, setOtpPick] = React.useState<OtpCandidate[]>([]);
  const [resendSeconds, setResendSeconds] = React.useState(0);

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

  // Not `run()`: that helper's 400/401/422 -> "wrong email or password" mapping is right for
  // sign-in but wrong for `no_login_method` (an unreachable phone with no password fallback).
  const onRedeem = async () => {
    if (!name.trim() || (!password && !invitePhone.trim())) {
      setError('auth_add_name_pw');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await redeemInvite({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        // An empty string would fail the API's .email() check — omit the key instead.
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(redeemPasswordless ? { phone: invitePhone.trim() } : { password }),
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === 'no_login_method'
            ? 'auth_no_login_method'
            : err.status === 401 || err.status === 400 || err.status === 422
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
    setRedeemPasswordless(false);
    setInvitePhone('');
  };

  // OTP failures get their own catch: `run`'s status-code mapping is built for password login
  // (401/400/422 -> "wrong email or password"), which is the wrong copy for an OTP challenge.
  const runOtp = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.code === 'invalid_code' ? 'auth_otp_invalid' : err.messageKey);
      } else {
        setError('err_generic_msg');
      }
    } finally {
      setBusy(false);
    }
  };

  const onOtpRequest = () =>
    runOtp(async () => {
      const { challengeId } = await requestOtp(otpPhone.trim());
      setOtpChallengeId(challengeId);
      setOtpCode('');
      setMode('otp-code');
      setResendSeconds(60);
    });

  const onOtpVerify = () =>
    runOtp(async () => {
      if (!otpChallengeId) return;
      const result = await verifyOtp(otpChallengeId, otpCode);
      // A session means verifyOtp already signed the app in — the status effect below navigates
      // away. Only a pick list needs a local state change.
      if (result) {
        setOtpPick(result.pick);
        setMode('otp-pick');
      }
    });

  const onOtpPick = (accountId: string) =>
    runOtp(() => pickOtpAccount(otpChallengeId ?? '', accountId));

  React.useEffect(() => {
    if (resendSeconds <= 0) return;
    const id = setTimeout(() => setResendSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendSeconds]);

  const zaloActive = mode === 'otp-phone' || mode === 'otp-code' || mode === 'otp-pick';
  const showAuthTabs = zaloActive || mode === 'login';

  const pwToggle = (
    <IconButton size="sm" label={t('auth_password')} onPress={() => setShowPw((s) => !s)}>
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
          contentContainerStyle={{
            padding: th.spacing[5],
            gap: th.spacing[5],
            flexGrow: 1,
            justifyContent: 'center',
          }}
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

            {showAuthTabs ? (
              <Tabs
                tabs={[
                  { id: 'zalo', label: t('auth_tab_zalo') },
                  { id: 'email', label: t('auth_tab_email') },
                ]}
                value={zaloActive ? 'zalo' : 'email'}
                onChange={(id) => reset(id === 'zalo' ? 'otp-phone' : 'login')}
              />
            ) : null}

            {mode === 'otp-phone' ? (
              <>
                <Title>{t('auth_welcome')}</Title>
                <Muted>{t('auth_otp_phone_sub')}</Muted>
                <Input
                  value={otpPhone}
                  onChangeText={setOtpPhone}
                  placeholder="0901 234 567"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  onSubmitEditing={onOtpRequest}
                  returnKeyType="go"
                  iconLeft={<MessageCircle size={18} color={th.color.textMuted} />}
                />
                {error ? <Body style={{ color: th.status.danger }}>{t(error)}</Body> : null}
                <Button block loading={busy} disabled={!otpPhone.trim()} onPress={onOtpRequest}>
                  {t('auth_otp_send_code')}
                </Button>
              </>
            ) : null}

            {mode === 'otp-code' ? (
              <>
                <Title>{t('auth_otp_enter_code')}</Title>
                <Muted>{t('auth_otp_code_sent_generic')}</Muted>
                <Input
                  value={otpCode}
                  onChangeText={(v) => setOtpCode(v.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  style={{ fontFamily: th.font.mono, letterSpacing: 4, textAlign: 'center' }}
                  onSubmitEditing={onOtpVerify}
                  returnKeyType="go"
                  iconLeft={<KeyRound size={18} color={th.color.textMuted} />}
                />
                {error ? <Body style={{ color: th.status.danger }}>{t(error)}</Body> : null}
                <Button
                  block
                  loading={busy}
                  disabled={otpCode.length !== 6}
                  onPress={onOtpVerify}
                >
                  {t('auth_otp_verify')}
                </Button>
                <Button
                  variant="ghost"
                  block
                  disabled={resendSeconds > 0 || busy}
                  onPress={onOtpRequest}
                >
                  {resendSeconds > 0
                    ? t('auth_otp_resend_in', { n: resendSeconds })
                    : t('auth_otp_resend')}
                </Button>
                <Button
                  variant="ghost"
                  block
                  onPress={() => {
                    setMode('otp-phone');
                    setOtpCode('');
                    setOtpChallengeId(null);
                  }}
                >
                  {t('auth_otp_change_number')}
                </Button>
              </>
            ) : null}

            {mode === 'otp-pick' ? (
              <>
                <Title>{t('auth_otp_pick_title')}</Title>
                {error ? <Body style={{ color: th.status.danger }}>{t(error)}</Body> : null}
                <View style={{ gap: th.spacing[2] }}>
                  {otpPick.map((c) => (
                    <Pressable
                      key={c.accountId}
                      onPress={() => onOtpPick(c.accountId)}
                      disabled={busy}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: th.spacing[3],
                        backgroundColor: th.color.surfaceRaised,
                        borderWidth: 1,
                        borderColor: th.color.borderSubtle,
                        borderRadius: th.radius.md,
                        padding: th.spacing[3],
                      }}
                    >
                      <Users size={18} color={th.color.textMuted} />
                      <View>
                        <Text
                          style={{
                            fontFamily: th.font.bodyBold,
                            fontSize: th.text.sm.fontSize,
                            color: th.color.textStrong,
                          }}
                        >
                          {c.name}
                        </Text>
                        <Text
                          style={{ fontSize: th.text.sm.fontSize, color: th.color.textMuted }}
                        >
                          {t('role_' + c.kind.toLowerCase())} · {c.schoolName}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </>
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
                {redeemPasswordless ? (
                  <>
                    <Input
                      value={invitePhone}
                      onChangeText={setInvitePhone}
                      placeholder="0901 234 567"
                      keyboardType="phone-pad"
                      autoComplete="tel"
                      iconLeft={<MessageCircle size={18} color={th.color.textMuted} />}
                    />
                    <Muted>{t('auth_redeem_passwordless_hint')}</Muted>
                  </>
                ) : (
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
                )}
                <Button
                  variant="ghost"
                  block
                  onPress={() => setRedeemPasswordless((v) => !v)}
                >
                  {redeemPasswordless ? t('auth_redeem_use_password') : t('auth_redeem_use_zalo')}
                </Button>
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

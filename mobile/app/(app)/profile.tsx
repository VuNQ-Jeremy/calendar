import React from 'react';
import { Pressable, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react-native';
import { ApiError } from '~/lib/api';
import * as api from '~/lib/endpoints';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { invalidateAll } from '~/lib/query';
import { useTheme, TOUCH } from '~/theme';
import { Avatar, Body, Button, Card, Heading, Input, Muted, Screen, Title } from '~/ui';
import type { ColorIdValue } from '~/lib/types';

/**
 * Port of `app/routes/profile.tsx`: name, avatar color, contact fields, change password.
 *
 * `user` level, not staff — students have a profile too, and it is one of their two tabs.
 * The endpoint is PATCH /api/profile, which uses ProfileInput and therefore cannot change a
 * role no matter what the client sends.
 */

/** The six ColorId values, in the same order as PALETTE in src/lib/core.ts. */
const COLORS: ColorIdValue[] = ['violet', 'green', 'blue', 'orange', 'cocoa', 'rose'];

export default function Profile() {
  const th = useTheme();
  const { t } = useLang();
  const { user, account, logout, refresh } = useAuth();

  const [name, setName] = React.useState(user?.name ?? '');
  const [email, setEmail] = React.useState(user?.email ?? '');
  const [phone, setPhone] = React.useState(user?.phone ?? '');
  const [color, setColor] = React.useState<ColorIdValue>((user?.color ?? 'orange') as ColorIdValue);

  const [currentPw, setCurrentPw] = React.useState('');
  const [newPw, setNewPw] = React.useState('');
  const [pwError, setPwError] = React.useState<string | null>(null);
  const [pwDone, setPwDone] = React.useState(false);

  const save = useMutation({
    mutationFn: () =>
      api.profile.update({
        name: name.trim(),
        email: email.trim() ? email.trim() : null,
        // Students have no phone column — sending it would be silently dropped, so don't.
        ...(user?.kind === 'staff' ? { phone: phone.trim() ? phone.trim() : null } : {}),
        color,
      }),
    onSuccess: async () => {
      // The web's clientAction does a coarse invalidate('route:') after this, because the
      // user's name and color appear in nearly every loader. Same reasoning here.
      await invalidateAll();
      await refresh();
    },
  });

  const changePw = useMutation({
    mutationFn: () => api.changePassword({ currentPassword: currentPw, newPassword: newPw }),
    onSuccess: () => {
      setPwDone(true);
      setPwError(null);
      setCurrentPw('');
      setNewPw('');
    },
    onError: (err) => {
      setPwDone(false);
      setPwError(err instanceof ApiError && err.status === 400 ? 'auth_wrong_current_pw' : 'err_generic_msg');
    },
  });

  const onChangePw = () => {
    setPwDone(false);
    if (!currentPw || !newPw) return setPwError('auth_enter_both');
    if (newPw.length < 8) return setPwError('auth_pw_short');
    setPwError(null);
    changePw.mutate();
  };

  if (!user) return null;

  return (
    <Screen scroll>
      <View style={{ gap: th.spacing[1] }}>
        <Title>{t('prof_title')}</Title>
        <Muted>{t('prof_sub')}</Muted>
      </View>

      <Card style={{ gap: th.spacing[4] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[4] }}>
          <Avatar name={name || user.name} color={color} size="xl" />
          <View style={{ flex: 1, gap: th.spacing[1] }}>
            <Heading>{name || user.name}</Heading>
            <Muted>{t('role_' + String(user.role || '').toLowerCase())}</Muted>
            {account ? <Muted>{account.email}</Muted> : null}
          </View>
        </View>

        <Heading>{t('prof_personal')}</Heading>
        <Input label={t('prof_fullname')} value={name} onChangeText={setName} autoComplete="name" />
        <Input
          label={t('prof_email')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        {user.kind === 'staff' ? (
          <Input
            label={t('prof_phone')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
        ) : null}

        <View style={{ gap: th.spacing[2] }}>
          <Body style={{ fontFamily: th.font.bodyBold, fontSize: th.text.sm.fontSize }}>
            {t('prof_avatar_color')}
          </Body>
          <View style={{ flexDirection: 'row', gap: th.spacing[3], flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <Pressable
                key={c}
                accessibilityRole="radio"
                accessibilityState={{ selected: color === c }}
                accessibilityLabel={c}
                onPress={() => setColor(c)}
                // The swatch is 40dp; hitSlop takes the target to 48.
                hitSlop={4}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: th.radius.pill,
                  backgroundColor: th.category[c].base,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 3,
                  borderColor: color === c ? th.color.textStrong : 'transparent',
                }}
              >
                {color === c ? <Check size={20} color="#fff" strokeWidth={3} /> : null}
              </Pressable>
            ))}
          </View>
        </View>

        <Button block loading={save.isPending} onPress={() => save.mutate()}>
          {t('prof_save')}
        </Button>
        {save.isSuccess ? <Muted>{t('prof_saved')}</Muted> : null}
        {save.isError ? (
          <Body style={{ color: th.status.danger }}>
            {t(save.error instanceof ApiError ? save.error.messageKey : 'err_generic_msg')}
          </Body>
        ) : null}
      </Card>

      <Card style={{ gap: th.spacing[4] }}>
        <Heading>{t('prof_change_pw')}</Heading>
        {/* Worth knowing: this signs every OTHER session out, including the browser. That is
            deliberate server behavior (server/services/auth.ts), not a bug to work around. */}
        <Input
          label={t('prof_current_pw')}
          value={currentPw}
          onChangeText={setCurrentPw}
          secureTextEntry
          autoCapitalize="none"
        />
        <Input
          label={t('prof_new_pw')}
          value={newPw}
          onChangeText={setNewPw}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
        />
        {pwError ? <Body style={{ color: th.status.danger }}>{t(pwError)}</Body> : null}
        {pwDone ? <Muted>{t('prof_pw_changed')}</Muted> : null}
        <Button
          variant="secondary"
          block
          loading={changePw.isPending}
          onPress={onChangePw}
        >
          {t('prof_change_pw')}
        </Button>
      </Card>

      <Card style={{ gap: th.spacing[3] }}>
        <Heading>{t('prof_account')}</Heading>
        <Muted>{t('prof_account_sub')}</Muted>
        <Button variant="danger" block onPress={() => void logout()}>
          {t('prof_logout')}
        </Button>
      </Card>

      <View style={{ height: TOUCH }} />
    </Screen>
  );
}

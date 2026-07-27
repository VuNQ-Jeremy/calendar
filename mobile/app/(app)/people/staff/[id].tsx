import React from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { ChipSelect } from '~/components/ChipSelect';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import { useCollectionMutations, useStaff } from '~/lib/staff-data';
import type { ColorIdValue } from '~/lib/types';
import { useTheme } from '~/theme';
import { Button, Card, ColorPicker, IconButton, Input, Muted, Screen } from '~/ui';

const ROLES = ['Teacher', 'Admin', 'Assistant'] as const;
type Role = (typeof ROLES)[number];

/** Staff detail: name, contact, role, colour. `id === 'new'` is the create form. */
export default function StaffDetail() {
  const th = useTheme();
  const { t } = useLang();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const { data: staff } = useStaff();
  const { create, update, remove } = useCollectionMutations(api.staff);
  const existing = staff?.find((u) => u.id === id);

  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [role, setRole] = React.useState<Role>('Teacher');
  const [color, setColor] = React.useState<ColorIdValue>('orange');
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    if (isNew || hydrated || !existing) return;
    setName(existing.name);
    setEmail(existing.email ?? '');
    setPhone(existing.phone ?? '');
    setRole(existing.role);
    setColor(existing.color);
    setHydrated(true);
  }, [existing, isNew, hydrated]);

  const busy = create.isPending || update.isPending;
  /** Deleting the record you are signed in as would orphan the session. */
  const isSelf = !isNew && existing?.id === user?.id;

  const save = () => {
    const input = {
      name: name.trim() || t('stf_default_name'),
      email: email.trim() || null,
      phone: phone.trim() || null,
      role,
      color,
    };
    const opts = { onSuccess: () => router.back() };
    if (isNew) create.mutate(input, opts);
    else update.mutate({ id: id!, patch: input }, opts);
  };

  const confirmDelete = () =>
    Alert.alert(t('staff_remove_q'), t('staff_remove_msg', { name: existing?.name ?? '' }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('remove'),
        style: 'destructive',
        onPress: () => remove.mutate(id!, { onSuccess: () => router.back() }),
      },
    ]);

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader
        title={isNew ? t('stf_add') : t('stf_edit')}
        subtitle={isNew ? undefined : existing?.name}
        right={
          isNew || isSelf ? undefined : (
            <IconButton label={t('delete')} onPress={confirmDelete}>
              <Trash2 size={20} color={th.status.danger} />
            </IconButton>
          )
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={{ gap: th.spacing[4] }}>
          <Input label={t('prof_fullname')} value={name} onChangeText={setName} autoFocus={isNew} />
          <Input
            label={t('prof_email')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Input
            label={t('prof_phone')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <ChipSelect
            label={t('stf_role')}
            value={role}
            onChange={(v) => setRole(v as Role)}
            options={ROLES.map((r) => ({ value: r, label: t(`role_${r.toLowerCase()}`) }))}
          />
          <ColorPicker label={t('prof_avatar_color')} value={color} onChange={setColor} />
        </Card>

        {isSelf ? <Muted>{t('stf_self_note')}</Muted> : null}

        <Button block loading={busy} onPress={save}>
          {t('save')}
        </Button>
        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}

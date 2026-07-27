import React from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { ChipSelect } from '~/components/ChipSelect';
import { ScreenHeader } from '~/components/ScreenHeader';
import { TokenSearch } from '~/components/TokenSearch';
import { useLang } from '~/lib/i18n';
import * as api from '~/lib/endpoints';
import { useCollectionMutations, useParents, useStudents } from '~/lib/staff-data';
import type { ColorIdValue } from '~/lib/types';
import { useTheme } from '~/theme';
import { Button, Card, ColorPicker, IconButton, Input, Muted, Screen } from '~/ui';

const RELATIONS = ['Mother', 'Father', 'Guardian', 'Other'] as const;

/**
 * Parent detail: contact record and linked students.
 *
 * A parent is a *record*, not a user. `userFromToken` returns null for an account with a
 * `parentId` (`server/services/auth.ts:118`), so there is no parent app to build and no invite
 * worth sending — see the note in `components/InvitesPanel.tsx`. What is useful, and what this
 * screen does, is keeping the phone number of whoever picks the child up.
 */
export default function ParentDetail() {
  const th = useTheme();
  const { t } = useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const { data: parents } = useParents();
  const { data: students } = useStudents();
  const { create, update, remove } = useCollectionMutations(api.parents);
  const existing = parents?.find((p) => p.id === id);

  const [name, setName] = React.useState('');
  const [relation, setRelation] = React.useState<string>('Guardian');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [color, setColor] = React.useState<ColorIdValue>('green');
  const [studentIds, setStudentIds] = React.useState<string[]>([]);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    if (isNew || hydrated || !existing) return;
    setName(existing.name);
    setRelation(existing.relation ?? 'Guardian');
    setEmail(existing.email ?? '');
    setPhone(existing.phone ?? '');
    setColor(existing.color);
    setStudentIds(existing.studentIds ?? []);
    setHydrated(true);
  }, [existing, isNew, hydrated]);

  const busy = create.isPending || update.isPending;

  const save = () => {
    const input = {
      name: name.trim() || t('par_default_name'),
      relation,
      email: email.trim() || null,
      phone: phone.trim() || null,
      color,
      studentIds,
    };
    const opts = { onSuccess: () => router.back() };
    if (isNew) create.mutate(input, opts);
    else update.mutate({ id: id!, patch: input }, opts);
  };

  const confirmDelete = () =>
    Alert.alert(t('parent_remove_q'), t('parent_remove_msg', { name: existing?.name ?? '' }), [
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
        title={isNew ? t('par_add') : t('par_edit')}
        subtitle={isNew ? undefined : existing?.name}
        right={
          isNew ? undefined : (
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
          <ChipSelect
            label={t('par_relation')}
            value={relation}
            onChange={setRelation}
            options={RELATIONS.map((r) => ({ value: r, label: t(`rel_${r.toLowerCase()}`) }))}
          />
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
          <ColorPicker label={t('prof_avatar_color')} value={color} onChange={setColor} />
        </Card>

        <Card style={{ gap: th.spacing[3] }}>
          <TokenSearch
            label={t('par_children')}
            items={students ?? []}
            selectedIds={studentIds}
            onToggle={(sid) =>
              setStudentIds((prev) =>
                prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid],
              )
            }
            placeholder={t('par_search_students')}
            emptyHint={t('par_all_linked')}
          />
          <Muted>{t('par_no_login_note')}</Muted>
        </Card>

        <Button block loading={busy} onPress={save}>
          {t('save')}
        </Button>
        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}

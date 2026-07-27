import React from 'react';
import { ActivityIndicator, Alert, Share, ScrollView, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, KeyRound, Share2, Sparkles, Trash2 } from 'lucide-react-native';
import { makeInviteCode } from '@mochi/shared/logic/invite-code';
import { ChipSelect } from '~/components/ChipSelect';
import { matches } from '~/components/SearchField';
import * as api from '~/lib/endpoints';
import { useLang } from '~/lib/i18n';
import { iso, todayDate } from '~/lib/cal';
import { useClasses, useInvalidateStaff, useInvites } from '~/lib/staff-data';
import { useTheme } from '~/theme';
import { Badge, Button, Card, Heading, IconButton, Input, Mono, Muted } from '~/ui';

/**
 * Invites: list, generate, revoke.
 *
 * The one screen where the phone is genuinely better than the web. The web copies a code with
 * `navigator.clipboard` (`src/screens-manage/people.tsx:859,964`) and then the teacher has to get
 * it to the student somehow — reading it out, or pasting it into whatever is open. Here, the
 * share sheet hands it straight to Zalo, Messenger or SMS, which is how these codes actually
 * travel.
 *
 * **Parent invites are not offered.** A Parent invite creates an `accounts` row with a `parentId`,
 * and `userFromToken` returns `null` for exactly that case (`server/services/auth.ts:118`,
 * "parent accounts remain unsupported"). The code redeems, the password is set, and the person
 * can never sign in. Offering it would be offering a broken thing. Parent *records* are fully
 * manageable on the Parents tab; only the login is missing, and that is a server capability, not
 * a mobile one. Existing Parent invites created on the web still list and revoke here.
 */

const INVITE_ROLES = ['Student', 'Staff'] as const;

export function InvitesPanel({ query }: { query: string }) {
  const th = useTheme();
  const { t } = useLang();
  const invalidate = useInvalidateStaff();

  const { data: invites, isLoading } = useInvites();
  const { data: classes } = useClasses();

  const [role, setRole] = React.useState<string>('Student');
  const [name, setName] = React.useState('');
  const [classId, setClassId] = React.useState('');
  const [generated, setGenerated] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  const create = useMutation({
    mutationFn: (code: string) =>
      api.invites.create({
        code,
        role: role as 'Student' | 'Staff' | 'Parent',
        name: name.trim() || null,
        classId: classId || null,
        createdAt: iso(todayDate()),
        used: false,
      }),
    onSuccess: (row) => {
      setGenerated(row.code);
      setName('');
      void invalidate();
    },
    onError: () => Alert.alert(t('err_generic_title'), t('err_generic_msg')),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.invites.remove(id),
    onSuccess: () => void invalidate(),
  });

  const copy = async (code: string) => {
    await Clipboard.setStringAsync(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  const share = (code: string) => {
    // `Share` (React Native core), not expo-sharing: expo-sharing shares FILES, this shares text.
    void Share.share({ message: t('invm_share_msg', { code }) });
  };

  const classOf = (id: string | null | undefined) => classes?.find((c) => c.id === id)?.name;
  const roleLabel = (r: string) => t(`role_${String(r).toLowerCase()}`);

  const shown = (invites ?? []).filter((i) => matches(query, i.code, i.name, i.role));

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: th.spacing[4],
        paddingBottom: th.spacing[10],
        gap: th.spacing[4],
      }}
      keyboardShouldPersistTaps="handled"
    >
      {/* ---- Generate ---- */}
      <Card style={{ gap: th.spacing[4] }}>
        <Heading>{t('invm_title')}</Heading>

        {generated ? (
          <View style={{ alignItems: 'center', gap: th.spacing[3] }}>
            <Muted style={{ textAlign: 'center' }}>
              {t('invm_share', { role: roleLabel(role).toLowerCase() })}
            </Muted>
            <View
              style={{
                alignSelf: 'stretch',
                alignItems: 'center',
                paddingVertical: th.spacing[5],
                borderRadius: th.radius.lg,
                backgroundColor: th.color.brandSoft,
              }}
            >
              <Mono
                selectable
                style={{
                  fontSize: th.text.xxl.fontSize,
                  letterSpacing: 4,
                  color: th.color.brandSoftInk,
                }}
              >
                {generated}
              </Mono>
            </View>
            <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
              <Button
                variant="soft"
                onPress={() => void copy(generated)}
                iconLeft={
                  copied === generated ? (
                    <Check size={16} color={th.color.brandSoftInk} />
                  ) : (
                    <Copy size={16} color={th.color.brandSoftInk} />
                  )
                }
              >
                {copied === generated ? t('copied') : t('invm_copy_clip')}
              </Button>
              <Button
                onPress={() => share(generated)}
                iconLeft={<Share2 size={16} color={th.color.textOnBrand} />}
              >
                {t('invm_share_btn')}
              </Button>
            </View>
            <Button variant="ghost" onPress={() => setGenerated(null)}>
              {t('done')}
            </Button>
          </View>
        ) : (
          <>
            <ChipSelect
              label={t('invm_invite_as')}
              value={role}
              onChange={setRole}
              options={INVITE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
            />
            <Muted>{t('invm_no_parent_note')}</Muted>

            <Input
              label={t('invm_name_opt')}
              value={name}
              onChangeText={setName}
              placeholder={t('invm_name_ph', { role: roleLabel(role) })}
            />

            <ChipSelect
              label={t('invm_link_class')}
              value={classId}
              onChange={setClassId}
              options={[
                { value: '', label: t('no_class') },
                ...(classes ?? []).map((c) => ({ value: c.id, label: c.name })),
              ]}
            />

            <Button
              block
              loading={create.isPending}
              onPress={() => create.mutate(makeInviteCode())}
              iconLeft={<Sparkles size={16} color={th.color.textOnBrand} />}
            >
              {t('invm_generate')}
            </Button>
          </>
        )}
      </Card>

      {/* ---- Existing codes ---- */}
      {isLoading && !invites ? <ActivityIndicator color={th.color.brand} /> : null}

      {invites && !shown.length ? (
        <Card>
          <Heading>{query.trim() ? t('ppl_no_match', { q: query }) : t('inv_none_title')}</Heading>
          {!query.trim() ? <Muted>{t('inv_none_sub')}</Muted> : null}
        </Card>
      ) : null}

      {shown.map((inv) => (
        <Card key={inv.id} flat style={{ padding: th.spacing[4], gap: th.spacing[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[3] }}>
            <KeyRound size={20} color={inv.used ? th.color.textDisabled : th.color.brand} />
            <Mono
              selectable
              style={{
                flex: 1,
                fontSize: th.text.lg.fontSize,
                letterSpacing: 2,
                color: inv.used ? th.color.textDisabled : th.color.textStrong,
                textDecorationLine: inv.used ? 'line-through' : 'none',
              }}
            >
              {inv.code}
            </Mono>
            <Badge color={inv.role === 'Parent' ? 'violet' : 'blue'}>{roleLabel(inv.role)}</Badge>
            {inv.used ? <Badge>{t('inv_used')}</Badge> : null}
          </View>

          <Muted numberOfLines={1}>
            {[inv.name || t('inv_unassigned'), classOf(inv.classId)].filter(Boolean).join(' · ')}
          </Muted>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
            {!inv.used ? (
              <>
                <Button
                  variant="soft"
                  onPress={() => void copy(inv.code)}
                  iconLeft={
                    copied === inv.code ? (
                      <Check size={15} color={th.color.brandSoftInk} />
                    ) : (
                      <Copy size={15} color={th.color.brandSoftInk} />
                    )
                  }
                >
                  {copied === inv.code ? t('copied') : t('copy')}
                </Button>
                <Button
                  variant="secondary"
                  onPress={() => share(inv.code)}
                  iconLeft={<Share2 size={15} color={th.color.textStrong} />}
                >
                  {t('invm_share_btn')}
                </Button>
              </>
            ) : null}
            <View style={{ flex: 1 }} />
            <IconButton
              label={t('delete')}
              onPress={() =>
                Alert.alert(t('inv_revoke_q'), inv.code, [
                  { text: t('cancel'), style: 'cancel' },
                  {
                    text: t('remove'),
                    style: 'destructive',
                    onPress: () => revoke.mutate(inv.id),
                  },
                ])
              }
            >
              <Trash2 size={18} color={th.status.danger} />
            </IconButton>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

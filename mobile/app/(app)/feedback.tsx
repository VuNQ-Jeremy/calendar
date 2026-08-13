import React from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { Check, MessageSquare, Plus, RotateCcw, Trash2 } from 'lucide-react-native';
import { ChipSelect } from '~/components/ChipSelect';
import { ScreenHeader } from '~/components/ScreenHeader';
import { useAuth } from '~/lib/auth';
import { useLang, locale } from '~/lib/i18n';
import { fmtStamp } from '~/lib/cal';
import * as api from '~/lib/endpoints';
import { useFeedback, useInvalidateStaff } from '~/lib/staff-data';
import type { FeedbackRow } from '~/lib/types';
import { versionStamp } from '~/lib/version';
import { useTheme } from '~/theme';
import {
  Badge,
  Body,
  Button,
  Card,
  Heading,
  IconButton,
  Input,
  Mono,
  Muted,
  Screen,
  Tabs,
  Tag,
} from '~/ui';

/**
 * Task 5.5 — feedback: the inbox and the submit form.
 *
 * On the web, submitting lives in a modal in the `_app.tsx` shell (reachable from every page) and
 * the inbox is its own route. On a phone there is no persistent shell to hang a modal off, so
 * both live here: `?compose=1` opens the form, which is what the More screen's "Send feedback"
 * row and the version stamp both link to.
 *
 * Every submission carries `versionStamp()` in `appVersion`. With OTA updates the installed APK
 * and the running JS bundle diverge the moment an update ships, so a report without the bundle id
 * is a report you cannot reproduce.
 */

const CATEGORIES = ['idea', 'bug', 'praise', 'other'] as const;
const STATUSES = ['new', 'reviewed', 'done'] as const;

const CAT_COLOR: Record<string, string> = {
  idea: 'blue',
  bug: 'rose',
  praise: 'green',
  other: 'cocoa',
};
const STATUS_BADGE: Record<string, string> = { new: 'brand', reviewed: 'blue', done: 'success' };

export default function Feedback() {
  const th = useTheme();
  const { t, lang } = useLang();
  const { user } = useAuth();
  const invalidate = useInvalidateStaff();
  const { compose } = useLocalSearchParams<{ compose?: string }>();

  const { data: list, isLoading, isRefetching } = useFeedback();

  const [filter, setFilter] = React.useState('all');
  const [open, setOpen] = React.useState(compose === '1');
  const [message, setMessage] = React.useState('');
  const [category, setCategory] = React.useState<string>('idea');
  const [author, setAuthor] = React.useState(user?.name ?? '');
  const [editing, setEditing] = React.useState<FeedbackRow | null>(null);

  const rows = list ?? [];
  const shown = rows.filter((f) => (filter === 'all' ? true : f.status === filter));
  const count = (s: string) => rows.filter((f) => f.status === s).length;

  const reset = () => {
    setOpen(false);
    setEditing(null);
    setMessage('');
    setCategory('idea');
    setAuthor(user?.name ?? '');
  };

  const submit = useMutation({
    mutationFn: () => {
      const base = {
        message: message.trim(),
        category: category as (typeof CATEGORIES)[number],
        author: author.trim() || null,
      };
      return editing
        ? api.feedback.update(editing.id, base)
        : api.feedback.create({
            ...base,
            // No createdAt: the server stamps it, with a time of day the inbox can show.
            status: 'new' as const,
            appVersion: versionStamp(),
          });
    },
    onSuccess: () => {
      reset();
      void invalidate();
    },
    onError: () => Alert.alert(t('err_generic_title'), t('err_generic_msg')),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: (typeof STATUSES)[number] }) =>
      api.feedback.update(id, { status }),
    onSuccess: () => void invalidate(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.feedback.remove(id),
    onSuccess: () => void invalidate(),
  });

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('fb_title')} subtitle={t('fb_sub')} />

      <ScrollView
        contentContainerStyle={{ padding: th.spacing[4], gap: th.spacing[4] }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void invalidate()}
            tintColor={th.color.brand}
          />
        }
      >
        {open ? (
          <Card style={{ gap: th.spacing[4] }}>
            <Heading>{editing ? t('fb_edit') : t('fb_share')}</Heading>

            <ChipSelect
              label={t('fb_type')}
              value={category}
              onChange={setCategory}
              options={CATEGORIES.map((c) => ({ value: c, label: t(`cat_${c}`) }))}
            />
            <Input
              label={t('fb_message')}
              value={message}
              onChangeText={setMessage}
              placeholder={t('fb_message_ph')}
              multiline
              autoFocus
              style={{ height: 110, textAlignVertical: 'top', paddingTop: th.spacing[2] }}
            />
            <Input
              label={t('fb_from')}
              value={author}
              onChangeText={setAuthor}
              placeholder={t('auth_your_name')}
            />

            {/* Shown, not hidden: the reporter should be able to read out the build they are on. */}
            <View style={{ gap: th.spacing[1] }}>
              <Muted>{t('fb_build')}</Muted>
              <Mono selectable>{versionStamp()}</Mono>
            </View>

            <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
              <Button variant="secondary" style={{ flex: 1 }} onPress={reset}>
                {t('cancel')}
              </Button>
              <Button
                style={{ flex: 1 }}
                disabled={!message.trim()}
                loading={submit.isPending}
                onPress={() => submit.mutate()}
              >
                {editing ? t('save') : t('fb_send')}
              </Button>
            </View>
          </Card>
        ) : (
          <Button
            block
            iconLeft={<Plus size={18} color={th.color.textOnBrand} />}
            onPress={() => setOpen(true)}
          >
            {t('fb_log')}
          </Button>
        )}

        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: 'all', label: t('fb_tab_all', { n: rows.length }) },
            { id: 'new', label: t('fb_tab_new', { n: count('new') }) },
            { id: 'reviewed', label: t('fb_tab_reviewed', { n: count('reviewed') }) },
            { id: 'done', label: t('fb_tab_done', { n: count('done') }) },
          ]}
        />

        {isLoading && !list ? <ActivityIndicator color={th.color.brand} /> : null}

        {list && !shown.length ? (
          <Card>
            <Heading>{t('fb_none_title')}</Heading>
            <Muted>{t('fb_none_sub')}</Muted>
          </Card>
        ) : null}

        {shown.map((f) => (
          <Card key={f.id} flat style={{ padding: th.spacing[4], gap: th.spacing[3] }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: th.spacing[3] }}>
              <MessageSquare size={18} color={th.color.textMuted} />
              <Body style={{ flex: 1, fontFamily: th.font.bodyMedium }}>{f.message}</Body>
              <Badge color={STATUS_BADGE[f.status]}>{t(`st_${f.status}`)}</Badge>
            </View>

            <View style={{ flexDirection: 'row', gap: th.spacing[2], flexWrap: 'wrap' }}>
              <Tag color={CAT_COLOR[f.category]}>{t(`cat_${f.category}`)}</Tag>
              {f.author ? <Muted>{f.author}</Muted> : null}
              {f.createdAt ? <Muted>{fmtStamp(f.createdAt, locale(lang))}</Muted> : null}
            </View>

            {f.appVersion ? <Mono numberOfLines={1}>{f.appVersion}</Mono> : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}>
              <Button
                variant="soft"
                onPress={() =>
                  setStatus.mutate({ id: f.id, status: f.status === 'done' ? 'new' : 'done' })
                }
                iconLeft={
                  f.status === 'done' ? (
                    <RotateCcw size={15} color={th.color.brandSoftInk} />
                  ) : (
                    <Check size={15} color={th.color.brandSoftInk} />
                  )
                }
              >
                {f.status === 'done' ? t('fb_reopen') : t('fb_resolve')}
              </Button>
              <View style={{ flex: 1 }} />
              <IconButton
                label={t('edit')}
                onPress={() => {
                  setEditing(f);
                  setMessage(f.message);
                  setCategory(f.category);
                  setAuthor(f.author ?? '');
                  setOpen(true);
                }}
              >
                <Body style={{ fontSize: th.text.xs.fontSize, color: th.color.textMuted }}>
                  {t('edit')}
                </Body>
              </IconButton>
              <IconButton
                label={t('delete')}
                onPress={() =>
                  Alert.alert(t('delete'), f.message.slice(0, 80), [
                    { text: t('cancel'), style: 'cancel' },
                    {
                      text: t('delete'),
                      style: 'destructive',
                      onPress: () => remove.mutate(f.id),
                    },
                  ])
                }
              >
                <Trash2 size={18} color={th.status.danger} />
              </IconButton>
            </View>
          </Card>
        ))}

        <View style={{ height: th.spacing[8] }} />
      </ScrollView>
    </Screen>
  );
}

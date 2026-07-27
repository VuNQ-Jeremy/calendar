import React from 'react';
import { ScrollView, View } from 'react-native';
import { useTheme } from '~/theme';
import { useLang } from '~/lib/i18n';
import { Body, Button, Input } from '~/ui';
import { ColorPicker } from '~/ui/ColorPicker';
import type { ColorIdValue } from '~/lib/types';

export interface TopicDraft {
  name: string;
  description: string;
  color: ColorIdValue;
}

/**
 * Topic create/edit form, shared by `flashcards/new` and `flashcards/[slug]/edit`.
 *
 * The web shows this in a modal; on a phone it is a pushed screen — a modal that covers a 360dp
 * viewport is just a screen with extra steps, and the keyboard would fight it.
 */
export function TopicForm({
  initial,
  busy,
  error,
  onSubmit,
}: {
  initial: TopicDraft;
  busy?: boolean;
  error?: string | null;
  onSubmit: (draft: TopicDraft) => void;
}) {
  const th = useTheme();
  const { t } = useLang();
  const [draft, setDraft] = React.useState<TopicDraft>(initial);

  const set = <K extends keyof TopicDraft>(k: K, v: TopicDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: th.spacing[5], gap: th.spacing[4] }}
    >
      <Input
        label={t('fc_topic_name')}
        value={draft.name}
        onChangeText={(v) => set('name', v)}
        autoFocus
      />
      <Input
        label={t('fc_description')}
        value={draft.description}
        onChangeText={(v) => set('description', v)}
        multiline
        numberOfLines={3}
        style={{ height: 88, textAlignVertical: 'top', paddingTop: 10 }}
      />
      <ColorPicker label={t('color')} value={draft.color} onChange={(v) => set('color', v)} />

      {error ? <Body style={{ color: th.status.danger }}>{t(error)}</Body> : null}

      <View style={{ gap: th.spacing[3], marginTop: th.spacing[2] }}>
        <Button
          block
          loading={busy}
          // An empty name would 422 server-side; disabling is the cheaper feedback.
          disabled={!draft.name.trim()}
          onPress={() => onSubmit({ ...draft, name: draft.name.trim() })}
        >
          {t('save')}
        </Button>
      </View>
    </ScrollView>
  );
}

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { ChipSelect } from '~/components/ChipSelect';
import { useLang } from '~/lib/i18n';
import { useEventPreview, useSavePreview } from '~/lib/staff-data';
import { useTheme } from '~/theme';
import { Body, Button, Card, Input, Muted } from '~/ui';

/**
 * "Buổi sau" — what this ONE occurrence will cover, and which vocabulary to revise.
 *
 * Unlike the register beside it, this saves on a button press, not on every keystroke. The
 * register autosaves because a teacher marking it walks away mid-list; this is prose a parent may
 * end up reading, and autosaving prose publishes half-written sentences.
 *
 * The tests being checked are not editable here. The server works those out from the class's
 * published tests at read time, so they cannot fall out of step with the tests themselves.
 */
export function PreviewEditor({ eventId, date }: { eventId: string; date: string }) {
  const th = useTheme();
  const { t } = useLang();

  const { data, isLoading } = useEventPreview(eventId, date);
  const save = useSavePreview(eventId, date);

  const [focusText, setFocusText] = React.useState('');
  const [vocabTopicId, setVocabTopicId] = React.useState('');

  /**
   * Seed from the server ONCE per (event, date) — the same guard the register uses. A refetch
   * must not overwrite what the teacher is in the middle of typing, and does not need to: a
   * successful save writes its own reply into this query's cache.
   */
  const seededFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!data) return;
    const key = `${eventId}:${date}`;
    if (seededFor.current === key) return;
    seededFor.current = key;
    setFocusText(data.preview?.focusText ?? '');
    setVocabTopicId(data.preview?.vocabTopicId ?? '');
  }, [data, eventId, date]);

  if (isLoading && !data) {
    return <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />;
  }

  const topicOptions = [
    { value: '', label: t('prev_vocab_none') },
    ...(data?.topics ?? []).map((x) => ({ value: x.id, label: x.name })),
  ];

  return (
    <View style={{ gap: th.spacing[4] }}>
      <Input
        label={t('prev_focus_label')}
        placeholder={t('prev_focus_ph')}
        value={focusText}
        onChangeText={setFocusText}
        multiline
        numberOfLines={5}
        style={{ height: 120, textAlignVertical: 'top', paddingTop: th.spacing[3] }}
      />

      <ChipSelect
        label={t('prev_vocab_label')}
        value={vocabTopicId}
        options={topicOptions}
        onChange={setVocabTopicId}
      />

      <Card flat style={{ padding: th.spacing[4], gap: th.spacing[2] }}>
        <Body style={{ fontFamily: th.font.bodyBold }}>{t('prev_tests_label')}</Body>
        <Muted>{t('prev_tests_auto')}</Muted>
      </Card>

      <Button
        variant="primary"
        block
        loading={save.isPending}
        onPress={() => save.mutate({ focusText, vocabTopicId: vocabTopicId || null })}
      >
        {t('save')}
      </Button>

      {save.isError ? (
        <Muted style={{ color: th.status.danger }}>{t('att_save_failed')}</Muted>
      ) : save.isSuccess ? (
        <Muted style={{ color: th.status.success }}>{t('prev_saved')}</Muted>
      ) : null}
    </View>
  );
}

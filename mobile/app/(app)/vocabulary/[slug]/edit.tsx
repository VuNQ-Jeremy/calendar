import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '~/lib/api';
import * as api from '~/lib/endpoints';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useInvalidateFlashcards, useTopic } from '~/lib/use-topics';
import { useTheme } from '~/theme';
import { Screen } from '~/ui';
import { ScreenHeader } from '~/components/ScreenHeader';
import { TopicForm } from '~/components/TopicForm';
import type { TopicDraft } from '~/components/TopicForm';
import type { ColorIdValue } from '~/lib/types';

/** Edit a topic's name, description and colour. Staff only. */
export default function EditTopic() {
  const th = useTheme();
  const { t } = useLang();
  const { user } = useAuth();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { bundle, loading } = useTopic(slug);
  const invalidate = useInvalidateFlashcards();

  const update = useMutation({
    mutationFn: (draft: TopicDraft) =>
      api.flashcards.updateTopic(bundle!.topic.id, {
        name: draft.name,
        description: draft.description || null,
        color: draft.color,
      }),
    onSuccess: async () => {
      await invalidate();
      router.back();
    },
  });

  if (user?.kind !== 'staff') {
    router.replace('/vocabulary');
    return null;
  }

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('fc_edit_topic')} subtitle={bundle?.topic.name} />
      {!bundle ? (
        loading ? (
          <ActivityIndicator color={th.color.brand} style={{ marginTop: th.spacing[8] }} />
        ) : null
      ) : (
        <TopicForm
          initial={{
            name: bundle.topic.name,
            description: bundle.topic.description ?? '',
            color: (bundle.topic.color as ColorIdValue) ?? 'violet',
          }}
          busy={update.isPending}
          error={
            update.isError
              ? update.error instanceof ApiError
                ? update.error.messageKey
                : 'err_generic_msg'
              : null
          }
          onSubmit={(draft) => update.mutate(draft)}
        />
      )}
    </Screen>
  );
}

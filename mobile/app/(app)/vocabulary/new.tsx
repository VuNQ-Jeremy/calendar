import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '~/lib/api';
import * as api from '~/lib/endpoints';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useInvalidateFlashcards } from '~/lib/use-topics';
import { Screen } from '~/ui';
import { ScreenHeader } from '~/components/ScreenHeader';
import { TopicForm } from '~/components/TopicForm';
import type { TopicDraft } from '~/components/TopicForm';

/**
 * Create a topic. **Staff only** — the client gate below is cosmetic; the API returns 403 to a
 * student token regardless, which is the actual enforcement.
 */
export default function NewTopic() {
  const { t } = useLang();
  const { user } = useAuth();
  const invalidate = useInvalidateFlashcards();

  const create = useMutation({
    mutationFn: (draft: TopicDraft) =>
      api.flashcards.createTopic({
        name: draft.name,
        description: draft.description || null,
        color: draft.color,
      }),
    onSuccess: async () => {
      await invalidate();
      router.back();
    },
  });

  // A student who deep-links here sees the list, not an error.
  if (user?.kind !== 'staff') {
    router.replace('/vocabulary');
    return null;
  }

  return (
    <Screen edges={{ top: true }}>
      <ScreenHeader title={t('fc_new_topic')} />
      <TopicForm
        initial={{ name: '', description: '', color: 'violet' }}
        busy={create.isPending}
        error={
          create.isError
            ? create.error instanceof ApiError
              ? create.error.messageKey
              : 'err_generic_msg'
            : null
        }
        onSubmit={(draft) => create.mutate(draft)}
      />
    </Screen>
  );
}

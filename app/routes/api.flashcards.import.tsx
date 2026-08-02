import { fail, parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/flashcards';
import { FlashcardImportInput } from '../../shared/schemas';

/** Bulk paste. Capped at 200 words per call by FlashcardImportInput. */
export const action = withAuth(
  'staff',
  async ({ request, db }) => {
    const topicId = new URL(request.url).searchParams.get('topicId');
    if (!topicId) throw fail('missing_topic_id', 400);
    const { words } = await parseBody(request, FlashcardImportInput);
    await svc.importWords(db, topicId, words);
    return { imported: words.length };
  },
  { live: 'flashcards' },
);

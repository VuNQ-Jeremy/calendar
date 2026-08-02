import { parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/flashcards';
import { FlashcardTopicWithWordsInput } from '../../shared/schemas';

/**
 * Create a topic and its first words in one call — the save step of AI generation.
 *
 * Deliberately NOT under `/api/flashcards/topics`: that path is `:id?`-suffixed, so a literal
 * `topics/generate-topic` segment would be parsed as an id. Generation itself happens earlier via
 * `/generate-vocab`; by the time this is called the words are already reviewed and confirmed.
 */
export const action = withAuth(
  'staff',
  async ({ request, db }) => {
    const { words, ...topic } = await parseBody(request, FlashcardTopicWithWordsInput);
    return svc.createTopicWithWords(db, topic, words);
  },
  { live: 'flashcards' },
);

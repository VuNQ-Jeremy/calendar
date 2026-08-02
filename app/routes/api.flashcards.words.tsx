import { fail, parseBody, parsePatchBody, requireId, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/flashcards';
import { FlashcardWordInput } from '../../shared/schemas';

/** Word CRUD is staff-only. Students read words via /api/flashcards/topics/:slug. */
export const loader = withAuth('staff', async ({ request, db }) => {
  const topicId = new URL(request.url).searchParams.get('topicId');
  if (!topicId) throw fail('missing_topic_id', 400);
  return svc.listWords(db, topicId);
});

export const action = withAuth(
  'staff',
  async (ctx) => {
    const { request, db } = ctx;

    // createWord/updateWord return void, so reply with the topic's refreshed word list —
    // the client needs the generated ids.
    if (request.method === 'POST') {
      const topicId = new URL(request.url).searchParams.get('topicId');
      if (!topicId) throw fail('missing_topic_id', 400);
      const input = await parseBody(request, FlashcardWordInput);
      await svc.createWord(db, topicId, input);
      return svc.listWords(db, topicId);
    }

    if (request.method === 'PATCH') {
      const patch = await parsePatchBody(request, FlashcardWordInput);
      await svc.updateWord(db, requireId(ctx), patch);
      return { ok: true };
    }

    if (request.method === 'DELETE') {
      const id = requireId(ctx);
      await svc.removeWord(db, id);
      return { id };
    }

    throw fail('method_not_allowed', 405);
  },
  { live: 'flashcards' },
);

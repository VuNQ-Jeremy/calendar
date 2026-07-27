import { fail, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/flashcards';

/**
 * One topic plus its words — what a study session needs, and what the mobile app caches for
 * offline use. Readable by students.
 */
export const loader = withAuth('user', async ({ params, db, user }) => {
  const slug = params.slug;
  if (!slug) throw fail('missing_slug', 400);

  const topic = await svc.getTopicBySlug(db, slug);
  if (!topic) throw fail('not_found', 404);

  const words = await svc.listWords(db, topic.id);
  // Mastery drives adaptive ordering and is per-student; staff plays don't produce it.
  const mastery =
    user.kind === 'student' ? await svc.listMasteryForStudent(db, user.user.id, topic.id) : [];

  return { topic, words, mastery };
});

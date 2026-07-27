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

  const [words, results, mastery] = await Promise.all([
    svc.listWords(db, topic.id),
    // `user` level, deliberately: the web's flashcards.$slug loader hands the results and the
    // leaderboard to students too — "the leaderboard is a student competition"
    // (src/flashcards/topic.tsx). Withholding them here would give the mobile app a
    // different, poorer feature than the browser for exactly the people who use it most.
    svc.listTopicResults(db, topic.id),
    // Mastery drives adaptive ordering and is per-student; staff plays don't produce it.
    user.kind === 'student'
      ? svc.listMasteryForStudent(db, user.user.id, topic.id)
      : Promise.resolve([]),
  ]);

  return { topic, words, results, mastery };
});

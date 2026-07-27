import { withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/flashcards';

/**
 * Per-student flashcard stats for the People screen (staff), or the results list for one
 * topic when `?topicId=` is given.
 */
export const loader = withAuth('staff', async ({ request, db }) => {
  const topicId = new URL(request.url).searchParams.get('topicId');
  if (topicId) return svc.listTopicResults(db, topicId);
  return svc.studentFlashcardStats(db);
});

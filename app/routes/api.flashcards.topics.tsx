import { crud } from '../../server/api/handler';
import * as svc from '../../server/services/flashcards';
import { FlashcardTopicInput } from '../../shared/schemas';

/**
 * GET is `user`, not `staff` — students play the games, and /flashcards is one of only two
 * routes they can reach. Writes stay staff-only.
 */
// createTopic/updateTopic return void, so each mutation replies with the refreshed list —
// the client needs the generated id and slug, and this saves it a round trip.
const routes = crud({
  level: 'staff',
  readLevel: 'user',
  schema: FlashcardTopicInput,
  list: ({ db }) => svc.listTopics(db),
  create: async (input, { db }) => {
    await svc.createTopic(db, input);
    return svc.listTopics(db);
  },
  update: async (id, patch, { db }) => {
    await svc.updateTopic(db, id, patch);
    return svc.listTopics(db);
  },
  remove: async (id, { db }) => {
    await svc.removeTopic(db, id);
    return svc.listTopics(db);
  },
});

export const loader = routes.loader;
export const action = routes.action;

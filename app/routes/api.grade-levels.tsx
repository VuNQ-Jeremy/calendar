import { crud } from '../../server/api/handler';
import * as svc from '../../server/services/grade-levels';
import { GradeLevelInput } from '../../shared/schemas';

/**
 * Khối is GLOBAL since migration 0049: one shared list for the whole deployment.
 *
 * READING it is every staff member's business — /tests, /questions, /classes and /rankings all key
 * off it. WRITING it is a platform power, because renaming Khối 6 renames it at every school, on
 * every existing class, test and question. Hence the split levels.
 */
const routes = crud({
  level: 'platform',
  readLevel: 'staff',
  schema: GradeLevelInput,
  live: 'config',
  list: ({ db }) => svc.list(db.raw),
  create: (input, { db }) => svc.create(db.raw, input),
  update: (id, patch, { db }) => svc.update(db.raw, id, patch),
  remove: (id, { db }) => svc.remove(db.raw, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

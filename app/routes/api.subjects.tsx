import { crud } from '../../server/api/handler';
import * as svc from '../../server/services/subjects';
import { SubjectInput } from '../../shared/schemas';

/**
 * Read is what the phone needs — the class editor picks a subject from this list. Writes are
 * admin-only, mirroring /config, exactly like /api/grade-levels.
 */
const routes = crud({
  level: 'admin',
  readLevel: 'staff',
  schema: SubjectInput,
  live: 'config',
  list: ({ db }) => svc.list(db),
  create: (input, { db }) => svc.create(db, input),
  update: (id, patch, { db }) => svc.update(db, id, patch),
  remove: (id, { db }) => svc.remove(db, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

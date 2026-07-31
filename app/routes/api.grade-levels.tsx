import { crud } from '../../server/api/handler';
import * as svc from '../../server/services/grade-levels';
import { GradeLevelInput } from '../../shared/schemas';

/** Admin-only, mirroring /config. A Teacher token gets a 403. */
const routes = crud({
  level: 'admin',
  schema: GradeLevelInput,
  list: ({ db }) => svc.list(db),
  create: (input, { db }) => svc.create(db, input),
  update: (id, patch, { db }) => svc.update(db, id, patch),
  remove: (id, { db }) => svc.remove(db, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

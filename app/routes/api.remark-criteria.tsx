import { crud } from '../../server/api/handler';
import * as svc from '../../server/services/remark-criteria';
import { RemarkCriterionInput } from '../../shared/schemas';

/**
 * Writes are admin-only, mirroring /config. Reads are staff: any teacher writing a monthly
 * remark needs the criteria list to render the form.
 */
const routes = crud({
  level: 'admin',
  readLevel: 'staff',
  schema: RemarkCriterionInput,
  live: 'config',
  list: ({ db }) => svc.list(db),
  create: (input, { db }) => svc.create(db, input),
  update: (id, patch, { db }) => svc.update(db, id, patch),
  remove: (id, { db }) => svc.remove(db, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

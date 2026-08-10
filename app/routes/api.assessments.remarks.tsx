import { crud } from '../../server/api/handler';
import * as svc from '../../server/services/assessments';
import { MonthlyRemarkInput } from '../../shared/schemas';

const routes = crud({
  level: 'staff',
  schema: MonthlyRemarkInput,
  live: 'assessments',
  list: ({ db }) => svc.listRemarks(db),
  // POST upserts on (studentId, month) — one report per student per month is the identity.
  create: (input, { db, user }) => svc.createRemark(db, input, user.user.id),
  update: (id, patch, { db, user }) => svc.updateRemark(db, id, patch, user.user.id),
  remove: (id, { db }) => svc.removeRemark(db, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

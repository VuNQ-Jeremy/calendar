import { crud } from '../../server/api/handler';
import * as svc from '../../server/services/assessments';
import { BehaviorRecordInput } from '../../shared/schemas';

const routes = crud({
  level: 'staff',
  schema: BehaviorRecordInput,
  list: ({ db }) => svc.listBehavior(db),
  create: (input, { db }) => svc.createBehavior(db, input),
  update: (id, patch, { db }) => svc.updateBehavior(db, id, patch),
  remove: (id, { db }) => svc.removeBehavior(db, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

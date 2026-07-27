import { crud } from '../../server/api/handler';
import * as svc from '../../server/services/assessments';
import { ScoreRecordInput } from '../../shared/schemas';

const routes = crud({
  level: 'staff',
  schema: ScoreRecordInput,
  list: ({ db }) => svc.listScores(db),
  create: (input, { db }) => svc.createScore(db, input),
  update: (id, patch, { db }) => svc.updateScore(db, id, patch),
  remove: (id, { db }) => svc.removeScore(db, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

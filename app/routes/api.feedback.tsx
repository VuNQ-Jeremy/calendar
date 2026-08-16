import { crud } from '../../server/api/handler';
import * as svc from '../../server/services/feedback';
import { notifyFeedbackIssue } from '../../server/services/github';
import { FeedbackInput } from '../../shared/schemas';

// Resource route: no default export, or React Router serves this as a document.
// All work is delegated to server/services/feedback.ts — the same functions the
// web loaders and actions use.
const routes = crud({
  level: 'staff',
  schema: FeedbackInput,
  live: 'feedback',
  list: ({ db }) => svc.list(db),
  create: async (input, ctx) => {
    const row = await svc.create(ctx.db, input);
    notifyFeedbackIssue(ctx.env, ctx.ctx, ctx.db, row);
    return row;
  },
  update: (id, patch, { db }) => svc.update(db, id, patch),
  remove: (id, { db }) => svc.remove(db, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

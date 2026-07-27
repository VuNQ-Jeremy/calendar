import { crud } from "../../server/api/handler";
import * as svc from "../../server/services/feedback";
import { FeedbackInput } from "../../shared/schemas";

// Resource route: no default export, or React Router serves this as a document.
// All work is delegated to server/services/feedback.ts — the same functions the
// web loaders and actions use.
const routes = crud({
  level: "staff",
  schema: FeedbackInput,
  list: ({ db }) => svc.list(db),
  create: (input, { db }) => svc.create(db, input),
  update: (id, patch, { db }) => svc.update(db, id, patch),
  remove: (id, { db }) => svc.remove(db, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

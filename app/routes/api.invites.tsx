import { crud } from "../../server/api/handler";
import * as svc from "../../server/services/invites";
import { InviteInput } from "../../shared/schemas";

// Resource route: no default export, or React Router serves this as a document.
// All work is delegated to server/services/invites.ts — the same functions the
// web loaders and actions use.
const routes = crud({
  level: "staff",
  schema: InviteInput,
  list: ({ db }) => svc.list(db),
  create: (input, { db }) => svc.create(db, input),
  remove: (id, { db }) => svc.remove(db, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

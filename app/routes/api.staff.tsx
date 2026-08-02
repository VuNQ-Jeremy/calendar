import { crud } from "../../server/api/handler";
import * as people from "../../server/services/people";
import { StaffInput } from "../../shared/schemas";

// One of four entity families in server/services/people.ts, split into separate
// endpoints rather than the single intent-switched action the web screen uses.
const routes = crud({
  level: "staff",
  schema: StaffInput,
  live: "people",
  list: ({ db }) => people.listStaff(db),
  create: (input, { db }) => people.createStaff(db, input),
  update: (id, patch, { db }) => people.updateStaff(db, id, patch),
  remove: (id, { db }) => people.removeStaff(db, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

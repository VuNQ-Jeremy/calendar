import { crud } from "../../server/api/handler";
import * as people from "../../server/services/people";
import { StudentInput } from "../../shared/schemas";

// One of four entity families in server/services/people.ts, split into separate
// endpoints rather than the single intent-switched action the web screen uses.
const routes = crud({
  level: "staff",
  schema: StudentInput,
  live: "people",
  list: ({ db }) => people.listStudents(db),
  create: (input, { db }) => people.createStudent(db, input),
  update: (id, patch, { db }) => people.updateStudent(db, id, patch),
  remove: (id, { db }) => people.removeStudent(db, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

import { crud } from '../../server/api/handler';
import * as svc from '../../server/services/garden';
import { VocabAssignmentInput } from '../../shared/schemas';

/**
 * Giao bài từ vựng — the teacher's assignments. Staff only.
 *
 * Progress lives at `/api/garden/progress/:id` rather than under this path: the optional `:id?`
 * segment would swallow a literal `progress`, the same trap documented for
 * `api/flashcards/generate-topic` in app/routes.ts.
 */
// Named exports assigned one at a time, not destructured: the route-exports plugin has to be able
// to remove `loader` from the client bundle, and it cannot rewrite a destructuring pattern.
const routes = crud({
  level: 'staff',
  schema: VocabAssignmentInput,
  live: 'garden',
  list: ({ db, request }) => {
    const classId = new URL(request.url).searchParams.get('classId') ?? undefined;
    return svc.listAssignments(db, { classId });
  },
  create: (input, { db, user }) =>
    svc
      .createAssignment(db, input, user.kind === 'staff' ? user.user.id : null)
      .then((id) => ({ id })),
  update: (id, patch, { db }) => svc.updateAssignment(db, id, patch).then(() => ({ id })),
  remove: (id, { db }) => svc.deleteAssignment(db, id).then(() => ({ id })),
});

export const loader = routes.loader;
export const action = routes.action;

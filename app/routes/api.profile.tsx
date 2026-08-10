import { parsePatchBody, withAuth } from '../../server/api/handler';
import * as people from '../../server/services/people';
import { ProfileInput } from '../../shared/schemas';

/**
 * The caller's own record. `any` level — students and parents have a profile too, and for
 * a parent this endpoint is very nearly the whole app.
 *
 * Deliberately uses ProfileInput rather than StaffInput/StudentInput: a user must not be
 * able to change their own role by PATCHing this endpoint.
 */
export const loader = withAuth('any', async ({ user }) => ({
  ...user.user,
  kind: user.kind,
  email: user.account.email,
}));

export const action = withAuth(
  'any',
  async ({ request, db, user }) => {
    const patch = await parsePatchBody(request, ProfileInput);
    if (user.kind === 'staff') return people.updateStaff(db, user.user.id, patch);
    if (user.kind === 'parent') return people.updateParent(db, user.user.id, patch);
    return people.updateStudent(db, user.user.id, patch);
  },
  { live: 'profile' },
);

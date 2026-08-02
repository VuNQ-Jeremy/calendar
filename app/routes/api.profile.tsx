import { parsePatchBody, withAuth } from '../../server/api/handler';
import * as people from '../../server/services/people';
import { ProfileInput } from '../../shared/schemas';

/**
 * The caller's own record. `user` level — students have a profile too.
 *
 * Deliberately uses ProfileInput rather than StaffInput/StudentInput: a user must not be
 * able to change their own role by PATCHing this endpoint.
 */
export const loader = withAuth('user', async ({ user }) => ({
  ...user.user,
  kind: user.kind,
  email: user.account.email,
}));

export const action = withAuth(
  'user',
  async ({ request, db, user }) => {
    const patch = await parsePatchBody(request, ProfileInput);
    if (user.kind === 'staff') return people.updateStaff(db, user.user.id, patch);
    return people.updateStudent(db, user.user.id, patch);
  },
  { live: 'profile' },
);

import { withAuth } from '../../server/api/handler';

export const loader = withAuth('any', async ({ user }) => ({
  user: { ...user.user, kind: user.kind },
  account: user.account,
}));

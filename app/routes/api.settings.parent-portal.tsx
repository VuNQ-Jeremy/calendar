import { parsePatchBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/parent-portal';
import { ParentPortalInput } from '../../shared/schemas';

/**
 * Read at `any` level, write at `admin` — the split ui-prefs uses, for the same reason.
 *
 * A PARENT has to be able to read this: their phone decides whether to show the Children tab
 * from it, and a guard that only admins can query would leave every parent's tab bar guessing.
 * Reading the flag tells the caller nothing about anyone's data — the flag is the school's
 * posture, not a person's record.
 *
 * Writing is admin-only because this opens a data surface for a whole class of users, which is
 * exactly the kind of decision a student token restyling the school taught us to lock down.
 */
export const loader = withAuth('any', ({ db }) => svc.getParentPortal(db));

export const action = withAuth(
  'admin',
  async ({ request, db }) => {
    const patch = await parsePatchBody(request, ParentPortalInput);
    return svc.setParentPortal(db, patch);
  },
  { live: 'config' },
);

import { parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/class-materials';
import { ClassMaterialsSaveInput } from '../../shared/schemas';

/** Materials attached to a class. Omit `classId` to get the full join table. */
export const loader = withAuth('staff', async ({ request, db }) => {
  const classId = new URL(request.url).searchParams.get('classId');
  return classId ? svc.listForClass(db, classId) : svc.listAll(db);
});

export const action = withAuth(
  'staff',
  async ({ request, db }) => {
    const input = await parseBody(request, ClassMaterialsSaveInput);
    return svc.setForClass(db, input.classId, input.materialIds);
  },
  { live: 'materials' },
);

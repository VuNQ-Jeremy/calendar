import { parseBody, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/event-materials';
import { EventMaterialsSaveInput } from '../../shared/schemas';

/** Materials attached to an event. Omit `eventId` to get the full join table. */
export const loader = withAuth('staff', async ({ request, db }) => {
  const eventId = new URL(request.url).searchParams.get('eventId');
  return eventId ? svc.listForEvent(db, eventId) : svc.listAll(db);
});

export const action = withAuth(
  'staff',
  async ({ request, db }) => {
    const input = await parseBody(request, EventMaterialsSaveInput);
    return svc.setForEvent(db, input.eventId, input.materialIds);
  },
  { live: 'materials' },
);

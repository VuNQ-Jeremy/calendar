import { fail, withAuth } from '../../server/api/handler';
import * as svc from '../../server/services/tuition';
import { TuitionMonth } from '../../shared/schemas';

/**
 * One closed month for the signed-in student: the frozen fee lines, what is still outstanding, and
 * how to pay it.
 *
 * A month that is open, does not exist, or holds nothing for this student all come back as the same
 * 404. Keeping them indistinguishable is deliberate — a distinct "still open" response would let a
 * student read which months the centre is working on before it has said anything.
 *
 * `paymentInfo` is null until an admin fills the /config form; the screen says so rather than
 * showing an empty bank card.
 */
export const loader = withAuth('user', async ({ db, user, params }) => {
  if (user.kind !== 'student') throw fail('forbidden', 403);

  const parsed = TuitionMonth.safeParse(params.month);
  if (!parsed.success) throw fail('bad_month', 400);

  const detail = await svc.getStudentMonthDetail(db, user.user.id, parsed.data);
  if (!detail) throw fail('not_found', 404);

  const info = await svc.getPaymentInfo(db);
  const configured = Boolean(info.bankName || info.accountNumber || info.bankCode);

  return {
    ...detail,
    paymentInfo: configured
      ? svc.resolvePaymentInfo(info, {
          month: detail.month,
          studentName: user.user.name,
          outstandingVnd: detail.fee.outstandingVnd,
        })
      : null,
  };
});

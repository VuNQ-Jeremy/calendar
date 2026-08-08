/**
 * Compatibility barrel for the tuition helpers.
 *
 * Everything pure moved to `./fees` when the mobile app grew a "Học phí" screen: this file used to
 * type-import `server/services/tuition`, and although the import was types-only it still dragged
 * the Workers globals into whatever graph reached it — which the React Native tsconfig has no
 * `Env` for. Same story, one module at a time, as `formatDmy` (./dates) and `monthLabel`/
 * `shiftMonth` (./month) before it.
 *
 * The re-exports keep the web call sites and the tuition tests importing from this path. New code
 * — and all mobile code — should import from `./fees` directly.
 */

export {
  formatVnd,
  monthNumeric,
  dongToWords,
  paymentStatus,
  studentFees,
  resolveMemo,
  vietQrUrl,
} from './fees';
export type { PaymentStatus, StudentFee, FeeLine, FeePaymentRow } from './fees';
export { formatDmy } from './dates';
export { monthLabel, shiftMonth } from './month';

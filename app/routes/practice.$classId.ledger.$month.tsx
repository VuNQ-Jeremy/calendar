import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

// Legacy URL. The ledger is the sheet's standing strip now; same class, same month. 301: permanent.
export function loader({ params }: LoaderFunctionArgs) {
  throw redirect(`/practice/${params.classId}/${params.month}`, 301);
}

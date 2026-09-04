import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';

// Legacy URL. The week planner became the month sheet; a Monday maps to its month. 301: permanent.
export function loader({ params }: LoaderFunctionArgs) {
  const month = (params.monday ?? '').slice(0, 7);
  throw redirect(
    /^\d{4}-\d{2}$/.test(month) ? `/practice/${params.classId}/${month}` : '/practice',
    301,
  );
}

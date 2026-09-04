import { redirect } from 'react-router';

// Legacy URL. Reviewing moved INTO the class sheet (filter "Needs review"); a teacher landing here
// from a bookmark picks the class on the landing page. 301: the move is permanent.
export function loader() {
  throw redirect('/practice', 301);
}

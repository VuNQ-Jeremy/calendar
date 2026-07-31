import { redirect } from 'react-router';

// Legacy URL. The vocabulary pages moved from /flashcards to /vocabulary; this keeps old
// bookmarks and pre-rename push notifications (`data.url === '/flashcards'`) working.
// 301 rather than 302: the move is permanent, so let browsers and crawlers remember it.
export function loader() {
  throw redirect('/vocabulary', 301);
}

import { redirect } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';

// Legacy URL — see routes/flashcards.legacy.tsx. Carries the slug across so a deep link to a
// specific topic still lands on that topic.
export function loader({ params }: LoaderFunctionArgs) {
  throw redirect(`/vocabulary/${encodeURIComponent(params.slug ?? '')}`, 301);
}

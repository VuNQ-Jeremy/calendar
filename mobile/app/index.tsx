import { Redirect } from 'expo-router';
import { useAuth } from '~/lib/auth';

/**
 * The entry route: sends the user to the right place and renders nothing itself.
 *
 * The role split here is COSMETIC. The server is the real enforcement — `requireStaff` bounces
 * students and every staff endpoint returns 403 for a student token, whatever the client
 * chooses to draw. What this buys is that a student never SEES a staff tab, which matters for
 * a different reason: a visible-but-403 tab reads as a broken app.
 */
export default function Index() {
  const { user } = useAuth();

  if (!user) return <Redirect href="/login" />;
  // A parent's app is the profile screen and nothing else — the web is where their
  // children's information lives. Sending them to /dashboard would be a wall of 403s.
  if (user.kind === 'parent') return <Redirect href="/profile" />;
  return <Redirect href={user.kind === 'student' ? '/vocabulary' : '/dashboard'} />;
}

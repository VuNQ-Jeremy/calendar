import type { LoaderFunctionArgs } from 'react-router';
import { WalkthroughScreen } from '../../src/walkthrough/walkthrough-screen.jsx';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';

/**
 * /walkthrough — the admin-only product walkthrough checklist.
 *
 * Every user story in the product, listed as a checklist you work down by hand. Pressing Run on a
 * story opens that story's screen in a SECOND browser window, where the tour driver overlay
 * (src/walkthrough/tour-driver.tsx, mounted globally in app/routes/_app.tsx) spotlights each
 * control and pre-fills placeholder values. The two windows talk over a BroadcastChannel; the
 * catalogue they both read is shared/walkthrough.ts.
 *
 * `requireAdmin`, not `requireStaff`, for the same reason as /logo-library and /garden-species:
 * this is a view of the whole product rather than of anyone's class, and its `caution` stories
 * point at live attendance, grades and money. The nav row is `adminOnly` too, but the guard here is
 * what enforces it — a hidden link is not a permission.
 *
 * NO LOADER DATA AND NO ACTION, both deliberate. The catalogue is a static module both windows
 * already import, so shipping it through the loader would send 27 stories over the wire to describe
 * a file the bundle contains. And the screen writes nothing: which steps you ticked and whether a
 * story passed is one person's notes about one run against one deployment, so it lives in this
 * device's localStorage (`mochi_walkthrough_v1`) and never touches the database. A walkthrough that
 * recorded verdicts server-side would be a test-results table nobody asked for, with a migration,
 * a tenant column and an owner.
 *
 * The loader therefore exists only for the guard. It still has to be here: without a loader the
 * route renders for anyone who knows the URL.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  return null;
}

export default function WalkthroughRoute() {
  return <WalkthroughScreen />;
}

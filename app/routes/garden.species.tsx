import type { LoaderFunctionArgs } from 'react-router';
import { SpeciesShowcaseScreen } from '../../src/garden/species-showcase.jsx';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';

/**
 * /garden/species — every plant in the vocabulary garden, at every stage.
 *
 * The loader reads nothing: the species registry is static data in shared/garden-art.ts, shipped
 * in the bundle, so the page renders from what the client already has. `requireAdmin` is still
 * the point of having a loader at all — the page is a reference sheet for whoever runs the school,
 * not something to leave on the open web for the sake of a few kilobytes of SVG.
 *
 * The route is registered BEFORE `garden/:classId?` in app/routes.ts. Without a static segment
 * declared, `/garden/species` matches that optional param and the class garden tries to load a
 * class called "species" — the same trap logs/notifications documents.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  return null;
}

export default function GardenSpeciesRoute() {
  return <SpeciesShowcaseScreen />;
}

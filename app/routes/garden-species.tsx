import type { LoaderFunctionArgs } from 'react-router';
import { SpeciesShowcaseScreen } from '../../src/garden/species-showcase.jsx';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';

/**
 * /garden-species — every plant in the vocabulary garden, at every stage.
 *
 * The loader reads nothing: the species registry is static data in shared/garden-art.ts, shipped
 * in the bundle, so the page renders from what the client already has. `requireAdmin` is still
 * the point of having a loader at all — the page is a reference sheet for whoever runs the school,
 * not something to leave on the open web for the sake of a few kilobytes of SVG.
 *
 * The URL is `/garden-species`, a sibling of the garden rather than a child of it. `/garden/…` is
 * an optional `:classId`, so a nested path would be read as a class named "species"; and even with
 * a static segment declared first, NavLink marks a parent active by prefix, so the sidebar would
 * highlight the class garden and expand the wrong section. Same shape as `garden-month`.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);
  return null;
}

export default function GardenSpeciesRoute() {
  return <SpeciesShowcaseScreen />;
}

import { BUILD_ID } from '../lib/build-id.js';

/**
 * Build identity, shown in the sidebar under the language toggle.
 *
 * Deliberately not translated — a version string is an identifier, not UI copy.
 * Hidden below 720px, where the sidebar collapses to a 64px icon rail.
 */
export function VersionStamp() {
  return <div className="sb__version">{BUILD_ID}</div>;
}

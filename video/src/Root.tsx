import React from 'react';
import { Composition, staticFile } from 'remotion';
import { CATALOG, type CatalogEntry } from './catalog';
import { FPS, FORMATS, type FormatId } from './formats';
import type { Manifest } from './manifest';
import { GuideWalkthrough, guideDurations, type GuideProps } from './templates/GuideWalkthrough';

/**
 * Composition ids are `<catalog id>--<format>`, which is also how `scripts/render-all.mjs`
 * addresses them and how output files are named.
 */
function compositionId(entry: CatalogEntry, format: FormatId): string {
  return `${entry.id}--${format}`;
}

async function loadManifest(recording: string): Promise<Manifest> {
  const res = await fetch(staticFile(`recordings/${recording}/manifest.json`));
  if (!res.ok) {
    throw new Error(
      `no manifest for recording "${recording}" — run \`npm run record -- ${recording}\``,
    );
  }
  const manifest = (await res.json()) as Manifest;
  if (manifest.syncFlashFrame == null || manifest.footageStartFrame == null) {
    throw new Error(`recording "${recording}" is not synced — run \`npm run sync\``);
  }
  return manifest;
}

export const RemotionRoot: React.FC = () => (
  <>
    {CATALOG.filter((e) => e.series === 'guide').flatMap((entry) =>
      entry.formats.map((formatId) => {
        const format = FORMATS[formatId];
        return (
          <Composition
            key={compositionId(entry, formatId)}
            id={compositionId(entry, formatId)}
            component={GuideWalkthrough as React.FC<Record<string, unknown>>}
            width={format.width}
            height={format.height}
            fps={FPS}
            // Real values come from calculateMetadata; this is only what Studio shows
            // for the split second before the manifest resolves.
            durationInFrames={FPS * 10}
            defaultProps={{ entry, formatId } as unknown as Record<string, unknown>}
            calculateMetadata={async ({ props }) => {
              const p = props as unknown as GuideProps;
              const manifest = await loadManifest(p.entry.recording!);
              const { intro, footage, outro } = guideDurations(p.entry, manifest);
              return {
                durationInFrames: intro + footage + outro,
                props: { ...p, manifest } as unknown as Record<string, unknown>,
              };
            }}
          />
        );
      }),
    )}
  </>
);

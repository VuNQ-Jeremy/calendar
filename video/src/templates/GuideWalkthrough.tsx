import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Video } from '@remotion/media';
import type { CatalogEntry, GuideStep } from '../catalog';
import { FPS, FORMATS, type FormatId } from '../formats';
import { syncLead, trimBefore, type Manifest, type ManifestStep } from '../manifest';
import { LowerThird } from '../brand/LowerThird';
import { CursorHighlight } from '../brand/CursorHighlight';
import { PawSting } from '../brand/PawSting';
import { PawLogo } from '../brand/PawLogo';
import { Soundtrack } from '../brand/Soundtrack';
import { ZoomPan, type ZoomKey } from '../brand/ZoomPan';
import { semantic, timing } from '../brand/theme';

export type GuideProps = {
  entry: CatalogEntry;
  formatId: FormatId;
  manifest: Manifest;
};

const msToFrames = (ms: number) => Math.round((ms / 1000) * FPS);

type Beat = {
  step: GuideStep;
  recorded: ManifestStep;
  /** Frames relative to the start of the footage sequence. */
  from: number;
  durationInFrames: number;
};

/**
 * Lay the catalog's captions onto the recording's timeline.
 *
 * Step times in the manifest are measured from the sync flash, and the footage the
 * composition shows begins `syncLead` frames after that flash — so every recorded
 * time shifts back by exactly that much. Captions then run until the next one starts
 * rather than for their recorded duration, so they cross-dissolve instead of blinking
 * off in the gaps between steps.
 */
export function planBeats(entry: CatalogEntry, manifest: Manifest): Beat[] {
  const lead = syncLead(manifest);
  const byId = new Map(manifest.steps.map((s) => [s.id, s]));

  const found = (entry.steps ?? []).flatMap((step) => {
    const recorded = byId.get(step.manifestStep);
    if (!recorded) {
      // A caption for a step the walkthrough no longer records is a wiring bug, not
      // something to paper over with a silently missing caption.
      throw new Error(
        `${entry.id}: recording "${manifest.id}" has no step "${step.manifestStep}". ` +
          `Recorded: ${manifest.steps.map((s) => s.id).join(', ')}`,
      );
    }
    return [{ step, recorded }];
  });

  return found.map(({ step, recorded }, i) => {
    const from = Math.max(0, msToFrames(recorded.tStartMs) - lead);
    const next = found[i + 1];
    const end = next
      ? msToFrames(next.recorded.tStartMs) - lead
      : msToFrames(recorded.tEndMs) - lead;
    return { step, recorded, from, durationInFrames: Math.max(FPS, end - from) };
  });
}

export function guideDurations(entry: CatalogEntry, manifest: Manifest) {
  const beats = planBeats(entry, manifest);
  const last = beats[beats.length - 1];
  const footage = last ? last.from + last.durationInFrames : FPS * 5;
  return {
    intro: timing.stingIn + 30,
    footage,
    outro: timing.stingOut,
    beats,
  };
}

export const GuideWalkthrough: React.FC<GuideProps> = ({ entry, formatId, manifest }) => {
  const format = FORMATS[formatId];
  const { width } = useVideoConfig();
  const unit = width / 1920;
  const { intro, footage, outro, beats } = guideDurations(entry, manifest);

  const zoomKeys: ZoomKey[] = beats.map((b) => ({
    startFrame: b.from,
    target: b.step.zoom ? (b.recorded.target ?? null) : null,
  }));

  return (
    <AbsoluteFill style={{ background: semantic.bgPage }}>
      <Sequence durationInFrames={intro} name="Intro">
        <PawSting
          mode="intro"
          tagline={entry.titleVi}
          subtitle={entry.subtitleVi}
          typeScale={format.typeScale}
        />
      </Sequence>

      <Sequence from={intro} durationInFrames={footage} name="Footage">
        <FootageBlock
          entry={entry}
          manifest={manifest}
          beats={beats}
          zoomKeys={zoomKeys}
          unit={unit}
          typeScale={format.typeScale}
        />
      </Sequence>

      <Sequence from={intro + footage} durationInFrames={outro} name="Outro">
        <PawSting mode="outro" tagline="Chúc bạn dạy học vui!" typeScale={format.typeScale} />
      </Sequence>

      <Soundtrack src={entry.music} />
    </AbsoluteFill>
  );
};

const FootageBlock: React.FC<{
  entry: CatalogEntry;
  manifest: Manifest;
  beats: Beat[];
  zoomKeys: ZoomKey[];
  unit: number;
  typeScale: number;
}> = ({ entry, manifest, beats, zoomKeys, unit, typeScale }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // Dissolve up from the cream the intro sting fades to, rather than cutting.
  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <AbsoluteFill>
        <ZoomPan keys={zoomKeys} viewport={manifest.viewport}>
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <Video
              src={staticFile(`recordings/${manifest.id}/${manifest.id}.webm`)}
              trimBefore={trimBefore(manifest)}
              muted
              // Source and frame are both 16:9, so filling scales without cropping.
              objectFit="fill"
              style={{ width: '100%', height: '100%' }}
            />
            {beats
              .filter((b) => b.step.highlightClick && b.recorded.click)
              .map((b) => (
                <Sequence
                  key={`cursor-${b.step.manifestStep}`}
                  from={b.from}
                  durationInFrames={Math.min(b.durationInFrames, 46)}
                  layout="none"
                  name={`cursor:${b.step.manifestStep}`}
                >
                  <CursorHighlight point={b.recorded.click!} viewport={manifest.viewport} />
                </Sequence>
              ))}
          </div>
        </ZoomPan>
      </AbsoluteFill>

      {/* Keeps the caption legible over the app's own light surfaces. */}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background: `linear-gradient(to top, rgba(58,49,42,0.22) 0, rgba(58,49,42,0) ${Math.round(height * 0.3)}px)`,
        }}
      />

      {/* Captions sit outside ZoomPan so a camera push never drags them around. */}
      {beats.map((b, i) => (
        <AbsoluteFill
          key={b.step.manifestStep}
          style={{
            justifyContent: b.step.captionAt === 'top' ? 'flex-start' : 'flex-end',
            alignItems: 'center',
            padding: `${58 * unit}px ${70 * unit}px`,
          }}
        >
          <Sequence
            from={b.from}
            durationInFrames={b.durationInFrames}
            layout="none"
            name={`caption:${b.step.manifestStep}`}
          >
            <LowerThird
              text={b.step.captionVi}
              step={i + 1}
              durationInFrames={b.durationInFrames}
              unit={unit}
              typeScale={typeScale}
              maxWidth={width * 0.78}
              from={b.step.captionAt === 'top' ? 'top' : 'bottom'}
            />
          </Sequence>
        </AbsoluteFill>
      ))}

      {/* Bottom-right: the app's own primary action lives in the top-right corner, and
          a watermark there reads as part of the UI. */}
      <div
        style={{
          position: 'absolute',
          bottom: 40 * unit,
          right: 46 * unit,
          opacity: 0.8,
        }}
      >
        <PawLogo size={52 * unit} shadow={false} />
      </div>
    </AbsoluteFill>
  );
};

import React from 'react';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import {
  searchVocabImages,
  generateVocabImage,
  commitVocabImage,
} from '../lib/vocab-image-client.js';
import { flashcardImagePath } from '../../shared/logic/flashcards';
import type { VocabImageCandidate } from '../../shared/schemas';

/**
 * A chosen picture for one word.
 *
 * A stock pick is deliberately *uncommitted*: nothing has been copied into our bucket yet, so the
 * caller decides when to pay for that. The generated-topic review waits until save — a review the
 * teacher abandons should leave nothing behind — while the word editor commits immediately. A
 * generated illustration has no such choice: its bytes exist nowhere else, so the server had to
 * store it to have anything to show.
 */
export type PickedImage =
  | { kind: 'stock'; provider: VocabImageCandidate['provider']; id: string; thumbUrl: string }
  /** Already in our bucket: a freshly drawn illustration, or the picture a word was saved with. */
  | { kind: 'stored'; imageKey: string };

/** Turn a pick into a stored R2 key, committing a stock photo if that has not happened yet. */
export async function resolvePickedImageKey(picked: PickedImage): Promise<string | null> {
  if (picked.kind === 'stored') return picked.imageKey;
  const res = await commitVocabImage(picked.provider, picked.id);
  return res.ok ? res.imageKey : null;
}

/** Everything one word's strip needs to know. Owned by the caller so a whole list can hold many. */
export type ImageChoice = {
  candidates: VocabImageCandidate[];
  /** Which batch is on screen. Retry walks this forward, wrapping when a page comes back empty. */
  page: number;
  picked: PickedImage | null;
  status: 'idle' | 'loading' | 'drawing' | 'failed';
};

export const emptyChoice: ImageChoice = { candidates: [], page: 1, picked: null, status: 'idle' };

/** Fetch one batch. Exported so callers can pre-fill a list of strips without mounting them. */
export async function loadChoice(query: string, page = 1): Promise<Partial<ImageChoice>> {
  const res = await searchVocabImages(query, page);
  if (!res.ok) return { status: 'failed' };
  // Nothing on this page means we walked off the end — start over rather than show an empty strip.
  if (res.candidates.length === 0 && page > 1) {
    const first = await searchVocabImages(query, 1);
    return first.ok
      ? { candidates: first.candidates, page: 1, status: 'idle' }
      : { status: 'failed' };
  }
  return { candidates: res.candidates, page, status: 'idle' };
}

const TILE_W = 76;
const TILE_H = 57; // 4:3-ish, close enough to the card's 3:2 to read as the same picture

/**
 * A horizontal strip of candidate pictures for one word, with the chosen one outlined.
 *
 * This replaced a modal picker. Choosing a picture is a glance-and-tap decision made while reading
 * the word it belongs to, and a dialog put the word out of sight to do it — worse, in the generated
 * review it meant opening a dialog on top of a dialog, once per word, fifty times over. Inline the
 * whole list stays scannable and the teacher can work straight down it.
 *
 * Stateless by design: the caller owns the `ImageChoice` (a list of these lives in a list of rows),
 * so this renders and reports, and never fetches behind the caller's back.
 */
export function ImageStrip({
  query,
  choice,
  onChange,
  compact = false,
}: {
  /** What to search for — the model's own keywords, or the word itself. */
  query: string;
  choice: ImageChoice;
  onChange: (patch: Partial<ImageChoice>) => void;
  /** Smaller tiles for a dense list. */
  compact?: boolean;
}) {
  const { t } = useLang();
  const w = compact ? TILE_W * 0.8 : TILE_W;
  const h = compact ? TILE_H * 0.8 : TILE_H;
  const busy = choice.status === 'loading' || choice.status === 'drawing';

  /** Next batch for the same phrase. */
  const retry = async () => {
    onChange({ status: 'loading' });
    onChange(await loadChoice(query, choice.page + 1));
  };

  const draw = async () => {
    onChange({ status: 'drawing' });
    const res = await generateVocabImage(query);
    onChange(
      res.ok
        ? { status: 'idle', picked: { kind: 'stored', imageKey: res.imageKey } }
        : { status: 'failed' },
    );
  };

  const isPicked = (c: VocabImageCandidate) =>
    choice.picked?.kind === 'stock' && choice.picked.id === c.id;

  const tile = (selected: boolean): React.CSSProperties => ({
    width: w,
    height: h,
    flex: 'none',
    padding: 0,
    overflow: 'hidden',
    borderRadius: 8,
    // The selection is the whole point of the strip, so it is a real 2px brand outline plus a ring
    // rather than a tint — it has to be obvious at a glance down a list of fifty rows. The ring is
    // mixed from --brand rather than written as a literal: the brand is orange here, and a
    // hardcoded colour would sit wrong against it (and wrong again under a re-theme).
    border: selected
      ? '2px solid var(--brand)'
      : '1px solid var(--border-soft, rgba(0,0,0,0.12))',
    boxShadow: selected ? '0 0 0 3px color-mix(in srgb, var(--brand) 35%, transparent)' : 'none',
    background: 'var(--surface-muted, rgba(0,0,0,0.04))',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
  });

  return (
    <div className="m-row" style={{ gap: 6, alignItems: 'center', minWidth: 0 }}>
      <div
        // The strip scrolls rather than wrapping: a row per word has to stay one row tall.
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'thin',
          padding: '3px 1px',
          flex: 1,
          minWidth: 0,
        }}
      >
        {/* A stored picture — drawn just now, or the one this word was saved with — is not among
            the search results, so it gets its own leading tile: already selected, and cleared by
            tapping it. */}
        {choice.picked?.kind === 'stored' && (
          <button
            type="button"
            title={t('fc_img_remove')}
            onClick={() => onChange({ picked: null })}
            style={tile(true)}
          >
            <img
              src={flashcardImagePath(choice.picked.imageKey) ?? undefined}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </button>
        )}

        {choice.candidates.map((c) => (
          <button
            key={`${c.provider}:${c.id}`}
            type="button"
            title={c.credit || undefined}
            aria-pressed={isPicked(c)}
            onClick={() => onChange({ picked: isPicked(c) ? null : { kind: 'stock', ...c } })}
            style={tile(isPicked(c))}
          >
            <img
              src={c.thumbUrl}
              alt=""
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </button>
        ))}

        {choice.status === 'loading' && (
          <span className="mochi-field__hint" style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>
            {t('fc_img_searching')}
          </span>
        )}
        {choice.status === 'drawing' && (
          <span className="mochi-field__hint" style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>
            {t('fc_img_drawing')}
          </span>
        )}
        {choice.status === 'idle' && choice.candidates.length === 0 && !choice.picked && (
          <span className="mochi-field__hint" style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>
            {t('fc_img_no_results')}
          </span>
        )}
        {choice.status === 'failed' && (
          <span
            className="mochi-field__hint"
            style={{ alignSelf: 'center', whiteSpace: 'nowrap', color: 'var(--red-600, #c0392b)' }}
          >
            {t('fc_img_failed')}
          </span>
        )}
      </div>

      {/* Fresh batch, and draw-one — the two things the old dialog offered, as icons. */}
      <button
        type="button"
        className="mochi-btn is-ghost"
        title={t('fc_img_retry')}
        aria-label={t('fc_img_retry')}
        disabled={busy}
        onClick={retry}
        style={iconBtn}
      >
        <MIcon name="repeat" size={16} />
      </button>
      <button
        type="button"
        className="mochi-btn is-ghost"
        title={t('fc_img_generate_ai')}
        aria-label={t('fc_img_generate_ai')}
        disabled={busy}
        onClick={draw}
        style={iconBtn}
      >
        <MIcon name="sparkle" size={16} />
      </button>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  flex: 'none',
  width: 30,
  height: 30,
  padding: 0,
  display: 'grid',
  placeItems: 'center',
};

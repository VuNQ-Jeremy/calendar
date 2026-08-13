import React from 'react';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { searchVocabImages, commitVocabImage } from '../lib/vocab-image-client.js';
import { flashcardImagePath } from '../../shared/logic/flashcards';
import { VOCAB_IMAGE_MAX_PAGE } from '../../shared/schemas';
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
  status: 'idle' | 'loading' | 'failed';
  /** A search has come back at least once — tells "nothing matched" from "nobody has asked yet". */
  searched: boolean;
};

export const emptyChoice: ImageChoice = {
  candidates: [],
  page: 1,
  picked: null,
  status: 'idle',
  searched: false,
};

/** Fetch one batch. Exported so callers can pre-fill a list of strips without mounting them. */
export async function loadChoice(query: string, page = 1): Promise<Partial<ImageChoice>> {
  const res = await searchVocabImages(query, page);
  if (!res.ok) return { status: 'failed' };
  // Nothing on this page means we walked off the end — start over rather than show an empty strip.
  if (res.candidates.length === 0 && page > 1) {
    const first = await searchVocabImages(query, 1);
    return first.ok
      ? { candidates: first.candidates, page: 1, status: 'idle', searched: true }
      : { status: 'failed' };
  }
  return { candidates: res.candidates, page, status: 'idle', searched: true };
}

const TILE_W = 76;
const TILE_H = 57; // 4:3-ish, close enough to the card's 3:2 to read as the same picture
/** Cells in the `grid` layout — three rows of three, which is exactly what one search returns. */
const CELLS = 9;

/**
 * Candidate pictures for one word, with the chosen one outlined.
 *
 * This replaced a modal picker. Choosing a picture is a glance-and-tap decision made while reading
 * the word it belongs to, and a dialog put the word out of sight to do it — worse, in the generated
 * review it meant opening a dialog on top of a dialog, once per word, fifty times over. Inline the
 * whole list stays scannable and the teacher can work straight down it.
 *
 * Two layouts, same behaviour:
 * - `strip` — one scrolling row, for a list where every word's row has to stay one row tall.
 * - `grid` — a 3×3 block filling its column, for the word editor, where the picker owns a column
 *   of the dialog and the whole batch should be on screen at once. Kept to nine cells whatever
 *   arrives, padded with blanks, so the column never changes height under the teacher.
 *
 * Stateless by design: the caller owns the `ImageChoice` (a list of these lives in a list of rows),
 * so this renders and reports, and never fetches behind the caller's back.
 */
export function ImageStrip({
  query,
  choice,
  onChange,
  compact = false,
  layout = 'strip',
  originalImageKey = null,
}: {
  /** What to search for — the model's own keywords, or the word itself. */
  query: string;
  choice: ImageChoice;
  onChange: (patch: Partial<ImageChoice>) => void;
  /** Smaller tiles for a dense list. Ignored by the `grid` layout, whose tiles size themselves. */
  compact?: boolean;
  layout?: 'strip' | 'grid';
  /**
   * The picture the word is *saved* with, if any. It holds its own cell for as long as the picker
   * is open, whether or not it is the current pick, so trying a candidate never takes the picture
   * the word actually has off screen and one tap puts it back.
   */
  originalImageKey?: string | null;
}) {
  const { t } = useLang();
  const grid = layout === 'grid';
  const w = compact ? TILE_W * 0.8 : TILE_W;
  const h = compact ? TILE_H * 0.8 : TILE_H;

  /** Next batch for the same phrase, wrapping at the cap the server would reject anyway. */
  const retry = async () => {
    onChange({ status: 'loading' });
    onChange(await loadChoice(query, choice.page >= VOCAB_IMAGE_MAX_PAGE ? 1 : choice.page + 1));
  };

  const isPicked = (c: VocabImageCandidate) =>
    choice.picked?.kind === 'stock' && choice.picked.id === c.id;

  const cell: React.CSSProperties = grid
    ? // The column is fluid, so a grid tile takes the width it is given and keeps the strip's
      // 4:3 shape from its own aspect ratio rather than a fixed height.
      { width: '100%', aspectRatio: '4 / 3' }
    : { width: w, height: h };

  const tile = (selected: boolean): React.CSSProperties => ({
    ...cell,
    flex: 'none',
    padding: 0,
    overflow: 'hidden',
    borderRadius: 8,
    // The selection is the whole point of the picker, so it is a real 2px brand outline plus a ring
    // rather than a tint — it has to be obvious at a glance down a list of fifty rows. The ring is
    // mixed from --brand rather than written as a literal: the brand is orange here, and a
    // hardcoded colour would sit wrong against it (and wrong again under a re-theme).
    border: selected ? '2px solid var(--brand)' : '1px solid var(--border-soft, rgba(0,0,0,0.12))',
    boxShadow: selected ? '0 0 0 3px color-mix(in srgb, var(--brand) 35%, transparent)' : 'none',
    background: 'var(--surface-muted, rgba(0,0,0,0.04))',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
  });

  // The word's own picture keeps a cell of its own; without one, a stored *pick* still needs a
  // leading tile, since nothing already in our bucket comes back from a search.
  const storedKey =
    originalImageKey ?? (choice.picked?.kind === 'stored' ? choice.picked.imageKey : null);
  const storedPicked = choice.picked?.kind === 'stored' && choice.picked.imageKey === storedKey;
  // The stored tile takes one of the nine cells, so the batch beside it is trimmed by one rather
  // than spilling onto a fourth row.
  const candidates = grid
    ? choice.candidates.slice(0, CELLS - (storedKey ? 1 : 0))
    : choice.candidates;

  const tiles = (
    <>
      {/* Outlined while it is the pick, and then tapping it clears the picture; unoutlined once a
          candidate has taken over, where tapping it goes back to what the word already had. */}
      {storedKey && (
        <button
          type="button"
          title={storedPicked ? t('fc_img_remove') : t('fc_img_keep')}
          aria-pressed={storedPicked}
          onClick={() =>
            onChange({ picked: storedPicked ? null : { kind: 'stored', imageKey: storedKey } })
          }
          style={tile(storedPicked)}
        >
          <img
            src={flashcardImagePath(storedKey) ?? undefined}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </button>
      )}

      {candidates.map((c) => (
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
    </>
  );

  const message =
    choice.status === 'loading'
      ? t('fc_img_searching')
      : choice.status === 'failed'
        ? t('fc_img_failed')
        : // Only once a search has actually come back — an untouched picker is empty, not empty-handed.
          choice.searched && candidates.length === 0
          ? t('fc_img_no_results')
          : null;

  const messageNode = message && (
    <span
      className="mochi-field__hint"
      style={{
        alignSelf: 'center',
        whiteSpace: grid ? 'normal' : 'nowrap',
        color: choice.status === 'failed' ? 'var(--red-600, #c0392b)' : undefined,
      }}
    >
      {message}
    </span>
  );

  if (grid) {
    const blanks = Math.max(0, CELLS - candidates.length - (storedKey ? 1 : 0));
    return (
      <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
          {tiles}
          {Array.from({ length: blanks }, (_, i) => (
            <div
              key={`blank-${i}`}
              style={{
                ...cell,
                borderRadius: 8,
                border: '1px dashed var(--border-subtle, rgba(0,0,0,0.10))',
                background: 'var(--surface-muted, rgba(0,0,0,0.03))',
              }}
            />
          ))}
        </div>
        {messageNode}
        <button
          type="button"
          className="mochi-btn is-ghost"
          disabled={choice.status === 'loading'}
          onClick={retry}
          style={{ justifySelf: 'start', gap: 6 }}
        >
          <MIcon name="repeat" size={16} />
          {t('fc_img_retry')}
        </button>
      </div>
    );
  }

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
        {tiles}
        {messageNode}
      </div>

      <button
        type="button"
        className="mochi-btn is-ghost"
        title={t('fc_img_retry')}
        aria-label={t('fc_img_retry')}
        disabled={choice.status === 'loading'}
        onClick={retry}
        style={iconBtn}
      >
        <MIcon name="repeat" size={16} />
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

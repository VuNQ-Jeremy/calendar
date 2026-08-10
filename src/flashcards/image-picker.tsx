import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import {
  searchVocabImages,
  generateVocabImage,
  commitVocabImage,
} from '../lib/vocab-image-client.js';
import type { VocabImageCandidate } from '../../shared/schemas';

const { Button: FBtn } = DS;

/**
 * What the picker hands back.
 *
 * A stock pick is deliberately *uncommitted*: nothing has been copied into our bucket yet, so the
 * caller decides when to pay for that. The word editor commits immediately (the teacher is saving
 * one word), while the generated-topic review waits until save — a review the teacher abandons
 * should leave nothing behind. A generated illustration has no such choice: its bytes exist
 * nowhere else, so the server had to store it to have anything to show.
 */
export type PickedImage =
  | { kind: 'stock'; provider: VocabImageCandidate['provider']; id: string; thumbUrl: string }
  | { kind: 'ai'; imageKey: string };

/**
 * Choose a picture for one vocabulary word: search stock photos, or have one drawn.
 *
 * Always available — with no Pixabay key the server falls back to Openverse, which needs no
 * credentials — so there is no configuration flag to thread through here.
 */
export function ImagePicker({
  initialQuery,
  onPick,
  onClose,
}: {
  initialQuery: string;
  onPick: (picked: PickedImage) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [query, setQuery] = React.useState(initialQuery);
  const [candidates, setCandidates] = React.useState<VocabImageCandidate[] | null>(null);
  const [status, setStatus] = React.useState<'idle' | 'searching' | 'drawing' | 'failed'>('idle');

  const run = React.useCallback(async (phrase: string) => {
    const q = phrase.trim();
    if (!q) return;
    setStatus('searching');
    const res = await searchVocabImages(q);
    if (!res.ok) {
      setStatus('failed');
      setCandidates(null);
      return;
    }
    setStatus('idle');
    setCandidates(res.candidates);
  }, []);

  // Search once on open, so the grid is already populated for the word the caller had in mind.
  React.useEffect(() => {
    void run(initialQuery);
  }, [initialQuery, run]);

  const draw = async () => {
    const subject = query.trim() || initialQuery.trim();
    if (!subject) return;
    setStatus('drawing');
    const res = await generateVocabImage(subject);
    if (!res.ok) {
      setStatus('failed');
      return;
    }
    setStatus('idle');
    onPick({ kind: 'ai', imageKey: res.imageKey });
  };

  const busy = status === 'searching' || status === 'drawing';

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t('fc_img_pick_title')}
      width={620}
      footer={
        <>
          <FBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </FBtn>
          <FBtn
            variant="primary"
            iconLeft={<MIcon name="sparkle" size={18} />}
            disabled={busy}
            onClick={draw}
          >
            {status === 'drawing' ? t('fc_img_drawing') : t('fc_img_generate_ai')}
          </FBtn>
        </>
      }
    >
      <div className="mochi-field">
        <label className="mochi-field__label">{t('fc_img_search_label')}</label>
        <div className="m-row" style={{ gap: 8, alignItems: 'stretch' }}>
          <input
            className="mochi-input"
            style={{ flex: 1 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void run(query);
              }
            }}
          />
          <FBtn variant="secondary" disabled={busy} onClick={() => void run(query)}>
            {t('fc_img_search')}
          </FBtn>
        </div>
        <span className="mochi-field__hint">{t('fc_img_search_hint')}</span>
      </div>

      {status === 'searching' && <span className="mochi-field__hint">{t('fc_img_searching')}</span>}
      {status === 'failed' && (
        <span className="mochi-field__hint" style={{ color: 'var(--red-600, #c0392b)' }}>
          {t('fc_img_failed')}
        </span>
      )}

      {candidates && candidates.length === 0 && status === 'idle' && (
        <span className="mochi-field__hint">{t('fc_img_no_results')}</span>
      )}

      {candidates && candidates.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
            marginTop: 4,
          }}
        >
          {candidates.map((c) => (
            <button
              key={`${c.provider}:${c.id}`}
              type="button"
              title={c.credit || undefined}
              onClick={() =>
                onPick({ kind: 'stock', provider: c.provider, id: c.id, thumbUrl: c.thumbUrl })
              }
              style={{
                padding: 0,
                border: '1px solid var(--border-soft, rgba(0,0,0,0.12))',
                borderRadius: 10,
                overflow: 'hidden',
                background: 'var(--surface-card)',
                cursor: 'pointer',
                aspectRatio: '3 / 2',
              }}
            >
              {/* Provider thumbnails are hotlinked here and nowhere else: only the picture the
                  teacher actually chooses gets copied into our bucket. */}
              <img
                src={c.thumbUrl}
                alt=""
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/**
 * Turn a pick into a stored R2 key, committing a stock photo if that has not happened yet.
 *
 * Shared by both callers so the "AI images are already stored, stock ones are not" asymmetry lives
 * in exactly one place. Returns null when the copy failed — losing a picture is never worth
 * failing the save the teacher asked for.
 */
export async function resolvePickedImageKey(picked: PickedImage): Promise<string | null> {
  if (picked.kind === 'ai') return picked.imageKey;
  const res = await commitVocabImage(picked.provider, picked.id);
  return res.ok ? res.imageKey : null;
}

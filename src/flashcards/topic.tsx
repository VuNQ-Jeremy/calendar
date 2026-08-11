import React from 'react';
import { useLoaderData, useFetcher, useNavigate, useParams, useSearchParams } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, PageHeader, Empty, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { fetchEnrichedWords } from '../lib/enrich-client.js';
import type { EnrichMap } from '../lib/enrich-client.js';
import { playWord } from './audio.js';
import { MIN_WORDS, fmtDuration, parseImportLines } from './game-utils.js';
import type { GameMode, GameResult } from './game-utils.js';
import {
  orderWordsByMastery,
  flashcardImagePath,
  typeEligible,
  wordsWithImages,
} from '../../shared/logic/flashcards';
import { ImageStrip, emptyChoice, loadChoice, resolvePickedImageKey } from './image-strip.js';
import type { ImageChoice } from './image-strip.js';
import { isDue } from '../../shared/logic/review';
import { FlipGame } from './game-flip.jsx';
import { QuizGame } from './game-quiz.jsx';
import { MatchGame } from './game-match.jsx';
import { ScrambleGame } from './game-scramble.jsx';
import { FillGame } from './game-fill.jsx';
import { TypeGame } from './game-type.jsx';
import { PictureGame } from './game-picture.jsx';
import type { RoundGarden } from '../garden/garden-widget.jsx';
import type {
  FlashcardWordRow,
  FlashcardResultRow,
  MasteryRow,
} from '../../server/services/flashcards.js';

const {
  Card: FC,
  Button: FBtn,
  IconButton: FIB,
  Input: FInput,
  Avatar: FAv,
  Badge: FBadge,
  Checkbox: FCheck,
} = DS;

type TopicInfo = { id: string; name: string; description: string | null; color: string };
type LoaderData = {
  topic: TopicInfo;
  words: FlashcardWordRow[];
  results: FlashcardResultRow[];
  mastery: MasteryRow[];
  kind: 'staff' | 'student';
  canUseAi: boolean;
  /** ICT today, from the server. Decides which words `?review=1` plays. */
  today: string;
};

const MODE_META: {
  id: GameMode;
  tk: string;
  icon: 'cards' | 'grid' | 'check' | 'shuffle' | 'edit' | 'keyboard' | 'image';
}[] = [
  { id: 'flip', tk: 'fc_mode_flip', icon: 'cards' },
  { id: 'quiz', tk: 'fc_mode_quiz', icon: 'check' },
  { id: 'match', tk: 'fc_mode_match', icon: 'grid' },
  { id: 'scramble', tk: 'fc_mode_scramble', icon: 'shuffle' },
  { id: 'fill', tk: 'fc_mode_fill', icon: 'edit' },
  { id: 'type', tk: 'fc_mode_type', icon: 'keyboard' },
  { id: 'picture', tk: 'fc_mode_picture', icon: 'image' },
];

export function FlashcardTopicScreen() {
  const { topic, words, results, mastery, kind, canUseAi, today } = useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // The URL segment the student arrived on — slug or id. Leaving review mode must land on the
  // same page, and the loader payload carries no slug of its own.
  const { slug } = useParams();
  const { t } = useLang();
  const fetcher = useFetcher();
  const resultFetcher = useFetcher<{ ok?: boolean; garden?: RoundGarden | null }>();
  // The round result's reply carries what happened to the student's plant. It belongs to this
  // submission and is only ever shown inside the game that produced it, so it is threaded down as
  // a prop instead of being read back out of a loader. `pending` keeps the panel from showing the
  // PREVIOUS round's verdict for the moment between "play again" finishing and its POST landing.
  const [gardenPending, setGardenPending] = React.useState(false);
  const [tab, setTab] = React.useState('words');
  const [playing, setPlaying] = React.useState<GameMode | null>(null);
  const isStaff = kind === 'staff';

  /**
   * Ôn tập: `?review=1` narrows every game to the words that have come round again today.
   *
   * The filter is the loader's `today` against each word's `dueDay`, which is the same comparison
   * the vocabulary page's due card made — so "12 từ cần ôn" over there is 12 cards over here. Staff
   * have no mastery rows and so never enter review mode, whatever the URL says.
   */
  const reviewMode = kind === 'student' && searchParams.get('review') === '1';
  const dueWords = React.useMemo(() => {
    if (!reviewMode) return words;
    const byWord = new Map(mastery.map((m) => [m.wordId, m]));
    return words.filter((w) => isDue(byWord.get(w.id) ?? null, today));
  }, [reviewMode, words, mastery, today]);
  // The round just finished and the revalidation landed: everything is rescheduled into the future,
  // so there is nothing left to review. Fall back to the whole topic rather than an empty deck.
  const reviewEmpty = reviewMode && dueWords.length === 0;
  const deck = reviewEmpty ? words : dueWords;

  // Flip mode prioritizes words the student answered wrong most often, then words not seen for
  // the longest. Students with no history (or staff preview) get a plain shuffle. The comparison
  // moved to shared/logic/flashcards.ts in phase 3 so mobile orders cards identically. In review
  // mode the same ordering applies to the due subset — "worst first" is exactly review priority.
  const orderedWords = React.useMemo(
    () => orderWordsByMastery(deck, kind === 'student' ? mastery : []),
    [deck, mastery, kind],
  );

  React.useEffect(() => {
    if (resultFetcher.state === 'idle' && resultFetcher.data) setGardenPending(false);
  }, [resultFetcher.state, resultFetcher.data]);

  const roundGarden =
    gardenPending || resultFetcher.state !== 'idle' ? null : (resultFetcher.data?.garden ?? null);

  const finish = (r: GameResult) => {
    setGardenPending(true);
    const fd = new FormData();
    fd.set('intent', 'record-result');
    fd.set('topicId', topic.id);
    fd.set('mode', r.mode);
    fd.set('score', String(r.score));
    fd.set('total', String(r.total));
    if (r.durationMs != null) fd.set('durationMs', String(r.durationMs));
    fd.set('answers', JSON.stringify(r.answers));
    resultFetcher.submit(fd, { method: 'post' });
  };

  if (playing) {
    const exit = () => setPlaying(null);
    return (
      <GameOverlay topicName={topic.name} onExit={exit}>
        {playing === 'flip' && (
          <FlipGame words={orderedWords} onExit={exit} onFinish={finish} garden={roundGarden} />
        )}
        {playing === 'quiz' && (
          <QuizGame words={deck} onExit={exit} onFinish={finish} garden={roundGarden} />
        )}
        {playing === 'match' && (
          <MatchGame words={deck} onExit={exit} onFinish={finish} garden={roundGarden} />
        )}
        {playing === 'scramble' && (
          <ScrambleGame words={deck} onExit={exit} onFinish={finish} garden={roundGarden} />
        )}
        {playing === 'fill' && (
          <FillGame words={deck} onExit={exit} onFinish={finish} garden={roundGarden} />
        )}
        {playing === 'type' && (
          <TypeGame words={deck} onExit={exit} onFinish={finish} garden={roundGarden} />
        )}
        {playing === 'picture' && (
          <PictureGame words={deck} onExit={exit} onFinish={finish} garden={roundGarden} />
        )}
      </GameOverlay>
    );
  }

  return (
    <div className="content">
      <PageHeader
        title={
          <span className="m-row" style={{ gap: 10, alignItems: 'center' }}>
            <FIB label={t('fc_title')} size="sm" onClick={() => navigate('/vocabulary')}>
              <MIcon name="chevronLeft" size={18} />
            </FIB>
            {topic.name}
          </span>
        }
        subtitle={t('fc_word_count', { n: words.length })}
      />

      {reviewMode && (
        <div
          className="m-row"
          style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}
        >
          <MIcon name="repeat" size={18} />
          <span>
            {reviewEmpty
              ? t('fc_review_done_today')
              : t('fc_review_playing', { n: dueWords.length })}
          </span>
          <FBtn variant="ghost" onClick={() => navigate(`/vocabulary/${slug ?? topic.id}`)}>
            {t('fc_review_whole_topic')}
          </FBtn>
        </div>
      )}

      <div className="m-row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        {MODE_META.map((m) => {
          // Beyond the word-count floor: type needs a word whose hint isn't the answer, and
          // picture needs at least one word that actually has a picture.
          const disabled =
            deck.length < MIN_WORDS[m.id] ||
            (m.id === 'type' && !deck.some(typeEligible)) ||
            (m.id === 'picture' && wordsWithImages(deck).length === 0);
          return (
            <FBtn
              key={m.id}
              variant="soft"
              iconLeft={<MIcon name={m.icon} size={18} />}
              disabled={disabled}
              title={
                disabled
                  ? m.id === 'picture' && deck.length >= MIN_WORDS.picture
                    ? t('fc_picture_none')
                    : t('fc_min_words', { n: MIN_WORDS[m.id] })
                  : undefined
              }
              onClick={() => setPlaying(m.id)}
            >
              {t(m.tk)}
            </FBtn>
          );
        })}
      </div>

      <DS.Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'words', label: t('fc_tab_words') },
          { id: 'results', label: t('fc_tab_results') },
        ]}
      />

      {tab === 'words' ? (
        <WordsTab words={words} isStaff={isStaff} fetcher={fetcher} canUseAi={canUseAi} />
      ) : (
        <ResultsTab results={results} />
      )}
    </div>
  );
}

function GameOverlay({
  topicName,
  onExit,
  children,
}: {
  topicName: string;
  onExit: () => void;
  children: React.ReactNode;
}) {
  const { t } = useLang();
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'var(--bg-app, #faf7f2)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--font-body)',
      }}
    >
      <div
        className="m-row"
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--line, #e7e0d6)',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 700, color: 'var(--text-strong)', flex: 1, minWidth: 0 }}>
          {topicName}
        </div>
        <FBtn variant="secondary" iconLeft={<MIcon name="x" size={16} />} onClick={onExit}>
          {t('fc_exit')}
        </FBtn>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex' }}>{children}</div>
    </div>
  );
}

// ---- Words tab ----

interface WordDraft {
  id?: string;
  word: string;
  meaningVi: string;
  definitionEn: string;
  ipa: string;
  /** Stored R2 key, or '' for no picture. Already committed by the time it lands here. */
  imageKey: string;
}

function WordsTab({
  words,
  isStaff,
  fetcher,
  canUseAi,
}: {
  words: FlashcardWordRow[];
  isStaff: boolean;
  fetcher: ReturnType<typeof useFetcher>;
  canUseAi: boolean;
}) {
  const { t } = useLang();
  const [modal, setModal] = React.useState<WordDraft | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [confirm, confirmNode] = useConfirm();

  const del = async (w: FlashcardWordRow) => {
    const ok = await confirm({
      title: t('fc_edit_word'),
      message: t('fc_delete_word_msg', { word: w.word }),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'word-delete');
    fd.set('id', w.id);
    fetcher.submit(fd, { method: 'post' });
  };

  const save = (f: WordDraft) => {
    if (!f.word.trim()) return;
    const fd = new FormData();
    fd.set('intent', f.id ? 'word-update' : 'word-create');
    if (f.id) fd.set('id', f.id);
    fd.set('word', f.word);
    fd.set('meaningVi', f.meaningVi);
    fd.set('definitionEn', f.definitionEn);
    fd.set('ipa', f.ipa);
    // '' clears the picture: preprocessWord in the route turns it into null.
    fd.set('imageKey', f.imageKey);
    fetcher.submit(fd, { method: 'post' });
    setModal(null);
  };

  return (
    <>
      {isStaff && (
        <div className="m-row" style={{ gap: 10, margin: '4px 0 14px' }}>
          <FBtn
            variant="primary"
            iconLeft={<MIcon name="plus" size={18} />}
            onClick={() =>
              setModal({ word: '', meaningVi: '', definitionEn: '', ipa: '', imageKey: '' })
            }
          >
            {t('fc_add_word')}
          </FBtn>
          <FBtn
            variant="secondary"
            iconLeft={<MIcon name="upload" size={18} />}
            onClick={() => setImporting(true)}
          >
            {t('fc_import')}
          </FBtn>
        </div>
      )}

      {words.length ? (
        <div className="m-stack">
          {words.map((w) => (
            <div key={w.id} className="lrow" style={{ alignItems: 'flex-start' }}>
              {w.imageKey && (
                <img
                  src={flashcardImagePath(w.imageKey) ?? undefined}
                  alt=""
                  loading="lazy"
                  style={{
                    width: 44,
                    height: 33,
                    flex: 'none',
                    objectFit: 'cover',
                    borderRadius: 6,
                    display: 'block',
                  }}
                />
              )}
              <FIB label={t('fc_play_audio')} size="sm" onClick={() => playWord(w.word)}>
                <MIcon name="volume" size={18} />
              </FIB>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="m-row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontWeight: 700,
                      color: 'var(--text-strong)',
                      fontSize: 'var(--text-md)',
                    }}
                  >
                    {w.word}
                  </span>
                  {w.ipa && (
                    <span
                      style={{
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 'var(--text-sm)',
                      }}
                    >
                      {w.ipa}
                    </span>
                  )}
                </div>
                {w.meaningVi && (
                  <div style={{ color: 'var(--text-body)', fontSize: 'var(--text-sm)' }}>
                    {w.meaningVi}
                  </div>
                )}
                {w.definitionEn && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                    {w.definitionEn}
                  </div>
                )}
              </div>
              {isStaff && (
                <div className="lrow__actions">
                  <FIB
                    label={t('edit')}
                    size="sm"
                    onClick={() =>
                      setModal({
                        id: w.id,
                        word: w.word,
                        meaningVi: w.meaningVi,
                        definitionEn: w.definitionEn ?? '',
                        ipa: w.ipa ?? '',
                        imageKey: w.imageKey ?? '',
                      })
                    }
                  >
                    <MIcon name="edit" size={16} />
                  </FIB>
                  <FIB label={t('delete')} size="sm" onClick={() => del(w)}>
                    <MIcon name="trash" size={16} />
                  </FIB>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <FC>
          <Empty
            icon="book"
            title={t('fc_no_words')}
            sub={isStaff ? t('fc_no_words_sub') : undefined}
          />
        </FC>
      )}

      {modal && (
        <WordModal
          draft={modal}
          setDraft={setModal}
          onClose={() => setModal(null)}
          onSave={save}
          canUseAi={canUseAi}
        />
      )}
      {importing && (
        <ImportModal fetcher={fetcher} onClose={() => setImporting(false)} canUseAi={canUseAi} />
      )}
      {confirmNode}
    </>
  );
}

function WordModal({
  draft,
  setDraft,
  onClose,
  onSave,
  canUseAi,
}: {
  draft: WordDraft;
  setDraft: React.Dispatch<React.SetStateAction<WordDraft | null>>;
  onClose: () => void;
  onSave: (f: WordDraft) => void;
  canUseAi: boolean;
}) {
  const { t } = useLang();
  const [status, setStatus] = React.useState<'idle' | 'busy' | 'failed'>('idle');
  const [committing, setCommitting] = React.useState(false);
  // A word being edited already has its picture stored, so it seeds the strip as the selection.
  const [choice, setChoice] = React.useState<ImageChoice>(() => ({
    ...emptyChoice,
    picked: draft.imageKey ? { kind: 'stored', imageKey: draft.imageKey } : null,
  }));
  const lastFilled = React.useRef<string>(draft.id ? draft.word.trim().toLowerCase() : '');
  // Latest draft, readable inside the async debounce without re-triggering the
  // effect — lets us leave fields alone that the user has already filled in.
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const set = <K extends keyof WordDraft>(k: K, v: WordDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  // Auto-fill meaning / IPA / definition from Claude once the word field settles. Only fills
  // fields the user left empty, so manual edits win. Fires once per distinct word (`lastFilled`),
  // and never for an existing word until its spelling actually changes.
  React.useEffect(() => {
    if (!canUseAi) return;
    const w = draft.word.trim();
    const key = w.toLowerCase();
    if (!w || key === lastFilled.current) return;
    const handle = setTimeout(async () => {
      lastFilled.current = key;
      setStatus('busy');
      const res = await fetchEnrichedWords([
        { word: w, definitionEn: draftRef.current.definitionEn || null },
      ]);
      if (!res.ok) {
        setStatus('failed');
        return;
      }
      const hit = res.map.get(key);
      setStatus('idle');
      if (!hit) return;
      setDraft((d) =>
        d
          ? {
              ...d,
              meaningVi: d.meaningVi.trim() ? d.meaningVi : hit.meaningVi,
              ipa: d.ipa || hit.ipa || '',
              definitionEn: d.definitionEn || hit.definitionEn || '',
            }
          : d,
      );
    }, 500);
    return () => clearTimeout(handle);
  }, [draft.word, canUseAi, setDraft]);

  /** What the strip searches for: the word, narrowed by whatever definition is on screen. */
  const imageQuery = `${draft.word} ${draft.definitionEn}`.trim();

  // First batch once the word settles, so the strip is populated without the teacher asking. Only
  // for a word with no picture yet — an edit keeps showing what it was saved with until a search
  // is asked for, rather than jumping to a grid of alternatives.
  //
  // The query is read through a ref and the effect depends on the WORD alone. Depending on the
  // query itself meant the AI auto-fill landing a definition mid-debounce cleared the pending
  // timeout, so the search could be postponed indefinitely while the fields settled — the strip
  // just sat empty.
  const queryRef = React.useRef(imageQuery);
  queryRef.current = imageQuery;
  const searchedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    const w = draft.word.trim();
    if (!w || draft.imageKey || searchedFor.current === w) return;
    const handle = setTimeout(async () => {
      searchedFor.current = w;
      setChoice((c) => ({ ...c, status: 'loading' }));
      const patch = await loadChoice(queryRef.current || w);
      setChoice((c) => ({ ...c, ...patch }));
    }, 600);
    return () => clearTimeout(handle);
  }, [draft.word, draft.imageKey]);

  /**
   * Apply a strip change. Editing one word, so a stock pick is committed to our bucket right away:
   * the teacher leaves the dialog with a real stored picture rather than a provider thumbnail that
   * might not survive the copy. The highlight moves first so the tap feels instant, and is rolled
   * back if the copy fails.
   */
  const applyChoice = async (patch: Partial<ImageChoice>) => {
    setChoice((c) => ({ ...c, ...patch }));
    if (!('picked' in patch)) return;
    const next = patch.picked;
    if (!next) {
      set('imageKey', '');
      return;
    }
    if (next.kind === 'stored') {
      set('imageKey', next.imageKey);
      return;
    }
    setCommitting(true);
    const key = await resolvePickedImageKey(next);
    setCommitting(false);
    if (key) set('imageKey', key);
    else setChoice((c) => ({ ...c, picked: null, status: 'failed' }));
  };

  // Manual retry — an explicit user action, so it overwrites the meaning. The other two fields
  // are still only filled when blank: they are what the user would have edited by hand.
  const retryEnrich = async () => {
    const w = draft.word.trim();
    if (!w) return;
    setStatus('busy');
    const res = await fetchEnrichedWords([{ word: w, definitionEn: draft.definitionEn || null }]);
    if (!res.ok) {
      setStatus('failed');
      return;
    }
    const hit = res.map.get(w.toLowerCase());
    setStatus('idle');
    if (!hit) return;
    setDraft((d) =>
      d
        ? {
            ...d,
            meaningVi: hit.meaningVi || d.meaningVi,
            ipa: d.ipa || hit.ipa || '',
            definitionEn: d.definitionEn || hit.definitionEn || '',
          }
        : d,
    );
  };

  return (
    <>
      <Modal
        open={true}
        onClose={onClose}
        title={draft.id ? t('fc_edit_word') : t('fc_add_word')}
        width={520}
        footer={
          <>
            <FBtn variant="secondary" onClick={onClose}>
              {t('cancel')}
            </FBtn>
            <FBtn variant="primary" onClick={() => onSave(draft)}>
              {t('save')}
            </FBtn>
          </>
        }
      >
        <div className="mochi-field">
          <label className="mochi-field__label">{t('fc_word')}</label>
          <div className="m-row" style={{ gap: 8, alignItems: 'stretch' }}>
            <input
              className="mochi-input"
              autoFocus={true}
              style={{ flex: 1 }}
              value={draft.word}
              onChange={(e) => set('word', e.target.value)}
            />
            <FIB label={t('fc_play_audio')} size="md" onClick={() => playWord(draft.word)}>
              <MIcon name="volume" size={18} />
            </FIB>
          </div>
          {status !== 'idle' && (
            <span className="mochi-field__hint">
              {status === 'busy' ? t('fc_enriching') : t('fc_enrich_failed')}
            </span>
          )}
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('fc_meaning_vi')}</label>
          <div className="m-row" style={{ gap: 8, alignItems: 'stretch' }}>
            <input
              className="mochi-input"
              style={{ flex: 1 }}
              value={draft.meaningVi}
              onChange={(e) => set('meaningVi', e.target.value)}
            />
            {canUseAi && (
              <FIB
                label={t('fc_enrich')}
                size="md"
                disabled={!draft.word.trim() || status === 'busy'}
                onClick={retryEnrich}
              >
                <MIcon name="sparkle" size={18} />
              </FIB>
            )}
          </div>
        </div>
        <FInput
          label={t('fc_ipa')}
          value={draft.ipa}
          onChange={(e) => set('ipa', e.target.value)}
        />
        <div className="mochi-field">
          <label className="mochi-field__label">{t('fc_definition_en')}</label>
          <textarea
            className="mochi-input"
            rows={2}
            style={{ resize: 'vertical', minHeight: 56, paddingTop: 10 }}
            value={draft.definitionEn}
            onChange={(e) => set('definitionEn', e.target.value)}
          />
        </div>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('fc_img_label')}</label>
          <ImageStrip query={imageQuery} choice={choice} onChange={applyChoice} />
          <span className="mochi-field__hint">
            {committing
              ? t('fc_img_saving')
              : choice.picked
                ? t('fc_img_hint_selected')
                : t('fc_img_hint_none')}
          </span>
        </div>
      </Modal>
    </>
  );
}

// ---- Bulk import ----

type ImportRow = {
  word: string;
  meaningVi: string;
  ipa: string;
  definitionEn: string;
  include: boolean;
};

function ImportModal({
  fetcher,
  onClose,
  canUseAi,
}: {
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
  canUseAi: boolean;
}) {
  const { t } = useLang();
  const [step, setStep] = React.useState<'paste' | 'review'>('paste');
  const [text, setText] = React.useState('');
  const [rows, setRows] = React.useState<ImportRow[]>([]);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = React.useState(false);

  // Paste step → review. When AI is available, Claude fills the meaning, IPA and definition for
  // every pasted word first; a failure still advances to review, where the fields are editable by
  // hand (which is all the mobile client has ever offered).
  const runEnrich = async () => {
    const parsed = parseImportLines(text);
    if (parsed.length === 0) return;
    setFailed(false);
    let map: EnrichMap = new Map();
    if (canUseAi) {
      // One request per distinct word. Rows the user glossed inline (`word - nghĩa`) still get
      // their IPA and definition filled, so they are not skipped here.
      const seen = new Set<string>();
      const items: { word: string; definitionEn?: string | null }[] = [];
      for (const p of parsed) {
        const key = p.word.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ word: p.word });
      }
      setProgress({ done: 0, total: items.length });
      const res = await fetchEnrichedWords(items, (done, total) => setProgress({ done, total }));
      setProgress(null);
      if (res.ok) map = res.map;
      else setFailed(true);
    }

    setRows(
      parsed.map((p) => {
        const hit = map.get(p.word.toLowerCase());
        return {
          word: p.word,
          // A typed meaning always wins over the model's.
          meaningVi: p.meaningVi || hit?.meaningVi || '',
          ipa: hit?.ipa ?? '',
          definitionEn: hit?.definitionEn ?? '',
          include: true,
        };
      }),
    );
    setStep('review');
  };

  const setRow = (i: number, patch: Partial<ImportRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // Manual retry from the review step: fills every included row that is still missing a meaning.
  // Typed meanings are left alone; IPA and definition are filled only where blank.
  const enrichBlanks = async () => {
    const seen = new Set<string>();
    const items: { word: string; definitionEn?: string | null }[] = [];
    for (const r of rows) {
      const key = r.word.toLowerCase();
      if (!r.include || !r.word.trim() || r.meaningVi.trim() || seen.has(key)) continue;
      seen.add(key);
      items.push({ word: r.word, definitionEn: r.definitionEn || null });
    }
    if (items.length === 0) return;
    setFailed(false);
    setProgress({ done: 0, total: items.length });
    const res = await fetchEnrichedWords(items, (done, total) => setProgress({ done, total }));
    setProgress(null);
    if (!res.ok) {
      setFailed(true);
      return;
    }
    setRows((rs) =>
      rs.map((r) => {
        if (r.meaningVi.trim()) return r;
        const hit = res.map.get(r.word.toLowerCase());
        if (!hit) return r;
        return {
          ...r,
          meaningVi: hit.meaningVi,
          ipa: r.ipa || hit.ipa || '',
          definitionEn: r.definitionEn || hit.definitionEn || '',
        };
      }),
    );
  };

  const blanksCount = rows.filter((r) => r.include && r.word.trim() && !r.meaningVi.trim()).length;

  const submit = () => {
    const words = rows
      .filter((r) => r.include && r.word.trim())
      .map((r) => ({
        word: r.word.trim(),
        meaningVi: r.meaningVi.trim(),
        ipa: r.ipa || null,
        definitionEn: r.definitionEn || null,
      }));
    if (words.length === 0) return;
    const fd = new FormData();
    fd.set('intent', 'words-import');
    fd.set('words', JSON.stringify(words));
    fetcher.submit(fd, { method: 'post' });
    onClose();
  };

  const readyCount = rows.filter((r) => r.include && r.word.trim()).length;

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t('fc_import_title')}
      width={640}
      footer={
        step === 'paste' ? (
          <>
            <FBtn variant="secondary" onClick={onClose}>
              {t('cancel')}
            </FBtn>
            <FBtn variant="primary" disabled={!text.trim() || !!progress} onClick={runEnrich}>
              {progress
                ? `${progress.done}/${progress.total}`
                : canUseAi
                  ? t('fc_enrich')
                  : t('fc_review')}
            </FBtn>
          </>
        ) : (
          <>
            <FBtn variant="secondary" onClick={() => setStep('paste')}>
              {t('cancel')}
            </FBtn>
            {canUseAi && (
              <FBtn
                variant="secondary"
                iconLeft={<MIcon name="sparkle" size={16} />}
                disabled={!!progress || blanksCount === 0}
                onClick={enrichBlanks}
              >
                {progress ? `${progress.done}/${progress.total}` : t('fc_enrich_blanks')}
              </FBtn>
            )}
            <FBtn variant="primary" disabled={readyCount === 0} onClick={submit}>
              {t('fc_import_n', { n: readyCount })}
            </FBtn>
          </>
        )
      }
    >
      {step === 'paste' ? (
        <div className="mochi-field">
          <label className="mochi-field__label">{t('fc_import')}</label>
          <textarea
            className="mochi-input"
            rows={10}
            autoFocus={true}
            style={{ resize: 'vertical', minHeight: 200, paddingTop: 10 }}
            placeholder={t('fc_import_hint')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <span className="mochi-field__hint">{t('fc_import_hint')}</span>
          {failed && (
            <span className="mochi-field__hint" style={{ color: 'var(--red-600, #c0392b)' }}>
              {t('fc_enrich_failed')}
            </span>
          )}
        </div>
      ) : (
        <div className="m-stack" style={{ gap: 8 }}>
          {failed && (
            <span className="mochi-field__hint" style={{ color: 'var(--red-600, #c0392b)' }}>
              {t('fc_enrich_failed')}
            </span>
          )}
          {rows.map((r, i) => (
            <div
              key={i}
              className="lrow"
              style={{ alignItems: 'center', gap: 10, opacity: r.include ? 1 : 0.5 }}
            >
              <FCheck
                checked={r.include}
                onChange={(e) => setRow(i, { include: e.target.checked })}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="m-row" style={{ gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{r.word}</span>
                  {r.ipa && (
                    <span
                      style={{
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 'var(--text-sm)',
                      }}
                    >
                      {r.ipa}
                    </span>
                  )}
                </div>
                {r.definitionEn && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                    {r.definitionEn}
                  </div>
                )}
                <input
                  className="mochi-input"
                  style={{ marginTop: 4 }}
                  placeholder={t('fc_meaning_vi')}
                  value={r.meaningVi}
                  onChange={(e) => setRow(i, { meaningVi: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ---- Results tab ----

function ResultsTab({ results }: { results: FlashcardResultRow[] }) {
  const { t } = useLang();

  const leaderboard = React.useMemo(() => {
    const best = new Map<string, { name: string; color: string; pct: number }>();
    for (const r of results) {
      if (r.isStaff) continue; // leaderboard is a student competition
      const pct = Math.round((r.score * 100) / r.total);
      const cur = best.get(r.playerId);
      if (!cur || pct > cur.pct) {
        best.set(r.playerId, { name: r.playerName, color: r.playerColor, pct });
      }
    }
    return Array.from(best.values())
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 10);
  }, [results]);

  if (results.length === 0) {
    return (
      <FC>
        <Empty icon="chart" title={t('fc_no_results')} />
      </FC>
    );
  }

  return (
    <div className="m-grid cols-2" style={{ gap: 16, alignItems: 'start' }}>
      <FC style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{t('fc_recent_plays')}</div>
        <div className="m-stack" style={{ gap: 8 }}>
          {results.map((r) => (
            <div key={r.id} className="lrow" style={{ alignItems: 'center', gap: 10 }}>
              <FAv name={r.playerName} color={r.playerColor} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-strong)' }}>
                  {r.playerName}
                  {r.isStaff && (
                    <FBadge color="orange" style={{ marginLeft: 8 }}>
                      {t('fc_staff_badge')}
                    </FBadge>
                  )}
                </div>
                <div className="lrow__meta">
                  <FBadge color="violet">{t(`fc_mode_${r.mode}`)}</FBadge>
                  <span>
                    {r.score}/{r.total} · {Math.round((r.score * 100) / r.total)}%
                  </span>
                  {r.durationMs != null && <span>{fmtDuration(r.durationMs)}</span>}
                  <span>
                    {new Date(r.playedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </FC>

      <FC style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{t('fc_leaderboard')}</div>
        <div className="m-stack" style={{ gap: 8 }}>
          {leaderboard.map((s, i) => (
            <div key={i} className="lrow" style={{ alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 700, color: 'var(--text-muted)', width: 20 }}>
                {i + 1}
              </span>
              <FAv name={s.name} color={s.color} size="sm" />
              <div style={{ flex: 1, fontWeight: 600, color: 'var(--text-strong)' }}>{s.name}</div>
              <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{s.pct}%</span>
            </div>
          ))}
        </div>
      </FC>
    </div>
  );
}

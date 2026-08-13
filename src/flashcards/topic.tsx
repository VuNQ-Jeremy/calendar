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
  wordsWithIpa,
  stressEligible,
  wordsWithExamples,
  parseModes,
  ROUND_SIZES,
  DEFAULT_ROUND_SIZE,
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
import { IpaGame } from './game-ipa.jsx';
import { StressGame } from './game-stress.jsx';
import { ClozeGame } from './game-cloze.jsx';
import { ListenGame } from './game-listen.jsx';
import { PronounceGame } from './game-pronounce.jsx';
import { MixGame } from './game-mix.jsx';
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
  /** The earliest-deadline open assignment for this topic, or null. Pins the round size and mix pool. */
  assignment: { questionCount: number | null; modes: string | null } | null;
  /** ICT today, from the server. Decides which words `?review=1` plays. */
  today: string;
};

const MODE_META: {
  id: GameMode;
  tk: string;
  icon:
    | 'cards'
    | 'grid'
    | 'check'
    | 'shuffle'
    | 'edit'
    | 'keyboard'
    | 'image'
    | 'audioLines'
    | 'zap'
    | 'quote'
    | 'headphones'
    | 'mic'
    | 'dices';
}[] = [
  { id: 'flip', tk: 'fc_mode_flip', icon: 'cards' },
  { id: 'quiz', tk: 'fc_mode_quiz', icon: 'check' },
  { id: 'match', tk: 'fc_mode_match', icon: 'grid' },
  { id: 'scramble', tk: 'fc_mode_scramble', icon: 'shuffle' },
  { id: 'fill', tk: 'fc_mode_fill', icon: 'edit' },
  { id: 'type', tk: 'fc_mode_type', icon: 'keyboard' },
  { id: 'picture', tk: 'fc_mode_picture', icon: 'image' },
  { id: 'ipa', tk: 'fc_mode_ipa', icon: 'audioLines' },
  { id: 'stress', tk: 'fc_mode_stress', icon: 'zap' },
  { id: 'cloze', tk: 'fc_mode_cloze', icon: 'quote' },
  { id: 'listen', tk: 'fc_mode_listen', icon: 'headphones' },
  { id: 'pronounce', tk: 'fc_mode_pronounce', icon: 'mic' },
  { id: 'mix', tk: 'fc_mode_mix', icon: 'dices' },
];

export function FlashcardTopicScreen() {
  const { topic, words, results, mastery, kind, canUseAi, assignment, today } =
    useLoaderData() as LoaderData;
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

  // Round size: an open assignment for this topic pins it (and hides the picker); otherwise the
  // student picks 10/15/20 in free study. Every mode but flip honours it.
  const pinnedRoundSize = kind === 'student' ? (assignment?.questionCount ?? null) : null;
  const [pickedRoundSize, setPickedRoundSize] = React.useState<number>(DEFAULT_ROUND_SIZE);
  const roundSize = pinnedRoundSize ?? pickedRoundSize;
  const allowedModes = React.useMemo(() => parseModes(assignment?.modes), [assignment]);

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
          <QuizGame
            words={deck}
            roundSize={roundSize}
            onExit={exit}
            onFinish={finish}
            garden={roundGarden}
          />
        )}
        {playing === 'match' && (
          <MatchGame
            words={deck}
            roundSize={roundSize}
            onExit={exit}
            onFinish={finish}
            garden={roundGarden}
          />
        )}
        {playing === 'scramble' && (
          <ScrambleGame
            words={deck}
            roundSize={roundSize}
            onExit={exit}
            onFinish={finish}
            garden={roundGarden}
          />
        )}
        {playing === 'fill' && (
          <FillGame
            words={deck}
            roundSize={roundSize}
            onExit={exit}
            onFinish={finish}
            garden={roundGarden}
          />
        )}
        {playing === 'type' && (
          <TypeGame
            words={deck}
            roundSize={roundSize}
            onExit={exit}
            onFinish={finish}
            garden={roundGarden}
          />
        )}
        {playing === 'picture' && (
          <PictureGame
            words={deck}
            roundSize={roundSize}
            onExit={exit}
            onFinish={finish}
            garden={roundGarden}
          />
        )}
        {playing === 'ipa' && (
          <IpaGame
            words={deck}
            roundSize={roundSize}
            onExit={exit}
            onFinish={finish}
            garden={roundGarden}
          />
        )}
        {playing === 'stress' && (
          <StressGame
            words={deck}
            roundSize={roundSize}
            onExit={exit}
            onFinish={finish}
            garden={roundGarden}
          />
        )}
        {playing === 'cloze' && (
          <ClozeGame
            words={deck}
            roundSize={roundSize}
            onExit={exit}
            onFinish={finish}
            garden={roundGarden}
          />
        )}
        {playing === 'listen' && (
          <ListenGame
            words={deck}
            roundSize={roundSize}
            onExit={exit}
            onFinish={finish}
            garden={roundGarden}
          />
        )}
        {playing === 'pronounce' && (
          <PronounceGame
            words={deck}
            roundSize={roundSize}
            onExit={exit}
            onFinish={finish}
            garden={roundGarden}
          />
        )}
        {playing === 'mix' && (
          <MixGame
            words={deck}
            roundSize={roundSize}
            allowedModes={allowedModes}
            onExit={exit}
            onFinish={finish}
            garden={roundGarden}
          />
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

      {kind === 'student' && (
        <div className="m-row" style={{ gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: 'var(--text-muted)' }}>{t('fc_round_size')}:</span>
          {pinnedRoundSize ? (
            <span className="mochi-field__hint">
              {t('fc_round_size_assigned', { n: pinnedRoundSize })}
            </span>
          ) : (
            ROUND_SIZES.map((n) => (
              <FBtn
                key={n}
                variant={pickedRoundSize === n ? 'primary' : 'soft'}
                onClick={() => setPickedRoundSize(n)}
              >
                {n}
              </FBtn>
            ))
          )}
        </div>
      )}

      <div className="m-row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        {MODE_META.map((m) => {
          // Beyond the word-count floor: type needs a word whose hint isn't the answer, picture
          // needs an imaged word, ipa/stress need IPA data, cloze/listen need example sentences.
          const disabled =
            deck.length < MIN_WORDS[m.id] ||
            (m.id === 'type' && !deck.some(typeEligible)) ||
            (m.id === 'picture' && wordsWithImages(deck).length === 0) ||
            (m.id === 'ipa' && wordsWithIpa(deck).length === 0) ||
            (m.id === 'stress' && !deck.some(stressEligible)) ||
            ((m.id === 'cloze' || m.id === 'listen') && wordsWithExamples(deck).length === 0);
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
                    : m.id === 'ipa' && deck.length >= MIN_WORDS.ipa
                      ? t('fc_ipa_none')
                      : m.id === 'stress'
                        ? t('fc_stress_none')
                        : (m.id === 'cloze' || m.id === 'listen') && deck.length >= MIN_WORDS[m.id]
                          ? t('fc_sentence_none')
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
  exampleEn: string;
  exampleAnswer: string;
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
    fd.set('exampleEn', f.exampleEn);
    fd.set('exampleAnswer', f.exampleAnswer);
    // '' clears the picture: preprocessWord in the route turns it into null.
    fd.set('imageKey', f.imageKey);
    fetcher.submit(fd, { method: 'post' });
    setModal(null);
  };

  const missingExamples = words.filter((w) => !w.exampleEn);
  const [exProgress, setExProgress] = React.useState<{ done: number; total: number } | null>(null);

  const genExamples = async () => {
    setExProgress({ done: 0, total: missingExamples.length });
    const res = await fetchEnrichedWords(
      missingExamples.map((w) => ({ word: w.word, definitionEn: w.definitionEn })),
      (done, total) => setExProgress({ done, total }),
    );
    setExProgress(null);
    if (!res.ok) return;
    const items = missingExamples.flatMap((w) => {
      const hit = res.map.get(w.word.trim().toLowerCase());
      return hit?.exampleEn && hit.exampleAnswer
        ? [{ id: w.id, exampleEn: hit.exampleEn, exampleAnswer: hit.exampleAnswer }]
        : [];
    });
    if (!items.length) return;
    const fd = new FormData();
    fd.set('intent', 'words-example-fill');
    fd.set('items', JSON.stringify(items));
    fetcher.submit(fd, { method: 'post' });
  };

  return (
    <>
      {isStaff && (
        <div className="m-row" style={{ gap: 10, margin: '4px 0 14px', flexWrap: 'wrap' }}>
          <FBtn
            variant="primary"
            iconLeft={<MIcon name="plus" size={18} />}
            onClick={() =>
              setModal({
                word: '',
                meaningVi: '',
                definitionEn: '',
                ipa: '',
                exampleEn: '',
                exampleAnswer: '',
                imageKey: '',
              })
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
          {canUseAi && (
            <FBtn
              variant="secondary"
              iconLeft={<MIcon name="sparkle" size={18} />}
              disabled={missingExamples.length === 0 || !!exProgress}
              onClick={genExamples}
            >
              {exProgress ? `${exProgress.done}/${exProgress.total}` : t('fc_gen_examples')}
            </FBtn>
          )}
        </div>
      )}

      {words.length ? (
        <div className="fc-wgrid">
          {words.map((w) => (
            <div key={w.id} className="fc-wcard">
              <div className="fc-wcard__top">
                <div className="fc-wcard__pic">
                  {w.imageKey ? (
                    <img src={flashcardImagePath(w.imageKey) ?? undefined} alt="" loading="lazy" />
                  ) : (
                    <MIcon name="image" size={28} />
                  )}
                </div>
                <div className="fc-wcard__tools">
                  <FIB label={t('fc_play_audio')} size="sm" onClick={() => playWord(w.word)}>
                    <MIcon name="volume" size={18} />
                  </FIB>
                  {isStaff && (
                    <>
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
                            exampleEn: w.exampleEn ?? '',
                            exampleAnswer: w.exampleAnswer ?? '',
                            imageKey: w.imageKey ?? '',
                          })
                        }
                      >
                        <MIcon name="edit" size={16} />
                      </FIB>
                      <FIB label={t('delete')} size="sm" onClick={() => del(w)}>
                        <MIcon name="trash" size={16} />
                      </FIB>
                    </>
                  )}
                </div>
              </div>
              <div className="fc-wcard__head">
                <span className="fc-wcard__word">{w.word}</span>
                {w.ipa && <span className="fc-wcard__ipa">{w.ipa}</span>}
              </div>
              {(w.meaningVi || w.definitionEn) && (
                <div>
                  {w.meaningVi && <div className="fc-wcard__vi">{w.meaningVi}</div>}
                  {w.definitionEn && <div className="fc-wcard__en">{w.definitionEn}</div>}
                </div>
              )}
              {w.exampleEn && (
                <div
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: 'var(--text-sm)',
                    fontStyle: 'italic',
                  }}
                >
                  {w.exampleEn}
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
  // A word being edited already has its picture stored, so it seeds the picker as the selection.
  const [choice, setChoice] = React.useState<ImageChoice>(() => ({
    ...emptyChoice,
    picked: draft.imageKey ? { kind: 'stored', imageKey: draft.imageKey } : null,
  }));
  // The picture the word came in with — read once, since a pick overwrites `draft.imageKey`
  // immediately. The picker keeps a cell for it, so trying a candidate is undoable until save.
  const originalImageKey = React.useRef(draft.imageKey || null).current;
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
              exampleEn: d.exampleEn || hit.exampleEn || '',
              exampleAnswer: d.exampleAnswer || hit.exampleAnswer || '',
            }
          : d,
      );
    }, 500);
    return () => clearTimeout(handle);
  }, [draft.word, canUseAi, setDraft]);

  /**
   * What the picker searches for: the word, and ONLY the word.
   *
   * It used to append the English definition to "narrow" the search, and that did the opposite.
   * Pixabay finds nearly nothing matching a whole sentence, so it switches to fuzzy per-word
   * matching — "teacher a person who teaches students in a school" came back as teacups and
   * garden photos, where bare "teacher" returns exactly what it says. Disambiguating a homograph
   * is what the grid of nine alternatives is for.
   */
  const imageQuery = draft.word.trim();

  // First batch once the word settles, so the picker is populated without the teacher asking. A
  // word that already has a picture searches too: its own picture holds the first cell whatever
  // comes back, so alternatives beside it cost nothing — and the other eight cells would otherwise
  // sit empty for a teacher who opened the dialog precisely to change the picture.
  const searchedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    const w = draft.word.trim();
    if (!w || searchedFor.current === w) return;
    const handle = setTimeout(async () => {
      searchedFor.current = w;
      setChoice((c) => ({ ...c, status: 'loading' }));
      const patch = await loadChoice(w);
      setChoice((c) => ({ ...c, ...patch }));
    }, 600);
    return () => clearTimeout(handle);
  }, [draft.word]);

  /**
   * Serialises the commits below. Copying a stock picture is a multi-hop round trip — ask the
   * provider for the real URL, fetch the bytes, write them to R2 — so two picks made a moment apart
   * can answer out of order, and the loser used to win: pick a picture, hit refresh, pick another,
   * and whichever copy finished last decided what the word was saved with.
   */
  const commitSeq = React.useRef(0);
  /** The copy currently in flight, if any. Save awaits this rather than racing it. */
  const pendingCommit = React.useRef<Promise<void> | null>(null);
  /**
   * `draft.imageKey`, readable synchronously. The commit below finishes inside an awaited promise,
   * and the React re-render that would refresh `draftRef` hasn't happened yet at that moment — so
   * a Save that just awaited the commit would still post the OLD draft. This ref is written in the
   * same breath as `set('imageKey', …)` and is what Save actually sends.
   */
  const imageKeyRef = React.useRef(draft.imageKey);
  const setImageKey = (k: string) => {
    imageKeyRef.current = k;
    set('imageKey', k);
  };
  const [saving, setSaving] = React.useState(false);

  /**
   * Apply a picker change. Editing one word, so a stock pick is committed to our bucket right away:
   * the teacher leaves the dialog with a real stored picture rather than a provider thumbnail that
   * might not survive the copy. The highlight moves first so the tap feels instant, and is rolled
   * back if the copy fails.
   *
   * Every pick — including clearing one — takes a ticket, and a commit that comes back holding a
   * stale ticket is dropped on the floor. `imageKey` therefore always describes the LAST cell the
   * teacher tapped, which is the only thing Save can honestly write.
   */
  const applyChoice = (patch: Partial<ImageChoice>) => {
    setChoice((c) => ({ ...c, ...patch }));
    if (!('picked' in patch)) return;
    const ticket = ++commitSeq.current;
    const next = patch.picked;
    if (!next) {
      setImageKey('');
      return;
    }
    if (next.kind === 'stored') {
      setImageKey(next.imageKey);
      return;
    }
    // Stored in the ref BEFORE the first await, so a Save clicked in the very next tick already
    // has something to wait on.
    pendingCommit.current = (async () => {
      const key = await resolvePickedImageKey(next);
      // Superseded while the bytes were in flight: the newer pick owns the draft now.
      if (ticket !== commitSeq.current) return;
      if (key) setImageKey(key);
      else {
        // A copy that failed leaves the word with NO picture. Leaving the previous key in place is
        // what let a failed pick save the picture chosen before it, with nothing outlined to say so.
        setImageKey('');
        setChoice((c) => ({ ...c, picked: null, status: 'failed' }));
      }
    })();
  };

  /**
   * Save, but never mid-copy. Tapping a picture and hitting Save inside the second or two its copy
   * takes used to post the draft with whatever key had landed EARLIER — the pre-refresh picture,
   * outlined nowhere. Waiting costs at most that same second or two, with the button disabled so
   * the pause is visible rather than mysterious.
   */
  const save = async () => {
    setSaving(true);
    await pendingCommit.current;
    onSave({ ...draftRef.current, imageKey: imageKeyRef.current });
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
            exampleEn: d.exampleEn || hit.exampleEn || '',
            exampleAnswer: d.exampleAnswer || hit.exampleAnswer || '',
          }
        : d,
    );
  };

  // Keep the surface form in sync while the sentence contains the plain word; a form the teacher
  // typed by hand that no longer matches (an inflection, or the word edited away) is left alone.
  const setExampleEn = (v: string) => {
    const idx = v.toLowerCase().indexOf(draft.word.trim().toLowerCase());
    const auto = idx >= 0 ? v.slice(idx, idx + draft.word.trim().length) : draft.exampleAnswer;
    setDraft((d) => (d ? { ...d, exampleEn: v, exampleAnswer: auto } : d));
  };
  const exampleMissing =
    draft.exampleEn.trim() !== '' &&
    (draft.exampleAnswer.trim() === '' ||
      !draft.exampleEn.toLowerCase().includes(draft.exampleAnswer.trim().toLowerCase()));

  return (
    <>
      <Modal
        open={true}
        onClose={onClose}
        title={draft.id ? t('fc_edit_word') : t('fc_add_word')}
        width={760}
        footer={
          <>
            <FBtn variant="secondary" onClick={onClose}>
              {t('cancel')}
            </FBtn>
            <FBtn variant="primary" disabled={saving} onClick={save}>
              {saving ? t('fc_img_saving') : t('save')}
            </FBtn>
          </>
        }
      >
        {/* Fields on the left, the picture picker on the right: the 3×3 batch is worth its own
            column, and the word it belongs to stays on screen while the teacher scans it. */}
        <div className="fc-word-split">
          <div className="fc-word-split__fields">
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
              <label className="mochi-field__label">{t('fc_example_en')}</label>
              <textarea
                className="mochi-input"
                rows={2}
                style={{ resize: 'vertical', minHeight: 56, paddingTop: 10 }}
                value={draft.exampleEn}
                onChange={(e) => setExampleEn(e.target.value)}
              />
              {exampleMissing && (
                <span className="mochi-field__hint">{t('fc_example_missing')}</span>
              )}
            </div>
            <FInput
              label={t('fc_example_answer')}
              value={draft.exampleAnswer}
              onChange={(e) => set('exampleAnswer', e.target.value)}
            />
          </div>
          <div className="mochi-field fc-word-split__pics">
            <label className="mochi-field__label">{t('fc_img_label')}</label>
            <ImageStrip
              query={imageQuery}
              choice={choice}
              onChange={applyChoice}
              layout="grid"
              originalImageKey={originalImageKey}
            />
          </div>
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
  exampleEn: string;
  exampleAnswer: string;
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
          exampleEn: hit?.exampleEn ?? '',
          exampleAnswer: hit?.exampleAnswer ?? '',
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
          exampleEn: r.exampleEn || hit.exampleEn || '',
          exampleAnswer: r.exampleAnswer || hit.exampleAnswer || '',
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
        exampleEn: r.exampleEn || null,
        exampleAnswer: r.exampleAnswer || null,
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

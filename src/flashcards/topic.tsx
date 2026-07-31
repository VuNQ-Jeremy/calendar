import React from 'react';
import { useLoaderData, useFetcher, useNavigate } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect, PageHeader, Empty, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { fetchDictEntry, fetchDictEntries } from '../lib/dictionary.js';
import { fetchTranslations } from '../lib/translate-client.js';
import { fetchGeneratedWords } from '../lib/generate-client.js';
import { VOCAB_TOPICS, vocabTopicLabel } from '../../shared/logic/vocab-topics';
import { playWord } from './audio.js';
import { MIN_WORDS, fmtDuration, parseImportLines } from './game-utils.js';
import type { GameMode, GameResult } from './game-utils.js';
import { orderWordsByMastery } from '../../shared/logic/flashcards';
import { FlipGame } from './game-flip.jsx';
import { QuizGame } from './game-quiz.jsx';
import { MatchGame } from './game-match.jsx';
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
  canTranslate: boolean;
};

const MODE_META: { id: GameMode; tk: string; icon: 'cards' | 'grid' | 'check' }[] = [
  { id: 'flip', tk: 'fc_mode_flip', icon: 'cards' },
  { id: 'quiz', tk: 'fc_mode_quiz', icon: 'check' },
  { id: 'match', tk: 'fc_mode_match', icon: 'grid' },
];

export function FlashcardTopicScreen() {
  const { topic, words, results, mastery, kind, canTranslate } = useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const { t } = useLang();
  const fetcher = useFetcher();
  const resultFetcher = useFetcher();
  const [tab, setTab] = React.useState('words');
  const [playing, setPlaying] = React.useState<GameMode | null>(null);
  const isStaff = kind === 'staff';

  // Flip mode prioritizes words the student answered wrong most often, then words not seen for
  // the longest. Students with no history (or staff preview) get a plain shuffle. The comparison
  // moved to shared/logic/flashcards.ts in phase 3 so mobile orders cards identically.
  const orderedWords = React.useMemo(
    () => orderWordsByMastery(words, kind === 'student' ? mastery : []),
    [words, mastery, kind],
  );

  const finish = (r: GameResult) => {
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
        {playing === 'flip' && <FlipGame words={orderedWords} onExit={exit} onFinish={finish} />}
        {playing === 'quiz' && <QuizGame words={words} onExit={exit} onFinish={finish} />}
        {playing === 'match' && <MatchGame words={words} onExit={exit} onFinish={finish} />}
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

      <div className="m-row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        {MODE_META.map((m) => {
          const disabled = words.length < MIN_WORDS[m.id];
          return (
            <FBtn
              key={m.id}
              variant="soft"
              iconLeft={<MIcon name={m.icon} size={18} />}
              disabled={disabled}
              title={disabled ? t('fc_min_words', { n: MIN_WORDS[m.id] }) : undefined}
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
        <WordsTab words={words} isStaff={isStaff} fetcher={fetcher} canTranslate={canTranslate} />
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
  audioUrl: string;
}

function WordsTab({
  words,
  isStaff,
  fetcher,
  canTranslate,
}: {
  words: FlashcardWordRow[];
  isStaff: boolean;
  fetcher: ReturnType<typeof useFetcher>;
  canTranslate: boolean;
}) {
  const { t } = useLang();
  const [modal, setModal] = React.useState<WordDraft | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
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
    fd.set('audioUrl', f.audioUrl);
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
              setModal({ word: '', meaningVi: '', definitionEn: '', ipa: '', audioUrl: '' })
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
          {canTranslate && (
            <FBtn
              variant="secondary"
              iconLeft={<MIcon name="sparkle" size={18} />}
              onClick={() => setGenerating(true)}
            >
              {t('fc_gen_btn')}
            </FBtn>
          )}
        </div>
      )}

      {words.length ? (
        <div className="m-stack">
          {words.map((w) => (
            <div key={w.id} className="lrow" style={{ alignItems: 'flex-start' }}>
              <FIB label={t('fc_play_audio')} size="sm" onClick={() => playWord(w.word, w.audioUrl)}>
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
                        audioUrl: w.audioUrl ?? '',
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
          canTranslate={canTranslate}
        />
      )}
      {importing && (
        <ImportModal
          fetcher={fetcher}
          onClose={() => setImporting(false)}
          canTranslate={canTranslate}
        />
      )}
      {generating && (
        <GenerateModal
          fetcher={fetcher}
          onClose={() => setGenerating(false)}
          existingWords={words.map((w) => w.word)}
        />
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
  canTranslate,
}: {
  draft: WordDraft;
  setDraft: React.Dispatch<React.SetStateAction<WordDraft | null>>;
  onClose: () => void;
  onSave: (f: WordDraft) => void;
  canTranslate: boolean;
}) {
  const { t } = useLang();
  const [status, setStatus] = React.useState<
    'idle' | 'fetching' | 'found' | 'notfound' | 'translating'
  >('idle');
  const lastFetched = React.useRef<string>(draft.id ? draft.word.trim().toLowerCase() : '');
  // Latest draft, readable inside the async debounce without re-triggering the
  // effect — lets us skip AI translation when the user already typed a meaning.
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const set = <K extends keyof WordDraft>(k: K, v: WordDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  // Auto-fill IPA / definition / audio from the dictionary when the word field
  // settles, then (if enabled) AI-translate the Vietnamese meaning. Only fills
  // fields the user left empty, so manual edits win.
  React.useEffect(() => {
    const w = draft.word.trim().toLowerCase();
    if (!w || w === lastFetched.current) return;
    const handle = setTimeout(async () => {
      lastFetched.current = w;
      setStatus('fetching');
      const entry = await fetchDictEntry(w);
      if (entry) {
        setStatus('found');
        setDraft((d) =>
          d
            ? {
                ...d,
                ipa: d.ipa || entry.ipa || '',
                audioUrl: d.audioUrl || entry.audioUrl || '',
                definitionEn: d.definitionEn || entry.definition || '',
              }
            : d,
        );
      } else {
        setStatus('notfound');
      }
      // AI translation — fill the meaning only when the user hasn't typed one.
      // Runs even when the dictionary found nothing (Claude can translate names
      // and simple words dictionaryapi.dev doesn't know).
      if (canTranslate && !draftRef.current.meaningVi.trim()) {
        const dictStatus = entry ? 'found' : 'notfound';
        setStatus('translating');
        const map = await fetchTranslations([{ word: w, definitionEn: entry?.definition ?? null }]);
        const vi = map.get(w);
        if (vi) setDraft((d) => (d && !d.meaningVi.trim() ? { ...d, meaningVi: vi } : d));
        setStatus(dictStatus);
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [draft.word, canTranslate, setDraft]);

  // Manual retry — an explicit user action, so it overwrites the field.
  const retryTranslate = async () => {
    const w = draft.word.trim().toLowerCase();
    if (!w) return;
    setStatus('translating');
    const map = await fetchTranslations([{ word: w, definitionEn: draft.definitionEn || null }]);
    const vi = map.get(w);
    if (vi) set('meaningVi', vi);
    setStatus('idle');
  };

  return (
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
          <FIB
            label={t('fc_play_audio')}
            size="md"
            onClick={() => playWord(draft.word, draft.audioUrl)}
          >
            <MIcon name="volume" size={18} />
          </FIB>
        </div>
        {status !== 'idle' && (
          <span className="mochi-field__hint">
            {status === 'fetching'
              ? t('fc_fetching')
              : status === 'translating'
                ? t('fc_translating')
                : status === 'found'
                  ? t('fc_fetched')
                  : t('fc_not_found')}
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
          {canTranslate && (
            <FIB
              label={t('fc_translate')}
              size="md"
              disabled={!draft.word.trim() || status === 'translating'}
              onClick={retryTranslate}
            >
              <MIcon name="sparkle" size={18} />
            </FIB>
          )}
        </div>
      </div>
      <FInput label={t('fc_ipa')} value={draft.ipa} onChange={(e) => set('ipa', e.target.value)} />
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
    </Modal>
  );
}

// ---- Bulk import ----

type ImportRow = {
  word: string;
  meaningVi: string;
  ipa: string;
  definitionEn: string;
  audioUrl: string;
  found: boolean;
  include: boolean;
};

function ImportModal({
  fetcher,
  onClose,
  canTranslate,
}: {
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
  canTranslate: boolean;
}) {
  const { t } = useLang();
  const [step, setStep] = React.useState<'paste' | 'review'>('paste');
  const [text, setText] = React.useState('');
  const [rows, setRows] = React.useState<ImportRow[]>([]);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [translating, setTranslating] = React.useState(false);

  const runFetch = async () => {
    const parsed = parseImportLines(text);
    if (parsed.length === 0) return;
    const uniqueWords = Array.from(new Set(parsed.map((p) => p.word.toLowerCase())));
    setProgress({ done: 0, total: uniqueWords.length });
    const dict = await fetchDictEntries(uniqueWords, (done, total) => setProgress({ done, total }));
    setProgress(null);

    // AI-translate the rows the user didn't already gloss, in one batched call.
    // Typed meanings (from `word - nghĩa` lines) are never overwritten.
    let viMap = new Map<string, string>();
    if (canTranslate) {
      const seen = new Set<string>();
      const items: { word: string; definitionEn?: string | null }[] = [];
      for (const p of parsed) {
        const key = p.word.toLowerCase();
        if (p.meaningVi.trim() || seen.has(key)) continue;
        seen.add(key);
        items.push({ word: p.word, definitionEn: dict.get(key)?.definition ?? null });
      }
      if (items.length > 0) {
        setTranslating(true);
        viMap = await fetchTranslations(items);
        setTranslating(false);
      }
    }

    setRows(
      parsed.map((p) => {
        const key = p.word.toLowerCase();
        const entry = dict.get(key);
        return {
          word: p.word,
          meaningVi: p.meaningVi || viMap.get(key) || '',
          ipa: entry?.ipa ?? '',
          definitionEn: entry?.definition ?? '',
          audioUrl: entry?.audioUrl ?? '',
          found: !!entry,
          include: true,
        };
      }),
    );
    setStep('review');
  };

  const setRow = (i: number, patch: Partial<ImportRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // Manual (re)translate for the review step: fills every included row whose
  // meaning is still blank in one batched call. Typed meanings are left alone.
  const translateBlanks = async () => {
    const seen = new Set<string>();
    const items: { word: string; definitionEn?: string | null }[] = [];
    for (const r of rows) {
      const key = r.word.toLowerCase();
      if (!r.include || !r.word.trim() || r.meaningVi.trim() || seen.has(key)) continue;
      seen.add(key);
      items.push({ word: r.word, definitionEn: r.definitionEn || null });
    }
    if (items.length === 0) return;
    setTranslating(true);
    const map = await fetchTranslations(items);
    setTranslating(false);
    setRows((rs) =>
      rs.map((r) => {
        if (r.meaningVi.trim()) return r;
        const vi = map.get(r.word.toLowerCase());
        return vi ? { ...r, meaningVi: vi } : r;
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
        audioUrl: r.audioUrl || null,
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
            <FBtn
              variant="primary"
              disabled={!text.trim() || !!progress || translating}
              onClick={runFetch}
            >
              {progress
                ? `${progress.done}/${progress.total}`
                : translating
                  ? t('fc_translating')
                  : t('fc_fetch')}
            </FBtn>
          </>
        ) : (
          <>
            <FBtn variant="secondary" onClick={() => setStep('paste')}>
              {t('cancel')}
            </FBtn>
            {canTranslate && (
              <FBtn
                variant="secondary"
                iconLeft={<MIcon name="sparkle" size={16} />}
                disabled={translating || blanksCount === 0}
                onClick={translateBlanks}
              >
                {translating ? t('fc_translating') : t('fc_translate')}
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
        </div>
      ) : (
        <div className="m-stack" style={{ gap: 8 }}>
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
                  <span
                    style={{
                      fontSize: 'var(--text-xs, 11px)',
                      color: r.found ? 'var(--green-600, green)' : 'var(--text-muted)',
                    }}
                  >
                    {r.found ? t('fc_fetched') : t('fc_not_found')}
                  </span>
                </div>
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

// ---- AI generation ----

type GenRow = {
  word: string;
  meaningVi: string;
  definitionEn: string;
  ipa: string;
  include: boolean;
};

const GEN_LEVELS = ['any', 'beginner', 'intermediate', 'advanced'] as const;

/**
 * Pick a topic (curated list or free text) → let Claude propose words → review the list →
 * import the kept ones. The save reuses the `words-import` intent, so the topic route's
 * clientAction handles cache invalidation exactly as it does for a paste import.
 */
function GenerateModal({
  fetcher,
  onClose,
  existingWords,
}: {
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
  existingWords: string[];
}) {
  const { t, lang } = useLang();
  const [step, setStep] = React.useState<'setup' | 'review'>('setup');
  const [topicId, setTopicId] = React.useState('');
  const [customTopic, setCustomTopic] = React.useState('');
  const [count, setCount] = React.useState('20');
  const [level, setLevel] = React.useState<(typeof GEN_LEVELS)[number]>('any');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<GenRow[]>([]);

  // The model always gets the English name; `vi` labels are display only.
  const topic =
    topicId === 'custom'
      ? customTopic.trim()
      : (VOCAB_TOPICS.find((vt) => vt.id === topicId)?.en ?? '');

  const run = async () => {
    setBusy(true);
    setError(null);
    const res = await fetchGeneratedWords({
      topic,
      count: Math.min(Math.max(parseInt(count, 10) || 20, 1), 50),
      level: level === 'any' ? null : level,
      exclude: existingWords.slice(0, 500),
    });
    setBusy(false);
    if (!res.ok) {
      setError(t(res.error === 'disabled' ? 'fc_gen_disabled' : 'fc_gen_failed'));
      return;
    }
    if (res.words.length === 0) {
      setError(t('fc_gen_empty'));
      return;
    }
    setRows(
      res.words.map((w) => ({
        word: w.word,
        meaningVi: w.meaningVi,
        definitionEn: w.definitionEn ?? '',
        ipa: w.ipa ?? '',
        include: true,
      })),
    );
    setStep('review');
  };

  const setRow = (i: number, patch: Partial<GenRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const readyCount = rows.filter((r) => r.include && r.word.trim()).length;

  const submit = () => {
    const words = rows
      .filter((r) => r.include && r.word.trim())
      .map((r) => ({
        word: r.word.trim(),
        meaningVi: r.meaningVi.trim(),
        ipa: r.ipa.trim() || null,
        definitionEn: r.definitionEn.trim() || null,
        audioUrl: null,
      }));
    if (words.length === 0) return;
    const fd = new FormData();
    fd.set('intent', 'words-import');
    fd.set('words', JSON.stringify(words));
    fetcher.submit(fd, { method: 'post' });
    onClose();
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t('fc_gen_title')}
      width={640}
      footer={
        step === 'setup' ? (
          <>
            <FBtn variant="secondary" onClick={onClose}>
              {t('cancel')}
            </FBtn>
            <FBtn
              variant="primary"
              iconLeft={<MIcon name="sparkle" size={16} />}
              disabled={!topic || busy}
              onClick={run}
            >
              {busy ? t('fc_gen_running') : t('fc_gen_run')}
            </FBtn>
          </>
        ) : (
          <>
            <FBtn variant="secondary" onClick={() => setStep('setup')}>
              {t('cancel')}
            </FBtn>
            <FBtn variant="primary" disabled={readyCount === 0} onClick={submit}>
              {t('fc_gen_save', { n: readyCount })}
            </FBtn>
          </>
        )
      }
    >
      {step === 'setup' ? (
        <>
          <MSelect
            label={t('fc_gen_topic')}
            value={topicId}
            onChange={(v) => setTopicId(v)}
            options={[
              { value: '', label: t('fc_gen_topic_pick') },
              ...VOCAB_TOPICS.map((vt) => ({ value: vt.id, label: vocabTopicLabel(vt, lang) })),
              { value: 'custom', label: t('fc_gen_topic_custom') },
            ]}
            hint={t('fc_gen_hint')}
          />
          {topicId === 'custom' && (
            <FInput
              label={t('fc_gen_topic')}
              autoFocus={true}
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
            />
          )}
          <div className="m-grid cols-2" style={{ gap: 14 }}>
            <div className="mochi-field">
              <label className="mochi-field__label">{t('fc_gen_count')}</label>
              <input
                className="mochi-input"
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
            <MSelect
              label={t('fc_gen_level')}
              value={level}
              onChange={(v) => setLevel(v as (typeof GEN_LEVELS)[number])}
              options={GEN_LEVELS.map((l) => ({ value: l, label: t(`fc_gen_level_${l}`) }))}
            />
          </div>
          {busy && <span className="mochi-field__hint">{t('fc_gen_wait')}</span>}
          {error && (
            <span className="mochi-field__hint" style={{ color: 'var(--red-600, #c0392b)' }}>
              {error}
            </span>
          )}
        </>
      ) : (
        <div className="m-stack" style={{ gap: 8 }}>
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
              <span style={{ fontWeight: 700, color: 'var(--text-muted)', width: 20 }}>{i + 1}</span>
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

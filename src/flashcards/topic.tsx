import React from 'react';
import { useLoaderData, useFetcher, useNavigate } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, PageHeader, Empty, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { fetchDictEntry, fetchDictEntries } from '../lib/dictionary.js';
import { playWord } from './audio.js';
import { shuffle, fmtDuration } from './game-utils.js';
import type { GameMode, GameResult } from './game-utils.js';
import { FlipGame } from './game-flip.jsx';
import { QuizGame } from './game-quiz.jsx';
import { MatchGame } from './game-match.jsx';
import type {
  FlashcardWordRow,
  FlashcardResultRow,
  MasteryRow,
} from '../../server/services/flashcards.js';

const { Card: FC, Button: FBtn, IconButton: FIB, Input: FInput, Avatar: FAv, Badge: FBadge } = DS;

type TopicInfo = { id: string; name: string; description: string | null; color: string };
type LoaderData = {
  topic: TopicInfo;
  words: FlashcardWordRow[];
  results: FlashcardResultRow[];
  mastery: MasteryRow[];
  kind: 'staff' | 'student';
};

const MIN_WORDS: Record<GameMode, number> = { flip: 1, quiz: 4, match: 3 };

const MODE_META: { id: GameMode; tk: string; icon: 'cards' | 'grid' | 'check' }[] = [
  { id: 'flip', tk: 'fc_mode_flip', icon: 'cards' },
  { id: 'quiz', tk: 'fc_mode_quiz', icon: 'check' },
  { id: 'match', tk: 'fc_mode_match', icon: 'grid' },
];

export function FlashcardTopicScreen() {
  const { topic, words, results, mastery, kind } = useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const { t } = useLang();
  const fetcher = useFetcher();
  const resultFetcher = useFetcher();
  const [tab, setTab] = React.useState('words');
  const [playing, setPlaying] = React.useState<GameMode | null>(null);
  const isStaff = kind === 'staff';

  // Flip mode prioritizes words the student answered wrong most often, then
  // words not seen for the longest. Students with no history (or staff preview)
  // get a plain shuffle.
  const orderedWords = React.useMemo(() => {
    if (kind !== 'student' || mastery.length === 0) return shuffle(words);
    const by = new Map(mastery.map((m) => [m.wordId, m]));
    const ratio = (m?: MasteryRow) => (m ? m.wrong / Math.max(1, m.correct + m.wrong) : 0);
    return words.slice().sort((a, b) => {
      const ra = ratio(by.get(a.id));
      const rb = ratio(by.get(b.id));
      if (rb !== ra) return rb - ra;
      const la = by.get(a.id)?.lastSeen ?? '';
      const lb = by.get(b.id)?.lastSeen ?? '';
      return la.localeCompare(lb); // '' (never seen) sorts first
    });
  }, [words, mastery, kind]);

  const finish = (r: GameResult) => {
    if (kind !== 'student') return; // staff play is preview-only
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
      <GameOverlay topicName={topic.name} onExit={exit} isPreview={isStaff}>
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
            <FIB label={t('fc_title')} size="sm" onClick={() => navigate('/flashcards')}>
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
        <WordsTab words={words} isStaff={isStaff} fetcher={fetcher} />
      ) : (
        <ResultsTab results={results} />
      )}
    </div>
  );
}

function GameOverlay({
  topicName,
  onExit,
  isPreview,
  children,
}: {
  topicName: string;
  onExit: () => void;
  isPreview: boolean;
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
          {isPreview && (
            <span style={{ marginLeft: 10, fontWeight: 500, color: 'var(--text-muted)' }}>
              · {t('fc_preview_note')}
            </span>
          )}
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
}: {
  words: FlashcardWordRow[];
  isStaff: boolean;
  fetcher: ReturnType<typeof useFetcher>;
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
    if (!f.word.trim() || !f.meaningVi.trim()) return;
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
                <div style={{ color: 'var(--text-body)', fontSize: 'var(--text-sm)' }}>
                  {w.meaningVi}
                </div>
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
        <WordModal draft={modal} setDraft={setModal} onClose={() => setModal(null)} onSave={save} />
      )}
      {importing && <ImportModal fetcher={fetcher} onClose={() => setImporting(false)} />}
      {confirmNode}
    </>
  );
}

function WordModal({
  draft,
  setDraft,
  onClose,
  onSave,
}: {
  draft: WordDraft;
  setDraft: React.Dispatch<React.SetStateAction<WordDraft | null>>;
  onClose: () => void;
  onSave: (f: WordDraft) => void;
}) {
  const { t } = useLang();
  const [status, setStatus] = React.useState<'idle' | 'fetching' | 'found' | 'notfound'>('idle');
  const lastFetched = React.useRef<string>(draft.id ? draft.word.trim().toLowerCase() : '');
  const set = <K extends keyof WordDraft>(k: K, v: WordDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  // Auto-fill IPA / definition / audio from the dictionary when the word field
  // settles. Only fills fields the user left empty, so manual edits win.
  React.useEffect(() => {
    const w = draft.word.trim().toLowerCase();
    if (!w || w === lastFetched.current) return;
    const handle = setTimeout(async () => {
      lastFetched.current = w;
      setStatus('fetching');
      const entry = await fetchDictEntry(w);
      if (!entry) {
        setStatus('notfound');
        return;
      }
      setStatus('found');
      setDraft((d) => {
        if (!d) return d;
        return {
          ...d,
          ipa: d.ipa || entry.ipa || '',
          audioUrl: d.audioUrl || entry.audioUrl || '',
          definitionEn: d.definitionEn || entry.definition || '',
        };
      });
    }, 500);
    return () => clearTimeout(handle);
  }, [draft.word, setDraft]);

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
              : status === 'found'
                ? t('fc_fetched')
                : t('fc_not_found')}
          </span>
        )}
      </div>
      <FInput
        label={t('fc_meaning_vi')}
        value={draft.meaningVi}
        onChange={(e) => set('meaningVi', e.target.value)}
      />
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

function parseImportLines(text: string): { word: string; meaningVi: string }[] {
  const rows: { word: string; meaningVi: string }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let word = line;
    let meaningVi = '';
    const tab = line.indexOf('\t');
    if (tab >= 0) {
      word = line.slice(0, tab).trim();
      meaningVi = line.slice(tab + 1).trim();
    } else {
      // " - " protects hyphenated words like "well-known"
      const dash = line.indexOf(' - ');
      if (dash >= 0) {
        word = line.slice(0, dash).trim();
        meaningVi = line.slice(dash + 3).trim();
      }
    }
    if (word) rows.push({ word, meaningVi });
  }
  return rows;
}

function ImportModal({
  fetcher,
  onClose,
}: {
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [step, setStep] = React.useState<'paste' | 'review'>('paste');
  const [text, setText] = React.useState('');
  const [rows, setRows] = React.useState<ImportRow[]>([]);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);

  const runFetch = async () => {
    const parsed = parseImportLines(text);
    if (parsed.length === 0) return;
    const uniqueWords = Array.from(new Set(parsed.map((p) => p.word.toLowerCase())));
    setProgress({ done: 0, total: uniqueWords.length });
    const dict = await fetchDictEntries(uniqueWords, (done, total) => setProgress({ done, total }));
    setRows(
      parsed.map((p) => {
        const entry = dict.get(p.word.toLowerCase());
        return {
          word: p.word,
          meaningVi: p.meaningVi,
          ipa: entry?.ipa ?? '',
          definitionEn: entry?.definition ?? '',
          audioUrl: entry?.audioUrl ?? '',
          found: !!entry,
          include: true,
        };
      }),
    );
    setProgress(null);
    setStep('review');
  };

  const setRow = (i: number, patch: Partial<ImportRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = () => {
    const words = rows
      .filter((r) => r.include && r.word.trim() && r.meaningVi.trim())
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

  const readyCount = rows.filter((r) => r.include && r.word.trim() && r.meaningVi.trim()).length;

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
            <FBtn variant="primary" disabled={!text.trim() || !!progress} onClick={runFetch}>
              {progress ? `${progress.done}/${progress.total}` : t('fc_fetch')}
            </FBtn>
          </>
        ) : (
          <>
            <FBtn variant="secondary" onClick={() => setStep('paste')}>
              {t('cancel')}
            </FBtn>
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
              <input
                type="checkbox"
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

// ---- Results tab ----

function ResultsTab({ results }: { results: FlashcardResultRow[] }) {
  const { t } = useLang();

  const leaderboard = React.useMemo(() => {
    const best = new Map<string, { name: string; color: string; pct: number }>();
    for (const r of results) {
      const pct = Math.round((r.score * 100) / r.total);
      const cur = best.get(r.studentId);
      if (!cur || pct > cur.pct) {
        best.set(r.studentId, { name: r.studentName, color: r.studentColor, pct });
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
              <FAv name={r.studentName} color={r.studentColor} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{r.studentName}</div>
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

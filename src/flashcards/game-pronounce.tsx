import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { playWord } from './audio.js';
import { createRecorder, type WebRecorder } from './recorder.js';
import type { GameProps } from './game-utils.js';
import { meaningOf, phonemeTier, pickRound } from '../../shared/logic/flashcards';
import { MAX_CLIP_MS, MIN_CLIP_MS } from '../../shared/logic/wav';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';
import type { PronounceAssessment } from '../../shared/schemas';

const { Button: FBtn, IconButton: FIB } = DS;

/**
 * Luyện phát âm — the word is shown (with IPA and a model reading), the student records
 * themself saying it, and Azure's pronunciation assessment scores the clip through our
 * /speech-assess route. Accuracy ≥ PRONOUNCE_PASS counts the word as correct; the exact score
 * is shown but not persisted (GameResult only carries the boolean, like every other mode).
 *
 * Stopping the recorder submits straight away — one tap to record, one to stop, no third to
 * "check". The scored screen then breaks the word into IPA phonemes, each coloured by how
 * clearly it came out, so the student can see WHICH sound to fix rather than just a number.
 *
 * The free Azure tier scores one clip at a time, so a 429 ("another student is mid-word") is
 * an expected state, not an error: the clip is kept and retried once automatically.
 */

type Phase =
  | 'idle'
  | 'recording'
  /** Clip in hand but not scored — only reached on silence, a mis-tap, or a failed call. */
  | 'recorded'
  | 'submitting'
  | 'busy' // 429 — auto-retrying, then manual
  | 'scored'
  | 'error'
  | 'mic-blocked'
  | 'disabled'; // 503 — no Azure key configured

export function PronounceGame({
  words,
  roundSize,
  onExit,
  onFinish,
  garden,
}: GameProps & GardenRoundProps) {
  const { t } = useLang();
  const [round, setRound] = React.useState(() => pickRound(words, roundSize));
  const [idx, setIdx] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [clip, setClip] = React.useState<{ blob: Blob; durationMs: number } | null>(null);
  const [result, setResult] = React.useState<PronounceAssessment | null>(null);
  const [noSpeech, setNoSpeech] = React.useState(false);
  const [answers, setAnswers] = React.useState<{ wordId: string; correct: boolean }[]>([]);
  const started = React.useRef(Date.now());
  const finished = React.useRef(false);
  const recorder = React.useRef<WebRecorder | null>(null);
  const stopTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriedRef = React.useRef(false);
  // True while the single automatic 429 retry is pending — the manual button waits it out.
  const [autoRetrying, setAutoRetrying] = React.useState(false);

  const done = round.length > 0 && idx >= round.length;
  const score = answers.filter((a) => a.correct).length;
  const w = round[idx];

  React.useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      onFinish({
        mode: 'pronounce',
        score,
        total: round.length,
        durationMs: Date.now() - started.current,
        answers,
      });
    }
  }, [done, score, round.length, answers, onFinish]);

  // Tear down whatever is live when the overlay unmounts mid-round.
  React.useEffect(
    () => () => {
      recorder.current?.cancel();
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  const startRecording = async () => {
    const rec = createRecorder();
    recorder.current = rec;
    try {
      await rec.start();
    } catch {
      recorder.current = null;
      setPhase('mic-blocked');
      return;
    }
    setNoSpeech(false);
    // Each clip gets its own single automatic 429 retry.
    retriedRef.current = false;
    setPhase('recording');
    stopTimer.current = setTimeout(stopRecording, MAX_CLIP_MS);
  };

  /**
   * Stop and score in one gesture. The MAX_CLIP_MS timer lands here too, so a student who just
   * keeps talking gets the same treatment. Nulling `recorder.current` first is what stops a
   * manual tap racing that timer into a double submit.
   */
  const stopRecording = async () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    const c = await rec.stop();
    setClip(c);
    if (c.durationMs < MIN_CLIP_MS) {
      // A mis-tap, not an attempt — say so locally rather than paying Azure to hear nothing.
      setNoSpeech(true);
      setPhase('recorded');
      return;
    }
    void submit(c.blob);
  };

  const submit = async (blob: Blob) => {
    if (!w) return;
    setPhase('submitting');
    const fd = new FormData();
    fd.set('word', w.word);
    fd.set('audio', blob, 'clip.wav');
    // Plain fetch, not a router fetcher: scoring must not revalidate the topic route
    // (same reasoning as src/lib/enrich-client.ts). The session cookie rides along.
    let res: Response;
    try {
      res = await fetch('/speech-assess', { method: 'POST', body: fd });
    } catch {
      setPhase('error');
      return;
    }
    if (res.status === 429) {
      // One polite automatic retry — the free tier scores one student at a time.
      setPhase('busy');
      if (!retriedRef.current) {
        retriedRef.current = true;
        setAutoRetrying(true);
        retryTimer.current = setTimeout(() => {
          setAutoRetrying(false);
          void submit(blob);
        }, 2000);
      }
      return;
    }
    retriedRef.current = false;
    if (res.status === 503) {
      setPhase('disabled');
      return;
    }
    if (!res.ok) {
      setPhase('error');
      return;
    }
    const { data } = (await res.json()) as { data: PronounceAssessment };
    if (data.noSpeech) {
      setNoSpeech(true);
      setPhase('recorded');
      return;
    }
    setResult(data);
    // Write at this word's slot rather than appending: re-recording after a score replaces the
    // attempt instead of grading the same word twice.
    setAnswers((a) => {
      const nextAnswers = a.slice(0, idx);
      nextAnswers[idx] = { wordId: w.id, correct: data.correct };
      return nextAnswers;
    });
    setPhase('scored');
  };

  const next = () => {
    setPhase('idle');
    setClip(null);
    setResult(null);
    setNoSpeech(false);
    setIdx((i) => i + 1);
  };

  const replay = () => {
    finished.current = false;
    setRound(pickRound(words, roundSize));
    setAnswers([]);
    setIdx(0);
    setPhase('idle');
    setClip(null);
    setResult(null);
    setNoSpeech(false);
    started.current = Date.now();
  };

  /** Back to the mic for another go at the same word. A later score overwrites this one. */
  const rerecord = () => {
    setClip(null);
    setResult(null);
    setNoSpeech(false);
    setPhase('idle');
  };

  const playClip = () => {
    if (!clip) return;
    const url = URL.createObjectURL(clip.blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    void audio.play();
  };

  if (round.length === 0) {
    return (
      <div style={endWrap}>
        <div style={{ color: 'var(--text-muted)' }}>{t('fc_min_words', { n: 1 })}</div>
        <FBtn variant="secondary" onClick={onExit}>
          {t('fc_exit')}
        </FBtn>
      </div>
    );
  }

  if (phase === 'mic-blocked' || phase === 'disabled') {
    return (
      <div style={endWrap}>
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', maxWidth: 420 }}>
          {t(phase === 'mic-blocked' ? 'fc_pron_mic_denied' : 'fc_pron_disabled')}
        </div>
        <FBtn variant="secondary" onClick={onExit}>
          {t('fc_exit')}
        </FBtn>
      </div>
    );
  }

  if (done) {
    return (
      <div style={endWrap}>
        <div style={{ fontSize: 'var(--text-xl, 28px)', fontWeight: 800 }}>
          {t('fc_round_done')}
        </div>
        <div style={{ fontSize: 'var(--text-lg, 22px)', color: 'var(--text-strong)' }}>
          {t('fc_score')}: {score}/{round.length}
        </div>
        <RoundGardenNote garden={garden} />
        <div className="m-row" style={{ gap: 10 }}>
          <FBtn variant="primary" onClick={replay}>
            {t('fc_play_again')}
          </FBtn>
          <FBtn variant="secondary" onClick={onExit}>
            {t('fc_exit')}
          </FBtn>
        </div>
      </div>
    );
  }

  return (
    <div style={playWrap}>
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
        {t('fc_question_of', { i: idx + 1, n: round.length })} · {t('fc_score')}: {score}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 'var(--text-xl, 28px)', fontWeight: 800 }}>{w.word}</div>
          <FIB label={t('fc_play_audio')} size="md" onClick={() => playWord(w.word)}>
            <MIcon name="volume" size={24} />
          </FIB>
        </div>
        {phase === 'scored' && result ? (
          <PhonemeBreakdown result={result} fallbackIpa={w.ipa ?? undefined} />
        ) : (
          w.ipa && <div style={{ color: 'var(--text-muted)' }}>{w.ipa}</div>
        )}
        {/* The meaning is the reveal — it stays hidden until the clip has been scored. */}
        {phase === 'scored' && result && (
          <div style={{ color: 'var(--text-strong)' }}>{meaningOf(w)}</div>
        )}
      </div>

      {phase === 'scored' && result ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              fontSize: 44,
              fontWeight: 800,
              color: result.correct ? 'var(--green-600, #2e7d32)' : 'var(--red-600, #c0392b)',
            }}
          >
            {Math.round(result.accuracy)}%
          </div>
          <div className="m-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {clip && (
              <FBtn variant="ghost" onClick={playClip} iconLeft={<MIcon name="volume" size={16} />}>
                {t('fc_pron_replay')}
              </FBtn>
            )}
            <FBtn variant="soft" onClick={rerecord}>
              {t('fc_pron_rerecord')}
            </FBtn>
            <FBtn variant="primary" onClick={next}>
              {t('fc_pron_next')}
            </FBtn>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          {(phase === 'idle' || phase === 'recording') && (
            <>
              <FIB
                label={phase === 'recording' ? t('fc_pron_recording') : t('fc_pron_prompt')}
                size="md"
                onClick={phase === 'recording' ? () => void stopRecording() : startRecording}
              >
                <MIcon name={phase === 'recording' ? 'square' : 'mic'} size={32} />
              </FIB>
              <div
                style={{
                  color: phase === 'recording' ? 'var(--red-600, #c0392b)' : 'var(--text-muted)',
                  fontWeight: phase === 'recording' ? 700 : 400,
                }}
              >
                {t(phase === 'recording' ? 'fc_pron_recording' : 'fc_pron_prompt')}
              </div>
            </>
          )}

          {(phase === 'recorded' ||
            phase === 'submitting' ||
            phase === 'busy' ||
            phase === 'error') &&
            clip && (
              <>
                {noSpeech && (
                  <div style={{ color: 'var(--red-600, #c0392b)', textAlign: 'center' }}>
                    {t('fc_pron_no_speech')}
                  </div>
                )}
                {phase === 'busy' && (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', maxWidth: 380 }}>
                    {t('fc_pron_busy')}
                  </div>
                )}
                {phase === 'error' && (
                  <div style={{ color: 'var(--red-600, #c0392b)', textAlign: 'center' }}>
                    {t('fc_pron_error')}
                  </div>
                )}
                <div
                  className="m-row"
                  style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}
                >
                  <FBtn
                    variant="ghost"
                    disabled={phase === 'submitting'}
                    onClick={playClip}
                    iconLeft={<MIcon name="volume" size={16} />}
                  >
                    {t('fc_pron_replay')}
                  </FBtn>
                  <FBtn variant="soft" disabled={phase === 'submitting'} onClick={rerecord}>
                    {t('fc_pron_rerecord')}
                  </FBtn>
                  <FBtn
                    variant="primary"
                    disabled={phase === 'submitting' || autoRetrying}
                    onClick={() => void submit(clip.blob)}
                  >
                    {phase === 'submitting'
                      ? t('fc_pron_checking')
                      : phase === 'error' || phase === 'busy'
                        ? t('fc_pron_retry')
                        : t('fc_pron_check')}
                  </FBtn>
                </div>
              </>
            )}
        </div>
      )}
    </div>
  );
}

const TIER_COLOR: Record<ReturnType<typeof phonemeTier>, string> = {
  good: 'var(--green-600, #2e7d32)',
  close: 'var(--warning, #E0A02E)',
  wrong: 'var(--red-600, #c0392b)',
};

/**
 * The sound-by-sound verdict: the reference word's IPA, each symbol coloured by how clearly it
 * came out — green / amber / red, with no legend. Insertion entries are words the student added
 * on top of the reference; they carry no reference phonemes, so they are skipped.
 *
 * Rendered in the word header, taking the static IPA line's place once the clip is scored —
 * the same string in the same spot, just coloured. When the result carries no reference
 * phonemes at all, the plain IPA stays so the header never loses its pronunciation line.
 */
function PhonemeBreakdown({
  result,
  fallbackIpa,
}: {
  result: PronounceAssessment;
  fallbackIpa?: string;
}) {
  const phonemes = (result.words ?? [])
    .filter((wd) => wd.errorType !== 'Insertion')
    .flatMap((wd) => wd.phonemes);
  if (phonemes.length === 0) {
    return fallbackIpa ? <div style={{ color: 'var(--text-muted)' }}>{fallbackIpa}</div> : null;
  }
  return (
    <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 1 }}>
      /
      {phonemes.map((p, i) => (
        <span key={i} style={{ color: TIER_COLOR[phonemeTier(p.accuracy)] }}>
          {p.ipa}
        </span>
      ))}
      /
    </div>
  );
}

const playWrap: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 24,
  padding: 24,
};

const endWrap: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 18,
  padding: 24,
};

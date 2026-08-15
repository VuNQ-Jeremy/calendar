import React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { createAudioPlayer } from 'expo-audio';
import { BarChart3, Mic, Play, Square, Volume2, X } from 'lucide-react-native';
import { forgiveScore, meaningOf, phonemeTier, pickRound } from '@mochi/shared/logic/flashcards';
import { MAX_CLIP_MS, MIN_CLIP_MS } from '@mochi/shared/logic/wav';
import type { PronounceAssessment } from '@mochi/shared/schemas';
import * as api from '~/lib/endpoints';
import { ApiError } from '~/lib/api';
import { useLang } from '~/lib/i18n';
import { usePcmRecorder, type PcmClip } from '~/lib/use-pcm-recorder';
import { useWordAudio } from '~/lib/use-word-audio';
import { useTheme } from '~/theme';
import { Body, Button, Heading, IconButton, Muted, Title } from '~/ui';
import type { GameProps } from './types';
import { GameEnd } from './GameEnd';

/**
 * Port of `src/flashcards/game-pronounce.tsx`. The word is shown (IPA + a model reading), the
 * student records themself saying it, and Azure scores the clip through /speech-assess.
 * Accuracy ≥ 70 counts as correct; the exact score is shown but not persisted. Stopping the
 * recorder submits immediately, and the scored screen colours each IPA phoneme by how clearly
 * it came out.
 *
 * Unlike every sibling game this one needs the NETWORK mid-round — scoring is a server call —
 * so an offline session gets an honest notice instead of a spinner. The finished round still
 * goes through the ordinary outbox path (a result only ever exists after a successful score).
 */

type Phase =
  | 'idle'
  | 'recording'
  /** Clip in hand but not scored — only reached on silence, a mis-tap, or a failed call. */
  | 'recorded'
  | 'submitting'
  | 'busy' // 429 — the free tier scores one student at a time
  | 'scored'
  | 'error'
  | 'mic-blocked'
  | 'disabled'; // 503 — no Azure key configured server-side

export function PronounceGame({ words, roundSize, onExit, onFinish, endNote }: GameProps) {
  const th = useTheme();
  const { t } = useLang();
  const play = useWordAudio();
  const net = useNetInfo();
  const recorder = usePcmRecorder();

  const [round, setRound] = React.useState(() => pickRound(words, roundSize));
  const [idx, setIdx] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [clip, setClip] = React.useState<PcmClip | null>(null);
  const clipRef = React.useRef<PcmClip | null>(null);
  const [result, setResult] = React.useState<PronounceAssessment | null>(null);
  const [noSpeech, setNoSpeech] = React.useState(false);
  const [autoRetrying, setAutoRetrying] = React.useState(false);
  // The "detailed breakdown" sheet over the scored screen (all four score levels).
  const [details, setDetails] = React.useState(false);
  const [answers, setAnswers] = React.useState<{ wordId: string; correct: boolean }[]>([]);
  const started = React.useRef(Date.now());
  const finished = React.useRef(false);
  const stopTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriedRef = React.useRef(false);
  // usePcmRecorder.stop() writes a file every call, so unlike the web recorder it needs its own
  // guard against a manual stop racing the MAX_CLIP_MS timer.
  const stoppingRef = React.useRef(false);

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

  React.useEffect(
    () => () => {
      recorder.cancel();
      clipRef.current?.dispose();
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  /**
   * Hold the newest clip and bin the one it replaces. The clip now outlives its upload — the
   * scored screen can play it back — so a ref mirrors it for the unmount sweep.
   */
  const keepClip = (c: PcmClip | null) => {
    if (clipRef.current && clipRef.current !== c) clipRef.current.dispose();
    clipRef.current = c;
    setClip(c);
  };

  const startRecording = async () => {
    const ok = await recorder.start();
    if (!ok) {
      setPhase('mic-blocked');
      return;
    }
    setNoSpeech(false);
    // Each clip gets its own single automatic 429 retry.
    retriedRef.current = false;
    stoppingRef.current = false;
    setPhase('recording');
    stopTimer.current = setTimeout(() => void stopRecording(), MAX_CLIP_MS);
  };

  /** Stop and score in one gesture — the MAX_CLIP_MS timer lands here too. */
  const stopRecording = async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    const c = await recorder.stop();
    keepClip(c);
    if (c.durationMs < MIN_CLIP_MS) {
      // A mis-tap, not an attempt — say so locally rather than paying Azure to hear nothing.
      setNoSpeech(true);
      setPhase('recorded');
      return;
    }
    void submit(c);
  };

  const submit = async (c: PcmClip) => {
    if (!w) return;
    setPhase('submitting');
    const form = new FormData();
    form.append('word', w.word);
    // React Native's FormData file part: { uri, name, type }. The cast is the standard RN idiom.
    form.append('audio', { uri: c.uri, name: 'clip.wav', type: 'audio/wav' } as unknown as Blob);
    let data: PronounceAssessment;
    try {
      data = await api.flashcards.assessPronunciation(form);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        // One polite automatic retry — the free tier scores one student at a time.
        setPhase('busy');
        if (!retriedRef.current) {
          retriedRef.current = true;
          setAutoRetrying(true);
          retryTimer.current = setTimeout(() => {
            setAutoRetrying(false);
            void submit(c);
          }, 2000);
        }
        return;
      }
      if (err instanceof ApiError && err.status === 503) {
        setPhase('disabled');
        return;
      }
      setPhase('error');
      return;
    }
    retriedRef.current = false;
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
    keepClip(null);
    setResult(null);
    setNoSpeech(false);
    setDetails(false);
    setIdx((i) => i + 1);
  };

  /** Back to the mic for another go at the same word. A later score overwrites this one. */
  const rerecord = () => {
    keepClip(null);
    setResult(null);
    setNoSpeech(false);
    setDetails(false);
    setPhase('idle');
  };

  const replay = () => {
    finished.current = false;
    setRound(pickRound(words, roundSize));
    setAnswers([]);
    setIdx(0);
    setPhase('idle');
    keepClip(null);
    setResult(null);
    setNoSpeech(false);
    started.current = Date.now();
  };

  const playClip = (c: PcmClip) => {
    const player = createAudioPlayer({ uri: c.uri });
    player.play();
    // Released on a timer rather than an "ended" listener: clips are ≤5s and the player object
    // is tiny, so this is the simplest leak-free option.
    setTimeout(() => player.release(), MAX_CLIP_MS + 1000);
  };

  const notice = (text: string) => (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: th.spacing[4],
        padding: th.spacing[6],
      }}
    >
      <Muted style={{ textAlign: 'center' }}>{text}</Muted>
      <Button variant="secondary" onPress={onExit}>
        {t('fc_exit')}
      </Button>
    </View>
  );

  if (round.length === 0) return notice(t('fc_no_words'));
  // Scoring is a server call — an offline round could never finish, so say so up front. The
  // mode stays visible in the launcher; this notice is the one honest gate.
  if (net.isConnected === false && phase !== 'scored' && !done) return notice(t('fc_pron_offline'));
  if (phase === 'mic-blocked') return notice(t('fc_pron_mic_denied'));
  if (phase === 'disabled') return notice(t('fc_pron_disabled'));

  if (done) {
    return (
      <GameEnd
        headline={`${t('fc_score')}: ${score}/${round.length}`}
        onReplay={replay}
        onExit={onExit}
      >
        {endNote}
      </GameEnd>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: th.spacing[5],
        padding: th.spacing[6],
      }}
    >
      <Muted style={{ fontFamily: th.font.bodyBold }}>
        {t('fc_question_of', { i: idx + 1, n: round.length })} · {t('fc_score')}: {score}
      </Muted>

      <View style={{ alignItems: 'center', gap: th.spacing[2] }}>
        <View style={{ flexDirection: 'row', gap: th.spacing[3], alignItems: 'center' }}>
          <Title style={{ ...th.text.xl, fontFamily: th.font.bodyBold }}>{w.word}</Title>
          <IconButton variant="solid" label={t('fc_play_audio')} onPress={() => play(w.word)}>
            <Volume2 size={22} color={th.color.textOnBrand} />
          </IconButton>
        </View>
        {phase === 'scored' && result ? (
          <>
            <PhonemeBreakdown result={result} fallbackIpa={w.ipa ?? undefined} />
            <Muted style={{ textAlign: 'center' }}>{t('fc_pron_ipa_hint')}</Muted>
          </>
        ) : w.ipa ? (
          <Muted>{w.ipa}</Muted>
        ) : null}
        {/* The meaning is the reveal — it stays hidden until the clip has been scored. */}
        {phase === 'scored' && result ? (
          <Body style={{ textAlign: 'center' }}>{meaningOf(w)}</Body>
        ) : null}
      </View>

      {phase === 'scored' && result ? (
        <View style={{ alignItems: 'center', gap: th.spacing[3] }}>
          <Title
            style={{
              fontSize: 44,
              lineHeight: 52,
              fontFamily: th.font.bodyBold,
              color: result.correct ? th.status.success : th.status.danger,
            }}
          >
            {`${Math.round(forgiveScore(result.accuracy, result.curve ?? 'off'))}%`}
          </Title>
          <Muted>{t('fc_pron_accuracy')}</Muted>
          {result.recognized ? (
            <Body>{t('fc_pron_heard', { word: result.recognized })}</Body>
          ) : null}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: th.spacing[2],
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <IconButton label={t('fc_pron_details')} onPress={() => setDetails(true)}>
              <BarChart3 size={20} color={th.color.textStrong} />
            </IconButton>
            {clip ? (
              <Button
                variant="ghost"
                iconLeft={<Play size={16} color={th.color.textStrong} />}
                onPress={() => playClip(clip)}
              >
                {t('fc_pron_replay')}
              </Button>
            ) : null}
            <Button variant="soft" onPress={rerecord}>
              {t('fc_pron_rerecord')}
            </Button>
            <Button onPress={next}>{t('fc_pron_next')}</Button>
          </View>
          {details ? (
            <PronounceDetailsSheet
              result={result}
              word={w.word}
              onClose={() => setDetails(false)}
            />
          ) : null}
        </View>
      ) : phase === 'idle' || phase === 'recording' ? (
        <View style={{ alignItems: 'center', gap: th.spacing[3] }}>
          <IconButton
            variant="solid"
            label={phase === 'recording' ? t('fc_pron_recording') : t('fc_pron_prompt')}
            onPress={
              phase === 'recording' ? () => void stopRecording() : () => void startRecording()
            }
          >
            {phase === 'recording' ? (
              <Square size={28} color={th.color.textOnBrand} />
            ) : (
              <Mic size={28} color={th.color.textOnBrand} />
            )}
          </IconButton>
          <Muted
            style={
              phase === 'recording'
                ? { color: th.status.danger, fontFamily: th.font.bodyBold }
                : undefined
            }
          >
            {t(phase === 'recording' ? 'fc_pron_recording' : 'fc_pron_prompt')}
          </Muted>
        </View>
      ) : clip ? (
        <View style={{ alignItems: 'center', gap: th.spacing[3], maxWidth: 420 }}>
          {noSpeech ? (
            <Body style={{ color: th.status.danger, textAlign: 'center' }}>
              {t('fc_pron_no_speech')}
            </Body>
          ) : null}
          {phase === 'busy' ? (
            <Muted style={{ textAlign: 'center' }}>{t('fc_pron_busy')}</Muted>
          ) : null}
          {phase === 'error' ? (
            <Body style={{ color: th.status.danger, textAlign: 'center' }}>
              {t('fc_pron_error')}
            </Body>
          ) : null}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: th.spacing[2],
              justifyContent: 'center',
            }}
          >
            <Button
              variant="ghost"
              disabled={phase === 'submitting'}
              iconLeft={<Play size={16} color={th.color.textStrong} />}
              onPress={() => playClip(clip)}
            >
              {t('fc_pron_replay')}
            </Button>
            <Button variant="soft" disabled={phase === 'submitting'} onPress={rerecord}>
              {t('fc_pron_rerecord')}
            </Button>
            <Button
              disabled={phase === 'submitting' || autoRetrying}
              onPress={() => void submit(clip)}
            >
              {phase === 'submitting'
                ? t('fc_pron_checking')
                : phase === 'error' || phase === 'busy'
                  ? t('fc_pron_retry')
                  : t('fc_pron_check')}
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** The tier palette shared by the breakdown, the details sheet and their score numbers. */
function useTierColor() {
  const th = useTheme();
  return {
    good: th.status.success,
    close: th.status.warning,
    wrong: th.status.danger,
  };
}

/**
 * The simple sound-by-sound verdict: one group per syllable, its phonemes each coloured by
 * their own tier and the syllable underlined in its tier colour — colours only, no numbers
 * (the numbers live in PronounceDetailsSheet, behind the chart icon). Falls back to the flat
 * phoneme line when the response carries no syllable groups (Azure only sends them for en-US),
 * and to the plain IPA when there are no phonemes either. Insertion entries are words the
 * student added on top of the reference — no reference IPA, reported in the details sheet.
 *
 * Rendered in the word header, taking the static IPA line's place once the clip is scored.
 */
function PhonemeBreakdown({
  result,
  fallbackIpa,
}: {
  result: PronounceAssessment;
  fallbackIpa?: string;
}) {
  const tierColor = useTierColor();
  const th = useTheme();
  // Colour tiers follow the forgiveness curve, like every other kid-facing number.
  const curve = result.curve ?? 'off';
  const tierOf = (raw: number) => tierColor[phonemeTier(forgiveScore(raw, curve))];
  const spoken = (result.words ?? []).filter((wd) => wd.errorType !== 'Insertion');
  const syllables = spoken.flatMap((wd) => wd.syllables ?? []);
  const phonemes = spoken.flatMap((wd) => wd.phonemes);
  if (syllables.length > 0) {
    return (
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'baseline',
          gap: th.spacing[2],
        }}
      >
        <Title style={{ fontSize: 24, lineHeight: 32 }}>{'/'}</Title>
        {syllables.map((s, i) => (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              borderBottomWidth: 3,
              borderBottomColor: tierOf(s.accuracy),
              paddingHorizontal: 2,
              paddingBottom: 2,
            }}
          >
            {s.phonemes.length > 0 ? (
              s.phonemes.map((p, j) => (
                <Title key={j} style={{ fontSize: 24, lineHeight: 32, color: tierOf(p.accuracy) }}>
                  {p.ipa}
                </Title>
              ))
            ) : (
              <Title style={{ fontSize: 24, lineHeight: 32, color: tierOf(s.accuracy) }}>
                {s.ipa}
              </Title>
            )}
          </View>
        ))}
        <Title style={{ fontSize: 24, lineHeight: 32 }}>{'/'}</Title>
      </View>
    );
  }
  if (phonemes.length === 0) {
    return fallbackIpa ? <Muted>{fallbackIpa}</Muted> : null;
  }
  return (
    <Title style={{ fontSize: 24, lineHeight: 32, letterSpacing: 1 }}>
      {'/'}
      {phonemes.map((p, i) => (
        <Title key={i} style={{ fontSize: 24, lineHeight: 32, color: tierOf(p.accuracy) }}>
          {p.ipa}
        </Title>
      ))}
      {'/'}
    </Title>
  );
}

/** A 0-100 score, coloured by the same tier scale as the phonemes. */
function ScoreNum({ v }: { v: number }) {
  const tierColor = useTierColor();
  const th = useTheme();
  return (
    <Body style={{ fontFamily: th.font.bodyBold, color: tierColor[phonemeTier(v)] }}>
      {Math.round(v)}
    </Body>
  );
}

const ERR_KEY = {
  Insertion: 'fc_pron_err_insertion',
  Omission: 'fc_pron_err_omission',
  Mispronunciation: 'fc_pron_err_mispronunciation',
} as const;

/**
 * The detailed breakdown behind the chart icon, as a bottom sheet (same scrim pattern as
 * MoveEventSheet): every number Azure returned at all four levels — clip scores, what was
 * heard, then each word with its miscue tag, syllable scores and per-phoneme scores. The
 * scored screen itself stays colours-plus-one-number. docs/pronounce-scores.html is the
 * long-form companion.
 */
function PronounceDetailsSheet({
  result,
  word,
  onClose,
}: {
  result: PronounceAssessment;
  word: string;
  onClose: () => void;
}) {
  const th = useTheme();
  const { t } = useLang();
  const tierColor = useTierColor();

  const clipScores: [string, number][] = [
    [t('fc_pron_accuracy'), result.accuracy],
    [t('fc_pron_fluency'), result.fluency],
    [t('fc_pron_completeness'), result.completeness],
    [t('fc_pron_overall'), result.pronScore],
  ];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('close')}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(60,40,25,0.45)', justifyContent: 'flex-end' }}
      >
        {/* An inner Pressable with no handler swallows taps so they do not reach the scrim. */}
        <Pressable
          style={{
            backgroundColor: th.color.surfaceCard,
            borderTopLeftRadius: th.radius.xl,
            borderTopRightRadius: th.radius.xl,
            padding: th.spacing[5],
            paddingBottom: th.spacing[8],
            maxHeight: '80%',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: th.spacing[4],
            }}
          >
            <Heading>{word}</Heading>
            <IconButton label={t('close')} onPress={onClose}>
              <X size={20} color={th.color.textStrong} />
            </IconButton>
          </View>
          <ScrollView contentContainerStyle={{ gap: th.spacing[4] }}>
            <View style={{ gap: th.spacing[2] }}>
              {clipScores.map(([label, v]) => (
                <View
                  key={label}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Muted>{label}</Muted>
                  <ScoreNum v={v} />
                </View>
              ))}
            </View>
            {result.recognized ? (
              <Muted>{t('fc_pron_heard', { word: result.recognized })}</Muted>
            ) : null}
            {(result.words ?? []).map((wd, i) => (
              <View
                key={i}
                style={{
                  borderTopWidth: 1,
                  borderTopColor: th.color.borderSubtle,
                  paddingTop: th.spacing[3],
                  gap: th.spacing[2],
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Body style={{ fontFamily: th.font.bodyBold }}>
                    {wd.word}
                    {wd.errorType !== 'None' ? (
                      <Body style={{ color: th.status.danger }}> · {t(ERR_KEY[wd.errorType])}</Body>
                    ) : null}
                  </Body>
                  <ScoreNum v={wd.accuracy} />
                </View>
                {(wd.syllables ?? []).map((s, j) => (
                  <View key={j} style={{ gap: th.spacing[1] }}>
                    <View
                      style={{ flexDirection: 'row', alignItems: 'center', gap: th.spacing[2] }}
                    >
                      <Body style={{ fontFamily: th.font.bodyBold, letterSpacing: 1 }}>
                        /{s.ipa}/
                      </Body>
                      <ScoreNum v={s.accuracy} />
                    </View>
                    {s.phonemes.length > 0 ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: th.spacing[2] }}>
                        {s.phonemes.map((p, k) => (
                          <View
                            key={k}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 5,
                              paddingHorizontal: 9,
                              paddingVertical: 2,
                              borderRadius: 999,
                              borderWidth: 1.5,
                              borderColor: th.color.borderSubtle,
                            }}
                          >
                            <Body
                              style={{
                                fontFamily: th.font.bodyBold,
                                color: tierColor[phonemeTier(p.accuracy)],
                              }}
                            >
                              {p.ipa}
                            </Body>
                            <Muted style={{ fontSize: 12, lineHeight: 16 }}>
                              {Math.round(p.accuracy)}
                            </Muted>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ))}
            <Muted>{t('fc_pron_levels_note')}</Muted>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

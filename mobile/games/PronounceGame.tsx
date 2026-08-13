import React from 'react';
import { View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { createAudioPlayer } from 'expo-audio';
import { Mic, Play, Square, Volume2 } from 'lucide-react-native';
import { meaningOf, pickRound } from '@mochi/shared/logic/flashcards';
import { MAX_CLIP_MS } from '@mochi/shared/logic/wav';
import type { PronounceAssessment } from '@mochi/shared/schemas';
import * as api from '~/lib/endpoints';
import { ApiError } from '~/lib/api';
import { useLang } from '~/lib/i18n';
import { usePcmRecorder, type PcmClip } from '~/lib/use-pcm-recorder';
import { useWordAudio } from '~/lib/use-word-audio';
import { useTheme } from '~/theme';
import { Body, Button, IconButton, Muted, Title } from '~/ui';
import type { GameProps } from './types';
import { GameEnd } from './GameEnd';

/**
 * Port of `src/flashcards/game-pronounce.tsx`. The word is shown (IPA + a model reading), the
 * student records themself saying it, and Azure scores the clip through /speech-assess.
 * Accuracy ≥ 70 counts as correct; the exact score is shown but not persisted.
 *
 * Unlike every sibling game this one needs the NETWORK mid-round — scoring is a server call —
 * so an offline session gets an honest notice instead of a spinner. The finished round still
 * goes through the ordinary outbox path (a result only ever exists after a successful score).
 */

type Phase =
  | 'idle'
  | 'recording'
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
  const [result, setResult] = React.useState<PronounceAssessment | null>(null);
  const [noSpeech, setNoSpeech] = React.useState(false);
  const [autoRetrying, setAutoRetrying] = React.useState(false);
  const [answers, setAnswers] = React.useState<{ wordId: string; correct: boolean }[]>([]);
  const started = React.useRef(Date.now());
  const finished = React.useRef(false);
  const stopTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriedRef = React.useRef(false);

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
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  const startRecording = async () => {
    const ok = await recorder.start();
    if (!ok) {
      setPhase('mic-blocked');
      return;
    }
    setNoSpeech(false);
    setPhase('recording');
    stopTimer.current = setTimeout(() => void stopRecording(), MAX_CLIP_MS);
  };

  const stopRecording = async () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    setClip(await recorder.stop());
    setPhase('recorded');
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
    c.dispose();
    setResult(data);
    setAnswers((a) => [...a, { wordId: w.id, correct: data.correct }]);
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
        {w.ipa ? <Muted>{w.ipa}</Muted> : null}
        <Body style={{ textAlign: 'center' }}>{meaningOf(w)}</Body>
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
            {String(Math.round(result.accuracy))}
          </Title>
          <Muted>{t('fc_pron_accuracy')}</Muted>
          {result.recognized ? (
            <Body>{t('fc_pron_heard', { word: result.recognized })}</Body>
          ) : null}
          <Button onPress={next}>{t('fc_pron_next')}</Button>
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
            <Button
              variant="soft"
              disabled={phase === 'submitting'}
              onPress={() => {
                clip.dispose();
                setClip(null);
                setNoSpeech(false);
                setPhase('idle');
              }}
            >
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

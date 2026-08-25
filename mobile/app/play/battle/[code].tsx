import React from 'react';
import { Image, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Volume2 } from 'lucide-react-native';
import { applyServerMsg, myResultFromReveals, type PvpView } from '@mochi/shared/logic/pvp';
import { getToken, useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useWordAudio } from '~/lib/use-word-audio';
import { connectGameSocket } from '~/lib/game-socket';
import * as outbox from '~/lib/outbox';
import { invalidateGarden } from '~/lib/query';
import { useTheme } from '~/theme';
import { Body, Button, Mono, Muted, ProgressBar, Screen, Title } from '~/ui';

/**
 * The join-by-code battle screen — outside the `(app)` tab group, like `app/play/[slug]/[mode]`,
 * which is what removes the tab bar. Every phase renders off the shared `PvpView` reducer state;
 * `connectGameSocket` is transport only, so this screen and the web one cannot disagree about
 * what a phase means.
 */
export default function BattleScreen() {
  const th = useTheme();
  const { t } = useLang();
  const play = useWordAudio();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { user } = useAuth();
  const myId = user?.id ?? '';

  const [view, setView] = React.useState<PvpView>({ phase: 'connecting' });
  const socketRef = React.useRef<ReturnType<typeof connectGameSocket> | null>(null);
  const wordIdByIndex = React.useRef<Record<number, string>>({});
  const myReveals = React.useRef<{ index: number; correct: boolean; wordId: string }[]>([]);
  const startedAt = React.useRef<number | null>(null);
  const posted = React.useRef(false);

  React.useEffect(() => {
    if (!code) return;
    const socket = connectGameSocket(code, {
      getToken,
      onMsg: (msg) => setView((v) => applyServerMsg(v, msg)),
      onClose: () => setView({ phase: 'error', code: 'connection_lost' }),
    });
    socketRef.current = socket;
    return () => socket.close();
  }, [code]);

  if (view.phase === 'question' && startedAt.current === null) startedAt.current = Date.now();
  if (view.phase === 'question') wordIdByIndex.current[view.index] = view.question.wordId;
  if (view.phase === 'reveal') {
    const wordId = wordIdByIndex.current[view.index];
    if (wordId && !myReveals.current.some((r) => r.index === view.index)) {
      myReveals.current.push({
        index: view.index,
        correct: view.correctIds.includes(myId),
        wordId,
      });
    }
  }

  React.useEffect(() => {
    if (view.phase !== 'finish' || posted.current || user?.kind !== 'student') return;
    posted.current = true;
    const result = myResultFromReveals(
      myReveals.current,
      Date.now() - (startedAt.current ?? Date.now()),
    );
    void (async () => {
      try {
        await outbox.enqueue(
          {
            topicId: view.config.topicId,
            mode: result.mode,
            score: result.score,
            total: result.total,
            durationMs: result.durationMs,
            answers: result.answers,
          },
          new Date(),
        );
        const flushed = await outbox.flush(new Date());
        if (flushed.recorded > 0) void invalidateGarden();
      } catch {
        // Enqueue failing means SQLite is unavailable; the score is still on screen.
      }
    })();
  }, [view, user, myId]);

  const exit = React.useCallback(() => router.back(), []);

  return (
    <Screen edges={{ top: true, bottom: true }}>
      <StatusBar style="dark" />
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: th.spacing[6],
          padding: th.spacing[6],
        }}
      >
        {view.phase === 'connecting' && <Muted>{t('pvp_connecting')}</Muted>}

        {view.phase === 'error' && (
          <View style={{ alignItems: 'center', gap: th.spacing[3] }}>
            <Muted>{t(errorMessageKey(view.code))}</Muted>
            <Button variant="secondary" onPress={exit}>
              {t('fc_exit')}
            </Button>
          </View>
        )}

        {view.phase === 'lobby' && (
          <View style={{ alignItems: 'center', gap: th.spacing[4] }}>
            <Muted>{t('pvp_room_code')}</Muted>
            <Title style={{ ...th.text.xxl, fontFamily: th.font.displayBold, letterSpacing: 8 }}>
              {view.code}
            </Title>
            <Body>{t('pvp_player_count', { n: view.players.length })}</Body>
            {view.hostId === myId ? (
              <Button
                variant="primary"
                size="lg"
                disabled={view.players.length < 2}
                onPress={() => socketRef.current?.send({ type: 'start' })}
              >
                {t('pvp_start')}
              </Button>
            ) : (
              <Muted>{t('pvp_waiting_host')}</Muted>
            )}
          </View>
        )}

        {view.phase === 'question' && (
          <View style={{ width: '100%', alignItems: 'center', gap: th.spacing[4] }}>
            <Muted>{t('fc_question_of', { i: view.index + 1, n: view.total })}</Muted>
            <ProgressBar
              value={Math.max(
                0,
                Math.min(
                  100,
                  ((view.deadline - Date.now()) / (view.config.secondsPerQuestion * 1000)) * 100,
                ),
              )}
              style={{ width: '100%', maxWidth: 400 }}
            />
            {view.question.prompt === 'image' && view.question.imagePath ? (
              <Image
                source={{ uri: view.question.imagePath }}
                style={{ width: 200, height: 140, borderRadius: th.radius.lg }}
              />
            ) : view.question.prompt === 'audio' ? (
              <Button
                variant="secondary"
                onPress={() => play(view.question.promptText)}
                iconLeft={<Volume2 size={20} color={th.color.textStrong} />}
              >
                {t('fc_play_audio')}
              </Button>
            ) : (
              <Title
                style={{ ...th.text.xxl, fontFamily: th.font.displayBold, textAlign: 'center' }}
              >
                {view.question.promptText}
              </Title>
            )}
            <View style={{ width: '100%', maxWidth: 420, gap: th.spacing[3] }}>
              {view.question.options.map((opt, i) => {
                const disabled = Boolean(view.myAnswer);
                return (
                  <Button
                    key={`${i}-${opt}`}
                    variant={view.myAnswer === opt ? 'primary' : 'secondary'}
                    block
                    size="lg"
                    disabled={disabled}
                    onPress={() =>
                      socketRef.current?.send({ type: 'answer', index: view.index, option: opt })
                    }
                  >
                    {opt}
                  </Button>
                );
              })}
            </View>
          </View>
        )}

        {view.phase === 'reveal' && (
          <View style={{ width: '100%', alignItems: 'center', gap: th.spacing[4] }}>
            {view.correctIds.includes(myId) && (
              <Body style={{ color: th.status.success }}>{t('pvp_you_got_it')}</Body>
            )}
            <StandingsList standings={view.standings} myId={myId} />
          </View>
        )}

        {view.phase === 'finish' && (
          <View style={{ alignItems: 'center', gap: th.spacing[4] }}>
            <Title style={{ ...th.text.xl, fontFamily: th.font.displayBold }}>
              {t('pvp_finished')}
            </Title>
            <StandingsList standings={view.standings} myId={myId} />
            <Button variant="primary" onPress={exit}>
              {t('done')}
            </Button>
          </View>
        )}
      </View>
    </Screen>
  );
}

function StandingsList({
  standings,
  myId,
}: {
  standings: { id: string; name: string; score: number; correct: number }[];
  myId: string;
}) {
  const th = useTheme();
  return (
    <View style={{ width: '100%', maxWidth: 400, gap: th.spacing[2] }}>
      {standings.map((s, i) => (
        <View
          key={s.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: th.spacing[3],
            padding: th.spacing[2],
            borderRadius: th.radius.md,
            backgroundColor: s.id === myId ? th.color.brandSoft : 'transparent',
          }}
        >
          <Muted style={{ width: 24 }}>{i + 1}</Muted>
          <Body style={{ flex: 1, fontFamily: s.id === myId ? th.font.bodyBold : th.font.body }}>
            {s.name}
          </Body>
          <Mono>{s.score}</Mono>
        </View>
      ))}
    </View>
  );
}

/** Every 'error' phase code maps to a literal i18n key, so check-i18n can see them all. */
function errorMessageKey(code: string): string {
  switch (code) {
    case 'not_found':
      return 'pvp_error_not_found';
    case 'already_started':
      return 'pvp_error_already_started';
    case 'full':
      return 'pvp_error_full';
    case 'not_host':
      return 'pvp_error_not_host';
    case 'connection_lost':
      return 'pvp_error_connection_lost';
    default:
      return 'pvp_error_generic';
  }
}

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { X } from 'lucide-react-native';
import { orderWordsByMastery } from '@mochi/shared/logic/flashcards';
import type { GameMode } from '@mochi/shared/logic/flashcards';
import { useLang } from '~/lib/i18n';
import { useTopic } from '~/lib/use-topics';
import * as outbox from '~/lib/outbox';
import { useTheme } from '~/theme';
import { Body, Button, Muted, Screen } from '~/ui';
import { OfflineBanner } from '~/ui/OfflineBanner';
import { FlipGame } from '~/games/FlipGame';
import { QuizGame } from '~/games/QuizGame';
import { MatchGame } from '~/games/MatchGame';
import type { GameResult } from '~/games/types';

/**
 * The full-screen game host — the mobile answer to the web's `GameOverlay`
 * (`position: fixed; inset: 0; z-index: 200`).
 *
 * It lives at `app/play/...`, OUTSIDE the `(app)` tab group, which is what removes the tab bar.
 * No CSS, no z-index, no scroll locking: it is simply a different route.
 */
const MODES: GameMode[] = ['flip', 'quiz', 'match'];

export default function PlayScreen() {
  const th = useTheme();
  const { t } = useLang();
  const { slug, mode } = useLocalSearchParams<{ slug: string; mode: string }>();
  const { bundle, loading, unavailableOffline } = useTopic(slug);

  const gameMode = (MODES.includes(mode as GameMode) ? mode : 'flip') as GameMode;
  const exit = React.useCallback(() => router.back(), []);

  /**
   * Adaptive order for flip: words the student gets wrong most often first. `mastery` is empty
   * for staff by design, which the shared helper turns into a plain shuffle.
   */
  const words = React.useMemo(() => {
    if (!bundle) return [];
    return gameMode === 'flip'
      ? orderWordsByMastery(bundle.words, bundle.mastery)
      : bundle.words;
  }, [bundle, gameMode]);

  /**
   * Round finished.
   *
   * The result goes to the local outbox FIRST, then a flush is attempted. That order is the whole
   * offline design in two lines: the student's work is durable before any network call happens, so
   * a dead connection, a crash, or the app being killed mid-flush cannot lose it. The flush is
   * best-effort — `useSync` retries with backoff, and the server dedupes by `clientId`.
   */
  const onFinish = React.useCallback(
    (result: GameResult) => {
      if (!bundle) return;
      void (async () => {
        try {
          await outbox.enqueue(
            {
              topicId: bundle.topic.id,
              mode: result.mode,
              score: result.score,
              total: result.total,
              durationMs: result.durationMs ?? null,
              answers: result.answers,
            },
            new Date(),
          );
          await outbox.flush(new Date());
        } catch {
          // Enqueue failing means SQLite is unavailable, which we cannot fix from here. The score
          // is still on screen; swallowing this is better than a crash on the results panel.
        }
      })();
    },
    [bundle],
  );

  if (unavailableOffline) {
    return (
      <Screen edges={{ top: true, bottom: true }}>
        <View style={{ flex: 1, justifyContent: 'center', padding: th.spacing[6], gap: th.spacing[3] }}>
          <Body>{t('m_not_offline')}</Body>
          <Muted>{t('m_not_offline_sub')}</Muted>
          <Button variant="secondary" onPress={exit}>
            {t('fc_exit')}
          </Button>
        </View>
      </Screen>
    );
  }

  if (!bundle || words.length === 0) {
    return (
      <Screen edges={{ top: true, bottom: true }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: th.spacing[4] }}>
          {loading ? (
            <ActivityIndicator color={th.color.brand} />
          ) : (
            <>
              <Muted>{t('fc_no_words')}</Muted>
              <Button variant="secondary" onPress={exit}>
                {t('fc_exit')}
              </Button>
            </>
          )}
        </View>
      </Screen>
    );
  }

  return (
    // Both insets, here and in the two early returns above: the player is outside the tab group
    // (app/play/, not app/(app)/), so there is no tab bar below it to pad the bottom one.
    <Screen edges={{ top: true, bottom: true }}>
      <StatusBar style="dark" />

      {/* Header: topic name and a way out. Deliberately minimal — the card is the screen. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: th.spacing[3],
          paddingHorizontal: th.spacing[4],
          paddingVertical: th.spacing[2],
          borderBottomWidth: 1,
          borderBottomColor: th.color.borderSubtle,
        }}
      >
        <Body style={{ flex: 1, fontFamily: th.font.bodyBold }} numberOfLines={1}>
          {bundle.topic.name}
        </Body>
        <Button
          variant="secondary"
          iconLeft={<X size={16} color={th.color.textStrong} />}
          onPress={exit}
        >
          {t('fc_exit')}
        </Button>
      </View>

      <OfflineBanner />

      {gameMode === 'flip' ? (
        <FlipGame words={words} onExit={exit} onFinish={onFinish} />
      ) : gameMode === 'quiz' ? (
        <QuizGame words={words} onExit={exit} onFinish={onFinish} />
      ) : (
        <MatchGame words={words} onExit={exit} onFinish={onFinish} />
      )}
    </Screen>
  );
}

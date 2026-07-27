import React from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Check, Volume2, X } from 'lucide-react-native';
import { meaningOf, shuffle } from '@mochi/shared/logic/flashcards';
import {
  ARC_K,
  COMMIT_RATIO,
  DRAG_SLOP_PX,
  EXIT_MS,
  FLICK_MIN_DX,
  FLICK_VX,
  MAX_LIFT_PX,
  MAX_ROT_DEG,
  ROT_PER_PX,
} from '@mochi/shared/logic/flip-gesture';
import { useWordAudio } from '~/lib/use-word-audio';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Body, Button, IconButton, Mono, Muted } from '~/ui';
import type { GameProps } from './types';
import { GameEnd } from './GameEnd';

/**
 * Port of `src/flashcards/game-flip.tsx` — swipe right for "known", left for "still learning",
 * tap to flip.
 *
 * The web version is already written in Reanimated's model, just in DOM: gesture state lives in
 * a ref off the render path, and a rAF callback mutates `el.style.transform`. Here the state is
 * a `useSharedValue` on the UI thread and `useAnimatedStyle` does the painting, so the manual
 * rAF loop disappears.
 *
 * **Three web workarounds are deliberately NOT ported**, per the plan:
 *   - `userSelect: 'none'` — nothing to select in React Native.
 *   - `overflowX: 'clip'` on the wrapper — RN clips children by default, so the fly-out cannot
 *     grow a scrollbar.
 *   - manual `if (|dyRaw| > |dx|) bail` scroll arbitration — gesture-handler's
 *     `activeOffsetX`/`failOffsetY` does it natively.
 *
 * The eight tuning constants come from `@mochi/shared/logic/flip-gesture` and are the single
 * source of truth for how this FEELS. If it feels different from the web, this port is wrong —
 * do not compensate by changing the numbers.
 */

/** Fallback width if the card has not been measured yet. Matches the web's 480px assumption. */
const FALLBACK_WIDTH = 480;

/**
 * `shouldCommit` from the shared module, as a worklet.
 *
 * A worklet may only call code Reanimated has workletized, and `@mochi/shared/logic/flip-gesture`
 * is deliberately plain arithmetic with no React Native concepts in it — calling its
 * `shouldCommit` from `onEnd` would throw at runtime. So the three-line predicate is restated
 * here while the CONSTANTS stay imported: the numbers that decide how this feels still live in
 * exactly one place, shared with the web. Same trade-off the plan calls for with
 * `arcLift`/`arcRotation`.
 *
 * Keep this in lockstep with `shouldCommit()` in shared/logic/flip-gesture.ts.
 *
 * @param vx horizontal velocity in px per MILLISECOND (Reanimated gives px/s — divide by 1000)
 */
function shouldCommitWorklet(dx: number, vx: number, cardWidth: number): boolean {
  'worklet';
  const farEnough = Math.abs(dx) > cardWidth * COMMIT_RATIO;
  const flicked =
    Math.abs(vx) > FLICK_VX && Math.sign(vx) === Math.sign(dx) && Math.abs(dx) > FLICK_MIN_DX;
  return farEnough || flicked;
}

export function FlipGame({ words, onExit, onFinish }: GameProps) {
  const th = useTheme();
  const { t } = useLang();
  const play = useWordAudio();
  const { width: screenW } = useWindowDimensions();

  const [order, setOrder] = React.useState(() => words);
  const [idx, setIdx] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [marks, setMarks] = React.useState<Map<string, boolean>>(new Map());
  const finished = React.useRef(false);

  /** Horizontal drag offset, in px. The single input to every animated style below. */
  const dx = useSharedValue(0);
  const opacity = useSharedValue(1);
  /** Card width, measured on layout. Shared so the commit test can run on the UI thread. */
  const cardW = useSharedValue(Math.min(screenW - 48, FALLBACK_WIDTH));
  /** True while a card is flying out. Blocks input and the buttons, like the web's `exiting` ref. */
  const exiting = useSharedValue(false);

  const done = idx >= order.length;

  React.useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      const answers = order.map((w) => ({ wordId: w.id, correct: marks.get(w.id) === true }));
      onFinish({
        mode: 'flip',
        score: answers.filter((a) => a.correct).length,
        total: order.length,
        answers,
      });
    }
  }, [done, order, marks, onFinish]);

  /**
   * Records a mark and advances. Runs on the JS thread — reached from the gesture via
   * `runOnJS`, and directly from the two buttons.
   */
  const mark = React.useCallback(
    (known: boolean) => {
      const w = order[idx];
      if (!w) return;
      setMarks((m) => new Map(m).set(w.id, known));
      setFlipped(false);
      setIdx((i) => i + 1);
      // Reset for the incoming card. The keyed <Animated.View> remounts with FadeInDown, so
      // these must be back at rest before it appears.
      dx.value = 0;
      opacity.value = 1;
      exiting.value = false;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    },
    [order, idx, dx, opacity, exiting],
  );

  const pan = React.useMemo(
    () =>
      Gesture.Pan()
        // Replaces `touchAction: 'pan-y'` plus the web's manual axis arbitration: the pan only
        // claims the gesture after DRAG_SLOP_PX of horizontal movement, and gives up entirely if
        // the finger goes vertical first — so a vertical drag scrolls the screen instead.
        .activeOffsetX([-DRAG_SLOP_PX, DRAG_SLOP_PX])
        .failOffsetY([-DRAG_SLOP_PX, DRAG_SLOP_PX])
        .onUpdate((e) => {
          'worklet';
          if (exiting.value) return;
          dx.value = e.translationX;
        })
        .onEnd((e) => {
          'worklet';
          if (exiting.value) return;
          // Reanimated reports velocity in px/SECOND; shouldCommit expects px/MILLISECOND.
          // Forget this /1000 and every flick commits — the most likely bug in this file.
          const vx = e.velocityX / 1000;
          if (shouldCommitWorklet(dx.value, vx, cardW.value)) {
            const known = dx.value > 0;
            exiting.value = true;
            // Same toss distance as the web: 1.4 card widths plus a margin, so it is fully gone.
            const exitDx = (known ? 1 : -1) * (cardW.value * 1.4 + 120);
            opacity.value = withTiming(0, { duration: EXIT_MS });
            dx.value = withTiming(
              exitDx,
              { duration: EXIT_MS, easing: Easing.out(Easing.quad) },
              (completed) => {
                'worklet';
                if (completed) runOnJS(mark)(known);
              },
            );
          } else {
            // Abort: spring home. The web uses a cubic-bezier with overshoot; this is the
            // Reanimated equivalent of that bounce.
            dx.value = withSpring(0, { damping: 15, stiffness: 180 });
          }
        }),
    [dx, opacity, cardW, exiting, mark],
  );

  // Toggles via the updater form, so the gesture below never depends on `flipped` — otherwise
  // every flip would rebuild the whole gesture chain.
  const toggleFlip = React.useCallback(() => setFlipped((f) => !f), []);

  const tap = React.useMemo(
    () =>
      Gesture.Tap().onEnd((_e, success) => {
        'worklet';
        if (!success || exiting.value) return;
        runOnJS(toggleFlip)();
      }),
    [exiting, toggleFlip],
  );

  /**
   * `Exclusive` is the replacement for the web's `suppressClick` ref: if the pan recognises the
   * gesture, the tap never fires, so a drag can never also flip the card on release.
   */
  const gesture = React.useMemo(() => Gesture.Exclusive(pan, tap), [pan, tap]);

  const cardStyle = useAnimatedStyle(() => {
    const lift = -Math.min(MAX_LIFT_PX, dx.value * dx.value * ARC_K);
    const rot = Math.max(-MAX_ROT_DEG, Math.min(MAX_ROT_DEG, dx.value * ROT_PER_PX));
    return {
      opacity: opacity.value,
      transform: [{ translateX: dx.value }, { translateY: lift }, { rotate: `${rot}deg` }],
    };
  });

  // The arc/rotation maths above is inlined rather than calling arcLift()/arcRotation() from the
  // shared module: those are plain functions, and a worklet may only call code Reanimated has
  // workletized. The shared file stays the numeric source of truth (ARC_K, MAX_LIFT_PX, …) and
  // gains no React Native concepts, which is what the plan asked for.

  const knownBadgeStyle = useAnimatedStyle(() => {
    const commitPx = Math.max(1, cardW.value * COMMIT_RATIO);
    return { opacity: dx.value > 0 ? Math.min(1, dx.value / commitPx) : 0 };
  });
  const unknownBadgeStyle = useAnimatedStyle(() => {
    const commitPx = Math.max(1, cardW.value * COMMIT_RATIO);
    return { opacity: dx.value < 0 ? Math.min(1, -dx.value / commitPx) : 0 };
  });

  const replay = () => {
    finished.current = false;
    setMarks(new Map());
    setOrder(shuffle(words));
    setIdx(0);
    setFlipped(false);
    dx.value = 0;
    opacity.value = 1;
    exiting.value = false;
  };

  if (done) {
    const known = order.filter((w) => marks.get(w.id) === true).length;
    const unknown = order.filter((w) => marks.get(w.id) !== true);
    return (
      <GameEnd
        headline={`${t('fc_score')}: ${known}/${order.length}`}
        onReplay={replay}
        onExit={onExit}
      >
        {unknown.length > 0 ? (
          <View style={{ width: '100%', maxWidth: 420, gap: th.spacing[2] }}>
            <Body style={{ fontFamily: th.font.bodyBold }}>{t('fc_review_unknown')}</Body>
            {unknown.slice(0, 12).map((w) => (
              <View
                key={w.id}
                style={{
                  flexDirection: 'row',
                  gap: th.spacing[3],
                  paddingVertical: th.spacing[2],
                  borderBottomWidth: 1,
                  borderBottomColor: th.color.borderSubtle,
                }}
              >
                <Body style={{ fontFamily: th.font.bodyMedium }}>{w.word}</Body>
                <Muted style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>
                  {meaningOf(w)}
                </Muted>
              </View>
            ))}
          </View>
        ) : null}
      </GameEnd>
    );
  }

  const w = order[idx];

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: th.spacing[5],
        padding: th.spacing[5],
      }}
    >
      <Muted style={{ fontFamily: th.font.bodyBold }}>
        {idx + 1} / {order.length}
      </Muted>

      <GestureDetector gesture={gesture}>
        <Animated.View
          // Keyed on the word id, exactly like the web: the incoming card is a fresh mount, so
          // its entry animation plays and no stale transform leaks across cards.
          key={w.id}
          entering={FadeInDown.duration(220)}
          onLayout={(e) => {
            cardW.value = e.nativeEvent.layout.width;
          }}
          style={[
            {
              width: '100%',
              maxWidth: FALLBACK_WIDTH,
              aspectRatio: 3 / 2,
              borderRadius: th.radius.lg,
              borderWidth: 1.5,
              borderColor: th.color.borderSubtle,
              backgroundColor: th.color.surfaceCard,
              alignItems: 'center',
              justifyContent: 'center',
              gap: th.spacing[3],
              padding: th.spacing[6],
            },
            th.shadow.md,
            cardStyle,
          ]}
        >
          {/*
            A real 3D flip needs backfaceVisibility on two stacked faces, which is unreliable
            across Android versions. Swapping the content on tap gives the same information with
            no chance of a blank card — and the swipe, not the flip, is this game's gesture.
          */}
          {flipped ? (
            <>
              <Text
                style={{
                  fontFamily: th.font.displayBold,
                  fontSize: th.text.xl.fontSize,
                  color: th.color.textStrong,
                  textAlign: 'center',
                }}
              >
                {meaningOf(w)}
              </Text>
              {w.meaningVi && w.definitionEn ? (
                <Muted style={{ textAlign: 'center' }}>{w.definitionEn}</Muted>
              ) : null}
            </>
          ) : (
            <>
              <Text
                style={{
                  fontFamily: th.font.displayBold,
                  fontSize: th.text.xxl.fontSize,
                  color: th.color.textStrong,
                  textAlign: 'center',
                }}
              >
                {w.word}
              </Text>
              {w.ipa ? <Mono>{w.ipa}</Mono> : null}
              <IconButton label={t('fc_play_audio')} onPress={() => play(w.word, w.audioUrl)}>
                <Volume2 size={22} color={th.color.textBody} />
              </IconButton>
            </>
          )}

          {/* Tinder-style badges, driven straight from dx — the web paints these imperatively. */}
          <Animated.View
            pointerEvents="none"
            style={[
              badgeBase,
              { right: 14, borderColor: th.status.success, transform: [{ rotate: '8deg' }] },
              knownBadgeStyle,
            ]}
          >
            <Text style={{ color: th.status.success, fontFamily: th.font.bodyBold, letterSpacing: 1 }}>
              {t('fc_known').toUpperCase()}
            </Text>
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              badgeBase,
              { left: 14, borderColor: th.status.danger, transform: [{ rotate: '-8deg' }] },
              unknownBadgeStyle,
            ]}
          >
            <Text style={{ color: th.status.danger, fontFamily: th.font.bodyBold, letterSpacing: 1 }}>
              {t('fc_unknown').toUpperCase()}
            </Text>
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      <Muted style={{ textAlign: 'center' }}>
        {t('fc_flip_hint')} · {t('fc_swipe_hint')}
      </Muted>

      <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
        <Button
          variant="danger"
          iconLeft={<X size={16} color="#fff" />}
          onPress={() => mark(false)}
        >
          {t('fc_unknown')}
        </Button>
        <Button
          iconLeft={<Check size={16} color={th.color.textOnBrand} />}
          onPress={() => mark(true)}
        >
          {t('fc_known')}
        </Button>
      </View>
    </View>
  );
}

const badgeBase = {
  position: 'absolute' as const,
  top: 14,
  paddingHorizontal: 12,
  paddingVertical: 4,
  borderWidth: 3,
  borderRadius: 10,
  backgroundColor: '#FFFFFF',
};

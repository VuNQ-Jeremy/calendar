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
import type { FlashcardWordRow } from '~/lib/types';
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

/**
 * The card that has been swiped away but is still flying off screen.
 *
 * The game advances to the next word the instant a swipe COMMITS, not when the exit animation
 * finishes — otherwise the next word cannot appear until the old card has already gone, which is
 * the gap this type exists to close. `flipped` is captured at commit time so a card swiped while
 * showing its meaning keeps showing the meaning on the way out.
 */
type Ghost = { word: FlashcardWordRow; flipped: boolean };

export function FlipGame({ words, onExit, onFinish }: GameProps) {
  const th = useTheme();
  const { t } = useLang();
  const play = useWordAudio();
  const { width: screenW } = useWindowDimensions();

  const [order, setOrder] = React.useState(() => words);
  const [idx, setIdx] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [marks, setMarks] = React.useState<Map<string, boolean>>(new Map());
  /** The outgoing card, mid fly-out. Non-null only during the EXIT_MS window after a commit. */
  const [ghost, setGhost] = React.useState<Ghost | null>(null);
  const finished = React.useRef(false);

  /**
   * Horizontal offset of the card currently in flight, in px. The single input to every animated
   * style below. It follows the finger while dragging, then keeps animating out past the commit —
   * the outgoing card is handed to `ghost` mid-flight and the ghost reads this same value, so the
   * hand-off is pixel-identical and invisible.
   */
  const dx = useSharedValue(0);
  /** Fade of the in-flight card. Only the ghost reads this; the live card is faded by FadeInDown. */
  const opacity = useSharedValue(1);
  /**
   * UI-thread mirror of `ghost != null`. The live card holds still while a ghost is flying, since
   * `dx` belongs to the ghost then. Written from the layout effect, never at commit time — see
   * the note there for why the timing matters.
   */
  const ghosting = useSharedValue(false);
  /** Card width, measured on layout. Shared so the commit test can run on the UI thread. */
  const cardW = useSharedValue(Math.min(screenW - 48, FALLBACK_WIDTH));
  /** True while a card is flying out. Blocks input and the buttons, like the web's `exiting` ref. */
  const exiting = useSharedValue(false);
  /**
   * True once the finger has moved the card at all. The RN analogue of the web's `suppressClick`
   * ref — checked by the tap so a release that ended a drag cannot also flip. Cleared on the NEXT
   * touch-down (pan's `onBegin`), never in the same release dispatch that the tap is guarding.
   */
  const dragged = useSharedValue(false);

  // `idx` runs past the end while the last card is still flying out, so the round is only really
  // over once its ghost has landed. Everything gated on `done` waits for that.
  const done = idx >= order.length && !ghost;

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
   * Records the mark and moves to the next word — at COMMIT time, not when the fly-out ends.
   *
   * The card being left behind is handed to `ghost`, which keeps painting it on top while it
   * finishes flying off. That is the whole trick: the next word can mount and fade in underneath
   * immediately, instead of the screen sitting empty until the exit animation reports back.
   */
  const beginAdvance = React.useCallback(
    (known: boolean) => {
      const w = order[idx];
      if (!w) return;
      setGhost({ word: w, flipped });
      setMarks((m) => new Map(m).set(w.id, known));
      setFlipped(false);
      setIdx((i) => i + 1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    },
    [order, idx, flipped],
  );

  /** The fly-out has landed: drop the ghost, which releases the shared values (effect below). */
  const finishExit = React.useCallback(() => setGhost(null), []);

  /**
   * Keeps the UI thread's view of "is a ghost flying" in step with React, and parks the shared
   * values once nothing is flying.
   *
   * The timing here is the whole ball game, so both halves are deliberate:
   *
   * - `ghosting` is raised HERE and not at commit time. Between a commit and React's re-render the
   *   outgoing card is still the mounted live card, and it has to keep following `dx` so it flies;
   *   raising the flag any earlier would freeze it mid-air for a frame. By the time this effect
   *   runs the ghost has taken over painting it, so freezing the live card is exactly right — the
   *   live card is now the NEXT word, which must sit still at centre.
   * - The reset is withheld until the ghost clears, because `dx`/`opacity` belong to whatever is
   *   in flight. (Keying this on `idx`, as it was before ghosts existed, would now fire at commit
   *   time and snap the outgoing card back to centre.)
   *
   * A layout effect rather than a plain one: a shared-value write reaches the UI thread right away
   * while a setState only queues a render, so running it inside the commit keeps the write from
   * landing a frame early, on the wrong card.
   */
  React.useLayoutEffect(() => {
    ghosting.value = ghost !== null;
    if (ghost) return;
    dx.value = 0;
    opacity.value = 1;
    exiting.value = false;
    dragged.value = false;
  }, [ghost, dx, opacity, exiting, dragged, ghosting]);

  const pan = React.useMemo(
    () =>
      Gesture.Pan()
        // Replaces `touchAction: 'pan-y'` plus the web's manual axis arbitration: the pan only
        // claims the gesture after DRAG_SLOP_PX of horizontal movement, and gives up entirely if
        // the finger goes vertical first — so a vertical drag scrolls the screen instead.
        .activeOffsetX([-DRAG_SLOP_PX, DRAG_SLOP_PX])
        .failOffsetY([-DRAG_SLOP_PX, DRAG_SLOP_PX])
        // Fires on every touch-down, before activation — so this is the one place `dragged` can be
        // cleared without racing the tap it exists to guard.
        .onBegin(() => {
          'worklet';
          dragged.value = false;
        })
        .onUpdate((e) => {
          'worklet';
          dragged.value = true;
          if (exiting.value) return;
          dx.value = e.translationX;
        })
        .onEnd((e, success) => {
          'worklet';
          if (exiting.value) return;
          // Reanimated reports velocity in px/SECOND; shouldCommit expects px/MILLISECOND.
          // Forget this /1000 and every flick commits — the most likely bug in this file.
          const vx = e.velocityX / 1000;
          // `success` is false when the system cancels the pan (back-swipe, notification shade).
          // Without it a cancelled drag could still pass the commit test and throw the card away.
          if (success && shouldCommitWorklet(dx.value, vx, cardW.value)) {
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
                if (completed) runOnJS(finishExit)();
              },
            );
            // Advance NOW, while the card above is still travelling — the next word fades in
            // underneath it and is fully there by the time it clears the screen.
            runOnJS(beginAdvance)(known);
          } else {
            // Abort: spring home. The web uses a cubic-bezier with overshoot; this is the
            // Reanimated equivalent of that bounce.
            dx.value = withSpring(0, { damping: 15, stiffness: 180 });
          }
        }),
    [dx, opacity, cardW, exiting, dragged, beginAdvance, finishExit],
  );

  /**
   * Button-driven advance. Plays the same toss as a swipe, just from a standing start (dx 0), so
   * pressing "I know it" and flicking the card right look and feel like the same action.
   */
  const advance = React.useCallback(
    (known: boolean) => {
      // Check there IS a card before starting anything: `exiting` is only lowered when a ghost
      // clears, so kicking off a fly-out that no ghost follows would wedge input for good.
      if (exiting.value || !order[idx]) return;
      exiting.value = true;
      const exitDx = (known ? 1 : -1) * (cardW.value * 1.4 + 120);
      opacity.value = withTiming(0, { duration: EXIT_MS });
      dx.value = withTiming(
        exitDx,
        { duration: EXIT_MS, easing: Easing.out(Easing.quad) },
        (completed) => {
          'worklet';
          if (completed) runOnJS(finishExit)();
        },
      );
      beginAdvance(known);
    },
    [dx, opacity, cardW, exiting, beginAdvance, finishExit, order, idx],
  );

  // Toggles via the updater form, so the gesture below never depends on `flipped` — otherwise
  // every flip would rebuild the whole gesture chain.
  const toggleFlip = React.useCallback(() => setFlipped((f) => !f), []);

  const tap = React.useMemo(
    () =>
      Gesture.Tap()
        // Without this the tap has NO distance limit, and since the card translates under the
        // finger the pointer never leaves the view either — so a swipe under the 500ms default
        // duration satisfies the tap recogniser too. Same slop the pan activates on.
        .maxDistance(DRAG_SLOP_PX)
        .onEnd((_e, success) => {
          'worklet';
          if (!success || exiting.value || dragged.value) return;
          runOnJS(toggleFlip)();
        }),
    [exiting, dragged, toggleFlip],
  );

  /**
   * Three layers keep a drag from also flipping the card on release, because the obvious one is
   * not enough on its own:
   *   1. `Exclusive` — the tap loses if the pan recognises the gesture.
   *   2. `maxDistance` on the tap — it fails outright past the drag slop.
   *   3. the `dragged` flag — checked in `tap.onEnd`.
   * Layer 1 alone was the original implementation and it flashed the back face mid fly-out: the
   * tap's `onEnd` and the pan's `onEnd` land in the SAME touch-release dispatch, so guarding on
   * `exiting` (which the pan sets) is a race, and `runOnJS` then delivers the flip a frame or two
   * into the 280ms exit. Layers 2 and 3 both decide on movement instead, which is not ordered
   * against the release. (A stray flip now lands on the INCOMING card, since the swipe has already
   * advanced — still wrong, still guarded, just a different wrong.)
   */
  const gesture = React.useMemo(() => Gesture.Exclusive(pan, tap), [pan, tap]);

  /**
   * The live card: follows the finger, then holds still at centre while a ghost is in flight.
   *
   * Deliberately carries NO opacity. The live card's only fade is its FadeInDown entrance, and an
   * animated `opacity` here would fight it — that is what made the incoming word flash solid for a
   * frame and then start fading from zero.
   */
  const cardStyle = useAnimatedStyle(() => {
    if (ghosting.value) {
      return { transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }] };
    }
    const lift = -Math.min(MAX_LIFT_PX, dx.value * dx.value * ARC_K);
    const rot = Math.max(-MAX_ROT_DEG, Math.min(MAX_ROT_DEG, dx.value * ROT_PER_PX));
    return {
      transform: [{ translateX: dx.value }, { translateY: lift }, { rotate: `${rot}deg` }],
    };
  });

  /** The ghost: same arc, same `dx`, plus the fade — it picks up exactly where the live card left off. */
  const ghostStyle = useAnimatedStyle(() => {
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

  // Badges come in pairs: the live card's track the drag and blank out once a ghost owns `dx`,
  // the ghost's keep showing the verdict it was committed with all the way off screen.
  const knownBadgeStyle = useAnimatedStyle(() => {
    const commitPx = Math.max(1, cardW.value * COMMIT_RATIO);
    if (ghosting.value) return { opacity: 0 };
    return { opacity: dx.value > 0 ? Math.min(1, dx.value / commitPx) : 0 };
  });
  const unknownBadgeStyle = useAnimatedStyle(() => {
    const commitPx = Math.max(1, cardW.value * COMMIT_RATIO);
    if (ghosting.value) return { opacity: 0 };
    return { opacity: dx.value < 0 ? Math.min(1, -dx.value / commitPx) : 0 };
  });
  const ghostKnownBadgeStyle = useAnimatedStyle(() => {
    const commitPx = Math.max(1, cardW.value * COMMIT_RATIO);
    return { opacity: dx.value > 0 ? Math.min(1, dx.value / commitPx) : 0 };
  });
  const ghostUnknownBadgeStyle = useAnimatedStyle(() => {
    const commitPx = Math.max(1, cardW.value * COMMIT_RATIO);
    return { opacity: dx.value < 0 ? Math.min(1, -dx.value / commitPx) : 0 };
  });

  const replay = () => {
    finished.current = false;
    setMarks(new Map());
    setOrder(shuffle(words));
    setIdx(0);
    setFlipped(false);
    setGhost(null);
    dx.value = 0;
    opacity.value = 1;
    exiting.value = false;
    dragged.value = false;
  };

  /**
   * The card's contents for one word. Shared by the live card and the ghost so the outgoing card
   * keeps rendering exactly what it did at the moment it was swiped.
   *
   * A real 3D flip needs backfaceVisibility on two stacked faces, which is unreliable across
   * Android versions. Swapping the content on tap gives the same information with no chance of a
   * blank card — and the swipe, not the flip, is this game's gesture.
   */
  const renderFaces = (word: FlashcardWordRow, isFlipped: boolean) =>
    isFlipped ? (
      <>
        <Text
          style={{
            fontFamily: th.font.displayBold,
            fontSize: th.text.xl.fontSize,
            color: th.color.textStrong,
            textAlign: 'center',
          }}
        >
          {meaningOf(word)}
        </Text>
        {word.meaningVi && word.definitionEn ? (
          <Muted style={{ textAlign: 'center' }}>{word.definitionEn}</Muted>
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
          {word.word}
        </Text>
        {word.ipa ? <Mono>{word.ipa}</Mono> : null}
        <IconButton label={t('fc_play_audio')} onPress={() => play(word.word, word.audioUrl)}>
          <Volume2 size={22} color={th.color.textBody} />
        </IconButton>
      </>
    );

  /** Geometry + chrome shared by the live card and the ghost, so they are pixel-identical. */
  const cardBase = {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: th.radius.lg,
    borderWidth: 1.5,
    borderColor: th.color.borderSubtle,
    backgroundColor: th.color.surfaceCard,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: th.spacing[3],
    padding: th.spacing[6],
  };

  /** The two Tinder-style badges, driven straight from dx — the web paints these imperatively. */
  const renderBadges = (knownStyle: typeof knownBadgeStyle, unknownStyle: typeof knownBadgeStyle) => (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          badgeBase,
          { right: 14, borderColor: th.status.success, transform: [{ rotate: '8deg' }] },
          knownStyle,
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
          unknownStyle,
        ]}
      >
        <Text style={{ color: th.status.danger, fontFamily: th.font.bodyBold, letterSpacing: 1 }}>
          {t('fc_unknown').toUpperCase()}
        </Text>
      </Animated.View>
    </>
  );

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
        {Math.min(idx + 1, order.length)} / {order.length}
      </Muted>

      <GestureDetector gesture={gesture}>
        {/*
          Sizing wrapper. The live card and the ghost both fill it absolutely, so the outgoing card
          keeps its exact geometry while the incoming one takes its place in the same slot.
        */}
        <View
          onLayout={(e) => {
            cardW.value = e.nativeEvent.layout.width;
          }}
          style={{ width: '100%', maxWidth: FALLBACK_WIDTH, aspectRatio: 3 / 2 }}
        >
          {w ? (
            <Animated.View
              // Keyed on the word id, exactly like the web: the incoming card is a fresh mount, so
              // its entry animation plays and no stale transform leaks across cards.
              key={w.id}
              entering={FadeInDown.duration(220)}
              style={[cardBase, th.shadow.md, cardStyle]}
            >
              {renderFaces(w, flipped)}
              {renderBadges(knownBadgeStyle, unknownBadgeStyle)}
            </Animated.View>
          ) : null}

          {/*
            The card that was just swiped, still on its way out. Rendered after the live card so it
            stays on top, and inert so the next word underneath is what receives the next gesture.
          */}
          {ghost ? (
            <Animated.View pointerEvents="none" style={[cardBase, th.shadow.md, ghostStyle]}>
              {renderFaces(ghost.word, ghost.flipped)}
              {renderBadges(ghostKnownBadgeStyle, ghostUnknownBadgeStyle)}
            </Animated.View>
          ) : null}
        </View>
      </GestureDetector>

      <Muted style={{ textAlign: 'center' }}>
        {t('fc_flip_hint')} · {t('fc_swipe_hint')}
      </Muted>

      <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
        <Button
          variant="danger"
          iconLeft={<X size={16} color="#fff" />}
          onPress={() => advance(false)}
        >
          {t('fc_unknown')}
        </Button>
        <Button
          iconLeft={<Check size={16} color={th.color.textOnBrand} />}
          onPress={() => advance(true)}
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

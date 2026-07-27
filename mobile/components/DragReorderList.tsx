import React from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

/**
 * Long-press-and-drag reordering.
 *
 * The web reorders assessment types with HTML5 `draggable` plus `dragstart`/`dragover`
 * (`src/screens-config.tsx:156-171`). Those events **do not fire on touch at all** — not
 * partially, not with a polyfill worth shipping — so the interaction has to be rebuilt rather
 * than ported.
 *
 * The obvious dependency for this is `react-native-draggable-flatlist`, and it is deliberately
 * NOT used: its gesture layer is built on `useAnimatedGestureHandler`, which Reanimated 4
 * removed. This app is on Reanimated 4.5 and `react-native-worklets`. Sixty lines of
 * `Gesture.Pan` against the API that is actually installed beats a dependency that would need
 * pinning the whole animation stack backwards.
 *
 * The model is the same one the web's `previewMove` implements: rows are a fixed height, so the
 * target index is `start + round(dy / rowHeight)`, and every row between start and target shifts
 * one slot the other way. The order is committed once, on release — not on every crossing —
 * which is also what the web does (`commitOrder` on `onDragEnd`).
 */
export function DragReorderList<T extends { id: string }>({
  data,
  rowHeight,
  gap = 0,
  onReorder,
  renderRow,
}: {
  data: T[];
  /** Must match what `renderRow` actually renders — the maths has no way to measure it. */
  rowHeight: number;
  gap?: number;
  /** Called once on release, with the full new id order. Not called if nothing moved. */
  onReorder: (ids: string[]) => void;
  renderRow: (item: T, dragging: boolean) => React.ReactNode;
}) {
  const slot = rowHeight + gap;
  const activeIndex = useSharedValue(-1);
  const dy = useSharedValue(0);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  // `data` is read inside the JS-thread commit; a ref keeps the gesture from being rebuilt (and
  // the drag from being cancelled) every time the parent re-renders.
  const dataRef = React.useRef(data);
  dataRef.current = data;

  const begin = React.useCallback((id: string) => {
    setDraggingId(id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);

  const commit = React.useCallback(
    (from: number, to: number) => {
      setDraggingId(null);
      if (from === to || from < 0) return;
      const ids = dataRef.current.map((d) => d.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      onReorder(ids);
    },
    [onReorder],
  );

  return (
    <View style={{ gap }}>
      {data.map((item, index) => (
        <DragRow
          key={item.id}
          index={index}
          count={data.length}
          slot={slot}
          activeIndex={activeIndex}
          dy={dy}
          onBegin={() => begin(item.id)}
          onCommit={commit}
        >
          {renderRow(item, draggingId === item.id)}
        </DragRow>
      ))}
    </View>
  );
}

function DragRow({
  index,
  count,
  slot,
  activeIndex,
  dy,
  onBegin,
  onCommit,
  children,
}: {
  index: number;
  count: number;
  slot: number;
  activeIndex: { value: number };
  dy: { value: number };
  onBegin: () => void;
  onCommit: (from: number, to: number) => void;
  children: React.ReactNode;
}) {
  const gesture = React.useMemo(
    () =>
      Gesture.Pan()
        // A press-and-hold, not a touch-and-slide: these rows live inside a ScrollView, and a
        // pan that claimed the gesture immediately would make the page unscrollable.
        .activateAfterLongPress(220)
        .onStart(() => {
          'worklet';
          activeIndex.value = index;
          dy.value = 0;
          runOnJS(onBegin)();
        })
        .onUpdate((e) => {
          'worklet';
          dy.value = e.translationY;
        })
        .onEnd(() => {
          'worklet';
          const raw = index + Math.round(dy.value / slot);
          const target = Math.max(0, Math.min(count - 1, raw));
          // Settle into the target slot before the list re-renders in the new order, so the row
          // does not visibly jump back to where it started and then teleport.
          dy.value = withTiming((target - index) * slot, { duration: 120 }, (done) => {
            'worklet';
            if (!done) return;
            activeIndex.value = -1;
            dy.value = 0;
            runOnJS(onCommit)(index, target);
          });
        })
        .onFinalize((_e, success) => {
          'worklet';
          // Cancelled mid-drag (a call arrives, the gesture is interrupted): spring home rather
          // than leaving the row stranded off-slot.
          if (success || activeIndex.value !== index) return;
          activeIndex.value = -1;
          dy.value = withSpring(0);
          runOnJS(onCommit)(-1, -1);
        }),
    [index, count, slot, activeIndex, dy, onBegin, onCommit],
  );

  const style = useAnimatedStyle(() => {
    const active = activeIndex.value;
    if (active < 0) return { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0, elevation: 0 };

    if (active === index) {
      return {
        transform: [{ translateY: dy.value }, { scale: 1.02 }],
        // Both, on purpose: iOS honours zIndex, Android needs elevation to paint above siblings.
        zIndex: 10,
        elevation: 10,
      };
    }

    const target = Math.max(0, Math.min(count - 1, active + Math.round(dy.value / slot)));
    let shift = 0;
    if (index > active && index <= target) shift = -slot;
    else if (index < active && index >= target) shift = slot;

    return {
      transform: [{ translateY: withTiming(shift, { duration: 120 }) }, { scale: 1 }],
      zIndex: 0,
      elevation: 0,
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  );
}

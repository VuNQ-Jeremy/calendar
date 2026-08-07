import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { MATCH_ROUND_SIZE, fmtDuration, meaningOf, shuffle } from '@mochi/shared/logic/flashcards';
import { useLang } from '~/lib/i18n';
import { useTheme } from '~/theme';
import { Muted } from '~/ui';
import type { GameProps } from './types';
import { GameEnd } from './GameEnd';

/**
 * Port of `src/flashcards/game-match.tsx`. Tap two tiles; a word and its meaning clear.
 *
 * Two details carried over deliberately:
 *   - A matched tile stays in the layout at `opacity: 0` rather than being removed, so the grid
 *     never reflows under the player's finger mid-round.
 *   - Mistakes are counted per WORD, and a pair is only "perfect" if neither of its tiles was
 *     ever part of a wrong guess. That is what `score` means for this mode.
 */

type Tile = { key: string; wordId: string; kind: 'word' | 'meaning'; label: string };

function buildTiles(words: GameProps['words']) {
  const pairs = shuffle(words).slice(0, MATCH_ROUND_SIZE);
  const tiles: Tile[] = [];
  for (const w of pairs) {
    tiles.push({ key: `${w.id}-w`, wordId: w.id, kind: 'word', label: w.word });
    tiles.push({ key: `${w.id}-m`, wordId: w.id, kind: 'meaning', label: meaningOf(w) });
  }
  return { pairs, tiles: shuffle(tiles) };
}

export function MatchGame({ words, onExit, onFinish, endNote }: GameProps) {
  const th = useTheme();
  const { t } = useLang();

  const [{ pairs, tiles }, setBoard] = React.useState(() => buildTiles(words));
  const [selected, setSelected] = React.useState<Tile | null>(null);
  const [matched, setMatched] = React.useState<Set<string>>(new Set());
  const [wrong, setWrong] = React.useState<Set<string>>(new Set());
  const [mistakes, setMistakes] = React.useState<Map<string, number>>(new Map());
  const [elapsed, setElapsed] = React.useState(0);
  const startedAt = React.useRef(0);
  const finished = React.useRef(false);
  const wrongTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const complete = matched.size === pairs.length && pairs.length > 0;

  React.useEffect(() => {
    // Date.now() rather than the web's performance.now(): RN has performance.now, but Date is
    // enough for a stopwatch and avoids a polyfill difference between Hermes versions.
    startedAt.current = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - startedAt.current), 500);
    return () => {
      clearInterval(id);
      if (wrongTimer.current) clearTimeout(wrongTimer.current);
    };
  }, []);

  React.useEffect(() => {
    if (complete && !finished.current) {
      finished.current = true;
      const duration = Date.now() - startedAt.current;
      const answers = pairs.map((p) => ({ wordId: p.id, correct: !mistakes.get(p.id) }));
      onFinish({
        mode: 'match',
        score: answers.filter((a) => a.correct).length,
        total: pairs.length,
        durationMs: Math.round(duration),
        answers,
      });
    }
  }, [complete, pairs, mistakes, onFinish]);

  const tap = (tile: Tile) => {
    if (matched.has(tile.wordId) || wrong.size > 0) return;
    if (!selected) {
      setSelected(tile);
      return;
    }
    if (selected.key === tile.key) {
      setSelected(null);
      return;
    }
    if (selected.wordId === tile.wordId && selected.kind !== tile.kind) {
      setMatched((m) => new Set(m).add(tile.wordId));
      setSelected(null);
    } else {
      setWrong(new Set([selected.key, tile.key]));
      setMistakes((m) => {
        const next = new Map(m);
        next.set(selected.wordId, (next.get(selected.wordId) ?? 0) + 1);
        next.set(tile.wordId, (next.get(tile.wordId) ?? 0) + 1);
        return next;
      });
      wrongTimer.current = setTimeout(() => {
        setWrong(new Set());
        setSelected(null);
      }, 600);
    }
  };

  const replay = () => {
    finished.current = false;
    setBoard(buildTiles(words));
    setSelected(null);
    setMatched(new Set());
    setWrong(new Set());
    setMistakes(new Map());
    setElapsed(0);
    startedAt.current = Date.now();
  };

  if (complete) {
    const perfect = pairs.filter((p) => !mistakes.get(p.id)).length;
    return (
      <GameEnd
        headline={`${t('fc_time')}: ${fmtDuration(elapsed)}`}
        sub={`${t('fc_pairs_matched')}: ${perfect}/${pairs.length}`}
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
        padding: th.spacing[4],
      }}
    >
      <Muted style={{ fontFamily: th.font.bodyBold }}>
        {t('fc_time')}: {fmtDuration(elapsed)}
      </Muted>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: th.spacing[3],
          justifyContent: 'center',
          maxWidth: 720,
        }}
      >
        {tiles.map((tile) => {
          const isMatched = matched.has(tile.wordId);
          const isSelected = selected?.key === tile.key;
          const isWrong = wrong.has(tile.key);
          return (
            <Pressable
              key={tile.key}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled: isMatched }}
              disabled={isMatched}
              onPress={() => tap(tile)}
              style={{
                // Two per row on a phone, with the gap accounted for.
                width: '47%',
                minHeight: 76,
                paddingHorizontal: th.spacing[3],
                paddingVertical: th.spacing[3],
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: th.radius.md,
                borderWidth: 1.5,
                borderColor: isWrong
                  ? th.category.rose.base
                  : isSelected
                    ? th.color.brand
                    : th.color.borderSubtle,
                backgroundColor: isWrong
                  ? th.category.rose.soft
                  : isSelected
                    ? th.color.brandSoft
                    : th.color.surfaceCard,
                // Keeps the grid from reflowing when a pair clears.
                opacity: isMatched ? 0 : 1,
              }}
            >
              <Text
                numberOfLines={3}
                style={{
                  textAlign: 'center',
                  fontFamily: tile.kind === 'word' ? th.font.bodyBold : th.font.body,
                  fontSize: th.text.sm.fontSize,
                  color: tile.kind === 'word' ? th.color.textStrong : th.color.textBody,
                }}
              >
                {tile.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

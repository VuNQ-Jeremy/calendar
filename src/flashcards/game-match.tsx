import React from 'react';
import { DS } from '../ds/index.js';
import { useLang } from '../lib/i18n.jsx';
import { shuffle, fmtDuration, meaningOf } from './game-utils.js';
import type { GameProps } from './game-utils.js';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';

const { Button: FBtn } = DS;

const ROUND_SIZE = 6;

type Tile = { key: string; wordId: string; kind: 'word' | 'meaning'; label: string };

function buildTiles(words: GameProps['words']) {
  const pairs = shuffle(words).slice(0, ROUND_SIZE);
  const tiles: Tile[] = [];
  for (const w of pairs) {
    tiles.push({ key: `${w.id}-w`, wordId: w.id, kind: 'word', label: w.word });
    tiles.push({ key: `${w.id}-m`, wordId: w.id, kind: 'meaning', label: meaningOf(w) });
  }
  return { pairs, tiles: shuffle(tiles) };
}

export function MatchGame({ words, onExit, onFinish, garden }: GameProps & GardenRoundProps) {
  const { t } = useLang();
  const [{ pairs, tiles }, setBoard] = React.useState(() => buildTiles(words));
  const [selected, setSelected] = React.useState<Tile | null>(null);
  const [matched, setMatched] = React.useState<Set<string>>(new Set());
  const [wrong, setWrong] = React.useState<Set<string>>(new Set());
  const [mistakes, setMistakes] = React.useState<Map<string, number>>(new Map());
  const [elapsed, setElapsed] = React.useState(0);
  const startedAt = React.useRef(0);
  const finished = React.useRef(false);

  const complete = matched.size === pairs.length && pairs.length > 0;

  React.useEffect(() => {
    startedAt.current = performance.now();
    const id = setInterval(() => setElapsed(performance.now() - startedAt.current), 500);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    if (complete && !finished.current) {
      finished.current = true;
      const duration = performance.now() - startedAt.current;
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

  const click = (tile: Tile) => {
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
      setTimeout(() => {
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
    startedAt.current = performance.now();
  };

  if (complete) {
    const perfect = pairs.filter((p) => !mistakes.get(p.id)).length;
    return (
      <div style={endWrap}>
        <div style={{ fontSize: 'var(--text-xl, 28px)', fontWeight: 800 }}>
          {t('fc_round_done')}
        </div>
        <div style={{ fontSize: 'var(--text-lg, 22px)', color: 'var(--text-strong)' }}>
          {t('fc_time')}: {fmtDuration(elapsed)}
        </div>
        <div style={{ color: 'var(--text-muted)' }}>
          {t('fc_pairs_matched')}: {perfect}/{pairs.length}
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
        {t('fc_time')}: {fmtDuration(elapsed)}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 12,
          width: 'min(94vw, 720px)',
        }}
      >
        {tiles.map((tile) => {
          const isMatched = matched.has(tile.wordId);
          const isSelected = selected?.key === tile.key;
          const isWrong = wrong.has(tile.key);
          return (
            <button
              key={tile.key}
              type="button"
              disabled={isMatched}
              onClick={() => click(tile)}
              style={{
                minHeight: 72,
                padding: '10px 12px',
                borderRadius: 'var(--radius-md, 14px)',
                border: '1.5px solid',
                borderColor: isWrong
                  ? 'var(--rose-500, #e11d48)'
                  : isSelected
                    ? 'var(--brand, #f79a4e)'
                    : 'var(--line, #e7e0d6)',
                background: isMatched
                  ? 'transparent'
                  : isWrong
                    ? 'var(--rose-100, #ffe4e6)'
                    : isSelected
                      ? 'var(--brand-soft, #fdeede)'
                      : 'var(--surface, #fff)',
                color: tile.kind === 'word' ? 'var(--text-strong)' : 'var(--text-body)',
                fontWeight: tile.kind === 'word' ? 700 : 500,
                fontSize: 'var(--text-sm)',
                cursor: isMatched ? 'default' : 'pointer',
                opacity: isMatched ? 0 : 1,
                transition: 'opacity .3s, border-color .15s, background .15s',
                visibility: isMatched ? 'hidden' : 'visible',
              }}
            >
              {tile.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const playWrap: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 20,
  padding: 24,
};

const endWrap: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  padding: 24,
};

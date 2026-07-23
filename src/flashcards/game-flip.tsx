import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { playWord } from './audio.js';
import { shuffle } from './game-utils.js';
import type { GameProps } from './game-utils.js';

const { Button: FBtn, IconButton: FIB } = DS;

export function FlipGame({ words, onExit, onFinish }: GameProps) {
  const { t } = useLang();
  const [order, setOrder] = React.useState(() => words);
  const [idx, setIdx] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [marks, setMarks] = React.useState<Map<string, boolean>>(new Map());
  const finished = React.useRef(false);

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

  const mark = (known: boolean) => {
    const w = order[idx];
    setMarks((m) => new Map(m).set(w.id, known));
    setFlipped(false);
    setIdx((i) => i + 1);
  };

  const replay = () => {
    finished.current = false;
    setMarks(new Map());
    setOrder(shuffle(words));
    setIdx(0);
    setFlipped(false);
  };

  if (done) {
    const known = order.filter((w) => marks.get(w.id) === true).length;
    const unknown = order.filter((w) => marks.get(w.id) !== true);
    return (
      <div style={endWrap}>
        <div style={{ fontSize: 'var(--text-xl, 28px)', fontWeight: 800 }}>{t('fc_round_done')}</div>
        <div style={{ fontSize: 'var(--text-lg, 22px)', color: 'var(--text-strong)' }}>
          {t('fc_score')}: {known}/{order.length}
        </div>
        {unknown.length > 0 && (
          <div style={{ width: '100%', maxWidth: 420 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text-strong)' }}>
              {t('fc_review_unknown')}
            </div>
            <div className="m-stack" style={{ gap: 6 }}>
              {unknown.map((w) => (
                <div key={w.id} className="lrow" style={{ padding: '8px 12px' }}>
                  <span style={{ fontWeight: 600 }}>{w.word}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
                    {w.meaningVi}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
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

  const w = order[idx];
  return (
    <div style={playWrap}>
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
        {idx + 1} / {order.length}
      </div>
      <div style={{ perspective: 1200, width: 'min(90vw, 480px)' }}>
        <div
          onClick={() => setFlipped((f) => !f)}
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '3 / 2',
            cursor: 'pointer',
            transformStyle: 'preserve-3d',
            transition: 'transform .4s',
            transform: flipped ? 'rotateY(180deg)' : 'none',
          }}
        >
          <div style={cardFace}>
            <div style={{ fontSize: 'var(--text-xl, 32px)', fontWeight: 800 }}>{w.word}</div>
            {w.ipa && (
              <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
                {w.ipa}
              </div>
            )}
            <FIB
              label={t('fc_play_audio')}
              size="md"
              onClick={(e) => {
                e.stopPropagation();
                playWord(w.word, w.audioUrl);
              }}
            >
              <MIcon name="volume" size={22} />
            </FIB>
          </div>
          <div style={{ ...cardFace, transform: 'rotateY(180deg)' }}>
            <div style={{ fontSize: 'var(--text-lg, 24px)', fontWeight: 700 }}>{w.meaningVi}</div>
            {w.definitionEn && (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', maxWidth: '80%' }}>
                {w.definitionEn}
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
        {t('fc_flip_hint')}
      </div>
      <div className="m-row" style={{ gap: 12 }}>
        <FBtn variant="danger" iconLeft={<MIcon name="x" size={16} />} onClick={() => mark(false)}>
          {t('fc_unknown')}
        </FBtn>
        <FBtn variant="primary" iconLeft={<MIcon name="check" size={16} />} onClick={() => mark(true)}>
          {t('fc_known')}
        </FBtn>
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
  gap: 18,
  padding: 24,
};

const cardFace: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
  background: 'var(--surface, #fff)',
  border: '1px solid var(--line, #e7e0d6)',
  borderRadius: 'var(--radius-lg, 20px)',
  boxShadow: '0 8px 30px rgba(0,0,0,.08)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: 24,
};

import { useLoaderData, useLocation } from 'react-router';
import { useLang } from '../lib/i18n.jsx';
import type { TestRow } from '../../server/services/tests.js';
import type { QuestionRow } from '../../server/services/questions.js';

/**
 * Printable test document. Deliberately plain: hand-written semantic markup plus one inline
 * <style> block, no DS cards or buttons — screen chrome with decorative backgrounds wastes
 * toner and prints badly. No webfont either: a strict CSP blocks external fonts, and system
 * fonts render Vietnamese diacritics fine.
 *
 * On the blank variant the loader has already stripped `answerKey`/`explanation`, so nothing
 * here can leak the key even if a branch were wrong.
 */

type PrintItem = QuestionRow & { points: number };

interface PrintLoaderData {
  test: TestRow;
  items: PrintItem[];
  className: string | null;
  gradeName: string | null;
  totalPoints: number;
  showKey: boolean;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const CSS = `
.print-doc {
  --ink: #000;
  background: #fff;
  color: var(--ink);
  font-family: Georgia, 'Times New Roman', 'Segoe UI', system-ui, serif;
  font-size: 11.5pt;
  line-height: 1.5;
}
/* Screen preview only: roughly an A4 text column. Print uses @page margins instead. */
.print-doc .sheet {
  max-width: 190mm;
  margin: 0 auto;
  padding: 16mm 12mm 24mm;
  box-sizing: border-box;
}
.print-doc h1 { font-size: 17pt; margin: 0 0 4pt; line-height: 1.25; }
.print-doc .meta { font-size: 10pt; margin: 0 0 8pt; }
.print-doc .meta span + span::before { content: ' · '; }
.print-doc .keybanner {
  border: 1.5pt solid var(--ink);
  padding: 3pt 8pt;
  margin: 0 0 8pt;
  font-size: 12pt;
  font-weight: 700;
  letter-spacing: 0.12em;
  display: inline-block;
}
.print-doc .fill {
  display: flex;
  flex-wrap: wrap;
  gap: 4pt 14pt;
  align-items: flex-end;
  margin: 10pt 0 12pt;
  font-size: 11pt;
}
.print-doc .fill > span { display: flex; align-items: flex-end; gap: 4pt; flex: 1 1 auto; }
.print-doc .rule {
  border-bottom: 1pt dotted var(--ink);
  min-width: 28mm;
  flex: 1 1 auto;
  height: 1em;
}
.print-doc .instructions { font-style: italic; margin: 0 0 12pt; }
.print-doc hr { border: 0; border-top: 0.75pt solid var(--ink); margin: 10pt 0 12pt; }
.print-doc ol.qs { list-style: decimal; margin: 0; padding-left: 8mm; }
.print-doc li.q {
  margin: 0 0 11pt;
  break-inside: avoid;
  page-break-inside: avoid;
}
.print-doc .prompt { margin: 0; white-space: pre-wrap; }
/* A shared passage sits outside the numbered list, so it is not itself numbered, and is kept on
   one page with the questions that follow wherever the browser can manage it. */
.print-doc .passage {
  white-space: pre-wrap;
  margin: 0 0 8pt;
  padding: 0 0 0 4mm;
  border-left: 1pt solid var(--ink);
  font-size: 10.5pt;
  break-after: avoid;
  page-break-after: avoid;
}
.print-doc .pts { font-size: 9.5pt; white-space: nowrap; }
.print-doc .hint { font-size: 9.5pt; font-style: italic; }
.print-doc ol.opts { list-style: none; margin: 4pt 0 0; padding: 0 0 0 2mm; }
.print-doc ol.opts li { margin: 0 0 2pt; }
.print-doc .mark { font-family: 'Segoe UI Symbol', system-ui, sans-serif; }
.print-doc .correct { font-weight: 700; }
.print-doc .answer-lines { margin: 5pt 0 0; padding: 0; }
.print-doc .answer-lines .line {
  border-bottom: 0.75pt solid var(--ink);
  height: 9mm;
}
.print-doc .keyline { margin: 4pt 0 0; font-size: 10.5pt; }
.print-doc .explain { margin: 2pt 0 0; font-size: 10pt; font-style: italic; }
.print-doc .empty { font-style: italic; }
.print-toolbar {
  position: fixed;
  top: 8px;
  right: 8px;
  z-index: 50;
  display: flex;
  gap: 8px;
  align-items: center;
  background: #fff;
  border: 1px solid #999;
  border-radius: 6px;
  padding: 6px 8px;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: #000;
}
.print-toolbar button {
  font: inherit;
  padding: 3px 10px;
  border: 1px solid #666;
  border-radius: 4px;
  background: #f2f2f2;
  color: #000;
  cursor: pointer;
}
.print-toolbar a { color: #0645ad; }
@media print {
  .no-print { display: none !important; }
  .print-doc .sheet { max-width: none; margin: 0; padding: 0; }
}
@page { margin: 18mm; }
`;

function Rule() {
  return <span className="rule" aria-hidden="true" />;
}

function AnswerLines({ n }: { n: number }) {
  return (
    <div className="answer-lines" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div className="line" key={i} />
      ))}
    </div>
  );
}

/** The stored answerKey is an option id (mcq), a list of them (multi), or free text. */
function keyIds(answerKey: QuestionRow['answerKey']): string[] {
  if (answerKey == null) return [];
  return Array.isArray(answerKey) ? answerKey : [answerKey];
}

export function TestPrintView() {
  const { test, items, className, gradeName, totalPoints, showKey } =
    useLoaderData() as PrintLoaderData;
  const { t } = useLang();
  const location = useLocation();

  const toggleHref = showKey ? location.pathname : `${location.pathname}?key=1`;

  return (
    <div className="print-doc">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="print-toolbar no-print">
        <button type="button" onClick={() => window.print()}>
          {t('print_btn')}
        </button>
        <a href={toggleHref}>{showKey ? t('print_hide_key') : t('print_show_key')}</a>
      </div>

      <div className="sheet">
        {showKey ? <div className="keybanner">{t('print_answer_key')}</div> : null}

        <h1>{test.title}</h1>
        <p className="meta">
          {className ? (
            <span>
              {t('print_class')}: {className}
            </span>
          ) : null}
          {gradeName ? (
            <span>
              {t('print_grade')}: {gradeName}
            </span>
          ) : null}
          {test.date ? (
            <span>
              {t('print_date')}: {test.date}
            </span>
          ) : null}
          {test.timeLimitMinutes ? (
            <span>{t('print_time_limit', { n: test.timeLimitMinutes })}</span>
          ) : null}
          <span>{t('print_total_points', { n: totalPoints })}</span>
        </p>

        {/* Student-fill line. The blanks are dotted CSS rules, not rows of underscores. */}
        {!showKey ? (
          <div className="fill">
            <span>
              {t('print_name_line')}: <Rule />
            </span>
            <span>
              {t('print_class')}: <Rule />
            </span>
            <span>
              {t('print_date')}: <Rule />
            </span>
          </div>
        ) : null}

        {test.instructions ? <p className="instructions">{test.instructions}</p> : null}

        <hr />

        {items.length === 0 ? (
          <p className="empty">{t('print_empty')}</p>
        ) : (
          <ol className="qs">
            {items.map((q, qIndex) => {
              const correct = keyIds(q.answerKey);
              // The passage prints once, above the first question of the run that shares it —
              // inside the <li> so the numbering stays continuous.
              const showContext = q.context && q.context !== (items[qIndex - 1]?.context ?? null);
              return (
                <li className="q" key={q.id}>
                  {showContext ? <p className="passage">{q.context}</p> : null}
                  <p className="prompt">
                    {q.prompt}{' '}
                    <span className="pts">{t('print_points_suffix', { n: q.points })}</span>
                    {q.type === 'multi' ? (
                      <span className="hint"> {t('print_multi_hint')}</span>
                    ) : null}
                  </p>

                  {q.type === 'mcq' || q.type === 'multi' ? (
                    <ol className="opts">
                      {q.options.map((opt, i) => {
                        const isCorrect = showKey && correct.includes(opt.id);
                        return (
                          <li key={opt.id} className={isCorrect ? 'correct' : undefined}>
                            <span className="mark" aria-hidden="true">
                              {q.type === 'multi' ? '□' : '○'}
                            </span>{' '}
                            {LETTERS[i] ?? String(i + 1)}. {opt.text}
                            {isCorrect ? ' ✓' : null}
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}

                  {q.type === 'text' ? (
                    showKey ? (
                      <p className="keyline">
                        {t('print_accepted')}: {correct.join(' / ')}
                      </p>
                    ) : (
                      <AnswerLines n={1} />
                    )
                  ) : null}

                  {q.type === 'essay' ? (
                    showKey ? (
                      <p className="keyline">{t('print_essay_manual')}</p>
                    ) : (
                      <AnswerLines n={7} />
                    )
                  ) : null}

                  {showKey && q.explanation ? <p className="explain">{q.explanation}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

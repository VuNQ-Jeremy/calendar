import React from 'react';
import { useLoaderData } from 'react-router';
import { DS } from '../ds/index.js';
import { Empty, PageHeader } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import type { ExcuseRow, StudentTaskRow } from '../../server/services/practice.js';
import type { StudentRow } from '../../server/services/people.js';
import type { ClassLite } from '../../server/services/classes.js';
import { dm, TextArea, usePracticeSubmit, type PracticeSubmit } from './common.jsx';

const { Card, Button, Tag } = DS;

interface ReviewLoaderData {
  queue: StudentTaskRow[];
  excuses: ExcuseRow[];
  students: StudentRow[];
  classes: ClassLite[];
  materialTitles: Record<string, string>;
}

/**
 * One queue for the whole school, newest first.
 *
 * The proof is rendered inline (an `<img>`/`<video>` pointed at /practice-media) rather than
 * behind a lightbox: the teacher's job here is to glance and press Accept, and a click-to-open
 * step doubles the work on a class of thirty.
 */
export function PracticeReviewScreen() {
  const { queue, excuses, students, classes, materialTitles } = useLoaderData() as ReviewLoaderData;
  const { t } = useLang();
  // Owned by the screen, not by a card: a card unmounts the moment its row leaves the queue, and
  // `useFetcher`'s cleanup aborts whatever it had in flight. See usePracticeSubmit.
  const submit = usePracticeSubmit();

  const nameOf = (id: string) => students.find((s) => s.id === id)?.name ?? id;
  const classOf = (id: string) => classes.find((c) => c.id === id)?.name ?? '';

  return (
    <div className="pr-review">
      <PageHeader title={t('pr_review_queue')} subtitle={t('pr_sub')} />

      {excuses.length > 0 && (
        <section className="pr-review__excuses">
          <h3>{t('pr_excuses_pending')}</h3>
          {excuses.map((e) => (
            <Card key={e.id} flat className="pr-review__excuse">
              <div>
                <strong>{nameOf(e.studentId)}</strong> · {classOf(e.classId)} · {dm(e.date)}
              </div>
              <div className="pr-review__reason">{e.reason}</div>
              <div className="pr-review__excuse-actions">
                <Button
                  size="sm"
                  onClick={() =>
                    submit({ intent: 'excuse-decide', excuseId: e.id, decision: 'approve' })
                  }
                >
                  {t('pr_approve')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    submit({ intent: 'excuse-decide', excuseId: e.id, decision: 'reject' })
                  }
                >
                  {t('pr_reject')}
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {queue.length === 0 ? (
        <Empty icon="check" title={t('pr_queue_empty')} />
      ) : (
        <div className="pr-review__queue">
          {queue.map((row) => (
            <QueueCard
              key={row.id}
              row={row}
              studentName={nameOf(row.studentId)}
              className={classOf(row.classId)}
              materialTitle={row.materialId ? (materialTitles[row.materialId] ?? null) : null}
              submit={submit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QueueCard({
  row,
  studentName,
  className,
  materialTitle,
  submit,
}: {
  row: StudentTaskRow;
  studentName: string;
  className: string;
  materialTitle: string | null;
  submit: PracticeSubmit;
}) {
  const { t } = useLang();
  const [feedback, setFeedback] = React.useState(row.feedback ?? '');
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState('');

  // The key contains slashes; the route matches a single `:key` segment, so it must be encoded.
  const mediaSrc = row.mediaKey ? `/practice-media/${encodeURIComponent(row.mediaKey)}` : null;
  const isVideo = (row.mediaType ?? '').startsWith('video/');

  return (
    <Card className="pr-review__card">
      <div className="pr-review__head">
        <strong>{studentName}</strong>
        <span>{className}</span>
        <span>{dm(row.date)}</span>
      </div>
      <div className="pr-review__title">{row.title}</div>
      {materialTitle && <Tag>{materialTitle}</Tag>}

      {(row.timeFrom || row.timeTo) && (
        <div className="pr-review__line">
          <span className="pr-review__label">{t('pr_time')}</span>
          {`${row.timeFrom ?? '—'}–${row.timeTo ?? '—'}`}
        </div>
      )}
      {row.note && (
        <div className="pr-review__line">
          <span className="pr-review__label">{t('pr_note')}</span>
          {row.note}
        </div>
      )}

      {mediaSrc &&
        (isVideo ? (
          <video className="pr-review__media" src={mediaSrc} controls preload="metadata" />
        ) : (
          <img className="pr-review__media" src={mediaSrc} alt={row.title} />
        ))}

      <TextArea label={t('pr_feedback')} value={feedback} onChange={setFeedback} rows={3} />

      <div className="pr-review__actions">
        <Button
          variant="secondary"
          onClick={() =>
            submit({ intent: 'review', studentTaskId: row.id, decision: 'feedback', feedback })
          }
        >
          {t('pr_save_feedback')}
        </Button>
        <Button
          onClick={() =>
            submit({ intent: 'review', studentTaskId: row.id, decision: 'accept', feedback })
          }
        >
          {t('pr_accept')}
        </Button>
        {rejecting ? (
          <>
            <DS.Input
              label={t('pr_reject_reason')}
              value={reason}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
            />
            <Button
              variant="danger"
              onClick={() =>
                submit({
                  intent: 'review',
                  studentTaskId: row.id,
                  decision: 'reject',
                  rejectReason: reason,
                  feedback,
                })
              }
            >
              {t('pr_reject')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setRejecting(true)}>
            {t('pr_reject')}
          </Button>
        )}
      </div>
    </Card>
  );
}

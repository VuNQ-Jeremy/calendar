import React from 'react';
import { useLoaderData, useFetcher, useNavigate } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { Modal, MSelect, ColorPicker, PageHeader, Empty, useConfirm } from '../ui.jsx';
import { colorOf } from '../lib/core.js';
import { useLang } from '../lib/i18n.jsx';
import { fetchGeneratedWords } from '../lib/generate-client.js';
import { mapWithConcurrency } from '../lib/vocab-image-client.js';
import { ImageStrip, emptyChoice, loadChoice, resolvePickedImageKey } from './image-strip.js';
import type { ImageChoice } from './image-strip.js';
import { VOCAB_TOPICS, vocabTopicLabel } from '../../shared/logic/vocab-topics';
import { formatDmy } from '../../shared/logic/tuition.js';
import { GardenWidget } from '../garden/garden-widget.jsx';
import { AssignModal } from '../garden/assign-modal.jsx';
import { parseModes } from '../../shared/logic/flashcards';
import type {
  AssignmentBlock,
  StaffGardenData,
  StudentGardenData,
} from '../garden/garden-widget.jsx';
import type { FlashcardTopicRow } from '../../server/services/flashcards.js';
import type { VocabAssignmentRow } from '../../server/services/garden.js';

const { Card: FC, Button: FBtn, IconButton: FIB, Input: FInput, Checkbox: FCheck, Badge, Tag } = DS;

/** Overdue ink. A literal palette hex, so it reads the same in both themes. */
const DANGER = colorOf('rose');

type LoaderData = {
  topics: FlashcardTopicRow[];
  kind: 'staff' | 'student';
  canUseAi: boolean;
  /** Student only, and null while the garden's tables are missing — see the route's loadGarden. */
  garden: StudentGardenData | null;
  /** Staff only, same null contract. */
  gardenStaff: StaffGardenData | null;
  /** Student only, null while the review columns are missing — see the route's loadReview. */
  review: ReviewData | null;
};

/** Today's review backlog, grouped by topic. `total` is the sum, and what the sidebar badge shows. */
type ReviewData = {
  today: string;
  total: number;
  groups: {
    topic: { id: string; name: string; slug: string | null; color: string };
    wordIds: string[];
  }[];
};

/**
 * Ôn tập hôm nay — the words that have come round again, by topic.
 *
 * Shown only when something is actually due: an empty "nothing to review" card would sit under the
 * plant every day saying nothing. The counts are the server's, computed against ICT today, so this
 * agrees with the sidebar badge by construction rather than by coincidence.
 */
function ReviewCard({ review }: { review: ReviewData }) {
  const navigate = useNavigate();
  const { t } = useLang();

  return (
    <FC style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
        <MIcon name="repeat" size={20} />
        <strong style={{ fontSize: 'var(--text-lg)' }}>{t('fc_review_title')}</strong>
        <Badge>{review.total}</Badge>
      </div>
      <div className="m-stack" style={{ gap: 8 }}>
        {review.groups.map((g) => {
          const c = colorOf(g.topic.color);
          return (
            <div
              key={g.topic.id}
              className="m-row"
              style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: c.ink,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, minWidth: 160 }}>
                {t('fc_review_due_topic', { n: g.wordIds.length, topic: g.topic.name })}
              </span>
              <FBtn
                variant="secondary"
                onClick={() => navigate(`/vocabulary/${g.topic.slug ?? g.topic.id}?review=1`)}
              >
                {t('fc_review_now')}
              </FBtn>
            </div>
          );
        })}
      </div>
    </FC>
  );
}

interface TopicDraft {
  id?: string;
  name: string;
  description: string;
  color: string;
}

export function FlashcardTopicsScreen() {
  const { topics, kind, canUseAi, garden, gardenStaff, review } = useLoaderData() as LoaderData;
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const { t } = useLang();
  const [modal, setModal] = React.useState<TopicDraft | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [assigning, setAssigning] = React.useState<{
    topic: { id: string; name: string };
    existing: VocabAssignmentRow | null;
  } | null>(null);
  const [tracking, setTracking] = React.useState<AssignmentBlock | null>(null);
  const [confirm, confirmNode] = useConfirm();
  const isStaff = kind === 'staff';

  // Open = the deadline has not passed in ICT. `today` comes from the loader, never from the
  // device clock, so a teacher abroad sees the school's day.
  const openByTopic = React.useMemo(() => {
    const map = new Map<string, VocabAssignmentRow[]>();
    for (const b of gardenStaff?.assignments ?? []) {
      if (b.assignment.deadline < (gardenStaff?.today ?? '')) continue;
      const list = map.get(b.assignment.topicId) ?? [];
      list.push(b.assignment);
      map.set(b.assignment.topicId, list);
    }
    return map;
  }, [gardenStaff]);

  // The generate-topic action replies with the new topic, so land the teacher straight in it.
  const generated = fetcher.data as { topic?: { slug: string | null; id: string } } | undefined;
  React.useEffect(() => {
    const created = generated?.topic;
    if (created) navigate(`/vocabulary/${created.slug ?? created.id}`);
  }, [generated, navigate]);

  const save = (f: TopicDraft) => {
    if (!f.name.trim()) return;
    const fd = new FormData();
    fd.set('intent', f.id ? 'update' : 'create');
    if (f.id) fd.set('id', f.id);
    fd.set('name', f.name);
    fd.set('description', f.description);
    fd.set('color', f.color);
    fetcher.submit(fd, { method: 'post' });
    setModal(null);
  };

  const del = async (topic: FlashcardTopicRow) => {
    // Assignments cascade away with their topic, so the classes that would lose homework are
    // named in the confirm rather than discovered afterwards.
    const assigned = openByTopic.get(topic.id) ?? [];
    const classes = [...new Set(assigned.map((a) => a.className))].join(', ');
    const ok = await confirm({
      title: t('fc_delete_topic'),
      message:
        t('fc_delete_topic_msg', { name: topic.name }) +
        (classes ? ' ' + t('garden_topic_assigned_warning', { classes }) : ''),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'delete');
    fd.set('id', topic.id);
    fetcher.submit(fd, { method: 'post' });
  };

  const submitAssign = (fd: FormData) => {
    fetcher.submit(fd, { method: 'post' });
    setAssigning(null);
  };

  const delAssignment = async (block: AssignmentBlock) => {
    const ok = await confirm({
      title: t('garden_delete_assignment'),
      message: t('garden_delete_assignment_msg', { topic: block.assignment.topicName }),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set('intent', 'assign-delete');
    fd.set('id', block.assignment.id);
    fetcher.submit(fd, { method: 'post' });
  };

  return (
    <div className="content">
      <PageHeader
        title={t('fc_title')}
        subtitle={t('fc_subtitle')}
        actions={
          isStaff && (
            <span className="m-row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {canUseAi && (
                <FBtn
                  variant="secondary"
                  iconLeft={<MIcon name="sparkle" size={18} />}
                  onClick={() => setGenerating(true)}
                >
                  {t('fc_gen_new_btn')}
                </FBtn>
              )}
              <FBtn
                variant="primary"
                iconLeft={<MIcon name="plus" size={18} />}
                onClick={() => setModal({ name: '', description: '', color: 'violet' })}
              >
                {t('fc_new_topic')}
              </FBtn>
            </span>
          )
        }
      />
      {!isStaff && <GardenWidget data={garden} />}
      {!isStaff && review && review.total > 0 && <ReviewCard review={review} />}
      {topics.length ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          {topics.map((topic) => {
            const c = colorOf(topic.color);
            return (
              <FC
                key={topic.id}
                interactive={true}
                onClick={() => navigate(`/vocabulary/${topic.slug ?? topic.id}`)}
                style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                <div className="m-row" style={{ gap: 10, alignItems: 'center' }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 999,
                      background: c.base,
                      flexShrink: 0,
                    }}
                  />
                  <div
                    style={{
                      fontWeight: 700,
                      color: 'var(--text-strong)',
                      fontSize: 'var(--text-md)',
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {topic.name}
                  </div>
                </div>
                {isStaff && (
                  // Own row below the name: the icons crowded the title into an ellipsis at the
                  // card's 240px minimum.
                  //
                  // The card itself navigates on click, so every BUTTON here stops the event —
                  // opening a dialog must not also leave the page. Deliberately per-button and
                  // not on this container: with three icons the container's own dead space sits
                  // right under the middle of the card, and swallowing clicks there turned "click
                  // the card to open the topic" into a coin flip.
                  <div
                    className="lrow__actions"
                    // -6 against the card's 10px column gap: the buttons should read as belonging
                    // to the title above them, not float equidistant between title and description.
                    style={{ alignSelf: 'flex-start', marginTop: -6 }}
                  >
                    {gardenStaff && (
                      <FIB
                        label={t('garden_assign')}
                        size="sm"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          setAssigning({
                            topic: { id: topic.id, name: topic.name },
                            existing: null,
                          });
                        }}
                      >
                        <MIcon name="sprout" size={16} />
                      </FIB>
                    )}
                    <FIB
                      label={t('edit')}
                      size="sm"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        setModal({
                          id: topic.id,
                          name: topic.name,
                          description: topic.description ?? '',
                          color: topic.color,
                        });
                      }}
                    >
                      <MIcon name="edit" size={16} />
                    </FIB>
                    <FIB
                      label={t('delete')}
                      size="sm"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        del(topic);
                      }}
                    >
                      <MIcon name="trash" size={16} />
                    </FIB>
                  </div>
                )}
                {topic.description && (
                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 'var(--text-sm)',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical' as React.CSSProperties['WebkitBoxOrient'],
                      overflow: 'hidden',
                    }}
                  >
                    {topic.description}
                  </div>
                )}
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  {t('fc_word_count', { n: topic.wordCount })}
                </div>
                {(openByTopic.get(topic.id) ?? []).length > 0 && (
                  <span style={{ alignSelf: 'flex-start' }}>
                    <Tag color="orange" dot={false}>
                      {t('garden_assigned_tag', {
                        date: formatDmy(openByTopic.get(topic.id)![0].deadline),
                      })}
                    </Tag>
                  </span>
                )}
              </FC>
            );
          })}
        </div>
      ) : (
        <FC>
          <Empty
            icon="sparkle"
            title={t('fc_no_topics')}
            sub={isStaff ? t('fc_no_topics_sub') : undefined}
          />
        </FC>
      )}

      {isStaff && gardenStaff && (
        <AssignmentsPanel
          data={gardenStaff}
          onEdit={(block) =>
            setAssigning({
              topic: { id: block.assignment.topicId, name: block.assignment.topicName },
              existing: block.assignment,
            })
          }
          onTrack={setTracking}
          onDelete={delAssignment}
        />
      )}

      {modal && (
        <TopicModal
          draft={modal}
          setDraft={setModal}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
      {generating && <GenerateTopicModal fetcher={fetcher} onClose={() => setGenerating(false)} />}
      {assigning && gardenStaff && (
        <AssignModal
          topic={assigning.topic}
          classes={gardenStaff.classes}
          existing={assigning.existing}
          today={gardenStaff.today}
          onClose={() => setAssigning(null)}
          onSubmit={submitAssign}
        />
      )}
      {tracking && gardenStaff && (
        <TrackModal block={tracking} today={gardenStaff.today} onClose={() => setTracking(null)} />
      )}
      {confirmNode}
    </div>
  );
}

// ---- Assignments (staff) ----

function AssignmentsPanel({
  data,
  onEdit,
  onTrack,
  onDelete,
}: {
  data: StaffGardenData;
  onEdit: (block: AssignmentBlock) => void;
  onTrack: (block: AssignmentBlock) => void;
  onDelete: (block: AssignmentBlock) => void;
}) {
  const { t } = useLang();
  return (
    <FC style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 'var(--text-md)' }}>
        {t('garden_assignments')}
      </div>
      {data.assignments.length ? (
        <div className="m-stack" style={{ gap: 8, marginTop: 10 }}>
          {data.assignments.map((block) => {
            const a = block.assignment;
            const overdue = a.deadline < data.today;
            const done = block.rows.filter((r) => r.done >= a.requiredCount).length;
            return (
              <div key={a.id} className="lrow" style={{ alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="m-row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>
                      {a.topicName}
                    </span>
                    <Tag color={a.classColor} dot={false}>
                      {a.className}
                    </Tag>
                    {(parseModes(a.modes) ?? []).map((m) => (
                      <Tag key={m} color="violet" dot={false}>
                        {t(`fc_mode_${m}`)}
                      </Tag>
                    ))}
                  </div>
                  <div
                    className="m-row"
                    style={{ gap: 12, flexWrap: 'wrap', fontSize: 'var(--text-sm)', marginTop: 2 }}
                  >
                    <span style={{ color: overdue ? DANGER.ink : 'var(--text-muted)' }}>
                      {t('garden_deadline')}: {formatDmy(a.deadline)}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {t('garden_required')}: {a.requiredCount}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {done}/{block.rows.length}
                    </span>
                  </div>
                </div>
                <div className="lrow__actions">
                  <FBtn variant="soft" size="sm" onClick={() => onTrack(block)}>
                    {t('garden_track')}
                  </FBtn>
                  <FIB label={t('edit')} size="sm" onClick={() => onEdit(block)}>
                    <MIcon name="edit" size={16} />
                  </FIB>
                  <FIB label={t('delete')} size="sm" onClick={() => onDelete(block)}>
                    <MIcon name="trash" size={16} />
                  </FIB>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty icon="clipboard" title={t('garden_no_assignments')} />
      )}
    </FC>
  );
}

function TrackModal({
  block,
  today,
  onClose,
}: {
  block: AssignmentBlock;
  today: string;
  onClose: () => void;
}) {
  const { t } = useLang();
  const required = block.assignment.requiredCount;
  const overdue = block.assignment.deadline < today;
  // Behind first: this table is the accountability view, so the students who still owe rounds are
  // the ones the teacher should not have to scroll for.
  const rows = React.useMemo(
    () =>
      [...block.rows].sort(
        (a, b) =>
          (a.done >= required ? 1 : 0) - (b.done >= required ? 1 : 0) ||
          a.done - b.done ||
          a.name.localeCompare(b.name),
      ),
    [block.rows, required],
  );
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t('garden_track_title', { topic: block.assignment.topicName })}
      subtitle={`${block.assignment.className} · ${t('garden_deadline')}: ${formatDmy(block.assignment.deadline)}`}
      width={480}
      footer={
        <FBtn variant="secondary" onClick={onClose}>
          {t('close')}
        </FBtn>
      }
    >
      {rows.length ? (
        <div className="m-stack" style={{ gap: 6 }}>
          {rows.map((r) => {
            const done = r.done >= required;
            return (
              <div key={r.studentId} className="lrow" style={{ alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: colorOf(r.color).base,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, color: 'var(--text-strong)' }}>{r.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  {r.done}/{required}
                </span>
                <Badge color={done ? 'success' : overdue ? 'danger' : 'neutral'}>
                  {done
                    ? t('garden_status_done')
                    : overdue
                      ? t('garden_status_late')
                      : t('garden_status_pending')}
                </Badge>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty icon="users" title={t('garden_no_assignments')} />
      )}
    </Modal>
  );
}

interface TopicModalProps {
  draft: TopicDraft;
  setDraft: React.Dispatch<React.SetStateAction<TopicDraft | null>>;
  onClose: () => void;
  onSave: (f: TopicDraft) => void;
}

function TopicModal({ draft, setDraft, onClose, onSave }: TopicModalProps) {
  const { t } = useLang();
  const set = <K extends keyof TopicDraft>(k: K, v: TopicDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={draft.id ? t('fc_edit_topic') : t('fc_new_topic')}
      width={480}
      footer={
        <>
          <FBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </FBtn>
          <FBtn variant="primary" onClick={() => onSave(draft)}>
            {t('save')}
          </FBtn>
        </>
      }
    >
      <FInput
        label={t('fc_topic_name')}
        autoFocus={true}
        value={draft.name}
        onChange={(e) => set('name', e.target.value)}
      />
      <div className="mochi-field">
        <label className="mochi-field__label">{t('fc_description')}</label>
        <textarea
          className="mochi-input"
          rows={3}
          style={{ resize: 'vertical', minHeight: 72, paddingTop: 10 }}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <ColorPicker label={t('color')} value={draft.color} onChange={(v) => set('color', v)} />
    </Modal>
  );
}

// ---- AI topic generation ----

type GenRow = {
  word: string;
  meaningVi: string;
  definitionEn: string;
  ipa: string;
  include: boolean;
  /** Stock-search keywords the model proposed; '' falls back to the word itself. */
  imageQuery: string;
  /**
   * The row's candidate pictures and which one is chosen. A stock pick stays uncommitted until
   * save, so abandoning the review copies nothing into the bucket; an AI illustration is already
   * stored (see PickedImage).
   */
  choice: ImageChoice;
};

const GEN_LEVELS = ['any', 'beginner', 'intermediate', 'advanced'] as const;

/**
 * Create a whole topic from a name: pick from the curated list (or type your own), let Claude
 * propose the words, review them, then save. The topic and its words are written in one action
 * (`generate-topic`), so an abandoned review never leaves an empty topic behind.
 */
function GenerateTopicModal({
  fetcher,
  onClose,
}: {
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
}) {
  const { t, lang } = useLang();
  const [step, setStep] = React.useState<'setup' | 'review'>('setup');
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('violet');
  const [count, setCount] = React.useState('20');
  const [level, setLevel] = React.useState<(typeof GEN_LEVELS)[number]>('any');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<GenRow[]>([]);
  const [saving, setSaving] = React.useState(false);

  // Picking from the catalog fills the name field rather than hiding a second value: the name is
  // both what the topic is called and what the model is asked for, and it stays editable.
  const pick = (id: string) => {
    if (id === 'custom') {
      setName('');
      return;
    }
    setName(VOCAB_TOPICS.find((vt) => vt.id === id)?.en ?? '');
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    const res = await fetchGeneratedWords({
      topic: name.trim(),
      count: Math.min(Math.max(parseInt(count, 10) || 20, 1), 50),
      level: level === 'any' ? null : level,
      exclude: [],
    });
    setBusy(false);
    if (!res.ok) {
      setError(t(res.error === 'disabled' ? 'fc_gen_disabled' : 'fc_gen_failed'));
      return;
    }
    if (res.words.length === 0) {
      setError(t('fc_gen_empty'));
      return;
    }
    const next: GenRow[] = res.words.map((w) => ({
      word: w.word,
      meaningVi: w.meaningVi,
      definitionEn: w.definitionEn ?? '',
      ipa: w.ipa ?? '',
      include: true,
      imageQuery: w.imageQuery ?? '',
      choice: { ...emptyChoice, status: 'loading' as const },
    }));
    setRows(next);
    setStep('review');
    // Find a candidate picture per word in the background. The review is usable immediately —
    // each row swaps its placeholder for a thumbnail as its lookup lands, and a word whose search
    // finds nothing simply shows no picture. A small pool keeps ~50 lookups polite.
    void mapWithConcurrency(next, 4, async (row, i) => {
      const patch = await loadChoice(row.imageQuery || row.word);
      // The first result is preselected, so a teacher who likes it does nothing at all; the rest of
      // the batch sits beside it for a one-tap change.
      const top = patch.candidates?.[0];
      setChoice(i, {
        ...patch,
        picked: top
          ? { kind: 'stock', provider: top.provider, id: top.id, thumbUrl: top.thumbUrl }
          : null,
      });
    });
  };

  const setRow = (i: number, patch: Partial<GenRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  /** Patch one row's picture state. Merges, so a strip can report `{status}` without the rest. */
  const setChoice = (i: number, patch: Partial<ImageChoice>) =>
    setRows((rs) =>
      rs.map((r, idx) => (idx === i ? { ...r, choice: { ...r.choice, ...patch } } : r)),
    );

  const readyCount = rows.filter((r) => r.include && r.word.trim()).length;

  const submit = async () => {
    const kept = rows.filter((r) => r.include && r.word.trim());
    if (kept.length === 0 || !name.trim()) return;
    setSaving(true);
    // Only now do the chosen stock pictures get copied into our bucket — a review the teacher
    // cancels leaves nothing behind. A copy that fails costs that word its picture and nothing
    // more: the word itself is the point.
    const imageKeys = await mapWithConcurrency(kept, 4, async (r) =>
      r.choice.picked ? await resolvePickedImageKey(r.choice.picked) : null,
    );
    const words = kept.map((r, i) => ({
      word: r.word.trim(),
      meaningVi: r.meaningVi.trim(),
      ipa: r.ipa.trim() || null,
      definitionEn: r.definitionEn.trim() || null,
      imageKey: imageKeys[i],
    }));
    const fd = new FormData();
    fd.set('intent', 'generate-topic');
    fd.set('name', name.trim());
    fd.set('description', '');
    fd.set('color', color);
    fd.set('words', JSON.stringify(words));
    fetcher.submit(fd, { method: 'post' });
    setSaving(false);
    onClose();
  };

  return (
    <>
      <Modal
        open={true}
        onClose={onClose}
        title={t('fc_gen_new_title')}
        width={640}
        footer={
          step === 'setup' ? (
            <>
              <FBtn variant="secondary" onClick={onClose}>
                {t('cancel')}
              </FBtn>
              <FBtn
                variant="primary"
                iconLeft={<MIcon name="sparkle" size={16} />}
                disabled={!name.trim() || busy}
                onClick={run}
              >
                {busy ? t('fc_gen_running') : t('fc_gen_run')}
              </FBtn>
            </>
          ) : (
            <>
              <FBtn variant="secondary" onClick={() => setStep('setup')}>
                {t('cancel')}
              </FBtn>
              <FBtn variant="primary" disabled={readyCount === 0 || saving} onClick={submit}>
                {saving ? t('fc_img_saving') : t('fc_gen_new_save', { n: readyCount })}
              </FBtn>
            </>
          )
        }
      >
        {step === 'setup' ? (
          <>
            <MSelect
              label={t('fc_gen_topic_pick')}
              value={VOCAB_TOPICS.find((vt) => vt.en === name)?.id ?? (name ? 'custom' : '')}
              onChange={pick}
              options={[
                { value: '', label: t('fc_gen_topic_pick') },
                ...VOCAB_TOPICS.map((vt) => ({ value: vt.id, label: vocabTopicLabel(vt, lang) })),
                { value: 'custom', label: t('fc_gen_topic_custom') },
              ]}
              hint={t('fc_gen_new_hint')}
            />
            <FInput
              label={t('fc_topic_name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="m-grid cols-2" style={{ gap: 14 }}>
              <div className="mochi-field">
                <label className="mochi-field__label">{t('fc_gen_count')}</label>
                <input
                  className="mochi-input"
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </div>
              <MSelect
                label={t('fc_gen_level')}
                value={level}
                onChange={(v) => setLevel(v as (typeof GEN_LEVELS)[number])}
                options={GEN_LEVELS.map((l) => ({ value: l, label: t(`fc_gen_level_${l}`) }))}
              />
            </div>
            <ColorPicker label={t('color')} value={color} onChange={setColor} />
            {busy && <span className="mochi-field__hint">{t('fc_gen_wait')}</span>}
            {error && (
              <span className="mochi-field__hint" style={{ color: 'var(--red-600, #c0392b)' }}>
                {error}
              </span>
            )}
          </>
        ) : (
          <div className="m-stack" style={{ gap: 8 }}>
            {rows.map((r, i) => (
              <div
                key={i}
                className="lrow"
                style={{ alignItems: 'center', gap: 10, opacity: r.include ? 1 : 0.5 }}
              >
                <FCheck
                  checked={r.include}
                  onChange={(e) => setRow(i, { include: e.target.checked })}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="m-row" style={{ gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 700, color: 'var(--text-strong)' }}>{r.word}</span>
                    {r.ipa && (
                      <span
                        style={{
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono, monospace)',
                          fontSize: 'var(--text-sm)',
                        }}
                      >
                        {r.ipa}
                      </span>
                    )}
                  </div>
                  {r.definitionEn && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                      {r.definitionEn}
                    </div>
                  )}
                  <input
                    className="mochi-input"
                    style={{ marginTop: 4 }}
                    placeholder={t('fc_meaning_vi')}
                    value={r.meaningVi}
                    onChange={(e) => setRow(i, { meaningVi: e.target.value })}
                  />
                  {/* Candidates under the word they belong to, the chosen one outlined. Tapping the
                      outlined one again clears it, so a word can be saved with no picture. */}
                  <div style={{ marginTop: 6 }}>
                    <ImageStrip
                      query={r.imageQuery || r.word}
                      choice={r.choice}
                      onChange={(patch) => setChoice(i, patch)}
                      compact={true}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

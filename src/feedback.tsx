import React from 'react';
import { useLoaderData, useFetcher } from 'react-router';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { Modal, MSelect, PageHeader, Empty } from './ui.jsx';
import { colorOf, fmtStamp } from './lib/core.js';
import { useLang, locale } from './lib/i18n.jsx';
import { BUILD_ID } from './lib/build-id.js';
import { CHANGELOG } from './lib/changelog.js';
import type { FeedbackRow } from '../server/services/feedback.js';

const { Card: FC, Button: FBtn, IconButton: FIB, Tag: FTag } = DS;

interface FeedbackCategory {
  tk: string;
  icon: import('./icons.jsx').IconName;
  color: string;
}

export const FEEDBACK_CATEGORIES: Record<string, FeedbackCategory> = {
  idea: { tk: 'cat_idea', icon: 'sparkle', color: 'blue' },
  bug: { tk: 'cat_bug', icon: 'flag', color: 'rose' },
  praise: { tk: 'cat_praise', icon: 'star', color: 'green' },
  other: { tk: 'cat_other', icon: 'message', color: 'cocoa' },
};

const STATUS: Record<string, { tk: string; color: string }> = {
  new: { tk: 'st_new', color: 'orange' },
  reviewed: { tk: 'st_reviewed', color: 'blue' },
  done: { tk: 'st_done', color: 'green' },
};

/** Board columns, left to right — the order a report travels through. */
const COLUMNS = ['new', 'reviewed', 'done'];

/** Where a report's issue lives — the repo `server/services/github.ts` opens issues on. */
const GH_REPO_URL = 'https://github.com/VuNQ-Jeremy/calendar';

const ICON_TINT = (color: string) => {
  const c = colorOf(color);
  return { background: c.soft, color: c.ink };
};

export interface FeedbackDraft {
  id?: string;
  message: string;
  category: string;
  author: string | null;
  status: string;
  createdAt?: string | null;
}

export const newFeedbackDraft = (user: { name?: string } | null | undefined): FeedbackDraft => ({
  message: '',
  category: 'idea',
  author: (user && user.name) || '',
  status: 'new',
});

interface FeedbackModalProps {
  draft: FeedbackDraft;
  setDraft: React.Dispatch<React.SetStateAction<FeedbackDraft | null>>;
  onClose: () => void;
  onSave: (f: FeedbackDraft) => void;
}

export function FeedbackModal({ draft, setDraft, onClose, onSave }: FeedbackModalProps) {
  const { t } = useLang();
  const set = <K extends keyof FeedbackDraft>(k: K, v: FeedbackDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={draft.id ? t('fb_edit') : t('fb_share')}
      width={520}
      footer={
        <>
          <FBtn variant="secondary" onClick={onClose}>
            {t('cancel')}
          </FBtn>
          <FBtn variant="primary" onClick={() => onSave(draft)}>
            {draft.id ? t('save') : t('fb_send')}
          </FBtn>
        </>
      }
    >
      <MSelect
        label={t('fb_type')}
        value={draft.category}
        onChange={(v) => set('category', v)}
        options={Object.entries(FEEDBACK_CATEGORIES).map(([k, v]) => ({
          value: k,
          label: t(v.tk),
        }))}
      />
      <div className="mochi-field">
        <label className="mochi-field__label">{t('fb_message')}</label>
        <textarea
          className="mochi-input"
          rows={4}
          autoFocus={true}
          style={{ resize: 'vertical', minHeight: 96, paddingTop: 10 }}
          placeholder={t('fb_message_ph')}
          value={draft.message}
          onChange={(e) => set('message', e.target.value)}
        />
      </div>
      <div className="m-grid cols-2" style={{ gap: 14 }}>
        <div className="mochi-field">
          <label className="mochi-field__label">{t('fb_from')}</label>
          <input
            className="mochi-input"
            placeholder={t('auth_your_name')}
            value={draft.author || ''}
            onChange={(e) => set('author', e.target.value)}
          />
        </div>
        {draft.id && (
          <MSelect
            label={t('fb_status')}
            value={draft.status}
            onChange={(v) => set('status', v)}
            options={Object.entries(STATUS).map(([k, v]) => ({ value: k, label: t(v.tk) }))}
          />
        )}
      </div>
    </Modal>
  );
}

interface FeedbackScreenProps {
  /** `role` gates the changelog's hide buttons — see ChangelogList. */
  user: { name?: string; role?: string } | null;
}

/**
 * Release notes for the running build, from CHANGELOG.md (baked in at build time).
 *
 * Deliberately untranslated, like the version stamp: entries are written once per push in
 * English and describe code, not UI. Lives behind a button on this page because the version
 * chip on a feedback report is only useful if you can look up what that version changed —
 * a lookup, not a work queue, so it opens as a modal rather than sharing the board.
 */
function ChangelogModal({ onClose, canEdit }: { onClose: () => void; canEdit: boolean }) {
  const { t } = useLang();
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={t('fb_changelog')}
      subtitle={t('fb_changelog_sub')}
      width={620}
      footer={
        <FBtn variant="secondary" onClick={onClose}>
          {t('close')}
        </FBtn>
      }
    >
      <ChangelogList canEdit={canEdit} />
    </Modal>
  );
}

/** How many release notes the changelog shows at a time; scrolling to the end reveals the next batch. */
const CHANGELOG_PAGE = 10;

function ChangelogList({ canEdit }: { canEdit: boolean }) {
  const { t } = useLang();
  // Optional, not because the loader omits it, but because a cached payload can: the route is
  // SWR-cached (K.feedback), so the first render after this shipped reads an entry written by
  // the build before it. `.includes` on a missing field would take the modal down.
  const { hiddenChangelog = [] } = useLoaderData() as { hiddenChangelog?: string[] };
  const fetcher = useFetcher();
  const [shown, setShown] = React.useState(CHANGELOG_PAGE);
  const [showHidden, setShowHidden] = React.useState(false);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  /**
   * Optimistic hides, version → hidden.
   *
   * The row has to leave the list on click: the write revalidates the whole route, and a list
   * this long that sits still for a beat after a click reads as broken. Cleared when the action
   * answers with an error, so a refused hide (a teacher whose render still had the button)
   * cannot leave an entry hidden on screen only.
   */
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    if (fetcher.state === 'idle' && (fetcher.data as { error?: string } | undefined)?.error) {
      setOverrides({});
    }
  }, [fetcher.state, fetcher.data]);

  const isHidden = (version: string) => overrides[version] ?? hiddenChangelog.includes(version);
  const hiddenCount = CHANGELOG.filter((e) => isHidden(e.version)).length;
  // Hidden entries are dropped entirely rather than greyed in place — the point of hiding one is
  // that it stops taking up a row. `showHidden` is how an admin gets back to them.
  const entries = showHidden ? CHANGELOG : CHANGELOG.filter((e) => !isHidden(e.version));
  const more = shown < entries.length;

  const setHidden = (version: string, hidden: boolean) => {
    setOverrides((o) => ({ ...o, [version]: hidden }));
    const fd = new FormData();
    fd.set('intent', hidden ? 'changelog-hide' : 'changelog-show');
    fd.set('version', version);
    fetcher.submit(fd, { action: '/feedback', method: 'post' });
  };

  /**
   * Reveal the next batch when the end of the list scrolls into view.
   *
   * `root` stays null even though the scroll container is `.m-dialog__body`: viewport
   * intersection already accounts for an ancestor's clipping, and the ref for the body is not
   * ours to reach. Re-running on `shown` re-observes the moved sentinel, so one long scroll
   * keeps loading instead of stopping after a single batch. Guarded for jsdom, which has no
   * IntersectionObserver — the button below is the fallback there.
   */
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !more || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries_) => {
        if (entries_.some((x) => x.isIntersecting)) setShown((n) => n + CHANGELOG_PAGE);
      },
      { rootMargin: '160px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [more, shown]);

  return (
    <div className="m-stack">
      {entries.slice(0, shown).map((e) => {
        const hidden = isHidden(e.version);
        return (
          <div
            key={e.version}
            className="lrow"
            style={{ alignItems: 'flex-start', opacity: hidden ? 0.55 : 1 }}
          >
            <div className="iconwrap" style={{ width: 40, height: 40, ...ICON_TINT('blue') }}>
              <MIcon name="sparkle" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 700,
                  color: 'var(--text-strong)',
                  fontSize: 'var(--text-md)',
                  textWrap: 'pretty' as React.CSSProperties['textWrap'],
                }}
              >
                {e.body}
              </div>
              <div className="lrow__meta">
                <span
                  className="m-row"
                  style={{ gap: 5, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                >
                  {e.version}
                </span>
                <span className="m-row" style={{ gap: 5 }}>
                  <MIcon name="clock" size={13} />
                  {new Date(e.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>
            {canEdit && (
              <div className="lrow__actions">
                <FIB
                  label={hidden ? t('fb_cl_restore') : t('fb_cl_hide')}
                  size="sm"
                  onClick={() => setHidden(e.version, !hidden)}
                >
                  <MIcon name={hidden ? 'eye' : 'trash'} size={16} />
                </FIB>
              </div>
            )}
          </div>
        );
      })}
      {more && (
        <div
          ref={sentinelRef}
          className="m-row"
          style={{ justifyContent: 'center', paddingTop: 'var(--space-2)' }}
        >
          <FBtn
            variant="secondary"
            size="sm"
            onClick={() => setShown((n) => n + CHANGELOG_PAGE)}
          >{`Show older (${entries.length - shown})`}</FBtn>
        </div>
      )}
      {canEdit && hiddenCount > 0 && (
        <div className="m-row" style={{ justifyContent: 'center' }}>
          <FBtn
            variant="ghost"
            size="sm"
            iconLeft={<MIcon name={showHidden ? 'eyeOff' : 'eye'} size={16} />}
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden ? t('fb_cl_hide_hidden') : t('fb_cl_show_hidden', { n: hiddenCount })}
          </FBtn>
        </div>
      )}
    </div>
  );
}

export function FeedbackScreen({ user }: FeedbackScreenProps) {
  const { feedback: list } = useLoaderData() as { feedback: FeedbackRow[] };
  const fetcher = useFetcher();
  const { t, lang } = useLang();
  const [modal, setModal] = React.useState<FeedbackDraft | null>(null);
  const [changelogOpen, setChangelogOpen] = React.useState(false);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overCol, setOverCol] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  /**
   * The whole card opens the editor, so a drop must not also open it.
   *
   * Native HTML5 drag-and-drop does not dispatch a click after a drop, but a cancelled drag on
   * some browsers does — and the same race already bites the calendar's mouse-driven drag, where
   * the editor pops open over the event that was just moved. One tick of suppression costs
   * nothing and closes it here.
   */
  const suppressClickRef = React.useRef(false);
  const suppressNextClick = () => {
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  /**
   * Both identifiers in one paste: "F-12 <uuid>".
   *
   * The handle is the half a human reads and the UUID is the half a query needs, and which one
   * you want is not known at copy time — so copy both and let the paste be trimmed. A row with
   * no ref (none since migration 0041 backfilled them) copies the bare id.
   */
  const copyId = (f: FeedbackRow) => {
    const text = f.ref == null ? f.id : `F-${f.ref} ${f.id}`;
    // Optimistic tick, as the invite codes do (src/screens-manage/people.tsx). The catch is only
    // to keep a refused clipboard from surfacing as an unhandled rejection.
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(f.id);
    setTimeout(() => setCopied(null), 1500);
  };

  // A status change is a round trip, and the loader keeps the old value until it lands.
  // Reading the in-flight FormData lets the card sit in its new column the moment it is
  // dropped, instead of snapping back for a beat.
  const pending = fetcher.formData;
  const moving =
    pending && pending.get('intent') === 'update' && pending.get('status')
      ? { id: String(pending.get('id')), status: String(pending.get('status')) }
      : null;
  const statusOf = (f: FeedbackRow) => (moving && moving.id === f.id ? moving.status : f.status);

  const openNew = () => setModal(newFeedbackDraft(user));

  const save = (f: FeedbackDraft) => {
    if (!f.message.trim()) return;
    const fd = new FormData();
    if (f.id) {
      fd.set('intent', 'update');
      fd.set('id', f.id);
      fd.set('message', f.message);
      fd.set('category', f.category);
      fd.set('author', f.author || '');
      fd.set('status', f.status);
    } else {
      fd.set('intent', 'create');
      fd.set('message', f.message);
      fd.set('category', f.category);
      fd.set('author', f.author || '');
      fd.set('status', f.status);
      fd.set('appVersion', BUILD_ID);
    }
    fetcher.submit(fd, { action: '/feedback', method: 'post' });
    setModal(null);
  };

  const setStatus = (id: string, status: string) => {
    const fd = new FormData();
    fd.set('intent', 'update');
    fd.set('id', id);
    fd.set('status', status);
    fetcher.submit(fd, { action: '/feedback', method: 'post' });
  };

  const toggleDone = (f: FeedbackRow) => setStatus(f.id, statusOf(f) === 'done' ? 'new' : 'done');

  const dropOn = (col: string) => {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    const row = list.find((f) => f.id === id);
    if (row && statusOf(row) !== col) setStatus(id, col);
  };

  const removeFeedback = (id: string) => {
    const fd = new FormData();
    fd.set('intent', 'delete');
    fd.set('id', id);
    fetcher.submit(fd, { action: '/feedback', method: 'post' });
  };

  return (
    <div className={'content' + (list.length ? ' content--fill' : '')}>
      <PageHeader
        title={t('fb_title')}
        subtitle={t('fb_sub')}
        actions={
          <>
            <FBtn
              variant="secondary"
              iconLeft={<MIcon name="sparkle" size={18} />}
              onClick={() => setChangelogOpen(true)}
            >
              {t('fb_changelog')}
            </FBtn>
            <FBtn variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openNew}>
              {t('fb_log')}
            </FBtn>
          </>
        }
      />
      {list.length ? (
        <div className="m-board">
          {COLUMNS.map((col) => {
            const st = STATUS[col];
            const cards = list.filter((f) => statusOf(f) === col);
            return (
              <div
                key={col}
                className={'m-board__col' + (overCol === col ? ' is-over' : '')}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setOverCol(col);
                }}
                onDragLeave={(e) => {
                  // Ignore the leave events fired while crossing a card inside this column.
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                  setOverCol((c) => (c === col ? null : c));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOn(col);
                }}
              >
                <div className="m-board__head">
                  <span
                    className="m-board__dot"
                    style={{ background: colorOf(st.color).base }}
                    aria-hidden="true"
                  />
                  <span className="m-board__title">{t(st.tk)}</span>
                  <span className="m-board__count">{cards.length}</span>
                </div>
                <div className="m-board__body">
                  {cards.map((f) => {
                    const cat = FEEDBACK_CATEGORIES[f.category] ?? FEEDBACK_CATEGORIES.other;
                    const done = statusOf(f) === 'done';
                    return (
                      <div
                        key={f.id}
                        className={'kcard' + (dragId === f.id ? ' is-dragging' : '')}
                        title={t('fb_open_hint')}
                        draggable
                        onDragStart={(e) => {
                          setDragId(f.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', f.id);
                        }}
                        onDragEnd={() => {
                          suppressNextClick();
                          setDragId(null);
                          setOverCol(null);
                        }}
                        onClick={() => {
                          if (suppressClickRef.current) return;
                          setModal({ ...f });
                        }}
                      >
                        <div className="kcard__top">
                          <div
                            className="iconwrap"
                            style={{ width: 32, height: 32, ...ICON_TINT(cat.color) }}
                          >
                            <MIcon name={cat.icon} size={16} />
                          </div>
                          <div className="kcard__msg">
                            {f.ref != null && <span className="kcard__ref">F-{f.ref}</span>}
                            {f.message}
                          </div>
                          <span
                            className="lrow__grip"
                            title={t('fb_drag_status')}
                            aria-hidden="true"
                          >
                            <MIcon name="grip" size={16} />
                          </span>
                        </div>
                        <div className="lrow__meta">
                          {f.author && (
                            <span className="m-row" style={{ gap: 5 }}>
                              <MIcon name="users" size={13} />
                              {f.author}
                            </span>
                          )}
                          {f.createdAt && (
                            <span className="m-row" style={{ gap: 5 }}>
                              <MIcon name="clock" size={13} />
                              {fmtStamp(f.createdAt, locale(lang))}
                            </span>
                          )}
                          {f.appVersion && (
                            <span
                              className="m-row"
                              style={{ gap: 5, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                              title="Build the report came from"
                            >
                              {f.appVersion}
                            </span>
                          )}
                          {f.issueNumber != null && (
                            <a
                              className="m-row kcard__issue"
                              style={{ gap: 5 }}
                              href={`${GH_REPO_URL}/issues/${f.issueNumber}`}
                              target="_blank"
                              rel="noreferrer"
                              title={t('fb_issue_title')}
                              // The card is draggable; without this the anchor never gets a
                              // plain click, the browser starts a link-drag instead.
                              draggable={false}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MIcon name="link" size={13} />#{f.issueNumber}
                            </a>
                          )}
                        </div>
                        <div className="kcard__foot">
                          <FTag color={cat.color as 'blue'}>{t(cat.tk)}</FTag>
                          {/* Each button stops its own click. NOT the container: a
                              stopPropagation on `.lrow__actions` makes a dead zone over the
                              card's own click target, which is a bug this codebase has had
                              before. Editing lives on the card itself, so there is no edit
                              button here — only the three things a click on the card can't do. */}
                          <div className="lrow__actions">
                            <FIB
                              label={copied === f.id ? t('copied') : t('fb_copy_id')}
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyId(f);
                              }}
                            >
                              <MIcon name={copied === f.id ? 'check' : 'copy'} size={16} />
                            </FIB>
                            <FIB
                              label={done ? t('fb_reopen') : t('fb_resolve')}
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleDone(f);
                              }}
                            >
                              <MIcon name="check" size={16} />
                            </FIB>
                            <FIB
                              label={t('delete')}
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFeedback(f.id);
                              }}
                            >
                              <MIcon name="trash" size={16} />
                            </FIB>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!cards.length && <div className="m-board__empty">{t('fb_col_empty')}</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <FC>
          <Empty icon="message" title={t('fb_none_title')} sub={t('fb_none_sub')} />
        </FC>
      )}

      {modal && (
        <FeedbackModal
          draft={modal}
          setDraft={setModal as React.Dispatch<React.SetStateAction<FeedbackDraft | null>>}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
      {changelogOpen && (
        <ChangelogModal onClose={() => setChangelogOpen(false)} canEdit={user?.role === 'Admin'} />
      )}
    </div>
  );
}

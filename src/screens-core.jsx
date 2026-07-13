import React from 'react';
import { DS } from './ds/index.js';
import { MIcon } from './icons.jsx';
import { useStore } from './store.jsx';
import { PageHeader, Empty, Modal, MSelect } from './ui.jsx';
import { colorOf, iso, TODAY, ICON_TINT } from './lib/core.js';
import { expandEvents, fmtTime, toMin } from './calendar/index.jsx';
import { useLang, locale } from './lib/i18n.jsx';

// app/screens-core.jsx — Dashboard (Today) + Homework
const {
  Card: SC,
  Button: SBtn,
  IconButton: SIB,
  Tag: STag,
  Badge: SBadge,
  Checkbox: SCheck,
  ProgressBar: SProg,
} = DS;

// ---- StatCard ----
function StatCard({ icon, color, num, label }) {
  return (
    <SC interactive style={{ padding: 0 }}>
      <div className="statcard">
        <div className="statcard__icon" style={ICON_TINT(color)}>
          <MIcon name={icon} size={24} />
        </div>
        <div>
          <div className="statcard__num">{num}</div>
          <div className="statcard__label">{label}</div>
        </div>
      </div>
    </SC>
  );
}

// ---- Dashboard / Today ----
function DashboardScreen({ user, onNav }) {
  const { data, update } = useStore();
  const { t, lang } = useLang();
  const today = iso(TODAY);
  const todays = expandEvents(data.events, TODAY, TODAY).sort(
    (a, b) => toMin(a.start) - toMin(b.start),
  );
  const dueToday = data.homework.filter((h) => h.due === today && !h.done);
  const pending = data.homework.filter((h) => !h.done);
  const className = (id) => (data.classes.find((c) => c.id === id) || {}).name;
  const todayStr = new Date(TODAY).toLocaleDateString(locale(lang), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="content">
      <PageHeader
        title={t('dash_greeting', { name: user.name.split(' ')[0] })}
        subtitle={t('dash_sub', { date: todayStr, count: todays.length })}
      />
      <div className="m-grid cols-4">
        <StatCard icon="book" color="green" num={data.classes.length} label={t('stat_classes')} />
        <StatCard icon="users" color="blue" num={data.students.length} label={t('stat_students')} />
        <StatCard icon="clipboard" color="orange" num={pending.length} label={t('stat_homework')} />
        <StatCard
          icon="folder"
          color="violet"
          num={data.materials.length}
          label={t('stat_materials')}
        />
      </div>
      <div className="m-grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        {/* Today's schedule */}
        <SC>
          <div className="m-spread" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('dash_today_schedule')}</h2>
            <SBtn
              variant="ghost"
              size="sm"
              iconRight={<MIcon name="chevronRight" size={16} />}
              onClick={() => onNav('calendar')}
            >
              {t('nav_calendar')}
            </SBtn>
          </div>
          {todays.length ? (
            <div className="m-stack">
              {todays.map((e, i) => {
                const c = colorOf(e.color);
                return (
                  <div key={i} className="lrow" style={{ padding: 12 }}>
                    <div className="lrow__bar" style={{ background: c.base }} />
                    <div
                      className="m-mono"
                      style={{
                        minWidth: 70,
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-body)',
                      }}
                    >
                      {fmtTime(e.start)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="lrow__title" style={{ fontSize: 'var(--text-md)' }}>
                        {e.title}
                      </div>
                      {e.location && (
                        <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                          {e.location}
                        </div>
                      )}
                    </div>
                    {e.classId && (
                      <STag color={c.tagColor || e.color}>
                        {className(e.classId) || t('class')}
                      </STag>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty
              icon="calendar"
              title={t('dash_nothing_scheduled')}
              sub={t('dash_enjoy_quiet')}
            />
          )}
        </SC>
        {/* Due today */}
        <SC>
          <div className="m-spread" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{t('dash_due_today')}</h2>
            {dueToday.length > 0 && <SBadge color="brand">{dueToday.length}</SBadge>}
          </div>
          {dueToday.length ? (
            <div className="m-stack">
              {dueToday.map((h) => {
                const c = colorOf(h.color);
                return (
                  <div key={h.id} className="m-row" style={{ gap: 12 }}>
                    <SCheck
                      checked={h.done}
                      done
                      onChange={() => update('homework', h.id, { done: !h.done })}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          color: 'var(--text-strong)',
                          fontSize: 'var(--text-sm)',
                        }}
                      >
                        {h.title}
                      </div>
                      <div className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                        {className(h.classId)}
                      </div>
                    </div>
                    <span style={{ width: 10, height: 10, borderRadius: 9, background: c.base }} />
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty icon="check" title={t('dash_all_caught')} sub={t('dash_no_hw_today')} />
          )}
        </SC>
      </div>
    </div>
  );
}

// ---- Homework ----
function HomeworkScreen() {
  const { data, add, update, remove } = useStore();
  const { t, lang } = useLang();
  const [filter, setFilter] = React.useState('all');
  const [modal, setModal] = React.useState(null);
  const className = (id) => (data.classes.find((c) => c.id === id) || {}).name || '—';

  const list = data.homework.filter((h) =>
    filter === 'all' ? true : filter === 'open' ? !h.done : h.done,
  );
  const done = data.homework.filter((h) => h.done).length;
  const pct = data.homework.length ? Math.round((done / data.homework.length) * 100) : 0;
  const today = iso(TODAY);

  const openNew = () =>
    setModal({
      title: '',
      classId: data.classes[0]?.id || '',
      due: today,
      color: data.classes[0]?.color || 'orange',
      done: false,
      points: 10,
      notes: '',
    });
  const save = (f) => {
    if (!f.title.trim()) f.title = t('hw_untitled');
    if (f.id) update('homework', f.id, f);
    else add('homework', f);
    setModal(null);
  };

  return (
    <div className="content">
      <PageHeader
        title={t('hw_title')}
        subtitle={t('hw_sub')}
        actions={
          <SBtn variant="primary" iconLeft={<MIcon name="plus" size={18} />} onClick={openNew}>
            {t('hw_add')}
          </SBtn>
        }
      />
      <SC style={{ padding: 18 }}>
        <div className="m-spread" style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 800, color: 'var(--text-strong)' }}>
            {t('hw_complete', { done, total: data.homework.length })}
          </div>
          <div className="m-mono m-muted">{`${pct}%`}</div>
        </div>
        <SProg value={pct} color="green" />
      </SC>
      <DS.Tabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: 'all', label: t('all') },
          { id: 'open', label: t('hw_tab_open') },
          { id: 'done', label: t('hw_tab_done') },
        ]}
      />
      <div className="m-stack">
        {list.length ? (
          list.map((h) => {
            const c = colorOf(h.color);
            const overdue = !h.done && h.due < today;
            return (
              <div key={h.id} className="lrow">
                <SCheck
                  checked={h.done}
                  done
                  onChange={() => update('homework', h.id, { done: !h.done })}
                />
                <div className="lrow__bar" style={{ background: c.base }} />
                <div style={{ flex: 1 }}>
                  <div
                    className="lrow__title"
                    style={{
                      textDecoration: h.done ? 'line-through' : 'none',
                      opacity: h.done ? 0.55 : 1,
                    }}
                  >
                    {h.title}
                  </div>
                  <div className="lrow__meta">
                    <STag color={h.color}>{className(h.classId)}</STag>
                    <span className="m-row" style={{ gap: 5 }}>
                      <MIcon name="clock" size={14} />
                      {overdue ? (
                        <strong style={{ color: 'var(--danger)' }}>{t('hw_overdue')}</strong>
                      ) : (
                        new Date(h.due).toLocaleDateString(locale(lang), {
                          month: 'short',
                          day: 'numeric',
                        })
                      )}
                    </span>
                    {h.points != null && h.points !== '' && (
                      <span
                        className="mchip"
                        style={{ background: 'var(--cream-200)', color: 'var(--text-body)' }}
                      >
                        <MIcon name="flag" size={12} />
                        {t('hw_pts', { n: h.points })}
                      </span>
                    )}
                  </div>
                  {h.notes && (
                    <div
                      className="m-muted"
                      style={{ fontSize: 'var(--text-sm)', marginTop: 6, textWrap: 'pretty' }}
                    >
                      {h.notes}
                    </div>
                  )}
                </div>
                <div className="lrow__actions">
                  <SIB label={t('edit')} size="sm" onClick={() => setModal({ ...h })}>
                    <MIcon name="edit" size={16} />
                  </SIB>
                  <SIB label={t('delete')} size="sm" onClick={() => remove('homework', h.id)}>
                    <MIcon name="trash" size={16} />
                  </SIB>
                </div>
              </div>
            );
          })
        ) : (
          <SC>
            <Empty icon="clipboard" title={t('hw_no_tasks')} sub={t('hw_add_start')} />
          </SC>
        )}
      </div>
      {modal && (
        <Modal
          open
          onClose={() => setModal(null)}
          title={modal.id ? t('hw_edit_task') : t('hw_new_task')}
          width={480}
          footer={
            <>
              <SBtn variant="secondary" onClick={() => setModal(null)}>
                {t('cancel')}
              </SBtn>
              <SBtn variant="primary" onClick={() => save(modal)}>
                {t('save')}
              </SBtn>
            </>
          }
        >
          <div className="mochi-field">
            <label className="mochi-field__label">{t('hw_task')}</label>
            <input
              className="mochi-input"
              autoFocus
              value={modal.title}
              onChange={(e) => setModal((m) => ({ ...m, title: e.target.value }))}
            />
          </div>
          <div className="m-grid cols-2" style={{ gap: 14 }}>
            <MSelect
              label={t('class')}
              value={modal.classId}
              onChange={(v) => {
                const c = data.classes.find((x) => x.id === v);
                setModal((m) => ({ ...m, classId: v, color: c ? c.color : m.color }));
              }}
              options={data.classes.map((c) => ({ value: c.id, label: c.name }))}
            />
            <div className="mochi-field">
              <label className="mochi-field__label">{t('hw_due')}</label>
              <input
                type="date"
                className="mochi-input"
                value={modal.due}
                onChange={(e) => setModal((m) => ({ ...m, due: e.target.value }))}
              />
            </div>
          </div>
          <div className="mochi-field" style={{ maxWidth: 160 }}>
            <label className="mochi-field__label">{t('hw_points')}</label>
            <input
              type="number"
              min={0}
              className="mochi-input"
              value={modal.points ?? ''}
              onChange={(e) =>
                setModal((m) => ({
                  ...m,
                  points: e.target.value === '' ? '' : Number(e.target.value),
                }))
              }
            />
          </div>
          <div className="mochi-field">
            <label className="mochi-field__label">{t('hw_notes')}</label>
            <textarea
              className="mochi-input"
              rows={3}
              style={{ resize: 'vertical', minHeight: 72, paddingTop: 10 }}
              placeholder={t('hw_notes_ph')}
              value={modal.notes || ''}
              onChange={(e) => setModal((m) => ({ ...m, notes: e.target.value }))}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

export { DashboardScreen, HomeworkScreen };

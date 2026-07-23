import React from 'react';
import { Empty } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { MaterialPreview } from './material-preview.jsx';
import { useCachedLoad } from '../lib/use-cached-load.js';
import type { MaterialRow } from '../../server/services/materials.js';

interface MaterialsTabProps {
  eventId: string;
  classId: string;
  materials: MaterialRow[];
}

export function MaterialsTab({ eventId, classId, materials }: MaterialsTabProps) {
  const { t } = useLang();
  const { data: attachedData } = useCachedLoad<{ materialIds: string[] }>(
    `evmat:${eventId}`,
    `/event-materials?eventId=${encodeURIComponent(eventId)}`,
  );
  const [query, setQuery] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const attachedIds = attachedData?.materialIds ?? [];
  const q = query.trim().toLowerCase();
  const classMats = materials
    .filter((m) => m.classId === classId)
    .filter((m) => !q || m.title.toLowerCase().includes(q))
    .sort((a, b) => Number(attachedIds.includes(b.id)) - Number(attachedIds.includes(a.id)));

  const selMat = classMats.find((m) => m.id === selectedId);

  return (
    <div className="evm-split">
      <div className="evm-split__left">
        <input
          className="mochi-input"
          placeholder={t('ev_mat_search_ph')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {classMats.length ? (
          classMats.map((m) => {
            const active = selectedId === m.id;
            return (
              <button
                key={m.id}
                type="button"
                className="lrow"
                onClick={() => setSelectedId(m.id)}
                style={{
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: 'transparent',
                  border: active ? '1.5px solid var(--brand)' : '1.5px solid var(--border-subtle)',
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }} className="lrow__title">
                  {attachedIds.includes(m.id) ? '★ ' : ''}
                  {m.title}
                </span>
              </button>
            );
          })
        ) : (
          <span className="m-muted" style={{ fontSize: 'var(--text-sm)' }}>
            {t('mat_list_empty')}
          </span>
        )}
      </div>
      <div className="evm-split__right">
        {selMat ? <MaterialPreview material={selMat} /> : <Empty icon="folder" title={t('mat_pick_prompt')} />}
      </div>
    </div>
  );
}

import React from 'react';
import { Empty } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { MaterialPreview } from './material-preview.jsx';
import { useCachedLoad } from '../lib/use-cached-load.js';
import { MAT_TYPES } from '../lib/mat-types.js';
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
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // Same grouping as EventMaterialsPicker in the details tab: class-scoped
  // materials of this class, plus materials explicitly attached to the event.
  const attachedIds = attachedData?.materialIds ?? [];
  const isClassMat = (m: MaterialRow) => m.scope === 'class' && m.classId === classId;
  const classMats = materials.filter(isClassMat);
  const eventMats = attachedIds
    .map((id) => materials.find((m) => m.id === id))
    .filter((m): m is MaterialRow => !!m && !isClassMat(m));
  const allMats = [...classMats, ...eventMats];

  // Auto-select the first material once the list is available.
  React.useEffect(() => {
    if (selectedId == null && allMats.length) setSelectedId(allMats[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMats.length]);

  const selMat = allMats.find((m) => m.id === selectedId);

  const renderGroup = (label: string, mats: MaterialRow[]) =>
    mats.length > 0 && (
      <div>
        <div className="m-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 6 }}>
          {label}
        </div>
        <div className="m-stack" style={{ gap: 6 }}>
          {mats.map((m) => {
            const active = selectedId === m.id;
            const mt = MAT_TYPES[m.type] ?? MAT_TYPES.notes;
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
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="lrow__title" style={{ display: 'block' }}>
                    {m.title}
                  </span>
                  <span className="m-muted" style={{ fontSize: 'var(--text-xs)' }}>
                    {t(mt.tk)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );

  return (
    <div className="evm-split">
      <div className="evm-split__left">
        {allMats.length ? (
          <div className="m-stack" style={{ gap: 14 }}>
            {renderGroup(t('ev_mat_class_group'), classMats)}
            {renderGroup(t('ev_mat_event_group'), eventMats)}
          </div>
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

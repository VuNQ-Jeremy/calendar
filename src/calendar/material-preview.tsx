import React from 'react';
import { MIcon } from '../icons.jsx';
import { Empty } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import type { MaterialRow } from '../../server/services/materials.js';

const IMG_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

function extOf(m: MaterialRow): string {
  return m.fileName?.split('.').pop()?.toLowerCase() ?? '';
}

function DocxView({ id }: { id: string }) {
  const { t } = useLang();
  const ref = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading');

  React.useEffect(() => {
    let cancelled = false;
    setState('loading');
    (async () => {
      // Dynamic import only: docx-preview touches the DOM at import time and must
      // never enter the Workers SSR bundle or the main client chunk.
      const [{ renderAsync }, res] = await Promise.all([
        import('docx-preview'),
        fetch(`/materials/${id}/view`),
      ]);
      if (cancelled) return;
      if (!res.ok) throw new Error('fetch failed');
      const buf = await res.arrayBuffer();
      if (cancelled || !ref.current) return;
      ref.current.innerHTML = '';
      await renderAsync(buf, ref.current);
      if (!cancelled) setState('ready');
    })().catch(() => {
      if (!cancelled) setState('error');
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {state === 'loading' && (
        <div className="m-muted" style={{ padding: 'var(--space-4)' }}>
          {t('mat_preview_loading')}
        </div>
      )}
      {state === 'error' && <Empty icon="file" title={t('mat_preview_unsupported')} />}
      <div ref={ref} style={{ display: state === 'ready' ? 'block' : 'none' }} />
    </div>
  );
}

export function MaterialPreview({ material }: { material: MaterialRow }) {
  const { t } = useLang();
  const ext = extOf(material);
  const viewUrl = `/materials/${material.id}/view`;
  const isLink = material.type === 'link' || material.type === 'video';

  let body: React.ReactNode;
  if (isLink && material.url) {
    body = (
      <div style={{ padding: 'var(--space-4)' }}>
        <a href={material.url} target="_blank" rel="noreferrer">
          {t('mat_open_link')} ↗
        </a>
      </div>
    );
  } else if (!material.fileKey) {
    body = <Empty icon="file" title={t('mat_preview_unsupported')} />;
  } else if (ext === 'pdf') {
    body = (
      <iframe
        src={viewUrl}
        title={material.fileName ?? material.title}
        style={{ flex: 1, width: '100%', border: 0, borderRadius: 'var(--radius-md)' }}
      />
    );
  } else if (IMG_EXTS.includes(ext)) {
    body = (
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <img src={viewUrl} alt={material.title} style={{ maxWidth: '100%' }} />
      </div>
    );
  } else if (ext === 'docx') {
    body = <DocxView id={material.id} />;
  } else {
    body = <Empty icon="file" title={t('mat_preview_unsupported')} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="m-row" style={{ gap: 10, marginBottom: 8, alignItems: 'center' }}>
        <MIcon name="file" size={16} />
        <strong
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {material.title}
        </strong>
        {material.fileKey && (
          <a href={`/materials/${material.id}/download`} style={{ fontSize: 'var(--text-sm)' }}>
            {t('mat_download')}
          </a>
        )}
      </div>
      {body}
    </div>
  );
}

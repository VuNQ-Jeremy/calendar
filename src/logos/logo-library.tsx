import React from 'react';
import { useLoaderData, useSearchParams } from 'react-router';
import { DS } from '../ds/index.js';
import { PageHeader } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import type { MsgKey } from '../lib/i18n.jsx';

/**
 * /logo-library — the mascot artwork catalogue.
 *
 * Nobody in the app has a view of the whole logo set: it is reference art with no consumer yet, so
 * "what do we actually have, and how much of it" has no answer anywhere else. This is that answer,
 * and it is the page a new import gets checked on before anything starts rendering mascots.
 *
 * Filter and page come from the URL rather than component state (the loader reads the same params),
 * which keeps a filtered view linkable and makes the back button step through the history. The
 * loader ships one page of rows; the chips' counts describe the whole library.
 */

const { Card, Input, Tag } = DS;

/** `sea-life` -> `logo_cat_sea_life`. Keys are declared in shared/i18n/strings.ts. */
const categoryKey = (category: string) => `logo_cat_${category.replace(/-/g, '_')}` as MsgKey;

type LogoRow = {
  id: string;
  storageKey: string;
  slug: string;
  category: string;
  subject: string;
  variant: number;
  backgroundColor: string;
};

type LoaderData = {
  rows: LogoRow[];
  total: number;
  categories: { category: string; n: number }[];
  subjects: number;
  page: number;
  pageSize: number;
};

/** The R2 key is `logos/<file>`; the image route serves `<file>`. */
const imageSrc = (storageKey: string) => `/logo-images/${storageKey.replace(/^logos\//, '')}`;

export function LogoLibraryScreen() {
  const { t } = useLang();
  const data = useLoaderData() as LoaderData;
  const [params, setParams] = useSearchParams();

  const cat = params.get('cat') ?? '';
  const q = params.get('q') ?? '';

  // Local mirror so typing stays responsive; the URL (and so the loader) follows after a pause.
  const [draft, setDraft] = React.useState(q);
  React.useEffect(() => setDraft(q), [q]);

  const applyQuery = React.useCallback(
    (next: string) => {
      const p = new URLSearchParams(params);
      if (next.trim()) p.set('q', next.trim());
      else p.delete('q');
      // Any change to the filter invalidates the offset — page 3 of the old result set is meaningless.
      p.delete('page');
      setParams(p, { replace: true, preventScrollReset: true });
    },
    [params, setParams],
  );

  React.useEffect(() => {
    if (draft === q) return;
    const id = setTimeout(() => applyQuery(draft), 250);
    return () => clearTimeout(id);
  }, [draft, q, applyQuery]);

  const setCategory = (next: string) => {
    const p = new URLSearchParams(params);
    if (next) p.set('cat', next);
    else p.delete('cat');
    p.delete('page');
    setParams(p, { preventScrollReset: true });
  };

  const goToPage = (next: number) => {
    const p = new URLSearchParams(params);
    if (next > 1) p.set('page', String(next));
    else p.delete('page');
    setParams(p, { preventScrollReset: true });
  };

  const libraryTotal = data.categories.reduce((n, c) => n + c.n, 0);
  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);
  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));

  // Nothing seeded at all is a different problem from nothing matching a filter, and it has a fix
  // the reader can act on, so it gets its own message rather than the generic empty state.
  const notSeeded = libraryTotal === 0;

  return (
    <div className="content">
      <PageHeader
        title={t('nav_logo_library')}
        subtitle={
          notSeeded
            ? t('logo_library_intro')
            : `${t('logo_library_count', { n: libraryTotal })} · ${t('logo_library_subjects', {
                n: data.subjects,
              })}`
        }
      />

      {notSeeded ? (
        <Card className="m-muted">{t('logo_library_empty')}</Card>
      ) : (
        <>
          <div className="m-stack">
            <Input
              value={draft}
              placeholder={t('logo_library_search')}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
              aria-label={t('logo_library_search')}
            />
            <div className="m-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Tag
                role="button"
                tabIndex={0}
                aria-pressed={cat === ''}
                onClick={() => setCategory('')}
                onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && setCategory('')}
              >
                {t('logo_library_all')} · {libraryTotal}
              </Tag>
              {data.categories.map((c) => (
                <Tag
                  key={c.category}
                  role="button"
                  tabIndex={0}
                  aria-pressed={cat === c.category}
                  onClick={() => setCategory(c.category)}
                  onKeyDown={(e: React.KeyboardEvent) =>
                    e.key === 'Enter' && setCategory(c.category)
                  }
                >
                  {t(categoryKey(c.category))} · {c.n}
                </Tag>
              ))}
            </div>
          </div>

          {data.total === 0 ? (
            <Card className="m-muted">{t('logo_library_none')}</Card>
          ) : (
            <>
              <p className="m-muted">
                {t('logo_library_showing', { from, to, total: data.total })}
              </p>

              <div className="logo-grid">
                {data.rows.map((row) => (
                  <figure key={row.id} className="logo-tile">
                    <div
                      className="logo-tile__art"
                      style={{ backgroundColor: row.backgroundColor }}
                    >
                      <img
                        src={imageSrc(row.storageKey)}
                        alt={row.slug}
                        loading="lazy"
                        decoding="async"
                        width={512}
                        height={512}
                      />
                    </div>
                    <figcaption title={row.slug}>
                      <b>{row.subject}</b>
                      <span className="m-muted"> · {row.slug}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>

              {lastPage > 1 && (
                <div className="m-row" style={{ gap: 8, justifyContent: 'center' }}>
                  <DS.Button
                    variant="ghost"
                    disabled={data.page <= 1}
                    onClick={() => goToPage(data.page - 1)}
                  >
                    {t('logo_library_prev')}
                  </DS.Button>
                  <span className="m-muted">
                    {data.page} / {lastPage}
                  </span>
                  <DS.Button
                    variant="ghost"
                    disabled={data.page >= lastPage}
                    onClick={() => goToPage(data.page + 1)}
                  >
                    {t('logo_library_next')}
                  </DS.Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

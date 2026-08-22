import { useLang } from '../../src/lib/i18n.jsx';

export function meta() {
  const description = 'Short Vietnamese videos, recorded from the real Mochi app.';
  return [
    { title: 'Mochi — Hướng dẫn' },
    { name: 'description', content: description },
    { property: 'og:title', content: 'Mochi — Hướng dẫn' },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
}

const GUIDES = [
  { thumb: '📅', t: 'landing_gd1' },
  { thumb: '✅', t: 'landing_gd2' },
  { thumb: '🧾', t: 'landing_gd3' },
  { thumb: '📝', t: 'landing_gd4' },
  { thumb: '🌱', t: 'landing_gd5' },
  { thumb: '💬', t: 'landing_gd6' },
];

export default function Guides() {
  const { t } = useLang();
  return (
    <section className="landing-section">
      <div className="landing-wrap">
        <div className="landing-page-head">
          <h1>{t('landing_gd_h1')}</h1>
          <p>{t('landing_gd_sub')}</p>
        </div>
        <div className="landing-guides">
          {GUIDES.map((g) => (
            <div key={g.t} className="landing-guide">
              <span className="landing-guide__thumb" aria-hidden="true">
                {g.thumb}
              </span>
              <h2>{t(g.t)}</h2>
              <span className="landing-guide__soon">{t('landing_gd_soon')}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { useLang } from '../../src/lib/i18n.jsx';
import { AppLink, useLandingLinks } from './landing.jsx';

export function meta() {
  const description =
    'Mochi đang trong giai đoạn beta và miễn phí hoàn toàn — đủ mọi tính năng, không giới hạn học sinh, không cần thẻ.';
  return [
    { title: 'Mochi — Bảng giá' },
    { name: 'description', content: description },
    { property: 'og:title', content: 'Mochi — Bảng giá' },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
}

const INCLUDED = [
  'landing_pr_i1',
  'landing_pr_i2',
  'landing_pr_i3',
  'landing_pr_i4',
  'landing_pr_i5',
];

export default function Pricing() {
  const { t } = useLang();
  const { signupHref } = useLandingLinks();
  return (
    <section className="landing-section">
      <div className="landing-wrap">
        <div className="landing-page-head">
          <h1>{t('landing_pr_h1')}</h1>
        </div>
        <div className="landing-price-card">
          <h2>{t('landing_pr_h2')}</h2>
          <div className="landing-price-figure">0₫</div>
          <p>{t('landing_pr_p')}</p>
          <div className="landing-price-included">{t('landing_pr_included')}</div>
          <ul className="landing-checks">
            {INCLUDED.map((item) => (
              <li key={item}>{t(item)}</li>
            ))}
          </ul>
          <AppLink className="landing-btn landing-btn--brand" href={signupHref}>
            {t('landing_signup')}
          </AppLink>
          <p className="landing-price-note">{t('landing_pr_note')}</p>
        </div>
      </div>
    </section>
  );
}

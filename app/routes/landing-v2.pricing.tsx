import { MIcon } from '../../src/icons.jsx';
import { useLang } from '../../src/lib/i18n.jsx';
import { AppLinkV2, useLandingV2Links } from './landing-v2.jsx';

export function meta() {
  const description = 'Miễn phí trong thời gian beta. Đủ mọi phân hệ cho cả trường.';
  return [
    { title: 'Bảng giá — Mochi' },
    { name: 'description', content: description },
    { name: 'robots', content: 'noindex' },
    { property: 'og:title', content: 'Bảng giá — Mochi' },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
}

const INCLUDED = [
  'landing2_pr_i1',
  'landing2_pr_i2',
  'landing2_pr_i3',
  'landing2_pr_i4',
  'landing2_pr_i5',
  'landing2_pr_i6',
];

const FAQ = [
  { q: 'landing2_pr_faq1_q', a: 'landing2_pr_faq1_a' },
  { q: 'landing2_pr_faq2_q', a: 'landing2_pr_faq2_a' },
  { q: 'landing2_pr_faq3_q', a: 'landing2_pr_faq3_a' },
];

export default function PricingV2() {
  const { t } = useLang();
  const { signupHref } = useLandingV2Links();
  return (
    <section className="lv2-section">
      <div className="lv2-wrap">
        <div className="lv2-page-head">
          <h1>{t('landing2_pr_h1')}</h1>
          <p>{t('landing2_pr_sub')}</p>
        </div>
        <div className="lv2-card lv2-price-card">
          <h2>{t('landing2_pr_plan')}</h2>
          <div className="lv2-price-figure">0₫</div>
          <p>{t('landing2_pr_p')}</p>
          <div className="lv2-price-included">{t('landing2_pr_included')}</div>
          <ul className="lv2-checks">
            {INCLUDED.map((item) => (
              <li key={item}>
                <MIcon name="check" size={16} />
                {t(item)}
              </li>
            ))}
          </ul>
          <AppLinkV2 className="lv2-btn lv2-btn--cta" href={signupHref}>
            {t('landing_signup')}
          </AppLinkV2>
          <p className="lv2-price-note">{t('landing2_pr_note')}</p>
        </div>

        <div className="lv2-faq">
          <h2>{t('landing2_pr_faq_h')}</h2>
          {FAQ.map((row) => (
            <div key={row.q} className="lv2-card lv2-faq__row">
              <h3>{t(row.q)}</h3>
              <p>{t(row.a)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { MIcon } from '../../src/icons.jsx';
import { useLang } from '../../src/lib/i18n.jsx';
import { AppLink, useLandingLinks } from './landing.jsx';
import { Link } from 'react-router';

export function meta() {
  const description =
    'Từng phân hệ của Mochi: lịch, điểm danh, học phí, sổ liên lạc, vườn từ vựng, cổng phụ huynh.';
  return [
    { title: 'Mochi — Tính năng' },
    { name: 'description', content: description },
    { property: 'og:title', content: 'Mochi — Tính năng' },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
}

const MODULES = [
  {
    icon: 'calendar',
    tone: 'brand',
    tag: 'landing_ft1_tag',
    t: 'landing_ft1_t',
    p: 'landing_ft1_p',
    items: ['landing_ft1_i1', 'landing_ft1_i2', 'landing_ft1_i3'],
  },
  {
    icon: 'banknote',
    tone: 'sage',
    tag: 'landing_ft2_tag',
    t: 'landing_ft2_t',
    p: 'landing_ft2_p',
    items: ['landing_ft2_i1', 'landing_ft2_i2', 'landing_ft2_i3'],
  },
  {
    icon: 'clipboard',
    tone: 'violet',
    tag: 'landing_ft3_tag',
    t: 'landing_ft3_t',
    p: 'landing_ft3_p',
    items: ['landing_ft3_i1', 'landing_ft3_i2', 'landing_ft3_i3'],
  },
  {
    icon: 'sprout',
    tone: 'rose',
    tag: 'landing_ft4_tag',
    t: 'landing_ft4_t',
    p: 'landing_ft4_p',
    items: ['landing_ft4_i1', 'landing_ft4_i2', 'landing_ft4_i3'],
  },
  {
    icon: 'message',
    tone: 'sky',
    tag: 'landing_ft5_tag',
    t: 'landing_ft5_t',
    p: 'landing_ft5_p',
    items: ['landing_ft5_i1', 'landing_ft5_i2', 'landing_ft5_i3'],
  },
  {
    icon: 'grad',
    tone: 'cocoa',
    tag: 'landing_ft6_tag',
    t: 'landing_ft6_t',
    p: 'landing_ft6_p',
    items: ['landing_ft6_i1', 'landing_ft6_i2', 'landing_ft6_i3'],
  },
] as const;

export default function Features() {
  const { t } = useLang();
  const { signupHref } = useLandingLinks();
  return (
    <section className="landing-section">
      <div className="landing-wrap">
        <div className="landing-page-head">
          <h1>{t('landing_ft_h1')}</h1>
          <p>{t('landing_ft_sub')}</p>
        </div>
        <div className="landing-ftrows">
          {MODULES.map((m) => (
            <div key={m.t} className="landing-ftrow">
              <div className={`landing-feature__icon landing-i--${m.tone}`}>
                <MIcon name={m.icon} size={24} />
              </div>
              <span className="landing-ftrow__tag">{t(m.tag)}</span>
              <h2>{t(m.t)}</h2>
              <p>{t(m.p)}</p>
              <ul className="landing-checks">
                {m.items.map((item) => (
                  <li key={item}>{t(item)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="landing-panel-cta">
          <h2>{t('landing_ft_cta_h')}</h2>
          <p>
            {t('landing_ft_cta_p')} <Link to="/pricing">{t('landing_nav_pricing')} →</Link>
          </p>
          <AppLink className="landing-btn landing-btn--brand" href={signupHref}>
            {t('landing_signup')}
          </AppLink>
        </div>
      </div>
    </section>
  );
}

import { MIcon } from '../../src/icons.jsx';
import { useLang } from '../../src/lib/i18n.jsx';
import { AppLink, useLandingLinks } from './landing.jsx';

export function meta() {
  const description = 'Video hướng dẫn ngắn bằng tiếng Việt, quay từ app thật.';
  return [
    { title: 'Mochi — Hướng dẫn' },
    { name: 'description', content: description },
    { property: 'og:title', content: 'Mochi — Hướng dẫn' },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
}

const GUIDES = [
  { icon: 'calendar', tone: 'brand', t: 'landing_gd1', b: 'landing_gd1_b' },
  { icon: 'check', tone: 'sage', t: 'landing_gd2', b: 'landing_gd2_b' },
  { icon: 'banknote', tone: 'violet', t: 'landing_gd3', b: 'landing_gd3_b' },
  { icon: 'clipboard', tone: 'rose', t: 'landing_gd4', b: 'landing_gd4_b' },
  { icon: 'sprout', tone: 'sky', t: 'landing_gd5', b: 'landing_gd5_b' },
  { icon: 'message', tone: 'cocoa', t: 'landing_gd6', b: 'landing_gd6_b' },
] as const;

export default function Guides() {
  const { t } = useLang();
  const { signupHref } = useLandingLinks();
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
              <div className={`landing-feature__icon landing-i--${g.tone}`}>
                <MIcon name={g.icon} size={22} />
              </div>
              <div className="landing-guide__body">
                <h2>{t(g.t)}</h2>
                <p>{t(g.b)}</p>
                <span className="landing-guide__soon">{t('landing_gd_soon')}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="landing-panel-cta">
          <h2>{t('landing_gd_cta_h')}</h2>
          <p>{t('landing_gd_cta_p')}</p>
          <AppLink className="landing-btn landing-btn--brand" href={signupHref}>
            {t('landing_signup')}
          </AppLink>
        </div>
      </div>
    </section>
  );
}

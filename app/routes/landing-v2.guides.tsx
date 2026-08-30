import { MIcon } from '../../src/icons.jsx';
import { useLang } from '../../src/lib/i18n.jsx';
import { AppLinkV2, useLandingV2Links } from './landing-v2.jsx';

export function meta() {
  const description = 'Video hướng dẫn ngắn bằng tiếng Việt, quay từ app thật.';
  return [
    { title: 'Hướng dẫn — Mochi' },
    { name: 'description', content: description },
    { name: 'robots', content: 'noindex' },
    { property: 'og:title', content: 'Hướng dẫn — Mochi' },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
}

const GUIDES = [
  { icon: 'calendar', t: 'landing2_gd1_t', b: 'landing2_gd1_b' },
  { icon: 'check', t: 'landing2_gd2_t', b: 'landing2_gd2_b' },
  { icon: 'banknote', t: 'landing2_gd3_t', b: 'landing2_gd3_b' },
  { icon: 'clipboard', t: 'landing2_gd4_t', b: 'landing2_gd4_b' },
  { icon: 'sprout', t: 'landing2_gd5_t', b: 'landing2_gd5_b' },
  { icon: 'message', t: 'landing2_gd6_t', b: 'landing2_gd6_b' },
] as const;

export default function GuidesV2() {
  const { t } = useLang();
  const { signupHref } = useLandingV2Links();
  return (
    <section className="lv2-section">
      <div className="lv2-wrap">
        <div className="lv2-page-head">
          <h1>{t('landing2_gd_h1')}</h1>
          <p>{t('landing2_gd_sub')}</p>
        </div>
        <div className="lv2-guides">
          {GUIDES.map((g) => (
            <div key={g.t} className="lv2-card lv2-guide">
              <div className="lv2-i lv2-i--primary lv2-guide__i">
                <MIcon name={g.icon} size={22} />
              </div>
              <div>
                <h2>{t(g.t)}</h2>
                <p>{t(g.b)}</p>
                <span className="lv2-guide__soon">{t('landing2_gd_soon')}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="lv2-card lv2-ft-cta">
          <h2>{t('landing2_gd_cta_h')}</h2>
          <p>{t('landing2_gd_cta_p')}</p>
          <AppLinkV2 className="lv2-btn lv2-btn--cta" href={signupHref}>
            {t('landing_signup')}
          </AppLinkV2>
        </div>
      </div>
    </section>
  );
}

import { useLang } from '../../src/lib/i18n.jsx';
import { MIcon } from '../../src/icons.jsx';
import { AppLinkV2, useLandingV2Links } from './landing-v2.jsx';

export function meta() {
  const description = 'Mochi lớn lên trong một ngôi trường thật, dành cho những ngôi trường nhỏ.';
  return [
    { title: 'Về Mochi' },
    { name: 'description', content: description },
    { name: 'robots', content: 'noindex' },
    { property: 'og:title', content: 'Về Mochi' },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
}

const VALUES = [
  { icon: 'grad', t: 'landing2_ab_v1_t', b: 'landing2_ab_v1_b' },
  { icon: 'message', t: 'landing2_ab_v2_t', b: 'landing2_ab_v2_b' },
  { icon: 'sprout', t: 'landing2_ab_v3_t', b: 'landing2_ab_v3_b' },
] as const;

function PawDivider() {
  return (
    <div className="lv2-paws" aria-hidden="true">
      <MIcon name="paw" size={20} />
      <MIcon name="paw" size={20} />
      <MIcon name="paw" size={20} />
    </div>
  );
}

export default function AboutV2() {
  const { t } = useLang();
  const { signupHref } = useLandingV2Links();
  return (
    <>
      <section className="lv2-section">
        <div className="lv2-wrap">
          <div className="lv2-page-head">
            <h1>{t('landing2_ab_h1')}</h1>
          </div>
          <div className="lv2-prose">
            <p>{t('landing2_ab_p1')}</p>
            <p>{t('landing2_ab_p2')}</p>
            <p>{t('landing2_ab_p3')}</p>
          </div>
        </div>
      </section>

      <PawDivider />

      <section className="lv2-section">
        <div className="lv2-wrap">
          <div className="lv2-sec-head">
            <h2>{t('landing2_ab_values_h2')}</h2>
          </div>
          <div className="lv2-values">
            {VALUES.map((v) => (
              <div key={v.t} className="lv2-card lv2-value">
                <div className="lv2-i lv2-i--primary">
                  <MIcon name={v.icon} size={24} />
                </div>
                <h3>{t(v.t)}</h3>
                <p>{t(v.b)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lv2-section">
        <div className="lv2-wrap">
          <div className="lv2-page-head">
            <h2>{t('landing2_ab_contact_h')}</h2>
            <p>{t('landing2_ab_contact_p')}</p>
          </div>
          <div className="lv2-center">
            <AppLinkV2 className="lv2-btn lv2-btn--cta" href={signupHref}>
              {t('landing_signup')}
            </AppLinkV2>
          </div>
        </div>
      </section>
    </>
  );
}

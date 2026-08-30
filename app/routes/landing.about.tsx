import { useLang } from '../../src/lib/i18n.jsx';
import { MIcon } from '../../src/icons.jsx';
import { AppLink, useLandingLinks } from './landing.jsx';

export function meta() {
  const description = 'Mochi lớn lên trong một ngôi trường thật, dành cho những ngôi trường nhỏ.';
  return [
    { title: 'Mochi — Về Mochi' },
    { name: 'description', content: description },
    { property: 'og:title', content: 'Mochi — Về Mochi' },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
}

const VALUES = [
  { icon: 'grad', tone: 'brand', t: 'landing_ab_v1_t', b: 'landing_ab_v1_b' },
  { icon: 'message', tone: 'sky', t: 'landing_ab_v2_t', b: 'landing_ab_v2_b' },
  { icon: 'sprout', tone: 'sage', t: 'landing_ab_v3_t', b: 'landing_ab_v3_b' },
] as const;

function PawDivider() {
  return (
    <div className="landing-paws" aria-hidden="true">
      <MIcon name="paw" size={20} />
      <MIcon name="paw" size={20} />
      <MIcon name="paw" size={20} />
    </div>
  );
}

export default function About() {
  const { t } = useLang();
  const { signupHref } = useLandingLinks();
  return (
    <>
      <section className="landing-section">
        <div className="landing-wrap">
          <div className="landing-page-head">
            <h1>{t('landing_ab_h1')}</h1>
          </div>
          <div className="landing-prose">
            <p>{t('landing_ab_p1')}</p>
            <p>{t('landing_ab_p2')}</p>
            <p>{t('landing_ab_p3')}</p>
          </div>
        </div>
      </section>

      <PawDivider />

      <section className="landing-section">
        <div className="landing-wrap">
          <div className="landing-sec-head">
            <h2>{t('landing_ab_values_h2')}</h2>
          </div>
          <div className="landing-values">
            {VALUES.map((v) => (
              <div key={v.t} className="landing-value">
                <div className={`landing-feature__icon landing-i--${v.tone}`}>
                  <MIcon name={v.icon} size={22} />
                </div>
                <h3>{t(v.t)}</h3>
                <p>{t(v.b)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-wrap">
          <div className="landing-page-head">
            <h2>{t('landing_ab_contact_h')}</h2>
            <p>{t('landing_ab_contact_p')}</p>
          </div>
          <div className="landing-center">
            <AppLink className="landing-btn landing-btn--brand" href={signupHref}>
              {t('landing_signup')}
            </AppLink>
          </div>
        </div>
      </section>
    </>
  );
}

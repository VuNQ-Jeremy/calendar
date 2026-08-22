import { useLang } from '../../src/lib/i18n.jsx';
import { MIcon } from '../../src/icons.jsx';
import { AppLink, useLandingLinks } from './landing.jsx';

export function meta() {
  const description =
    'Mochi grew up inside a small language school in Vietnam — every feature exists because a real teacher, student or parent needed it.';
  return [
    { title: 'Mochi — Về Mochi' },
    { name: 'description', content: description },
    { property: 'og:title', content: 'Mochi — Về Mochi' },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
}

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
          </div>
        </div>
      </section>

      <PawDivider />

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

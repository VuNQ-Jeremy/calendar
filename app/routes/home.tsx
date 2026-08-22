import { redirect } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { getUser, homeFor } from '../../server/services/auth';
import { appOrigin, isAppHost } from '../../server/origin';
import { MIcon } from '../../src/icons.jsx';
import { useLang, getCal } from '../../src/lib/i18n.jsx';
import { AppLink, useLandingLinks } from './landing.jsx';

/**
 * The public marketing landing page at `/`.
 *
 * Outside the _app layout (see routes.ts), inside the shared marketing layout
 * (routes/landing.tsx). On the app host (today: every host — see
 * server/origin.ts) a signed-in visitor keeps going straight to their home
 * screen, exactly as before this page existed as marketing; once APP_ORIGIN
 * is set, a signed-out visitor on the app host is sent to sign in instead of
 * seeing marketing copy there. The marketing host (the apex, once the split
 * is live) always renders this page.
 */

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  if (isAppHost(request, env)) {
    const user = await getUser(request, env);
    if (user) return redirect(homeFor(user.kind));
    // Single-host mode (APP_ORIGIN unset) renders the landing to logged-out
    // visitors here too — that's every visitor today. Once the split is on,
    // the app host's job is the app: send them to sign in instead.
    if (appOrigin(env)) return redirect('/login');
  }
  return {};
}

export function meta() {
  const description =
    'Mochi gom lịch học, điểm danh, học phí, phiếu nhận xét và kho từ vựng của trường bạn vào một nơi — cho giáo viên, học sinh và phụ huynh.';
  return [
    { title: 'Mochi — School OS' },
    { name: 'description', content: description },
    { property: 'og:title', content: 'Mochi — School OS' },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
}

// The hero's "week at a Mochi school". Class names and rooms are illustration,
// not content, so they stay literal; only the day labels are localized.
const WEEK: { day: number; chips: { name: string; time: string; tone: string }[] }[] = [
  {
    day: 0,
    chips: [
      { name: 'Starters A', time: '17:30 · P.201', tone: 'violet' },
      { name: 'IELTS 6.5', time: '19:00 · P.105', tone: 'sky' },
    ],
  },
  { day: 1, chips: [{ name: 'Phonics 1', time: '17:30 · P.104', tone: 'sage' }] },
  {
    day: 2,
    chips: [
      { name: 'Starters A', time: '17:30 · P.201', tone: 'violet' },
      { name: 'Movers B', time: '19:00 · P.202', tone: 'rose' },
    ],
  },
  {
    day: 3,
    chips: [
      { name: 'Phonics 1', time: '17:30 · P.104', tone: 'sage' },
      { name: 'IELTS 6.5', time: '19:00 · P.105', tone: 'sky' },
    ],
  },
  {
    day: 5,
    chips: [
      { name: 'Flyers C', time: '09:00 · P.201', tone: 'brand' },
      { name: 'Movers B', time: '10:30 · P.202', tone: 'rose' },
    ],
  },
];

const FEATURES = [
  { t: 'landing_f1_t', b: 'landing_f1_b', tone: 'brand', emoji: '📅' },
  { t: 'landing_f2_t', b: 'landing_f2_b', tone: 'sage', emoji: '🧾' },
  { t: 'landing_f3_t', b: 'landing_f3_b', tone: 'violet', emoji: '📝' },
  { t: 'landing_f4_t', b: 'landing_f4_b', tone: 'rose', emoji: '🌱' },
  { t: 'landing_f5_t', b: 'landing_f5_b', tone: 'sky', emoji: '💬' },
  { t: 'landing_f6_t', b: 'landing_f6_b', tone: 'cocoa', emoji: '📱' },
];

const STEPS = [
  { t: 'landing_s1_t', b: 'landing_s1_b' },
  { t: 'landing_s2_t', b: 'landing_s2_b' },
  { t: 'landing_s3_t', b: 'landing_s3_b' },
];

const ROLES = [
  {
    tag: 'landing_r1_tag',
    t: 'landing_r1_t',
    tone: 'brand',
    items: ['landing_r1_i1', 'landing_r1_i2', 'landing_r1_i3'],
  },
  {
    tag: 'landing_r2_tag',
    t: 'landing_r2_t',
    tone: 'sage',
    items: ['landing_r2_i1', 'landing_r2_i2', 'landing_r2_i3'],
  },
  {
    tag: 'landing_r3_tag',
    t: 'landing_r3_t',
    tone: 'sky',
    items: ['landing_r3_i1', 'landing_r3_i2', 'landing_r3_i3'],
  },
];

function PawDivider() {
  return (
    <div className="landing-paws" aria-hidden="true">
      <MIcon name="paw" size={20} />
      <MIcon name="paw" size={20} />
      <MIcon name="paw" size={20} />
    </div>
  );
}

export default function Landing() {
  const { t, lang } = useLang();
  const { loginHref, signupHref } = useLandingLinks();
  const days = getCal(lang).dowMon;

  return (
    <main id="top">
      <div className="landing-hero">
        <div className="landing-wrap landing-hero__grid">
          <div>
            <span className="landing-eyebrow">{t('landing_eyebrow')}</span>
            <h1>
              {t('landing_h1_pre')} <em>{t('landing_h1_em')}</em>.
            </h1>
            <p className="landing-hero__sub">{t('landing_hero_sub')}</p>
            <div className="landing-hero__cta">
              <AppLink className="landing-btn landing-btn--brand" href={signupHref}>
                {t('landing_signup')}
              </AppLink>
              <AppLink className="landing-btn landing-btn--ghost" href={loginHref}>
                {t('landing_login')}
              </AppLink>
            </div>
            <p className="landing-hero__note">
              {t('landing_note_1')} <code>XXX-XXX</code> {t('landing_note_2')}
            </p>
          </div>

          <div className="landing-stage" aria-hidden="true">
            <div className="landing-float landing-float--attend">
              <small>{t('landing_attend_label')}</small>
              <span className="landing-ok">✓</span> An, Bảo, Chi… <b>12/12</b>
            </div>
            <div className="landing-cal">
              <div className="landing-cal__head">
                <span className="landing-cal__title">{t('landing_cal_title')}</span>
                <span className="landing-cal__dots">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
              <div className="landing-cal__grid">
                {WEEK.map((col) => (
                  <div key={col.day}>
                    <div className="landing-cal__day">{days[col.day]}</div>
                    <div className="landing-cal__col">
                      {col.chips.map((chip) => (
                        <div
                          key={chip.name + chip.time}
                          className={`landing-chip landing-chip--${chip.tone}`}
                        >
                          {chip.name}
                          <small>{chip.time}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="landing-float landing-float--tuition">
              <small>{t('landing_tuition_label')}</small>
              1.200.000₫ <span className="landing-ok">✓ {t('landing_tuition_sent')}</span>
            </div>
            <div className="landing-float landing-float--garden">
              <small>{t('landing_garden_label')}</small>
              🌱 {t('landing_garden_line')}
            </div>
          </div>
        </div>
      </div>

      <PawDivider />

      <section id="features" className="landing-section">
        <div className="landing-wrap">
          <div className="landing-sec-head">
            <span className="landing-eyebrow">{t('landing_features_kicker')}</span>
            <h2>{t('landing_features_h2')}</h2>
            <p>{t('landing_features_sub')}</p>
          </div>
          <div className="landing-features">
            {FEATURES.map((f) => (
              <div key={f.t} className="landing-feature">
                <div className={`landing-feature__icon landing-i--${f.tone}`}>{f.emoji}</div>
                <h3>{t(f.t)}</h3>
                <p>{t(f.b)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="landing-section landing-steps-band">
        <div className="landing-wrap">
          <div className="landing-sec-head">
            <span className="landing-eyebrow">{t('landing_how_kicker')}</span>
            <h2>{t('landing_how_h2')}</h2>
          </div>
          <div className="landing-steps">
            {STEPS.map((s) => (
              <div key={s.t} className="landing-step">
                <h3>{t(s.t)}</h3>
                <p>{t(s.b)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="roles" className="landing-section">
        <div className="landing-wrap">
          <div className="landing-sec-head">
            <span className="landing-eyebrow">{t('landing_roles_kicker')}</span>
            <h2>{t('landing_roles_h2')}</h2>
          </div>
          <div className="landing-roles">
            {ROLES.map((r) => (
              <div key={r.t} className="landing-role">
                <span className={`landing-role__tag landing-role__tag--${r.tone}`}>{t(r.tag)}</span>
                <h3>{t(r.t)}</h3>
                <ul>
                  {r.items.map((item) => (
                    <li key={item}>{t(item)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-wrap">
          <div className="landing-cta-card">
            <span className="landing-paw-bg landing-paw-bg--tl" aria-hidden="true">
              <MIcon name="paw" size={70} />
            </span>
            <span className="landing-paw-bg landing-paw-bg--br" aria-hidden="true">
              <MIcon name="paw" size={90} />
            </span>
            <h2>{t('landing_cta_h2')}</h2>
            <p>{t('landing_cta_sub')}</p>
            <AppLink className="landing-btn landing-btn--light" href={signupHref}>
              {t('landing_signup')}
            </AppLink>
          </div>
        </div>
      </section>
    </main>
  );
}

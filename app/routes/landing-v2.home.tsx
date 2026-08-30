import { MIcon } from '../../src/icons.jsx';
import { useLang, getCal } from '../../src/lib/i18n.jsx';
import { AppLinkV2, useLandingV2Links } from './landing-v2.jsx';

/**
 * The alternate ("v2", claymorphism) marketing landing page at /v2. Not linked
 * from anywhere yet — see routes.ts — and intentionally noindexed while it's
 * an unlinked alternate to the real marketing site at `/`.
 */

export function meta() {
  const description =
    'Mochi gom lịch học, điểm danh, học phí, sổ liên lạc và vườn từ vựng của trường bạn vào một nơi — cho giáo viên, học sinh và phụ huynh.';
  return [
    { title: 'Mochi — Cả trường trong một cuốn lịch' },
    { name: 'description', content: description },
    { name: 'robots', content: 'noindex' },
    { property: 'og:title', content: 'Mochi — Cả trường trong một cuốn lịch' },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
}

// The hero's "week at a Mochi school", mirroring routes/home.tsx's WEEK: class
// names and rooms are illustration, not content, so they stay literal; only
// the day labels are localized.
const WEEK2: { day: number; chips: { name: string; time: string; tone: string }[] }[] = [
  {
    day: 0,
    chips: [
      { name: 'Starters A', time: '17:30 · P.201', tone: 'primary' },
      { name: 'IELTS 6.5', time: '19:00 · P.105', tone: 'secondary' },
    ],
  },
  { day: 1, chips: [{ name: 'Phonics 1', time: '17:30 · P.104', tone: 'muted' }] },
  {
    day: 2,
    chips: [
      { name: 'Starters A', time: '17:30 · P.201', tone: 'primary' },
      { name: 'Movers B', time: '19:00 · P.202', tone: 'cta' },
    ],
  },
  {
    day: 3,
    chips: [
      { name: 'Phonics 1', time: '17:30 · P.104', tone: 'muted' },
      { name: 'IELTS 6.5', time: '19:00 · P.105', tone: 'secondary' },
    ],
  },
  {
    day: 5,
    chips: [
      { name: 'Flyers C', time: '09:00 · P.201', tone: 'cta' },
      { name: 'Movers B', time: '10:30 · P.202', tone: 'cta' },
    ],
  },
];

const FEATURES = [
  { t: 'landing2_f1_t', b: 'landing2_f1_b', tone: 'primary', icon: 'calendar' },
  { t: 'landing2_f2_t', b: 'landing2_f2_b', tone: 'cta', icon: 'banknote' },
  { t: 'landing2_f3_t', b: 'landing2_f3_b', tone: 'secondary', icon: 'clipboard' },
  { t: 'landing2_f4_t', b: 'landing2_f4_b', tone: 'sage', icon: 'sprout' },
  { t: 'landing2_f5_t', b: 'landing2_f5_b', tone: 'sky', icon: 'message' },
  { t: 'landing2_f6_t', b: 'landing2_f6_b', tone: 'rose', icon: 'grad' },
] as const;

const STEPS = [
  { t: 'landing2_s1_t', b: 'landing2_s1_b' },
  { t: 'landing2_s2_t', b: 'landing2_s2_b' },
  { t: 'landing2_s3_t', b: 'landing2_s3_b' },
];

const ROLES = [
  {
    tag: 'landing2_r1_tag',
    t: 'landing2_r1_t',
    tone: 'primary',
    items: ['landing2_r1_i1', 'landing2_r1_i2', 'landing2_r1_i3'],
  },
  {
    tag: 'landing2_r2_tag',
    t: 'landing2_r2_t',
    tone: 'sage',
    items: ['landing2_r2_i1', 'landing2_r2_i2', 'landing2_r2_i3'],
  },
  {
    tag: 'landing2_r3_tag',
    t: 'landing2_r3_t',
    tone: 'sky',
    items: ['landing2_r3_i1', 'landing2_r3_i2', 'landing2_r3_i3'],
  },
];

const FACTS = [
  { t: 'landing2_fact1_t', b: 'landing2_fact1_b', icon: 'message' },
  { t: 'landing2_fact2_t', b: 'landing2_fact2_b', icon: 'banknote' },
  { t: 'landing2_fact3_t', b: 'landing2_fact3_b', icon: 'gift' },
  { t: 'landing2_fact4_t', b: 'landing2_fact4_b', icon: 'zap' },
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

export default function LandingV2() {
  const { t, lang } = useLang();
  const { loginHref, signupHref } = useLandingV2Links();
  const days = getCal(lang).dowMon;

  return (
    <main id="top">
      <div className="lv2-hero">
        <div className="lv2-wrap lv2-hero__grid">
          <div>
            <span className="lv2-eyebrow">{t('landing2_hero_eyebrow')}</span>
            <h1>{t('landing2_hero_h1')}</h1>
            <p className="lv2-hero__sub">{t('landing2_hero_sub')}</p>
            <div className="lv2-hero__cta">
              <AppLinkV2 className="lv2-btn lv2-btn--cta" href={signupHref}>
                {t('landing_signup')}
              </AppLinkV2>
              <AppLinkV2 className="lv2-btn lv2-btn--ghost" href={loginHref}>
                {t('landing2_hero_cta2')}
              </AppLinkV2>
            </div>
            <p className="lv2-hero__note">{t('landing2_hero_note')}</p>
          </div>

          <div className="lv2-mock">
            <span className="sr-only">{t('landing2_mock_alt')}</span>
            <div aria-hidden="true" className="lv2-mock__chip lv2-mock__chip--attendance">
              <MIcon name="check" size={18} />
              {t('landing2_mock_chip_att')}
            </div>
            <div aria-hidden="true" className="lv2-mock__card">
              <div className="lv2-mock__head">
                <span className="lv2-mock__title">{t('landing2_mock_title')}</span>
                <span className="lv2-mock__dots">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
              <div className="lv2-mock__grid">
                {WEEK2.map((col) => (
                  <div key={col.day}>
                    <div className="lv2-mock__day">{days[col.day]}</div>
                    <div className="lv2-mock__col">
                      {col.chips.map((chip) => (
                        <div key={chip.name + chip.time} className={`lv2-chip lv2-chip--${chip.tone}`}>
                          {chip.name}
                          <small>{chip.time}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div aria-hidden="true" className="lv2-mock__chip lv2-mock__chip--tuition">
              <MIcon name="banknote" size={18} />
              {t('landing2_mock_chip_fee')}
            </div>
            <div aria-hidden="true" className="lv2-mock__chip lv2-mock__chip--garden">
              <MIcon name="sprout" size={18} />
              {t('landing2_mock_chip_garden')}
            </div>
          </div>
        </div>
      </div>

      <PawDivider />

      <section id="features" className="lv2-section">
        <div className="lv2-wrap">
          <div className="lv2-sec-head">
            <h2>{t('landing2_feat_h2')}</h2>
            <p>{t('landing2_feat_sub')}</p>
          </div>
          <div className="lv2-feats">
            {FEATURES.map((f) => (
              <div key={f.t} className="lv2-card lv2-feature">
                <div className={`lv2-i lv2-i--${f.tone}`}>
                  <MIcon name={f.icon} size={26} />
                </div>
                <h3>{t(f.t)}</h3>
                <p>{t(f.b)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="lv2-section lv2-steps-band">
        <div className="lv2-wrap">
          <div className="lv2-sec-head">
            <h2>{t('landing2_how_h2')}</h2>
          </div>
          <div className="lv2-steps">
            {STEPS.map((s) => (
              <div key={s.t} className="lv2-card lv2-step">
                <h3>{t(s.t)}</h3>
                <p>{t(s.b)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="roles" className="lv2-section">
        <div className="lv2-wrap">
          <div className="lv2-sec-head">
            <h2>{t('landing2_roles_h2')}</h2>
          </div>
          <div className="lv2-roles">
            {ROLES.map((r) => (
              <div key={r.t} className="lv2-card lv2-role">
                <span className={`lv2-role__tag lv2-role__tag--${r.tone}`}>{t(r.tag)}</span>
                <h3>{t(r.t)}</h3>
                <ul>
                  {r.items.map((item) => (
                    <li key={item}>
                      <MIcon name="check" size={16} />
                      {t(item)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lv2-section">
        <div className="lv2-wrap">
          <div className="lv2-sec-head">
            <h2>{t('landing2_proof_h2')}</h2>
            <p>{t('landing2_proof_p')}</p>
          </div>
          <div className="lv2-proof">
            {FACTS.map((f) => (
              <div key={f.t} className="lv2-card lv2-fact">
                <MIcon name={f.icon} size={22} />
                <h3>{t(f.t)}</h3>
                <p>{t(f.b)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lv2-section">
        <div className="lv2-wrap">
          <div className="lv2-cta-card">
            <h2>{t('landing2_cta_h2')}</h2>
            <p>{t('landing2_cta_p')}</p>
            <span className="lv2-cta-card__note">{t('landing2_cta_note')}</span>
            <AppLinkV2 className="lv2-btn lv2-btn--light" href={signupHref}>
              {t('landing_signup')}
            </AppLinkV2>
          </div>
        </div>
      </section>
    </main>
  );
}

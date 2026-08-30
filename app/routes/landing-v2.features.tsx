import { MIcon } from '../../src/icons.jsx';
import { useLang } from '../../src/lib/i18n.jsx';
import { AppLinkV2, useLandingV2Links } from './landing-v2.jsx';

export function meta() {
  const description =
    'Từng phân hệ của Mochi: lịch, điểm danh, học phí, sổ liên lạc, vườn từ vựng, cổng phụ huynh.';
  return [
    { title: 'Tính năng — Mochi' },
    { name: 'description', content: description },
    { name: 'robots', content: 'noindex' },
    { property: 'og:title', content: 'Tính năng — Mochi' },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
  ];
}

const MODULES = [
  {
    icon: 'calendar',
    tag: 'landing2_ft1_tag',
    t: 'landing2_ft1_t',
    p: 'landing2_ft1_p',
    items: ['landing2_ft1_i1', 'landing2_ft1_i2', 'landing2_ft1_i3'],
  },
  {
    icon: 'banknote',
    tag: 'landing2_ft2_tag',
    t: 'landing2_ft2_t',
    p: 'landing2_ft2_p',
    items: ['landing2_ft2_i1', 'landing2_ft2_i2', 'landing2_ft2_i3'],
  },
  {
    icon: 'clipboard',
    tag: 'landing2_ft3_tag',
    t: 'landing2_ft3_t',
    p: 'landing2_ft3_p',
    items: ['landing2_ft3_i1', 'landing2_ft3_i2', 'landing2_ft3_i3'],
  },
  {
    icon: 'sprout',
    tag: 'landing2_ft4_tag',
    t: 'landing2_ft4_t',
    p: 'landing2_ft4_p',
    items: ['landing2_ft4_i1', 'landing2_ft4_i2', 'landing2_ft4_i3'],
  },
  {
    icon: 'message',
    tag: 'landing2_ft5_tag',
    t: 'landing2_ft5_t',
    p: 'landing2_ft5_p',
    items: ['landing2_ft5_i1', 'landing2_ft5_i2', 'landing2_ft5_i3'],
  },
  {
    icon: 'grad',
    tag: 'landing2_ft6_tag',
    t: 'landing2_ft6_t',
    p: 'landing2_ft6_p',
    items: ['landing2_ft6_i1', 'landing2_ft6_i2', 'landing2_ft6_i3'],
  },
] as const;

export default function FeaturesV2() {
  const { t } = useLang();
  const { signupHref } = useLandingV2Links();
  return (
    <section className="lv2-section">
      <div className="lv2-wrap">
        <div className="lv2-page-head">
          <h1>{t('landing2_ft_h1')}</h1>
          <p>{t('landing2_ft_sub')}</p>
        </div>
        <div className="lv2-modules">
          {MODULES.map((m) => (
            <div key={m.t} className="lv2-card lv2-module">
              <div className="lv2-i lv2-i--primary">
                <MIcon name={m.icon} size={26} />
              </div>
              <span className="lv2-module__tag">{t(m.tag)}</span>
              <h2>{t(m.t)}</h2>
              <p>{t(m.p)}</p>
              <ul className="lv2-checks">
                {m.items.map((item) => (
                  <li key={item}>
                    <MIcon name="check" size={16} />
                    {t(item)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="lv2-card lv2-ft-cta">
          <h2>{t('landing2_ft_cta_h')}</h2>
          <p>{t('landing2_ft_cta_p')}</p>
          <AppLinkV2 className="lv2-btn lv2-btn--cta" href={signupHref}>
            {t('landing_signup')}
          </AppLinkV2>
        </div>
      </div>
    </section>
  );
}

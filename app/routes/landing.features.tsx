import { useLang } from '../../src/lib/i18n.jsx';

export function meta() {
  const description =
    'Từng phần một — đủ sâu để thay cả xấp sổ và ba ứng dụng rời: lịch, học phí, phiếu nhận xét, vườn từ vựng, cổng phụ huynh và app học sinh.';
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
    icon: '📅',
    tone: 'brand',
    t: 'landing_f1_t',
    p: 'landing_ft1_p',
    items: ['landing_ft1_i1', 'landing_ft1_i2', 'landing_ft1_i3'],
  },
  {
    icon: '🧾',
    tone: 'sage',
    t: 'landing_f2_t',
    p: 'landing_ft2_p',
    items: ['landing_ft2_i1', 'landing_ft2_i2', 'landing_ft2_i3'],
  },
  {
    icon: '📝',
    tone: 'violet',
    t: 'landing_f3_t',
    p: 'landing_ft3_p',
    items: ['landing_ft3_i1', 'landing_ft3_i2', 'landing_ft3_i3'],
  },
  {
    icon: '🌱',
    tone: 'rose',
    t: 'landing_f4_t',
    p: 'landing_ft4_p',
    items: ['landing_ft4_i1', 'landing_ft4_i2', 'landing_ft4_i3'],
  },
  {
    icon: '💬',
    tone: 'sky',
    t: 'landing_f5_t',
    p: 'landing_ft5_p',
    items: ['landing_ft5_i1', 'landing_ft5_i2', 'landing_ft5_i3'],
  },
  {
    icon: '📱',
    tone: 'cocoa',
    t: 'landing_f6_t',
    p: 'landing_ft6_p',
    items: ['landing_ft6_i1', 'landing_ft6_i2', 'landing_ft6_i3'],
  },
];

export default function Features() {
  const { t } = useLang();
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
              <div className={`landing-feature__icon landing-i--${m.tone}`}>{m.icon}</div>
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
      </div>
    </section>
  );
}

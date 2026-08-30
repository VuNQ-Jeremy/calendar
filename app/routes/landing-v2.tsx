import React from 'react';
import { Link, Outlet, useLoaderData, useOutletContext } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { appUrl } from '../../server/origin';
import { MIcon } from '../../src/icons.jsx';
import { useLang, LANG_KEY } from '../../src/lib/i18n.jsx';
import { DevInspector } from '../../src/dev-inspector.jsx';

// Baloo 2 700/800 for chunkier clay headings than v1's 600, same reason v1
// avoids the app's Fredoka: Fredoka ships no Vietnamese subset. Nunito Sans is
// already loaded globally by app/root.tsx.
import '@fontsource/baloo-2/700.css';
import '@fontsource/baloo-2/800.css';
import '@fontsource/ibm-plex-mono/400.css';
import '../../src/styles/landing-v2.css';

/**
 * Shell for the alternate ("v2", claymorphism) marketing site at /v2. A parallel
 * build of the same five pages as the shared marketing layout (routes/landing.tsx)
 * — different visual system, different copy, same product. See routes.ts: /v2 is
 * not linked from anywhere yet, so it exists only for whoever has the URL.
 */

export async function loader({ context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  return {
    loginHref: appUrl(env, '/login'),
    signupHref: appUrl(env, '/signup'),
  };
}

export interface LandingV2Context {
  loginHref: string;
  signupHref: string;
}

/** Every v2 marketing page reads the app's login/signup hrefs through this. */
export function useLandingV2Links(): LandingV2Context {
  return useOutletContext<LandingV2Context>();
}

/** Plain <a> for an absolute cross-host destination, <Link> for a relative one. */
export function AppLinkV2({
  href,
  className,
  onClick,
  children,
}: {
  href: string;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return href.startsWith('http') ? (
    <a className={className} href={href} onClick={onClick}>
      {children}
    </a>
  ) : (
    <Link className={className} to={href} onClick={onClick}>
      {children}
    </Link>
  );
}

function PawMark() {
  return (
    <span className="lv2-brand__mark" aria-hidden="true">
      <MIcon name="paw" />
    </span>
  );
}

export default function LandingV2Layout() {
  const { loginHref, signupHref } = useLoaderData<typeof loader>();
  const { lang, setLang, t } = useLang();
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Same first-visit default as v1: markets to Vietnamese schools, so a
  // visitor with no stored preference sees Vietnamese first.
  React.useEffect(() => {
    try {
      if (!localStorage.getItem(LANG_KEY)) setLang('vi');
    } catch {
      /* storage unavailable */
    }
  }, [setLang]);

  const closeMenu = () => setMenuOpen(false);

  const NAV_ITEMS = [
    { to: '/v2/features', label: t('landing2_nav_features') },
    { to: '/v2/pricing', label: t('landing2_nav_pricing') },
    { to: '/v2/guides', label: t('landing2_nav_guides') },
    { to: '/v2/about', label: t('landing2_nav_about') },
  ];

  return (
    <div className="lv2">
      <header className="lv2-header">
        <div className="lv2-wrap lv2-nav">
          <Link className="lv2-brand" to="/v2">
            <PawMark />
            <span className="lv2-brand__name">Mochi</span>
          </Link>
          <nav className="lv2-nav__links">
            {NAV_ITEMS.map((item) => (
              <Link key={item.to} to={item.to}>
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="lv2-nav__spacer" />
          <button
            type="button"
            className="lv2-lang-btn"
            aria-label={t('language')}
            onClick={() => setLang(lang === 'en' ? 'vi' : 'en')}
          >
            {lang === 'en' ? 'VI' : 'EN'}
          </button>
          <AppLinkV2 className="lv2-btn lv2-btn--ghost" href={loginHref}>
            {t('landing_login')}
          </AppLinkV2>
          <AppLinkV2 className="lv2-btn lv2-btn--cta" href={signupHref}>
            {t('landing_signup')}
          </AppLinkV2>
          <button
            type="button"
            className="lv2-burger"
            aria-label={t('landing_menu')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        {menuOpen && (
          <div className="lv2-mobile-menu">
            {NAV_ITEMS.map((item) => (
              <Link key={item.to} to={item.to} onClick={closeMenu}>
                {item.label}
              </Link>
            ))}
            <AppLinkV2 className="lv2-btn lv2-btn--cta" href={signupHref} onClick={closeMenu}>
              {t('landing_signup')}
            </AppLinkV2>
          </div>
        )}
      </header>

      <Outlet context={{ loginHref, signupHref } satisfies LandingV2Context} />

      <footer className="lv2-footer">
        <div className="lv2-wrap lv2-foot">
          <PawMark />
          <span>{t('landing2_footer_tag')}</span>
          <span className="lv2-foot__spacer" />
          <Link to="/v2/features">{t('landing2_nav_features')}</Link>
          <Link to="/v2/pricing">{t('landing2_nav_pricing')}</Link>
          <Link to="/v2/about">{t('landing2_nav_about')}</Link>
          <AppLinkV2 href={loginHref}>{t('landing_login')}</AppLinkV2>
          <AppLinkV2 href={signupHref}>{t('landing_signup_short')}</AppLinkV2>
        </div>
      </footer>

      <DevInspector />
    </div>
  );
}

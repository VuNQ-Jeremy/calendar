import React from 'react';
import { Link, Outlet, useLoaderData, useOutletContext } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { appUrl } from '../../server/origin';
import { MIcon } from '../../src/icons.jsx';
import { useLang, LANG_KEY } from '../../src/lib/i18n.jsx';
import { DevInspector } from '../../src/dev-inspector.jsx';

// Baloo 2 / IBM Plex Mono, not the app's Fredoka / DM Mono: those two ship no
// Vietnamese subset, so accented heading glyphs fall back per-character and get
// fake-bolded. See src/styles/landing.css.
import '@fontsource/baloo-2/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '../../src/styles/landing.css';

/**
 * The shared shell for the public marketing site: header (brand, nav, language
 * toggle, login/signup CTAs), footer, and the dev inspector. Every marketing
 * page (home, /features, /pricing, /about, /guides) renders inside this via
 * <Outlet/> — see routes.ts.
 */

export async function loader({ context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  return {
    loginHref: appUrl(env, '/login'),
    signupHref: appUrl(env, '/signup'),
  };
}

export interface LandingContext {
  loginHref: string;
  signupHref: string;
}

/** Every marketing page reads the app's login/signup hrefs through this. */
export function useLandingLinks(): LandingContext {
  return useOutletContext<LandingContext>();
}

/** Plain <a> for an absolute cross-host destination, <Link> for a relative one. */
export function AppLink({
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
    <span className="landing-brand__mark" aria-hidden="true">
      <MIcon name="paw" />
    </span>
  );
}

export default function LandingLayout() {
  const { loginHref, signupHref } = useLoaderData<typeof loader>();
  const { lang, setLang, t } = useLang();
  const [menuOpen, setMenuOpen] = React.useState(false);

  // The app defaults to English until localStorage says otherwise, but this
  // site markets to Vietnamese schools — first-time visitors get Vietnamese.
  // Anyone with a stored preference keeps it.
  React.useEffect(() => {
    try {
      if (!localStorage.getItem(LANG_KEY)) setLang('vi');
    } catch {
      /* storage unavailable */
    }
  }, [setLang]);

  const closeMenu = () => setMenuOpen(false);

  const NAV_ITEMS = [
    { to: '/features', label: t('landing_nav_features') },
    { to: '/pricing', label: t('landing_nav_pricing') },
    { to: '/guides', label: t('landing_nav_guides') },
    { to: '/about', label: t('landing_nav_about') },
  ];

  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-wrap landing-nav">
          <Link className="landing-brand" to="/">
            <PawMark />
            <span className="landing-brand__name">Mochi</span>
          </Link>
          <nav className="landing-nav__links">
            {NAV_ITEMS.map((item) => (
              <Link key={item.to} to={item.to}>
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="landing-nav__spacer" />
          <button
            type="button"
            className="landing-lang-btn"
            aria-label={t('language')}
            onClick={() => setLang(lang === 'en' ? 'vi' : 'en')}
          >
            {lang === 'en' ? 'VI' : 'EN'}
          </button>
          <AppLink className="landing-btn landing-btn--ghost" href={loginHref}>
            {t('landing_login')}
          </AppLink>
          <AppLink className="landing-btn landing-btn--brand" href={signupHref}>
            {t('landing_signup')}
          </AppLink>
          <button
            type="button"
            className="landing-burger"
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
          <div className="landing-mobile-menu">
            {NAV_ITEMS.map((item) => (
              <Link key={item.to} to={item.to} onClick={closeMenu}>
                {item.label}
              </Link>
            ))}
            <AppLink
              className="landing-btn landing-btn--brand"
              href={signupHref}
              onClick={closeMenu}
            >
              {t('landing_signup')}
            </AppLink>
          </div>
        )}
      </header>

      <Outlet context={{ loginHref, signupHref } satisfies LandingContext} />

      <footer className="landing-footer">
        <div className="landing-wrap landing-foot">
          <PawMark />
          <span>{t('landing_footer_tag')}</span>
          <span className="landing-foot__spacer" />
          <Link to="/features">{t('landing_nav_features')}</Link>
          <Link to="/pricing">{t('landing_nav_pricing')}</Link>
          <Link to="/about">{t('landing_nav_about')}</Link>
          <AppLink href={loginHref}>{t('landing_login')}</AppLink>
          <AppLink href={signupHref}>{t('landing_signup_short')}</AppLink>
        </div>
      </footer>

      {/* Alt+hover shows which source line rendered an element; Alt+click copies the
          file:line reference — for iterating on this site's content over chat. Always
          mounted here (there is no user to gate on, unlike _app.tsx): the data-loc
          attributes it reads are stamped into the public markup by the build anyway,
          and the overlay is inert until Alt is held. */}
      <DevInspector />
    </div>
  );
}

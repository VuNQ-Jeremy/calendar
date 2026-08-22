import React from 'react';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  type MetaArgs,
} from 'react-router';
import { LanguageProvider, useLang } from '../src/lib/i18n.jsx';
import { titleForPath } from '../src/lib/page-title.js';

import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/nunito-sans/400.css';
import '@fontsource/nunito-sans/400-italic.css';
import '@fontsource/nunito-sans/500.css';
import '@fontsource/nunito-sans/600.css';
import '@fontsource/nunito-sans/700.css';
import '@fontsource/nunito-sans/800.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import '../src/ds/styles/styles.css';
import '../src/styles/tailwind.css';
import '../src/styles/app.css';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Static, so they sit here rather than in a `links` export: every page wants the same
            mark. The .png is for Safari and iOS home screens, which ignore an SVG favicon. */}
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * The tab title for whatever page is showing — "Mochi — Feedback" on /feedback.
 *
 * Lives on the root route so no page has to remember to set one; a route that wants something
 * else (routes/home.tsx, which also carries the landing page's og: tags) exports its own `meta`
 * and replaces this wholesale.
 *
 * English here: `meta` runs on the server, where the chosen language — localStorage, read after
 * mount — is not knowable. <PageTitle/> below re-titles the page in the real language.
 */
export function meta({ location }: MetaArgs) {
  return [{ title: titleForPath(location.pathname) }];
}

/**
 * Re-title the page in the active language, and again whenever the toggle flips.
 *
 * Runs after the <Meta/> title above lands in the document, so this wins — deliberately: it is
 * the same string in the language the user actually picked.
 */
function PageTitle() {
  const { pathname } = useLocation();
  const { lang } = useLang();
  React.useEffect(() => {
    document.title = titleForPath(pathname, lang);
  }, [pathname, lang]);
  return null;
}

export default function App() {
  return (
    <LanguageProvider>
      <PageTitle />
      <Outlet />
    </LanguageProvider>
  );
}

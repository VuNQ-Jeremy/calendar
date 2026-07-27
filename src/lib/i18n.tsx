import React from 'react';
import {
  STRINGS,
  LANGUAGES,
  locale,
  getCal,
  translate,
  type LangId,
} from '../../shared/i18n/strings';

/**
 * The React/DOM half of i18n. The strings themselves live in shared/i18n/strings.ts so the
 * mobile app can import them; this file adds the context, the toggle, and localStorage
 * persistence — none of which work in React Native.
 *
 * Re-exports keep the original public surface intact: ~30 files import from here and none
 * of them needed to change.
 */
export { STRINGS, LANGUAGES, locale, getCal, translate };
export type { LangId, MsgKey } from '../../shared/i18n/strings';

export const LANG_KEY = 'mochi_lang_v1';

interface LangCtxValue {
  lang: LangId;
  setLang: (l: LangId) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LangCtx = React.createContext<LangCtxValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<LangId>('en');
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(LANG_KEY);
      if (stored && stored in STRINGS) setLangState(stored as LangId);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const setLang = React.useCallback((l: LangId) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const t = React.useCallback(
    (key: string, vars?: Record<string, string | number>): string => translate(lang, key, vars),
    [lang],
  );
  const value = React.useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang(): LangCtxValue {
  const ctx = React.useContext(LangCtx);
  if (!ctx) throw new Error('useLang must be used within LanguageProvider');
  return ctx;
}

export function LanguageToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-toggle">
      {LANGUAGES.map((l) => (
        <button
          key={l.id}
          type="button"
          className={'lang-opt' + (lang === l.id ? ' is-active' : '')}
          onClick={() => setLang(l.id as LangId)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

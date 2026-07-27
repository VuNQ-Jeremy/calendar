import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { STRINGS, LANGUAGES, locale, getCal, translate, type LangId } from '@mochi/shared/i18n/strings';

/**
 * The React Native half of i18n — the analogue of src/lib/i18n.tsx, over the SAME dictionary.
 *
 * Identical public surface to the web (`LanguageProvider`, `useLang()` -> `{ t, lang, setLang }`)
 * so screens port across without edits. Two deliberate differences:
 *
 *   1. Persistence is AsyncStorage, not localStorage. This is a language preference, not a
 *      secret — SecureStore would be pointless overhead here.
 *   2. The default is `vi`, where the web defaults to `en`. This is a Vietnamese school and the
 *      phone is a personal device; English-first would be wrong on the majority of handsets.
 */
export { STRINGS, LANGUAGES, locale, getCal, translate };
export type { LangId, MsgKey } from '@mochi/shared/i18n/strings';

/** Same key name as the web's, but a different store — they never collide. */
export const LANG_KEY = 'mochi_lang_v1';

interface LangCtxValue {
  lang: LangId;
  setLang: (l: LangId) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** False until the stored preference has been read. Gate the splash on it. */
  ready: boolean;
}

const LangCtx = React.createContext<LangCtxValue | null>(null);

/** Device locale -> a language we ship. Anything that is not Vietnamese-or-English lands on vi. */
function fromDevice(): LangId {
  try {
    const tag = getLocales()[0]?.languageCode ?? '';
    return tag === 'en' ? 'en' : 'vi';
  } catch {
    return 'vi';
  }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<LangId>('vi');
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: LangId | null = null;
      try {
        const stored = await AsyncStorage.getItem(LANG_KEY);
        if (stored && stored in STRINGS) next = stored as LangId;
      } catch {
        /* storage unavailable — fall through to the device locale */
      }
      // Only seed from the device on a genuinely fresh install. Once the user has chosen,
      // their choice outranks the handset setting forever.
      if (!cancelled) {
        setLangState(next ?? fromDevice());
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLang = React.useCallback((l: LangId) => {
    setLangState(l);
    // Fire and forget: the UI must not wait on a disk write to switch language.
    AsyncStorage.setItem(LANG_KEY, l).catch(() => {});
  }, []);

  const t = React.useCallback(
    (key: string, vars?: Record<string, string | number>): string => translate(lang, key, vars),
    [lang],
  );

  const value = React.useMemo(() => ({ lang, setLang, t, ready }), [lang, setLang, t, ready]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang(): LangCtxValue {
  const ctx = React.useContext(LangCtx);
  if (!ctx) throw new Error('useLang must be used within LanguageProvider');
  return ctx;
}

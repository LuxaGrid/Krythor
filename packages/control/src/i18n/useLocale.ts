import { useState, useCallback } from 'react';
import { LOCALES, LOCALE_NAMES, type Locale, type LocaleCode } from './locales.js';

const STORAGE_KEY = 'krythor-locale';
const DEFAULT_LOCALE: LocaleCode = 'en';

function detectLocale(): LocaleCode {
  // Check stored preference first
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in LOCALES) return stored as LocaleCode;
  } catch { /* SSR or restricted */ }

  // Auto-detect from browser
  const lang = navigator.language || 'en';
  if (lang.startsWith('zh-TW') || lang.startsWith('zh-HK')) return 'zh-TW';
  if (lang.startsWith('zh')) return 'zh-CN';
  if (lang.startsWith('pt')) return 'pt-BR';
  if (lang.startsWith('de')) return 'de';
  if (lang.startsWith('es')) return 'es';
  return DEFAULT_LOCALE;
}

export interface UseLocaleReturn {
  locale: Locale;
  localeCode: LocaleCode;
  setLocale: (code: LocaleCode) => void;
  localeNames: Record<LocaleCode, string>;
  localeCodes: LocaleCode[];
}

export function useLocale(): UseLocaleReturn {
  const [localeCode, setLocaleCode] = useState<LocaleCode>(detectLocale);

  const setLocale = useCallback((code: LocaleCode) => {
    setLocaleCode(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
  }, []);

  return {
    locale: LOCALES[localeCode],
    localeCode,
    setLocale,
    localeNames: LOCALE_NAMES,
    localeCodes: Object.keys(LOCALES) as LocaleCode[],
  };
}

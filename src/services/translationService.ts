/**
 * MONVERA DIGITAL BANKING - MULTILINGUAL TRANSLATION SERVICE
 * 
 * Priority Language Detection:
 * 1. Saved preference in localStorage ('monvera_language_preference')
 * 2. Turkish prioritization for visitors from Turkey (timeZone: Istanbul/Turkey or tr browser locale)
 * 3. Browser language (navigator.languages / navigator.language)
 * 4. Fallback to English ('en')
 * 
 * Supports 10 core languages, RTL for Arabic ('ar'), financial data protection,
 * Google Translate Element integration, and graceful failure fallback.
 */

export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  dir: 'ltr' | 'rtl';
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸', dir: 'ltr' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷', dir: 'ltr' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', dir: 'ltr' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', dir: 'ltr' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', dir: 'ltr' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', dir: 'rtl' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹', dir: 'ltr' },
  { code: 'zh-CN', name: 'Chinese', nativeName: '简体中文', flag: '🇨🇳', dir: 'ltr' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺', dir: 'ltr' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳', dir: 'ltr' },
];

export const STORAGE_KEY = 'monvera_language_preference';
export const LANGUAGE_CHANGE_EVENT = 'monvera_language_change';

declare global {
  interface Window {
    googleTranslateElementInit?: () => void;
    google?: any;
    __monvera_gt_initialized?: boolean;
  }
}

/**
 * Detect the appropriate language based on defined prioritization:
 * 1. Stored preference
 * 2. Turkey Priority Signal (Browser language = tr or Turkish TimeZone)
 * 3. Browser languages matching supported list
 * 4. Default: 'en'
 */
export function detectInitialLanguage(): string {
  // 1. Saved preference
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
      return saved;
    }
  } catch (err) {
    console.warn('[Translation] Could not read localStorage preference:', err);
  }

  // 2. Turkey Priority Signal (Timezone or Browser Language)
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const isTurkishTimeZone =
      timeZone.includes('Istanbul') ||
      timeZone.includes('Turkey') ||
      timeZone === 'Europe/Istanbul' ||
      timeZone === 'Asia/Istanbul';

    const browserLangs =
      typeof navigator !== 'undefined' && navigator.languages && navigator.languages.length > 0
        ? Array.from(navigator.languages)
        : [typeof navigator !== 'undefined' ? navigator.language || '' : ''];

    const hasTurkishBrowser = browserLangs.some(
      (lang) => lang.toLowerCase().startsWith('tr') || lang.toLowerCase().includes('tr')
    );

    if (hasTurkishBrowser || isTurkishTimeZone) {
      return 'tr';
    }

    // 3. Match browser preference against supported languages
    for (const bLang of browserLangs) {
      const lower = bLang.toLowerCase();
      // Match exact code or prefix (e.g., 'es-ES' -> 'es', 'zh-CN' -> 'zh-CN')
      const matched = SUPPORTED_LANGUAGES.find((lang) => {
        const c = lang.code.toLowerCase();
        return c === lower || lower.startsWith(c.split('-')[0]);
      });
      if (matched) {
        return matched.code;
      }
    }
  } catch (err) {
    console.warn('[Translation] Language detection warning:', err);
  }

  // 4. Default fallback
  return 'en';
}

/**
 * Helper to set cookies for Google Translate
 */
export function setGoogleTranslateCookies(langCode: string) {
  try {
    const expires = 'expires=Fri, 31 Dec 9999 23:59:59 GMT';
    const host = window.location.hostname;

    // Both /auto/ and /en/ format
    const path = 'path=/;';
    document.cookie = `googtrans=/auto/${langCode}; ${expires}; ${path}`;
    document.cookie = `googtrans=/en/${langCode}; ${expires}; ${path}`;

    if (host && !host.includes('localhost') && host.includes('.')) {
      document.cookie = `googtrans=/auto/${langCode}; ${expires}; domain=${host}; ${path}`;
      document.cookie = `googtrans=/en/${langCode}; ${expires}; domain=${host}; ${path}`;
      // Also try parent domain if subdomain
      const domainParts = host.split('.');
      if (domainParts.length > 2) {
        const rootDomain = domainParts.slice(-2).join('.');
        document.cookie = `googtrans=/auto/${langCode}; ${expires}; domain=.${rootDomain}; ${path}`;
        document.cookie = `googtrans=/en/${langCode}; ${expires}; domain=.${rootDomain}; ${path}`;
      }
    }
  } catch (err) {
    console.warn('[Translation] Cookie setting error:', err);
  }
}

/**
 * Apply layout direction (RTL for Arabic, LTR for others) and lang tag
 */
export function applyDocumentDirection(langCode: string) {
  if (typeof document === 'undefined') return;
  const isRtl = langCode === 'ar';
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  document.documentElement.lang = langCode;
  
  if (isRtl) {
    document.documentElement.classList.add('rtl-mode');
  } else {
    document.documentElement.classList.remove('rtl-mode');
  }
}

/**
 * Change the active language across the entire application
 */
export function setLanguage(langCode: string, reloadIfNecessary = false): void {
  const language = SUPPORTED_LANGUAGES.find((l) => l.code === langCode);
  if (!language) return;

  // 1. Save to localStorage
  try {
    localStorage.setItem(STORAGE_KEY, langCode);
  } catch (e) {
    console.warn('[Translation] Failed to save language to localStorage:', e);
  }

  // 2. Set Cookies
  setGoogleTranslateCookies(langCode);

  // 3. Update Document Direction & Lang attribute
  applyDocumentDirection(langCode);

  // 4. Dispatch local event for reactive components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(LANGUAGE_CHANGE_EVENT, {
        detail: { lang: langCode, language },
      })
    );
  }

  // 5. Trigger Google Translate dropdown if active in DOM
  let triggered = false;
  try {
    const select = document.querySelector<HTMLSelectElement>('.goog-te-combo');
    if (select) {
      select.value = langCode;
      select.dispatchEvent(new Event('change'));
      triggered = true;
    }
  } catch (err) {
    console.warn('[Translation] Could not directly trigger combo:', err);
  }

  // If returning to English and Google Translate frame was loaded, clearing or resetting combo
  if (langCode === 'en' && !triggered) {
    // Clear cookies if returning to native
    try {
      const past = 'expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      document.cookie = `googtrans=; ${past}`;
      document.cookie = `googtrans=; ${past} domain=${window.location.hostname};`;
    } catch {}
  }

  // 6. If reload requested or translate wasn't triggered directly
  if (reloadIfNecessary && !triggered && typeof window !== 'undefined') {
    window.location.reload();
  }
}

/**
 * Get current active language code
 */
export function getCurrentLanguage(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
      return saved;
    }
  } catch {}
  return detectInitialLanguage();
}

/**
 * Initialize Google Translate Script & Element
 * Ensures graceful fallback on failure, Turkish priority detection on first visit,
 * and RTL initialization.
 */
export function initTranslation(): void {
  if (typeof window === 'undefined' || window.__monvera_gt_initialized) return;
  window.__monvera_gt_initialized = true;

  const initialLang = getCurrentLanguage();

  // Apply cookies and direction immediately
  setGoogleTranslateCookies(initialLang);
  applyDocumentDirection(initialLang);

  // Ensure translation target div exists in body
  let container = document.getElementById('google_translate_element');
  if (!container) {
    container = document.createElement('div');
    container.id = 'google_translate_element';
    container.style.display = 'none';
    container.setAttribute('translate', 'no');
    container.classList.add('notranslate');
    document.body.appendChild(container);
  }

  // Callback executed when Google Translate library loads
  window.googleTranslateElementInit = () => {
    try {
      if (window.google && window.google.translate && window.google.translate.TranslateElement) {
        new window.google.translate.TranslateElement(
          {
            pageLanguage: 'en',
            includedLanguages: SUPPORTED_LANGUAGES.map((l) => l.code).join(','),
            autoDisplay: false,
            layout: window.google.translate.TranslateElement.InlineLayout?.HORIZONTAL,
          },
          'google_translate_element'
        );

        // If an initial language other than English is selected, trigger it once ready
        if (initialLang && initialLang !== 'en') {
          let attempts = 0;
          const interval = setInterval(() => {
            attempts++;
            const select = document.querySelector<HTMLSelectElement>('.goog-te-combo');
            if (select) {
              select.value = initialLang;
              select.dispatchEvent(new Event('change'));
              clearInterval(interval);
            }
            if (attempts > 30) clearInterval(interval);
          }, 150);
        }
      }
    } catch (err) {
      console.warn('[Translation] TranslateElement initialization error (graceful fallback to English):', err);
    }
  };

  // Load Google Translate script asynchronously with error handling
  try {
    const scriptId = 'google-translate-api-script';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.type = 'text/javascript';
      script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        console.warn(
          '[Translation] Google Translate script could not be loaded. Operating gracefully in default English.'
        );
      };
      document.body.appendChild(script);
    }
  } catch (err) {
    console.warn('[Translation] Script injection exception handled gracefully:', err);
  }
}

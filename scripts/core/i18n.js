/* ================================================================
   PPMS interface languages — English · 한국어 · العربية
   ----------------------------------------------------------------
   • _t('English text', { n: 3 }) returns the text in the user's
     language ({name} placeholders are filled in). The English text
     itself is the key, so a missing translation simply shows English.
   • Translations live in scripts/i18n/strings.js (one entry per
     English text: { area, ko, ar }). tools/i18n_export.py turns it
     into an Excel review sheet; tools/i18n_import.py reads it back.
   • Arabic switches the page to right-to-left; the Gantt timeline and
     the VPX matrix stay left-to-right (time / process order).
   • Plan data (station, part and unit names, codes) is never
     translated — only the interface around it.
   • Dates and numbers follow the language, always with Western digits.
   ================================================================ */
import STRINGS from '../i18n/strings.js';

export const LANGS = {
    en: { label: 'English', short: 'EN', dir: 'ltr', locale: 'en-GB' },
    ko: { label: '한국어', short: '한', dir: 'ltr', locale: 'ko-KR' },
    ar: { label: 'العربية', short: 'ع', dir: 'rtl', locale: 'ar-EG-u-nu-latn' },
};
const LANG_KEY = 'ppms_lang';

function readLang() {
    try {
        const l = localStorage.getItem(LANG_KEY);
        return LANGS[l] ? l : 'en';
    } catch {
        return 'en';
    }
}

let LANG = readLang();
const missing = new Set();

export function getLang() { return LANG; }
export function getLocale() { return LANGS[LANG].locale; }

/** Translate one piece of interface text. */
export function _t(text, vars) {
    if (text == null) return '';
    let out = String(text);
    if (LANG !== 'en') {
        const hit = STRINGS[out]?.[LANG];
        if (hit) out = hit;
        else missing.add(out);
    }
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
    return out;
}

/** A date in the user's language (Western digits). */
export function fmtDate(iso, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
    if (!iso) return '—';
    const d = iso instanceof Date ? iso : new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(getLocale(), opts);
}

const FONT_HREF = {
    ko: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap',
    ar: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap',
};

/** <html lang/dir>, language class and (for KO / AR) the matching font. */
export function applyLangToDocument() {
    const root = document.documentElement;
    root.lang = LANG;
    root.dir = LANGS[LANG].dir;
    root.classList.remove('lang-en', 'lang-ko', 'lang-ar');
    root.classList.add(`lang-${LANG}`);
    // Texts drawn by CSS (::before content) read from variables
    root.style.setProperty('--ppms-today-label', JSON.stringify(_t('TODAY')));
    const href = FONT_HREF[LANG];
    if (href && !document.querySelector(`link[data-ppms-font="${LANG}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.ppmsFont = LANG;
        document.head.appendChild(link);
    }
}

/** Switch language: remembered in this browser and (when signed in) on the
 *  user's profile, then the page reloads in the new language. */
export async function setLang(lang, { reload = true } = {}) {
    if (!LANGS[lang]) return;
    try { localStorage.setItem(LANG_KEY, lang); } catch {}
    try {
        const user = window.PPMSCore?.getCurrentUser?.();
        // app.js keeps the Supabase client in a global `db` (not on window)
        // eslint-disable-next-line no-undef
        const client = (typeof db !== 'undefined' && db) || window.db;
        if (user?.id && client) {
            // Needs database/migrations/60_user_preferred_language.sql — ignored until it has run
            await client.from('planning_app_users').update({ preferred_language: lang }).eq('id', user.id);
        }
    } catch {}
    if (reload) window.location.reload();
}

/** Apply a language saved on the user's profile (after sign-in). */
export function adoptProfileLang(lang) {
    if (!LANGS[lang] || lang === LANG) return false;
    try { localStorage.setItem(LANG_KEY, lang); } catch {}
    LANG = lang;
    applyLangToDocument();
    return true;
}

/** Language picker markup (used in the user menu and on the sign-in page). */
export function langPickerHtml(cls = '') {
    return `<div class="lang-picker ${cls}" role="group" aria-label="${_t('Language')}">${
        Object.entries(LANGS).map(([code, l]) =>
            `<button type="button" class="lang-opt${code === LANG ? ' is-active' : ''}" data-lang="${code}" lang="${code}" aria-pressed="${code === LANG}">${l.label}</button>`
        ).join('')}</div>`;
}

/** Header button (globe + current language) that opens a small language menu. */
export function langButtonHtml() {
    return `<div class="lang-menu-wrap" id="langMenuWrap">
        <button type="button" class="btn-nav-icon lang-menu-btn" id="btnLangMenu" title="${_t('Language')}" aria-haspopup="true" aria-expanded="false">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.2 2.3 3.2 4.8 3.2 7.5s-1 5.2-3.2 7.5M10 2.5C7.8 4.8 6.8 7.3 6.8 10s1 5.2 3.2 7.5"/></svg>
            <span class="lang-menu-code" lang="${LANG}">${LANGS[LANG].short}</span>
        </button>
        <div class="lang-menu" id="langMenu" role="menu" hidden>
            <span class="lang-menu-title">${_t('Language')}</span>
            <div class="lang-picker lang-picker--list">${Object.entries(LANGS).map(([code, l]) =>
                `<button type="button" role="menuitemradio" aria-checked="${code === LANG}" class="lang-opt${code === LANG ? ' is-active' : ''}" data-lang="${code}" lang="${code}"><span>${l.label}</span>${code === LANG ? '<i aria-hidden="true">✓</i>' : ''}</button>`
            ).join('')}</div>
        </div>
    </div>`;
}

document.addEventListener('click', e => {
    const opt = e.target.closest?.('.lang-picker [data-lang]');
    if (opt) {
        if (opt.dataset.lang !== LANG) setLang(opt.dataset.lang);
        return;
    }
    const menu = document.getElementById('langMenu');
    const btn = e.target.closest?.('#btnLangMenu');
    if (btn && menu) {
        menu.hidden = !menu.hidden;
        btn.setAttribute('aria-expanded', String(!menu.hidden));
        return;
    }
    if (menu && !menu.hidden && !e.target.closest?.('#langMenu')) {
        menu.hidden = true;
        document.getElementById('btnLangMenu')?.setAttribute('aria-expanded', 'false');
    }
});

/** Static HTML shown before the scripts run (the loading screen) carries
 *  data-i18n="English text" — translate it as soon as this module loads. */
function translateStatic(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = _t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-label]').forEach(el => { el.setAttribute('aria-label', _t(el.dataset.i18nLabel)); });
}

applyLangToDocument();
translateStatic();

// Classic scripts (app.js, kd2.js, gantt-module.js) use the globals
window._t = _t;
window.PPMSi18n = { _t, getLang, getLocale, fmtDate, setLang, adoptProfileLang, LANGS, missing: () => [...missing] };

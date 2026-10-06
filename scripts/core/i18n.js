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
   • Screen text (stage 2): most of the interface is not wrapped in
     _t(). In Korean / Arabic a watcher translates every text, tooltip,
     placeholder and label on the page whose English matches a key in
     strings.js — exactly, or through a {placeholder} pattern
     ("{a} issue{s}" matches "3 issues"; {s} is a plural ending and may
     be left out of the translation). A sentence with bold / code words
     ("Click <b>Refresh</b> to …") is matched as a whole, markup included.
     Anything inside translate="no" is left alone (report previews).
     In English the watcher never starts.
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

/* ── Screen text ───────────────────────────────────────────────── */
const norm = s => s.replace(/\s+/g, ' ').replace(/\s*<br>\s*/g, '<br>').trim();
const escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const domMissing = new Set();
const memo = new Map();
// Everything this layer has written. Text that is already a translation is
// never translated again — so writing it back can't start a loop, even when
// a text translates to itself ("PPMS", "X-ray") or one output looks like
// another key.
const outputs = new Set();
let patterns = null;

/** Keys with {placeholders} as regular expressions. {s} is a plural ending. */
function buildPatterns() {
    patterns = [];
    for (const [en, e] of Object.entries(STRINGS)) {
        if (!e[LANG] || !en.includes('{')) continue;
        const names = [];
        let lit = '';
        const src = en.split(/(\{\w+\})/).map(part => {
            const m = /^\{(\w+)\}$/.exec(part);
            if (m) { names.push(m[1]); return m[1] === 's' ? '([a-z]{0,3})' : '(.+?)'; }
            if (part.length > lit.length) lit = part;
            return escRx(part);
        }).join('');
        if (!/[A-Za-z]{2}/.test(lit)) continue;
        patterns.push({ rx: new RegExp(`^${src}$`), names, tr: e[LANG], lit });
    }
    // Longer literal text first, so "Delete {a} block" wins over "Delete {a}"
    patterns.sort((a, b) => b.lit.length - a.lit.length);
}

/** Translation of a whole piece of screen text, or null when there is none. */
function trText(raw) {
    const key = norm(raw);
    if (!key || !/[A-Za-z]{2}/.test(key.replace(/<[^>]*>/g, ''))) return null;
    if (outputs.has(key)) return null;
    if (memo.has(key)) return memo.get(key);
    let out = STRINGS[key]?.[LANG] || null;
    if (!out) {
        if (!patterns) buildPatterns();
        for (const p of patterns) {
            if (!key.includes(p.lit)) continue;
            const m = p.rx.exec(key);
            if (!m) continue;
            // A value that is itself an interface word ("Status : Overdue") is translated too
            const vals = {};
            p.names.forEach((n, i) => { vals[n] = STRINGS[m[i + 1]]?.[LANG] || m[i + 1]; });
            out = p.tr.replace(/\{(\w+)\}/g, (x, k) => vals[k] ?? '');
            break;
        }
    }
    if (out === key) out = null;           // same in both languages: nothing to do
    if (memo.size > 20000) memo.clear();
    if (outputs.size > 20000) outputs.clear();
    memo.set(key, out);
    if (out) outputs.add(norm(out));
    if (!out && domMissing.size < 5000) domMissing.add(key);
    return out;
}

/** confirm() / alert() text: whole message, else line by line. */
function trMessage(msg) {
    if (msg == null) return msg;
    const s = String(msg);
    const whole = trText(s);
    if (whole) return whole;
    return s.split('\n').map(line => trText(line) ?? line).join('\n');
}

const INLINE = new Set(['B', 'STRONG', 'EM', 'I', 'CODE', 'KBD', 'U', 'SMALL', 'SPAN', 'BR']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT', 'svg']);
const ATTRS = ['title', 'placeholder', 'aria-label'];

/** "Click <b>Refresh</b> to …" — an element whose children are text and
 *  plain inline elements (each holding only text) is translated as one
 *  sentence. Returns true when it was. */
function trMixed(el) {
    let hasText = false, hasInline = false, key = '';
    for (const c of el.childNodes) {
        if (c.nodeType === 3) { key += c.nodeValue; if (/[A-Za-z]/.test(c.nodeValue)) hasText = true; }
        else if (c.nodeType === 1 && INLINE.has(c.tagName)) {
            if (c.tagName === 'BR') { key += '<br>'; continue; }
            // An element the code updates by id must survive — leave such sentences to the text nodes
            if (c.children.length || c.id) return false;
            const t = c.tagName.toLowerCase();
            key += `<${t}>${c.textContent}</${t}>`;
            hasInline = true;
        } else if (c.nodeType !== 8) return false;
    }
    if (!hasText || !hasInline) return false;
    const out = trText(key);
    if (!out) return false;
    // Rebuild from the translation, keeping each inline element's attributes
    const tpl = document.createElement('template');
    tpl.innerHTML = out;
    const originals = [...el.children];
    for (const n of tpl.content.querySelectorAll('*')) {
        const i = originals.findIndex(o => o.tagName === n.tagName);
        if (i < 0) continue;
        for (const a of originals[i].attributes) n.setAttribute(a.name, a.value);
        originals.splice(i, 1);
    }
    el.replaceChildren(tpl.content);
    return true;
}

/** An attribute value: multi-line tooltips are translated line by line. */
function trValue(v) {
    if (!v.includes('\n')) return trText(v);
    const lines = v.split('\n').map(line => trText(line) ?? line).join('\n');
    return lines === v ? null : lines;
}

function trAttrs(el) {
    for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v) { const out = trValue(v); if (out && out !== v) el.setAttribute(a, out); }
    }
}

function trTextNode(n) {
    const v = n.nodeValue;
    if (!v || v.length > 1500 || !/[A-Za-z]/.test(v)) return;
    const out = trText(v);
    if (!out) return;
    const next = v.match(/^\s*/)[0] + out + v.match(/\s*$/)[0];
    if (next !== v) n.nodeValue = next;
}

// Left alone: report previews (translate="no") and anything the user is typing in
const isFrozen = el => !!el?.closest?.('[translate="no"], [contenteditable]:not([contenteditable="false"])');

function trTree(root) {
    if (root.nodeType === 3) {
        if (!isFrozen(root.parentElement)) trTextNode(root);
        return;
    }
    if (root.nodeType !== 1 || SKIP.has(root.tagName) || isFrozen(root)) return;
    const walk = el => {
        if (SKIP.has(el.tagName) || el.getAttribute('translate') === 'no' || el.isContentEditable) return;
        if (el.hasAttributes()) trAttrs(el);
        if (el.firstChild && trMixed(el)) return;
        for (let c = el.firstChild; c; c = c.nextSibling) {
            if (c.nodeType === 3) trTextNode(c);
            else if (c.nodeType === 1) walk(c);
        }
    };
    walk(root);
}

function startScreenTranslation() {
    if (LANG === 'en' || !document.body) return;
    if (document.title) document.title = trText(document.title) ?? document.title;
    trTree(document.body);
    new MutationObserver(records => {
        for (const r of records) {
            if (r.type === 'childList') {
                // A changed sentence (e.g. innerHTML of a <p>) is retried as a whole
                if (r.target.nodeType === 1 && r.addedNodes.length && !isFrozen(r.target) && trMixed(r.target)) continue;
                r.addedNodes.forEach(trTree);
            } else if (r.type === 'characterData') {
                if (!isFrozen(r.target.parentElement)) trTextNode(r.target);
            } else if (r.type === 'attributes') {
                const v = r.target.getAttribute(r.attributeName);
                if (v && !isFrozen(r.target)) { const out = trValue(v); if (out && out !== v) r.target.setAttribute(r.attributeName, out); }
            }
        }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // Browser dialogs
    const nativeConfirm = window.confirm.bind(window), nativeAlert = window.alert.bind(window);
    window.confirm = msg => nativeConfirm(trMessage(msg));
    window.alert = msg => nativeAlert(trMessage(msg));
}

/** Chart.js draws text on a canvas: translate legend / series names,
 *  category names that are interface words, and titles before each draw. */
export function registerChartTranslation(Chart) {
    if (LANG === 'en' || !Chart?.register) return;
    const tr = v => (typeof v === 'string' ? (trText(v) ?? v) : Array.isArray(v) ? v.map(tr) : v);
    const exact = v => (typeof v === 'string' ? (STRINGS[norm(v)]?.[LANG] || v) : v);
    Chart.register({
        id: 'ppmsI18n',
        beforeUpdate(chart) {
            const { data, options } = chart.config;
            data?.datasets?.forEach(ds => { if (ds.label) ds.label = tr(ds.label); });
            // Category names: only when the points are plain values (points given as
            // { x, y: 'name' } refer to the names and would lose their category)
            const keyed = data?.datasets?.some(ds => Array.isArray(ds.data) && ds.data.some(v => v && typeof v === 'object' && !Array.isArray(v)));
            if (Array.isArray(data?.labels) && !keyed) data.labels = data.labels.map(exact);
            const t = options?.plugins?.title;
            if (t?.text) t.text = tr(t.text);
            Object.values(options?.scales || {}).forEach(s => { if (s?.title?.text) s.title.text = tr(s.title.text); });
            const marker = options?.plugins?.anMarker;
            if (marker?.label) marker.label = tr(marker.label);
            // Tooltip lines built in code ("12% complete", "Week of …")
            const cb = options?.plugins?.tooltip?.callbacks;
            if (cb) {
                for (const k of ['title', 'beforeLabel', 'label', 'afterLabel', 'footer']) {
                    const fn = cb[k];
                    if (typeof fn !== 'function' || fn.ppmsI18n) continue;
                    const wrapped = function (...args) {
                        const out = fn.apply(this, args);
                        const one = v => (typeof v === 'string' && /[A-Za-z]{2}/.test(v) ? v.match(/^\s*/)[0] + tr(v.trim()) : v);
                        return Array.isArray(out) ? out.map(one) : one(out);
                    };
                    wrapped.ppmsI18n = true;
                    cb[k] = wrapped;
                }
            }
        },
    });
}

applyLangToDocument();
translateStatic();
startScreenTranslation();

// Classic scripts (app.js, kd2.js, gantt-module.js) use the globals
window._t = _t;
window.PPMSi18n = {
    _t, getLang, getLocale, fmtDate, setLang, adoptProfileLang, LANGS,
    tr: s => trText(s) ?? s,
    // Interface text still in English — open the page in Korean / Arabic, use it, then run PPMSi18n.missing()
    missing: () => [...new Set([...missing, ...domMissing])],
};

import { SESSION_KEY, THEME_KEY } from './config.js';

export function getSession() {
    try {
        return JSON.parse(sessionStorage.getItem(SESSION_KEY));
    } catch {
        return null;
    }
}

export function hasSession() {
    return Boolean(getSession());
}

export function saveSession(session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
}

// Six themes: 'dark' is the no-attribute default; the other five set
// data-theme explicitly. Shared with app.js's own theme functions
// (THEME_KEY_BASE + '_last') via the same localStorage key, so this
// pre-load anti-flash pass (run by bootstrapPage() before the DOM paints,
// on every page including login) picks the right one of all 6 themes
// instead of just light/dark.
const THEME_ORDER = ['dark', 'light', 'nord', 'dracula', 'midnight', 'catppuccin'];
const SHARED_THEME_KEY = 'ppms_theme_last';

export function getTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    return THEME_ORDER.includes(t) ? t : 'dark';
}

export function applyTheme(theme) {
    if (!THEME_ORDER.includes(theme)) theme = 'dark';
    if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);

    try {
        localStorage.setItem(SHARED_THEME_KEY, theme);
        localStorage.setItem(THEME_KEY, theme); // legacy key, kept in sync for any other old readers
    } catch {
    }
}

export function applyStoredTheme() {
    try {
        const stored = localStorage.getItem(SHARED_THEME_KEY) || localStorage.getItem(THEME_KEY);
        if (THEME_ORDER.includes(stored) && stored !== 'dark') {
            document.documentElement.setAttribute('data-theme', stored);
        }
    } catch {
    }
}

// Used directly by the login page's own simple two-icon (sun/moon) toggle —
// stays a plain binary flip rather than cycling all 6, since login-page.js
// calls this exact export and only has icons for light/dark.
export function toggleTheme() {
    applyTheme(getTheme() === 'light' ? 'dark' : 'light');
}

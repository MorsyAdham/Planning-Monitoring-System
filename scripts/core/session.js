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

export function getTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme) {
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
        theme = 'dark';
    }

    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch {
    }
}

export function applyStoredTheme() {
    try {
        if (localStorage.getItem(THEME_KEY) === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        }
    } catch {
    }
}

export function toggleTheme() {
    applyTheme(getTheme() === 'light' ? 'dark' : 'light');
}

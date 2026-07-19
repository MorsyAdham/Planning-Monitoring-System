import { bootstrapPage, loadRuntimeScripts } from '../core/app-bootstrap.js';
import { CDN_SCRIPTS, ROUTES } from '../core/config.js';
import { byId } from '../core/dom.js';
import { redirectIfAuthenticated } from '../core/guards.js';
import { applyStoredTheme, applyTheme, getTheme } from '../core/session.js';
import { createSupabaseClient } from '../core/supabase-client.js';
import { renderLoginLayout } from '../templates/login-layout.js';

const THEME_ORDER = ['dark', 'light', 'nord', 'dracula', 'midnight', 'catppuccin'];
const THEME_META = {
    dark:       { label: 'Dark' },
    light:      { label: 'Light' },
    nord:       { label: 'Nord' },
    dracula:    { label: 'Dracula' },
    midnight:   { label: 'Midnight' },
    catppuccin: { label: 'Catppuccin' },
};
const THEME_ICON_SVG = {
    dark: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17.5 12A7.5 7.5 0 018 2.5a7.5 7.5 0 100 15 7.5 7.5 0 009.5-5.5z"/></svg>`,
    light: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10" cy="10" r="4"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42"/></svg>`,
    nord: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10 1v18M2.5 5.5l15 9M2.5 14.5l15-9"/><path d="M10 4l-1.6 1.6M10 4l1.6 1.6M10 16l-1.6-1.6M10 16l1.6-1.6M4.7 6.8l.4-2.1M4.7 6.8l2 .8M15.3 13.2l-.4 2.1M15.3 13.2l-2-.8M15.3 6.8l-2 .8M15.3 6.8l.4-2.1M4.7 13.2l2-.8M4.7 13.2l-.4 2.1"/></svg>`,
    dracula: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 2C10 2 4.5 9.5 4.5 13a5.5 5.5 0 0011 0C15.5 9.5 10 2 10 2z"/></svg>`,
    midnight: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8L10 2z"/></svg>`,
    catppuccin: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 4l2 4M15 4l-2 4"/><circle cx="10" cy="11" r="6"/><path d="M7.5 11h.01M12.5 11h.01M9 13.5c.5.5 1.5.5 2 0"/></svg>`,
};

function renderThemePicker() {
    const icon = byId('lpThemePickerIcon');
    const current = getTheme();
    if (icon) icon.innerHTML = THEME_ICON_SVG[current] || THEME_ICON_SVG.dark;

    const dropdown = byId('lpThemeDropdown');
    if (dropdown) {
        dropdown.innerHTML = THEME_ORDER.map(name => `
            <button class="lp-theme-option${name === current ? ' active' : ''}" type="button" data-theme-choice="${name}" role="menuitem">
                ${THEME_ICON_SVG[name]}
                <span>${THEME_META[name].label}</span>
            </button>
        `).join('');
    }
}

async function sha256(value) {
    const buffer = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function getIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const payload = await response.json();
        return payload.ip || 'unknown';
    } catch {
        return 'unknown';
    }
}

function showError(message) {
    byId('loginErrorMsg').textContent = message;
    byId('loginError').classList.add('visible');
    byId('loginEmail').classList.add('error');
    byId('loginPassword').classList.add('error');
}

function hideError() {
    byId('loginError').classList.remove('visible');
    byId('loginEmail').classList.remove('error');
    byId('loginPassword').classList.remove('error');
}

function renderSupabaseFailure(error) {
    console.error(error);
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,sans-serif;flex-direction:column;gap:12px;padding:24px;text-align:center">
        <p style="color:#dc2626;font-size:1rem;margin:0">Connection failed. Disable tracking protection for this site, then reload.</p>
        <button onclick="location.reload()" style="padding:8px 20px;background:#1e3a8a;color:#fff;border:none;border-radius:6px;cursor:pointer">Reload</button>
    </div>`;
}

function clearAutofill() {
    const email = byId('loginEmail');
    const password = byId('loginPassword');
    if (email) {
        email.value = '';
        email.setAttribute('type', 'text');
        window.setTimeout(() => email.setAttribute('type', 'text'), 100);
    }
    if (password) password.value = '';
}

async function initPage() {
    if (redirectIfAuthenticated(ROUTES.app)) return;

    bootstrapPage({
        rootId: 'pageRoot',
        template: renderLoginLayout,
    });

    applyStoredTheme();
    await loadRuntimeScripts([CDN_SCRIPTS.supabase]);

    let db;
    try {
        db = createSupabaseClient();
    } catch (error) {
        renderSupabaseFailure(error);
        return;
    }

    async function doLogin() {
        hideError();
        const email = byId('loginEmail').value.trim().toLowerCase();
        const password = byId('loginPassword').value;

        if (!email || !password) {
            showError('Please enter your email and password.');
            return;
        }

        const button = byId('btnLogin');
        button.disabled = true;
        button.classList.add('loading');

        try {
            const hash = await sha256(password);
            const { data: user, error } = await db
                .from('planning_app_users')
                .select('id, email, full_name, role, is_active')
                .eq('email', email)
                .eq('password_hash', hash)
                .maybeSingle();

            if (error) throw error;
            if (!user) {
                showError('Invalid email or password. Please try again.');
                return;
            }
            if (!user.is_active) {
                showError('Your account has been deactivated. Contact the administrator.');
                return;
            }

            const ip = await getIP();
            saveSession({
                id: user.id,
                email: user.email,
                name: user.full_name,
                role: user.role,
                ip,
                loginAt: new Date().toISOString(),
            });

            const { error: auditError } = await db.from('planning_audit_log').insert({
                user_id: user.id,
                user_email: user.email,
                user_role: user.role,
                action: 'LOGIN',
                table_name: null,
                record_id: null,
                data_before: null,
                data_after: null,
                ip_address: ip,
            });
            if (auditError) {
                console.warn('Login audit write failed (non-fatal):', auditError.message);
            }

            window.location.href = ROUTES.app;
        } catch (error) {
            console.error(error);
            showError('Connection error. Please try again.');
        } finally {
            button.disabled = false;
            button.classList.remove('loading');
        }
    }

    byId('btnLogin').addEventListener('click', doLogin);
    byId('loginPassword').addEventListener('keydown', event => {
        if (event.key === 'Enter') doLogin();
    });
    byId('loginEmail').addEventListener('keydown', event => {
        if (event.key === 'Enter') byId('loginPassword').focus();
    });
    byId('pwToggle').addEventListener('click', () => {
        const input = byId('loginPassword');
        input.type = input.type === 'password' ? 'text' : 'password';
    });
    renderThemePicker();
    const themeBtn = byId('btnTheme');
    const themeDropdown = byId('lpThemeDropdown');
    themeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = themeDropdown.style.display !== 'none';
        themeDropdown.style.display = open ? 'none' : 'block';
        themeBtn.setAttribute('aria-expanded', String(!open));
    });
    document.addEventListener('click', (e) => {
        if (!themeDropdown.contains(e.target) && e.target !== themeBtn) {
            themeDropdown.style.display = 'none';
            themeBtn.setAttribute('aria-expanded', 'false');
        }
    });
    themeDropdown.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-theme-choice]');
        if (btn) {
            applyTheme(btn.dataset.themeChoice);
            renderThemePicker();
        }
        themeDropdown.style.display = 'none';
        themeBtn.setAttribute('aria-expanded', 'false');
    });

    // Cursor parallax on the hero glows — see .lp-glow-a/-b/-c in login.css
    const hero = byId('lpHero');
    if (hero) {
        hero.addEventListener('mousemove', (e) => {
            const rect = hero.getBoundingClientRect();
            const mx = (e.clientX - rect.left) / rect.width - 0.5;
            const my = (e.clientY - rect.top) / rect.height - 0.5;
            hero.style.setProperty('--mx', mx.toFixed(3));
            hero.style.setProperty('--my', my.toFixed(3));
        });
        hero.addEventListener('mouseleave', () => {
            hero.style.setProperty('--mx', 0);
            hero.style.setProperty('--my', 0);
        });
    }

    clearAutofill();
    window.addEventListener('load', clearAutofill, { once: true });
}

initPage().catch(error => {
    console.error(error);
    showError('Connection error. Please try again.');
});

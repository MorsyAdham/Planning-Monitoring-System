import { bootstrapPage, loadRuntimeScripts } from '../core/app-bootstrap.js';
import { CDN_SCRIPTS, ROUTES } from '../core/config.js';
import { byId } from '../core/dom.js';
import { redirectIfAuthenticated } from '../core/guards.js';
import { applyStoredTheme, saveSession, toggleTheme } from '../core/session.js';
import { createSupabaseClient } from '../core/supabase-client.js';
import { renderLoginLayout } from '../templates/login-layout.js';

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
    byId('btnTheme').addEventListener('click', () => toggleTheme());

    clearAutofill();
    window.addEventListener('load', clearAutofill, { once: true });
}

initPage().catch(error => {
    console.error(error);
    showError('Connection error. Please try again.');
});

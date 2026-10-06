/* ================================================================
   USER MANAGEMENT  (master admin)
   ----------------------------------------------------------------
   Who can use PPMS, with which role, in which modules, and whether
   they may export reports. One list with search and role / status
   filters, last sign-in per user, an edit panel with checks before
   anything is saved, and an Activity link into the audit log.
   Safety rules: you cannot lock yourself out (demote / deactivate /
   delete your own account), and the last active Master Admin cannot
   be removed, demoted or deactivated.
   ================================================================ */
/* global db, esc, getCurrentUser, showToast, roleLabel, roleClass, auditLog, sha256, _stripUndefinedColumn */
import { _t, fmtDate, getLocale } from '../../../core/i18n.js';

const ALL_MODULES = ['kd1', 'kd2', 'f100kd2'];
const MODULE_SHORT = { kd1: 'KD1', kd2: 'KD2', f100kd2: 'F100' };
const ROLES = ['master_admin', 'planner', 'operator', 'viewer'];
const normRole = r => (r === 'admin' ? 'operator' : (r || 'viewer'));

const S = { users: [], lastLogin: new Map(), role: '', status: '', editing: null };
const $ = id => document.getElementById(id);
const e2 = s => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`));
const rl = r => (typeof roleLabel === 'function' ? _t(roleLabel(r)) : r);
const rc = r => (typeof roleClass === 'function' ? roleClass(r) : '');

function initials(name) {
    const p = String(name || '?').trim().split(/\s+/);
    return ((p[0]?.[0] || '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
function ago(iso) {
    if (!iso) return '';
    const s = Math.round((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return _t('just now');
    if (s < 3600) return _t('{a}m ago', { a: Math.floor(s / 60) });
    if (s < 86400) return _t('{a}h ago', { a: Math.floor(s / 3600) });
    const d = Math.floor(s / 86400);
    if (d === 1) return _t('Yesterday');
    return d < 30 ? _t('{a} days ago', { a: d }) : fmtDate(iso);
}

/* ── Data ────────────────────────────────────────────────────── */
async function load() {
    const list = $('umList');
    if (list) list.innerHTML = `<div class="um2-empty"><span class="spinner"></span> ${e2(_t('Loading…'))}</div>`;
    let { data, error } = await db.from('planning_app_users')
        .select('id,email,full_name,role,is_active,created_at,modules,can_export')
        .order('full_name', { ascending: true });
    if (error?.code === '42703') {
        ({ data, error } = await db.from('planning_app_users').select('id,email,full_name,role,is_active,created_at').order('full_name', { ascending: true }));
    }
    if (error) {
        if (list) list.innerHTML = `<div class="um2-empty">${e2(_t('Error loading users.'))}</div>`;
        return;
    }
    S.users = (data || []).map(u => ({ ...u, role: normRole(u.role) }));
    render();
    // Last sign-in per user (most recent LOGIN entries)
    try {
        const { data: logins } = await db.from('planning_audit_log').select('user_email,created_at')
            .eq('action', 'LOGIN').order('created_at', { ascending: false }).limit(3000);
        S.lastLogin = new Map();
        (logins || []).forEach(l => { const k = String(l.user_email || '').toLowerCase(); if (!S.lastLogin.has(k)) S.lastLogin.set(k, l.created_at); });
        render();
    } catch {}
}

const activeAdmins = () => S.users.filter(u => u.role === 'master_admin' && u.is_active);

/* ── List ────────────────────────────────────────────────────── */
function render() {
    const list = $('umList');
    if (!list) return;
    const q = ($('umSearch')?.value || '').trim().toLowerCase();
    const me = getCurrentUser()?.id;
    const users = S.users.filter(u =>
        (!S.role || u.role === S.role)
        && (!S.status || (S.status === 'active') === !!u.is_active)
        && (!q || [u.full_name, u.email, rl(u.role), u.role].join(' ').toLowerCase().includes(q)));

    // Summary chips (also the role / status filters)
    const count = r => S.users.filter(u => u.role === r).length;
    const chip = (attr, val, label, n, on) => `<button type="button" class="um2-chip${on ? ' is-on' : ''}" data-um-${attr}="${e2(val)}">${e2(label)}<span>${n}</span></button>`;
    const sum = $('umSummary');
    if (sum) sum.innerHTML =
        chip('role', '', _t('All'), S.users.length, !S.role)
        + ROLES.map(r => chip('role', r, rl(r), count(r), S.role === r)).join('')
        + '<span class="um2-chip-gap"></span>'
        + chip('status', 'active', _t('Active'), S.users.filter(u => u.is_active).length, S.status === 'active')
        + chip('status', 'inactive', _t('Inactive'), S.users.filter(u => !u.is_active).length, S.status === 'inactive');
    const cnt = $('umUserCount');
    if (cnt) cnt.textContent = users.length === S.users.length ? _t('{a} user{s}', { a: S.users.length, s: S.users.length === 1 ? '' : 's' }) : _t('{a} of {b} users', { a: users.length, b: S.users.length });

    if (!users.length) {
        list.innerHTML = `<div class="um2-empty">${e2(q ? _t('No users match "{a}".', { a: q }) : _t('No users in this view.'))}</div>`;
        return;
    }
    list.innerHTML = users.map(u => {
        const isMe = u.id === me;
        const mods = u.role === 'master_admin' ? null : (Array.isArray(u.modules) && u.modules.length ? u.modules : ALL_MODULES);
        const last = S.lastLogin.get(String(u.email || '').toLowerCase());
        const exportOk = u.role === 'master_admin' || !!u.can_export;
        return `
        <div class="um2-row${u.is_active ? '' : ' is-inactive'}${S.flash === u.id ? ' ppms-flash' : ''}" data-um-row="${e2(u.id)}">
          <div class="um2-person">
            <span class="um2-avatar um2-avatar--${e2(u.role)}">${e2(initials(u.full_name || u.email))}</span>
            <span class="um2-name"><b>${e2(u.full_name || '—')}</b>${isMe ? ` <span class="um2-you">${e2(_t('(you)'))}</span>` : ''}<small>${e2(u.email)}</small></span>
          </div>
          <div class="um2-role"><span class="role-pill ${rc(u.role)}">${e2(rl(u.role))}</span></div>
          <div class="um2-mods">${mods ? mods.map(m => `<span class="um-module-chip">${e2(MODULE_SHORT[m] || m)}</span>`).join('') : `<span class="um-module-chip um-module-chip--all">${e2(_t('All'))}</span>`}
            <span class="um2-export${exportOk ? ' is-on' : ''}" title="${e2(_t(exportOk ? 'Can export Excel & PDF reports' : 'Cannot export reports'))}">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 2v8M5 7l3 3 3-3M3 13h10"/></svg>${e2(_t('Export'))}</span></div>
          <div class="um2-status">
            <button type="button" class="status-pill ${u.is_active ? 'active' : 'inactive'}" data-um-toggle="${e2(u.id)}" ${isMe ? 'disabled' : ''}
              title="${e2(isMe ? _t('You cannot deactivate your own account') : _t(u.is_active ? 'Click to deactivate' : 'Click to activate'))}">${e2(_t(u.is_active ? 'Active' : 'Inactive'))}</button>
          </div>
          <div class="um2-last" title="${e2(last ? new Date(last).toLocaleString(getLocale(), { hour12: false }) : '')}">${last ? e2(ago(last)) : `<span class="um2-dim">${e2(_t('Never'))}</span>`}</div>
          <div class="um2-acts">
            <button type="button" class="btn-um-edit" data-um-edit="${e2(u.id)}">${e2(_t('Edit'))}</button>
            <button type="button" class="btn-um-edit" data-um-activity="${e2(u.email)}" title="${e2(_t('Everything this user did, in the audit log'))}">${e2(_t('Activity'))}</button>
            ${isMe ? '' : `<button type="button" class="btn-um-del" data-um-delete="${e2(u.id)}">${e2(_t('Delete'))}</button>`}
          </div>
        </div>`;
    }).join('');
    S.flash = null;
}

/* ── Edit panel ──────────────────────────────────────────────── */
function setErr(msg, field) {
    const el = $('umFormError');
    if (el) el.textContent = msg || '';
    document.querySelectorAll('#umForm .is-invalid').forEach(x => x.classList.remove('is-invalid'));
    if (field) $(field)?.classList.add('is-invalid');
}

function syncForm() {
    const role = $('umRole')?.value;
    const g = $('umModulesGroup');
    if (g) g.hidden = role === 'master_admin';
    const ex = $('umCanExport');
    if (ex) { ex.disabled = role === 'master_admin'; if (role === 'master_admin') ex.checked = true; }
    const hint = $('umRoleHint');
    if (hint) hint.textContent = _t({
        master_admin: 'Full access to every module, users, audit log and system settings.',
        planner: 'Edits plan data and the plan schedule (Gantt), and manages plan versions.',
        operator: 'Records production data — actual dates, X-ray results, issues — but cannot change the schedule.',
        viewer: 'Read only.',
    }[role] || '');
}

export function openForm(userId) {
    const u = userId ? S.users.find(x => String(x.id) === String(userId)) : null;
    S.editing = u || null;
    $('umFormTitle').textContent = _t(u ? 'Edit User' : 'Add New User');
    $('umEditId').value = u?.id || '';
    $('umFullName').value = u?.full_name || '';
    $('umEmail').value = u?.email || '';
    $('umRole').value = u?.role || 'viewer';
    $('umActive').value = String(u ? !!u.is_active : true);
    $('umPassword').value = '';
    $('umPassword').type = 'password';
    const mods = Array.isArray(u?.modules) && u.modules.length ? u.modules : ALL_MODULES;
    document.querySelectorAll('.um-module-check').forEach(cb => { cb.checked = mods.includes(cb.value); });
    const ex = $('umCanExport'); if (ex) ex.checked = !!u?.can_export;
    const hint = $('umPasswordHint'); if (hint) hint.hidden = !u;
    const me = getCurrentUser()?.id;
    const self = u && u.id === me;
    $('umRole').disabled = !!self;
    $('umActive').disabled = !!self;
    const selfNote = $('umSelfNote'); if (selfNote) selfNote.hidden = !self;
    setErr('');
    syncForm();
    $('umForm').hidden = false;
    $('umOverlayBody')?.classList.add('is-editing');
    setTimeout(() => $('umFullName')?.focus(), 30);
}

export function closeForm() {
    const f = $('umForm');
    if (f) f.hidden = true;
    $('umOverlayBody')?.classList.remove('is-editing');
    S.editing = null;
}

/** Changes that would leave no active Master Admin. */
function lockoutReason(userId, nextRole, nextActive) {
    const u = S.users.find(x => String(x.id) === String(userId));
    if (!u || u.role !== 'master_admin' || !u.is_active) return '';
    if (nextRole === 'master_admin' && nextActive) return '';
    return activeAdmins().length <= 1 ? _t('This is the last active Master Admin — add or activate another Master Admin first.') : '';
}

async function save() {
    const id = $('umEditId').value;
    const fullName = $('umFullName').value.trim();
    const email = $('umEmail').value.trim().toLowerCase();
    const role = $('umRole').value;
    const password = $('umPassword').value;
    const isActive = $('umActive').value === 'true';
    const modules = [...document.querySelectorAll('.um-module-check:checked')].map(cb => cb.value);
    const canExport = role === 'master_admin' || !!$('umCanExport')?.checked;

    if (!fullName) return setErr(_t('Name is required.'), 'umFullName');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErr(_t('Enter a valid email address.'), 'umEmail');
    if (S.users.some(u => u.email?.toLowerCase() === email && String(u.id) !== String(id))) return setErr(_t('Email already exists.'), 'umEmail');
    if (!id && !password) return setErr(_t('Password is required for new users.'), 'umPassword');
    if (password && password.length < 6) return setErr(_t('New password must be at least 6 characters.'), 'umPassword');
    if (role !== 'master_admin' && !modules.length) return setErr(_t('Give the user access to at least one module.'));
    if (id) {
        const reason = lockoutReason(id, role, isActive);
        if (reason) return setErr(reason, 'umRole');
    }

    const payload = {
        full_name: fullName, email, role, is_active: isActive, updated_at: new Date().toISOString(),
        modules: modules.length ? modules : ALL_MODULES,
        can_export: canExport,
    };
    if (password) payload.password_hash = await sha256(password);
    const btn = $('btnUmSave');
    if (btn) btn.disabled = true;
    try {
        if (id) {
            const before = S.users.find(u => String(u.id) === String(id));
            let { error } = await db.from('planning_app_users').update(payload).eq('id', id);
            let retry = payload;
            while (error && typeof _stripUndefinedColumn === 'function' && (retry = _stripUndefinedColumn(retry, error))) {
                ({ error } = await db.from('planning_app_users').update(retry).eq('id', id));
            }
            if (error) throw error;
            const pick = o => o && { full_name: o.full_name, email: o.email, role: o.role, is_active: o.is_active, modules: o.modules, can_export: o.can_export };
            await auditLog('UPDATE', 'planning_app_users', id, pick(before), { ...pick(payload), ...(password ? { password_changed: true } : {}) });
            showToast(_t('User updated.'), 'success');
            S.flash = id;
        } else {
            payload.created_at = new Date().toISOString();
            let res = await db.from('planning_app_users').insert(payload).select('id').single();
            let retry = payload;
            while (res.error && typeof _stripUndefinedColumn === 'function' && (retry = _stripUndefinedColumn(retry, res.error))) {
                res = await db.from('planning_app_users').insert(retry).select('id').single();
            }
            if (res.error) throw res.error;
            await auditLog('INSERT', 'planning_app_users', res.data.id, null,
                { full_name: fullName, email, role, is_active: isActive, modules: payload.modules, can_export: canExport });
            showToast(_t('User created.'), 'success');
            S.flash = res.data.id;
        }
        closeForm();
        await load();
    } catch (err) {
        setErr(String(err.message || '').includes('duplicate') ? _t('Email already exists.') : (err.message || _t('Save failed.')));
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function toggleActive(id) {
    const u = S.users.find(x => String(x.id) === String(id));
    if (!u || u.id === getCurrentUser()?.id) return;
    const next = !u.is_active;
    const reason = next ? '' : lockoutReason(id, u.role, false);
    if (reason) { showToast(reason, 'error'); return; }
    if (!next && !window.confirm(_t('Deactivate {name}? They will not be able to sign in until you activate the account again.', { name: u.full_name || u.email }))) return;
    const { error } = await db.from('planning_app_users').update({ is_active: next, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { showToast(_t('Save failed.') + ' ' + error.message, 'error'); return; }
    await auditLog('UPDATE', 'planning_app_users', id, { full_name: u.full_name, is_active: u.is_active }, { full_name: u.full_name, is_active: next });
    u.is_active = next;
    S.flash = u.id;
    render();
    showToast(_t(next ? '{name} can sign in again.' : '{name} is deactivated.', { name: u.full_name || u.email }), 'success');
}

async function remove(id) {
    const u = S.users.find(x => String(x.id) === String(id));
    if (!u || u.id === getCurrentUser()?.id) return;
    const reason = lockoutReason(id, null, false);
    if (reason) { showToast(reason, 'error'); return; }
    if (!window.confirm(_t('Delete user "{name}"? This cannot be undone. Their actions stay in the audit log. To keep the account for later, set it to Inactive instead.', { name: u.full_name || u.email }))) return;
    const { error } = await db.from('planning_app_users').delete().eq('id', id);
    if (error) { showToast(_t('Delete failed:') + ' ' + error.message, 'error'); return; }
    await auditLog('DELETE', 'planning_app_users', id, { full_name: u.full_name, email: u.email, role: u.role }, null);
    showToast(_t('User "{a}" deleted.', { a: u.full_name || u.email }), 'success');
    load();
}

/* ── Open / close / wiring ───────────────────────────────────── */
export async function open(opts = {}) {
    const ov = $('userMgmtOverlay');
    if (!ov) return;
    ov.style.display = 'flex';
    closeForm();
    S.role = ''; S.status = '';
    const s = $('umSearch'); if (s) s.value = '';
    await load();
    if (opts.focusUser) {
        const u = S.users.find(x => String(x.id) === String(opts.focusUser) || x.email?.toLowerCase() === String(opts.focusUser).toLowerCase());
        if (u) {
            const row = document.querySelector(`[data-um-row="${CSS.escape(String(u.id))}"]`);
            row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            row?.classList.add('ppms-flash');
        }
    }
}
export function close() {
    const ov = $('userMgmtOverlay');
    if (ov) ov.style.display = 'none';
    closeForm();
}

export function wireUserManagement() {
    window.PPMSUsers = { open, close, openForm, closeForm, reload: load };
    document.addEventListener('click', ev => {
        if (!ev.target.closest?.('#userMgmtOverlay')) return;
        const t = ev.target;
        const pick = attr => t.closest(`[data-um-${attr}]`)?.dataset[`um${attr[0].toUpperCase()}${attr.slice(1)}`];
        const role = t.closest('[data-um-role]'), status = t.closest('[data-um-status]');
        if (role) { S.role = role.dataset.umRole; render(); return; }
        if (status) { S.status = S.status === status.dataset.umStatus ? '' : status.dataset.umStatus; render(); return; }
        let v;
        if ((v = pick('edit'))) return openForm(v);
        if ((v = pick('toggle'))) return toggleActive(v);
        if ((v = pick('delete'))) return remove(v);
        if ((v = t.closest('[data-um-activity]')?.dataset.umActivity)) { close(); window.PPMSAudit?.open({ user: v }); return; }
        if (t.closest('#btnUmPwToggle')) { const p = $('umPassword'); p.type = p.type === 'password' ? 'text' : 'password'; }
    });
    document.addEventListener('input', ev => { if (ev.target.id === 'umSearch') render(); });
    document.addEventListener('change', ev => { if (ev.target.id === 'umRole') syncForm(); });
    $('btnUmSave')?.addEventListener('click', save);
    $('umForm')?.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); save(); } });
}

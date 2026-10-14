/* ================================================================
   COMMANDS — instructions sent to people inside PPMS.

   • Master Admins and Planners write a command and tag people with @:
       @all            every active user
       @admins / @planners / @operators / @viewers   a whole role
       @name.surname   one person (the part of their email before the @)
   • Every tagged person gets it live. Normal → a toast; Urgent → a pop-up
     that stays until they press Acknowledge.
   • Each person's status: new (not opened) → seen → ack → done. The sender
     sees the counts and who is behind; anyone can reply.

   Tables (migration 63): ppms_commands, ppms_command_recipients,
   ppms_command_replies. If they don't exist yet the button stays hidden.
   Who sees the feature is set in the admin panel (ppms_settings,
   key commands_audience): 'off' | 'admins' (pilot) | 'everyone'.
   ================================================================ */
/* global db, getCurrentUser */
import { _t } from '../../core/i18n.js';

const SENDER_ROLES = ['master_admin', 'planner'];
const GROUPS = [
    { key: 'all', label: 'Everyone', roles: null },
    { key: 'admins', label: 'All Master Admins', roles: ['master_admin'] },
    { key: 'planners', label: 'All planners', roles: ['planner'] },
    { key: 'operators', label: 'All operators', roles: ['operator', 'admin'] },
    { key: 'viewers', label: 'All viewers', roles: ['viewer'] },
];
const ROLE_LABEL = { master_admin: 'Master Admin', planner: 'Planner', operator: 'Operator', admin: 'Operator', viewer: 'Viewer' };
const STATUS = {
    new: { label: 'Not opened', cls: 'new' },
    seen: { label: 'Seen', cls: 'seen' },
    ack: { label: 'Acknowledged', cls: 'ack' },
    done: { label: 'Done', cls: 'done' },
};
const COLORS = ['#4f8ef7', '#22c55e', '#f97316', '#a855f7', '#14b8a6', '#ec4899', '#eab308', '#06b6d4', '#ef4444', '#84cc16'];

const S = {
    ready: false,
    users: [],          // active users {id, email, full_name, role, handle}
    cmds: new Map(),    // id -> command {…, recipients: [], replies: []}
    tab: 'inbox',
    open: false,
    channel: null,
    shownUrgent: new Set(),
    audience: 'admins',
    wired: false,
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const me = () => getCurrentUser() || {};
const myId = () => String(me().id || '');
// In maintenance mode the session role is 'viewer'; realRole keeps the real one.
const myRole = () => me().realRole || me().role;
const canSend = () => SENDER_ROLES.includes(myRole());
const isPilot = () => S.audience === 'admins';
const canSee = () => S.audience === 'everyone' || (isPilot() && myRole() === 'master_admin');
/** People who can currently receive commands (during the pilot: Master Admins only). */
const reachable = () => S.users.filter(u => !isPilot() || u.role === 'master_admin');
const toast = (msg, type = 'info') => window.showToast?.(msg, type);
const userById = id => S.users.find(u => String(u.id) === String(id));
const colorFor = id => COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initials = name => String(name || '?').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const avatar = (id, name) => `<span class="cmd-av" style="background:${colorFor(id)}">${esc(initials(name))}</span>`;

function ago(iso) {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return _t('just now');
    if (m < 60) return _t('{n} min ago', { n: m });
    if (m < 1440) return _t('{n} h ago', { n: Math.round(m / 60) });
    return _t('{n} d ago', { n: Math.round(m / 1440) });
}
const fmtDue = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const isOverdue = c => c.due_date && c.due_date < new Date().toISOString().slice(0, 10);

/** Unique @handle per user: the part of the email before @ (plus the domain if two people share it). */
function assignHandles(users) {
    const base = u => String(u.email || u.full_name || u.id).toLowerCase().split('@')[0].replace(/[^a-z0-9._-]/g, '');
    const counts = {};
    users.forEach(u => { counts[base(u)] = (counts[base(u)] || 0) + 1; });
    users.forEach(u => {
        const b = base(u);
        u.handle = counts[b] > 1 ? `${b}.${String(u.email || '').split('@')[1]?.split('.')[0] || u.id}` : b;
    });
    return users;
}

/* ── Top-bar button (rendered by page-chrome) ───────────────── */
export function renderCommandsButton() {
    return `
        <div class="cmd-nav-wrap" id="cmdNavWrap" style="display:none">
            <button class="btn-nav-icon" id="btnCommands" title="${_t('Commands')}" aria-haspopup="dialog">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17 12.5a1.5 1.5 0 0 1-1.5 1.5H6l-3 3V4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5z"/>
                    <path d="M6.5 7.5h7M6.5 10.5h4"/>
                </svg>
                <span class="cmd-badge" id="cmdBadge" style="display:none">0</span>
            </button>
        </div>`;
}

function drawerHtml() {
    return `
    <aside class="cmd-drawer" id="cmdDrawer" aria-label="${_t('Commands')}" aria-hidden="true">
        <div class="cmd-head">
            <div class="cmd-title">
                <h2>${_t('Commands')}</h2>
                <span class="cmd-spacer"></span>
                <button class="cmd-icon" id="cmdHelpBtn" title="${_t('How to use Commands')}">?</button>
                <button class="cmd-icon" id="cmdClose" title="${_t('Close')}">✕</button>
            </div>
            <div class="cmd-tabs" id="cmdTabs"></div>
        </div>
        <div class="cmd-pilot" id="cmdPilot" hidden>${_t('<b>Pilot</b> — only Master Admins can see Commands for now. You can tag yourself to try it. Switch it on for everyone in the admin panel (Commands page).')}</div>
        <div class="cmd-help" id="cmdHelp" hidden>${helpHtml()}</div>
        <div class="cmd-feed" id="cmdFeed"></div>
        <div class="cmd-composer" id="cmdComposer" hidden>
            <div class="cmd-suggest" id="cmdSuggest"></div>
            <p class="cmd-to" id="cmdTo"></p>
            <div class="cmd-editor" id="cmdEditor" contenteditable="true" role="textbox" aria-multiline="true"
                 data-ph="${_t('Type @ to tag people, then write the command…')}"></div>
            <div class="cmd-opts">
                <label>${_t('Priority')} <select id="cmdPrio"><option value="normal">${_t('Normal')}</option><option value="urgent">${_t('Urgent')}</option></select></label>
                <label>${_t('Due')} <input type="date" id="cmdDue"></label>
                <input type="text" id="cmdAbout" maxlength="200" placeholder="${_t('About (optional) — e.g. BTL-01 K9 M3 welding')}">
                <button class="btn btn-primary btn-sm" id="cmdSend">${_t('Send')}</button>
            </div>
            <div class="cmd-hint">${_t('↑ ↓ choose · Enter or Tab tag · Esc close list · Ctrl+Enter send')}</div>
        </div>
    </aside>
    <div class="cmd-urgent" id="cmdUrgent" hidden><div class="cmd-urgent-card" id="cmdUrgentCard" role="alertdialog" aria-modal="true"></div></div>`;
}

function helpHtml() {
    return `
        <h3>${_t('How to use Commands')}</h3>
        <ol>
            <li>${_t('<b>Receiving:</b> new commands show a red number on the speech-bubble button. Open it to read them.')}</li>
            <li>${_t('<b>Acknowledge</b> = “I have read it and will do it”. <b>Mark done</b> = finished. <b>Reply</b> to answer or ask.')}</li>
            <li>${_t('<b>Urgent</b> commands appear in the middle of the screen until you acknowledge them.')}</li>
            <li>${_t('<b>Sending</b> (Master Admin and Planner): type <b>@</b> in the box at the bottom and pick who should get it:')}
                <br><code>@all</code> ${_t('everyone')} · <code>@planners</code> <code>@operators</code> <code>@viewers</code> <code>@admins</code> ${_t('a whole role')} · <code>@name.surname</code> ${_t('one person')}</li>
            <li>${_t('Write the instruction after the tags. Optionally set Urgent, a due date and what it is about, then <b>Send</b> (or Ctrl+Enter).')}</li>
            <li>${_t('The <b>To:</b> line shows exactly who will receive it. In <b>Sent</b>, click the counts to see who has not opened, acknowledged or finished it.')}</li>
        </ol>
        <p class="cmd-muted">${_t('Do not put passwords or confidential information in commands.')}</p>`;
}

/* ── Data ─────────────────────────────────────────────────────── */
async function loadAll() {
    const uid = myId();
    const { data: users } = await db.from('planning_app_users').select('id,email,full_name,role,is_active').eq('is_active', true);
    S.users = assignHandles((users || []).map(u => ({ ...u, id: String(u.id) })));

    const [{ data: mine, error: e1 }, sent] = await Promise.all([
        db.from('ppms_command_recipients').select('command_id').eq('user_id', uid).order('command_id', { ascending: false }).limit(200),
        canSend() ? db.from('ppms_commands').select('id').eq('sender_id', uid).order('id', { ascending: false }).limit(150) : { data: [] },
    ]);
    if (e1) throw e1;
    const ids = [...new Set([...(mine || []).map(r => r.command_id), ...(sent.data || []).map(r => r.id)])];
    S.cmds = new Map();
    if (!ids.length) return;
    const [{ data: cmds }, { data: recs }, { data: replies }] = await Promise.all([
        db.from('ppms_commands').select('*').in('id', ids),
        db.from('ppms_command_recipients').select('*').in('command_id', ids),
        db.from('ppms_command_replies').select('*').in('command_id', ids).order('created_at'),
    ]);
    (cmds || []).forEach(c => S.cmds.set(c.id, { ...c, recipients: [], replies: [] }));
    (recs || []).forEach(r => S.cmds.get(r.command_id)?.recipients.push(r));
    (replies || []).forEach(r => S.cmds.get(r.command_id)?.replies.push(r));
}
const myRow = c => c.recipients.find(r => String(r.user_id) === myId());

async function setStatus(cmdId, status) {
    const now = new Date().toISOString();
    const patch = { status, updated_at: now };
    if (status === 'seen') patch.seen_at = now;
    if (status === 'ack') { patch.ack_at = now; patch.seen_at = myRow(S.cmds.get(cmdId))?.seen_at || now; }
    if (status === 'done') { patch.done_at = now; patch.ack_at = myRow(S.cmds.get(cmdId))?.ack_at || now; }
    const { error } = await db.from('ppms_command_recipients').update(patch).eq('command_id', cmdId).eq('user_id', myId());
    if (error) { toast(_t('Could not update: {m}', { m: error.message }), 'error'); return; }
    Object.assign(myRow(S.cmds.get(cmdId)) || {}, patch);
    render();
}

/** Opening the panel counts as "seen" for normal commands (urgent ones need Acknowledge). */
async function markSeen() {
    const ids = [...S.cmds.values()].filter(c => myRow(c)?.status === 'new' && c.priority !== 'urgent').map(c => c.id);
    if (!ids.length) return;
    const now = new Date().toISOString();
    const { error } = await db.from('ppms_command_recipients').update({ status: 'seen', seen_at: now, updated_at: now })
        .eq('user_id', myId()).eq('status', 'new').in('command_id', ids);
    if (error) return;
    ids.forEach(id => Object.assign(myRow(S.cmds.get(id)), { status: 'seen', seen_at: now }));
    render();
}

/* ── Rendering ────────────────────────────────────────────────── */
function partsHtml(c) {
    const parts = Array.isArray(c.parts) && c.parts.length ? c.parts : [c.body];
    return parts.map(p => {
        if (typeof p === 'string') return esc(p);
        if (p.t === 'group') return `<span class="cmd-tag cmd-tag-group">@${esc(p.k)}</span>`;
        const u = userById(p.id);
        return `<span class="cmd-tag">@${esc(u?.handle || p.h)}</span>`;
    }).join('');
}

function lists() {
    const all = [...S.cmds.values()].sort((a, b) => b.id - a.id);
    return {
        inbox: all.filter(c => myRow(c)),
        todo: all.filter(c => myRow(c) && myRow(c).status !== 'done'),
        sent: all.filter(c => String(c.sender_id) === myId()),
    };
}

function render() {
    if (!S.ready) return;
    const L = lists();
    const unread = L.inbox.filter(c => myRow(c).status === 'new').length;
    const badge = $('cmdBadge');
    badge.style.display = unread ? '' : 'none';
    badge.textContent = unread > 99 ? '99+' : unread;
    $('btnCommands').title = unread ? _t('Commands — {n} new', { n: unread }) : _t('Commands');
    if (!S.open) return;

    const tabs = [['inbox', _t('Inbox')], ['todo', _t('To do')]];
    if (canSend()) tabs.push(['sent', _t('Sent')]);
    if (!tabs.some(t => t[0] === S.tab)) S.tab = 'inbox';
    $('cmdTabs').innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === S.tab ? 'on' : ''}">${l}<span class="cmd-count">${L[k].length}</span></button>`).join('');
    const list = L[S.tab];
    const empty = { inbox: _t('No commands for you yet.'), todo: _t('Nothing left to do. Well done!'), sent: _t('You have not sent any commands yet. Type @ in the box below to start.') }[S.tab];
    $('cmdFeed').innerHTML = list.length ? list.map(cardHtml).join('') : `<div class="cmd-empty">${empty}</div>`;
    $('cmdComposer').hidden = !canSend();
    $('cmdPilot').hidden = !isPilot();
}

function cardHtml(c) {
    const mine = myRow(c);
    const isSender = String(c.sender_id) === myId();
    const tally = { new: 0, seen: 0, ack: 0, done: 0 };
    c.recipients.forEach(r => { tally[r.status] = (tally[r.status] || 0) + 1; });
    const n = c.recipients.length;
    const due = c.due_date ? `<span class="${isOverdue(c) && mine?.status !== 'done' ? 'cmd-overdue' : 'cmd-due'}">${_t('due {d}', { d: fmtDue(c.due_date) })}</span>` : '';
    const actions = mine && mine.status !== 'done'
        ? `${mine.status !== 'ack' ? `<button class="btn btn-ghost btn-sm" data-act="ack" data-id="${c.id}">${_t('Acknowledge')}</button>` : `<span class="cmd-state ack">✓ ${_t('Acknowledged')}</span>`}
           <button class="btn btn-sm cmd-btn-done" data-act="done" data-id="${c.id}">${_t('Mark done')}</button>`
        : mine?.status === 'done' ? `<span class="cmd-state done">✓ ${_t('Done')}</span> <button class="cmd-link" data-act="ack" data-id="${c.id}">${_t('undo')}</button>` : '';
    return `<article class="cmd-card ${mine?.status === 'new' ? 'is-new' : ''} ${c.priority === 'urgent' ? 'is-urgent' : ''}" data-id="${c.id}">
        <div class="cmd-card-top">${avatar(c.sender_id, c.sender_name)}
            <div class="cmd-card-meta">
                <div><b>${esc(c.sender_name || c.sender_email)}</b>${isSender ? ` <span class="cmd-muted">(${_t('you')})</span>` : ''}</div>
                <div class="cmd-muted">${ago(c.created_at)} · ${_t('to {n}', { n: n === 1 ? _t('1 person') : _t('{n} people', { n }) })} ${due ? '· ' + due : ''}</div>
            </div>
            ${c.priority === 'urgent' ? `<span class="cmd-prio">${_t('Urgent')}</span>` : ''}
        </div>
        <p class="cmd-text">${partsHtml(c)}</p>
        ${c.about ? `<span class="cmd-about">↗ ${esc(c.about)}</span>` : ''}
        ${c.replies.map(r => `<div class="cmd-reply"><b>${esc(r.user_name)}</b> ${esc(r.body)} <span class="cmd-muted">· ${ago(r.created_at)}</span></div>`).join('')}
        <div class="cmd-card-foot">
            ${isSender ? `<button class="cmd-progress" data-who="${c.id}" title="${_t('Show who has seen / done it')}">
                <span><b>${tally.done}</b> ${_t('done')}</span><span><b>${tally.ack}</b> ${_t('acknowledged')}</span><span><b>${tally.seen}</b> ${_t('seen')}</span><span><b>${tally.new}</b> ${_t('not opened')}</span></button>` : ''}
            <span class="cmd-spacer"></span>
            ${actions}
            <button class="btn btn-ghost btn-sm" data-act="reply" data-id="${c.id}">${_t('Reply')}</button>
            ${isSender ? `<button class="cmd-link cmd-link-danger" data-act="withdraw" data-id="${c.id}" title="${_t('Delete this command for everyone')}">${_t('Withdraw')}</button>` : ''}
        </div>
        ${isSender ? `<div class="cmd-who" id="cmdWho${c.id}" hidden>${[...c.recipients].sort((a, b) => ['new', 'seen', 'ack', 'done'].indexOf(a.status) - ['new', 'seen', 'ack', 'done'].indexOf(b.status)).map(r =>
            `<div class="cmd-who-row">${avatar(r.user_id, r.user_name)}${esc(r.user_name || r.user_email)}<span class="cmd-st ${STATUS[r.status].cls}">${_t(STATUS[r.status].label)}</span></div>`).join('')}</div>` : ''}
    </article>`;
}

/* ── Panel open / close ──────────────────────────────────────── */
function openPanel(open = true) {
    S.open = open;
    $('cmdDrawer').classList.toggle('open', open);
    $('cmdDrawer').setAttribute('aria-hidden', String(!open));
    $('btnCommands').classList.toggle('active', open);
    if (open) { render(); setTimeout(markSeen, 1500); }
}

/* ── Arrivals: toast or urgent pop-up ────────────────────────── */
function showUrgent() {
    if (!$('cmdUrgent').hidden) return;
    const c = [...S.cmds.values()].sort((a, b) => a.id - b.id)
        .find(x => x.priority === 'urgent' && myRow(x) && ['new', 'seen'].includes(myRow(x).status) && !S.shownUrgent.has(x.id));
    if (!c) return;
    S.shownUrgent.add(c.id);
    $('cmdUrgentCard').innerHTML = `
        <h3>${_t('Urgent command')}</h3>
        <p class="cmd-muted">${_t('From {name}', { name: esc(c.sender_name) })} · ${ago(c.created_at)}${c.due_date ? ' · ' + _t('due {d}', { d: fmtDue(c.due_date) }) : ''}</p>
        <p class="cmd-text">${partsHtml(c)}</p>
        ${c.about ? `<span class="cmd-about">↗ ${esc(c.about)}</span>` : ''}
        <div class="cmd-card-foot"><span class="cmd-spacer"></span>
            <button class="btn btn-ghost btn-sm" id="cmdUrgentOpen">${_t('Open Commands')}</button>
            <button class="btn btn-primary btn-sm" id="cmdUrgentAck">${_t('Acknowledge')}</button></div>`;
    $('cmdUrgent').hidden = false;
    $('cmdUrgentAck').focus();
    $('cmdUrgentAck').onclick = async () => { $('cmdUrgent').hidden = true; await setStatus(c.id, 'ack'); showUrgent(); };
    $('cmdUrgentOpen').onclick = () => { $('cmdUrgent').hidden = true; S.tab = 'todo'; openPanel(true); };
}

async function onNewForMe(cmdId) {
    await refresh();
    const c = S.cmds.get(cmdId);
    if (!c) return;
    if (c.priority === 'urgent') showUrgent();
    else toast(_t('New command from {name}: {text}', { name: c.sender_name, text: c.body.slice(0, 80) }), 'info');
}

async function refresh() {
    try { await loadAll(); render(); } catch (e) { console.warn('Commands refresh failed:', e.message); }
}

function subscribe() {
    if (S.channel) { try { db.removeChannel(S.channel); } catch {} }
    S.channel = db.channel('ppms-commands')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ppms_command_recipients', filter: `user_id=eq.${myId()}` },
            p => onNewForMe(p.new.command_id))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ppms_command_recipients' }, p => {
            const c = S.cmds.get(p.new.command_id);
            if (!c) return;
            const r = c.recipients.find(x => String(x.user_id) === String(p.new.user_id));
            if (r) Object.assign(r, p.new); else c.recipients.push(p.new);
            render();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ppms_command_replies' }, p => {
            const c = S.cmds.get(p.new.command_id);
            if (!c || c.replies.some(r => r.id === p.new.id)) return;
            c.replies.push(p.new);
            if (String(p.new.user_id) !== myId()) toast(_t('{name} replied: {text}', { name: p.new.user_name, text: p.new.body.slice(0, 80) }), 'info');
            render();
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ppms_commands' }, p => {
            if (S.cmds.delete(p.old.id)) render();
        })
        .subscribe();
}

/* ── Composer: @ tagging ─────────────────────────────────────── */
let SG = { open: false, items: [], idx: 0 };
const groupMembers = g => reachable().filter(u => String(u.id) !== myId() && (!g.roles || g.roles.includes(u.role)));

function caretText() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!$('cmdEditor').contains(r.endContainer) || r.endContainer.nodeType !== 3) return null;
    return { node: r.endContainer, offset: r.endOffset, text: r.endContainer.textContent.slice(0, r.endOffset) };
}
function updateSuggest() {
    const t = caretText();
    const m = t && t.text.match(/(^|[\s ])@([\w.\-]*)$/);
    if (!m) return closeSuggest();
    const q = m[2].toLowerCase();
    const groups = GROUPS.filter(g => g.key.startsWith(q) || _t(g.label).toLowerCase().includes(q)).filter(g => groupMembers(g).length);
    // You can tag yourself by name (a reminder, or to try it during the pilot); groups never include you.
    const people = reachable().filter(u => u.handle.includes(q) || String(u.full_name || '').toLowerCase().includes(q))
        .sort((a, b) => (String(a.id) === myId()) - (String(b.id) === myId())).slice(0, 30);
    SG = { open: true, idx: 0, node: t.node, start: t.offset - q.length - 1, end: t.offset,
        items: [...groups.map(g => ({ t: 'group', g })), ...people.map(u => ({ t: 'user', u }))] };
    if (!SG.items.length) return closeSuggest();
    drawSuggest();
}
function drawSuggest() {
    let html = '', last = '';
    SG.items.forEach((it, i) => {
        if (it.t !== last) { html += `<div class="cmd-sg-head">${it.t === 'group' ? _t('Groups') : _t('People')}</div>`; last = it.t; }
        html += it.t === 'group'
            ? `<div class="cmd-sg ${i === SG.idx ? 'on' : ''}" data-i="${i}"><span class="cmd-av cmd-av-group">@</span><div><div>@${it.g.key}</div><div class="cmd-muted">${_t(it.g.label)} · ${_t('{n} people', { n: groupMembers(it.g).length })}</div></div></div>`
            : `<div class="cmd-sg ${i === SG.idx ? 'on' : ''}" data-i="${i}">${avatar(it.u.id, it.u.full_name)}<div><div>${esc(it.u.full_name || it.u.email)}${String(it.u.id) === myId() ? ` <span class="cmd-muted">(${_t('you')})</span>` : ''}</div><div class="cmd-muted cmd-mono">@${esc(it.u.handle)}</div></div><span class="cmd-sg-role">${_t(ROLE_LABEL[it.u.role] || it.u.role)}</span></div>`;
    });
    $('cmdSuggest').innerHTML = html;
    $('cmdSuggest').classList.add('open');
    $('cmdSuggest').querySelector('.cmd-sg.on')?.scrollIntoView({ block: 'nearest' });
}
function closeSuggest() { SG.open = false; $('cmdSuggest').classList.remove('open'); }
function pick(i) {
    const it = SG.items[i];
    const chip = document.createElement('span');
    chip.className = 'cmd-tag' + (it.t === 'group' ? ' cmd-tag-group' : '');
    chip.contentEditable = 'false';
    chip.dataset.t = it.t;
    chip.dataset.k = it.t === 'group' ? it.g.key : it.u.id;
    chip.textContent = '@' + (it.t === 'group' ? it.g.key : it.u.handle);
    const after = SG.node.splitText(SG.start);
    after.textContent = after.textContent.slice(SG.end - SG.start);
    after.parentNode.insertBefore(chip, after);
    const space = document.createTextNode(' ');
    after.parentNode.insertBefore(space, after);
    const r = document.createRange();
    r.setStart(space, 1); r.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    closeSuggest();
    updateTo();
}
function recipients() {
    const set = new Map();
    $('cmdEditor').querySelectorAll('.cmd-tag').forEach(t => {
        if (t.dataset.t === 'user') { const u = userById(t.dataset.k); if (u) set.set(u.id, u); }
        else groupMembers(GROUPS.find(g => g.key === t.dataset.k)).forEach(u => set.set(u.id, u));
    });
    return [...set.values()];
}
function updateTo(msg) {
    const r = recipients();
    $('cmdTo').innerHTML = msg || (r.length
        ? _t('To: <b>{n}</b> — {names}', { n: r.length === 1 ? _t('1 person') : _t('{n} people', { n: r.length }), names: r.slice(0, 6).map(u => esc(u.full_name || u.email)).join(', ') + (r.length > 6 ? ' ' + _t('and {n} more', { n: r.length - 6 }) : '') })
        : _t('To: nobody yet — type @ to tag people'));
}
function editorParts() {
    const parts = [];
    const walk = node => node.childNodes.forEach(n => {
        if (n.nodeType === 3) parts.push(n.textContent.replace(/ /g, ' '));
        else if (n.classList?.contains('cmd-tag')) parts.push(n.dataset.t === 'group' ? { t: 'group', k: n.dataset.k } : { t: 'user', id: n.dataset.k, h: n.textContent.slice(1) });
        else if (n.nodeName === 'BR') parts.push('\n');
        else { if (n.nodeName === 'DIV' && parts.length) parts.push('\n'); walk(n); }
    });
    walk($('cmdEditor'));
    // merge adjacent strings
    return parts.reduce((a, p) => { if (typeof p === 'string' && typeof a[a.length - 1] === 'string') a[a.length - 1] += p; else a.push(p); return a; }, []);
}

async function send() {
    const to = recipients();
    const parts = editorParts();
    const body = parts.map(p => typeof p === 'string' ? p : p.t === 'group' ? '@' + p.k : '@' + p.h).join('').trim();
    const words = parts.filter(p => typeof p === 'string').join('').trim();
    if (!to.length) return updateTo(`<span class="cmd-err">${_t('Tag at least one person or group with @ first.')}</span>`);
    if (!words) return updateTo(`<span class="cmd-err">${_t('Write the command after the tags.')}</span>`);
    const btn = $('cmdSend');
    btn.disabled = true;
    try {
        const u = me();
        const { data: cmd, error } = await db.from('ppms_commands').insert({
            sender_id: myId(), sender_name: u.name || u.full_name || u.email, sender_email: u.email,
            body: body.slice(0, 2000), parts, mentions: parts.filter(p => typeof p !== 'string').map(p => p.t === 'group' ? p.k : p.h),
            priority: $('cmdPrio').value, due_date: $('cmdDue').value || null, about: $('cmdAbout').value.trim() || null,
        }).select('*').single();
        if (error) throw error;
        const rows = to.map(r => ({ command_id: cmd.id, user_id: r.id, user_name: r.full_name || r.email, user_email: r.email }));
        const { error: e2 } = await db.from('ppms_command_recipients').insert(rows);
        if (e2) { await db.from('ppms_commands').delete().eq('id', cmd.id); throw e2; }
        S.cmds.set(cmd.id, { ...cmd, recipients: rows.map(r => ({ ...r, status: 'new' })), replies: [] });
        $('cmdEditor').innerHTML = ''; $('cmdPrio').value = 'normal'; $('cmdDue').value = ''; $('cmdAbout').value = '';
        S.tab = 'sent';
        render();
        updateTo(`<span class="cmd-ok">${_t('Sent to {n}.', { n: to.length === 1 ? _t('1 person') : _t('{n} people', { n: to.length }) })}</span>`);
    } catch (e) {
        updateTo(`<span class="cmd-err">${_t('Not sent: {m}', { m: esc(e.message) })}</span>`);
    } finally { btn.disabled = false; }
}

/* ── Wiring ───────────────────────────────────────────────────── */
function wireDom() {
    $('btnCommands').addEventListener('click', () => openPanel(!S.open));
    $('cmdClose').addEventListener('click', () => openPanel(false));
    $('cmdHelpBtn').addEventListener('click', () => { $('cmdHelp').hidden = !$('cmdHelp').hidden; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.open && !SG.open && $('cmdUrgent').hidden) openPanel(false); });
    $('cmdTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { S.tab = b.dataset.tab; render(); } });
    $('cmdFeed').addEventListener('click', async e => {
        const who = e.target.closest('[data-who]');
        if (who) { const el = $('cmdWho' + who.dataset.who); el.hidden = !el.hidden; return; }
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const id = Number(b.dataset.id);
        const card = b.closest('.cmd-card');
        if (b.dataset.act === 'ack' || b.dataset.act === 'done') return setStatus(id, b.dataset.act);
        if (b.dataset.act === 'withdraw') {
            if (!window.confirm(_t('Withdraw this command? It disappears for everyone it was sent to.'))) return;
            const { error } = await db.from('ppms_commands').delete().eq('id', id);
            if (error) return toast(_t('Could not withdraw: {m}', { m: error.message }), 'error');
            S.cmds.delete(id); render(); return;
        }
        if (b.dataset.act === 'reply') {
            if (card.querySelector('.cmd-reply-box')) return card.querySelector('.cmd-reply-box input').focus();
            card.insertAdjacentHTML('beforeend', `<div class="cmd-reply-box"><input type="text" maxlength="1000" placeholder="${_t('Write a reply…')}"><button class="btn btn-primary btn-sm" data-act="send-reply" data-id="${id}">${_t('Send')}</button></div>`);
            const input = card.querySelector('.cmd-reply-box input');
            input.focus();
            input.addEventListener('keydown', ev => { if (ev.key === 'Enter') card.querySelector('[data-act="send-reply"]').click(); });
            return;
        }
        if (b.dataset.act === 'send-reply') {
            const text = card.querySelector('.cmd-reply-box input').value.trim();
            if (!text) return;
            b.disabled = true;
            const { data, error } = await db.from('ppms_command_replies')
                .insert({ command_id: id, user_id: myId(), user_name: me().name || me().email, body: text }).select('*').single();
            if (error) { b.disabled = false; return toast(_t('Reply not sent: {m}', { m: error.message }), 'error'); }
            const c = S.cmds.get(id);
            if (!c.replies.some(r => r.id === data.id)) c.replies.push(data);
            if (myRow(c)?.status === 'new') await setStatus(id, 'seen'); else render();
        }
    });
    const ed = $('cmdEditor');
    ed.addEventListener('input', () => { updateSuggest(); updateTo(); });
    ed.addEventListener('click', updateSuggest);
    ed.addEventListener('keydown', e => {
        if (SG.open) {
            if (e.key === 'ArrowDown') { SG.idx = (SG.idx + 1) % SG.items.length; drawSuggest(); e.preventDefault(); return; }
            if (e.key === 'ArrowUp') { SG.idx = (SG.idx - 1 + SG.items.length) % SG.items.length; drawSuggest(); e.preventDefault(); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { pick(SG.idx); e.preventDefault(); return; }
            if (e.key === 'Escape') { closeSuggest(); e.preventDefault(); return; }
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { send(); e.preventDefault(); }
    });
    // Paste as plain text so formatting from other apps doesn't come along.
    ed.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
    $('cmdSuggest').addEventListener('mousedown', e => { const s = e.target.closest('[data-i]'); if (s) { e.preventDefault(); pick(Number(s.dataset.i)); } });
    $('cmdSend').addEventListener('click', send);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh().then(showUrgent); });
}

/** db is created by app.js after start-up; wait for it. */
function whenDbReady(cb, tries = 0) {
    if (typeof db !== 'undefined' && db && getCurrentUser()?.id) return cb();
    if (tries > 120) return;
    setTimeout(() => whenDbReady(cb, tries + 1), 500);
}

async function loadAudience() {
    const { data, error } = await db.from('ppms_settings').select('value').eq('key', 'commands_audience').maybeSingle();
    S.audience = !error && ['off', 'admins', 'everyone'].includes(data?.value) ? data.value : 'admins';
}

/** Show or hide the whole feature for this user, after the audience changes. */
async function applyAudience() {
    const show = canSee();
    $('cmdNavWrap').style.display = show ? '' : 'none';
    if (!show) { if (S.open) openPanel(false); $('cmdUrgent') && ($('cmdUrgent').hidden = true); return; }
    if (!S.wired) {
        document.body.insertAdjacentHTML('beforeend', drawerHtml());
        S.wired = true;
        S.ready = true;
        wireDom();
        updateTo();
        subscribe();
    }
    await refresh();
    showUrgent();
}

export function wireCommands() {
    whenDbReady(async () => {
        // Feature switches itself on only once migration 63 exists.
        const probe = await db.from('ppms_commands').select('id').limit(1);
        if (probe.error) { console.info('Commands not available yet:', probe.error.message); return; }
        await loadAudience();
        await applyAudience();
        // The admin panel can change the audience at any time — follow it live.
        db.channel('ppms-settings')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ppms_settings' }, async () => {
                await loadAudience();
                await applyAudience();
            })
            .subscribe();
    });
}

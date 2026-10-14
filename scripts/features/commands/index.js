/* ================================================================
   COMMANDS — instructions sent to people inside PPMS, shown like a
   message thread (the twin of "Ask PPMS", at the top right).

   • A "Commands" pill sits under the top bar, right side. It FLASHES and
     shows a count whenever a command (or a reply to one of yours)
     arrives, until you open it.
   • The window reads like a chat: oldest at the top, newest at the
     bottom, your own commands on the right.
   • Anyone except Viewers can send. Tag people with @:
       @all            every active user
       @admins / @planners / @operators / @viewers   a whole role
       @name.surname   one person (the part of their email before the @)
   • Each person's status: new (not opened) → seen → ack → done. Urgent
     commands pop up mid-screen until acknowledged.

   Tables (migration 63): ppms_commands, ppms_command_recipients,
   ppms_command_replies; ppms_settings.commands_audience decides who sees
   the feature ('off' | 'admins' pilot | 'everyone'), set in the admin panel.
   ================================================================ */
/* global db, getCurrentUser */
import { _t } from '../../core/i18n.js';

const SENDER_ROLES = ['master_admin', 'planner', 'operator', 'admin'];   // everyone except viewers
const GROUPS = [
    { key: 'all', label: 'Everyone', roles: null },
    { key: 'admins', label: 'All Master Admins', roles: ['master_admin'] },
    { key: 'planners', label: 'All planners', roles: ['planner'] },
    { key: 'operators', label: 'All operators', roles: ['operator', 'admin'] },
    { key: 'viewers', label: 'All viewers', roles: ['viewer'] },
];
const ROLE_LABEL = { master_admin: 'Master Admin', planner: 'Planner', operator: 'Operator', admin: 'Operator', viewer: 'Viewer' };
const STATUS_LABEL = { new: 'Not opened', seen: 'Seen', ack: 'Acknowledged', done: 'Done' };
const STATUS_ORDER = ['new', 'seen', 'ack', 'done'];
const COLORS = ['#4f8ef7', '#22c55e', '#f97316', '#a855f7', '#14b8a6', '#ec4899', '#eab308', '#06b6d4', '#ef4444', '#84cc16'];

const S = {
    ready: false, wired: false, open: false,
    audience: 'admins',
    users: [],
    cmds: new Map(),
    filter: 'all',
    shownUrgent: new Set(),
    unseenReplies: 0,
    channel: null,
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (p, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON_CMD = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>';
const me = () => getCurrentUser() || {};
const myId = () => String(me().id || '');
const myRole = () => me().realRole || me().role;             // realRole: maintenance mode keeps the true role
const canSend = () => SENDER_ROLES.includes(myRole());
const isPilot = () => S.audience === 'admins';
const canSee = () => S.audience === 'everyone' || (isPilot() && myRole() === 'master_admin');
/** Can this user open Commands right now? (during the pilot only Master Admins can) */
const canOpen = u => !isPilot() || u.role === 'master_admin';
const toast = (m, t = 'info') => window.showToast?.(m, t);
const userById = id => S.users.find(u => String(u.id) === String(id));
const colorFor = id => COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initials = n => String(n || '?').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const avatar = (id, name, cls = '') => `<span class="cmx-av ${cls}" style="background:${colorFor(id)}">${esc(initials(name))}</span>`;
const people = n => n === 1 ? _t('1 person') : _t('{n} people', { n });
const today = () => new Date().toISOString().slice(0, 10);
const fmtDue = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const fmtTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
function dayLabel(iso) {
    const d = new Date(iso); const t = new Date(); const y = new Date(Date.now() - 864e5);
    if (d.toDateString() === t.toDateString()) return _t('Today');
    if (d.toDateString() === y.toDateString()) return _t('Yesterday');
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}
function ago(iso) {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return _t('just now');
    if (m < 60) return _t('{n} min ago', { n: m });
    if (m < 1440) return _t('{n} h ago', { n: Math.round(m / 60) });
    return _t('{n} d ago', { n: Math.round(m / 1440) });
}

/** Unique @handle per user: the part of the email before @ (plus the domain if two people share it). */
function assignHandles(users) {
    const base = u => String(u.email || u.full_name || u.id).toLowerCase().split('@')[0].replace(/[^a-z0-9._-]/g, '');
    const counts = {};
    users.forEach(u => { counts[base(u)] = (counts[base(u)] || 0) + 1; });
    users.forEach(u => { const b = base(u); u.handle = counts[b] > 1 ? `${b}.${String(u.email || '').split('@')[1]?.split('.')[0] || u.id}` : b; });
    return users;
}

/* ── Markup ───────────────────────────────────────────────────── */
function shellHtml() {
    return `
    <div class="cmx" id="cmx">
        <button type="button" class="cmx-launcher" id="cmxLauncher" aria-expanded="false" aria-controls="cmxPanel">
            <span class="cmx-launcher-icon">${svg(ICON_CMD, 1.9)}</span>
            <span class="cmx-launcher-label">${_t('Commands')}</span>
            <span class="cmx-badge" id="cmxBadge" hidden>0</span>
        </button>
        <section class="cmx-panel" id="cmxPanel" hidden role="dialog" aria-label="${_t('Commands')}">
            <header class="cmx-head">
                <span class="cmx-head-icon">${svg(ICON_CMD, 1.9)}</span>
                <div class="cmx-head-text"><strong>${_t('Commands')}</strong><span id="cmxSub"></span></div>
                <button type="button" class="cmx-icon-btn" id="cmxHelpBtn" title="${_t('How to use Commands')}">?</button>
                <button type="button" class="cmx-icon-btn" id="cmxClose" title="${_t('Close')}">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 2)}</button>
            </header>
            <div class="cmx-pilot" id="cmxPilot" hidden>${_t('<b>Pilot:</b> only Master Admins can open Commands for now. You can still tag anyone — they see it once you switch it on for everyone in the admin panel.')}</div>
            <div class="cmx-filters" id="cmxFilters"></div>
            <div class="cmx-help" id="cmxHelp" hidden>${helpHtml()}</div>
            <div class="cmx-log" id="cmxLog" aria-live="polite"></div>
            <div class="cmx-composer" id="cmxComposer" hidden>
                <div class="cmx-suggest" id="cmxSuggest"></div>
                <p class="cmx-to" id="cmxTo"></p>
                <div class="cmx-box">
                    <div class="cmx-editor" id="cmxEditor" contenteditable="true" role="textbox" aria-multiline="true"
                         data-ph="${_t('Write the command… (type @ to tag people)')}"></div>
                    <button type="button" class="cmx-send" id="cmxSend" title="${_t('Send (Ctrl+Enter)')}">${svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 2.2)}</button>
                </div>
                <div class="cmx-opts">
                    <button type="button" class="cmx-tagbtn" id="cmxTagBtn">@ ${_t('Tag people')}</button>
                    <label class="cmx-urgent-toggle" title="${_t('Pops up on their screen until they acknowledge')}"><input type="checkbox" id="cmxUrgentOpt"> ${_t('Urgent')}</label>
                    <button type="button" class="cmx-link" id="cmxMoreBtn">${_t('More')} ▾</button>
                </div>
                <div class="cmx-more" id="cmxMore" hidden>
                    <label>${_t('Due')} <input type="date" id="cmxDue"></label>
                    <input type="text" id="cmxAbout" maxlength="200" placeholder="${_t('About — e.g. BTL-01 K9 M3 welding')}">
                </div>
            </div>
        </section>
    </div>
    <div class="cmx-urgent" id="cmxUrgent" hidden><div class="cmx-urgent-card" id="cmxUrgentCard" role="alertdialog" aria-modal="true"></div></div>`;
}

function helpHtml() {
    return `
        <h3>${_t('How to use Commands')}</h3>
        <ol>
            <li>${_t('The <b>Commands</b> button flashes when a command or a reply arrives for you. Click it to open this window.')}</li>
            <li>${_t('Under each command: <b>Acknowledge</b> = “I will do it”, <b>Done</b> = finished, <b>Reply</b> = answer or ask.')}</li>
            <li>${_t('<b>Urgent</b> commands appear in the middle of the screen until you acknowledge them.')}</li>
            <li>${_t('To send (everyone except Viewers): press <b>@ Tag people</b> (or type <b>@</b>) and choose who gets it:')}
                <br><code>@all</code> ${_t('everyone')} · <code>@planners</code> <code>@operators</code> <code>@viewers</code> <code>@admins</code> ${_t('a whole role')} · <code>@name.surname</code> ${_t('one person')}</li>
            <li>${_t('Write the instruction, tick <b>Urgent</b> if needed (<b>More</b> adds a due date), then press the arrow (or Ctrl+Enter).')}</li>
            <li>${_t('Your own commands are on the right. Click their status line to see who has not opened, acknowledged or finished them.')}</li>
        </ol>
        <p class="cmx-muted">${_t('Do not put passwords or confidential information in commands.')}</p>`;
}

/* ── Data ─────────────────────────────────────────────────────── */
async function loadAll() {
    const uid = myId();
    const { data: users } = await db.from('planning_app_users').select('id,email,full_name,role,is_active').eq('is_active', true);
    S.users = assignHandles((users || []).map(u => ({ ...u, id: String(u.id) })));
    const [{ data: mine, error }, sent] = await Promise.all([
        db.from('ppms_command_recipients').select('command_id').eq('user_id', uid).order('command_id', { ascending: false }).limit(200),
        db.from('ppms_commands').select('id').eq('sender_id', uid).order('id', { ascending: false }).limit(150),
    ]);
    if (error) throw error;
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
const isMine = c => String(c.sender_id) === myId();

async function setStatus(cmdId, status) {
    const c = S.cmds.get(cmdId);
    const now = new Date().toISOString();
    const patch = { status, updated_at: now };
    if (status === 'seen') patch.seen_at = now;
    if (status === 'ack') { patch.ack_at = now; patch.seen_at = myRow(c)?.seen_at || now; }
    if (status === 'done') { patch.done_at = now; patch.ack_at = myRow(c)?.ack_at || now; patch.seen_at = myRow(c)?.seen_at || now; }
    const { error } = await db.from('ppms_command_recipients').update(patch).eq('command_id', cmdId).eq('user_id', myId());
    if (error) return toast(_t('Could not update: {m}', { m: error.message }), 'error');
    Object.assign(myRow(c) || {}, patch);
    render();
}

/** Opening the window marks normal commands as seen (urgent ones need Acknowledge). */
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
        if (p.t === 'group') return `<span class="cmx-tag cmx-tag-group">@${esc(p.k)}</span>`;
        return `<span class="cmx-tag">@${esc(userById(p.id)?.handle || p.h)}</span>`;
    }).join('');
}

const FILTERS = [
    ['all', 'All', () => true],
    ['todo', 'To do', c => myRow(c) && myRow(c).status !== 'done'],
    ['sent', 'Sent', c => isMine(c)],
];

function counts() {
    const all = [...S.cmds.values()];
    return {
        unread: all.filter(c => myRow(c)?.status === 'new').length,
        todo: all.filter(c => myRow(c) && myRow(c).status !== 'done').length,
    };
}

function updateLauncher() {
    const { unread } = counts();
    const n = unread + S.unseenReplies;
    $('cmxBadge').hidden = !n;
    $('cmxBadge').textContent = n > 99 ? '99+' : n;
    $('cmxLauncher').classList.toggle('is-flashing', n > 0 && !S.open);
    $('cmxLauncher').title = n ? _t('Commands — {n} new', { n }) : _t('Commands');
}

function render() {
    if (!S.ready) return;
    updateLauncher();
    if (!S.open) return;
    const { unread, todo } = counts();
    $('cmxSub').textContent = [unread ? _t('{n} new', { n: unread }) : '', todo ? _t('{n} to do', { n: todo }) : _t('nothing to do')].filter(Boolean).join(' · ');
    $('cmxPilot').hidden = !isPilot();
    $('cmxComposer').hidden = !canSend();
    $('cmxFilters').innerHTML = FILTERS.filter(([k]) => k !== 'sent' || canSend()).map(([k, l, f]) =>
        `<button type="button" data-filter="${k}" class="${S.filter === k ? 'on' : ''}">${_t(l)} <span>${[...S.cmds.values()].filter(f).length}</span></button>`).join('');
    const test = FILTERS.find(f => f[0] === S.filter)[2];
    const list = [...S.cmds.values()].filter(test).sort((a, b) => a.id - b.id);   // chat order: newest last
    const log = $('cmxLog');
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    let html = '', lastDay = '';
    for (const c of list) {
        const d = dayLabel(c.created_at);
        if (d !== lastDay) { html += `<div class="cmx-day"><span>${esc(d)}</span></div>`; lastDay = d; }
        html += bubbleHtml(c);
    }
    log.innerHTML = list.length ? html : `<div class="cmx-empty">${svg(ICON_CMD, 1.4)}<p>${{
        all: canSend() ? _t('No commands yet.<br><br><b>To send one:</b><br>1. Press <b>@ Tag people</b> and pick who must act<br>2. Write what needs doing<br>3. Press the blue arrow') : _t('No commands yet. They will appear here.'),
        todo: _t('Nothing left to do. Well done!'), sent: _t('You have not sent any commands yet.'),
    }[S.filter]}</p></div>`;
    if (nearBottom || render.scrollNext) { log.scrollTop = log.scrollHeight; render.scrollNext = false; }
}

function bubbleHtml(c) {
    const mineCmd = isMine(c);
    const row = myRow(c);
    const tally = { new: 0, seen: 0, ack: 0, done: 0 };
    c.recipients.forEach(r => { tally[r.status]++; });
    const n = c.recipients.length;
    const overdue = c.due_date && c.due_date < today() && row?.status !== 'done';
    const meta = [
        c.priority === 'urgent' ? `<span class="cmx-urgent-tag">${_t('Urgent')}</span>` : '',
        c.due_date ? `<span class="${overdue ? 'cmx-overdue' : ''}">${_t('due {d}', { d: fmtDue(c.due_date) })}</span>` : '',
        c.about ? `<span class="cmx-about">↗ ${esc(c.about)}</span>` : '',
    ].filter(Boolean).join('');
    const actions = row
        ? row.status === 'done'
            ? `<span class="cmx-state done">✓ ${_t('Done')}</span><button type="button" class="cmx-link" data-act="ack" data-id="${c.id}">${_t('undo')}</button>`
            : `${row.status === 'ack' ? `<span class="cmx-state ack">✓ ${_t('Acknowledged')}</span>` : `<button type="button" class="cmx-chip" data-act="ack" data-id="${c.id}">${_t('Acknowledge')}</button>`}
               <button type="button" class="cmx-chip cmx-chip-done" data-act="done" data-id="${c.id}">${_t('Done')}</button>`
        : '';
    const statusLine = mineCmd
        ? `<button type="button" class="cmx-status" data-who="${c.id}" title="${_t('Show who has seen / done it')}">
              ${tally.done === n ? `<b class="ok">✓ ${_t('All done')}</b>` : `<b>${_t('{a} of {n} done', { a: tally.done, n })}</b>`}${tally.new ? ` · <span class="cmx-warn">${_t('{n} not opened yet', { n: tally.new })}</span>` : ''} ▸</button>`
        : '';
    return `<div class="cmx-msg ${mineCmd ? 'is-mine' : ''} ${row?.status === 'new' ? 'is-new' : ''} ${c.priority === 'urgent' ? 'is-urgent' : ''}" data-id="${c.id}">
        ${mineCmd ? '' : avatar(c.sender_id, c.sender_name)}
        <div class="cmx-col">
            <div class="cmx-from">${mineCmd ? _t('You') : esc(c.sender_name || c.sender_email)} <span>· ${fmtTime(c.created_at)} · ${_t('to {n}', { n: people(n) })}</span></div>
            <div class="cmx-bubble">
                <div class="cmx-text">${partsHtml(c)}</div>
                ${meta ? `<div class="cmx-meta">${meta}</div>` : ''}
            </div>
            ${statusLine}
            ${mineCmd ? `<div class="cmx-who" id="cmxWho${c.id}" hidden>${[...c.recipients].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)).map(r =>
                `<div class="cmx-who-row">${avatar(r.user_id, r.user_name, 'sm')}<span>${esc(r.user_name || r.user_email)}</span><em class="st-${r.status}">${_t(STATUS_LABEL[r.status])}</em></div>`).join('')}</div>` : ''}
            ${c.replies.length ? `<div class="cmx-replies">${c.replies.map(r => `<div class="cmx-reply">${avatar(r.user_id, r.user_name, 'xs')}<div><b>${esc(r.user_name)}</b> <span class="cmx-muted">${ago(r.created_at)}</span><div>${esc(r.body)}</div></div></div>`).join('')}</div>` : ''}
            <div class="cmx-actions">${actions}
                <button type="button" class="cmx-link" data-act="reply" data-id="${c.id}">${_t('Reply')}</button>
                ${mineCmd ? `<button type="button" class="cmx-link cmx-link-danger" data-act="withdraw" data-id="${c.id}" title="${_t('Delete this command for everyone')}">${_t('Withdraw')}</button>` : ''}
            </div>
        </div>
    </div>`;
}

/* ── Open / close, arrivals ──────────────────────────────────── */
function openPanel(open = true) {
    S.open = open;
    $('cmxPanel').hidden = !open;
    $('cmxLauncher').classList.toggle('is-open', open);
    $('cmxLauncher').setAttribute('aria-expanded', String(open));
    if (open) {
        S.unseenReplies = 0;
        render.scrollNext = true;
        render();
        setTimeout(markSeen, 1200);
        if (canSend()) setTimeout(() => $('cmxEditor')?.focus(), 50);
    } else updateLauncher();
}

/** Restart the flash so a new arrival is noticed even if it was already flashing. */
function flash() {
    const b = $('cmxLauncher');
    b.classList.remove('is-flashing');
    void b.offsetWidth;
    if (!S.open) b.classList.add('is-flashing');
}

function showUrgent() {
    if (!$('cmxUrgent').hidden) return;
    const c = [...S.cmds.values()].sort((a, b) => a.id - b.id)
        .find(x => x.priority === 'urgent' && myRow(x) && ['new', 'seen'].includes(myRow(x).status) && !S.shownUrgent.has(x.id));
    if (!c) return;
    S.shownUrgent.add(c.id);
    $('cmxUrgentCard').innerHTML = `
        <div class="cmx-urgent-top">${svg('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>', 2)}<h3>${_t('Urgent command')}</h3></div>
        <p class="cmx-muted">${_t('From {name}', { name: esc(c.sender_name) })} · ${ago(c.created_at)}${c.due_date ? ' · ' + _t('due {d}', { d: fmtDue(c.due_date) }) : ''}</p>
        <div class="cmx-text">${partsHtml(c)}</div>
        ${c.about ? `<div class="cmx-meta"><span class="cmx-about">↗ ${esc(c.about)}</span></div>` : ''}
        <div class="cmx-urgent-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="cmxUrgentOpen">${_t('Open Commands')}</button>
            <button type="button" class="btn btn-primary btn-sm" id="cmxUrgentAck">${_t('Acknowledge')}</button></div>`;
    $('cmxUrgent').hidden = false;
    $('cmxUrgentAck').focus();
    $('cmxUrgentAck').onclick = async () => { $('cmxUrgent').hidden = true; await setStatus(c.id, 'ack'); showUrgent(); };
    $('cmxUrgentOpen').onclick = () => { $('cmxUrgent').hidden = true; S.filter = 'todo'; openPanel(true); };
}

async function onNewForMe(cmdId) {
    await refresh();
    const c = S.cmds.get(cmdId);
    if (!c) return;
    render.scrollNext = true;
    flash();
    if (c.priority === 'urgent') showUrgent();
    else if (!isMine(c)) toast(_t('New command from {name}: {text}', { name: c.sender_name, text: c.body.slice(0, 80) }), 'info');
    render();
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
            if (String(p.new.user_id) !== myId()) {
                if (!S.open) S.unseenReplies++;
                flash();
                toast(_t('{name} replied: {text}', { name: p.new.user_name, text: p.new.body.slice(0, 80) }), 'info');
            }
            render();
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ppms_commands' }, p => {
            if (S.cmds.delete(p.old.id)) render();
        })
        .subscribe();
}

/* ── Composer: @ tagging ─────────────────────────────────────── */
let SG = { open: false, items: [], idx: 0 };
const groupMembers = g => S.users.filter(u => String(u.id) !== myId() && (!g.roles || g.roles.includes(u.role)));

function caretText() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!$('cmxEditor').contains(r.endContainer) || r.endContainer.nodeType !== 3) return null;
    return { node: r.endContainer, offset: r.endOffset, text: r.endContainer.textContent.slice(0, r.endOffset) };
}
function updateSuggest() {
    const t = caretText();
    const m = t && t.text.match(/(^|[\s ])@([\w.\-]*)$/);
    if (!m) return closeSuggest();
    const q = m[2].toLowerCase();
    const groups = GROUPS.filter(g => g.key.startsWith(q) || _t(g.label).toLowerCase().includes(q)).filter(g => g.key === 'all' || groupMembers(g).length);
    // You can tag yourself by name (a reminder, or to try it out); groups never include you.
    const ppl = S.users.filter(u => u.handle.includes(q) || String(u.full_name || '').toLowerCase().includes(q))
        .sort((a, b) => (String(a.id) === myId()) - (String(b.id) === myId())).slice(0, 30);
    SG = { open: true, idx: 0, node: t.node, start: t.offset - q.length - 1, end: t.offset,
        items: [...groups.map(g => ({ t: 'group', g })), ...ppl.map(u => ({ t: 'user', u }))] };
    if (!SG.items.length) return closeSuggest();
    drawSuggest();
}
function drawSuggest() {
    let html = '', last = '';
    SG.items.forEach((it, i) => {
        if (it.t !== last) { html += `<div class="cmx-sg-head">${it.t === 'group' ? _t('Groups') : _t('People')}</div>`; last = it.t; }
        html += it.t === 'group'
            ? `<div class="cmx-sg ${i === SG.idx ? 'on' : ''}" data-i="${i}"><span class="cmx-av cmx-av-group">@</span><div><div>@${it.g.key}</div><div class="cmx-muted">${_t(it.g.label)} · ${people(groupMembers(it.g).length)}</div></div></div>`
            : `<div class="cmx-sg ${i === SG.idx ? 'on' : ''}" data-i="${i}">${avatar(it.u.id, it.u.full_name)}<div><div>${esc(it.u.full_name || it.u.email)}${String(it.u.id) === myId() ? ` <span class="cmx-muted">(${_t('you')})</span>` : ''}</div><div class="cmx-muted cmx-mono">@${esc(it.u.handle)}</div></div><span class="cmx-sg-role">${_t(ROLE_LABEL[it.u.role] || it.u.role)}</span></div>`;
    });
    $('cmxSuggest').innerHTML = html;
    $('cmxSuggest').classList.add('open');
    $('cmxSuggest').querySelector('.cmx-sg.on')?.scrollIntoView({ block: 'nearest' });
}
function closeSuggest() { SG.open = false; $('cmxSuggest').classList.remove('open'); }
function pick(i) {
    const it = SG.items[i];
    const chip = document.createElement('span');
    chip.className = 'cmx-tag' + (it.t === 'group' ? ' cmx-tag-group' : '');
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
    $('cmxEditor').querySelectorAll('.cmx-tag').forEach(t => {
        if (t.dataset.t === 'user') { const u = userById(t.dataset.k); if (u) set.set(u.id, u); }
        else groupMembers(GROUPS.find(g => g.key === t.dataset.k)).forEach(u => set.set(u.id, u));
    });
    return [...set.values()];
}
function updateTo(msg) {
    if (msg) { $('cmxTo').innerHTML = msg; return; }
    const r = recipients();
    if (!r.length) { $('cmxTo').innerHTML = `<b>${_t('To:')}</b> ${_t('nobody yet — press <b>@ Tag people</b> or type @')}`; return; }
    const names = r.slice(0, 4).map(u => esc(String(u.id) === myId() ? _t('you') : (u.full_name || u.email).split(' ')[0])).join(', ') + (r.length > 4 ? ' ' + _t('+{n} more', { n: r.length - 4 }) : '');
    const waiting = r.filter(u => !canOpen(u)).length;
    $('cmxTo').innerHTML = `<b>${_t('To:')}</b> ${people(r.length)} — ${names}`
        + (waiting ? `<span class="cmx-to-warn">${_t('{n} of them will see it when Commands is switched on for everyone (pilot).', { n: waiting })}</span>` : '');
}
function editorParts() {
    const parts = [];
    const walk = node => node.childNodes.forEach(n => {
        if (n.nodeType === 3) parts.push(n.textContent.replace(/ /g, ' '));
        else if (n.classList?.contains('cmx-tag')) parts.push(n.dataset.t === 'group' ? { t: 'group', k: n.dataset.k } : { t: 'user', id: n.dataset.k, h: n.textContent.slice(1) });
        else if (n.nodeName === 'BR') parts.push('\n');
        else { if (n.nodeName === 'DIV' && parts.length) parts.push('\n'); walk(n); }
    });
    walk($('cmxEditor'));
    return parts.reduce((a, p) => { if (typeof p === 'string' && typeof a[a.length - 1] === 'string') a[a.length - 1] += p; else a.push(p); return a; }, []);
}

async function send() {
    const to = recipients();
    const parts = editorParts();
    const body = parts.map(p => typeof p === 'string' ? p : p.t === 'group' ? '@' + p.k : '@' + p.h).join('').trim();
    if (!to.length) return updateTo(`<span class="cmx-err">${_t('Tag at least one person or group with @ first.')}</span>`);
    if (!parts.filter(p => typeof p === 'string').join('').trim()) return updateTo(`<span class="cmx-err">${_t('Write the command after the tags.')}</span>`);
    const btn = $('cmxSend');
    btn.disabled = true;
    try {
        const u = me();
        const { data: cmd, error } = await db.from('ppms_commands').insert({
            sender_id: myId(), sender_name: u.name || u.full_name || u.email, sender_email: u.email,
            body: body.slice(0, 2000), parts, mentions: parts.filter(p => typeof p !== 'string').map(p => p.t === 'group' ? p.k : p.h),
            priority: $('cmxUrgentOpt').checked ? 'urgent' : 'normal', due_date: $('cmxDue').value || null, about: $('cmxAbout').value.trim() || null,
        }).select('*').single();
        if (error) throw error;
        const rows = to.map(r => ({ command_id: cmd.id, user_id: r.id, user_name: r.full_name || r.email, user_email: r.email }));
        const { error: e2 } = await db.from('ppms_command_recipients').insert(rows);
        if (e2) { await db.from('ppms_commands').delete().eq('id', cmd.id); throw e2; }
        S.cmds.set(cmd.id, { ...cmd, recipients: rows.map(r => ({ ...r, status: 'new' })), replies: [] });
        $('cmxEditor').innerHTML = ''; $('cmxUrgentOpt').checked = false; $('cmxDue').value = ''; $('cmxAbout').value = ''; $('cmxMore').hidden = true;
        if (S.filter === 'todo' || S.filter === 'tome') S.filter = 'all';
        render.scrollNext = true;
        render();
        updateTo(`<span class="cmx-ok">${_t('Sent to {n}.', { n: people(to.length) })}</span>`);
    } catch (e) {
        updateTo(`<span class="cmx-err">${_t('Not sent: {m}', { m: esc(e.message) })}</span>`);
    } finally { btn.disabled = false; }
}

/* ── Wiring ───────────────────────────────────────────────────── */
function wireDom() {
    $('cmxLauncher').addEventListener('click', () => openPanel(!S.open));
    $('cmxClose').addEventListener('click', () => openPanel(false));
    $('cmxHelpBtn').addEventListener('click', () => { $('cmxHelp').hidden = !$('cmxHelp').hidden; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.open && !SG.open && $('cmxUrgent').hidden) openPanel(false); });
    $('cmxFilters').addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (b) { S.filter = b.dataset.filter; render.scrollNext = true; render(); } });
    $('cmxLog').addEventListener('click', async e => {
        const who = e.target.closest('[data-who]');
        if (who) { const el = $('cmxWho' + who.dataset.who); el.hidden = !el.hidden; return; }
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const id = Number(b.dataset.id);
        const msg = b.closest('.cmx-msg');
        if (b.dataset.act === 'ack' || b.dataset.act === 'done') return setStatus(id, b.dataset.act);
        if (b.dataset.act === 'withdraw') {
            if (!window.confirm(_t('Withdraw this command? It disappears for everyone it was sent to.'))) return;
            const { error } = await db.from('ppms_commands').delete().eq('id', id);
            if (error) return toast(_t('Could not withdraw: {m}', { m: error.message }), 'error');
            S.cmds.delete(id); render(); return;
        }
        if (b.dataset.act === 'reply') {
            const col = msg.querySelector('.cmx-col');
            if (col.querySelector('.cmx-reply-box')) return col.querySelector('.cmx-reply-box input').focus();
            col.insertAdjacentHTML('beforeend', `<div class="cmx-reply-box"><input type="text" maxlength="1000" placeholder="${_t('Write a reply…')}"><button type="button" class="cmx-send sm" data-act="send-reply" data-id="${id}" title="${_t('Send reply')}">${svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 2.2)}</button></div>`);
            const input = col.querySelector('.cmx-reply-box input');
            input.focus();
            input.addEventListener('keydown', ev => { if (ev.key === 'Enter') col.querySelector('[data-act="send-reply"]').click(); });
            return;
        }
        if (b.dataset.act === 'send-reply') {
            const text = msg.querySelector('.cmx-reply-box input').value.trim();
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
    const ed = $('cmxEditor');
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
    ed.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
    $('cmxSuggest').addEventListener('mousedown', e => { const s = e.target.closest('[data-i]'); if (s) { e.preventDefault(); pick(Number(s.dataset.i)); } });
    $('cmxSend').addEventListener('click', send);
    $('cmxMoreBtn').addEventListener('click', () => { $('cmxMore').hidden = !$('cmxMore').hidden; });
    // "@ Tag people": put an @ at the caret (with a space before it if needed) and open the list.
    $('cmxTagBtn').addEventListener('mousedown', e => e.preventDefault());
    $('cmxTagBtn').addEventListener('click', () => {
        const ed = $('cmxEditor');
        ed.focus();
        const sel = getSelection();
        if (!sel.rangeCount || !ed.contains(sel.anchorNode)) {
            const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
            sel.removeAllRanges(); sel.addRange(r);
        }
        const before = caretText()?.text || '';
        document.execCommand('insertText', false, (before && !/[\s ]$/.test(before) ? ' ' : '') + '@');
        updateSuggest();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.ready) refresh().then(showUrgent); });
}

async function loadAudience() {
    const { data, error } = await db.from('ppms_settings').select('value').eq('key', 'commands_audience').maybeSingle();
    S.audience = !error && ['off', 'admins', 'everyone'].includes(data?.value) ? data.value : 'admins';
}

/** Show or hide the whole feature for this user, after the audience changes. */
async function applyAudience() {
    const show = canSee();
    if (!show) {
        if (S.wired) { openPanel(false); $('cmx').hidden = true; $('cmxUrgent').hidden = true; }
        return;
    }
    if (!S.wired) {
        document.body.insertAdjacentHTML('beforeend', shellHtml());
        S.wired = true;
        S.ready = true;
        wireDom();
        updateTo();
        subscribe();
    }
    $('cmx').hidden = false;
    await refresh();
    showUrgent();
}

/** db is created by app.js after start-up; wait for it. */
function whenDbReady(cb, tries = 0) {
    if (typeof db !== 'undefined' && db && getCurrentUser()?.id) return cb();
    if (tries > 120) return;
    setTimeout(() => whenDbReady(cb, tries + 1), 500);
}

export function wireCommands() {
    whenDbReady(async () => {
        // The feature switches itself on only once migration 63 exists.
        const probe = await db.from('ppms_commands').select('id').limit(1);
        if (probe.error) { console.info('Commands not available yet:', probe.error.message); return; }
        await loadAudience();
        await applyAudience();
        // The admin panel can change the audience at any time — follow it live.
        db.channel('ppms-settings')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ppms_settings' }, async () => { await loadAudience(); await applyAudience(); })
            .subscribe();
    });
}

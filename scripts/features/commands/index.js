/* ================================================================
   ACTION ITEMS (code name: commands) — work instructions sent to people
   inside PPMS.

   • A half-round tab with an arrow sticks out of the right edge of the
     screen, half-way down. It FLASHES and shows a count whenever an item
     (or a reply to one of yours) arrives, until you open it. Clicking it
     slides in a full-height sidebar (left edge in Arabic / RTL).
   • The sidebar lists action items as cards, oldest at the top and newest at
     the bottom, grouped by day. Each card: who · when · to whom, the
     instruction, its details (urgent / due / about), then a footer with
     the status on the left and the actions on the right.
   • Anyone except Viewers can send. Recipients go in the "To" row as
     chips — press "@ Add" or type @ in the message:
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
    to: [],                 // composer recipients: {t:'group', k} | {t:'user', id}
    shownUrgent: new Set(),
    unseenReplies: 0,
    openReplies: new Set(), // cards whose replies are expanded
    openWho: new Set(),     // cards whose per-person status list is expanded
    channel: null,
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = (p, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON_CMD = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>';
const ICON = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    done: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
    reply: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
};
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
        <button type="button" class="cmx-launcher" id="cmxLauncher" aria-expanded="false" aria-controls="cmxPanel" aria-label="${_t('Action Items')}" title="${_t('Action Items')}">
            <span class="cmx-launcher-arrow">${svg('<path d="m15 18-6-6 6-6"/>', 2.6)}</span>
            <span class="cmx-launcher-icon">${svg(ICON_CMD, 2)}</span>
            <span class="cmx-badge" id="cmxBadge" hidden>0</span>
        </button>
        <section class="cmx-panel" id="cmxPanel" role="dialog" aria-label="${_t('Action Items')}" aria-hidden="true">
            <header class="cmx-head">
                <span class="cmx-head-icon">${svg(ICON_CMD, 1.9)}</span>
                <div class="cmx-head-text"><strong>${_t('Action Items')}</strong><span id="cmxSub"></span></div>
                <button type="button" class="cmx-icon-btn" id="cmxHelpBtn" title="${_t('How to use Action Items')}">?</button>
                <button type="button" class="cmx-icon-btn" id="cmxClose" title="${_t('Close')}">${svg(ICON.x, 2)}</button>
            </header>
            <nav class="cmx-tabs" id="cmxTabs" role="tablist"></nav>
            <div class="cmx-pilot" id="cmxPilot" hidden>${_t('<b>Pilot:</b> only Master Admins can open Action Items for now. You can still send to anyone — they see it once you switch it on for everyone in the admin panel.')}</div>
            <div class="cmx-help" id="cmxHelp" hidden>${helpHtml()}</div>
            <div class="cmx-log" id="cmxLog" aria-live="polite"></div>
            <div class="cmx-composer" id="cmxComposer" hidden>
                <div class="cmx-suggest" id="cmxSuggest">
                    <input type="text" class="cmx-sg-search" id="cmxSgSearch" placeholder="${_t('Search people or groups…')}" autocomplete="off">
                    <div id="cmxSgList"></div>
                </div>
                <div class="cmx-torow">
                    <span class="cmx-label">${_t('To')}</span>
                    <div class="cmx-chips" id="cmxChips"></div>
                    <button type="button" class="cmx-add" id="cmxAdd">@ ${_t('Add')}</button>
                </div>
                <div class="cmx-to-note" id="cmxToNote"></div>
                <textarea id="cmxText" rows="2" maxlength="2000" placeholder="${_t('Write the action item… (type @ to add people)')}"></textarea>
                <div class="cmx-toolbar">
                    <label class="cmx-tool cmx-tool-urgent" title="${_t('Pops up on their screen until they acknowledge')}"><input type="checkbox" id="cmxUrgentOpt">${svg(ICON.alert, 2)}<span>${_t('Urgent')}</span></label>
                    <label class="cmx-tool" title="${_t('Due date')}">${svg(ICON.cal, 2)}<input type="date" id="cmxDue" aria-label="${_t('Due date')}"></label>
                    <label class="cmx-tool cmx-tool-about" title="${_t('What it is about')}">${svg(ICON.tag, 2)}<input type="text" id="cmxAbout" maxlength="200" placeholder="${_t('About (optional)')}"></label>
                    <button type="button" class="cmx-sendbtn" id="cmxSend" title="${_t('Send (Ctrl+Enter)')}">${svg(ICON.send, 2)}<span>${_t('Send')}</span></button>
                </div>
            </div>
        </section>
    </div>
    <div class="cmx-urgent" id="cmxUrgent" hidden><div class="cmx-urgent-card" id="cmxUrgentCard" role="alertdialog" aria-modal="true"></div></div>`;
}

function helpHtml() {
    return `
        <h3>${_t('How to use Action Items')}</h3>
        <ol>
            <li>${_t('The tab on the <b>right edge</b> of the screen <b>flashes</b> when an action item or a reply arrives for you. Click it to open this sidebar; click it again, press Esc or click the page to close.')}</li>
            <li>${_t('On each action item: <b>Acknowledge</b> = “I will do it”, <b>Done</b> = finished, <b>Reply</b> = answer or ask.')}</li>
            <li>${_t('<b>Urgent</b> action items appear in the middle of the screen until you acknowledge them.')}</li>
            <li>${_t('To send (everyone except Viewers): press <b>@ Add</b> in the <b>To</b> row (or type <b>@</b> in the message) and choose:')}
                <br><code>@all</code> ${_t('everyone')} · <code>@planners</code> <code>@operators</code> <code>@viewers</code> <code>@admins</code> ${_t('a whole role')} · <code>@name.surname</code> ${_t('one person')}</li>
            <li>${_t('Write the instruction. Optionally tick <b>Urgent</b>, pick a due date and say what it is about. Then <b>Send</b> (or Ctrl+Enter).')}</li>
            <li>${_t('Your action items show a progress bar. Click it to see who has not opened, acknowledged or finished them.')}</li>
        </ol>
        <p class="cmx-muted">${_t('Do not put passwords or confidential information in action items.')}</p>`;
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
const tagLabel = p => p.t === 'group' ? '@' + p.k : '@' + (userById(p.id)?.handle || p.h);
/** "To" tags and the text, from the stored parts (older commands kept tags inside the text). */
function splitParts(c) {
    const parts = Array.isArray(c.parts) && c.parts.length ? c.parts : [c.body];
    const tags = parts.filter(p => typeof p !== 'string');
    const text = parts.filter(p => typeof p === 'string').join('').replace(/\s+/g, ' ').trim();
    return { tags, text };
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
    const n = counts().unread + S.unseenReplies;
    $('cmxBadge').hidden = !n;
    $('cmxBadge').textContent = n > 99 ? '99+' : n;
    $('cmxLauncher').classList.toggle('is-flashing', n > 0 && !S.open);
    $('cmxLauncher').title = n ? _t('Action Items — {n} new', { n }) : _t('Action Items');
}

function render() {
    if (!S.ready) return;
    updateLauncher();
    if (!S.open) return;
    const { unread, todo } = counts();
    $('cmxSub').textContent = [unread ? _t('{n} new', { n: unread }) : '', todo ? _t('{n} to do', { n: todo }) : _t('nothing to do')].filter(Boolean).join(' · ');
    $('cmxPilot').hidden = !isPilot();
    $('cmxComposer').hidden = !canSend();
    $('cmxTabs').innerHTML = FILTERS.filter(([k]) => k !== 'sent' || canSend()).map(([k, l, f]) => {
        const n = [...S.cmds.values()].filter(f).length;
        return `<button type="button" role="tab" data-filter="${k}" class="${S.filter === k ? 'on' : ''}" aria-selected="${S.filter === k}">${_t(l)}${n ? `<span class="cmx-tab-n ${k === 'todo' ? 'is-todo' : ''}">${n}</span>` : ''}</button>`;
    }).join('');
    const test = FILTERS.find(f => f[0] === S.filter)[2];
    const list = [...S.cmds.values()].filter(test).sort((a, b) => a.id - b.id);   // oldest first, newest at the bottom
    const log = $('cmxLog');
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    let html = '', lastDay = '';
    for (const c of list) {
        const d = dayLabel(c.created_at);
        if (d !== lastDay) { html += `<div class="cmx-day"><span>${esc(d)}</span></div>`; lastDay = d; }
        html += cardHtml(c);
    }
    log.innerHTML = list.length ? html : emptyHtml();
    if (nearBottom || render.scrollNext) { log.scrollTop = log.scrollHeight; render.scrollNext = false; }
}

function emptyHtml() {
    if (S.filter === 'todo') return `<div class="cmx-empty">${svg(ICON.check, 1.6)}<p><b>${_t('All caught up')}</b><br>${_t('Nothing left to do.')}</p></div>`;
    if (S.filter === 'sent') return `<div class="cmx-empty">${svg(ICON.send, 1.6)}<p><b>${_t('Nothing sent yet')}</b><br>${_t('Your action items will appear here.')}</p></div>`;
    return `<div class="cmx-empty">${svg(ICON_CMD, 1.4)}<p><b>${_t('No action items yet')}</b></p>${canSend() ? `<ol class="cmx-steps">
        <li>${_t('Press <b>@ Add</b> and choose who must act')}</li><li>${_t('Write what needs doing')}</li><li>${_t('Press <b>Send</b>')}</li></ol>` : `<p>${_t('Action items sent to you will appear here.')}</p>`}</div>`;
}

function cardHtml(c) {
    const mine = isMine(c);
    const row = myRow(c);
    const { tags, text } = splitParts(c);
    const n = c.recipients.length;
    const tally = { new: 0, seen: 0, ack: 0, done: 0 };
    c.recipients.forEach(r => { tally[r.status]++; });
    const overdue = c.due_date && c.due_date < today() && (mine ? tally.done < n : row?.status !== 'done');
    const toLine = tags.length ? tags.map(p => `<span class="cmx-tag ${p.t === 'group' ? 'cmx-tag-group' : ''}">${esc(tagLabel(p))}</span>`).join(' ') : esc(people(n));

    const details = [
        c.due_date ? `<span class="cmx-detail ${overdue ? 'is-overdue' : ''}">${svg(ICON.cal, 2)}${overdue ? _t('Overdue · {d}', { d: fmtDue(c.due_date) }) : _t('Due {d}', { d: fmtDue(c.due_date) })}</span>` : '',
        c.about ? `<span class="cmx-detail">${svg(ICON.tag, 2)}${esc(c.about)}</span>` : '',
    ].filter(Boolean).join('');

    // Footer, left: status. Sender → progress; recipient → my state.
    let status;
    if (mine) {
        const pct = n ? Math.round(tally.done / n * 100) : 0;
        status = `<button type="button" class="cmx-progress ${S.openWho.has(c.id) ? 'open' : ''}" data-who="${c.id}" title="${_t('Show each person')}">
            <span class="cmx-bar"><span style="width:${pct}%"></span></span>
            <span class="cmx-progress-txt">${tally.done === n ? `<b class="ok">✓ ${_t('All done')}</b>` : _t('{a} of {n} done', { a: tally.done, n })}${tally.new ? ` · <span class="cmx-warn">${_t('{n} not opened', { n: tally.new })}</span>` : ''}</span>
            ${svg(ICON.chev, 2)}</button>`;
    } else if (row) {
        status = `<span class="cmx-pill st-${row.status}">${_t(row.status === 'new' || row.status === 'seen' ? 'Waiting for you' : STATUS_LABEL[row.status])}</span>`;
    } else status = '';

    // Footer, right: actions.
    const actions = [];
    if (row && row.status !== 'done') {
        if (row.status !== 'ack') actions.push(`<button type="button" class="cmx-act" data-act="ack" data-id="${c.id}">${svg(ICON.check, 2.2)}${_t('Acknowledge')}</button>`);
        actions.push(`<button type="button" class="cmx-act cmx-act-done" data-act="done" data-id="${c.id}">${svg(ICON.done, 2.2)}${_t('Done')}</button>`);
    }
    if (row?.status === 'done') actions.push(`<button type="button" class="cmx-act cmx-act-quiet" data-act="ack" data-id="${c.id}" title="${_t('Marked done by mistake')}">${_t('Undo')}</button>`);
    actions.push(`<button type="button" class="cmx-act cmx-act-quiet" data-act="reply" data-id="${c.id}" title="${_t('Reply')}">${svg(ICON.reply, 2)}${_t('Reply')}</button>`);
    if (mine) actions.push(`<button type="button" class="cmx-act cmx-act-icon cmx-act-danger" data-act="withdraw" data-id="${c.id}" title="${_t('Withdraw — delete for everyone')}" aria-label="${_t('Withdraw')}">${svg(ICON.trash, 2)}</button>`);

    const repliesOpen = S.openReplies.has(c.id);
    const replies = c.replies.length ? `
        <button type="button" class="cmx-replies-toggle" data-replies="${c.id}">${svg(ICON.reply, 2)}${c.replies.length === 1 ? _t('1 reply') : _t('{n} replies', { n: c.replies.length })}${svg(ICON.chev, 2)}</button>
        <div class="cmx-replies" ${repliesOpen ? '' : 'hidden'}>${c.replies.map(r => `<div class="cmx-reply">${avatar(r.user_id, r.user_name, 'xs')}<div><div><b>${esc(String(r.user_id) === myId() ? _t('You') : r.user_name)}</b> <span class="cmx-muted">${ago(r.created_at)}</span></div><div>${esc(r.body)}</div></div></div>`).join('')}</div>` : '';

    return `<article class="cmx-card ${mine ? 'is-mine' : ''} ${row?.status === 'new' ? 'is-new' : ''} ${c.priority === 'urgent' ? 'is-urgent' : ''}" data-id="${c.id}">
        <header class="cmx-card-head">
            ${avatar(c.sender_id, c.sender_name)}
            <div class="cmx-card-who">
                <div><b>${mine ? _t('You') : esc(c.sender_name || c.sender_email)}</b><span class="cmx-muted"> · ${fmtTime(c.created_at)}</span></div>
                <div class="cmx-card-to"><span class="cmx-muted">${_t('to')}</span> ${toLine}</div>
            </div>
            ${c.priority === 'urgent' ? `<span class="cmx-urgent-badge">${svg(ICON.alert, 2.2)}${_t('Urgent')}</span>` : ''}
        </header>
        <div class="cmx-card-text">${esc(text)}</div>
        ${details ? `<div class="cmx-details">${details}</div>` : ''}
        ${replies}
        <footer class="cmx-card-foot"><div class="cmx-foot-left">${status}</div><div class="cmx-foot-right">${actions.join('')}</div></footer>
        ${mine ? `<div class="cmx-who" id="cmxWho${c.id}" ${S.openWho.has(c.id) ? '' : 'hidden'}>${[...c.recipients].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)).map(r =>
            `<div class="cmx-who-row">${avatar(r.user_id, r.user_name, 'xs')}<span>${esc(String(r.user_id) === myId() ? _t('You') : (r.user_name || r.user_email))}</span><em class="st-${r.status}">${_t(STATUS_LABEL[r.status])}</em></div>`).join('')}</div>` : ''}
    </article>`;
}

/* ── Open / close, arrivals ──────────────────────────────────── */
function openPanel(open = true) {
    S.open = open;
    $('cmxPanel').classList.toggle('open', open);
    $('cmxPanel').setAttribute('aria-hidden', String(!open));
    $('cmx').classList.toggle('is-open', open);
    $('cmxLauncher').classList.toggle('is-open', open);
    $('cmxLauncher').title = open ? _t('Close') : _t('Action Items');
    $('cmxLauncher').setAttribute('aria-expanded', String(open));
    if (open) {
        S.unseenReplies = 0;
        render.scrollNext = true;
        render();
        setTimeout(markSeen, 1200);
    } else { closeSuggest(); updateLauncher(); }
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
    const { text } = splitParts(c);
    $('cmxUrgentCard').innerHTML = `
        <div class="cmx-urgent-top">${svg(ICON.alert, 2)}<h3>${_t('Urgent action item')}</h3></div>
        <p class="cmx-muted">${_t('From {name}', { name: esc(c.sender_name) })} · ${ago(c.created_at)}${c.due_date ? ' · ' + _t('Due {d}', { d: fmtDue(c.due_date) }) : ''}</p>
        <div class="cmx-card-text">${esc(text)}</div>
        ${c.about ? `<div class="cmx-details"><span class="cmx-detail">${svg(ICON.tag, 2)}${esc(c.about)}</span></div>` : ''}
        <div class="cmx-urgent-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="cmxUrgentOpen">${_t('Open Action Items')}</button>
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
    else if (!isMine(c)) toast(_t('New action item from {name}: {text}', { name: c.sender_name, text: splitParts(c).text.slice(0, 80) }), 'info');
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
            S.openReplies.add(c.id);
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

/* ── Composer: "To" chips + message ──────────────────────────── */
let SG = { open: false, items: [], idx: 0, via: 'add', at: null };
const groupMembers = g => S.users.filter(u => String(u.id) !== myId() && (!g.roles || g.roles.includes(u.role)));
const sameTag = (a, b) => a.t === b.t && (a.t === 'group' ? a.k === b.k : String(a.id) === String(b.id));

function suggestItems(q) {
    q = q.toLowerCase();
    const groups = GROUPS.filter(g => g.key.startsWith(q) || _t(g.label).toLowerCase().includes(q)).filter(g => g.key === 'all' || groupMembers(g).length)
        .map(g => ({ t: 'group', k: g.key, g }));
    // You can add yourself (a reminder, or to try it out); groups never include you.
    const ppl = S.users.filter(u => u.handle.includes(q) || String(u.full_name || '').toLowerCase().includes(q))
        .sort((a, b) => (String(a.id) === myId()) - (String(b.id) === myId())).slice(0, 30)
        .map(u => ({ t: 'user', id: u.id, u }));
    return [...groups, ...ppl].filter(it => !S.to.some(x => sameTag(x, it)));
}
function openSuggest(via, query = '') {
    SG = { ...SG, open: true, via, idx: 0 };
    $('cmxSuggest').classList.add('open');
    $('cmxSgSearch').hidden = via !== 'add';
    if (via === 'add') { $('cmxSgSearch').value = ''; setTimeout(() => $('cmxSgSearch').focus(), 0); }
    drawSuggest(query);
}
function drawSuggest(query) {
    SG.items = suggestItems(query);
    if (SG.idx >= SG.items.length) SG.idx = 0;
    let html = '', last = '';
    SG.items.forEach((it, i) => {
        if (it.t !== last) { html += `<div class="cmx-sg-head">${it.t === 'group' ? _t('Groups') : _t('People')}</div>`; last = it.t; }
        html += it.t === 'group'
            ? `<div class="cmx-sg ${i === SG.idx ? 'on' : ''}" data-i="${i}"><span class="cmx-av cmx-av-group">@</span><div><div>@${it.k}</div><div class="cmx-muted">${_t(it.g.label)} · ${people(groupMembers(it.g).length)}</div></div></div>`
            : `<div class="cmx-sg ${i === SG.idx ? 'on' : ''}" data-i="${i}">${avatar(it.u.id, it.u.full_name)}<div><div>${esc(it.u.full_name || it.u.email)}${String(it.u.id) === myId() ? ` <span class="cmx-muted">(${_t('you')})</span>` : ''}</div><div class="cmx-muted cmx-mono">@${esc(it.u.handle)}</div></div><span class="cmx-sg-role">${_t(ROLE_LABEL[it.u.role] || it.u.role)}</span></div>`;
    });
    $('cmxSgList').innerHTML = html || `<div class="cmx-sg-empty">${_t('No match')}</div>`;
    $('cmxSgList').querySelector('.cmx-sg.on')?.scrollIntoView({ block: 'nearest' });
}
function closeSuggest() { SG.open = false; $('cmxSuggest')?.classList.remove('open'); }
function suggestKey(e) {
    if (!SG.open) return false;
    if (e.key === 'ArrowDown') { SG.idx = (SG.idx + 1) % Math.max(SG.items.length, 1); drawSuggest(currentQuery()); }
    else if (e.key === 'ArrowUp') { SG.idx = (SG.idx - 1 + SG.items.length) % Math.max(SG.items.length, 1); drawSuggest(currentQuery()); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && SG.items.length) pick(SG.idx);
    else if (e.key === 'Escape') { closeSuggest(); if (SG.via === 'add') $('cmxText').focus(); }
    else return false;
    e.preventDefault();
    return true;
}
/** The text after the @ the caret is in (when the list was opened by typing @). */
function atToken() {
    const ta = $('cmxText');
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/(^|\s)@([\w.\-]*)$/);
    return m ? { start: before.length - m[2].length - 1, end: ta.selectionStart, q: m[2] } : null;
}
const currentQuery = () => SG.via === 'add' ? $('cmxSgSearch').value : (atToken()?.q || '');
function pick(i) {
    const it = SG.items[i];
    if (!it) return;
    S.to.push(it.t === 'group' ? { t: 'group', k: it.k } : { t: 'user', id: it.id, h: it.u.handle });
    if (SG.via === 'at') {
        const tok = atToken();
        const ta = $('cmxText');
        if (tok) { ta.value = ta.value.slice(0, tok.start) + ta.value.slice(tok.end).replace(/^\s/, ''); ta.setSelectionRange(tok.start, tok.start); }
        ta.focus();
    } else $('cmxText').focus();
    closeSuggest();
    drawChips();
}
function drawChips() {
    $('cmxChips').innerHTML = S.to.map((p, i) => {
        const label = p.t === 'group' ? '@' + p.k : (String(p.id) === myId() ? _t('You') : (userById(p.id)?.full_name || p.h));
        return `<span class="cmx-chip ${p.t === 'group' ? 'is-group' : ''}" title="${esc(tagLabel(p))}">${esc(label)}<button type="button" data-rm="${i}" aria-label="${_t('Remove')}">${svg(ICON.x, 2.4)}</button></span>`;
    }).join('') || `<span class="cmx-chips-ph">${_t('Nobody yet')}</span>`;
    updateNote();
}
function recipients() {
    const set = new Map();
    S.to.forEach(p => {
        if (p.t === 'user') { const u = userById(p.id); if (u) set.set(u.id, u); }
        else groupMembers(GROUPS.find(g => g.key === p.k)).forEach(u => set.set(u.id, u));
    });
    return [...set.values()];
}
function updateNote(msg) {
    const el = $('cmxToNote');
    if (msg) { el.innerHTML = msg; return; }
    const r = recipients();
    const waiting = r.filter(u => !canOpen(u)).length;
    el.innerHTML = r.length
        ? `${people(r.length)}${waiting ? ` · <span class="cmx-warn">${_t('{n} will see it when Action Items is switched on for everyone', { n: waiting })}</span>` : ''}`
        : '';
}

async function send() {
    const to = recipients();
    const text = $('cmxText').value.trim();
    if (!to.length) { updateNote(`<span class="cmx-err">${_t('Add at least one person or group in the To row.')}</span>`); return openSuggest('add'); }
    if (!text) { updateNote(`<span class="cmx-err">${_t('Write the action item first.')}</span>`); return $('cmxText').focus(); }
    const parts = [...S.to, ' ' + text];
    const body = S.to.map(tagLabel).join(' ') + ' ' + text;
    const btn = $('cmxSend');
    btn.disabled = true;
    try {
        const u = me();
        const { data: cmd, error } = await db.from('ppms_commands').insert({
            sender_id: myId(), sender_name: u.name || u.full_name || u.email, sender_email: u.email,
            body: body.slice(0, 2000), parts, mentions: S.to.map(p => tagLabel(p).slice(1)),
            priority: $('cmxUrgentOpt').checked ? 'urgent' : 'normal', due_date: $('cmxDue').value || null, about: $('cmxAbout').value.trim() || null,
        }).select('*').single();
        if (error) throw error;
        const rows = to.map(r => ({ command_id: cmd.id, user_id: r.id, user_name: r.full_name || r.email, user_email: r.email }));
        const { error: e2 } = await db.from('ppms_command_recipients').insert(rows);
        if (e2) { await db.from('ppms_commands').delete().eq('id', cmd.id); throw e2; }
        S.cmds.set(cmd.id, { ...cmd, recipients: rows.map(r => ({ ...r, status: 'new' })), replies: [] });
        S.to = []; $('cmxText').value = ''; $('cmxUrgentOpt').checked = false; $('cmxDue').value = ''; $('cmxAbout').value = '';
        drawChips();
        if (S.filter === 'todo') S.filter = 'all';
        render.scrollNext = true;
        render();
        updateNote(`<span class="cmx-ok">✓ ${_t('Sent to {n}.', { n: people(to.length) })}</span>`);
    } catch (e) {
        updateNote(`<span class="cmx-err">${_t('Not sent: {m}', { m: esc(e.message) })}</span>`);
    } finally { btn.disabled = false; }
}

/* ── Wiring ───────────────────────────────────────────────────── */
function wireDom() {
    $('cmxLauncher').addEventListener('click', () => openPanel(!S.open));
    // A click on the page (outside the sidebar, its tab and the urgent pop-up) closes the sidebar.
    document.addEventListener('mousedown', e => {
        if (S.open && !e.target.closest('#cmxPanel, #cmxLauncher, #cmxUrgent, .toast, .toast-container')) openPanel(false);
    });
    $('cmxClose').addEventListener('click', () => openPanel(false));
    $('cmxHelpBtn').addEventListener('click', () => { $('cmxHelp').hidden = !$('cmxHelp').hidden; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.open && !SG.open && $('cmxUrgent').hidden) openPanel(false); });
    document.addEventListener('mousedown', e => { if (SG.open && !e.target.closest('#cmxSuggest, #cmxAdd, #cmxText')) closeSuggest(); });
    $('cmxTabs').addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (b) { S.filter = b.dataset.filter; render.scrollNext = true; render(); } });
    $('cmxLog').addEventListener('click', async e => {
        const who = e.target.closest('[data-who]');
        if (who) { const id = Number(who.dataset.who); S.openWho.has(id) ? S.openWho.delete(id) : S.openWho.add(id); render(); return; }
        const rt = e.target.closest('[data-replies]');
        if (rt) { const id = Number(rt.dataset.replies); S.openReplies.has(id) ? S.openReplies.delete(id) : S.openReplies.add(id); render(); return; }
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const id = Number(b.dataset.id);
        const card = b.closest('.cmx-card');
        if (b.dataset.act === 'ack' || b.dataset.act === 'done') return setStatus(id, b.dataset.act);
        if (b.dataset.act === 'withdraw') {
            if (!window.confirm(_t('Withdraw this action item? It disappears for everyone it was sent to.'))) return;
            const { error } = await db.from('ppms_commands').delete().eq('id', id);
            if (error) return toast(_t('Could not withdraw: {m}', { m: error.message }), 'error');
            S.cmds.delete(id); render(); return;
        }
        if (b.dataset.act === 'reply') {
            if (card.querySelector('.cmx-reply-box')) return card.querySelector('.cmx-reply-box input').focus();
            card.querySelector('.cmx-card-foot').insertAdjacentHTML('beforebegin', `<div class="cmx-reply-box"><input type="text" maxlength="1000" placeholder="${_t('Write a reply…')}"><button type="button" class="cmx-sendbtn sm" data-act="send-reply" data-id="${id}" title="${_t('Send reply')}">${svg(ICON.send, 2)}</button></div>`);
            const input = card.querySelector('.cmx-reply-box input');
            input.focus();
            input.addEventListener('keydown', ev => { if (ev.key === 'Enter') card.querySelector('[data-act="send-reply"]').click(); if (ev.key === 'Escape') { ev.stopPropagation(); card.querySelector('.cmx-reply-box').remove(); } });
            return;
        }
        if (b.dataset.act === 'send-reply') {
            const text = card.querySelector('.cmx-reply-box input').value.trim();
            if (!text) return;
            b.disabled = true;
            const { data, error } = await db.from('ppms_command_replies')
                .insert({ command_id: id, user_id: myId(), user_name: me().name || me().email, body: text }).select('*').single();
            if (error) { b.disabled = false; return toast(_t('Reply not sent: {m}', { m: error.message }), 'error'); }
            const c = S.cmds.get(id);
            if (!c.replies.some(r => r.id === data.id)) c.replies.push(data);
            S.openReplies.add(id);
            if (myRow(c)?.status === 'new') await setStatus(id, 'seen'); else render();
        }
    });

    // To row
    $('cmxAdd').addEventListener('click', () => (SG.open && SG.via === 'add' ? closeSuggest() : openSuggest('add')));
    $('cmxChips').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { S.to.splice(Number(b.dataset.rm), 1); drawChips(); } });
    $('cmxSgSearch').addEventListener('input', () => { SG.idx = 0; drawSuggest($('cmxSgSearch').value); });
    $('cmxSgSearch').addEventListener('keydown', suggestKey);
    $('cmxSgList').addEventListener('mousedown', e => { const s = e.target.closest('[data-i]'); if (s) { e.preventDefault(); pick(Number(s.dataset.i)); } });

    // Message: typing @ opens the same list
    const ta = $('cmxText');
    ta.addEventListener('input', () => {
        const tok = atToken();
        if (tok) { if (!SG.open || SG.via !== 'at') openSuggest('at', tok.q); else { SG.idx = 0; drawSuggest(tok.q); } }
        else if (SG.open && SG.via === 'at') closeSuggest();
        ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    });
    ta.addEventListener('keydown', e => {
        if (SG.via === 'at' && suggestKey(e)) return;
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { send(); e.preventDefault(); }
    });
    $('cmxSend').addEventListener('click', send);
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
        drawChips();
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

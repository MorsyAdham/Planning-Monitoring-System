/* ================================================================
   PPMS ASSISTANT — chat bubble (bottom left).

   Brain: window.PPMSAssistantBackend if one is registered (an AI
   service, added later), otherwise the built-in local brain. Both take
   { text, history, context } and return
     { text, actions?: [{action, label?}], run?: action, confirm?: {...} }
   • actions  → suggestion buttons the user can click
   • run      → a read-only / navigation action run immediately
   • confirm  → a change the user must approve first (Confirm / Cancel)
   Nothing that changes data is ever done without that confirmation, and
   data changes only open the app's own forms for the user to save.
   ================================================================ */
import { localBrain } from './local-brain.js';
import { actionLabel, runAction } from './actions.js';
import { getCurrentUser } from '../../core/guards.js';

const HISTORY_KEY = 'ppms_assistant_history';
const MODULE_LABELS = { kd1: 'KD1', kd2: 'F200-KD2', f100kd2: 'F100-KD2' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Tiny, safe formatter: **bold** and line breaks only (text is escaped first). */
const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

let history = [];          // [{ role: 'user'|'assistant', text, actions?, confirm? }]
let pendingConfirm = null;
let busy = false;

const SPARK = '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/><path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8L19 15z"/>';
const svg = (paths, sw = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

/** Welcome-screen suggestion cards: [icon paths, kind, text]. */
const IDEA_ICONS = {
    data: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    act: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    learn: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5"/>',
};
const IDEA_LABELS = { data: 'Ask about the plan', act: 'Do it for me', learn: 'How do I…' };

export function renderAssistant() {
    return `
    <div class="asst" id="asst">
        <section class="asst-panel" id="asstPanel" hidden role="dialog" aria-label="PPMS Assistant">
            <header class="asst-head">
                <span class="asst-avatar asst-avatar--lg" aria-hidden="true">${svg(SPARK)}<i class="asst-online"></i></span>
                <div class="asst-head-text">
                    <strong>PPMS Assistant</strong>
                    <span id="asstContext">Production Planning &amp; Monitoring System</span>
                </div>
                <button type="button" class="asst-icon-btn" id="asstClear" title="New conversation" aria-label="New conversation">${svg('<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>')}</button>
                <button type="button" class="asst-icon-btn" id="asstClose" title="Close" aria-label="Close assistant">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 2)}</button>
            </header>
            <div class="asst-log" id="asstLog" aria-live="polite"></div>
            <!-- A div, not a <form>: the page can have an open form higher up, and
                 browsers silently drop a nested <form> (which stripped these styles). -->
            <div class="asst-composer" id="asstForm">
                <div class="asst-composer-box">
                    <textarea id="asstText" rows="1" placeholder="Ask a question or tell me what to do…" aria-label="Message" autocomplete="off"></textarea>
                    <button type="button" class="asst-send" id="asstSend" aria-label="Send">${svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 2.2)}</button>
                </div>
                <p class="asst-hint">Enter to send · Shift + Enter for a new line · changes always need your confirmation</p>
            </div>
        </section>
        <button type="button" class="asst-launcher" id="asstBubble" aria-label="Open PPMS Assistant" aria-expanded="false">
            <span class="asst-launcher-icon">
                <span class="asst-launcher-open">${svg(SPARK, 1.9)}</span>
                <span class="asst-launcher-close">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 2.2)}</span>
            </span>
            <span class="asst-launcher-label">Ask PPMS</span>
        </button>
    </div>`;
}

function context() {
    const u = getCurrentUser();
    // No module runtime (e.g. before the app has loaded) → talk about PPMS in general
    const moduleId = window.PPMSModuleRuntime?.getActiveModule?.() || '';
    return {
        userName: (u?.name || u?.email || '').split(' ')[0],
        role: u?.role || 'viewer',
        moduleId,
        moduleLabel: MODULE_LABELS[moduleId] || 'production',
    };
}

function save() {
    try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-40))); } catch {}
}

function load() {
    try { history = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); } catch { history = []; }
}

function ideasFor(c) {
    return c.moduleId === 'f100kd2'
        ? [['data', 'How many tasks are overdue?'], ['act', 'Open the issues report'], ['learn', 'How do I record a completion date?'], ['act', 'Report an issue']]
        : [['data', 'How many tasks are overdue for BTL-01?'], ['data', 'Show K9 progress'], ['act', 'Open the issues report'], ['learn', 'How do I record an X-ray result?']];
}

const BOT_AVATAR = `<span class="asst-avatar" aria-hidden="true">${svg(SPARK)}</span>`;

function renderLog() {
    const log = document.getElementById('asstLog');
    if (!log) return;
    const c = context();
    if (!history.length) {
        log.innerHTML = `
            <div class="asst-welcome">
                <span class="asst-avatar asst-avatar--xl" aria-hidden="true">${svg(SPARK)}</span>
                <h4>Hi ${esc(c.userName || 'there')}, how can I help?</h4>
                <p>I know your live <strong>${esc(c.moduleLabel)}</strong> plan and every PPMS screen. I can answer questions, open screens and reports, and prepare changes for you to confirm.</p>
                <div class="asst-ideas">
                    ${ideasFor(c).map(([kind, text]) => `
                        <button type="button" class="asst-idea" data-asst-say="${esc(text)}">
                            <span class="asst-idea-icon asst-idea-icon--${kind}">${svg(IDEA_ICONS[kind])}</span>
                            <span class="asst-idea-text"><small>${IDEA_LABELS[kind]}</small>${esc(text)}</span>
                        </button>`).join('')}
                </div>
            </div>`;
    } else {
        log.innerHTML = history.map((m, i) => {
            if (m.role === 'user') return `<div class="asst-row asst-row--user"><div class="asst-msg asst-msg--user">${fmt(m.text)}</div></div>`;
            const acts = (m.actions || []).map(a =>
                `<button type="button" class="asst-action" data-asst-action="${esc(a.action)}">${esc(a.label || actionLabel(a.action))}${svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 2)}</button>`).join('');
            const confirm = m.confirm && pendingConfirm && i === history.length - 1
                ? `<div class="asst-confirm">
                       <div class="asst-confirm-head">${svg('<path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>')} Needs your confirmation</div>
                       <div class="asst-confirm-btns">
                           <button type="button" class="asst-confirm-yes" data-asst-confirm="yes">${esc(m.confirm.label || 'Confirm')}</button>
                           <button type="button" class="asst-confirm-no" data-asst-confirm="no">Cancel</button>
                       </div>
                   </div>`
                : '';
            return `<div class="asst-row asst-row--bot">${BOT_AVATAR}<div class="asst-msg asst-msg--bot">${fmt(m.text)}${acts ? `<div class="asst-actions">${acts}</div>` : ''}${confirm}</div></div>`;
        }).join('');
    }
    if (busy) log.insertAdjacentHTML('beforeend', `<div class="asst-row asst-row--bot">${BOT_AVATAR}<div class="asst-msg asst-msg--bot asst-typing"><span></span><span></span><span></span></div></div>`);
    log.scrollTop = log.scrollHeight;
}

async function think(text) {
    const backend = window.PPMSAssistantBackend;
    const payload = { text, history: history.slice(-12), context: context() };
    if (backend && typeof backend.ask === 'function') {
        try { return await backend.ask(payload); } catch (err) { console.warn('Assistant backend failed, using built-in:', err); }
    }
    return localBrain(payload);
}

async function send(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    pendingConfirm = null;
    history.push({ role: 'user', text });
    busy = true;
    renderLog();
    let reply;
    try { reply = await think(text); } catch (err) { reply = { text: 'Something went wrong: ' + (err?.message || err) }; }
    busy = false;

    let runResult = null;
    if (reply.run) runResult = await runAction(reply.run);
    const msg = {
        role: 'assistant',
        text: runResult && !runResult.ok ? runResult.message : reply.text,
        actions: reply.actions || [],
    };
    if (reply.confirm) { msg.confirm = reply.confirm; pendingConfirm = reply.confirm; }
    history.push(msg);
    save();
    renderLog();
}

async function doAction(action) {
    if (action.startsWith('help:')) {
        window.PPMSHelp?.open(action.slice(5));
        return;
    }
    const r = await runAction(action);
    if (!r.ok) {
        history.push({ role: 'assistant', text: r.message });
        save();
        renderLog();
    }
}

async function doConfirm(yes) {
    const c = pendingConfirm;
    pendingConfirm = null;
    if (!c) return;
    if (!yes) {
        history.push({ role: 'assistant', text: 'OK, cancelled — nothing was changed.' });
    } else if (c.kind === 'reportIssue') {
        const r = await runAction('open:reportIssue');
        if (r.ok && c.title) {
            // The form resets itself when it opens — fill the title right after
            setTimeout(() => {
                const t = document.getElementById('issueTitle');
                if (t && !t.value) { t.value = c.title; t.dispatchEvent(new Event('input', { bubbles: true })); }
                document.getElementById('issueCategory')?.focus();
            }, 150);
        }
        history.push({ role: 'assistant', text: r.ok ? 'The form is open — pick the category and priority, then press Save.' : r.message });
    } else if (c.kind === 'action') {
        const r = await runAction(c.action);
        history.push({ role: 'assistant', text: r.message });
    }
    save();
    renderLog();
}

function toggle(open) {
    const panel = document.getElementById('asstPanel');
    const bubble = document.getElementById('asstBubble');
    if (!panel || !bubble) return;
    const show = open ?? panel.hidden;
    panel.hidden = !show;
    bubble.classList.toggle('is-open', show);
    bubble.setAttribute('aria-expanded', String(show));
    if (show) {
        const c = context();
        const ctxEl = document.getElementById('asstContext');
        if (ctxEl) ctxEl.textContent = 'Production Planning & Monitoring System';
        renderLog();
        document.getElementById('asstText')?.focus();
    }
}

export function wireAssistant() {
    load();
    document.getElementById('asstBubble')?.addEventListener('click', () => toggle());
    document.getElementById('asstClose')?.addEventListener('click', () => toggle(false));
    document.getElementById('asstClear')?.addEventListener('click', () => {
        history = []; pendingConfirm = null; save(); renderLog();
    });

    const input = document.getElementById('asstText');
    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; };
    input?.addEventListener('input', grow);
    const submit = () => {
        const text = input.value;
        input.value = '';
        grow();
        send(text);
    };
    input?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
        if (e.key === 'Escape') toggle(false);
    });
    document.getElementById('asstSend')?.addEventListener('click', submit);

    document.getElementById('asst')?.addEventListener('click', e => {
        const say = e.target.closest('[data-asst-say]');
        if (say) { send(say.dataset.asstSay); return; }
        const act = e.target.closest('[data-asst-action]');
        if (act) { doAction(act.dataset.asstAction); return; }
        const conf = e.target.closest('[data-asst-confirm]');
        if (conf) doConfirm(conf.dataset.asstConfirm === 'yes');
    });

    window.PPMSAssistant = { open: () => toggle(true), close: () => toggle(false), ask: send };
}

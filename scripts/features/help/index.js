/* ================================================================
   HELP & USER MANUAL — full-screen reader opened from the ☰ menu.
   Renders MANUAL_SECTIONS (manual-content.js):
     • header band with search and the Word download
     • left: numbered chapters with their topics (scroll-spy highlight)
     • right: chapter cards on the start view, then each chapter with
       its topics as cards — screenshot (assets/help/<id>.jpg, hidden
       until captured), numbered steps, tips, and a "Show me" button
       that runs the topic's action through the shared action runner.
   ================================================================ */
import { MANUAL_GROUPS, MANUAL_SECTIONS, ROLE_LABELS } from './manual-content.js';
import { actionLabel, isActionAvailable, runAction } from '../assistant/actions.js';
import { getCurrentUser } from '../../core/guards.js';

const MODULE_LABELS = { all: 'All modules', kd1: 'KD1', kd2: 'F200-KD2', f100kd2: 'F100-KD2' };
const ROLE_RANK = { viewer: 0, operator: 1, planner: 2, master_admin: 3 };
const SECTION_MIN_RANK = { all: 0, operator: 1, planner: 2, master_admin: 3 };

/** One line icon per chapter (24×24, stroke). */
const GROUP_ICONS = {
    'Getting Started': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    'Dashboard': '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    'Schedule (Gantt)': '<path d="M4 6h9M8 12h10M6 18h7"/><path d="M3 3v18"/>',
    'Plan Table': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
    'Production Issues': '<path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
    'Reports & Exports': '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    'KD2 Planning': '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    'F100-KD2': '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    'Administration': '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>',
    'Personal Settings': '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (paths, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const groupNo = g => String(MANUAL_GROUPS.indexOf(g) + 1).padStart(2, '0');
const groupId = g => 'help-ch-' + g.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function renderHelp() {
    return `
    <div class="help-overlay" id="helpOverlay" hidden role="dialog" aria-modal="true" aria-labelledby="helpTitle">
        <div class="help-shell">
            <header class="help-top">
                <div class="help-brand">
                    <span class="help-brand-mark">${icon('<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5M8 7h7M8 11h5"/>')}</span>
                    <div>
                        <h2 class="help-title" id="helpTitle">PPMS User Manual</h2>
                        <p class="help-subtitle">Production Planning &amp; Monitoring System — how every screen works</p>
                    </div>
                </div>
                <div class="help-searchbox">
                    ${icon('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>')}
                    <input type="search" id="helpSearch" placeholder="Search the manual — e.g. x-ray, export, password" autocomplete="off" />
                </div>
                <div class="help-top-actions">
                    <label class="help-mine" title="Hide topics your role cannot use"><input type="checkbox" id="helpOnlyMine" /> <span>My role only</span></label>
                    <a class="help-download" href="assets/help/PPMS_User_Manual.docx" download title="Download the manual as a Word document">
                        ${icon('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>')}<span>Word</span>
                    </a>
                    <button class="help-close" id="helpClose" aria-label="Close help">${icon('<path d="M6 6l12 12M18 6L6 18"/>')}</button>
                </div>
            </header>
            <div class="help-body">
                <nav class="help-toc" id="helpToc" aria-label="Manual contents"></nav>
                <main class="help-content" id="helpContent" tabindex="-1"></main>
            </div>
        </div>
    </div>`;
}

function userRank() {
    const r = getCurrentUser()?.role;
    return ROLE_RANK[r === 'admin' ? 'operator' : r] ?? 0;
}

function sectionHtml(s) {
    const canUse = userRank() >= (SECTION_MIN_RANK[s.roles] ?? 0);
    const action = s.action && isActionAvailable(s.action)
        ? `<button type="button" class="help-try" data-help-action="${esc(s.action)}">${esc(actionLabel(s.action))} ${icon('<path d="M5 12h14M13 6l6 6-6 6"/>')}</button>`
        : '';
    return `
    <article class="help-card" id="help-${esc(s.id)}" data-help-id="${esc(s.id)}">
        <header class="help-card-head">
            <h3 class="help-card-title">${esc(s.title)}</h3>
            <div class="help-card-meta">
                <span class="help-tag help-tag--role${canUse ? '' : ' is-locked'}" title="${canUse ? 'Available to you' : 'Not available for your role'}">
                    ${icon(canUse ? '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>' : '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>')}
                    ${esc(ROLE_LABELS[s.roles] || s.roles)}
                </span>
                <span class="help-tag">${esc(MODULE_LABELS[s.modules] || s.modules)}</span>
            </div>
        </header>
        <p class="help-summary">${esc(s.summary)}</p>
        <figure class="help-shot">
            <div class="help-shot-bar"><i></i><i></i><i></i></div>
            <img src="assets/help/${esc(s.id)}.jpg" alt="${esc(s.title)}" loading="lazy" onerror="this.closest('figure').remove()" />
        </figure>
        ${s.steps?.length ? `<ol class="help-steps">${s.steps.map(t => `<li><span>${esc(t)}</span></li>`).join('')}</ol>` : ''}
        ${s.tips?.length ? `<aside class="help-tips">${icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>')}<ul>${s.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></aside>` : ''}
        ${action ? `<footer class="help-card-foot">${action}</footer>` : ''}
    </article>`;
}

function matches(s, q) {
    if (!q) return true;
    const hay = [s.title, s.summary, s.group, ...(s.steps || []), ...(s.tips || []), ...(s.keywords || [])].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function visibleSections() {
    const q = document.getElementById('helpSearch')?.value.trim() || '';
    const onlyMine = !!document.getElementById('helpOnlyMine')?.checked;
    const rank = userRank();
    return { q, list: MANUAL_SECTIONS.filter(s => matches(s, q) && (!onlyMine || rank >= (SECTION_MIN_RANK[s.roles] ?? 0))) };
}

function render() {
    const { q, list } = visibleSections();
    const toc = document.getElementById('helpToc');
    const content = document.getElementById('helpContent');
    if (!toc || !content) return;

    const groups = MANUAL_GROUPS.map(g => ({ g, items: list.filter(s => s.group === g) })).filter(x => x.items.length);

    toc.innerHTML = groups.map(({ g, items }) => `
        <div class="help-toc-group">
            <a class="help-toc-head" href="#${groupId(g)}" data-help-jump="${groupId(g)}">
                <span class="help-toc-no">${groupNo(g)}</span>
                <span class="help-toc-name">${esc(g)}</span>
                <span class="help-toc-count">${items.length}</span>
            </a>
            <div class="help-toc-items">
                ${items.map(s => `<a href="#help-${esc(s.id)}" class="help-toc-link" data-help-jump="help-${esc(s.id)}">${esc(s.title)}</a>`).join('')}
            </div>
        </div>`).join('') || '<p class="help-empty">No matches.</p>';

    if (!list.length) {
        content.innerHTML = `
            <div class="help-noresult">
                ${icon('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8 11h6"/>')}
                <h3>Nothing matches "${esc(q)}"</h3>
                <p>Try other words, or ask the PPMS Assistant (the chat button at the bottom left).</p>
            </div>`;
        return;
    }

    // Start view (no search): chapter overview cards first
    const overview = q ? '' : `
        <section class="help-hero">
            <h3>Welcome to PPMS</h3>
            <p>Pick a chapter, search above, or ask the assistant at the bottom left. Topics marked with a lock are not available for your role.</p>
            <div class="help-chapters">
                ${groups.map(({ g, items }) => `
                    <button type="button" class="help-chapter" data-help-jump="${groupId(g)}">
                        <span class="help-chapter-icon">${icon(GROUP_ICONS[g] || '')}</span>
                        <span class="help-chapter-no">${groupNo(g)}</span>
                        <span class="help-chapter-name">${esc(g)}</span>
                        <span class="help-chapter-count">${items.length} topic${items.length === 1 ? '' : 's'}</span>
                    </button>`).join('')}
            </div>
        </section>`;

    content.innerHTML = overview + (q ? `<p class="help-resultline">${list.length} topic${list.length === 1 ? '' : 's'} match "<strong>${esc(q)}</strong>"</p>` : '')
        + groups.map(({ g, items }) => `
            <section class="help-chapter-block" id="${groupId(g)}">
                <h2 class="help-chapter-title">
                    <span class="help-chapter-title-icon">${icon(GROUP_ICONS[g] || '')}</span>
                    <span class="help-chapter-title-no">${groupNo(g)}</span>
                    ${esc(g)}
                </h2>
                ${items.map(sectionHtml).join('')}
            </section>`).join('');

    content.scrollTop = 0;
    spy();
}

/** Highlight the topic currently at the top of the reading pane. */
function spy() {
    const content = document.getElementById('helpContent');
    if (!content) return;
    const top = content.getBoundingClientRect().top + 90;
    let current = null;
    content.querySelectorAll('.help-card').forEach(c => { if (c.getBoundingClientRect().top <= top) current = c.id; });
    document.querySelectorAll('#helpToc .help-toc-link').forEach(a => {
        const on = a.dataset.helpJump === current;
        a.classList.toggle('is-active', on);
        if (on) a.closest('.help-toc-group')?.classList.add('is-open');
    });
}

function jump(targetId) {
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function open(sectionId) {
    const overlay = document.getElementById('helpOverlay');
    if (!overlay) return;
    overlay.hidden = false;
    document.body.classList.add('help-open');
    render();
    if (sectionId) requestAnimationFrame(() => document.getElementById(`help-${sectionId}`)?.scrollIntoView({ block: 'start' }));
    else document.getElementById('helpSearch')?.focus();
}

function close() {
    const overlay = document.getElementById('helpOverlay');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('help-open');
}

export function wireHelp() {
    window.PPMSHelp = { open, close };
    document.getElementById('btnHelpManual')?.addEventListener('click', () => open());
    document.getElementById('helpClose')?.addEventListener('click', close);
    let t = null;
    document.getElementById('helpSearch')?.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 120); });
    document.getElementById('helpOnlyMine')?.addEventListener('change', render);
    document.getElementById('helpContent')?.addEventListener('scroll', () => requestAnimationFrame(spy), { passive: true });
    document.getElementById('helpOverlay')?.addEventListener('click', e => {
        if (e.target.id === 'helpOverlay') { close(); return; }
        const j = e.target.closest('[data-help-jump]');
        if (j) { e.preventDefault(); jump(j.dataset.helpJump); return; }
        const tryBtn = e.target.closest('[data-help-action]');
        if (tryBtn) {
            close();
            runAction(tryBtn.dataset.helpAction).then(r => { if (!r.ok) window.showToast?.(r.message, 'error'); });
        }
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !document.getElementById('helpOverlay')?.hidden) close();
    });
}

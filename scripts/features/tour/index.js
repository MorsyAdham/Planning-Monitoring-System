/* ================================================================
   GUIDED TOUR — an interactive walk-through of the PPMS screen.
   Started from the ☰ menu (Guided tour), the Help page, the assistant
   (open:tour) or the one-time offer shown to a new user.

   Each step spotlights one part of the page (dimming the rest) and
   shows a card explaining it. Steps whose target doesn't exist or is
   hidden for this role/module are skipped automatically, so the tour
   always matches what the user can actually see. Nothing on the page
   is changed — the tour only scrolls and highlights.

   Keys: → / Enter next · ← back · Esc end.
   ================================================================ */

import { getCurrentUser } from '../../core/guards.js';

const OFFER_KEY = 'ppms_tour_offered_v1_';

const icon = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* target: selector or list of selectors (spotlight covers them all).
   No target = a centred card. `scroll` = where to bring it into view. */
const STEPS = [
    {
        title: 'Welcome to PPMS',
        text: 'This short tour shows you around the Production Planning & Monitoring System — where everything is and what it does. It takes about two minutes and changes nothing. Use <b>Next</b> or the → key.',
        icon: '<path d="M3 12h18M12 3l9 9-9 9"/>',
    },
    {
        target: '#sectionNav',
        title: 'Section links',
        text: 'Jump straight to any part of the page: <b>Summary</b>, <b>Schedule</b>, <b>Progress</b>, <b>Analytics</b>, <b>Plan Table</b> and <b>Issues</b>. The section you are in is underlined.',
    },
    {
        target: ['#moduleSelectorWrap', '#planVersionSelectorWrap'],
        title: 'Module and plan version',
        text: 'Choose the plan you are working on — the module (F200 – KD1, F200 – KD2 or F100 – KD2) and which version of its plan. <b>Everything on the page belongs to this plan.</b>',
    },
    {
        target: '#updateNoticeWrap',
        title: 'Your PPMS version',
        text: 'The version you are running. When a newer version is released this turns <b>orange and blinks</b> — click it and choose <b>Load latest version</b>.',
    },
    {
        target: '#f100NotifWrap',
        title: 'Notifications',
        text: 'New comments, issues and plan changes from your colleagues collect here. Click one to jump straight to it.',
    },
    {
        target: '#themePickerWrap',
        title: 'Colour theme',
        text: 'Pick the look you prefer — Dark, Light, Crimson Red and more. Your choice is remembered.',
    },
    {
        target: '#navMoreWrap',
        title: 'The menu',
        text: 'The <b>Help &amp; User Manual</b> and this <b>Guided tour</b> live here, together with the tools your role allows — Unit Codes, Manage Processes, Plan Versions, User Management and the Audit Log.',
    },
    {
        target: '#navUserChip',
        title: 'Your account',
        text: 'Your name and role. Click it to change your password or sign out. The green dot by the clock means you are connected and receiving live updates.',
    },
    {
        target: '#overviewSegment',
        scroll: 'start',
        title: 'Filters',
        text: 'Narrow the <b>whole page</b> at once — battalion, vehicle, unit, category, week, time frame or a search. Active filters appear as chips; click × on a chip to remove it, or <b>Reset</b> to clear them all.',
    },
    {
        target: '#summarySection',
        scroll: 'start',
        title: 'Executive Summary',
        text: 'Where production stands for the current filters: the % done, the split by status (on time, late, in progress, overdue, not started) and the key counts.',
    },
    {
        target: '.card-delivery',
        title: 'Delivery forecast',
        text: 'Planned vs <b>forecast</b> delivery and the delay in working days. The forecast follows each unit\'s process order from where it stands today. <b>Click the card</b> to see which units are furthest behind and where to act first.',
    },
    {
        target: '#btnExecReport',
        title: 'Executive Report',
        text: 'One print-friendly document for management — progress, delivery forecast, the station report and the issues status — as PDF, Excel or Word.',
    },
    {
        target: '#ganttSection',
        scroll: 'start',
        title: 'Production Schedule',
        text: 'The plan on a calendar. Hover any bar for its dates and status; scroll sideways through time. <b>TODAY</b> is marked and Saturdays are shaded.',
    },
    {
        target: '#ganttViewToggle',
        title: 'Unit or Process view',
        text: '<b>Process</b> shows one lane per station (who is at each station); <b>Unit</b> shows one lane per vehicle (each unit\'s route).',
    },
    {
        target: '#btnGanttEdit',
        roles: ['planner', 'master_admin'],
        title: 'Editing the plan',
        text: 'Planners press <b>Edit Gantt</b> to drag blocks, change dates, add work, reorder the route or hide processes. Everyone sees the changes live, and every change can be undone.',
    },
    {
        target: '#vpxSection',
        scroll: 'start',
        title: 'Vehicle Production Progress',
        text: 'Every unit station by station: planned against actual, coloured by status. Switch to <b>Station Report</b> for forecast dates and delays, and use <b>Generate Report</b> to export it.',
    },
    {
        target: ['#chartsSection', '#f100ChartsSection'],
        scroll: 'start',
        title: 'Manufacturing Analytics',
        text: 'Charts with a one-line insight each — progress over time, weekly throughput, unit ranking, forecast finish per unit, bottleneck stations and the issues trend. Expand any chart for detail.',
    },
    {
        target: '#tableSection',
        scroll: 'start',
        title: 'Plan Table',
        text: 'Every planned task as a row. This is where the shop floor <b>records actual start and completion dates</b>, comments and X-ray results. Rows load as you scroll.',
    },
    {
        target: '#issuesSection',
        scroll: 'start',
        title: 'Production Issues',
        text: 'Report production problems, follow them up to resolution, and generate issue reports. Critical and High issues still open are counted separately.',
    },
    {
        target: '#btnAddIssue',
        roles: ['operator', 'planner', 'master_admin', 'admin'],
        title: 'Report an issue',
        text: 'Press <b>Report Issue</b> whenever something blocks production. A title, a category and a short description are enough to start; your draft is saved as you type.',
    },
    {
        target: '#asstBubble',
        title: 'The PPMS Assistant',
        text: 'Ask anything — "how many tasks are overdue for BTL-01 K9?" or "how do I record an X-ray result?". It can also open screens and start reports for you.',
    },
    {
        title: 'You\'re all set',
        text: 'Open the <b>Help &amp; User Manual</b> from the menu (☰) for step-by-step guides, tips and recommendations — or download it as a Word document. You can restart this tour from the menu at any time.',
        icon: '<path d="M20 6L9 17l-5-5"/>',
        final: true,
    },
];

let state = null; // { steps, i, els }

function role() {
    const r = getCurrentUser()?.role || 'viewer';
    return r === 'admin' ? 'operator' : r;
}

function targetsOf(step) {
    const sels = step.target ? (Array.isArray(step.target) ? step.target : [step.target]) : [];
    return sels.map(s => document.querySelector(s)).filter(el => el && isShown(el));
}

function isShown(el) {
    if (!el.isConnected || el.hidden) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

function availableSteps() {
    const r = role();
    return STEPS.filter(step => {
        if (step.roles && !step.roles.includes(r)) return false;
        return !step.target || targetsOf(step).length > 0;
    });
}

function unionRect(els) {
    const rects = els.map(el => el.getBoundingClientRect());
    const left = Math.min(...rects.map(r => r.left)), top = Math.min(...rects.map(r => r.top));
    const right = Math.max(...rects.map(r => r.right)), bottom = Math.max(...rects.map(r => r.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function build() {
    const root = document.createElement('div');
    root.id = 'ppmsTour';
    root.className = 'tour-root';
    root.innerHTML = `
        <div class="tour-blocker"></div>
        <div class="tour-spot" aria-hidden="true"></div>
        <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle" tabindex="-1">
            <div class="tour-progress"><span></span></div>
            <div class="tour-head">
                <span class="tour-icon"></span>
                <div>
                    <span class="tour-count"></span>
                    <h3 class="tour-title" id="tourTitle"></h3>
                </div>
                <button type="button" class="tour-x" data-tour="end" aria-label="End tour">${icon('<path d="M6 6l12 12M18 6L6 18"/>')}</button>
            </div>
            <p class="tour-text"></p>
            <div class="tour-actions">
                <button type="button" class="tour-skip" data-tour="end">Skip tour</button>
                <span class="tour-spacer"></span>
                <button type="button" class="btn btn-ghost btn-sm" data-tour="back">${icon('<path d="M19 12H5M11 18l-6-6 6-6"/>')}<span>Back</span></button>
                <button type="button" class="btn btn-primary btn-sm" data-tour="next"><span>Next</span>${icon('<path d="M5 12h14M13 6l6 6-6 6"/>')}</button>
            </div>
        </div>`;
    root.addEventListener('click', e => {
        const b = e.target.closest('[data-tour]');
        if (!b) return;
        const a = b.dataset.tour;
        if (a === 'next') go(state.i + 1);
        else if (a === 'back') go(state.i - 1);
        else end();
    });
    document.body.appendChild(root);
    return root;
}

function place() {
    if (!state) return;
    const root = state.root;
    const step = state.steps[state.i];
    const spot = root.querySelector('.tour-spot');
    const card = root.querySelector('.tour-card');
    const vw = window.innerWidth, vh = window.innerHeight;
    const els = targetsOf(step);
    card.style.maxWidth = Math.min(380, vw - 24) + 'px';
    const cw = card.offsetWidth, ch = card.offsetHeight;

    if (!els.length) {
        root.classList.add('is-centred');
        spot.style.cssText = 'left:50%;top:50%;width:0;height:0';
        card.style.left = Math.round((vw - cw) / 2) + 'px';
        card.style.top = Math.round((vh - ch) / 2) + 'px';
        return;
    }
    root.classList.remove('is-centred');
    const pad = 6;
    const r = unionRect(els);
    // Spotlight clamped to the viewport (tall sections)
    const sl = Math.max(4, r.left - pad), st = Math.max(4, r.top - pad);
    const sr = Math.min(vw - 4, r.right + pad), sb = Math.min(vh - 4, r.bottom + pad);
    spot.style.cssText = `left:${sl}px;top:${st}px;width:${Math.max(0, sr - sl)}px;height:${Math.max(0, sb - st)}px`;

    // Card: below, above, then inside the bottom of a tall target
    const gap = 12;
    let top;
    if (sb + gap + ch <= vh - 8) top = sb + gap;
    else if (st - gap - ch >= 8) top = st - gap - ch;
    else top = vh - ch - 16;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - cw / 2), vw - cw - 8);
    if (r.width > vw * 0.6) left = Math.min(vw - cw - 16, Math.max(16, r.left + 24));
    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(Math.max(8, top)) + 'px';
}

function go(i) {
    if (!state) return;
    if (i < 0) return;
    if (i >= state.steps.length) { end(true); return; }
    state.i = i;
    const step = state.steps[i];
    const root = state.root;
    const card = root.querySelector('.tour-card');
    root.querySelector('.tour-count').textContent = `Step ${i + 1} of ${state.steps.length}`;
    root.querySelector('.tour-title').textContent = step.title;
    root.querySelector('.tour-text').innerHTML = step.text;
    root.querySelector('.tour-icon').innerHTML = icon(step.icon || '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>');
    root.querySelector('.tour-progress span').style.width = `${Math.round((i + 1) / state.steps.length * 100)}%`;
    root.querySelector('[data-tour="back"]').hidden = i === 0;
    const next = root.querySelector('[data-tour="next"] span');
    next.textContent = step.final ? 'Finish' : (i === 0 ? 'Start' : 'Next');
    root.querySelector('.tour-skip').hidden = !!step.final;

    const els = targetsOf(step);
    card.classList.remove('is-in');
    if (els.length) {
        const r = unionRect(els);
        const inView = r.top >= 70 && r.bottom <= window.innerHeight - 10;
        if (!inView) els[0].scrollIntoView({ behavior: 'smooth', block: step.scroll || 'center' });
        setTimeout(() => { place(); card.classList.add('is-in'); card.focus({ preventScroll: true }); }, inView ? 30 : 450);
    } else {
        place();
        requestAnimationFrame(() => { card.classList.add('is-in'); card.focus({ preventScroll: true }); });
    }
}

function onKey(e) {
    if (!state) return;
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !e.target.closest?.('button'))) { e.preventDefault(); go(state.i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(state.i - 1); }
}
let _placeQueued = false;
function onViewportChange() {
    if (!state || _placeQueued) return;
    _placeQueued = true;
    requestAnimationFrame(() => { _placeQueued = false; place(); });
}

export function startTour() {
    if (state) end();
    // Close anything that would sit on top of the tour
    window.PPMSHelp?.close?.();
    const menu = document.getElementById('navMoreDropdown');
    if (menu) menu.style.display = 'none';
    document.getElementById('ppmsTourOffer')?.remove();
    const steps = availableSteps();
    if (!steps.length) return;
    state = { steps, i: 0, root: build() };
    document.body.classList.add('tour-active');
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    markOffered();
    go(0);
}

function end(finished = false) {
    if (!state) return;
    state.root.remove();
    state = null;
    document.body.classList.remove('tour-active');
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange, true);
    if (finished) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function offerKey() {
    const u = getCurrentUser();
    return OFFER_KEY + (u?.email || u?.id || 'anon');
}
function markOffered() {
    try { localStorage.setItem(offerKey(), '1'); } catch {}
}

/* A new user is offered the tour once. */
function maybeOffer() {
    let seen = false;
    try { seen = !!localStorage.getItem(offerKey()); } catch { seen = true; }
    if (seen || state) return;
    const offer = document.createElement('div');
    offer.id = 'ppmsTourOffer';
    offer.className = 'tour-offer';
    offer.setAttribute('role', 'dialog');
    offer.innerHTML = `
        <span class="tour-offer-icon">${icon('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>')}</span>
        <div class="tour-offer-text"><strong>New to PPMS?</strong><span>Take a 2-minute guided tour of the screen.</span></div>
        <button type="button" class="btn btn-ghost btn-sm" data-offer="later">Not now</button>
        <button type="button" class="btn btn-primary btn-sm" data-offer="start">Start tour</button>`;
    offer.addEventListener('click', e => {
        const b = e.target.closest('[data-offer]');
        if (!b) return;
        markOffered();
        offer.remove();
        if (b.dataset.offer === 'start') startTour();
        else window.showToast?.('You can start the tour any time from the menu (☰) → Guided tour.', 'info');
    });
    document.body.appendChild(offer);
}

export function wireTour() {
    window.PPMSTour = { start: startTour, end };
    document.getElementById('btnTour')?.addEventListener('click', startTour);
    // Offer once, after the page has loaded its data
    setTimeout(maybeOffer, 6000);
}

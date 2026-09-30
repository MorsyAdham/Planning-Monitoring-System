/* ================================================================
   UPDATE NOTICE — tells users with PPMS already open that a newer
   version has been deployed, and loads it on request.

   tools/deploy.sh writes version.json next to index.html on every
   deploy: { version, deployedAt, notes, files[] }. This module reads it
   at start-up (the version this page is running), re-checks every few
   minutes and whenever the tab regains focus, and shows a pulsing
   "Update" pill next to the notification bell when it changes.

   "Reload now" re-downloads every file listed in the manifest with
   cache: 'reload' before reloading. GitHub Pages lets browsers keep
   files for ~10 minutes, so a plain reload right after a deploy could
   bring back the old scripts — this makes one click enough.

   Local development has no version.json, so the feature stays idle.
   ================================================================ */

const MANIFEST = 'version.json';
const CHECK_EVERY_MS = 5 * 60 * 1000;
const FOCUS_CHECK_GAP_MS = 60 * 1000;
const REPULSE_AFTER_MS = 30 * 60 * 1000;

let running = null;       // manifest of the version this page loaded with
let available = null;     // newer manifest, once seen
let lastCheck = 0;
let repulseTimer = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const REFRESH_ICON = icon('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>');

export function renderUpdateNotice() {
    return `
        <div class="update-notice-wrap" id="updateNoticeWrap" hidden>
            <button type="button" class="update-notice-btn" id="updateNoticeBtn" aria-haspopup="dialog" aria-expanded="false" title="A new version of PPMS is available">
                <span class="update-notice-dot" aria-hidden="true"></span>
                ${REFRESH_ICON}
                <span class="update-notice-label">Update</span>
            </button>
            <div class="update-notice-pop" id="updateNoticePop" role="dialog" aria-label="New version available" hidden>
                <div class="unp-head">
                    <span class="unp-badge">${REFRESH_ICON}</span>
                    <div>
                        <strong>New version available</strong>
                        <span class="unp-when" id="updateNoticeWhen"></span>
                    </div>
                </div>
                <p class="unp-notes" id="updateNoticeNotes"></p>
                <p class="unp-hint">You are using an older version. Reload to get the latest fixes and features.</p>
                <p class="unp-warn" id="updateNoticeWarn" hidden></p>
                <div class="unp-actions">
                    <button type="button" class="btn btn-ghost btn-sm" id="updateNoticeLater">Later</button>
                    <button type="button" class="btn btn-primary btn-sm" id="updateNoticeReload">${REFRESH_ICON}<span>Reload now</span></button>
                </div>
            </div>
        </div>`;
}

async function fetchManifest() {
    try {
        const res = await fetch(`${MANIFEST}?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return null;
        const m = await res.json();
        return m && m.version ? m : null;
    } catch {
        return null;
    }
}

async function check() {
    lastCheck = Date.now();
    const m = await fetchManifest();
    if (!m) return;
    if (!running) { running = m; return; }
    if (m.version === running.version || m.version === available?.version) return;
    available = m;
    show();
}

function fmtWhen(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return 'Released ' + d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function pulse() {
    const btn = document.getElementById('updateNoticeBtn');
    if (!btn) return;
    btn.classList.remove('is-pulsing');
    void btn.offsetWidth; // restart the animation
    btn.classList.add('is-pulsing');
}

function show() {
    const wrap = document.getElementById('updateNoticeWrap');
    if (!wrap || !available) return;
    wrap.hidden = false;
    const notes = document.getElementById('updateNoticeNotes');
    if (notes) {
        notes.textContent = available.notes ? `What's new: ${available.notes}` : '';
        notes.hidden = !available.notes;
    }
    const when = document.getElementById('updateNoticeWhen');
    if (when) when.textContent = fmtWhen(available.deployedAt);
    pulse();
    if (typeof window.showToast === 'function') {
        window.showToast('A new version of PPMS is available — click "Update" at the top to load it.', 'info');
    }
}

/** Plain-language list of work that a reload would throw away. */
function unsavedWork() {
    const items = [];
    try { if (typeof _ganttEditMode !== 'undefined' && _ganttEditMode) items.push('the Gantt is in edit mode'); } catch {}
    const openModal = [...document.querySelectorAll('.modal-overlay')]
        .some(el => !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
    if (openModal) items.push('a form or dialog is open');
    const typing = document.activeElement?.matches?.('input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]');
    if (typing && document.activeElement.value) items.push('you are typing in a field');
    return items;
}

function openPop() {
    const pop = document.getElementById('updateNoticePop');
    const btn = document.getElementById('updateNoticeBtn');
    if (!pop || !btn) return;
    const work = unsavedWork();
    const warn = document.getElementById('updateNoticeWarn');
    if (warn) {
        warn.hidden = !work.length;
        warn.textContent = work.length ? `Save your work first — ${work.join(' and ')}. Unsaved changes will be lost.` : '';
    }
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.remove('is-pulsing');
}

function closePop() {
    const pop = document.getElementById('updateNoticePop');
    const btn = document.getElementById('updateNoticeBtn');
    if (pop) pop.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

async function reloadNow() {
    const work = unsavedWork();
    if (work.length && !window.confirm(`Reload now? Note: ${work.join(' and ')} — unsaved changes will be lost.`)) return;
    const btn = document.getElementById('updateNoticeReload');
    if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Loading…'; }
    // Refresh the browser's copy of every app file, then reload onto them
    const files = Array.isArray(available?.files) ? available.files : [];
    const urls = ['index.html', ...files].filter((u, i, a) => a.indexOf(u) === i);
    const timeout = new Promise(r => setTimeout(r, 8000));
    await Promise.race([
        Promise.allSettled(urls.map(u => fetch(u, { cache: 'reload' }))),
        timeout,
    ]);
    window.location.reload();
}

export function wireUpdateNotice() {
    const btn = document.getElementById('updateNoticeBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const pop = document.getElementById('updateNoticePop');
        if (pop?.hidden) openPop(); else closePop();
    });
    document.getElementById('updateNoticeLater')?.addEventListener('click', () => {
        closePop();
        clearTimeout(repulseTimer);
        repulseTimer = setTimeout(pulse, REPULSE_AFTER_MS);
    });
    document.getElementById('updateNoticeReload')?.addEventListener('click', reloadNow);
    document.addEventListener('pointerdown', e => {
        if (!e.target.closest?.('#updateNoticeWrap')) closePop();
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });

    const maybeCheck = () => {
        if (document.visibilityState === 'visible' && Date.now() - lastCheck > FOCUS_CHECK_GAP_MS) check();
    };
    document.addEventListener('visibilitychange', maybeCheck);
    window.addEventListener('focus', maybeCheck);
    setInterval(() => { if (document.visibilityState === 'visible') check(); }, CHECK_EVERY_MS);
    check();

    // Test hook: PPMSUpdateNotice.simulate() shows the notice without a deploy
    window.PPMSUpdateNotice = {
        simulate(notes = 'Test update') {
            available = { version: 'simulated', deployedAt: new Date().toISOString(), notes, files: [] };
            show();
        },
        check,
    };
}

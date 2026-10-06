/* ================================================================
   VERSION CHIP — always-visible "v134" in the navbar that compares the
   version this page is RUNNING with the LATEST deployed version.

   • Running version: window.PPMS_BUILD, from scripts/core/build-info.js —
     stamped by tools/deploy.sh and loaded with the rest of the app code,
     so it is the version of the code the browser actually executed (even
     if it came from an old cached copy).
   • Latest version: version.json, written by the same deploy and fetched
     with cache: 'no-store' at start-up, every 3 minutes and whenever the
     tab regains focus.

   Same version → a calm chip with a green tick.
   Older version → the chip turns orange, shows "v133 → v134" and blinks
   until clicked. The popover's "Load latest version" re-downloads every
   app file listed in version.json (cache: 'reload') and then reloads,
   so browser caching can't bring the old code back.

   Local development (build-info says "dev") shows a neutral "dev" chip.
   ================================================================ */

const MANIFEST = 'version.json';
const CHECK_EVERY_MS = 3 * 60 * 1000;
const FOCUS_CHECK_GAP_MS = 30 * 1000;
const REBLINK_AFTER_MS = 10 * 60 * 1000;

const running = window.PPMS_BUILD || { version: 'dev', label: 'dev' };
let latest = null;
let lastCheck = 0;
let checking = false;

const isDev = () => !running.version || running.version === 'dev';
const isOutdated = () => !isDev() && latest && latest.version && latest.version !== running.version;
const labelOf = b => b?.label || (b?.version ? String(b.version).slice(0, 7) : '—');

const icon = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON_OK = icon('<path d="M20 6 9 17l-5-5"/>');
const ICON_UPDATE = icon('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>');
const ICON_DEV = icon('<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>');

export function renderUpdateNotice() {
    return `
        <div class="version-chip-wrap" id="updateNoticeWrap">
            <button type="button" class="version-chip" id="updateNoticeBtn" aria-haspopup="dialog" aria-expanded="false" data-state="checking">
                <span class="version-chip-icon" id="versionChipIcon">${ICON_OK}</span>
                <span class="version-chip-text" id="versionChipText">${labelOf(running)}</span>
            </button>
            <div class="version-pop" id="updateNoticePop" role="dialog" aria-label="PPMS version" hidden>
                <div class="version-pop-title" id="versionPopTitle">PPMS version</div>
                <dl class="version-rows">
                    <div class="version-row"><dt>Your version</dt><dd><strong id="versionRunning"></strong><span id="versionRunningWhen"></span></dd></div>
                    <div class="version-row"><dt>Latest version</dt><dd><strong id="versionLatest"></strong><span id="versionLatestWhen"></span></dd></div>
                </dl>
                <p class="version-status" id="versionStatus"></p>
                <p class="version-notes" id="updateNoticeNotes" hidden></p>
                <p class="version-warn" id="updateNoticeWarn" hidden></p>
                <div class="version-actions">
                    <button type="button" class="btn btn-ghost btn-sm" id="versionCheckNow">Check again</button>
                    <button type="button" class="btn btn-primary btn-sm" id="updateNoticeReload" hidden>${ICON_UPDATE}<span>Load latest version</span></button>
                </div>
            </div>
        </div>`;
}

function fmtWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };

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
    if (checking) return;
    checking = true;
    lastCheck = Date.now();
    try {
        const m = await fetchManifest();
        if (m) latest = m;
    } finally {
        checking = false;
        render();
    }
}

/** Plain-language list of work that a reload would throw away. */
function unsavedWork() {
    const items = [];
    try { if (typeof _ganttEditMode !== 'undefined' && _ganttEditMode) items.push('the Gantt is in edit mode'); } catch {}
    const openModal = [...document.querySelectorAll('.modal-overlay')]
        .some(el => !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
    if (openModal) items.push('a form or dialog is open');
    return items;
}

let _announced = null;
function render() {
    const btn = document.getElementById('updateNoticeBtn');
    if (!btn) return;
    const outdated = isOutdated();
    const state = isDev() ? 'dev' : outdated ? 'outdated' : latest ? 'current' : 'checking';
    btn.dataset.state = state;

    const iconEl = document.getElementById('versionChipIcon');
    if (iconEl) iconEl.innerHTML = state === 'outdated' ? ICON_UPDATE : state === 'dev' ? ICON_DEV : ICON_OK;
    setText('versionChipText', outdated ? `${labelOf(running)} → ${labelOf(latest)}` : labelOf(running));
    btn.title = {
        outdated: `A newer version (${labelOf(latest)}) is available — click to update`,
        current: `PPMS ${labelOf(running)} — you are on the latest version`,
        checking: `PPMS ${labelOf(running)}`,
        dev: 'Local development build',
    }[state];

    // Popover content
    setText('versionPopTitle', outdated ? 'A newer version is available' : 'PPMS version');
    setText('versionRunning', labelOf(running));
    setText('versionRunningWhen', running.deployedAt ? ` · ${fmtWhen(running.deployedAt)}` : '');
    setText('versionLatest', latest ? labelOf(latest) : (isDev() ? 'not checked in development' : 'checking…'));
    setText('versionLatestWhen', latest?.deployedAt ? ` · ${fmtWhen(latest.deployedAt)}` : '');
    const status = document.getElementById('versionStatus');
    if (status) {
        status.dataset.state = state;
        status.textContent = {
            outdated: 'You are using an older version. Load the latest version to get the newest fixes and features.',
            current: 'You are on the latest version.',
            checking: 'Checking for the latest version…',
            dev: 'Local development build — version checks run on the live site.',
        }[state];
    }
    const notes = document.getElementById('updateNoticeNotes');
    if (notes) {
        const text = outdated ? latest.notes : running.notes;
        notes.hidden = !text;
        notes.textContent = text ? `What's new: ${text}` : '';
    }
    const reloadBtn = document.getElementById('updateNoticeReload');
    if (reloadBtn) reloadBtn.hidden = !outdated;

    if (outdated && _announced !== latest.version) {
        _announced = latest.version;
        btn.classList.remove('is-acknowledged'); // a new version always blinks again
        if (typeof window.showToast === 'function') {
            window.showToast(`PPMS ${labelOf(latest)} is available — click the blinking version in the top bar to update.`, 'info');
        }
    }
}

function openPop() {
    const pop = document.getElementById('updateNoticePop');
    const btn = document.getElementById('updateNoticeBtn');
    if (!pop || !btn) return;
    const work = isOutdated() ? unsavedWork() : [];
    const warn = document.getElementById('updateNoticeWarn');
    if (warn) {
        warn.hidden = !work.length;
        warn.textContent = work.length ? `Save your work first — ${work.join(' and ')}. Unsaved changes will be lost.` : '';
    }
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    if (isOutdated()) btn.classList.add('is-acknowledged'); // stop blinking once the user has looked
    if (Date.now() - lastCheck > 10000) check();
}

let _reblinkTimer = null;
function closePop() {
    const pop = document.getElementById('updateNoticePop');
    const btn = document.getElementById('updateNoticeBtn');
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
    // Still outdated after looking? Start blinking again in 10 minutes.
    clearTimeout(_reblinkTimer);
    if (isOutdated()) _reblinkTimer = setTimeout(() => btn?.classList.remove('is-acknowledged'), REBLINK_AFTER_MS);
}

async function loadLatest() {
    const work = unsavedWork();
    if (work.length && !window.confirm(`Load the latest version now? Note: ${work.join(' and ')} — unsaved changes will be lost.`)) return;
    const btn = document.getElementById('updateNoticeReload');
    if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Loading…'; }
    // Refresh the browser's copy of every app file, then reload onto them
    const files = Array.isArray(latest?.files) ? latest.files : [];
    const urls = ['index.html', 'scripts/core/build-info.js', ...files].filter((u, i, a) => a.indexOf(u) === i);
    await Promise.race([
        Promise.allSettled(urls.map(u => fetch(u, { cache: 'reload' }))),
        new Promise(r => setTimeout(r, 8000)),
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
    document.getElementById('updateNoticeReload')?.addEventListener('click', loadLatest);
    document.getElementById('versionCheckNow')?.addEventListener('click', () => check());
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
    render();
    if (!isDev()) check();

    // Test hook: PPMSUpdateNotice.simulate() pretends a newer version is live
    window.PPMSUpdateNotice = {
        simulate(notes = 'Test update') {
            if (isDev()) running.version = 'dev-sim';
            latest = { version: 'simulated', label: 'v' + ((parseInt(String(running.label).replace(/\D/g, ''), 10) || 0) + 1), deployedAt: new Date().toISOString(), notes, files: [] };
            document.getElementById('updateNoticeBtn')?.classList.remove('is-acknowledged');
            render();
        },
        check,
        get running() { return running; },
        get latest() { return latest; },
    };
}

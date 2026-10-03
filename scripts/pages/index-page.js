import { bootstrapPage, exposeCoreGlobals, loadRuntimeScripts } from '../core/app-bootstrap.js';
import { CDN_SCRIPTS, ROUTES } from '../core/config.js';
import { byId, loadClassicScript } from '../core/dom.js';
import { canEditPlan, canWrite, getCurrentUser, isPlanner, isMasterAdmin } from '../core/guards.js';
import { installToastGlobal } from '../core/notifications.js';
import { applyTheme, applyStoredTheme, clearSession, toggleTheme } from '../core/session.js';
import { initFeature as initFiltersFeature } from '../features/filters/index.js';
import { initFeature as initPlanningTableFeature } from '../features/planning-table/index.js';
import { initFeature as initIssuesFeature } from '../features/issues/index.js';
import { initFeature as initSummaryFeature } from '../features/summary/index.js';
import { initFeature as initChartsFeature } from '../features/charts/index.js';
import { initFeature as initGanttFeature } from '../features/gantt/index.js';
import { initFeature as initVpxFeature } from '../features/vpx/index.js';
import { initFeature as initKd2ShellFeature } from '../features/kd2/shell/index.js';
import { renderPageChrome } from '../features/shell/page-chrome.js';
import { renderPageTail } from '../features/shell/page-tail.js';
import { renderModalRegistry } from '../templates/modal-registry.js';
import { renderHelp, wireHelp } from '../features/help/index.js';
import { renderAssistant, wireAssistant } from '../features/assistant/index.js';
import { wireFilterUI } from '../features/filters/behavior.js';
import { wireUpdateNotice } from '../features/update-notice/index.js';
import { wireTour } from '../features/tour/index.js';

function renderIndexPage() {
    return [
        renderPageChrome(),
        initFiltersFeature(),
        initSummaryFeature(),
        initKd2ShellFeature(),
        initGanttFeature(),
        initVpxFeature(),
        initChartsFeature(),
        initPlanningTableFeature(),
        initIssuesFeature(),
        renderModalRegistry(),
        renderHelp(),
        renderAssistant(),
        renderPageTail(),
    ].join('\n');
}

/* ── Export libraries on first use ──────────────────────────────
   jsPDF, autoTable, SheetJS and ExcelJS (~2.5 MB of script) are only
   needed to export or import. They load the first time someone points
   at or clicks an export / report / import / template control; that
   first click waits for them and then runs as normal. */
const EXPORT_LIBS = [CDN_SCRIPTS.jspdf, CDN_SCRIPTS.jspdfAutoTable, CDN_SCRIPTS.xlsx, CDN_SCRIPTS.excelJs];
const EXPORT_TRIGGER = 'button, a, [role="button"], [onclick], [data-export-view], .report-type-card';
const EXPORT_HINT = /export|pdf|excel|xlsx|word|template|import|download|report(?!er)/i;
let exportLibsPromise = null;

function exportLibsReady() {
    return !!(window.jspdf?.jsPDF?.API?.autoTable && window.XLSX && window.ExcelJS);
}

function loadExportLibs() {
    if (!exportLibsPromise) {
        exportLibsPromise = (async () => {
            for (const lib of EXPORT_LIBS) await loadClassicScript(lib.src, lib);
        })().catch(err => { exportLibsPromise = null; throw err; });
    }
    return exportLibsPromise;
}

function exportTriggerOf(target) {
    const el = target?.closest?.(EXPORT_TRIGGER);
    if (!el || el.disabled) return null;
    const hint = `${el.id} ${el.getAttribute('onclick') || ''} ${el.hasAttribute('data-export-view') ? 'export' : ''}`;
    return EXPORT_HINT.test(hint) ? el : null;
}

function wireLazyExportLibs() {
    window.PPMSExportLibs = { load: loadExportLibs, ready: exportLibsReady };
    const passing = new WeakSet();
    // Pointing at a control starts the download early
    document.addEventListener('pointerover', e => {
        if (exportLibsPromise || exportLibsReady()) return;
        if (exportTriggerOf(e.target)) loadExportLibs().catch(() => {});
    }, { passive: true });
    // The first click waits for the libraries, then is replayed
    document.addEventListener('click', async e => {
        if (exportLibsReady()) return;
        const el = exportTriggerOf(e.target);
        if (!el) return;
        if (passing.has(el)) { passing.delete(el); return; }
        e.preventDefault();
        e.stopImmediatePropagation();
        if (el.dataset.ppmsLibWait) return;
        el.dataset.ppmsLibWait = '1';
        const slow = setTimeout(() => window.showToast?.('Preparing export tools…', 'info'), 400);
        try {
            await loadExportLibs();
        } catch (err) {
            console.warn(err);
            window.showToast?.('Could not load the export tools — check the connection and try again.', 'error');
        }
        clearTimeout(slow);
        delete el.dataset.ppmsLibWait;
        passing.add(el); // replay once even if loading failed (the feature shows its own message)
        el.click();
    }, true);
}

function populateShellSessionState() {
    const user = getCurrentUser();
    if (!user) return;

    const chip = byId('navUserChip');
    if (chip) chip.style.display = 'flex';

    const avatar = byId('navUserAvatar');
    if (avatar) avatar.textContent = (user.name || user.email || '?').charAt(0).toUpperCase();

    const name = byId('navUserName');
    if (name) name.textContent = user.name || user.email || '—';

    const role = byId('navRoleBadge');
    if (role) {
        const labels = {
            master_admin: 'Master Admin',
            operator: 'Operator',
            planner: 'Planner',
            viewer: 'Viewer',
        };
        // 'admin' is the legacy value for 'operator' (pre-migration 46).
        const normRole = user.role === 'admin' ? 'operator' : (user.role || 'viewer');
        role.textContent = labels[normRole] || normRole || '—';
        role.className = `nav-role-badge role-${normRole.replace('_', '-')}`;
    }

    const logout = byId('btnLogout');
    if (logout) logout.style.display = 'flex';

    const unitCodes = byId('btnUnitCodes');
    if (unitCodes && isPlanner()) unitCodes.style.display = 'flex';

    const managePlanVersions = byId('btnManagePlanVersions');
    if (managePlanVersions && isPlanner()) managePlanVersions.style.display = 'flex';

    const auditLog = byId('btnAuditLog');
    const userMgmt = byId('btnUserMgmt');
    if (auditLog && isMasterAdmin()) auditLog.style.display = 'flex';
    if (userMgmt && isMasterAdmin()) userMgmt.style.display = 'flex';

    const editPlan = byId('btnGanttEdit');
    if (editPlan) editPlan.style.display = canEditPlan() ? '' : 'none';

    if (!canWrite()) {
        document.body.classList.add('viewer-mode');
    }
}

async function initPage() {
    bootstrapPage({
        rootId: 'pageRoot',
        template: renderIndexPage,
        requireAuth: true,
        authRedirect: ROUTES.login,
    });

    const root = document.getElementById('pageRoot');
    if (!root?.innerHTML) return;

    applyStoredTheme();
    installToastGlobal();
    populateShellSessionState();

    exposeCoreGlobals({
        applyTheme,
        canEditPlan,
        canWrite,
        getCurrentUser,
    });

    wireLazyExportLibs();
    await loadRuntimeScripts([
        CDN_SCRIPTS.supabase,
        CDN_SCRIPTS.chartJs,
        { src: 'scripts/core/custom-select.js' },
        { src: 'scripts/core/plan-versions.js' },
        { src: 'scripts/gantt-module.js' },
        { src: 'scripts/kd2.js' },
        { src: 'scripts/app.js' },
        { src: 'scripts/features/charts/analytics.js' },
    ]);

    wireFilterUI();
    wireHelp();
    wireAssistant();
    wireUpdateNotice();
    wireTour();
}

initPage().catch(error => {
    console.error(error);
    document.body.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;padding:32px;font-family:Inter,sans-serif">
        <div style="max-width:560px;text-align:center">
            <h1 style="margin:0 0 12px">PPMS failed to load</h1>
            <p style="margin:0;color:#94a3b8">${error.message}</p>
        </div>
    </main>`;
});

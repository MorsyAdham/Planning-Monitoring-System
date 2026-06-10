import { bootstrapPage, exposeCoreGlobals, loadRuntimeScripts } from '../core/app-bootstrap.js';
import { CDN_SCRIPTS, ROUTES } from '../core/config.js';
import { byId } from '../core/dom.js';
import { canEditPlan, canWrite, getCurrentUser, isAdmin, isMasterAdmin } from '../core/guards.js';
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
        renderPageTail(),
    ].join('\n');
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
            admin: 'Admin',
            planner: 'Planner',
            viewer: 'Viewer',
        };
        role.textContent = labels[user.role] || user.role || '—';
        role.className = `nav-role-badge role-${String(user.role || 'viewer').replace('_', '-')}`;
    }

    const logout = byId('btnLogout');
    if (logout) logout.style.display = 'flex';

    const unitCodes = byId('btnUnitCodes');
    if (unitCodes && isAdmin()) unitCodes.style.display = 'flex';

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

    await loadRuntimeScripts([
        CDN_SCRIPTS.supabase,
        CDN_SCRIPTS.chartJs,
        CDN_SCRIPTS.jspdf,
        CDN_SCRIPTS.jspdfAutoTable,
        CDN_SCRIPTS.xlsx,
        CDN_SCRIPTS.excelJs,
        { src: 'scripts/gantt-module.js' },
        { src: 'scripts/kd2.js' },
        { src: 'scripts/app.js' },
    ]);
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

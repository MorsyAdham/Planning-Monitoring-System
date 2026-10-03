/* ================================================================
   PPMS ACTIONS — things the Help page and the Assistant can do for
   the user. Every action goes through the same buttons and functions
   the user would use, so role permissions are respected automatically
   (a button hidden for your role = the action is not available).

   Action kinds
     scroll:<sectionId|filters>  scroll the page to a section
     open:<name>                 open a dialog / menu (see OPENERS)
     filter:<json>               apply main filter-bar values
     theme:<name>                switch colour theme
     module:<id>                 switch module

   Read-only and navigation actions run straight away. Actions that
   change data are never run from here — they only open the form, so the
   user reviews and saves it themselves (see assistant confirmations).
   ================================================================ */

/** open:<name> → the button that opens it. */
const OPENERS = {
    reportIssue:       { button: 'btnAddIssue',            label: 'Report Issue form', section: 'issuesSection' },
    issueDrafts:       { button: 'btnIssueDrafts',         label: 'Issue drafts',      section: 'issuesSection' },
    issueReport:       { button: 'btnIssueReportModal',    label: 'Issues report',     section: 'issuesSection' },
    vpxReport:         { button: 'btnVpxReportModal',      label: 'VPX Station Report' },
    execReport:        { button: 'btnExecReport',          label: 'Executive Report' },
    manageProcesses:   { button: 'btnManageKd2Processes',  label: 'Manage Processes' },
    planVersions:      { button: 'btnManagePlanVersions',  label: 'Manage Plan Versions' },
    unitCodes:         { button: 'btnUnitCodes',           label: 'Unit Codes' },
    userManagement:    { button: 'btnUserMgmt',            label: 'User Management' },
    auditLog:          { button: 'btnAuditLog',            label: 'Audit Log' },
    themePicker:       { button: 'btnThemePicker',         label: 'Theme picker' },
    notifications:     { button: 'f100NotifBell',          label: 'Notifications' },
    changePassword:    { button: 'btnChangePassword',      label: 'Change password' },
    help:              { fn: () => window.PPMSHelp?.open(),  label: 'Help & User Manual' },
    tour:              { fn: () => window.PPMSTour?.start(), label: 'Guided tour' },
};

export const SECTION_LABELS = {
    summarySection: 'Overview',
    ganttNavAnchor: 'Schedule',
    vpxSection: 'Progress (VPX)',
    chartsSection: 'Analytics',
    tableSection: 'Plan Table',
    issuesSection: 'Production Issues',
    filters: 'Filters',
};

function isVisible(el) {
    if (!el) return false;
    if (el.style.display === 'none' || el.hidden) return false;
    // Hidden by a parent (e.g. a menu item inside a closed dropdown is fine —
    // only treat inline "display:none" on the element itself as "not allowed")
    return true;
}

function scrollToSection(id) {
    const el = id === 'filters' ? document.querySelector('.filter-section') : document.getElementById(id);
    if (!el || el.offsetParent === null) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
}

/** Human label for an action id, for buttons like "Open Issues report". */
export function actionLabel(action) {
    const [kind, arg] = String(action || '').split(/:(.*)/s);
    if (kind === 'scroll') return `Go to ${SECTION_LABELS[arg] || arg}`;
    if (kind === 'open') return `Open ${OPENERS[arg]?.label || arg}`;
    if (kind === 'theme') return `Switch to ${arg} theme`;
    if (kind === 'module') return `Switch module`;
    if (kind === 'filter') return 'Apply filters';
    return action;
}

/** Can the current user run this action right now? */
export function isActionAvailable(action) {
    const [kind, arg] = String(action || '').split(/:(.*)/s);
    if (kind === 'open') {
        const o = OPENERS[arg];
        if (!o) return false;
        if (o.fn) return true;
        return isVisible(document.getElementById(o.button));
    }
    if (kind === 'scroll') {
        const el = arg === 'filters' ? document.querySelector('.filter-section') : document.getElementById(arg);
        return !!el && el.offsetParent !== null;
    }
    return ['theme', 'module', 'filter'].includes(kind);
}

/** Runs an action. Returns { ok, message }. */
export async function runAction(action) {
    const [kind, arg] = String(action || '').split(/:(.*)/s);

    if (kind === 'scroll') {
        return scrollToSection(arg)
            ? { ok: true, message: `Showing ${SECTION_LABELS[arg] || arg}.` }
            : { ok: false, message: `${SECTION_LABELS[arg] || arg} isn't shown in this module.` };
    }

    if (kind === 'open') {
        const o = OPENERS[arg];
        if (!o) return { ok: false, message: 'Unknown action.' };
        if (o.fn) { o.fn(); return { ok: true, message: `Opened ${o.label}.` }; }
        const btn = document.getElementById(o.button);
        if (!isVisible(btn)) return { ok: false, message: `${o.label} isn't available for your role or in this module.` };
        if (o.section) scrollToSection(o.section);
        btn.click();
        return { ok: true, message: `Opened ${o.label}.` };
    }

    if (kind === 'theme') {
        if (typeof window.setTheme !== 'function') return { ok: false, message: 'Themes are not ready yet.' };
        window.setTheme(arg);
        return { ok: true, message: `Theme changed.` };
    }

    if (kind === 'module') {
        const rt = window.PPMSModuleRuntime;
        const allowed = rt?.getAllowedModules?.() || [];
        if (!allowed.includes(arg)) return { ok: false, message: 'You don\'t have access to that module.' };
        if (rt?.getActiveModule?.() === arg) return { ok: true, message: 'You are already in that module.' };
        if (!window.CustomSelect) return { ok: false, message: 'Could not switch module.' };
        // Same path as picking it in the top bar (the page reloads)
        window.CustomSelect.setValue('moduleSelectorWrap', arg, true);
        return { ok: true, message: 'Switching module…' };
    }

    if (kind === 'filter') {
        return applyFilters(JSON.parse(arg || '{}'));
    }

    return { ok: false, message: 'Unknown action.' };
}

/** Sets main filter-bar values the same way ticking them would, then reloads.
 *  spec: { vehicle:[], battalion:[], unit:[], category:[], week:[], timeFrame:'', search:'' } */
export async function applyFilters(spec) {
    // Top-level consts in app.js: global, but not properties of window
    /* global filterState, filterOptions */
    const fs = typeof filterState !== 'undefined' ? filterState : null;
    const fo = typeof filterOptions !== 'undefined' ? filterOptions : null;
    if (!fs || !fo) return { ok: false, message: 'Filters are not ready yet.' };
    const applied = [];
    for (const key of ['vehicle', 'battalion', 'unit', 'category', 'week', 'k9Component']) {
        const wanted = spec[key];
        if (!Array.isArray(wanted) || !wanted.length) continue;
        const opts = fo[key] || [];
        const values = wanted.map(w => {
            const s = String(w).toLowerCase();
            return (opts.find(o => String(o.value).toLowerCase() === s)
                 || opts.find(o => String(o.label).toLowerCase() === s)
                 || opts.find(o => String(o.label).toLowerCase().includes(s)))?.value;
        }).filter(Boolean);
        if (!values.length) continue;
        fs[key] = new Set(values);
        window.renderMultiSelectMenu?.(key);
        applied.push(key);
    }
    if (spec.timeFrame) {
        const tf = document.getElementById('filterTimeFrame');
        if (tf && [...tf.options].some(o => o.value === spec.timeFrame)) {
            tf.value = spec.timeFrame;
            tf.dispatchEvent(new Event('change'));
            applied.push('timeFrame');
        }
    }
    if (typeof spec.search === 'string') {
        const s = document.getElementById('filterSearch');
        if (s) { s.value = spec.search; s.dispatchEvent(new Event('input')); applied.push('search'); }
    }
    if (!applied.length) return { ok: false, message: 'None of those filter values exist in this module.' };
    if (typeof window.loadData === 'function') await window.loadData();
    scrollToSection('summarySection');
    return { ok: true, message: `Filters applied (${applied.join(', ')}).` };
}

/* ================================================================
   KD1 Assembly Control System — app.js
   Production-ready vanilla JS + Supabase + Chart.js
   ================================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────────
   1. CONFIGURATION — Replace with your Supabase project credentials
   ────────────────────────────────────────────────────────────────── */
const SUPABASE_URL = "https://biqwfqkuhebxcfucangt.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpcXdmcWt1aGVieGNmdWNhbmd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzNzM5NzQsImV4cCI6MjA4MTk0OTk3NH0.QkASAl8yzXfxVq0b0FdkXHTOpblldr2prCnImpV8ml8";

/* ──────────────────────────────────────────────────────────────────
   2. AUTH — session helpers (must be at top so every function below
      can call them; SESSION_KEY is a const that must be initialised
      before getCurrentUser() runs for the first time)
   ────────────────────────────────────────────────────────────────── */
const SESSION_KEY = 'kd1_session';

function getCurrentUser() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function isMasterAdmin() { return getCurrentUser()?.role === 'master_admin'; }
function isAdmin() { return ['master_admin', 'admin'].includes(getCurrentUser()?.role); }
function isPlanner() { return ['master_admin', 'admin', 'planner'].includes(getCurrentUser()?.role); }
function canWrite() { return isAdmin(); }      // admin data edits (start/complete/notes)
function canEditPlan() { return isMasterAdmin() || getCurrentUser()?.role === 'planner'; }  // Gantt plan edits
function getCachedIP() { return getCurrentUser()?.ip || 'unknown'; }

/* ──────────────────────────────────────────────────────────────────
   EXPORT PERMISSIONS — only master_admin or allowed users can export
   ────────────────────────────────────────────────────────────────── */
let _exportAllowedEmails = null;

async function _loadExportPermissions() {
    if (!db) return;
    try {
        const { data } = await db.from('ppms_export_permissions').select('email');
        _exportAllowedEmails = (data || []).map(r => r.email.trim().toLowerCase());
    } catch { _exportAllowedEmails = []; }
}

async function canExport() {
    if (isMasterAdmin()) return true;
    if (_exportAllowedEmails === null) await _loadExportPermissions();
    const email = getCurrentUser()?.email?.trim().toLowerCase();
    return !!(email && _exportAllowedEmails?.includes(email));
}

/* Export Permissions Modal */
/* Export permissions are shown inside the User Management modal — no standalone modal needed */
async function loadExportPermList() {
    const list = document.getElementById('exportPermList');
    if (!list) return;
    list.innerHTML = '<li class="exp-perm-empty">Loading…</li>';
    try {
        const { data, error } = await db.from('ppms_export_permissions')
            .select('id, email, note, granted_by, created_at')
            .order('created_at', { ascending: true });
        if (error) throw error;
        if (!data || !data.length) {
            list.innerHTML = '<li class="exp-perm-empty">No users granted export access yet.</li>';
            return;
        }
        list.innerHTML = data.map(r => `
            <li class="exp-perm-item">
                <span class="exp-perm-email">${r.email}</span>
                ${r.note ? `<span class="exp-perm-note">${r.note}</span>` : ''}
                <button class="exp-perm-del" data-id="${r.id}" title="Remove">&#x2715;</button>
            </li>`).join('');
        list.querySelectorAll('.exp-perm-del').forEach(btn => {
            btn.addEventListener('click', () => removeExportPerm(Number(btn.dataset.id)));
        });
    } catch (e) {
        list.innerHTML = `<li class="exp-perm-empty" style="color:var(--clr-overdue)">Error: ${e.message}</li>`;
    }
}
async function addExportPerm() {
    const selectEl = document.getElementById('exportPermUserSelect');
    const noteEl   = document.getElementById('exportPermNote');
    const errEl    = document.getElementById('exportPermError');
    const email    = selectEl?.value.trim().toLowerCase();
    if (!email) { if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Please select a user.'; } return; }
    if (errEl) errEl.style.display = 'none';
    try {
        const u = getCurrentUser();
        const { error } = await db.from('ppms_export_permissions').insert({
            email, note: noteEl?.value.trim() || null, granted_by: u?.email || null,
        });
        if (error) { if (error.code === '23505') throw new Error('This user already has export access.'); throw error; }
        await auditLog('grant_export', 'ppms_export_permissions', null, null, { email });
        _exportAllowedEmails = null;
        if (selectEl) selectEl.value = '';
        if (noteEl)   noteEl.value   = '';
        await loadExportPermList();
        _broadcastExportPermChange();
        showToast(`Export access granted to ${email}.`, 'success');
    } catch (e) {
        if (errEl) { errEl.style.display = 'block'; errEl.textContent = e.message; }
    }
}
async function removeExportPerm(id) {
    if (!id) return;
    try {
        const { data: row } = await db.from('ppms_export_permissions').select('email').eq('id', id).single();
        const { error } = await db.from('ppms_export_permissions').delete().eq('id', id);
        if (error) throw error;
        await auditLog('revoke_export', 'ppms_export_permissions', id, { email: row?.email }, null);
        _exportAllowedEmails = null;
        await loadExportPermList();
        _broadcastExportPermChange();
        showToast('Export access revoked.', 'success');
    } catch (e) { showToast(`Error: ${e.message}`, 'error'); }
}

function _applyExportVisibility() {
    canExport().then(allowed => {
        const ids = ['btnVpxReportModal', 'btnIssueReportModal', 'btnReports'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = allowed ? '' : 'none';
        });
    });
}

let _exportPermChannel = null;
function startExportPermSync() {
    if (!db) return;
    if (_exportPermChannel) {
        try { db.removeChannel(_exportPermChannel); } catch {}
        _exportPermChannel = null;
    }
    // Broadcast (not postgres_changes) — works regardless of table replication settings
    _exportPermChannel = db.channel('ppms-export-perms')
        .on('broadcast', { event: 'perm_changed' }, async () => {
            _exportAllowedEmails = null;
            await _loadExportPermissions();
            _applyExportVisibility();
        })
        .subscribe();
}

function _broadcastExportPermChange() {
    _exportPermChannel?.send({ type: 'broadcast', event: 'perm_changed', payload: {} }).catch(() => {});
}

async function sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Write one entry to planning_audit_log.
 * Silently swallows errors so audit failures never break the UI.
 */
async function auditLog(action, table, recId, before, after) {
    const user = getCurrentUser();
    if (!user || !db) return;
    try {
        await db.from('planning_audit_log').insert({
            user_id: user.id,
            user_email: user.email,
            user_role: user.role,
            action,
            table_name: table,
            record_id: String(recId ?? ''),
            data_before: before ? JSON.parse(JSON.stringify(before)) : null,
            data_after: after ? JSON.parse(JSON.stringify(after)) : null,
            ip_address: getCachedIP(),
        });
    } catch (e) {
        console.warn('Audit log write failed (non-fatal):', e.message);
    }
}

window.__ppmsShared = {
    auditLog: (...args) => auditLog(...args),
    getCurrentUser,
    getCachedIP,
};

function populateNavbar() {
    const user = getCurrentUser();
    if (!user) return;

    const chip = document.getElementById('navUserChip');
    if (chip) chip.style.display = 'flex';

    const avatar = document.getElementById('navUserAvatar');
    if (avatar) avatar.textContent = (user.name || user.email).charAt(0).toUpperCase();

    const nameEl = document.getElementById('navUserName');
    if (nameEl) nameEl.textContent = user.name || user.email;

    const roleBadge = document.getElementById('navRoleBadge');
    if (roleBadge) {
        const labels = { master_admin: 'Master Admin', admin: 'Admin', planner: 'Planner', viewer: 'Viewer' };
        roleBadge.textContent = labels[user.role] || user.role;
        roleBadge.className = `nav-role-badge role-${user.role.replace('_', '-')}`;
    }

    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) logoutBtn.style.display = 'flex';

    if (isAdmin()) {
        const ucBtn = document.getElementById('btnUnitCodes');
        if (ucBtn) ucBtn.style.display = 'flex';
    }
    if (isMasterAdmin()) {
        const auditBtn = document.getElementById('btnAuditLog');
        if (auditBtn) auditBtn.style.display = 'flex';
        const umBtn = document.getElementById('btnUserMgmt');
        if (umBtn) umBtn.style.display = 'flex';
    }

    // Viewer: CSS disables all edit controls
    if (!canWrite()) document.body.classList.add('viewer-mode');
    // Hide Edit Plan button unless user can edit the schedule
    const btnEdit = document.getElementById('btnGanttEdit');
    if (btnEdit) btnEdit.style.display = canEditPlan() ? '' : 'none';
}

async function doLogout() {
    const user = getCurrentUser();
    if (user && db) {
        try {
            await db.from('planning_audit_log').insert({
                user_id: user.id,
                user_email: user.email,
                user_role: user.role,
                action: 'LOGOUT',
                ip_address: getCachedIP(),
            });
        } catch (e) { /* non-fatal */ }
    }
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = window.location.pathname.replace(/\/[^/]*$/, '/') + 'login.html';
}


/* ──────────────────────────────────────────────────────────────────
   STATION CODE LOOKUP
   Returns the station code (A01, A02, …) for a given
   process_station name + vehicle type.
   ────────────────────────────────────────────────────────────────── */
const _STATION_CODES = {
    'Suspension': 'A01',
    'Interior': 'A03',
    'Turret/Gun': 'A05/A11',
    'Hydraulic': 'A06',
    'Bore Sight': 'A07',
    'Turret': 'A08',
    'T/Electric (TURRET)': 'A09',
    'Hyd / Sub (TURRET)': 'A10',
    'Electric/Interior': 'A12',
    'Automation': 'A14',
    'Final Assembly': 'A15',
};

function getStationCode(station, vehicle) {
    if (_STATION_CODES[station]) return _STATION_CODES[station];
    const isK9 = /K9/i.test(String(vehicle || ''));
    // H/Electric → A02 (K9), Track → A02 (K10/K11)
    if (station === 'H/Electric') return isK9 ? 'A02' : '';
    if (station === 'Track') return isK9 ? '' : 'A02';
    // Engine → A04 (K9), A13 (K10/K11)
    if (station === 'Engine') return isK9 ? 'A04' : 'A13';
    return '';
}

/* ──────────────────────────────────────────────────────────────────
   CATEGORY MAP — process_station → category
   ────────────────────────────────────────────────────────────────── */
const CATEGORY_MAP = {
    // Assembly
    'Suspension': 'Assembly',
    'Turret': 'Assembly',
    'T/Electric (TURRET)': 'Assembly',
    'Hyd / Sub (TURRET)': 'Assembly',
    'H/Electric': 'Assembly',
    'Interior': 'Assembly',
    'Engine': 'Assembly',
    'Turret/Gun': 'Assembly',
    'Hydraulic': 'Assembly',
    'Bore Sight': 'Assembly',
    'Track': 'Assembly',
    'Electric/Interior': 'Assembly',
    'Automation': 'Assembly',
    'Final Assembly': 'Assembly',
    // Final Test
    '#1Insp': 'Final Test',
    'TEST RUN': 'Final Test',
    'Performance test': 'Final Test',
    'REPAIR': 'Final Test',
    'CHECK': 'Final Test',
    'Powerpack check': 'Final Test',
    'Final Check': 'Final Test',
    // Processing
    'Processing': 'Processing',
    'Clean/dry': 'Processing',
    'Masking': 'Processing',
    'Sanding': 'Processing',
    'Painting': 'Processing',
    'Touch-up': 'Processing',
    'Attaching': 'Processing',
};

/* Station default durations (working days) */
const STATION_DEFAULTS = {
    // Assembly (2 days each)
    'Suspension': 2,
    'Turret': 2,
    'T/Electric (TURRET)': 2,
    'Hyd / Sub (TURRET)': 2,
    'H/Electric': 2,
    'Interior': 2,
    'Engine': 2,
    'Turret/Gun': 2,
    'Hydraulic': 2,
    'Bore Sight': 2,
    'Track': 2,
    'Electric/Interior': 2,
    'Automation': 2,
    'Final Assembly': 2,
    // Final Test
    '#1Insp': 1,
    'TEST RUN': 3,
    'Performance test': 3,
    'REPAIR': 1,
    'CHECK': 1,
    'Powerpack check': 1,
    'Final Check': 1,
    // Processing
    'Processing': 5,
};

function getCategory(processStation) {
    const key = String(processStation ?? '').trim();
    if (!key) return 'Other';

    // Exact match first
    if (CATEGORY_MAP[key]) return CATEGORY_MAP[key];

    // Case-insensitive exact match
    const lower = key.toLowerCase();
    for (const k of Object.keys(CATEGORY_MAP)) {
        if (k.toLowerCase() === lower) return CATEGORY_MAP[k];
    }

    // Loose match: prefix/contains checks to handle minor variants
    for (const k of Object.keys(CATEGORY_MAP)) {
        const kl = k.toLowerCase();
        if (lower.startsWith(kl) || kl.startsWith(lower) || lower.includes(kl) || kl.includes(lower)) {
            return CATEGORY_MAP[k];
        }
    }

    return 'Other';
}

function getModuleRuntime() {
    return window.PPMSModuleRuntime || null;
}

function getActiveModuleId() {
    return getModuleRuntime()?.getActiveModule?.() || 'kd1';
}

function isKD2Module() {
    return getActiveModuleId() === 'kd2';
}

function isF100KD2Module() {
    return getActiveModuleId() === 'f100kd2';
}

function isF200Module() {
    const id = getActiveModuleId();
    return id === 'kd1' || id === 'kd2';
}

function getActiveModuleConfig() {
    return getModuleRuntime()?.getActiveConfig?.() || null;
}

function getModuleBadge() {
    if (isF100KD2Module()) return 'F100 – KD2';
    return getActiveModuleConfig()?.badge || (isKD2Module() ? 'F200 – KD2' : 'F200 – KD1');
}

function getModuleReportTitle() {
    if (isF100KD2Module()) return 'F100 Part Manufacturing Progress Control';
    return isKD2Module() ? 'F200 Battalion Planning and Progress Control' : 'F200 Assembly Control System';
}

function getModuleReportSubtitle() {
    if (isF100KD2Module()) return 'Gun and Vehicle Part Plan vs Actual';
    return isKD2Module() ? 'Manual and generated plan export' : 'Plan vs Actual Tracking System';
}

function getModuleCategory(processStation, row = null) {
    return getModuleRuntime()?.getCategory?.(processStation, row) || getCategory(processStation);
}

function syncReportCategoryOptions() {
    const target = document.getElementById('reportCategory');
    if (!target) return;
    // F100 has no station categories — show a disabled placeholder
    if (isF100KD2Module()) {
        target.innerHTML = '<option value="">All (no categories)</option>';
        target.disabled = true;
        const wrap = target.closest('.form-group') || target.parentElement;
        if (wrap) wrap.style.opacity = '0.4';
    } else {
        target.disabled = false;
        const wrap = target.closest('.form-group') || target.parentElement;
        if (wrap) wrap.style.opacity = '';
        const source = document.getElementById('filterCategory');
        if (source) {
            const currentVal = target.value;
            target.innerHTML = source.innerHTML;
            if ([...target.options].some(opt => opt.value === currentVal)) target.value = currentVal;
        }
    }
    // Show/hide KD2-only report type cards
    const kd2 = isKD2Module();
    ['kd2ReportCardBattalion', 'kd2ReportCardVtype', 'kd2ReportCardAnalytics'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.hidden = !kd2;
    });
    // Show/hide vehicle type filter
    const vtypeGroup = document.getElementById('reportVtypeGroup');
    if (vtypeGroup) vtypeGroup.style.display = kd2 ? '' : 'none';
    if (!kd2) {
        const vtypeSel = document.getElementById('reportVehicleType');
        if (vtypeSel) vtypeSel.value = '';
    }
    // If a KD2-only type was checked but we're now in a non-KD2 module, reset to full
    if (!kd2) {
        const checked = document.querySelector('input[name="reportType"]:checked');
        if (checked && ['battalion', 'vtype', 'analytics'].includes(checked.value)) {
            const fullRadio = document.querySelector('input[name="reportType"][value="full"]');
            if (fullRadio) { fullRadio.checked = true; }
        }
    }
}

function populateCategorySelect(values) {
    const sel = document.getElementById('filterCategory');
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">All Categories</option>';
    values.forEach(value => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        sel.appendChild(opt);
    });
    if ([...sel.options].some(opt => opt.value === currentVal)) {
        sel.value = currentVal;
    }
}

function getModuleProgressTable() {
    return isKD2Module() ? 'kd2_progress' : 'assembly_progress';
}

function getModulePlanTable() {
    if (isF100KD2Module()) return 'f100_plans';
    return isKD2Module() ? 'kd2_plan' : 'assembly_plan';
}

function getModulePlanDatePayload(startDate, endDate, remark = undefined) {
    if (isF100KD2Module()) {
        return { planned_start_date: startDate, planned_end_date: endDate };
    }
    const payload = isKD2Module()
        ? {
            planned_start_date: startDate,
            planned_end_date: endDate,
            schedule_week: weekLabel(startDate),
        }
        : {
            start_date: startDate,
            end_date: endDate,
            week: weekLabel(startDate),
        };
    if (remark !== undefined) {
        payload.remark = remark;
    }
    return payload;
}

function samePlanLane(a, b) {
    if (!a || !b) return false;
    // F100: lane = same battalion + vehicle type + serial number
    if (isF100KD2Module()) {
        return (a.battalion_code || '') === (b.battalion_code || '') &&
               (a.vehicle_type   || '') === (b.vehicle_type   || '') &&
               String(a.serial_number ?? '') === String(b.serial_number ?? '');
    }
    if (isKD2Module() && (a.battalion_code || '') !== (b.battalion_code || '')) return false;
    return a.vehicle === b.vehicle && a.vehicle_no === b.vehicle_no;
}

function buildVisibleGanttDays(startDate, endDate) {
    if (!startDate || !endDate || startDate > endDate) return [];
    return generateDateRange(startDate, endDate)
        .filter(d => new Date(d + 'T00:00:00').getDay() !== 5);
}

function resolveVisibleGanttColumn(dayIndex, dateStr, clampFallback) {
    if (dayIndex[dateStr] !== undefined) return dayIndex[dateStr];
    for (let n = 1; n <= 3; n++) {
        const next = addDays(dateStr, n);
        if (dayIndex[next] !== undefined) return dayIndex[next];
    }
    for (let n = 1; n <= 3; n++) {
        const prev = addDays(dateStr, -n);
        if (dayIndex[prev] !== undefined) return dayIndex[prev];
    }
    return clampFallback;
}

function compareGanttLanePriority(a, b) {
    const pa = _laneOrder[a.task.id] ?? 0;
    const pb = _laneOrder[b.task.id] ?? 0;
    if (pa !== pb) return pa - pb;
    if (a.si !== b.si) return a.si - b.si;
    if (a.ei !== b.ei) return a.ei - b.ei;
    return (a.task.id ?? 0) - (b.task.id ?? 0);
}

function buildPositionedGanttLaneTasks(tasks, startDate, endDate) {
    const days = buildVisibleGanttDays(startDate, endDate);
    const numDays = days.length;
    if (!numDays) return [];
    const dayIndex = Object.fromEntries(days.map((d, i) => [d, i]));
    const positioned = tasks
        .map(task => {
            const rawSi = task.start_date < startDate ? 0 : resolveVisibleGanttColumn(dayIndex, task.start_date, null);
            const rawEi = task.end_date > endDate ? numDays - 1 : resolveVisibleGanttColumn(dayIndex, task.end_date, null);
            if (rawSi === null || rawEi === null || rawSi > rawEi) return null;
            return { task, si: rawSi, ei: rawEi };
        })
        .filter(Boolean)
        .sort(compareGanttLanePriority);

    const laneEndAt = [];
    // Pack greedily from lane 0. Only honour a preferred lane for blocks the user
    // explicitly moved; everything else always floats to the topmost free row.
    positioned.forEach(item => {
        const preferred = Number.isFinite(_ganttManualLane[item.task.id])
            ? _ganttManualLane[item.task.id]
            : 0;
        let lane = preferred;
        while (laneEndAt[lane] !== undefined && laneEndAt[lane] >= item.si) lane++;
        item.lane = lane;
        laneEndAt[lane] = item.ei;
        _ganttVisualLane[item.task.id] = lane;
    });

    return positioned;
}

function moveGanttBlockOneLane(planId, direction, startDate, endDate) {
    const anchorTask = currentData.find(row => String(row.id) === String(planId));
    if (!anchorTask || !Number.isFinite(direction)) return false;

    const laneTasks = currentData.filter(row => samePlanLane(row, anchorTask));
    const positioned = buildPositionedGanttLaneTasks(laneTasks, startDate, endDate);
    const anchor = positioned.find(item => String(item.task.id) === String(planId));
    if (!anchor) return false;

    const targetLane = Math.max(0, anchor.lane + direction);
    if (targetLane === anchor.lane) return false;

    const neighbor = positioned
        .filter(item =>
            String(item.task.id) !== String(planId) &&
            item.lane === targetLane &&
            item.si <= anchor.ei &&
            item.ei >= anchor.si
        )
        .sort((a, b) => {
            const overlapA = Math.min(anchor.ei, a.ei) - Math.max(anchor.si, a.si);
            const overlapB = Math.min(anchor.ei, b.ei) - Math.max(anchor.si, b.si);
            if (overlapA !== overlapB) return overlapB - overlapA;
            return compareGanttLanePriority(a, b);
        })[0];

    if (neighbor) {
        _ganttManualLane[neighbor.task.id] = anchor.lane;
        _ganttVisualLane[neighbor.task.id] = anchor.lane;
    }
    _ganttManualLane[planId] = targetLane;
    _ganttVisualLane[planId] = targetLane;
    return true;
}

function getKd2ForwardMoveRows(anchorTask, rows = []) {
    const helper = getModuleRuntime()?.getPlanMoveRowsFromAnchor;
    if (typeof helper !== 'function') return anchorTask ? [anchorTask] : [];
    const moveRows = helper(anchorTask, rows);
    return moveRows?.length ? moveRows : (anchorTask ? [anchorTask] : []);
}

function getF100ForwardMoveRows(anchor, rows) {
    const laneKey = r => [r.battalion_code || '', r.vehicle_type || '', r.serial_number ?? '', String(r.part_id || '')].join('||');
    const anchorKey = laneKey(anchor);
    const laneRows = rows.filter(r => laneKey(r) === anchorKey);
    const anchorStep = anchor.step_number ?? anchor.sort_order ?? 9999;
    return laneRows.filter(r => (r.step_number ?? r.sort_order ?? 9999) >= anchorStep);
}

function normalizeKd2PlanRowForGantt(row) {
    return {
        ...row,
        vehicle: row.vehicle ?? row.vehicle_type,
        vehicle_no: row.vehicle_no ?? row.unit_serial,
        start_date: row.start_date ?? row.planned_start_date,
        end_date: row.end_date ?? row.planned_end_date,
    };
}

async function fetchKd2LaneRowsForGantt(task) {
    if (!db || !task?.battalion_id || !(task.vehicle_type || task.vehicle)) return [];
    let query = db
        .from('kd2_plan')
        .select('id, battalion_id, vehicle_type, unit_serial, route_sequence, station_sequence_in_category, station_code, planned_start_date, planned_end_date')
        .eq('battalion_id', task.battalion_id)
        .eq('vehicle_type', task.vehicle_type || task.vehicle);
    query = task.unit_serial === null
        ? query.is('unit_serial', null)
        : query.eq('unit_serial', task.unit_serial);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(normalizeKd2PlanRowForGantt);
}

async function resolveGanttMoveSet(task) {
    if (!task) return [];
    if (_ganttMoveMode === 'lane') {
        if (isKD2Module()) {
            const laneRows = await fetchKd2LaneRowsForGantt(task);
            if (laneRows.length) return laneRows;
        }
        return currentData.filter(row => samePlanLane(row, task));
    }
    if (_ganttMoveMode === 'from-block') {
        if (isF100KD2Module()) {
            return getF100ForwardMoveRows(task, currentData);
        }
        if (isKD2Module()) {
            const laneRows = await fetchKd2LaneRowsForGantt(task);
            if (laneRows.length) return getKd2ForwardMoveRows(task, laneRows);
        }
        return getKd2ForwardMoveRows(task, currentData);
    }
    if (_ganttMoveMode === 'plan') return currentData;
    return _selectedGanttPlanIds.has(String(task.id)) && _selectedGanttPlanIds.size > 1
        ? currentData.filter(row => _selectedGanttPlanIds.has(String(row.id)))
        : [task];
}

function getModuleGanttZones(startDate = '', endDate = '') {
    const runtimeZones = getModuleRuntime()?.getGanttSpecialZones?.(startDate, endDate);
    return [...SPECIAL_ZONES, ...(Array.isArray(runtimeZones) ? runtimeZones : [])];
}

function getUnitCodeTitle() {
    return isKD2Module() ? 'KD2 Unit Codes' : 'Unit Codes';
}

function ordinalLabel(num) {
    const mod100 = num % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
    const mod10 = num % 10;
    if (mod10 === 1) return `${num}st`;
    if (mod10 === 2) return `${num}nd`;
    if (mod10 === 3) return `${num}rd`;
    return `${num}th`;
}

function getKd2BaselineBattalions() {
    return Array.from({ length: 5 }, (_, index) => {
        const num = index + 1;
        return {
            battalion_code: `BTL-${String(num).padStart(2, '0')}`,
            battalion_name: `${ordinalLabel(num)} Battalion`,
            delivery_deadline: null,
            notes: 'Bootstrap baseline shell',
        };
    });
}

function getKd2BattalionOptionLabel(row) {
    const num = parseInt(String(row?.battalion_code || row?.battalion_name || '').match(/(\d+)/)?.[1] || '', 10);
    if (Number.isFinite(num) && num > 0 && num <= 5) return `${ordinalLabel(num)} Battalion`;
    return row?.battalion_name || row?.battalion_code || 'Battalion';
}

function setUnitCodesShell() {
    const isKD2 = isKD2Module() || isF100KD2Module();
    const isF100 = isF100KD2Module();
    const battalionHeader = document.getElementById('ucHeaderBattalion');
    const battalionGroup = document.getElementById('ucBattalionGroup');
    const title = document.getElementById('unitCodesTitleText');
    const vehicleHeader = document.getElementById('ucHeaderVehicle');
    const unitHeader = document.getElementById('ucHeaderUnit');
    const codeHeader = document.getElementById('ucHeaderCode');
    const unitNameHeader = document.getElementById('ucHeaderUnitName');
    const unitCodeHeader = document.getElementById('ucHeaderUnitCode');
    const unitSelect = document.getElementById('ucUnit');
    const unitText = document.getElementById('ucUnitText');
    if (title) title.textContent = getUnitCodeTitle();
    if (vehicleHeader) vehicleHeader.textContent = 'Vehicle';
    if (unitHeader) unitHeader.textContent = isKD2 ? 'Unit Label' : 'Unit';
    if (codeHeader) codeHeader.textContent = isF100 ? 'Serial No.' : 'Unit Code';
    if (unitNameHeader) unitNameHeader.style.display = isF100 ? '' : 'none';
    if (unitCodeHeader) unitCodeHeader.style.display = isF100 ? '' : 'none';
    if (battalionHeader) battalionHeader.style.display = isKD2 ? '' : 'none';
    if (battalionGroup) battalionGroup.style.display = isKD2 ? '' : 'none';
    if (unitSelect) unitSelect.style.display = isKD2 ? 'none' : '';
    if (unitText) unitText.style.display = isKD2 ? '' : 'none';
}

async function loadKd2Battalions() {
    const { data, error } = await db.from('kd2_battalions').select('id, battalion_code, battalion_name, delivery_deadline, notes').order('battalion_code');
    if (error) throw error;

    const battalions = data || [];
    const baseline = getKd2BaselineBattalions();
    const existingCodes = new Set(battalions.map(row => row.battalion_code));
    const missing = baseline.filter(row => !existingCodes.has(row.battalion_code));
    if (!missing.length) return battalions;

    const { data: insertedBattalions, error: insertError } = await db
        .from('kd2_battalions')
        .insert(missing)
        .select('id, battalion_code, battalion_name, delivery_deadline, notes');
    if (insertError) throw insertError;

    const planningRows = (insertedBattalions || []).flatMap(battalion => ['K9', 'K10', 'K11'].map(vehicle => ({
        battalion_id: battalion.id,
        vehicle_type: vehicle,
        required_quantity: null,
        delivery_deadline: null,
        skip_friday: true,
        include_saturday: false,
        assumptions_status: 'pending',
        notes: 'Bootstrap baseline shell',
    })));
    if (planningRows.length) {
        const { error: planningError } = await db
            .from('kd2_planning_inputs')
            .upsert(planningRows, { onConflict: 'battalion_id,vehicle_type' });
        if (planningError) throw planningError;
    }

    await auditLog('BOOTSTRAP', 'kd2_battalions', 'baseline-5', null, {
        battalions: missing.map(row => row.battalion_code),
        planning_rows: planningRows.length,
    });

    return battalions.concat(insertedBattalions || []).sort((a, b) =>
        String(a.battalion_code || '').localeCompare(String(b.battalion_code || ''), undefined, { numeric: true })
    );
}

function normalizeKd2UnitName(rawValue) {
    const label = String(rawValue || '').trim();
    if (!label) return null;
    const match = label.match(/(\d+)$/);
    if (!match) return { label, unitSerial: NaN };
    const unitSerial = parseInt(match[1], 10);
    return { label, unitSerial };
}

function getRowCode(row) {
    if (isKD2Module()) {
        return row.work_center || row.station_code || row.category_code || '—';
    }
    return getStationCode(row.process_station, row.vehicle) || '—';
}

// Returns the stacked lines below the primary label in the Unit column for F200-KD2
// Order: battalion (top) is shown above vehicle_no in the cell via the td structure,
// so here we return unit_code (bottom line).
function getRowUnitMeta(row) {
    if (isKD2Module()) {
        const code = getUnitCode(row.vehicle, row.vehicle_no);
        return code ? `<br><span class="unit-code-badge">${esc(code)}</span>` : '';
    }
    const code = getUnitCode(row.vehicle, row.vehicle_no);
    return code ? `<br><span class="unit-code-badge">${esc(code)}</span>` : '';
}

// Dynamic table filter definitions per module
function getTableFilterFields() {
    if (isF100KD2Module()) return [
        { field: 'vehicle',   label: 'Vehicle',   match: r => [r.vehicle_type] },
        { field: 'unit',      label: 'Unit',      match: r => [r.unit_code, r.unit_name, String(r.serial_number ?? '')] },
        { field: 'battalion', label: 'Battalion', match: r => [r.battalion_code] },
        { field: 'part',      label: 'Part',      match: r => [r.part_name, r.part_number] },
        { field: 'process',   label: 'Process',   match: r => [r.process_name] },
        { field: 'status',    label: 'Status',    match: r => [calculateStatus(r)] },
    ];
    return [
        { field: 'vehicle',   label: 'Vehicle',   match: r => [r.vehicle] },
        { field: 'unit',      label: 'Unit',      match: r => [r.vehicle_no, r.unit_label, getUnitCode(r.vehicle, r.vehicle_no)] },
        { field: 'battalion', label: 'Battalion', match: r => [r.battalion_code] },
        { field: 'week',      label: 'Week',      match: r => [r.week] },
        { field: 'station',   label: 'Station',   match: r => [r.process_station] },
        { field: 'code',      label: 'Code',      match: r => [getRowCode(r)] },
        { field: 'status',    label: 'Status',    match: r => [calculateStatus(r)] },
    ];
}

// Apply all active dynamic filters on top of a base dataset
function applyTableSearchFilters(base) {
    if (!_tableFilters.length) return base;
    return base.filter(row =>
        _tableFilters.every(f => {
            if (!f.value) return true;
            const q = f.value.toLowerCase();
            const fields = getTableFilterFields();
            const def = fields.find(d => d.field === f.field);
            if (!def) return true;
            return def.match(row).some(v => (v || '').toString().toLowerCase().includes(q));
        })
    );
}

let db = null;
let barChartInst = null;
let lineChartInst = null;
let currentData = [];      // flat merged rows
let _f100TableView = 'vehicle'; // 'vehicle' | 'part' | 'process'
let _kd2TableView  = 'unit'; // 'battalion' | 'vehicle' | 'unit' | 'station'
let _tableFilters  = [];          // [{ id, field, fieldLabel, value }]
let _filterSeq     = 0;           // unique id counter for filter chips
let unitCodeMap = {};      // { 'K9||M1': 'EGY N25020', ... }
let unitRegistryRows = [];
let vpxDelayReasonMap = {}; // { 'K9||M1': { id: <kd2_vehicle_units.id>, reason: 'text' }, ... } — KD2 only
let activePlanId = null;    // plan row being marked complete

/* ──────────────────────────────────────────────────────────────────
   3. ENTRY POINT
   ────────────────────────────────────────────────────────────────── */
async function initializeApp() {
    // ── Auth guard — redirect to login if no valid session ───────────
    if (!getCurrentUser()) { window.location.replace(window.location.pathname.replace(/\/[^/]*$/, '/') + 'login.html'); return; }
    populateNavbar();

    startClock();

    // Init Supabase client
    try {
        const _noopStorage = {
            getItem: () => null,
            setItem: () => { },
            removeItem: () => { },
        };
        db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
                storage: _noopStorage,
            },
        });
        setConnStatus('connected', 'Connected');
    } catch (err) {
        setConnStatus('error', 'Connection Error');
        showToast('Failed to initialise Supabase. Check your credentials.', 'error');
        console.error(err);
        return;
    }

    wireEvents();
    _loadExportPermissions().then(() => _applyExportVisibility()).catch(() => {});
    getModuleRuntime()?.initialize?.(db, {
        reloadAll: async () => {
            await loadFilters();
            await loadData();
        },
    });

    applyUserTheme();          // restore this user's personal theme before first render
    await loadFilters();
    await loadData();
    await getModuleRuntime()?.refreshWorkspace?.();
    startRealtimeSync();
    startCommentNotifSync();
    startPresenceTracking();

    // Issues section — explicit init after app is fully ready
    if (typeof initIssuesSection === 'function') {
        window._issuesSectionModule = getActiveModuleId();
        initIssuesSection().catch(e => console.warn('initIssuesSection:', e));
    }
    startIssueNotifSync();
    startIssuesPoll();
    startExportPermSync();
}

let _realtimeChannel = null;
let _realtimePending = false;
let _lastLocalSaveMs = 0; // timestamp of most recent local write — suppress echo toast

function markLocalSave() { _lastLocalSaveMs = Date.now(); }

function startRealtimeSync() {
    if (_realtimeChannel) {
        try { db.removeChannel(_realtimeChannel); } catch {}
        _realtimeChannel = null;
    }

    if (!isF100KD2Module()) return;

    _realtimeChannel = db
        .channel('f100_plans_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'f100_plans' }, (payload) => {
            if (_realtimePending) return;
            _realtimePending = true;
            setTimeout(async () => {
                _realtimePending = false;
                const isEcho = (Date.now() - _lastLocalSaveMs) < 3000;
                // Own saves: skip full reload — the in-memory data is already patched
                if (isEcho) return;
                // If a date input is focused, skip to avoid losing the user's input
                const activeDateInput = document.activeElement?.matches?.('.inline-date-input, .inline-end-input');
                if (activeDateInput) return;
                // Try surgical update using the payload data — avoids full table rebuild
                const record = payload?.new;
                if (record?.id) {
                    const idx = currentData.findIndex(r => String(r.id) === String(record.id));
                    if (idx >= 0) {
                        currentData[idx] = { ...currentData[idx], ...record };
                        const surgicalOk = updateF100TableRowInPlace(record.id);
                        if (surgicalOk) {
                            showToast('Plan updated by another user.', 'info');
                            return;
                        }
                    }
                }
                // Fallback: full reload with scroll preservation
                const pos = saveScrollPos();
                await loadData();
                restoreScrollPos(pos);
                showToast('Plan updated by another user.', 'info');
            }, 800);
        })
        .subscribe();
}

// ── Cross-module comment notification real-time sync ─────────────
// Listens to comment updates on BOTH kd2_plan and f100_plans so notifications
// appear immediately for all users regardless of which module they are in.
let _commentNotifChannels = [];

function startCommentNotifSync() {
    _commentNotifChannels.forEach(ch => { try { db.removeChannel(ch); } catch {} });
    _commentNotifChannels = [];
    const user = getCurrentUser();
    if (!user || !db) return;
    const myName = user?.name || user?.email || '';

    function handleCommentUpdate(moduleId, row) {
        const comments = row?.comments;
        if (!Array.isArray(comments)) return;

        // Patch in-memory data so popovers opened afterwards show fresh comments
        const dataIdx = currentData.findIndex(r => String(r.id) === String(row.id));
        if (dataIdx >= 0) {
            currentData[dataIdx] = { ...currentData[dataIdx], comments };
            // Update comment count badge on the button
            const commentBtn = document.querySelector(`.btn-f100-comment[data-plan-id="${row.id}"]`);
            if (commentBtn) {
                const countEl = commentBtn.querySelector('.f100-comment-count');
                if (comments.length > 0) {
                    if (countEl) countEl.textContent = comments.length;
                    else commentBtn.insertAdjacentHTML('beforeend', `<span class="f100-comment-count">${comments.length}</span>`);
                } else if (countEl) countEl.remove();
                commentBtn.title = `${comments.length} comment${comments.length !== 1 ? 's' : ''}`;
                // If the popover for this plan is currently open, refresh it
                const openPopover = document.querySelector(`.f100-comments-popover[data-plan-id="${row.id}"]`);
                if (openPopover) commentBtn.click();
            }
        }

        const snapKey = _notifSnapKey(moduleId);
        let snap;
        try { snap = JSON.parse(localStorage.getItem(snapKey) || '[]'); } catch { snap = []; }
        const existingKeys = new Set(snap.map(n => n.key));
        let added = false;
        comments.forEach(c => {
            if (!c?.at || c.user === myName) return;
            const key = _notifKey(row.id, c);
            if (!existingKeys.has(key)) {
                snap.push({
                    key, planId: row.id, comment: c, moduleId,
                    rowInfo: {
                        vehicle:  row.vehicle_type || row.vehicle    || '',
                        unit:     row.unit_label   || row.vehicle_no || '',
                        process:  row.station_code || row.process_station || '',
                    },
                });
                existingKeys.add(key);
                added = true;
            }
        });
        if (added) {
            try { localStorage.setItem(snapKey, JSON.stringify(snap)); } catch {}
            updateNotifBadge();
        }
    }

    const kd2Ch = db.channel('ppms-kd2-comment-notif')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'kd2_plan' }, ({ new: row }) => {
            handleCommentUpdate('kd2', row);
        })
        .subscribe();

    const f100Ch = db.channel('ppms-f100-comment-notif')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'f100_plans' }, ({ new: row }) => {
            handleCommentUpdate('f100kd2', row);
        })
        .subscribe();

    _commentNotifChannels = [kd2Ch, f100Ch];
}

/* ── Active-user broadcast heartbeat (master admin view) ────────── */
// Supabase Presence is unreliable with anon-only clients.
// Instead each user broadcasts a heartbeat every 30 s on a broadcast channel.
// Master admin keeps a local map of who sent a heartbeat in the last 90 s.
let _presenceChannel = null;
let _presenceOnlineMap = {};   // { userId: { name, email, role, ts } }
let _heartbeatTimer   = null;

function startPresenceTracking() {
    const user = getCurrentUser();
    if (!user || !db) return;

    if (_presenceChannel) {
        try { db.removeChannel(_presenceChannel); } catch {}
        _presenceChannel = null;
    }
    if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }

    _presenceOnlineMap = {};

    const myId   = String(user.id || user.email);
    const myInfo = {
        id:    myId,
        name:  user.name  || user.email,
        email: user.email,
        role:  user.role,
        joined: Date.now(),   // session start — stays fixed in each user's myInfo
    };

    function pruneAndRender() {
        const cutoff = Date.now() - 90_000; // 90 s
        Object.keys(_presenceOnlineMap).forEach(k => {
            if ((_presenceOnlineMap[k].ts || 0) < cutoff) delete _presenceOnlineMap[k];
        });
        _renderActiveUsers(Object.values(_presenceOnlineMap));
    }

    function sendHeartbeat() {
        _presenceChannel?.send({
            type: 'broadcast',
            event: 'hb',
            payload: { ...myInfo, ts: Date.now(), moduleId: getActiveModuleId() },
        }).catch(() => {});
    }

    _presenceChannel = db.channel('ppms-hb', {
        config: { broadcast: { self: true, ack: false } },
    });

    _presenceChannel
        .on('broadcast', { event: 'hb' }, ({ payload }) => {
            if (!payload?.id) return;
            _presenceOnlineMap[payload.id] = payload;
            pruneAndRender();
        })
        .on('broadcast', { event: 'ping' }, () => {
            // Another user just connected — respond immediately so they see us right away
            sendHeartbeat();
        })
        .subscribe((status) => {
            if (status !== 'SUBSCRIBED') return;
            // Announce self immediately, then every 30 s
            _presenceOnlineMap[myId] = { ...myInfo, ts: Date.now() };
            pruneAndRender();
            sendHeartbeat();
            // Ask all already-connected users to respond with their heartbeat now
            _presenceChannel?.send({ type: 'broadcast', event: 'ping', payload: { from: myId } }).catch(() => {});
            _heartbeatTimer = setInterval(() => { sendHeartbeat(); pruneAndRender(); }, 30_000);
        });
}

function _renderActiveUsers(users) {
    if (!isMasterAdmin()) return;
    const wrap   = document.getElementById('activeUsersWrap');
    const countEl = document.getElementById('activeUsersCount');
    if (!wrap) return;
    wrap.style.display = 'flex';
    if (countEl) countEl.textContent = users.length;
}

function openActiveUsersDropdown() {
    document.querySelectorAll('.active-users-dropdown').forEach(d => d.remove());
    // Use module-level map (rebuilt from presence sync/join/leave events)
    const users = Object.values(_presenceOnlineMap).flat();
    const me = getCurrentUser();

    const dropdown = document.createElement('div');
    dropdown.className = 'active-users-dropdown f100-notif-dropdown';

    function _fmtDuration(ms) {
        const m = Math.floor(ms / 60_000);
        if (m < 1)  return 'just now';
        if (m < 60) return m + 'm';
        const h = Math.floor(m / 60);
        const rm = m % 60;
        return rm ? h + 'h ' + rm + 'm' : h + 'h';
    }

    dropdown.innerHTML = `
        <div class="f100-notif-hdr" style="padding:10px 14px 8px">
            <span style="font-weight:700;font-size:.82rem">Active Users</span>
            <span style="font-size:.72rem;color:var(--clr-text-muted)">${users.length} online</span>
        </div>
        <div style="max-height:300px;overflow-y:auto">
            ${users.map(u => {
                const isMe = u.id === (me?.id || me?.email);
                const roleLabels = { master_admin: 'Master Admin', admin: 'Admin', planner: 'Planner', viewer: 'Viewer' };
                const roleLbl = roleLabels[u.role] || u.role || '';
                const initials = (u.name || u.email || '?').charAt(0).toUpperCase();
                const loginTime  = u.joined ? new Date(u.joined).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                const sessionDur = u.joined ? _fmtDuration(Date.now() - u.joined) : '';
                const modLbl = u.moduleId ? _moduleLabel(u.moduleId) : '';
                return `<div class="au-row" style="align-items:flex-start;padding:10px 14px;gap:10px">
                    <div class="au-avatar" style="margin-top:2px;flex-shrink:0">${initials}</div>
                    <div class="au-info" style="flex:1;min-width:0">
                        <div style="display:flex;align-items:center;gap:6px">
                            <span class="au-name" style="font-weight:600">${u.name || u.email || '—'}${isMe ? ' <span style="color:var(--clr-text-muted);font-weight:400">(you)</span>' : ''}</span>
                            ${modLbl ? `<span style="display:inline-block;padding:1px 5px;border-radius:4px;background:rgba(59,130,246,.12);color:#3b82f6;font-size:.63rem;font-weight:600;flex-shrink:0">${modLbl}</span>` : ''}
                        </div>
                        <span style="display:block;font-size:.71rem;color:var(--clr-text-muted);margin-top:1px">${u.email || ''}</span>
                        <span style="display:block;font-size:.71rem;color:var(--clr-text-muted);margin-top:3px">
                            ${roleLbl} · Logged in ${loginTime}${sessionDur ? ' · ' + sessionDur : ''}
                        </span>
                    </div>
                    <span class="au-dot" style="flex-shrink:0;margin-top:6px"></span>
                </div>`;
            }).join('') || '<div style="padding:12px 14px;color:var(--clr-text-muted);font-size:.78rem">No users online</div>'}
        </div>
    `;

    const btn = document.getElementById('activeUsersBtn');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    dropdown.style.cssText = `position:fixed;top:${rect.bottom + 6}px;right:${window.innerWidth - rect.right}px;z-index:10000;min-width:240px`;
    document.body.appendChild(dropdown);

    setTimeout(() => document.addEventListener('click', function handler(ev) {
        if (!dropdown.contains(ev.target) && ev.target !== btn) {
            dropdown.remove();
            document.removeEventListener('click', handler);
        }
    }), 0);
}

function wireActiveUsersBtn() {
    document.getElementById('activeUsersBtn')?.addEventListener('click', openActiveUsersDropdown);
}

/* ──────────────────────────────────────────────────────────────────
   4. FILTERS
   ────────────────────────────────────────────────────────────────── */
async function loadFilters() {
    try {
        if (isKD2Module() && getModuleRuntime()?.loadFilters) {
            const kd2Filters = await getModuleRuntime().loadFilters(db);
            populateSelect('filterBattalion', kd2Filters.battalions || [], 'All Battalions');
            populateSelect('filterVehicle', kd2Filters.vehicles, 'All Vehicles');
            populateSelect('filterWeek', kd2Filters.weeks, 'All Weeks');
            populateCategorySelect(kd2Filters.categories || []);
            await loadUnitCodes();
            populateUnitFilter(null);
            await getModuleRuntime().loadPlanningSnapshot?.(db);
            return;
        }

        // Paginate to get all vehicles/weeks (same 1000-row limit applies)
        let plans = [];
        let fFrom = 0;
        while (true) {
            const { data: page, error } = await db
                .from('assembly_plan')
                .select('vehicle, vehicle_no, start_date, week')
                .range(fFrom, fFrom + 999);
            if (error) throw error;
            if (!page?.length) break;
            plans = plans.concat(page);
            if (page.length < 1000) break;
            fFrom += 1000;
        }

        await loadUnitCodes();
        const vehicles = [...new Set([
            ...plans.map(r => r.vehicle),
            ...unitRegistryRows.map(r => r.vehicle),
        ].filter(Boolean))].sort(vehicleSort);
        const weeks = [...new Set(plans.map(r => r.start_date ? weekLabel(r.start_date) : r.week).filter(Boolean))]
            .sort((a, b) => parseInt(a.replace(/[^0-9]/g, ''), 10) - parseInt(b.replace(/[^0-9]/g, ''), 10));

        populateSelect('filterVehicle', vehicles, 'All Vehicles');
        populateSelect('filterWeek', weeks, 'All Weeks');
        populateUnitFilter(null);

    } catch (err) {
        showToast('Failed to load filter options.', 'error');
        console.error(err);
    }
}

function populateSelect(id, values, placeholder) {
    const sel = document.getElementById(id);
    const currentVal = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    values.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
}

/** Load vehicle_units table into unitCodeMap */
async function loadUnitCodes() {
    try {
        unitCodeMap = {};
        unitRegistryRows = [];
        vpxDelayReasonMap = {};
        if (isKD2Module()) {
            // delay_reason may not exist yet on a not-yet-migrated database —
            // retry without it rather than losing unit codes entirely.
            const UNIT_COLS = 'id, battalion_id, vehicle_type, unit_serial, unit_label, unit_code, delay_reason';
            let unitsResult = await db.from('kd2_vehicle_units').select(UNIT_COLS);
            if (unitsResult.error) {
                const retryPayload = _stripUndefinedColumn({ delay_reason: null }, unitsResult.error);
                if (retryPayload) {
                    unitsResult = await db.from('kd2_vehicle_units').select(UNIT_COLS.replace(', delay_reason', ''));
                }
            }
            const { data: units, error: unitsError } = unitsResult;
            const { data: battalions, error: battalionError } = await db.from('kd2_battalions').select('id, battalion_code');
            if (unitsError) throw unitsError;
            if (battalionError) throw battalionError;
            const battalionMap = Object.fromEntries((battalions || []).map(row => [row.id, row.battalion_code]));
            (units || []).forEach(r => {
                const code = r.unit_code || '';
                const battalionCode = battalionMap[r.battalion_id] || '';
                const fallbackLabel = battalionCode
                    ? `${battalionCode} / ${r.vehicle_type}-${String(r.unit_serial).padStart(2, '0')}`
                    : `${r.vehicle_type}-${String(r.unit_serial).padStart(2, '0')}`;
                const key1 = r.unit_label ? r.vehicle_type + '||' + r.unit_label : null;
                const key2 = r.vehicle_type + '||' + fallbackLabel;
                if (key1) unitCodeMap[key1] = code;
                unitCodeMap[key2] = code;
                const drEntry = { id: r.id, reason: r.delay_reason || '' };
                if (key1) vpxDelayReasonMap[key1] = drEntry;
                vpxDelayReasonMap[key2] = drEntry;
                unitRegistryRows.push({
                    battalion_id: r.battalion_id,
                    battalion_code: battalionCode || '—',
                    vehicle: r.vehicle_type,
                    vehicle_type: r.vehicle_type,
                    vehicle_no: r.unit_label || fallbackLabel,
                    unit_serial: r.unit_serial,
                    unit_label: r.unit_label || fallbackLabel,
                    unit_code: code,
                });
            });
            return;
        }

        const { data, error } = await db.from('vehicle_units').select('vehicle, vehicle_no, unit_code');
        if (error) throw error;
        (data || []).forEach(r => {
            unitCodeMap[r.vehicle + '||' + r.vehicle_no] = r.unit_code || '';
            unitRegistryRows.push({
                vehicle: r.vehicle,
                vehicle_no: r.vehicle_no,
                unit_code: r.unit_code || '',
            });
        });
    } catch (e) {
        console.warn('Unit codes table not found or error — unit codes disabled:', e.message);
        unitCodeMap = {};
        unitRegistryRows = [];
        vpxDelayReasonMap = {};
    }
}

function getRegisteredUnitNames(vehicle = null, fallbackRows = currentData) {
    return [...new Set([
        ...unitRegistryRows
            .filter(row => !vehicle || row.vehicle === vehicle)
            .map(row => row.vehicle_no),
        ...((fallbackRows || [])
            .filter(row => !vehicle || row.vehicle === vehicle)
            .map(row => row.vehicle_no)),
    ].filter(Boolean))].sort(naturalSort);
}

/** Populate unit filter. When vehicle is given, shows "M1 · code"; otherwise shows "K9 · M1 · code"
 *  so the vehicle context is always captured in data-vehicle for correct filtering. */
function populateUnitFilter(vehicle = null) {
    const sel = document.getElementById('filterUnit');
    const prevVal = sel.value;
    const prevVehicle = sel.options[sel.selectedIndex]?.dataset?.vehicle || '';
    sel.innerHTML = '<option value="">All Units</option>';

    const pairs = [];
    const seen = new Set();
    [...unitRegistryRows, ...(currentData || [])].forEach(r => {
        const v = r.vehicle || r.vehicle_type || '';
        const u = r.vehicle_no || '';
        if (!v || !u) return;
        if (vehicle && v !== vehicle) return;
        const key = v + '||' + u;
        if (!seen.has(key)) { seen.add(key); pairs.push({ v, u }); }
    });
    pairs.sort((a, b) => {
        const vc = vehicleSort(a.v, b.v);
        return vc !== 0 ? vc : naturalSort(a.u, b.u);
    });

    pairs.forEach(({ v, u }) => {
        const code = unitCodeMap[v + '||' + u] || '';
        const opt = document.createElement('option');
        opt.value = u;
        opt.dataset.vehicle = v;
        const base = code ? u + ' · ' + code : u;
        opt.textContent = vehicle ? base : v + ' · ' + base;
        sel.appendChild(opt);
    });

    if (prevVal) {
        const idx = [...sel.options].findIndex(o => o.value === prevVal && o.dataset.vehicle === prevVehicle);
        if (idx >= 0) sel.selectedIndex = idx;
        else {
            const fallback = [...sel.options].findIndex(o => o.value === prevVal);
            if (fallback >= 0) sel.selectedIndex = fallback;
        }
    }
}

/** Called when filterVehicle changes — cascade unit dropdown */
function onVehicleFilterChange() {
    const vehicle = getVal('filterVehicle');
    populateUnitFilter(vehicle || null);
    
    // Show K9 component filter only when K9 is selected
    const k9ComponentGroup = document.getElementById('filterK9ComponentGroup');
    if (k9ComponentGroup) {
        k9ComponentGroup.style.display = vehicle === 'K9' ? 'flex' : 'none';
        if (vehicle !== 'K9') {
            setVal('filterK9Component', '');
        }
    }
}

/* ──────────────────────────────────────────────────────────────────
   5. DATA LOADING
   ────────────────────────────────────────────────────────────────── */

/** Save current table scroll position and return it */
function saveScrollPos() {
    // The scrollable element is `.table-responsive` (overflow-y:auto) — this
    // used to look for #tableWrap/.table-scroll-wrap, neither of which exists
    // in the actual markup, so this silently did nothing.
    const wrap = document.querySelector('.table-responsive');
    return { top: wrap?.scrollTop || 0, left: wrap?.scrollLeft || 0, el: wrap };
}
/** Restore scroll position (deferred to after DOM paint) */
function restoreScrollPos(pos) {
    if (!pos?.el) return;
    requestAnimationFrame(() => {
        pos.el.scrollTop = pos.top;
        pos.el.scrollLeft = pos.left;
    });
}

/**
 * Re-render all derived views (table, summary, charts, VPX, Gantt)
 * from currentData without touching the DB.  Always preserves scroll.
 * Call this after any in-memory mutation of currentData.
 */
function refreshAllViews() {
    const category = getVal('filterCategory');
    const displayData = category
        ? currentData.filter(r => getModuleCategory(r.process_station, r) === category)
        : currentData;

    const pos = saveScrollPos();
    renderTable(applyTableSearchFilters(displayData));
    restoreScrollPos(pos);

    updateSummary(displayData);
    renderCharts(displayData);
    renderVPX(displayData);
    if (isKD2Module()) {
        // Ensure KD2 schedule uses the same filtered view as other components
        getModuleRuntime()?.renderSchedule?.(displayData);
    }

    const gsEl = document.getElementById('ganttStart');
    const geEl = document.getElementById('ganttEnd');
    if (!gsEl?.value || !geEl?.value) setGanttRangeFromData(displayData);
    renderGantt(displayData, gsEl?.value, geEl?.value);
}

/* ──────────────────────────────────────────────────────────────────
   F100-KD2 DATA LOADING
   ────────────────────────────────────────────────────────────────── */

async function populateF100GunPartFilter() {
    const sel = document.getElementById('f100GunPart');
    if (!sel) return;
    try {
        const { data, error } = await db
            .from('f100_parts')
            .select('id, part_name, part_number')
            .eq('module', 'gun')
            .order('sort_order');
        if (error) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">All Parts</option>';
        (data || []).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.part_name} (${p.part_number})`;
            sel.appendChild(opt);
        });
        if ([...sel.options].some(o => o.value === current)) sel.value = current;
    } catch (e) {
        console.warn('F100 gun part filter load failed:', e.message);
    }
}

async function populateF100BattalionFilter() {
    const sel = document.getElementById('f100Battalion');
    if (!sel) return;
    try {
        const { data, error } = await db
            .from('f100_battalions')
            .select('battalion_code, battalion_name')
            .order('battalion_code');
        if (error) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">All Battalions</option>';
        (data || []).forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.battalion_code;
            opt.textContent = b.battalion_name ? `${b.battalion_code} – ${b.battalion_name}` : b.battalion_code;
            sel.appendChild(opt);
        });
        if ([...sel.options].some(o => o.value === current)) sel.value = current;
    } catch (e) {
        console.warn('F100 battalion filter load failed:', e.message);
    }
}

async function loadF100Data() {
    const mode = document.getElementById('f100Mode')?.value || 'gun';

    // Sync secondary filter visibility
    const gunPartGroup = document.getElementById('f100GunPartGroup');
    const mfgGroup     = document.getElementById('f100ManufacturerGroup');
    const vtGroup      = document.getElementById('f100VehicleTypeGroup');
    const serialGroup  = document.getElementById('f100SerialGroup');
    if (gunPartGroup) gunPartGroup.style.display = mode === 'gun'     ? '' : 'none';
    if (mfgGroup)     mfgGroup.style.display     = mode === 'vehicle' ? '' : 'none';
    if (vtGroup)      vtGroup.style.display      = mode === 'vehicle' ? '' : 'none';
    if (serialGroup)  serialGroup.style.display  = mode === 'gun'     ? '' : 'none';

    await populateF100BattalionFilter();
    if (mode === 'gun') await populateF100GunPartFilter();

    const battalion    = getVal('f100Battalion') || null;
    const gunPart      = mode === 'gun'     ? (getVal('f100GunPart')      || null) : null;
    const manufacturer = mode === 'vehicle' ? (getVal('f100Manufacturer') || null) : null;
    const vehicleType  = mode === 'vehicle' ? (getVal('f100VehicleType')  || null) : null;
    const serialFilter = mode === 'gun'     ? (getVal('f100Serial')       || null) : null;

    // 1. Load matching parts
    let partsQ = db.from('f100_parts').select('*').eq('module', mode).order('sort_order');
    if (manufacturer) partsQ = partsQ.eq('manufacturer', manufacturer);
    const { data: parts, error: partsErr } = await partsQ;
    if (partsErr) throw partsErr;

    const partMap = {};
    (parts || []).forEach(p => { partMap[p.id] = p; });

    let partIds = Object.keys(partMap);
    if (mode === 'gun' && gunPart) partIds = [gunPart];

    if (!partIds.length) {
        currentData = [];
        renderTable([]);
        updateSummary([]);
        renderCharts([]);
        renderVPX([]);
        renderGantt([], '', '');
        return;
    }

    // 2. Load processes for these parts
    const { data: processes, error: procErr } = await db
        .from('f100_processes')
        .select('*')
        .in('part_id', partIds)
        .order('sort_order');
    if (procErr) throw procErr;

    const processMap = {};
    (processes || []).forEach(p => { processMap[p.id] = p; });

    // 3. Load plans — filtered by battalion, vehicle type, and serial if selected
    let plansQ = db.from('f100_plans').select('*').in('part_id', partIds);
    if (battalion)    plansQ = plansQ.eq('battalion_code', battalion);
    if (vehicleType)  plansQ = plansQ.eq('vehicle_type', vehicleType);
    if (serialFilter) plansQ = plansQ.eq('serial_number', parseInt(serialFilter, 10));
    // Gun mode always restricts to K9
    if (mode === 'gun') plansQ = plansQ.eq('vehicle_type', 'K9');
    const { data: plans, error: plansErr } = await plansQ;
    if (plansErr) throw plansErr;

    // 4. Load unit labels from f100_vehicle_units + f100_battalions
    const [{ data: vehicleUnits }, { data: battalionsList }] = await Promise.all([
        db.from('f100_vehicle_units').select('*'),
        db.from('f100_battalions').select('id, battalion_code'),
    ]);
    const batCodeById = {};
    (battalionsList || []).forEach(b => { batCodeById[b.id] = b.battalion_code; });
    const unitLabelMap = {};
    (vehicleUnits || []).forEach(u => {
        const bc = batCodeById[u.battalion_id];
        if (bc) unitLabelMap[`${bc}||${u.vehicle_type}||${u.unit_serial}`] = {
            unit_label: u.unit_label || '',
            unit_code:  u.unit_code  || '',
            unit_name:  u.unit_name  || '',
        };
    });

    // 4b. Populate serial (unit) dropdown for gun mode using K9 vehicle units
    if (mode === 'gun' && serialGroup) {
        const serialSel = document.getElementById('f100Serial');
        if (serialSel) {
            const batId = battalionsList?.find(b => b.battalion_code === battalion)?.id;
            const k9Units = (vehicleUnits || []).filter(u =>
                u.vehicle_type === 'K9' && (!batId || u.battalion_id === batId)
            ).sort((a, b) => (a.unit_serial ?? 0) - (b.unit_serial ?? 0));
            const prevVal = serialSel.value;
            serialSel.innerHTML = '<option value="">All Units</option>' +
                k9Units.map(u => {
                    const lbl = u.unit_label || u.unit_code || `Unit ${u.unit_serial}`;
                    return `<option value="${u.unit_serial}">${esc(lbl)}</option>`;
                }).join('');
            if (prevVal && [...serialSel.options].some(o => o.value === prevVal)) serialSel.value = prevVal;
        }
    }

    // 5. Flatten and normalize into display rows
    const rows = (plans || []).map(plan => {
        const part = partMap[plan.part_id] || {};
        const proc = processMap[plan.process_id] || {};
        return {
            id:                  plan.id,
            battalion_code:      plan.battalion_code,
            vehicle_type:        plan.vehicle_type,
            serial_number:       plan.serial_number,
            unit_label:          (unitLabelMap[`${plan.battalion_code}||${plan.vehicle_type}||${plan.serial_number}`] || {}).unit_label || '',
            unit_code:           (unitLabelMap[`${plan.battalion_code}||${plan.vehicle_type}||${plan.serial_number}`] || {}).unit_code  || '',
            unit_name:           (unitLabelMap[`${plan.battalion_code}||${plan.vehicle_type}||${plan.serial_number}`] || {}).unit_name  || '',
            part_id:             part.id,
            part_number:         part.part_number  || '',
            part_name:           part.part_name    || '',
            module:              part.module        || mode,
            manufacturer:        part.manufacturer  || '',
            vehicles:            part.vehicles      || [],
            qty_per_vehicle:     part.qty_per_vehicle || 1,
            part_sort:           part.sort_order    || 0,
            process_id:          proc.id,
            step_number:         proc.step_number   || 0,
            process_name:        proc.process_name  || '',
            process_sort:        proc.sort_order    || 0,
            planned_start_date:  plan.planned_start_date,
            planned_end_date:    plan.planned_end_date,
            actual_start_date:   plan.actual_start_date,
            actual_end_date:     plan.actual_end_date,
            status:              plan.status        || 'Planned',
            notes:               plan.notes         || '',
            comments:            Array.isArray(plan.comments) ? plan.comments : [],
            start_date:          plan.planned_start_date,
            end_date:            plan.planned_end_date,
        };
    }).sort((a, b) => {
        const bc = (a.battalion_code || '').localeCompare(b.battalion_code || '', undefined, { numeric: true });
        if (bc !== 0) return bc;
        const vc = vehicleSort(a.vehicle_type, b.vehicle_type);
        if (vc !== 0) return vc;
        const sc = (a.serial_number ?? 0) - (b.serial_number ?? 0);
        if (sc !== 0) return sc;
        const ps = a.part_sort - b.part_sort;
        if (ps !== 0) return ps;
        return a.process_sort - b.process_sort;
    });

    currentData = rows;
    renderTable(rows);
    updateSummary(rows);
    renderCharts(rows);
    renderVPX(rows);
    const gsEl = document.getElementById('ganttStart');
    const geEl = document.getElementById('ganttEnd');
    if (!gsEl?.value || !geEl?.value) setGanttRangeFromData(rows);
    renderGantt(rows, gsEl?.value, geEl?.value);
    saveNotifSnapshot();
    updateNotifBadge();
    checkNotifJump();
}

async function loadData() {
    try {
        setTableLoading(true);

        if (isF100KD2Module()) {
            await loadF100Data();
            return;
        }

        if (isKD2Module() && getModuleRuntime()?.loadData) {
            const week = getVal('filterWeek');
            const wr = week ? isoWeekDateRange(week) : null;
            const _unitSel = document.getElementById('filterUnit');
            const _unitVehicle = _unitSel?.options[_unitSel.selectedIndex]?.dataset?.vehicle || '';
            currentData = await getModuleRuntime().loadData(db, {
                vehicle: getVal('filterVehicle') || _unitVehicle,
                battalion: getVal('filterBattalion'),
                unit: getVal('filterUnit'),
                week,
                weekStartForFilter: wr?.weekStart || null,
                weekEndForFilter: wr?.weekEnd || null,
                timeFrame: getVal('filterTimeFrame'),
                today: todayStr(),
                ...currentWeekRange(),
                ...currentMonthRange(),
                startDate: getVal('filterStartDate'),
                endDate: getVal('filterEndDate'),
                k9Component: getVal('filterK9Component'),
            });

            currentData.sort((a, b) => {
                const vCmp = vehicleSort(a.vehicle, b.vehicle); if (vCmp !== 0) return vCmp;
                const uCmp = naturalSort(a.vehicle_no, b.vehicle_no); if (uCmp !== 0) return uCmp;
                const kd2Compare = getModuleRuntime()?.comparePlanRowsByLaneOrder;
                if (typeof kd2Compare === 'function') return kd2Compare(a, b);
                const rA = parseInt(a.route_sequence, 10) || 9999;
                const rB = parseInt(b.route_sequence, 10) || 9999;
                if (rA !== rB) return rA - rB;
                const wA = parseInt((a.week || '').replace(/\D/g, ''), 10) || 9999;
                const wB = parseInt((b.week || '').replace(/\D/g, ''), 10) || 9999;
                if (wA !== wB) return wA - wB;
                return (a.start_date || '').localeCompare(b.start_date || '');
            });

            const category = getVal('filterCategory');
            const displayData = category
                ? currentData.filter(r => getModuleCategory(r.process_station, r) === category)
                : currentData;

            renderTable(applyTableSearchFilters(displayData));
            updateSummary(displayData);
            renderCharts(displayData);
            renderVPX(displayData);
            await getModuleRuntime().loadPlanningSnapshot?.(db);
            await getModuleRuntime().refreshWorkspace?.();
            await getModuleRuntime().renderSchedule?.(currentData);
            const gsEl = document.getElementById('ganttStart');
            const geEl = document.getElementById('ganttEnd');
            if (!gsEl?.value || !geEl?.value) setGanttRangeFromData(displayData);
            renderGantt(displayData, gsEl?.value, geEl?.value);
            saveNotifSnapshot();
            updateNotifBadge();
            checkNotifJump();
            return;
        }

        // Build query
        let query = db
            .from('assembly_plan')
            .select(`
        id, vehicle, vehicle_no, process_station, week,
        start_date, end_date, remark,
        assembly_progress (
          id, completed, completion_date, actual_start_date, notes, updated_at
        )
      `);

        // Vehicle filter — also inherit from unit option's data-vehicle when vehicle filter is unset
        const _unitSelA = document.getElementById('filterUnit');
        const _unitVehicleA = _unitSelA?.options[_unitSelA.selectedIndex]?.dataset?.vehicle || '';
        const vehicle = getVal('filterVehicle') || _unitVehicleA;
        if (vehicle) query = query.eq('vehicle', vehicle);

        // Unit filter
        const unit = getVal('filterUnit');
        if (unit) query = query.eq('vehicle_no', unit);

        // Week filter — include all tasks whose date range overlaps the selected ISO week
        const week = getVal('filterWeek');
        if (week) {
            const wr = isoWeekDateRange(week);
            if (wr) {
                // Task overlaps week if: start_date <= weekEnd AND end_date >= weekStart
                query = query
                    .lte('start_date', wr.weekEnd)
                    .gte('end_date', wr.weekStart);
            }
        }

        // Time-frame filter
        const tf = getVal('filterTimeFrame');
        const today = todayStr();

        if (tf === 'day') {
            query = query.eq('start_date', today);

        } else if (tf === 'week') {
            const { weekStart, weekEnd } = currentWeekRange();
            query = query.gte('start_date', weekStart).lte('start_date', weekEnd);

        } else if (tf === 'month') {
            const { monthStart, monthEnd } = currentMonthRange();
            query = query.gte('start_date', monthStart).lte('start_date', monthEnd);

        } else if (tf === 'custom') {
            const sd = getVal('filterStartDate');
            const ed = getVal('filterEndDate');
            if (sd) query = query.gte('start_date', sd);
            if (ed) query = query.lte('end_date', ed);
        }

        // Supabase returns max 1000 rows by default — fetch all pages
        let allData = [];
        let from = 0;
        const PAGE = 1000;
        while (true) {
            const { data: page, error: pageErr } = await query.range(from, from + PAGE - 1);
            if (pageErr) throw pageErr;
            if (!page?.length) break;
            allData = allData.concat(page);
            if (page.length < PAGE) break;  // last page
            from += PAGE;
        }
        const data = allData;

        // Flatten progress — handle both array (old) and single object (new, after UNIQUE constraint)
        // PostgREST returns a single object instead of array when it detects a 1:1 relationship
        currentData = data.map(plan => {
            const raw = plan.assembly_progress;
            let prog = null;
            if (raw) {
                if (Array.isArray(raw)) {
                    // Legacy: array of rows — take most recently updated
                    if (raw.length > 0) {
                        prog = raw.slice().sort((a, b) =>
                            (b.updated_at || '').localeCompare(a.updated_at || '')
                        )[0];
                    }
                } else if (typeof raw === 'object') {
                    // PostgREST 1:1 mode: single object returned directly
                    prog = raw;
                }
            }
            return { ...plan, progress: prog };
        });

        // Sort: vehicle → unit → week (numeric FW01…) → planned start_date
        currentData.sort((a, b) => {
            const vCmp = vehicleSort(a.vehicle, b.vehicle); if (vCmp !== 0) return vCmp;
            const uCmp = naturalSort(a.vehicle_no, b.vehicle_no); if (uCmp !== 0) return uCmp;
            const wA = parseInt((a.week || '').replace(/\D/g, ''), 10) || 9999;
            const wB = parseInt((b.week || '').replace(/\D/g, ''), 10) || 9999;
            if (wA !== wB) return wA - wB;
            return (a.start_date || '').localeCompare(b.start_date || '');
        });

        // DEBUG: log category distribution to aid troubleshooting when filters return no rows
        try {
            const catCounts = {};
            currentData.forEach(r => {
                const c = getModuleCategory(r.process_station, r);
                catCounts[c] = (catCounts[c] || 0) + 1;
            });
            console.info('PPMS: categoryCounts', catCounts);
            const otherSamples = currentData.filter(r => getModuleCategory(r.process_station, r) === 'Other')
                .slice(0, 8)
                .map(r => ({ station: r.process_station, vehicle: r.vehicle, week: r.week }));
            if (otherSamples.length) console.warn('PPMS: sample process_station mapping to Other', otherSamples);
        } catch (e) {
            console.warn('PPMS: category debug failed', e.message || e);
        }

        // Category filter (client-side — maps process_station → category)
        const category = getVal('filterCategory');
        const displayData = category
            ? currentData.filter(r => getModuleCategory(r.process_station, r) === category)
            : currentData;

        renderTable(displayData);
        updateSummary(displayData);
        renderCharts(displayData);
        renderVPX(displayData);   // use same filtered data as table/charts

        // Auto-set gantt range from data on first load or when inputs are empty
        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        if (!gsEl?.value || !geEl?.value) setGanttRangeFromData(displayData);
        renderGantt(displayData, gsEl?.value, geEl?.value);
        saveNotifSnapshot();
        updateNotifBadge();
        checkNotifJump();

        // Production Issues — reload when module switches
        if (typeof loadIssues === 'function' && window._issuesSectionModule !== undefined) {
            const _mod = getActiveModuleId();
            if (window._issuesSectionModule !== _mod) {
                window._issuesSectionModule = _mod;
                const _repSel = document.getElementById('issueFilterReporter');
                if (_repSel) { while (_repSel.options.length > 1) _repSel.remove(1); }
                _populateIssueReporterFilter().catch(() => {}).finally(() => loadIssues(true).catch(() => {}));
            }
        }

    } catch (err) {
        showToast('Error loading data: ' + err.message, 'error');
        console.error(err);
    } finally {
        setTableLoading(false);
    }
}

/* ──────────────────────────────────────────────────────────────────
   6. STATUS CALCULATION
   ────────────────────────────────────────────────────────────────── */
function calculateStatus(row) {
    // F100: compute dynamically so Overdue is detected even without a DB write
    if (row.module === 'gun' || row.module === 'vehicle') {
        const today = todayStr();
        const actualEnd   = row.actual_end_date   || null;
        const actualStart = row.actual_start_date || null;
        const plannedEnd  = row.planned_end_date  || null;
        if (actualEnd && plannedEnd && actualEnd <= plannedEnd) return 'Completed';
        if (actualEnd && plannedEnd && actualEnd >  plannedEnd) return 'Late Completion';
        if (!actualEnd && plannedEnd && today > plannedEnd)     return 'Overdue';
        if (!actualEnd && actualStart)                          return 'In Progress';
        return 'Planned';
    }

    const today = todayStr();
    const completed = row.progress?.completed || false;
    const compDate = row.progress?.completion_date || null;
    const actualStart = row.progress?.actual_start_date || null;
    const endDate = row.end_date;

    // Completed on time: done and finished by the planned end date
    if (completed && compDate && compDate <= endDate) return 'Completed';
    // Late: done but finished after the planned end date
    if (completed && compDate && compDate > endDate) return 'Late Completion';
    // Overdue: not done and today is past the planned end date
    if (!completed && today > endDate) return 'Overdue';
    // In Progress: actual start date has been entered but not yet complete
    if (!completed && actualStart) return 'In Progress';
    // Planned: nothing recorded yet
    return 'Planned';
}

function ganttHighlightState(row) {
    // F100 uses status string directly
    if (row.module === 'gun' || row.module === 'vehicle') {
        const s = calculateStatus(row);
        if (s === 'Completed') return 'complete';
        if (s === 'Late Completion') return 'late-complete';
        if (s === 'Overdue') return 'late';
        if (s === 'In Progress') return 'progress';
        return 'planned';
    }

    const completed = row.progress?.completed || false;
    const compDate = row.progress?.completion_date || null;
    const actualStart = row.progress?.actual_start_date || null;
    const endDate = row.end_date;
    const today = todayStr();

    if (completed && compDate && compDate < endDate) return 'early';
    if (completed && compDate && compDate > endDate) return 'late-complete';
    if (!completed && today > endDate) return 'late';
    if (!completed && actualStart) return 'progress';
    if (completed && compDate) return 'complete';
    return 'planned';
}

function delayDays(row) {
    // F100 rows store dates directly (no progress sub-object)
    if (row.module === 'gun' || row.module === 'vehicle') {
        const plannedEnd   = row.planned_end_date;
        const plannedStart = row.planned_start_date;
        const actualEnd    = row.actual_end_date;
        const actualStart  = row.actual_start_date;
        const today        = todayStr();
        const status       = calculateStatus(row);
        if ((status === 'Completed' || status === 'Late Completion') && actualEnd && actualEnd > plannedEnd)
            return daysBetween(plannedEnd, actualEnd);
        if (status === 'Overdue' && today > plannedEnd)
            return daysBetween(plannedEnd, today);
        if (status === 'In Progress' && actualStart && actualStart > plannedStart)
            return daysBetween(plannedStart, actualStart);
        return 0;
    }

    const completed = row.progress?.completed || false;
    const compDate = row.progress?.completion_date || null;
    const actualStart = row.progress?.actual_start_date || null;
    const plannedStart = row.start_date;
    const endDate = row.end_date;
    const today = todayStr();

    // Completed late: how many days after end date it was finished
    if (completed && compDate && compDate > endDate) {
        return daysBetween(endDate, compDate);
    }
    // Overdue: how many days past the end date without completion
    if (!completed && today > endDate) {
        return daysBetween(endDate, today);
    }
    // In Progress but started late: show start delay as a warning
    if (!completed && actualStart && actualStart > plannedStart) {
        return daysBetween(plannedStart, actualStart);
    }
    return 0;
}

/* ──────────────────────────────────────────────────────────────────
   7. TABLE RENDERING
   ────────────────────────────────────────────────────────────────── */

/**
 * Update a single F100 table row in-place without re-rendering the whole table.
 * Only touches: actual start, actual end, status badge, delay cells.
 * Returns true if the row was found and updated.
 */
function updateF100TableRowInPlace(planId) {
    const row = currentData.find(t => String(t.id) === String(planId));
    if (!row) return false;
    const tr = document.querySelector(`#mainTable tbody tr[data-plan-id="${planId}"]`);
    if (!tr) return false;

    const cells = tr.querySelectorAll('td');
    // Column order: Vehicle(0), Unit(1), Part(2), Step(3), Process(4),
    //               Planned Start(5), Planned End(6), Actual Start(7), Actual End(8),
    //               Status(9), Delay(10), Comments(11)

    const status = calculateStatus(row);
    const badgeCls = `badge badge-${status.toLowerCase().replace(/\s+/g, '-').replace('late-completion', 'late')}`;
    if (cells[9]) cells[9].innerHTML = `<span class="${badgeCls}">${status}</span>`;

    const delay = delayDays(row);
    const isDone = status === 'Completed' || status === 'Late Completion';
    let delayHtml;
    if (delay > 0 && (status === 'Late Completion' || status === 'Overdue'))
        delayHtml = `<span class="delay-positive">+${delay}d</span>`;
    else if (delay > 0 && status === 'In Progress')
        delayHtml = `<span class="delay-positive" title="Started ${delay}d late">+${delay}d start</span>`;
    else if (isDone && delay === 0)
        delayHtml = `<span class="delay-zero">On Time</span>`;
    else
        delayHtml = `<span class="delay-none">—</span>`;
    if (cells[10]) cells[10].innerHTML = delayHtml;

    const actualStart = row.actual_start_date || '';
    if (cells[7]) {
        cells[7].innerHTML = `<div class="inline-date-wrap">
            <input type="date" class="inline-date-input" data-plan-id="${row.id}" value="${actualStart}" title="Actual start date" />
            ${actualStart ? `<button class="inline-icon-btn inline-start-clear" data-plan-id="${row.id}" title="Clear">✕</button>` : ''}
        </div>`;
        cells[7].querySelector('.inline-date-input')?.addEventListener('change', function () {
            saveActualStart(this.dataset.planId, this.value);
        });
        cells[7].querySelector('.inline-start-clear')?.addEventListener('click', function () {
            saveActualStart(this.dataset.planId, '');
        });
    }

    const actualEnd = row.actual_end_date || '';
    if (cells[8]) {
        cells[8].innerHTML = `<div class="inline-date-wrap">
            <input type="date" class="inline-end-input" data-plan-id="${row.id}" value="${actualEnd}" title="Actual end date" />
            ${actualEnd ? `<button class="inline-icon-btn inline-end-clear" data-plan-id="${row.id}" title="Clear">✕</button>` : ''}
        </div>`;
        cells[8].querySelector('.inline-end-input')?.addEventListener('change', function () {
            saveCompletionDate(this.dataset.planId, this.value);
        });
        cells[8].querySelector('.inline-end-clear')?.addEventListener('click', function () {
            saveCompletionDate(this.dataset.planId, '');
        });
    }

    return true;
}

/** Surgical row patch for the general (KD2 / standard) table — mirrors
 *  updateF100TableRowInPlace so single-field edits (actual start /
 *  completion date) don't force a full tbody rebuild + scroll reset.
 *  Like the F100 version, this only patches the row itself — group
 *  progress bars, summary cards, charts and Gantt stay as-is until the
 *  next full refresh (module switch, filter change, realtime reload). */
function updateTableRowInPlace(planId) {
    const row = currentData.find(t => String(t.id) === String(planId));
    if (!row) return false;
    const tr = document.querySelector(`#mainTable tbody tr[data-plan-id="${planId}"]`);
    if (!tr) return false;

    const cells = tr.querySelectorAll('td');
    // Column order: Vehicle(0), Unit(1), Station(2), Code(3), Week(4),
    //               Planned Start(5), Planned End(6), Actual Start(7),
    //               Completed On(8), Status(9), Delay(10), Comments(11)

    const status = calculateStatus(row);
    const badgeCls = `badge badge-${status.toLowerCase().replace(' ', '-').replace('late-completion', 'late')}`;
    if (cells[9]) cells[9].innerHTML = `<span class="${badgeCls}">${status}</span>`;

    const delay = delayDays(row);
    let delayHtml;
    if (delay > 0 && (status === 'Late Completion' || status === 'Overdue')) {
        delayHtml = `<span class="delay-positive">+${delay}d</span>`;
    } else if (delay > 0 && status === 'In Progress') {
        delayHtml = `<span class="delay-positive" title="Started ${delay}d late">+${delay}d start</span>`;
    } else if (status === 'Completed' || status === 'Late Completion') {
        delayHtml = delay === 0 ? `<span class="delay-zero">On Time</span>` : `<span class="delay-positive">+${delay}d</span>`;
    } else {
        delayHtml = `<span class="delay-none">—</span>`;
    }
    if (cells[10]) cells[10].innerHTML = delayHtml;

    const actualStart = row.progress?.actual_start_date || '';
    if (cells[7]) {
        cells[7].innerHTML = `<div class="inline-date-wrap">
            <input type="date" class="inline-date-input" data-plan-id="${row.id}" value="${actualStart}" title="Actual start date" />
            ${actualStart ? `<button class="inline-icon-btn inline-start-clear" data-plan-id="${row.id}" title="Clear">✕</button>` : ''}
        </div>`;
        cells[7].querySelector('.inline-date-input')?.addEventListener('change', function () {
            saveActualStart(this.dataset.planId, this.value);
        });
        cells[7].querySelector('.inline-start-clear')?.addEventListener('click', function () {
            saveActualStart(this.dataset.planId, '');
        });
    }

    const compDate = row.progress?.completion_date || null;
    if (cells[8]) {
        cells[8].innerHTML = `<div class="inline-date-wrap">
            <input type="date" class="inline-end-input" data-plan-id="${row.id}" value="${compDate || ''}" title="Completion date" />
            ${compDate ? `<button class="inline-icon-btn inline-end-clear" data-plan-id="${row.id}" title="Clear">✕</button>` : ''}
        </div>`;
        cells[8].querySelector('.inline-end-input')?.addEventListener('change', function () {
            saveCompletionDate(this.dataset.planId, this.value);
        });
        cells[8].querySelector('.inline-end-clear')?.addEventListener('click', function () {
            saveCompletionDate(this.dataset.planId, '');
        });
    }

    return true;
}

function renderF100Table(data) {
    document.getElementById('kd2TableViewBar')?.remove();
    const tbl = document.getElementById('mainTable');
    const _f100TableCard = document.querySelector('.table-card');
    if (_f100TableCard) renderTableFilterBar(_f100TableCard);
    if (tbl) tbl.classList.add('f100-table');
    const thead = document.querySelector('#mainTable thead');
    if (thead) {
        thead.innerHTML = `
        <tr>
            <th>Vehicle</th>
            <th>Unit</th>
            <th>Part</th>
            <th class="mono">Step</th>
            <th>Process</th>
            <th class="mono">Planned Start</th>
            <th class="mono">Planned End</th>
            <th>Actual Start</th>
            <th>Actual End</th>
            <th>Status</th>
            <th>Delay</th>
            <th>Comments</th>
        </tr>`;
    }

    // Inject / update view-tab bar above the table card header
    const tableCard = document.querySelector('.table-card');
    let viewBar = document.getElementById('f100TableViewBar');
    if (tableCard && !viewBar) {
        viewBar = document.createElement('div');
        viewBar.id = 'f100TableViewBar';
        viewBar.className = 'f100-table-view-bar';
        viewBar.innerHTML = `
            <span class="f100-view-label">Group by:</span>
            <button class="f100-view-btn${_f100TableView === 'battalion' ? ' f100-view-btn-active' : ''}" data-view="battalion">Battalion</button>
            <button class="f100-view-btn${_f100TableView === 'vehicle'   ? ' f100-view-btn-active' : ''}" data-view="vehicle">Vehicle</button>
            <button class="f100-view-btn${_f100TableView === 'part'      ? ' f100-view-btn-active' : ''}" data-view="part">Part</button>
            <button class="f100-view-btn${_f100TableView === 'process'   ? ' f100-view-btn-active' : ''}" data-view="process">Process</button>`;
        tableCard.insertBefore(viewBar, tableCard.firstChild);
        viewBar.querySelectorAll('.f100-view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                _f100TableView = btn.dataset.view;
                const _cat = getVal('filterCategory');
                const _base = _cat ? currentData.filter(r => getModuleCategory(r.process_station, r) === _cat) : currentData;
                renderF100Table(applyTableSearchFilters(_base));
            });
        });
    } else if (viewBar) {
        // Update active state
        viewBar.querySelectorAll('.f100-view-btn').forEach(btn => {
            btn.classList.toggle('f100-view-btn-active', btn.dataset.view === _f100TableView);
        });
    }

    const tbody = document.getElementById('tableBody');
    document.getElementById('rowCount').textContent = `${data.length} record${data.length !== 1 ? 's' : ''}`;

    // Build completion maps per view
    const tblBatCompMap  = {};
    const tblCompMap     = {};
    const tblPartCompMap = {};
    const tblProcCompMap = {};
    data.forEach(r => {
        const rStatus = calculateStatus(r);
        const rDone = rStatus === 'Completed' || rStatus === 'Late Completion';

        const bk = r.battalion_code || '—';
        if (!tblBatCompMap[bk]) tblBatCompMap[bk] = { done: 0, total: 0 };
        tblBatCompMap[bk].total++;
        if (rDone) tblBatCompMap[bk].done++;

        const vk = `${r.battalion_code}||${r.vehicle_type}||${r.serial_number}`;
        if (!tblCompMap[vk]) tblCompMap[vk] = { done: 0, total: 0 };
        tblCompMap[vk].total++;
        if (rDone) tblCompMap[vk].done++;

        const pk = `${r.part_sort}||${r.part_name}`;
        if (!tblPartCompMap[pk]) tblPartCompMap[pk] = { done: 0, total: 0 };
        tblPartCompMap[pk].total++;
        if (rDone) tblPartCompMap[pk].done++;

        const prk = `${r.process_sort}||${r.step_number}||${r.process_name}`;
        if (!tblProcCompMap[prk]) tblProcCompMap[prk] = { done: 0, total: 0 };
        tblProcCompMap[prk].total++;
        if (rDone) tblProcCompMap[prk].done++;
    });

    if (!data.length) {
        tbody.innerHTML = `
        <tr>
            <td colspan="12" class="table-empty">
                <div class="empty-state">
                    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="6" width="36" height="36" rx="4"/><path d="M16 24h16M24 16v16"/></svg>
                    <p>No F100 plan records found.</p>
                </div>
            </td>
        </tr>`;
        wireF100TableEvents(tbody);
        return;
    }

    // Sort data depending on view
    let sorted;
    if (_f100TableView === 'battalion') {
        sorted = data.slice().sort((a, b) => {
            const bc = String(a.battalion_code || '').localeCompare(String(b.battalion_code || ''), undefined, { numeric: true });
            if (bc !== 0) return bc;
            const vc = vehicleSort(a.vehicle_type, b.vehicle_type);
            if (vc !== 0) return vc;
            const sc = (a.serial_number ?? 0) - (b.serial_number ?? 0);
            if (sc !== 0) return sc;
            return a.part_sort - b.part_sort;
        });
    } else if (_f100TableView === 'part') {
        sorted = data.slice().sort((a, b) => {
            const ps = a.part_sort - b.part_sort;
            if (ps !== 0) return ps;
            const vc = vehicleSort(a.vehicle_type, b.vehicle_type);
            if (vc !== 0) return vc;
            const sc = (a.serial_number ?? 0) - (b.serial_number ?? 0);
            if (sc !== 0) return sc;
            return a.process_sort - b.process_sort;
        });
    } else if (_f100TableView === 'process') {
        sorted = data.slice().sort((a, b) => {
            const ps = a.process_sort - b.process_sort;
            if (ps !== 0) return ps;
            const vc = vehicleSort(a.vehicle_type, b.vehicle_type);
            if (vc !== 0) return vc;
            return (a.serial_number ?? 0) - (b.serial_number ?? 0);
        });
    } else {
        // By vehicle (default — already sorted correctly from loadF100Data)
        sorted = data;
    }

    // Build rows with group headers
    let html = '';
    let rowNum = 0;
    let prevGroupKey = null;

    sorted.forEach(row => {
        // Compute group key for the current view
        let groupKey, groupHtml;
        if (_f100TableView === 'battalion') {
            groupKey = row.battalion_code || '—';
            if (groupKey !== prevGroupKey) {
                const comp = tblBatCompMap[groupKey] || { done: 0, total: 0 };
                const pct = comp.total > 0 ? Math.round((comp.done / comp.total) * 100) : 0;
                const pctBar = comp.total > 0
                    ? `<div class="f100-grp-pct-wrap"><div class="f100-grp-pct-bar" style="width:${pct}%"></div></div><span class="f100-grp-pct-text">${comp.done}/${comp.total} (${pct}%)</span>`
                    : '';
                groupHtml = `<tr class="f100-tbl-group-row f100-tbl-group-battalion">
                    <td colspan="12">
                        <svg style="width:13px;height:13px;vertical-align:middle;margin-right:5px;color:var(--clr-accent)" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 9h4M4 6h8M4 12h8"/></svg>
                        <strong>${esc(groupKey)}</strong>
                        ${pctBar}
                    </td>
                </tr>`;
            }
        } else if (_f100TableView === 'vehicle') {
            groupKey = `${row.battalion_code}||${row.vehicle_type}||${row.serial_number}`;
            if (groupKey !== prevGroupKey) {
                const comp = tblCompMap[groupKey] || { done: 0, total: 0 };
                const pct = comp.total > 0 ? Math.round((comp.done / comp.total) * 100) : 0;
                const pctBar = comp.total > 0
                    ? `<div class="f100-grp-pct-wrap"><div class="f100-grp-pct-bar" style="width:${pct}%"></div></div><span class="f100-grp-pct-text">${comp.done}/${comp.total} (${pct}%)</span>`
                    : '';
                groupHtml = `<tr class="f100-tbl-group-row f100-tbl-group-vehicle">
                    <td colspan="12">
                        <span class="f100-tbl-veh-badge">${esc(row.vehicle_type || '—')}</span>
                        <strong>${esc(row.unit_code || `#${row.serial_number ?? '?'}`)}</strong>
                        ${row.unit_name ? `<span class="f100-tbl-unit-name">${esc(row.unit_name)}</span>` : ''}
                        <span class="f100-tbl-bat-tag">${esc(row.battalion_code || '—')}</span>
                        ${pctBar}
                    </td>
                </tr>`;
            }
        } else if (_f100TableView === 'part') {
            groupKey = `${row.part_sort}||${row.part_name}`;
            if (groupKey !== prevGroupKey) {
                const comp = tblPartCompMap[groupKey] || { done: 0, total: 0 };
                const pct = comp.total > 0 ? Math.round((comp.done / comp.total) * 100) : 0;
                const pctBar = comp.total > 0
                    ? `<div class="f100-grp-pct-wrap"><div class="f100-grp-pct-bar" style="width:${pct}%"></div></div><span class="f100-grp-pct-text">${comp.done}/${comp.total} (${pct}%)</span>`
                    : '';
                groupHtml = `<tr class="f100-tbl-group-row f100-tbl-group-part">
                    <td colspan="12">
                        <span class="f100-tbl-part-icon">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="1" y="3" width="12" height="9" rx="1.5"/><path d="M4 3V2h6v1"/></svg>
                        </span>
                        <strong>${esc(row.part_name || '—')}</strong>
                        ${row.part_number ? `<span class="f100-tbl-bat-tag">${esc(row.part_number)}</span>` : ''}
                        ${pctBar}
                    </td>
                </tr>`;
            }
        } else {
            groupKey = `${row.process_sort}||${row.step_number}||${row.process_name}`;
            if (groupKey !== prevGroupKey) {
                const comp = tblProcCompMap[groupKey] || { done: 0, total: 0 };
                const pct = comp.total > 0 ? Math.round((comp.done / comp.total) * 100) : 0;
                const pctBar = comp.total > 0
                    ? `<div class="f100-grp-pct-wrap"><div class="f100-grp-pct-bar" style="width:${pct}%"></div></div><span class="f100-grp-pct-text">${comp.done}/${comp.total} (${pct}%)</span>`
                    : '';
                groupHtml = `<tr class="f100-tbl-group-row f100-tbl-group-process">
                    <td colspan="12">
                        <span class="f100-tbl-step-badge">#${row.step_number || '?'}</span>
                        <strong>${esc(row.process_name || '—')}</strong>
                        ${pctBar}
                    </td>
                </tr>`;
            }
        }

        if (groupKey !== prevGroupKey) {
            if (groupHtml) html += groupHtml;
            prevGroupKey = groupKey;
        }

        rowNum++;
        const status = calculateStatus(row); // dynamic so Overdue is detected even without a DB write
        const isDone = status === 'Completed' || status === 'Late Completion';

        const delay = delayDays(row);
        let delayHtml;
        if (delay > 0 && (status === 'Late Completion' || status === 'Overdue')) {
            delayHtml = `<span class="delay-positive">+${delay}d</span>`;
        } else if (delay > 0 && status === 'In Progress') {
            delayHtml = `<span class="delay-positive" title="Started ${delay}d late">+${delay}d start</span>`;
        } else if (isDone && delay === 0) {
            delayHtml = `<span class="delay-zero">On Time</span>`;
        } else {
            delayHtml = `<span class="delay-none">—</span>`;
        }

        const actualStart = row.actual_start_date || '';
        const startInputHtml = `<div class="inline-date-wrap">
            <input type="date" class="inline-date-input" data-plan-id="${row.id}" value="${actualStart}" title="Actual start date" />
            ${actualStart ? `<button class="inline-icon-btn inline-start-clear" data-plan-id="${row.id}" title="Clear">✕</button>` : ''}
        </div>`;

        const actualEnd = row.actual_end_date || '';
        const endInputHtml = `<div class="inline-date-wrap">
            <input type="date" class="inline-end-input" data-plan-id="${row.id}" value="${actualEnd}" title="Actual end date" />
            ${actualEnd ? `<button class="inline-icon-btn inline-end-clear" data-plan-id="${row.id}" title="Clear">✕</button>` : ''}
        </div>`;

        const comments = Array.isArray(row.comments) ? row.comments : [];
        const commentBtn = `<button class="btn-f100-comment" data-plan-id="${row.id}" title="${comments.length} comment${comments.length !== 1 ? 's' : ''}">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V3Z"/></svg>
            ${comments.length ? `<span class="f100-comment-count">${comments.length}</span>` : ''}
        </button>`;

        const badgeCls = `badge badge-${status.toLowerCase().replace(/\s+/g, '-').replace('late-completion', 'late')}`;
        const unitCell = [
            row.battalion_code ? `<span class="f100-tbl-bat-tag">${esc(row.battalion_code)}</span>`  : '',
            row.unit_name      ? `<span class="unit-main-label">${esc(row.unit_name)}</span>`         : '',
            row.unit_code      ? `<span class="unit-code-badge">${esc(row.unit_code)}</span>`         : '',
        ].filter(Boolean).join('') || '—';
        html += `<tr data-plan-id="${row.id}">
            <td>${esc(row.vehicle_type || '—')}</td>
            <td class="unit-cell">${unitCell}</td>
            <td>${esc(row.part_name || '—')}</td>
            <td class="mono">#${row.step_number || '?'}</td>
            <td>${esc(row.process_name || '—')}</td>
            <td class="mono">${formatDate(row.planned_start_date)}</td>
            <td class="mono">${formatDate(row.planned_end_date)}</td>
            <td>${startInputHtml}</td>
            <td>${endInputHtml}</td>
            <td><span class="${badgeCls}">${status}</span></td>
            <td>${delayHtml}</td>
            <td class="f100-comment-cell">${commentBtn}</td>
        </tr>`;
    });

    tbody.innerHTML = html;
    wireF100TableEvents(tbody);
}

function wireF100TableEvents(tbody) {
    // Actual Start
    tbody.querySelectorAll('.inline-date-input').forEach(input => {
        input.addEventListener('change', () => saveActualStart(input.dataset.planId, input.value));
    });
    tbody.querySelectorAll('.inline-start-clear').forEach(btn => {
        btn.addEventListener('click', () => saveActualStart(btn.dataset.planId, ''));
    });

    // Actual End — same inline pattern as Actual Start
    tbody.querySelectorAll('.inline-end-input').forEach(input => {
        input.addEventListener('change', () => saveCompletionDate(input.dataset.planId, input.value));
    });
    tbody.querySelectorAll('.inline-end-clear').forEach(btn => {
        btn.addEventListener('click', () => saveCompletionDate(btn.dataset.planId, ''));
    });

    // Comments popover — multi-user
    tbody.querySelectorAll('.btn-f100-comment').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.f100-comments-popover').forEach(p => p.remove());
            const planId = btn.dataset.planId;
            const row = currentData.find(t => String(t.id) === String(planId));
            const popover = document.createElement('div');
            popover.className = 'f100-comments-popover';
            popover.dataset.planId = planId;

            function formatCommentTime(iso) {
                try {
                    const d = new Date(iso);
                    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
                        + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                } catch { return iso || ''; }
            }

            function updateCommentBadge() {
                const newCount = (row?.comments || []).length;
                let countEl = btn.querySelector('.f100-comment-count');
                if (newCount > 0) {
                    if (countEl) countEl.textContent = newCount;
                    else btn.insertAdjacentHTML('beforeend', `<span class="f100-comment-count">${newCount}</span>`);
                } else if (countEl) countEl.remove();
                btn.title = `${newCount} comment${newCount !== 1 ? 's' : ''}`;
            }

            function renderComments() {
                const currentUser = getCurrentUser();
                const myName = currentUser?.name || currentUser?.email || '';
                const comments = Array.isArray(row?.comments) ? row.comments : [];

                const listHtml = comments.length
                    ? comments.map((c, ci) => {
                        const isOwn = myName && c.user === myName;
                        const ownActions = isOwn && canWrite() ? `
                            <div class="f100-comment-actions">
                                <button class="f100-comment-edit-btn" data-ci="${ci}" title="Edit">
                                    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 10.5 9.5 3 11 4.5 3.5 12H2v-1.5Z"/></svg>
                                </button>
                                <button class="f100-comment-del-btn" data-ci="${ci}" title="Delete">
                                    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 4h8M5 4V3h4v1M5.5 6v4M8.5 6v4M4 4l.5 7h5L10 4"/></svg>
                                </button>
                            </div>` : '';
                        return `
                        <div class="f100-comment-item" data-ci="${ci}">
                            <div class="f100-comment-meta">
                                <strong>${esc(c.user || 'Unknown')}</strong>
                                <span class="f100-comment-time">${formatCommentTime(c.at)}</span>
                                ${ownActions}
                            </div>
                            <div class="f100-comment-text" data-ci="${ci}">${esc(c.text)}</div>
                        </div>`;
                    }).join('')
                    : '<div class="f100-comment-empty">No comments yet.</div>';

                popover.innerHTML = `
                    <div class="f100-comments-header">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="width:14px;height:14px;flex-shrink:0">
                            <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V3Z"/>
                        </svg>
                        Comments
                        <button class="f100-comments-close" title="Close">✕</button>
                    </div>
                    <div class="f100-comments-list">${listHtml}</div>
                    ${canWrite() ? `
                    <div class="f100-comments-add">
                        <textarea class="f100-comment-textarea" rows="2" placeholder="Add a comment…"></textarea>
                        <button class="btn btn-primary btn-sm f100-comment-submit">Add</button>
                    </div>` : ''}`;

                popover.querySelector('.f100-comments-close').addEventListener('click', () => popover.remove());

                // Edit comment buttons
                popover.querySelectorAll('.f100-comment-edit-btn').forEach(editBtn => {
                    editBtn.addEventListener('click', () => {
                        const ci = parseInt(editBtn.dataset.ci, 10);
                        const comments = Array.isArray(row?.comments) ? row.comments : [];
                        const c = comments[ci];
                        if (!c) return;
                        const item = popover.querySelector(`.f100-comment-item[data-ci="${ci}"]`);
                        const textEl = item?.querySelector('.f100-comment-text');
                        if (!textEl) return;
                        const old = c.text;
                        textEl.innerHTML = `<textarea class="f100-comment-textarea f100-comment-edit-ta" rows="2">${esc(old)}</textarea>
                            <div style="display:flex;gap:6px;margin-top:6px">
                                <button class="btn btn-primary btn-sm f100-edit-save-btn">Save</button>
                                <button class="btn btn-sm f100-edit-cancel-btn">Cancel</button>
                            </div>`;
                        textEl.querySelector('.f100-edit-cancel-btn').addEventListener('click', renderComments);
                        textEl.querySelector('.f100-edit-save-btn').addEventListener('click', async () => {
                            const newText = textEl.querySelector('.f100-comment-edit-ta').value.trim();
                            if (!newText) return;
                            const updated = [...(row.comments || [])];
                            updated[ci] = { ...updated[ci], text: newText, edited_at: new Date().toISOString() };
                            markLocalSave();
                            const { error } = await db.from('f100_plans')
                                .update({ comments: updated, updated_at: new Date().toISOString() })
                                .eq('id', planId);
                            if (error) { showToast('Error updating comment: ' + error.message, 'error'); return; }
                            row.comments = updated;
                            updateCommentBadge();
                            renderComments();
                        });
                    });
                });

                // Delete comment buttons
                popover.querySelectorAll('.f100-comment-del-btn').forEach(delBtn => {
                    delBtn.addEventListener('click', async () => {
                        const ci = parseInt(delBtn.dataset.ci, 10);
                        if (!confirm('Delete this comment?')) return;
                        const updated = (row.comments || []).filter((_, i) => i !== ci);
                        markLocalSave();
                        const { error } = await db.from('f100_plans')
                            .update({ comments: updated, updated_at: new Date().toISOString() })
                            .eq('id', planId);
                        if (error) { showToast('Error deleting comment: ' + error.message, 'error'); return; }
                        row.comments = updated;
                        updateCommentBadge();
                        renderComments();
                    });
                });

                if (canWrite()) {
                    const ta = popover.querySelector('.f100-comment-textarea');
                    const submitBtn = popover.querySelector('.f100-comment-submit');
                    submitBtn.addEventListener('click', async () => {
                        const text = ta.value.trim();
                        if (!text) return;
                        submitBtn.disabled = true;
                        submitBtn.textContent = 'Saving…';
                        try {
                            await saveF100Comment(planId, text);
                            updateCommentBadge();
                            renderComments();
                            const list = popover.querySelector('.f100-comments-list');
                            if (list) list.scrollTop = list.scrollHeight;
                        } catch (err) {
                            showToast('Error saving comment: ' + err.message, 'error');
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Add';
                        }
                    });
                }
            }

            renderComments();
            document.body.appendChild(popover);
            const rect = btn.getBoundingClientRect();
            const pw = 320;
            let left = rect.right + window.scrollX - pw;
            if (left < 8) left = 8;
            if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
            popover.style.left = left + 'px';
            popover.style.top = (rect.bottom + window.scrollY + 6) + 'px';
            popover.style.width = pw + 'px';
            setTimeout(() => document.addEventListener('click', function handler(ev) {
                if (!popover.contains(ev.target) && ev.target !== btn) {
                    popover.remove();
                    document.removeEventListener('click', handler);
                }
            }), 0);
        });
    });
}

// ── Dynamic filter bar ────────────────────────────────────────────
function _reapplyFilters() {
    const cat = getVal('filterCategory');
    const base = cat ? currentData.filter(r => getModuleCategory(r.process_station, r) === cat) : currentData;
    const filtered = applyTableSearchFilters(base);
    renderTable(filtered);
    const rc = document.getElementById('rowCount');
    if (rc) rc.textContent = filtered.length + ' record' + (filtered.length !== 1 ? 's' : '') + (_tableFilters.length ? ' (filtered)' : '');
}

function renderTableFilterBar(tableCard) {
    // Render into the inline placeholder in the table header (always present in DOM)
    const bar = document.getElementById('tblFilterBarInline');
    if (!bar) return;
    const fields = getTableFilterFields();

    // Preserve focus so typing doesn't lose cursor position on re-render
    const focusedId  = document.activeElement?.dataset?.filterId;
    const focusedSel = document.activeElement instanceof HTMLInputElement
        ? document.activeElement.selectionStart : null;

    const chipsHtml = _tableFilters.map(f => `
        <span class="tbl-filter-chip" data-filter-id="${f.id}">
            <span class="tbl-filter-chip-label">${esc(f.fieldLabel)}:</span>
            <input class="tbl-filter-chip-input" type="text" value="${esc(f.value)}"
                placeholder="contains…" data-filter-id="${f.id}" autocomplete="off" />
            <button class="tbl-filter-chip-remove" data-filter-id="${f.id}" title="Remove filter">✕</button>
        </span>`).join('');

    const fieldOptions = fields.map(d =>
        `<button class="tbl-filter-field-opt" data-field="${d.field}" data-label="${esc(d.label)}">${esc(d.label)}</button>`
    ).join('');

    bar.innerHTML = `
        <div class="tbl-filter-chips">${chipsHtml}</div>
        <div class="tbl-filter-add-wrap">
            <button class="tbl-filter-add-btn" id="tblAddFilterBtn">+ Add Filter</button>
            <div class="tbl-filter-field-menu" id="tblFilterMenu" style="display:none">${fieldOptions}</div>
        </div>`;

    // Restore focus after re-render so typing continues uninterrupted
    if (focusedId) {
        const inp = bar.querySelector(`.tbl-filter-chip-input[data-filter-id="${focusedId}"]`);
        if (inp) {
            inp.focus();
            if (focusedSel !== null) try { inp.setSelectionRange(focusedSel, focusedSel); } catch {}
        }
    }

    // Wire chip inputs — live filter, focus-safe
    bar.querySelectorAll('.tbl-filter-chip-input').forEach(inp => {
        inp.addEventListener('input', () => {
            const f = _tableFilters.find(x => String(x.id) === inp.dataset.filterId);
            if (f) { f.value = inp.value; _reapplyFilters(); }
        });
    });

    // Wire chip remove buttons
    bar.querySelectorAll('.tbl-filter-chip-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            _tableFilters = _tableFilters.filter(x => String(x.id) !== btn.dataset.filterId);
            _reapplyFilters();
        });
    });

    // Wire add-filter button / field picker
    const addBtn = bar.querySelector('#tblAddFilterBtn');
    const menu   = bar.querySelector('#tblFilterMenu');
    addBtn?.addEventListener('click', e => {
        e.stopPropagation();
        menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
    });
    bar.querySelectorAll('.tbl-filter-field-opt').forEach(opt => {
        opt.addEventListener('click', () => {
            menu.style.display = 'none';
            _tableFilters.push({ id: ++_filterSeq, field: opt.dataset.field, fieldLabel: opt.dataset.label, value: '' });
            _reapplyFilters();
            setTimeout(() => {
                bar.querySelector(`.tbl-filter-chip-input[data-filter-id="${_filterSeq}"]`)?.focus();
            }, 50);
        });
    });

    // Close menu on outside click
    setTimeout(() => document.addEventListener('click', function h(ev) {
        if (!menu?.contains(ev.target) && ev.target !== addBtn) {
            if (menu) menu.style.display = 'none';
            document.removeEventListener('click', h);
        }
    }), 0);
}

function renderTable(data) {
    if (isF100KD2Module()) { renderF100Table(data); return; }

    // Remove F100 view bar and class if present (switched away from F100)
    document.getElementById('f100TableViewBar')?.remove();
    document.getElementById('mainTable')?.classList.remove('f100-table');

    // Restore F200 table header if it was replaced by F100 headers
    const thead = document.querySelector('#mainTable thead');
    if (thead) {
        const cols = ['Vehicle', 'Unit', 'Station / Process', 'Code', 'Week',
            'Planned Start', 'Planned End', 'Actual Start', 'Completed On',
            'Status', 'Delay', 'Comments'];
        thead.innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`;
    }

    const tbody = document.getElementById('tableBody');
    document.getElementById('rowCount').textContent = `${data.length} record${data.length !== 1 ? 's' : ''}`;

    // ── View tab bar (KD2 only) ───────────────────────────────────
    const tableCard = document.querySelector('.table-card');
    let viewBar = document.getElementById('kd2TableViewBar');
    if (isKD2Module()) {
        if (tableCard && !viewBar) {
            viewBar = document.createElement('div');
            viewBar.id = 'kd2TableViewBar';
            viewBar.className = 'f100-table-view-bar';
            viewBar.innerHTML = `
                <span class="f100-view-label">Group by:</span>
                <button class="f100-view-btn${_kd2TableView === 'battalion' ? ' f100-view-btn-active' : ''}" data-view="battalion">Battalion</button>
                <button class="f100-view-btn${_kd2TableView === 'vehicle'   ? ' f100-view-btn-active' : ''}" data-view="vehicle">Vehicle</button>
                <button class="f100-view-btn${_kd2TableView === 'unit'      ? ' f100-view-btn-active' : ''}" data-view="unit">Unit</button>
                <button class="f100-view-btn${_kd2TableView === 'station'   ? ' f100-view-btn-active' : ''}" data-view="station">Station</button>`;
            tableCard.insertBefore(viewBar, tableCard.firstChild);
            viewBar.querySelectorAll('.f100-view-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    _kd2TableView = btn.dataset.view;
                    const _cat = getVal('filterCategory');
                    const _base = _cat ? currentData.filter(r => getModuleCategory(r.process_station, r) === _cat) : currentData;
                    renderTable(applyTableSearchFilters(_base));
                });
            });
        } else if (viewBar) {
            viewBar.querySelectorAll('.f100-view-btn').forEach(btn => {
                btn.classList.toggle('f100-view-btn-active', btn.dataset.view === _kd2TableView);
            });
        }

        // ── Dynamic filter bar ────────────────────────────────────
        if (tableCard) renderTableFilterBar(tableCard);
    } else {
        viewBar?.remove();
        const _inlineBar = document.getElementById('tblFilterBarInline');
        if (_inlineBar) _inlineBar.innerHTML = '';
        _tableFilters = [];
    }

    if (!data.length) {
        tbody.innerHTML = `
      <tr>
        <td colspan="12" class="table-empty">
          <div class="empty-state">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="6" width="36" height="36" rx="4"/><path d="M16 24h16M24 16v16"/></svg>
            <p>No records match the current filters.</p>
          </div>
        </td>
      </tr>`;
        return;
    }

    // ── Completion maps for group progress bars ───────────────────
    const _vehComp = {}, _unitComp = {}, _statComp = {};
    const _batComp = {};
    if (isKD2Module()) {
        data.forEach(r => {
            const s = calculateStatus(r);
            const done = s === 'Completed' || s === 'Late Completion';
            if (!_vehComp[r.vehicle]) _vehComp[r.vehicle] = { done: 0, total: 0 };
            _vehComp[r.vehicle].total++; if (done) _vehComp[r.vehicle].done++;
            const uk = `${r.vehicle}||${r.vehicle_no}`;
            if (!_unitComp[uk]) _unitComp[uk] = { done: 0, total: 0 };
            _unitComp[uk].total++; if (done) _unitComp[uk].done++;
            const sk = `${r.vehicle}||${r.process_station}`;
            if (!_statComp[sk]) _statComp[sk] = { done: 0, total: 0 };
            _statComp[sk].total++; if (done) _statComp[sk].done++;
            const bk = r.battalion_code || '—';
            if (!_batComp[bk]) _batComp[bk] = { done: 0, total: 0 };
            _batComp[bk].total++; if (done) _batComp[bk].done++;
        });
    }

    // ── Sort data by active view ──────────────────────────────────
    let sorted = data;
    if (isKD2Module()) {
        if (_kd2TableView === 'station') {
            const _rt = getModuleRuntime();
            const _routeCache = {};
            const _routeSeq = (vehicle, station) => {
                if (!_routeCache[vehicle]) {
                    _routeCache[vehicle] = _rt?.getStationRouteOrder ? _rt.getStationRouteOrder(vehicle) : new Map();
                }
                return _routeCache[vehicle].get(station) ?? 9999;
            };
            sorted = data.slice().sort((a, b) => {
                const vc = vehicleSort(a.vehicle, b.vehicle);
                if (vc !== 0) return vc;
                const seqA = _routeSeq(a.vehicle, a.process_station);
                const seqB = _routeSeq(b.vehicle, b.process_station);
                if (seqA !== seqB) return seqA - seqB;
                return naturalSort(a.vehicle_no, b.vehicle_no);
            });
        } else if (_kd2TableView === 'unit') {
            const _rt2 = getModuleRuntime();
            const _rc2 = {};
            const _seq2 = (vehicle, station) => {
                if (!_rc2[vehicle]) _rc2[vehicle] = _rt2?.getStationRouteOrder ? _rt2.getStationRouteOrder(vehicle) : new Map();
                return _rc2[vehicle].get(station) ?? 9999;
            };
            sorted = data.slice().sort((a, b) => {
                const bc = String(a.battalion_code || '').localeCompare(String(b.battalion_code || ''), undefined, { numeric: true });
                if (bc !== 0) return bc;
                const vc = vehicleSort(a.vehicle, b.vehicle);
                if (vc !== 0) return vc;
                const nc = naturalSort(a.vehicle_no, b.vehicle_no);
                if (nc !== 0) return nc;
                return _seq2(a.vehicle, a.process_station) - _seq2(b.vehicle, b.process_station);
            });
        } else if (_kd2TableView === 'battalion') {
            const _rt3 = getModuleRuntime();
            const _rc3 = {};
            const _seq3 = (vehicle, station) => {
                if (!_rc3[vehicle]) _rc3[vehicle] = _rt3?.getStationRouteOrder ? _rt3.getStationRouteOrder(vehicle) : new Map();
                return _rc3[vehicle].get(station) ?? 9999;
            };
            sorted = data.slice().sort((a, b) => {
                const bc = String(a.battalion_code || '').localeCompare(String(b.battalion_code || ''), undefined, { numeric: true });
                if (bc !== 0) return bc;
                const vc = vehicleSort(a.vehicle, b.vehicle);
                if (vc !== 0) return vc;
                const nc = naturalSort(a.vehicle_no, b.vehicle_no);
                if (nc !== 0) return nc;
                return _seq3(a.vehicle, a.process_station) - _seq3(b.vehicle, b.process_station);
            });
        } else {
            const _rt4 = getModuleRuntime();
            const _rc4 = {};
            const _seq4 = (vehicle, station) => {
                if (!_rc4[vehicle]) _rc4[vehicle] = _rt4?.getStationRouteOrder ? _rt4.getStationRouteOrder(vehicle) : new Map();
                return _rc4[vehicle].get(station) ?? 9999;
            };
            sorted = data.slice().sort((a, b) => {
                const vc = vehicleSort(a.vehicle, b.vehicle);
                if (vc !== 0) return vc;
                const bc = String(a.battalion_code || '').localeCompare(String(b.battalion_code || ''), undefined, { numeric: true });
                if (bc !== 0) return bc;
                const nc = naturalSort(a.vehicle_no, b.vehicle_no);
                if (nc !== 0) return nc;
                return _seq4(a.vehicle, a.process_station) - _seq4(b.vehicle, b.process_station);
            });
        }
    }

    // ── Build HTML with group separator rows ──────────────────────
    function _mkPctBar(comp) {
        if (!comp || !comp.total) return '';
        const pct = Math.round((comp.done / comp.total) * 100);
        return `<div class="f100-grp-pct-wrap"><div class="f100-grp-pct-bar" style="width:${pct}%"></div></div><span class="f100-grp-pct-text">${comp.done}/${comp.total} (${pct}%)</span>`;
    }

    let html = '';
    let prevGroupKey = null;

    sorted.forEach(row => {
        let groupKey, groupHtml;
        if (isKD2Module()) {
            if (_kd2TableView === 'vehicle') {
                groupKey = row.vehicle;
                if (groupKey !== prevGroupKey) {
                    groupHtml = `<tr class="f100-tbl-group-row f100-tbl-group-vehicle"><td colspan="12">
                        <span class="f100-tbl-veh-badge">${esc(groupKey)}</span>${_mkPctBar(_vehComp[groupKey])}
                    </td></tr>`;
                }
            } else if (_kd2TableView === 'unit') {
                groupKey = `${row.vehicle}||${row.vehicle_no}`;
                if (groupKey !== prevGroupKey) {
                    groupHtml = `<tr class="f100-tbl-group-row f100-tbl-group-vehicle"><td colspan="12">
                        <span class="f100-tbl-veh-badge">${esc(row.vehicle)}</span>
                        <strong>${esc(row.vehicle_no || '—')}</strong>
                        ${row.battalion_code ? `<span class="f100-tbl-bat-tag">${esc(row.battalion_code)}</span>` : ''}
                        ${_mkPctBar(_unitComp[groupKey])}
                    </td></tr>`;
                }
            } else if (_kd2TableView === 'battalion') {
                groupKey = row.battalion_code || '—';
                if (groupKey !== prevGroupKey) {
                    groupHtml = `<tr class="f100-tbl-group-row f100-tbl-group-vehicle"><td colspan="12">
                        <svg style="width:13px;height:13px;flex-shrink:0;opacity:.7" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 9h4M4 6h8"/></svg>
                        <span class="f100-tbl-bat-tag" style="font-size:.78rem;font-weight:700">${esc(groupKey)}</span>
                        ${_mkPctBar(_batComp[groupKey])}
                    </td></tr>`;
                }
            } else if (_kd2TableView === 'station') {
                groupKey = `${row.vehicle}||${row.process_station}`;
                if (groupKey !== prevGroupKey) {
                    groupHtml = `<tr class="f100-tbl-group-row f100-tbl-group-part"><td colspan="12">
                        <strong>${esc(row.process_station || '—')}</strong><span style="margin-left:6px;font-size:.75rem;opacity:.65;font-weight:600">[${esc(row.vehicle)}]</span>${_mkPctBar(_statComp[groupKey])}
                    </td></tr>`;
                }
            }
        }

        if (groupKey !== prevGroupKey) {
            if (groupHtml) html += groupHtml;
            prevGroupKey = groupKey;
        }
        const status = calculateStatus(row);
        const delay = delayDays(row);
        const badgeCls = `badge badge-${status.toLowerCase().replace(' ', '-').replace('late-completion', 'late')}`;
        const compDate = row.progress?.completion_date || null;
        const actualStart = row.progress?.actual_start_date || '';

        let delayHtml;
        if (delay > 0 && (status === 'Late Completion' || status === 'Overdue')) {
            delayHtml = `<span class="delay-positive">+${delay}d</span>`;
        } else if (delay > 0 && status === 'In Progress') {
            delayHtml = `<span class="delay-positive" title="Started ${delay}d late">+${delay}d start</span>`;
        } else if (status === 'Completed' || status === 'Late Completion') {
            delayHtml = delay === 0 ? `<span class="delay-zero">On Time</span>` : `<span class="delay-positive">+${delay}d</span>`;
        } else {
            delayHtml = `<span class="delay-none">—</span>`;
        }

        // Actual Start — inline input (same as F100)
        const startInputHtml = `<div class="inline-date-wrap">
            <input type="date" class="inline-date-input" data-plan-id="${row.id}" value="${actualStart}" title="Actual start date" />
            ${actualStart ? `<button class="inline-icon-btn inline-start-clear" data-plan-id="${row.id}" title="Clear">✕</button>` : ''}
        </div>`;

        // Completed On — inline input (same pattern as F100 actual end)
        const endInputHtml = `<div class="inline-date-wrap">
            <input type="date" class="inline-end-input" data-plan-id="${row.id}" value="${compDate || ''}" title="Completion date" />
            ${compDate ? `<button class="inline-icon-btn inline-end-clear" data-plan-id="${row.id}" title="Clear">✕</button>` : ''}
        </div>`;

        // Comments button — identical to F100 pattern
        const comments = Array.isArray(row.comments) ? row.comments : [];
        const commentBtn = `<button class="btn-f100-comment btn-kd2-comment" data-plan-id="${row.id}" title="${comments.length} comment${comments.length !== 1 ? 's' : ''}">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V3Z"/></svg>
            ${comments.length ? `<span class="f100-comment-count">${comments.length}</span>` : ''}
        </button>`;

        html += `
      <tr data-plan-id="${row.id}">
        <td><strong>${esc(row.vehicle)}</strong></td>
        <td class="unit-cell">${[
            row.battalion_code ? `<span class="f100-tbl-bat-tag">${esc(row.battalion_code)}</span>` : '',
            `<span class="unit-main-label">${esc(row.vehicle_no)}</span>`,
            getUnitCode(row.vehicle, row.vehicle_no) ? `<span class="unit-code-badge">${esc(getUnitCode(row.vehicle, row.vehicle_no))}</span>` : '',
        ].filter(Boolean).join('')}</td>
        <td>${esc(row.process_station)}</td>
        <td class="mono station-code-cell">${esc(getRowCode(row))}</td>
        <td class="mono">${esc(row.week || '—')}</td>
        <td class="mono">${formatDate(row.start_date)}</td>
        <td class="mono">${formatDate(row.end_date)}</td>
        <td>${startInputHtml}</td>
        <td>${endInputHtml}</td>
        <td><span class="${badgeCls}">${status}</span></td>
        <td>${delayHtml}</td>
        <td class="f100-comment-cell">${commentBtn}</td>
      </tr>`;
    });

    tbody.innerHTML = html;

    // ── Viewer mode: disable date inputs ─────────────────────────
    if (!canWrite()) {
        tbody.querySelectorAll('.inline-date-input, .inline-end-input').forEach(el => {
            el.disabled = true;
        });
    }

    // ── Actual Start ─────────────────────────────────────────────
    tbody.querySelectorAll('.inline-date-input').forEach(input => {
        input.addEventListener('change', () => saveActualStart(input.dataset.planId, input.value));
    });
    tbody.querySelectorAll('.inline-start-clear').forEach(btn => {
        btn.addEventListener('click', () => saveActualStart(btn.dataset.planId, ''));
    });

    // ── Completed On (inline end input) ───────────────────────────
    tbody.querySelectorAll('.inline-end-input').forEach(input => {
        input.addEventListener('change', () => saveCompletionDate(input.dataset.planId, input.value));
    });
    tbody.querySelectorAll('.inline-end-clear').forEach(btn => {
        btn.addEventListener('click', () => saveCompletionDate(btn.dataset.planId, ''));
    });

    // ── Edit planned dates (pencil icon) ──────────────────────────
    // ── Comments popover — full F100-style threaded comments ──────
    tbody.querySelectorAll('.btn-kd2-comment').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.f100-comments-popover').forEach(p => p.remove());
            const planId = btn.dataset.planId;
            const row = currentData.find(t => String(t.id) === String(planId));
            const popover = document.createElement('div');
            popover.className = 'f100-comments-popover';
            popover.dataset.planId = planId;

            function formatCommentTime(iso) {
                try {
                    const d = new Date(iso);
                    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
                        + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                } catch { return iso || ''; }
            }

            function updateCommentBadge() {
                const newCount = (row?.comments || []).length;
                let countEl = btn.querySelector('.f100-comment-count');
                if (newCount > 0) {
                    if (countEl) countEl.textContent = newCount;
                    else btn.insertAdjacentHTML('beforeend', `<span class="f100-comment-count">${newCount}</span>`);
                } else if (countEl) countEl.remove();
                btn.title = `${newCount} comment${newCount !== 1 ? 's' : ''}`;
            }

            function renderComments() {
                const currentUser = getCurrentUser();
                const myName = currentUser?.name || currentUser?.email || '';
                const comments = Array.isArray(row?.comments) ? row.comments : [];
                const listHtml = comments.length
                    ? comments.map((c, ci) => {
                        const isOwn = myName && c.user === myName;
                        const ownActions = isOwn && canWrite() ? `
                            <div class="f100-comment-actions">
                                <button class="f100-comment-edit-btn" data-ci="${ci}" title="Edit"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 10.5 9.5 3 11 4.5 3.5 12H2v-1.5Z"/></svg></button>
                                <button class="f100-comment-del-btn" data-ci="${ci}" title="Delete"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 4h8M5 4V3h4v1M5.5 6v4M8.5 6v4M4 4l.5 7h5L10 4"/></svg></button>
                            </div>` : '';
                        return `<div class="f100-comment-item" data-ci="${ci}">
                            <div class="f100-comment-meta">
                                <strong>${esc(c.user || 'Unknown')}</strong>
                                <span class="f100-comment-time">${formatCommentTime(c.at)}</span>
                                ${ownActions}
                            </div>
                            <div class="f100-comment-text" data-ci="${ci}">${esc(c.text)}</div>
                        </div>`;
                    }).join('')
                    : '<div class="f100-comment-empty">No comments yet.</div>';

                popover.innerHTML = `
                    <div class="f100-comments-header">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="width:14px;height:14px;flex-shrink:0"><path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 2V3Z"/></svg>
                        Comments
                        <button class="f100-comments-close" title="Close">✕</button>
                    </div>
                    <div class="f100-comments-list">${listHtml}</div>
                    ${canWrite() ? `<div class="f100-comments-add">
                        <textarea class="f100-comment-textarea" rows="2" placeholder="Add a comment…"></textarea>
                        <button class="btn btn-primary btn-sm f100-comment-submit">Add</button>
                    </div>` : ''}`;

                popover.querySelector('.f100-comments-close').addEventListener('click', () => popover.remove());

                popover.querySelectorAll('.f100-comment-edit-btn').forEach(editBtn => {
                    editBtn.addEventListener('click', () => {
                        const ci = parseInt(editBtn.dataset.ci, 10);
                        const c = (row?.comments || [])[ci];
                        if (!c) return;
                        const item = popover.querySelector(`.f100-comment-item[data-ci="${ci}"]`);
                        const textEl = item?.querySelector('.f100-comment-text');
                        if (!textEl) return;
                        textEl.innerHTML = `<textarea class="f100-comment-textarea f100-comment-edit-ta" rows="2">${esc(c.text)}</textarea>
                            <div style="display:flex;gap:6px;margin-top:6px">
                                <button class="btn btn-primary btn-sm f100-edit-save-btn">Save</button>
                                <button class="btn btn-sm f100-edit-cancel-btn">Cancel</button>
                            </div>`;
                        textEl.querySelector('.f100-edit-cancel-btn').addEventListener('click', renderComments);
                        textEl.querySelector('.f100-edit-save-btn').addEventListener('click', async () => {
                            const newText = textEl.querySelector('.f100-comment-edit-ta').value.trim();
                            if (!newText) return;
                            const updated = [...(row.comments || [])];
                            updated[ci] = { ...updated[ci], text: newText, edited_at: new Date().toISOString() };
                            markLocalSave();
                            const { error } = await db.from('kd2_plan').update({ comments: updated }).eq('id', planId);
                            if (error) { showToast('Error updating comment: ' + error.message, 'error'); return; }
                            row.comments = updated;
                            updateCommentBadge();
                            renderComments();
                        });
                    });
                });

                popover.querySelectorAll('.f100-comment-del-btn').forEach(delBtn => {
                    delBtn.addEventListener('click', async () => {
                        const ci = parseInt(delBtn.dataset.ci, 10);
                        if (!confirm('Delete this comment?')) return;
                        const updated = (row.comments || []).filter((_, i) => i !== ci);
                        markLocalSave();
                        const { error } = await db.from('kd2_plan').update({ comments: updated }).eq('id', planId);
                        if (error) { showToast('Error deleting comment: ' + error.message, 'error'); return; }
                        row.comments = updated;
                        updateCommentBadge();
                        renderComments();
                    });
                });

                if (canWrite()) {
                    const ta = popover.querySelector('.f100-comment-textarea');
                    const submitBtn = popover.querySelector('.f100-comment-submit');
                    submitBtn.addEventListener('click', async () => {
                        const text = ta.value.trim();
                        if (!text) return;
                        submitBtn.disabled = true;
                        submitBtn.textContent = 'Saving…';
                        try {
                            await saveKd2Comment(planId, text);
                            updateCommentBadge();
                            renderComments();
                            const list = popover.querySelector('.f100-comments-list');
                            if (list) list.scrollTop = list.scrollHeight;
                        } catch (err) {
                            showToast('Error saving comment: ' + err.message, 'error');
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Add';
                        }
                    });
                }
            }

            renderComments();
            document.body.appendChild(popover);
            const rect = btn.getBoundingClientRect();
            const pw = 320;
            let left = rect.right + window.scrollX - pw;
            if (left < 8) left = 8;
            if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
            popover.style.left = left + 'px';
            popover.style.top = (rect.bottom + window.scrollY + 6) + 'px';
            popover.style.width = pw + 'px';
            setTimeout(() => document.addEventListener('click', function handler(ev) {
                if (!popover.contains(ev.target) && ev.target !== btn) { popover.remove(); document.removeEventListener('click', handler); }
            }), 0);
        });
    });
}

/* ──────────────────────────────────────────────────────────────────
   8. SUMMARY CARDS
   ────────────────────────────────────────────────────────────────── */
function updateSummary(data) {
    const total = data.length;
    const completed = data.filter(r => calculateStatus(r) === 'Completed').length;
    const late = data.filter(r => calculateStatus(r) === 'Late Completion').length;
    const overdue = data.filter(r => calculateStatus(r) === 'Overdue').length;
    const pct = total ? Math.round(((completed + late) / total) * 100) : 0;

    animateCount('sumPlanned', total);
    animateCount('sumCompleted', completed);
    animateCount('sumLate', late);
    animateCount('sumOverdue', overdue);
    document.getElementById('sumProgress').textContent = `${pct}%`;
    document.getElementById('progressBarFill').style.width = `${pct}%`;
    _updateDeliveryCard(data);
}

function _fmtDeliveryDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function _addWorkingDays(dateStr, n) {
    if (n <= 0) return dateStr;
    const d = new Date(dateStr + 'T00:00:00');
    let added = 0;
    while (added < n) {
        d.setDate(d.getDate() + 1);
        if (d.getDay() !== 5) added++;
    }
    return d.toISOString().slice(0, 10);
}

function _updateDeliveryCard(data) {
    const plannedEl  = document.getElementById('sumDeliveryPlanned');
    const expectedEl = document.getElementById('sumDeliveryExpected');
    const deltaEl    = document.getElementById('sumDeliveryDelta');
    if (!plannedEl || !expectedEl || !deltaEl) return;

    if (!data.length) {
        plannedEl.textContent  = '—';
        expectedEl.textContent = '—';
        deltaEl.style.display  = 'none';
        return;
    }

    // Find the last record — the one with the latest planned end date (gates delivery)
    let plannedDelivery = null;
    let lastRecord = null;
    data.forEach(r => {
        const plannedEnd = (r.module === 'gun' || r.module === 'vehicle') ? r.planned_end_date : r.end_date;
        if (plannedEnd && (!plannedDelivery || plannedEnd > plannedDelivery)) {
            plannedDelivery = plannedEnd;
            lastRecord = r;
        }
    });

    if (!plannedDelivery) {
        plannedEl.textContent  = '—';
        expectedEl.textContent = '—';
        deltaEl.style.display  = 'none';
        return;
    }

    // Delivery delay = worst single-task delay (that bottleneck cascades to delivery)
    const totalDelay = data.reduce((max, r) => Math.max(max, delayDays(r)), 0);

    // Expected delivery = planned end shifted by the worst delay in working days
    const expectedDelivery = _addWorkingDays(plannedDelivery, totalDelay);

    plannedEl.textContent  = _fmtDeliveryDate(plannedDelivery);
    expectedEl.textContent = _fmtDeliveryDate(expectedDelivery);

    if (totalDelay > 0) {
        deltaEl.textContent = `+${totalDelay} wd`;
        deltaEl.className = 'delivery-delta delivery-delta--late';
        deltaEl.style.display = '';
    } else {
        deltaEl.style.display = 'none';
    }

    const card = document.querySelector('.card-delivery');
    if (card) {
        card.style.cursor = 'pointer';
        card.title = 'Click to see delay breakdown';
        card.onclick = () => _showDeliveryAnalysisModal(data, plannedDelivery, expectedDelivery, totalDelay);
    }
}

function _showDeliveryAnalysisModal(data, plannedDelivery, expectedDelivery, totalDelay) {
    // Build: category → { maxDelay, delayed, vehicles: Map<vtype,maxDelay>, stations: Map<vtype||station, {name,vtype,delayed,maxDelay}> }
    const catMap = new Map();
    data.forEach(r => {
        const d = Math.max(0, delayDays(r));
        if (d === 0) return;
        const cat   = getModuleCategory(r.process_station, r) || 'Other';
        const vtype = _getVehicleType(r.vehicle) || 'Unknown';
        const sname = r.process_station || '(Unknown)';
        if (!catMap.has(cat)) catMap.set(cat, { maxDelay: 0, delayed: 0, vehicles: new Map(), stations: new Map() });
        const c = catMap.get(cat);
        c.delayed++;
        if (d > c.maxDelay) c.maxDelay = d;
        if (!c.vehicles.has(vtype) || d > c.vehicles.get(vtype)) c.vehicles.set(vtype, d);
        const sk = `${vtype}||${sname}`;
        if (!c.stations.has(sk)) c.stations.set(sk, { name: sname, vtype, delayed: 0, maxDelay: 0 });
        const s = c.stations.get(sk);
        s.delayed++;
        if (d > s.maxDelay) s.maxDelay = d;
    });

    const catRows = [...catMap.entries()].sort((a, b) => b[1].maxDelay - a[1].maxDelay);
    const overallMax  = catRows[0]?.[1].maxDelay || 1;
    const delayedCount = data.filter(r => delayDays(r) > 0).length;
    const worstCat    = catRows[0]?.[0] || '—';
    const worstCatDelay = catRows[0]?.[1].maxDelay || 0;

    const thSt = 'padding:5px 10px;text-align:left;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--clr-text-dim);border-bottom:1px solid var(--clr-border)';

    const catListHtml = catRows.map(([cat, c], i) => {
        const pct      = Math.round((c.maxDelay / overallMax) * 100);
        const barColor = i === 0 ? '#f87171' : i === 1 ? '#fb923c' : '#facc15';
        const vtags    = [...c.vehicles.entries()].sort((a,b) => b[1]-a[1])
            .map(([v, mx]) => `<span style="font-size:.68rem;font-weight:700;padding:1px 6px;border-radius:8px;background:var(--clr-surface-3,var(--clr-border));color:var(--clr-text-dim)">${esc(v)}</span>`)
            .join(' ');
        const stRows = [...c.stations.values()].sort((a,b) => b.maxDelay - a.maxDelay);
        const stHtml = stRows.map(s => `
            <tr style="border-top:1px solid var(--clr-border)">
                <td style="padding:5px 10px 5px 28px;color:var(--clr-text-dim)">↳ ${esc(s.name)}</td>
                <td style="padding:5px 10px;text-align:center">
                    <span style="font-size:.72rem;font-weight:700;padding:1px 6px;border-radius:8px;background:var(--clr-surface-3,var(--clr-border));color:var(--clr-text-dim)">${esc(s.vtype)}</span>
                </td>
                <td style="padding:5px 10px;text-align:center;color:var(--clr-text-dim);font-size:.82rem">${s.delayed}</td>
                <td style="padding:5px 10px;text-align:right;font-weight:600;font-size:.82rem;color:${s.maxDelay===c.maxDelay?barColor:'var(--clr-text)'}">+${s.maxDelay} wd</td>
            </tr>`).join('');

        return `
        <tbody class="dda-cat-body" data-cat-idx="${i}">
            <tr class="dda-cat-row" data-cat-idx="${i}" style="cursor:pointer;border-top:1px solid var(--clr-border)">
                <td style="padding:8px 10px">
                    <div style="display:flex;align-items:center;gap:7px">
                        <svg class="dda-chevron" data-cat-idx="${i}" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0;transition:transform .2s;transform:rotate(-90deg)"><path d="M3 4.5l3 3 3-3"/></svg>
                        <span style="font-weight:${i===0?'700':'500'}">${esc(cat)}</span>
                        <span style="margin-left:4px">${vtags}</span>
                    </div>
                </td>
                <td style="padding:8px 10px;text-align:center">${c.delayed}</td>
                <td style="padding:8px 10px">
                    <div style="display:flex;align-items:center;gap:8px">
                        <div style="flex:1;height:6px;background:var(--clr-border);border-radius:3px;min-width:50px">
                            <div style="width:${pct}%;height:100%;background:${barColor};border-radius:3px"></div>
                        </div>
                        <span style="white-space:nowrap;font-weight:700;color:${barColor}">${c.maxDelay} wd</span>
                    </div>
                </td>
            </tr>
            <tr class="dda-st-row" data-cat-idx="${i}" style="display:none">
                <td colspan="3" style="padding:0">
                    <table style="width:100%;border-collapse:collapse;font-size:.82rem">
                        <thead><tr>
                            <th style="${thSt}">Station</th>
                            <th style="${thSt};text-align:center">Vehicle</th>
                            <th style="${thSt};text-align:center">Delayed</th>
                            <th style="${thSt};text-align:right">Worst Delay</th>
                        </tr></thead>
                        <tbody>${stHtml}</tbody>
                    </table>
                </td>
            </tr>
        </tbody>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
        <div class="modal" style="max-width:620px;max-height:88vh;display:flex;flex-direction:column">
            <div class="modal-header" style="flex-shrink:0">
                <h4 class="modal-title">Delivery Delay Analysis</h4>
                <button class="modal-close" type="button" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body" style="overflow-y:auto;flex:1;padding:18px 20px;display:flex;flex-direction:column;gap:18px">

                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
                    <div style="background:var(--clr-surface-2);border:1px solid var(--clr-border);border-radius:8px;padding:12px 14px">
                        <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--clr-text-dim);margin-bottom:4px">Planned End</div>
                        <div style="font-size:.95rem;font-weight:600">${_fmtDeliveryDate(plannedDelivery)}</div>
                    </div>
                    <div style="background:var(--clr-surface-2);border:1px solid rgba(248,113,113,.3);border-radius:8px;padding:12px 14px">
                        <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--clr-text-dim);margin-bottom:4px">Expected End</div>
                        <div style="font-size:.95rem;font-weight:600;color:#f87171">${_fmtDeliveryDate(expectedDelivery)}</div>
                    </div>
                    <div style="background:var(--clr-surface-2);border:1px solid rgba(248,113,113,.3);border-radius:8px;padding:12px 14px">
                        <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--clr-text-dim);margin-bottom:4px">Worst Delay</div>
                        <div style="font-size:.95rem;font-weight:700;color:#f87171">+${totalDelay} wd</div>
                        <div style="font-size:.72rem;color:var(--clr-text-dim);margin-top:2px">${delayedCount} delayed task${delayedCount!==1?'s':''}</div>
                    </div>
                </div>

                ${totalDelay === 0
                    ? `<div style="text-align:center;padding:20px;color:var(--clr-text-dim)">No delays — delivery is on track.</div>`
                    : `<div>
                        <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--clr-text-dim);margin-bottom:8px">
                            Delay by Category &nbsp;·&nbsp; click a row to see stations
                            &nbsp;·&nbsp; <span style="color:#f87171">${esc(worstCat)}</span> is worst (${worstCatDelay} wd)
                        </div>
                        <table style="width:100%;border-collapse:collapse;font-size:.84rem">
                            <thead><tr style="border-bottom:2px solid var(--clr-border)">
                                <th style="padding:6px 10px;text-align:left;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--clr-text-dim)">Category &amp; Vehicles</th>
                                <th style="padding:6px 10px;text-align:center;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--clr-text-dim)">Delayed</th>
                                <th style="padding:6px 10px;text-align:left;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--clr-text-dim)">Worst Delay</th>
                            </tr></thead>
                            ${catListHtml}
                        </table>
                    </div>`
                }
            </div>
        </div>`;

    document.body.appendChild(overlay);

    // Toggle category rows
    overlay.querySelectorAll('.dda-cat-row').forEach(row => {
        row.addEventListener('click', () => {
            const idx     = row.dataset.catIdx;
            const stRow   = overlay.querySelector(`.dda-st-row[data-cat-idx="${idx}"]`);
            const chevron = overlay.querySelector(`.dda-chevron[data-cat-idx="${idx}"]`);
            const open    = stRow.style.display !== 'none';
            stRow.style.display   = open ? 'none' : '';
            chevron.style.transform = open ? 'rotate(-90deg)' : 'rotate(0deg)';
        });
    });

    function close() {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
    }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
}

/* ──────────────────────────────────────────────────────────────────
   9. CHARTS
   ────────────────────────────────────────────────────────────────── */

/* ================================================================
   VEHICLE PRODUCTION PROGRESS MATRIX (VPX)
   ================================================================ */

// Station column definitions — ordered exactly as they flow in production
/**
 * VPX column definitions.
 *
 * Each column has:
 *   code    — the station code shown in the header (A01, A05/A11, …)
 *   name    — full station name shown as column tooltip
 *   resolve — function(vehicle) → station key to look up in row.stations,
 *             or null if this column is N/A for that vehicle
 *   group   — column group label
 *
 * Vehicle-specific rules:
 *   A02 → H/Electric (K9 family) | Track (K10/K11 family)
 *   A04 → Engine (K9 only — K10/K11 show this station at A13)
 *   A13 → Engine (K10/K11 only)
 */
const _isK9 = v => /K9/i.test(String(v));
const _isK10K11 = v => /K1[01]/i.test(String(v));

let _vpxLastData = null;
let _vpxVehicleTypeFilter = null;
let _vpxCategoryFilter = null;

function _getVehicleType(vehicle) {
    const v = String(vehicle || '');
    if (/K11/i.test(v)) return 'K11';
    if (/K10/i.test(v)) return 'K10';
    if (/K9/i.test(v)) return 'K9';
    return null;
}

function _detectVpxVehicleTypes(data) {
    const seen = new Set();
    data.forEach(t => { const vt = _getVehicleType(t.vehicle); if (vt) seen.add(vt); });
    return ['K9', 'K10', 'K11'].filter(t => seen.has(t));
}

function _renderVpxTypeTabs(types) {
    const el = document.getElementById('vpxTypeTabs');
    if (!el) return;
    if (!types.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = types.map(t =>
        `<button class="vpx-type-tab${t === _vpxVehicleTypeFilter ? ' active' : ''}" data-vtype="${t}">${t}</button>`
    ).join('');
    el.querySelectorAll('.vpx-type-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            _vpxVehicleTypeFilter = btn.dataset.vtype;
            _vpxCategoryFilter = null; // re-detect for the new vehicle type
            if (_vpxLastData) renderVPX(_vpxLastData);
        });
    });
}

/** K9 splits into Hull/Turret (from each station's component_group) plus
 *  Assembly; K10/K11 don't split Hull/Turret (matches the reference daily
 *  report, which has one combined "K10 and K11 Hull Structure" table), so
 *  they only ever get "Structure" (everything non-Assembly) + "Assembly". */
function _vpxTaskCategory(task, vehicleType, compMap) {
    const group = task.category || getModuleCategory(task.process_station, task) || 'Other';
    if (group === 'Assembly') return 'Assembly';
    if (vehicleType === 'K9' && compMap) {
        const comp = compMap.get(task.process_station || task.station_name)?.component_group;
        if (comp === 'Hull' || comp === 'Turret') return comp;
    }
    return 'Structure';
}

function _detectVpxCategories(vehicleType, data, compMap) {
    const seen = new Set();
    data.forEach(t => seen.add(_vpxTaskCategory(t, vehicleType, compMap)));
    const order = vehicleType === 'K9' ? ['Hull', 'Turret', 'Assembly'] : ['Structure', 'Assembly'];
    return order.filter(c => seen.has(c));
}

function _renderVpxCategoryTabs(categories) {
    const el = document.getElementById('vpxCategoryTabs');
    if (!el) return;
    if (!categories.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = categories.map(c =>
        `<button class="vpx-type-tab vpx-category-tab${c === _vpxCategoryFilter ? ' active' : ''}" data-vcat="${c}">${c}</button>`
    ).join('');
    el.querySelectorAll('.vpx-category-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            _vpxCategoryFilter = btn.dataset.vcat;
            if (_vpxLastData) renderVPX(_vpxLastData);
        });
    });
}

/** Applies the currently-selected VPX vehicle-type + category tab to `data`.
 *  Single source of truth shared by renderVPX and both export functions so
 *  an export can never silently include more than what's on screen. */
function _getVpxFilteredData(data) {
    if (!isKD2Module() || !_vpxVehicleTypeFilter) return data;
    let filtered = data.filter(t => _getVehicleType(t.vehicle) === _vpxVehicleTypeFilter);
    if (_vpxCategoryFilter) {
        const rt = getModuleRuntime?.();
        const compMap = (_vpxVehicleTypeFilter === 'K9' && rt?.getStationCategoryMap)
            ? rt.getStationCategoryMap('K9') : null;
        filtered = filtered.filter(t => _vpxTaskCategory(t, _vpxVehicleTypeFilter, compMap) === _vpxCategoryFilter);
    }
    return filtered;
}

const VPX_COLUMNS = [
    // ── Assembly ──────────────────────────────────────────────────────
    {
        code: 'A01', name: 'Suspension',
        resolve: () => 'Suspension',
        group: 'Assembly',
    },
    {
        code: 'A02', name: 'H/Electric (K9) · Track (K10/K11)',
        resolve: v => _isK9(v) ? 'H/Electric' : 'Track',
        group: 'Assembly',
    },
    {
        code: 'A03', name: 'Interior',
        resolve: () => 'Interior',
        group: 'Assembly',
    },
    {
        code: 'A04', name: 'Engine (K9)',
        resolve: v => _isK9(v) ? 'Engine' : null,   // K10/K11 use A13
        group: 'Assembly',
    },
    {
        code: 'A05/A11', name: 'Turret/Gun',
        resolve: () => 'Turret/Gun',
        group: 'Assembly',
    },
    {
        code: 'A06', name: 'Hydraulic',
        resolve: () => 'Hydraulic',
        group: 'Assembly',
    },
    {
        code: 'A07', name: 'Bore Sight',
        resolve: () => 'Bore Sight',
        group: 'Assembly',
    },
    {
        code: 'A08', name: 'Turret',
        resolve: () => 'Turret',
        group: 'Assembly',
    },
    {
        code: 'A09', name: 'T/Electric (TURRET)',
        resolve: () => 'T/Electric (TURRET)',
        group: 'Assembly',
    },
    {
        code: 'A10', name: 'Hyd / Sub (TURRET)',
        resolve: () => 'Hyd / Sub (TURRET)',
        group: 'Assembly',
    },
    {
        code: 'A12', name: 'Electric/Interior',
        resolve: () => 'Electric/Interior',
        group: 'Assembly',
    },
    {
        code: 'A13', name: 'Engine (K10/K11)',
        resolve: v => _isK9(v) ? null : 'Engine',   // K9 uses A04
        group: 'Assembly',
    },
    {
        code: 'A14', name: 'Automation',
        resolve: () => 'Automation',
        group: 'Assembly',
    },
    {
        code: 'A15', name: 'Final Assembly',
        resolve: () => 'Final Assembly',
        group: 'Assembly',
    },
    // ── Processing ────────────────────────────────────────────────────
    {
        code: 'Proc.', name: 'Processing',
        resolve: () => 'Processing',
        group: 'Processing',
    },
    // ── Final Inspection ──────────────────────────────────────────────
    {
        code: 'F.Insp', name: 'Final Inspection',
        resolve: () => 'Final Inspection',
        group: 'Final Inspection',
    },
    // ── Final Test ────────────────────────────────────────────────────
    {
        code: 'F.Chk', name: 'Final Check',
        resolve: () => 'Final Check',
        group: 'Final Test',
    },
];

function getVpxDisplayMeta() {
    if (isF100KD2Module()) return {
        headerLabel: 'Battalion · Part / Process',
        exportTitle: 'F100 Part Manufacturing Progress',
        exportSubtitle: 'Part-by-process completion',
        footerApp: 'F100 KD2 Part Manufacturing Progress Control',
        workbookCreator: 'F100 KD2',
        keyTitle: 'F100 VPX — Key & Legend',
        filenamePrefix: 'F100_KD2_Progress',
        emptyMessage: 'Load F100 data to view the progress matrix.',
        noColumnsMessage: 'No F100 process steps found for the current filters.',
    };
    return isKD2Module()
        ? {
            headerLabel: 'Battalion · Vehicle · Unit',
            exportTitle: 'Battalion Progress Matrix',
            exportSubtitle: 'Battalion-by-station planned vs actual',
            footerApp: 'KD2 Battalion Planning and Progress Control',
            workbookCreator: 'KD2 Battalion Planning and Progress Control',
            keyTitle: 'KD2 VPX — Key & Legend',
            filenamePrefix: 'KD2_BattalionProgress',
            emptyMessage: 'Load KD2 plan data to view the progress matrix.',
            noColumnsMessage: 'No KD2 station data is available for the current filters.',
        }
        : {
            headerLabel: 'Vehicle · Unit',
            exportTitle: 'Vehicle Production Progress',
            exportSubtitle: 'Station-by-Station Planned vs Actual',
            footerApp: 'KD1 Assembly Control System',
            workbookCreator: 'KD1 Assembly Control System',
            keyTitle: 'KD1 VPX — Key & Legend',
            filenamePrefix: 'KD1_VehicleProgress',
            emptyMessage: 'Load data to view the progress matrix.',
            noColumnsMessage: 'No station data matches the known column list.',
        };
}

function getKd2VpxColumnMeta(task) {
    const routeSequence = parseInt(task.route_sequence, 10) || parseInt(task.step_sequence, 10) || 9999;
    const group = task.category || getModuleCategory(task.process_station, task) || 'Other';
    const name = task.process_station || task.station_name || task.station_code || 'Station';
    const workCenter = String(task.work_center || '').trim();
    return {
        key: `${String(routeSequence).padStart(4, '0')}||${group}||${name}`,
        code: workCenter || name,
        name,
        group,
        order: routeSequence,
    };
}

function getVpxTaskStationKey(task) {
    if (!isKD2Module()) return task.process_station;
    return getKd2VpxColumnMeta(task).key;
}

function buildVpxColumns(data) {
    if (!isKD2Module()) return VPX_COLUMNS;

    const cols = new Map();
    data.forEach(task => {
        const meta = getKd2VpxColumnMeta(task);
        if (!cols.has(meta.key)) {
            cols.set(meta.key, {
                ...meta,
                vehicles: new Set(),
            });
        }
        cols.get(meta.key).vehicles.add(task.vehicle || '');
    });

    // Override order from station definitions — use the active vehicle type when known
    // (mirrors how the Gantt process view sorts via getStationRouteOrder per vehicle)
    const rt = getModuleRuntime?.();
    if (rt?.getStationRouteOrder) {
        const routeOrder = _vpxVehicleTypeFilter
            ? rt.getStationRouteOrder(_vpxVehicleTypeFilter)
            : (() => {
                const merged = new Map();
                ['K9', 'K10', 'K11'].forEach(v => {
                    rt.getStationRouteOrder(v).forEach((seq, name) => {
                        if (!merged.has(name) || seq < merged.get(name)) merged.set(name, seq);
                    });
                });
                return merged;
            })();
        cols.forEach(col => {
            if (routeOrder.has(col.name)) col.order = routeOrder.get(col.name);
        });
    }

    return [...cols.values()]
        .sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            const groupCmp = String(a.group || '').localeCompare(String(b.group || ''));
            if (groupCmp !== 0) return groupCmp;
            return String(a.name || '').localeCompare(String(b.name || ''));
        })
        .map(col => ({
            code: col.code,
            name: col.name,
            group: col.group,
            resolve: vehicle => col.vehicles.has(vehicle) ? col.key : null,
        }));
}

function buildVpxRows(data) {
    const rowMap = {};
    data.forEach(task => {
        const rowKey = isKD2Module()
            ? [task.battalion_code || '', task.vehicle || '', task.vehicle_no || ''].join('||')
            : [task.vehicle || '', task.vehicle_no || ''].join('||');
        if (!rowMap[rowKey]) {
            rowMap[rowKey] = {
                battalion_code: task.battalion_code || '',
                vehicle: task.vehicle,
                vehicle_no: task.vehicle_no,
                stations: {},
                done: 0,
                total: 0,
            };
        }
        const stationKey = getVpxTaskStationKey(task);
        const existing = rowMap[rowKey].stations[stationKey];
        if (!existing || task.end_date > existing.end_date) {
            rowMap[rowKey].stations[stationKey] = task;
        }
        // Track completion for progress bar
        rowMap[rowKey].total++;
        const _s = calculateStatus(task);
        if (_s === 'Completed' || _s === 'Late Completion') rowMap[rowKey].done++;
    });

    return Object.values(rowMap).sort((a, b) => {
        if (isKD2Module()) {
            const battalionCmp = String(a.battalion_code || '').localeCompare(String(b.battalion_code || ''), undefined, { numeric: true });
            if (battalionCmp !== 0) return battalionCmp;
        }
        const vc = vehicleSort(a.vehicle, b.vehicle);
        if (vc !== 0) return vc;
        return naturalSort(a.vehicle_no, b.vehicle_no);
    });
}

function getVpxTitleParts() {
    const parts = [getModuleBadge()];
    const battalion = isKD2Module() ? getVal('filterBattalion') : '';
    const vehicle = getVal('filterVehicle');
    const unit = getVal('filterUnit');
    const category = getVal('filterCategory');
    if (battalion) parts.push(battalion);
    if (vehicle) parts.push(vehicle);
    if (unit) parts.push(unit);
    if (category) parts.push(category);
    parts.push(getVpxDisplayMeta().exportTitle);
    return parts;
}

function getVpxRowPrimaryLabel(row) {
    return isKD2Module() ? `${row.vehicle} · ${row.vehicle_no}` : row.vehicle_no;
}

function getVpxRowSecondaryLabel(row) {
    const unitCode = getUnitCode(row.vehicle, row.vehicle_no);
    if (isKD2Module()) return unitCode || '';
    return unitCode;
}

function getVpxExportLabel(row) {
    if (!isKD2Module()) return row.vehicle + '\n' + unitLabel(row.vehicle, row.vehicle_no);
    return [row.battalion_code || '—', `${row.vehicle} · ${unitLabel(row.vehicle, row.vehicle_no)}`].join('\n');
}

/* ──────────────────────────────────────────────────────────────────
   F100 VPX — Part × Process progress matrix
   ────────────────────────────────────────────────────────────────── */

// 8-color palette for F100 part group stripes (cycles if > 8 parts)
const F100_VPX_PART_COLORS = [
    'rgba(59,130,246,.7)',   // blue
    'rgba(168,85,247,.7)',   // purple
    'rgba(236,72,153,.7)',   // pink
    'rgba(245,158,11,.7)',   // amber
    'rgba(16,185,129,.7)',   // emerald
    'rgba(6,182,212,.7)',    // cyan
    'rgba(249,115,22,.7)',   // orange
    'rgba(132,204,22,.7)',   // lime
];

function buildF100VpxColumns(data) {
    const colMap = new Map();
    data.forEach(task => {
        const key = `${task.part_sort}||${task.part_id}||${task.process_sort}`;
        if (!colMap.has(key)) {
            colMap.set(key, {
                key,
                code:         `#${task.step_number}`,
                name:         task.process_name,
                group:        task.part_name,
                part_id:      task.part_id,
                part_sort:    task.part_sort,
                process_sort: task.process_sort,
            });
        }
    });
    return [...colMap.values()].sort((a, b) => {
        if (a.part_sort !== b.part_sort) return a.part_sort - b.part_sort;
        return a.process_sort - b.process_sort;
    });
}

function buildF100VpxRows(data) {
    const f100mode = document.getElementById('f100Mode')?.value || 'gun';
    const rowMap = {};
    // Both modes: one row per vehicle unit (battalion_code||vehicle_type||serial_number)
    // The mode only changes what PARTS/COLUMNS are shown, not the row granularity
    data.forEach(task => {
        const rowKey = [task.battalion_code || '—', task.vehicle_type || '—', task.serial_number ?? '—'].join('||');
        if (!rowMap[rowKey]) {
            rowMap[rowKey] = {
                battalion_code: task.battalion_code || '—',
                vehicle_type:   task.vehicle_type   || null,
                serial_number:  task.serial_number  ?? null,
                unit_label:     task.unit_label     || '',
                unit_code:      task.unit_code      || '',
                unit_name:      task.unit_name      || '',
                done: 0, total: 0,
                plans: {},
            };
        }
        const planKey = `${task.part_id}||${task.process_sort}`;
        if (!rowMap[rowKey].plans[planKey]) {
            rowMap[rowKey].plans[planKey] = task;
            rowMap[rowKey].total++;
            const _s = calculateStatus(task);
            if (_s === 'Completed' || _s === 'Late Completion') rowMap[rowKey].done++;
        }
    });

    // Sort by battalion → vehicle type → serial number
    return Object.values(rowMap).sort((a, b) => {
        const bc = (a.battalion_code || '').localeCompare(b.battalion_code || '', undefined, { numeric: true });
        if (bc !== 0) return bc;
        const vc = vehicleSort(a.vehicle_type, b.vehicle_type);
        if (vc !== 0) return vc;
        return (a.serial_number ?? 0) - (b.serial_number ?? 0);
    });
}

function renderF100VPX(data) {
    const container = document.getElementById('vpxMatrix');
    if (!container) return;

    if (!data?.length) {
        container.innerHTML = '<div class="vpx-empty">Load F100 data to view the progress matrix.</div>';
        return;
    }

    const f100mode = document.getElementById('f100Mode')?.value || 'gun';
    const cols = buildF100VpxColumns(data);
    const rows = buildF100VpxRows(data);

    if (!cols.length) {
        container.innerHTML = '<div class="vpx-empty">No process steps found for the current filters.</div>';
        return;
    }

    // Column groups (by part name) + assign colors
    const groups = [];
    const partColorMap = {};
    let partColorIdx = 0;
    cols.forEach(col => {
        if (!groups.length || groups[groups.length - 1].label !== col.group) {
            groups.push({ label: col.group, span: 1 });
            if (!(col.part_id in partColorMap)) {
                partColorMap[col.part_id] = F100_VPX_PART_COLORS[partColorIdx % F100_VPX_PART_COLORS.length];
                partColorIdx++;
            }
        } else {
            groups[groups.length - 1].span++;
        }
    });

    function grpSlug(g) { return 'f100-part-' + g.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

    let html = '<table class="vpx-table" role="grid"><thead>';

    // Header row 1: part group names
    html += `<tr class="vpx-group-row"><th class="vpx-th-vehicle" rowspan="2">Vehicle Unit</th>`;
    let gPartIdx = 0;
    groups.forEach(g => {
        const partId = cols.find(c => c.group === g.label)?.part_id;
        const color = partColorMap[partId] || F100_VPX_PART_COLORS[gPartIdx % F100_VPX_PART_COLORS.length];
        gPartIdx++;
        html += `<th class="vpx-th-group" colspan="${g.span}" style="box-shadow:inset 0 2px 0 ${color}">${esc(g.label)}</th>`;
    });
    html += '</tr><tr class="vpx-col-row">';

    // Header row 2: step code + process name
    cols.forEach((col, ci) => {
        const color = partColorMap[col.part_id] || F100_VPX_PART_COLORS[0];
        html += `<th class="vpx-th-col" data-col="${ci}" title="${esc(col.group + ' · ' + col.code + ' ' + col.name)}" style="box-shadow:inset 0 -2px 0 ${color.replace('.7', '.55')}"><span class="vpx-col-step">${esc(col.code)}</span><span class="vpx-col-name">${esc(col.name)}</span></th>`;
    });
    html += '</tr></thead><tbody>';

    let prevBattalion = null;

    rows.forEach((row, ri) => {
        // Always group rows by battalion (section divider)
        if (row.battalion_code !== prevBattalion) {
            html += '<tr class="vpx-row vpx-row-group vpx-row-battalion">';
            html += '<td class="vpx-td-vehicle vpx-td-group vpx-td-battalion" colspan="1">'
                + '<div class="vpx-grp-inner">'
                + '<svg class="vpx-bat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 9h4M4 6h8M4 12h8"/></svg>'
                + `<span class="vpx-battalion-name">${esc(row.battalion_code)}</span>`
                + '</div></td>';
            cols.forEach(() => { html += '<td class="vpx-group-fill vpx-group-battalion"></td>'; });
            html += '</tr>';
            prevBattalion = row.battalion_code;
        }

        // Data row — each row is one vehicle unit
        const rowLabel = [row.unit_code, row.unit_name].filter(Boolean).join(' · ')
            || (row.vehicle_type ? `${row.vehicle_type} #${row.serial_number ?? '?'}` : `#${row.serial_number ?? '?'}`);
        const rowSubLabel = row.vehicle_type && row.serial_number != null ? `${row.vehicle_type} #${row.serial_number}` : '';
        const rowPct = row.total > 0 ? Math.round((row.done / row.total) * 100) : 0;
        const rowPctHtml = row.total > 0
            ? `<div class="vpx-unit-pct-row"><div class="vpx-unit-pct-bar-wrap"><div class="vpx-unit-pct-bar-fill" style="width:${rowPct}%"></div></div><span class="vpx-unit-pct-text">${row.done}/${row.total} (${rowPct}%)</span></div>`
            : '';
        html += `<tr class="vpx-row" data-ri="${ri}">`;
        html += '<td class="vpx-td-vehicle vpx-td-unit">'
            + '<div class="vpx-unit-inner"><span class="vpx-unit-dot"></span>'
            + '<div class="vpx-unit-text">'
            + `<span class="vpx-unit-name">${esc(rowLabel)}</span>`
            + (rowSubLabel ? `<span class="vpx-unit-code">${esc(rowSubLabel)}</span>` : '')
            + rowPctHtml
            + '</div></div></td>';

        cols.forEach((col, ci) => {
            const planKey = `${col.part_id}||${col.process_sort}`;
            const task = row.plans[planKey];

            if (!task) {
                html += `<td class="vpx-cell vpx-cell-empty" data-ri="${ri}" data-ci="${ci}" title="${esc(col.group + ' · ' + col.name)} — not planned">—</td>`;
                return;
            }

            const status = calculateStatus(task); // dynamic so Overdue is detected
            const dotClass = status === 'Completed'      ? 'vpx-dot-ok'
                           : status === 'In Progress'    ? 'vpx-dot-prog'
                           : status === 'Late Completion' ? 'vpx-dot-late'
                           : status === 'Overdue'        ? 'vpx-dot-over'
                           :                              'vpx-dot-plan';
            const statusSlug = status.toLowerCase().replace(/\s+/g, '-').replace('late-completion', 'late');

            const planRange = formatDateShort(task.planned_start_date) + ' → ' + formatDateShort(task.planned_end_date);
            const actRange  = task.actual_start_date
                ? formatDateShort(task.actual_start_date) + ' → ' + (task.actual_end_date ? formatDateShort(task.actual_end_date) : '?')
                : null;

            const unitInfo = f100mode === 'vehicle'
                ? [task.vehicle_type, task.serial_number != null ? `#${task.serial_number}` : null].filter(Boolean).join(' ')
                : (task.battalion_code || '—');
            const tip = [
                unitInfo,
                task.unit_label ? `Unit Label : ${task.unit_label}` : null,
                task.unit_code  ? `Unit Code  : ${task.unit_code}` : null,
                task.unit_name  ? `Unit Name  : ${task.unit_name}` : null,
                row.total > 0   ? `Progress   : ${row.done}/${row.total} (${Math.round((row.done/row.total)*100)}%)` : null,
                `${task.part_name} · #${task.step_number} ${task.process_name}`,
                `Planned : ${formatDate(task.planned_start_date)} → ${formatDate(task.planned_end_date)}`,
                task.actual_start_date ? `Actual  : ${formatDate(task.actual_start_date)} → ${task.actual_end_date ? formatDate(task.actual_end_date) : '?'}` : null,
                `Status  : ${status}`,
            ].filter(Boolean).join('\n');

            html += `<td class="vpx-cell vpx-status-${statusSlug}" data-ri="${ri}" data-ci="${ci}" title="${tip.replace(/"/g, "'")}">`
                + `<span class="vpx-dot ${dotClass}"></span>`
                + '<div class="vpx-dates">'
                + `<span class="vpx-date-plan">${planRange}</span>`
                + `<span class="vpx-date-act${actRange ? '' : ' vpx-date-none'}">${actRange || '—'}</span>`
                + '</div></td>';
        });

        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function renderVPX(data) {
    if (isF100KD2Module()) { renderF100VPX(data); return; }

    _vpxLastData = data;

    const container = document.getElementById('vpxMatrix');
    if (!container) return;
    const meta = getVpxDisplayMeta();

    if (!data?.length) {
        container.innerHTML = `<div class="vpx-empty">${meta.emptyMessage}</div>`;
        _renderVpxTypeTabs([]);
        _renderVpxCategoryTabs([]);
        return;
    }

    if (isKD2Module()) {
        const types = _detectVpxVehicleTypes(data);
        if (!types.includes(_vpxVehicleTypeFilter)) _vpxVehicleTypeFilter = types[0] || null;
        _renderVpxTypeTabs(types);

        if (_vpxVehicleTypeFilter) {
            const byType = data.filter(t => _getVehicleType(t.vehicle) === _vpxVehicleTypeFilter);
            const rt = getModuleRuntime?.();
            const compMap = (_vpxVehicleTypeFilter === 'K9' && rt?.getStationCategoryMap)
                ? rt.getStationCategoryMap('K9') : null;
            const categories = _detectVpxCategories(_vpxVehicleTypeFilter, byType, compMap);
            if (!categories.includes(_vpxCategoryFilter)) _vpxCategoryFilter = categories[0] || null;
            _renderVpxCategoryTabs(categories);
        } else {
            _renderVpxCategoryTabs([]);
        }
        data = _getVpxFilteredData(data);
    } else {
        _renderVpxCategoryTabs([]);
    }

    const rows = buildVpxRows(data);
    const activeCols = buildVpxColumns(data).filter(col =>
        rows.some(row => { const k = col.resolve(row.vehicle); return k !== null && row.stations[k]; })
    );

    if (!activeCols.length) {
        container.innerHTML = `<div class="vpx-empty">${meta.noColumnsMessage}</div>`;
        return;
    }

    // Column group spans + color map (mirrors F100 VPX palette)
    const groups = [];
    const grpColorMap = {};
    let grpColorIdx = 0;
    activeCols.forEach(col => {
        if (!groups.length || groups[groups.length - 1].label !== col.group) {
            groups.push({ label: col.group, span: 1 });
            if (!(col.group in grpColorMap)) {
                grpColorMap[col.group] = F100_VPX_PART_COLORS[grpColorIdx % F100_VPX_PART_COLORS.length];
                grpColorIdx++;
            }
        } else {
            groups[groups.length - 1].span++;
        }
    });

    function grpSlug(g) { return g.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

    let html = '<table class="vpx-table" role="grid"><thead>';

    // Group header row — colored top border matching F100 style
    html += `<tr class="vpx-group-row"><th class="vpx-th-vehicle" rowspan="2">${meta.headerLabel.replace(/ · /g, ' &middot; ')}</th>`;
    groups.forEach(g => {
        const color = grpColorMap[g.label] || F100_VPX_PART_COLORS[0];
        html += '<th class="vpx-th-group vpx-grp-' + grpSlug(g.label) + '" colspan="' + g.span + '" style="box-shadow:inset 0 2px 0 ' + color + '">' + g.label + '</th>';
    });
    html += '</tr><tr class="vpx-col-row">';
    activeCols.forEach((col, ci) => {
        const color = grpColorMap[col.group] || F100_VPX_PART_COLORS[0];
        const tip = esc(col.group + ' · ' + col.code + (col.code !== col.name ? ' ' + col.name : ''));
        html += '<th class="vpx-th-col vpx-grp-' + grpSlug(col.group) + '" data-col="' + ci + '" title="' + tip + '" style="box-shadow:inset 0 -2px 0 ' + color.replace('.7', '.55') + '"><span class="vpx-col-step">' + esc(col.code) + '</span><span class="vpx-col-name">' + esc(col.name !== col.code ? col.name : '') + '</span></th>';
    });
    html += '</tr></thead><tbody>';

    rows.forEach((row, ri) => {
        const prevRow = ri > 0 ? rows[ri - 1] : null;
        const prevBattalion = prevRow?.battalion_code || null;
        const prevVehicle = prevRow?.vehicle || null;

        if (isKD2Module()) {
            // Battalion group row — sticks below the column header
            if (row.battalion_code !== prevBattalion) {
                html += '<tr class="vpx-row vpx-row-group vpx-row-battalion">';
                html += '<td class="vpx-td-vehicle vpx-td-group vpx-td-battalion" colspan="1">'
                    + '<div class="vpx-grp-inner">'
                    + '<svg class="vpx-bat-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 9h4M4 6h8M4 12h8"/></svg>'
                    + '<span class="vpx-battalion-name">' + esc(row.battalion_code || '—') + '</span>'
                    + '</div>'
                    + '</td>';
                activeCols.forEach(() => { html += '<td class="vpx-group-fill vpx-group-battalion"></td>'; });
                html += '</tr>';
            }
            // Vehicle group row — sticks below the battalion row
            if (row.vehicle !== prevVehicle) {
                html += '<tr class="vpx-row vpx-row-group vpx-row-vehicle">';
                html += '<td class="vpx-td-vehicle vpx-td-group" colspan="1">'
                    + '<div class="vpx-grp-inner">'
                    + '<span class="vpx-veh-badge">' + esc(row.vehicle) + '</span>'
                    + '</div>'
                    + '</td>';
                activeCols.forEach(() => { html += '<td class="vpx-group-fill vpx-group-vehicle"></td>'; });
                html += '</tr>';
            }
        } else if (row.vehicle !== prevVehicle) {
            // For KD1, add group header only for vehicle changes
            html += '<tr class="vpx-row vpx-row-group">';
            html += '<td class="vpx-td-vehicle vpx-td-group" colspan="1">'
                + '<div class="vpx-grp-inner">'
                + '<span class="vpx-veh-badge">' + esc(row.vehicle) + '</span>'
                + '</div>'
                + '</td>';
            activeCols.forEach(() => { html += '<td class="vpx-group-fill"></td>'; });
            html += '</tr>';
        }

        html += '<tr class="vpx-row" data-ri="' + ri + '">';
        var primaryLabel = getVpxRowPrimaryLabel(row);
        var secondaryLabel = getVpxRowSecondaryLabel(row);
        var rowPct = row.total > 0 ? Math.round((row.done / row.total) * 100) : 0;
        var rowPctHtml = row.total > 0
            ? '<div class="vpx-unit-pct-row"><div class="vpx-unit-pct-bar-wrap"><div class="vpx-unit-pct-bar-fill" style="width:' + rowPct + '%"></div></div><span class="vpx-unit-pct-text">' + row.done + '/' + row.total + ' (' + rowPct + '%)</span></div>'
            : '';
        var drEntry = isKD2Module() ? getDelayReasonEntry(row.vehicle, row.vehicle_no) : null;
        var drHasReason = !!(drEntry && drEntry.reason);
        var drBtnHtml = drEntry
            ? '<button type="button" class="vpx-delay-reason-btn' + (drHasReason ? ' has-reason' : '') + '"'
                + ' data-vpx-vehicle="' + esc(row.vehicle) + '" data-vpx-unit="' + esc(row.vehicle_no) + '"'
                + ' title="' + (drHasReason ? 'Delay reason: ' + esc(drEntry.reason) : 'Add a delay reason') + '">'
                + '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 2.5h7.5L13 5v8.5a1 1 0 01-1 1H3a1 1 0 01-1-1v-10a1 1 0 011-1z"/><path d="M9.5 2.5V5H13"/><path d="M4.5 8h5M4.5 10.5h3.5"/></svg>'
                + '</button>'
            : '';
        html += '<td class="vpx-td-vehicle vpx-td-unit">'
            + '<div class="vpx-unit-inner">'
            + '<span class="vpx-unit-dot"></span>'
            + '<div class="vpx-unit-text">'
            + '<span class="vpx-unit-name">' + esc(primaryLabel) + '</span>'
            + (secondaryLabel ? '<span class="vpx-unit-code">' + esc(secondaryLabel) + '</span>' : '')
            + rowPctHtml
            + '</div>'
            + drBtnHtml
            + '</div>'
            + '</td>';

        activeCols.forEach((col, ci) => {
            var grpCls = 'vpx-grp-' + grpSlug(col.group);
            var stationKey = col.resolve(row.vehicle);

            if (stationKey === null) {
                html += '<td class="vpx-cell vpx-cell-na ' + grpCls + '" data-ri="' + ri + '" data-ci="' + ci + '" title="' + col.name + ' — N/A for ' + esc(row.vehicle) + '"><span class="vpx-na">N/A</span></td>';
                return;
            }

            var task = row.stations[stationKey];
            if (!task) {
                html += '<td class="vpx-cell vpx-cell-empty ' + grpCls + '" data-ri="' + ri + '" data-ci="' + ci + '" title="' + col.name + ' — not yet planned">—</td>';
                return;
            }

            var status = calculateStatus(task);
            var planned = task.end_date;
            var actual = (task.progress && task.progress.completion_date) || null;
            var actStart = (task.progress && task.progress.actual_start_date) || null;

            var dotClass = status === 'Completed' ? 'vpx-dot-ok'
                : status === 'In Progress' ? 'vpx-dot-prog'
                    : status === 'Late Completion' ? 'vpx-dot-late'
                        : status === 'Overdue' ? 'vpx-dot-over'
                            : 'vpx-dot-plan';

            var tipParts = [
                col.code + '  ' + task.process_station,
                'Planned    : ' + formatDate(task.start_date) + ' \u2192 ' + formatDate(planned),
                actStart ? 'Actual start: ' + formatDate(actStart) : null,
                actual ? 'Completed   : ' + formatDate(actual) : null,
                'Status     : ' + status,
                task.remark ? 'Remark      : ' + task.remark : null,
            ].filter(Boolean).join('\n');

            var statusSlug = status.toLowerCase().replace(/\s+/g, '-').replace('late-completion', 'late');

            // Short date ranges for planned and actual (no year)
            var planRange = formatDateShort(task.start_date) + ' → ' + formatDateShort(planned);
            var actRange = actStart
                ? formatDateShort(actStart) + ' → ' + (actual ? formatDateShort(actual) : '?')
                : (actual ? '? → ' + formatDateShort(actual) : null);

            html += '<td class="vpx-cell ' + grpCls + ' vpx-status-' + statusSlug + '" data-ri="' + ri + '" data-ci="' + ci + '" title="' + tipParts.replace(/"/g, "'") + '">'
                + '<span class="vpx-dot ' + dotClass + '"></span>'
                + '<div class="vpx-dates">'
                + '<span class="vpx-date-plan">' + planRange + '</span>'
                + '<span class="vpx-date-act' + (actRange ? '' : ' vpx-date-none') + '">' + (actRange || '—') + '</span>'
                + '</div></td>';
        });

        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}
function renderCharts(data) {
    renderBarChart(data);
    renderLineChart(data);
    renderF100ExtraCharts(data);
    renderKD2BottleneckChart(data);
    // Charts get created before the grid's layout has necessarily settled
    // (font swap, a section flipping from display:none in the same tick) —
    // resize once after this frame, then keep watching for further shifts.
    _resizeAllCharts();
    _watchChartsGridResize();
}

/* ── KD2 Station Bottleneck chart ───────────────────────────────── */
let _kd2BottleneckChartInst = null;
function renderKD2BottleneckChart(data) {
    const card   = document.getElementById('kd2BottleneckCard');
    const canvas = document.getElementById('kd2BottleneckChart');
    if (!card || !canvas) return;

    if (_kd2BottleneckChartInst) { try { _kd2BottleneckChartInst.destroy(); } catch {} _kd2BottleneckChartInst = null; }

    if (!isKD2Module() || !data.length) { card.style.display = 'none'; return; }
    card.style.display = '';

    // Build per-(vehicle, station) delay stats — each vehicle's station is a separate entry
    const stationMap = new Map();
    data.forEach(r => {
        const vtype = _getVehicleType(r.vehicle) || 'Unknown';
        const name  = r.process_station || '(Unknown)';
        const key   = `${vtype}||${name}`;
        if (!stationMap.has(key)) stationMap.set(key, { name, vtype, total: 0, delayed: 0, delaySum: 0, maxDelay: 0 });
        const s = stationMap.get(key);
        s.total++;
        const d = delayDays(r);
        if (d > 0) { s.delayed++; s.delaySum += d; if (d > s.maxDelay) s.maxDelay = d; }
    });

    const rt = getModuleRuntime();
    const k9CatMap = rt?.getStationCategoryMap ? rt.getStationCategoryMap('K9') : new Map();
    const vtypeRouteOrders = {};
    ['K9', 'K10', 'K11'].forEach(v => {
        vtypeRouteOrders[v] = rt?.getStationRouteOrder ? rt.getStationRouteOrder(v) : new Map();
    });

    const stations = [...stationMap.values()]
        .map(s => {
            const component = s.vtype === 'K9' ? (k9CatMap.get(s.name)?.component_group || null) : null;
            return { ...s, component };
        })
        .sort((a, b) => {
            // Sort by vehicle first, then by route order within vehicle
            if (a.vtype !== b.vtype) return a.vtype.localeCompare(b.vtype);
            const sa = (vtypeRouteOrders[a.vtype]?.get(a.name)) ?? 9999;
            const sb = (vtypeRouteOrders[b.vtype]?.get(b.name)) ?? 9999;
            return sa - sb;
        })
        .slice(0, 20);

    const c      = themeChartColors();
    // Label: "StationName  (Component)  [Vtype]" — component only for K9
    const labels = stations.map(s => {
        let lbl = s.name;
        if (s.component) lbl += `  (${s.component})`;
        lbl += `  [${s.vtype}]`;
        return lbl;
    });
    const maxs   = stations.map(s => s.maxDelay);
    const colors = maxs.map(v => v >= 14 ? 'rgba(239,68,68,.82)' : v >= 7 ? 'rgba(245,158,11,.82)' : v >= 1 ? 'rgba(59,130,246,.75)' : 'rgba(148,163,184,.38)');

    const sub = document.getElementById('kd2BottleneckSubtitle');
    const withDelays = stations.filter(s => s.delayed > 0).length;
    if (sub) sub.textContent = `${withDelays} of ${stations.length} station${stations.length !== 1 ? 's' : ''} with delays · in process order`;

    _kd2BottleneckChartInst = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Max Delay (days)',
                data: maxs,
                backgroundColor: colors,
                borderRadius: 4,
                borderWidth: 0,
            }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: ctx => ctx[0].label,
                        label: ctx => {
                            const s = stations[ctx.dataIndex];
                            const lines = [];
                            if (s.maxDelay === 0) {
                                lines.push(`  No delays  ·  ${s.total} task${s.total !== 1 ? 's' : ''}`);
                            } else {
                                lines.push(`  Max ${s.maxDelay}d delay  ·  ${s.delayed} delayed / ${s.total} total`);
                            }
                            lines.push(`  Vehicle: ${s.vtype}`);
                            if (s.component) lines.push(`  Component: ${s.component}`);
                            return lines;
                        },
                    },
                },
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { color: c.text, font: { family: 'Inter', size: 10 }, callback: v => v + 'd' },
                    grid: { color: c.grid },
                    title: { display: true, text: 'Max Delay (days, worst delayed task per station)', color: c.text, font: { family: 'Inter', size: 10 } },
                },
                y: {
                    ticks: { color: c.text, font: { family: 'Inter', size: 10 } },
                    grid: { display: false },
                },
            },
        },
    });
}

/* Extra charts shown only in F100-KD2: status donut, process-step bar, vehicle-type bar */
let _f100ChartStatus = null, _f100ChartStep = null, _f100ChartVtype = null;
function renderF100ExtraCharts(data) {
    const section = document.getElementById('f100ChartsSection');
    if (!section) return;

    // Destroy old instances
    [_f100ChartStatus, _f100ChartStep, _f100ChartVtype].forEach(c => { try { c?.destroy(); } catch {} });
    _f100ChartStatus = _f100ChartStep = _f100ChartVtype = null;

    if (!isF100KD2Module() || !data.length) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';

    const c = themeChartColors();
    const STATUS_COLORS = {
        'Planned':         '#94a3b8',
        'In Progress':     '#f59e0b',
        'Completed':       '#22c55e',
        'Late Completion': '#3b82f6',
        'Overdue':         '#ef4444',
    };

    // ── 1. Status distribution donut ─────────────────────────────
    const statusKeys = Object.keys(STATUS_COLORS);
    const statusCounts = statusKeys.map(k => data.filter(r => calculateStatus(r) === k).length);
    // Only show statuses that actually have data
    const activeStatuses = statusKeys.filter((_, i) => statusCounts[i] > 0);
    const activeCounts   = activeStatuses.map(k => data.filter(r => calculateStatus(r) === k).length);
    const canvasStatus = document.getElementById('f100ChartStatus');
    if (canvasStatus) {
        _f100ChartStatus = new Chart(canvasStatus, {
            type: 'doughnut',
            data: {
                labels: activeStatuses,
                datasets: [{
                    data: activeCounts,
                    backgroundColor: activeStatuses.map(k => STATUS_COLORS[k]),
                    borderColor: getCurrentTheme() === 'light' ? '#f8fafc' : '#161b27',
                    borderWidth: 2,
                    hoverOffset: 6,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { position: 'right', labels: { color: c.text, font: { family: 'Inter', size: 11 }, boxWidth: 12, padding: 10 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${Math.round(ctx.parsed / data.length * 100)}%)` } },
                },
            },
        });
    }

    // ── 2. Process step completion — group by part when multiple parts shown ──
    // Build step map keyed by part+step to preserve uniqueness across parts
    const uniquePartNames = [...new Set(data.map(r => r.part_name).filter(Boolean))];
    const multiPart = uniquePartNames.length > 1;

    const stepMap = {};
    data.forEach(r => {
        // Key uniquely by part + step; when multi-part, prefix label with abbreviated part name
        const key = `${r.part_sort}||${r.part_id}||${r.process_sort}`;
        if (!stepMap[key]) {
            const partAbbr = multiPart
                ? (r.part_name || '').split(/\s+/).map(w => w[0]).join('').toUpperCase().substring(0, 4)
                : '';
            const label = r.step_number
                ? (multiPart ? `[${partAbbr}] #${r.step_number} ${r.process_name}` : `#${r.step_number} ${r.process_name}`)
                : (multiPart ? `[${partAbbr}] ${r.process_name}` : r.process_name);
            stepMap[key] = { label, partSort: r.part_sort, procSort: r.process_sort, done: 0, total: 0 };
        }
        stepMap[key].total++;
        const s = calculateStatus(r);
        if (s === 'Completed' || s === 'Late Completion') stepMap[key].done++;
    });
    const steps = Object.values(stepMap).sort((a, b) => a.partSort !== b.partSort ? a.partSort - b.partSort : a.procSort - b.procSort);
    const stepLabels = steps.map(s => s.label);
    const stepPcts   = steps.map(s => s.total ? Math.round(s.done / s.total * 100) : 0);
    const stepTotals = steps.map(s => s.total);

    // Update chart card subtitle with current scope
    const stepSubEl = document.querySelector('#f100ChartsSection .f100-chart-card:nth-child(2) .chart-subtitle');
    if (stepSubEl) {
        stepSubEl.textContent = multiPart
            ? `Showing ${steps.length} steps across ${uniquePartNames.length} parts — filter by Gun Part for detail`
            : `${uniquePartNames[0] || 'All parts'} · ${steps.length} process steps`;
    }

    const canvasStep = document.getElementById('f100ChartStep');
    if (canvasStep) {
        _f100ChartStep = new Chart(canvasStep, {
            type: 'bar',
            data: {
                labels: stepLabels,
                datasets: [{
                    label: '% Complete',
                    data: stepPcts,
                    backgroundColor: stepPcts.map(p => p >= 100 ? 'rgba(34,197,94,.8)' : p >= 50 ? 'rgba(245,158,11,.8)' : 'rgba(59,130,246,.75)'),
                    borderRadius: 4,
                    borderWidth: 0,
                }],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ${ctx.parsed.x}% complete`,
                            afterLabel: ctx => ` Based on ${stepTotals[ctx.dataIndex]} unit(s)`,
                        },
                    },
                },
                scales: {
                    x: { min: 0, max: 100, ticks: { color: c.text, callback: v => v + '%', font: { size: 10 } }, grid: { color: c.grid } },
                    y: { ticks: { color: c.text, font: { size: 9 } }, grid: { display: false } },
                },
            },
        });
    }

    // ── 3. Context-aware third chart ──────────────────────────────
    // Gun mode (only K9): show completion by GUN PART (meaningful)
    // Vehicle mode (multiple types): show completion by vehicle type
    const vtOrder = ['K9', 'K10', 'K11'];
    const vtypes = [...new Set(data.map(r => r.vehicle_type).filter(Boolean))].sort((a, b) => {
        const ai = vtOrder.indexOf(a); const bi = vtOrder.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    const isGunMode = vtypes.length <= 1 && (vtypes[0] === 'K9' || !vtypes[0]);

    // Update card title & subtitle
    const vtCard = document.getElementById('f100ChartVtype')?.closest('.f100-chart-card');
    if (vtCard) {
        const titleEl = vtCard.querySelector('.chart-title');
        const subEl   = vtCard.querySelector('.chart-subtitle');
        if (isGunMode) {
            if (titleEl) titleEl.textContent = 'Completion by Gun Part';
            if (subEl)   subEl.textContent   = '% complete and task count per gun part';
        } else {
            if (titleEl) titleEl.textContent = 'Completion by Vehicle Type';
            if (subEl)   subEl.textContent   = '% complete and total tasks per vehicle type';
        }
    }

    const canvasVtype = document.getElementById('f100ChartVtype');
    if (canvasVtype) {
        if (isGunMode) {
            // Group by gun part
            const partData = uniquePartNames.map(pname => {
                const rows = data.filter(r => r.part_name === pname);
                const done = rows.filter(r => { const s = calculateStatus(r); return s === 'Completed' || s === 'Late Completion'; }).length;
                return { pname, pct: rows.length ? Math.round(done / rows.length * 100) : 0, total: rows.length };
            });
            // Sort by part sort order (use first row's part_sort for each part)
            const partSortMap = {};
            data.forEach(r => { if (r.part_name && !(r.part_name in partSortMap)) partSortMap[r.part_name] = r.part_sort; });
            partData.sort((a, b) => (partSortMap[a.pname] || 0) - (partSortMap[b.pname] || 0));

            _f100ChartVtype = new Chart(canvasVtype, {
                type: 'bar',
                data: {
                    labels: partData.map(p => p.pname),
                    datasets: [
                        {
                            label: '% Complete',
                            data: partData.map(p => p.pct),
                            backgroundColor: partData.map(p => p.pct >= 100 ? 'rgba(34,197,94,.8)' : p.pct >= 50 ? 'rgba(245,158,11,.75)' : 'rgba(59,130,246,.75)'),
                            borderRadius: 5, borderWidth: 0, yAxisID: 'yPct',
                        },
                        {
                            label: 'Tasks',
                            data: partData.map(p => p.total),
                            backgroundColor: 'rgba(148,163,184,.35)',
                            borderRadius: 5, borderWidth: 0, yAxisID: 'yCount',
                        },
                    ],
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { labels: { color: c.text, font: { family: 'Inter', size: 10 }, boxWidth: 10 } },
                        tooltip: { callbacks: { label: ctx => ctx.datasetIndex === 0 ? ` ${ctx.parsed.y}% complete` : ` ${ctx.parsed.y} tasks` } },
                    },
                    scales: {
                        yPct:   { type: 'linear', position: 'left',  min: 0, max: 100, ticks: { color: c.text, callback: v => v + '%', font: { size: 10 } }, grid: { color: c.grid } },
                        yCount: { type: 'linear', position: 'right', beginAtZero: true, ticks: { color: c.text, font: { size: 10 }, stepSize: 1 }, grid: { display: false } },
                        x:      { ticks: { color: c.text, font: { size: 9 }, maxRotation: 30 }, grid: { display: false } },
                    },
                },
            });
        } else {
            // Vehicle mode — completion by vehicle type
            const vtDone  = vtypes.map(vt => { const r = data.filter(x => x.vehicle_type === vt); const d = r.filter(x => { const s = calculateStatus(x); return s === 'Completed' || s === 'Late Completion'; }).length; return r.length ? Math.round(d / r.length * 100) : 0; });
            const vtTotal = vtypes.map(vt => data.filter(x => x.vehicle_type === vt).length);
            _f100ChartVtype = new Chart(canvasVtype, {
                type: 'bar',
                data: {
                    labels: vtypes,
                    datasets: [
                        { label: '% Complete', data: vtDone,  backgroundColor: 'rgba(34,197,94,.75)',  borderColor: '#22c55e', borderWidth: 1, borderRadius: 6, yAxisID: 'yPct' },
                        { label: 'Total Tasks', data: vtTotal, backgroundColor: 'rgba(59,130,246,.35)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 6, yAxisID: 'yCount' },
                    ],
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: c.text, font: { family: 'Inter', size: 11 }, boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => ctx.datasetIndex === 0 ? ` ${ctx.parsed.y}% complete` : ` ${ctx.parsed.y} tasks` } } },
                    scales: {
                        yPct:   { type: 'linear', position: 'left',  min: 0, max: 100, ticks: { color: c.text, callback: v => v + '%', font: { size: 10 } }, grid: { color: c.grid } },
                        yCount: { type: 'linear', position: 'right', beginAtZero: true, ticks: { color: c.text, font: { size: 10 }, stepSize: 1 }, grid: { display: false } },
                        x:      { ticks: { color: c.text, font: { size: 11 } }, grid: { display: false } },
                    },
                },
            });
        }
    }
}

function getChartGrouping(data) {
    if (isF100KD2Module()) {
        const battalions = [...new Set(data.map(row => row.battalion_code).filter(Boolean))].sort(naturalSort);
        if (battalions.length > 1) {
            return { keyLabel: 'battalion', labels: battalions, valueFor: row => row.battalion_code || 'Unknown' };
        }
        const vtOrder = ['K9', 'K10', 'K11'];
        const vtypes = [...new Set(data.map(row => row.vehicle_type).filter(Boolean))]
            .sort((a, b) => {
                const ai = vtOrder.indexOf(a); const bi = vtOrder.indexOf(b);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });
        if (vtypes.length > 1) {
            return { keyLabel: 'vehicle type', labels: vtypes, valueFor: row => row.vehicle_type || 'Unknown' };
        }
        const parts = [...new Set(data.map(row => row.part_name).filter(Boolean))].sort(naturalSort);
        return {
            keyLabel: 'part',
            labels: parts.length ? parts : ['All'],
            valueFor: row => row.part_name || 'All',
        };
    }

    if (!isKD2Module()) {
        return {
            keyLabel: 'vehicle',
            labels: [...new Set(data.map(row => row.vehicle).filter(Boolean))].sort(vehicleSort),
            valueFor: row => row.vehicle || 'Unknown',
        };
    }

    const battalions = [...new Set(data.map(row => row.battalion_code).filter(Boolean))].sort(naturalSort);
    if (battalions.length > 1) {
        return {
            keyLabel: 'battalion',
            labels: battalions,
            valueFor: row => row.battalion_code || 'Unknown',
        };
    }

    const vehicles = [...new Set(data.map(row => row.vehicle).filter(Boolean))].sort(vehicleSort);
    if (vehicles.length > 1) {
        return {
            keyLabel: 'vehicle',
            labels: vehicles,
            valueFor: row => row.vehicle || 'Unknown',
        };
    }

    const units = [...new Set(data.map(row => row.vehicle_no).filter(Boolean))].sort(naturalSort);
    if (units.length > 1) {
        return {
            keyLabel: 'unit',
            labels: units,
            valueFor: row => row.vehicle_no || 'Unknown',
        };
    }

    const categoryOrder = getActiveModuleConfig()?.categories || [];
    const categories = [...new Set(data.map(row => getModuleCategory(row.process_station, row)).filter(Boolean))]
        .sort((a, b) => {
            const aIdx = categoryOrder.indexOf(a);
            const bIdx = categoryOrder.indexOf(b);
            if (aIdx !== -1 || bIdx !== -1) {
                if (aIdx === -1) return 1;
                if (bIdx === -1) return -1;
                return aIdx - bIdx;
            }
            return naturalSort(a, b);
        });
    return {
        keyLabel: 'category',
        labels: categories,
        valueFor: row => getModuleCategory(row.process_station, row) || 'Other',
    };
}

/* ── Chart card expand (centered modal overlay) ─────────────────── */
let _resizeAllChartsTimer = null;
function _resizeAllCharts() {
    // Debounced — renderCharts() runs on every filter change/reload and the
    // ResizeObserver can fire many times in a burst (window drag, layout
    // settling); without this a rapid sequence stacks up redundant resize
    // passes over the same chart instances.
    if (_resizeAllChartsTimer) clearTimeout(_resizeAllChartsTimer);
    _resizeAllChartsTimer = setTimeout(() => {
        _resizeAllChartsTimer = null;
        [barChartInst, lineChartInst, _f100ChartStatus, _f100ChartStep, _f100ChartVtype, _kd2BottleneckChartInst]
            .forEach(c => { try { c?.resize(); } catch {} });
    }, 60);
}

/* Charts are created synchronously during the first render, sometimes before
   the grid/container has settled its final layout (font swap, a section
   flipping from display:none, scrollbar appearing) — Chart.js measures the
   canvas at creation time and doesn't re-measure on its own unless something
   external nudges it. A ResizeObserver on the charts grid catches any of
   those post-creation layout shifts and forces a resize, which is otherwise
   only ever triggered by accident via the browser's native fullscreen toggle. */
let _chartsGridResizeObserver = null;
function _watchChartsGridResize() {
    if (typeof ResizeObserver === 'undefined') return;
    if (!_chartsGridResizeObserver) _chartsGridResizeObserver = new ResizeObserver(() => _resizeAllCharts());
    document.querySelectorAll('.charts-grid, .f100-charts-grid').forEach(grid => {
        if (!grid.dataset.chartsResizeWatched) {
            grid.dataset.chartsResizeWatched = '1';
            _chartsGridResizeObserver.observe(grid);
        }
    });
}

function _closeChartExpand(card, btn) {
    card.classList.remove('chart-fullscreen');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Expand chart';
    document.getElementById('_chartExpandBackdrop')?.remove();
    _resizeAllCharts();
}

function toggleChartFullscreen(btn) {
    const card = btn.closest('.chart-card');
    if (!card) return;
    const isFs = card.classList.toggle('chart-fullscreen');
    btn.setAttribute('aria-pressed', String(isFs));
    btn.title = isFs ? 'Close' : 'Expand chart';

    if (isFs) {
        const backdrop = document.createElement('div');
        backdrop.id = '_chartExpandBackdrop';
        backdrop.className = 'chart-expand-backdrop';
        backdrop.addEventListener('click', () => _closeChartExpand(card, btn));
        document.body.appendChild(backdrop);
        const onKey = e => {
            if (e.key === 'Escape') { _closeChartExpand(card, btn); document.removeEventListener('keydown', onKey); }
        };
        document.addEventListener('keydown', onKey);
        _resizeAllCharts();
    } else {
        _closeChartExpand(card, btn);
    }
}

function updateChartHeadings(grouping) {
    const barTitle = document.getElementById('barChartTitle');
    const barSubtitle = document.getElementById('barChartSubtitle');
    const lineTitle = document.getElementById('lineChartTitle');
    const lineSubtitle = document.getElementById('lineChartSubtitle');
    const groupingLabel = grouping ? grouping.charAt(0).toUpperCase() + grouping.slice(1) : 'Vehicle';

    if (barTitle) barTitle.textContent = 'Status Breakdown';
    if (barSubtitle) {
        barSubtitle.textContent = `Planned · Completed · Late Completion · Overdue by ${groupingLabel}`;
    }
    if (lineTitle) lineTitle.textContent = 'Cumulative Progress';
    if (lineSubtitle) {
        lineSubtitle.textContent = isKD2Module()
            ? 'Planned block completion vs actual completion'
            : 'Planned Completion vs Actual';
    }
}

function renderBarChart(data) {
    const grouping = getChartGrouping(data);
    const labels = grouping.labels;
    updateChartHeadings(grouping.keyLabel);

    const counts = labels.map(label => {
        const rows = data.filter(row => grouping.valueFor(row) === label);
        return {
            planned: rows.filter(r => calculateStatus(r) === 'Planned').length,
            completed: rows.filter(r => calculateStatus(r) === 'Completed').length,
            late: rows.filter(r => calculateStatus(r) === 'Late Completion').length,
            overdue: rows.filter(r => calculateStatus(r) === 'Overdue').length,
        };
    });

    const cfg = {
        type: 'bar',
        data: {
            labels: labels.length ? labels : ['No Data'],
            datasets: [
                {
                    label: 'Planned',
                    data: counts.map(c => c.planned),
                    backgroundColor: 'rgba(59,130,246,.75)',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    borderRadius: 4,
                },
                {
                    label: 'Completed',
                    data: counts.map(c => c.completed),
                    backgroundColor: 'rgba(34,197,94,.75)',
                    borderColor: '#22c55e',
                    borderWidth: 1,
                    borderRadius: 4,
                },
                {
                    label: 'Late',
                    data: counts.map(c => c.late),
                    backgroundColor: 'rgba(59,130,246,.75)',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    borderRadius: 4,
                },
                {
                    label: 'Overdue',
                    data: counts.map(c => c.overdue),
                    backgroundColor: 'rgba(239,68,68,.75)',
                    borderColor: '#ef4444',
                    borderWidth: 1,
                    borderRadius: 4,
                },
            ],
        },
        options: chartOptions(isKD2Module() ? 'Plan Blocks' : 'Status Count'),
    };

    if (barChartInst) barChartInst.destroy();
    barChartInst = new Chart(document.getElementById('barChart'), cfg);
}

function renderLineChart(data) {
    // Build daily timeline between min start_date and today
    if (!data.length) {
        if (lineChartInst) lineChartInst.destroy();
        lineChartInst = null;
        updateChartHeadings(getChartGrouping(data).keyLabel);
        return;
    }

    const dates = data.map(r => r.end_date).sort();
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];

    const timeline = generateDateRange(minDate, maxDate);

    // Cumulative planned (tasks whose end_date <= date)
    const plannedCum = timeline.map(d =>
        data.filter(r => r.end_date <= d).length
    );

    // Cumulative actual completed (tasks completed by that date)
    const actualCum = timeline.map(d =>
        data.filter(r => {
            const s = calculateStatus(r);
            // F100 rows store completion date directly; F200 uses progress sub-object
            const cd = (r.module === 'gun' || r.module === 'vehicle') ? r.actual_end_date : r.progress?.completion_date;
            return (s === 'Completed' || s === 'Late Completion') && cd && cd <= d;
        }).length
    );

    const labels = timeline.map(d => formatDate(d));

    const cfg = {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Planned (cumulative)',
                    data: plannedCum,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59,130,246,.08)',
                    borderWidth: 2,
                    fill: true,
                    tension: .35,
                    pointRadius: timeline.length > 30 ? 0 : 3,
                },
                {
                    label: 'Actual (cumulative)',
                    data: actualCum,
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34,197,94,.08)',
                    borderWidth: 2,
                    fill: true,
                    tension: .35,
                    pointRadius: timeline.length > 30 ? 0 : 3,
                    borderDash: [],
                },
            ],
        },
        options: {
            ...chartOptions(isKD2Module() ? 'Cumulative Plan Blocks' : 'Cumulative Tasks'),
            scales: {
                x: {
                    ticks: {
                        color: themeChartColors().text,
                        font: { family: 'DM Mono', size: 10 },
                        maxTicksLimit: 10,
                        maxRotation: 45,
                    },
                    grid: { color: themeChartColors().grid },
                },
                y: {
                    ticks: {
                        color: themeChartColors().text,
                        font: { family: 'DM Mono', size: 11 },
                        stepSize: 1,
                    },
                    grid: { color: themeChartColors().grid },
                    beginAtZero: true,
                },
            },
        },
    };

    if (lineChartInst) lineChartInst.destroy();
    lineChartInst = new Chart(document.getElementById('lineChart'), cfg);
}

function chartOptions(yLabel) {
    const c = themeChartColors();
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    color: c.text,
                    font: { family: 'Inter', size: 11 },
                    boxWidth: 12,
                    padding: 14,
                },
            },
            tooltip: {
                backgroundColor: c.tooltipBg,
                borderColor: c.tooltipBdr,
                borderWidth: 1,
                titleColor: c.tooltipTtl,
                bodyColor: c.tooltipBdy,
                padding: 10,
            },
        },
        scales: {
            x: {
                ticks: { color: c.text, font: { family: 'DM Mono', size: 11 } },
                grid: { color: c.grid },
            },
            y: {
                ticks: {
                    color: c.text,
                    font: { family: 'DM Mono', size: 11 },
                    stepSize: 1,
                },
                grid: { color: c.grid },
                beginAtZero: true,
                title: {
                    display: true,
                    text: yLabel,
                    color: c.axisLabel,
                    font: { size: 10, family: 'Inter' },
                },
            },
        },
    };
}

/* ──────────────────────────────────────────────────────────────────
   10. MARK COMPLETE
   ────────────────────────────────────────────────────────────────── */
/* ──────────────────────────────────────────────────────────────────
   10. MARK COMPLETE  /  SAVE ACTUAL START
   ────────────────────────────────────────────────────────────────── */

/**
 * Called automatically when the inline date input changes.
 * Pass empty string to clear the start date back to null.
 */
async function saveActualStart(planId, dateValue) {
    if (!canWrite()) { showToast('Viewer accounts cannot edit data.', 'error'); return; }

    const valueToSave = dateValue || null;

    // F100: actual dates live directly in f100_plans, no separate progress table
    if (isF100KD2Module()) {
        markLocalSave();
        try {
            const row = currentData.find(t => String(t.id) === String(planId));
            // Compute new status: setting a start date moves Planned → In Progress
            // Clearing a start date with no end date reverts to Planned
            let newStatus = row?.status || 'Planned';
            if (valueToSave) {
                if (newStatus === 'Planned') newStatus = 'In Progress';
            } else {
                if (newStatus === 'In Progress') newStatus = 'Planned';
            }
            const { error } = await db
                .from('f100_plans')
                .update({ actual_start_date: valueToSave, status: newStatus, updated_at: new Date().toISOString() })
                .eq('id', planId);
            if (error) throw error;
            await auditLog('UPDATE', 'f100_plans', planId, null, { actual_start_date: valueToSave, status: newStatus });
            showToast(valueToSave ? 'Start date saved.' : 'Start date cleared.', 'success');
            if (row) {
                row.actual_start_date = valueToSave;
                row.status = newStatus;
                const updated = updateF100TableRowInPlace(planId);
                if (!updated) { const pos = saveScrollPos(); renderF100Table(currentData); restoreScrollPos(pos); }
                renderF100VPX(currentData);
            } else {
                const pos = saveScrollPos();
                await loadData();
                restoreScrollPos(pos);
            }
        } catch (err) {
            showToast('Error saving start date: ' + err.message, 'error');
            console.error(err);
        }
        return;
    }

    try {
        // Fetch ALL rows for this plan_id — guard against duplicate rows
        const progressTable = getModuleProgressTable();
        const { data: allRows } = await db
            .from(progressTable).select('*').eq('plan_id', planId).order('updated_at', { ascending: false });

        const snapBefore = allRows?.[0] || null;

        // If duplicates exist, delete the extras to keep the table clean
        if (allRows && allRows.length > 1) {
            const extraIds = allRows.slice(1).map(r => r.id);
            await db.from(progressTable).delete().in('id', extraIds);
        }

        if (snapBefore) {
            const { error } = await db
                .from(progressTable)
                .update({ actual_start_date: valueToSave, updated_at: new Date().toISOString() })
                .eq('id', snapBefore.id);
            if (error) throw error;
        } else if (valueToSave) {
            const { error } = await db
                .from(progressTable)
                .insert({ plan_id: planId, actual_start_date: valueToSave, completed: false, updated_at: new Date().toISOString() });
            if (error) throw error;
        }

        // Snapshot after for audit
        const { data: snapAfter } = await db
            .from(progressTable).select('*').eq('plan_id', planId).maybeSingle();

        await auditLog(
            snapBefore ? 'UPDATE' : 'INSERT',
            progressTable, planId, snapBefore || null, snapAfter || null
        );

        markLocalSave();
        showToast(valueToSave ? 'Start date saved.' : 'Start date cleared.', 'success');
        // In-place update: patch currentData and re-render without scroll reset
        // (planId is always a string from dataset.planId, row.id is a number —
        // must coerce both sides or this lookup silently never matches)
        const row = currentData.find(t => String(t.id) === String(planId));
        if (row) {
            row.progress = snapAfter || row.progress || {};
            row.progress.actual_start_date = valueToSave;
            if (!updateTableRowInPlace(planId)) refreshAllViews();
        } else {
            const pos = saveScrollPos();
            await loadData();
            restoreScrollPos(pos);
        }

    } catch (err) {
        showToast('Error saving start date: ' + err.message, 'error');
        console.error(err);
    }
}

async function saveCompletionDate(planId, dateValue, silent = false) {
    // silent = cancel — just reload display without writing
    if (silent) { refreshAllViews(); return; }
    if (!canWrite()) { showToast('Viewer accounts cannot edit data.', 'error'); return; }

    const valueToSave = dateValue || null;

    // F100: actual dates live directly in f100_plans
    if (isF100KD2Module()) {
        markLocalSave();
        try {
            const row = currentData.find(t => String(t.id) === String(planId));
            const newStatus = valueToSave ? 'Completed' : (row?.actual_start_date ? 'In Progress' : 'Planned');
            const { error } = await db
                .from('f100_plans')
                .update({ actual_end_date: valueToSave, status: newStatus, updated_at: new Date().toISOString() })
                .eq('id', planId);
            if (error) throw error;
            await auditLog('UPDATE', 'f100_plans', planId, null, { actual_end_date: valueToSave, status: newStatus });
            showToast(valueToSave ? 'Completion date saved.' : 'Completion date cleared.', 'success');
            if (row) {
                row.actual_end_date = valueToSave;
                row.status = newStatus;
                const updated = updateF100TableRowInPlace(planId);
                if (!updated) { const pos = saveScrollPos(); renderF100Table(currentData); restoreScrollPos(pos); }
                renderF100VPX(currentData);
            } else {
                const pos = saveScrollPos();
                await loadData();
                restoreScrollPos(pos);
            }
        } catch (err) {
            showToast('Error saving completion date: ' + err.message, 'error');
            console.error(err);
        }
        return;
    }

    try {
        const progressTable = getModuleProgressTable();
        const { data: allRowsC } = await db
            .from(progressTable).select('*').eq('plan_id', planId).order('updated_at', { ascending: false });

        const snapBefore = allRowsC?.[0] || null;

        if (allRowsC && allRowsC.length > 1) {
            const extraIds = allRowsC.slice(1).map(r => r.id);
            await db.from(progressTable).delete().in('id', extraIds);
        }

        if (snapBefore) {
            const { error } = await db
                .from(progressTable)
                .update({ completed: !!valueToSave, completion_date: valueToSave, updated_at: new Date().toISOString() })
                .eq('id', snapBefore.id);
            if (error) throw error;
        } else if (valueToSave) {
            const { error } = await db
                .from(progressTable)
                .insert({ plan_id: planId, completed: true, completion_date: valueToSave, updated_at: new Date().toISOString() });
            if (error) throw error;
        }

        const { data: snapAfter } = await db
            .from(progressTable).select('*').eq('plan_id', planId).maybeSingle();

        await auditLog(
            snapBefore ? 'UPDATE' : 'INSERT',
            progressTable, planId, snapBefore || null, snapAfter || null
        );

        markLocalSave();
        showToast(valueToSave ? 'Completion date saved.' : 'Completion date cleared.', 'success');
        const row2 = currentData.find(t => String(t.id) === String(planId));
        if (row2) {
            row2.progress = snapAfter || row2.progress || {};
            row2.progress.completed = !!valueToSave;
            row2.progress.completion_date = valueToSave;
            if (!updateTableRowInPlace(planId)) refreshAllViews();
        } else {
            const pos = saveScrollPos();
            await loadData();
            restoreScrollPos(pos);
        }

    } catch (err) {
        showToast('Error saving completion date: ' + err.message, 'error');
        console.error(err);
    }
}

/**
 * Save (or clear) just the notes field on an existing progress row.
 * Does NOT touch completed / completion_date.
 */
async function saveNoteOnly(planId, noteText) {
    if (isF100KD2Module()) {
        const valueToSave = noteText.trim() || null;
        try {
            const { error } = await db
                .from('f100_plans')
                .update({ notes: valueToSave, updated_at: new Date().toISOString() })
                .eq('id', planId);
            if (error) throw error;
            await auditLog('UPDATE', 'f100_plans', planId, null, { notes: valueToSave });
            const row = currentData.find(t => String(t.id) === String(planId));
            if (row) row.notes = valueToSave || '';
            showToast(valueToSave ? 'Note saved.' : 'Note deleted.', 'success');
        } catch (err) {
            showToast('Error saving note: ' + err.message, 'error');
            console.error(err);
        }
        return;
    }
    const valueToSave = noteText.trim() || null;
    try {
        const progressTable = getModuleProgressTable();
        const { data: existing } = await db
            .from(progressTable)
            .select('id, notes')
            .eq('plan_id', planId)
            .maybeSingle();

        if (existing) {
                const before = { notes: existing.notes };
                const { error } = await db
                    .from(progressTable)
                    .update({ notes: valueToSave, updated_at: new Date().toISOString() })
                    .eq('id', existing.id);
                if (error) throw error;
            await auditLog('UPDATE', progressTable, planId,
                before, { notes: valueToSave });
            showToast(valueToSave ? 'Note updated.' : 'Note deleted.', 'success');
        } else {
            showToast('No progress record found to update.', 'error');
        }
    } catch (err) {
        showToast('Error saving note: ' + err.message, 'error');
        console.error(err);
    }
}

async function saveF100Comment(planId, text) {
    markLocalSave();
    const user = getCurrentUser();
    const userName = user?.name || user?.email || 'Unknown';
    const newComment = { user: userName, text: text.trim(), at: new Date().toISOString() };
    const row = currentData.find(t => String(t.id) === String(planId));
    const current = Array.isArray(row?.comments) ? row.comments : [];
    const updated = [...current, newComment];
    const { error } = await db
        .from('f100_plans')
        .update({ comments: updated, updated_at: new Date().toISOString() })
        .eq('id', planId);
    if (error) throw error;
    if (row) row.comments = updated;
    saveNotifSnapshot();
    return updated;
}

async function saveKd2Comment(planId, text) {
    markLocalSave();
    const user = getCurrentUser();
    const userName = user?.name || user?.email || 'Unknown';
    const newComment = { user: userName, text: text.trim(), at: new Date().toISOString() };
    const row = currentData.find(t => String(t.id) === String(planId));
    const current = Array.isArray(row?.comments) ? row.comments : [];
    const updated = [...current, newComment];
    const { error } = await db
        .from('kd2_plan')
        .update({ comments: updated })
        .eq('id', planId);
    if (error) throw error;
    if (row) row.comments = updated;
    saveNotifSnapshot();
    return updated;
}

// ── F100 Comment Notifications (localStorage-backed) ──────────────────────────

function _notifStorageKey() {
    const user = getCurrentUser();
    return `f100_notif_read_${user?.email || user?.id || 'anon'}`;
}

function _notifSnapKey(moduleId) {
    const user = getCurrentUser();
    return `ppms_notif_snap_${moduleId}_${user?.email || user?.id || 'anon'}`;
}

function _getReadSet() {
    try { return new Set(JSON.parse(localStorage.getItem(_notifStorageKey()) || '[]')); }
    catch { return new Set(); }
}

function _saveReadSet(set) {
    try { localStorage.setItem(_notifStorageKey(), JSON.stringify([...set])); } catch {}
}

function _notifKey(planId, comment) {
    return `${planId}::${comment.at}`;
}

function _moduleLabel(moduleId) {
    if (moduleId === 'f100kd2') return 'F100-KD2';
    if (moduleId === 'kd2')    return 'F200-KD2';
    return 'F200-KD1';
}

// Save a snapshot of current module's notification-eligible comments to localStorage
// so they remain visible when the user switches to another module.
function saveNotifSnapshot() {
    const moduleId = getActiveModuleId();
    if (!currentData?.length) return;
    const user = getCurrentUser();
    const myName = user?.name || user?.email || '';
    const snap = [];
    currentData.forEach(row => {
        (Array.isArray(row.comments) ? row.comments : []).forEach(c => {
            if (c.user === myName) return;
            snap.push({
                key:        _notifKey(row.id, c),
                planId:     row.id,
                comment:    c,
                moduleId,
                rowInfo: {
                    vehicle:         row.vehicle      || row.vehicle_type  || '',
                    unit:            row.vehicle_no   || row.unit_code     || '',
                    process:         row.process_station || row.process_name || '',
                },
            });
        });
    });
    try { localStorage.setItem(_notifSnapKey(moduleId), JSON.stringify(snap)); } catch {}
}

function _issueNotifSnapKey(moduleId) {
    const u = getCurrentUser();
    return `ppms_issue_snap_${moduleId}_${u?.email || 'anon'}`;
}

function _storeIssueNotification(issueId, moduleId, title, category, reporter, createdAt, isUpdate) {
    // Key is per-issue-per-event-type (no timestamp) so broadcast and poll don't create duplicates
    const key = `issue::${issueId}::${isUpdate ? 'update' : 'new'}`;
    const snapKey = _issueNotifSnapKey(moduleId);
    let snap;
    try { snap = JSON.parse(localStorage.getItem(snapKey) || '[]'); } catch { snap = []; }
    const readSet = _getReadSet();
    if (readSet.has(key)) {
        // Already read before — evict so the new event re-notifies
        snap = snap.filter(n => n.key !== key);
    } else if (snap.some(n => n.key === key)) {
        return; // Already pending/unread — don't duplicate
    }
    snap.push({ key, issueId, type: 'issue', moduleId,
        issue: { title, category, reporter, created_at: createdAt, is_update: isUpdate } });
    try { localStorage.setItem(snapKey, JSON.stringify(snap)); } catch {}
}

function getUnreadNotifications() {
    const readSet = _getReadSet();
    const allSnap = [];
    ['f100kd2', 'kd2', 'kd1'].forEach(modId => {
        try {
            const raw = localStorage.getItem(_notifSnapKey(modId));
            if (raw) JSON.parse(raw).forEach(n => allSnap.push(n));
        } catch {}
        try {
            const raw = localStorage.getItem(_issueNotifSnapKey(modId));
            if (raw) JSON.parse(raw).forEach(n => allSnap.push(n));
        } catch {}
    });
    return allSnap.filter(n => !readSet.has(n.key));
}

function updateNotifBadge() {
    const wrap  = document.getElementById('f100NotifWrap');
    const badge = document.getElementById('f100NotifBadge');
    if (!wrap || !badge) return;
    const unread   = getUnreadNotifications();
    const activeId = getActiveModuleId();
    // Always show bell when there are unread notifications; otherwise only for kd2/f100kd2
    if (unread.length === 0 && activeId !== 'f100kd2' && activeId !== 'kd2') {
        wrap.style.display = 'none'; return;
    }
    wrap.style.display = '';
    if (unread.length > 0) {
        badge.textContent = unread.length > 99 ? '99+' : unread.length;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

function openNotifDropdown() {
    document.querySelectorAll('.f100-notif-dropdown').forEach(d => d.remove());
    const bell = document.getElementById('f100NotifBell');
    if (!bell) return;

    const currentModuleId = getActiveModuleId();
    const unread = getUnreadNotifications();
    const dropdown = document.createElement('div');
    dropdown.className = 'f100-notif-dropdown';

    function formatCommentTime(iso) {
        try {
            const d = new Date(iso);
            return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
                + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        } catch { return iso || ''; }
    }

    if (unread.length === 0) {
        dropdown.innerHTML = `
            <div class="f100-notif-header">Notifications <button class="f100-notif-close">✕</button></div>
            <div class="f100-notif-empty">No unread notifications</div>`;
    } else {
        const items = unread.map(n => {
            const isCrossModule = n.moduleId && n.moduleId !== currentModuleId;
            const modLabel = _moduleLabel(n.moduleId || currentModuleId);

            if (n.type === 'issue') {
                const cat = ISSUE_CATEGORY_LABELS?.[n.issue?.category] || n.issue?.category || '';
                const action = n.issue?.is_update ? 'Issue updated' : 'New issue';
                return `
                <div class="f100-notif-item f100-notif-item--issue${isCrossModule ? ' f100-notif-item-cross' : ''}"
                    data-issue-id="${n.issueId}" data-key="${esc(n.key)}" data-module-id="${esc(n.moduleId || currentModuleId)}" data-type="issue">
                    <div class="f100-notif-item-meta">
                        <span class="f100-notif-issue-tag">${action}</span>
                        <span class="f100-notif-module-badge">${esc(modLabel)}</span>
                        <span class="f100-notif-item-time">${formatCommentTime(n.issue?.created_at)}</span>
                    </div>
                    <div class="f100-notif-item-context">${esc(cat)}</div>
                    <div class="f100-notif-item-text">${esc(n.issue?.title || '—')}</div>
                    <div class="f100-notif-item-context" style="margin-top:2px">By ${esc(n.issue?.reporter || '?')}</div>
                    ${isCrossModule ? `<div class="f100-notif-item-switch">Click to switch to ${esc(modLabel)} →</div>` : ''}
                </div>`;
            }

            const ctx = [n.rowInfo?.vehicle, n.rowInfo?.unit, n.rowInfo?.process].filter(Boolean).join(' · ');
            return `
            <div class="f100-notif-item${isCrossModule ? ' f100-notif-item-cross' : ''}" data-plan-id="${n.planId}" data-key="${esc(n.key)}" data-module-id="${esc(n.moduleId || currentModuleId)}" data-type="comment">
                <div class="f100-notif-item-meta">
                    <strong>${esc(n.comment.user || '?')}</strong>
                    <span class="f100-notif-module-badge">${esc(modLabel)}</span>
                    <span class="f100-notif-item-time">${formatCommentTime(n.comment.at)}</span>
                </div>
                <div class="f100-notif-item-context">${esc(ctx)}</div>
                <div class="f100-notif-item-text">${esc(n.comment.text)}</div>
                ${isCrossModule ? `<div class="f100-notif-item-switch">Click to switch to ${esc(modLabel)} →</div>` : ''}
            </div>`;
        }).join('');
        dropdown.innerHTML = `
            <div class="f100-notif-header">
                Unread (${unread.length})
                <button class="f100-notif-mark-all">Mark all read</button>
                <button class="f100-notif-close">✕</button>
            </div>
            <div class="f100-notif-list">${items}</div>`;
    }

    document.body.appendChild(dropdown);
    const rect = bell.getBoundingClientRect();
    const dw = 340;
    let left = rect.right + window.scrollX - dw;
    if (left < 8) left = 8;
    dropdown.style.left = left + 'px';
    dropdown.style.top = (rect.bottom + window.scrollY + 6) + 'px';

    dropdown.querySelector('.f100-notif-close')?.addEventListener('click', () => dropdown.remove());
    dropdown.querySelector('.f100-notif-mark-all')?.addEventListener('click', () => {
        const readSet = _getReadSet();
        unread.forEach(n => readSet.add(n.key));
        _saveReadSet(readSet);
        dropdown.remove();
        updateNotifBadge();
    });

    // Click a notification: mark read, then navigate (same or cross module)
    dropdown.querySelectorAll('.f100-notif-item').forEach(item => {
        item.addEventListener('click', () => {
            const notifType = item.dataset.type || 'comment';
            const key = item.dataset.key;
            const targetModuleId = item.dataset.moduleId || currentModuleId;
            const isCross = targetModuleId !== currentModuleId;

            const readSet = _getReadSet();
            readSet.add(key);
            _saveReadSet(readSet);
            dropdown.remove();
            updateNotifBadge();

            if (notifType === 'issue') {
                const issueId = item.dataset.issueId;
                if (isCross) {
                    const currentLabel = _moduleLabel(currentModuleId);
                    const targetLabel  = _moduleLabel(targetModuleId);
                    const confirmed = window.confirm(
                        `You are currently in ${currentLabel}.\n\nThis issue is from ${targetLabel}.\n\nSwitch to ${targetLabel} to view it?`
                    );
                    if (!confirmed) return;
                    try { sessionStorage.setItem('ppms_notif_issue_jump', issueId); } catch {}
                    getModuleRuntime()?.setActiveModule?.(targetModuleId);
                    window.location.reload();
                    return;
                }
                // Same module: scroll to issues section, highlight row, open view modal
                const issuesSection = document.getElementById('issuesSection');
                if (issuesSection) issuesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setTimeout(() => {
                    const tr = document.querySelector(`#issuesTableBody tr[data-issue-id="${issueId}"]`);
                    if (tr) {
                        tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        tr.classList.add('f100-row-highlight');
                        setTimeout(() => tr.classList.remove('f100-row-highlight'), 2500);
                    }
                    if (typeof openIssueView === 'function') openIssueView(issueId);
                }, 400);
                return;
            }

            const planId = item.dataset.planId;

            if (isCross) {
                // Cross-module: show confirmation dialog then switch
                const currentLabel = _moduleLabel(currentModuleId);
                const targetLabel  = _moduleLabel(targetModuleId);
                const confirmed = window.confirm(
                    `You are currently in ${currentLabel}.\n\nThis comment is from ${targetLabel}.\n\nSwitch to ${targetLabel} to view it?`
                );
                if (!confirmed) return;
                // Persist planId so we can open the comment popover after reload
                try { sessionStorage.setItem('ppms_notif_jump', planId); } catch {}
                getModuleRuntime()?.setActiveModule?.(targetModuleId);
                window.location.reload();
                return;
            }

            // Same module: scroll to row and open comment popover
            const tableSection = document.getElementById('tableSection');
            if (tableSection) tableSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => {
                const tr = document.querySelector(`tr[data-plan-id="${planId}"]`);
                if (tr) {
                    tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    tr.classList.add('f100-row-highlight');
                    setTimeout(() => tr.classList.remove('f100-row-highlight'), 2000);
                }
                // Wait for the scroll animation to finish before clicking so the popover
                // is positioned correctly relative to the button's final location
                setTimeout(() => {
                    const commentBtn = document.querySelector(`.btn-f100-comment[data-plan-id="${planId}"]`);
                    if (commentBtn) commentBtn.click();
                }, 550);
            }, 400);
        });
    });

    setTimeout(() => document.addEventListener('click', function handler(ev) {
        if (!dropdown.contains(ev.target) && ev.target !== bell) {
            dropdown.remove();
            document.removeEventListener('click', handler);
        }
    }), 0);
}

// After a cross-module notification jump, open the target comment popover or issue view
function checkNotifJump() {
    // Issue jump
    let issueId;
    try {
        issueId = sessionStorage.getItem('ppms_notif_issue_jump');
        if (issueId) sessionStorage.removeItem('ppms_notif_issue_jump');
    } catch {}
    if (issueId) {
        setTimeout(() => {
            const issuesSection = document.getElementById('issuesSection');
            if (issuesSection) issuesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => {
                const tr = document.querySelector(`#issuesTableBody tr[data-issue-id="${issueId}"]`);
                if (tr) {
                    tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    tr.classList.add('f100-row-highlight');
                    setTimeout(() => tr.classList.remove('f100-row-highlight'), 2500);
                }
                if (typeof openIssueView === 'function') openIssueView(issueId);
            }, 500);
        }, 800);
        return;
    }

    // Comment jump
    let planId;
    try {
        planId = sessionStorage.getItem('ppms_notif_jump');
        if (!planId) return;
        sessionStorage.removeItem('ppms_notif_jump');
    } catch { return; }

    setTimeout(() => {
        const tableSection = document.getElementById('tableSection');
        if (tableSection) tableSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => {
            const tr = document.querySelector(`tr[data-plan-id="${planId}"]`);
            if (tr) {
                tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                tr.classList.add('f100-row-highlight');
                setTimeout(() => tr.classList.remove('f100-row-highlight'), 2000);
            }
            setTimeout(() => {
                const commentBtn = document.querySelector(`.btn-f100-comment[data-plan-id="${planId}"]`);
                if (commentBtn) commentBtn.click();
            }, 550);
        }, 500);
    }, 800);
}

function wireNotifBell() {
    const bell = document.getElementById('f100NotifBell');
    if (!bell) return;
    bell.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = document.querySelector('.f100-notif-dropdown');
        if (existing) { existing.remove(); return; }
        openNotifDropdown();
    });
}

function openCompleteModal(planId, idx) {
    activePlanId = planId;
    const row = currentData.find(t => String(t.id) === String(planId)) || currentData[idx];

    if (isF100KD2Module()) {
        const unitMeta = [row.unit_label, row.unit_code ? `[${row.unit_code}]` : '', row.unit_name].filter(Boolean).join(' · ');
        const unitStr = unitMeta
            ? ` · <span style="font-weight:400;opacity:.7;font-size:.85em">${esc(unitMeta)}</span>`
            : '';
        document.getElementById('modalInfo').innerHTML = `
        <strong>${esc(row.vehicle_type || '—')} · #${row.serial_number ?? '?'}${unitStr}</strong><br>
        ${esc(row.part_name || '—')} &middot; Step #${row.step_number} ${esc(row.process_name || '—')}<br>
        <small>Planned: ${formatDate(row.planned_start_date)} → ${formatDate(row.planned_end_date)}</small>
        ${row.actual_start_date ? `<br><small>Actual start: ${formatDate(row.actual_start_date)}</small>` : ''}`;
        document.getElementById('modalDate').value = row.actual_end_date || todayStr();
        document.getElementById('modalNotes').value = row.notes || '';
    } else {
        const actualStart = row.progress?.actual_start_date;
        document.getElementById('modalInfo').innerHTML = `
        <strong>${esc(row.vehicle)} · ${esc(row.vehicle_no)}${getUnitCode(row.vehicle, row.vehicle_no) ? ' <span style="font-weight:400;opacity:.7;font-size:.85em">(' + esc(getUnitCode(row.vehicle, row.vehicle_no)) + ')</span>' : ''}</strong><br>
        ${esc(row.process_station)}<br>
        <small>Planned: ${formatDate(row.start_date)} → ${formatDate(row.end_date)}</small>
        ${actualStart ? `<br><small>Actual start: ${formatDate(actualStart)}</small>` : ''}`;
        document.getElementById('modalDate').value = todayStr();
        document.getElementById('modalNotes').value = row.progress?.notes || '';
    }

    document.getElementById('modalOverlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
    activePlanId = null;
}

async function markComplete() {
    if (!canWrite()) { showToast('Viewer accounts cannot edit data.', 'error'); return; }
    if (!activePlanId) return;

    const planId = activePlanId;
    const compDate = document.getElementById('modalDate').value;
    const notes = document.getElementById('modalNotes').value.trim();

    if (!compDate) { showToast('Please select a completion date.', 'error'); return; }

    closeModal();

    // F100: update actual_end_date, status, and notes directly in f100_plans
    if (isF100KD2Module()) {
        try {
            const payload = { actual_end_date: compDate, status: 'Completed', notes: notes || null, updated_at: new Date().toISOString() };
            const { error } = await db.from('f100_plans').update(payload).eq('id', planId);
            if (error) throw error;
            await auditLog('UPDATE', 'f100_plans', planId, null, payload);
            showToast('Progress saved successfully.', 'success');
            const mRow = currentData.find(t => String(t.id) === String(planId));
            if (mRow) {
                mRow.actual_end_date = compDate;
                mRow.status = 'Completed';
                mRow.end_date = compDate;
                mRow.notes = notes || '';
                refreshAllViews();
            } else { await loadData(); }
        } catch (err) {
            showToast('Error saving progress: ' + err.message, 'error');
            console.error(err);
        }
        return;
    }

    try {
        const progressTable = getModuleProgressTable();
        const { data: allRowsM } = await db
            .from(progressTable).select('*').eq('plan_id', planId).order('updated_at', { ascending: false });

        const snapBefore = allRowsM?.[0] || null;

        if (allRowsM && allRowsM.length > 1) {
            const extraIds = allRowsM.slice(1).map(r => r.id);
            await db.from(progressTable).delete().in('id', extraIds);
        }

        const payload = {
            plan_id: planId,
            completed: true,
            completion_date: compDate,
            notes,
            actual_start_date: snapBefore?.actual_start_date || null,
            updated_at: new Date().toISOString(),
        };

        let opError;
        if (snapBefore) {
                const { error } = await db
                    .from(progressTable)
                    .update({ completed: true, completion_date: compDate, notes, updated_at: payload.updated_at })
                    .eq('id', snapBefore.id);
                opError = error;
        } else {
            const { error } = await db.from(progressTable).insert(payload);
            opError = error;
        }
        if (opError) throw opError;

        const { data: snapAfter } = await db
            .from(progressTable).select('*').eq('plan_id', planId).maybeSingle();

        await auditLog(
            snapBefore ? 'UPDATE' : 'INSERT',
            progressTable, planId, snapBefore || null, snapAfter || null
        );

        markLocalSave();
        showToast('Progress saved successfully.', 'success');
        const mRow = currentData.find(t => String(t.id) === String(planId));
        if (mRow) {
            mRow.progress = snapAfter || mRow.progress || {};
            mRow.progress.completed = true;
            mRow.progress.completion_date = compDate;
            mRow.progress.notes = notes || null;
            if (!updateTableRowInPlace(planId)) refreshAllViews();
        } else {
            const pos = saveScrollPos();
            await loadData();
            restoreScrollPos(pos);
        }

    } catch (err) {
        showToast('Error saving progress: ' + err.message, 'error');
        console.error(err);
    }
}

/* ──────────────────────────────────────────────────────────────────
   11. IMPORT CSV
   ────────────────────────────────────────────────────────────────── */
async function importPlan() {
    if (!canWrite()) { showToast('Viewer accounts cannot import data.', 'error'); return; }
    if (isKD2Module()) { showToast('KD2 import is not enabled in this phase yet.', 'error'); return; }

    const raw = document.getElementById('importText').value.trim();
    if (!raw) { showToast('No data pasted.', 'error'); return; }

    const lines = raw.split('\n').filter(l => l.trim());
    const rows = [];

    for (const line of lines) {
        const parts = line.split(/,|\t/).map(p => p.trim());
        if (parts.length < 6) continue;
        const [vehicle, vehicle_no, process_station, week, rawStart, rawEnd, ...remarkParts] = parts;
        const start_date = parseDateStr(rawStart);
        const end_date = parseDateStr(rawEnd);
        if (!start_date || !end_date) continue;
        const computedWeek = start_date ? weekLabel(start_date) : (week || null);
        rows.push({ vehicle, vehicle_no, process_station, week: computedWeek, start_date, end_date, remark: remarkParts.join(',').trim() });
    }

    if (!rows.length) { showToast('No valid rows found. Check format.', 'error'); return; }

    try {
        const { error } = await db.from('assembly_plan').insert(rows);
        if (error) throw error;

        await auditLog('INSERT', 'assembly_plan', 'bulk-import', null,
            { rows_added: rows.length });

        showToast(`${rows.length} rows imported successfully.`, 'success');
        document.getElementById('importText').value = '';
        document.getElementById('importPanel').style.display = 'none';
        await loadFilters();
        await loadData();

    } catch (err) {
        showToast('Import error: ' + err.message, 'error');
        console.error(err);
    }
}

/* ──────────────────────────────────────────────────────────────────
   12. EVENT WIRING
   ────────────────────────────────────────────────────────────────── */
function wireEvents() {
    // Filters
    document.getElementById('btnApply').addEventListener('click', loadData);
    document.getElementById('btnReset').addEventListener('click', resetFilters);
    document.getElementById('btnGanttLegendToggle')?.addEventListener('click', () => {
        _ganttLegendOpen = !_ganttLegendOpen;
        syncGanttLegendUi();
    });

    // Cascade: when vehicle changes, update unit dropdown to match
    document.getElementById('filterVehicle')?.addEventListener('change', onVehicleFilterChange);
    
    // Reload data when K9 component filter changes
    document.getElementById('filterK9Component')?.addEventListener('change', loadData);

    // F100-KD2 filter changes
    document.getElementById('f100Battalion')?.addEventListener('change', loadData);
    document.getElementById('f100Mode')?.addEventListener('change', loadData);
    document.getElementById('f100GunPart')?.addEventListener('change', loadData);
    document.getElementById('f100Manufacturer')?.addEventListener('change', loadData);
    document.getElementById('f100VehicleType')?.addEventListener('change', loadData);
    document.getElementById('f100Serial')?.addEventListener('change', loadData);
    document.getElementById('filterTimeFrame').addEventListener('change', function () {
        const isCustom = this.value === 'custom';
        document.getElementById('customDateStart').style.display = isCustom ? '' : 'none';
        document.getElementById('customDateEnd').style.display = isCustom ? '' : 'none';
    });

    // Import panel
    document.getElementById('btnImport').addEventListener('click', () => {
        const panel = document.getElementById('importPanel');
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
    });
    document.getElementById('btnImportSubmit').addEventListener('click', importPlan);
    document.getElementById('btnImportCancel').addEventListener('click', () => {
        document.getElementById('importPanel').style.display = 'none';
    });

    // Modal — Mark Complete
    document.getElementById('modalConfirm').addEventListener('click', markComplete);
    document.getElementById('modalCancel').addEventListener('click', closeModal);
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalOverlay').addEventListener('click', function (e) {
        if (e.target === this) closeModal();
    });

    // Gantt controls
    wireGanttControls();
    bindVpxFullscreenUi();

    // Report modal
    wireReportModal();
    wireIssueReportModal();
    wireVpxReportModal();
    wireVpxDelayReasonModal();

    // Notification bell (F100-KD2 and F200-KD2)
    wireNotifBell();
    updateNotifBadge();
    wireActiveUsersBtn();
    if (isMasterAdmin()) {
        const wrap = document.getElementById('activeUsersWrap');
        if (wrap) wrap.style.display = 'flex';
    }

    // ── Auth controls ────────────────────────────────────────────────
    document.getElementById('btnLogout')?.addEventListener('click', doLogout);

    // Unit Codes (admin+ — button hidden for viewers/planners)
    document.getElementById('btnUnitCodes')?.addEventListener('click', openUnitCodes);
    document.getElementById('unitCodesClose')?.addEventListener('click', closeUnitCodes);
    document.getElementById('unitCodesOverlay')?.addEventListener('click', function (e) {
        if (e.target === this) closeUnitCodes();
    });
    document.getElementById('btnAddUnitCode')?.addEventListener('click', () => openUcForm(null));
    document.getElementById('btnUcSave')?.addEventListener('click', saveUnitCode);
    document.getElementById('btnUcCancel')?.addEventListener('click', closeUcForm);
    document.getElementById('ucFormClose')?.addEventListener('click', closeUcForm);
    document.getElementById('ucBattalion')?.addEventListener('change', populateUcUnits);
    document.getElementById('ucVehicle')?.addEventListener('change', populateUcUnits);

    // User Management (master_admin only — button hidden for others)
    document.getElementById('btnUserMgmt')?.addEventListener('click', openUserMgmt);
    document.getElementById('userMgmtClose')?.addEventListener('click', closeUserMgmt);
    document.getElementById('userMgmtOverlay')?.addEventListener('click', function (e) {
        if (e.target === this) closeUserMgmt();
    });
    document.getElementById('btnAddUser')?.addEventListener('click', () => openUserForm(null));
    document.getElementById('btnUmSave')?.addEventListener('click', saveUser);
    document.getElementById('btnUmCancel')?.addEventListener('click', closeUserForm);
    document.getElementById('umFormClose')?.addEventListener('click', closeUserForm);

    // Audit Log (master_admin only — button hidden for others)
    document.getElementById('btnAuditLog')?.addEventListener('click', openAuditLog);
    document.getElementById('auditLogClose')?.addEventListener('click', closeAuditLog);
    document.getElementById('auditLogOverlay')?.addEventListener('click', function (e) {
        if (e.target === this) closeAuditLog();
    });
    document.getElementById('btnAlApply')?.addEventListener('click', () => loadAuditLog(true));
    document.getElementById('btnAlReset')?.addEventListener('click', resetAuditFilters);



    // Table fullscreen
    document.getElementById('btnTableFullscreen')?.addEventListener('click', toggleTableFullscreen);

    // Production Issues
    document.getElementById('btnAddIssue')?.addEventListener('click', () => openIssueModal());
    document.getElementById('btnIssueEdit')?.addEventListener('click', function() {
        const id = this.dataset.issueId;
        if (id) { _closeIssueModal(); openIssueModal(Number(id)); }
    });
    document.getElementById('btnIssueSave')?.addEventListener('click', saveIssue);
    document.getElementById('btnIssueCancel')?.addEventListener('click', () => _closeIssueModal());
    document.getElementById('issueModalClose')?.addEventListener('click', () => _closeIssueModal());
    document.getElementById('issueModalOverlay')?.addEventListener('click', function (e) {
        if (e.target === this) _closeIssueModal();
    });
    document.getElementById('btnIssueDelete')?.addEventListener('click', () => {
        const id = document.getElementById('issueModalOverlay')?.dataset?.editId;
        if (id) deleteIssue(id);
    });
    ISSUE_DRAFT_FIELD_IDS.forEach(id => {
        const el = document.getElementById(id);
        el?.addEventListener('input', _autoSaveIssueDraft);
        el?.addEventListener('change', _autoSaveIssueDraft);
    });
    window.addEventListener('beforeunload', _flushIssueDraft);
    document.addEventListener('visibilitychange', () => { if (document.hidden) _flushIssueDraft(); });
    wireIssueDraftsModal();
    _updateIssueDraftsBadge();
    document.getElementById('btnIssueApply')?.addEventListener('click', () => loadIssues(true));
    document.getElementById('issueSearch')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') loadIssues(true);
    });
    // ── More menu toggle ──────────────────────────────────────────────
    const btnNavMore  = document.getElementById('btnNavMore');
    const moreDropdown = document.getElementById('navMoreDropdown');
    if (btnNavMore && moreDropdown) {
        btnNavMore.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = moreDropdown.style.display !== 'none';
            moreDropdown.style.display = open ? 'none' : 'block';
            btnNavMore.setAttribute('aria-expanded', String(!open));
        });
        document.addEventListener('click', (e) => {
            if (!moreDropdown.contains(e.target) && e.target !== btnNavMore) {
                moreDropdown.style.display = 'none';
                btnNavMore.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // Close more menu when any item inside is clicked
    moreDropdown?.addEventListener('click', () => {
        moreDropdown.style.display = 'none';
        btnNavMore?.setAttribute('aria-expanded', 'false');
    });

    // ── Export Permissions (inside User Management modal) ─────────────
    document.getElementById('btnExportPermAdd')?.addEventListener('click', addExportPerm);
    document.getElementById('exportPermEmail')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') addExportPerm();
    });

    // ── Section navigation ────────────────────────────────────────────
    document.querySelectorAll('.section-nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.dataset.target;
            const el = document.getElementById(targetId);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    // Active section highlight on scroll
    const _navLinks = Array.from(document.querySelectorAll('.section-nav-link'));
    const _navSections = _navLinks.map(l => document.getElementById(l.dataset.target)).filter(Boolean);
    if (_navSections.length) {
        const _onScroll = () => {
            const scrollY = window.scrollY + 100;
            let active = _navSections[0];
            for (const sec of _navSections) {
                if (sec.getBoundingClientRect().top + window.scrollY <= scrollY) active = sec;
            }
            _navLinks.forEach(l => {
                const isActive = l.dataset.target === active?.id;
                l.classList.toggle('section-nav-link--active', isActive);
            });
        };
        window.addEventListener('scroll', _onScroll, { passive: true });
        _onScroll();
    }

    // ── Scroll-to-top ─────────────────────────────────────────────────
    const scrollTopBtn = document.getElementById('scrollTopBtn');
    if (scrollTopBtn) {
        window.addEventListener('scroll', () => {
            const show = window.scrollY > 320;
            scrollTopBtn.style.display = show ? 'flex' : 'none';
            scrollTopBtn.classList.toggle('visible', show);
        }, { passive: true });
        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
}

function resetFilters() {
    ['filterBattalion', 'filterVehicle', 'filterUnit', 'filterWeek', 'filterCategory'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    // F100 filters
    const f100Mode = document.getElementById('f100Mode');
    if (f100Mode) f100Mode.value = 'gun';
    ['f100Battalion', 'f100GunPart', 'f100Manufacturer', 'f100VehicleType', 'f100Serial'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const tf = document.getElementById('filterTimeFrame');
    if (tf) tf.value = 'all';
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    document.getElementById('customDateStart').style.display = 'none';
    document.getElementById('customDateEnd').style.display = 'none';
    _tableFilters = [];
    const _inlineBar = document.getElementById('tblFilterBarInline');
    if (_inlineBar) _inlineBar.innerHTML = '';
    // Restore full unit list with no vehicle scope
    populateUnitFilter(null);
    loadData();
}

/* ──────────────────────────────────────────────────────────────────
   13. UI UTILITIES
   ────────────────────────────────────────────────────────────────── */
function setConnStatus(state, label) {
    const el = document.getElementById('connIndicator');
    const lbl = el.querySelector('.conn-label');
    el.className = `conn-indicator ${state}`;
    lbl.textContent = label;
}

function setTableLoading(loading) {
    const tbody = document.getElementById('tableBody');
    if (loading) {
        tbody.innerHTML = `
      <tr>
        <td colspan="12" class="table-empty">
          <div class="empty-state">
            <span class="spinner"></span>
            <p>Loading data…</p>
          </div>
        </td>
      </tr>`;
    }
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function animateCount(id, target) {
    const el = document.getElementById(id);
    const start = parseInt(el.textContent) || 0;
    const dur = 400;
    const t0 = performance.now();

    function step(now) {
        const p = Math.min((now - t0) / dur, 1);
        el.textContent = Math.round(start + (target - start) * easeOut(p));
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

function startClock() {
    function tick() {
        const now = new Date();
        document.getElementById('headerClock').textContent =
            now.toLocaleTimeString('en-GB', { hour12: false });
        document.getElementById('headerDate').textContent =
            now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    tick();
    setInterval(tick, 1000);
}

/* ──────────────────────────────────────────────────────────────────
   14. DATE / STRING UTILITIES
   ────────────────────────────────────────────────────────────────── */

/**
 * Natural (numeric-aware) string comparison.
 * "K9" < "K10" < "K11",  "M1" < "M2" < "M10"
 * Splits each string into alternating text/number chunks and
 * compares numbers numerically, text alphabetically.
 */
function naturalSort(a, b) {
    const re = /(\d+)|(\D+)/g;
    const tokA = String(a ?? '').match(re) || [];
    const tokB = String(b ?? '').match(re) || [];
    const len = Math.max(tokA.length, tokB.length);

    for (let i = 0; i < len; i++) {
        if (i >= tokA.length) return -1;
        if (i >= tokB.length) return 1;
        const numA = parseFloat(tokA[i]);
        const numB = parseFloat(tokB[i]);
        const cmp = (!isNaN(numA) && !isNaN(numB))
            ? numA - numB
            : tokA[i].localeCompare(tokB[i]);
        if (cmp !== 0) return cmp;
    }
    return 0;
}

/**
 * Vehicle-specific sort: K9 → K10 → K11 → K9-FOC → K10-FOC → K11-FOC
 * Rule: non-FOC variants come before FOC variants; within each group,
 * sort numerically (naturalSort on the base number).
 */
function vehicleSort(a, b) {
    const focA = /foc/i.test(String(a));
    const focB = /foc/i.test(String(b));
    if (focA !== focB) return focA ? 1 : -1;   // non-FOC first
    return naturalSort(a, b);                   // same group → numeric order
}
function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

function formatDate(isoStr) {
    if (!isoStr || isoStr === '—') return '—';
    const d = new Date(isoStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Short date — "01 Jan" (no year), used in VPX cells */
function formatDateShort(isoStr) {
    if (!isoStr || isoStr === '—') return '—';
    const d = new Date(isoStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** Return the unit code for a vehicle+unit combo, or '' */
function getUnitCode(vehicle, vehicle_no) {
    return unitCodeMap[vehicle + '||' + vehicle_no] || '';
}

/** Format unit label: "M1" or "M1 · EGY N25020" */
function unitLabel(vehicle, vehicle_no) {
    const code = getUnitCode(vehicle, vehicle_no);
    return code ? vehicle_no + ' · ' + code : vehicle_no;
}

/** Delay-reason lookup — { id, reason } for a vehicle+unit, or null if the
 *  vehicle isn't registered in Unit Codes (no row to attach a reason to). */
function getDelayReasonEntry(vehicle, vehicle_no) {
    return vpxDelayReasonMap[vehicle + '||' + vehicle_no] || null;
}
function getDelayReason(vehicle, vehicle_no) {
    return getDelayReasonEntry(vehicle, vehicle_no)?.reason || '';
}

function daysBetween(from, to) {
    if (to <= from) return 0;
    // Count working days (Mon–Thu + Sat–Sun = every day except Friday)
    const end = new Date(to + 'T00:00:00');
    const d   = new Date(from + 'T00:00:00');
    let count = 0;
    d.setDate(d.getDate() + 1); // start the day after "from"
    while (d <= end) {
        if (d.getDay() !== 5) count++; // exclude Fridays; Saturdays count
        d.setDate(d.getDate() + 1);
    }
    return count;
}

function currentWeekRange() {
    const now = new Date();
    const day = now.getDay();            // 0=Sun … 6=Sat
    // Work week: Saturday(6) -> Thursday(4); Friday(5) is skipped.
    const diff = day === 6 ? 0 : day === 5 ? -6 : -(day + 1);
    const sat = new Date(now);
    sat.setDate(now.getDate() + diff);
    const thu = new Date(sat);
    thu.setDate(sat.getDate() + 5);
    return {
        weekStart: localDateStr(sat),
        weekEnd: localDateStr(thu),
    };
}

function currentMonthRange() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const monthStart = new Date(y, m, 1).toISOString().slice(0, 10);
    const monthEnd = new Date(y, m + 1, 0).toISOString().slice(0, 10);
    return { monthStart, monthEnd };
}

function generateDateRange(startStr, endStr) {
    const dates = [];
    const cur = new Date(startStr + 'T00:00:00');
    const end = new Date(endStr + 'T00:00:00');

    while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
    }
    return dates;
}

/** Parse dates like "23-Feb-26", "23-Feb-2026", or ISO "2026-02-23" */
function parseDateStr(raw) {
    if (!raw) return null;
    raw = raw.trim();

    // Already ISO
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    // DD-Mon-YY or DD-Mon-YYYY
    const m = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (m) {
        const months = {
            jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
            jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
        };
        const day = m[1].padStart(2, '0');
        const mon = months[m[2].toLowerCase()];
        let yr = m[3];
        if (yr.length === 2) yr = '20' + yr;
        if (!mon) return null;
        return `${yr}-${mon}-${day}`;
    }

    return null;
}

function getVal(id) {
    return document.getElementById(id)?.value?.trim() || '';
}

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ──────────────────────────────────────────────────────────────────
   15. BOOTSTRAP
   ────────────────────────────────────────────────────────────────── */

/* ================================================================
   THEME ENGINE  — dark (default) / light
   Stored per-user so different accounts on the same browser each
   keep their own preference.  A shared "last" key is written so
   the anti-flash IIFE can restore the most-recent theme before
   the user object is known.
   ================================================================ */
const THEME_KEY_BASE = 'ppms_theme';

(function applyStoredTheme() {
    // Before login we don't know the user; use the last-set theme
    // to prevent a flash.  Falls back to old 'kd1_theme' key.
    const stored = localStorage.getItem(THEME_KEY_BASE + '_last')
                || localStorage.getItem('kd1_theme');
    if (stored === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
})();

function _userThemeKey() {
    const u = getCurrentUser();
    return u ? THEME_KEY_BASE + '_u_' + (u.id || u.email) : THEME_KEY_BASE + '_anon';
}

function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
}

function setTheme(theme) {
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem(_userThemeKey(), theme);
    localStorage.setItem(THEME_KEY_BASE + '_last', theme); // anti-flash fallback
    // Re-render charts with correct palette for new theme
    if (currentData.length) refreshAllViews();
}

function toggleTheme() {
    setTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
}

/** Called after login — restores this user's saved theme preference. */
function applyUserTheme() {
    const saved = localStorage.getItem(_userThemeKey());
    if (saved && saved !== getCurrentTheme()) {
        if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
        else document.documentElement.removeAttribute('data-theme');
        // Don't call setTheme() to avoid refreshAllViews before data is loaded
    }
}

/** Return the correct colour set for charts based on current theme */
function themeChartColors() {
    const light = getCurrentTheme() === 'light';
    return {
        text: light ? '#475569' : '#7a8baa',
        grid: light ? '#e2e8f0' : '#2a3350',
        tooltipBg: light ? '#1e293b' : '#161b27',
        tooltipBdr: light ? '#334155' : '#2a3350',
        tooltipTtl: light ? '#f1f5f9' : '#e2e8f4',
        tooltipBdy: light ? '#94a3b8' : '#7a8baa',
        axisLabel: light ? '#94a3b8' : '#4a5575',
    };
}

document.addEventListener('DOMContentLoaded', () => {
    // Wire theme toggle
    document.getElementById('btnTheme')?.addEventListener('click', toggleTheme);
    document.getElementById('btnGanttTheme')?.addEventListener('click', toggleTheme);
    initializeApp();
});
/* ================================================================
   GANTT CHART ADDITIONS — append to bottom of app.js
   Then apply the two small patches described at the bottom.
   ================================================================ */

/* ──────────────────────────────────────────────────────────────────
   GANTT CONSTANTS
   ────────────────────────────────────────────────────────────────── */
const GANTT_LABEL_W = 268;   // px — frozen left label column width
const GANTT_DAY_W = 36;    // px — width of each day column
const GANTT_ROW_H = 58;    // px — unit row height
const GANTT_GRP_H = 30;    // px — vehicle group header row height



const GANTT_PALETTE = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
    '#06b6d4', '#f97316', '#84cc16', '#6366f1', '#e11d48',
    '#0ea5e9', '#a855f7', '#d97706', '#4ade80', '#38bdf8',
];
const _stationColors = {};
let _colorIdx = 0;

function ganttStationColor(name) {
    if (!_stationColors[name]) {
        _stationColors[name] = GANTT_PALETTE[_colorIdx++ % GANTT_PALETTE.length];
    }
    return _stationColors[name];
}
window.__ppmsGanttStationColor = ganttStationColor;

/* ──────────────────────────────────────────────────────────────────
   SPECIAL BACKGROUND ZONES
   Add / edit entries here to show coloured bands on the gantt.
   type must match a CSS class: gc-zone-{type}
   ────────────────────────────────────────────────────────────────── */
const SPECIAL_ZONES = [
    // { start: '2026-03-20', end: '2026-03-25', type: 'holiday', label: 'Public Holiday' },
    // { start: '2026-03-26', end: '2026-04-05', type: 'fat',     label: 'FAT Period'     },
];

/* ──────────────────────────────────────────────────────────────────
   FISCAL WEEK NUMBER  (production week starts Saturday)
   ────────────────────────────────────────────────────────────────── */
function getISOWeekInfoForDate(d) {
    const thu = new Date(d);
    thu.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
    const year = thu.getFullYear();
    const jan4 = new Date(year, 0, 4);
    const week = 1 + Math.round((thu - jan4) / (7 * 86400000));
    return { week, year };
}

/**
 * Production FW label. A production week runs Saturday -> Thursday,
 * with Friday excluded. The FW number is anchored to that window's Thursday.
 */
function getISOWeekInfo(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    const startOffset = day === 6 ? 0 : day === 5 ? -6 : -(day + 1);
    const productionThu = new Date(d);
    productionThu.setDate(d.getDate() + startOffset + 5);
    return getISOWeekInfoForDate(productionThu);
}

/** Return ISO week number (1–53) for a date string. */
function getISOWeek(dateStr) {
    return getISOWeekInfo(dateStr).week;
}

/**
 * Return a "FW##" label derived from a task's start_date.
 * This is the canonical week stored on every plan row.
 */
function weekLabel(dateStr) {
    const { week } = getISOWeekInfo(dateStr);
    return 'FW' + String(week).padStart(2, '0');
}

/**
 * Given a week label like "FW09" (optionally "FW9"), return the
 * Saturday and Thursday production window for the current or nearest year.
 * Returns { weekStart, weekEnd } as YYYY-MM-DD strings.
 */
function isoWeekDateRange(label) {
    const num = parseInt(label.replace(/[^0-9]/g, ''), 10);
    if (!num) return null;
    // Determine which year: use the year whose FW#{num} is closest to today
    const todayD = new Date(todayStr() + 'T00:00:00');
    const year = todayD.getFullYear();
    // Jan 4 of that year is always in ISO week 1. Use that week number,
    // but expose the production window as Saturday -> Thursday.
    function weekStart(y) {
        const jan4 = new Date(y, 0, 4);
        const w1Mon = new Date(jan4);
        w1Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
        const mon = new Date(w1Mon);
        mon.setDate(w1Mon.getDate() + (num - 1) * 7);
        const sat = new Date(mon);
        sat.setDate(mon.getDate() - 2);
        const thu = new Date(sat);
        thu.setDate(sat.getDate() + 5);
        return { weekStart: localDateStr(sat), weekEnd: localDateStr(thu) };
    }
    // Try current year; if the week is in the past by more than 26 weeks, try next year
    const r = weekStart(year);
    const delta = (new Date(r.weekStart + 'T00:00:00') - todayD) / 86400000;
    if (delta < -183) return weekStart(year + 1);
    return r;
}

/* ──────────────────────────────────────────────────────────────────
   WIRE GANTT CONTROLS  — call from wireEvents()
   ────────────────────────────────────────────────────────────────── */
function wireGanttControls() {
    const gsEl = document.getElementById('ganttStart');
    const geEl = document.getElementById('ganttEnd');

    document.getElementById('btnGanttRefresh')?.addEventListener('click', () => {
        renderGantt(currentData, gsEl?.value, geEl?.value);
    });
    syncGanttLegendUi();
    wireGanttExportMenu();
}

function setGanttRangeFromData(data) {
    if (!data?.length) return;
    let minDate = '', maxDate = '';
    for (const r of data) {
        const s = r.start_date || '';
        const e = r.end_date || '';
        if (s && (!minDate || s < minDate)) minDate = s;
        if (e && (!maxDate || e > maxDate)) maxDate = e;
    }
    if (!minDate || !maxDate) return;
    const gsEl = document.getElementById('ganttStart');
    const geEl = document.getElementById('ganttEnd');
    if (gsEl) gsEl.value = minDate;
    if (geEl) geEl.value = addDays(maxDate, 2);
}

/* ──────────────────────────────────────────────────────────────────
   MAIN RENDER FUNCTION
   Call:  renderGantt(plansArray, 'YYYY-MM-DD', 'YYYY-MM-DD')
   ────────────────────────────────────────────────────────────────── */
function renderGantt(plans, startDate, endDate) {
    const inner = document.getElementById('ganttInner');
    if (!inner) return;
    const previousGanttScroll = saveGanttScrollPos();

    if (!startDate || !endDate || startDate > endDate) {
        inner.innerHTML = `
      <div class="gantt-empty-state">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="6" y="6" width="36" height="36" rx="4"/>
          <path d="M14 18h20M14 26h12M14 34h8"/>
        </svg>
        <p>Load data and set a date range, then click <strong>Refresh</strong> to render the schedule.</p>
      </div>`;
        const legend = document.getElementById('ganttLegend');
        if (legend) legend.innerHTML = '';
        syncGanttLegendUi();
        _ganttHasRenderedOnce = false;
        return;
    }

    // ── 1. Build day array (Fridays excluded from grid) ─────────────
    const allDays = generateDateRange(startDate, endDate);
    // Strip out every Friday — they are never shown as columns
    const days = allDays.filter(d => new Date(d + 'T00:00:00').getDay() !== 5);
    const numDays = days.length;
    const totalW = numDays * GANTT_DAY_W;
    const innerW = GANTT_LABEL_W + totalW;
    const today = todayStr();

    // Pre-compute metadata for each non-Friday day
    const dayMeta = days.map(d => {
        const dt = new Date(d + 'T00:00:00');
        const dow = dt.getDay();
        return {
            date: d,
            dayNum: dt.getDate(),
            month: dt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
            isoWeek: getISOWeek(d),
            isSat: dow === 6,
            isToday: d === today,
        };
    });

    // Fast lookup: date string → column index (Fridays have no entry)
    const dayIndex = Object.fromEntries(days.map((d, i) => [d, i]));
    const specialZones = getModuleGanttZones(startDate, endDate);
    const isKd2ProcessView  = isKD2Module()    && getModuleRuntime()?.currentTimelineViewMode?.() === 'process';
    const isF100ProcessView = isF100KD2Module() && getModuleRuntime()?.currentTimelineViewMode?.() === 'process';
    const holidayStatusByDay = new Map();
    const holidayLabelsByDay = new Map();
    specialZones
        .filter(zone => (zone?.type === 'holiday' || zone?.type === 'holiday-inactive') && zone.start && zone.end)
        .forEach(zone => {
            const label = String(zone.label || 'No-work Day').trim() || 'No-work Day';
            const isInactive = zone.type === 'holiday-inactive';
            let cursor = zone.start;
            let guard = 0;
            while (cursor <= zone.end && guard++ < 400) {
                if (dayIndex[cursor] !== undefined) {
                    holidayStatusByDay.set(cursor, isInactive ? 'inactive' : 'active');
                    if (!holidayLabelsByDay.has(cursor)) holidayLabelsByDay.set(cursor, new Set());
                    holidayLabelsByDay.get(cursor).add(label);
                }
                cursor = addDays(cursor, 1);
            }
        });

    /**
     * Resolve a date to the nearest column index.
     * If the date is a Friday (not in dayIndex), snap forward to Saturday
     * (or Monday if Saturday is also absent), then fall back to clamping.
     */
    function resolveCol(dateStr, clampFallback) {
        if (dayIndex[dateStr] !== undefined) return dayIndex[dateStr];
        // Try next few days
        for (let n = 1; n <= 3; n++) {
            const next = addDays(dateStr, n);
            if (dayIndex[next] !== undefined) return dayIndex[next];
        }
        // Try previous days
        for (let n = 1; n <= 3; n++) {
            const prev = addDays(dateStr, -n);
            if (dayIndex[prev] !== undefined) return dayIndex[prev];
        }
        return clampFallback;
    }

    // ── 2. Group plans ─────────────────────────────────────────────
    // Pre-process F100 data to use Gantt-compatible vehicle/vehicle_no/process_station fields
    if (isF100KD2Module()) {
        plans = plans.map(r => ({
            ...r,
            vehicle:         r.vehicle_type  || '—',
            vehicle_no:      String(r.serial_number ?? '—'),
            process_station: r.process_name  || '—',
        }));
    }

    // Only include tasks that overlap the visible date range
    const visible = plans.filter(p =>
        p.start_date && p.end_date &&
        p.start_date <= endDate && p.end_date >= startDate
    );

    const groups = {};
    const laneMetaMap = {};
    const ensureGroupLane = (groupKey, laneKey) => {
        if (!groups[groupKey]) groups[groupKey] = {};
        if (!groups[groupKey][laneKey]) groups[groupKey][laneKey] = [];
    };
    const laneMetaKey = (groupKey, laneKey) => `${groupKey}|||${laneKey}`;
    const vehicleFilter = getVal('filterVehicle');
    const unitFilter = getVal('filterUnit');
    const battalionFilter = isKD2Module() ? getVal('filterBattalion') : isF100KD2Module() ? getVal('f100Battalion') : '';
    const _unitSelG = document.getElementById('filterUnit');
    const _unitVehicleG = _unitSelG?.options[_unitSelG?.selectedIndex]?.dataset?.vehicle || '';
    const effectiveVehicleFilter = vehicleFilter || _unitVehicleG;
    // F100 has no unit registry — skip pre-population entirely
    if (!isKd2ProcessView && !isF100KD2Module()) {
        unitRegistryRows
            .filter(row =>
                (!effectiveVehicleFilter || row.vehicle === effectiveVehicleFilter) &&
                (!unitFilter || row.vehicle_no === unitFilter) &&
                (!battalionFilter || !isKD2Module() || row.battalion_code === battalionFilter)
            )
            .forEach(row => {
                const groupKey = isKD2Module() ? (row.battalion_code || '—') : row.vehicle;
                const laneKey = isKD2Module() ? `${row.vehicle}||${row.vehicle_no}` : row.vehicle_no;
                ensureGroupLane(groupKey, laneKey);
                laneMetaMap[laneMetaKey(groupKey, laneKey)] = {
                    battalion_id: row.battalion_id ?? null,
                    battalion_code: row.battalion_code || '',
                    vehicle_type: row.vehicle_type || row.vehicle || '',
                    unit_serial: row.unit_serial ?? null,
                    unit_label: row.unit_label || row.vehicle_no || '',
                };
            });
    }
    visible.forEach(p => {
        const groupKey = isF100ProcessView
            ? (p.part_name || '—')
            : isKd2ProcessView
                ? (p.vehicle || '—')
                : (isKD2Module() || isF100KD2Module() ? (p.battalion_code || '—') : p.vehicle);
        const laneKey = isF100ProcessView
            ? `${p.step_number != null ? p.step_number + ' ' : ''}${p.process_name || '—'}`
            : isKd2ProcessView
                ? (p.process_station || '—')
                : isF100KD2Module()
                    ? `${p.vehicle_type}||${p.serial_number}`
                    : (isKD2Module() ? `${p.vehicle}||${p.vehicle_no}` : p.vehicle_no);
        ensureGroupLane(groupKey, laneKey);
        groups[groupKey][laneKey].push(p);
        laneMetaMap[laneMetaKey(groupKey, laneKey)] = {
            battalion_id: p.battalion_id ?? null,
            battalion_code: p.battalion_code || '',
            vehicle_type: p.vehicle_type || p.vehicle || '',
            unit_serial: isF100KD2Module() ? (p.serial_number ?? null) : (p.unit_serial ?? null),
            unit_label: p.unit_label || p.vehicle_no || '',
        };
    });

    const groupKeys = Object.keys(groups).sort((a, b) => {
        if (isF100ProcessView) {
            const aSort = Object.values(groups[a])?.[0]?.[0]?.part_sort ?? 9999;
            const bSort = Object.values(groups[b])?.[0]?.[0]?.part_sort ?? 9999;
            if (aSort !== bSort) return aSort - bSort;
            return a.localeCompare(b, undefined, { numeric: true });
        }
        if (isKd2ProcessView) return vehicleSort(a, b);
        if (isKD2Module() || isF100KD2Module()) return a.localeCompare(b, undefined, { numeric: true });
        return vehicleSort(a, b);
    });

    // Build unit completion map for F100 unit view
    const unitCompMap = {};
    if (isF100KD2Module() && !isF100ProcessView) {
        visible.forEach(p => {
            const key = `${p.battalion_code}||${p.vehicle_type}||${p.serial_number}`;
            if (!unitCompMap[key]) unitCompMap[key] = { done: 0, total: 0 };
            unitCompMap[key].total++;
            if (p.status === 'Completed' || p.status === 'Late Completion') unitCompMap[key].done++;
        });
        Object.values(unitCompMap).forEach(v => {
            v.pct = v.total > 0 ? Math.round((v.done / v.total) * 100) : 0;
        });
    }

    // Build completion maps for KD2 (unit view: per battalion+vehicle+unit; process view: per station)
    const _kd2UnitCompMap = {};
    const _kd2StatCompMap = {};
    if (isKD2Module()) {
        plans.forEach(r => {
            const done = !!r.progress?.completed;
            const unitKey = `${r.battalion_code || ''}||${r.vehicle || r.vehicle_type || ''}||${r.vehicle_no || ''}`;
            if (!_kd2UnitCompMap[unitKey]) _kd2UnitCompMap[unitKey] = { done: 0, total: 0 };
            _kd2UnitCompMap[unitKey].total++;
            if (done) _kd2UnitCompMap[unitKey].done++;
            const statKey = r.process_station ? `${r.vehicle}||${r.process_station}` : '';
            if (statKey) {
                if (!_kd2StatCompMap[statKey]) _kd2StatCompMap[statKey] = { done: 0, total: 0 };
                _kd2StatCompMap[statKey].total++;
                if (done) _kd2StatCompMap[statKey].done++;
            }
        });
        const fin = v => { v.pct = v.total > 0 ? Math.round((v.done / v.total) * 100) : 0; };
        Object.values(_kd2UnitCompMap).forEach(fin);
        Object.values(_kd2StatCompMap).forEach(fin);
    }

    if (!groupKeys.length) {
        clearGanttHoverGuide();
        inner.innerHTML = `
      <div class="gantt-empty-state">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="6" y="6" width="36" height="36" rx="4"/>
          <path d="M14 24h20M24 14v20"/>
        </svg>
        <p>No tasks fall within the selected date range.</p>
      </div>`;
        const legend = document.getElementById('ganttLegend');
        if (legend) legend.innerHTML = '';
        syncGanttLegendUi();
        const zoneKeyEl = document.getElementById('ganttZoneKey');
        if (zoneKeyEl) zoneKeyEl.style.display = 'none';
        _ganttHasRenderedOnce = false;
        return;
    }

    // ── 3. Header HTML ─────────────────────────────────────────────
    let mHtml = `<div class="gh-corner" style="width:${GANTT_LABEL_W}px;height:28px"></div>`;
    let wHtml = `<div class="gh-corner" style="width:${GANTT_LABEL_W}px;height:22px"></div>`;
    let dHtml = `<div class="gh-corner gh-corner-label" style="width:${GANTT_LABEL_W}px;height:28px">${isF100ProcessView ? 'Part / Process' : isF100KD2Module() ? 'Battalion / Vehicle / Unit' : isKd2ProcessView ? 'Vehicle / Station' : isKD2Module() ? 'Battalion / Vehicle / Unit' : 'Vehicle / Unit'}</div>`;

    let runMonth = '', runMonthSpan = 0;
    let runWeek = -1, runWeekSpan = 0;

    dayMeta.forEach((dm, i) => {
        // Month grouping
        if (dm.month !== runMonth) {
            if (runMonth) {
                mHtml += `<div class="gh-month" style="width:${runMonthSpan * GANTT_DAY_W}px">${runMonth}</div>`;
            }
            runMonth = dm.month; runMonthSpan = 1;
        } else { runMonthSpan++; }

        // Fiscal week grouping
        if (dm.isoWeek !== runWeek) {
            if (runWeek !== -1) {
                wHtml += `<div class="gh-week" style="width:${runWeekSpan * GANTT_DAY_W}px">FW${runWeek}</div>`;
            }
            runWeek = dm.isoWeek; runWeekSpan = 1;
        } else { runWeekSpan++; }

        // Day cell
        const holidayLabels = holidayLabelsByDay.get(dm.date);
        const dayTitle = holidayLabels?.size ? ` title="${esc([...holidayLabels].join(', '))}"` : '';
        const holidayStatus = holidayStatusByDay.get(dm.date) || '';
        const holidayClass = holidayStatus === 'inactive'
            ? ' gh-day-holiday-inactive'
            : holidayStatus === 'active'
                ? ' gh-day-holiday'
                : '';
        dHtml += `<div class="gh-day${dm.isSat ? ' gh-day-sat' : ''}${holidayClass}${dm.isToday ? ' gh-day-today' : ''}"
      data-gantt-date="${dm.date}" style="width:${GANTT_DAY_W}px;height:28px"${dayTitle}>${dm.dayNum}</div>`;
    });

    // Flush last groups
    mHtml += `<div class="gh-month" style="width:${runMonthSpan * GANTT_DAY_W}px">${runMonth}</div>`;
    wHtml += `<div class="gh-week"  style="width:${runWeekSpan * GANTT_DAY_W}px">FW${runWeek}</div>`;

    // ── 4. Background day cells (shared template per row) ─────────
    const bgCells = dayMeta.map(dm =>
        `<div class="gc-cell${dm.isSat ? ' gc-cell-sat' : ''}" data-gantt-date="${dm.date}" style="width:${GANTT_DAY_W}px"></div>`
    ).join('');

    // ── 5. Special zone bands ──────────────────────────────────────
    // Zones are injected into every row's track div (left relative to track start,
    // not gantt-body). This keeps them geometrically inside the track column so they
    // can never bleed over the sticky label column on horizontal scroll.
    let trackZonesHtml = '';
    specialZones.forEach(z => {
        // Clamp zone to visible range
        const s = z.start > startDate ? z.start : startDate;
        const e = z.end < endDate ? z.end : endDate;
        const si = dayIndex[s] ?? resolveCol(s, null);
        const ei = dayIndex[e] ?? resolveCol(e, null);
        if (si === null || ei === null || si > ei) return;

        const left = si * GANTT_DAY_W;
        const width = (ei - si + 1) * GANTT_DAY_W;
        const isHolidayZone = z.type === 'holiday' || z.type === 'holiday-inactive';
        const zoneTitle = isHolidayZone ? '' : ` title="${esc(z.label || z.type)}"`;
        trackZonesHtml += `<div class="gc-zone gc-zone-${esc(z.type)}" style="left:${left}px;width:${width}px"${zoneTitle}></div>`;
    });

    // Today marker
    const todayCol = dayIndex[today] ?? resolveCol(today, null);
    if (todayCol !== null) {
        const todayLeft = todayCol * GANTT_DAY_W + Math.floor(GANTT_DAY_W / 2);
        trackZonesHtml += `<div class="gc-today-line" style="left:${todayLeft}px"></div>`;
    }

    // ── 6. Body rows ───────────────────────────────────────────────
    let bodyHtml = '';

    groupKeys.forEach(groupKey => {
        const unitKeys = Object.keys(groups[groupKey]).sort((a, b) => {
            if (isF100ProcessView) return naturalSort(a, b);
            if (isKd2ProcessView) {
                const routeOrder = getModuleRuntime()?.getStationRouteOrder?.(groupKey) || new Map();
                const seqA = routeOrder.get(a) ?? 9999;
                const seqB = routeOrder.get(b) ?? 9999;
                if (seqA !== seqB) return seqA - seqB;
                return a.localeCompare(b, undefined, { numeric: true });
            }
            if (!isKD2Module()) return naturalSort(a, b);
            const [vehicleA, ...unitAParts] = a.split('||');
            const [vehicleB, ...unitBParts] = b.split('||');
            const vehicleCmp = vehicleSort(vehicleA, vehicleB);
            if (vehicleCmp !== 0) return vehicleCmp;
            return naturalSort(unitAParts.join('||'), unitBParts.join('||'));
        });

        // Vehicle group header row
        bodyHtml += `
      <div class="gr gr-group" style="height:${GANTT_GRP_H}px">
        <div class="gr-label gr-group-label" style="width:${GANTT_LABEL_W}px">
          <svg class="gr-label-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="2" y="3" width="12" height="10" rx="1.5"/>
            <path d="M5 8h6M5 11h4"/>
          </svg>
          ${esc(groupKey)}
        </div>
        <div class="gr-track gr-track-group" style="width:${totalW}px">${trackZonesHtml}${bgCells}</div>
      </div>`;

        const vehicleSections = (!isKd2ProcessView && !isF100ProcessView && (isKD2Module() || isF100KD2Module()))
            ? [...new Set(unitKeys.map(unit => unit.split('||')[0]).filter(Boolean))]
                .sort((a, b) => isF100KD2Module() ? a.localeCompare(b, undefined, { numeric: true }) : vehicleSort(a, b))
                .map(vehicle => ({
                    vehicle,
                    units: unitKeys.filter(unit => unit.startsWith(vehicle + '||')),
                }))
            : [{ vehicle: groupKey, units: unitKeys }];

        // For KD2 process view: build a station→category map for this vehicle (groupKey)
        const _kd2CatMap = isKd2ProcessView
            ? (getModuleRuntime()?.getStationCategoryMap?.(groupKey) || new Map())
            : null;

        vehicleSections.forEach(section => {
            if (!isKd2ProcessView && !isF100ProcessView && (isKD2Module() || isF100KD2Module()) && section.units.length) {
                bodyHtml += `
      <div class="gr gr-subgroup" style="height:${Math.max(30, GANTT_GRP_H - 8)}px">
        <div class="gr-label gr-subgroup-label" style="width:${GANTT_LABEL_W}px">
          <span class="gr-subgroup-badge">${esc(section.vehicle)}</span>
        </div>
        <div class="gr-track gr-track-subgroup" style="width:${totalW}px">${trackZonesHtml}${bgCells}</div>
      </div>`;
            }

            let _prevComponentLabel = null;
            section.units.forEach(unit => {
            // ── KD2 process view: inject component separator when group changes ──
            if (isKd2ProcessView && _kd2CatMap) {
                const catInfo = _kd2CatMap.get(unit);
                if (catInfo) {
                    const compLabel = catInfo.component_group;
                    if (compLabel && compLabel !== _prevComponentLabel) {
                        _prevComponentLabel = compLabel;
                        bodyHtml += `
      <div class="gr gr-process-cat-sep" style="min-height:34px">
        <div class="gr-label gr-process-cat-label" style="width:${GANTT_LABEL_W}px;align-items:center;flex-wrap:wrap;line-height:1.3">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" style="width:10px;height:10px;flex-shrink:0;opacity:.7">
            <path d="M3 4h8M3 7h8M3 10h8" stroke-dasharray="2 1.5"/>
          </svg>
          ${esc(compLabel)}
        </div>
        <div class="gr-track gr-process-cat-track" style="width:${totalW}px">${trackZonesHtml}${bgCells}</div>
      </div>`;
                    }
                }
            }
            const tasks = groups[groupKey][unit] || [];
            const laneVehicle = isF100ProcessView ? groupKey : isKd2ProcessView ? groupKey : ((isKD2Module() || isF100KD2Module()) ? unit.split('||')[0] : groupKey);
            const laneUnit    = isF100ProcessView ? unit    : isKd2ProcessView ? unit    : ((isKD2Module() || isF100KD2Module()) ? unit.split('||').slice(1).join('||') : unit);
            // Work centers for this station (process view only — shown in label).
            // Uses task data when available, falls back to station config for empty lanes.
            const _stationWC = isKd2ProcessView
                ? (() => {
                    const fromTasks = [...new Set(tasks.map(t => t.work_center).filter(Boolean))];
                    if (fromTasks.length) return fromTasks.join(', ');
                    return _kd2CatMap?.get(unit)?.work_centers_combined || '';
                })()
                : '';
            const laneMeta = laneMetaMap[laneMetaKey(groupKey, unit)] || {};

            // ── Lane assignment for overlapping bars ─────────────────────
            const positioned = buildPositionedGanttLaneTasks(tasks, startDate, endDate);
            const numLanes = positioned.length
                ? Math.max(...positioned.map(item => item.lane)) + 1
                : 1;
            const BAR_H = 22;   // px — bar height per lane
            const BAR_GAP = 6;    // px — gap between lanes
            const LANE_H = BAR_H + BAR_GAP;
            const rowH = Math.max(GANTT_ROW_H, numLanes * LANE_H + BAR_GAP * 2);

            // ── Build bar HTML ───────────────────────────────────────────
            const bars = positioned.map(({ task, si, ei, lane }) => {
                const left = si * GANTT_DAY_W;
                const width = Math.max((ei - si + 1) * GANTT_DAY_W - 3, 6);
                // Vertical centre of this lane
                const topPx = BAR_GAP + lane * LANE_H + Math.floor((LANE_H - BAR_H) / 2);

                const color = ganttStationColor(task.process_station);
                const status = calculateStatus(task);
                const highlightState = ganttHighlightState(task);
                const actualStart = task.progress?.actual_start_date || null;

                let extraCls = ` gc-bar-state-${highlightState}`;
                if (status === 'Overdue') extraCls += ' gc-bar-overdue';

                let actualStartMarker = '';
                if (actualStart && dayIndex[actualStart] !== undefined) {
                    const aIdx = dayIndex[actualStart];
                    const tickLeft = (aIdx - si) * GANTT_DAY_W;
                    const tickColor = actualStart > task.start_date ? '#ef4444' : '#22c55e';
                    actualStartMarker = `<div class="gc-actual-start-tick" style="left:${tickLeft}px;border-color:${tickColor}" title="Actual start: ${formatDate(actualStart)}"></div>`;
                }

                const _tipUnitComp = isF100KD2Module() && !isF100ProcessView
                    ? unitCompMap[`${task.battalion_code}||${task.vehicle_type}||${task.serial_number}`] || null
                    : null;
                const tip = isF100KD2Module()
                    ? [
                        `${task.battalion_code || '—'}`,
                        task.vehicle_type ? `Vehicle      : ${task.vehicle_type} #${task.serial_number ?? '?'}` : '',
                        task.unit_label ? `Unit Label   : ${task.unit_label}` : '',
                        task.unit_code  ? `Unit Code    : ${task.unit_code}` : '',
                        task.unit_name  ? `Unit Name    : ${task.unit_name}` : '',
                        `Part         : ${task.part_name || '—'}`,
                        `Process      : #${task.step_number} ${task.process_name || task.process_station}`,
                        task.manufacturer ? `Manufacturer : ${task.manufacturer}` : '',
                        `Planned      : ${formatDate(task.planned_start_date)} → ${formatDate(task.planned_end_date)}`,
                        task.actual_start_date ? `Actual Start : ${formatDate(task.actual_start_date)}` : '',
                        task.actual_end_date   ? `Actual End   : ${formatDate(task.actual_end_date)}` : '',
                        _tipUnitComp ? `Progress     : ${_tipUnitComp.done}/${_tipUnitComp.total} steps (${_tipUnitComp.pct}%)` : '',
                        Array.isArray(task.comments) && task.comments.length ? `Comments     : ${task.comments.length}` : '',
                        `Status       : ${status}`,
                    ].filter(Boolean).join('\n')
                    : [
                        isKD2Module() ? `${task.battalion_code || '—'}  ${task.vehicle}  ${task.vehicle_no}` : `${task.vehicle}  ${task.vehicle_no}`,
                        `Station      : ${task.process_station}`,
                        isKD2Module() ? `Work Center  : ${getRowCode(task)}` : '',
                        `Planned      : ${formatDate(task.start_date)} → ${formatDate(task.end_date)}`,
                        actualStart ? `Actual Start : ${formatDate(actualStart)}` : '',
                        task.progress?.completion_date ? `Completed    : ${formatDate(task.progress.completion_date)}` : '',
                        `Status       : ${status}`,
                        task.remark ? `Remark       : ${task.remark}` : '',
                    ].filter(Boolean).join('\n');

                const menuIsOpen = _openGanttBlockMenuPlanId === task.id;
                const isSelected = _selectedGanttPlanIds.has(String(task.id));
                const blockMenu = _ganttEditMode ? `
          <button type="button" class="gc-bar-select${isSelected ? ' gc-bar-select-active' : ''}" data-plan-id="${task.id}" title="Select block" aria-label="Select block" aria-pressed="${isSelected ? 'true' : 'false'}"></button>
          <button type="button" class="gc-bar-menu-trigger" data-plan-id="${task.id}" title="Block options" aria-label="Block options" aria-expanded="${menuIsOpen ? 'true' : 'false'}">
            <span class="gc-bar-menu-trigger-dots" aria-hidden="true">
              <span class="gc-bar-menu-trigger-dot"></span>
              <span class="gc-bar-menu-trigger-dot"></span>
              <span class="gc-bar-menu-trigger-dot"></span>
            </span>
          </button>
          <div class="gc-bar-menu gc-bar-menu-compact" role="menu" aria-label="Block options">
            <div class="gc-bmc-grid">
              <button type="button" class="gc-bmc-btn gc-bmc-up gc-bar-lane-up" data-plan-id="${task.id}" title="Move up" role="menuitem">
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V3"/><path d="M3.5 6.5 7 3l3.5 3.5"/></svg>
              </button>
              <button type="button" class="gc-bmc-btn gc-bmc-dn gc-bar-lane-dn" data-plan-id="${task.id}" title="Move down" role="menuitem">
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v8"/><path d="m3.5 7.5 3.5 3.5 3.5-3.5"/></svg>
              </button>
              <button type="button" class="gc-bmc-btn gc-bmc-edit gc-bar-menu-edit" data-plan-id="${task.id}" title="Edit" role="menuitem">
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 11h1.8L10 5.3l-1.8-1.8L2.5 9.2V11Z"/><path d="m8.2 3.5 1.8 1.8"/></svg>
              </button>
              <button type="button" class="gc-bmc-btn gc-bmc-del gc-bar-menu-delete" data-plan-id="${task.id}" title="Delete" role="menuitem">
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h9"/><path d="M5.5 4V3h3v1"/><path d="M4.5 5.5v5a.75.75 0 0 0 .75.75h3.5A.75.75 0 0 0 9.5 10.5v-5"/></svg>
              </button>
            </div>
          </div>` : '';
                return `<div class="gc-bar${extraCls}${menuIsOpen ? ' gc-bar-menu-open' : ''}${isSelected ? ' gc-bar-selected' : ''}"
          data-plan-id="${task.id}"
          style="left:${left}px;width:${width}px;height:${BAR_H}px;top:${topPx}px;transform:none;background:${color}"
          title="${esc(tip)}">
          ${actualStartMarker}
          <span class="gc-bar-text">${esc(isF100ProcessView ? `${task.vehicle_type || '—'} #${task.serial_number ?? task.vehicle_no}` : isF100KD2Module() ? `${task.part_name || ''} · ${task.process_station}` : isKd2ProcessView ? `${task.battalion_code || '—'} · ${task.vehicle_no}` : isKD2Module() ? `${getRowCode(task)} · ${task.process_station}` : task.process_station)}</span>
          ${blockMenu}
        </div>`;
            }).join('');

            const rowMenuOpen = _ganttEditMode && positioned.some(item => String(item.task.id) === _openGanttBlockMenuPlanId);
            const anchorTask = positioned[0]?.task || null;
            const laneSelected = anchorTask
                ? currentData.filter(row => samePlanLane(row, anchorTask)).every(row => _selectedGanttPlanIds.has(String(row.id)))
                : false;
            const _f100UnitComp = (isF100KD2Module() && !isF100ProcessView)
                ? unitCompMap[`${tasks[0]?.battalion_code || groupKey}||${laneVehicle}||${laneUnit}`] || null
                : null;
            const _f100PctHtml = _f100UnitComp
                ? `<div class="gr-unit-pct-row"><div class="gr-unit-pct-bar-wrap"><div class="gr-unit-pct-bar-fill" style="width:${_f100UnitComp.pct}%"></div></div><span class="gr-unit-pct-text">${_f100UnitComp.done}/${_f100UnitComp.total} (${_f100UnitComp.pct}%)</span></div>`
                : '';
            const _kd2PctComp = isKD2Module()
                ? (isKd2ProcessView
                    ? _kd2StatCompMap[`${laneVehicle}||${laneUnit}`] || null
                    : _kd2UnitCompMap[`${groupKey}||${laneVehicle}||${laneUnit}`] || null)
                : null;
            const _kd2PctHtml = _kd2PctComp
                ? `<div class="gr-unit-pct-row"><div class="gr-unit-pct-bar-wrap"><div class="gr-unit-pct-bar-fill" style="width:${_kd2PctComp.pct}%"></div></div><span class="gr-unit-pct-text">${_kd2PctComp.done}/${_kd2PctComp.total} (${_kd2PctComp.pct}%)</span></div>`
                : '';
            bodyHtml += `
        <div class="gr${rowMenuOpen ? ' gc-row-menu-open' : ''}" style="height:${rowH}px">
          <div class="gr-label gr-unit-label" style="width:${GANTT_LABEL_W}px">
            <div class="gr-unit-info">
              ${isKD2Module() && !isKd2ProcessView && groupKey ? `<span class="gr-unit-ctx">${esc(laneVehicle)} · ${esc(groupKey)}</span>` : ''}
              ${isKd2ProcessView && _stationWC ? `<span class="gr-unit-ctx">${esc(_stationWC)}</span>` : ''}
              <span class="gr-unit-name">${esc(isF100ProcessView ? laneUnit : isF100KD2Module() ? (() => { const t0 = tasks[0]; const uCode = t0?.unit_code || ''; const uName = t0?.unit_name || ''; return uCode && uName ? `${uCode} · ${uName}` : uCode || uName || `${laneVehicle} #${laneUnit}`; })() : isKd2ProcessView ? laneUnit : isKD2Module() ? unitLabel(laneVehicle, laneUnit) : unitLabel(laneVehicle, laneUnit))}</span>
              ${(!isKd2ProcessView && _stationWC) ? `<span class="gr-unit-wc">${esc(_stationWC)}</span>` : ''}
              ${_f100PctHtml}
              ${_kd2PctHtml}
            </div>
            ${(isKD2Module() || isF100KD2Module()) && _ganttEditMode && _ganttSelectLaneMode && anchorTask ? `<button type="button" class="gantt-lane-select-btn" data-gantt-lane-select="${anchorTask.id}" aria-pressed="${laneSelected ? 'true' : 'false'}">${laneSelected ? 'Clear lane' : 'Select lane'}</button>` : ''}
          </div>
          <div class="gr-track" style="width:${totalW}px;height:${rowH}px"
            data-kd2-track="${(isKD2Module() || isF100KD2Module()) ? 'true' : ''}"
            data-kd2-lane-key="${esc(unit)}"
            data-battalion-id="${esc(laneMeta.battalion_id ?? '')}"
            data-battalion-code="${esc(laneMeta.battalion_code || groupKey || '')}"
            data-vehicle-type="${esc(laneMeta.vehicle_type || laneVehicle || '')}"
            data-unit-serial="${esc(laneMeta.unit_serial ?? '')}"
            data-unit-label="${esc(laneMeta.unit_label || laneUnit || '')}"
            data-gantt-days="${esc(days.join(','))}">
            ${trackZonesHtml}
            ${bgCells}
            ${bars}
          </div>
        </div>`;
            });
        });
    });

    // ── 7. Assemble ────────────────────────────────────────────────
    clearGanttHoverGuide();
    inner.innerHTML = `
    <div class="gantt-wrap" style="min-width:${innerW}px">
      <div class="gantt-head">
        <div class="gh-row gh-row-month">${mHtml}</div>
        <div class="gh-row gh-row-week">${wHtml}</div>
        <div class="gh-row gh-row-day">${dHtml}</div>
      </div>
      <div class="gantt-body">${bodyHtml}</div>
    </div>`;
    wireGanttHoverGuide();

    // ── 8. Legend ──────────────────────────────────────────────────
    const legend = document.getElementById('ganttLegend');
    if (legend) {
        const legendStations = [...new Set(visible.map(plan => String(plan.process_station || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        legend.innerHTML = legendStations.length ? `
      <div class="gantt-legend-head">
        <span class="gantt-legend-title">Visible Stations</span>
        <span class="gantt-legend-meta">${legendStations.length} station${legendStations.length === 1 ? '' : 's'} in range</span>
      </div>
      <div class="gantt-legend-grid">
        ${legendStations.map(name => `
          <div class="gantt-legend-item">
            <span class="gantt-legend-dot" style="background:${ganttStationColor(name)}"></span>
            <span class="gantt-legend-label">${esc(name)}</span>
          </div>
        `).join('')}
      </div>` : '';
    }
    syncGanttLegendUi();

    // ── 9. Show zone key bar if zones exist ────────────────────────
    const zoneKeyEl = document.getElementById('ganttZoneKey');
    if (zoneKeyEl) zoneKeyEl.style.display = specialZones.length ? 'flex' : 'none';

    // ── 10. Preserve viewport after edits/reloads ──────────────────
    if (_ganttHasRenderedOnce && previousGanttScroll) {
        restoreGanttScrollPos(previousGanttScroll);
    } else if (dayIndex[today] !== undefined) {
        const scrollRoot = document.getElementById('ganttScrollRoot');
        if (scrollRoot) {
            const todayPx = GANTT_LABEL_W + dayIndex[today] * GANTT_DAY_W;
            const offset = Math.max(0, todayPx - scrollRoot.clientWidth / 2);
            setTimeout(() => { scrollRoot.scrollLeft = offset; }, 60);
        }
    }
    _ganttHasRenderedOnce = true;
    requestAnimationFrame(positionOpenGanttBlockMenu);
}

/* ================================================================
   GANTT SCHEDULE EXCEL EXPORT
   Produces a visual Gantt chart in Excel — one column per day,
   one row per lane, task bars rendered as filled cells.
   Supports Process View (vehicle → station lanes) and
   Unit View (battalion → vehicle → unit lanes).
   ================================================================ */
let _ganttExportMenuBound = false;

function wireGanttExportMenu() {
    if (_ganttExportMenuBound) return;
    _ganttExportMenuBound = true;

    document.getElementById('btnGanttExportSchedule')?.addEventListener('click', e => {
        const menu = document.getElementById('ganttExportMenu');
        if (!menu) return;
        const open = menu.style.display !== 'none';
        menu.style.display = open ? 'none' : '';
        e.currentTarget.setAttribute('aria-expanded', open ? 'false' : 'true');
        e.stopPropagation();
    });

    document.getElementById('ganttExportMenu')?.addEventListener('click', async e => {
        const opt = e.target.closest('[data-export-view]');
        if (!opt) return;
        const view = opt.dataset.exportView;
        const menu = document.getElementById('ganttExportMenu');
        if (menu) menu.style.display = 'none';
        document.getElementById('btnGanttExportSchedule')?.setAttribute('aria-expanded', 'false');
        await exportGanttSchedule(view);
    });

    document.addEventListener('click', e => {
        const menu = document.getElementById('ganttExportMenu');
        const btn  = document.getElementById('btnGanttExportSchedule');
        if (!menu || menu.style.display === 'none') return;
        if (!menu.contains(e.target) && !btn?.contains(e.target)) {
            menu.style.display = 'none';
            btn?.setAttribute('aria-expanded', 'false');
        }
    });
}

async function exportGanttSchedule(exportView = 'process') {
    try {
        if (typeof ExcelJS === 'undefined') {
            showToast('ExcelJS not loaded — please wait and try again.', 'error'); return;
        }
        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        const startDate = gsEl?.value;
        const endDate   = geEl?.value;
        if (!startDate || !endDate || startDate > endDate) {
            showToast('Set a valid Gantt date range first.', 'error'); return;
        }
        if (!currentData?.length) { showToast('No data loaded.', 'error'); return; }

        showToast('Building Gantt schedule…', 'info');

        // ── 1. Day list (strip Fridays) ───────────────────────────
        const days    = buildVisibleGanttDays(startDate, endDate);
        const numDays = days.length;
        if (!numDays) { showToast('No days in range.', 'error'); return; }
        const today = todayStr();

        const dayMeta = days.map(d => {
            const dt = new Date(d + 'T00:00:00');
            return {
                date:    d,
                dayNum:  dt.getDate(),
                month:   dt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
                isoWeek: getISOWeek(d),
                isSat:   dt.getDay() === 6,
                isToday: d === today,
            };
        });

        // ── 2. No-work days ───────────────────────────────────────
        const specialZones = getModuleGanttZones(startDate, endDate);
        const holidayStatusByDay = new Map();
        const _dIdx = Object.fromEntries(days.map((d, i) => [d, i]));
        specialZones
            .filter(z => (z?.type === 'holiday' || z?.type === 'holiday-inactive') && z.start && z.end)
            .forEach(zone => {
                const isInactive = zone.type === 'holiday-inactive';
                let cursor = zone.start; let guard = 0;
                while (cursor <= zone.end && guard++ < 400) {
                    if (_dIdx[cursor] !== undefined) holidayStatusByDay.set(cursor, isInactive ? 'inactive' : 'active');
                    cursor = addDays(cursor, 1);
                }
            });

        // ── 3. Normalize & filter plans ──────────────────────────
        let plans = currentData;
        if (isF100KD2Module()) {
            plans = plans.map(r => ({
                ...r,
                vehicle:         r.vehicle_type  || '—',
                vehicle_no:      String(r.serial_number ?? '—'),
                process_station: r.process_name  || '—',
            }));
        }
        const visible = plans.filter(p =>
            p.start_date && p.end_date &&
            p.start_date <= endDate && p.end_date >= startDate
        );
        if (!visible.length) { showToast('No tasks fall in the selected date range.', 'error'); return; }

        // ── 4. Build groups (same logic as renderGantt) ───────────
        const isProcessView = exportView === 'process';
        const groups = {};
        visible.forEach(p => {
            const groupKey = isProcessView
                ? (p.vehicle || '—')
                : (isKD2Module() || isF100KD2Module() ? (p.battalion_code || '—') : p.vehicle);
            const laneKey = isProcessView
                ? (p.process_station || '—')
                : (isKD2Module()
                    ? `${p.vehicle}||${p.vehicle_no}`
                    : isF100KD2Module()
                        ? `${p.vehicle_type}||${p.serial_number}`
                        : p.vehicle_no);
            if (!groups[groupKey]) groups[groupKey] = {};
            if (!groups[groupKey][laneKey]) groups[groupKey][laneKey] = [];
            groups[groupKey][laneKey].push(p);
        });

        const groupKeys = Object.keys(groups).sort((a, b) => {
            if (isProcessView) return vehicleSort(a, b);
            if (isKD2Module() || isF100KD2Module()) return a.localeCompare(b, undefined, { numeric: true });
            return vehicleSort(a, b);
        });

        // ── 5. ExcelJS workbook ───────────────────────────────────
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Gantt Schedule');

        // LC = number of label columns (col1=station name, col2=work center)
        const LC = 2;

        // Freeze: label cols + first 5 header rows
        ws.views = [{ state: 'frozen', xSplit: LC, ySplit: 5, activeCell: 'C6' }];

        // Column widths: station name col=32, work center col=10, each day col=3.6
        ws.getColumn(1).width = 32;
        ws.getColumn(2).width = 10;
        for (let i = 0; i < numDays; i++) ws.getColumn(i + LC + 1).width = 3.6;

        // ── Color palette ─────────────────────────────────────────
        const C = {
            NAV:      'FF1e293b',
            WHITE:    'FFFFFFFF',
            MUTE:     'FF94a3b8',
            MONTH_BG: 'FF334155',
            WEEK_BG:  'FF475569',
            GRP_BG:   'FF1e293b',
            SUBGRP_BG:'FF1e3a5f',
            SAT_BG:   'FF64748b',
            HOL_BG:   'FFdc2626',
            INACT_BG: 'FF94a3b8',
            TODAY_BG: 'FF3b82f6',
            ROW_ALT:  'FFf8fafc',
            ROW_BASE: 'FFFFFFFF',
        };

        const mkFill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
        const toArgb = hex  => 'FF' + hex.replace('#', '').toUpperCase();
        const thinBdr = () => {
            const s = { style: 'thin', color: { argb: 'FFe2e8f0' } };
            return { left: s, right: s, top: s, bottom: s };
        };
        function lightenArgb(cssHex, amount = 0.3) {
            const h = cssHex.replace('#', '');
            const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
            const lr = Math.round(r + (255 - r) * amount), lg = Math.round(g + (255 - g) * amount), lb = Math.round(b + (255 - b) * amount);
            return 'FF' + [lr, lg, lb].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('');
        }

        let r = 1;

        // ── Row 1: Title ──────────────────────────────────────────
        const viewLabel   = isProcessView ? 'Process View' : 'Unit View';
        const moduleLabel = isKD2Module() ? 'KD2' : isF100KD2Module() ? 'F100-KD2' : 'Assembly';
        ws.getRow(r).height = 24;
        ws.mergeCells(r, 1, r, numDays + LC);
        const t1 = ws.getCell(r, 1);
        t1.value     = `${moduleLabel} Gantt Schedule — ${viewLabel}`;
        t1.font      = { name: 'Calibri', size: 14, bold: true, color: { argb: C.WHITE } };
        t1.fill      = mkFill(C.NAV);
        t1.alignment = { vertical: 'middle', indent: 1 };
        r++;

        // ── Row 2: Subtitle ───────────────────────────────────────
        ws.getRow(r).height = 14;
        ws.mergeCells(r, 1, r, numDays + LC);
        const t2 = ws.getCell(r, 1);
        t2.value     = `${formatDate(startDate)} → ${formatDate(endDate)}   ·   Generated: ${new Date().toLocaleString('en-GB')}`;
        t2.font      = { name: 'Calibri', size: 8, italic: true, color: { argb: C.MUTE } };
        t2.fill      = mkFill('FFf8fafc');
        t2.alignment = { vertical: 'middle', indent: 1 };
        r++;

        // ── Row 3: Month row ──────────────────────────────────────
        ws.getRow(r).height = 18;
        ws.getCell(r, 1).fill = mkFill(C.MONTH_BG);
        ws.getCell(r, 2).fill = mkFill(C.MONTH_BG);
        {
            let runMonth = '', runStart = 0;
            const flushMonth = (endIdx) => {
                if (!runMonth) return;
                const cs = runStart + LC + 1, ce = endIdx + LC + 1; // day idx i → col i+LC+1
                if (cs < ce) ws.mergeCells(r, cs, r, ce);
                const c = ws.getCell(r, cs);
                c.value     = runMonth;
                c.font      = { name: 'Calibri', size: 9, bold: true, color: { argb: C.WHITE } };
                c.fill      = mkFill(C.MONTH_BG);
                c.alignment = { horizontal: 'center', vertical: 'middle' };
            };
            dayMeta.forEach((dm, i) => {
                if (dm.month !== runMonth) { flushMonth(i - 1); runMonth = dm.month; runStart = i; }
            });
            flushMonth(numDays - 1);
        }
        r++;

        // ── Row 4: FW Week row ────────────────────────────────────
        ws.getRow(r).height = 16;
        ws.getCell(r, 1).fill = mkFill(C.WEEK_BG);
        ws.getCell(r, 2).fill = mkFill(C.WEEK_BG);
        {
            let runWeek = -1, runStart = 0;
            const flushWeek = (endIdx) => {
                if (runWeek === -1) return;
                const cs = runStart + LC + 1, ce = endIdx + LC + 1;
                if (cs < ce) ws.mergeCells(r, cs, r, ce);
                const c = ws.getCell(r, cs);
                c.value     = `FW${runWeek}`;
                c.font      = { name: 'Calibri', size: 8, bold: true, color: { argb: C.WHITE } };
                c.fill      = mkFill(C.WEEK_BG);
                c.alignment = { horizontal: 'center', vertical: 'middle' };
            };
            dayMeta.forEach((dm, i) => {
                if (dm.isoWeek !== runWeek) { flushWeek(i - 1); runWeek = dm.isoWeek; runStart = i; }
            });
            flushWeek(numDays - 1);
        }
        r++;

        // ── Row 5: Day numbers ────────────────────────────────────
        ws.getRow(r).height = 20;
        const dayHdrLabel = isProcessView
            ? 'Vehicle / Station'
            : (isKD2Module() ? 'Battalion / Vehicle / Unit' : 'Group / Unit');
        const dh = ws.getCell(r, 1);
        dh.value     = dayHdrLabel;
        dh.font      = { name: 'Calibri', size: 8, bold: true, color: { argb: C.WHITE } };
        dh.fill      = mkFill(C.NAV);
        dh.alignment = { horizontal: 'center', vertical: 'middle' };
        const dhWC = ws.getCell(r, 2);
        dhWC.value     = 'W/C';
        dhWC.font      = { name: 'Calibri', size: 8, bold: true, color: { argb: C.WHITE } };
        dhWC.fill      = mkFill(C.NAV);
        dhWC.alignment = { horizontal: 'center', vertical: 'middle' };

        dayMeta.forEach((dm, i) => {
            const c = ws.getCell(r, i + LC + 1);
            c.value = dm.dayNum;
            const hStat = holidayStatusByDay.get(dm.date) || '';
            const bg = hStat === 'active'   ? C.HOL_BG
                     : hStat === 'inactive' ? C.INACT_BG
                     : dm.isToday           ? C.TODAY_BG
                     : dm.isSat             ? C.SAT_BG
                                            : C.WEEK_BG;
            const txtColor = (dm.isToday && !hStat) ? C.NAV : C.WHITE;
            c.font      = { name: 'Calibri', size: 7, bold: dm.isToday, color: { argb: txtColor } };
            c.fill      = mkFill(bg);
            c.alignment = { horizontal: 'center', vertical: 'middle' };
        });
        r++;

        // ── Status → text color for bar labels ───────────────────
        // Green=Completed, Orange=InProgress, LightBlue=LateCompletion, Red=Overdue, Black=Planned
        function statusTextArgb(task) {
            const st = calculateStatus(task);
            if (st === 'Completed')       return 'FF16a34a'; // green
            if (st === 'In Progress')     return 'FFea580c'; // orange
            if (st === 'Late Completion') return 'FF2563eb'; // blue
            if (st === 'Overdue')         return 'FFdc2626'; // red
            return 'FF1e293b'; // dark navy (Planned/default)
        }

        // ── Thick outer bar border, NO inner borders ─────────────
        // Omitting left/right keys entirely for inner cells removes those borders in Excel.
        // Using NONE (transparent) still renders a thin line — so we simply don't set those keys.
        const THICK = { style: 'medium', color: { argb: 'FF000000' } };
        function barBorder(pos) {
            // pos: 'only' | 'first' | 'middle' | 'last'
            const bdr = { top: THICK, bottom: THICK };
            if (pos === 'only' || pos === 'first') bdr.left  = THICK;
            if (pos === 'only' || pos === 'last')  bdr.right = THICK;
            return bdr;
        }

        // ── 6. Helper: write one station/unit lane (one or more Excel rows) ──
        function writeLaneRows(laneLabel, tasks, rowStart) {
            const positioned = buildPositionedGanttLaneTasks(tasks, startDate, endDate);
            const numLanes   = positioned.length ? Math.max(...positioned.map(it => it.lane)) + 1 : 1;

            for (let lane = 0; lane < numLanes; lane++) {
                const excelRow = rowStart + lane;
                ws.getRow(excelRow).height = 16;

                // Col A — station / unit label (value only written in first lane; merged later)
                const lc = ws.getCell(excelRow, 1);
                lc.fill      = mkFill(C.ROW_BASE);
                lc.border    = thinBdr();
                lc.alignment = { vertical: 'middle', wrapText: true, indent: 2 };
                if (lane === 0) {
                    lc.value = laneLabel;
                    lc.font  = { name: 'Calibri', size: 8, bold: false, color: { argb: C.NAV } };
                } else {
                    lc.font = { name: 'Calibri', size: 8, color: { argb: C.MUTE } };
                }

                // Col B — work center for this lane (derived from the first task in the lane)
                const laneItems = positioned.filter(it => it.lane === lane);
                const laneWC    = laneItems.length ? (laneItems[0].task.work_center || '') : '';
                const wc = ws.getCell(excelRow, 2);
                wc.fill      = mkFill(lane % 2 === 0 ? C.ROW_BASE : C.ROW_ALT);
                wc.border    = thinBdr();
                wc.alignment = { vertical: 'middle', horizontal: 'center' };
                wc.font      = { name: 'Calibri', size: 7, color: { argb: C.MUTE } };
                if (laneWC) wc.value = laneWC;

                // Day background cells (columns LC+1 … numDays+LC)
                dayMeta.forEach((dm, di) => {
                    const c = ws.getCell(excelRow, di + LC + 1);
                    const hStat = holidayStatusByDay.get(dm.date) || '';
                    c.fill   = mkFill(hStat === 'active' ? 'FFfee2e2' : hStat === 'inactive' ? 'FFf1f5f9' : dm.isSat ? 'FFf8fafc' : C.ROW_BASE);
                    c.border = { right: { style: 'thin', color: { argb: 'FFe8edf2' } } };
                });

                // Task bars — white fill, thick outer border, no inner borders
                positioned
                    .filter(item => item.lane === lane)
                    .forEach(({ task, si, ei }) => {
                        const txtArgb = statusTextArgb(task);
                        const barLen  = ei - si + 1;
                        const barText = isProcessView
                            ? `#${task.unit_serial ?? '?'}`
                            : (task.process_station || '');

                        for (let di = si; di <= ei; di++) {
                            const c   = ws.getCell(excelRow, di + LC + 1);
                            const pos = barLen === 1 ? 'only' : di === si ? 'first' : di === ei ? 'last' : 'middle';
                            c.fill   = mkFill('FFFFFFFF');
                            c.border = barBorder(pos);
                        }
                        // Text label in the first bar cell
                        const fc = ws.getCell(excelRow, si + LC + 1);
                        fc.value     = barText;
                        fc.font      = { name: 'Calibri', size: 6, bold: false, color: { argb: txtArgb } };
                        fc.alignment = { vertical: 'middle', horizontal: 'left' };
                    });
            }

            // Merge col A vertically across all lanes so station name reads as one cell
            if (numLanes > 1) {
                ws.mergeCells(rowStart, 1, rowStart + numLanes - 1, 1);
                const mc = ws.getCell(rowStart, 1);
                mc.alignment = { vertical: 'middle', wrapText: true, indent: 2 };
            }

            return numLanes;
        }

        // ── Helper: write a thin separator row between stations ───
        function writeStationSepRow() {
            ws.getRow(r).height = 3;
            ws.mergeCells(r, 1, r, numDays + LC);
            ws.getCell(r, 1).fill = mkFill('FFe2e8f0');
            r++;
        }

        // ── Helper: write a category separator row ────────────────
        function writeCatSepRow(catName) {
            ws.getRow(r).height = 14;
            ws.mergeCells(r, 1, r, numDays + LC);
            const c = ws.getCell(r, 1);
            c.value     = catName.toUpperCase();
            c.font      = { name: 'Calibri', size: 7, bold: true, italic: true, color: { argb: 'FF1d4ed8' } };
            c.fill      = mkFill('FFdbeafe');
            c.alignment = { vertical: 'middle', indent: 2 };
            r++;
        }

        // ── 7. Data rows ──────────────────────────────────────────
        groupKeys.forEach(groupKey => {
            // Category map per vehicle for KD2 process view
            const _exportCatMap = (isProcessView && isKD2Module())
                ? (getModuleRuntime()?.getStationCategoryMap?.(groupKey) || new Map())
                : null;
            // Group header row
            ws.getRow(r).height = 18;
            ws.mergeCells(r, 1, r, numDays + LC);
            const gc = ws.getCell(r, 1);
            gc.value     = groupKey;
            gc.font      = { name: 'Calibri', size: 9, bold: true, color: { argb: C.WHITE } };
            gc.fill      = mkFill(C.GRP_BG);
            gc.alignment = { vertical: 'middle', indent: 1 };
            r++;

            const unitKeys = Object.keys(groups[groupKey]).sort((a, b) => {
                if (isProcessView) {
                    const routeOrder = getModuleRuntime()?.getStationRouteOrder?.(groupKey) || new Map();
                    const seqA = routeOrder.get(a) ?? 9999;
                    const seqB = routeOrder.get(b) ?? 9999;
                    if (seqA !== seqB) return seqA - seqB;
                }
                return a.localeCompare(b, undefined, { numeric: true });
            });

            if (!isProcessView && (isKD2Module() || isF100KD2Module())) {
                // Unit view — vehicle sub-sections
                const vehicles = [...new Set(unitKeys.map(u => u.split('||')[0]).filter(Boolean))]
                    .sort((a, b) => isF100KD2Module()
                        ? a.localeCompare(b, undefined, { numeric: true })
                        : vehicleSort(a, b));

                vehicles.forEach(vehicle => {
                    const vUnits = unitKeys.filter(u => u.startsWith(vehicle + '||'));
                    if (!vUnits.length) return;

                    // Vehicle sub-header
                    ws.getRow(r).height = 14;
                    ws.mergeCells(r, 1, r, numDays + LC);
                    const vc = ws.getCell(r, 1);
                    vc.value     = `  ${vehicle}`;
                    vc.font      = { name: 'Calibri', size: 8, bold: true, color: { argb: 'FFbfdbfe' } };
                    vc.fill      = mkFill(C.SUBGRP_BG);
                    vc.alignment = { vertical: 'middle' };
                    r++;

                    vUnits.forEach(unit => {
                        const unitLabel = unit.split('||').slice(1).join('||');
                        const laneCount = writeLaneRows(unitLabel, groups[groupKey][unit], r);
                        r += laneCount;
                        writeStationSepRow();
                    });
                });
            } else {
                // Process view (or non-KD2 unit view) — with component separators for KD2
                let prevCompLabel = null;
                unitKeys.forEach(unit => {
                    if (_exportCatMap) {
                        const catInfo = _exportCatMap.get(unit);
                        if (catInfo) {
                            const compLabel = catInfo.component_group;
                            if (compLabel && compLabel !== prevCompLabel) {
                                prevCompLabel = compLabel;
                                writeCatSepRow(compLabel);
                            }
                        }
                    }
                    const laneCount = writeLaneRows(unit, groups[groupKey][unit], r);
                    r += laneCount;
                    writeStationSepRow();
                });
            }
        });

        // ── 8. Legend sheet ──────────────────────────────────────
        const wl = wb.addWorksheet('Legend');
        wl.getColumn(1).width = 28;
        wl.getColumn(2).width = 48;

        const legendRows = [
            { type: 'title',    text: 'Gantt Schedule — How to Read This File' },
            { type: 'subtitle', text: `${moduleLabel} · ${viewLabel} · ${formatDate(startDate)} → ${formatDate(endDate)}` },
            { type: 'gap' },
            { type: 'section', text: 'SHEET STRUCTURE' },
            { type: 'item',    label: 'Row 1',         desc: 'Title — module name, view mode, date range' },
            { type: 'item',    label: 'Row 2',         desc: 'Generated timestamp' },
            { type: 'item',    label: 'Row 3',         desc: 'Month groupings (merged cells)' },
            { type: 'item',    label: 'Row 4',         desc: 'Fiscal Week (FW) groupings (merged cells)' },
            { type: 'item',    label: 'Row 5',         desc: 'Day numbers — each column = one working day (Fridays excluded)' },
            { type: 'item',    label: 'Column A',      desc: 'Station / unit label. Merged vertically when a station runs on parallel work centers.' },
            { type: 'item',    label: 'Column B (W/C)',desc: 'Work center code for each lane (e.g. W11 / W12 for parallel lines)' },
            { type: 'item',    label: 'Columns C+',    desc: 'Timeline: one column per non-Friday day in the selected range' },
            { type: 'item',    label: 'Frozen pane',   desc: 'Columns A–B and rows 1–5 stay fixed while scrolling' },
            { type: 'gap' },
            { type: 'section', text: 'ROW TYPES' },
            { type: 'swatch',  label: 'Group header',   desc: 'Dark navy row — vehicle (process view) or battalion (unit view)', argb: C.GRP_BG, txt: C.WHITE },
            { type: 'swatch',  label: 'Vehicle sub-row',desc: 'Dark blue row — vehicle type within a battalion (unit view)', argb: C.SUBGRP_BG, txt: 'FFbfdbfe' },
            { type: 'swatch',  label: 'Component divider',desc: 'Light blue row — component group separator (process view, KD2): Hull | Turret | Hull-Assembly | Turret Assembly | Processing and Testing', argb: 'FFdbeafe', txt: 'FF1d4ed8' },
            { type: 'swatch',  label: 'Data row',        desc: 'White row — one row per station/unit lane. Multiple rows appear when tasks overlap.', argb: C.ROW_BASE, txt: C.NAV },
            { type: 'gap' },
            { type: 'section', text: 'DAY COLUMN COLOURS' },
            { type: 'swatch',  label: 'Normal day',     desc: 'Standard working day', argb: C.WEEK_BG, txt: C.WHITE },
            { type: 'swatch',  label: 'Saturday',       desc: 'Saturday (reduced working day)', argb: C.SAT_BG, txt: C.WHITE },
            { type: 'swatch',  label: 'No-work day',    desc: 'Active holiday / no-work day — work is NOT planned on this day', argb: C.HOL_BG, txt: C.WHITE },
            { type: 'swatch',  label: 'Inactive holiday',desc: 'Inactive/historical no-work marker', argb: C.INACT_BG, txt: C.WHITE },
            { type: 'swatch',  label: 'Today',          desc: 'Current date', argb: C.TODAY_BG, txt: C.NAV },
            { type: 'gap' },
            { type: 'section', text: 'TASK BAR TEXT COLOURS (status indicator)' },
            { type: 'swatch',  label: 'Completed',      desc: 'Task finished on time', argb: 'FF dcfce7', txt: 'FF16a34a' },
            { type: 'swatch',  label: 'In Progress',    desc: 'Task currently being worked on', argb: 'FFfff7ed', txt: 'FFea580c' },
            { type: 'swatch',  label: 'Late Completion',desc: 'Task finished but after the planned end date', argb: 'FFeff6ff', txt: 'FF2563eb' },
            { type: 'swatch',  label: 'Overdue',        desc: 'Task not yet complete and past its planned end date — requires attention', argb: 'FFfef2f2', txt: 'FFdc2626' },
            { type: 'swatch',  label: 'Planned',        desc: 'Task not yet started, within schedule', argb: C.ROW_BASE, txt: C.NAV },
            { type: 'gap' },
            { type: 'section', text: 'TASK BARS' },
            { type: 'item',    label: 'Bar fill',       desc: 'White — no station color in the export; status is shown via text color only' },
            { type: 'item',    label: 'Bar text',       desc: isProcessView ? 'Shows vehicle number (#1, #2 …) — unit serial in the current battalion' : 'Shows process station name (unit view)' },
            { type: 'item',    label: 'Bar border',     desc: 'Thick black outer border marks the full span of the task (start → end). No inner lines.' },
            { type: 'item',    label: 'Multiple rows',  desc: 'When two tasks overlap on the same station/unit, each gets its own sub-row (lane)' },
            { type: 'gap' },
            { type: 'section', text: 'PROCESS VIEW (KD2 only)' },
            { type: 'item',    label: 'Group',          desc: 'Vehicle type (K9, K10, etc.)' },
            { type: 'item',    label: 'Component divider',desc: 'Component group in order: Hull → Turret → Assembly & Processing and Testing' },
            { type: 'item',    label: 'Lane label',     desc: 'Station name · Work Center code (e.g. "Hull - Floor  ·  W05, W06")' },
            { type: 'item',    label: 'Lane',           desc: 'One row per process station. Bars show which units (#1, #2 …) are at that station and when.' },
            { type: 'gap' },
            { type: 'section', text: 'UNIT VIEW' },
            { type: 'item',    label: 'Group',          desc: 'Battalion' },
            { type: 'item',    label: 'Sub-group',      desc: 'Vehicle type' },
            { type: 'item',    label: 'Lane',           desc: 'One row per unit. Bars show the planned process steps for that unit.' },
        ];

        let lr = 1;
        legendRows.forEach(row => {
            if (row.type === 'gap') { wl.getRow(lr).height = 8; lr++; return; }

            if (row.type === 'title') {
                wl.getRow(lr).height = 26;
                wl.mergeCells(lr, 1, lr, 2);
                const c = wl.getCell(lr, 1);
                c.value = row.text;
                c.font  = { name: 'Calibri', size: 14, bold: true, color: { argb: C.WHITE } };
                c.fill  = mkFill(C.NAV);
                c.alignment = { vertical: 'middle', indent: 1 };
                lr++; return;
            }
            if (row.type === 'subtitle') {
                wl.getRow(lr).height = 14;
                wl.mergeCells(lr, 1, lr, 2);
                const c = wl.getCell(lr, 1);
                c.value = row.text;
                c.font  = { name: 'Calibri', size: 8, italic: true, color: { argb: C.MUTE } };
                c.fill  = mkFill('FFf8fafc');
                c.alignment = { vertical: 'middle', indent: 1 };
                lr++; return;
            }
            if (row.type === 'section') {
                wl.getRow(lr).height = 16;
                wl.mergeCells(lr, 1, lr, 2);
                const c = wl.getCell(lr, 1);
                c.value = row.text;
                c.font  = { name: 'Calibri', size: 9, bold: true, color: { argb: C.WHITE } };
                c.fill  = mkFill(C.MONTH_BG);
                c.alignment = { vertical: 'middle', indent: 1 };
                lr++; return;
            }
            if (row.type === 'item') {
                wl.getRow(lr).height = 15;
                const l = wl.getCell(lr, 1);
                l.value = row.label;
                l.font  = { name: 'Calibri', size: 8, bold: true, color: { argb: C.NAV } };
                l.fill  = mkFill('FFf8fafc');
                l.alignment = { vertical: 'middle', indent: 1 };
                const d = wl.getCell(lr, 2);
                d.value = row.desc;
                d.font  = { name: 'Calibri', size: 8, color: { argb: C.NAV } };
                d.fill  = mkFill(C.ROW_BASE);
                d.alignment = { vertical: 'middle', indent: 1, wrapText: true };
                lr++; return;
            }
            if (row.type === 'swatch') {
                wl.getRow(lr).height = 15;
                const l = wl.getCell(lr, 1);
                l.value = row.label;
                l.font  = { name: 'Calibri', size: 8, bold: true, color: { argb: row.txt } };
                l.fill  = mkFill(row.argb.replace(/\s/g, ''));
                l.alignment = { vertical: 'middle', indent: 1 };
                const d = wl.getCell(lr, 2);
                d.value = row.desc;
                d.font  = { name: 'Calibri', size: 8, color: { argb: C.NAV } };
                d.fill  = mkFill(C.ROW_BASE);
                d.alignment = { vertical: 'middle', indent: 1, wrapText: true };
                lr++; return;
            }
        });

        // ── 9. Save ───────────────────────────────────────────────
        const buffer = await wb.xlsx.writeBuffer();
        const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url    = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const prefix = isKD2Module() ? 'KD2' : isF100KD2Module() ? 'F100KD2' : 'Gantt';
        anchor.href     = url;
        anchor.download = `${prefix}_Gantt_${exportView}_${startDate}_to_${endDate}.xlsx`;
        document.body.appendChild(anchor); anchor.click();
        document.body.removeChild(anchor); URL.revokeObjectURL(url);
        showToast('Gantt schedule exported!', 'success');

    } catch (err) {
        console.error('[exportGanttSchedule]', err);
        showToast('Export failed: ' + (err.message || err), 'error');
    }
}

/* ================================================================
   REPORT ENGINE
   PDF  → jsPDF + jsPDF-AutoTable
   Excel→ SheetJS (XLSX)
   ================================================================ */

/* ─── Report definitions ────────────────────────────────────────── */
const REPORT_TYPES = {
    full: { label: 'Full Report', filter: () => true },
    today: { label: "Today's Plan", filter: r => r.start_date <= todayStr() && r.end_date >= todayStr() },
    overdue: { label: 'Overdue Report', filter: r => calculateStatus(r) === 'Overdue' },
    inprogress: { label: 'In Progress Report', filter: r => calculateStatus(r) === 'In Progress' },
    completed: { label: 'Completed Report', filter: r => ['Completed', 'Late Completion'].includes(calculateStatus(r)) },
    late: { label: 'Late Completions', filter: r => calculateStatus(r) === 'Late Completion' },
    planned: { label: 'Not Started Report', filter: r => calculateStatus(r) === 'Planned' },
    vehicle: {
        label: 'By Vehicle Report', filter: r => {
            const v = getVal('filterVehicle');
            return v ? r.vehicle === v : true;
        }
    },
    // KD2-only types
    battalion: {
        label: 'By Battalion', filter: r => {
            const b = getVal('filterBattalion');
            return b ? r.battalion_code === b : true;
        }
    },
    vtype: {
        label: 'By Vehicle Type', filter: r => {
            const v = getVal('filterVehicle');
            return v ? r.vehicle === v : true;
        }
    },
    analytics: { label: 'Station Analytics', filter: () => true },
};

/* ─── Merged route-order map for reports (min seq across all vehicles) ─ */
function getReportRouteOrder() {
    const rt = getModuleRuntime();
    if (!rt?.getStationRouteOrder) return new Map();
    const merged = new Map();
    ['K9', 'K10', 'K11'].forEach(v => {
        rt.getStationRouteOrder(v).forEach((seq, name) => {
            if (!merged.has(name) || seq < merged.get(name)) merged.set(name, seq);
        });
    });
    return merged;
}

/* ─── Build the row array for a report ─────────────────────────── */
function buildReportRows(typeKey, fromDate, toDate, category) {
    const def = REPORT_TYPES[typeKey];
    if (!def) return [];

    let rows = currentData.filter(def.filter);

    const startField = isF100KD2Module() ? 'planned_start_date' : 'start_date';
    if (fromDate) rows = rows.filter(r => (r[startField] || r.start_date) >= fromDate);
    if (toDate)   rows = rows.filter(r => (r[startField] || r.start_date) <= toDate);
    // Category filter only applies to F200 modules (F100 has no station categories)
    if (category && !isF100KD2Module()) rows = rows.filter(r => getModuleCategory(r.process_station, r) === category);
    // Vehicle type filter — KD2 only
    if (isKD2Module()) {
        const vtype = getVal('reportVehicleType');
        if (vtype) rows = rows.filter(r => r.vehicle === vtype);
    }

    // Sort: Battalion → Vehicle → Unit → Station (starting from the report's primary grouping field)
    const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
    if (isKD2Module()) {
        const routeOrder = getReportRouteOrder();
        const stationCmp = (a, b) => (routeOrder.get(a.process_station) ?? 9999) - (routeOrder.get(b.process_station) ?? 9999) || cmp(a.process_station, b.process_station);
        const startFromBattalion = ['full', 'battalion'].includes(typeKey);
        rows = [...rows].sort((a, b) => {
            if (startFromBattalion) {
                const bc = cmp(a.battalion_code, b.battalion_code);
                if (bc !== 0) return bc;
            }
            return cmp(a.vehicle, b.vehicle) || cmp(a.vehicle_no, b.vehicle_no) || stationCmp(a, b);
        });
    } else if (!isF100KD2Module()) {
        rows = [...rows].sort((a, b) =>
            cmp(a.vehicle, b.vehicle) || cmp(a.vehicle_no, b.vehicle_no) || cmp(a.process_station, b.process_station)
        );
    }

    return rows;
}

/* ─── Column config ─────────────────────────────────────────────── */
const REPORT_COLUMNS = [
    { header: '#', key: (r, i) => i + 1 },
    { header: 'Vehicle', key: r => r.vehicle },
    { header: 'Unit', key: r => r.vehicle_no },
    { header: 'Station', key: r => r.process_station },
    { header: 'Code / Work Center', key: r => getRowCode(r) },
    { header: 'Category', key: r => getModuleCategory(r.process_station, r) },
    { header: 'Week', key: r => r.week || '—' },
    { header: 'Planned Start', key: r => formatDate(r.start_date) },
    { header: 'Planned End', key: r => formatDate(r.end_date) },
    { header: 'Actual Start', key: r => r.progress?.actual_start_date ? formatDate(r.progress.actual_start_date) : '—' },
    { header: 'Completed On', key: r => r.progress?.completion_date ? formatDate(r.progress.completion_date) : '—' },
    { header: 'Status', key: r => calculateStatus(r) },
    {
        header: 'Delay (days)', key: r => {
            const d = delayDays(r);
            return d > 0 ? `+${d}d` : calculateStatus(r) === 'Completed' ? 'On Time' : '—';
        }
    },
    { header: 'Remark', key: r => r.remark || '' },
    { header: 'Completion Note', key: r => r.progress?.notes || '' },
];

/* ─── F100 report column config (indices: Status=13, Delay=14) ── */
const F100_REPORT_COLUMNS = [
    { header: '#',            key: (r, i) => i + 1 },
    { header: 'Battalion',    key: r => r.battalion_code || '—' },
    { header: 'Part',         key: r => r.part_name || '—' },
    { header: 'Part No.',     key: r => r.part_number || '—' },
    { header: 'Vehicle',      key: r => r.vehicle_type || '—' },
    { header: 'Unit Code',    key: r => r.unit_code  || '—' },
    { header: 'Unit Name',    key: r => r.unit_name  || '—' },
    { header: 'Step',         key: r => r.step_number ? `#${r.step_number}` : '—' },
    { header: 'Process',      key: r => r.process_name || '—' },
    { header: 'Planned Start',key: r => formatDate(r.planned_start_date) },
    { header: 'Planned End',  key: r => formatDate(r.planned_end_date) },
    { header: 'Actual Start', key: r => formatDate(r.actual_start_date) },
    { header: 'Actual End',   key: r => formatDate(r.actual_end_date) },
    { header: 'Status',       key: r => r.status || 'Planned' },
    {
        header: 'Delay (days)', key: r => {
            const d = delayDays(r);
            return d > 0 ? `+${d}d` : (r.status === 'Completed' || r.status === 'Late Completion') ? 'On Time' : '—';
        }
    },
];

/* ─── KD2 report column config ──────────────────────────────────── */
const KD2_REPORT_COLUMNS = [
    { header: '#',                 key: (r, i) => i + 1 },
    { header: 'Battalion',         key: r => r.battalion_code || '—' },
    { header: 'Vehicle Type',      key: r => r.vehicle || '—' },
    { header: 'Unit',              key: r => r.vehicle_no || '—' },
    { header: 'Category',          key: r => getModuleCategory(r.process_station, r) || '—' },
    { header: 'Station / Process', key: r => r.process_station || '—' },
    { header: 'Work Center',       key: r => getRowCode(r) || '—' },
    { header: 'Week',              key: r => r.week || '—' },
    { header: 'Planned Start',     key: r => formatDate(r.start_date) },
    { header: 'Planned End',       key: r => formatDate(r.end_date) },
    { header: 'Actual Start',      key: r => r.progress?.actual_start_date ? formatDate(r.progress.actual_start_date) : '—' },
    { header: 'Completed On',      key: r => r.progress?.completion_date ? formatDate(r.progress.completion_date) : '—' },
    { header: 'Status',            key: r => calculateStatus(r) },
    { header: 'Delay (days)',      key: r => { const d = delayDays(r); return d > 0 ? `+${d}d` : calculateStatus(r) === 'Completed' ? 'On Time' : '—'; } },
    { header: 'Remark',            key: r => r.remark || '' },
];

/* ─── KD2 station-level analytics aggregation ───────────────────── */
function buildKD2AnalyticsRows(rows) {
    const stationMap = new Map();
    rows.forEach(r => {
        const key = r.process_station || '(Unknown)';
        if (!stationMap.has(key)) {
            stationMap.set(key, { station: key, category: getModuleCategory(r.process_station, r) || '—', rows: [] });
        }
        stationMap.get(key).rows.push(r);
    });
    const routeOrder = getReportRouteOrder();
    return [...stationMap.values()]
        .sort((a, b) => {
            const ra = routeOrder.get(a.station) ?? 9999;
            const rb = routeOrder.get(b.station) ?? 9999;
            return ra - rb || String(a.category).localeCompare(String(b.category)) || String(a.station).localeCompare(String(b.station));
        })
        .map(({ station, category, rows: sr }) => {
            const s = buildSummaryStats(sr);
            const plannedDurations = sr.map(r => {
                if (!r.start_date || !r.end_date) return null;
                const d = Math.round((new Date(r.end_date) - new Date(r.start_date)) / 86400000);
                return d >= 0 ? d : null;
            }).filter(d => d !== null);
            const avgPlanned = plannedDurations.length
                ? Math.round(plannedDurations.reduce((a, b) => a + b, 0) / plannedDurations.length) : null;
            const actualDurations = sr
                .filter(r => r.progress?.completion_date)
                .map(r => {
                    const end = r.progress.completion_date;
                    const start = r.progress?.actual_start_date || r.start_date;
                    if (!start) return null;
                    const d = Math.round((new Date(end) - new Date(start)) / 86400000);
                    return d >= 0 ? d : null;
                }).filter(d => d !== null);
            const avgActual = actualDurations.length
                ? Math.round(actualDurations.reduce((a, b) => a + b, 0) / actualDurations.length) : null;
            const delays = sr.map(r => delayDays(r)).filter(d => d > 0);
            const avgDelay = delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;
            const maxDelay = delays.length ? Math.max(...delays) : 0;
            return { station, category, ...s, avgPlanned, avgActual, avgDelay, maxDelay };
        });
}

/* ─── Status → colour map for PDF ──────────────────────────────── */
const STATUS_COLORS = {
    'Completed': [34, 197, 94],
    'Late Completion': [59, 130, 246],  // blue
    'Overdue': [220, 38, 38],
    'In Progress': [245, 158, 11],
    'Planned': [59, 130, 246],
};

/* ─── Summary stats block ───────────────────────────────────────── */
function buildSummaryStats(rows) {
    const total = rows.length;
    const completed = rows.filter(r => calculateStatus(r) === 'Completed').length;
    const late = rows.filter(r => calculateStatus(r) === 'Late Completion').length;
    const overdue = rows.filter(r => calculateStatus(r) === 'Overdue').length;
    const inProgress = rows.filter(r => calculateStatus(r) === 'In Progress').length;
    const planned = rows.filter(r => calculateStatus(r) === 'Planned').length;
    const pct = total ? Math.round(((completed + late) / total) * 100) : 0;
    return { total, completed, late, overdue, inProgress, planned, pct };
}

/* ══════════════════════════════════════════════════════════════════
   PDF EXPORT  — white / print-friendly theme
   ══════════════════════════════════════════════════════════════════ */
async function exportPDF(typeKey, fromDate, toDate, category, preview) {
    if (!await canExport()) { showToast('You do not have permission to export reports.', 'error'); return; }
    if (isKD2Module() && typeKey === 'analytics') {
        return exportKD2AnalyticsPDF(fromDate, toDate, category);
    }
    try {
    const def = REPORT_TYPES[typeKey];
    const rows = buildReportRows(typeKey, fromDate, toDate, category);

    if (!rows.length) {
        showToast('No data matches this report criteria.', 'error');
        return;
    }

    if (!window.jspdf) {
        showToast('PDF library not loaded — please refresh and try again.', 'error');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const PAGE_W = doc.internal.pageSize.getWidth();
    const PAGE_H = doc.internal.pageSize.getHeight();
    const MARGIN = 14;
    const now = new Date().toLocaleString('en-GB');
    const stats = buildSummaryStats(rows);
    const vehicle = getVal('filterVehicle') || 'All';
    const battalion = isKD2Module() ? (getVal('filterBattalion') || 'All') : '';
    const moduleBadge = getModuleBadge();
    const moduleTitle = getModuleReportTitle();
    const moduleSubtitle = getModuleReportSubtitle();

    // ── White header with blue accent stripe ─────────────────────────
    doc.setFillColor(248, 250, 252);
    doc.rect(0, 0, PAGE_W, 22, 'F');
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, 4, 22, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(0, 22, PAGE_W, 22);

    // Module badge box
    doc.setFillColor(37, 99, 235);
    doc.roundedRect(MARGIN + 2, 4, 18, 12, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(moduleBadge, MARGIN + 11, 11.5, { align: 'center' });

    // Title
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text(moduleTitle, MARGIN + 24, 10);

    // Sub-title / report label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(37, 99, 235);
    doc.text(`${moduleSubtitle.toUpperCase()} · ${def.label.toUpperCase()}`, MARGIN + 24, 17);

    // Generated timestamp (right-aligned)
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${now}`, PAGE_W - MARGIN, 17, { align: 'right' });

    // ── Active filter chips (vehicle / category / date) ───────────────
    let chipX = MARGIN;
    const chipY = 24;
    const chipH = 6;
    const chipPad = 3;
    const chips = [];
    if (battalion && battalion !== 'All') chips.push(`Battalion: ${battalion}`);
    if (vehicle !== 'All') chips.push(`Vehicle: ${vehicle}`);
    if (category) chips.push(`Category: ${category}`);
    if (fromDate || toDate) chips.push(`Date: ${fromDate || '…'} → ${toDate || '…'}`);

    chips.forEach(label => {
        const w = doc.getTextWidth(label) + chipPad * 2;
        doc.setFillColor(239, 246, 255);
        doc.setDrawColor(147, 197, 253);
        doc.roundedRect(chipX, chipY, w, chipH, 1, 1, 'FD');
        doc.setTextColor(30, 64, 175);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.text(label, chipX + chipPad, chipY + chipH - 1.5);
        chipX += w + 4;
    });

    // ── Summary stats row ─────────────────────────────────────────────
    const stats_y = chips.length ? 34 : 26;
    const boxes = [
        { label: 'Total Tasks', value: stats.total, r: 30, g: 58, b: 138 },
        { label: 'Completed', value: stats.completed, r: 22, g: 163, b: 74 },
        { label: 'In Progress', value: stats.inProgress, r: 217, g: 119, b: 6 },
        { label: 'Overdue', value: stats.overdue, r: 220, g: 38, b: 38 },
        { label: 'Late Completion', value: stats.late, r: 59, g: 130, b: 246 },
        { label: 'Not Started', value: stats.planned, r: 100, g: 116, b: 139 },
        { label: 'Completion %', value: `${stats.pct}%`, r: 15, g: 118, b: 110 },
    ];

    const boxW = (PAGE_W - MARGIN * 2) / boxes.length;
    boxes.forEach((b, i) => {
        const bx = MARGIN + i * boxW;

        // Card background
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(b.r, b.g, b.b);
        doc.setLineWidth(0.4);
        doc.roundedRect(bx, stats_y, boxW - 2, 14, 2, 2, 'FD');

        // Top accent line
        doc.setFillColor(b.r, b.g, b.b);
        doc.rect(bx, stats_y, boxW - 2, 2, 'F');

        // Value
        doc.setTextColor(b.r, b.g, b.b);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(String(b.value), bx + (boxW - 2) / 2, stats_y + 8, { align: 'center' });

        // Label
        doc.setTextColor(100, 116, 139);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.5);
        doc.text(b.label.toUpperCase(), bx + (boxW - 2) / 2, stats_y + 12.5, { align: 'center' });
    });

    // ── Data table ────────────────────────────────────────────────────
    const tableTop = stats_y + 18;
    const activeCols = isF100KD2Module() ? F100_REPORT_COLUMNS : isKD2Module() ? KD2_REPORT_COLUMNS : REPORT_COLUMNS;
    const statusColIdx = isF100KD2Module() ? 13 : isKD2Module() ? 12 : 11;
    const delayColIdx  = isF100KD2Module() ? 14 : isKD2Module() ? 13 : 12;
    const headers = activeCols.map(c => c.header);
    const body = rows.map((r, i) => activeCols.map(c => String(c.key(r, i) ?? '')));

    // Status badge colours for white background (darker shades)
    const STATUS_COLORS_LIGHT = {
        'Completed': { bg: [220, 252, 231], text: [21, 128, 61] },
        'Late Completion': { bg: [219, 234, 254], text: [37, 99, 235] },  // blue
        'Overdue': { bg: [254, 226, 226], text: [153, 27, 27] },
        'In Progress': { bg: [254, 243, 199], text: [146, 64, 14] },
        'Planned': { bg: [219, 234, 254], text: [30, 64, 175] },
    };

    doc.autoTable({
        startY: tableTop,
        head: [headers],
        body: body,
        margin: { left: MARGIN, right: MARGIN },
        styles: {
            fontSize: 7.5,
            cellPadding: 2.5,
            font: 'helvetica',
            textColor: [30, 41, 59],       // slate-800
            fillColor: [255, 255, 255],
            lineColor: [226, 232, 240],    // slate-200
            lineWidth: 0.25,
            overflow: 'linebreak',
        },
        headStyles: {
            fillColor: [30, 58, 138],
            textColor: [241, 245, 249],
            fontStyle: 'bold',
            fontSize: 7,
            halign: 'center',
        },
        alternateRowStyles: {
            fillColor: [248, 250, 252],      // slate-50
        },
        columnStyles: isF100KD2Module() ? {
            0: { halign: 'center', cellWidth: 5 },
            1: { cellWidth: 18 },
            2: { cellWidth: 28 },
            3: { cellWidth: 14 },
            4: { halign: 'center', cellWidth: 12 },
            5: { cellWidth: 18 },
            6: { cellWidth: 22 },
            7: { halign: 'center', cellWidth: 10 },
            8: { cellWidth: 28 },
            9: { cellWidth: 20 },
            10: { cellWidth: 20 },
            11: { cellWidth: 20 },
            12: { cellWidth: 20 },
            13: { halign: 'center', cellWidth: 20 },
            14: { halign: 'center', cellWidth: 13 },
        } : isKD2Module() ? {
            0: { halign: 'center', cellWidth: 5 },
            1: { cellWidth: 20 },
            2: { halign: 'center', cellWidth: 15 },
            3: { halign: 'center', cellWidth: 12 },
            4: { cellWidth: 18 },
            5: { cellWidth: 40 },
            6: { cellWidth: 16 },
            7: { halign: 'center', cellWidth: 10 },
            8: { cellWidth: 18 },
            9: { cellWidth: 18 },
            10: { cellWidth: 18 },
            11: { cellWidth: 18 },
            12: { halign: 'center', cellWidth: 18 },
            13: { halign: 'center', cellWidth: 13 },
            14: { cellWidth: 26, overflow: 'linebreak', valign: 'top' },
        } : {
            0: { halign: 'center', cellWidth: 8 },
            1: { cellWidth: 16 },
            2: { cellWidth: 14 },
            3: { cellWidth: 28 },
            4: { cellWidth: 18 },
            5: { cellWidth: 12 },
            6: { cellWidth: 20 },
            7: { cellWidth: 20 },
            8: { cellWidth: 20 },
            9: { cellWidth: 20 },
            10: { halign: 'center', cellWidth: 18 },
            11: { halign: 'center', cellWidth: 16 },
            12: { cellWidth: 28, overflow: 'linebreak', valign: 'top' },
            13: { cellWidth: 40, overflow: 'linebreak', valign: 'top' },
        },
        didDrawCell(data) {
            if (data.section === 'body' && data.column.index === statusColIdx) {
                const status = data.cell.raw;
                const clr = STATUS_COLORS_LIGHT[status];
                if (clr) {
                    // Badge background
                    doc.setFillColor(...clr.bg);
                    doc.setDrawColor(...clr.bg);
                    const px = data.cell.x + 1;
                    const py = data.cell.y + 1.5;
                    const pw = data.cell.width - 2;
                    const ph = data.cell.height - 3;
                    doc.roundedRect(px, py, pw, ph, 1, 1, 'F');
                    // Badge text
                    doc.setTextColor(...clr.text);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(6);
                    doc.text(status, px + pw / 2, py + ph / 2 + 0.5, { align: 'center', baseline: 'middle' });
                }
            }
            // Delay cell — erase autoTable text then redraw in red
            if (data.section === 'body' && data.column.index === delayColIdx) {
                const val = String(data.cell.raw || '');
                if (val.startsWith('+')) {
                    // Cover the black text autoTable already drew
                    const bg = data.row.index % 2 === 0 ? [255, 255, 255] : [248, 250, 252];
                    doc.setFillColor(...bg);
                    doc.rect(data.cell.x + 0.2, data.cell.y + 0.2,
                        data.cell.width - 0.4, data.cell.height - 0.4, 'F');
                    // Redraw in red
                    doc.setTextColor(153, 27, 27);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(7);
                    doc.text(val, data.cell.x + data.cell.width / 2,
                        data.cell.y + data.cell.height / 2,
                        { align: 'center', baseline: 'middle' });
                }
            }
        },
        didDrawPage(data) {
            // Thin navy top stripe on continuation pages
            if (data.pageNumber > 1) {
                doc.setFillColor(30, 58, 138);
                doc.rect(0, 0, PAGE_W, 6, 'F');
                doc.setTextColor(186, 230, 253);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(6.5);
                doc.text(`${moduleBadge} ${moduleTitle} — ${def.label}`, MARGIN, 4.5);
            }
            // Footer separator line
            const pY = PAGE_H - 8;
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.3);
            doc.line(MARGIN, pY, PAGE_W - MARGIN, pY);

            doc.setFontSize(6.5);
            doc.setTextColor(148, 163, 184);
            doc.setFont('helvetica', 'normal');
            doc.text(`${moduleBadge} ${moduleTitle} — Confidential`, MARGIN, pY + 3.5);
            doc.text(
                `Page ${data.pageNumber} of ${doc.internal.getNumberOfPages()}`,
                PAGE_W - MARGIN, pY + 3.5, { align: 'right' }
            );
        },
    });

    // ── Save ─────────────────────────────────────────────────────────
    const catSuffix = category ? `_${category.replace(/\s+/g, '_')}` : '';
    const dateSuffix = new Date().toISOString().slice(0, 10);
    const doDownload = () => {
        doc.save(`${moduleBadge}_${def.label.replace(/\s+/g, '_')}${catSuffix}_${dateSuffix}.pdf`);
        showToast(`PDF exported — ${rows.length} rows`, 'success');
    };
    if (preview) {
        _showGenericPreview({ title: def.label, kind: 'pdf', src: doc.output('bloburl'), onDownload: doDownload });
    } else {
        doDownload();
    }
    } catch (err) {
        console.error('[exportPDF]', err);
        showToast('PDF export failed: ' + (err.message || err), 'error');
    }
}

/* ══════════════════════════════════════════════════════════════════
   EXCEL EXPORT
   ══════════════════════════════════════════════════════════════════ */
async function exportExcel(typeKey, fromDate, toDate, category, preview) {
    if (!await canExport()) { showToast('You do not have permission to export reports.', 'error'); return; }
    if (isKD2Module() && typeKey === 'analytics') {
        return exportKD2AnalyticsExcel(fromDate, toDate, category);
    }
    try {
    if (typeof ExcelJS === 'undefined') {
        showToast('ExcelJS not loaded — please wait and try again.', 'error'); return;
    }

    const def = REPORT_TYPES[typeKey];
    const rows = buildReportRows(typeKey, fromDate, toDate, category);
    if (!rows.length) { showToast('No data matches this report criteria.', 'error'); return; }

    const stats = buildSummaryStats(rows);

    // ── Active filter labels for title ─────────────────────────────
    const moduleBadge = getModuleBadge();
    const fBattalion = isKD2Module() ? getVal('filterBattalion') : '';
    const fVehicle = getVal('filterVehicle');
    const fUnit = getVal('filterUnit');
    const fWeek = getVal('filterWeek');
    const fTF = getVal('filterTimeFrame');
    const fCategory = category || getVal('filterCategory');
    const fFrom = fromDate || getVal('filterStartDate');
    const fTo = toDate || getVal('filterEndDate');

    const titleParts = [moduleBadge];
    if (fBattalion) titleParts.push(fBattalion);
    if (fVehicle) titleParts.push(fVehicle);
    if (fUnit) titleParts.push(fUnit);
    if (fCategory) titleParts.push(fCategory);
    titleParts.push(def.label);
    const sheetTitle = titleParts.join(' · ');

    const filterChips = [];
    if (fBattalion) filterChips.push('Battalion: ' + fBattalion);
    if (fVehicle) filterChips.push('Vehicle: ' + fVehicle);
    if (fUnit) filterChips.push(isKD2Module()
        ? 'Unit: ' + fUnit
        : 'Unit: ' + (getUnitCode(fVehicle, fUnit) ? fUnit + ' · ' + getUnitCode(fVehicle, fUnit) : fUnit));
    if (fWeek) filterChips.push('Week: ' + fWeek);
    if (fTF && fTF !== 'custom') filterChips.push('Time Frame: ' + fTF);
    if (fFrom || fTo) filterChips.push('Dates: ' + (fFrom || '…') + ' → ' + (fTo || '…'));
    if (fCategory) filterChips.push('Category: ' + fCategory);

    // ── Colour palette (matches VPX Excel) ─────────────────────────
    const ST = {
        'Completed': { bg: 'FFdcfce7', fg: 'FF15803d', dot: 'FF22c55e' },
        'In Progress': { bg: 'FFfef9c3', fg: 'FF854d0e', dot: 'FFf59e0b' },
        'Late Completion': { bg: 'FFdbeafe', fg: 'FF1d4ed8', dot: 'FF3b82f6' },
        'Overdue': { bg: 'FFfee2e2', fg: 'FF991b1b', dot: 'FFdc2626' },
        'Planned': { bg: 'FFf8fafc', fg: 'FF475569', dot: 'FF94a3b8' },
    };
    const NAV = 'FF1e293b';
    const HDR = 'FFf1f5f9';
    const MUTE = 'FF64748b';
    const BORD = 'FFe2e8f0';
    const BORD_MED = 'FF94a3b8';
    const WHITE = 'FFffffff';
    const ALT = 'FFf9fafb';

    function border(style = 'thin') {
        return {
            top: { style, color: { argb: BORD } }, bottom: { style, color: { argb: BORD } },
            left: { style, color: { argb: BORD } }, right: { style, color: { argb: BORD } }
        };
    }
    function hdrBorder() {
        return {
            top: { style: 'medium', color: { argb: BORD_MED } }, bottom: { style: 'medium', color: { argb: BORD_MED } },
            left: { style: 'thin', color: { argb: BORD } }, right: { style: 'thin', color: { argb: BORD } }
        };
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = `${moduleBadge} ${getModuleReportTitle()}`;
    wb.created = new Date();

    // ════════════════════════════════════════════════════════════════
    //  SHEET 1 — Report Data
    // ════════════════════════════════════════════════════════════════
    const ws = wb.addWorksheet('Report Data', {
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 4 }],
    });

    // Column config — F100 / KD2 / KD1 depending on active module
    const COLS = isF100KD2Module() ? [
        { header: '#',            width: 5,  key: (r, i) => i + 1 },
        { header: 'Battalion',    width: 16, key: r => r.battalion_code || '—' },
        { header: 'Part',         width: 24, key: r => r.part_name || '—' },
        { header: 'Part No.',     width: 14, key: r => r.part_number || '—' },
        { header: 'Vehicle',      width: 10, key: r => r.vehicle_type || '—' },
        { header: 'Unit Code',    width: 16, key: r => r.unit_code  || '—' },
        { header: 'Unit Name',    width: 20, key: r => r.unit_name  || '—' },
        { header: 'Step',         width: 8,  key: r => r.step_number ? `#${r.step_number}` : '—' },
        { header: 'Process',      width: 24, key: r => r.process_name || '—' },
        { header: 'Planned Start',width: 14, key: r => r.planned_start_date || '—' },
        { header: 'Planned End',  width: 14, key: r => r.planned_end_date || '—' },
        { header: 'Actual Start', width: 14, key: r => r.actual_start_date || '—' },
        { header: 'Actual End',   width: 14, key: r => r.actual_end_date || '—' },
        { header: 'Status',       width: 18, key: r => r.status || 'Planned' },
        { header: 'Delay (days)', width: 13, key: r => { const d = delayDays(r); return d > 0 ? `+${d}d` : (r.status === 'Completed' || r.status === 'Late Completion') ? 'On Time' : '—'; } },
    ] : isKD2Module() ? [
        { header: '#',                 width: 5,  key: (r, i) => i + 1 },
        { header: 'Battalion',         width: 18, key: r => r.battalion_code || '—' },
        { header: 'Vehicle Type',      width: 14, key: r => r.vehicle || '—' },
        { header: 'Unit',              width: 10, key: r => r.vehicle_no || '—' },
        { header: 'Category',          width: 18, key: r => getModuleCategory(r.process_station, r) || '—' },
        { header: 'Station / Process', width: 36, key: r => r.process_station || '—' },
        { header: 'Work Center',       width: 16, key: r => getRowCode(r) || '—' },
        { header: 'Week',              width: 10, key: r => r.week || '—' },
        { header: 'Planned Start',     width: 14, key: r => r.start_date || '—' },
        { header: 'Planned End',       width: 14, key: r => r.end_date || '—' },
        { header: 'Actual Start',      width: 14, key: r => r.progress?.actual_start_date || '—' },
        { header: 'Completed On',      width: 14, key: r => r.progress?.completion_date || '—' },
        { header: 'Status',            width: 18, key: r => calculateStatus(r) },
        { header: 'Delay (days)',      width: 13, key: r => { const d = delayDays(r); return d > 0 ? '+' + d + 'd' : calculateStatus(r) === 'Completed' ? 'On Time' : '—'; } },
        { header: 'Remark',            width: 24, key: r => r.remark || '' },
    ] : [
        { header: '#', width: 5, key: (r, i) => i + 1 },
        { header: 'Vehicle', width: 10, key: r => r.vehicle },
        { header: 'Unit', width: 10, key: r => r.vehicle_no },
        { header: 'Unit Code', width: 16, key: r => getUnitCode(r.vehicle, r.vehicle_no) || '—' },
        { header: 'Station', width: 26, key: r => r.process_station },
        { header: 'Code / Work Center', width: 18, key: r => getRowCode(r) },
        { header: 'Category', width: 16, key: r => getModuleCategory(r.process_station, r) },
        { header: 'Week', width: 8, key: r => r.week || '—' },
        { header: 'Planned Start', width: 14, key: r => r.start_date || '—' },
        { header: 'Planned End', width: 14, key: r => r.end_date || '—' },
        { header: 'Actual Start', width: 14, key: r => r.progress?.actual_start_date || '—' },
        { header: 'Completed On', width: 14, key: r => r.progress?.completion_date || '—' },
        { header: 'Status', width: 18, key: r => calculateStatus(r) },
        { header: 'Delay (days)', width: 13, key: r => { const d = delayDays(r); return d > 0 ? '+' + d + 'd' : calculateStatus(r) === 'Completed' ? 'On Time' : '—'; } },
        { header: 'Remark', width: 22, key: r => r.remark || '' },
        { header: 'Completion Note', width: 36, key: r => r.progress?.notes || '' },
    ];

    ws.columns = COLS.map(c => ({ width: c.width }));

    // ── Row 1: Title ───────────────────────────────────────────────
    ws.addRow([sheetTitle]);
    ws.mergeCells(1, 1, 1, COLS.length);
    const r1 = ws.getCell(1, 1);
    r1.font = { name: 'Calibri', size: 15, bold: true, color: { argb: NAV } };
    r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WHITE } };
    r1.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 26;

    // ── Row 2: Filters & timestamp ─────────────────────────────────
    const filterStr = filterChips.length ? filterChips.join('   |   ') : 'No filters applied';
    ws.addRow(['Filters: ' + filterStr + '     Generated: ' + new Date().toLocaleString('en-GB')]);
    ws.mergeCells(2, 1, 2, COLS.length);
    const r2 = ws.getCell(2, 1);
    r2.font = { name: 'Calibri', size: 8, italic: true, color: { argb: MUTE } };
    r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WHITE } };
    r2.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(2).height = 14;

    // ── Row 3: Blank spacer ────────────────────────────────────────
    ws.addRow([]);
    ws.getRow(3).height = 5;

    // ── Row 4: Column headers ──────────────────────────────────────
    ws.addRow(COLS.map(c => c.header));
    const hdrRow = ws.getRow(4);
    hdrRow.height = 18;
    COLS.forEach((_, ci) => {
        const cell = ws.getCell(4, ci + 1);
        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: WHITE } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAV } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
        cell.border = hdrBorder();
    });

    // ── Data rows ──────────────────────────────────────────────────
    rows.forEach((r, ri) => {
        const status = calculateStatus(r);
        const st = ST[status] || ST['Planned'];
        const isAlt = ri % 2 === 1;
        const rowBg = isAlt ? ALT : WHITE;

        const values = COLS.map((c, ci) => c.key(r, ri));
        ws.addRow(values);
        const dataRow = ws.getRow(ri + 5);
        dataRow.height = 16;

        COLS.forEach((col, ci) => {
            const cell = ws.getCell(ri + 5, ci + 1);
            const colHdr = col.header;

            // Status cell — coloured badge
            if (colHdr === 'Status') {
                cell.font = { name: 'Calibri', size: 8, bold: true, color: { argb: st.fg } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.bg } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            }
            // Delay cell — red if positive
            else if (colHdr === 'Delay (days)') {
                const val = String(cell.value || '');
                const isLate = val.startsWith('+');
                cell.font = { name: 'Calibri', size: 8, bold: isLate, color: { argb: isLate ? 'FF991b1b' : 'FF475569' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isLate ? 'FFfee2e2' : rowBg } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            }
            // # column
            else if (colHdr === '#') {
                cell.font = { name: 'Calibri', size: 8, color: { argb: MUTE } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            }
            // Unit Code — muted
            else if (colHdr === 'Unit Code' || colHdr === 'Battalion') {
                cell.font = { name: 'Calibri', size: 8, italic: true, color: { argb: MUTE } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
                cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
            }
            // Notes — wrap text
            else if (colHdr === 'Completion Note' || colHdr === 'Remark') {
                cell.font = { name: 'Calibri', size: 8, color: { argb: NAV } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
                cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true, indent: 1 };
                dataRow.height = Math.max(dataRow.height, 28);
            }
            // Default
            else {
                cell.font = { name: 'Calibri', size: 8, color: { argb: NAV } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
                cell.alignment = { horizontal: ci === 0 ? 'center' : 'left', vertical: 'middle', indent: ci > 0 ? 1 : 0 };
            }
            cell.border = border();
        });
    });

    // ════════════════════════════════════════════════════════════════
    //  SHEET 2 — Summary
    // ════════════════════════════════════════════════════════════════
    const wsSumm = wb.addWorksheet('Summary');
    wsSumm.columns = [{ width: 24 }, { width: 16 }, { width: 14 }];

    // Title
    wsSumm.addRow([sheetTitle]);
    wsSumm.mergeCells(1, 1, 1, 3);
    const sT = wsSumm.getCell(1, 1);
    sT.font = { name: 'Calibri', size: 14, bold: true, color: { argb: NAV } };
    sT.alignment = { vertical: 'middle' };
    wsSumm.getRow(1).height = 26;

    wsSumm.addRow(['Generated: ' + new Date().toLocaleString('en-GB')]);
    wsSumm.mergeCells(2, 1, 2, 3);
    wsSumm.getCell(2, 1).font = { name: 'Calibri', size: 8, italic: true, color: { argb: MUTE } };
    wsSumm.getRow(2).height = 14;

    wsSumm.addRow([]); wsSumm.getRow(3).height = 8;

    // Active filters block
    if (filterChips.length) {
        wsSumm.addRow(['Active Filters']);
        wsSumm.mergeCells(4, 1, 4, 3);
        wsSumm.getCell(4, 1).font = { name: 'Calibri', size: 9, bold: true, color: { argb: MUTE } };
        wsSumm.getRow(4).height = 14;
        filterChips.forEach((chip, i) => {
            wsSumm.addRow(['', chip]);
            const chipCell = wsSumm.getCell(5 + i, 2);
            chipCell.font = { name: 'Calibri', size: 9, color: { argb: NAV } };
            wsSumm.mergeCells(5 + i, 2, 5 + i, 3);
            wsSumm.getRow(5 + i).height = 14;
        });
    }
    const summDataStart = filterChips.length ? 5 + filterChips.length + 1 : 4;

    // Stats header
    wsSumm.addRow([]);
    const shRow = wsSumm.addRow(['Metric', 'Count', '% of Total']);
    shRow.height = 17;
    [1, 2, 3].forEach(c => {
        const cell = wsSumm.getCell(shRow.number, c);
        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: WHITE } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAV } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = hdrBorder();
    });

    const summRows = [
        { label: 'Total Tasks', val: stats.total, pct: '100%', bg: HDR, fg: NAV },
        { label: 'Completed', val: stats.completed, pct: Math.round(stats.completed / stats.total * 100) + '%', bg: ST['Completed'].bg, fg: ST['Completed'].fg },
        { label: 'In Progress', val: stats.inProgress, pct: Math.round(stats.inProgress / stats.total * 100) + '%', bg: ST['In Progress'].bg, fg: ST['In Progress'].fg },
        { label: 'Planned', val: stats.planned, pct: Math.round(stats.planned / stats.total * 100) + '%', bg: ST['Planned'].bg, fg: ST['Planned'].fg },
        { label: 'Overdue', val: stats.overdue, pct: Math.round(stats.overdue / stats.total * 100) + '%', bg: ST['Overdue'].bg, fg: ST['Overdue'].fg },
        { label: 'Late Completion', val: stats.late, pct: Math.round(stats.late / stats.total * 100) + '%', bg: ST['Late Completion'].bg, fg: ST['Late Completion'].fg },
        { label: 'Overall Progress', val: stats.pct + '%', pct: '', bg: 'FFe0f2fe', fg: 'FF0369a1' },
    ];
    summRows.forEach(sr => {
        const row = wsSumm.addRow([sr.label, sr.val, sr.pct]);
        row.height = 18;
        [1, 2, 3].forEach(c => {
            const cell = wsSumm.getCell(row.number, c);
            cell.font = { name: 'Calibri', size: 9, bold: c === 1, color: { argb: sr.fg } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sr.bg } };
            cell.alignment = { horizontal: c === 1 ? 'left' : 'center', vertical: 'middle', indent: c === 1 ? 1 : 0 };
            cell.border = border();
        });
    });

    // ════════════════════════════════════════════════════════════════
    //  SHEET 3 — By Vehicle Breakdown
    // ════════════════════════════════════════════════════════════════
    const wsBV = wb.addWorksheet('By Vehicle');
    const BV_HDR = ['Vehicle', 'Total', 'Completed', 'In Progress', 'Planned', 'Overdue', 'Late Completion', 'Progress %'];
    wsBV.columns = BV_HDR.map(() => ({ width: 16 }));

    wsBV.addRow([sheetTitle]);
    wsBV.mergeCells(1, 1, 1, BV_HDR.length);
    wsBV.getCell(1, 1).font = { name: 'Calibri', size: 13, bold: true, color: { argb: NAV } };
    wsBV.getCell(1, 1).alignment = { vertical: 'middle' };
    wsBV.getRow(1).height = 22;
    wsBV.addRow([]); wsBV.getRow(2).height = 6;

    const bvHdrRow = wsBV.addRow(BV_HDR);
    bvHdrRow.height = 17;
    BV_HDR.forEach((_, ci) => {
        const cell = wsBV.getCell(3, ci + 1);
        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: WHITE } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAV } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = hdrBorder();
    });

    const vehicles = [...new Set(rows.map(r => r.vehicle))].sort(vehicleSort);
    vehicles.forEach((v, vi) => {
        const vRows = rows.filter(r => r.vehicle === v);
        const s = buildSummaryStats(vRows);
        const isAlt = vi % 2 === 1;
        const rowBg = isAlt ? ALT : WHITE;
        const bvRow = wsBV.addRow([v, s.total, s.completed, s.inProgress, s.planned, s.overdue, s.late, s.pct + '%']);
        bvRow.height = 17;
        BV_HDR.forEach((hdr, ci) => {
            const cell = wsBV.getCell(bvRow.number, ci + 1);
            let bg = rowBg, fg = NAV, bold = false;
            if (hdr === 'Vehicle') { bold = true; }
            if (hdr === 'Progress %') { bg = s.pct >= 80 ? ST['Completed'].bg : s.pct >= 40 ? ST['In Progress'].bg : ST['Overdue'].bg; fg = s.pct >= 80 ? ST['Completed'].fg : s.pct >= 40 ? ST['In Progress'].fg : ST['Overdue'].fg; }
            if (hdr === 'Overdue' && s.overdue > 0) { bg = ST['Overdue'].bg; fg = ST['Overdue'].fg; }
            if (hdr === 'Late Completion' && s.late > 0) { bg = ST['Late Completion'].bg; fg = ST['Late Completion'].fg; }
            cell.font = { name: 'Calibri', size: 9, bold, color: { argb: fg } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
            cell.alignment = { horizontal: ci === 0 ? 'left' : 'center', vertical: 'middle', indent: ci === 0 ? 1 : 0 };
            cell.border = border();
        });
    });

    // ── Save ───────────────────────────────────────────────────────
    const doDownload = async () => {
        showToast('Building Excel…', 'info');
        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = moduleBadge + '_' + def.label.replace(/\s+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        showToast(`Excel exported — ${rows.length} rows`, 'success');
    };
    if (preview) {
        _showGenericPreview({ title: def.label, kind: 'sheets', sheets: _workbookToSheets(wb), onDownload: doDownload });
    } else {
        await doDownload();
    }
    } catch (err) {
        console.error('[exportExcel]', err);
        showToast('Excel export failed: ' + (err.message || err), 'error');
    }
}



/* ================================================================
   KD2 ANALYTICS EXPORT  (station-level aggregated report)
   ================================================================ */
function exportKD2AnalyticsPDF(fromDate, toDate, category) {
    try {
    if (!window.jspdf) { showToast('PDF library not loaded — please refresh.', 'error'); return; }
    const baseRows = buildReportRows('full', fromDate, toDate, category);
    if (!baseRows.length) { showToast('No data for analytics report.', 'error'); return; }
    const aRows = buildKD2AnalyticsRows(baseRows);
    if (!aRows.length) { showToast('No station data to analyse.', 'error'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const PAGE_W = doc.internal.pageSize.getWidth();
    const PAGE_H = doc.internal.pageSize.getHeight();
    const MARGIN = 14;
    const now = new Date().toLocaleString('en-GB');
    const stats = buildSummaryStats(baseRows);
    const moduleBadge = getModuleBadge();
    const moduleTitle = getModuleReportTitle();

    // ── White header with blue accent stripe ─────────────────────────
    doc.setFillColor(248, 250, 252);
    doc.rect(0, 0, PAGE_W, 22, 'F');
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, 4, 22, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(0, 22, PAGE_W, 22);

    doc.setFillColor(37, 99, 235);
    doc.roundedRect(MARGIN + 2, 4, 18, 12, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(moduleBadge, MARGIN + 11, 11.5, { align: 'center' });
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text(moduleTitle, MARGIN + 24, 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(37, 99, 235);
    doc.text('STATION ANALYTICS · PLAN VS ACTUAL TIMING · DELAY SUMMARY', MARGIN + 24, 17);
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated: ${now}`, PAGE_W - MARGIN, 17, { align: 'right' });

    // Filter chips
    const chips = [];
    const fBattalion = getVal('filterBattalion');
    const fVehicle = getVal('filterVehicle');
    if (fBattalion && fBattalion !== 'All') chips.push(`Battalion: ${fBattalion}`);
    if (fVehicle && fVehicle !== 'All') chips.push(`Vehicle Type: ${fVehicle}`);
    if (category) chips.push(`Category: ${category}`);
    if (fromDate || toDate) chips.push(`Date: ${fromDate || '…'} → ${toDate || '…'}`);
    let chipX = MARGIN;
    chips.forEach(label => {
        const w = doc.getTextWidth(label) + 6;
        doc.setFillColor(239, 246, 255); doc.setDrawColor(147, 197, 253);
        doc.roundedRect(chipX, 24, w, 6, 1, 1, 'FD');
        doc.setTextColor(30, 64, 175); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
        doc.text(label, chipX + 3, 28.5);
        chipX += w + 4;
    });

    // Summary stats
    const stats_y = chips.length ? 34 : 26;
    const boxes = [
        { label: 'Total Tasks', value: stats.total, r: 30, g: 58, b: 138 },
        { label: 'Completed', value: stats.completed, r: 22, g: 163, b: 74 },
        { label: 'In Progress', value: stats.inProgress, r: 217, g: 119, b: 6 },
        { label: 'Overdue', value: stats.overdue, r: 220, g: 38, b: 38 },
        { label: 'Late Completion', value: stats.late, r: 59, g: 130, b: 246 },
        { label: 'Stations', value: aRows.length, r: 15, g: 118, b: 110 },
        { label: 'Completion %', value: `${stats.pct}%`, r: 79, g: 70, b: 229 },
    ];
    const boxW = (PAGE_W - MARGIN * 2) / boxes.length;
    boxes.forEach((b, i) => {
        const bx = MARGIN + i * boxW;
        doc.setFillColor(248, 250, 252); doc.setDrawColor(b.r, b.g, b.b); doc.setLineWidth(0.4);
        doc.roundedRect(bx, stats_y, boxW - 2, 14, 2, 2, 'FD');
        doc.setFillColor(b.r, b.g, b.b); doc.rect(bx, stats_y, boxW - 2, 2, 'F');
        doc.setTextColor(b.r, b.g, b.b); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.text(String(b.value), bx + (boxW - 2) / 2, stats_y + 8, { align: 'center' });
        doc.setTextColor(100, 116, 139); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
        doc.text(b.label.toUpperCase(), bx + (boxW - 2) / 2, stats_y + 12.5, { align: 'center' });
    });

    // Analytics table
    const headers = ['Station / Process', 'Category', 'Total', 'Done', 'In Prog', 'Overdue', 'Late', '% Done', 'Avg Plan (d)', 'Avg Actual (d)', 'Avg Delay', 'Max Delay'];
    const body = aRows.map(ar => [
        ar.station, ar.category,
        ar.total, ar.completed, ar.inProgress, ar.overdue, ar.late,
        `${ar.pct}%`,
        ar.avgPlanned !== null ? `${ar.avgPlanned}d` : '—',
        ar.avgActual  !== null ? `${ar.avgActual}d`  : '—',
        ar.avgDelay > 0 ? `+${ar.avgDelay}d` : '—',
        ar.maxDelay > 0 ? `+${ar.maxDelay}d` : '—',
    ]);

    doc.autoTable({
        startY: stats_y + 18,
        head: [headers], body,
        margin: { left: MARGIN, right: MARGIN },
        styles: { fontSize: 7.5, cellPadding: 2.5, font: 'helvetica', textColor: [30, 41, 59], fillColor: [255, 255, 255], lineColor: [226, 232, 240], lineWidth: 0.25, overflow: 'linebreak' },
        headStyles: { fillColor: [30, 58, 138], textColor: [241, 245, 249], fontStyle: 'bold', fontSize: 7, halign: 'center' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
            0: { cellWidth: 44 }, 1: { cellWidth: 22 },
            2: { halign: 'center', cellWidth: 13 }, 3: { halign: 'center', cellWidth: 16 },
            4: { halign: 'center', cellWidth: 14 }, 5: { halign: 'center', cellWidth: 16 },
            6: { halign: 'center', cellWidth: 16 }, 7: { halign: 'center', cellWidth: 14 },
            8: { halign: 'center', cellWidth: 22 }, 9: { halign: 'center', cellWidth: 22 },
            10: { halign: 'center', cellWidth: 20 }, 11: { halign: 'center', cellWidth: 20 },
        },
        didDrawCell(data) {
            if (data.section !== 'body') return;
            const val = String(data.cell.raw ?? '');
            const rowBg = data.row.index % 2 === 0 ? [255, 255, 255] : [248, 250, 252];
            const redraw = (bg, fg, bold) => {
                doc.setFillColor(...bg); doc.rect(data.cell.x + 0.2, data.cell.y + 0.2, data.cell.width - 0.4, data.cell.height - 0.4, 'F');
                doc.setTextColor(...fg); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(7);
                doc.text(val, data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2, { align: 'center', baseline: 'middle' });
            };
            if (data.column.index === 7) {
                const pct = parseInt(val);
                if (pct >= 80) redraw([220, 252, 231], [21, 128, 61], true);
                else if (pct >= 40) redraw([254, 243, 199], [146, 64, 14], true);
                else if (!isNaN(pct)) redraw([254, 226, 226], [153, 27, 27], true);
            }
            if ((data.column.index === 10 || data.column.index === 11) && val.startsWith('+')) {
                redraw(rowBg, [153, 27, 27], true);
            }
            if (data.column.index === 5 && parseInt(val) > 0) {
                redraw(rowBg, [153, 27, 27], true);
            }
        },
        didDrawPage(data) {
            if (data.pageNumber > 1) {
                doc.setFillColor(30, 58, 138); doc.rect(0, 0, PAGE_W, 6, 'F');
                doc.setTextColor(186, 230, 253); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
                doc.text(`${moduleBadge} ${moduleTitle} — Station Analytics`, MARGIN, 4.5);
            }
            const pY = PAGE_H - 8;
            doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3); doc.line(MARGIN, pY, PAGE_W - MARGIN, pY);
            doc.setFontSize(6.5); doc.setTextColor(148, 163, 184); doc.setFont('helvetica', 'normal');
            doc.text(`${moduleBadge} ${moduleTitle} — Confidential`, MARGIN, pY + 3.5);
            doc.text(`Page ${data.pageNumber} of ${doc.internal.getNumberOfPages()}`, PAGE_W - MARGIN, pY + 3.5, { align: 'right' });
        },
    });

    doc.save(`${moduleBadge}_Station_Analytics_${new Date().toISOString().slice(0, 10)}.pdf`);
    showToast(`Analytics PDF exported — ${aRows.length} stations`, 'success');
    } catch (err) {
        console.error('[exportKD2AnalyticsPDF]', err);
        showToast('Analytics PDF export failed: ' + (err.message || err), 'error');
    }
}

async function exportKD2AnalyticsExcel(fromDate, toDate, category) {
    try {
    if (typeof ExcelJS === 'undefined') { showToast('ExcelJS not loaded.', 'error'); return; }
    const baseRows = buildReportRows('full', fromDate, toDate, category);
    if (!baseRows.length) { showToast('No data for analytics report.', 'error'); return; }
    const aRows = buildKD2AnalyticsRows(baseRows);
    if (!aRows.length) { showToast('No station data to analyse.', 'error'); return; }

    const stats = buildSummaryStats(baseRows);
    const moduleBadge = getModuleBadge();
    const moduleTitle = getModuleReportTitle();

    const NAV = 'FF1e293b', MUTE = 'FF64748b', WHITE = 'FFffffff', ALT = 'FFf9fafb';
    const BORD = 'FFe2e8f0', BORD_MED = 'FF94a3b8';
    const ST = {
        'Completed':       { bg: 'FFdcfce7', fg: 'FF15803d' },
        'In Progress':     { bg: 'FFfef9c3', fg: 'FF854d0e' },
        'Late Completion': { bg: 'FFdbeafe', fg: 'FF1d4ed8' },
        'Overdue':         { bg: 'FFfee2e2', fg: 'FF991b1b' },
        'Planned':         { bg: 'FFf8fafc', fg: 'FF475569' },
    };
    function bdr(s = 'thin') { return { top:{style:s,color:{argb:BORD}}, bottom:{style:s,color:{argb:BORD}}, left:{style:s,color:{argb:BORD}}, right:{style:s,color:{argb:BORD}} }; }
    function hbdr() { return { top:{style:'medium',color:{argb:BORD_MED}}, bottom:{style:'medium',color:{argb:BORD_MED}}, left:{style:'thin',color:{argb:BORD}}, right:{style:'thin',color:{argb:BORD}} }; }

    const wb = new ExcelJS.Workbook();
    wb.creator = `${moduleBadge} ${moduleTitle}`; wb.created = new Date();

    // ── Sheet 1: Station Analytics ────────────────────────────────
    const ws = wb.addWorksheet('Station Analytics', {
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 4 }],
    });
    const ACOLS = [
        { h: 'Station / Process', w: 38 }, { h: 'Category', w: 20 },
        { h: 'Total', w: 10 },             { h: 'Completed', w: 14 },
        { h: 'In Progress', w: 14 },       { h: 'Overdue', w: 12 },
        { h: 'Late Completion', w: 16 },   { h: '% Done', w: 10 },
        { h: 'Avg Plan (days)', w: 16 },   { h: 'Avg Actual (days)', w: 18 },
        { h: 'Avg Delay (days)', w: 16 },  { h: 'Max Delay (days)', w: 16 },
    ];
    ws.columns = ACOLS.map(c => ({ width: c.w }));

    // Title
    ws.addRow([`${moduleBadge} · Station Analytics`]);
    ws.mergeCells(1, 1, 1, ACOLS.length);
    Object.assign(ws.getCell(1,1), { font:{name:'Calibri',size:15,bold:true,color:{argb:NAV}}, fill:{type:'pattern',pattern:'solid',fgColor:{argb:WHITE}}, alignment:{vertical:'middle'} });
    ws.getRow(1).height = 26;

    // Filters row
    const fBattalion = getVal('filterBattalion'), fVehicle = getVal('filterVehicle');
    const fc = [...(fBattalion?[`Battalion: ${fBattalion}`]:[]), ...(fVehicle?[`Vehicle Type: ${fVehicle}`]:[]), ...(category?[`Category: ${category}`]:[]), ...((fromDate||toDate)?[`Dates: ${fromDate||'…'} → ${toDate||'…'}`]:[])];
    ws.addRow(['Filters: ' + (fc.length ? fc.join('   |   ') : 'All data') + '     Generated: ' + new Date().toLocaleString('en-GB')]);
    ws.mergeCells(2, 1, 2, ACOLS.length);
    Object.assign(ws.getCell(2,1), { font:{name:'Calibri',size:8,italic:true,color:{argb:MUTE}}, fill:{type:'pattern',pattern:'solid',fgColor:{argb:WHITE}} });
    ws.getRow(2).height = 14;
    ws.addRow([]); ws.getRow(3).height = 5;

    // Headers
    ws.addRow(ACOLS.map(c => c.h));
    ws.getRow(4).height = 18;
    ACOLS.forEach((_, ci) => {
        const cell = ws.getCell(4, ci + 1);
        cell.font = { name:'Calibri', size:9, bold:true, color:{argb:WHITE} };
        cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:NAV} };
        cell.alignment = { horizontal:'center', vertical:'middle' };
        cell.border = hbdr();
    });

    // Data rows
    aRows.forEach((ar, ri) => {
        const rowBg = ri % 2 === 1 ? ALT : WHITE;
        ws.addRow([ ar.station, ar.category, ar.total, ar.completed, ar.inProgress, ar.overdue, ar.late,
            `${ar.pct}%`,
            ar.avgPlanned !== null ? `${ar.avgPlanned}d` : '—',
            ar.avgActual  !== null ? `${ar.avgActual}d`  : '—',
            ar.avgDelay > 0 ? `+${ar.avgDelay}d` : '—',
            ar.maxDelay > 0 ? `+${ar.maxDelay}d` : '—',
        ]);
        const row = ws.getRow(ri + 5); row.height = 16;
        ACOLS.forEach((col, ci) => {
            const cell = ws.getCell(ri + 5, ci + 1);
            const val = String(cell.value ?? '');
            let font = { name:'Calibri', size:9, color:{argb:NAV} };
            let fill = { type:'pattern', pattern:'solid', fgColor:{argb:rowBg} };
            let align = { horizontal: ci < 2 ? 'left' : 'center', vertical:'middle', indent: ci < 2 ? 1 : 0 };
            if (ci === 0) { font = { ...font, bold:true }; }
            else if (ci === 1) { font = { ...font, italic:true, color:{argb:MUTE} }; }
            else if (ci === 7) { // % Done
                const pct = parseInt(val);
                const clr = pct >= 80 ? ST['Completed'] : pct >= 40 ? ST['In Progress'] : ST['Overdue'];
                font = { name:'Calibri', size:8, bold:true, color:{argb:clr.fg} };
                fill = { type:'pattern', pattern:'solid', fgColor:{argb:clr.bg} };
            } else if (ci === 5 && parseInt(val) > 0) { // Overdue count
                font = { name:'Calibri', size:8, bold:true, color:{argb:'FF991b1b'} };
                fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFfee2e2'} };
            } else if (ci === 10 || ci === 11) { // Avg/Max Delay
                const late = val.startsWith('+');
                font = { name:'Calibri', size:8, bold:late, color:{argb: late ? 'FF991b1b' : 'FF475569'} };
                fill = { type:'pattern', pattern:'solid', fgColor:{argb: late ? 'FFfee2e2' : rowBg} };
            }
            cell.font = font; cell.fill = fill; cell.alignment = align; cell.border = bdr();
        });
    });

    // ── Sheet 2: Overall Summary ──────────────────────────────────
    const wsSumm = wb.addWorksheet('Summary');
    wsSumm.columns = [{ width:24 }, { width:16 }, { width:14 }];
    wsSumm.addRow([`${moduleBadge} · Station Analytics`]);
    wsSumm.mergeCells(1, 1, 1, 3);
    Object.assign(wsSumm.getCell(1,1), { font:{name:'Calibri',size:14,bold:true,color:{argb:NAV}}, alignment:{vertical:'middle'} });
    wsSumm.getRow(1).height = 26;
    wsSumm.addRow(['Generated: ' + new Date().toLocaleString('en-GB')]);
    wsSumm.mergeCells(2,1,2,3);
    wsSumm.getCell(2,1).font = { name:'Calibri', size:8, italic:true, color:{argb:MUTE} };
    wsSumm.getRow(2).height = 14;
    wsSumm.addRow([]); wsSumm.getRow(3).height = 8;

    const shRow = wsSumm.addRow(['Metric', 'Count', '% of Total']);
    shRow.height = 17;
    [1,2,3].forEach(c => {
        const cell = wsSumm.getCell(shRow.number, c);
        cell.font = { name:'Calibri', size:9, bold:true, color:{argb:WHITE} };
        cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:NAV} };
        cell.alignment = { horizontal:'center', vertical:'middle' };
        cell.border = hbdr();
    });

    [
        { label:'Total Tasks',      val:stats.total,      pct:'100%',                                                          bg:'FFf1f5f9', fg:NAV },
        { label:'Completed',        val:stats.completed,  pct:Math.round(stats.completed/stats.total*100)+'%',                 bg:ST['Completed'].bg,       fg:ST['Completed'].fg },
        { label:'In Progress',      val:stats.inProgress, pct:Math.round(stats.inProgress/stats.total*100)+'%',               bg:ST['In Progress'].bg,     fg:ST['In Progress'].fg },
        { label:'Planned',          val:stats.planned,    pct:Math.round(stats.planned/stats.total*100)+'%',                  bg:ST['Planned'].bg,         fg:ST['Planned'].fg },
        { label:'Overdue',          val:stats.overdue,    pct:Math.round(stats.overdue/stats.total*100)+'%',                  bg:ST['Overdue'].bg,         fg:ST['Overdue'].fg },
        { label:'Late Completion',  val:stats.late,       pct:Math.round(stats.late/stats.total*100)+'%',                     bg:ST['Late Completion'].bg, fg:ST['Late Completion'].fg },
        { label:'Stations Analysed',val:aRows.length,     pct:'',                                                             bg:'FFe0f2fe', fg:'FF0369a1' },
        { label:'Overall Progress', val:stats.pct+'%',    pct:'',                                                             bg:'FFe0f2fe', fg:'FF0369a1' },
    ].forEach(sr => {
        const row = wsSumm.addRow([sr.label, sr.val, sr.pct]); row.height = 18;
        [1,2,3].forEach(c => {
            const cell = wsSumm.getCell(row.number, c);
            cell.font = { name:'Calibri', size:9, bold:c===1, color:{argb:sr.fg} };
            cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:sr.bg} };
            cell.alignment = { horizontal:c===1?'left':'center', vertical:'middle', indent:c===1?1:0 };
            cell.border = bdr();
        });
    });

    showToast('Building Analytics Excel…', 'info');
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${moduleBadge}_Station_Analytics_${new Date().toISOString().slice(0,10)}.xlsx`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast(`Analytics Excel exported — ${aRows.length} stations`, 'success');
    } catch (err) {
        console.error('[exportKD2AnalyticsExcel]', err);
        showToast('Analytics Excel export failed: ' + (err.message || err), 'error');
    }
}

/* ================================================================
   VPX — PDF EXPORT  (light mode, landscape A4)
   ================================================================ */
/* ================================================================
   F100 VPX EXPORTS  (PDF + Excel)
   ================================================================ */

function _f100VpxStatusColor(status) {
    if (status === 'Completed')       return { r: 34,  g: 197, b: 94  };
    if (status === 'In Progress')     return { r: 245, g: 158, b: 11  };
    if (status === 'Late Completion') return { r: 59,  g: 130, b: 246 };
    if (status === 'Overdue')         return { r: 220, g: 38,  b: 38  };
    return                                   { r: 148, g: 163, b: 184 };
}

function exportF100VpxPDF() {
    try {
    if (!currentData?.length) { showToast('No data to export.', 'error'); return; }
    if (!window.jspdf) { showToast('PDF library not loaded — please refresh.', 'error'); return; }

    const cols = buildF100VpxColumns(currentData);
    const rows = buildF100VpxRows(currentData);

    if (!cols.length) { showToast('No process steps found for the current filters.', 'error'); return; }
    if (!rows.length) { showToast('No vehicle units found in the current data.', 'error'); return; }

    const meta = getVpxDisplayMeta();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const PAGE_W = doc.internal.pageSize.getWidth();
    const PAGE_H = doc.internal.pageSize.getHeight();
    const MARGIN = 12;
    const now = new Date().toLocaleString('en-GB');
    const mainTitle = getVpxTitleParts().join(' ');

    // ── White background ─────────────────────────────────────────
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

    // ── Header ───────────────────────────────────────────────────
    doc.setDrawColor(30, 41, 59); doc.setLineWidth(0.6);
    doc.line(MARGIN, 8, PAGE_W - MARGIN, 8);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(30, 41, 59);
    doc.text(mainTitle, MARGIN, 15);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
    doc.text(meta.exportSubtitle, PAGE_W - MARGIN, 12, { align: 'right' });
    doc.text('Generated: ' + now, PAGE_W - MARGIN, 17, { align: 'right' });
    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3);
    doc.line(MARGIN, 20, PAGE_W - MARGIN, 20);

    // ── Legend ───────────────────────────────────────────────────
    const legend = [
        { label: 'Completed', r: 34, g: 197, b: 94 }, { label: 'In Progress', r: 245, g: 158, b: 11 },
        { label: 'Late Completion', r: 59, g: 130, b: 246 }, { label: 'Overdue', r: 220, g: 38, b: 38 },
        { label: 'Planned', r: 148, g: 163, b: 184 },
    ];
    let legX = MARGIN; const legY = 25;
    legend.forEach(l => {
        doc.setFillColor(l.r, l.g, l.b);
        doc.circle(legX + 1.5, legY, 1.5, 'F');
        doc.setTextColor(30, 41, 59); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
        doc.text(l.label, legX + 4.5, legY + 0.8);
        legX += doc.getTextWidth(l.label) + 9;
    });

    // ── Part color palette ────────────────────────────────────────
    const partColors = [
        [30, 58, 138], [107, 33, 168], [153, 27, 27], [15, 118, 110],
        [120, 53, 15], [6, 95, 70],   [51, 65, 85],  [71, 85, 105],
    ];
    const uniqueParts = [...new Set(cols.map(c => c.group))];
    const partColorIdx = {};
    uniqueParts.forEach((p, i) => { partColorIdx[p] = i % partColors.length; });

    // ── Build table ───────────────────────────────────────────────
    const groupHeader = ['Unit'];
    const codeHeader  = ['Battalion / Vehicle'];
    const colsByGroup = {};
    cols.forEach(col => {
        groupHeader.push(col.group);
        codeHeader.push(col.code + '\n' + col.name.substring(0, 18));
        if (!colsByGroup[col.group]) colsByGroup[col.group] = [];
        colsByGroup[col.group].push(col);
    });

    const body = rows.map(row => {
        const unitLbl = row.unit_label || `S/N ${row.serial_number ?? '—'}`;
        const rowKey  = [row.battalion_code, row.vehicle_type].filter(Boolean).join(' · ');
        const cells = [unitLbl + '\n' + rowKey];
        cols.forEach(col => {
            const planKey = `${col.part_id}||${col.process_sort}`;
            const task = row.plans[planKey];
            if (!task) { cells.push('—'); return; }
            const ps = task.planned_start_date?.slice(5) || '?';
            const pe = task.planned_end_date?.slice(5) || '?';
            const as = task.actual_start_date?.slice(5) || '';
            const ae = task.actual_end_date?.slice(5) || '';
            const actLine = (as || ae) ? (as || '?') + ' > ' + (ae || '?') : '';
            cells.push(`${ps} > ${pe}` + (actLine ? `\n${actLine}` : ''));
        });
        return cells;
    });

    const vehicleColW = 28;
    const stationColW = Math.max(10, Math.min(18, (PAGE_W - MARGIN * 2 - vehicleColW) / cols.length));

    doc.autoTable({
        startY: legY + 8,
        margin: { left: MARGIN, right: MARGIN },
        head: [groupHeader, codeHeader],
        body: body,
        columnStyles: {
            0: { cellWidth: vehicleColW, fontStyle: 'bold', halign: 'left' },
            ...Object.fromEntries(cols.map((_, i) => [i + 1, { cellWidth: stationColW, halign: 'center' }])),
        },
        styles: { fontSize: 5.5, cellPadding: 1.5, overflow: 'linebreak', lineColor: [226, 232, 240], lineWidth: 0.2, textColor: [30, 41, 59] },
        headStyles: { fontSize: 5.5, cellPadding: 1.5, halign: 'center', lineColor: [148, 163, 184], lineWidth: 0.3 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        bodyStyles: { fillColor: [255, 255, 255] },
        didParseCell(data) {
            if (data.section === 'head') {
                if (data.row.index === 0 && data.column.index > 0) {
                    const col = cols[data.column.index - 1];
                    if (col) {
                        const [r, g, b] = partColors[partColorIdx[col.group]];
                        data.cell.styles.fillColor = [r, g, b];
                        data.cell.styles.textColor = [255, 255, 255];
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
                if (data.row.index === 1) {
                    data.cell.styles.fillColor = [241, 245, 249];
                    data.cell.styles.textColor = [30, 41, 59];
                    data.cell.styles.fontStyle = 'bold';
                }
            }
            // Hide autoTable's own text for body station cells — we redraw manually in didDrawCell
            if (data.section === 'body' && data.column.index > 0) {
                data.cell.styles.textColor = [255, 255, 255];
            }
        },
        didDrawCell(data) {
            if (data.section !== 'body' || data.column.index === 0) return;
            const col = cols[data.column.index - 1];
            const rowData = rows[data.row.index];
            if (!col || !rowData) return;
            const planKey = `${col.part_id}||${col.process_sort}`;
            const task = rowData.plans[planKey];
            if (!task) return;
            const status = calculateStatus(task);
            const { r, g, b } = _f100VpxStatusColor(status);
            const alpha = 0.12;
            doc.setFillColor(Math.round(255-(255-r)*alpha), Math.round(255-(255-g)*alpha), Math.round(255-(255-b)*alpha));
            doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
            doc.setFillColor(r, g, b);
            doc.circle(data.cell.x + data.cell.width / 2, data.cell.y + 2, 1.2, 'F');
            const txt = data.cell.raw || '';
            doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(30, 41, 59);
            String(txt).split('\n').forEach((line, li) => {
                doc.text(line, data.cell.x + data.cell.width / 2, data.cell.y + 4.5 + li * 3.2, { align: 'center' });
            });
        },
    });

    // ── Footer ───────────────────────────────────────────────────
    const fY = PAGE_H - 5;
    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3);
    doc.line(MARGIN, fY - 3, PAGE_W - MARGIN, fY - 3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(100, 116, 139);
    doc.text(meta.footerApp + ' · ' + mainTitle, MARGIN, fY);
    doc.text('Page 1 of ' + doc.internal.getNumberOfPages(), PAGE_W - MARGIN, fY, { align: 'right' });

    doc.save(meta.filenamePrefix + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
    showToast('PDF exported — ' + rows.length + ' units × ' + cols.length + ' steps', 'success');
    } catch (err) {
        console.error('[exportF100VpxPDF]', err);
        showToast('PDF export failed: ' + (err.message || err), 'error');
    }
}

async function exportF100VpxExcel() {
    try {
    if (!currentData?.length) { showToast('No data to export.', 'error'); return; }
    if (typeof ExcelJS === 'undefined') { showToast('ExcelJS not loaded — please wait and try again.', 'error'); return; }

    const cols = buildF100VpxColumns(currentData);
    const rows = buildF100VpxRows(currentData);
    if (!cols.length || !rows.length) { showToast('No data to export.', 'error'); return; }

    const meta = getVpxDisplayMeta();
    const sheetTitle = getVpxTitleParts().join(' ');

    const ST = {
        'Completed':       { bg: 'FFdcfce7', fg: 'FF15803d' },
        'In Progress':     { bg: 'FFfef9c3', fg: 'FF854d0e' },
        'Late Completion': { bg: 'FFdbeafe', fg: 'FF1d4ed8' },
        'Overdue':         { bg: 'FFfee2e2', fg: 'FF991b1b' },
        'Planned':         { bg: 'FFf8fafc', fg: 'FF475569' },
    };

    const PART_COLORS_HEX = [
        { bg: 'FF1e3a8a', fg: 'FFffffff' }, { bg: 'FF6b21a8', fg: 'FFffffff' },
        { bg: 'FF991b1b', fg: 'FFffffff' }, { bg: 'FF0f766e', fg: 'FFffffff' },
        { bg: 'FF78350f', fg: 'FFffffff' }, { bg: 'FF064e3b', fg: 'FFffffff' },
        { bg: 'FF334155', fg: 'FFffffff' }, { bg: 'FF475569', fg: 'FFffffff' },
    ];
    const uniqueParts = [...new Set(cols.map(c => c.group))];
    const partClrIdx = {};
    uniqueParts.forEach((p, i) => { partClrIdx[p] = i % PART_COLORS_HEX.length; });

    function bord() {
        const s = { style: 'thin', color: { argb: 'FFe2e8f0' } };
        return { top: s, bottom: s, left: s, right: s };
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = meta.workbookCreator;
    wb.created = new Date();

    const ws = wb.addWorksheet('VPX Matrix', {
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        views: [{ state: 'frozen', xSplit: 1, ySplit: 5 }],
    });

    const totalCols = 1 + cols.length;

    // Row 1: title
    ws.addRow([sheetTitle]);
    ws.getRow(1).height = 22;
    Object.assign(ws.getCell('A1'), {
        font: { name: 'Calibri', size: 15, bold: true, color: { argb: 'FF1e293b' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFffffff' } },
        alignment: { vertical: 'middle', horizontal: 'left' },
    });
    ws.mergeCells(1, 1, 1, totalCols);

    // Row 2: subtitle
    ws.addRow([meta.exportSubtitle + '  |  Generated: ' + new Date().toLocaleString('en-GB')]);
    ws.getRow(2).height = 14;
    Object.assign(ws.getCell('A2'), {
        font: { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF64748b' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFffffff' } },
        alignment: { vertical: 'middle', horizontal: 'left' },
    });
    ws.mergeCells(2, 1, 2, totalCols);

    // Row 3: blank
    ws.addRow([]); ws.getRow(3).height = 5;

    // Row 4: part group headers (merged per group)
    ws.addRow([]); ws.getRow(4).height = 18;
    // Unit header cell
    const u4 = ws.getCell(4, 1);
    Object.assign(u4, {
        value: meta.headerLabel,
        font: { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFffffff' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e293b' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: bord(),
    });
    // Group merge tracking
    let grpStart4 = 2, grpLabel4 = cols[0]?.group;
    const applyGrp4 = (start, end, label) => {
        if (start < end) ws.mergeCells(4, start, 4, end);
        const clr = PART_COLORS_HEX[partClrIdx[label]] || PART_COLORS_HEX[0];
        const gc = ws.getCell(4, start);
        gc.value = label;
        gc.font = { name: 'Calibri', size: 9, bold: true, color: { argb: clr.fg } };
        gc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: clr.bg } };
        gc.alignment = { horizontal: 'center', vertical: 'middle' };
        gc.border = bord();
    };
    cols.forEach((col, i) => {
        const colN = i + 2;
        if (col.group !== grpLabel4) {
            applyGrp4(grpStart4, colN - 1, grpLabel4);
            grpStart4 = colN; grpLabel4 = col.group;
        }
        if (i === cols.length - 1) applyGrp4(grpStart4, colN, grpLabel4);
    });

    // Row 5: step code + name headers
    ws.addRow([]); ws.getRow(5).height = 30;
    const hdr5 = ws.getCell(5, 1);
    Object.assign(hdr5, {
        value: 'Battalion · Vehicle · Unit',
        font: { name: 'Calibri', size: 8, bold: true, color: { argb: 'FF1e293b' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf1f5f9' } },
        alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
        border: bord(),
    });
    cols.forEach((col, i) => {
        const colN = i + 2;
        const cell = ws.getCell(5, colN);
        cell.value = col.code + '\n' + col.name;
        cell.font = { name: 'Calibri', size: 7.5, bold: true, color: { argb: 'FF1e293b' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf1f5f9' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = bord();
    });

    // Column widths
    ws.getColumn(1).width = 26;
    cols.forEach((_, i) => { ws.getColumn(i + 2).width = 14; });

    // Data rows
    rows.forEach((row, ri) => {
        const excelRow = ws.addRow([]);
        excelRow.height = 28;
        const unitLbl = row.unit_label || `S/N ${row.serial_number ?? '—'}`;
        const unitSub = [row.battalion_code, row.vehicle_type].filter(Boolean).join(' · ');
        const unitCell = ws.getCell(ri + 6, 1);
        unitCell.value = unitLbl + '\n' + unitSub;
        unitCell.font = { name: 'Calibri', size: 8.5, bold: true, color: { argb: 'FF1e293b' } };
        unitCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri % 2 === 0 ? 'FFffffff' : 'FFf8fafc' } };
        unitCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
        unitCell.border = bord();

        cols.forEach((col, ci) => {
            const planKey = `${col.part_id}||${col.process_sort}`;
            const task = row.plans[planKey];
            const cell = ws.getCell(ri + 6, ci + 2);
            if (!task) {
                cell.value = '—';
                cell.font = { name: 'Calibri', size: 8, color: { argb: 'FFcbd5e1' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = bord();
                return;
            }
            const status = calculateStatus(task);
            const st = ST[status] || ST['Planned'];
            const ps = task.planned_start_date?.slice(5) || '?';
            const pe = task.planned_end_date?.slice(5) || '?';
            const as2 = task.actual_start_date?.slice(5) || '';
            const ae2 = task.actual_end_date?.slice(5) || '';
            const actLine2 = (as2 || ae2) ? (as2 || '?') + ' > ' + (ae2 || '?') : '';
            cell.value = `${ps} > ${pe}` + (actLine2 ? '\n' + actLine2 : '');
            cell.font = { name: 'Calibri', size: 7.5, bold: status !== 'Planned', color: { argb: st.fg } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.bg } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = bord();
        });
    });

    // Save
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = meta.filenamePrefix + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast('Excel exported — ' + rows.length + ' units × ' + cols.length + ' steps', 'success');
    } catch (err) {
        console.error('[exportF100VpxExcel]', err);
        showToast('Excel export failed: ' + (err.message || err), 'error');
    }
}

async function exportVpxPDF(preview) {
    if (!await canExport()) { showToast('You do not have permission to export reports.', 'error'); return; }
    if (isF100KD2Module()) { exportF100VpxPDF(); return; }
    if (!currentData?.length) {
        showToast('No data to export.', 'error');
        return;
    }
    const meta = getVpxDisplayMeta();

    // Apply same category filter as the table/VPX view, then the currently
    // selected VPX vehicle-type + Hull/Turret/Assembly tab (never export
    // more than what's on screen).
    const _vpxCategory = getVal('filterCategory');
    let vpxData = _vpxCategory
        ? currentData.filter(r => getModuleCategory(r.process_station, r) === _vpxCategory)
        : currentData;
    vpxData = _getVpxFilteredData(vpxData);

    if (!vpxData.length) {
        showToast('No data matches the current filters.', 'error');
        return;
    }

    const _mainTitle = getVpxTitleParts().join(' ');

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const PAGE_W = doc.internal.pageSize.getWidth();   // 297
    const PAGE_H = doc.internal.pageSize.getHeight();  // 210
    const MARGIN = 12;
    const now = new Date().toLocaleString('en-GB');

    // ── White background ────────────────────────────────────────────
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

    // ── Clean print-friendly header — black text on white ───────────
    // Top rule
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, 8, PAGE_W - MARGIN, 8);

    // Main title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(30, 41, 59);
    doc.text(_mainTitle, MARGIN, 15);

    // Sub-label (right-aligned)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(meta.exportSubtitle, PAGE_W - MARGIN, 12, { align: 'right' });
    doc.text('Generated: ' + now, PAGE_W - MARGIN, 17, { align: 'right' });

    // Bottom rule under header
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, 20, PAGE_W - MARGIN, 20);

    // ── Legend ──────────────────────────────────────────────────────
    const legY = 26;
    const legend = [
        { label: 'Completed', r: 34, g: 197, b: 94 },
        { label: 'In Progress', r: 245, g: 158, b: 11 },
        { label: 'Late Completion', r: 59, g: 130, b: 246 },
        { label: 'Overdue', r: 220, g: 38, b: 38 },
        { label: 'Planned', r: 148, g: 163, b: 184 },
    ];
    let legX = MARGIN;
    legend.forEach(l => {
        doc.setFillColor(l.r, l.g, l.b);
        doc.circle(legX + 1.5, legY, 1.5, 'F');
        doc.setTextColor(30, 41, 59);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.text(l.label, legX + 4.5, legY + 0.8);
        legX += doc.getTextWidth(l.label) + 9;
    });

    // ── Build table data ─────────────────────────────────────────────
    // Determine active columns (same logic as renderVPX)
    const rows = buildVpxRows(vpxData);
    const activeCols = buildVpxColumns(vpxData).filter(col =>
        rows.some(row => { const k = col.resolve(row.vehicle); return k !== null && row.stations[k]; })
    );
    if (!activeCols.length) {
        showToast(meta.noColumnsMessage, 'error');
        return;
    }

    // Status colour helper
    function statusDotRGB(status) {
        if (status === 'Completed') return [34, 197, 94];   // green
        if (status === 'In Progress') return [245, 158, 11];   // amber
        if (status === 'Late Completion') return [59, 130, 246];   // blue
        if (status === 'Overdue') return [220, 38, 38];   // red
        return [148, 163, 184];                                      // grey — Planned
    }

    // Column header
    const head = [[meta.headerLabel, ...activeCols.map(c => c.code)]];

    // Rows
    const body = rows.map(row => {
        return [
            getVpxExportLabel(row),
            ...activeCols.map(col => {
                const k = col.resolve(row.vehicle);
                if (k === null) return 'N/A';
                const task = row.stations[k];
                if (!task) return '—';
                const actual = task.progress?.completion_date || null;
                const actStart2 = task.progress?.actual_start_date || null;
                const planned = task.end_date;
                const planStr = (task.start_date ? task.start_date.slice(5) : '?') + ' > ' + (planned ? planned.slice(5) : '?');
                const actStr = actStart2
                    ? actStart2.slice(5) + ' > ' + (actual ? actual.slice(5) : '?')
                    : (actual ? '? > ' + actual.slice(5) : '');
                return planStr + (actStr ? '\n' + actStr : '');
            }),
        ];
    });

    // ── AutoTable ────────────────────────────────────────────────────
    const tableStartY = legY + 7;
    const colCount = 1 + activeCols.length;
    const vehicleColW = 22;
    const stationColW = Math.min(14, (PAGE_W - MARGIN * 2 - vehicleColW) / activeCols.length);

    doc.autoTable({
        startY: tableStartY,
        margin: { left: MARGIN, right: MARGIN },
        head: head,
        body: body,
        columnStyles: {
            0: { cellWidth: vehicleColW, fontStyle: 'bold' },
            ...Object.fromEntries(activeCols.map((_, i) => [i + 1, { cellWidth: stationColW, halign: 'center', fontSize: 5.5 }])),
        },
        headStyles: {
            fillColor: [241, 245, 249],
            textColor: [30, 41, 59],
            fontStyle: 'bold',
            fontSize: 6,
            cellPadding: 1.5,
            halign: 'center',
            lineColor: [148, 163, 184],
            lineWidth: 0.3,
        },
        styles: {
            fontSize: 6,
            cellPadding: 1.5,
            overflow: 'linebreak',
            lineColor: [226, 232, 240],
            lineWidth: 0.2,
            textColor: [30, 41, 59],
        },
        alternateRowStyles: {
            fillColor: [248, 250, 252],
        },
        bodyStyles: {
            fillColor: [255, 255, 255],
        },
        // Colour each cell by status
        didDrawCell(data) {
            if (data.section !== 'body' || data.column.index === 0) return;
            const colIdx = data.column.index - 1;
            const col = activeCols[colIdx];
            const rowIdx = data.row.index;
            const rowData = rows[rowIdx];
            if (!col || !rowData) return;

            const k = col.resolve(rowData.vehicle);
            if (!k) return;
            const task = rowData.stations[k];
            if (!task) return;

            const status = calculateStatus(task);
            const [r, g, b] = statusDotRGB(status);

            // Tint background
            const alpha = 0.12;
            doc.setFillColor(
                Math.round(255 - (255 - r) * alpha),
                Math.round(255 - (255 - g) * alpha),
                Math.round(255 - (255 - b) * alpha)
            );
            doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');

            // Dot
            doc.setFillColor(r, g, b);
            doc.circle(data.cell.x + data.cell.width / 2, data.cell.y + 2, 1.2, 'F');

            // Re-draw text on top (autoTable text already drawn, need to redraw)
            const txt = data.cell.raw || '';
            const lines = String(txt).split('\n');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(5.5);
            doc.setTextColor(30, 41, 59);
            lines.forEach((line, li) => {
                doc.text(line, data.cell.x + data.cell.width / 2, data.cell.y + 4.5 + li * 3.2, { align: 'center' });
            });
        },
        // Column group header colours + suppress autoTable text in body station cells
        didParseCell(data) {
            if (data.section === 'head' && data.row.index === 0 && data.column.index > 0) {
                const col = activeCols[data.column.index - 1];
                if (col) {
                    const grpColors = {
                        'Welding': [153, 27, 27],
                        'Machining': [15, 118, 110],
                        'Shot Blasting and Painting': [107, 33, 168],
                        'Assembly': [71, 85, 105],
                        'Processing': [120, 53, 15],
                        'Final Inspection': [6, 95, 70],
                        'Final Test': [51, 65, 85],
                    };
                    const [r, g, b] = grpColors[col.group] || [30, 58, 138];
                    data.cell.styles.fillColor = [r, g, b];
                    data.cell.styles.textColor = [255, 255, 255];
                }
            }
            // Hide autoTable's own text for station cells — we redraw manually in didDrawCell
            if (data.section === 'body' && data.column.index > 0) {
                data.cell.styles.textColor = [255, 255, 255]; // invisible on white bg
            }
        },
    });

    // ── Footer ───────────────────────────────────────────────────────
    const fY = PAGE_H - 5;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, fY - 3, PAGE_W - MARGIN, fY - 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(100, 116, 139);
    doc.text(meta.footerApp + ' · ' + _mainTitle, MARGIN, fY);
    doc.text(`Page 1 of ${doc.internal.getNumberOfPages()}`, PAGE_W - MARGIN, fY, { align: 'right' });

    const ds = new Date().toISOString().slice(0, 10);
    const doDownload = () => { doc.save(meta.filenamePrefix + '_' + ds + '.pdf'); showToast('PDF exported successfully.', 'success'); };
    if (preview) {
        _showGenericPreview({ title: _mainTitle, kind: 'pdf', src: doc.output('bloburl'), onDownload: doDownload });
    } else {
        doDownload();
    }
}


/* ──────────────────────────────────────────────────────────────────
   VPX EXCEL EXPORT  (ExcelJS — full cell styling)
   ────────────────────────────────────────────────────────────────── */
async function exportVpxExcel(preview) {
    if (!await canExport()) { showToast('You do not have permission to export reports.', 'error'); return; }
    if (isF100KD2Module()) { await exportF100VpxExcel(preview); return; }
    if (!currentData?.length) { showToast('No data to export.', 'error'); return; }
    if (typeof ExcelJS === 'undefined') {
        showToast('ExcelJS not loaded yet — please wait a moment and try again.', 'error'); return;
    }
    const meta = getVpxDisplayMeta();

    const _fCategory = getVal('filterCategory');

    let vpxData = _fCategory
        ? currentData.filter(r => getModuleCategory(r.process_station, r) === _fCategory)
        : currentData;
    vpxData = _getVpxFilteredData(vpxData);
    if (!vpxData.length) { showToast('No data matches the current filters.', 'error'); return; }

    const rows = buildVpxRows(vpxData);
    const activeCols = buildVpxColumns(vpxData).filter(col =>
        rows.some(row => { const k = col.resolve(row.vehicle); return k !== null && row.stations[k]; })
    );
    if (!activeCols.length) { showToast(meta.noColumnsMessage, 'error'); return; }

    const sheetTitle = getVpxTitleParts().join(' ');

    // ── Colour helpers ───────────────────────────────────────────────
    // ExcelJS argb = 'FF' + hex (no #)
    const STATUS_STYLE = {
        'Completed': { bg: 'FFdcfce7', fg: 'FF15803d', dot: 'FF22c55e' },
        'In Progress': { bg: 'FFfef9c3', fg: 'FF854d0e', dot: 'FFf59e0b' },
        'Late Completion': { bg: 'FFdbeafe', fg: 'FF1d4ed8', dot: 'FF3b82f6' },
        'Overdue': { bg: 'FFfee2e2', fg: 'FF991b1b', dot: 'FFdc2626' },
        'Planned': { bg: 'FFf8fafc', fg: 'FF475569', dot: 'FF94a3b8' },
        'N/A': { bg: 'FFf1f5f9', fg: 'FFcbd5e1', dot: null },
    };
    const GRP_COLOR = {
        'Welding': { bg: 'FF991b1b', fg: 'FFffffff' },
        'Machining': { bg: 'FF0f766e', fg: 'FFffffff' },
        'Shot Blasting and Painting': { bg: 'FF6b21a8', fg: 'FFffffff' },
        'Assembly': { bg: 'FF1e3a8a', fg: 'FFffffff' },
        'Processing': { bg: 'FF78350f', fg: 'FFffffff' },
        'Final Inspection': { bg: 'FF064e3b', fg: 'FFffffff' },
        'Final Test': { bg: 'FF334155', fg: 'FFffffff' },
    };

    function cellStyle(argbBg, argbFg, bold = false, sz = 9, wrap = false, hAlign = 'center', vAlign = 'middle') {
        return {
            font: { name: 'Calibri', size: sz, bold, color: { argb: argbFg } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: argbBg } },
            alignment: { horizontal: hAlign, vertical: vAlign, wrapText: wrap },
            border: {
                top: { style: 'thin', color: { argb: 'FFe2e8f0' } },
                bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } },
                left: { style: 'thin', color: { argb: 'FFe2e8f0' } },
                right: { style: 'thin', color: { argb: 'FFe2e8f0' } },
            },
        };
    }

    // ════════════════════════════════════════════════════════════════
    //  SHEET 1 — VPX Matrix
    // ════════════════════════════════════════════════════════════════
    const wb = new ExcelJS.Workbook();
    wb.creator = meta.workbookCreator;
    wb.created = new Date();

    const ws = wb.addWorksheet('VPX Matrix', {
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        views: [{ state: 'frozen', xSplit: 1, ySplit: 5 }],
    });

    const totalCols = 1 + activeCols.length;

    // ── Row 1: Main title ──────────────────────────────────────────
    ws.addRow([sheetTitle]);
    const titleRow = ws.getRow(1);
    titleRow.height = 24;
    const titleCell = ws.getCell('A1');
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1e293b' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFffffff' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.mergeCells(1, 1, 1, totalCols);

    // ── Row 2: Sub-info ────────────────────────────────────────────
    ws.addRow([meta.exportSubtitle + '  |  Generated: ' + new Date().toLocaleString('en-GB')]);
    const subRow = ws.getRow(2);
    subRow.height = 15;
    const subCell = ws.getCell('A2');
    subCell.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF64748b' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFffffff' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.mergeCells(2, 1, 2, totalCols);

    // ── Row 3: blank spacer ────────────────────────────────────────
    ws.addRow([]);
    ws.getRow(3).height = 6;

    // ── Row 4: Group header ────────────────────────────────────────
    const grpRowData = [''];
    activeCols.forEach(col => grpRowData.push(col.group));
    ws.addRow(grpRowData);
    const grpRow = ws.getRow(4);
    grpRow.height = 18;

    // Style group header cells + merge consecutive same-group cells
    let grpStart = 2, grpCurrent = activeCols[0]?.group;
    const applyGrpMerge = (start, end, label) => {
        if (start < end) ws.mergeCells(4, start, 4, end);
        const gc = ws.getCell(4, start);
        const gClr = GRP_COLOR[label] || { bg: 'FF334155', fg: 'FFffffff' };
        gc.value = label;
        gc.font = { name: 'Calibri', size: 9, bold: true, color: { argb: gClr.fg } };
        gc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gClr.bg } };
        gc.alignment = { horizontal: 'center', vertical: 'middle' };
    };
    activeCols.forEach((col, i) => {
        const colN = i + 2;
        if (col.group !== grpCurrent) {
            applyGrpMerge(grpStart, colN - 1, grpCurrent);
            grpStart = colN;
            grpCurrent = col.group;
        }
        if (i === activeCols.length - 1) applyGrpMerge(grpStart, colN, grpCurrent);
    });
    // Style the unit column header cell in row 4
    const unitHdr4 = ws.getCell(4, 1);
    unitHdr4.value = meta.headerLabel;
    unitHdr4.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFffffff' } };
    unitHdr4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e293b' } };
    unitHdr4.alignment = { horizontal: 'center', vertical: 'middle' };

    // ── Row 5: Station code header ─────────────────────────────────
    const codeRowData = [''];
    activeCols.forEach(col => codeRowData.push(col.code));
    ws.addRow(codeRowData);
    const codeRow = ws.getRow(5);
    codeRow.height = 16;
    for (let c = 1; c <= totalCols; c++) {
        const cell = ws.getCell(5, c);
        const isUnit = c === 1;
        cell.font = { name: 'Calibri', size: 8, bold: true, color: { argb: isUnit ? 'FFffffff' : 'FF1e293b' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isUnit ? 'FF1e293b' : 'FFf1f5f9' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
            top: { style: 'medium', color: { argb: 'FF94a3b8' } },
            bottom: { style: 'medium', color: { argb: 'FF94a3b8' } },
            left: { style: 'thin', color: { argb: 'FFe2e8f0' } },
            right: { style: 'thin', color: { argb: 'FFe2e8f0' } },
        };
        if (c === 1) cell.value = '';
        else {
            const col = activeCols[c - 2];
            cell.value = col ? col.code : '';
        }
    }

    // ── Data rows ──────────────────────────────────────────────────
    let prevVehicle = null;
    let excelRowIdx = 6;

    rows.forEach((row, ri) => {
        // Vehicle group separator row
        if (!isKD2Module() && row.vehicle !== prevVehicle) {
            ws.addRow([row.vehicle]);
            const vRow = ws.getRow(excelRowIdx);
            vRow.height = 14;
            ws.mergeCells(excelRowIdx, 1, excelRowIdx, totalCols);
            const vc = ws.getCell(excelRowIdx, 1);
            vc.value = row.vehicle;
            vc.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFffffff' } };
            vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
            vc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
            prevVehicle = row.vehicle;
            excelRowIdx++;
        }

        // Unit data row
        const dataRowArr = [getVpxExportLabel(row)];
        activeCols.forEach(col => {
            const k = col.resolve(row.vehicle);
            if (k === null) { dataRowArr.push('N/A'); return; }
            const task = row.stations[k];
            if (!task) { dataRowArr.push(''); return; }
            const status = calculateStatus(task);
            const actStart = task.progress?.actual_start_date;
            const actEnd = task.progress?.completion_date;
            const planStr = (task.start_date || '?').slice(5) + ' > ' + (task.end_date || '?').slice(5);
            const actStr = actStart
                ? actStart.slice(5) + ' > ' + (actEnd ? actEnd.slice(5) : '?')
                : (actEnd ? '? > ' + actEnd.slice(5) : '');
            // Value: Status on line 1, planned on line 2, actual on line 3
            dataRowArr.push(status + '\n' + planStr + (actStr ? '\n' + actStr : ''));
        });

        ws.addRow(dataRowArr);
        const dRow = ws.getRow(excelRowIdx);
        dRow.height = 34;

        // Unit label cell
        const unitCell = ws.getCell(excelRowIdx, 1);
        unitCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF1e293b' } };
        unitCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } };
        unitCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true };
        unitCell.border = {
            top: { style: 'thin', color: { argb: 'FFe2e8f0' } },
            bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } },
            right: { style: 'medium', color: { argb: 'FF94a3b8' } },
        };

        // Station cells
        activeCols.forEach((col, ci) => {
            const c = ci + 2;
            const cell = ws.getCell(excelRowIdx, c);
            const k = col.resolve(row.vehicle);
            if (k === null) {
                cell.value = 'N/A';
                cell.font = { name: 'Calibri', size: 7, color: { argb: 'FFcbd5e1' }, italic: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = { top: { style: 'thin', color: { argb: 'FFe2e8f0' } }, bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } }, left: { style: 'thin', color: { argb: 'FFe2e8f0' } }, right: { style: 'thin', color: { argb: 'FFe2e8f0' } } };
                return;
            }
            const task = row.stations[k];
            if (!task) {
                cell.value = '';
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFffffff' } };
                cell.border = { top: { style: 'thin', color: { argb: 'FFe2e8f0' } }, bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } }, left: { style: 'thin', color: { argb: 'FFe2e8f0' } }, right: { style: 'thin', color: { argb: 'FFe2e8f0' } } };
                return;
            }
            const status = calculateStatus(task);
            const st = STATUS_STYLE[status] || STATUS_STYLE['Planned'];
            const actStart = task.progress?.actual_start_date;
            const actEnd = task.progress?.completion_date;
            const planStr = (task.start_date || '?').slice(5) + ' > ' + (task.end_date || '?').slice(5);
            const actStr = actStart
                ? actStart.slice(5) + ' > ' + (actEnd ? actEnd.slice(5) : '?')
                : (actEnd ? '? > ' + actEnd.slice(5) : '');

            cell.value = {
                richText: [
                    { text: status + '\n', font: { bold: true, size: 8, color: { argb: st.fg }, name: 'Calibri' } },
                    { text: 'P: ' + planStr, font: { size: 7, color: { argb: 'FF475569' }, name: 'Calibri' } },
                    ...(actStr ? [{ text: '\nA: ' + actStr, font: { size: 7, bold: true, color: { argb: st.fg }, name: 'Calibri' } }] : []),
                ]
            };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.bg } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFe2e8f0' } },
                bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } },
                left: { style: 'thin', color: { argb: 'FFe2e8f0' } },
                right: { style: 'thin', color: { argb: 'FFe2e8f0' } },
            };
        });

        excelRowIdx++;
    });

    // ── Column widths ──────────────────────────────────────────────
    ws.getColumn(1).width = 24;
    activeCols.forEach((_, i) => { ws.getColumn(i + 2).width = 15; });

    // ════════════════════════════════════════════════════════════════
    //  SHEET 2 — Key / Legend
    // ════════════════════════════════════════════════════════════════
    const wsKey = wb.addWorksheet('Key & Legend');
    wsKey.views = [{}];
    wsKey.getColumn(1).width = 5;
    wsKey.getColumn(2).width = 22;
    wsKey.getColumn(3).width = 50;
    wsKey.getColumn(4).width = 22;
    wsKey.getColumn(5).width = 22;

    // Title
    wsKey.addRow(['', meta.keyTitle]);
    wsKey.mergeCells(1, 2, 1, 5);
    const keyTitle = wsKey.getCell(1, 2);
    keyTitle.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF1e293b' } };
    keyTitle.alignment = { vertical: 'middle' };
    wsKey.getRow(1).height = 24;

    wsKey.addRow([]);
    wsKey.getRow(2).height = 8;

    // Status section header
    wsKey.addRow(['', 'STATUS COLOURS']);
    wsKey.mergeCells(3, 2, 3, 5);
    const secHdr = wsKey.getCell(3, 2);
    secHdr.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF64748b' } };
    secHdr.border = { bottom: { style: 'medium', color: { argb: 'FFcbd5e1' } } };
    wsKey.getRow(3).height = 16;

    // Column headers for legend table
    wsKey.addRow(['', 'Status', 'What it means', 'Planned Dates', 'Actual Dates']);
    const legHdrRow = wsKey.getRow(4);
    legHdrRow.height = 16;
    [2, 3, 4, 5].forEach(c => {
        const cell = wsKey.getCell(4, c);
        cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFffffff' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e293b' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { bottom: { style: 'medium', color: { argb: 'FF334155' } } };
    });

    const legendRows = [
        { status: 'Completed', meaning: 'Task finished on or before the planned end date.', plan: 'Start > End', actual: 'ActStart > ActEnd' },
        { status: 'In Progress', meaning: 'Actual start recorded but task is not yet complete.', plan: 'Start > End', actual: 'ActStart > ?' },
        { status: 'Late Completion', meaning: 'Task completed after the planned end date.', plan: 'Start > End', actual: 'ActStart > ActEnd (late)' },
        { status: 'Overdue', meaning: 'Not complete and today is past the planned end date.', plan: 'Start > End', actual: '(none)' },
        { status: 'Planned', meaning: 'Not yet started — no actual dates recorded.', plan: 'Start > End', actual: '(none)' },
        { status: 'N/A', meaning: 'This station does not apply to this vehicle type.', plan: '—', actual: '—' },
    ];

    legendRows.forEach((lr, i) => {
        wsKey.addRow(['', lr.status, lr.meaning, lr.plan, lr.actual]);
        const r = i + 5;
        const st = STATUS_STYLE[lr.status] || { bg: 'FFf1f5f9', fg: 'FF475569' };
        wsKey.getRow(r).height = 20;
        [2, 3, 4, 5].forEach(c => {
            const cell = wsKey.getCell(r, c);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.bg } };
            cell.font = { name: 'Calibri', size: 9, bold: c === 2, color: { argb: st.fg } };
            cell.alignment = { vertical: 'middle', wrapText: true, horizontal: c === 2 ? 'center' : 'left', indent: c > 2 ? 1 : 0 };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFe2e8f0' } },
                bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } },
                left: { style: 'thin', color: { argb: 'FFe2e8f0' } },
                right: { style: 'thin', color: { argb: 'FFe2e8f0' } },
            };
        });
    });

    // Spacer
    wsKey.addRow([]); wsKey.getRow(11).height = 12;

    // Reading guide section
    wsKey.addRow(['', 'HOW TO READ A CELL']);
    wsKey.mergeCells(12, 2, 12, 5);
    const secHdr2 = wsKey.getCell(12, 2);
    secHdr2.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF64748b' } };
    secHdr2.border = { bottom: { style: 'medium', color: { argb: 'FFcbd5e1' } } };
    wsKey.getRow(12).height = 16;

    const guideRows = [
        ['', 'Line 1', 'Status label (e.g. Completed, Overdue…)', '', ''],
        ['', 'Line 2', 'P: MM-DD > MM-DD   Planned start to planned end', '', ''],
        ['', 'Line 3', 'A: MM-DD > MM-DD   Actual start to actual end (if recorded)', '', ''],
        ['', 'Empty cell', 'Station not yet planned for this unit', '', ''],
        ['', 'N/A', 'Station does not apply to this vehicle type', '', ''],
    ];
    guideRows.forEach((gr, i) => {
        wsKey.addRow(gr);
        const r = i + 13;
        wsKey.getRow(r).height = 16;
        const lbl = wsKey.getCell(r, 2);
        const desc = wsKey.getCell(r, 3);
        lbl.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF334155' } };
        lbl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf1f5f9' } };
        lbl.alignment = { vertical: 'middle', horizontal: 'center' };
        desc.font = { name: 'Calibri', size: 9, color: { argb: 'FF475569' } };
        desc.alignment = { vertical: 'middle', indent: 1 };
        wsKey.mergeCells(r, 3, r, 5);
        [2, 3].forEach(c => {
            wsKey.getCell(r, c).border = {
                top: { style: 'thin', color: { argb: 'FFe2e8f0' } },
                bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } },
                left: { style: 'thin', color: { argb: 'FFe2e8f0' } },
                right: { style: 'thin', color: { argb: 'FFe2e8f0' } },
            };
        });
    });

    // ── Save ───────────────────────────────────────────────────────
    const doDownload = async () => {
        showToast('Building Excel…', 'info');
        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = meta.filenamePrefix + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Excel exported successfully.', 'success');
    };
    if (preview) {
        _showGenericPreview({ title: getVpxTitleParts().join(' '), kind: 'sheets', sheets: _workbookToSheets(wb), onDownload: doDownload });
    } else {
        await doDownload();
    }
}


/* ──────────────────────────────────────────────────────────────────
   VPX STATION REPORT — sequenced Plan/Actual grid with delay projection
   Matches the reference "Daily Production Progress Report" layout: one
   Plan row + one Actual row per vehicle, stations in route order, with
   a Delay column carried forward through not-yet-finished stations.
   Always scoped to the current vehicle-type + category tab (via
   _getVpxFilteredData), same as the plain PDF/Excel export buttons.
   ────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────
   GENERIC "VIEW BEFORE EXPORTING" PREVIEW — shared by every report
   modal (VPX, plan table, Issues) across PDF/Excel/Word.
   ────────────────────────────────────────────────────────────────── */

/** Renders an ExcelJS worksheet as an HTML table (values + basic
 *  styling + merges) so it can be shown in-app before download. */
function _worksheetToHtml(ws) {
    const spans = {};
    const skip = new Set();
    (ws.model?.merges || []).forEach(range => {
        const [a, b] = range.split(':');
        const parse = addr => {
            const m = addr.match(/^([A-Z]+)(\d+)$/);
            const col = m[1].split('').reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
            return { row: +m[2], col };
        };
        const start = parse(a), end = parse(b || a);
        spans[`${start.row},${start.col}`] = { rowspan: end.row - start.row + 1, colspan: end.col - start.col + 1 };
        for (let r = start.row; r <= end.row; r++) {
            for (let c = start.col; c <= end.col; c++) {
                if (r === start.row && c === start.col) continue;
                skip.add(`${r},${c}`);
            }
        }
    });

    const colCount = ws.columnCount || 1;
    let html = '<table>';
    for (let r = 1; r <= ws.rowCount; r++) {
        html += '<tr>';
        for (let c = 1; c <= colCount; c++) {
            if (skip.has(`${r},${c}`)) continue;
            const cell = ws.getCell(r, c);
            const span = spans[`${r},${c}`];
            const font = cell.font || {};
            const bg = cell.fill?.fgColor?.argb ? '#' + cell.fill.fgColor.argb.slice(2) : 'transparent';
            const color = font.color?.argb ? '#' + font.color.argb.slice(2) : 'inherit';
            const align = cell.alignment?.horizontal || 'left';
            const style = `background:${bg};color:${color};font-weight:${font.bold ? 'bold' : 'normal'};`
                + `font-style:${font.italic ? 'italic' : 'normal'};font-size:${(font.size || 10)}px;`
                + `text-align:${align};padding:3px 6px;white-space:pre-wrap`;
            const val = cell.value == null ? '' : String(cell.value);
            html += `<td${span ? ` rowspan="${span.rowspan}" colspan="${span.colspan}"` : ''} style="${style}">${esc(val)}</td>`;
        }
        html += '</tr>';
    }
    html += '</table>';
    return html;
}

/** Every worksheet in a workbook, rendered to HTML — one entry per sheet
 *  so the preview modal can show tabs for multi-sheet exports. */
function _workbookToSheets(wb) {
    return wb.worksheets.map(sheet => ({ name: sheet.name, html: _worksheetToHtml(sheet) }));
}

/** Opens the shared preview modal. kind: 'pdf' (iframe src), 'html'
 *  (single innerHTML), or 'sheets' (tabbed multi-sheet Excel preview).
 *  onDownload runs the real export when the user confirms. */
function _showGenericPreview({ title, kind, src, html, sheets, onDownload }) {
    const overlay = document.getElementById('genericPreviewModalOverlay');
    if (!overlay) { onDownload?.(); return; }

    const titleEl = document.getElementById('genericPreviewModalTitle');
    if (titleEl) titleEl.textContent = title || 'Preview';
    const frame = document.getElementById('genericPreviewFrame');
    const htmlDiv = document.getElementById('genericPreviewHtml');
    const tabBar = document.getElementById('genericPreviewTabs');

    const renderSheet = html => { htmlDiv.innerHTML = html || ''; };

    if (kind === 'pdf') {
        frame.hidden = false; htmlDiv.hidden = true; tabBar.hidden = true;
        frame.src = src;
    } else if (kind === 'sheets' && sheets?.length) {
        frame.hidden = true; htmlDiv.hidden = false;
        if (sheets.length > 1) {
            tabBar.hidden = false;
            tabBar.innerHTML = sheets.map((s, i) =>
                `<button type="button" class="report-preview-tab${i === 0 ? ' active' : ''}" data-idx="${i}">${esc(s.name)}</button>`
            ).join('');
            tabBar.querySelectorAll('.report-preview-tab').forEach(btn => {
                btn.addEventListener('click', () => {
                    tabBar.querySelectorAll('.report-preview-tab').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    renderSheet(sheets[+btn.dataset.idx].html);
                });
            });
        } else {
            tabBar.hidden = true;
        }
        renderSheet(sheets[0].html);
    } else {
        frame.hidden = true; htmlDiv.hidden = false; tabBar.hidden = true;
        renderSheet(html);
    }
    overlay.style.display = 'flex';

    const close = () => { overlay.style.display = 'none'; frame.src = ''; };

    // Clone-and-replace to avoid stacking listeners across repeated previews.
    const downloadBtn = document.getElementById('genericPreviewDownload');
    const cancelBtn = document.getElementById('genericPreviewCancel');
    const closeBtn = document.getElementById('genericPreviewModalClose');
    const newDownloadBtn = downloadBtn.cloneNode(true); downloadBtn.replaceWith(newDownloadBtn);
    const newCancelBtn = cancelBtn.cloneNode(true); cancelBtn.replaceWith(newCancelBtn);
    const newCloseBtn = closeBtn.cloneNode(true); closeBtn.replaceWith(newCloseBtn);
    newDownloadBtn.addEventListener('click', async () => { await onDownload?.(); close(); });
    newCancelBtn.addEventListener('click', close);
    newCloseBtn.addEventListener('click', close);
}

/** Walks one vehicle's stations in route order, carrying its most recent
 *  known delay forward onto every not-yet-finished station's projected
 *  date. Returns per-station cells plus the row's final Delay value. */
function _vpxProjectRow(vehicleRow, orderedCols) {
    let carriedDelay = 0;
    const cells = orderedCols.map(col => {
        const key = col.resolve(vehicleRow.vehicle);
        const task = key ? vehicleRow.stations[key] : null;
        if (!task) return { planned: null, actual: null, projected: false, late: false };

        const plannedEnd = task.end_date || null;
        const actualEnd = task.progress?.completion_date || null;

        if (actualEnd) {
            const delay = plannedEnd ? daysBetween(plannedEnd, actualEnd) : 0;
            carriedDelay = delay;
            return { planned: plannedEnd, actual: actualEnd, projected: false, late: delay > 0 };
        }
        const projectedDate = (plannedEnd && carriedDelay > 0) ? _addWorkingDays(plannedEnd, carriedDelay) : plannedEnd;
        return { planned: plannedEnd, actual: projectedDate, projected: !!plannedEnd, late: false };
    });
    return { cells, finalDelay: carriedDelay };
}

function _vpxStationReportData() {
    const _fCategory = getVal('filterCategory');
    let vpxData = _fCategory
        ? currentData.filter(r => getModuleCategory(r.process_station, r) === _fCategory)
        : currentData;
    vpxData = _getVpxFilteredData(vpxData);
    if (!vpxData.length) return null;

    const rows = buildVpxRows(vpxData);
    const activeCols = buildVpxColumns(vpxData).filter(col =>
        rows.some(row => { const k = col.resolve(row.vehicle); return k !== null && row.stations[k]; })
    );
    if (!activeCols.length) return null;

    const titleParts = [getModuleBadge()];
    if (_vpxVehicleTypeFilter) titleParts.push(_vpxVehicleTypeFilter);
    if (_vpxCategoryFilter) titleParts.push(_vpxCategoryFilter);
    titleParts.push('Station Report');

    return { rows, activeCols, title: titleParts.join(' ') };
}

const VPX_REPORT_GRP_COLOR = {
    'Welding': { bg: 'FF991b1b', fg: 'FFffffff' },
    'Machining': { bg: 'FF0f766e', fg: 'FFffffff' },
    'Shot Blasting and Painting': { bg: 'FF6b21a8', fg: 'FFffffff' },
    'Assembly': { bg: 'FF1e3a8a', fg: 'FFffffff' },
    'Processing': { bg: 'FF78350f', fg: 'FFffffff' },
    'Final Inspection': { bg: 'FF064e3b', fg: 'FFffffff' },
    'Final Test': { bg: 'FF334155', fg: 'FFffffff' },
};

async function exportVpxStationReportExcel(preview) {
    if (!await canExport()) { showToast('You do not have permission to export reports.', 'error'); return; }
    if (isF100KD2Module()) { showToast('Station report is only available for the F200-KD2 module.', 'error'); return; }
    if (!currentData?.length) { showToast('No data to export.', 'error'); return; }
    if (typeof ExcelJS === 'undefined') { showToast('ExcelJS not loaded yet — please wait a moment and try again.', 'error'); return; }

    const built = _vpxStationReportData();
    if (!built) { showToast('No data matches the current filters.', 'error'); return; }
    const { rows, activeCols, title } = built;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'PPMS';
    wb.created = new Date();
    const ws = wb.addWorksheet('Station Report', {
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        views: [{ state: 'frozen', xSplit: 1, ySplit: 5 }],
    });

    const totalCols = 1 + activeCols.length + 2; // vehicle col + stations + Delay + Delay Reason cols
    const delayCol = totalCols - 1;
    const reasonCol = totalCols;

    ws.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1e293b' } };
    ws.getRow(1).height = 24;

    ws.mergeCells(2, 1, 2, totalCols);
    const subCell = ws.getCell(2, 1);
    subCell.value = `Generated: ${new Date().toLocaleString('en-GB')}  ·  ${rows.length} vehicle${rows.length !== 1 ? 's' : ''}`;
    subCell.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF64748b' } };
    ws.getRow(2).height = 13;

    ws.addRow([]); ws.getRow(3).height = 6;

    // Row 4 — station group header (blank over the Delay/Delay Reason columns)
    const grpRowData = [''];
    activeCols.forEach(col => grpRowData.push(col.group));
    grpRowData.push('', '');
    ws.addRow(grpRowData);
    ws.getRow(4).height = 18;
    let grpStart = 2, grpCurrent = activeCols[0]?.group;
    const applyGrpMerge = (start, end, label) => {
        if (start < end) ws.mergeCells(4, start, 4, end);
        const gc = ws.getCell(4, start);
        const gClr = VPX_REPORT_GRP_COLOR[label] || { bg: 'FF334155', fg: 'FFffffff' };
        gc.value = label;
        gc.font = { name: 'Calibri', size: 9, bold: true, color: { argb: gClr.fg } };
        gc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gClr.bg } };
        gc.alignment = { horizontal: 'center', vertical: 'middle' };
    };
    activeCols.forEach((col, i) => {
        const colN = i + 2;
        if (col.group !== grpCurrent) {
            applyGrpMerge(grpStart, colN - 1, grpCurrent);
            grpStart = colN;
            grpCurrent = col.group;
        }
        if (i === activeCols.length - 1) applyGrpMerge(grpStart, colN, grpCurrent);
    });
    const unitHdr4 = ws.getCell(4, 1);
    unitHdr4.value = 'Vehicle';
    unitHdr4.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFffffff' } };
    unitHdr4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e293b' } };
    unitHdr4.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell(4, totalCols).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };

    // Row 5 — station code + full name header, "Delay" + "Delay Reason"
    const stationHeaderText = col => (col.name && col.name !== col.code) ? `${col.code}\n${col.name}` : col.code;
    const codeRowData = [''];
    activeCols.forEach(col => codeRowData.push(stationHeaderText(col)));
    codeRowData.push('Delay', 'Delay Reason');
    ws.addRow(codeRowData);
    ws.getRow(5).height = 30;
    for (let c = 1; c <= totalCols; c++) {
        const cell = ws.getCell(5, c);
        const isEdge = c === 1 || c === delayCol || c === reasonCol;
        cell.font = { name: 'Calibri', size: 8, bold: true, color: { argb: isEdge ? 'FFffffff' : 'FF1e293b' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEdge ? 'FF1e293b' : 'FFf1f5f9' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
            top: { style: 'medium', color: { argb: 'FF94a3b8' } },
            bottom: { style: 'medium', color: { argb: 'FF94a3b8' } },
            left: { style: 'thin', color: { argb: 'FFe2e8f0' } },
            right: { style: 'thin', color: { argb: 'FFe2e8f0' } },
        };
    }

    const bord = () => ({
        top: { style: 'thin', color: { argb: 'FFe2e8f0' } },
        bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } },
        left: { style: 'thin', color: { argb: 'FFe2e8f0' } },
        right: { style: 'thin', color: { argb: 'FFe2e8f0' } },
    });

    const thickBord = side => ({ style: 'medium', color: { argb: 'FF475569' } });

    let excelRowIdx = 6;
    rows.forEach(row => {
        const { cells, finalDelay } = _vpxProjectRow(row, activeCols);
        const code = getUnitCode(row.vehicle, row.vehicle_no);
        const label = `${row.vehicle} #${row.vehicle_no || ''}${code ? '\n' + code : ''}`.trim();
        const planRowN = excelRowIdx;
        const actualRowN = excelRowIdx + 1;

        // Plan row
        ws.addRow(['', ...cells.map(c => c.planned ? formatDateShort(c.planned) : ''), '', '']);
        ws.getRow(planRowN).eachCell({ includeEmpty: true }, (cell, colN) => {
            cell.font = { name: 'Calibri', size: 8, color: { argb: 'FF475569' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } };
            cell.border = bord();
            cell.alignment = { horizontal: colN === 1 ? 'left' : 'center', vertical: 'middle' };
        });
        ws.getCell(planRowN, delayCol).value = 'Plan';
        ws.getCell(planRowN, delayCol).font = { name: 'Calibri', size: 7, italic: true, color: { argb: 'FF94a3b8' } };
        excelRowIdx++;

        // Actual row — real completions are red (late) / green (on-time);
        // not-yet-finished (projected) cells are light-grey text, no fill.
        const actualVals = cells.map(c => c.actual ? formatDateShort(c.actual) : (c.planned ? '' : '—'));
        ws.addRow(['', ...actualVals, finalDelay > 0 ? `+${finalDelay}d` : '0d', '']);
        ws.getRow(actualRowN).eachCell({ includeEmpty: true }, (cell, colN) => {
            const isDelayCol = colN === delayCol;
            const c = colN > 1 && !isDelayCol && colN !== reasonCol ? cells[colN - 2] : null;
            const isProjected = !!c?.projected;
            const isLate = !!c?.late;
            const isReal = c && !c.projected && c.actual;
            cell.font = {
                name: 'Calibri', size: 8,
                italic: isProjected,
                bold: colN === 1 || isDelayCol || (isReal && isLate),
                color: {
                    argb: isProjected ? 'FF94a3b8'
                        : isReal ? (isLate ? 'FFb91c1c' : 'FF15803d')
                        : (isDelayCol ? (finalDelay > 0 ? 'FFb91c1c' : 'FF15803d') : 'FF1e293b'),
                },
            };
            cell.fill = {
                type: 'pattern', pattern: 'solid',
                fgColor: {
                    argb: isProjected ? 'FFffffff'
                        : isReal ? (isLate ? 'FFfee2e2' : 'FFdcfce7')
                        : (isDelayCol ? (finalDelay > 0 ? 'FFfee2e2' : 'FFdcfce7') : 'FFffffff'),
                },
            };
            cell.border = bord();
            cell.alignment = { horizontal: colN === 1 ? 'left' : 'center', vertical: 'middle' };
        });
        excelRowIdx++;

        // Vehicle label — merged vertically across the Plan/Actual pair,
        // matching the reference report's layout.
        ws.mergeCells(planRowN, 1, actualRowN, 1);
        const vehCell = ws.getCell(planRowN, 1);
        vehCell.value = label;
        vehCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFffffff' } };
        vehCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        vehCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

        // Delay Reason — editable per-vehicle note (VPX matrix "note" icon),
        // merged the same way as the vehicle label.
        const delayReason = getDelayReason(row.vehicle, row.vehicle_no);
        ws.mergeCells(planRowN, reasonCol, actualRowN, reasonCol);
        const reasonCell = ws.getCell(planRowN, reasonCol);
        reasonCell.value = delayReason || '—';
        reasonCell.font = { name: 'Calibri', size: 8, italic: !delayReason, color: { argb: delayReason ? 'FF78350f' : 'FF94a3b8' } };
        reasonCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: delayReason ? 'FFfffbeb' : 'FFffffff' } };
        reasonCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };

        // Clear separation between vehicle blocks: thick top border on the
        // Plan row, thick bottom border on the Actual row, across every column.
        for (let c = 1; c <= totalCols; c++) {
            ws.getCell(planRowN, c).border = { ...ws.getCell(planRowN, c).border, top: thickBord() };
            ws.getCell(actualRowN, c).border = { ...ws.getCell(actualRowN, c).border, bottom: thickBord() };
        }
    });

    ws.getColumn(1).width = 22;
    for (let i = 2; i <= delayCol - 1; i++) ws.getColumn(i).width = 14;
    ws.getColumn(delayCol).width = 10;
    ws.getColumn(reasonCol).width = 34;

    // ── Key & Legend worksheet — explains the file and how to read it ──
    const wsKey2 = wb.addWorksheet('Key & Legend');
    wsKey2.getColumn(1).width = 5;
    wsKey2.getColumn(2).width = 26;
    wsKey2.getColumn(3).width = 70;

    wsKey2.addRow(['', title]);
    wsKey2.mergeCells(1, 2, 1, 3);
    wsKey2.getCell(1, 2).font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF1e293b' } };
    wsKey2.getRow(1).height = 24;
    wsKey2.addRow([]); wsKey2.getRow(2).height = 8;

    const keySection = (row, heading) => {
        wsKey2.addRow(['', heading]);
        wsKey2.mergeCells(row, 2, row, 3);
        const c = wsKey2.getCell(row, 2);
        c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF64748b' } };
        c.border = { bottom: { style: 'medium', color: { argb: 'FFcbd5e1' } } };
        wsKey2.getRow(row).height = 16;
    };
    const keyLine = (row, label, desc, opts = {}) => {
        wsKey2.addRow(['', label, desc]);
        wsKey2.getRow(row).height = 18;
        const lbl = wsKey2.getCell(row, 2);
        const dsc = wsKey2.getCell(row, 3);
        lbl.font = { name: 'Calibri', size: 9, bold: true, color: { argb: opts.fg || 'FF334155' } };
        lbl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg || 'FFf1f5f9' } };
        lbl.alignment = { vertical: 'middle', horizontal: 'center' };
        dsc.font = { name: 'Calibri', size: 9, color: { argb: 'FF475569' } };
        dsc.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
        [2, 3].forEach(c => { wsKey2.getCell(row, c).border = bord(); });
    };

    keySection(3, 'WHAT THIS REPORT SHOWS');
    keyLine(4, 'Layout', 'One row-pair per vehicle: "Plan" (planned start/end per station) above "Actual" (actual/recorded completion, or a projected date if not yet finished).');
    keyLine(5, 'Vehicle label', 'Vehicle type + unit number, plus the unit code (e.g. EGY N25020) when assigned.');
    keyLine(6, 'Stations', 'Columns are process stations in production route order, grouped and colour-coded by process group.');

    wsKey2.addRow([]); wsKey2.getRow(7).height = 8;
    keySection(8, 'ACTUAL ROW COLOURS');
    keyLine(9, 'Green', 'Station completed on or before its planned end date.', { bg: 'FFdcfce7', fg: 'FF15803d' });
    keyLine(10, 'Red', 'Station completed after its planned end date (late completion).', { bg: 'FFfee2e2', fg: 'FFb91c1c' });
    keyLine(11, 'Light grey (no fill)', 'Not yet finished — showing a projected completion date (see below), not a real actual date.', { bg: 'FFffffff', fg: 'FF94a3b8' });

    wsKey2.addRow([]); wsKey2.getRow(12).height = 8;
    keySection(13, 'DELAY & PROJECTED COMPLETION — HOW THEY ARE CALCULATED');
    keyLine(14, 'Delay column', 'The vehicle\'s most recently recorded delay: (actual completion date) − (planned end date) of its last finished station, in working days. 0d or blank means on schedule.');
    keyLine(15, 'Projected date', 'For each not-yet-finished station, its planned end date is shifted forward by the vehicle\'s current carried delay (the same value shown in the Delay column at that point in the route). This carried delay updates at every station that has a real actual date, and rolls forward unchanged through every station that doesn\'t.');
    keyLine(16, 'Example', 'A vehicle finishes Welding 3 working days late. Every later station\'s projected date (Machining, Painting, …) is shown 3 working days after its own planned date, until the vehicle records a new actual date that resets the carried delay.');
    keyLine(17, 'Delay Reason column', 'A free-text note explaining the vehicle\'s main delay, entered by a planner/admin on the VPX matrix (click the note icon on the vehicle\'s row). One current reason per vehicle — editing it overwrites the previous note.');

    // ── Save ───────────────────────────────────────────────────────
    const now = new Date().toISOString().slice(0, 10);
    const doDownload = async () => {
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `vpx_station_report_${now}.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Station report exported.', 'success');
    };
    if (preview) {
        _showGenericPreview({ title, kind: 'sheets', sheets: _workbookToSheets(wb), onDownload: doDownload });
    } else {
        await doDownload();
    }
}

async function exportVpxStationReportPDF(preview) {
    if (!await canExport()) { showToast('You do not have permission to export reports.', 'error'); return; }
    if (isF100KD2Module()) { showToast('Station report is only available for the F200-KD2 module.', 'error'); return; }
    if (!currentData?.length) { showToast('No data to export.', 'error'); return; }
    if (!window.jspdf) { showToast('PDF library not loaded — please refresh.', 'error'); return; }

    const built = _vpxStationReportData();
    if (!built) { showToast('No data matches the current filters.', 'error'); return; }
    const { rows, activeCols, title } = built;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const PAGE_W = doc.internal.pageSize.getWidth();
    const PAGE_H = doc.internal.pageSize.getHeight();
    const MARGIN = 10;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text(title, MARGIN, 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('Generated: ' + new Date().toLocaleString('en-GB'), PAGE_W - MARGIN, 10, { align: 'right' });

    const stationHeaderText = col => (col.name && col.name !== col.code) ? `${col.code}\n${col.name}` : col.code;
    const headers = ['Vehicle', ...activeCols.map(stationHeaderText), 'Delay', 'Delay Reason'];
    const body = [];
    const cellFlags = []; // parallel to body — {projected,late,real} per station cell, per row
    const vehicleBlockStartRows = []; // body row index where each vehicle's Plan row starts

    rows.forEach(row => {
        const { cells, finalDelay } = _vpxProjectRow(row, activeCols);
        const code = getUnitCode(row.vehicle, row.vehicle_no);
        const label = `${row.vehicle} #${row.vehicle_no || ''}${code ? '\n' + code : ''}`.trim();
        const delayReason = getDelayReason(row.vehicle, row.vehicle_no);

        vehicleBlockStartRows.push(body.length);

        body.push([
            { content: label, rowSpan: 2, styles: { valign: 'middle', halign: 'center', fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold' } },
            ...cells.map(c => c.planned ? formatDateShort(c.planned) : ''),
            '',
            { content: delayReason || '—', rowSpan: 2, styles: { valign: 'middle', halign: 'left', fillColor: delayReason ? [255, 251, 235] : [255, 255, 255], textColor: delayReason ? [120, 53, 15] : [148, 163, 184], fontStyle: delayReason ? 'normal' : 'italic' } },
        ]);
        cellFlags.push(cells.map(() => ({ projected: false, late: false, real: false })));

        body.push([
            ...cells.map(c => c.actual ? formatDateShort(c.actual) : (c.planned ? '' : '—')),
            finalDelay > 0 ? `+${finalDelay}d` : '0d',
        ]);
        cellFlags.push(cells.map(c => ({ projected: c.projected, late: c.late, real: !c.projected && !!c.actual })));
    });

    doc.autoTable({
        startY: 16,
        head: [headers], body,
        margin: { left: MARGIN, right: MARGIN },
        styles: { fontSize: 5.5, cellPadding: 1.2, font: 'helvetica', textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.15 },
        headStyles: { fillColor: [30, 58, 138], textColor: [241, 245, 249], fontStyle: 'bold', fontSize: 5.5, halign: 'center' },
        columnStyles: { 0: { cellWidth: 26, halign: 'left' }, [headers.length - 1]: { cellWidth: 40, halign: 'left' } },
        didParseCell(data) {
            if (data.section !== 'body') return;
            const rowIdx = data.row.index;
            // Thick separator between vehicle blocks: top of every Plan row.
            if (vehicleBlockStartRows.includes(rowIdx)) {
                data.cell.styles.lineWidth = { top: 0.5, right: 0.15, bottom: 0.15, left: 0.15 };
                data.cell.styles.lineColor = [71, 85, 105];
            }
            if (vehicleBlockStartRows.includes(rowIdx + 1)) {
                data.cell.styles.lineWidth = { top: 0.15, right: 0.15, bottom: 0.5, left: 0.15 };
                data.cell.styles.lineColor = [71, 85, 105];
            }
            const colIdx = data.column.index;
            const flags = cellFlags[rowIdx];
            const isPlanRow = vehicleBlockStartRows.includes(rowIdx);
            if (colIdx === 0 && isPlanRow) return; // vehicle label cell, styled inline above
            if (colIdx === headers.length - 1) return; // Delay Reason cell (Plan row only, via rowSpan), styled inline above
            // Column 0 is the vehicle label (Plan row only, via rowSpan) — station
            // columns always start at table column index 1 in both Plan and Actual rows.
            const stationColIdx = colIdx - 1;
            if (colIdx === headers.length - 2) {
                // Delay column
                if (!isPlanRow) {
                    const text = String(data.cell.raw || '');
                    if (text.startsWith('+')) { data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'bold'; }
                    else if (text === '0d') { data.cell.styles.textColor = [21, 128, 61]; data.cell.styles.fontStyle = 'bold'; }
                }
                return;
            }
            if (stationColIdx < 0 || stationColIdx >= activeCols.length) return;
            const f = flags?.[stationColIdx];
            if (!f) return;
            if (f.projected) {
                data.cell.styles.textColor = [148, 163, 184];
                data.cell.styles.fontStyle = 'italic';
            } else if (f.real) {
                data.cell.styles.textColor = f.late ? [185, 28, 28] : [21, 128, 61];
                data.cell.styles.fillColor = f.late ? [254, 226, 226] : [220, 252, 231];
                if (f.late) data.cell.styles.fontStyle = 'bold';
            }
        },
        didDrawPage(data) {
            const pageCount = doc.internal.getNumberOfPages();
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6);
            doc.setTextColor(148, 163, 184);
            doc.text(title, MARGIN, PAGE_H - 5);
            doc.text(`Page ${data.pageNumber} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 5, { align: 'right' });
        },
    });

    // ── Key & Legend page — explains the report and the delay calculation ──
    doc.addPage('a4', 'portrait');
    const KP_W = doc.internal.pageSize.getWidth();
    let ky = 18;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(30, 41, 59);
    doc.text('Key & Legend — ' + title, MARGIN, ky); ky += 10;

    const keySection = txt => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
        doc.text(txt, MARGIN, ky); ky += 1;
        doc.setDrawColor(203, 213, 225); doc.line(MARGIN, ky, KP_W - MARGIN, ky); ky += 6;
    };
    const keyLine = (label, desc, color) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
        doc.setTextColor(color ? color[0] : 51, color ? color[1] : 65, color ? color[2] : 85);
        doc.text(label, MARGIN + 2, ky);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(71, 85, 105);
        const wrapped = doc.splitTextToSize(desc, KP_W - MARGIN * 2 - 42);
        doc.text(wrapped, MARGIN + 42, ky);
        ky += Math.max(5, wrapped.length * 4) + 2;
    };

    keySection('WHAT THIS REPORT SHOWS');
    keyLine('Layout', 'One row-pair per vehicle: "Plan" (planned start/end per station) above "Actual" (actual/recorded completion, or a projected date if not yet finished).');
    keyLine('Vehicle label', 'Vehicle type + unit number, plus the unit code (e.g. EGY N25020) when assigned.');
    keyLine('Stations', 'Columns are process stations in production route order, grouped by process group.');
    ky += 4;

    keySection('ACTUAL ROW COLOURS');
    keyLine('Green', 'Station completed on or before its planned end date.', [21, 128, 61]);
    keyLine('Red', 'Station completed after its planned end date (late completion).', [185, 28, 28]);
    keyLine('Grey / italic', 'Not yet finished — showing a projected completion date, not a real actual date.', [148, 163, 184]);
    ky += 4;

    keySection('DELAY & PROJECTED COMPLETION — HOW THEY ARE CALCULATED');
    keyLine('Delay column', 'The vehicle\'s most recently recorded delay: (actual completion date) minus (planned end date) of its last finished station, in working days. 0d means on schedule.');
    keyLine('Projected date', 'Each not-yet-finished station\'s planned end date is shifted forward by the vehicle\'s current carried delay. This carried delay updates at every station with a real actual date, and rolls forward unchanged through every station that doesn\'t.');
    keyLine('Example', 'A vehicle finishes Welding 3 working days late. Every later station\'s projected date is shown 3 working days after its own planned date, until a new actual date resets the carried delay.');
    keyLine('Delay Reason column', 'A free-text note explaining the vehicle\'s main delay, entered by a planner/admin on the VPX matrix (click the note icon on the vehicle\'s row). One current reason per vehicle — editing it overwrites the previous note.');

    const now = new Date().toISOString().slice(0, 10);
    const doDownload = () => { doc.save(`vpx_station_report_${now}.pdf`); showToast('Station report PDF exported.', 'success'); };
    if (preview) {
        _showGenericPreview({ title, kind: 'pdf', src: doc.output('bloburl'), onDownload: doDownload });
    } else {
        doDownload();
    }
}

/* ─── VPX "Generate Report" popup — replaces the 4 standalone export
   buttons with a single entry point, mirroring the Issues report modal. ── */
function wireVpxReportModal() {
    const overlay = document.getElementById('vpxReportModalOverlay');
    if (!overlay) return;
    const close = () => { overlay.style.display = 'none'; };

    document.getElementById('btnVpxReportModal')?.addEventListener('click', () => {
        const hint = document.getElementById('vpxReportScopeHint');
        if (hint) {
            const parts = [getModuleBadge()];
            if (_vpxVehicleTypeFilter) parts.push(_vpxVehicleTypeFilter);
            if (_vpxCategoryFilter) parts.push(_vpxCategoryFilter);
            hint.textContent = parts.join(' · ');
        }
        overlay.style.display = 'flex';
    });
    document.getElementById('vpxReportModalClose')?.addEventListener('click', close);
    document.getElementById('vpxReportModalCancel')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    document.getElementById('btnVpxReportPDF')?.addEventListener('click', async () => {
        const type = overlay.querySelector('input[name="vpxReportType"]:checked')?.value || 'matrix';
        const preview = !!document.getElementById('vpxReportPreviewToggle')?.checked;
        if (type === 'station') await exportVpxStationReportPDF(preview); else await exportVpxPDF(preview);
        if (!preview) close();
    });
    document.getElementById('btnVpxReportExcel')?.addEventListener('click', async () => {
        const type = overlay.querySelector('input[name="vpxReportType"]:checked')?.value || 'matrix';
        const preview = !!document.getElementById('vpxReportPreviewToggle')?.checked;
        if (type === 'station') await exportVpxStationReportExcel(preview); else await exportVpxExcel(preview);
        if (!preview) close();
    });
}

/* ─── VPX delay-reason editing — click the note icon on a vehicle's row
   header to view/edit why it's delayed; flows into the Station Report as
   the "Delay Reason" column. Gated by the same permission as plan edits. ── */
function openVpxDelayReasonModal(vehicle, vehicleNo) {
    const overlay = document.getElementById('vpxDelayReasonModalOverlay');
    if (!overlay) return;
    const entry = getDelayReasonEntry(vehicle, vehicleNo);
    if (!entry) {
        showToast('Add this vehicle in Unit Codes first to attach a delay reason.', 'error');
        return;
    }

    const titleEl = document.getElementById('vpxDelayReasonModalTitle');
    if (titleEl) titleEl.textContent = `Delay Reason — ${vehicle} ${vehicleNo}`;
    const textEl = document.getElementById('vpxDelayReasonText');
    if (textEl) textEl.value = entry.reason || '';

    const canEdit = canEditPlan();
    if (textEl) textEl.disabled = !canEdit;
    const saveBtn = document.getElementById('vpxDelayReasonSave');
    if (saveBtn) saveBtn.style.display = canEdit ? '' : 'none';
    const hint = document.getElementById('vpxDelayReasonViewerHint');
    if (hint) hint.style.display = canEdit ? 'none' : '';

    overlay.dataset.rowId = entry.id;
    overlay.dataset.vehicle = vehicle;
    overlay.dataset.vehicleNo = vehicleNo;
    overlay.style.display = 'flex';
}

async function saveVpxDelayReason() {
    const overlay = document.getElementById('vpxDelayReasonModalOverlay');
    const rowId = overlay?.dataset?.rowId;
    if (!rowId) return;
    if (!canEditPlan()) { showToast('Only planners and admins can edit the delay reason.', 'error'); return; }

    const text = document.getElementById('vpxDelayReasonText')?.value?.trim() || '';
    const saveBtn = document.getElementById('vpxDelayReasonSave');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    const { error } = await db.from('kd2_vehicle_units').update({ delay_reason: text || null }).eq('id', rowId);

    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    if (error) { showToast('Failed to save: ' + error.message, 'error'); return; }

    const vehicle = overlay.dataset.vehicle, vehicleNo = overlay.dataset.vehicleNo;
    const entry = getDelayReasonEntry(vehicle, vehicleNo);
    if (entry) entry.reason = text;
    showToast('Delay reason saved.', 'success');
    overlay.style.display = 'none';
    if (currentData?.length) renderVPX(currentData);
}

function wireVpxDelayReasonModal() {
    const overlay = document.getElementById('vpxDelayReasonModalOverlay');
    if (!overlay) return;
    const close = () => { overlay.style.display = 'none'; };
    document.getElementById('vpxDelayReasonModalClose')?.addEventListener('click', close);
    document.getElementById('vpxDelayReasonCancel')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.getElementById('vpxDelayReasonSave')?.addEventListener('click', saveVpxDelayReason);

    document.getElementById('vpxMatrix')?.addEventListener('click', e => {
        const btn = e.target.closest('.vpx-delay-reason-btn');
        if (!btn) return;
        openVpxDelayReasonModal(btn.dataset.vpxVehicle, btn.dataset.vpxUnit);
    });
}

/* ─── Wire the modal ────────────────────────────────────────────── */
function wireReportModal() {
    const overlay = document.getElementById('reportModalOverlay');
    const close = () => { overlay.style.display = 'none'; };

    document.getElementById('btnReports').addEventListener('click', () => {
        syncReportCategoryOptions();
        updateReportPreview();
        overlay.style.display = 'flex';
    });
    document.getElementById('reportModalClose').addEventListener('click', close);
    document.getElementById('reportModalCancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Live preview count when type, dates, or category change
    overlay.querySelectorAll('input[name="reportType"]').forEach(radio => {
        radio.addEventListener('change', updateReportPreview);
    });
    document.getElementById('reportDateFrom').addEventListener('change', updateReportPreview);
    document.getElementById('reportDateTo').addEventListener('change', updateReportPreview);
    document.getElementById('reportCategory').addEventListener('change', updateReportPreview);
    document.getElementById('reportVehicleType')?.addEventListener('change', updateReportPreview);

    document.getElementById('btnExportPDF').addEventListener('click', () => {
        const type = document.querySelector('input[name="reportType"]:checked')?.value || 'full';
        const preview = !!document.getElementById('reportPreviewToggle')?.checked;
        exportPDF(type, getVal('reportDateFrom'), getVal('reportDateTo'), getVal('reportCategory'), preview);
    });

    document.getElementById('btnExportExcel').addEventListener('click', async () => {
        const type = document.querySelector('input[name="reportType"]:checked')?.value || 'full';
        const preview = !!document.getElementById('reportPreviewToggle')?.checked;
        await exportExcel(type, getVal('reportDateFrom'), getVal('reportDateTo'), getVal('reportCategory'), preview);
    });
}

function updateReportPreview() {
    const type = document.querySelector('input[name="reportType"]:checked')?.value || 'full';
    const from = getVal('reportDateFrom');
    const to = getVal('reportDateTo');
    const category = getVal('reportCategory');
    const bar = document.getElementById('reportPreviewBar');
    const cnt = document.getElementById('reportPreviewCount');
    const hint = bar?.querySelector('.report-preview-hint');

    if (isKD2Module() && type === 'analytics') {
        const baseRows = buildReportRows('full', from, to, category);
        const stationCount = new Set(baseRows.map(r => r.process_station)).size;
        if (cnt) cnt.textContent = `${stationCount} station${stationCount !== 1 ? 's' : ''} will be analysed`;
        if (hint) hint.textContent = stationCount ? 'Avg plan vs actual · delay per process — ready to export' : 'No stations found — adjust filters';
        if (bar) bar.style.borderColor = stationCount ? 'rgba(79,142,247,.4)' : 'rgba(239,68,68,.4)';
        return;
    }

    const count = buildReportRows(type, from, to, category).length;
    const catLabel = category ? ` · ${category}` : '';
    if (cnt) cnt.textContent = `${count} task${count !== 1 ? 's' : ''} match${catLabel}`;
    if (hint) hint.textContent = count ? 'Ready to export' : 'No tasks match — adjust filters or date range';
    if (bar) bar.style.borderColor = count ? 'rgba(79,142,247,.4)' : 'rgba(239,68,68,.4)';
}

/* ================================================================
   USER MANAGEMENT  (master_admin only)
   ================================================================ */
let _auditLogOffset = 0;
const AUDIT_PAGE_SIZE = 50;

/* ──────────────────────────────────────────────────────────────────
   UNIT CODES MANAGEMENT
   ────────────────────────────────────────────────────────────────── */

function openUnitCodes() {
    setUnitCodesShell();
    document.getElementById('unitCodesOverlay').style.display = 'flex';
    loadUcTable();
}
function closeUnitCodes() {
    document.getElementById('unitCodesOverlay').style.display = 'none';
    closeUcForm();
}

async function loadUcTable() {
    const tbody = document.getElementById('ucTableBody');
    const colSpan = isF100KD2Module() ? 7 : (isKD2Module() ? 5 : 4);
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="table-empty"><span class="spinner"></span> Loading…</td></tr>`;
    try {
        if (isF100KD2Module()) {
            const [{ data: units, error: unitsError }, { data: battalions, error: battalionError }] = await Promise.all([
                db.from('f100_vehicle_units').select('*'),
                db.from('f100_battalions').select('id, battalion_code'),
            ]);
            if (unitsError) throw unitsError;
            if (battalionError) throw battalionError;

            const battalionMap = Object.fromEntries((battalions || []).map(row => [row.id, row.battalion_code]));
            const sorted = (units || []).slice().sort((a, b) => {
                const battalionCmp = String(battalionMap[a.battalion_id] || '').localeCompare(String(battalionMap[b.battalion_id] || ''), undefined, { numeric: true });
                if (battalionCmp !== 0) return battalionCmp;
                const vc = vehicleSort(a.vehicle_type, b.vehicle_type);
                if (vc !== 0) return vc;
                return (a.unit_serial || 0) - (b.unit_serial || 0);
            });

            document.getElementById('ucCount').textContent = sorted.length + ' units';
            if (!sorted.length) {
                tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No F100 unit codes yet. Click "Add / Edit Code" to begin.</td></tr>';
                return;
            }

            tbody.innerHTML = sorted.map(r => `
      <tr>
        <td>${esc(battalionMap[r.battalion_id] || '—')}</td>
        <td>${esc(r.vehicle_type || '—')}</td>
        <td>${esc(r.unit_label || `${r.vehicle_type}-${String(r.unit_serial).padStart(2, '0')}`)}</td>
        <td class="mono">${esc(String(r.unit_serial))}</td>
        <td class="mono">${esc(r.unit_code || '—')}</td>
        <td>${esc(r.unit_name || '—')}</td>
        <td>
          <button class="btn btn-xs btn-ghost" onclick="openUcForm('${r.id}')">Edit</button>
          <button class="btn btn-xs btn-danger" onclick="deleteUnitCode('${r.id}')">Delete</button>
        </td>
      </tr>`).join('');
            return;
        }

        if (isKD2Module()) {
            const [{ data: units, error: unitsError }, { data: battalions, error: battalionError }] = await Promise.all([
                db.from('kd2_vehicle_units').select('*'),
                db.from('kd2_battalions').select('id, battalion_code'),
            ]);
            if (unitsError) throw unitsError;
            if (battalionError) throw battalionError;

            const battalionMap = Object.fromEntries((battalions || []).map(row => [row.id, row.battalion_code]));
            const sorted = (units || []).slice().sort((a, b) => {
                const battalionCmp = String(battalionMap[a.battalion_id] || '').localeCompare(String(battalionMap[b.battalion_id] || ''), undefined, { numeric: true });
                if (battalionCmp !== 0) return battalionCmp;
                const vc = vehicleSort(a.vehicle_type, b.vehicle_type);
                if (vc !== 0) return vc;
                return (a.unit_serial || 0) - (b.unit_serial || 0);
            });

            document.getElementById('ucCount').textContent = sorted.length + ' units';
            if (!sorted.length) {
                tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No KD2 unit codes yet. Click "Add / Edit Code" to begin.</td></tr>';
                return;
            }

            tbody.innerHTML = sorted.map(r => `
      <tr>
        <td>${esc(battalionMap[r.battalion_id] || '—')}</td>
        <td>${esc(r.vehicle_type)}</td>
        <td>${esc(r.unit_label || `${r.vehicle_type}-${String(r.unit_serial).padStart(2, '0')}`)}</td>
        <td class="mono">${esc(r.unit_code || '')}</td>
        <td>
          <button class="btn btn-xs btn-ghost" onclick="openUcForm(${r.id})">Edit</button>
          <button class="btn btn-xs btn-danger" onclick="deleteUnitCode(${r.id})">Delete</button>
        </td>
      </tr>`).join('');
            return;
        }

        const { data, error } = await db.from('vehicle_units').select('*');
        if (error) throw error;

        const sorted = (data || []).slice().sort((a, b) => {
            const vc = vehicleSort(a.vehicle, b.vehicle);
            if (vc !== 0) return vc;
            return naturalSort(a.vehicle_no, b.vehicle_no);
        });

        document.getElementById('ucCount').textContent = sorted.length + ' units';
        if (!sorted.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No unit codes yet. Click "Add / Edit Code" to begin.</td></tr>';
            return;
        }
        tbody.innerHTML = sorted.map(r => `
      <tr>
        <td>${esc(r.vehicle)}</td>
        <td>${esc(r.vehicle_no)}</td>
        <td class="mono">${esc(r.unit_code)}</td>
        <td>
          <button class="btn btn-xs btn-ghost" onclick="openUcForm(${r.id})">Edit</button>
          <button class="btn btn-xs btn-danger" onclick="deleteUnitCode(${r.id})">Delete</button>
        </td>
      </tr>`).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="table-empty">Error loading unit codes.</td></tr>`;
        console.error(e);
    }
}

async function openUcForm(id) {
    setUnitCodesShell();
    // Hide table + toolbar so form footer (Save button) is not clipped
    document.getElementById('ucTableBody').closest('.um-table-wrap').style.display = 'none';
    document.querySelector('#unitCodesOverlay .um-toolbar').style.display = 'none';
    document.getElementById('ucForm').style.display = 'block';
    document.getElementById('ucFormTitle').textContent = id
        ? (isF100KD2Module() ? 'Edit F100 Unit' : isKD2Module() ? 'Edit KD2 Unit Code' : 'Edit Unit Code')
        : (isF100KD2Module() ? 'Add F100 Unit' : isKD2Module() ? 'Add KD2 Unit Code' : 'Add Unit Code');
    document.getElementById('ucFormError').textContent = '';

    const vSel = document.getElementById('ucVehicle');
    const bSel = document.getElementById('ucBattalion');
    const unitText = document.getElementById('ucUnitText');

    if (isF100KD2Module()) {
        // Show Unit Name field and relabel Unit field for F100
        document.getElementById('ucNameGroup').style.display = '';
        document.getElementById('ucUnitLabel').textContent = 'Unit Label';
        document.getElementById('ucCodeLabel').textContent = 'Unit Code';

        vSel.innerHTML = ['K9', 'K10', 'K11'].map(v => `<option value="${v}">${v}</option>`).join('');
        let battalions = [];
        try {
            const { data, error } = await db.from('f100_battalions').select('id, battalion_code, battalion_name').order('battalion_code');
            if (error) throw error;
            battalions = data || [];
        } catch (error) {
            document.getElementById('ucFormError').textContent = error.message;
            return;
        }
        bSel.innerHTML = battalions.map(row => `<option value="${row.id}">${esc(row.battalion_name ? `${row.battalion_code} – ${row.battalion_name}` : row.battalion_code)}</option>`).join('');

        if (id) {
            const { data } = await db.from('f100_vehicle_units').select('*').eq('id', id).maybeSingle();
            if (data) {
                document.getElementById('ucEditId').value = id;
                bSel.value = String(data.battalion_id);
                vSel.value = data.vehicle_type;
                unitText.value = data.unit_label || '';
                document.getElementById('ucName').value = data.unit_name || '';
                document.getElementById('ucCode').value = data.unit_code || '';
                return;
            }
        }

        const currentBattalion = getVal('f100Battalion');
        const currentBattalionRow = battalions.find(row => row.battalion_code === currentBattalion);
        const battalionOption = currentBattalionRow ? [...bSel.options].find(opt => opt.value === String(currentBattalionRow.id)) : null;
        if (battalionOption) bSel.value = battalionOption.value;
        document.getElementById('ucEditId').value = '';
        unitText.value = '';
        document.getElementById('ucName').value = '';
        document.getElementById('ucCode').value = '';
        return;
    }

    // Reset F100-only fields when switching to non-F100
    document.getElementById('ucNameGroup').style.display = 'none';
    document.getElementById('ucUnitLabel').textContent = 'Unit';
    document.getElementById('ucCodeLabel').textContent = 'Unit Code';

    if (isKD2Module()) {
        vSel.innerHTML = ['K9', 'K10', 'K11'].map(v => `<option value="${v}">${v}</option>`).join('');
        let battalions = [];
        try {
            battalions = await loadKd2Battalions();
        } catch (error) {
            document.getElementById('ucFormError').textContent = error.message;
            return;
        }
        bSel.innerHTML = battalions.map(row => `<option value="${row.id}">${esc(getKd2BattalionOptionLabel(row))}</option>`).join('');

        if (id) {
            const { data } = await db.from('kd2_vehicle_units').select('*').eq('id', id).maybeSingle();
            if (data) {
                document.getElementById('ucEditId').value = id;
                bSel.value = String(data.battalion_id);
                vSel.value = data.vehicle_type;
                unitText.value = data.unit_label || `M${data.unit_serial}`;
                document.getElementById('ucCode').value = data.unit_code || '';
                return;
            }
        }

        const currentBattalion = getVal('filterBattalion');
        const currentBattalionRow = battalions.find(row => row.battalion_code === currentBattalion);
        const battalionOption = currentBattalionRow ? [...bSel.options].find(opt => opt.value === String(currentBattalionRow.id)) : null;
        if (battalionOption) bSel.value = battalionOption.value;
        const currentVehicle = getVal('filterVehicle');
        if (['K9', 'K10', 'K11'].includes(currentVehicle)) vSel.value = currentVehicle;
        document.getElementById('ucEditId').value = '';
        unitText.value = '';
        document.getElementById('ucCode').value = '';
        return;
    }

    const vehicles = [...new Set(currentData.map(r => r.vehicle))].sort(vehicleSort);
    vSel.innerHTML = vehicles.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');

    if (id) {
        const { data } = await db.from('vehicle_units').select('*').eq('id', id).maybeSingle();
        if (data) {
            document.getElementById('ucEditId').value = id;
            vSel.value = data.vehicle;
            await populateUcUnits();
            document.getElementById('ucUnit').value = data.vehicle_no;
            document.getElementById('ucCode').value = data.unit_code;
            return;
        }
    }
    document.getElementById('ucEditId').value = '';
    await populateUcUnits();
    if (unitText) unitText.value = '';
    document.getElementById('ucCode').value = '';
}

async function populateUcUnits() {
    const vehicle = document.getElementById('ucVehicle')?.value;
    const uSel = document.getElementById('ucUnit');
    if (!uSel) return;

    if (isKD2Module() || isF100KD2Module()) {
        uSel.innerHTML = '';
        return;
    }

    const units = [...new Set(currentData.filter(r => r.vehicle === vehicle).map(r => r.vehicle_no))].sort(naturalSort);
    uSel.innerHTML = units.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
}

function closeUcForm() {
    document.getElementById('ucForm').style.display = 'none';
    // Restore table + toolbar
    document.getElementById('ucTableBody').closest('.um-table-wrap').style.display = '';
    document.querySelector('#unitCodesOverlay .um-toolbar').style.display = '';
}

async function saveUnitCode() {
    const id = document.getElementById('ucEditId').value;
    const vehicle = document.getElementById('ucVehicle').value.trim();
    const unit = (isKD2Module() || isF100KD2Module())
        ? document.getElementById('ucUnitText').value.trim()
        : document.getElementById('ucUnit').value.trim();
    const code = document.getElementById('ucCode').value.trim();
    const errEl = document.getElementById('ucFormError');

    if (!vehicle) { errEl.textContent = 'Vehicle type is required.'; return; }

    try {
        if (isF100KD2Module()) {
            const battalionId = document.getElementById('ucBattalion').value;
            const unitLabel = document.getElementById('ucUnitText').value.trim();
            const unitName  = document.getElementById('ucName').value.trim();
            const unitCode  = document.getElementById('ucCode').value.trim();
            if (!battalionId) { errEl.textContent = 'Battalion is required.'; return; }
            if (!unitLabel && !unitCode) { errEl.textContent = 'Unit Label or Unit Code is required.'; return; }

            let error;
            if (id) {
                ({ error } = await db.from('f100_vehicle_units')
                    .update({
                        battalion_id: battalionId,
                        vehicle_type: vehicle,
                        unit_label:   unitLabel || null,
                        unit_name:    unitName  || null,
                        unit_code:    unitCode  || null,
                    })
                    .eq('id', id));
            } else {
                // Auto-assign next serial number for this battalion + vehicle type
                const { data: existing } = await db
                    .from('f100_vehicle_units')
                    .select('unit_serial')
                    .eq('battalion_id', battalionId)
                    .eq('vehicle_type', vehicle)
                    .order('unit_serial', { ascending: false })
                    .limit(1);
                const nextSerial = existing?.length ? (existing[0].unit_serial + 1) : 1;

                ({ error } = await db.from('f100_vehicle_units').insert({
                    battalion_id: battalionId,
                    vehicle_type: vehicle,
                    unit_serial:  nextSerial,
                    unit_label:   unitLabel || null,
                    unit_name:    unitName  || null,
                    unit_code:    unitCode  || null,
                }));
            }
            if (error) throw error;

            closeUcForm();
            loadUcTable();
            showToast('F100 unit saved.', 'success');
            return;
        }

        if (isKD2Module()) {
            const battalionId = parseInt(document.getElementById('ucBattalion').value, 10);
            const unitEntry = normalizeKd2UnitName(document.getElementById('ucUnitText')?.value);
            if (!battalionId || !unitEntry?.label) {
                errEl.textContent = 'Battalion, vehicle, unit name, and code are required.';
                return;
            }
            if (!Number.isFinite(unitEntry.unitSerial) || unitEntry.unitSerial <= 0) {
                errEl.textContent = 'KD2 unit name must end with a positive number, for example M1.';
                return;
            }

            let error;
            if (id) {
                ({ error } = await db.from('kd2_vehicle_units')
                    .update({
                        battalion_id: battalionId,
                        vehicle_type: vehicle,
                        unit_serial: unitEntry.unitSerial,
                        unit_label: unitEntry.label,
                        unit_code: code,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', id));
            } else {
                ({ error } = await db.from('kd2_vehicle_units')
                    .upsert({
                        battalion_id: battalionId,
                        vehicle_type: vehicle,
                        unit_serial: unitEntry.unitSerial,
                        unit_label: unitEntry.label,
                        unit_code: code,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'battalion_id,vehicle_type,unit_serial' }));
            }
            if (error) throw error;

            await loadUnitCodes();
            populateUnitFilter(getVal('filterVehicle') || null);
            refreshAllViews();
            closeUcForm();
            loadUcTable();
            showToast('KD2 unit code saved.', 'success');
            return;
        }

        let error;
        if (id) {
            ({ error } = await db.from('vehicle_units')
                .update({ vehicle, vehicle_no: unit, unit_code: code, updated_at: new Date().toISOString() })
                .eq('id', id));
        } else {
            ({ error } = await db.from('vehicle_units')
                .upsert({ vehicle, vehicle_no: unit, unit_code: code, updated_at: new Date().toISOString() },
                    { onConflict: 'vehicle,vehicle_no' }));
        }
        if (error) throw error;

        // Refresh in-memory map and re-render
        await loadUnitCodes();
        populateUnitFilter(getVal('filterVehicle') || null);
        refreshAllViews();
        closeUcForm();
        loadUcTable();
        showToast('Unit code saved.', 'success');
    } catch (e) {
        errEl.textContent = e.message;
    }
}

async function deleteUnitCode(id) {
    if (!confirm('Delete this unit?')) return;
    try {
        const table = isF100KD2Module() ? 'f100_vehicle_units' : isKD2Module() ? 'kd2_vehicle_units' : 'vehicle_units';
        const { error } = await db.from(table).delete().eq('id', id);
        if (error) throw error;
        if (!isF100KD2Module()) {
            await loadUnitCodes();
            populateUnitFilter(getVal('filterVehicle') || null);
            refreshAllViews();
        }
        loadUcTable();
        showToast(isF100KD2Module() ? 'F100 unit deleted.' : isKD2Module() ? 'KD2 unit code deleted.' : 'Unit code deleted.', 'success');
    } catch (e) {
        showToast('Delete failed: ' + e.message, 'error');
    }
}

function openUserMgmt() {
    document.getElementById('userMgmtOverlay').style.display = 'flex';
    loadUserList();
    loadExportPermList();
    _populateExportPermUserSelect();
}

async function _populateExportPermUserSelect() {
    const sel = document.getElementById('exportPermUserSelect');
    if (!sel || !db) return;
    try {
        const { data } = await db.from('planning_app_users')
            .select('email, full_name')
            .eq('is_active', true)
            .order('full_name', { ascending: true });
        sel.innerHTML = '<option value="">— Select a user —</option>' +
            (data || []).map(u =>
                `<option value="${u.email}">${u.full_name ? `${u.full_name} (${u.email})` : u.email}</option>`
            ).join('');
    } catch { /* silently skip */ }
}
function closeUserMgmt() {
    document.getElementById('userMgmtOverlay').style.display = 'none';
    closeUserForm();
}

async function loadUserList() {
    const tbody = document.getElementById('umTableBody');
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty"><div class="empty-state"><span class="spinner"></span><p>Loading…</p></div></td></tr>`;

    const { data: users, error } = await db
        .from('planning_app_users')
        .select('id,email,full_name,role,is_active,created_at')
        .order('created_at', { ascending: true });

    if (error) {
        tbody.innerHTML = `<tr><td colspan="6" class="table-empty"><div class="empty-state"><p>Error loading users.</p></div></td></tr>`;
        return;
    }

    document.getElementById('umUserCount').textContent =
        `${users.length} user${users.length !== 1 ? 's' : ''}`;

    const currentUserId = getCurrentUser()?.id;

    tbody.innerHTML = users.map(u => {
        const isMe = u.id === currentUserId;
        return `
    <tr>
      <td><strong>${esc(u.full_name)}</strong>${isMe ? ' <span style="font-size:.68rem;color:var(--clr-accent)">(you)</span>' : ''}</td>
      <td class="mono" style="font-size:.8rem">${esc(u.email)}</td>
      <td><span class="role-pill ${u.role}">${u.role.replace('_', ' ')}</span></td>
      <td><span class="status-pill ${u.is_active ? 'active' : 'inactive'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
      <td class="mono" style="font-size:.75rem;color:var(--clr-text-muted)">${new Date(u.created_at).toLocaleDateString('en-GB')}</td>
      <td>
        <div class="um-action-cell">
          <button class="btn-um-edit" onclick="openUserForm('${u.id}')">Edit</button>
          ${!isMe ? `<button class="btn-um-del" onclick="deleteUser('${u.id}','${esc(u.full_name)}')">Delete</button>` : ''}
        </div>
      </td>
    </tr>`;
    }).join('');
}

async function openUserForm(userId) {
    const form = document.getElementById('umForm');
    form.style.display = '';
    document.getElementById('umFormTitle').textContent = userId ? 'Edit User' : 'Add New User';
    document.getElementById('umEditId').value = userId || '';
    document.getElementById('umFullName').value = '';
    document.getElementById('umEmail').value = '';
    document.getElementById('umRole').value = 'viewer';
    document.getElementById('umPassword').value = '';
    document.getElementById('umActive').value = 'true';
    document.getElementById('umFormError').textContent = '';

    const hint = document.getElementById('umPasswordHint');
    if (hint) hint.style.display = userId ? 'inline' : 'none';

    if (userId) {
        const { data } = await db.from('planning_app_users').select('*').eq('id', userId).maybeSingle();
        if (data) {
            document.getElementById('umFullName').value = data.full_name;
            document.getElementById('umEmail').value = data.email;
            document.getElementById('umRole').value = data.role;
            document.getElementById('umActive').value = String(data.is_active);
        }
    }

    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeUserForm() {
    document.getElementById('umForm').style.display = 'none';
}

async function saveUser() {
    const userId = document.getElementById('umEditId').value;
    const fullName = document.getElementById('umFullName').value.trim();
    const email = document.getElementById('umEmail').value.trim().toLowerCase();
    const role = document.getElementById('umRole').value;
    const password = document.getElementById('umPassword').value;
    const isActive = document.getElementById('umActive').value === 'true';
    const errEl = document.getElementById('umFormError');
    errEl.textContent = '';

    if (!fullName || !email) { errEl.textContent = 'Name and email are required.'; return; }
    if (!userId && !password) { errEl.textContent = 'Password is required for new users.'; return; }

    const payload = { full_name: fullName, email, role, is_active: isActive, updated_at: new Date().toISOString() };
    if (password) payload.password_hash = await sha256(password);

    try {
        if (userId) {
            const { data: before } = await db.from('planning_app_users').select('*').eq('id', userId).maybeSingle();
            const { error } = await db.from('planning_app_users').update(payload).eq('id', userId);
            if (error) throw error;
            const { data: after } = await db.from('planning_app_users').select('id,email,full_name,role,is_active').eq('id', userId).maybeSingle();
            const safeBefore = { ...before }; delete safeBefore.password_hash;
            const safeAfter = { ...after }; delete safeAfter.password_hash;
            await auditLog('UPDATE', 'planning_app_users', userId, safeBefore, safeAfter);
            showToast('User updated.', 'success');
        } else {
            payload.created_at = new Date().toISOString();
            const { data: inserted, error } = await db.from('planning_app_users').insert(payload).select('id,email,full_name,role').single();
            if (error) throw error;
            await auditLog('INSERT', 'planning_app_users', inserted.id, null,
                { email: inserted.email, full_name: inserted.full_name, role: inserted.role });
            showToast('User created.', 'success');
        }
        closeUserForm();
        loadUserList();
    } catch (e) {
        errEl.textContent = e.message?.includes('duplicate') ? 'Email already exists.' : (e.message || 'Save failed.');
    }
}

async function deleteUser(userId, name) {
    if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    const { data: before } = await db.from('planning_app_users')
        .select('id,email,full_name,role').eq('id', userId).maybeSingle();
    const { error } = await db.from('planning_app_users').delete().eq('id', userId);
    if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
    await auditLog('DELETE', 'planning_app_users', userId, before, null);
    showToast(`User "${name}" deleted.`, 'success');
    loadUserList();
}

/* ================================================================
   AUDIT LOG VIEWER  (master_admin only)
   ================================================================ */
let _auditTotal = 0;
const _diffStore = {};

async function openAuditLog() {
    document.getElementById('auditLogOverlay').style.display = 'flex';
    _auditLogOffset = 0;
    await populateAuditUserFilter();
    loadAuditLog(true);
}

async function populateAuditUserFilter() {
    const sel = document.getElementById('alFilterUser');
    if (!sel || sel.options.length > 1) return; // already populated
    try {
        const { data } = await db.from('planning_app_users').select('email, full_name').order('email');
        (data || []).forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.email;
            opt.textContent = u.full_name ? `${u.full_name} (${u.email})` : u.email;
            sel.appendChild(opt);
        });
    } catch (_) {}
}
function closeAuditLog() {
    document.getElementById('auditLogOverlay').style.display = 'none';
}

const AL_TABLE_LABELS = {
    kd2_plan: 'KD2 Plan', kd2_progress: 'KD2 Progress', kd2_battalions: 'KD2 Battalions',
    assembly_plan: 'F100 Plan', assembly_progress: 'F100 Progress', f100_plans: 'F100 Plans',
    planning_app_users: 'Users',
};

function resetAuditFilters() {
    document.getElementById('alFilterAction').value = '';
    document.getElementById('alFilterTable').value = '';
    const alUser = document.getElementById('alFilterUser'); if (alUser) alUser.selectedIndex = 0;
    document.getElementById('alFilterDateFrom').value = '';
    document.getElementById('alFilterDateTo').value = '';
    _auditLogOffset = 0;
    loadAuditLog(true);
}

async function loadAuditLog(reset = false) {
    if (reset) _auditLogOffset = 0;

    const action   = document.getElementById('alFilterAction')?.value || '';
    const table    = document.getElementById('alFilterTable')?.value || '';
    const user     = document.getElementById('alFilterUser')?.value?.trim() || '';
    const dateFrom = document.getElementById('alFilterDateFrom')?.value || '';
    const dateTo   = document.getElementById('alFilterDateTo')?.value || '';
    const tbody    = document.getElementById('alTableBody');

    if (reset) {
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><div class="empty-state"><span class="spinner"></span><p>Loading…</p></div></td></tr>`;
    }

    let query = db
        .from('planning_audit_log')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(_auditLogOffset, _auditLogOffset + AUDIT_PAGE_SIZE - 1);

    if (action)   query = query.eq('action', action);
    if (table)    query = query.eq('table_name', table);
    if (user)     query = query.eq('user_email', user);
    if (dateFrom) query = query.gte('created_at', dateFrom + 'T00:00:00');
    if (dateTo)   query = query.lte('created_at', dateTo   + 'T23:59:59');

    const { data, count, error } = await query;

    if (error) {
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><div class="empty-state"><p>Error: ${esc(error.message)}</p></div></td></tr>`;
        return;
    }

    _auditTotal = count || 0;
    const countEl = document.getElementById('alEntryCount');
    if (countEl) countEl.textContent = `${_auditTotal.toLocaleString()} entr${_auditTotal === 1 ? 'y' : 'ies'}`;

    const rows = (data || []).map((entry, idx) => {
        const hasDiff = entry.data_before || entry.data_after;
        const dt = new Date(entry.created_at);
        const rowId = `al-row-${_auditLogOffset + idx}`;
        if (hasDiff) _diffStore[rowId] = { before: entry.data_before, after: entry.data_after };
        const moduleLabel = AL_TABLE_LABELS[entry.table_name] || entry.table_name || '—';
        const role = entry.user_role || 'viewer';
        return `
    <tr id="${rowId}">
      <td class="mono al-cell-date">${dt.toLocaleDateString('en-GB')} <span class="al-time">${dt.toLocaleTimeString('en-GB', { hour12: false })}</span></td>
      <td class="al-cell-user" title="${esc(entry.user_email || '')}">${esc(entry.user_email || '—')}</td>
      <td><span class="role-pill ${role}">${role.replace(/_/g, ' ')}</span></td>
      <td><span class="al-action ${entry.action}">${entry.action}</span></td>
      <td class="al-cell-module">${esc(moduleLabel)}</td>
      <td class="mono al-cell-record" title="${esc(entry.record_id || '')}">${esc(entry.record_id || '—')}</td>
      <td class="mono al-cell-ip">${esc(entry.ip_address || '—')}</td>
      <td>${hasDiff
            ? `<button class="al-diff-btn" onclick="toggleDiff(this,'${rowId}')">View changes</button>`
            : '<span class="al-no-diff">—</span>'}</td>
    </tr>`;
    });

    if (reset) {
        tbody.innerHTML = rows.join('') ||
            `<tr><td colspan="8" class="table-empty"><div class="empty-state"><p>No audit entries match the filters.</p></div></td></tr>`;
    } else {
        rows.forEach(r => tbody.insertAdjacentHTML('beforeend', r));
    }

    _auditLogOffset += (data?.length || 0);

    const moreBtn = document.getElementById('btnAlMore');
    if (moreBtn) {
        moreBtn.style.display = (_auditLogOffset < _auditTotal) ? '' : 'none';
        moreBtn.onclick = () => loadAuditLog(false);
    }
}

function toggleDiff(btn, rowId) {
    const existing = document.getElementById('diff-' + rowId);
    if (existing) { existing.remove(); btn.textContent = 'View changes'; return; }

    btn.textContent = 'Hide changes';
    const { before, after } = _diffStore[rowId] || {};
    const tr = document.getElementById(rowId);
    const diffRow = document.createElement('tr');
    diffRow.id = 'diff-' + rowId;
    diffRow.className = 'al-diff-row';

    const allKeys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
    const changed = allKeys.filter(k => JSON.stringify((before || {})[k]) !== JSON.stringify((after || {})[k]));
    const unchanged = allKeys.filter(k => !changed.includes(k));

    const renderVal = v => v === null ? '<em class="al-diff-null">null</em>'
        : v === undefined ? '<em class="al-diff-null">—</em>'
        : `<span>${esc(typeof v === 'object' ? JSON.stringify(v) : String(v))}</span>`;

    const fieldRows = [
        ...changed.map(k => `
            <tr class="al-diff-field al-diff-field--changed">
                <td class="al-diff-key">${esc(k)}</td>
                <td class="al-diff-old">${renderVal((before || {})[k])}</td>
                <td class="al-diff-arrow">→</td>
                <td class="al-diff-new">${renderVal((after || {})[k])}</td>
            </tr>`),
        ...unchanged.map(k => `
            <tr class="al-diff-field">
                <td class="al-diff-key al-diff-key--unchanged">${esc(k)}</td>
                <td class="al-diff-unchanged" colspan="3">${renderVal((before || after || {})[k])}</td>
            </tr>`),
    ].join('');

    diffRow.innerHTML = `
    <td colspan="8" style="padding:0">
      <div class="al-diff-wrap">
        <div class="al-diff-header">
          <span class="al-diff-badge al-diff-badge--changed">${changed.length} field${changed.length !== 1 ? 's' : ''} changed</span>
          ${unchanged.length ? `<span class="al-diff-badge al-diff-badge--same">${unchanged.length} unchanged</span>` : ''}
        </div>
        <div class="al-diff-table-wrap">
          <table class="al-diff-table">
            <thead><tr><th>Field</th><th>Before</th><th></th><th>After</th></tr></thead>
            <tbody>${fieldRows || '<tr><td colspan="4" style="padding:8px;color:var(--clr-text-dim);font-style:italic">No field data recorded</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </td>`;
    tr.insertAdjacentElement('afterend', diffRow);
}

/* ─── Audit log export helpers ──────────────────────────────────── */
async function fetchAllAuditRows() {
    const action   = document.getElementById('alFilterAction')?.value || '';
    const table    = document.getElementById('alFilterTable')?.value || '';
    const user     = document.getElementById('alFilterUser')?.value || '';
    const dateFrom = document.getElementById('alFilterDateFrom')?.value || '';
    const dateTo   = document.getElementById('alFilterDateTo')?.value || '';

    let query = db.from('planning_audit_log').select('*').order('created_at', { ascending: false });
    if (action)   query = query.eq('action', action);
    if (table)    query = query.eq('table_name', table);
    if (user)     query = query.eq('user_email', user);
    if (dateFrom) query = query.gte('created_at', dateFrom + 'T00:00:00');
    if (dateTo)   query = query.lte('created_at', dateTo   + 'T23:59:59');

    const { data, error } = await query;
    if (error) { showToast('Export failed: ' + error.message, 'error'); return null; }
    return data || [];
}

async function exportAuditLogExcel() {
    if (!window.XLSX) { showToast('Excel library not loaded — please refresh.', 'error'); return; }
    showToast('Preparing Excel export…', 'info');
    const rows = await fetchAllAuditRows();
    if (!rows) return;

    const wsData = [
        ['Date / Time', 'User', 'Role', 'Action', 'Module', 'Record ID', 'IP Address', 'Fields Changed'],
        ...rows.map(r => {
            const dt = new Date(r.created_at);
            const changed = (() => {
                if (!r.data_before && !r.data_after) return '';
                const b = r.data_before || {}, a = r.data_after || {};
                const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
                return keys.filter(k => JSON.stringify(b[k]) !== JSON.stringify(a[k])).join(', ');
            })();
            return [
                dt.toLocaleDateString('en-GB') + ' ' + dt.toLocaleTimeString('en-GB', { hour12: false }),
                r.user_email || '—',
                (r.user_role || '').replace(/_/g, ' '),
                r.action || '—',
                AL_TABLE_LABELS[r.table_name] || r.table_name || '—',
                r.record_id || '—',
                r.ip_address || '—',
                changed,
            ];
        }),
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Log');
    const now = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `audit_log_${now}.xlsx`);
    showToast('Excel exported.', 'success');
}

async function exportAuditLogPDF() {
    if (!window.jspdf) { showToast('PDF library not loaded — please refresh.', 'error'); return; }
    showToast('Preparing PDF export…', 'info');
    const rows = await fetchAllAuditRows();
    if (!rows) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const PAGE_W = doc.internal.pageSize.getWidth();
    const MARGIN = 14;
    const now = new Date().toLocaleString('en-GB');

    doc.setFillColor(30, 58, 138);
    doc.rect(0, 0, PAGE_W, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Audit Log', MARGIN, 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(186, 230, 253);
    doc.text(`Generated: ${now}   ·   ${rows.length.toLocaleString()} entries`, PAGE_W - MARGIN, 16, { align: 'right' });

    const headers = ['Date / Time', 'User', 'Role', 'Action', 'Module', 'Record', 'IP Address'];
    const body = rows.map(r => {
        const dt = new Date(r.created_at);
        return [
            dt.toLocaleDateString('en-GB') + '\n' + dt.toLocaleTimeString('en-GB', { hour12: false }),
            r.user_email || '—',
            (r.user_role || '').replace(/_/g, ' '),
            r.action || '—',
            AL_TABLE_LABELS[r.table_name] || r.table_name || '—',
            r.record_id || '—',
            r.ip_address || '—',
        ];
    });

    const ACTION_COLORS = { LOGIN: [59,130,246], LOGOUT: [148,163,184], INSERT: [34,197,94], UPDATE: [245,158,11], DELETE: [239,68,68], BOOTSTRAP: [139,92,246] };

    doc.autoTable({
        startY: 24,
        head: [headers], body,
        margin: { left: MARGIN, right: MARGIN },
        styles: { fontSize: 7, cellPadding: 2, font: 'helvetica', textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.2 },
        headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.5, halign: 'center' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
            0: { cellWidth: 26 }, 1: { cellWidth: 50 }, 2: { cellWidth: 20 },
            3: { cellWidth: 18, halign: 'center' }, 4: { cellWidth: 22 },
            5: { cellWidth: 22 }, 6: { cellWidth: 22 },
        },
        didDrawCell(data) {
            if (data.section !== 'body' || data.column.index !== 3) return;
            const action = String(data.cell.raw || '');
            const [r, g, b] = ACTION_COLORS[action] || [100, 116, 139];
            data.doc.setFillColor(r, g, b, 0.15);
            data.doc.roundedRect(data.cell.x + 1, data.cell.y + 1, data.cell.width - 2, data.cell.height - 2, 1, 1, 'F');
            data.doc.setTextColor(r, g, b);
            data.doc.setFont('helvetica', 'bold');
            data.doc.setFontSize(6.5);
            data.doc.text(action, data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2 + 0.5, { align: 'center' });
        },
    });

    const exportDate = new Date().toISOString().slice(0, 10);
    doc.save(`audit_log_${exportDate}.pdf`);
    showToast('PDF exported.', 'success');
}

/* ================================================================
   PRODUCTION ISSUES
   ================================================================ */

let _issuesOffset = 0;
const ISSUES_PAGE_SIZE = 50;
let _issuesTotalCount = 0;

const ISSUE_CATEGORY_LABELS = {
    cutting: 'Cutting',
    part_machining: 'Part Machining',
    welding: 'Welding',
    machining: 'Machining',
    accessories: 'Accessories',
    cables: 'Cables',
    material: 'Material',
    assembly: 'Assembly',
    quality: 'Quality',
    other: 'Other',
};

function formatIssueDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function renderIssueStatusBadge(status) {
    const map = {
        open: ['Open', 'issue-status--open'],
        in_progress: ['In Progress', 'issue-status--in-progress'],
        resolved: ['Resolved', 'issue-status--resolved'],
        closed: ['Closed', 'issue-status--closed'],
    };
    const [label, cls] = map[status] || [status || '—', ''];
    return `<span class="issue-status-badge ${cls}">${esc(label)}</span>`;
}

function renderIssuePriorityBadge(priority) {
    const map = {
        low: ['Low', 'issue-priority--low'],
        medium: ['Medium', 'issue-priority--medium'],
        high: ['High', 'issue-priority--high'],
        critical: ['Critical', 'issue-priority--critical'],
    };
    const [label, cls] = map[priority] || [priority || '—', ''];
    return `<span class="issue-priority-badge ${cls}">${esc(label)}</span>`;
}

function renderIssueCategoryBadge(category) {
    const label = ISSUE_CATEGORY_LABELS[category] || category || '—';
    return `<span class="issue-category-badge">${esc(label)}</span>`;
}

function renderIssueRow(issue, idx) {
    const u = getCurrentUser();
    // Only the original reporter may edit — no exceptions for admins
    const canEdit = !!(issue.reporter_email && u?.email && issue.reporter_email === u.email);

    return `
    <tr data-issue-id="${issue.id}">
        <td class="issues-col-idx" style="text-align:center;color:var(--clr-text-muted);font-size:.78rem">${idx + 1}</td>
        <td class="issues-col-title">
            <span class="issue-title-cell" title="${esc(issue.title || '')}" onclick="openIssueView(${issue.id})">${esc(issue.title || '—')}</span>
        </td>
        <td class="issues-col-cat">${renderIssueCategoryBadge(issue.category)}</td>
        <td class="issues-col-pri" style="text-align:center">${renderIssuePriorityBadge(issue.priority)}</td>
        <td class="issues-col-status" style="text-align:center">${renderIssueStatusBadge(issue.status)}</td>
        <td class="issues-col-reporter">
            <span class="issue-reporter-name">${esc(issue.reporter_name || '—')}</span>
            <span class="issue-reporter-email" title="${esc(issue.reporter_email || '')}">${esc(issue.reporter_email || '')}</span>
        </td>
        <td class="issues-col-date mono" style="font-size:.78rem">${formatIssueDate(issue.created_at)}</td>
        <td class="issues-col-date mono" style="font-size:.78rem">${formatIssueDate(issue.updated_at)}</td>
        <td class="issues-col-actions">
            <div style="display:flex;gap:4px;justify-content:center">
                <button class="btn btn-ghost btn-sm" onclick="openIssueView(${issue.id})" style="font-size:.74rem;padding:3px 8px">View</button>
                ${canEdit ? `<button class="btn btn-ghost btn-sm" onclick="openIssueModal(${issue.id})" style="font-size:.74rem;padding:3px 8px">Edit</button>` : ''}
            </div>
        </td>
    </tr>`;
}

async function initIssuesSection() {
    const addBtn = document.getElementById('btnAddIssue');
    if (addBtn) addBtn.style.display = isPlanner() ? '' : 'none';

    // These three reads are independent — fire them concurrently instead of
    // waiting on each round-trip in turn (was 3-4x slower than the plan table,
    // which issues a single query).
    await Promise.all([
        _issueNotifUpdateBadge(),
        _populateIssueReporterFilter(),
        loadIssues(true),
    ]);
    _issueNotifClearBadge();
}

async function loadIssuesOverview() {
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    try {
        const { data, error } = await db
            .from('production_issues')
            .select('status, priority')
            .eq('module', getActiveModuleId());
        if (error) throw error;

        let open = 0, inProgress = 0, resolved = 0, critical = 0;
        (data || []).forEach(r => {
            if (r.status === 'open') open++;
            else if (r.status === 'in_progress') inProgress++;
            else if (r.status === 'resolved') resolved++;
            if ((r.status === 'open' || r.status === 'in_progress') && (r.priority === 'high' || r.priority === 'critical')) critical++;
        });

        setVal('issueOvOpen', open);
        setVal('issueOvInProgress', inProgress);
        setVal('issueOvResolved', resolved);
        setVal('issueOvCritical', critical);
    } catch (_) {
        // Overview is a soft-fail summary — leave existing values on error
    }
}

async function _populateReporterSelect(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel || sel.options.length > 1) return;
    try {
        const { data } = await db
            .from('production_issues')
            .select('reporter_email, reporter_name')
            .eq('module', getActiveModuleId())
            .order('reporter_email')
            .limit(1000);
        const seen = new Set();
        (data || []).forEach(r => {
            if (seen.has(r.reporter_email)) return;
            seen.add(r.reporter_email);
            const opt = document.createElement('option');
            opt.value = r.reporter_email;
            opt.textContent = r.reporter_name
                ? `${r.reporter_name} (${r.reporter_email})`
                : r.reporter_email;
            sel.appendChild(opt);
        });
    } catch (_) {}
}
async function _populateIssueReporterFilter() {
    return _populateReporterSelect('issueFilterReporter');
}

async function loadIssues(reset = false) {
    if (reset) { _issuesOffset = 0; loadIssuesOverview().catch(() => {}); }

    const search   = (document.getElementById('issueSearch')?.value || '').trim();
    const category = document.getElementById('issueFilterCategory')?.value || '';
    const status   = document.getElementById('issueFilterStatus')?.value || '';
    const priority = document.getElementById('issueFilterPriority')?.value || '';
    const reporter = document.getElementById('issueFilterReporter')?.value || '';
    const from     = document.getElementById('issueFilterFrom')?.value || '';
    const to       = document.getElementById('issueFilterTo')?.value || '';
    const tbody    = document.getElementById('issuesTableBody');

    if (reset && tbody) {
        tbody.innerHTML = `<tr><td colspan="9" class="table-empty"><div class="empty-state"><span class="spinner"></span><p>Loading…</p></div></td></tr>`;
    }

    // Narrow column list — description/proposed_solution/notes/person_in_charge
    // aren't shown in the row and are fetched fresh (select('*')) when a row is
    // opened; 'estimated' count avoids forcing an exact-count table scan.
    let query = db
        .from('production_issues')
        .select('id, title, category, priority, status, reporter_name, reporter_email, created_at, updated_at', { count: 'estimated' })
        .eq('module', getActiveModuleId())
        .order('created_at', { ascending: true })
        .range(_issuesOffset, _issuesOffset + ISSUES_PAGE_SIZE - 1);

    if (search) {
        query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }
    if (category) query = query.eq('category', category);
    if (status)   query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (reporter) query = query.eq('reporter_email', reporter);
    if (from)     query = query.gte('created_at', from + 'T00:00:00');
    if (to)       query = query.lte('created_at', to + 'T23:59:59');

    const { data, count, error } = await query;

    if (error) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="table-empty"><div class="empty-state"><p>Error: ${esc(error.message)}</p></div></td></tr>`;
        showToast('Failed to load issues: ' + error.message, 'error');
        return;
    }

    _issuesTotalCount = count || 0;

    const countEl = document.getElementById('issueCount');
    if (countEl) countEl.textContent = `${_issuesTotalCount.toLocaleString()} issue${_issuesTotalCount !== 1 ? 's' : ''}`;

    const startIdx = _issuesOffset;
    const rows = (data || []).map((issue, i) => renderIssueRow(issue, startIdx + i));

    if (reset) {
        if (tbody) {
            tbody.innerHTML = rows.join('') ||
                `<tr><td colspan="9" class="table-empty"><div class="empty-state"><p>No issues match the current filters.</p></div></td></tr>`;
        }
    } else {
        if (tbody) rows.forEach(r => tbody.insertAdjacentHTML('beforeend', r));
    }

    _issuesOffset += (data?.length || 0);

    const moreBtn = document.getElementById('btnIssuesMore');
    if (moreBtn) {
        moreBtn.style.display = (_issuesOffset < _issuesTotalCount) ? '' : 'none';
        moreBtn.onclick = () => loadIssues(false);
    }
}

function resetIssueFilters() {
    ['issueSearch', 'issueFilterCategory', 'issueFilterStatus', 'issueFilterPriority', 'issueFilterReporter', 'issueFilterFrom', 'issueFilterTo'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.tagName === 'SELECT') el.selectedIndex = 0;
        else el.value = '';
    });
    loadIssues(true);
}

function _setIssueField(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    if ('value' in el) el.value = val ?? '';
    else el.textContent = val ?? '—';
}

/* ── Issue drafts — local-only autosave so a new issue survives an
   accidental tab close before it's reported. Multiple drafts supported,
   per user + module, stored in localStorage (same convention as
   _issueNotifSeenKey/_issueNotifSnapKey). Drafts never touch the server —
   they only become visible to other users once actually reported. ── */
const ISSUE_DRAFT_FIELD_IDS = ['issueTitle', 'issueCategory', 'issuePriority', 'issueStatus',
    'issuePIC', 'issueDescription', 'issueProposedSolution', 'issueNotes'];
let _currentIssueDraftId = null;
let _issueDraftAutosaveTimer = null;

function _issueDraftsKey() {
    const u = getCurrentUser();
    return `ppms_issue_drafts_${getActiveModuleId()}_${u?.email || 'anon'}`;
}

function _loadIssueDrafts() {
    try { return JSON.parse(localStorage.getItem(_issueDraftsKey()) || '[]'); } catch { return []; }
}

function _saveIssueDraftsList(list) {
    try { localStorage.setItem(_issueDraftsKey(), JSON.stringify(list)); } catch {}
}

function _readIssueDraftFromForm() {
    const draft = { id: _currentIssueDraftId, updated_at: new Date().toISOString() };
    ISSUE_DRAFT_FIELD_IDS.forEach(id => { draft[id] = document.getElementById(id)?.value || ''; });
    return draft;
}

function _isIssueDraftEmpty(draft) {
    return !draft.issueTitle?.trim() && !draft.issueCategory && !draft.issueDescription?.trim()
        && !draft.issueProposedSolution?.trim() && !draft.issueNotes?.trim() && !draft.issuePIC?.trim();
}

function _deleteIssueDraft(draftId) {
    if (!draftId) return;
    _saveIssueDraftsList(_loadIssueDrafts().filter(d => d.id !== draftId));
    _updateIssueDraftsBadge();
}

/** Immediate (non-debounced) save of the currently-open new-issue form
 *  into its draft slot — used by the debounced autosave and as a safety
 *  flush on tab close / visibility change. */
function _flushIssueDraft() {
    if (!_currentIssueDraftId) return;
    const overlay = document.getElementById('issueModalOverlay');
    if (!overlay || overlay.style.display === 'none' || overlay.dataset.editId || overlay.dataset.viewMode === '1') return;

    const draft = _readIssueDraftFromForm();
    const list = _loadIssueDrafts();
    const idx = list.findIndex(d => d.id === _currentIssueDraftId);

    if (_isIssueDraftEmpty(draft)) {
        if (idx !== -1) { list.splice(idx, 1); _saveIssueDraftsList(list); _updateIssueDraftsBadge(); }
        return;
    }
    if (idx !== -1) list[idx] = draft; else list.push(draft);
    _saveIssueDraftsList(list);
    _updateIssueDraftsBadge();

    const statusEl = document.getElementById('issueDraftStatus');
    if (statusEl) {
        statusEl.textContent = 'Draft saved';
        statusEl.classList.add('is-visible');
        clearTimeout(statusEl._hideTimer);
        statusEl._hideTimer = setTimeout(() => statusEl.classList.remove('is-visible'), 1800);
        statusEl.style.display = '';
    }
}

function _autoSaveIssueDraft() {
    clearTimeout(_issueDraftAutosaveTimer);
    _issueDraftAutosaveTimer = setTimeout(_flushIssueDraft, 600);
}

function _updateIssueDraftsBadge() {
    const badge = document.getElementById('issueDraftsBadge');
    if (!badge) return;
    const count = _loadIssueDrafts().length;
    badge.textContent = String(count);
    badge.style.display = count > 0 ? '' : 'none';
}

function _newIssueDraftId() {
    return (crypto?.randomUUID ? crypto.randomUUID() : `draft_${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

function openIssueDraftsList() {
    const overlay = document.getElementById('issueDraftsModalOverlay');
    const listEl = document.getElementById('issueDraftsList');
    if (!overlay || !listEl) return;

    const drafts = _loadIssueDrafts().sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    listEl.innerHTML = drafts.length
        ? drafts.map(d => `
            <div class="issue-draft-row" data-draft-id="${esc(d.id)}">
                <div class="issue-draft-row-body">
                    <div class="issue-draft-row-title">${esc(d.issueTitle?.trim() || 'Untitled draft')}</div>
                    <div class="issue-draft-row-meta">${esc(ISSUE_CATEGORY_LABELS[d.issueCategory] || d.issueCategory || 'No category')} &middot; Saved ${esc(formatIssueDate(d.updated_at))}</div>
                </div>
                <div class="issue-draft-row-actions">
                    <button class="btn btn-primary btn-sm" data-draft-action="resume">Resume</button>
                    <button class="btn btn-ghost btn-sm btn-kd2-danger" data-draft-action="delete">Delete</button>
                </div>
            </div>`).join('')
        : `<div class="issue-drafts-empty">No saved drafts.</div>`;

    overlay.style.display = 'flex';
}

function wireIssueDraftsModal() {
    const overlay = document.getElementById('issueDraftsModalOverlay');
    if (!overlay) return;
    const close = () => { overlay.style.display = 'none'; };
    document.getElementById('issueDraftsModalClose')?.addEventListener('click', close);
    document.getElementById('issueDraftsModalCancel')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    document.getElementById('issueDraftsList')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-draft-action]');
        if (!btn) return;
        const row = btn.closest('.issue-draft-row');
        const draftId = row?.dataset.draftId;
        if (!draftId) return;

        if (btn.dataset.draftAction === 'delete') {
            _deleteIssueDraft(draftId);
            row.remove();
            if (!document.querySelector('.issue-draft-row')) {
                document.getElementById('issueDraftsList').innerHTML = `<div class="issue-drafts-empty">No saved drafts.</div>`;
            }
        } else if (btn.dataset.draftAction === 'resume') {
            const draft = _loadIssueDrafts().find(d => d.id === draftId);
            if (draft) { close(); openIssueModal(null, draft); }
        }
    });
}

async function openIssueModal(id = null, resumeDraft = null) {
    const overlay = document.getElementById('issueModalOverlay');
    if (!overlay) { console.warn('issueModalOverlay not found'); return; }

    const titleEl  = document.getElementById('issueModalTitleText');
    const deleteBtn = document.getElementById('btnIssueDelete');
    const errEl    = document.getElementById('issueFormError');

    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    if (id === null) {
        overlay.dataset.editId = '';
        if (titleEl) titleEl.textContent = resumeDraft ? 'Report Issue (Draft)' : 'Report Issue';
        if (deleteBtn) deleteBtn.style.display = 'none';

        const u = getCurrentUser();
        _setIssueField('issueReporterName',  u?.name  || u?.full_name || '');
        _setIssueField('issueReporterEmail', u?.email || '');
        _setIssueField('issueTitle',            resumeDraft?.issueTitle || '');
        _setIssueField('issueCategory',         resumeDraft?.issueCategory || '');
        _setIssueField('issuePriority',         resumeDraft?.issuePriority || 'medium');
        _setIssueField('issueStatus',           resumeDraft?.issueStatus || 'open');
        _setIssueField('issueDescription',      resumeDraft?.issueDescription || '');
        _setIssueField('issueProposedSolution', resumeDraft?.issueProposedSolution || '');
        _setIssueField('issueNotes',            resumeDraft?.issueNotes || '');
        _setIssueField('issuePIC',              resumeDraft?.issuePIC || '');

        _currentIssueDraftId = resumeDraft?.id || _newIssueDraftId();
        const statusEl = document.getElementById('issueDraftStatus');
        if (statusEl) { statusEl.classList.remove('is-visible'); statusEl.style.display = 'none'; }
    } else {
        _currentIssueDraftId = null;
        const { data, error } = await db.from('production_issues').select('*').eq('id', id).single();
        if (error || !data) { showToast('Failed to load issue.', 'error'); return; }

        // Permission check — only the original reporter may edit
        const u = getCurrentUser();
        const canEdit = !!(data.reporter_email && u?.email && data.reporter_email === u.email);
        if (!canEdit) { showToast('You can only edit issues you reported.', 'error'); return; }

        overlay.dataset.editId = id;
        if (titleEl) titleEl.textContent = 'Edit Issue';

        const canDel = ['master_admin', 'admin'].includes(u?.role);
        if (deleteBtn) deleteBtn.style.display = canDel ? '' : 'none';

        _setIssueField('issueTitle',           data.title || '');
        _setIssueField('issueCategory',        data.category || '');
        _setIssueField('issuePriority',        data.priority || 'medium');
        _setIssueField('issueStatus',          data.status || 'open');
        _setIssueField('issueDescription',     data.description || '');
        _setIssueField('issueProposedSolution', data.proposed_solution || '');
        _setIssueField('issueNotes',           data.notes || '');
        _setIssueField('issuePIC',             data.person_in_charge || '');
        _setIssueField('issueReporterName',    data.reporter_name || '');
        _setIssueField('issueReporterEmail',   data.reporter_email || '');
    }

    overlay.style.display = 'flex';
}

/** If `error` names a column present in `payload` via either (a) Postgres
 *  42703 "undefined column", or (b) PostgREST's PGRST204 "Could not find the
 *  X column of Y in the schema cache" (raised when the column was added to
 *  app.js but the migration hasn't been run against this database yet),
 *  return payload with that column stripped so the caller can retry.
 *  Returns null for any other error (including errors that merely mention
 *  "column" in unrelated messages, e.g. constraint violations) so those
 *  aren't silently swallowed. */
function _stripUndefinedColumn(payload, error) {
    const msg = error?.message || '';
    let col = null;
    if (error?.code === '42703') {
        col = /column "([^"]+)"/.exec(msg)?.[1] || null;
    } else if (error?.code === 'PGRST204') {
        col = /Could not find the '([^']+)' column/.exec(msg)?.[1] || null;
    }
    if (!col || !(col in payload)) return null;
    const rest = { ...payload };
    delete rest[col];
    return rest;
}

async function saveIssue() {
    const overlay  = document.getElementById('issueModalOverlay');
    const editId   = overlay?.dataset?.editId || '';
    const errEl    = document.getElementById('issueFormError');

    const title    = document.getElementById('issueTitle')?.value?.trim() || '';
    const category = document.getElementById('issueCategory')?.value || '';
    const priority = document.getElementById('issuePriority')?.value || 'medium';
    const status   = document.getElementById('issueStatus')?.value || 'open';
    const description       = document.getElementById('issueDescription')?.value?.trim() || '';
    const proposed_solution = document.getElementById('issueProposedSolution')?.value?.trim() || '';
    const notes             = document.getElementById('issueNotes')?.value?.trim() || '';
    const person_in_charge  = document.getElementById('issuePIC')?.value?.trim() || '';

    // Validation
    if (!title) {
        if (errEl) { errEl.textContent = 'Title is required.'; errEl.style.display = ''; }
        document.getElementById('issueTitle')?.focus();
        return;
    }
    if (!category) {
        if (errEl) { errEl.textContent = 'Category is required.'; errEl.style.display = ''; }
        document.getElementById('issueCategory')?.focus();
        return;
    }
    if (errEl) errEl.style.display = 'none';

    const u = getCurrentUser();
    const saveBtn = document.getElementById('btnIssueSave');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    try {
        if (editId) {
            // Fetch before state for audit log
            const { data: beforeData } = await db.from('production_issues').select('*').eq('id', editId).single();
            const payload = {
                title, category, priority, status,
                description: description || null,
                proposed_solution: proposed_solution || null,
                notes: notes || null,
                person_in_charge: person_in_charge || null,
                updated_by_name:  u?.name  || u?.full_name || null,
                updated_by_email: u?.email || null,
                resolved_at: status === 'resolved' ? new Date().toISOString() : null,
            };
            let { error } = await db.from('production_issues').update(payload).eq('id', editId);
            if (error) {
                const retryPayload = _stripUndefinedColumn(payload, error);
                if (retryPayload) ({ error } = await db.from('production_issues').update(retryPayload).eq('id', editId));
            }
            if (error) throw error;
            auditLog('UPDATE', 'production_issues', editId, beforeData, payload);
            _broadcastIssueUpdated({ id: editId, title, category,
                reporter_name: beforeData?.reporter_name, reporter_email: beforeData?.reporter_email });
            showToast('Issue updated.', 'success');
        } else {
            const base = {
                title, category, priority, status,
                description: description || null,
                proposed_solution: proposed_solution || null,
                notes: notes || null,
                person_in_charge: person_in_charge || null,
                reporter_name:  u?.name  || u?.full_name || null,
                reporter_email: u?.email || 'unknown',
                updated_by_name:  null,
                updated_by_email: null,
                resolved_at: status === 'resolved' ? new Date().toISOString() : null,
            };

            // Try with module + PIC columns; drop whichever column the DB
            // reports as undefined (42703) and retry, up to a few rounds —
            // generalizes to any not-yet-migrated optional column.
            let insertError, insertedId;
            let payload = { ...base, module: getActiveModuleId() };
            for (let attempt = 0; attempt < 3; attempt++) {
                const r = await db.from('production_issues').insert(payload).select('id').single();
                if (!r.error) { insertedId = r.data?.id; insertError = null; break; }
                insertError = r.error;
                const retryPayload = _stripUndefinedColumn(payload, r.error);
                if (!retryPayload) break;
                payload = retryPayload;
            }
            if (insertError) throw insertError;
            auditLog('INSERT', 'production_issues', insertedId, null, { ...base, module: getActiveModuleId() });
            await _broadcastIssueNew({ id: insertedId, title, category, module: getActiveModuleId() });
            showToast('Issue reported.', 'success');
            // Now visible to everyone in the system — its local draft is done.
            clearTimeout(_issueDraftAutosaveTimer);
            _deleteIssueDraft(_currentIssueDraftId);
            _currentIssueDraftId = null;
        }

        if (overlay) overlay.style.display = 'none';
        const sel = document.getElementById('issueFilterReporter');
        if (sel) { while (sel.options.length > 1) sel.remove(1); }
        await _populateIssueReporterFilter();
        await loadIssues(true);
    } catch (err) {
        console.error('saveIssue error:', err);
        const msg = err?.message || String(err);
        if (errEl) { errEl.textContent = 'Error: ' + msg; errEl.style.display = ''; }
        showToast('Failed to save issue: ' + msg, 'error');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Issue'; }
    }
}

async function deleteIssue(id) {
    if (!confirm('Delete this issue? This cannot be undone.')) return;
    const overlay = document.getElementById('issueModalOverlay');
    const { data: beforeData } = await db.from('production_issues').select('*').eq('id', id).single();
    const { error } = await db.from('production_issues').delete().eq('id', id);
    if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
    auditLog('DELETE', 'production_issues', id, beforeData, null);
    _broadcastIssueDeleted(beforeData?.module || getActiveModuleId());
    showToast('Issue deleted.', 'success');
    if (overlay) overlay.style.display = 'none';
    await loadIssues(true);
}

async function openIssueView(id) {
    const overlay = document.getElementById('issueModalOverlay');
    if (!overlay) { console.warn('issueModalOverlay not found'); return; }

    const { data, error } = await db.from('production_issues').select('*').eq('id', id).single();
    if (error || !data) { showToast('Failed to load issue.', 'error'); return; }

    overlay.dataset.editId = '';
    overlay.dataset.viewMode = '1';

    // Header title
    const titleEl = document.getElementById('issueModalTitleText');
    if (titleEl) titleEl.textContent = 'Issue Details';

    // Footer: hide Save/Delete, show Edit (if authorized) + rename Cancel → Close
    document.getElementById('btnIssueDelete')?.style && (document.getElementById('btnIssueDelete').style.display = 'none');
    document.getElementById('btnIssueSave')?.style && (document.getElementById('btnIssueSave').style.display = 'none');
    const cancelBtn = document.getElementById('btnIssueCancel');
    if (cancelBtn) cancelBtn.textContent = 'Close';
    const editBtn = document.getElementById('btnIssueEdit');
    if (editBtn) {
        const u = getCurrentUser();
        const canEdit = !!(data.reporter_email && u?.email && data.reporter_email === u.email);
        editBtn.style.display = canEdit ? '' : 'none';
        editBtn.dataset.issueId = id;
    }

    // Show view panel, hide form
    document.getElementById('issueViewBody').style.display = '';
    document.querySelector('#issueModalOverlay .issue-modal-grid').style.display = 'none';
    document.getElementById('issueFormError').style.display = 'none';

    // Build view HTML
    const STATUS_LABELS   = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
    const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
    const statusLabel   = STATUS_LABELS[data.status]   || data.status   || '';
    const priorityLabel = PRIORITY_LABELS[data.priority] || data.priority || '';
    const categoryLabel = ISSUE_CATEGORY_LABELS[data.category] || data.category || '';
    const statusCls   = (data.status || 'open').replace('_', '-');
    const priorityCls = data.priority || 'medium';

    const infoItems = [
        { label: 'Reported by',  value: esc(data.reporter_name  || '—'), sub: esc(data.reporter_email || '') },
        { label: 'Reported on',  value: esc(formatIssueDate(data.created_at)) },
        { label: 'Last updated', value: esc(formatIssueDate(data.updated_at)),
          sub: data.updated_by_name ? `by ${esc(data.updated_by_name)}` : '' },
    ];
    if (data.resolved_at) infoItems.push({ label: 'Resolved on', value: esc(formatIssueDate(data.resolved_at)) });
    if (data.person_in_charge) infoItems.push({ label: 'Person in Charge', value: esc(data.person_in_charge) });

    const sections = [];
    if (data.description)        sections.push({ label: 'Description',       text: esc(data.description),        cls: '' });
    if (data.proposed_solution)  sections.push({ label: 'Proposed Solution', text: esc(data.proposed_solution),  cls: '' });
    if (data.notes)              sections.push({ label: 'Action Taken',       text: esc(data.notes),              cls: ' issue-view-section-text--notes' });

    document.getElementById('issueViewBody').innerHTML = `
        <div class="issue-view-meta-row">
            <span class="issue-status-badge issue-status--${statusCls}">${statusLabel}</span>
            <span class="issue-priority-badge issue-priority--${priorityCls}">${priorityLabel}</span>
            ${categoryLabel ? `<span class="issue-category-badge">${categoryLabel}</span>` : ''}
        </div>
        <p class="issue-view-title">${esc(data.title || '—')}</p>
        <div class="issue-view-info-row">
            ${infoItems.map(it => `
                <div class="issue-view-info-item">
                    <span class="issue-view-info-label">${it.label}</span>
                    <span class="issue-view-info-value">${it.value}</span>
                    ${it.sub ? `<span class="issue-view-info-sub">${it.sub}</span>` : ''}
                </div>`).join('')}
        </div>
        ${sections.length
            ? sections.map(s => `
                <div class="issue-view-section">
                    <div class="issue-view-section-label">${s.label}</div>
                    <div class="issue-view-section-text${s.cls}">${s.text}</div>
                </div>`).join('')
            : `<p class="issue-view-empty">No additional details provided.</p>`}
    `;

    overlay.style.display = 'flex';
}

function _closeIssueModal() {
    const overlay = document.getElementById('issueModalOverlay');
    if (!overlay) return;

    if (overlay.dataset.viewMode === '1') {
        // Restore form visibility
        const grid = document.querySelector('#issueModalOverlay .issue-modal-grid');
        if (grid) grid.style.display = '';
        const viewBody = document.getElementById('issueViewBody');
        if (viewBody) { viewBody.style.display = 'none'; viewBody.innerHTML = ''; }
        // Restore footer buttons
        const saveBtn   = document.getElementById('btnIssueSave');
        const editBtn   = document.getElementById('btnIssueEdit');
        const cancelBtn = document.getElementById('btnIssueCancel');
        if (saveBtn)   saveBtn.style.display = '';
        if (editBtn)   editBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.textContent = 'Cancel';
    }
    clearTimeout(_issueDraftAutosaveTimer);
    _flushIssueDraft(); // capture any edit made since the last debounced save
    _currentIssueDraftId = null;
    overlay.dataset.viewMode = '';
    overlay.dataset.editId = '';
    overlay.style.display = 'none';
}

/* ── Generic Word (.doc) export ──────────────────────────────────
   Wraps HTML in Word-recognised namespaces and saves it with the
   application/msword MIME type — Word/Google Docs open this natively,
   no docx-generation library required. */
const WORD_DOC_STYLE = `
    body { font-family: Calibri, Arial, sans-serif; font-size: 12pt; color: #1e293b; }
    h1 { font-size: 22pt; margin: 0 0 5px; color: #0f172a; }
    .doc-sub { font-size: 11pt; color: #64748b; margin: 0 0 18px; }
    h2 { font-size: 16.5pt; margin: 22px 0 8px; color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 4px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 10pt; text-align: left; vertical-align: top; }
    th { background: #1e3a5f; color: #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
    .doc-summary-table th, .doc-summary-table td { font-size: 10.5pt; }
    .issue-report-card { border: 1px solid #e2e8f0; border-left: 4px solid #1e3a8a; padding: 12px 18px; margin: 0 0 18px; }
    .issue-report-title { font-size: 15pt; font-weight: bold; margin: 0 0 4px; color: #0f172a; }
    .issue-report-byline { font-size: 11.5pt; font-style: italic; color: #64748b; margin: 0 0 10px; }
    .issue-report-sec-label { font-size: 12.5pt; font-weight: bold; margin: 0 0 2px; }
    .issue-report-sec-text { font-size: 12pt; margin: 0 0 10px; color: #334155; line-height: 1.4; }
    .issue-report-sec-issue { color: #0f172a; }
    .issue-report-sec-solution { color: #155e75; }
    .issue-report-sec-action { color: #15803d; }
    .issue-report-meta { font-size: 11pt; color: #64748b; margin: 10px 0 0; border-top: 1px solid #e2e8f0; padding-top: 6px; }
    .issue-report-pic { color: #b45309; font-weight: bold; }
`;

function exportHtmlAsWord(filename, titleText, bodyHtml, preview) {
    const doDownload = () => {
        const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><title>${esc(titleText)}</title>
<style>${WORD_DOC_STYLE}</style>
</head><body>${bodyHtml}</body></html>`;
        const blob = new Blob(['﻿', html], { type: 'application/msword' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Word document exported.', 'success');
    };
    if (preview) {
        _showGenericPreview({ title: titleText, kind: 'html', html: `<style>${WORD_DOC_STYLE}</style>${bodyHtml}`, onDownload: doDownload });
    } else {
        doDownload();
    }
}

/* ================================================================
   ISSUES — GENERATE REPORT POPUP (multi-type, Excel/PDF/Word)
   ================================================================ */

const ISSUE_REPORT_TYPE_LABELS = {
    all: 'All Issues', open: 'Open Issues', in_progress: 'In-Progress Issues',
    resolved: 'Resolved Issues', closed: 'Closed Issues',
    by_category: 'Issues by Category', status_report: 'Status Report',
};
const ISSUE_REPORT_MODULE_LABELS = { kd1: 'KD1', kd2: 'F200-KD2', f100kd2: 'F100-KD2' };
const ISSUE_REPORT_PERIOD_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', all_time: 'All Time' };

function _issueReportPeriodWindow(period) {
    const now = new Date();
    if (period === 'all_time') {
        return { from: new Date(0), to: new Date(8640000000000000) };
    }
    if (period === 'weekly') {
        return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now };
    }
    if (period === 'monthly') {
        return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    }
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    return { from: start, to: now };
}

function _issueReportCategorySort(a, b) {
    const catA = ISSUE_CATEGORY_LABELS[a.category] || a.category || '';
    const catB = ISSUE_CATEGORY_LABELS[b.category] || b.category || '';
    if (catA !== catB) return catA.localeCompare(catB);
    return new Date(a.created_at) - new Date(b.created_at);
}

const ISSUE_REPORT_ALL_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const ISSUE_REPORT_ALL_CATEGORIES = Object.keys(ISSUE_CATEGORY_LABELS);

/** Fetch + filter issues for the report popup. Shared by preview + every export format. */
const ISSUE_REPORT_PAGE_SIZE = 1000;

/** Pages through `buildQuery()` (a factory returning a fresh, unranged query
 *  each call) via .range() until a page returns fewer than a full page, so
 *  report exports aren't silently capped by PostgREST's default row limit. */
async function _fetchAllReportRows(buildQuery) {
    const rows = [];
    let offset = 0;
    for (;;) {
        const { data, error } = await buildQuery().range(offset, offset + ISSUE_REPORT_PAGE_SIZE - 1);
        if (error) return { data: null, error };
        rows.push(...(data || []));
        if (!data || data.length < ISSUE_REPORT_PAGE_SIZE) break;
        offset += ISSUE_REPORT_PAGE_SIZE;
    }
    return { data: rows, error: null };
}

async function buildIssueReportRows(type, opts = {}) {
    const { from = '', to = '', category = '', priority = '', reporter = '', search = '',
        moduleScope = 'current', period = 'daily', statuses = null, categories = null } = opts;

    const buildBase = () => {
        let q = db.from('production_issues').select('*');
        return (moduleScope === 'all')
            ? q.in('module', ['kd2', 'f100kd2'])
            : q.eq('module', getActiveModuleId());
    };

    if (type === 'status_report') {
        const statusSet = (statuses && statuses.length) ? statuses : ISSUE_REPORT_ALL_STATUSES;
        const categorySet = (categories && categories.length) ? categories : null;
        const { data, error } = await _fetchAllReportRows(() => {
            let q = buildBase().in('status', statusSet);
            if (categorySet && categorySet.length < ISSUE_REPORT_ALL_CATEGORIES.length) {
                q = q.in('category', categorySet);
            }
            return q.order('created_at', { ascending: true });
        });
        if (error) { showToast('Report failed: ' + error.message, 'error'); return []; }
        const win = _issueReportPeriodWindow(period);
        const rows = (data || []).filter(r => {
            // Daily/Weekly/Monthly = activity within the window: reported in
            // the window, or resolved in the window. All Time is unfiltered.
            if (period === 'all_time') return true;
            const created = new Date(r.created_at);
            if (created >= win.from && created <= win.to) return true;
            if (r.status === 'resolved' && r.resolved_at) {
                const resolved = new Date(r.resolved_at);
                if (resolved >= win.from && resolved <= win.to) return true;
            }
            return false;
        });
        return rows.sort(_issueReportCategorySort);
    }

    const { data, error } = await _fetchAllReportRows(() => {
        let q = buildBase();
        if (category) q = q.eq('category', category);
        if (priority) q = q.eq('priority', priority);
        if (reporter) q = q.eq('reporter_email', reporter);
        if (search)   q = q.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
        if (type !== 'all' && type !== 'by_category') q = q.eq('status', type);
        if (from) q = q.gte('created_at', from + 'T00:00:00');
        if (to)   q = q.lte('created_at', to + 'T23:59:59');
        return q.order('created_at', { ascending: true });
    });
    if (error) { showToast('Report failed: ' + error.message, 'error'); return []; }
    let rows = data || [];
    if (type === 'by_category') rows = rows.slice().sort(_issueReportCategorySort);
    return rows;
}

function _categoryCounts(rows) {
    const counts = {};
    rows.forEach(r => {
        const label = ISSUE_CATEGORY_LABELS[r.category] || r.category || 'Other';
        counts[label] = (counts[label] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
}

function _getIssueReportOpts() {
    const type       = document.querySelector('input[name="issueReportType"]:checked')?.value || 'all';
    const period     = document.querySelector('#issueReportPeriodToggle .kd2-create-mode-btn.active')?.dataset.period || 'all_time';
    const layout     = document.querySelector('#issueReportLayoutToggle .kd2-create-mode-btn.active')?.dataset.layout || 'table';
    const moduleScope = document.querySelector('#issueReportModuleToggle .kd2-create-mode-btn.active')?.dataset.scope || 'current';
    const from     = document.getElementById('issueReportDateFrom')?.value || '';
    const to       = document.getElementById('issueReportDateTo')?.value || '';
    const category = document.getElementById('issueReportCategory')?.value || '';
    const priority = document.getElementById('issueReportPriority')?.value || '';
    const reporter = document.getElementById('issueReportReporter')?.value || '';
    const search   = document.getElementById('issueReportSearch')?.value?.trim() || '';
    const statuses   = Array.from(document.querySelectorAll('#issueReportStatusChecklist input:checked')).map(el => el.value);
    const categories = Array.from(document.querySelectorAll('#issueReportCategoryChecklist input:checked')).map(el => el.value);
    const preview  = !!document.getElementById('issueReportPreviewToggle')?.checked;
    return { type, period, layout, moduleScope, from, to, category, priority, reporter, search, statuses, categories, preview };
}

function _issueReportTitle(opts) {
    const base = ISSUE_REPORT_TYPE_LABELS[opts.type] || 'Issues Report';
    return opts.type === 'status_report'
        ? `${base} — ${ISSUE_REPORT_PERIOD_LABELS[opts.period] || ''}`
        : base;
}

function _issueReportModuleLabel(opts) {
    return opts.moduleScope === 'all'
        ? 'All Modules (F200-KD2 + F100-KD2)'
        : (ISSUE_REPORT_MODULE_LABELS[getActiveModuleId()] || getActiveModuleId());
}

function openIssueReportModal() {
    const overlay = document.getElementById('issueReportModalOverlay');
    if (!overlay) { console.warn('issueReportModalOverlay not found'); return; }
    overlay.style.display = 'flex';
    _populateReporterSelect('issueReportReporter').catch(() => {});
    updateIssueReportPreview();
}

function wireIssueReportModal() {
    const overlay = document.getElementById('issueReportModalOverlay');
    if (!overlay) return;
    const close = () => { overlay.style.display = 'none'; };

    document.getElementById('issueReportModalClose')?.addEventListener('click', close);
    document.getElementById('issueReportModalCancel')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelectorAll('input[name="issueReportType"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const isStatusReport = document.querySelector('input[name="issueReportType"]:checked')?.value === 'status_report';
            document.getElementById('issueReportPeriodGroup').style.display            = isStatusReport ? '' : 'none';
            document.getElementById('issueReportLayoutGroup').style.display            = isStatusReport ? '' : 'none';
            document.getElementById('issueReportStatusChecklistGroup').style.display   = isStatusReport ? '' : 'none';
            document.getElementById('issueReportCategoryChecklistGroup').style.display = isStatusReport ? '' : 'none';
            document.getElementById('issueReportDateGroup').style.display           = isStatusReport ? 'none' : '';
            document.getElementById('issueReportCategorySimpleGroup').style.display = isStatusReport ? 'none' : '';
            document.getElementById('issueReportMoreFiltersGroup').style.display    = isStatusReport ? 'none' : 'flex';
            updateIssueReportPreview();
        });
    });

    document.getElementById('issueReportPeriodToggle')?.addEventListener('click', e => {
        const btn = e.target.closest('.kd2-create-mode-btn');
        if (!btn) return;
        document.querySelectorAll('#issueReportPeriodToggle .kd2-create-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateIssueReportPreview();
    });

    document.getElementById('issueReportLayoutToggle')?.addEventListener('click', e => {
        const btn = e.target.closest('.kd2-create-mode-btn');
        if (!btn) return;
        document.querySelectorAll('#issueReportLayoutToggle .kd2-create-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateIssueReportPreview();
    });

    document.getElementById('issueReportModuleToggle')?.addEventListener('click', e => {
        const btn = e.target.closest('.kd2-create-mode-btn');
        if (!btn) return;
        document.querySelectorAll('#issueReportModuleToggle .kd2-create-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateIssueReportPreview();
    });

    // Checklist pills — reflect checked state visually + refresh preview
    const wireChecklist = (id) => {
        const list = document.getElementById(id);
        if (!list) return;
        const sync = () => list.querySelectorAll('.issue-report-check-pill').forEach(pill => {
            pill.classList.toggle('is-checked', pill.querySelector('input')?.checked);
        });
        sync();
        list.addEventListener('change', () => { sync(); updateIssueReportPreview(); });
    };
    wireChecklist('issueReportStatusChecklist');
    wireChecklist('issueReportCategoryChecklist');

    const wireSelectButtons = (allBtnId, noneBtnId, listId) => {
        document.getElementById(allBtnId)?.addEventListener('click', () => {
            document.querySelectorAll(`#${listId} input`).forEach(el => { el.checked = true; });
            document.getElementById(listId)?.dispatchEvent(new Event('change'));
        });
        document.getElementById(noneBtnId)?.addEventListener('click', () => {
            document.querySelectorAll(`#${listId} input`).forEach(el => { el.checked = false; });
            document.getElementById(listId)?.dispatchEvent(new Event('change'));
        });
    };
    wireSelectButtons('btnIssueReportStatusAll', 'btnIssueReportStatusNone', 'issueReportStatusChecklist');
    wireSelectButtons('btnIssueReportCategoryAll', 'btnIssueReportCategoryNone', 'issueReportCategoryChecklist');

    document.getElementById('issueReportDateFrom')?.addEventListener('change', updateIssueReportPreview);
    document.getElementById('issueReportDateTo')?.addEventListener('change', updateIssueReportPreview);
    document.getElementById('issueReportCategory')?.addEventListener('change', updateIssueReportPreview);
    document.getElementById('issueReportPriority')?.addEventListener('change', updateIssueReportPreview);
    document.getElementById('issueReportReporter')?.addEventListener('change', updateIssueReportPreview);
    document.getElementById('issueReportSearch')?.addEventListener('input', updateIssueReportPreview);

    document.getElementById('btnIssueReportPDF')?.addEventListener('click', () => exportIssueReportPDF(_getIssueReportOpts()));
    document.getElementById('btnIssueReportExcel')?.addEventListener('click', () => exportIssueReportExcel(_getIssueReportOpts()));
    document.getElementById('btnIssueReportWord')?.addEventListener('click', () => exportIssueReportWord(_getIssueReportOpts()));
}

async function updateIssueReportPreview() {
    const opts = _getIssueReportOpts();
    const bar  = document.getElementById('issueReportPreviewBar');
    const cnt  = document.getElementById('issueReportPreviewCount');
    const hint = bar?.querySelector('.report-preview-hint');
    const rows = await buildIssueReportRows(opts.type, opts);
    if (cnt)  cnt.textContent = `${rows.length} issue${rows.length !== 1 ? 's' : ''} match`;
    if (hint) hint.textContent = rows.length ? 'Ready to export' : 'No issues match — adjust filters';
    if (bar)  bar.style.borderColor = rows.length ? 'rgba(79,142,247,.4)' : 'rgba(239,68,68,.4)';
}

/* ── Excel export (general list + status report) ─────────────────── */
async function exportIssueReportExcel(opts) {
    if (!await canExport()) { showToast('You do not have permission to export reports.', 'error'); return; }
    if (typeof ExcelJS === 'undefined') { showToast('Excel library not loaded — please refresh.', 'error'); return; }
    showToast('Preparing Excel export…', 'info');
    const rows = await buildIssueReportRows(opts.type, opts);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'PPMS';
    wb.created = new Date();
    const title = _issueReportTitle(opts);
    const modLabel = _issueReportModuleLabel(opts);
    const ws = wb.addWorksheet(title.slice(0, 31));

    const isStatusReport = opts.type === 'status_report';
    const isByCategory    = opts.type === 'by_category';
    let cursorRow = 1;

    const writeHeaderBlock = (colCount) => {
        ws.mergeCells(cursorRow, 1, cursorRow, colCount);
        const t = ws.getCell(cursorRow, 1);
        t.value = `${title} — ${modLabel}`;
        t.font  = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FF1e293b' } };
        t.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } };
        t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.getRow(cursorRow).height = 26;
        cursorRow++;

        ws.mergeCells(cursorRow, 1, cursorRow, colCount);
        const s = ws.getCell(cursorRow, 1);
        s.value = `Generated: ${new Date().toLocaleString('en-GB')}   ·   ${rows.length} issue${rows.length !== 1 ? 's' : ''}`;
        s.font  = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF64748b' } };
        s.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } };
        ws.getRow(cursorRow).height = 13;
        cursorRow++;
        ws.addRow([]); cursorRow++;
    };

    if (isByCategory || isStatusReport) {
        // Title/subtitle merge width must match this type's actual data
        // table below (8 cols for status_report, 11 for by_category) —
        // not a flat 8 for both.
        writeHeaderBlock(isStatusReport ? 8 : 11);
        // Summary-by-category mini table
        const sumHdr = ws.addRow(['Category', 'Count']);
        sumHdr.eachCell(c => {
            c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFe2e8f0' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e3a5f' } };
        });
        cursorRow++;
        _categoryCounts(rows).forEach(([label, count]) => {
            ws.addRow([label, count]);
            cursorRow++;
        });
        ws.addRow([]); cursorRow++;
    } else {
        writeHeaderBlock(11);
    }

    const HDR_BG = 'FF1e3a5f', HDR_TEXT = 'FFe2e8f0';
    const headers = isStatusReport
        ? ['Category', 'Title', 'Issue/Problem', 'Proposed Solution', 'Action Taken', 'Date of Reporting', 'Date Resolved', 'Person In Charge']
        : ['#', 'Title', 'Category', 'Priority', 'Status', 'Reporter', 'Person In Charge', 'Description', 'Proposed Solution', 'Reported On', 'Resolved At'];
    const hdrRow = ws.addRow(headers);
    hdrRow.height = 20;
    hdrRow.eachCell(cell => {
        cell.font   = { name: 'Calibri', size: 9, bold: true, color: { argb: HDR_TEXT } };
        cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF2563eb' } } };
    });

    const bord = () => ({
        top: { style: 'thin', color: { argb: 'FFe2e8f0' } }, bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } },
        left: { style: 'thin', color: { argb: 'FFe2e8f0' } }, right: { style: 'thin', color: { argb: 'FFe2e8f0' } },
    });

    rows.forEach((r, i) => {
        const rowBg = i % 2 === 0 ? 'FFffffff' : 'FFf8fafc';
        const values = isStatusReport
            ? [
                ISSUE_CATEGORY_LABELS[r.category] || r.category || '',
                r.title || '',
                r.description || '',
                r.proposed_solution || '',
                r.notes || '',
                formatIssueDate(r.created_at),
                r.resolved_at ? formatIssueDate(r.resolved_at) : '',
                r.person_in_charge || '',
              ]
            : [
                i + 1, r.title || '', ISSUE_CATEGORY_LABELS[r.category] || r.category || '',
                r.priority || '', (r.status || '').replace(/_/g, ' '),
                r.reporter_name || r.reporter_email || '', r.person_in_charge || '',
                r.description || '', r.proposed_solution || '',
                formatIssueDate(r.created_at), r.resolved_at ? formatIssueDate(r.resolved_at) : '',
              ];
        const dataRow = ws.addRow(values);
        dataRow.height = 16;
        dataRow.eachCell({ includeEmpty: true }, cell => {
            cell.font   = { name: 'Calibri', size: 9, color: { argb: 'FF1e293b' } };
            cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
            cell.border = bord();
            cell.alignment = { vertical: 'middle', wrapText: false };
        });
    });

    const colWidths = isStatusReport
        ? [18, 34, 42, 42, 42, 16, 16, 22]
        : [5, 34, 18, 12, 14, 24, 22, 40, 40, 16, 16];
    colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    const now = new Date().toISOString().slice(0, 10);
    const doDownload = async () => {
        const buf = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `issues_report_${opts.type}_${now}.xlsx`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Excel exported.', 'success');
    };
    if (opts.preview) {
        _showGenericPreview({ title: _issueReportTitle(opts), kind: 'sheets', sheets: _workbookToSheets(wb), onDownload: doDownload });
    } else {
        await doDownload();
    }
}

/* ── PDF export (general list + status report) ───────────────────── */
/** One-page(ish) bullet-point layout for the Status Report — grouped by
 *  category, prose instead of a grid. Shared shape by PDF and Word. */
function _issueStatusReportGroups(rows) {
    const grouped = new Map();
    rows.forEach(r => {
        const label = ISSUE_CATEGORY_LABELS[r.category] || r.category || 'Other';
        if (!grouped.has(label)) grouped.set(label, []);
        grouped.get(label).push(r);
    });
    return [...grouped.keys()].sort((a, b) => a.localeCompare(b)).map(label => ({ label, rows: grouped.get(label) }));
}

function _renderIssueStatusOnePageReportPDF(doc, rows, title, modLabel) {
    const PAGE_W = doc.internal.pageSize.getWidth();
    const PAGE_H = doc.internal.pageSize.getHeight();
    const MARGIN = 16;
    const usableW = PAGE_W - MARGIN * 2;
    let y = MARGIN;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(15, 23, 42);
    doc.text(title, MARGIN, y);
    y += 9.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Module: ${modLabel}   ·   Generated: ${new Date().toLocaleString('en-GB')}   ·   ${rows.length} issue${rows.length !== 1 ? 's' : ''}`, MARGIN, y);
    y += 9;

    const counts = _categoryCounts(rows);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(37, 99, 235);
    const summaryLines = doc.splitTextToSize(counts.map(([label, count]) => `${label}: ${count}`).join('   ·   '), usableW);
    doc.text(summaryLines, MARGIN, y);
    y += summaryLines.length * 6 + 6;

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 9;

    const ensureRoom = needed => { if (y + needed > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN; } };

    // jsPDF's outline plugin builds real PDF bookmarks — these show up in
    // the viewer's own navigation/bookmarks panel (Acrobat, Chrome, etc.):
    // report title as the root, one entry per category, issue titles nested
    // underneath their category.
    const hasOutline = !!doc.outline?.add;
    let titleNode = null;
    if (hasOutline) {
        try { titleNode = doc.outline.add(null, title, { pageNumber: 1 }); } catch {}
    }

    _issueStatusReportGroups(rows).forEach(({ label: catLabel, rows: catRows }) => {
        ensureRoom(18);
        let catNode = null;
        if (hasOutline) {
            try { catNode = doc.outline.add(titleNode, `${catLabel} (${catRows.length})`, { pageNumber: doc.internal.getCurrentPageInfo().pageNumber }); } catch {}
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16.5);
        doc.setTextColor(30, 58, 138);
        doc.text(`${catLabel}  (${catRows.length})`, MARGIN, y);
        y += 2.5;
        doc.setDrawColor(30, 58, 138);
        doc.setLineWidth(0.6);
        doc.line(MARGIN, y, PAGE_W - MARGIN, y);
        y += 9;

        catRows.forEach(r => {
            ensureRoom(26);
            if (hasOutline) {
                try { doc.outline.add(catNode, r.title || 'Untitled', { pageNumber: doc.internal.getCurrentPageInfo().pageNumber }); } catch {}
            }
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(15);
            doc.setTextColor(15, 23, 42);
            const titleWrapped = doc.splitTextToSize(`•  ${r.title || 'Untitled'}`, usableW - 2);
            doc.text(titleWrapped, MARGIN + 2, y);
            y += titleWrapped.length * 6.2;

            const reporter = r.reporter_name || r.reporter_email || 'Unknown';
            doc.setFont('helvetica', 'italic');
            doc.setFontSize(11);
            doc.setTextColor(100, 116, 139);
            doc.text(`Reported by: ${reporter}`, MARGIN + 6, y);
            y += 7.5;

            const sections = [
                { label: 'Issue', value: r.description, color: [15, 23, 42] },
                { label: 'Proposed Solution', value: r.proposed_solution, color: [21, 94, 117] },
                { label: 'Action Taken', value: r.notes, color: [21, 128, 61] },
            ];
            sections.forEach(sec => {
                if (!sec.value) return;
                ensureRoom(11);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(12.5);
                doc.setTextColor(sec.color[0], sec.color[1], sec.color[2]);
                doc.text(`${sec.label}:`, MARGIN + 6, y);
                y += 6.5;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(11.5);
                doc.setTextColor(51, 65, 85);
                const wrapped = doc.splitTextToSize(sec.value, usableW - 6);
                ensureRoom(wrapped.length * 5.6);
                doc.text(wrapped, MARGIN + 6, y);
                y += wrapped.length * 5.6 + 5;
            });

            const meta = [`Reported: ${formatIssueDate(r.created_at)}`];
            if (r.resolved_at) meta.push(`Resolved: ${formatIssueDate(r.resolved_at)}`);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10.5);
            doc.setTextColor(100, 116, 139);
            ensureRoom(7);
            doc.text(meta.join('   ·   '), MARGIN + 6, y);
            if (r.person_in_charge) {
                doc.setTextColor(180, 83, 9);
                doc.text(`PIC: ${r.person_in_charge}`, MARGIN + 6 + doc.getTextWidth(meta.join('   ·   ')) + 6, y);
            }
            y += 6.5;

            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.2);
            doc.line(MARGIN + 2, y, PAGE_W - MARGIN, y);
            y += 6.5;
        });
        y += 4;
    });

    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(`Page ${p} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 6, { align: 'right' });
    }
}

async function exportIssueReportPDF(opts) {
    if (!await canExport()) { showToast('You do not have permission to export reports.', 'error'); return; }
    if (!window.jspdf) { showToast('PDF library not loaded — please refresh.', 'error'); return; }
    showToast('Preparing PDF export…', 'info');
    const rows = await buildIssueReportRows(opts.type, opts);

    const { jsPDF } = window.jspdf;
    const title = _issueReportTitle(opts);
    const modLabel = _issueReportModuleLabel(opts);
    const exportDate = new Date().toISOString().slice(0, 10);

    if (opts.type === 'status_report' && opts.layout === 'report') {
        const reportDoc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        _renderIssueStatusOnePageReportPDF(reportDoc, rows, title, modLabel);
        const doDownload = () => { reportDoc.save(`issues_status_report_${exportDate}.pdf`); showToast('PDF exported.', 'success'); };
        if (opts.preview) {
            _showGenericPreview({ title, kind: 'pdf', src: reportDoc.output('bloburl'), onDownload: doDownload });
        } else {
            doDownload();
        }
        return;
    }

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const PAGE_W = doc.internal.pageSize.getWidth();
    const PAGE_H = doc.internal.pageSize.getHeight();
    const MARGIN = 14;
    const isStatusReport = opts.type === 'status_report';
    const isByCategory    = opts.type === 'by_category';

    doc.setFillColor(248, 250, 252);
    doc.rect(0, 0, PAGE_W, 22, 'F');
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, 4, 22, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(0, 22, PAGE_W, 22);

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(title, MARGIN + 2, 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Module: ${modLabel}`, MARGIN + 2, 17);
    doc.text(`Generated: ${new Date().toLocaleString('en-GB')}   ·   ${rows.length} issue${rows.length !== 1 ? 's' : ''}`, PAGE_W - MARGIN, 17, { align: 'right' });

    let startY = 28;
    if (isByCategory || isStatusReport) {
        const counts = _categoryCounts(rows);
        let pillX = MARGIN;
        const pillY = 26.5;
        counts.forEach(([label, count]) => {
            const text = `${label}: ${count}`;
            doc.setFontSize(6.5);
            const tw = doc.getTextWidth(text) + 8;
            doc.setFillColor(37, 99, 235);
            try { doc.setGState(new doc.GState({ opacity: 0.15 })); } catch {}
            doc.roundedRect(pillX, pillY - 3.5, tw, 5.5, 1, 1, 'F');
            try { doc.setGState(new doc.GState({ opacity: 1 })); } catch {}
            doc.setTextColor(37, 99, 235);
            doc.setFont('helvetica', 'bold');
            doc.text(text, pillX + 4, pillY + 0.5);
            pillX += tw + 4;
        });
        startY = 33;
    }

    const headers = isStatusReport
        ? ['Category', 'Title', 'Issue/Problem', 'Proposed Solution', 'Action Taken', 'Reported', 'Resolved', 'PIC']
        : ['#', 'Title', 'Category', 'Priority', 'Status', 'Reporter', 'PIC', 'Description', 'Reported On', 'Resolved'];
    const body = isStatusReport
        ? rows.map(r => [
            ISSUE_CATEGORY_LABELS[r.category] || r.category || '—',
            (r.title || '').slice(0, 36),
            (r.description || '—').slice(0, 44),
            (r.proposed_solution || '—').slice(0, 44),
            (r.notes || '—').slice(0, 44),
            formatIssueDate(r.created_at),
            r.resolved_at ? formatIssueDate(r.resolved_at) : '—',
            (r.person_in_charge || '—').slice(0, 18),
          ])
        : rows.map((r, i) => [
            i + 1, (r.title || '').slice(0, 36), ISSUE_CATEGORY_LABELS[r.category] || r.category || '—',
            r.priority || '—', (r.status || '—').replace(/_/g, ' '),
            (r.reporter_name || r.reporter_email || '—').slice(0, 20), (r.person_in_charge || '—').slice(0, 18),
            (r.description || '—').slice(0, 44), formatIssueDate(r.created_at),
            r.resolved_at ? formatIssueDate(r.resolved_at) : '—',
          ]);

    doc.autoTable({
        startY,
        head: [headers], body,
        margin: { left: MARGIN, right: MARGIN },
        styles: { fontSize: 6.5, cellPadding: [2, 2.5], font: 'helvetica', textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.18 },
        headStyles: { fillColor: [30, 58, 138], textColor: [241, 245, 249], fontStyle: 'bold', fontSize: 6.2, halign: 'center', cellPadding: [3, 2.5] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didDrawPage(data) {
            const pageCount = doc.internal.getNumberOfPages();
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6);
            doc.setTextColor(148, 163, 184);
            doc.text(title, MARGIN, PAGE_H - 5);
            doc.text(`Page ${data.pageNumber} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 5, { align: 'right' });
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.2);
            doc.line(MARGIN, PAGE_H - 7.5, PAGE_W - MARGIN, PAGE_H - 7.5);
        },
    });

    const doDownload = () => { doc.save(`issues_report_${opts.type}_${exportDate}.pdf`); showToast('PDF exported.', 'success'); };
    if (opts.preview) {
        _showGenericPreview({ title, kind: 'pdf', src: doc.output('bloburl'), onDownload: doDownload });
    } else {
        doDownload();
    }
}

/* ── Word export (general list + status report) ──────────────────── */
async function exportIssueReportWord(opts) {
    if (!await canExport()) { showToast('You do not have permission to export reports.', 'error'); return; }
    showToast('Preparing Word export…', 'info');
    const rows = await buildIssueReportRows(opts.type, opts);
    const title = _issueReportTitle(opts);
    const modLabel = _issueReportModuleLabel(opts);
    const isStatusReport = opts.type === 'status_report';
    const isByCategory    = opts.type === 'by_category';

    const now = new Date().toISOString().slice(0, 10);

    if (isStatusReport && opts.layout === 'report') {
        // Real headings (h1/h2/h3) so Word's own Navigation Pane lists the
        // report title, every category, and every issue title — no manual
        // contents list needed.
        let reportBody = `<h1>${esc(title)}</h1><p class="doc-sub">Module: ${esc(modLabel)} &middot; Generated: ${esc(new Date().toLocaleString('en-GB'))} &middot; ${rows.length} issue${rows.length !== 1 ? 's' : ''}</p>`;
        reportBody += `<p style="font-size:13pt;font-weight:bold;color:#2563eb;margin:0 0 10px">${_categoryCounts(rows).map(([label, count]) => `${esc(label)}: ${count}`).join(' &middot; ')}</p>`;

        _issueStatusReportGroups(rows).forEach(({ label: catLabel, rows: catRows }) => {
            reportBody += `<h2>${esc(catLabel)} (${catRows.length})</h2>`;
            catRows.forEach(r => {
                const reporter = r.reporter_name || r.reporter_email || 'Unknown';
                const meta = [`Reported: ${esc(formatIssueDate(r.created_at))}`];
                if (r.resolved_at) meta.push(`Resolved: ${esc(formatIssueDate(r.resolved_at))}`);
                reportBody += `<div class="issue-report-card">`;
                reportBody += `<h3 class="issue-report-title">${esc(r.title || 'Untitled')}</h3>`;
                reportBody += `<p class="issue-report-byline">Reported by: ${esc(reporter)}</p>`;
                if (r.description) reportBody += `<p class="issue-report-sec-label issue-report-sec-issue">Issue:</p><p class="issue-report-sec-text">${esc(r.description)}</p>`;
                if (r.proposed_solution) reportBody += `<p class="issue-report-sec-label issue-report-sec-solution">Proposed Solution:</p><p class="issue-report-sec-text">${esc(r.proposed_solution)}</p>`;
                if (r.notes) reportBody += `<p class="issue-report-sec-label issue-report-sec-action">Action Taken:</p><p class="issue-report-sec-text">${esc(r.notes)}</p>`;
                reportBody += `<p class="issue-report-meta">${meta.join(' &middot; ')}`
                    + (r.person_in_charge ? ` <span class="issue-report-pic">&middot; PIC: ${esc(r.person_in_charge)}</span>` : '')
                    + `</p>`;
                reportBody += `</div>`;
            });
        });
        exportHtmlAsWord(`issues_status_report_${now}.doc`, title, reportBody, opts.preview);
        return;
    }

    let body = `<h1>${esc(title)}</h1><p class="doc-sub">Module: ${esc(modLabel)} &middot; Generated: ${esc(new Date().toLocaleString('en-GB'))} &middot; ${rows.length} issue${rows.length !== 1 ? 's' : ''}</p>`;

    if (isByCategory || isStatusReport) {
        body += `<h2>Summary by Category</h2><table class="doc-summary-table"><tr><th>Category</th><th>Count</th></tr>`;
        _categoryCounts(rows).forEach(([label, count]) => {
            body += `<tr><td>${esc(label)}</td><td>${count}</td></tr>`;
        });
        body += `</table>`;
    }

    body += `<h2>Issues</h2><table>`;
    if (isStatusReport) {
        body += `<tr><th>Category</th><th>Title</th><th>Issue/Problem</th><th>Proposed Solution</th><th>Action Taken</th><th>Date of Reporting</th><th>Date Resolved</th><th>Person In Charge</th></tr>`;
        rows.forEach(r => {
            body += `<tr>
                <td>${esc(ISSUE_CATEGORY_LABELS[r.category] || r.category || '')}</td>
                <td>${esc(r.title || '')}</td>
                <td>${esc(r.description || '')}</td>
                <td>${esc(r.proposed_solution || '')}</td>
                <td>${esc(r.notes || '')}</td>
                <td>${esc(formatIssueDate(r.created_at))}</td>
                <td>${r.resolved_at ? esc(formatIssueDate(r.resolved_at)) : ''}</td>
                <td>${esc(r.person_in_charge || '')}</td>
            </tr>`;
        });
    } else {
        body += `<tr><th>#</th><th>Title</th><th>Category</th><th>Priority</th><th>Status</th><th>Reporter</th><th>Person In Charge</th><th>Description</th><th>Proposed Solution</th><th>Reported On</th><th>Resolved At</th></tr>`;
        rows.forEach((r, i) => {
            body += `<tr>
                <td>${i + 1}</td>
                <td>${esc(r.title || '')}</td>
                <td>${esc(ISSUE_CATEGORY_LABELS[r.category] || r.category || '')}</td>
                <td>${esc(r.priority || '')}</td>
                <td>${esc((r.status || '').replace(/_/g, ' '))}</td>
                <td>${esc(r.reporter_name || r.reporter_email || '')}</td>
                <td>${esc(r.person_in_charge || '')}</td>
                <td>${esc(r.description || '')}</td>
                <td>${esc(r.proposed_solution || '')}</td>
                <td>${esc(formatIssueDate(r.created_at))}</td>
                <td>${r.resolved_at ? esc(formatIssueDate(r.resolved_at)) : ''}</td>
            </tr>`;
        });
    }
    body += `</table>`;

    exportHtmlAsWord(`issues_report_${opts.type}_${now}.doc`, title, body, opts.preview);
}

/* ── Issue notifications ────────────────────────────────────────── */
let _issueNotifChannel = null;

function _issueNotifSeenKey() {
    const u = getCurrentUser();
    return `ppms_issues_seen_${getActiveModuleId()}_${u?.email || 'anon'}`;
}

function _issueNotifGetSeen() {
    try { return localStorage.getItem(_issueNotifSeenKey()) || '1970-01-01T00:00:00Z'; } catch { return '1970-01-01T00:00:00Z'; }
}

function _issueNotifMarkSeen() {
    try { localStorage.setItem(_issueNotifSeenKey(), new Date().toISOString()); } catch {}
}

async function _issueNotifUpdateBadge() {
    const badge = document.getElementById('issuesNewBadge');
    if (!badge || !db) return;
    try {
        const since = _issueNotifGetSeen();
        let q = db.from('production_issues').select('id', { count: 'exact', head: true }).gt('created_at', since);
        // Try with module filter; ignore error if column doesn't exist
        const r = await q.eq('module', getActiveModuleId());
        const cnt = (r.error ? 0 : (r.count || 0));
        if (cnt > 0) {
            badge.textContent = cnt + ' new';
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    } catch { badge.style.display = 'none'; }
}

function _issueNotifClearBadge() {
    const badge = document.getElementById('issuesNewBadge');
    if (badge) badge.style.display = 'none';
    _issueNotifMarkSeen();
}

function startIssueNotifSync() {
    if (_issueNotifChannel) {
        try { db.removeChannel(_issueNotifChannel); } catch {}
        _issueNotifChannel = null;
    }
    const u = getCurrentUser();
    if (!u || !db) return;

    // Use Broadcast (not postgres_changes) — works without publication setup or RLS checks
    _issueNotifChannel = db.channel('ppms-issues-broadcast')
        .on('broadcast', { event: 'issue:new' }, ({ payload }) => {
            const sameModule = !payload?.module || payload.module === getActiveModuleId();
            if (!sameModule) return;
            // Always reload the table
            loadIssues(true).catch(() => {});
            // Only store notification for changes by others
            if (payload?.by === u.email) return;
            const reporter = payload?.reporter || 'Someone';
            if (payload?.issueId) {
                _storeIssueNotification(payload.issueId, payload.module || getActiveModuleId(),
                    payload.title, payload.category, reporter, payload.created_at || new Date().toISOString(), false);
            }
            _issueNotifUpdateBadge();
            updateNotifBadge();
        })
        .on('broadcast', { event: 'issue:updated' }, ({ payload }) => {
            const sameModule = !payload?.module || payload.module === getActiveModuleId();
            if (!sameModule) return;
            loadIssues(true).catch(() => {});
            if (payload?.by !== u.email && payload?.issueId) {
                _storeIssueNotification(payload.issueId, payload.module || getActiveModuleId(),
                    payload.title || '', payload.category || '', payload.reporter || 'Someone',
                    payload.updated_at || new Date().toISOString(), true);
                updateNotifBadge();
            }
        })
        .on('broadcast', { event: 'issue:deleted' }, ({ payload }) => {
            const sameModule = !payload?.module || payload.module === getActiveModuleId();
            if (!sameModule) return;
            // Silent table refresh — no notification stored
            loadIssues(true).catch(() => {});
        })
        .subscribe();
}

async function _broadcastIssueNew(issueData) {
    if (!_issueNotifChannel) return;
    const u = getCurrentUser();
    try {
        await _issueNotifChannel.send({
            type: 'broadcast',
            event: 'issue:new',
            payload: {
                issueId:    issueData.id || null,
                module:     issueData.module || getActiveModuleId(),
                title:      issueData.title || '',
                category:   issueData.category || '',
                reporter:   u?.name || u?.full_name || u?.email || 'Someone',
                by:         u?.email || '',
                created_at: new Date().toISOString(),
            },
        });
    } catch(e) { console.warn('issue broadcast send error:', e); }
}

async function _broadcastIssueUpdated(issueData) {
    if (!_issueNotifChannel) return;
    const u = getCurrentUser();
    try {
        await _issueNotifChannel.send({
            type: 'broadcast',
            event: 'issue:updated',
            payload: {
                issueId:    issueData?.id || null,
                module:     getActiveModuleId(),
                title:      issueData?.title || '',
                category:   issueData?.category || '',
                reporter:   issueData?.reporter_name || issueData?.reporter_email || 'Someone',
                by:         u?.email || '',
                updated_at: new Date().toISOString(),
            },
        });
    } catch {}
}

async function _broadcastIssueDeleted(moduleId) {
    if (!_issueNotifChannel) return;
    try {
        await _issueNotifChannel.send({
            type: 'broadcast',
            event: 'issue:deleted',
            payload: { module: moduleId || getActiveModuleId() },
        });
    } catch {}
}

/* ── Polling fallback (30-second interval) ──────────────────────── */
let _issuesPollTimer      = null;
let _issuesPollLastCheck  = null;   // ISO string — updated each poll cycle

async function _issuesPollCheck() {
    if (!db) return;
    const u = getCurrentUser();
    if (!u) return;

    const checkFrom = _issuesPollLastCheck;
    _issuesPollLastCheck = new Date().toISOString();
    if (!checkFrom) return; // first tick — just set the baseline timestamp

    try {
        let q = db.from('production_issues')
            .select('id, title, category, reporter_name, reporter_email, created_at, updated_at')
            .gt('updated_at', checkFrom)
            .order('updated_at', { ascending: false })
            .limit(5);
        const { data, error } = await q.eq('module', getActiveModuleId());
        if (error || !data?.length) return;

        // Reload the table for the current user no matter what changed
        loadIssues(true).catch(() => {});

        // Notify only for changes by others
        const byOthers = data.filter(r => r.reporter_email !== u.email);
        if (!byOthers.length) return;

        byOthers.slice(0, 5).forEach(issue => {
            const isNew = Math.abs(new Date(issue.created_at) - new Date(issue.updated_at)) < 5000;
            const rep   = issue.reporter_name || issue.reporter_email || 'Someone';
            _storeIssueNotification(issue.id, getActiveModuleId(), issue.title, issue.category,
                rep, isNew ? issue.created_at : issue.updated_at, !isNew);
        });
        _issueNotifUpdateBadge();
        updateNotifBadge();
    } catch {}  // fails gracefully if module column missing
}

function startIssuesPoll() {
    if (_issuesPollTimer) clearInterval(_issuesPollTimer);
    _issuesPollLastCheck = new Date().toISOString(); // baseline — don't notify about existing issues
    _issuesPollTimer = setInterval(_issuesPollCheck, 30000);
}

/* ================================================================
   GANTT EDIT MODE — drag-to-reschedule with cascade + Friday skip
   ================================================================ */

let _ganttEditMode = false;
let _ganttSatAllowed = false;
let _ganttSatAsked = false;
let _ganttMoveMode = 'single';
let _ganttSelectLaneMode = false;
let _openGanttBlockMenuPlanId = null;
const _selectedGanttPlanIds = new Set();
const _laneOrder = {};
const _ganttVisualLane = {};
let _f100PlacementActive = false;
let _f100PlacementProcess = null;
let _f100PlacementAllProcesses = [];   // cache for search re-filter
let _f100PlacementPartMap = {};
const _ganttManualLane = {}; // lanes set explicitly by the user via move-up/down buttons
let _ganttLegendOpen = false;
let _ganttFullscreenEventsBound = false;
let _ganttFullscreenHandlersBound = false;
let _vpxFullscreenEventsBound = false;
let _vpxFullscreenHandlersBound = false;
let _ganttHoverDate = '';
let _ganttHoverRowEl = null;
let _ganttHasRenderedOnce = false;

/* ── Undo / Redo stacks ─────────────────────────────────────────── */
// Each entry: array of { id, newStart, newEnd, oldStart, oldEnd }
const _undoStack = [];
const _redoStack = [];
const _UNDO_LIMIT = 50;

function getGanttCardHost() {
    return document.getElementById('ganttCard');
}

function isGanttFullscreen() {
    const host = getGanttCardHost();
    return !!host && document.fullscreenElement === host;
}

function syncGanttFullscreenButtons() {
    const active = isGanttFullscreen();
    const label = active ? 'Exit Full Screen' : 'Full Screen';
    const host = getGanttCardHost();
    if (host) host.classList.toggle('is-fullscreen', active);
    [
        ['btnGanttFullscreen', 'btnGanttFullscreenLabel'],
    ].forEach(([buttonId, labelId]) => {
        const btn = document.getElementById(buttonId);
        if (btn) {
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            btn.setAttribute('title', label);
        }
        const span = document.getElementById(labelId);
        if (span) span.textContent = label;
    });
}

async function toggleGanttFullscreen(forceOn = null) {
    const host = getGanttCardHost();
    if (!host) return;
    const active = isGanttFullscreen();
    const shouldEnter = forceOn === null ? !active : !!forceOn;
    if (shouldEnter === active) {
        syncGanttFullscreenButtons();
        return;
    }
    try {
        if (shouldEnter) {
            if (!host.requestFullscreen) throw new Error('Fullscreen is not supported in this browser.');
            await host.requestFullscreen();
        } else if (document.fullscreenElement && document.exitFullscreen) {
            await document.exitFullscreen();
        }
    } catch (error) {
        showToast('Fullscreen could not be opened: ' + error.message, 'error');
    } finally {
        syncGanttFullscreenButtons();
    }
}

function bindGanttFullscreenUi() {
    if (!_ganttFullscreenHandlersBound) {
        _ganttFullscreenHandlersBound = true;
        document.getElementById('btnGanttFullscreen')?.addEventListener('click', () => toggleGanttFullscreen());
    }
    if (!_ganttFullscreenEventsBound) {
        _ganttFullscreenEventsBound = true;
        document.addEventListener('fullscreenchange', syncGanttFullscreenButtons);
    }
    syncGanttFullscreenButtons();
}

function getVpxCardHost() {
    return document.getElementById('vpxCard');
}

function isVpxFullscreen() {
    const host = getVpxCardHost();
    return !!host && document.fullscreenElement === host;
}

function syncVpxFullscreenButtons() {
    const active = isVpxFullscreen();
    const label = active ? 'Exit Full Screen' : 'Full Screen';
    const host = getVpxCardHost();
    if (host) host.classList.toggle('is-fullscreen', active);
    [
        ['btnVpxFullscreen', 'btnVpxFullscreenLabel'],
    ].forEach(([buttonId, labelId]) => {
        const btn = document.getElementById(buttonId);
        if (btn) {
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            btn.setAttribute('title', label);
        }
        const span = document.getElementById(labelId);
        if (span) span.textContent = label;
    });
}

async function toggleVpxFullscreen(forceOn = null) {
    const host = getVpxCardHost();
    if (!host) return;
    const active = isVpxFullscreen();
    const shouldEnter = forceOn === null ? !active : !!forceOn;
    if (shouldEnter === active) {
        syncVpxFullscreenButtons();
        return;
    }
    try {
        if (shouldEnter) {
            if (!host.requestFullscreen) throw new Error('Fullscreen is not supported in this browser.');
            await host.requestFullscreen();
        } else if (document.fullscreenElement && document.exitFullscreen) {
            await document.exitFullscreen();
        }
    } catch (error) {
        showToast('Fullscreen could not be opened: ' + error.message, 'error');
    } finally {
        syncVpxFullscreenButtons();
    }
}

function bindVpxFullscreenUi() {
    if (!_vpxFullscreenHandlersBound) {
        _vpxFullscreenHandlersBound = true;
        document.getElementById('btnVpxFullscreen')?.addEventListener('click', () => toggleVpxFullscreen());
    }
    if (!_vpxFullscreenEventsBound) {
        _vpxFullscreenEventsBound = true;
        document.addEventListener('fullscreenchange', syncVpxFullscreenButtons);
    }
    syncVpxFullscreenButtons();
}

/* ── Table card fullscreen ──────────────────────────────────────── */
function toggleTableFullscreen() {
    const card = document.querySelector('.table-card');
    if (!card) return;
    const isFs = card.classList.toggle('is-fullscreen');
    ['btnTableFullscreen', 'btnTableFullscreenLabel'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id.endsWith('Label')) el.textContent = isFs ? 'Exit Full Screen' : 'Full Screen';
        else el.setAttribute('aria-pressed', String(isFs));
    });
}

function positionOpenGanttBlockMenu() {
    document.querySelectorAll('.gc-bar-menu-below').forEach(bar => bar.classList.remove('gc-bar-menu-below'));
    const bar = document.querySelector('.gc-bar-menu-open');
    if (!bar) return;

    const menu = bar.querySelector('.gc-bar-menu');
    if (!menu) return;

    const scrollRoot = document.getElementById('ganttScrollRoot');
    const barRect = bar.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const topBoundary = scrollRoot
        ? Math.max(scrollRoot.getBoundingClientRect().top + 8, 8)
        : 8;
    const bottomBoundary = scrollRoot
        ? Math.min(scrollRoot.getBoundingClientRect().bottom - 8, window.innerHeight - 8)
        : window.innerHeight - 8;

    const spaceAbove = barRect.top - topBoundary;
    const spaceBelow = bottomBoundary - barRect.bottom;
    const shouldOpenBelow = menuRect.top < topBoundary && spaceBelow > spaceAbove;

    if (shouldOpenBelow) bar.classList.add('gc-bar-menu-below');
}

function syncGanttLegendUi() {
    const legend = document.getElementById('ganttLegend');
    const btn = document.getElementById('btnGanttLegendToggle');
    const label = document.getElementById('btnGanttLegendToggleLabel');
    const hasContent = !!legend?.innerHTML?.trim();
    if (legend) legend.style.display = hasContent && _ganttLegendOpen ? '' : 'none';
    if (btn) {
        btn.disabled = !hasContent;
        btn.setAttribute('aria-expanded', hasContent && _ganttLegendOpen ? 'true' : 'false');
    }
    if (label) label.textContent = hasContent && _ganttLegendOpen ? 'Hide Legend' : 'Show Legend';
}

function clearGanttHoverGuide() {
    if (_ganttHoverRowEl) {
        _ganttHoverRowEl.classList.remove('gantt-hover-row');
        _ganttHoverRowEl = null;
    }
    if (_ganttHoverDate) {
        document.querySelectorAll(`[data-gantt-date="${_ganttHoverDate}"]`).forEach(node => {
            node.classList.remove('gantt-hover-col');
        });
        _ganttHoverDate = '';
    }
}

function syncGanttHoverGuide(rowEl, dateStr) {
    if (_ganttHoverRowEl !== rowEl) {
        if (_ganttHoverRowEl) _ganttHoverRowEl.classList.remove('gantt-hover-row');
        _ganttHoverRowEl = rowEl || null;
        _ganttHoverRowEl?.classList.add('gantt-hover-row');
    }
    if (_ganttHoverDate !== dateStr) {
        if (_ganttHoverDate) {
            document.querySelectorAll(`[data-gantt-date="${_ganttHoverDate}"]`).forEach(node => {
                node.classList.remove('gantt-hover-col');
            });
        }
        _ganttHoverDate = dateStr || '';
        if (_ganttHoverDate) {
            document.querySelectorAll(`[data-gantt-date="${_ganttHoverDate}"]`).forEach(node => {
                node.classList.add('gantt-hover-col');
            });
        }
    }
}

function resolveGanttHoverDate(track, clientX) {
    const days = String(track?.dataset?.ganttDays || '').split(',').filter(Boolean);
    if (!days.length) return '';
    const rect = track.getBoundingClientRect();
    if (!rect.width) return '';
    const offset = Math.max(0, Math.min(rect.width - 1, clientX - rect.left));
    const dayWidth = rect.width / Math.max(days.length, 1);
    const index = Math.max(0, Math.min(days.length - 1, Math.floor(offset / Math.max(dayWidth, 1))));
    return days[index] || '';
}

function _ganttHoverMoveHandler(event) {
    const track = event.target.closest('.gr-track[data-gantt-days]');
    const row = track?.closest('.gr');
    const dateStr = track ? resolveGanttHoverDate(track, event.clientX) : '';
    if (!track || !row || !dateStr) {
        clearGanttHoverGuide();
        return;
    }
    syncGanttHoverGuide(row, dateStr);
}

function _ganttHoverLeaveHandler() {
    clearGanttHoverGuide();
}

function wireGanttHoverGuide() {
    const inner = document.getElementById('ganttInner');
    if (!inner) return;
    inner.removeEventListener('pointermove', _ganttHoverMoveHandler);
    inner.removeEventListener('pointerleave', _ganttHoverLeaveHandler);
    inner.addEventListener('pointermove', _ganttHoverMoveHandler);
    inner.addEventListener('pointerleave', _ganttHoverLeaveHandler);
}

function saveGanttScrollPos() {
    const root = document.getElementById('ganttScrollRoot');
    if (!root) return null;
    return {
        left: root.scrollLeft || 0,
        top: root.scrollTop || 0,
    };
}

function restoreGanttScrollPos(pos) {
    const root = document.getElementById('ganttScrollRoot');
    if (!root || !pos) return;
    requestAnimationFrame(() => {
        root.scrollLeft = pos.left || 0;
        root.scrollTop = pos.top || 0;
    });
}

function _pushUndo(changes) {
    _undoStack.push(changes);
    if (_undoStack.length > _UNDO_LIMIT) _undoStack.shift();
    _redoStack.length = 0;      // new action clears redo branch
    _syncUndoButtons();
}

function _pushUndoAction(action) {
    _undoStack.push(action);
    if (_undoStack.length > _UNDO_LIMIT) _undoStack.shift();
    _redoStack.length = 0;
    _syncUndoButtons();
}

if (window.__ppmsShared) {
    window.__ppmsShared.registerGanttUndoAction = action => _pushUndoAction(action);
}

function _syncUndoButtons() {
    const btnU = document.getElementById('btnGanttUndo');
    const btnR = document.getElementById('btnGanttRedo');
    if (btnU) {
        btnU.disabled = _undoStack.length === 0;
        btnU.setAttribute('title', _undoStack.length
            ? 'Undo last move (' + _undoStack.length + ' in history)'
            : 'Nothing to undo');
    }
    if (btnR) {
        btnR.disabled = _redoStack.length === 0;
        btnR.setAttribute('title', _redoStack.length
            ? 'Redo (' + _redoStack.length + ' available)'
            : 'Nothing to redo');
    }
}

function _clearUndoHistory() {
    _undoStack.length = 0;
    _redoStack.length = 0;
    _syncUndoButtons();
}

function _syncSelectedBlockUi() {
    const validIds = new Set(currentData.map(row => String(row.id)));
    [..._selectedGanttPlanIds].forEach(id => {
        if (!validIds.has(String(id))) _selectedGanttPlanIds.delete(id);
    });
    document.querySelectorAll('.gc-bar[data-plan-id]').forEach(bar => {
        const id = bar.dataset.planId;
        const selected = _selectedGanttPlanIds.has(id);
        bar.classList.toggle('gc-bar-selected', selected);
        const btn = bar.querySelector('.gc-bar-select');
        if (btn) {
            btn.classList.toggle('gc-bar-select-active', selected);
            btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
        }
    });
    const count = _selectedGanttPlanIds.size;
    const countEl = document.getElementById('ganttSelectedCount');
    const delBtn = document.getElementById('btnDeleteSelectedBlocks');
    if (countEl) countEl.textContent = String(count);
    if (delBtn) delBtn.disabled = count === 0;
    document.querySelectorAll('[data-gantt-lane-select]').forEach(btn => {
        const planId = btn.dataset.ganttLaneSelect;
        const anchor = currentData.find(row => String(row.id) === planId);
        if (!anchor) return;
        const laneRows = currentData.filter(row => samePlanLane(row, anchor));
        const allSelected = laneRows.length > 0 && laneRows.every(row => _selectedGanttPlanIds.has(String(row.id)));
        btn.textContent = allSelected ? 'Clear lane' : 'Select lane';
        btn.setAttribute('aria-pressed', allSelected ? 'true' : 'false');
    });
}

function toggleGanttLaneSelection(task, forceSelect = null) {
    if (!task) return;
    const laneRows = currentData.filter(row => samePlanLane(row, task));
    if (!laneRows.length) return;
    const shouldSelect = forceSelect === null
        ? !laneRows.every(row => _selectedGanttPlanIds.has(String(row.id)))
        : !!forceSelect;
    laneRows.forEach(row => {
        if (shouldSelect) _selectedGanttPlanIds.add(String(row.id));
        else _selectedGanttPlanIds.delete(String(row.id));
    });
    _syncSelectedBlockUi();
}

function setGanttLaneSelectMode(on) {
    _ganttSelectLaneMode = !!on && (isKD2Module() || isF100KD2Module());
    const btn = document.getElementById('gmtSelectLane');
    if (btn) {
        btn.classList.toggle('gmt-active', _ganttSelectLaneMode);
        btn.setAttribute('aria-pressed', _ganttSelectLaneMode ? 'true' : 'false');
    }
    const gsEl = document.getElementById('ganttStart');
    const geEl = document.getElementById('ganttEnd');
    if (gsEl?.value && geEl?.value) renderGantt(currentData, gsEl.value, geEl.value);
}

function syncGanttModuleEditControls() {
    const isKd2 = isKD2Module() || isF100KD2Module();
    const isF100 = isF100KD2Module();
    const kd2Tools = document.getElementById('ganttKd2EditTools');
    const planBtn = document.getElementById('gmtPlan');
    const fromBlockBtn = document.getElementById('gmtFromBlock');
    const satWrap = document.getElementById('ganttSatToggleWrap');
    const visualAddShell = document.getElementById('ganttVisualAddShell');
    const viewToggleWrap = document.getElementById('ganttViewToggleWrap');
    const templateBtn = document.getElementById('btnF100AddTemplate');
    if (kd2Tools) kd2Tools.style.display = _ganttEditMode && isKd2 ? 'inline-flex' : 'none';
    if (visualAddShell) visualAddShell.style.display = _ganttEditMode && isKd2 ? 'inline-flex' : 'none';
    if (templateBtn) templateBtn.style.display = _ganttEditMode && isF100 ? '' : 'none';
    if (planBtn) planBtn.style.display = isKd2 ? 'none' : '';
    if (fromBlockBtn) fromBlockBtn.style.display = isKd2 ? '' : 'none';
    if (satWrap) satWrap.style.display = isKd2 ? 'none' : '';
    if (viewToggleWrap) viewToggleWrap.style.display = isKd2 ? '' : 'none';
    if ((!_ganttEditMode || !isKd2) && getModuleRuntime()?.toggleTimelineVisualMenu) {
        getModuleRuntime().toggleTimelineVisualMenu(false);
    }
    if (isKd2 && _ganttMoveMode === 'plan') _ganttMoveMode = 'single';
    if (!isKd2 && _ganttMoveMode === 'from-block') _ganttMoveMode = 'single';
    if (!isKd2) _ganttSelectLaneMode = false;
    const moveToggle = document.getElementById('ganttMoveToggle');
    if (moveToggle) {
        moveToggle.querySelectorAll('.gmt-btn[data-mode]').forEach(btn => {
            btn.classList.toggle('gmt-active', btn.dataset.mode === _ganttMoveMode);
        });
    }
    const btn = document.getElementById('gmtSelectLane');
    if (btn) {
        btn.classList.toggle('gmt-active', _ganttSelectLaneMode);
        btn.setAttribute('aria-pressed', _ganttSelectLaneMode ? 'true' : 'false');
    }
}

/* ── Toggle edit mode ────────────────────────────────────────────── */
function setGanttEditMode(on) {
    _ganttEditMode = on;
    if (!on) {
        _openGanttBlockMenuPlanId = null;
        _selectedGanttPlanIds.clear();
        _ganttSelectLaneMode = false;
        if (isF100KD2Module()) cancelF100Placement();
    }
    document.getElementById('ganttEditBar').style.display = on ? 'flex' : 'none';
    document.getElementById('btnGanttEdit').style.display = on ? 'none' : '';
    // Sync undo button states whenever edit mode changes
    _syncUndoButtons();
    syncGanttModuleEditControls();

    // Sync Saturday checkbox with current session value
    const satCk = document.getElementById('ganttSatToggle');
    if (satCk) satCk.checked = _ganttSatAllowed;

    // Re-render so bars get / lose draggable handles
    const gsEl = document.getElementById('ganttStart');
    const geEl = document.getElementById('ganttEnd');
    renderGantt(currentData, gsEl?.value, geEl?.value);

    // Toggle CSS edit-mode class on the gantt body
    const body = document.querySelector('.gantt-body');
    if (body) body.classList.toggle('gantt-edit-active', on);
    _syncSelectedBlockUi();
}

/* ── Saturday modal (promise-based) ─────────────────────────────── */
function askSaturday() {
    return new Promise(resolve => {
        if (_ganttSatAsked) { resolve(_ganttSatAllowed); return; }
        const overlay = document.getElementById('satModalOverlay');
        overlay.style.display = 'flex';

        const yes = document.getElementById('satModalYes');
        const no = document.getElementById('satModalNo');

        function finish(allow) {
            overlay.style.display = 'none';
            _ganttSatAsked = true;
            _ganttSatAllowed = allow;
            yes.removeEventListener('click', onYes);
            no.removeEventListener('click', onNo);
            resolve(allow);
        }
        function onYes() { finish(true); }
        function onNo() { finish(false); }
        yes.addEventListener('click', onYes);
        no.addEventListener('click', onNo);
    });
}

/* ── Date arithmetic helpers ─────────────────────────────────────── */

/** Add `n` calendar days to a YYYY-MM-DD string */
/**
 * Format a Date object as YYYY-MM-DD using LOCAL date parts.
 * This avoids the UTC-rollback bug: toISOString() converts to UTC first,
 * which subtracts hours for timezones east of UTC (e.g. Cairo UTC+2),
 * causing dates to silently shift back by one day.
 */
function localDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return localDateStr(d);
}

/** Difference in calendar days: dateB − dateA (positive = B is after A) */
function dayDiff(dateA, dateB) {
    const a = new Date(dateA + 'T00:00:00');
    const b = new Date(dateB + 'T00:00:00');
    return Math.round((b - a) / 86400000);
}

/**
 * Advance a date forward if it lands on a non-working day.
 * Friday (5) is always skipped.
 * Saturday (6) skipped unless allowSat === true.
 */
function skipNonWorking(dateStr, allowSat) {
    const d = new Date(dateStr + 'T00:00:00');
    const skip = day => day === 5 || (!allowSat && day === 6);
    let guard = 0;
    while (skip(d.getDay()) && guard++ < 7) {
        d.setDate(d.getDate() + 1);
    }
    return localDateStr(d);
}

function isMoveWorkingDay(dateStr, allowSat) {
    const day = new Date(dateStr + 'T00:00:00').getDay();
    if (day === 5) return false;
    if (!allowSat && day === 6) return false;
    return true;
}

function nextMoveWorkingDate(dateStr, allowSat, direction = 1) {
    let d = dateStr;
    let guard = 0;
    while (!isMoveWorkingDay(d, allowSat) && guard++ < 14) {
        d = addDays(d, direction >= 0 ? 1 : -1);
    }
    return d;
}

function countWorkingDaysInclusive(startStr, endStr, allowSat) {
    let d = startStr;
    let count = 0;
    let guard = 0;
    while (d <= endStr && guard++ < 1000) {
        if (isMoveWorkingDay(d, allowSat)) count += 1;
        d = addDays(d, 1);
    }
    return Math.max(1, count);
}

function addWorkingDaysInclusive(startStr, durationDays, allowSat) {
    let d = nextMoveWorkingDate(startStr, allowSat, 1);
    let worked = 1;
    let guard = 0;
    while (worked < durationDays && guard++ < 1000) {
        d = addDays(d, 1);
        if (isMoveWorkingDay(d, allowSat)) worked += 1;
    }
    return d;
}

function shiftDateByGanttColumns(dateStr, deltaColumns, allowSat) {
    if (!deltaColumns) return nextMoveWorkingDate(dateStr, allowSat, 1);
    let d = dateStr;
    let moved = 0;
    const direction = deltaColumns > 0 ? 1 : -1;
    const target = Math.abs(deltaColumns);
    let guard = 0;
    while (moved < target && guard++ < 1000) {
        d = addDays(d, direction);
        if (isMoveWorkingDay(d, allowSat)) moved += 1;
    }
    return nextMoveWorkingDate(d, allowSat, direction);
}

function isVisibleGanttDate(dateStr) {
    return new Date(dateStr + 'T00:00:00').getDay() !== 5;
}

function shiftDateByVisibleGanttColumns(dateStr, deltaColumns) {
    if (!deltaColumns) return dateStr;
    let d = dateStr;
    let moved = 0;
    const direction = deltaColumns > 0 ? 1 : -1;
    const target = Math.abs(deltaColumns);
    let guard = 0;
    while (moved < target && guard++ < 1000) {
        d = addDays(d, direction);
        if (isVisibleGanttDate(d)) moved += 1;
    }
    return d;
}

/**
 * Shift a task by rendered Gantt columns, not raw calendar days.
 * This preserves the visible bar width when Friday is hidden from the grid.
 */
function shiftTask(task, deltaColumns, allowSat) {
    const newStart = shiftDateByVisibleGanttColumns(task.start_date, deltaColumns);
    const newEnd = shiftDateByVisibleGanttColumns(task.end_date, deltaColumns);
    return { newStart, newEnd };
}

function shiftTaskForGanttEdit(task, deltaColumns, allowSat) {
    if (isKD2Module()) {
        const targetStart = shiftDateByVisibleGanttColumns(task.start_date, deltaColumns);
        const shifted = getModuleRuntime()?.shiftPlanRowToStart?.(task, targetStart);
        if (shifted?.start && shifted?.end) {
            return { newStart: shifted.start, newEnd: shifted.end };
        }
    }
    return shiftTask(task, deltaColumns, allowSat);
}

/* ── Cascade logic ───────────────────────────────────────────────── */
/**
 * Given a moved task and the shift delta, cascade all subsequent tasks
 * of the same vehicle+unit that originally started ON OR AFTER the
 * moved task's original start date (excluding the moved task itself).
 *
 * Returns an array of { id, newStart, newEnd, oldStart, oldEnd }.
 */
function cascadeTasks(movedTask, deltaDays, allowSat) {
    const { start_date: origStart, id: movedId } = movedTask;

    const siblings = currentData.filter(t =>
        samePlanLane(t, movedTask) &&
        t.id !== movedId &&
        t.start_date > origStart   // strictly AFTER the moved task (avoids overlap-lock)
    );

    return siblings.map(t => {
        const { newStart, newEnd } = shiftTask(t, deltaDays, allowSat);
        return { id: t.id, newStart, newEnd, oldStart: t.start_date, oldEnd: t.end_date, task: t };
    });
}

/* ── Save plan changes to Supabase — single batch upsert ────────── */
/**
 * Low-level batch date update — fires DB writes in parallel.
 * Used by both savePlanChanges AND undo/redo.
 * Does NOT push to undo stack or show "saving" toast.
 * Returns true on success, false on error.
 */
async function _applyDateChanges(changes) {
    const results = await Promise.all(
        changes.map(ch =>
            db.from(getModulePlanTable())
                .update(getModulePlanDatePayload(ch.newStart, ch.newEnd))
                .eq('id', ch.id)
                .select('id')
        )
    );
    const failed = results.filter(r => r.error);
    if (failed.length) throw new Error(failed[0].error.message);

    changes.forEach(ch => {
        const row = currentData.find(t => t.id === ch.id);
        if (row) {
            row.start_date = ch.newStart;
            row.end_date = ch.newEnd;
            row.week = weekLabel(ch.newStart);
            if (isF100KD2Module()) {
                row.planned_start_date = ch.newStart;
                row.planned_end_date   = ch.newEnd;
            }
        }
    });
}

async function savePlanChanges(changes) {
    if (!changes.length) return;
    markLocalSave();
    showToast(`Saving ${changes.length} block${changes.length > 1 ? 's' : ''}…`, 'info');

    try {
        await _applyDateChanges(changes);

        await auditLog('UPDATE', getModulePlanTable(), 'batch-move',
            { count: changes.length, ids: changes.map(c => c.id) },
            { count: changes.length, sample: { id: changes[0].id, newStart: changes[0].newStart } }
        );

        showToast(`${changes.length} block${changes.length > 1 ? 's' : ''} rescheduled ✓`, 'success');
        _pushUndo(changes);
        refreshAllViews();
    } catch (err) {
        showToast('Error saving plan: ' + err.message, 'error');
        console.error(err);
        await loadData();
    }
}


/* ── Undo / Redo ─────────────────────────────────────────────────── */

async function undoGantt() {
    if (!_undoStack.length) return;
    const changes = _undoStack.pop();

    if (!Array.isArray(changes)) {
        showToast(`Undoing ${changes.label || 'action'}…`, 'info');
        try {
            await changes.undo?.();
            _redoStack.push(changes);
            _syncUndoButtons();
            showToast('Undo applied ✓', 'success');
            await loadData();
        } catch (err) {
            _undoStack.push(changes);
            showToast('Undo failed: ' + err.message, 'error');
            console.error(err);
            await loadData();
        }
        return;
    }

    // Invert: swap newStart↔oldStart, newEnd↔oldEnd
    const inverse = changes.map(ch => ({
        id: ch.id,
        newStart: ch.oldStart,
        newEnd: ch.oldEnd,
        oldStart: ch.newStart,
        oldEnd: ch.newEnd,
    }));

    showToast(`Undoing ${inverse.length} block move${inverse.length > 1 ? 's' : ''}…`, 'info');
    try {
        await _applyDateChanges(inverse);
        await auditLog('UPDATE', getModulePlanTable(), 'undo',
            { count: inverse.length }, { count: inverse.length, sample: { id: inverse[0].id, newStart: inverse[0].newStart } });

        _redoStack.push(changes);   // original forward changes become redo
        _syncUndoButtons();
        showToast('Undo applied ✓', 'success');
        refreshAllViews();
    } catch (err) {
        _undoStack.push(changes);   // put back on failure
        showToast('Undo failed: ' + err.message, 'error');
        console.error(err);
        await loadData();
    }
}

async function redoGantt() {
    if (!_redoStack.length) return;
    const changes = _redoStack.pop();

    if (!Array.isArray(changes)) {
        showToast(`Redoing ${changes.label || 'action'}…`, 'info');
        try {
            await changes.redo?.();
            _undoStack.push(changes);
            _syncUndoButtons();
            showToast('Redo applied ✓', 'success');
            await loadData();
        } catch (err) {
            _redoStack.push(changes);
            showToast('Redo failed: ' + err.message, 'error');
            console.error(err);
            await loadData();
        }
        return;
    }

    showToast(`Redoing ${changes.length} block move${changes.length > 1 ? 's' : ''}…`, 'info');
    try {
        await _applyDateChanges(changes);
        await auditLog('UPDATE', getModulePlanTable(), 'redo',
            { count: changes.length }, { count: changes.length, sample: { id: changes[0].id, newStart: changes[0].newStart } });

        _undoStack.push(changes);   // goes back onto undo stack
        _syncUndoButtons();
        showToast('Redo applied ✓', 'success');
        refreshAllViews();
    } catch (err) {
        _redoStack.push(changes);   // put back on failure
        showToast('Redo failed: ' + err.message, 'error');
        console.error(err);
        await loadData();
    }
}
/* ── Drag-and-drop engine attached to rendered bars ─────────────── */

/**
 * Called from renderGantt after bars are injected into the DOM.
 * Finds all .gc-bar[data-plan-id] elements and attaches pointer-drag handlers.
 */
function wireGanttDragEdit(dayIndex, days) {
    if (!_ganttEditMode) return;

    const bars = document.querySelectorAll('.gc-bar[data-plan-id]');
    bars.forEach(bar => {
        bar.style.cursor = 'grab';
        bar.addEventListener('pointerdown', onBarPointerDown);
    });

    function onBarPointerDown(e) {
        if (!_ganttEditMode) return;
        if (!canEditPlan()) { showToast('Only planners and admins can edit the plan.', 'error'); return; }
        // Let block menu controls handle their own clicks instead of starting a drag.
        if (e.target.closest('.gc-bar-menu') || e.target.closest('.gc-bar-menu-trigger') || e.target.closest('.gc-bar-select') || e.target.closest('.gc-bar-delete') || e.target.closest('.gc-bar-edit') || e.target.closest('.gc-bar-lane')) return;

        e.preventDefault();
        const bar = e.currentTarget;
        const planId = bar.dataset.planId;
        const task = currentData.find(t => String(t.id) === planId);
        if (!task) return;

        const previewMoveSet = _ganttMoveMode === 'lane'
            ? currentData.filter(row => samePlanLane(row, task))
            : _ganttMoveMode === 'from-block'
                ? (isF100KD2Module() ? getF100ForwardMoveRows(task, currentData) : getKd2ForwardMoveRows(task, currentData))
                : _selectedGanttPlanIds.has(planId) && _selectedGanttPlanIds.size > 1 && _ganttMoveMode === 'single'
                    ? currentData.filter(row => _selectedGanttPlanIds.has(String(row.id)))
                    : [task];
        const selectedDragIds = new Set(previewMoveSet.map(row => String(row.id)));
        const dragBars = [...document.querySelectorAll('.gc-bar[data-plan-id]')]
            .filter(item => selectedDragIds.has(item.dataset.planId));
        const origLeftById = new Map(dragBars.map(item => [item.dataset.planId, parseInt(item.style.left)]));

        bar.setPointerCapture(e.pointerId);
        dragBars.forEach(item => {
            item.style.cursor = 'grabbing';
            item.style.opacity = '0.75';
            item.style.zIndex = '999';
            item.style.boxShadow = '0 8px 32px rgba(0,0,0,.6), 0 0 0 2px #4f8ef7';
            item.style.transition = 'none';
        });

        const startX = e.clientX;
        let deltaPx = 0;
        let deltaDays = 0;

        function onMove(ev) {
            deltaPx = ev.clientX - startX;
            deltaDays = Math.round(deltaPx / GANTT_DAY_W);
            dragBars.forEach(item => {
                const id = item.dataset.planId;
                item.style.left = ((origLeftById.get(id) ?? parseInt(item.style.left)) + deltaDays * GANTT_DAY_W) + 'px';
            });
        }

        async function onUp() {
            bar.releasePointerCapture(e.pointerId);
            bar.removeEventListener('pointermove', onMove);
            bar.removeEventListener('pointerup', onUp);
            dragBars.forEach(item => {
                item.style.cursor = 'grab';
                item.style.opacity = '1';
                item.style.zIndex = '';
                item.style.transition = '';
            });

            if (deltaDays === 0) {
                dragBars.forEach(item => {
                    const id = parseInt(item.dataset.planId, 10);
                    item.style.left = (origLeftById.get(id) ?? parseInt(item.style.left)) + 'px';
                });
                return;
            }

            const allowSat = isKD2Module() ? false : await askSaturday();
            const moveSet = await resolveGanttMoveSet(task);
            const allChanges = moveSet.map(t => {
                const { newStart, newEnd } = shiftTaskForGanttEdit(t, deltaDays, allowSat);
                return { id: t.id, newStart, newEnd, oldStart: t.start_date, oldEnd: t.end_date };
            });

            dragBars.forEach(item => {
                const id = item.dataset.planId;
                item.style.left = (origLeftById.get(id) ?? parseInt(item.style.left)) + 'px';
            }); // reset; re-render fixes it

            await savePlanChanges(allChanges);

            const gsEl = document.getElementById('ganttStart');
            const geEl = document.getElementById('ganttEnd');
            renderGantt(currentData, gsEl?.value, geEl?.value);
        }

        bar.addEventListener('pointermove', onMove);
        bar.addEventListener('pointerup', onUp);
    }
}

/* ── Wire into ganttControls (extend wireGanttControls) ─────────── */
const _origWireGantt = wireGanttControls;
wireGanttControls = function () {
    _origWireGantt();

    document.getElementById('btnGanttViewUnit')?.addEventListener('click', () => {
        getModuleRuntime()?.setTimelineViewMode?.('unit', { skipRender: true });
        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        if (gsEl?.value && geEl?.value) {
            const category = getVal('filterCategory');
            const data = category ? currentData.filter(r => getModuleCategory(r.process_station, r) === category) : currentData;
            renderGantt(data, gsEl.value, geEl.value);
        }
    });
    document.getElementById('btnGanttViewProcess')?.addEventListener('click', () => {
        getModuleRuntime()?.setTimelineViewMode?.('process', { skipRender: true });
        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        if (gsEl?.value && geEl?.value) {
            const category = getVal('filterCategory');
            const data = category ? currentData.filter(r => getModuleCategory(r.process_station, r) === category) : currentData;
            renderGantt(data, gsEl.value, geEl.value);
        }
    });

    document.getElementById('btnGanttEdit')?.addEventListener('click', () => setGanttEditMode(true));
    document.getElementById('btnGanttEditDone')?.addEventListener('click', () => {
        _ganttSatAsked = false; // reset for next edit session
        setGanttEditMode(false);
    });

    // Saturday toggle checkbox (updates the session preference live)
    document.getElementById('ganttSatToggle')?.addEventListener('change', function () {
        _ganttSatAllowed = this.checked;
        _ganttSatAsked = true;
    });

    // Move-mode toggle
    document.getElementById('ganttMoveToggle')?.addEventListener('click', function (e) {
        const btn = e.target.closest('.gmt-btn');
        if (!btn) return;
        _ganttMoveMode = btn.dataset.mode;
        this.querySelectorAll('.gmt-btn').forEach(b => b.classList.toggle('gmt-active', b === btn));
    });
    document.getElementById('gmtSelectLane')?.addEventListener('click', () => {
        setGanttLaneSelectMode(!_ganttSelectLaneMode);
    });
    document.getElementById('btnGanttNoWorkDays')?.addEventListener('click', () => {
        if (!isKD2Module() && !isF100KD2Module()) return;
        getModuleRuntime()?.openNoWorkModal?.();
    });

    // Undo / Redo buttons
    document.getElementById('btnGanttUndo')?.addEventListener('click', undoGantt);
    document.getElementById('btnGanttRedo')?.addEventListener('click', redoGantt);
    document.getElementById('btnDeleteSelectedBlocks')?.addEventListener('click', deleteSelectedGanttBlocks);

    // Keyboard: Ctrl+Z = undo, Ctrl+Y or Ctrl+Shift+Z = redo (only while in edit mode)
    document.addEventListener('keydown', function (e) {
        if (!_ganttEditMode) return;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undoGantt(); }
        if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redoGantt(); }
    });
    syncGanttModuleEditControls();
};

/* ── Patch renderGantt to pass data-plan-id on bars and wire drag ── */
/* ── Extend renderGantt: wire drag handles + re-apply edit class ── */
const _origRenderGantt = renderGantt;
renderGantt = function (plans, startDate, endDate) {
    _origRenderGantt(plans, startDate, endDate);

    // data-plan-id is now baked directly into each bar's HTML, so no
    // post-render tagging is needed.  We only need to attach drag handlers.
    if (!plans?.length || !startDate || !endDate) return;

    const days2 = generateDateRange(startDate, endDate)
        .filter(d => new Date(d + 'T00:00:00').getDay() !== 5);   // exclude Fridays
    const dayIdx2 = {};
    days2.forEach((d, i) => { dayIdx2[d] = i; });

    wireGanttDragEdit(dayIdx2, days2);

    // Re-apply edit-active CSS class (re-render rebuilds the DOM)
    if (_ganttEditMode) {
        const body = document.querySelector('.gantt-body');
        if (body) body.classList.add('gantt-edit-active');
    }
    _syncSelectedBlockUi();
};

/* ================================================================
   GANTT BLOCK MANAGEMENT — delete & add
   ================================================================ */

function showGanttConfirmDialog({
    title = 'Confirm Action',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
} = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        overlay.innerHTML = `
            <div class="modal" style="max-width:420px">
                <div class="modal-header">
                    <h4 class="modal-title">${esc(title)}</h4>
                    <button class="modal-close" type="button" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="modal-info" style="white-space:pre-line">${esc(message)}</div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-ghost" type="button" data-confirm-cancel>${esc(cancelLabel)}</button>
                    <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-confirm-ok>${esc(confirmLabel)}</button>
                </div>
            </div>`;

        const host = isGanttFullscreen() ? (getGanttCardHost() || document.body) : document.body;
        host.appendChild(overlay);

        const cancelBtn = overlay.querySelector('[data-confirm-cancel]');
        const confirmBtn = overlay.querySelector('[data-confirm-ok]');
        const closeBtn = overlay.querySelector('.modal-close');

        function cleanup(result) {
            document.removeEventListener('keydown', onKeyDown, true);
            overlay.remove();
            resolve(result);
        }

        function onKeyDown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                cleanup(false);
            }
        }

        overlay.addEventListener('click', event => {
            if (event.target === overlay) cleanup(false);
        });
        cancelBtn?.addEventListener('click', () => cleanup(false));
        closeBtn?.addEventListener('click', () => cleanup(false));
        confirmBtn?.addEventListener('click', () => cleanup(true));
        document.addEventListener('keydown', onKeyDown, true);
        confirmBtn?.focus();
    });
}

function cloneGanttTaskSnapshot(task) {
    return JSON.parse(JSON.stringify(task));
}

function planRestorePayload(task) {
    if (isF100KD2Module()) {
        return {
            id: task.id,
            planned_start_date: task.planned_start_date || task.start_date,
            planned_end_date: task.planned_end_date || task.end_date,
        };
    }
    if (isKD2Module()) {
        return {
            id: task.id,
            battalion_id: task.battalion_id,
            vehicle_type: task.vehicle_type || task.vehicle,
            unit_serial: task.unit_serial ?? task.vehicle_no ?? null,
            unit_label: task.unit_label ?? task.vehicle_no ?? null,
            category_code: task.category_code ?? null,
            station_code: task.station_code ?? null,
            planned_start_date: task.planned_start_date || task.start_date,
            planned_end_date: task.planned_end_date || task.end_date,
            planning_source: task.planning_source || 'manual',
            remark: task.remark || null,
        };
    }
    return {
        id: task.id,
        vehicle: task.vehicle,
        vehicle_no: task.vehicle_no,
        process_station: task.process_station,
        week: task.week || weekLabel(task.start_date),
        start_date: task.start_date,
        end_date: task.end_date,
        remark: task.remark || null,
    };
}

function progressRestorePayload(task) {
    if (!task?.progress?.id) return null;
    return {
        id: task.progress.id,
        plan_id: task.id,
        completed: !!task.progress.completed,
        completion_date: task.progress.completion_date || null,
        actual_start_date: task.progress.actual_start_date || null,
        notes: task.progress.notes || null,
        updated_at: task.progress.updated_at || new Date().toISOString(),
    };
}

async function removeGanttTaskSnapshots(tasks, auditLabel = 'delete') {
    if (!tasks.length) return;
    // F100 has no separate progress table — skip progress row deletion
    if (!isF100KD2Module()) {
        const progressIds = tasks.map(task => task.progress?.id).filter(Boolean);
        if (progressIds.length) {
            const { error: progressError } = await db.from(getModuleProgressTable()).delete().in('id', progressIds);
            if (progressError) throw progressError;
        }
    }

    const planIds = tasks.map(task => task.id);
    const { error } = await db.from(getModulePlanTable()).delete().in('id', planIds);
    if (error) throw error;

    if (tasks.length === 1) {
        const task = tasks[0];
        await auditLog('DELETE', getModulePlanTable(), task.id, {
            vehicle: task.vehicle,
            vehicle_no: task.vehicle_no,
            process_station: task.process_station,
            start_date: task.start_date,
            end_date: task.end_date,
        }, null);
        return;
    }

    await auditLog('DELETE', getModulePlanTable(), auditLabel, {
        count: tasks.length,
        ids: planIds,
    }, null);
}

async function restoreGanttTaskSnapshots(tasks, auditLabel = 'restore') {
    if (!tasks.length) return;
    const planPayload = tasks.map(planRestorePayload);
    const { error: planError } = await db.from(getModulePlanTable()).upsert(planPayload, { onConflict: 'id' });
    if (planError) throw planError;

    // F100 has no separate progress table — skip progress restore
    if (!isF100KD2Module()) {
        const progressPayload = tasks.map(progressRestorePayload).filter(Boolean);
        if (progressPayload.length) {
            const { error: progressError } = await db.from(getModuleProgressTable()).upsert(progressPayload, { onConflict: 'id' });
            if (progressError) throw progressError;
        }
    }

    await auditLog('INSERT', getModulePlanTable(), auditLabel, null, {
        count: tasks.length,
        ids: tasks.map(task => task.id),
    });
}

/* ── Delete a block ──────────────────────────────────────────────── */
async function deleteGanttBlock(planId) {
    if (!canEditPlan()) { showToast('Only planners and admins can delete blocks.', 'error'); return; }

    const task = currentData.find(t => String(t.id) === String(planId));
    if (!task) return;

    const confirmed = await showGanttConfirmDialog({
        title: 'Delete Block',
        message: `Delete "${task.process_station}" for ${task.vehicle} ${task.vehicle_no}?\n${formatDate(task.start_date)} -> ${formatDate(task.end_date)}\n\nYou can undo this from Gantt history.`,
        confirmLabel: 'Delete',
        danger: true,
    });
    if (!confirmed) return;

    try {
        const snapshots = [cloneGanttTaskSnapshot(task)];
        await removeGanttTaskSnapshots(snapshots, 'delete-single');

        // Remove from in-memory data
        currentData = currentData.filter(t => String(t.id) !== String(planId));
        delete _ganttVisualLane[planId];
        delete _ganttManualLane[planId];
        _selectedGanttPlanIds.delete(String(planId));
        _pushUndoAction({
            label: 'block delete',
            undo: () => restoreGanttTaskSnapshots(snapshots, 'undo-delete'),
            redo: () => removeGanttTaskSnapshots(snapshots, 'redo-delete'),
        });

        showToast(`"${task.process_station}" deleted.`, 'success');

        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        renderGantt(currentData, gsEl?.value, geEl?.value);

    } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
        console.error(err);
    }
}

async function deleteSelectedGanttBlocks() {
    if (!canEditPlan()) { showToast('Only planners and admins can delete blocks.', 'error'); return; }
    const selectedTasks = currentData.filter(task => _selectedGanttPlanIds.has(String(task.id)));
    if (!selectedTasks.length) return;
    const confirmed = await showGanttConfirmDialog({
        title: 'Delete Selected Blocks',
        message: `Delete ${selectedTasks.length} selected block${selectedTasks.length > 1 ? 's' : ''}?\n\nYou can undo this from Gantt history.`,
        confirmLabel: 'Delete',
        danger: true,
    });
    if (!confirmed) return;

    try {
        const snapshots = selectedTasks.map(cloneGanttTaskSnapshot);
        const planIds = snapshots.map(task => task.id);
        await removeGanttTaskSnapshots(snapshots, 'batch-delete');

        currentData = currentData.filter(task => !planIds.includes(task.id));
        planIds.forEach(id => { delete _ganttVisualLane[id]; delete _ganttManualLane[id]; });
        planIds.forEach(id => _selectedGanttPlanIds.delete(id));
        _pushUndoAction({
            label: `${snapshots.length} block delete${snapshots.length > 1 ? 's' : ''}`,
            undo: () => restoreGanttTaskSnapshots(snapshots, 'undo-batch-delete'),
            redo: () => removeGanttTaskSnapshots(snapshots, 'redo-batch-delete'),
        });
        _syncSelectedBlockUi();
        showToast(`${selectedTasks.length} selected block${selectedTasks.length > 1 ? 's' : ''} deleted.`, 'success');

        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        renderGantt(currentData, gsEl?.value, geEl?.value);
    } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
        console.error(err);
    }
}

/* ── Wire bar action buttons via event delegation on ganttInner ── */
function _closeAllBarMenus() {
    document.querySelectorAll('.gc-bar-menu-open').forEach(bar => {
        bar.classList.remove('gc-bar-menu-open', 'gc-bar-menu-below');
    });
    document.querySelectorAll('.gc-row-menu-open').forEach(row => row.classList.remove('gc-row-menu-open'));
    document.querySelectorAll('.gc-bar-menu-trigger').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
    _openGanttBlockMenuPlanId = null;
}

function wireBarDeleteButtons() {
    // Use event delegation on the gantt body — avoids the timing race
    // where pointerdown captures before click fires on child buttons.
    const inner = document.getElementById('ganttInner');
    if (!inner) return;

    // Remove any existing delegated listener before re-adding (avoids duplicates)
    inner.removeEventListener('click', _ganttBarClickHandler);
    inner.addEventListener('click', _ganttBarClickHandler);

    // Click-outside: close any open bar menu when clicking anywhere outside a bar
    document.removeEventListener('click', _ganttClickOutsideHandler);
    document.addEventListener('click', _ganttClickOutsideHandler);
}

function _ganttClickOutsideHandler(e) {
    if (!_openGanttBlockMenuPlanId) return;
    if (e.target.closest('.gc-bar-menu') || e.target.closest('.gc-bar-menu-trigger')) return;
    _closeAllBarMenus();
}

function _ganttBarClickHandler(e) {
    const placementTrack = e.target.closest('.gr-track[data-kd2-track="true"]');
    const clickedBar = e.target.closest('.gc-bar');
    if (placementTrack && !clickedBar) {
        const days = String(placementTrack.dataset.ganttDays || '').split(',').filter(Boolean);
        if (days.length) {
            const rect = placementTrack.getBoundingClientRect();
            const offset = Math.max(0, Math.min(rect.width - 1, e.clientX - rect.left));
            const dayWidth = rect.width / Math.max(days.length, 1);
            const di = Math.max(0, Math.min(days.length - 1, Math.floor(offset / Math.max(dayWidth, 1))));
            const plannedStart = days[di] || '';
            if (plannedStart && isF100KD2Module() && _f100PlacementActive) {
                e.stopPropagation();
                placeF100VisualBlock(placementTrack, plannedStart);
                return;
            }
            if (plannedStart && isKD2Module() && getModuleRuntime()?.isPlacementActive?.()) {
                e.stopPropagation();
                getModuleRuntime()?.placePlanBlockFromGanttTrack?.(placementTrack, plannedStart);
                return;
            }
        }
    }
    const laneSelectBtn = e.target.closest('[data-gantt-lane-select]');
    if (laneSelectBtn) {
        e.stopPropagation();
        const planId = laneSelectBtn.dataset.ganttLaneSelect;
        const task = currentData.find(row => String(row.id) === planId);
        if (task) toggleGanttLaneSelection(task);
        return;
    }
    const selectBtn = e.target.closest('.gc-bar-select');
    if (selectBtn) {
        e.stopPropagation();
        const planId = selectBtn.dataset.planId;
        const task = currentData.find(row => String(row.id) === planId);
        if (_ganttSelectLaneMode && (isKD2Module() || isF100KD2Module()) && task) {
            toggleGanttLaneSelection(task);
            return;
        }
        if (_selectedGanttPlanIds.has(planId)) _selectedGanttPlanIds.delete(planId);
        else _selectedGanttPlanIds.add(planId);
        _syncSelectedBlockUi();
        return;
    }
    const menuTrigger = e.target.closest('.gc-bar-menu-trigger');
    if (menuTrigger) {
        e.stopPropagation();
        _openGanttBlockMenuPlanId = menuTrigger.dataset.planId;
        document.querySelectorAll('.gc-bar-menu-open').forEach(bar => bar.classList.remove('gc-bar-menu-open', 'gc-bar-menu-below'));
        document.querySelectorAll('.gc-row-menu-open').forEach(row => row.classList.remove('gc-row-menu-open'));
        const bar = menuTrigger.closest('.gc-bar');
        if (bar) bar.classList.add('gc-bar-menu-open');
        const row = menuTrigger.closest('.gr');
        if (row) row.classList.add('gc-row-menu-open');
        document.querySelectorAll('.gc-bar-menu-trigger').forEach(btn => btn.setAttribute('aria-expanded', btn === menuTrigger ? 'true' : 'false'));
        requestAnimationFrame(positionOpenGanttBlockMenu);
        return;
    }
    const menuClose = e.target.closest('.gc-bar-menu-close');
    if (menuClose) {
        e.stopPropagation();
        const planId = menuClose.dataset.planId;
        if (_openGanttBlockMenuPlanId === planId) _openGanttBlockMenuPlanId = null;
        const bar = menuClose.closest('.gc-bar');
        if (bar) bar.classList.remove('gc-bar-menu-open', 'gc-bar-menu-below');
        menuClose.closest('.gr')?.classList.remove('gc-row-menu-open');
        bar?.querySelector('.gc-bar-menu-trigger')?.setAttribute('aria-expanded', 'false');
        return;
    }
    // Delete button
    const delBtn = e.target.closest('.gc-bar-delete, .gc-bar-menu-delete');
    if (delBtn) {
        e.stopPropagation();
        const planId = delBtn.dataset.planId;
        deleteGanttBlock(planId);
        return;
    }
    // Edit button
    const editBtn = e.target.closest('.gc-bar-edit, .gc-bar-menu-edit');
    if (editBtn) {
        e.stopPropagation();
        const planId = editBtn.dataset.planId;
        if (isKD2Module()) {
            getModuleRuntime()?.openPlanEdit?.(parseInt(planId, 10));
            return;
        }
        if (isF100KD2Module()) {
            openF100EditBlockModal(planId);
            return;
        }
        openEditBlockModal(planId);
        return;
    }
    // Lane up button — decrease priority number (moves bar toward lane 0 = top)
    const laneUp = e.target.closest('.gc-bar-lane-up');
    if (laneUp) {
        e.stopPropagation();
        const planId = laneUp.dataset.planId;
        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        moveGanttBlockOneLane(planId, -1, gsEl?.value, geEl?.value);
        renderGantt(currentData, gsEl?.value, geEl?.value);
        return;
    }
    // Lane down button — increase priority number (moves bar toward higher lanes)
    const laneDown = e.target.closest('.gc-bar-lane-dn');
    if (laneDown) {
        e.stopPropagation();
        const planId = laneDown.dataset.planId;
        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        moveGanttBlockOneLane(planId, 1, gsEl?.value, geEl?.value);
        renderGantt(currentData, gsEl?.value, geEl?.value);
        return;
    }
}

/* ── Add Block modal ─────────────────────────────────────────────── */
function openAddBlockModal() {
    if (!canEditPlan()) { showToast('Only planners and admins can add blocks.', 'error'); return; }
    if (isKD2Module()) {
        getModuleRuntime()?.openPlanCreateModal?.();
        return;
    }
    if (isF100KD2Module()) {
        openF100AddBlockModal();
        return;
    }

    const overlay = document.getElementById('addBlockOverlay');

    // Populate vehicle dropdown from current data + "+ New Vehicle" option
    const vehicles = [...new Set(currentData.map(t => t.vehicle))].sort(vehicleSort);
    const vSel = document.getElementById('abVehicle');
    vSel.innerHTML =
        vehicles.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('') +
        `<option value="__new__">+ New Vehicle…</option>`;

    // Reset fields
    document.getElementById('abStart').value = todayStr();
    document.getElementById('abRemark').value = '';
    document.getElementById('abNewVehicle').value = '';
    document.getElementById('abNewVehicleGroup').style.display = 'none';
    document.getElementById('abError').style.display = 'none';

    // Populate unit dropdown for first vehicle
    updateAbUnits();
    updateAbPreview();

    overlay.style.display = 'flex';
}

function closeAddBlockModal() {
    document.getElementById('addBlockOverlay').style.display = 'none';
}

function updateAbUnits() {
    const vSel = document.getElementById('abVehicle');
    const vehicle = vSel.value;
    const uSel = document.getElementById('abUnit');
    const newVGrp = document.getElementById('abNewVehicleGroup');
    const newUGrp = document.getElementById('abNewUnitGroup');

    if (vehicle === '__new__') {
        newVGrp.style.display = 'block';
        uSel.innerHTML = `<option value="__new__">+ New Unit…</option>`;
        newUGrp.style.display = 'block';
        return;
    }
    newVGrp.style.display = 'none';

    const units = [...new Set(
        currentData.filter(t => t.vehicle === vehicle).map(t => t.vehicle_no)
    )].sort(naturalSort);

    uSel.innerHTML =
        units.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('') +
        `<option value="__new__">+ New Unit…</option>`;

    const uVal = uSel.value;
    newUGrp.style.display = (uVal === '__new__') ? 'block' : 'none';
}

/**
 * Compute end date from start + working-day duration,
 * skipping Friday and (optionally) Saturday.
 */
function computeEndDate(startStr, durationDays, allowSat) {
    let d = new Date(startStr + 'T00:00:00');
    let worked = 0;
    const isFri = day => day === 5;
    const isSat = day => day === 6;

    while (worked < durationDays) {
        const dow = d.getDay();
        if (!isFri(dow) && !(isSat(dow) && !allowSat)) {
            worked++;
        }
        if (worked < durationDays) d.setDate(d.getDate() + 1);
    }
    return localDateStr(d);
}

function updateAbPreview() {
    const station = document.getElementById('abStation').value;
    const startStr = document.getElementById('abStart').value;
    const durStr = document.getElementById('abDuration').value;

    // Auto-fill duration when station changes
    if (STATION_DEFAULTS[station] !== undefined) {
        document.getElementById('abDuration').value = STATION_DEFAULTS[station];
    }

    const duration = parseInt(document.getElementById('abDuration').value) || 1;
    const preview = document.getElementById('abPreview');
    const text = document.getElementById('abPreviewText');

    if (startStr && duration > 0) {
        const allowSat = document.getElementById('ganttSatToggle')?.checked || false;
        const endStr = computeEndDate(startStr, duration, allowSat);
        text.textContent = `${formatDate(startStr)} → ${formatDate(endStr)}`;
        preview.style.display = 'flex';
    } else {
        preview.style.display = 'none';
    }
}

async function saveAddBlock() {
    // Resolve new vehicle / unit names
    let vehicle = document.getElementById('abVehicle').value;
    if (vehicle === '__new__') {
        vehicle = document.getElementById('abNewVehicle').value.trim();
        if (!vehicle) {
            const errEl = document.getElementById('abError');
            errEl.textContent = 'Please enter a name for the new vehicle.';
            errEl.style.display = 'flex'; return;
        }
    }
    let unit = document.getElementById('abUnit').value;
    if (unit === '__new__') {
        unit = document.getElementById('abNewUnit').value.trim();
        if (!unit) {
            const errEl = document.getElementById('abError');
            errEl.textContent = 'Please enter a name for the new unit.';
            errEl.style.display = 'flex'; return;
        }
    }
    const station = document.getElementById('abStation').value;
    const startStr = document.getElementById('abStart').value;
    const duration = parseInt(document.getElementById('abDuration').value) || 0;
    const remark = document.getElementById('abRemark').value.trim();
    const errEl = document.getElementById('abError');

    errEl.style.display = 'none';

    if (!vehicle || !unit || !station || !startStr || duration < 1) {
        errEl.textContent = 'Please fill in all required fields with a valid duration.';
        errEl.style.display = 'flex';
        return;
    }

    // Skip Friday for start date
    const allowSat = document.getElementById('ganttSatToggle')?.checked || false;
    const adjStart = skipNonWorking(startStr, allowSat);
    const endStr = computeEndDate(adjStart, duration, allowSat);

    const payload = {
        vehicle,
        vehicle_no: unit,
        process_station: station,
        start_date: adjStart,
        end_date: endStr,
        week: weekLabel(adjStart),   // auto-computed from start date
        remark: remark || null,
    };

    try {
        const { data: inserted, error } = await db
            .from('assembly_plan')
            .insert(payload)
            .select()
            .single();

        if (error) throw error;

        await auditLog('INSERT', 'assembly_plan', inserted.id, null, payload);

        // Add to in-memory data with no progress
        currentData.push({ ...inserted, progress: null });
        currentData.sort((a, b) => {
            const vCmp = vehicleSort(a.vehicle, b.vehicle); if (vCmp) return vCmp;
            const uCmp = naturalSort(a.vehicle_no, b.vehicle_no); if (uCmp) return uCmp;
            return (a.start_date || '').localeCompare(b.start_date || '');
        });

        showToast(`"${station}" added to ${vehicle} ${unit}`, 'success');
        closeAddBlockModal();

        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        renderGantt(currentData, gsEl?.value, geEl?.value);

    } catch (err) {
        errEl.textContent = 'Save failed: ' + err.message;
        errEl.style.display = 'flex';
        console.error(err);
    }
}

/* ── F100 Add Block modal ────────────────────────────────────────── */
let _f100AbCurrentMode = 'block';  // 'block' | 'template'

function _setF100AbMode(mode) {
    _f100AbCurrentMode = mode;
    document.querySelectorAll('#f100AbModeToggle [data-f100-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.f100Mode === mode);
    });
    const isTemplate = mode === 'template';
    document.getElementById('f100AbTitle').textContent = isTemplate ? 'Add F100 Template Plan' : 'Add F100 Plan Block';
    document.getElementById('btnF100AddBlockSave').textContent = isTemplate ? 'Create Plan' : 'Add to Plan';
    document.getElementById('f100AbProcessGroup').style.display = isTemplate ? 'none' : '';
    document.getElementById('f100AbStartGroup').style.display = isTemplate ? 'none' : '';
    document.getElementById('f100AbEndGroup').style.display = isTemplate ? 'none' : '';
    document.getElementById('f100AbTemplateWrap').style.display = isTemplate ? '' : 'none';
    if (isTemplate) {
        const startEl = document.getElementById('f100AbTplStart');
        if (startEl && !startEl.value) startEl.value = todayStr();
        f100AbLoadTemplateList();
    }
}

async function openF100AddBlockModal() {
    const overlay = document.getElementById('f100AddBlockOverlay');
    if (!overlay) return;

    // Populate battalion dropdown
    const bSel = document.getElementById('f100AbBattalion');
    try {
        const { data: battalions, error } = await db.from('f100_battalions').select('id, battalion_code, battalion_name').order('battalion_code');
        if (error) throw error;
        bSel.innerHTML = (battalions || []).map(b =>
            `<option value="${b.id}">${esc(b.battalion_name ? `${b.battalion_code} – ${b.battalion_name}` : b.battalion_code)}</option>`
        ).join('');
    } catch (e) {
        showToast('Could not load battalions: ' + e.message, 'error');
        return;
    }

    // Pre-select current battalion filter
    const currentBattalionCode = getVal('f100Battalion');
    if (currentBattalionCode) {
        const { data: bRow } = await db.from('f100_battalions').select('id').eq('battalion_code', currentBattalionCode).maybeSingle();
        if (bRow) bSel.value = String(bRow.id);
    }

    // Set mode from current filter
    const mode = document.getElementById('f100Mode')?.value || 'gun';
    document.getElementById('f100AbMode').value = mode;

    // Populate part and process dropdowns
    await f100AbUpdateParts();

    // Reset other fields
    document.getElementById('f100AbSerial').value = '';
    document.getElementById('f100AbStart').value = todayStr();
    document.getElementById('f100AbEnd').value = todayStr();
    document.getElementById('f100AbError').style.display = 'none';
    document.getElementById('f100AbTemplateList').innerHTML = '<p style="color:var(--clr-text-muted);font-size:.8rem">Select a part above to load the process sequence.</p>';

    // Default to block mode
    _setF100AbMode('block');

    overlay.style.display = 'flex';
}

async function f100AbUpdateParts() {
    const mode = document.getElementById('f100AbMode')?.value || 'gun';
    const pSel = document.getElementById('f100AbPart');
    if (!pSel) return;
    try {
        const { data: parts, error } = await db.from('f100_parts').select('id, part_name, part_number').eq('module', mode).order('sort_order');
        if (error) throw error;
        pSel.innerHTML = (parts || []).map(p => `<option value="${p.id}">${esc(p.part_name)} (${esc(p.part_number)})</option>`).join('');
        if (!pSel.innerHTML) pSel.innerHTML = '<option value="">No parts found</option>';
    } catch (e) {
        pSel.innerHTML = '<option value="">Error loading parts</option>';
    }
    // Gun parts only apply to K9 — hide K10/K11 in vehicle type select
    const vtSel = document.getElementById('f100AbVehicleType');
    if (vtSel) {
        [...vtSel.options].forEach(opt => { opt.hidden = mode === 'gun' && opt.value !== 'K9'; });
        if (mode === 'gun') vtSel.value = 'K9';
    }
    await f100AbUpdateProcesses();
}

async function f100AbUpdateProcesses() {
    const partId = document.getElementById('f100AbPart')?.value;
    const procSel = document.getElementById('f100AbProcess');
    if (!procSel) return;
    if (!partId) { procSel.innerHTML = '<option value="">Select a part first</option>'; return; }
    try {
        const { data: procs, error } = await db.from('f100_processes').select('id, process_name, step_number').eq('part_id', partId).order('sort_order');
        if (error) throw error;
        procSel.innerHTML = (procs || []).map(p => `<option value="${p.id}">${esc(p.step_number ? `${p.step_number}. ` : '')}${esc(p.process_name)}</option>`).join('');
        if (!procSel.innerHTML) procSel.innerHTML = '<option value="">No processes found</option>';
    } catch (e) {
        procSel.innerHTML = '<option value="">Error loading processes</option>';
    }
    if (_f100AbCurrentMode === 'template') f100AbLoadTemplateList();
}

async function f100AbLoadTemplateList() {
    const partId = document.getElementById('f100AbPart')?.value;
    const listEl = document.getElementById('f100AbTemplateList');
    if (!listEl) return;
    if (!partId) {
        listEl.innerHTML = '<p style="color:var(--clr-text-muted);font-size:.8rem">Select a part above to load the process sequence.</p>';
        return;
    }
    const { data: procs } = await db.from('f100_processes').select('*').eq('part_id', partId).order('sort_order');
    if (!procs?.length) {
        listEl.innerHTML = '<p style="color:var(--clr-text-muted);font-size:.8rem">No processes defined for this part.</p>';
        return;
    }
    listEl.innerHTML = `<div class="f100-tpl-proc-list">
        ${procs.map((p, i) => `
        <div class="f100-tpl-proc-row" data-proc-id="${p.id}" data-step="${p.step_number || i + 1}">
            <span class="f100-tpl-step">S${p.step_number || i + 1}</span>
            <span class="f100-tpl-pname">${esc(p.process_name)}</span>
            <label class="f100-tpl-dur-label">Days
                <input type="number" class="f100-tpl-dur filter-control" value="${p.default_duration || 7}" min="1" max="365" style="width:60px">
            </label>
        </div>`).join('')}
    </div>`;
}

function closeF100AddBlockModal() {
    document.getElementById('f100AddBlockOverlay').style.display = 'none';
}

async function saveF100AddBlock() {
    if (_f100AbCurrentMode === 'template') { await _saveF100Template(); return; }

    const errEl = document.getElementById('f100AbError');
    errEl.style.display = 'none';

    const battalionId = document.getElementById('f100AbBattalion').value;
    const vehicleType = document.getElementById('f100AbVehicleType').value;
    const serialRaw = document.getElementById('f100AbSerial').value.trim();
    const partId = document.getElementById('f100AbPart').value;
    const processId = document.getElementById('f100AbProcess').value;
    const startDate = document.getElementById('f100AbStart').value;
    const endDate = document.getElementById('f100AbEnd').value;

    if (!battalionId || !vehicleType || !serialRaw || !partId || !processId || !startDate || !endDate) {
        errEl.textContent = 'All fields are required.';
        errEl.style.display = 'flex';
        return;
    }
    const serialNumber = parseInt(serialRaw, 10);
    if (!Number.isFinite(serialNumber) || serialNumber <= 0) {
        errEl.textContent = 'Serial No. must be a positive number.';
        errEl.style.display = 'flex';
        return;
    }

    // Resolve battalion_code from id
    const { data: bRow, error: bErr } = await db.from('f100_battalions').select('battalion_code').eq('id', battalionId).maybeSingle();
    if (bErr || !bRow) { errEl.textContent = 'Invalid battalion.'; errEl.style.display = 'flex'; return; }

    const payload = {
        battalion_code: bRow.battalion_code,
        vehicle_type: vehicleType,
        serial_number: serialNumber,
        part_id: partId,
        process_id: processId,
        planned_start_date: startDate,
        planned_end_date: endDate,
        status: 'Planned',
    };

    try {
        markLocalSave();
        const { data: inserted, error } = await db.from('f100_plans').insert(payload).select().single();
        if (error) throw error;
        await auditLog('INSERT', 'f100_plans', inserted.id, null, payload);
        showToast(`F100 plan block added.`, 'success');
        closeF100AddBlockModal();
        await loadData();
    } catch (err) {
        errEl.textContent = 'Save failed: ' + err.message;
        errEl.style.display = 'flex';
        console.error(err);
    }
}

async function _saveF100Template() {
    const errEl = document.getElementById('f100AbError');
    errEl.style.display = 'none';

    const battalionId = document.getElementById('f100AbBattalion').value;
    const vehicleType = document.getElementById('f100AbVehicleType').value;
    const serialRaw = document.getElementById('f100AbSerial').value.trim();
    const partId = document.getElementById('f100AbPart').value;
    const startDate = document.getElementById('f100AbTplStart').value;

    if (!battalionId || !vehicleType || !serialRaw || !partId || !startDate) {
        errEl.textContent = 'All fields (battalion, vehicle type, serial, part, start date) are required.';
        errEl.style.display = 'flex';
        return;
    }
    const serialNumber = parseInt(serialRaw, 10);
    if (!Number.isFinite(serialNumber) || serialNumber <= 0) {
        errEl.textContent = 'Serial No. must be a positive integer.';
        errEl.style.display = 'flex';
        return;
    }
    const rows = [...document.querySelectorAll('#f100AbTemplateList .f100-tpl-proc-row')];
    if (!rows.length) {
        errEl.textContent = 'Select a part first to load its process sequence.';
        errEl.style.display = 'flex';
        return;
    }

    const { data: bRow, error: bErr } = await db.from('f100_battalions').select('battalion_code').eq('id', battalionId).maybeSingle();
    if (bErr || !bRow) { errEl.textContent = 'Invalid battalion.'; errEl.style.display = 'flex'; return; }

    const payloads = [];
    let cursor = startDate;
    for (const row of rows) {
        const procId = row.dataset.procId;
        const dur = parseInt(row.querySelector('.f100-tpl-dur')?.value || '7', 10) || 7;
        const endDate = addDays(cursor, dur - 1);
        payloads.push({
            battalion_code: bRow.battalion_code,
            vehicle_type: vehicleType,
            serial_number: serialNumber,
            part_id: partId,
            process_id: procId,
            planned_start_date: cursor,
            planned_end_date: endDate,
            status: 'Planned',
        });
        cursor = addDays(endDate, 1);
    }

    try {
        markLocalSave();
        const { data: inserted, error } = await db.from('f100_plans').insert(payloads).select();
        if (error) throw error;
        for (const ins of (inserted || [])) {
            await auditLog('INSERT', 'f100_plans', ins.id, null, payloads.find(p => p.process_id === ins.process_id));
        }
        showToast(`Template applied: ${payloads.length} process blocks created.`, 'success');
        closeF100AddBlockModal();
        await loadData();
    } catch (err) {
        errEl.textContent = 'Create failed: ' + err.message;
        errEl.style.display = 'flex';
    }
}

/* ── F100 Visual Placement ────────────────────────────────────────── */
async function openF100VisualPlacement() {
    const bar = document.getElementById('ganttVisualPlacementBar');
    const palette = document.getElementById('ganttVisualPalette');
    if (!bar || !palette) return;

    // Hide KD2 vehicle filter; keep the text filter for search
    const vehFilter = document.getElementById('ganttVisualPlacementVehicle')?.closest('.filter-item');
    if (vehFilter) vehFilter.style.display = 'none';
    const filterInput = document.getElementById('ganttVisualPlacementFilter');
    if (filterInput) {
        filterInput.placeholder = 'Search process or part...';
        filterInput.value = '';
    }

    const mode = document.getElementById('f100Mode')?.value || 'gun';
    try {
        const { data: parts } = await db.from('f100_parts').select('id, part_name, part_number').eq('module', mode).order('sort_order');
        const partIds = (parts || []).map(p => p.id);
        if (!partIds.length) { showToast('No parts found for current mode.', 'error'); return; }
        _f100PlacementPartMap = {};
        (parts || []).forEach(p => { _f100PlacementPartMap[p.id] = p; });

        const { data: processes } = await db.from('f100_processes').select('*').in('part_id', partIds).order('sort_order');
        if (!processes?.length) { showToast('No processes found.', 'error'); return; }

        _f100PlacementAllProcesses = processes;
        _f100PlacementActive = false;
        _f100PlacementProcess = null;

        _renderF100PlacementPalette('');

        if (filterInput) {
            filterInput.oninput = () => _renderF100PlacementPalette(filterInput.value);
        }

        const summary = document.getElementById('ganttVisualPlacementSummary');
        if (summary) summary.textContent = 'Select a process block, then click once on the target lane and date.';
        const hint = document.getElementById('ganttVisualPlacementHint');
        if (hint) hint.textContent = 'The selected process stays active until you change it or cancel.';
        bar.style.display = '';
    } catch (err) {
        showToast('Failed to load processes: ' + err.message, 'error');
    }
}

function _renderF100PlacementPalette(query) {
    const palette = document.getElementById('ganttVisualPalette');
    if (!palette) return;
    const q = (query || '').trim().toLowerCase();

    // Group by part
    const byPart = {};
    _f100PlacementAllProcesses.forEach(proc => {
        if (q) {
            const hay = [
                (_f100PlacementPartMap[proc.part_id]?.part_name || ''),
                (proc.process_name || ''),
                String(proc.step_number || ''),
            ].join(' ').toLowerCase();
            if (!hay.includes(q)) return;
        }
        if (!byPart[proc.part_id]) byPart[proc.part_id] = [];
        byPart[proc.part_id].push(proc);
    });

    const partIds = Object.keys(byPart);
    if (!partIds.length) {
        palette.innerHTML = `<div class="empty-state"><p>${q ? 'No processes match the search.' : 'No processes found.'}</p></div>`;
        return;
    }

    palette.innerHTML = partIds.map(partId => {
        const part = _f100PlacementPartMap[partId] || {};
        const procs = byPart[partId];
        return `
        <div class="kd2-timeline-palette-group">
            <div class="kd2-timeline-palette-group-title">${esc(part.part_name || partId)}</div>
            <div class="kd2-timeline-palette-items">
                ${procs.map(proc => {
                    const isActive = _f100PlacementProcess?.id === proc.id;
                    const color = ganttStationColor(proc.process_name);
                    return `<button type="button"
                        class="kd2-timeline-palette-item${isActive ? ' kd2-timeline-palette-item-active' : ''}"
                        data-f100-proc-id="${proc.id}"
                        data-f100-part-id="${proc.part_id}"
                        data-f100-step="${proc.step_number || ''}"
                        data-f100-duration="${proc.default_duration || 7}"
                        data-f100-name="${esc(proc.process_name)}"
                        style="--kd2-placement-color:${color}">
                        <span class="kd2-placement-palette-bar" style="background:${color}">
                            <span class="gc-bar-text">Step ${proc.step_number || '?'} · ${esc(proc.process_name)}</span>
                        </span>
                        <span class="kd2-placement-palette-meta">${esc(part.part_name || '')} · ${proc.default_duration || 7} days</span>
                    </button>`;
                }).join('')}
            </div>
        </div>`;
    }).join('');

    palette.querySelectorAll('[data-f100-proc-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            _f100PlacementProcess = {
                id: btn.dataset.f100ProcId,
                part_id: btn.dataset.f100PartId,
                step_number: btn.dataset.f100Step,
                duration: parseInt(btn.dataset.f100Duration) || 7,
                name: btn.dataset.f100Name,
            };
            _f100PlacementActive = true;
            document.getElementById('ganttInner')?.classList.add('f100-placing');
            // Re-render palette to show active state
            _renderF100PlacementPalette(document.getElementById('ganttVisualPlacementFilter')?.value || '');
            const summary = document.getElementById('ganttVisualPlacementSummary');
            if (summary) summary.textContent = `Placing: Step ${_f100PlacementProcess.step_number} – ${_f100PlacementProcess.name}. Click a lane on the Gantt to place.`;
        });
    });
}

function cancelF100Placement() {
    _f100PlacementActive = false;
    _f100PlacementProcess = null;
    document.getElementById('ganttInner')?.classList.remove('f100-placing');
    const bar = document.getElementById('ganttVisualPlacementBar');
    if (bar) bar.style.display = 'none';
}

async function placeF100VisualBlock(track, plannedStart) {
    if (!_f100PlacementProcess) {
        showToast('Select a process from the palette first.', 'error');
        return;
    }
    const battalionCode = track.dataset.battalionCode || '';
    const vehicleType = track.dataset.vehicleType || '';
    const serialNumber = parseInt(track.dataset.unitSerial || '', 10);
    if (!battalionCode || !vehicleType || !Number.isFinite(serialNumber)) {
        showToast('Lane is missing vehicle unit details. Ensure the lane has existing data.', 'error');
        return;
    }
    const endDate = addDays(plannedStart, (_f100PlacementProcess.duration || 7) - 1);
    const payload = {
        battalion_code: battalionCode,
        vehicle_type: vehicleType,
        serial_number: serialNumber,
        part_id: _f100PlacementProcess.part_id,
        process_id: _f100PlacementProcess.id,
        planned_start_date: plannedStart,
        planned_end_date: endDate,
        status: 'Planned',
    };
    try {
        markLocalSave();
        const { data: inserted, error } = await db.from('f100_plans').insert(payload).select().single();
        if (error) throw error;
        await auditLog('INSERT', 'f100_plans', inserted.id, null, payload);
        showToast(`Block placed: Step ${_f100PlacementProcess.step_number} – ${_f100PlacementProcess.name}`, 'success');
        await loadData();
    } catch (err) {
        showToast('Placement failed: ' + err.message, 'error');
    }
}

/* ── F100 Edit Block modal ────────────────────────────────────────── */
function openF100EditBlockModal(planId) {
    const task = currentData.find(t => String(t.id) === String(planId));
    if (!task) return;
    document.getElementById('f100EbPlanId').value = String(planId);
    document.getElementById('f100EbBlockInfo').textContent =
        `${task.battalion_code || '—'} · ${task.vehicle_type || '—'} #${task.serial_number ?? '—'} · ${task.part_name || '—'} · ${task.process_name || task.process_station || '—'}`;
    document.getElementById('f100EbStart').value       = task.planned_start_date || '';
    document.getElementById('f100EbEnd').value         = task.planned_end_date   || '';
    document.getElementById('f100EbActualStart').value = task.actual_start_date  || '';
    document.getElementById('f100EbActualEnd').value   = task.actual_end_date    || '';
    document.getElementById('f100EbStatus').value      = task.status             || 'Planned';
    document.getElementById('f100EbError').style.display = 'none';

    const isViewer = getCurrentUser()?.role === 'viewer';
    ['f100EbStart', 'f100EbEnd', 'f100EbActualStart', 'f100EbActualEnd', 'f100EbStatus'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = isViewer;
    });
    const saveBtn = document.getElementById('btnF100EditBlockSave');
    if (saveBtn) saveBtn.style.display = isViewer ? 'none' : '';

    document.getElementById('f100EditBlockOverlay').style.display = 'flex';
}

function closeF100EditBlockModal() {
    document.getElementById('f100EditBlockOverlay').style.display = 'none';
}

async function saveF100EditBlock() {
    const planId   = document.getElementById('f100EbPlanId').value;
    const start    = document.getElementById('f100EbStart').value;
    const end      = document.getElementById('f100EbEnd').value;
    const actStart = document.getElementById('f100EbActualStart').value || null;
    const actEnd   = document.getElementById('f100EbActualEnd').value   || null;
    const status   = document.getElementById('f100EbStatus').value;
    const errEl    = document.getElementById('f100EbError');
    errEl.style.display = 'none';

    if (!start || !end) { errEl.textContent = 'Planned start and end dates are required.'; errEl.style.display = 'flex'; return; }

    const payload = {
        planned_start_date: start,
        planned_end_date:   end,
        actual_start_date:  actStart,
        actual_end_date:    actEnd,
        status,
        updated_at: new Date().toISOString(),
    };

    try {
        const { error } = await db.from('f100_plans').update(payload).eq('id', planId);
        if (error) throw error;
        await auditLog('UPDATE', 'f100_plans', planId, null, payload);
        const row = currentData.find(t => String(t.id) === planId);
        if (row) {
            Object.assign(row, {
                planned_start_date: start,
                planned_end_date:   end,
                actual_start_date:  actStart,
                actual_end_date:    actEnd,
                status,
                start_date: actStart || start,
                end_date:   actEnd   || end,
            });
        }
        showToast('F100 plan block updated.', 'success');
        closeF100EditBlockModal();
        refreshAllViews();
    } catch (err) {
        errEl.textContent = 'Save failed: ' + err.message;
        errEl.style.display = 'flex';
        console.error(err);
    }
}

/* ── Extend wireGanttControls with add/delete wiring ────────────── */
const _origWireGanttFull = wireGanttControls;
wireGanttControls = function () {
    _origWireGanttFull();
    bindGanttFullscreenUi();

    // F100 Add Block modal wiring
    document.getElementById('f100AddBlockClose')?.addEventListener('click', closeF100AddBlockModal);
    document.getElementById('btnF100AddBlockCancel')?.addEventListener('click', closeF100AddBlockModal);
    document.getElementById('btnF100AddBlockSave')?.addEventListener('click', saveF100AddBlock);
    document.getElementById('f100AddBlockOverlay')?.addEventListener('click', function (e) {
        if (e.target === this) closeF100AddBlockModal();
    });
    document.getElementById('f100AbMode')?.addEventListener('change', f100AbUpdateParts);
    document.getElementById('f100AbPart')?.addEventListener('change', f100AbUpdateProcesses);
    // Block / Template mode toggle
    document.getElementById('f100AbModeToggle')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-f100-mode]');
        if (btn) _setF100AbMode(btn.dataset.f100Mode);
    });

    // F100 Edit Block modal wiring
    document.getElementById('f100EditBlockClose')?.addEventListener('click', closeF100EditBlockModal);
    document.getElementById('btnF100EditBlockCancel')?.addEventListener('click', closeF100EditBlockModal);
    document.getElementById('btnF100EditBlockSave')?.addEventListener('click', saveF100EditBlock);
    document.getElementById('f100EditBlockOverlay')?.addEventListener('click', function (e) {
        if (e.target === this) closeF100EditBlockModal();
    });

    // Visual add button for F100 — opens visual process palette for click-to-place
    ['btnGanttVisualAdd', 'btnKd2VisualAdd'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', event => {
            if (!isF100KD2Module()) return;
            event.stopPropagation();
            getModuleRuntime()?.toggleTimelineVisualMenu?.(false);
            openF100VisualPlacement();
        });
    });

    // Cancel F100 visual placement
    document.getElementById('btnGanttVisualPlacementCancel')?.addEventListener('click', () => {
        if (isF100KD2Module()) cancelF100Placement();
    });

    // Add Template button (gantt toolbar) opens the unified add-block modal in template mode
    document.getElementById('btnF100AddTemplate')?.addEventListener('click', async () => {
        await openF100AddBlockModal();
        _setF100AbMode('template');
    });

    // Add Block modal
    document.getElementById('btnAddBlock')?.addEventListener('click', openAddBlockModal);
    document.getElementById('addBlockClose')?.addEventListener('click', closeAddBlockModal);
    document.getElementById('btnAddBlockCancel')?.addEventListener('click', closeAddBlockModal);
    document.getElementById('addBlockOverlay')?.addEventListener('click', function (e) {
        if (e.target === this) closeAddBlockModal();
    });
    document.getElementById('btnAddBlockSave')?.addEventListener('click', saveAddBlock);

    // Live preview wiring
    document.getElementById('abStation')?.addEventListener('change', updateAbPreview);
    document.getElementById('abStart')?.addEventListener('change', updateAbPreview);
    document.getElementById('abDuration')?.addEventListener('input', updateAbPreview);
    document.getElementById('abVehicle')?.addEventListener('change', () => {
        updateAbUnits();
        updateAbPreview();
    });
    document.getElementById('abUnit')?.addEventListener('change', () => {
        const newUGrp = document.getElementById('abNewUnitGroup');
        if (newUGrp) newUGrp.style.display =
            document.getElementById('abUnit').value === '__new__' ? 'block' : 'none';
        updateAbPreview();
    });
};

/* ── Extend wireGanttDragEdit to also wire delete buttons ────────── */
const _origWireGanttDragEdit = wireGanttDragEdit;
wireGanttDragEdit = function (dayIndex, days) {
    _origWireGanttDragEdit(dayIndex, days);
    if (_ganttEditMode) wireBarDeleteButtons();
};

/* ================================================================
   EDIT BLOCK MODAL — change start date, duration, week, remark
   ================================================================ */

function openEditBlockModal(planId) {
    if (!canEditPlan()) { showToast('Only planners and admins can edit blocks.', 'error'); return; }

    const task = currentData.find(t => t.id === planId);
    if (!task) return;

    document.getElementById('ebPlanId').value = planId;
    document.getElementById('ebBlockInfo').textContent =
        `${task.vehicle} ${task.vehicle_no} — ${task.process_station}`;
    document.getElementById('ebStart').value = task.start_date;
    document.getElementById('ebRemark').value = task.remark || '';
    document.getElementById('ebError').style.display = 'none';
    const badge = document.getElementById('ebWeekBadge');
    if (badge) badge.textContent = task.start_date ? weekLabel(task.start_date) : '—';

    // Compute current duration in calendar days, then re-express as working days
    const calDays = dayDiff(task.start_date, task.end_date);
    document.getElementById('ebDuration').value = Math.max(1, calDays);

    updateEbPreview();

    document.getElementById('editBlockOverlay').style.display = 'flex';
}

function closeEditBlockModal() {
    document.getElementById('editBlockOverlay').style.display = 'none';
}

function updateEbPreview() {
    const startStr = document.getElementById('ebStart').value;
    const duration = parseInt(document.getElementById('ebDuration').value) || 0;
    const preview = document.getElementById('ebPreview');
    const text = document.getElementById('ebPreviewText');

    // Update auto-computed week badge
    const badge = document.getElementById('ebWeekBadge');
    if (badge) badge.textContent = startStr ? weekLabel(startStr) : '—';

    if (startStr && duration > 0) {
        const allowSat = document.getElementById('ganttSatToggle')?.checked || false;
        const endStr = computeEndDate(startStr, duration, allowSat);
        text.textContent = `${formatDate(startStr)} → ${formatDate(endStr)}`;
        preview.style.display = 'flex';
    } else {
        preview.style.display = 'none';
    }
}

async function saveEditBlock() {
    const planId = parseInt(document.getElementById('ebPlanId').value);
    const startStr = document.getElementById('ebStart').value;
    const duration = parseInt(document.getElementById('ebDuration').value) || 0;
    const remark = document.getElementById('ebRemark').value.trim();
    const errEl = document.getElementById('ebError');

    errEl.style.display = 'none';

    if (!startStr || duration < 1) {
        errEl.textContent = 'Please set a valid start date and duration (at least 1 day).';
        errEl.style.display = 'flex';
        return;
    }

    const task = currentData.find(t => t.id === planId);
    if (!task) return;

    const allowSat = document.getElementById('ganttSatToggle')?.checked || false;
    const adjStart = skipNonWorking(startStr, allowSat);
    const endStr = computeEndDate(adjStart, duration, allowSat);

    const before = {
        start_date: task.start_date, end_date: task.end_date,
        week: task.week, remark: task.remark
    };
    const computedWeek = weekLabel(adjStart);
    const after = {
        start_date: adjStart, end_date: endStr,
        week: computedWeek, remark: remark || null
    };

    try {
        const { error } = await db
            .from('assembly_plan')
            .update({
                start_date: adjStart, end_date: endStr,
                week: computedWeek, remark: remark || null
            })
            .eq('id', planId);

        if (error) throw error;

        await auditLog('UPDATE', 'assembly_plan', planId, before, after);

        // Update in-memory
        Object.assign(task, {
            start_date: adjStart, end_date: endStr,
            week: computedWeek, remark: remark || null
        });

        showToast('Block updated.', 'success');
        closeEditBlockModal();

        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        renderGantt(currentData, gsEl?.value, geEl?.value);

    } catch (err) {
        errEl.textContent = 'Save failed: ' + err.message;
        errEl.style.display = 'flex';
        console.error(err);
    }
}

/* Wire edit block modal from wireEvents */
(function wireEditBlock() {
    // Called on DOMContentLoaded, safe to query the DOM
    window.addEventListener('DOMContentLoaded', () => {
        document.getElementById('editBlockClose')?.addEventListener('click', closeEditBlockModal);
        document.getElementById('btnEditBlockCancel')?.addEventListener('click', closeEditBlockModal);
        document.getElementById('btnEditBlockSave')?.addEventListener('click', saveEditBlock);
        document.getElementById('editBlockOverlay')?.addEventListener('click', function (e) {
            if (e.target === this) closeEditBlockModal();
        });
        document.getElementById('ebStart')?.addEventListener('change', updateEbPreview);
        document.getElementById('ebDuration')?.addEventListener('input', updateEbPreview);
    });
})();

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
    window.location.href = 'login.html';
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
    return CATEGORY_MAP[processStation] || 'Other';
}
let db = null;
let barChartInst = null;
let lineChartInst = null;
let currentData = [];      // flat merged rows
let activePlanId = null;    // plan row being marked complete

/* ──────────────────────────────────────────────────────────────────
   3. ENTRY POINT
   ────────────────────────────────────────────────────────────────── */
async function initializeApp() {
    // ── Auth guard — redirect to login if no valid session ───────────
    if (!getCurrentUser()) { window.location.replace('login.html'); return; }
    populateNavbar();

    startClock();

    // Init Supabase client
    try {
        db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        setConnStatus('connected', 'Connected');
    } catch (err) {
        setConnStatus('error', 'Connection Error');
        showToast('Failed to initialise Supabase. Check your credentials.', 'error');
        console.error(err);
        return;
    }

    wireEvents();

    await loadFilters();
    await loadData();
}

/* ──────────────────────────────────────────────────────────────────
   4. FILTERS
   ────────────────────────────────────────────────────────────────── */
async function loadFilters() {
    try {
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

        const vehicles = [...new Set(plans.map(r => r.vehicle))].sort(vehicleSort);
        const weeks = [...new Set(plans.map(r => r.start_date ? weekLabel(r.start_date) : r.week).filter(Boolean))]
            .sort((a, b) => parseInt(a.replace(/[^0-9]/g, ''), 10) - parseInt(b.replace(/[^0-9]/g, ''), 10));

        populateSelect('filterVehicle', vehicles, 'All Vehicles');
        populateSelect('filterWeek', weeks, 'All Weeks');

        // Units across all vehicles
        const units = [...new Set(plans.map(r => r.vehicle_no).filter(Boolean))].sort(naturalSort);
        populateSelect('filterUnit', units, 'All Units');

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

/* ──────────────────────────────────────────────────────────────────
   5. DATA LOADING
   ────────────────────────────────────────────────────────────────── */

/** Save current table scroll position and return it */
function saveScrollPos() {
    const wrap = document.getElementById('tableWrap') || document.querySelector('.table-scroll-wrap');
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
        ? currentData.filter(r => getCategory(r.process_station) === category)
        : currentData;

    const pos = saveScrollPos();
    renderTable(displayData);
    restoreScrollPos(pos);

    updateSummary(displayData);
    renderCharts(displayData);
    renderVPX(displayData);

    const gsEl = document.getElementById('ganttStart');
    const geEl = document.getElementById('ganttEnd');
    if (gsEl?.value && geEl?.value) {
        renderGantt(displayData, gsEl.value, geEl.value);
    }
}

async function loadData() {
    try {
        setTableLoading(true);

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

        // Vehicle filter
        const vehicle = getVal('filterVehicle');
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

        // Category filter (client-side — maps process_station → category)
        const category = getVal('filterCategory');
        const displayData = category
            ? currentData.filter(r => getCategory(r.process_station) === category)
            : currentData;

        renderTable(displayData);
        updateSummary(displayData);
        renderCharts(displayData);
        renderVPX(displayData);   // use same filtered data as table/charts

        // Auto-refresh gantt with current date range
        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        if (gsEl?.value && geEl?.value) {
            renderGantt(displayData, gsEl.value, geEl.value);
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

function delayDays(row) {
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
function renderTable(data) {
    const tbody = document.getElementById('tableBody');
    document.getElementById('rowCount').textContent = `${data.length} record${data.length !== 1 ? 's' : ''}`;

    if (!data.length) {
        tbody.innerHTML = `
      <tr>
        <td colspan="13" class="table-empty">
          <div class="empty-state">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="6" y="6" width="36" height="36" rx="4"/><path d="M16 24h16M24 16v16"/></svg>
            <p>No records match the current filters.</p>
          </div>
        </td>
      </tr>`;
        return;
    }

    tbody.innerHTML = data.map((row, idx) => {
        const status = calculateStatus(row);
        const delay = delayDays(row);
        const badgeCls = `badge badge-${status.toLowerCase().replace(' ', '-').replace('late-completion', 'late')}`;
        const compDate = row.progress?.completion_date || null;
        const actualStart = row.progress?.actual_start_date || '';
        const isDone = status === 'Completed' || status === 'Late Completion';

        // ── Delay label ───────────────────────────────────────────────
        let delayHtml;
        if (delay > 0 && (status === 'Late Completion' || status === 'Overdue')) {
            delayHtml = `<span class="delay-positive">+${delay}d</span>`;
        } else if (delay > 0 && status === 'In Progress') {
            delayHtml = `<span class="delay-positive" title="Started ${delay}d late">+${delay}d start</span>`;
        } else if (status === 'Completed') {
            delayHtml = `<span class="delay-zero">On Time</span>`;
        } else {
            delayHtml = `<span class="delay-none">—</span>`;
        }

        // ── Actual Start — always an editable inline date input ───────
        const startInputHtml = `
      <div class="inline-date-wrap">
        <input type="date"
          class="inline-date-input"
          data-plan-id="${row.id}"
          value="${actualStart}"
          title="Actual start date" />
        ${actualStart
                ? `<button class="inline-icon-btn inline-start-clear" data-plan-id="${row.id}" title="Clear start date">✕</button>`
                : ''}
      </div>`;

        // ── Completed On — text display + edit pencil + clear ✕ ──────
        // When a date is set: show formatted date, edit button, clear button.
        // The edit button swaps the cell contents to a live date-input on click.
        const compCellHtml = compDate
            ? `<div class="inline-date-wrap" id="comp-wrap-${row.id}">
           <span class="inline-date-done" id="comp-display-${row.id}">${formatDate(compDate)}</span>
           <button class="inline-icon-btn inline-comp-edit"
             data-plan-id="${row.id}"
             data-current="${compDate}"
             title="Edit completion date">✎</button>
           <button class="inline-icon-btn inline-comp-clear"
             data-plan-id="${row.id}"
             title="Clear completion date">✕</button>
         </div>`
            : `<div class="inline-date-wrap" id="comp-wrap-${row.id}">
           <span class="inline-date-none">—</span>
         </div>`;

        // ── Completion note icon ─────────────────────────────────────
        const note = row.progress?.notes || '';
        const noteBtn = note
            ? `<button class="btn-note-icon" data-plan-id="${row.id}" title="${esc(note)}">
           <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">
             <rect x="2" y="2" width="12" height="12" rx="2"/>
             <path d="M5 6h6M5 8.5h6M5 11h4"/>
           </svg>
         </button>`
            : '';

        // ── Action — Mark Complete button for non-done rows ───────────
        const actionHtml = isDone
            ? `<div class="action-cell">${noteBtn}<button class="btn btn-done" disabled>✓ Done</button></div>`
            : `<div class="action-cell">${noteBtn}<button class="btn btn-action" data-plan-id="${row.id}" data-idx="${idx}">Mark Complete</button></div>`;

        return `
      <tr>
        <td class="mono">${idx + 1}</td>
        <td><strong>${esc(row.vehicle)}</strong></td>
        <td class="mono">${esc(row.vehicle_no)}</td>
        <td>${esc(row.process_station)}</td>
        <td class="mono station-code-cell">${getStationCode(row.process_station, row.vehicle) || '—'}</td>
        <td class="mono">${esc(row.week || '—')}</td>
        <td class="mono">${formatDate(row.start_date)}</td>
        <td class="mono">${formatDate(row.end_date)}</td>
        <td>${startInputHtml}</td>
        <td>${compCellHtml}</td>
        <td><span class="${badgeCls}">${status}</span></td>
        <td>${delayHtml}</td>
        <td>${actionHtml}</td>
      </tr>`;
    }).join('');

    // ── Actual Start: save on change ──────────────────────────────
    tbody.querySelectorAll('.inline-date-input').forEach(input => {
        input.addEventListener('change', () =>
            saveActualStart(parseInt(input.dataset.planId), input.value)
        );
    });
    tbody.querySelectorAll('.inline-start-clear').forEach(btn => {
        btn.addEventListener('click', () =>
            saveActualStart(parseInt(btn.dataset.planId), '')
        );
    });

    // ── Completed On: edit pencil → swap display for live input ──
    tbody.querySelectorAll('.inline-comp-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const planId = parseInt(btn.dataset.planId);
            const current = btn.dataset.current;
            const wrap = document.getElementById(`comp-wrap-${planId}`);
            if (!wrap) return;

            // Replace wrap contents with an active date input
            wrap.innerHTML = `
        <input type="date"
          class="inline-date-input inline-comp-active"
          data-plan-id="${planId}"
          value="${current}"
          title="Edit completion date" />
        <button class="inline-icon-btn inline-comp-cancel"
          data-plan-id="${planId}"
          data-original="${current}"
          title="Cancel">✕</button>`;

            const newInput = wrap.querySelector('.inline-comp-active');
            newInput.focus();

            newInput.addEventListener('change', () =>
                saveCompletionDate(planId, newInput.value)
            );

            // Cancel restores original display without saving
            wrap.querySelector('.inline-comp-cancel').addEventListener('click', () =>
                saveCompletionDate(planId, current, /* silent */ true)
            );
        });
    });

    // ── Completed On: clear button ────────────────────────────────
    tbody.querySelectorAll('.inline-comp-clear').forEach(btn => {
        btn.addEventListener('click', () =>
            saveCompletionDate(parseInt(btn.dataset.planId), '')
        );
    });

    // ── Note icon — show popover on click ───────────────────────
    tbody.querySelectorAll('.btn-note-icon').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.note-popover').forEach(p => p.remove());

            const planId = parseInt(btn.dataset.planId);
            const note = btn.getAttribute('title');

            const popover = document.createElement('div');
            popover.className = 'note-popover';
            popover.dataset.planId = planId;

            function renderView() {
                const adminBtns = isAdmin() ? `
          <button class="note-action-btn note-edit-btn" title="Edit note">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/></svg>
          </button>
          <button class="note-action-btn note-delete-btn" title="Delete note">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 3.5h10M5 3.5V2h4v1.5M5.5 6v5M8.5 6v5M3 3.5l.7 8h6.6l.7-8"/></svg>
          </button>` : '';

                popover.innerHTML = `
          <div class="note-popover-header">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7">
              <rect x="2" y="2" width="12" height="12" rx="2"/>
              <path d="M5 6h6M5 8.5h6M5 11h4"/>
            </svg>
            Completion Note
            <div class="note-popover-actions">
              ${adminBtns}
              <button class="note-popover-close" title="Close">✕</button>
            </div>
          </div>
          <div class="note-popover-body">${esc(popover._currentNote ?? note)}</div>`;

                popover.querySelector('.note-popover-close').addEventListener('click', () => popover.remove());

                if (isAdmin()) {
                    popover.querySelector('.note-edit-btn').addEventListener('click', (e) => {
                        e.stopPropagation();
                        renderEdit();
                    });

                    popover.querySelector('.note-delete-btn').addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (!confirm('Delete this completion note?')) return;
                        await saveNoteOnly(planId, '');
                        btn.setAttribute('title', '');
                        btn.closest('.action-cell').querySelector('.btn-note-icon')?.remove();
                        popover.remove();
                    });
                }
            }

            function renderEdit() {
                const current = popover._currentNote ?? note;
                popover.innerHTML = `
          <div class="note-popover-header">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/></svg>
            Edit Note
            <button class="note-popover-close" title="Cancel">✕</button>
          </div>
          <div class="note-popover-edit-body">
            <textarea class="note-edit-textarea" rows="4" placeholder="Completion note…">${esc(current)}</textarea>
            <div class="note-edit-footer">
              <button class="btn btn-primary btn-sm note-save-btn">Save</button>
              <button class="btn btn-ghost btn-sm note-cancel-btn">Cancel</button>
            </div>
          </div>`;

                const ta = popover.querySelector('.note-edit-textarea');
                ta.focus();
                ta.setSelectionRange(ta.value.length, ta.value.length);

                popover.querySelector('.note-popover-close').addEventListener('click', () => {
                    renderView();
                });
                popover.querySelector('.note-cancel-btn').addEventListener('click', () => {
                    renderView();
                });
                popover.querySelector('.note-save-btn').addEventListener('click', async () => {
                    const newNote = ta.value.trim();
                    await saveNoteOnly(planId, newNote);
                    popover._currentNote = newNote;
                    btn.setAttribute('title', newNote);
                    // If note was cleared, remove the icon button entirely and close
                    if (!newNote) {
                        btn.closest('.action-cell')?.querySelector('.btn-note-icon')?.remove();
                        popover.remove();
                        return;
                    }
                    renderView();
                });
            }

            popover._currentNote = note;
            renderView();

            document.body.appendChild(popover);

            // Position below the button
            const rect = btn.getBoundingClientRect();
            const pw = 280;
            let left = rect.left + window.scrollX;
            if (left + pw > window.innerWidth - 16) left = window.innerWidth - pw - 16;
            popover.style.left = left + 'px';
            popover.style.top = (rect.bottom + window.scrollY + 6) + 'px';
            popover.style.width = pw + 'px';

            setTimeout(() => document.addEventListener('click', function handler(ev) {
                if (!popover.contains(ev.target)) {
                    popover.remove();
                    document.removeEventListener('click', handler);
                }
            }), 0);
        });
    });

    // ── Mark Complete button ──────────────────────────────────────
    tbody.querySelectorAll('.btn-action').forEach(btn => {
        btn.addEventListener('click', () => openCompleteModal(
            parseInt(btn.dataset.planId),
            parseInt(btn.dataset.idx)
        ));
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
        code: '#1Insp', name: '#1 Inspection',
        resolve: () => '#1Insp',
        group: 'Final Test',
    },
    {
        code: 'T.Run', name: 'TEST RUN',
        resolve: () => 'TEST RUN',
        group: 'Final Test',
    },
    {
        code: 'Perf.', name: 'Performance test',
        resolve: () => 'Performance test',
        group: 'Final Test',
    },
    {
        code: 'Repair', name: 'REPAIR',
        resolve: () => 'REPAIR',
        group: 'Final Test',
    },
    {
        code: 'Check', name: 'CHECK',
        resolve: () => 'CHECK',
        group: 'Final Test',
    },
    {
        code: 'PP Chk', name: 'Powerpack check',
        resolve: () => 'Powerpack check',
        group: 'Final Test',
    },
    {
        code: 'F.Chk', name: 'Final Check',
        resolve: () => 'Final Check',
        group: 'Final Test',
    },
];

function renderVPX(data) {
    const container = document.getElementById('vpxMatrix');
    if (!container) return;

    if (!data?.length) {
        container.innerHTML = '<div class="vpx-empty">Load data to view the progress matrix.</div>';
        return;
    }

    // Build row data: one row per vehicle+unit
    const rowMap = {};
    data.forEach(task => {
        const rowKey = task.vehicle + '||' + task.vehicle_no;
        if (!rowMap[rowKey])
            rowMap[rowKey] = { vehicle: task.vehicle, vehicle_no: task.vehicle_no, stations: {} };
        const existing = rowMap[rowKey].stations[task.process_station];
        if (!existing || task.end_date > existing.end_date)
            rowMap[rowKey].stations[task.process_station] = task;
    });

    const rows = Object.values(rowMap).sort((a, b) => {
        const vc = vehicleSort(a.vehicle, b.vehicle);
        return vc !== 0 ? vc : naturalSort(a.vehicle_no, b.vehicle_no);
    });

    const usedStations = new Set(data.map(t => t.process_station));

    // A column is active if at least one vehicle resolves a non-null station key in data
    const activeCols = VPX_COLUMNS.filter(col =>
        rows.some(row => { const k = col.resolve(row.vehicle); return k !== null && usedStations.has(k); })
    );

    if (!activeCols.length) {
        container.innerHTML = '<div class="vpx-empty">No station data matches the known column list.</div>';
        return;
    }

    // Column group spans
    const groups = [];
    activeCols.forEach(col => {
        if (!groups.length || groups[groups.length - 1].label !== col.group)
            groups.push({ label: col.group, span: 1 });
        else
            groups[groups.length - 1].span++;
    });

    function grpSlug(g) { return g.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

    let html = '<table class="vpx-table" role="grid"><thead>';

    // Group header row
    html += '<tr class="vpx-group-row"><th class="vpx-th-vehicle" rowspan="2">Vehicle &middot; Unit</th>';
    groups.forEach(g => {
        html += '<th class="vpx-th-group vpx-grp-' + grpSlug(g.label) + '" colspan="' + g.span + '">' + g.label + '</th>';
    });
    html += '</tr><tr class="vpx-col-row">';
    activeCols.forEach((col, ci) => {
        html += '<th class="vpx-th-col vpx-grp-' + grpSlug(col.group) + '" data-col="' + ci + '" title="' + col.name + '">' + col.code + '</th>';
    });
    html += '</tr></thead><tbody>';

    // Group rows by vehicle so we can insert vehicle header rows like Gantt
    const vehicles = [...new Set(rows.map(r => r.vehicle))];

    rows.forEach((row, ri) => {
        // Insert a vehicle group header row before first unit of each vehicle — matches Gantt gr-group-label
        const prevVehicle = ri > 0 ? rows[ri - 1].vehicle : null;
        if (row.vehicle !== prevVehicle) {
            html += '<tr class="vpx-row vpx-row-group">';
            html += '<td class="vpx-td-vehicle vpx-td-group" colspan="1">'
                + '<svg class="vpx-veh-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 8h6M5 11h4"/></svg>'
                + '<span class="vpx-veh-name">' + esc(row.vehicle) + '</span>'
                + '</td>';
            // Fill rest of columns with empty group cells (same bg)
            activeCols.forEach(() => { html += '<td class="vpx-group-fill"></td>'; });
            html += '</tr>';
        }

        html += '<tr class="vpx-row" data-ri="' + ri + '">';
        html += '<td class="vpx-td-vehicle vpx-td-unit">'
            + '<span class="vpx-unit-dot"></span>'
            + '<span class="vpx-unit-name">' + esc(row.vehicle_no) + '</span>'
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

            html += '<td class="vpx-cell ' + grpCls + ' vpx-status-' + statusSlug + '" data-ri="' + ri + '" data-ci="' + ci + '" title="' + tipParts.replace(/"/g, "'") + '">'
                + '<span class="vpx-dot ' + dotClass + '"></span>'
                + '<div class="vpx-dates">'
                + '<span class="vpx-date-plan">' + (formatDate(planned) || '—') + '</span>'
                + '<span class="vpx-date-act' + (actual ? '' : ' vpx-date-none') + '">' + (actual ? formatDate(actual) : '—') + '</span>'
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
}

function renderBarChart(data) {
    const vehicles = [...new Set(data.map(r => r.vehicle))].sort(vehicleSort);

    const counts = vehicles.map(v => {
        const rows = data.filter(r => r.vehicle === v);
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
            labels: vehicles.length ? vehicles : ['No Data'],
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
                    backgroundColor: 'rgba(139,92,246,.75)',
                    borderColor: '#8b5cf6',
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
        options: chartOptions('Status Count'),
    };

    if (barChartInst) barChartInst.destroy();
    barChartInst = new Chart(document.getElementById('barChart'), cfg);
}

function renderLineChart(data) {
    // Build daily timeline between min start_date and today
    if (!data.length) {
        if (lineChartInst) lineChartInst.destroy();
        lineChartInst = null;
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
            const cd = r.progress?.completion_date;
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
            ...chartOptions('Cumulative Tasks'),
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

    try {
        // Fetch ALL rows for this plan_id — guard against duplicate rows
        const { data: allRows } = await db
            .from('assembly_progress').select('*').eq('plan_id', planId).order('updated_at', { ascending: false });

        const snapBefore = allRows?.[0] || null;

        // If duplicates exist, delete the extras to keep the table clean
        if (allRows && allRows.length > 1) {
            const extraIds = allRows.slice(1).map(r => r.id);
            await db.from('assembly_progress').delete().in('id', extraIds);
        }

        if (snapBefore) {
            const { error } = await db
                .from('assembly_progress')
                .update({ actual_start_date: valueToSave, updated_at: new Date().toISOString() })
                .eq('id', snapBefore.id);
            if (error) throw error;
        } else if (valueToSave) {
            const { error } = await db
                .from('assembly_progress')
                .insert({ plan_id: planId, actual_start_date: valueToSave, completed: false, updated_at: new Date().toISOString() });
            if (error) throw error;
        }

        // Snapshot after for audit
        const { data: snapAfter } = await db
            .from('assembly_progress').select('*').eq('plan_id', planId).maybeSingle();

        await auditLog(
            snapBefore ? 'UPDATE' : 'INSERT',
            'assembly_progress', planId, snapBefore || null, snapAfter || null
        );

        showToast(valueToSave ? 'Start date saved.' : 'Start date cleared.', 'success');
        // In-place update: patch currentData and re-render without scroll reset
        const row = currentData.find(t => t.id === planId);
        if (row) {
            row.progress = snapAfter || row.progress || {};
            row.progress.actual_start_date = valueToSave;
            refreshAllViews();
        } else {
            await loadData();
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

    try {
        const { data: allRowsC } = await db
            .from('assembly_progress').select('*').eq('plan_id', planId).order('updated_at', { ascending: false });

        const snapBefore = allRowsC?.[0] || null;

        if (allRowsC && allRowsC.length > 1) {
            const extraIds = allRowsC.slice(1).map(r => r.id);
            await db.from('assembly_progress').delete().in('id', extraIds);
        }

        if (snapBefore) {
            const { error } = await db
                .from('assembly_progress')
                .update({ completed: !!valueToSave, completion_date: valueToSave, updated_at: new Date().toISOString() })
                .eq('id', snapBefore.id);
            if (error) throw error;
        } else if (valueToSave) {
            const { error } = await db
                .from('assembly_progress')
                .insert({ plan_id: planId, completed: true, completion_date: valueToSave, updated_at: new Date().toISOString() });
            if (error) throw error;
        }

        const { data: snapAfter } = await db
            .from('assembly_progress').select('*').eq('plan_id', planId).maybeSingle();

        await auditLog(
            snapBefore ? 'UPDATE' : 'INSERT',
            'assembly_progress', planId, snapBefore || null, snapAfter || null
        );

        showToast(valueToSave ? 'Completion date saved.' : 'Completion date cleared.', 'success');
        const row2 = currentData.find(t => t.id === planId);
        if (row2) {
            row2.progress = snapAfter || row2.progress || {};
            row2.progress.completed = !!valueToSave;
            row2.progress.completion_date = valueToSave;
            refreshAllViews();
        } else {
            await loadData();
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
    const valueToSave = noteText.trim() || null;
    try {
        const { data: existing } = await db
            .from('assembly_progress')
            .select('id, notes')
            .eq('plan_id', planId)
            .maybeSingle();

        if (existing) {
            const before = { notes: existing.notes };
            const { error } = await db
                .from('assembly_progress')
                .update({ notes: valueToSave, updated_at: new Date().toISOString() })
                .eq('id', existing.id);
            if (error) throw error;
            await auditLog('UPDATE', 'assembly_progress', planId,
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

function openCompleteModal(planId, idx) {
    activePlanId = planId;
    // Always look up by planId — idx can drift after in-place re-renders
    const row = currentData.find(t => t.id === planId) || currentData[idx];
    const actualStart = row.progress?.actual_start_date;

    document.getElementById('modalInfo').innerHTML = `
    <strong>${esc(row.vehicle)} · ${esc(row.vehicle_no)}</strong><br>
    ${esc(row.process_station)}<br>
    <small>Planned: ${formatDate(row.start_date)} → ${formatDate(row.end_date)}</small>
    ${actualStart ? `<br><small>Actual start: ${formatDate(actualStart)}</small>` : ''}
  `;
    document.getElementById('modalDate').value = todayStr();
    document.getElementById('modalNotes').value = row.progress?.notes || '';

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

    try {
        const { data: allRowsM } = await db
            .from('assembly_progress').select('*').eq('plan_id', planId).order('updated_at', { ascending: false });

        const snapBefore = allRowsM?.[0] || null;

        if (allRowsM && allRowsM.length > 1) {
            const extraIds = allRowsM.slice(1).map(r => r.id);
            await db.from('assembly_progress').delete().in('id', extraIds);
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
                .from('assembly_progress')
                .update({ completed: true, completion_date: compDate, notes, updated_at: payload.updated_at })
                .eq('id', snapBefore.id);
            opError = error;
        } else {
            const { error } = await db.from('assembly_progress').insert(payload);
            opError = error;
        }
        if (opError) throw opError;

        const { data: snapAfter } = await db
            .from('assembly_progress').select('*').eq('plan_id', planId).maybeSingle();

        await auditLog(
            snapBefore ? 'UPDATE' : 'INSERT',
            'assembly_progress', planId, snapBefore || null, snapAfter || null
        );

        showToast('Progress saved successfully.', 'success');
        const mRow = currentData.find(t => t.id === planId);
        if (mRow) {
            mRow.progress = snapAfter || mRow.progress || {};
            mRow.progress.completed = true;
            mRow.progress.completion_date = compDate;
            mRow.progress.notes = notes || null;
            refreshAllViews();
        } else {
            await loadData();
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

    // Show/hide custom date fields
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

    // Report modal
    wireReportModal();

    // ── Auth controls ────────────────────────────────────────────────
    document.getElementById('btnLogout')?.addEventListener('click', doLogout);

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

    // ── Live table search (wire ONCE here, not inside resetFilters) ────
    document.getElementById('tableSearch')?.addEventListener('input', function () {
        const q = this.value.trim().toLowerCase();
        const cat = getVal('filterCategory');
        const base = cat ? currentData.filter(r => getCategory(r.process_station) === cat) : currentData;
        const filtered = q ? base.filter(r =>
            (r.vehicle || '').toLowerCase().includes(q) ||
            (r.vehicle_no || '').toLowerCase().includes(q) ||
            (r.process_station || '').toLowerCase().includes(q) ||
            (r.remark || '').toLowerCase().includes(q) ||
            (r.week || '').toLowerCase().includes(q)
        ) : base;
        const pos = saveScrollPos();
        renderTable(filtered);
        document.getElementById('rowCount').textContent =
            filtered.length + ' record' + (filtered.length !== 1 ? 's' : '') + (q ? ' (filtered)' : '');
        restoreScrollPos(pos);
    });

    // VPX PDF export
    document.getElementById('btnVpxPdf')?.addEventListener('click', exportVpxPDF);
}

function resetFilters() {
    ['filterVehicle', 'filterUnit', 'filterWeek', 'filterTimeFrame', 'filterCategory'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    document.getElementById('customDateStart').style.display = 'none';
    document.getElementById('customDateEnd').style.display = 'none';
    const srch = document.getElementById('tableSearch');
    if (srch) srch.value = '';
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
        <td colspan="13" class="table-empty">
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

function daysBetween(from, to) {
    const a = new Date(from + 'T00:00:00');
    const b = new Date(to + 'T00:00:00');
    return Math.max(0, Math.round((b - a) / 86400000));
}

function currentWeekRange() {
    const now = new Date();
    const day = now.getDay();            // 0=Sun … 6=Sat
    // Work week: Sunday(0) → Thursday(4); weekend: Friday(5), Saturday(6)
    const diff = (day === 0 ? 0 : day <= 4 ? -day : 7 - day);
    const sun = new Date(now);
    sun.setDate(now.getDate() + diff);
    const thu = new Date(sun);
    thu.setDate(sun.getDate() + 4);
    return {
        weekStart: sun.toISOString().slice(0, 10),
        weekEnd: thu.toISOString().slice(0, 10),
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
   Preference stored in localStorage so it survives page reloads.
   Applied on <html> via data-theme attribute to leverage CSS vars.
   Must run synchronously before DOMContentLoaded to prevent flash.
   ================================================================ */
const THEME_KEY = 'kd1_theme';

(function applyStoredTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light') document.documentElement.setAttribute('data-theme', 'light');
})();

function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
}

function setTheme(theme) {
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem(THEME_KEY, theme);
    // Re-render charts with correct palette for new theme
    if (currentData.length) renderCharts(currentData);
}

function toggleTheme() {
    setTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
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
    initializeApp();
});
/* ================================================================
   GANTT CHART ADDITIONS — append to bottom of app.js
   Then apply the two small patches described at the bottom.
   ================================================================ */

/* ──────────────────────────────────────────────────────────────────
   GANTT CONSTANTS
   ────────────────────────────────────────────────────────────────── */
const GANTT_LABEL_W = 220;   // px — frozen left label column width
const GANTT_DAY_W = 36;    // px — width of each day column
const GANTT_ROW_H = 40;    // px — unit row height
const GANTT_GRP_H = 30;    // px — vehicle group header row height

// Colour palette for process stations (cycles if > 10 unique stations)
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
   FISCAL WEEK NUMBER  (Sunday-based — week starts Sunday)
   ────────────────────────────────────────────────────────────────── */
/**
 * ISO 8601 week number (1–53).  Week 1 is the week containing the first
 * Thursday of the year, and weeks run Monday → Sunday.
 * Returns { week, year } — the year may differ from the calendar year
 * for days in late December / early January.
 */
function getISOWeekInfo(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    // Shift to Thursday of the same week (ISO weeks anchored to Thursday)
    const thu = new Date(d);
    thu.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3); // Monday=0 offset
    const year = thu.getFullYear();
    const jan4 = new Date(year, 0, 4);   // Jan 4 is always in week 1
    const week = 1 + Math.round((thu - jan4) / (7 * 86400000));
    return { week, year };
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
 * Monday and Sunday of that ISO week for the current or nearest year.
 * Returns { weekStart, weekEnd } as YYYY-MM-DD strings.
 */
function isoWeekDateRange(label) {
    const num = parseInt(label.replace(/[^0-9]/g, ''), 10);
    if (!num) return null;
    // Determine which year: use the year whose FW#{num} is closest to today
    const todayD = new Date(todayStr() + 'T00:00:00');
    const year = todayD.getFullYear();
    // Jan 4 of that year is always in week 1 → find Monday of week 1
    function weekStart(y) {
        const jan4 = new Date(y, 0, 4);
        const w1Mon = new Date(jan4);
        w1Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
        const mon = new Date(w1Mon);
        mon.setDate(w1Mon.getDate() + (num - 1) * 7);
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        return { weekStart: localDateStr(mon), weekEnd: localDateStr(sun) };
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
    // Default range: first day of current month → last day 2 months out
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const defaultStart = new Date(y, m - 2, 1).toISOString().slice(0, 10);
    const defaultEnd = new Date(y, m + 4, 0).toISOString().slice(0, 10);

    const gsEl = document.getElementById('ganttStart');
    const geEl = document.getElementById('ganttEnd');
    if (gsEl) gsEl.value = defaultStart;
    if (geEl) geEl.value = defaultEnd;

    document.getElementById('btnGanttRefresh')?.addEventListener('click', () => {
        renderGantt(currentData, gsEl?.value, geEl?.value);
    });
}

/* ──────────────────────────────────────────────────────────────────
   MAIN RENDER FUNCTION
   Call:  renderGantt(plansArray, 'YYYY-MM-DD', 'YYYY-MM-DD')
   ────────────────────────────────────────────────────────────────── */
function renderGantt(plans, startDate, endDate) {
    const inner = document.getElementById('ganttInner');
    if (!inner) return;

    if (!plans?.length || !startDate || !endDate || startDate > endDate) {
        inner.innerHTML = `
      <div class="gantt-empty-state">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="6" y="6" width="36" height="36" rx="4"/>
          <path d="M14 18h20M14 26h12M14 34h8"/>
        </svg>
        <p>Load data and set a date range, then click <strong>Refresh</strong> to render the schedule.</p>
      </div>`;
        document.getElementById('ganttLegend').innerHTML = '';
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
    // Only include tasks that overlap the visible date range
    const visible = plans.filter(p =>
        p.start_date <= endDate && p.end_date >= startDate
    );

    const groups = {};
    visible.forEach(p => {
        if (!groups[p.vehicle]) groups[p.vehicle] = {};
        if (!groups[p.vehicle][p.vehicle_no]) groups[p.vehicle][p.vehicle_no] = [];
        groups[p.vehicle][p.vehicle_no].push(p);
    });

    const vehicleKeys = Object.keys(groups).sort(vehicleSort);

    if (!vehicleKeys.length) {
        inner.innerHTML = `
      <div class="gantt-empty-state">
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="6" y="6" width="36" height="36" rx="4"/>
          <path d="M14 24h20M24 14v20"/>
        </svg>
        <p>No tasks fall within the selected date range.</p>
      </div>`;
        return;
    }

    // ── 3. Header HTML ─────────────────────────────────────────────
    let mHtml = `<div class="gh-corner" style="width:${GANTT_LABEL_W}px;height:28px"></div>`;
    let wHtml = `<div class="gh-corner" style="width:${GANTT_LABEL_W}px;height:22px"></div>`;
    let dHtml = `<div class="gh-corner gh-corner-label" style="width:${GANTT_LABEL_W}px;height:28px">Vehicle / Unit</div>`;

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
        dHtml += `<div class="gh-day${dm.isSat ? ' gh-day-sat' : ''}${dm.isToday ? ' gh-day-today' : ''}"
      style="width:${GANTT_DAY_W}px;height:28px">${dm.dayNum}</div>`;
    });

    // Flush last groups
    mHtml += `<div class="gh-month" style="width:${runMonthSpan * GANTT_DAY_W}px">${runMonth}</div>`;
    wHtml += `<div class="gh-week"  style="width:${runWeekSpan * GANTT_DAY_W}px">FW${runWeek}</div>`;

    // ── 4. Background day cells (shared template per row) ─────────
    const bgCells = dayMeta.map(dm =>
        `<div class="gc-cell${dm.isSat ? ' gc-cell-sat' : ''}" style="width:${GANTT_DAY_W}px"></div>`
    ).join('');

    // ── 5. Special zone bands ──────────────────────────────────────
    let zonesHtml = '';
    SPECIAL_ZONES.forEach(z => {
        // Clamp zone to visible range
        const s = z.start > startDate ? z.start : startDate;
        const e = z.end < endDate ? z.end : endDate;
        const si = dayIndex[s] ?? resolveCol(s, null);
        const ei = dayIndex[e] ?? resolveCol(e, null);
        if (si === null || ei === null || si > ei) return;

        const left = GANTT_LABEL_W + si * GANTT_DAY_W;
        const width = (ei - si + 1) * GANTT_DAY_W;
        zonesHtml += `
      <div class="gc-zone gc-zone-${esc(z.type)}"
           style="left:${left}px;width:${width}px"
           title="${esc(z.label || z.type)}">
        <span class="gc-zone-label">${esc(z.label || z.type)}</span>
      </div>`;
    });

    // Today marker
    const todayCol = dayIndex[today] ?? resolveCol(today, null);
    if (todayCol !== null) {
        const todayLeft = GANTT_LABEL_W + todayCol * GANTT_DAY_W + Math.floor(GANTT_DAY_W / 2);
        zonesHtml += `<div class="gc-today-line" style="left:${todayLeft}px"></div>`;
    }

    // ── 6. Body rows ───────────────────────────────────────────────
    let bodyHtml = zonesHtml;

    vehicleKeys.forEach(vehicle => {
        const unitKeys = Object.keys(groups[vehicle]).sort(naturalSort);

        // Vehicle group header row
        bodyHtml += `
      <div class="gr gr-group" style="height:${GANTT_GRP_H}px">
        <div class="gr-label gr-group-label" style="width:${GANTT_LABEL_W}px">
          <svg class="gr-label-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="2" y="3" width="12" height="10" rx="1.5"/>
            <path d="M5 8h6M5 11h4"/>
          </svg>
          ${esc(vehicle)}
        </div>
        <div class="gr-track gr-track-group" style="width:${totalW}px">${bgCells}</div>
      </div>`;

        // Unit rows
        unitKeys.forEach(unit => {
            const tasks = groups[vehicle][unit];

            // ── Lane assignment for overlapping bars ─────────────────────
            // Sort by start date so we process left-to-right
            const positioned = tasks
                .map(task => {
                    // Clamp tasks that start before / end after the visible range
                    const rawSi = task.start_date < startDate ? 0 : resolveCol(task.start_date, null);
                    const rawEi = task.end_date > endDate ? numDays - 1 : resolveCol(task.end_date, null);
                    if (rawSi === null || rawEi === null || rawSi > rawEi) return null;
                    return { task, si: rawSi, ei: rawEi };
                })
                .filter(Boolean)
                .sort((a, b) => a.si - b.si);

            // Sort by user-set lane priority first, then by start column
            // _laneOrder[id] is a small integer the user controls with ▲▼ buttons
            positioned.sort((a, b) => {
                const pa = _laneOrder[a.task.id] ?? 0;
                const pb = _laneOrder[b.task.id] ?? 0;
                if (pa !== pb) return pa - pb;
                return a.si - b.si;
            });

            // Assign each task to the lowest lane it doesn't collide with
            const laneEndAt = [];
            positioned.forEach(p => {
                let lane = 0;
                while (laneEndAt[lane] !== undefined && laneEndAt[lane] >= p.si) lane++;
                p.lane = lane;
                laneEndAt[lane] = p.ei;
            });

            const numLanes = laneEndAt.length || 1;
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
                const actualStart = task.progress?.actual_start_date || null;

                let shadow = '';
                let extraCls = '';
                if (status === 'Completed') shadow = `;box-shadow:0 0 0 2px #22c55e inset,0 2px 6px rgba(0,0,0,.3)`;
                else if (status === 'Late Completion') shadow = `;box-shadow:0 0 0 2px #8b5cf6 inset,0 2px 6px rgba(0,0,0,.3)`;  // purple
                else if (status === 'Overdue') extraCls = ' gc-bar-overdue';
                else if (status === 'In Progress') shadow = `;box-shadow:0 0 0 2px #f59e0b inset,0 2px 6px rgba(0,0,0,.3)`;
                else shadow = `;box-shadow:0 2px 6px rgba(0,0,0,.3)`;

                let actualStartMarker = '';
                if (actualStart && dayIndex[actualStart] !== undefined) {
                    const aIdx = dayIndex[actualStart];
                    const tickLeft = (aIdx - si) * GANTT_DAY_W;
                    const tickColor = actualStart > task.start_date ? '#ef4444' : '#22c55e';
                    actualStartMarker = `<div class="gc-actual-start-tick" style="left:${tickLeft}px;border-color:${tickColor}" title="Actual start: ${formatDate(actualStart)}"></div>`;
                }

                const tip = [
                    `${task.vehicle}  ${task.vehicle_no}`,
                    `Station      : ${task.process_station}`,
                    `Planned      : ${formatDate(task.start_date)} → ${formatDate(task.end_date)}`,
                    actualStart ? `Actual Start : ${formatDate(actualStart)}` : '',
                    task.progress?.completion_date ? `Completed    : ${formatDate(task.progress.completion_date)}` : '',
                    `Status       : ${status}`,
                    task.remark ? `Remark       : ${task.remark}` : '',
                ].filter(Boolean).join('\n');

                // Use absolute top instead of the old top:50% transform
                const laneUp = _ganttEditMode ? `<button class="gc-bar-lane gc-bar-lane-up"   data-plan-id="${task.id}" title="Move lane up">&#9650;</button>` : '';
                const laneDown = _ganttEditMode ? `<button class="gc-bar-lane gc-bar-lane-dn"   data-plan-id="${task.id}" title="Move lane down">&#9660;</button>` : '';
                const editBtns = _ganttEditMode ? `
          <button class="gc-bar-edit"   data-plan-id="${task.id}" title="Edit block">&#9998;</button>
          <button class="gc-bar-delete" data-plan-id="${task.id}" title="Delete block">&#x2715;</button>` : '';
                return `<div class="gc-bar${extraCls}"
          data-plan-id="${task.id}"
          style="left:${left}px;width:${width}px;height:${BAR_H}px;top:${topPx}px;transform:none;background:${color}${shadow}"
          title="${esc(tip)}">
          ${laneUp}${laneDown}
          ${actualStartMarker}
          <span class="gc-bar-text">${esc(task.process_station)}</span>
          ${editBtns}
        </div>`;
            }).join('');

            bodyHtml += `
        <div class="gr" style="height:${rowH}px">
          <div class="gr-label gr-unit-label" style="width:${GANTT_LABEL_W}px">
            <span class="gr-unit-dot"></span>
            <span class="gr-unit-name">${esc(unit)}</span>
          </div>
          <div class="gr-track" style="width:${totalW}px;height:${rowH}px">
            ${bgCells}
            ${bars}
          </div>
        </div>`;
        });
    });

    // ── 7. Assemble ────────────────────────────────────────────────
    inner.innerHTML = `
    <div class="gantt-wrap" style="min-width:${innerW}px">
      <div class="gantt-head">
        <div class="gh-row gh-row-month">${mHtml}</div>
        <div class="gh-row gh-row-week">${wHtml}</div>
        <div class="gh-row gh-row-day">${dHtml}</div>
      </div>
      <div class="gantt-body">${bodyHtml}</div>
    </div>`;

    // ── 8. Legend ──────────────────────────────────────────────────
    const legend = document.getElementById('ganttLegend');
    if (legend) {
        legend.innerHTML = Object.entries(_stationColors).map(([name, color]) => `
      <div class="gantt-legend-item">
        <span class="gantt-legend-dot" style="background:${color}"></span>
        <span class="gantt-legend-label">${esc(name)}</span>
      </div>`).join('');
    }

    // ── 9. Show zone key bar if zones exist ────────────────────────
    const zoneKeyEl = document.getElementById('ganttZoneKey');
    if (zoneKeyEl) zoneKeyEl.style.display = SPECIAL_ZONES.length ? 'flex' : 'none';

    // ── 10. Auto-scroll to today ───────────────────────────────────
    if (dayIndex[today] !== undefined) {
        const scrollRoot = document.getElementById('ganttScrollRoot');
        if (scrollRoot) {
            const todayPx = GANTT_LABEL_W + dayIndex[today] * GANTT_DAY_W;
            const offset = Math.max(0, todayPx - scrollRoot.clientWidth / 2);
            setTimeout(() => { scrollRoot.scrollLeft = offset; }, 60);
        }
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
};

/* ─── Build the row array for a report ─────────────────────────── */
function buildReportRows(typeKey, fromDate, toDate, category) {
    const def = REPORT_TYPES[typeKey];
    if (!def) return [];

    let rows = currentData.filter(def.filter);

    if (fromDate) rows = rows.filter(r => r.start_date >= fromDate);
    if (toDate) rows = rows.filter(r => r.start_date <= toDate);
    if (category) rows = rows.filter(r => getCategory(r.process_station) === category);

    return rows;
}

/* ─── Column config ─────────────────────────────────────────────── */
const REPORT_COLUMNS = [
    { header: '#', key: (r, i) => i + 1 },
    { header: 'Vehicle', key: r => r.vehicle },
    { header: 'Unit', key: r => r.vehicle_no },
    { header: 'Station', key: r => r.process_station },
    { header: 'Category', key: r => getCategory(r.process_station) },
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

/* ─── Status → colour map for PDF ──────────────────────────────── */
const STATUS_COLORS = {
    'Completed': [34, 197, 94],
    'Late Completion': [139, 92, 246],  // purple — matches VPX dot
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
function exportPDF(typeKey, fromDate, toDate, category) {
    const def = REPORT_TYPES[typeKey];
    const rows = buildReportRows(typeKey, fromDate, toDate, category);

    if (!rows.length) {
        showToast('No data matches this report criteria.', 'error');
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

    // ── White page background ─────────────────────────────────────────
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

    // ── Header band — navy blue accent bar ───────────────────────────
    doc.setFillColor(30, 58, 138);      // navy
    doc.rect(0, 0, PAGE_W, 20, 'F');

    // KD1 badge box
    doc.setFillColor(59, 130, 246);
    doc.roundedRect(MARGIN, 4, 18, 12, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('KD1', MARGIN + 9, 11.5, { align: 'center' });

    // Title
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text('Assembly Control System', MARGIN + 22, 10);

    // Sub-title / report label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(147, 197, 253);   // light blue
    doc.text(def.label.toUpperCase(), MARGIN + 22, 16);

    // Generated timestamp (right-aligned)
    doc.setFontSize(7.5);
    doc.setTextColor(186, 230, 253);
    doc.text(`Generated: ${now}`, PAGE_W - MARGIN, 16, { align: 'right' });

    // ── Active filter chips (vehicle / category / date) ───────────────
    let chipX = MARGIN;
    const chipY = 24;
    const chipH = 6;
    const chipPad = 3;
    const chips = [];
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
        { label: 'Late Completion', value: stats.late, r: 139, g: 92, b: 246 },
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
    const headers = REPORT_COLUMNS.map(c => c.header);
    const body = rows.map((r, i) => REPORT_COLUMNS.map(c => String(c.key(r, i) ?? '')));

    // Status badge colours for white background (darker shades)
    const STATUS_COLORS_LIGHT = {
        'Completed': { bg: [220, 252, 231], text: [21, 128, 61] },
        'Late Completion': { bg: [237, 233, 254], text: [109, 40, 217] },  // purple
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
            overflow: 'ellipsize',
        },
        headStyles: {
            fillColor: [30, 58, 138],      // navy — matches header bar
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 7,
            halign: 'center',
        },
        alternateRowStyles: {
            fillColor: [248, 250, 252],      // slate-50
        },
        columnStyles: {
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
            12: { cellWidth: 24 },
            13: { cellWidth: 'auto' },
        },
        didDrawCell(data) {
            if (data.section === 'body' && data.column.index === 10) {
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
            // Delay cell — red text if value starts with +
            if (data.section === 'body' && data.column.index === 11) {
                const val = data.cell.raw;
                if (String(val).startsWith('+')) {
                    doc.setTextColor(153, 27, 27);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(7);
                    doc.text(val, data.cell.x + data.cell.width / 2,
                        data.cell.y + data.cell.height / 2 + 0.5,
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
                doc.text('KD1 Assembly Control System — ' + def.label, MARGIN, 4.5);
            }
            // Footer separator line
            const pY = PAGE_H - 8;
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.3);
            doc.line(MARGIN, pY, PAGE_W - MARGIN, pY);

            doc.setFontSize(6.5);
            doc.setTextColor(148, 163, 184);
            doc.setFont('helvetica', 'normal');
            doc.text('KD1 Assembly Control System — Confidential', MARGIN, pY + 3.5);
            doc.text(
                `Page ${data.pageNumber} of ${doc.internal.getNumberOfPages()}`,
                PAGE_W - MARGIN, pY + 3.5, { align: 'right' }
            );
        },
    });

    // ── Save ─────────────────────────────────────────────────────────
    const catSuffix = category ? `_${category.replace(/\s+/g, '_')}` : '';
    const dateSuffix = new Date().toISOString().slice(0, 10);
    doc.save(`KD1_${def.label.replace(/\s+/g, '_')}${catSuffix}_${dateSuffix}.pdf`);
    showToast(`PDF exported — ${rows.length} rows`, 'success');
}

/* ══════════════════════════════════════════════════════════════════
   EXCEL EXPORT
   ══════════════════════════════════════════════════════════════════ */
function exportExcel(typeKey, fromDate, toDate, category) {
    const def = REPORT_TYPES[typeKey];
    const rows = buildReportRows(typeKey, fromDate, toDate, category);

    if (!rows.length) {
        showToast('No data matches this report criteria.', 'error');
        return;
    }

    const stats = buildSummaryStats(rows);
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Data ────────────────────────────────────────────────
    const headers = REPORT_COLUMNS.map(c => c.header);
    const data = [
        headers,
        ...rows.map((r, i) => REPORT_COLUMNS.map(c => {
            const v = c.key(r, i);
            // Keep delay as number for Excel
            if (c.header === 'Delay (days)') return delayDays(r) || '';
            return v ?? '';
        })),
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Column widths
    ws['!cols'] = [
        { wch: 5 },  // #
        { wch: 10 },  // Vehicle
        { wch: 10 },  // Unit
        { wch: 26 },  // Station
        { wch: 14 },  // Category
        { wch: 8 },  // Week
        { wch: 14 },  // Planned Start
        { wch: 14 },  // Planned End
        { wch: 14 },  // Actual Start
        { wch: 14 },  // Completed On
        { wch: 13 },  // Status
        { wch: 12 },  // Delay
        { wch: 22 },  // Remark
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Report Data');

    // ── Sheet 2: Summary ─────────────────────────────────────────────
    const summaryData = [
        ['KD1 Assembly Control System'],
        [def.label],
        [`Generated: ${new Date().toLocaleString('en-GB')}`],
        [],
        ['Metric', 'Count'],
        ['Total Tasks', stats.total],
        ['Completed', stats.completed],
        ['In Progress', stats.inProgress],
        ['Planned', stats.planned],
        ['Overdue', stats.overdue],
        ['Late Completion', stats.late],
        ['Progress %', `${stats.pct}%`],
    ];

    if (getVal('filterVehicle')) summaryData.push(['Vehicle Filter', getVal('filterVehicle')]);
    if (category) summaryData.push(['Category Filter', category]);
    if (fromDate || toDate) summaryData.push(['Date Range', `${fromDate || '…'} → ${toDate || '…'}`]);

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 20 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // ── Sheet 3: By Vehicle breakdown ────────────────────────────────
    const vehicles = [...new Set(rows.map(r => r.vehicle))].sort(vehicleSort);
    const breakdownHdr = ['Vehicle', 'Total', 'Completed', 'In Progress', 'Planned', 'Overdue', 'Late Completion', 'Progress %'];
    const breakdownRows = vehicles.map(v => {
        const vRows = rows.filter(r => r.vehicle === v);
        const s = buildSummaryStats(vRows);
        return [v, s.total, s.completed, s.inProgress, s.planned, s.overdue, s.late, `${s.pct}%`];
    });

    const wsBreakdown = XLSX.utils.aoa_to_sheet([breakdownHdr, ...breakdownRows]);
    wsBreakdown['!cols'] = breakdownHdr.map(() => ({ wch: 14 }));
    XLSX.utils.book_append_sheet(wb, wsBreakdown, 'By Vehicle');

    // ── Save ─────────────────────────────────────────────────────────
    const dateSuffix = new Date().toISOString().slice(0, 10);
    const catSuffix2 = category ? `_${category.replace(/\s+/g, '_')}` : '';
    XLSX.writeFile(wb, `KD1_${def.label.replace(/\s+/g, '_')}${catSuffix2}_${dateSuffix}.xlsx`);
    showToast(`Excel exported — ${rows.length} rows across 3 sheets`, 'success');
}


/* ================================================================
   VPX — PDF EXPORT  (light mode, landscape A4)
   ================================================================ */
function exportVpxPDF() {
    if (!currentData?.length) {
        showToast('No data to export.', 'error');
        return;
    }

    // Apply same category filter as the table/VPX view
    const _vpxCategory = getVal('filterCategory');
    const vpxData = _vpxCategory
        ? currentData.filter(r => getCategory(r.process_station) === _vpxCategory)
        : currentData;

    if (!vpxData.length) {
        showToast('No data matches the current filters.', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const PAGE_W = doc.internal.pageSize.getWidth();   // 297
    const PAGE_H = doc.internal.pageSize.getHeight();  // 210
    const MARGIN = 10;
    const now = new Date().toLocaleString('en-GB');

    // ── White background ────────────────────────────────────────────
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

    // ── Header band ─────────────────────────────────────────────────
    doc.setFillColor(30, 58, 138);
    doc.rect(0, 0, PAGE_W, 18, 'F');

    // Badge
    doc.setFillColor(59, 130, 246);
    doc.roundedRect(MARGIN, 3.5, 16, 11, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('KD1', MARGIN + 8, 10.5, { align: 'center' });

    // Title
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text('Vehicle Production Progress', MARGIN + 20, 9.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(147, 197, 253);
    doc.text('STATION-BY-STATION PLANNED VS ACTUAL', MARGIN + 20, 15);

    doc.setFontSize(7);
    doc.setTextColor(186, 230, 253);
    doc.text('Generated: ' + now, PAGE_W - MARGIN, 15, { align: 'right' });

    // ── Legend ──────────────────────────────────────────────────────
    const legY = 22;
    const legend = [
        { label: 'On Schedule', r: 34, g: 197, b: 94 },
        { label: 'In Progress', r: 245, g: 158, b: 11 },
        { label: 'Late Completion', r: 139, g: 92, b: 246 },
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
    const rowMap = {};
    vpxData.forEach(task => {
        const rk = task.vehicle + '||' + task.vehicle_no;
        if (!rowMap[rk]) rowMap[rk] = { vehicle: task.vehicle, vehicle_no: task.vehicle_no, stations: {} };
        const ex = rowMap[rk].stations[task.process_station];
        if (!ex || task.end_date > ex.end_date) rowMap[rk].stations[task.process_station] = task;
    });

    const rows = Object.values(rowMap).sort((a, b) => {
        const vc = vehicleSort(a.vehicle, b.vehicle);
        return vc !== 0 ? vc : naturalSort(a.vehicle_no, b.vehicle_no);
    });

    const usedStations = new Set(vpxData.map(t => t.process_station));
    const activeCols = VPX_COLUMNS.filter(col =>
        rows.some(row => { const k = col.resolve(row.vehicle); return k !== null && usedStations.has(k); })
    );

    // Status colour helper
    function statusDotRGB(status) {
        if (status === 'Completed') return [34, 197, 94];   // green
        if (status === 'In Progress') return [245, 158, 11];   // amber
        if (status === 'Late Completion') return [139, 92, 246];   // purple — matches VPX dot
        if (status === 'Overdue') return [220, 38, 38];   // red
        return [148, 163, 184];                                      // grey — Planned
    }

    // Column header
    const head = [['Vehicle · Unit', ...activeCols.map(c => c.code)]];

    // Rows
    const body = rows.map(row => {
        return [
            row.vehicle + '\n' + row.vehicle_no,
            ...activeCols.map(col => {
                const k = col.resolve(row.vehicle);
                if (k === null) return 'N/A';
                const task = row.stations[k];
                if (!task) return '—';
                const actual = task.progress?.completion_date || null;
                const planned = task.end_date;
                return (planned ? planned.slice(5) : '?') + (actual ? '\n' + actual.slice(5) : '');
            }),
        ];
    });

    // ── AutoTable ────────────────────────────────────────────────────
    const tableStartY = legY + 6;
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
            fillColor: [30, 58, 138],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 6,
            cellPadding: 1.5,
            halign: 'center',
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
        // Column group header (second header row for group names)
        didParseCell(data) {
            if (data.section === 'head' && data.row.index === 0 && data.column.index > 0) {
                const col = activeCols[data.column.index - 1];
                if (col) {
                    const grpColors = {
                        'Assembly': [30, 58, 138],
                        'Processing': [120, 53, 15],
                        'Final Inspection': [6, 95, 70],
                        'Final Test': [76, 29, 149],
                    };
                    const [r, g, b] = grpColors[col.group] || [30, 58, 138];
                    data.cell.styles.fillColor = [r, g, b];
                }
            }
        },
    });

    // ── Footer ───────────────────────────────────────────────────────
    const fY = PAGE_H - 5;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, fY - 2, PAGE_W - MARGIN, fY - 2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(148, 163, 184);
    doc.text('KD1 Assembly Control System · Vehicle Production Progress', MARGIN, fY);
    doc.text(`Page 1 of ${doc.internal.getNumberOfPages()}`, PAGE_W - MARGIN, fY, { align: 'right' });

    const ds = new Date().toISOString().slice(0, 10);
    doc.save('KD1_VehicleProgress_' + ds + '.pdf');
    showToast('PDF exported successfully.', 'success');
}

/* ─── Wire the modal ────────────────────────────────────────────── */
function wireReportModal() {
    const overlay = document.getElementById('reportModalOverlay');
    const close = () => { overlay.style.display = 'none'; };

    document.getElementById('btnReports').addEventListener('click', () => {
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

    document.getElementById('btnExportPDF').addEventListener('click', () => {
        const type = document.querySelector('input[name="reportType"]:checked')?.value || 'full';
        exportPDF(type, getVal('reportDateFrom'), getVal('reportDateTo'), getVal('reportCategory'));
    });

    document.getElementById('btnExportExcel').addEventListener('click', () => {
        const type = document.querySelector('input[name="reportType"]:checked')?.value || 'full';
        exportExcel(type, getVal('reportDateFrom'), getVal('reportDateTo'), getVal('reportCategory'));
    });
}

function updateReportPreview() {
    const type = document.querySelector('input[name="reportType"]:checked')?.value || 'full';
    const from = getVal('reportDateFrom');
    const to = getVal('reportDateTo');
    const category = getVal('reportCategory');
    const count = buildReportRows(type, from, to, category).length;
    const bar = document.getElementById('reportPreviewBar');
    const cnt = document.getElementById('reportPreviewCount');
    const hint = bar?.querySelector('.report-preview-hint');

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

function openUserMgmt() {
    document.getElementById('userMgmtOverlay').style.display = 'flex';
    loadUserList();
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

function openAuditLog() {
    document.getElementById('auditLogOverlay').style.display = 'flex';
    _auditLogOffset = 0;
    loadAuditLog(true);
}
function closeAuditLog() {
    document.getElementById('auditLogOverlay').style.display = 'none';
}

function resetAuditFilters() {
    document.getElementById('alFilterAction').value = '';
    document.getElementById('alFilterTable').value = '';
    document.getElementById('alFilterDate').value = '';
    _auditLogOffset = 0;
    loadAuditLog(true);
}

async function loadAuditLog(reset = false) {
    if (reset) _auditLogOffset = 0;

    const action = document.getElementById('alFilterAction').value;
    const table = document.getElementById('alFilterTable').value;
    const date = document.getElementById('alFilterDate').value;
    const tbody = document.getElementById('alTableBody');

    if (reset) {
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><div class="empty-state"><span class="spinner"></span><p>Loading…</p></div></td></tr>`;
    }

    let query = db
        .from('planning_audit_log')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(_auditLogOffset, _auditLogOffset + AUDIT_PAGE_SIZE - 1);

    if (action) query = query.eq('action', action);
    if (table) query = query.eq('table_name', table);
    if (date) query = query
        .gte('created_at', date + 'T00:00:00')
        .lte('created_at', date + 'T23:59:59');

    const { data, count, error } = await query;

    if (error) {
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><div class="empty-state"><p>Error: ${esc(error.message)}</p></div></td></tr>`;
        return;
    }

    _auditTotal = count || 0;
    document.getElementById('alEntryCount').textContent = `${_auditTotal} entries`;

    const rows = (data || []).map((entry, idx) => {
        const hasDiff = entry.data_before || entry.data_after;
        const dt = new Date(entry.created_at);
        const rowId = `al-row-${_auditLogOffset + idx}`;
        if (hasDiff) _diffStore[rowId] = { before: entry.data_before, after: entry.data_after };
        return `
    <tr id="${rowId}">
      <td class="mono" style="font-size:.75rem;white-space:nowrap">
        ${dt.toLocaleDateString('en-GB')} ${dt.toLocaleTimeString('en-GB', { hour12: false })}
      </td>
      <td style="font-size:.8rem">${esc(entry.user_email)}</td>
      <td><span class="role-pill ${entry.user_role}">${entry.user_role.replace('_', ' ')}</span></td>
      <td><span class="al-action ${entry.action}">${entry.action}</span></td>
      <td class="mono" style="font-size:.75rem;color:var(--clr-text-muted)">${esc(entry.table_name || '—')}</td>
      <td class="mono" style="font-size:.75rem;color:var(--clr-text-muted)">${esc(entry.record_id || '—')}</td>
      <td class="mono" style="font-size:.75rem;color:var(--clr-text-muted)">${esc(entry.ip_address || '—')}</td>
      <td>
        ${hasDiff
                ? `<button class="al-diff-btn" onclick="toggleDiff(this,'${rowId}')">View diff</button>`
                : '<span style="color:var(--clr-text-dim);font-size:.75rem">—</span>'}
      </td>
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
    if (existing) { existing.remove(); btn.textContent = 'View diff'; return; }

    btn.textContent = 'Hide diff';
    const { before, after } = _diffStore[rowId] || {};
    const tr = document.getElementById(rowId);
    const diffRow = document.createElement('tr');
    diffRow.id = 'diff-' + rowId;
    diffRow.className = 'al-diff-row';
    diffRow.innerHTML = `
    <td colspan="8">
      <div class="al-diff-wrap">
        <div class="al-diff-panel">
          <h5>Before</h5>
          <pre>${esc(before ? JSON.stringify(before, null, 2) : '(none)')}</pre>
        </div>
        <div class="al-diff-panel">
          <h5>After</h5>
          <pre>${esc(after ? JSON.stringify(after, null, 2) : '(none)')}</pre>
        </div>
      </div>
    </td>`;
    tr.insertAdjacentElement('afterend', diffRow);
}


/* ================================================================
   GANTT EDIT MODE — drag-to-reschedule with cascade + Friday skip
   ================================================================ */

let _ganttEditMode = false;
let _ganttSatAllowed = false;
let _ganttSatAsked = false;
let _ganttMoveMode = 'single';
const _laneOrder = {};

/* ── Undo / Redo stacks ─────────────────────────────────────────── */
// Each entry: array of { id, newStart, newEnd, oldStart, oldEnd }
const _undoStack = [];
const _redoStack = [];
const _UNDO_LIMIT = 50;

function _pushUndo(changes) {
    _undoStack.push(changes);
    if (_undoStack.length > _UNDO_LIMIT) _undoStack.shift();
    _redoStack.length = 0;      // new action clears redo branch
    _syncUndoButtons();
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

/* ── Toggle edit mode ────────────────────────────────────────────── */
function setGanttEditMode(on) {
    _ganttEditMode = on;
    document.getElementById('ganttEditBar').style.display = on ? 'flex' : 'none';
    document.getElementById('btnGanttEdit').style.display = on ? 'none' : '';
    // Sync undo button states whenever edit mode changes
    _syncUndoButtons();

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

/**
 * Shift a task's start_date by `deltaDays`, preserving its duration.
 * Adjusts the new start forward if it lands on a non-working day.
 * Returns { newStart, newEnd }.
 */
function shiftTask(task, deltaDays, allowSat) {
    const duration = dayDiff(task.start_date, task.end_date); // original duration in days
    let rawStart = addDays(task.start_date, deltaDays);
    const newStart = skipNonWorking(rawStart, allowSat);
    const newEnd = addDays(newStart, duration);
    return { newStart, newEnd };
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
    const { vehicle, vehicle_no, start_date: origStart, id: movedId } = movedTask;

    const siblings = currentData.filter(t =>
        t.vehicle === vehicle &&
        t.vehicle_no === vehicle_no &&
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
            db.from('assembly_plan')
                .update({ start_date: ch.newStart, end_date: ch.newEnd, week: weekLabel(ch.newStart) })
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
        }
    });
}

async function savePlanChanges(changes) {
    if (!changes.length) return;

    showToast(`Saving ${changes.length} block${changes.length > 1 ? 's' : ''}…`, 'info');

    try {
        await _applyDateChanges(changes);

        await auditLog('UPDATE', 'assembly_plan', 'batch-move',
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
        await auditLog('UPDATE', 'assembly_plan', 'undo',
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

    showToast(`Redoing ${changes.length} block move${changes.length > 1 ? 's' : ''}…`, 'info');
    try {
        await _applyDateChanges(changes);
        await auditLog('UPDATE', 'assembly_plan', 'redo',
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
        // Let delete / edit buttons handle their own clicks — don't start a drag
        if (e.target.closest('.gc-bar-delete') || e.target.closest('.gc-bar-edit') || e.target.closest('.gc-bar-lane')) return;

        e.preventDefault();
        const bar = e.currentTarget;
        const planId = parseInt(bar.dataset.planId);
        const task = currentData.find(t => t.id === planId);
        if (!task) return;

        bar.setPointerCapture(e.pointerId);
        bar.style.cursor = 'grabbing';
        bar.style.opacity = '0.75';
        bar.style.zIndex = '999';
        bar.style.boxShadow = '0 8px 32px rgba(0,0,0,.6), 0 0 0 2px #4f8ef7';
        bar.style.transition = 'none';

        const startX = e.clientX;
        const origLeft = parseInt(bar.style.left);
        let deltaPx = 0;
        let deltaDays = 0;

        function onMove(ev) {
            deltaPx = ev.clientX - startX;
            deltaDays = Math.round(deltaPx / GANTT_DAY_W);
            bar.style.left = (origLeft + deltaDays * GANTT_DAY_W) + 'px';
        }

        async function onUp() {
            bar.releasePointerCapture(e.pointerId);
            bar.removeEventListener('pointermove', onMove);
            bar.removeEventListener('pointerup', onUp);
            bar.style.cursor = 'grab';
            bar.style.opacity = '1';
            bar.style.zIndex = '';
            bar.style.transition = '';

            if (deltaDays === 0) { bar.style.left = origLeft + 'px'; return; }

            const allowSat = await askSaturday();

            let allChanges;

            if (_ganttMoveMode === 'lane') {
                // Every block for the same vehicle + unit
                allChanges = currentData
                    .filter(t => t.vehicle === task.vehicle && t.vehicle_no === task.vehicle_no)
                    .map(t => {
                        const { newStart, newEnd } = shiftTask(t, deltaDays, allowSat);
                        return { id: t.id, newStart, newEnd, oldStart: t.start_date, oldEnd: t.end_date };
                    });
            } else if (_ganttMoveMode === 'plan') {
                // Every single block in the entire plan
                allChanges = currentData.map(t => {
                    const { newStart, newEnd } = shiftTask(t, deltaDays, allowSat);
                    return { id: t.id, newStart, newEnd, oldStart: t.start_date, oldEnd: t.end_date };
                });
            } else {
                // Single block only
                const { newStart, newEnd } = shiftTask(task, deltaDays, allowSat);
                allChanges = [{ id: task.id, newStart, newEnd, oldStart: task.start_date, oldEnd: task.end_date }];
            }

            bar.style.left = origLeft + 'px'; // reset; re-render fixes it

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

    // Move-mode toggle: Single block | Full Lane
    document.getElementById('ganttMoveToggle')?.addEventListener('click', function (e) {
        const btn = e.target.closest('.gmt-btn');
        if (!btn) return;
        _ganttMoveMode = btn.dataset.mode;
        this.querySelectorAll('.gmt-btn').forEach(b => b.classList.toggle('gmt-active', b === btn));
    });

    // Undo / Redo buttons
    document.getElementById('btnGanttUndo')?.addEventListener('click', undoGantt);
    document.getElementById('btnGanttRedo')?.addEventListener('click', redoGantt);

    // Keyboard: Ctrl+Z = undo, Ctrl+Y or Ctrl+Shift+Z = redo (only while in edit mode)
    document.addEventListener('keydown', function (e) {
        if (!_ganttEditMode) return;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
        if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undoGantt(); }
        if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redoGantt(); }
    });
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
};

/* ================================================================
   GANTT BLOCK MANAGEMENT — delete & add
   ================================================================ */

/* ── Delete a block ──────────────────────────────────────────────── */
async function deleteGanttBlock(planId) {
    if (!canEditPlan()) { showToast('Only planners and admins can delete blocks.', 'error'); return; }

    const task = currentData.find(t => t.id === planId);
    if (!task) return;

    if (!confirm(`Delete "${task.process_station}" for ${task.vehicle} ${task.vehicle_no}?\n${formatDate(task.start_date)} → ${formatDate(task.end_date)}\n\nThis cannot be undone.`)) return;

    try {
        // Delete any associated progress record first
        if (task.progress?.id) {
            await db.from('assembly_progress').delete().eq('id', task.progress.id);
        }

        const { error } = await db.from('assembly_plan').delete().eq('id', planId);
        if (error) throw error;

        await auditLog('DELETE', 'assembly_plan', planId,
            {
                vehicle: task.vehicle, vehicle_no: task.vehicle_no, process_station: task.process_station,
                start_date: task.start_date, end_date: task.end_date
            }, null);

        // Remove from in-memory data
        currentData = currentData.filter(t => t.id !== planId);

        showToast(`"${task.process_station}" deleted.`, 'success');

        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        renderGantt(currentData, gsEl?.value, geEl?.value);

    } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
        console.error(err);
    }
}

/* ── Wire bar action buttons via event delegation on ganttInner ── */
function wireBarDeleteButtons() {
    // Use event delegation on the gantt body — avoids the timing race
    // where pointerdown captures before click fires on child buttons.
    const inner = document.getElementById('ganttInner');
    if (!inner) return;

    // Remove any existing delegated listener before re-adding (avoids duplicates)
    inner.removeEventListener('click', _ganttBarClickHandler);
    inner.addEventListener('click', _ganttBarClickHandler);
}

function _ganttBarClickHandler(e) {
    // Delete button
    const delBtn = e.target.closest('.gc-bar-delete');
    if (delBtn) {
        e.stopPropagation();
        const planId = parseInt(delBtn.dataset.planId);
        deleteGanttBlock(planId);
        return;
    }
    // Edit button
    const editBtn = e.target.closest('.gc-bar-edit');
    if (editBtn) {
        e.stopPropagation();
        const planId = parseInt(editBtn.dataset.planId);
        openEditBlockModal(planId);
        return;
    }
    // Lane up button — decrease priority number (moves bar toward lane 0 = top)
    const laneUp = e.target.closest('.gc-bar-lane-up');
    if (laneUp) {
        e.stopPropagation();
        const planId = parseInt(laneUp.dataset.planId);
        _laneOrder[planId] = (_laneOrder[planId] ?? 0) - 1;
        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        renderGantt(currentData, gsEl?.value, geEl?.value);
        return;
    }
    // Lane down button — increase priority number (moves bar toward higher lanes)
    const laneDown = e.target.closest('.gc-bar-lane-dn');
    if (laneDown) {
        e.stopPropagation();
        const planId = parseInt(laneDown.dataset.planId);
        _laneOrder[planId] = (_laneOrder[planId] ?? 0) + 1;
        const gsEl = document.getElementById('ganttStart');
        const geEl = document.getElementById('ganttEnd');
        renderGantt(currentData, gsEl?.value, geEl?.value);
        return;
    }
}

/* ── Add Block modal ─────────────────────────────────────────────── */
function openAddBlockModal() {
    if (!canEditPlan()) { showToast('Only planners and admins can add blocks.', 'error'); return; }

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

/* ── Extend wireGanttControls with add/delete wiring ────────────── */
const _origWireGanttFull = wireGanttControls;
wireGanttControls = function () {
    _origWireGanttFull();

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
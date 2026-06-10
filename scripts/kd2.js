'use strict';

window.PPMSModuleRuntime = (() => {
    const MODULE_KEY = 'ppms_active_module';
    const SESSION_KEY = 'kd1_session';
    const VEHICLES = ['K9', 'K10', 'K11'];

    const MODULES = {
        kd1: {
            id: 'kd1',
            badge: 'F200 – KD1',
            title: 'PPMS',
            subtitle: 'Production Planning & Monitoring',
            tableTitle: 'F200 Assembly Plan Details',
            unitLabel: 'Unit',
            categories: ['Assembly', 'Final Test', 'Processing'],
        },
        kd2: {
            id: 'kd2',
            badge: 'F200 – KD2',
            title: 'PPMS',
            subtitle: 'Production Planning & Monitoring',
            tableTitle: 'F200 – KD2 Battalion Plan Details',
            unitLabel: 'Battalion / Unit',
            categories: [
                'Welding',
                'Machining',
                'Shot Blasting and Painting',
                'Assembly',
                'Processing',
                'Final Test',
            ],
        },
        f100kd2: {
            id: 'f100kd2',
            badge: 'F100 – KD2',
            title: 'PPMS',
            subtitle: 'Production Planning & Monitoring',
            tableTitle: 'F100 – KD2 Part Plan Details',
            unitLabel: 'Battalion / Part',
            categories: [],   // F100 uses part-level grouping, not station categories
        },
    };
    const KD2_CATEGORY_CODES = new Set(['welding', 'machining', 'shot_blasting_painting', 'assembly', 'processing', 'final_test']);
    const NON_WORK_MODULE_ID = 'kd2';
    const KD2_IMPORT_COLUMNS = [
        'battalion_code',
        'vehicle_type',
        'unit_serial',
        'unit_label',
        'category_code',
        'station_code',
        'planned_start_date',
        'duration_working_days',
        'remark',
    ];
    const KD2_IMPORT_REQUIRED_COLUMNS = KD2_IMPORT_COLUMNS.filter(column => column !== 'remark');
    const KD2_SATURDAY_WORKING = true;

    let dbRef = null;
    let helpers = { reloadAll: null };
    let wired = false;
    const state = {
        battalions: [],
        planningInputs: [],
        categories: [],
        stations: [],
        routes: [],
        leadTimes: [],
        vehicleUnits: [],
        nonWorkDays: [],
        nonWorkDaySet: new Set(),
        routeVehicle: 'K9',
        timelineRows: [],
        timelineViewMode: 'unit',
        timelineProcessVehicle: 'K9',
        timelineEditMode: false,
        timelineMoveMode: 'block',
        timelineSelectLaneMode: false,
        timelineSelectedIds: new Set(),
        timelineLastDragAt: 0,
        timelinePlacementActive: false,
        timelinePlacementMenuOpen: false,
        timelinePlacementVehicle: 'K9',
        timelinePlacementStationCode: '',
        timelinePlacementQuery: '',
        timelinePlacementBattalionId: null,
        timelinePlacementUnitSerial: null,
        timelinePlacementUnitLabel: '',
        templateRemovedStations: new Set(),
        templateLayouts: [],
        templateLayoutTableAvailable: true,
        templateNewRowCounter: 0,
        templateEditorView: 'visual',
        templateEditorVehicle: '',
        templateEditorBlocks: [],
        templateInsertIndex: null,
        processEditorVehicle: 'K9',
    };
    const placementPointer = { x: 0, y: 0, ready: false };
    let placementGhostEl = null;
    let planCreateOverlayHome = null;
    let planEditOverlayHome = null;
    let processOverlayHome = null;
    const PLACEMENT_GHOST_PALETTE = [
        '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
        '#06b6d4', '#f97316', '#84cc16', '#6366f1', '#e11d48',
        '#0ea5e9', '#a855f7', '#d97706', '#4ade80', '#38bdf8',
    ];

    // Per-user module key so each account keeps its own active module
    function _userModuleKey() {
        try {
            const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
            const uid = s?.id || s?.email;
            return uid ? MODULE_KEY + '_u_' + uid : MODULE_KEY;
        } catch { return MODULE_KEY; }
    }

    function getActiveModule() {
        const stored = localStorage.getItem(_userModuleKey());
        return MODULES[stored] ? stored : 'kd1';
    }

    function isKD2() {
        return getActiveModule() === 'kd2';
    }

    function isF100KD2() {
        return getActiveModule() === 'f100kd2';
    }

    function isF200Module() {
        const m = getActiveModule();
        return m === 'kd1' || m === 'kd2';
    }

    function setActiveModule(moduleId) {
        localStorage.setItem(_userModuleKey(), MODULES[moduleId] ? moduleId : 'kd1');
    }

    function getActiveConfig() {
        return MODULES[getActiveModule()];
    }

    function getCurrentUser() {
        try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
    }

    function canManageKD2() {
        const role = getCurrentUser()?.role;
        return ['master_admin', 'admin', 'planner'].includes(role);
    }

    function canUploadKD2Plan() {
        const role = getCurrentUser()?.role;
        return ['master_admin', 'planner'].includes(role);
    }

    function stationCodeMatchesVehicle(vehicleType, stationCode) {
        return String(stationCode || '').toLowerCase().startsWith(`${String(vehicleType || '').toLowerCase()}_`);
    }

    function normalizeWorkCenter(workCenter) {
        return String(workCenter || '')
            .toUpperCase()
            .split(/[,;]/)
            .map(token => {
                const match = token.trim().match(/^A(\d)$/);
                return match ? `A0${match[1]}` : token.trim();
            })
            .filter(token => token)
            .join(', ');
    }

    function workCenterTokens(workCenter) {
        // Normalize first (A1→A01, A9→A09) so single-digit codes match the /A\d{2}/ pattern.
        return String(normalizeWorkCenter(workCenter))
            .match(/A\d{2}/g) || [];
    }

    function stationAllowedForVehicle(row) {
        if (!row || !stationCodeMatchesVehicle(row.vehicle_type, row.station_code)) return false;
        if (row.category_code !== 'assembly') return true;
        const tokens = workCenterTokens(row.work_center);
        if (!tokens.length) return false;
        const allowed = row.vehicle_type === 'K9'
            ? new Set(['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10', 'A11'])
            : new Set(['A01', 'A02', 'A12', 'A13', 'A14', 'A15']);
        return tokens.some(token => allowed.has(token));
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function toast(message, type = 'info') {
        if (typeof window.showToast === 'function') window.showToast(message, type);
        else console[type === 'error' ? 'error' : 'log'](message);
    }

    function isMissingSchemaTableError(error, tableName) {
        const message = String(error?.message || error || '').toLowerCase();
        const publicName = `public.${String(tableName || '').toLowerCase()}`;
        const bareName = String(tableName || '').toLowerCase();
        return message.includes(`could not find the table '${publicName}' in the schema cache`) ||
            message.includes(`relation "${publicName}" does not exist`) ||
            message.includes(`relation "${bareName}" does not exist`);
    }

    function templateLayoutMigrationMessage() {
        return "Spaces in KD2 templates require the 'kd2_template_layout_items' table. Run 'PPMS/sql/migrations/kd2_template_layout_items.sql' in Supabase, then reload the page.";
    }

    function populateCategoryFilter(categories) {
        const sel = document.getElementById('filterCategory');
        if (!sel) return;
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">All Categories</option>';
        categories.forEach(category => {
            const opt = document.createElement('option');
            opt.value = category;
            opt.textContent = category;
            sel.appendChild(opt);
        });
        if ([...sel.options].some(opt => opt.value === currentVal)) sel.value = currentVal;
    }

    function setDisplay(id, visible) {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    }

    function applyModuleShell() {
        const config = getActiveConfig();
        const f100 = isF100KD2();
        const kd2 = isKD2();

        document.body.dataset.module = config.id;
        setText('moduleBadge', config.badge);
        setText('brandTitle', config.title);
        setText('brandSubtitle', config.subtitle);
        setText('tableTitle', config.tableTitle);
        setText('filterUnitLabel', config.unitLabel);
        populateCategoryFilter(config.categories);

        const selector = document.getElementById('moduleSelector');
        if (selector) selector.value = config.id;

        // F200-KD2-specific workspace sections — hidden for F100
        setDisplay('filterBattalionGroup', kd2);
        setDisplay('kd2PhaseSection', kd2);
        setDisplay('kd2WorkspaceSection', kd2);

        // Standard F200 filter items — hidden when F100 is active
        setDisplay('filterVehicleGroup', !f100);
        setDisplay('filterUnitGroup', !f100);
        setDisplay('filterCategoryGroup', !f100);
        setDisplay('filterWeekGroup', !f100);
        setDisplay('filterTimeFrameGroup', !f100);
        const _isCustomRange = !f100 && document.getElementById('filterTimeFrame')?.value === 'custom';
        setDisplay('customDateStart', _isCustomRange);
        setDisplay('customDateEnd', _isCustomRange);

        // F100 filter items — shown only when F100 is active
        setDisplay('f100BattalionGroup', f100);
        setDisplay('f100ModeGroup', f100);
        // Secondary F100 filters: default state matches the 'gun' default option
        if (f100) {
            const currentMode = document.getElementById('f100Mode')?.value || 'gun';
            setDisplay('f100GunPartGroup', currentMode === 'gun');
            setDisplay('f100ManufacturerGroup', currentMode === 'vehicle');
            setDisplay('f100VehicleTypeGroup', currentMode === 'vehicle');
        } else {
            setDisplay('f100GunPartGroup', false);
            setDisplay('f100ManufacturerGroup', false);
            setDisplay('f100VehicleTypeGroup', false);
        }

        // Import buttons
        setDisplay('btnImport', !kd2 && !f100);
        setDisplay('btnKd2DownloadTemplate', kd2 && canUploadKD2Plan());
        setDisplay('btnKd2UploadPlan', kd2 && canUploadKD2Plan());

        // Hide F200 import panels when not relevant
        if (kd2 || f100) {
            const legacyImportPanel = document.getElementById('importPanel');
            if (legacyImportPanel) legacyImportPanel.style.display = 'none';
        }
        if (!kd2) {
            const kd2ImportPanel = document.getElementById('kd2ImportPanel');
            if (kd2ImportPanel) kd2ImportPanel.style.display = 'none';
        }

        // Sections visible in all modules (F100 will populate them with its own data)
        setDisplay('ganttSection', true);
        setDisplay('vpxSection', true);
        setDisplay('chartsSection', !f100);   // Charts not yet implemented for F100
        setDisplay('btnGanttEdit', true);
        setDisplay('btnReports', true);

        // Dynamic text labels
        if (f100) {
            setText('ganttTitle', 'F100 – KD2 Production Gantt');
            setText('ganttSubtitle', 'Part Manufacturing Progress · Daily View');
            setText('btnGanttEditLabel', 'Edit Gantt');
            setText('vpxTitle', 'F100 – KD2 Part Progress Matrix');
            setText('vpxSubtitle', 'Part-by-process completion · hover for details');
        } else if (kd2) {
            setText('ganttTitle', 'F200 – KD2 Planning Gantt');
            setText('ganttSubtitle', 'Battalion Plan · Daily Gantt View');
            setText('btnGanttEditLabel', 'Edit Gantt');
            setText('vpxTitle', 'F200 – KD2 VPX Matrix');
            setText('vpxSubtitle', 'Battalion-by-station planned vs actual · hover for details');
        } else {
            setText('ganttTitle', 'F200 – KD1 Production Master Schedule');
            setText('ganttSubtitle', 'Assembly Plan · Daily Gantt View');
            setText('btnGanttEditLabel', 'Edit Plan');
            setText('vpxTitle', 'F200 – KD1 Vehicle Production Progress');
            setText('vpxSubtitle', 'Station-by-station planned vs actual · hover for details');
        }
    }

    function getCategory(processStation, row) {
        // If the row already carries a category, use it.
        if (row?.category) return row.category;
        // Only supply KD2-specific category mapping when the active module is KD2.
        // For other modules (KD1), return undefined so the host app can fall back
        // to its own category logic (getCategory in app.js).
        if (getActiveModule() !== 'kd2') return undefined;

        return {
            'Welding': 'Welding',
            'Machining': 'Machining',
            'Shot Blasting and Painting': 'Shot Blasting and Painting',
            'Assembly': 'Assembly',
            'Processing': 'Processing',
            'Final Test': 'Final Test',
        }[processStation] || 'Other';
    }

    async function queryAll(query) {
        const rows = [];
        let from = 0;
        const pageSize = 1000;
        while (true) {
            const { data, error } = await query.range(from, from + pageSize - 1);
            if (error) throw error;
            if (!data?.length) break;
            rows.push(...data);
            if (data.length < pageSize) break;
            from += pageSize;
        }
        return rows;
    }

    function parseDateLocal(dateStr) {
        return new Date(`${dateStr}T00:00:00`);
    }

    function localDateStr(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        return parseDateLocal(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function normalizeNoWorkLabel(label) {
        const trimmed = String(label ?? '').trim();
        return trimmed || null;
    }

    function isNoWorkRowActive(row) {
        return row?.is_active !== false;
    }

    function getNonWorkDateStatusMap(rows = state.nonWorkDays) {
        const statusByDate = new Map();
        rows
            .filter(row => row?.module_id === NON_WORK_MODULE_ID && row.off_date)
            .forEach(row => {
                statusByDate.set(row.off_date, 'active');
            });
        return statusByDate;
    }

    function buildDateRange(startDateStr, endDateStr) {
        if (!startDateStr || !endDateStr || endDateStr < startDateStr) return [];
        const dates = [];
        let cursor = startDateStr;
        let guard = 0;
        while (cursor <= endDateStr && guard < 1000) {
            dates.push(cursor);
            cursor = addDays(cursor, 1);
            guard += 1;
        }
        return dates;
    }

    function formatNoWorkRange(startDateStr, endDateStr) {
        if (!startDateStr) return '—';
        if (!endDateStr || startDateStr === endDateStr) return formatDate(startDateStr);
        return `${formatDate(startDateStr)} -> ${formatDate(endDateStr)}`;
    }

    function getNonWorkDayGroups(rows = state.nonWorkDays) {
        const sortedRows = rows
            .filter(row => row?.module_id === NON_WORK_MODULE_ID && row.off_date)
            .slice()
            .sort((a, b) => String(a.off_date).localeCompare(String(b.off_date)));
        const groups = [];
        sortedRows.forEach(row => {
            const label = normalizeNoWorkLabel(row.label);
            const isActive = row.is_active !== false;
            const current = groups[groups.length - 1];
            if (!current || current.label !== label || current.is_active !== isActive || addDays(current.end, 1) !== row.off_date) {
                groups.push({ start: row.off_date, end: row.off_date, label, is_active: isActive, rows: [row] });
                return;
            }
            current.end = row.off_date;
            current.rows.push(row);
        });
        return groups;
    }

    function getNonWorkDayGroupByStart(startDateStr) {
        return getNonWorkDayGroups().find(group => group.start === startDateStr) || null;
    }

    function parseNoWorkEditingIds() {
        return String(document.getElementById('kd2NoWorkIds')?.value || '')
            .split(',')
            .map(value => parseInt(value.trim(), 10))
            .filter(Number.isFinite);
    }

    function noWorkDateSetsEqual(left, right) {
        if (left.size !== right.size) return false;
        for (const value of left) {
            if (!right.has(value)) return false;
        }
        return true;
    }

    function makeNoWorkAuditRecordId(dates = []) {
        const filtered = dates.filter(Boolean).sort();
        if (!filtered.length) return 'kd2:no-work';
        return filtered.length === 1
            ? `kd2:no-work:${filtered[0]}`
            : `kd2:no-work:${filtered[0]}..${filtered[filtered.length - 1]}`;
    }

    function weekLabel(dateStr) {
        if (typeof window.weekLabel === 'function') return window.weekLabel(dateStr);
        const date = parseDateLocal(dateStr);
        const target = new Date(date.valueOf());
        const dayNr = (date.getDay() + 6) % 7;
        target.setDate(target.getDate() - dayNr + 3);
        const firstThursday = new Date(target.getFullYear(), 0, 4);
        const diff = target - firstThursday;
        const week = 1 + Math.round(diff / 604800000);
        return `FW${String(week).padStart(2, '0')}`;
    }

    function syncNonWorkDays(rows = []) {
        state.nonWorkDays = rows
            .filter(row => row?.module_id === NON_WORK_MODULE_ID && row.off_date)
            .map(row => ({ ...row, label: normalizeNoWorkLabel(row.label) }))
            .sort((a, b) => String(a.off_date).localeCompare(String(b.off_date)));
        state.nonWorkDaySet = new Set(
            state.nonWorkDays.filter(row => row.is_active === true).map(row => row.off_date)
        );
    }

    function withWorkingRules(rules = {}) {
        return {
            skipFriday: rules.skipFriday !== false,
            includeSaturday: KD2_SATURDAY_WORKING,
            offDates: rules.offDates instanceof Set ? rules.offDates : state.nonWorkDaySet,
        };
    }

    function isNonWorkDate(dateStr, rules = {}) {
        return withWorkingRules(rules).offDates.has(dateStr);
    }

    function isWorkingDay(date, rules) {
        const safeRules = withWorkingRules(rules);
        const day = date.getDay();
        if (safeRules.skipFriday && day === 5) return false;
        if (!safeRules.includeSaturday && day === 6) return false;
        if (safeRules.offDates.has(localDateStr(date))) return false;
        return true;
    }

    function normalizeWorkingDate(dateStr, rules) {
        const date = parseDateLocal(dateStr);
        while (!isWorkingDay(date, rules)) date.setDate(date.getDate() - 1);
        return date;
    }

    function previousWorkingDate(dateStr, rules) {
        const date = parseDateLocal(dateStr);
        date.setDate(date.getDate() - 1);
        while (!isWorkingDay(date, rules)) date.setDate(date.getDate() - 1);
        return localDateStr(date);
    }

    function normalizeWorkingDateForward(dateStr, rules) {
        const date = parseDateLocal(dateStr);
        while (!isWorkingDay(date, rules)) date.setDate(date.getDate() + 1);
        return date;
    }

    function nextWorkingDate(dateStr, rules) {
        const date = parseDateLocal(dateStr);
        date.setDate(date.getDate() + 1);
        while (!isWorkingDay(date, rules)) date.setDate(date.getDate() + 1);
        return localDateStr(date);
    }

    function shiftWorkingDateForward(dateStr, workingDays, rules) {
        let current = localDateStr(normalizeWorkingDateForward(dateStr, rules));
        let remaining = Math.max(parseInt(workingDays, 10) || 0, 0);
        while (remaining > 0) {
            current = nextWorkingDate(current, rules);
            remaining -= 1;
        }
        return current;
    }

    function shiftWorkingDateBackward(dateStr, workingDays, rules) {
        let current = localDateStr(normalizeWorkingDate(dateStr, rules));
        let remaining = Math.max(parseInt(workingDays, 10) || 0, 0);
        while (remaining > 0) {
            current = previousWorkingDate(current, rules);
            remaining -= 1;
        }
        return current;
    }

    function shiftWorkingDateByOffset(dateStr, offsetDays, rules) {
        let offset = parseInt(offsetDays, 10) || 0;
        if (offset === 0) return localDateStr(normalizeWorkingDateForward(dateStr, rules));
        if (offset > 0) return shiftWorkingDateForward(dateStr, offset, rules);
        let current = localDateStr(normalizeWorkingDate(dateStr, rules));
        while (offset < 0) {
            current = previousWorkingDate(current, rules);
            offset += 1;
        }
        return current;
    }

    function buildBackwardWindow(endDateStr, durationDays, rules) {
        const end = normalizeWorkingDate(endDateStr, rules);
        const start = new Date(end);
        let remaining = durationDays;
        while (remaining > 1) {
            start.setDate(start.getDate() - 1);
            while (!isWorkingDay(start, rules)) start.setDate(start.getDate() - 1);
            remaining -= 1;
        }
        return { start: localDateStr(start), end: localDateStr(end) };
    }

    function countWorkingDaysInclusive(startDateStr, endDateStr, rules) {
        if (!startDateStr || !endDateStr || startDateStr > endDateStr) return 0;
        let current = startDateStr;
        let count = 0;
        let guard = 0;
        while (current <= endDateStr && guard < 1000) {
            if (isWorkingDay(parseDateLocal(current), rules)) count += 1;
            current = addDays(current, 1);
            guard += 1;
        }
        return count;
    }

    function durationFromPlannedWindow(startDateStr, endDateStr, rules) {
        if (!startDateStr || !endDateStr || startDateStr > endDateStr) return 0;
        const workingDuration = Math.max(countWorkingDaysInclusive(startDateStr, endDateStr, rules), 1);
        const normalizedWindow = buildForwardWindow(startDateStr, workingDuration, rules);
        if (normalizedWindow.start === startDateStr && normalizedWindow.end === endDateStr) {
            return workingDuration;
        }
        return Math.max(dayDiff(startDateStr, endDateStr) + 1, 1);
    }

    function workingDayOffsetBetween(anchorDateStr, targetDateStr, rules) {
        if (!anchorDateStr || !targetDateStr) return 0;
        if (anchorDateStr === targetDateStr) return 0;
        if (targetDateStr > anchorDateStr) {
            let current = localDateStr(normalizeWorkingDateForward(anchorDateStr, rules));
            let offset = 0;
            let guard = 0;
            while (current < targetDateStr && guard < 1000) {
                current = nextWorkingDate(current, rules);
                offset += 1;
                guard += 1;
            }
            return current === targetDateStr ? offset : Math.max(dayDiff(anchorDateStr, targetDateStr), 0);
        }
        let current = localDateStr(normalizeWorkingDate(anchorDateStr, rules));
        let offset = 0;
        let guard = 0;
        while (current > targetDateStr && guard < 1000) {
            current = previousWorkingDate(current, rules);
            offset -= 1;
            guard += 1;
        }
        return current === targetDateStr ? offset : Math.min(dayDiff(anchorDateStr, targetDateStr), 0);
    }

    function shiftPlanWindowByCalendarDays(startDateStr, endDateStr, deltaDays, rules) {
        const duration = Math.max(durationFromPlannedWindow(startDateStr, endDateStr, rules), 1);
        const shiftedStart = addDays(startDateStr, deltaDays);
        return buildForwardWindow(shiftedStart, duration, rules);
    }

    function buildForwardWindow(startDateStr, durationDays, rules) {
        const start = normalizeWorkingDateForward(startDateStr, rules);
        const end = new Date(start);
        let remaining = durationDays;
        while (remaining > 1) {
            end.setDate(end.getDate() + 1);
            while (!isWorkingDay(end, rules)) end.setDate(end.getDate() + 1);
            remaining -= 1;
        }
        return { start: localDateStr(start), end: localDateStr(end) };
    }

    function minDateStr(values) {
        return values.reduce((min, value) => !min || value < min ? value : min, '');
    }

    function maxDateStr(values) {
        return values.reduce((max, value) => !max || value > max ? value : max, '');
    }

    function chunk(items, size) {
        const result = [];
        for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
        return result;
    }

    function addDays(dateStr, days) {
        const date = parseDateLocal(dateStr);
        date.setDate(date.getDate() + days);
        return localDateStr(date);
    }

    function dayDiff(startDateStr, endDateStr) {
        const start = parseDateLocal(startDateStr);
        const end = parseDateLocal(endDateStr);
        return Math.round((end - start) / 86400000);
    }

    function vehicleSortValue(vehicle) {
        const idx = VEHICLES.indexOf(vehicle);
        return idx === -1 ? 999 : idx;
    }

    async function writeAudit(action, tableName, recordId, before, after) {
        try {
            if (window.__ppmsShared?.auditLog) {
                await window.__ppmsShared.auditLog(action, tableName, recordId, before, after);
                return;
            }
            const user = getCurrentUser();
            if (!user || !dbRef) return;
            await dbRef.from('planning_audit_log').insert({
                user_id: user.id,
                user_email: user.email,
                user_role: user.role,
                action,
                table_name: tableName,
                record_id: String(recordId ?? ''),
                data_before: before ? JSON.parse(JSON.stringify(before)) : null,
                data_after: after ? JSON.parse(JSON.stringify(after)) : null,
                ip_address: window.__ppmsShared?.getCachedIP?.() || user.ip || 'unknown',
            });
        } catch (error) {
            console.warn('KD2 audit write skipped:', error.message);
        }
    }

    function getBattalionFilterValue() {
        return document.getElementById('filterBattalion')?.value?.trim() || '';
    }

    function updateGenerationTarget() {
        const battalion = getBattalionFilterValue();
        setText('kd2GenerationTarget', battalion ? `Generate plan for ${battalion}` : 'Select a battalion filter to generate a plan.');
    }

    async function loadFilters(db) {
        const [rows, categoryRows, battalions] = await Promise.all([
            queryAll(db.from('kd2_plan_live').select('vehicle, vehicle_no, week, category')),
            queryAll(db.from('kd2_process_categories').select('category_code, category_name, category_sequence').eq('is_active', true).order('category_sequence')),
            queryAll(db.from('kd2_battalions').select('battalion_code').order('battalion_code')),
        ]);
        const activeCategoryNames = new Set(categoryRows
            .filter(row => KD2_CATEGORY_CODES.has(row.category_code))
            .map(row => row.category_name)
            .filter(Boolean));
        const categories = MODULES.kd2.categories.filter(category => activeCategoryNames.has(category));
        return {
            battalions: battalions.map(row => row.battalion_code).filter(Boolean),
            vehicles: [...new Set(rows.map(row => row.vehicle).filter(Boolean))].sort(),
            units: [...new Set(rows.map(row => row.vehicle_no).filter(Boolean))].sort(),
            weeks: [...new Set(rows.map(row => row.week).filter(Boolean))].sort((a, b) => {
                const aNum = parseInt(String(a).replace(/\D/g, ''), 10) || 0;
                const bNum = parseInt(String(b).replace(/\D/g, ''), 10) || 0;
                return aNum - bNum;
            }),
            categories: categories.length ? categories : MODULES.kd2.categories,
        };
    }

    function applyTimeFrame(query, filters) {
        if (filters.timeFrame === 'day') return query.eq('start_date', filters.today);
        if (filters.timeFrame === 'week') return query.gte('start_date', filters.weekStart).lte('start_date', filters.weekEnd);
        if (filters.timeFrame === 'month') return query.gte('start_date', filters.monthStart).lte('start_date', filters.monthEnd);
        if (filters.timeFrame === 'custom') {
            if (filters.startDate) query = query.gte('start_date', filters.startDate);
            if (filters.endDate) query = query.lte('end_date', filters.endDate);
        }
        return query;
    }

    async function loadData(db, filters) {
        if (!state.stations.length) await loadWorkspaceData();
        let query = db.from('kd2_plan_live').select('*');
        if (filters.battalion) query = query.eq('battalion_code', filters.battalion);
        if (filters.vehicle) query = query.eq('vehicle', filters.vehicle);
        if (filters.unit) query = query.eq('vehicle_no', filters.unit);
        if (filters.week) query = query.lte('start_date', filters.weekEndForFilter).gte('end_date', filters.weekStartForFilter);
        query = applyTimeFrame(query, filters);
        let rows = await queryAll(query);
        
        // Apply K9 component filter using component_group from station definitions
        if (filters.k9Component) {
            const compMap = new Map(
                state.stations
                    .filter(s => s.vehicle_type === (filters.vehicle || 'K9'))
                    .map(s => [s.station_code, s.component_group || ''])
            );
            const wanted = filters.k9Component; // 'Hull' or 'Turret'
            rows = rows.filter(row => {
                const grp = compMap.get(row.station_code) || '';
                return grp === wanted || grp.startsWith(wanted + ' ');
            });
        }
        
        const detailMap = new Map();
        if (rows.length) {
            const ids = rows.map(row => row.id).filter(Boolean);
            for (const batch of chunk(ids, 500)) {
                const detailRows = await queryAll(
                    db.from('kd2_plan')
                        .select('id, battalion_id, vehicle_type, unit_serial, unit_label, category_code, station_code, planned_start_date, planned_end_date, planning_source, comments')
                        .in('id', batch)
                );
                detailRows.forEach(row => detailMap.set(row.id, row));
            }
        }
        return rows.map(row => ({
            ...row,
            battalion_id: detailMap.get(row.id)?.battalion_id ?? null,
            unit_serial: detailMap.get(row.id)?.unit_serial ?? null,
            vehicle_type: detailMap.get(row.id)?.vehicle_type ?? row.vehicle,
            unit_label: detailMap.get(row.id)?.unit_label ?? row.vehicle_no,
            planning_source: detailMap.get(row.id)?.planning_source ?? null,
            comments: Array.isArray(detailMap.get(row.id)?.comments) ? detailMap.get(row.id).comments : [],
            progress: {
                id: row.progress_id || null,
                completed: !!row.completed,
                completion_date: row.completion_date || null,
                actual_start_date: row.actual_start_date || null,
                notes: row.notes || null,
                updated_at: row.progress_updated_at || null,
            },
        }));
    }

    async function loadPlanningSnapshot(db) {
        if (!isKD2()) return;
        const statusEl = document.getElementById('kd2PhaseStatus');
        const battalionCountEl = document.getElementById('kd2BattalionCount');
        const battalionNoteEl = document.getElementById('kd2BattalionNote');
        const routeCountEl = document.getElementById('kd2RouteCount');
        const routeNoteEl = document.getElementById('kd2RouteNote');
        const leadStatusEl = document.getElementById('kd2LeadTimeStatus');
        const leadNoteEl = document.getElementById('kd2LeadTimeNote');
        try {
            const [battalions, categories, stations, leadTimes] = await Promise.all([
                queryAll(db.from('kd2_battalions').select('battalion_code, delivery_deadline')),
                queryAll(db.from('kd2_process_categories').select('category_code, category_name, category_sequence').eq('is_active', true).order('category_sequence')),
                queryAll(db.from('kd2_process_stations').select('vehicle_type, station_code, station_name').eq('is_active', true)),
                queryAll(db.from('kd2_process_lead_times').select('lead_time_days')),
            ]);
            const distinctCategories = [...new Set(categories.map(row => row.category_name))];
            const validStations = stations.filter(row => stationAllowedForVehicle(row));
            const confirmedLeadTimes = leadTimes.filter(row => row.lead_time_days !== null).length;
            const deadlinesSet = battalions.filter(row => row.delivery_deadline).length;
            if (statusEl) statusEl.textContent = battalions.length || categories.length ? 'KD2 schema detected' : 'Waiting for KD2 tables';
            if (battalionCountEl) battalionCountEl.textContent = `${battalions.length} configured`;
            if (battalionNoteEl) battalionNoteEl.textContent = deadlinesSet ? `${deadlinesSet} battalion deadlines are already loaded.` : 'No battalion deadlines loaded yet.';
            if (routeCountEl) routeCountEl.textContent = `${distinctCategories.length} categories / ${validStations.length} stations`;
            if (routeNoteEl) routeNoteEl.textContent = distinctCategories.length ? distinctCategories.join(' -> ') : 'Route masters are still empty.';
            if (leadStatusEl) leadStatusEl.textContent = `${confirmedLeadTimes}/${leadTimes.length || 0} confirmed`;
            if (leadNoteEl) leadNoteEl.textContent = confirmedLeadTimes === leadTimes.length && leadTimes.length > 0 ? 'Every seeded route step has a lead time.' : 'Unknown lead times remain intentionally blank until confirmed.';
        } catch (error) {
            if (statusEl) statusEl.textContent = 'Upload KD2 schema first';
            if (battalionCountEl) battalionCountEl.textContent = '0 configured';
            if (battalionNoteEl) battalionNoteEl.textContent = 'Run the SQL schema in Supabase, then refresh this page.';
            if (routeCountEl) routeCountEl.textContent = '0 steps';
            if (routeNoteEl) routeNoteEl.textContent = 'The KD2 route master is not available yet.';
            if (leadStatusEl) leadStatusEl.textContent = '0 confirmed';
            if (leadNoteEl) leadNoteEl.textContent = 'Lead times will remain blank until business confirmation.';
            console.warn('KD2 snapshot load skipped:', error.message);
        }
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function loadWorkspaceData() {
        if (!dbRef || !isKD2()) return;
        const [battalions, planningInputs, categories, stations, routes, leadTimes, vehicleUnits] = await Promise.all([
            queryAll(dbRef.from('kd2_battalions').select('*').order('battalion_code')),
            queryAll(dbRef.from('kd2_planning_inputs').select('*').order('battalion_id')),
            queryAll(dbRef.from('kd2_process_categories').select('*').eq('is_active', true).order('vehicle_type').order('category_sequence')),
            queryAll(dbRef.from('kd2_process_stations').select('*').eq('is_active', true).order('vehicle_type').order('route_sequence')),
            queryAll(dbRef.from('kd2_process_routes').select('*').eq('is_active', true).order('vehicle_type').order('route_sequence')),
            queryAll(dbRef.from('kd2_process_lead_times').select('*').order('vehicle_type').order('planning_level')),
            queryAll(dbRef.from('kd2_vehicle_units').select('*').order('battalion_id').order('vehicle_type').order('unit_serial')),
        ]);
        let templateLayouts = [];
        let nonWorkDays = [];
        state.templateLayoutTableAvailable = true;
        try {
            templateLayouts = await queryAll(
                dbRef.from('kd2_template_layout_items')
                    .select('*')
                    .order('vehicle_type')
                    .order('sort_order')
            );
        } catch (error) {
            if (isMissingSchemaTableError(error, 'kd2_template_layout_items')) {
                state.templateLayoutTableAvailable = false;
            }
            console.warn('KD2 template layout load skipped:', error.message);
        }
        try {
            nonWorkDays = await queryAll(
                dbRef.from('planning_non_work_days')
                    .select('*')
                    .eq('module_id', NON_WORK_MODULE_ID)
                    .order('off_date')
            );
        } catch (error) {
            console.warn('KD2 non-work days load skipped:', error.message);
        }
        state.battalions = battalions;
        state.planningInputs = planningInputs;
        state.categories = categories.filter(row => KD2_CATEGORY_CODES.has(row.category_code));
        state.stations = stations.filter(row =>
            KD2_CATEGORY_CODES.has(row.category_code) &&
            stationAllowedForVehicle(row)
        );
        const validStationKeys = new Set(state.stations.map(row => `${row.vehicle_type}||${row.station_code}`));
        state.routes = routes.filter(row =>
            KD2_CATEGORY_CODES.has(row.category_code) &&
            validStationKeys.has(`${row.vehicle_type}||${row.station_code}`)
        );
        state.leadTimes = leadTimes;
        state.vehicleUnits = vehicleUnits;
        state.templateLayouts = templateLayouts;
        syncNonWorkDays(nonWorkDays);
    }

    function inputFor(battalionId, vehicleType) {
        return state.planningInputs.find(row => row.battalion_id === battalionId && row.vehicle_type === vehicleType) || null;
    }

    function renderPlanningInputs() {
        const tbody = document.getElementById('kd2InputsBody');
        if (!tbody) return;
        if (!state.battalions.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Create a battalion to start KD2 planning inputs.</td></tr>';
            return;
        }

        const rows = [];
        state.battalions.forEach(battalion => {
            VEHICLES.forEach(vehicle => {
                const input = inputFor(battalion.id, vehicle);
                const qty = input?.required_quantity ?? '';
                const deadline = input?.delivery_deadline || battalion.delivery_deadline || '';
                const status = input?.assumptions_status || 'pending';
                rows.push(`
                    <tr>
                        <td><strong>${escapeHtml(battalion.battalion_code)}</strong>${battalion.battalion_name ? `<span class="kd2-inline-meta">${escapeHtml(battalion.battalion_name)}</span>` : ''}</td>
                        <td>${vehicle}</td>
                        <td class="mono">${qty === '' ? '—' : qty}</td>
                        <td class="mono">${deadline ? formatDate(deadline) : '—'}</td>
                        <td>${input ? (input.skip_friday ? 'Skip' : 'Work') : 'Skip'}</td>
                        <td>Work</td>
                        <td><span class="badge badge-${status === 'confirmed' ? 'completed' : 'planned'}">${status === 'confirmed' ? 'Confirmed' : 'Pending'}</span></td>
                        <td><button class="kd2-action-link" data-kd2-edit-battalion="${battalion.id}">Edit</button></td>
                    </tr>
                `);
            });
        });

        tbody.innerHTML = rows.join('');
        tbody.querySelectorAll('[data-kd2-edit-battalion]').forEach(btn => {
            btn.addEventListener('click', () => openPlanningModal(parseInt(btn.dataset.kd2EditBattalion, 10)));
        });
    }

    function leadTimeText(vehicleType, categoryCode, stationCode) {
        const stationLead = state.leadTimes.find(row =>
            row.vehicle_type === vehicleType &&
            row.planning_level === 'station' &&
            row.station_code === stationCode &&
            row.lead_time_days !== null
        );
        if (stationLead) return `${Math.ceil(Number(stationLead.lead_time_days))}d`;

        const categoryLead = state.leadTimes.find(row =>
            row.vehicle_type === vehicleType &&
            row.planning_level === 'category' &&
            row.category_code === categoryCode &&
            row.lead_time_days !== null
        );
        return categoryLead ? `${Math.ceil(Number(categoryLead.lead_time_days))}d category` : 'Pending';
    }

    function leadTimeRecord(vehicleType, planningLevel, categoryCode, stationCode = null) {
        return state.leadTimes.find(row =>
            row.vehicle_type === vehicleType &&
            row.planning_level === planningLevel &&
            row.category_code === categoryCode &&
            (planningLevel === 'category' ? !row.station_code : row.station_code === stationCode)
        ) || null;
    }

    function setLeadTimeError(message) {
        const el = document.getElementById('kd2LeadTimeError');
        if (!el) return;
        el.textContent = message;
        el.style.display = message ? 'flex' : 'none';
    }

    function closeLeadTimeModal() {
        const overlay = document.getElementById('kd2LeadTimeOverlay');
        if (overlay) overlay.style.display = 'none';
        setLeadTimeError('');
    }

    function setProcessError(message) {
        const el = document.getElementById('kd2ProcessError');
        if (!el) return;
        el.textContent = message;
        el.style.display = message ? 'flex' : 'none';
    }

    function closeProcessModal() {
        const overlay = document.getElementById('kd2ProcessOverlay');
        if (overlay) {
            overlay.style.display = 'none';
            overlay.classList.remove('modal-overlay-wide');
        }
        restoreProcessOverlayHost();
        setProcessError('');
    }

    function processEditorVehicle() {
        return document.getElementById('kd2ProcessVehicle')?.value || state.processEditorVehicle || state.routeVehicle || 'K9';
    }

    function processCategoriesForVehicle(vehicle) {
        return state.categories
            .filter(row => row.vehicle_type === vehicle)
            .sort((a, b) => a.category_sequence - b.category_sequence);
    }

    function processStationsForVehicle(vehicle) {
        const categoryOrder = new Map(processCategoriesForVehicle(vehicle).map((row, index) => [row.category_code, index]));
        return state.stations
            .filter(row => row.vehicle_type === vehicle)
            .sort((a, b) => {
                const categoryDiff = (categoryOrder.get(a.category_code) ?? 999) - (categoryOrder.get(b.category_code) ?? 999);
                if (categoryDiff !== 0) return categoryDiff;
                const stationDiff = (parseInt(a.station_sequence_in_category, 10) || 0) - (parseInt(b.station_sequence_in_category, 10) || 0);
                if (stationDiff !== 0) return stationDiff;
                return String(a.station_name || '').localeCompare(String(b.station_name || ''));
            });
    }

    function nextProcessCategorySequence(vehicle, categoryCode, excludeStationCode = '') {
        return Math.max(0, ...state.stations
            .filter(row =>
                row.vehicle_type === vehicle &&
                row.category_code === categoryCode &&
                row.station_code !== excludeStationCode
            )
            .map(row => parseInt(row.station_sequence_in_category, 10) || 0)) + 1;
    }

    function nextProcessRouteSequence(vehicle, excludeStationCode = '') {
        return Math.max(0, ...state.stations
            .filter(row => row.vehicle_type === vehicle && row.station_code !== excludeStationCode)
            .map(row => parseInt(row.route_sequence, 10) || 0)) + 1;
    }

    function setProcessFormStatus(message) {
        const el = document.getElementById('kd2ProcessFormStatus');
        if (!el) return;
        el.textContent = message;
    }

    function syncProcessCategoryOptions(selected = '') {
        const select = document.getElementById('kd2ProcessCategory');
        if (!select) return;
        const vehicle = processEditorVehicle();
        const categories = processCategoriesForVehicle(vehicle);
        if (!categories.length) {
            select.innerHTML = '<option value="">No KD2 categories available</option>';
            return;
        }
        const resolved = categories.some(row => row.category_code === selected) ? selected : categories[0].category_code;
        select.innerHTML = categories.map(row => `
            <option value="${escapeHtml(row.category_code)}" ${row.category_code === resolved ? 'selected' : ''}>
                ${escapeHtml(row.category_name)}
            </option>
        `).join('');
    }

    function resetProcessForm({ vehicle = processEditorVehicle(), categoryCode = '' } = {}) {
        state.processEditorVehicle = vehicle;
        const vehicleSelect = document.getElementById('kd2ProcessVehicle');
        if (vehicleSelect) vehicleSelect.value = vehicle;

        const categories = processCategoriesForVehicle(vehicle);
        const resolvedCategory = categories.some(row => row.category_code === categoryCode)
            ? categoryCode
            : (categories[0]?.category_code || '');

        syncProcessCategoryOptions(resolvedCategory);
        document.getElementById('kd2ProcessStationCodeOriginal').value = '';
        document.getElementById('kd2ProcessName').value = '';
        document.getElementById('kd2ProcessWorkCenter').value = '';
        document.getElementById('kd2ProcessSequence').value = resolvedCategory ? nextProcessCategorySequence(vehicle, resolvedCategory) : '';
        document.getElementById('kd2ProcessRouteSequence').value = nextProcessRouteSequence(vehicle);
        document.getElementById('kd2ProcessLeadTime').value = '';
        document.getElementById('kd2ProcessLeadSource').value = '';
        document.getElementById('kd2ProcessStationNotes').value = '';
        document.getElementById('kd2ProcessLeadNotes').value = '';
        setProcessFormStatus('Creating a new process station.');
        setProcessError('');
    }

    function loadProcessIntoForm(vehicle, stationCode) {
        const station = state.stations.find(row => row.vehicle_type === vehicle && row.station_code === stationCode);
        if (!station) {
            setProcessError('The selected process station is no longer available.');
            return;
        }
        const lead = leadTimeRecord(vehicle, 'station', station.category_code, station.station_code);
        state.processEditorVehicle = vehicle;
        document.getElementById('kd2ProcessVehicle').value = vehicle;
        syncProcessCategoryOptions(station.category_code);
        document.getElementById('kd2ProcessStationCodeOriginal').value = station.station_code;
        document.getElementById('kd2ProcessCategory').value = station.category_code;
        document.getElementById('kd2ProcessName').value = station.station_name || '';
        document.getElementById('kd2ProcessWorkCenter').value = station.work_center || '';
        document.getElementById('kd2ProcessSequence').value = station.station_sequence_in_category || '';
        document.getElementById('kd2ProcessRouteSequence').value = station.route_sequence || '';
        document.getElementById('kd2ProcessLeadTime').value = lead?.lead_time_days ?? '';
        document.getElementById('kd2ProcessLeadSource').value = lead?.lead_time_source || '';
        document.getElementById('kd2ProcessStationNotes').value = station.notes || '';
        document.getElementById('kd2ProcessLeadNotes').value = lead?.notes || '';
        setProcessFormStatus(`Editing ${station.station_name} (${station.station_code}).`);
        setProcessError('');
    }

    function renderProcessEditor() {
        const container = document.getElementById('kd2ProcessBody');
        const summary = document.getElementById('kd2ProcessSummary');
        const vehicleSelect = document.getElementById('kd2ProcessVehicle');
        if (!container || !summary || !vehicleSelect) return;

        const vehicle = processEditorVehicle();
        state.processEditorVehicle = vehicle;
        vehicleSelect.value = vehicle;
        const categories = processCategoriesForVehicle(vehicle);
        const stations = processStationsForVehicle(vehicle);

        if (!categories.length) {
            syncProcessCategoryOptions('');
            summary.textContent = `${vehicle} route master is not loaded yet.`;
            container.innerHTML = '<div class="empty-state"><p>No KD2 process categories were found for this vehicle.</p></div>';
            setProcessFormStatus('Create KD2 categories before adding process stations.');
            return;
        }

        const currentCategory = document.getElementById('kd2ProcessCategory')?.value || '';
        syncProcessCategoryOptions(currentCategory);

        summary.textContent = `${vehicle}: ${stations.length} active process station${stations.length === 1 ? '' : 's'} across ${categories.length} categories. Edit one row or add a new station below.`;
        container.innerHTML = categories.map(category => {
            const categoryStations = stations.filter(station => station.category_code === category.category_code);
            return `
                <section class="kd2-process-category" data-category-code="${escapeHtml(category.category_code)}">
                    <div class="kd2-process-category-head">
                        <div>
                            <strong>${escapeHtml(category.category_name)}</strong>
                            <span class="kd2-leadtime-code">${escapeHtml(category.category_code)} · Category ${category.category_sequence}</span>
                        </div>
                        <span class="kd2-route-badge">${categoryStations.length} station${categoryStations.length === 1 ? '' : 's'}</span>
                    </div>
                    ${categoryStations.length ? `
                        <div class="kd2-process-table-wrap">
                            <table class="table kd2-process-table">
                                <thead>
                                    <tr>
                                        <th>Station</th>
                                        <th>Work Center</th>
                                        <th>Order</th>
                                        <th>Route</th>
                                        <th>Lead Time</th>
                                        <th>Notes</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${categoryStations.map(station => {
                                        const lead = leadTimeRecord(vehicle, 'station', station.category_code, station.station_code);
                                        return `
                                            <tr>
                                                <td>
                                                    <strong>${escapeHtml(station.station_name)}</strong>
                                                    <span class="kd2-process-code">${escapeHtml(station.station_code)}</span>
                                                </td>
                                                <td>${escapeHtml(station.work_center || '—')}</td>
                                                <td>${station.station_sequence_in_category}</td>
                                                <td>${station.route_sequence}</td>
                                                <td>${escapeHtml(leadTimeText(vehicle, station.category_code, station.station_code))}</td>
                                                <td>${escapeHtml(station.notes || lead?.notes || '—')}</td>
                                                <td>
                                                    <div class="kd2-process-actions">
                                                        <button class="kd2-action-link" type="button" data-kd2-process-edit="${escapeHtml(station.station_code)}">Edit</button>
                                                        <button class="kd2-action-link btn-kd2-danger" type="button" data-kd2-process-delete="${escapeHtml(station.station_code)}">Retire</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    ` : `
                        <div class="empty-state" style="padding:18px 16px"><p>No active process stations in this category yet.</p></div>
                    `}
                </section>
            `;
        }).join('');
    }

    async function openProcessModal(preferredVehicle = state.routeVehicle || 'K9') {
        if (!canManageKD2()) {
            toast('Only planners and admins can edit KD2 processes.', 'error');
            return;
        }
        try {
            if (!state.categories.length || !state.stations.length) await loadWorkspaceData();
        } catch (error) {
            toast(`KD2 route setup load failed: ${error.message}`, 'error');
            return;
        }

        const vehicle = VEHICLES.includes(preferredVehicle) ? preferredVehicle : (state.routeVehicle || 'K9');
        state.processEditorVehicle = vehicle;
        resetProcessForm({ vehicle });
        renderProcessEditor();
        setProcessError('');
        const overlay = document.getElementById('kd2ProcessOverlay');
        // Use the wide overlay layout so the modal aligns to top and can
        // provide more vertical space for the process editor.
        if (overlay) overlay.classList.add('modal-overlay-wide');
        moveProcessOverlayToActiveHost();
        if (overlay) overlay.style.display = 'flex';
        // Setup category filter behaviour after rendering
        setupProcessFilter();
    }

    function setupProcessFilter() {
        const filter = document.getElementById('kd2ProcessCategoryFilter');
        const clearBtn = document.getElementById('btnKd2ProcessFilterClear');
        const shell = document.getElementById('kd2ProcessBody');
        if (!filter || !shell) return;
        const vehicle = processEditorVehicle();
        const categories = processCategoriesForVehicle(vehicle);
        filter.innerHTML = '<option value="">All Categories</option>' + categories.map(cat => ` <option value="${escapeHtml(cat.category_code)}">${escapeHtml(cat.category_name)}</option>`).join('');
        // keep current selection if set in the form
        filter.value = document.getElementById('kd2ProcessCategory')?.value || '';
        function applyFilter() {
            const sel = filter.value;
            document.querySelectorAll('.kd2-process-category').forEach(sec => {
                const code = sec.getAttribute('data-category-code') || '';
                if (!sel) {
                    sec.classList.remove('is-hidden','is-focused');
                } else if (code === sel) {
                    sec.classList.remove('is-hidden');
                    sec.classList.add('is-focused');
                    // scroll so header aligns under filter bar
                    const head = sec.querySelector('.kd2-process-category-head');
                    const shellRect = shell.getBoundingClientRect();
                    const headRect = head ? head.getBoundingClientRect() : sec.getBoundingClientRect();
                    const filterRect = document.getElementById('kd2ProcessCategoryFilter').getBoundingClientRect();
                    const offset = headRect.top - shellRect.top - filterRect.height - 8; // small gap
                    shell.scrollBy({ top: offset, behavior: 'smooth' });
                } else {
                    sec.classList.add('is-hidden');
                    sec.classList.remove('is-focused');
                }
            });
        }
        filter.addEventListener('change', applyFilter);
        if (clearBtn) clearBtn.addEventListener('click', () => { filter.value = ''; applyFilter(); });
    }

    function renderLeadTimeEditor() {
        const container = document.getElementById('kd2LeadTimeBody');
        const summary = document.getElementById('kd2LeadTimeSummary');
        if (!container || !summary) return;

        const vehicle = state.routeVehicle;
        const categories = state.categories
            .filter(row => row.vehicle_type === vehicle)
            .sort((a, b) => a.category_sequence - b.category_sequence);
        const stations = state.stations
            .filter(row => row.vehicle_type === vehicle)
            .sort((a, b) => a.route_sequence - b.route_sequence);

        if (!categories.length) {
            summary.textContent = `${vehicle} route master is not loaded yet.`;
            container.innerHTML = '<div class="empty-state"><p>No KD2 route categories were found for this vehicle.</p></div>';
            return;
        }

        const totalRows = categories.length + stations.length;
        const confirmedRows = categories.filter(category => {
            const record = leadTimeRecord(vehicle, 'category', category.category_code);
            return record?.lead_time_days !== null;
        }).length + stations.filter(station => {
            const record = leadTimeRecord(vehicle, 'station', station.category_code, station.station_code);
            return record?.lead_time_days !== null;
        }).length;

        summary.textContent = `${vehicle} lead times: ${confirmedRows}/${totalRows} confirmed. Leave unknown values blank so they remain pending.`;
        container.innerHTML = categories.map(category => {
            const categoryLead = leadTimeRecord(vehicle, 'category', category.category_code);
            const categoryStations = stations.filter(station => station.category_code === category.category_code);
            return `
                <section class="kd2-leadtime-category" data-kd2-lead-category data-lead-id="${categoryLead?.id || ''}" data-category-code="${escapeHtml(category.category_code)}">
                    <div class="kd2-leadtime-head">
                        <div>
                            <strong>${escapeHtml(category.category_name)}</strong>
                            <span class="kd2-leadtime-code">${escapeHtml(category.category_code)} · Category ${category.category_sequence}</span>
                        </div>
                        <span class="kd2-route-badge">${leadTimeText(vehicle, category.category_code, null)}</span>
                    </div>
                    <div class="kd2-modal-grid kd2-leadtime-form">
                        <div class="form-group">
                            <label class="form-label">Category Lead Time (Days)</label>
                            <input type="number" min="0.25" step="0.25" class="filter-control" data-field="leadTime" value="${categoryLead?.lead_time_days ?? ''}" placeholder="Blank = pending" />
                        </div>
                        <div class="form-group">
                            <label class="form-label">Source <span class="form-label-optional">(optional)</span></label>
                            <input type="text" class="filter-control" data-field="source" value="${escapeHtml(categoryLead?.lead_time_source || '')}" placeholder="Optional source" />
                        </div>
                        <div class="form-group" style="grid-column:1/-1">
                            <label class="form-label">Notes <span class="form-label-optional">(optional)</span></label>
                            <input type="text" class="filter-control" data-field="notes" value="${escapeHtml(categoryLead?.notes || '')}" placeholder="Keep business values pending until confirmed" />
                        </div>
                    </div>
                    <div class="kd2-leadtime-table-wrap">
                        <table class="table kd2-leadtime-table">
                            <thead>
                                <tr>
                                    <th>Station</th>
                                    <th>Route</th>
                                    <th>Lead Time (Days)</th>
                                    <th>Source</th>
                                    <th>Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${categoryStations.map(station => {
                                    const stationLead = leadTimeRecord(vehicle, 'station', station.category_code, station.station_code);
                                    return `
                                        <tr data-kd2-lead-station data-lead-id="${stationLead?.id || ''}" data-category-code="${escapeHtml(station.category_code)}" data-station-code="${escapeHtml(station.station_code)}">
                                            <td>
                                                <strong>${escapeHtml(station.station_name)}</strong>
                                                <span class="kd2-inline-meta">${escapeHtml(station.work_center || station.station_code)}</span>
                                            </td>
                                            <td>
                                                <input type="number" min="1" step="1" class="filter-control kd2-route-sequence-input" data-field="routeSequence" value="${station.route_sequence}" title="Stations with the same route run in parallel" />
                                            </td>
                                            <td><input type="number" min="0.25" step="0.25" class="filter-control" data-field="leadTime" value="${stationLead?.lead_time_days ?? ''}" placeholder="Blank = pending" /></td>
                                            <td><input type="text" class="filter-control" data-field="source" value="${escapeHtml(stationLead?.lead_time_source || '')}" placeholder="Optional source" /></td>
                                            <td><input type="text" class="filter-control" data-field="notes" value="${escapeHtml(stationLead?.notes || '')}" placeholder="Optional note" /></td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </section>
            `;
        }).join('');
    }

    async function openLeadTimeModal() {
        if (!canManageKD2()) {
            toast('Only planners and admins can edit KD2 lead times.', 'error');
            return;
        }
        try {
            if (!state.categories.length || !state.stations.length) await loadWorkspaceData();
        } catch (error) {
            toast(`KD2 route setup load failed: ${error.message}`, 'error');
            return;
        }
        renderLeadTimeEditor();
        setLeadTimeError('');
        document.getElementById('kd2LeadTimeOverlay').style.display = 'flex';
    }

    function parseLeadTimeValue(rawValue) {
        const trimmed = String(rawValue ?? '').trim();
        if (!trimmed) return null;
        const value = Number(trimmed);
        if (!Number.isFinite(value) || value <= 0) return NaN;
        return value;
    }

    function parseGapDaysValue(rawValue) {
        const value = parseInt(String(rawValue ?? '').trim(), 10);
        return Number.isFinite(value) && value > 0 ? value : NaN;
    }

    function parseRouteSequenceValue(rawValue) {
        const value = parseInt(String(rawValue ?? '').trim(), 10);
        return Number.isFinite(value) && value > 0 ? value : NaN;
    }

    async function generateUniqueStationCode(vehicle, categoryCode, stationName) {
        const base = `${vehicle.toLowerCase()}_${categoryCode}_${slugifyStationName(stationName)}`;
        const existingRows = await queryAll(
            dbRef.from('kd2_process_stations')
                .select('station_code')
                .eq('vehicle_type', vehicle)
        );
        const existingCodes = new Set(existingRows.map(row => row.station_code));
        let stationCode = base;
        let suffix = 2;
        while (existingCodes.has(stationCode)) {
            stationCode = `${base}_${suffix}`;
            suffix += 1;
        }
        return stationCode;
    }

    async function saveProcessStation() {
        if (!dbRef) return;
        if (!canManageKD2()) {
            toast('Only planners and admins can edit KD2 processes.', 'error');
            return;
        }

        const vehicle = processEditorVehicle();
        const originalStationCode = document.getElementById('kd2ProcessStationCodeOriginal')?.value || '';
        const categoryCode = document.getElementById('kd2ProcessCategory')?.value || '';
        const stationName = document.getElementById('kd2ProcessName')?.value?.trim() || '';
        const workCenter = document.getElementById('kd2ProcessWorkCenter')?.value?.trim() || '';
        const stationNotes = document.getElementById('kd2ProcessStationNotes')?.value?.trim() || '';
        const leadSource = document.getElementById('kd2ProcessLeadSource')?.value?.trim() || '';
        const leadNotes = document.getElementById('kd2ProcessLeadNotes')?.value?.trim() || '';
        const stationSequence = parseRouteSequenceValue(document.getElementById('kd2ProcessSequence')?.value || '');
        const routeSequence = parseRouteSequenceValue(document.getElementById('kd2ProcessRouteSequence')?.value || '');
        const leadTime = parseLeadTimeValue(document.getElementById('kd2ProcessLeadTime')?.value || '');

        if (!categoryCode) {
            setProcessError('Select a KD2 category before saving the process.');
            return;
        }
        if (!stationName) {
            setProcessError('Station name is required.');
            return;
        }
        if (Number.isNaN(stationSequence)) {
            setProcessError('Station order must be a whole number greater than 0.');
            return;
        }
        if (Number.isNaN(routeSequence)) {
            setProcessError('Route must be a whole number greater than 0.');
            return;
        }
        if (Number.isNaN(leadTime)) {
            setProcessError('Lead time must be blank or greater than 0.');
            return;
        }
        if (state.stations.some(row =>
            row.vehicle_type === vehicle &&
            row.category_code === categoryCode &&
            String(row.station_code) !== String(originalStationCode) &&
            (parseInt(row.station_sequence_in_category, 10) || 0) === stationSequence
        )) {
            setProcessError(`Station order ${stationSequence} is already used in this category.`);
            return;
        }

        const beforeStation = originalStationCode
            ? state.stations.find(row => row.vehicle_type === vehicle && row.station_code === originalStationCode) || null
            : null;
        const beforeRoute = originalStationCode
            ? state.routes.find(row => row.vehicle_type === vehicle && row.station_code === originalStationCode) || null
            : null;
        const beforeLead = beforeStation
            ? leadTimeRecord(vehicle, 'station', beforeStation.category_code, originalStationCode)
            : null;
        const stationCode = originalStationCode || await generateUniqueStationCode(vehicle, categoryCode, stationName);
        const stationPayload = {
            vehicle_type: vehicle,
            category_code: categoryCode,
            station_code: stationCode,
            station_name: stationName,
            work_center: workCenter || null,
            station_sequence_in_category: stationSequence,
            route_sequence: routeSequence,
            is_active: true,
            notes: stationNotes || null,
        };
        const routePayload = {
            vehicle_type: vehicle,
            category_code: categoryCode,
            station_code: stationCode,
            route_sequence: routeSequence,
            is_active: true,
        };
        const leadPayload = {
            vehicle_type: vehicle,
            category_code: categoryCode,
            station_code: stationCode,
            planning_level: 'station',
            lead_time_days: leadTime,
            lead_time_source: leadSource || null,
            notes: leadNotes || null,
        };

        try {
            const stationQuery = originalStationCode
                ? dbRef.from('kd2_process_stations')
                    .update(stationPayload)
                    .eq('vehicle_type', vehicle)
                    .eq('station_code', originalStationCode)
                : dbRef.from('kd2_process_stations')
                    .upsert(stationPayload, { onConflict: 'vehicle_type,station_code' });
            const { error: stationError } = await stationQuery;
            if (stationError) throw stationError;

            const { error: routeError } = await dbRef
                .from('kd2_process_routes')
                .upsert(routePayload, { onConflict: 'vehicle_type,station_code' });
            if (routeError) throw routeError;

            if (beforeLead?.id) {
                const { error: leadError } = await dbRef
                    .from('kd2_process_lead_times')
                    .update(leadPayload)
                    .eq('id', beforeLead.id);
                if (leadError) throw leadError;
            } else {
                const { error: leadError } = await dbRef
                    .from('kd2_process_lead_times')
                    .insert(leadPayload);
                if (leadError) throw leadError;
            }

            await writeAudit('UPSERT', 'kd2_process_stations', `${vehicle}:${stationCode}`, beforeStation, stationPayload);
            await writeAudit('UPSERT', 'kd2_process_routes', `${vehicle}:${stationCode}`, beforeRoute, routePayload);
            await writeAudit('UPSERT', 'kd2_process_lead_times', beforeLead?.id || `${vehicle}:${stationCode}:station`, beforeLead, leadPayload);

            toast(`KD2 process "${stationName}" ${originalStationCode ? 'updated' : 'created'}.`, 'success');
            await refreshWorkspace();
            // Force template editor to rebuild from the refreshed station/route state so newly
            // added or updated processes appear immediately without a page reload.
            ensureTemplateEditorState(vehicle, { force: true });
            await helpers.reloadAll?.();
            resetProcessForm({ vehicle, categoryCode });
            renderProcessEditor();
            renderTemplateEditor();
        } catch (error) {
            setProcessError(error.message);
        }
    }

    async function deleteProcessStation(vehicle, stationCode) {
        if (!dbRef) return;
        if (!canManageKD2()) {
            toast('Only planners and admins can edit KD2 processes.', 'error');
            return;
        }
        const station = state.stations.find(row => row.vehicle_type === vehicle && row.station_code === stationCode);
        if (!station) {
            setProcessError('The selected process station is no longer available.');
            return;
        }
        if (!window.confirm(`Retire "${station.station_name}" for ${vehicle}?\nExisting KD2 plan history will be kept.`)) {
            return;
        }

        const beforeRoute = state.routes.find(row => row.vehicle_type === vehicle && row.station_code === stationCode) || null;
        try {
            const { error: stationError } = await dbRef
                .from('kd2_process_stations')
                .update({ is_active: false })
                .eq('vehicle_type', vehicle)
                .eq('station_code', stationCode);
            if (stationError) throw stationError;

            const { error: routeError } = await dbRef
                .from('kd2_process_routes')
                .update({ is_active: false })
                .eq('vehicle_type', vehicle)
                .eq('station_code', stationCode);
            if (routeError) throw routeError;

            await writeAudit('UPDATE', 'kd2_process_stations', `${vehicle}:${stationCode}`, station, { ...station, is_active: false });
            await writeAudit('UPDATE', 'kd2_process_routes', `${vehicle}:${stationCode}`, beforeRoute, beforeRoute ? { ...beforeRoute, is_active: false } : { vehicle_type: vehicle, station_code: stationCode, is_active: false });

            toast(`"${station.station_name}" retired.`, 'success');
            await refreshWorkspace();
            await helpers.reloadAll?.();
            if (document.getElementById('kd2ProcessStationCodeOriginal')?.value === stationCode) {
                resetProcessForm({ vehicle, categoryCode: station.category_code });
            }
            renderProcessEditor();
        } catch (error) {
            setProcessError(error.message);
        }
    }

    async function saveLeadTimes() {
        if (!dbRef) return;
        if (!canManageKD2()) {
            toast('Only planners and admins can edit KD2 lead times.', 'error');
            return;
        }

        const vehicle = state.routeVehicle;
        const categoryNodes = [...document.querySelectorAll('[data-kd2-lead-category]')];
        const stationNodes = [...document.querySelectorAll('[data-kd2-lead-station]')];
        const before = state.leadTimes.filter(row => row.vehicle_type === vehicle);
        const routeBefore = state.stations
            .filter(row => row.vehicle_type === vehicle)
            .map(row => ({ station_code: row.station_code, route_sequence: row.route_sequence }));
        const updates = [];
        const inserts = [];
        const routeUpdates = [];

        for (const node of [...categoryNodes, ...stationNodes]) {
            const leadTime = parseLeadTimeValue(node.querySelector('[data-field="leadTime"]')?.value);
            if (Number.isNaN(leadTime)) {
                setLeadTimeError('Lead time must be blank or greater than 0.');
                return;
            }
            if (node.hasAttribute('data-kd2-lead-station')) {
                const routeSequence = parseRouteSequenceValue(node.querySelector('[data-field="routeSequence"]')?.value);
                if (Number.isNaN(routeSequence)) {
                    setLeadTimeError('Route must be a whole number greater than 0. Use the same route number for parallel stations.');
                    return;
                }
                routeUpdates.push({
                    station_code: node.dataset.stationCode,
                    category_code: node.dataset.categoryCode,
                    route_sequence: routeSequence,
                });
            }
            const payload = {
                vehicle_type: vehicle,
                category_code: node.dataset.categoryCode,
                station_code: node.hasAttribute('data-kd2-lead-station') ? node.dataset.stationCode : null,
                planning_level: node.hasAttribute('data-kd2-lead-station') ? 'station' : 'category',
                lead_time_days: leadTime,
                lead_time_source: node.querySelector('[data-field="source"]')?.value?.trim() || null,
                notes: node.querySelector('[data-field="notes"]')?.value?.trim() || null,
            };
            const leadId = parseInt(node.dataset.leadId, 10);
            if (leadId) updates.push({ id: leadId, ...payload });
            else inserts.push(payload);
        }

        try {
            if (updates.length) {
                const { error } = await dbRef.from('kd2_process_lead_times').upsert(updates, { onConflict: 'id' });
                if (error) throw error;
            }
            if (inserts.length) {
                const { error } = await dbRef.from('kd2_process_lead_times').insert(inserts);
                if (error) throw error;
            }

            for (const route of routeUpdates) {
                const { error: stationError } = await dbRef
                    .from('kd2_process_stations')
                    .update({ route_sequence: route.route_sequence })
                    .eq('vehicle_type', vehicle)
                    .eq('station_code', route.station_code);
                if (stationError) throw stationError;

                const { error: routeError } = await dbRef
                    .from('kd2_process_routes')
                    .upsert({
                        vehicle_type: vehicle,
                        category_code: route.category_code,
                        station_code: route.station_code,
                        route_sequence: route.route_sequence,
                        is_active: true,
                    }, { onConflict: 'vehicle_type,station_code' });
                if (routeError) throw routeError;
            }

            await writeAudit('UPSERT', 'kd2_process_lead_times', vehicle, before, [...updates, ...inserts]);
            await writeAudit('UPDATE', 'kd2_process_routes', vehicle, routeBefore, routeUpdates);
            closeLeadTimeModal();
            toast(`KD2 route and lead-time setup saved for ${vehicle}.`, 'success');
            await refreshWorkspace();
            await helpers.reloadAll?.();
        } catch (error) {
            setLeadTimeError(error.message);
        }
    }

    function renderRouteFlow() {
        const container = document.getElementById('kd2RouteFlow');
        if (!container) return;

        const vehicle = state.routeVehicle;
        const categories = state.categories.filter(row => row.vehicle_type === vehicle);
        const stations = state.stations.filter(row => row.vehicle_type === vehicle);
        if (!categories.length) {
            container.innerHTML = '<div class="empty-state"><p>No KD2 route master loaded yet.</p></div>';
            return;
        }

        container.innerHTML = categories.map(category => {
            const categoryStations = stations
                .filter(station => station.category_code === category.category_code)
                .sort((a, b) => a.station_sequence_in_category - b.station_sequence_in_category);

            return `
                <div class="kd2-route-category">
                    <div class="kd2-route-category-head">
                        <div>
                            <div class="kd2-route-category-title">${escapeHtml(category.category_name)}</div>
                            <span class="kd2-inline-meta">Category sequence ${category.category_sequence}</span>
                        </div>
                        <span class="kd2-route-badge">${leadTimeText(vehicle, category.category_code, null)}</span>
                    </div>
                    <div class="kd2-route-stations">
                        ${categoryStations.map(station => `
                            <div class="kd2-route-station">
                                <span class="kd2-route-station-name">${escapeHtml(station.station_name)}</span>
                                <span class="kd2-route-station-meta">${escapeHtml(station.work_center || station.station_code)} · Route ${station.route_sequence} · ${leadTimeText(vehicle, category.category_code, station.station_code)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    function categoryClassName(category) {
        return `kd2-bar-${String(category || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')}`;
    }

    function setPlanEditError(message) {
        const el = document.getElementById('kd2PlanEditError');
        if (!el) return;
        el.textContent = message;
        el.style.display = message ? 'flex' : 'none';
    }

    function closePlanEdit() {
        const overlay = document.getElementById('kd2PlanEditOverlay');
        if (overlay) overlay.style.display = 'none';
        restorePlanEditOverlayHost();
        setPlanEditError('');
    }

    function closeOpenBarMenus() {
        document.querySelectorAll('.gc-bar-menu-open').forEach(bar => bar.classList.remove('gc-bar-menu-open'));
        document.querySelectorAll('.gc-row-menu-open').forEach(row => row.classList.remove('gc-row-menu-open'));
        document.querySelectorAll('.gc-bar-menu-trigger').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
    }

    function currentTimelineViewMode() {
        return state.timelineViewMode === 'process' ? 'process' : 'unit';
    }

    function isTimelineProcessView() {
        return currentTimelineViewMode() === 'process';
    }

    function resolveTimelineProcessVehicle(rows = state.timelineRows) {
        const filteredVehicle = getVehicleFilterValue();
        if (VEHICLES.includes(filteredVehicle)) {
            state.timelineProcessVehicle = filteredVehicle;
            return filteredVehicle;
        }
        const availableVehicles = [...new Set((rows || [])
            .map(row => row.vehicle_type || row.vehicle || '')
            .filter(vehicle => VEHICLES.includes(vehicle)))]
            .sort((a, b) => vehicleSortValue(a) - vehicleSortValue(b));
        if (availableVehicles.includes(state.timelineProcessVehicle)) return state.timelineProcessVehicle;
        if (availableVehicles.length) {
            state.timelineProcessVehicle = availableVehicles[0];
            return state.timelineProcessVehicle;
        }
        state.timelineProcessVehicle = VEHICLES.includes(state.timelineProcessVehicle) ? state.timelineProcessVehicle : 'K9';
        return state.timelineProcessVehicle;
    }

    function timelineLaneKey(row, viewMode = currentTimelineViewMode(), processVehicle = resolveTimelineProcessVehicle()) {
        if (viewMode === 'process') {
            const vehicle = row.vehicle || row.vehicle_type || '';
            if (!vehicle || vehicle !== processVehicle) return '';
            return ['process', vehicle, row.station_code || '', row.route_sequence || '', row.station_sequence_in_category || ''].join('||');
        }
        return [row.battalion_id ?? row.battalion_code ?? '', row.vehicle ?? row.vehicle_type ?? '', row.unit_serial ?? row.vehicle_no ?? ''].join('||');
    }

    function escapeSelectorValue(value) {
        if (window.CSS?.escape) return window.CSS.escape(value);
        return String(value).replace(/["\\]/g, '\\$&');
    }

    function getVehicleFilterValue() {
        return document.getElementById('filterVehicle')?.value?.trim() || '';
    }

    function getUnitFilterValue() {
        return document.getElementById('filterUnit')?.value?.trim() || '';
    }

    function formatUnitLabel(vehicle, unitSerial, preferredLabel = '') {
        return preferredLabel || `${vehicle}-${String(unitSerial).padStart(2, '0')}`;
    }

    function laneDescriptorFromRow(row, viewMode = currentTimelineViewMode(), processVehicle = resolveTimelineProcessVehicle()) {
        if (viewMode === 'process') {
            const vehicle = row.vehicle || row.vehicle_type || '';
            if (!vehicle || vehicle !== processVehicle) return null;
            const station = state.stations.find(item =>
                item.vehicle_type === vehicle &&
                item.station_code === row.station_code &&
                stationAllowedForVehicle(item)
            ) || null;
            return {
                key: timelineLaneKey(row, viewMode, processVehicle),
                vehicle_type: vehicle,
                station_code: row.station_code || '',
                station_name: row.process_station || row.station_name || station?.station_name || row.station_code || '',
                work_center: row.work_center || station?.work_center || '',
                route_sequence: parseInt(row.route_sequence, 10) || station?.route_sequence || 9999,
                station_sequence_in_category: parseInt(row.station_sequence_in_category, 10) || station?.station_sequence_in_category || 9999,
                category_code: row.category_code || station?.category_code || '',
            };
        }
        const vehicle = row.vehicle || row.vehicle_type || '';
        const unitSerial = parseInt(row.unit_serial, 10) || null;
        return {
            key: timelineLaneKey(row, viewMode, processVehicle),
            battalion_id: row.battalion_id ?? null,
            battalion_code: row.battalion_code || '',
            vehicle_type: vehicle,
            unit_serial: unitSerial,
            unit_label: formatUnitLabel(vehicle, unitSerial || 0, row.unit_label || row.vehicle_no || ''),
            vehicle_no: row.vehicle_no || row.unit_label || formatUnitLabel(vehicle, unitSerial || 0, ''),
        };
    }

    function laneMatchesUnitFilter(lane, unitFilter) {
        if (!unitFilter) return true;
        const tokens = new Set([
            String(lane.unit_label || '').trim(),
            String(lane.vehicle_no || '').trim(),
            lane.unit_serial ? String(lane.unit_serial) : '',
            lane.unit_serial ? formatUnitLabel(lane.vehicle_type, lane.unit_serial, '') : '',
        ].filter(Boolean));
        return tokens.has(unitFilter);
    }

    function buildUnitTimelineLaneDefinitions(rows = state.timelineRows) {
        const laneMap = new Map();
        const addLane = lane => {
            if (!lane?.key) return;
            if (!laneMap.has(lane.key)) laneMap.set(lane.key, { ...lane });
            else laneMap.set(lane.key, { ...laneMap.get(lane.key), ...lane });
        };

        rows.forEach(row => addLane(laneDescriptorFromRow(row, 'unit')));

        const battalionFilter = getBattalionFilterValue();
        const vehicleFilter = getVehicleFilterValue();
        const unitFilter = getUnitFilterValue();
        const vehicles = vehicleFilter && VEHICLES.includes(vehicleFilter) ? [vehicleFilter] : VEHICLES;

        state.battalions.forEach(battalion => {
            if (battalionFilter && battalion.battalion_code !== battalionFilter) return;
            vehicles.forEach(vehicle => {
                const input = inputFor(battalion.id, vehicle);
                const configuredUnitRows = state.vehicleUnits.filter(row => row.battalion_id === battalion.id && row.vehicle_type === vehicle);
                const laneRows = rows.filter(row => row.battalion_id === battalion.id && (row.vehicle_type || row.vehicle) === vehicle);
                const rowSerials = laneRows.map(row => parseInt(row.unit_serial, 10)).filter(Number.isFinite);
                const configuredSerials = configuredUnitRows.map(row => parseInt(row.unit_serial, 10)).filter(Number.isFinite);
                const quantity = Math.max(parseInt(input?.required_quantity, 10) || 0, ...configuredSerials, ...rowSerials, 0);
                if (quantity < 1 && !laneRows.length && !configuredUnitRows.length) return;

                const units = new Map();
                for (let serial = 1; serial <= quantity; serial += 1) {
                    const configured = configuredUnitRows.find(row => parseInt(row.unit_serial, 10) === serial);
                    units.set(serial, {
                        unit_serial: serial,
                        unit_label: formatUnitLabel(vehicle, serial, configured?.unit_label || ''),
                    });
                }
                configuredUnitRows.forEach(row => {
                    const serial = parseInt(row.unit_serial, 10);
                    if (!Number.isFinite(serial) || serial < 1) return;
                    units.set(serial, {
                        unit_serial: serial,
                        unit_label: formatUnitLabel(vehicle, serial, row.unit_label || ''),
                    });
                });
                laneRows.forEach(row => {
                    const serial = parseInt(row.unit_serial, 10);
                    if (!Number.isFinite(serial) || serial < 1) return;
                    units.set(serial, {
                        unit_serial: serial,
                        unit_label: formatUnitLabel(vehicle, serial, row.unit_label || row.vehicle_no || ''),
                    });
                });

                [...units.values()]
                    .filter(unit => laneMatchesUnitFilter({
                        unit_label: unit.unit_label,
                        vehicle_no: unit.unit_label,
                        unit_serial: unit.unit_serial,
                        vehicle_type: vehicle,
                    }, unitFilter))
                    .sort((a, b) => a.unit_serial - b.unit_serial)
                    .forEach(unit => {
                        addLane({
                            key: [battalion.id, vehicle, unit.unit_serial].join('||'),
                            battalion_id: battalion.id,
                            battalion_code: battalion.battalion_code,
                            vehicle_type: vehicle,
                            unit_serial: unit.unit_serial,
                            unit_label: unit.unit_label,
                            vehicle_no: unit.unit_label,
                        });
                    });
            });
        });

        return [...laneMap.values()].sort((a, b) =>
            String(a.battalion_code || '').localeCompare(String(b.battalion_code || '')) ||
            vehicleSortValue(a.vehicle_type) - vehicleSortValue(b.vehicle_type) ||
            (a.unit_serial || 0) - (b.unit_serial || 0) ||
            String(a.unit_label || '').localeCompare(String(b.unit_label || ''))
        );
    }

    function buildProcessTimelineLaneDefinitions(rows = state.timelineRows) {
        const vehicle = resolveTimelineProcessVehicle(rows);
        return routeItemsForVehicle(vehicle).map(item => ({
            key: ['process', vehicle, item.route.station_code || '', item.route.route_sequence || '', item.station.station_sequence_in_category || ''].join('||'),
            vehicle_type: vehicle,
            station_code: item.route.station_code || '',
            station_name: item.station.station_name || item.route.station_code || '',
            work_center: item.station.work_center || item.station.station_code || '',
            route_sequence: parseInt(item.route.route_sequence, 10) || 9999,
            station_sequence_in_category: parseInt(item.station.station_sequence_in_category, 10) || 9999,
            category_code: item.route.category_code || item.station.category_code || '',
        }));
    }

    function buildTimelineLaneDefinitions(rows = state.timelineRows, viewMode = currentTimelineViewMode()) {
        return viewMode === 'process'
            ? buildProcessTimelineLaneDefinitions(rows)
            : buildUnitTimelineLaneDefinitions(rows);
    }

    function firstPlacementStation(vehicle) {
        return state.stations
            .filter(row => row.vehicle_type === vehicle)
            .sort((a, b) =>
                (a.category_sequence || 9999) - (b.category_sequence || 9999) ||
                (a.route_sequence || 9999) - (b.route_sequence || 9999) ||
                (a.station_sequence_in_category || 9999) - (b.station_sequence_in_category || 9999)
            )[0] || null;
    }

    function currentPlacementStation() {
        return state.stations.find(row =>
            row.vehicle_type === state.timelinePlacementVehicle &&
            row.station_code === state.timelinePlacementStationCode
        ) || null;
    }

    function currentPlacementUnit() {
        if (state.timelinePlacementBattalionId == null || state.timelinePlacementUnitSerial == null) return null;
        return {
            battalion_id: state.timelinePlacementBattalionId,
            unit_serial: state.timelinePlacementUnitSerial,
            unit_label: state.timelinePlacementUnitLabel || '',
            vehicle_type: state.timelinePlacementVehicle,
        };
    }

    function setTimelinePlacementUnit(battalionId, unitSerial, unitLabel, vehicle) {
        state.timelinePlacementBattalionId = battalionId ?? null;
        state.timelinePlacementUnitSerial = unitSerial ?? null;
        state.timelinePlacementUnitLabel = unitLabel || '';
        if (vehicle) state.timelinePlacementVehicle = vehicle;
    }

    function clearTimelinePlacementUnit() {
        state.timelinePlacementBattalionId = null;
        state.timelinePlacementUnitSerial = null;
        state.timelinePlacementUnitLabel = '';
    }

    function fallbackPlacementColor(name) {
        const key = String(name || '');
        let hash = 0;
        for (let i = 0; i < key.length; i += 1) hash = ((hash << 5) - hash) + key.charCodeAt(i);
        return PLACEMENT_GHOST_PALETTE[Math.abs(hash) % PLACEMENT_GHOST_PALETTE.length];
    }

    function placementGhostColor(station) {
        const name = station?.station_name || station?.station_code || 'KD2';
        const colorFn = window.__ppmsGanttStationColor;
        if (typeof colorFn === 'function') {
            try { return colorFn(name); } catch { /* noop */ }
        }
        return fallbackPlacementColor(name);
    }

    function rememberPlacementPointer(clientX, clientY) {
        if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
        placementPointer.x = clientX;
        placementPointer.y = clientY;
        placementPointer.ready = true;
    }

    function placementGhostHost() {
        return document.fullscreenElement || document.body;
    }

    function ensurePlacementGhost() {
        const host = placementGhostHost();
        if (!host) return null;
        const hostIsBody = host === document.body;
        if (!placementGhostEl) {
            placementGhostEl = document.createElement('div');
            placementGhostEl.id = 'kd2PlacementGhost';
            placementGhostEl.className = 'kd2-placement-ghost gc-bar';
            placementGhostEl.setAttribute('aria-hidden', 'true');
            placementGhostEl.innerHTML = `
                <span class="gc-bar-text" data-kd2-placement-title></span>`;
            Object.assign(placementGhostEl.style, {
                position: hostIsBody ? 'fixed' : 'absolute',
                left: '0px',
                top: '0px',
                zIndex: '2147483647',
                minWidth: '140px',
                maxWidth: '240px',
                height: '34px',
                padding: '0 12px',
                border: '1px solid rgba(255,255,255,.12)',
                borderRadius: '5px',
                display: 'flex',
                alignItems: 'center',
                overflow: 'hidden',
                pointerEvents: 'none',
                boxShadow: '0 16px 34px rgba(15,23,42,.34)',
                transform: 'translate(18px, 18px) rotate(-2deg)',
                opacity: '0.96',
            });
        }
        placementGhostEl.style.position = hostIsBody ? 'fixed' : 'absolute';
        if (!hostIsBody && window.getComputedStyle(host).position === 'static') {
            host.style.position = 'relative';
        }
        if (placementGhostEl.parentElement !== host) host.appendChild(placementGhostEl);
        return placementGhostEl;
    }

    function removePlacementGhost() {
        if (!placementGhostEl) return;
        placementGhostEl.remove();
        placementGhostEl = null;
    }

    function positionPlacementGhost() {
        const ghost = ensurePlacementGhost();
        if (!ghost) return;
        const fallbackX = Math.round((window.innerWidth || document.documentElement.clientWidth || 0) / 2);
        const fallbackY = Math.round((window.innerHeight || document.documentElement.clientHeight || 0) / 2);
        const pointerX = placementPointer.ready ? placementPointer.x : fallbackX;
        const pointerY = placementPointer.ready ? placementPointer.y : fallbackY;
        const host = placementGhostHost();
        if (host && host !== document.body) {
            const rect = host.getBoundingClientRect();
            ghost.style.left = `${Math.max(pointerX - rect.left, 0)}px`;
            ghost.style.top = `${Math.max(pointerY - rect.top, 0)}px`;
            return;
        }
        ghost.style.left = `${pointerX}px`;
        ghost.style.top = `${pointerY}px`;
    }

    function syncTimelinePlacementGhost() {
        if (isTimelineProcessView()) {
            const unit = currentPlacementUnit();
            if (!state.timelinePlacementActive || !unit) {
                removePlacementGhost();
                return;
            }
            const ghost = ensurePlacementGhost();
            if (!ghost) return;
            ghost.style.background = fallbackPlacementColor(`${unit.vehicle_type}||${unit.unit_serial}`);
            ghost.style.visibility = 'visible';
            ghost.querySelector('[data-kd2-placement-title]')?.replaceChildren(document.createTextNode(`${unit.vehicle_type || 'KD2'} · ${unit.unit_label || 'Selected unit'}`));
            positionPlacementGhost();
            return;
        }
        const station = currentPlacementStation();
        if (!state.timelinePlacementActive || !station) {
            removePlacementGhost();
            return;
        }
        const ghost = ensurePlacementGhost();
        if (!ghost) return;
        ghost.style.background = placementGhostColor(station);
        ghost.style.visibility = 'visible';
        ghost.querySelector('[data-kd2-placement-title]')?.replaceChildren(document.createTextNode(`${station.vehicle_type || 'KD2'} · ${station.station_name || station.station_code || 'Selected station'}`));
        positionPlacementGhost();
    }

    function setTimelinePlacementVehicle(vehicle) {
        const safeVehicle = VEHICLES.includes(vehicle) ? vehicle : 'K9';
        state.timelinePlacementVehicle = safeVehicle;
        const hasSelectedStation = state.stations.some(row =>
            row.vehicle_type === safeVehicle &&
            row.station_code === state.timelinePlacementStationCode
        );
        if (!hasSelectedStation) {
            state.timelinePlacementStationCode = firstPlacementStation(safeVehicle)?.station_code || '';
        }
        syncTimelinePlacementUi();
    }

    function setTimelinePlacementStation(stationCode, vehicle = state.timelinePlacementVehicle) {
        if (vehicle && vehicle !== state.timelinePlacementVehicle) {
            state.timelinePlacementVehicle = vehicle;
        }
        const station = state.stations.find(row => row.vehicle_type === state.timelinePlacementVehicle && row.station_code === stationCode) || null;
        if (!station) {
            state.timelinePlacementStationCode = firstPlacementStation(state.timelinePlacementVehicle)?.station_code || '';
        } else {
            state.timelinePlacementStationCode = station.station_code;
        }
        syncTimelinePlacementUi();
    }

    function clearTimelinePlacementStation() {
        state.timelinePlacementStationCode = '';
        syncTimelinePlacementUi();
    }

    function setTimelinePlacementQuery(value) {
        state.timelinePlacementQuery = String(value || '').trim();
        syncTimelinePlacementUi();
    }

    function setTimelinePlacementMenuOpen(on) {
        state.timelinePlacementMenuOpen = !!on;
        const timelineMenu = document.getElementById('kd2TimelineVisualMenu');
        if (timelineMenu) timelineMenu.style.display = state.timelinePlacementMenuOpen ? '' : 'none';
        const ganttPlacementBar = document.getElementById('ganttVisualPlacementBar');
        if (ganttPlacementBar) ganttPlacementBar.style.display = state.timelinePlacementMenuOpen ? '' : 'none';
        ['btnKd2VisualAdd', 'btnGanttVisualAdd'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.setAttribute('aria-expanded', state.timelinePlacementMenuOpen ? 'true' : 'false');
        });
    }

    function renderPlacementPalette(containerId, { activateOnSelect = false, closeMenuOnSelect = false } = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const vehicle = state.timelinePlacementVehicle;
        const query = String(state.timelinePlacementQuery || '').trim().toLowerCase();

        if (isTimelineProcessView()) {
            const battalionMap = new Map();
            (state.timelineRows || [])
                .filter(r => (r.vehicle_type || r.vehicle) === vehicle && r.battalion_id != null && r.unit_serial != null)
                .forEach(r => {
                    const unitKey = `${r.battalion_id}||${r.unit_serial}`;
                    if (!battalionMap.has(r.battalion_id)) {
                        battalionMap.set(r.battalion_id, { battalion_id: r.battalion_id, battalion_code: r.battalion_code || String(r.battalion_id), units: new Map() });
                    }
                    const batGroup = battalionMap.get(r.battalion_id);
                    if (!batGroup.units.has(unitKey)) {
                        const label = r.unit_label || r.vehicle_no || `${vehicle}-${String(r.unit_serial).padStart(2, '0')}`;
                        if (!query || label.toLowerCase().includes(query) || batGroup.battalion_code.toLowerCase().includes(query)) {
                            batGroup.units.set(unitKey, { battalion_id: r.battalion_id, unit_serial: r.unit_serial, unit_label: label });
                        }
                    }
                });
            const batGroups = [...battalionMap.values()].filter(g => g.units.size > 0);
            if (!batGroups.length) {
                container.innerHTML = `<div class="empty-state"><p>${query ? 'No units match the current filter.' : 'No units available. Load plan data first.'}</p></div>`;
                return;
            }
            container.innerHTML = batGroups.map(group => `
                <div class="kd2-timeline-palette-group">
                    <div class="kd2-timeline-palette-group-title">${escapeHtml(group.battalion_code)}</div>
                    <div class="kd2-timeline-palette-items">
                        ${[...group.units.values()]
                            .sort((a, b) => String(a.unit_label).localeCompare(String(b.unit_label), undefined, { numeric: true }))
                            .map(unit => {
                                const isActive = state.timelinePlacementBattalionId === unit.battalion_id && state.timelinePlacementUnitSerial === unit.unit_serial;
                                return `
                                <button type="button"
                                    class="kd2-timeline-palette-item${isActive ? ' kd2-timeline-palette-item-active' : ''}"
                                    data-kd2-placement-battalion="${escapeHtml(unit.battalion_id)}"
                                    data-kd2-placement-unit-serial="${escapeHtml(unit.unit_serial)}"
                                    data-kd2-placement-unit-label="${escapeHtml(unit.unit_label)}"
                                    data-kd2-placement-vehicle="${escapeHtml(vehicle)}">
                                    <span class="kd2-placement-palette-bar">
                                        <span class="gc-bar-text">${escapeHtml(`${vehicle} · ${unit.unit_label}`)}</span>
                                    </span>
                                    <span class="kd2-placement-palette-meta">${escapeHtml(group.battalion_code)}</span>
                                </button>`;
                            }).join('')}
                    </div>
                </div>`).join('');
            container.querySelectorAll('[data-kd2-placement-battalion]').forEach(btn => {
                const handleSelect = (event) => {
                    if (event.type === 'click' && event.detail > 0) { event.preventDefault(); return; }
                    if (event.type === 'pointerdown' && event.button !== undefined && event.button !== 0) return;
                    const battalionId = parseInt(btn.dataset.kd2PlacementBattalion || '', 10);
                    const unitSerial = parseInt(btn.dataset.kd2PlacementUnitSerial || '', 10);
                    const unitLabel = btn.dataset.kd2PlacementUnitLabel || '';
                    const vehicleCode = btn.dataset.kd2PlacementVehicle || vehicle;
                    const isSameSelection = state.timelinePlacementBattalionId === battalionId && state.timelinePlacementUnitSerial === unitSerial;
                    if (isSameSelection) {
                        clearTimelinePlacementUnit();
                        cancelTimelinePlacement({ keepMenuOpen: true, skipRender: !state.timelineEditMode });
                        return;
                    }
                    setTimelinePlacementUnit(battalionId, unitSerial, unitLabel, vehicleCode);
                    if (activateOnSelect) beginTimelinePlacement({ keepMenuState: !closeMenuOnSelect });
                    if (closeMenuOnSelect) setTimelinePlacementMenuOpen(false);
                    syncTimelinePlacementUi();
                };
                btn.addEventListener('pointerdown', handleSelect);
                btn.addEventListener('click', handleSelect);
            });
            return;
        }

        const groups = state.categories
            .filter(row => row.vehicle_type === vehicle)
            .sort((a, b) => (a.category_sequence || 9999) - (b.category_sequence || 9999))
            .map(category => ({
                category,
                stations: state.stations
                    .filter(row => row.vehicle_type === vehicle && row.category_code === category.category_code)
                    .filter(row => {
                        if (!query) return true;
                        const haystack = [
                            category.category_name,
                            row.station_name,
                            row.work_center,
                            row.station_code,
                            row.vehicle_type,
                        ].join(' ').toLowerCase();
                        return haystack.includes(query);
                    })
                    .sort((a, b) => (a.route_sequence || 9999) - (b.route_sequence || 9999) || (a.station_sequence_in_category || 9999) - (b.station_sequence_in_category || 9999)),
            }))
            .filter(group => group.stations.length);

        if (!groups.length) {
            container.innerHTML = `<div class="empty-state"><p>${query ? 'No visual blocks match the current filter.' : 'No KD2 stations are available for this vehicle.'}</p></div>`;
            return;
        }

        container.innerHTML = groups.map(group => `
            <div class="kd2-timeline-palette-group">
                <div class="kd2-timeline-palette-group-title">${escapeHtml(group.category.category_name)}</div>
                <div class="kd2-timeline-palette-items">
                    ${group.stations.map(station => `
                        ${(() => {
                const swatchColor = escapeHtml(placementGhostColor(station));
                return `
                        <button
                            type="button"
                            class="kd2-timeline-palette-item${state.timelinePlacementStationCode === station.station_code ? ' kd2-timeline-palette-item-active' : ''}"
                            data-kd2-placement-station="${escapeHtml(station.station_code)}"
                            data-kd2-placement-vehicle="${escapeHtml(vehicle)}"
                            style="--kd2-placement-color:${swatchColor}">
                            <span class="kd2-placement-palette-bar">
                                <span class="gc-bar-text">${escapeHtml(`${station.vehicle_type || vehicle} · ${station.station_name}`)}</span>
                            </span>
                            <span class="kd2-placement-palette-meta">${escapeHtml(station.work_center || station.station_code)} · Route ${escapeHtml(station.route_sequence)}</span>
                            <span class="kd2-placement-palette-meta">${escapeHtml(leadTimeText(vehicle, station.category_code, station.station_code))}</span>
                        </button>
                    `;
            })()}
                    `).join('')}
                </div>
            </div>
        `).join('');

        container.querySelectorAll('[data-kd2-placement-station]').forEach(btn => {
            btn.addEventListener('pointerdown', event => {
                if (event.button !== undefined && event.button !== 0) return;
                const stationCode = btn.dataset.kd2PlacementStation || '';
                const vehicleCode = btn.dataset.kd2PlacementVehicle || state.timelinePlacementVehicle;
                const isSameSelection = state.timelinePlacementStationCode === stationCode && state.timelinePlacementVehicle === vehicleCode;
                if (isSameSelection) {
                    rememberPlacementPointer(event.clientX, event.clientY);
                    clearTimelinePlacementStation();
                    cancelTimelinePlacement({ keepMenuOpen: true, skipRender: !state.timelineEditMode });
                    return;
                }
                setTimelinePlacementStation(btn.dataset.kd2PlacementStation, btn.dataset.kd2PlacementVehicle);
                rememberPlacementPointer(event.clientX, event.clientY);
                if (activateOnSelect) beginTimelinePlacement({ keepMenuState: !closeMenuOnSelect });
                if (closeMenuOnSelect) setTimelinePlacementMenuOpen(false);
                syncTimelinePlacementGhost();
            });
            btn.addEventListener('click', event => {
                if (event.detail > 0) {
                    event.preventDefault();
                    return;
                }
                const stationCode = btn.dataset.kd2PlacementStation || '';
                const vehicleCode = btn.dataset.kd2PlacementVehicle || state.timelinePlacementVehicle;
                const isSameSelection = state.timelinePlacementStationCode === stationCode && state.timelinePlacementVehicle === vehicleCode;
                if (isSameSelection) {
                    clearTimelinePlacementStation();
                    cancelTimelinePlacement({ keepMenuOpen: true, skipRender: !state.timelineEditMode });
                    return;
                }
                setTimelinePlacementStation(btn.dataset.kd2PlacementStation, btn.dataset.kd2PlacementVehicle);
                if (activateOnSelect) beginTimelinePlacement({ keepMenuState: !closeMenuOnSelect });
                if (closeMenuOnSelect) setTimelinePlacementMenuOpen(false);
                syncTimelinePlacementGhost();
            });
        });
    }

    function syncTimelinePlacementUi() {
        const bar = document.getElementById('kd2TimelinePlacementBar');
        const summary = document.getElementById('kd2TimelinePlacementSummary');
        const hint = document.getElementById('kd2TimelinePlacementHint');
        const ganttSummary = document.getElementById('ganttVisualPlacementSummary');
        const ganttHint = document.getElementById('ganttVisualPlacementHint');
        const timelineVehicle = document.getElementById('kd2TimelinePlacementVehicle');
        const ganttVehicle = document.getElementById('ganttVisualPlacementVehicle');
        const timelineFilter = document.getElementById('kd2TimelinePlacementFilter');
        const ganttFilter = document.getElementById('ganttVisualPlacementFilter');
        const processView = isTimelineProcessView();
        if (timelineVehicle && timelineVehicle.value !== state.timelinePlacementVehicle) timelineVehicle.value = state.timelinePlacementVehicle;
        if (ganttVehicle && ganttVehicle.value !== state.timelinePlacementVehicle) ganttVehicle.value = state.timelinePlacementVehicle;
        if (timelineFilter && timelineFilter.value !== state.timelinePlacementQuery) timelineFilter.value = state.timelinePlacementQuery;
        if (ganttFilter && ganttFilter.value !== state.timelinePlacementQuery) ganttFilter.value = state.timelinePlacementQuery;

        const station = currentPlacementStation();
        const unit = currentPlacementUnit();
        const summaryText = processView
            ? unit
                ? `${unit.vehicle_type} · ${unit.unit_label} is active. Click a station row and date to place a block.`
                : 'Select a unit, then click a station row and date to place a block.'
            : station
                ? `${station.station_name} is active. Click once on a ${station.vehicle_type} lane and date to place it.`
                : 'Select a station block, then place it on a matching lane.';
        const hintText = processView
            ? 'Friday and saved no-work days are normalized automatically when the new KD2 block is created.'
            : station
                ? 'Friday and saved no-work days are normalized automatically when the new KD2 block is created.'
                : 'The selected station stays active until you change it or cancel placement mode.';
        if (summary) summary.textContent = summaryText;
        if (hint) hint.textContent = hintText;
        if (ganttSummary) ganttSummary.textContent = summaryText;
        if (ganttHint) ganttHint.textContent = hintText;
        if (bar) bar.style.display = state.timelinePlacementActive ? '' : 'none';
        ['btnKd2VisualAdd', 'btnGanttVisualAdd'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.disabled = false;
            btn.setAttribute('aria-pressed', state.timelinePlacementActive ? 'true' : 'false');
        });

        renderPlacementPalette('kd2TimelineVisualPalette', { activateOnSelect: true, closeMenuOnSelect: true });
        renderPlacementPalette('ganttVisualPalette', { activateOnSelect: true, closeMenuOnSelect: false });
        syncTimelinePlacementGhost();
    }

    function syncTimelineSelectionUi() {
        const count = [...state.timelineSelectedIds].filter(id => state.timelineRows.some(row => row.id === id)).length;
        const countEl = document.getElementById('kd2TimelineSelectionCount');
        if (countEl) countEl.textContent = `${count} selected`;
        document.querySelectorAll('[data-kd2-select-id]').forEach(btn => {
            const selected = state.timelineSelectedIds.has(parseInt(btn.dataset.kd2SelectId, 10));
            btn.classList.toggle('kd2-timeline-select-active', selected);
            btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        document.querySelectorAll('[data-kd2-plan-id]').forEach(bar => {
            const selected = state.timelineSelectedIds.has(parseInt(bar.dataset.kd2PlanId, 10));
            bar.classList.toggle('kd2-timeline-bar-selected', selected);
        });
    }

    function canUseLaneTimelineOperations() {
        return !isTimelineProcessView();
    }

    function syncTimelineViewControls(rows = state.timelineRows) {
        const processVehicle = resolveTimelineProcessVehicle(rows);
        const unitBtn = document.getElementById('btnKd2TimelineViewUnit');
        const processBtn = document.getElementById('btnKd2TimelineViewProcess');
        // Also sync the duplicate toggle in the main Gantt bar
        const ganttUnitBtn = document.getElementById('btnGanttViewUnit');
        const ganttProcessBtn = document.getElementById('btnGanttViewProcess');
        const subtitle = document.getElementById('kd2TimelineSubtitle');
        const meta = document.getElementById('kd2TimelineViewMeta');
        const laneBtn = document.getElementById('btnKd2TimelineModeLane');
        const fromBlockBtn = document.getElementById('btnKd2TimelineModeFromBlock');
        const selectLaneBtn = document.getElementById('btnKd2TimelineSelectLane');
        const visualAddBtn = document.getElementById('btnKd2VisualAdd');
        const processView = isTimelineProcessView();

        [unitBtn, processBtn].forEach(btn => {
            if (!btn) return;
            const active = btn.dataset.view === currentTimelineViewMode();
            btn.classList.toggle('kd2-timeline-view-btn-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        [ganttUnitBtn, ganttProcessBtn].forEach(btn => {
            if (!btn) return;
            const active = btn.dataset.view === currentTimelineViewMode();
            btn.classList.toggle('gantt-view-seg-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        if (subtitle) {
            subtitle.textContent = processView
                ? `Process view uses the ${processVehicle} route order and labels each block by battalion and unit.`
                : 'Manual and generated KD2 plan rows grouped by battalion and unit. Click a bar to manage one plan block.';
        }
        if (meta) {
            meta.textContent = processView
                ? `Process view is locked to the ${processVehicle} route. Use the vehicle filter to switch routes.`
                : 'Unit view shows battalion / vehicle / unit lanes.';
        }

        [laneBtn, fromBlockBtn, selectLaneBtn].forEach(btn => {
            if (!btn) return;
            btn.disabled = processView;
        });
        if (visualAddBtn) visualAddBtn.disabled = processView;
    }

    function setTimelineViewMode(viewMode, { skipRender = false } = {}) {
        const nextMode = viewMode === 'process' ? 'process' : 'unit';
        state.timelineViewMode = nextMode;
        if (nextMode === 'process') {
            state.timelineMoveMode = 'block';
            state.timelineSelectLaneMode = false;
            if (state.timelinePlacementActive) cancelTimelinePlacement({ skipRender: true });
            setTimelinePlacementMenuOpen(false);
        }
        syncTimelineViewControls();
        setTimelineMoveMode(state.timelineMoveMode);
        setTimelineSelectLaneMode(state.timelineSelectLaneMode, { skipRender: true });
        if (!skipRender) renderSchedule();
    }

    function setTimelineMoveMode(mode) {
        const safeMode = ['lane', 'from-block'].includes(mode) ? mode : 'block';
        state.timelineMoveMode = canUseLaneTimelineOperations() ? safeMode : 'block';
        document.querySelectorAll('.kd2-timeline-mode-btn[data-mode="block"], .kd2-timeline-mode-btn[data-mode="from-block"], .kd2-timeline-mode-btn[data-mode="lane"]').forEach(btn => {
            btn.classList.toggle('kd2-timeline-mode-active', btn.dataset.mode === state.timelineMoveMode);
        });
    }

    function setTimelineSelectLaneMode(on, { skipRender = false } = {}) {
        state.timelineSelectLaneMode = canUseLaneTimelineOperations() ? !!on : false;
        const btn = document.getElementById('btnKd2TimelineSelectLane');
        if (btn) {
            btn.classList.toggle('kd2-timeline-mode-active', state.timelineSelectLaneMode);
            btn.setAttribute('aria-pressed', state.timelineSelectLaneMode ? 'true' : 'false');
        }
        if (!skipRender) renderSchedule();
    }

    function setTimelineEditMode(on) {
        state.timelineEditMode = !!on;
        if (!state.timelineEditMode) {
            state.timelineMoveMode = 'block';
            state.timelineSelectLaneMode = false;
            state.timelineSelectedIds.clear();
            state.timelinePlacementActive = false;
        }
        const editBtn = document.getElementById('btnKd2TimelineEdit');
        const editBar = document.getElementById('kd2TimelineEditBar');
        if (editBtn) editBtn.style.display = state.timelineEditMode ? 'none' : '';
        if (editBar) editBar.style.display = state.timelineEditMode ? 'flex' : 'none';
        setTimelineMoveMode(state.timelineMoveMode);
        setTimelineSelectLaneMode(state.timelineSelectLaneMode, { skipRender: true });
        syncTimelineSelectionUi();
        syncTimelinePlacementUi();
        renderSchedule();
    }

    function buildTimelineGroups(rows, viewMode = currentTimelineViewMode()) {
        const rowsByLane = new Map();
        rows
            .slice()
            .sort((a, b) => {
                if (viewMode === 'process') {
                    const startCmp = String(a.start_date || '').localeCompare(String(b.start_date || ''));
                    if (startCmp !== 0) return startCmp;
                    const endCmp = String(a.end_date || '').localeCompare(String(b.end_date || ''));
                    if (endCmp !== 0) return endCmp;
                    const battalionCmp = String(a.battalion_code || '').localeCompare(String(b.battalion_code || ''));
                    if (battalionCmp !== 0) return battalionCmp;
                    const unitCmp = String(a.vehicle_no || a.unit_label || '').localeCompare(String(b.vehicle_no || b.unit_label || ''), undefined, { numeric: true });
                    if (unitCmp !== 0) return unitCmp;
                    return comparePlanRowsByLaneOrder(a, b);
                }
                const battalionCmp = String(a.battalion_code || '').localeCompare(String(b.battalion_code || ''));
                if (battalionCmp !== 0) return battalionCmp;
                const vehicleCmp = vehicleSortValue(a.vehicle) - vehicleSortValue(b.vehicle);
                if (vehicleCmp !== 0) return vehicleCmp;
                const unitCmp = String(a.vehicle_no || '').localeCompare(String(b.vehicle_no || ''), undefined, { numeric: true });
                if (unitCmp !== 0) return unitCmp;
                return comparePlanRowsByLaneOrder(a, b);
            })
            .forEach(row => {
                const key = timelineLaneKey(row, viewMode);
                if (!key) return;
                if (!rowsByLane.has(key)) rowsByLane.set(key, []);
                rowsByLane.get(key).push(row);
            });

        return buildTimelineLaneDefinitions(state.timelineRows, viewMode).map(lane => {
            const laneRows = rowsByLane.get(lane.key) || [];
            return {
                key: lane.key,
                label: viewMode === 'process'
                    ? lane.station_name || lane.station_code || 'Process'
                    : `${lane.battalion_code || '—'} · ${lane.vehicle_type || '—'} · ${lane.unit_label || lane.vehicle_no || '—'}`,
                meta: viewMode === 'process'
                    ? `${lane.work_center || lane.station_code || 'No work center'} · Route ${lane.route_sequence || '—'}`
                    : laneRows.length
                        ? `${laneRows.length} block${laneRows.length === 1 ? '' : 's'} · ${minDateStr(laneRows.map(row => row.start_date))} -> ${maxDateStr(laneRows.map(row => row.end_date))}`
                        : 'No visible blocks in the current timeline window',
                lane,
                rows: laneRows,
            };
        });
    }

    function buildTimelinePackedBars(rows, viewStart, viewEnd, viewMode = currentTimelineViewMode()) {
        const visibleRows = rows
            .filter(row => row.start_date <= viewEnd && row.end_date >= viewStart)
            .map(row => {
                const clippedStart = row.start_date < viewStart ? viewStart : row.start_date;
                const clippedEnd = row.end_date > viewEnd ? viewEnd : row.end_date;
                const si = Math.max(dayDiff(viewStart, clippedStart), 0);
                const ei = Math.max(dayDiff(viewStart, clippedEnd), si);
                return { row, clippedStart, clippedEnd, si, ei };
            })
            .sort((a, b) => {
                if (a.si !== b.si) return a.si - b.si;
                if (a.ei !== b.ei) return a.ei - b.ei;
                if (viewMode === 'process') {
                    const battalionCmp = String(a.row.battalion_code || '').localeCompare(String(b.row.battalion_code || ''));
                    if (battalionCmp !== 0) return battalionCmp;
                    return String(a.row.vehicle_no || a.row.unit_label || '').localeCompare(String(b.row.vehicle_no || b.row.unit_label || ''), undefined, { numeric: true });
                }
                return comparePlanRowsByLaneOrder(a.row, b.row);
            });

        const laneEnds = [];
        visibleRows.forEach(item => {
            let lane = laneEnds.findIndex(endIndex => item.si > endIndex);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = item.ei;
            item.stackLane = lane;
        });
        return visibleRows;
    }

    async function persistTimelineChanges(changes, auditRecordId) {
        if (!changes.length) return;
        const beforeRows = changes.map(change => ({
            id: change.id,
            battalion_id: change.oldBattalionId,
            vehicle_type: change.oldVehicleType,
            unit_serial: change.oldUnitSerial,
            unit_label: change.oldUnitLabel || null,
            station_code: change.stationCode || null,
            planned_start_date: change.oldStart,
            planned_end_date: change.oldEnd,
            schedule_week: weekLabel(change.oldStart),
        }));
        const updatedRows = [];
        for (const change of changes) {
            const payload = {
                battalion_id: change.newBattalionId,
                vehicle_type: change.newVehicleType,
                unit_serial: change.newUnitSerial,
                unit_label: change.newUnitLabel || null,
                planned_start_date: change.newStart,
                planned_end_date: change.newEnd,
                schedule_week: weekLabel(change.newStart),
            };
            const { data, error } = await dbRef
                .from('kd2_plan')
                .update(payload)
                .eq('id', change.id)
                .select('*')
                .single();
            if (error) throw error;
            updatedRows.push(data);
        }
        await writeAudit('UPDATE', 'kd2_plan', auditRecordId, beforeRows, updatedRows);
    }

    function timelineLaneFromTrack(track) {
        if (!track) return null;
        const battalionId = parseInt(track.dataset.battalionId || '', 10);
        const unitSerial = parseInt(track.dataset.unitSerial || '', 10);
        return {
            key: track.dataset.kd2LaneKey || '',
            battalion_id: Number.isFinite(battalionId) ? battalionId : null,
            battalion_code: track.dataset.battalionCode || '',
            vehicle_type: track.dataset.vehicleType || '',
            unit_serial: Number.isFinite(unitSerial) ? unitSerial : null,
            unit_label: track.dataset.unitLabel || '',
            station_code: track.dataset.stationCode || '',
        };
    }

    function dateFromTrackPointer(track, clientX) {
        const viewStart = track.dataset.viewStart || '';
        const totalDays = parseInt(track.dataset.totalDays || '', 10) || 1;
        const rect = track.getBoundingClientRect();
        if (!viewStart || !rect.width) return '';
        const offset = Math.max(0, Math.min(rect.width - 1, clientX - rect.left));
        const dayWidth = rect.width / Math.max(totalDays, 1);
        const dayOffset = Math.max(0, Math.min(totalDays - 1, Math.floor(offset / Math.max(dayWidth, 1))));
        return addDays(viewStart, dayOffset);
    }

    async function placePlanBlockOnLane(lane, plannedStart) {
        if (!state.timelinePlacementActive) return false;
        if (!canManageKD2()) {
            toast('Only planners and admins can add KD2 plan rows.', 'error');
            return false;
        }
        if (!plannedStart) return false;

        if (isTimelineProcessView()) {
            const unit = currentPlacementUnit();
            if (!unit) {
                toast('Select a unit before placing a block.', 'error');
                return false;
            }
            const vehicle = lane.vehicle_type || state.timelinePlacementVehicle;
            // Resolve station: prefer explicit station_code on lane (timeline), fall back to name lookup (Gantt)
            let station = lane.station_code
                ? state.stations.find(s => s.vehicle_type === vehicle && s.station_code === lane.station_code)
                : null;
            if (!station && lane.key) {
                station = state.stations
                    .filter(s => s.vehicle_type === vehicle && s.station_name === lane.key)
                    .sort((a, b) => (a.station_sequence_in_category || 9999) - (b.station_sequence_in_category || 9999))[0] || null;
            }
            if (!station) {
                toast('Could not identify the station for this lane.', 'error');
                return false;
            }
            try {
                const duration = defaultDurationForStation(station.vehicle_type, station.category_code, station.station_code);
                if (!duration) throw new Error(`Missing default duration for ${station.station_name}.`);
                await createPlanBlock({
                    battalionId: unit.battalion_id,
                    vehicle: station.vehicle_type,
                    unitSerial: unit.unit_serial,
                    unitLabel: unit.unit_label,
                    stationCode: station.station_code,
                    startDate: plannedStart,
                    duration,
                    remark: null,
                });
                state.timelineLastDragAt = Date.now();
                const hasReload = typeof helpers.reloadAll === 'function';
                cancelTimelinePlacement({ skipRender: hasReload, keepMenuOpen: true });
                toast(`KD2 block placed for ${unit.unit_label} at ${station.station_name}.`, 'success');
                if (hasReload) await helpers.reloadAll();
                else renderSchedule();
                return true;
            } catch (error) {
                toast(`KD2 placement failed: ${error.message}`, 'error');
                return false;
            }
        }

        // Unit view: station from palette, unit from lane
        const station = currentPlacementStation();
        if (!station) {
            toast('Select a KD2 station before placing a block.', 'error');
            return false;
        }
        if (!lane?.battalion_id || !lane?.unit_serial) {
            toast('The selected lane is missing battalion or unit details.', 'error');
            return false;
        }
        if (lane.vehicle_type !== station.vehicle_type) {
            toast(`Placement blocked: ${station.station_name} belongs to ${station.vehicle_type} and must be placed on a matching lane.`, 'error');
            return false;
        }

        try {
            const duration = defaultDurationForStation(station.vehicle_type, station.category_code, station.station_code);
            if (!duration) throw new Error(`Missing default duration for ${station.station_name}.`);
            await createPlanBlock({
                battalionId: lane.battalion_id,
                vehicle: lane.vehicle_type,
                unitSerial: lane.unit_serial,
                unitLabel: lane.unit_label,
                stationCode: station.station_code,
                startDate: plannedStart,
                duration,
                remark: null,
            });
            state.timelineLastDragAt = Date.now();
            const hasReload = typeof helpers.reloadAll === 'function';
            cancelTimelinePlacement({ skipRender: hasReload, keepMenuOpen: true });
            toast(`KD2 block placed on ${lane.battalion_code} / ${lane.unit_label}.`, 'success');
            if (hasReload) await helpers.reloadAll();
            else renderSchedule();
            return true;
        } catch (error) {
            toast(`KD2 placement failed: ${error.message}`, 'error');
            return false;
        }
    }

    async function placePlanBlockFromGanttTrack(track, plannedStart) {
        const lane = timelineLaneFromTrack(track);
        return placePlanBlockOnLane(lane, plannedStart);
    }

    function applyTimelinePreviewWindow(bar, viewStart, viewEnd, totalDays, window) {
        const clippedStart = window.start < viewStart ? viewStart : window.start;
        const clippedEnd = window.end > viewEnd ? viewEnd : window.end;
        const startOffset = Math.max(dayDiff(viewStart, clippedStart), 0);
        const span = Math.max(dayDiff(clippedStart, clippedEnd) + 1, 1);
        bar.style.left = `${(startOffset / totalDays) * 100}%`;
        bar.style.width = `${(span / totalDays) * 100}%`;
    }

    function clearTimelineDropTargets() {
        document.querySelectorAll('.kd2-timeline-track-drop-target').forEach(node => node.classList.remove('kd2-timeline-track-drop-target'));
    }

    async function loadTimelineMoveRows(anchorRow) {
        let rowsToMove = [{
            id: anchorRow.id,
            battalion_id: anchorRow.battalion_id,
            vehicle_type: anchorRow.vehicle_type || anchorRow.vehicle,
            unit_serial: anchorRow.unit_serial,
            unit_label: anchorRow.unit_label || anchorRow.vehicle_no || null,
            route_sequence: anchorRow.route_sequence,
            station_sequence_in_category: anchorRow.station_sequence_in_category,
            station_code: anchorRow.station_code,
            planned_start_date: anchorRow.start_date,
            planned_end_date: anchorRow.end_date,
        }];
        if (!['lane', 'from-block'].includes(state.timelineMoveMode) || !anchorRow.battalion_id || !(anchorRow.vehicle_type || anchorRow.vehicle)) {
            return rowsToMove;
        }
        let query = dbRef
            .from('kd2_plan')
            .select('id, battalion_id, vehicle_type, unit_serial, unit_label, route_sequence, station_sequence_in_category, station_code, planned_start_date, planned_end_date')
            .eq('battalion_id', anchorRow.battalion_id)
            .eq('vehicle_type', anchorRow.vehicle_type || anchorRow.vehicle);
        query = anchorRow.unit_serial === null
            ? query.is('unit_serial', null)
            : query.eq('unit_serial', anchorRow.unit_serial);
        const { data, error } = await query;
        if (error) throw error;
        if (!data?.length) return rowsToMove;
        return state.timelineMoveMode === 'from-block'
            ? getPlanMoveRowsFromAnchor({
                id: anchorRow.id,
                battalion_id: anchorRow.battalion_id,
                vehicle_type: anchorRow.vehicle_type || anchorRow.vehicle,
                unit_serial: anchorRow.unit_serial,
                route_sequence: anchorRow.route_sequence,
                station_sequence_in_category: anchorRow.station_sequence_in_category,
                station_code: anchorRow.station_code,
            }, data)
            : data;
    }

    async function ensureTimelineMoveAllowed(rowsToMove, destinationLane) {
        if (!rowsToMove.length || !destinationLane) return;
        const wrongVehicle = rowsToMove.find(row => (row.vehicle_type || row.vehicle) !== destinationLane.vehicle_type);
        if (wrongVehicle) {
            throw new Error(`Lane move blocked: ${wrongVehicle.station_code} belongs to ${(wrongVehicle.vehicle_type || wrongVehicle.vehicle)} and cannot move to a ${destinationLane.vehicle_type} lane.`);
        }
        const stationCodes = [...new Set(rowsToMove.map(row => row.station_code).filter(Boolean))];
        if (!stationCodes.length) return;

        let query = dbRef
            .from('kd2_plan')
            .select('id, station_code')
            .eq('battalion_id', destinationLane.battalion_id)
            .eq('vehicle_type', destinationLane.vehicle_type)
            .in('station_code', stationCodes);
        query = destinationLane.unit_serial === null
            ? query.is('unit_serial', null)
            : query.eq('unit_serial', destinationLane.unit_serial);
        const excludedIds = rowsToMove.map(row => row.id).filter(Boolean);
        if (excludedIds.length) {
            query = query.not('id', 'in', `(${excludedIds.join(',')})`);
        }
        const { data, error } = await query;
        if (error) throw error;
        if (data?.length) {
            const duplicates = [...new Set(data.map(row => row.station_code).filter(Boolean))];
            throw new Error(`Lane move blocked: ${duplicates.join(', ')} already exists on ${destinationLane.battalion_code} / ${destinationLane.vehicle_type} / ${destinationLane.unit_label}.`);
        }
    }

    async function moveTimelineBlock(anchorRow, deltaDays, destinationLane = null) {
        if (!dbRef) return { laneChanged: false, movedCount: 0 };
        const rowsToMove = await loadTimelineMoveRows(anchorRow);
        const destination = destinationLane || laneDescriptorFromRow(anchorRow, 'unit');
        if (!destination?.battalion_id || !destination?.vehicle_type || !destination?.unit_serial) {
            throw new Error('Destination lane details are incomplete.');
        }
        const unitLaneKey = timelineLaneKey(anchorRow, 'unit');
        const laneChanged = destination.key !== unitLaneKey;
        if (laneChanged) await ensureTimelineMoveAllowed(rowsToMove, destination);

        const rules = planningRulesFor(destination.battalion_id, destination.vehicle_type);
        const changes = rowsToMove.map(row => {
            const window = shiftPlanWindowByCalendarDays(row.planned_start_date, row.planned_end_date, deltaDays, rules);
            return {
                id: row.id,
                stationCode: row.station_code,
                oldBattalionId: row.battalion_id,
                oldVehicleType: row.vehicle_type,
                oldUnitSerial: row.unit_serial,
                oldUnitLabel: row.unit_label || null,
                oldStart: row.planned_start_date,
                oldEnd: row.planned_end_date,
                newBattalionId: destination.battalion_id,
                newVehicleType: destination.vehicle_type,
                newUnitSerial: destination.unit_serial,
                newUnitLabel: destination.unit_label || null,
                newStart: window.start,
                newEnd: window.end,
            };
        });
        await persistTimelineChanges(
            changes,
            state.timelineMoveMode === 'lane'
                ? `timeline-lane:${unitLaneKey}:${destination.key}`
                : state.timelineMoveMode === 'from-block'
                    ? `timeline-from-block:${unitLaneKey}:${anchorRow.id}:${destination.key}`
                    : `timeline-block:${anchorRow.id}:${destination.key}`
        );
        return { laneChanged, movedCount: changes.length };
    }

    function wireTimelineDrag(totalDays, viewStart) {
        if (!state.timelineEditMode) return;
        document.querySelectorAll('.kd2-timeline-track[data-kd2-track]').forEach(track => {
            track.addEventListener('pointerup', async event => {
                if (!state.timelinePlacementActive) return;
                if (event.target.closest('.kd2-timeline-bar')) return;
                const plannedStart = dateFromTrackPointer(track, event.clientX);
                if (!plannedStart) return;
                const lane = timelineLaneFromTrack(track);
                await placePlanBlockOnLane(lane, plannedStart);
            });
        });
        document.querySelectorAll('.kd2-timeline-bar[data-kd2-plan-id]').forEach(bar => {
            bar.addEventListener('pointerdown', event => {
                if (!state.timelineEditMode) return;
                if (!canManageKD2()) {
                    toast('Only planners and admins can edit KD2 plan rows.', 'error');
                    return;
                }
                if (event.target.closest('[data-kd2-select-id]')) return;
                if (state.timelinePlacementActive) return;

                event.preventDefault();
                const planId = parseInt(bar.dataset.kd2PlanId, 10);
                const anchorRow = state.timelineRows.find(row => row.id === planId);
                if (!anchorRow) return;
                const track = bar.closest('.kd2-timeline-track');
                if (!track) return;

                const isResize = event.target.closest('[data-kd2-resize]');
                const resizeEdge = isResize?.dataset.kd2Resize || '';
                const dayWidth = track.getBoundingClientRect().width / Math.max(totalDays, 1);
                const viewEnd = track.dataset.viewEnd || addDays(viewStart, totalDays - 1);
                const startX = event.clientX;
                let deltaDays = 0;
                let activeDropTrack = null;

                const previewIds = resizeEdge
                    ? new Set([anchorRow.id])
                    : state.timelineMoveMode === 'lane'
                        ? new Set(state.timelineRows.filter(row => timelineLaneKey(row, 'unit') === timelineLaneKey(anchorRow, 'unit')).map(row => row.id))
                        : state.timelineMoveMode === 'from-block'
                            ? new Set(getPlanMoveRowsFromAnchor(anchorRow, state.timelineRows).map(row => row.id))
                            : new Set([anchorRow.id]);
                const previewBars = [...document.querySelectorAll('.kd2-timeline-bar[data-kd2-plan-id]')]
                    .filter(item => previewIds.has(parseInt(item.dataset.kd2PlanId, 10)));

                bar.setPointerCapture(event.pointerId);
                previewBars.forEach(item => {
                    item.style.transition = 'none';
                    item.classList.add(resizeEdge ? 'kd2-timeline-bar-resizing' : 'kd2-timeline-bar-dragging');
                });

                const onMove = moveEvent => {
                    if (resizeEdge) {
                        const pointerDate = dateFromTrackPointer(track, moveEvent.clientX);
                        if (!pointerDate) return;
                        const rules = planningRulesFor(anchorRow.battalion_id, anchorRow.vehicle_type || anchorRow.vehicle);
                        const previewWindow = resizeEdge === 'left'
                            ? buildBackwardWindow(anchorRow.end_date, Math.max(durationFromPlannedWindow(pointerDate, anchorRow.end_date, rules), 1), rules)
                            : buildForwardWindow(anchorRow.start_date, Math.max(durationFromPlannedWindow(anchorRow.start_date, pointerDate, rules), 1), rules);
                        applyTimelinePreviewWindow(bar, viewStart, viewEnd, totalDays, previewWindow);
                        return;
                    }

                    const deltaPx = moveEvent.clientX - startX;
                    deltaDays = Math.round(deltaPx / Math.max(dayWidth, 1));
                    previewBars.forEach(item => {
                        item.style.transform = `translateX(${deltaDays * dayWidth}px)`;
                    });
                    clearTimelineDropTargets();
                    if (!canUseLaneTimelineOperations()) {
                        activeDropTrack = null;
                        return;
                    }
                    const dropTrack = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('.kd2-timeline-track[data-kd2-track]');
                    if (dropTrack && dropTrack !== track) {
                        dropTrack.classList.add('kd2-timeline-track-drop-target');
                        activeDropTrack = dropTrack;
                    } else {
                        activeDropTrack = null;
                    }
                };

                const onUp = async upEvent => {
                    try { bar.releasePointerCapture(event.pointerId); } catch { /* noop */ }
                    bar.removeEventListener('pointermove', onMove);
                    bar.removeEventListener('pointerup', onUp);
                    clearTimelineDropTargets();
                    previewBars.forEach(item => {
                        item.style.transform = '';
                        item.style.transition = '';
                        item.classList.remove('kd2-timeline-bar-resizing', 'kd2-timeline-bar-dragging');
                    });
                    if (resizeEdge) {
                        bar.style.left = '';
                        bar.style.width = '';
                        const pointerDate = dateFromTrackPointer(track, upEvent.clientX);
                        if (!pointerDate) return;
                        const rules = planningRulesFor(anchorRow.battalion_id, anchorRow.vehicle_type || anchorRow.vehicle);
                        const window = resizeEdge === 'left'
                            ? buildBackwardWindow(anchorRow.end_date, Math.max(durationFromPlannedWindow(pointerDate, anchorRow.end_date, rules), 1), rules)
                            : buildForwardWindow(anchorRow.start_date, Math.max(durationFromPlannedWindow(anchorRow.start_date, pointerDate, rules), 1), rules);
                        if (window.start === anchorRow.start_date && window.end === anchorRow.end_date) return;
                        state.timelineLastDragAt = Date.now();
                        try {
                            await persistTimelineChanges([{
                                id: anchorRow.id,
                                stationCode: anchorRow.station_code,
                                oldBattalionId: anchorRow.battalion_id,
                                oldVehicleType: anchorRow.vehicle_type || anchorRow.vehicle,
                                oldUnitSerial: anchorRow.unit_serial,
                                oldUnitLabel: anchorRow.unit_label || anchorRow.vehicle_no || null,
                                oldStart: anchorRow.start_date,
                                oldEnd: anchorRow.end_date,
                                newBattalionId: anchorRow.battalion_id,
                                newVehicleType: anchorRow.vehicle_type || anchorRow.vehicle,
                                newUnitSerial: anchorRow.unit_serial,
                                newUnitLabel: anchorRow.unit_label || anchorRow.vehicle_no || null,
                                newStart: window.start,
                                newEnd: window.end,
                            }], `timeline-resize:${anchorRow.id}:${resizeEdge}`);
                            toast('KD2 block resized.', 'success');
                            await helpers.reloadAll?.();
                        } catch (error) {
                            toast(`KD2 resize failed: ${error.message}`, 'error');
                        }
                        return;
                    }

                    if (!deltaDays && !activeDropTrack) return;
                    const destinationLane = activeDropTrack && canUseLaneTimelineOperations()
                        ? timelineLaneFromTrack(activeDropTrack)
                        : laneDescriptorFromRow(anchorRow, 'unit');
                    state.timelineLastDragAt = Date.now();
                    try {
                        const result = await moveTimelineBlock(anchorRow, deltaDays, destinationLane);
                        toast(
                            result.laneChanged
                                ? 'KD2 block moved to a new lane.'
                                : state.timelineMoveMode === 'lane'
                                    ? 'KD2 lane rescheduled.'
                                    : state.timelineMoveMode === 'from-block'
                                        ? 'KD2 downstream lane blocks rescheduled.'
                                        : 'KD2 block rescheduled.',
                            'success'
                        );
                        await helpers.reloadAll?.();
                    } catch (error) {
                        toast(`KD2 reschedule failed: ${error.message}`, 'error');
                    }
                };

                bar.addEventListener('pointermove', onMove);
                bar.addEventListener('pointerup', onUp);
            });
        });
    }

    function renderSchedule(rows = state.timelineRows) {
        if (!isKD2()) return;
        const legend = document.getElementById('kd2TimelineLegend');
        const wrap = document.getElementById('kd2TimelineWrap');
        const startInput = document.getElementById('kd2TimelineStart');
        const endInput = document.getElementById('kd2TimelineEnd');
        if (!legend || !wrap || !startInput || !endInput) return;

        state.timelineRows = Array.isArray(rows) ? rows.slice() : [];
        syncTimelineViewControls(state.timelineRows);
        const viewMode = currentTimelineViewMode();
        const processVehicle = resolveTimelineProcessVehicle(state.timelineRows);
        const processView = viewMode === 'process';
        const timelineRows = state.timelineRows
            .filter(row => row.start_date && row.end_date)
            .filter(row => !processView || (row.vehicle_type || row.vehicle) === processVehicle);
        const laneDefinitions = buildTimelineLaneDefinitions(state.timelineRows, viewMode);
        const canRenderEmptyLanes = laneDefinitions.length > 0;
        if (!timelineRows.length && !canRenderEmptyLanes) {
            legend.innerHTML = '';
            wrap.innerHTML = '<div class="empty-state"><p>Generate or add a KD2 plan block to view the schedule.</p></div>';
            syncTimelineSelectionUi();
            syncTimelinePlacementUi();
            return;
        }

        const naturalStart = timelineRows.length
            ? timelineRows.reduce((min, row) => !min || row.start_date < min ? row.start_date : min, '')
            : (startInput.value || localDateStr(new Date()));
        const naturalEnd = timelineRows.length
            ? timelineRows.reduce((max, row) => !max || row.end_date > max ? row.end_date : max, '')
            : (endInput.value || addDays(naturalStart, 13));
        if (!startInput.value) startInput.value = naturalStart;
        if (!endInput.value) endInput.value = naturalEnd;

        let viewStart = startInput.value || naturalStart;
        let viewEnd = endInput.value || naturalEnd;
        if (viewStart > viewEnd) {
            const temp = viewStart;
            viewStart = viewEnd;
            viewEnd = temp;
            startInput.value = viewStart;
            endInput.value = viewEnd;
        }

        const visibleRows = timelineRows.filter(row => row.end_date >= viewStart && row.start_date <= viewEnd);
        const groups = buildTimelineGroups(visibleRows, viewMode);
        if (!visibleRows.length && !groups.length) {
            legend.innerHTML = '';
            wrap.innerHTML = '<div class="empty-state"><p>No KD2 plan rows fall inside the selected timeline window.</p></div>';
            syncTimelineSelectionUi();
            syncTimelinePlacementUi();
            return;
        }

        const visibleCategories = [...new Set(visibleRows.map(row => row.category).filter(Boolean))];
        const noWorkStatusByDate = getNonWorkDateStatusMap();
        const visibleNoWorkDays = [...noWorkStatusByDate.entries()]
            .filter(([day]) => day >= viewStart && day <= viewEnd)
            .sort((left, right) => left[0].localeCompare(right[0]));
        const hasActiveNoWorkDays = visibleNoWorkDays.some(([, status]) => status === 'active');
        const hasInactiveNoWorkDays = visibleNoWorkDays.some(([, status]) => status === 'inactive');
        legend.innerHTML = visibleCategories.map(category => `
            <span class="kd2-legend-item">
                <span class="kd2-legend-swatch ${categoryClassName(category)}"></span>
                ${escapeHtml(category)}
            </span>
        `).join('') + (hasActiveNoWorkDays ? `
            <span class="kd2-legend-item">
                <span class="kd2-legend-swatch kd2-legend-offday"></span>
                No-work Day
            </span>
        ` : '') + (hasInactiveNoWorkDays ? `
            <span class="kd2-legend-item">
                <span class="kd2-legend-swatch kd2-legend-offday-inactive"></span>
                Inactive no-work Day
            </span>
        ` : '');

        const totalDays = Math.max(dayDiff(viewStart, viewEnd) + 1, 1);
        const days = [];
        for (let i = 0; i < totalDays; i += 1) {
            const day = addDays(viewStart, i);
            const dayClasses = ['kd2-timeline-day'];
            if (parseDateLocal(day).getDay() === 5) dayClasses.push('kd2-timeline-day-friday');
            const noWorkStatus = noWorkStatusByDate.get(day) || '';
            if (noWorkStatus === 'active') dayClasses.push('kd2-timeline-day-off');
            else if (noWorkStatus === 'inactive') dayClasses.push('kd2-timeline-day-off-inactive');
            days.push(`<div class="${dayClasses.join(' ')}"><strong>${escapeHtml(day.slice(8))}</strong>${escapeHtml(day.slice(5, 7))}</div>`);
        }
        wrap.innerHTML = `
            <div class="kd2-timeline-head" style="grid-template-columns: 240px repeat(${totalDays}, minmax(44px, 1fr));">
                <div class="kd2-timeline-corner">${escapeHtml(processView ? `Process / ${processVehicle} Route` : 'Battalion / Unit')}</div>
                ${days.join('')}
            </div>
            ${groups.map(group => {
                const laneRows = state.timelineRows.filter(row => timelineLaneKey(row, viewMode, processVehicle) === group.key);
                const zoneHtml = visibleNoWorkDays.map(([day, status]) => {
                    const startOffset = Math.max(dayDiff(viewStart, day), 0);
                    const zoneClass = status === 'inactive'
                        ? 'kd2-timeline-track-zone kd2-timeline-track-zone-inactive'
                        : 'kd2-timeline-track-zone';
                    const zoneTitle = status === 'inactive'
                        ? `${day} · Inactive no-work day`
                        : `${day} · No-work day`;
                    return `<div class="${zoneClass}" style="left:${(startOffset / totalDays) * 100}%;width:${(1 / totalDays) * 100}%;" title="${escapeHtml(zoneTitle)}"></div>`;
                }).join('');
                const laneSelected = canUseLaneTimelineOperations() && laneRows.length > 0 && laneRows.every(row => state.timelineSelectedIds.has(row.id));
                const packedBars = buildTimelinePackedBars(group.rows, viewStart, viewEnd, viewMode);
                const stackCount = packedBars.length ? Math.max(...packedBars.map(item => item.stackLane)) + 1 : 1;
                const rowHeight = Math.max(52, 18 + stackCount * 38);
                const metaText = processView
                    ? `${group.meta} · ${group.rows.length} visible block${group.rows.length === 1 ? '' : 's'}`
                    : group.meta;
                const bars = packedBars.map(({ row, clippedStart, clippedEnd, stackLane }) => {
                    const startOffset = Math.max(dayDiff(viewStart, clippedStart), 0);
                    const span = Math.max(dayDiff(clippedStart, clippedEnd) + 1, 1);
                    const left = `${(startOffset / totalDays) * 100}%`;
                    const width = `${(span / totalDays) * 100}%`;
                    const barTitle = processView
                        ? [row.battalion_code || '—', row.vehicle_no || row.unit_label || '—'].join(' · ')
                        : [row.work_center, row.process_station || row.station_name || row.category || 'Block'].filter(Boolean).join(' · ');
                    const tooltip = processView
                        ? `${group.label} | ${row.work_center || row.station_code || 'No work center'} | ${row.battalion_code || '—'} / ${row.vehicle_no || row.unit_label || '—'} | ${row.start_date} -> ${row.end_date}`
                        : `${group.label} | ${row.work_center || row.station_code || 'No work center'} | ${row.process_station} | ${row.start_date} -> ${row.end_date}`;
                    return `
                        <button
                            type="button"
                            class="kd2-timeline-bar ${categoryClassName(row.category)}${state.timelineSelectedIds.has(row.id) ? ' kd2-timeline-bar-selected' : ''}"
                            data-kd2-plan-id="${row.id}"
                            data-kd2-lane-key="${escapeHtml(group.key)}"
                            style="left:${left};width:${width};top:${9 + (stackLane * 38)}px;"
                            title="${escapeHtml(tooltip)}">
                            ${state.timelineEditMode ? `<span class="kd2-timeline-select${state.timelineSelectedIds.has(row.id) ? ' kd2-timeline-select-active' : ''}" data-kd2-select-id="${row.id}" aria-pressed="${state.timelineSelectedIds.has(row.id) ? 'true' : 'false'}"></span>` : ''}
                            ${state.timelineEditMode ? '<span class="kd2-timeline-resize kd2-timeline-resize-left" data-kd2-resize="left"></span>' : ''}
                            <span class="kd2-timeline-bar-title">${escapeHtml(barTitle)}</span>
                            ${state.timelineEditMode ? '<span class="kd2-timeline-resize kd2-timeline-resize-right" data-kd2-resize="right"></span>' : ''}
                        </button>
                    `;
                }).join('');
                const emptyLane = !bars ? '<div class="kd2-timeline-empty-lane">No blocks in view for this lane.</div>' : '';

                return `
                    <div class="kd2-timeline-row${processView ? ' kd2-timeline-row-process' : ''}" style="grid-template-columns: 240px repeat(${totalDays}, minmax(44px, 1fr));min-height:${rowHeight}px;">
                        <div class="kd2-timeline-label">
                            <div class="kd2-timeline-label-copy">
                                <strong>${escapeHtml(group.label)}</strong>
                                <span>${escapeHtml(metaText)}</span>
                            </div>
                            ${state.timelineEditMode && state.timelineSelectLaneMode && canUseLaneTimelineOperations() ? `<button type="button" class="kd2-timeline-lane-action" data-kd2-lane-select="${escapeHtml(group.key)}">${laneSelected ? 'Clear lane' : 'Select lane'}</button>` : ''}
                        </div>
                        <div
                            class="kd2-timeline-track${state.timelineEditMode ? ' kd2-timeline-edit-active' : ''}${state.timelinePlacementActive ? ' kd2-timeline-track-placement' : ''}"
                            style="grid-column: 2 / span ${totalDays};min-height:${rowHeight}px;"
                            data-total-days="${totalDays}"
                            data-view-start="${escapeHtml(viewStart)}"
                            data-view-end="${escapeHtml(viewEnd)}"
                            data-kd2-track="true"
                            data-kd2-lane-key="${escapeHtml(group.key)}"
                            data-kd2-view-mode="${escapeHtml(viewMode)}"
                            data-battalion-id="${escapeHtml(group.lane?.battalion_id ?? '')}"
                            data-battalion-code="${escapeHtml(group.lane?.battalion_code || '')}"
                            data-vehicle-type="${escapeHtml(group.lane?.vehicle_type || '')}"
                            data-unit-serial="${escapeHtml(group.lane?.unit_serial ?? '')}"
                            data-unit-label="${escapeHtml(group.lane?.unit_label || '')}"
                            data-station-code="${escapeHtml(group.lane?.station_code || '')}"
                            data-station-name="${escapeHtml(group.lane?.station_name || '')}">
                            ${zoneHtml}
                            ${bars}
                            ${emptyLane}
                        </div>
                    </div>
                `;
            }).join('')}
        `;

        wrap.querySelectorAll('[data-kd2-select-id]').forEach(btn => {
            btn.addEventListener('click', event => {
                event.stopPropagation();
                const id = parseInt(btn.dataset.kd2SelectId, 10);
                if (state.timelineSelectedIds.has(id)) state.timelineSelectedIds.delete(id);
                else state.timelineSelectedIds.add(id);
                syncTimelineSelectionUi();
            });
        });
        wrap.querySelectorAll('[data-kd2-lane-select]').forEach(btn => {
            btn.addEventListener('click', () => {
                const group = groups.find(item => item.key === btn.dataset.kd2LaneSelect);
                if (!group) return;
                const laneRows = state.timelineRows.filter(row => timelineLaneKey(row, viewMode, processVehicle) === group.key);
                const laneSelected = laneRows.length > 0 && laneRows.every(row => state.timelineSelectedIds.has(row.id));
                laneRows.forEach(row => {
                    if (laneSelected) state.timelineSelectedIds.delete(row.id);
                    else state.timelineSelectedIds.add(row.id);
                });
                renderSchedule();
            });
        });
        wrap.querySelectorAll('[data-kd2-plan-id]').forEach(btn => {
            btn.addEventListener('click', event => {
                if (state.timelinePlacementActive) return;
                if (event.target.closest('[data-kd2-select-id]')) return;
                if (event.target.closest('[data-kd2-resize]')) return;
                if (Date.now() - state.timelineLastDragAt < 400) return;
                openPlanEdit(parseInt(btn.dataset.kd2PlanId, 10));
            });
        });
        wireTimelineDrag(totalDays, viewStart);
        syncTimelineSelectionUi();
        syncTimelinePlacementUi();
    }

    function openPlanEdit(planId) {
        if (!canManageKD2()) {
            toast('Only planners and admins can edit KD2 plan rows.', 'error');
            return;
        }
        const row = state.timelineRows.find(item => item.id === planId);
        if (!row) {
            toast('Selected KD2 plan row is not loaded in the current view.', 'error');
            return;
        }

        closeOpenBarMenus();
        movePlanEditOverlayToActiveHost();
        document.getElementById('kd2PlanEditId').value = String(row.id);
        document.getElementById('kd2PlanEditInfo').textContent = `${row.battalion_code || '—'} · ${row.vehicle || '—'} · ${row.vehicle_no || '—'} · ${row.process_station || row.station_name || 'Plan block'}`;
        document.getElementById('kd2PlanEditStart').value = row.start_date || '';
        document.getElementById('kd2PlanEditEnd').value = row.end_date || '';
        document.getElementById('kd2PlanEditRemark').value = row.remark || '';
        setPlanEditError('');
        document.getElementById('kd2PlanEditOverlay').style.display = 'flex';
    }

    function setNoWorkError(message) {
        const el = document.getElementById('kd2NoWorkError');
        if (!el) return;
        el.textContent = message;
        el.style.display = message ? 'flex' : 'none';
    }

    function resetNoWorkForm() {
        const idsInput = document.getElementById('kd2NoWorkIds');
        const startInput = document.getElementById('kd2NoWorkStart');
        const endInput = document.getElementById('kd2NoWorkEnd');
        const labelInput = document.getElementById('kd2NoWorkLabel');
        const saveBtn = document.getElementById('btnKd2NoWorkAdd');
        const cancelBtn = document.getElementById('btnKd2NoWorkCancelEdit');
        const activeInput = document.getElementById('kd2NoWorkActive');
        if (idsInput) idsInput.value = '';
        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
        if (labelInput) labelInput.value = '';
        if (activeInput) activeInput.checked = true;
        if (saveBtn) saveBtn.textContent = 'Add Range';
        if (cancelBtn) cancelBtn.style.display = 'none';
    }

    function startNoWorkEdit(startDateStr) {
        const group = getNonWorkDayGroupByStart(startDateStr);
        if (!group) return;
        const idsInput = document.getElementById('kd2NoWorkIds');
        const startInput = document.getElementById('kd2NoWorkStart');
        const endInput = document.getElementById('kd2NoWorkEnd');
        const labelInput = document.getElementById('kd2NoWorkLabel');
        const activeInput = document.getElementById('kd2NoWorkActive');
        const saveBtn = document.getElementById('btnKd2NoWorkAdd');
        const cancelBtn = document.getElementById('btnKd2NoWorkCancelEdit');
        if (idsInput) idsInput.value = group.rows.map(row => row.id).join(',');
        if (startInput) startInput.value = group.start || '';
        if (endInput) endInput.value = group.end || group.start || '';
        if (labelInput) labelInput.value = group.label || '';
        if (activeInput) activeInput.checked = group.is_active !== false;
        if (saveBtn) saveBtn.textContent = 'Save Changes';
        if (cancelBtn) cancelBtn.style.display = '';
    }

    function renderNoWorkDays() {
        const list = document.getElementById('kd2NoWorkList');
        if (!list) return;
        const groups = getNonWorkDayGroups();
        if (!groups.length) {
            list.innerHTML = '<div class="empty-state"><p>No KD2 no-work days are stored yet.</p></div>';
            return;
        }
        list.innerHTML = groups.map(group => {
            const active = group.is_active !== false;
            return `
            <div class="kd2-no-work-item${active ? '' : ' is-inactive'}">
                <div class="kd2-no-work-copy">
                    <strong>${escapeHtml(formatNoWorkRange(group.start, group.end))}</strong>
                    <span>${escapeHtml(group.label || 'No label')}</span>
                    <span class="status-pill ${active ? 'active' : 'inactive'}">${active ? 'Active' : 'Inactive'}</span>
                </div>
                <div class="kd2-no-work-actions">
                    <button type="button" class="btn btn-ghost btn-sm" data-kd2-no-work-toggle="${group.start}" data-next-active="${active ? 'false' : 'true'}">${active ? 'Deactivate' : 'Activate'}</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-kd2-no-work-edit="${group.start}">Edit</button>
                    <button type="button" class="btn btn-ghost btn-kd2-danger btn-sm" data-kd2-no-work-delete="${group.start}">Delete</button>
                </div>
            </div>
        `;
        }).join('');
        list.querySelectorAll('[data-kd2-no-work-toggle]').forEach(btn => {
            btn.addEventListener('click', () => toggleNoWorkDayActive(btn.dataset.kd2NoWorkToggle, btn.dataset.nextActive === 'true'));
        });
        list.querySelectorAll('[data-kd2-no-work-edit]').forEach(btn => {
            btn.addEventListener('click', () => startNoWorkEdit(btn.dataset.kd2NoWorkEdit));
        });
        list.querySelectorAll('[data-kd2-no-work-delete]').forEach(btn => {
            btn.addEventListener('click', () => deleteNoWorkDay(btn.dataset.kd2NoWorkDelete));
        });
    }

    function closeNoWorkModal() {
        document.getElementById('kd2NoWorkOverlay').style.display = 'none';
        setNoWorkError('');
        resetNoWorkForm();
    }

    function openNoWorkModal() {
        if (!canManageKD2()) {
            toast('Only planners and admins can manage KD2 no-work days.', 'error');
            return;
        }
        setNoWorkError('');
        resetNoWorkForm();
        renderNoWorkDays();
        document.getElementById('kd2NoWorkOverlay').style.display = 'flex';
    }

    async function addNoWorkDay() {
        if (!dbRef) return;
        const editingIds = parseNoWorkEditingIds();
        const editingIdSet = new Set(editingIds);
        const startDate = document.getElementById('kd2NoWorkStart')?.value;
        const endDate = document.getElementById('kd2NoWorkEnd')?.value || startDate;
        const label = normalizeNoWorkLabel(document.getElementById('kd2NoWorkLabel')?.value);
        if (!startDate) {
            setNoWorkError('Choose a start date to save.');
            return;
        }
        if (!endDate) {
            setNoWorkError('Choose an end date to save.');
            return;
        }
        if (endDate < startDate) {
            setNoWorkError('End date must be the same as or after the start date.');
            return;
        }
        const requestedDates = buildDateRange(startDate, endDate);
        if (!requestedDates.length) {
            setNoWorkError('The selected date range produced no valid dates. Check your start and end dates.');
            return;
        }
        try {
            const existingRows = editingIds.length
                ? state.nonWorkDays.filter(row => editingIdSet.has(row.id))
                : [];
            if (editingIds.length && existingRows.length !== editingIds.length) {
                setNoWorkError('The selected no-work range could not be found. Refresh the page and try again.');
                return;
            }
            const requestedDateSet = new Set(requestedDates);
            const duplicate = state.nonWorkDays.find(row => requestedDateSet.has(row.off_date) && !editingIdSet.has(row.id)) || null;
            if (duplicate) {
                setNoWorkError(`${formatDate(duplicate.off_date)} is already a no-work day. Edit the existing range or choose different dates.`);
                return;
            }
            const previousOffDates = new Set(state.nonWorkDaySet);
            const nextOffDates = new Set(previousOffDates);
            existingRows.forEach(row => nextOffDates.delete(row.off_date));
            requestedDates.forEach(date => nextOffDates.add(date));
        const isActive = document.getElementById('kd2NoWorkActive')?.checked !== false;
            const payload = requestedDates.map(offDate => ({
                module_id: NON_WORK_MODULE_ID,
                off_date: offDate,
                label,
                is_active: isActive,
            }));
            const query = dbRef.from('planning_non_work_days');
            const { data, error } = editingIds.length
                ? await query.upsert(payload, { onConflict: 'module_id,off_date' }).select('*')
                : await query.insert(payload).select('*');
            if (error) throw error;
            if (editingIds.length) {
                const staleIds = existingRows
                    .filter(row => !requestedDateSet.has(row.off_date))
                    .map(row => row.id)
                    .filter(Number.isFinite);
                if (staleIds.length) {
                    const { error: deleteError } = await dbRef
                        .from('planning_non_work_days')
                        .delete()
                        .in('id', staleIds)
                        .eq('module_id', NON_WORK_MODULE_ID);
                    if (deleteError) throw deleteError;
                }
            }
            await writeAudit(
                editingIds.length ? 'UPDATE' : 'INSERT',
                'planning_non_work_days',
                makeNoWorkAuditRecordId(requestedDates),
                existingRows,
                data
            );
            resetNoWorkForm();
            await refreshWorkspace();
            renderNoWorkDays();
            updatePlanCreateEndFromDuration();
            let rescheduledCount = 0;
            let scheduleError = null;
            if (isActive) {
                try {
                    const addedOffDates = new Set(requestedDates);
                    const remainingOld = new Set([...previousOffDates]);
                    existingRows.forEach(r => remainingOld.delete(r.off_date));
                    rescheduledCount = await applyTargetedNoWorkReschedule(addedOffDates, remainingOld);
                } catch (err) {
                    scheduleError = err;
                    console.warn('KD2 no-work day targeted reschedule failed:', err.message);
                }
            } else if (editingIds.length) {
                // Editing existing active range → now inactive: revert any shifts from those dates
                const removedDates = new Set(existingRows.map(r => r.off_date).filter(d => previousOffDates.has(d)));
                if (removedDates.size) {
                    try {
                        const remainingActive = new Set(state.nonWorkDaySet);
                        rescheduledCount = await revertTargetedNoWorkReschedule(removedDates, remainingActive);
                    } catch (err) {
                        scheduleError = err;
                        console.warn('KD2 no-work day revert failed:', err.message);
                    }
                }
            }
            await helpers.reloadAll?.();
            const baseMessage = editingIds.length ? 'KD2 no-work range updated.' : 'KD2 no-work range saved.';
            if (scheduleError) {
                toast(`${baseMessage} Rescheduling failed: ${scheduleError.message}`, 'warn');
            } else {
                toast(rescheduledCount ? `${baseMessage} ${rescheduledCount} plan block(s) rescheduled.` : baseMessage, 'success');
            }
        } catch (error) {
            setNoWorkError(error.message);
            await refreshWorkspace();
            renderNoWorkDays();
            await helpers.reloadAll?.();
        }
    }

    async function deleteNoWorkDay(startDateStr) {
        if (!dbRef || !startDateStr) return;
        const group = getNonWorkDayGroupByStart(startDateStr);
        if (!group?.rows?.length) return;
        const ids = group.rows.map(row => row.id).filter(Number.isFinite);
        const before = group.rows.slice();
        try {
            const previousOffDates = new Set(state.nonWorkDaySet);
            const { error } = await dbRef
                .from('planning_non_work_days')
                .delete()
                .in('id', ids)
                .eq('module_id', NON_WORK_MODULE_ID);
            if (error) throw error;
            await writeAudit('DELETE', 'planning_non_work_days', makeNoWorkAuditRecordId(before.map(row => row.off_date)), before, null);
            const nextOffDates = new Set(previousOffDates);
            before.forEach(row => nextOffDates.delete(row.off_date));
            const rescheduledCount = !noWorkDateSetsEqual(previousOffDates, nextOffDates)
                ? await recalculatePlanWindowsForNonWorkDayChange(previousOffDates, nextOffDates, `kd2-non-work-delete:${group.start}`)
                : 0;
            if (parseNoWorkEditingIds().some(id => ids.includes(id))) resetNoWorkForm();
            await refreshWorkspace();
            renderNoWorkDays();
            updatePlanCreateEndFromDuration();
            toast(rescheduledCount ? `KD2 no-work range deleted. ${rescheduledCount} plan block(s) recalculated.` : 'KD2 no-work range deleted.', 'success');
            await helpers.reloadAll?.();
        } catch (error) {
            setNoWorkError(error.message);
        }
    }

    async function toggleNoWorkDayActive(startDateStr, nextActive) {
        if (!dbRef || !startDateStr) return;
        const group = getNonWorkDayGroupByStart(startDateStr);
        if (!group?.rows?.length) return;
        const ids = group.rows.map(row => row.id).filter(Number.isFinite);
        const groupOffDates = new Set(group.rows.map(row => row.off_date));
        try {
            const { error } = await dbRef
                .from('planning_non_work_days')
                .update({ is_active: !!nextActive })
                .in('id', ids)
                .eq('module_id', NON_WORK_MODULE_ID);
            if (error) throw error;
            const previousActiveOffDates = new Set(
                state.nonWorkDays.filter(row => row.is_active === true).map(row => row.off_date)
            );
            await refreshWorkspace();
            renderNoWorkDays();
            const currentActiveOffDates = new Set(
                state.nonWorkDays.filter(row => row.is_active === true).map(row => row.off_date)
            );
            let rescheduled = 0;
            if (nextActive) {
                const addedDates = new Set([...groupOffDates].filter(d => !previousActiveOffDates.has(d)));
                if (addedDates.size) rescheduled = await applyTargetedNoWorkReschedule(addedDates, previousActiveOffDates);
            } else {
                const removedDates = new Set([...groupOffDates].filter(d => previousActiveOffDates.has(d)));
                if (removedDates.size) rescheduled = await revertTargetedNoWorkReschedule(removedDates, currentActiveOffDates);
            }
            await helpers.reloadAll?.();
            toast(rescheduled
                ? `No-work day ${nextActive ? 'activated' : 'deactivated'}. ${rescheduled} plan block(s) updated.`
                : `No-work day ${nextActive ? 'activated' : 'deactivated'}.`,
                'success'
            );
        } catch (error) {
            setNoWorkError(error.message);
        }
    }

    function setKd2ImportError(message) {
        const el = document.getElementById('kd2ImportError');
        if (!el) return;
        el.textContent = message;
        el.style.display = message ? 'flex' : 'none';
    }

    function setKd2ImportSummary(message) {
        const el = document.getElementById('kd2ImportSummary');
        if (!el) return;
        el.textContent = message;
        el.style.display = message ? 'block' : 'none';
    }

    function setKd2ImportErrors(items = []) {
        const el = document.getElementById('kd2ImportErrors');
        if (!el) return;
        if (!items.length) {
            el.style.display = 'none';
            el.textContent = '';
            return;
        }
        el.textContent = items.join('\n');
        el.style.display = 'block';
    }

    function openKd2ImportPanel() {
        document.getElementById('kd2ImportPanel').style.display = 'block';
        setKd2ImportError('');
        setKd2ImportSummary('Upload one CSV or Excel file. Generated templates read the "Data" sheet; generic Excel uploads still use the first sheet when "Data" is absent.');
        setKd2ImportErrors([]);
    }

    function closeKd2ImportPanel() {
        document.getElementById('kd2ImportPanel').style.display = 'none';
        const fileInput = document.getElementById('kd2ImportFile');
        if (fileInput) fileInput.value = '';
        setKd2ImportError('');
        setKd2ImportSummary('');
        setKd2ImportErrors([]);
    }

    function normalizeImportDateValue(value) {
        if (!value && value !== 0) return '';
        if (value instanceof Date && !Number.isNaN(value.valueOf())) return localDateStr(value);
        if (typeof value === 'number' && window.XLSX?.SSF?.parse_date_code) {
            const parsed = window.XLSX.SSF.parse_date_code(value);
            if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
        }
        const trimmed = String(value).trim();
        if (!trimmed) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
        const parsed = new Date(trimmed);
        return Number.isNaN(parsed.valueOf()) ? '' : localDateStr(parsed);
    }

    function buildImportKey(row) {
        return [row.battalion_id, row.vehicle_type, row.unit_serial, row.station_code].join('||');
    }

    function templateExampleRow() {
        const battalion = state.battalions[0];
        const station = state.stations.find(row => row.vehicle_type === 'K9') || state.stations[0];
        const category = station
            ? state.categories.find(row => row.vehicle_type === station.vehicle_type && row.category_code === station.category_code)
            : null;
        return {
            battalion_code: battalion?.battalion_code || 'BTL-01',
            vehicle_type: station?.vehicle_type || 'K9',
            unit_serial: 1,
            unit_label: station?.vehicle_type ? `${station.vehicle_type}-01` : 'K9-01',
            category_code: category?.category_code || station?.category_code || 'welding',
            station_code: station?.station_code || 'k9_station_code',
            planned_start_date: localDateStr(new Date()),
            duration_working_days: 2,
            remark: 'Example row',
        };
    }

    function kd2TemplateInstructionRows() {
        return [
            ['KD2 Import Template'],
            ['Use the "Data" sheet for importable rows. Keep the header row exactly as delivered.'],
            [],
            ['Field', 'Required', 'Description'],
            ['battalion_code', 'Yes', 'Existing KD2 battalion code in Supabase.'],
            ['vehicle_type', 'Yes', 'Vehicle family. Allowed values: K9, K10, K11.'],
            ['unit_serial', 'Yes', 'Positive integer that identifies the unit inside the battalion and vehicle.'],
            ['unit_label', 'No', 'Optional display label for the unit.'],
            ['category_code', 'Yes', 'KD2 process category code already configured for the selected vehicle.'],
            ['station_code', 'Yes', 'KD2 station code already configured for the selected vehicle.'],
            ['planned_start_date', 'Yes', 'Enter YYYY-MM-DD. If the date lands on a KD2 no-work day or other off-day rule, import shifts it forward to the next valid working day.'],
            ['duration_working_days', 'Yes', 'Whole working-day duration. The system calculates planned_end_date from KD2 working-day rules and saved no-work days.'],
            ['remark', 'No', 'Optional planner note stored on the imported plan block.'],
            [],
            ['Import Rules'],
            ['1', 'Upload the "Data" sheet from this template, or any sheet that uses the same column headers.'],
            ['2', 'Generated templates are read from the "Data" sheet automatically. Generic uploads still default to the first sheet when "Data" is absent.'],
            ['3', 'Rows are matched by battalion_code + vehicle_type + unit_serial + station_code. Existing rows are updated; missing rows are inserted.'],
            ['4', 'Leave blank rows out. One row represents one KD2 plan block.'],
        ];
    }

    function downloadKd2Template() {
        if (typeof window.XLSX === 'undefined') {
            toast('SheetJS is not loaded yet.', 'error');
            return;
        }
        const example = templateExampleRow();
        const instructionsSheet = window.XLSX.utils.aoa_to_sheet(kd2TemplateInstructionRows());
        instructionsSheet['!cols'] = [
            { wch: 24 },
            { wch: 12 },
            { wch: 96 },
        ];
        const dataSheet = window.XLSX.utils.aoa_to_sheet([
            KD2_IMPORT_COLUMNS,
            KD2_IMPORT_COLUMNS.map(column => example[column] ?? ''),
        ]);
        dataSheet['!cols'] = KD2_IMPORT_COLUMNS.map(column => ({ wch: Math.max(column.length + 2, 18) }));
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, instructionsSheet, 'Instructions');
        window.XLSX.utils.book_append_sheet(wb, dataSheet, 'Data');
        window.XLSX.writeFile(wb, `KD2_plan_template_${localDateStr(new Date())}.xlsx`);
    }

    function readKd2ImportRows(matrix) {
        const rows = [];
        if (!matrix.length) return rows;
        const headerMap = matrix[0].map(value => String(value ?? '').trim().toLowerCase());
        const missingColumns = KD2_IMPORT_REQUIRED_COLUMNS.filter(column => !headerMap.includes(column));
        if (missingColumns.length) {
            throw new Error(`Missing required columns: ${missingColumns.join(', ')}`);
        }
        for (let i = 1; i < matrix.length; i += 1) {
            const rawRow = matrix[i];
            const rowObj = {};
            KD2_IMPORT_COLUMNS.forEach(column => {
                const index = headerMap.indexOf(column);
                rowObj[column] = index >= 0 ? rawRow[index] : '';
            });
            if (String(rowObj.battalion_code || '').trim().toLowerCase().startsWith('instructions:')) continue;
            const isBlank = KD2_IMPORT_COLUMNS.every(column => String(rowObj[column] ?? '').trim() === '');
            if (isBlank) continue;
            rows.push({ sheetRow: i + 1, ...rowObj });
        }
        return rows;
    }

    async function importKd2PlanFile() {
        if (!dbRef) return;
        if (!canUploadKD2Plan()) {
            toast('Only planners and master admins can import KD2 plans.', 'error');
            return;
        }
        const file = document.getElementById('kd2ImportFile')?.files?.[0];
        if (!file) {
            setKd2ImportError('Choose a CSV or Excel file first.');
            return;
        }
        if (typeof window.XLSX === 'undefined') {
            setKd2ImportError('SheetJS is not loaded yet.');
            return;
        }
        setKd2ImportError('');
        setKd2ImportErrors([]);
        setKd2ImportSummary('Reading file...');
        try {
            await loadWorkspaceData();
            const buffer = await file.arrayBuffer();
            const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true });
            const sheetName = workbook.SheetNames.includes('Data') ? 'Data' : workbook.SheetNames[0];
            const importSheet = workbook.Sheets[sheetName];
            const matrix = window.XLSX.utils.sheet_to_json(importSheet, { header: 1, raw: true, defval: '' });
            const importRows = readKd2ImportRows(matrix);
            if (!importRows.length) throw new Error('No import rows were found in the uploaded file.');

            const battalionByCode = new Map(state.battalions.map(row => [String(row.battalion_code || '').toUpperCase(), row]));
            const categoryByKey = new Map(state.categories.map(row => [`${row.vehicle_type}||${row.category_code}`.toUpperCase(), row]));
            const stationByKey = new Map(state.stations.map(row => [`${row.vehicle_type}||${row.station_code}`.toUpperCase(), row]));
            const errors = [];
            const payloads = [];

            importRows.forEach(row => {
                const battalionCode = String(row.battalion_code || '').trim().toUpperCase();
                const vehicleType = String(row.vehicle_type || '').trim().toUpperCase();
                const categoryCode = String(row.category_code || '').trim();
                const stationCode = String(row.station_code || '').trim();
                const unitSerial = parseInt(String(row.unit_serial || '').trim(), 10);
                const duration = parseInt(String(row.duration_working_days || '').trim(), 10);
                const plannedStart = normalizeImportDateValue(row.planned_start_date);
                const battalion = battalionByCode.get(battalionCode);
                const category = categoryByKey.get(`${vehicleType}||${categoryCode}`.toUpperCase());
                const station = stationByKey.get(`${vehicleType}||${stationCode}`.toUpperCase());
                if (!battalion) errors.push(`Row ${row.sheetRow}: unknown battalion_code "${row.battalion_code}".`);
                if (!VEHICLES.includes(vehicleType)) errors.push(`Row ${row.sheetRow}: vehicle_type must be K9, K10, or K11.`);
                if (!Number.isFinite(unitSerial) || unitSerial < 1) errors.push(`Row ${row.sheetRow}: unit_serial must be a positive integer.`);
                if (!category) errors.push(`Row ${row.sheetRow}: unknown category_code "${row.category_code}" for ${vehicleType || 'vehicle'}.`);
                if (!station) errors.push(`Row ${row.sheetRow}: unknown station_code "${row.station_code}" for ${vehicleType || 'vehicle'}.`);
                if (category && station && category.category_code !== station.category_code) {
                    errors.push(`Row ${row.sheetRow}: station_code "${row.station_code}" does not belong to category_code "${row.category_code}".`);
                }
                if (!plannedStart) errors.push(`Row ${row.sheetRow}: planned_start_date is invalid.`);
                if (!Number.isFinite(duration) || duration < 1) errors.push(`Row ${row.sheetRow}: duration_working_days must be a positive integer.`);
                if (battalion && VEHICLES.includes(vehicleType) && Number.isFinite(unitSerial) && unitSerial > 0 && station && plannedStart && Number.isFinite(duration) && duration > 0) {
                    const rules = planningRulesFor(battalion.id, vehicleType);
                    const window = buildForwardWindow(plannedStart, duration, rules);
                    payloads.push({
                        battalion_id: battalion.id,
                        vehicle_type: vehicleType,
                        unit_serial: unitSerial,
                        unit_label: String(row.unit_label || '').trim() || null,
                        category_code: station.category_code,
                        station_code: station.station_code,
                        category_sequence: category?.category_sequence || 1,
                        station_sequence_in_category: station.station_sequence_in_category,
                        route_sequence: station.route_sequence,
                        schedule_week: weekLabel(window.start),
                        planned_start_date: window.start,
                        planned_end_date: window.end,
                        planning_source: 'import',
                        remark: String(row.remark || '').trim() || null,
                    });
                }
            });

            if (errors.length) {
                setKd2ImportSummary(`Import rejected. ${errors.length} row issue(s) were found.`);
                setKd2ImportErrors(errors);
                return;
            }

            const battalionIds = [...new Set(payloads.map(row => row.battalion_id))];
            const existingRows = battalionIds.length
                ? await queryAll(dbRef.from('kd2_plan').select('*').in('battalion_id', battalionIds))
                : [];
            const beforeMap = new Map(existingRows.map(row => [buildImportKey(row), row]));
            const upsertedRows = [];
            for (const batch of chunk(payloads, 200)) {
                const { data, error } = await dbRef
                    .from('kd2_plan')
                    .upsert(batch, { onConflict: 'battalion_id,vehicle_type,unit_serial,station_code' })
                    .select('*');
                if (error) throw error;
                upsertedRows.push(...(data || []));
            }

            const inserted = upsertedRows.filter(row => !beforeMap.has(buildImportKey(row)));
            const updated = upsertedRows.filter(row => beforeMap.has(buildImportKey(row)));
            if (inserted.length) {
                await writeAudit('INSERT', 'kd2_plan', 'kd2-import-insert', null, inserted);
            }
            if (updated.length) {
                await writeAudit(
                    'UPDATE',
                    'kd2_plan',
                    'kd2-import-update',
                    updated.map(row => beforeMap.get(buildImportKey(row))),
                    updated
                );
            }

            setKd2ImportSummary(`Imported ${upsertedRows.length} row(s): ${inserted.length} inserted, ${updated.length} updated.`);
            setKd2ImportErrors([]);
            toast(`KD2 import completed: ${upsertedRows.length} row(s).`, 'success');
            await helpers.reloadAll?.();
        } catch (error) {
            setKd2ImportError(error.message);
        }
    }

    function setPlanCreateError(message) {
        const el = document.getElementById('kd2PlanCreateError');
        if (!el) return;
        el.textContent = message;
        el.style.display = message ? 'flex' : 'none';
    }

    function movePlanCreateOverlayToActiveHost() {
        const overlay = document.getElementById('kd2PlanCreateOverlay');
        if (!overlay) return;
        if (!planCreateOverlayHome && overlay.parentNode) {
            planCreateOverlayHome = {
                parent: overlay.parentNode,
                nextSibling: overlay.nextSibling,
            };
        }
        const host = document.fullscreenElement || planCreateOverlayHome?.parent || document.body;
        if (overlay.parentNode !== host) host.appendChild(overlay);
    }

    function movePlanEditOverlayToActiveHost() {
        const overlay = document.getElementById('kd2PlanEditOverlay');
        if (!overlay) return;
        if (!planEditOverlayHome && overlay.parentNode) {
            planEditOverlayHome = {
                parent: overlay.parentNode,
                nextSibling: overlay.nextSibling,
            };
        }
        const host = document.fullscreenElement || planEditOverlayHome?.parent || document.body;
        if (overlay.parentNode !== host) host.appendChild(overlay);
    }

    function moveProcessOverlayToActiveHost() {
        const overlay = document.getElementById('kd2ProcessOverlay');
        if (!overlay) return;
        if (!processOverlayHome && overlay.parentNode) {
            processOverlayHome = {
                parent: overlay.parentNode,
                nextSibling: overlay.nextSibling,
            };
        }
        const host = document.fullscreenElement || processOverlayHome?.parent || document.body;
        if (overlay.parentNode !== host) host.appendChild(overlay);
    }

    function restorePlanCreateOverlayHost() {
        const overlay = document.getElementById('kd2PlanCreateOverlay');
        if (!overlay || !planCreateOverlayHome?.parent) return;
        const { parent, nextSibling } = planCreateOverlayHome;
        if (overlay.parentNode === parent) return;
        if (nextSibling && nextSibling.parentNode === parent) parent.insertBefore(overlay, nextSibling);
        else parent.appendChild(overlay);
    }

    function restorePlanEditOverlayHost() {
        const overlay = document.getElementById('kd2PlanEditOverlay');
        if (!overlay || !planEditOverlayHome?.parent) return;
        const { parent, nextSibling } = planEditOverlayHome;
        if (overlay.parentNode === parent) return;
        if (nextSibling && nextSibling.parentNode === parent) parent.insertBefore(overlay, nextSibling);
        else parent.appendChild(overlay);
    }

    function restoreProcessOverlayHost() {
        const overlay = document.getElementById('kd2ProcessOverlay');
        if (!overlay || !processOverlayHome?.parent) return;
        const { parent, nextSibling } = processOverlayHome;
        if (overlay.parentNode === parent) return;
        if (nextSibling && nextSibling.parentNode === parent) parent.insertBefore(overlay, nextSibling);
        else parent.appendChild(overlay);
    }

    function closePlanCreateModal() {
        const overlay = document.getElementById('kd2PlanCreateOverlay');
        if (overlay) overlay.style.display = 'none';
        restorePlanCreateOverlayHost();
        setPlanCreateError('');
        state.templateInsertIndex = null;
    }

    function selectedCreateStation() {
        const vehicle = document.getElementById('kd2PlanCreateVehicle')?.value || 'K9';
        const stationCode = document.getElementById('kd2PlanCreateStation')?.value || '';
        return state.stations.find(row => row.vehicle_type === vehicle && row.station_code === stationCode) || null;
    }

    function updatePlanCreateCategory() {
        const categoryEl = document.getElementById('kd2PlanCreateCategory');
        if (!categoryEl) return;
        const station = selectedCreateStation();
        if (!station) {
            categoryEl.textContent = 'Select a station to resolve the KD2 category.';
            return;
        }
        const category = state.categories.find(row =>
            row.vehicle_type === station.vehicle_type &&
            row.category_code === station.category_code
        );
        categoryEl.textContent = category
            ? `${category.category_name} · ${station.work_center || station.station_code} · Route ${station.route_sequence} · Station ${station.station_sequence_in_category}`
            : `${station.category_code} · Route ${station.route_sequence}`;
    }

    function populatePlanCreateStations(preserveValue = '') {
        const vehicle = document.getElementById('kd2PlanCreateVehicle')?.value || 'K9';
        const stationSelect = document.getElementById('kd2PlanCreateStation');
        if (!stationSelect) return;

        const categories = state.categories
            .filter(row => row.vehicle_type === vehicle)
            .sort((a, b) => a.category_sequence - b.category_sequence);

        if (!categories.length) {
            stationSelect.innerHTML = '<option value="">No KD2 route stations available</option>';
            updatePlanCreateCategory();
            return;
        }

        stationSelect.innerHTML = categories.map(category => {
            const categoryStations = state.stations
                .filter(row => row.vehicle_type === vehicle && row.category_code === category.category_code)
                .sort((a, b) => a.station_sequence_in_category - b.station_sequence_in_category);

            if (!categoryStations.length) return '';
            return `
                <optgroup label="${escapeHtml(category.category_name)}">
                    ${categoryStations.map(station => `
                        <option value="${escapeHtml(station.station_code)}">
                            ${escapeHtml(station.station_name)} · ${escapeHtml(station.work_center || station.station_code)} · Route ${station.route_sequence}
                        </option>
                    `).join('')}
                </optgroup>
            `;
        }).join('');

        const options = [...stationSelect.options];
        if (preserveValue && options.some(option => option.value === preserveValue)) stationSelect.value = preserveValue;
        updatePlanCreateCategory();
    }

    function planCreateUnitOptions() {
        const battalionId = parseInt(document.getElementById('kd2PlanCreateBattalion')?.value || '', 10);
        const vehicle = document.getElementById('kd2PlanCreateVehicle')?.value || 'K9';
        if (!battalionId || !vehicle) return [];

        const input = inputFor(battalionId, vehicle);
        const quantity = parseInt(input?.required_quantity, 10) || 0;
        const unitMap = new Map(
            state.vehicleUnits
                .filter(row => row.battalion_id === battalionId && row.vehicle_type === vehicle)
                .map(row => [row.unit_serial, row])
        );

        const serials = new Set();
        for (let i = 1; i <= quantity; i += 1) serials.add(i);
        unitMap.forEach((_, serial) => serials.add(serial));

        return [...serials]
            .sort((a, b) => a - b)
            .map(serial => {
                const unit = unitMap.get(serial);
                const label = unit?.unit_label || `${vehicle}-${String(serial).padStart(2, '0')}`;
                const code = unit?.unit_code || '';
                return { serial, label, code };
            });
    }

    function populatePlanCreateUnits(preserveValue = '') {
        const unitSelect = document.getElementById('kd2PlanCreateUnit');
        if (!unitSelect) return;

        const units = planCreateUnitOptions();
        if (!units.length) {
            unitSelect.innerHTML = '<option value="">No units configured for this battalion and vehicle</option>';
            return;
        }

        unitSelect.innerHTML = units.map(unit => `
            <option value="${unit.serial}" data-unit-label="${escapeHtml(unit.label)}">
                ${escapeHtml(unit.label)}${unit.code ? ` · ${escapeHtml(unit.code)}` : ''}
            </option>
        `).join('');

        if (preserveValue && [...unitSelect.options].some(option => option.value === preserveValue)) {
            unitSelect.value = preserveValue;
        }
    }

    function currentPlanCreateMode() {
        return document.querySelector('#kd2PlanCreateModeToggle .kd2-create-mode-btn.active')?.dataset.mode || 'block';
    }

    function syncPlanCreateUiState() {
        const mode = currentPlanCreateMode();
        const isTemplate = mode === 'template';
        const modeGroup = document.getElementById('kd2PlanCreateModeGroup');
        const stationGroup = document.getElementById('kd2PlanCreateStation')?.closest('.form-group');
        const categoryGroup = document.getElementById('kd2PlanCreateCategory')?.closest('.form-group');
        const durationGroup = document.getElementById('kd2PlanCreateDuration')?.closest('.form-group');
        const endGroup = document.getElementById('kd2PlanCreateEnd')?.closest('.form-group');
        const remarkGroup = document.getElementById('kd2PlanCreateRemark')?.closest('.form-group');
        const editorWrap = document.getElementById('kd2TemplateEditorWrap');
        const title = document.getElementById('kd2PlanCreateTitle');
        const saveBtn = document.getElementById('btnKd2PlanCreateSave');

        document.querySelectorAll('[data-kd2-plan-create-form]').forEach(node => {
            node.style.display = '';
        });
        if (modeGroup) modeGroup.style.display = '';
        if (stationGroup) stationGroup.style.display = isTemplate ? 'none' : '';
        if (categoryGroup) categoryGroup.style.display = isTemplate ? 'none' : '';
        if (durationGroup) durationGroup.style.display = isTemplate ? 'none' : '';
        if (endGroup) endGroup.style.display = isTemplate ? 'none' : '';
        if (remarkGroup) remarkGroup.style.display = isTemplate ? 'none' : '';
        if (editorWrap) editorWrap.style.display = isTemplate ? 'block' : 'none';
        if (title) {
            title.textContent = isTemplate ? 'Add KD2 Template' : 'Add KD2 Plan Block';
        }
        if (saveBtn) {
            saveBtn.textContent = isTemplate ? 'Add Template to Plan' : 'Add to KD2 Plan';
        }
        if (isTemplate) renderTemplateEditor();
        else {
            updatePlanCreateCategory();
            updatePlanCreateDurationFromStation(true);
        }
        syncTimelinePlacementUi();
    }

    function setPlanCreateMode(mode) {
        const safeMode = mode === 'template' ? 'template' : 'block';
        document.querySelectorAll('#kd2PlanCreateModeToggle .kd2-create-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === safeMode);
        });
        syncPlanCreateUiState();
    }

    function defaultDurationForStation(vehicle, categoryCode, stationCode) {
        return resolveLeadTime(vehicle, categoryCode, stationCode);
    }

    async function createPlanBlock({ battalionId, vehicle, unitSerial, unitLabel, stationCode, startDate, duration, remark, planningSource = 'manual' }) {
        if (!dbRef) return null;
        const battalion = state.battalions.find(row => row.id === battalionId) || null;
        const station = state.stations.find(row => row.vehicle_type === vehicle && row.station_code === stationCode) || null;
        const category = state.categories.find(row => row.vehicle_type === vehicle && row.category_code === station?.category_code) || null;
        if (!battalion || !station || !category) {
            throw new Error('The selected KD2 route definition is incomplete.');
        }
        if (!startDate || !duration || duration < 1 || !unitSerial) {
            throw new Error('Battalion, vehicle, unit, station, planned start, and duration are required.');
        }

        let duplicateQuery = dbRef
            .from('kd2_plan')
            .select('id')
            .eq('battalion_id', battalion.id)
            .eq('vehicle_type', vehicle)
            .eq('station_code', station.station_code);
        duplicateQuery = unitSerial === null
            ? duplicateQuery.is('unit_serial', null)
            : duplicateQuery.eq('unit_serial', unitSerial);
        const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle();
        if (duplicateError) throw duplicateError;
        if (duplicate) {
            throw new Error('A KD2 plan block for this battalion, unit serial, and station already exists.');
        }

        const window = buildForwardWindow(startDate, duration, planningRulesFor(battalion.id, vehicle));
        const payload = {
            battalion_id: battalion.id,
            vehicle_type: vehicle,
            unit_serial: unitSerial,
            unit_label: unitLabel || null,
            category_code: category.category_code,
            station_code: station.station_code,
            category_sequence: category.category_sequence,
            station_sequence_in_category: station.station_sequence_in_category,
            route_sequence: station.route_sequence,
            schedule_week: weekLabel(window.start),
            planned_start_date: window.start,
            planned_end_date: window.end,
            planning_source: planningSource,
            remark: remark || null,
        };
        const { data, error } = await dbRef
            .from('kd2_plan')
            .insert(payload)
            .select('*')
            .single();
        if (error) throw error;
        await writeAudit('INSERT', 'kd2_plan', data.id, null, payload);
        return data;
    }

    function beginTimelinePlacement({ keepMenuState = false } = {}) {
        const processView = isTimelineProcessView();
        if (processView) {
            const unit = currentPlacementUnit();
            if (!unit) {
                setPlanCreateError('Select a unit before starting visual placement.');
                return;
            }
            state.timelinePlacementActive = true;
            if (!keepMenuState) setTimelinePlacementMenuOpen(false);
            if (document.getElementById('kd2PlanCreateOverlay')?.style.display === 'flex') closePlanCreateModal();
            if (!state.timelineEditMode) setTimelineEditMode(true);
            else {
                syncTimelinePlacementUi();
                renderSchedule();
            }
            toast(`Placement mode active for ${unit.vehicle_type} · ${unit.unit_label}.`, 'info');
            return;
        }
        const station = currentPlacementStation();
        if (!station) {
            setPlanCreateError('Select a station block before starting visual placement.');
            return;
        }
        state.timelinePlacementActive = true;
        if (!keepMenuState) setTimelinePlacementMenuOpen(false);
        if (document.getElementById('kd2PlanCreateOverlay')?.style.display === 'flex') closePlanCreateModal();
        if (!state.timelineEditMode) setTimelineEditMode(true);
        else {
            syncTimelinePlacementUi();
            renderSchedule();
        }
        toast(`Placement mode active for ${station.station_name}.`, 'info');
    }

    function cancelTimelinePlacement({ skipRender = false, keepMenuOpen = false } = {}) {
        state.timelinePlacementActive = false;
        setTimelinePlacementMenuOpen(!!keepMenuOpen);
        syncTimelinePlacementUi();
        if (!skipRender) renderSchedule();
    }

    async function toggleTimelineVisualMenu(forceOpen = null) {
        const shouldOpen = forceOpen === null ? !state.timelinePlacementMenuOpen : !!forceOpen;
        if (!shouldOpen) {
            setTimelinePlacementMenuOpen(false);
            return;
        }
        if (!canManageKD2()) {
            toast('Only planners and admins can add KD2 plan rows.', 'error');
            return;
        }
        try {
            if (!state.battalions.length || !state.stations.length) await loadWorkspaceData();
        } catch (error) {
            toast(`KD2 setup load failed: ${error.message}`, 'error');
            return;
        }
        const defaultVehicle = getVehicleFilterValue() || state.timelinePlacementVehicle || 'K9';
        setTimelinePlacementVehicle(defaultVehicle);
        setTimelinePlacementMenuOpen(shouldOpen);
        syncTimelinePlacementUi();
    }

    function updatePlanCreateEndFromDuration() {
        const start = document.getElementById('kd2PlanCreateStart')?.value;
        const duration = parseInt(document.getElementById('kd2PlanCreateDuration')?.value || '', 10);
        const endInput = document.getElementById('kd2PlanCreateEnd');
        if (!start || !duration || duration < 1 || !endInput) return;
        const battalionId = parseInt(document.getElementById('kd2PlanCreateBattalion')?.value || '', 10);
        const vehicle = document.getElementById('kd2PlanCreateVehicle')?.value || 'K9';
        const window = buildForwardWindow(start, duration, planningRulesFor(battalionId, vehicle));
        endInput.value = window.end;
    }

    function updatePlanCreateDurationFromStation(force = false) {
        const station = selectedCreateStation();
        const durationInput = document.getElementById('kd2PlanCreateDuration');
        if (!station || !durationInput) return;
        const duration = defaultDurationForStation(station.vehicle_type, station.category_code, station.station_code);
        if (force || !durationInput.value) {
            durationInput.value = duration || '';
        }
        updatePlanCreateEndFromDuration();
    }

    function templateRowsForVehicle(vehicle) {
        return routeItemsForVehicle(vehicle).map(item => ({
            ...item,
            duration: defaultDurationForStation(vehicle, item.route.category_code, item.route.station_code),
        }));
    }

    function selectedTemplateVehicle() {
        return document.getElementById('kd2PlanCreateVehicle')?.value || 'K9';
    }

    function isTemplateSpaceBlock(block) {
        return block?.kind === 'space';
    }

    function isTemplateProcessBlock(block) {
        return !isTemplateSpaceBlock(block);
    }

    function gapSummaryText(gapDays) {
        const safeGap = parseInt(gapDays, 10);
        if (!Number.isFinite(safeGap) || safeGap < 1) return 'Set skipped working days';
        return `Skip ${safeGap} working day${safeGap === 1 ? '' : 's'}`;
    }

    function createTemplateProcessBlock(vehicle, overrides = {}) {
        return {
            kind: 'process',
            editor_id: overrides.editor_id || '',
            isNew: overrides.isNew === true,
            vehicle_type: overrides.vehicle_type || vehicle,
            category_code: overrides.category_code || 'assembly',
            station_code: overrides.station_code || null,
            station_name: overrides.station_name || '',
            work_center: overrides.work_center || '',
            route_sequence: Number.isFinite(parseInt(overrides.route_sequence, 10)) ? parseInt(overrides.route_sequence, 10) : 1,
            planning_level: 'station',
            lead_time_days: overrides.lead_time_days ?? null,
            lead_time_source: 'KD2 template',
            notes: overrides.notes || 'Editable route template default',
            station_sequence_in_category: overrides.station_sequence_in_category ?? null,
            parallel_with_previous: Boolean(overrides.parallel_with_previous),
            gap_days: null,
            source_process: overrides.source_process || null,
        };
    }

    function createTemplateSpaceBlock(vehicle, overrides = {}) {
        const parsedGap = parseGapDaysValue(overrides.gap_days);
        return {
            kind: 'space',
            editor_id: overrides.editor_id || '',
            isNew: false,
            vehicle_type: overrides.vehicle_type || vehicle,
            category_code: '',
            station_code: null,
            station_name: '',
            work_center: '',
            route_sequence: null,
            planning_level: null,
            lead_time_days: null,
            lead_time_source: null,
            notes: 'Template gap',
            station_sequence_in_category: null,
            parallel_with_previous: false,
            gap_days: Number.isNaN(parsedGap) ? (overrides.gap_days ?? 1) : parsedGap,
            source_process: overrides.source_process || null,
        };
    }

    function buildTemplateProcessBlockFromRouteItem(vehicle, item, previousRoute = null, overrides = {}) {
        const routeSequence = parseRouteSequenceValue(item.route.route_sequence);
        const safeRouteSequence = Number.isNaN(routeSequence) ? 1 : routeSequence;
        return createTemplateProcessBlock(vehicle, {
            editor_id: overrides.editor_id || `existing_${item.route.station_code}`,
            isNew: false,
            vehicle_type: vehicle,
            category_code: item.route.category_code,
            station_code: item.route.station_code,
            station_name: item.station.station_name,
            work_center: item.station.work_center || '',
            route_sequence: safeRouteSequence,
            lead_time_days: item.duration || null,
            notes: 'Editable route template default',
            station_sequence_in_category: item.station.station_sequence_in_category,
            parallel_with_previous: overrides.parallel_with_previous ?? (previousRoute !== null && previousRoute === safeRouteSequence),
            source_process: overrides.source_process || null,
        });
    }

    function templateLayoutRowsForVehicle(vehicle) {
        return state.templateLayouts
            .filter(row => row.vehicle_type === vehicle)
            .sort((a, b) =>
                (parseInt(a.sort_order, 10) || 9999) - (parseInt(b.sort_order, 10) || 9999) ||
                (a.id || 0) - (b.id || 0)
            );
    }

    function templateEditorBlocksForVehicle(vehicle) {
        const layoutRows = templateLayoutRowsForVehicle(vehicle);
        if (layoutRows.length) {
            const routeItems = templateRowsForVehicle(vehicle);
            const routeItemMap = new Map(routeItems.map(item => [item.route.station_code, item]));
            const blocks = layoutRows.map((row, index) => {
                if (row.kind === 'space') {
                    return createTemplateSpaceBlock(vehicle, {
                        editor_id: `layout_space_${row.id || index + 1}`,
                        gap_days: row.gap_days,
                    });
                }
                const routeItem = routeItemMap.get(row.station_code);
                if (!routeItem) return null;
                return buildTemplateProcessBlockFromRouteItem(vehicle, routeItem, null, {
                    editor_id: `existing_${routeItem.route.station_code}`,
                    parallel_with_previous: Boolean(row.parallel_with_previous),
                });
            }).filter(Boolean);
            if (blocks.length) return normalizeTemplateEditorBlocks(blocks);
        }
        let previousRoute = null;
        return templateRowsForVehicle(vehicle).map(item => {
            const block = buildTemplateProcessBlockFromRouteItem(vehicle, item, previousRoute);
            previousRoute = block.route_sequence;
            return block;
        });
    }

    function ensureTemplateEditorState(vehicle, { force = false } = {}) {
        if (!force && state.templateEditorVehicle === vehicle) return;
        state.templateEditorVehicle = vehicle;
        state.templateEditorBlocks = templateEditorBlocksForVehicle(vehicle);
        state.templateInsertIndex = null;
    }

    function slugifyStationName(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 42) || 'custom_block';
    }

    function templateCategoryOptions(vehicle, selected = 'assembly') {
        return state.categories
            .filter(row => row.vehicle_type === vehicle)
            .sort((a, b) => a.category_sequence - b.category_sequence)
            .map(row => `<option value="${escapeHtml(row.category_code)}" ${row.category_code === selected ? 'selected' : ''}>${escapeHtml(row.category_name)}</option>`)
            .join('');
    }

    function nextTemplateRoute(vehicle) {
        const routes = (state.templateEditorVehicle === vehicle ? state.templateEditorBlocks : [])
            .filter(isTemplateProcessBlock)
            .map(item => parseInt(item.route_sequence, 10) || 0);
        if (!routes.length) {
            routeItemsForVehicle(vehicle).forEach(item => routes.push(parseInt(item.route.route_sequence, 10) || 0));
        }
        return Math.max(0, ...routes) + 1;
    }

    function normalizeTemplateEditorBlocks(blocks) {
        let routeSequence = 0;
        let previousWasProcess = false;
        return blocks.map(block => {
            if (isTemplateSpaceBlock(block)) {
                previousWasProcess = false;
                return createTemplateSpaceBlock(block.vehicle_type || selectedTemplateVehicle(), {
                    ...block,
                    parallel_with_previous: false,
                    route_sequence: null,
                });
            }
            const parallelWithPrevious = previousWasProcess && Boolean(block.parallel_with_previous);
            if (!parallelWithPrevious) routeSequence += 1;
            previousWasProcess = true;
            return createTemplateProcessBlock(block.vehicle_type || selectedTemplateVehicle(), {
                ...block,
                route_sequence: routeSequence,
                parallel_with_previous: parallelWithPrevious,
                gap_days: null,
            });
        });
    }

    function templateTypeOptions(selectedKind = 'process') {
        return `
            <option value="process" ${selectedKind !== 'space' ? 'selected' : ''}>Process Block</option>
            <option value="space" ${selectedKind === 'space' ? 'selected' : ''}>Space</option>
        `;
    }

    function templateEditorHintText() {
        if (state.templateEditorView === 'visual') {
            return 'Drag blocks and spaces to reorder the template. Hover between cards to insert a Process Block or Space. Spaces skip working days before the next process group.';
        }
        if (state.templateEditorView === 'preview') {
            return 'Preview how the template will land on the KD2 Gantt using the selected battalion, vehicle, unit, and planned start date.';
        }
        return 'Keep rows in the intended order. Adjacent process rows with the same route number run in parallel, and any space row starts the next process on a new route group.';
    }

    function syncTemplateEditorChrome() {
        document.querySelectorAll('#kd2TemplateEditorViewToggle .kd2-template-view-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === state.templateEditorView);
        });
        const hint = document.getElementById('kd2TemplateEditorHint');
        if (hint) hint.textContent = templateEditorHintText();
    }

    function readTemplateBlockFields(node, existingBlock = {}) {
        const kind = node.querySelector('[data-field="kind"]')?.value || node.dataset.kind || existingBlock.kind || 'process';
        const vehicle = existingBlock.vehicle_type || selectedTemplateVehicle();
        if (kind === 'space') {
            const gapDays = parseGapDaysValue(node.querySelector('[data-field="gapDays"]')?.value);
            return createTemplateSpaceBlock(vehicle, {
                ...existingBlock,
                kind: 'space',
                editor_id: node.dataset.editorId || existingBlock.editor_id,
                gap_days: Number.isNaN(gapDays) ? null : gapDays,
            });
        }

        const isNew = node.dataset.new === 'true' || existingBlock.isNew;
        const duration = parseLeadTimeValue(node.querySelector('[data-field="duration"]')?.value);
        const routeSequence = parseRouteSequenceValue(node.querySelector('[data-field="routeSequence"]')?.value);
        const stationName = isNew
            ? node.querySelector('[data-field="stationName"]')?.value?.trim() || ''
            : existingBlock.station_name || '';
        const workCenter = isNew
            ? node.querySelector('[data-field="workCenter"]')?.value?.trim() || ''
            : existingBlock.work_center || '';
        const categoryCode = isNew
            ? node.querySelector('[data-field="categoryCode"]')?.value || ''
            : existingBlock.category_code || node.dataset.categoryCode || '';
        return createTemplateProcessBlock(vehicle, {
            ...existingBlock,
            editor_id: node.dataset.editorId || existingBlock.editor_id,
            isNew,
            vehicle_type: vehicle,
            category_code: categoryCode,
            station_code: existingBlock.station_code || node.dataset.stationCode || null,
            station_name: stationName,
            work_center: workCenter,
            route_sequence: Number.isNaN(routeSequence) ? existingBlock.route_sequence : routeSequence,
            lead_time_days: duration,
            station_sequence_in_category: existingBlock.station_sequence_in_category,
        });
    }

    function syncTemplateEditorStateFromDom({ normalizeForVisual = false } = {}) {
        const container = document.getElementById('kd2TemplateEditor');
        if (!container) return;
        const cards = [...container.querySelectorAll('[data-kd2-template-block]')];
        if (!cards.length) {
            // Only clear blocks when the editor has been actively rendered (indicated by the
            // data-rendered attribute set by renderTemplateEditor). Without this guard,
            // calling syncTemplateEditorStateFromDom before the editor renders wipes the
            // in-memory state loaded by ensureTemplateEditorState, causing the intermittent
            // "No template rows are available to save" error.
            if (container.dataset.rendered === 'true') {
                state.templateEditorBlocks = [];
            }
            return;
        }
        const previousBlocks = new Map(state.templateEditorBlocks.map(block => [block.editor_id, block]));
        let blocks = cards.map(node => {
            const editorId = node.dataset.editorId || '';
            const existingBlock = previousBlocks.get(editorId) || {};
            const block = readTemplateBlockFields(node, existingBlock);
            if (state.templateEditorView === 'visual' && isTemplateProcessBlock(block)) {
                block.parallel_with_previous = Boolean(node.querySelector('[data-kd2-template-parallel]')?.checked);
            }
            return block;
        });

        if (state.templateEditorView === 'visual') {
            blocks = normalizeTemplateEditorBlocks(blocks);
        } else {
            let previousProcessRoute = null;
            let previousWasProcess = false;
            blocks = blocks.map(block => {
                if (isTemplateSpaceBlock(block)) {
                    previousWasProcess = false;
                    previousProcessRoute = null;
                    return createTemplateSpaceBlock(block.vehicle_type || selectedTemplateVehicle(), block);
                }
                const routeSequence = parseRouteSequenceValue(block.route_sequence);
                const parallelWithPrevious = previousWasProcess && !Number.isNaN(routeSequence) && routeSequence === previousProcessRoute;
                previousWasProcess = true;
                previousProcessRoute = routeSequence;
                return createTemplateProcessBlock(block.vehicle_type || selectedTemplateVehicle(), {
                    ...block,
                    route_sequence: Number.isNaN(routeSequence) ? block.route_sequence : routeSequence,
                    parallel_with_previous: parallelWithPrevious,
                });
            });
            if (normalizeForVisual) blocks = normalizeTemplateEditorBlocks(blocks);
        }

        state.templateEditorBlocks = blocks;
    }

    function templateCardMeta(block) {
        if (isTemplateSpaceBlock(block)) return 'Template gap';
        const category = state.categories.find(item =>
            item.vehicle_type === block.vehicle_type &&
            item.category_code === block.category_code
        );
        return [
            category?.category_name || block.category_code || 'No category',
            block.work_center || block.station_code || 'No work center',
        ].join(' · ');
    }

    function renderTemplateEditorForm(blocks) {
        if (!blocks.length) {
            return '<div class="empty-state"><p>No route template is available for this vehicle. Add a process block or space to start one.</p></div>';
        }
        return blocks.map((block, index) => {
            const controls = `
                <div class="kd2-template-row-actions">
                    <button type="button" class="kd2-template-shift" data-kd2-template-move="-1" data-editor-id="${escapeHtml(block.editor_id)}" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="kd2-template-shift" data-kd2-template-move="1" data-editor-id="${escapeHtml(block.editor_id)}" title="Move down" ${index === blocks.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" class="kd2-template-remove" data-kd2-template-remove-id="${escapeHtml(block.editor_id)}" title="Remove item">&times;</button>
                </div>
            `;

            if (isTemplateSpaceBlock(block)) {
                return `
                    <div class="kd2-template-row kd2-template-row-space" data-kd2-template-block data-kind="space" data-editor-id="${escapeHtml(block.editor_id)}">
                        <div class="kd2-template-row-fields">
                            <div class="kd2-template-card-field">
                                <label>Type</label>
                                <select class="filter-control" data-field="kind">${templateTypeOptions('space')}</select>
                            </div>
                            <div class="kd2-template-card-field">
                                <label>Gap Days</label>
                                <input type="number" min="1" step="1" class="filter-control kd2-template-gap-days" data-field="gapDays" value="${block.gap_days || ''}" placeholder="days" />
                            </div>
                            <div class="kd2-template-card-field kd2-template-card-field-span2">
                                <label>Summary</label>
                                <div class="kd2-template-card-field-value kd2-template-space-summary">${escapeHtml(gapSummaryText(block.gap_days))}</div>
                            </div>
                        </div>
                        ${controls}
                    </div>
                `;
            }

            return `
                <div class="kd2-template-row ${block.isNew ? 'kd2-template-row-new' : ''}" data-kd2-template-block data-kind="process" data-new="${block.isNew ? 'true' : 'false'}" data-editor-id="${escapeHtml(block.editor_id)}" data-category-code="${escapeHtml(block.category_code || '')}" data-station-code="${escapeHtml(block.station_code || '')}">
                    <div class="kd2-template-row-fields">
                        <div class="kd2-template-card-field">
                            <label>Type</label>
                            <select class="filter-control" data-field="kind">${templateTypeOptions('process')}</select>
                        </div>
                        ${block.isNew ? `
                            <div class="kd2-template-card-field">
                                <label>Station Name</label>
                                <input type="text" class="filter-control kd2-template-name-input" data-field="stationName" value="${escapeHtml(block.station_name || '')}" placeholder="Station name" />
                            </div>
                            <div class="kd2-template-card-field">
                                <label>Category</label>
                                <select class="filter-control kd2-template-category-input" data-field="categoryCode">${templateCategoryOptions(block.vehicle_type, block.category_code || 'assembly')}</select>
                            </div>
                            <div class="kd2-template-card-field">
                                <label>Work Center</label>
                                <input type="text" class="filter-control kd2-template-workcenter-input" data-field="workCenter" value="${escapeHtml(block.work_center || '')}" placeholder="Work center" />
                            </div>
                        ` : `
                            <div class="kd2-template-card-field kd2-template-card-field-span2">
                                <label>Station</label>
                                <div class="kd2-template-card-field-value">${escapeHtml(block.station_name)}</div>
                            </div>
                            <div class="kd2-template-card-field">
                                <label>Category</label>
                                <div class="kd2-template-card-field-value">${escapeHtml(state.categories.find(item => item.vehicle_type === block.vehicle_type && item.category_code === block.category_code)?.category_name || block.category_code)}</div>
                            </div>
                            <div class="kd2-template-card-field">
                                <label>Work Center</label>
                                <div class="kd2-template-card-field-value">${escapeHtml(block.work_center || block.station_code || 'No work center')}</div>
                            </div>
                        `}
                        <div class="kd2-template-card-field">
                            <label>Route</label>
                            <input type="number" min="1" step="1" class="filter-control kd2-template-route-input" data-field="routeSequence" value="${block.route_sequence || ''}" title="Same route number as the previous process = parallel" />
                        </div>
                        <div class="kd2-template-card-field">
                            <label>Duration</label>
                            <input type="number" min="1" step="1" class="filter-control kd2-template-duration" data-field="duration" value="${block.lead_time_days || ''}" placeholder="days" />
                        </div>
                    </div>
                    ${controls}
                </div>
            `;
        }).join('');
    }

    function renderTemplateInsertSlot(index) {
        const isOpen = state.templateInsertIndex === index;
        return `
            <div class="kd2-template-insert-slot ${isOpen ? 'is-open' : ''}" data-kd2-template-insert-slot data-insert-index="${index}">
                <button type="button" class="kd2-template-insert-btn" data-kd2-template-insert-trigger="${index}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-label="Insert template item">+</button>
                ${isOpen ? `
                    <div class="kd2-template-insert-menu" data-kd2-template-insert-menu>
                        <div class="kd2-template-insert-menu-head">
                            <span class="kd2-template-insert-menu-kicker">Insert Here</span>
                            <strong>Add Template Item</strong>
                            <span>Add a process step or a working-day gap.</span>
                        </div>
                        <div class="kd2-template-insert-menu-options">
                            <button type="button" class="kd2-template-insert-option kd2-template-insert-option-process" data-kd2-template-insert-kind="process" data-insert-index="${index}">
                                <span class="kd2-template-insert-option-icon" aria-hidden="true">+</span>
                                <span class="kd2-template-insert-option-copy">
                                    <strong>Process Block</strong>
                                    <small>Add a station step with duration.</small>
                                </span>
                            </button>
                            <button type="button" class="kd2-template-insert-option kd2-template-insert-option-space" data-kd2-template-insert-kind="space" data-insert-index="${index}">
                                <span class="kd2-template-insert-option-icon" aria-hidden="true">::</span>
                                <span class="kd2-template-insert-option-copy">
                                    <strong>Space</strong>
                                    <small>Skip working days before the next step.</small>
                                </span>
                            </button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderTemplateEditorVisual(blocks) {
        const normalizedBlocks = normalizeTemplateEditorBlocks(blocks);
        const nodes = [];
        for (let i = 0; i <= normalizedBlocks.length; i += 1) {
            nodes.push(renderTemplateInsertSlot(i));
            if (i >= normalizedBlocks.length) continue;
            const block = normalizedBlocks[i];
            if (isTemplateSpaceBlock(block)) {
                nodes.push(`
                    <article class="kd2-template-card kd2-template-space-card" draggable="true" data-kd2-template-block data-kind="space" data-editor-id="${escapeHtml(block.editor_id)}">
                        <div class="kd2-template-card-head">
                            <div class="kd2-template-card-copy">
                                <strong>Space</strong>
                                <span>${escapeHtml(gapSummaryText(block.gap_days))}</span>
                            </div>
                            <div class="kd2-template-card-tools">
                                <span class="kd2-template-route-pill kd2-template-space-pill">Space</span>
                                <span class="kd2-template-drag-handle" title="Drag to reorder">::</span>
                                <button type="button" class="kd2-template-remove" data-kd2-template-remove-id="${escapeHtml(block.editor_id)}" title="Remove space">&times;</button>
                            </div>
                        </div>
                        <div class="kd2-template-space-body">
                            <div class="kd2-template-card-field">
                                <label>Gap Days</label>
                                <input type="number" min="1" step="1" class="filter-control kd2-template-gap-days" data-field="gapDays" value="${block.gap_days || ''}" placeholder="days" />
                            </div>
                            <div class="kd2-template-card-field">
                                <label>Summary</label>
                                <div class="kd2-template-card-field-value kd2-template-space-summary">${escapeHtml(gapSummaryText(block.gap_days))}</div>
                            </div>
                        </div>
                    </article>
                `);
                continue;
            }
            const previousBlock = i > 0 ? normalizedBlocks[i - 1] : null;
            const canParallel = previousBlock && isTemplateProcessBlock(previousBlock);
            nodes.push(`
                <article class="kd2-template-card" draggable="true" data-kd2-template-block data-kind="process" data-new="${block.isNew ? 'true' : 'false'}" data-editor-id="${escapeHtml(block.editor_id)}" data-category-code="${escapeHtml(block.category_code || '')}" data-station-code="${escapeHtml(block.station_code || '')}">
                    <div class="kd2-template-card-head">
                        <div class="kd2-template-card-copy">
                            <strong>${escapeHtml(block.isNew ? (block.station_name || 'New Block') : block.station_name)}</strong>
                            <span>${escapeHtml(templateCardMeta(block))}</span>
                        </div>
                        <div class="kd2-template-card-tools">
                            <span class="kd2-template-route-pill">Route ${block.route_sequence}${block.parallel_with_previous ? ' · Parallel' : ''}</span>
                            <span class="kd2-template-drag-handle" title="Drag to reorder">::</span>
                            <button type="button" class="kd2-template-remove" data-kd2-template-remove-id="${escapeHtml(block.editor_id)}" title="Remove block">&times;</button>
                        </div>
                    </div>
                    <div class="kd2-template-card-fields">
                        ${block.isNew ? `
                            <div class="kd2-template-card-field">
                                <label>Station Name</label>
                                <input type="text" class="filter-control" data-field="stationName" value="${escapeHtml(block.station_name || '')}" placeholder="Station name" />
                            </div>
                            <div class="kd2-template-card-field">
                                <label>Category</label>
                                <select class="filter-control" data-field="categoryCode">${templateCategoryOptions(block.vehicle_type, block.category_code || 'assembly')}</select>
                            </div>
                            <div class="kd2-template-card-field">
                                <label>Work Center</label>
                                <input type="text" class="filter-control" data-field="workCenter" value="${escapeHtml(block.work_center || '')}" placeholder="Work center" />
                            </div>
                        ` : `
                            <div class="kd2-template-card-field">
                                <label>Station</label>
                                <div class="kd2-template-card-field-value">${escapeHtml(block.station_name)}</div>
                            </div>
                            <div class="kd2-template-card-field">
                                <label>Category</label>
                                <div class="kd2-template-card-field-value">${escapeHtml(state.categories.find(item => item.vehicle_type === block.vehicle_type && item.category_code === block.category_code)?.category_name || block.category_code)}</div>
                            </div>
                            <div class="kd2-template-card-field">
                                <label>Work Center</label>
                                <div class="kd2-template-card-field-value">${escapeHtml(block.work_center || block.station_code || 'No work center')}</div>
                            </div>
                        `}
                        <div class="kd2-template-card-field">
                            <label>Duration</label>
                            <input type="number" min="1" step="1" class="filter-control kd2-template-duration" data-field="duration" value="${block.lead_time_days || ''}" placeholder="days" />
                        </div>
                    </div>
                    <div class="kd2-template-card-foot">
                        <label class="kd2-template-parallel-toggle">
                            <input type="checkbox" data-kd2-template-parallel ${canParallel && block.parallel_with_previous ? 'checked' : ''} ${canParallel ? '' : 'disabled'} />
                            <span>${canParallel ? 'Parallel with previous process block' : (i === 0 ? 'First process starts the route' : 'Space above forces a new route')}</span>
                        </label>
                    </div>
                </article>
            `);
        }
        return `
            <div class="kd2-template-visual-note">Direct block editing is active. Route order comes from card position, and spaces skip working days before the next process group.</div>
            <div class="kd2-template-visual">
                ${normalizedBlocks.length ? '' : '<div class="empty-state"><p>No route template is available for this vehicle yet. Use the insert slot to add a Process Block or Space.</p></div>'}
                ${nodes.join('')}
            </div>
        `;
    }

    const TEMPLATE_PREVIEW_GANTT_PALETTE = [
        '#06b6d4', '#f97316', '#84cc16', '#6366f1', '#e11d48',
        '#0ea5e9', '#a855f7', '#d97706', '#4ade80', '#38bdf8',
    ];
    const templatePreviewStationColors = {};

    function templatePreviewStationColor(name) {
        const key = String(name || '').trim() || 'Unnamed station';
        if (typeof window.__ppmsGanttStationColor === 'function') {
            return window.__ppmsGanttStationColor(key);
        }
        if (!templatePreviewStationColors[key]) {
            const index = Object.keys(templatePreviewStationColors).length % TEMPLATE_PREVIEW_GANTT_PALETTE.length;
            templatePreviewStationColors[key] = TEMPLATE_PREVIEW_GANTT_PALETTE[index];
        }
        return templatePreviewStationColors[key];
    }

    function resolveTemplatePreviewGanttColumn(dayIndex, dateStr, clampFallback) {
        if (dayIndex[dateStr] !== undefined) return dayIndex[dateStr];
        for (let shift = 1; shift <= 3; shift += 1) {
            const next = addDays(dateStr, shift);
            if (dayIndex[next] !== undefined) return dayIndex[next];
        }
        for (let shift = 1; shift <= 3; shift += 1) {
            const previous = addDays(dateStr, -shift);
            if (dayIndex[previous] !== undefined) return dayIndex[previous];
        }
        return clampFallback;
    }

    function buildTemplatePreviewPackedBars(rows, viewStart, viewEnd, dayIndex, numDays) {
        const visibleRows = rows
            .filter(row => row.start_date <= viewEnd && row.end_date >= viewStart)
            .map(row => {
                const clippedStart = row.start_date < viewStart ? viewStart : row.start_date;
                const clippedEnd = row.end_date > viewEnd ? viewEnd : row.end_date;
                const si = resolveTemplatePreviewGanttColumn(dayIndex, clippedStart, 0);
                const ei = resolveTemplatePreviewGanttColumn(dayIndex, clippedEnd, Math.max(numDays - 1, 0));
                if (si === null || ei === null || si > ei) return null;
                return { task: row, si, ei };
            })
            .filter(Boolean)
            .sort((a, b) =>
                a.si - b.si ||
                a.ei - b.ei ||
                String(a.task.process_station || a.task.station_name || '').localeCompare(String(b.task.process_station || b.task.station_name || ''))
            );

        const laneEnds = [];
        visibleRows.forEach(item => {
            let lane = laneEnds.findIndex(endIndex => item.si > endIndex);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = item.ei;
            item.lane = lane;
        });
        return visibleRows;
    }

    function buildTemplatePreviewModel(blocks) {
        const battalionId = parseInt(document.getElementById('kd2PlanCreateBattalion')?.value || '', 10);
        const startDate = document.getElementById('kd2PlanCreateStart')?.value || '';
        const vehicle = selectedTemplateVehicle();
        const unitSelect = document.getElementById('kd2PlanCreateUnit');
        const normalizedBlocks = normalizeTemplateEditorBlocks(blocks || []);
        if (!normalizedBlocks.length) {
            return { emptyMessage: 'No template items are available to preview yet.' };
        }
        if (!battalionId) {
            return { emptyMessage: 'Select a battalion to build the Gantt preview.' };
        }
        if (!startDate) {
            return { emptyMessage: 'Choose a planned start date to build the Gantt preview.' };
        }

        const rules = planningRulesFor(battalionId, vehicle);
        const battalion = state.battalions.find(row => row.id === battalionId);
        const unitSerial = parseInt(unitSelect?.value || '', 10);
        const unitLabel = unitSelect?.selectedOptions?.[0]?.dataset.unitLabel || unitSelect?.selectedOptions?.[0]?.textContent?.trim() || '';
        const categoryName = code => state.categories.find(item =>
            item.vehicle_type === vehicle && item.category_code === code
        )?.category_name || code || 'No category';
        const segments = [];
        let currentGroup = null;

        normalizedBlocks.forEach((block, index) => {
            if (isTemplateSpaceBlock(block)) {
                segments.push({
                    kind: 'space',
                    gap_days: parseGapDaysValue(block.gap_days),
                    applies_to_next_process: normalizedBlocks.slice(index + 1).some(isTemplateProcessBlock),
                });
                currentGroup = null;
                return;
            }

            const duration = parseLeadTimeValue(block.lead_time_days);
            if (currentGroup && block.parallel_with_previous) {
                currentGroup.items.push({
                    block,
                    duration,
                    station_name: block.station_name || block.station_code || 'Unnamed station',
                    category_name: categoryName(block.category_code),
                });
                return;
            }

            currentGroup = {
                kind: 'process_group',
                sequence: block.route_sequence,
                items: [{
                    block,
                    duration,
                    station_name: block.station_name || block.station_code || 'Unnamed station',
                    category_name: categoryName(block.category_code),
                }],
            };
            segments.push(currentGroup);
        });

        const invalidBlock = segments
            .filter(segment => segment.kind === 'process_group')
            .flatMap(segment => segment.items)
            .find(item => !item.duration || item.duration < 1);
        if (invalidBlock) {
            return { emptyMessage: `Set a valid duration before previewing ${invalidBlock.station_name}.` };
        }

        let currentStart = localDateStr(normalizeWorkingDateForward(startDate, rules));
        const rows = [];

        segments.forEach(segment => {
            if (segment.kind === 'space') {
                if (!segment.applies_to_next_process) return;
                const gapDays = Math.max(parseInt(segment.gap_days, 10) || 0, 0);
                if (gapDays < 1) return;
                currentStart = shiftWorkingDateForward(currentStart, gapDays, rules);
                return;
            }

            const groupRows = segment.items.map(item => {
                const window = buildForwardWindow(currentStart, item.duration, rules);
                return {
                    battalion_id: battalionId,
                    battalion_code: battalion?.battalion_code || '',
                    vehicle_type: vehicle,
                    vehicle,
                    unit_serial: unitSerial,
                    unit_label: unitLabel,
                    vehicle_no: unitLabel,
                    category: item.category_name,
                    category_code: item.block.category_code || '',
                    station_code: item.block.station_code || '',
                    route_sequence: item.block.route_sequence,
                    work_center: item.block.work_center || item.block.station_code || '',
                    process_station: item.station_name,
                    station_name: item.station_name,
                    start_date: window.start,
                    end_date: window.end,
                    duration: item.duration,
                };
            });
            rows.push(...groupRows);
            currentStart = nextWorkingDate(maxDateStr(groupRows.map(row => row.end_date)), rules);
        });

        if (!rows.length) {
            return { emptyMessage: 'No preview rows are available for the selected template.' };
        }

        const viewStart = minDateStr(rows.map(row => row.start_date));
        const viewEnd = maxDateStr(rows.map(row => row.end_date));
        const days = buildDateRange(viewStart, viewEnd);
        const visibleOffDays = state.nonWorkDays
            .filter(row => row.off_date >= viewStart && row.off_date <= viewEnd)
            .map(row => ({ date: row.off_date, is_active: isNoWorkRowActive(row) }));
        return {
            battalion_id: battalionId,
            battalion_code: battalion?.battalion_code || '—',
            vehicle,
            unit_serial: unitSerial,
            unit_label: unitLabel,
            laneLabel: `${battalion?.battalion_code || '—'} · ${vehicle || '—'} · ${unitLabel || '—'}`,
            laneMeta: `${rows.length} block${rows.length === 1 ? '' : 's'} · ${viewStart} -> ${viewEnd}`,
            viewStart,
            viewEnd,
            days,
            totalDays: Math.max(dayDiff(viewStart, viewEnd) + 1, 1),
            rules,
            visibleCategories: [...new Set(rows.map(row => row.category).filter(Boolean))],
            visibleOffDays,
            rows,
        };
    }

    function renderTemplateEditorPreview(blocks) {
        const preview = buildTemplatePreviewModel(blocks);
        if (preview.emptyMessage) {
            return `<div class="empty-state"><p>${escapeHtml(preview.emptyMessage)}</p></div>`;
        }

        const PREVIEW_LABEL_W = 198;
        const PREVIEW_DAY_W = 30;
        const PREVIEW_ROW_H = 36;
        const PREVIEW_GROUP_H = 26;
        const PREVIEW_SUBGROUP_H = 22;
        const PREVIEW_BAR_H = 18;
        const PREVIEW_BAR_GAP = 5;
        const PREVIEW_LANE_H = PREVIEW_BAR_H + PREVIEW_BAR_GAP;

        const days = preview.days.filter(day => parseDateLocal(day).getDay() !== 5);
        if (!days.length) {
            return `<div class="empty-state"><p>No visible Gantt columns are available in the selected preview window.</p></div>`;
        }

        const totalW = days.length * PREVIEW_DAY_W;
        const innerW = PREVIEW_LABEL_W + totalW;
        const today = localDateStr(new Date());
        const dayMeta = days.map(day => {
            const date = parseDateLocal(day);
            return {
                date: day,
                dayNum: date.getDate(),
                month: date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
                week: weekLabel(day),
                isSat: date.getDay() === 6,
                isToday: day === today,
            };
        });
        const dayIndex = Object.fromEntries(days.map((day, index) => [day, index]));
        const specialZones = getGanttSpecialZones(preview.viewStart, preview.viewEnd);

        const holidayStatusesByDay = new Map();
        const holidayLabelsByDay = new Map();
        specialZones
            .filter(zone => (zone?.type === 'holiday' || zone?.type === 'holiday-inactive') && zone.start && zone.end)
            .forEach(zone => {
                const label = String(zone.label || 'No-work Day').trim() || 'No-work Day';
                const isInactive = zone.type === 'holiday-inactive';
                let cursor = zone.start;
                let guard = 0;
                while (cursor <= zone.end && guard < 400) {
                    if (dayIndex[cursor] !== undefined) {
                        holidayStatusesByDay.set(cursor, isInactive ? 'inactive' : 'active');
                        if (!holidayLabelsByDay.has(cursor)) holidayLabelsByDay.set(cursor, new Set());
                        holidayLabelsByDay.get(cursor).add(label);
                    }
                    cursor = addDays(cursor, 1);
                    guard += 1;
                }
            });

        let monthHtml = `<div class="gh-corner" style="width:${PREVIEW_LABEL_W}px;height:28px"></div>`;
        let weekHtml = `<div class="gh-corner" style="width:${PREVIEW_LABEL_W}px;height:22px"></div>`;
        let dayHtml = `<div class="gh-corner gh-corner-label" style="width:${PREVIEW_LABEL_W}px;height:28px">Battalion / Vehicle / Unit</div>`;
        let runMonth = '';
        let runMonthSpan = 0;
        let runWeek = '';
        let runWeekSpan = 0;

        dayMeta.forEach(meta => {
            if (meta.month !== runMonth) {
                if (runMonth) monthHtml += `<div class="gh-month" style="width:${runMonthSpan * PREVIEW_DAY_W}px">${escapeHtml(runMonth)}</div>`;
                runMonth = meta.month;
                runMonthSpan = 1;
            } else {
                runMonthSpan += 1;
            }

            if (meta.week !== runWeek) {
                if (runWeek) weekHtml += `<div class="gh-week" style="width:${runWeekSpan * PREVIEW_DAY_W}px">${escapeHtml(runWeek)}</div>`;
                runWeek = meta.week;
                runWeekSpan = 1;
            } else {
                runWeekSpan += 1;
            }

            const holidayLabels = holidayLabelsByDay.get(meta.date);
            const dayTitle = holidayLabels?.size ? ` title="${escapeHtml([...holidayLabels].join(', '))}"` : '';
            const holidayStatus = holidayStatusesByDay.get(meta.date) || '';
            const holidayClass = holidayStatus === 'inactive'
                ? ' gh-day-holiday-inactive'
                : holidayStatus === 'active'
                    ? ' gh-day-holiday'
                    : '';
            dayHtml += `<div class="gh-day${meta.isSat ? ' gh-day-sat' : ''}${holidayClass}${meta.isToday ? ' gh-day-today' : ''}" data-gantt-date="${meta.date}" style="width:${PREVIEW_DAY_W}px;height:28px"${dayTitle}>${meta.dayNum}</div>`;
        });

        if (runMonth) monthHtml += `<div class="gh-month" style="width:${runMonthSpan * PREVIEW_DAY_W}px">${escapeHtml(runMonth)}</div>`;
        if (runWeek) weekHtml += `<div class="gh-week" style="width:${runWeekSpan * PREVIEW_DAY_W}px">${escapeHtml(runWeek)}</div>`;

        const bgCells = dayMeta.map(meta =>
            `<div class="gc-cell${meta.isSat ? ' gc-cell-sat' : ''}" data-gantt-date="${meta.date}" style="width:${PREVIEW_DAY_W}px"></div>`
        ).join('');

        let zonesHtml = '';
        specialZones.forEach(zone => {
            const start = zone.start > preview.viewStart ? zone.start : preview.viewStart;
            const end = zone.end < preview.viewEnd ? zone.end : preview.viewEnd;
            const startIndex = resolveTemplatePreviewGanttColumn(dayIndex, start, null);
            const endIndex = resolveTemplatePreviewGanttColumn(dayIndex, end, null);
            if (startIndex === null || endIndex === null || startIndex > endIndex) return;
            const left = PREVIEW_LABEL_W + startIndex * PREVIEW_DAY_W;
            const width = (endIndex - startIndex + 1) * PREVIEW_DAY_W;
            const isHolidayZone = zone.type === 'holiday' || zone.type === 'holiday-inactive';
            const zoneTitle = isHolidayZone ? '' : ` title="${escapeHtml(zone.label || zone.type)}"`;
            const zoneLabel = isHolidayZone ? '' : `<span class="gc-zone-label">${escapeHtml(zone.label || zone.type)}</span>`;
            zonesHtml += `
                <div class="gc-zone gc-zone-${escapeHtml(zone.type)}" style="left:${left}px;width:${width}px"${zoneTitle}>
                    ${zoneLabel}
                </div>
            `;
        });
        if (dayIndex[today] !== undefined) {
            const todayLeft = PREVIEW_LABEL_W + dayIndex[today] * PREVIEW_DAY_W + Math.floor(PREVIEW_DAY_W / 2);
            zonesHtml += `<div class="gc-today-line" style="left:${todayLeft}px"></div>`;
        }

        const positioned = buildTemplatePreviewPackedBars(preview.rows, preview.viewStart, preview.viewEnd, dayIndex, days.length);
        const numLanes = positioned.length ? Math.max(...positioned.map(item => item.lane)) + 1 : 1;
        const rowH = Math.max(PREVIEW_ROW_H, numLanes * PREVIEW_LANE_H + PREVIEW_BAR_GAP * 2);

        const barsHtml = positioned.map(({ task, si, ei, lane }) => {
            const left = si * PREVIEW_DAY_W;
            const width = Math.max((ei - si + 1) * PREVIEW_DAY_W - 3, 6);
            const top = PREVIEW_BAR_GAP + lane * PREVIEW_LANE_H + Math.floor((PREVIEW_LANE_H - PREVIEW_BAR_H) / 2);
            const title = [
                `${preview.battalion_code || '—'}  ${preview.vehicle || '—'}  ${preview.unit_label || '—'}`,
                `Station      : ${task.process_station || task.station_name || '—'}`,
                `Work Center  : ${task.work_center || task.station_code || task.category_code || '—'}`,
                `Planned      : ${formatDate(task.start_date)} -> ${formatDate(task.end_date)}`,
            ].filter(Boolean).join('\n');
            return `
                <div
                    class="gc-bar kd2-template-preview-bar"
                    style="left:${left}px;width:${width}px;height:${PREVIEW_BAR_H}px;top:${top}px;transform:none;background:${templatePreviewStationColor(task.process_station || task.station_name)}"
                    title="${escapeHtml(title)}">
                    <span class="gc-bar-text">${escapeHtml(`${task.work_center || task.station_code || task.category_code || '—'} · ${task.process_station || task.station_name || 'Block'}`)}</span>
                </div>
            `;
        }).join('');

        const legendStations = [...new Set(preview.rows.map(row => String(row.process_station || row.station_name || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const legendHtml = legendStations.length ? `
            <div class="gantt-legend">
                <div class="gantt-legend-head">
                    <span class="gantt-legend-title">Visible Stations</span>
                    <span class="gantt-legend-meta">${legendStations.length} station${legendStations.length === 1 ? '' : 's'} in range</span>
                </div>
                <div class="gantt-legend-grid">
                    ${legendStations.map(name => `
                        <div class="gantt-legend-item">
                            <span class="gantt-legend-dot" style="background:${templatePreviewStationColor(name)}"></span>
                            <span class="gantt-legend-label">${escapeHtml(name)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : '';

        const zoneKeyHtml = specialZones.length ? `
            <div class="gantt-zone-key">
                <span class="gantt-zone-key-item gantt-zone-key-holiday">
                    <span class="gantt-zone-key-swatch"></span>Holiday
                </span>
            </div>
        ` : '';

        return `
            <div class="kd2-template-gantt-preview">
                ${legendHtml}
                ${zoneKeyHtml}
                <div class="gantt-scroll-root kd2-template-gantt-scroll">
                    <div class="gantt-wrap" style="min-width:${innerW}px">
                        <div class="gantt-head">
                            <div class="gh-row gh-row-month">${monthHtml}</div>
                            <div class="gh-row gh-row-week">${weekHtml}</div>
                            <div class="gh-row gh-row-day">${dayHtml}</div>
                        </div>
                        <div class="gantt-body">
                            ${zonesHtml}
                            <div class="gr gr-group" style="height:${PREVIEW_GROUP_H}px">
                                <div class="gr-label gr-group-label" style="width:${PREVIEW_LABEL_W}px">
                                    <svg class="gr-label-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <rect x="2" y="3" width="12" height="10" rx="1.5"></rect>
                                        <path d="M5 8h6M5 11h4"></path>
                                    </svg>
                                    ${escapeHtml(preview.battalion_code || '—')}
                                </div>
                                <div class="gr-track gr-track-group" style="width:${totalW}px">${bgCells}</div>
                            </div>
                            <div class="gr gr-subgroup" style="height:${PREVIEW_SUBGROUP_H}px">
                                <div class="gr-label gr-subgroup-label" style="width:${PREVIEW_LABEL_W}px">
                                    <span class="gr-subgroup-badge">${escapeHtml(preview.vehicle || '—')}</span>
                                </div>
                                <div class="gr-track gr-track-subgroup" style="width:${totalW}px">${bgCells}</div>
                            </div>
                            <div class="gr" style="height:${rowH}px">
                                <div class="gr-label gr-unit-label" style="width:${PREVIEW_LABEL_W}px">
                                    <span class="gr-unit-dot"></span>
                                    <span class="gr-unit-name">${escapeHtml(`${preview.vehicle || '—'} · ${preview.unit_label || '—'}`)}</span>
                                </div>
                                <div class="gr-track" style="width:${totalW}px;height:${rowH}px">
                                    ${bgCells}
                                    ${barsHtml}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderTemplateEditor() {
        const container = document.getElementById('kd2TemplateEditor');
        if (!container) return;
        const vehicle = selectedTemplateVehicle();
        ensureTemplateEditorState(vehicle);
        if (state.templateInsertIndex !== null && state.templateInsertIndex > state.templateEditorBlocks.length) {
            state.templateInsertIndex = state.templateEditorBlocks.length;
        }
        syncTemplateEditorChrome();
        container.classList.toggle('kd2-template-editor-preview', state.templateEditorView === 'preview');
        container.innerHTML = state.templateEditorView === 'visual'
            ? renderTemplateEditorVisual(state.templateEditorBlocks)
            : state.templateEditorView === 'preview'
                ? renderTemplateEditorPreview(state.templateEditorBlocks)
                : renderTemplateEditorForm(state.templateEditorBlocks);
        container.dataset.rendered = 'true';
    }

    function createNewTemplateItem(kind, vehicle) {
        state.templateNewRowCounter += 1;
        if (kind === 'space') {
            return createTemplateSpaceBlock(vehicle, {
                editor_id: `space_${state.templateNewRowCounter}`,
                gap_days: 1,
            });
        }
        return createTemplateProcessBlock(vehicle, {
            editor_id: `new_${state.templateNewRowCounter}`,
            isNew: true,
            vehicle_type: vehicle,
            category_code: 'assembly',
            station_code: null,
            station_name: '',
            work_center: '',
            route_sequence: nextTemplateRoute(vehicle),
            lead_time_days: null,
            notes: 'Editable route template default',
            station_sequence_in_category: null,
            parallel_with_previous: false,
        });
    }

    function addTemplateDraftRow(kind = 'process', insertIndex = null) {
        syncTemplateEditorStateFromDom({ normalizeForVisual: state.templateEditorView === 'visual' });
        const vehicle = selectedTemplateVehicle();
        ensureTemplateEditorState(vehicle);
        const safeIndex = Number.isInteger(insertIndex) ? Math.max(0, Math.min(insertIndex, state.templateEditorBlocks.length)) : state.templateEditorBlocks.length;
        state.templateEditorBlocks.splice(safeIndex, 0, createNewTemplateItem(kind, vehicle));
        if (state.templateEditorView === 'visual') {
            state.templateEditorBlocks = normalizeTemplateEditorBlocks(state.templateEditorBlocks);
        }
        state.templateInsertIndex = null;
        renderTemplateEditor();
    }

    function readTemplateRows({ normalize = false } = {}) {
        syncTemplateEditorStateFromDom();
        const blocks = normalize ? normalizeTemplateEditorBlocks(state.templateEditorBlocks) : state.templateEditorBlocks;
        return blocks.map(block => ({ ...block }));
    }

    function moveTemplateEditorBlock(editorId, delta) {
        syncTemplateEditorStateFromDom({ normalizeForVisual: state.templateEditorView === 'visual' });
        const index = state.templateEditorBlocks.findIndex(block => block.editor_id === editorId);
        if (index < 0) return;
        const nextIndex = index + delta;
        if (nextIndex < 0 || nextIndex >= state.templateEditorBlocks.length) return;
        const [moved] = state.templateEditorBlocks.splice(index, 1);
        state.templateEditorBlocks.splice(nextIndex, 0, moved);
        state.templateEditorBlocks = normalizeTemplateEditorBlocks(state.templateEditorBlocks);
        state.templateInsertIndex = null;
        renderTemplateEditor();
    }

    function toggleTemplateInsertChooser(index) {
        syncTemplateEditorStateFromDom({ normalizeForVisual: state.templateEditorView === 'visual' });
        const safeIndex = Math.max(0, Math.min(index, state.templateEditorBlocks.length));
        state.templateInsertIndex = state.templateInsertIndex === safeIndex ? null : safeIndex;
        renderTemplateEditor();
    }

    function convertTemplateBlockKind(editorId, nextKind) {
        syncTemplateEditorStateFromDom({ normalizeForVisual: false });
        const index = state.templateEditorBlocks.findIndex(block => block.editor_id === editorId);
        if (index < 0) return;
        const block = state.templateEditorBlocks[index];
        if ((nextKind === 'space' && isTemplateSpaceBlock(block)) || (nextKind === 'process' && isTemplateProcessBlock(block))) return;
        if (nextKind === 'space') {
            if (block.station_code && !block.isNew) state.templateRemovedStations.add(block.station_code);
            state.templateEditorBlocks[index] = createTemplateSpaceBlock(block.vehicle_type, {
                editor_id: block.editor_id,
                gap_days: 1,
                source_process: { ...block },
            });
        } else {
            const restored = block.source_process
                ? createTemplateProcessBlock(block.vehicle_type, {
                    ...block.source_process,
                    editor_id: block.editor_id,
                })
                : createTemplateProcessBlock(block.vehicle_type, {
                    editor_id: block.editor_id,
                    isNew: true,
                    vehicle_type: block.vehicle_type,
                    category_code: 'assembly',
                    station_code: null,
                    station_name: '',
                    work_center: '',
                    route_sequence: nextTemplateRoute(block.vehicle_type),
                    lead_time_days: null,
                    station_sequence_in_category: null,
                    parallel_with_previous: false,
                });
            if (restored.station_code && !restored.isNew) state.templateRemovedStations.delete(restored.station_code);
            state.templateEditorBlocks[index] = restored;
        }
        state.templateEditorBlocks = normalizeTemplateEditorBlocks(state.templateEditorBlocks);
        state.templateInsertIndex = null;
        renderTemplateEditor();
    }

    function buildTemplateLayoutSegments(vehicle) {
        const layoutBlocks = templateEditorBlocksForVehicle(vehicle);
        const routeItemMap = new Map(templateRowsForVehicle(vehicle).map(item => [item.route.station_code, item]));
        const segments = [];
        let currentGroup = null;

        layoutBlocks.forEach((block, index) => {
            if (isTemplateSpaceBlock(block)) {
                const hasFollowingProcess = layoutBlocks.slice(index + 1).some(isTemplateProcessBlock);
                segments.push({
                    kind: 'space',
                    gap_days: parseGapDaysValue(block.gap_days),
                    applies_to_next_process: hasFollowingProcess,
                });
                currentGroup = null;
                return;
            }

            const routeItem = routeItemMap.get(block.station_code);
            if (!routeItem) return;
            const processItem = {
                layout: block,
                route: routeItem.route,
                station: routeItem.station,
                category: routeItem.category,
                duration: block.lead_time_days ?? routeItem.duration ?? defaultDurationForStation(vehicle, routeItem.route.category_code, routeItem.route.station_code),
            };
            if (!currentGroup || !block.parallel_with_previous) {
                currentGroup = {
                    kind: 'process_group',
                    sequence: block.route_sequence,
                    items: [],
                };
                segments.push(currentGroup);
            }
            currentGroup.items.push(processItem);
        });

        return {
            layoutBlocks,
            segments,
            processItems: segments.flatMap(segment => segment.kind === 'process_group' ? segment.items : []),
        };
    }

    async function saveTemplateDefaults({ silent = false } = {}) {
        if (!dbRef) return false;
        const rows = readTemplateRows({ normalize: true });
        const selectedVehicle = document.getElementById('kd2PlanCreateVehicle')?.value || 'K9';
        if (!rows.length && !state.templateRemovedStations.size) {
            setPlanCreateError('No template rows are available to save.');
            return false;
        }
        const processRows = rows.filter(isTemplateProcessBlock);
        const missingName = processRows.find(row => row.isNew && !row.station_name);
        if (missingName) {
            setPlanCreateError('Every new template block needs a station name.');
            return false;
        }
        const missingCategory = processRows.find(row => !row.category_code);
        if (missingCategory) {
            setPlanCreateError('Every template row needs a category.');
            return false;
        }
        const invalid = processRows.find(row => row.lead_time_days === null);
        if (invalid) {
            setPlanCreateError('Every template row needs a duration before saving or adding the template.');
            return false;
        }
        const invalidGap = rows.find(row => isTemplateSpaceBlock(row) && Number.isNaN(parseGapDaysValue(row.gap_days)));
        if (invalidGap) {
            setPlanCreateError('Every space block needs skipped working days greater than 0.');
            return false;
        }
        const vehicle = rows[0]?.vehicle_type || selectedVehicle;
        const before = state.leadTimes.filter(row => row.vehicle_type === vehicle);
        const routeBefore = state.routes
            .filter(row => row.vehicle_type === vehicle)
            .map(row => ({ station_code: row.station_code, route_sequence: row.route_sequence }));
        const layoutBefore = templateLayoutRowsForVehicle(vehicle).map(row => ({
            sort_order: row.sort_order,
            kind: row.kind,
            station_code: row.station_code,
            parallel_with_previous: row.parallel_with_previous,
            gap_days: row.gap_days,
        }));
        const existingCodes = new Set(state.stations.map(row => `${row.vehicle_type}||${row.station_code}`));
        const categorySequenceCounters = new Map();
        for (const row of processRows) {
            if (!row.isNew) continue;
            const base = `${row.vehicle_type.toLowerCase()}_${row.category_code}_${slugifyStationName(row.station_name)}`;
            let stationCode = base;
            let suffix = 2;
            while (existingCodes.has(`${row.vehicle_type}||${stationCode}`) || processRows.some(other => other !== row && other.station_code === stationCode)) {
                stationCode = `${base}_${suffix}`;
                suffix += 1;
            }
            row.station_code = stationCode;
            existingCodes.add(`${row.vehicle_type}||${stationCode}`);
            const key = `${row.vehicle_type}||${row.category_code}`;
            
            let currentMax = categorySequenceCounters.get(key);
            if (currentMax === undefined) {
                const { data: maxSeqData } = await dbRef
                    .from('kd2_process_stations')
                    .select('station_sequence_in_category')
                    .eq('vehicle_type', row.vehicle_type)
                    .eq('category_code', row.category_code)
                    .order('station_sequence_in_category', { ascending: false })
                    .limit(1);
                currentMax = (maxSeqData && maxSeqData.length > 0) ? maxSeqData[0].station_sequence_in_category : 0;
            }
            row.station_sequence_in_category = currentMax + 1;
            categorySequenceCounters.set(key, row.station_sequence_in_category);
        }
        const leadRows = processRows.map(row => ({
            vehicle_type: row.vehicle_type,
            category_code: row.category_code,
            station_code: row.station_code,
            planning_level: row.planning_level,
            lead_time_days: row.lead_time_days,
            lead_time_source: row.lead_time_source,
            notes: row.notes,
        }));

        for (const row of processRows) {
            if (row.isNew) {
                const stationPayload = {
                    vehicle_type: row.vehicle_type,
                    category_code: row.category_code,
                    station_code: row.station_code,
                    station_name: row.station_name,
                    work_center: normalizeWorkCenter(row.work_center) || null,
                    station_sequence_in_category: row.station_sequence_in_category,
                    route_sequence: row.route_sequence,
                    is_active: true,
                    notes: 'Added from KD2 template editor',
                };
                const { data: existing, error: checkError } = await dbRef
                    .from('kd2_process_stations')
                    .select('*')
                    .eq('vehicle_type', row.vehicle_type)
                    .eq('station_code', row.station_code);
                
                if (checkError && checkError.code !== 'PGRST116') throw checkError;
                
                if (existing && existing.length > 0) {
                    const { error: stationError } = await dbRef
                        .from('kd2_process_stations')
                        .update({ route_sequence: row.route_sequence, is_active: true })
                        .eq('vehicle_type', row.vehicle_type)
                        .eq('station_code', row.station_code);
                    if (stationError) throw stationError;
                } else {
                    const { error: stationError } = await dbRef.from('kd2_process_stations').insert(stationPayload);
                    if (stationError) throw stationError;
                }
            } else {
                const { error: stationError } = await dbRef
                    .from('kd2_process_stations')
                    .update({ route_sequence: row.route_sequence, is_active: true })
                    .eq('vehicle_type', row.vehicle_type)
                    .eq('station_code', row.station_code);
                if (stationError) throw stationError;
            }

            const { error: routeError } = await dbRef
                .from('kd2_process_routes')
                .upsert({
                    vehicle_type: row.vehicle_type,
                    category_code: row.category_code,
                    station_code: row.station_code,
                    route_sequence: row.route_sequence,
                    is_active: true,
                }, { onConflict: 'vehicle_type,station_code' });
            if (routeError) throw routeError;
        }

        if (leadRows.length) {
            const { error } = await dbRef
                .from('kd2_process_lead_times')
                .upsert(leadRows, { onConflict: 'vehicle_type,category_code,station_code,planning_level' });
            if (error) throw error;
        }

        for (const stationCode of state.templateRemovedStations) {
            const { error: stationError } = await dbRef
                .from('kd2_process_stations')
                .update({ is_active: false })
                .eq('vehicle_type', vehicle)
                .eq('station_code', stationCode);
            if (stationError) throw stationError;

            const { error: routeError } = await dbRef
                .from('kd2_process_routes')
                .update({ is_active: false })
                .eq('vehicle_type', vehicle)
                .eq('station_code', stationCode);
            if (routeError) throw routeError;
        }

        const layoutRows = rows.map((row, index) => ({
            vehicle_type: vehicle,
            sort_order: index + 1,
            kind: row.kind,
            station_code: isTemplateProcessBlock(row) ? row.station_code : null,
            parallel_with_previous: isTemplateProcessBlock(row) ? Boolean(row.parallel_with_previous) : false,
            gap_days: isTemplateSpaceBlock(row) ? parseGapDaysValue(row.gap_days) : null,
        }));
        const layoutRequiresStorage = layoutRows.some(row => row.kind === 'space');
        let layoutSaved = false;
        if (!state.templateLayoutTableAvailable) {
            if (layoutRequiresStorage) {
                setPlanCreateError(templateLayoutMigrationMessage());
                return false;
            }
        } else {
            const { error: deleteLayoutError } = await dbRef
                .from('kd2_template_layout_items')
                .delete()
                .eq('vehicle_type', vehicle);
            if (deleteLayoutError) {
                if (isMissingSchemaTableError(deleteLayoutError, 'kd2_template_layout_items')) {
                    state.templateLayoutTableAvailable = false;
                    if (layoutRequiresStorage) {
                        setPlanCreateError(templateLayoutMigrationMessage());
                        return false;
                    }
                } else {
                    throw deleteLayoutError;
                }
            } else {
                if (layoutRows.length) {
                    const { error: insertLayoutError } = await dbRef
                        .from('kd2_template_layout_items')
                        .insert(layoutRows);
                    if (insertLayoutError) {
                        if (isMissingSchemaTableError(insertLayoutError, 'kd2_template_layout_items')) {
                            state.templateLayoutTableAvailable = false;
                            if (layoutRequiresStorage) {
                                setPlanCreateError(templateLayoutMigrationMessage());
                                return false;
                            }
                        } else {
                            throw insertLayoutError;
                        }
                    } else {
                        layoutSaved = true;
                    }
                } else {
                    layoutSaved = true;
                }
            }
        }

        await writeAudit('UPSERT', 'kd2_process_lead_times', vehicle || 'template', before, leadRows);
        await writeAudit('UPDATE', 'kd2_process_routes', vehicle || 'template', routeBefore, rows.map(row => ({
            station_code: row.station_code || null,
            route_sequence: row.route_sequence || null,
        })));
        if (layoutSaved) {
            await writeAudit('REPLACE', 'kd2_template_layout_items', vehicle || 'template', layoutBefore, layoutRows);
        }
        state.templateRemovedStations.clear();
        state.templateInsertIndex = null;
        await loadWorkspaceData();
        await helpers.reloadAll?.();
        ensureTemplateEditorState(vehicle, { force: true });
        renderTemplateEditor();
        updatePlanCreateDurationFromStation(true);
        if (!silent) toast('KD2 template defaults saved.', 'success');
        return true;
    }

    async function openPlanCreateModal() {
        if (!canManageKD2()) {
            toast('Only planners and admins can add KD2 plan rows.', 'error');
            return;
        }
        try {
            if (!state.battalions.length || !state.stations.length) await loadWorkspaceData();
        } catch (error) {
            toast(`KD2 setup load failed: ${error.message}`, 'error');
            return;
        }
        if (!state.battalions.length) {
            toast('Create or bootstrap a KD2 battalion before adding plan blocks.', 'error');
            return;
        }

        const battalionSelect = document.getElementById('kd2PlanCreateBattalion');
        const currentBattalion = getBattalionFilterValue();
        battalionSelect.innerHTML = state.battalions.map(row => `
            <option value="${row.id}">${escapeHtml(row.battalion_code)}${row.battalion_name ? ` · ${escapeHtml(row.battalion_name)}` : ''}</option>
        `).join('');

        const filteredBattalion = state.battalions.find(row => row.battalion_code === currentBattalion);
        battalionSelect.value = String(filteredBattalion?.id || state.battalions[0].id);
        state.templateRemovedStations.clear();
        state.templateNewRowCounter = 0;
        state.templateEditorView = 'visual';
        state.templateEditorVehicle = '';
        state.templateEditorBlocks = [];
        state.templateInsertIndex = null;
        const defaultDate = document.getElementById('kd2TimelineStart')?.value || localDateStr(new Date());
        const defaultVehicle = getVehicleFilterValue() || state.timelinePlacementVehicle || 'K9';
        document.getElementById('kd2PlanCreateVehicle').value = defaultVehicle;
        setTimelinePlacementVehicle(defaultVehicle);
        document.getElementById('kd2PlanCreateStart').value = defaultDate;
        document.getElementById('kd2PlanCreateEnd').value = defaultDate;
        document.getElementById('kd2PlanCreateDuration').value = '';
        document.getElementById('kd2PlanCreateRemark').value = '';
        populatePlanCreateStations();
        populatePlanCreateUnits();
        if (selectedCreateStation()?.station_code) {
            state.timelinePlacementStationCode = selectedCreateStation().station_code;
        } else if (!state.timelinePlacementStationCode) {
            state.timelinePlacementStationCode = firstPlacementStation(defaultVehicle)?.station_code || '';
        }
        setPlanCreateMode('block');
        setPlanCreateError('');
        syncTimelinePlacementUi();
        movePlanCreateOverlayToActiveHost();
        document.getElementById('kd2PlanCreateOverlay').style.display = 'flex';
    }

    function setPlanningError(message) {
        const el = document.getElementById('kd2PlanningError');
        if (!el) return;
        el.textContent = message;
        el.style.display = message ? 'flex' : 'none';
    }

    function resetPlanningModal() {
        document.getElementById('kd2BattalionId').value = '';
        document.getElementById('kd2BattalionCode').value = '';
        document.getElementById('kd2BattalionName').value = '';
        document.getElementById('kd2BattalionDeadline').value = '';
        document.getElementById('kd2BattalionNotes').value = '';
        VEHICLES.forEach(vehicle => {
            document.getElementById(`kd2Qty${vehicle}`).value = '';
            document.getElementById(`kd2Deadline${vehicle}`).value = '';
            document.getElementById(`kd2Status${vehicle}`).value = 'pending';
            document.getElementById(`kd2SkipFriday${vehicle}`).checked = true;
        });
        setPlanningError('');
    }

    function openPlanningModal(battalionId = null) {
        if (!canManageKD2()) {
            toast('Only planners and admins can manage KD2 planning inputs.', 'error');
            return;
        }

        resetPlanningModal();
        if (battalionId) {
            const battalion = state.battalions.find(row => row.id === battalionId);
            if (battalion) {
                document.getElementById('kd2BattalionId').value = battalion.id;
                document.getElementById('kd2BattalionCode').value = battalion.battalion_code || '';
                document.getElementById('kd2BattalionName').value = battalion.battalion_name || '';
                document.getElementById('kd2BattalionDeadline').value = battalion.delivery_deadline || '';
                document.getElementById('kd2BattalionNotes').value = battalion.notes || '';
            }

            VEHICLES.forEach(vehicle => {
                const input = inputFor(battalionId, vehicle);
                if (!input) return;
                document.getElementById(`kd2Qty${vehicle}`).value = input.required_quantity ?? '';
                document.getElementById(`kd2Deadline${vehicle}`).value = input.delivery_deadline || '';
                document.getElementById(`kd2Status${vehicle}`).value = input.assumptions_status || 'pending';
                document.getElementById(`kd2SkipFriday${vehicle}`).checked = input.skip_friday !== false;
            });
        }

        document.getElementById('kd2PlanningOverlay').style.display = 'flex';
    }

    function closePlanningModal() {
        document.getElementById('kd2PlanningOverlay').style.display = 'none';
    }

    async function savePlanningInputs() {
        if (!dbRef) return;
        if (!canManageKD2()) {
            toast('Only planners and admins can manage KD2 planning inputs.', 'error');
            return;
        }

        const battalionId = document.getElementById('kd2BattalionId').value;
        const battalionCode = document.getElementById('kd2BattalionCode').value.trim();
        const battalionName = document.getElementById('kd2BattalionName').value.trim();
        const battalionDeadline = document.getElementById('kd2BattalionDeadline').value || null;
        const battalionNotes = document.getElementById('kd2BattalionNotes').value.trim();

        if (!battalionCode) {
            setPlanningError('Battalion code is required.');
            return;
        }

        try {
            const existingBattalion = battalionId
                ? state.battalions.find(row => String(row.id) === String(battalionId)) || null
                : null;
            const existingInputs = battalionId
                ? VEHICLES.map(vehicle => inputFor(parseInt(battalionId, 10), vehicle)).filter(Boolean)
                : [];
            let battalion;
            if (battalionId) {
                const { data, error } = await dbRef
                    .from('kd2_battalions')
                    .update({
                        battalion_code: battalionCode,
                        battalion_name: battalionName || null,
                        delivery_deadline: battalionDeadline,
                        notes: battalionNotes || null,
                    })
                    .eq('id', battalionId)
                    .select()
                    .single();
                if (error) throw error;
                battalion = data;
            } else {
                const { data, error } = await dbRef
                    .from('kd2_battalions')
                    .insert({
                        battalion_code: battalionCode,
                        battalion_name: battalionName || null,
                        delivery_deadline: battalionDeadline,
                        notes: battalionNotes || null,
                    })
                    .select()
                    .single();
                if (error) throw error;
                battalion = data;
            }

            const inputRows = VEHICLES.map(vehicle => {
                const qtyRaw = document.getElementById(`kd2Qty${vehicle}`).value.trim();
                return {
                    battalion_id: battalion.id,
                    vehicle_type: vehicle,
                    required_quantity: qtyRaw === '' ? null : parseInt(qtyRaw, 10),
                    delivery_deadline: document.getElementById(`kd2Deadline${vehicle}`).value || null,
                    skip_friday: document.getElementById(`kd2SkipFriday${vehicle}`).checked,
                    include_saturday: KD2_SATURDAY_WORKING,
                    assumptions_status: document.getElementById(`kd2Status${vehicle}`).value,
                    notes: null,
                };
            });

            const { error: upsertError } = await dbRef
                .from('kd2_planning_inputs')
                .upsert(inputRows, { onConflict: 'battalion_id,vehicle_type' });
            if (upsertError) throw upsertError;

            await writeAudit(
                battalionId ? 'UPDATE' : 'CREATE',
                'kd2_battalions',
                battalion.id,
                existingBattalion,
                battalion
            );
            await writeAudit(
                'UPSERT',
                'kd2_planning_inputs',
                battalion.id,
                existingInputs,
                inputRows
            );

            toast('KD2 planning inputs saved.', 'success');
            closePlanningModal();
            await refreshWorkspace();
            await helpers.reloadAll?.();
        } catch (error) {
            setPlanningError(error.message);
        }
    }

    function buildUnitsForVehicle(battalionId, vehicleType, quantity, unitRows) {
        const map = new Map(
            unitRows
                .filter(row => row.battalion_id === battalionId && row.vehicle_type === vehicleType)
                .map(row => [row.unit_serial, row])
        );
        const units = [];
        for (let i = 1; i <= quantity; i += 1) {
            const unit = map.get(i);
            units.push({ unit_serial: i, unit_label: unit?.unit_label || null });
        }
        return units;
    }

    function routeItemsForVehicle(vehicle) {
        return state.routes
            .filter(row => row.vehicle_type === vehicle && stationCodeMatchesVehicle(vehicle, row.station_code))
            .sort((a, b) =>
                (parseInt(a.route_sequence, 10) || 9999) - (parseInt(b.route_sequence, 10) || 9999) ||
                String(a.station_code || '').localeCompare(String(b.station_code || ''))
            )
            .map(route => ({
                route,
                station: state.stations.find(item =>
                    item.vehicle_type === vehicle &&
                    item.station_code === route.station_code &&
                    stationAllowedForVehicle(item)
                ),
                category: state.categories.find(item => item.vehicle_type === vehicle && item.category_code === route.category_code),
            }))
            .filter(item => item.station && item.category);
    }

    function groupRouteItems(routeItems) {
        const groups = [];
        routeItems.forEach(item => {
            const sequence = parseInt(item.route.route_sequence, 10) || 9999;
            let group = groups.find(row => row.sequence === sequence);
            if (!group) {
                group = { sequence, items: [] };
                groups.push(group);
            }
            group.items.push(item);
        });
        groups.forEach(group => group.items.sort((a, b) =>
            (parseInt(a.station?.station_sequence_in_category, 10) || 9999) -
            (parseInt(b.station?.station_sequence_in_category, 10) || 9999) ||
            String(a.station?.station_name || '').localeCompare(String(b.station?.station_name || ''))
        ));
        return groups.sort((a, b) => a.sequence - b.sequence);
    }

    function planningRulesFor(battalionId, vehicle) {
        return planningRulesForOffDates(battalionId, vehicle, state.nonWorkDaySet);
    }

    function planningRulesForOffDates(battalionId, vehicle, offDates) {
        const input = inputFor(battalionId, vehicle);
        return withWorkingRules({
            skipFriday: input?.skip_friday !== false,
            includeSaturday: KD2_SATURDAY_WORKING,
            offDates,
        });
    }

    function workingRulesForPlanRow(row) {
        return planningRulesFor(row?.battalion_id, row?.vehicle || row?.vehicle_type);
    }

    function shiftPlanRowToStart(row, startDateStr) {
        const rules = workingRulesForPlanRow(row);
        const duration = Math.max(durationFromPlannedWindow(row?.start_date, row?.end_date, rules), 1);
        return buildForwardWindow(startDateStr, duration, rules);
    }

    function getGanttSpecialZones(startDate = '', endDate = '') {
        return getNonWorkDayGroups()
            .filter(group => !startDate || !endDate || (group.start <= endDate && group.end >= startDate))
            .map(group => ({
                start: group.start,
                end: group.end,
                type: group.is_active === false ? 'holiday-inactive' : 'holiday',
                label: group.is_active === false
                    ? (group.label ? `${group.label} (inactive)` : 'Inactive no-work day')
                    : (group.label || 'No-work Day'),
            }));
    }

    function planLaneKey(row) {
        return [row?.battalion_id ?? '', row?.vehicle_type ?? '', row?.unit_serial ?? ''].join('||');
    }

    function routeSequenceValue(row) {
        return parseInt(row?.route_sequence, 10) || 9999;
    }

    function stationSequenceValue(row) {
        return parseInt(row?.station_sequence_in_category, 10) || 9999;
    }

    function comparePlanRowsByLaneOrder(a, b) {
        return routeSequenceValue(a) - routeSequenceValue(b) ||
            stationSequenceValue(a) - stationSequenceValue(b) ||
            String(a.station_code || '').localeCompare(String(b.station_code || '')) ||
            String(a.planned_start_date || a.start_date || '').localeCompare(String(b.planned_start_date || b.start_date || '')) ||
            (a.id || 0) - (b.id || 0);
    }

    function sortPlanRowsForRecalc(rows = []) {
        return rows.slice().sort(comparePlanRowsByLaneOrder);
    }

    function buildPlanGroupsForRecalc(rows = [], rulesOffDates) {
        const groups = [];
        sortPlanRowsForRecalc(rows).forEach(row => {
            const routeSequence = parseInt(row.route_sequence, 10) || 9999;
            let group = groups.find(item => item.routeSequence === routeSequence);
            if (!group) {
                group = {
                    routeSequence,
                    rows: [],
                    start: '',
                    end: '',
                    offsetFromPreviousGroup: 0,
                };
                groups.push(group);
            }
            group.rows.push(row);
            group.start = group.start && group.start < row.planned_start_date ? group.start : row.planned_start_date;
            group.end = group.end && group.end > row.planned_end_date ? group.end : row.planned_end_date;
        });
        groups.forEach((group, index) => {
            group.rows = sortPlanRowsForRecalc(group.rows);
            if (index === 0) {
                group.offsetFromPreviousGroup = 0;
                return;
            }
            const previousGroup = groups[index - 1];
            const rules = planningRulesForOffDates(group.rows[0].battalion_id, group.rows[0].vehicle_type, rulesOffDates);
            const baselineStart = nextWorkingDate(previousGroup.end, rules);
            group.offsetFromPreviousGroup = workingDayOffsetBetween(baselineStart, group.start, rules);
        });
        return groups;
    }

    function getPlanMoveRowsFromAnchor(anchorRow, rows = []) {
        if (!anchorRow) return [];
        const laneRows = sortPlanRowsForRecalc(rows.filter(row => planLaneKey(row) === planLaneKey(anchorRow)));
        if (!laneRows.length) return [];
        const anchor = laneRows.find(row => row.id === anchorRow.id);
        if (!anchor) return [];
        const anchorRouteSequence = routeSequenceValue(anchor);
        return laneRows.filter(row => routeSequenceValue(row) >= anchorRouteSequence);
    }

    async function applyTargetedNoWorkReschedule(addedOffDatesSet, previousOffDatesSet) {
        if (!dbRef || !addedOffDatesSet.size) return 0;
        const sortedOff = [...addedOffDatesSet].sort();
        const firstOff = sortedOff[0];
        const lastOff = sortedOff[sortedOff.length - 1];
        const nextOffDatesSet = new Set([...previousOffDatesSet, ...addedOffDatesSet]);
        const { data: planRows, error } = await dbRef
            .from('kd2_plan')
            .select('id, battalion_id, vehicle_type, unit_serial, unit_label, route_sequence, station_sequence_in_category, station_code, planned_start_date, planned_end_date, schedule_week')
            .lte('planned_start_date', lastOff)
            .gte('planned_end_date', firstOff);
        if (error) throw error;
        if (!planRows?.length) return 0;
        const changes = [];
        planRows.forEach(row => {
            const start = row.planned_start_date;
            const end = row.planned_end_date;
            if (!start || !end || start > lastOff || end < firstOff) return;
            const oldRules = planningRulesForOffDates(row.battalion_id, row.vehicle_type, previousOffDatesSet);
            const newRules = planningRulesForOffDates(row.battalion_id, row.vehicle_type, nextOffDatesSet);
            const duration = Math.max(durationFromPlannedWindow(start, end, oldRules), 1);
            const newWindow = buildForwardWindow(start, duration, newRules);
            if (newWindow.start !== start || newWindow.end !== end) {
                changes.push({
                    id: row.id, stationCode: row.station_code,
                    oldBattalionId: row.battalion_id, oldVehicleType: row.vehicle_type,
                    oldUnitSerial: row.unit_serial, oldUnitLabel: row.unit_label || null,
                    oldStart: start, oldEnd: end,
                    newBattalionId: row.battalion_id, newVehicleType: row.vehicle_type,
                    newUnitSerial: row.unit_serial, newUnitLabel: row.unit_label || null,
                    newStart: newWindow.start, newEnd: newWindow.end,
                });
            }
        });
        if (!changes.length) return 0;
        await persistTimelineChanges(changes, 'kd2-non-work-targeted-apply');
        return changes.length;
    }

    async function revertTargetedNoWorkReschedule(removedOffDatesSet, remainingOffDatesSet) {
        if (!dbRef || !removedOffDatesSet.size) return 0;
        const sortedOff = [...removedOffDatesSet].sort();
        const firstOff = sortedOff[0];
        const lastOff = sortedOff[sortedOff.length - 1];
        const previousOffDatesSet = new Set([...remainingOffDatesSet, ...removedOffDatesSet]);
        const { data: planRows, error } = await dbRef
            .from('kd2_plan')
            .select('id, battalion_id, vehicle_type, unit_serial, unit_label, route_sequence, station_sequence_in_category, station_code, planned_start_date, planned_end_date, schedule_week')
            .lte('planned_start_date', lastOff)
            .gte('planned_end_date', firstOff);
        if (error) throw error;
        if (!planRows?.length) return 0;
        const changes = [];
        planRows.forEach(row => {
            const start = row.planned_start_date;
            const end = row.planned_end_date;
            if (!start || !end || start > lastOff || end < firstOff) return;
            const oldRules = planningRulesForOffDates(row.battalion_id, row.vehicle_type, previousOffDatesSet);
            const newRules = planningRulesForOffDates(row.battalion_id, row.vehicle_type, remainingOffDatesSet);
            const duration = Math.max(durationFromPlannedWindow(start, end, oldRules), 1);
            const newWindow = buildForwardWindow(start, duration, newRules);
            if (newWindow.start !== start || newWindow.end !== end) {
                changes.push({
                    id: row.id, stationCode: row.station_code,
                    oldBattalionId: row.battalion_id, oldVehicleType: row.vehicle_type,
                    oldUnitSerial: row.unit_serial, oldUnitLabel: row.unit_label || null,
                    oldStart: start, oldEnd: end,
                    newBattalionId: row.battalion_id, newVehicleType: row.vehicle_type,
                    newUnitSerial: row.unit_serial, newUnitLabel: row.unit_label || null,
                    newStart: newWindow.start, newEnd: newWindow.end,
                });
            }
        });
        if (!changes.length) return 0;
        await persistTimelineChanges(changes, 'kd2-non-work-targeted-revert');
        return changes.length;
    }

    async function recalculatePlanWindowsForNonWorkDayChange(previousOffDates, nextOffDates, auditLabel) {
        if (!dbRef) return 0;
        const { data: planRows, error } = await dbRef
            .from('kd2_plan')
            .select('id, battalion_id, vehicle_type, unit_serial, unit_label, route_sequence, station_sequence_in_category, station_code, planned_start_date, planned_end_date, schedule_week')
            .order('battalion_id')
            .order('vehicle_type')
            .order('unit_serial')
            .order('route_sequence')
            .order('station_sequence_in_category');
        if (error) throw error;
        if (!planRows?.length) return 0;

        const lanes = new Map();
        planRows.forEach(row => {
            const key = planLaneKey(row);
            if (!lanes.has(key)) lanes.set(key, []);
            lanes.get(key).push(row);
        });

        const changes = [];
        lanes.forEach(laneRows => {
            const groups = buildPlanGroupsForRecalc(laneRows, previousOffDates);
            if (!groups.length) return;

            let impacted = false;
            let previousNewGroupEnd = '';
            groups.forEach((group, index) => {
                let currentStart = group.start;
                if (index > 0) {
                    const boundaryRules = planningRulesForOffDates(group.rows[0].battalion_id, group.rows[0].vehicle_type, nextOffDates);
                    const baselineStart = nextWorkingDate(previousNewGroupEnd || groups[index - 1].end, boundaryRules);
                    currentStart = shiftWorkingDateByOffset(baselineStart, group.offsetFromPreviousGroup, boundaryRules);
                }
                const groupChanges = [];
                const groupEnds = [];
                group.rows.forEach(row => {
                    const oldRules = planningRulesForOffDates(row.battalion_id, row.vehicle_type, previousOffDates);
                    const newRules = planningRulesForOffDates(row.battalion_id, row.vehicle_type, nextOffDates);
                    const duration = Math.max(durationFromPlannedWindow(row.planned_start_date, row.planned_end_date, oldRules), 1);
                    const window = buildForwardWindow(currentStart, duration, newRules);
                    if (window.start !== row.planned_start_date || window.end !== row.planned_end_date) {
                        groupChanges.push({
                            id: row.id,
                            stationCode: row.station_code,
                            oldBattalionId: row.battalion_id,
                            oldVehicleType: row.vehicle_type,
                            oldUnitSerial: row.unit_serial,
                            oldUnitLabel: row.unit_label || null,
                            oldStart: row.planned_start_date,
                            oldEnd: row.planned_end_date,
                            newBattalionId: row.battalion_id,
                            newVehicleType: row.vehicle_type,
                            newUnitSerial: row.unit_serial,
                            newUnitLabel: row.unit_label || null,
                            newStart: window.start,
                            newEnd: window.end,
                        });
                    }
                    groupEnds.push(window.end);
                });
                const recalculatedGroupEnd = groupEnds.length ? maxDateStr(groupEnds) : group.end;
                if (!impacted && (currentStart !== group.start || groupChanges.length)) impacted = true;
                if (impacted && groupChanges.length) changes.push(...groupChanges);
                previousNewGroupEnd = impacted ? recalculatedGroupEnd : group.end;
                if (!previousNewGroupEnd) {
                    previousNewGroupEnd = group.end;
                }
            });
        });

        if (!changes.length) return 0;
        await persistTimelineChanges(changes, auditLabel || 'kd2-non-work-day-recalc');
        return changes.length;
    }

    function resolveLeadTime(vehicleType, categoryCode, stationCode) {
        const stationLead = state.leadTimes.find(row =>
            row.vehicle_type === vehicleType &&
            row.planning_level === 'station' &&
            row.station_code === stationCode &&
            row.lead_time_days !== null
        );
        if (stationLead) {
            const value = Math.ceil(Number(stationLead.lead_time_days));
            return Number.isFinite(value) && value > 0 ? value : null;
        }

        const categoryLead = state.leadTimes.find(row =>
            row.vehicle_type === vehicleType &&
            row.planning_level === 'category' &&
            row.category_code === categoryCode &&
            row.lead_time_days !== null
        );
        if (!categoryLead) return null;
        const value = Math.ceil(Number(categoryLead.lead_time_days));
        return Number.isFinite(value) && value > 0 ? value : null;
    }

    async function generatePlan() {
        if (!dbRef) return;
        if (!canManageKD2()) {
            toast('Only planners and admins can generate KD2 plans.', 'error');
            return;
        }

        const battalionCode = getBattalionFilterValue();
        if (!battalionCode) {
            toast('Select a KD2 battalion filter before generating a plan.', 'error');
            return;
        }

        try {
            await loadWorkspaceData();
            const battalion = state.battalions.find(row => row.battalion_code === battalionCode);
            if (!battalion) {
                toast('Selected battalion was not found.', 'error');
                return;
            }

            const { data: existingPlans, error: existingError } = await dbRef
                .from('kd2_plan')
                .select('id')
                .eq('battalion_id', battalion.id);
            if (existingError) throw existingError;
            if ((existingPlans || []).length && !window.confirm(`Replace existing KD2 plan rows for ${battalionCode}?`)) return;

            const { data: unitRows, error: unitError } = await dbRef
                .from('kd2_vehicle_units')
                .select('*')
                .eq('battalion_id', battalion.id);
            if (unitError) throw unitError;

            const planRows = [];
            const issues = [];

            for (const vehicle of VEHICLES) {
                const planningInput = inputFor(battalion.id, vehicle);
                const quantity = planningInput?.required_quantity;
                if (!quantity || quantity <= 0) continue;

                const deadline = planningInput.delivery_deadline || battalion.delivery_deadline;
                if (!deadline) {
                    issues.push(`${vehicle}: missing deadline`);
                    continue;
                }

                const rules = planningRulesFor(battalion.id, vehicle);
                const { segments, processItems } = buildTemplateLayoutSegments(vehicle);

                if (!processItems.length) {
                    issues.push(`${vehicle}: route definition missing`);
                    continue;
                }

                const missingLead = processItems.find(item => !resolveLeadTime(vehicle, item.route.category_code, item.route.station_code));
                if (missingLead) {
                    issues.push(`${vehicle}: missing lead time for ${missingLead.station?.station_name || missingLead.route.station_code}`);
                    continue;
                }

                const units = buildUnitsForVehicle(battalion.id, vehicle, quantity, unitRows || []);
                units.forEach(unit => {
                    let currentEnd = deadline;
                    const reversed = [];
                    for (let i = segments.length - 1; i >= 0; i -= 1) {
                        const group = segments[i];
                        if (group.kind === 'space') {
                            if (group.applies_to_next_process) {
                                currentEnd = shiftWorkingDateBackward(currentEnd, group.gap_days || 0, rules);
                            }
                            continue;
                        }
                        const groupRows = [];
                        for (const item of group.items) {
                            const duration = resolveLeadTime(vehicle, item.route.category_code, item.route.station_code);
                            if (!duration) {
                                issues.push(`${vehicle}: invalid lead time for ${item.station?.station_name || item.route.station_code}`);
                                groupRows.length = 0;
                                break;
                            }
                            const window = buildBackwardWindow(currentEnd, duration, rules);
                            if (!window.start || !window.end || window.start > window.end) {
                                issues.push(`${vehicle}: invalid planning window for ${item.station?.station_name || item.route.station_code}`);
                                groupRows.length = 0;
                                break;
                            }
                            groupRows.push({
                                battalion_id: battalion.id,
                                vehicle_type: vehicle,
                                unit_serial: unit.unit_serial,
                                unit_label: unit.unit_label,
                                category_code: item.route.category_code,
                                station_code: item.route.station_code,
                                category_sequence: item.category?.category_sequence || item.route.route_sequence,
                                station_sequence_in_category: item.station?.station_sequence_in_category || 1,
                                route_sequence: item.route.route_sequence,
                                schedule_week: weekLabel(window.start),
                                planned_start_date: window.start,
                                planned_end_date: window.end,
                                planning_source: 'generated',
                                remark: null,
                            });
                        }
                        if (groupRows.length !== group.items.length) {
                            reversed.length = 0;
                            break;
                        }
                        reversed.push(...groupRows);
                        currentEnd = previousWorkingDate(minDateStr(groupRows.map(row => row.planned_start_date)), rules);
                    }
                    if (reversed.length === processItems.length) planRows.push(...reversed.reverse());
                });
            }

            if (!planRows.length) {
                const message = issues.length ? `Generation blocked: ${issues.join(' | ')}` : 'No valid planning inputs were found for the selected battalion.';
                setText('kd2GenerationResult', message);
                toast(message, 'error');
                return;
            }

            await dbRef.from('kd2_plan').delete().eq('battalion_id', battalion.id);
            for (const batch of chunk(planRows, 500)) {
                const { error } = await dbRef.from('kd2_plan').insert(batch);
                if (error) throw error;
            }

            const result = issues.length
                ? `Generated ${planRows.length} plan rows. Pending items: ${issues.join(' | ')}`
                : `Generated ${planRows.length} plan rows for ${battalionCode}.`;
            await writeAudit('GENERATE', 'kd2_plan', battalion.id, { battalion_code: battalionCode }, {
                battalion_code: battalionCode,
                generated_rows: planRows.length,
                pending_items: issues,
            });
            setText('kd2GenerationResult', result);
            toast(`KD2 plan generated for ${battalionCode}.`, 'success');
            await helpers.reloadAll?.();
            await refreshWorkspace();
        } catch (error) {
            setText('kd2GenerationResult', `Generation failed: ${error.message}`);
            toast(`KD2 generation failed: ${error.message}`, 'error');
        }
    }

    async function bootstrapBattalions() {
        if (!dbRef) return;
        if (!canManageKD2()) {
            toast('Only planners and admins can bootstrap KD2 battalions.', 'error');
            return;
        }

        try {
            await loadWorkspaceData();
            const existingCodes = new Set(state.battalions.map(row => row.battalion_code));
            const baseline = Array.from({ length: 5 }, (_, index) => ({
                battalion_code: `BTL-${String(index + 1).padStart(2, '0')}`,
                battalion_name: `Battalion ${index + 1}`,
                delivery_deadline: null,
                notes: 'Bootstrap baseline shell',
            }));
            const missing = baseline.filter(row => !existingCodes.has(row.battalion_code));
            if (!missing.length) {
                toast('The default 5 battalion baseline already exists.', 'info');
                return;
            }

            const { data: insertedBattalions, error: battalionError } = await dbRef
                .from('kd2_battalions')
                .insert(missing)
                .select('*');
            if (battalionError) throw battalionError;

            const planningRows = (insertedBattalions || []).flatMap(battalion => VEHICLES.map(vehicle => ({
                battalion_id: battalion.id,
                vehicle_type: vehicle,
                required_quantity: null,
                delivery_deadline: null,
                skip_friday: true,
                include_saturday: KD2_SATURDAY_WORKING,
                assumptions_status: 'pending',
                notes: 'Bootstrap baseline shell',
            })));
            if (planningRows.length) {
                const { error: planningError } = await dbRef
                    .from('kd2_planning_inputs')
                    .upsert(planningRows, { onConflict: 'battalion_id,vehicle_type' });
                if (planningError) throw planningError;
            }

            await writeAudit('BOOTSTRAP', 'kd2_battalions', 'baseline-5', null, {
                battalions: missing.map(row => row.battalion_code),
                planning_rows: planningRows.length,
            });

            toast(`Bootstrapped ${missing.length} battalion shells.`, 'success');
            await refreshWorkspace();
            await helpers.reloadAll?.();
        } catch (error) {
            toast(`KD2 bootstrap failed: ${error.message}`, 'error');
        }
    }

    async function savePlanEdit() {
        if (!dbRef) return;
        if (!canManageKD2()) {
            toast('Only planners and admins can edit KD2 plan rows.', 'error');
            return;
        }

        const id = parseInt(document.getElementById('kd2PlanEditId').value, 10);
        const plannedStart = document.getElementById('kd2PlanEditStart').value;
        const plannedEnd = document.getElementById('kd2PlanEditEnd').value;
        const remark = document.getElementById('kd2PlanEditRemark').value.trim();
        if (!id) {
            setPlanEditError('KD2 plan row is missing.');
            return;
        }
        if (!plannedStart || !plannedEnd) {
            setPlanEditError('Both planned start and planned end are required.');
            return;
        }
        if (plannedStart > plannedEnd) {
            setPlanEditError('Planned end must be on or after planned start.');
            return;
        }

        const before = state.timelineRows.find(row => row.id === id) || null;
        try {
            const rules = planningRulesFor(before?.battalion_id, before?.vehicle);
            const duration = Math.max(durationFromPlannedWindow(plannedStart, plannedEnd, rules), 1);
            const normalizedWindow = buildForwardWindow(plannedStart, duration, rules);
            const payload = {
                planned_start_date: normalizedWindow.start,
                planned_end_date: normalizedWindow.end,
                schedule_week: weekLabel(normalizedWindow.start),
                remark: remark || null,
            };
            const { data, error } = await dbRef
                .from('kd2_plan')
                .update(payload)
                .eq('id', id)
                .select('*')
                .single();
            if (error) throw error;

            await writeAudit('UPDATE', 'kd2_plan', id, before, data);
            closePlanEdit();
            toast('KD2 plan block updated.', 'success');
            await helpers.reloadAll?.();
        } catch (error) {
            setPlanEditError(error.message);
        }
    }

    async function savePlanCreateTemplate() {
        const battalionId = parseInt(document.getElementById('kd2PlanCreateBattalion').value, 10);
        const vehicle = document.getElementById('kd2PlanCreateVehicle').value;
        const unitSelect = document.getElementById('kd2PlanCreateUnit');
        const unitSerial = parseInt(unitSelect.value, 10);
        const selectedUnitLabel = unitSelect.selectedOptions[0]?.dataset.unitLabel || '';
        const startDate = document.getElementById('kd2PlanCreateStart').value;

        if (!battalionId || !vehicle || !unitSerial || !startDate) {
            setPlanCreateError('Battalion, vehicle, unit, and planned start are required for a template.');
            return;
        }

        const battalion = state.battalions.find(row => row.id === battalionId);
        if (!battalion) {
            setPlanCreateError('Selected battalion was not found.');
            return;
        }

        try {
            const draftRows = readTemplateRows({ normalize: true });
            if (!draftRows.some(isTemplateProcessBlock)) {
                setPlanCreateError('The selected vehicle has no route template.');
                return;
            }

            const saved = await saveTemplateDefaults({ silent: true });
            if (!saved) return;

            const { segments, processItems } = buildTemplateLayoutSegments(vehicle);
            if (!processItems.length) {
                setPlanCreateError('The selected vehicle has no route template.');
                return;
            }
            const missingDuration = processItems.find(item => !item.duration);
            if (missingDuration) {
                setPlanCreateError(`Missing duration for ${missingDuration.station?.station_name || missingDuration.route.station_code}.`);
                return;
            }

            const stationCodes = [...new Set(processItems.map(item => item.route.station_code))];
            const { data: duplicateRows, error: duplicateError } = await dbRef
                .from('kd2_plan')
                .select('station_code')
                .eq('battalion_id', battalion.id)
                .eq('vehicle_type', vehicle)
                .eq('unit_serial', unitSerial)
                .in('station_code', stationCodes);
            if (duplicateError) throw duplicateError;
            if ((duplicateRows || []).length) {
                setPlanCreateError(`This unit already has ${duplicateRows.length} template station block(s). Delete or edit existing blocks first.`);
                return;
            }

            const rules = planningRulesFor(battalionId, vehicle);
            let currentStart = localDateStr(normalizeWorkingDateForward(startDate, rules));
            const planRows = [];
            segments.forEach(group => {
                if (group.kind === 'space') {
                    if (group.applies_to_next_process) {
                        currentStart = shiftWorkingDateForward(currentStart, group.gap_days || 0, rules);
                    }
                    return;
                }
                const groupRows = group.items.map(item => {
                    const window = buildForwardWindow(currentStart, item.duration, rules);
                    return {
                        battalion_id: battalion.id,
                        vehicle_type: vehicle,
                        unit_serial: unitSerial,
                        unit_label: selectedUnitLabel || null,
                        category_code: item.route.category_code,
                        station_code: item.route.station_code,
                        category_sequence: item.category.category_sequence,
                        station_sequence_in_category: item.station.station_sequence_in_category,
                        route_sequence: item.route.route_sequence,
                        schedule_week: weekLabel(window.start),
                        planned_start_date: window.start,
                        planned_end_date: window.end,
                        planning_source: 'manual',
                        remark: 'Template',
                    };
                });
                planRows.push(...groupRows);
                currentStart = nextWorkingDate(maxDateStr(groupRows.map(row => row.planned_end_date)), rules);
            });

            const { data, error } = await dbRef
                .from('kd2_plan')
                .insert(planRows)
                .select('*');
            if (error) throw error;

            await writeAudit('INSERT', 'kd2_plan', `${vehicle}-template`, null, data || planRows);
            const undoPayloads = planRows.map(row => ({ ...row }));
            const undoAction = {
                label: `template add (${vehicle})`,
                insertedIds: (data || []).map(row => row.id).filter(Boolean),
                async undo() {
                    if (!this.insertedIds.length) return;
                    const { error: deleteError } = await dbRef
                        .from('kd2_plan')
                        .delete()
                        .in('id', this.insertedIds);
                    if (deleteError) throw deleteError;
                    await writeAudit('DELETE', 'kd2_plan', `${vehicle}-template-undo`, { ids: this.insertedIds }, null);
                },
                async redo() {
                    const { data: redone, error: redoError } = await dbRef
                        .from('kd2_plan')
                        .insert(undoPayloads)
                        .select('*');
                    if (redoError) throw redoError;
                    this.insertedIds = (redone || []).map(row => row.id).filter(Boolean);
                    await writeAudit('INSERT', 'kd2_plan', `${vehicle}-template-redo`, null, redone || undoPayloads);
                },
            };
            window.__ppmsShared?.registerGanttUndoAction?.(undoAction);
            closePlanCreateModal();
            toast(`KD2 ${vehicle} template added to plan.`, 'success');
            await helpers.reloadAll?.();
        } catch (error) {
            setPlanCreateError(error.message);
        }
    }

    async function savePlanCreate() {
        if (!dbRef) return;
        if (!canManageKD2()) {
            toast('Only planners and admins can add KD2 plan rows.', 'error');
            return;
        }
        if (currentPlanCreateMode() === 'template') {
            await savePlanCreateTemplate();
            return;
        }

        const battalionId = parseInt(document.getElementById('kd2PlanCreateBattalion').value, 10);
        const vehicle = document.getElementById('kd2PlanCreateVehicle').value;
        const unitSelect = document.getElementById('kd2PlanCreateUnit');
        const unitSerial = parseInt(unitSelect.value, 10);
        const selectedUnitLabel = unitSelect.selectedOptions[0]?.dataset.unitLabel || '';
        const startDate = document.getElementById('kd2PlanCreateStart').value;
        const duration = parseInt(document.getElementById('kd2PlanCreateDuration').value || '', 10);
        const remark = document.getElementById('kd2PlanCreateRemark').value.trim();
        const station = selectedCreateStation();

        if (!battalionId || !vehicle || !station || !startDate || !duration || duration < 1 || !unitSerial) {
            setPlanCreateError('Battalion, vehicle, unit, station, planned start, and a valid duration are required.');
            return;
        }

        try {
            await createPlanBlock({
                battalionId,
                vehicle,
                unitSerial,
                unitLabel: selectedUnitLabel || null,
                stationCode: station.station_code,
                startDate,
                duration,
                remark,
            });
            closePlanCreateModal();
            toast('KD2 plan block added.', 'success');
            await helpers.reloadAll?.();
        } catch (error) {
            setPlanCreateError(error.message);
        }
    }

    async function deletePlanBlock() {
        if (!dbRef) return;
        if (!canManageKD2()) {
            toast('Only planners and admins can delete KD2 plan rows.', 'error');
            return;
        }

        const id = parseInt(document.getElementById('kd2PlanEditId').value, 10);
        const before = state.timelineRows.find(row => row.id === id) || null;
        if (!id || !before) {
            setPlanEditError('KD2 plan row is missing from the current view.');
            return;
        }

        if (!window.confirm(`Delete "${before.process_station || before.station_name || 'plan block'}" for ${before.battalion_code || '—'} / ${before.vehicle || '—'} / ${before.vehicle_no || '—'}?`)) {
            return;
        }

        try {
            const { error } = await dbRef.from('kd2_plan').delete().eq('id', id);
            if (error) throw error;
            await writeAudit('DELETE', 'kd2_plan', id, before, null);
            closePlanEdit();
            toast('KD2 plan block deleted.', 'success');
            await helpers.reloadAll?.();
        } catch (error) {
            setPlanEditError(error.message);
        }
    }

    async function refreshWorkspace() {
        if (!isKD2() || !dbRef) return;
        try {
            await loadWorkspaceData();
            renderPlanningInputs();
            renderRouteFlow();
            if (document.getElementById('kd2LeadTimeOverlay')?.style.display === 'flex') renderLeadTimeEditor();
            if (document.getElementById('kd2ProcessOverlay')?.style.display === 'flex') renderProcessEditor();
            if (document.getElementById('kd2NoWorkOverlay')?.style.display === 'flex') renderNoWorkDays();
            if (document.getElementById('kd2PlanCreateOverlay')?.style.display === 'flex') {
                const preserveStation = document.getElementById('kd2PlanCreateStation')?.value || '';
                populatePlanCreateStations(preserveStation);
                if (currentPlanCreateMode() === 'template') renderTemplateEditor();
                else updatePlanCreateDurationFromStation(true);
                updatePlanCreateEndFromDuration();
            }
            updateGenerationTarget();
            syncTimelinePlacementUi();
        } catch (error) {
            console.warn('KD2 workspace refresh skipped:', error.message);
        }
    }

    function wireEvents() {
        if (wired) return;
        wired = true;

        document.getElementById('moduleSelector')?.addEventListener('change', event => {
            setActiveModule(event.target.value);
            applyModuleShell();
            window.location.reload();
        });

        document.getElementById('filterBattalion')?.addEventListener('change', updateGenerationTarget);
        document.getElementById('btnKd2RefreshInputs')?.addEventListener('click', refreshWorkspace);
        document.getElementById('btnKd2Bootstrap')?.addEventListener('click', bootstrapBattalions);
        document.getElementById('btnKd2NewBattalion')?.addEventListener('click', () => openPlanningModal(null));
        document.getElementById('btnKd2GeneratePlan')?.addEventListener('click', generatePlan);
        document.getElementById('btnKd2ManageProcesses')?.addEventListener('click', () => openProcessModal(state.routeVehicle || 'K9'));
        document.getElementById('btnKd2ManageLeadTimes')?.addEventListener('click', openLeadTimeModal);
        document.getElementById('btnKd2AddBlock')?.addEventListener('click', () => openPlanCreateModal());
        document.getElementById('btnKd2VisualAdd')?.addEventListener('click', event => {
            event.stopPropagation();
            if (!isKD2()) return;
            toggleTimelineVisualMenu();
        });
        document.getElementById('btnGanttVisualAdd')?.addEventListener('click', event => {
            event.stopPropagation();
            if (!isKD2()) return;
            toggleTimelineVisualMenu();
        });
        document.addEventListener('pointermove', event => {
            rememberPlacementPointer(event.clientX, event.clientY);
            if (state.timelinePlacementActive && placementGhostEl) positionPlacementGhost();
        }, { passive: true });
        document.addEventListener('fullscreenchange', () => {
            const planEditOverlay = document.getElementById('kd2PlanEditOverlay');
            if (planEditOverlay?.style.display === 'flex') movePlanEditOverlayToActiveHost();
            else restorePlanEditOverlayHost();
            const planCreateOverlay = document.getElementById('kd2PlanCreateOverlay');
            if (planCreateOverlay?.style.display === 'flex') movePlanCreateOverlayToActiveHost();
            else restorePlanCreateOverlayHost();
            const processOverlay = document.getElementById('kd2ProcessOverlay');
            if (processOverlay?.style.display === 'flex') moveProcessOverlayToActiveHost();
            else restoreProcessOverlayHost();
            if (state.timelinePlacementActive) syncTimelinePlacementGhost();
            else removePlacementGhost();
        });
        document.getElementById('btnKd2TimelineRefresh')?.addEventListener('click', () => renderSchedule());
        document.getElementById('btnKd2TimelineViewUnit')?.addEventListener('click', () => {
            setTimelineViewMode('unit');
        });
        document.getElementById('btnKd2TimelineViewProcess')?.addEventListener('click', () => {
            setTimelineViewMode('process');
        });
        document.getElementById('btnKd2TimelineEdit')?.addEventListener('click', () => setTimelineEditMode(true));
        document.getElementById('btnKd2TimelineEditDone')?.addEventListener('click', () => setTimelineEditMode(false));
        document.getElementById('btnKd2TimelineModeBlock')?.addEventListener('click', () => {
            setTimelineMoveMode('block');
            renderSchedule();
        });
        document.getElementById('btnKd2TimelineModeFromBlock')?.addEventListener('click', () => {
            setTimelineMoveMode('from-block');
            renderSchedule();
        });
        document.getElementById('btnKd2TimelineModeLane')?.addEventListener('click', () => {
            setTimelineMoveMode('lane');
            renderSchedule();
        });
        document.getElementById('btnKd2TimelineSelectLane')?.addEventListener('click', () => {
            setTimelineSelectLaneMode(!state.timelineSelectLaneMode);
        });
        document.getElementById('kd2TimelinePlacementVehicle')?.addEventListener('change', event => {
            setTimelinePlacementVehicle(event.target.value);
        });
        document.getElementById('ganttVisualPlacementVehicle')?.addEventListener('change', event => {
            setTimelinePlacementVehicle(event.target.value);
        });
        document.getElementById('kd2TimelinePlacementFilter')?.addEventListener('input', event => {
            setTimelinePlacementQuery(event.target.value);
        });
        document.getElementById('ganttVisualPlacementFilter')?.addEventListener('input', event => {
            setTimelinePlacementQuery(event.target.value);
        });
        document.getElementById('btnKd2TimelinePlacementCancel')?.addEventListener('click', () => {
            cancelTimelinePlacement();
        });
        document.getElementById('btnGanttVisualPlacementCancel')?.addEventListener('click', () => {
            cancelTimelinePlacement();
        });
        document.getElementById('btnKd2NoWorkDays')?.addEventListener('click', openNoWorkModal);
        document.getElementById('btnKd2DownloadTemplate')?.addEventListener('click', downloadKd2Template);
        document.getElementById('btnKd2UploadPlan')?.addEventListener('click', () => {
            const panel = document.getElementById('kd2ImportPanel');
            if (!panel) return;
            if (panel.style.display === 'none' || window.getComputedStyle(panel).display === 'none') openKd2ImportPanel();
            else closeKd2ImportPanel();
        });
        document.getElementById('btnKd2ImportSubmit')?.addEventListener('click', importKd2PlanFile);
        document.getElementById('btnKd2ImportCancel')?.addEventListener('click', closeKd2ImportPanel);

        document.getElementById('kd2PlanningClose')?.addEventListener('click', closePlanningModal);
        document.getElementById('btnKd2PlanningCancel')?.addEventListener('click', closePlanningModal);
        document.getElementById('btnKd2PlanningSave')?.addEventListener('click', savePlanningInputs);
        document.getElementById('kd2PlanningOverlay')?.addEventListener('click', function (e) {
            if (e.target === this) closePlanningModal();
        });
        document.getElementById('kd2PlanEditClose')?.addEventListener('click', closePlanEdit);
        document.getElementById('btnKd2PlanEditCancel')?.addEventListener('click', closePlanEdit);
        document.getElementById('btnKd2PlanEditSave')?.addEventListener('click', savePlanEdit);
        document.getElementById('btnKd2PlanDelete')?.addEventListener('click', deletePlanBlock);
        document.getElementById('kd2PlanEditOverlay')?.addEventListener('click', function (e) {
            if (e.target === this) closePlanEdit();
        });
        document.getElementById('kd2NoWorkClose')?.addEventListener('click', closeNoWorkModal);
        document.getElementById('btnKd2NoWorkDone')?.addEventListener('click', closeNoWorkModal);
        document.getElementById('btnKd2NoWorkAdd')?.addEventListener('click', addNoWorkDay);
        document.getElementById('btnKd2NoWorkCancelEdit')?.addEventListener('click', resetNoWorkForm);
        document.getElementById('kd2NoWorkOverlay')?.addEventListener('click', function (e) {
            if (e.target === this) closeNoWorkModal();
        });
        document.getElementById('kd2PlanCreateClose')?.addEventListener('click', closePlanCreateModal);
        document.getElementById('btnKd2PlanCreateCancel')?.addEventListener('click', closePlanCreateModal);
        document.getElementById('btnKd2PlanCreateSave')?.addEventListener('click', savePlanCreate);
        document.getElementById('btnKd2ManageProcessesInline')?.addEventListener('click', () => {
            openProcessModal(document.getElementById('kd2PlanCreateVehicle')?.value || state.routeVehicle || 'K9');
        });
        document.getElementById('kd2PlanCreateOverlay')?.addEventListener('click', function (e) {
            if (e.target === this) closePlanCreateModal();
        });
        document.getElementById('kd2PlanCreateBattalion')?.addEventListener('change', () => {
            populatePlanCreateUnits();
            updatePlanCreateEndFromDuration();
            if (currentPlanCreateMode() === 'template') renderTemplateEditor();
        });
        document.getElementById('kd2PlanCreateUnit')?.addEventListener('change', () => {
            if (currentPlanCreateMode() === 'template' && state.templateEditorView === 'preview') renderTemplateEditor();
        });
        document.getElementById('kd2PlanCreateVehicle')?.addEventListener('change', () => {
            setTimelinePlacementVehicle(document.getElementById('kd2PlanCreateVehicle').value || 'K9');
            state.templateRemovedStations.clear();
            state.templateNewRowCounter = 0;
            state.templateEditorVehicle = '';
            state.templateEditorBlocks = [];
            state.templateInsertIndex = null;
            populatePlanCreateStations();
            populatePlanCreateUnits();
            if (currentPlanCreateMode() === 'template') renderTemplateEditor();
            else updatePlanCreateDurationFromStation(true);
        });
        document.getElementById('kd2PlanCreateStation')?.addEventListener('change', () => {
            const station = selectedCreateStation();
            if (station) setTimelinePlacementStation(station.station_code, station.vehicle_type);
            updatePlanCreateCategory();
            updatePlanCreateDurationFromStation(true);
        });
        document.getElementById('kd2PlanCreateStart')?.addEventListener('change', () => {
            updatePlanCreateEndFromDuration();
            if (currentPlanCreateMode() === 'template' && state.templateEditorView === 'preview') renderTemplateEditor();
        });
        document.getElementById('kd2PlanCreateDuration')?.addEventListener('input', updatePlanCreateEndFromDuration);
        document.getElementById('kd2PlanCreateModeToggle')?.addEventListener('click', e => {
            const btn = e.target.closest('.kd2-create-mode-btn');
            if (!btn) return;
            setPlanCreateMode(btn.dataset.mode);
        });
        document.getElementById('btnKd2TemplateSave')?.addEventListener('click', async () => {
            try {
                await saveTemplateDefaults();
            } catch (error) {
                setPlanCreateError(error.message);
            }
        });
        document.getElementById('btnKd2TemplateAddBlock')?.addEventListener('click', () => {
            if (state.templateEditorView === 'preview') {
                state.templateEditorView = 'visual';
                state.templateInsertIndex = state.templateEditorBlocks.length;
                renderTemplateEditor();
                return;
            }
            if (state.templateEditorView === 'visual') {
                toggleTemplateInsertChooser(state.templateEditorBlocks.length);
                return;
            }
            addTemplateDraftRow('process');
        });
        document.getElementById('kd2TemplateEditorViewToggle')?.addEventListener('click', e => {
            const btn = e.target.closest('.kd2-template-view-btn');
            if (!btn) return;
            const nextView = btn.dataset.view === 'form'
                ? 'form'
                : btn.dataset.view === 'preview'
                    ? 'preview'
                    : 'visual';
            if (state.templateEditorView !== 'preview') {
                syncTemplateEditorStateFromDom({ normalizeForVisual: nextView !== 'form' });
            }
            state.templateEditorView = nextView;
            renderTemplateEditor();
        });
        document.getElementById('kd2TemplateEditor')?.addEventListener('click', e => {
            const insertTrigger = e.target.closest('[data-kd2-template-insert-trigger]');
            if (insertTrigger) {
                e.stopPropagation();
                toggleTemplateInsertChooser(parseInt(insertTrigger.dataset.kd2TemplateInsertTrigger, 10) || 0);
                return;
            }
            const insertOption = e.target.closest('[data-kd2-template-insert-kind]');
            if (insertOption) {
                e.stopPropagation();
                addTemplateDraftRow(
                    insertOption.dataset.kd2TemplateInsertKind === 'space' ? 'space' : 'process',
                    parseInt(insertOption.dataset.insertIndex, 10) || 0
                );
                return;
            }
            const moveBtn = e.target.closest('[data-kd2-template-move]');
            if (moveBtn) {
                moveTemplateEditorBlock(
                    moveBtn.dataset.editorId || '',
                    parseInt(moveBtn.dataset.kd2TemplateMove, 10) || 0
                );
                return;
            }
            const removeBtn = e.target.closest('[data-kd2-template-remove-id]');
            if (removeBtn) {
                syncTemplateEditorStateFromDom({ normalizeForVisual: state.templateEditorView === 'visual' });
                const blockId = removeBtn.dataset.kd2TemplateRemoveId;
                const block = state.templateEditorBlocks.find(item => item.editor_id === blockId);
                if (block?.station_code && !block.isNew) state.templateRemovedStations.add(block.station_code);
                state.templateEditorBlocks = state.templateEditorBlocks.filter(item => item.editor_id !== blockId);
                state.templateEditorBlocks = normalizeTemplateEditorBlocks(state.templateEditorBlocks);
                state.templateInsertIndex = null;
                renderTemplateEditor();
                return;
            }
            if (state.templateInsertIndex !== null && !e.target.closest('[data-kd2-template-insert-menu]')) {
                state.templateInsertIndex = null;
                renderTemplateEditor();
            }
        });
        document.getElementById('kd2TemplateEditor')?.addEventListener('change', e => {
            if (!e.target.closest('[data-kd2-template-block]')) return;
            const row = e.target.closest('[data-kd2-template-block]');
            if (e.target.matches('[data-field="kind"]')) {
                convertTemplateBlockKind(row?.dataset.editorId || '', e.target.value === 'space' ? 'space' : 'process');
                return;
            }
            if (e.target.matches('[data-kd2-template-parallel]')) {
                syncTemplateEditorStateFromDom({ normalizeForVisual: true });
                renderTemplateEditor();
                return;
            }
            if (e.target.matches('[data-field="gapDays"]')) {
                syncTemplateEditorStateFromDom({ normalizeForVisual: state.templateEditorView === 'visual' });
                renderTemplateEditor();
            }
        });
        document.getElementById('kd2TemplateEditor')?.addEventListener('dragstart', e => {
            if (state.templateEditorView !== 'visual') return;
            const card = e.target.closest('[data-kd2-template-block]');
            if (!card) return;
            card.classList.add('kd2-template-card-dragging');
            state.templateInsertIndex = null;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.editorId || '');
        });
        document.getElementById('kd2TemplateEditor')?.addEventListener('dragover', e => {
            if (state.templateEditorView !== 'visual') return;
            const container = e.currentTarget;
            const dragging = container.querySelector('.kd2-template-card-dragging');
            if (!dragging) return;
            e.preventDefault();
            const slot = e.target.closest('[data-kd2-template-insert-slot]');
            if (slot && !slot.contains(dragging)) {
                slot.parentElement?.insertBefore(dragging, slot.nextSibling);
                return;
            }
            const target = e.target.closest('[data-kd2-template-block]');
            if (!target || target === dragging) {
                if (e.target === container || e.target.closest('.kd2-template-visual')) {
                    container.querySelector('.kd2-template-visual')?.appendChild(dragging);
                }
                return;
            }
            const rect = target.getBoundingClientRect();
            const insertAfter = e.clientY > rect.top + rect.height / 2;
            target.parentElement?.insertBefore(dragging, insertAfter ? target.nextSibling : target);
        });
        document.getElementById('kd2TemplateEditor')?.addEventListener('drop', e => {
            if (state.templateEditorView !== 'visual') return;
            e.preventDefault();
            syncTemplateEditorStateFromDom({ normalizeForVisual: true });
            renderTemplateEditor();
        });
        document.getElementById('kd2TemplateEditor')?.addEventListener('dragend', e => {
            e.target.closest('.kd2-template-card')?.classList.remove('kd2-template-card-dragging');
        });
        document.addEventListener('click', e => {
            if (state.templateInsertIndex === null) return;
            if (e.target.closest('#kd2TemplateEditorWrap')) return;
            state.templateInsertIndex = null;
            renderTemplateEditor();
        });
        document.getElementById('kd2LeadTimeClose')?.addEventListener('click', closeLeadTimeModal);
        document.getElementById('btnKd2LeadTimeCancel')?.addEventListener('click', closeLeadTimeModal);
        document.getElementById('btnKd2LeadTimeSave')?.addEventListener('click', saveLeadTimes);
        document.getElementById('kd2LeadTimeOverlay')?.addEventListener('click', function (e) {
            if (e.target === this) closeLeadTimeModal();
        });
        document.getElementById('kd2ProcessClose')?.addEventListener('click', closeProcessModal);
        document.getElementById('btnKd2ProcessCancel')?.addEventListener('click', closeProcessModal);
        document.getElementById('btnKd2ProcessSave')?.addEventListener('click', saveProcessStation);
        document.getElementById('btnKd2ProcessReset')?.addEventListener('click', () => {
            resetProcessForm({ vehicle: processEditorVehicle(), categoryCode: document.getElementById('kd2ProcessCategory')?.value || '' });
        });
        document.getElementById('kd2ProcessVehicle')?.addEventListener('change', event => {
            resetProcessForm({ vehicle: event.target.value });
            renderProcessEditor();
        });
        document.getElementById('kd2ProcessCategory')?.addEventListener('change', event => {
            const originalStationCode = document.getElementById('kd2ProcessStationCodeOriginal')?.value || '';
            const sequenceInput = document.getElementById('kd2ProcessSequence');
            if (sequenceInput) {
                sequenceInput.value = nextProcessCategorySequence(processEditorVehicle(), event.target.value, originalStationCode);
            }
        });
        document.getElementById('kd2ProcessBody')?.addEventListener('click', event => {
            const editBtn = event.target.closest('[data-kd2-process-edit]');
            if (editBtn) {
                loadProcessIntoForm(processEditorVehicle(), editBtn.dataset.kd2ProcessEdit || '');
                return;
            }
            const deleteBtn = event.target.closest('[data-kd2-process-delete]');
            if (deleteBtn) {
                deleteProcessStation(processEditorVehicle(), deleteBtn.dataset.kd2ProcessDelete || '');
            }
        });
        document.getElementById('kd2ProcessOverlay')?.addEventListener('click', function (e) {
            if (e.target === this) closeProcessModal();
        });

        document.querySelectorAll('.kd2-route-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                state.routeVehicle = btn.dataset.vehicle;
                document.querySelectorAll('.kd2-route-tab').forEach(item => item.classList.remove('kd2-route-tab-active'));
                btn.classList.add('kd2-route-tab-active');
                renderRouteFlow();
                if (document.getElementById('kd2LeadTimeOverlay')?.style.display === 'flex') renderLeadTimeEditor();
            });
        });
        document.addEventListener('click', event => {
            if (!state.timelinePlacementMenuOpen) return;
            if (event.target.closest('#kd2VisualAddShell') || event.target.closest('#ganttVisualAddShell') || event.target.closest('#ganttVisualPlacementBar')) return;
            const ganttPlacementBar = document.getElementById('ganttVisualPlacementBar');
            if (ganttPlacementBar && window.getComputedStyle(ganttPlacementBar).display !== 'none') return;
            setTimelinePlacementMenuOpen(false);
        });
    }

    function initialize(db, runtimeHelpers = {}) {
        dbRef = db;
        helpers = { ...helpers, ...runtimeHelpers };
        wireEvents();
        if (isKD2()) refreshWorkspace();
    }

    document.addEventListener('DOMContentLoaded', () => {
        applyModuleShell();
        wireEvents();
    });

    return {
        getActiveModule,
        getActiveConfig,
        isKD2,
        isF100KD2,
        isF200Module,
        isPlacementActive: () => state.timelinePlacementActive,
        setActiveModule,
        getCategory,
        applyModuleShell,
        initialize,
        loadFilters,
        loadData,
        loadPlanningSnapshot,
        refreshWorkspace,
        renderSchedule,
        setTimelineViewMode,
        currentTimelineViewMode,
        openPlanEdit,
        openPlanCreateModal,
        openNoWorkModal,
        placePlanBlockFromGanttTrack,
        toggleTimelineVisualMenu,
        shiftPlanRowToStart,
        getGanttSpecialZones,
            getStationRouteOrder(vehicle) {
                const order = new Map();
                // Read directly from state.stations (already ordered by route_sequence from DB).
                // Using stations avoids needing the routes table to be in sync.
                (state.stations || [])
                    .filter(s => !vehicle || s.vehicle_type === vehicle)
                    .forEach(s => {
                        const name = s.station_name || s.station_code;
                        const seq  = parseInt(s.route_sequence, 10) || 9999;
                        if (name && !order.has(name)) {
                            order.set(name, seq);
                        }
                    });
                return order;
            },
            // Returns Map<stationName, {category_code, category_name, category_sequence, component_group, work_centers_combined}>
            // work_centers_combined aggregates all parallel stations sharing the same station_name (e.g. "W05, W06")
            getStationCategoryMap(vehicle) {
                const catByCode = new Map(
                    (state.categories || [])
                        .filter(c => !vehicle || c.vehicle_type === vehicle)
                        .map(c => [c.category_code, c])
                );
                const result = new Map();
                const wcSets = new Map(); // stationName → Set of work_centers
                (state.stations || [])
                    .filter(s => !vehicle || s.vehicle_type === vehicle)
                    .forEach(s => {
                        const cat = catByCode.get(s.category_code);
                        if (!cat) return;
                        const name = s.station_name || s.station_code;
                        if (!name) return;
                        if (!result.has(name)) {
                            result.set(name, {
                                category_code:     cat.category_code,
                                category_name:     cat.category_name,
                                category_sequence: cat.category_sequence,
                                component_group:   s.component_group || null,
                            });
                        }
                        if (s.work_center) {
                            if (!wcSets.has(name)) wcSets.set(name, new Set());
                            wcSets.get(name).add(s.work_center);
                        }
                    });
                result.forEach((v, k) => {
                    const wcs = wcSets.get(k);
                    if (wcs?.size) v.work_centers_combined = [...wcs].join(', ');
                });
                return result;
            },
        comparePlanRowsByLaneOrder,
        getPlanMoveRowsFromAnchor,
    };
})();

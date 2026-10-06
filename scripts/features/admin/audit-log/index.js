/* ================================================================
   AUDIT LOG  (master admin)
   ----------------------------------------------------------------
   Every entry in planning_audit_log is shown in plain language:
     who · what they did · to which thing (vehicle, unit, station,
     user, issue … — never a bare database id) · what changed.
   Names are resolved from the entry itself (new entries carry a
   `_ctx` label written by auditLog() in app.js) or looked up
   (battalions, stations, users, parts, plan rows) for older ones.
   "View" takes you to the thing in the system — the Gantt block,
   the issue, the user, the process list … switching module first
   when needed. The technical record (table, record id, IP, raw
   fields) stays available under Details.
   ================================================================ */
/* global db, esc, currentData, getActiveModuleId, getModuleRuntime, showToast,
   roleLabel, roleClass, openIssueView, openUserMgmt, _ensureTableRowRendered */
import { _t, fmtDate, getLocale } from '../../../core/i18n.js';
import { applyFilters } from '../../assistant/actions.js';

const PAGE = 50;
const GOTO_KEY = 'ppms_audit_goto';

/* ── Areas, actions, modules ──────────────────────────────────── */
const AREAS = [
    { id: 'plan', label: 'Plan blocks', tables: ['kd2_plan', 'assembly_plan', 'f100_plans'] },
    { id: 'actuals', label: 'Actual dates & notes', tables: ['kd2_progress', 'assembly_progress'] },
    { id: 'issues', label: 'Production issues', tables: ['production_issues', 'production_issue_categories'] },
    { id: 'versions', label: 'Plan versions', tables: ['plan_versions'] },
    { id: 'processes', label: 'Processes & routes', tables: ['kd2_process_stations', 'kd2_process_routes', 'kd2_process_categories', 'kd2_process_lead_times', 'kd2_plan_route_order', 'kd2_template_layout_items'] },
    { id: 'calendar', label: 'No-work days', tables: ['planning_non_work_days'] },
    { id: 'battalions', label: 'Battalions & planning inputs', tables: ['kd2_battalions', 'kd2_planning_inputs'] },
    { id: 'f100', label: 'F100 parts & processes', tables: ['f100_parts', 'f100_processes'] },
    { id: 'users', label: 'Users & access', tables: ['planning_app_users', 'ppms_export_permissions'] },
    { id: 'sessions', label: 'Sign-ins', actions: ['LOGIN', 'LOGOUT'] },
    { id: 'exports', label: 'Reports & exports', actions: ['EXPORT'] },
];
const ACTION_GROUPS = [
    { id: 'add', label: 'Added', actions: ['INSERT', 'CREATE'] },
    { id: 'change', label: 'Changed', actions: ['UPDATE', 'UPSERT', 'REPLACE'] },
    { id: 'delete', label: 'Deleted', actions: ['DELETE'] },
    { id: 'generate', label: 'Generated / set up', actions: ['GENERATE', 'BOOTSTRAP'] },
    { id: 'session', label: 'Signed in / out', actions: ['LOGIN', 'LOGOUT'] },
    { id: 'export', label: 'Exported', actions: ['EXPORT'] },
];
const VERB = {
    INSERT: 'Added', CREATE: 'Added', UPDATE: 'Changed', UPSERT: 'Saved', REPLACE: 'Replaced',
    DELETE: 'Deleted', GENERATE: 'Generated', BOOTSTRAP: 'Set up', LOGIN: 'Signed in', LOGOUT: 'Signed out', EXPORT: 'Exported',
};
const TONE = {
    INSERT: 'add', CREATE: 'add', UPDATE: 'change', UPSERT: 'change', REPLACE: 'change',
    DELETE: 'delete', GENERATE: 'system', BOOTSTRAP: 'system', LOGIN: 'session', LOGOUT: 'session', EXPORT: 'export',
};
const MODULE_OF = t => (/^assembly/.test(t) ? 'kd1' : /^kd2/.test(t) ? 'kd2' : /^f100/.test(t) ? 'f100kd2' : null);
const MODULE_LABEL = { kd1: 'F200 – KD1', kd2: 'F200 – KD2', f100kd2: 'F100 – KD2' };
const MODULE_SHORT = { kd1: 'KD1', kd2: 'KD2', f100kd2: 'F100' };
const PLAN_TABLES = new Set(['kd2_plan', 'assembly_plan', 'f100_plans']);
const PROGRESS_TABLES = new Set(['kd2_progress', 'assembly_progress']);

/* Friendly field names; fields not listed are shown with their key
   turned into words. HIDDEN fields are technical and left out. */
const FIELD = {
    planned_start_date: 'Planned start', planned_end_date: 'Planned end', start_date: 'Planned start', end_date: 'Planned end',
    actual_start_date: 'Actual start', actual_end_date: 'Actual finish', completion_date: 'Completed on', completed: 'Completed',
    notes: 'Note', remark: 'Remark', status: 'Status', week: 'Week', schedule_week: 'Week',
    battalion_id: 'Battalion', battalion_code: 'Battalion', battalion_name: 'Battalion name', delivery_deadline: 'Delivery deadline',
    vehicle: 'Vehicle', vehicle_type: 'Vehicle', vehicle_no: 'Unit', unit_serial: 'Unit no.', unit_label: 'Unit', serial_number: 'Unit no.',
    station_code: 'Station', station_name: 'Station name', process_station: 'Station', category_code: 'Category',
    work_center: 'Work center', lead_time_days: 'Lead time (days)', duration_working_days: 'Duration (working days)',
    part_id: 'Part', process_id: 'Process', part_name: 'Part', part_number: 'Part no.', process_name: 'Process', step_number: 'Step',
    manufacturer: 'Manufacturer', is_active: 'Active', label: 'Label', off_date: 'Date',
    full_name: 'Name', email: 'Email', role: 'Role', modules: 'Module access', can_export: 'Can export reports',
    password_changed: 'Password', title: 'Title', description: 'Description', category: 'Category', priority: 'Priority',
    proposed_solution: 'Proposed solution', action_taken: 'Action taken', pic: 'Person in charge', module: 'Module',
    name: 'Name', is_baseline: 'Baseline', count: 'Blocks', blocks: 'Blocks', units: 'Units', reference: 'Reference unit',
    xray_status: 'X-ray status', delay_reason: 'Delay reason', unit_code: 'Unit code', unit_name: 'Unit name',
    away_minutes: 'Away (minutes)', signed_in_at: 'Signed in at', file: 'File', format: 'Format', from: 'Opened from',
};
const HIDDEN = new Set(['id', 'created_at', 'updated_at', 'plan_version_id', 'password_hash', '_ctx', 'category_sequence',
    'station_sequence_in_category', 'route_sequence', 'planning_source', 'reporter_email', 'updated_by_email', 'updated_by_name',
    'plan_id', 'ids', 'sample', 'module_id', 'user_id', 'session']);

/* ── State ───────────────────────────────────────────────────── */
const S = {
    offset: 0, total: 0, entries: [], described: new Map(), open: false,
    look: null, lookAt: 0, expanded: new Set(),
};

/* ── Look-ups (names for ids) ─────────────────────────────────── */
async function loadLookups() {
    if (S.look && Date.now() - S.lookAt < 5 * 60e3) return S.look;
    const q = async (table, cols) => {
        try { const { data, error } = await db.from(table).select(cols); return error ? [] : (data || []); } catch { return []; }
    };
    const [users, batts, stations, versions, parts, procs, cats] = await Promise.all([
        q('planning_app_users', 'id,email,full_name,role'),
        q('kd2_battalions', 'id,battalion_code'),
        q('kd2_process_stations', 'vehicle_type,station_code,station_name'),
        q('plan_versions', 'id,name,module_id'),
        q('f100_parts', 'id,part_name,part_number'),
        q('f100_processes', 'id,process_name,step_number'),
        q('production_issue_categories', 'code,label'),
    ]);
    const L = {
        userById: new Map(users.map(u => [String(u.id), u])),
        userByEmail: new Map(users.map(u => [String(u.email || '').toLowerCase(), u])),
        users,
        batt: new Map(batts.map(b => [String(b.id), b.battalion_code])),
        station: new Map(),
        stationAny: new Map(),
        version: new Map(versions.map(v => [String(v.id), v])),
        part: new Map(parts.map(p => [String(p.id), p.part_name || p.part_number])),
        proc: new Map(procs.map(p => [String(p.id), p.process_name])),
        cat: new Map(cats.map(c => [String(c.code), c.label])),
    };
    stations.forEach(s => {
        L.station.set(`${s.vehicle_type}|${s.station_code}`, s.station_name);
        if (!L.stationAny.has(s.station_code)) L.stationAny.set(s.station_code, s.station_name);
    });
    S.look = L;
    S.lookAt = Date.now();
    return L;
}

const stationName = (L, vehicle, code) => (code ? (L.station.get(`${vehicle}|${code}`) || L.stationAny.get(code) || code) : '');
const userName = (L, idOrEmail) => {
    const u = L.userById.get(String(idOrEmail)) || L.userByEmail.get(String(idOrEmail || '').toLowerCase());
    return u?.full_name || u?.email || '';
};

/** Plan rows and progress rows the page needs for its labels. */
async function loadRows(entries) {
    const want = { kd2_plan: new Set(), assembly_plan: new Set(), f100_plans: new Set(), kd2_progress: new Set(), assembly_progress: new Set() };
    const isId = v => /^\d+$/.test(String(v ?? ''));
    for (const e of entries) {
        const t = e.table_name;
        const ctx = e.data_after?._ctx || e.data_before?._ctx;
        if (ctx?.label) continue;
        if (PLAN_TABLES.has(t) && isId(e.record_id)) want[t].add(String(e.record_id));
        if (PROGRESS_TABLES.has(t)) {
            const planId = e.data_after?.plan_id ?? e.data_before?.plan_id;
            const planTable = t === 'kd2_progress' ? 'kd2_plan' : 'assembly_plan';
            if (planId) want[planTable].add(String(planId));
            else if (isId(e.record_id)) { want[t].add(String(e.record_id)); want[planTable].add(String(e.record_id)); }
        }
        if (t === 'kd2_plan' && /^batch-move|^undo|^redo/.test(e.record_id || '')) {
            const id = e.data_after?.sample?.id ?? e.data_before?.ids?.[0];
            if (id) want.kd2_plan.add(String(id));
        }
    }
    const rows = { kd2_plan: new Map(), assembly_plan: new Map(), f100_plans: new Map(), kd2_progress: new Map(), assembly_progress: new Map() };
    // Progress first: their plan ids join the plan look-ups
    for (const t of ['kd2_progress', 'assembly_progress']) {
        const ids = [...want[t]];
        if (!ids.length) continue;
        try {
            const { data } = await db.from(t).select('id,plan_id').in('id', ids);
            (data || []).forEach(r => { rows[t].set(String(r.id), r); want[t === 'kd2_progress' ? 'kd2_plan' : 'assembly_plan'].add(String(r.plan_id)); });
        } catch {}
    }
    await Promise.all(['kd2_plan', 'assembly_plan', 'f100_plans'].map(async t => {
        const ids = [...want[t]];
        for (let i = 0; i < ids.length; i += 200) {
            try {
                const { data } = await db.from(t).select('*').in('id', ids.slice(i, i + 200));
                (data || []).forEach(r => rows[t].set(String(r.id), r));
            } catch {}
        }
    }));
    return rows;
}

/* ── Describing one entry ─────────────────────────────────────── */
/** "BTL-01 K9 M2 · Hull - Floor" for a plan row (any module). */
function planLabel(L, table, r) {
    if (!r) return '';
    if (table === 'kd2_plan') {
        const bn = r.battalion_code || L.batt.get(String(r.battalion_id)) || '';
        const unit = r.unit_label || (r.unit_serial != null ? `#${r.unit_serial}` : '');
        const st = r.process_station || stationName(L, r.vehicle_type, r.station_code);
        return [[bn, r.vehicle_type || r.vehicle, unit].filter(Boolean).join(' '), st].filter(Boolean).join(' · ');
    }
    if (table === 'f100_plans') {
        const unit = [r.battalion_code, r.vehicle_type, r.serial_number != null ? `#${r.serial_number}` : ''].filter(Boolean).join(' ');
        const part = r.part_name || L.part.get(String(r.part_id)) || '';
        const proc = r.process_name || L.proc.get(String(r.process_id)) || '';
        return [unit, part, proc].filter(Boolean).join(' · ');
    }
    const unit = [r.vehicle, r.vehicle_no].filter(Boolean).join(' ');
    return [unit, r.process_station].filter(Boolean).join(' · ');
}

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v);
const words = k => k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

function fmtValue(L, key, v, row) {
    if (v === null || v === undefined || v === '') return '—';
    if (key === 'password_changed') return _t('changed');
    if (typeof v === 'boolean') return _t(v ? 'Yes' : 'No');
    if (key === 'battalion_id') return L.batt.get(String(v)) || String(v);
    if (key === 'station_code') return stationName(L, row?.vehicle_type || row?.vehicle, v);
    if (key === 'part_id') return L.part.get(String(v)) || String(v);
    if (key === 'process_id') return L.proc.get(String(v)) || String(v);
    if (key === 'role') return typeof roleLabel === 'function' ? _t(roleLabel(v)) : String(v);
    if (key === 'category' && L.cat.has(String(v))) return _t(L.cat.get(String(v)));
    if (key === 'modules' && Array.isArray(v)) return v.map(m => MODULE_SHORT[m] || m).join(', ');
    if (key === 'module' && MODULE_LABEL[v]) return MODULE_LABEL[v];
    if (isDate(v)) return fmtDate(v);
    if (Array.isArray(v)) return v.length <= 4 && v.every(x => typeof x !== 'object') ? v.join(', ') : _t('{n} items', { n: v.length });
    if (typeof v === 'object') return _t('{n} fields', { n: Object.keys(v).length });
    const s = String(v);
    return s.length > 140 ? s.slice(0, 137) + '…' : s;
}

/** The list of field changes, in plain words. */
function changesOf(L, e) {
    const b = e.data_before && typeof e.data_before === 'object' && !Array.isArray(e.data_before) ? e.data_before : null;
    const a = e.data_after && typeof e.data_after === 'object' && !Array.isArray(e.data_after) ? e.data_after : null;
    if (!a && !b) return [];
    const row = { ...(b || {}), ...(a || {}) };
    const keys = [...new Set([...Object.keys(b || {}), ...Object.keys(a || {})])].filter(k => !HIDDEN.has(k));
    const out = [];
    for (const k of keys) {
        const bv = b?.[k], av = a?.[k];
        if (e.action === 'UPDATE' || e.action === 'UPSERT') {
            if (b && a && JSON.stringify(bv) === JSON.stringify(av)) continue;
            if (!(k in (a || {}))) continue; // partial update: only what was written
        }
        out.push({
            key: k,
            label: _t(FIELD[k] || words(k)),
            from: b && e.action !== 'INSERT' ? fmtValue(L, k, bv, row) : null,
            to: a ? fmtValue(L, k, av, row) : null,
        });
    }
    return out;
}

/** { verb, subject, sub, area, moduleId, nav, tone, changes } */
function describe(L, rows, e) {
    const t = e.table_name || '';
    const rid = String(e.record_id ?? '');
    const a = e.data_after || {}, b = e.data_before || {};
    const ctx = a._ctx || b._ctx || {};
    const moduleId = ctx.module || MODULE_OF(t) || a.module || b.module || null;
    const action = e.action || '';
    let verb = _t(VERB[action] || words(action.toLowerCase()));
    let subject = '', kind = '', nav = null;
    const vehicleOf = s => String(s || '').split(/[:-]/)[0];

    if (action === 'LOGIN' || action === 'LOGOUT') {
        kind = _t('Session');
        subject = userName(L, e.user_id || e.user_email) || e.user_email || '';
        nav = { kind: 'user', id: e.user_id, email: e.user_email };
        // Still signed in: PPMS opened again, or back after being away (written by app.js)
        if (a.session === 'reopened') { verb = _t('Opened PPMS'); subject += ` — ${_t('still signed in')}`; kind = _t('Session (already signed in)'); }
        if (a.session === 'resumed') { verb = _t('Came back'); subject += a.away_minutes ? ` — ${_t('after {n} min away', { n: a.away_minutes })}` : ''; kind = _t('Session (already signed in)'); }
    } else if (action === 'EXPORT') {
        kind = _t('Report / export');
        const file = a.file || rid;
        // "executive_report_2026-10-06.pdf" -> "Executive report (PDF)"
        const base = file.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]?\d{4}-\d{2}-\d{2}.*$/, '').replace(/[_]+/g, ' ').trim();
        subject = `${base ? base.charAt(0).toUpperCase() + base.slice(1) : file}${a.format ? ` (${a.format})` : ''}`;
    } else if (PLAN_TABLES.has(t)) {
        kind = _t('Plan block');
        const row = rows[t]?.get(rid);
        const isId = /^\d+$/.test(rid);
        if (ctx.label) subject = ctx.label;
        else if (isId) subject = planLabel(L, t, row || { ...b, ...a });
        const battalion = row ? (row.battalion_code || L.batt.get(String(row.battalion_id)) || '') : (ctx.battalion || '');
        if (isId && (row || (ctx.label && action !== 'DELETE'))) nav = { kind: 'plan', table: t, id: rid, module: moduleId, battalion };
        if (isId && !row && action !== 'INSERT' && !ctx.label && !subject) subject = _t('a block that is no longer in the plan');
        if (!isId) {
            const n = a.count ?? b.count ?? (Array.isArray(a) ? a.length : Array.isArray(b) ? b.length : null);
            const sampleId = a.sample?.id ?? b.ids?.[0];
            const sample = sampleId ? rows[t]?.get(String(sampleId)) : null;
            if (/^batch-move/.test(rid)) { verb = _t('Rescheduled'); subject = _t('{n} blocks', { n: n ?? '?' }) + (sample ? ` — ${_t('e.g.')} ${planLabel(L, t, sample)}` : ''); }
            else if (rid === 'undo' || rid === 'redo') { verb = _t(rid === 'undo' ? 'Undid' : 'Redid'); subject = _t('a block move ({n} blocks)', { n: n ?? '?' }); }
            else if (/^revision-/.test(rid)) { verb = _t('Copied'); subject = _t('the plan into a new version'); }
            else if (/import/.test(rid)) { verb = _t(action === 'UPDATE' ? 'Updated by import' : 'Imported'); subject = _t('{n} blocks', { n: Array.isArray(a) ? a.length : (n ?? '?') }); }
            else if (/copy-from-unit/.test(rid)) { verb = _t(/undo/.test(rid) ? 'Undid' : /redo/.test(rid) ? 'Redid' : 'Copied'); subject = a.reference ? _t('{ref} to {units}', { ref: a.reference, units: (a.units || []).join(', ') }) : _t('a unit plan to other units'); }
            else if (/template/.test(rid)) { verb = _t(/undo/.test(rid) ? 'Undid' : /redo/.test(rid) ? 'Redid' : 'Added'); subject = _t('the {vehicle} template', { vehicle: vehicleOf(rid) }); }
            else if (/version-(delete|remove)/.test(rid)) {
                const codes = (b.station_codes || [b.station_code]).filter(Boolean);
                verb = _t('Removed'); subject = _t('{stations} from the {vehicle} plan', { stations: codes.map(c => stationName(L, vehicleOf(rid), c)).join(', '), vehicle: vehicleOf(rid) });
            } else if (action === 'GENERATE') { subject = _t('the plan for {battalion}', { battalion: b.battalion_code || L.batt.get(rid) || rid }); }
            else if (n != null) subject = _t('{n} blocks', { n });
            else subject = rid;
            if (sampleId && sample) nav = { kind: 'plan', table: t, id: String(sampleId), module: moduleId };
            else if (moduleId) nav = { kind: 'schedule', module: moduleId };
        }
    } else if (PROGRESS_TABLES.has(t)) {
        kind = _t('Actual dates');
        const planTable = t === 'kd2_progress' ? 'kd2_plan' : 'assembly_plan';
        const planId = ctx.planId ?? a.plan_id ?? b.plan_id ?? rows[t]?.get(rid)?.plan_id ?? rid;
        const row = rows[planTable]?.get(String(planId));
        subject = ctx.label || planLabel(L, planTable, row) || _t('a block that is no longer in the plan');
        verb = _t(action === 'INSERT' ? 'Recorded actuals for' : 'Updated actuals for');
        if (row || ctx.label) nav = { kind: 'plan', table: planTable, id: String(planId), module: moduleId, focus: 'table', battalion: row ? (L.batt.get(String(row.battalion_id)) || '') : (ctx.battalion || '') };
    } else if (t === 'planning_app_users') {
        kind = _t('User');
        subject = a.full_name || b.full_name || userName(L, rid) || a.email || b.email || _t('a user');
        if (a.password_changed) verb = _t('Changed the password of');
        if (action !== 'DELETE') nav = { kind: 'user', id: rid };
    } else if (t === 'ppms_export_permissions') {
        kind = _t('Access'); subject = userName(L, rid) || rid; nav = { kind: 'user', id: rid };
    } else if (t === 'production_issues') {
        kind = _t('Issue');
        const title = a.title || b.title || '';
        subject = `#${rid}${title ? ' — ' + title : ''}`;
        if (action !== 'DELETE') nav = { kind: 'issue', id: rid, module: a.module || b.module || null };
    } else if (t === 'production_issue_categories') {
        kind = _t('Issue category'); subject = a.label || b.label || L.cat.get(rid) || rid; nav = { kind: 'section', section: 'issuesSection' };
    } else if (t === 'plan_versions') {
        kind = _t('Plan version');
        const v = L.version.get(rid);
        subject = a.name || b.name || v?.name || rid;
        const mod = a.module_id || b.module_id || v?.module_id;
        if (mod) subject += ` (${MODULE_SHORT[mod] || mod})`;
        if (a.status && b.status && a.status !== b.status) verb = _t(a.status === 'archived' ? 'Archived' : 'Restored');
        if (a.name && b.name && a.name !== b.name) verb = _t('Renamed');
        nav = { kind: 'versions', module: mod || null };
    } else if (/^kd2_process|^kd2_plan_route_order|^kd2_template_layout/.test(t)) {
        kind = _t('Process setup');
        const [veh, code, extra] = rid.split(':');
        const stName = code && !/^(pin-order|route-drag|version-route-drag|category-reorder)$/.test(code) ? stationName(L, veh, code.split(',')[0]) : '';
        if (/route-drag|pin-order/.test(rid)) { verb = _t('Reordered'); subject = _t('the {vehicle} route', { vehicle: veh }); }
        else if (/category-reorder/.test(rid)) { verb = _t('Reordered'); subject = _t('the {vehicle} categories', { vehicle: veh }); }
        else if (extra === 'visibility') { subject = _t('visibility of {stations} ({vehicle})', { stations: code.split(',').map(c => stationName(L, veh, c)).join(', '), vehicle: veh }); }
        else if (t === 'kd2_process_lead_times' && !code) { subject = _t('lead times for {vehicle}', { vehicle: veh || rid }); }
        else if (t === 'kd2_template_layout_items') { subject = _t('the {vehicle} template layout', { vehicle: veh || rid }); }
        else if (t === 'kd2_process_categories') { subject = _t('category {name}', { name: a.category_name || a[0]?.category_name || rid }); }
        else if (stName) { subject = `${veh} · ${stName}`; if (a.is_active === false && b.is_active !== false) verb = _t('Retired'); }
        else subject = rid;
        nav = { kind: 'processes', vehicle: /^K\d+/.test(veh) ? veh : 'K9', station: stName || '' };
    } else if (t === 'planning_non_work_days') {
        kind = _t('No-work days');
        const range = rid.replace(/^kd2:no-work:?/, '');
        subject = range ? range.split('..').map(d => fmtDate(d)).join(' – ') : _t('no-work days');
        nav = { kind: 'nowork' };
    } else if (t === 'kd2_battalions' || t === 'kd2_planning_inputs') {
        kind = _t('Battalion');
        subject = a.battalion_code || b.battalion_code || L.batt.get(rid) || (Array.isArray(a.battalions) ? a.battalions.join(', ') : rid);
        if (t === 'kd2_planning_inputs') subject = _t('planning inputs of {battalion}', { battalion: L.batt.get(rid) || subject });
        nav = { kind: 'section', section: 'kd2PlanningInputs', module: 'kd2' };
    } else if (t === 'f100_parts' || t === 'f100_processes') {
        kind = _t(t === 'f100_parts' ? 'F100 part' : 'F100 process');
        subject = a.part_name || a.process_name || (t === 'f100_parts' ? L.part.get(rid) : L.proc.get(rid)) || rid;
        nav = { kind: 'f100parts', module: 'f100kd2' };
    } else {
        kind = words(t || 'record');
        subject = rid;
    }
    const changes = changesOf(L, e);
    return { verb, kind, subject: subject || '—', moduleId, nav, tone: TONE[action] || 'change', changes };
}

/* ── Rendering ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const e2 = s => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`));

function initials(name) {
    const p = String(name || '?').trim().split(/\s+/);
    return ((p[0]?.[0] || '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
function relTime(iso) {
    const s = Math.round((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return _t('just now');
    if (s < 3600) return _t('{a}m ago', { a: Math.floor(s / 60) });
    if (s < 86400) return _t('{a}h ago', { a: Math.floor(s / 3600) });
    return '';
}
function dayHeading(iso) {
    const d = new Date(iso), today = new Date();
    const key = d.toDateString();
    if (key === today.toDateString()) return _t('Today');
    const y = new Date(today); y.setDate(y.getDate() - 1);
    if (key === y.toDateString()) return _t('Yesterday');
    return d.toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function changeSummary(changes) {
    if (!changes.length) return '';
    const parts = changes.slice(0, 2).map(c => (c.from != null && c.to != null && c.from !== c.to
        ? `<b>${e2(c.label)}</b> <s>${e2(c.from)}</s> → ${e2(c.to)}`
        : `<b>${e2(c.label)}</b> ${e2(c.to ?? c.from)}`));
    const more = changes.length > 2 ? ` <span class="al2-more">${e2(_t('+{n} more', { n: changes.length - 2 }))}</span>` : '';
    return parts.join('<span class="al2-sep">·</span>') + more;
}

function rowHtml(e, d) {
    const L = S.look;
    const name = userName(L, e.user_id || e.user_email) || e.user_email || '—';
    const dt = new Date(e.created_at);
    const time = dt.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });
    const rel = relTime(e.created_at);
    const role = e.user_role || 'viewer';
    const open = S.expanded.has(String(e.id));
    const navBtn = d.nav
        ? `<button type="button" class="al2-btn al2-btn--go" data-al-go="${e2(e.id)}" title="${e2(_t('Open this in the system'))}">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M11 4h5v5M16 4l-7 7M14 11v4a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h4"/></svg>${e2(_t('View'))}</button>`
        : '';
    return `
    <div class="al2-row${open ? ' is-open' : ''}" data-al-id="${e2(e.id)}">
      <div class="al2-when"><span class="al2-time">${e2(time)}</span>${rel ? `<span class="al2-rel">${e2(rel)}</span>` : ''}</div>
      <div class="al2-who" title="${e2(e.user_email || '')}">
        <span class="al2-avatar">${e2(initials(name))}</span>
        <span class="al2-who-text"><b>${e2(name)}</b><span class="role-pill ${typeof roleClass === 'function' ? roleClass(role) : ''}">${e2(typeof roleLabel === 'function' ? _t(roleLabel(role)) : role)}</span></span>
      </div>
      <div class="al2-what">
        <div class="al2-line"><span class="al2-verb al2-tone-${d.tone}">${e2(d.verb)}</span> <span class="al2-subject">${e2(d.subject)}</span></div>
        <div class="al2-meta">
          <span class="al2-chip">${e2(d.kind)}</span>
          ${d.moduleId ? `<span class="al2-chip al2-chip--mod">${e2(MODULE_SHORT[d.moduleId] || d.moduleId)}</span>` : ''}
          ${e.plan_version_name ? `<span class="al2-chip al2-chip--ver" title="${e2(_t('Plan version'))}">${e2(e.plan_version_name)}</span>` : ''}
        </div>
        ${d.changes.length ? `<div class="al2-changes">${changeSummary(d.changes)}</div>` : ''}
      </div>
      <div class="al2-acts">
        ${navBtn}
        <button type="button" class="al2-btn" data-al-toggle="${e2(e.id)}" aria-expanded="${open}">${e2(_t(open ? 'Hide details' : 'Details'))}</button>
      </div>
      ${open ? detailHtml(e, d) : ''}
    </div>`;
}

function detailHtml(e, d) {
    const rows = d.changes.map(c => `
        <tr><th>${e2(c.label)}</th>
            <td class="al2-old">${c.from == null ? '<span class="al2-dim">—</span>' : e2(c.from)}</td>
            <td class="al2-arrow">→</td>
            <td class="al2-new">${c.to == null ? `<span class="al2-dim">${e2(_t('removed'))}</span>` : e2(c.to)}</td></tr>`).join('');
    const dt = new Date(e.created_at);
    return `
      <div class="al2-detail">
        ${rows ? `<table class="al2-diff"><thead><tr><th>${e2(_t('Field'))}</th><th>${e2(_t('Before'))}</th><th></th><th>${e2(_t('After'))}</th></tr></thead><tbody>${rows}</tbody></table>`
               : `<p class="al2-dim">${e2(_t('No field data recorded'))}</p>`}
        <dl class="al2-tech">
          <div><dt>${e2(_t('Date / Time'))}</dt><dd>${e2(dt.toLocaleString(getLocale(), { hour12: false }))}</dd></div>
          <div><dt>${e2(_t('User'))}</dt><dd>${e2(e.user_email || '—')}</dd></div>
          <div><dt>${e2(_t('Action'))}</dt><dd class="mono">${e2(e.action || '—')}</dd></div>
          <div><dt>${e2(_t('Table'))}</dt><dd class="mono">${e2(e.table_name || '—')}</dd></div>
          <div><dt>${e2(_t('Record ID'))}</dt><dd class="mono">${e2(e.record_id || '—')}</dd></div>
          <div><dt>${e2(_t('IP Address'))}</dt><dd class="mono">${e2(e.ip_address || '—')}</dd></div>
        </dl>
      </div>`;
}

function matchesSearch(e, d, q) {
    if (!q) return true;
    const L = S.look;
    const hay = [d.verb, d.kind, d.subject, e.user_email, userName(L, e.user_id || e.user_email), e.plan_version_name,
        e.record_id, ...d.changes.flatMap(c => [c.label, c.from, c.to])].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

function render() {
    const list = $('al2List');
    if (!list) return;
    const q = ($('alSearch')?.value || '').trim();
    let lastDay = '', html = '', shown = 0;
    for (const e of S.entries) {
        const d = S.described.get(String(e.id));
        if (!d || !matchesSearch(e, d, q)) continue;
        const day = new Date(e.created_at).toDateString();
        if (day !== lastDay) { html += `<div class="al2-day">${e2(dayHeading(e.created_at))}</div>`; lastDay = day; }
        html += rowHtml(e, d);
        shown++;
    }
    list.innerHTML = html || `<div class="al2-empty">${e2(_t(S.entries.length ? 'Nothing on this page matches the search — load more or change the filters.' : 'No audit entries match the filters.'))}</div>`;
    const count = $('alEntryCount');
    if (count) count.textContent = q
        ? _t('{a} of {b} loaded entries match', { a: shown, b: S.entries.length })
        : _t('{a} entries · {b} loaded', { a: S.total.toLocaleString(), b: S.entries.length.toLocaleString() });
    const more = $('btnAlMore');
    if (more) more.style.display = S.offset < S.total ? '' : 'none';
}

/* ── Querying ─────────────────────────────────────────────────── */
function filters() {
    return {
        group: $('alFilterAction')?.value || '',
        area: $('alFilterArea')?.value || '',
        module: $('alFilterModule')?.value || '',
        user: $('alFilterUser')?.value || '',
        period: $('alFilterPeriod')?.value || 'all',
        from: $('alFilterDateFrom')?.value || '',
        to: $('alFilterDateTo')?.value || '',
    };
}

/** The Supabase query for the current filters (null when nothing can match). */
function buildQuery(f, { count = false } = {}) {
    let q = db.from('planning_audit_log').select('*', count ? { count: 'exact' } : undefined).order('created_at', { ascending: false });
    const g = ACTION_GROUPS.find(x => x.id === f.group);
    if (g) q = q.in('action', g.actions);
    const area = AREAS.find(x => x.id === f.area);
    let tables = area?.tables || null;
    if (area?.actions) q = q.in('action', area.actions);
    if (f.module) {
        const modTables = AREAS.flatMap(x => x.tables || []).filter(t => MODULE_OF(t) === f.module);
        tables = tables ? tables.filter(t => modTables.includes(t)) : modTables;
        if (!tables.length) return null;
    }
    if (tables) q = q.in('table_name', tables);
    if (f.user) q = q.eq('user_email', f.user);
    let from = f.from, to = f.to;
    if (f.period !== 'custom') {
        from = to = '';
        const days = { today: 0, '7': 6, '30': 29 }[f.period];
        if (days != null) { const d = new Date(); d.setDate(d.getDate() - days); from = d.toISOString().slice(0, 10); }
    }
    if (from) q = q.gte('created_at', new Date(from + 'T00:00:00').toISOString());
    if (to) q = q.lte('created_at', new Date(to + 'T23:59:59').toISOString());
    return q;
}

async function describeAll(entries) {
    const L = await loadLookups();
    const rows = await loadRows(entries);
    entries.forEach(e => {
        try { S.described.set(String(e.id), describe(L, rows, e)); }
        catch (err) { console.warn('[audit] describe', err); S.described.set(String(e.id), { verb: e.action, kind: e.table_name, subject: e.record_id || '—', changes: [], tone: 'change' }); }
    });
}

async function load(reset = true) {
    const list = $('al2List');
    if (reset) {
        S.offset = 0; S.entries = []; S.described.clear(); S.expanded.clear();
        if (list) list.innerHTML = `<div class="al2-empty"><span class="spinner"></span> ${e2(_t('Loading…'))}</div>`;
    }
    const q = buildQuery(filters(), { count: true });
    if (!q) { S.total = 0; render(); return; }
    const { data, count, error } = await q.range(S.offset, S.offset + PAGE - 1);
    if (error) {
        if (list) list.innerHTML = `<div class="al2-empty">${e2(_t('Error: {a}', { a: error.message }))}</div>`;
        return;
    }
    S.total = count || 0;
    await describeAll(data || []);
    S.entries.push(...(data || []));
    S.offset += (data || []).length;
    render();
}

/* ── Filters UI ───────────────────────────────────────────────── */
function fillSelects() {
    const opt = (v, l) => `<option value="${e2(v)}">${e2(l)}</option>`;
    const act = $('alFilterAction');
    if (act && !act.dataset.ready) {
        act.innerHTML = opt('', _t('All actions')) + ACTION_GROUPS.map(g => opt(g.id, _t(g.label))).join('');
        act.dataset.ready = '1';
    }
    const area = $('alFilterArea');
    if (area && !area.dataset.ready) {
        area.innerHTML = opt('', _t('Everything')) + AREAS.map(a => opt(a.id, _t(a.label))).join('');
        area.dataset.ready = '1';
    }
    const mod = $('alFilterModule');
    if (mod && !mod.dataset.ready) {
        mod.innerHTML = opt('', _t('All modules')) + Object.entries(MODULE_LABEL).map(([k, v]) => opt(k, v)).join('');
        mod.dataset.ready = '1';
    }
    const user = $('alFilterUser');
    if (user && S.look) {
        const cur = user.value;
        user.innerHTML = opt('', _t('All users')) + [...S.look.users]
            .sort((a, b) => String(a.full_name || a.email).localeCompare(String(b.full_name || b.email)))
            .map(u => opt(u.email, u.full_name ? `${u.full_name} (${u.email})` : u.email)).join('');
        user.value = cur;
    }
    syncPeriod();
}
function syncPeriod() {
    const custom = $('alFilterPeriod')?.value === 'custom';
    document.querySelectorAll('.al2-custom-dates').forEach(el => { el.hidden = !custom; });
}

export function reset() {
    ['alFilterAction', 'alFilterArea', 'alFilterModule', 'alFilterUser', 'alFilterDateFrom', 'alFilterDateTo', 'alSearch'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    const p = $('alFilterPeriod'); if (p) p.value = 'all';
    syncPeriod();
    load(true);
}

/* ── Open / close ─────────────────────────────────────────────── */
export async function open(preset = {}) {
    const ov = $('auditLogOverlay');
    if (!ov) return;
    ov.style.display = 'flex';
    S.open = true;
    await loadLookups();
    fillSelects();
    if (preset.user != null) { const u = $('alFilterUser'); if (u) u.value = preset.user; }
    load(true);
}
export function close() {
    const ov = $('auditLogOverlay');
    if (ov) ov.style.display = 'none';
    S.open = false;
}

/* ── Going to the thing ───────────────────────────────────────── */
function flash(el) {
    if (!el) return;
    el.classList.remove('ppms-flash');
    void el.offsetWidth;
    el.classList.add('ppms-flash');
    setTimeout(() => el.classList.remove('ppms-flash'), 2600);
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, ms = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(120); }
    return null;
}

async function goToPlanRow(nav) {
    const id = String(nav.id);
    const inData = () => (typeof currentData !== 'undefined' ? currentData : []).some(r => String(r.id) === id);
    if (!inData() && nav.battalion && getActiveModuleId() === 'kd2') {
        // KD2 loads one battalion at a time — load the block's battalion
        await applyFilters({ battalion: [nav.battalion] });
        await waitFor(inData, 6000);
    }
    if (!inData()) {
        showToast(_t('This block is not in the current view — it may have been deleted, or the filters hide it. Clear the filters and try again.'), 'info');
        return;
    }
    if (nav.focus !== 'table') {
        document.getElementById('ganttNavAnchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const bar = await waitFor(() => document.querySelector(`#ganttInner .gc-bar[data-plan-id="${CSS.escape(id)}"]`), 2500);
        if (bar) {
            await wait(350);
            bar.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            flash(bar);
            showToast(_t('Showing the block on the schedule.'), 'info');
            return;
        }
    }
    document.getElementById('tableSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await wait(400);
    if (typeof _ensureTableRowRendered === 'function') _ensureTableRowRendered(id);
    const tr = await waitFor(() => document.querySelector(`tr[data-plan-id="${CSS.escape(id)}"]`), 2500);
    if (tr) { tr.scrollIntoView({ behavior: 'smooth', block: 'center' }); flash(tr); }
    else showToast(_t('This block is not in the current view — it may have been deleted, or the filters hide it. Clear the filters and try again.'), 'info');
}

/** Go to what an audit entry is about. Switches module (page reload) when needed. */
export async function goTo(nav) {
    if (!nav) return;
    const here = getActiveModuleId();
    if (nav.module && nav.module !== here && ['plan', 'issue', 'versions', 'schedule', 'f100parts', 'section'].includes(nav.kind)) {
        if (!window.confirm(_t('This is in {module}. Switch to {module} to view it? The page will reload.', { module: MODULE_LABEL[nav.module] || nav.module }))) return;
        try { sessionStorage.setItem(GOTO_KEY, JSON.stringify(nav)); } catch {}
        getModuleRuntime()?.setActiveModule?.(nav.module);
        window.location.reload();
        return;
    }
    close();
    switch (nav.kind) {
        case 'plan': return goToPlanRow(nav);
        case 'schedule':
            document.getElementById('ganttNavAnchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        case 'issue':
            document.getElementById('issuesSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            await wait(400);
            flash(document.querySelector(`#issuesTableBody tr[data-issue-id="${CSS.escape(String(nav.id))}"]`));
            if (typeof openIssueView === 'function') openIssueView(nav.id);
            return;
        case 'user':
            if (typeof window.PPMSUsers?.open === 'function') window.PPMSUsers.open({ focusUser: nav.id || nav.email });
            else if (typeof openUserMgmt === 'function') openUserMgmt();
            return;
        case 'versions':
            document.getElementById('btnManagePlanVersions')?.click();
            return;
        case 'processes': {
            const rt = getModuleRuntime();
            if (here !== 'kd2') { showToast(_t('Switch to F200 – KD2 to manage its processes.'), 'info'); return; }
            await rt?.openProcessModal?.(nav.vehicle || 'K9');
            if (nav.station) {
                const s = await waitFor(() => document.getElementById('kd2ProcessSearch'), 2000);
                if (s) { s.value = nav.station; s.dispatchEvent(new Event('input', { bubbles: true })); }
            }
            return;
        }
        case 'nowork':
            if (here !== 'kd2') { showToast(_t('Switch to F200 – KD2 to manage its no-work days.'), 'info'); return; }
            document.getElementById('btnKd2NoWorkDays')?.click();
            return;
        case 'f100parts':
            document.getElementById('btnF100ManageProcesses')?.click();
            return;
        case 'section': {
            const el = document.getElementById(nav.section) || document.getElementById('kd2WorkspaceSection');
            if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); flash(el); }
            return;
        }
        default:
    }
}

/** After a module switch: finish the jump once the data has loaded. */
export async function resumePending() {
    let nav = null;
    try { nav = JSON.parse(sessionStorage.getItem(GOTO_KEY) || 'null'); sessionStorage.removeItem(GOTO_KEY); } catch {}
    if (!nav) return;
    await wait(900);
    goTo({ ...nav, module: null });
}

/* ── Export (readable columns) ────────────────────────────────── */
async function fetchAllForExport() {
    const q = buildQuery(filters());
    if (!q) return [];
    const out = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await q.range(from, from + 999);
        if (error) { showToast(_t('Export failed:') + ' ' + error.message, 'error'); return null; }
        out.push(...(data || []));
        if (!data || data.length < 1000) break;
    }
    await describeAll(out);
    return out;
}
function exportRow(e) {
    const d = S.described.get(String(e.id)) || { verb: e.action, kind: '', subject: e.record_id, changes: [] };
    const dt = new Date(e.created_at);
    return {
        when: dt.toLocaleDateString('en-GB') + ' ' + dt.toLocaleTimeString('en-GB', { hour12: false }),
        who: userName(S.look, e.user_id || e.user_email) || e.user_email || '—',
        email: e.user_email || '',
        what: `${d.verb} ${d.subject}`,
        kind: d.kind,
        module: MODULE_SHORT[d.moduleId] || '',
        version: e.plan_version_name || '',
        changes: d.changes.map(c => `${c.label}: ${c.from != null ? c.from + ' → ' : ''}${c.to ?? ''}`).join('; '),
        tech: `${e.action} ${e.table_name || ''} #${e.record_id || ''}`.trim(),
        ip: e.ip_address || '',
    };
}
export async function exportExcel() {
    if (!window.XLSX) { showToast(_t('Excel library not loaded — please refresh.'), 'error'); return; }
    showToast(_t('Preparing Excel export…'), 'info');
    const rows = await fetchAllForExport();
    if (!rows) return;
    const data = [['Date / Time', 'User', 'Email', 'What happened', 'Type', 'Module', 'Plan version', 'Changes', 'Technical record', 'IP Address'],
        ...rows.map(exportRow).map(r => [r.when, r.who, r.email, r.what, r.kind, r.module, r.version, r.changes, r.tech, r.ip])];
    const ws = window.XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 28 }, { wch: 60 }, { wch: 16 }, { wch: 8 }, { wch: 18 }, { wch: 70 }, { wch: 34 }, { wch: 16 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Audit Log');
    window.XLSX.writeFile(wb, `audit_log_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast(_t('Excel exported.'), 'success');
}
export async function exportPDF() {
    if (!window.jspdf) { showToast(_t('PDF library not loaded — please refresh.'), 'error'); return; }
    showToast(_t('Preparing PDF export…'), 'info');
    const rows = await fetchAllForExport();
    if (!rows) return;
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(30, 58, 138); doc.rect(0, 0, W, 20, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Audit Log', 14, 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(186, 230, 253);
    doc.text(`Generated: ${new Date().toLocaleString('en-GB')}   ·   ${rows.length.toLocaleString()} entries`, W - 14, 16, { align: 'right' });
    doc.autoTable({
        startY: 24,
        head: [['Date / Time', 'User', 'What happened', 'Module', 'Version', 'Changes']],
        body: rows.map(exportRow).map(r => [r.when, r.who, r.what, r.module, r.version, r.changes]),
        margin: { left: 14, right: 14 },
        styles: { fontSize: 7, cellPadding: 2, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.2, overflow: 'linebreak' },
        headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 30 }, 2: { cellWidth: 82 }, 3: { cellWidth: 14 }, 4: { cellWidth: 24 } },
    });
    doc.save(`audit_log_${new Date().toISOString().slice(0, 10)}.pdf`);
    showToast(_t('PDF exported.'), 'success');
}

/* ── Wiring ───────────────────────────────────────────────────── */
let searchTimer = 0;
export function wireAuditLog() {
    window.PPMSAudit = { open, close, reload: load, reset, goTo, resumePending, exportExcel, exportPDF };
    document.addEventListener('click', ev => {
        const go = ev.target.closest?.('[data-al-go]');
        if (go) {
            const d = S.described.get(String(go.dataset.alGo));
            goTo(d?.nav);
            return;
        }
        const tg = ev.target.closest?.('[data-al-toggle]');
        if (tg) {
            const id = String(tg.dataset.alToggle);
            S.expanded.has(id) ? S.expanded.delete(id) : S.expanded.add(id);
            const row = tg.closest('.al2-row');
            const e = S.entries.find(x => String(x.id) === id);
            if (row && e) {
                const tmp = document.createElement('div');
                tmp.innerHTML = rowHtml(e, S.described.get(id));
                row.replaceWith(tmp.firstElementChild);
            }
        }
    });
    document.addEventListener('change', ev => {
        if (!ev.target.closest?.('#auditLogOverlay .al2-filters')) return;
        if (ev.target.id === 'alFilterPeriod') syncPeriod();
        if (ev.target.id === 'alFilterPeriod' && ev.target.value === 'custom') return;
        load(true);
    });
    document.addEventListener('input', ev => {
        if (ev.target.id !== 'alSearch') return;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(render, 150);
    });
}

'use strict';

/**
 * Plan revisions — a named, per-module "version" of a plan (assembly_plan for
 * kd1, kd2_plan for kd2/f100kd2) that the whole app can be scoped to.
 *
 * Loaded as a classic script (see scripts/pages/index-page.js) before
 * kd2.js/app.js, which each own their own Supabase client instance — every
 * function here takes `db` explicitly rather than holding one, and mirrors
 * the localStorage-backed "active module" pattern already used for module
 * switching (kd2.js MODULE_KEY / getActiveModule / setActiveModule).
 */
window.PlanVersions = (() => {
    const KEY_PREFIX = 'ppms_active_plan_version_';

    const cache = {};          // moduleId -> plan_versions rows (baseline first, then newest)
    const baselineCache = {};  // moduleId -> baseline version id

    function storageKey(moduleId) {
        return KEY_PREFIX + moduleId;
    }

    /** Currently-selected version id for a module, falling back to its baseline once known. */
    function getActiveId(moduleId) {
        let stored = null;
        try {
            const raw = localStorage.getItem(storageKey(moduleId));
            stored = raw ? parseInt(raw, 10) : null;
        } catch {
            stored = null;
        }
        const known = cache[moduleId];
        if (stored && known && !known.some(v => v.id === stored)) stored = null; // stale/archived-away id
        return stored || baselineCache[moduleId] || null;
    }

    function setActiveId(moduleId, versionId) {
        try { localStorage.setItem(storageKey(moduleId), String(versionId)); } catch { /* storage unavailable */ }
    }

    /** Loads (and caches) every plan_versions row for a module. Call once per module per page load. */
    async function load(db, moduleId) {
        const { data, error } = await db
            .from('plan_versions')
            .select('*')
            .eq('module_id', moduleId)
            .order('is_baseline', { ascending: false })
            .order('created_at', { ascending: false });
        if (error) throw error;
        cache[moduleId] = data || [];
        const baseline = cache[moduleId].find(v => v.is_baseline);
        if (baseline) baselineCache[moduleId] = baseline.id;
        return cache[moduleId];
    }

    function getVersions(moduleId) {
        return cache[moduleId] || [];
    }

    /** Applies the active-version filter to a Supabase query for a version-scoped table. */
    function scoped(query, moduleId) {
        const id = getActiveId(moduleId);
        return id ? query.eq('plan_version_id', id) : query;
    }

    async function queryAllPages(query) {
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

    async function insertChunked(db, table, rows, chunkSize = 500) {
        for (let i = 0; i < rows.length; i += chunkSize) {
            const batch = rows.slice(i, i + chunkSize);
            if (!batch.length) continue;
            const { error } = await db.from(table).insert(batch);
            if (error) throw error;
        }
    }

    /**
     * Creates a brand new version. mode: 'copy' (default) clones the currently-
     * active version's plan rows (schedule only — progress intentionally does
     * not carry forward; Production Issues are shared across every version of
     * a module, not per-version, so they're untouched by this entirely);
     * mode: 'empty' creates the version with no plan rows at all, for a
     * from-scratch revision. Returns the new plan_versions row.
     */
    async function createRevision(db, moduleId, name, { userEmail, auditFn, chunkSize = 500, mode = 'copy' } = {}) {
        const sourceId = getActiveId(moduleId);
        if (mode === 'copy' && !sourceId) throw new Error('No active plan version to copy from.');

        const { data: versionRow, error: vErr } = await db
            .from('plan_versions')
            .insert({ module_id: moduleId, name, status: 'active', is_baseline: false, created_by: userEmail || null })
            .select()
            .single();
        if (vErr) throw vErr;

        if (mode === 'empty') {
            if (auditFn) await auditFn('INSERT', 'plan_versions', versionRow.id, null,
                { name, module_id: moduleId, mode: 'empty' });
            return versionRow;
        }

        try {
            if (moduleId === 'kd1') {
                const cols = 'vehicle, vehicle_no, process_station, week, start_date, end_date, remark';
                const sourceRows = await queryAllPages(
                    db.from('assembly_plan').select(cols).eq('plan_version_id', sourceId)
                );
                const cloneRows = sourceRows.map(r => ({ ...r, plan_version_id: versionRow.id }));
                await insertChunked(db, 'assembly_plan', cloneRows, chunkSize);
                if (auditFn) await auditFn('INSERT', 'assembly_plan', `revision-${versionRow.id}`, null,
                    { rows_added: cloneRows.length, plan_version_id: versionRow.id, source_version_id: sourceId });
            } else if (moduleId === 'kd2') {
                const cols = 'battalion_id, vehicle_type, unit_serial, unit_label, category_code, station_code, '
                    + 'category_sequence, station_sequence_in_category, route_sequence, schedule_week, '
                    + 'planned_start_date, planned_end_date, planning_source, remark';
                const sourceRows = await queryAllPages(
                    db.from('kd2_plan').select(cols).eq('plan_version_id', sourceId)
                );
                const cloneRows = sourceRows.map(r => ({ ...r, plan_version_id: versionRow.id }));
                await insertChunked(db, 'kd2_plan', cloneRows, chunkSize);
                if (auditFn) await auditFn('INSERT', 'kd2_plan', `revision-${versionRow.id}`, null,
                    { rows_added: cloneRows.length, plan_version_id: versionRow.id, source_version_id: sourceId });
            } else {
                // f100kd2 — f100_plans carries its own progress fields (actual dates,
                // status, notes, comments) inline; reset them so the new revision
                // starts fresh like kd1/kd2's separate progress tables do.
                const cols = 'battalion_code, vehicle_type, serial_number, part_id, process_id, planned_start_date, planned_end_date';
                const sourceRows = await queryAllPages(
                    db.from('f100_plans').select(cols).eq('plan_version_id', sourceId)
                );
                const cloneRows = sourceRows.map(r => ({
                    ...r,
                    plan_version_id: versionRow.id,
                    status: 'Planned',
                    actual_start_date: null,
                    actual_end_date: null,
                    notes: null,
                    comments: [],
                }));
                await insertChunked(db, 'f100_plans', cloneRows, chunkSize);
                if (auditFn) await auditFn('INSERT', 'f100_plans', `revision-${versionRow.id}`, null,
                    { rows_added: cloneRows.length, plan_version_id: versionRow.id, source_version_id: sourceId });
            }
        } catch (err) {
            // Best-effort cleanup so a failed clone doesn't leave an empty, confusing version behind.
            await db.from('plan_versions').delete().eq('id', versionRow.id);
            throw err;
        }

        return versionRow;
    }

    async function renameVersion(db, versionId, name, auditFn) {
        const { data: before } = await db.from('plan_versions').select('*').eq('id', versionId).single();
        const { error } = await db.from('plan_versions').update({ name }).eq('id', versionId);
        if (error) throw error;
        if (auditFn) await auditFn('UPDATE', 'plan_versions', versionId, before, { ...before, name });
    }

    async function setStatus(db, versionId, status, auditFn) {
        const { data: before } = await db.from('plan_versions').select('*').eq('id', versionId).single();
        if (before?.is_baseline && status === 'archived') throw new Error('The baseline plan cannot be archived.');
        const { error } = await db.from('plan_versions').update({ status }).eq('id', versionId);
        if (error) throw error;
        if (auditFn) await auditFn('UPDATE', 'plan_versions', versionId, before, { ...before, status });
    }

    const PLAN_TABLE_BY_MODULE = { kd1: 'assembly_plan', kd2: 'kd2_plan', f100kd2: 'f100_plans' };

    /**
     * Permanently deletes a plan version and every plan row that belongs to it
     * (master-admin only, enforced by the caller — this module has no role
     * awareness). The baseline can never be deleted. If the deleted version was
     * the active selection, the caller's stored selection is cleared so the
     * next load falls back to the baseline.
     */
    async function deleteVersion(db, versionId, moduleId, auditFn) {
        const { data: before } = await db.from('plan_versions').select('*').eq('id', versionId).single();
        if (!before) throw new Error('Plan version not found.');
        if (before.is_baseline) throw new Error('The baseline plan cannot be deleted.');

        const table = PLAN_TABLE_BY_MODULE[moduleId];
        if (table) {
            const { error: rowsError } = await db.from(table).delete().eq('plan_version_id', versionId);
            if (rowsError) throw rowsError;
        }
        const { error } = await db.from('plan_versions').delete().eq('id', versionId);
        if (error) throw error;
        if (auditFn) await auditFn('DELETE', 'plan_versions', versionId, before, null);

        if (getActiveId(moduleId) === versionId) {
            try { localStorage.removeItem(storageKey(moduleId)); } catch { /* storage unavailable */ }
        }
    }

    return {
        getActiveId,
        setActiveId,
        load,
        getVersions,
        scoped,
        createRevision,
        renameVersion,
        setStatus,
        deleteVersion,
    };
})();

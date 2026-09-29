/* ================================================================
   FILTER BAR + EXECUTIVE SUMMARY — presentation behaviour
   • time-frame pills drive the (hidden) #filterTimeFrame select
   • filters that are set get highlighted, and appear as removable chips
   • the summary's scope label says what the numbers cover
   Filtering itself stays in app.js; removing a chip clicks the filter's
   own "All" checkbox (or resets the input), so the normal reload runs.
   ================================================================ */
/* global filterConfig, filterState, filterOptions, REPORT_FILTER_KEYS, ISSUE_FILTER_KEYS */

const TF_LABELS = { day: 'Today', week: 'This week', month: 'This month', custom: 'Custom dates' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function globals() {
    try {
        return {
            cfg: filterConfig, state: filterState, options: filterOptions,
            skip: new Set([...(REPORT_FILTER_KEYS || []), ...(ISSUE_FILTER_KEYS || [])]),
        };
    } catch { return null; }
}

/** Active main-bar filters: [{ key, label, text }] (only visible filter groups). */
export function activeFilters() {
    const g = globals();
    const out = [];
    if (g) {
        for (const key of Object.keys(g.cfg)) {
            if (g.skip.has(key)) continue;
            const sel = g.state[key];
            if (!sel || sel.has('all') || !sel.size) continue;
            const btn = document.getElementById(g.cfg[key].btn);
            const item = btn?.closest('.filter-item');
            if (!item || item.style.display === 'none') continue;
            const label = item.querySelector('.filter-label')?.textContent.trim() || key;
            const names = [...sel].map(v => (g.options[key] || []).find(o => o.value === v)?.label || v);
            out.push({ key, label, text: names.length > 2 ? `${names.length} selected` : names.join(', ') });
        }
    }
    const tf = document.getElementById('filterTimeFrame')?.value;
    if (tf && tf !== 'all') {
        let text = TF_LABELS[tf] || tf;
        if (tf === 'custom') {
            const a = document.getElementById('filterStartDate')?.value, b = document.getElementById('filterEndDate')?.value;
            if (a || b) text = `${a || '…'} → ${b || '…'}`;
        }
        out.push({ key: '__time', label: 'Time', text });
    }
    const q = document.getElementById('filterSearch')?.value.trim();
    if (q) out.push({ key: '__search', label: 'Search', text: `"${q}"` });
    return out;
}

export function refreshFilterUI() {
    const g = globals();
    if (g) {
        for (const key of Object.keys(g.cfg)) {
            if (g.skip.has(key)) continue;
            const item = document.getElementById(g.cfg[key].btn)?.closest('.filter-item');
            const sel = g.state[key];
            item?.classList.toggle('is-set', !!sel && !sel.has('all') && sel.size > 0);
        }
    }
    document.getElementById('filterSearchGroup')?.classList.toggle('is-set', !!document.getElementById('filterSearch')?.value.trim());

    const active = activeFilters();
    const chips = document.getElementById('fxChips');
    if (chips) {
        chips.innerHTML = active.map(a =>
            `<button type="button" class="fx-chip" data-fx-clear="${esc(a.key)}" title="Remove this filter"><span><b>${esc(a.label)}:</b> ${esc(a.text)}</span><span class="fx-chip-x" aria-hidden="true">&times;</span></button>`).join('');
    }
    const count = document.getElementById('fxActiveCount');
    if (count) { count.hidden = !active.length; count.textContent = `${active.length} active`; }

    const scope = document.getElementById('exScope');
    if (scope) {
        const moduleLabel = document.querySelector('#moduleSelectorWrap [data-cs-value]')?.textContent.trim();
        const parts = active.map(a => a.text);
        scope.textContent = [moduleLabel && moduleLabel !== '—' ? moduleLabel : '', parts.length ? parts.join(' · ') : 'All data']
            .filter(Boolean).join(' — ');
    }

    // Executive Report only exists for F200-KD2 — hide it in other modules
    const execItem = document.getElementById('btnExecReport')?.closest('.filter-item');
    const moduleId = window.PPMSModuleRuntime?.getActiveModule?.();
    if (execItem && moduleId) execItem.style.display = moduleId === 'kd2' ? '' : 'none';

    const tf = document.getElementById('filterTimeFrame')?.value || 'all';
    document.querySelectorAll('#fxTimeSeg .fx-seg-btn').forEach(b => {
        const on = b.dataset.tf === tf;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
    });
}

function clearFilter(key) {
    if (key === '__search') {
        const s = document.getElementById('filterSearch');
        if (s) { s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); }
    } else if (key === '__time') {
        const sel = document.getElementById('filterTimeFrame');
        if (sel) { sel.value = 'all'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    } else {
        const g = globals();
        const menu = g && document.getElementById(g.cfg[key]?.menu);
        const all = menu?.querySelector('input[data-value="all"]');
        if (all) { all.checked = true; all.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    refreshFilterUI();
}

export function wireFilterUI() {
    const sel = document.getElementById('filterTimeFrame');
    document.getElementById('fxTimeSeg')?.addEventListener('click', e => {
        const b = e.target.closest('[data-tf]');
        if (!b || !sel || sel.value === b.dataset.tf) return;
        sel.value = b.dataset.tf;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        refreshFilterUI();
    });
    sel?.addEventListener('change', refreshFilterUI);
    ['filterStartDate', 'filterEndDate'].forEach(id => document.getElementById(id)?.addEventListener('change', refreshFilterUI));
    document.getElementById('filterSearch')?.addEventListener('input', refreshFilterUI);
    document.getElementById('fxChips')?.addEventListener('click', e => {
        const c = e.target.closest('[data-fx-clear]');
        if (c) clearFilter(c.dataset.fxClear);
    });
    // Reset in app.js rewrites every filter — re-sync afterwards
    document.getElementById('btnReset')?.addEventListener('click', () => setTimeout(refreshFilterUI, 0));
    window.PPMSFilterUI = { refresh: refreshFilterUI, active: activeFilters };
    refreshFilterUI();
}

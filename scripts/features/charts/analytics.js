'use strict';
/* ================================================================
   MANUFACTURING ANALYTICS — per-chart selectors, one-line insights
   and the trend / unit charts:
     Weekly Throughput · Unit Progress Ranking ·
     Planned vs Expected Finish · Issues Trend
   Classic script loaded after app.js — uses its globals
   (calculateStatus, delayDays, _addWorkingDays, themeChartColors, …).
   Every chart follows the filter bar except Issues Trend, which is
   module-wide (issues aren't tied to a battalion or unit).
   ================================================================ */

const AN_OPTS_KEY = 'ppms_analytics_opts';
const AN_TOP_N = 15;
const AN_DEFAULTS = {
    cumRange: 'all',       // all | 26 | 12 (weeks back from today)
    tpRange: '12',         // 12 | 26 | all
    statusGroup: 'auto',   // auto | battalion | vehicle | unit
    rankGroup: 'unit',     // unit | battalion | vehicle
    rankShow: 'behind',    // behind | lowest | highest | all
    finishGroup: 'unit',   // unit | battalion
    finishShow: 'late',    // late | next | all
    bnVehicle: 'all',      // all | K9 | K10 | K11
    bnMetric: 'max',       // max | avg | count
    issRange: '12',        // 12 | 26 | all
    issView: 'trend',      // trend | category
};

const _an = {
    opts: _anLoadOpts(),
    data: [],
    charts: {},
    issues: null,
    issuesModule: null,
    issuesAt: 0,
    issuesLoading: false,
};

function _anLoadOpts() {
    try { return { ...AN_DEFAULTS, ...JSON.parse(localStorage.getItem(AN_OPTS_KEY) || '{}') }; }
    catch { return { ...AN_DEFAULTS }; }
}
function _anSaveOpts() { try { localStorage.setItem(AN_OPTS_KEY, JSON.stringify(_an.opts)); } catch {} }
function anOpt(key) { return _an.opts[key] ?? AN_DEFAULTS[key]; }

/* ── Small helpers ─────────────────────────────────────────────── */
const _anIsF100Row = r => r.module === 'gun' || r.module === 'vehicle';
const _anFmt = n => Number(n).toLocaleString('en-GB');
const _anNoun = () => (isKD2Module() ? 'blocks' : 'tasks');
/** A noun ("blocks", "units" …) in the user's language. */
const _anN = noun => _t(noun);

function _anIsDone(r) {
    const s = calculateStatus(r);
    return s === 'Completed' || s === 'Late Completion';
}
function _anPlanEnd(r) { return (_anIsF100Row(r) ? r.planned_end_date : r.end_date) || null; }
/** Completion date of a finished row (planned end if the date is missing). */
function _anDoneDate(r) {
    if (!_anIsDone(r)) return null;
    return (_anIsF100Row(r) ? r.actual_end_date : r.progress?.completion_date) || _anPlanEnd(r);
}
/** Work weeks run Saturday → Thursday (Friday off). */
function _anWeekStart(iso) {
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 1) % 7));
    return localDateStr(d);
}
function _anAddDays(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return localDateStr(d);
}
function _anWeeks(from, to) {
    const out = [];
    for (let w = _anWeekStart(from); w <= to; w = _anAddDays(w, 7)) out.push(w);
    return out;
}
const _anDay = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / 864e5);
const _anIso = day => new Date(day * 864e5).toISOString().slice(0, 10);
const _anLocalDay = ts => (ts ? localDateStr(new Date(ts)) : null);
const _anRound = v => Math.round(v * 10) / 10;

function _anPalette() {
    const css = getComputedStyle(document.documentElement);
    const v = (n, f) => css.getPropertyValue(n).trim() || f;
    return {
        planned: v('--clr-planned', '#3b82f6'),
        completed: v('--clr-completed', '#22c55e'),
        late: v('--clr-late', '#f97316'),
        overdue: v('--clr-overdue', '#ef4444'),
        progress: '#f59e0b',
        muted: v('--clr-text-dim', '#64748b'),
        text: v('--clr-text', '#e2e8f4'),
    };
}
function _anAlpha(color, a) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || '').trim());
    if (!m) return color;
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Shared compact Chart.js options in the active theme. */
function _anOptions(extra = {}) {
    const c = themeChartColors();
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: 'index', intersect: false },
        ...extra,
        plugins: {
            legend: {
                position: 'bottom',
                labels: { color: c.text, font: { family: 'Inter', size: 10 }, boxWidth: 8, boxHeight: 8, padding: 10, usePointStyle: true, sort: (a, b) => a.datasetIndex - b.datasetIndex },
            },
            tooltip: {
                backgroundColor: c.tooltipBg, borderColor: c.tooltipBdr, borderWidth: 1,
                titleColor: c.tooltipTtl, bodyColor: c.tooltipBdy, footerColor: c.tooltipTtl, padding: 9,
                titleFont: { family: 'Inter', size: 11, weight: '600' },
                bodyFont: { family: 'Inter', size: 11 },
                footerFont: { family: 'Inter', size: 11, weight: '600' },
            },
            ...(extra.plugins || {}),
        },
    };
}
function _anAxis(extra = {}) {
    const c = themeChartColors();
    const { ticks, title, ...rest } = extra;
    return {
        ticks: { color: c.text, font: { family: 'Inter', size: 10 }, ...(ticks || {}) },
        grid: { color: c.grid },
        border: { display: false },
        ...(title ? { title: { display: true, text: title, color: c.axisLabel, font: { family: 'Inter', size: 10 } } } : {}),
        ...rest,
    };
}

/* Dashed "today" / "this week" marker on the x-axis. Options:
   plugins.anMarker = { value, label } — value in x-scale units. */
const _anMarkerPlugin = {
    id: 'anMarker',
    afterDatasetsDraw(chart, _args, opts) {
        if (!opts || opts.value == null) return;
        const sc = chart.scales.x;
        const area = chart.chartArea;
        const x = sc.getPixelForValue(opts.value);
        if (!Number.isFinite(x) || x < area.left - 1 || x > area.right + 1) return;
        const { ctx } = chart;
        const color = themeChartColors().text;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.bottom);
        ctx.stroke();
        if (opts.label) {
            ctx.setLineDash([]);
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = color;
            ctx.font = '600 9px Inter, sans-serif';
            ctx.textAlign = x > area.right - 40 ? 'right' : 'left';
            ctx.fillText(opts.label, x + (ctx.textAlign === 'right' ? -4 : 4), area.top + 9);
        }
        ctx.restore();
    },
};

function _anMake(key, canvasId, cfg) {
    if (_an.charts[key]) { try { _an.charts[key].destroy(); } catch {} _an.charts[key] = null; }
    const canvas = document.getElementById(canvasId);
    if (!canvas || !cfg || typeof Chart === 'undefined') return null;
    _an.charts[key] = new Chart(canvas, cfg);
    return _an.charts[key];
}
function _anClear(key) {
    if (_an.charts[key]) { try { _an.charts[key].destroy(); } catch {} _an.charts[key] = null; }
}
/** All analytics chart instances — resized together with the core charts. */
function anChartInstances() { return Object.values(_an.charts).filter(Boolean); }

/** One-line, data-derived insight under a chart header. tone: good | warn | bad | neutral */
function anSetInsight(id, text, tone = 'neutral') {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = !text;
    el.dataset.tone = tone;
    el.title = text || '';
    const t = el.querySelector('.chart-insight-text');
    if (t) t.textContent = text || '';
}
function _anText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

/* ── Grouping rows into units / battalions / vehicle types ─────── */
function _anUnitOf(r) {
    if (!isKD2Module()) {
        const v = r.vehicle || 'Unknown';
        return { key: v, label: v, bn: '', vt: _getVehicleType(v) || '' };
    }
    const vt = _getVehicleType(r.vehicle || r.vehicle_type) || r.vehicle_type || '';
    const bn = r.battalion_code || '';
    const no = r.vehicle_no || r.unit_label || '—';
    return { key: `${bn}|${vt}|${no}`, label: [bn, no].filter(Boolean).join(' '), bn, vt };
}
function _anGroupRows(data, dim) {
    const map = new Map();
    const vtypes = new Set();
    data.forEach(r => {
        const u = _anUnitOf(r);
        vtypes.add(u.vt);
        let key = u.key, label = u.label;
        if (dim === 'battalion' && isKD2Module()) key = label = u.bn || 'Unknown';
        else if (dim === 'vehicle') key = label = u.vt || 'Unknown';
        if (!map.has(key)) map.set(key, { key, label, vt: u.vt, rows: [] });
        map.get(key).rows.push(r);
    });
    const groups = [...map.values()];
    if (dim === 'unit' && vtypes.size > 1 && isKD2Module()) groups.forEach(g => { if (g.vt) g.label += ` · ${g.vt}`; });
    return groups;
}
function _anPlural(dim) {
    return { unit: 'units', battalion: 'battalions', vehicle: 'vehicle types' }[dim] || 'groups';
}
/** "12 of 40 units" / "all 40 units" */
function _anCountOf(shown, total, plural) {
    return shown < total
        ? _t('{n} of {total} {noun}', { n: shown, total, noun: _anN(plural) })
        : _t('all {total} {noun}', { total, noun: _anN(plural) });
}
function _anGroupStats(g, today) {
    // Expected finish = the latest process-order forecast finish of the
    // group's blocks (same engine as the delivery card — planForecast).
    const fc = typeof getPlanForecast === 'function' ? getPlanForecast(_an.data) : null;
    let done = 0, due = 0, planned = null, projected = null;
    g.rows.forEach(r => {
        const end = _anPlanEnd(r);
        if (_anIsDone(r)) done++;
        if (end && end <= today) due++;
        if (end && (!planned || end > planned)) planned = end;
        const step = fc?.byRowId.get(String(r.id));
        if (step && (!projected || step.projEnd > projected)) projected = step.projEnd;
    });
    let worst, expected;
    if (projected && planned) {
        const slip = _fcSlip(planned, projected);
        worst = Math.max(0, slip);
        expected = slip > 0 ? projected : planned;
    } else {
        worst = g.rows.reduce((m, r) => Math.max(m, delayDays(r) || 0), 0);
        expected = planned ? _addWorkingDays(planned, worst) : null;
    }
    const total = g.rows.length;
    const pct = total ? done / total * 100 : 0;
    const exp = total ? due / total * 100 : 0;
    return { ...g, total, done, due, pct, exp, gap: pct - exp, planned, worst, expected };
}

/** Status Breakdown "Group by" override (null = automatic). */
function anStatusGrouping(data) {
    const g = anOpt('statusGroup');
    if (g === 'auto' || !isKD2Module()) return null;
    const groups = _anGroupRows(data, g);
    const labelOf = new Map(groups.map(x => [x.key, x.label]));
    const keyOf = r => {
        const u = _anUnitOf(r);
        return g === 'battalion' ? (u.bn || 'Unknown') : g === 'vehicle' ? (u.vt || 'Unknown') : u.key;
    };
    return {
        keyLabel: g,
        labels: groups.map(x => x.label).sort(naturalSort),
        valueFor: r => labelOf.get(keyOf(r)),
    };
}

/* ── Controls ──────────────────────────────────────────────────── */
function _anSyncControls(data) {
    const kd2 = isKD2Module();
    const vtypes = new Set((data || []).map(r => _getVehicleType(r.vehicle || r.vehicle_type)).filter(Boolean));
    document.querySelectorAll('#chartsSection .an-seg').forEach(seg => {
        const need = seg.dataset.anNeed;
        seg.hidden = need === 'kd2' && !kd2;
        const key = seg.dataset.anOpt;
        seg.querySelectorAll('button[data-v]').forEach(b => {
            if (b.dataset.vtype) b.hidden = !vtypes.has(b.dataset.vtype);
            b.setAttribute('aria-pressed', String(b.dataset.v === anOpt(key)));
        });
        // A saved vehicle filter that isn't in the data falls back to All
        if (key === 'bnVehicle' && anOpt(key) !== 'all' && !vtypes.has(anOpt(key))) {
            _an.opts.bnVehicle = 'all';
            seg.querySelectorAll('button[data-v]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === 'all')));
        }
    });
}

const _AN_RENDERERS = {
    cumRange: d => renderLineChart(d),
    statusGroup: d => renderBarChart(d),
    bnVehicle: d => renderKD2BottleneckChart(d),
    bnMetric: d => renderKD2BottleneckChart(d),
    tpRange: d => _anRenderThroughput(d),
    rankGroup: d => _anRenderRanking(d),
    rankShow: d => _anRenderRanking(d),
    finishGroup: d => _anRenderFinish(d),
    finishShow: d => _anRenderFinish(d),
    issRange: () => _anRenderIssues(),
    issView: () => _anRenderIssues(),
};

document.addEventListener('click', e => {
    const btn = e.target.closest('#chartsSection .an-seg button[data-v]');
    if (!btn) return;
    const key = btn.closest('.an-seg').dataset.anOpt;
    if (!key || anOpt(key) === btn.dataset.v) return;
    _an.opts[key] = btn.dataset.v;
    _anSaveOpts();
    _anSyncControls(_an.data);
    try { _AN_RENDERERS[key]?.(_an.data); } catch (err) { console.error('[analytics]', err); }
});

/* ── Entry point (called from renderCharts) ────────────────────── */
function renderAnalyticsCharts(data) {
    _an.data = data || [];
    _anSyncControls(_an.data);
    [_anRenderThroughput, _anRenderRanking, _anRenderFinish].forEach(fn => {
        try { fn(_an.data); } catch (err) { console.error('[analytics]', err); }
    });
    // Issues Trend takes the full row when the Station Bottleneck card is hidden (KD1)
    const bn = document.getElementById('kd2BottleneckCard');
    document.getElementById('anIssuesCard')?.classList.toggle('an-span-12', !!bn && bn.style.display === 'none');
    _anRenderIssues();
    _anEnsureIssues();
}

/* ── 1. Weekly Throughput ──────────────────────────────────────── */
function _anRenderThroughput(data) {
    const noun = _anNoun();
    const today = todayStr();
    const thisWeek = _anWeekStart(today);
    const items = data.map(r => ({ end: _anPlanEnd(r), done: _anDoneDate(r) })).filter(x => x.end);
    if (!items.length) {
        _anClear('tp');
        anSetInsight('anTpInsight', _t('No {noun} in the current filter.', { noun: _anN(noun) }));
        return;
    }

    const ends = items.map(x => x.end).sort();
    const dones = items.map(x => x.done).filter(Boolean).sort();
    const first = [ends[0], dones[0]].filter(Boolean).sort()[0];
    const last = [ends[ends.length - 1], dones[dones.length - 1]].filter(Boolean).sort().pop();
    let from = _anWeekStart(first), to = _anWeekStart(last);
    const range = anOpt('tpRange');
    if (range !== 'all') {
        const winFrom = _anAddDays(thisWeek, -7 * (Number(range) - 1));
        const winTo = _anAddDays(thisWeek, 28); // 4 weeks of upcoming load
        if (winFrom > from) from = winFrom;
        if (winTo < to) to = winTo;
        if (from > to) { from = winFrom; to = thisWeek; }
    }
    const weeks = _anWeeks(from, to);

    const planned = new Map(), done = new Map();
    items.forEach(x => {
        const pw = _anWeekStart(x.end);
        planned.set(pw, (planned.get(pw) || 0) + 1);
        if (x.done) { const dw = _anWeekStart(x.done); done.set(dw, (done.get(dw) || 0) + 1); }
    });
    // Overdue backlog: due before the date and not finished by it
    const backlogAt = iso => items.reduce((n, x) => n + (x.end < iso && !(x.done && x.done <= iso) ? 1 : 0), 0);
    const backlog = weeks.map(w => (w > thisWeek ? null : backlogAt(w === thisWeek ? today : _anAddDays(w, 6))));

    const p = _anPalette();
    const future = weeks.map(w => w > thisWeek);
    const markerIdx = weeks.indexOf(thisWeek);
    _anMake('tp', 'anTpChart', {
        type: 'bar',
        data: {
            labels: weeks.map(w => formatDateShort(w)),
            datasets: [
                {
                    label: 'Planned', data: weeks.map(w => planned.get(w) || 0), order: 2,
                    backgroundColor: future.map(f => _anAlpha(p.planned, f ? 0.16 : 0.32)),
                    borderColor: _anAlpha(p.planned, 0.9), borderWidth: 1, borderRadius: 3, maxBarThickness: 18,
                },
                {
                    label: 'Completed', data: weeks.map((w, i) => (future[i] ? null : done.get(w) || 0)), order: 2,
                    backgroundColor: _anAlpha(p.completed, 0.82), borderRadius: 3, maxBarThickness: 18,
                },
                {
                    type: 'line', label: 'Overdue backlog', data: backlog, yAxisID: 'y1', order: 1,
                    borderColor: p.overdue, backgroundColor: p.overdue, borderWidth: 2, cubicInterpolationMode: 'monotone',
                    pointRadius: weeks.length > 30 ? 0 : 2, pointHoverRadius: 4, spanGaps: false,
                },
            ],
        },
        options: _anOptions({
            scales: {
                x: _anAxis({ grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }),
                y: _anAxis({ beginAtZero: true, title: _t(noun === 'blocks' ? 'Blocks / week' : 'Tasks / week'), ticks: { precision: 0 } }),
                y1: _anAxis({ beginAtZero: true, position: 'right', grid: { display: false }, title: _t('Backlog'), ticks: { precision: 0 } }),
            },
            plugins: {
                anMarker: { value: markerIdx >= 0 ? markerIdx : null, label: _t('This week') },
                tooltip: {
                    callbacks: {
                        title: ctx => _t(future[ctx[0].dataIndex] ? 'Week of {date} (upcoming)' : 'Week of {date}', { date: formatDate(weeks[ctx[0].dataIndex]) }),
                    },
                },
            },
        }),
        plugins: [_anMarkerPlugin],
    });

    // Insight: last 4 complete weeks, independent of the zoom range
    const recent = [1, 2, 3, 4].map(i => _anAddDays(thisWeek, -7 * i));
    const pSum = recent.reduce((s, w) => s + (planned.get(w) || 0), 0);
    const dSum = recent.reduce((s, w) => s + (done.get(w) || 0), 0);
    const bNow = backlogAt(today);
    const bThen = backlogAt(_anAddDays(recent[3], -1));
    const trend = bNow === bThen ? _t('overdue backlog steady at {n}', { n: _anFmt(bNow) })
        : _t(bNow > bThen ? 'overdue backlog up {d} to {n}' : 'overdue backlog down {d} to {n}', { d: _anFmt(Math.abs(bNow - bThen)), n: _anFmt(bNow) });
    let text, tone;
    if (!pSum && !dSum) {
        text = _t('Nothing was planned or completed in the last 4 weeks · {trend}.', { trend });
        tone = bNow ? 'warn' : 'neutral';
    } else {
        const rate = pSum ? Math.round(dSum / pSum * 100) : 100;
        text = _t('Last 4 weeks: {done} {noun} completed vs {planned} planned ({rate}%) · {trend}.', { done: _anFmt(dSum), noun: _anN(noun), planned: _anFmt(pSum), rate, trend });
        tone = bNow > bThen ? 'bad' : dSum < pSum ? 'warn' : 'good';
    }
    anSetInsight('anTpInsight', text, tone);
}

/* ── 2. Unit Progress Ranking ──────────────────────────────────── */
function _anRenderRanking(data) {
    const dim = isKD2Module() ? anOpt('rankGroup') : 'unit';
    const plural = _anPlural(dim);
    const today = todayStr();
    const all = _anGroupRows(data, dim).map(g => _anGroupStats(g, today));
    if (!all.length) {
        _anClear('rank');
        _anText('anRankSub', _t('% complete vs expected by today'));
        anSetInsight('anRankInsight', _t('No {noun} in the current filter.', { noun: _anN(plural) }));
        return;
    }
    const show = anOpt('rankShow');
    let rows = [...all];
    if (show === 'behind') rows.sort((a, b) => a.gap - b.gap || a.pct - b.pct);
    else if (show === 'lowest') rows.sort((a, b) => a.pct - b.pct || a.gap - b.gap);
    else if (show === 'highest') rows.sort((a, b) => b.pct - a.pct || b.gap - a.gap);
    else rows.sort((a, b) => naturalSort(a.label, b.label));
    if (show !== 'all') rows = rows.slice(0, AN_TOP_N);

    _anText('anRankSub', _t('% complete vs expected by today') + ' · ' + _anCountOf(rows.length, all.length, plural));

    const p = _anPalette();
    const colorOf = s => (s.pct >= 99.95 || s.gap >= -2) ? (s.exp === 0 && s.pct === 0 ? p.planned : p.completed)
        : s.gap >= -15 ? p.late : p.overdue;
    _anMake('rank', 'anRankChart', {
        type: 'bar',
        data: {
            labels: rows.map(s => s.label),
            datasets: [
                {
                    label: _t('% complete'), data: rows.map(s => _anRound(s.pct)), order: 2,
                    backgroundColor: rows.map(s => _anAlpha(colorOf(s), 0.8)), borderRadius: 3, maxBarThickness: 26,
                },
                {
                    type: 'line', label: _t('Expected by today'), data: rows.map(s => _anRound(s.exp)), order: 1,
                    showLine: false, pointStyle: 'line', pointRadius: 9, pointHoverRadius: 10,
                    pointBorderWidth: 2.5, borderColor: p.text, backgroundColor: p.text,
                },
            ],
        },
        options: _anOptions({
            scales: {
                x: _anAxis({ grid: { display: false }, ticks: { autoSkip: rows.length > 24, maxRotation: 55, minRotation: 0, font: { family: 'Inter', size: 9 } } }),
                y: _anAxis({ min: 0, max: 100, ticks: { stepSize: 25, callback: v => v + '%' } }),
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const s = rows[ctx.dataIndex];
                            return ' ' + (ctx.datasetIndex === 0
                                ? _t('Complete: {pct}% ({done} of {total})', { pct: _anRound(s.pct), done: _anFmt(s.done), total: _anFmt(s.total) })
                                : _t('Expected by today: {pct}%', { pct: _anRound(s.exp) }));
                        },
                        footer: ctx => {
                            const s = rows[ctx[0].dataIndex];
                            const g = Math.round(s.gap);
                            return g < 0 ? _t('{n} pts behind schedule', { n: -g }) : g > 0 ? _t('{n} pts ahead of schedule', { n: g }) : _t('On schedule');
                        },
                    },
                },
            },
        }),
    });

    const behind = all.filter(s => s.gap < -2);
    if (!behind.length) {
        const avg = Math.round(all.reduce((s, x) => s + x.pct, 0) / all.length);
        anSetInsight('anRankInsight', _t('All {n} {noun} are on or ahead of schedule — {avg}% complete on average.', { n: all.length, noun: _anN(plural), avg }), 'good');
    } else {
        const w = behind.reduce((a, b) => (b.gap < a.gap ? b : a));
        anSetInsight('anRankInsight',
            _t('{n} of {total} {noun} are behind schedule; furthest behind: {name} — {pct}% done vs {exp}% expected.', { n: behind.length, total: all.length, noun: _anN(plural), name: w.label, pct: Math.round(w.pct), exp: Math.round(w.exp) }),
            behind.length / all.length > 0.3 ? 'bad' : 'warn');
    }
}

/* ── 3. Planned vs Expected Finish ─────────────────────────────── */
function _anRenderFinish(data) {
    const dim = isKD2Module() ? anOpt('finishGroup') : 'unit';
    const plural = _anPlural(dim);
    const today = todayStr();
    const all = _anGroupRows(data, dim).map(g => _anGroupStats(g, today)).filter(s => s.planned);
    if (!all.length) {
        _anClear('finish');
        _anText('anFinishSub', _t('Planned finish → expected finish'));
        anSetInsight('anFinishInsight', _t('No {noun} in the current filter.', { noun: _anN(plural) }));
        return;
    }
    const show = anOpt('finishShow');
    let rows;
    if (show === 'late') rows = [...all].sort((a, b) => b.worst - a.worst || a.planned.localeCompare(b.planned)).slice(0, AN_TOP_N);
    else if (show === 'next') rows = all.filter(s => s.done < s.total).sort((a, b) => a.planned.localeCompare(b.planned)).slice(0, AN_TOP_N);
    else rows = [...all].sort((a, b) => a.planned.localeCompare(b.planned) || naturalSort(a.label, b.label));
    if (!rows.length) rows = [...all].sort((a, b) => a.planned.localeCompare(b.planned)).slice(0, AN_TOP_N);

    _anText('anFinishSub', _t('Planned finish → forecast finish (process order, working days)') + ' · ' + _anCountOf(rows.length, all.length, plural));

    const p = _anPalette();
    const days = rows.flatMap(s => [_anDay(s.planned), _anDay(s.expected)]).concat(_anDay(today));
    const min = Math.min(...days) - 4, max = Math.max(...days) + 4;
    const labels = rows.map(s => s.label);
    _anMake('finish', 'anFinishChart', {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: _t('Delay'), order: 3,
                    data: rows.map(s => (s.worst > 0 ? [_anDay(s.planned), _anDay(s.expected)] : null)),
                    backgroundColor: _anAlpha(p.overdue, 0.28), borderColor: _anAlpha(p.overdue, 0.7),
                    borderWidth: 1, borderSkipped: false, borderRadius: 3, maxBarThickness: 12,
                },
                {
                    type: 'line', label: _t('Planned finish'), order: 2, showLine: false,
                    data: rows.map(s => ({ x: _anDay(s.planned), y: s.label })),
                    pointStyle: 'circle', pointRadius: 4, pointHoverRadius: 5,
                    backgroundColor: p.planned, borderColor: p.planned,
                },
                {
                    type: 'line', label: _t('Expected finish'), order: 1, showLine: false,
                    data: rows.map(s => ({ x: _anDay(s.expected), y: s.label })),
                    pointStyle: 'rectRot', pointRadius: 5, pointHoverRadius: 6,
                    backgroundColor: rows.map(s => (s.worst > 0 ? p.overdue : p.completed)),
                    borderColor: rows.map(s => (s.worst > 0 ? p.overdue : p.completed)),
                },
            ],
        },
        options: _anOptions({
            indexAxis: 'y',
            interaction: { mode: 'index', axis: 'y', intersect: false },
            scales: {
                x: _anAxis({ type: 'linear', min, max, ticks: { maxTicksLimit: 7, callback: v => formatDateShort(_anIso(v)) } }),
                y: _anAxis({ type: 'category', labels, grid: { display: false }, ticks: { autoSkip: rows.length > 24, font: { family: 'Inter', size: 9 } } }),
            },
            plugins: {
                anMarker: { value: _anDay(today), label: _t('Today') },
                tooltip: {
                    filter: item => item.datasetIndex !== 0,
                    callbacks: {
                        label: ctx => {
                            const s = rows[ctx.dataIndex];
                            return ' ' + (ctx.datasetIndex === 1 ? _t('Planned finish: {date}', { date: formatDate(s.planned) }) : _t('Expected finish: {date}', { date: formatDate(s.expected) }));
                        },
                        footer: ctx => {
                            const s = rows[ctx[0].dataIndex];
                            return `${s.worst > 0 ? _t('+{n} working days late', { n: s.worst }) : _t('On time')} · ${_t('{pct}% complete', { pct: Math.round(s.pct) })}`;
                        },
                    },
                },
            },
        }),
        plugins: [_anMarkerPlugin],
    });

    const late = all.filter(s => s.worst > 0);
    if (!late.length) {
        const lastPlanned = all.reduce((m, s) => (s.planned > m ? s.planned : m), all[0].planned);
        anSetInsight('anFinishInsight', _t('All {n} {noun} are forecast to finish on their planned date — last planned finish {date}.', { n: all.length, noun: _anN(plural), date: formatDate(lastPlanned) }), 'good');
    } else {
        const w = late.reduce((a, b) => (b.worst > a.worst ? b : a));
        anSetInsight('anFinishInsight',
            _t('{n} of {total} {noun} forecast to finish late; worst: {name}, +{days} working days ({from} → {to}).', { n: late.length, total: all.length, noun: _anN(plural), name: w.label, days: w.worst, from: formatDateShort(w.planned), to: formatDateShort(w.expected) }),
            late.length / all.length > 0.3 ? 'bad' : 'warn');
    }
}

/* ── 4. Issues Trend (module-wide) ─────────────────────────────── */
/** Fed by loadIssuesOverview() (same query) or by _anEnsureIssues(). */
function anSetIssues(rows, moduleId) {
    _an.issues = rows || [];
    _an.issuesModule = moduleId || getActiveModuleId();
    _an.issuesAt = Date.now();
    _anRenderIssues();
}

async function _anEnsureIssues() {
    const mod = getActiveModuleId();
    if (_an.issuesLoading || typeof db === 'undefined' || !db) return;
    if (_an.issues && _an.issuesModule === mod && Date.now() - _an.issuesAt < 5 * 60e3) return;
    _an.issuesLoading = true;
    try {
        const { data, error } = await _selectAllPages(db
            .from('production_issues')
            .select('status, priority, category, created_at, resolved_at')
            .eq('module', mod)
            .order('id'));
        if (!error && getActiveModuleId() === mod) anSetIssues(data, mod);
    } catch (err) {
        console.warn('[analytics] issues', err);
    } finally {
        _an.issuesLoading = false;
    }
}

function _anRenderIssues() {
    if (!document.getElementById('anIssuesCard')) return;
    const issues = _an.issuesModule === getActiveModuleId() ? _an.issues : null;
    if (!issues) {
        _anClear('iss');
        anSetInsight('anIssInsight', _t('Loading issues…'));
        return;
    }
    if (!issues.length) {
        _anClear('iss');
        anSetInsight('anIssInsight', _t('No production issues have been reported in this module yet.'), 'good');
        return;
    }

    const doneStatuses = typeof ISSUE_DONE_STATUSES !== 'undefined' ? ISSUE_DONE_STATUSES : ['resolved', 'closed'];
    const catLabel = c => _t((typeof ISSUE_CATEGORY_LABELS !== 'undefined' && ISSUE_CATEGORY_LABELS[c]) || c || 'Uncategorised');
    const today = todayStr();
    const thisWeek = _anWeekStart(today);
    const list = issues.map(i => {
        const opened = _anLocalDay(i.created_at) || today;
        const isDone = doneStatuses.includes(i.status);
        return {
            cat: catLabel(i.category), opened, isDone,
            closed: isDone ? (_anLocalDay(i.resolved_at) || opened) : null,
            hours: isDone && i.resolved_at && i.created_at ? (new Date(i.resolved_at) - new Date(i.created_at)) / 36e5 : null,
        };
    });
    const range = anOpt('issRange');
    const firstWeek = _anWeekStart(list.reduce((m, x) => (x.opened < m ? x.opened : m), today));
    const from = range === 'all' ? firstWeek : _anAddDays(thisWeek, -7 * (Number(range) - 1));
    const weeks = _anWeeks(from, thisWeek);
    const inRange = d => d && d >= from;
    const p = _anPalette();

    if (anOpt('issView') === 'category') {
        const cats = new Map();
        list.forEach(x => {
            if (!inRange(x.opened) && x.isDone) return; // still-open older issues stay visible
            if (!cats.has(x.cat)) cats.set(x.cat, { open: 0, done: 0 });
            cats.get(x.cat)[x.isDone ? 'done' : 'open']++;
        });
        const rows = [...cats.entries()].sort((a, b) => b[1].open - a[1].open || (b[1].open + b[1].done) - (a[1].open + a[1].done));
        _anMake('iss', 'anIssChart', {
            type: 'bar',
            data: {
                labels: rows.map(r => r[0]),
                datasets: [
                    { label: _t('Open'), data: rows.map(r => r[1].open), backgroundColor: _anAlpha(p.late, 0.85), borderRadius: 3, maxBarThickness: 16 },
                    { label: _t('Resolved'), data: rows.map(r => r[1].done), backgroundColor: _anAlpha(p.completed, 0.75), borderRadius: 3, maxBarThickness: 16 },
                ],
            },
            options: _anOptions({
                indexAxis: 'y',
                interaction: { mode: 'index', axis: 'y', intersect: false },
                scales: {
                    x: _anAxis({ stacked: true, beginAtZero: true, ticks: { precision: 0 } }),
                    y: _anAxis({ stacked: true, grid: { display: false } }),
                },
            }),
        });
    } else {
        const opened = new Map(), closed = new Map();
        list.forEach(x => {
            const ow = _anWeekStart(x.opened);
            opened.set(ow, (opened.get(ow) || 0) + 1);
            if (x.closed) { const cw = _anWeekStart(x.closed); closed.set(cw, (closed.get(cw) || 0) + 1); }
        });
        const openAt = iso => list.reduce((n, x) => n + (x.opened <= iso && !(x.closed && x.closed <= iso) ? 1 : 0), 0);
        _anMake('iss', 'anIssChart', {
            type: 'bar',
            data: {
                labels: weeks.map(w => formatDateShort(w)),
                datasets: [
                    { label: _t('Opened'), data: weeks.map(w => opened.get(w) || 0), order: 2, backgroundColor: _anAlpha(p.late, 0.8), borderRadius: 3, maxBarThickness: 16 },
                    { label: _t('Resolved'), data: weeks.map(w => closed.get(w) || 0), order: 2, backgroundColor: _anAlpha(p.completed, 0.75), borderRadius: 3, maxBarThickness: 16 },
                    {
                        type: 'line', label: _t('Open at week end'), yAxisID: 'y1', order: 1,
                        data: weeks.map(w => openAt(w === thisWeek ? today : _anAddDays(w, 6))),
                        borderColor: p.overdue, backgroundColor: p.overdue, borderWidth: 2, cubicInterpolationMode: 'monotone',
                        pointRadius: weeks.length > 30 ? 0 : 2, pointHoverRadius: 4,
                    },
                ],
            },
            options: _anOptions({
                scales: {
                    x: _anAxis({ grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }),
                    y: _anAxis({ beginAtZero: true, title: _t('Issues / week'), ticks: { precision: 0 } }),
                    y1: _anAxis({ beginAtZero: true, position: 'right', grid: { display: false }, title: _t('Open'), ticks: { precision: 0 } }),
                },
                plugins: {
                    tooltip: { callbacks: { title: ctx => _t('Week of {date}', { date: formatDate(weeks[ctx[0].dataIndex]) }) } },
                },
            }),
        });
    }

    // Insight: open now, flow in the period, time to resolve, top open category
    const openNow = list.filter(x => !x.isDone);
    const openedR = list.filter(x => inRange(x.opened)).length;
    const closedR = list.filter(x => inRange(x.closed)).length;
    const times = list.filter(x => inRange(x.closed) && x.hours != null).map(x => x.hours);
    const avgH = times.length ? times.reduce((s, h) => s + h, 0) / times.length : null;
    const avgTxt = avgH == null ? '' : ' · ' + (avgH < 48 ? _t('avg {n} h to resolve', { n: Math.max(1, Math.round(avgH)) }) : _t('avg {n} days to resolve', { n: _anRound(avgH / 24) }));
    const catCount = new Map();
    openNow.forEach(x => catCount.set(x.cat, (catCount.get(x.cat) || 0) + 1));
    const topCat = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0];
    const flow = range === 'all'
        ? _t('{opened} opened vs {closed} resolved overall', { opened: openedR, closed: closedR })
        : _t('{opened} opened vs {closed} resolved in {weeks} weeks', { opened: openedR, closed: closedR, weeks: range });
    const text = _t('{n} open now', { n: openNow.length }) + ' · ' + flow + avgTxt
        + (topCat ? ' · ' + _t('most open: {cat} ({n})', { cat: topCat[0], n: topCat[1] }) : '') + '.';
    anSetInsight('anIssInsight', text, !openNow.length ? 'good' : openedR > closedR ? 'warn' : 'neutral');
}

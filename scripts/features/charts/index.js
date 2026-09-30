const _expandIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;

const _insightIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"/></svg>`;

/** Segmented selector — each button sets analytics option `opt` (see analytics.js). */
function seg(opt, items, need = '') {
    return `<div class="an-seg" role="group" data-an-opt="${opt}"${need ? ` data-an-need="${need}"` : ''}>${items.map(([v, label, title, vtype]) =>
        `<button type="button" data-v="${v}"${title ? ` title="${title}"` : ''}${vtype ? ` data-vtype="${vtype}"` : ''} aria-pressed="false">${label}</button>`).join('')}</div>`;
}

function card({ id, span, hidden, title, titleId, sub, subId, controls, insightId, canvasId }) {
    return `
                <div class="chart-card an-card ${span}"${id ? ` id="${id}"` : ''}${hidden ? ' style="display:none"' : ''}>
                    <div class="chart-card-header an-head">
                        <div class="an-head-text">
                            <h3 class="chart-title"${titleId ? ` id="${titleId}"` : ''}>${title}</h3>
                            <span class="chart-subtitle"${subId ? ` id="${subId}"` : ''}>${sub}</span>
                        </div>
                        <div class="an-controls">${controls || ''}</div>
                        <button class="chart-expand-btn" onclick="toggleChartFullscreen(this)" aria-pressed="false" title="Expand chart">${_expandIcon}</button>
                    </div>
                    <div class="chart-insight" id="${insightId}" hidden>${_insightIcon}<span class="chart-insight-text"></span></div>
                    <div class="chart-canvas-wrap">
                        <canvas id="${canvasId}"></canvas>
                    </div>
                </div>`;
}

export function initFeature() {
    return `
        <!-- ═══════════════════════════════════════════════ CHARTS -->
        <section class="charts-section" id="chartsSection" aria-label="Charts">
            <div class="ppms-section-header">
                <h3 class="ppms-section-heading">Manufacturing Analytics</h3>
                <span class="ppms-section-sub">Follows the filter bar · expand any chart for detail</span>
            </div>
            <div class="charts-grid an-grid">
                <div class="an-group-label">Progress over time</div>
                ${card({
                    span: 'an-span-4', title: 'Cumulative Progress', titleId: 'lineChartTitle',
                    sub: 'Planned completion vs actual', subId: 'lineChartSubtitle',
                    controls: seg('cumRange', [['12', '12 wk'], ['26', '26 wk'], ['all', 'All']]),
                    insightId: 'anCumInsight', canvasId: 'lineChart',
                })}
                ${card({
                    span: 'an-span-4', title: 'Weekly Throughput',
                    sub: 'Planned vs completed per week · overdue backlog',
                    controls: seg('tpRange', [['12', '12 wk'], ['26', '26 wk'], ['all', 'All']]),
                    insightId: 'anTpInsight', canvasId: 'anTpChart',
                })}
                ${card({
                    span: 'an-span-4 an-wrap-full', title: 'Status Breakdown', titleId: 'barChartTitle',
                    sub: 'Completed · Late · In progress · Planned · Overdue', subId: 'barChartSubtitle',
                    controls: seg('statusGroup', [['auto', 'Auto'], ['battalion', 'Battalion'], ['vehicle', 'Vehicle'], ['unit', 'Unit']], 'kd2'),
                    insightId: 'anStatusInsight', canvasId: 'barChart',
                })}

                <div class="an-group-label">Units &amp; delivery</div>
                ${card({
                    span: 'an-span-6', title: 'Unit Progress Ranking',
                    sub: '% complete vs expected by today', subId: 'anRankSub',
                    controls: seg('rankGroup', [['unit', 'Unit'], ['battalion', 'Battalion'], ['vehicle', 'Vehicle']], 'kd2')
                        + seg('rankShow', [['behind', 'Most behind', 'The 15 furthest behind where they should be today'], ['lowest', 'Lowest', 'The 15 least complete'], ['highest', 'Highest', 'The 15 most complete'], ['all', 'All']]),
                    insightId: 'anRankInsight', canvasId: 'anRankChart',
                })}
                ${card({
                    span: 'an-span-6', title: 'Planned vs Expected Finish',
                    sub: 'Planned finish → expected finish', subId: 'anFinishSub',
                    controls: seg('finishGroup', [['unit', 'Unit'], ['battalion', 'Battalion']], 'kd2')
                        + seg('finishShow', [['late', 'Most late', 'The 15 with the biggest forecast delay'], ['next', 'Next due', 'The next 15 unfinished, by planned finish'], ['all', 'All']]),
                    insightId: 'anFinishInsight', canvasId: 'anFinishChart',
                })}

                <div class="an-group-label">Bottlenecks &amp; issues</div>
                ${card({
                    id: 'kd2BottleneckCard', span: 'an-span-6', hidden: true, title: 'Station Bottleneck',
                    sub: 'Delay per station', subId: 'kd2BottleneckSubtitle',
                    controls: seg('bnVehicle', [['all', 'All'], ['K9', 'K9', '', 'K9'], ['K10', 'K10', '', 'K10'], ['K11', 'K11', '', 'K11']])
                        + seg('bnMetric', [['max', 'Max', 'Worst single delay per station'], ['avg', 'Avg', 'Average delay of the delayed tasks'], ['count', 'Count', 'Number of delayed tasks']]),
                    insightId: 'anBnInsight', canvasId: 'kd2BottleneckChart',
                })}
                ${card({
                    id: 'anIssuesCard', span: 'an-span-6', title: 'Issues Trend',
                    sub: 'Production issues · whole module (not filtered)',
                    controls: seg('issView', [['trend', 'Trend'], ['category', 'By category']])
                        + seg('issRange', [['12', '12 wk'], ['26', '26 wk'], ['all', 'All']]),
                    insightId: 'anIssInsight', canvasId: 'anIssChart',
                })}
            </div>
        </section>

        <!-- ════════════════════════════════════ F100 ANALYTICS CHARTS -->
        <section class="f100-charts-section" id="f100ChartsSection" style="display:none" aria-label="F100 Analytics">
            <div class="f100-charts-header">
                <h3 class="f100-charts-heading">Manufacturing Analytics</h3>
                <span class="f100-charts-sub">Status distribution · Process step completion · Completion by vehicle type</span>
            </div>
            <div class="f100-charts-grid">
                <div class="chart-card f100-chart-card">
                    <div class="chart-card-header">
                        <h3 class="chart-title">Status Distribution</h3>
                        <span class="chart-subtitle">Overall task status breakdown</span>
                        <button class="chart-expand-btn" onclick="toggleChartFullscreen(this)" aria-pressed="false" title="Expand chart">${_expandIcon}</button>
                    </div>
                    <div class="chart-canvas-wrap" style="height:220px">
                        <canvas id="f100ChartStatus"></canvas>
                    </div>
                </div>
                <div class="chart-card f100-chart-card f100-chart-card--wide">
                    <div class="chart-card-header">
                        <h3 class="chart-title">Process Step Completion</h3>
                        <span class="chart-subtitle">% of units that completed each manufacturing step</span>
                        <button class="chart-expand-btn" onclick="toggleChartFullscreen(this)" aria-pressed="false" title="Expand chart">${_expandIcon}</button>
                    </div>
                    <div class="chart-canvas-wrap" style="height:220px">
                        <canvas id="f100ChartStep"></canvas>
                    </div>
                </div>
                <div class="chart-card f100-chart-card">
                    <div class="chart-card-header">
                        <h3 class="chart-title">Completion by Vehicle Type</h3>
                        <span class="chart-subtitle">% complete and total tasks per vehicle type</span>
                        <button class="chart-expand-btn" onclick="toggleChartFullscreen(this)" aria-pressed="false" title="Expand chart">${_expandIcon}</button>
                    </div>
                    <div class="chart-canvas-wrap" style="height:220px">
                        <canvas id="f100ChartVtype"></canvas>
                    </div>
                </div>
            </div>
        </section>
`.trim();
}



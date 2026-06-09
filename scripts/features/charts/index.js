const _expandIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;

export function initFeature() {
    return `
        <!-- ═══════════════════════════════════════════════ CHARTS -->
        <section class="charts-section" id="chartsSection" aria-label="Charts">
            <div class="ppms-section-header">
                <h3 class="ppms-section-heading">Manufacturing Analytics</h3>
                <span class="ppms-section-sub">Status breakdown · Cumulative progress trend</span>
            </div>
            <div class="charts-grid">
                <div class="chart-card">
                    <div class="chart-card-header">
                        <h3 class="chart-title" id="barChartTitle">Status Breakdown</h3>
                        <span class="chart-subtitle" id="barChartSubtitle">Planned · Completed · Late Completion · Overdue</span>
                        <button class="chart-expand-btn" onclick="toggleChartFullscreen(this)" aria-pressed="false" title="Expand chart">${_expandIcon}</button>
                    </div>
                    <div class="chart-canvas-wrap">
                        <canvas id="barChart"></canvas>
                    </div>
                </div>
                <div class="chart-card">
                    <div class="chart-card-header">
                        <h3 class="chart-title" id="lineChartTitle">Cumulative Progress</h3>
                        <span class="chart-subtitle" id="lineChartSubtitle">Planned Completion vs Actual</span>
                        <button class="chart-expand-btn" onclick="toggleChartFullscreen(this)" aria-pressed="false" title="Expand chart">${_expandIcon}</button>
                    </div>
                    <div class="chart-canvas-wrap">
                        <canvas id="lineChart"></canvas>
                    </div>
                </div>
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



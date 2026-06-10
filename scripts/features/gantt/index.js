export function initFeature() {
    return `
        <!-- ═══════════════════════════════════════ PRODUCTION GANTT -->
        <div class="ppms-section-header">
            <h3 class="ppms-section-heading">Production Schedule</h3>
            <span class="ppms-section-sub">Timeline-based plan vs actual · hover bars for task detail</span>
        </div>
        <ppms-gantt-module id="ganttNavAnchor"></ppms-gantt-module>
`.trim();
}



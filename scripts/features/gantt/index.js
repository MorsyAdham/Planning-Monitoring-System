import { _t } from '../../core/i18n.js';

export function initFeature() {
    return `
        <!-- ═══════════════════════════════════════ PRODUCTION GANTT -->
        <div class="ppms-section-header">
            <h3 class="ppms-section-heading">${_t('Production Schedule')}</h3>
            <span class="ppms-section-sub">${_t('Timeline-based plan vs actual · hover bars for task detail')}</span>
        </div>
        <ppms-gantt-module id="ganttNavAnchor"></ppms-gantt-module>
`.trim();
}



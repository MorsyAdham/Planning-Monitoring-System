import { _t } from '../../core/i18n.js';
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

/** KPI tile (value id is written by updateSummary() in app.js). */
const tile = (cls, id, label, icon, sub = '') => `
                    <div class="summary-card ex-tile ${cls}">
                        <div class="card-icon">${svg(icon)}</div>
                        <div class="card-body">
                            <span class="card-value" id="${id}">0</span>
                            <span class="card-label">${_t(label)}</span>
                            ${sub ? `<span class="ex-tile-sub" id="${id}Sub">${_t(sub)}</span>` : ''}
                        </div>
                    </div>`;

export function initFeature() {
    return `
        <!-- ═══════════════════════════════════════════════ EXECUTIVE SUMMARY -->
        <section class="summary-section ex-summary" id="summarySection" aria-label="${_t("Executive Summary")}">
            <div class="ppms-section-header ex-head">
                <div>
                    <h3 class="ppms-section-heading">${_t("Executive Summary")}</h3>
                    <span class="ppms-section-sub">${_t("Where production stands for the current filters")}</span>
                </div>
                <div class="ex-head-right">
                    <div class="vpx-bat-picker ex-bat-picker" id="exBattalionTabs" hidden></div>
                    <span class="ex-scope" id="exScope" title="${_t("What these numbers cover")}">${_t("All data")}</span>
                </div>
            </div>

            <div class="ex-grid">
                <!-- Headline: overall progress ring + status split -->
                <article class="ex-hero">
                    <div class="ex-ring" id="exRing" style="--pct:0">
                        <svg viewBox="0 0 120 120" aria-hidden="true">
                            <circle class="ex-ring-track" cx="60" cy="60" r="52"/>
                            <circle class="ex-ring-fill" cx="60" cy="60" r="52" pathLength="100"/>
                        </svg>
                        <div class="ex-ring-text">
                            <span class="ex-ring-value" id="sumProgress">0%</span>
                            <span class="ex-ring-label">${_t("complete")}</span>
                        </div>
                    </div>
                    <div class="ex-hero-body">
                        <p class="ex-hero-line">${_t("{done} of {total} planned tasks are done", { done: '<strong id="exDoneCount">0</strong>', total: '<strong id="exTotalCount">0</strong>' })}</p>
                        <div class="ex-split" id="exSplit" role="img" aria-label="${_t("Status split")}">
                            <span class="ex-split-seg ex-c-completed" data-k="completed"></span>
                            <span class="ex-split-seg ex-c-late" data-k="late"></span>
                            <span class="ex-split-seg ex-c-progress" data-k="inprogress"></span>
                            <span class="ex-split-seg ex-c-overdue" data-k="overdue"></span>
                            <span class="ex-split-seg ex-c-planned" data-k="planned" style="flex-grow:1"></span>
                        </div>
                        <ul class="ex-legend">
                            <li><i class="ex-c-completed"></i>${_t("On time")} <b id="exLegCompleted">0</b></li>
                            <li><i class="ex-c-late"></i>${_t("Late")} <b id="exLegLate">0</b></li>
                            <li><i class="ex-c-progress"></i>${_t("In progress")} <b id="exLegProgress">0</b></li>
                            <li><i class="ex-c-overdue"></i>${_t("Overdue")} <b id="exLegOverdue">0</b></li>
                            <li><i class="ex-c-planned"></i>${_t("Not started")} <b id="exLegPlanned">0</b></li>
                        </ul>
                        <!-- kept for older callers; the ring shows progress now -->
                        <div class="progress-bar-wrap" hidden><div class="progress-bar-fill" id="progressBarFill" style="width:0%"></div></div>
                    </div>
                </article>

                <div class="summary-grid ex-tiles">
                    ${tile('card-planned', 'sumPlanned', 'Total planned', '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', 'tasks in scope')}
                    ${tile('card-completed', 'sumCompleted', 'Completed on time', '<path d="M20 6L9 17l-5-5"/>', '')}
                    ${tile('card-inprogress', 'sumInProgress', 'In progress', '<path d="M12 3a9 9 0 109 9"/><path d="M12 7v5l3 2"/>', '')}
                    ${tile('card-late', 'sumLate', 'Late completion', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>', '')}
                    ${tile('card-overdue', 'sumOverdue', 'Overdue', '<path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>', 'past planned end')}

                    <div class="summary-card card-delivery ex-delivery" role="button" tabindex="0" title="${_t("Click for the delay breakdown")}">
                        <div class="ex-delivery-head">
                            <span class="card-icon">${svg('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>')}</span>
                            <span class="card-label">${_t("Delivery")}</span>
                            <span class="ex-delivery-link">${_t("Delay breakdown")} ${svg('<path d="M5 12h14M13 6l6 6-6 6"/>')}</span>
                        </div>
                        <div class="delivery-rows">
                            <div class="delivery-row">
                                <span class="delivery-lbl">${_t("Planned")}</span>
                                <span class="delivery-date" id="sumDeliveryPlanned">—</span>
                            </div>
                            <div class="delivery-row">
                                <span class="delivery-lbl">${_t("Expected")}</span>
                                <span class="delivery-date delivery-date--expected" id="sumDeliveryExpected">—</span>
                                <span class="delivery-delta" id="sumDeliveryDelta" style="display:none"></span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <section class="kd2-phase-section" id="kd2PhaseSection" aria-label="KD2 Setup Snapshot" style="display:none">
            <div class="kd2-phase-card">
                <div class="kd2-phase-header">
                    <div>
                        <h3 class="kd2-phase-title">KD2 Setup Snapshot</h3>
                        <p class="kd2-phase-subtitle">Phase 1 and 2 foundation: module separation, battalion master data, route steps, and lead-time readiness.</p>
                    </div>
                    <span class="kd2-phase-status" id="kd2PhaseStatus">Waiting for KD2 tables</span>
                </div>
                <div class="kd2-phase-grid">
                    <div class="kd2-phase-item">
                        <span class="kd2-phase-label">Battalions</span>
                        <strong class="kd2-phase-value" id="kd2BattalionCount">0 configured</strong>
                        <span class="kd2-phase-note" id="kd2BattalionNote">Upload the KD2 schema, then load battalion masters.</span>
                    </div>
                    <div class="kd2-phase-item">
                        <span class="kd2-phase-label">Route baseline</span>
                        <strong class="kd2-phase-value" id="kd2RouteCount">0 steps</strong>
                        <span class="kd2-phase-note" id="kd2RouteNote">Upstream and downstream route definitions are not loaded yet.</span>
                    </div>
                    <div class="kd2-phase-item">
                        <span class="kd2-phase-label">Lead-time readiness</span>
                        <strong class="kd2-phase-value" id="kd2LeadTimeStatus">0 confirmed</strong>
                        <span class="kd2-phase-note" id="kd2LeadTimeNote">Unknown lead times stay blank until business confirmation.</span>
                    </div>
                </div>
            </div>
        </section>
`.trim();
}

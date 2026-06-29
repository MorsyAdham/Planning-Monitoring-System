export function initFeature() {
    return `
        <!-- ═══════════════════════════════════════════════ SUMMARY CARDS -->
        <section class="summary-section" id="summarySection" aria-label="Summary">
            <div class="ppms-section-header">
                <h3 class="ppms-section-heading">Production Overview</h3>
                <span class="ppms-section-sub">Total planned · Completed · In progress · Overdue</span>
            </div>
            <div class="summary-grid">
                <div class="summary-card card-planned">
                    <div class="card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <rect x="3" y="4" width="18" height="18" rx="2" />
                            <path d="M16 2v4M8 2v4M3 10h18" />
                        </svg>
                    </div>
                    <div class="card-body">
                        <span class="card-value" id="sumPlanned">0</span>
                        <span class="card-label">Total Planned</span>
                    </div>
                </div>
                <div class="summary-card card-completed">
                    <div class="card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M20 6L9 17l-5-5" />
                        </svg>
                    </div>
                    <div class="card-body">
                        <span class="card-value" id="sumCompleted">0</span>
                        <span class="card-label">Completed</span>
                    </div>
                </div>
                <div class="summary-card card-late">
                    <div class="card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 7v5l3 3" />
                        </svg>
                    </div>
                    <div class="card-body">
                        <span class="card-value" id="sumLate">0</span>
                        <span class="card-label">Late Completion</span>
                    </div>
                </div>
                <div class="summary-card card-overdue">
                    <div class="card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path
                                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                    </div>
                    <div class="card-body">
                        <span class="card-value" id="sumOverdue">0</span>
                        <span class="card-label">Overdue</span>
                    </div>
                </div>
                <div class="summary-card card-progress">
                    <div class="card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                        </svg>
                    </div>
                    <div class="card-body">
                        <span class="card-value" id="sumProgress">0%</span>
                        <span class="card-label">Progress</span>
                    </div>
                    <div class="progress-bar-wrap">
                        <div class="progress-bar-fill" id="progressBarFill" style="width:0%"></div>
                    </div>
                </div>

                <div class="summary-card card-delivery">
                    <div class="card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <rect x="3" y="4" width="18" height="18" rx="2"/>
                            <path d="M16 2v4M8 2v4M3 10h18"/>
                            <path d="M8 15l2.5 2.5L16 13" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>
                    <div class="card-body">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                            <span class="card-label">Delivery Date</span>
                            <span class="delivery-detail-hint" title="Click for delay breakdown">
                                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" style="width:13px;height:13px;opacity:.55">
                                    <circle cx="8" cy="8" r="6.5"/>
                                    <path d="M8 7v4M8 5.5v.5" stroke-linecap="round"/>
                                </svg>
                                <span style="font-size:.68rem;opacity:.6;letter-spacing:.02em">Details</span>
                            </span>
                        </div>
                        <div class="delivery-rows">
                            <div class="delivery-row">
                                <span class="delivery-lbl">Planned</span>
                                <span class="delivery-date" id="sumDeliveryPlanned">—</span>
                            </div>
                            <div class="delivery-row">
                                <span class="delivery-lbl">Expected</span>
                                <span class="delivery-date" id="sumDeliveryExpected">—</span>
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



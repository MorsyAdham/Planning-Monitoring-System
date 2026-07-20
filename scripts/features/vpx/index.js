export function initFeature() {
    return `
        <!-- ═══════════════════════════════════ VEHICLE PROGRESS MATRIX -->
        <section class="vpx-section" id="vpxSection" aria-label="Vehicle Production Progress">
            <div class="ppms-section-header">
                <h3 class="ppms-section-heading">Vehicle Production Progress</h3>
                <span class="ppms-section-sub">Station-by-station planned vs actual · select vehicle type to view</span>
            </div>
            <div class="vpx-card" id="vpxCard">
                <div class="vpx-card-header">
                    <div class="vpx-title-wrap">
                        <h3 class="vpx-title" id="vpxTitle">Vehicle Production Progress</h3>
                        <span class="vpx-subtitle" id="vpxSubtitle">Station-by-station planned vs actual · hover for details</span>
                    </div>
                    <div class="vpx-header-right">
                        <div class="gantt-view-seg" id="vpxViewToggle" role="group" aria-label="VPX view mode">
                            <button class="gantt-view-seg-btn gantt-view-seg-active" id="btnVpxViewMatrix" type="button" data-view="matrix">
                                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:11px;height:11px">
                                    <rect x="1" y="1" width="5" height="5" rx="1"/>
                                    <rect x="8" y="1" width="5" height="5" rx="1"/>
                                    <rect x="1" y="8" width="5" height="5" rx="1"/>
                                    <rect x="8" y="8" width="5" height="5" rx="1"/>
                                </svg>
                                Matrix
                            </button>
                            <button class="gantt-view-seg-btn" id="btnVpxViewStation" type="button" data-view="station">
                                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:11px;height:11px">
                                    <rect x="1" y="1" width="12" height="12" rx="1"/>
                                    <path d="M1 5.5h12M1 9h12M5.5 1v12"/>
                                </svg>
                                Station Report
                            </button>
                        </div>
                        <div id="vpxTypeTabs" class="vpx-type-tabs" hidden></div>
                        <div id="vpxCategoryTabs" class="vpx-type-tabs vpx-category-tabs" hidden></div>
                        <button class="btn btn-outline btn-sm" id="btnVpxReportModal" title="Generate a VPX report">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"
                                style="width:14px;height:14px">
                                <rect x="3" y="3" width="14" height="14" rx="2" />
                                <path d="M6.5 7.5h7M6.5 10.5h7M6.5 13.5h4" />
                            </svg>
                            Generate Report
                        </button>
                        <button class="btn btn-outline btn-sm vpx-fullscreen-btn" id="btnVpxFullscreen" aria-pressed="false" title="Full Screen">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"
                                style="width:14px;height:14px">
                                <path d="M3 8V3h5" />
                                <path d="M17 8V3h-5" />
                                <path d="M3 12v5h5" />
                                <path d="M17 12v5h-5" />
                            </svg>
                            <span id="btnVpxFullscreenLabel">Full Screen</span>
                        </button>
                        <div class="vpx-legend">
                            <span class="vpx-leg-item"><span class="vpx-dot vpx-dot-ok"></span>Completed</span>
                            <span class="vpx-leg-item"><span class="vpx-dot vpx-dot-prog"></span>In Progress</span>
                            <span class="vpx-leg-item"><span class="vpx-dot vpx-dot-late"></span>Late Completion</span>
                            <span class="vpx-leg-item"><span class="vpx-dot vpx-dot-over"></span>Overdue</span>
                            <span class="vpx-leg-item"><span class="vpx-dot vpx-dot-plan"></span>Planned</span>
                        </div>
                    </div>
                </div>
                <div class="vpx-scroll-wrap" id="vpxScrollWrap">
                    <div id="vpxMatrix">
                        <div class="vpx-empty">Load data to view the progress matrix.</div>
                    </div>
                </div>
            </div>
        </section>
`.trim();
}



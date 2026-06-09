export function initFeature() {
    return `
        <!-- ═══════════════════════════════════ VEHICLE PROGRESS MATRIX -->
        <section class="vpx-section" id="vpxSection" aria-label="Vehicle Production Progress">
            <div class="vpx-card" id="vpxCard">
                <div class="vpx-card-header">
                    <div class="vpx-title-wrap">
                        <h3 class="vpx-title" id="vpxTitle">Vehicle Production Progress</h3>
                        <span class="vpx-subtitle" id="vpxSubtitle">Station-by-station planned vs actual · hover for details</span>
                    </div>
                    <div class="vpx-header-right">
                        <div id="vpxTypeTabs" class="vpx-type-tabs" hidden></div>
                        <button class="btn btn-outline btn-sm" id="btnVpxPdf" title="Export print-friendly PDF">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"
                                style="width:14px;height:14px">
                                <path d="M4 4h8l4 4v10H4V4z" />
                                <path d="M12 4v4h4" />
                                <path d="M7 12h6M7 15h4" />
                            </svg>
                            Export PDF
                        </button>
                        <button class="btn btn-outline btn-sm" id="btnVpxExcel" title="Export as Excel">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"
                                style="width:14px;height:14px">
                                <path d="M4 4h8l4 4v10H4V4z" />
                                <path d="M12 4v4h4" />
                                <path d="M6 8l3 4m0-4l-3 4M13 8h2M13 12h2" />
                            </svg>
                            Export Excel
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



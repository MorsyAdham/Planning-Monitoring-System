export function initFeature() {
    return `
        <!-- ═══════════════════════════════════════════════ PRODUCTION ISSUES -->
        <section class="issues-section" id="issuesSection" aria-label="Production Issues">
            <div class="ppms-section-header">
                <h3 class="ppms-section-heading">
                    Production Issues
                    <span class="issues-new-badge" id="issuesNewBadge" style="display:none"></span>
                </h3>
                <span class="ppms-section-sub">Track, monitor and resolve production problems</span>
            </div>

            <div class="issues-overview-grid">
                <div class="issue-overview-card issue-overview-card--open">
                    <div class="issue-overview-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                        </svg>
                    </div>
                    <div class="issue-overview-body">
                        <span class="issue-overview-value" id="issueOvOpen">0</span>
                        <span class="issue-overview-label">Open</span>
                    </div>
                </div>
                <div class="issue-overview-card issue-overview-card--progress">
                    <div class="issue-overview-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <circle cx="12" cy="12" r="9"/>
                            <path d="M12 7v5l3 3"/>
                        </svg>
                    </div>
                    <div class="issue-overview-body">
                        <span class="issue-overview-value" id="issueOvInProgress">0</span>
                        <span class="issue-overview-label">In Progress</span>
                    </div>
                </div>
                <div class="issue-overview-card issue-overview-card--resolved">
                    <div class="issue-overview-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M20 6L9 17l-5-5"/>
                        </svg>
                    </div>
                    <div class="issue-overview-body">
                        <span class="issue-overview-value" id="issueOvResolved">0</span>
                        <span class="issue-overview-label">Resolved</span>
                    </div>
                </div>
                <div class="issue-overview-card issue-overview-card--critical">
                    <div class="issue-overview-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                        </svg>
                    </div>
                    <div class="issue-overview-body">
                        <span class="issue-overview-value" id="issueOvCritical">0</span>
                        <span class="issue-overview-label">Critical / High (open)</span>
                    </div>
                </div>
            </div>

            <div class="issues-card">
                <!-- Toolbar: single row — search, filters, actions -->
                <div class="issues-toolbar">
                    <div class="issues-search-wrap">
                        <svg class="issues-search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                            <circle cx="6.5" cy="6.5" r="4.5"/>
                            <path d="M10.5 10.5l3 3" stroke-linecap="round"/>
                        </svg>
                        <input id="issueSearch" class="issues-search-input" placeholder="Search…" type="search" autocomplete="off" />
                    </div>

                    <div class="issues-toolbar-sep"></div>

                    <select id="issueFilterCategory" class="issues-filter-select">
                        <option value="">Category</option>
                        <option value="cutting">Cutting</option>
                        <option value="part_machining">Part Machining</option>
                        <option value="welding">Welding</option>
                        <option value="machining">Machining</option>
                        <option value="accessories">Accessories</option>
                        <option value="cables">Cables</option>
                        <option value="material">Material</option>
                        <option value="assembly">Assembly</option>
                        <option value="quality">Quality</option>
                        <option value="other">Other</option>
                    </select>
                    <select id="issueFilterStatus" class="issues-filter-select">
                        <option value="">Status</option>
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                    </select>
                    <select id="issueFilterPriority" class="issues-filter-select">
                        <option value="">Priority</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                    </select>
                    <select id="issueFilterReporter" class="issues-filter-select">
                        <option value="">Reporter</option>
                    </select>
                    <label class="issues-date-label">From<input type="date" id="issueFilterFrom" class="issues-filter-select" /></label>
                    <label class="issues-date-label">To<input type="date" id="issueFilterTo" class="issues-filter-select" /></label>
                    <button class="btn btn-primary btn-sm" id="btnIssueApply">Apply</button>
                    <button class="btn btn-ghost btn-sm" id="btnIssueReset" onclick="resetIssueFilters()">Reset</button>

                    <div class="issues-toolbar-spacer"></div>

                    <span class="issues-count" id="issueCount">— issues</span>
                    <button class="btn btn-ghost btn-sm" id="btnIssueReportModal" onclick="openIssueReportModal()">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px">
                            <rect x="3" y="2" width="10" height="12" rx="1.5"/>
                            <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/>
                        </svg>
                        Generate Report
                    </button>
                    <button class="btn btn-primary btn-sm" id="btnAddIssue" onclick="openIssueModal()">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-1px;margin-right:4px">
                            <path d="M8 3v10M3 8h10" stroke-linecap="round"/>
                        </svg>
                        Report Issue
                    </button>
                </div>

                <!-- Table -->
                <div class="issues-table-wrap">
                    <table class="data-table issues-table">
                        <thead>
                            <tr>
                                <th class="issues-col-idx">#</th>
                                <th class="issues-col-title">Title</th>
                                <th class="issues-col-cat">Category</th>
                                <th class="issues-col-pri">Priority</th>
                                <th class="issues-col-status">Status</th>
                                <th class="issues-col-reporter">Reporter</th>
                                <th class="issues-col-date">Reported On</th>
                                <th class="issues-col-date">Updated</th>
                                <th class="issues-col-actions">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="issuesTableBody">
                            <tr>
                                <td colspan="9" class="table-empty">
                                    <div class="empty-state">
                                        <span class="spinner"></span>
                                        <p>Loading issues…</p>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="issues-footer">
                    <button class="btn btn-ghost btn-sm" id="btnIssuesMore" style="display:none">Load more…</button>
                </div>
            </div>
        </section>
    `;
}

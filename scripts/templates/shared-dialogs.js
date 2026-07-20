export function renderSharedDialogs() {
    return `
        <!-- ═══════════════════════════════════════════════ REPORTS MODAL -->
        <div class="modal-overlay" id="reportModalOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="reportModalTitle">
            <div class="modal report-modal">
                <div class="modal-header">
                    <h4 class="modal-title" id="reportModalTitle">Export Report</h4>
                    <button class="modal-close" id="reportModalClose" aria-label="Close">&#x2715;</button>
                </div>
                <div class="modal-body">

                    <!-- Report type selector -->
                    <div class="form-group">
                        <label class="form-label">Report Type</label>
                        <div class="report-type-grid">
                            <label class="report-type-card">
                                <input type="radio" name="reportType" value="full" checked />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <rect x="3" y="3" width="18" height="18" rx="2" />
                                        <path d="M7 8h10M7 12h10M7 16h6" />
                                    </svg>
                                    <span class="rtc-label">Full Report</span>
                                    <span class="rtc-desc">All tasks regardless of status</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="reportType" value="today" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <rect x="3" y="4" width="18" height="18" rx="2" />
                                        <path d="M16 2v4M8 2v4M3 10h18" />
                                        <circle cx="12" cy="16" r="2" />
                                    </svg>
                                    <span class="rtc-label">Today's Plan</span>
                                    <span class="rtc-desc">Tasks active today</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="reportType" value="overdue" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <path
                                            d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                    </svg>
                                    <span class="rtc-label">Overdue</span>
                                    <span class="rtc-desc">Past end date, not complete</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="reportType" value="inprogress" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <circle cx="12" cy="12" r="9" />
                                        <path d="M12 7v5l3 3" />
                                    </svg>
                                    <span class="rtc-label">In Progress</span>
                                    <span class="rtc-desc">Started but not yet complete</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="reportType" value="completed" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <path d="M20 6L9 17l-5-5" />
                                    </svg>
                                    <span class="rtc-label">Completed</span>
                                    <span class="rtc-desc">All finished tasks</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="reportType" value="late" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <circle cx="12" cy="12" r="9" />
                                        <path d="M12 7v5l3 3" />
                                        <path d="M18 18l3 3" />
                                    </svg>
                                    <span class="rtc-label">Late Completions</span>
                                    <span class="rtc-desc">Finished after planned end date</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="reportType" value="planned" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <rect x="3" y="4" width="18" height="18" rx="2" />
                                        <path d="M16 2v4M8 2v4M3 10h18M8 15h8" />
                                    </svg>
                                    <span class="rtc-label">Not Started</span>
                                    <span class="rtc-desc">Planned but not yet started</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="reportType" value="vehicle" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <rect x="2" y="7" width="20" height="14" rx="2" />
                                        <path d="M16 7V5a2 2 0 00-4 0v2M8 12h8M8 16h5" />
                                    </svg>
                                    <span class="rtc-label">By Vehicle</span>
                                    <span class="rtc-desc">Current vehicle filter only</span>
                                </div>
                            </label>
                            <!-- KD2-only report types — shown/hidden by syncReportCategoryOptions -->
                            <label class="report-type-card" id="kd2ReportCardBattalion" hidden>
                                <input type="radio" name="reportType" value="battalion" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <path d="M3 12l9-9 9 9M5 10v9a2 2 0 002 2h4v-5h4v5h4a2 2 0 002-2v-9" />
                                    </svg>
                                    <span class="rtc-label">By Battalion</span>
                                    <span class="rtc-desc">Active battalion filter only</span>
                                </div>
                            </label>
                            <label class="report-type-card" id="kd2ReportCardVtype" hidden>
                                <input type="radio" name="reportType" value="vtype" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <rect x="2" y="8" width="20" height="13" rx="2" />
                                        <path d="M8 8V6a2 2 0 014 0v2M9 13h6M9 17h3" />
                                        <path d="M18 5l2-2M6 5L4 3" />
                                    </svg>
                                    <span class="rtc-label">By Vehicle Type</span>
                                    <span class="rtc-desc">K9 / K10 / K11 breakdown</span>
                                </div>
                            </label>
                            <label class="report-type-card" id="kd2ReportCardAnalytics" hidden>
                                <input type="radio" name="reportType" value="analytics" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <path d="M3 3v18h18" />
                                        <path d="M7 16l4-5 4 3 5-7" />
                                        <circle cx="7" cy="16" r="1.2" fill="currentColor" />
                                        <circle cx="11" cy="11" r="1.2" fill="currentColor" />
                                        <circle cx="15" cy="14" r="1.2" fill="currentColor" />
                                        <circle cx="20" cy="7" r="1.2" fill="currentColor" />
                                    </svg>
                                    <span class="rtc-label">Station Analytics</span>
                                    <span class="rtc-desc">Avg plan vs actual · delay per process</span>
                                </div>
                            </label>
                            <label class="report-type-card" id="kd2ReportCardXray" hidden>
                                <input type="radio" name="reportType" value="xray_status" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <rect x="4" y="3" width="16" height="18" rx="2" />
                                        <path d="M8 8h8M8 12h8M8 16h5" />
                                    </svg>
                                    <span class="rtc-label">X-ray Status</span>
                                    <span class="rtc-desc">Units currently in X-ray / repair</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    <!-- Date range + Category filter row -->
                    <div class="report-filter-row">
                        <div class="form-group" style="flex:1">
                            <label class="form-label">Date Range <span class="form-label-optional">(optional — filters
                                    by planned start)</span></label>
                            <div class="report-date-row">
                                <input type="date" id="reportDateFrom" class="filter-control" placeholder="From" />
                                <span class="report-date-sep">→</span>
                                <input type="date" id="reportDateTo" class="filter-control" placeholder="To" />
                            </div>
                        </div>
                        <div class="form-group" style="min-width:180px">
                            <label class="form-label">Category <span
                                    class="form-label-optional">(optional)</span></label>
                            <select id="reportCategory" class="filter-control">
                                <option value="">All Categories</option>
                                <option value="Assembly">Assembly</option>
                                <option value="Final Test">Final Test</option>
                                <option value="Processing">Processing</option>
                            </select>
                        </div>
                        <div class="form-group" id="reportVtypeGroup" style="min-width:140px; display:none">
                            <label class="form-label">Vehicle Type</label>
                            <select id="reportVehicleType" class="filter-control">
                                <option value="">All Types</option>
                                <option value="K9">K9</option>
                                <option value="K10">K10</option>
                                <option value="K11">K11</option>
                            </select>
                        </div>
                    </div>

                    <!-- Preview badge -->
                    <div class="report-preview-bar" id="reportPreviewBar">
                        <span class="report-preview-count" id="reportPreviewCount">— tasks match</span>
                        <span class="report-preview-hint">Select a type to preview count</span>
                    </div>

                </div>
                <div class="modal-footer">
                    <label class="report-preview-toggle">
                        <input type="checkbox" id="reportPreviewToggle" />
                        View before exporting
                    </label>
                    <button class="btn btn-report-pdf" id="btnExportPDF">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 4h8l4 4v10H4V4z" />
                            <path d="M12 4v4h4" />
                            <path d="M7 13h6M7 10h3" />
                        </svg>
                        Export PDF
                    </button>
                    <button class="btn btn-report-excel" id="btnExportExcel">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="3" width="16" height="14" rx="2" />
                            <path d="M6 7l3 3-3 3M11 13h4" />
                        </svg>
                        Export Excel
                    </button>
                    <button class="btn btn-ghost" id="reportModalCancel">Cancel</button>
                </div>
            </div>
        </div>

        <!-- ═══════════════════════════════════════════ USER MANAGEMENT MODAL -->
        <!-- ═══════════════════════════════════════════════ UNIT CODES MODAL -->
        <div class="modal-overlay modal-overlay-wide" id="unitCodesOverlay" style="display:none;" role="dialog"
            aria-modal="true" aria-labelledby="unitCodesTitle">
            <div class="modal modal-wide">
                <div class="modal-header">
                    <h4 class="modal-title" id="unitCodesTitle">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"
                            style="width:18px;height:18px;vertical-align:-3px;margin-right:8px">
                            <rect x="2" y="4" width="16" height="12" rx="2" />
                            <path d="M6 8h8M6 12h5" />
                        </svg>
                        <span id="unitCodesTitleText">Unit Codes</span>
                    </h4>
                    <button class="modal-close" id="unitCodesClose">&#x2715;</button>
                </div>
                <div class="modal-body" style="padding:0">
                    <div class="um-toolbar">
                        <span class="um-count" id="ucCount">0 units</span>
                        <button class="btn btn-primary btn-sm" id="btnAddUnitCode">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"
                                style="width:13px;height:13px">
                                <path d="M10 4v12M4 10h12" />
                            </svg>
                            Add / Edit Code
                        </button>
                    </div>
                    <div class="um-table-wrap">
                        <table class="data-table um-table">
                            <thead>
                                <tr>
                                    <th id="ucHeaderBattalion" style="display:none">Battalion</th>
                                    <th id="ucHeaderVehicle">Vehicle</th>
                                    <th id="ucHeaderUnit">Unit</th>
                                    <th id="ucHeaderCode">Unit Code</th>
                                    <th id="ucHeaderUnitName" style="display:none">Unit Name</th>
                                    <th id="ucHeaderUnitCode" style="display:none">Unit Code (Text)</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="ucTableBody">
                                <tr>
                                    <td colspan="4" class="table-empty">
                                        <div class="empty-state"><span class="spinner"></span>
                                            <p>Loading…</p>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="um-form" id="ucForm" style="display:none">
                        <div class="um-form-header">
                            <span id="ucFormTitle">Add Unit Code</span>
                            <button class="modal-close" id="ucFormClose">&#x2715;</button>
                        </div>
                        <div class="um-form-body">
                            <div class="um-form-grid">
                                <input type="hidden" id="ucEditId" />
                                <div class="form-group" id="ucBattalionGroup" style="display:none">
                                    <label class="form-label">Battalion</label>
                                    <select id="ucBattalion" class="filter-control"></select>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Vehicle</label>
                                    <select id="ucVehicle" class="filter-control"></select>
                                </div>
                                <div class="form-group">
                                    <label class="form-label" id="ucUnitLabel">Unit</label>
                                    <select id="ucUnit" class="filter-control"></select>
                                    <input type="text" id="ucUnitText" class="filter-control" style="display:none"
                                        placeholder="e.g. M1" />
                                </div>
                                <div class="form-group" id="ucNameGroup" style="display:none">
                                    <label class="form-label">Unit Name</label>
                                    <input type="text" id="ucName" class="filter-control"
                                        placeholder="e.g. First K9 Section" />
                                </div>
                                <div class="form-group">
                                    <label class="form-label" id="ucCodeLabel">Unit Code</label>
                                    <input type="text" id="ucCode" class="filter-control"
                                        placeholder="e.g. EGY N25039" />
                                </div>
                            </div>
                        </div>
                        <div class="um-form-footer">
                            <button class="btn btn-primary" id="btnUcSave">Save</button>
                            <button class="btn btn-ghost" id="btnUcCancel">Cancel</button>
                            <span class="um-form-error" id="ucFormError"></span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="modal-overlay modal-overlay-wide" id="userMgmtOverlay" style="display:none;" role="dialog"
            aria-modal="true" aria-labelledby="userMgmtTitle">
            <div class="modal modal-wide">
                <div class="modal-header">
                    <h4 class="modal-title" id="userMgmtTitle">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"
                            style="width:18px;height:18px;vertical-align:-3px;margin-right:8px">
                            <circle cx="8" cy="7" r="3" />
                            <path d="M2 18c0-3.3 2.7-6 6-6s6 2.7 6 6" />
                            <path d="M15 9l2 2 3-3" />
                        </svg>
                        User Management
                    </h4>
                    <button class="modal-close" id="userMgmtClose">&#x2715;</button>
                </div>
                <div class="modal-body" style="padding:0">

                    <!-- Toolbar -->
                    <div class="um-toolbar">
                        <span class="um-count" id="umUserCount">0 users</span>
                        <button class="btn btn-primary btn-sm" id="btnAddUser">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"
                                style="width:13px;height:13px">
                                <path d="M10 4v12M4 10h12" />
                            </svg>
                            Add User
                        </button>
                    </div>

                    <!-- User table -->
                    <div class="um-table-wrap">
                        <table class="data-table um-table">
                            <thead>
                                <tr>
                                    <th>Full Name</th>
                                    <th>Email</th>
                                    <th>Role</th>
                                    <th>Status</th>
                                    <th>Created</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="umTableBody">
                                <tr>
                                    <td colspan="6" class="table-empty">
                                        <div class="empty-state"><span class="spinner"></span>
                                            <p>Loading…</p>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Add / Edit form (hidden by default) -->
                    <div class="um-form" id="umForm" style="display:none">
                        <form autocomplete="off" onsubmit="return false">
                            <div class="um-form-header">
                                <span id="umFormTitle">Add New User</span>
                                <button class="modal-close" id="umFormClose">&#x2715;</button>
                            </div>
                            <div class="um-form-body">
                                <input type="hidden" id="umEditId" />
                                <div class="um-form-grid">
                                    <div class="form-group">
                                        <label class="form-label" for="umFullName">Full Name</label>
                                        <input type="text" id="umFullName" class="filter-control"
                                            placeholder="John Doe" />
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="umEmail">Email</label>
                                        <input type="email" id="umEmail" class="filter-control"
                                            placeholder="user@example.com" autocomplete="username" />
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="umRole">Role</label>
                                        <select id="umRole" class="filter-control">
                                            <option value="viewer">Viewer — read only</option>
                                            <option value="planner">Planner — edit plan schedule</option>
                                            <option value="admin">Admin — edit data &amp; plan</option>
                                            <option value="master_admin">Master Admin — full access</option>
                                        </select>
                                    </div>
                                    <div class="form-group" id="umPasswordGroup">
                                        <label class="form-label" for="umPassword">Password <span id="umPasswordHint"
                                                class="form-label-optional">(leave blank to keep current)</span></label>
                                        <input type="password" id="umPassword" class="filter-control"
                                            placeholder="••••••••" autocomplete="new-password" />
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="umActive">Account Status</label>
                                        <select id="umActive" class="filter-control">
                                            <option value="true">Active</option>
                                            <option value="false">Inactive</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div class="um-form-footer">
                                <button class="btn btn-primary" id="btnUmSave">Save User</button>
                                <button class="btn btn-ghost" id="btnUmCancel">Cancel</button>
                                <span class="um-form-error" id="umFormError"></span>
                            </div>
                    </div>

                    <!-- ── Export Permissions section ──────────────────── -->
                    <div class="um-export-perm-section" id="umExportPermSection">
                        <div class="um-export-perm-header">
                            <div>
                                <span class="um-export-perm-title">Export Permissions</span>
                                <span class="um-export-perm-sub">Users allowed to export Excel &amp; PDF reports (master admin always can)</span>
                            </div>
                        </div>
                        <div class="um-export-perm-body">
                            <ul class="exp-perm-list" id="exportPermList">
                                <li class="exp-perm-empty">Loading…</li>
                            </ul>
                            <div class="exp-perm-add-row">
                                <select id="exportPermUserSelect" class="filter-control" style="flex:1">
                                    <option value="">— Select a user —</option>
                                </select>
                                <input type="text" id="exportPermNote" class="filter-control"
                                    placeholder="Note (optional)" style="width:130px" autocomplete="off" />
                                <button class="btn btn-primary btn-sm" id="btnExportPermAdd">Grant</button>
                            </div>
                            <div class="ab-error" id="exportPermError" style="display:none;margin-top:8px"></div>
                        </div>
                    </div>

                </div>
            </div>
        </div>

        <!-- ═══════════════════════════════════════════════ AUDIT LOG MODAL -->
        <div class="modal-overlay modal-overlay-wide" id="auditLogOverlay" style="display:none;" role="dialog"
            aria-modal="true" aria-labelledby="auditLogTitle">
            <div class="modal modal-wide modal-audit">
                <div class="modal-header">
                    <h4 class="modal-title" id="auditLogTitle">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"
                            style="width:18px;height:18px;vertical-align:-3px;margin-right:6px">
                            <path d="M4 4h12v2H4zM4 8h12v2H4zM4 12h8v2H4z" />
                            <circle cx="15" cy="13" r="3.5" />
                            <path d="M17 15l1.5 1.5" />
                        </svg>
                        Audit Log
                    </h4>
                    <button class="modal-close" id="auditLogClose">&#x2715;</button>
                </div>
                <div class="modal-body" style="padding:0">

                    <!-- Filter bar -->
                    <div class="al-filter-bar">
                        <div class="al-filter-row">
                            <div class="al-filter-group">
                                <label class="al-filter-label" for="alFilterAction">Action</label>
                                <select id="alFilterAction" class="al-filter-input">
                                    <option value="">All</option>
                                    <option value="LOGIN">Login</option>
                                    <option value="LOGOUT">Logout</option>
                                    <option value="INSERT">Insert</option>
                                    <option value="UPDATE">Update</option>
                                    <option value="DELETE">Delete</option>
                                    <option value="BOOTSTRAP">Bootstrap</option>
                                </select>
                            </div>
                            <div class="al-filter-group">
                                <label class="al-filter-label" for="alFilterTable">Module</label>
                                <select id="alFilterTable" class="al-filter-input">
                                    <option value="">All</option>
                                    <option value="kd2_plan">KD2 Plan</option>
                                    <option value="kd2_progress">KD2 Progress</option>
                                    <option value="kd2_battalions">KD2 Battalions</option>
                                    <option value="assembly_plan">F100 Plan</option>
                                    <option value="assembly_progress">F100 Progress</option>
                                    <option value="f100_plans">F100 Plans</option>
                                    <option value="planning_app_users">Users</option>
                                </select>
                            </div>
                            <div class="al-filter-group al-filter-group--grow">
                                <label class="al-filter-label" for="alFilterUser">User</label>
                                <select id="alFilterUser" class="al-filter-input">
                                    <option value="">All Users</option>
                                </select>
                            </div>
                            <div class="al-filter-group">
                                <label class="al-filter-label" for="alFilterDateFrom">From</label>
                                <input type="date" id="alFilterDateFrom" class="al-filter-input" />
                            </div>
                            <div class="al-filter-group">
                                <label class="al-filter-label" for="alFilterDateTo">To</label>
                                <input type="date" id="alFilterDateTo" class="al-filter-input" />
                            </div>
                            <div class="al-filter-actions">
                                <button class="btn btn-primary btn-sm" id="btnAlApply">Apply</button>
                                <button class="btn btn-ghost btn-sm" id="btnAlReset">Reset</button>
                            </div>
                        </div>
                        <div class="al-filter-meta">
                            <span class="al-entry-count" id="alEntryCount">—</span>
                        </div>
                    </div>

                    <!-- Audit table -->
                    <div class="al-table-wrap">
                        <table class="data-table al-table">
                            <thead>
                                <tr>
                                    <th>Date / Time</th>
                                    <th>User</th>
                                    <th>Role</th>
                                    <th>Action</th>
                                    <th>Module</th>
                                    <th>Record</th>
                                    <th>IP Address</th>
                                    <th>Changes</th>
                                </tr>
                            </thead>
                            <tbody id="alTableBody">
                                <tr>
                                    <td colspan="8" class="table-empty">
                                        <div class="empty-state"><p>Click to load audit log</p></div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div class="al-footer">
                        <button class="btn btn-ghost btn-sm" id="btnAlMore" style="display:none">Load more…</button>
                        <div class="al-export-btns">
                            <button class="btn btn-ghost btn-sm" id="btnAlExportExcel" onclick="exportAuditLogExcel()">
                                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M5 6l2 2-2 2M9 6l2 2-2 2" stroke-linecap="round"/></svg>
                                Export Excel
                            </button>
                            <button class="btn btn-ghost btn-sm" id="btnAlExportPDF" onclick="exportAuditLogPDF()">
                                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"><path d="M3 2h7l3 3v9H3V2z" stroke-linecap="round"/><path d="M10 2v3h3" stroke-linecap="round"/><path d="M6 9h4M6 11h2" stroke-linecap="round"/></svg>
                                Export PDF
                            </button>
                        </div>
                    </div>

                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════ ADD BLOCK MODAL -->
        <div class="modal-overlay" id="addBlockOverlay" style="display:none" role="dialog" aria-modal="true">
            <div class="modal ab-modal">
                <div class="modal-header">
                    <h4 class="modal-title">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"
                            style="width:17px;height:17px;vertical-align:-3px;margin-right:8px">
                            <path d="M10 4v12M4 10h12" />
                        </svg>
                        Add Plan Block
                    </h4>
                    <button class="modal-close" id="addBlockClose">&#x2715;</button>
                </div>
                <div class="modal-body" style="padding:20px 24px">
                    <div class="um-form-grid ab-form-grid">

                        <div class="form-group">
                            <label class="form-label" for="abVehicle">Vehicle</label>
                            <select id="abVehicle" class="filter-control"></select>
                        </div>

                        <!-- New vehicle input (hidden unless "+ New Vehicle" selected) -->
                        <div class="form-group ab-form-group-full" id="abNewVehicleGroup" style="display:none">
                            <label class="form-label" for="abNewVehicle">New Vehicle Name</label>
                            <input type="text" id="abNewVehicle" class="filter-control" placeholder="e.g. K15" />
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="abUnit">Unit / Vehicle No.</label>
                            <select id="abUnit" class="filter-control"></select>
                        </div>

                        <!-- New unit input (hidden unless "+ New Unit" selected) -->
                        <div class="form-group ab-form-group-full" id="abNewUnitGroup" style="display:none">
                            <label class="form-label" for="abNewUnit">New Unit / Vehicle No.</label>
                            <input type="text" id="abNewUnit" class="filter-control" placeholder="e.g. M4" />
                        </div>

                        <div class="form-group ab-form-group-station">
                            <label class="form-label" for="abStation">Process / Station</label>
                            <select id="abStation" class="filter-control">
                                <optgroup label="Assembly">
                                    <option value="Suspension">Suspension (2d)</option>
                                    <option value="Turret">Turret (2d)</option>
                                    <option value="T/Electric (TURRET)">T/Electric (TURRET) (2d)</option>
                                    <option value="Hyd / Sub (TURRET)">Hyd / Sub (TURRET) (2d)</option>
                                    <option value="H/Electric">H/Electric (2d)</option>
                                    <option value="Interior">Interior (2d)</option>
                                    <option value="Engine">Engine (2d)</option>
                                    <option value="Turret/Gun">Turret/Gun (2d)</option>
                                    <option value="Hydraulic">Hydraulic (2d)</option>
                                    <option value="Bore Sight">Bore Sight (2d)</option>
                                    <option value="Track">Track (2d)</option>
                                    <option value="Electric/Interior">Electric/Interior (2d)</option>
                                    <option value="Automation">Automation (2d)</option>
                                    <option value="Final Assembly">Final Assembly (2d)</option>
                                </optgroup>
                                <optgroup label="Final Test">
                                    <option value="#1Insp">#1Insp (1d)</option>
                                    <option value="TEST RUN">TEST RUN (3d)</option>
                                    <option value="Performance test">Performance test (3d)</option>
                                    <option value="REPAIR">REPAIR (1d)</option>
                                    <option value="CHECK">CHECK (1d)</option>
                                    <option value="Powerpack check">Powerpack check (1d)</option>
                                    <option value="Final Check">Final Check (1d)</option>
                                </optgroup>
                                <optgroup label="Processing">
                                    <option value="Processing">Processing (5d)</option>
                                </optgroup>
                            </select>
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="abStart">Start Date</label>
                            <input type="date" id="abStart" class="filter-control" />
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="abDuration">Duration (working days)</label>
                            <input type="number" id="abDuration" class="filter-control" min="1" max="60" value="2" />
                        </div>

                        <div class="form-group ab-form-group-full">
                            <label class="form-label" for="abRemark">Remark (optional)</label>
                            <input type="text" id="abRemark" class="filter-control"
                                placeholder="Notes for this block" />
                        </div>

                    </div>
                    <!-- Preview of computed end date -->
                    <div class="ab-preview" id="abPreview" style="display:none">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"
                            style="width:13px;height:13px;flex-shrink:0">
                            <rect x="2" y="3" width="12" height="11" rx="2" />
                            <path d="M2 7h12M6 3V1M10 3V1" />
                        </svg>
                        Block will run: <strong id="abPreviewText">—</strong>
                    </div>
                    <div class="ab-error" id="abError" style="display:none"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="btnAddBlockSave">Add to Plan</button>
                    <button class="btn btn-ghost" id="btnAddBlockCancel">Cancel</button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════ F100 ADD BLOCK MODAL -->
        <div class="modal-overlay" id="f100AddBlockOverlay" style="display:none" role="dialog" aria-modal="true">
            <div class="modal kd2-plan-create-modal">
                <div class="modal-header">
                    <h4 class="modal-title" id="f100AbTitle">Add F100 Plan Block</h4>
                    <button class="modal-close" id="f100AddBlockClose">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <div class="kd2-modal-grid">

                        <!-- Mode toggle (Block / Template) -->
                        <div class="form-group" style="grid-column:1/-1">
                            <label class="form-label">Add Type</label>
                            <div class="kd2-create-mode-toggle" id="f100AbModeToggle">
                                <button type="button" class="kd2-create-mode-btn active" data-f100-mode="block">Block</button>
                                <button type="button" class="kd2-create-mode-btn" data-f100-mode="template">Template</button>
                            </div>
                        </div>

                        <!-- Shared fields toolbar -->
                        <div class="kd2-plan-create-toolbar">
                            <div class="form-group">
                                <label class="form-label" for="f100AbBattalion">Battalion</label>
                                <select id="f100AbBattalion" class="filter-control"></select>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="f100AbMode">Mode</label>
                                <select id="f100AbMode" class="filter-control">
                                    <option value="gun">Gun</option>
                                    <option value="vehicle">Vehicle</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="f100AbVehicleType">Vehicle Type</label>
                                <select id="f100AbVehicleType" class="filter-control">
                                    <option value="K9">K9</option>
                                    <option value="K10">K10</option>
                                    <option value="K11">K11</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="f100AbSerial">Serial No.</label>
                                <input type="number" id="f100AbSerial" class="filter-control" min="1" placeholder="e.g. 1" />
                            </div>
                        </div>

                        <div class="form-group" style="grid-column:1/-1">
                            <label class="form-label" for="f100AbPart">Part</label>
                            <select id="f100AbPart" class="filter-control"></select>
                        </div>

                        <!-- Block-only fields -->
                        <div class="form-group" style="grid-column:1/-1" id="f100AbProcessGroup">
                            <label class="form-label" for="f100AbProcess">Process / Station</label>
                            <select id="f100AbProcess" class="filter-control"></select>
                        </div>

                        <div class="form-group" id="f100AbStartGroup">
                            <label class="form-label" for="f100AbStart">Planned Start</label>
                            <input type="date" id="f100AbStart" class="filter-control" />
                        </div>

                        <div class="form-group" id="f100AbEndGroup">
                            <label class="form-label" for="f100AbEnd">Planned End</label>
                            <input type="date" id="f100AbEnd" class="filter-control" />
                        </div>

                        <!-- Template-only section -->
                        <div class="form-group kd2-template-editor-wrap" id="f100AbTemplateWrap" style="grid-column:1/-1;display:none">
                            <div class="form-group">
                                <label class="form-label" for="f100AbTplStart">Plan Start Date</label>
                                <input type="date" id="f100AbTplStart" class="filter-control" style="max-width:180px" />
                            </div>
                            <div class="kd2-template-editor-head" style="margin-top:12px">
                                <label class="form-label">Process Sequence</label>
                                <div class="modal-info">Each process starts the day after the previous one ends. Adjust durations as needed.</div>
                            </div>
                            <div id="f100AbTemplateList" style="margin-top:8px">
                                <p style="color:var(--clr-text-muted);font-size:.8rem">Select a part above to load the process sequence.</p>
                            </div>
                        </div>

                    </div>
                    <div class="ab-error" id="f100AbError" style="display:none"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="btnF100AddBlockSave">Add to Plan</button>
                    <button class="btn btn-ghost" id="btnF100AddBlockCancel">Cancel</button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════ F100 EDIT BLOCK MODAL -->
        <div class="modal-overlay" id="f100EditBlockOverlay" style="display:none" role="dialog" aria-modal="true">
            <div class="modal" style="max-width:440px">
                <div class="modal-header">
                    <h4 class="modal-title">Edit F100 Plan Block</h4>
                    <button class="modal-close" id="f100EditBlockClose">&#x2715;</button>
                </div>
                <div class="modal-body" style="padding:20px 24px">
                    <input type="hidden" id="f100EbPlanId" />
                    <div class="um-form-grid" style="grid-template-columns:1fr 1fr;gap:14px 18px">

                        <div class="form-group" style="grid-column:1/-1">
                            <label class="form-label">Block</label>
                            <div class="eb-block-info" id="f100EbBlockInfo">—</div>
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="f100EbStart">Planned Start</label>
                            <input type="date" id="f100EbStart" class="filter-control" />
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="f100EbEnd">Planned End</label>
                            <input type="date" id="f100EbEnd" class="filter-control" />
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="f100EbActualStart">Actual Start</label>
                            <input type="date" id="f100EbActualStart" class="filter-control" />
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="f100EbActualEnd">Actual End</label>
                            <input type="date" id="f100EbActualEnd" class="filter-control" />
                        </div>

                        <div class="form-group" style="grid-column:1/-1">
                            <label class="form-label" for="f100EbStatus">Status</label>
                            <select id="f100EbStatus" class="filter-control">
                                <option value="Planned">Planned</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Completed">Completed</option>
                                <option value="Overdue">Overdue</option>
                                <option value="Late Completion">Late Completion</option>
                            </select>
                        </div>

                    </div>
                    <div class="ab-error" id="f100EbError" style="display:none"></div>
                </div>
                <div class="modal-footer" style="justify-content:flex-end">
                    <button class="btn btn-ghost" id="btnF100EditBlockCancel">Cancel</button>
                    <button class="btn btn-primary" id="btnF100EditBlockSave">Save Changes</button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════ EDIT BLOCK MODAL -->
        <div class="modal-overlay" id="editBlockOverlay" style="display:none" role="dialog" aria-modal="true">
            <div class="modal" style="max-width:400px">
                <div class="modal-header">
                    <h4 class="modal-title">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"
                            style="width:17px;height:17px;vertical-align:-3px;margin-right:8px">
                            <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" />
                        </svg>
                        Edit Block
                    </h4>
                    <button class="modal-close" id="editBlockClose">&#x2715;</button>
                </div>
                <div class="modal-body" style="padding:20px 24px">
                    <input type="hidden" id="ebPlanId" />
                    <div class="um-form-grid" style="grid-template-columns:1fr 1fr;gap:14px 18px">

                        <div class="form-group" style="grid-column:1/-1">
                            <label class="form-label">Block</label>
                            <div class="eb-block-info" id="ebBlockInfo">—</div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Week (auto)</label>
                            <div class="eb-week-badge" id="ebWeekBadge">—</div>
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="ebStart">Start Date</label>
                            <input type="date" id="ebStart" class="filter-control" />
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="ebDuration">Duration (working days)</label>
                            <input type="number" id="ebDuration" class="filter-control" min="1" max="90" />
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="ebRemark">Remark</label>
                            <input type="text" id="ebRemark" class="filter-control" />
                        </div>

                    </div>
                    <div class="ab-preview" id="ebPreview" style="display:none">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"
                            style="width:13px;height:13px;flex-shrink:0">
                            <rect x="2" y="3" width="12" height="11" rx="2" />
                            <path d="M2 7h12M6 3V1M10 3V1" />
                        </svg>
                        Block will run: <strong id="ebPreviewText">—</strong>
                    </div>
                    <div class="ab-error" id="ebError" style="display:none"></div>
                </div>
                <div class="modal-footer" style="justify-content:flex-end">
                    <button class="btn btn-ghost" id="btnEditBlockCancel">Cancel</button>
                    <button class="btn btn-primary" id="btnEditBlockSave">Save Changes</button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════ GANTT SATURDAY CONFIRMATION MODAL -->
        <div class="modal-overlay" id="satModalOverlay" style="display:none" role="dialog" aria-modal="true">
            <div class="modal" style="max-width:400px">
                <div class="modal-header">
                    <h4 class="modal-title">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"
                            style="width:17px;height:17px;vertical-align:-3px;margin-right:8px">
                            <rect x="3" y="4" width="14" height="13" rx="2" />
                            <path d="M3 8h14M8 4V2M12 4V2" />
                        </svg>
                        Include Saturdays?
                    </h4>
                </div>
                <div class="modal-body" style="padding:20px 24px">
                    <p style="font-size:.9rem;color:var(--clr-text-muted);line-height:1.6">
                        One or more rescheduled dates land on a <strong
                            style="color:var(--clr-text)">Saturday</strong>.<br>
                        Should Saturday be counted as a working day for this move?
                    </p>
                    <p style="font-size:.78rem;color:var(--clr-text-dim);margin-top:10px">
                        Fridays are always skipped automatically.
                    </p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="satModalYes">Yes, include Saturday</button>
                    <button class="btn btn-ghost" id="satModalNo">No, skip Saturday</button>
                </div>
            </div>
        </div>

        <!-- ═══════════════════════════════════════════════ MARK COMPLETE MODAL -->
        <div class="modal-overlay" id="modalOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="modalTitle">
            <div class="modal">
                <div class="modal-header">
                    <h4 class="modal-title" id="modalTitle">Mark as Complete</h4>
                    <button class="modal-close" id="modalClose" aria-label="Close">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <div class="modal-info" id="modalInfo"></div>
                    <div class="form-group">
                        <label class="form-label" for="modalDate">Completion Date</label>
                        <input type="date" id="modalDate" class="filter-control" />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="modalNotes">Notes (optional)</label>
                        <textarea id="modalNotes" class="import-textarea" style="height:80px;"
                            placeholder="Enter any notes…"></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="modalConfirm">Confirm Complete</button>
                    <button class="btn btn-ghost" id="modalCancel">Cancel</button>
                </div>
            </div>
        </div>

        <div class="modal-overlay" id="kd2PlanningOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="kd2PlanningTitle">
            <div class="modal modal-wide">
                <div class="modal-header">
                    <h4 class="modal-title" id="kd2PlanningTitle">KD2 Planning Inputs</h4>
                    <button class="modal-close" id="kd2PlanningClose">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="kd2BattalionId" />
                    <div class="um-form-grid" style="grid-template-columns:1fr 1fr;gap:14px 18px">
                        <div class="form-group">
                            <label class="form-label" for="kd2BattalionCode">Battalion Code</label>
                            <input type="text" id="kd2BattalionCode" class="filter-control" placeholder="e.g. BTL-01" />
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="kd2BattalionName">Battalion Name</label>
                            <input type="text" id="kd2BattalionName" class="filter-control" placeholder="Optional descriptive name" />
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="kd2BattalionDeadline">Battalion Deadline</label>
                            <input type="date" id="kd2BattalionDeadline" class="filter-control" />
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="kd2BattalionNotes">Battalion Notes</label>
                            <input type="text" id="kd2BattalionNotes" class="filter-control" placeholder="Optional notes" />
                        </div>
                    </div>

                    <div class="kd2-editor-grid">
                        <div class="kd2-editor-card">
                            <h5 class="kd2-editor-title">K9</h5>
                            <div class="kd2-editor-fields">
                                <input type="number" min="0" id="kd2QtyK9" class="filter-control" placeholder="Quantity" />
                                <input type="date" id="kd2DeadlineK9" class="filter-control" />
                                <select id="kd2StatusK9" class="filter-control">
                                    <option value="pending">Pending</option>
                                    <option value="confirmed">Confirmed</option>
                                </select>
                                <label class="kd2-check"><input type="checkbox" id="kd2SkipFridayK9" checked /> Skip Friday</label>
                            </div>
                        </div>
                        <div class="kd2-editor-card">
                            <h5 class="kd2-editor-title">K10</h5>
                            <div class="kd2-editor-fields">
                                <input type="number" min="0" id="kd2QtyK10" class="filter-control" placeholder="Quantity" />
                                <input type="date" id="kd2DeadlineK10" class="filter-control" />
                                <select id="kd2StatusK10" class="filter-control">
                                    <option value="pending">Pending</option>
                                    <option value="confirmed">Confirmed</option>
                                </select>
                                <label class="kd2-check"><input type="checkbox" id="kd2SkipFridayK10" checked /> Skip Friday</label>
                            </div>
                        </div>
                        <div class="kd2-editor-card">
                            <h5 class="kd2-editor-title">K11</h5>
                            <div class="kd2-editor-fields">
                                <input type="number" min="0" id="kd2QtyK11" class="filter-control" placeholder="Quantity" />
                                <input type="date" id="kd2DeadlineK11" class="filter-control" />
                                <select id="kd2StatusK11" class="filter-control">
                                    <option value="pending">Pending</option>
                                    <option value="confirmed">Confirmed</option>
                                </select>
                                <label class="kd2-check"><input type="checkbox" id="kd2SkipFridayK11" checked /> Skip Friday</label>
                            </div>
                        </div>
                    </div>
                    <div class="ab-error" id="kd2PlanningError" style="display:none"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="btnKd2PlanningSave">Save Inputs</button>
                    <button class="btn btn-ghost" id="btnKd2PlanningCancel">Cancel</button>
                </div>
            </div>
        </div>

        <div class="modal-overlay" id="kd2PlanEditOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="kd2PlanEditTitle">
            <div class="modal kd2-modal-top" style="max-width:420px">
                <div class="modal-header">
                    <h4 class="modal-title" id="kd2PlanEditTitle">Edit KD2 Plan Block</h4>
                    <button class="modal-close" id="kd2PlanEditClose">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="kd2PlanEditId" />
                    <div class="modal-info" id="kd2PlanEditInfo">—</div>
                    <div class="form-group">
                        <label class="form-label" for="kd2PlanEditStart">Planned Start</label>
                        <input type="date" id="kd2PlanEditStart" class="filter-control" />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="kd2PlanEditEnd">Planned End</label>
                        <input type="date" id="kd2PlanEditEnd" class="filter-control" />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="kd2PlanEditRemark">Remark</label>
                        <input type="text" id="kd2PlanEditRemark" class="filter-control" placeholder="Optional note" />
                    </div>
                    <div class="ab-error" id="kd2PlanEditError" style="display:none"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-ghost btn-kd2-danger" id="btnKd2PlanDelete">Delete Block</button>
                    <button class="btn btn-primary" id="btnKd2PlanEditSave">Save Changes</button>
                    <button class="btn btn-ghost" id="btnKd2PlanEditCancel">Cancel</button>
                </div>
            </div>
        </div>

        <div class="modal-overlay" id="kd2PlanCreateOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="kd2PlanCreateTitle">
            <div class="modal kd2-plan-create-modal">
                <div class="modal-header">
                    <h4 class="modal-title" id="kd2PlanCreateTitle">Add KD2 Plan Block</h4>
                    <button class="modal-close" id="kd2PlanCreateClose">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <div class="kd2-modal-grid">
                        <div class="form-group" style="grid-column:1/-1" id="kd2PlanCreateModeGroup" data-kd2-plan-create-form>
                            <label class="form-label">Add Type</label>
                            <div class="kd2-create-mode-toggle" id="kd2PlanCreateModeToggle">
                                <button type="button" class="kd2-create-mode-btn active" data-mode="block">Block</button>
                                <button type="button" class="kd2-create-mode-btn" data-mode="template">Template</button>
                            </div>
                        </div>
                        <div class="kd2-plan-create-toolbar">
                            <div class="form-group" data-kd2-plan-create-form>
                                <label class="form-label" for="kd2PlanCreateBattalion">Battalion</label>
                                <select id="kd2PlanCreateBattalion" class="filter-control"></select>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="kd2PlanCreateVehicle">Vehicle</label>
                                <select id="kd2PlanCreateVehicle" class="filter-control">
                                    <option value="K9">K9</option>
                                    <option value="K10">K10</option>
                                    <option value="K11">K11</option>
                                </select>
                            </div>
                            <div class="form-group" data-kd2-plan-create-form>
                                <label class="form-label" for="kd2PlanCreateUnit">Unit</label>
                                <select id="kd2PlanCreateUnit" class="filter-control"></select>
                            </div>
                            <div class="form-group" data-kd2-plan-create-form>
                                <label class="form-label" for="kd2PlanCreateStart">Planned Start</label>
                                <input type="date" id="kd2PlanCreateStart" class="filter-control" />
                            </div>
                        </div>
                        <div class="form-group" style="grid-column:1/-1" data-kd2-plan-create-form>
                            <div class="kd2-form-label-row">
                                <label class="form-label" for="kd2PlanCreateStation">Process / Station</label>
                                <button class="btn btn-ghost btn-sm" type="button" id="btnKd2ManageProcessesInline">Manage Processes</button>
                            </div>
                            <select id="kd2PlanCreateStation" class="filter-control"></select>
                        </div>
                        <div class="form-group" style="grid-column:1/-1" data-kd2-plan-create-form>
                            <label class="form-label">Category</label>
                            <div class="modal-info" id="kd2PlanCreateCategory">Select a station to resolve the KD2 category.</div>
                        </div>
                        <div class="form-group" data-kd2-plan-create-form>
                            <label class="form-label" for="kd2PlanCreateDuration">Duration (working days)</label>
                            <input type="number" id="kd2PlanCreateDuration" class="filter-control" min="1" step="1" placeholder="Set default first" />
                        </div>
                        <div class="form-group" data-kd2-plan-create-form>
                            <label class="form-label" for="kd2PlanCreateEnd">Planned End</label>
                            <input type="date" id="kd2PlanCreateEnd" class="filter-control" />
                        </div>
                        <div class="form-group" style="grid-column:1/-1" data-kd2-plan-create-form>
                            <label class="form-label" for="kd2PlanCreateRemark">Remark <span class="form-label-optional">(optional)</span></label>
                            <input type="text" id="kd2PlanCreateRemark" class="filter-control" placeholder="Optional note" />
                        </div>
                        <div class="form-group kd2-template-editor-wrap" id="kd2TemplateEditorWrap" style="grid-column:1/-1;display:none">
                            <div class="kd2-template-editor-head">
                                <label class="form-label">Template Layout</label>
                                <div class="kd2-template-editor-actions">
                                    <div class="kd2-template-editor-view" id="kd2TemplateEditorViewToggle" aria-label="Template editor view">
                                        <button class="kd2-template-view-btn active" type="button" data-view="visual">Visual</button>
                                        <button class="kd2-template-view-btn" type="button" data-view="form">Form</button>
                                        <button class="kd2-template-view-btn" type="button" data-view="preview">Gantt</button>
                                    </div>
                                    <button class="btn btn-ghost btn-sm" type="button" id="btnKd2TemplateAddBlock">Add Item</button>
                                    <button class="btn btn-ghost btn-sm" type="button" id="btnKd2TemplateSave">Save Template</button>
                                </div>
                            </div>
                            <div class="modal-info" id="kd2TemplateEditorHint">Drag blocks and spaces to reorder the template. Hover between cards to insert a Process Block or Space.</div>
                            <div class="kd2-template-editor" id="kd2TemplateEditor"></div>
                        </div>
                    </div>
                    <div class="ab-error" id="kd2PlanCreateError" style="display:none"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="btnKd2PlanCreateSave">Add to KD2 Plan</button>
                    <button class="btn btn-ghost" id="btnKd2PlanCreateCancel">Cancel</button>
                </div>
            </div>
        </div>

        <div class="modal-overlay" id="kd2NoWorkOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="kd2NoWorkTitle">
            <div class="modal kd2-modal-top" style="max-width:640px">
                <div class="modal-header">
                    <h4 class="modal-title" id="kd2NoWorkTitle">KD2 No-work Days</h4>
                    <button class="modal-close" id="kd2NoWorkClose">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="kd2NoWorkIds" />
                    <div class="kd2-modal-grid">
                        <div class="form-group">
                            <label class="form-label" for="kd2NoWorkStart">Start Date</label>
                            <input type="date" id="kd2NoWorkStart" class="filter-control" />
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="kd2NoWorkEnd">End Date</label>
                            <input type="date" id="kd2NoWorkEnd" class="filter-control" />
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="kd2NoWorkLabel">Label <span class="form-label-optional">(optional)</span></label>
                            <input type="text" id="kd2NoWorkLabel" class="filter-control" placeholder="Optional reason" />
                        </div>
                        <div class="form-group">
                            <label class="form-label">Status</label>
                            <label class="form-check">
                                <input type="checkbox" id="kd2NoWorkActive" checked />
                                <span>Active (blocks scheduling)</span>
                            </label>
                        </div>
                    </div>
                    <div class="import-footer" style="margin-bottom:14px">
                        <button class="btn btn-primary" id="btnKd2NoWorkAdd">Add Range</button>
                        <button class="btn btn-ghost" id="btnKd2NoWorkCancelEdit" style="display:none">Cancel Edit</button>
                    </div>
                    <div class="ab-error" id="kd2NoWorkError" style="display:none"></div>
                    <div class="kd2-import-summary" id="kd2NoWorkSummary">KD2 no-work ranges block scheduling for the selected dates. Delete a range to re-enable those days.</div>
                    <div class="kd2-no-work-list" id="kd2NoWorkList"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-ghost" id="btnKd2NoWorkDone">Done</button>
                </div>
            </div>
        </div>

        <div class="modal-overlay" id="kd2LeadTimeOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="kd2LeadTimeTitle">
            <div class="modal modal-wide" style="max-width:980px">
                <div class="modal-header">
                    <h4 class="modal-title" id="kd2LeadTimeTitle">KD2 Lead Time Maintenance</h4>
                    <button class="modal-close" id="kd2LeadTimeClose">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <div class="modal-info" id="kd2LeadTimeSummary">Load a KD2 vehicle route to edit lead times.</div>
                    <div class="kd2-leadtime-shell" id="kd2LeadTimeBody"></div>
                    <div class="ab-error" id="kd2LeadTimeError" style="display:none"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="btnKd2LeadTimeSave">Save Lead Times</button>
                    <button class="btn btn-ghost" id="btnKd2LeadTimeCancel">Cancel</button>
                </div>
            </div>
        </div>

        <div class="modal-overlay" id="kd2ProcessOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="kd2ProcessTitle">
            <div class="modal modal-wide" style="max-width:1280px">
                <div class="modal-header">
                    <h4 class="modal-title" id="kd2ProcessTitle">KD2 Process Maintenance</h4>
                    <button class="modal-close" id="kd2ProcessClose">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <div class="modal-info" id="kd2ProcessSummary">Loading process stations…</div>
                    <div class="kd2-process-toolbar">
                        <div class="form-group">
                            <label class="form-label" for="kd2ProcessVehicleFilter">Vehicle</label>
                            <select id="kd2ProcessVehicleFilter" class="filter-control">
                                <option value="">All Vehicles</option>
                                <option value="K9">K9</option>
                                <option value="K10">K10</option>
                                <option value="K11">K11</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="kd2ProcessCategoryFilter">Category</label>
                            <select id="kd2ProcessCategoryFilter" class="filter-control">
                                <option value="">All Categories</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="kd2ProcessSearch">Search</label>
                            <input type="text" id="kd2ProcessSearch" class="filter-control" placeholder="Station name or code…" />
                        </div>
                        <button class="btn btn-primary btn-sm" type="button" id="btnKd2ProcessReset">+ New Process</button>
                    </div>
                    <div class="kd2-process-shell" id="kd2ProcessBody"></div>
                    <div class="ab-error" id="kd2ProcessError" style="display:none"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-ghost" id="btnKd2ProcessCancel">Done</button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════ PRODUCTION ISSUE MODAL -->
        <div class="modal-overlay" id="issueModalOverlay" style="display:none" role="dialog" aria-modal="true"
            aria-labelledby="issueModalTitle">
            <div class="modal issue-modal">
                <div class="modal-header">
                    <h4 class="modal-title" id="issueModalTitle">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"
                            style="width:18px;height:18px;vertical-align:-3px;margin-right:8px">
                            <path d="M10 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                        </svg>
                        <span id="issueModalTitleText">Report Issue</span>
                        <span class="issue-draft-status" id="issueDraftStatus" style="display:none"></span>
                    </h4>
                    <button class="modal-close" id="issueModalClose" aria-label="Close">&#x2715;</button>
                </div>
                <div class="modal-body issue-modal-body">
                    <!-- Read-only view panel (shown instead of form when view mode active) -->
                    <div id="issueViewBody" class="issue-view-body" style="display:none"></div>

                    <div class="issue-modal-grid">
                        <!-- ── Section: Basic Info ─────────────────────── -->
                        <div class="issue-form-section-label issue-form-full">Basic Information</div>

                        <!-- Title (full width) -->
                        <div class="form-group issue-form-full">
                            <label class="form-label" for="issueTitle">Title <span class="form-required">*</span></label>
                            <input type="text" id="issueTitle" class="issue-form-input" placeholder="Short description of the issue" />
                        </div>

                        <!-- Category / Priority / Status — 3 columns -->
                        <div class="form-group">
                            <label class="form-label" for="issueCategory">Category <span class="form-required">*</span></label>
                            <select id="issueCategory" class="issue-form-select">
                                <option value="">— Select —</option>
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
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="issuePriority">Priority</label>
                            <select id="issuePriority" class="issue-form-select">
                                <option value="low">Low</option>
                                <option value="medium" selected>Medium</option>
                                <option value="high">High</option>
                                <option value="critical">Critical</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="issueStatus">Status</label>
                            <select id="issueStatus" class="issue-form-select">
                                <option value="open" selected>Open</option>
                                <option value="in_progress">In Progress</option>
                                <option value="resolved">Resolved</option>
                                <option value="closed">Closed</option>
                            </select>
                        </div>

                        <!-- ── Section: Reporter (read-only strip) ──────── -->
                        <div class="issue-reporter-strip issue-form-full">
                            <span class="issue-reporter-strip-label">Reported by</span>
                            <span class="issue-reporter-strip-name" id="issueReporterName">—</span>
                            <span class="issue-reporter-strip-sep">·</span>
                            <span class="issue-reporter-strip-email" id="issueReporterEmail">—</span>
                            <!-- hidden fields to carry values to save logic -->
                            <input type="hidden" id="issueReporterNameHidden" />
                            <input type="hidden" id="issueReporterEmailHidden" />
                        </div>

                        <!-- Person In Charge (optional, full width) -->
                        <div class="form-group issue-form-full">
                            <label class="form-label" for="issuePIC">Person In Charge <span class="form-label-optional">(optional)</span></label>
                            <input type="text" id="issuePIC" class="issue-form-input" placeholder="Who is responsible for following up on this issue…" />
                        </div>

                        <!-- ── Section: Details ──────────────────────────── -->
                        <div class="issue-form-section-label issue-form-full">Details</div>

                        <!-- Description (full width) -->
                        <div class="form-group issue-form-full">
                            <label class="form-label" for="issueDescription">Description <span class="form-label-optional">(optional)</span></label>
                            <textarea id="issueDescription" class="issue-form-textarea" rows="3"
                                placeholder="Detailed description of the issue…"></textarea>
                        </div>

                        <!-- Proposed Solution (full width) -->
                        <div class="form-group issue-form-full">
                            <label class="form-label" for="issueProposedSolution">Proposed Solution <span class="form-label-optional">(optional)</span></label>
                            <textarea id="issueProposedSolution" class="issue-form-textarea" rows="2"
                                placeholder="Suggested fix or workaround…"></textarea>
                        </div>

                        <!-- Action Taken (full width) -->
                        <div class="form-group issue-form-full">
                            <label class="form-label" for="issueNotes">
                                Action Taken <span class="form-label-optional">(fill in once a resolution has been applied)</span>
                            </label>
                            <textarea id="issueNotes" class="issue-form-textarea" rows="2"
                                placeholder="Describe what was actually done to resolve or mitigate this issue…"></textarea>
                        </div>

                    </div>
                    <div class="ab-error" id="issueFormError" style="display:none"></div>
                </div>
                <div class="modal-footer" style="justify-content:space-between">
                    <div>
                        <button class="btn btn-ghost btn-kd2-danger" id="btnIssueDelete" style="display:none">Delete</button>
                    </div>
                    <div style="display:flex;gap:8px">
                        <button class="btn btn-ghost btn-sm" id="btnIssueEdit" style="display:none">Edit Issue</button>
                        <button class="btn btn-ghost" id="btnIssueCancel">Cancel</button>
                        <button class="btn btn-primary" id="btnIssueSave">Save Issue</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- ═══════════════════════════════════════════ ISSUE DRAFTS MODAL -->
        <div class="modal-overlay" id="issueDraftsModalOverlay" style="display:none" role="dialog" aria-modal="true"
            aria-labelledby="issueDraftsModalTitle">
            <div class="modal issue-drafts-modal">
                <div class="modal-header">
                    <h4 class="modal-title" id="issueDraftsModalTitle">Saved Drafts</h4>
                    <button class="modal-close" id="issueDraftsModalClose" aria-label="Close">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <p class="issue-drafts-hint">Drafts are saved automatically on this device as you type, even if
                        you close the tab by mistake. They aren't visible to anyone else until you report them.</p>
                    <div id="issueDraftsList" class="issue-drafts-list"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-ghost" id="issueDraftsModalCancel">Close</button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════ ISSUES REPORT MODAL -->
        <div class="modal-overlay" id="issueReportModalOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="issueReportModalTitle">
            <div class="modal report-modal issue-report-modal">
                <div class="modal-header">
                    <h4 class="modal-title" id="issueReportModalTitle">Generate Issues Report</h4>
                    <button class="modal-close" id="issueReportModalClose" aria-label="Close">&#x2715;</button>
                </div>
                <div class="modal-body">

                    <!-- ── Section 1: Report Type ─────────────────────── -->
                    <div class="issue-report-section">
                        <div class="issue-report-section-title">1. Report Type</div>
                        <div class="report-type-grid">
                            <label class="report-type-card">
                                <input type="radio" name="issueReportType" value="all" checked />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <rect x="3" y="3" width="18" height="18" rx="2" />
                                        <path d="M7 8h10M7 12h10M7 16h6" />
                                    </svg>
                                    <span class="rtc-label">All Issues</span>
                                    <span class="rtc-desc">Every issue matching the filters below</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="issueReportType" value="open" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                    </svg>
                                    <span class="rtc-label">Open</span>
                                    <span class="rtc-desc">Newly reported, not yet started</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="issueReportType" value="in_progress" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <circle cx="12" cy="12" r="9" />
                                        <path d="M12 7v5l3 3" />
                                    </svg>
                                    <span class="rtc-label">In Progress</span>
                                    <span class="rtc-desc">Currently being worked on</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="issueReportType" value="resolved" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <path d="M20 6L9 17l-5-5" />
                                    </svg>
                                    <span class="rtc-label">Resolved</span>
                                    <span class="rtc-desc">Fixed issues</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="issueReportType" value="closed" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <circle cx="12" cy="12" r="9" />
                                        <path d="M9 9l6 6M15 9l-6 6" />
                                    </svg>
                                    <span class="rtc-label">Closed</span>
                                    <span class="rtc-desc">Closed issues</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="issueReportType" value="by_category" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                                        <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                                    </svg>
                                    <span class="rtc-label">By Category</span>
                                    <span class="rtc-desc">All issues, grouped &amp; counted by category</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="issueReportType" value="status_report" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <rect x="3" y="4" width="18" height="18" rx="2" />
                                        <path d="M16 2v4M8 2v4M3 10h18M8 15h8" />
                                    </svg>
                                    <span class="rtc-label">Status Report</span>
                                    <span class="rtc-desc">All statuses by default, by category — Daily/Weekly/Monthly/All Time</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    <!-- ── Section 2: Scope & Timing ──────────────────── -->
                    <div class="issue-report-section">
                        <div class="issue-report-section-title">2. Scope &amp; Timing</div>

                        <div class="form-group">
                            <label class="form-label">Module Scope</label>
                            <div class="kd2-create-mode-toggle" id="issueReportModuleToggle">
                                <button type="button" class="kd2-create-mode-btn active" data-scope="current">Current Module</button>
                                <button type="button" class="kd2-create-mode-btn" data-scope="all">All Modules (F200-KD2 + F100-KD2)</button>
                            </div>
                        </div>

                        <!-- Period control — only shown for Status Report -->
                        <div class="form-group" id="issueReportPeriodGroup" style="display:none;margin-top:14px">
                            <label class="form-label">Period <span class="form-label-optional">(issues reported or resolved within this window — All Time shows everything)</span></label>
                            <div class="kd2-create-mode-toggle" id="issueReportPeriodToggle">
                                <button type="button" class="kd2-create-mode-btn" data-period="daily">Daily</button>
                                <button type="button" class="kd2-create-mode-btn" data-period="weekly">Weekly</button>
                                <button type="button" class="kd2-create-mode-btn" data-period="monthly">Monthly</button>
                                <button type="button" class="kd2-create-mode-btn active" data-period="all_time">All Time</button>
                            </div>
                        </div>

                        <!-- Layout control — only shown for Status Report; Report = one-page bullet
                             summary (PDF/Word only), Table = today's grid (all formats) -->
                        <div class="form-group" id="issueReportLayoutGroup" style="display:none;margin-top:14px">
                            <label class="form-label">Layout <span class="form-label-optional">(Report is a one-page bullet-point summary — PDF &amp; Word only; Excel always uses Table)</span></label>
                            <div class="kd2-create-mode-toggle" id="issueReportLayoutToggle">
                                <button type="button" class="kd2-create-mode-btn active" data-layout="table">Table</button>
                                <button type="button" class="kd2-create-mode-btn" data-layout="report">Report</button>
                            </div>
                        </div>

                        <!-- Date range — hidden for Status Report -->
                        <div class="form-group" id="issueReportDateGroup" style="margin-top:14px">
                            <label class="form-label">Date Range <span class="form-label-optional">(optional — filters
                                    by reported date)</span></label>
                            <div class="report-date-row">
                                <input type="date" id="issueReportDateFrom" class="filter-control" placeholder="From" />
                                <span class="report-date-sep">→</span>
                                <input type="date" id="issueReportDateTo" class="filter-control" placeholder="To" />
                            </div>
                        </div>
                    </div>

                    <!-- ── Section 3: Filters ─────────────────────────── -->
                    <div class="issue-report-section">
                        <div class="issue-report-section-title">3. Filters</div>

                        <!-- Simple category dropdown — used by every type except Status Report -->
                        <div class="form-group" id="issueReportCategorySimpleGroup">
                            <label class="form-label">Category <span
                                    class="form-label-optional">(optional)</span></label>
                            <select id="issueReportCategory" class="filter-control" style="max-width:260px">
                                <option value="">All Categories</option>
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
                        </div>

                        <!-- Priority / Reporter / Search — used by every type except Status Report -->
                        <div class="form-group" id="issueReportMoreFiltersGroup" style="display:flex;gap:14px;flex-wrap:wrap;margin-top:14px">
                            <div style="min-width:160px">
                                <label class="form-label">Priority <span class="form-label-optional">(optional)</span></label>
                                <select id="issueReportPriority" class="filter-control">
                                    <option value="">All Priorities</option>
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                    <option value="critical">Critical</option>
                                </select>
                            </div>
                            <div style="min-width:200px">
                                <label class="form-label">Reporter <span class="form-label-optional">(optional)</span></label>
                                <select id="issueReportReporter" class="filter-control">
                                    <option value="">All Reporters</option>
                                </select>
                            </div>
                            <div style="flex:1;min-width:200px">
                                <label class="form-label">Search <span class="form-label-optional">(title / description)</span></label>
                                <input type="text" id="issueReportSearch" class="filter-control" placeholder="Search…" autocomplete="off" />
                            </div>
                        </div>

                        <!-- Status Report checklists — statuses + categories, all checked by default -->
                        <div class="form-group" id="issueReportStatusChecklistGroup" style="display:none">
                            <div class="issue-report-checklist-head">
                                <label class="form-label">Include Statuses</label>
                                <div class="issue-report-checklist-actions">
                                    <button type="button" class="btn btn-ghost btn-sm" id="btnIssueReportStatusAll">All</button>
                                    <button type="button" class="btn btn-ghost btn-sm" id="btnIssueReportStatusNone">None</button>
                                </div>
                            </div>
                            <div class="issue-report-checklist" id="issueReportStatusChecklist">
                                <label class="issue-report-check-pill"><input type="checkbox" value="open" checked /> Open</label>
                                <label class="issue-report-check-pill"><input type="checkbox" value="in_progress" checked /> In Progress</label>
                                <label class="issue-report-check-pill"><input type="checkbox" value="resolved" checked /> Resolved</label>
                                <label class="issue-report-check-pill"><input type="checkbox" value="closed" checked /> Closed</label>
                            </div>
                        </div>

                        <div class="form-group" id="issueReportCategoryChecklistGroup" style="display:none">
                            <div class="issue-report-checklist-head">
                                <label class="form-label">Include Categories</label>
                                <div class="issue-report-checklist-actions">
                                    <button type="button" class="btn btn-ghost btn-sm" id="btnIssueReportCategoryAll">All</button>
                                    <button type="button" class="btn btn-ghost btn-sm" id="btnIssueReportCategoryNone">None</button>
                                </div>
                            </div>
                            <div class="issue-report-checklist" id="issueReportCategoryChecklist">
                                <label class="issue-report-check-pill"><input type="checkbox" value="cutting" checked /> Cutting</label>
                                <label class="issue-report-check-pill"><input type="checkbox" value="part_machining" checked /> Part Machining</label>
                                <label class="issue-report-check-pill"><input type="checkbox" value="welding" checked /> Welding</label>
                                <label class="issue-report-check-pill"><input type="checkbox" value="machining" checked /> Machining</label>
                                <label class="issue-report-check-pill"><input type="checkbox" value="accessories" checked /> Accessories</label>
                                <label class="issue-report-check-pill"><input type="checkbox" value="cables" checked /> Cables</label>
                                <label class="issue-report-check-pill"><input type="checkbox" value="material" checked /> Material</label>
                                <label class="issue-report-check-pill"><input type="checkbox" value="assembly" checked /> Assembly</label>
                                <label class="issue-report-check-pill"><input type="checkbox" value="quality" checked /> Quality</label>
                                <label class="issue-report-check-pill"><input type="checkbox" value="other" checked /> Other</label>
                            </div>
                        </div>
                    </div>

                    <!-- Preview badge -->
                    <div class="report-preview-bar" id="issueReportPreviewBar">
                        <span class="report-preview-count" id="issueReportPreviewCount">— issues match</span>
                        <span class="report-preview-hint">Select a type to preview count</span>
                    </div>

                </div>
                <div class="modal-footer">
                    <label class="report-preview-toggle">
                        <input type="checkbox" id="issueReportPreviewToggle" />
                        View before exporting
                    </label>
                    <button class="btn btn-report-pdf" id="btnIssueReportPDF">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 4h8l4 4v10H4V4z" />
                            <path d="M12 4v4h4" />
                            <path d="M7 13h6M7 10h3" />
                        </svg>
                        Export PDF
                    </button>
                    <button class="btn btn-report-excel" id="btnIssueReportExcel">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="3" width="16" height="14" rx="2" />
                            <path d="M6 7l3 3-3 3M11 13h4" />
                        </svg>
                        Export Excel
                    </button>
                    <button class="btn btn-ghost" id="btnIssueReportWord">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;vertical-align:-3px;margin-right:5px">
                            <rect x="2" y="3" width="16" height="14" rx="2" />
                            <path d="M5 8l1.3 6L8 10l1.7 4L11 8" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                        Export Word
                    </button>
                    <button class="btn btn-ghost" id="issueReportModalCancel">Cancel</button>
                </div>
            </div>
        </div>

        <!-- ═══════════════════════════════════ VPX GENERATE REPORT MODAL -->
        <div class="modal-overlay" id="vpxReportModalOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="vpxReportModalTitle">
            <div class="modal report-modal">
                <div class="modal-header">
                    <h4 class="modal-title" id="vpxReportModalTitle">Generate VPX Report</h4>
                    <button class="modal-close" id="vpxReportModalClose" aria-label="Close">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <div class="issue-report-section">
                        <div class="issue-report-section-title">1. Report Type</div>
                        <div class="report-type-grid">
                            <label class="report-type-card">
                                <input type="radio" name="vpxReportType" value="matrix" checked />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <rect x="3" y="3" width="18" height="18" rx="2" />
                                        <path d="M3 9h18M9 21V9" />
                                    </svg>
                                    <span class="rtc-label">Progress Matrix</span>
                                    <span class="rtc-desc">The on-screen matrix, exactly as currently filtered</span>
                                </div>
                            </label>
                            <label class="report-type-card">
                                <input type="radio" name="vpxReportType" value="station" />
                                <div class="rtc-inner">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                                        <rect x="3" y="4" width="18" height="18" rx="2" />
                                        <path d="M16 2v4M8 2v4M3 10h18M8 15h8" />
                                    </svg>
                                    <span class="rtc-label">Station Report</span>
                                    <span class="rtc-desc">Plan/Actual per station, with Delay &amp; projected completion</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    <div class="report-preview-bar" id="vpxReportPreviewBar">
                        <span class="report-preview-count">Scope: current vehicle-type &amp; category tab</span>
                        <span class="report-preview-hint" id="vpxReportScopeHint"></span>
                    </div>
                </div>
                <div class="modal-footer">
                    <label class="report-preview-toggle">
                        <input type="checkbox" id="vpxReportPreviewToggle" />
                        View before exporting
                    </label>
                    <button class="btn btn-report-pdf" id="btnVpxReportPDF">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 4h8l4 4v10H4V4z" />
                            <path d="M12 4v4h4" />
                            <path d="M7 13h6M7 10h3" />
                        </svg>
                        Export PDF
                    </button>
                    <button class="btn btn-report-excel" id="btnVpxReportExcel">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="3" width="16" height="14" rx="2" />
                            <path d="M6 7l3 3-3 3M11 13h4" />
                        </svg>
                        Export Excel
                    </button>
                    <button class="btn btn-ghost" id="vpxReportModalCancel">Cancel</button>
                </div>
            </div>
        </div>

        <!-- ═══════════════════════════════════ EXECUTIVE REPORT MODAL -->
        <div class="modal-overlay" id="execReportModalOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="execReportModalTitle">
            <div class="modal report-modal">
                <div class="modal-header">
                    <h4 class="modal-title" id="execReportModalTitle">Executive Report</h4>
                    <button class="modal-close" id="execReportModalClose" aria-label="Close">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <p class="exec-report-desc">
                        Combines the VPX Station Report for every vehicle and component — K9 (Hull, Turret,
                        Assembly), then K10 (Structure, Assembly), then K11 (Structure, Assembly) — followed by
                        the Production Issues Status Report (all time, every status and category), in one document.
                        You'll see a preview before anything downloads.
                    </p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-report-pdf" id="btnExecReportPDF">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 4h8l4 4v10H4V4z" />
                            <path d="M12 4v4h4" />
                            <path d="M7 13h6M7 10h3" />
                        </svg>
                        Preview PDF
                    </button>
                    <button class="btn btn-report-excel" id="btnExecReportExcel">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="3" width="16" height="14" rx="2" />
                            <path d="M6 7l3 3-3 3M11 13h4" />
                        </svg>
                        Preview Excel
                    </button>
                    <button class="btn btn-ghost" id="btnExecReportWord">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 3h9l3 3v11H4z" />
                            <path d="M13 3v3h3" />
                            <path d="M6.5 10l1 5 1.5-4 1.5 4 1-5" />
                        </svg>
                        Preview Word
                    </button>
                    <button class="btn btn-ghost" id="execReportModalCancel">Cancel</button>
                </div>
            </div>
        </div>

        <!-- ═══════════════════════════════════ VPX DELAY REASON MODAL -->
        <div class="modal-overlay" id="vpxDelayReasonModalOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="vpxDelayReasonModalTitle">
            <div class="modal">
                <div class="modal-header">
                    <h4 class="modal-title" id="vpxDelayReasonModalTitle">Delay Reason</h4>
                    <button class="modal-close" id="vpxDelayReasonModalClose" aria-label="Close">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label class="form-label">Main reason for this vehicle's delay
                            <span class="form-label-optional">(shown in the Station Report, after the Delay column)</span></label>
                        <textarea id="vpxDelayReasonText" class="issue-form-textarea" rows="4"
                            placeholder="e.g. Waiting on machining rework after a dimensional NCR…"></textarea>
                    </div>
                    <p class="vpx-delay-reason-hint" id="vpxDelayReasonViewerHint" style="display:none">
                        Only planners and admins can edit this.</p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-ghost" id="vpxDelayReasonCancel">Cancel</button>
                    <button class="btn btn-primary" id="vpxDelayReasonSave">Save</button>
                </div>
            </div>
        </div>

        <!-- ═══════════════════════════════════ X-RAY / REPAIR MODAL -->
        <div class="modal-overlay" id="xrayModalOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="xrayModalTitle">
            <div class="modal">
                <div class="modal-header">
                    <h4 class="modal-title" id="xrayModalTitle">X-ray / Repair</h4>
                    <button class="modal-close" id="xrayModalClose" aria-label="Close">&#x2715;</button>
                </div>
                <div class="modal-body">
                    <table class="xray-history-table">
                        <thead>
                            <tr><th>Cycle</th><th>X-ray Start</th><th>X-ray End</th><th>Result</th><th>Repair Start</th><th>Repair End</th><th></th></tr>
                        </thead>
                        <tbody id="xrayHistoryBody"></tbody>
                    </table>
                    <div class="xray-action-row" id="xrayActionRow"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-ghost" id="xrayModalCancel">Close</button>
                </div>
            </div>
        </div>

        <!-- ═══════════════════════════════════ GENERIC REPORT PREVIEW MODAL -->
        <div class="modal-overlay" id="genericPreviewModalOverlay" style="display:none;" role="dialog" aria-modal="true"
            aria-labelledby="genericPreviewModalTitle">
            <div class="modal report-preview-modal">
                <div class="modal-header">
                    <h4 class="modal-title" id="genericPreviewModalTitle">Preview</h4>
                    <button class="modal-close" id="genericPreviewModalClose" aria-label="Close">&#x2715;</button>
                </div>
                <div class="report-preview-tabs" id="genericPreviewTabs" hidden></div>
                <div class="modal-body report-preview-modal-body">
                    <iframe id="genericPreviewFrame" class="report-preview-frame" hidden></iframe>
                    <div id="genericPreviewHtml" class="report-preview-html" hidden></div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="genericPreviewDownload">Download</button>
                    <button class="btn btn-ghost" id="genericPreviewCancel">Close</button>
                </div>
            </div>
        </div>

    `.trim();
}


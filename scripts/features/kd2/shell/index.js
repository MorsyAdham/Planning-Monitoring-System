export function initFeature() {
    return `
        <section class="kd2-workspace-section" id="kd2WorkspaceSection" aria-label="KD2 Workspace" style="display:none">
            <div class="kd2-workspace-grid">
                <div class="kd2-card">
                    <div class="kd2-card-header">
                        <div>
                            <h3 class="kd2-card-title">Planning Inputs</h3>
                            <span class="kd2-card-subtitle">Battalion deadlines, quantities, and workday rules.</span>
                        </div>
                        <div class="kd2-card-actions">
                            <button class="btn btn-outline btn-sm" id="btnKd2RefreshInputs">Refresh</button>
                            <button class="btn btn-outline btn-sm" id="btnKd2Bootstrap">Bootstrap 5 Battalions</button>
                            <button class="btn btn-outline btn-sm" id="btnKd2NewBattalion">New Battalion</button>
                        </div>
                    </div>
                    <div class="kd2-table-wrap">
                        <table class="data-table kd2-mini-table">
                            <thead>
                                <tr>
                                    <th>Battalion</th>
                                    <th>Vehicle</th>
                                    <th>Qty</th>
                                    <th>Deadline</th>
                                    <th>Friday</th>
                                    <th>Saturday</th>
                                    <th>Status</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody id="kd2InputsBody">
                                <tr>
                                    <td colspan="8" class="table-empty">KD2 planning inputs will appear here.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="kd2-card">
                    <div class="kd2-card-header">
                        <div>
                            <h3 class="kd2-card-title">Plan Generation</h3>
                            <span class="kd2-card-subtitle">Create \`kd2_plan\` rows from planning inputs and route masters.</span>
                        </div>
                        <div class="kd2-card-actions">
                            <button class="btn btn-primary btn-sm" id="btnKd2GeneratePlan">Generate Battalion Plan</button>
                        </div>
                    </div>
                    <div class="kd2-status-list" id="kd2GenerationStatus">
                        <div class="kd2-status-item">
                            <span class="kd2-status-label">Current target</span>
                            <strong class="kd2-status-value" id="kd2GenerationTarget">Select a battalion filter to generate a plan.</strong>
                        </div>
                        <div class="kd2-status-item">
                            <span class="kd2-status-label">Generation rules</span>
                            <span class="kd2-status-copy">Uses stored battalion deadline or vehicle-level deadline, skips Friday when enabled, and only generates rows when all required lead times are confirmed.</span>
                        </div>
                        <div class="kd2-status-item">
                            <span class="kd2-status-label">Latest result</span>
                            <span class="kd2-status-copy" id="kd2GenerationResult">No KD2 generation run yet.</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="kd2-card">
                <div class="kd2-card-header">
                    <div>
                        <h3 class="kd2-card-title">Route / Process Flow</h3>
                        <span class="kd2-card-subtitle">Category and station visibility by vehicle type. Pending lead times can now be maintained in-app.</span>
                    </div>
                    <div class="kd2-card-actions">
                        <div class="kd2-vehicle-tabs" id="kd2RouteVehicleTabs">
                            <button class="btn btn-ghost btn-sm kd2-route-tab kd2-route-tab-active" data-vehicle="K9">K9</button>
                            <button class="btn btn-ghost btn-sm kd2-route-tab" data-vehicle="K10">K10</button>
                            <button class="btn btn-ghost btn-sm kd2-route-tab" data-vehicle="K11">K11</button>
                        </div>
                        <button class="btn btn-outline btn-sm" id="btnKd2ManageProcesses">Manage Processes</button>
                        <button class="btn btn-outline btn-sm" id="btnKd2ManageLeadTimes">Manage Lead Times</button>
                    </div>
                </div>
                <div id="kd2RouteFlow" class="kd2-route-flow">
                    <div class="empty-state"><p>Load KD2 data to inspect the route.</p></div>
                </div>
            </div>

            <div class="kd2-card">
                <div class="kd2-card-header">
                    <div>
                        <h3 class="kd2-card-title">KD2 Schedule Timeline</h3>
                        <span class="kd2-card-subtitle" id="kd2TimelineSubtitle">Manual and generated KD2 plan rows grouped by battalion and unit. Click a bar to manage one plan block.</span>
                    </div>
                    <div class="kd2-card-actions">
                        <div class="filter-item kd2-timeline-filter">
                            <label class="filter-label" for="kd2TimelineStart">From</label>
                            <input type="date" id="kd2TimelineStart" class="filter-control" />
                        </div>
                        <div class="filter-item kd2-timeline-filter">
                            <label class="filter-label" for="kd2TimelineEnd">To</label>
                            <input type="date" id="kd2TimelineEnd" class="filter-control" />
                        </div>
                        <button class="btn btn-primary btn-sm" id="btnKd2AddBlock">Add Plan Block</button>
                        <div class="kd2-visual-add-shell" id="kd2VisualAddShell">
                            <button class="btn btn-sm btn-visual-block" id="btnKd2VisualAdd" aria-expanded="false" aria-pressed="false">
                                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                                    <rect x="2" y="3" width="12" height="10" rx="2" />
                                    <path d="M8 5.5v5M5.5 8h5" />
                                </svg>
                                <span>Add Visual Block</span>
                            </button>
                            <div class="kd2-visual-add-menu" id="kd2TimelineVisualMenu" style="display:none">
                                <div class="kd2-visual-add-menu-head">
                                    <div>
                                        <strong>Visual Block Palette</strong>
                                        <span>Select one station, then click once on the target lane and date.</span>
                                    </div>
                                    <div class="filter-item kd2-timeline-filter">
                                        <label class="filter-label" for="kd2TimelinePlacementVehicle">Vehicle</label>
                                        <select id="kd2TimelinePlacementVehicle" class="filter-control">
                                            <option value="K9">K9</option>
                                            <option value="K10">K10</option>
                                            <option value="K11">K11</option>
                                        </select>
                                    </div>
                                    <div class="filter-item kd2-timeline-filter">
                                        <label class="filter-label" for="kd2TimelinePlacementFilter">Filter</label>
                                        <input id="kd2TimelinePlacementFilter" class="filter-control" type="text" placeholder="Hull, turret, assembly..." />
                                    </div>
                                </div>
                                <div class="kd2-timeline-placement-palette" id="kd2TimelineVisualPalette"></div>
                            </div>
                        </div>
                        <button class="btn btn-outline btn-sm" id="btnKd2TimelineRefresh">Refresh Timeline</button>
                        <div class="kd2-timeline-view-toggle" id="kd2TimelineViewToggle" aria-label="Timeline view mode">
                            <button class="btn btn-outline btn-sm kd2-timeline-view-btn kd2-timeline-view-btn-active" id="btnKd2TimelineViewUnit" type="button" data-view="unit">Unit View</button>
                            <button class="btn btn-outline btn-sm kd2-timeline-view-btn" id="btnKd2TimelineViewProcess" type="button" data-view="process">Process View</button>
                        </div>
                        <button class="btn btn-ghost btn-sm" id="btnKd2TimelineEdit">Edit Timeline</button>
                        <div class="kd2-timeline-editbar" id="kd2TimelineEditBar" style="display:none">
                            <button class="btn btn-outline btn-sm kd2-timeline-mode-btn kd2-timeline-mode-active" id="btnKd2TimelineModeBlock" data-mode="block">Block</button>
                            <button class="btn btn-outline btn-sm kd2-timeline-mode-btn" id="btnKd2TimelineModeFromBlock" data-mode="from-block">From Block</button>
                            <button class="btn btn-outline btn-sm kd2-timeline-mode-btn" id="btnKd2TimelineModeLane" data-mode="lane">Lane</button>
                            <button class="btn btn-outline btn-sm kd2-timeline-mode-btn" id="btnKd2TimelineSelectLane" data-mode="select-lane" aria-pressed="false">Select Lane</button>
                            <button class="btn btn-outline btn-sm" id="btnKd2NoWorkDays">No-work Days</button>
                            <span class="kd2-timeline-selection-count" id="kd2TimelineSelectionCount">0 selected</span>
                            <button class="btn btn-ghost btn-sm" id="btnKd2TimelineEditDone">Done</button>
                        </div>
                    </div>
                </div>
                <div class="kd2-timeline-shell">
                    <div class="kd2-inline-meta" id="kd2TimelineViewMeta">Unit view shows battalion / vehicle / unit lanes.</div>
                    <div class="kd2-timeline-placement-bar" id="kd2TimelinePlacementBar" style="display:none">
                        <div class="kd2-timeline-placement-head">
                            <div class="kd2-timeline-placement-copy">
                                <span class="kd2-timeline-placement-badge">Placement Mode</span>
                                <strong id="kd2TimelinePlacementSummary">Select a station block, then place it on a matching lane.</strong>
                                <span id="kd2TimelinePlacementHint">The selected station stays active until you change it or cancel placement mode.</span>
                            </div>
                            <div class="kd2-timeline-placement-actions">
                                <button class="btn btn-ghost btn-sm" id="btnKd2TimelinePlacementCancel">Cancel Placement</button>
                            </div>
                        </div>
                    </div>
                    <div class="kd2-timeline-legend" id="kd2TimelineLegend"></div>
                    <div class="kd2-timeline-wrap" id="kd2TimelineWrap">
                        <div class="empty-state"><p>Generate or load a KD2 plan to view the schedule.</p></div>
                    </div>
                </div>
            </div>
        </section>
`.trim();
}



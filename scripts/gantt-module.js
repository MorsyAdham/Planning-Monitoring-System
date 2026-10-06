(function () {
    'use strict';

    const DEFAULTS = {
        ariaLabel: 'Production Master Schedule',
        title: 'Production Master Schedule',
        subtitle: 'Assembly Plan · Daily Gantt View',
        emptyMessage: 'Apply filters to load data, then click Refresh to render the schedule.',
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function readOptions(source) {
        return {
            ariaLabel: source?.getAttribute?.('aria-label') || DEFAULTS.ariaLabel,
            title: source?.getAttribute?.('title') || DEFAULTS.title,
            subtitle: source?.getAttribute?.('subtitle') || DEFAULTS.subtitle,
            emptyMessage: source?.getAttribute?.('empty-message') || DEFAULTS.emptyMessage,
        };
    }

    function createMarkup(options = {}) {
        const settings = { ...DEFAULTS, ...options };
        return `
<section class="gantt-section" id="ganttSection" aria-label="${escapeHtml(settings.ariaLabel)}">
    <div class="gantt-card" id="ganttCard">
        <div class="gantt-card-header">
            <div class="gantt-title-wrap">
                <h3 class="gantt-title" id="ganttTitle">${escapeHtml(settings.title)}</h3>
                <span class="gantt-subtitle" id="ganttSubtitle">${escapeHtml(settings.subtitle)}</span>
                <div class="vpx-bat-picker gantt-bat-picker" id="ganttBattalionChips" hidden
                    title="Loads only the chosen battalion — the whole page (Gantt, Summary, VPX, Plan Table) follows it"></div>
            </div>
            <div class="gantt-controls">
                <div class="filter-item" style="min-width:148px">
                    <label class="filter-label" for="ganttStart">From</label>
                    <input type="date" id="ganttStart" class="filter-control" />
                </div>
                <div class="filter-item" style="min-width:148px">
                    <label class="filter-label" for="ganttEnd">To</label>
                    <input type="date" id="ganttEnd" class="filter-control" />
                </div>
                <div class="filter-item" style="padding-top:18px">
                    <button class="btn btn-primary" id="btnGanttRefresh">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 4v5h5M16 16v-5h-5" />
                            <path d="M4.05 9A8 8 0 1 1 4 11" />
                        </svg>
                        Refresh
                    </button>
                </div>
                <div class="filter-item" style="padding-top:18px">
                    <button class="btn-theme gantt-theme-btn" id="btnGanttTheme" title="Cycle theme" aria-label="Cycle theme">
                        <span id="ganttThemePickerIcon"></span>
                    </button>
                </div>
                <div class="filter-item gantt-export-schedule-wrap" style="padding-top:18px;position:relative">
                    <button class="btn btn-outline btn-sm" id="btnGanttExportSchedule" aria-haspopup="true" aria-expanded="false">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M4 15h12M10 3v9m-4-4 4 4 4-4"/>
                        </svg>
                        Export Schedule
                        <svg viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" style="width:8px;height:8px;margin-left:2px">
                            <path d="M1 1l4 4 4-4"/>
                        </svg>
                    </button>
                    <div class="gantt-export-menu" id="ganttExportMenu" role="menu" style="display:none">
                        <button type="button" class="gantt-export-opt" data-export-view="process" role="menuitem">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:11px;height:11px">
                                <path d="M2 4h10M2 7h10M2 10h10" stroke-dasharray="3 2"/>
                            </svg>
                            Process View
                        </button>
                        <button type="button" class="gantt-export-opt" data-export-view="process-combined" id="ganttExportCombinedOpt" role="menuitem" hidden
                            title="Process view with K10 and K11 as one plan — both vehicles' blocks on the same station rows">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:11px;height:11px">
                                <path d="M2 4h4M2 10h4M6 4c2 0 2 3 4 3M6 10c2 0 2-3 4-3M10 7h2"/>
                            </svg>
                            Process View · K10 + K11 together
                        </button>
                        <button type="button" class="gantt-export-opt" data-export-view="unit" role="menuitem">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:11px;height:11px">
                                <rect x="1" y="1" width="12" height="3" rx="1"/>
                                <rect x="1" y="5.5" width="12" height="3" rx="1"/>
                                <rect x="1" y="10" width="12" height="3" rx="1"/>
                            </svg>
                            Unit View
                        </button>
                    </div>
                </div>
                <div class="filter-item" style="padding-top:18px">
                    <button class="btn btn-outline gantt-fullscreen-btn" id="btnGanttFullscreen" aria-pressed="false">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M3 8V3h5" />
                            <path d="M17 8V3h-5" />
                            <path d="M3 12v5h5" />
                            <path d="M17 12v5h-5" />
                        </svg>
                        <span id="btnGanttFullscreenLabel">Full Screen</span>
                    </button>
                </div>
                <div class="filter-item" style="padding-top:18px">
                    <button class="btn btn-ghost gantt-legend-toggle-btn" id="btnGanttLegendToggle" aria-expanded="false">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M4 5h12" />
                            <path d="M4 10h12" />
                            <path d="M4 15h12" />
                        </svg>
                        <span id="btnGanttLegendToggleLabel">Show Legend</span>
                    </button>
                </div>
                <div class="filter-item" id="ganttViewToggleWrap" style="padding-top:18px;display:none">
                    <div class="gantt-view-row">
                    <div class="gantt-view-seg" id="ganttViewToggle" role="group" aria-label="Gantt view mode">
                        <button class="gantt-view-seg-btn" id="btnGanttViewUnit" type="button" data-view="unit">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:11px;height:11px">
                                <rect x="1" y="1" width="12" height="3" rx="1"/>
                                <rect x="1" y="5.5" width="12" height="3" rx="1"/>
                                <rect x="1" y="10" width="12" height="3" rx="1"/>
                            </svg>
                            Unit
                        </button>
                        <button class="gantt-view-seg-btn gantt-view-seg-active" id="btnGanttViewProcess" type="button" data-view="process">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:11px;height:11px">
                                <path d="M2 4h10M2 7h10M2 10h10" stroke-dasharray="3 2"/>
                            </svg>
                            Process
                        </button>
                    </div>
                    <button class="gantt-combine" id="btnGanttCombineK1011" type="button" role="switch" aria-checked="false" hidden
                        title="Show K10 and K11 as one plan — both vehicles' blocks on the same station rows">
                        <span class="gantt-combine-label"><b>K10</b><i>+</i><b>K11</b></span>
                        <span class="gantt-combine-switch" aria-hidden="true"></span>
                    </button>
                    </div>
                </div>
                <div class="filter-item" style="padding-top:18px">
                    <button class="btn btn-ghost gantt-edit-toggle" id="btnGanttEdit">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" />
                        </svg>
                        <span id="btnGanttEditLabel">Edit Plan</span>
                    </button>
                </div>
                <div class="gce-badge" id="ganttCoEditBadge" hidden></div>
                <div class="gantt-edit-bar" id="ganttEditBar" style="display:none">
                    <span class="gantt-edit-badge">
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" style="width:12px;height:12px">
                            <path d="M10 1.5l2.5 2.5L4 12.5H1.5V10L10 1.5z" />
                        </svg>
                        Editing plan
                    </span>

                    <div class="gantt-mode-seg" id="ganttModeSeg" role="tablist" aria-label="Edit task">
                        <button class="gms-btn gms-active" type="button" data-task="reschedule" role="tab" aria-selected="true">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:12px;height:12px"><path d="M2 9l4-4 3 3 3-5"/></svg>
                            Reschedule
                        </button>
                        <button class="gms-btn" type="button" data-task="add" role="tab" aria-selected="false">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:12px;height:12px"><path d="M7 2v10M2 7h10"/></svg>
                            Add work
                        </button>
                        <button class="gms-btn" type="button" data-task="reorder" id="gmsReorder" role="tab" aria-selected="false" style="display:none">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:12px;height:12px"><path d="M4 2v10M4 2 2 4.5M4 2l2 2.5M10 12V2M10 12l-2-2.5M10 12l2-2.5"/></svg>
                            Reorder route
                        </button>
                    </div>

                    <div class="gantt-ctx" id="ganttCtxReschedule">
                        <div class="gx-ctx-head">
                            <span class="gx-ctx-title">When you drag a block, move&hellip;</span>
                            <button class="gmt-btn gantt-ctx-standalone gx-select-lane" id="gmtSelectLane" aria-pressed="false" title="Adds a button on each row to select all of its blocks at once">Select lane</button>
                        </div>
                        <div class="gantt-move-toggle gmt-cards" id="ganttMoveToggle" title="Choose what moves when you drag a block">
                            <div class="gmt-card">
                                <span class="gmt-card-title">Block</span>
                                <div class="gmt-card-opts"><button class="gmt-btn gmt-active" id="gmtSingle" data-mode="single">Only this block</button></div>
                            </div>
                            <div class="gmt-card gmt-group">
                                <span class="gmt-card-title">This vehicle</span>
                                <div class="gmt-card-opts">
                                    <button class="gmt-btn" id="gmtFromBlock" data-mode="from-block" style="display:none" title="The rest of this line (e.g. Hull), then Assembly">From this process on</button>
                                    <button class="gmt-btn" id="gmtFromDate" data-mode="from-date" style="display:none" title="Every block of this vehicle starting on or after it — all lines">From this date on</button>
                                    <button class="gmt-btn" id="gmtLane" data-mode="lane">All processes</button>
                                </div>
                            </div>
                            <div class="gmt-card gmt-group" id="gmtGroupLine" style="display:none">
                                <span class="gmt-card-title">This component only</span>
                                <div class="gmt-card-opts">
                                    <button class="gmt-btn" id="gmtLineFrom" data-mode="line-from" title="This process and the later ones of the same component (Hull, Turret or Assembly) — nothing else moves">From this process on</button>
                                    <button class="gmt-btn" id="gmtLineAll" data-mode="line-all" title="Every block of this component on this vehicle — nothing else moves">Whole component</button>
                                </div>
                            </div>
                            <div class="gmt-card gmt-group" id="gmtGroupLater" style="display:none">
                                <span class="gmt-card-title">This + later vehicles</span>
                                <div class="gmt-card-opts">
                                    <button class="gmt-btn" id="gmtFromBlockAfter" data-mode="from-block-after">From this process on</button>
                                    <button class="gmt-btn" id="gmtUnitAfter" data-mode="unit-after">All processes</button>
                                </div>
                            </div>
                            <div class="gmt-card">
                                <span class="gmt-card-title">Station</span>
                                <div class="gmt-card-opts"><button class="gmt-btn" id="gmtFromBlockLane" data-mode="from-block-lane" style="display:none">This station's queue</button></div>
                            </div>
                            <div class="gmt-card">
                                <span class="gmt-card-title">Plan</span>
                                <div class="gmt-card-opts"><button class="gmt-btn" id="gmtPlan" data-mode="plan">Whole plan</button></div>
                            </div>
                        </div>
                        <div class="gx-hint"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="5.6"/><path d="M7 6.3v3.6M7 4.3v.1"/></svg><span class="gmt-hint" id="gmtHint" aria-live="polite"></span></div>
                    </div>

                    <div class="gantt-ctx" id="ganttCtxAdd" hidden>
                        <div class="gx-ctx-head"><span class="gx-ctx-title">Add work by&hellip;</span></div>
                        <div class="gx-add-row">
                            <div class="kd2-visual-add-shell" id="ganttVisualAddShell" style="display:none">
                                <button class="btn btn-sm btn-visual-block" id="btnGanttVisualAdd" aria-expanded="false" aria-pressed="false">
                                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M8 5.5v5M5.5 8h5" /></svg>
                                    <span>Click to place</span>
                                </button>
                                <button class="btn btn-sm btn-outline" id="btnF100AddTemplate" style="display:none">
                                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" style="width:13px;height:13px"><rect x="2" y="2" width="12" height="3" rx="1"/><rect x="2" y="6.5" width="12" height="3" rx="1"/><rect x="2" y="11" width="12" height="3" rx="1"/></svg>
                                    <span>Add Template</span>
                                </button>
                            </div>
                            <button class="btn btn-primary btn-sm" id="btnAddBlock" style="gap:5px">
                                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M7 2v10M2 7h10" /></svg>
                                Fill in a form
                            </button>
                            <button class="btn btn-outline btn-sm" id="btnGanttCopyPlan" type="button" style="display:none;gap:5px">
                                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:12px;height:12px"><rect x="1.5" y="3.5" width="7" height="8" rx="1.2"/><path d="M5.5 3.5V2.2c0-.4.3-.7.7-.7h5.6c.4 0 .7.3.7.7v6.6c0 .4-.3.7-.7.7H8.5"/></svg>
                                Copy a planned unit
                            </button>
                        </div>
                        <div class="gx-hint"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="5.6"/><path d="M7 6.3v3.6M7 4.3v.1"/></svg><span><b>Click to place</b> — pick a unit or station, then click a row and date &middot; <b>Fill in a form</b> — exact dates &middot; <b>Copy a planned unit</b> — a whole vehicle's sequence to other units</span></div>
                    </div>

                    <div class="gantt-ctx" id="ganttCtxReorder" hidden>
                        <div class="gx-ctx-head"><span class="gx-ctx-title" id="ganttReorderScope">Route order</span></div>
                        <div class="gx-hint"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="5.6"/><path d="M7 6.3v3.6M7 4.3v.1"/></svg><span>Use the arrows on each row &middot; &#8741; joins with the row above &middot; changes apply to this plan version</span></div>
                    </div>

                    <div class="gantt-coeditors" id="ganttCoEditors" hidden></div>

                    <div class="gantt-edit-spacer"></div>

                    <div class="gantt-edit-right">
                        <div class="gantt-undo-group">
                            <button class="btn btn-ghost btn-sm gantt-undo-btn" id="btnGanttUndo" disabled title="Nothing to undo">
                                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" style="width:12px;height:12px"><path d="M2 7a5 5 0 1 1 1.5 3.5" /><path d="M2 3.5V7h3.5" /></svg>
                                <span class="gx-btn-text">Undo</span>
                            </button>
                            <button class="btn btn-ghost btn-sm gantt-undo-btn" id="btnGanttRedo" disabled title="Nothing to redo">
                                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" style="width:12px;height:12px"><path d="M12 7a5 5 0 1 0-1.5 3.5" /><path d="M12 3.5V7H8.5" /></svg>
                                <span class="gx-btn-text">Redo</span>
                            </button>
                        </div>
                        <button class="btn btn-ghost btn-sm gantt-activity-btn" id="btnEditActivity" hidden aria-pressed="true" title="Show / hide the live edit feed">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:13px;height:13px"><path d="M1 7h2.5l1.5-4 2 8 1.5-4H13"/></svg>
                            <span class="gantt-activity-count" id="editActivityCount"></span>
                        </button>
                        <div class="gantt-opt-wrap">
                            <button class="btn btn-ghost btn-sm gantt-opt-btn" id="btnGanttOptions" aria-expanded="false" title="Options — Saturdays, no-work days">
                                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" style="width:13px;height:13px"><circle cx="7" cy="7" r="2.2"/><path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M11.2 2.8 9.8 4.2M4.2 9.8 2.8 11.2"/></svg>
                                <span class="gx-btn-text">Options</span>
                            </button>
                            <div class="gantt-opt-popover" id="ganttOptionsPopover" hidden>
                                <label class="gantt-edit-sat-toggle" id="ganttSatToggleWrap">
                                    <input type="checkbox" id="ganttSatToggle" />
                                    Include Saturdays
                                </label>
                                <button class="btn btn-ghost btn-sm" id="btnGanttNoWorkDays">No-work Days</button>
                            </div>
                        </div>
                        <button class="btn btn-primary btn-sm" id="btnGanttEditDone">Done</button>
                    </div>

                    <div class="gantt-sel-strip" id="ganttSelStrip" hidden>
                        <span class="gantt-sel-count"><b id="ganttSelectedCount">0</b> <span id="ganttSelectedNoun">blocks</span> selected</span>
                        <button class="btn btn-ghost btn-sm" id="btnGanttClearSel">Clear</button>
                        <div class="gantt-edit-spacer"></div>
                        <button class="btn btn-ghost btn-sm gantt-sel-del" id="btnDeleteSelectedBlocks" disabled>
                            Delete selected
                        </button>
                    </div>
                </div>
                <div class="gantt-visual-placement-bar" id="ganttVisualPlacementBar" style="display:none">
                    <div class="kd2-visual-add-menu" id="ganttVisualAddMenu">
                        <div class="gantt-visual-placement-head">
                            <div class="gantt-visual-placement-copy">
                                <span class="gantt-visual-placement-badge">Visual Placement</span>
                                <strong id="ganttVisualPlacementSummary">Select a station block, then click once on the target lane and date.</strong>
                                <span id="ganttVisualPlacementHint">The selected station stays active until you change it or cancel placement mode.</span>
                            </div>
                            <div class="gantt-visual-placement-actions">
                                <div class="filter-item kd2-timeline-filter">
                                    <label class="filter-label" for="ganttVisualPlacementVehicle">Vehicle</label>
                                    <select id="ganttVisualPlacementVehicle" class="filter-control">
                                        <option value="K9">K9</option>
                                        <option value="K10">K10</option>
                                        <option value="K11">K11</option>
                                    </select>
                                </div>
                                <div class="filter-item kd2-timeline-filter" id="ganttVisualPlacementBattalionGroup">
                                    <label class="filter-label" for="ganttVisualPlacementBattalion">Battalion</label>
                                    <select id="ganttVisualPlacementBattalion" class="filter-control">
                                        <option value="">All battalions</option>
                                    </select>
                                </div>
                                <div class="filter-item kd2-timeline-filter">
                                    <label class="filter-label" for="ganttVisualPlacementFilter">Filter</label>
                                    <input id="ganttVisualPlacementFilter" class="filter-control" type="text" placeholder="Hull, turret, assembly..." />
                                </div>
                                <button class="btn btn-ghost btn-sm" id="btnGanttVisualPlacementCancel">Cancel Placement</button>
                            </div>
                        </div>
                        <div class="kd2-timeline-placement-palette" id="ganttVisualPalette"></div>
                    </div>
                </div>
            </div>
        </div>
        <div class="gantt-legend" id="ganttLegend"></div>
        <div class="gantt-status-key" id="ganttStatusKey" aria-label="Block status key">
            <span class="gsk-title">Status</span>
            <span class="gsk-item"><span class="gc-bar-st gc-st-complete">✓</span>Completed</span>
            <span class="gsk-item"><span class="gc-bar-st gc-st-early">✓</span>Completed early</span>
            <span class="gsk-item"><span class="gc-bar-st gc-st-late-complete">✓</span>Completed late</span>
            <span class="gsk-item"><span class="gc-bar-st gc-st-progress">▶</span>In progress</span>
            <span class="gsk-item"><span class="gc-bar-st gc-st-late">!</span>Overdue <em>(striped)</em></span>
            <span class="gsk-item"><span class="gsk-planned"></span>Planned</span>
        </div>
        <div class="gantt-zone-key" id="ganttZoneKey" style="display:none">
            <span class="gantt-zone-key-item gantt-zone-key-holiday">
                <span class="gantt-zone-key-swatch"></span>Holiday
            </span>
            <span class="gantt-zone-key-item gantt-zone-key-fat">
                <span class="gantt-zone-key-swatch"></span>FAT Period
            </span>
        </div>
        <div class="gantt-scroll-root" id="ganttScrollRoot">
            <div id="ganttInner">
                <div class="gantt-empty-state" id="ganttInitEmpty">
                    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="6" y="6" width="36" height="36" rx="4" />
                        <path d="M14 18h20M14 26h12M14 34h8" />
                    </svg>
                    <p>${escapeHtml(settings.emptyMessage)}</p>
                </div>
            </div>
        </div>
    </div>
</section>`.trim();
    }

    function mount(target, options = {}) {
        const host = typeof target === 'string' ? document.querySelector(target) : target;
        if (!host) throw new Error('PPMSGanttModule mount target was not found.');
        host.innerHTML = createMarkup(options);
        return host.querySelector('#ganttSection');
    }

    class PPMSGanttModuleElement extends HTMLElement {
        connectedCallback() {
            if (this.dataset.ppmsGanttMounted === 'true') return;

            const existingSection = document.getElementById('ganttSection');
            if (existingSection && !this.contains(existingSection)) {
                console.warn('PPMSGanttModule: a gantt section is already mounted on this page. Skipping duplicate mount.');
                return;
            }

            this.innerHTML = createMarkup(readOptions(this));
            this.dataset.ppmsGanttMounted = 'true';
        }
    }

    if (!window.PPMSGanttModule) {
        window.PPMSGanttModule = {
            createMarkup,
            mount,
        };
    }

    if (!window.customElements.get('ppms-gantt-module')) {
        window.customElements.define('ppms-gantt-module', PPMSGanttModuleElement);
    }
})();

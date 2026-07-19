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
                    <div class="gantt-view-seg" id="ganttViewToggle" role="group" aria-label="Gantt view mode">
                        <button class="gantt-view-seg-btn gantt-view-seg-active" id="btnGanttViewUnit" type="button" data-view="unit">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:11px;height:11px">
                                <rect x="1" y="1" width="12" height="3" rx="1"/>
                                <rect x="1" y="5.5" width="12" height="3" rx="1"/>
                                <rect x="1" y="10" width="12" height="3" rx="1"/>
                            </svg>
                            Unit
                        </button>
                        <button class="gantt-view-seg-btn" id="btnGanttViewProcess" type="button" data-view="process">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" style="width:11px;height:11px">
                                <path d="M2 4h10M2 7h10M2 10h10" stroke-dasharray="3 2"/>
                            </svg>
                            Process
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
                <div class="gantt-edit-bar" id="ganttEditBar" style="display:none">
                    <span class="gantt-edit-badge">
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" style="width:12px;height:12px">
                            <path d="M10 1.5l2.5 2.5L4 12.5H1.5V10L10 1.5z" />
                        </svg>
                        EDIT MODE
                    </span>
                    <div class="gantt-move-toggle" id="ganttMoveToggle" title="Choose what gets moved when dragging">
                        <button class="gmt-btn gmt-active" id="gmtSingle" data-mode="single">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" style="width:11px;height:11px">
                                <rect x="1" y="4" width="12" height="6" rx="1.5" />
                            </svg>
                            Block
                        </button>
                        <button class="gmt-btn" id="gmtLane" data-mode="lane">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" style="width:11px;height:11px">
                                <rect x="1" y="2" width="12" height="4" rx="1" />
                                <rect x="1" y="8" width="12" height="4" rx="1" />
                            </svg>
                            Lane
                        </button>
                        <button class="gmt-btn" id="gmtFromBlock" data-mode="from-block" style="display:none">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" style="width:11px;height:11px">
                                <rect x="1" y="2" width="6" height="4" rx="1" />
                                <rect x="7" y="2" width="6" height="4" rx="1" opacity=".45" />
                                <rect x="7" y="8" width="6" height="4" rx="1" />
                            </svg>
                            From Block
                        </button>
                        <button class="gmt-btn" id="gmtPlan" data-mode="plan">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" style="width:11px;height:11px">
                                <rect x="1" y="1" width="12" height="3" rx="1" />
                                <rect x="1" y="5.5" width="12" height="3" rx="1" />
                                <rect x="1" y="10" width="12" height="3" rx="1" />
                            </svg>
                            Full Plan
                        </button>
                    </div>
                    <div class="gantt-kd2-edit-tools" id="ganttKd2EditTools" style="display:none">
                        <button class="gmt-btn" id="gmtSelectLane" aria-pressed="false">Select Lane</button>
                        <button class="btn btn-ghost btn-sm" id="btnGanttNoWorkDays">No-work Days</button>
                    </div>
                    <button class="btn btn-primary btn-sm" id="btnAddBlock" style="gap:5px">
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">
                            <path d="M7 2v10M2 7h10" />
                        </svg>
                        Add Block
                    </button>
                    <div class="kd2-visual-add-shell" id="ganttVisualAddShell" style="display:none">
                        <button class="btn btn-sm btn-visual-block" id="btnGanttVisualAdd" aria-expanded="false" aria-pressed="false">
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
                                <rect x="2" y="3" width="12" height="10" rx="2" />
                                <path d="M8 5.5v5M5.5 8h5" />
                            </svg>
                            <span>Add Visual Block</span>
                        </button>
                        <button class="btn btn-sm btn-outline" id="btnF100AddTemplate" style="display:none">
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" style="width:13px;height:13px">
                                <rect x="2" y="2" width="12" height="3" rx="1"/>
                                <rect x="2" y="6.5" width="12" height="3" rx="1"/>
                                <rect x="2" y="11" width="12" height="3" rx="1"/>
                            </svg>
                            <span>Add Template</span>
                        </button>
                    </div>
                    <button class="btn btn-ghost btn-sm" id="btnDeleteSelectedBlocks" disabled>
                        Delete Selected <span id="ganttSelectedCount">0</span>
                    </button>
                    <label class="gantt-edit-sat-toggle" id="ganttSatToggleWrap">
                        <input type="checkbox" id="ganttSatToggle" />
                        Include Saturdays
                    </label>
                    <div class="gantt-undo-group">
                        <button class="btn btn-ghost btn-sm gantt-undo-btn" id="btnGanttUndo" disabled title="Nothing to undo">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" style="width:12px;height:12px">
                                <path d="M2 7a5 5 0 1 1 1.5 3.5" />
                                <path d="M2 3.5V7h3.5" />
                            </svg>
                            Undo
                        </button>
                        <button class="btn btn-ghost btn-sm gantt-undo-btn" id="btnGanttRedo" disabled title="Nothing to redo">
                            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" style="width:12px;height:12px">
                                <path d="M12 7a5 5 0 1 0-1.5 3.5" />
                                <path d="M12 3.5V7H8.5" />
                            </svg>
                            Redo
                        </button>
                    </div>
                    <button class="btn btn-ghost btn-sm" id="btnGanttEditDone">Done</button>
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

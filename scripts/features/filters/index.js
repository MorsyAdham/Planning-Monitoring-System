const ICONS = {
    filter: '<path d="M3 5h18M6 12h12M10 19h4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>',
    report: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
};
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

/** One multi-select filter (ids are used by app.js — keep them). */
const ms = (group, label, key, { hidden = false, labelId = '' } = {}) => `
                <div class="filter-item fx-item" id="${group}"${hidden ? ' style="display:none;"' : ''}>
                    <label class="filter-label"${labelId ? ` id="${labelId}"` : ''}>${label}</label>
                    <div class="ms-filter" id="${key}Wrap">
                        <button type="button" class="ms-trigger filter-control" id="${key}Btn">All</button>
                        <div class="ms-menu" id="${key}Menu" hidden></div>
                    </div>
                </div>`;

export function initFeature() {
    return `
        <!-- ═══════════════════════════════════════════════ FILTER BAR -->
        <section class="filter-section fx-panel" id="overviewSegment" aria-label="Filters">
            <header class="fx-head">
                <div class="fx-title">
                    <span class="fx-title-icon">${svg(ICONS.filter)}</span>
                    <span>Filters</span>
                    <span class="fx-count" id="fxActiveCount" hidden>0 active</span>
                </div>
                <div class="fx-chips" id="fxChips" aria-label="Active filters"></div>
                <div class="fx-head-actions">
                    <div class="filter-item filter-actions">
                        <button class="fx-btn fx-btn--ghost" id="btnReset" title="Clear every filter">${svg(ICONS.reset)}<span>Reset</span></button>
                    </div>
                    <div class="filter-item filter-exec-report-item">
                        <button type="button" class="fx-btn fx-btn--primary btn-exec-report" id="btnExecReport" title="Executive Report — combined VPX Station Report + Issues Status Report">
                            ${svg(ICONS.report)}<span>Executive Report</span>
                        </button>
                    </div>
                </div>
            </header>

            <div class="filter-grid fx-grid">
                <!-- ── F200 standard filters (hidden when F100-KD2 active) ─────── -->
                ${ms('filterVehicleGroup', 'Vehicle', 'filterVehicle')}
                ${ms('filterK9ComponentGroup', 'K9 Component', 'filterK9Component', { hidden: true })}
                ${ms('filterBattalionGroup', 'Battalion', 'filterBattalion', { hidden: true })}
                ${ms('filterUnitGroup', 'Unit', 'filterUnit', { labelId: 'filterUnitLabel' })}
                ${ms('filterCategoryGroup', 'Category', 'filterCategory')}
                ${ms('filterWeekGroup', 'Week', 'filterWeek')}

                <!-- ── F100-KD2 filters (shown only when F100-KD2 active) ────────── -->
                ${ms('f100BattalionGroup', 'Battalion', 'f100Battalion', { hidden: true })}
                <div class="filter-item fx-item" id="f100ModeGroup" style="display:none;">
                    <label class="filter-label" for="f100Mode">Mode</label>
                    <select id="f100Mode" class="filter-control">
                        <option value="gun" selected>Gun Parts</option>
                        <option value="vehicle">Vehicle Parts</option>
                    </select>
                </div>
                ${ms('f100GunPartGroup', 'Gun Part', 'f100GunPart', { hidden: true })}
                ${ms('f100SerialGroup', 'Unit', 'f100Serial', { hidden: true })}
                ${ms('f100ManufacturerGroup', 'Manufacturer', 'f100Manufacturer', { hidden: true })}
                ${ms('f100VehicleTypeGroup', 'Vehicle', 'f100VehicleType', { hidden: true })}
                <div class="filter-item fx-item" id="f100ManageProcessesGroup" style="display:none;">
                    <label class="filter-label">&nbsp;</label>
                    <button class="btn btn-outline btn-sm" id="btnF100ManageProcesses">Manage Parts &amp; Processes</button>
                </div>

                <div class="filter-item fx-item fx-item--time" id="filterTimeFrameGroup">
                    <label class="filter-label" for="filterTimeFrame">Time frame</label>
                    <!-- The select stays the source of truth for app.js; the pills drive it. -->
                    <select id="filterTimeFrame" class="filter-control fx-time-select" aria-hidden="true" tabindex="-1">
                        <option value="all">All Time</option>
                        <option value="day">Today</option>
                        <option value="week">This Week</option>
                        <option value="month">This Month</option>
                        <option value="custom">Custom Range</option>
                    </select>
                    <div class="fx-seg" id="fxTimeSeg" role="radiogroup" aria-label="Time frame">
                        <button type="button" class="fx-seg-btn is-active" data-tf="all" role="radio" aria-checked="true">All time</button>
                        <button type="button" class="fx-seg-btn" data-tf="day" role="radio" aria-checked="false">Today</button>
                        <button type="button" class="fx-seg-btn" data-tf="week" role="radio" aria-checked="false">This week</button>
                        <button type="button" class="fx-seg-btn" data-tf="month" role="radio" aria-checked="false">This month</button>
                        <button type="button" class="fx-seg-btn" data-tf="custom" role="radio" aria-checked="false">Custom</button>
                    </div>
                </div>
                <div class="filter-item fx-item fx-item--date" id="customDateStart" style="display:none;">
                    <label class="filter-label" for="filterStartDate">From</label>
                    <input type="date" id="filterStartDate" class="filter-control" />
                </div>
                <div class="filter-item fx-item fx-item--date" id="customDateEnd" style="display:none;">
                    <label class="filter-label" for="filterEndDate">To</label>
                    <input type="date" id="filterEndDate" class="filter-control" />
                </div>
                <div class="filter-item fx-item fx-item--search" id="filterSearchGroup">
                    <label class="filter-label" for="filterSearch">Search</label>
                    <div class="fx-search">
                        ${svg(ICONS.search)}
                        <input type="text" id="filterSearch" class="filter-control" placeholder="Station, unit, code…" autocomplete="off" />
                    </div>
                </div>
            </div>
        </section>
`.trim();
}

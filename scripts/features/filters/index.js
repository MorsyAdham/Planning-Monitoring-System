export function initFeature() {
    return `
        <!-- ═══════════════════════════════════════════════ FILTER BAR -->
        <section class="filter-section" aria-label="Filters">
            <div class="filter-grid">
                <!-- ── F200 standard filters (hidden when F100-KD2 active) ─────── -->
                <div class="filter-item" id="filterVehicleGroup">
                    <label class="filter-label">Vehicle</label>
                    <div class="ms-filter" id="filterVehicleWrap">
                        <button type="button" class="ms-trigger filter-control" id="filterVehicleBtn">All</button>
                        <div class="ms-menu" id="filterVehicleMenu" hidden></div>
                    </div>
                </div>
                <div class="filter-item" id="filterK9ComponentGroup" style="display:none;">
                    <label class="filter-label">K9 Component</label>
                    <div class="ms-filter" id="filterK9ComponentWrap">
                        <button type="button" class="ms-trigger filter-control" id="filterK9ComponentBtn">All</button>
                        <div class="ms-menu" id="filterK9ComponentMenu" hidden></div>
                    </div>
                </div>
                <div class="filter-item" id="filterBattalionGroup" style="display:none;">
                    <label class="filter-label">Battalion</label>
                    <div class="ms-filter" id="filterBattalionWrap">
                        <button type="button" class="ms-trigger filter-control" id="filterBattalionBtn">All</button>
                        <div class="ms-menu" id="filterBattalionMenu" hidden></div>
                    </div>
                </div>
                <div class="filter-item" id="filterUnitGroup">
                    <label class="filter-label" id="filterUnitLabel">Unit</label>
                    <div class="ms-filter" id="filterUnitWrap">
                        <button type="button" class="ms-trigger filter-control" id="filterUnitBtn">All</button>
                        <div class="ms-menu" id="filterUnitMenu" hidden></div>
                    </div>
                </div>
                <div class="filter-item" id="filterCategoryGroup">
                    <label class="filter-label">Category</label>
                    <div class="ms-filter" id="filterCategoryWrap">
                        <button type="button" class="ms-trigger filter-control" id="filterCategoryBtn">All</button>
                        <div class="ms-menu" id="filterCategoryMenu" hidden></div>
                    </div>
                </div>
                <div class="filter-item" id="filterWeekGroup">
                    <label class="filter-label">Week</label>
                    <div class="ms-filter" id="filterWeekWrap">
                        <button type="button" class="ms-trigger filter-control" id="filterWeekBtn">All</button>
                        <div class="ms-menu" id="filterWeekMenu" hidden></div>
                    </div>
                </div>
                <div class="filter-item" id="filterTimeFrameGroup">
                    <label class="filter-label" for="filterTimeFrame">Time Frame</label>
                    <select id="filterTimeFrame" class="filter-control">
                        <option value="all">All Time</option>
                        <option value="day">Today</option>
                        <option value="week">This Week</option>
                        <option value="month">This Month</option>
                        <option value="custom">Custom Range</option>
                    </select>
                </div>
                <div class="filter-item" id="customDateStart" style="display:none;">
                    <label class="filter-label" for="filterStartDate">Start Date</label>
                    <input type="date" id="filterStartDate" class="filter-control" />
                </div>
                <div class="filter-item" id="customDateEnd" style="display:none;">
                    <label class="filter-label" for="filterEndDate">End Date</label>
                    <input type="date" id="filterEndDate" class="filter-control" />
                </div>
                <div class="filter-item" id="filterSearchGroup">
                    <label class="filter-label" for="filterSearch">Search</label>
                    <input type="text" id="filterSearch" class="filter-control" placeholder="Search..." autocomplete="off" />
                </div>

                <!-- ── F100-KD2 filters (shown only when F100-KD2 active) ────────── -->
                <div class="filter-item" id="f100BattalionGroup" style="display:none;">
                    <label class="filter-label">Battalion</label>
                    <div class="ms-filter" id="f100BattalionWrap">
                        <button type="button" class="ms-trigger filter-control" id="f100BattalionBtn">All</button>
                        <div class="ms-menu" id="f100BattalionMenu" hidden></div>
                    </div>
                </div>
                <div class="filter-item" id="f100ModeGroup" style="display:none;">
                    <label class="filter-label" for="f100Mode">Mode</label>
                    <select id="f100Mode" class="filter-control">
                        <option value="gun" selected>Gun Parts</option>
                        <option value="vehicle">Vehicle Parts</option>
                    </select>
                </div>
                <div class="filter-item" id="f100GunPartGroup" style="display:none;">
                    <label class="filter-label">Gun Part</label>
                    <div class="ms-filter" id="f100GunPartWrap">
                        <button type="button" class="ms-trigger filter-control" id="f100GunPartBtn">All</button>
                        <div class="ms-menu" id="f100GunPartMenu" hidden></div>
                    </div>
                </div>
                <div class="filter-item" id="f100SerialGroup" style="display:none;">
                    <label class="filter-label">Unit</label>
                    <div class="ms-filter" id="f100SerialWrap">
                        <button type="button" class="ms-trigger filter-control" id="f100SerialBtn">All</button>
                        <div class="ms-menu" id="f100SerialMenu" hidden></div>
                    </div>
                </div>
                <div class="filter-item" id="f100ManufacturerGroup" style="display:none;">
                    <label class="filter-label">Manufacturer</label>
                    <div class="ms-filter" id="f100ManufacturerWrap">
                        <button type="button" class="ms-trigger filter-control" id="f100ManufacturerBtn">All</button>
                        <div class="ms-menu" id="f100ManufacturerMenu" hidden></div>
                    </div>
                </div>
                <div class="filter-item" id="f100VehicleTypeGroup" style="display:none;">
                    <label class="filter-label">Vehicle</label>
                    <div class="ms-filter" id="f100VehicleTypeWrap">
                        <button type="button" class="ms-trigger filter-control" id="f100VehicleTypeBtn">All</button>
                        <div class="ms-menu" id="f100VehicleTypeMenu" hidden></div>
                    </div>
                </div>

                <div class="filter-item filter-actions">
                    <button class="btn btn-ghost" id="btnReset">Reset</button>
                </div>

                <div class="filter-item filter-exec-report-item">
                    <button type="button" class="btn-exec-report" id="btnExecReport" title="Executive Report — combined VPX Station Report + Issues Status Report">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 3h9l3 3v11H4z" />
                            <path d="M13 3v3h3" />
                            <path d="M7 10h6M7 13h6M7 16h3" />
                        </svg>
                        Executive Report
                    </button>
                </div>
            </div>
        </section>
`.trim();
}


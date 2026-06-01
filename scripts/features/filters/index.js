export function initFeature() {
    return `
        <!-- ═══════════════════════════════════════════════ FILTER BAR -->
        <section class="filter-section" aria-label="Filters">
            <div class="filter-grid">
                <!-- ── F200 standard filters (hidden when F100-KD2 active) ─────── -->
                <div class="filter-item" id="filterVehicleGroup">
                    <label class="filter-label" for="filterVehicle">Vehicle</label>
                    <select id="filterVehicle" class="filter-control">
                        <option value="">All Vehicles</option>
                    </select>
                </div>
                <div class="filter-item" id="filterK9ComponentGroup" style="display:none;">
                    <label class="filter-label" for="filterK9Component">K9 Component</label>
                    <select id="filterK9Component" class="filter-control">
                        <option value="">All Components</option>
                        <option value="Hull">Hull</option>
                        <option value="Turret">Turret</option>
                    </select>
                </div>
                <div class="filter-item" id="filterBattalionGroup" style="display:none;">
                    <label class="filter-label" for="filterBattalion">Battalion</label>
                    <select id="filterBattalion" class="filter-control">
                        <option value="">All Battalions</option>
                    </select>
                </div>
                <div class="filter-item" id="filterUnitGroup">
                    <label class="filter-label" for="filterUnit" id="filterUnitLabel">Unit</label>
                    <select id="filterUnit" class="filter-control">
                        <option value="">All Units</option>
                    </select>
                </div>
                <div class="filter-item" id="filterCategoryGroup">
                    <label class="filter-label" for="filterCategory">Category</label>
                    <select id="filterCategory" class="filter-control">
                        <option value="">All Categories</option>
                        <option value="Assembly">Assembly</option>
                        <option value="Final Test">Final Test</option>
                        <option value="Processing">Processing</option>
                    </select>
                </div>
                <div class="filter-item" id="filterWeekGroup">
                    <label class="filter-label" for="filterWeek">Week</label>
                    <select id="filterWeek" class="filter-control">
                        <option value="">All Weeks</option>
                    </select>
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

                <!-- ── F100-KD2 filters (shown only when F100-KD2 active) ────────── -->
                <div class="filter-item" id="f100BattalionGroup" style="display:none;">
                    <label class="filter-label" for="f100Battalion">Battalion</label>
                    <select id="f100Battalion" class="filter-control">
                        <option value="">All Battalions</option>
                    </select>
                </div>
                <div class="filter-item" id="f100ModeGroup" style="display:none;">
                    <label class="filter-label" for="f100Mode">Mode</label>
                    <select id="f100Mode" class="filter-control">
                        <option value="gun" selected>Gun Parts</option>
                        <option value="vehicle">Vehicle Parts</option>
                    </select>
                </div>
                <div class="filter-item" id="f100GunPartGroup" style="display:none;">
                    <label class="filter-label" for="f100GunPart">Gun Part</label>
                    <select id="f100GunPart" class="filter-control">
                        <option value="">All Parts</option>
                    </select>
                </div>
                <div class="filter-item" id="f100SerialGroup" style="display:none;">
                    <label class="filter-label" for="f100Serial">Unit</label>
                    <select id="f100Serial" class="filter-control">
                        <option value="">All Units</option>
                    </select>
                </div>
                <div class="filter-item" id="f100ManufacturerGroup" style="display:none;">
                    <label class="filter-label" for="f100Manufacturer">Manufacturer</label>
                    <select id="f100Manufacturer" class="filter-control">
                        <option value="">All</option>
                        <option value="HAS">HAS</option>
                        <option value="DOOWON">DOOWON</option>
                    </select>
                </div>
                <div class="filter-item" id="f100VehicleTypeGroup" style="display:none;">
                    <label class="filter-label" for="f100VehicleType">Vehicle</label>
                    <select id="f100VehicleType" class="filter-control">
                        <option value="">All Vehicles</option>
                        <option value="K9">K9</option>
                        <option value="K10">K10</option>
                        <option value="K11">K11</option>
                    </select>
                </div>

                <div class="filter-item filter-actions">
                    <button class="btn btn-primary" id="btnApply">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 5h14M6 10h8M9 15h2" />
                        </svg>
                        Apply Filters
                    </button>
                    <button class="btn btn-ghost" id="btnReset">Reset</button>
                </div>
            </div>
        </section>
`.trim();
}



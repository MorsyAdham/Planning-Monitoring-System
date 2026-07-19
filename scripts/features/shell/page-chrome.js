export function renderPageChrome() {
    return `
    <!-- ══════════════════════════ SCROLL-TO-TOP (fixed, bottom-right) -->
    <button class="scroll-top-btn" id="scrollTopBtn" aria-label="Back to top" title="Back to top" style="display:none">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 16V4M4 10l6-6 6 6"/>
        </svg>
    </button>

    <!-- ═══════════════════════════════════════════════════ HEADER -->
    <header class="site-header">
        <div class="header-inner">
            <!-- Brand -->
            <div class="header-brand">
                <div class="brand-badge" id="moduleBadge">KD1</div>
                <div class="brand-text">
                    <span class="brand-title" id="brandTitle">PPMS</span>
                    <span class="brand-sub" id="brandSubtitle">Production Planning &amp; Monitoring</span>
                </div>
            </div>

            <!-- Centre nav -->
            <nav class="section-nav" id="sectionNav" aria-label="Page sections">
                <a class="section-nav-link" href="#summarySection"  data-target="summarySection">Overview</a>
                <a class="section-nav-link" href="#ganttNavAnchor" data-target="ganttNavAnchor">Schedule</a>
                <a class="section-nav-link" href="#vpxSection"     data-target="vpxSection">Progress</a>
                <a class="section-nav-link" href="#chartsSection"  data-target="chartsSection">Analytics</a>
                <a class="section-nav-link" href="#tableSection"   data-target="tableSection">Plan Table</a>
                <a class="section-nav-link" href="#issuesSection"  data-target="issuesSection">Issues</a>
            </nav>

            <!-- Right-side controls (left→right = module, theme, notif, more, time, conn, user, logout) -->
            <div class="header-meta">
                <!-- Module selector -->
                <div class="module-switch">
                    <select id="moduleSelector" class="filter-control module-switch-control" aria-label="Module" title="Module">
                        <option value="kd1">F200 – KD1</option>
                        <option value="kd2">F200 – KD2</option>
                        <option value="f100kd2">F100 – KD2</option>
                    </select>
                </div>

                <div class="header-meta-sep"></div>

                <!-- Notification bell -->
                <div class="f100-notif-wrap" id="f100NotifWrap" style="display:none">
                    <button class="btn-nav-icon f100-notif-bell" id="f100NotifBell" title="Notifications">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M10 2a6 6 0 00-6 6v3l-1.5 2.5h15L16 11V8a6 6 0 00-6-6z"/>
                            <path d="M8.5 17a1.5 1.5 0 003 0"/>
                        </svg>
                        <span class="f100-notif-badge" id="f100NotifBadge" style="display:none">0</span>
                    </button>
                </div>

                <!-- Active Users (master_admin only — inline next to bell) -->
                <div class="active-users-wrap" id="activeUsersWrap" style="display:none">
                    <button class="btn-nav-icon active-users-btn" id="activeUsersBtn" title="Active Users">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                            <circle cx="7" cy="8" r="3"/>
                            <path d="M1 18c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
                            <path d="M14 6a2.5 2.5 0 1 1 0 5"/>
                            <path d="M20 18c0-2.8-2.2-5-5-5"/>
                        </svg>
                        <span class="active-users-badge" id="activeUsersCount">1</span>
                    </button>
                </div>

                <!-- ── Theme picker (standalone, outside the More menu) ── -->
                <div class="theme-picker-wrap" id="themePickerWrap">
                    <button class="btn-nav-icon" id="btnThemePicker" title="Theme" aria-haspopup="true" aria-expanded="false">
                        <span id="themePickerIcon"></span>
                    </button>
                    <div class="theme-picker-dropdown" id="themePickerDropdown" style="display:none" role="menu"></div>
                </div>

                <!-- ── More menu (collapsible) ── -->
                <div class="nav-more-wrap" id="navMoreWrap">
                    <button class="btn-nav-icon" id="btnNavMore" title="More options" aria-haspopup="true" aria-expanded="false">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                            <path d="M3 5h14M3 10h14M3 15h14"/>
                        </svg>
                    </button>
                    <div class="nav-more-dropdown" id="navMoreDropdown" style="display:none" role="menu">
                        <!-- Audit Log (master_admin only) -->
                        <button class="nav-more-btn" id="btnAuditLog" role="menuitem" style="display:none">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                                <path d="M4 4h12v2H4zM4 8h12v2H4zM4 12h8v2H4z" />
                                <circle cx="15" cy="13" r="3.5" />
                                <path d="M17 15l1.5 1.5" />
                            </svg>
                            <span>Audit Log</span>
                        </button>
                        <!-- Unit Codes (admin+) -->
                        <button class="nav-more-btn" id="btnUnitCodes" role="menuitem" style="display:none">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                                <rect x="2" y="4" width="16" height="12" rx="2" />
                                <path d="M6 8h8M6 12h5" />
                            </svg>
                            <span>Unit Codes</span>
                        </button>
                        <!-- User Management (master_admin only) -->
                        <button class="nav-more-btn" id="btnUserMgmt" role="menuitem" style="display:none">
                            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                                <circle cx="8" cy="7" r="3" />
                                <path d="M2 18c0-3.3 2.7-6 6-6s6 2.7 6 6" />
                                <path d="M15 9l2 2 3-3" />
                            </svg>
                            <span>User Management</span>
                        </button>
                    </div>
                </div>

                <div class="header-meta-sep"></div>

                <!-- Clock + Date (compact) -->
                <div class="header-clock-date">
                    <div class="header-clock" id="headerClock">--:--:--</div>
                    <div class="header-date" id="headerDate">--</div>
                </div>

                <!-- Connection indicator -->
                <div class="conn-indicator" id="connIndicator">
                    <span class="conn-dot"></span>
                    <span class="conn-label">Connecting…</span>
                </div>

                <div class="header-meta-sep"></div>

                <!-- User chip -->
                <div class="nav-user-chip" id="navUserChip" style="display:none">
                    <div class="nav-user-avatar" id="navUserAvatar">?</div>
                    <div class="nav-user-info">
                        <span class="nav-user-name" id="navUserName">—</span>
                        <span class="nav-role-badge" id="navRoleBadge">—</span>
                    </div>
                </div>

                <!-- Logout -->
                <button class="btn-nav-icon btn-logout" id="btnLogout" title="Sign Out" style="display:none">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M7 3H4a1 1 0 00-1 1v12a1 1 0 001 1h3M13 14l3-4-3-4M16 10H7" />
                    </svg>
                </button>
            </div>
        </div>

    </header>

    <main class="page-main">
`.trim();
}

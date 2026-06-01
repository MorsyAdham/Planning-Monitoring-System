export function renderPageChrome() {
    return `
    <!-- ═══════════════════════════════════════════════════ HEADER -->
    <header class="site-header">
        <div class="header-inner">
            <div class="header-brand">
                <div class="brand-badge" id="moduleBadge">KD1</div>
                <div class="brand-text">
                    <span class="brand-title" id="brandTitle">Production Planning & Monitoring Control</span>
                    <span class="brand-sub" id="brandSubtitle">Plan vs Actual Tracking System</span>
                </div>
            </div>
            <div class="header-meta">
                <div class="module-switch">
                    <select id="moduleSelector" class="filter-control module-switch-control" aria-label="Module"
                        title="Module">
                        <option value="kd1">F200 – KD1</option>
                        <option value="kd2">F200 – KD2</option>
                        <option value="f100kd2">F100 – KD2</option>
                    </select>
                </div>
                <!-- Theme toggle -->
                <button class="btn-theme" id="btnTheme" title="Toggle light / dark theme">
                    <!-- Sun — shown in dark mode -->
                    <svg class="icon-sun" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                        <circle cx="10" cy="10" r="4" />
                        <path
                            d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
                    </svg>
                    <!-- Moon — shown in light mode -->
                    <svg class="icon-moon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M17.5 12A7.5 7.5 0 018 2.5a7.5 7.5 0 100 15 7.5 7.5 0 009.5-5.5z" />
                    </svg>
                </button>
                <div class="header-clock" id="headerClock">--:--:--</div>
                <div class="header-date" id="headerDate">--</div>
                <div class="conn-indicator" id="connIndicator">
                    <span class="conn-dot"></span>
                    <span class="conn-label">Connecting…</span>
                </div>
                <!-- ── Active Users (master_admin only) ── -->
                <div class="active-users-wrap" id="activeUsersWrap" style="display:none">
                    <button class="btn-nav-icon active-users-btn" id="activeUsersBtn" title="Active users on system">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                            <circle cx="7" cy="8" r="3"/>
                            <path d="M1 18c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
                            <path d="M14 6a2.5 2.5 0 1 1 0 5"/>
                            <path d="M20 18c0-2.8-2.2-5-5-5"/>
                        </svg>
                        <span class="active-users-badge" id="activeUsersCount">1</span>
                    </button>
                </div>
                <!-- ── F100 Comment Notifications ── -->
                <div class="f100-notif-wrap" id="f100NotifWrap" style="display:none">
                    <button class="btn-nav-icon f100-notif-bell" id="f100NotifBell" title="Comment notifications">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M10 2a6 6 0 00-6 6v3l-1.5 2.5h15L16 11V8a6 6 0 00-6-6z"/>
                            <path d="M8.5 17a1.5 1.5 0 003 0"/>
                        </svg>
                        <span class="f100-notif-badge" id="f100NotifBadge" style="display:none">0</span>
                    </button>
                </div>
                <!-- ── Audit Log button (master_admin only) ── -->
                <button class="btn-nav-icon" id="btnAuditLog" title="Audit Log" style="display:none">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M4 4h12v2H4zM4 8h12v2H4zM4 12h8v2H4z" />
                        <circle cx="15" cy="13" r="3.5" />
                        <path d="M17 15l1.5 1.5" />
                    </svg>
                </button>
                <!-- ── Unit Codes button (admin+) ── -->
                <button class="btn-nav-icon" id="btnUnitCodes" title="Unit Codes" style="display:none">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"
                        style="width:18px;height:18px">
                        <rect x="2" y="4" width="16" height="12" rx="2" />
                        <path d="M6 8h8M6 12h5" />
                    </svg>
                </button>
                <!-- ── User Management button (master_admin only) ── -->
                <button class="btn-nav-icon" id="btnUserMgmt" title="User Management" style="display:none">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                        <circle cx="8" cy="7" r="3" />
                        <path d="M2 18c0-3.3 2.7-6 6-6s6 2.7 6 6" />
                        <path d="M15 9l2 2 3-3" />
                    </svg>
                </button>
                <!-- ── Session info ── -->
                <div class="nav-user-chip" id="navUserChip" style="display:none">
                    <div class="nav-user-avatar" id="navUserAvatar">?</div>
                    <div class="nav-user-info">
                        <span class="nav-user-name" id="navUserName">—</span>
                        <span class="nav-role-badge" id="navRoleBadge">—</span>
                    </div>
                </div>
                <!-- ── Logout ── -->
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


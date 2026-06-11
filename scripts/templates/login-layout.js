export function renderLoginLayout() {
    return `
<div class="lp-root">

    <!-- ══════════════════════════════ LEFT HERO -->
    <div class="lp-hero">

        <!-- Atmospheric glows -->
        <div class="lp-hero-bg">
            <div class="lp-glow lp-glow-a"></div>
            <div class="lp-glow lp-glow-b"></div>
            <div class="lp-glow lp-glow-c"></div>
        </div>

        <!-- Scan line sweep -->
        <div class="lp-scan" aria-hidden="true"></div>

        <!-- Floating particles -->
        <div class="lp-particles" aria-hidden="true">
            <i style="--x:7%;  --y:17%; --s:3px; --d:5.2s; --dl:0s"></i>
            <i style="--x:21%; --y:71%; --s:2px; --d:7.1s; --dl:1.6s"></i>
            <i style="--x:79%; --y:21%; --s:4px; --d:5.8s; --dl:0.4s"></i>
            <i style="--x:54%; --y:84%; --s:2px; --d:8.3s; --dl:2.1s"></i>
            <i style="--x:89%; --y:57%; --s:3px; --d:6.4s; --dl:1.1s"></i>
            <i style="--x:37%; --y:7%;  --s:2px; --d:9.0s; --dl:3.2s"></i>
            <i style="--x:13%; --y:91%; --s:4px; --d:6.9s; --dl:2.7s"></i>
            <i style="--x:66%; --y:44%; --s:3px; --d:7.6s; --dl:0.9s"></i>
            <i style="--x:46%; --y:34%; --s:2px; --d:8.8s; --dl:1.4s"></i>
        </div>

        <!-- Decorative rings (bottom-right) -->
        <svg class="lp-rings" viewBox="0 0 560 560" fill="none" aria-hidden="true">
            <circle cx="460" cy="460" r="420" stroke="rgba(79,142,247,.045)" stroke-width="1"/>
            <circle cx="460" cy="460" r="310" stroke="rgba(79,142,247,.06)"  stroke-width="1"/>
            <circle cx="460" cy="460" r="210" stroke="rgba(79,142,247,.08)"  stroke-width="1"/>
            <circle cx="460" cy="460" r="120" stroke="rgba(79,142,247,.1)"   stroke-width="1.5"/>
            <circle cx="460" cy="460" r="44"  stroke="rgba(79,142,247,.16)"  stroke-width="1.5"/>
            <circle cx="460" cy="460" r="8"   fill="rgba(79,142,247,.22)"/>
            <line x1="0"   y1="0"   x2="560" y2="560" stroke="rgba(79,142,247,.03)" stroke-width="1" stroke-dasharray="5 10"/>
            <line x1="560" y1="0"   x2="0"   y2="560" stroke="rgba(79,142,247,.03)" stroke-width="1" stroke-dasharray="5 10"/>
        </svg>

        <!-- Corner brackets -->
        <svg class="lp-corner lp-corner-tl" viewBox="0 0 44 44" fill="none" aria-hidden="true">
            <path d="M0 44V6A6 6 0 0 1 6 0h38" stroke="rgba(79,142,247,.38)" stroke-width="1.5"/>
        </svg>
        <svg class="lp-corner lp-corner-br" viewBox="0 0 44 44" fill="none" aria-hidden="true">
            <path d="M44 0v38a6 6 0 0 1-6 6H0" stroke="rgba(79,142,247,.38)" stroke-width="1.5"/>
        </svg>

        <!-- ── Content ── -->
        <div class="lp-hero-content">

            <div class="lp-hero-top">
                <div class="lp-hero-badge">PPMS</div>
                <span class="lp-hero-ver">F200 · F100</span>
            </div>

            <h1 class="lp-hero-title">Production<br>Planning &amp;<br>Monitoring</h1>

            <p class="lp-hero-desc">
                End-to-end production schedule control — from raw-material allocation to final delivery. Plan, track, and resolve issues across all modules in real time.
            </p>

            <!-- Animated workflow diagram -->
            <div class="lp-flow-wrap">
                <svg class="lp-flow-svg" viewBox="0 0 320 88" fill="none" aria-hidden="true">
                    <!-- Nodes -->
                    <rect x="4"   y="29" width="58" height="28" rx="5" stroke="rgba(79,142,247,.32)" stroke-width="1" fill="rgba(79,142,247,.07)"/>
                    <text x="33"  y="47" text-anchor="middle" font-size="7.5" fill="rgba(140,185,255,.82)" font-family="Inter,sans-serif" font-weight="600" letter-spacing="0.06em">PLAN</text>

                    <rect x="84"  y="29" width="58" height="28" rx="5" stroke="rgba(79,142,247,.32)" stroke-width="1" fill="rgba(79,142,247,.07)"/>
                    <text x="113" y="47" text-anchor="middle" font-size="7.5" fill="rgba(140,185,255,.82)" font-family="Inter,sans-serif" font-weight="600" letter-spacing="0.06em">SCHEDULE</text>

                    <rect x="164" y="29" width="58" height="28" rx="5" stroke="rgba(79,142,247,.32)" stroke-width="1" fill="rgba(79,142,247,.07)"/>
                    <text x="193" y="47" text-anchor="middle" font-size="7.5" fill="rgba(140,185,255,.82)" font-family="Inter,sans-serif" font-weight="600" letter-spacing="0.06em">TRACK</text>

                    <rect x="244" y="29" width="68" height="28" rx="5" stroke="rgba(34,197,94,.32)" stroke-width="1" fill="rgba(34,197,94,.07)"/>
                    <text x="278" y="47" text-anchor="middle" font-size="7.5" fill="rgba(100,225,140,.82)" font-family="Inter,sans-serif" font-weight="600" letter-spacing="0.06em">DELIVER</text>

                    <!-- Animated connecting lines -->
                    <path d="M62 43 H84"  stroke="rgba(79,142,247,.45)" stroke-width="1.5" stroke-dasharray="4 3" class="lp-fl"/>
                    <path d="M142 43 H164" stroke="rgba(79,142,247,.45)" stroke-width="1.5" stroke-dasharray="4 3" class="lp-fl lp-fl-d1"/>
                    <path d="M222 43 H244" stroke="rgba(79,142,247,.45)" stroke-width="1.5" stroke-dasharray="4 3" class="lp-fl lp-fl-d2"/>

                    <!-- Arrowheads -->
                    <path d="M82 40l3 3-3 3"  stroke="rgba(79,142,247,.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M162 40l3 3-3 3" stroke="rgba(79,142,247,.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M242 40l3 3-3 3" stroke="rgba(79,142,247,.5)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>

                    <!-- Progress bars -->
                    <rect x="4"   y="62" width="58" height="3" rx="1.5" fill="rgba(79,142,247,.1)"/>
                    <rect x="4"   y="62" width="58" height="3" rx="1.5" fill="rgba(79,142,247,.62)"/>

                    <rect x="84"  y="62" width="58" height="3" rx="1.5" fill="rgba(79,142,247,.1)"/>
                    <rect x="84"  y="62" width="44" height="3" rx="1.5" fill="rgba(79,142,247,.62)"/>

                    <rect x="164" y="62" width="58" height="3" rx="1.5" fill="rgba(79,142,247,.1)"/>
                    <rect x="164" y="62" width="24" height="3" rx="1.5" fill="rgba(79,142,247,.62)"/>

                    <rect x="244" y="62" width="68" height="3" rx="1.5" fill="rgba(34,197,94,.1)"/>
                    <rect x="244" y="62" width="68" height="3" rx="1.5" fill="rgba(34,197,94,.62)"/>
                </svg>
            </div>

            <!-- Features -->
            <div class="lp-features">
                <div class="lp-feature">
                    <svg class="lp-feat-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="1" y="3" width="16" height="12" rx="2"/><path d="M5 7h4M5 10h3" stroke-linecap="round"/><rect x="10" y="7" width="4" height="2" rx="1" fill="currentColor" stroke="none"/></svg>
                    <div><div class="lp-feat-name">Production Schedule</div><div class="lp-feat-sub">Gantt-based timeline planning &amp; tracking</div></div>
                </div>
                <div class="lp-feature">
                    <svg class="lp-feat-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="7"/><path d="M9 5v4l3 2" stroke-linecap="round"/></svg>
                    <div><div class="lp-feat-name">Progress Monitoring</div><div class="lp-feat-sub">Real-time VPX progress &amp; completion rates</div></div>
                </div>
                <div class="lp-feature">
                    <svg class="lp-feat-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="6" r="3"/><path d="M1 16c0-3 2.7-5 6-5s6 2 6 5"/><path d="M13 5l1.5 1.5L17 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    <div><div class="lp-feat-name">Issues Tracker</div><div class="lp-feat-sub">Log, assign and resolve production problems</div></div>
                </div>
                <div class="lp-feature">
                    <svg class="lp-feat-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 13l4-5 4 2 4-8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="2" r="1.5" fill="currentColor" stroke="none"/></svg>
                    <div><div class="lp-feat-name">Analytics &amp; Reports</div><div class="lp-feat-sub">Exportable dashboards and delivery insights</div></div>
                </div>
            </div>

            <!-- Stats strip -->
            <div class="lp-stats">
                <div class="lp-stat">
                    <span class="lp-stat-num">3</span>
                    <span class="lp-stat-lbl">Modules</span>
                </div>
                <span class="lp-stat-div"></span>
                <div class="lp-stat">
                    <span class="lp-stat-live"></span>
                    <span class="lp-stat-lbl">Live sync</span>
                </div>
                <span class="lp-stat-div"></span>
                <div class="lp-stat">
                    <span class="lp-stat-num">SHA-256</span>
                    <span class="lp-stat-lbl">Encrypted</span>
                </div>
            </div>

        </div>
    </div>

    <!-- ══════════════════════════════ RIGHT FORM -->
    <div class="lp-form-panel">

        <!-- Background watermark -->
        <div class="lp-watermark" aria-hidden="true">PPMS</div>

        <!-- Theme toggle -->
        <button class="lp-theme-btn" id="btnTheme" title="Toggle theme" type="button">
            <svg class="icon-sun" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                <circle cx="10" cy="10" r="4"/>
                <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42"/>
            </svg>
            <svg class="icon-moon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M17.5 12A7.5 7.5 0 018 2.5a7.5 7.5 0 100 15 7.5 7.5 0 009.5-5.5z"/>
            </svg>
        </button>

        <div class="lp-form-inner">
            <!-- Mobile brand -->
            <div class="lp-form-brand-sm">
                <div class="lp-badge-sm">PPMS</div>
                <span>Production Planning &amp; Monitoring</span>
            </div>

            <!-- Heading -->
            <div class="lp-form-hd">
                <div class="lp-form-icon" aria-hidden="true">
                    <svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.6">
                        <rect x="2" y="3" width="18" height="16" rx="3"/>
                        <path d="M7 8h8M7 12h5" stroke-linecap="round"/>
                        <circle cx="16" cy="12" r="2.5" fill="currentColor" stroke="none" opacity=".7"/>
                    </svg>
                </div>
                <h2 class="lp-form-title">Welcome back</h2>
                <p class="lp-form-sub">Sign in to access the production workspace</p>
            </div>

            <!-- Error -->
            <div class="login-error" id="loginError" role="alert">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="8"/><path d="M10 6v4M10 14h.01"/></svg>
                <span id="loginErrorMsg">Invalid email or password.</span>
            </div>

            <form id="loginForm" autocomplete="off" onsubmit="return false;">
                <div class="form-group">
                    <label class="form-label" for="loginEmail">Email Address</label>
                    <div class="form-field-wrap">
                        <svg class="form-field-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="4" width="16" height="12" rx="2"/><path d="M2 7l8 5 8-5" stroke-linecap="round"/></svg>
                        <input type="text" id="loginEmail" class="form-input" placeholder="you@example.com"
                            autocomplete="off" data-lpignore="true" data-form-type="other" spellcheck="false"
                            readonly onfocus="this.removeAttribute('readonly')" onclick="this.removeAttribute('readonly')"/>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label" for="loginPassword">Password</label>
                    <div class="pw-wrap form-field-wrap">
                        <svg class="form-field-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="8" width="10" height="9" rx="2"/><path d="M7 8V6a3 3 0 0 1 6 0v2" stroke-linecap="round"/></svg>
                        <input type="password" id="loginPassword" class="form-input" placeholder="••••••••"
                            autocomplete="new-password" data-lpignore="true" data-form-type="other"
                            readonly onfocus="this.removeAttribute('readonly')" onclick="this.removeAttribute('readonly')"/>
                        <button class="pw-toggle" id="pwToggle" type="button" aria-label="Toggle password visibility">
                            <svg id="eyeIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                                <path d="M1 10s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z"/>
                                <circle cx="10" cy="10" r="3"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <button class="btn-login" id="btnLogin" type="button">
                    <svg class="btn-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h14M10 4l7 6-7 6"/></svg>
                    <span class="btn-spinner"></span>
                    Sign In
                </button>
            </form>

            <div class="lp-form-footer">
                <div class="security-note">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3z"/></svg>
                    Secured with SHA-256 encryption
                </div>
                <div class="lp-contact">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="4" width="16" height="12" rx="2"/><path d="M2 7l8 5 8-5" stroke-linecap="round"/></svg>
                    <span>Need an account? <a href="mailto:adahm.ahmed@hanwhaegypt.com?subject=PPMS Account Request" class="lp-contact-link">Contact us</a></span>
                </div>
            </div>
        </div>

        <footer class="lp-footer">
            Production Plan Monitoring System &copy; 2026 &nbsp;&middot;&nbsp; Adham Morsy
        </footer>
    </div>

</div>
`.trim();
}

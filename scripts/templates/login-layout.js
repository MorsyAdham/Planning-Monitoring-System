export function renderLoginLayout() {
    return `
<div class="lp-root">

    <!-- ══════════════════════════════ LEFT HERO -->
    <div class="lp-hero" id="lpHero">

        <!-- Decorative layer — hue-shifted as one unit per theme (login.css) -->
        <div class="lp-hero-decor">
            <!-- Atmospheric glows -->
            <div class="lp-hero-bg">
                <div class="lp-glow lp-glow-a" id="lpGlowA"></div>
                <div class="lp-glow lp-glow-b" id="lpGlowB"></div>
                <div class="lp-glow lp-glow-c" id="lpGlowC"></div>
                <div class="lp-glow lp-glow-d" id="lpGlowD"></div>
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
                <i style="--x:92%; --y:38%; --s:3px; --d:6.1s; --dl:2.4s"></i>
                <i style="--x:60%; --y:12%; --s:2px; --d:7.9s; --dl:0.7s"></i>
                <i style="--x:30%; --y:52%; --s:3px; --d:8.6s; --dl:3.6s"></i>
                <i style="--x:4%;  --y:48%; --s:2px; --d:6.7s; --dl:1.9s"></i>
                <i style="--x:74%; --y:78%; --s:4px; --d:9.4s; --dl:0.2s"></i>
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
        </div>

        <!-- ── Content ── -->
        <div class="lp-hero-content">

            <div class="lp-hero-top">
                <div class="lp-hero-badge-wrap">
                    <div class="lp-hero-badge-ring" aria-hidden="true"></div>
                    <div class="lp-hero-badge">PPMS</div>
                </div>
                <span class="lp-hero-ver">F200 · F100</span>
            </div>

            <h1 class="lp-hero-title">Production<br>Planning &amp;<br>Monitoring</h1>

            <p class="lp-hero-desc">
                End-to-end production schedule control — from raw-material allocation to final delivery. Plan, track, and resolve issues across all modules in real time.
            </p>

            <!-- Animated workflow diagram — rounded icon nodes + dots traveling the connectors -->
            <div class="lp-flow-wrap">
                <svg class="lp-flow-svg" viewBox="0 0 400 100" fill="none" aria-hidden="true">
                    <!-- Connector 1: PLAN → SCHEDULE -->
                    <path d="M80 42 H110" stroke="var(--la)" stroke-opacity=".38" stroke-width="1.5" stroke-dasharray="3 4"/>
                    <path d="M108 38l4 4-4 4" stroke="var(--la)" stroke-opacity=".55" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle r="2.6" fill="var(--la)"><animateMotion dur="1.7s" repeatCount="indefinite" path="M80 42 H110"/></circle>

                    <!-- Connector 2: SCHEDULE → TRACK -->
                    <path d="M184 42 H214" stroke="var(--la)" stroke-opacity=".38" stroke-width="1.5" stroke-dasharray="3 4"/>
                    <path d="M212 38l4 4-4 4" stroke="var(--la)" stroke-opacity=".55" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle r="2.6" fill="var(--la)"><animateMotion dur="1.7s" repeatCount="indefinite" begin="0.55s" path="M184 42 H214"/></circle>

                    <!-- Connector 3: TRACK → DELIVER (success accent) -->
                    <path d="M288 42 H318" stroke="#22c55e" stroke-opacity=".45" stroke-width="1.5" stroke-dasharray="3 4"/>
                    <path d="M316 38l4 4-4 4" stroke="#22c55e" stroke-opacity=".6" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle r="2.6" fill="#22c55e"><animateMotion dur="1.7s" repeatCount="indefinite" begin="1.1s" path="M288 42 H318"/></circle>

                    <!-- Node: PLAN (cx 43) — three centered list lines -->
                    <rect x="6" y="14" width="74" height="58" rx="11" fill="var(--clr-accent-dim)" stroke="var(--la)" stroke-opacity=".4" stroke-width="1"/>
                    <path d="M32 30h22M35 38h16M33 46h20" stroke="var(--la)" stroke-width="1.5" stroke-linecap="round"/>
                    <text x="43" y="63" text-anchor="middle" font-size="7.5" fill="rgba(225,238,255,.85)" font-family="Inter,sans-serif" font-weight="700" letter-spacing=".06em">PLAN</text>

                    <!-- Node: SCHEDULE (cx 147) — centered calendar -->
                    <rect x="110" y="14" width="74" height="58" rx="11" fill="var(--clr-accent-dim)" stroke="var(--la)" stroke-opacity=".4" stroke-width="1"/>
                    <rect x="137" y="27" width="20" height="17" rx="2.5" stroke="var(--la)" stroke-width="1.5"/>
                    <path d="M137 32h20M142 24v6M152 24v6" stroke="var(--la)" stroke-width="1.5" stroke-linecap="round"/>
                    <text x="147" y="63" text-anchor="middle" font-size="7.5" fill="rgba(225,238,255,.85)" font-family="Inter,sans-serif" font-weight="700" letter-spacing=".06em">SCHEDULE</text>

                    <!-- Node: TRACK (cx 251) — centered bar chart -->
                    <rect x="214" y="14" width="74" height="58" rx="11" fill="var(--clr-accent-dim)" stroke="var(--la)" stroke-opacity=".4" stroke-width="1"/>
                    <rect x="241" y="36" width="6" height="14" rx="1.5" fill="var(--la)" opacity=".85"/>
                    <rect x="249" y="28" width="6" height="22" rx="1.5" fill="var(--la)"/>
                    <rect x="257" y="40" width="6" height="10" rx="1.5" fill="var(--la)" opacity=".85"/>
                    <text x="251" y="63" text-anchor="middle" font-size="7.5" fill="rgba(225,238,255,.85)" font-family="Inter,sans-serif" font-weight="700" letter-spacing=".06em">TRACK</text>

                    <!-- Node: DELIVER (cx 355, success accent) — centered checkmark -->
                    <rect x="318" y="14" width="74" height="58" rx="11" fill="rgba(34,197,94,.08)" stroke="rgba(34,197,94,.4)" stroke-width="1"/>
                    <circle cx="355" cy="36" r="10" stroke="#22c55e" stroke-width="1.6"/>
                    <path d="M350.5 36l3 3 6.5-7" stroke="#22c55e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    <text x="355" y="63" text-anchor="middle" font-size="7.5" fill="rgba(160,235,190,.9)" font-family="Inter,sans-serif" font-weight="700" letter-spacing=".06em">DELIVER</text>
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

        <!-- Theme picker -->
        <div class="lp-theme-wrap" id="lpThemeWrap">
            <button class="lp-theme-btn" id="btnTheme" title="Theme" type="button" aria-haspopup="true" aria-expanded="false">
                <span id="lpThemePickerIcon"></span>
            </button>
            <div class="lp-theme-dropdown" id="lpThemeDropdown" style="display:none" role="menu"></div>
        </div>

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

            <form id="loginForm" autocomplete="on" onsubmit="return false;">
                <div class="form-group">
                    <label class="form-label" for="loginEmail">Email Address</label>
                    <div class="form-field-wrap">
                        <svg class="form-field-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="4" width="16" height="12" rx="2"/><path d="M2 7l8 5 8-5" stroke-linecap="round"/></svg>
                        <input type="email" id="loginEmail" name="email" class="form-input" placeholder="you@example.com"
                            autocomplete="username" spellcheck="false"
                            readonly onfocus="this.removeAttribute('readonly')" onclick="this.removeAttribute('readonly')"/>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label" for="loginPassword">Password</label>
                    <div class="pw-wrap form-field-wrap">
                        <svg class="form-field-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="8" width="10" height="9" rx="2"/><path d="M7 8V6a3 3 0 0 1 6 0v2" stroke-linecap="round"/></svg>
                        <input type="password" id="loginPassword" name="password" class="form-input" placeholder="••••••••"
                            autocomplete="current-password"
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

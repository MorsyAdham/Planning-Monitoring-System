export function renderLoginLayout() {
    return `
<header class="login-header">
        <div class="login-header-inner">
            <div class="login-header-brand">
                <div class="brand-badge">PPMS</div>
                <div class="brand-text">
                    <span class="brand-title">Production Plan Monitoring System</span>
                    <span class="brand-sub">Planning and Progress Control Workspace</span>
                </div>
            </div>
            <div class="header-actions">
                <button class="btn-theme" id="btnTheme" title="Toggle light / dark theme" type="button">
                    <svg class="icon-sun" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                        <circle cx="10" cy="10" r="4" />
                        <path
                            d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
                    </svg>
                    <svg class="icon-moon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M17.5 12A7.5 7.5 0 018 2.5a7.5 7.5 0 100 15 7.5 7.5 0 009.5-5.5z" />
                    </svg>
                </button>
            </div>
        </div>
    </header>

    <main class="login-main">
        <div class="login-card">
            <div class="login-card-header">
                <div class="login-card-title">Sign In</div>
                <div class="login-card-sub">Enter your credentials to access the monitoring workspace</div>
            </div>

            <div class="login-error" id="loginError" role="alert">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="10" cy="10" r="8" />
                    <path d="M10 6v4M10 14h.01" />
                </svg>
                <span id="loginErrorMsg">Invalid email or password.</span>
            </div>

            <form id="loginForm" autocomplete="off" onsubmit="return false;">
                <div class="form-group">
                    <label class="form-label" for="loginEmail">Email Address</label>
                    <input type="text" id="loginEmail" class="form-input" placeholder="you@example.com"
                        autocomplete="off" data-lpignore="true" data-form-type="other" spellcheck="false" />
                </div>

                <div class="form-group">
                    <label class="form-label" for="loginPassword">Password</label>
                    <div class="pw-wrap">
                        <input type="password" id="loginPassword" class="form-input" placeholder="••••••••"
                            autocomplete="new-password" data-lpignore="true" data-form-type="other" />
                        <button class="pw-toggle" id="pwToggle" type="button" aria-label="Toggle password visibility">
                            <svg id="eyeIcon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                                <path d="M1 10s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" />
                                <circle cx="10" cy="10" r="3" />
                            </svg>
                        </button>
                    </div>
                </div>

                <button class="btn-login" id="btnLogin" type="button">
                    <svg class="btn-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 10h14M10 4l7 6-7 6" />
                    </svg>
                    <span class="btn-spinner"></span>
                    Sign In
                </button>
            </form>

            <div class="security-note">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
                    <path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3z" />
                </svg>
                Secured with SHA-256 encryption
            </div>
        </div>
    </main>

    <footer class="login-footer">
        Production Plan Monitoring System &copy; 2026 &nbsp;|&nbsp; Adham Morsy
    </footer>
`.trim();
}


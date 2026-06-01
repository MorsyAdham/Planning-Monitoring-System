import { loadClassicScript, setHTML } from './dom.js';
import { requireSession, redirectIfAuthenticated } from './guards.js';
import { applyStoredTheme } from './session.js';

let domContentLoadedFired = document.readyState === 'complete';
document.addEventListener('DOMContentLoaded', () => {
    domContentLoadedFired = true;
}, { once: true });

export function exposeCoreGlobals(api) {
    window.PPMSCore = Object.freeze({ ...(window.PPMSCore || {}), ...api });
}

export function bootstrapPage({
    rootId = 'pageRoot',
    template,
    requireAuth = false,
    redirectIfAuth = false,
    authRedirect,
}) {
    applyStoredTheme();

    if (requireAuth && !requireSession(authRedirect)) return null;
    if (redirectIfAuth && redirectIfAuthenticated(authRedirect)) return null;

    return setHTML(rootId, typeof template === 'function' ? template() : template);
}

export async function loadRuntimeScripts(scripts) {
    for (const script of scripts) {
        await loadClassicScript(script.src, script);
    }

    if (domContentLoadedFired) {
        const event = new Event('DOMContentLoaded', { bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        window.dispatchEvent(new Event('DOMContentLoaded'));
    }
}

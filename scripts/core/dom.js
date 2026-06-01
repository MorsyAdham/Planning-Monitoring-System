export function byId(id, root = document) {
    return root.getElementById(id);
}

export function qs(selector, root = document) {
    return root.querySelector(selector);
}

export function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
}

export function setHTML(target, html) {
    const element = typeof target === 'string' ? byId(target) : target;
    if (!element) throw new Error('Mount target was not found.');
    element.innerHTML = html;
    return element;
}

export function loadClassicScript(src, options = {}) {
    const absoluteSrc = new URL(src, window.location.href).href;
    const existing = Array.from(document.scripts).find(script => script.src === absoluteSrc);
    if (existing) {
        if (existing.dataset.ppmsLoaded === 'true') return Promise.resolve(existing);
        return new Promise((resolve, reject) => {
            existing.addEventListener('load', () => resolve(existing), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
        });
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        if (options.crossOrigin) script.crossOrigin = options.crossOrigin;
        script.addEventListener('load', () => {
            script.dataset.ppmsLoaded = 'true';
            resolve(script);
        }, { once: true });
        script.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
        document.body.appendChild(script);
    });
}

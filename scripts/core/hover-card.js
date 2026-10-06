/* ================================================================
   PPMS hover card — the one tooltip style used everywhere.
   ----------------------------------------------------------------
   • Any element with a title="…" shows this card instead of the
     browser's plain tooltip (the title is set aside while the pointer
     is on the element and put back afterwards, so code that reads or
     changes it keeps working).
   • Text layout: one line → a short note. Several lines → the first
     line is the heading; "Label: value" lines become label / value
     rows; other lines are plain text.
   • Rich cards (the Gantt block card) call PPMSHoverCard.show(html,
     x, y) with their own markup — same look, same placement rules.
   • Chart.js tooltips get the same colours, corners and spacing.
   ================================================================ */

const DELAY = 350;          // ms before a card opens
let card = null;
let anchor = null;          // element whose title is shown
let stashed = null;         // its title text
let timer = 0;
let open = false;
let rich = false;           // showing caller markup (show()) rather than a title

function el() {
    if (!card) {
        card = document.createElement('div');
        card.className = 'ppms-tip';
        card.setAttribute('role', 'tooltip');
        card.hidden = true;
    }
    const host = document.fullscreenElement || document.body;
    if (card.parentNode !== host) host.appendChild(card);
    return card;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Plain title text → card markup. */
export function textCardHtml(text) {
    const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length <= 1) return `<div class="tip-note">${esc(lines[0] || '')}</div>`;
    const [head, ...rest] = lines;
    let rows = '', body = '';
    for (const l of rest) {
        const m = /^([^:]{1,32}):\s+(.+)$/.exec(l);
        if (m) rows += `<div class="tip-row"><span>${esc(m[1])}</span><b>${esc(m[2])}</b></div>`;
        else body += `<div class="tip-line">${esc(l)}</div>`;
    }
    return `<div class="tip-head"><span class="tip-title">${esc(head)}</span></div>`
        + (body ? `<div class="tip-text">${body}</div>` : '')
        + (rows ? `<div class="tip-grid">${rows}</div>` : '');
}

function placeAtPoint(x, y) {
    const c = card, pad = 14, w = c.offsetWidth, h = c.offsetHeight;
    let left = x + pad, top = y + pad;
    if (left + w > window.innerWidth - 8) left = x - w - pad;
    if (top + h > window.innerHeight - 8) top = y - h - pad;
    c.style.left = Math.max(8, left) + 'px';
    c.style.top = Math.max(8, top) + 'px';
}

function placeAtElement(target) {
    const c = card, r = target.getBoundingClientRect(), gap = 8, w = c.offsetWidth, h = c.offsetHeight;
    let top = r.bottom + gap;
    if (top + h > window.innerHeight - 8) top = r.top - h - gap;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    c.style.left = left + 'px';
    c.style.top = Math.max(8, top) + 'px';
}

/** Show a card with the caller's markup, next to the pointer. */
export function show(html, x, y, { wide = false } = {}) {
    clearTimeout(timer);
    release();
    const c = el();
    c.classList.toggle('ppms-tip--wide', wide);
    if (c.dataset.html !== html) { c.innerHTML = html; c.dataset.html = html; }
    c.hidden = false;
    open = true;
    rich = true;
    placeAtPoint(x, y);
}

/** Move an open card to follow the pointer. */
export function move(x, y) {
    if (open && rich && card) placeAtPoint(x, y);
}

/** Hide the card. { rich: true } hides only a card opened with show(),
 *  leaving a title card (e.g. on a Gantt block's handle) alone. */
export function hide(opts) {
    if (opts?.rich && !rich) return;
    rich = false;
    clearTimeout(timer);
    release();
    open = false;
    if (card) { card.hidden = true; card.dataset.html = ''; }
}

/* ── Title tooltips ─────────────────────────────────────────────── */
function release() {
    if (!anchor) return;
    // Put the title back unless the page set a new one meanwhile
    if (stashed != null && !anchor.hasAttribute('title')) anchor.setAttribute('title', stashed);
    anchor = null;
    stashed = null;
}

function titledAncestor(t) {
    const a = t?.closest?.('[title]');
    if (!a || a === document.documentElement || a === document.body) return null;
    if (a.closest('.ppms-tip, [data-no-hover-card]')) return null;
    // On a Gantt block its own card shows — only the block's handles keep a title card
    const bar = t.closest('#ganttInner .gc-bar');
    if (bar && !bar.contains(a)) return null;
    return a.getAttribute('title').trim() ? a : null;
}

/** Take the title off (so the browser shows nothing) and remember it. */
function claim(a) {
    const text = a.getAttribute('title');
    // Keep the accessible name when the title was the only one
    if (!a.hasAttribute('aria-label') && !a.textContent.trim()) a.setAttribute('aria-label', text);
    a.removeAttribute('title');
    anchor = a;
    stashed = text;
}

function openCard() {
    if (!anchor?.isConnected) return;
    const c = el();
    c.classList.remove('ppms-tip--wide');
    const html = textCardHtml(stashed);
    c.innerHTML = html;
    c.dataset.html = html;
    c.hidden = false;
    open = true;
    rich = false;
    placeAtElement(anchor);
}

document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    let a = titledAncestor(e.target);
    // Inside the current element (its title is set aside): stay on it
    // unless a nested element has a title of its own
    if (anchor?.contains(e.target) && !(a && anchor.contains(a))) a = anchor;
    if (a === anchor) return;
    if (!a) {
        if (anchor) hide();
        return;
    }
    const wasOpen = open && !!anchor;
    clearTimeout(timer);
    release();
    claim(a);
    // Moving between titled elements: switch at once, like the browser does
    if (wasOpen) openCard();
    else timer = setTimeout(openCard, DELAY);
}, { passive: true });

document.documentElement.addEventListener('pointerleave', hide);
document.addEventListener('pointerdown', () => { if (anchor) hide(); }, true);
document.addEventListener('keydown', () => { if (anchor) hide(); }, true);
document.addEventListener('scroll', () => { if (open || anchor) hide(); }, true);
window.addEventListener('blur', hide);

/* ── Chart.js tooltips in the same style ───────────────────────── */
export function registerChartHoverCard(Chart) {
    if (!Chart?.register) return;
    const css = () => getComputedStyle(document.documentElement);
    Chart.register({
        id: 'ppmsHoverCard',
        beforeUpdate(chart) {
            const tip = chart.options?.plugins?.tooltip;
            if (!tip) return;
            const s = css();
            const v = (n, f) => s.getPropertyValue(n).trim() || f;
            const light = document.documentElement.getAttribute('data-theme') === 'light';
            Object.assign(tip, {
                backgroundColor: light ? '#ffffff' : v('--clr-surface', '#161b27'),
                borderColor: v('--clr-border', '#2a3350'),
                borderWidth: 1,
                titleColor: v('--clr-text', '#e2e8f4'),
                bodyColor: v('--clr-text', '#e2e8f4'),
                footerColor: v('--clr-text-muted', '#7a8baa'),
                cornerRadius: 10,
                padding: { top: 9, right: 12, bottom: 9, left: 12 },
                caretSize: 0,
                caretPadding: 10,
                boxPadding: 4,
                titleMarginBottom: 6,
                titleFont: { ...(tip.titleFont || {}), weight: '700', size: 12 },
                bodyFont: { ...(tip.bodyFont || {}), size: 11.5 },
            });
        },
    });
}

window.PPMSHoverCard = { show, move, hide, textCardHtml };

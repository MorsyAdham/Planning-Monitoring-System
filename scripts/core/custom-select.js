'use strict';

/**
 * A small custom single-select dropdown (trigger button + floating option
 * list) for header controls, styled to match the app rather than the OS's
 * native <option> list. Mirrors the existing more-menu / theme-picker
 * dropdown pattern already in the header (own wrapper, absolutely
 * positioned menu, outside-click-to-close).
 *
 * Usage: mount('someWrapId', { onChange }) once, then setOptions/setValue
 * from anywhere (module.js or app.js) as data changes — every call is
 * idempotent, so callers don't need to track whether they've mounted yet.
 */
window.CustomSelect = (() => {
    const instances = new Map(); // wrapId -> { wrap, trigger, valueEl, menu, options, value, onChange }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function closeAll(exceptWrapId) {
        instances.forEach((inst, id) => {
            if (id === exceptWrapId) return;
            inst.menu.style.display = 'none';
            inst.trigger.setAttribute('aria-expanded', 'false');
        });
    }

    document.addEventListener('click', e => {
        instances.forEach(inst => {
            if (inst.wrap.contains(e.target)) return;
            inst.menu.style.display = 'none';
            inst.trigger.setAttribute('aria-expanded', 'false');
        });
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeAll(null);
    });

    function mount(wrapId, { onChange } = {}) {
        const existing = instances.get(wrapId);
        if (existing) {
            existing.onChange = onChange || existing.onChange;
            return true;
        }
        const wrap = document.getElementById(wrapId);
        const trigger = wrap?.querySelector('[data-cs-trigger]');
        const valueEl = wrap?.querySelector('[data-cs-value]');
        const menu = wrap?.querySelector('[data-cs-menu]');
        if (!wrap || !trigger || !menu) return false;

        const state = { wrap, trigger, valueEl, menu, options: [], value: null, onChange: onChange || null };

        trigger.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = menu.style.display === 'block';
            closeAll(wrapId);
            menu.style.display = isOpen ? 'none' : 'block';
            trigger.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
        });

        instances.set(wrapId, state);
        return true;
    }

    function renderMenu(wrapId) {
        const state = instances.get(wrapId);
        if (!state) return;
        state.menu.innerHTML = state.options.map(opt => `
            <button type="button" class="context-select-option${String(opt.value) === String(state.value) ? ' active' : ''}"
                data-cs-option="${esc(opt.value)}" role="option" aria-selected="${String(opt.value) === String(state.value)}">
                <span class="context-select-option-label">${esc(opt.label)}</span>
                <svg class="context-select-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 8.5l3.2 3.2L13 4.8"/>
                </svg>
            </button>`).join('') || `<div class="context-select-empty">No options</div>`;
        state.menu.querySelectorAll('[data-cs-option]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.menu.style.display = 'none';
                state.trigger.setAttribute('aria-expanded', 'false');
                setValue(wrapId, btn.dataset.csOption, true);
            });
        });
    }

    function setOptions(wrapId, options) {
        const state = instances.get(wrapId);
        if (!state) return;
        state.options = options || [];
        renderMenu(wrapId);
    }

    function setValue(wrapId, value, fromUser = false) {
        const state = instances.get(wrapId);
        if (!state) return;
        state.value = value;
        const opt = state.options.find(o => String(o.value) === String(value));
        if (state.valueEl) state.valueEl.textContent = opt ? opt.label : '';
        renderMenu(wrapId);
        if (fromUser && typeof state.onChange === 'function') state.onChange(value);
    }

    function getValue(wrapId) {
        return instances.get(wrapId)?.value ?? null;
    }

    return { mount, setOptions, setValue, getValue };
})();

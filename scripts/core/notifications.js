export function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) {
        const method = type === 'error' ? 'error' : 'log';
        console[method](message);
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    window.setTimeout(() => {
        toast.classList.remove('toast-visible');
        window.setTimeout(() => toast.remove(), 180);
    }, 3200);
}

export function installToastGlobal() {
    window.showToast = showToast;
}

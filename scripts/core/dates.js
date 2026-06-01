export function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

export function formatDateTime(date) {
    return new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

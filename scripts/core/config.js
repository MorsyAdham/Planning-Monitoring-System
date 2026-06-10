export const SUPABASE_URL = 'https://biqwfqkuhebxcfucangt.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpcXdmcWt1aGVieGNmdWNhbmd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzNzM5NzQsImV4cCI6MjA4MTk0OTk3NH0.QkASAl8yzXfxVq0b0FdkXHTOpblldr2prCnImpV8ml8';
export const SESSION_KEY = 'kd1_session';
export const THEME_KEY = 'kd1_theme';

// Compute paths relative to the current page's directory so redirects work
// regardless of whether the app is served from / or a repo subdirectory.
function _dir() { return window.location.pathname.replace(/\/[^/]*$/, '/'); }

export const ROUTES = {
    get app()        { return _dir() + 'index.html'; },
    get login()      { return _dir() + 'login.html'; },
    get systemTest() { return _dir() + 'system-test.html'; },
};

export const CDN_SCRIPTS = {
    supabase: {
        src: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.8/dist/umd/supabase.min.js',
        crossOrigin: 'anonymous',
    },
    chartJs: {
        src: 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js',
        crossOrigin: 'anonymous',
    },
    jspdf: {
        src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
        crossOrigin: 'anonymous',
    },
    jspdfAutoTable: {
        src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.7.1/jspdf.plugin.autotable.min.js',
        crossOrigin: 'anonymous',
    },
    xlsx: {
        src: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
        crossOrigin: 'anonymous',
    },
    excelJs: {
        src: 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js',
        crossOrigin: 'anonymous',
    },
};

export const NOOP_STORAGE = {
    getItem: () => null,
    setItem: () => { },
    removeItem: () => { },
};

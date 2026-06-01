import { NOOP_STORAGE, SUPABASE_KEY, SUPABASE_URL } from './config.js';

export function createSupabaseClient() {
    if (!window.supabase?.createClient) {
        throw new Error('Supabase client library is not loaded.');
    }

    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storage: NOOP_STORAGE,
        },
    });
}

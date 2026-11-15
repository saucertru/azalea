import { CONFIG } from './config.js';

export const configured = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

// supabase-js is bundled in js/vendor so it works even when CDNs are blocked;
// the CDN copy is only a fallback.
async function loadLib() {
  try {
    return await import('./vendor/supabase.js');
  } catch (e) {
    console.warn('Local supabase-js failed, trying CDN', e);
    return import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  }
}

let client = null;
if (configured) {
  try {
    const { createClient } = await loadLib();
    client = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (e) {
    console.error('Could not load Supabase', e);
  }
}

/** The Supabase client, or null when keys are not set / the library failed to load. */
export const sb = client;

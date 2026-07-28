(function initializeSupabaseClient(global) {
  const url = 'https://wffhbknmeyxniyipfwjk.supabase.co';
  const publishableKey = 'sb_publishable_xrjDOSU1ctCwkq6osoNn6g_SEEoBopB';

  if (!global.supabase?.createClient) {
    global.EsepSupabase = null;
    return;
  }

  global.EsepSupabase = global.supabase.createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
})(globalThis);

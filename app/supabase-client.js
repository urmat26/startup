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

  function showOfflineBanner() {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.hidden = false;
  }
  function hideOfflineBanner() {
    const banner = document.getElementById('offlineBanner');
    if (!navigator.onLine) return;
    if (banner) banner.hidden = true;
  }
  document.getElementById('offlineRetry')?.addEventListener('click', () => location.reload());
  window.addEventListener('online', hideOfflineBanner);
  window.addEventListener('offline', showOfflineBanner);
  window.addEventListener('unhandledrejection', (event) => {
    const message = String(event.reason?.message || event.reason || '');
    if (/Failed to fetch|ERR_NAME_NOT_RESOLVED|NetworkError|shutting down|connection terminated|timeout/i.test(message)) {
      showOfflineBanner();
    }
  });
  global.EsepOffline = { show: showOfflineBanner, hide: hideOfflineBanner };
})(globalThis);

// Keeps a crew member signed in at sea. Offline with an expired access token
// (they last an hour), supabase-js's token refresh can't reach the server and
// retries with backoff for ~25s while holding its auth lock — every query
// waits behind it, and it starts again on the next query. The app sits on its
// loading screen.
//
// So when a refresh can't reach the server, answer it locally: the same stored
// tokens with a short validity. The server never saw that refresh token, so it
// stays good for the first real refresh once the link is back (the client
// retries on its own ~30s tick). Requests made meanwhile carry the old token,
// fail offline and are answered from the saved reads.

const OFFLINE_VALIDITY_S = 300; // > supabase-js's 90s refresh margin

const isNetworkError = (e) => e && (e.name === 'TypeError' || e.name === 'AbortError' || /network|fetch|load failed/i.test(String(e.message || e)));

export function withOfflineAuth(baseFetch, { getStoredSession, now = () => Date.now(), report = () => {} }) {
  return async function offlineAuthFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!/\/auth\/v1\/token\?grant_type=refresh_token/.test(url)) return baseFetch(input, init);

    let res;
    try {
      res = await baseFetch(input, init);
      if (res.status < 500) return res;
    } catch (e) {
      if (!isNetworkError(e) || init.signal?.aborted) throw e;
    }

    // Unreachable (or gateway down): stand in for the server with the stored
    // session — only if it is the very session being refreshed.
    let sent = null;
    try { sent = JSON.parse(typeof init.body === 'string' ? init.body : 'null')?.refresh_token; } catch { /* noop */ }
    const stored = getStoredSession();
    if (!stored?.access_token || !stored?.user || !sent || stored.refresh_token !== sent) {
      if (res) return res;
      throw new TypeError('Failed to fetch');
    }
    report({ type: 'offline' });
    const nowS = Math.floor(now() / 1000);
    const body = { ...stored, expires_in: OFFLINE_VALIDITY_S, expires_at: nowS + OFFLINE_VALIDITY_S };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

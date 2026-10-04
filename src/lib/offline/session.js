// The signed-in session as stored on the device by supabase-js. Read straight
// from storage: offline, the client's own getSession() may report nothing.

export const STORAGE_KEY = 'supabase.auth.token';

export function storedSession() {
  try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
}

export const storedUserId = () => storedSession()?.user?.id || null;

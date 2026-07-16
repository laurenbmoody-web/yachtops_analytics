// Shared quiet-hours helper for notification edge functions.
//
// A user's quiet window lives in public.notification_preferences
// (quiet_enabled, quiet_from, quiet_to, quiet_tz). When enabled and the
// recipient's LOCAL wall-clock is inside the window, event-driven emails are
// held — the in-app bell still fires (written by the DB trigger), so nothing is
// lost; the user simply isn't emailed during their night.
//
// This is deliberately NOT applied to compliance-reminder batches (Hours of
// Rest, cert/document expiry) — those are safety/legal and must always send.

export interface QuietPrefs {
  quiet_enabled?: boolean | null;
  quiet_from?: string | null; // 'HH:MM' or 'HH:MM:SS'
  quiet_to?: string | null;
  quiet_tz?: string | null; // IANA tz, e.g. 'Europe/London'
}

// 'HH:MM[:SS]' → minutes since midnight, or null if unparseable.
function toMinutes(t?: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(mi)) return null;
  return h * 60 + mi;
}

// Current wall-clock minutes-since-midnight in the given IANA timezone.
function nowMinutesInTz(now: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const mi = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return h * 60 + mi;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/** True when the recipient is currently inside their (enabled) quiet window. */
export function withinQuietHours(prefs: QuietPrefs | null | undefined, now: Date = new Date()): boolean {
  if (!prefs?.quiet_enabled) return false;
  const from = toMinutes(prefs.quiet_from);
  const to = toMinutes(prefs.quiet_to);
  if (from == null || to == null || from === to) return false;
  const cur = nowMinutesInTz(now, prefs.quiet_tz || 'UTC');
  // Overnight window (e.g. 22:00–07:00): inside if at/after start OR before end.
  if (from > to) return cur >= from || cur < to;
  // Same-day window (e.g. 13:00–14:00): inside if start ≤ now < end.
  return cur >= from && cur < to;
}

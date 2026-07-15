// Turnaround stats for the laundry log KPI strip — computed from the vessel's
// own items (tenant-scoped by the storage layer), so the numbers are real.

import { LaundryStatus } from './laundryStorage';

const MIN = 60000;
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// "2h 38m" / "45m" / "—"
export const fmtDur = (m) => {
  if (m == null || !isFinite(m)) return '—';
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return h ? `${h}h ${mm}m` : `${mm}m`;
};

// Average delivery turnaround (logged → delivered), a 7-day sparkline series,
// and today-vs-yesterday delta in minutes (negative = faster).
export function turnaroundStats(allItems) {
  const delivered = (allItems || []).filter(
    (i) => i.status === LaundryStatus.DELIVERED && i.deliveredAt && i.createdAt,
  );
  const byDay = {};
  delivered.forEach((i) => {
    const dur = (new Date(i.deliveredAt) - new Date(i.createdAt)) / MIN;
    if (dur < 0) return;
    const k = dayKey(new Date(i.deliveredAt));
    (byDay[k] = byDay[k] || []).push(dur);
  });

  const now = new Date();
  const days = [];
  for (let n = 6; n >= 0; n--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
    const arr = byDay[dayKey(d)] || [];
    days.push(arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
  }
  const todayAvg = days[6];
  const yesterdayAvg = days[5];
  const delta = (todayAvg != null && yesterdayAvg != null) ? Math.round(todayAvg - yesterdayAvg) : null;

  // Fall back to an all-time average when nothing delivered today yet.
  const overall = delivered.length
    ? delivered.reduce((s, i) => s + (new Date(i.deliveredAt) - new Date(i.createdAt)) / MIN, 0) / delivered.length
    : null;

  return {
    spark: days,
    avg: todayAvg != null ? todayAvg : overall,
    avgIsToday: todayAvg != null,
    delta,
    hasAny: delivered.length > 0,
  };
}

// Shared crew status config. Single source of truth for labels and colours.

export const CREW_STATUSES = [
  { value: 'active',           label: 'Active' },
  { value: 'on_leave',         label: 'On Leave' },
  { value: 'rotational_leave', label: 'On Rotational Leave' },
  { value: 'medical_leave',    label: 'Medical Leave' },
  { value: 'training',         label: 'Training' },
  { value: 'invited',          label: 'Invited' },
];

const STATUS_CONFIG = {
  active:           { label: 'Active',              dot: 'bg-green-500',  badge: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',   cell: 'bg-green-300 dark:bg-green-700' },
  on_leave:         { label: 'On Leave',            dot: 'bg-amber-500',  badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',   cell: 'bg-amber-300 dark:bg-amber-700' },
  rotational_leave: { label: 'On Rotational Leave', dot: 'bg-purple-500', badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',  cell: 'bg-purple-300 dark:bg-purple-700' },
  medical_leave:    { label: 'Medical Leave',       dot: 'bg-red-500',    badge: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',            cell: 'bg-red-300 dark:bg-red-700' },
  training:         { label: 'Training',            dot: 'bg-blue-500',   badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',        cell: 'bg-blue-300 dark:bg-blue-700' },
  invited:          { label: 'Invited',             dot: 'bg-gray-400',   badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',           cell: 'bg-gray-300 dark:bg-gray-600' },
};

const FALLBACK = { label: 'Unknown', dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-600', cell: 'bg-gray-200' };

export function getStatusLabel(status) {
  return (STATUS_CONFIG[status] || FALLBACK).label;
}

export function getStatusDotClass(status) {
  return (STATUS_CONFIG[status] || FALLBACK).dot;
}

export function getStatusBadgeClasses(status) {
  return (STATUS_CONFIG[status] || FALLBACK).badge;
}

export function getStatusCellClass(status) {
  return (STATUS_CONFIG[status] || FALLBACK).cell;
}

// Derive calendar periods from a history array (oldest-first / ascending changed_at).
// Each row marks the START of a new status, running until the next row's changed_at (or now).
export function buildStatusPeriods(history) {
  return history.map((entry, i) => ({
    status:    entry.new_status,
    start:     new Date(entry.changed_at),
    end:       i === history.length - 1 ? new Date() : new Date(history[i + 1].changed_at),
    notes:     entry.notes,
    changedBy: entry.changed_by_name,
  }));
}

// Return the status active on a given Date, given a periods array from buildStatusPeriods.
export function getStatusForDay(periods, day) {
  const d = new Date(day);
  for (const p of periods) {
    if (p.start <= d && d < p.end) return p.status;
  }
  return null;
}

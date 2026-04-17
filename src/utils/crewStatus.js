// Shared crew status config. Single source of truth for labels and colours.

export const CREW_STATUSES = [
  { value: 'active',           label: 'Active' },
  { value: 'on_leave',         label: 'On Leave' },
  { value: 'rotational_leave', label: 'On Rotational Leave' },
  { value: 'medical_leave',    label: 'Medical Leave' },
  { value: 'training',         label: 'Training' },
  { value: 'travelling',       label: 'Travelling' },
  { value: 'invited',          label: 'Invited' },
];

const STATUS_CONFIG = {
  active:           { label: 'Active',              dot: 'bg-green-500',  badge: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',   cell: 'bg-green-300 dark:bg-green-700' },
  on_leave:         { label: 'On Leave',            dot: 'bg-amber-500',  badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',   cell: 'bg-amber-300 dark:bg-amber-700' },
  rotational_leave: { label: 'On Rotational Leave', dot: 'bg-purple-500', badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',  cell: 'bg-purple-300 dark:bg-purple-700' },
  medical_leave:    { label: 'Medical Leave',       dot: 'bg-red-500',    badge: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',            cell: 'bg-red-300 dark:bg-red-700' },
  training:         { label: 'Training',            dot: 'bg-blue-500',   badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',        cell: 'bg-blue-300 dark:bg-blue-700' },
  travelling:       { label: 'Travelling',          dot: 'bg-teal-500',   badge: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',        cell: 'bg-teal-300 dark:bg-teal-700' },
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

function floorToDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Derive calendar periods from a history array (oldest-first / ascending changed_at).
// Starts are floored to local midnight so a mid-day change colours the full day.
// The final period extends to far-future so upcoming days render the expected colour.
export function buildStatusPeriods(history) {
  return history.map((entry, i) => {
    const start = floorToDay(new Date(entry.changed_at));
    const end = i === history.length - 1
      ? new Date(9999, 0, 1)
      : floorToDay(new Date(history[i + 1].changed_at));
    return { status: entry.new_status, start, end, notes: entry.notes, changedBy: entry.changed_by_name };
  });
}

// Return the status active on a given Date, given a periods array from buildStatusPeriods.
export function getStatusForDay(periods, day) {
  const d = floorToDay(day instanceof Date ? day : new Date(day));
  for (const p of periods) {
    if (p.start <= d && d < p.end) return p.status;
  }
  return null;
}

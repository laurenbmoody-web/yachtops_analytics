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
  active:           { label: 'Active',              dot: 'bg-green-500',        badge: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  on_leave:         { label: 'On Leave',            dot: 'bg-amber-500',        badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' },
  rotational_leave: { label: 'On Rotational Leave', dot: 'bg-amber-500',        badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' },
  medical_leave:    { label: 'Medical Leave',       dot: 'bg-red-500',          badge: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
  training:         { label: 'Training',            dot: 'bg-blue-500',         badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  invited:          { label: 'Invited',             dot: 'bg-gray-400',         badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

const FALLBACK = { label: 'Unknown', dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-600' };

export function getStatusLabel(status) {
  return (STATUS_CONFIG[status] || FALLBACK).label;
}

export function getStatusDotClass(status) {
  return (STATUS_CONFIG[status] || FALLBACK).dot;
}

export function getStatusBadgeClasses(status) {
  return (STATUS_CONFIG[status] || FALLBACK).badge;
}

import React from 'react';

export const STATUS_CONFIG = {
  draft: {
    label: 'Draft',
    className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
  pending_approval: {
    label: 'Pending Approval',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  },
  sent_to_supplier: {
    label: 'Sent to Supplier',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  },
  partially_delivered: {
    label: 'Partially Delivered',
    className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
  },
  delivered_with_discrepancies: {
    label: 'Discrepancies',
    className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  },
  delivered: {
    label: 'Delivered',
    className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  },
};

export const ITEM_STATUS_CONFIG = {
  pending: { label: 'Pending', dot: 'bg-slate-400' },
  received: { label: 'Received', dot: 'bg-green-500' },
  short_delivered: { label: 'Short', dot: 'bg-amber-500' },
  not_delivered: { label: 'Not Delivered', dot: 'bg-red-500' },
};

const StatusBadge = ({ status, size = 'sm' }) => {
  const config = STATUS_CONFIG[status] || { label: status || '—', className: 'bg-slate-100 text-slate-600' };
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm'
      } ${config.className}`}
    >
      {config.label}
    </span>
  );
};

export default StatusBadge;

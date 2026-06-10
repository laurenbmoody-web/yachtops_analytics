import React from 'react';
import { getBoardStatusConfig } from '../data/statusConfig';

// Board-status badge — Tailwind pill surface. Reads from the unified
// statusConfig source of truth (BOARD_STATUS_CONFIG). The cool-surface
// renders (BoardColumn lane chip, board-detail header) read from the
// same config but consume the `color` hex instead of `badgeClassName`.

export const ITEM_STATUS_CONFIG = {
  draft:        { label: 'Draft',        dot: 'bg-slate-400' },
  to_order:     { label: 'To order',     dot: 'bg-blue-500' },
  ordered:      { label: 'Ordered',      dot: 'bg-purple-500' },
  received:     { label: 'Received',     dot: 'bg-green-500' },
  partial:      { label: 'Partial',      dot: 'bg-amber-500' },
  not_received: { label: 'Not received', dot: 'bg-red-500' },
};

const StatusBadge = ({ status, size = 'sm' }) => {
  const config = getBoardStatusConfig(status);
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm'
      } ${config.badgeClassName}`}
    >
      {config.label}
    </span>
  );
};

export default StatusBadge;

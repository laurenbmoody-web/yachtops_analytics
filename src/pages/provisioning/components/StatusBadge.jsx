import React from 'react';
import { getBoardStatusConfig } from '../data/statusConfig';

// Board-status badge — Tailwind pill surface. Reads from the unified
// statusConfig source of truth (BOARD_STATUS_CONFIG). The cool-surface
// renders (BoardColumn lane chip, board-detail header) read from the
// same config but consume the `color` hex instead of `badgeClassName`.
// Item-status callers: import ITEM_STATUS_CONFIG from ../data/statusConfig
// directly. It used to live here; consolidated alongside the board map.

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

import React from 'react';
import { ITEM_STATUS_CONFIG } from './StatusBadge';

const ItemCard = ({ item, onClick }) => {
  const statusCfg = ITEM_STATUS_CONFIG[item.status] || ITEM_STATUS_CONFIG.pending;

  return (
    <button
      onClick={() => onClick(item)}
      className="w-full text-left bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.06)] rounded-lg px-3 py-2.5 hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.07)] transition-all group"
    >
      {/* Name */}
      <p className="text-[13px] font-bold text-white leading-snug truncate">
        {item.name || 'Untitled item'}
      </p>

      {/* Brand + Size */}
      {(item.brand || item.size) && (
        <p className="text-xs text-slate-400 mt-0.5 truncate">
          {[item.brand, item.size].filter(Boolean).join(' · ')}
        </p>
      )}

      {/* Bottom row: dept pill, status dot, qty */}
      <div className="flex items-center gap-2 mt-2">
        {item.department && (
          <span className="text-[10px] px-1.5 py-0.5 bg-white/10 text-slate-300 rounded-full truncate max-w-[80px]">
            {item.department}
          </span>
        )}

        <span className="flex items-center gap-1 text-[10px] text-slate-400">
          <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
          {statusCfg.label}
        </span>

        <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">
          {item.quantity_ordered || 0} {item.unit || 'each'}
        </span>
      </div>
    </button>
  );
};

export default ItemCard;

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ITEM_STATUS_CONFIG } from './StatusBadge';

const STATUS_ORDER = ['pending', 'received', 'short_delivered', 'not_delivered'];

const ItemCard = ({ item, onClick, onStatusChange }) => {
  const statusCfg = ITEM_STATUS_CONFIG[item.status] || ITEM_STATUS_CONFIG.pending;
  const [menu, setMenu] = useState(null); // { x, y }
  const menuRef = useRef(null);
  const longPressTimer = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menu) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menu]);

  const handleContextMenu = (e) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const handleTouchStart = (e) => {
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0];
      setMenu({ x: touch.clientX, y: touch.clientY });
    }, 500);
  };

  const handleTouchEnd = () => {
    clearTimeout(longPressTimer.current);
  };

  const handleStatusPick = (e, status) => {
    e.stopPropagation();
    setMenu(null);
    if (onStatusChange) onStatusChange(item, status);
  };

  return (
    <>
      <button
        onClick={() => { if (!menu) onClick(item); }}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        className="w-full text-left bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.06)] rounded-lg px-3 py-2.5 hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.07)] transition-all"
      >
        {/* Name */}
        <p className="text-[13px] font-semibold text-white leading-snug truncate">
          {item.name || 'Untitled item'}
        </p>

        {/* Brand + Size */}
        {(item.brand || item.size) && (
          <p className="text-[11px] mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {[item.brand, item.size].filter(Boolean).join(' · ')}
          </p>
        )}

        {/* Bottom row */}
        <div className="flex items-center gap-2 mt-2">
          {item.department && (
            <span className="text-[10px] px-1.5 py-0.5 bg-white/10 text-slate-300 rounded-full truncate max-w-[80px]">
              {item.department}
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px] text-slate-400">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusCfg.dot}`} />
            {statusCfg.label}
          </span>
          <span className="ml-auto text-[11px] text-slate-400 whitespace-nowrap">
            {item.quantity_ordered || 0} {item.unit || 'each'}
          </span>
        </div>
      </button>

      {/* Status context menu */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 py-1 rounded-lg shadow-2xl border border-[rgba(255,255,255,0.1)]"
          style={{ top: menu.y, left: menu.x, backgroundColor: '#162236', minWidth: 160 }}
        >
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Set status</p>
          {STATUS_ORDER.map(s => {
            const cfg = ITEM_STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={(e) => handleStatusPick(e, s)}
                className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/5 flex items-center gap-2"
              >
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                {cfg.label}
                {item.status === s && <span className="ml-auto text-[#4A90E2]">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
};

export default ItemCard;

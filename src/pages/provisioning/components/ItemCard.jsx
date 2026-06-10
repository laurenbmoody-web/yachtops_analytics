import React, { useState, useRef, useEffect } from 'react';
import { ITEM_STATUS_ORDER, getItemStatusConfig } from '../data/statusConfig';

// Per-card status pill + right-click status picker. Reads from the unified
// statusConfig source of truth — previously had a local STATUS_CONFIG +
// STATUS_ORDER that drifted from the March 2026 enum migration (kept dead
// values 'pending' / 'short_delivered' / 'not_delivered' and was missing
// the live additions 'to_order' / 'partial' / 'not_received'). Items in
// the live statuses were rendering with the wrong label; the picker let
// users select dead values that failed the provisioning_items CHECK on
// write. Both fixed by consuming the canonical config.

const ItemCard = ({ item, onClick, onStatusChange, onQuantityChange }) => {
  const cfg = getItemStatusConfig(item.status);
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);
  const longPressTimer = useRef(null);

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
      const t = e.touches[0];
      setMenu({ x: t.clientX, y: t.clientY });
    }, 500);
  };

  const handleTouchEnd = () => clearTimeout(longPressTimer.current);

  const handleQty = (e, delta) => {
    e.stopPropagation();
    const next = Math.max(0, (item.quantity_ordered || 0) + delta);
    if (onQuantityChange) onQuantityChange(item, next);
  };

  return (
    <>
      <div
        onClick={e => { e.stopPropagation(); if (!menu) onClick(item); }}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        className="pv-item"
      >
        {/* Name takes the freed width — single line, ellipsis only in the extreme */}
        <span className="pv-item-name">
          {item.name || 'Untitled'}
        </span>

        {/* Qty controls — stop propagation so taps on the stepper don't open the drawer */}
        <div className="pv-item-stepper" onClick={e => e.stopPropagation()}>
          <button onClick={(e) => handleQty(e, -1)} className="pv-item-stepbtn">−</button>
          <span className="pv-item-qty">{item.quantity_ordered ?? 0}</span>
          <button onClick={(e) => handleQty(e, 1)} className="pv-item-stepbtn">+</button>
        </div>

        {/* Status badge — consumes the cell-variant palette from the unified config */}
        <span
          className="pv-item-status"
          style={{ background: cfg.cell.bg, color: cfg.cell.color }}
        >
          {cfg.label}
        </span>
      </div>

      {/* Status context menu */}
      {menu && (
        <div
          ref={menuRef}
          onClick={e => e.stopPropagation()}
          className="fixed z-50 py-1 rounded-lg shadow-2xl border border-border bg-card"
          style={{ top: menu.y, left: menu.x, minWidth: 160 }}
        >
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Set status</p>
          {ITEM_STATUS_ORDER.map(s => {
            const c = getItemStatusConfig(s);
            return (
              <button
                key={s}
                onClick={(e) => { e.stopPropagation(); setMenu(null); if (onStatusChange) onStatusChange(item, s); }}
                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2"
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.cell.color, display: 'inline-block', flexShrink: 0 }} />
                {c.label}
                {item.status === s && <span className="ml-auto text-primary">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
};

export default ItemCard;

import React, { useState, useRef, useEffect } from 'react';

const STATUS_CONFIG = {
  pending:          { label: 'Pending',       bg: 'rgba(100,116,139,0.2)', color: '#94A3B8' },
  ordered:          { label: 'Ordered',       bg: 'rgba(74,144,226,0.2)',  color: '#4A90E2' },
  received:         { label: 'Received',      bg: 'rgba(34,197,94,0.2)',   color: '#22c55e' },
  short_delivered:  { label: 'Short',         bg: 'rgba(245,158,11,0.2)',  color: '#f59e0b' },
  not_delivered:    { label: 'Not Delivered', bg: 'rgba(239,68,68,0.2)',   color: '#ef4444' },
};

const STATUS_ORDER = ['pending', 'ordered', 'received', 'short_delivered', 'not_delivered'];

const ItemCard = ({ item, onClick, onStatusChange, onQuantityChange }) => {
  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
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
        onClick={() => { if (!menu) onClick(item); }}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        className="flex items-center gap-2 cursor-pointer bg-card border border-border/40 hover:bg-muted/60 transition-colors"
        style={{ padding: '8px 10px', marginBottom: 4, borderRadius: 6 }}
      >
        {/* Name */}
        <span
          className="text-foreground flex-1 min-w-0 truncate"
          style={{ fontSize: 13, fontWeight: 500 }}
        >
          {item.name || 'Untitled'}
        </span>

        {/* Qty controls */}
        <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={(e) => handleQty(e, -1)}
            style={{
              width: 20, height: 20, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: 'rgba(239,68,68,0.15)', color: '#ef4444',
              fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, padding: 0,
            }}
          >−</button>
          <span
            className="text-foreground text-center"
            style={{ fontSize: 13, fontWeight: 600, minWidth: 24 }}
          >
            {item.quantity_ordered ?? 0}
          </span>
          <button
            onClick={(e) => handleQty(e, 1)}
            style={{
              width: 20, height: 20, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: 'rgba(34,197,94,0.15)', color: '#22c55e',
              fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, padding: 0,
            }}
          >+</button>
        </div>

        {/* Status badge */}
        <span
          className="flex-shrink-0 uppercase"
          style={{
            fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
            background: cfg.bg, color: cfg.color,
          }}
        >
          {cfg.label}
        </span>
      </div>

      {/* Status context menu */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 py-1 rounded-lg shadow-2xl border border-border bg-card"
          style={{ top: menu.y, left: menu.x, minWidth: 160 }}
        >
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Set status</p>
          {STATUS_ORDER.map(s => {
            const c = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={(e) => { e.stopPropagation(); setMenu(null); if (onStatusChange) onStatusChange(item, s); }}
                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted flex items-center gap-2"
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, display: 'inline-block', flexShrink: 0 }} />
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

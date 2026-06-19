import React, { useState, useRef, useEffect } from 'react';
import { ITEM_STATUS_ORDER, getItemStatusConfig, deriveDisplayStatus } from '../data/statusConfig';

// Per-card status pill + right-click status picker. Pipes item + supplier_
// order_item + supplier_order through deriveDisplayStatus so the kanban
// pill matches the items-table pill exactly (single source of truth across
// surfaces). Right-click picker still iterates ITEM_STATUS_ORDER so it
// only offers crew-controllable states.

const ItemCard = ({ item, supplierOrderItem, supplierOrder, onClick, onStatusChange, onQuantityChange }) => {
  const derived = deriveDisplayStatus(item, supplierOrderItem, supplierOrder);
  const cfg = getItemStatusConfig(derived);
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

  // At-a-glance supplier pips. The hasNote pip lights when the supplier
  // left a note for this line (supplier_item_note); the hasChanges pip
  // lights when they overrode qty/unit/size from the crew's original
  // ask. Both compute upstream in supplierOrderIndex; their tooltips
  // here describe what changed so the chief doesn't need to drill in.
  const hasNote = !!supplierOrderItem?.hasNote;
  const hasChanges = !!supplierOrderItem?.hasChanges;
  const changeBits = [];
  if (supplierOrderItem?.qtyChanged) {
    changeBits.push(`Qty ${supplierOrderItem.requestedQuantity} → ${supplierOrderItem.quantity}`);
  }
  if (supplierOrderItem?.unitChanged) {
    changeBits.push(`Unit ${supplierOrderItem.requestedUnit} → ${supplierOrderItem.unit}`);
  }
  if (supplierOrderItem?.sizeChanged) {
    changeBits.push(`Size ${supplierOrderItem.requestedSize} → ${supplierOrderItem.size}`);
  }
  const changesTitle = changeBits.length > 0
    ? `Supplier changed:\n${changeBits.join('\n')}`
    : '';
  const noteTitle = hasNote ? `Note from supplier:\n"${supplierOrderItem.supplierNote}"` : '';

  // Lock inline editing on the kanban card the moment the supplier
  // has acted on the line (confirmed / substituted / unavailable) —
  // same gate the board items table uses. Changing qty / status
  // from the kanban after a supplier confirm would slip past the
  // reopen flow the chief is meant to use, and the supplier would
  // never see the change. To make a change, open the board and
  // reopen the line via the ↺ button.
  const supplierActed = !!supplierOrderItem
    && ['confirmed', 'substituted', 'unavailable'].includes(supplierOrderItem.status);
  const lockedTooltip = supplierActed
    ? 'Supplier has acted on this line — open the board and use ↺ Reopen to request a change.'
    : '';

  const handleContextMenuWithLock = (e) => {
    if (supplierActed) {
      e.preventDefault();
      return;
    }
    handleContextMenu(e);
  };
  const handleTouchStartWithLock = (e) => {
    if (supplierActed) return;
    handleTouchStart(e);
  };

  return (
    <>
      <div
        onClick={e => { e.stopPropagation(); if (!menu) onClick(item); }}
        onContextMenu={handleContextMenuWithLock}
        onTouchStart={handleTouchStartWithLock}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        className="pv-item"
      >
        {/* Name takes the freed width — single line, ellipsis only in the extreme */}
        <span className="pv-item-name">
          {item.name || 'Untitled'}
        </span>

        {/* Supplier pips — small inline indicators that the supplier
            wrote a note or overrode qty/unit/size on this line. Click
            still opens the drawer (event bubbles up to the parent). */}
        {(hasNote || hasChanges) && (
          <span className="pv-item-supplier-pips" aria-hidden="true">
            {hasChanges && (
              <span className="pv-item-pip pv-item-pip-changes" title={changesTitle}>
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
                </svg>
              </span>
            )}
            {hasNote && (
              <span className="pv-item-pip pv-item-pip-note" title={noteTitle}>
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="13" rx="2.5" />
                  <path d="M8 20l-1-3" />
                  <line x1="7.5" y1="9" x2="16.5" y2="9" />
                  <line x1="7.5" y1="13" x2="13.5" y2="13" />
                </svg>
              </span>
            )}
          </span>
        )}

        {/* Qty controls — stop propagation so taps on the stepper don't open the drawer.
            Locked + read-only once the supplier has acted (confirmed /
            substituted / unavailable). The number still renders for
            context; the +/- buttons disappear so the chief can't
            silently bump the qty behind the supplier's back. */}
        {supplierActed ? (
          <div
            className="pv-item-stepper pv-item-stepper-locked"
            onClick={e => e.stopPropagation()}
            title={lockedTooltip}
            style={{ opacity: 0.6 }}
          >
            <span className="pv-item-qty">{item.quantity_ordered ?? 0}</span>
          </div>
        ) : (
          <div className="pv-item-stepper" onClick={e => e.stopPropagation()}>
            <button onClick={(e) => handleQty(e, -1)} className="pv-item-stepbtn">−</button>
            <span className="pv-item-qty">{item.quantity_ordered ?? 0}</span>
            <button onClick={(e) => handleQty(e, 1)} className="pv-item-stepbtn">+</button>
          </div>
        )}

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

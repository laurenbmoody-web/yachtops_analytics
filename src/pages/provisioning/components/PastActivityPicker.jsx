import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { loadTrips, findTripByAnyId } from '../../trips-management-dashboard/utils/tripStorage';
import { fetchPastOrders, fetchQuickAddFavourites } from '../utils/provisioningStorage';

// ── PastActivityPicker ────────────────────────────────────────────────────
// Wizard step for starting a new board from anything you've done before.
// Three internal tabs covering the three "from past" data sources:
//
//   Boards     — your provisioning_lists. Multi-supplier, dept-grouped,
//                full-trip snapshots. Includes any items still in draft.
//                Supports guest-count scaling between trips.
//   Orders     — your supplier_orders chronological. Single-supplier,
//                only items that were actually dispatched. Strict snapshot
//                from the Quick Add migration (brand/size/category etc).
//   Favourites — CHIEF/HOD-starred subset of supplier_orders. Same RPC
//                the Quick Add panel uses.
//
// Replaces the previous two-tile setup (Copy Board + Past Order) — same
// surface, fewer top-level decisions. The user picks "from past" once,
// then browses by type. Frequent Items intentionally NOT included: that's
// items-grain augmentation, lives in the in-board Quick Add panel.
//
// Props:
//   tenantId       — current tenant/vessel id
//   newGuestCount  — guest count on the new trip (for Boards tab scaling)
//   onUse(items)   — called with mapped item array on confirm
//   onBack         — called when user clicks ← Back

export default function PastActivityPicker({ tenantId, newGuestCount = 0, onUse, onBack }) {
  const [tab, setTab] = useState('boards');  // 'boards' | 'orders' | 'favourites'

  // Boards tab state — mirrors the prior CopyBoardPicker behaviour
  const [boards, setBoards] = useState([]);
  const [boardSearch, setBoardSearch] = useState('');
  const [selectedBoardId, setSelectedBoardId] = useState(null);
  const [scaleQty, setScaleQty] = useState(true);

  // Orders + Favourites tab state — both consume the supplier_orders shape
  const [pastOrders, setPastOrders] = useState([]);
  const [favourites, setFavourites] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  // Load all three sources concurrently on mount. Boards is the heavier
  // query (item count + trip enrich per row); keeping the others' RPCs in
  // parallel so the picker is responsive on first paint.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const trips = (await loadTrips()) || [];

        const [boardsRes, past, favs] = await Promise.all([
          supabase
            ?.from('provisioning_lists')
            ?.select('id, title, created_at, trip_id, department')
            ?.eq('tenant_id', tenantId)
            ?.order('created_at', { ascending: false })
            ?.limit(30),
          fetchPastOrders(tenantId).catch(() => []),
          fetchQuickAddFavourites(tenantId).catch(() => []),
        ]);

        const enriched = await Promise.all((boardsRes?.data || []).map(async (board) => {
          const { count } = await supabase
            ?.from('provisioning_items')
            ?.select('id', { count: 'exact', head: true })
            ?.eq('list_id', board.id);
          let guestCount = 0;
          let tripName = null;
          if (board.trip_id) {
            const trip = findTripByAnyId(trips, board.trip_id);
            if (trip) {
              guestCount = trip.guests?.filter(g => g.isActive)?.length || trip.guests?.length || 0;
              tripName = trip.name || trip.title || null;
            }
          }
          return { ...board, _itemCount: count || 0, _guestCount: guestCount, _tripName: tripName };
        }));

        if (cancelled) return;
        setBoards(enriched);
        setPastOrders(past || []);
        setFavourites(favs || []);
      } catch (err) {
        console.error('[PastActivityPicker] load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  // Reset selection when switching tabs — selection is per-data-type.
  useEffect(() => {
    setSelectedBoardId(null);
    setSelectedOrderId(null);
  }, [tab]);

  const visibleBoards = boards.filter(b =>
    !boardSearch || b.title?.toLowerCase().includes(boardSearch.toLowerCase())
  );
  const visibleOrders = tab === 'orders' ? pastOrders : favourites;
  const selectedBoard = selectedBoardId ? boards.find(b => b.id === selectedBoardId) : null;
  const selectedOrder = selectedOrderId ? visibleOrders.find(o => o.id === selectedOrderId) : null;

  const hasSelection = tab === 'boards' ? !!selectedBoardId : !!selectedOrderId;
  const selectedItemCount = tab === 'boards'
    ? (selectedBoard?._itemCount || 0)
    : (Number(selectedOrder?.item_count) || 0);

  const handleApply = async () => {
    if (!hasSelection) return;
    setApplying(true);
    try {
      let items;
      if (tab === 'boards') {
        // Replicate the CopyBoardPicker shape — select the boat-side
        // provisioning_items snapshot, scale by guest count where the
        // user has opted in.
        const { data: sourceItems } = await supabase
          ?.from('provisioning_items')
          ?.select('name, category, department, quantity_ordered, unit, estimated_unit_cost, allergen_flags, notes, source')
          ?.eq('list_id', selectedBoardId);
        const sourceGuests = selectedBoard?._guestCount || 0;
        const shouldScale = scaleQty && sourceGuests > 0 && newGuestCount > 0 && sourceGuests !== newGuestCount;
        const scaleFactor = shouldScale ? newGuestCount / sourceGuests : 1;
        items = (sourceItems || []).map(item => ({
          name:             item.name,
          category:         item.category || null,
          department:       item.department || null,
          quantity_ordered: shouldScale
            ? Math.max(1, Math.ceil((item.quantity_ordered || 1) * scaleFactor))
            : (item.quantity_ordered || 1),
          unit:             item.unit || null,
          estimated_unit_cost: item.estimated_unit_cost || null,
          allergen_flags:   item.allergen_flags || null,
          notes:            item.notes || null,
          status:           'draft',
        }));
      } else {
        // Orders + Favourites — same supplier_order_items shape with the
        // Quick Add strict snapshot fields preserved.
        const { data: rows } = await supabase
          ?.from('supplier_order_items')
          ?.select('item_name, brand, size, category, sub_category, department, allergen_flags, quantity, unit')
          ?.eq('order_id', selectedOrderId);
        items = (rows || []).map(r => ({
          name:             r.item_name,
          brand:            r.brand || null,
          size:             r.size || null,
          category:         r.category || null,
          sub_category:     r.sub_category || null,
          department:       r.department || null,
          allergen_flags:   r.allergen_flags || null,
          quantity_ordered: r.quantity ?? 1,
          unit:             r.unit || null,
          status:           'draft',
        }));
      }
      onUse(items);
    } catch (err) {
      console.error('[PastActivityPicker] apply error:', err);
      setApplying(false);
    }
  };

  const fmtDate = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return ''; }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="pv-wizard-header" style={{ marginBottom: 12 }}>
        <button onClick={onBack} className="pv-wizard-back">← Back</button>
        <h3 className="pv-wizard-title">
          <span className="pv-wizard-title-dot" aria-hidden="true" />
          Start from past activity
        </h3>
      </div>

      {/* Tab pills — reuses .pv-wizard-pill from TemplatePicker */}
      <div className="pv-wizard-pill-row" style={{ marginBottom: 12 }}>
        <button
          onClick={() => setTab('boards')}
          className={`pv-wizard-pill${tab === 'boards' ? ' is-active' : ''}`}
        >Boards</button>
        <button
          onClick={() => setTab('orders')}
          className={`pv-wizard-pill${tab === 'orders' ? ' is-active' : ''}`}
        >Orders</button>
        <button
          onClick={() => setTab('favourites')}
          className={`pv-wizard-pill${tab === 'favourites' ? ' is-active' : ''}`}
        >Favourites</button>
      </div>

      {/* Boards tab — search + scrollable list */}
      {tab === 'boards' && (
        <>
          <input
            type="text"
            placeholder="Search boards…"
            value={boardSearch}
            onChange={e => setBoardSearch(e.target.value)}
            className="pv-wizard-input"
            style={{ marginBottom: 10 }}
          />
          <div className="pv-wizard-list">
            {loading && <p className="pv-wizard-empty">Loading boards…</p>}
            {!loading && visibleBoards.length === 0 && (
              <p className="pv-wizard-empty">No boards found.</p>
            )}
            {visibleBoards.map(board => {
              const isSelected = selectedBoardId === board.id;
              return (
                <button
                  key={board.id}
                  onClick={() => setSelectedBoardId(isSelected ? null : board.id)}
                  className={`pv-wizard-board-row${isSelected ? ' is-selected' : ''}`}
                >
                  <div className="pv-wizard-board-row-head">
                    <p className="pv-wizard-board-row-title">{board.title}</p>
                    <span className="pv-wizard-item-count">{board._itemCount} items</span>
                  </div>
                  <p className="pv-wizard-board-row-meta">
                    {fmtDate(board.created_at)}
                    {board._tripName ? ` · ${board._tripName}` : ''}
                    {board._guestCount > 0 ? ` · ${board._guestCount} guests` : ''}
                  </p>
                </button>
              );
            })}
          </div>
          {/* Guest-count scaling — only relevant on Boards tab where the
              source had a guest count and the new trip differs. */}
          {selectedBoard && selectedBoard._guestCount > 0 && newGuestCount > 0 && selectedBoard._guestCount !== newGuestCount && (
            <div className="pv-wizard-scale">
              <label className="pv-wizard-scale-label">
                <input
                  type="checkbox"
                  checked={scaleQty}
                  onChange={e => setScaleQty(e.target.checked)}
                />
                Adjust quantities for <strong>{newGuestCount} guests</strong> (was {selectedBoard._guestCount})
              </label>
            </div>
          )}
        </>
      )}

      {/* Orders + Favourites tabs — shared rendering, different data */}
      {(tab === 'orders' || tab === 'favourites') && (
        <div className="pv-wizard-list">
          {loading && <p className="pv-wizard-empty">Loading…</p>}
          {!loading && visibleOrders.length === 0 && (
            <p className="pv-wizard-empty">
              {tab === 'orders'
                ? 'No past orders yet. Send an order to a supplier and it’ll appear here.'
                : 'No favourited orders yet. Star an order from the Orders tab to add it here.'}
            </p>
          )}
          {visibleOrders.map(order => {
            const isSelected = selectedOrderId === order.id;
            const itemCount = Number(order.item_count) || 0;
            const depts = Array.isArray(order.departments) ? order.departments.filter(Boolean) : [];
            return (
              <button
                key={order.id}
                onClick={() => setSelectedOrderId(isSelected ? null : order.id)}
                className={`pv-wizard-board-row${isSelected ? ' is-selected' : ''}`}
              >
                <div className="pv-wizard-board-row-head">
                  <p className="pv-wizard-board-row-title">
                    {order.supplier_name || 'Supplier'}
                    {order.is_favourite && tab === 'orders' && (
                      <span style={{ color: '#C65A1A', marginLeft: 6 }}>★</span>
                    )}
                  </p>
                  <span className="pv-wizard-item-count">{itemCount} item{itemCount === 1 ? '' : 's'}</span>
                </div>
                <p className="pv-wizard-board-row-meta">
                  {fmtDate(order.sent_at || order.created_at)}
                  {depts.length > 0 ? ` · ${depts.join(', ')}` : ''}
                </p>
              </button>
            );
          })}
        </div>
      )}

      <div className="pv-wizard-cta-footer">
        <button
          onClick={handleApply}
          disabled={!hasSelection || applying}
          className="pv-wizard-btn pv-wizard-btn-primary is-block"
          style={applying ? { opacity: 0.7 } : null}
        >
          {applying
            ? 'Loading items…'
            : hasSelection
              ? (tab === 'boards' ? `Copy ${selectedItemCount} items` : `Use this order (${selectedItemCount} items)`)
              : (tab === 'boards' ? 'Select a board' : 'Select an order')}
        </button>
      </div>
    </div>
  );
}

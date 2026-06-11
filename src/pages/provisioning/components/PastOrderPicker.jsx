import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { fetchPastOrders, fetchQuickAddFavourites } from '../utils/provisioningStorage';

// ── PastOrderPicker ────────────────────────────────────────────────────────
// Wizard step for starting a new board from a previous supplier order.
// Two internal tabs:
//   Past Orders — dept-scoped chronological log of supplier orders sent
//                 from this tenant. Mirror of the Quick Add panel's tab.
//   Favourites  — CHIEF/HOD-starred subset of past orders. Same RPC the
//                 Quick Add Favourites tab uses.
// On apply, fetches the selected order's items, maps them to the provisioning_
// items shape (name, brand, size, category, sub_category, department,
// allergen_flags, quantity_ordered, unit, status='draft') and returns via
// onUse(items). The wizard then calls triggerCreate('past_order', items)
// which creates the new board with those items preloaded.
//
// Props:
//   tenantId       — current tenant/vessel id
//   onUse(items)   — called with mapped item array when user confirms
//   onBack         — called when user clicks ← Back

export default function PastOrderPicker({ tenantId, onUse, onBack }) {
  const [tab, setTab] = useState('past');              // 'past' | 'favourites'
  const [pastOrders, setPastOrders] = useState([]);
  const [favourites, setFavourites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);  // order id
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchPastOrders(tenantId).catch(() => []),
      fetchQuickAddFavourites(tenantId).catch(() => []),
    ]).then(([past, favs]) => {
      if (cancelled) return;
      setPastOrders(past || []);
      setFavourites(favs || []);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tenantId]);

  // Reset selection when switching tabs — same order may not appear in both.
  useEffect(() => { setSelectedId(null); }, [tab]);

  const visible = tab === 'past' ? pastOrders : favourites;
  const selectedOrder = selectedId ? visible.find(o => o.id === selectedId) : null;

  const handleApply = async () => {
    if (!selectedId) return;
    setApplying(true);
    try {
      // Pull the snapshot fields the Quick Add migration extended onto
      // supplier_order_items (brand/size/category/etc) so the new board's
      // items recover the full strict snapshot, not just name+qty.
      const { data: rows, error } = await supabase
        ?.from('supplier_order_items')
        ?.select('item_name, brand, size, category, sub_category, department, allergen_flags, quantity, unit')
        ?.eq('order_id', selectedId);
      if (error) throw error;

      const items = (rows || []).map(r => ({
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

      onUse(items);
    } catch (err) {
      console.error('[PastOrderPicker] apply error:', err);
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
          Start from a past order
        </h3>
      </div>

      {/* Tab pills — reuses the .pv-wizard-pill row pattern from TemplatePicker */}
      <div className="pv-wizard-pill-row" style={{ marginBottom: 12 }}>
        <button
          onClick={() => setTab('past')}
          className={`pv-wizard-pill${tab === 'past' ? ' is-active' : ''}`}
        >
          Past Orders
        </button>
        <button
          onClick={() => setTab('favourites')}
          className={`pv-wizard-pill${tab === 'favourites' ? ' is-active' : ''}`}
        >
          Favourites
        </button>
      </div>

      {/* Order list */}
      <div className="pv-wizard-list">
        {loading && <p className="pv-wizard-empty">Loading…</p>}
        {!loading && visible.length === 0 && (
          <p className="pv-wizard-empty">
            {tab === 'past'
              ? 'No past orders yet. Send an order to a supplier and it’ll appear here.'
              : 'No favourited orders yet. Star an order from the Orders tab to add it here.'}
          </p>
        )}
        {visible.map(order => {
          const isSelected = selectedId === order.id;
          const itemCount = Number(order.item_count) || 0;
          const depts = Array.isArray(order.departments) ? order.departments.filter(Boolean) : [];
          return (
            <button
              key={order.id}
              onClick={() => setSelectedId(isSelected ? null : order.id)}
              className={`pv-wizard-board-row${isSelected ? ' is-selected' : ''}`}
            >
              <div className="pv-wizard-board-row-head">
                <p className="pv-wizard-board-row-title">
                  {order.supplier_name || 'Supplier'}
                  {order.is_favourite && tab === 'past' && (
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

      {/* CTA */}
      <div className="pv-wizard-cta-footer">
        <button
          onClick={handleApply}
          disabled={!selectedId || applying}
          className="pv-wizard-btn pv-wizard-btn-primary is-block"
          style={applying ? { opacity: 0.7 } : null}
        >
          {applying
            ? 'Loading items…'
            : selectedOrder
              ? `Use this order (${Number(selectedOrder.item_count) || 0} items)`
              : 'Select an order'}
        </button>
      </div>
    </div>
  );
}

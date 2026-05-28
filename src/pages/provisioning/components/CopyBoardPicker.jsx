import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { loadTrips, findTripByAnyId } from '../../trips-management-dashboard/utils/tripStorage';

// ── CopyBoardPicker ────────────────────────────────────────────────────────
// Modal for copying items from a previous board onto a new board.
// Props:
//   tenantId        — current tenant/vessel id
//   department      — user's department (used to pre-filter boards)
//   newGuestCount   — guest count on the new trip (for proportional scaling)
//   onUse(items)    — called with items array (possibly scaled) when confirmed
//   onBack          — called when user clicks ← Back

export default function CopyBoardPicker({ tenantId, department, newGuestCount = 0, onUse, onBack }) {
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);      // board id
  const [scaleQty, setScaleQty] = useState(true);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      setLoading(true);
      try {
        const { data: lists } = await supabase
          ?.from('provisioning_lists')
          ?.select('id, title, created_at, trip_id, department')
          ?.eq('tenant_id', tenantId)
          ?.order('created_at', { ascending: false })
          ?.limit(30);

        const trips = (await loadTrips()) || [];

        const enriched = await Promise.all((lists || []).map(async (board) => {
          // Item count
          const { count } = await supabase
            ?.from('provisioning_items')
            ?.select('id', { count: 'exact', head: true })
            ?.eq('list_id', board.id);

          // Trip info
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

        setBoards(enriched);
      } catch (err) {
        console.error('[CopyBoardPicker] load error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantId]);

  const filtered = boards.filter(b =>
    !search || b.title?.toLowerCase().includes(search.toLowerCase())
  );

  const selectedBoard = selected ? boards.find(b => b.id === selected) : null;

  const handleCopy = async () => {
    if (!selected) return;
    setCopying(true);
    try {
      const { data: sourceItems } = await supabase
        ?.from('provisioning_items')
        ?.select('name, category, department, quantity_ordered, unit, estimated_unit_cost, allergen_flags, notes, source')
        ?.eq('list_id', selected);

      const sourceGuests = selectedBoard?._guestCount || 0;
      const shouldScale = scaleQty && sourceGuests > 0 && newGuestCount > 0 && sourceGuests !== newGuestCount;
      const scaleFactor = shouldScale ? newGuestCount / sourceGuests : 1;

      const items = (sourceItems || []).map(item => ({
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

      onUse(items);
    } catch (err) {
      console.error('[CopyBoardPicker] copy error:', err);
    } finally {
      setCopying(false);
    }
  };

  const fmtDate = (iso) => {
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return ''; }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="pv-wizard-header" style={{ marginBottom: 12 }}>
        <button onClick={onBack} className="pv-wizard-back">← Back</button>
        <h3 className="pv-wizard-title">
          <span className="pv-wizard-title-dot" aria-hidden="true" />
          Copy from previous board
        </h3>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search boards…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="pv-wizard-input"
        style={{ marginBottom: 10 }}
      />

      {/* Board list */}
      <div className="pv-wizard-list">
        {loading && <p className="pv-wizard-empty">Loading boards…</p>}
        {!loading && filtered.length === 0 && (
          <p className="pv-wizard-empty">No boards found.</p>
        )}
        {filtered.map(board => {
          const isSelected = selected === board.id;
          return (
            <button
              key={board.id}
              onClick={() => setSelected(isSelected ? null : board.id)}
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

      {/* Scale option */}
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

      {/* CTA */}
      <div className="pv-wizard-cta-footer">
        <button
          onClick={handleCopy}
          disabled={!selected || copying}
          className="pv-wizard-btn pv-wizard-btn-primary is-block"
          style={copying ? { opacity: 0.7 } : null}
        >
          {copying
            ? 'Copying…'
            : selected
            ? `Copy ${selectedBoard?._itemCount ?? 0} items`
            : 'Select a board'}
        </button>
      </div>
    </div>
  );
}

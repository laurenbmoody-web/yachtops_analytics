import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { loadTrips } from '../../trips-management-dashboard/utils/tripStorage';

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

        const trips = loadTrips() || [];

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
            const trip = trips.find(t => t.id === board.trip_id);
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
        status:           'pending',
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: '2px 4px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 3 }}
        >
          ← Back
        </button>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Copy from previous board</span>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search boards…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#0F172A', boxSizing: 'border-box', marginBottom: 10, outline: 'none' }}
      />

      {/* Board list */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 2 }}>
        {loading && <p style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', marginTop: 20 }}>Loading boards…</p>}
        {!loading && filtered.length === 0 && (
          <p style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', marginTop: 20 }}>No boards found.</p>
        )}
        {filtered.map(board => {
          const isSelected = selected === board.id;
          return (
            <button
              key={board.id}
              onClick={() => setSelected(isSelected ? null : board.id)}
              style={{
                textAlign: 'left', padding: '9px 12px', borderRadius: 10,
                border: isSelected ? '1.5px solid #1E3A5F' : '1px solid #E2E8F0',
                background: isSelected ? '#EFF6FF' : 'white',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#0F172A' }}>{board.title}</p>
                <span style={{ fontSize: 10, color: '#94A3B8', whiteSpace: 'nowrap', marginLeft: 8 }}>
                  {board._itemCount} items
                </span>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 11, color: '#94A3B8' }}>
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
        <div style={{ marginTop: 10, padding: '8px 10px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#475569' }}>
            <input
              type="checkbox"
              checked={scaleQty}
              onChange={e => setScaleQty(e.target.checked)}
              style={{ width: 14, height: 14, cursor: 'pointer' }}
            />
            Adjust quantities for <strong>{newGuestCount} guests</strong> (was {selectedBoard._guestCount})
          </label>
        </div>
      )}

      {/* CTA */}
      <div style={{ paddingTop: 10, borderTop: '1px solid #F1F5F9', marginTop: 10 }}>
        <button
          onClick={handleCopy}
          disabled={!selected || copying}
          style={{
            width: '100%', padding: '9px 0', borderRadius: 8, border: 'none',
            cursor: selected && !copying ? 'pointer' : 'default',
            background: selected ? '#1E3A5F' : '#E2E8F0',
            color: selected ? 'white' : '#94A3B8',
            fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
            opacity: copying ? 0.7 : 1,
          }}
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

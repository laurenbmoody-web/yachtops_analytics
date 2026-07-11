// "What's inside" — the one place a pin's inventory lives. Two ways in, one
// list out:
//   • Add an item — search inventory, tap to attach it here.
//   • Link a cupboard — point the pin at an inventory location; its live
//     contents flow into the same list.
// Every line shows the LIVE count (at the pin's cupboard, else onboard) with
// −/+ steppers — the quick-check the crew do at a shelf or box. Counts always
// come from inventory; the pin stores only which items/cupboard, never a
// number, so nothing goes stale.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updateDetailKey } from '../utils/hotspotDetail';
import {
  searchInventoryItems, searchInventoryLocations, getInventoryItem,
  getInventoryLocation, itemsAtLocation, quantityAt, setQuantityHere, locationLabel,
} from '../utils/inventory';

export default function PinItems({ hotspot, canManage, tenantId, onDetailSaved, onLocationChanged }) {
  const attached = hotspot?.detail?.items || []; // [{ id, item_id, label }]
  const locId = hotspot?.storage_location_id || null;
  const attachedKey = attached.map((i) => i.item_id).join(',');

  const [loc, setLoc] = useState(null);      // linked cupboard row (or null)
  const [rows, setRows] = useState(null);    // unified list; null = loading
  const [mode, setMode] = useState(null);    // 'item' | 'cupboard' | null
  const [query, setQuery] = useState('');
  const [itemResults, setItemResults] = useState([]);
  const [locResults, setLocResults] = useState([]);
  const [busy, setBusy] = useState(null);    // item_id mid-adjust
  const [error, setError] = useState(null);
  const debounce = useRef(null);
  const locRef = useRef(null);
  const writeQueue = useRef(Promise.resolve());
  const navigate = useNavigate();

  useEffect(() => { setMode(null); setQuery(''); setItemResults([]); setLocResults([]); setError(null); }, [hotspot?.id]);

  // Build the unified list: the linked cupboard's live items first, then any
  // directly-attached items not already covered by it.
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    (async () => {
      let locRow = null;
      let cupboardItems = [];
      if (locId) {
        const { location } = await getInventoryLocation(locId);
        locRow = location || null;
        if (locRow) {
          const { items } = await itemsAtLocation(tenantId, locRow);
          cupboardItems = items || [];
        }
      }
      if (cancelled) return;
      setLoc(locRow);
      locRef.current = locRow;

      const ids = [...new Set([...cupboardItems.map((c) => c.id), ...attached.map((a) => a.item_id)])];
      const fetched = await Promise.all(ids.map((id) => getInventoryItem(id).then((r) => r.item).catch(() => null)));
      if (cancelled) return;
      const byId = Object.fromEntries(fetched.filter(Boolean).map((it) => [it.id, it]));

      const seen = new Set();
      const out = [];
      for (const ci of cupboardItems) {
        if (seen.has(ci.id)) continue;
        seen.add(ci.id);
        const item = byId[ci.id];
        const q = item ? quantityAt(item, locRow) : { qty: ci.quantity ?? 0, where: 'here' };
        out.push({ item_id: ci.id, label: item?.name || ci.name, qty: q.qty, where: q.where, unit: item?.unit ?? ci.unit ?? null, source: 'cupboard' });
      }
      for (const a of attached) {
        if (seen.has(a.item_id)) continue;
        seen.add(a.item_id);
        const item = byId[a.item_id];
        const q = item ? quantityAt(item, locRow) : { qty: 0, where: locRow ? 'here' : 'onboard' };
        out.push({ item_id: a.item_id, label: item?.name || a.label, qty: q.qty, where: q.where, unit: item?.unit ?? null, source: 'attached', attachId: a.id });
      }
      if (!cancelled) setRows(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotspot?.id, locId, attachedKey, tenantId]);

  // Debounced search for whichever picker is open.
  useEffect(() => {
    if (mode !== 'item') return undefined;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const { items, error: e } = await searchInventoryItems(tenantId, query);
      if (e) setError(e); else setItemResults(items || []);
    }, 250);
    return () => clearTimeout(debounce.current);
  }, [mode, query, tenantId]);
  useEffect(() => {
    if (mode !== 'cupboard') return undefined;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const { locations, error: e } = await searchInventoryLocations(tenantId, query);
      if (e) setError(e); else setLocResults(locations || []);
    }, 250);
    return () => clearTimeout(debounce.current);
  }, [mode, query, tenantId]);

  const queued = (mutate) => {
    const run = writeQueue.current.then(async () => {
      const res = await updateDetailKey(hotspot.id, 'items', mutate);
      if (res.error) { setError(res.error); return; }
      onDetailSaved(hotspot.id, res.detail);
    });
    writeQueue.current = run.catch(() => {});
    return run;
  };

  const addItem = (inv) => {
    setMode(null); setQuery(''); setItemResults([]); setError(null);
    if (rows?.some((r) => r.item_id === inv.id)) return;
    queued((arr) => (arr.some((i) => i.item_id === inv.id) ? arr : [...arr, { id: crypto.randomUUID(), item_id: inv.id, label: inv.name }]));
  };
  const removeAttached = (attachId) => queued((arr) => arr.filter((i) => i.id !== attachId));
  const linkCupboard = (locRow) => { setMode(null); setQuery(''); setLocResults([]); onLocationChanged(hotspot.id, locRow.id); };
  const unlinkCupboard = () => onLocationChanged(hotspot.id, null);

  // −/+ writes the new count to inventory, then re-reads the live number.
  const bump = async (row, delta) => {
    if (busy) return;
    const nextQty = Math.max(0, (Number(row.qty) || 0) + delta);
    setBusy(row.item_id); setError(null);
    const { error: e } = await setQuantityHere(row.item_id, locRef.current, nextQty);
    if (e) { setError(e); setBusy(null); return; }
    const { item } = await getInventoryItem(row.item_id);
    if (item) setRows((rs) => rs.map((r) => (r.item_id === row.item_id ? { ...r, ...quantityAt(item, locRef.current), unit: item.unit || null } : r)));
    setBusy(null);
  };

  const showEmpty = rows !== null && rows.length === 0 && !mode;

  return (
    <div className="vm-pinitems">
      <p className="vm-label">What’s inside</p>

      {loc && (
        <p className="vm-pinitems-cupboard">
          from <strong>{locationLabel(loc)}</strong>
          {canManage && <button className="vm-cupboard-unlink" onClick={unlinkCupboard} aria-label="Unlink cupboard">Unlink</button>}
        </p>
      )}

      {rows === null && <p className="vm-payload-empty">Loading…</p>}
      {showEmpty && <p className="vm-payload-empty">Nothing inside yet{canManage ? ' — add an item below.' : '.'}</p>}

      {rows && rows.length > 0 && (
        <div className="vm-pinitems-list">
          {rows.map((r) => (
            <div key={r.item_id} className="vm-pinitem">
              <button className="vm-pinitem-name" onClick={() => navigate(`/inventory/item/${r.item_id}`)} title="View in inventory">
                {r.label}
              </button>
              {canManage ? (
                <span className="vm-pinitem-step">
                  <button className="vm-pinitem-btn" onClick={() => bump(r, -1)} disabled={busy === r.item_id || r.qty <= 0} aria-label={`One fewer ${r.label}`}>–</button>
                  <span className="vm-pinitem-qty">{r.qty}{r.unit ? ` ${r.unit}` : ''}</span>
                  <button className="vm-pinitem-btn" onClick={() => bump(r, 1)} disabled={busy === r.item_id} aria-label={`One more ${r.label}`}>+</button>
                </span>
              ) : (
                <span className="vm-pinitem-qty vm-pinitem-qty-read">{r.qty}{r.unit ? ` ${r.unit}` : ''} {r.where}</span>
              )}
              {canManage && r.source === 'attached' && (
                <button className="vm-pinitem-del" onClick={() => removeAttached(r.attachId)} aria-label={`Remove ${r.label}`}>×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && mode === 'item' && (
        <div className="vm-cupboard-picker">
          <input className="vm-check-input" placeholder="Search inventory — “torch”…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          {itemResults.map((r) => {
            const already = rows?.some((x) => x.item_id === r.id);
            return (
              <button key={r.id} className="vm-cupboard-result" onClick={() => addItem(r)} disabled={already}>
                {r.name}{r.quantity != null ? ` · ${r.quantity}${r.unit ? ` ${r.unit}` : ''}` : ''}{already ? ' · added' : ''}
              </button>
            );
          })}
          <button className="vm-cupboard-cancel" onClick={() => { setMode(null); setQuery(''); }}>Cancel</button>
        </div>
      )}

      {canManage && mode === 'cupboard' && (
        <div className="vm-cupboard-picker">
          <input className="vm-check-input" placeholder="Search cupboards — “bridge pantry”…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          {locResults.map((r) => (
            <button key={r.id} className="vm-cupboard-result" onClick={() => linkCupboard(r)}>{locationLabel(r)}</button>
          ))}
          <button className="vm-cupboard-cancel" onClick={() => { setMode(null); setQuery(''); }}>Cancel</button>
        </div>
      )}

      {canManage && !mode && (
        <div className="vm-pinitems-actions">
          <button className="vm-btn-ghost vm-pinitems-add" onClick={() => { setMode('item'); setQuery(''); }}>+ Add an item</button>
          {!loc && <button className="vm-pinitems-link" onClick={() => { setMode('cupboard'); setQuery(''); }}>or link a cupboard</button>}
        </div>
      )}

      {error && <p className="vm-payload-error">{error}</p>}
    </div>
  );
}

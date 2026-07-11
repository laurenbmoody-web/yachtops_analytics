// "What's inside" — the items physically stored at this pin. A pin IS a
// physical location (the room the scan covers › the pin's own label, e.g.
// "Bridge Salon › Port side cupboard"), so adding an item files it HERE and
// the −/+ steppers adjust how many are here — writing straight to that item's
// stock in inventory. The pin remembers WHICH items are here (detail.items);
// the count and the item's category both come live from inventory, so nothing
// goes stale. Category (Guest › Alcohol › Wine) is a property of the item,
// shown as subtext — not a place.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updateDetailKey } from '../utils/hotspotDetail';
import {
  searchInventoryItems, getInventoryItem, quantityAt, setQuantityHere, categoryPath,
} from '../utils/inventory';

export default function PinItems({ hotspot, canManage, tenantId, onDetailSaved, locationRoot }) {
  const attached = hotspot?.detail?.items || []; // [{ id, item_id, label }]
  const attachedKey = attached.map((i) => i.item_id).join(',');
  // The pin's physical spot: the scan's room › this pin's label.
  const pinLoc = locationRoot
    ? { location: locationRoot, sub_location: hotspot?.label ? hotspot.label.trim() : null }
    : null;
  const hereLabel = [locationRoot, hotspot?.label?.trim()].filter(Boolean).join(' › ');

  const [rows, setRows] = useState(null); // [{ item_id, label, qty, unit, category, attachId }]
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const debounce = useRef(null);
  const pinLocRef = useRef(pinLoc);
  pinLocRef.current = pinLoc;
  const writeQueue = useRef(Promise.resolve());
  const navigate = useNavigate();

  useEffect(() => { setAdding(false); setQuery(''); setResults([]); setError(null); }, [hotspot?.id]);

  // Load each attached item's live count (here) and category.
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    (async () => {
      const fetched = await Promise.all(attached.map((a) => getInventoryItem(a.item_id).then((r) => r.item).catch(() => null)));
      if (cancelled) return;
      const out = attached.map((a, i) => {
        const item = fetched[i];
        const q = item ? quantityAt(item, pinLoc) : { qty: 0, where: pinLoc ? 'here' : 'onboard' };
        return { item_id: a.item_id, attachId: a.id, label: item?.name || a.label, qty: q.qty, where: q.where, unit: item?.unit || null, category: categoryPath(item) };
      });
      if (!cancelled) setRows(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotspot?.id, hotspot?.label, attachedKey, tenantId]);

  useEffect(() => {
    if (!adding) return undefined;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const { items, error: e } = await searchInventoryItems(tenantId, query);
      if (e) setError(e); else setResults(items || []);
    }, 250);
    return () => clearTimeout(debounce.current);
  }, [adding, query, tenantId]);

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
    setAdding(false); setQuery(''); setResults([]); setError(null);
    if (attached.some((i) => i.item_id === inv.id)) return;
    queued((arr) => (arr.some((i) => i.item_id === inv.id) ? arr : [...arr, { id: crypto.randomUUID(), item_id: inv.id, label: inv.name }]));
  };
  const removeItem = (attachId) => queued((arr) => arr.filter((i) => i.id !== attachId));

  // −/+ writes the new count here (this pin's spot) back to inventory.
  const bump = async (row, delta) => {
    if (busy) return;
    const nextQty = Math.max(0, (Number(row.qty) || 0) + delta);
    setBusy(row.item_id); setError(null);
    const { error: e } = await setQuantityHere(row.item_id, pinLocRef.current, nextQty);
    if (e) { setError(e); setBusy(null); return; }
    const { item } = await getInventoryItem(row.item_id);
    if (item) setRows((rs) => rs.map((r) => (r.item_id === row.item_id ? { ...r, ...quantityAt(item, pinLocRef.current), unit: item.unit || null } : r)));
    setBusy(null);
  };

  return (
    <div className="vm-pinitems">
      <p className="vm-label">What’s inside</p>
      {hereLabel && <p className="vm-pinitems-here">stored at <strong>{hereLabel}</strong></p>}

      {rows === null && <p className="vm-payload-empty">Loading…</p>}
      {rows !== null && rows.length === 0 && !adding && (
        <p className="vm-payload-empty">Nothing here yet{canManage ? ' — add an item below.' : '.'}</p>
      )}

      {rows && rows.length > 0 && (
        <div className="vm-pinitems-list">
          {rows.map((r) => (
            <div key={r.item_id} className="vm-pinitem">
              <span className="vm-pinitem-main">
                <button className="vm-pinitem-name" onClick={() => navigate(`/inventory/item/${r.item_id}`)} title="View in inventory">
                  {r.label}
                </button>
                {r.category && <span className="vm-pinitem-cat">{r.category}</span>}
              </span>
              {canManage ? (
                <span className="vm-pinitem-step">
                  <button className="vm-pinitem-btn" onClick={() => bump(r, -1)} disabled={busy === r.item_id || r.qty <= 0} aria-label={`One fewer ${r.label}`}>–</button>
                  <span className="vm-pinitem-qty">{r.qty}{r.unit ? ` ${r.unit}` : ''}</span>
                  <button className="vm-pinitem-btn" onClick={() => bump(r, 1)} disabled={busy === r.item_id} aria-label={`One more ${r.label}`}>+</button>
                </span>
              ) : (
                <span className="vm-pinitem-qty vm-pinitem-qty-read">{r.qty}{r.unit ? ` ${r.unit}` : ''} {r.where}</span>
              )}
              {canManage && (
                <button className="vm-pinitem-del" onClick={() => removeItem(r.attachId)} aria-label={`Remove ${r.label}`}>×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (adding ? (
        <div className="vm-cupboard-picker">
          <input className="vm-check-input" placeholder="Search inventory — “wine”…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          {results.map((r) => {
            const already = attached.some((i) => i.item_id === r.id);
            const cat = categoryPath(r);
            return (
              <button key={r.id} className="vm-cupboard-result" onClick={() => addItem(r)} disabled={already}>
                {r.name}{cat ? ` · ${cat}` : ''}{already ? ' · added' : ''}
              </button>
            );
          })}
          <button className="vm-cupboard-cancel" onClick={() => { setAdding(false); setQuery(''); }}>Cancel</button>
        </div>
      ) : (
        <button className="vm-btn-ghost vm-pinitems-add" onClick={() => { setAdding(true); setQuery(''); }}>+ Add an item</button>
      ))}

      {error && <p className="vm-payload-error">{error}</p>}
    </div>
  );
}

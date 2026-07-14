// "What's inside" — a read-out of the inventory items physically at this pin.
//
// The map is the VIEW of where things are; you normally set an item's location
// from its Location section in Inventory. This panel shows what's here and lets
// you correct the count during a stock-take:
//   • the count shown is how many are HERE, not the grand total;
//   • −/+ recounts what's on this pin (the delta flows to the item's total);
//   • tapping a name opens the item's quick view.
//
// When the map was opened from an item's Location ("Set location on the map"),
// `placingItem` is set — each pin then offers "Place <item> here", which links
// the item to this pin's node (resolving the node lazily if needed).
import React, { useEffect, useState } from 'react';
import { categoryPath } from '../utils/inventory';
import { itemsAtNode, setPinCount, clearItemNode, placeStock, resolvePinNode } from '../utils/placement';
import ItemDrawer from './ItemDrawer';

export default function PinItems({
  hotspot, canManage, tenantId, userId, scanSpaceId, scanName, containerTrail = [],
  onNodeResolved, placingItem, onPlaced,
}) {
  const [nodeId, setNodeId] = useState(hotspot?.location_node_id || null);
  const [rows, setRows] = useState(null);       // items here; null = loading
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [placeQty, setPlaceQty] = useState('');
  const [openItem, setOpenItem] = useState(null); // itemId shown in the quick-view drawer

  // The stock location's display name = the pin's full path, so pins in the
  // same room don't collide into identical "Main Galley" entries.
  const pinName = [scanName, ...containerTrail.map((c) => c.label), hotspot?.label]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' › ') || (scanName || 'this pin');

  useEffect(() => { setNodeId(hotspot?.location_node_id || null); setError(null); setPlaceQty(''); }, [hotspot?.id]);

  const load = async (nid) => {
    if (!nid) { setRows([]); return; }
    const { items, error: e } = await itemsAtNode(tenantId, nid);
    if (e) { setError(e); setRows([]); return; }
    setRows(items.map((it) => ({
      id: it.id, name: it.name, qty: it.pinQty, unit: it.unit || null, category: categoryPath(it),
    })));
  };
  useEffect(() => { setRows(null); load(hotspot?.location_node_id || null); /* eslint-disable-next-line */ }, [hotspot?.id, hotspot?.location_node_id, tenantId]);

  // Resolve this pin's location node, creating the room › container › pin chain
  // if it doesn't exist yet (a pin that never held anything has no node).
  const ensureNode = async () => {
    if (nodeId) return nodeId;
    const { nodeId: nid, patched, error: e } = await resolvePinNode({
      tenantId, userId, rootSpaceId: scanSpaceId, rootName: scanName,
      trail: containerTrail.map((c) => ({ id: c.id, label: c.label, location_node_id: c.location_node_id })),
      pin: { id: hotspot.id, label: hotspot.label, location_node_id: hotspot.location_node_id },
    });
    if (e) { setError(e); return null; }
    (patched || []).forEach((pp) => onNodeResolved?.(pp.hotspotId, pp.nodeId));
    setNodeId(nid);
    return nid;
  };

  // "Set location on the map" landed here → link the item to this pin.
  const placeHere = async () => {
    if (!placingItem) return;
    setBusy('place'); setError(null);
    const nid = await ensureNode();
    if (!nid) { setBusy(null); return; }
    const addNew = Number(placeQty) || 0;
    const { error: e } = await placeStock(placingItem.id, { pin: { nodeId: nid, name: pinName }, addNew, moves: [] });
    setBusy(null);
    if (e) { setError(e); return; }
    await load(nid);
    onPlaced?.();
  };

  // Correct how many are on this pin (a stock-take). The delta flows to the
  // item's grand total; the item's Location in Inventory stays the source of truth.
  const bump = async (row, delta) => {
    if (busy) return;
    const next = Math.max(0, (Number(row.qty) || 0) + delta);
    setBusy(row.id); setError(null);
    const { error: e } = await setPinCount(row.id, { pin: { nodeId, name: pinName }, newQty: next });
    setBusy(null);
    if (e) { setError(e); return; }
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, qty: next } : r)));
  };

  // "Not here" — drop this pin from the item's locations (its total is unchanged).
  const removeItem = async (itemId) => {
    setBusy(itemId);
    const { error: e } = await clearItemNode(itemId, { nodeId, name: pinName });
    setBusy(null);
    if (e) { setError(e); return; }
    setRows((rs) => (rs || []).filter((r) => r.id !== itemId));
  };

  return (
    <div className="vm-pinitems">
      <p className="vm-label">What’s inside</p>

      {/* Placing an item from its Inventory Location — the pin's primary action. */}
      {canManage && placingItem && (
        <div className="vm-pinitems-place">
          <p className="vm-pinitems-place-lead">Place <strong>{placingItem.name}</strong> on this pin</p>
          <div className="vm-pinitems-new-row">
            <input className="vm-check-input vm-pinitems-new-qty" type="number" min="0" placeholder="Qty" value={placeQty} onChange={(e) => setPlaceQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') placeHere(); }} autoFocus />
            <button className="vm-btn-primary" onClick={placeHere} disabled={busy === 'place'}>{busy === 'place' ? 'Placing…' : 'Place here'}</button>
          </div>
        </div>
      )}

      {rows === null && <p className="vm-payload-empty">Loading…</p>}
      {rows !== null && rows.length === 0 && (
        <p className="vm-payload-empty">Nothing here yet.</p>
      )}

      {rows && rows.length > 0 && (
        <div className="vm-pinitems-list">
          {rows.map((r) => {
            let segs = r.category ? r.category.split(' › ') : [];
            if (segs.length && segs[segs.length - 1].trim().toLowerCase() === (r.name || '').trim().toLowerCase()) {
              segs = segs.slice(0, -1);
            }
            const leaf = segs.pop();
            const head = segs.join(' · ');
            return (
              <div className="vm-pinitem" key={r.id}>
                <div className="vm-pinitem-top">
                  <button className="vm-pinitem-name" onClick={() => setOpenItem(r.id)} title="Quick view">{r.name}</button>
                  {canManage && (
                    <button className="vm-pinitem-del" onClick={() => removeItem(r.id)} aria-label={`${r.name} is not here`} title="Not here anymore">×</button>
                  )}
                </div>
                {leaf ? (
                  <span className="vm-pinitem-cat">
                    {head && <span className="vm-pinitem-cat-head">{head} · </span>}
                    <span className="vm-pinitem-cat-leaf">{leaf}</span>
                  </span>
                ) : (
                  <span className="vm-pinitem-cat"><span className="vm-pinitem-cat-head">Uncategorised</span></span>
                )}
                <div className="vm-pinitem-ctrls">
                  {canManage ? (
                    <span className="vm-pinitem-here">
                      <span className="vm-pinitem-here-lbl">Here</span>
                      <span className="vm-pinitem-step">
                        <button className="vm-pinitem-btn" onClick={() => bump(r, -1)} disabled={busy === r.id || r.qty <= 0} aria-label={`One fewer ${r.name}`}>–</button>
                        <span className="vm-pinitem-qty">{r.qty}</span>
                        <button className="vm-pinitem-btn" onClick={() => bump(r, 1)} disabled={busy === r.id} aria-label={`One more ${r.name}`}>+</button>
                      </span>
                    </span>
                  ) : (
                    <span className="vm-pinitem-here"><span className="vm-pinitem-here-lbl">Here</span> <span className="vm-pinitem-qty vm-pinitem-qty-read">{r.qty}</span></span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canManage && !placingItem && (
        <p className="vm-pinitems-note">
          To place an item here, open it in <strong>Inventory</strong> and set its location to this pin.
        </p>
      )}

      {error && <p className="vm-payload-error">{error}</p>}

      {openItem && (
        <ItemDrawer itemId={openItem} onClose={() => { setOpenItem(null); load(nodeId); }} />
      )}
    </div>
  );
}

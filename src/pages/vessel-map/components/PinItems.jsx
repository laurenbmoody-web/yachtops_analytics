// "What's inside" — the inventory items physically at this pin, and how many.
// A pin is a node in the physical-location tree; an item can hold stock at the
// pin (a stock_locations entry keyed by the node) alongside stock elsewhere.
// So:
//   • the count shown is how many are HERE, not the grand total;
//   • adding an item opens a transfer — receive new stock here and/or move
//     existing stock in from its other places (see the maths in stockMath.js);
//   • creating a new item receives all of it here;
//   • −/+ recounts what's on the pin;
//   • category (the item's inventory folder) rides along as subtext.
import React, { useEffect, useRef, useState } from 'react';
import { searchInventoryItems, searchInventoryLocations, locationLabel, categoryPath } from '../utils/inventory';
import { sources as sourcesOf, pinQty } from '../utils/stockMath';
import {
  resolvePinNode, itemsAtNode, itemStock, placeStock, setPinCount,
  clearItemNode, createItemAtNode,
} from '../utils/placement';
import ItemDrawer from './ItemDrawer';

export default function PinItems({
  hotspot, canManage, tenantId, userId,
  scanSpaceId, scanName, containerTrail = [], onNodeResolved,
}) {
  const [nodeId, setNodeId] = useState(hotspot?.location_node_id || null);
  const [rows, setRows] = useState(null);       // items here; null = loading
  const [mode, setMode] = useState(null);       // 'add' | 'create' | null
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [transfer, setTransfer] = useState(null); // { item, total, existing, sources, addNew, moves }
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newCat, setNewCat] = useState(null);
  const [catPicking, setCatPicking] = useState(false);
  const [catQuery, setCatQuery] = useState('');
  const [catResults, setCatResults] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [openItem, setOpenItem] = useState(null); // itemId shown in the quick-view drawer
  const debounce = useRef(null);
  const catDebounce = useRef(null);

  // The stock location's display name = the pin's full path, so pins in the
  // same room don't collide into identical "Main Galley" entries.
  const pinName = [scanName, ...containerTrail.map((c) => c.label), hotspot?.label]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' › ') || (scanName || 'this pin');

  const resetAll = () => {
    setMode(null); setQuery(''); setResults([]); setTransfer(null); setError(null);
    setNewName(''); setNewQty(''); setNewCat(null); setCatPicking(false); setCatQuery(''); setCatResults([]);
  };
  useEffect(() => { setNodeId(hotspot?.location_node_id || null); resetAll(); }, [hotspot?.id]);

  const load = async (nid) => {
    if (!nid) { setRows([]); return; }
    const { items, error: e } = await itemsAtNode(tenantId, nid);
    if (e) { setError(e); setRows([]); return; }
    setRows(items.map((it) => ({ id: it.id, name: it.name, qty: it.pinQty, unit: it.unit || null, category: categoryPath(it) })));
  };
  useEffect(() => { setRows(null); load(hotspot?.location_node_id || null); /* eslint-disable-next-line */ }, [hotspot?.id, hotspot?.location_node_id, tenantId]);

  useEffect(() => {
    if (mode !== 'add') return undefined;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const { items, error: e } = await searchInventoryItems(tenantId, query);
      if (e) setError(e); else setResults(items || []);
    }, 250);
    return () => clearTimeout(debounce.current);
  }, [mode, query, tenantId]);

  useEffect(() => {
    if (!catPicking) return undefined;
    clearTimeout(catDebounce.current);
    catDebounce.current = setTimeout(async () => {
      const { locations, error: e } = await searchInventoryLocations(tenantId, catQuery);
      if (e) setError(e); else setCatResults(locations || []);
    }, 250);
    return () => clearTimeout(catDebounce.current);
  }, [catPicking, catQuery, tenantId]);

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

  // Open the transfer panel for an item — from a search result (add) or from
  // an existing row's ▾ (move more in without re-searching). forRow renders it
  // inline under that row.
  const openTransfer = async (inv, forRow = null) => {
    if (transfer?.forRow === inv.id && forRow) { setTransfer(null); return; } // toggle
    setMode(null); setQuery(''); setResults([]); setError(null);
    const nid = await ensureNode();
    if (!nid) return;
    const { stockLocations, total, error: e } = await itemStock(inv.id);
    if (e) { setError(e); return; }
    setTransfer({
      item: inv, total, forRow,
      existing: pinQty(stockLocations, nid),
      sources: sourcesOf({ stockLocations, total }, nid),
      addNew: '', moves: {},
    });
  };

  const willHold = transfer
    ? (transfer.existing || 0) + (Number(transfer.addNew) || 0)
      + transfer.sources.reduce((s, src) => s + Math.min(Number(transfer.moves[src.key]) || 0, src.qty), 0)
    : 0;

  const applyTransfer = async () => {
    const t = transfer;
    const moves = t.sources.map((s) => ({ key: s.key, qty: Number(t.moves[s.key]) || 0 })).filter((m) => m.qty > 0);
    const addNew = Number(t.addNew) || 0;
    if (addNew <= 0 && moves.length === 0) { setTransfer(null); return; }
    setBusy('transfer'); setError(null);
    const { error: e } = await placeStock(t.item.id, { pin: { nodeId, name: pinName }, addNew, moves });
    setBusy(null);
    if (e) { setError(e); return; }
    setTransfer(null);
    await load(nodeId);
  };

  const createItem = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    const nid = await ensureNode();
    if (!nid) return;
    setBusy('new');
    const { item, error: e } = await createItemAtNode({ tenantId, userId, name, qty: newQty, pin: { nodeId: nid, name: pinName }, category: newCat });
    setBusy(null);
    if (e) { setError(e); return; }
    setMode(null); setNewName(''); setNewQty(''); setNewCat(null);
    if (item) await load(nid);
  };

  const removeItem = async (itemId) => {
    setBusy(itemId);
    const { error: e } = await clearItemNode(itemId, { nodeId, name: pinName });
    setBusy(null);
    if (e) { setError(e); return; }
    setRows((rs) => (rs || []).filter((r) => r.id !== itemId));
  };

  const bump = async (row, delta) => {
    if (busy) return;
    const next = Math.max(0, (Number(row.qty) || 0) + delta);
    setBusy(row.id); setError(null);
    const { error: e } = await setPinCount(row.id, { pin: { nodeId, name: pinName }, newQty: next });
    setBusy(null);
    if (e) { setError(e); return; }
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, qty: next } : r)));
  };

  const startCreateFromQuery = () => { setNewName(query.trim()); setNewQty(''); setMode('create'); setResults([]); };

  // Set how many to move from a source, clamped to what's actually there.
  const setMove = (key, val, max) => {
    const n = Math.max(0, Math.min(Number(val) || 0, max));
    setTransfer((t) => ({ ...t, moves: { ...t.moves, [key]: n === 0 ? '' : String(n) } }));
  };
  const bumpMove = (key, delta, max) => setMove(key, (Number(transfer.moves[key]) || 0) + delta, max);

  // The move-in panel. From an existing row's ▾ it's ONLY "move in from other
  // locations" (the row's own − / + handles receiving here). From the add-item
  // search it also offers "New stock arriving here" for a first placement.
  const forRow = !!transfer?.forRow;
  const panel = transfer && (
    <div className="vm-transfer">
      {!forRow && <p className="vm-transfer-head"><strong>{transfer.item.name}</strong> · {transfer.total} onboard</p>}
      {!forRow && (
        <label className="vm-transfer-new">
          <span>New stock arriving here</span>
          <input className="vm-check-input vm-transfer-qty" type="number" min="0"
            value={transfer.addNew} onChange={(e) => setTransfer((t) => ({ ...t, addNew: e.target.value }))} autoFocus />
        </label>
      )}
      {transfer.sources.length > 0 ? (
        <>
          <p className="vm-transfer-sub">{forRow ? 'Move some in from where else it’s stored:' : 'Or move some in from where it is now:'}</p>
          {transfer.sources.map((s) => {
            const n = Number(transfer.moves[s.key]) || 0;
            return (
              <div key={s.key} className="vm-transfer-src">
                <span className="vm-transfer-src-name" title={s.label}>{s.label}</span>
                <span className="vm-transfer-src-have">of {s.qty}</span>
                <span className="vm-move-step">
                  <button type="button" className="vm-move-btn" onClick={() => bumpMove(s.key, -1, s.qty)} disabled={n <= 0} aria-label={`Move one fewer from ${s.label}`}>–</button>
                  <input className="vm-move-input" type="number" min="0" max={s.qty}
                    value={transfer.moves[s.key] || ''} onChange={(e) => setMove(s.key, e.target.value, s.qty)} />
                  <button type="button" className="vm-move-btn" onClick={() => bumpMove(s.key, 1, s.qty)} disabled={n >= s.qty} aria-label={`Move one more from ${s.label}`}>+</button>
                </span>
              </div>
            );
          })}
        </>
      ) : (
        forRow && <p className="vm-transfer-sub">Not stored anywhere else — use – / + above to change the count here.</p>
      )}
      <p className="vm-transfer-total">This pin will hold: <strong>{willHold}</strong></p>
      <div className="vm-transfer-actions">
        <button className="vm-btn-primary" onClick={applyTransfer} disabled={busy === 'transfer' || willHold <= (transfer.existing || 0)}>{busy === 'transfer' ? 'Saving…' : (forRow ? 'Move here' : 'Place')}</button>
        <button className="vm-btn-ghost" onClick={() => setTransfer(null)}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="vm-pinitems">
      <p className="vm-label">What’s inside</p>

      {rows === null && <p className="vm-payload-empty">Loading…</p>}
      {rows !== null && rows.length === 0 && !mode && !transfer && (
        <p className="vm-payload-empty">Nothing here yet{canManage ? ' — add an item below.' : '.'}</p>
      )}

      {rows && rows.length > 0 && (
        <div className="vm-pinitems-list">
          {rows.map((r) => {
            const segs = r.category ? r.category.split(' › ') : [];
            const leaf = segs.pop();
            const head = segs.join(' › ');
            const open = transfer?.forRow === r.id;
            return (
              <React.Fragment key={r.id}>
                <div className="vm-pinitem">
                  <span className="vm-pinitem-main">
                    <button className="vm-pinitem-name" onClick={() => setOpenItem(r.id)} title="Quick view">{r.name}</button>
                    {leaf ? (
                      <span className="vm-pinitem-cat">
                        {head && <span className="vm-pinitem-cat-head">{head} › </span>}
                        <span className="vm-pinitem-cat-leaf">{leaf}</span>
                      </span>
                    ) : (
                      <span className="vm-pinitem-cat"><span className="vm-pinitem-cat-head">Uncategorised</span></span>
                    )}
                  </span>
                  {canManage && (
                    <button className={`vm-pinitem-move${open ? ' on' : ''}`} onClick={() => openTransfer({ id: r.id, name: r.name }, r.id)} aria-label={`Move stock for ${r.name}`} title="Receive / move stock">▾</button>
                  )}
                  {canManage ? (
                    <span className="vm-pinitem-step">
                      <button className="vm-pinitem-btn" onClick={() => bump(r, -1)} disabled={busy === r.id || r.qty <= 0} aria-label={`One fewer ${r.name}`}>–</button>
                      <span className="vm-pinitem-qty">{r.qty}</span>
                      <button className="vm-pinitem-btn" onClick={() => bump(r, 1)} disabled={busy === r.id} aria-label={`One more ${r.name}`}>+</button>
                    </span>
                  ) : (
                    <span className="vm-pinitem-qty vm-pinitem-qty-read">{r.qty}</span>
                  )}
                  {canManage && (
                    <button className="vm-pinitem-del" onClick={() => removeItem(r.id)} aria-label={`Remove ${r.name}`}>×</button>
                  )}
                </div>
                {open && panel}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Add-flow transfer panel (below the list) */}
      {transfer && !transfer.forRow && panel}

      {canManage && mode === 'add' && (
        <div className="vm-cupboard-picker">
          <input className="vm-check-input" placeholder="Search inventory — “champagne”…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          {/* Items already on this pin aren't offered again — adjust them with
              their own − / + instead of adding a duplicate line. */}
          {results.filter((r) => !(rows || []).some((row) => row.id === r.id)).map((r) => {
            const cat = categoryPath(r);
            return (
              <button key={r.id} className="vm-cupboard-result" onClick={() => openTransfer(r)}>
                {r.name}{cat ? ` · ${cat}` : ''}
              </button>
            );
          })}
          {query.trim() && (
            <button className="vm-cupboard-result vm-cupboard-create" onClick={startCreateFromQuery}>
              + Create “{query.trim()}” as a new item
            </button>
          )}
          <button className="vm-cupboard-cancel" onClick={() => { setMode(null); setQuery(''); }}>Cancel</button>
        </div>
      )}

      {canManage && mode === 'create' && (
        <div className="vm-pinitems-new">
          <input className="vm-check-input" placeholder="Item name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          {newCat ? (
            <div className="vm-pinitems-cat-set">
              <span className="vm-pinitems-cat-label">{newCat.label}</span>
              <button className="vm-pinitems-cat-change" onClick={() => { setNewCat(null); setCatPicking(true); setCatQuery(''); setCatResults([]); }}>Change</button>
            </div>
          ) : catPicking ? (
            <div className="vm-cupboard-picker">
              <input className="vm-check-input" placeholder="Search categories — “alcohol”…" value={catQuery} onChange={(e) => setCatQuery(e.target.value)} autoFocus />
              {catResults.map((r) => (
                <button key={r.id} className="vm-cupboard-result" onClick={() => { setNewCat({ location: r.location, sub_location: r.sub_location, label: locationLabel(r) }); setCatPicking(false); setCatQuery(''); setCatResults([]); }}>
                  {locationLabel(r)}
                </button>
              ))}
              <button className="vm-cupboard-cancel" onClick={() => { setCatPicking(false); setCatQuery(''); }}>Skip category</button>
            </div>
          ) : (
            <button className="vm-pinitems-cat-add" onClick={() => { setCatPicking(true); setCatQuery(''); setCatResults([]); }}>+ Choose a category</button>
          )}
          <div className="vm-pinitems-new-row">
            <input className="vm-check-input vm-pinitems-new-qty" type="number" min="0" placeholder="Qty" value={newQty} onChange={(e) => setNewQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createItem(); }} />
            <button className="vm-btn-primary" onClick={createItem} disabled={!newName.trim() || busy === 'new'}>{busy === 'new' ? 'Adding…' : 'Add here'}</button>
            <button className="vm-btn-ghost" onClick={() => { setMode(null); setNewName(''); setNewQty(''); setNewCat(null); setCatPicking(false); }}>Cancel</button>
          </div>
          <p className="vm-pinitems-new-hint">{newCat ? 'New stock, filed here in your chosen category.' : 'New stock received here; category optional.'}</p>
        </div>
      )}

      {canManage && !mode && !transfer && (
        <button className="vm-btn-ghost vm-pinitems-add" onClick={() => { setMode('add'); setQuery(''); }}>+ Add an item</button>
      )}

      {error && <p className="vm-payload-error">{error}</p>}

      {openItem && (
        <ItemDrawer itemId={openItem} onClose={() => { setOpenItem(null); load(nodeId); }} />
      )}
    </div>
  );
}

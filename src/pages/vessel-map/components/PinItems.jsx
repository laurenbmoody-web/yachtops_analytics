// "What's inside" — the inventory items physically at this pin, and how many.
// The map pin is deliberately simple: it only answers "how many of X are HERE".
//   • the count shown is how many are HERE, not the grand total;
//   • −/+ recounts what's on this pin (the delta flows to the item's total);
//   • adding an item places a quantity here;
//   • creating a new item receives all of it here;
//   • category (the item's inventory folder) rides along as subtext.
// Cross-location work — moving stock between locations, or fixing another
// location's count — lives in the item drawer (its god-view), not here.
import React, { useEffect, useRef, useState } from 'react';
import { searchInventoryItems, categoryPath } from '../utils/inventory';
import {
  resolvePinNode, itemsAtNode, placeStock, setPinCount,
  clearItemNode, createItemAtNode,
} from '../utils/placement';
import { getFolderTree } from '../../inventory/utils/inventoryStorage';
import { findExistingItem } from '../../../utils/itemIdentity';
import InventoryFolderPicker from '../../inventory/components/InventoryFolderPicker';
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
  const [transfer, setTransfer] = useState(null); // { item, addNew } — "how many here"
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newCat, setNewCat] = useState(null); // { location, sub_location, label } — inventory folder
  const [folderTree, setFolderTree] = useState(null);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  // As the crew types a new item's name we look it up live — if it already
  // exists we offer to place THAT one here, before any folder/qty busywork.
  const [nameMatch, setNameMatch] = useState(null);
  const [forceNew, setForceNew] = useState(false); // crew chose a separate item despite a match
  const [openItem, setOpenItem] = useState(null); // itemId shown in the quick-view drawer
  const debounce = useRef(null);
  const matchDebounce = useRef(null);

  // The stock location's display name = the pin's full path, so pins in the
  // same room don't collide into identical "Main Galley" entries.
  const pinName = [scanName, ...containerTrail.map((c) => c.label), hotspot?.label]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' › ') || (scanName || 'this pin');

  const resetAll = () => {
    setMode(null); setQuery(''); setResults([]); setTransfer(null); setError(null);
    setNewName(''); setNewQty(''); setNewCat(null); setShowFolderPicker(false);
    setNameMatch(null); setForceNew(false);
  };
  useEffect(() => { setNodeId(hotspot?.location_node_id || null); resetAll(); }, [hotspot?.id]);

  const load = async (nid) => {
    if (!nid) { setRows([]); return; }
    const { items, error: e } = await itemsAtNode(tenantId, nid);
    if (e) { setError(e); setRows([]); return; }
    setRows(items.map((it) => ({
      id: it.id, name: it.name, qty: it.pinQty, unit: it.unit || null, category: categoryPath(it),
    })));
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

  // Load the inventory folder tree lazily the first time the create form opens,
  // so the map files items into the same department › subfolder tree inventory uses.
  useEffect(() => {
    if (mode !== 'create' || folderTree) return;
    let cancelled = false;
    getFolderTree().then((t) => { if (!cancelled) setFolderTree(t || {}); }).catch(() => {});
    return () => { cancelled = true; };
  }, [mode, folderTree]);

  // Live "does this already exist?" as the name is typed — surfaced up-front so
  // the crew places the existing item instead of filing a duplicate.
  useEffect(() => {
    if (mode !== 'create') return undefined;
    setForceNew(false);
    const name = newName.trim();
    if (!name) { setNameMatch(null); return undefined; }
    clearTimeout(matchDebounce.current);
    matchDebounce.current = setTimeout(async () => {
      const { item } = await findExistingItem(tenantId, { name });
      setNameMatch(item || null);
    }, 300);
    return () => clearTimeout(matchDebounce.current);
  }, [mode, newName, tenantId]);

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

  // Open the "how many here?" panel for an inventory item picked in search.
  const openTransfer = async (inv) => {
    setMode(null); setQuery(''); setResults([]); setError(null);
    const nid = await ensureNode();
    if (!nid) return;
    setTransfer({ item: inv, addNew: '' });
  };

  const applyTransfer = async () => {
    const t = transfer;
    const addNew = Number(t.addNew) || 0;
    if (addNew <= 0) { setTransfer(null); return; }
    setBusy('transfer'); setError(null);
    const { error: e } = await placeStock(t.item.id, { pin: { nodeId, name: pinName }, addNew, moves: [] });
    setBusy(null);
    if (e) { setError(e); return; }
    setTransfer(null);
    await load(nodeId);
  };

  // Create a genuinely new item. Existence was already resolved inline (the crew
  // saw the match and chose "separate item"), so this always forces the insert.
  const createItem = async () => {
    const name = newName.trim();
    if (!name) return;
    if (!newCat) { setShowFolderPicker(true); return; } // must be filed in a folder
    setError(null);
    const nid = await ensureNode();
    if (!nid) return;
    setBusy('new');
    const { item, error: e } = await createItemAtNode({ tenantId, userId, name, qty: newQty, pin: { nodeId: nid, name: pinName }, category: newCat, force: true });
    setBusy(null);
    if (e) { setError(e); return; }
    resetAll();
    if (item) await load(nid);
  };

  // Place the already-existing item (surfaced from the live name match) onto this
  // pin — no duplicate, no folder step (it's already filed).
  const placeExistingHere = async () => {
    if (!nameMatch) return;
    setError(null);
    const nid = await ensureNode();
    if (!nid) return;
    setBusy('new');
    const addNew = Number(newQty) || 0;
    const { error: e } = await placeStock(nameMatch.id, { pin: { nodeId: nid, name: pinName }, addNew, moves: [] });
    setBusy(null);
    if (e) { setError(e); return; }
    resetAll();
    await load(nid);
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

  // "How many here?" — placing an existing inventory item onto this pin. Just a
  // quantity; anything cross-location happens in the item drawer.
  const placeQty = Number(transfer?.addNew) || 0;
  const panel = transfer && (
    <div className="vm-transfer">
      <label className="vm-transfer-new">
        <span>How many of <strong>{transfer.item.name}</strong> here?</span>
        <input className="vm-check-input vm-transfer-qty" type="number" min="0"
          value={transfer.addNew} onChange={(e) => setTransfer((t) => ({ ...t, addNew: e.target.value }))} autoFocus />
      </label>
      <div className="vm-transfer-actions">
        <button className="vm-btn-primary" onClick={applyTransfer} disabled={busy === 'transfer' || placeQty <= 0}>{busy === 'transfer' ? 'Saving…' : 'Place here'}</button>
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
            let segs = r.category ? r.category.split(' › ') : [];
            // Drop a trailing category that just repeats the item name — the
            // name's already above; the useful bucket (e.g. "Wine") then leads.
            if (segs.length && segs[segs.length - 1].trim().toLowerCase() === (r.name || '').trim().toLowerCase()) {
              segs = segs.slice(0, -1);
            }
            const leaf = segs.pop();
            const head = segs.join(' · ');
            return (
              <div className="vm-pinitem" key={r.id}>
                {/* Line 1 — the name gets the full width so it wraps in full. */}
                <div className="vm-pinitem-top">
                  <button className="vm-pinitem-name" onClick={() => setOpenItem(r.id)} title="Quick view">{r.name}</button>
                  {canManage && (
                    <button className="vm-pinitem-del" onClick={() => removeItem(r.id)} aria-label={`Remove ${r.name}`}>×</button>
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
                {/* Line 2 — the count HERE. Cross-location work is in the drawer. */}
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

      {/* "How many here?" panel (below the list, after picking in search) */}
      {transfer && panel}

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

          {nameMatch && !forceNew ? (
            /* It already exists — place THAT one here, no folder step. */
            <div className="vm-pinitems-match">
              <p className="vm-pinitems-match-lead"><strong>“{nameMatch.name}”</strong> is already in inventory</p>
              <p className="vm-pinitems-match-where">📁 {[nameMatch.location, nameMatch.sub_location].filter(Boolean).join(' › ') || 'Unfiled'}</p>
              <div className="vm-pinitems-new-row">
                <input className="vm-check-input vm-pinitems-new-qty" type="number" min="0" placeholder="Qty" value={newQty} onChange={(e) => setNewQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') placeExistingHere(); }} autoFocus />
                <button className="vm-btn-primary" onClick={placeExistingHere} disabled={busy === 'new'}>{busy === 'new' ? 'Placing…' : 'Place here'}</button>
                <button className="vm-btn-ghost" onClick={resetAll}>Cancel</button>
              </div>
              <button className="vm-pinitems-match-alt" onClick={() => setForceNew(true)}>Not this one — create a new item instead</button>
            </div>
          ) : (
            /* No match (or the crew chose a separate item) — file & create new. */
            <>
              {forceNew && <p className="vm-pinitems-new-hint">Creating a new item, separate from the existing one.</p>}
              {newCat ? (
                <div className="vm-pinitems-cat-set">
                  <span className="vm-pinitems-cat-label">{newCat.label}</span>
                  <button className="vm-pinitems-cat-change" onClick={() => setShowFolderPicker(true)}>Change</button>
                </div>
              ) : (
                <button className="vm-pinitems-cat-add" onClick={() => setShowFolderPicker(true)}>+ File in a folder</button>
              )}
              <div className="vm-pinitems-new-row">
                <input className="vm-check-input vm-pinitems-new-qty" type="number" min="0" placeholder="Qty" value={newQty} onChange={(e) => setNewQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createItem(); }} />
                <button className="vm-btn-primary" onClick={() => createItem()} disabled={!newName.trim() || !newCat || busy === 'new'}>{busy === 'new' ? 'Adding…' : 'Add here'}</button>
                <button className="vm-btn-ghost" onClick={resetAll}>Cancel</button>
              </div>
              <p className="vm-pinitems-new-hint">{newCat ? `Filed in ${newCat.label}, stocked on this pin.` : 'Pick a folder (department › subfolder) to file this item.'}</p>
            </>
          )}
        </div>
      )}

      {canManage && !mode && !transfer && (
        <button className="vm-btn-ghost vm-pinitems-add" onClick={() => { setMode('add'); setQuery(''); }}>+ Add an item</button>
      )}

      {error && <p className="vm-payload-error">{error}</p>}

      {openItem && (
        <ItemDrawer itemId={openItem} onClose={() => { setOpenItem(null); load(nodeId); }} />
      )}

      {showFolderPicker && (
        <InventoryFolderPicker
          tree={folderTree || {}}
          onSelect={({ path, displayPath }) => {
            setNewCat({ location: path?.[0] || null, sub_location: (path || []).slice(1).join(' > ') || null, label: displayPath });
            setShowFolderPicker(false);
          }}
          onClose={() => setShowFolderPicker(false)}
          onFolderCreated={(t) => setFolderTree(t)}
        />
      )}
    </div>
  );
}

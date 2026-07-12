// "What's inside" — the inventory items physically placed at this pin. A pin
// is a node in the physical-location tree; an item's physical location is its
// default_location_id → that node. So "what's inside" is a live query, adding
// an item files it here, creating one makes it here, and −/+ is the item's
// count. Category (the item's inventory folder) rides along as subtext — a
// separate axis the map never touches.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchInventoryItems, categoryPath } from '../utils/inventory';
import {
  resolvePinNode, itemsAtNode, placeItemAtNode, clearItemNode,
  createItemAtNode, setItemQuantity, nodePath,
} from '../utils/placement';

export default function PinItems({
  hotspot, canManage, tenantId, userId,
  scanSpaceId, scanName, containerTrail = [], onNodeResolved,
}) {
  const [nodeId, setNodeId] = useState(hotspot?.location_node_id || null);
  const [rows, setRows] = useState(null);       // items here; null = loading
  const [mode, setMode] = useState(null);       // 'add' | 'create' | null
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [move, setMove] = useState(null);       // { item, fromPath, nodeId }
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const debounce = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    setNodeId(hotspot?.location_node_id || null);
    setMode(null); setQuery(''); setResults([]); setNewName(''); setNewQty(''); setMove(null); setError(null);
  }, [hotspot?.id]);

  const load = async (nid) => {
    if (!nid) { setRows([]); return; }
    const { items, error: e } = await itemsAtNode(tenantId, nid);
    if (e) { setError(e); setRows([]); return; }
    setRows(items.map((it) => ({
      id: it.id, name: it.name, qty: Number(it.quantity ?? it.total_qty) || 0,
      unit: it.unit || null, category: categoryPath(it),
    })));
  };
  useEffect(() => { setRows(null); load(hotspot?.location_node_id || null); /* eslint-disable-next-line */ }, [hotspot?.id, hotspot?.location_node_id, tenantId]);

  // Debounced inventory search while adding.
  useEffect(() => {
    if (mode !== 'add') return undefined;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const { items, error: e } = await searchInventoryItems(tenantId, query);
      if (e) setError(e); else setResults(items || []);
    }, 250);
    return () => clearTimeout(debounce.current);
  }, [mode, query, tenantId]);

  // Resolve (creating if needed) this pin's location node.
  const ensureNode = async () => {
    if (nodeId) return nodeId;
    const { nodeId: nid, patched, error: e } = await resolvePinNode({
      tenantId, userId, rootSpaceId: scanSpaceId, rootName: scanName,
      trail: containerTrail.map((c) => ({ id: c.id, label: c.label, location_node_id: c.location_node_id })),
      pin: { id: hotspot.id, label: hotspot.label, location_node_id: hotspot.location_node_id },
    });
    if (e) { setError(e); return null; }
    (patched || []).forEach((p) => onNodeResolved?.(p.hotspotId, p.nodeId));
    setNodeId(nid);
    return nid;
  };

  const doPlace = async (itemId, nid) => {
    setBusy(itemId); setError(null);
    const { error: e } = await placeItemAtNode(itemId, nid);
    setBusy(null);
    if (e) { setError(e); return; }
    await load(nid);
  };

  const addItem = async (inv) => {
    setMode(null); setQuery(''); setResults([]); setError(null);
    const nid = await ensureNode();
    if (!nid) return;
    if (inv.default_location_id && inv.default_location_id !== nid) {
      const { path } = await nodePath(inv.default_location_id);
      setMove({ item: inv, fromPath: path || 'another location', nodeId: nid });
      return;
    }
    await doPlace(inv.id, nid);
  };

  const createItem = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    const nid = await ensureNode();
    if (!nid) return;
    setBusy('new');
    const { item, error: e } = await createItemAtNode({ tenantId, userId, name, qty: newQty, nodeId: nid });
    setBusy(null);
    if (e) { setError(e); return; }
    setMode(null); setNewName(''); setNewQty('');
    if (item) await load(nid);
  };

  const removeItem = async (itemId) => {
    setBusy(itemId);
    const { error: e } = await clearItemNode(itemId);
    setBusy(null);
    if (e) { setError(e); return; }
    setRows((rs) => (rs || []).filter((r) => r.id !== itemId));
  };

  const bump = async (row, delta) => {
    if (busy) return;
    const next = Math.max(0, (Number(row.qty) || 0) + delta);
    setBusy(row.id); setError(null);
    const { error: e } = await setItemQuantity(row.id, next);
    setBusy(null);
    if (e) { setError(e); return; }
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, qty: next } : r)));
  };

  const startCreateFromQuery = () => { setNewName(query.trim()); setNewQty(''); setMode('create'); setResults([]); };

  return (
    <div className="vm-pinitems">
      <p className="vm-label">What’s inside</p>

      {rows === null && <p className="vm-payload-empty">Loading…</p>}
      {rows !== null && rows.length === 0 && !mode && (
        <p className="vm-payload-empty">Nothing here yet{canManage ? ' — add an item below.' : '.'}</p>
      )}

      {rows && rows.length > 0 && (
        <div className="vm-pinitems-list">
          {rows.map((r) => {
            const segs = r.category ? r.category.split(' › ') : [];
            const leaf = segs.pop();
            const head = segs.join(' › ');
            return (
              <div key={r.id} className="vm-pinitem">
                <span className="vm-pinitem-main">
                  <button className="vm-pinitem-name" onClick={() => navigate(`/inventory/item/${r.id}`)} title="View in inventory">{r.name}</button>
                  {leaf ? (
                    <span className="vm-pinitem-cat" title={r.category}>
                      {head && <span className="vm-pinitem-cat-head">{head} › </span>}
                      <span className="vm-pinitem-cat-leaf">{leaf}</span>
                    </span>
                  ) : (
                    <span className="vm-pinitem-cat"><span className="vm-pinitem-cat-head">Uncategorised</span></span>
                  )}
                </span>
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
            );
          })}
        </div>
      )}

      {/* "currently at X — move here?" */}
      {move && (
        <div className="vm-pinitems-move">
          <span><strong>{move.item.name}</strong> is currently at {move.fromPath}.</span>
          <div className="vm-pinitems-move-actions">
            <button className="vm-btn-primary vm-pinitems-move-go" onClick={async () => { const m = move; setMove(null); await doPlace(m.item.id, m.nodeId); }}>Move here</button>
            <button className="vm-btn-ghost" onClick={() => setMove(null)}>Cancel</button>
          </div>
        </div>
      )}

      {canManage && mode === 'add' && (
        <div className="vm-cupboard-picker">
          <input className="vm-check-input" placeholder="Search inventory — “champagne”…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          {results.map((r) => {
            const cat = categoryPath(r);
            return (
              <button key={r.id} className="vm-cupboard-result" onClick={() => addItem(r)}>
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
          <div className="vm-pinitems-new-row">
            <input className="vm-check-input vm-pinitems-new-qty" type="number" min="0" placeholder="Qty" value={newQty} onChange={(e) => setNewQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createItem(); }} />
            <button className="vm-btn-primary" onClick={createItem} disabled={!newName.trim() || busy === 'new'}>{busy === 'new' ? 'Adding…' : 'Add here'}</button>
            <button className="vm-btn-ghost" onClick={() => { setMode(null); setNewName(''); setNewQty(''); }}>Cancel</button>
          </div>
          <p className="vm-pinitems-new-hint">Files it here; set its category later in inventory.</p>
        </div>
      )}

      {canManage && !mode && !move && (
        <button className="vm-btn-ghost vm-pinitems-add" onClick={() => { setMode('add'); setQuery(''); }}>+ Add an item</button>
      )}

      {error && <p className="vm-payload-error">{error}</p>}
    </div>
  );
}

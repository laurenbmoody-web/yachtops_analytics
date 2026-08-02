import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import {
  fetchListsForPicker,
  createProvisioningList,
  upsertItems,
  PROVISIONING_STATUS,
} from '../../provisioning/utils/provisioningStorage';
import './reorder.css';

const STATUS_LABEL = {
  draft: 'Draft', pending_approval: 'Pending approval', sent_to_supplier: 'Sent',
  quote_received: 'Quote in', confirmed: 'Confirmed', partially_delivered: 'Part delivered', delivered: 'Delivered',
};
const statusText = (s) => STATUS_LABEL[s] || (s ? String(s).replace(/_/g, ' ') : '');

// Reorder an inventory item into provisioning: pick any active board (or start a
// new one) and add the item as a draft line, linked back by inventory_item_id.
const ReorderModal = ({ item, suggestedQty = 1, onClose, onDone }) => {
  const { activeTenantId, currentUser } = useAuth();
  const [lists, setLists] = useState(null); // null = loading
  const [target, setTarget] = useState('new'); // a list id | 'new'
  const [newTitle, setNewTitle] = useState('');
  const [qty, setQty] = useState(String(Math.max(1, Math.round(suggestedQty) || 1)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all = await fetchListsForPicker(activeTenantId);
        if (!alive) return;
        setLists(all);
        setTarget(all[0]?.id || 'new');
      } catch {
        if (alive) { setLists([]); setTarget('new'); }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenantId, currentUser?.id]);

  const defaultTitle = useMemo(() => `Reorder — ${new Date().toLocaleDateString('en-GB')}`, []);

  const submit = async () => {
    const n = Math.max(1, Math.round(Number(qty) || 0));
    if (!n) { setErr('Enter a quantity.'); return; }
    setBusy(true); setErr('');
    try {
      let listId = target;
      let listTitle = lists?.find((l) => l.id === target)?.title;
      if (target === 'new') {
        const title = newTitle.trim() || defaultTitle;
        const created = await createProvisioningList({
          tenant_id: activeTenantId,
          title,
          status: PROVISIONING_STATUS.DRAFT,
          created_by: currentUser?.id,
          owner_id: currentUser?.id,
          department_id: currentUser?.department_id || null,
          visibility: 'department',
          department: currentUser?.department ? [currentUser.department] : [],
          currency: item?.currency || 'USD',
          is_private: false,
          is_template: false,
        });
        listId = created?.id;
        listTitle = title;
      }
      if (!listId) throw new Error('Could not resolve a list.');
      await upsertItems([{
        list_id: listId,
        name: item?.name || 'Item',
        brand: item?.brand || '',
        size: item?.size || '',
        department: currentUser?.department || '',
        quantity_ordered: n,
        unit: item?.unit || 'each',
        estimated_unit_cost: item?.unitCost ?? null,
        inventory_item_id: item?.id,
        source: 'low_stock',
        status: 'draft',
      }]);
      window.showToast?.(`Added ${n} × ${item?.name} to “${listTitle}”`, 'success');
      onDone?.(listId);
      onClose?.();
    } catch (e) {
      setErr(e?.message || 'Couldn’t add — try again.');
      setBusy(false);
    }
  };

  return (
    <div className="ro-backdrop" onClick={onClose}>
      <div className="ro-panel" role="dialog" aria-label="Reorder item" onClick={(e) => e.stopPropagation()}>
        <div className="ro-head">
          <div>
            <span className="ro-eyebrow">Reorder</span>
            <h2 className="ro-title">{item?.name || 'Item'}</h2>
          </div>
          <button className="ro-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="ro-body">
          <label className="ro-lab" htmlFor="ro-qty">Quantity</label>
          <input id="ro-qty" className="ro-qty" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />

          <label className="ro-lab">Add to list</label>
          {lists === null ? (
            <p className="ro-loading">Loading lists…</p>
          ) : (
            <div className="ro-lists">
              {lists.length > 0 && <p className="ro-sub">Existing boards</p>}
              {lists.map((l) => (
                <label key={l.id} className={`ro-opt${target === l.id ? ' on' : ''}`}>
                  <input type="radio" name="ro-target" checked={target === l.id} onChange={() => setTarget(l.id)} />
                  <span className="ro-opt-title">{l.title || 'Untitled list'}</span>
                  {l.status && <span className="ro-opt-status">{statusText(l.status)}</span>}
                </label>
              ))}
              <label className={`ro-opt${target === 'new' ? ' on' : ''}`}>
                <input type="radio" name="ro-target" checked={target === 'new'} onChange={() => setTarget('new')} />
                <span className="ro-opt-title">New list…</span>
              </label>
              {target === 'new' && (
                <input className="ro-newtitle" placeholder={defaultTitle} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
              )}
            </div>
          )}
          {err && <p className="ro-err">{err}</p>}
        </div>

        <div className="ro-foot">
          <button type="button" className="ro-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ro-btn prim" onClick={submit} disabled={busy || lists === null}>
            {busy ? 'Adding…' : 'Add to list'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReorderModal;

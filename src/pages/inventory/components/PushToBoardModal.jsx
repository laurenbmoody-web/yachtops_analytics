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

// Push N inventory items onto a provisioning board (pick any active board or
// start a new one). Each item carries its own `suggestedQty`. Draft lines are
// linked back by inventory_item_id, so they flow through the normal pipeline.
const PushToBoardModal = ({ items = [], onClose, onDone }) => {
  const { activeTenantId, currentUser } = useAuth();
  const [lists, setLists] = useState(null);
  const [target, setTarget] = useState('new');
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const count = items.length;

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
    if (!count) return;
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
          currency: 'USD',
          is_private: false,
          is_template: false,
        });
        listId = created?.id;
        listTitle = title;
      }
      if (!listId) throw new Error('Could not resolve a list.');
      const lines = items.map((it) => ({
        list_id: listId,
        name: it?.name || 'Item',
        brand: it?.brand || '',
        size: it?.size || '',
        department: it?.usageDepartment || currentUser?.department || '',
        quantity_ordered: Math.max(1, Math.round(it?.suggestedQty || 1)),
        unit: it?.unit || 'each',
        estimated_unit_cost: it?.unitCost ?? null,
        inventory_item_id: it?.id,
        source: 'reorder',
        status: 'draft',
      }));
      await upsertItems(lines);
      window.showToast?.(`Pushed ${count} item${count === 1 ? '' : 's'} to “${listTitle}”`, 'success');
      onDone?.(listId);
      onClose?.();
    } catch (e) {
      setErr(e?.message || 'Couldn’t push — try again.');
      setBusy(false);
    }
  };

  return (
    <div className="ro-backdrop" onClick={onClose}>
      <div className="ro-panel" role="dialog" aria-label="Push to provisioning" onClick={(e) => e.stopPropagation()}>
        <div className="ro-head">
          <div>
            <span className="ro-eyebrow">Push to provisioning</span>
            <h2 className="ro-title">
              {count} item{count === 1 ? '' : 's'}
              <span className="ro-info" tabIndex={0} title="Added at the suggested reorder quantity — you can review and edit everything (quantities, supplier, remove lines) on the provisioning board, just like normal. Nothing is sent to a supplier until you do it there.">
                <Icon name="Info" size={14} />
              </span>
            </h2>
          </div>
          <button className="ro-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="ro-body">
          {count > 0 && (
            <div className="ro-reviewwrap">
              <button type="button" className="ro-review" onClick={() => setReviewOpen((o) => !o)}>
                <Icon name="ChevronRight" size={15} className={`ro-review-caret${reviewOpen ? ' open' : ''}`} />
                {reviewOpen ? 'Hide items' : `Review items (${count})`}
              </button>
              {reviewOpen && (
                <ul className="ro-itemlist">
                  {items.map((it, i) => (
                    <li key={it?.id || i}>
                      <span className="ro-item-name">{it?.name || 'Item'}</span>
                      <span className="ro-item-qty">×{Math.max(1, Math.round(it?.suggestedQty || 1))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

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
                <span className="ro-opt-title"><Icon name="Plus" size={14} /> New list</span>
              </label>
              {target === 'new' && (
                <input className="ro-newtitle" placeholder={defaultTitle} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} autoFocus />
              )}
            </div>
          )}
          {err && <p className="ro-err">{err}</p>}
        </div>

        <div className="ro-foot">
          <button type="button" className="ro-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ro-btn prim" onClick={submit} disabled={busy || lists === null || !count}>
            {busy ? 'Pushing…' : `Push ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PushToBoardModal;

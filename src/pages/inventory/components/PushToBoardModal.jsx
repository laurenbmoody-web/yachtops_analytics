import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import {
  fetchProvisioningLists,
  createProvisioningList,
  upsertItems,
  PROVISIONING_STATUS,
} from '../../provisioning/utils/provisioningStorage';
import './reorder.css';

const EDITABLE = new Set([PROVISIONING_STATUS.DRAFT, PROVISIONING_STATUS.PENDING_APPROVAL]);

// Push N inventory items onto a provisioning board (pick an active list or start
// a new one). Each item carries its own `suggestedQty`. Draft lines are linked
// back by inventory_item_id, so they flow through the normal supplier pipeline.
const PushToBoardModal = ({ items = [], onClose, onDone }) => {
  const { activeTenantId, currentUser, isCommand, isChief } = useAuth();
  const [lists, setLists] = useState(null);
  const [target, setTarget] = useState('new');
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const count = items.length;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const tier = isCommand ? 'COMMAND' : (isChief ? 'CHIEF' : '');
        const all = await fetchProvisioningLists(activeTenantId, currentUser?.id, currentUser?.department_id || null, tier, 'active');
        const editable = (all || []).filter((l) => EDITABLE.has(l?.status) && !l?.is_template);
        if (!alive) return;
        setLists(editable);
        setTarget(editable[0]?.id || 'new');
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
            <h2 className="ro-title">{count} item{count === 1 ? '' : 's'}</h2>
          </div>
          <button className="ro-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="ro-body">
          <p className="ro-note">Each item is added at its suggested reorder quantity — you can adjust everything on the board before sending to a supplier.</p>
          <label className="ro-lab">Add to list</label>
          {lists === null ? (
            <p className="ro-loading">Loading lists…</p>
          ) : (
            <div className="ro-lists">
              {lists.map((l) => (
                <label key={l.id} className={`ro-opt${target === l.id ? ' on' : ''}`}>
                  <input type="radio" name="ro-target" checked={target === l.id} onChange={() => setTarget(l.id)} />
                  <span className="ro-opt-title">{l.title || 'Untitled list'}</span>
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
          <button type="button" className="ro-btn prim" onClick={submit} disabled={busy || lists === null || !count}>
            {busy ? 'Pushing…' : `Push ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PushToBoardModal;

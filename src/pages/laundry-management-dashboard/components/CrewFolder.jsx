import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchTenantCrew } from '../../crew-profile/utils/tenantCrew';
import {
  fetchTenantUniformKit, saveKitItem, deleteKitItem, recordKitReturn, logKitEvent, fmtKitDate, CONDITIONS,
} from '../../crew-profile/utils/crewKit';
import { getAllItems, adjustItemQuantity } from '../../inventory/utils/inventoryStorage';
import { canViewCost } from '../../../utils/costPermissions';
import { money } from '../utils/laundryBilling';
import PersonTiles from './PersonTiles';
import './crewFolder.css';

const today = () => new Date().toISOString().slice(0, 10);

const STATUS = {
  in_service: { label: 'In service', cls: 'live' },
  returned: { label: 'Returned', cls: 'done' },
  lost: { label: 'Lost / written off', cls: 'lost' },
};
const kitStatus = (k) => {
  if (k.status === 'in_service' && !k.acknowledged_at) return { label: 'Awaiting sign-off', cls: 'await' };
  return STATUS[k.status] || { label: k.status, cls: 'live' };
};

// Issue-from-inventory modal: pick a uniform stock item, size + qty, then issue.
const IssueModal = ({ crewName, stock, showValue, onIssue, onClose }) => {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null); // chosen inventory item
  const [size, setSize] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState('New');
  const [issuedDate, setIssuedDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? stock.filter((i) => `${i.name} ${i.size}`.toLowerCase().includes(s)) : stock;
  }, [stock, q]);

  const choose = (i) => { setPick(i); setSize(i.size || ''); setQuantity(1); };
  const avail = pick ? (Number(pick.totalQty ?? pick.quantity) || 0) : 0;

  const submit = async () => {
    if (!pick || busy) return;
    setBusy(true);
    try { await onIssue({ invItem: pick, size, quantity: Math.max(1, Number(quantity) || 1), condition, issuedDate, notes }); }
    finally { setBusy(false); }
  };

  return (
    <div className="cf-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="cf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cf-modal-head">
          <div><span className="cf-eyebrow">Issue uniform</span><h2 className="cf-modal-title">To {crewName}</h2></div>
          <button type="button" className="cf-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        {!pick ? (
          <div className="cf-modal-body">
            <div className="cf-search">
              <Icon name="Search" size={15} className="cf-search-ic" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search uniform stock…" />
            </div>
            {stock.length === 0 ? (
              <p className="cf-empty-note">No uniform in inventory yet. Flag stock as <b>Uniform</b> in inventory to issue it here.</p>
            ) : (
              <div className="cf-pick-list">
                {filtered.map((i) => {
                  const a = Number(i.totalQty ?? i.quantity) || 0;
                  return (
                    <button type="button" key={i.id} className="cf-pick" onClick={() => choose(i)} disabled={a <= 0}>
                      <span className="cf-pick-thumb">{i.imageUrl ? <img src={i.imageUrl} alt="" /> : <Icon name="Shirt" size={16} />}</span>
                      <span className="cf-pick-main">
                        <span className="cf-pick-nm">{i.name}</span>
                        <span className="cf-pick-sub">{[i.size, showValue && i.unitCost != null ? money(i.unitCost, i.currency) : null].filter(Boolean).join(' · ') || '—'}</span>
                      </span>
                      <span className={`cf-pick-stock${a <= 0 ? ' out' : ''}`}>{a} in stock</span>
                    </button>
                  );
                })}
                {filtered.length === 0 && <p className="cf-empty-note">Nothing matches “{q}”.</p>}
              </div>
            )}
          </div>
        ) : (
          <div className="cf-modal-body">
            <button type="button" className="cf-pick-back" onClick={() => setPick(null)}><Icon name="ArrowLeft" size={13} /> Pick a different item</button>
            <div className="cf-chosen">
              <span className="cf-pick-thumb lg">{pick.imageUrl ? <img src={pick.imageUrl} alt="" /> : <Icon name="Shirt" size={20} />}</span>
              <div>
                <div className="cf-chosen-nm">{pick.name}</div>
                <div className="cf-chosen-sub">{avail} in stock{showValue && pick.unitCost != null ? ` · ${money(pick.unitCost, pick.currency)} each` : ''}</div>
              </div>
            </div>
            <div className="cf-row2">
              <div><label className="cf-l">Size</label><input className="cf-input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. M" /></div>
              <div><label className="cf-l">Quantity</label><input className="cf-input" type="number" min="1" max={avail || undefined} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
            </div>
            <div className="cf-row2">
              <div><label className="cf-l">Condition</label><div className="cf-select"><select value={condition} onChange={(e) => setCondition(e.target.value)}>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div></div>
              <div><label className="cf-l">Issued</label><input className="cf-input" type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} /></div>
            </div>
            <label className="cf-l">Notes <span className="cf-opt">optional</span></label>
            <input className="cf-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. embroidered M/Y name" />
            {quantity > avail && <p className="cf-warn">Only {avail} in stock — issuing will take the stock negative.</p>}
          </div>
        )}

        {pick && (
          <div className="cf-modal-foot">
            <button type="button" className="cf-btn ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="cf-btn primary" disabled={busy} onClick={submit}>{busy ? 'Issuing…' : 'Issue & take from stock'}</button>
          </div>
        )}
      </div>
    </div>
  );
};

// Return modal: hand kit back, choosing whether it goes back into inventory.
const ReturnModal = ({ row, onReturn, onClose }) => {
  const [restock, setRestock] = useState(true);
  const [condition, setCondition] = useState('Good');
  const [busy, setBusy] = useState(false);
  const linked = !!row.inventory_item_id;
  const submit = async () => { setBusy(true); try { await onReturn(row, { restock: restock && linked, condition }); } finally { setBusy(false); } };
  return (
    <div className="cf-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="cf-modal sm" onClick={(e) => e.stopPropagation()}>
        <div className="cf-modal-head">
          <div><span className="cf-eyebrow">Return kit</span><h2 className="cf-modal-title">{row.item}</h2></div>
          <button type="button" className="cf-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>
        <div className="cf-modal-body">
          <label className="cf-l">Condition back</label>
          <div className="cf-select"><select value={condition} onChange={(e) => setCondition(e.target.value)}>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <label className={`cf-check${restock ? ' on' : ''}${linked ? '' : ' disabled'}`}>
            <input type="checkbox" checked={restock && linked} disabled={!linked} onChange={(e) => setRestock(e.target.checked)} />
            <span>
              <b>Put back into inventory</b>
              <span className="cf-check-sub">{linked ? `Adds ${row.quantity || 1} back to the master stock. Leave off to write it off (kept / consumed / binned).` : 'This item isn’t linked to inventory stock, so nothing to restock.'}</span>
            </span>
          </label>
        </div>
        <div className="cf-modal-foot">
          <button type="button" className="cf-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="cf-btn primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Confirm return'}</button>
        </div>
      </div>
    </div>
  );
};

// The Crew world: a folder of crew (name tiles) → click a person → the uniform
// issued to them. Issuing draws from master inventory; the crew profile shows
// the same kit read-only for the crew member to sign off.
const CrewFolder = ({ onBack }) => {
  const { user, tenantRole } = useAuth();
  const { activeTenantId } = useTenant();
  const showValue = canViewCost();
  const canManage = (tenantRole || '').toUpperCase() === 'COMMAND' || (user?.department || '').toLowerCase() === 'interior';

  const [roster, setRoster] = useState([]);
  const [kit, setKit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [stock, setStock] = useState([]);
  const [issuing, setIssuing] = useState(false);
  const [returning, setReturning] = useState(null);

  const load = async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const [crew, allKit] = await Promise.all([fetchTenantCrew(activeTenantId), fetchTenantUniformKit(activeTenantId)]);
    setRoster(crew); setKit(allKit); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeTenantId]);

  // Uniform stock loaded lazily when the issue modal opens.
  const openIssue = async () => { setIssuing(true); const all = await getAllItems(); setStock(all.filter((i) => i.isUniform)); };

  const countByUser = useMemo(() => {
    const m = {};
    kit.forEach((k) => { if (k.status === 'in_service') m[k.user_id] = (m[k.user_id] || 0) + 1; });
    return m;
  }, [kit]);

  const selected = roster.find((c) => c.id === selectedId) || null;
  const memberKit = useMemo(
    () => kit.filter((k) => k.user_id === selectedId)
      .sort((a, b) => (b.issued_date || '').localeCompare(a.issued_date || '')),
    [kit, selectedId]
  );

  const doIssue = async ({ invItem, size, quantity, condition, issuedDate, notes }) => {
    await saveKitItem({
      userId: selectedId, tenantId: activeTenantId, category: 'uniform',
      item: invItem.name, size: size || invItem.size || null, quantity,
      conditionIssued: condition || 'New', issuedDate,
      issuedBy: user?.id, issuedByName: user?.user_metadata?.full_name || user?.email,
      value: invItem.unitCost ?? null, inventoryItemId: invItem.id, createdBy: user?.id, notes,
    });
    await adjustItemQuantity(invItem.id, -Math.abs(quantity));
    await logKitEvent({ userId: selectedId, tenantId: activeTenantId, action: 'issued', detail: { item: invItem.name, quantity }, actorId: user?.id, actorName: user?.user_metadata?.full_name });
    setIssuing(false); load();
  };

  const doReturn = async (row, { restock, condition }) => {
    await recordKitReturn([row.id], { returnedDate: today(), condition, returnedTo: user?.id });
    if (restock && row.inventory_item_id) await adjustItemQuantity(row.inventory_item_id, Math.abs(row.quantity || 1));
    await logKitEvent({ kitId: row.id, userId: row.user_id, tenantId: activeTenantId, action: 'returned', detail: { item: row.item, restock }, actorId: user?.id, actorName: user?.user_metadata?.full_name });
    setReturning(null); load();
  };

  const doDelete = async (row) => {
    if (!window.confirm(`Remove “${row.item}”? ${row.inventory_item_id && row.status === 'in_service' ? 'The stock goes back into inventory.' : ''}`)) return;
    if (row.inventory_item_id && row.status === 'in_service') await adjustItemQuantity(row.inventory_item_id, Math.abs(row.quantity || 1));
    await deleteKitItem(row.id);
    load();
  };

  // ── Roster (person tiles) ────────────────────────────────────────────────
  if (!selected) {
    return (
      <div className="cf-view">
        <div className="cf-bar"><button type="button" className="lm-back" onClick={onBack}><Icon name="ArrowLeft" size={16} /> Wardrobe management</button></div>
        {loading ? (
          <div className="cf-loading">Loading the crew…</div>
        ) : (
          <PersonTiles
            people={roster.map((c) => ({
              id: c.id, name: c.fullName, photo: c.photo,
              subtitle: [c.roleTitle, c.department].filter(Boolean).join(' · '),
              count: countByUser[c.id] || 0, countLabel: 'issued',
            }))}
            emptyLabel="No crew on board yet."
            onPick={(id) => setSelectedId(id)}
          />
        )}
      </div>
    );
  }

  // ── One crew member's issued uniform ─────────────────────────────────────
  return (
    <div className="cf-view">
      <div className="cf-bar">
        <button type="button" className="lm-back" onClick={() => setSelectedId(null)}><Icon name="ArrowLeft" size={16} /> All crew</button>
        {canManage && <button type="button" className="cf-btn primary sm" onClick={openIssue}><Icon name="Plus" size={15} /> Issue from inventory</button>}
      </div>

      <div className="cf-member-head">
        <span className="cf-avatar lg">{selected.photo ? <img src={selected.photo} alt="" /> : <span>{(selected.fullName || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>}</span>
        <div>
          <h2 className="cf-member-nm">{selected.fullName}</h2>
          <p className="cf-member-sub">{[selected.roleTitle, selected.department].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      {memberKit.length === 0 ? (
        <div className="cf-empty">
          <Icon name="Shirt" size={26} />
          <p>No uniform issued yet.</p>
          {canManage && <button type="button" className="cf-btn primary" onClick={openIssue}><Icon name="Plus" size={15} /> Issue from inventory</button>}
        </div>
      ) : (
        <div className="cf-kit">
          {memberKit.map((k) => {
            const st = kitStatus(k);
            return (
              <div className={`cf-kit-row${k.status !== 'in_service' ? ' muted' : ''}`} key={k.id}>
                <span className="cf-kit-ic"><Icon name="Shirt" size={16} /></span>
                <div className="cf-kit-main">
                  <span className="cf-kit-nm">{k.item}{k.quantity > 1 ? ` ×${k.quantity}` : ''}</span>
                  <span className="cf-kit-sub">{[k.size ? `Size ${k.size}` : null, k.condition_issued, k.issued_date ? `Issued ${fmtKitDate(k.issued_date)}` : null].filter(Boolean).join(' · ')}</span>
                  {k.notes && <span className="cf-kit-note">{k.notes}</span>}
                </div>
                {showValue && k.value != null && <span className="cf-kit-val">{money(k.value * (k.quantity || 1), 'USD')}</span>}
                <span className={`cf-pill ${st.cls}`}>{st.label}</span>
                {canManage && (
                  <div className="cf-kit-acts">
                    {k.status === 'in_service' && <button type="button" className="cf-mini" onClick={() => setReturning(k)}>Return</button>}
                    <button type="button" className="cf-mini danger" onClick={() => doDelete(k)} aria-label="Remove"><Icon name="Trash2" size={14} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {issuing && <IssueModal crewName={selected.fullName} stock={stock} showValue={showValue} onIssue={doIssue} onClose={() => setIssuing(false)} />}
      {returning && <ReturnModal row={returning} onReturn={doReturn} onClose={() => setReturning(null)} />}
    </div>
  );
};

export default CrewFolder;

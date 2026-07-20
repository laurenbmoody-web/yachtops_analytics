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
import { FilterMenu, SortMenu } from './LaundryFilters';
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

// The inventory folder path an issued item files under, so the List view mirrors
// how uniform is filed in inventory. Shows the folders BELOW the "Uniform" anchor
// (e.g. Interior › Crew › Uniform › On charter › Evening wear → "On charter ›
// Evening wear"); falls back to the item's location, then "Uncategorised" when
// the issued row isn't linked to inventory stock yet.
const UNCATEGORISED = 'Uncategorised';
const catPath = (item) => {
  if (!item) return UNCATEGORISED;
  const segs = [item.l1Name, item.l2Name, item.l3Name, item.l4Name].map((s) => (s || '').trim()).filter(Boolean);
  if (segs.length) {
    const ui = segs.findIndex((s) => s.toLowerCase() === 'uniform');
    const below = ui >= 0 ? segs.slice(ui + 1) : segs.slice(1); // below Uniform, else drop the dept root
    return (below.length ? below : segs.slice(-1)).join(' › ');
  }
  const loc = [item.location, item.subLocation].map((s) => (s || '').trim()).filter(Boolean);
  return loc.length ? loc.join(' › ') : UNCATEGORISED;
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
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');
  const [sort, setSort] = useState('name');
  const [crewView, setCrewView] = useState('tiles'); // tiles (by crew) | list (combined uniform)

  const load = async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const [crew, allKit, all] = await Promise.all([
      fetchTenantCrew(activeTenantId), fetchTenantUniformKit(activeTenantId), getAllItems().catch(() => []),
    ]);
    setRoster(crew); setKit(allKit); setStock(all.filter((i) => i.isUniform)); setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeTenantId]);

  const openIssue = async () => { setIssuing(true); const all = await getAllItems(); setStock(all.filter((i) => i.isUniform)); };

  // Linked inventory item by id — lets the List view file each issued item under
  // its inventory folder path (the same category tree used in inventory).
  const itemById = useMemo(() => Object.fromEntries(stock.map((i) => [i.id, i])), [stock]);

  const countByUser = useMemo(() => {
    const m = {};
    kit.forEach((k) => { if (k.status === 'in_service') m[k.user_id] = (m[k.user_id] || 0) + 1; });
    return m;
  }, [kit]);

  const depts = useMemo(() => [...new Set(roster.map((c) => c.department).filter((d) => d && d !== '—'))].sort(), [roster]);
  const deptMatch = (c) => dept === 'all' || c.department === dept;

  // Roster as tiles — filtered by department + name search, sorted.
  const tilePeople = useMemo(() => {
    const s = q.trim().toLowerCase();
    let list = roster.filter(deptMatch);
    if (s) list = list.filter((c) => (c.fullName || '').toLowerCase().includes(s));
    const rows = list.map((c) => ({
      id: c.id, name: c.fullName, photo: c.photo,
      subtitle: [c.roleTitle, c.department].filter(Boolean).join(' · '),
      count: countByUser[c.id] || 0, countLabel: 'issued',
    }));
    rows.sort((a, b) => (sort === 'most' ? b.count - a.count : sort === 'fewest' ? a.count - b.count : (a.name || '').localeCompare(b.name || '')));
    return rows;
  }, [roster, q, dept, sort, countByUser]);

  // List view — every in-service item combined across the (dept-filtered) crew,
  // keyed by item + size (3 crew each holding 2 × Polo white M → 6 × Polo white M),
  // then grouped under the item's inventory folder path so it mirrors inventory.
  const listGroups = useMemo(() => {
    const ids = new Set(roster.filter(deptMatch).map((c) => c.id));
    const m = new Map();
    kit.filter((k) => k.status === 'in_service' && ids.has(k.user_id)).forEach((k) => {
      const key = `${(k.item || '').trim().toLowerCase()}|${(k.size || '').trim().toLowerCase()}`;
      if (!m.has(key)) m.set(key, { item: k.item, size: k.size, qty: 0, holders: new Set(), value: k.value, invId: k.inventory_item_id || null });
      const r = m.get(key); r.qty += Number(k.quantity) || 1; r.holders.add(k.user_id);
      if (!r.invId && k.inventory_item_id) r.invId = k.inventory_item_id;
    });
    let rows = [...m.values()].map((r) => ({ ...r, holders: r.holders.size, path: catPath(itemById[r.invId]) }));
    const s = q.trim().toLowerCase();
    if (s) rows = rows.filter((r) => `${r.item} ${r.size} ${r.path}`.toLowerCase().includes(s));
    const g = new Map();
    rows.forEach((r) => { if (!g.has(r.path)) g.set(r.path, []); g.get(r.path).push(r); });
    const groups = [...g.entries()].map(([path, rs]) => ({
      path,
      rows: rs.sort((a, b) => (sort === 'qty' ? b.qty - a.qty : (a.item || '').localeCompare(b.item || ''))),
    }));
    // Categorised folders alphabetical; the Uncategorised bucket sinks to the end.
    groups.sort((a, b) => (a.path === UNCATEGORISED ? 1 : b.path === UNCATEGORISED ? -1 : a.path.localeCompare(b.path)));
    return groups;
  }, [kit, roster, dept, q, sort, itemById]);

  const sortOptions = crewView === 'list'
    ? [{ val: 'item', label: 'Item (A–Z)' }, { val: 'qty', label: 'Quantity (high → low)' }]
    : [{ val: 'name', label: 'Name (A–Z)' }, { val: 'most', label: 'Most issued' }, { val: 'fewest', label: 'Fewest issued' }];
  const filterGroups = [
    { key: 'dept', label: 'Department', value: dept, neutral: 'all', onChange: setDept, options: [{ value: 'all', label: 'All departments' }, ...depts.map((d) => ({ value: d, label: d }))] },
  ];
  const switchView = (v) => { setCrewView(v); setSort(v === 'list' ? 'item' : 'name'); };

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
        <div className="cf-bar"><button type="button" className="lm-back" onClick={onBack}><Icon name="ArrowLeft" size={16} /> Back to wardrobe management</button></div>
        <p className="editorial-meta">
          <span className="dot">●</span><span>Wardrobe</span>
          <span className="bar" /><span className="muted">Crew</span>
          <span className="bar" /><span className="muted">{kit.filter((k) => k.status === 'in_service').length} issued</span>
        </p>
        <h1 className="editorial-greeting">CREW<span className="period">,</span> <em>in uniform</em><span className="period">.</span></h1>
        <div className="cf-toolbar">
          <div className="cf-tsearch">
            <Icon name="Search" size={16} className="cf-search-ic" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={crewView === 'list' ? 'Search uniform…' : 'Search crew…'} />
          </div>
          <div className="cf-tools">
            <FilterMenu groups={filterGroups} />
            <SortMenu value={sort} onChange={setSort} options={sortOptions} />
            <div className="cf-viewtoggle" role="tablist" aria-label="View">
              <button type="button" className={crewView === 'tiles' ? 'on' : ''} onClick={() => switchView('tiles')}>By crew</button>
              <button type="button" className={crewView === 'list' ? 'on' : ''} onClick={() => switchView('list')}>List</button>
            </div>
          </div>
        </div>
        {loading ? (
          <div className="cf-loading">Loading the crew…</div>
        ) : crewView === 'tiles' ? (
          <PersonTiles people={tilePeople} emptyLabel="No crew match." onPick={(id) => setSelectedId(id)} />
        ) : (
          <div className="cf-list">
            {listGroups.length === 0 ? (
              <div className="cf-empty-note">No uniform issued{dept !== 'all' ? ` in ${dept}` : ''} yet.</div>
            ) : listGroups.map((grp) => (
              <section className="cf-listgroup" key={grp.path}>
                <div className="cf-listgroup-h">{grp.path}</div>
                {grp.rows.map((r, i) => (
                  <div className="cf-list-row" key={i}>
                    <span className="cf-list-qty">{r.qty}×</span>
                    <div className="cf-list-main">
                      <span className="cf-list-nm">{r.item}{r.size ? ` · ${r.size}` : ''}</span>
                      <span className="cf-list-sub">held by {r.holders} {r.holders === 1 ? 'crew member' : 'crew'}</span>
                    </div>
                    {showValue && r.value != null && <span className="cf-kit-val">{money(r.value * r.qty, 'USD')}</span>}
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── One crew member's issued uniform ─────────────────────────────────────
  return (
    <div className="cf-view">
      <div className="cf-bar">
        <button type="button" className="lm-back" onClick={() => setSelectedId(null)}><Icon name="ArrowLeft" size={16} /> Back to all crew</button>
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

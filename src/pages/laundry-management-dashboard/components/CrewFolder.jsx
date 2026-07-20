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

// The inventory folder an issued item files under, so the List view mirrors how
// uniform is filed in inventory. Inventory's location model is the materialized
// folder path — `location` + `sub_location` ('>'-joined) — NOT the deprecated
// l1..l4 taxonomy. Show the folders BELOW the "Uniform" anchor (e.g. Interior >
// Crew > Uniform > On charter > Evening wear → "On charter › Evening wear");
// "Uncategorised" when the issued row isn't linked to inventory stock yet.
const UNCATEGORISED = 'Uncategorised';
const catPath = (item) => {
  if (!item) return UNCATEGORISED;
  const parts = [];
  if (item.location) parts.push(item.location);
  if (item.subLocation) item.subLocation.split('>').forEach((s) => parts.push(s));
  const segs = parts.map((s) => (s || '').trim()).filter(Boolean)
    .filter((s, i, a) => i === 0 || s.toLowerCase() !== a[i - 1].toLowerCase()); // drop duplicated roots
  if (!segs.length) return UNCATEGORISED;
  const ui = segs.findIndex((s) => s.toLowerCase() === 'uniform');
  const below = ui >= 0 ? segs.slice(ui + 1) : segs.slice(1); // below Uniform, else drop the top root
  return (below.length ? below : segs.slice(-1)).join(' › ');
};

// Segments of an item's inventory folder path BELOW the "Uniform" anchor — what
// the issue browser drills through (Uniform > On charter > Evening wear → the
// item lives in the "Evening wear" folder).
const uniformRel = (item) => {
  const parts = [];
  if (item.location) parts.push(item.location);
  if (item.subLocation) item.subLocation.split('>').forEach((s) => parts.push(s));
  const segs = parts.map((s) => (s || '').trim()).filter(Boolean)
    .filter((s, i, a) => i === 0 || s.toLowerCase() !== a[i - 1].toLowerCase());
  const ui = segs.map((s) => s.toLowerCase()).lastIndexOf('uniform');
  return ui >= 0 ? segs.slice(ui + 1) : segs;
};

// Issue-from-inventory: browse the Uniform folder as tiles, drill down to items,
// tick items and allocate a quantity (−/count/+, capped at what's on board), then
// issue the lot to the crew member in one go.
const IssueModal = ({ crewName, stock, showValue, onIssue, onClose }) => {
  const [trail, setTrail] = useState([]); // folder segments below Uniform
  const [sel, setSel] = useState({});     // itemId -> allocated qty
  const [busy, setBusy] = useState(false);

  const withRel = useMemo(() => stock.map((i) => ({ i, rel: uniformRel(i) })), [stock]);
  const atLevel = useMemo(
    () => withRel.filter((x) => trail.every((t, idx) => (x.rel[idx] || '').toLowerCase() === t.toLowerCase())),
    [withRel, trail]
  );
  const folders = useMemo(() => {
    const m = new Map();
    atLevel.forEach((x) => { if (x.rel.length > trail.length) { const seg = x.rel[trail.length]; m.set(seg, (m.get(seg) || 0) + 1); } });
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }, [atLevel, trail]);
  const itemsHere = useMemo(() => atLevel.filter((x) => x.rel.length === trail.length).map((x) => x.i), [atLevel, trail]);

  const stockOf = (i) => Number(i.totalQty ?? i.quantity) || 0;
  const toggle = (i) => setSel((p) => { const n = { ...p }; if (i.id in n) delete n[i.id]; else n[i.id] = 0; return n; });
  const bump = (i, d) => setSel((p) => ({ ...p, [i.id]: Math.max(0, Math.min(stockOf(i), (p[i.id] || 0) + d)) }));

  const alloc = stock.filter((i) => (sel[i.id] || 0) > 0).map((i) => ({ invItem: i, qty: sel[i.id] }));
  const totalUnits = alloc.reduce((a, x) => a + x.qty, 0);

  const submit = async () => {
    if (!alloc.length || busy) return;
    setBusy(true);
    try { await onIssue(alloc); } finally { setBusy(false); }
  };

  return (
    <div className="cf-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="cf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cf-modal-head">
          <div><span className="cf-eyebrow">Issue uniform</span><h2 className="cf-modal-title">To {crewName}</h2></div>
          <button type="button" className="cf-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        {/* Breadcrumb — Uniform is the root; each tile drills a folder deeper. */}
        <div className="cf-crumb">
          <button type="button" className="cf-crumb-seg" onClick={() => setTrail([])}>Uniform</button>
          {trail.map((seg, i) => (
            <React.Fragment key={i}>
              <span className="cf-crumb-sep">›</span>
              <button type="button" className="cf-crumb-seg" onClick={() => setTrail(trail.slice(0, i + 1))}>{seg}</button>
            </React.Fragment>
          ))}
        </div>

        <div className="cf-modal-body">
          {stock.length === 0 ? (
            <p className="cf-empty-note">No uniform in inventory yet. Flag stock as <b>Uniform</b> in inventory to issue it here.</p>
          ) : (
            <>
              {folders.length > 0 && (
                <div className="cf-folder-grid">
                  {folders.map((f) => (
                    <button type="button" key={f.name} className="cf-folder" onClick={() => setTrail([...trail, f.name])}>
                      <span className="cf-folder-ic"><Icon name="Folder" size={18} /></span>
                      <span className="cf-folder-nm">{f.name}</span>
                      <span className="cf-folder-ct">{f.count} item{f.count === 1 ? '' : 's'}</span>
                    </button>
                  ))}
                </div>
              )}
              {itemsHere.length > 0 && (
                <div className="cf-item-grid">
                  {itemsHere.map((i) => {
                    const onboard = stockOf(i);
                    const picked = i.id in sel;
                    const qty = sel[i.id] || 0;
                    return (
                      <div className={`cf-itile${picked ? ' on' : ''}`} key={i.id}>
                        <button type="button" className="cf-itile-media" onClick={() => toggle(i)}>
                          {i.imageUrl ? <img src={i.imageUrl} alt={i.name} /> : <span className="cf-itile-ph"><Icon name="Shirt" size={26} /></span>}
                          <span className="cf-itile-check"><Icon name={picked ? 'CheckSquare' : 'Square'} size={18} /></span>
                        </button>
                        <div className="cf-itile-body">
                          <span className="cf-itile-nm">{i.name}{i.size ? ` · ${i.size}` : ''}</span>
                          <span className="cf-itile-sub">{onboard} on board{showValue && i.unitCost != null ? ` · ${money(i.unitCost, i.currency)}` : ''}</span>
                        </div>
                        {picked && (
                          <div className="cf-itile-qty">
                            <button type="button" className="cf-qbtn" onClick={() => bump(i, -1)} disabled={qty <= 0} aria-label="Less">−</button>
                            <span className="cf-qnum">{qty}</span>
                            <button type="button" className="cf-qbtn" onClick={() => bump(i, 1)} disabled={qty >= onboard} aria-label="More">+</button>
                            <span className="cf-itile-of">of {onboard}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {folders.length === 0 && itemsHere.length === 0 && <p className="cf-empty-note">Nothing filed here.</p>}
            </>
          )}
        </div>

        <div className="cf-modal-foot">
          <button type="button" className="cf-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="cf-btn primary" disabled={busy || totalUnits === 0} onClick={submit}>
            {busy ? 'Issuing…' : totalUnits > 0 ? `Issue ${totalUnits} item${totalUnits === 1 ? '' : 's'}` : 'Issue'}
          </button>
        </div>
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

  // Issue a batch of allocations [{ invItem, qty }] to the selected crew member:
  // one kit row each, drawing the quantity from master stock.
  const doIssue = async (allocations) => {
    const issuerName = user?.user_metadata?.full_name || user?.email;
    for (const { invItem, qty } of allocations) {
      await saveKitItem({
        userId: selectedId, tenantId: activeTenantId, category: 'uniform',
        item: invItem.name, size: invItem.size || null, quantity: qty,
        conditionIssued: 'New', issuedDate: today(),
        issuedBy: user?.id, issuedByName: issuerName,
        value: invItem.unitCost ?? null, inventoryItemId: invItem.id, createdBy: user?.id,
      });
      await adjustItemQuantity(invItem.id, -Math.abs(qty));
      await logKitEvent({ userId: selectedId, tenantId: activeTenantId, action: 'issued', detail: { item: invItem.name, quantity: qty }, actorId: user?.id, actorName: issuerName });
    }
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

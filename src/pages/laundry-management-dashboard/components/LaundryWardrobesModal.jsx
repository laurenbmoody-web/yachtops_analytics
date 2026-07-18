import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { loadWardrobes, createWardrobe, archiveWardrobe, getWardrobeById, WardrobeScopeLabels } from '../utils/laundryWardrobes';
import { setLaundryItemsWardrobe } from '../utils/laundryStorage';
import './laundryCases.css';

const ownerText = (it) => {
  const k = (it?.ownerType || '').toLowerCase();
  if (k === 'other') return 'Other';
  return it?.ownerName || (k === 'guest' ? 'Guest' : k === 'crew' ? 'Crew' : 'Unassigned');
};

// Wardrobes manager: the permanent HOME half. Create a wardrobe, assign garments
// to live in it, and see which are currently away (packed in a case). Membership
// is wardrobe_id; items come from the parent's loaded set to stay in sync.
const LaundryWardrobesModal = ({ onClose, items = [], scope = 'owner', initialId = null, onChanged, onOpenItem }) => {
  const [wardrobes, setWardrobes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLoc, setNewLoc] = useState('');
  const [picking, setPicking] = useState(false);
  const [pickSel, setPickSel] = useState({});
  const [homeOf, setHomeOf] = useState(() => Object.fromEntries(items.map((i) => [i.id, i.wardrobeId || null])));
  useEffect(() => { setHomeOf(Object.fromEntries(items.map((i) => [i.id, i.wardrobeId || null]))); }, [items]);

  const refresh = async () => { setWardrobes(await loadWardrobes(scope)); setLoading(false); };
  useEffect(() => { refresh(); }, [scope]);
  useEffect(() => {
    if (!initialId) return;
    (async () => { if (await getWardrobeById(initialId)) setSelId(initialId); })();
  }, [initialId]);

  const sel = useMemo(() => wardrobes.find((w) => w.id === selId) || null, [wardrobes, selId]);
  const caseById = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i.caseId || null])), [items]);
  const countFor = (wid) => items.filter((i) => (homeOf[i.id] || null) === wid).length;
  const homeItems = useMemo(() => (sel ? items.filter((i) => (homeOf[i.id] || null) === sel.id) : []), [sel, items, homeOf]);
  const looseItems = useMemo(() => items.filter((i) => !(homeOf[i.id] || null)), [items, homeOf]);

  const doCreate = async () => {
    const w = await createWardrobe({ name: newName, location: newLoc, scope });
    if (w) { setNewName(''); setNewLoc(''); setCreating(false); await refresh(); setSelId(w.id); }
  };

  const persistHome = async (ids, wardrobeId) => {
    setHomeOf((prev) => { const n = { ...prev }; ids.forEach((id) => { n[id] = wardrobeId; }); return n; });
    await setLaundryItemsWardrobe(ids, wardrobeId);
    onChanged?.();
  };

  const confirmAdd = async () => {
    const ids = Object.keys(pickSel).filter((id) => pickSel[id]);
    if (ids.length && sel) await persistHome(ids, sel.id);
    setPickSel({}); setPicking(false);
  };

  const removeWardrobe = async () => {
    if (!sel) return;
    if (!window.confirm(`Remove “${sel.name}”? Its items will keep their records but lose this home.`)) return;
    const ids = items.filter((i) => (homeOf[i.id] || null) === sel.id).map((i) => i.id);
    setHomeOf((prev) => { const n = { ...prev }; ids.forEach((id) => { n[id] = null; }); return n; });
    await archiveWardrobe(sel.id);
    onChanged?.();
    setSelId(null);
    await refresh();
  };

  return (
    <div className="lcm-overlay" role="dialog" aria-modal="true" aria-label="Wardrobes" onClick={onClose}>
      <div className="lcm-panel" onClick={(e) => e.stopPropagation()}>
        <div className="lcm-head">
          <div>
            <span className="lcm-eyebrow">{WardrobeScopeLabels[scope] || 'Wardrobe'} · on board</span>
            <h2 className="lcm-title">{sel ? sel.name : 'Wardrobes'}</h2>
          </div>
          <button type="button" className="lcm-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        {!sel && (
          <div className="lcm-body">
            {creating ? (
              <div className="lcm-newform">
                <input className="lcm-input" autoFocus placeholder="Wardrobe name (e.g. Owner’s wardrobe)" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <input className="lcm-input" placeholder="Location (optional) — e.g. Master cabin" value={newLoc} onChange={(e) => setNewLoc(e.target.value)} />
                <div className="lcm-newform-actions">
                  <button type="button" className="lcm-btn ghost" onClick={() => { setCreating(false); setNewName(''); setNewLoc(''); }}>Cancel</button>
                  <button type="button" className="lcm-btn primary" disabled={!newName.trim()} onClick={doCreate}>Create wardrobe</button>
                </div>
              </div>
            ) : (
              <button type="button" className="lcm-new" onClick={() => setCreating(true)}><Icon name="Plus" size={16} /> New wardrobe</button>
            )}

            {loading ? (
              <div className="lcm-empty">Loading wardrobes…</div>
            ) : wardrobes.length === 0 && !creating ? (
              <div className="lcm-empty">No wardrobes yet. Create one — the permanent home garments live in when they’re on board.</div>
            ) : (
              <div className="lcm-list">
                {wardrobes.map((w) => (
                  <button type="button" className="lcm-row" key={w.id} onClick={() => setSelId(w.id)}>
                    <div className="lcm-row-main">
                      <span className="lcm-row-nm">{w.name}</span>
                      <span className="lcm-row-sub">{w.location || 'On board'}</span>
                    </div>
                    <span className="lcm-count">{countFor(w.id)}<small>pcs</small></span>
                    <Icon name="ChevronRight" size={16} className="lcm-chev" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {sel && !picking && (
          <div className="lcm-body">
            <button type="button" className="lcm-back" onClick={() => setSelId(null)}><Icon name="ArrowLeft" size={15} /> All wardrobes</button>
            {sel.location && <div className="lcm-dest"><Icon name="MapPin" size={13} /> <b>{sel.location}</b></div>}

            <div className="lcm-sec-head">
              <span>Lives here · {homeItems.length}</span>
              <div className="lcm-sec-actions">
                <button type="button" className="lcm-mini" onClick={() => setPicking(true)}><Icon name="Plus" size={14} /> Add items</button>
              </div>
            </div>

            {homeItems.length === 0 ? (
              <div className="lcm-empty">Nothing lives here yet. Tap “Add items” to give garments this home.</div>
            ) : (
              <div className="lcm-items">
                {homeItems.map((it) => (
                  <div className="lcm-item" key={it.id}>
                    <button type="button" className="lcm-item-main lcm-item-btn" onClick={() => onOpenItem?.(it)}>
                      <span className="lcm-item-nm">{it.description || 'Laundry item'}</span>
                      <span className="lcm-item-sub">{ownerText(it)}{it.area ? ` · ${it.area}` : ''}{caseById[it.id] ? ' · away (in a case)' : ''}</span>
                    </button>
                    <button type="button" className="lcm-remove" onClick={() => persistHome([it.id], null)} aria-label="Remove from wardrobe"><Icon name="X" size={15} /></button>
                  </div>
                ))}
              </div>
            )}

            <button type="button" className="lcm-danger" onClick={removeWardrobe}><Icon name="Trash2" size={14} /> Remove wardrobe</button>
          </div>
        )}

        {sel && picking && (
          <div className="lcm-body">
            <button type="button" className="lcm-back" onClick={() => { setPicking(false); setPickSel({}); }}><Icon name="ArrowLeft" size={15} /> Back</button>
            <div className="lcm-sec-head"><span>Items without a home · pick to add</span></div>
            {looseItems.length === 0 ? (
              <div className="lcm-empty">Every item already has a wardrobe home.</div>
            ) : (
              <div className="lcm-items">
                {looseItems.map((it) => (
                  <label className="lcm-pick" key={it.id}>
                    <input type="checkbox" checked={!!pickSel[it.id]} onChange={(e) => setPickSel((p) => ({ ...p, [it.id]: e.target.checked }))} />
                    <div className="lcm-item-main">
                      <span className="lcm-item-nm">{it.description || 'Laundry item'}</span>
                      <span className="lcm-item-sub">{ownerText(it)}{it.area ? ` · ${it.area}` : ''}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <div className="lcm-pick-actions">
              <button type="button" className="lcm-btn ghost" onClick={() => { setPicking(false); setPickSel({}); }}>Cancel</button>
              <button type="button" className="lcm-btn primary" disabled={!Object.values(pickSel).some(Boolean)} onClick={confirmAdd}>
                Add {Object.values(pickSel).filter(Boolean).length || ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LaundryWardrobesModal;

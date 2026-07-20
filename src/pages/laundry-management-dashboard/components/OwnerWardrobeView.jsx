import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { FilterMenu, SortMenu } from './LaundryFilters';
import LaundryScanModal from './LaundryScanModal';
import AddGarmentModal from './AddGarmentModal';
import GarmentFullView from './GarmentFullView';
import WardrobeEditorModal from './WardrobeEditorModal';
import { canViewCost } from '../../../utils/costPermissions';
import { loadWardrobes, createWardrobe } from '../utils/laundryWardrobes';
import { loadCases, createCase } from '../utils/laundryCases';
import {
  loadAllLaundryItems, setLaundryItemsWardrobe, setLaundryItemsCase, setLaundryItemsStatus,
  archiveLaundryItems, LaundryStatus, formatLaundryTag,
} from '../utils/laundryStorage';
import { resolveLaundryPhotos } from '../utils/laundryPhotos';
import { money } from '../utils/laundryBilling';
import { loadGuests, GuestType } from '../../guest-management-dashboard/utils/guestStorage';
import './ownerWardrobe.css';

const guestName = (g) => (g ? ([g.firstName, g.lastName].filter(Boolean).join(' ') || g.name || 'Guest') : '');

const SORTS = [
  { val: 'name', label: 'Name (A–Z)' },
  { val: 'newest', label: 'Newest on board' },
  { val: 'oldest', label: 'Longest on board' },
  { val: 'priceHigh', label: 'Value (high → low)' },
  { val: 'priceLow', label: 'Value (low → high)' },
  { val: 'type', label: 'Category (A–Z)' },
];
const AGES = [
  { value: 'all', label: 'Any time' },
  { value: 'w', label: 'On board ≤ 1 week' },
  { value: 'm', label: 'On board ≤ 1 month' },
  { value: 'h', label: 'On board ≤ 6 months' },
  { value: 'o', label: 'On board 6 months+' },
];
const inWash = (i) => i.status === LaundryStatus.IN_PROGRESS || i.status === LaundryStatus.READY_TO_DELIVER;
const STATUS = {
  Stored: { label: 'In wardrobe', cls: 'stored' },
  InProgress: { label: 'In laundry', cls: 'prog' },
  ReadyToDeliver: { label: 'Ready', cls: 'ready' },
  Delivered: { label: 'Delivered', cls: 'done' },
};
const ageBucket = (iso) => {
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (days <= 7) return 'w'; if (days <= 31) return 'm'; if (days <= 182) return 'h'; return 'o';
};

// Owner wardrobe catalogue: image-first grid of resident garments, with search
// + scan, dropdown filter/sort, multi-select bulk actions, and a full view.
const OwnerWardrobeView = ({ onBack }) => {
  const showValue = canViewCost(); // garment value is cost data — Command/Chief/HOD only
  const [wardrobes, setWardrobes] = useState([]);
  const [guests, setGuests] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('image'); // image | list
  const [groupBy, setGroupBy] = useState('location'); // location | guest
  const [query, setQuery] = useState('');
  const [fLoc, setFLoc] = useState('all');
  const [fType, setFType] = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [fAge, setFAge] = useState('all');
  const [sort, setSort] = useState('name');
  const [sel, setSel] = useState(() => new Set());
  const [chooser, setChooser] = useState(null); // { kind:'pack'|'move', ids:[] }
  const [cases, setCases] = useState([]);
  const [fullItem, setFullItem] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showNewWardrobe, setShowNewWardrobe] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const sortOptions = showValue ? SORTS : SORTS.filter((s) => !s.val.startsWith('price'));

  const load = async () => {
    const [ws, gs, all] = await Promise.all([loadWardrobes('owner'), loadGuests().catch(() => []), loadAllLaundryItems()]);
    const ownerGuests = (gs || []).filter((g) => g.guestType === GuestType.OWNER);
    const wIds = new Set(ws.map((w) => w.id));
    const gIds = new Set(ownerGuests.map((g) => g.id));
    // Owner garments: homed in an owner wardrobe, OR belonging to an owner-type
    // guest, OR the generic "Owner" (ownerType 'other').
    const owned = all.filter((i) => !i.isArchivedFromToday && (
      (i.wardrobeId && wIds.has(i.wardrobeId)) || (i.ownerGuestId && gIds.has(i.ownerGuestId)) || (i.ownerType === 'other')
    ));
    const resolved = await resolveLaundryPhotos(owned).catch(() => owned);
    setWardrobes(ws); setGuests(ownerGuests); setItems(resolved); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const wardrobesById = useMemo(() => Object.fromEntries(wardrobes.map((w) => [w.id, w])), [wardrobes]);
  const guestsById = useMemo(() => Object.fromEntries(guests.map((g) => [g.id, g])), [guests]);
  const wardrobeName = (id) => wardrobes.find((w) => w.id === id)?.name || '';
  const caseName = (id) => cases.find((c) => c.id === id)?.name || 'a case';
  const types = useMemo(() => Array.from(new Set(items.map((i) => i.garmentType).filter(Boolean))).sort(), [items]);

  const shown = useMemo(() => {
    let list = items;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((i) => `${i.description} ${i.garmentType} ${i.colour} ${(i.tags || []).join(' ')}`.toLowerCase().includes(q));
    if (fLoc !== 'all') {
      if (fLoc === 'away') list = list.filter((i) => i.caseId);
      else list = list.filter((i) => i.wardrobeId === fLoc);
    }
    if (fType !== 'all') list = list.filter((i) => i.garmentType === fType);
    if (fStatus === 'wardrobe') list = list.filter((i) => i.status === LaundryStatus.STORED);
    else if (fStatus === 'laundry') list = list.filter(inWash);
    else if (fStatus === 'delivered') list = list.filter((i) => i.status === LaundryStatus.DELIVERED);
    if (fAge !== 'all') list = list.filter((i) => ageBucket(i.createdAt) === fAge || (fAge === 'o' && ageBucket(i.createdAt) === 'o'));
    const s = [...list];
    s.sort((a, b) => {
      if (sort === 'name') return (a.description || '').localeCompare(b.description || '');
      if (sort === 'type') return (a.garmentType || '').localeCompare(b.garmentType || '');
      if (sort === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
      if (sort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
      if (sort === 'priceHigh') return (b.garmentValue || 0) - (a.garmentValue || 0);
      if (sort === 'priceLow') return (a.garmentValue || 0) - (b.garmentValue || 0);
      return 0;
    });
    return s;
  }, [items, query, fLoc, fType, fStatus, fAge, sort]);

  // Group the shown items by wardrobe/room (location) or by the person (guest).
  const groups = useMemo(() => {
    const map = new Map();
    const push = (key, title, subtitle, it) => { if (!map.has(key)) map.set(key, { key, title, subtitle, items: [] }); map.get(key).items.push(it); };
    shown.forEach((it) => {
      if (groupBy === 'guest') {
        const g = guestsById[it.ownerGuestId];
        push(it.ownerGuestId || 'none', g ? guestName(g) : (it.ownerName && it.ownerName !== 'Owner' ? it.ownerName : 'Owner'), g?.cabinLocationLabel || g?.cabinAllocated || '', it);
      } else {
        const w = wardrobesById[it.wardrobeId];
        push(it.wardrobeId || 'none', w?.name || 'No wardrobe', w?.locationName || w?.location || '', it);
      }
    });
    return [...map.values()];
  }, [shown, groupBy, guestsById, wardrobesById]);

  const filterGroups = [
    { key: 'loc', label: 'Location', value: fLoc, neutral: 'all', onChange: setFLoc, options: [{ value: 'all', label: 'Everywhere' }, ...wardrobes.map((w) => ({ value: w.id, label: w.name })), { value: 'away', label: 'Away (in a case)' }] },
    { key: 'type', label: 'Type of clothing', value: fType, neutral: 'all', onChange: setFType, options: [{ value: 'all', label: 'All types' }, ...types.map((t) => ({ value: t, label: t }))] },
    { key: 'status', label: 'Status', value: fStatus, neutral: 'all', onChange: setFStatus, options: [{ value: 'all', label: 'Any status' }, { value: 'wardrobe', label: 'In wardrobe' }, { value: 'laundry', label: 'In laundry' }, { value: 'delivered', label: 'Delivered' }] },
    { key: 'age', label: 'Time on board', value: fAge, neutral: 'all', onChange: setFAge, options: AGES },
  ];

  const toggle = (id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllShown = () => setSel(new Set(shown.map((i) => i.id)));
  const selectGroup = (groupItems) => setSel((p) => { const n = new Set(p); groupItems.forEach((i) => n.add(i.id)); return n; });
  const clearSel = () => setSel(new Set());
  const selIds = [...sel];

  const openChooser = async (kind, ids) => {
    if (kind === 'pack') setCases(await loadCases());
    setChooser({ kind, ids });
  };
  const runBulk = async (kind) => {
    if (!selIds.length) return;
    if (kind === 'launder') { if (window.confirm(`Send ${selIds.length} item(s) to laundry?`)) { await setLaundryItemsStatus(selIds, LaundryStatus.IN_PROGRESS); clearSel(); load(); } return; }
    if (kind === 'archive') { if (window.confirm(`Archive ${selIds.length} item(s)? (Owner says get rid — records are kept in history.)`)) { await archiveLaundryItems(selIds); clearSel(); load(); } return; }
    openChooser(kind, selIds); // pack | move
  };
  const singleAction = async (kind, item) => {
    if (kind === 'launder') { await setLaundryItemsStatus([item.id], LaundryStatus.IN_PROGRESS); setFullItem(null); load(); return; }
    if (kind === 'archive') { if (window.confirm('Archive this garment?')) { await archiveLaundryItems([item.id]); setFullItem(null); load(); } return; }
    setFullItem(null); openChooser(kind, [item.id]);
  };

  const chooseTarget = async (target) => {
    const { kind, ids } = chooser;
    if (kind === 'pack') await setLaundryItemsCase(ids, target);
    else await setLaundryItemsWardrobe(ids, target);
    setChooser(null); clearSel(); load();
  };
  const createTarget = async () => {
    const { kind, ids } = chooser;
    const nm = window.prompt(kind === 'pack' ? 'New case name' : 'New wardrobe name');
    if (!nm) return;
    if (kind === 'pack') { const c = await createCase({ name: nm }); if (c) await setLaundryItemsCase(ids, c.id); }
    else { const w = await createWardrobe({ name: nm, scope: 'owner' }); if (w) await setLaundryItemsWardrobe(ids, w.id); }
    setChooser(null); clearSel(); load();
  };

  const onScan = (t) => { setShowScan(false); const it = items.find((i) => i.id === t?.id); if (it) setFullItem(it); else window.alert('That label isn’t an owner garment.'); };

  const renderCard = (it) => {
    const photo = (Array.isArray(it.photos) && it.photos[0]) || it.photo || '';
    const st = STATUS[it.status] || { label: it.status, cls: 'stored' };
    return (
      <div className={`ow-card${sel.has(it.id) ? ' sel' : ''}`} key={it.id}>
        <button type="button" className="ow-check" onClick={() => toggle(it.id)} aria-label="Select"><Icon name={sel.has(it.id) ? 'CheckSquare' : 'Square'} size={18} /></button>
        <button type="button" className="ow-card-media" onClick={() => setFullItem(it)}>
          {photo ? <img src={photo} alt={it.description || 'Garment'} loading="lazy" /> : <span className="ow-card-ph"><Icon name="Shirt" size={30} /></span>}
          {it.caseId && <span className="ow-away">Away</span>}
          {it.staysOnboard && <span className="ow-stays" title="Usually stays on board"><Icon name="Anchor" size={11} /></span>}
        </button>
        <button type="button" className="ow-card-body" onClick={() => setFullItem(it)}>
          <span className="ow-card-nm">{it.description || 'Garment'}</span>
          <span className="ow-card-sub">{it.garmentType || '—'}{showValue && it.garmentValue != null ? ` · ${money(it.garmentValue, it.garmentValueCurrency)}` : ''}</span>
          <span className={`ow-status sm ${st.cls}`}>{st.label}</span>
        </button>
      </div>
    );
  };
  const renderRow = (it) => {
    const photo = (Array.isArray(it.photos) && it.photos[0]) || it.photo || '';
    const st = STATUS[it.status] || { label: it.status, cls: 'stored' };
    return (
      <div className={`ow-lrow${sel.has(it.id) ? ' sel' : ''}`} key={it.id}>
        <button type="button" className="ow-check" onClick={() => toggle(it.id)} aria-label="Select"><Icon name={sel.has(it.id) ? 'CheckSquare' : 'Square'} size={18} /></button>
        <button type="button" className="ow-lthumb" onClick={() => setFullItem(it)}>{photo ? <img src={photo} alt="" loading="lazy" /> : <Icon name="Shirt" size={18} />}</button>
        <button type="button" className="ow-lmain" onClick={() => setFullItem(it)}>
          <span className="ow-card-nm">{it.description || 'Garment'}</span>
          <span className="ow-card-sub">{[it.garmentType, it.colour, wardrobeName(it.wardrobeId)].filter(Boolean).join(' · ')}</span>
        </button>
        {showValue && it.garmentValue != null && <span className="ow-lval">{money(it.garmentValue, it.garmentValueCurrency)}</span>}
        <span className={`ow-status sm ${st.cls}`}>{it.caseId ? 'Away' : st.label}</span>
      </div>
    );
  };

  return (
    <div className="ow-view">
      <div className="ow-bar">
        <button type="button" className="lm-back" onClick={onBack}><Icon name="ArrowLeft" size={16} /> Back to wardrobe management</button>
      </div>

      <div className="ow-toolbar">
        <div className="ow-search">
          <Icon name="Search" size={16} className="ow-search-ic" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search garments…" />
          <button type="button" className="ow-search-scan" onClick={() => setShowScan(true)} aria-label="Scan"><Icon name="QrCode" size={16} /></button>
        </div>
        <div className="ow-tools">
          <div className="ow-grouptoggle" role="tablist" aria-label="Group by">
            <button type="button" className={groupBy === 'location' ? 'on' : ''} onClick={() => setGroupBy('location')}>By location</button>
            <button type="button" className={groupBy === 'guest' ? 'on' : ''} onClick={() => setGroupBy('guest')}>By guest</button>
          </div>
          <FilterMenu groups={filterGroups} />
          <SortMenu value={sort} onChange={setSort} options={sortOptions} />
          <div className="ow-viewtoggle" role="tablist" aria-label="View">
            <button type="button" className={view === 'image' ? 'on' : ''} onClick={() => setView('image')} aria-label="Image view"><Icon name="LayoutGrid" size={15} /></button>
            <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="List view"><Icon name="List" size={15} /></button>
          </div>
          <button type="button" className="ow-btn ghost" onClick={() => setShowNewWardrobe(true)}><Icon name="FolderPlus" size={15} /> Wardrobe</button>
          <button type="button" className="ow-btn primary" onClick={() => setShowAdd(true)}><Icon name="Plus" size={15} /> Add</button>
        </div>
      </div>

      {sel.size > 0 && (
        <div className="ow-selbar">
          <span className="ow-selcount">{sel.size} selected</span>
          <button type="button" className="ow-selact" onClick={selectAllShown}>Select all shown{fLoc !== 'all' ? ' in wardrobe' : ''}</button>
          <button type="button" className="ow-selact" onClick={clearSel}>Clear</button>
          <span className="ow-selgap" />
          <button type="button" className="ow-selbtn" onClick={() => runBulk('pack')}><Icon name="Package" size={14} /> Pack</button>
          <button type="button" className="ow-selbtn" onClick={() => runBulk('launder')}><Icon name="Waves" size={14} /> Launder</button>
          <button type="button" className="ow-selbtn" onClick={() => runBulk('move')}><Icon name="FolderInput" size={14} /> Move</button>
          <button type="button" className="ow-selbtn danger" onClick={() => runBulk('archive')}><Icon name="Trash2" size={14} /> Archive</button>
        </div>
      )}

      {loading ? (
        <div className="ow-empty">Loading the wardrobe…</div>
      ) : shown.length === 0 && !query && fLoc === 'all' && fType === 'all' && fStatus === 'all' ? (
        <div className="ow-emptybig">
          <button type="button" className="ow-addtile ow-addtile-big" onClick={() => setShowAdd(true)}>
            <Icon name="Plus" size={30} /><span>Add the first garment</span>
          </button>
          <p className="ow-empty-note">The owner’s wardrobe is empty. Add garments that live on board — they’ll show here as an image catalogue.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="ow-empty">Nothing matches.</div>
      ) : (
        <div className="ow-groups">
          {groups.map((grp) => (
            <section className="ow-group" key={grp.key}>
              <div className="ow-group-head">
                <div className="ow-group-id">
                  <Icon name={groupBy === 'guest' ? 'User' : 'Shirt'} size={14} />
                  <span className="ow-group-t">{grp.title}</span>
                  {grp.subtitle && <span className="ow-group-sub">{grp.subtitle}</span>}
                </div>
                <div className="ow-group-r">
                  <span className="ow-group-ct">{grp.items.length}</span>
                  <button type="button" className="ow-group-sel" onClick={() => selectGroup(grp.items)}>Select all</button>
                </div>
              </div>
              {view === 'image'
                ? <div className="ow-grid">{grp.items.map(renderCard)}</div>
                : <div className="ow-list">{grp.items.map(renderRow)}</div>}
            </section>
          ))}
        </div>
      )}

      {showAdd && <AddGarmentModal wardrobes={wardrobes} guests={guests} defaultWardrobeId={fLoc !== 'all' && fLoc !== 'away' ? fLoc : null} showValue={showValue} onClose={() => setShowAdd(false)} onCreated={load} />}
      {showNewWardrobe && <WardrobeEditorModal scope="owner" onClose={() => setShowNewWardrobe(false)} onCreated={load} />}
      {fullItem && <GarmentFullView item={fullItem} wardrobes={wardrobes} showValue={showValue} caseName={fullItem.caseId ? caseName(fullItem.caseId) : null} onClose={() => setFullItem(null)} onChanged={() => { load(); setFullItem(null); }} onAction={singleAction} />}
      {showScan && <LaundryScanModal onClose={() => setShowScan(false)} onDetect={onScan} />}

      {chooser && (
        <div className="ow-overlay" onClick={() => setChooser(null)}>
          <div className="ow-chooser" onClick={(e) => e.stopPropagation()}>
            <div className="ow-modal-head"><h2 className="ow-modal-title">{chooser.kind === 'pack' ? 'Pack into a case' : 'Move to a wardrobe'}</h2><button type="button" className="ow-x" onClick={() => setChooser(null)}><Icon name="X" size={18} /></button></div>
            <div className="ow-chooser-list">
              {(chooser.kind === 'pack' ? cases : wardrobes).map((t) => (
                <button type="button" className="ow-chooser-row" key={t.id} onClick={() => chooseTarget(t.id)}>
                  <Icon name={chooser.kind === 'pack' ? 'Package' : 'Shirt'} size={16} /><span>{t.name}</span><Icon name="ChevronRight" size={15} className="ow-chooser-chev" />
                </button>
              ))}
              <button type="button" className="ow-chooser-new" onClick={createTarget}><Icon name="Plus" size={15} /> New {chooser.kind === 'pack' ? 'case' : 'wardrobe'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OwnerWardrobeView;

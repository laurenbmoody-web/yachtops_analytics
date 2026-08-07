import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import OwSelect from './OwSelect';
import AddGarmentModal, { compressImage } from './AddGarmentModal';
import {
  loadCases, createCase, updateCase, archiveCase,
  addCasePhotos, removeCasePhoto,
} from '../utils/laundryCases';
import { setLaundryItemsCase, setLaundryItemsWardrobe } from '../utils/laundryStorage';
import { signLaundryValues } from '../utils/laundryPhotos';
import './ownerWardrobe.css';

// Per-person luggage hub, modelled on how a vessel actually works: a guest
// joins for a trip and ARRIVES with luggage to UNPACK into their cabin; when
// they leave, crew PACK it back up. A "bag" is a laundry_case owned by a person
// — a photographed record (exterior to identify it, interior as the repack
// reference). Garments physically inside a bag carry its case_id; unpacking
// moves them into a wardrobe, packing moves them back in.
const LuggageModal = ({ person, personItems = [], wardrobes = [], guests = [], showValue = true, initialMode = 'pack', packIds = [], openBagId = null, onChanged, onClose }) => {
  const [bags, setBags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null); // null = the bag list
  const [creating, setCreating] = useState(false);
  const [nName, setNName] = useState('');
  const [nDest, setNDest] = useState('');
  const [nCabin, setNCabin] = useState(person?.cabin || '');
  const [task, setTask] = useState('view'); // view | packpick | unpackdest
  const [checks, setChecks] = useState(() => new Set());
  const [dest, setDest] = useState('');
  const [urls, setUrls] = useState({}); // luggage photo path -> signed URL
  const [showAddNew, setShowAddNew] = useState(false);
  const [photoBusy, setPhotoBusy] = useState('');
  const [busy, setBusy] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [mCabin, setMCabin] = useState('');
  const [mDest, setMDest] = useState('');
  const [hubMode, setHubMode] = useState(initialMode === 'unpack' ? 'unpack' : 'pack');
  const [pending, setPending] = useState(packIds); // garments awaiting a bag (from a Pack selection)
  const [photoRO, setPhotoRO] = useState(false); // View bag = read-only photos (add only, no delete)
  const unpacking = hubMode === 'unpack';

  const isPersons = (c) => (person.id === 'owner' ? !c.ownerGuestId : c.ownerGuestId === person.id);
  const refresh = async () => {
    const all = await loadCases();
    const mine = all.filter(isPersons);
    setBags(mine); setLoading(false);
    const paths = mine.flatMap((c) => [...c.exteriorPhotos, ...c.interiorPhotos]);
    if (paths.length) {
      const map = await signLaundryValues(paths);
      const o = {}; map.forEach((v, k) => { o[k] = v; }); setUrls(o);
    }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);
  // Opened straight to a specific bag (e.g. "View bag" from a bag group) — that
  // entry is a look, so photos are add-only there.
  useEffect(() => { if (!loading && openBagId && !activeId) { setActiveId(openBagId); setPhotoRO(true); } /* eslint-disable-next-line */ }, [loading]);

  const bag = useMemo(() => bags.find((b) => b.id === activeId) || null, [bags, activeId]);
  const contents = useMemo(() => personItems.filter((i) => i.caseId === activeId), [personItems, activeId]);
  const inWardrobe = useMemo(() => personItems.filter((i) => !i.caseId), [personItems]);
  const packed = contents.length > 0;

  const toggle = (id) => setChecks((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const photoUrl = (p) => urls[p] || (typeof p === 'string' && p.startsWith('data:') ? p : '');
  const openBag = (id) => { setActiveId(id); setTask('view'); setChecks(new Set()); setEditMeta(false); setPhotoRO(false); };
  const whose = person.name === 'Owner' ? 'the owner’s' : `${person.name}’s`;

  const createBag = async () => {
    if (!nName.trim() || busy) return;
    setBusy(true);
    const c = await createCase({
      name: nName.trim(), destination: nDest.trim(), cabin: nCabin.trim(),
      ownerType: person.id === 'owner' ? 'owner' : 'guest',
      ownerGuestId: person.id === 'owner' ? null : person.id,
    });
    setBusy(false);
    if (c) {
      setCreating(false); setNName(''); setNDest(''); await refresh(); onChanged?.();
      if (pending.length) packInto(c.id); else openBag(c.id);
    }
  };
  const startCreate = () => { setCreating(true); setNCabin(person?.cabin || ''); };
  // Drop the pending (Pack-selected) garments into the chosen bag, then open it.
  const packInto = async (bagId) => {
    setBusy(true);
    if (pending.length) await setLaundryItemsCase(pending, bagId);
    setPending([]); setBusy(false); onChanged?.(); await refresh(); openBag(bagId);
  };

  const saveMeta = async () => {
    if (!bag) return;
    setBusy(true);
    await updateCase(bag.id, { cabin: mCabin.trim(), destination: mDest.trim() });
    setBusy(false); setEditMeta(false); refresh(); onChanged?.();
  };

  const addPhotos = async (kind, e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length || !bag) return;
    setPhotoBusy(kind);
    const dataUrls = (await Promise.all(files.map((f) => compressImage(f)))).filter(Boolean);
    await addCasePhotos(bag.id, kind, dataUrls, bag.details);
    await refresh();
    setPhotoBusy('');
  };
  const delPhoto = async (kind, path) => { if (!bag) return; await removeCasePhoto(bag.id, kind, path, bag.details); refresh(); };

  // Pack garments from the wardrobe INTO the bag (departure).
  const startPackPick = () => { setChecks(new Set()); setTask('packpick'); };
  const confirmPackPick = async () => {
    const ids = [...checks];
    if (ids.length && bag) { setBusy(true); await setLaundryItemsCase(ids, bag.id); setBusy(false); }
    setTask('view'); setChecks(new Set()); onChanged?.(); refresh();
  };
  // Unpack the bag's garments OUT into a wardrobe / the cabin (arrival return).
  const startUnpackDest = () => {
    const guess = personItems.find((i) => i.wardrobeId)?.wardrobeId || wardrobes[0]?.id || '';
    setDest(guess); setTask('unpackdest');
  };
  const confirmUnpack = async () => {
    const ids = contents.map((i) => i.id);
    setBusy(true);
    if (dest && ids.length) await setLaundryItemsWardrobe(ids, dest);
    if (ids.length) await setLaundryItemsCase(ids, null);
    setBusy(false); setTask('view'); onChanged?.(); refresh();
  };
  const removeItem = async (id) => { setBusy(true); await setLaundryItemsCase([id], null); setBusy(false); onChanged?.(); refresh(); };
  const deleteBag = async () => { if (!bag) return; setBusy(true); await archiveCase(bag.id); setBusy(false); onChanged?.(); await refresh(); setActiveId(null); };

  const gallery = (kind, label, hint) => {
    const list = kind === 'interior' ? (bag.interiorPhotos || []) : (bag.exteriorPhotos || []);
    return (
      <div className="ow-lug-photos">
        <div className="ow-lug-plabel">{label}{hint && <span>{hint}</span>}</div>
        <div className="ow-photos">
          {list.map((p) => (
            <div className="ow-photo-thumb" key={p}>
              {photoUrl(p) ? <img src={photoUrl(p)} alt="" /> : <span className="ow-card-ph"><Icon name="Image" size={20} /></span>}
              {!photoRO && <button type="button" className="ow-photo-del" onClick={() => delPhoto(kind, p)} aria-label="Remove"><Icon name="X" size={12} /></button>}
            </div>
          ))}
          <label className="ow-photo-add">
            <Icon name={photoBusy === kind ? 'Loader' : 'Camera'} size={20} className={photoBusy === kind ? 'ow-ai-spin' : ''} />
            <span>{photoBusy === kind ? 'Saving…' : list.length ? 'Add more' : 'Add photos'}</span>
            <input type="file" accept="image/*" multiple onChange={(e) => addPhotos(kind, e)} hidden disabled={photoBusy === kind} />
          </label>
        </div>
      </div>
    );
  };

  const itemRow = (it, opts = {}) => {
    const photo = (Array.isArray(it.photos) && it.photos[0]) || it.photo || '';
    const ticked = checks.has(it.id);
    return (
      <li className={`ow-case-row${opts.pick ? ' pick' : ''}${opts.pick && ticked ? ' on' : ''}`} key={it.id} onClick={opts.pick ? () => toggle(it.id) : undefined}>
        {opts.pick && <span className="ow-case-check"><Icon name={ticked ? 'CheckSquare' : 'Square'} size={18} /></span>}
        <span className="ow-case-thumb">{photo ? <img src={photo} alt="" /> : <Icon name="Shirt" size={16} />}</span>
        <div className="ow-case-main">
          <span className="ow-card-nm">{it.description || 'Garment'}</span>
          <span className="ow-card-sub">{[it.garmentType, it.colour].filter(Boolean).join(' · ') || '—'}</span>
        </div>
        {opts.removable && <button type="button" className="ow-case-x" title="Take out of bag" onClick={() => removeItem(it.id)}><Icon name="X" size={15} /></button>}
      </li>
    );
  };

  // ---- The person's bag list ----
  const bagRow = (c) => {
    const n = personItems.filter((i) => i.caseId === c.id).length;
    const cover = (c.exteriorPhotos || [])[0];
    return (
      <button type="button" className="ow-wm-row ow-case-open" key={c.id} onClick={() => (pending.length ? packInto(c.id) : openBag(c.id))}>
        <span className="ow-lug-cover">{cover && photoUrl(cover) ? <img src={photoUrl(cover)} alt="" /> : <Icon name="Luggage" size={16} />}</span>
        <div className="ow-wm-main">
          <span className="ow-wm-nm">{c.name}</span>
          <span className="ow-wm-sub">{[c.cabin || null, c.destination ? `→ ${c.destination}` : null, `${n} garment${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
        </div>
        <span className={`ow-status sm ${n > 0 ? 'away' : 'stored'}`}>{n > 0 ? 'Packed' : 'Empty'}</span>
        <Icon name="ChevronRight" size={16} className="ow-chooser-chev" />
      </button>
    );
  };
  const createForm = (
    <div className="ow-case-new">
      <input className="ow-input" autoFocus placeholder="Bag name (e.g. Large Rimowa, Ski bag)" value={nName} onChange={(e) => setNName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createBag(); }} />
      <div className="ow-row2">
        <input className="ow-input" placeholder="Cabin" value={nCabin} onChange={(e) => setNCabin(e.target.value)} />
        <input className="ow-input" placeholder="Destination (optional)" value={nDest} onChange={(e) => setNDest(e.target.value)} />
      </div>
      <div className="ow-case-new-acts">
        <button type="button" className="ow-btn ghost" onClick={() => setCreating(false)}>Cancel</button>
        <button type="button" className="ow-btn primary" disabled={!nName.trim() || busy} onClick={createBag}>{busy ? 'Creating…' : 'Create bag'}</button>
      </div>
    </div>
  );
  const listScreen = (
    <>
      <div className="ow-case-head">
        <span className="ow-eyebrow">Luggage · {unpacking ? 'Unpack' : 'Pack'}</span>
        <h2 className="ow-full-nm"><Icon name="Luggage" size={20} /> {person.name}</h2>
        <p className="ow-full-brand">{person.cabin ? `${person.cabin} · ` : ''}{bags.length} bag{bags.length === 1 ? '' : 's'}</p>
      </div>
      <div className="ow-case-body">
        {pending.length > 0 && !creating && <div className="ow-case-note">Packing {pending.length} garment{pending.length === 1 ? '' : 's'} — choose a bag or create one.</div>}
        {loading ? <p className="ow-hist-empty">Loading…</p>
          : creating ? createForm
            : bags.length === 0 ? (
              <div className="ow-emptybig">
                <button type="button" className="ow-addtile ow-addtile-big" onClick={startCreate}><Icon name={unpacking ? 'PackageOpen' : 'Plus'} size={28} /><span>{unpacking ? 'Unpack an arriving bag' : 'Pack a bag'}</span></button>
                <p className="ow-empty-note">{unpacking
                  ? `Log a bag ${whose} guest arrived with — photograph it, then catalogue the garments into their cabin.`
                  : `Photograph the luggage inside and out, then pack ${whose} garments for travel.`}</p>
              </div>
            ) : (
              <div className="ow-wm-list">{bags.map(bagRow)}</div>
            )}
      </div>
      {!creating && bags.length > 0 && (
        <div className="ow-full-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="ow-btn primary" onClick={startCreate}><Icon name="Plus" size={15} /> New bag</button>
        </div>
      )}
    </>
  );

  // ---- A single bag ----
  const detailScreen = bag && (
    <>
      <div className="ow-case-head">
        <div className="ow-lug-detail-top">
          <button type="button" className="ow-lug-back" onClick={() => setActiveId(null)}><Icon name="ArrowLeft" size={14} /> All bags</button>
          <span className={`ow-lug-state ${packed ? 'away' : 'stored'}`}>{packed ? `Packed · ${contents.length}` : 'Empty'}</span>
        </div>
        <h2 className="ow-full-nm"><Icon name="Luggage" size={20} /> {bag.name}</h2>
        {!editMeta ? (
          <p className="ow-full-brand">
            {[bag.cabin || 'No cabin set', bag.destination ? `→ ${bag.destination}` : null].filter(Boolean).join(' · ')}
            <button type="button" className="ow-lug-edit" onClick={() => { setEditMeta(true); setMCabin(bag.cabin || ''); setMDest(bag.destination || ''); }}><Icon name="Pencil" size={12} /> edit</button>
          </p>
        ) : (
          <div className="ow-lug-meta">
            <div className="ow-row2">
              <input className="ow-input" placeholder="Cabin" value={mCabin} onChange={(e) => setMCabin(e.target.value)} />
              <input className="ow-input" placeholder="Destination" value={mDest} onChange={(e) => setMDest(e.target.value)} />
            </div>
            <div className="ow-case-new-acts">
              <button type="button" className="ow-btn ghost" onClick={() => setEditMeta(false)}>Cancel</button>
              <button type="button" className="ow-btn primary" disabled={busy} onClick={saveMeta}>Save</button>
            </div>
          </div>
        )}
      </div>

      <div className="ow-case-body">
        {task === 'packpick' ? (
          <>
            <div className="ow-case-note">Tick garments to pack into this bag</div>
            {inWardrobe.length === 0
              ? <p className="ow-hist-empty">Nothing in {whose} wardrobe to pack. Add a new garment instead.</p>
              : <ul className="ow-case-list">{inWardrobe.map((it) => itemRow(it, { pick: true }))}</ul>}
          </>
        ) : task === 'unpackdest' ? (
          <div className="ow-case-unpack">
            <label className="ow-l">Unpack into</label>
            <OwSelect value={dest} onChange={setDest} placeholder={wardrobes.length ? 'Choose a wardrobe' : 'No wardrobes yet'} options={wardrobes.map((w) => ({ value: w.id, label: [w.name, w.locationName].filter(Boolean).join(' · ') }))} />
            <p className="ow-case-unpack-note">{contents.length} garment{contents.length === 1 ? '' : 's'} will be placed here and taken out of the bag.</p>
            {(bag.interiorPhotos || []).length > 0 && (
              <div className="ow-lug-ref">
                <div className="ow-lug-plabel">Packing reference<span>how it was packed</span></div>
                <div className="ow-photos">{bag.interiorPhotos.map((p) => photoUrl(p) && <div className="ow-photo-thumb" key={p}><img src={photoUrl(p)} alt="" /></div>)}</div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="ow-lug-galleries">
              {gallery('exterior', 'Luggage exterior', 'identify the bag')}
              {gallery('interior', 'Interior', 'packing reference')}
            </div>
            <div className="ow-lug-contents-h">
              <span>{contents.length} in this bag</span>
            </div>
            {contents.length === 0
              ? <p className="ow-hist-empty">{unpacking ? 'Empty — add each garment to the cabin as you unpack it.' : 'Empty — pack garments in from the wardrobe.'}</p>
              : <ul className="ow-case-list">{contents.map((it) => itemRow(it, { removable: true }))}</ul>}
          </>
        )}
      </div>

      <div className="ow-full-actions">
        {task === 'packpick' ? (
          <>
            <button type="button" className="ow-btn ghost" onClick={() => setTask('view')}>Cancel</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="ow-btn primary" disabled={busy || checks.size === 0} onClick={confirmPackPick}>{busy ? 'Packing…' : `Pack ${checks.size} in`}</button>
          </>
        ) : task === 'unpackdest' ? (
          <>
            <button type="button" className="ow-btn ghost" onClick={() => setTask('view')}>Cancel</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="ow-btn primary" disabled={busy || !dest} onClick={confirmUnpack}>{busy ? 'Unpacking…' : 'Unpack here'}</button>
          </>
        ) : (
          <>
            {contents.length === 0 && <button type="button" className="ow-btn ghost danger" onClick={deleteBag}><Icon name="Trash2" size={14} /> Delete bag</button>}
            <span style={{ flex: 1 }} />
            <button type="button" className="ow-btn ghost" onClick={() => setShowAddNew(true)}><Icon name="Camera" size={14} /> Add new</button>
            {unpacking
              ? (contents.length > 0
                ? <button type="button" className="ow-btn primary" onClick={startUnpackDest}><Icon name="PackageOpen" size={15} /> Unpack into cabin</button>
                : <button type="button" className="ow-btn primary" onClick={startPackPick}><Icon name="Plus" size={15} /> From wardrobe</button>)
              : <button type="button" className="ow-btn primary" onClick={startPackPick}><Icon name="Plus" size={15} /> Pack from wardrobe</button>}
          </>
        )}
      </div>
    </>
  );

  return (
    <>
      <div className="ow-overlay" role="dialog" aria-modal="true" aria-label="Luggage" onClick={onClose}>
        <div className="ow-full ow-case ow-lug" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="ow-full-x" onClick={onClose} aria-label="Close"><Icon name="X" size={20} /></button>
          {activeId ? detailScreen : listScreen}
        </div>
      </div>
      {showAddNew && (
        <AddGarmentModal
          wardrobes={wardrobes}
          guests={guests}
          scope={person.id === 'owner' ? 'owner' : 'guest'}
          defaultGuestId={person.id === 'owner' ? '' : person.id}
          showValue={showValue}
          onClose={() => setShowAddNew(false)}
          onCreated={async (created) => {
            setShowAddNew(false);
            // Departure: the new garment goes straight into the bag. Arrival:
            // it's catalogued into the wardrobe (that IS the unpacking).
            if (created?.id && bag && !unpacking) await setLaundryItemsCase([created.id], bag.id);
            onChanged?.(); refresh();
          }}
        />
      )}
    </>
  );
};

export default LuggageModal;

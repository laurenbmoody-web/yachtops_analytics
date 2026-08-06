import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import OwSelect from './OwSelect';
import AddGarmentModal, { compressImage } from './AddGarmentModal';
import {
  loadCases, createCase, updateCase, archiveCase,
  addCasePhotos, removeCasePhoto, CaseStatus,
} from '../utils/laundryCases';
import { setLaundryItemsCase, setLaundryItemsWardrobe, updateLaundryItem } from '../utils/laundryStorage';
import { signLaundryValues } from '../utils/laundryPhotos';
import './ownerWardrobe.css';

const STATE = {
  open: { label: 'Packing', cls: 'stored' }, packed: { label: 'Packed', cls: 'stored' },
  sent: { label: 'Sent — away', cls: 'away' }, received: { label: 'Received', cls: 'prog' }, closed: { label: 'Unpacked', cls: 'stored' },
};

// Per-person luggage hub. Lists a person's bags and drives one through its life:
// pack (assign cabin, photograph the case inside & out, add garments — existing
// or brand-new) → send off (check each out) → receive (check each back, flag any
// missing) → unpack into a wardrobe. A "bag" is a laundry_case owned by a person.
const LuggageModal = ({ person, personItems = [], wardrobes = [], guests = [], showValue = true, initialMode = 'pack', onChanged, onClose }) => {
  const [bags, setBags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(null); // null = the bag list
  const [creating, setCreating] = useState(false);
  const [nName, setNName] = useState('');
  const [nDest, setNDest] = useState('');
  const [nCabin, setNCabin] = useState(person?.cabin || '');
  const [mode, setMode] = useState('view'); // view | addpick | send | receive | unpack
  const [checks, setChecks] = useState(() => new Set());
  const [dest, setDest] = useState('');
  const [urls, setUrls] = useState({}); // luggage photo path -> signed URL
  const [showAddNew, setShowAddNew] = useState(false);
  const [photoBusy, setPhotoBusy] = useState('');
  const [busy, setBusy] = useState(false);
  const [editMeta, setEditMeta] = useState(false);
  const [mCabin, setMCabin] = useState('');
  const [mDest, setMDest] = useState('');

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
  // If opened to unpack and a returning bag exists, jump straight into it.
  useEffect(() => {
    if (loading || activeId) return;
    if (initialMode === 'unpack') {
      const back = bags.find((b) => b.status === 'sent' || b.status === 'received');
      if (back) setActiveId(back.id);
    }
    // eslint-disable-next-line
  }, [loading]);

  const bag = useMemo(() => bags.find((b) => b.id === activeId) || null, [bags, activeId]);
  const contents = useMemo(() => personItems.filter((i) => i.caseId === activeId), [personItems, activeId]);
  const addable = useMemo(() => personItems.filter((i) => !i.caseId), [personItems]);
  const st = STATE[bag?.status] || STATE.open;
  const packing = bag && (bag.status === 'open' || bag.status === 'packed');

  const toggle = (id) => setChecks((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const photoUrl = (p) => urls[p] || (typeof p === 'string' && p.startsWith('data:') ? p : '');

  const openBag = (id) => { setActiveId(id); setMode('view'); setChecks(new Set()); setEditMeta(false); };

  const createBag = async () => {
    if (!nName.trim() || busy) return;
    setBusy(true);
    const c = await createCase({
      name: nName.trim(), destination: nDest.trim(), cabin: nCabin.trim(),
      ownerType: person.id === 'owner' ? 'owner' : 'guest',
      ownerGuestId: person.id === 'owner' ? null : person.id,
    });
    setBusy(false);
    if (c) { setCreating(false); setNName(''); setNDest(''); await refresh(); onChanged?.(); openBag(c.id); }
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

  const startAddPick = () => { setChecks(new Set()); setMode('addpick'); };
  const confirmAddPick = async () => {
    const ids = [...checks];
    if (ids.length && bag) { setBusy(true); await setLaundryItemsCase(ids, bag.id); setBusy(false); }
    setMode('view'); setChecks(new Set()); onChanged?.(); refresh();
  };
  const removeItem = async (id) => { setBusy(true); await setLaundryItemsCase([id], null); setBusy(false); onChanged?.(); refresh(); };

  const startSend = () => { setChecks(new Set(contents.map((i) => i.id))); setMode('send'); };
  const confirmSend = async () => {
    setBusy(true);
    const notGoing = contents.map((i) => i.id).filter((id) => !checks.has(id));
    if (notGoing.length) await setLaundryItemsCase(notGoing, null);
    await updateCase(bag.id, { status: CaseStatus.SENT });
    setBusy(false); setMode('view'); onChanged?.(); refresh();
  };
  const startReceive = () => { setChecks(new Set()); setMode('receive'); };
  const confirmReceive = async () => {
    setBusy(true);
    const missing = contents.map((i) => i.id).filter((id) => !checks.has(id));
    for (const id of missing) {
      // eslint-disable-next-line no-await-in-loop
      await updateLaundryItem(id, { flag: 'missing', flagNote: `Not returned in ${bag?.name || 'bag'}` });
    }
    await updateCase(bag.id, { status: CaseStatus.RECEIVED });
    setBusy(false); setMode('view'); onChanged?.(); refresh();
  };
  const startUnpack = () => {
    const guess = personItems.find((i) => i.wardrobeId)?.wardrobeId || wardrobes[0]?.id || '';
    setDest(guess); setMode('unpack');
  };
  const confirmUnpack = async () => {
    const ids = contents.map((i) => i.id);
    setBusy(true);
    if (dest && ids.length) await setLaundryItemsWardrobe(ids, dest);
    if (ids.length) await setLaundryItemsCase(ids, null);
    await updateCase(bag.id, { status: CaseStatus.CLOSED });
    setBusy(false); setMode('view'); onChanged?.(); await refresh(); setActiveId(null);
  };
  const deleteBag = async () => { if (!bag) return; setBusy(true); await archiveCase(bag.id); setBusy(false); onChanged?.(); await refresh(); setActiveId(null); };

  const checking = mode === 'send' || mode === 'receive';
  const heading = mode === 'send' ? 'Confirm what’s leaving the vessel'
    : mode === 'receive' ? 'Tick each garment back in — anything unticked is flagged missing'
      : mode === 'unpack' ? 'Where should these be unpacked?'
        : mode === 'addpick' ? 'Tick garments to pack into this bag' : null;

  const gallery = (kind, label, hint) => {
    const list = kind === 'interior' ? (bag.interiorPhotos || []) : (bag.exteriorPhotos || []);
    return (
      <div className="ow-lug-photos">
        <div className="ow-lug-plabel">{label}{hint && <span>{hint}</span>}</div>
        <div className="ow-photos">
          {list.map((p) => (
            <div className="ow-photo-thumb" key={p}>
              {photoUrl(p) ? <img src={photoUrl(p)} alt="" /> : <span className="ow-card-ph"><Icon name="Image" size={20} /></span>}
              <button type="button" className="ow-photo-del" onClick={() => delPhoto(kind, p)} aria-label="Remove"><Icon name="X" size={12} /></button>
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
    const pick = opts.pick;
    return (
      <li className={`ow-case-row${pick ? ' pick' : ''}${pick && ticked ? ' on' : ''}`} key={it.id} onClick={pick ? () => toggle(it.id) : undefined}>
        {pick && <span className="ow-case-check"><Icon name={ticked ? 'CheckSquare' : 'Square'} size={18} /></span>}
        <span className="ow-case-thumb">{photo ? <img src={photo} alt="" /> : <Icon name="Shirt" size={16} />}</span>
        <div className="ow-case-main">
          <span className="ow-card-nm">{it.description || 'Garment'}</span>
          <span className="ow-card-sub">{[it.garmentType, it.colour].filter(Boolean).join(' · ') || '—'}</span>
        </div>
        {it.flag === 'missing' && <span className="ow-case-miss">Missing</span>}
        {opts.removable && <button type="button" className="ow-case-x" title="Take out of bag" onClick={() => removeItem(it.id)}><Icon name="X" size={15} /></button>}
      </li>
    );
  };

  // ---- The person's bag list ----
  const listScreen = (
    <>
      <div className="ow-case-head">
        <span className="ow-eyebrow">Luggage</span>
        <h2 className="ow-full-nm"><Icon name="Luggage" size={20} /> {person.name}</h2>
        <p className="ow-full-brand">{person.cabin ? `${person.cabin} · ` : ''}{bags.length} bag{bags.length === 1 ? '' : 's'}</p>
      </div>
      <div className="ow-case-body">
        {loading ? <p className="ow-hist-empty">Loading…</p> : (
          <div className="ow-wm-list">
            {bags.length === 0 && !creating && <p className="ow-empty-note ow-lug-empty">No bags yet. Create one to pack {person.name === 'Owner' ? 'the owner’s' : `${person.name}’s`} things for travel.</p>}
            {bags.map((c) => {
              const n = personItems.filter((i) => i.caseId === c.id).length;
              const s = STATE[c.status] || STATE.open;
              const cover = (c.exteriorPhotos || [])[0];
              return (
                <button type="button" className="ow-wm-row ow-case-open" key={c.id} onClick={() => openBag(c.id)}>
                  <span className="ow-lug-cover">{cover && photoUrl(cover) ? <img src={photoUrl(cover)} alt="" /> : <Icon name="Luggage" size={16} />}</span>
                  <div className="ow-wm-main">
                    <span className="ow-wm-nm">{c.name}</span>
                    <span className="ow-wm-sub">{[c.cabin || null, c.destination ? `→ ${c.destination}` : null, `${n} garment${n === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
                  </div>
                  <span className={`ow-status sm ${s.cls}`}>{s.label}</span>
                  <Icon name="ChevronRight" size={16} className="ow-chooser-chev" />
                </button>
              );
            })}
            {creating && (
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
            )}
          </div>
        )}
      </div>
      {!creating && (
        <div className="ow-full-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="ow-btn primary" onClick={() => { setCreating(true); setNCabin(person?.cabin || ''); }}><Icon name="Plus" size={15} /> New bag</button>
        </div>
      )}
    </>
  );

  // ---- A single bag ----
  const detailScreen = bag && (
    <>
      <div className="ow-case-head">
        <button type="button" className="ow-lug-back" onClick={() => setActiveId(null)}><Icon name="ArrowLeft" size={14} /> All bags</button>
        <span className={`ow-full-state ${st.cls}`}>{st.label}</span>
        <h2 className="ow-full-nm"><Icon name="Luggage" size={20} /> {bag.name}</h2>
        {!editMeta ? (
          <p className="ow-full-brand">
            {[bag.cabin || 'No cabin set', bag.destination ? `→ ${bag.destination}` : null].filter(Boolean).join(' · ')}
            {packing && <button type="button" className="ow-lug-edit" onClick={() => { setEditMeta(true); setMCabin(bag.cabin || ''); setMDest(bag.destination || ''); }}><Icon name="Pencil" size={12} /> edit</button>}
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
        {heading && <div className="ow-case-note">{heading}</div>}
      </div>

      <div className="ow-case-body">
        {mode === 'unpack' ? (
          <div className="ow-case-unpack">
            <label className="ow-l">Unpack into</label>
            <OwSelect value={dest} onChange={setDest} placeholder={wardrobes.length ? 'Choose a wardrobe' : 'No wardrobes yet'} options={wardrobes.map((w) => ({ value: w.id, label: [w.name, w.locationName].filter(Boolean).join(' · ') }))} />
            <p className="ow-case-unpack-note">{contents.length} garment{contents.length === 1 ? '' : 's'} will be placed here and the bag marked unpacked.</p>
            {(bag.interiorPhotos || []).length > 0 && (
              <div className="ow-lug-ref">
                <div className="ow-lug-plabel">Packing reference<span>how it was packed</span></div>
                <div className="ow-photos">{bag.interiorPhotos.map((p) => photoUrl(p) && <div className="ow-photo-thumb" key={p}><img src={photoUrl(p)} alt="" /></div>)}</div>
              </div>
            )}
          </div>
        ) : mode === 'addpick' ? (
          addable.length === 0
            ? <p className="ow-hist-empty">Every on-board garment is already packed. Add a new garment instead.</p>
            : <ul className="ow-case-list">{addable.map((it) => itemRow(it, { pick: true }))}</ul>
        ) : (
          <>
            {packing && (
              <div className="ow-lug-galleries">
                {gallery('exterior', 'Luggage exterior', 'identify the bag')}
                {gallery('interior', 'Interior', 'packing reference')}
              </div>
            )}
            <div className="ow-lug-contents-h">
              <span>{contents.length} garment{contents.length === 1 ? '' : 's'} packed</span>
              {packing && (
                <div className="ow-lug-add">
                  <button type="button" className="ow-btn ghost sm" onClick={startAddPick}><Icon name="Plus" size={14} /> Add existing</button>
                  <button type="button" className="ow-btn ghost sm" onClick={() => setShowAddNew(true)}><Icon name="Camera" size={14} /> Add new</button>
                </div>
              )}
            </div>
            {contents.length === 0
              ? <p className="ow-hist-empty">Nothing packed yet.</p>
              : <ul className="ow-case-list">{contents.map((it) => itemRow(it, { removable: packing, pick: checking }))}</ul>}
          </>
        )}
      </div>

      <div className="ow-full-actions">
        {mode === 'view' ? (
          <>
            {packing && contents.length === 0 && <button type="button" className="ow-btn ghost danger" onClick={deleteBag}><Icon name="Trash2" size={14} /> Delete bag</button>}
            <span style={{ flex: 1 }} />
            {packing && contents.length > 0 && <button type="button" className="ow-btn primary" onClick={startSend}><Icon name="Send" size={15} /> Send off</button>}
            {bag.status === 'sent' && <button type="button" className="ow-btn primary" onClick={startReceive}><Icon name="ClipboardCheck" size={15} /> Receive</button>}
            {(bag.status === 'received' || bag.status === 'sent') && contents.length > 0 && <button type="button" className="ow-btn ghost" onClick={startUnpack}><Icon name="PackageOpen" size={15} /> Unpack</button>}
          </>
        ) : mode === 'send' ? (
          <>
            <button type="button" className="ow-btn ghost" onClick={() => setMode('view')}>Cancel</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="ow-btn primary" disabled={busy} onClick={confirmSend}>{busy ? 'Sending…' : `Send ${checks.size} off`}</button>
          </>
        ) : mode === 'receive' ? (
          <>
            <button type="button" className="ow-btn ghost" onClick={() => setMode('view')}>Cancel</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="ow-btn primary" disabled={busy} onClick={confirmReceive}>{busy ? 'Saving…' : `Receive (${checks.size}/${contents.length})`}</button>
          </>
        ) : mode === 'addpick' ? (
          <>
            <button type="button" className="ow-btn ghost" onClick={() => setMode('view')}>Cancel</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="ow-btn primary" disabled={busy || checks.size === 0} onClick={confirmAddPick}>{busy ? 'Adding…' : `Add ${checks.size}`}</button>
          </>
        ) : (
          <>
            <button type="button" className="ow-btn ghost" onClick={() => setMode('view')}>Cancel</button>
            <span style={{ flex: 1 }} />
            <button type="button" className="ow-btn primary" disabled={busy || !dest} onClick={confirmUnpack}>{busy ? 'Unpacking…' : 'Unpack here'}</button>
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
          defaultGuestId={person.id === 'owner' ? '' : person.id}
          showValue={showValue}
          onClose={() => setShowAddNew(false)}
          onCreated={async (created) => {
            setShowAddNew(false);
            if (created?.id && bag) await setLaundryItemsCase([created.id], bag.id);
            onChanged?.(); refresh();
          }}
        />
      )}
    </>
  );
};

export default LuggageModal;

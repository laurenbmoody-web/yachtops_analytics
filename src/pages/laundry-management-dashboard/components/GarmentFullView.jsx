import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { updateLaundryItem, LaundryStatus, availableLaundryTags, formatLaundryTag, getLaundryEvents } from '../utils/laundryStorage';
import { money } from '../utils/laundryBilling';
import { printLaundryLabels } from '../utils/laundryLabels';
import { GARMENT_TYPES, GENDERS, CONDITIONS, SEASONS, CURRENCIES, dashOpts, FlagField, FLAG_LABELS } from './AddGarmentModal';
import OwSelect from './OwSelect';
import './ownerWardrobe.css';

const inWash = (i) => i.status === LaundryStatus.IN_PROGRESS || i.status === LaundryStatus.READY_TO_DELIVER;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const guestLabel = (g) => (g ? (g.name || g.fullName || [g.firstName, g.lastName].filter(Boolean).join(' ') || 'Guest') : '');

const ACTION_LABELS = {
  created: 'Added to wardrobe', edited: 'Details updated', in_progress: 'Sent to laundry',
  ready_to_deliver: 'Ready to deliver', delivered: 'Returned / delivered', stored: 'Back in wardrobe',
  packed: 'Packed into a case', unpacked: 'Unpacked', moved: 'Moved wardrobe', archived: 'Archived',
};
const actionLabel = (a) => ACTION_LABELS[a] || (a ? a.charAt(0).toUpperCase() + a.slice(1).replace(/_/g, ' ') : 'Updated');

// One label/value line — renders nothing when the value is empty.
const Row = ({ k, v }) => ((v == null || v === '') ? null : (
  <div className="ow-dl-row"><dt>{k}</dt><dd>{v}</dd></div>
));

// Full-view of one garment: photo gallery, a readable attribute list, history,
// full edit, and the per-item actions (primary buttons + overflow menu).
const GarmentFullView = ({ item, wardrobes = [], guests = [], showValue = true, caseName = null, onClose, onChanged, onAction }) => {
  const dd = item.details || {};
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({
    description: item.description || '', brand: dd.brand || '', longDesc: dd.description || '',
    sku: dd.sku || '', monogram: dd.monogram || '', purchasedPlace: dd.purchasedPlace || '', purchasedDate: dd.purchasedDate || '',
    garmentType: item.garmentType || '', gender: dd.gender || '', size: dd.size || '', colour: item.colour || '',
    material: dd.material || '', condition: dd.condition || '', season: dd.season || '',
    garmentValue: item.garmentValue ?? '', garmentValueCurrency: item.garmentValueCurrency || 'EUR',
    tags: Array.isArray(item.tags) ? item.tags : [], notes: item.notes || '',
    wardrobeId: item.wardrobeId || '', guestId: item.ownerGuestId || '', staysOnboard: item.staysOnboard !== false,
    flag: item.flag || '', flagNote: item.flagNote || '',
  });
  const [tab, setTab] = useState('details');
  const [busy, setBusy] = useState(false);
  const gallery = (Array.isArray(item.photos) && item.photos.length ? item.photos : (item.photo ? [item.photo] : [])).filter(Boolean);
  const [active, setActive] = useState(0);
  const st = item.caseId
    ? { label: `Away · in ${caseName || 'a case'}`, cls: 'away' }
    : inWash(item) ? { label: 'In laundry', cls: 'prog' } : { label: 'On board', cls: 'stored' };
  const photo = gallery[active] || gallery[0] || '';
  const home = wardrobes.find((w) => w.id === item.wardrobeId);
  const locationLabel = home ? [home.name, home.locationName].filter(Boolean).join(' · ') : '';
  const owner = item.ownerGuestId ? guestLabel(guests.find((g) => g.id === item.ownerGuestId)) || item.ownerName : 'Owner';
  const purchased = [dd.purchasedPlace, dd.purchasedDate ? fmtDate(dd.purchasedDate) : ''].filter(Boolean).join(' · ');
  const careText = (Array.isArray(item.tags) ? item.tags : []).map(formatLaundryTag).join(' · ');
  const hasPurchase = (showValue && item.garmentValue != null) || dd.sku || dd.monogram || purchased;

  const [stays, setStays] = useState(!!item.staysOnboard);
  const [staysBusy, setStaysBusy] = useState(false);
  const toggleStays = async () => {
    if (staysBusy) return;
    const next = !stays;
    setStays(next); setStaysBusy(true);
    await updateLaundryItem(item.id, { staysOnboard: next });
    setStaysBusy(false);
    window.showToast?.(next ? 'Marked as staying aboard' : 'No longer marked as staying aboard', 'success');
  };

  const [events, setEvents] = useState([]);
  useEffect(() => { let go = true; getLaundryEvents(item.id).then((e) => { if (go) setEvents(e); }); return () => { go = false; }; }, [item.id]);

  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

  const set = (k, v) => setDraft((p) => ({ ...p, [k]: v }));
  const toggleTag = (t) => setDraft((p) => ({ ...p, tags: p.tags.includes(t) ? p.tags.filter((x) => x !== t) : [...p.tags, t] }));

  const save = async () => {
    setBusy(true);
    const details = { ...(item.details || {}) };
    const put = (k, v) => { const t = typeof v === 'string' ? v.trim() : v; if (t) details[k] = t; else delete details[k]; };
    put('brand', draft.brand); put('description', draft.longDesc); put('sku', draft.sku); put('size', draft.size);
    put('material', draft.material); put('gender', draft.gender); put('condition', draft.condition); put('season', draft.season);
    put('purchasedPlace', draft.purchasedPlace); put('purchasedDate', draft.purchasedDate); put('monogram', draft.monogram);
    const guest = guests.find((g) => g.id === draft.guestId);
    const ownerPatch = guest
      ? { ownerType: 'guest', ownerGuestId: guest.id, ownerName: guestLabel(guest), ownerDisplayName: guestLabel(guest) }
      : { ownerType: 'other', ownerGuestId: null, ownerName: 'Owner', ownerDisplayName: 'Owner' };
    const updated = await updateLaundryItem(item.id, {
      description: draft.description.trim(), garmentType: draft.garmentType || null, colour: draft.colour.trim(),
      garmentValue: draft.garmentValue === '' ? null : Number(draft.garmentValue), garmentValueCurrency: draft.garmentValueCurrency,
      tags: draft.tags, notes: draft.notes.trim(), details, wardrobeId: draft.wardrobeId || null, staysOnboard: draft.staysOnboard,
      flag: draft.flag || null, flagNote: draft.flag ? draft.flagNote.trim() : '',
      ...ownerPatch,
    });
    setBusy(false);
    if (updated) { setEdit(false); onChanged?.(); }
  };

  const act = (kind) => { onAction?.(kind, item); };

  return (
    <div className="ow-overlay" role="dialog" aria-modal="true" aria-label="Garment" onClick={onClose}>
      <div className="ow-full" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ow-full-x" onClick={onClose} aria-label="Close"><Icon name="X" size={20} /></button>

        <div className="ow-full-media">
          <div className="ow-full-stage">
            {photo ? <img src={photo} alt={item.description || 'Garment'} /> : <span className="ow-full-ph"><Icon name="Shirt" size={54} /></span>}
          </div>
          {gallery.length > 1 && (
            <div className="ow-full-thumbs">
              {gallery.map((src, i) => (
                <button type="button" key={i} className={`ow-full-thumb${i === active ? ' on' : ''}`} onClick={() => setActive(i)}><img src={src} alt={`Photo ${i + 1}`} /></button>
              ))}
            </div>
          )}
        </div>

        <div className="ow-full-info">
          {!edit ? (
            <>
              <div className="ow-full-head">
                <span className={`ow-full-state ${st.cls}`}>{st.label}</span>
                <h2 className="ow-full-nm">{item.description || 'Garment'}</h2>
                {dd.brand && <p className="ow-full-brand">{dd.brand}</p>}
                {item.flag && (
                  <div className={`ow-flag-banner ${item.flag}`}>
                    <Icon name={item.flag === 'missing' ? 'HelpCircle' : 'AlertTriangle'} size={15} />
                    <span><b>{FLAG_LABELS[item.flag] || 'Flagged'}</b>{item.flagNote ? ` — ${item.flagNote}` : ''}</span>
                  </div>
                )}
                <div className="ow-full-tabs" role="tablist">
                  <button type="button" className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>Details</button>
                  <button type="button" className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History{events.length ? ` (${events.length})` : ''}</button>
                </div>
              </div>

              <div className="ow-full-scroll">
                {tab === 'details' ? (
                  <>
                    {dd.description && <p className="ow-full-desc">{dd.description}</p>}
                    <dl className="ow-full-dl">
                      <div className="ow-dl-sec">Details</div>
                      <Row k="Type" v={item.garmentType} />
                      <Row k="Cut" v={dd.gender} />
                      <Row k="Size" v={dd.size} />
                      <Row k="Colour" v={item.colour} />
                      <Row k="Material" v={dd.material} />
                      <Row k="Condition" v={dd.condition} />
                      <Row k="Care" v={careText} />

                      {hasPurchase && <div className="ow-dl-sec">Purchase &amp; value</div>}
                      {showValue && item.garmentValue != null && <Row k="Value" v={money(item.garmentValue, item.garmentValueCurrency)} />}
                      <Row k="Style / SKU" v={dd.sku} />
                      <Row k="Monogram" v={dd.monogram} />
                      <Row k="Purchased" v={purchased} />

                      <div className="ow-dl-sec">On board</div>
                      <Row k="Belongs to" v={owner} />
                      <Row k="Location" v={locationLabel || 'Not placed'} />
                      <Row k="Season" v={dd.season} />
                      <Row k="Added" v={fmtDate(item.createdAt)} />
                      {item.notes && <Row k="Notes" v={item.notes} />}
                    </dl>
                  </>
                ) : (
                  events.length === 0 ? (
                    <p className="ow-hist-empty">No activity yet.</p>
                  ) : (
                    <ul className="ow-hist">
                      {[...events].reverse().map((e) => (
                        <li className="ow-hist-row" key={e.id}>
                          <span className="ow-hist-dot" />
                          <div>
                            <span className="ow-hist-act">{actionLabel(e.action)}</span>
                            <span className="ow-hist-meta">{[e.actorName, fmtWhen(e.at)].filter(Boolean).join(' · ')}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>

              <div className="ow-full-actions">
                <button type="button" className={`ow-btn ${stays ? 'onboard-on' : 'ghost'}`} onClick={toggleStays} disabled={staysBusy} title="Stays aboard permanently"><Icon name="Anchor" size={15} /> {stays ? 'Stays aboard' : 'Keep aboard'}</button>
                {item.status === LaundryStatus.STORED && <button type="button" className="ow-btn ghost" onClick={() => act('launder')}><Icon name="Waves" size={15} /> Launder</button>}
                <button type="button" className="ow-btn ghost" onClick={() => act('pack')}><Icon name="Package" size={15} /> Pack</button>
                <div className="ow-menu" ref={menuRef}>
                  <button type="button" className="ow-btn ghost ow-menu-btn" onClick={() => setMenu((o) => !o)} aria-label="More actions"><Icon name="MoreHorizontal" size={18} /></button>
                  {menu && (
                    <div className="ow-menu-pop">
                      <button type="button" onClick={() => { setMenu(false); act('move'); }}><Icon name="FolderInput" size={15} /> Move</button>
                      <button type="button" onClick={() => { setMenu(false); printLaundryLabels([item]); }}><Icon name="QrCode" size={15} /> QR tag</button>
                      <button type="button" onClick={() => { setMenu(false); setEdit(true); }}><Icon name="Pencil" size={15} /> Edit</button>
                      <button type="button" className="danger" onClick={() => { setMenu(false); act('archive'); }}><Icon name="Trash2" size={15} /> Archive</button>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="ow-full-scroll ow-edit">
                <div className="ow-sec">Essentials</div>
                <label className="ow-l">Item name</label>
                <input className="ow-input" value={draft.description} onChange={(e) => set('description', e.target.value)} />
                <div className="ow-row2">
                  <div><label className="ow-l">Brand</label><input className="ow-input" value={draft.brand} onChange={(e) => set('brand', e.target.value)} /></div>
                  <div><label className="ow-l">Type</label><OwSelect value={draft.garmentType} onChange={(v) => set('garmentType', v)} options={dashOpts(GARMENT_TYPES)} /></div>
                </div>
                <div className="ow-row2">
                  <div><label className="ow-l">Cut</label><OwSelect value={draft.gender} onChange={(v) => set('gender', v)} options={dashOpts(GENDERS)} /></div>
                  <div><label className="ow-l">Size</label><input className="ow-input" value={draft.size} onChange={(e) => set('size', e.target.value)} /></div>
                </div>
                <div className="ow-row2">
                  <div><label className="ow-l">Colour</label><input className="ow-input" value={draft.colour} onChange={(e) => set('colour', e.target.value)} /></div>
                  <div><label className="ow-l">Material / fabric</label><input className="ow-input" value={draft.material} onChange={(e) => set('material', e.target.value)} /></div>
                </div>
                <div className="ow-row2">
                  <div><label className="ow-l">Condition</label><OwSelect value={draft.condition} onChange={(v) => set('condition', v)} options={dashOpts(CONDITIONS)} /></div>
                  <div />
                </div>
                <label className="ow-l">Description</label>
                <textarea className="ow-textarea" rows={2} value={draft.longDesc} onChange={(e) => set('longDesc', e.target.value)} />

                <div className="ow-sec">Care &amp; value</div>
                <label className="ow-l">Care</label>
                <div className="ow-tags">{availableLaundryTags.map((t) => <button type="button" key={t} className={`ow-tag${draft.tags.includes(t) ? ' on' : ''}`} onClick={() => toggleTag(t)}>{formatLaundryTag(t)}</button>)}</div>
                <div className="ow-row2">
                  {showValue ? (
                    <div><label className="ow-l">Value</label><div className="ow-value"><div className="ow-cur"><OwSelect value={draft.garmentValueCurrency} onChange={(v) => set('garmentValueCurrency', v)} options={CURRENCIES} /></div><input className="ow-input" type="number" min="0" step="0.01" value={draft.garmentValue} onChange={(e) => set('garmentValue', e.target.value)} /></div></div>
                  ) : <div />}
                  <div><label className="ow-l">Season</label><OwSelect value={draft.season} onChange={(v) => set('season', v)} options={dashOpts(SEASONS)} /></div>
                </div>

                <div className="ow-sec">Purchase &amp; value</div>
                <div className="ow-row2">
                  <div><label className="ow-l">Style code / SKU</label><input className="ow-input" value={draft.sku} onChange={(e) => set('sku', e.target.value)} /></div>
                  <div><label className="ow-l">Monogram / initials</label><input className="ow-input" value={draft.monogram} onChange={(e) => set('monogram', e.target.value)} /></div>
                </div>
                <div className="ow-row2">
                  <div><label className="ow-l">Purchased at</label><input className="ow-input" value={draft.purchasedPlace} onChange={(e) => set('purchasedPlace', e.target.value)} /></div>
                  <div><label className="ow-l">Purchased on</label><input className="ow-input" type="date" value={draft.purchasedDate} onChange={(e) => set('purchasedDate', e.target.value)} /></div>
                </div>

                <div className="ow-sec">On board</div>
                <div className="ow-row2">
                  <div><label className="ow-l">Location</label><OwSelect value={draft.wardrobeId} onChange={(v) => set('wardrobeId', v)} options={wardrobes.map((w) => ({ value: w.id, label: w.name }))} /></div>
                  <div><label className="ow-l">Belongs to</label><OwSelect value={draft.guestId} onChange={(v) => set('guestId', v)} options={[{ value: '', label: 'Owner (unassigned)' }, ...guests.map((g) => ({ value: g.id, label: guestLabel(g) }))]} /></div>
                </div>
                <label className="ow-check-row">
                  <input type="checkbox" checked={draft.staysOnboard} onChange={(e) => set('staysOnboard', e.target.checked)} />
                  <span><b>Stays aboard</b> — belongs on board permanently; can still be packed anytime.</span>
                </label>
                <label className="ow-l">Flag</label>
                <FlagField flag={draft.flag} note={draft.flagNote} onFlag={(v) => set('flag', v)} onNote={(v) => set('flagNote', v)} />
                <label className="ow-l">Notes</label>
                <textarea className="ow-textarea" rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
              </div>
              <div className="ow-full-actions">
                <button type="button" className="ow-btn ghost" onClick={() => setEdit(false)}>Cancel</button>
                <button type="button" className="ow-btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GarmentFullView;

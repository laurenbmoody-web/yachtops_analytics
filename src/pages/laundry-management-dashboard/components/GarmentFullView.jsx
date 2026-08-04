import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { updateLaundryItem, LaundryStatus, availableLaundryTags, formatLaundryTag } from '../utils/laundryStorage';
import { money } from '../utils/laundryBilling';
import { printLaundryLabels } from '../utils/laundryLabels';
import { GARMENT_TYPES } from './AddGarmentModal';
import OwSelect from './OwSelect';
import './ownerWardrobe.css';

const inWash = (i) => i.status === LaundryStatus.IN_PROGRESS || i.status === LaundryStatus.READY_TO_DELIVER;
const CURRENCIES = ['EUR', 'GBP', 'USD'];
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

// One label/value line — renders nothing when the value is empty.
const Row = ({ k, v }) => ((v == null || v === '') ? null : (
  <div className="ow-dl-row"><dt>{k}</dt><dd>{v}</dd></div>
));

// Full-view of one garment: photo gallery, a readable attribute list, and the
// per-item actions (primary buttons + an overflow menu). Pack / move / launder /
// archive are delegated to the parent; edits save here.
const GarmentFullView = ({ item, wardrobes = [], showValue = true, caseName = null, onClose, onChanged, onAction }) => {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({
    description: item.description || '', garmentType: item.garmentType || '', colour: item.colour || '',
    garmentValue: item.garmentValue ?? '', garmentValueCurrency: item.garmentValueCurrency || 'EUR',
    tags: Array.isArray(item.tags) ? item.tags : [], wardrobeId: item.wardrobeId || '',
    staysOnboard: item.staysOnboard !== false,
  });
  const [busy, setBusy] = useState(false);
  const gallery = (Array.isArray(item.photos) && item.photos.length ? item.photos : (item.photo ? [item.photo] : [])).filter(Boolean);
  const [active, setActive] = useState(0);
  const st = item.caseId
    ? { label: `Away · in ${caseName || 'a case'}`, cls: 'away' }
    : inWash(item) ? { label: 'In laundry', cls: 'prog' } : { label: 'On board', cls: 'stored' };
  const photo = gallery[active] || gallery[0] || '';
  const home = wardrobes.find((w) => w.id === item.wardrobeId);
  const homeLabel = home ? [home.name, home.locationName].filter(Boolean).join(' · ') : '';
  const d = item.details || {};
  const purchased = [d.purchasedPlace, d.purchasedDate ? fmtDate(d.purchasedDate) : ''].filter(Boolean).join(' · ');
  const careText = (Array.isArray(item.tags) ? item.tags : []).map(formatLaundryTag).join(' · ');
  const hasProvenance = (showValue && item.garmentValue != null) || d.sku || d.monogram || purchased;

  const [stays, setStays] = useState(!!item.staysOnboard);
  const [staysBusy, setStaysBusy] = useState(false);
  const toggleStays = async () => {
    if (staysBusy) return;
    const next = !stays;
    setStays(next); setStaysBusy(true);
    await updateLaundryItem(item.id, { staysOnboard: next });
    setStaysBusy(false);
    window.showToast?.(next ? 'Kept on board — belongs here permanently' : 'No longer marked as staying on board', 'success');
  };

  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

  const toggleTag = (t) => setDraft((dd) => ({ ...dd, tags: dd.tags.includes(t) ? dd.tags.filter((x) => x !== t) : [...dd.tags, t] }));

  const save = async () => {
    setBusy(true);
    const updated = await updateLaundryItem(item.id, {
      description: draft.description.trim(), garmentType: draft.garmentType || null, colour: draft.colour.trim(),
      garmentValue: draft.garmentValue === '' ? null : Number(draft.garmentValue), garmentValueCurrency: draft.garmentValueCurrency,
      tags: draft.tags, wardrobeId: draft.wardrobeId || null, staysOnboard: draft.staysOnboard,
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
                {d.brand && <p className="ow-full-brand">{d.brand}</p>}
              </div>

              <div className="ow-full-scroll">
                {d.description && <p className="ow-full-desc">{d.description}</p>}

                <dl className="ow-full-dl">
                  <div className="ow-dl-sec">Details</div>
                  <Row k="Type" v={item.garmentType} />
                  <Row k="Cut" v={d.gender} />
                  <Row k="Size" v={d.size} />
                  <Row k="Colour" v={item.colour} />
                  <Row k="Material" v={d.material} />
                  <Row k="Condition" v={d.condition} />
                  <Row k="Care" v={careText} />

                  {hasProvenance && <div className="ow-dl-sec">Provenance</div>}
                  {showValue && item.garmentValue != null && <Row k="Value" v={money(item.garmentValue, item.garmentValueCurrency)} />}
                  <Row k="Style / SKU" v={d.sku} />
                  <Row k="Monogram" v={d.monogram} />
                  <Row k="Purchased" v={purchased} />

                  <div className="ow-dl-sec">On board</div>
                  <Row k="Home" v={homeLabel || 'Not placed'} />
                  <Row k="Season" v={d.season} />
                  <Row k="Stays aboard" v={stays ? 'Yes — kept on board' : null} />
                  <Row k="Added" v={fmtDate(item.createdAt)} />
                </dl>
              </div>

              <div className="ow-full-actions">
                <button type="button" className={`ow-btn ${stays ? 'onboard-on' : 'ghost'}`} onClick={toggleStays} disabled={staysBusy} title="Belongs on board permanently"><Icon name="Anchor" size={15} /> {stays ? 'On board' : 'Keep on board'}</button>
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
                <label className="ow-l">Name</label>
                <input className="ow-input" value={draft.description} onChange={(e) => setDraft((dd) => ({ ...dd, description: e.target.value }))} />
                <div className="ow-row2">
                  <div><label className="ow-l">Type</label><OwSelect value={draft.garmentType} onChange={(v) => setDraft((dd) => ({ ...dd, garmentType: v }))} options={[{ value: '', label: '—' }, ...GARMENT_TYPES.map((t) => ({ value: t, label: t }))]} /></div>
                  <div><label className="ow-l">Colour</label><input className="ow-input" value={draft.colour} onChange={(e) => setDraft((dd) => ({ ...dd, colour: e.target.value }))} /></div>
                </div>
                <div className="ow-row2">
                  {showValue ? (
                    <div><label className="ow-l">Value</label><div className="ow-value"><div className="ow-cur"><OwSelect value={draft.garmentValueCurrency} onChange={(v) => setDraft((dd) => ({ ...dd, garmentValueCurrency: v }))} options={CURRENCIES} /></div><input className="ow-input" type="number" min="0" step="0.01" value={draft.garmentValue} onChange={(e) => setDraft((dd) => ({ ...dd, garmentValue: e.target.value }))} /></div></div>
                  ) : <div />}
                  <div><label className="ow-l">Wardrobe</label><OwSelect value={draft.wardrobeId} onChange={(v) => setDraft((dd) => ({ ...dd, wardrobeId: v }))} options={wardrobes.map((w) => ({ value: w.id, label: w.name }))} /></div>
                </div>
                <label className="ow-l">Care</label>
                <div className="ow-tags">{availableLaundryTags.map((t) => <button type="button" key={t} className={`ow-tag${draft.tags.includes(t) ? ' on' : ''}`} onClick={() => toggleTag(t)}>{formatLaundryTag(t)}</button>)}</div>
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

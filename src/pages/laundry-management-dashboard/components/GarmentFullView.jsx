import React, { useState } from 'react';
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

// Full-view of one garment: big image, every attribute, inline edit, and the
// per-item actions. Pack / move / launder / archive are delegated to the parent
// (it owns the target pickers); edits save here.
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
  const homeLabel = home ? [home.name, home.locationName].filter(Boolean).join(' · ') : '—';
  const d = item.details || {};
  const purchased = [d.purchasedPlace, d.purchasedDate ? fmtDate(d.purchasedDate) : ''].filter(Boolean).join(' · ');

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

  const toggleTag = (t) => setDraft((d) => ({ ...d, tags: d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t] }));

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
          {photo ? <img src={photo} alt={item.description || 'Garment'} /> : <span className="ow-full-ph"><Icon name="Shirt" size={54} /></span>}
          {gallery.length > 1 && (
            <div className="ow-full-thumbs">
              {gallery.map((src, i) => (
                <button type="button" key={i} className={`ow-full-thumb${i === active ? ' on' : ''}`} onClick={() => setActive(i)}><img src={src} alt="" /></button>
              ))}
            </div>
          )}
        </div>

        <div className="ow-full-info">
          <span className={`ow-status ${st.cls}`}>{st.label}</span>

          {!edit ? (
            <>
              <h2 className="ow-full-nm">{item.description || 'Garment'}</h2>
              {d.brand && <p className="ow-full-brand">{d.brand}</p>}
              <div className="ow-full-meta">
                {item.garmentType && <span className="ow-chip">{item.garmentType}</span>}
                {d.gender && <span className="ow-chip subtle">{d.gender}</span>}
                {d.size && <span className="ow-chip subtle">Size {d.size}</span>}
                {item.colour && <span className="ow-chip subtle">{item.colour}</span>}
                {d.condition && <span className="ow-chip subtle">{d.condition}</span>}
                {showValue && item.garmentValue != null && <span className="ow-chip subtle">{money(item.garmentValue, item.garmentValueCurrency)}</span>}
                {stays && <span className="ow-chip stays"><Icon name="Anchor" size={11} /> Stays aboard</span>}
              </div>
              {d.description && <p className="ow-full-desc">{d.description}</p>}
              {Array.isArray(item.tags) && item.tags.length > 0 && (
                <div className="ow-full-tags">{item.tags.map((t, i) => <span className="ow-care" key={i}>{formatLaundryTag(t)}</span>)}</div>
              )}
              <dl className="ow-full-dl">
                <div><dt>Home</dt><dd>{homeLabel}</dd></div>
                {d.material && <div><dt>Material</dt><dd>{d.material}</dd></div>}
                {d.season && <div><dt>Season</dt><dd>{d.season}</dd></div>}
                {d.sku && <div><dt>Style / SKU</dt><dd>{d.sku}</dd></div>}
                {d.monogram && <div><dt>Monogram</dt><dd>{d.monogram}</dd></div>}
                {purchased && <div><dt>Purchased</dt><dd>{purchased}</dd></div>}
                <div><dt>Added</dt><dd>{fmtDate(item.createdAt)}</dd></div>
              </dl>
            </>
          ) : (
            <div className="ow-edit">
              <label className="ow-l">Name</label>
              <input className="ow-input" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
              <div className="ow-row2">
                <div><label className="ow-l">Type</label><OwSelect value={draft.garmentType} onChange={(v) => setDraft((d) => ({ ...d, garmentType: v }))} options={[{ value: '', label: '—' }, ...GARMENT_TYPES.map((t) => ({ value: t, label: t }))]} /></div>
                <div><label className="ow-l">Colour</label><input className="ow-input" value={draft.colour} onChange={(e) => setDraft((d) => ({ ...d, colour: e.target.value }))} /></div>
              </div>
              <div className="ow-row2">
                {showValue ? (
                  <div><label className="ow-l">Value</label><div className="ow-value"><div className="ow-cur"><OwSelect value={draft.garmentValueCurrency} onChange={(v) => setDraft((d) => ({ ...d, garmentValueCurrency: v }))} options={CURRENCIES} /></div><input className="ow-input" type="number" min="0" step="0.01" value={draft.garmentValue} onChange={(e) => setDraft((d) => ({ ...d, garmentValue: e.target.value }))} /></div></div>
                ) : <div />}
                <div><label className="ow-l">Wardrobe</label><OwSelect value={draft.wardrobeId} onChange={(v) => setDraft((d) => ({ ...d, wardrobeId: v }))} options={wardrobes.map((w) => ({ value: w.id, label: w.name }))} /></div>
              </div>
              <label className="ow-check-row">
                <input type="checkbox" checked={draft.staysOnboard} onChange={(e) => setDraft((d) => ({ ...d, staysOnboard: e.target.checked }))} />
                <span><b>Usually stays on board</b> — a hint for crew; can still be packed anytime.</span>
              </label>
              <label className="ow-l">Care</label>
              <div className="ow-tags">{availableLaundryTags.map((t) => <button type="button" key={t} className={`ow-tag${draft.tags.includes(t) ? ' on' : ''}`} onClick={() => toggleTag(t)}>{formatLaundryTag(t)}</button>)}</div>
            </div>
          )}

          <div className="ow-full-actions">
            {edit ? (
              <>
                <button type="button" className="ow-btn ghost" onClick={() => setEdit(false)}>Cancel</button>
                <button type="button" className="ow-btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
              </>
            ) : (
              <>
                <button type="button" className={`ow-btn ${stays ? 'onboard-on' : 'ghost'}`} onClick={toggleStays} disabled={staysBusy} title="Belongs on board permanently"><Icon name="Anchor" size={15} /> {stays ? 'On board' : 'Keep on board'}</button>
                {item.status === LaundryStatus.STORED && <button type="button" className="ow-btn ghost" onClick={() => act('launder')}><Icon name="Waves" size={15} /> Launder</button>}
                <button type="button" className="ow-btn ghost" onClick={() => act('pack')}><Icon name="Package" size={15} /> Pack</button>
                <button type="button" className="ow-btn ghost" onClick={() => act('move')}><Icon name="FolderInput" size={15} /> Move</button>
                <button type="button" className="ow-btn ghost" onClick={() => printLaundryLabels([item])}><Icon name="QrCode" size={15} /> QR tag</button>
                <button type="button" className="ow-btn ghost" onClick={() => setEdit(true)}><Icon name="Pencil" size={15} /> Edit</button>
                <button type="button" className="ow-btn danger" onClick={() => act('archive')}><Icon name="Trash2" size={15} /> Archive</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GarmentFullView;

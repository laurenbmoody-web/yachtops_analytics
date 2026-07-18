import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { updateLaundryItem, LaundryStatus, availableLaundryTags, formatLaundryTag } from '../utils/laundryStorage';
import { money } from '../utils/laundryBilling';
import { GARMENT_TYPES } from './AddGarmentModal';
import './ownerWardrobe.css';

const STATUS = {
  Stored: { label: 'In wardrobe', cls: 'stored' },
  InProgress: { label: 'In laundry', cls: 'prog' },
  ReadyToDeliver: { label: 'Ready', cls: 'ready' },
  Delivered: { label: 'Delivered', cls: 'done' },
};
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
  const st = STATUS[item.status] || { label: item.status, cls: 'stored' };
  const photo = (Array.isArray(item.photos) && item.photos[0]) || item.photo || '';
  const home = wardrobes.find((w) => w.id === item.wardrobeId);
  const homeLabel = home ? [home.name, home.locationName].filter(Boolean).join(' · ') : '—';

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
        </div>

        <div className="ow-full-info">
          <span className={`ow-status ${st.cls}`}>{st.label}{caseName ? ` · in ${caseName}` : ''}</span>

          {!edit ? (
            <>
              <h2 className="ow-full-nm">{item.description || 'Garment'}</h2>
              <div className="ow-full-meta">
                {item.garmentType && <span className="ow-chip">{item.garmentType}</span>}
                {item.colour && <span className="ow-chip subtle">{item.colour}</span>}
                {showValue && item.garmentValue != null && <span className="ow-chip subtle">{money(item.garmentValue, item.garmentValueCurrency)}</span>}
                {item.staysOnboard && <span className="ow-chip stays"><Icon name="Anchor" size={11} /> Stays aboard</span>}
              </div>
              {Array.isArray(item.tags) && item.tags.length > 0 && (
                <div className="ow-full-tags">{item.tags.map((t, i) => <span className="ow-care" key={i}>{formatLaundryTag(t)}</span>)}</div>
              )}
              <dl className="ow-full-dl">
                <div><dt>Home</dt><dd>{homeLabel}</dd></div>
                <div><dt>Added</dt><dd>{fmtDate(item.createdAt)}</dd></div>
              </dl>
            </>
          ) : (
            <div className="ow-edit">
              <label className="ow-l">Name</label>
              <input className="ow-input" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
              <div className="ow-row2">
                <div><label className="ow-l">Type</label><div className="ow-select"><select value={draft.garmentType} onChange={(e) => setDraft((d) => ({ ...d, garmentType: e.target.value }))}><option value="">—</option>{GARMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div></div>
                <div><label className="ow-l">Colour</label><input className="ow-input" value={draft.colour} onChange={(e) => setDraft((d) => ({ ...d, colour: e.target.value }))} /></div>
              </div>
              <div className="ow-row2">
                {showValue ? (
                  <div><label className="ow-l">Value</label><div className="ow-value"><div className="ow-select ow-cur"><select value={draft.garmentValueCurrency} onChange={(e) => setDraft((d) => ({ ...d, garmentValueCurrency: e.target.value }))}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div><input className="ow-input" type="number" min="0" step="0.01" value={draft.garmentValue} onChange={(e) => setDraft((d) => ({ ...d, garmentValue: e.target.value }))} /></div></div>
                ) : <div />}
                <div><label className="ow-l">Wardrobe</label><div className="ow-select"><select value={draft.wardrobeId} onChange={(e) => setDraft((d) => ({ ...d, wardrobeId: e.target.value }))}>{wardrobes.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div></div>
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
                {item.status === LaundryStatus.STORED && <button type="button" className="ow-btn ghost" onClick={() => act('launder')}><Icon name="Waves" size={15} /> Launder</button>}
                <button type="button" className="ow-btn ghost" onClick={() => act('pack')}><Icon name="Package" size={15} /> Pack</button>
                <button type="button" className="ow-btn ghost" onClick={() => act('move')}><Icon name="FolderInput" size={15} /> Move</button>
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

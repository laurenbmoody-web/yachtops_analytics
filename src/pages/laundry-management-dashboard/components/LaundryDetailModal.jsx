import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { showToast } from '../../../utils/toast';
import {
  LaundryStatus, LaundryPriority, availableLaundryTags, formatLaundryTag,
  updateLaundryItem, updateLaundryStatus,
} from '../utils/laundryStorage';
import '../laundry.css';

const STAT = {
  [LaundryStatus?.IN_PROGRESS]: { cls: 'prog', label: 'In progress' },
  [LaundryStatus?.READY_TO_DELIVER]: { cls: 'ready', label: 'Ready to deliver' },
  [LaundryStatus?.DELIVERED]: { cls: 'deliv', label: 'Delivered' },
};
const ownerKind = (t) => { const k = (t || 'unknown').toLowerCase(); return k === 'guest' ? 'guest' : k === 'crew' ? 'crew' : 'unknown'; };
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const photosOf = (it) => (Array.isArray(it?.photos) && it.photos.length ? it.photos : (it?.photo ? [it.photo] : []));

const readAsDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.onerror = () => rej(new Error('read')); r.readAsDataURL(file); });
const compress = (dataUrl, maxW = 800, q = 0.7) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); let { width, height } = img;
    if (width > maxW) { height = (height * maxW) / width; width = maxW; }
    c.width = width; c.height = height; c.getContext('2d').drawImage(img, 0, 0, width, height);
    res(c.toDataURL('image/jpeg', q));
  };
  img.onerror = () => rej(new Error('img')); img.src = dataUrl;
});

const LaundryDetailModal = ({ item: initial, onClose, onUpdated }) => {
  const [item, setItem] = useState(initial);
  const [mode, setMode] = useState('view');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const [form, setForm] = useState(null);

  useEffect(() => { setItem(initial); setMode('view'); }, [initial]);

  const kind = ownerKind(item?.ownerType);
  const st = STAT[item?.status] || STAT[LaundryStatus?.READY_TO_DELIVER];
  const urgent = item?.priority === LaundryPriority?.URGENT;
  const photos = photosOf(item);

  const startEdit = () => {
    setForm({
      description: item?.description || '',
      priority: item?.priority || LaundryPriority?.NORMAL,
      area: item?.area || '',
      laundryNumber: item?.laundryNumber || '',
      colour: item?.colour || '',
      tags: [...(item?.tags || [])],
      notes: item?.notes || '',
      photos: [...photos],
    });
    setMode('edit');
  };
  const setField = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const toggleTag = (t) => setForm((p) => ({ ...p, tags: p.tags.includes(t) ? p.tags.filter((x) => x !== t) : [...p.tags, t] }));

  const addPhotos = async (e) => {
    const files = Array.from(e?.target?.files || []);
    if (fileRef.current) fileRef.current.value = '';
    for (const f of files) {
      if (!f.type?.startsWith('image/')) continue;
      if (f.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB', 'error'); continue; }
      try { const url = await compress(await readAsDataUrl(f)); setForm((p) => ({ ...p, photos: [...p.photos, url] })); }
      catch { showToast('Could not add that photo', 'error'); }
    }
  };
  const removePhoto = (idx) => setForm((p) => ({ ...p, photos: p.photos.filter((_, i) => i !== idx) }));

  const advance = async (newStatus) => {
    const updated = await updateLaundryStatus(item.id, newStatus);
    if (updated) setItem(updated);
    onUpdated?.();
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateLaundryItem(item.id, {
        description: form.description,
        priority: form.priority,
        area: form.area,
        laundryNumber: form.laundryNumber,
        colour: form.colour,
        tags: form.tags,
        notes: form.notes,
        photos: form.photos,
        photo: form.photos[0] || '',
      });
      if (updated) setItem(updated);
      onUpdated?.();
      setMode('view');
    } finally { setSaving(false); }
  };

  const knownTags = [...new Set([...availableLaundryTags, ...((mode === 'edit' ? form?.tags : item?.tags) || [])])];

  return (
    <ModalShell onClose={onClose} panelClassName="alm-panel">
      <div className="alm-head" style={{ textAlign: 'left', background: '#FFFFFF' }}>
        <div>
          <div className="alm-eyebrow">Housekeeping · <span className={`lc-stat ${st.cls}`} style={{ verticalAlign: 'middle' }}>{st.label}</span></div>
          <h2 className="alm-title" style={{ textTransform: 'none', fontSize: 26, letterSpacing: 0 }}>{item?.description || 'Laundry item'}</h2>
        </div>
        <button className="alm-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
      </div>

      <div className="alm-body">
        {mode === 'view' ? (
          <>
            {photos.length > 0 && (
              <div className="ldm-photos">
                {photos.map((src, i) => <span className="ldm-photo" key={i}><img src={src} alt={`Photo ${i + 1}`} /></span>)}
              </div>
            )}

            <div className="ldm-meta">
              <div>
                <span className="ldm-k">Owner</span>
                <span className="ldm-v ldm-owner"><span className={`lr-av ${kind}`}>{kind === 'unknown' ? '?' : initials(item?.ownerName)}</span>{kind === 'unknown' ? 'Unknown' : (item?.ownerName || '—')} <span style={{ color: '#AEB4C2', fontSize: 12 }}>· {kind[0].toUpperCase() + kind.slice(1)}</span></span>
              </div>
              <div>
                <span className="ldm-k">{kind === 'unknown' ? 'Found' : 'Cabin'}</span>
                <span className="ldm-v">{item?.area || '—'}</span>
              </div>
              {(item?.laundryNumber || item?.colour) && (
                <div>
                  <span className="ldm-k">Laundry no. &amp; colour</span>
                  <span className="ldm-v">{[item?.laundryNumber, item?.colour].filter(Boolean).join(' · ') || '—'}</span>
                </div>
              )}
              <div>
                <span className="ldm-k">Priority</span>
                <span className="ldm-v">{urgent ? <span style={{ color: '#C24632', fontWeight: 700 }}>Urgent</span> : 'Normal'}</span>
              </div>
              <div>
                <span className="ldm-k">Added</span>
                <span className="ldm-v">{fmtDateTime(item?.createdAt) || '—'}</span>
              </div>
              {item?.deliveredAt && (
                <div>
                  <span className="ldm-k">Delivered</span>
                  <span className="ldm-v">{fmtDateTime(item?.deliveredAt)}</span>
                </div>
              )}
            </div>

            {item?.tags?.length > 0 && (
              <div className="alm-section">
                <label className="alm-label">Care</label>
                <div className="alm-tags">{item.tags.map((t, i) => <span key={i} className="alm-tag on" style={{ cursor: 'default' }}>{formatLaundryTag(t)}</span>)}</div>
              </div>
            )}

            {item?.notes && (
              <div className="alm-section" style={{ marginBottom: 0 }}>
                <label className="alm-label">Notes</label>
                <div className="ldm-notes">{item.notes}</div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="alm-section">
              <label className="alm-label">Description <span className="alm-req">required</span></label>
              <textarea className="alm-field" rows={3} value={form.description} onChange={(e) => setField('description', e.target.value)} />
            </div>

            <div className="alm-section">
              <div className="alm-ownerbar">
                <span className="alm-label" style={{ margin: 0 }}>Priority</span>
                <button type="button" className={`alm-urgent-toggle${form.priority === LaundryPriority?.URGENT ? ' on' : ''}`} onClick={() => setField('priority', form.priority === LaundryPriority?.URGENT ? LaundryPriority?.NORMAL : LaundryPriority?.URGENT)}>
                  <Icon name="Zap" size={13} /> Urgent <span className={`alm-switch sm${form.priority === LaundryPriority?.URGENT ? ' on' : ''}`} />
                </button>
              </div>
            </div>

            <div className="alm-grid2">
              <div>
                <label className="alm-label">{kind === 'unknown' ? 'Found' : 'Cabin'} <span className="alm-opt">optional</span></label>
                <input className="alm-field" value={form.area} onChange={(e) => setField('area', e.target.value)} />
              </div>
              <div>
                <label className="alm-label">Laundry no. &amp; colour <span className="alm-opt">optional</span></label>
                <input className="alm-field" value={form.laundryNumber} onChange={(e) => setField('laundryNumber', e.target.value)} placeholder="e.g. 14 · Navy" />
              </div>
            </div>

            {kind === 'unknown' && (
              <div className="alm-section">
                <label className="alm-label">Colour / item</label>
                <input className="alm-field" value={form.colour} onChange={(e) => setField('colour', e.target.value)} />
              </div>
            )}

            <div className="alm-section">
              <label className="alm-label">Care</label>
              <div className="alm-tags">
                {knownTags.map((t) => <button key={t} type="button" className={`alm-tag${form.tags.includes(t) ? ' on' : ''}`} onClick={() => toggleTag(t)}>{formatLaundryTag(t)}</button>)}
              </div>
            </div>

            <div className="alm-section">
              <label className="alm-label">Notes <span className="alm-opt">optional</span></label>
              <textarea className="alm-field" rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
            </div>

            <div className="alm-section" style={{ marginBottom: 0 }}>
              <label className="alm-label">Photos <span className="alm-opt">optional</span></label>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple onChange={addPhotos} className="hidden" />
              <div className="alm-photos">
                {form.photos.map((src, idx) => (
                  <div className="alm-thumb" key={idx}>
                    <img src={src} alt={`Photo ${idx + 1}`} />
                    <button type="button" className="alm-thumb-x" onClick={() => removePhoto(idx)} aria-label="Remove photo"><Icon name="X" size={12} /></button>
                  </div>
                ))}
                <button type="button" className="alm-add" onClick={() => fileRef.current?.click()}>
                  <Icon name="Camera" size={18} /> {form.photos.length ? 'More' : 'Photo'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="alm-foot" style={{ justifyContent: 'space-between' }}>
        {mode === 'view' ? (
          <>
            <button type="button" className="alm-linkbtn" onClick={startEdit}><Icon name="Pencil" size={15} /> Edit</button>
            <div style={{ display: 'flex', gap: 10 }}>
              {item?.status === LaundryStatus?.IN_PROGRESS && (
                <button type="button" className="alm-btn primary" onClick={() => advance(LaundryStatus?.READY_TO_DELIVER)}><Icon name="Check" size={15} /> Mark ready</button>
              )}
              {item?.status === LaundryStatus?.READY_TO_DELIVER && (
                <button type="button" className="alm-btn primary" onClick={() => advance(LaundryStatus?.DELIVERED)}><Icon name="ArrowRight" size={15} /> Deliver</button>
              )}
              {item?.status === LaundryStatus?.DELIVERED && (
                <button type="button" className="alm-btn outline accent" onClick={() => advance(LaundryStatus?.READY_TO_DELIVER)}><Icon name="Undo2" size={15} /> Reopen</button>
              )}
            </div>
          </>
        ) : (
          <>
            <button type="button" className="alm-linkbtn" onClick={() => setMode('view')}>Cancel</button>
            <button type="button" className="alm-btn primary" onClick={save} disabled={saving || !form.description.trim()}>{saving ? 'Saving…' : 'Save changes'}</button>
          </>
        )}
      </div>
    </ModalShell>
  );
};

export default LaundryDetailModal;

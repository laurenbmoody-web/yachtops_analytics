import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { LaundryStatus, LaundryPriority, formatLaundryTag, updateLaundryStatus } from '../utils/laundryStorage';
import '../laundry.css';

const STAT = {
  [LaundryStatus?.IN_PROGRESS]: { cls: 'prog', label: 'In progress' },
  [LaundryStatus?.READY_TO_DELIVER]: { cls: 'ready', label: 'Ready to deliver' },
  [LaundryStatus?.DELIVERED]: { cls: 'deliv', label: 'Delivered' },
};
const STATUS_C = { prog: '#B7791F', ready: '#2F6E8F', deliv: '#2F7D5A' };
const STEP_IDX = { [LaundryStatus?.IN_PROGRESS]: 1, [LaundryStatus?.READY_TO_DELIVER]: 2, [LaundryStatus?.DELIVERED]: 3 };
const ownerKind = (t) => { const k = (t || 'unknown').toLowerCase(); return k === 'guest' ? 'guest' : k === 'crew' ? 'crew' : 'unknown'; };
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const fmtClock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const photosOf = (it) => (Array.isArray(it?.photos) && it.photos.length ? it.photos : (it?.photo ? [it.photo] : []));

const LaundryDetailModal = ({ item: initial, onClose, onUpdated, onEdit }) => {
  const [item, setItem] = useState(initial);
  useEffect(() => { setItem(initial); }, [initial]);

  const kind = ownerKind(item?.ownerType);
  const st = STAT[item?.status] || STAT[LaundryStatus?.READY_TO_DELIVER];
  const urgent = item?.priority === LaundryPriority?.URGENT;
  const photos = photosOf(item);
  const idx = STEP_IDX[item?.status] || 2;
  const stepC = STATUS_C[st.cls] || '#2F6E8F';
  const avatarUrl = item?.avatarUrl;

  const steps = [
    { lbl: 'In progress', t: fmtClock(item?.createdAt) },
    { lbl: 'Ready', t: '' },
    { lbl: 'Delivered', t: fmtClock(item?.deliveredAt) },
  ];

  const advance = async (newStatus) => {
    const updated = await updateLaundryStatus(item.id, newStatus);
    if (updated) setItem({ ...updated, avatarUrl });
    onUpdated?.();
  };

  return (
    <ModalShell onClose={onClose} panelClassName="alm-panel">
      <div className="ldm-hero">
        {photos[0]
          ? <img src={photos[0]} alt={item?.description || 'Laundry item'} />
          : <span className="ldm-hero-ph"><Icon name="Shirt" size={64} /></span>}
        <div className="ldm-scrim" />
        <div className="ldm-hero-top">
          <span className={`ldm-hpill ${st.cls}`}><span className="d" />{st.label}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {urgent && <span className="ldm-hflag"><Icon name="Zap" size={12} /> Urgent</span>}
            <button className="ldm-hx" onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>
          </div>
        </div>
        <div className="ldm-hero-btm">
          <div className="ldm-htitle">{item?.description || 'Laundry item'}</div>
          <div className="ldm-howner">
            <span className={`lr-av ${kind}`}>{avatarUrl ? <img src={avatarUrl} alt="" /> : (kind === 'unknown' ? '?' : initials(item?.ownerName))}</span>
            {kind === 'unknown' ? 'Unknown owner' : (item?.ownerName || '—')}
            <span style={{ opacity: 0.7 }}>· {kind[0].toUpperCase() + kind.slice(1)}</span>
            {item?.area && <span style={{ opacity: 0.7 }}>· {item.area}</span>}
          </div>
        </div>
      </div>

      <div className="alm-body">
        <div className="ldm-track" style={{ '--c': stepC }}>
          {steps.map((s, i) => (
            <div key={s.lbl} className={`ldm-node${i + 1 <= idx ? ' fill' : ''}`}>
              <span className="ldm-dot" />
              <span className="ldm-nlbl">{s.lbl}</span>
              <span className="ldm-nt">{s.t}</span>
            </div>
          ))}
        </div>

        <div className="ldm-meta">
          <div>
            <span className="ldm-k">{kind === 'unknown' ? 'Found at' : 'Cabin'}</span>
            <span className="ldm-v">{item?.area || '—'}</span>
          </div>
          <div>
            <span className="ldm-k">Laundry no. &amp; colour</span>
            <span className="ldm-v">{[item?.laundryNumber, item?.colour].filter(Boolean).join(' · ') || '—'}</span>
          </div>
          <div>
            <span className="ldm-k">Added</span>
            <span className="ldm-v">{fmtDateTime(item?.createdAt) || '—'}</span>
          </div>
          <div>
            <span className="ldm-k">Delivered</span>
            <span className="ldm-v">{item?.deliveredAt ? fmtDateTime(item.deliveredAt) : '—'}</span>
          </div>
        </div>

        {item?.tags?.length > 0 && (
          <div className="alm-section">
            <label className="alm-label">Care</label>
            <div className="alm-tags">{item.tags.map((t, i) => <span key={i} className="alm-tag on" style={{ cursor: 'default' }}>{formatLaundryTag(t)}</span>)}</div>
          </div>
        )}

        {item?.notes && (
          <div className="alm-section">
            <label className="alm-label">Notes</label>
            <div className="ldm-notes">{item.notes}</div>
          </div>
        )}

        {photos.length > 1 && (
          <div className="alm-section" style={{ marginBottom: 0 }}>
            <label className="alm-label">Photos <span className="alm-opt">{photos.length}</span></label>
            <div className="ldm-strip">{photos.map((src, i) => <img key={i} src={src} alt={`Photo ${i + 1}`} />)}</div>
          </div>
        )}
      </div>

      <div className="alm-foot" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="alm-linkbtn" onClick={() => onEdit?.(item)}><Icon name="Pencil" size={15} /> Edit</button>
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
      </div>
    </ModalShell>
  );
};

export default LaundryDetailModal;

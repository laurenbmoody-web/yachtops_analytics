import React, { useEffect, useState } from 'react';

import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { LaundryStatus, LaundryPriority, formatLaundryTag, updateLaundryStatus, getLaundryEvents } from '../utils/laundryStorage';
import '../laundry.css';

const EVENT_LABEL = { created: 'Added', ready: 'Marked ready', delivered: 'Delivered', reopened: 'Reopened', edited: 'Edited', updated: 'Updated' };
const EVENT_DOT = { created: '#B7791F', ready: '#2F6E8F', delivered: '#2F7D5A', reopened: '#8B8478', edited: '#8B8478', updated: '#8B8478' };
const fmtEventTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

const STAT = {
  [LaundryStatus?.IN_PROGRESS]: { cls: 'prog', label: 'In progress' },
  [LaundryStatus?.READY_TO_DELIVER]: { cls: 'ready', label: 'Ready to deliver' },
  [LaundryStatus?.DELIVERED]: { cls: 'deliv', label: 'Delivered' },
};
const ownerKind = (t) => { const k = (t || 'unknown').toLowerCase(); return k === 'guest' ? 'guest' : k === 'crew' ? 'crew' : 'unknown'; };
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const photosOf = (it) => (Array.isArray(it?.photos) && it.photos.length ? it.photos : (it?.photo ? [it.photo] : []));

const LaundryDetailModal = ({ item: initial, onClose, onUpdated, onEdit }) => {
  const [item, setItem] = useState(initial);
  const [events, setEvents] = useState([]);
  useEffect(() => { setItem(initial); }, [initial]);

  const loadEvents = React.useCallback(() => {
    if (!initial?.id) return;
    getLaundryEvents(initial.id).then(setEvents).catch(() => {});
  }, [initial?.id]);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  const kind = ownerKind(item?.ownerType);
  const st = STAT[item?.status] || STAT[LaundryStatus?.READY_TO_DELIVER];
  const urgent = item?.priority === LaundryPriority?.URGENT;
  const photos = photosOf(item);
  const avatarUrl = item?.avatarUrl;

  const advance = async (newStatus) => {
    const updated = await updateLaundryStatus(item.id, newStatus);
    if (updated) setItem({ ...updated, avatarUrl });
    loadEvents();
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
          </div>
        </div>
      </div>

      <div className="alm-body">
        {/* facts — the quick where/what; the story lives in the timeline below */}
        <div className="ldm-facts">
          {item?.area && <span className="ldm-chip"><Icon name="MapPin" size={12} />{kind === 'unknown' ? 'Found: ' : ''}{item.area}</span>}
          {(item?.laundryNumber || item?.colour) && <span className="ldm-chip"><Icon name="Hash" size={12} />{[item?.laundryNumber, item?.colour].filter(Boolean).join(' · ')}</span>}
          {(item?.tags || []).map((t, i) => <span key={i} className="ldm-care">{formatLaundryTag(t)}</span>)}
          {!item?.area && !item?.laundryNumber && !item?.colour && !(item?.tags || []).length && <span className="ldm-chip" style={{ color: '#AEB4C2' }}>No further details</span>}
        </div>

        {item?.notes && (
          <div className="alm-section">
            <label className="alm-label">Notes</label>
            <div className="ldm-notes">{item.notes}</div>
          </div>
        )}

        {photos.length > 1 && (
          <div className="alm-section">
            <label className="alm-label">Photos <span className="alm-opt">{photos.length}</span></label>
            <div className="ldm-strip">{photos.map((src, i) => <img key={i} src={src} alt={`Photo ${i + 1}`} />)}</div>
          </div>
        )}

        {/* activity timeline — the focus of this view */}
        <div className="alm-section" style={{ marginBottom: 0 }}>
          <label className="alm-label">Activity</label>
          {events.length === 0 ? (
            <div className="ldm-log-empty">No activity recorded yet.</div>
          ) : (
            <ul className="ldm-tl">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="td" style={{ background: EVENT_DOT[e.action] || '#8B8478' }} />
                  <div className="ta">{EVENT_LABEL[e.action] || e.action}</div>
                  <div className="tm">{e.actorName ? `${e.actorName} · ` : ''}{fmtEventTime(e.at)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
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

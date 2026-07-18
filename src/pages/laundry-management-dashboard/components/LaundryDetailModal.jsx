import React, { useEffect, useState } from 'react';

import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { LaundryStatus, LaundryPriority, formatLaundryTag, updateLaundryStatus, updateLaundryItem, getLaundryEvents, getLaundryBilling } from '../utils/laundryStorage';
import { isLaundryOffline, enqueueOfflineStatus } from '../utils/laundryOfflineQueue';
import { money, suggestCharge, CUR_SYM } from '../utils/laundryBilling';
import '../laundry.css';

const EVENT_LABEL = { created: 'Added', ready: 'Marked ready', delivered: 'Delivered', reopened: 'Reopened', edited: 'Edited', updated: 'Updated' };
const EVENT_DOT = { created: '#B7791F', ready: '#2F6E8F', delivered: '#2F7D5A', reopened: '#8B8478', edited: '#8B8478', updated: '#8B8478' };
const fmtEventTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

const STAT = {
  [LaundryStatus?.IN_PROGRESS]: { cls: 'prog', label: 'In progress' },
  [LaundryStatus?.READY_TO_DELIVER]: { cls: 'ready', label: 'Ready to deliver' },
  [LaundryStatus?.DELIVERED]: { cls: 'deliv', label: 'Delivered' },
};
const ownerKind = (t) => { const k = (t || 'unknown').toLowerCase(); return k === 'guest' ? 'guest' : k === 'crew' ? 'crew' : k === 'other' ? 'other' : 'unknown'; };
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const photosOf = (it) => (Array.isArray(it?.photos) && it.photos.length ? it.photos : (it?.photo ? [it.photo] : []));

const LaundryDetailModal = ({ item: initial, onClose, onUpdated, onEdit }) => {
  const [item, setItem] = useState(initial);
  const [events, setEvents] = useState([]);
  const [flagNoteDraft, setFlagNoteDraft] = useState(initial?.flagNote || '');
  const [shoreOpen, setShoreOpen] = useState(false);
  const [vendorDraft, setVendorDraft] = useState(initial?.vendor || '');
  const [backDraft, setBackDraft] = useState(initial?.expectedBack || '');
  const [billing, setBilling] = useState(null);
  const [chargeDraft, setChargeDraft] = useState(initial?.charge ?? '');
  useEffect(() => { setItem(initial); }, [initial]);
  useEffect(() => { setFlagNoteDraft(initial?.flagNote || ''); setVendorDraft(initial?.vendor || ''); setBackDraft(initial?.expectedBack || ''); setChargeDraft(initial?.charge ?? ''); setShoreOpen(false); }, [initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { getLaundryBilling().then(setBilling).catch(() => {}); }, []);

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
    const applyLocal = () => setItem({ ...item, status: newStatus, ...(newStatus === LaundryStatus?.DELIVERED ? { deliveredAt: new Date().toISOString() } : {}) });
    if (isLaundryOffline()) { await enqueueOfflineStatus(item.id, newStatus); applyLocal(); onUpdated?.(); return; }
    try {
      const updated = await updateLaundryStatus(item.id, newStatus);
      // keep the already-signed photo URLs + avatar (status change doesn't touch them)
      if (updated) setItem({ ...updated, photos: item.photos, photo: item.photo, avatarUrl });
      loadEvents();
      onUpdated?.();
    } catch (e) {
      if (e?.code === 'OFFLINE') { await enqueueOfflineStatus(item.id, newStatus); applyLocal(); onUpdated?.(); }
      else console.error('[laundry] detail advance failed', e);
    }
  };

  // apply an edit (flag / handling) and keep the signed photos + avatar
  const patch = async (fields) => {
    const updated = await updateLaundryItem(item.id, fields);
    if (updated) setItem({ ...updated, photos: item.photos, photo: item.photo, avatarUrl });
    loadEvents();
    onUpdated?.();
  };
  const toggleFlag = (f) => patch(item?.flag === f ? { flag: null, flagNote: '' } : { flag: f });
  const sendAshore = () => { patch({ serviceLocation: 'shore', vendor: vendorDraft.trim(), expectedBack: backDraft || null, sentAt: new Date().toISOString() }); setShoreOpen(false); };
  const markOnboard = () => patch({ serviceLocation: 'onboard', sentAt: null, expectedBack: null });
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

  return (
    <ModalShell onClose={onClose} panelClassName="alm-panel">
      <div className="ldm-hero">
        {photos[0]
          ? <img src={photos[0]} alt={item?.description || 'Laundry item'} decoding="async" />
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
            <span className={`lr-av ${kind}`}>{avatarUrl ? <img src={avatarUrl} alt="" loading="lazy" decoding="async" /> : (kind === 'unknown' ? '?' : initials(item?.ownerName))}</span>
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

        {/* condition — damaged / missing */}
        <div className="alm-section">
          <label className="alm-label">Condition</label>
          <div className="ldm-flags">
            <button type="button" className={`ldm-flagbtn dmg${item?.flag === 'damaged' ? ' on' : ''}`} onClick={() => toggleFlag('damaged')}><Icon name="AlertTriangle" size={14} /> Damaged</button>
            <button type="button" className={`ldm-flagbtn mis${item?.flag === 'missing' ? ' on' : ''}`} onClick={() => toggleFlag('missing')}><Icon name="HelpCircle" size={14} /> Missing</button>
          </div>
          {item?.flag && (
            <div className="ldm-flagnote">
              <input className="alm-field" placeholder={item.flag === 'missing' ? 'Where was it last seen?' : 'What’s the damage?'} value={flagNoteDraft} onChange={(e) => setFlagNoteDraft(e.target.value)} />
              <button type="button" className="alm-btn outline" onClick={() => patch({ flagNote: flagNoteDraft })}>Save</button>
            </div>
          )}
        </div>

        {/* handling — sent ashore to a vendor */}
        <div className="alm-section">
          <label className="alm-label">Handling</label>
          {item?.serviceLocation === 'shore' ? (
            <div className="ldm-shore on">
              <div className="ldm-shore-txt">
                <Icon name="Anchor" size={14} />
                <span>Out at <b>{item?.vendor || 'shore laundry'}</b>{item?.expectedBack ? ` · back ${fmtDate(item.expectedBack)}` : ''}{item?.sentAt ? ` · sent ${fmtDate(item.sentAt)}` : ''}</span>
              </div>
              <button type="button" className="alm-btn outline" onClick={markOnboard}>Back onboard</button>
            </div>
          ) : shoreOpen ? (
            <div className="ldm-shore-form">
              <input className="alm-field" placeholder="Vendor / dry cleaner" value={vendorDraft} onChange={(e) => setVendorDraft(e.target.value)} />
              <input type="date" className="alm-field" value={backDraft || ''} onChange={(e) => setBackDraft(e.target.value)} />
              <div className="ldm-shore-actions">
                <button type="button" className="alm-linkbtn" onClick={() => setShoreOpen(false)}>Cancel</button>
                <button type="button" className="alm-btn primary" onClick={sendAshore}>Send ashore</button>
              </div>
            </div>
          ) : (
            <button type="button" className="ldm-sendbtn" onClick={() => setShoreOpen(true)}><Icon name="Anchor" size={14} /> Send ashore</button>
          )}
        </div>

        {/* charter charge — guest personal laundry (billed on plus-expenses charters) */}
        {kind === 'guest' && (
          <div className="alm-section">
            <label className="alm-label">Charter charge <span className="alm-opt">guest laundry</span></label>
            <div className="ldm-charge">
              <span className="ldm-charge-cur">{CUR_SYM[billing?.currency] || '£'}</span>
              <input type="number" min="0" step="0.01" className="alm-field" placeholder={billing ? suggestCharge(item, billing).toFixed(2) : '0.00'}
                value={chargeDraft} onChange={(e) => setChargeDraft(e.target.value)} />
              <button type="button" className="alm-btn outline" onClick={() => patch({ charge: chargeDraft === '' ? null : Number(chargeDraft) })}>Save</button>
            </div>
            <div className="ldm-charge-hint">
              {item?.charge != null ? `Set to ${money(item.charge, billing?.currency)}. ` : ''}
              Only billed on a plus-expenses (MYBA) charter{billing?.scope === 'shoreside' ? ', for shore-sent items — use the vendor’s invoice amount' : ''}.
            </div>
          </div>
        )}

        {item?.notes && (
          <div className="alm-section">
            <label className="alm-label">Notes</label>
            <div className="ldm-notes">{item.notes}</div>
          </div>
        )}

        {photos.length > 1 && (
          <div className="alm-section">
            <label className="alm-label">Photos <span className="alm-opt">{photos.length}</span></label>
            <div className="ldm-strip">{photos.map((src, i) => <img key={i} src={src} alt={`Photo ${i + 1}`} loading="lazy" decoding="async" />)}</div>
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

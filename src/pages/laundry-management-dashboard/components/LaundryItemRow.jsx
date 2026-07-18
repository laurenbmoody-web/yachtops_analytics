import React from 'react';
import Icon from '../../../components/AppIcon';
import { LaundryStatus, LaundryPriority, updateLaundryStatus, formatLaundryTag } from '../utils/laundryStorage';
import { money } from '../utils/laundryBilling';
import '../laundry.css';

const STEP = {
  [LaundryStatus?.IN_PROGRESS]: { idx: 1, cls: 's-prog', label: 'In progress' },
  [LaundryStatus?.READY_TO_DELIVER]: { idx: 2, cls: 's-ready', label: 'Ready' },
  [LaundryStatus?.DELIVERED]: { idx: 3, cls: 's-deliv', label: 'Delivered' },
};

const ownerKind = (t) => {
  const k = (t || 'unknown').toLowerCase();
  return k === 'guest' ? 'guest' : k === 'crew' ? 'crew' : k === 'other' ? 'other' : 'unknown';
};
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const fmtAgo = (iso) => {
  if (!iso) return '';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
};
const fmtDue = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

const LaundryItemRow = ({ item, onUpdate, onOpen, onAdvance }) => {
  const handleStatusUpdate = async (e, newStatus) => {
    e?.stopPropagation?.();
    // Prefer the parent's advance handler (offline-aware); fall back to a direct write.
    if (onAdvance) { await onAdvance(item, newStatus); return; }
    await updateLaundryStatus(item?.id, newStatus);
    onUpdate?.();
  };

  const step = STEP[item?.status] || STEP[LaundryStatus?.READY_TO_DELIVER];
  const kind = ownerKind(item?.ownerType);
  const urgent = item?.priority === LaundryPriority?.URGENT;
  const notDelivered = item?.status !== LaundryStatus?.DELIVERED;
  const overdue = item?.neededBy && notDelivered && new Date(item.neededBy) < new Date();
  const photos = Array.isArray(item?.photos) && item.photos.length ? item.photos : (item?.photo ? [item.photo] : []);
  const avInitials = kind === 'unknown' ? '?' : kind === 'other' ? '' : initials(item?.ownerName || item?.ownerDisplayName);

  return (
    <div
      className={`lr-row ${step.cls}${urgent ? ' urgent' : ''}`}
      role="button" tabIndex={0}
      onClick={() => onOpen?.(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(item); } }}
      style={{ cursor: onOpen ? 'pointer' : undefined }}
    >
      {/* photo */}
      <span className="lr-thumb">
        {photos[0] ? <img src={photos[0]} alt={item?.description || 'Laundry item'} loading="lazy" decoding="async" /> : <Icon name="Shirt" size={24} className="lr-ph-ic" />}
        {photos.length > 1 && <span className="lr-cnt">{photos.length}</span>}
      </span>

      {/* description + owner + tags */}
      <div className="lr-main">
        <div className="lr-top">
          <span className="lr-desc">{item?.description || 'No description'}</span>
          {urgent && <span className="lr-flag"><Icon name="Zap" size={11} /> Urgent</span>}
          {overdue && <span className="lr-overdue"><Icon name="Clock" size={11} /> Overdue</span>}
          {item?.flag === 'damaged' && <span className="lr-cond dmg"><Icon name="AlertTriangle" size={11} /> Damaged</span>}
          {item?.flag === 'missing' && <span className="lr-cond mis"><Icon name="HelpCircle" size={11} /> Missing</span>}
        </div>
        <div className="lr-sub">
          <span className="lr-who"><span className={`lr-av ${kind}`}>{item?.avatarUrl ? <img src={item.avatarUrl} alt="" loading="lazy" decoding="async" /> : (kind === 'other' ? <Icon name="Package" size={13} /> : avInitials)}</span>{kind === 'unknown' ? 'Unknown' : kind === 'other' ? 'Other' : (item?.ownerName || 'Unassigned')}</span>
          {item?.area && (<><span className="sep">·</span><b>{item.area}</b></>)}
          {item?.laundryNumber && (<><span className="sep">·</span><span>No. {item.laundryNumber}</span></>)}
          {item?.colour && (<><span className="sep">·</span><span>{item.colour}</span></>)}
          {item?.neededBy && !overdue && notDelivered && (<><span className="sep">·</span><span className="lr-due">due {fmtDue(item.neededBy)}</span></>)}
          {item?.serviceLocation === 'shore' && (<><span className="sep">·</span><span className="lr-shore"><Icon name="Anchor" size={11} /> Ashore</span></>)}
        </div>
        {item?.tags?.length > 0 && (
          <div className="lr-tags">
            {item.tags.map((tag, i) => <span key={i} className="lr-tag">{formatLaundryTag(tag)}</span>)}
          </div>
        )}
      </div>

      {/* progress + quick action */}
      <div className="lr-right">
        {item?._billable && item?._charge != null && <span className="lr-charge" title="Charter charge (guest laundry)"><Icon name="Receipt" size={11} /> {money(item._charge, item._currency)}</span>}
        <div className="lr-rgrid">
        <div className="lr-step">
          <div className="lr-pips">
            <i className={step.idx >= 1 ? 'on' : ''} />
            <i className={step.idx >= 2 ? 'on' : ''} />
            <i className={step.idx >= 3 ? 'on' : ''} />
          </div>
          <span className="lr-steplabel">{step.label}</span>
        </div>
        <span className="lr-when">{item?.status === LaundryStatus?.DELIVERED ? fmtAgo(item?.deliveredAt) : fmtAgo(item?.createdAt)}</span>
        {item?.status === LaundryStatus?.IN_PROGRESS && (
          <button type="button" className="lr-act go" onClick={(e) => handleStatusUpdate(e, LaundryStatus?.READY_TO_DELIVER)}>
            <Icon name="Check" size={14} /> Mark ready
          </button>
        )}
        {item?.status === LaundryStatus?.READY_TO_DELIVER && (
          <button type="button" className="lr-act go" onClick={(e) => handleStatusUpdate(e, LaundryStatus?.DELIVERED)}>
            <Icon name="ArrowRight" size={14} /> Deliver
          </button>
        )}
        {item?.status === LaundryStatus?.DELIVERED && (
          <span className="lr-act done"><Icon name="Check" size={14} /> Delivered</span>
        )}
        </div>
      </div>
    </div>
  );
};

export default LaundryItemRow;

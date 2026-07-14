import React from 'react';
import Icon from '../../../components/AppIcon';
import { LaundryStatus, LaundryPriority, updateLaundryStatus } from '../utils/laundryStorage';

const STATUS = {
  [LaundryStatus?.IN_PROGRESS]: { label: 'In progress', cls: 'progress' },
  [LaundryStatus?.READY_TO_DELIVER]: { label: 'Ready to deliver', cls: 'ready' },
  [LaundryStatus?.DELIVERED]: { label: 'Delivered', cls: 'delivered' },
};

const ownerKind = (t) => {
  const k = (t || 'unknown').toLowerCase();
  return k === 'guest' ? 'guest' : k === 'crew' ? 'crew' : 'unknown';
};

const LaundryItemRow = ({ item, onUpdate }) => {
  const handleStatusUpdate = (newStatus) => {
    updateLaundryStatus(item?.id, newStatus);
    onUpdate?.();
  };

  const status = STATUS[item?.status] || { label: item?.status, cls: 'ready' };
  const kind = ownerKind(item?.ownerType);

  return (
    <div className="lm-row">
      {item?.photo ? (
        <img src={item.photo} alt={item?.description || 'Laundry item'} className="lm-thumb" />
      ) : (
        <span className="lm-thumb-ph"><Icon name="Shirt" size={26} /></span>
      )}

      <div className="lm-body">
        <div className="lm-row-top">
          <div style={{ minWidth: 0 }}>
            <div className="lm-desc">{item?.description || 'No description'}</div>
            <div className="lm-sub">
              <span className={`lm-owner-tag ${kind}`}>{kind === 'unknown' ? 'Unknown' : kind[0].toUpperCase() + kind.slice(1)}</span>
              {item?.ownerName && (<><span className="dot">·</span><span>{item.ownerName}</span></>)}
              {item?.area && (<><span className="dot">·</span><span>{item.area}</span></>)}
            </div>
            {item?.tags?.length > 0 && (
              <div className="lm-tags">
                {item.tags.map((tag, i) => <span key={i} className="lm-tag-chip">{tag}</span>)}
              </div>
            )}
          </div>
          <div className="lm-right">
            <span className={`lm-status ${status.cls}`}>{status.label}</span>
            {item?.priority === LaundryPriority?.URGENT && (
              <span className="lm-urgent"><Icon name="AlertCircle" size={11} /> Urgent</span>
            )}
          </div>
        </div>

        <div className="lm-actions-row">
          {item?.status === LaundryStatus?.IN_PROGRESS && (
            <button type="button" className="lm-act-btn primary" onClick={() => handleStatusUpdate(LaundryStatus?.READY_TO_DELIVER)}>
              <Icon name="CheckCircle" size={14} /> Ready to deliver
            </button>
          )}
          {item?.status === LaundryStatus?.READY_TO_DELIVER && (
            <button type="button" className="lm-act-btn sage" onClick={() => handleStatusUpdate(LaundryStatus?.DELIVERED)}>
              <Icon name="Package" size={14} /> Mark delivered
            </button>
          )}
          {item?.status === LaundryStatus?.DELIVERED && item?.deliveredAt && (
            <span className="lm-delivered-at">
              Delivered {new Date(item.deliveredAt).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default LaundryItemRow;

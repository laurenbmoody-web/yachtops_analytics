import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { CREW_STATUSES, getStatusDotClass } from '../../../utils/crewStatus';
import ModalShell from '../../../components/ui/ModalShell';
import './StatusChangeModal.css';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const StatusChangeModal = ({ isOpen, onClose, onConfirm, memberName, currentStatus, saving }) => {
  const [selectedStatus, setSelectedStatus] = useState(currentStatus || 'active');
  const [notes, setNotes] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayStr());
  const [effectiveTime, setEffectiveTime] = useState('00:00');

  useEffect(() => {
    if (isOpen) {
      setSelectedStatus(currentStatus || 'active');
      setNotes('');
      setEffectiveDate(todayStr());
      setEffectiveTime('00:00');
    }
  }, [isOpen, currentStatus]);

  if (!isOpen) return null;

  const isFuture = effectiveDate > todayStr();

  return (
    <ModalShell onClose={onClose} isBusy={saving} panelClassName="scm-panel">
      <div className="scm">
        <div className="scm-head">
          <div>
            <h3 className="scm-title">Change status</h3>
            {memberName && <p className="scm-sub">{memberName}</p>}
          </div>
          <button className="scm-close" onClick={onClose} disabled={saving} aria-label="Close">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="scm-body">
          {/* Status selector */}
          <div className="scm-field">
            <label className="scm-label">New status</label>
            <div className="scm-options">
              {CREW_STATUSES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSelectedStatus(s.value)}
                  className={`scm-opt${selectedStatus === s.value ? ' is-sel' : ''}`}
                >
                  <span className={`scm-dot ${getStatusDotClass(s.value)}`} />
                  <span className="scm-opt-label">{s.label}</span>
                  {s.value === currentStatus && <span className="scm-current">current</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Effective date (+ time for Travelling) */}
          <div className="scm-field">
            <label className="scm-label">Effective from</label>
            <div className="scm-inputcard">
              <input
                type="date"
                value={effectiveDate}
                onChange={e => setEffectiveDate(e.target.value)}
              />
              {selectedStatus === 'travelling' && (
                <input
                  type="time"
                  value={effectiveTime}
                  onChange={e => setEffectiveTime(e.target.value)}
                />
              )}
            </div>
            {isFuture && (
              <p className="scm-future">
                <Icon name="Clock" size={12} />
                Scheduled — current status unchanged until this date
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="scm-field">
            <label className="scm-label">Note <span className="opt">· optional</span></label>
            <div className="scm-inputcard">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Returning 15 May — crew changeover"
                rows={2}
              />
            </div>
          </div>
        </div>

        <div className="scm-foot">
          <p className="scm-perm">
            <Icon name="ShieldCheck" size={13} />
            Only command crew can change a member&rsquo;s status.
          </p>
          <div className="scm-actions">
            <button className="scm-btn scm-btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              className="scm-btn scm-btn-primary"
              onClick={() => onConfirm(selectedStatus, notes, effectiveDate, selectedStatus === 'travelling' ? effectiveTime : '00:00')}
              disabled={saving || (selectedStatus === currentStatus && !isFuture)}
            >
              {saving ? 'Saving…' : isFuture ? 'Schedule' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};

export default StatusChangeModal;

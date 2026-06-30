import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { CREW_STATUSES, getStatusDotClass } from '../../../utils/crewStatus';
import { TRANSPORTS } from '../../crew-profile/utils/crewCalendar';
import ModalShell from '../../../components/ui/ModalShell';
import './StatusChangeModal.css';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Statuses that imply the crew member is away — show travel/leave detail fields.
const AWAY_STATUSES = new Set(['on_leave', 'rotational_leave', 'medical_leave', 'training_leave', 'travelling']);
const EMPTY_TRAVEL = { endDate: '', fromLocation: '', toLocation: '', transport: '', transportNo: '', departTime: '', arriveTime: '' };

const StatusChangeModal = ({ isOpen, onClose, onConfirm, memberName, currentStatus, saving }) => {
  const [selectedStatus, setSelectedStatus] = useState(currentStatus || 'active');
  const [notes, setNotes] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayStr());
  const [effectiveTime, setEffectiveTime] = useState('00:00');
  const [travel, setTravel] = useState(EMPTY_TRAVEL);

  useEffect(() => {
    if (isOpen) {
      setSelectedStatus(currentStatus || 'active');
      setNotes('');
      setEffectiveDate(todayStr());
      setEffectiveTime('00:00');
      setTravel(EMPTY_TRAVEL);
    }
  }, [isOpen, currentStatus]);

  if (!isOpen) return null;

  const isFuture = effectiveDate > todayStr();
  const showTravel = AWAY_STATUSES.has(selectedStatus);
  const setT = (k, v) => setTravel((p) => ({ ...p, [k]: v }));

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

          {/* Travel / leave detail — shown for away statuses, saved to the crew calendar */}
          {showTravel && (
            <div className="scm-field">
              <label className="scm-label">Travel &amp; return <span className="opt">· optional</span></label>
              <div className="scm-inputcard scm-travel">
                <div className="scm-trow">
                  <input placeholder="From (e.g. Palma)" value={travel.fromLocation} onChange={(e) => setT('fromLocation', e.target.value)} />
                  <input placeholder="To (e.g. London)" value={travel.toLocation} onChange={(e) => setT('toLocation', e.target.value)} />
                </div>
                <div className="scm-trow">
                  <select value={travel.transport} onChange={(e) => setT('transport', e.target.value)}>
                    <option value="">Transport…</option>
                    {TRANSPORTS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input placeholder="No. (e.g. BA492)" value={travel.transportNo} onChange={(e) => setT('transportNo', e.target.value)} />
                </div>
                <div className="scm-trow">
                  <label className="scm-tlab">Departs<input type="time" value={travel.departTime} onChange={(e) => setT('departTime', e.target.value)} /></label>
                  <label className="scm-tlab">Arrives<input type="time" value={travel.arriveTime} onChange={(e) => setT('arriveTime', e.target.value)} /></label>
                </div>
                <label className="scm-tlab scm-tfull">Returns / until<input type="date" value={travel.endDate} onChange={(e) => setT('endDate', e.target.value)} /></label>
              </div>
            </div>
          )}

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
              onClick={() => onConfirm(selectedStatus, notes, effectiveDate, selectedStatus === 'travelling' ? effectiveTime : '00:00', showTravel ? travel : null)}
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

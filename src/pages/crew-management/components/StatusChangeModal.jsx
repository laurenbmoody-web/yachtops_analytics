import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { CREW_STATUSES, getStatusLabel } from '../../../utils/crewStatus';
import { TRANSPORTS } from '../../crew-profile/utils/crewCalendar';
import ModalShell from '../../../components/ui/ModalShell';
import './StatusChangeModal.css';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmtDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

// Editorial status palette (matches the crew-management views).
const STATUS_HEX = {
  active: '#2E9E6B', on_leave: '#C0851F', rotational_leave: '#7C5CBF',
  medical_leave: '#C65A1A', training_leave: '#3B82F6', travelling: '#0F9C8E', invited: '#AEB4C2',
};
const hex = (s) => STATUS_HEX[s] || '#7C5CBF';

// Statuses that imply the crew member is away — reveal travel/return detail.
const AWAY_STATUSES = new Set(['on_leave', 'rotational_leave', 'medical_leave', 'training_leave', 'travelling']);
const EMPTY_TRAVEL = { endDate: '', fromLocation: '', toLocation: '', transport: '', transportNo: '', departTime: '', arriveTime: '' };

const StatusChangeModal = ({ isOpen, onClose, onConfirm, memberName, currentStatus, saving }) => {
  const [selectedStatus, setSelectedStatus] = useState(currentStatus || 'active');
  const [notes, setNotes] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayStr());
  const [travel, setTravel] = useState(EMPTY_TRAVEL);

  useEffect(() => {
    if (isOpen) {
      setSelectedStatus(currentStatus || 'active');
      setNotes('');
      setEffectiveDate(todayStr());
      setTravel(EMPTY_TRAVEL);
    }
  }, [isOpen, currentStatus]);

  if (!isOpen) return null;

  const isFuture = effectiveDate > todayStr();
  const showTravel = AWAY_STATUSES.has(selectedStatus);
  const setT = (k, v) => setTravel((p) => ({ ...p, [k]: v }));
  const c = hex(selectedStatus);

  return (
    <ModalShell onClose={onClose} isBusy={saving} panelClassName="scm-panel">
      <div className="scm">
        {/* Colour-wash hero — re-tints to the chosen status */}
        <div className="scm-hero" style={{ background: `linear-gradient(135deg, ${c}1F, #FBFAFE 70%)` }}>
          <button className="scm-x" onClick={onClose} disabled={saving} aria-label="Close"><Icon name="X" size={17} /></button>
          <div className="scm-eyebrow">New status · {memberName || 'Crew'}</div>
          <div className="scm-heroword" style={{ color: c }}>
            <span className="scm-pin" style={{ background: c }} />
            {getStatusLabel(selectedStatus)}
          </div>
          <div className="scm-herosub">
            from <b>{fmtDate(effectiveDate)}</b>
            {showTravel && travel.endDate ? <> · returning <b>{fmtDate(travel.endDate)}</b></> : null}
            {isFuture ? <span className="scm-sched"><Icon name="Clock" size={11} /> scheduled</span> : null}
          </div>
        </div>

        <div className="scm-body">
          {/* Status pills */}
          <span className="scm-label">Choose status</span>
          <div className="scm-seg">
            {CREW_STATUSES.map((s) => {
              const sel = selectedStatus === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  className={`scm-pill${sel ? ' is-sel' : ''}`}
                  style={sel ? { background: `${hex(s.value)}16`, borderColor: hex(s.value), color: hex(s.value) } : undefined}
                  onClick={() => setSelectedStatus(s.value)}
                >
                  <span className="scm-pdot" style={{ background: hex(s.value) }} />
                  {s.label}
                  {s.value === currentStatus && <span className="scm-current">now</span>}
                </button>
              );
            })}
          </div>

          {/* Effective from */}
          <div className="scm-field">
            <span className="scm-label">Effective from</span>
            <div className="scm-softbox">
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </div>
          </div>

          {/* Travel & return — away statuses only */}
          {showTravel && (
            <div className="scm-field">
              <span className="scm-label">Travel &amp; return <span className="opt">· optional</span></span>
              <div className="scm-travel">
                <input placeholder="From · Palma" value={travel.fromLocation} onChange={(e) => setT('fromLocation', e.target.value)} />
                <input placeholder="To · London" value={travel.toLocation} onChange={(e) => setT('toLocation', e.target.value)} />
                <select value={travel.transport} onChange={(e) => setT('transport', e.target.value)}>
                  <option value="">Transport…</option>
                  {TRANSPORTS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input placeholder="No. · BA492" value={travel.transportNo} onChange={(e) => setT('transportNo', e.target.value)} />
                <label className="scm-tlab">Departs<input type="time" value={travel.departTime} onChange={(e) => setT('departTime', e.target.value)} /></label>
                <label className="scm-tlab">Arrives<input type="time" value={travel.arriveTime} onChange={(e) => setT('arriveTime', e.target.value)} /></label>
                <label className="scm-tlab scm-tfull">Returns / until<input type="date" value={travel.endDate} onChange={(e) => setT('endDate', e.target.value)} /></label>
              </div>
            </div>
          )}

          {/* Note */}
          <div className="scm-field">
            <span className="scm-label">Note <span className="opt">· optional</span></span>
            <div className="scm-softbox">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Crew changeover in Palma" rows={2} />
            </div>
          </div>
        </div>

        <div className="scm-foot">
          <p className="scm-perm"><Icon name="ShieldCheck" size={13} /> Command only</p>
          <div className="scm-actions">
            <button className="scm-btn scm-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button
              className="scm-btn scm-btn-primary"
              onClick={() => onConfirm(selectedStatus, notes, effectiveDate, '00:00', showTravel ? travel : null)}
              disabled={saving || (selectedStatus === currentStatus && !isFuture)}
            >
              {saving ? 'Saving…' : isFuture ? 'Schedule' : 'Save status'}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};

export default StatusChangeModal;

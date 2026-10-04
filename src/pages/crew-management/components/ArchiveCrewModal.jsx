import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { EditorialDatePicker } from '../../../components/editorial';
import './ArchiveCrewModal.css';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Common reasons a crew member leaves — free text covers anything else.
const REASONS = [
  'Contract ended',
  'End of temporary / seasonal contract',
  'Resigned',
  'Dismissed',
  'Redundancy',
  'Medical',
  'Mutual agreement',
  'Other',
];

// Off-board a crew member: capture a leaving date + reason, then archive. Their
// record is kept under Past crew (reactivatable), not deleted.
const ArchiveCrewModal = ({ isOpen, member, defaultEndDate, saving, onConfirm, onClose }) => {
  const [endDate, setEndDate] = useState(defaultEndDate || todayStr());
  const [reason, setReason] = useState('Contract ended');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (isOpen) {
      setEndDate(defaultEndDate || todayStr());
      setReason('Contract ended');
      setNote('');
    }
  }, [isOpen, defaultEndDate]);

  if (!isOpen) return null;

  const submit = () => {
    if (saving || !endDate) return;
    onConfirm({ endDate, reason, note: note.trim() || null });
  };

  return (
    <ModalShell onClose={onClose} isBusy={saving} panelClassName="acm-panel">
      <div className="acm">
        <div className="acm-head">
          <div>
            <div className="acm-eyebrow">End contract · archive</div>
            <h2 className="acm-title">{member?.fullName || 'Crew member'}</h2>
          </div>
          <button className="acm-x" onClick={onClose} disabled={saving} aria-label="Close"><Icon name="X" size={17} /></button>
        </div>

        <div className="acm-body">
          <p className="acm-lead">
            They’ll move to <b>Past crew</b> and lose access, but their full record is kept — so you can
            reactivate them if they return, or keep it for your records.
          </p>

          <div className="acm-grid">
            <label className="acm-field">
              <span className="acm-lab">Last day aboard <em className="req">required</em></span>
              <EditorialDatePicker value={(endDate || '').slice(0, 10)} onChange={(iso) => setEndDate(iso)} placeholder="dd/mm/yyyy" />
            </label>
            <label className="acm-field">
              <span className="acm-lab">Reason for leaving</span>
              <div className="acm-select">
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </label>
          </div>

          <label className="acm-field">
            <span className="acm-lab">Note <em className="opt">optional</em></span>
            <textarea className="acm-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth keeping on record (handover, rehire eligibility…)" />
          </label>

          <p className="acm-gdpr"><Icon name="ShieldCheck" size={13} /> Kept under Past crew for your records. You can permanently delete it later for GDPR.</p>
        </div>

        <div className="acm-foot">
          <button type="button" className="acm-btn ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="acm-btn danger" onClick={submit} disabled={saving || !endDate}>
            {saving ? 'Archiving…' : 'Archive crew'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

export default ArchiveCrewModal;

import React, { useState } from 'react';
import Icon from '../../components/AppIcon';

// CrewRequestRightPane — the decision surface for one crew request. Currently
// every request is a notification-email change (route a vessel's alerts to a
// different address); the layout is deliberately generic so future request
// kinds — leave, account changes — can slot in with their own body block.

const fmtWhen = (iso) => {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
};

export default function CrewRequestRightPane({ request, onDecide, onToast }) {
  const [busy, setBusy] = useState(false);
  const name = request.requester?.full_name || 'Crew member';
  const currentEmail = request.requester?.email || '';

  const decide = async (approve) => {
    setBusy(true);
    try {
      await onDecide(request.id, approve);
      onToast?.(approve
        ? `Approved — alerts for ${name} will go to ${request.requested_email}`
        : `Declined — ${name} keeps their login email`);
    } catch (e) {
      console.warn('[CrewRequestRightPane] decide failed', e);
      onToast?.('Couldn’t save that decision', { error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rv-cr-detail">
      <div className="rv-cr-head">
        <span className="rv-cr-kind">Notification email</span>
        <h2 className="rv-cr-name">{name}</h2>
        <div className="rv-cr-when">Requested {fmtWhen(request.requested_at)}</div>
      </div>

      <p className="rv-cr-lede">
        {name} has asked to send this vessel’s alerts to a different address.
        Approve to route their notifications there, or decline to keep their login email.
      </p>

      <div className="rv-cr-flow">
        <div className="rv-cr-flow-cell">
          <div className="rv-cr-flow-label">Currently</div>
          <div className="rv-cr-flow-val muted">{currentEmail || '—'}</div>
        </div>
        <Icon name="ArrowRight" size={16} className="rv-cr-flow-arrow" />
        <div className="rv-cr-flow-cell">
          <div className="rv-cr-flow-label">Requested</div>
          <div className="rv-cr-flow-val">{request.requested_email}</div>
        </div>
      </div>

      <div className="rv-cr-actions">
        <button type="button" className="rv-cr-approve" disabled={busy} onClick={() => decide(true)}>
          {busy ? 'Saving…' : 'Approve'}
        </button>
        <button type="button" className="rv-cr-decline" disabled={busy} onClick={() => decide(false)}>
          Decline
        </button>
      </div>
    </div>
  );
}

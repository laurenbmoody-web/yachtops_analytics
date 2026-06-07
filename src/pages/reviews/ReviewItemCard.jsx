import React, { useState } from 'react';
import Icon from '../../components/AppIcon';
import {
  approveRotaDepartment,
  rejectRotaDepartment,
} from '../crew-rota/useRotaLifecycleWriters';

// ReviewItemCard — one row in the /reviews inbox.
//
// Accept (filled navy) → approveRotaDepartment one-click, note=null.
// Accept with edits (ghost) → STUB. Phase 4b navigates into the rota
//   in review mode. For 4a, surfaces a toast and stays put.
// Reject (ghost) → expands an inline reject panel inside the card.
//   The panel collects a required note, then calls rejectRotaDepartment.
//
// On success of either Accept or Reject:
//   - Toast (success variant) with submitter-name copy.
//   - onResolved() fires to bump the parent list (refetch).
// On failure:
//   - Destructive toast with error.message.
//   - Button restored, list unchanged.
//
// The card owns its own panel-open + textarea state. When the card
// unmounts (after refetch removes it from the list), local state goes
// with it. ctaBusy state ('accept'|'accept-edits'|'reject'|null) gates
// every button during in-flight RPCs to prevent double-clicks.

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function ReviewItemCard({ item, onToast, onResolved }) {
  const [busy, setBusy] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  const submitterFirstName = (item.submitter_name || 'the submitter').split(' ')[0];
  const deptCopy = item.department_name || 'this department';

  const handleAccept = async () => {
    if (busy) return;
    setBusy('accept');
    const res = await approveRotaDepartment({ reviewItemId: item.id, note: null });
    setBusy(null);
    if (!res.ok) {
      onToast?.(`Couldn’t accept — ${res.error || 'try again.'}`, { error: true });
      return;
    }
    onToast?.(`Accepted. ${submitterFirstName}’s submission is now published.`);
    onResolved?.();
  };

  const handleAcceptWithEdits = () => {
    // Phase 4b — navigate to the rota in review mode.
    onToast?.('Review mode ships in Phase 4b.');
  };

  const handleRejectOpen = () => {
    setRejectOpen(true);
    setRejectNote('');
  };
  const handleRejectCancel = () => {
    setRejectOpen(false);
    setRejectNote('');
  };
  const handleRejectSend = async () => {
    if (busy) return;
    const note = rejectNote.trim();
    if (!note) return;
    setBusy('reject');
    const res = await rejectRotaDepartment({ reviewItemId: item.id, note });
    setBusy(null);
    if (!res.ok) {
      onToast?.(`Couldn’t reject — ${res.error || 'try again.'}`, { error: true });
      return;
    }
    onToast?.(`Rejected. ${deptCopy} is back to draft.`);
    onResolved?.();
  };

  return (
    <div className="rv-card">
      <div className="rv-card-head">
        <div>
          <div className="rv-card-dept">{item.department_name || '—'}</div>
          <div className="rv-card-rota">{item.rota_name || ''}</div>
        </div>
        <div className="rv-card-meta">
          <div>Submitted {timeAgo(item.created_at)}</div>
          <div className="rv-card-meta-sub">
            by {item.submitter_name || 'crew'}{item.submitter_role ? ` · ${item.submitter_role}` : ''}
          </div>
        </div>
      </div>

      <div className="rv-card-strip">
        <Icon name="Calendar" size={14} />
        <span>{item.day_count} day{item.day_count === 1 ? '' : 's'} · {item.shift_count} shift{item.shift_count === 1 ? '' : 's'}</span>
        {item.mlc_override_count > 0 && (
          <>
            <span className="rv-card-strip-sep" aria-hidden />
            <Icon name="AlertTriangle" size={14} color="#7A2E1E" />
            <span style={{ color: '#7A2E1E' }}>
              {item.mlc_override_count} MLC override{item.mlc_override_count === 1 ? '' : 's'}
            </span>
          </>
        )}
      </div>

      {rejectOpen && (
        <div className="rv-reject-panel">
          <div className="rv-reject-label">Rejection reason</div>
          <textarea
            className="rv-reject-textarea"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Required — explain what needs to change before resubmission"
            rows={3}
            aria-label="Rejection reason"
          />
          <div className="rv-reject-actions">
            <button
              type="button"
              className="rv-btn ghost"
              onClick={handleRejectCancel}
              disabled={busy === 'reject'}
            >Cancel</button>
            <button
              type="button"
              className="rv-btn danger"
              onClick={handleRejectSend}
              disabled={busy === 'reject' || !rejectNote.trim()}
            >{busy === 'reject' ? 'Sending…' : 'Send rejection'}</button>
          </div>
        </div>
      )}

      {!rejectOpen && (
        <div className="rv-card-actions">
          <button
            type="button"
            className="rv-btn ghost"
            onClick={handleRejectOpen}
            disabled={!!busy}
          >Reject</button>
          <button
            type="button"
            className="rv-btn ghost"
            onClick={handleAcceptWithEdits}
            disabled={!!busy}
            title="Open the rota in review mode (ships in Phase 4b)"
          >Accept with edits</button>
          <button
            type="button"
            className="rv-btn primary"
            onClick={handleAccept}
            disabled={!!busy}
          >{busy === 'accept' ? 'Accepting…' : 'Accept'}</button>
        </div>
      )}
    </div>
  );
}

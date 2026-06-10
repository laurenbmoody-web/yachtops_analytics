import React, { useEffect } from 'react';
import { X } from 'lucide-react';

// BreachSignoffModal — shown when a chief tries to accept a submission that
// breaches MLC rest rules. They must either go back and edit, or sign off:
// record a reason and accept anyway. The reason is stored on the approval
// (decision note + audit event) so the override is traceable.

export default function BreachSignoffModal({
  open, summary, busy, reason, onReasonChange, onCancel, onConfirm,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const count = summary?.count || 0;
  const names = (summary?.crew || []).map((c) => c.name).join(', ');

  return (
    <>
      <div className="rest-popover-backdrop" onClick={busy ? undefined : onCancel} />
      <div className="te-panel" role="dialog" aria-modal="true" aria-labelledby="breach-title">
        <div className="tp-header">
          <div>
            <div className="tp-eyebrow" style={{ color: '#7A2E1E' }}>Hours don’t comply</div>
            <h2 className="tp-title" id="breach-title">
              Rest rules <em>breached</em>
            </h2>
          </div>
          <button
            type="button"
            className="tp-close"
            aria-label="Close"
            onClick={onCancel}
            disabled={busy}
          ><X size={16} /></button>
        </div>

        <div className="te-body">
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#1C1B3A' }}>
            This submission breaches MLC rest rules on <b>{count} day{count === 1 ? '' : 's'}</b>
            {names ? <> — {names}</> : null}. Cancel to amend the hours, or record a
            reason and accept anyway.
          </p>
          <div style={{ marginTop: 14 }}>
            <label
              htmlFor="breach-reason"
              style={{ display: 'block', fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#7A2E1E', marginBottom: 6 }}
            >Reason for accepting non-compliant hours</label>
            <textarea
              id="breach-reason"
              value={reason}
              onChange={(e) => onReasonChange?.(e.target.value)}
              placeholder="Required — e.g. port call / safety operation / agreed exception"
              rows={3}
              style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, color: '#1C1B3A', padding: '10px 12px', border: '0.5px solid #DFD8CC', borderRadius: 6, background: '#FFFFFF', resize: 'vertical', boxSizing: 'border-box' }}
              aria-label="Reason for accepting non-compliant hours"
            />
          </div>
        </div>

        <div className="te-footer">
          <span />
          <div className="te-footer-actions">
            <button
              type="button"
              className="v2-btn-ghost"
              onClick={onCancel}
              disabled={busy}
              aria-label="Cancel and edit the rota"
            >Cancel</button>
            <button
              type="button"
              className="v2-btn-filled"
              style={{ background: '#7A2E1E' }}
              onClick={onConfirm}
              disabled={busy || !reason || !reason.trim()}
              aria-label="Accept despite the breach"
            >{busy ? 'Accepting…' : 'Accept anyway'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

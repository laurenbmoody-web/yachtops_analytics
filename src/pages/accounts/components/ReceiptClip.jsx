// Cargo Accounts — the receipt affordance on a ledger row.
//
// Every line needs a receipt OR a stated reason there isn't one, so both live
// behind this one clip: the three ways a receipt actually arrives (photograph it,
// pick a photo, pick a file) and the declaration that there'll never be one.
//
// It sits on the row rather than in the expander because it's the single most
// common thing to do to a line after categorising it — you shouldn't have to open
// the detail panel to say a bank charge has no receipt.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import './receipt-clip.css';

// Wide enough for the reason field's placeholder to read in full — at 268 it
// clipped mid-word, which looks like a broken input rather than a hint.
const PANEL_W = 320;

export default function ReceiptClip({
  txn, attachments = [], canEdit = true,
  onPhotograph, onUpload, onWaive, onDeleteAttachment, onOpenInvoice, invoice = null,
}) {
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const [at, setAt] = useState(null);            // fixed coords, or null when closed
  const [stage, setStage] = useState('menu');    // 'menu' | 'reason'
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const has = attachments.length > 0;
  const waived = Boolean(txn.receipt_waived) && Boolean(String(txn.receipt_waived_reason || '').trim());
  // A line raised from a supplier invoice already has its document — see
  // hasEvidence. The clip is where evidence lives, so it says so and opens it,
  // rather than showing an empty paperclip on a line that's fully supported.
  const invoiced = Boolean(txn.supplier_invoice_id) && !has;

  const close = useCallback(() => { setAt(null); setStage('menu'); }, []);

  // Anchor to the clip: right-aligned, below unless that would fall off-screen.
  const open = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setReason(txn.receipt_waived_reason || '');
    setStage(waived ? 'reason' : 'menu');
    setAt({
      left: Math.max(12, Math.min(r.right - PANEL_W, window.innerWidth - PANEL_W - 12)),
      top: r.bottom + 6,
      bottom: window.innerHeight - r.top + 6,
      flip: r.bottom + 300 > window.innerHeight,
    });
  };

  useEffect(() => {
    if (!at) return undefined;
    const away = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      close();
    };
    const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [at, close]);

  const take = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); close(); } };
  const pick = (file) => { if (file) take(() => onUpload?.(txn.id, file)); };

  const saveReason = () => {
    const text = reason.trim();
    if (!text) return;                   // "no receipt" without saying why proves nothing
    take(() => onWaive?.(txn.id, text));
  };

  const item = (icon, label, onClick, extra = '') => (
    <button type="button" className={`rc-item${extra ? ` ${extra}` : ''}`} onClick={onClick} disabled={busy}>
      <Icon name={icon} size={14} />
      <span>{label}</span>
    </button>
  );

  const fileItem = (icon, label, accept) => (
    <label className="rc-item">
      <Icon name={icon} size={14} />
      <span>{label}</span>
      <input type="file" accept={accept} hidden disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f); }} />
    </label>
  );

  return (
    <>
      <button ref={btnRef} type="button"
        className={`ca-clip${has || invoiced ? ' has' : ''}${!has && !invoiced && waived ? ' is-waived' : ''}`}
        aria-haspopup="menu" aria-expanded={Boolean(at)}
        title={has
          ? `${attachments.length} receipt${attachments.length > 1 ? 's' : ''}`
          : invoiced
            ? 'Supported by its supplier invoice'
            : (waived ? `No receipt — ${txn.receipt_waived_reason}` : 'Receipt')}
        onClick={() => (at ? close() : open())}>
        <Icon name={invoiced ? 'FileText' : (has ? 'Paperclip' : (waived ? 'FileX' : 'Paperclip'))} size={13} />
        {attachments.length > 1 ? attachments.length : ''}
      </button>

      {at && createPortal(
        <div ref={panelRef} className="rc-panel" role="menu"
          style={at.flip
            ? { left: at.left, bottom: at.bottom, width: PANEL_W }
            : { left: at.left, top: at.top, width: PANEL_W }}>

          {invoiced && (
            <div className="rc-group">
              <p className="rc-label">Its document</p>
              {/* rc-item, not rc-att-open: that one takes its left padding from a
                  wrapper this row doesn't have, so it sat flush against the edge
                  while every other row in the menu was indented. */}
              <button type="button" className="rc-item is-doc" onClick={() => { close(); onOpenInvoice?.(invoice, txn); }}>
                <Icon name="FileText" size={14} />
                {invoice?.invoice_number ? `Invoice ${invoice.invoice_number}` : 'Supplier invoice'}
                <Icon name="ArrowUpRight" size={12} />
              </button>
            </div>
          )}

          {has && (
            <div className="rc-group">
              <p className="rc-label">Attached</p>
              {attachments.map((a) => (
                <div key={a.id} className="rc-att">
                  <button type="button" className="rc-att-open"
                    onClick={() => { if (a.url) window.open(a.url, '_blank', 'noopener'); close(); }}>
                    <Icon name="Paperclip" size={13} />
                    <span>{a.file_name || 'Receipt'}</span>
                  </button>
                  {canEdit && onDeleteAttachment && (
                    <button type="button" className="rc-att-x" title="Remove"
                      onClick={() => take(() => onDeleteAttachment(a.id, a.storage_path))}>×</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEdit && stage === 'menu' && (
            <div className="rc-group">
              <p className="rc-label">{has ? 'Add another' : 'Add a receipt'}</p>
              {item('Camera', 'Take a photo', () => { close(); onPhotograph?.(txn); })}
              {fileItem('Image', 'Choose a photo', 'image/*')}
              {fileItem('FileText', 'Choose a file', 'image/*,application/pdf')}
            </div>
          )}

          {/* The other half of the rule. Only offered while nothing is attached —
              with a receipt on the line there is nothing to excuse. */}
          {canEdit && !has && stage === 'menu' && (
            <div className="rc-group rc-top">
              {item('FileX', 'No receipt for this', () => setStage('reason'))}
            </div>
          )}

          {canEdit && !has && stage === 'reason' && (
            <div className="rc-group rc-top">
              <p className="rc-label">Why there&rsquo;s no receipt <em>required</em></p>
              <input className="rc-reason" value={reason} autoFocus
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveReason(); }}
                placeholder="Bank charge, subscription, lost…" />
              <div className="rc-act">
                {waived
                  ? <button type="button" className="rc-ghost" disabled={busy}
                    onClick={() => take(() => onWaive?.(txn.id, null))}>I do have one</button>
                  : <button type="button" className="rc-ghost" disabled={busy}
                    onClick={() => setStage('menu')}>Back</button>}
                <button type="button" className="rc-save" disabled={busy || !reason.trim()}
                  onClick={saveReason}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          )}

          {!canEdit && !has && (
            <div className="rc-group">
              <p className="rc-none">{waived ? txn.receipt_waived_reason : 'No receipt on this line'}</p>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

import React, { useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import './quote-review-modal.css';

// Offered after a manual quote is confirmed. Lets the chief send the
// supplier a confirmation — but as a reviewed draft, not an auto-send.
// "Open draft" hands a pre-filled message to the chief's own mail
// client (mailto), so the recipient is always visible and editable and
// nothing leaves silently to a stale address (the worry with manual
// quotes, where the issuer's email often isn't the one on file).

const QuoteConfirmEmailModal = ({ boardTitle, defaultEmail, quotedTotal, itemCount, onClose }) => {
  const [to, setTo] = useState(defaultEmail || '');
  const title = boardTitle || 'our provisioning order';
  const subject = `Quote accepted — confirming order: ${boardTitle || 'provisioning order'}`;
  const body = useMemo(() => {
    // Spell out exactly what's being confirmed: the supplier's quoted
    // prices are accepted as-is, and this email is the go-ahead to
    // fulfil — nothing further is needed from us to begin.
    const scope = [
      itemCount ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : null,
      quotedTotal ? `quoted total ${quotedTotal}` : null,
    ].filter(Boolean).join(', ');
    return (
      `Hi,\n\n` +
      `We've reviewed your quote for "${title}"${scope ? ` (${scope})` : ''} and are accepting it as quoted.\n\n` +
      `This email confirms the order: please treat it as our approval to proceed at the quoted prices. ` +
      `No changes are needed and nothing further is required from us to begin fulfilment.\n\n` +
      `Please reply to confirm you've received this and let us know the delivery date and any details we should be aware of.\n\n` +
      `Many thanks.`
    );
  }, [title, quotedTotal, itemCount]);

  const openDraft = () => {
    const mailto = `mailto:${encodeURIComponent(to.trim())}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    onClose();
  };

  return (
    <div className="qrm-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="qrm qrm-panel" style={{ width: 'min(460px, 94vw)' }} onMouseDown={e => e.stopPropagation()}>
        <div className="qrm-head">
          <div>
            <p className="qrm-eyebrow">Quote confirmed</p>
            <h2 className="qrm-title">Tell the <em>supplier?</em></h2>
            <p className="qrm-sub">Optional — opens a draft in your mail app, you send it.</p>
          </div>
          <button className="qrm-close" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="qrm-body">
          <p className="qrm-section-label">Send to</p>
          <input
            className="qrm-email-input"
            type="email"
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="supplier@example.com"
          />
          <p className="qrm-email-hint">
            {defaultEmail
              ? 'Pre-filled from the supplier on file — change it if the quote came from a different address.'
              : 'No supplier email on file — enter the address the quote came from.'}
          </p>
          <div className="qrm-email-preview">
            <p className="qrm-email-subject">{subject}</p>
            <p className="qrm-email-bodyprev">{body}</p>
          </div>
        </div>

        <div className="qrm-foot">
          <button className="qrm-btn-ghost" onClick={onClose}>Skip</button>
          <button className="qrm-btn-primary" onClick={openDraft} disabled={!to.trim()}>
            <Icon name="Mail" size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />
            Open email draft
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuoteConfirmEmailModal;

// Cargo Accounts — the payment-card visual. Shared by the Department Cards page
// and the per-user reconcile card stack. A real card face: brand, EMV chip,
// last-4, holder, Mastercard mark, with a soft accent glow keyed to the funds
// type (Owner blue / Charter APA purple / general-cash green). Petty cash and
// cash render as a float rather than a card.
import React from 'react';
import './card-visual.css';

const ACCENT = { owner: '#3B6EA5', charter_apa: '#7A4FA3', general: '#3F7A52' };

export default function CardVisual({ account, size = 'md', className = '' }) {
  const a = account || {};
  const isCash = a.kind === 'petty_cash' || a.kind === 'cash';
  const accent = ACCENT[a.funds_type] || (isCash ? '#3F7A52' : '#3B6EA5');
  const typeLabel = a.kind === 'petty_cash' ? 'Petty cash'
    : a.funds_type === 'owner' ? 'Owner'
    : a.funds_type === 'charter_apa' ? 'Charter APA'
    : a.kind === 'bank' ? 'Bank' : 'General';
  const glow = `radial-gradient(circle at 82% 8%, ${accent}55, transparent 55%), radial-gradient(circle at 12% 96%, ${accent}22, transparent 45%)`;

  // Petty cash / cash render as a wallet float, not a payment card — no card
  // number, chip or Mastercard mark.
  if (isCash) {
    return (
      <div className={`cv-card cv-${size} cv-cash ${className}`}>
        <div className="cv-glow" style={{ background: glow }} />
        <div className="cv-top">
          <span className="cv-brand">PETTY CASH</span>
          <span className="cv-type">{a.currency || 'EUR'}</span>
        </div>
        <div className="cv-wallet">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M3 7a2 2 0 012-2h12a2 2 0 012 2v1H5a2 2 0 00-2 2v-3z" />
            <rect x="3" y="7" width="18" height="12" rx="2.5" />
            <path d="M16 12.5h4" /><circle cx="17" cy="12.5" r="0.6" fill="currentColor" />
          </svg>
        </div>
        <div className="cv-btm">
          <div>
            <div className="cv-holder">{(a.holder_role || 'Vessel').toUpperCase()}</div>
            <div className="cv-hsub">Ship's float</div>
          </div>
          <span className="cv-cashword">CASH</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`cv-card cv-${size} ${className}`}>
      <div className="cv-glow" style={{ background: glow }} />
      <div className="cv-top">
        <span className="cv-brand">CARGO</span>
        <span className="cv-type">{typeLabel} · {a.currency || 'EUR'}</span>
      </div>
      <div className="cv-chip" />
      <div className="cv-no">•••• •••• •••• {a.card_last4 || '0000'}</div>
      <div className="cv-btm">
        <div>
          <div className="cv-holder">{(a.holder_role || 'Vessel').toUpperCase()}</div>
          <div className="cv-hsub">{a.provider || 'Prepaid'}</div>
        </div>
        <span className="cv-mc"><i /><i /></span>
      </div>
    </div>
  );
}

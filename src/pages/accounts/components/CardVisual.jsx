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

  return (
    <div className={`cv-card cv-${size} ${isCash ? 'cv-cash' : ''} ${className}`}>
      <div className="cv-glow" style={{ background: glow }} />
      <div className="cv-top">
        <span className="cv-brand">CARGO</span>
        <span className="cv-type">{typeLabel} · {a.currency || 'EUR'}</span>
      </div>
      {isCash ? (
        <div className="cv-cashglyph">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>
        </div>
      ) : (
        <>
          <div className="cv-chip" />
          <div className="cv-no">•••• •••• •••• {a.card_last4 || '0000'}</div>
        </>
      )}
      <div className="cv-btm">
        <div>
          <div className="cv-holder">{(a.holder_role || 'Vessel').toUpperCase()}</div>
          <div className="cv-hsub">{isCash ? "Ship's float" : (a.provider || 'Prepaid')}</div>
        </div>
        {!isCash && <span className="cv-mc"><i /><i /></span>}
      </div>
    </div>
  );
}

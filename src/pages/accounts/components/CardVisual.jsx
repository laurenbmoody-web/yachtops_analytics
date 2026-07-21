// Cargo Accounts — the payment-card visual. Shared by the Department Cards page
// and the per-user reconcile card stack.
//
// A card flips (hover on desktop, and on touch where a tap has no other job) to a
// clean BACK that shows the balance + reconcile status — the flip is native to a
// card, and the back is just the total, not a fake mag-stripe. Petty cash / cash
// isn't a card, so it renders as a light "float" tile (no flip).
//
// We never hold full card details — only the last 4 for identification (see the
// note in AccountFormModal). Nothing here needs or shows a PAN, CVV or expiry.
import React from 'react';
import { formatMoney } from '../../../services/financeCalc';
import './card-visual.css';

const ACCENT = { owner: '#3B6EA5', charter_apa: '#7A4FA3', general: '#3F7A52' };
const TONE = { ok: '#6FBF8B', due: '#E8A15C', sub: '#8FB6DE' };

const coins = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <ellipse cx="8" cy="7" rx="5" ry="2.6" /><path d="M3 7v4c0 1.4 2.2 2.6 5 2.6s5-1.2 5-2.6V7" />
    <ellipse cx="16" cy="14" rx="5" ry="2.6" /><path d="M11 14v4c0 1.4 2.2 2.6 5 2.6s5-1.2 5-2.6v-4" />
  </svg>
);

export default function CardVisual({ account, balance, status, flip = 'hover', size = 'md', className = '' }) {
  const a = account || {};
  const isCash = a.kind === 'petty_cash' || a.kind === 'cash';
  const accent = ACCENT[a.funds_type] || (isCash ? '#3F7A52' : '#3B6EA5');
  const bal = balance != null ? balance : a.balance;
  const balLabel = bal != null ? formatMoney(bal, a.currency || 'EUR') : null;

  // ── cash float — a light tile, not a card ──────────────────────────────────
  if (isCash) {
    return (
      <div className={`cv-cashtile cv-${size} ${className}`}>
        <div className="cv-ct-strip" />
        <div className="cv-ct-top">
          <span className="cv-ct-lbl">Petty cash</span>
          <span className="cv-ct-ic">{coins}</span>
        </div>
        <div className="cv-ct-bottom">
          {balLabel && <div className="cv-ct-amt">{balLabel}</div>}
          <div className="cv-ct-who">Ship's float{a.holder_role ? ` · ${a.holder_role}` : ''}</div>
        </div>
      </div>
    );
  }

  // ── card — flips to its balance ────────────────────────────────────────────
  const glow = `radial-gradient(circle at 82% 8%, ${accent}55, transparent 55%)`;
  const typeLabel = a.funds_type === 'owner' ? 'Owner'
    : a.funds_type === 'charter_apa' ? 'Charter APA'
    : a.kind === 'bank' ? 'Bank' : 'General';

  return (
    <div className={`cv-flip cv-${size} ${flip === 'none' ? 'cv-noflip' : ''} ${className}`}>
      <div className="cv-flip-inner">
        {/* FRONT */}
        <div className="cv-face cv-front">
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
        {/* BACK — just the total */}
        <div className="cv-face cv-back">
          <div className="cv-glow" style={{ background: glow }} />
          <div className="cv-bk-top">
            <span className="cv-bk-id">{a.name}{a.card_last4 ? ` ····${a.card_last4}` : ''}</span>
            <span className="cv-bk-cur">{a.currency || 'EUR'}</span>
          </div>
          <div className="cv-bk-mid">
            <div className="cv-bk-lbl">Balance on card</div>
            <div className="cv-bk-amt">{balLabel || '—'}</div>
          </div>
          <div className="cv-bk-foot">
            <span>{a.holder_role || 'Vessel'}</span>
            {status?.text && <span style={{ color: TONE[status.tone] || 'rgba(255,255,255,0.6)' }}>{status.text}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

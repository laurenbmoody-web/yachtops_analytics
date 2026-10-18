import React from 'react';
import './terms-acceptance.css';

// The customer's acceptance of the Cargo Terms before payment — used on the
// website checkout (/checkout) and the in-app upgrade (/membership).
//
// Controlled: the parent owns { legalName, country, accepted } and passes
// onChange(patch). `isTermsAcceptanceValid` gates the payment button; the
// server checks the same rules and records the acceptance
// (netlify/lib/agreements.js → customer_agreements).

export const isTermsAcceptanceValid = (v) =>
  !!(v?.accepted && (v.legalName || '').trim().length >= 2 && (v.country || '').trim().length >= 2);

const TermsAcceptance = ({ value, onChange, disabled = false }) => {
  const v = value || {};
  const company = (v.legalName || '').trim();
  return (
    <div className="ta-wrap">
      <div className="ta-caps">Billed to <span className="ta-req">required</span></div>
      <p className="ta-desc">
        The company the vessel is billed to — usually the yacht’s owning or management company. Not sure? It’s
        the name on the yacht’s invoices, or ask your captain. This company becomes the customer under the Terms.
      </p>
      <div className="ta-fields">
        <label className="ta-field">
          <span className="ta-label">Owning or management company</span>
          <input
            type="text"
            value={v.legalName || ''}
            onChange={(e) => onChange({ legalName: e.target.value })}
            placeholder="e.g. Blue Water Yachting Ltd"
            autoComplete="organization"
            maxLength={200}
            disabled={disabled}
          />
        </label>
        <label className="ta-field">
          <span className="ta-label">Country of registration</span>
          <input
            type="text"
            value={v.country || ''}
            onChange={(e) => onChange({ country: e.target.value })}
            placeholder="e.g. United Kingdom"
            autoComplete="country-name"
            maxLength={100}
            disabled={disabled}
          />
        </label>
      </div>

      <label className={`ta-check${v.accepted ? ' on' : ''}`}>
        <input
          type="checkbox"
          checked={!!v.accepted}
          onChange={(e) => onChange({ accepted: e.target.checked })}
          disabled={disabled}
        />
        <span className="ta-box" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="ta-text">
          I agree to the{' '}
          <a href="/terms" target="_blank" rel="noopener noreferrer">Cargo Terms of Service</a>, including the data
          processing terms, on behalf of <b>{company || 'the company above'}</b>, and confirm I’m authorised to sign the vessel up.
          Our <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> explains how we handle
          personal data.
        </span>
      </label>
    </div>
  );
};

export default TermsAcceptance;

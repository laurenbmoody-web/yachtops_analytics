import React, { useState } from 'react';
import { Banknote } from 'lucide-react';

const SECTIONS = ['Company profile', 'Team & permissions', 'Delivery zones', 'Payment & banking', 'Tax & invoicing', 'Integrations', 'Notifications'];

const SettingsView = () => {
  const [section, setSection] = useState('Company profile');

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">Workspace · Maison Provence</div>
          <h1 className="sp-page-title">Your <em>workspace</em></h1>
          <p className="sp-page-sub">Team, delivery zones, payment terms, integrations.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 20 }}>
        {/* Settings nav */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SECTIONS.map(s => (
            <button
              key={s}
              onClick={() => setSection(s)}
              style={{
                padding: '9px 12px', borderRadius: 8, textAlign: 'left',
                fontSize: 13, fontWeight: section === s ? 600 : 400,
                color: section === s ? 'var(--fg)' : 'var(--muted-s)',
                background: section === s ? 'var(--card)' : 'transparent',
                border: section === s ? '1px solid var(--line)' : '1px solid transparent',
                cursor: 'pointer', transition: 'background 0.1s',
              }}
            >{s}</button>
          ))}
        </div>

        {/* Settings content */}
        <div className="sp-card" style={{ padding: '22px 24px' }}>
          {section === 'Company profile' && (
            <>
              <h4 style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 15, color: 'var(--fg)', letterSpacing: '-0.01em', margin: '0 0 16px', textTransform: 'none' }}>Company profile</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {[
                  ['Trading name', 'Maison Provence'],
                  ['Legal entity', 'SARL Maison Provence · 852 104 338'],
                  ['Base port', 'Antibes, FR'],
                  ['VAT number', 'FR 55 852104338'],
                ].map(([label, val]) => (
                  <div key={label}>
                    <div style={{ fontSize: 11.5, color: 'var(--muted-s)', marginBottom: 4 }}>{label}</div>
                    <div style={{ border: '1px solid var(--line)', borderRadius: 7, padding: '9px 12px', fontSize: 13, background: 'var(--bg-3)', color: 'var(--fg)' }}>{val}</div>
                  </div>
                ))}
              </div>

              <h4 style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 14, color: 'var(--fg)', letterSpacing: '-0.01em', margin: '24px 0 12px', textTransform: 'none' }}>Integrations</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: '#13B5EA', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Outfit', fontWeight: 800, fontSize: 13 }}>X</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>Xero</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted-s)' }}>Synced · 2 min ago</div>
                  </div>
                  <span className="sp-status confirmed" style={{ marginLeft: 'auto', fontSize: 11 }}><span className="d" />On</span>
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-s)' }}>
                    <Banknote size={18} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>Stripe</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted-s)' }}>Connect to accept card payment</div>
                  </div>
                  <button className="sp-pill" style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 11 }}>Connect</button>
                </div>
              </div>
            </>
          )}
          {section !== 'Company profile' && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚙</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{section}</div>
              <div style={{ fontSize: 13 }}>Coming in a future update.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsView;

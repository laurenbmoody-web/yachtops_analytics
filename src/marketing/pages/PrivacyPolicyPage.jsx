import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';
import useScrollAnimations from '../../hooks/useScrollAnimations';

// Public privacy policy. This page is the URL submitted to the Chrome Web
// Store for the "Cargo → PYA Autofill" extension, so the extension section
// must stay in-depth and accurate to the shipped manifest
// (pya-autofill-extension/manifest.json). It also covers the Cargo web app.

const LAST_UPDATED = '07/07/2026';

const sectionLabel = {
  fontWeight: 600, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase',
  color: '#4A90E2', marginBottom: 10,
};
const h2Style = {
  fontWeight: 900, fontSize: 22, color: '#1E3A5F', lineHeight: 1.2, marginBottom: 14,
};
const h3Style = {
  fontWeight: 900, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: '#1E3A5F', marginTop: 22, marginBottom: 8,
};
const bodyStyle = {
  fontWeight: 400, fontSize: 14, color: '#64748B', lineHeight: 1.75, marginBottom: 12,
};
const listStyle = {
  margin: '0 0 12px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8,
};
const listItemStyle = { fontWeight: 400, fontSize: 14, color: '#64748B', lineHeight: 1.7 };
const thStyle = {
  textAlign: 'left', padding: '10px 14px', fontWeight: 900, fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.08em', color: '#1E3A5F',
  borderBottom: '2px solid #1E3A5F', whiteSpace: 'nowrap',
};
const tdStyle = {
  padding: '10px 14px', fontWeight: 400, fontSize: 13, color: '#64748B',
  lineHeight: 1.6, borderBottom: '1px solid #E2E8F0', verticalAlign: 'top',
};

const EXTENSION_PERMISSIONS = [
  {
    permission: 'clipboardRead',
    why: 'Reads the sea-service record you copied to your clipboard using the "Copy for PYA" button in Cargo, so it can be placed into the PYA form. The clipboard is read only at the moment you click "Fill from Cargo" (or the toolbar icon) — never in the background.',
  },
  {
    permission: 'scripting',
    why: 'Injects the form-filling script into the PYA page when you trigger a fill, so the values can be typed into the form fields in your own browser tab.',
  },
  {
    permission: 'Host access: member.pya.org',
    why: 'The PYA membership site is the only site the extension can run on or interact with. It has no access to any other website you visit.',
  },
];

const Section = ({ id, label, title, children }) => (
  <section id={id} style={{ padding: '48px 32px', borderBottom: '1px solid #E2E8F0' }}>
    <div data-animate="fade-up" style={{ maxWidth: 760, margin: '0 auto' }}>
      <p className="mkt-archivo" style={sectionLabel}>{label}</p>
      <h2 className="mkt-archivo" style={h2Style}>{title}</h2>
      {children}
    </div>
  </section>
);

const PrivacyPolicyPage = () => {
  useScrollAnimations();
  return (
    <MarketingLayout>
      {/* Hero */}
      <section style={{ paddingTop: 96, paddingBottom: 48, borderBottom: '1px solid #E2E8F0', textAlign: 'center' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
          <p data-animate-hero="fade-up" data-delay="0" className="mkt-archivo" style={{ ...sectionLabel, marginBottom: 10 }}>Legal</p>
          <h1 data-animate-hero="fade-up" data-delay="0.12" className="mkt-archivo" style={{ fontWeight: 900, fontSize: 38, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1.05, marginBottom: 14 }}>
            Privacy Policy
          </h1>
          <p data-animate-hero="fade-up" data-delay="0.24" className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 15, color: '#64748B', maxWidth: 560, margin: '0 auto', lineHeight: 1.7 }}>
            How Cargo handles your information — across the Cargo web application and the
            Cargo → PYA Autofill browser extension.
          </p>
          <p data-animate-hero="fade-up" data-delay="0.3" className="mkt-dmsans" style={{ fontWeight: 500, fontSize: 12, color: '#94A3B8', marginTop: 14 }}>
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </section>

      <Section id="who-we-are" label="01" title="Who we are">
        <p className="mkt-dmsans" style={bodyStyle}>
          Cargo ("Cargo", "we", "us") is an operational platform for professional yacht
          crews, available at cargotechnology.netlify.app. We also publish the
          <strong> Cargo → PYA Autofill</strong> browser extension, which helps crew fill the
          PYA Sea Service Testimonial (SST) form from a record they have prepared in Cargo.
        </p>
        <p className="mkt-dmsans" style={bodyStyle}>
          This policy explains what information each product handles, why, and the choices
          and rights you have. We are the data controller for the personal data described
          here. Questions or requests can be sent to{' '}
          <a href="mailto:lauren.moody@hotmail.co.uk" style={{ color: '#4A90E2', textDecoration: 'none' }}>lauren.moody@hotmail.co.uk</a>.
        </p>
        <p className="mkt-dmsans" style={bodyStyle}>
          In short: we do not sell personal data, we do not run advertising, and the
          browser extension collects and transmits nothing at all.
        </p>
      </Section>

      <Section id="extension" label="02 — Browser extension" title="Cargo → PYA Autofill extension">
        <p className="mkt-dmsans" style={bodyStyle}>
          The extension has a single purpose: it fills the PYA Sea Service Testimonial form
          on <strong>member.pya.org</strong> with the sea-service record you copied from
          Cargo. This section describes everything the extension does with data. If you are
          reviewing this policy from the Chrome Web Store listing, this is the section that
          applies.
        </p>

        <h3 className="mkt-archivo" style={h3Style}>What data the extension accesses</h3>
        <p className="mkt-dmsans" style={bodyStyle}>
          The only data the extension ever reads is the <strong>text on your clipboard</strong>,
          and only at the moment you explicitly click "Fill from Cargo" (or the extension's
          toolbar icon) while on a member.pya.org page. That clipboard text is the record
          you copied in Cargo with the "Copy for PYA" button, and typically contains your
          own sea-service details: vessel name and particulars, service dates, sea-service
          day totals, capacity served, areas cruised, vessel flag, and the signatory's email
          address. Some of this is personal data about you and your signatory.
        </p>

        <h3 className="mkt-archivo" style={h3Style}>How that data is used</h3>
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}>
            The clipboard text is parsed <strong>locally in your browser</strong> and typed
            into the PYA form fields on the page in front of you. Nothing is submitted
            automatically — you review and submit the PYA form yourself.
          </li>
          <li className="mkt-dmsans" style={listItemStyle}>
            Once the fields are filled, the data is discarded. The extension keeps no copy
            in extension storage, local storage, cookies, or anywhere else.
          </li>
        </ul>

        <h3 className="mkt-archivo" style={h3Style}>What the extension does not do</h3>
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}><strong>No collection or storage</strong> — it retains no data after a fill completes.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>No transmission</strong> — it makes no network requests of its own and has no servers. Data never leaves your browser.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>No analytics or tracking</strong> — no usage analytics, no telemetry, no cookies, no identifiers.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>No background clipboard access</strong> — the clipboard is read only when you trigger a fill, never passively.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>No access to other sites</strong> — it runs only on member.pya.org and cannot see your browsing anywhere else.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>No selling or sharing</strong> — there is nothing collected, so nothing is ever sold, shared, or transferred to anyone, for any purpose.</li>
        </ul>

        <h3 className="mkt-archivo" style={h3Style}>Permissions it requests, and why</h3>
        <div style={{ overflowX: 'auto', margin: '4px 0 12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', border: '2px solid #1E3A5F', borderRadius: 12 }}>
            <thead>
              <tr>
                <th className="mkt-archivo" style={thStyle}>Permission</th>
                <th className="mkt-archivo" style={thStyle}>Why it's needed</th>
              </tr>
            </thead>
            <tbody>
              {EXTENSION_PERMISSIONS.map(({ permission, why }) => (
                <tr key={permission}>
                  <td className="mkt-dmsans" style={{ ...tdStyle, fontWeight: 500, color: '#1E3A5F', whiteSpace: 'nowrap' }}>{permission}</td>
                  <td className="mkt-dmsans" style={tdStyle}>{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mkt-archivo" style={h3Style}>Limited use</h3>
        <p className="mkt-dmsans" style={bodyStyle}>
          The extension's use of data obtained through browser permissions is limited to
          providing its single, user-visible purpose: filling the PYA SST form at your
          request. It complies with the Chrome Web Store User Data Policy, including its
          Limited Use requirements. Data is never used for advertising, credit-worthiness
          assessment, or transferred to third parties — there are no exceptions, because no
          data is retained or transmitted in the first place.
        </p>

        <h3 className="mkt-archivo" style={h3Style}>Retention</h3>
        <p className="mkt-dmsans" style={bodyStyle}>
          None. The extension retains no data between fills. Uninstalling it removes the
          extension code; there is no stored data to remove.
        </p>
      </Section>

      <Section id="web-app" label="03 — Web application" title="The Cargo web application">
        <p className="mkt-dmsans" style={bodyStyle}>
          The Cargo web application is a separate product from the extension: it is the
          vessel-operations platform where crews manage inventory, provisioning, crew
          records, guest preferences, trips, and sea time. Using it requires an account, and
          it necessarily stores the data your vessel puts into it.
        </p>
        <h3 className="mkt-archivo" style={h3Style}>What we store</h3>
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Account data</strong> — your name, email address, role, and authentication credentials (passwords are hashed; we never see them in plain text).</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Operational data</strong> — the records your vessel creates in Cargo: inventory, provisioning orders, crew and rota records, guest preference profiles, sea-service records, documents, and similar.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Service records</strong> — technical logs needed to run and secure the service, such as sign-in events.</li>
        </ul>
        <h3 className="mkt-archivo" style={h3Style}>How it's used and kept</h3>
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}>Data is used only to provide the Cargo service to you and your vessel. We do not sell it, rent it, or use it for advertising.</li>
          <li className="mkt-dmsans" style={listItemStyle}>Every vessel operates in isolation — your vessel's data is separated at the database level with row-level security, not just behind a login screen.</li>
          <li className="mkt-dmsans" style={listItemStyle}>Data is hosted with trusted infrastructure providers (Supabase for the database and authentication, Netlify for the application), who process it on our behalf under their own security and data-processing commitments.</li>
          <li className="mkt-dmsans" style={listItemStyle}>Emails we send (invites, order confirmations, notifications) are delivered through a transactional email provider using the minimum data required — typically your name and email address.</li>
          <li className="mkt-dmsans" style={listItemStyle}>Payments are handled by Stripe; card details go directly to Stripe and never touch our servers.</li>
          <li className="mkt-dmsans" style={listItemStyle}>Account and vessel data is kept while the account is active, and deleted or anonymised on verified request or account closure, except where we must keep it to meet legal obligations.</li>
        </ul>
      </Section>

      <Section id="your-rights" label="04" title="Your rights">
        <p className="mkt-dmsans" style={bodyStyle}>
          Where UK or EU data-protection law (GDPR) applies, you have the right to access
          the personal data we hold about you, to have it corrected or deleted, to restrict
          or object to its processing, and to receive a portable copy. You can exercise any
          of these by emailing{' '}
          <a href="mailto:lauren.moody@hotmail.co.uk" style={{ color: '#4A90E2', textDecoration: 'none' }}>lauren.moody@hotmail.co.uk</a>.
          You also have the right to complain to your supervisory authority — in the UK,
          the Information Commissioner's Office (ico.org.uk).
        </p>
        <p className="mkt-dmsans" style={bodyStyle}>
          For the browser extension these rights rarely arise in practice, because it holds
          no data about you — but they apply all the same.
        </p>
        <p className="mkt-dmsans" style={bodyStyle}>
          Cargo is a professional tool for working crew and is not directed at children
          under 16. We do not knowingly collect data from children.
        </p>
      </Section>

      <Section id="changes" label="05" title="Changes to this policy">
        <p className="mkt-dmsans" style={bodyStyle}>
          If we change how either product handles data, we will update this page and the
          "Last updated" date above. Material changes to the extension's data practices
          would also be reflected in its Chrome Web Store listing before they take effect.
        </p>
        <p className="mkt-dmsans" style={{ ...bodyStyle, marginBottom: 0 }}>
          Questions about any of this? <Link to="/contact" style={{ color: '#4A90E2', textDecoration: 'none' }}>Get in touch</Link> or
          email <a href="mailto:lauren.moody@hotmail.co.uk" style={{ color: '#4A90E2', textDecoration: 'none' }}>lauren.moody@hotmail.co.uk</a>.
        </p>
      </Section>
    </MarketingLayout>
  );
};

export default PrivacyPolicyPage;

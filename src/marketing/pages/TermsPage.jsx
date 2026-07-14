import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';
import useScrollAnimations from '../../hooks/useScrollAnimations';

// Public Terms of Service for the Cargo web application. Mirrors the visual
// structure of PrivacyPolicyPage. This is the agreement that governs use of the
// Cargo service; it should be reviewed by legal counsel before launch.

const LAST_UPDATED = '14/07/2026';

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
const linkStyle = { color: '#4A90E2', textDecoration: 'none' };

const Section = ({ id, label, title, children }) => (
  <section id={id} style={{ padding: '48px 32px', borderBottom: '1px solid #E2E8F0' }}>
    <div data-animate="fade-up" style={{ maxWidth: 760, margin: '0 auto' }}>
      <p className="mkt-archivo" style={sectionLabel}>{label}</p>
      <h2 className="mkt-archivo" style={h2Style}>{title}</h2>
      {children}
    </div>
  </section>
);

const TermsPage = () => {
  useScrollAnimations();
  return (
    <MarketingLayout>
      {/* Hero */}
      <section style={{ paddingTop: 96, paddingBottom: 48, borderBottom: '1px solid #E2E8F0', textAlign: 'center' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 32px' }}>
          <p data-animate-hero="fade-up" data-delay="0" className="mkt-archivo" style={{ ...sectionLabel, marginBottom: 10 }}>Legal</p>
          <h1 data-animate-hero="fade-up" data-delay="0.12" className="mkt-archivo" style={{ fontWeight: 900, fontSize: 38, textTransform: 'uppercase', color: '#1E3A5F', lineHeight: 1.05, marginBottom: 14 }}>
            Terms of Service
          </h1>
          <p data-animate-hero="fade-up" data-delay="0.24" className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 15, color: '#64748B', maxWidth: 560, margin: '0 auto', lineHeight: 1.7 }}>
            The agreement between you and Cargo for use of the Cargo web application.
          </p>
          <p data-animate-hero="fade-up" data-delay="0.3" className="mkt-dmsans" style={{ fontWeight: 500, fontSize: 12, color: '#94A3B8', marginTop: 14 }}>
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </section>

      <Section id="agreement" label="01" title="Agreement to these terms">
        <p className="mkt-dmsans" style={bodyStyle}>
          These Terms of Service ("Terms") are a legal agreement between you and Cargo
          ("Cargo", "we", "us") governing your access to and use of the Cargo web
          application and related services (together, the "Service"). By creating an
          account, joining a vessel, or otherwise using the Service, you agree to these
          Terms. If you are using the Service on behalf of a vessel, company, or other
          organisation, you confirm that you are authorised to accept these Terms on its
          behalf.
        </p>
        <p className="mkt-dmsans" style={bodyStyle}>
          If you do not agree to these Terms, do not use the Service.
        </p>
      </Section>

      <Section id="service" label="02" title="The Cargo service">
        <p className="mkt-dmsans" style={bodyStyle}>
          Cargo is an operational platform for professional yacht crews. It helps crews
          manage inventory, provisioning, crew records, rotas and hours of rest, guest
          preferences, trips, documents, and sea-service records. We may add, change, or
          remove features over time to improve the Service.
        </p>
        <p className="mkt-dmsans" style={bodyStyle}>
          The Service is provided on a subscription basis to a vessel. Access to features
          depends on your role and permissions on the vessel you belong to, and on the
          vessel's subscription.
        </p>
      </Section>

      <Section id="accounts" label="03" title="Accounts &amp; eligibility">
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}>You must provide accurate account information and keep it up to date.</li>
          <li className="mkt-dmsans" style={listItemStyle}>You are responsible for keeping your sign-in credentials secure and for all activity under your account. We offer two-factor authentication and passkeys, and we recommend using them.</li>
          <li className="mkt-dmsans" style={listItemStyle}>Cargo is a professional tool for working crew and is not directed at children under 16. You must be old enough to enter a binding contract to use it.</li>
          <li className="mkt-dmsans" style={listItemStyle}>Your Cargo account is personal to you and travels with you between vessels. Your role, permissions, and access to a vessel's data are granted by that vessel's Command tier and end when your membership ends.</li>
        </ul>
      </Section>

      <Section id="data" label="04" title="Your vessel, your data">
        <p className="mkt-dmsans" style={bodyStyle}>
          You (and your vessel) retain ownership of the data you put into the Service. You
          grant us the limited rights needed to host, process, and display that data in
          order to provide the Service to you.
        </p>
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}>Each vessel operates in isolation — a vessel's data is separated at the database level with row-level security, not just behind a login screen.</li>
          <li className="mkt-dmsans" style={listItemStyle}>You are responsible for the data your vessel enters, including crew and guest personal data, and for having a lawful basis to enter and share it within the vessel.</li>
          <li className="mkt-dmsans" style={listItemStyle}>Our handling of personal data is described in our <Link to="/privacy" style={linkStyle}>Privacy Policy</Link>, which forms part of these Terms.</li>
          <li className="mkt-dmsans" style={listItemStyle}>You are responsible for keeping your own records where you are legally required to (for example, statutory or flag-state records). Cargo is a tool to help you manage them, not a substitute for your legal record-keeping obligations.</li>
        </ul>
      </Section>

      <Section id="acceptable-use" label="05" title="Acceptable use">
        <p className="mkt-dmsans" style={bodyStyle}>You agree not to:</p>
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}>use the Service unlawfully, or to store or share content you have no right to;</li>
          <li className="mkt-dmsans" style={listItemStyle}>attempt to access data belonging to another vessel or user, or to bypass the Service's security or access controls;</li>
          <li className="mkt-dmsans" style={listItemStyle}>interfere with or disrupt the Service, or probe, scan, or test its vulnerabilities without our written permission;</li>
          <li className="mkt-dmsans" style={listItemStyle}>reverse-engineer, copy, resell, or sublicense the Service except as permitted by law;</li>
          <li className="mkt-dmsans" style={listItemStyle}>upload malware, or use the Service to send spam or harass others.</li>
        </ul>
      </Section>

      <Section id="billing" label="06" title="Subscriptions, billing &amp; cancellation">
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}>Paid subscriptions are billed in advance on a recurring basis through our payment processor, Stripe. Card details go directly to Stripe and never touch our servers.</li>
          <li className="mkt-dmsans" style={listItemStyle}>Fees are charged to the vessel's billing account. Subscriptions renew automatically until cancelled.</li>
          <li className="mkt-dmsans" style={listItemStyle}>You can cancel at any time; cancellation takes effect at the end of the current billing period, and the Service remains available until then.</li>
          <li className="mkt-dmsans" style={listItemStyle}>Except where required by law, fees already paid are non-refundable. We will give reasonable notice of any change to fees.</li>
        </ul>
      </Section>

      <Section id="ip" label="07" title="Intellectual property">
        <p className="mkt-dmsans" style={bodyStyle}>
          The Service, including its software, design, and branding, is owned by Cargo and
          protected by intellectual-property laws. We grant you a limited, non-exclusive,
          non-transferable right to use the Service in accordance with these Terms. These
          Terms do not transfer any ownership in the Service to you.
        </p>
      </Section>

      <Section id="availability" label="08" title="Availability &amp; changes">
        <p className="mkt-dmsans" style={bodyStyle}>
          We work to keep the Service available and reliable, but we do not guarantee
          uninterrupted or error-free operation. We may perform maintenance, update
          features, or suspend parts of the Service where reasonably necessary. We may also
          change or discontinue features, giving reasonable notice of material changes that
          adversely affect you.
        </p>
      </Section>

      <Section id="liability" label="09" title="Disclaimers &amp; limitation of liability">
        <p className="mkt-dmsans" style={bodyStyle}>
          The Service is provided "as is" and "as available". To the fullest extent
          permitted by law, we exclude all implied warranties. Cargo helps you manage
          compliance-related records (such as hours of rest and sea service), but you remain
          responsible for meeting your own legal, statutory, and flag-state obligations, and
          for verifying the accuracy of your records.
        </p>
        <p className="mkt-dmsans" style={bodyStyle}>
          To the fullest extent permitted by law, we are not liable for indirect or
          consequential loss, loss of profit, or loss of data, and our total liability
          arising out of or in connection with the Service is limited to the amount you paid
          us for the Service in the twelve months before the event giving rise to the claim.
          Nothing in these Terms limits liability that cannot be limited by law.
        </p>
      </Section>

      <Section id="termination" label="10" title="Suspension &amp; termination">
        <p className="mkt-dmsans" style={bodyStyle}>
          You may stop using the Service and close your account at any time from Settings.
          We may suspend or terminate access if you breach these Terms, if required by law,
          or to protect the Service or other users. On termination, your right to use the
          Service ends. Provisions that by their nature should survive — including data
          ownership, intellectual property, and limitation of liability — continue to apply.
        </p>
        <p className="mkt-dmsans" style={bodyStyle}>
          When you leave a vessel, your personal record travels with you; the vessel retains
          only the records it is legally required to keep, as described in our{' '}
          <Link to="/privacy" style={linkStyle}>Privacy Policy</Link>.
        </p>
      </Section>

      <Section id="governing-law" label="11" title="Governing law">
        <p className="mkt-dmsans" style={bodyStyle}>
          These Terms are governed by the laws of England and Wales, and the courts of
          England and Wales have exclusive jurisdiction over any dispute, unless mandatory
          law in your country of residence requires otherwise.
        </p>
      </Section>

      <Section id="changes" label="12" title="Changes to these terms">
        <p className="mkt-dmsans" style={bodyStyle}>
          We may update these Terms from time to time. If we make material changes, we will
          update this page and the "Last updated" date above, and, where appropriate, notify
          you in the Service. Continuing to use the Service after changes take effect means
          you accept the updated Terms.
        </p>
        <p className="mkt-dmsans" style={{ ...bodyStyle, marginBottom: 0 }}>
          Questions about these Terms? <Link to="/contact" style={linkStyle}>Get in touch</Link> or
          email <a href="mailto:legal@cargotechnology.co.uk" style={linkStyle}>legal@cargotechnology.co.uk</a>.
        </p>
      </Section>
    </MarketingLayout>
  );
};

export default TermsPage;

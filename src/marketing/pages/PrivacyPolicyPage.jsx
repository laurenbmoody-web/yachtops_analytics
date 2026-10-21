import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout from '../MarketingLayout';
import useScrollAnimations from '../../hooks/useScrollAnimations';

// Public privacy policy. This page is the URL submitted to the Chrome Web
// Store for the "Cargo → PYA Autofill" extension, so the extension section
// must stay in-depth and accurate to the shipped manifest
// (pya-autofill-extension/manifest.json). It also covers the Cargo web app.

const LAST_UPDATED = '21/10/2026';

// The company behind Cargo. Keep in sync with TermsPage and MarketingFooter.
const COMPANY = {
  name: 'Cargo Technology Ltd',
  number: '17525300',
  office: '71-75 Shelton Street, Covent Garden, London, WC2H 9JQ, United Kingdom',
  ico: 'ZC277729',
};

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

// Every outside service the Cargo web app sends personal data to. Keep this in
// step with the code: adding an integration that receives personal data means
// adding a row here and updating LAST_UPDATED.
const SERVICE_PROVIDERS = [
  { name: 'Supabase', role: 'Database, sign-in and file storage', data: 'All account and vessel data. Hosted in the EU (Ireland).' },
  { name: 'Netlify', role: 'Hosting the app and some server functions', data: 'Requests to the app, including IP address; data passed to the functions listed below.' },
  { name: 'Anthropic', role: 'AI reading of documents and photos, drafting and insights', data: 'Crew documents (passports, IDs, visas, medical and STCW certificates), contracts, receipts, delivery notes, supplier certificates, inventory, garment and laundry photos and care labels, guest preferences and allergies, hours-of-rest summaries, messages you ask it to turn into quotes.' },
  { name: 'OpenAI', role: 'AI reading of inventory imports', data: 'Inventory import files you upload.' },
  { name: 'Microsoft Azure', role: 'Document reading (Document Intelligence) and invoice parsing', data: 'Delivery notes, receipts, supplier invoices and price lists.' },
  { name: 'fal.ai', role: 'Image processing', data: 'Uniform and garment photos (background removal) and deck plans, only when you use those tools.' },
  { name: 'PDFShift', role: 'Creating PDF documents', data: 'Orders, invoices, receipts and delivery notes, including names, addresses and signatures.' },
  { name: 'Resend', role: 'Sending email', data: 'Names, email addresses and email content, including hours-of-rest reports sent to your management company.' },
  { name: 'Stripe', role: 'Subscription and supplier payments', data: 'Billing email, vessel name and payment details. Card details go straight to Stripe.' },
  { name: 'Plaid', role: 'Connecting vessel bank accounts', data: 'Bank account and transaction data, only if your vessel connects a bank account.' },
  { name: 'Google', role: 'Maps, product image search and Android notifications', data: 'IP address and map locations (marketplace map only), product names and notification text.' },
  { name: 'Apple', role: 'iPhone and iPad notifications', data: 'Device token and notification text.' },
  { name: 'Data Docked', role: 'Vessel position (AIS)', data: 'Your vessel’s MMSI or IMO number. It returns the vessel’s position.' },
  { name: 'BigDataCloud and Open-Meteo', role: 'Place names and weather on the dashboard', data: 'Approximate location (latitude and longitude) and IP address.' },
  { name: 'OpenStreetMap (Nominatim)', role: 'Address lookup in the marketplace', data: 'Addresses you search for.' },
  { name: 'ipify', role: 'Signature audit trail', data: 'Your IP address, recorded when you sign hours of rest.' },
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
            How Cargo Technology Ltd handles your information across the Cargo web
            application and the Cargo → PYA Autofill browser extension.
          </p>
          <p data-animate-hero="fade-up" data-delay="0.3" className="mkt-dmsans" style={{ fontWeight: 500, fontSize: 12, color: '#94A3B8', marginTop: 14 }}>
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </section>

      {/* Reviewer notice — the Chrome Web Store reviewer reaches this page from
          the extension listing. Make the separation unmissable at the top so the
          web-app data-handling section below is never mistaken for the
          extension's, which collects nothing. */}
      <section style={{ padding: '28px 32px 0' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div
            role="note"
            style={{
              backgroundColor: '#EFF5FC', border: '2px solid #1E3A5F', borderRadius: 12,
              padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            <p className="mkt-archivo" style={{ fontWeight: 900, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#1E3A5F', margin: 0 }}>
              Note for the Chrome Web Store extension
            </p>
            <p className="mkt-dmsans" style={{ fontWeight: 400, fontSize: 14, color: '#334155', lineHeight: 1.65, margin: 0 }}>
              This page covers two separate products. The <strong>Cargo → PYA Autofill browser
              extension</strong> collects, stores, and transmits <strong>nothing</strong> — it
              only reads the record you copied, on your click, to fill the PYA form in your own
              browser. The data handling described in the web-application section below applies
              to the Cargo web app, <strong>not</strong> to the extension.{' '}
              <a href="#extension" style={{ color: '#4A90E2', textDecoration: 'none', fontWeight: 500 }}>
                Jump to the extension section →
              </a>
            </p>
          </div>
        </div>
      </section>

      <Section id="who-we-are" label="01" title="Who we are">
        <p className="mkt-dmsans" style={bodyStyle}>
          Cargo is run by <strong>{COMPANY.name}</strong>, a company registered in England
          and Wales (company number {COMPANY.number}). Our registered office is {COMPANY.office}.
          We are registered with the UK Information Commissioner’s Office as a data controller
          (registration number {COMPANY.ico}). In this policy "Cargo", "we" and "us" mean {COMPANY.name}.
        </p>
        <p className="mkt-dmsans" style={bodyStyle}>
          Cargo is an operational platform for professional yacht crews, available at
          cargotechnology.co.uk and in the Cargo app for iPhone, iPad and Android. We
          also publish the <strong>Cargo → PYA Autofill</strong> browser extension, which helps
          crew fill the PYA Sea Service Testimonial (SST) form from a record they have
          prepared in Cargo.
        </p>
        <p className="mkt-dmsans" style={bodyStyle}>
          Questions or requests about your data can be sent to{' '}
          <a href="mailto:privacy@cargotechnology.co.uk" style={{ color: '#4A90E2', textDecoration: 'none' }}>privacy@cargotechnology.co.uk</a>.
          In short: we do not sell personal data, we do not run advertising, and the browser
          extension collects and transmits nothing at all.
        </p>

        <h3 className="mkt-archivo" style={h3Style}>Who is responsible for your data</h3>
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Your own account and personal record</strong> — your profile, contact details, the documents you upload to your own record, and your sea-service history. You keep this record when you move between vessels. We are the <strong>controller</strong> of this data.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>A vessel’s records</strong> — guest profiles, rotas and hours of rest, inventory, provisioning, laundry, accounts and other records a vessel keeps in Cargo. The vessel (usually its owning or management company) is the <strong>controller</strong> and decides what is recorded and why. We are its <strong>processor</strong>: we hold and process that data only to provide Cargo to the vessel, under the data processing terms in our <Link to="/terms" style={{ color: '#4A90E2', textDecoration: 'none' }}>Terms of Service</Link>.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Billing and website enquiries</strong> — we are the controller.</li>
        </ul>
        <p className="mkt-dmsans" style={bodyStyle}>
          If you are a guest or crew member asking about a vessel’s records, contact that
          vessel first. We will help them answer you, and you can always contact us.
        </p>
      </Section>

      <Section id="web-app" label="02 — Web application" title="What the Cargo app stores">
        <p className="mkt-dmsans" style={bodyStyle}>
          The Cargo app is where crews manage inventory, provisioning, crew records, guest
          preferences, trips, laundry, accounts and sea time. Using it requires an account,
          and it stores the data your vessel puts into it. The PYA Autofill browser
          extension, covered further down, is a separate product that stores nothing.
        </p>
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Account data</strong> — your name, email address, role and sign-in details. Passwords are hashed; we never see them in plain text.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Crew records</strong> — contact details, date of birth, nationality, next of kin, employment details, rotas and hours of rest, uniform and kit, certificates and identity documents, sea-service records and, where a vessel uses them, bank details for payroll.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Guest records</strong> — names, preferences, special dates, travel and passport details, and notes the crew add to look after guests.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Operational data</strong> — inventory, provisioning orders, supplier details, invoices, receipts, delivery notes and signatures, laundry items and photos, defects and jobs.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Location</strong> — your vessel’s position from AIS, and your device’s location only when you allow it (for the dashboard weather, or live delivery tracking in the marketplace).</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Service records</strong> — technical logs needed to run and secure the service, such as sign-in events and, for signatures, the IP address and browser used.</li>
        </ul>
        <h3 className="mkt-archivo" style={h3Style}>How it’s used</h3>
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}>Data is used only to provide Cargo to you and your vessel. We do not sell it, rent it, or use it for advertising.</li>
          <li className="mkt-dmsans" style={listItemStyle}>Our legal basis is the contract with you or your vessel, our legitimate interest in running and securing the service, and, where we say so, your consent.</li>
          <li className="mkt-dmsans" style={listItemStyle}>Every vessel operates in isolation: its data is separated at the database level with row-level security, not just behind a login screen.</li>
        </ul>
      </Section>

      <Section id="sensitive-data" label="03" title="Sensitive information">
        <p className="mkt-dmsans" style={bodyStyle}>
          Some information in Cargo is given extra protection under UK and EU data
          protection law. We only hold it because a vessel or crew member chooses to record
          it, and access is limited by role on the vessel.
        </p>
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Health information</strong> — guest allergies and health conditions, and crew medical conditions, allergies and blood type, recorded so crew can keep people safe on board. Medical certificates (such as ENG1) are stored as crew documents.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Face sign-in</strong> — if a vessel turns on gangway face sign-in and you choose to enrol, your device turns photos of your face into a numeric template. Photos are not stored; only the template is. Enrolment needs your explicit consent, which is recorded. You can delete your template at any time in Settings, and it is deleted automatically when you leave the vessel or delete your account.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Identity documents and bank details</strong> — passports, IDs and visas, and crew bank details, visible only to the crew member and the vessel roles allowed to see them.</li>
        </ul>
      </Section>

      <Section id="providers" label="04" title="Who we share data with">
        <p className="mkt-dmsans" style={bodyStyle}>
          We use the service providers below to run Cargo. They process data on our behalf
          under data processing terms, only for the purpose listed. Our AI providers
          (Anthropic, OpenAI and Microsoft Azure) do not use data sent through their business
          APIs to train their models. We do not share data with anyone else unless the law
          requires it, or your vessel asks us to (for example, emailing a report to its
          management company).
        </p>
        <div style={{ overflowX: 'auto', margin: '4px 0 12px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', border: '2px solid #1E3A5F', borderRadius: 12 }}>
            <thead>
              <tr>
                <th className="mkt-archivo" style={thStyle}>Provider</th>
                <th className="mkt-archivo" style={thStyle}>What for</th>
                <th className="mkt-archivo" style={thStyle}>What it receives</th>
              </tr>
            </thead>
            <tbody>
              {SERVICE_PROVIDERS.map(({ name, role, data }) => (
                <tr key={name}>
                  <td className="mkt-dmsans" style={{ ...tdStyle, fontWeight: 500, color: '#1E3A5F' }}>{name}</td>
                  <td className="mkt-dmsans" style={tdStyle}>{role}</td>
                  <td className="mkt-dmsans" style={tdStyle}>{data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="mkt-archivo" style={h3Style}>International transfers</h3>
        <p className="mkt-dmsans" style={bodyStyle}>
          Our main database is in the EU. Several providers above, including Anthropic,
          OpenAI, Stripe, Plaid, Resend, Netlify and Google, are based in or process data in
          the United States. Where data leaves the UK or EEA we rely on the UK–US data bridge
          where the provider is certified, or on the standard contractual clauses approved
          for UK and EU transfers.
        </p>
      </Section>

      <Section id="retention" label="05" title="How long we keep data">
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Your account</strong> — kept while you have an account. When you delete it in Settings, we erase your profile, your personal records and your uploaded personal files, and sign you out everywhere.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Vessel records</strong> — kept while the vessel subscribes, and for as long as the vessel instructs us. Records a vessel must keep by law, such as hours of rest and signed kit receipts, stay with the vessel after you leave or delete your account.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>When a vessel leaves Cargo</strong> — we keep its data for 90 days so it can be exported or the subscription restarted, then delete it, unless the vessel asks us to delete it sooner.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Laundry photos</strong> — a vessel can set how long these are kept; older photos are then deleted automatically.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Billing records</strong> — kept for six years, as UK tax law requires.</li>
        </ul>
      </Section>

      <Section id="cookies" label="06" title="Cookies &amp; storage">
        <p className="mkt-dmsans" style={bodyStyle}>
          Cargo uses only the storage it needs to run. There are no advertising cookies and
          no cross-site tracking.
        </p>
        <h3 className="mkt-archivo" style={h3Style}>What we use</h3>
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Essential cookies &amp; tokens</strong> — used to keep you securely signed in (your authentication session). Without these you can't stay logged in.</li>
          <li className="mkt-dmsans" style={listItemStyle}><strong>Local storage</strong> — kept in your browser to remember preferences and app state, such as your active vessel, theme, and dashboard layout. It stays on your device.</li>
        </ul>
        <h3 className="mkt-archivo" style={h3Style}>What we don't use</h3>
        <ul style={listStyle}>
          <li className="mkt-dmsans" style={listItemStyle}>No advertising or marketing cookies.</li>
          <li className="mkt-dmsans" style={listItemStyle}>No analytics, third-party tracking or cross-site profiling.</li>
        </ul>
        <h3 className="mkt-archivo" style={h3Style}>Third-party content</h3>
        <p className="mkt-dmsans" style={bodyStyle}>
          Our fonts are hosted by us, not loaded from Google. The marketplace map is provided
          by Google Maps, so when you open it your browser connects to Google, which shares
          your IP address with Google.
        </p>
        <h3 className="mkt-archivo" style={h3Style}>Managing them</h3>
        <p className="mkt-dmsans" style={bodyStyle}>
          Because we only use storage that's strictly necessary to provide the Service, there
          is nothing non-essential to opt out of. You can clear cookies and local storage in
          your browser settings at any time — doing so will sign you out and reset your saved
          preferences. The browser extension, described below, uses no cookies or storage at all.
        </p>
      </Section>

      <Section id="extension" label="07 — Browser extension" title="Cargo → PYA Autofill extension">
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

      <Section id="your-rights" label="08" title="Your rights">
        <p className="mkt-dmsans" style={bodyStyle}>
          Where UK or EU data-protection law (GDPR) applies, you have the right to access
          the personal data we hold about you, to have it corrected or deleted, to restrict
          or object to its processing, and to receive a portable copy. You can exercise any
          of these by emailing{' '}
          <a href="mailto:privacy@cargotechnology.co.uk" style={{ color: '#4A90E2', textDecoration: 'none' }}>privacy@cargotechnology.co.uk</a>.
          You can also delete your account yourself, or download a copy of your personal
          data, from Settings in the app. For records a vessel controls, we will pass your
          request to the vessel and help it respond.
        </p>
        <p className="mkt-dmsans" style={bodyStyle}>
          Where we rely on your consent, such as face sign-in, you can withdraw it at any
          time. You also have the right to complain to a supervisory authority. Ours is the
          UK Information Commissioner’s Office (ico.org.uk); if you are in the EU you can
          also contact your local authority.
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

      <Section id="changes" label="09" title="Changes to this policy">
        <p className="mkt-dmsans" style={bodyStyle}>
          If we change how either product handles data, we will update this page and the
          "Last updated" date above. Material changes to the extension's data practices
          would also be reflected in its Chrome Web Store listing before they take effect.
        </p>
        <p className="mkt-dmsans" style={{ ...bodyStyle, marginBottom: 0 }}>
          Questions about any of this? <Link to="/contact" style={{ color: '#4A90E2', textDecoration: 'none' }}>Get in touch</Link> or
          email <a href="mailto:privacy@cargotechnology.co.uk" style={{ color: '#4A90E2', textDecoration: 'none' }}>privacy@cargotechnology.co.uk</a>.
        </p>
      </Section>
    </MarketingLayout>
  );
};

export default PrivacyPolicyPage;

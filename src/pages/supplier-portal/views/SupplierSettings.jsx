import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Save } from 'lucide-react';
import { useSupplier } from '../../../contexts/SupplierContext';
import { updateSupplierProfile } from '../utils/supplierStorage';
import { getSupplierTier } from '../../../components/SupplierRoleGuard';

// Tab order per spec. adminOnly tabs are hidden from managers.
const ALL_TABS = [
  { slug: 'company',       label: 'Company profile',    adminOnly: false },
  { slug: 'team',          label: 'Team & permissions',  adminOnly: false },
  { slug: 'zones',         label: 'Delivery zones',      adminOnly: false },
  { slug: 'tax',           label: 'Tax & invoicing',     adminOnly: false },
  { slug: 'payment',       label: 'Payment & banking',   adminOnly: true  },
  { slug: 'documents',     label: 'Documents & legal',   adminOnly: true  },
  { slug: 'integrations',  label: 'Integrations',        adminOnly: true  },
  { slug: 'notifications', label: 'Notifications',       adminOnly: false },
];

const Field = ({ label, value, onChange, type = 'text', readOnly = false }) => (
  <div>
    <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>{label}</label>
    <input
      type={type}
      value={value ?? ''}
      onChange={onChange ? e => onChange(e.target.value) : undefined}
      readOnly={readOnly}
      style={{
        width: '100%',
        border: '1px solid var(--line)',
        borderRadius: 7,
        padding: '9px 12px',
        fontSize: 13,
        background: readOnly ? 'var(--bg-3)' : 'var(--card)',
        color: 'var(--fg)',
        fontFamily: 'inherit',
      }}
    />
  </div>
);

const SupplierSettings = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { supplier, contact, refreshSupplier } = useSupplier();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const tier = getSupplierTier(contact?.role);
  const isAdmin = tier === 'admin';

  // Tabs visible to the current role
  const visibleTabs = ALL_TABS.filter(t => isAdmin || !t.adminOnly);

  // Derive active slug from URL
  const pathSlug = location.pathname.split('/').pop();
  const activeTab = visibleTabs.find(t => t.slug === pathSlug) ?? visibleTabs[0];
  const activeSlug = activeTab.slug;
  const activeLabel = activeTab.label;

  React.useEffect(() => {
    if (supplier && !form) {
      setForm({
        name:                  supplier.name ?? '',
        description:           supplier.description ?? '',
        contact_email:         supplier.contact_email ?? '',
        contact_phone:         supplier.contact_phone ?? '',
        website:               supplier.website ?? '',
        payment_terms_default: supplier.payment_terms_default ?? '30 days',
      });
    }
  }, [supplier]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateSupplierProfile(supplier.id, form);
      await refreshSupplier();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!supplier || !form) {
    return (
      <div className="sp-page">
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">Workspace · {supplier.name}</div>
          <h1 className="sp-page-title">Workspace <em>profile</em></h1>
          <p className="sp-page-sub">Team, delivery zones, payment terms, integrations.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 20 }}>
        {/* Tab nav — each item links to its own URL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visibleTabs.map(({ slug, label }) => (
            <button
              key={slug}
              onClick={() => navigate(`/supplier/workspace/${slug}`)}
              style={{
                padding: '9px 12px', borderRadius: 8, textAlign: 'left',
                fontSize: 13, fontWeight: activeSlug === slug ? 600 : 400,
                color: activeSlug === slug ? 'var(--fg)' : 'var(--muted-s)',
                background: activeSlug === slug ? 'var(--card)' : 'transparent',
                border: activeSlug === slug ? '1px solid var(--line)' : '1px solid transparent',
                cursor: 'pointer', transition: 'background 0.1s',
              }}
            >{label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div className="sp-card" style={{ padding: '22px 24px' }}>
          {activeSlug === 'company' ? (
            <>
              <h4 style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 15, color: 'var(--fg)', margin: '0 0 16px' }}>Company profile</h4>

              {error && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13, color: 'var(--red)' }}>
                  {error}
                </div>
              )}
              {saved && (
                <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13, color: 'var(--green)' }}>
                  Profile updated successfully.
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
                <Field label="Trading name"    value={form.name}                  onChange={v => set('name', v)} />
                <Field label="Contact email"   value={form.contact_email}          onChange={v => set('contact_email', v)} type="email" />
                <Field label="Contact phone"   value={form.contact_phone}          onChange={v => set('contact_phone', v)} />
                <Field label="Website"         value={form.website}                onChange={v => set('website', v)} />
                <Field label="Payment terms"   value={form.payment_terms_default}  onChange={v => set('payment_terms_default', v)} />
                <Field label="Supplier ID"     value={supplier.id}                readOnly />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 11.5, color: 'var(--muted-s)', display: 'block', marginBottom: 4 }}>Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 7, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="sp-pill primary" style={{ padding: '9px 20px' }} onClick={handleSave} disabled={saving}>
                  <Save size={13} />{saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </>
          ) : activeSlug === 'documents' ? (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>🛡</div>
              <div style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 15, color: 'var(--fg)', marginBottom: 6 }}>Documents & legal</div>
              <div style={{ fontSize: 13, color: 'var(--muted-strong)', maxWidth: 360, margin: '0 auto', lineHeight: 1.5 }}>
                Manage certifications, agreements, and compliance documents. Coming soon.
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚙</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{activeLabel}</div>
              <div style={{ fontSize: 13 }}>Coming in a future update.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SupplierSettings;

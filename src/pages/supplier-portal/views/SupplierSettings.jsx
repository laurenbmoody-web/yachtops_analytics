import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Save, Plus, Trash2, Mail, RefreshCw } from 'lucide-react';
import { useSupplier } from '../../../contexts/SupplierContext';
import {
  updateSupplierProfile,
  fetchAliases,
  addAlias,
  resendAliasVerification,
  deleteAlias,
} from '../utils/supplierStorage';
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

const isValidEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s ?? '').trim());

const EmailAliasesSection = ({ supplierId }) => {
  const [aliases, setAliases] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchAliases(supplierId);
      setAliases(rows);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (supplierId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const handleAdd = async (e) => {
    e?.preventDefault?.();
    if (!isValidEmail(newEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await addAlias(supplierId, newEmail);
      setAliases((prev) => [...(prev ?? []), created]);
      showToast(`Verification email sent to ${created.email}`);
      setNewEmail('');
      setAdding(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async (alias) => {
    setBusyId(alias.id);
    setError(null);
    try {
      const updated = await resendAliasVerification(alias.id);
      setAliases((prev) => prev.map((a) => (a.id === alias.id ? updated : a)));
      showToast(`Verification email resent to ${alias.email}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (alias) => {
    if (!window.confirm(`Remove ${alias.email} from your supplier account? Orders sent here will no longer route to your portal.`)) return;
    setBusyId(alias.id);
    setError(null);
    try {
      await deleteAlias(alias.id);
      setAliases((prev) => prev.filter((a) => a.id !== alias.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const pill = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 8px', borderRadius: 999, fontSize: 10.5,
    fontWeight: 600, letterSpacing: 0.2, textTransform: 'uppercase',
  };
  const dot = (color) => ({
    width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0,
  });

  return (
    <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
      <div style={{ marginBottom: 14 }}>
        <h4 style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 15, color: 'var(--fg)', margin: '0 0 4px' }}>
          Email addresses
        </h4>
        <div style={{ fontSize: 12.5, color: 'var(--muted-s)', lineHeight: 1.5 }}>
          Orders sent to any of these addresses will appear in your portal.
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}
      {toast && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13, color: 'var(--green)' }}>
          {toast}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{
              border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--bg-2)', height: 44,
            }}>
              <div style={{ width: 14, height: 14, background: 'var(--line)', borderRadius: 3 }} />
              <div style={{ flex: 1, height: 12, background: 'var(--line)', borderRadius: 3 }} />
              <div style={{ width: 60, height: 12, background: 'var(--line)', borderRadius: 3 }} />
            </div>
          ))}
        </div>
      )}

      {/* Error with retry */}
      {!loading && aliases == null && error && (
        <div style={{ padding: '18px 0' }}>
          <button
            onClick={load}
            className="sp-pill"
            style={{ padding: '7px 14px', fontSize: 12.5 }}
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {/* Alias list */}
      {!loading && aliases && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {aliases.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--muted-s)', padding: '12px 0' }}>
              No email addresses linked yet.
            </div>
          )}
          {aliases.map((a) => (
            <div
              key={a.id}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'var(--card)',
              }}
            >
              <Mail size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>{a.email}</div>

              {a.is_primary && (
                <span style={{ ...pill, background: 'var(--bg-3)', color: 'var(--muted-s)' }}>
                  Primary
                </span>
              )}

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                {a.verified ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--green)' }}>
                    <span style={dot('#16A34A')} /> Verified
                  </span>
                ) : (
                  <>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#B45309' }}>
                      <span style={dot('#F59E0B')} /> Pending verification
                    </span>
                    <button
                      type="button"
                      onClick={() => handleResend(a)}
                      disabled={busyId === a.id}
                      style={{
                        fontSize: 12, padding: '5px 10px', borderRadius: 6,
                        border: '1px solid var(--line)', background: 'var(--card)',
                        color: 'var(--fg)', cursor: busyId === a.id ? 'wait' : 'pointer',
                      }}
                    >
                      {busyId === a.id ? 'Sending…' : 'Resend email'}
                    </button>
                  </>
                )}
                {!a.is_primary && (
                  <button
                    type="button"
                    onClick={() => handleDelete(a)}
                    disabled={busyId === a.id}
                    title="Remove this email"
                    style={{
                      padding: 6, borderRadius: 6,
                      border: 'none', background: 'transparent',
                      color: 'var(--muted-s)', cursor: busyId === a.id ? 'wait' : 'pointer',
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {!loading && (
        <div style={{ marginTop: 14 }}>
          {!adding ? (
            <button
              type="button"
              onClick={() => { setAdding(true); setError(null); }}
              className="sp-pill"
              style={{ padding: '7px 14px', fontSize: 12.5 }}
            >
              <Plus size={13} /> Add email address
            </button>
          ) : (
            <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 520 }}>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoFocus
                placeholder="orders@supplier.com"
                style={{
                  flex: 1, border: '1px solid var(--line)', borderRadius: 7,
                  padding: '9px 12px', fontSize: 13, background: 'var(--card)',
                  color: 'var(--fg)', fontFamily: 'inherit',
                }}
              />
              <button
                type="submit"
                className="sp-pill primary"
                style={{ padding: '9px 16px' }}
                disabled={submitting || !newEmail.trim()}
              >
                {submitting ? 'Sending…' : 'Send verification'}
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setNewEmail(''); setError(null); }}
                className="sp-pill"
                style={{ padding: '9px 16px' }}
                disabled={submitting}
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

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

              <EmailAliasesSection supplierId={supplier.id} />
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

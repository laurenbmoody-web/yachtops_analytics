import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { fetchSupplierProfileById, updateSupplierProfile } from '../utils/supplierStorage';
import {
  getCountryTaxPreset,
  listSupportedCountries,
} from '../../../data/countryTaxPresets';

// ─── Helpers ──────────────────────────────────────────────────────────────

// Pull the form payload out of a supplier_profiles row. Anything not
// touched here is preserved across saves.
const formFromProfile = (p) => ({
  // Business
  business_country:              p?.business_country ?? '',
  business_address_line1:        p?.business_address_line1 ?? '',
  business_address_line2:        p?.business_address_line2 ?? '',
  business_city:                 p?.business_city ?? '',
  business_postal_code:          p?.business_postal_code ?? '',
  business_state_region:         p?.business_state_region ?? '',
  vat_number:                    p?.vat_number ?? '',
  company_registration_number:   p?.company_registration_number ?? '',
  default_currency:              p?.default_currency ?? 'EUR',
  // Tax categories
  vat_categories_enabled:        Array.isArray(p?.vat_categories_enabled) ? p.vat_categories_enabled : [],
  vat_categories_overrides:      (p?.vat_categories_overrides && typeof p.vat_categories_overrides === 'object') ? p.vat_categories_overrides : {},
  vat_categories_custom:         Array.isArray(p?.vat_categories_custom) ? p.vat_categories_custom : [],
  // Bank
  bank_details:                  (p?.bank_details && typeof p.bank_details === 'object') ? p.bank_details : {},
  // Numbering
  invoice_number_prefix:         p?.invoice_number_prefix ?? 'INV',
  invoice_number_format:         p?.invoice_number_format ?? '{prefix}-{YYYY}-{####}',
  invoice_number_counter:        p?.invoice_number_counter ?? 0,
  // Payment
  invoice_payment_terms_days:    p?.invoice_payment_terms_days ?? 30,
  invoice_footer_terms:          p?.invoice_footer_terms ?? '',
});

// Validation: returns { ok: true } or { ok: false, errors: { field: 'msg' } }
const validateForm = (form) => {
  const errors = {};
  if (!form.business_country) errors.business_country = 'Required';
  if (!form.business_address_line1?.trim()) errors.business_address_line1 = 'Required';
  if (!form.business_city?.trim()) errors.business_city = 'Required';
  if (!form.default_currency) errors.default_currency = 'Required';
  return { ok: Object.keys(errors).length === 0, errors };
};

// ─── Section: shared layout ──────────────────────────────────────────────

const SectionCard = ({ title, subtitle, children }) => (
  <div style={{ marginBottom: 24 }}>
    <div style={{ marginBottom: 14 }}>
      <h4 style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 14, color: 'var(--fg)', margin: '0 0 4px' }}>
        {title}
      </h4>
      {subtitle && (
        <p style={{ fontSize: 12.5, color: 'var(--muted-strong)', margin: 0, lineHeight: 1.5 }}>
          {subtitle}
        </p>
      )}
    </div>
    {children}
  </div>
);

// ─── Main ─────────────────────────────────────────────────────────────────

const InvoicingSettings = ({ supplier, onSaved }) => {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});

  const supplierId = supplier?.id;

  useEffect(() => {
    if (!supplierId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSupplierProfileById(supplierId)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setForm(formFromProfile(p));
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [supplierId]);

  const set = useCallback((field, value) => {
    setForm((f) => f ? { ...f, [field]: value } : f);
    // Clear inline validation error on edit.
    setValidationErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const handleSave = async () => {
    if (!form) return;
    const { ok, errors } = validateForm(form);
    if (!ok) {
      setValidationErrors(errors);
      setError('Please fix the highlighted fields.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Strip the read-only counter from the payload so suppliers can never
      // accidentally overwrite their sequence by saving the form.
      const { invoice_number_counter, ...payload } = form;
      const updated = await updateSupplierProfile(supplierId, payload);
      setProfile(updated);
      setForm(formFromProfile(updated));
      setSavedAt(Date.now());
      onSaved?.(updated);
    } catch (e) {
      setError(e.message || 'Could not save invoicing settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Loading invoicing settings…
      </div>
    );
  }

  if (!form) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--red)', fontSize: 13 }}>
        {error || 'Could not load invoicing settings.'}
      </div>
    );
  }

  return (
    <>
      <h4 style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 15, color: 'var(--fg)', margin: '0 0 4px' }}>
        Invoicing
      </h4>
      <p style={{ fontSize: 12.5, color: 'var(--muted-strong)', margin: '0 0 22px', lineHeight: 1.5 }}>
        These details appear on every invoice you generate. Save once, then issue invoices from the
        Documents menu on any order.
      </p>

      {error && (
        <div style={{
          marginBottom: 16, padding: '10px 14px',
          background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: 8, fontSize: 13, color: 'var(--red)',
        }}>{error}</div>
      )}
      {savedAt && !error && (
        <div style={{
          marginBottom: 16, padding: '10px 14px',
          background: '#F0FDF4', border: '1px solid #BBF7D0',
          borderRadius: 8, fontSize: 13, color: 'var(--green)',
        }}>Invoicing settings saved.</div>
      )}

      {/* Sections land in Runs B–D */}
      <SectionCard title="Logo, business details, tax categories, bank, numbering, footer" subtitle="Detail sections land in subsequent runs.">
        <div style={{ fontSize: 12.5, color: 'var(--muted)', fontFamily: 'JetBrains Mono' }}>
          Country selected: {form.business_country || '—'}
        </div>
      </SectionCard>

      <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--line-soft)', paddingTop: 18, marginTop: 8 }}>
        <button
          type="button"
          className="sp-btn sp-btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save invoicing settings'}
        </button>
      </div>
    </>
  );
};

export default InvoicingSettings;

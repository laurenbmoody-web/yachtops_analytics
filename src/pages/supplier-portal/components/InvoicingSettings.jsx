import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  fetchSupplierProfileById,
  updateSupplierProfile,
  uploadSupplierLogo,
} from '../utils/supplierStorage';
import {
  getCountryTaxPreset,
  listSupportedCountries,
} from '../../../data/countryTaxPresets';

// Common invoice currencies — superset of the country presets'
// defaultCurrency, so the dropdown always covers what suppliers might want.
const COMMON_CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF', 'AED', 'XCD', 'AUD', 'NZD', 'CAD', 'SGD', 'HKD', 'JPY', 'NOK', 'SEK', 'DKK'];

const SUPPORTED_COUNTRIES = listSupportedCountries();

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

// ─── Section 1: Logo upload ──────────────────────────────────────────────

const LogoUploadSection = ({ supplierId, currentLogoUrl, onUploaded }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('Logo must be a PNG or JPEG.');
      return;
    }
    if (file.size > 1_000_000) {
      setError('Logo must be under 1 MB.');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const url = await uploadSupplierLogo(supplierId, file);
      onUploaded?.(url);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      // Reset input so the same file can be re-selected if needed.
      e.target.value = '';
    }
  };

  return (
    <SectionCard
      title="Logo"
      subtitle="Appears top-left on every invoice you generate. PNG or JPEG, max 1 MB."
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{
          width: 96, height: 96,
          border: '1px solid var(--line)', borderRadius: 8,
          background: 'var(--bg-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}>
          {currentLogoUrl ? (
            <img src={currentLogoUrl} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: 4 }}>
              No logo yet
            </div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <label className="sp-btn sp-btn-secondary" style={{ display: 'inline-block', cursor: uploading ? 'wait' : 'pointer' }}>
            {uploading ? 'Uploading…' : (currentLogoUrl ? 'Replace logo' : 'Upload logo')}
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleFile}
              disabled={uploading}
              style={{ display: 'none' }}
            />
          </label>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{error}</div>
          )}
        </div>
      </div>
    </SectionCard>
  );
};

// ─── Section 2: Business details ─────────────────────────────────────────

const BusinessDetailsSection = ({ form, set, validationErrors }) => {
  const preset = useMemo(() => getCountryTaxPreset(form.business_country), [form.business_country]);

  // When the country changes, suggest its default currency if the supplier
  // hasn't picked one yet (treat 'EUR' default as "untouched" — best-effort).
  const handleCountryChange = (iso2) => {
    set('business_country', iso2);
    const nextPreset = getCountryTaxPreset(iso2);
    if (nextPreset && (!form.default_currency || form.default_currency === 'EUR')) {
      set('default_currency', nextPreset.defaultCurrency);
    }
  };

  const fieldError = (key) => validationErrors[key];
  const inputClass = (key) => `sp-field-input${fieldError(key) ? ' sp-field-input-error' : ''}`;

  return (
    <SectionCard
      title="Business details"
      subtitle="Used on every invoice header. Country drives the default tax categories below."
    >
      <div className="sp-field-row">
        <div className="sp-field">
          <label className="sp-field-label">Country *</label>
          <select
            className={inputClass('business_country')}
            value={form.business_country}
            onChange={(e) => handleCountryChange(e.target.value)}
          >
            <option value="">Select country…</option>
            {SUPPORTED_COUNTRIES.map((c) => (
              <option key={c.iso2} value={c.iso2}>{c.name}</option>
            ))}
          </select>
          {fieldError('business_country') && (
            <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4 }}>{fieldError('business_country')}</div>
          )}
        </div>
        <div className="sp-field">
          <label className="sp-field-label">Default currency *</label>
          <select
            className={inputClass('default_currency')}
            value={form.default_currency}
            onChange={(e) => set('default_currency', e.target.value)}
          >
            {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="sp-field">
        <label className="sp-field-label">Address line 1 *</label>
        <input
          type="text"
          className={inputClass('business_address_line1')}
          value={form.business_address_line1}
          onChange={(e) => set('business_address_line1', e.target.value)}
          placeholder="Street and number"
        />
        {fieldError('business_address_line1') && (
          <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4 }}>{fieldError('business_address_line1')}</div>
        )}
      </div>

      <div className="sp-field">
        <label className="sp-field-label">Address line 2</label>
        <input
          type="text"
          className="sp-field-input"
          value={form.business_address_line2}
          onChange={(e) => set('business_address_line2', e.target.value)}
          placeholder="Apartment, suite, etc. (optional)"
        />
      </div>

      <div className="sp-field-row">
        <div className="sp-field">
          <label className="sp-field-label">City *</label>
          <input
            type="text"
            className={inputClass('business_city')}
            value={form.business_city}
            onChange={(e) => set('business_city', e.target.value)}
          />
          {fieldError('business_city') && (
            <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 4 }}>{fieldError('business_city')}</div>
          )}
        </div>
        <div className="sp-field">
          <label className="sp-field-label">Postal code</label>
          <input
            type="text"
            className="sp-field-input"
            value={form.business_postal_code}
            onChange={(e) => set('business_postal_code', e.target.value)}
          />
        </div>
      </div>

      <div className="sp-field">
        <label className="sp-field-label">State / region</label>
        <input
          type="text"
          className="sp-field-input"
          value={form.business_state_region}
          onChange={(e) => set('business_state_region', e.target.value)}
          placeholder="Optional"
        />
      </div>

      <div className="sp-field-row">
        <div className="sp-field">
          <label className="sp-field-label">{preset?.taxName || 'VAT'} number</label>
          <input
            type="text"
            className="sp-field-input"
            value={form.vat_number}
            onChange={(e) => set('vat_number', e.target.value)}
            placeholder={preset?.vatRegistrationFormat || 'Optional'}
          />
        </div>
        <div className="sp-field">
          <label className="sp-field-label">Company registration number</label>
          <input
            type="text"
            className="sp-field-input"
            value={form.company_registration_number}
            onChange={(e) => set('company_registration_number', e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>
    </SectionCard>
  );
};

// ─── Section 3: Tax categories ───────────────────────────────────────────

const DISCLAIMER_COPY =
  "Tax rates shown are Cargo's best-effort defaults. Verify with your accountant before issuing real invoices. You can override any rate below.";

const DisclaimerBanner = () => (
  <div style={{
    padding: '10px 14px',
    background: '#FEF3C7', border: '1px solid #FDE68A',
    borderRadius: 8, fontSize: 12.5, color: '#92400E',
    marginBottom: 14, lineHeight: 1.5,
  }}>
    <strong>Heads up.</strong> {DISCLAIMER_COPY}
  </div>
);

// Resolve the rate the supplier will actually use for a given category:
// override (if set) → preset rate (otherwise).
const effectiveRate = (catKey, presetRate, overrides) => {
  const o = overrides?.[catKey];
  return o == null || o === '' ? presetRate : Number(o);
};

const CategoryRow = ({
  cat,            // { key, rate, label, labelEn, note }
  enabled,
  override,       // string or number, possibly null
  onToggle,
  onOverrideChange,
  onClearOverride,
}) => {
  const presetRate = cat.rate;
  const hasOverride = override != null && override !== '' && Number(override) !== presetRate;
  const displayLabel = cat.labelEn ? `${cat.label} (${cat.labelEn})` : cat.label;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '24px 1fr 100px 30px',
      alignItems: 'center', gap: 10,
      padding: '8px 10px',
      background: enabled ? 'var(--card)' : 'transparent',
      border: enabled ? '1px solid var(--line)' : '1px dashed var(--line-soft)',
      borderRadius: 7,
    }}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onToggle(cat.key, e.target.checked)}
        style={{ cursor: 'pointer' }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: enabled ? 'var(--fg)' : 'var(--muted-strong)' }}>
          {displayLabel}
        </div>
        {cat.note && (
          <div style={{ fontSize: 11, color: 'var(--muted-strong)', marginTop: 2, lineHeight: 1.4 }}>
            {cat.note}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'JetBrains Mono', marginTop: 2 }}>
          key: {cat.key} · default {presetRate}%
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <input
          type="number"
          step="0.1"
          min="0"
          max="100"
          disabled={!enabled}
          value={override == null || override === '' ? presetRate : override}
          onChange={(e) => onOverrideChange(cat.key, e.target.value)}
          className="sp-field-input"
          style={{
            paddingRight: 26,
            background: hasOverride ? '#FEF3C7' : undefined,
            borderColor: hasOverride ? '#F59E0B' : undefined,
          }}
        />
        <span style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          fontSize: 12, color: 'var(--muted-strong)', pointerEvents: 'none',
        }}>%</span>
      </div>
      {hasOverride && enabled ? (
        <button
          type="button"
          onClick={() => onClearOverride(cat.key)}
          title="Reset to default"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 14, color: 'var(--muted-strong)', padding: 4,
          }}
        >↺</button>
      ) : <span />}
    </div>
  );
};

const CustomCategoryRow = ({ cat, onChange, onRemove }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: '1fr 140px 100px 30px',
    alignItems: 'center', gap: 10,
    padding: '8px 10px',
    border: '1px solid var(--line)', borderRadius: 7,
    background: 'var(--card)',
  }}>
    <input
      type="text"
      placeholder="Label (e.g. Tobacco)"
      value={cat.label}
      onChange={(e) => onChange({ ...cat, label: e.target.value })}
      className="sp-field-input"
    />
    <input
      type="text"
      placeholder="key (snake_case)"
      value={cat.key}
      onChange={(e) => onChange({ ...cat, key: e.target.value.replace(/[^a-z0-9_]/g, '_').toLowerCase() })}
      className="sp-field-input"
      style={{ fontFamily: 'JetBrains Mono', fontSize: 12 }}
    />
    <div style={{ position: 'relative' }}>
      <input
        type="number"
        step="0.1"
        min="0"
        max="100"
        value={cat.rate}
        onChange={(e) => onChange({ ...cat, rate: e.target.value })}
        className="sp-field-input"
        style={{ paddingRight: 26 }}
      />
      <span style={{
        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
        fontSize: 12, color: 'var(--muted-strong)', pointerEvents: 'none',
      }}>%</span>
    </div>
    <button
      type="button"
      onClick={onRemove}
      title="Remove"
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: 16, color: 'var(--muted-strong)', padding: 4,
      }}
    >×</button>
  </div>
);

const TaxCategoriesSection = ({ form, set }) => {
  const preset = useMemo(() => getCountryTaxPreset(form.business_country), [form.business_country]);

  const enabledSet = useMemo(
    () => new Set(form.vat_categories_enabled || []),
    [form.vat_categories_enabled]
  );

  const toggleCategory = (key, on) => {
    const next = new Set(enabledSet);
    if (on) next.add(key); else next.delete(key);
    set('vat_categories_enabled', Array.from(next));
  };

  const setOverride = (key, value) => {
    const next = { ...(form.vat_categories_overrides || {}) };
    if (value === '' || value == null) {
      delete next[key];
    } else {
      next[key] = Number(value);
    }
    set('vat_categories_overrides', next);
  };

  const clearOverride = (key) => {
    const next = { ...(form.vat_categories_overrides || {}) };
    delete next[key];
    set('vat_categories_overrides', next);
  };

  const updateCustom = (idx, cat) => {
    const next = [...form.vat_categories_custom];
    next[idx] = cat;
    set('vat_categories_custom', next);
  };

  const removeCustom = (idx) => {
    const next = form.vat_categories_custom.filter((_, i) => i !== idx);
    set('vat_categories_custom', next);
  };

  const addCustom = () => {
    set('vat_categories_custom', [
      ...form.vat_categories_custom,
      { key: '', label: '', rate: '' },
    ]);
  };

  if (!form.business_country) {
    return (
      <SectionCard title="Tax categories" subtitle="Pick a country above to load locally-correct tax categories.">
        <DisclaimerBanner />
        <div style={{
          padding: 18, background: 'var(--bg)', borderRadius: 8,
          fontSize: 13, color: 'var(--muted-strong)', textAlign: 'center',
        }}>
          Select a country to begin.
        </div>
      </SectionCard>
    );
  }

  if (!preset) {
    return (
      <SectionCard title="Tax categories" subtitle="No preset for this country yet — categories will need to be added manually.">
        <DisclaimerBanner />
        <CustomCategoriesBlock
          categories={form.vat_categories_custom}
          onUpdate={updateCustom}
          onRemove={removeCustom}
          onAdd={addCustom}
        />
      </SectionCard>
    );
  }

  // Sort: enabled categories first, disabled below.
  const sorted = [...preset.categories].sort((a, b) => {
    const aOn = enabledSet.has(a.key) ? 0 : 1;
    const bOn = enabledSet.has(b.key) ? 0 : 1;
    return aOn - bOn;
  });

  return (
    <SectionCard
      title="Tax categories"
      subtitle={`${preset.name} · ${preset.taxName} · standard rate ${preset.categories.find(c => c.key === 'standard')?.rate ?? '—'}%`}
    >
      <DisclaimerBanner />

      {preset.notes && (
        <div style={{
          fontSize: 12.5, color: 'var(--muted-strong)',
          padding: '8px 12px', marginBottom: 12,
          background: 'var(--bg-2)', borderRadius: 7,
          lineHeight: 1.5,
        }}>
          <strong>{preset.name}:</strong> {preset.notes}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map((cat) => (
          <CategoryRow
            key={cat.key}
            cat={cat}
            enabled={enabledSet.has(cat.key)}
            override={form.vat_categories_overrides?.[cat.key]}
            onToggle={toggleCategory}
            onOverrideChange={setOverride}
            onClearOverride={clearOverride}
          />
        ))}
      </div>

      <CustomCategoriesBlock
        categories={form.vat_categories_custom}
        onUpdate={updateCustom}
        onRemove={removeCustom}
        onAdd={addCustom}
      />
    </SectionCard>
  );
};

const CustomCategoriesBlock = ({ categories, onUpdate, onRemove, onAdd }) => (
  <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px dashed var(--line)' }}>
    <div style={{
      fontFamily: 'Syne', fontWeight: 600, fontSize: 10,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      color: 'var(--muted-strong)', marginBottom: 8,
    }}>Custom categories</div>
    {categories.length === 0 && (
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
        Add a custom category if you supply something the country preset doesn't cover.
      </div>
    )}
    {categories.length > 0 && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {categories.map((cat, idx) => (
          <CustomCategoryRow
            key={idx}
            cat={cat}
            onChange={(c) => onUpdate(idx, c)}
            onRemove={() => onRemove(idx)}
          />
        ))}
      </div>
    )}
    <button
      type="button"
      className="sp-btn sp-btn-secondary"
      onClick={onAdd}
      style={{ fontSize: 12.5, padding: '7px 14px' }}
    >
      + Add custom category
    </button>
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

      {/* ── Section 1: Logo upload ── */}
      <LogoUploadSection
        supplierId={supplierId}
        currentLogoUrl={profile?.invoice_logo_url}
        onUploaded={(url) => setProfile((p) => p ? { ...p, invoice_logo_url: url } : p)}
      />

      {/* ── Section 2: Business details ── */}
      <BusinessDetailsSection form={form} set={set} validationErrors={validationErrors} />

      {/* ── Section 3: Tax categories ── */}
      <TaxCategoriesSection form={form} set={set} />

      {/* ── Sections 4–6: bank, numbering, footer (Run D) ── */}

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

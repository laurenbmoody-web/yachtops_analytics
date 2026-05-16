// ============================================================
// Add / Edit Supplier — Sprint 9c.3 Phase 6
// ============================================================
//
// Right-slide drawer (max 540px) for creating or editing a row in
// the consolidated supplier_profiles table. Picker styling mirrors
// the form-preview section of docs/three_categorisation_options.html
// (the visual source of truth): single-select type + primary
// category (orange-ring "primary" pill), multi-select subcategories
// scoped to the chosen primary, dashed "+ ADD" free-text additions,
// invoicing collapsed by default.
//
// Props:
//   vendor          object | null  — null = add, object = edit (prefill)
//   activeTenantId  string         — REQUIRED for createVendor: the
//                                    crew_insert_supplier_profiles RLS
//                                    WITH CHECK rejects an INSERT whose
//                                    tenant_id ∉ the caller's active
//                                    tenant_members. Edit (updateVendor)
//                                    doesn't re-send tenant_id.
//   taxonomy        { categories, subcategories } — already merged
//                                    (seed + tenant) by the directory.
//   onClose         () => void
//   onSaved         () => void      — parent closes the drawer and
//                                    reloads the directory list.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createVendor, updateVendor } from '../utils/provisioningStorage';
import { VENDOR_TYPES } from './vendorConstants';
import { showToast } from '../../../utils/toast';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'AUD', 'CAD', 'CHF', 'JPY', 'AED'];

// Case-insensitive, order-preserving merge (seed list first, then
// session-local additions).
const uniqMerge = (a = [], b = []) => {
  const seen = new Set();
  const out = [];
  for (const x of [...(a || []), ...(b || [])]) {
    if (!x) continue;
    const k = String(x).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
};

const AddVendorForm = ({ vendor, activeTenantId, taxonomy, onClose, onSaved }) => {
  const isEdit = !!vendor;
  const taxoCats = taxonomy?.categories || [];
  const taxoSubs = taxonomy?.subcategories || {};

  const nameRef = useRef(null);

  // ── Form state ───────────────────────────────────────────────
  const [vendorType, setVendorType] = useState(vendor?.vendor_type || 'Supplier');
  const [name, setName] = useState(vendor?.name || '');
  const [country, setCountry] = useState(vendor?.business_country || '');
  const [city, setCity] = useState(vendor?.business_city || '');
  const [address, setAddress] = useState(vendor?.business_address_line1 || '');
  const [primaryCategory, setPrimaryCategory] = useState(vendor?.primary_category || '');
  const [subcategories, setSubcategories] = useState(
    Array.isArray(vendor?.subcategories) ? [...vendor.subcategories] : [],
  );
  const [email, setEmail] = useState(vendor?.contact_email || '');
  const [phone, setPhone] = useState(vendor?.contact_phone || '');
  const [currency, setCurrency] = useState(vendor?.default_currency || 'EUR');
  const [terms, setTerms] = useState(
    vendor?.invoice_payment_terms_days == null ? '' : String(vendor.invoice_payment_terms_days),
  );

  // Session-local taxonomy additions (persisted only by saving the
  // row — the directory re-derives the merged taxonomy on next load).
  const [extraCategories, setExtraCategories] = useState(() =>
    vendor?.primary_category &&
    !taxoCats.some((c) => c.toLowerCase() === vendor.primary_category.toLowerCase())
      ? [vendor.primary_category]
      : [],
  );
  const [extraSubs, setExtraSubs] = useState(() => {
    const p = vendor?.primary_category;
    if (!p || !Array.isArray(vendor?.subcategories)) return {};
    const known = taxoSubs[p] || [];
    const missing = vendor.subcategories.filter(
      (s) => !known.some((k) => k.toLowerCase() === String(s).toLowerCase()),
    );
    return missing.length ? { [p]: missing } : {};
  });

  const [showAddCat, setShowAddCat] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [showAddSub, setShowAddSub] = useState(false);
  const [newSub, setNewSub] = useState('');

  const [invoicingOpen, setInvoicingOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const closeIfIdle = () => { if (!saving) onClose(); };

  // Esc closes (not while saving).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeIfIdle(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving]);

  const categoryOptions = useMemo(
    () => uniqMerge(taxoCats, extraCategories),
    [taxoCats, extraCategories],
  );
  const subOptions = useMemo(
    () => (primaryCategory ? uniqMerge(taxoSubs[primaryCategory], extraSubs[primaryCategory]) : []),
    [primaryCategory, taxoSubs, extraSubs],
  );
  const selectedType = VENDOR_TYPES.find((t) => t.value === vendorType);

  // ── Picker handlers ──────────────────────────────────────────
  const selectPrimary = (c) => {
    if (c === primaryCategory) return;
    setPrimaryCategory(c);
    setSubcategories([]); // subcategories are scoped to the primary
    setShowAddSub(false);
    setNewSub('');
  };

  const addCategory = () => {
    const v = newCat.trim();
    if (!v) return;
    if (!categoryOptions.some((c) => c.toLowerCase() === v.toLowerCase())) {
      setExtraCategories((p) => [...p, v]);
    }
    setPrimaryCategory(v);
    setSubcategories([]);
    setNewCat('');
    setShowAddCat(false);
  };

  const toggleSub = (s) => {
    setSubcategories((p) =>
      p.some((x) => x.toLowerCase() === s.toLowerCase())
        ? p.filter((x) => x.toLowerCase() !== s.toLowerCase())
        : [...p, s],
    );
  };

  const addSub = () => {
    const v = newSub.trim();
    if (!v || !primaryCategory) return;
    const known = uniqMerge(taxoSubs[primaryCategory], extraSubs[primaryCategory]);
    if (!known.some((s) => s.toLowerCase() === v.toLowerCase())) {
      setExtraSubs((p) => ({
        ...p,
        [primaryCategory]: [...(p[primaryCategory] || []), v],
      }));
    }
    setSubcategories((p) =>
      p.some((x) => x.toLowerCase() === v.toLowerCase()) ? p : [...p, v],
    );
    setNewSub('');
    setShowAddSub(false);
  };

  // ── Save ─────────────────────────────────────────────────────
  const canSave =
    name.trim() &&
    primaryCategory &&
    !saving &&
    (isEdit || !!activeTenantId);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    const fields = {
      name: name.trim(),
      vendor_type: vendorType,
      business_country: country.trim() || null,
      business_city: city.trim() || null,
      business_address_line1: address.trim() || null,
      primary_category: primaryCategory,
      // Convention (see createVendor docs): categories[] always carries
      // the primary; subcategories live in their own column.
      categories: primaryCategory ? [primaryCategory] : [],
      subcategories,
      contact_email: email.trim() || null,
      contact_phone: phone.trim() || null,
      default_currency: currency || 'EUR',
      invoice_payment_terms_days: terms === '' ? null : Number(terms),
    };

    const { error: e } = isEdit
      ? await updateVendor(vendor.id, fields)
      : await createVendor({ ...fields, tenant_id: activeTenantId });

    if (e) {
      setSaving(false);
      setError(e.message || 'Could not save. Please try again.');
      showToast(isEdit ? 'Could not update supplier' : 'Could not add supplier', 'error');
      return;
    }
    showToast(isEdit ? `${fields.name} updated` : `${fields.name} added`, 'success');
    onSaved();
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="sd-dir-drawer-backdrop" onClick={closeIfIdle}>
      <div
        className="sd-dir-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit supplier' : 'Add supplier'}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>
          {isEdit ? 'Edit' : 'Add'} <span className="accent">supplier</span>
          <span className="period">.</span>
        </h2>
        <div className="sd-dir-subline" style={{ marginBottom: 0 }}>
          {isEdit
            ? vendor.name
            : 'A new supplier, service provider, contractor, agent or broker.'}
        </div>

        <div className="sd-dir-form">
          {/* Type */}
          <div className="sd-dir-form-section">
            <label className="sd-dir-form-label">TYPE — pick one</label>
            <div className="sd-dir-pill-wrap">
              {VENDOR_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`sd-dir-form-pill${vendorType === t.value ? ' selected is-primary' : ''}`}
                  onClick={() => setVendorType(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {selectedType?.description && (
              <div className="sd-dir-form-help">{selectedType.description}</div>
            )}
          </div>

          {/* Name */}
          <div className="sd-dir-form-section">
            <label className="sd-dir-form-label" htmlFor="sd-name">
              NAME<span className="req">*</span>
            </label>
            <input
              id="sd-name"
              ref={nameRef}
              className="sd-dir-input"
              type="text"
              placeholder="Supplier name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Location */}
          <div className="sd-dir-form-section">
            <label className="sd-dir-form-label">LOCATION</label>
            <div className="sd-dir-form-row" style={{ marginBottom: 12 }}>
              <input
                className="sd-dir-input sd-dir-input--mini"
                type="text"
                placeholder="Country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
              <input
                className="sd-dir-input sd-dir-input--mini"
                type="text"
                placeholder="City / port"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <input
              className="sd-dir-input sd-dir-input--mini"
              type="text"
              placeholder="Address line"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          {/* Primary category */}
          <div className="sd-dir-form-section">
            <label className="sd-dir-form-label">
              PRIMARY CATEGORY<span className="req">*</span> — pick exactly one
            </label>
            <div className="sd-dir-pill-wrap">
              {categoryOptions.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`sd-dir-form-pill${primaryCategory === c ? ' selected is-primary' : ''}`}
                  onClick={() => selectPrimary(c)}
                >
                  {c}
                </button>
              ))}
              {!showAddCat && (
                <button
                  type="button"
                  className="sd-dir-form-add"
                  onClick={() => setShowAddCat(true)}
                >
                  + ADD CATEGORY
                </button>
              )}
            </div>
            {showAddCat && (
              <div className="sd-dir-form-add-row">
                <input
                  className="sd-dir-input sd-dir-input--inline"
                  type="text"
                  placeholder="New category"
                  value={newCat}
                  autoFocus
                  onChange={(e) => setNewCat(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addCategory(); }
                  }}
                />
                <button type="button" className="sd-dir-btn sd-dir-btn-primary" onClick={addCategory}>
                  Add
                </button>
                <button
                  type="button"
                  className="sd-dir-btn"
                  onClick={() => { setShowAddCat(false); setNewCat(''); }}
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Subcategories (scoped to the chosen primary) */}
          {primaryCategory && (
            <div className="sd-dir-form-section">
              <label className="sd-dir-form-label">
                SUBCATEGORIES UNDER {primaryCategory.toUpperCase()} — optional, multi-select
              </label>
              <div className="sd-dir-pill-wrap">
                {subOptions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`sd-dir-form-pill${
                      subcategories.some((x) => x.toLowerCase() === s.toLowerCase()) ? ' selected' : ''
                    }`}
                    onClick={() => toggleSub(s)}
                  >
                    {s}
                  </button>
                ))}
                {!showAddSub && (
                  <button
                    type="button"
                    className="sd-dir-form-add"
                    onClick={() => setShowAddSub(true)}
                  >
                    + ADD SUBCATEGORY
                  </button>
                )}
              </div>
              {showAddSub && (
                <div className="sd-dir-form-add-row">
                  <input
                    className="sd-dir-input sd-dir-input--inline"
                    type="text"
                    placeholder="New subcategory"
                    value={newSub}
                    autoFocus
                    onChange={(e) => setNewSub(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); addSub(); }
                    }}
                  />
                  <button type="button" className="sd-dir-btn sd-dir-btn-primary" onClick={addSub}>
                    Add
                  </button>
                  <button
                    type="button"
                    className="sd-dir-btn"
                    onClick={() => { setShowAddSub(false); setNewSub(''); }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Contact */}
          <div className="sd-dir-form-section">
            <label className="sd-dir-form-label">CONTACT</label>
            <div className="sd-dir-form-field">
              <input
                className="sd-dir-input sd-dir-input--mini"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <input
              className="sd-dir-input sd-dir-input--mini"
              type="tel"
              placeholder="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          {/* Invoicing (collapsed by default) */}
          <div className="sd-dir-form-section">
            <button
              type="button"
              className="sd-dir-collapse"
              aria-expanded={invoicingOpen}
              onClick={() => setInvoicingOpen((v) => !v)}
            >
              INVOICING
              <span className="chev">{invoicingOpen ? '▲' : '▼'}</span>
            </button>
            {invoicingOpen && (
              <div className="sd-dir-collapse-body">
                <div className="sd-dir-form-row">
                  <div>
                    <label className="sd-dir-form-label">DEFAULT CURRENCY</label>
                    <select
                      className="sd-dir-input sd-dir-input--mini"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      {uniqMerge(CURRENCIES, [currency]).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="sd-dir-form-label">PAYMENT TERMS (DAYS)</label>
                    <input
                      className="sd-dir-input sd-dir-input--mini"
                      type="number"
                      min="0"
                      placeholder="e.g. 30"
                      value={terms}
                      onChange={(e) => setTerms(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {!isEdit && !activeTenantId && (
            <div className="sd-dir-form-error">
              No active vessel in context — can’t create a supplier without a
              tenant (the row would be rejected by row-level security).
            </div>
          )}
          {error && <div className="sd-dir-form-error">{error}</div>}
        </div>

        <div className="sd-dir-drawer-actions">
          <button
            type="button"
            className="sd-dir-btn"
            disabled={saving}
            onClick={closeIfIdle}
          >
            Cancel
          </button>
          <button
            type="button"
            className="sd-dir-btn sd-dir-btn-primary"
            disabled={!canSave}
            onClick={handleSave}
          >
            {saving
              ? 'Saving…'
              : isEdit
                ? 'Save changes'
                : 'Add supplier'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddVendorForm;

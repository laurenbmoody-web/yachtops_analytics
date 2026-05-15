// ============================================================
// Add / Edit Vendor — Sprint 9c.3
// ============================================================
//
// Phase 5 ships this as a working *drawer shell* only: the chrome
// (backdrop, slide-in panel, title, footer actions, close handling)
// is real, but the form body is a placeholder. Phase 6 builds the
// full field set (vendor type, primary category + add-new,
// subcategories, contacts, location, currency / payment terms) and
// wires createVendor / updateVendor.
//
// Props:
//   vendor          object | null   — null = add mode, object = edit
//   activeTenantId   string         — required by createVendor RLS
//                                      (crew_insert_supplier_profiles
//                                      WITH CHECK). Passed through now
//                                      so Phase 6 doesn't change the
//                                      call signature.
//   taxonomy         { categories, subcategories } — merged seed +
//                                      tenant taxonomy for the picker
//   onClose          () => void
//   onSaved          () => void      — Phase 6 calls this after a
//                                      successful create / update

import React, { useEffect } from 'react';

const AddVendorForm = ({ vendor, activeTenantId, taxonomy, onClose, onSaved }) => {
  const isEdit = !!vendor;

  // Esc closes the drawer.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="sd-dir-drawer-backdrop"
      onClick={onClose}
    >
      <div
        className="sd-dir-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit vendor' : 'Add vendor'}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>
          {isEdit ? 'Edit' : 'Add'} <span className="accent">vendor</span>
          <span className="period">.</span>
        </h2>
        <div className="sd-dir-subline" style={{ marginBottom: 0 }}>
          {isEdit ? vendor.name : 'A new supplier, service provider, contractor, agent or broker.'}
        </div>

        <div className="sd-dir-drawer-placeholder">
          The vendor form lands in <strong>Phase 6</strong> — vendor type,
          primary category (with add-new), subcategories, contacts,
          location, default currency and payment terms, wired to
          {' '}<code>createVendor</code> / <code>updateVendor</code>.
          {!activeTenantId && (
            <>
              <br /><br />
              <em>Note: no active tenant in context — Phase 6 will guard
              the save against this (createVendor needs tenant_id for the
              crew-insert RLS check).</em>
            </>
          )}
          {taxonomy?.categories?.length > 0 && (
            <>
              <br /><br />
              Picker will seed from {taxonomy.categories.length} known categories.
            </>
          )}
        </div>

        <div className="sd-dir-drawer-actions">
          <button type="button" className="sd-dir-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sd-dir-btn sd-dir-btn-primary"
            disabled
            title="The form is built in Phase 6"
            onClick={onSaved}
          >
            {isEdit ? 'Save changes' : 'Add vendor'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddVendorForm;

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import SupplierModal from './SupplierModal';
import {
  fetchSupplierProfileById,
  fetchInvoicesForOrder,
  generateSupplierInvoice,
} from '../utils/supplierStorage';
import {
  getEffectiveCategoriesForSupplier,
  getTaxNameForSupplier,
  suggestCategoryForItem,
  isInvoicingReady,
} from '../utils/invoicingHelpers';
import './generate-invoice.css';

// YYYY-MM-DD → dd/mm/yyyy (Cargo date convention).
const fmtDMY = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

const DISCLAIMER =
  "Tax rates shown are Cargo's best-effort defaults. Verify with your accountant before issuing real invoices. You can override any rate below.";

// Add `days` to a YYYY-MM-DD date and return the new ISO date string.
const addDays = (iso, days) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const fmtMoney = (n, currency) => {
  const num = Number(n) || 0;
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency, minimumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${currency} ${num.toFixed(2)}`;
  }
};

export default function GenerateInvoiceModal({ orderId, items, supplierId, open, onClose, onGenerated }) {
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState(null);
  const [loadingSupplier, setLoadingSupplier] = useState(true);
  const [profileError, setProfileError] = useState(null);

  const [bondedSupply, setBondedSupply] = useState(false);
  const [reverseCharge, setReverseCharge] = useState(false);
  const [discountPct, setDiscountPct] = useState(0);
  const [issueDate, setIssueDate] = useState(todayIso());
  const [paymentTermsDays, setPaymentTermsDays] = useState(30);
  const [notes, setNotes] = useState('');

  // Map of item_id → category_key. Seeded from suggestCategoryForItem on open.
  const [lineCategories, setLineCategories] = useState({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Existing invoice for this order (if any) — regenerating replaces it.
  const [existingInvoice, setExistingInvoice] = useState(null);

  // ─── Load profile on open ───────────────────────────────────────────────
  useEffect(() => {
    if (!open || !supplierId) return;
    let cancelled = false;
    setLoadingSupplier(true);
    setProfileError(null);
    fetchSupplierProfileById(supplierId)
      .then((p) => {
        if (cancelled) return;
        setSupplier(p);
        setPaymentTermsDays(p?.invoice_payment_terms_days ?? 30);
      })
      .catch((e) => { if (!cancelled) setProfileError(e.message || 'Could not load supplier profile'); })
      .finally(() => { if (!cancelled) setLoadingSupplier(false); });
    return () => { cancelled = true; };
  }, [open, supplierId]);

  // Detect a prior invoice so the CTA reads "Regenerate" and we can tell the
  // supplier the number stays the same / the total replaces the old one.
  useEffect(() => {
    if (!open || !orderId) { setExistingInvoice(null); return; }
    let cancelled = false;
    fetchInvoicesForOrder(orderId)
      .then((rows) => { if (!cancelled) setExistingInvoice((rows || [])[0] || null); })
      .catch(() => { if (!cancelled) setExistingInvoice(null); });
    return () => { cancelled = true; };
  }, [open, orderId]);

  // Derived: effective categories the supplier has enabled.
  const categories = useMemo(
    () => getEffectiveCategoriesForSupplier(supplier),
    [supplier]
  );

  // Seed lineCategories whenever the modal opens with a fresh items list.
  useEffect(() => {
    if (!open || !supplier || categories.length === 0) return;
    const seed = {};
    for (const it of items || []) {
      // Preserve any prior pick (e.g. user reopens the modal after error).
      seed[it.id] = lineCategories[it.id] || suggestCategoryForItem(it, categories);
    }
    setLineCategories(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier?.id, items?.length, categories.length]);

  // Reset the rest of the form when the modal opens.
  useEffect(() => {
    if (!open) return;
    setBondedSupply(false);
    setReverseCharge(false);
    setDiscountPct(0);
    setIssueDate(todayIso());
    setNotes('');
    setError(null);
  }, [open]);

  const dueDate = useMemo(() => addDays(issueDate, paymentTermsDays), [issueDate, paymentTermsDays]);
  const currency = supplier?.default_currency || 'EUR';
  const taxName = getTaxNameForSupplier(supplier);
  const ready = useMemo(() => isInvoicingReady(supplier), [supplier]);

  // Tax treatment as a single mutually-exclusive choice, mapped onto the two
  // underlying flags. Standard = neither; bonded and reverse-charge both zero-rate.
  const treatment = bondedSupply ? 'bonded' : reverseCharge ? 'reverse_charge' : 'standard';
  const setTreatment = (key) => {
    setBondedSupply(key === 'bonded');
    setReverseCharge(key === 'reverse_charge');
  };
  const treatmentOptions = [
    {
      key: 'standard',
      label: 'Standard',
      tip: `Each line is taxed at its own category rate. The usual choice.`,
    },
    {
      key: 'bonded',
      label: 'Bonded',
      tip: `Forces every line to 0% ${taxName}. Use for supplies under temporary admission / yacht-in-transit / customs-bonded rules.`,
    },
    {
      key: 'reverse_charge',
      label: 'Reverse charge',
      tip: `Zero-rates every line and prints a reverse-charge statement. Use for cross-border B2B where the customer self-accounts for ${taxName}.`,
    },
  ];

  // Jump straight to the tax-settings tab to add a missing VAT number.
  const goAddVatNumber = () => { onClose(); navigate('/supplier/workspace/tax'); };

  // Sprint 9.5: count items not yet in a billable state. Server-side check
  // in generateSupplierInvoice/index.ts is the canonical guard; this banner
  // surfaces the same constraint client-side so the supplier doesn't waste
  // a click.
  const blockingItems = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return items.filter((it) => {
      const qs = it.quote_status;
      return qs && qs !== 'agreed' && qs !== 'unavailable';
    });
  }, [items]);

  // ─── Live totals ────────────────────────────────────────────────────────
  // bonded OR reverse-charge zero-rate every line; an invoice-level discount
  // comes off the net before VAT (VAT is charged on the discounted base).
  const zeroRated = bondedSupply || reverseCharge;
  const discFactor = 1 - Math.max(0, Math.min(100, Number(discountPct) || 0)) / 100;
  const computed = useMemo(() => {
    if (!items) return { lines: [], subtotal: 0, discountAmount: 0, vatTotal: 0, total: 0, breakdown: [] };
    const lines = items.map((it) => {
      const catKey = bondedSupply ? 'bonded' : reverseCharge ? 'reverse_charge' : (lineCategories[it.id] || 'standard');
      const cat = categories.find((c) => c.key === catKey);
      const rate = zeroRated ? 0 : (cat?.rate ?? 0);
      const label = bondedSupply ? 'Bonded supply' : reverseCharge ? 'Reverse charge' : (cat?.label || 'Standard');
      const qty = Number(it.quantity) || 0;
      const price = Number(it.agreed_price ?? it.unit_price) || 0;
      const taxable = qty * price;
      const discountedNet = taxable * discFactor;
      const vat = discountedNet * rate / 100;
      return { item: it, catKey, rate, label, taxable, discountedNet, vat, total: discountedNet + vat };
    });
    const subtotal = lines.reduce((s, l) => s + l.taxable, 0);
    const discountedNet = lines.reduce((s, l) => s + l.discountedNet, 0);
    const discountAmount = subtotal - discountedNet;
    const vatTotal = lines.reduce((s, l) => s + l.vat, 0);
    const total = discountedNet + vatTotal;

    // Per-rate breakdown for the totals card (taxable = discounted base).
    const buckets = new Map();
    for (const l of lines) {
      const key = `${l.catKey}:${l.rate}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.taxable += l.discountedNet;
        existing.vat += l.vat;
      } else {
        buckets.set(key, { catKey: l.catKey, label: l.label, rate: l.rate, taxable: l.discountedNet, vat: l.vat });
      }
    }
    return { lines, subtotal, discountAmount, vatTotal, total, breakdown: Array.from(buckets.values()) };
  }, [items, lineCategories, categories, bondedSupply, reverseCharge, zeroRated, discFactor]);

  // ─── Submit ────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!ready.ready) return;
    if (blockingItems.length > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const payloadLines = computed.lines.map((l) => ({
        item_id: l.item.id,
        category_key: l.catKey,
        rate: l.rate,
        label: l.label,
      }));
      const result = await generateSupplierInvoice(orderId, {
        lines: payloadLines,
        issue_date: issueDate,
        due_date: dueDate,
        payment_terms_days: Number(paymentTermsDays) || 30,
        notes: notes || null,
        bonded_supply: bondedSupply,
        reverse_charge: reverseCharge,
        discount_pct: Number(discountPct) || 0,
        tax_name: taxName,
      });
      onGenerated?.(result);
      onClose();
      // Open the freshly-issued PDF in a new tab if the function returned a
      // signed URL — saves the supplier a click.
      if (result?.signed_url) {
        window.open(result.signed_url, '_blank', 'noopener');
      }
    } catch (e) {
      setError(e.message || 'Could not generate invoice');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────
  if (!open) return null;

  // Loading
  if (loadingSupplier) {
    return (
      <SupplierModal open={open} onClose={onClose} title="Generate invoice" className="gi-modal">
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted-strong)', fontSize: 13 }}>
          Loading invoicing settings…
        </div>
      </SupplierModal>
    );
  }

  // Profile load failed
  if (profileError) {
    return (
      <SupplierModal open={open} onClose={onClose} title="Generate invoice" className="gi-modal">
        <div style={{ padding: '24px 0', color: 'var(--red)', fontSize: 13 }}>
          {profileError}
        </div>
      </SupplierModal>
    );
  }

  // Setup needed
  if (!ready.ready) {
    const goToSettings = () => {
      onClose();
      window.location.href = '/supplier/workspace/tax';
    };
    return (
      <SupplierModal
        open={open} onClose={onClose} title="Generate invoice" className="gi-modal"
        footer={
          <>
            <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="sp-btn sp-btn-primary" onClick={goToSettings}>
              Open invoicing settings →
            </button>
          </>
        }
      >
        <div className="gi-setup">
          <strong>Setup needed.</strong> Before generating invoices you need to fill in:{' '}
          {ready.missing.join(', ')} on the Tax &amp; invoicing settings tab.
        </div>
      </SupplierModal>
    );
  }

  // Main form
  const isRegenerate = !!existingInvoice;
  const isPaid = existingInvoice?.status === 'paid';
  return (
    <SupplierModal
      open={open}
      onClose={onClose}
      title={isRegenerate ? 'Regenerate invoice' : 'Generate invoice'}
      className="gi-modal"
      footer={
        <>
          <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-primary"
            onClick={handleGenerate}
            disabled={submitting || !items || items.length === 0 || blockingItems.length > 0 || isPaid}
            title={isPaid
              ? 'This invoice has been paid and can’t be regenerated'
              : blockingItems.length > 0
                ? `${blockingItems.length} line${blockingItems.length === 1 ? '' : 's'} still awaiting agreement`
                : undefined}
          >
            {submitting
              ? (isRegenerate ? 'Regenerating…' : 'Generating…')
              : (isRegenerate ? 'Regenerate invoice' : 'Generate invoice')}
          </button>
        </>
      }
    >
      {/* Awaiting-agreement banner — blocks Generate until every line is
          agreed (or unavailable). Server-side guard in generateSupplierInvoice
          mirrors this so a manual API call can't bypass it. */}
      {blockingItems.length > 0 && (
        <div className="gi-alert">
          <strong>{blockingItems.length} line{blockingItems.length === 1 ? '' : 's'} still awaiting agreement.</strong>{' '}
          Resolve all quotes before generating an invoice. Items pending:{' '}
          {blockingItems.slice(0, 3).map((it) => it.item_name).join(', ')}
          {blockingItems.length > 3 && ` +${blockingItems.length - 3} more`}.
        </div>
      )}

      {error && <div className="gi-alert">{error}</div>}

      {/* Regenerate context — one invoice per order; regenerating replaces the
          existing one (same number, outstanding total updated), so the KPI
          isn't double-counted. */}
      {isRegenerate && (
        <div className="gi-note">
          <span>
            {isPaid ? (
              <><strong>{existingInvoice.invoice_number} is paid.</strong> A paid invoice can’t be regenerated.</>
            ) : (
              <><strong>Replaces {existingInvoice.invoice_number}.</strong> Regenerating keeps the same invoice number and updates the outstanding total — it won’t add a second invoice.</>
            )}
          </span>
        </div>
      )}

      {/* Tax treatment — one segmented row instead of two stacked toggle cards.
          Standard / Bonded / Reverse charge are mutually exclusive; each pill
          carries its full explanation as a hover/focus tooltip, and the caption
          below restates the active choice for touch users. */}
      <div className="gi-treat">
        <div className="gi-treat-head">
          <span className="gi-label">Tax treatment</span>
          <span
            className="gi-tip gi-info gi-tip-below"
            data-tip={DISCLAIMER}
            tabIndex={0}
            role="img"
            aria-label="About tax rates"
          ><Info size={12} strokeWidth={2.25} /></span>
        </div>
        <div className="gi-seg" role="group" aria-label="Tax treatment">
          {treatmentOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              className={`gi-seg-pill gi-tip gi-tip-below${treatment === o.key ? ' on' : ''}`}
              data-tip={o.tip}
              aria-pressed={treatment === o.key}
              onClick={() => setTreatment(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {supplier?.vat_registered !== false && !supplier?.vat_number && (
          <div className="gi-caption">
            No {taxName} number on file.{' '}
            <button type="button" className="gi-link" onClick={goAddVatNumber}>Add one →</button>
          </div>
        )}
      </div>

      {/* Lines */}
      <div className="gi-lines">
        <div className="gi-label">Line items</div>
        {(items || []).map((it) => {
          const computedLine = computed.lines.find((l) => l.item.id === it.id);
          return (
            <div key={it.id} className="gi-line">
              <div className="gi-line-name">
                <span className="gi-line-title"><b>{it.item_name}</b></span>
                <span className="gi-line-meta">
                  {it.quantity}{it.unit ? ' ' + it.unit : ''} · {fmtMoney(it.agreed_price ?? it.unit_price, currency)}
                </span>
              </div>
              {zeroRated ? (
                // Bonded / reverse-charge zero-rate the whole invoice — show that
                // per line instead of a stale "Standard rate (20%)" dropdown.
                <div className="gi-line-zero">Zero-rated · 0%</div>
              ) : (
                <select
                  className="gi-select gi-select-sm"
                  value={lineCategories[it.id] || ''}
                  onChange={(e) => setLineCategories((prev) => ({ ...prev, [it.id]: e.target.value }))}
                >
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>{c.label} ({c.rate}%)</option>
                  ))}
                </select>
              )}
              <div className="gi-line-total">{fmtMoney(computedLine?.total ?? 0, currency)}</div>
            </div>
          );
        })}
      </div>

      {/* Dates */}
      <div className="gi-fields">
        <div className="gi-field">
          <label className="gi-field-lab">Issue date</label>
          <input type="date" className="gi-input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </div>
        <div className="gi-field">
          <label className="gi-field-lab">Payment terms (days)</label>
          <input
            type="number" min="0" max="365" className="gi-input"
            value={paymentTermsDays}
            onChange={(e) => setPaymentTermsDays(Number(e.target.value) || 0)}
          />
          <div className="gi-field-hint">Due {fmtDMY(dueDate)}</div>
        </div>
        <div className="gi-field">
          <label className="gi-field-lab">Discount (%)</label>
          <input
            type="number" min="0" max="100" step="0.5" className="gi-input"
            value={discountPct}
            onChange={(e) => setDiscountPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
          />
          <div className="gi-field-hint">Applied to the net before {taxName}.</div>
        </div>
      </div>

      {/* Notes */}
      <div className="gi-field-full">
        <label className="gi-field-lab">Notes (optional)</label>
        <textarea
          className="gi-textarea"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything you'd like to surface to the customer on this invoice."
        />
      </div>

      {/* Totals */}
      <div className="gi-totals">
        <div className="gi-label">Totals preview</div>
        <div className="gi-totals-row">
          <span>Subtotal</span>
          <span>{fmtMoney(computed.subtotal, currency)}</span>
        </div>
        {computed.discountAmount > 0 && (
          <div className="gi-totals-row">
            <span>Discount ({Number(discountPct).toFixed(discountPct % 1 ? 1 : 0)}%)</span>
            <span>− {fmtMoney(computed.discountAmount, currency)}</span>
          </div>
        )}
        {computed.breakdown.length === 0 ? (
          <div className="gi-totals-row"><span>{taxName} (0%)</span><span>{fmtMoney(0, currency)}</span></div>
        ) : computed.breakdown.length === 1 ? (
          <div className="gi-totals-row">
            <span>{taxName} ({computed.breakdown[0].rate.toFixed(1)}%)</span>
            <span>{fmtMoney(computed.breakdown[0].vat, currency)}</span>
          </div>
        ) : (
          computed.breakdown.map((b) => (
            <div className="gi-totals-row" key={`${b.catKey}-${b.rate}`}>
              <span>{taxName} ({b.label}, {b.rate.toFixed(1)}%)</span>
              <span>{fmtMoney(b.vat, currency)}</span>
            </div>
          ))
        )}
        <div className="gi-grand">
          <span className="gi-grand-label">Total</span>
          <span className="gi-grand-val">{fmtMoney(computed.total, currency)}</span>
        </div>
      </div>
    </SupplierModal>
  );
}

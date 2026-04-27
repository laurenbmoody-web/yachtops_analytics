import React, { useEffect, useMemo, useState } from 'react';
import SupplierModal from './SupplierModal';
import {
  fetchSupplierProfileById,
  generateSupplierInvoice,
} from '../utils/supplierStorage';
import {
  getEffectiveCategoriesForSupplier,
  getTaxNameForSupplier,
  suggestCategoryForItem,
  isInvoicingReady,
} from '../utils/invoicingHelpers';

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
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${currency} ${num.toFixed(2)}`;
  }
};

export default function GenerateInvoiceModal({ orderId, items, supplierId, open, onClose, onGenerated }) {
  const [supplier, setSupplier] = useState(null);
  const [loadingSupplier, setLoadingSupplier] = useState(true);
  const [profileError, setProfileError] = useState(null);

  const [bondedSupply, setBondedSupply] = useState(false);
  const [issueDate, setIssueDate] = useState(todayIso());
  const [paymentTermsDays, setPaymentTermsDays] = useState(30);
  const [notes, setNotes] = useState('');

  // Map of item_id → category_key. Seeded from suggestCategoryForItem on open.
  const [lineCategories, setLineCategories] = useState({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

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
    setIssueDate(todayIso());
    setNotes('');
    setError(null);
  }, [open]);

  const dueDate = useMemo(() => addDays(issueDate, paymentTermsDays), [issueDate, paymentTermsDays]);
  const currency = supplier?.default_currency || 'EUR';
  const taxName = getTaxNameForSupplier(supplier);
  const ready = useMemo(() => isInvoicingReady(supplier), [supplier]);

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
  const computed = useMemo(() => {
    if (!items) return { lines: [], subtotal: 0, vatTotal: 0, total: 0, breakdown: [] };
    const lines = items.map((it) => {
      const catKey = bondedSupply ? 'bonded' : (lineCategories[it.id] || 'standard');
      const cat = categories.find((c) => c.key === catKey);
      const rate = bondedSupply ? 0 : (cat?.rate ?? 0);
      const label = bondedSupply ? 'Bonded supply' : (cat?.label || 'Standard');
      const qty = Number(it.quantity) || 0;
      const price = Number(it.agreed_price ?? it.unit_price) || 0;
      const taxable = qty * price;
      const vat = taxable * rate / 100;
      return { item: it, catKey, rate, label, taxable, vat, total: taxable + vat };
    });
    const subtotal = lines.reduce((s, l) => s + l.taxable, 0);
    const vatTotal = lines.reduce((s, l) => s + l.vat, 0);
    const total = subtotal + vatTotal;

    // Per-rate breakdown for the totals card.
    const buckets = new Map();
    for (const l of lines) {
      const key = `${l.catKey}:${l.rate}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.taxable += l.taxable;
        existing.vat += l.vat;
      } else {
        buckets.set(key, { catKey: l.catKey, label: l.label, rate: l.rate, taxable: l.taxable, vat: l.vat });
      }
    }
    return { lines, subtotal, vatTotal, total, breakdown: Array.from(buckets.values()) };
  }, [items, lineCategories, categories, bondedSupply]);

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
      <SupplierModal open={open} onClose={onClose} title="Generate invoice">
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted-strong)', fontSize: 13 }}>
          Loading invoicing settings…
        </div>
      </SupplierModal>
    );
  }

  // Profile load failed
  if (profileError) {
    return (
      <SupplierModal open={open} onClose={onClose} title="Generate invoice">
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
        open={open} onClose={onClose} title="Generate invoice"
        footer={
          <>
            <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="sp-btn sp-btn-primary" onClick={goToSettings}>
              Open invoicing settings →
            </button>
          </>
        }
      >
        <div style={{
          padding: 18, background: 'var(--bg-2)', borderRadius: 8,
          fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.55,
        }}>
          <strong>Setup needed.</strong> Before generating invoices you need to fill in:{' '}
          {ready.missing.join(', ')} on the Tax & invoicing settings tab.
        </div>
      </SupplierModal>
    );
  }

  // Main form
  return (
    <SupplierModal
      open={open}
      onClose={onClose}
      title="Generate invoice"
      footer={
        <>
          <button type="button" className="sp-btn sp-btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-primary"
            onClick={handleGenerate}
            disabled={submitting || !items || items.length === 0 || blockingItems.length > 0}
            title={blockingItems.length > 0
              ? `${blockingItems.length} line${blockingItems.length === 1 ? '' : 's'} still awaiting agreement`
              : undefined}
          >
            {submitting ? 'Generating…' : 'Generate invoice'}
          </button>
        </>
      }
    >
      {/* Awaiting-agreement banner — blocks Generate until every line is
          agreed (or unavailable). Server-side guard in generateSupplierInvoice
          mirrors this so a manual API call can't bypass it. */}
      {blockingItems.length > 0 && (
        <div style={{
          padding: '10px 14px',
          background: '#FEE2E2', border: '1px solid #FCA5A5',
          borderRadius: 8, fontSize: 12.5, color: '#991B1B',
          marginBottom: 14, lineHeight: 1.5,
        }}>
          <strong>{blockingItems.length} line{blockingItems.length === 1 ? '' : 's'} still awaiting agreement.</strong>{' '}
          Resolve all quotes before generating an invoice. Items pending:{' '}
          {blockingItems.slice(0, 3).map((it) => it.item_name).join(', ')}
          {blockingItems.length > 3 && ` +${blockingItems.length - 3} more`}.
        </div>
      )}

      {/* Disclaimer */}
      <div style={{
        padding: '10px 14px',
        background: '#FEF3C7', border: '1px solid #FDE68A',
        borderRadius: 8, fontSize: 12, color: '#92400E',
        marginBottom: 14, lineHeight: 1.5,
      }}>
        <strong>Heads up.</strong> {DISCLAIMER}
      </div>

      {error && (
        <div style={{
          marginBottom: 14, padding: '10px 14px',
          background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: 8, color: 'var(--red)', fontSize: 13,
        }}>{error}</div>
      )}

      {/* Bonded supply */}
      <label style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 12px', marginBottom: 16,
        border: `1px solid ${bondedSupply ? '#1E40AF' : 'var(--line)'}`,
        background: bondedSupply ? '#DBEAFE' : 'var(--card)',
        borderRadius: 8, cursor: 'pointer',
      }}>
        <input
          type="checkbox"
          checked={bondedSupply}
          onChange={(e) => setBondedSupply(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: bondedSupply ? '#1E3A8A' : 'var(--fg)' }}>
            Bonded yacht supply (zero-rate)
          </div>
          <div style={{ fontSize: 11.5, color: bondedSupply ? '#1E3A8A' : 'var(--muted-strong)', marginTop: 2, lineHeight: 1.45 }}>
            Forces every line to 0% {taxName}. Use for supplies under temporary admission /
            yacht-in-transit / customs-bonded supply rules.
          </div>
        </div>
      </label>

      {/* Lines */}
      <div style={{ marginBottom: 18 }}>
        <div style={{
          fontFamily: 'Syne', fontWeight: 600, fontSize: 10,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--muted-strong)', marginBottom: 8,
        }}>Line items</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(items || []).map((it) => {
            const computedLine = computed.lines.find((l) => l.item.id === it.id);
            return (
              <div key={it.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 160px 90px',
                alignItems: 'center', gap: 10,
                padding: '8px 10px',
                background: 'var(--card)',
                border: '1px solid var(--line)', borderRadius: 7,
              }}>
                <div style={{ fontSize: 12.5, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <strong>{it.item_name}</strong>
                  <span style={{ color: 'var(--muted-strong)', marginLeft: 6 }}>
                    {it.quantity}{it.unit ? ' ' + it.unit : ''} ·{' '}
                    {fmtMoney(it.agreed_price ?? it.unit_price, currency)}
                  </span>
                </div>
                <select
                  className="sp-field-input"
                  value={lineCategories[it.id] || ''}
                  onChange={(e) => setLineCategories((prev) => ({ ...prev, [it.id]: e.target.value }))}
                  disabled={bondedSupply}
                  style={{ fontSize: 12.5, padding: '6px 8px' }}
                >
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label} ({c.rate}%)
                    </option>
                  ))}
                </select>
                <div style={{
                  fontSize: 13, fontVariantNumeric: 'tabular-nums',
                  textAlign: 'right', color: 'var(--fg)', fontWeight: 600,
                }}>
                  {fmtMoney(computedLine?.total ?? 0, currency)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dates */}
      <div className="sp-field-row" style={{ marginBottom: 14 }}>
        <div className="sp-field" style={{ marginBottom: 0 }}>
          <label className="sp-field-label">Issue date</label>
          <input
            type="date"
            className="sp-field-input"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </div>
        <div className="sp-field" style={{ marginBottom: 0 }}>
          <label className="sp-field-label">Payment terms (days)</label>
          <input
            type="number"
            min="0"
            max="365"
            className="sp-field-input"
            value={paymentTermsDays}
            onChange={(e) => setPaymentTermsDays(Number(e.target.value) || 0)}
          />
          <div style={{ fontSize: 11, color: 'var(--muted-strong)', marginTop: 4 }}>
            Due {dueDate || '—'}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="sp-field" style={{ marginBottom: 14 }}>
        <label className="sp-field-label">Notes (optional)</label>
        <textarea
          className="sp-field-textarea"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything you'd like to surface to the customer on this invoice."
        />
      </div>

      {/* Totals card */}
      <div style={{
        marginTop: 4, padding: '14px 16px',
        background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8,
      }}>
        <div style={{
          fontFamily: 'Syne', fontWeight: 600, fontSize: 10,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--muted-strong)', marginBottom: 8,
        }}>Totals preview</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 4, fontSize: 12.5 }}>
          <div style={{ color: 'var(--muted-strong)' }}>Subtotal</div>
          <div style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg)' }}>{fmtMoney(computed.subtotal, currency)}</div>

          {computed.breakdown.length === 0 ? (
            <>
              <div style={{ color: 'var(--muted-strong)' }}>{taxName} (0%)</div>
              <div style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg)' }}>{fmtMoney(0, currency)}</div>
            </>
          ) : computed.breakdown.length === 1 ? (
            <>
              <div style={{ color: 'var(--muted-strong)' }}>{taxName} ({computed.breakdown[0].rate.toFixed(1)}%)</div>
              <div style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg)' }}>{fmtMoney(computed.breakdown[0].vat, currency)}</div>
            </>
          ) : (
            computed.breakdown.map((b) => (
              <React.Fragment key={`${b.catKey}-${b.rate}`}>
                <div style={{ color: 'var(--muted-strong)' }}>{taxName} ({b.label}, {b.rate.toFixed(1)}%)</div>
                <div style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg)' }}>{fmtMoney(b.vat, currency)}</div>
              </React.Fragment>
            ))
          )}

          <div style={{
            paddingTop: 8, marginTop: 4,
            borderTop: '1px solid var(--line)',
            fontFamily: 'Syne', fontWeight: 700, fontSize: 11,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'var(--muted-strong)',
            gridColumn: '1', alignSelf: 'center',
          }}>Total</div>
          <div style={{
            paddingTop: 8, marginTop: 4,
            borderTop: '1px solid var(--line)',
            fontFamily: 'Outfit', fontWeight: 800, fontSize: 18,
            letterSpacing: '-0.01em', color: 'var(--fg)',
            fontVariantNumeric: 'tabular-nums',
          }}>{fmtMoney(computed.total, currency)}</div>
        </div>
      </div>
    </SupplierModal>
  );
}

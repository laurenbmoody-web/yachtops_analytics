import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../../lib/supabaseClient';
import { createSupplierOrder, markOrderSent } from '../utils/provisioningStorage';
import { useAuth } from '../../../contexts/AuthContext';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { showToast } from '../../../utils/toast';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'CHF', 'SGD', 'AUD'];

const WHATSAPP_TEMPLATE = (order, items) => {
  const lines = [
    `*Order Request — ${order.vesselName || 'Vessel'}*`,
    order.orderRef ? `Ref: ${order.orderRef}` : null,
    '',
    '*Delivery Details*',
    order.deliveryPort    ? `Port: ${order.deliveryPort}` : null,
    order.deliveryDate    ? `Date: ${order.deliveryDate}` : null,
    order.deliveryTime    ? `Time: ${order.deliveryTime}` : null,
    order.deliveryContact ? `Contact: ${order.deliveryContact}` : null,
    order.specialInstructions ? `\n*Special Instructions*\n${order.specialInstructions}` : null,
    '',
    '*Items*',
    ...items.map((it, i) =>
      `${i + 1}. ${it.name || it.item_name} — ${it.quantity ?? it.qty ?? '?'} ${it.unit || ''}${it.notes ? ` (${it.notes})` : ''}`.trim()
    ),
  ];
  return lines.filter(l => l !== null).join('\n');
};

// ── Step indicators ──────────────────────────────────────────────────────────

const steps = ['Supplier', 'Delivery', 'Review & Send'];

function StepBar({ current }) {
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((label, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              i < current  ? 'bg-primary text-primary-foreground' :
              i === current ? 'bg-primary text-primary-foreground ring-2 ring-primary/30' :
              'bg-muted text-muted-foreground'
            }`}>
              {i < current ? <Icon name="Check" size={12} /> : i + 1}
            </div>
            <span className={`text-[10px] whitespace-nowrap ${i === current ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mx-1 mb-4 ${i < current ? 'bg-primary' : 'bg-border'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const SendToSupplierModal = ({
  isOpen, onClose, onSent,
  tenantId, listId, items = [],
  vesselName, vesselTypeLabel, orderRef, createdBy,
}) => {
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [sending, setSending] = useState(false);
  const [whatsappCopied, setWhatsappCopied] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);

  // Step 0 — supplier
  const [supplierMode, setSupplierMode] = useState('existing');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [newName,  setNewName]  = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');

  // Step 1 — delivery
  const [deliveryPort,    setDeliveryPort]    = useState('');
  const [deliveryDate,    setDeliveryDate]    = useState('');
  const [deliveryTime,    setDeliveryTime]    = useState('');
  const [deliveryContact, setDeliveryContact] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [currency, setCurrency] = useState('USD');

  // Reset all state when modal opens; default contact to current user's name
  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setSending(false);
    setWhatsappCopied(false);
    setSupplierMode('existing');
    setSelectedSupplierId('');
    setNewName(''); setNewEmail(''); setNewPhone('');
    setDeliveryPort(''); setDeliveryDate(''); setDeliveryTime('');
    const defaultContact =
      user?.user_metadata?.full_name ||
      user?.user_metadata?.first_name ||
      user?.email ||
      '';
    setDeliveryContact(defaultContact);
    setSpecialInstructions('');
    setCurrency('USD');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !tenantId) return;
    setSuppliersLoading(true);
    supabase.from('provisioning_suppliers')
      .select('id, name, email, phone')
      .eq('tenant_id', tenantId)
      .order('name')
      .then(({ data }) => { setSuppliers(data || []); setSuppliersLoading(false); });
  }, [isOpen, tenantId]);

  if (!isOpen) return null;

  // Resolve supplier details
  const selectedSupplier = suppliers.find(s => s.id === selectedSupplierId);
  const supplierName  = supplierMode === 'existing' ? (selectedSupplier?.name  || '') : newName;
  const supplierEmail = supplierMode === 'existing' ? (selectedSupplier?.email || '') : newEmail;
  const supplierPhone = supplierMode === 'existing' ? (selectedSupplier?.phone || '') : newPhone;

  // Step 0 is valid when: existing supplier selected, OR manual entry has name + valid email
  const step0Valid = supplierMode === 'existing'
    ? Boolean(selectedSupplierId)
    : Boolean(newName.trim()) && Boolean(newEmail.trim()) && newEmail.includes('@');

  const orderPayload = {
    vesselName, orderRef, supplierName, supplierEmail, supplierPhone,
    deliveryPort, deliveryDate, deliveryTime, deliveryContact,
    specialInstructions, currency,
  };

  // Advance step with validation gate on step 0 → 1 transition
  const handleNext = () => {
    if (step === 0) {
      if (!step0Valid) return;
      // For existing suppliers without email, warn but allow through
      if (supplierMode === 'existing' && !supplierEmail) {
        showToast('No email on file for this supplier — you can still copy via WhatsApp', 'error');
      }
    }
    setStep(s => s + 1);
  };

  // If an order already exists for this list + supplier, update sent_via to
  // 'both' instead of creating a duplicate row. Returns the existing order
  // if found (updated), or null if a new order should be created.
  const dedupeOrCreateOrder = async (newSentVia) => {
    if (supplierEmail) {
      const { data: existing } = await supabase
        .from('supplier_orders')
        .select('id, sent_via')
        .eq('list_id', listId)
        .eq('supplier_email', supplierEmail)
        .in('status', ['sent', 'draft'])
        .maybeSingle();
      if (existing?.id) {
        const mergedVia = existing.sent_via === newSentVia ? newSentVia : 'both';
        const { data: updated } = await supabase
          .from('supplier_orders')
          .update({ sent_via: mergedVia })
          .eq('id', existing.id)
          .select()
          .single();
        return updated || existing;
      }
    }
    return null;
  };

  const saveNewSupplierToDirectory = async () => {
    if (supplierMode !== 'new' || !supplierName) return;
    try {
      await supabase.from('provisioning_suppliers').insert({
        tenant_id: tenantId,
        name: supplierName,
        email: supplierEmail || null,
        phone: supplierPhone || null,
      });
    } catch (err) {
      console.warn('[SendToSupplierModal] supplier directory save failed (non-fatal):', err);
    }
  };

  const handleSendEmail = async () => {
    if (!supplierEmail || !supplierEmail.includes('@')) {
      showToast('Please enter a valid supplier email', 'error');
      return;
    }
    setSending(true);
    try {
      // Use existing order if one was already created for this supplier (dedup)
      let order = await dedupeOrCreateOrder('email');
      if (!order) {
        order = await createSupplierOrder({
          tenantId, listId, supplierName, supplierEmail, supplierPhone,
          deliveryPort, deliveryDate: deliveryDate || null, deliveryTime: deliveryTime || null,
          deliveryContact, specialInstructions, currency, items, createdBy,
          sentVia: 'email', vesselName,
        });
      }

      const { error: fnError } = await supabase.functions.invoke('sendSupplierOrder', {
        body: {
          to: supplierEmail,
          publicToken: order.public_token,
          replyTo: user?.email || null,
          senderName: user?.user_metadata?.full_name || user?.email || null,
          vesselTypeLabel: vesselTypeLabel || null,
          ...orderPayload,
          items: items.map(it => ({
            name: it.name, quantity: it.quantity, unit: it.unit, notes: it.notes,
            estimatedPrice: it.estimated_price ?? null,
          })),
        },
      });

      if (fnError) throw fnError;
      await markOrderSent(order.id, 'email');

      await supabase.from('provisioning_lists').update({ status: 'sent_to_supplier' }).eq('id', listId);
      await saveNewSupplierToDirectory();

      onSent && onSent(order);
      onClose();
    } catch (err) {
      console.error('[SendToSupplierModal] send error:', err);
      showToast(`Failed to send order: ${err.message || err}`, 'error');
    } finally {
      setSending(false);
    }
  };

  const handleCopyWhatsApp = async () => {
    const text = WHATSAPP_TEMPLATE(orderPayload, items);
    try {
      await navigator.clipboard.writeText(text);
      setWhatsappCopied(true);
      setTimeout(() => setWhatsappCopied(false), 2500);

      // Record the order as sent via WhatsApp (non-blocking)
      try {
        let order = await dedupeOrCreateOrder('whatsapp');
        if (!order) {
          order = await createSupplierOrder({
            tenantId, listId, supplierName, supplierEmail, supplierPhone,
            deliveryPort, deliveryDate: deliveryDate || null, deliveryTime: deliveryTime || null,
            deliveryContact, specialInstructions, currency, items, createdBy,
            sentVia: 'whatsapp', vesselName,
          });
        }
        await markOrderSent(order.id, order.sent_via || 'whatsapp');

        // Update provisioning list status to sent_to_supplier
        await supabase.from('provisioning_lists')
          .update({ status: 'sent_to_supplier' })
          .eq('id', listId);

        await saveNewSupplierToDirectory();
        onSent && onSent(order);
      } catch (orderErr) {
        console.warn('[SendToSupplierModal] WhatsApp order record failed (non-fatal):', orderErr);
      }
    } catch {
      showToast('Could not copy to clipboard.', 'error');
    }
  };

  // Price helpers for review table
  const hasAnyPrices = items.some(it => it.estimated_price != null && it.estimated_price > 0);
  const estimatedTotal = items.reduce((sum, it) => {
    return sum + (Number(it.estimated_price || 0) * Number(it.quantity || 0));
  }, 0);

  // ── Render steps ─────────────────────────────────────────────────────────

  const renderStep0 = () => (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSupplierMode('existing')}
          className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
            supplierMode === 'existing' ? 'border-primary bg-primary/5 text-foreground font-medium' : 'border-border text-muted-foreground hover:bg-muted/50'
          }`}
        >
          From directory
        </button>
        <button
          type="button"
          onClick={() => setSupplierMode('new')}
          className={`flex-1 py-2 text-sm rounded-lg border transition-colors ${
            supplierMode === 'new' ? 'border-primary bg-primary/5 text-foreground font-medium' : 'border-border text-muted-foreground hover:bg-muted/50'
          }`}
        >
          Enter manually
        </button>
      </div>

      {supplierMode === 'existing' ? (
        suppliersLoading ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
          </div>
        ) : suppliers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No suppliers in directory. Switch to manual entry.</p>
        ) : (
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {suppliers.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSupplierId(s.id)}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                  selectedSupplierId === s.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/40'
                }`}
              >
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon name="Package" size={13} className="text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{s.name}</p>
                  {(s.email || s.phone) && (
                    <p className="text-xs text-muted-foreground">{[s.email, s.phone].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Name <span className="text-destructive">*</span></label>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Marina Provisions Ltd"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Email <span className="text-destructive">*</span></label>
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="orders@supplier.com"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Phone / WhatsApp</label>
            <input
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
              placeholder="+1 234 567 8900"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
        </div>
      )}
    </div>
  );

  const renderStep1 = () => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-foreground mb-1 block">Port / Location</label>
          <input
            value={deliveryPort}
            onChange={e => setDeliveryPort(e.target.value)}
            placeholder="e.g. Monaco"
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground mb-1 block">Currency</label>
          <select
            value={currency}
            onChange={e => setCurrency(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          >
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-foreground mb-1 block">Delivery Date</label>
          <input
            type="date"
            value={deliveryDate}
            onChange={e => setDeliveryDate(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-foreground mb-1 block">Delivery Time</label>
          <input
            type="time"
            value={deliveryTime}
            onChange={e => setDeliveryTime(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-foreground mb-1 block">Contact on board</label>
        <input
          value={deliveryContact}
          onChange={e => setDeliveryContact(e.target.value)}
          placeholder="Name or phone number"
          className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-foreground mb-1 block">
          Special Instructions <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          value={specialInstructions}
          onChange={e => setSpecialInstructions(e.target.value)}
          rows={3}
          placeholder="e.g. Deliver to port gate 3, call on arrival"
          className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-4">
      {/* Supplier summary */}
      <div className="p-3 bg-muted/40 rounded-lg space-y-0.5">
        <p className="text-xs font-semibold text-foreground">{supplierName || '—'}</p>
        {supplierEmail && <p className="text-xs text-muted-foreground">{supplierEmail}</p>}
        {supplierPhone && <p className="text-xs text-muted-foreground">{supplierPhone}</p>}
      </div>

      {/* Delivery summary */}
      {(deliveryPort || deliveryDate) && (
        <div className="p-3 bg-teal-50 dark:bg-teal-900/20 border-l-2 border-teal-500 rounded-r-lg space-y-0.5">
          {deliveryPort    && <p className="text-xs text-foreground">Port: <span className="font-medium">{deliveryPort}</span></p>}
          {deliveryDate    && <p className="text-xs text-foreground">Date: <span className="font-medium">{deliveryDate}{deliveryTime ? ` at ${deliveryTime}` : ''}</span></p>}
          {deliveryContact && <p className="text-xs text-foreground">Contact: <span className="font-medium">{deliveryContact}</span></p>}
        </div>
      )}

      {/* Items table */}
      <div>
        <p className="text-xs font-semibold text-foreground mb-2">Items ({items.length})</p>
        <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/60 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Item</th>
                <th className="px-3 py-2 text-center font-medium text-muted-foreground">Qty</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Unit</th>
                {hasAnyPrices && <th className="px-3 py-2 text-right font-medium text-muted-foreground">Est. Price</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                  <td className="px-3 py-1.5 text-foreground">{it.name}</td>
                  <td className="px-3 py-1.5 text-center text-foreground">{it.quantity ?? '—'}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{it.unit || '—'}</td>
                  {hasAnyPrices && (
                    <td className="px-3 py-1.5 text-right text-foreground">
                      {it.estimated_price ? `${currency} ${Number(it.estimated_price).toFixed(2)}` : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {hasAnyPrices && estimatedTotal > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30">
                  <td colSpan={3} className="px-3 py-2 text-xs font-semibold text-foreground text-right">Estimated Total</td>
                  <td className="px-3 py-2 text-xs font-semibold text-foreground text-right">
                    {currency} {estimatedTotal.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Send buttons */}
      <div className="flex flex-col gap-2 pt-1">
        <button
          type="button"
          onClick={handleSendEmail}
          disabled={sending || !supplierEmail}
          className="w-full py-2.5 text-sm font-semibold text-white rounded-lg transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ background: '#00A8CC' }}
          title={!supplierEmail ? 'No email address for this supplier' : undefined}
        >
          {sending ? (
            <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Sending…</>
          ) : (
            <><Icon name="Mail" size={15} /> Send via Email</>
          )}
        </button>

        <button
          type="button"
          onClick={handleCopyWhatsApp}
          disabled={sending}
          className="w-full py-2.5 text-sm font-semibold text-white rounded-lg transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ background: whatsappCopied ? '#128C7E' : '#25D366' }}
        >
          {whatsappCopied ? (
            <><Icon name="Check" size={15} /> Copied!</>
          ) : (
            <><Icon name="MessageCircle" size={15} /> Copy for WhatsApp</>
          )}
        </button>

        {!supplierEmail && (
          <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
            No email on file — use WhatsApp copy or go back to add one.
          </p>
        )}
      </div>
    </div>
  );

  const modal = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">Send Order to Supplier</h3>
            {vesselName && <p className="text-sm text-muted-foreground mt-0.5">{vesselName}</p>}
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        <StepBar current={step} />

        {step === 0 && renderStep0()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}

        {/* Navigation */}
        {step < 2 && (
          <div className="flex gap-3 mt-5">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep(s => s - 1)} className="flex-1" disabled={sending}>
                Back
              </Button>
            )}
            <Button
              onClick={handleNext}
              disabled={step === 0 && !step0Valid}
              className="flex-1"
            >
              Next
            </Button>
          </div>
        )}

        {step === 2 && (
          <Button variant="outline" onClick={() => setStep(1)} className="w-full mt-4" disabled={sending}>
            Back
          </Button>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

export default SendToSupplierModal;

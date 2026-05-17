// Send orders to suppliers — Sprint 9c.3 Phase 8 (Batch 2, commit 5b).
//
// Auto-grouping redesign: the board's items are grouped by their
// supplier_profile_id. Each supplier group is one order, sent on its
// own. Items with no (or an archived) supplier_profile_id fall into an
// "Unassigned" bucket with an inline structured picker (+ add new);
// sending it back-fills the chosen supplier onto those items.
//
// First-pass visual — data flow is the priority; the editorial look is
// an iteration baseline (cream-warm group headers, navy actions).

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../../lib/supabaseClient';
import {
  createSupplierOrder,
  markOrderSent,
  fetchSuppliers,
  createSupplier,
  setItemsSupplierProfile,
} from '../utils/provisioningStorage';
import { useAuth } from '../../../contexts/AuthContext';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import SupplierPicker from './SupplierPicker';
import { showToast } from '../../../utils/toast';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'CHF', 'SGD', 'AUD'];

const WHATSAPP_TEMPLATE = (ctx, items) => {
  const lines = [
    `*Order Request — ${ctx.prefixedVesselName || ctx.vesselName || 'Vessel'}*`,
    ctx.orderRef ? `Ref: ${ctx.orderRef}` : null,
    '',
    '*Delivery Details*',
    ctx.deliveryPort ? `Port: ${ctx.deliveryPort}` : null,
    ctx.deliveryDate ? `Date: ${ctx.deliveryDate}` : null,
    ctx.deliveryTime ? `Time: ${ctx.deliveryTime}` : null,
    ctx.deliveryContact ? `Contact: ${ctx.deliveryContact}` : null,
    ctx.specialInstructions ? `\n*Special Instructions*\n${ctx.specialInstructions}` : null,
    '',
    '*Items*',
    ...items.map((it, i) =>
      `${i + 1}. ${it.name || it.item_name} — ${it.quantity ?? it.qty ?? '?'} ${it.unit || ''}${it.notes ? ` (${it.notes})` : ''}`.trim()),
  ];
  return lines.filter(l => l !== null).join('\n');
};

const itemKey = (it, i) => it.id || `${it.name}-${i}`;

const SendToSupplierModal = ({
  isOpen, onClose, onSent,
  tenantId, listId, items = [],
  vesselName, vesselTypeLabel, orderRef, createdBy,
}) => {
  const { user } = useAuth();

  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);

  // Shared delivery context (applies to every order sent this session)
  const [deliveryPort, setDeliveryPort] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('');
  const [deliveryContact, setDeliveryContact] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [currency, setCurrency] = useState('USD');

  const [sentItemKeys, setSentItemKeys] = useState(() => new Set());
  const [sendingKey, setSendingKey] = useState(null);   // group key being sent
  const [unassignedSupplierId, setUnassignedSupplierId] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setDeliveryPort(''); setDeliveryDate(''); setDeliveryTime('');
    setDeliveryContact(
      user?.user_metadata?.full_name || user?.user_metadata?.first_name || user?.email || '',
    );
    setSpecialInstructions('');
    setCurrency('USD');
    setSentItemKeys(new Set());
    setSendingKey(null);
    setUnassignedSupplierId('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !tenantId) return;
    setSuppliersLoading(true);
    fetchSuppliers(tenantId)
      .then((data) => setSuppliers(data || []))
      .catch(() => setSuppliers([]))
      .finally(() => setSuppliersLoading(false));
  }, [isOpen, tenantId]);

  const rawVesselType = (vesselTypeLabel || '').toLowerCase().trim();
  const vesselPfx = rawVesselType.includes('sail') ? 'S/Y' : 'M/Y';
  const prefixedVesselName = `${vesselPfx} ${vesselName || 'Vessel'}`;

  // ── Grouping ────────────────────────────────────────────────────
  const { groups, unassigned } = useMemo(() => {
    const byId = new Map(suppliers.map(s => [s.id, s]));
    const g = new Map();   // supplierId → { supplier, items: [{item,key}] }
    const un = [];          // { item, key, archivedOrigin }
    items.forEach((it, i) => {
      const key = itemKey(it, i);
      const spid = it.supplier_profile_id;
      if (spid && byId.has(spid)) {
        if (!g.has(spid)) g.set(spid, { supplier: byId.get(spid), items: [] });
        g.get(spid).items.push({ item: it, key });
      } else {
        un.push({ item: it, key, archivedOrigin: Boolean(spid) });
      }
    });
    return { groups: [...g.values()], unassigned: un };
  }, [items, suppliers]);

  const isSent = (k) => sentItemKeys.has(k);
  const groupUnsent = (gi) => gi.items.filter(x => !isSent(x.key));
  const unassignedUnsent = unassigned.filter(x => !isSent(x.key));
  const totalUnsent = items.length - sentItemKeys.size;
  const allDone = items.length > 0 && totalUnsent === 0;
  const readySupplierCount = groups.filter(gi => groupUnsent(gi).length > 0).length;

  const deliveryCtx = {
    vesselName, prefixedVesselName, orderRef,
    deliveryPort, deliveryDate, deliveryTime, deliveryContact,
    specialInstructions, currency,
  };

  // ── Send one group's order ──────────────────────────────────────
  const sendGroup = async ({ key, supplier, rows, via }) => {
    const unsent = rows.filter(r => !isSent(r.key));
    if (unsent.length === 0 || !supplier) return;
    const supplierName = supplier.name || '';
    const supplierEmail = supplier.email || '';
    const supplierPhone = supplier.phone || '';
    const orderItems = unsent.map(r => ({
      name: r.item.name, quantity: r.item.quantity, unit: r.item.unit,
      notes: r.item.notes, estimated_price: r.item.estimated_price ?? null,
    }));

    if (via === 'email' && (!supplierEmail || !supplierEmail.includes('@'))) {
      showToast(`${supplierName || 'This supplier'} has no email — use WhatsApp copy`, 'error');
      return;
    }

    setSendingKey(key);
    try {
      // Unassigned bucket: persist the chosen supplier onto the items
      // before the order is created so the data stays consistent.
      if (key === '__unassigned__') {
        const ids = unsent.map(r => r.item.id).filter(Boolean);
        if (ids.length) {
          const { error } = await setItemsSupplierProfile(ids, supplier.id, supplierName);
          if (error) console.warn('[SendToSupplierModal] back-fill failed (non-fatal):', error);
        }
      }

      const order = await createSupplierOrder({
        tenantId, listId, supplierName, supplierEmail, supplierPhone,
        deliveryPort, deliveryDate: deliveryDate || null, deliveryTime: deliveryTime || null,
        deliveryContact, specialInstructions, currency,
        items: orderItems, createdBy,
        sentVia: via, vesselName: prefixedVesselName,
        supplierProfileId: supplier.id || null,
      });

      if (via === 'email') {
        const { error: fnError } = await supabase.functions.invoke('sendSupplierOrder', {
          body: {
            to: supplierEmail,
            publicToken: order.public_token,
            supplierProfileId: order.supplier_profile_id || null,
            orderId: order.id,
            replyTo: user?.email || null,
            senderName: user?.user_metadata?.full_name || user?.email || null,
            ...deliveryCtx, supplierName, supplierEmail, supplierPhone,
            vesselName: prefixedVesselName,
            items: orderItems.map(it => ({
              name: it.name, quantity: it.quantity, unit: it.unit,
              notes: it.notes, estimatedPrice: it.estimated_price ?? null,
            })),
          },
        });
        if (fnError) throw fnError;
      } else {
        await navigator.clipboard.writeText(WHATSAPP_TEMPLATE(deliveryCtx, orderItems));
      }

      await markOrderSent(order.id, via);
      await supabase.from('provisioning_lists')
        .update({ status: 'sent_to_supplier' }).eq('id', listId);

      setSentItemKeys(prev => {
        const next = new Set(prev);
        unsent.forEach(r => next.add(r.key));
        return next;
      });
      showToast(
        via === 'email'
          ? `Order sent to ${supplierName}`
          : `${supplierName} order copied for WhatsApp`,
        'success',
      );
      onSent && onSent(order);
    } catch (err) {
      console.error('[SendToSupplierModal] send error:', err);
      showToast(`Failed to send: ${err.message || err}`, 'error');
    } finally {
      setSendingKey(null);
    }
  };

  const handleAddNewSupplier = async (name) => {
    try {
      const created = await createSupplier({ tenant_id: tenantId, name });
      if (created?.id) {
        setSuppliers(prev => [...prev, created]);
        setUnassignedSupplierId(created.id);
        return created;
      }
    } catch (err) {
      showToast('Could not add supplier', 'error');
    }
    return null;
  };

  if (!isOpen) return null;

  const unassignedSupplier = suppliers.find(s => s.id === unassignedSupplierId) || null;

  // ── Render ──────────────────────────────────────────────────────
  const inputCls = 'w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary';
  const HEADER_BG = '#FAEEDA';
  const ACCENT = '#C65A1A';
  const NAVY = '#262A53';

  const ItemRow = ({ row }) => {
    const sent = isSent(row.key);
    return (
      <div className="flex items-center justify-between px-3 py-1.5 text-xs border-t border-border/60"
        style={sent ? { opacity: 0.5 } : undefined}>
        <span style={sent ? { textDecoration: 'line-through' } : undefined} className="text-foreground">
          {row.item.name}
          {row.archivedOrigin && (
            <span className="ml-2 text-[10px] italic text-amber-600">Original supplier archived</span>
          )}
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          {row.item.quantity ?? '—'} {row.item.unit || ''}
          {sent && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ background: '#E1F5EE', color: '#0F6E56' }}>Sent</span>
          )}
        </span>
      </div>
    );
  };

  const GroupCard = ({ groupKey, supplier, rows }) => {
    const unsent = rows.filter(r => !isSent(r.key));
    const fullySent = unsent.length === 0;
    const busy = sendingKey === groupKey;
    return (
      <div className="border border-border rounded-xl overflow-hidden mb-3"
        style={fullySent ? { opacity: 0.6 } : undefined}>
        <div className="px-3 py-2.5 flex items-center justify-between"
          style={{ background: HEADER_BG }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: NAVY }}>{supplier?.name || 'Supplier'}</p>
            <p className="text-[11px]" style={{ color: ACCENT }}>
              {[supplier?.email, supplier?.phone].filter(Boolean).join(' · ') || 'No contact on file'}
            </p>
          </div>
          {fullySent ? (
            <span className="text-xs font-semibold flex items-center gap-1" style={{ color: '#0F6E56' }}>
              <Icon name="Check" size={14} /> Sent
            </span>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !!sendingKey}
                onClick={() => sendGroup({ key: groupKey, supplier, rows, via: 'whatsapp' })}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border disabled:opacity-50"
                style={{ borderColor: NAVY, color: NAVY }}
              >
                WhatsApp
              </button>
              <button
                type="button"
                disabled={busy || !!sendingKey}
                onClick={() => sendGroup({ key: groupKey, supplier, rows, via: 'email' })}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50 flex items-center gap-1.5"
                style={{ background: NAVY }}
              >
                {busy ? <><span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" /> Sending…</>
                  : <>Send to {supplier?.name?.split(' ')[0] || 'supplier'}</>}
              </button>
            </div>
          )}
        </div>
        <div className="bg-card">
          {rows.map(r => <ItemRow key={r.key} row={r} />)}
        </div>
      </div>
    );
  };

  const modal = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-foreground">Send orders</h3>
          <button onClick={onClose} disabled={!!sendingKey}
            className="text-muted-foreground hover:text-foreground transition-colors">
            <Icon name="X" size={18} />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          {items.length === 0
            ? 'Nothing to send'
            : `${readySupplierCount} ${readySupplierCount === 1 ? 'supplier' : 'suppliers'} ready · ${unassignedUnsent.length} ${unassignedUnsent.length === 1 ? 'item' : 'items'} unassigned`}
        </p>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No items on this board are ready to order.
          </p>
        ) : allDone ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
              style={{ background: '#E1F5EE', color: '#0F6E56' }}>
              <Icon name="Check" size={22} />
            </div>
            <p className="text-sm font-semibold text-foreground">All orders sent</p>
            <p className="text-xs text-muted-foreground mt-1">Every item has been ordered.</p>
            <Button onClick={onClose} className="mt-5">Done</Button>
          </div>
        ) : (
          <>
            {/* Shared delivery context */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <input className={inputCls} placeholder="Delivery port"
                value={deliveryPort} onChange={e => setDeliveryPort(e.target.value)} />
              <select className={inputCls} value={currency} onChange={e => setCurrency(e.target.value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input className={inputCls} type="date"
                value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
              <input className={inputCls} type="time"
                value={deliveryTime} onChange={e => setDeliveryTime(e.target.value)} />
              <input className={`${inputCls} col-span-2`} placeholder="Contact on board"
                value={deliveryContact} onChange={e => setDeliveryContact(e.target.value)} />
              <textarea className={`${inputCls} col-span-2`} rows={2}
                placeholder="Special instructions (optional)"
                value={specialInstructions} onChange={e => setSpecialInstructions(e.target.value)} />
            </div>

            {groups.map(gi => (
              <GroupCard
                key={gi.supplier.id}
                groupKey={gi.supplier.id}
                supplier={gi.supplier}
                rows={gi.items}
              />
            ))}

            {unassigned.length > 0 && (
              <div className="border border-dashed border-border rounded-xl overflow-hidden mb-3">
                <div className="px-3 py-2.5" style={{ background: '#F8FAFC' }}>
                  <p className="text-sm font-semibold text-foreground">Unassigned items</p>
                  <p className="text-[11px] text-muted-foreground">
                    Pick a supplier — it’s saved onto these items when you send.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1">
                      <SupplierPicker
                        value={unassignedSupplierId}
                        suppliers={suppliers}
                        inputClassName={inputCls}
                        placeholder={suppliersLoading ? 'Loading…' : 'Choose supplier'}
                        onChange={(p) => setUnassignedSupplierId(p ? p.id : '')}
                        allowAddNew
                        onAddNew={handleAddNewSupplier}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!unassignedSupplier || unassignedUnsent.length === 0 || !!sendingKey}
                      onClick={() => sendGroup({
                        key: '__unassigned__', supplier: unassignedSupplier,
                        rows: unassigned, via: 'email',
                      })}
                      className="px-3 py-2 text-xs font-semibold rounded-lg text-white disabled:opacity-50 whitespace-nowrap"
                      style={{ background: NAVY }}
                    >
                      {sendingKey === '__unassigned__'
                        ? 'Sending…'
                        : `Send (${unassignedUnsent.length})`}
                    </button>
                  </div>
                </div>
                <div className="bg-card">
                  {unassigned.map(r => <ItemRow key={r.key} row={r} />)}
                </div>
              </div>
            )}

            <button onClick={onClose} disabled={!!sendingKey}
              className="w-full mt-2 py-2 text-sm text-muted-foreground hover:text-foreground">
              Close — I’ll send the rest later
            </button>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

export default SendToSupplierModal;

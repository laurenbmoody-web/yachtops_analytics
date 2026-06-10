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
  cascadeItemsToOrdered,
} from '../utils/provisioningStorage';
import { useAuth } from '../../../contexts/AuthContext';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import SupplierPicker from './SupplierPicker';
import { showToast } from '../../../utils/toast';

import ModalShell from '../../../components/ui/ModalShell';
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
    ctx.requestedDeliveryLine ? `\n${ctx.requestedDeliveryLine}` : null,
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
  const [currency, setCurrency] = useState('');   // optional — supplier may propose their own

  const [sentItemKeys, setSentItemKeys] = useState(() => new Set());
  const [sentOrderCount, setSentOrderCount] = useState(0);
  const [sendingKey, setSendingKey] = useState(null);   // group key being sent
  const [sendingAll, setSendingAll] = useState(false);
  const [unassignedSupplierId, setUnassignedSupplierId] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setDeliveryPort(''); setDeliveryDate(''); setDeliveryTime('');
    setDeliveryContact(
      user?.user_metadata?.full_name || user?.user_metadata?.first_name || user?.email || '',
    );
    setCurrency('');
    setSentItemKeys(new Set());
    setSentOrderCount(0);
    setSendingKey(null);
    setSendingAll(false);
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

  // Dismiss gate — backdrop / Esc / × all prompt "Discard changes?" when
  // the user has typed something into the order context fields, or picked
  // a supplier for items still sitting in the Unassigned bucket. Sent
  // groups are committed progress, not unsaved input — closing a partly-
  // sent modal where nothing new has been typed should close cleanly.
  // isBusy holds the modal open during any send (per-group OR Send all).
  const defaultRequester =
    user?.user_metadata?.full_name || user?.user_metadata?.first_name || user?.email || '';
  const isDirty = (
    deliveryPort.trim() !== '' ||
    deliveryDate !== '' ||
    deliveryTime !== '' ||
    currency !== '' ||
    deliveryContact !== defaultRequester ||
    (unassigned.length > 0 && unassignedSupplierId !== '')
  );
  const isBusy = !!sendingKey || sendingAll;

  // Port / date / requester are mandatory so a supplier never receives
  // an order with no delivery context. Currency + time stay optional
  // (currency: supplier may counter-propose; time: defaults to 09:00).
  const requiredComplete =
    deliveryPort.trim() !== '' &&
    deliveryDate.trim() !== '' &&
    deliveryContact.trim() !== '';

  const fmtReqDate = (d) => {
    if (!d) return '';
    const dt = new Date(`${d}T00:00:00`);
    return Number.isNaN(dt.getTime())
      ? d
      : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const requestedDeliveryLine = (deliveryPort.trim() && deliveryDate.trim())
    ? `Requested delivery: ${fmtReqDate(deliveryDate)} at ${deliveryPort.trim()}. Please confirm or propose alternatives.`
    : '';

  const deliveryCtx = {
    vesselName, prefixedVesselName, orderRef,
    deliveryPort, deliveryDate,
    deliveryTime: deliveryTime || '09:00',   // morning-delivery default
    deliveryContact,
    specialInstructions: '',
    currency: currency || null,
    requestedDeliveryLine,
  };

  // ── Guarded board-status flip ──────────────────────────────────
  // The board only transitions to 'sent_to_supplier' if at least one
  // supplier_orders row was actually dispatched in this session — a
  // real send had a non-null email or phone, the edge function (for
  // email) or clipboard write (for WhatsApp) returned without
  // throwing, and markOrderSent committed. Per-group successful
  // sendGroup calls invoke this with dispatchedCount === 1. Send All
  // invokes it once at the end with the batch total.
  //
  // When dispatchedCount === 0 (no real dispatch happened), the
  // board status stays put and a blocking toast surfaces — modal
  // stays open so the user can fix the supplier assignment and
  // retry. This is the explicit invariant the prior inline flip
  // never enforced.
  const commitBoardStatusFlip = async (dispatchedCount, { surfaceBlocking = true } = {}) => {
    if (dispatchedCount > 0) {
      try {
        await supabase.from('provisioning_lists')
          .update({ status: 'sent_to_supplier' }).eq('id', listId);
      } catch (err) {
        console.error('[SendToSupplierModal] board status flip error:', err);
      }
    } else if (surfaceBlocking) {
      showToast(
        'No supplier assigned. Assign a supplier (with an email or phone) to these items before sending.',
        'error',
      );
    }
  };

  // ── Send one group's order ──────────────────────────────────────
  // silent: suppress per-call toast / sendingKey spinner and return a
  // result (used by Send all so it can show one consolidated toast).
  // skipClipboard: Send all's WhatsApp path opens wa.me instead of
  // copying (a batched clipboard write is meaningless / can throw).
  // Per-group callers pass neither → behaviour unchanged.
  const sendGroup = async ({ key, supplier, rows, via, silent = false, skipClipboard = false }) => {
    const unsent = rows.filter(r => !isSent(r.key));
    if (unsent.length === 0 || !supplier) return { ok: false, via, reason: 'empty' };
    // Safety net — buttons are disabled when this is false, but guard
    // here too so no path (incl. the Unassigned bucket) can send an
    // order missing its delivery context.
    if (!requiredComplete) {
      if (!silent) showToast('Complete the order context above to send', 'error');
      return { ok: false, via, reason: 'missing-fields' };
    }
    const supplierName = supplier.name || '';
    const supplierEmail = supplier.email || '';
    const supplierPhone = supplier.phone || '';
    const orderItems = unsent.map(r => ({
      name: r.item.name, quantity: r.item.quantity, unit: r.item.unit,
      notes: r.item.notes, estimated_price: r.item.estimated_price ?? null,
      // Quick Add strict-snapshot — pass through every field the
      // apply-favourite path needs to faithfully re-order this
      // specific item. createSupplierOrder persists them onto
      // supplier_order_items (see migration 20260604120000).
      brand:               r.item.brand          || null,
      size:                r.item.size           || null,
      category:            r.item.category       || null,
      sub_category:        r.item.sub_category   || null,
      department:          r.item.department     || null,
      allergen_flags:      r.item.allergen_flags || [],
      supplier_profile_id: r.item.supplier_profile_id || null,
    }));

    if (via === 'email' && (!supplierEmail || !supplierEmail.includes('@'))) {
      if (!silent) showToast(`${supplierName || 'This supplier'} has no email — use WhatsApp copy`, 'error');
      return { ok: false, via, reason: 'no-email' };
    }

    if (!silent) setSendingKey(key);
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
        deliveryPort, deliveryDate: deliveryDate || null,
        deliveryTime: deliveryTime || '09:00',
        deliveryContact, specialInstructions: '', currency: currency || null,
        items: orderItems, createdBy,
        sentVia: via, vesselName: prefixedVesselName,
        supplierProfileId: supplier.id || null,
      });

      if (via === 'email') {
        // TODO(9c.3): the supplier email body is composed server-side in
        // the `sendSupplierOrder` edge function — NOT redeployed this
        // sprint. `requestedDeliveryLine` ("Requested delivery: {date}
        // at {port}. Please confirm or propose alternatives.") is passed
        // below via ...deliveryCtx; wire it into the email template on
        // the next edge-function deploy. WhatsApp already includes it.
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
      } else if (!skipClipboard) {
        await navigator.clipboard.writeText(WHATSAPP_TEMPLATE(deliveryCtx, orderItems));
      }

      await markOrderSent(order.id, via);

      // Item lifecycle: flip this group's dispatched items draft → ordered.
      // Scoped to unsent[].item.id so a partial-dispatch session (2 of 3
      // groups succeed) honestly shows the failed group's items still
      // at draft. The helper's .in('status', ['draft']) defensive filter
      // (in cascadeItemsToOrdered) prevents flipping items already
      // settled in a delivery state.
      try {
        const dispatchedIds = unsent.map((r) => r.item?.id).filter(Boolean);
        if (dispatchedIds.length > 0) {
          await cascadeItemsToOrdered(dispatchedIds);
        }
      } catch (cascadeErr) {
        // Soft fail — the supplier_orders row is committed and
        // markOrderSent succeeded. The boat-side item statuses haven't
        // caught up; surfaced as a toast (when not silent) so the user
        // can refresh the items list. Doesn't block the rest of the
        // send flow.
        console.error('[SendToSupplierModal] item-status cascade error:', cascadeErr);
        if (!silent) {
          showToast('Order sent — item statuses may not have updated. Refresh to retry.', 'error');
        }
      }

      // Board-status flip is now gated by commitBoardStatusFlip — see
      // the helper above for the invariant. For per-group sends we
      // commit immediately on success (dispatchedCount = 1). Send All
      // suppresses this and commits once post-batch with the total.
      if (!silent) {
        await commitBoardStatusFlip(1, { surfaceBlocking: false });
      }

      setSentItemKeys(prev => {
        const next = new Set(prev);
        unsent.forEach(r => next.add(r.key));
        return next;
      });
      setSentOrderCount(c => c + 1);
      if (!silent) {
        showToast(
          via === 'email'
            ? `Order sent to ${supplierName}`
            : `${supplierName} order copied for WhatsApp`,
          'success',
        );
      }
      // Parent callback fires per-successful-send (cadence unchanged
      // from previous behaviour — the parent refetches supplier_orders
      // and runs its own UI updates per send). The { dispatched: true }
      // arg tells the parent that this send was a real dispatch and
      // its optimistic board-status flip is safe.
      onSent && onSent(order, { dispatched: true });
      return { ok: true, via, order };
    } catch (err) {
      console.error('[SendToSupplierModal] send error:', err);
      if (!silent) showToast(`Failed to send: ${err.message || err}`, 'error');
      return { ok: false, via, reason: 'error', error: err };
    } finally {
      if (!silent) setSendingKey(null);
    }
  };

  // ── Send all — orchestrate every ready group ───────────────────
  // Email-capable suppliers fire in parallel; WhatsApp-only ones open
  // wa.me sequentially (200ms stagger so the browser doesn't block
  // the tabs). Never touches the Unassigned bucket. One consolidated
  // toast at the end.
  const sendAll = async () => {
    if (!requiredComplete) {
      showToast('Complete the order context to send all', 'error');
      return;
    }
    const ready = groups
      .map(gi => ({ supplier: gi.supplier, rows: gi.items }))
      .filter(g => g.rows.some(r => !isSent(r.key)));

    const emailGroups = [];
    const waGroups = [];
    let skipped = 0;
    for (const g of ready) {
      const hasEmail = g.supplier.email && g.supplier.email.includes('@');
      const hasPhone = !!g.supplier.phone;
      if (hasEmail) emailGroups.push(g);
      else if (hasPhone) waGroups.push(g);
      else skipped += 1;
    }

    if (emailGroups.length === 0 && waGroups.length === 0) {
      // Zero groups reachable — let the guarded helper surface the
      // canonical blocking message so the wording stays in one place.
      await commitBoardStatusFlip(0, { surfaceBlocking: true });
      return;
    }

    setSendingAll(true);
    try {
      const emailResults = await Promise.all(emailGroups.map(g =>
        sendGroup({ key: g.supplier.id, supplier: g.supplier, rows: g.rows, via: 'email', silent: true })));

      const waResults = [];
      for (const g of waGroups) {
        // eslint-disable-next-line no-await-in-loop
        const res = await sendGroup({
          key: g.supplier.id, supplier: g.supplier, rows: g.rows,
          via: 'whatsapp', silent: true, skipClipboard: true,
        });
        waResults.push(res);
        if (res.ok) {
          const digits = String(g.supplier.phone || '').replace(/[^\d]/g, '');
          if (digits) window.open(`https://wa.me/${digits}`, '_blank', 'noopener');
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r => setTimeout(r, 200));
      }

      const emailOk = emailResults.filter(r => r && r.ok).length;
      const waOk = waResults.filter(r => r && r.ok).length;
      const sentN = emailOk + waOk;
      const totalAttempted = emailResults.length + waResults.length;
      const failed = totalAttempted - sentN;

      // Commit once for the whole batch. silent=true in the constituent
      // sendGroup calls suppressed the per-group commit, so this is
      // the single source of truth for the Send All path. If sentN
      // is zero the helper surfaces the blocking message; otherwise
      // it flips the board status.
      await commitBoardStatusFlip(sentN, { surfaceBlocking: sentN === 0 });

      if (sentN > 0) {
        let msg = failed > 0
          ? `Sent ${sentN} of ${totalAttempted} orders · ${failed} failed`
          : `Sent ${sentN} ${sentN === 1 ? 'order' : 'orders'} · ${emailOk} via email · ${waOk} via WhatsApp`;
        if (skipped > 0) msg += ` · ${skipped} skipped — add contact info to send`;
        showToast(msg, failed > 0 ? 'error' : 'success');
      }
      // sentN === 0: the helper already showed the blocking toast.
    } finally {
      setSendingAll(false);
    }
  };

  const sendableCount = groups.filter(gi =>
    groupUnsent(gi).length > 0 && (gi.supplier.email || gi.supplier.phone)).length;

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
  const labelCls = 'block text-[11px] font-medium mb-1';
  const ACCENT = '#C65A1A';        // terracotta
  const INK = '#1C1B3A';           // navy ink
  const MUTED = '#695880';         // muted navy
  const CREAM = '#F4EEE4';         // ready-group surface
  const HAIRLINE = '#DFD8CC';
  const FAINT = '#B4B2A9';
  const SERIF = "'DM Serif Display', Georgia, serif";

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  const SerifTitle = ({ text }) => (
    <span style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 500, color: INK, lineHeight: 1.1 }}>
      {text}<span style={{ color: ACCENT }}>.</span>
    </span>
  );

  const subtitle = allDone
    ? plural(sentOrderCount, 'order') + ' created'
    : plural(readySupplierCount, 'supplier') + ' ready'
      + (unassignedUnsent.length > 0 ? ` · ${plural(unassignedUnsent.length, 'item')} unassigned` : '');

  const ActionButtons = ({ supplier, groupKey, rows, busy, showWhatsApp = true }) => {
    const hasContact = Boolean(supplier?.email) || Boolean(supplier?.phone);
    const disabled = busy || !!sendingKey || sendingAll || !hasContact || !requiredComplete;
    return (
      <div className="flex items-center gap-1.5">
        {showWhatsApp && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => sendGroup({ key: groupKey, supplier, rows, via: 'whatsapp' })}
            className="px-3 text-[11px] font-semibold rounded-lg border"
            style={hasContact && !disabled
              ? { height: 30, borderColor: INK, color: INK, background: 'transparent' }
              : { height: 30, borderColor: HAIRLINE, color: FAINT, background: 'transparent', cursor: 'not-allowed' }}
          >
            WhatsApp
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => sendGroup({ key: groupKey, supplier, rows, via: 'email' })}
          className="px-3 text-[11px] font-semibold rounded-lg text-white flex items-center gap-1.5"
          style={hasContact && !disabled
            ? { height: 30, background: INK }
            : { height: 30, background: '#D3D1C7', color: '#fff', cursor: 'not-allowed' }}
        >
          {busy
            ? <><span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" /> Sending…</>
            : 'Send'}
        </button>
      </div>
    );
  };

  const GroupCard = ({ supplier, rows }) => {
    const fullySent = rows.filter(r => !isSent(r.key)).length === 0;
    const busy = sendingKey === supplier.id;
    const hasContact = Boolean(supplier.email) || Boolean(supplier.phone);
    return (
      <div className="flex items-center justify-between mb-2.5"
        style={{ background: CREAM, borderRadius: 12, padding: '14px 16px', opacity: fullySent ? 0.6 : 1 }}>
        <div style={{ minWidth: 0 }}>
          <p className="text-sm truncate">
            <span style={{ color: INK, fontWeight: 500 }}>{supplier.name || 'Supplier'}</span>
            <span style={{ color: MUTED, fontWeight: 400 }}> · {plural(rows.length, 'item')}</span>
          </p>
          {hasContact ? (
            <p className="text-[11px] truncate" style={{ color: MUTED }}>
              {[supplier.email, supplier.phone].filter(Boolean).join(' · ')}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => window.open(`/provisioning/suppliers/${supplier.id}`, '_blank', 'noopener')}
              className="text-[11px] flex items-center gap-1 mt-0.5"
              style={{ color: ACCENT, fontWeight: 500 }}
            >
              <Icon name="Plus" size={11} /> Add contact
            </button>
          )}
        </div>
        {fullySent ? (
          <span className="text-xs font-semibold flex items-center gap-1 flex-shrink-0" style={{ color: '#0F6E56' }}>
            <Icon name="Check" size={14} /> Sent
          </span>
        ) : (
          <div className="flex-shrink-0 ml-3 flex flex-col items-end gap-1">
            <ActionButtons supplier={supplier} groupKey={supplier.id} rows={rows} busy={busy} />
            {hasContact && !requiredComplete && (
              <span className="text-[10px] italic text-right" style={{ color: MUTED }}>
                Complete the order context above to send
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  const modal = (
    <ModalShell onClose={onClose} isDirty={isDirty} isBusy={isBusy} panelClassName="bg-card border border-border rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <SerifTitle text={allDone ? 'All orders sent' : 'Send orders'} />
          <p className="text-[13px] mt-1.5" style={{ color: MUTED }}>{subtitle}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {!allDone && items.length > 0 && groups.length > 0 && (
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                disabled={sendableCount === 0 || sendingAll || !!sendingKey || !requiredComplete}
                onClick={sendAll}
                className="text-[12px] font-semibold rounded-lg text-white flex items-center gap-1.5"
                style={sendableCount > 0 && requiredComplete && !sendingAll && !sendingKey
                  ? { height: 32, padding: '0 16px', background: INK }
                  : { height: 32, padding: '0 16px', background: '#D3D1C7', color: '#fff', cursor: 'not-allowed' }}
              >
                {sendingAll
                  ? <><span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" /> Sending…</>
                  : 'Send all'}
              </button>
              {sendableCount > 0 && !requiredComplete && !sendingAll && !sendingKey && (
                <span className="text-[10px] italic text-right" style={{ color: MUTED }}>
                  Complete the order context to send all
                </span>
              )}
            </div>
          )}
          <button onClick={onClose} disabled={!!sendingKey || sendingAll}
            className="text-muted-foreground hover:text-foreground transition-colors">
            <Icon name="X" size={18} />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-center py-8" style={{ color: MUTED }}>
          No items on this board are ready to order.
        </p>
      ) : allDone ? (
        <div className="text-center py-6">
          <p className="text-sm" style={{ color: MUTED }}>{plural(sentOrderCount, 'order')} created.</p>
          <Button onClick={onClose} className="mt-5">Done</Button>
        </div>
      ) : (
        <>
          {/* Shared delivery context — applies to every order sent this
              session. Port / date / requester required; currency + time
              optional (estimates the supplier confirms on receipt). */}
          <div className="grid grid-cols-2 gap-3 mb-2">
            <div>
              <label className={labelCls} style={{ color: MUTED }}>
                Delivery port<span style={{ color: ACCENT }}> *</span>
              </label>
              <input className={inputCls} placeholder="e.g. Antibes"
                value={deliveryPort} onChange={e => setDeliveryPort(e.target.value)} />
            </div>
            <div>
              <label className={labelCls} style={{ color: MUTED }}>
                Currency<span style={{ color: MUTED, fontSize: 10 }}> (optional)</span>
              </label>
              <select className={inputCls} value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="">—</option>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={{ color: MUTED }}>
                Order By Date<span style={{ color: ACCENT }}> *</span>
              </label>
              <input className={inputCls} type="date"
                value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} />
            </div>
            <div>
              <label className={labelCls} style={{ color: MUTED }}>
                Time<span style={{ color: MUTED, fontSize: 10 }}> (optional)</span>
              </label>
              <input className={inputCls} type="time"
                value={deliveryTime} onChange={e => setDeliveryTime(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className={labelCls} style={{ color: MUTED }}>
                Requester Name<span style={{ color: ACCENT }}> *</span>
              </label>
              <input className={inputCls} placeholder="Who placed this order"
                value={deliveryContact} onChange={e => setDeliveryContact(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] italic mb-5" style={{ color: MUTED }}>
            Times, dates, and currency are estimates — confirm with supplier on receipt.
          </p>

          {groups.map(gi => (
            <GroupCard key={gi.supplier.id} supplier={gi.supplier} rows={gi.items} />
          ))}

          {unassigned.length > 0 && (
            <div className="mb-2.5"
              style={{ background: '#fff', border: `1px dashed ${HAIRLINE}`, borderRadius: 12, padding: '14px 16px' }}>
              <p className="text-sm">
                <span style={{ color: INK, fontWeight: 500 }}>Unassigned</span>
                <span style={{ color: MUTED, fontWeight: 400 }}> · {plural(unassigned.length, 'item')}</span>
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <SupplierPicker
                    value={unassignedSupplierId}
                    suppliers={suppliers}
                    inputClassName={inputCls}
                    placeholder={suppliersLoading ? 'Loading…' : 'Pick a supplier…'}
                    onChange={(p) => setUnassignedSupplierId(p ? p.id : '')}
                    allowAddNew
                    onAddNew={handleAddNewSupplier}
                  />
                </div>
                {unassignedSupplier && unassignedSupplier.phone && (
                  <button
                    type="button"
                    disabled={unassignedUnsent.length === 0 || !!sendingKey || sendingAll}
                    onClick={() => sendGroup({ key: '__unassigned__', supplier: unassignedSupplier, rows: unassigned, via: 'whatsapp' })}
                    className="px-3 text-[11px] font-semibold rounded-lg border flex-shrink-0"
                    style={{ height: 38, borderColor: INK, color: INK, background: 'transparent' }}
                  >
                    WhatsApp
                  </button>
                )}
                <button
                  type="button"
                  disabled={!unassignedSupplier || unassignedUnsent.length === 0 || !!sendingKey || sendingAll}
                  onClick={() => sendGroup({ key: '__unassigned__', supplier: unassignedSupplier, rows: unassigned, via: 'email' })}
                  className="px-4 text-[11px] font-semibold rounded-lg text-white flex-shrink-0"
                  style={unassignedSupplier && !sendingKey && !sendingAll
                    ? { height: 38, background: INK }
                    : { height: 38, background: '#D3D1C7', color: '#fff', cursor: 'not-allowed' }}
                >
                  {sendingKey === '__unassigned__' ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          )}

          <button onClick={onClose} disabled={!!sendingKey || sendingAll}
            className="w-full mt-4 pt-3 text-[13px] italic"
            style={{ color: INK, borderTop: `1px solid ${HAIRLINE}` }}>
            Close — I’ll send the rest later
          </button>
        </>
      )}
    </ModalShell>
  );

  return createPortal(modal, document.body);
};

export default SendToSupplierModal;

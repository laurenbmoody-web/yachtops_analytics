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
import DateInput from '../../../components/ui/DateInput';
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
import SupplierPicker from './SupplierPicker';
import { showToast } from '../../../utils/toast';

import ModalShell from '../../../components/ui/ModalShell';
import './send-to-supplier-modal.css';
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
  // Per-item supplier overrides applied from the Unassigned bucket — lets
  // the chief split a shopping list across multiple suppliers (select a
  // subset → assign → they break out into their own order). Keyed by item
  // id; each assignment also persists to provisioning_items so the split
  // survives. supplierOverrides shadows the items prop in effectiveItems.
  const [supplierOverrides, setSupplierOverrides] = useState({}); // id → {supplier_profile_id, supplier_name}
  const [selectedUnassigned, setSelectedUnassigned] = useState(() => new Set()); // item ids
  const [assignPickerId, setAssignPickerId] = useState('');   // supplier to assign the selection to
  const [assigning, setAssigning] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const toggleExpanded = (k) => setExpandedKeys((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

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
    setSupplierOverrides({});
    setSelectedUnassigned(new Set());
    setAssignPickerId('');
    setExpandedKeys(new Set());
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

  // Items with the chief's in-modal supplier assignments applied on top
  // of the persisted supplier_profile_id, so the grouping reflects splits
  // the moment they're made.
  const effectiveItems = useMemo(
    () => items.map(it => (it.id && supplierOverrides[it.id]
      ? { ...it, ...supplierOverrides[it.id] }
      : it)),
    [items, supplierOverrides],
  );

  // ── Grouping ────────────────────────────────────────────────────
  const { groups, unassigned } = useMemo(() => {
    const byId = new Map(suppliers.map(s => [s.id, s]));
    const g = new Map();   // supplierId → { supplier, items: [{item,key}] }
    const un = [];          // { item, key, archivedOrigin }
    effectiveItems.forEach((it, i) => {
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
  }, [effectiveItems, suppliers]);

  // Assignments now persist immediately (supplierOverrides → real groups),
  // so the visual list is just the grouped result.
  const visualGroups = groups;

  // Assign the selected unassigned items to a supplier — splits a mixed
  // shopping list across suppliers. Persists supplier_profile_id so the
  // split sticks, and applies it locally so the items break out into the
  // supplier's order straight away.
  const assignSelectedToSupplier = async (supplierId) => {
    const picked = suppliers.find(s => s.id === supplierId);
    const ids = unassigned
      .filter(r => selectedUnassigned.has(r.item.id) && r.item.id)
      .map(r => r.item.id);
    if (!picked || ids.length === 0) return;
    setAssigning(true);
    try {
      const { error } = await setItemsSupplierProfile(ids, picked.id, picked.name || null);
      if (error) throw error;
      setSupplierOverrides(prev => {
        const next = { ...prev };
        ids.forEach(id => { next[id] = { supplier_profile_id: picked.id, supplier_name: picked.name || null }; });
        return next;
      });
      setSelectedUnassigned(new Set());
      setAssignPickerId('');
      showToast(`${ids.length} ${ids.length === 1 ? 'item' : 'items'} assigned to ${picked.name || 'supplier'}`, 'success');
    } catch (e) {
      console.error('[SendToSupplierModal] assign selected failed:', e);
      showToast('Could not assign items — try again', 'error');
    } finally {
      setAssigning(false);
    }
  };

  const isSent = (k) => sentItemKeys.has(k);
  const groupUnsent = (gi) => gi.items.filter(x => !isSent(x.key));
  const unassignedUnsent = unassigned.filter(x => !isSent(x.key));
  const totalUnsent = items.length - sentItemKeys.size;
  const allDone = items.length > 0 && totalUnsent === 0;
  const readySupplierCount = visualGroups.filter(gi => groupUnsent(gi).length > 0).length;

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
    deliveryContact !== defaultRequester
    // Supplier assignments persist as they're made, so they're never
    // "unsaved" — no need to gate the close on them.
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
      : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
      // Backfill supplier on any item that doesn't already point at the
      // resolved supplier. Covers the original "Unassigned → assign"
      // case and the new "Unassigned merged into existing supplier"
      // case where a row's items[] is a mix of originally-assigned and
      // newly-picked items. Items that are already correct are
      // filtered out so this stays a no-op for them.
      const idsToBackfill = unsent
        .filter(r => r.item.id && r.item.supplier_profile_id !== supplier.id)
        .map(r => r.item.id);
      if (idsToBackfill.length) {
        const { error } = await setItemsSupplierProfile(idsToBackfill, supplier.id, supplierName);
        if (error) console.warn('[SendToSupplierModal] back-fill failed (non-fatal):', error);
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
    const ready = visualGroups
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

  const sendableCount = visualGroups.filter(gi =>
    groupUnsent(gi).length > 0 && (gi.supplier.email || gi.supplier.phone)).length;

  const handleAddNewSupplier = async (name) => {
    try {
      const created = await createSupplier({ tenant_id: tenantId, name });
      if (created?.id) {
        setSuppliers(prev => [...prev, created]);
        setAssignPickerId(created.id);
        return created;
      }
    } catch (err) {
      showToast('Could not add supplier', 'error');
    }
    return null;
  };

  if (!isOpen) return null;

  // ── Render ──────────────────────────────────────────────────────
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // Title is static "Send, to supplier." — terracotta italic qualifier
  // carries the brand voice; the dynamic counts live in the subtitle.
  const titleText = allDone ? 'All orders sent' : 'Send';
  const titleQualifier = allDone ? null : 'to supplier.';
  const subtitleBits = allDone
    ? [`${plural(sentOrderCount, 'order')} created`]
    : [
        `${plural(readySupplierCount, 'supplier')} ready`,
        unassignedUnsent.length > 0 ? `${plural(unassignedUnsent.length, 'item')} unassigned` : null,
      ].filter(Boolean);

  // Custom input className that overrides the legacy styling SupplierPicker
  // ships with — borderless input that sits inside the editorial field card.
  const pickerInputCls = 'stsm-picker-input';

  const ActionButtons = ({ supplier, groupKey, rows, busy, showWhatsApp = true }) => {
    const hasContact = Boolean(supplier?.email) || Boolean(supplier?.phone);
    const disabled = busy || !!sendingKey || sendingAll || !hasContact || !requiredComplete;
    return (
      <div className="stsm-btnpair">
        {showWhatsApp && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => sendGroup({ key: groupKey, supplier, rows, via: 'whatsapp' })}
            className={`stsm-btn stsm-btn-ghost${disabled ? ' is-disabled' : ''}`}
          >
            WhatsApp
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => sendGroup({ key: groupKey, supplier, rows, via: 'email' })}
          className={`stsm-btn stsm-btn-primary${disabled ? ' is-disabled' : ''}`}
        >
          {busy ? <><span className="stsm-spinner" /> Sending…</> : 'Send'}
        </button>
      </div>
    );
  };

  const ItemList = ({ rows }) => (
    <ul className="stsm-itemlist">
      {rows.map((r) => {
        const it = r.item;
        const qty = it.quantity != null ? `${it.quantity}${it.unit ? ` ${it.unit}` : ''}` : '';
        return (
          <li key={r.key} className={`stsm-itemrow${isSent(r.key) ? ' is-sent' : ''}`}>
            <span className="stsm-itemname">{it.name}</span>
            {qty && <span className="stsm-itemqty">{qty}</span>}
          </li>
        );
      })}
    </ul>
  );

  const GroupRow = ({ supplier, rows }) => {
    const fullySent = rows.filter(r => !isSent(r.key)).length === 0;
    const busy = sendingKey === supplier.id;
    const hasContact = Boolean(supplier.email) || Boolean(supplier.phone);
    const isOpen = expandedKeys.has(supplier.id);
    return (
      <div className={`stsm-row${fullySent ? ' is-sent' : ''}${isOpen ? ' is-open' : ''}`}>
        <button
          type="button"
          className="stsm-row-main"
          onClick={() => toggleExpanded(supplier.id)}
          aria-expanded={isOpen}
        >
          <span className={`stsm-chev${isOpen ? ' is-open' : ''}`}>
            <Icon name="ChevronRight" size={14} />
          </span>
          <span className="stsm-row-text">
            <span className="stsm-row-name">
              {supplier.name || 'Supplier'}
              <span className="stsm-row-meta"> · {plural(rows.length, 'item')}</span>
            </span>
            {hasContact ? (
              <span className="stsm-row-contact">
                {[supplier.email, supplier.phone].filter(Boolean).join(' · ')}
              </span>
            ) : (
              <span
                role="button"
                tabIndex={0}
                className="stsm-row-add"
                onClick={(e) => { e.stopPropagation(); window.open(`/provisioning/suppliers/${supplier.id}`, '_blank', 'noopener'); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); window.open(`/provisioning/suppliers/${supplier.id}`, '_blank', 'noopener'); } }}
              >
                <Icon name="Plus" size={11} /> Add contact
              </span>
            )}
          </span>
        </button>
        <div className="stsm-row-actions" onClick={(e) => e.stopPropagation()}>
          {fullySent ? (
            <span className="stsm-sent">
              <Icon name="Check" size={13} /> Sent
            </span>
          ) : (
            <>
              <ActionButtons supplier={supplier} groupKey={supplier.id} rows={rows} busy={busy} />
              {hasContact && !requiredComplete && (
                <span className="stsm-hint">Complete the order context above</span>
              )}
            </>
          )}
        </div>
        {isOpen && <ItemList rows={rows} />}
      </div>
    );
  };

  const UnassignedRow = () => {
    const isOpen = expandedKeys.has('__unassigned__');
    const selectableRows = unassigned.filter(r => r.item.id && !isSent(r.key));
    const selectedCount = selectableRows.filter(r => selectedUnassigned.has(r.item.id)).length;
    const allSelected = selectableRows.length > 0 && selectedCount === selectableRows.length;
    const toggleItem = (id) => setSelectedUnassigned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    const toggleAll = () => setSelectedUnassigned(() =>
      allSelected ? new Set() : new Set(selectableRows.map(r => r.item.id)));
    return (
      <div className={`stsm-row stsm-row-unassigned${isOpen ? ' is-open' : ''}`}>
        <button
          type="button"
          className="stsm-row-main"
          onClick={() => toggleExpanded('__unassigned__')}
          aria-expanded={isOpen}
        >
          <span className={`stsm-chev${isOpen ? ' is-open' : ''}`}>
            <Icon name="ChevronRight" size={14} />
          </span>
          <span className="stsm-row-text">
            <span className="stsm-row-name">
              Unassigned
              <span className="stsm-row-meta"> · {plural(unassigned.length, 'item')} waiting</span>
            </span>
            <span className="stsm-row-contact">
              Going to different suppliers? Tick the items for one supplier, assign, repeat.
            </span>
          </span>
        </button>

        {/* Split control — assign the ticked items to a supplier. They
            break out into that supplier's order above; the rest stay
            here for the next assignment. */}
        <div className="stsm-assign-bar" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="stsm-selectall" onClick={toggleAll} disabled={selectableRows.length === 0}>
            {allSelected ? 'Clear' : 'Select all'}
          </button>
          <div className="stsm-assign-picker">
            <SupplierPicker
              value={assignPickerId}
              suppliers={suppliers}
              inputClassName={pickerInputCls}
              placeholder={suppliersLoading ? 'Loading…' : 'Assign selected to…'}
              onChange={(p) => setAssignPickerId(p ? p.id : '')}
              allowAddNew
              onAddNew={handleAddNewSupplier}
            />
          </div>
          <button
            type="button"
            className={`stsm-btn stsm-btn-primary${(!assignPickerId || selectedCount === 0 || assigning) ? ' is-disabled' : ''}`}
            disabled={!assignPickerId || selectedCount === 0 || assigning}
            onClick={() => assignSelectedToSupplier(assignPickerId)}
          >
            {assigning ? <><span className="stsm-spinner" /> Assigning…</> : (selectedCount ? `Assign ${selectedCount}` : 'Assign')}
          </button>
        </div>

        {isOpen && (
          <ul className="stsm-itemlist stsm-itemlist-select">
            {unassigned.map((r) => {
              const it = r.item;
              const sent = isSent(r.key);
              const qty = it.quantity != null ? `${it.quantity}${it.unit ? ` ${it.unit}` : ''}` : '';
              const checked = it.id ? selectedUnassigned.has(it.id) : false;
              return (
                <li key={r.key} className={`stsm-itemrow stsm-itemrow-select${sent ? ' is-sent' : ''}`}>
                  <label className="stsm-itemcheck">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!it.id || sent}
                      onChange={() => it.id && toggleItem(it.id)}
                    />
                    <span className="stsm-itemname">{it.name}</span>
                  </label>
                  {qty && <span className="stsm-itemqty">{qty}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  const sendAllDisabled = sendableCount === 0 || sendingAll || !!sendingKey || !requiredComplete;

  const modal = (
    <ModalShell onClose={onClose} isDirty={isDirty} isBusy={isBusy} panelClassName="stsm-panel">
      <div className="stsm">
        <header className="stsm-head">
          <div className="stsm-titlewrap">
            <div className="stsm-title">
              {titleText}
              <span className="stsm-title-accent">{allDone ? '.' : ','}</span>
              {titleQualifier && <span className="stsm-title-q">{titleQualifier}</span>}
            </div>
            <div className="stsm-sub">
              {subtitleBits.map((bit, i) => (
                <React.Fragment key={bit}>
                  {i > 0 && <span className="stsm-sub-dot">·</span>}
                  {bit}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="stsm-head-actions">
            {!allDone && items.length > 0 && groups.length > 0 && (
              <button
                type="button"
                disabled={sendAllDisabled}
                onClick={sendAll}
                className={`stsm-btn stsm-btn-primary stsm-btn-sendall${sendAllDisabled ? ' is-disabled' : ''}`}
              >
                {sendingAll ? <><span className="stsm-spinner" /> Sending…</> : 'Send all'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={!!sendingKey || sendingAll}
              className="stsm-close"
              aria-label="Close"
            >
              <Icon name="X" size={18} />
            </button>
          </div>
        </header>

        {items.length === 0 ? (
          <div className="stsm-empty">No items on this board are ready to order.</div>
        ) : allDone ? (
          <div className="stsm-done">
            <p>{plural(sentOrderCount, 'order')} created.</p>
            <button type="button" className="stsm-btn stsm-btn-primary stsm-btn-large" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="stsm-body">
              {/* Shared delivery context — applies to every order this session. */}
              <section className="stsm-section">
                <h3 className="stsm-subhead is-first">Delivery Brief</h3>
                <div className="stsm-grid">
                  <div className="stsm-field">
                    <label className="stsm-label">
                      Delivery port<span className="req">*</span>
                    </label>
                    <div className="stsm-inputcard">
                      <input
                        placeholder="e.g. Antibes"
                        value={deliveryPort}
                        onChange={e => setDeliveryPort(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="stsm-field">
                    <label className="stsm-label">
                      Currency<span className="opt">optional</span>
                    </label>
                    <div className="stsm-inputcard">
                      <select value={currency} onChange={e => setCurrency(e.target.value)}>
                        <option value="">—</option>
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="stsm-field">
                    <label className="stsm-label">
                      Order by date<span className="req">*</span>
                    </label>
                    <div className="stsm-inputcard">
                      <DateInput
                        value={deliveryDate}
                        onChange={e => setDeliveryDate(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="stsm-field">
                    <label className="stsm-label">
                      Time<span className="opt">optional</span>
                    </label>
                    <div className="stsm-inputcard">
                      <input
                        type="time"
                        value={deliveryTime}
                        onChange={e => setDeliveryTime(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="stsm-field is-wide">
                    <label className="stsm-label">
                      Requester name<span className="req">*</span>
                    </label>
                    <div className="stsm-inputcard">
                      <input
                        placeholder="Who placed this order"
                        value={deliveryContact}
                        onChange={e => setDeliveryContact(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className="stsm-helper">
                  Times, dates, and currency are estimates — confirm with the supplier on receipt.
                </div>
              </section>

              <section className="stsm-section">
                <h3 className="stsm-subhead">Suppliers List</h3>
                <div className="stsm-grouplist">
                  {visualGroups.map(gi => (
                    <GroupRow key={gi.supplier.id} supplier={gi.supplier} rows={gi.items} />
                  ))}
                  {unassigned.length > 0 && <UnassignedRow />}
                </div>
              </section>
            </div>

            <footer className="stsm-foot">
              <button
                type="button"
                onClick={onClose}
                disabled={!!sendingKey || sendingAll}
                className="stsm-foot-btn"
              >
                Close — I’ll send the rest later
              </button>
            </footer>
          </>
        )}
      </div>
    </ModalShell>
  );

  return createPortal(modal, document.body);
};

export default SendToSupplierModal;

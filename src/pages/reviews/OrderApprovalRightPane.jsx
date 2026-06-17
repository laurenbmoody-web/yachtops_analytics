import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import Icon from '../../components/AppIcon';
import ModalShell from '../../components/ui/ModalShell';
import { decideProvisioningApproval } from '../provisioning/utils/provisioningStorage';
import { loadTrips, findTripByAnyId } from '../trips-management-dashboard/utils/tripStorage';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';

// OrderApprovalRightPane — decision-focused split-view right column.
// Layered information density: headline stats + submitter note above
// the fold, items + allergens + past-spend comparison below. Footer
// carries the decision buttons + delivery ETA.

const CURR_SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };

const tidyBoardType = (t) => {
  const upper = String(t || '').toUpperCase();
  if (upper === 'GENERAL') return 'BOARD';
  return upper;
};

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatDateShort(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch { return null; }
}

export default function OrderApprovalRightPane({ request, onResolved, onToast }) {
  const navigate = useNavigate();
  const [items, setItems]                   = useState([]);
  const [list, setList]                     = useState(null);
  const [trip, setTrip]                     = useState(null);
  const [allergenGuests, setAllergenGuests] = useState([]);
  const [pastSpend, setPastSpend]           = useState([]);
  const [supplierOrders, setSupplierOrders] = useState([]);
  const [loading, setLoading]               = useState(true);
  const [decisionModal, setDecisionModal]   = useState(null); // 'approve' | 'request_changes' | null
  const [comment, setComment]               = useState('');
  const [busy, setBusy]                     = useState(false);
  const [collapseUnchanged, setCollapseUnchanged] = useState(false);
  const [allergenOpen, setAllergenOpen]     = useState(false);
  const allergenRef = React.useRef(null);

  // Close allergen popover on outside-click / Escape — same pattern as
  // the board detail allergen chip so the interactions feel uniform.
  useEffect(() => {
    if (!allergenOpen) return undefined;
    const h = (e) => { if (allergenRef.current && !allergenRef.current.contains(e.target)) setAllergenOpen(false); };
    const k = (e) => { if (e.key === 'Escape') setAllergenOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [allergenOpen]);

  // Load everything in parallel when a different request is selected.
  useEffect(() => {
    if (!request?.list_id) {
      setItems([]); setList(null); setTrip(null); setAllergenGuests([]);
      setPastSpend([]); setSupplierOrders([]); return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Lookups in parallel.
      const [itemsRes, listRes, ordersRes] = await Promise.all([
        supabase
          .from('provisioning_items')
          .select('id, name, brand, size, quantity_ordered, unit, estimated_unit_cost, category, department, status, allergen_flags')
          .eq('list_id', request.list_id),
        supabase
          .from('provisioning_lists')
          .select('id, title, trip_id, port_location, currency, estimated_cost, actual_cost, department, tenant_id, board_type, created_at')
          .eq('id', request.list_id)
          .maybeSingle(),
        supabase
          .from('supplier_orders')
          .select('id, list_id, delivery_date, supplier_order_items(quantity, quoted_price, agreed_price, estimated_price)')
          .eq('list_id', request.list_id),
      ]);

      if (cancelled) return;
      const itemRows = itemsRes?.data || [];
      const listRow  = listRes?.data || null;
      const orderRows = ordersRes?.data || [];
      setItems(itemRows);
      setList(listRow);
      setSupplierOrders(orderRows);

      // Trip + allergens — only if list has a trip.
      if (listRow?.trip_id && listRow?.tenant_id) {
        try {
          const trips = await loadTrips();
          const linked = findTripByAnyId(trips, listRow.trip_id);
          if (cancelled) return;
          setTrip(linked || null);

          if (linked?.guests?.length) {
            const guestIds = new Set(linked.guests.map(g => g.guestId).filter(Boolean));
            const allGuests = await loadGuests(listRow.tenant_id).catch(() => []);
            const withAllergens = (allGuests || []).filter(g =>
              guestIds.has(g.id) && g.allergies?.trim()
            ).map(g => ({
              name: [g.firstName, g.lastName].filter(Boolean).join(' ') || 'Guest',
              allergies: g.allergies.trim(),
            }));
            if (!cancelled) setAllergenGuests(withAllergens);
          } else {
            if (!cancelled) setAllergenGuests([]);
          }
        } catch {
          if (!cancelled) { setTrip(null); setAllergenGuests([]); }
        }
      } else {
        setTrip(null);
        setAllergenGuests([]);
      }

      // Past spend — last 3 completed boards in same tenant, excluding this one.
      if (listRow?.tenant_id) {
        try {
          const { data: past } = await supabase
            .from('provisioning_lists')
            .select('id, title, actual_cost, estimated_cost, created_at, trip_id')
            .eq('tenant_id', listRow.tenant_id)
            .in('status', ['delivered', 'partially_delivered', 'delivered_with_discrepancies'])
            .neq('id', listRow.id)
            .order('created_at', { ascending: false })
            .limit(3);
          if (!cancelled) setPastSpend(past || []);
        } catch {
          if (!cancelled) setPastSpend([]);
        }
      }

      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [request?.list_id]);

  const currency = list?.currency || 'GBP';
  const symbol = CURR_SYMBOLS[currency] || '£';

  // Aggregations.
  const totals = useMemo(() => {
    let est = 0;
    items.forEach(it => {
      const qty = Number(it.quantity_ordered) || 0;
      const px  = Number(it.estimated_unit_cost) || 0;
      est += qty * px;
    });

    // Quoted total from supplier_order_items (quoted_price or agreed_price).
    let quoted = 0;
    let quotedAny = false;
    supplierOrders.forEach(o => {
      (o.supplier_order_items || []).forEach(it => {
        const px  = Number(it.agreed_price ?? it.quoted_price ?? 0);
        const qty = Number(it.quantity) || 0;
        if (px > 0) { quoted += qty * px; quotedAny = true; }
      });
    });

    return {
      itemCount: items.length,
      estimated: est,
      quoted:    quotedAny ? quoted : null,
      variance:  quotedAny ? quoted - est : null,
      variancePct: quotedAny && est > 0 ? ((quoted - est) / est) * 100 : null,
    };
  }, [items, supplierOrders]);

  // Group items by department.
  const byDept = useMemo(() => {
    const map = new Map();
    items.forEach(it => {
      const d = it.department || 'Uncategorised';
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(it);
    });
    return Array.from(map.entries()).map(([dept, rows]) => {
      const subtotal = rows.reduce((acc, r) =>
        acc + (Number(r.quantity_ordered) || 0) * (Number(r.estimated_unit_cost) || 0), 0);
      return { dept, rows, subtotal };
    });
  }, [items]);

  // Earliest delivery date across supplier_orders.
  const earliestDelivery = useMemo(() => {
    const dates = supplierOrders.map(o => o.delivery_date).filter(Boolean);
    if (dates.length === 0) return null;
    const iso = dates.sort()[0];
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const daysAway = Math.round((date.getTime() - Date.now()) / 86400000);
    return { iso, label: formatDateShort(iso), daysAway };
  }, [supplierOrders]);

  // Trip context strings.
  const tripDateRange = useMemo(() => {
    if (!trip?.startDate && !trip?.endDate) return null;
    const s = formatDateShort(trip.startDate);
    const e = formatDateShort(trip.endDate);
    if (s && e) return s === e ? s : `${s} – ${e}`;
    return s || e || null;
  }, [trip?.startDate, trip?.endDate]);

  const tripGuestCount = useMemo(() => {
    if (!Array.isArray(trip?.guests)) return 0;
    return trip.guests.filter(g => g.isActive).length || trip.guests.length;
  }, [trip?.guests]);

  const handleDecide = async (decision) => {
    if (!request?.id) return;
    if (decision === 'request_changes' && !comment.trim()) {
      onToast?.('Add a comment so the submitter knows what to fix.', { error: true });
      return;
    }
    setBusy(true);
    try {
      // Both decisions carry the optional note. Request changes
      // requires one (enforced above + RPC P0005); approve treats it
      // as advisory context (supplier swap, port change, delivery
      // instructions) that the submitter sees on the board's review
      // chip + history.
      const trimmed = comment.trim();
      await decideProvisioningApproval(
        request.id, decision,
        trimmed || null,
      );
      setDecisionModal(null);
      setComment('');
      onToast?.(decision === 'approve' ? 'Approved' : 'Changes requested');
      onResolved?.();
    } catch (err) {
      const code = err?.code;
      if (code === 'P0005') onToast?.('A comment is required.', { error: true });
      else if (code === 'P0006') onToast?.('Only the assigned approver can decide.', { error: true });
      else if (code === 'P0007') onToast?.('Already decided.', { error: true });
      else onToast?.('Failed to submit decision', { error: true });
    } finally {
      setBusy(false);
    }
  };

  const fmt = (n) => `${symbol}${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmt2 = (n) => `${symbol}${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="pv-dashboard ord-rp">
      {/* ── HEADER ──────────────────────────────────────────── */}
      <header className="ord-rp-head">
        <div className="ord-rp-head-top">
          <div className="ord-rp-eyebrow">
            PROVISIONING · {tidyBoardType(request?.board_type)}
            {request?.is_re_approval && (
              <span className="ord-rp-rebadge">QUOTE REVIEW</span>
            )}
          </div>
          <button
            type="button"
            className="ord-rp-deeplink"
            onClick={() => navigate(`/provisioning/${request?.list_id}`)}
            title="Open the full board"
          >
            <Icon name="ExternalLink" size={12} /> Open full board
          </button>
        </div>

        <h1 className="ord-rp-title">{request?.board_title || 'Untitled board'}</h1>

        <div className="ord-rp-submeta">
          <span>Submitted by <strong>{request?.submitter_name || 'Someone'}</strong></span>
          <span aria-hidden="true" className="ord-rp-dot">·</span>
          <span>{timeAgo(request?.created_at)}</span>
          {request?.is_re_approval && (
            <>
              <span aria-hidden="true" className="ord-rp-dot">·</span>
              <span>Re-submitted with supplier quote</span>
            </>
          )}
        </div>

        <div className="ord-rp-chips">
          {trip?.tripType && (
            <span className="ord-rp-chip">
              <Icon name="MapPin" size={12} className="ord-rp-chip-icon" />
              <strong>{trip.tripType}</strong>
            </span>
          )}
          {tripDateRange && (
            <span className="ord-rp-chip">
              <Icon name="Calendar" size={12} className="ord-rp-chip-icon" />
              <strong>{tripDateRange}</strong>
            </span>
          )}
          {tripGuestCount > 0 && (
            <span className="ord-rp-chip">
              <Icon name="Users" size={12} className="ord-rp-chip-icon" />
              <strong>{tripGuestCount} guest{tripGuestCount === 1 ? '' : 's'}</strong>
            </span>
          )}
          {list?.port_location && (
            <span className="ord-rp-chip">Port: <strong>&nbsp;{list.port_location}</strong></span>
          )}
          {allergenGuests.length > 0 && (
            <div className="ord-rp-chip-allergen-wrap" ref={allergenRef}>
              <button
                type="button"
                className="ord-rp-chip ord-rp-chip-warn ord-rp-chip-allergen"
                onClick={() => setAllergenOpen(v => !v)}
                aria-haspopup="dialog"
                aria-expanded={allergenOpen}
                title="Per-guest allergen breakdown"
              >
                <Icon name="AlertTriangle" size={12} className="ord-rp-chip-icon" />
                <strong>{allergenGuests.length} allergen{allergenGuests.length === 1 ? '' : 's'}</strong>
                <span aria-hidden="true" className="ord-rp-chip-caret">{allergenOpen ? '▾' : '›'}</span>
              </button>
              {allergenOpen && (
                <div className="pv-board-allergen-popover" role="dialog" aria-label="Allergen alert">
                  <div className="pv-board-allergen-popover-head">
                    <Icon
                      name="AlertTriangle"
                      style={{ width: 14, height: 14, color: 'var(--d-danger)', flexShrink: 0 }}
                      aria-hidden="true"
                    />
                    <span className="pv-board-allergen-popover-title">Allergen alert</span>
                  </div>
                  <div className="pv-board-allergen-popover-list">
                    {allergenGuests.map((g, i) => (
                      <div key={i} className="pv-board-allergen-popover-row">
                        <span className="pv-board-allergen-popover-name">{g.name}</span>
                        <span className="pv-board-allergen-popover-all">{g.allergies}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pv-board-allergen-popover-foot">
                    Highlighted rows may be affected
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── BODY ────────────────────────────────────────────── */}
      <div className="ord-rp-body">

        {/* Submitter note */}
        {request?.comment && (
          <div className="ord-rp-note">
            <div>
              <div className="ord-rp-note-eyebrow">Note from {request.submitter_name?.split(' ')[0] || 'submitter'}</div>
              <p className="ord-rp-note-body">"{request.comment}"</p>
            </div>
          </div>
        )}

        {/* Headline stats */}
        <div className="ord-rp-stats">
          <div className="ord-rp-stat">
            <div className="ord-rp-stat-label">Items</div>
            <div className="ord-rp-stat-val">{totals.itemCount}</div>
            <div className="ord-rp-stat-foot">across {byDept.length} dept{byDept.length === 1 ? '' : 's'}</div>
          </div>
          <div className="ord-rp-stat">
            <div className="ord-rp-stat-label">Estimated</div>
            <div className="ord-rp-stat-val">{fmt(totals.estimated)}</div>
            <div className="ord-rp-stat-foot">at chief's prices</div>
          </div>
          {totals.quoted != null ? (
            <>
              <div className="ord-rp-stat">
                <div className="ord-rp-stat-label">Quoted</div>
                <div className="ord-rp-stat-val">{fmt(totals.quoted)}</div>
                <div className="ord-rp-stat-foot">from supplier</div>
              </div>
              <div className="ord-rp-stat">
                <div className="ord-rp-stat-label">Variance</div>
                <div className="ord-rp-stat-val" style={{ color: totals.variance > 0 ? '#B45309' : totals.variance < 0 ? '#047857' : 'inherit' }}>
                  {totals.variance > 0 ? '+' : ''}{fmt(totals.variance)}
                </div>
                <div className="ord-rp-stat-foot">
                  <span className={totals.variance > 0 ? 'ord-rp-delta-up' : 'ord-rp-delta-down'}>
                    {totals.variance > 0 ? '▲' : '▼'} {Math.abs(totals.variancePct).toFixed(1)}%
                  </span> vs estimate
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="ord-rp-stat" style={{ opacity: 0.5 }}>
                <div className="ord-rp-stat-label">Quoted</div>
                <div className="ord-rp-stat-val" style={{ fontSize: 14 }}>—</div>
                <div className="ord-rp-stat-foot">no supplier quote yet</div>
              </div>
              <div className="ord-rp-stat" style={{ opacity: 0.5 }}>
                <div className="ord-rp-stat-label">Variance</div>
                <div className="ord-rp-stat-val" style={{ fontSize: 14 }}>—</div>
                <div className="ord-rp-stat-foot">awaiting quote</div>
              </div>
            </>
          )}
        </div>

        {/* Allergens: per-guest detail lives in the header chip's
            popover now — no inline banner here to avoid duplication. */}

        {/* Items */}
        <div className="ord-rp-section-head">
          <h2 className="ord-rp-section-h">
            Items<span style={{ color: 'var(--d-muted-soft)' }}>,</span> <em>across {byDept.length || 0} dept{byDept.length === 1 ? '' : 's'}</em><span style={{ color: 'var(--d-muted-soft)' }}>.</span>
          </h2>
        </div>

        {loading ? (
          <p className="ord-rp-loading">Loading items…</p>
        ) : items.length === 0 ? (
          <p className="ord-rp-loading">No items on this board.</p>
        ) : (
          byDept.map(({ dept, rows, subtotal }) => (
            <div key={dept} className="ord-rp-deptgroup">
              <div className="ord-rp-deptgroup-head">
                <span>
                  <span className="ord-rp-deptgroup-name">{dept}</span>
                  <span className="ord-rp-deptgroup-count" style={{ marginLeft: 6 }}>
                    {rows.length} item{rows.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="ord-rp-deptgroup-total">{fmt2(subtotal)}</span>
              </div>
              <table className="ord-rp-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th>Unit</th>
                    <th className="num">Unit price</th>
                    <th className="num">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(it => {
                    const qty = Number(it.quantity_ordered) || 0;
                    const px  = Number(it.estimated_unit_cost) || 0;
                    const sub = qty * px;
                    const hasAllergen = Array.isArray(it.allergen_flags) && it.allergen_flags.length > 0;
                    return (
                      <tr key={it.id}>
                        <td>
                          <div className="ord-rp-name">
                            {it.name || '—'}
                            {hasAllergen && (
                              <span className="ord-rp-item-flags">
                                <span className="ord-rp-item-flag allergen">{it.allergen_flags[0]}</span>
                              </span>
                            )}
                          </div>
                          {(it.brand || it.size) && (
                            <div className="ord-rp-brand">
                              {[it.brand, it.size].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          {it.category && <div className="ord-rp-cat">{it.category}</div>}
                        </td>
                        <td className="num">{qty || '—'}</td>
                        <td>{it.unit || '—'}</td>
                        <td className="num">{px > 0 ? fmt2(px) : '—'}</td>
                        <td className="num">{sub > 0 ? fmt2(sub) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))
        )}

        {/* Past spend */}
        {pastSpend.length > 0 && (
          <div className="ord-rp-past">
            <div className="ord-rp-past-title">Recent spend · this vessel</div>
            {pastSpend.map((p) => (
              <div key={p.id} className="ord-rp-past-row">
                <span>{p.title || 'Untitled'} · {formatDateShort(p.created_at)}</span>
                <span><strong>{fmt(p.actual_cost || p.estimated_cost || 0)}</strong></span>
              </div>
            ))}
            <div className="ord-rp-past-row ord-rp-past-row-current">
              <span>This board ({totals.quoted != null ? 'quoted' : 'estimated'})</span>
              <span><strong>{fmt(totals.quoted ?? totals.estimated)}</strong></span>
            </div>
          </div>
        )}
      </div>

      {/* ── FOOTER ────────────────────────────────────────── */}
      <footer className="ord-rp-foot">
        <div className="ord-rp-foot-eta">
          {earliestDelivery ? (
            <>
              <Icon name="Calendar" size={13} />
              <span>Delivery requested <strong>{earliestDelivery.label}</strong></span>
              {earliestDelivery.daysAway >= 0 && (
                <span style={{ color: 'var(--d-muted)' }}>
                  · {earliestDelivery.daysAway === 0 ? 'today' : `${earliestDelivery.daysAway} day${earliestDelivery.daysAway === 1 ? '' : 's'} away`}
                </span>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--d-muted-soft)' }}>No delivery date set yet</span>
          )}
        </div>
        <div className="ord-rp-foot-actions">
          <button
            type="button"
            className="ord-rp-btn ord-rp-btn-ghost"
            onClick={() => { setComment(''); setDecisionModal('request_changes'); }}
            disabled={busy}
          >
            <Icon name="AlertTriangle" size={14} /> Request changes
          </button>
          <button
            type="button"
            className="ord-rp-btn ord-rp-btn-primary"
            onClick={() => { setComment(''); setDecisionModal('approve'); }}
            disabled={busy}
          >
            <Icon name="Check" size={14} /> {busy ? 'Working…' : (request?.is_re_approval ? 'Approve quote' : 'Approve')}
          </button>
        </div>
      </footer>

      {/* Approve modal — confirmation step with optional note. Lets the
          approver dictate a supplier, port change, delivery instructions
          etc. as a comment on the approved request. Submitter sees it on
          the board's review chip + the History timeline. */}
      {decisionModal === 'approve' && (
        <ModalShell
          onClose={() => { if (!busy) { setDecisionModal(null); setComment(''); } }}
          isDirty={!!comment.trim()}
          isBusy={busy}
          panelClassName="pv-edit-modal pv-dashboard"
        >
          <div className="pv-edit-modal-head">
            <div>
              <span className="pv-edit-modal-eyebrow">Reviewer decision</span>
              <h2 className="pv-edit-modal-title">
                {request?.is_re_approval ? <>Approve, <em>quote</em>.</> : <>Approve, <em>order</em>.</>}
              </h2>
            </div>
            <button
              onClick={() => { setDecisionModal(null); setComment(''); }}
              className="pv-edit-modal-close"
              aria-label="Close"
              disabled={busy}
            >
              <Icon name="X" size={16} />
            </button>
          </div>
          <div className="pv-edit-modal-body">
            <p style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--d-muted)',
              margin: '0 0 14px',
              lineHeight: 1.5,
            }}>
              {request?.is_re_approval ? (
                <>Approving locks in the supplier's quote on this board. <strong style={{ color: 'var(--d-navy-deep)' }}>{request?.submitter_name?.split(' ')[0] || 'The submitter'}</strong> can then confirm the order with the supplier at the agreed prices.</>
              ) : (
                <>Approving releases the board back to <strong style={{ color: 'var(--d-navy-deep)' }}>{request?.submitter_name?.split(' ')[0] || 'the submitter'}</strong> so they can send it to a supplier.</>
              )}
            </p>
            <div className="pv-edit-modal-field">
              <label className="pv-edit-modal-label" htmlFor="ord-rp-approve-note">
                Note <span style={{ fontWeight: 500, color: 'var(--d-muted-soft)', textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <textarea
                id="ord-rp-approve-note"
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={3}
                className="pv-edit-modal-textarea"
                placeholder={request?.is_re_approval
                  ? "e.g. Accept the £20 increase on tuna, confirm 10am delivery, hold the wine order until next week…"
                  : "e.g. Use Frantoio Mediterranean for the oil, drop off at Antibes instead of Palma, delivery before 10am…"}
              />
            </div>
          </div>
          <div className="pv-edit-modal-foot">
            <div className="pv-edit-modal-actions">
              <button
                type="button"
                onClick={() => { setDecisionModal(null); setComment(''); }}
                className="pv-edit-modal-btn pv-edit-modal-btn-ghost"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDecide('approve')}
                disabled={busy}
                className="pv-edit-modal-btn pv-edit-modal-btn-primary"
              >
                {busy ? 'Approving…' : (request?.is_re_approval ? 'Approve quote' : 'Approve & release')}
              </button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Request changes modal */}
      {decisionModal === 'request_changes' && (
        <ModalShell
          onClose={() => { if (!busy) { setDecisionModal(null); setComment(''); } }}
          isDirty={!!comment.trim()}
          isBusy={busy}
          panelClassName="pv-edit-modal pv-dashboard"
        >
          <div className="pv-edit-modal-head">
            <div>
              <span className="pv-edit-modal-eyebrow">Reviewer decision</span>
              <h2 className="pv-edit-modal-title">Request, <em>changes</em>.</h2>
            </div>
            <button
              onClick={() => { setDecisionModal(null); setComment(''); }}
              className="pv-edit-modal-close"
              aria-label="Close"
              disabled={busy}
            >
              <Icon name="X" size={16} />
            </button>
          </div>
          <div className="pv-edit-modal-body">
            <div className="pv-edit-modal-field">
              <label className="pv-edit-modal-label" htmlFor="ord-rp-comment">What needs to change?</label>
              <textarea
                id="ord-rp-comment"
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={4}
                autoFocus
                className="pv-edit-modal-textarea"
                placeholder="Be specific so the submitter can act on it — quantities, missing items, supplier swap, etc."
              />
            </div>
          </div>
          <div className="pv-edit-modal-foot">
            <div className="pv-edit-modal-actions">
              <button
                type="button"
                onClick={() => { setDecisionModal(null); setComment(''); }}
                className="pv-edit-modal-btn pv-edit-modal-btn-ghost"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDecide('request_changes')}
                disabled={busy || !comment.trim()}
                className="pv-edit-modal-btn pv-edit-modal-btn-primary"
              >
                {busy ? 'Sending…' : 'Send to submitter'}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

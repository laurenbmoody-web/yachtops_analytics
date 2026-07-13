import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSupplier } from '../../../contexts/SupplierContext';
import { fetchClientProfile, fetchClientOrders, fetchClientInvoices, fetchMySupplierReviews } from '../utils/supplierStorage';
import EmptyState from '../components/EmptyState';

// One yacht client, rebuilt as an account page: value + health KPIs, a spend
// trend, what they reorder, where/when they take delivery, an activity feed,
// and AR — all derived from orders, items, invoices and reviews we already
// hold (no schema). Reached from the order title, the order's yacht card, or
// the clients list; all resolve to /supplier/clients/:tenantId.

const itemPrice = (i) => i.agreed_price ?? i.quoted_price ?? i.estimated_price ?? i.unit_price ?? 0;
const orderTotal = (o) => (o.supplier_order_items ?? []).reduce((s, i) => s + itemPrice(i) * (i.quantity ?? 1), 0);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—');
const fmtMoney0 = (a, cur = 'EUR') => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(a || 0);
const shortId = (id) => (id ? String(id).slice(0, 8).toUpperCase() : '—');
const pct = (f) => (f == null ? '—' : `${Math.round(f * 100)}%`);
const initialsOf = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const endOfDay = (d) => { const dt = new Date(d); dt.setHours(23, 59, 59, 999); return dt; };

const STATUS_TONE = {
  active:  { label: 'Active',  bg: 'rgba(5,150,105,0.12)',  fg: 'var(--green)' },
  paused:  { label: 'Paused',  bg: 'rgba(217,119,6,0.14)',  fg: 'var(--amber)' },
  blocked: { label: 'Blocked', bg: 'rgba(220,38,38,0.12)',  fg: 'var(--red)' },
};
const ORDER_TONE = (status) => {
  if (['delivered', 'received', 'invoiced', 'paid'].includes(status)) return { fg: 'var(--green)', label: status };
  if (['dispatched', 'out_for_delivery'].includes(status)) return { fg: 'var(--navy-app)', label: status };
  if (status === 'confirmed') return { fg: 'var(--navy-app)', label: 'confirmed' };
  if (['sent', 'pending', 'partially_confirmed', 'draft'].includes(status)) return { fg: 'var(--orange)', label: status };
  return { fg: 'var(--muted-strong)', label: status || '—' };
};

const SupplierClientDetail = () => {
  const { id: tenantId } = useParams();
  const navigate = useNavigate();
  const { supplier } = useSupplier();

  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!supplier?.id || !tenantId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchClientProfile(supplier.id, tenantId),
      fetchClientOrders(supplier.id, tenantId),
      fetchClientInvoices(supplier.id, tenantId).catch(() => []),
      fetchMySupplierReviews().catch(() => []),
    ])
      .then(([p, o, inv, rev]) => { setProfile(p); setOrders(o || []); setInvoices(inv || []); setReviews(rev || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [supplier?.id, tenantId]);

  const tenant = profile?.tenants;
  const vesselName = tenant?.name || orders[0]?.vessel_name || 'Yacht client';
  const currency = orders[0]?.currency || 'EUR';
  const tone = STATUS_TONE[profile?.status] || STATUS_TONE.active;

  const m = useMemo(() => {
    const lifetime = orders.reduce((s, o) => s + orderTotal(o), 0);
    const aov = orders.length ? lifetime / orders.length : 0;

    const byDate = [...orders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let cadence = null;
    if (byDate.length >= 2) {
      let sum = 0, n = 0;
      for (let i = 1; i < byDate.length; i++) {
        const g = (new Date(byDate[i].created_at) - new Date(byDate[i - 1].created_at)) / 86400000;
        if (g >= 0) { sum += g; n += 1; }
      }
      cadence = n ? sum / n : null;
    }
    const lastPlaced = byDate.length ? new Date(byDate[byDate.length - 1].created_at) : null;
    const nextDue = (cadence != null && lastPlaced) ? new Date(lastPlaced.getTime() + cadence * 86400000) : null;
    const overdue = nextDue ? nextDue.getTime() < Date.now() : false;

    const allItems = orders.flatMap((o) => o.supplier_order_items ?? []);
    const totalLines = allItems.length;
    const unavailable = allItems.filter((i) => i.status === 'unavailable').length;
    const substituted = allItems.filter((i) => i.status === 'substituted').length;
    const fillRate = totalLines ? (totalLines - unavailable) / totalLines : null;
    const subRate = totalLines ? substituted / totalLines : null;

    const deliveredOrders = orders.filter((o) => o.delivered_at && o.delivery_date);
    const onTime = deliveredOrders.length
      ? deliveredOrders.filter((o) => new Date(o.delivered_at) <= endOfDay(o.delivery_date)).length / deliveredOrders.length
      : null;

    const outstanding = invoices
      .filter((v) => ['sent', 'overdue', 'disputed'].includes(v.status))
      .reduce((s, v) => s + Number(v.amount || 0), 0);

    // Spend by month, last 12
    const base = new Date(); base.setDate(1);
    const buckets = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-GB', { month: 'short' }), value: 0 });
    }
    const bidx = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    for (const o of orders) {
      const dt = new Date(o.delivery_date || o.created_at);
      const k = `${dt.getFullYear()}-${dt.getMonth()}`;
      if (k in bidx) buckets[bidx[k]].value += orderTotal(o);
    }
    const maxSpend = Math.max(1, ...buckets.map((b) => b.value));

    // Order guide — how many orders included each item
    const itemCount = {};
    for (const o of orders) {
      const names = new Set((o.supplier_order_items ?? []).map((i) => i.item_name).filter(Boolean));
      for (const nm of names) itemCount[nm] = (itemCount[nm] || 0) + 1;
    }
    const topItems = Object.entries(itemCount).sort((a, b) => b[1] - a[1]).slice(0, 6);

    // Ports
    const portCount = {};
    for (const o of orders) { const p = (o.delivery_port || '').trim(); if (p) portCount[p] = (portCount[p] || 0) + 1; }
    const ports = Object.entries(portCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxPort = ports[0]?.[1] || 1;

    // Reviews attributed to this client's orders
    const orderIds = new Set(orders.map((o) => o.id));
    const myReviews = reviews.filter((r) => orderIds.has(r.orderId));
    const ratingGiven = myReviews.length ? myReviews.reduce((s, r) => s + r.rating, 0) / myReviews.length : null;

    // Activity feed — placed / delivered / review
    const feed = [];
    for (const o of orders) {
      feed.push({ t: new Date(o.created_at), kind: 'placed', order: o });
      if (o.delivered_at) feed.push({ t: new Date(o.delivered_at), kind: 'delivered', order: o });
    }
    for (const r of myReviews) feed.push({ t: new Date(r.createdAt), kind: 'review', review: r });
    feed.sort((a, b) => b.t - a.t);

    return { lifetime, aov, cadence, nextDue, overdue, fillRate, subRate, onTime, outstanding, buckets, maxSpend, topItems, ports, maxPort, ratingGiven, activity: feed.slice(0, 7) };
  }, [orders, invoices, reviews]);

  const contacts = useMemo(() => {
    const seen = new Map();
    for (const o of orders) {
      const name = (o.delivery_contact || '').trim();
      if (!name) continue;
      if (!seen.has(name)) seen.set(name, { name, phone: o.delivery_phone || null });
      else if (!seen.get(name).phone && o.delivery_phone) seen.get(name).phone = o.delivery_phone;
    }
    return [...seen.values()];
  }, [orders]);

  const messageYacht = () => {
    const params = new URLSearchParams();
    if (tenantId) params.set('yachtId', tenantId);
    navigate(params.toString() ? `/supplier/messages?${params}` : '/supplier/messages');
  };

  if (loading) {
    return <div className="sp-page"><div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 13 }}>Loading client…</div></div>;
  }
  if (error) {
    return (
      <div className="sp-page">
        <button type="button" className="scd-back" onClick={() => navigate('/supplier/clients')}>‹ Clients</button>
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--red)' }}>{error}</div>
      </div>
    );
  }

  return (
    <div className="sp-page">
      <button type="button" className="scd-back" onClick={() => navigate('/supplier/clients')}>‹ Clients</button>

      {/* Header */}
      <header className="scd-head">
        <div className="scd-mono">{initialsOf(vesselName)}</div>
        <div className="scd-head-main">
          <div className="scd-eyebrow">Yacht client</div>
          <h1 className="scd-title">{vesselName}</h1>
          <div className="scd-head-meta">
            <span className="scd-pill" style={{ background: tone.bg, color: tone.fg }}>
              <span className="scd-pill-dot" style={{ background: tone.fg }} />{tone.label}
            </span>
            {profile?.created_at && <span className="scd-since">Client since {fmtDate(profile.created_at)}</span>}
          </div>
        </div>
        <div className="scd-head-actions">
          <button type="button" className="scd-btn" onClick={messageYacht}>Message yacht</button>
        </div>
      </header>

      {/* KPI health band */}
      <div className="scd-kpis">
        <div className="scd-kpi"><div className="scd-kpi-n">{fmtMoney0(m.lifetime, currency)}</div><div className="scd-kpi-l">Lifetime value</div></div>
        <div className="scd-kpi"><div className="scd-kpi-n">{fmtMoney0(m.aov, currency)}</div><div className="scd-kpi-l">Avg order</div></div>
        <div className="scd-kpi"><div className="scd-kpi-n">{m.cadence != null ? `~${Math.round(m.cadence)}d` : '—'}</div><div className="scd-kpi-l">Order cadence</div></div>
        <div className={`scd-kpi${m.overdue ? ' warn' : ''}`}><div className="scd-kpi-n">{m.nextDue ? fmtDay(m.nextDue) : '—'}</div><div className="scd-kpi-l">{m.overdue ? 'Order overdue' : 'Next order due'}</div></div>
        <div className={`scd-kpi${m.onTime === 1 ? ' good' : ''}`}><div className="scd-kpi-n">{pct(m.onTime)}</div><div className="scd-kpi-l">On-time</div></div>
        <div className="scd-kpi"><div className="scd-kpi-n">{pct(m.fillRate)}</div><div className="scd-kpi-l">Fill rate</div></div>
        <div className="scd-kpi"><div className="scd-kpi-n">{pct(m.subRate)}</div><div className="scd-kpi-l">Substitution</div></div>
        <div className={`scd-kpi${m.outstanding > 0 ? ' warn' : ''}`}><div className="scd-kpi-n">{fmtMoney0(m.outstanding, currency)}</div><div className="scd-kpi-l">Outstanding</div></div>
      </div>

      {/* Spend trend */}
      <div className="scd-spark">
        <div className="scd-spark-h">
          <span className="scd-panel-h" style={{ margin: 0 }}>Spend · last 12 months</span>
          <span className="scd-spark-total">{fmtMoney0(m.lifetime, currency)} total</span>
        </div>
        <div className="scd-bars">
          {m.buckets.map((b, i) => (
            <span key={i} className="scd-bar-wrap" title={`${b.label}: ${fmtMoney0(b.value, currency)}`}>
              <i className={b.value > 0 ? '' : 'dim'} style={{ height: `${b.value > 0 ? Math.max(6, (b.value / m.maxSpend) * 100) : 2}%` }} />
              <span className="scd-bar-l">{b.label}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="scd-grid">
        {/* Left */}
        <div className="scd-main">
          <section className="scd-panel">
            <h2 className="scd-panel-h">Order guide — what they reorder</h2>
            {m.topItems.length === 0 ? (
              <p className="scd-empty-line">No items recorded yet.</p>
            ) : (
              <div className="scd-guide">
                {m.topItems.map(([name, count]) => (
                  <div key={name} className="scd-li"><span className="scd-li-q">{name}</span><span className="scd-li-v">×{count} order{count === 1 ? '' : 's'}</span></div>
                ))}
              </div>
            )}
          </section>

          <section className="scd-panel">
            <h2 className="scd-panel-h">Activity</h2>
            {m.activity.length === 0 ? (
              <p className="scd-empty-line">No activity yet.</p>
            ) : (
              <div className="scd-activity">
                {m.activity.map((a, i) => {
                  if (a.kind === 'review') {
                    return (
                      <div key={`r${i}`} className="scd-tl">
                        <span className="scd-tl-dot" style={{ background: 'var(--orange)' }} />
                        <span className="scd-tl-txt">Left a {a.review.rating}★ review{a.review.note ? ` — "${a.review.note.slice(0, 60)}${a.review.note.length > 60 ? '…' : ''}"` : ''}</span>
                        <span className="scd-tl-when">{fmtDay(a.review.createdAt)}</span>
                      </div>
                    );
                  }
                  const delivered = a.kind === 'delivered';
                  return (
                    <button key={`o${i}`} type="button" className="scd-tl scd-tl-btn" onClick={() => navigate(`/supplier/orders/${a.order.id}`)}>
                      <span className="scd-tl-dot" style={{ background: delivered ? 'var(--green)' : 'var(--faint)' }} />
                      <span className="scd-tl-txt">Order <b>#{shortId(a.order.id)}</b> {delivered ? 'delivered' : 'placed'} · {fmtMoney0(orderTotal(a.order), a.order.currency || currency)}</span>
                      <span className="scd-tl-when">{fmtDay(a.t)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="scd-panel">
            <h2 className="scd-panel-h">Order history</h2>
            {orders.length === 0 ? (
              <EmptyState icon="📦" title="No orders yet" body="Orders from this yacht will appear here." />
            ) : (
              <div className="scd-orders">
                {orders.map((o) => {
                  const ot = ORDER_TONE(o.status);
                  return (
                    <button key={o.id} type="button" className="scd-order" onClick={() => navigate(`/supplier/orders/${o.id}`)}>
                      <span className="scd-order-id">#{shortId(o.id)}</span>
                      <span className="scd-order-date">{fmtDate(o.delivery_date || o.created_at)}</span>
                      <span className="scd-order-items">{o.supplier_order_items?.length ?? 0} lines</span>
                      <span className="scd-order-status" style={{ color: ot.fg }}>{ot.label}</span>
                      <span className="scd-order-val">{fmtMoney0(orderTotal(o), o.currency || currency)}</span>
                      <span className="scd-order-caret">›</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right */}
        <aside className="scd-side">
          <section className="scd-panel">
            <h2 className="scd-panel-h">Preferred ports</h2>
            {m.ports.length === 0 ? (
              <p className="scd-empty-line">No delivery ports recorded.</p>
            ) : (
              <div className="scd-ports">
                {m.ports.map(([port, count]) => (
                  <div key={port} className="scd-port">
                    <span className="scd-port-n">{port}</span>
                    <span className="scd-port-bar"><i style={{ width: `${Math.round((count / m.maxPort) * 100)}%` }} /></span>
                    <span className="scd-port-c">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="scd-panel">
            <h2 className="scd-panel-h">Delivery contacts</h2>
            {contacts.length === 0 ? (
              <p className="scd-empty-line">No contacts recorded on their orders yet.</p>
            ) : (
              <div className="scd-contacts">
                {contacts.map((c) => (
                  <div key={c.name} className="scd-contact">
                    <span className="scd-contact-av">{initialsOf(c.name)}</span>
                    <span className="scd-contact-main">
                      <span className="scd-contact-name">{c.name}</span>
                      {c.phone && <a className="scd-contact-tel" href={`tel:${c.phone}`}>{c.phone}</a>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="scd-panel">
            <h2 className="scd-panel-h">Account</h2>
            <dl className="scd-defs">
              <div><dt>Payment terms</dt><dd>{profile?.payment_terms || '—'}</dd></div>
              <div><dt>Credit limit</dt><dd>{profile?.credit_limit != null ? fmtMoney0(profile.credit_limit, currency) : '—'}</dd></div>
              <div><dt>Outstanding</dt><dd>{fmtMoney0(m.outstanding, currency)}</dd></div>
              <div><dt>Rating they give you</dt><dd>{m.ratingGiven != null ? `${m.ratingGiven.toFixed(1)} ★` : '—'}</dd></div>
            </dl>
            {profile?.notes && <p className="scd-notes">{profile.notes}</p>}
          </section>
        </aside>
      </div>
    </div>
  );
};

export default SupplierClientDetail;

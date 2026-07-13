import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSupplier } from '../../../contexts/SupplierContext';
import { fetchClientProfile, fetchClientOrders } from '../utils/supplierStorage';
import EmptyState from '../components/EmptyState';

// One yacht client's profile: the relationship (status, terms) + this
// supplier's whole order history with them, plus the delivery contacts seen
// across those orders. Reached from the order title, the order's yacht card,
// or the clients list — all resolve to /supplier/clients/:tenantId.

const itemPrice = (i) => i.agreed_price ?? i.quoted_price ?? i.estimated_price ?? i.unit_price ?? 0;
const orderTotal = (o) => (o.supplier_order_items ?? []).reduce((s, i) => s + itemPrice(i) * (i.quantity ?? 1), 0);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const fmtMoney0 = (a, cur = 'EUR') => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(a || 0);
const shortId = (id) => (id ? String(id).slice(0, 8).toUpperCase() : '—');

const STATUS_TONE = {
  active:  { label: 'Active',  bg: 'rgba(5,150,105,0.12)',  fg: 'var(--green)' },
  paused:  { label: 'Paused',  bg: 'rgba(201,138,26,0.14)', fg: 'var(--amber)' },
  blocked: { label: 'Blocked', bg: 'rgba(192,57,43,0.12)',  fg: 'var(--red)' },
};

// Fulfilment stage → a compact pill tone, reusing the order-detail vocabulary.
const ORDER_TONE = (status) => {
  if (['delivered', 'received', 'invoiced', 'paid'].includes(status)) return { fg: 'var(--green)', label: status };
  if (['dispatched', 'out_for_delivery'].includes(status)) return { fg: 'var(--navy-app)', label: status };
  if (status === 'confirmed') return { fg: 'var(--navy-app)', label: 'confirmed' };
  if (['sent', 'pending', 'partially_confirmed', 'draft'].includes(status)) return { fg: 'var(--orange)', label: status };
  return { fg: 'var(--muted-strong)', label: status || '—' };
};

const initialsOf = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

const SupplierClientDetail = () => {
  const { id: tenantId } = useParams();
  const navigate = useNavigate();
  const { supplier } = useSupplier();

  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!supplier?.id || !tenantId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchClientProfile(supplier.id, tenantId),
      fetchClientOrders(supplier.id, tenantId),
    ])
      .then(([p, o]) => { setProfile(p); setOrders(o || []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [supplier?.id, tenantId]);

  const tenant = profile?.tenants;
  const vesselName = tenant?.vessel_name || tenant?.name || orders[0]?.vessel_name || 'Yacht client';
  const currency = orders[0]?.currency || 'EUR';
  const lifetime = useMemo(() => orders.reduce((s, o) => s + orderTotal(o), 0), [orders]);
  const lastOrder = orders[0]?.delivery_date || orders[0]?.created_at || null;
  const tone = STATUS_TONE[profile?.status] || STATUS_TONE.active;

  // Distinct delivery contacts seen across their orders — the human on the
  // dock. First phone we see for a name wins.
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
    return (
      <div className="sp-page">
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 13 }}>Loading client…</div>
      </div>
    );
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

      {/* Stat strip */}
      <div className="scd-stats">
        <div className="scd-stat">
          <div className="scd-stat-n">{orders.length}</div>
          <div className="scd-stat-l">Orders</div>
        </div>
        <div className="scd-stat">
          <div className="scd-stat-n">{fmtMoney0(lifetime, currency)}</div>
          <div className="scd-stat-l">Lifetime value</div>
        </div>
        <div className="scd-stat">
          <div className="scd-stat-n">{fmtDate(lastOrder)}</div>
          <div className="scd-stat-l">Last delivery</div>
        </div>
        <div className="scd-stat">
          <div className="scd-stat-n">{profile?.payment_terms || '—'}</div>
          <div className="scd-stat-l">Payment terms</div>
        </div>
      </div>

      <div className="scd-grid">
        {/* Order history */}
        <section className="scd-panel">
          <h2 className="scd-panel-h">Order history</h2>
          {orders.length === 0 ? (
            <EmptyState icon="📦" title="No orders yet" body="Orders from this yacht will appear here." />
          ) : (
            <div className="scd-orders">
              {orders.map((o) => {
                const ot = ORDER_TONE(o.status);
                return (
                  <button
                    key={o.id}
                    type="button"
                    className="scd-order"
                    onClick={() => navigate(`/supplier/orders/${o.id}`)}
                  >
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

        {/* Contacts + relationship */}
        <aside className="scd-side">
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
            <h2 className="scd-panel-h">Relationship</h2>
            <dl className="scd-defs">
              <div><dt>Status</dt><dd style={{ textTransform: 'capitalize' }}>{profile?.status || '—'}</dd></div>
              <div><dt>Payment terms</dt><dd>{profile?.payment_terms || '—'}</dd></div>
              <div><dt>Credit limit</dt><dd>{profile?.credit_limit != null ? fmtMoney0(profile.credit_limit, currency) : '—'}</dd></div>
            </dl>
            {profile?.notes && <p className="scd-notes">{profile.notes}</p>}
          </section>
        </aside>
      </div>
    </div>
  );
};

export default SupplierClientDetail;

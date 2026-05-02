import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import EditorialMetaStrip from '../../components/editorial/EditorialMetaStrip';
import '../pantry/pantry.css';
import {
  fetchSupplierProfileById,
  fetchSupplierOrdersBySupplierProfileId,
} from './utils/provisioningStorage';
import { showToast } from '../../utils/toast';
import { listSupportedCountries } from '../../data/countryTaxPresets';

// Sprint 9c.2 Commit 2 follow-up — minimal supplier detail page.
//
// Route: /provisioning/suppliers/:supplierProfileId
//
// Targets supplier_profiles.id directly (the unified portal directory),
// not the legacy provisioning_suppliers table — so the popover footer link
// from the order page lands on a meaningful destination without the
// fuzzy-name-match fragility.
//
// Composition:
//   - <Header /> + .editorial-page wrapper
//   - Custom editorial header: back link → /provisioning, meta strip
//     ({country} · {city} · {N orders} · last order {relative}), Georgia
//     headline ({supplier_name}.) and address subline
//   - Single editorial-section-card with section label "Orders." and a
//     table of all supplier_orders for this profile, newest-first
//   - Empty state copy when the supplier has no orders yet
//
// EditorialPageShell isn't used here for the same reason the order page
// rolls its own header: EditorialHeadline force-uppercases the title and
// requires an italic qualifier. Display-case multi-word supplier names
// need to render intact, and this page has no qualifier.

const EDITORIAL_BG = '#F5F1EA';

// ── Country code → display name lookup (shared pattern with SupplierOrderPage) ──
const COUNTRY_NAMES_BY_ISO2 = (() => {
  const out = {};
  try {
    for (const { iso2, name } of listSupportedCountries()) {
      if (iso2) out[iso2.toUpperCase()] = name;
    }
  } catch { /* presets unavailable — fall through */ }
  return out;
})();
const countryName = (iso) => {
  if (!iso) return null;
  const code = String(iso).toUpperCase();
  return COUNTRY_NAMES_BY_ISO2[code] || code;
};

// ── Helpers (mirror SupplierOrderPage's local utilities) ──
const fmtMoney = (n, currency = 'EUR') => {
  if (n == null || n === '') return '—';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(n)); }
  catch { return `${currency} ${Number(n).toFixed(2)}`; }
};
const shortRef = (id) => String(id || '').slice(0, 8).toUpperCase();
const fmtRelative = (iso) => {
  if (!iso) return '';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
};

// Lifecycle vocabulary mirrored from the order page so the supplier detail
// surface speaks the same status language.
const STATUS_LABELS = {
  sent:             'Sent',
  confirmed:        'Confirmed',
  dispatched:       'Dispatched',
  out_for_delivery: 'Out for delivery',
  received:         'Received',
  invoiced:         'Invoiced',
  paid:             'Paid',
  draft:            'Draft',
};
const STATUS_TONES = {
  draft:            'tonal-muted',
  sent:             'tonal-amber',
  confirmed:        'tonal-amber',
  dispatched:       'tonal-amber',
  out_for_delivery: 'tonal-amber',
  received:         'tonal-green',
  invoiced:         'tonal-green',
  paid:             'tonal-green',
};

// Per-order total used in the orders table. Falls back through agreed →
// quoted → estimated × qty, mirroring the same ordering used elsewhere.
function computeOrderTotal(order) {
  const items = order.supplier_order_items || [];
  return items.reduce((sum, it) => {
    const unit = Number(it.agreed_price ?? it.quoted_price ?? it.estimated_price) || 0;
    return sum + unit * (Number(it.quantity) || 0);
  }, 0);
}

export default function SupplierDetailPage() {
  const { supplierProfileId } = useParams();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Lift body bg to editorial cream while mounted (mirrors EditorialPageShell).
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = EDITORIAL_BG;
    return () => { document.body.style.background = prev; };
  }, []);

  useEffect(() => {
    if (!supplierProfileId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    Promise.all([
      fetchSupplierProfileById(supplierProfileId),
      fetchSupplierOrdersBySupplierProfileId(supplierProfileId).catch(() => []),
    ])
      .then(([p, o]) => {
        if (cancelled) return;
        if (!p) {
          setNotFound(true);
          showToast('Supplier not found', 'error');
          navigate('/provisioning/suppliers', { replace: true });
          return;
        }
        setProfile(p);
        setOrders(o);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[SupplierDetailPage] load failed:', err);
        setNotFound(true);
        showToast('Could not load supplier', 'error');
        navigate('/provisioning/suppliers', { replace: true });
      });
    return () => { cancelled = true; };
  }, [supplierProfileId, navigate]);

  const lastOrderAt = useMemo(() => orders[0]?.created_at || null, [orders]);

  if (loading) {
    return (
      <>
        <Header />
        <div className="editorial-page">
          <p style={{ padding: '40px 0', color: 'rgba(30,39,66,0.5)' }}>Loading supplier…</p>
        </div>
      </>
    );
  }

  if (notFound || !profile) {
    return null; // navigation effect already redirected
  }

  const fullCountry = profile.business_country ? countryName(profile.business_country) : null;
  const city = profile.business_city || null;

  // Editorial meta strip — uppercase tracked context row.
  const editorialMeta = [
    fullCountry && { icon: 'MapPin', label: fullCountry.toUpperCase() },
    city && { label: city.toUpperCase() },
    { label: `${orders.length} ${orders.length === 1 ? 'ORDER' : 'ORDERS'}` },
    lastOrderAt && { label: `LAST ORDER ${fmtRelative(lastOrderAt).toUpperCase()}`, muted: true },
  ].filter(Boolean);

  // Address subline — concatenate the parts we have. Falsy parts drop out.
  const addressParts = [
    profile.business_address_line1,
    profile.business_address_line2,
    [profile.business_postal_code, profile.business_city].filter(Boolean).join(' '),
    profile.business_state_region,
    fullCountry,
  ].filter((p) => p && String(p).trim());

  return (
    <>
      <Header />
      <div className="editorial-page">

        {/* Editorial header — back link · meta strip · headline · address.
            Custom render (not EditorialPageShell) so the supplier name keeps
            its display-case form and we don't force an italic qualifier. */}
        <div className="p-header-row">
          <div style={{ flex: 1 }}>
            <button
              className="p-back-link"
              onClick={() => navigate('/provisioning')}
              aria-label="Back to Provisioning"
            >
              Back to Provisioning
            </button>
            <EditorialMetaStrip meta={editorialMeta} />

            <h1 className="p-greeting" style={{ textTransform: 'none' }}>
              {profile.name}<span className="p-greeting-punctuation">.</span>
            </h1>
            {addressParts.length > 0 && (
              <p style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 11,
                fontWeight: 500,
                color: 'rgba(30, 39, 66, 0.55)',
                margin: '6px 0 0',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}>
                {addressParts.join(' · ')}
              </p>
            )}
          </div>
        </div>

        <div className="cargo-od" style={{ marginTop: 24 }}>
          <div className="editorial-section-card">
            <span className="cargo-od-section-label">Orders.</span>

            {orders.length === 0 ? (
              <p style={{
                fontSize: 13,
                color: 'rgba(30, 39, 66, 0.55)',
                fontStyle: 'italic',
                margin: '8px 0 0',
              }}>
                No orders yet with this supplier.
              </p>
            ) : (
              <table className="cargo-od-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Vessel</th>
                    <th>Board</th>
                    <th>Status</th>
                    <th className="num">Total</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const list = o.provisioning_lists || null;
                    const boardTitle = list?.title || '—';
                    const status = o.status || 'sent';
                    const tone = STATUS_TONES[status] || 'tonal-muted';
                    const label = STATUS_LABELS[status]
                      || status.replace(/_/g, ' ');
                    const total = computeOrderTotal(o);
                    const cur = o.currency
                      || (o.supplier_order_items && o.supplier_order_items[0]?.estimated_currency)
                      || 'EUR';
                    const onClick = () => {
                      if (!o.list_id) {
                        showToast('Order is not attached to a board', 'error');
                        return;
                      }
                      navigate(`/provisioning/${o.list_id}/orders/${o.id}`);
                    };
                    return (
                      <tr
                        key={o.id}
                        className="cargo-od-supplier-orders-row"
                        onClick={onClick}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onClick();
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          #{shortRef(o.id)}
                        </td>
                        <td>{o.vessel_name || '—'}</td>
                        <td>{boardTitle}</td>
                        <td>
                          <span className={`cargo-od-pill ${tone}`}>
                            {label}
                          </span>
                        </td>
                        <td className="num">
                          {total > 0 ? fmtMoney(total, cur) : '—'}
                        </td>
                        <td style={{ color: 'rgba(30, 39, 66, 0.55)' }}>
                          {fmtRelative(o.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

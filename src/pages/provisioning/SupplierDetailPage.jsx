import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchSupplierProfileById,
  fetchUserNames,
  updateSupplierNotes,
  updateSupplierContacts,
} from './utils/provisioningStorage';
import { showToast } from '../../utils/toast';
import { listSupportedCountries } from '../../data/countryTaxPresets';
import { getSupplierMetrics } from './supplier-detail/supplierMetrics';
import { fetchSupplierRatings } from './utils/marketplaceStorage';
import ReviewsModal from '../../components/reviews/ReviewsModal';
import './supplier-detail/supplier-detail.css';

// Compact half-star display for the reviews line (editorial palette).
const RatingStars = ({ value = 0 }) => (
  <span className="sd-rating-stars">
    {[1, 2, 3, 4, 5].map(i => {
      const fill = value >= i ? 100 : (value >= i - 0.5 ? 50 : 0);
      return (
        <span key={i} className="sd-rstar">
          <span className="b">★</span>
          <span className="f" style={{ width: `${fill}%` }}>★</span>
        </span>
      );
    })}
  </span>
);

// TODO(reporting-currency): hard-coded for v1. Swap for
// vessels.reporting_currency once that column exists.
const REPORTING_CURRENCY = 'EUR';

// Lighten/darken a hex colour for the dept deep-dive pill. pillBg = the
// colour at ~0.15 alpha; pillText = the colour itself. Computed at render
// (per Phase 1 note 2) so it scales to all 11 real departments and stays
// honest to the departments.color source.
const hexToRgba = (hex, alpha) => {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return `rgba(95, 94, 90, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// ─── Country code → display name ──────────────────────────────
// supplier_profiles.business_country is the ISO 2-letter code
// (e.g. "FR"). The meta strip in the mockup shows "FRANCE", so we
// resolve the code to its full name once at module load via the
// existing tax-preset country list. Unknown codes pass through.
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

// Sprint 9c.2 Phase 4 — Supplier Detail page redesign.
//
// Renders the role-scoped supplier dashboard described in
// docs/supplier_detail_page.html. The HTML mockup is the visual source
// of truth; this component is its React translation against:
//   - fetchSupplierProfileById  → supplier row (incl. notes / contacts)
//   - getSupplierMetrics        → live KPI + orders bundle (async,
//                                  Frankfurter-converted to reporting EUR)
//   - useAuth().tenantRole      → COMMAND / CHIEF gate
//
// Role scoping:
//   - COMMAND  → vessel-wide KPIs + Department spend section
//   - CHIEF    → dept-slice KPIs, no Department spend section
//
// Out of scope here (per brief):
//   - Real currency conversion (toggle is visual only)
//   - Filter drawer
//   - "View as this department" feature
//   - Real per-dept queries (mock returns canonical mockup values)

// ─── Helpers ─────────────────────────────────────────────────

const fmtMoney = (n, currency = 'EUR') => {
  if (n == null || n === '') return '—';
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(Number(n));
  } catch {
    return `${currency} ${Number(n).toFixed(2)}`;
  }
};
// Compact form for the trend "€1,540 avg / month" line (no decimals).
const fmtMoneyCompact = (n, currency = 'EUR') => {
  if (n == null) return '—';
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(Number(n));
  } catch { return `${currency} ${Math.round(n)}`; }
};
const shortRef = (id) => '#' + String(id || '').slice(0, 8).toUpperCase();
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
const daysAgo = (iso) => {
  if (!iso) return null;
  try {
    const target = new Date(iso); target.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((today - target) / 86400000);
  } catch { return null; }
};

// Initials from a contact's full name, max 2 chars uppercase.
const initials = (name) => {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// Pastel palette for contact avatars. Hash-pick by contact id so the
// same person always gets the same colour without storing state.
const AVATAR_PALETTE = [
  { bg: '#EEEDFE', fg: '#3C3489' },  // lavender / lavender-deep
  { bg: '#F1EFE8', fg: '#5F5E5A' },  // sand / slate
  { bg: '#FAEEDA', fg: '#C65A1A' },  // cream-warm / orange
  { bg: '#E1F5EE', fg: '#0F6E56' },  // green-soft / green-deep
  { bg: '#E6F1FB', fg: '#0C447C' },  // blue-soft / blue-deep
  { bg: '#FCEBEB', fg: '#A32D2D' },  // red-soft / red
];
const hashIndex = (str, modulo) => {
  const s = String(str || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return h % modulo;
};
const avatarStyle = (contact) => {
  const palette = AVATAR_PALETTE[hashIndex(contact.id || contact.name || '', AVATAR_PALETTE.length)];
  return { background: palette.bg, color: palette.fg };
};

// Stable id generator for new contact rows (no crypto dep).
const newId = () => 'c_' + Math.random().toString(36).slice(2, 11);

// Status → pill class for the orders table. Mirrors mockup.
const STATUS_PILL = {
  sent:              { cls: 'sd-pill-confirmed', label: 'SENT' },
  confirmed:         { cls: 'sd-pill-confirmed', label: 'CONFIRMED' },
  dispatched:        { cls: 'sd-pill-confirmed', label: 'DISPATCHED' },
  out_for_delivery:  { cls: 'sd-pill-confirmed', label: 'OUT FOR DELIVERY' },
  received:          { cls: 'sd-pill-paid',      label: 'RECEIVED' },
  invoiced:          { cls: 'sd-pill-paid',      label: 'INVOICED' },
  paid:              { cls: 'sd-pill-paid',      label: 'PAID' },
  partially_received:{ cls: 'sd-pill-discrepancies', label: 'DISCREPANCIES' },
  draft:             { cls: 'sd-pill-neutral',   label: 'DRAFT' },
};
const computeOrderTotal = (order) => {
  const items = order.supplier_order_items || [];
  return items.reduce((sum, it) => {
    const unit = Number(it.agreed_price ?? it.quoted_price ?? it.estimated_price) || 0;
    return sum + unit * (Number(it.quantity) || 0);
  }, 0);
};

// ─── Inline sparkline (orange, 10% fill) ─────────────────────
//
// 12 points laid out evenly across a 600×100 viewBox. Y-flipped so
// higher spend renders higher on screen. Smoothed via straight-line
// segments to match the mockup's path style.

function VesselTrendSparkline({ points, color = '#C65A1A' }) {
  if (!points || points.length === 0) return null;
  const W = 600;
  const H = 100;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = Math.max(max - min, 1);
  // Pad the bottom slightly so the curve doesn't kiss the baseline.
  const padBot = 6;
  const padTop = 6;
  const usable = H - padTop - padBot;
  const stepX = W / (points.length - 1 || 1);
  const ptToY = (v) => padTop + (1 - (v - min) / range) * usable;
  const linePath = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(2)} ${ptToY(v).toFixed(2)}`).join(' ');
  const areaPath = linePath + ` L ${W} ${H} L 0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 80, display: 'block' }}>
      <path d={areaPath} fill={color} fillOpacity="0.10" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

// Smaller per-dept sparkline inside the deep-dive panel. Same shape
// generator, different viewBox + colour comes from the dept.
function DeptTrendSparkline({ points, color }) {
  if (!points || points.length === 0) return null;
  const W = 400;
  const H = 60;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = Math.max(max - min, 1);
  const padBot = 4;
  const padTop = 4;
  const usable = H - padTop - padBot;
  const stepX = W / (points.length - 1 || 1);
  const ptToY = (v) => padTop + (1 - (v - min) / range) * usable;
  const linePath = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(2)} ${ptToY(v).toFixed(2)}`).join(' ');
  const areaPath = linePath + ` L ${W} ${H} L 0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="sd-panel-trend-svg">
      <path d={areaPath} fill={color} fillOpacity="0.10" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

// ─── Currency mix donut ──────────────────────────────────────
//
// Mockup uses 4 stroked arcs: a grey track + one per code. Stroke
// dasharrays sum to the circle circumference; offsets stack each arc
// after the previous one.

function CurrencyMixDonut({ mix }) {
  const cx = 40;
  const cy = 40;
  const r = 32;
  const C = 2 * Math.PI * r; // ≈ 200.96
  const palette = ['#262A53', '#C65A1A', '#B4B2A9', '#888780'];
  let offset = 0;
  const segments = mix.map((m, i) => {
    const len = (C * m.percent) / 100;
    const seg = (
      <circle
        key={m.code}
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={palette[i % palette.length]}
        strokeWidth="7"
        strokeDasharray={`${len.toFixed(2)} ${(C - len).toFixed(2)}`}
        strokeDashoffset={(-offset).toFixed(2)}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    );
    offset += len;
    return seg;
  });
  return (
    <svg viewBox="0 0 80 80" style={{ width: 80, height: 80 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EEF0F4" strokeWidth="7" />
      {segments}
    </svg>
  );
}

// ─── AS TRANSACTED currency stack ────────────────────────────
//
// Renders a per-currency original-amount stack (dominant currency first;
// the aggregator already sorted byCurrency by converted spend desc).
// ≤3 currencies: show all. ≥4: top 2 + "+ N more currencies" caption.
function CurrencyStack({ list, fmt }) {
  if (!list || list.length === 0) return <div className="value">—</div>;
  const lines = list.length >= 4 ? list.slice(0, 2) : list;
  const moreCount = list.length >= 4 ? list.length - 2 : 0;
  return (
    <div className="sd-currency-stack">
      {lines.map((e) => (
        <div className="value sd-stack-line" key={e.code}>{fmt(e.amount, e.code)}</div>
      ))}
      {moreCount > 0 && (
        <div className="sd-stack-more">+ {moreCount} more {moreCount === 1 ? 'currency' : 'currencies'}</div>
      )}
    </div>
  );
}

// Thin skeleton block for the lazy-loading metric sections.
function Skel({ w = '100%', h = 28, mt = 0 }) {
  return <span className="sd-skel" style={{ width: w, height: h, marginTop: mt }} />;
}

// ─── Page ────────────────────────────────────────────────────

export default function SupplierDetailPage() {
  const { supplierProfileId } = useParams();
  const navigate = useNavigate();
  const { tenantRole } = useAuth();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [supplierRating, setSupplierRating] = useState(null); // {avg,count,quality,delivery,service}
  const [reviewsOpen, setReviewsOpen] = useState(false);

  // Platform-wide rating for this supplier — shared with the marketplace
  // storefront (get_supplier_ratings). Non-blocking.
  const loadRating = () => fetchSupplierRatings()
    .then(map => setSupplierRating(map.get(supplierProfileId) || null))
    .catch(() => {});
  useEffect(() => {
    if (!supplierProfileId) return;
    loadRating();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierProfileId]);

  // Inline confirm state — first × click on a contact stages the
  // delete; second × click confirms. Resets on any other interaction.
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  // Page scoping flows directly from the logged-in user's tenant role.
  const effectiveRole = (tenantRole || 'CHIEF').toUpperCase();
  const isCommand = effectiveRole === 'COMMAND';

  // TODO: Replace 'Interior' constant with the user's actual dept from
  // tenant_members.department_id (column doesn't exist yet — add in a
  // follow-up sprint along with a UI for Captain to assign dept membership
  // during onboarding). Chief users without an assigned dept should fall
  // back to the supplier's most-used dept, OR render an "Assign me a
  // department" prompt instead of the scoped view.
  const departmentKey = isCommand ? null : 'Interior';

  // Currency toggle — visual only in this PR (no conversion).
  const [currencyMode, setCurrencyMode] = useState('reporting');

  // Department deep-dive panel.
  const [activeDept, setActiveDept] = useState(null);

  // Notes editor state. `notesDraft` is the local textarea value;
  // `notesSaved` is the persisted profile.notes that resets after save.
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);

  // Contacts editor state — entirely local, persisted as a full jsonb
  // array on each mutation (no merge semantics).
  const [contacts, setContacts] = useState([]);
  const [editingContactId, setEditingContactId] = useState(null);
  const [addingContact, setAddingContact] = useState(false);

  // User-name lookup for "Last edited by X" footer.
  const [userNamesById, setUserNamesById] = useState({});

  // Body bg lift to the supplier-detail page bg.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F8FAFC';
    return () => { document.body.style.background = prev; };
  }, []);

  // Load profile + orders.
  useEffect(() => {
    if (!supplierProfileId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    // Profile is the synchronous load (name / address / notes / contacts
    // render immediately). Orders + KPIs come from the async metrics
    // bundle below and lazy-load underneath.
    fetchSupplierProfileById(supplierProfileId)
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          setNotFound(true);
          showToast('Supplier not found', 'error');
          navigate('/provisioning/suppliers', { replace: true });
          return;
        }
        setProfile(p);
        setNotesDraft(p.notes || '');
        setContacts(Array.isArray(p.contacts) ? p.contacts : []);
        setLoading(false);
        // Look up the notes editor's name if we have one.
        if (p.notes_updated_by) {
          fetchUserNames([p.notes_updated_by]).then((map) => {
            if (!cancelled) setUserNamesById(map);
          });
        }
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

  // Real metrics bundle — async, lazy-loaded underneath the synchronous
  // profile. Does NOT depend on currencyMode: the bundle carries both
  // reporting-converted and original-currency figures, the render picks
  // which to show. Re-runs only on supplier / role / dept change.
  const [metrics, setMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  useEffect(() => {
    if (!supplierProfileId) return undefined;
    let cancelled = false;
    setMetricsLoading(true);
    getSupplierMetrics(supplierProfileId, {
      tenantRole: effectiveRole,
      departmentKey,
      reportingCurrency: REPORTING_CURRENCY,
    })
      .then((bundle) => {
        if (cancelled) return;
        setMetrics(bundle);
        setMetricsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[SupplierDetailPage] metrics load failed:', err);
        setMetrics(null);
        setMetricsLoading(false);
        showToast('Could not load supplier metrics', 'error');
      });
    return () => { cancelled = true; };
  }, [supplierProfileId, effectiveRole, departmentKey]);

  // ── Notes persistence ────────────────────────────────────────
  // On blur, if the textarea content differs from the persisted notes,
  // write it back. Errors surface as toasts; on success the profile
  // is patched in place so the footer reflects the new timestamp.
  const handleNotesBlur = async () => {
    if (!profile) return;
    if ((notesDraft || '') === (profile.notes || '')) return;
    setNotesSaving(true);
    const { data, error } = await updateSupplierNotes(profile.id, notesDraft);
    setNotesSaving(false);
    if (error) {
      showToast(`Could not save notes: ${error.message || error}`, 'error');
      return;
    }
    setProfile((p) => p ? { ...p, ...data } : p);
    if (data?.notes_updated_by && !userNamesById[data.notes_updated_by]) {
      fetchUserNames([data.notes_updated_by]).then((map) =>
        setUserNamesById((prev) => ({ ...prev, ...map })),
      );
    }
    showToast('Notes saved', 'success');
  };

  // ── Contacts persistence ─────────────────────────────────────
  // All edit/add/delete operations build the next contacts array
  // locally then call updateSupplierContacts with the full replacement
  // array. Local state is the source of truth between writes.
  const persistContacts = async (next) => {
    if (!profile) return;
    const prev = contacts;
    setContacts(next);
    const { data, error } = await updateSupplierContacts(profile.id, next);
    if (error) {
      // Roll back the local state on failure.
      setContacts(prev);
      showToast(`Could not save contacts: ${error.message || error}`, 'error');
      return;
    }
    if (data?.contacts) setContacts(data.contacts);
  };
  const handleAddContact = (draft) => {
    if (!draft.name?.trim()) return;
    const entry = {
      id: newId(),
      name: draft.name.trim(),
      role: (draft.role || '').trim(),
      email: (draft.email || '').trim(),
      phone: (draft.phone || '').trim(),
      is_primary: !!draft.is_primary,
    };
    // Only one contact can be primary at a time.
    const next = entry.is_primary
      ? [...contacts.map((c) => ({ ...c, is_primary: false })), entry]
      : [...contacts, entry];
    persistContacts(next);
    setAddingContact(false);
  };
  const handleEditContact = (id, draft) => {
    let next = contacts.map((c) => (c.id === id ? {
      ...c,
      name: (draft.name || '').trim(),
      role: (draft.role || '').trim(),
      email: (draft.email || '').trim(),
      phone: (draft.phone || '').trim(),
      is_primary: !!draft.is_primary,
    } : c));
    if (draft.is_primary) {
      next = next.map((c) => (c.id === id ? c : { ...c, is_primary: false }));
    }
    persistContacts(next);
    setEditingContactId(null);
  };
  // Two-click inline confirm. First click on × stages the delete by
  // setting pendingDeleteId — the button label flips to "Sure?" via
  // render-time check. Second click on the same row's × commits.
  // Clicking anywhere else (or another row's ×) resets the staging.
  const handleDeleteContact = (id) => {
    if (pendingDeleteId === id) {
      setPendingDeleteId(null);
      persistContacts(contacts.filter((c) => c.id !== id));
    } else {
      setPendingDeleteId(id);
    }
  };

  // ── Department panel toggling ────────────────────────────────
  const toggleDept = (key) => {
    setActiveDept((cur) => (cur === key ? null : key));
  };

  // Reset any pending delete when the user takes another action on the
  // contacts surface (edit / add / different row).
  const cancelPendingDelete = () => {
    if (pendingDeleteId !== null) setPendingDeleteId(null);
  };

  // ── Render ───────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Header />
        <div className="sd-page">
          <div className="sd-inner">
            <p className="sd-loading">Loading supplier…</p>
          </div>
        </div>
      </>
    );
  }
  if (notFound || !profile) return null;

  const supplierName = profile.name || 'Supplier';
  const countryCode = profile.business_country || null;
  const countryFull = countryName(countryCode);          // full name, falls back to code
  const city = profile.business_city || null;
  // Address subline: line1 · postal city · region · country. Country is
  // the resolved full name (not ISO code) to match the mockup ("FRANCE").
  const addressLine = [
    profile.business_address_line1,
    profile.business_postal_code && profile.business_city
      ? `${profile.business_postal_code} ${profile.business_city}`
      : profile.business_city,
    countryFull,
  ].filter(Boolean).join(' · ').toUpperCase();

  // Metrics may still be loading — every consumer below is null-guarded
  // so the supplier name / address / contacts render immediately while
  // the KPI sections show skeletons underneath.
  const hasMetrics = !!metrics;
  const transacted = currencyMode === 'transacted';
  const orderTotalCount = metrics?.totalSpend.orderCount ?? 0;
  const lastDays = metrics?.lastOrder.daysAgo ?? null;
  const cur = metrics?.totalSpend.currency || REPORTING_CURRENCY;

  const orders = metrics?.orders || [];
  const visibleOrders = orders.slice(0, 5);
  const showCount = visibleOrders.length;

  // Scope context strings — Command sees vessel-wide, Chief carries the
  // "· Interior only" suffix on both the "Showing N of M" line AND the
  // "Show all N orders ›" link so the dept scoping cue is consistent.
  const scopeSuffix = isCommand ? '' : ' · Interior only';
  const ordersShowingText = `Showing ${showCount} of ${orderTotalCount}${scopeSuffix}`;
  const showAllText = `Show all ${orderTotalCount} orders${scopeSuffix} ›`;
  const scopePillCommand = 'VIEWING AS COMMAND · ALL DEPARTMENTS';
  const scopePillChief = 'VIEWING AS CHIEF STEW · INTERIOR ONLY';

  // Notes footer name. While the async user-name lookup is in flight
  // OR there's no notes_updated_by recorded, `notesEditorName` is null
  // and the footer renders "Last edited · {when}" without the "by X"
  // segment. Once the lookup resolves it folds in cleanly. No "Unknown"
  // placeholder flashing during the fetch — that read as wrong.
  const notesEditorName = profile.notes_updated_by
    ? (userNamesById[profile.notes_updated_by] || null)
    : null;
  const notesWhen = profile.notes_updated_at ? fmtRelative(profile.notes_updated_at) : null;

  return (
    <>
      <Header />
      <div className="sd-page">

        <div className="sd-inner">

          {/* ── Editorial header ─────────────────────────────── */}
          <div className="sd-header-top-row">
            <div className="sd-header-top-left">
              <button
                type="button"
                className="sd-back-link"
                onClick={() => navigate('/provisioning')}
              >‹  BACK TO PROVISIONING</button>

              <div className="sd-meta-strip">
                <span className="sd-dot">●</span>
                {countryFull && <><span>{countryFull.toUpperCase()}</span><span className="sd-sep">·</span></>}
                {city && <><span>{city.toUpperCase()}</span><span className="sd-sep">·</span></>}
                {hasMetrics ? (
                  <>
                    <span>{orderTotalCount} {orderTotalCount === 1 ? 'ORDER' : 'ORDERS'}</span>
                    {lastDays != null && <>
                      <span className="sd-sep">·</span>
                      <span>LAST ORDER {lastDays}D AGO</span>
                    </>}
                  </>
                ) : (
                  <Skel w="160px" h={12} />
                )}
              </div>

              <div className={`sd-scope-pill ${isCommand ? 'sd-scope-pill-command' : 'sd-scope-pill-chief'}`}>
                {isCommand ? scopePillCommand : scopePillChief}
              </div>
            </div>

            <div className="sd-currency-toggle-wrap">
              <div className="sd-currency-toggle-label">CURRENCY</div>
              <div className="sd-currency-toggle" role="group" aria-label="Currency display mode">
                <button
                  type="button"
                  className={`opt${currencyMode === 'reporting' ? ' active' : ''}`}
                  onClick={() => setCurrencyMode('reporting')}
                >€  EUR  (REPORTING)</button>
                <button
                  type="button"
                  className={`opt${currencyMode === 'transacted' ? ' active' : ''}`}
                  onClick={() => setCurrencyMode('transacted')}
                >AS TRANSACTED</button>
              </div>
            </div>
          </div>

          {/* Canonical .p-greeting markup — supplier name + comma +
              italic `overview` accent + period. Display-case name,
              navy comma/period, terracotta italic accent. */}
          <h1 className="p-greeting sd-headline">
            {supplierName}<span className="period">,</span> <em className="accent">overview</em><span className="period">.</span>
          </h1>

          {addressLine && (
            <div className="sd-address-subline">{addressLine}</div>
          )}

          {/* ── Reviews line — shares the marketplace reviews modal ── */}
          <button type="button" className="sd-reviews-line" onClick={() => setReviewsOpen(true)}>
            <RatingStars value={supplierRating?.avg || 0} />
            {supplierRating?.avg != null ? (
              <>
                <span className="sd-reviews-score">{supplierRating.avg.toFixed(1)}</span>
                <span className="sd-reviews-count">{supplierRating.count} verified review{supplierRating.count === 1 ? '' : 's'}</span>
              </>
            ) : (
              <span className="sd-reviews-count">No reviews yet</span>
            )}
            <span className="sd-reviews-cta">View &amp; rate ›</span>
          </button>

          {reviewsOpen && (
            <ReviewsModal
              supplier={{ id: profile.id, name: profile.name }}
              rating={supplierRating}
              onClose={() => setReviewsOpen(false)}
              onRated={loadRating}
            />
          )}

          {/* ── Essential KPIs ────────────────────────────────── */}
          <div className="sd-essential-kpis">
            <div className="sd-card sd-kpi-essential">
              <div className="sd-label-cap">TOTAL SPEND</div>
              {!hasMetrics ? <Skel h={34} /> : transacted ? (
                <CurrencyStack list={metrics.totalSpend.byCurrency} fmt={fmtMoney} />
              ) : (
                <div className="value">{fmtMoney(metrics.totalSpend.amount, cur)}</div>
              )}
              <div className="context">
                {hasMetrics ? <>across {orderTotalCount} orders{!isCommand && ' · Interior'}</> : <Skel w="120px" h={12} mt={6} />}
              </div>
            </div>
            <div className="sd-card sd-kpi-essential">
              <div className="sd-label-cap">COMPLETED ORDERS</div>
              {!hasMetrics ? <Skel h={34} /> : (
                <div className="value">{metrics.completedOrders.percent}%</div>
              )}
              <div className="context">
                {hasMetrics ? <>{metrics.completedOrders.completed} of {metrics.completedOrders.total} completed</> : <Skel w="120px" h={12} mt={6} />}
              </div>
            </div>
            <div className="sd-card sd-kpi-essential">
              <div className="sd-label-cap">LAST ORDER</div>
              {!hasMetrics ? <Skel h={34} /> : (
                <div className="value">
                  {lastDays === 0 ? 'Today' : lastDays === 1 ? '1 day ago' : `${lastDays} days ago`}
                </div>
              )}
              <div className="context">
                {hasMetrics ? <>{metrics.lastOrder.ref} · {fmtMoney(metrics.lastOrder.total, metrics.lastOrder.currency)}</> : <Skel w="140px" h={12} mt={6} />}
              </div>
            </div>
          </div>

          {/* ── Orders section ────────────────────────────────── */}
          <div className="sd-section-title-row">
            <h2 className="sd-section-title">Orders<span className="period">.</span></h2>
            <div className="sd-orders-meta">
              {hasMetrics && <span>{ordersShowingText}</span>}
              <button type="button" className="sd-filter-link">FILTER ›</button>
            </div>
          </div>

          <div className="sd-card sd-orders-card">
            <div className="sd-orders-row sd-orders-header">
              <span>REF</span><span>VESSEL</span><span>BOARD</span>
              <span>STATUS</span><span>TOTAL</span><span>CREATED</span>
            </div>
            {!hasMetrics ? (
              [0, 1, 2, 3, 4].map((i) => (
                <div className="sd-orders-row" key={i}><Skel w="80%" h={14} /></div>
              ))
            ) : visibleOrders.length === 0 ? (
              <div className="sd-orders-empty">No orders yet with this supplier.</div>
            ) : visibleOrders.map((o) => {
              const pill = STATUS_PILL[o.status] || STATUS_PILL.draft;
              const total = computeOrderTotal(o);
              const ordCur = o.currency || 'EUR';
              const boardTitle = o.provisioning_lists?.title || '—';
              const onRowClick = () => {
                if (o.list_id) navigate(`/provisioning/${o.list_id}/orders/${o.id}`);
              };
              return (
                <div
                  key={o.id}
                  className="sd-orders-row sd-orders-body-row"
                  onClick={onRowClick}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(); } }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="sd-order-ref">{shortRef(o.id)}</span>
                  <span>{o.vessel_name || '—'}</span>
                  <span>{boardTitle}</span>
                  <span><span className={`sd-pill ${pill.cls}`}>{pill.label}</span></span>
                  <span className="sd-order-total">{total > 0 ? fmtMoney(total, ordCur) : '—'}</span>
                  <span className="sd-order-created">{fmtRelative(o.created_at)}</span>
                </div>
              );
            })}
            {hasMetrics && visibleOrders.length > 0 && (
              <button type="button" className="sd-show-all">{showAllText}</button>
            )}
          </div>

          {/* ── Secondary KPIs + currency mix right rail ─────── */}
          <div className="sd-lower-grid">
            <div className="sd-secondary-kpis">
              <div className="sd-card">
                <div className="sd-label-cap">AVG ORDER VALUE</div>
                {!hasMetrics ? <Skel h={28} /> : transacted ? (
                  <CurrencyStack list={metrics.avgOrderValue.byCurrency} fmt={fmtMoney} />
                ) : (
                  <div className="value">{fmtMoney(metrics.avgOrderValue.amount, cur)}</div>
                )}
                <div className="context">
                  {hasMetrics ? <>across {orderTotalCount} orders</> : <Skel w="100px" h={12} mt={6} />}
                </div>
                {hasMetrics && !transacted && (
                  <div className="footer-line delta-neutral">
                    range {fmtMoneyCompact(metrics.avgOrderValue.rangeLow, cur)} – {fmtMoneyCompact(metrics.avgOrderValue.rangeHigh, cur)}
                  </div>
                )}
              </div>

              <div className="sd-card">
                <div className="sd-label-cap">DISCREPANCY RATE</div>
                {!hasMetrics ? <Skel h={28} /> : (
                  <>
                    <div className="value">{metrics.discrepancyRate.percent}%</div>
                    <div className="context">
                      {metrics.discrepancyRate.withIssues} of {metrics.discrepancyRate.total} with issues
                    </div>
                    <div className={`footer-line ${metrics.discrepancyRate.percent < metrics.discrepancyRate.fleetAvg ? 'delta-up' : 'delta-neutral'}`}>
                      {metrics.discrepancyRate.percent < metrics.discrepancyRate.fleetAvg ? '▼' : '▲'} vs fleet avg {metrics.discrepancyRate.fleetAvg}%
                    </div>
                  </>
                )}
              </div>

              <div className="sd-card sd-trend-card">
                <div className="sd-trend-header">
                  <div className="sd-label-cap">12-MONTH TREND</div>
                  {hasMetrics && !transacted && (
                    <div className="context">
                      {fmtMoneyCompact(metrics.trend12mo.monthlyAvg, cur)} avg / month{!isCommand && ' · Interior'}
                    </div>
                  )}
                </div>
                {!hasMetrics ? <Skel h={80} /> : transacted ? (
                  <div className="sd-trend-note">
                    Trend not shown in transacted view — switch to EUR Reporting to see.
                  </div>
                ) : (
                  <>
                    <VesselTrendSparkline points={metrics.trend12mo.points} />
                    <div className="sd-trend-axis">
                      <span>JUN</span><span>SEP</span><span>DEC</span><span>MAR</span><span>MAY</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div>
              <div className="sd-card sd-currency-mix-card">
                {!hasMetrics ? <Skel w="80px" h={80} /> : (
                  <>
                    <CurrencyMixDonut mix={metrics.currencyMix} />
                    <div className="legend">
                      <div className="sd-label-cap">CURRENCY MIX</div>
                      {metrics.currencyMix.map((m, i) => {
                        const palette = ['#262A53', '#C65A1A', '#B4B2A9', '#888780'];
                        return (
                          <div className="sd-currency-mix-row" key={m.code}>
                            <span><span className="swatch" style={{ background: palette[i % palette.length] }} />{m.code}</span>
                            <span className="pct">{m.percent}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              <div className="sd-mix-disclaimer">
                Currency mix always shows original transaction currencies, regardless of toggle above.
              </div>
            </div>
          </div>

          {/* ── Department spend (Command only) ──────────────── */}
          {isCommand && hasMetrics && metrics.departmentBreakdown && metrics.departmentBreakdown.length > 0 && (
            <DepartmentSpendSection
              totalSpend={metrics.totalSpend}
              departments={metrics.departmentBreakdown}
              activeDept={activeDept}
              onToggleDept={toggleDept}
              transacted={transacted}
            />
          )}

          {/* ── Notes & contacts ─────────────────────────────── */}
          <h2 className="sd-section-title">Notes &amp; contacts<span className="period">.</span></h2>
          <div className="sd-notes-grid">

            <div className="sd-card sd-card-lg">
              <div className="sd-label-cap" style={{ marginBottom: 14 }}>NOTES</div>
              <textarea
                className="sd-notes-textarea"
                placeholder="Add a note about this supplier…"
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={handleNotesBlur}
                disabled={notesSaving}
              />
              {(notesEditorName || notesWhen) && (
                <div className="sd-notes-footer">
                  Last edited{notesEditorName ? ` by ${notesEditorName}` : ''}{notesWhen ? ` · ${notesWhen}` : ''}
                </div>
              )}
            </div>

            <div className="sd-card sd-card-lg">
              <div className="sd-label-cap" style={{ marginBottom: 18 }}>CONTACTS</div>
              {contacts.length === 0 && !addingContact && (
                <div className="sd-contacts-empty">No contacts yet.</div>
              )}
              {contacts.map((c) => (
                editingContactId === c.id ? (
                  <ContactForm
                    key={c.id}
                    initial={c}
                    onSubmit={(draft) => handleEditContact(c.id, draft)}
                    onCancel={() => setEditingContactId(null)}
                  />
                ) : (
                  <div key={c.id} className="sd-contact-row">
                    <div className="sd-avatar" style={avatarStyle(c)}>{initials(c.name)}</div>
                    <div className="sd-contact-info">
                      <div className="sd-contact-name">
                        {c.name}{c.is_primary && <span className="sd-primary-tag">· PRIMARY</span>}
                      </div>
                      {c.role && <div className="sd-contact-role">{c.role}</div>}
                    </div>
                    <div className="sd-contact-details">
                      {c.email && <a className="sd-contact-email" href={`mailto:${c.email}`}>{c.email}</a>}
                      {c.phone && <div><a className="sd-contact-phone" href={`tel:${c.phone}`}>{c.phone}</a></div>}
                    </div>
                    <div className="sd-contact-actions">
                      <button
                        type="button"
                        className="sd-contact-action-btn"
                        onClick={() => { cancelPendingDelete(); setEditingContactId(c.id); }}
                        aria-label={`Edit ${c.name}`}
                      >✎</button>
                      <button
                        type="button"
                        className={`sd-contact-action-btn danger${pendingDeleteId === c.id ? ' is-confirming' : ''}`}
                        onClick={() => handleDeleteContact(c.id)}
                        aria-label={pendingDeleteId === c.id ? `Confirm remove ${c.name}` : `Remove ${c.name}`}
                      >{pendingDeleteId === c.id ? 'Sure?' : '×'}</button>
                    </div>
                  </div>
                )
              ))}
              {addingContact ? (
                <ContactForm
                  initial={null}
                  onSubmit={handleAddContact}
                  onCancel={() => setAddingContact(false)}
                />
              ) : (
                <button
                  type="button"
                  className="sd-add-contact"
                  onClick={() => { cancelPendingDelete(); setAddingContact(true); }}
                >+ Add contact</button>
              )}
            </div>

          </div>

        </div>
      </div>
    </>
  );
}

// ─── Department spend section (Command only) ────────────────

function DepartmentSpendSection({ totalSpend, departments, activeDept, onToggleDept, transacted }) {
  const cur = totalSpend.currency || 'EUR';
  // Active dept resolved from the live breakdown (no static DEPT_LOOKUP —
  // the breakdown is per-supplier now). Uncategorised never opens a
  // deep-dive, so an active key pointing at it resolves to null.
  const active = activeDept
    ? departments.find((d) => d.key === activeDept && !d.uncategorised) || null
    : null;
  return (
    <div className="sd-dept-section">
      <h2 className="sd-section-title">Department spend<span className="period">.</span></h2>

      <div className={`sd-dept-layout${active ? ' panel-open' : ''}`}>

        <div className="sd-card sd-card-lg sd-dept-card">
          <div className="role-pill">COMMAND · ALL DEPARTMENTS</div>
          <div className="context">
            Full spend breakdown across departments. Click any department to see the details.
          </div>

          <div className="total-line">
            {transacted ? (
              <CurrencyStack list={totalSpend.byCurrency} fmt={fmtMoney} />
            ) : (
              <div className="total-value">{fmtMoney(totalSpend.amount, cur)}</div>
            )}
            <div className="total-context">across {totalSpend.orderCount} orders · vessel-wide</div>
          </div>

          {transacted ? (
            <div className="sd-trend-note">Bar chart available in EUR reporting view.</div>
          ) : (
            <div className="sd-stacked-bar">
              {departments.map((d) => (
                <div key={d.key} style={{ background: d.colour, width: `${d.spendPercent}%` }} />
              ))}
            </div>
          )}

          <div className="sd-dept-legend">
            {departments.map((d) => {
              const clickable = !d.uncategorised;
              const rowClass = `sd-dept-legend-row${activeDept === d.key ? ' active' : ''}${clickable ? '' : ' is-static'}`;
              const inner = (
                <>
                  <span className="swatch" style={{ background: d.colour }} />
                  <span className="name">{d.name}</span>
                  <span className="stats">{d.orderCount} orders &nbsp; {d.spendPercent}%</span>
                  {transacted ? (
                    <span className="total"><CurrencyStack list={d.spendByCurrency} fmt={fmtMoney} /></span>
                  ) : (
                    <span className="total">{fmtMoney(d.spendAmount, cur)}</span>
                  )}
                  <span className="chev">{clickable ? '›' : ''}</span>
                </>
              );
              return clickable ? (
                <button
                  type="button"
                  key={d.key}
                  className={rowClass}
                  onClick={() => onToggleDept(d.key)}
                >{inner}</button>
              ) : (
                <div key={d.key} className={rowClass}>{inner}</div>
              );
            })}
          </div>
        </div>

        <div className="sd-dept-panel">
          <div className="sd-dept-panel-inner">
            {active ? (
              <>
                <div
                  className="panel-pill"
                  style={{ background: hexToRgba(active.colour, 0.15), color: active.colour }}
                >
                  {active.name.toUpperCase()} · {active.orderCount} ORDERS
                </div>
                <div className="panel-title">{active.name}.</div>
                <div className="panel-sub">{active.sub}</div>

                <div className="sd-panel-kpi-grid">
                  <div className="sd-panel-kpi">
                    <div className="sd-label-cap">ORDERS</div>
                    <div className="v">{active.orderCount}</div>
                    <div className="c">{active.orderPercent}% of order count</div>
                  </div>
                  <div className="sd-panel-kpi">
                    <div className="sd-label-cap">AVG ORDER</div>
                    <div className="v">{fmtMoneyCompact(active.avgOrder, cur)}</div>
                    <div className="c">range {fmtMoneyCompact(active.avgRangeLow, cur)}–{fmtMoneyCompact(active.avgRangeHigh, cur)}</div>
                  </div>
                  <div className="sd-panel-kpi">
                    <div className="sd-label-cap">COMPLETED</div>
                    <div className="v">{active.completedPercent}%</div>
                    <div className="c">{active.completedCount} of {active.completedTotal} completed</div>
                  </div>
                  <div className="sd-panel-kpi">
                    <div className="sd-label-cap">DISCREPANCY</div>
                    <div className="v">{active.discrepancyPercent}%</div>
                    <div className="c">
                      {active.discrepancyCount === 0
                        ? 'no issues'
                        : `${active.discrepancyCount} of ${active.orderCount} with issues`}
                    </div>
                  </div>
                </div>

                <div className="sd-panel-trend-label">12-MONTH TREND</div>
                {transacted ? (
                  <div className="sd-trend-note">
                    Trend not shown in transacted view — switch to EUR Reporting to see.
                  </div>
                ) : (
                  <>
                    <DeptTrendSparkline points={active.trendPoints} color={active.colour} />
                    <div className="sd-panel-trend-axis">
                      <span>JUN</span><span>DEC</span><span>MAY</span>
                    </div>
                  </>
                )}

                <div className="sd-top-items-header">
                  <div className="sd-label-cap">TOP ITEMS</div>
                  <span className="by">BY SPEND</span>
                </div>
                <div className="sd-top-items">
                  {active.topItems.map((it) => (
                    <div key={it.name} className="sd-top-item-row">
                      <span>{it.name}</span>
                      <span className="qty">{it.orderCount} {it.orderCount === 1 ? 'order' : 'orders'}</span>
                      <span className="total">{fmtMoney(it.total, cur)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Inline contact form (add / edit) ───────────────────────

function ContactForm({ initial, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [role, setRole] = useState(initial?.role || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [isPrimary, setIsPrimary] = useState(!!initial?.is_primary);
  const nameRef = useRef(null);
  useEffect(() => { nameRef.current?.focus(); }, []);
  const canSubmit = name.trim().length > 0;
  return (
    <form
      className="sd-contact-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ name, role, email, phone, is_primary: isPrimary });
      }}
    >
      <input
        ref={nameRef}
        type="text"
        placeholder="Name (required)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        type="text"
        placeholder="Role (e.g. Sales lead)"
        value={role}
        onChange={(e) => setRole(e.target.value)}
      />
      <div className="sd-contact-form-row">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="tel"
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div className="sd-contact-form-actions">
        <div className="left">
          <label>
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
            />
            Primary contact
          </label>
        </div>
        <div className="sd-contact-form-buttons">
          <button type="button" className="btn" onClick={onCancel}>CANCEL</button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>SAVE</button>
        </div>
      </div>
    </form>
  );
}

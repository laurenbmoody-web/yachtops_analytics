// ============================================================
// Suppliers Directory — Sprint 9c.3 Phase 5
// ============================================================
//
// Replaces the legacy ProvisioningSuppliers list. Reads the
// consolidated supplier_profiles table via the vendor helper layer
// (fetchVendors etc). Visual source of truth:
// docs/three_categorisation_options.html — Option C.
//
// Phase 5 scope: directory surface (search, faceted chip filters,
// favourites + all-vendors sections, 3-col card grid, archive link,
// loading / empty states) and a working Add/Edit *drawer shell*.
// The drawer's form body is built in Phase 6 (AddVendorForm).

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import { useAuth } from '../../../contexts/AuthContext';
import {
  fetchVendors,
  fetchVendorOrderStats,
  fetchKnownCategoryTaxonomy,
  toggleVendorFavourite,
  archiveVendor,
} from '../utils/provisioningStorage';
import { VENDOR_TYPES, mergeTaxonomy } from './vendorConstants';
import AddVendorForm from './AddVendorForm';
import { showToast } from '../../../utils/toast';
import './suppliers-directory.css';

// ─── Small presentational helpers (page-local, intentionally not
// abstracted into a util module — only this page needs them) ──────

const CURRENCY_SYMBOL = { EUR: '€', USD: '$', GBP: '£' };

const formatSpend = (amount, currency = 'EUR') => {
  if (!amount) return '—';
  const sym = CURRENCY_SYMBOL[currency] || '';
  const rounded = Math.round(amount);
  return `${sym}${rounded.toLocaleString('en-US')}`;
};

const formatLastOrder = (iso) => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'last today';
  if (days < 7) return `last ${days}d`;
  if (days < 60) return `last ${Math.round(days / 7)}w`;
  return `last ${Math.round(days / 30)}mo`;
};

const locationLine = (v) => {
  const parts = [v.business_city, v.business_country].filter(Boolean);
  return parts.length ? parts.join(', ').toUpperCase() : null;
};

// Distinct non-primary category chips for a card (primary renders
// separately, in the cream-warm style).
const secondaryRoles = (v) => {
  const primary = v.primary_category;
  const seen = new Set(primary ? [primary.toLowerCase()] : []);
  const out = [];
  for (const c of v.categories || []) {
    if (!c) continue;
    const lc = c.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(c);
  }
  return out;
};

const SkeletonCard = () => (
  <div className="sd-dir-skel">
    <span className="sd-dir-skel-block" style={{ width: '60%', height: 22 }} />
    <span className="sd-dir-skel-block" style={{ width: '40%', height: 11, marginTop: 8 }} />
    <span className="sd-dir-skel-block" style={{ width: '30%', height: 16, marginTop: 18 }} />
    <span className="sd-dir-skel-block" style={{ width: '80%', height: 24, marginTop: 14 }} />
    <span className="sd-dir-skel-block" style={{ width: '50%', height: 11, marginTop: 36 }} />
  </div>
);

// ─── Vendor card ──────────────────────────────────────────────────

const VendorCard = ({
  vendor,
  stats,
  isConfirmingDelete,
  onOpen,
  onToggleFav,
  onEdit,
  onRequestDelete,
  onCancelDelete,
}) => {
  const loc = locationLine(vendor);
  const roles = secondaryRoles(vendor);
  const subs = (vendor.subcategories || []).filter(Boolean);
  const lastOrder = formatLastOrder(stats?.lastOrderAt);

  return (
    <div
      className="sd-dir-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(vendor)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(vendor);
        }
      }}
    >
      <div className="sd-dir-card-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`sd-dir-icon-btn sd-dir-star${vendor.is_favourite ? ' is-fav' : ''}`}
          title={vendor.is_favourite ? 'Unfavourite' : 'Mark favourite'}
          aria-label={vendor.is_favourite ? 'Unfavourite' : 'Mark favourite'}
          onClick={() => onToggleFav(vendor)}
        >
          {vendor.is_favourite ? '★' : '☆'}
        </button>
        <button
          type="button"
          className="sd-dir-icon-btn reveal"
          title="Edit vendor"
          aria-label="Edit vendor"
          onClick={() => onEdit(vendor)}
        >
          ✎
        </button>
        {isConfirmingDelete ? (
          <button
            type="button"
            className="sd-dir-icon-btn danger is-confirming"
            onClick={() => onRequestDelete(vendor)}
            onMouseLeave={onCancelDelete}
          >
            ARCHIVE?
          </button>
        ) : (
          <button
            type="button"
            className="sd-dir-icon-btn reveal danger"
            title="Archive vendor"
            aria-label="Archive vendor"
            onClick={() => onRequestDelete(vendor)}
          >
            ✕
          </button>
        )}
      </div>

      <div className="sd-dir-card-name">{vendor.name}</div>
      {loc && (
        <div className="sd-dir-card-loc">
          <span className="dot">●</span>
          <span>{loc}</span>
        </div>
      )}

      <div className="sd-dir-card-type-row">
        <span className="sd-dir-card-type">{(vendor.vendor_type || 'Supplier').toUpperCase()}</span>
      </div>

      <div className="sd-dir-card-roles">
        {vendor.primary_category && (
          <span className="sd-dir-role primary">{vendor.primary_category}</span>
        )}
        {roles.map((r) => (
          <span key={r} className="sd-dir-role">{r}</span>
        ))}
      </div>

      {subs.length > 0 && (
        <div className="sd-dir-subroles">
          {subs.slice(0, 5).map((s) => (
            <span key={s} className="sd-dir-subrole">{s}</span>
          ))}
          {subs.length > 5 && (
            <span className="sd-dir-subrole">+{subs.length - 5}</span>
          )}
        </div>
      )}

      <div className="sd-dir-card-divider" />
      <div className="sd-dir-card-meta">
        <span>
          {stats ? (
            <>
              <span className="strong">{stats.orderCount}</span>{' '}
              {stats.orderCount === 1 ? 'order' : 'orders'}
              {lastOrder ? ` · ${lastOrder}` : ''}
            </>
          ) : (
            <><span className="strong">0</span> orders</>
          )}
        </span>
        <span className="strong">
          {stats ? formatSpend(stats.totalSpend, stats.currency) : '—'}
        </span>
      </div>
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────

const SuppliersDirectoryPage = () => {
  const navigate = useNavigate();
  const { activeTenantId } = useAuth();

  const [vendors, setVendors] = useState([]);
  const [orderStats, setOrderStats] = useState({});
  const [taxonomy, setTaxonomy] = useState({ categories: [], subcategories: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState(null);       // vendor_type | null (= All)
  const [categoryFilter, setCategoryFilter] = useState(null); // primary/category | null
  const [subFilter, setSubFilter] = useState(null);          // subcategory | null

  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null); // null = add mode

  // Body bg lift (same approach as the 9c.2 supplier-detail page).
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F8FAFC';
    return () => { document.body.style.background = prev; };
  }, []);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    const [vRes, sRes, tRes] = await Promise.all([
      fetchVendors(),
      fetchVendorOrderStats(),
      fetchKnownCategoryTaxonomy(),
    ]);
    if (vRes.error) {
      setError(vRes.error.message || 'Could not load the vendor directory.');
      setVendors([]);
      setLoading(false);
      return;
    }
    setVendors(vRes.data || []);
    setOrderStats(sRes.data || {});
    setTaxonomy(mergeTaxonomy(tRes && !tRes.error ? tRes.data : undefined));
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search-filtered set (drives the type-chip counts).
  const searchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => {
      const hay = [
        v.name,
        v.business_city,
        v.business_country,
        v.primary_category,
        ...(v.categories || []),
        ...(v.subcategories || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [vendors, search]);

  const typeFiltered = useMemo(
    () => (typeFilter ? searchFiltered.filter((v) => v.vendor_type === typeFilter) : searchFiltered),
    [searchFiltered, typeFilter],
  );

  const matchesCategory = (v, cat) =>
    v.primary_category === cat || (v.categories || []).includes(cat);

  const categoryFiltered = useMemo(
    () => (categoryFilter ? typeFiltered.filter((v) => matchesCategory(v, categoryFilter)) : typeFiltered),
    [typeFiltered, categoryFilter],
  );

  const visible = useMemo(
    () => (subFilter ? categoryFiltered.filter((v) => (v.subcategories || []).includes(subFilter)) : categoryFiltered),
    [categoryFiltered, subFilter],
  );

  // Faceted counts.
  const typeCounts = useMemo(() => {
    const m = {};
    for (const v of searchFiltered) m[v.vendor_type] = (m[v.vendor_type] || 0) + 1;
    return m;
  }, [searchFiltered]);

  const categoryCounts = useMemo(() => {
    const m = {};
    for (const v of typeFiltered) {
      const cats = new Set([v.primary_category, ...(v.categories || [])].filter(Boolean));
      for (const c of cats) m[c] = (m[c] || 0) + 1;
    }
    return m;
  }, [typeFiltered]);

  const subOptions = useMemo(() => {
    if (!categoryFilter) return [];
    return taxonomy.subcategories?.[categoryFilter] || [];
  }, [categoryFilter, taxonomy]);

  const subCounts = useMemo(() => {
    const m = {};
    for (const v of categoryFiltered) {
      for (const s of v.subcategories || []) m[s] = (m[s] || 0) + 1;
    }
    return m;
  }, [categoryFiltered]);

  const favourites = useMemo(() => visible.filter((v) => v.is_favourite), [visible]);
  const rest = useMemo(() => visible.filter((v) => !v.is_favourite), [visible]);

  const anyFilterActive = !!(search.trim() || typeFilter || categoryFilter || subFilter);

  const clearFilters = () => {
    setSearch('');
    setTypeFilter(null);
    setCategoryFilter(null);
    setSubFilter(null);
  };

  // ─── Card actions ──────────────────────────────────────────────

  const openVendor = (v) => navigate(`/provisioning/suppliers/${v.id}`);

  const handleToggleFav = async (v) => {
    const next = !v.is_favourite;
    setVendors((prev) => prev.map((x) => (x.id === v.id ? { ...x, is_favourite: next } : x)));
    const { error: e } = await toggleVendorFavourite(v.id, next);
    if (e) {
      setVendors((prev) => prev.map((x) => (x.id === v.id ? { ...x, is_favourite: !next } : x)));
      showToast('Could not update favourite', 'error');
    }
  };

  const handleRequestDelete = async (v) => {
    if (confirmingDeleteId !== v.id) {
      setConfirmingDeleteId(v.id);
      return;
    }
    setConfirmingDeleteId(null);
    const snapshot = vendors;
    setVendors((prev) => prev.filter((x) => x.id !== v.id));
    const { error: e } = await archiveVendor(v.id);
    if (e) {
      setVendors(snapshot);
      showToast('Could not archive vendor', 'error');
    } else {
      showToast(`${v.name} archived`, 'success');
    }
  };

  const openAdd = () => {
    setEditingVendor(null);
    setDrawerOpen(true);
  };
  const openEdit = (v) => {
    setEditingVendor(v);
    setDrawerOpen(true);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingVendor(null);
  };
  const handleSaved = () => {
    closeDrawer();
    loadAll();
  };

  // ─── Render helpers ────────────────────────────────────────────

  const renderGrid = (list) => (
    <div className="sd-dir-grid">
      {list.map((v) => (
        <VendorCard
          key={v.id}
          vendor={v}
          stats={orderStats[v.id]}
          isConfirmingDelete={confirmingDeleteId === v.id}
          onOpen={openVendor}
          onToggleFav={handleToggleFav}
          onEdit={openEdit}
          onRequestDelete={handleRequestDelete}
          onCancelDelete={() => setConfirmingDeleteId(null)}
        />
      ))}
    </div>
  );

  return (
    <>
      <Header />
      <div className="sd-dir">
        <div className="sd-dir-inner">

          <button
            type="button"
            className="sd-dir-back"
            onClick={() => navigate('/provisioning')}
          >‹  BACK TO PROVISIONING</button>

          <div className="sd-dir-header-row">
            <div>
              <div className="sd-dir-meta">
                <span className="dot">●</span>
                <span>VENDOR DIRECTORY</span>
                {!loading && (
                  <>
                    <span className="sep">·</span>
                    <span>{vendors.length} ACTIVE</span>
                  </>
                )}
              </div>
              <h1 className="sd-dir-headline">
                Every vendor, <span className="accent">in one berth</span>
                <span className="period">.</span>
              </h1>
              <div className="sd-dir-subline">
                Suppliers, service providers, contractors, agents and brokers — the full book.
              </div>
            </div>
            <button type="button" className="sd-dir-add" onClick={openAdd}>
              + ADD VENDOR
            </button>
          </div>

          <input
            className="sd-dir-search"
            type="text"
            placeholder="Search by name, port, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="sd-dir-filter-label">FILTER BY VENDOR TYPE</div>
          <div className="sd-dir-chip-row">
            <button
              type="button"
              className={`sd-dir-chip${!typeFilter ? ' active' : ''}`}
              onClick={() => setTypeFilter(null)}
            >
              All<span className="count">{searchFiltered.length}</span>
            </button>
            {VENDOR_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`sd-dir-chip${typeFilter === t.value ? ' active' : ''}`}
                onClick={() => setTypeFilter(typeFilter === t.value ? null : t.value)}
              >
                {t.label}<span className="count">{typeCounts[t.value] || 0}</span>
              </button>
            ))}
          </div>

          <div className="sd-dir-filter-label">FILTER BY CATEGORY</div>
          <div className="sd-dir-chip-row">
            {taxonomy.categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`sd-dir-chip${categoryFilter === c ? ' active' : ''}`}
                onClick={() => {
                  const next = categoryFilter === c ? null : c;
                  setCategoryFilter(next);
                  setSubFilter(null);
                }}
              >
                {c}<span className="count">{categoryCounts[c] || 0}</span>
              </button>
            ))}
          </div>

          {categoryFilter && subOptions.length > 0 && (
            <>
              <div className="sd-dir-filter-label">
                SUBCATEGORIES UNDER {categoryFilter.toUpperCase()}
              </div>
              <div className="sd-dir-chip-row">
                {subOptions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`sd-dir-chip${subFilter === s ? ' active' : ''}`}
                    onClick={() => setSubFilter(subFilter === s ? null : s)}
                  >
                    {s}<span className="count">{subCounts[s] || 0}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Body ─────────────────────────────────────────── */}
          {loading ? (
            <div className="sd-dir-grid" style={{ marginTop: 24 }}>
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : error ? (
            <div className="sd-dir-empty">
              <h3>Couldn’t load the directory</h3>
              <p>{error}</p>
              <button type="button" className="sd-dir-add" onClick={loadAll}>RETRY</button>
            </div>
          ) : vendors.length === 0 ? (
            <div className="sd-dir-empty">
              <h3>No vendors yet</h3>
              <p>Add your first supplier, service provider or broker to get started.</p>
              <button type="button" className="sd-dir-add" onClick={openAdd}>+ ADD VENDOR</button>
            </div>
          ) : visible.length === 0 ? (
            <div className="sd-dir-empty">
              <h3>Nothing matches those filters</h3>
              <p>Try widening your search or clearing the filters.</p>
              <button type="button" className="sd-dir-clear" onClick={clearFilters}>
                Clear all filters
              </button>
            </div>
          ) : (
            <>
              {favourites.length > 0 && (
                <>
                  <div className="sd-dir-section-title">
                    <span className="star">★</span>
                    Favourites<span className="period">.</span>
                    <span className="count">{favourites.length}</span>
                  </div>
                  {renderGrid(favourites)}
                </>
              )}

              <div className="sd-dir-section-title">
                {favourites.length > 0 ? 'All vendors' : 'Vendors'}
                <span className="period">.</span>
                <span className="count">{rest.length}</span>
              </div>
              {rest.length > 0
                ? renderGrid(rest)
                : (
                  <div className="sd-dir-empty">
                    <p>Every match is already a favourite.</p>
                  </div>
                )}
            </>
          )}

          {anyFilterActive && !loading && !error && (
            <button type="button" className="sd-dir-clear" onClick={clearFilters} style={{ marginTop: 8 }}>
              Clear all filters
            </button>
          )}

          <div>
            <button
              type="button"
              className="sd-dir-archive-link"
              onClick={() => navigate('/provisioning/suppliers/archive')}
            >
              View archived vendors  ›
            </button>
          </div>
        </div>
      </div>

      {drawerOpen && (
        <AddVendorForm
          vendor={editingVendor}
          activeTenantId={activeTenantId}
          taxonomy={taxonomy}
          onClose={closeDrawer}
          onSaved={handleSaved}
        />
      )}
    </>
  );
};

export default SuppliersDirectoryPage;

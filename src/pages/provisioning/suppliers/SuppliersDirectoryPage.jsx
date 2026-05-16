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

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { summariseRegions } from './regionGrouping';
import AddVendorForm from './AddVendorForm';
import { showToast } from '../../../utils/toast';
import '../../../styles/editorial.css';
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
          title="Edit supplier"
          aria-label="Edit supplier"
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
            title="Archive supplier"
            aria-label="Archive supplier"
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
  const [typeFilter, setTypeFilter] = useState(null);        // vendor_type | null (= All)
  const [categoryFilters, setCategoryFilters] = useState([]); // multi-select categories
  const [filterOpen, setFilterOpen] = useState(false);       // filters popover
  const [catDropdownOpen, setCatDropdownOpen] = useState(false); // category list expanded
  const [catSearch, setCatSearch] = useState('');            // dropdown's own search

  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null); // null = add mode

  const filterAnchorRef = useRef(null);

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
      setError(vRes.error.message || 'Could not load the supplier directory.');
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

  const matchesCategory = (v, cat) =>
    v.primary_category === cat || (v.categories || []).includes(cat);

  // A vendor matches the category filter if it matches ANY selected
  // category (OR semantics — standard multi-select facet).
  const matchesAnyCategory = (v) =>
    categoryFilters.length === 0 || categoryFilters.some((c) => matchesCategory(v, c));

  const visible = useMemo(() => {
    let r = searchFiltered;
    if (typeFilter) r = r.filter((v) => v.vendor_type === typeFilter);
    if (categoryFilters.length) r = r.filter(matchesAnyCategory);
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchFiltered, typeFilter, categoryFilters]);

  // Faceted counts — each axis counts against the search + the OTHER
  // selected axis (so the numbers reflect what picking a chip would
  // actually yield given the rest of the active filter state).
  const typeCounts = useMemo(() => {
    const base = categoryFilters.length
      ? searchFiltered.filter((v) => categoryFilters.some((c) => matchesCategory(v, c)))
      : searchFiltered;
    const m = { __all: base.length };
    for (const v of base) m[v.vendor_type] = (m[v.vendor_type] || 0) + 1;
    return m;
  }, [searchFiltered, categoryFilters]);

  const categoryCounts = useMemo(() => {
    const base = typeFilter
      ? searchFiltered.filter((v) => v.vendor_type === typeFilter)
      : searchFiltered;
    const m = {};
    for (const v of base) {
      const cats = new Set([v.primary_category, ...(v.categories || [])].filter(Boolean));
      for (const c of cats) m[c] = (m[c] || 0) + 1;
    }
    return m;
  }, [searchFiltered, typeFilter]);

  const favourites = useMemo(() => visible.filter((v) => v.is_favourite), [visible]);
  const rest = useMemo(() => visible.filter((v) => !v.is_favourite), [visible]);

  // Directory-wide geographic breakdown for the meta strip
  // (total + region split, independent of the active filters).
  const regionSummary = useMemo(() => summariseRegions(vendors), [vendors]);

  const toggleCategory = (c) => {
    setCategoryFilters((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  const activeFilters = useMemo(() => {
    const out = [];
    if (typeFilter) out.push({ id: 'type', kind: 'type', label: `Type: ${typeFilter}` });
    for (const c of categoryFilters) {
      out.push({ id: `cat:${c}`, kind: 'category', value: c, label: `Category: ${c}` });
    }
    return out;
  }, [typeFilter, categoryFilters]);
  const activeFilterCount = activeFilters.length;
  const hasActiveFilters = activeFilterCount > 0;

  const clearFilters = () => {
    setTypeFilter(null);
    setCategoryFilters([]);
  };
  const removeFilter = (f) => {
    if (f.kind === 'type') setTypeFilter(null);
    if (f.kind === 'category') setCategoryFilters((prev) => prev.filter((x) => x !== f.value));
  };

  // Close the filters popover on outside click / Esc / re-click.
  useEffect(() => {
    if (!filterOpen) return undefined;
    const onDown = (e) => {
      if (filterAnchorRef.current && !filterAnchorRef.current.contains(e.target)) {
        setFilterOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setFilterOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [filterOpen]);

  // Reopening the popover always starts with the category list collapsed.
  useEffect(() => {
    if (!filterOpen) { setCatDropdownOpen(false); setCatSearch(''); }
  }, [filterOpen]);

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
      showToast('Could not archive supplier', 'error');
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

          <div className="sd-dir-headblock">
            <div className="editorial-meta">
              <span className="dot">●</span>
              {!loading && (
                <>
                  <span>
                    {regionSummary.total} {regionSummary.total === 1 ? 'VENDOR' : 'VENDORS'}
                  </span>
                  {regionSummary.parts.length > 0 && (
                    <>
                      <span className="bar" />
                      <span>
                        {regionSummary.parts
                          .map((p) => `${p.count} ${p.region}`)
                          .join(' · ')}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
            <h1 className="editorial-greeting">
              Vendors<span className="period">,</span>{' '}
              <em>directory</em><span className="period">.</span>
            </h1>
          </div>

          <div className="sd-dir-search-row">
            <input
              className="sd-dir-search"
              type="text"
              placeholder="Search by name, port, category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="sd-dir-filter-anchor" ref={filterAnchorRef}>
              <button
                type="button"
                className={`sd-dir-filter-btn${filterOpen ? ' is-open' : ''}`}
                aria-expanded={filterOpen}
                onClick={() => setFilterOpen((v) => !v)}
              >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                  <circle cx="9" cy="6" r="2.4" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="12" r="2.4" fill="currentColor" stroke="none" />
                  <circle cx="8" cy="18" r="2.4" fill="currentColor" stroke="none" />
                </svg>
                Filters
                {activeFilterCount > 0 && (
                  <span className="sd-dir-filter-badge">({activeFilterCount})</span>
                )}
              </button>

              {filterOpen && (
                <div className="sd-dir-filter-pop" role="dialog" aria-label="Filter suppliers">
                  <div className="sd-dir-filter-pop-head">
                    <span className="sd-dir-filter-pop-title">Filter suppliers</span>
                    {hasActiveFilters && (
                      <button type="button" className="sd-dir-clear" onClick={clearFilters}>
                        Clear all
                      </button>
                    )}
                  </div>

                  <div className="sd-dir-fsection">
                    <div className="sd-dir-fsection-label">TYPE</div>
                    <div className="sd-dir-fchips">
                      <button
                        type="button"
                        className={`sd-dir-fchip${!typeFilter ? ' is-on' : ''}`}
                        onClick={() => setTypeFilter(null)}
                      >
                        All<span className="count">{typeCounts.__all || 0}</span>
                      </button>
                      {VENDOR_TYPES.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          className={`sd-dir-fchip${typeFilter === t.value ? ' is-on' : ''}`}
                          onClick={() => setTypeFilter(typeFilter === t.value ? null : t.value)}
                        >
                          {t.label}<span className="count">{typeCounts[t.value] || 0}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="sd-dir-fsection">
                    <div className="sd-dir-fsection-label">CATEGORY</div>

                    <button
                      type="button"
                      className={`sd-dir-cattrigger${catDropdownOpen ? ' is-open' : ''}`}
                      onClick={() => setCatDropdownOpen((v) => !v)}
                    >
                      <span className={categoryFilters.length ? 'sel' : 'placeholder'}>
                        {categoryFilters.length ? categoryFilters.join(', ') : 'All categories'}
                      </span>
                      <span className="chev">{catDropdownOpen ? '▴' : '▾'}</span>
                    </button>

                    {!catDropdownOpen ? (
                      <div className="sd-dir-cathint">
                        {categoryFilters.length
                          ? `${categoryFilters.length} ${categoryFilters.length === 1 ? 'category' : 'categories'} selected · click to change`
                          : 'Click to filter by category'}
                      </div>
                    ) : (
                      <div className="sd-dir-catdd">
                        <input
                          className="sd-dir-catdd-search"
                          type="text"
                          placeholder="Search categories…"
                          value={catSearch}
                          autoFocus
                          onChange={(e) => setCatSearch(e.target.value)}
                        />
                        <div className="sd-dir-catdd-list">
                          {(() => {
                            const q = catSearch.trim().toLowerCase();
                            const opts = taxonomy.categories.filter(
                              (c) => !q || c.toLowerCase().includes(q),
                            );
                            if (opts.length === 0) {
                              return (
                                <div className="sd-dir-catempty">
                                  No categories match “{catSearch}”.
                                </div>
                              );
                            }
                            return opts.map((c) => {
                              const on = categoryFilters.includes(c);
                              const n = categoryCounts[c] || 0;
                              return (
                                <button
                                  key={c}
                                  type="button"
                                  className={`sd-dir-catrow${on ? ' is-on' : ''}`}
                                  onClick={() => toggleCategory(c)}
                                >
                                  <span className={`sd-dir-catbox${on ? ' is-checked' : ''}`}>
                                    {on ? '✓' : ''}
                                  </span>
                                  <span className="sd-dir-catname">{c}</span>
                                  <span className={`sd-dir-catcount${n === 0 ? ' zero' : ''}`}>
                                    {n}
                                  </span>
                                </button>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button type="button" className="sd-dir-add" onClick={openAdd}>
              + ADD SUPPLIER
            </button>
          </div>

          {hasActiveFilters && (
            <div className="sd-dir-active-filters">
              {activeFilters.map((f) => (
                <span key={f.id} className="sd-dir-afchip">
                  {f.label}
                  <button
                    type="button"
                    className="sd-dir-afchip-x"
                    aria-label={`Remove ${f.label} filter`}
                    onClick={() => removeFilter(f)}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button type="button" className="sd-dir-clear" onClick={clearFilters}>
                Clear all
              </button>
            </div>
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
              <h3>No suppliers yet</h3>
              <p>Add your first supplier, service provider or broker to get started.</p>
              <button type="button" className="sd-dir-add" onClick={openAdd}>+ ADD SUPPLIER</button>
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
                {favourites.length > 0 ? 'All suppliers' : 'Suppliers'}
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

          <div>
            <button
              type="button"
              className="sd-dir-archive-link"
              onClick={() => navigate('/provisioning/suppliers/archive')}
            >
              View archived suppliers  ›
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

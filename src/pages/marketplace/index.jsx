// Cargo Marketplace — Phase 2, the spine.
//
// One page, three steps, one click apart:
//   i · The Providers — the front door: a wall of shops. A toggle here
//       flips to "all items" (every supplier's stock in one flat list).
//   ii · The Aisles — you entered a shop: a dark storefront band, and
//       every aisle below now belongs to that supplier.
//   iii · The Counter — the drawer. "Add to board" fills it; lines are
//       grouped by supplier, because each group becomes its own order
//       when it lands on the board.
//
// Browsing never creates an order: the Counter lands on a provisioning
// board as ordinary draft lines (pre-priced, supplier-assigned,
// catalogue-linked), and the board stays the single point of control.
// Night mode (The Dark Market) is a theme toggle, not a fourth view.

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ChevronLeft, ShoppingBasket, Moon, Sun, Search, X, ChevronRight, MapPin,
} from 'lucide-react';
import Header from '../../components/navigation/Header';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { showToast } from '../../utils/toast';
import {
  fetchMarketplaceSuppliers,
  fetchMarketplaceSupplierStats,
  fetchMarketplaceProducts,
  fetchTenantSupplierIds,
  fetchPortLocations,
  ensureTenantSupplierLinks,
  addBasketToBoard,
} from '../provisioning/utils/marketplaceStorage';
import MapPopover from './MapPopover';
import { supplierReaches } from './geo';
import {
  fetchProvisioningLists,
  createProvisioningList,
} from '../provisioning/utils/provisioningStorage';
import './marketplace.css';
import '../../styles/editorial.css'; // shared meta strip + greeting — one source of truth

import { categoryHue, orderCategories } from '../../utils/catalogueConstants';

// Boards that can still take new lines — everything not yet fully
// delivered. New lines land as drafts with their own lifecycle, so a
// board mid-quote or mid-delivery can still absorb a marketplace run.
const CLOSED_BOARD_STATUSES = new Set(['delivered', 'delivered_with_discrepancies', 'completed']);
const BOARD_STATUS_LABEL = {
  draft: 'draft', pending_approval: 'pending approval', sent_to_supplier: 'sent',
  quote_received: 'quote in', partially_confirmed: 'partially confirmed',
  confirmed: 'confirmed', partially_delivered: 'partially delivered',
};
const NEW_BOARD = '__new__';
const THEME_KEY = 'mp-theme';

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const fmtPack = (p) => {
  if (!p.pack_size && !p.unit_size) return p.unit || '';
  const inner = [p.pack_size, p.pack_unit].filter(Boolean).join(' × ');
  return [p.unit, [inner || null, p.unit_size].filter(Boolean).join(' · ')].filter(Boolean).join(' — ');
};

const money = (n, ccy = 'EUR') =>
  n != null ? `${Number(n).toFixed(2)} ${ccy}` : '—';

const minQtyOf = (product) => Math.max(1, Number(product.min_order_qty) || 1);

// Response time in human units: <1h, ~6h, ~2d.
const fmtResponse = (hours) => {
  if (hours == null) return null;
  if (hours < 1) return '<1h';
  if (hours < 24) return `~${Math.round(hours)}h`;
  return `~${Math.round(hours / 24)}d`;
};

// ─────────────────────────────────────────────────────────────────────
// ii · The Aisles / all-items — one product card.
// The card's control IS the basket line: − qty + wired straight
// through. First + jumps to the product's minimum order; − below it
// removes the line. No transient "Added" state, no layout shift.
// ─────────────────────────────────────────────────────────────────────
const ProductCard = ({ product, supplier, mine, showSupplier, basketQty, onSetQty }) => {
  const minQty = minQtyOf(product);
  const out = !product.in_stock || (product.stock_qty != null && Number(product.stock_qty) <= 0);
  const stock = product.stock_qty != null ? Number(product.stock_qty) : null;
  const scarce = !out && stock != null && stock <= (Number(product.reorder_point) || 10);
  const opsBits = [
    product.lead_time_days ? `${product.lead_time_days}d notice` : null,
    minQty > 1 ? `min ${minQty}` : null,
  ].filter(Boolean);

  const inc = () => onSetQty(product, basketQty === 0 ? minQty : basketQty + 1);
  const dec = () => onSetQty(product, basketQty - 1 < minQty ? 0 : basketQty - 1);

  return (
    <div className="mp-card">
      {product.image_url
        ? <img className="mp-img" src={product.image_url} alt="" loading="lazy" />
        : <div className="mp-img-ph" style={{ background: categoryHue(product.category) }}>
            {(product.name || '?').charAt(0).toUpperCase()}
          </div>}
      <div className="mp-pname">{product.name}</div>
      {showSupplier && (
        <div className="mp-psup">
          {supplier?.name || 'Supplier'}
          {supplier?.verified && <span className="tick"> ✓</span>}
          {mine && <span className="mp-suptag">Yours</span>}
        </div>
      )}
      <div className="mp-ppack">
        {fmtPack(product)}
        {opsBits.length > 0 && <span className="mp-ops"> · {opsBits.join(' · ')}</span>}
      </div>
      <div className="mp-prow">
        <span className="mp-price">
          {money(product.unit_price, product.currency)}
          {product.unit && <small> / {product.unit}</small>}
        </span>
        {out
          ? <span className="mp-oos">Out of stock</span>
          : scarce
            ? <span className="mp-scarce">Only {stock} left</span>
            : (product.updated_at && <span className="mp-upd">upd {fmtDate(product.updated_at)}</span>)}
      </div>
      <div className={`mp-qtybar ${basketQty > 0 ? 'in' : ''} ${out ? 'off' : ''}`}>
        <button type="button" onClick={dec} disabled={out || basketQty === 0} aria-label="Fewer">−</button>
        <span className="q">
          {basketQty > 0
            ? <>{basketQty}<small> added</small></>
            : (out ? 'Unavailable' : 'Add to board')}
        </span>
        <button type="button" onClick={inc} disabled={out} aria-label="More">+</button>
      </div>
    </div>
  );
};

const Marketplace = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const [suppliers, setSuppliers] = useState([]);
  const [stats, setStats] = useState(() => new Map());
  const [products, setProducts] = useState([]);
  const [mySupplierIds, setMySupplierIds] = useState(() => new Set());
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Navigation: which shop you're inside (null = the Providers wall),
  // and whether the wall's "all items" toggle is on.
  const [enteredId, setEnteredId] = useState(searchParams.get('supplier') || null);
  const [browseAll, setBrowseAll] = useState(false);
  const [deckIndex, setDeckIndex] = useState(0); // focused shop in the coverflow

  // Theme — The Dark Market lives here as a switch, remembered per user.
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });
  useEffect(() => { try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ } }, [theme]);

  // Browse controls (shared by aisles + all-items).
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [port, setPort] = useState('All');
  const [showFilter, setShowFilter] = useState('all'); // all | in | mine
  const [sortBy, setSortBy] = useState('name');
  const [provSearch, setProvSearch] = useState(''); // the deck's own search
  const [provLoc, setProvLoc] = useState('');       // "serves my area" typed text
  const [queryPoint, setQueryPoint] = useState(null); // geocoded {lat,lng,label}
  const [mapOpen, setMapOpen] = useState(false);
  const [portCoords, setPortCoords] = useState(() => new Map());
  const [provCat, setProvCat] = useState('All');
  const [provSort, setProvSort] = useState('name');

  const [basket, setBasket] = useState([]); // [{ product, qty }]
  const [counterOpen, setCounterOpen] = useState(false);
  const [targetBoard, setTargetBoard] = useState(searchParams.get('board') || '');
  const [newBoardName, setNewBoardName] = useState('');
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [sups, st, ports] = await Promise.all([
          fetchMarketplaceSuppliers(),
          fetchMarketplaceSupplierStats(),
          fetchPortLocations(),
        ]);
        if (!live) return;
        setSuppliers(sups);
        setStats(st);
        setPortCoords(ports);
        const [prods, mine, lists] = await Promise.all([
          fetchMarketplaceProducts(sups.map(s => s.id)),
          fetchTenantSupplierIds(activeTenantId),
          activeTenantId ? fetchProvisioningLists(activeTenantId).catch(() => []) : [],
        ]);
        if (!live) return;
        setProducts(prods);
        setMySupplierIds(mine);
        const open = (lists || []).filter(l => !CLOSED_BOARD_STATUSES.has(l.status));
        setBoards(open);
        const param = searchParams.get('board');
        if (param && open.some(l => l.id === param)) setTargetBoard(param);
        else if (open.length) setTargetBoard(prev => prev || open[0].id);
        else setTargetBoard(NEW_BOARD);
      } catch (e) {
        if (live) setError(e.message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenantId]);

  const supplierById = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers]);
  const enteredSupplier = enteredId ? supplierById.get(enteredId) : null;
  // Deep-link ?supplier= may resolve only after suppliers load.
  useEffect(() => {
    if (enteredId && suppliers.length && !supplierById.has(enteredId)) setEnteredId(null);
  }, [enteredId, suppliers, supplierById]);

  const stage = enteredSupplier ? 'aisles' : (browseAll ? 'items' : 'providers');

  // Reset the browse controls whenever you change what you're browsing.
  const resetBrowse = () => {
    setSearch(''); setCategory('All'); setPort('All'); setShowFilter('all'); setSortBy('name');
  };
  const enterShop = (s) => { setEnteredId(s.id); resetBrowse(); window.scrollTo({ top: 0 }); };
  const leaveShop = () => { setEnteredId(null); setBrowseAll(false); resetBrowse(); };
  const openAllItems = () => { setBrowseAll(true); resetBrowse(); };

  const productCount = useMemo(() => {
    const c = new Map();
    products.forEach(p => c.set(p.supplier_id, (c.get(p.supplier_id) || 0) + 1));
    return c;
  }, [products]);

  // ── Providers (coverflow) ──
  // Per-shop storefront facts, drawn from the live catalogue: product
  // count, the busiest aisles (with a real count), and when it last
  // moved. These are always-true numbers — the confident thing to show
  // on a shop with no order track record yet.
  const supplierMeta = useMemo(() => {
    const m = new Map();
    suppliers.forEach(s => m.set(s.id, { count: 0, cats: {}, lastUpdated: null }));
    products.forEach(p => {
      const e = m.get(p.supplier_id);
      if (!e) return;
      e.count += 1;
      const c = p.category || 'Other';
      e.cats[c] = (e.cats[c] || 0) + 1;
      if (p.updated_at && (!e.lastUpdated || p.updated_at > e.lastUpdated)) e.lastUpdated = p.updated_at;
    });
    m.forEach(e => { e.topCats = Object.entries(e.cats).sort((a, b) => b[1] - a[1]).map(([k]) => k); });
    return m;
  }, [suppliers, products]);

  // Categories the shops cover — feeds the deck's category filter.
  const provCats = useMemo(() => {
    const s = new Set();
    suppliers.forEach(x => (x.categories || []).forEach(c => s.add(c)));
    return Array.from(s).sort();
  }, [suppliers]);

  // "Serves my area": once the crew geocodes a point on the map we use
  // true distance (any covered port within the shop's service radius);
  // otherwise we fall back to a plain name match on the typed text.
  const servesArea = (s, loc) => {
    if (queryPoint) return supplierReaches(s, portCoords, queryPoint);
    if (!loc) return true;
    return (s.coverage_ports || []).some(p => p.toLowerCase().includes(loc))
      || (s.business_city || '').toLowerCase().includes(loc)
      || (s.business_country || '').toLowerCase().includes(loc);
  };

  const wallSuppliers = useMemo(() => {
    const q = provSearch.trim().toLowerCase();
    const loc = provLoc.trim().toLowerCase();
    const rows = suppliers.filter(s =>
      servesArea(s, loc)
      && (provCat === 'All' || (s.categories || []).includes(provCat))
      && (!q
        || (s.name || '').toLowerCase().includes(q)
        || (s.categories || []).some(c => c.toLowerCase().includes(q))
        || (s.coverage_ports || []).some(p => p.toLowerCase().includes(q))
        || (s.business_city || '').toLowerCase().includes(q)));
    const cnt = (id) => supplierMeta.get(id)?.count || 0;
    const upd = (id) => supplierMeta.get(id)?.lastUpdated || '';
    const cmp = {
      name: (a, b) => a.name.localeCompare(b.name),
      products: (a, b) => cnt(b.id) - cnt(a.id),
      updated: (a, b) => (upd(b.id) > upd(a.id) ? 1 : upd(b.id) < upd(a.id) ? -1 : 0),
      verified: (a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0),
    }[provSort] || ((a, b) => a.name.localeCompare(b.name));
    return [...rows].sort(cmp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers, provSearch, provLoc, queryPoint, portCoords, provCat, provSort, supplierMeta]);

  const provFiltersDirty = provSearch || provLoc || queryPoint || provCat !== 'All' || provSort !== 'name';

  // ── Browse surface (aisles = one supplier; items = all) ──
  const ports = useMemo(() => {
    const set = new Set();
    suppliers.forEach(s => (s.coverage_ports || []).forEach(p => set.add(p)));
    return Array.from(set).sort();
  }, [suppliers]);

  const scopedProducts = useMemo(() => {
    if (stage === 'aisles') return products.filter(p => p.supplier_id === enteredId);
    return products; // all-items
  }, [products, stage, enteredId]);

  const q = search.trim().toLowerCase();
  const searched = useMemo(() => scopedProducts.filter(p =>
    (port === 'All' || (supplierById.get(p.supplier_id)?.coverage_ports || []).includes(port))
    && (!q
      || p.name.toLowerCase().includes(q)
      || (p.description ?? '').toLowerCase().includes(q)
      || (p.sku ?? '').toLowerCase().includes(q)
      || (p.barcode ?? '').includes(q))
  ), [scopedProducts, port, supplierById, q]);

  const catCounts = useMemo(() => {
    const c = {};
    searched.forEach(p => { c[p.category || 'Other'] = (c[p.category || 'Other'] || 0) + 1; });
    return c;
  }, [searched]);

  const filtered = useMemo(() => {
    let rows = category === 'All' ? searched : searched.filter(p => (p.category || 'Other') === category);
    if (showFilter === 'in') rows = rows.filter(p => p.in_stock && !(p.stock_qty != null && Number(p.stock_qty) <= 0));
    if (showFilter === 'mine') rows = rows.filter(p => mySupplierIds.has(p.supplier_id));
    const cmp = {
      name: (a, b) => a.name.localeCompare(b.name),
      price_asc: (a, b) => (a.unit_price ?? Infinity) - (b.unit_price ?? Infinity),
      price_desc: (a, b) => (b.unit_price ?? -1) - (a.unit_price ?? -1),
      updated_desc: (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0),
    }[sortBy] || ((a, b) => a.name.localeCompare(b.name));
    return [...rows].sort(cmp);
  }, [searched, category, showFilter, sortBy, mySupplierIds]);

  const chipDefs = [
    { key: 'All', label: 'All', count: searched.length },
    ...orderCategories(Object.keys(catCounts)).map(c => ({ key: c, label: c, count: catCounts[c] })),
  ];
  const filtersDirty = search || port !== 'All' || category !== 'All' || showFilter !== 'all' || sortBy !== 'name';

  // ── Counter (basket) ──
  const setProductQty = (product, qty) => setBasket(prev => {
    if (qty <= 0 || qty < minQtyOf(product)) return prev.filter(l => l.product.id !== product.id);
    const idx = prev.findIndex(l => l.product.id === product.id);
    if (idx === -1) return [...prev, { product, qty }];
    const next = [...prev];
    next[idx] = { ...next[idx], qty };
    return next;
  });
  const setLineQty = (productId, qty) => {
    const line = basket.find(l => l.product.id === productId);
    if (line) setProductQty(line.product, qty);
  };
  const basketQtyOf = useMemo(() => {
    const m = new Map();
    basket.forEach(l => m.set(l.product.id, l.qty));
    return (id) => m.get(id) || 0;
  }, [basket]);
  const removeLine = (productId) => setBasket(prev => prev.filter(l => l.product.id !== productId));

  const basketBySupplier = useMemo(() => {
    const groups = new Map();
    basket.forEach(l => {
      const sid = l.product.supplier_id;
      if (!groups.has(sid)) groups.set(sid, []);
      groups.get(sid).push(l);
    });
    return groups;
  }, [basket]);

  const basketUnits = basket.reduce((s, l) => s + l.qty, 0);
  const basketTotal = basket.reduce((s, l) => s + (l.product.unit_price ?? 0) * l.qty, 0);
  const basketCurrency = basket[0]?.product.currency || 'EUR';
  const mixedCurrency = basket.some(l => (l.product.currency || 'EUR') !== basketCurrency);

  const placeBasket = async () => {
    if (!basket.length) return;
    setPlacing(true);
    setError(null);
    try {
      let listId = targetBoard;
      if (targetBoard === NEW_BOARD) {
        const title = newBoardName.trim() || `Marketplace order — ${fmtDate(new Date().toISOString())}`;
        const list = await createProvisioningList({
          tenant_id: activeTenantId,
          title,
          status: 'draft',
          department: ['Galley'],
          created_by: user?.id || null,
          owner_id: user?.id || null,
          visibility: 'private',
          is_private: true,
          notes: '',
          is_template: false,
        });
        listId = list.id;
      }
      await addBasketToBoard(listId, basket);
      await ensureTenantSupplierLinks(activeTenantId, Array.from(basketBySupplier.keys()).filter(id => !mySupplierIds.has(id)));
      showToast(`${basket.length} item${basket.length === 1 ? '' : 's'} added to the board`, 'success');
      setBasket([]);
      navigate(`/provisioning/${listId}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setPlacing(false);
    }
  };

  const enteredStats = enteredSupplier ? stats.get(enteredSupplier.id) : null;

  return (
    <>
      <Header />
      <div className="mp-page" data-theme={theme}>
        <div className="mp-shell">
          {/* Meta bar — the one place an eyebrow-like row is allowed. */}
          <div className="mp-metabar">
            <button className="mp-back" onClick={() => navigate('/provisioning')}>
              <ChevronLeft size={16} /> Back to Provisioning
            </button>
            <div className="mp-meta-spacer" />
            <button
              className="mp-theme"
              onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
              title={theme === 'dark' ? 'Day market' : 'Night market'}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>

          {error && <div className="mp-error">{error}</div>}
          {loading && <div className="mp-loading">Loading the marketplace…</div>}

          {/* ── i · The Providers ── */}
          {!loading && stage === 'providers' && (() => {
            const idx = wallSuppliers.length ? Math.min(Math.max(deckIndex, 0), wallSuppliers.length - 1) : 0;
            const focused = wallSuppliers[idx] || null;
            const fmeta = focused ? (supplierMeta.get(focused.id) || {}) : {};
            const fports = focused?.coverage_ports || [];
            const left = idx > 0 ? wallSuppliers[idx - 1] : null;
            const right = focused && idx < wallSuppliers.length - 1 ? wallSuppliers[idx + 1] : null;

            // A flanking card: a real neighbour (dimmed, clickable to
            // rotate) or a "joining soon" placeholder that sells the
            // network before it exists.
            const sideCard = (sup, side) => sup ? (
              <button
                key={side}
                className={`mp-supcard side ${side}`}
                onClick={() => setDeckIndex(side === 'l' ? idx - 1 : idx + 1)}
              >
                <span className="tag">{supplierMeta.get(sup.id)?.count || 0} products</span>
                <div className="name">{sup.name}</div>
              </button>
            ) : (
              <div
                key={side}
                className={`mp-supcard side ${side} ghost`}
                onClick={() => showToast('Supplier invites are coming soon — you’ll nominate the suppliers you already use.', 'info')}
              >
                <span className="tag">Joining soon</span>
                <div className="name">—</div>
              </div>
            );

            const tagBits = ['Provisions', fports.slice(0, 2).join(' — ')].filter(Boolean).join(' · ');

            return (
              <>
                {/* Meta strip + headline — shared editorial furniture, matching Provisioning */}
                <p className="editorial-meta mp-editorial-meta">
                  <span className="dot">●</span>
                  <span>Marketplace</span>
                  <span className="bar" />
                  <span className="muted">{suppliers.length} supplier{suppliers.length === 1 ? '' : 's'}</span>
                  <span className="bar" />
                  <span className="muted">{products.length} products</span>
                  {fports[0] && <><span className="bar" /><span className="muted">Port · {fports[0]}</span></>}
                  <span className="bar" />
                  <span className="muted mp-live">Live prices</span>
                </p>
                <h1 className="editorial-greeting mp-greeting">
                  THE MARKET<span className="period">,</span> <em>at your berth</em><span className="period">.</span>
                </h1>

                {/* Toolbar beneath the header: search + shop filters + sort + all-items */}
                <div className="mp-controls">
                  <label className="mp-searchwrap grow">
                    <Search size={15} className="ic" />
                    <input
                      className="mp-search bare"
                      placeholder="Search suppliers, ports, categories…"
                      value={provSearch}
                      onChange={(e) => { setProvSearch(e.target.value); setDeckIndex(0); }}
                    />
                  </label>
                  <button
                    type="button"
                    className={`mp-locfield ${queryPoint ? 'set' : ''}`}
                    onClick={() => setMapOpen(true)}
                    title="Open the map — see which suppliers reach your area"
                  >
                    <MapPin size={14} className="ic" />
                    <span className={`mp-loc-val ${queryPoint || provLoc ? '' : 'ph'}`}>
                      {queryPoint ? (queryPoint.label?.split(',')[0] || 'Your area') : (provLoc || 'Serves my area')}
                    </span>
                  </button>
                  {provCats.length > 0 && (
                    <label className="mp-filter">
                      <span className="k">Category</span>
                      <select value={provCat} onChange={(e) => { setProvCat(e.target.value); setDeckIndex(0); }}>
                        <option value="All">All</option>
                        {provCats.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="mp-filter">
                    <span className="k">Sort</span>
                    <select value={provSort} onChange={(e) => { setProvSort(e.target.value); setDeckIndex(0); }}>
                      <option value="name">Name A–Z</option>
                      <option value="products">Most products</option>
                      <option value="updated">Recently updated</option>
                      <option value="verified">Verified first</option>
                    </select>
                  </label>
                  {provFiltersDirty && (
                    <button
                      type="button"
                      className="mp-clear"
                      onClick={() => { setProvSearch(''); setProvLoc(''); setQueryPoint(null); setProvCat('All'); setProvSort('name'); setDeckIndex(0); }}
                    >
                      × Clear all
                    </button>
                  )}
                  <button className="mp-allitems mp-allitems-end" onClick={openAllItems}>
                    Browse all items <ChevronRight size={14} />
                  </button>
                </div>

                {!focused ? (
                  <div className="mp-empty">
                    {suppliers.length === 0
                      ? 'No suppliers have published catalogues yet.'
                      : 'No suppliers match those filters.'}
                  </div>
                ) : (
                  <>
                    <div className="mp-deck">
                      {sideCard(left, 'l')}
                      <button className="mp-supcard center" onClick={() => enterShop(focused)}>
                        <span className="tag">{tagBits}</span>
                        <div className="name">
                          {focused.name}
                          {focused.verified && <span className="v"> ✓</span>}
                          {mySupplierIds.has(focused.id) && <span className="mp-supyours">Yours</span>}
                        </div>
                        <div className="meta">
                          {fmeta.count || focused.catalogue_count} products
                          {fmeta.lastUpdated ? ` · updated ${fmtDate(fmeta.lastUpdated)}` : ''}
                        </div>
                        <div className="cats">
                          {(fmeta.topCats || []).slice(0, 3).map(c => <span key={c}>{c}</span>)}
                          {(fmeta.topCats?.length || 0) > 3 && <span>+{fmeta.topCats.length - 3}</span>}
                        </div>
                        <span className="enter">Enter supplier →</span>
                      </button>
                      {sideCard(right, 'r')}
                    </div>

                    {wallSuppliers.length > 1 && (
                      <div className="mp-deckdots">
                        {wallSuppliers.map((s, i) => (
                          <button
                            key={s.id}
                            className={i === idx ? 'on' : ''}
                            onClick={() => setDeckIndex(i)}
                            aria-label={`View ${s.name}`}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            );
          })()}

          {/* ── ii · The Aisles / all-items ── */}
          {!loading && stage !== 'providers' && (
            <>
              {stage === 'aisles' ? (
                <div className="mp-shopband">
                  <button className="mp-leaveshop" onClick={leaveShop}>
                    <X size={14} /> Leave supplier
                  </button>
                  <div className="mp-shop-id">
                    {enteredSupplier.logo_url
                      ? <img className="mp-shop-logo" src={enteredSupplier.logo_url} alt="" />
                      : <span className="mp-shop-logo ph">{(enteredSupplier.name || '?').charAt(0).toUpperCase()}</span>}
                    <div>
                      <div className="mp-shop-name">
                        {enteredSupplier.name}
                        {enteredSupplier.verified && <span className="tick">✓</span>}
                        {mySupplierIds.has(enteredSupplier.id) && <span className="mp-shop-yours">Your supplier</span>}
                      </div>
                      <div className="mp-shop-where">
                        {[enteredSupplier.business_city, enteredSupplier.business_country].filter(Boolean).join(', ')
                          || (enteredSupplier.coverage_ports || []).slice(0, 4).join(' · ') || 'Coverage on request'}
                      </div>
                    </div>
                  </div>
                  <div className="mp-shop-stats">
                    {enteredStats && enteredStats.orders > 0 ? (
                      <>
                        <div className="mp-shopstat"><span className="v">{enteredStats.fulfilled}</span><span className="l">orders filled</span></div>
                        <div className="mp-shopstat"><span className="v">{enteredStats.onTimePct != null ? `${enteredStats.onTimePct}%` : '—'}</span><span className="l">on time</span></div>
                        <div className="mp-shopstat"><span className="v">{fmtResponse(enteredStats.responseHours) || '—'}</span><span className="l">typical reply</span></div>
                      </>
                    ) : (
                      <div className="mp-shopstat solo"><span className="v">New</span><span className="l">to Cargo</span></div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mp-itemshead">
                  <button className="mp-leaveshop light" onClick={leaveShop}>
                    <ArrowLeft size={14} /> All suppliers
                  </button>
                  <h1 className="mp-title sm">All <em>items</em></h1>
                  <p className="mp-sub">Every shop's live stock in one list — filter by port or category, add straight to the board.</p>
                </div>
              )}

              <div className="mp-controls">
                <label className="mp-searchwrap grow">
                  <Search size={15} className="ic" />
                  <input
                    className="mp-search bare"
                    placeholder={stage === 'aisles' ? `Search ${enteredSupplier.name}…` : 'Search products, brands, barcodes…'}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {stage === 'items' && (
                  <label className="mp-filter">
                    <span className="k">Port</span>
                    <select value={port} onChange={(e) => setPort(e.target.value)}>
                      <option value="All">All</option>
                      {ports.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </label>
                )}
                <label className="mp-filter">
                  <span className="k">Category</span>
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="All">All ({searched.length})</option>
                    {chipDefs.filter(c => c.key !== 'All').map(c => (
                      <option key={c.key} value={c.key}>{c.label} ({c.count})</option>
                    ))}
                  </select>
                </label>
                <label className="mp-filter">
                  <span className="k">Show</span>
                  <select value={showFilter} onChange={(e) => setShowFilter(e.target.value)}>
                    <option value="all">Everything</option>
                    <option value="in">In stock</option>
                    {stage === 'items' && <option value="mine">Your suppliers</option>}
                  </select>
                </label>
                <label className="mp-filter">
                  <span className="k">Sort</span>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="name">Name A–Z</option>
                    <option value="price_asc">Price · low first</option>
                    <option value="price_desc">Price · high first</option>
                    <option value="updated_desc">Recently updated</option>
                  </select>
                </label>
                {filtersDirty && (
                  <button type="button" className="mp-clear" onClick={resetBrowse}>× Clear all</button>
                )}
                <span className="mp-count">{filtered.length} of {scopedProducts.length}</span>
              </div>

              {filtered.length === 0 ? (
                <div className="mp-empty">
                  {scopedProducts.length === 0
                    ? 'This supplier has no published items yet.'
                    : 'Nothing matches — try a different search or filter.'}
                </div>
              ) : (
                <div className="mp-grid">
                  {filtered.map(p => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      supplier={supplierById.get(p.supplier_id)}
                      mine={mySupplierIds.has(p.supplier_id)}
                      showSupplier={stage === 'items'}
                      basketQty={basketQtyOf(p.id)}
                      onSetQty={setProductQty}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* The Chart — map popover off the "serves my area" field */}
        <MapPopover
          open={mapOpen}
          onClose={() => setMapOpen(false)}
          suppliers={suppliers}
          portCoords={portCoords}
          theme={theme}
          queryValue={provLoc}
          onQueryChange={setProvLoc}
          queryPoint={queryPoint}
          onSetPoint={(pt) => { setQueryPoint(pt); setProvLoc(''); setDeckIndex(0); }}
          onEnterShop={enterShop}
        />

        {/* ── iii · The Counter (drawer) ── */}
        {!loading && (
          <button
            className={`mp-counter-fab ${basketUnits > 0 ? 'live' : ''}`}
            onClick={() => setCounterOpen(true)}
          >
            <ShoppingBasket size={17} strokeWidth={1.9} />
            <span className="lab">The Counter</span>
            {basketUnits > 0 && <span className="badge">{basketUnits}</span>}
          </button>
        )}

        {counterOpen && (
          <>
            <div className="mp-counter-backdrop" onClick={() => setCounterOpen(false)} />
            <aside className="mp-counter" role="dialog" aria-label="The Counter">
              <div className="mp-counter-head">
                <div>
                  <h3 className="mp-counter-h">The <em>Counter</em></h3>
                  <div className="mp-counter-sub">
                    {basket.length
                      ? `${basketUnits} item${basketUnits === 1 ? '' : 's'} · ${basketBySupplier.size} supplier${basketBySupplier.size === 1 ? '' : 's'}`
                      : 'Items land as draft lines — nothing is sent yet.'}
                  </div>
                </div>
                <button className="mp-counter-x" onClick={() => setCounterOpen(false)} aria-label="Close"><X size={18} /></button>
              </div>

              <div className="mp-counter-body">
                {basket.length === 0 ? (
                  <div className="mp-counter-empty">
                    <ShoppingBasket size={22} strokeWidth={1.4} style={{ marginBottom: 8 }} />
                    <div>Nothing added yet</div>
                    <div className="hint">Add items from any shop — they gather here, grouped by supplier.</div>
                  </div>
                ) : (
                  Array.from(basketBySupplier.entries()).map(([sid, lines]) => {
                    const sup = supplierById.get(sid);
                    const sub = lines.reduce((s, l) => s + (l.product.unit_price ?? 0) * l.qty, 0);
                    return (
                      <div className="mp-cgroup" key={sid}>
                        <div className="mp-cgroup-head">
                          <span className="nm">{sup?.name || 'Supplier'}</span>
                          <span className="amt">{money(sub, lines[0].product.currency)}</span>
                        </div>
                        {lines.map(l => (
                          <div className="mp-cline" key={l.product.id}>
                            <span className="mp-cname">{l.product.name}</span>
                            <span className="mp-cqty">
                              <button onClick={() => setLineQty(l.product.id, l.qty - 1)} aria-label="Fewer">−</button>
                              <span>{l.qty}</span>
                              <button onClick={() => setLineQty(l.product.id, l.qty + 1)} aria-label="More">+</button>
                            </span>
                            <span className="mp-cprice">{money((l.product.unit_price ?? 0) * l.qty, l.product.currency)}</span>
                            <button className="mp-cx" onClick={() => removeLine(l.product.id)} aria-label="Remove">×</button>
                          </div>
                        ))}
                      </div>
                    );
                  })
                )}
              </div>

              {basket.length > 0 && (
                <div className="mp-counter-foot">
                  <div className="mp-ctotal">
                    <small>Estimated total</small>
                    <span>{mixedCurrency ? 'Mixed currencies' : money(basketTotal, basketCurrency)}</span>
                  </div>
                  <div className="mp-board-label">Add to board</div>
                  <select className="mp-board-select" value={targetBoard} onChange={(e) => setTargetBoard(e.target.value)}>
                    {[...boards]
                      .sort((a, b) => (a.id === searchParams.get('board') ? -1 : b.id === searchParams.get('board') ? 1 : 0))
                      .map(b => (
                        <option key={b.id} value={b.id}>
                          {b.title}{BOARD_STATUS_LABEL[b.status] ? ` — ${BOARD_STATUS_LABEL[b.status]}` : ''}{b.id === searchParams.get('board') ? ' (this board)' : ''}
                        </option>
                      ))}
                    <option value={NEW_BOARD}>+ New board…</option>
                  </select>
                  {targetBoard === NEW_BOARD && (
                    <input
                      className="mp-board-input"
                      placeholder="Board name (e.g. Ibiza charter — week 29)"
                      value={newBoardName}
                      onChange={(e) => setNewBoardName(e.target.value)}
                    />
                  )}
                  <button className="mp-checkout" disabled={placing || !targetBoard} onClick={placeBasket}>
                    {placing ? 'Adding…' : `Add ${basketUnits} to board`}
                  </button>
                  <div className="mp-counter-note">
                    Each supplier above becomes its own order. Lines arrive as drafts at the catalogue price —
                    approval and “Send to supplier” stay on the board.
                  </div>
                </div>
              )}
            </aside>
          </>
        )}
      </div>
    </>
  );
};

export default Marketplace;

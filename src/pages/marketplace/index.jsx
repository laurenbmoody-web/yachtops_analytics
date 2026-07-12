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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft, ClipboardList, Search, X, ChevronRight, MapPin,
  SlidersHorizontal, ChevronDown, ArrowUpDown, Check, Zap,
} from 'lucide-react';
import Header from '../../components/navigation/Header';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useBasket } from '../../contexts/BasketContext';
import { showToast } from '../../utils/toast';
import {
  fetchMarketplaceSuppliers,
  fetchMarketplaceSupplierStats,
  fetchMarketplaceProducts,
  fetchTenantSupplierIds,
  fetchPortLocations,
  fetchDirectorySuppliers,
  fetchSupplierMemory,
  fetchSupplierRatings,
  ensureTenantSupplierLinks,
  addBasketToBoard,
} from '../provisioning/utils/marketplaceStorage';
import ReviewsModal from '../../components/reviews/ReviewsModal';
import MapPopover from './MapPopover';
import { supplierReaches } from './geo';
import {
  fetchProvisioningLists,
  createProvisioningList,
  fetchSupplierVerifiedCerts,
} from '../provisioning/utils/provisioningStorage';
import './marketplace.css';
import '../../styles/editorial.css'; // shared meta strip + greeting — one source of truth
import '../../styles/editorial-tokens.css'; // --d- design tokens — filter controls match the provisioning toolbar exactly

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

// Compress delivery weekdays into readable ranges: Mon,Tue,Wed,Fri → "Mon–Wed, Fri".
const WEEK_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmtDeliveryDays = (days) => {
  if (!days || !days.length) return '';
  const idx = days.map(d => WEEK_ORDER.indexOf(d)).filter(i => i >= 0).sort((a, b) => a - b);
  if (!idx.length) return '';
  if (idx.length === 7) return 'Every day';
  const runs = []; let start = idx[0], prev = idx[0];
  for (let i = 1; i < idx.length; i++) {
    if (idx[i] === prev + 1) prev = idx[i];
    else { runs.push([start, prev]); start = idx[i]; prev = idx[i]; }
  }
  runs.push([start, prev]);
  return runs.map(([a, b]) => (a === b ? WEEK_ORDER[a] : `${WEEK_ORDER[a]}–${WEEK_ORDER[b]}`)).join(', ');
};

// Compact money for KPI tiles — €938, $1,240, 900 AED.
const CUR_SYM = { EUR: '€', USD: '$', GBP: '£' };
const fmtMoney = (n, ccy = 'EUR') => {
  const v = Math.round(Number(n) || 0).toLocaleString('en-GB');
  const s = CUR_SYM[ccy];
  return s ? `${s}${v}` : `${v} ${ccy}`;
};

const initialsOf = (name) => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '•';
  return parts.slice(0, 2).map(w => w[0]).join('').toUpperCase();
};

// Five stars, filled to the value on the half (4.5 → four-and-a-half).
// With onPick, each star has two hit zones — left = ½, right = whole — so
// crew can give half-stars; hovering previews the value.
const StarRow = ({ value = 0, size = 12, onPick }) => {
  const [hover, setHover] = useState(null);
  const shown = hover != null ? hover : (value || 0);
  return (
    <span
      className={`mp-stars ${onPick ? 'pick' : ''}`}
      style={{ fontSize: size }}
      onMouseLeave={() => onPick && setHover(null)}
    >
      {[1, 2, 3, 4, 5].map(i => {
        const fill = shown >= i ? 100 : (shown >= i - 0.5 ? 50 : 0);
        return (
          <span key={i} className="mp-star">
            <span className="mp-star-base">★</span>
            <span className="mp-star-fill" style={{ width: `${fill}%` }}>★</span>
            {onPick && (
              <>
                <button type="button" className="mp-star-hit l"
                  onMouseEnter={() => setHover(i - 0.5)}
                  onClick={(e) => { e.stopPropagation(); onPick(i - 0.5); }}
                  aria-label={`${i - 0.5} stars`} />
                <button type="button" className="mp-star-hit r"
                  onMouseEnter={() => setHover(i)}
                  onClick={(e) => { e.stopPropagation(); onPick(i); }}
                  aria-label={`${i} star${i === 1 ? '' : 's'}`} />
              </>
            )}
          </span>
        );
      })}
    </span>
  );
};

const minQtyOf = (product) => Math.max(1, Number(product.min_order_qty) || 1);

// The toolbar's "Filters" chip — folds Category / Show (and Port, in the
// all-items view) into one popover so the bar stays clean. A badge shows
// how many filters are active.
const FiltersMenu = ({
  category, setCategory, showFilter, setShowFilter, port, setPort,
  ports, chipDefs, searchedLen, showPort, showMine,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const active = (category !== 'All' ? 1 : 0)
    + (showFilter !== 'all' ? 1 : 0)
    + (showPort && port !== 'All' ? 1 : 0);

  return (
    <div className="mp-filters" ref={ref}>
      <button type="button" className={`mp-filters-btn ${open ? 'open' : ''} ${active ? 'on' : ''}`} onClick={() => setOpen(o => !o)}>
        <SlidersHorizontal size={14} />
        <span>Filters</span>
        {active > 0 && <span className="mp-filters-badge">{active}</span>}
        <ChevronDown size={14} className="chev" />
      </button>
      {open && (
        <div className="mp-filters-pop">
          <div className="mp-fp-group">
            <span className="mp-fp-label">Category</span>
            <div className="mp-fp-select">
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="All">All categories ({searchedLen})</option>
                {chipDefs.filter(c => c.key !== 'All').map(c => (
                  <option key={c.key} value={c.key}>{c.label} ({c.count})</option>
                ))}
              </select>
            </div>
          </div>
          {showPort && (
            <div className="mp-fp-group">
              <span className="mp-fp-label">Port</span>
              <div className="mp-fp-select">
                <select value={port} onChange={(e) => setPort(e.target.value)}>
                  <option value="All">All ports</option>
                  {ports.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          )}
          <div className="mp-fp-group">
            <span className="mp-fp-label">Show</span>
            <div className="mp-fp-select">
              <select value={showFilter} onChange={(e) => setShowFilter(e.target.value)}>
                <option value="all">Everything</option>
                <option value="in">In stock</option>
                {showMine && <option value="mine">Your suppliers</option>}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SORT_OPTIONS = [
  { key: 'name', label: 'Name A–Z' },
  { key: 'price_asc', label: 'Price · low first' },
  { key: 'price_desc', label: 'Price · high first' },
  { key: 'updated_desc', label: 'Recently updated' },
];

// Sort as a menu: the chip just reads "Sort"; the current choice shows as
// a tick inside the dropdown, so the bar stays short.
const SortMenu = ({ sortBy, setSortBy }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="mp-sortmenu" ref={ref}>
      <button type="button" className={`mp-filters-btn ${open ? 'open' : ''} ${sortBy !== 'name' ? 'on' : ''}`} onClick={() => setOpen(o => !o)}>
        <ArrowUpDown size={14} />
        <span>Sort</span>
        <ChevronDown size={14} className="chev" />
      </button>
      {open && (
        <div className="mp-filters-pop mp-sort-pop">
          {SORT_OPTIONS.map(o => (
            <button
              key={o.key}
              type="button"
              className={`mp-sort-opt ${sortBy === o.key ? 'sel' : ''}`}
              onClick={() => { setSortBy(o.key); setOpen(false); }}
            >
              <span>{o.label}</span>
              {sortBy === o.key && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
        : <div className="mp-img-ph" style={{ '--cathue': categoryHue(product.category) }}>
            {product.category && <span className="cat">{product.category}</span>}
            <span className="gl">{initialsOf(product.name)}</span>
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

  // The Dark Market follows the app-wide day/night theme (the nav bar's
  // toggle) — no separate control on the page.
  const { theme: appTheme } = useTheme();
  const theme = appTheme === 'night' ? 'dark' : 'light';

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
  const [memory, setMemory] = useState(() => new Map());
  const [ratings, setRatings] = useState(() => new Map());
  const [directorySuppliers, setDirectorySuppliers] = useState([]);
  const [provCat, setProvCat] = useState('All');
  const [provSort, setProvSort] = useState('name');
  const [shopVerifiedCerts, setShopVerifiedCerts] = useState(() => new Set()); // verified cert names for the entered shop

  // Load which of the entered shop's certifications Cargo has verified (for the tick).
  useEffect(() => {
    if (!enteredId) { setShopVerifiedCerts(new Set()); return; }
    let live = true;
    fetchSupplierVerifiedCerts(enteredId).then(s => { if (live) setShopVerifiedCerts(s); });
    return () => { live = false; };
  }, [enteredId]);

  const { basket, setBasket } = useBasket(); // app-wide [{ product, qty }], persisted
  const [counterOpen, setCounterOpen] = useState(false);
  const [reviewsFor, setReviewsFor] = useState(null); // supplier whose reviews modal is open
  const [targetBoard, setTargetBoard] = useState(searchParams.get('board') || '');
  const [newBoardName, setNewBoardName] = useState('');
  const [placing, setPlacing] = useState(false);

  // Opened from the nav-bar basket indicator (?counter=1).
  useEffect(() => {
    if (searchParams.get('counter') === '1') setCounterOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [sups, st, ports, rat] = await Promise.all([
          fetchMarketplaceSuppliers(),
          fetchMarketplaceSupplierStats(),
          fetchPortLocations(),
          fetchSupplierRatings(),
        ]);
        if (!live) return;
        setSuppliers(sups);
        setStats(st);
        setPortCoords(ports);
        setRatings(rat);
        const [prods, mine, lists, directory, mem] = await Promise.all([
          fetchMarketplaceProducts(sups.map(s => s.id)),
          fetchTenantSupplierIds(activeTenantId),
          activeTenantId ? fetchProvisioningLists(activeTenantId).catch(() => []) : [],
          fetchDirectorySuppliers(activeTenantId),
          fetchSupplierMemory(),
        ]);
        if (!live) return;
        setProducts(prods);
        setMySupplierIds(mine);
        setDirectorySuppliers(directory);
        setMemory(mem);
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

  // Directory vendors the tenant saved that aren't live on Cargo yet —
  // the map shows them as faint "invite" pins (the growth loop).
  const inviteSuppliers = useMemo(() => {
    const onCargo = new Set(suppliers.map(s => s.id));
    return directorySuppliers.filter(d => d.name && !onCargo.has(d.id));
  }, [directorySuppliers, suppliers]);
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

  // Stars are the trigger, not the control: clicking them opens the
  // reviews modal, where the average + written reviews live and the user
  // sets/edits their own rating (with an optional note).
  const openReviews = (supplier) => { if (supplier) setReviewsFor(supplier); };
  const refreshRatings = async () => { setRatings(await fetchSupplierRatings()); };
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

  // Compact storefront-header facts (real data only).
  const shopLocation = enteredSupplier
    ? [enteredSupplier.business_city, enteredSupplier.business_country].filter(Boolean).join(', ')
    : '';
  const shopPorts = enteredSupplier ? (enteredSupplier.coverage_ports || []).slice(0, 4) : [];
  const shopCats = enteredSupplier ? (enteredSupplier.categories || []) : [];
  const shopCount = enteredSupplier ? (enteredSupplier.catalogue_count ?? scopedProducts.length) : 0;
  const shopWebsite = enteredSupplier?.website
    ? (/^https?:\/\//i.test(enteredSupplier.website) ? enteredSupplier.website : `https://${enteredSupplier.website}`)
    : null;
  // Operational storefront terms (typical, not hard limits).
  const shopLead = enteredSupplier?.lead_time_days;
  const shopCutoff = (enteredSupplier?.order_cutoff || '').slice(0, 5);
  const shopMin = enteredSupplier?.min_order_value;
  const shopMinCur = enteredSupplier?.min_order_currency || 'EUR';
  const shopCerts = enteredSupplier?.certifications || [];
  const shopExpress = !!enteredSupplier?.express_available;
  const shopDays = fmtDeliveryDays(enteredSupplier?.delivery_days);
  const shopCutoffStrict = !!enteredSupplier?.cutoff_strict;
  const hasTerms = shopLead != null || shopCutoff || shopMin != null || shopExpress || shopDays || shopCerts.length > 0;

  return (
    <>
      <Header />
      <div className="mp-page" data-theme={theme}>
        <div className="mp-shell">
          {/* Meta bar — the one place an eyebrow-like row is allowed. */}
          <div className="mp-metabar">
            <button className="mp-back" onClick={() => (stage === 'providers' ? navigate('/provisioning') : leaveShop())}>
              <ChevronLeft size={16} /> {stage === 'providers' ? 'Back to Provisioning' : 'Back to suppliers'}
            </button>
          </div>

          {error && <div className="mp-error">{error}</div>}
          {loading && <div className="mp-loading">Loading the marketplace…</div>}

          {/* ── i · The Providers ── */}
          {!loading && stage === 'providers' && (() => {
            const idx = wallSuppliers.length ? Math.min(Math.max(deckIndex, 0), wallSuppliers.length - 1) : 0;
            const focused = wallSuppliers[idx] || null;
            const fmeta = focused ? (supplierMeta.get(focused.id) || {}) : {};
            const fmem = focused ? (memory.get(focused.id) || null) : null;
            const frating = focused ? (ratings.get(focused.id) || null) : null;
            const fstats = focused ? (stats.get(focused.id) || null) : null;
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

            // Location line on the card: home port · region.
            const regionOf = (n) => portCoords.get(String(n).toLowerCase())?.region;
            const fregion = fports.map(regionOf).find(Boolean);
            const locationLabel = [fports[0], fregion].filter(Boolean).join(' · ')
              || focused?.business_country || 'Coverage on request';

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
                    <Search size={16} className="ic" />
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
                        <option value="All">All categories</option>
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
                  {!loading && (
                    <button
                      type="button"
                      className={`mp-counter-btn mp-counter-btn-end ${basketUnits > 0 ? 'live' : ''}`}
                      onClick={() => setCounterOpen(true)}
                      title="The Counter"
                      aria-label="The Counter"
                    >
                      <ClipboardList size={17} strokeWidth={1.8} />
                      {basketUnits > 0 && <span className="badge">{basketUnits}</span>}
                    </button>
                  )}
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
                      <button className="mp-supcard center mp-flipcard" onClick={() => enterShop(focused)}>
                        <div className="mp-flip-inner">
                          <div className="mp-face mp-sf">
                            <div className="mp-sf-top">
                              <span className="mp-sf-logo">
                                {focused.logo_url
                                  ? <img src={focused.logo_url} alt="" />
                                  : initialsOf(focused.name)}
                              </span>
                              <div className="mp-sf-id">
                                <div className="mp-sf-nm">{focused.name}</div>
                                <div className="mp-sf-loc">{locationLabel}</div>
                                <div
                                  className="mp-sf-trust"
                                  role="button"
                                  tabIndex={0}
                                  title="See reviews"
                                  onClick={(e) => { e.stopPropagation(); openReviews(focused); }}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); openReviews(focused); } }}
                                >
                                  {frating?.avg
                                    ? <><StarRow value={frating.avg} /> <b>{frating.avg.toFixed(1)}</b> · {frating.count} review{frating.count === 1 ? '' : 's'}</>
                                    : <span className="mp-sf-unrated">No reviews yet</span>}
                                  {fstats?.onTimePct != null && <> <span className="mp-sf-sep">·</span> {fstats.onTimePct}% on-time</>}
                                </div>
                                <div className="mp-sf-tags">
                                  {(fmeta.topCats || []).slice(0, 3).map(c => <span key={c}>{c}</span>)}
                                  {(fmeta.topCats?.length || 0) > 3 && <span className="more">+{fmeta.topCats.length - 3}</span>}
                                </div>
                              </div>
                            </div>
                            {(focused.contact_name || focused.contact_phone || focused.contact_email) && (
                              <>
                                <div className="mp-sf-div" />
                                <div className="mp-sf-contact">
                                  <span className="mp-sf-av">{initialsOf(focused.contact_name)}</span>
                                  <span className="mp-sf-who">
                                    <span className="n">{focused.contact_name || 'Orders desk'}</span>
                                    {focused.contact_role && <span className="r">{focused.contact_role}</span>}
                                  </span>
                                  <span className="mp-sf-lines">
                                    {focused.contact_phone && <span>{focused.contact_phone}</span>}
                                    {focused.contact_email && <span>{focused.contact_email}</span>}
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                          <div className="mp-face mp-back mp-sfback">
                            {fmem && fmem.orders > 0 ? (
                              <div className="mp-sfb-led">
                                <div className="r"><span className="l">Orders placed</span><span className="v">{fmem.orders}</span></div>
                                <div className="r"><span className="l">Total spent</span><span className="v">{fmtMoney(fmem.spend, fmem.currency)}</span></div>
                                <div className="r"><span className="l">Last order</span><span className="v v-date">{fmem.lastOrderAt ? fmtDate(fmem.lastOrderAt) : '—'}</span></div>
                              </div>
                            ) : (
                              <div className="mp-sfb-empty">No orders with them yet — be their first.</div>
                            )}
                          </div>
                        </div>
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
                    <div className="mp-browse-row">
                      <button className="mp-allitems" onClick={openAllItems}>
                        Browse All <ChevronRight size={14} />
                      </button>
                    </div>
                  </>
                )}
              </>
            );
          })()}

          {/* ── ii · The Aisles / all-items ── */}
          {!loading && stage !== 'providers' && (
            <>
              {stage === 'aisles' ? (
                <header className="mp-shophead">
                  <div className="mp-shophead-row">
                    {enteredSupplier.logo_url
                      ? <img className="mp-shophead-logo" src={enteredSupplier.logo_url} alt="" />
                      : <span className="mp-shophead-logo ph">{initialsOf(enteredSupplier.name)}</span>}
                    <div className="mp-shophead-id">
                      <div className="mp-shophead-top">
                        <span className="mp-shophead-name">{enteredSupplier.name}</span>
                        {mySupplierIds.has(enteredSupplier.id) && <span className="mp-shophead-pill">Your supplier</span>}
                        {(() => {
                          const r = ratings.get(enteredSupplier.id);
                          return (
                            <button type="button" className="mp-shophead-rate" onClick={() => openReviews(enteredSupplier)} title="See reviews">
                              <StarRow value={r?.avg || 0} size={13} />
                              <span className="rt">
                                {r?.avg
                                  ? <>{r.avg.toFixed(1)} · {r.count} review{r.count === 1 ? '' : 's'}</>
                                  : 'No reviews yet'}
                                {enteredStats?.onTimePct != null && <> · {enteredStats.onTimePct}% on-time</>}
                              </span>
                            </button>
                          );
                        })()}
                      </div>
                      <div className="mp-shophead-facts">
                        {shopLocation && <span className="f"><MapPin size={12} /> {shopLocation}</span>}
                        {shopPorts.length > 0 && <><span className="sep">·</span><span className="f">Serves <b>{shopPorts.join(' · ')}</b></span></>}
                        {shopCount > 0 && <><span className="sep">·</span><span className="f"><b>{shopCount}</b> products</span></>}
                        {shopCats.length > 0 && <><span className="sep">·</span><span className="f">{shopCats.slice(0, 3).join(' · ')}{shopCats.length > 3 && <span className="more"> +{shopCats.length - 3}</span>}</span></>}
                      </div>
                      {hasTerms && (
                        <div className="mp-shophead-terms">
                          {shopDays && <span className="term">delivers <b>{shopDays}</b></span>}
                          {shopLead != null && <span className="term"><b>≈{shopLead}d</b> lead time</span>}
                          {shopCutoff && <span className="term">order by <b>{shopCutoff}</b> {shopCutoffStrict ? '(firm)' : '(flexible)'}</span>}
                          {shopMin != null && <span className="term"><b>{money(shopMin, shopMinCur)}</b> min</span>}
                          {shopExpress && <span className="term rush"><Zap size={12} strokeWidth={2} /> Rush available</span>}
                          {shopCerts.map(c => (
                            <span className={`cert${shopVerifiedCerts.has(c) ? ' verified' : ''}`} key={c}>
                              {c}{shopVerifiedCerts.has(c) && <Check size={11} strokeWidth={3} />}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mp-shophead-actions">
                      {shopWebsite && <a className="mp-shophead-web" href={shopWebsite} target="_blank" rel="noreferrer">Website ↗</a>}
                      {enteredSupplier.contact_email && <a className="mp-shophead-msg" href={`mailto:${enteredSupplier.contact_email}`}>Message supplier</a>}
                      <button
                        type="button"
                        className={`mp-counter-btn ${basketUnits > 0 ? 'live' : ''}`}
                        onClick={() => setCounterOpen(true)}
                        title="The Counter"
                        aria-label="The Counter"
                      >
                        <ClipboardList size={17} strokeWidth={1.8} />
                        {basketUnits > 0 && <span className="badge">{basketUnits}</span>}
                      </button>
                    </div>
                  </div>
                </header>
              ) : (
                <div className="mp-itemshead">
                  <h1 className="mp-title sm">All <em>items</em></h1>
                  <p className="mp-sub">Every shop's live stock in one list — filter by port or category, add straight to the board.</p>
                </div>
              )}

              <div className="mp-controls">
                <label className="mp-searchwrap grow">
                  <Search size={16} className="ic" />
                  <input
                    className="mp-search bare"
                    placeholder={stage === 'aisles' ? `Search ${enteredSupplier.name}…` : 'Search products, brands, barcodes…'}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <FiltersMenu
                  category={category} setCategory={setCategory}
                  showFilter={showFilter} setShowFilter={setShowFilter}
                  port={port} setPort={setPort} ports={ports}
                  chipDefs={chipDefs} searchedLen={searched.length}
                  showPort={stage === 'items'} showMine={stage === 'items'}
                />
                <SortMenu sortBy={sortBy} setSortBy={setSortBy} />
                {filtersDirty && (
                  <button type="button" className="mp-clear" onClick={resetBrowse}>× Clear all</button>
                )}
                {stage === 'items' && (
                  <button
                    type="button"
                    className={`mp-counter-btn mp-counter-btn-end ${basketUnits > 0 ? 'live' : ''}`}
                    onClick={() => setCounterOpen(true)}
                    title="The Counter"
                    aria-label="The Counter"
                  >
                    <ClipboardList size={17} strokeWidth={1.8} />
                    {basketUnits > 0 && <span className="badge">{basketUnits}</span>}
                  </button>
                )}
              </div>

              <div className="mp-count-row">
                <span className="mp-count">{filtered.length} of {scopedProducts.length} items</span>
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
          inviteSuppliers={inviteSuppliers}
          onInvite={(s) => showToast(`Supplier invites are coming soon — we’ll help you bring ${s.name} onto Cargo.`, 'info')}
        />

        {/* Reviews modal — clicking any supplier's stars opens this. */}
        {reviewsFor && (
          <ReviewsModal
            supplier={reviewsFor}
            rating={ratings.get(reviewsFor.id)}
            onClose={() => setReviewsFor(null)}
            onRated={refreshRatings}
          />
        )}

        {/* ── iii · The Counter (drawer) — trigger lives inline in the
             toolbars (next to Browse all items / the in-shop filters) ── */}
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

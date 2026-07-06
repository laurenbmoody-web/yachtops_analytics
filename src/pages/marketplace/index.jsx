// Cargo Marketplace — Phase 2.
//
// Vessel-side storefront over every Cargo supplier's published
// catalogue. Browsing never creates an order: the basket lands on a
// provisioning board as ordinary draft lines (pre-priced, supplier
// assigned, catalogue-linked), and the board stays the single point of
// control — approval routing and "Send to supplier" behave exactly as
// they do for hand-typed lines. Catalogue-priced lines then confirm in
// one click on the supplier side (auto-accept trigger).

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ShoppingBasket } from 'lucide-react';
import Header from '../../components/navigation/Header';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { showToast } from '../../utils/toast';
import {
  fetchMarketplaceSuppliers,
  fetchMarketplaceProducts,
  fetchTenantSupplierIds,
  ensureTenantSupplierLinks,
  addBasketToBoard,
} from '../provisioning/utils/marketplaceStorage';
import {
  fetchProvisioningLists,
  createProvisioningList,
} from '../provisioning/utils/provisioningStorage';
import './marketplace.css';

import { categoryHue, orderCategories } from '../../utils/catalogueConstants';

// Boards that can still take new lines.
const OPEN_BOARD_STATUSES = new Set(['draft', 'pending_approval', 'sent_to_supplier', 'quote_received']);
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

const minQtyOf = (product) => Math.max(1, Number(product.min_order_qty) || 1);

// The card's control IS the basket line: − qty + wired straight through.
// First + jumps to the product's minimum order; − below it removes the
// line. No transient "Added" state, no layout shift.
const ProductCard = ({ product, supplier, mine, basketQty, onSetQty }) => {
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
      <div className="mp-psup">
        {supplier?.name || 'Supplier'}
        {supplier?.verified && <span className="tick"> ✓</span>}
        {mine && <span className="mp-suptag">Your supplier</span>}
      </div>
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
            ? <>{basketQty}<small> in basket</small></>
            : (out ? 'Unavailable' : 'Add to basket')}
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
  const [products, setProducts] = useState([]);
  const [mySupplierIds, setMySupplierIds] = useState(() => new Set());
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [supplierFilter, setSupplierFilter] = useState('All');
  const [port, setPort] = useState('All');

  const [basket, setBasket] = useState([]); // [{ product, qty }]
  const [targetBoard, setTargetBoard] = useState(searchParams.get('board') || '');
  const [newBoardName, setNewBoardName] = useState('');
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const sups = await fetchMarketplaceSuppliers();
        if (!live) return;
        setSuppliers(sups);
        const [prods, mine, lists] = await Promise.all([
          fetchMarketplaceProducts(sups.map(s => s.id)),
          fetchTenantSupplierIds(activeTenantId),
          activeTenantId ? fetchProvisioningLists(activeTenantId).catch(() => []) : [],
        ]);
        if (!live) return;
        setProducts(prods);
        setMySupplierIds(mine);
        const open = (lists || []).filter(l => OPEN_BOARD_STATUSES.has(l.status));
        setBoards(open);
        // Preselect: ?board= param if it's open, else first open board, else new.
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

  const ports = useMemo(() => {
    const set = new Set();
    suppliers.forEach(s => (s.coverage_ports || []).forEach(p => set.add(p)));
    return Array.from(set).sort();
  }, [suppliers]);

  const visibleSupplierIds = useMemo(() => {
    let list = suppliers;
    if (port !== 'All') list = list.filter(s => (s.coverage_ports || []).includes(port));
    if (supplierFilter !== 'All') list = list.filter(s => s.id === supplierFilter);
    return new Set(list.map(s => s.id));
  }, [suppliers, port, supplierFilter]);

  const q = search.trim().toLowerCase();
  const searched = useMemo(() => products.filter(p =>
    visibleSupplierIds.has(p.supplier_id)
    && (!q
      || p.name.toLowerCase().includes(q)
      || (p.description ?? '').toLowerCase().includes(q)
      || (p.sku ?? '').toLowerCase().includes(q)
      || (p.barcode ?? '').includes(q))
  ), [products, visibleSupplierIds, q]);

  const catCounts = useMemo(() => {
    const c = {};
    searched.forEach(p => { c[p.category || 'Other'] = (c[p.category || 'Other'] || 0) + 1; });
    return c;
  }, [searched]);

  const filtered = useMemo(() => {
    const rows = category === 'All' ? searched : searched.filter(p => (p.category || 'Other') === category);
    // When searching across suppliers, cheapest first — the price-comparison view.
    if (q) return [...rows].sort((a, b) => (a.unit_price ?? Infinity) - (b.unit_price ?? Infinity));
    return rows;
  }, [searched, category, q]);

  // ── basket ──
  // One writer for card steppers and basket rows alike: qty 0 (or below
  // the product's minimum order) removes the line, otherwise upsert.
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

  const chipDefs = [
    { key: 'All', label: 'All', count: searched.length },
    ...orderCategories(Object.keys(catCounts)).map(c => ({ key: c, label: c, count: catCounts[c] })),
  ];

  return (
    <>
      <Header />
      <div className="mp-page">
        <div className="mp-shell">
          <button className="mp-back" onClick={() => navigate('/provisioning')}>
            <ArrowLeft size={13} /> Back to provisioning
          </button>

          <div className="mp-headrow">
            <div>
              <div className="mp-eyebrow">Provisioning · Marketplace</div>
              <h1 className="mp-title">The <em>marketplace</em></h1>
              <p className="mp-sub">
                Browse every Cargo supplier's live catalogue. Items land on your board as draft lines at the
                supplier's own price — no quote round needed.
              </p>
            </div>
          </div>

          {error && <div className="mp-error">{error}</div>}
          {loading && <div className="mp-loading">Loading the marketplace…</div>}

          {!loading && (
            <>
              <div className="mp-controls">
                <input
                  className="mp-search"
                  placeholder="Search products, brands, barcodes…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select className="mp-select" value={port} onChange={(e) => setPort(e.target.value)}>
                  <option value="All">All ports</option>
                  {ports.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div className="mp-chips">
                {chipDefs.map(c => (
                  <button
                    key={c.key}
                    className={`mp-chip ${category === c.key ? 'on' : ''}`}
                    onClick={() => setCategory(category === c.key ? 'All' : c.key)}
                  >
                    {c.label} <span className="ct">{c.count}</span>
                  </button>
                ))}
              </div>

              <div className="mp-suppliers">
                <button
                  className={`mp-supcard ${supplierFilter === 'All' ? 'on' : ''}`}
                  onClick={() => setSupplierFilter('All')}
                >
                  <span className="mp-suplogo">∗</span>
                  <span>
                    <span className="mp-supname">All suppliers</span>
                    <div className="mp-supmeta">{suppliers.length} on Cargo</div>
                  </span>
                </button>
                {suppliers.map(s => (
                  <button
                    key={s.id}
                    className={`mp-supcard ${supplierFilter === s.id ? 'on' : ''}`}
                    onClick={() => setSupplierFilter(supplierFilter === s.id ? 'All' : s.id)}
                  >
                    {s.logo_url
                      ? <img className="mp-suplogo" src={s.logo_url} alt="" />
                      : <span className="mp-suplogo">{(s.name || '?').charAt(0).toUpperCase()}</span>}
                    <span>
                      <span className="mp-supname">
                        {s.name}
                        {s.verified && <span className="tick">✓</span>}
                        {mySupplierIds.has(s.id) && <span className="mp-suptag">Yours</span>}
                      </span>
                      <div className="mp-supmeta">
                        {s.catalogue_count} products{(s.coverage_ports || []).length ? ` · ${s.coverage_ports.slice(0, 3).join(', ')}` : ''}
                      </div>
                    </span>
                  </button>
                ))}
              </div>

              <div className="mp-cols">
                <div>
                  {filtered.length === 0 ? (
                    <div className="mp-empty">
                      {products.length === 0
                        ? 'No suppliers have published catalogues yet.'
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
                          basketQty={basketQtyOf(p.id)}
                          onSetQty={setProductQty}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <aside className="mp-basket">
                  <h3 className="mp-basket-h">Basket</h3>
                  <div className="mp-basket-sub">
                    {basket.length
                      ? `${basket.reduce((s, l) => s + l.qty, 0)} item${basket.length === 1 && basket[0].qty === 1 ? '' : 's'} · ${basketBySupplier.size} supplier${basketBySupplier.size === 1 ? '' : 's'}`
                      : 'Lines land on a board as drafts — nothing is sent yet.'}
                  </div>

                  {basket.length === 0 && (
                    <div className="mp-basket-empty">
                      <ShoppingBasket size={20} strokeWidth={1.5} style={{ marginBottom: 6 }} />
                      <div>Your basket is empty</div>
                    </div>
                  )}

                  {Array.from(basketBySupplier.entries()).map(([sid, lines]) => {
                    const sup = supplierById.get(sid);
                    const sub = lines.reduce((s, l) => s + (l.product.unit_price ?? 0) * l.qty, 0);
                    return (
                      <div key={sid}>
                        <div className="mp-bsup">
                          <span>{sup?.name || 'Supplier'}</span>
                          <span className="amt">{money(sub, lines[0].product.currency)}</span>
                        </div>
                        {lines.map(l => (
                          <div className="mp-bline" key={l.product.id}>
                            <span className="mp-bname">{l.product.name}</span>
                            <span className="mp-bqty">
                              <button onClick={() => setLineQty(l.product.id, l.qty - 1)}>−</button>
                              <span>{l.qty}</span>
                              <button onClick={() => setLineQty(l.product.id, l.qty + 1)}>+</button>
                            </span>
                            <span className="mp-bprice">{money((l.product.unit_price ?? 0) * l.qty, l.product.currency)}</span>
                            <button className="mp-bx" onClick={() => removeLine(l.product.id)} aria-label="Remove">×</button>
                          </div>
                        ))}
                      </div>
                    );
                  })}

                  {basket.length > 0 && (
                    <>
                      <div className="mp-btotal">
                        <small>Estimated total</small>
                        <span>{mixedCurrency ? 'Mixed currencies' : money(basketTotal, basketCurrency)}</span>
                      </div>

                      <div className="mp-board-label">Add to board</div>
                      <select
                        className="mp-board-select"
                        value={targetBoard}
                        onChange={(e) => setTargetBoard(e.target.value)}
                      >
                        {boards.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
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
                        {placing ? 'Adding…' : `Add ${basket.reduce((s, l) => s + l.qty, 0)} to board`}
                      </button>
                      <div className="mp-basket-note">
                        Lines arrive as drafts with the catalogue price as the estimate. Approval and
                        “Send to supplier” stay on the board, exactly as today.
                      </div>
                    </>
                  )}
                </aside>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default Marketplace;

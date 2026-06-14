import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../../lib/supabaseClient';
import {
  fetchPastOrders,
  fetchQuickAddFavourites,
  fetchMasterOrderHistory,
  upsertItems,
} from '../utils/provisioningStorage';
import { DATA as CATALOGUE_DATA, GROUP_DEPARTMENT as CATALOGUE_GROUP_DEPT } from '../../../data/catalogue';
import { getSmartSuggestions, SOURCE_META } from '../../../utils/provisioningSuggestions';
import { showToast } from '../../../utils/toast';

// ── AddItemsModal — in-board "bulk import from another source" picker ─────
//
// Full-screen takeover triggered from the board toolbar's single "+ Add items"
// button. Replaces the prior pair of separate panels (Smart Suggestions
// inline panel + Quick Add side modal) since both surfaced the same
// underlying intent: "give me items to put on this board from some other
// source". Per-lane quick-add input on each kanban column stays as the
// fast path for "add one item by hand"; this modal is the bulk flow.
//
// Sources (left sidebar nav):
//   • Suggestions  — getSmartSuggestions (collapsible groups)
//   • Past orders  — fetchPastOrders + fetchQuickAddFavourites
//   • Catalogue    — DATA from src/data/catalogue.js
//   • Frequent     — fetchMasterOrderHistory (dept-scoped)
//
// Apply path: upsertItems to the current list_id, source-tagged with the
// active source key. Picked Past-order rows expand to their constituent
// supplier_order_items on apply (read-only fetch). Catalogue + Frequent
// use qty steppers; Suggestions + Past orders use checkbox multi-select.
//
// Duplicate detection: every render diffs picked items against the board's
// current item names; matches get a muted ✓ "Already on board" pill so the
// user doesn't accidentally re-add.

const SOURCES = [
  { key: 'suggestions',  label: 'Suggestions' },
  { key: 'past_orders',  label: 'Past orders' },
  { key: 'catalogue',    label: 'Catalogue' },
  { key: 'frequent',     label: 'Frequent' },
];

const SUGGESTION_SOURCE_ORDER = [
  'occasions', 'expiring_soon', 'guest_preference', 'low_stock',
  'master_history', 'invoice_pattern', 'location_aware',
];

const formatGroupLabel = (s) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

export default function AddItemsModal({
  isOpen,
  onClose,
  boardId,
  tenantId,
  tripId,
  currentItems = [],
  currentDepartment = null,
  isCommand = false,
  onItemsAdded,
}) {
  const [activeSource, setActiveSource] = useState('suggestions');

  // Data
  const [suggestions, setSuggestions] = useState(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [pastOrders, setPastOrders] = useState([]);
  const [favouriteOrderIds, setFavouriteOrderIds] = useState(new Set());
  const [frequent, setFrequent] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  // Per-source UI state
  const [search, setSearch] = useState('');
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [deptOnly, setDeptOnly] = useState(true);
  const [catalogueGroup, setCatalogueGroup] = useState('all');
  const [expandedSuggestionSources, setExpandedSuggestionSources] = useState(new Set());
  const [expandedCatalogueCategories, setExpandedCatalogueCategories] = useState(new Set());

  // Selections
  const [pickedSuggestionIds, setPickedSuggestionIds] = useState(new Set());
  const [pickedOrderId, setPickedOrderId] = useState(null);
  const [catalogueQtys, setCatalogueQtys] = useState(new Map());
  const [frequentQtys, setFrequentQtys] = useState(new Map());

  // ── Load past orders + frequent on open (lightweight; suggestions is lazy) ──
  useEffect(() => {
    if (!isOpen || !tenantId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [past, favs, hist] = await Promise.all([
          fetchPastOrders(tenantId).catch(() => []),
          fetchQuickAddFavourites(tenantId).catch(() => []),
          fetchMasterOrderHistory(tenantId, {
            userDeptName: currentDepartment,
            isCommand,
          }).catch(() => []),
        ]);
        if (cancelled) return;
        setPastOrders(past || []);
        setFavouriteOrderIds(new Set((favs || []).map(f => f.id)));
        setFrequent(hist || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, tenantId, currentDepartment, isCommand]);

  // ── Lazy-load suggestions when tab activated ──
  useEffect(() => {
    if (!isOpen) return;
    if (activeSource !== 'suggestions') return;
    if (suggestions !== null) return;
    if (!tenantId) return;
    let cancelled = false;
    setSuggestionsLoading(true);
    (async () => {
      try {
        const data = await getSmartSuggestions(tripId, tenantId, currentItems);
        if (!cancelled) setSuggestions(data);
      } catch (err) {
        console.error('[AddItemsModal] suggestions load error:', err);
        if (!cancelled) setSuggestions({});
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, activeSource, tripId, tenantId, currentItems, suggestions]);

  // Clear selections + search when modal closes/opens
  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setPickedSuggestionIds(new Set());
      setPickedOrderId(null);
      setCatalogueQtys(new Map());
      setFrequentQtys(new Map());
      setSuggestions(null);
      setActiveSource('suggestions');
    }
  }, [isOpen]);

  // Reset search on source switch so previous filter doesn't bleed
  useEffect(() => { setSearch(''); }, [activeSource]);

  // Lowercased current-board names for duplicate detection
  const currentNamesLower = useMemo(
    () => new Set((currentItems || []).map(i => (i.name || '').toLowerCase().trim())),
    [currentItems]
  );
  const isDuplicate = (name) => currentNamesLower.has((name || '').toLowerCase().trim());

  // ── Suggestion helpers ──────────────────────────────────────────────
  const allSuggestionItems = useMemo(() => {
    if (!suggestions) return [];
    return Object.values(suggestions).flat().filter(s => !s.is_allergen_note);
  }, [suggestions]);

  const togglePickedSuggestion = (id) => {
    setPickedSuggestionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSuggestionSource = (key) => {
    setExpandedSuggestionSources(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ── Past order helpers ──────────────────────────────────────────────
  const visibleOrders = useMemo(() => {
    let list = favouritesOnly
      ? pastOrders.filter(o => favouriteOrderIds.has(o.id) || o.is_favourite)
      : pastOrders;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o => (o.supplier_name || '').toLowerCase().includes(q));
    }
    return list;
  }, [pastOrders, favouritesOnly, favouriteOrderIds, search]);

  // ── Catalogue helpers ───────────────────────────────────────────────
  const visibleCatalogueTree = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CATALOGUE_DATA
      .filter(([groupLabel]) => catalogueGroup === 'all' || catalogueGroup === groupLabel)
      .map(([groupLabel, categories]) => {
        const filteredCats = categories
          .map(([catName, items]) => {
            const filteredItems = items
              .filter(([itemName]) => !q || itemName.toLowerCase().includes(q))
              .map(([itemName, defaultUnit]) => ({
                key: `${groupLabel}::${catName}::${itemName}`,
                groupLabel, catName, itemName, defaultUnit,
              }));
            return [catName, filteredItems];
          })
          .filter(([, items]) => items.length > 0);
        return [groupLabel, filteredCats];
      })
      .filter(([, cats]) => cats.length > 0);
  }, [catalogueGroup, search]);

  const toggleCatalogueCategory = (catKey) => {
    setExpandedCatalogueCategories(prev => {
      const next = new Set(prev);
      if (next.has(catKey)) next.delete(catKey); else next.add(catKey);
      return next;
    });
  };
  const incCatalogueQty = (key, delta) => {
    setCatalogueQtys(prev => {
      const next = new Map(prev);
      const cur = next.get(key) || 0;
      const newQty = Math.max(0, cur + delta);
      if (newQty === 0) next.delete(key);
      else next.set(key, newQty);
      return next;
    });
  };

  // ── Frequent helpers ────────────────────────────────────────────────
  const visibleFrequent = useMemo(() => {
    let list = frequent || [];
    // Dept toggle defaults true. When isCommand and deptOnly=true we still
    // narrow by currentDepartment (the board's dept). When deptOnly=false
    // command sees all departments; non-command stays scoped server-side
    // anyway (fetchMasterOrderHistory handled that).
    if (deptOnly && isCommand && currentDepartment) {
      list = list.filter(h => (h.department || '').toLowerCase() === currentDepartment.toLowerCase());
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(h => (h.name || '').toLowerCase().includes(q));
    }
    return list;
  }, [frequent, deptOnly, isCommand, currentDepartment, search]);

  const incFrequentQty = (id, delta) => {
    setFrequentQtys(prev => {
      const next = new Map(prev);
      const cur = next.get(id) || 0;
      const newQty = Math.max(0, cur + delta);
      if (newQty === 0) next.delete(id);
      else next.set(id, newQty);
      return next;
    });
  };

  // ── Apply ────────────────────────────────────────────────────────────
  const pickedCount = useMemo(() => {
    if (activeSource === 'suggestions') return pickedSuggestionIds.size;
    if (activeSource === 'past_orders') return pickedOrderId ? 1 : 0;
    if (activeSource === 'catalogue')   return catalogueQtys.size;
    if (activeSource === 'frequent')    return frequentQtys.size;
    return 0;
  }, [activeSource, pickedSuggestionIds, pickedOrderId, catalogueQtys, frequentQtys]);

  const handleApply = async () => {
    if (!boardId || pickedCount === 0) return;
    setApplying(true);
    try {
      const newItems = [];

      if (activeSource === 'suggestions') {
        allSuggestionItems
          .filter(s => pickedSuggestionIds.has(s.id))
          .forEach(s => {
            newItems.push({
              list_id: boardId,
              name: s.name,
              brand: s.brand || '',
              size: s.size || '',
              category: s.category || '',
              sub_category: s.sub_category || '',
              department: s.department || currentDepartment || 'Galley',
              quantity_ordered: s.quantity || s.quantity_ordered || 1,
              unit: s.unit || 'each',
              estimated_unit_cost: s.estimated_unit_cost || '',
              allergen_flags: s.allergen_flags || [],
              source: s.source || 'suggestion',
              notes: s.reason || '',
              status: 'draft',
            });
          });
      } else if (activeSource === 'past_orders' && pickedOrderId) {
        const { data: rows } = await supabase
          ?.from('supplier_order_items')
          ?.select('item_name, brand, size, category, sub_category, department, allergen_flags, quantity, unit')
          ?.eq('order_id', pickedOrderId);
        (rows || []).forEach(r => {
          newItems.push({
            list_id: boardId,
            name: r.item_name,
            brand: r.brand || '',
            size: r.size || '',
            category: r.category || '',
            sub_category: r.sub_category || '',
            department: r.department || currentDepartment || 'Galley',
            quantity_ordered: r.quantity ?? 1,
            unit: r.unit || 'each',
            allergen_flags: r.allergen_flags || [],
            source: 'history',
            status: 'draft',
          });
        });
      } else if (activeSource === 'catalogue') {
        CATALOGUE_DATA.forEach(([groupLabel, categories]) => {
          const dept = CATALOGUE_GROUP_DEPT[groupLabel] || 'Galley';
          categories.forEach(([catName, catItems]) => {
            catItems.forEach(([itemName, defaultUnit]) => {
              const key = `${groupLabel}::${catName}::${itemName}`;
              const qty = catalogueQtys.get(key) || 0;
              if (qty <= 0) return;
              newItems.push({
                list_id: boardId,
                name: itemName,
                category: catName,
                department: dept,
                quantity_ordered: qty,
                unit: defaultUnit,
                allergen_flags: [],
                source: 'catalogue',
                status: 'draft',
              });
            });
          });
        });
      } else if (activeSource === 'frequent') {
        (frequent || []).forEach(h => {
          const qty = frequentQtys.get(h.id || h.key) || 0;
          if (qty <= 0) return;
          newItems.push({
            list_id: boardId,
            name: h.name,
            brand: h.brand || '',
            size: h.size || '',
            category: h.category || '',
            sub_category: h.sub_category || '',
            department: h.department || currentDepartment || 'Galley',
            quantity_ordered: qty,
            unit: h.unit || 'each',
            allergen_flags: [],
            source: 'history',
            status: 'draft',
          });
        });
      }

      if (!newItems.length) {
        setApplying(false);
        return;
      }

      const saved = await upsertItems(newItems);
      onItemsAdded?.(boardId, saved);
      showToast(`Added ${saved.length} item${saved.length === 1 ? '' : 's'}`, 'success');
      onClose?.();
    } catch (err) {
      console.error('[AddItemsModal] apply error:', err);
      showToast(`Couldn't add items — ${err?.message || err}`, 'error');
      setApplying(false);
    }
  };

  if (!isOpen) return null;

  // Mount via portal to document.body so position: fixed isn't defeated
  // by an ancestor with a transform / will-change / filter (an
  // .editorial-page wrapper or one of its parents had something setting
  // up a containing block, causing the modal to render inline rather
  // than as a true viewport overlay).
  return createPortal(
    <div className="add-items-modal pv-dashboard">
      <div className="add-items-modal-bar">
        <span className="add-items-modal-title">
          <span className="add-items-modal-dot" aria-hidden="true" />
          Add from…
        </span>
        <span className="add-items-modal-board-meta">
          {currentItems.length} item{currentItems.length === 1 ? '' : 's'} on this board
          {currentDepartment ? ` · ${currentDepartment}` : ''}
        </span>
        <button onClick={onClose} className="add-items-modal-close" aria-label="Close">×</button>
      </div>

      <div className="add-items-modal-body">
        {/* Sidebar */}
        <nav className="add-items-modal-nav">
          {SOURCES.map(s => (
            <button
              key={s.key}
              onClick={() => setActiveSource(s.key)}
              className={`add-items-modal-nav-item${activeSource === s.key ? ' is-active' : ''}`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <div className="add-items-modal-main">
          {/* ── Suggestions source ─────────────────────────────────── */}
          {activeSource === 'suggestions' && (
            <>
              <input
                type="text"
                placeholder="Search suggestions…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pv-wizard-input"
              />
              {suggestionsLoading && (
                <p className="pv-wizard-empty" style={{ marginTop: 16 }}>Generating suggestions…</p>
              )}
              {!suggestionsLoading && suggestions && allSuggestionItems.length === 0 && (
                <p className="pv-wizard-empty" style={{ marginTop: 16 }}>No suggestions to surface.</p>
              )}
              {!suggestionsLoading && allSuggestionItems.length > 0 && (
                <div className="add-items-modal-list">
                  {SUGGESTION_SOURCE_ORDER.map(srcKey => {
                    const items = suggestions?.[srcKey];
                    if (!items?.length) return null;
                    const itemsNoAllergens = items.filter(i => !i.is_allergen_note);
                    const filtered = search
                      ? itemsNoAllergens.filter(i =>
                          (i.name || '').toLowerCase().includes(search.toLowerCase()) ||
                          (i.reason || '').toLowerCase().includes(search.toLowerCase())
                        )
                      : itemsNoAllergens;
                    if (!filtered.length) return null;
                    const meta = SOURCE_META[srcKey] || { label: srcKey };
                    const isExpanded = expandedSuggestionSources.has(srcKey);
                    return (
                      <React.Fragment key={srcKey}>
                        <button
                          onClick={() => toggleSuggestionSource(srcKey)}
                          className="pv-wizard-src-head"
                          style={{ background: 'none', border: 0, width: '100%', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <span style={{ color: 'var(--d-muted-soft)', fontSize: 11, marginRight: 2 }}>{isExpanded ? '▾' : '▸'}</span>
                          <span className="pv-wizard-src-label">{meta.label}</span>
                          <span className="pv-wizard-src-count">{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
                        </button>
                        {isExpanded && filtered.map(item => {
                          const isPicked = pickedSuggestionIds.has(item.id);
                          const dup = isDuplicate(item.name);
                          return (
                            <button
                              key={item.id}
                              onClick={() => !dup && togglePickedSuggestion(item.id)}
                              disabled={dup}
                              className={`pv-wizard-board-row${isPicked ? ' is-selected' : ''}`}
                              style={dup ? { opacity: 0.55 } : null}
                            >
                              <span className={`pv-wizard-row-checkbox${isPicked ? ' is-checked' : ''}`}>
                                {isPicked ? '✓' : ''}
                              </span>
                              <span className="pv-wizard-board-row-body">
                                <span className="pv-wizard-board-row-head">
                                  <span className="pv-wizard-board-row-title">{item.name}</span>
                                  {dup
                                    ? <span className="pv-wizard-row-priority is-muted">Already on board</span>
                                    : item._signal
                                      ? <span className={`pv-wizard-row-priority ${item._signal.cls}`}>{item._signal.text}</span>
                                      : null}
                                </span>
                                <span className="pv-wizard-board-row-meta">
                                  {item.department && <span className="pv-wizard-row-tag">{item.department}</span>}
                                  {item.reason}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Past orders source ─────────────────────────────────── */}
          {activeSource === 'past_orders' && (
            <>
              <div className="pv-wizard-seg" style={{ marginBottom: 10 }}>
                <button
                  onClick={() => setFavouritesOnly(false)}
                  className={`pv-wizard-seg-btn${!favouritesOnly ? ' is-active' : ''}`}
                >All</button>
                <button
                  onClick={() => setFavouritesOnly(true)}
                  className={`pv-wizard-seg-btn${favouritesOnly ? ' is-active' : ''}`}
                >Favourites</button>
              </div>
              <input
                type="text"
                placeholder="Search supplier…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pv-wizard-input"
              />
              <div className="add-items-modal-list">
                {loading && <p className="pv-wizard-empty">Loading orders…</p>}
                {!loading && visibleOrders.length === 0 && (
                  <p className="pv-wizard-empty">
                    {favouritesOnly ? 'No favourited orders.' : 'No past orders.'}
                  </p>
                )}
                {visibleOrders.map(order => {
                  const isSelected = pickedOrderId === order.id;
                  const itemCount = Number(order.item_count) || 0;
                  const isFav = favouriteOrderIds.has(order.id) || order.is_favourite;
                  return (
                    <button
                      key={order.id}
                      onClick={() => setPickedOrderId(isSelected ? null : order.id)}
                      className={`pv-wizard-board-row${isSelected ? ' is-selected' : ''}`}
                    >
                      <span className={`pv-wizard-row-checkbox${isSelected ? ' is-checked' : ''}`}>
                        {isSelected ? '✓' : ''}
                      </span>
                      <span className="pv-wizard-board-row-body">
                        <span className="pv-wizard-board-row-head">
                          <span className="pv-wizard-board-row-title">
                            {order.supplier_name || 'Supplier'}
                            {isFav && <span style={{ color: 'var(--d-orange)', marginLeft: 6 }}>★</span>}
                          </span>
                          <span className="pv-wizard-item-count">{itemCount} item{itemCount === 1 ? '' : 's'}</span>
                        </span>
                        <span className="pv-wizard-board-row-meta">
                          {order.sent_at ? new Date(order.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ── Catalogue source (multi-column grid) ───────────────── */}
          {activeSource === 'catalogue' && (
            <>
              <div className="pv-wizard-select-wrap">
                <select
                  value={catalogueGroup}
                  onChange={e => setCatalogueGroup(e.target.value)}
                  className="pv-wizard-select"
                >
                  <option value="all">All groups</option>
                  {CATALOGUE_DATA.map(([groupLabel]) => (
                    <option key={groupLabel} value={groupLabel}>{formatGroupLabel(groupLabel)}</option>
                  ))}
                </select>
                <svg className="pv-wizard-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              <input
                type="text"
                placeholder="Search catalogue…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pv-wizard-input"
                style={{ marginTop: 10 }}
              />
              <div className="add-items-modal-list">
                {visibleCatalogueTree.length === 0 && (
                  <p className="pv-wizard-empty">No catalogue items match.</p>
                )}
                {visibleCatalogueTree.map(([groupLabel, cats]) => (
                  <React.Fragment key={groupLabel}>
                    {cats.map(([catName, items]) => {
                      const catKey = `${groupLabel}::${catName}`;
                      const isExpanded = search ? true : expandedCatalogueCategories.has(catKey);
                      return (
                        <React.Fragment key={catKey}>
                          <button
                            onClick={() => toggleCatalogueCategory(catKey)}
                            className="pv-wizard-src-head"
                            style={{ background: 'none', border: 0, width: '100%', cursor: 'pointer', textAlign: 'left' }}
                          >
                            <span style={{ color: 'var(--d-muted-soft)', fontSize: 11, marginRight: 2 }}>{isExpanded ? '▾' : '▸'}</span>
                            <span className="pv-wizard-src-label">{catName}</span>
                            <span className="pv-wizard-src-count">{items.length} item{items.length === 1 ? '' : 's'}</span>
                          </button>
                          {isExpanded && (
                            <div className="add-items-modal-catalogue-grid">
                              {items.map(({ key, itemName, defaultUnit }) => {
                                const qty = catalogueQtys.get(key) || 0;
                                const dup = isDuplicate(itemName);
                                return (
                                  <div
                                    key={key}
                                    className={`add-items-modal-grid-card${qty > 0 ? ' is-selected' : ''}${dup ? ' is-duplicate' : ''}`}
                                  >
                                    <div className="add-items-modal-grid-name">{itemName}</div>
                                    <div className="add-items-modal-grid-foot">
                                      {dup ? (
                                        <span className="add-items-modal-dup-pill">✓ On board</span>
                                      ) : (
                                        <span className="pv-wizard-stepper">
                                          <button
                                            type="button"
                                            onClick={() => incCatalogueQty(key, -1)}
                                            disabled={qty === 0}
                                            className="pv-wizard-stepbtn"
                                          >−</button>
                                          <span className="pv-wizard-stepqty">{qty || 0}</span>
                                          <button
                                            type="button"
                                            onClick={() => incCatalogueQty(key, 1)}
                                            className="pv-wizard-stepbtn"
                                          >+</button>
                                          <span className="pv-wizard-stepunit">{defaultUnit}</span>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </>
          )}

          {/* ── Frequent source ────────────────────────────────────── */}
          {activeSource === 'frequent' && (
            <>
              {isCommand && currentDepartment && (
                <div className="pv-wizard-seg" style={{ marginBottom: 10 }}>
                  <button
                    onClick={() => setDeptOnly(true)}
                    className={`pv-wizard-seg-btn${deptOnly ? ' is-active' : ''}`}
                  >{currentDepartment}</button>
                  <button
                    onClick={() => setDeptOnly(false)}
                    className={`pv-wizard-seg-btn${!deptOnly ? ' is-active' : ''}`}
                  >All depts</button>
                </div>
              )}
              <input
                type="text"
                placeholder="Search frequent items…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pv-wizard-input"
              />
              <div className="add-items-modal-list">
                {loading && <p className="pv-wizard-empty">Loading frequent items…</p>}
                {!loading && visibleFrequent.length === 0 && (
                  <p className="pv-wizard-empty">No frequent items yet — they'll appear once a few orders have shipped.</p>
                )}
                {visibleFrequent.map(h => {
                  const id = h.id || h.key;
                  const qty = frequentQtys.get(id) || 0;
                  const dup = isDuplicate(h.name);
                  return (
                    <div
                      key={id}
                      className={`pv-wizard-board-row${qty > 0 ? ' is-selected' : ''}`}
                      style={dup ? { opacity: 0.55, cursor: 'default' } : { cursor: 'default' }}
                    >
                      <span className="pv-wizard-board-row-body">
                        <span className="pv-wizard-board-row-head">
                          <span className="pv-wizard-board-row-title">{h.name}</span>
                          {dup
                            ? <span className="pv-wizard-row-priority is-muted">Already on board</span>
                            : h.times_ordered
                              ? <span className="pv-wizard-row-priority is-muted">Ordered {h.times_ordered}×</span>
                              : null}
                        </span>
                        <span className="pv-wizard-board-row-meta">
                          {h.department && <span className="pv-wizard-row-tag">{h.department}</span>}
                          {h.brand ? `${h.brand}${h.size ? ' · ' + h.size : ''}` : ''}
                        </span>
                      </span>
                      {!dup && (
                        <span className="pv-wizard-stepper">
                          <button type="button" onClick={() => incFrequentQty(id, -1)} disabled={qty === 0} className="pv-wizard-stepbtn">−</button>
                          <span className="pv-wizard-stepqty">{qty || 0}</span>
                          <button type="button" onClick={() => incFrequentQty(id, 1)} className="pv-wizard-stepbtn">+</button>
                          <span className="pv-wizard-stepunit">{h.unit || 'each'}</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="add-items-modal-footer">
        <button onClick={onClose} className="pv-wizard-btn-secondary">Cancel</button>
        <button
          onClick={handleApply}
          disabled={pickedCount === 0 || applying}
          className="pv-wizard-btn pv-wizard-btn-primary"
          style={{ minWidth: 220 }}
        >
          {applying
            ? 'Adding…'
            : pickedCount > 0
              ? `Add ${pickedCount} ${activeSource === 'past_orders' ? 'order' : 'item'}${pickedCount === 1 ? '' : 's'} to board`
              : 'Select items'}
        </button>
      </div>
    </div>,
    document.body
  );
}

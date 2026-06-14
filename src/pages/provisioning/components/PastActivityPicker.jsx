import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { loadTrips, findTripByAnyId } from '../../trips-management-dashboard/utils/tripStorage';
import {
  fetchPastOrders,
  fetchQuickAddFavourites,
  fetchTemplates,
} from '../utils/provisioningStorage';
import { TEMPLATES } from '../data/templates';
import { getSmartSuggestions, SOURCE_META } from '../../../utils/provisioningSuggestions';

// ── PastActivityPicker — the unified "Build from..." picker ────────────────
// Single sub-view that consolidates every "starting point" the wizard offers
// behind one umbrella tile (replaces the prior Template + From-past two-tile
// surface). Four tabs:
//
//   Boards     — provisioning_lists. Three-position toggle:
//                   Live      = non-template, modified within last 60 days
//                   Past      = non-template, older than 60 days
//                   Templates = is_template = true (user-saved) PLUS the
//                               hardcoded TEMPLATES library from
//                               data/templates.js (curated stencils)
//                Supports guest-count scaling on apply.
//   Past orders — supplier_orders chronological. ★ Favourites filter chip
//                lights the list down to is_favourite=true entries (uses
//                the same QuickAdd favourites RPC as the in-board panel).
//                Single-supplier, strict Quick-Add snapshot fields.
//   Catalogue  — deeplink stub to the external Cargo Provisions site
//                (provisions.cargotechnology.co.uk). Has its own auth +
//                API; kept separated so users don't accidentally cross-
//                authenticate. Callback contract TBD — placeholder UI only.
//   Suggestions — AI-driven starter list. Calls getSmartSuggestions with
//                  the wizard's tripId + tenantId (no currentItems — this
//                  is a fresh board), groups results by source via the
//                  shared SmartSuggestionsPanel, and routes apply through
//                  onUse() so the wizard creates the board with the
//                  picked items. Same five sources the in-board panel
//                  uses (guest_preference, low_stock, invoice_pattern,
//                  location_aware, master_history). No trip selected →
//                  guest/location sources return empty but stock /
//                  pattern / history still surface.
//
// Props:
//   tenantId       — current tenant/vessel id
//   tripId         — supabaseId of the linked trip (drives guest +
//                    location suggestion sources); null if unlinked
//   newGuestCount  — guest count on the new trip (for board copy scaling
//                    and template scaling)
//   boardType      — chosen board type (charter/owner/yard/…); used to
//                    pre-filter the hardcoded TEMPLATES library
//   onUse(items, source) — called with the mapped item array + a source
//                          tag (board/template/order/catalogue/suggestion)
//                          so the parent records provenance
//   onBack         — called when user clicks ← Back

const CATALOGUE_URL = 'https://provisions.cargotechnology.co.uk/';
const RECENT_DAYS = 60; // boards modified within this window count as "Live"

// Per-source rightmost chip text + style. Replaces the noisy red badge
// SmartSuggestionsPanel rendered for every high-priority row. Returns
// null when there's no signal worth surfacing.
function suggestionSignal(s) {
  if (!s) return null;
  if (s.is_allergen_note) return { text: 'Allergen', cls: 'is-high' };
  if (s.priority === 'high') {
    if (s.source === 'low_stock')         return { text: (s.quantity_ordered === 0 ? 'Out of stock' : 'High priority'), cls: 'is-high' };
    if (s.source === 'guest_preference')  return { text: 'Required', cls: 'is-high' };
    if (s.source === 'invoice_pattern')   return { text: 'Overdue', cls: 'is-high' };
    return { text: 'High priority', cls: 'is-high' };
  }
  if (s.source === 'low_stock')                                    return { text: 'Low', cls: 'is-warn' };
  if (s.source === 'master_history' && s.times_ordered)            return { text: `Ordered ${s.times_ordered}×`, cls: 'is-muted' };
  if (s.source === 'invoice_pattern')                              return { text: 'Due', cls: 'is-muted' };
  if (s.source === 'location_aware')                               return { text: 'Stock-up', cls: 'is-muted' };
  return null;
}

export default function PastActivityPicker({
  tenantId,
  tripId = null,
  newGuestCount = 0,
  boardType = '',
  onUse,
  onBack,
}) {
  // Top-level tab + per-tab sub-state.
  const [tab, setTab] = useState('boards');                 // 'boards' | 'orders' | 'catalogue' | 'suggestions'
  const [boardsToggle, setBoardsToggle] = useState('live'); // 'live' | 'past' | 'templates'
  const [favouritesOnly, setFavouritesOnly] = useState(false);

  // Data
  const [boards, setBoards] = useState([]);              // all provisioning_lists (is_template=false)
  const [savedTemplates, setSavedTemplates] = useState([]); // provisioning_lists where is_template=true
  const [pastOrders, setPastOrders] = useState([]);
  const [favouriteOrderIds, setFavouriteOrderIds] = useState(new Set());

  // Selections
  const [selectedBoardId, setSelectedBoardId] = useState(null);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState(null); // `saved:<id>` | `lib:<id>`
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  // UI state — one search input per tab, scoped to the tab so switching
  // doesn't blow the others' filter away. Each tab's search filters its
  // own data source (boards titles, template titles, supplier names,
  // suggestion item names).
  const [boardSearch, setBoardSearch] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [suggestionSearch, setSuggestionSearch] = useState('');
  const [scaleQty, setScaleQty] = useState(true);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  // Smart suggestions — lazy-loaded the first time the user opens the tab
  // because the multi-source query (guest prefs + inventory + delivery
  // history + master pattern) is the heaviest fetch in this picker.
  // Kept null until first activation so the spinner shows on tab entry.
  const [suggestions, setSuggestions] = useState(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  // Multi-select inside the Suggestions tab — Set of suggestion ids the
  // user has ticked. Cleared on apply / tab change.
  const [pickedSuggestionIds, setPickedSuggestionIds] = useState(new Set());

  // Load all sources concurrently on mount.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const trips = (await loadTrips()) || [];

        const [boardsRes, templates, past, favs] = await Promise.all([
          supabase
            ?.from('provisioning_lists')
            ?.select('id, title, created_at, updated_at, trip_id, department, is_template')
            ?.eq('tenant_id', tenantId)
            ?.eq('is_template', false)
            ?.order('updated_at', { ascending: false })
            ?.limit(60),
          fetchTemplates(tenantId).catch(() => []),
          fetchPastOrders(tenantId).catch(() => []),
          fetchQuickAddFavourites(tenantId).catch(() => []),
        ]);

        const enriched = await Promise.all((boardsRes?.data || []).map(async (board) => {
          const { count } = await supabase
            ?.from('provisioning_items')
            ?.select('id', { count: 'exact', head: true })
            ?.eq('list_id', board.id);
          let guestCount = 0;
          let tripName = null;
          if (board.trip_id) {
            const trip = findTripByAnyId(trips, board.trip_id);
            if (trip) {
              guestCount = trip.guests?.filter(g => g.isActive)?.length || trip.guests?.length || 0;
              tripName = trip.name || trip.title || null;
            }
          }
          return { ...board, _itemCount: count || 0, _guestCount: guestCount, _tripName: tripName };
        }));

        if (cancelled) return;
        setBoards(enriched);
        setSavedTemplates(templates || []);
        setPastOrders(past || []);
        setFavouriteOrderIds(new Set((favs || []).map(f => f.id)));
      } catch (err) {
        console.error('[PastActivityPicker] load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  // Reset selection when switching tabs/toggles.
  useEffect(() => {
    setSelectedBoardId(null);
    setSelectedTemplateKey(null);
    setSelectedOrderId(null);
    setPickedSuggestionIds(new Set());
  }, [tab, boardsToggle]);

  // Lazy-load smart suggestions on first Suggestions-tab activation. New
  // board so currentItems is empty — master_history surfaces everything
  // that's been ordered ≥3 times. tripId may be null (no trip linked);
  // guest_preference + location_aware short-circuit to [] inside the
  // engine in that case.
  useEffect(() => {
    if (tab !== 'suggestions') return;
    if (suggestions !== null) return; // already loaded
    if (!tenantId) return;
    let cancelled = false;
    setSuggestionsLoading(true);
    (async () => {
      try {
        const data = await getSmartSuggestions(tripId, tenantId, []);
        if (!cancelled) setSuggestions(data);
      } catch (err) {
        console.error('[PastActivityPicker] suggestions load error:', err);
        if (!cancelled) setSuggestions({});
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, tripId, tenantId, suggestions]);

  // Map raw suggestion rows → provisioning item shape and route through
  // onUse with a 'suggestion' source tag so the wizard creates the board
  // with these items. Mirrors BoardDrawer.SuggestionsMode.handleAdd's
  // mapping but skips the upsertItems call (board doesn't exist yet —
  // triggerCreate inserts the items as part of board creation).
  const handleSuggestionsApply = (items) => {
    const mapped = (items || []).map(s => ({
      name:             s.name,
      brand:            s.brand || null,
      size:             s.size || null,
      category:         s.category || null,
      sub_category:     s.sub_category || null,
      department:       s.department || 'Galley',
      quantity_ordered: s.quantity || s.quantity_ordered || s.avg_quantity || 1,
      unit:             s.unit || 'each',
      estimated_unit_cost: s.estimated_unit_cost || null,
      allergen_flags:   s.allergen_flags || [],
      notes:            s.reason || null,
      status:           'draft',
    }));
    if (!mapped.length) return;
    onUse(mapped, 'suggestion');
  };

  // Multi-select helpers for the Suggestions tab.
  const togglePickedSuggestion = (id) => {
    setPickedSuggestionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Flatten suggestion sources into one array for selection lookups + CTA
  // disabled checks. Recomputes only when suggestions change.
  const allSuggestionItems = useMemo(() => {
    if (!suggestions) return [];
    return Object.values(suggestions).flat();
  }, [suggestions]);

  const pickedSuggestionItems = useMemo(
    () => allSuggestionItems.filter(s => pickedSuggestionIds.has(s.id)),
    [allSuggestionItems, pickedSuggestionIds]
  );

  // ── Derived lists ─────────────────────────────────────────────────────
  const { liveBoards, pastBoards } = useMemo(() => {
    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    const live = [];
    const past = [];
    boards.forEach(b => {
      const stamp = new Date(b.updated_at || b.created_at).getTime();
      (stamp >= cutoff ? live : past).push(b);
    });
    return { liveBoards: live, pastBoards: past };
  }, [boards]);

  const libraryTemplates = useMemo(() => {
    return TEMPLATES
      .filter(t => !boardType || t.boardTypes.includes(boardType))
      .map(t => ({
        _key: `lib:${t.id}`,
        _kind: 'library',
        title: t.name,
        description: t.description,
        itemCount: t.itemCount,
        categories: t.categories,
        department: t.department,
        raw: t,
      }));
  }, [boardType]);

  const userTemplates = useMemo(() => {
    return (savedTemplates || []).map(t => ({
      _key: `saved:${t.id}`,
      _kind: 'saved',
      id: t.id,
      title: t.title,
      description: t.department ? `Saved · ${t.department}` : 'Saved template',
      itemCount: null, // unknown without a count query; kept lightweight
      raw: t,
    }));
  }, [savedTemplates]);

  const visibleBoards = useMemo(() => {
    const source = boardsToggle === 'live' ? liveBoards : boardsToggle === 'past' ? pastBoards : [];
    if (!boardSearch) return source;
    const q = boardSearch.toLowerCase();
    return source.filter(b => b.title?.toLowerCase().includes(q));
  }, [boardsToggle, liveBoards, pastBoards, boardSearch]);

  const visibleTemplates = useMemo(() => {
    const all = [...userTemplates, ...libraryTemplates];
    if (!templateSearch) return all;
    const q = templateSearch.toLowerCase();
    return all.filter(t =>
      t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)
    );
  }, [userTemplates, libraryTemplates, templateSearch]);

  const visibleOrders = useMemo(() => {
    let list = favouritesOnly
      ? pastOrders.filter(o => favouriteOrderIds.has(o.id) || o.is_favourite)
      : pastOrders;
    if (orderSearch) {
      const q = orderSearch.toLowerCase();
      list = list.filter(o => (o.supplier_name || '').toLowerCase().includes(q));
    }
    return list;
  }, [pastOrders, favouritesOnly, favouriteOrderIds, orderSearch]);

  // ── Selection helpers ─────────────────────────────────────────────────
  const selectedBoard = selectedBoardId ? boards.find(b => b.id === selectedBoardId) : null;
  const selectedTemplate = selectedTemplateKey
    ? visibleTemplates.find(t => t._key === selectedTemplateKey)
    : null;
  const selectedOrder = selectedOrderId ? pastOrders.find(o => o.id === selectedOrderId) : null;

  const hasSelection =
    (tab === 'boards' && boardsToggle !== 'templates' && !!selectedBoardId) ||
    (tab === 'boards' && boardsToggle === 'templates' && !!selectedTemplateKey) ||
    (tab === 'orders' && !!selectedOrderId);

  // ── Apply ─────────────────────────────────────────────────────────────
  const handleApply = async () => {
    if (!hasSelection) return;
    setApplying(true);
    try {
      // Board (live/past) or user-saved template: copy provisioning_items rows.
      if (tab === 'boards' && boardsToggle !== 'templates') {
        const { data: sourceItems } = await supabase
          ?.from('provisioning_items')
          ?.select('name, category, department, quantity_ordered, unit, estimated_unit_cost, allergen_flags, notes, source')
          ?.eq('list_id', selectedBoardId);
        const sourceGuests = selectedBoard?._guestCount || 0;
        const shouldScale = scaleQty && sourceGuests > 0 && newGuestCount > 0 && sourceGuests !== newGuestCount;
        const scaleFactor = shouldScale ? newGuestCount / sourceGuests : 1;
        const items = (sourceItems || []).map(item => ({
          name:             item.name,
          category:         item.category || null,
          department:       item.department || null,
          quantity_ordered: shouldScale
            ? Math.max(1, Math.ceil((item.quantity_ordered || 1) * scaleFactor))
            : (item.quantity_ordered || 1),
          unit:             item.unit || null,
          estimated_unit_cost: item.estimated_unit_cost || null,
          allergen_flags:   item.allergen_flags || null,
          notes:            item.notes || null,
          status:           'draft',
        }));
        onUse(items, 'past');
        return;
      }

      // Templates tab — saved (provisioning_lists row) vs library (hardcoded).
      if (tab === 'boards' && boardsToggle === 'templates' && selectedTemplate) {
        if (selectedTemplate._kind === 'saved') {
          const { data: sourceItems } = await supabase
            ?.from('provisioning_items')
            ?.select('name, category, department, quantity_ordered, unit, estimated_unit_cost, allergen_flags, notes')
            ?.eq('list_id', selectedTemplate.id);
          const items = (sourceItems || []).map(item => ({
            name:             item.name,
            category:         item.category || null,
            department:       item.department || null,
            quantity_ordered: item.quantity_ordered || 1,
            unit:             item.unit || null,
            estimated_unit_cost: item.estimated_unit_cost || null,
            allergen_flags:   item.allergen_flags || null,
            notes:            item.notes || null,
            status:           'draft',
          }));
          onUse(items, 'template');
          return;
        }
        // Library template: scale per-guest items.
        const tpl = selectedTemplate.raw;
        const items = tpl.items.map(item => {
          let qty = 1;
          if (item.default_qty_flat != null) qty = item.default_qty_flat;
          else if (item.default_qty_per_guest != null && newGuestCount > 0) qty = Math.max(1, Math.ceil(item.default_qty_per_guest * newGuestCount));
          else if (item.default_qty_per_guest != null) qty = Math.max(1, Math.ceil(item.default_qty_per_guest));
          return {
            name:             item.name,
            category:         item.category,
            unit:             item.unit || null,
            quantity_ordered: qty,
            status:           'draft',
            department:       tpl.department,
          };
        });
        onUse(items, 'template');
        return;
      }

      // Past orders (incl. ★ favourites filter): copy supplier_order_items.
      if (tab === 'orders') {
        const { data: rows } = await supabase
          ?.from('supplier_order_items')
          ?.select('item_name, brand, size, category, sub_category, department, allergen_flags, quantity, unit')
          ?.eq('order_id', selectedOrderId);
        const items = (rows || []).map(r => ({
          name:             r.item_name,
          brand:            r.brand || null,
          size:             r.size || null,
          category:         r.category || null,
          sub_category:     r.sub_category || null,
          department:       r.department || null,
          allergen_flags:   r.allergen_flags || null,
          quantity_ordered: r.quantity ?? 1,
          unit:             r.unit || null,
          status:           'draft',
        }));
        const source = favouritesOnly || selectedOrder?.is_favourite ? 'favourite' : 'history';
        onUse(items, source);
        return;
      }
    } catch (err) {
      console.error('[PastActivityPicker] apply error:', err);
      setApplying(false);
    }
  };

  const fmtDate = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return ''; }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="pv-wizard-header" style={{ marginBottom: 12 }}>
        <button onClick={onBack} className="pv-wizard-back">← Back</button>
        <h3 className="pv-wizard-title">
          <span className="pv-wizard-title-dot" aria-hidden="true" />
          Build from…
        </h3>
      </div>

      {/* Top-level tabs — editorial underline strip */}
      <div className="pv-wizard-tabs">
        <button
          onClick={() => setTab('boards')}
          className={`pv-wizard-tab${tab === 'boards' ? ' is-active' : ''}`}
        >Boards</button>
        <button
          onClick={() => setTab('orders')}
          className={`pv-wizard-tab${tab === 'orders' ? ' is-active' : ''}`}
        >Past orders</button>
        <button
          onClick={() => setTab('catalogue')}
          className={`pv-wizard-tab${tab === 'catalogue' ? ' is-active' : ''}`}
        >Catalogue</button>
        <button
          onClick={() => setTab('suggestions')}
          className={`pv-wizard-tab${tab === 'suggestions' ? ' is-active' : ''}`}
        >Suggestions</button>
      </div>

      {/* ── Boards tab ───────────────────────────────────────────────── */}
      {tab === 'boards' && (
        <>
          {/* Live / Past / Templates — segmented control */}
          <div className="pv-wizard-seg" style={{ marginTop: 10 }}>
            <button
              onClick={() => setBoardsToggle('live')}
              className={`pv-wizard-seg-btn${boardsToggle === 'live' ? ' is-active' : ''}`}
            >Live</button>
            <button
              onClick={() => setBoardsToggle('past')}
              className={`pv-wizard-seg-btn${boardsToggle === 'past' ? ' is-active' : ''}`}
            >Past</button>
            <button
              onClick={() => setBoardsToggle('templates')}
              className={`pv-wizard-seg-btn${boardsToggle === 'templates' ? ' is-active' : ''}`}
            >Templates</button>
          </div>

          {/* Search — present on every Boards toggle position so the chrome
              is consistent. Templates search filters both user-saved and
              library entries by title/description; Live/Past filter by
              board title. */}
          {boardsToggle === 'templates' ? (
            <input
              type="text"
              placeholder="Search templates…"
              value={templateSearch}
              onChange={e => setTemplateSearch(e.target.value)}
              className="pv-wizard-input"
              style={{ marginTop: 12 }}
            />
          ) : (
            <input
              type="text"
              placeholder={boardsToggle === 'live' ? 'Search live boards…' : 'Search past boards…'}
              value={boardSearch}
              onChange={e => setBoardSearch(e.target.value)}
              className="pv-wizard-input"
              style={{ marginTop: 12 }}
            />
          )}

          {/* Boards list (live or past) */}
          {boardsToggle !== 'templates' && (
            <div className="pv-wizard-list">
              {loading && <p className="pv-wizard-empty">Loading boards…</p>}
              {!loading && visibleBoards.length === 0 && (
                <p className="pv-wizard-empty">
                  {boardsToggle === 'live'
                    ? 'No live boards. Try Past, or save one as a template.'
                    : 'No past boards yet.'}
                </p>
              )}
              {visibleBoards.map(board => {
                const isSelected = selectedBoardId === board.id;
                return (
                  <button
                    key={board.id}
                    onClick={() => setSelectedBoardId(isSelected ? null : board.id)}
                    className={`pv-wizard-board-row${isSelected ? ' is-selected' : ''}`}
                  >
                    <span className={`pv-wizard-row-checkbox${isSelected ? ' is-checked' : ''}`} aria-hidden="true">
                      {isSelected ? '✓' : ''}
                    </span>
                    <span className="pv-wizard-board-row-body">
                      <span className="pv-wizard-board-row-head">
                        <span className="pv-wizard-board-row-title">{board.title}</span>
                        <span className="pv-wizard-item-count">{board._itemCount} items</span>
                      </span>
                      <span className="pv-wizard-board-row-meta">
                        {board.department && (
                          <span className="pv-wizard-row-tag">{board.department}</span>
                        )}
                        {fmtDate(board.updated_at || board.created_at)}
                        {board._tripName ? ` · ${board._tripName}` : ''}
                        {board._guestCount > 0 ? ` · ${board._guestCount} guests` : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Templates list (user-saved + hardcoded library) */}
          {boardsToggle === 'templates' && (
            <div className="pv-wizard-list">
              {loading && <p className="pv-wizard-empty">Loading templates…</p>}
              {!loading && visibleTemplates.length === 0 && (
                <p className="pv-wizard-empty">No templates available.</p>
              )}
              {visibleTemplates.map(tpl => {
                const isSelected = selectedTemplateKey === tpl._key;
                return (
                  <button
                    key={tpl._key}
                    onClick={() => setSelectedTemplateKey(isSelected ? null : tpl._key)}
                    className={`pv-wizard-pick-card${isSelected ? ' is-selected' : ''}`}
                  >
                    <div className="pv-wizard-pick-card-head">
                      <p className="pv-wizard-pick-card-title">
                        {tpl.title}
                        {tpl._kind === 'library' && (
                          <span className="pv-wizard-chip" style={{ marginLeft: 8, fontSize: 9 }}>Library</span>
                        )}
                      </p>
                      {tpl.itemCount != null && (
                        <span className="pv-wizard-item-count">{tpl.itemCount} items</span>
                      )}
                    </div>
                    {tpl.description && (
                      <p className="pv-wizard-pick-card-desc">{tpl.description}</p>
                    )}
                    {tpl._kind === 'library' && Array.isArray(tpl.categories) && tpl.categories.length > 0 && (
                      <div className="pv-wizard-chip-row">
                        {tpl.categories.slice(0, 4).map(cat => (
                          <span key={cat} className="pv-wizard-chip">{cat}</span>
                        ))}
                        {tpl.categories.length > 4 && (
                          <span className="pv-wizard-chip-more">+{tpl.categories.length - 4} more</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Guest-count scaling (Live/Past only — saved templates skip scaling) */}
          {boardsToggle !== 'templates' && selectedBoard && selectedBoard._guestCount > 0 && newGuestCount > 0 && selectedBoard._guestCount !== newGuestCount && (
            <div className="pv-wizard-scale">
              <label className="pv-wizard-scale-label">
                <input
                  type="checkbox"
                  checked={scaleQty}
                  onChange={e => setScaleQty(e.target.checked)}
                />
                Adjust quantities for <strong>{newGuestCount} guests</strong> (was {selectedBoard._guestCount})
              </label>
            </div>
          )}
        </>
      )}

      {/* ── Past orders tab ──────────────────────────────────────────── */}
      {tab === 'orders' && (
        <>
          {/* All / Favourites — same segmented control as Boards. Star
              icon kept on the row itself (alongside favourited supplier
              names) but stripped from the toggle label to keep the
              chrome quiet. */}
          <div className="pv-wizard-seg" style={{ marginTop: 10 }}>
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
            value={orderSearch}
            onChange={e => setOrderSearch(e.target.value)}
            className="pv-wizard-input"
            style={{ marginTop: 12 }}
          />

          <div className="pv-wizard-list">
            {loading && <p className="pv-wizard-empty">Loading orders…</p>}
            {!loading && visibleOrders.length === 0 && (
              <p className="pv-wizard-empty">
                {favouritesOnly
                  ? 'No favourited orders yet. Star an order to add it here.'
                  : 'No past orders yet. Send an order to a supplier and it’ll appear here.'}
              </p>
            )}
            {visibleOrders.map(order => {
              const isSelected = selectedOrderId === order.id;
              const itemCount = Number(order.item_count) || 0;
              const depts = Array.isArray(order.departments) ? order.departments.filter(Boolean) : [];
              const isFav = favouriteOrderIds.has(order.id) || order.is_favourite;
              return (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrderId(isSelected ? null : order.id)}
                  className={`pv-wizard-board-row${isSelected ? ' is-selected' : ''}`}
                >
                  <span className={`pv-wizard-row-checkbox${isSelected ? ' is-checked' : ''}`} aria-hidden="true">
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
                      {depts.length > 0 && (
                        <span className="pv-wizard-row-tag">{depts[0]}</span>
                      )}
                      {fmtDate(order.sent_at || order.created_at)}
                      {depts.length > 1 ? ` · ${depts.slice(1).join(', ')}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── Catalogue tab (placeholder / deeplink stub) ──────────────── */}
      {tab === 'catalogue' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
          <p className="pv-wizard-context" style={{ margin: 0 }}>
            Browse the Cargo Provisions catalogue and push selections back to this board.
          </p>
          <p className="pv-wizard-route-desc" style={{ margin: 0 }}>
            Opens <strong>provisions.cargotechnology.co.uk</strong> in a new tab. The catalogue has
            its own sign-in. Returning to this page with selections is on the integration roadmap —
            the picker UI here will fill once the callback contract is agreed.
          </p>
          <a
            href={CATALOGUE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="pv-wizard-btn pv-wizard-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
          >
            Open Cargo catalogue ↗
          </a>
        </div>
      )}

      {/* ── Suggestions tab — inline editorial rendering (no embedded panel) ── */}
      {tab === 'suggestions' && (
        <>
          {!tripId && (
            <p className="pv-wizard-notice">
              No trip linked — guest-preference and location-aware sources will be empty.
              Stock, pattern, and history-based suggestions still apply.
            </p>
          )}

          <input
            type="text"
            placeholder="Search suggestions…"
            value={suggestionSearch}
            onChange={e => setSuggestionSearch(e.target.value)}
            className="pv-wizard-input"
            style={{ marginTop: 12 }}
          />

          {suggestionsLoading && (
            <p className="pv-wizard-empty">Generating suggestions…</p>
          )}

          {!suggestionsLoading && suggestions && allSuggestionItems.length === 0 && (
            <p className="pv-wizard-empty">No suggestions to surface yet.</p>
          )}

          {!suggestionsLoading && allSuggestionItems.length > 0 && (
            <div className="pv-wizard-list">
              {Object.entries(suggestions || {}).map(([source, items]) => {
                if (!items?.length) return null;
                const filtered = suggestionSearch
                  ? items.filter(i =>
                      (i.name || '').toLowerCase().includes(suggestionSearch.toLowerCase()) ||
                      (i.reason || '').toLowerCase().includes(suggestionSearch.toLowerCase())
                    )
                  : items;
                if (!filtered.length) return null;
                const meta = SOURCE_META[source] || { label: source };
                return (
                  <React.Fragment key={source}>
                    <div className="pv-wizard-src-head">
                      <span className="pv-wizard-src-label">{meta.label}</span>
                      <span className="pv-wizard-src-count">{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
                    </div>
                    {filtered.map(item => {
                      const isPicked = pickedSuggestionIds.has(item.id);
                      const signal = suggestionSignal(item);
                      return (
                        <button
                          key={item.id}
                          onClick={() => togglePickedSuggestion(item.id)}
                          className={`pv-wizard-board-row${isPicked ? ' is-selected' : ''}`}
                        >
                          <span className={`pv-wizard-row-checkbox${isPicked ? ' is-checked' : ''}`} aria-hidden="true">
                            {isPicked ? '✓' : ''}
                          </span>
                          <span className="pv-wizard-board-row-body">
                            <span className="pv-wizard-board-row-head">
                              <span className="pv-wizard-board-row-title">{item.name}</span>
                              {signal && (
                                <span className={`pv-wizard-row-priority ${signal.cls}`}>{signal.text}</span>
                              )}
                            </span>
                            <span className="pv-wizard-board-row-meta">
                              {item.department && (
                                <span className="pv-wizard-row-tag">{item.department}</span>
                              )}
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

      {/* CTA footer — single primary button for boards/orders; two-button
          row (Add selected + Add all) on suggestions. */}
      {(tab === 'boards' || tab === 'orders') && (
        <div className="pv-wizard-cta-footer">
          <button
            onClick={handleApply}
            disabled={!hasSelection || applying}
            className="pv-wizard-btn pv-wizard-btn-primary is-block"
            style={applying ? { opacity: 0.7 } : null}
          >
            {applying
              ? 'Loading items…'
              : hasSelection
                ? (tab === 'boards' && boardsToggle === 'templates'
                    ? `Use this template`
                    : tab === 'boards'
                      ? `Copy this board`
                      : `Use this order`)
                : (tab === 'boards' && boardsToggle === 'templates'
                    ? 'Select a template'
                    : tab === 'boards'
                      ? 'Select a board'
                      : 'Select an order')}
          </button>
        </div>
      )}

      {tab === 'suggestions' && allSuggestionItems.length > 0 && (
        <div className="pv-wizard-cta-footer">
          <div className="pv-wizard-cta-footer-bar">
            <button
              onClick={() => handleSuggestionsApply(pickedSuggestionItems)}
              disabled={pickedSuggestionItems.length === 0}
              className="pv-wizard-btn pv-wizard-btn-primary"
            >
              {pickedSuggestionItems.length > 0
                ? `Add selected (${pickedSuggestionItems.length})`
                : 'Select suggestions'}
            </button>
            <button
              onClick={() => handleSuggestionsApply(allSuggestionItems)}
              className="pv-wizard-btn-secondary"
            >
              Add all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { formatDate } from '../../utils/dateFormat';
import { getAllItems, setItemsAttentionHidden } from '../inventory/utils/inventoryStorage';
import PushToBoardModal from '../inventory/components/PushToBoardModal';
import EditorialDatePicker from '../../components/editorial/EditorialDatePicker';
import '../../styles/editorial.css';
import './attention.css';

const DAY = 24 * 60 * 60 * 1000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

const isHidden = (i) => !!(i?.customFields || i?.custom_fields || {}).attention_hidden;
const qtyOf = (i) => Number(i?.totalQty ?? i?.quantity ?? 0) || 0;
const shortfall = (i) => (i?.restockLevel != null ? Math.max(1, i.restockLevel - qtyOf(i)) : 1);
const expDate = (i) => { const e = i?.expiryDate ? new Date(i.expiryDate) : null; return e && !Number.isNaN(e.getTime()) ? e : null; };

// One bucket per item, by urgency: expired → below par → expiring (≤30 days).
const bucketOf = (i, today) => {
  const exp = expDate(i);
  if (exp && exp < today) return 'expired';
  const belowPar = !!i?.restockEnabled && i?.restockLevel != null && qtyOf(i) <= i.restockLevel;
  if (belowPar) return 'belowpar';
  if (exp) { const days = Math.ceil((exp - today) / DAY); if (days >= 0 && days <= 30) return 'expiring'; }
  return null;
};

const SECTIONS = [
  { key: 'expired', label: 'Expired', icon: 'AlertTriangle', tone: 'red' },
  { key: 'belowpar', label: 'Below par', icon: 'TrendingDown', tone: 'amber' },
  { key: 'expiring', label: 'Expiring soon', icon: 'Clock', tone: 'blue' },
];
const SORTS = [
  { value: 'date', label: 'Urgency' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'location', label: 'Location' },
  { value: 'qty', label: 'Quantity (low first)' },
  { value: 'dept', label: 'Department' },
];
const TYPE_LABEL = { expired: 'Expired', belowpar: 'Below par', expiring: 'Expiring soon' };

// Cargo-styled dropdown field (button + floating menu), single- or multi-select.
const FDropdown = ({ id, placeholder, value, options, multi, ddOpen, setDDOpen, onPick }) => {
  const open = ddOpen === id;
  const display = multi
    ? (value.size === 0 || value.size === options.length ? placeholder : options.filter((o) => value.has(o.value)).map((o) => o.label).join(', '))
    : (options.find((o) => o.value === value)?.label || placeholder);
  return (
    <div className="att-fdd">
      <button type="button" className={`att-fdd-btn${open ? ' open' : ''}`} onClick={() => setDDOpen(open ? null : id)}>
        <span className="att-fdd-val">{display}</span>
        <Icon name="ChevronDown" size={15} className={`att-caret${open ? ' open' : ''}`} />
      </button>
      {open && (
        <div className="att-fdd-menu">
          {options.map((o) => {
            const active = multi ? value.has(o.value) : value === o.value;
            return (
              <button type="button" key={o.value} className={`att-fdd-item${active ? ' on' : ''}`} onClick={() => { onPick(o.value); if (!multi) setDDOpen(null); }}>
                <span>{o.label}</span>
                {active && <Icon name="Check" size={15} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const InventoryAttention = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState(null); // null = loading
  const [selected, setSelected] = useState(() => new Set());
  const [showPush, setShowPush] = useState(false);
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [loc, setLoc] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateMode, setDateMode] = useState('dates'); // 'dates' | 'years'
  const [types, setTypes] = useState(() => new Set(['expired', 'belowpar', 'expiring']));
  const [sortBy, setSortBy] = useState('date');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [openMenu, setOpenMenu] = useState(null); // 'filter' | 'sort' | null
  const [ddOpen, setDDOpen] = useState(null); // which filter sub-dropdown is open
  const [showHidden, setShowHidden] = useState(false);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    let alive = true;
    getAllItems().then((all) => { if (alive) setItems(Array.isArray(all) ? all : []); }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  const departments = useMemo(() => {
    const s = new Set((items || []).map((i) => i?.location).filter(Boolean));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Distinct location segments (e.g. "Grab Bag", "IV Bag") within the chosen
  // department — the useful "which bag / area" filter.
  const locations = useMemo(() => {
    const s = new Set();
    (items || []).forEach((i) => {
      if (dept && i?.location !== dept) return;
      String(i?.subLocation || '').split(' > ').map((x) => x.trim()).filter(Boolean).forEach((seg) => s.add(seg));
    });
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [items, dept]);

  // Distinct expiry years present in the data (for the year-range filter).
  const expiryYears = useMemo(() => {
    const s = new Set();
    (items || []).forEach((i) => { const e = expDate(i); if (e) s.add(e.getFullYear()); });
    return [...s].sort((a, b) => a - b);
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = fromDate ? new Date(fromDate) : null;
    const to = toDate ? new Date(toDate) : null;
    if (to) to.setHours(23, 59, 59, 999);
    return (items || []).filter((i) => {
      // Hidden items only appear in the "hidden" view; normally they're excluded.
      if (showHidden ? !isHidden(i) : isHidden(i)) return false;
      if (dept && i?.location !== dept) return false;
      if (loc && !String(i?.subLocation || '').split(' > ').map((x) => x.trim()).includes(loc)) return false;
      // Expiry date range applies only to items that have an expiry (below-par
      // items with no expiry pass through — that's a quantity concern).
      if (from || to) {
        const e = expDate(i);
        if (e) {
          if (from && e < from) return false;
          if (to && e > to) return false;
        }
      }
      if (q) {
        const hay = `${i?.name || ''} ${i?.location || ''} ${i?.subLocation || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, dept, loc, fromDate, toDate, showHidden]);

  const hiddenCount = useMemo(() => (items || []).filter(isHidden).length, [items]);

  const buckets = useMemo(() => {
    const today = startOfToday();
    const out = { expired: [], belowpar: [], expiring: [] };
    filtered.forEach((i) => { const b = bucketOf(i, today); if (b) out[b].push(i); });
    const cmp = {
      date: (a, b) => (expDate(a)?.getTime() || 0) - (expDate(b)?.getTime() || 0),
      name: (a, b) => (a?.name || '').localeCompare(b?.name || ''),
      location: (a, b) => `${a?.location} ${a?.subLocation}`.localeCompare(`${b?.location} ${b?.subLocation}`),
      qty: (a, b) => qtyOf(a) - qtyOf(b),
      dept: (a, b) => (a?.location || '').localeCompare(b?.location || ''),
    }[sortBy] || (() => 0);
    out.expired.sort(cmp);
    out.expiring.sort(cmp);
    out.belowpar.sort(sortBy === 'date' ? (a, b) => shortfall(b) - shortfall(a) : cmp);
    return out;
  }, [filtered, sortBy]);

  const counts = { expired: buckets.expired.length, belowpar: buckets.belowpar.length, expiring: buckets.expiring.length };
  const total = counts.expired + counts.belowpar + counts.expiring;
  const visibleTotal = SECTIONS.reduce((s, sec) => s + (types.has(sec.key) ? buckets[sec.key].length : 0), 0);
  const filterCount = (dept ? 1 : 0) + (loc ? 1 : 0) + (types.size < 3 ? 1 : 0) + ((fromDate || toDate) ? 1 : 0);
  const clearFilters = () => { setDept(''); setLoc(''); setFromDate(''); setToDate(''); setTypes(new Set(['expired', 'belowpar', 'expiring'])); };
  const byId = useMemo(() => { const m = new Map(); (items || []).forEach((i) => m.set(i.id, i)); return m; }, [items]);

  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroup = (list) => setSelected((prev) => {
    const n = new Set(prev);
    const allSel = list.length > 0 && list.every((i) => n.has(i.id));
    list.forEach((i) => { if (allSel) n.delete(i.id); else n.add(i.id); });
    return n;
  });
  const toggleSection = (key) => setCollapsed((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const selectedItems = useMemo(
    () => [...selected].map((id) => byId.get(id)).filter(Boolean).map((i) => ({ ...i, suggestedQty: shortfall(i) })),
    [selected, byId],
  );

  // Hide (or unhide) selected items from this list — keeps their expiry & data.
  const handleToggleHidden = async () => {
    const chosen = [...selected].map((id) => byId.get(id)).filter(Boolean);
    if (!chosen.length || hiding) return;
    const hide = !showHidden; // in the hidden view the action un-hides
    setHiding(true);
    const ok = await setItemsAttentionHidden(chosen, hide);
    setHiding(false);
    if (ok) {
      const touched = new Set(chosen.map((i) => i.id));
      setItems((prev) => (prev || []).map((i) => (touched.has(i.id)
        ? { ...i, customFields: (() => { const cf = { ...(i.customFields || {}) }; if (hide) cf.attention_hidden = true; else delete cf.attention_hidden; return cf; })() }
        : i)));
      setSelected(new Set());
      window.showToast?.(`${chosen.length} item${chosen.length === 1 ? '' : 's'} ${hide ? 'hidden from this list' : 'restored'}`, 'success');
    } else {
      window.showToast?.('Couldn’t update — try again', 'error');
    }
  };

  const metricFor = (i, key) => (key === 'belowpar'
    ? `${qtyOf(i)} / ${i?.restockLevel}${i?.unit ? ` ${i.unit}` : ''}`
    : (expDate(i) ? formatDate(i.expiryDate) : '—'));

  return (
    <div className="att-page">
      <Header />
      <div className="att-wrap">
        <button onClick={() => navigate('/inventory')} className="att-back">
          <Icon name="ArrowLeft" size={14} /> Back to inventory
        </button>

        <p className="editorial-meta att-meta">
          <span className="dot">●</span>
          <span>{items === null ? '…' : counts.expired} EXPIRED</span>
          <span className="bar" />
          <span className="muted">{items === null ? '…' : counts.belowpar} BELOW PAR</span>
          <span className="bar" />
          <span className="muted">{items === null ? '…' : counts.expiring} EXPIRING</span>
        </p>
        <h1 className="editorial-greeting">
          ATTENTION<span className="period">,</span> <em>{total === 0 ? 'all clear' : 'act now'}</em><span className="period">.</span>
        </h1>

        {items !== null && (items.length > 0) && (
          <div className="att-toolbar">
            <div className="att-searchwrap">
              <Icon name="Search" size={16} />
              <input
                className="att-search"
                placeholder="Search name or location…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && <button className="att-clearsearch" onClick={() => setSearch('')} aria-label="Clear"><Icon name="X" size={14} /></button>}
            </div>
            <div className="att-selects">
              <div className="att-toolwrap">
                <button className={`att-tool${filterCount ? ' on' : ''}`} onClick={() => setOpenMenu(openMenu === 'filter' ? null : 'filter')}>
                  <Icon name="SlidersHorizontal" size={15} /> Filter
                  {filterCount > 0 && <span className="att-tool-count">{filterCount}</span>}
                </button>
                {openMenu === 'filter' && (
                  <div className="att-menu att-filterpanel">
                    <div className="att-fgroup">
                      <p className="att-flabel">Type</p>
                      <FDropdown
                        id="type" placeholder="All types" multi value={types}
                        options={SECTIONS.map((s) => ({ value: s.key, label: TYPE_LABEL[s.key] }))}
                        ddOpen={ddOpen} setDDOpen={setDDOpen}
                        onPick={(v) => setTypes((prev) => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n.size === 0 ? prev : n; })}
                      />
                    </div>
                    <div className="att-fgroup">
                      <p className="att-flabel">Department</p>
                      <FDropdown
                        id="dept" placeholder="All departments" value={dept}
                        options={[{ value: '', label: 'All departments' }, ...departments.map((d) => ({ value: d, label: d }))]}
                        ddOpen={ddOpen} setDDOpen={setDDOpen}
                        onPick={(v) => { setDept(v); setLoc(''); }}
                      />
                    </div>
                    {locations.length > 0 && (
                      <div className="att-fgroup">
                        <p className="att-flabel">Location / bag</p>
                        <FDropdown
                          id="loc" placeholder="All locations" value={loc}
                          options={[{ value: '', label: 'All locations' }, ...locations.map((l) => ({ value: l, label: l }))]}
                          ddOpen={ddOpen} setDDOpen={setDDOpen}
                          onPick={(v) => setLoc(v)}
                        />
                      </div>
                    )}
                    <div className="att-fgroup">
                      <div className="att-fhead">
                        <p className="att-flabel">{dateMode === 'years' ? 'Expiry year range' : 'Expiry between'}</p>
                        <div className="att-fmode">
                          <button type="button" className={dateMode === 'dates' ? 'on' : ''} onClick={() => setDateMode('dates')}>Dates</button>
                          <button type="button" className={dateMode === 'years' ? 'on' : ''} onClick={() => setDateMode('years')}>Years</button>
                        </div>
                      </div>
                      {dateMode === 'dates' ? (
                        <div className="att-fdates">
                          <EditorialDatePicker value={fromDate} onChange={setFromDate} placeholder="From" ariaLabel="From date" rangeStart={toDate} />
                          <span className="att-fdate-sep">→</span>
                          <EditorialDatePicker value={toDate} onChange={setToDate} placeholder="To" ariaLabel="To date" rangeStart={fromDate} />
                        </div>
                      ) : (
                        <div className="att-fdates">
                          <FDropdown
                            id="fromyear" placeholder="From year" value={fromDate ? String(new Date(fromDate).getFullYear()) : ''}
                            options={[{ value: '', label: 'Any' }, ...expiryYears.map((y) => ({ value: String(y), label: String(y) }))]}
                            ddOpen={ddOpen} setDDOpen={setDDOpen}
                            onPick={(v) => setFromDate(v ? `${v}-01-01` : '')}
                          />
                          <span className="att-fdate-sep">→</span>
                          <FDropdown
                            id="toyear" placeholder="To year" value={toDate ? String(new Date(toDate).getFullYear()) : ''}
                            options={[{ value: '', label: 'Any' }, ...expiryYears.map((y) => ({ value: String(y), label: String(y) }))]}
                            ddOpen={ddOpen} setDDOpen={setDDOpen}
                            onPick={(v) => setToDate(v ? `${v}-12-31` : '')}
                          />
                        </div>
                      )}
                    </div>
                    {filterCount > 0 && (
                      <button className="att-fclear" onClick={clearFilters}>Clear filters</button>
                    )}
                  </div>
                )}
              </div>
              {(hiddenCount > 0 || showHidden) && (
                <button className={`att-tool${showHidden ? ' on' : ''}`} onClick={() => { setShowHidden((v) => !v); setSelected(new Set()); }} title="Items you've hidden from this list">
                  <Icon name={showHidden ? 'Eye' : 'EyeOff'} size={15} /> Hidden
                  {hiddenCount > 0 && <span className="att-tool-count">{hiddenCount}</span>}
                </button>
              )}
              <div className="att-toolwrap">
                <button className="att-tool" onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')}>
                  <Icon name="ArrowUpDown" size={15} /> Sort
                  <Icon name="ChevronDown" size={13} className={openMenu === 'sort' ? 'att-caret open' : 'att-caret'} />
                </button>
                {openMenu === 'sort' && (
                  <div className="att-menu">
                    {SORTS.map((s) => (
                      <button key={s.value} className={`att-menu-item${sortBy === s.value ? ' on' : ''}`} onClick={() => { setSortBy(s.value); setOpenMenu(null); }}>
                        {s.label}{sortBy === s.value && <Icon name="Check" size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {items === null ? (
          <p className="att-loading">Loading…</p>
        ) : visibleTotal === 0 ? (
          <p className="att-empty">
            {showHidden
              ? 'Nothing hidden.'
              : (total === 0 && !search && !dept && !loc && !fromDate && !toDate
                ? 'Nothing expired, expiring within 30 days, or below par. Everything’s in good shape.'
                : 'No matches — try clearing the search or filters.')}
          </p>
        ) : (
          SECTIONS.map(({ key, label, icon, tone }) => {
            if (!types.has(key)) return null;
            const list = buckets[key];
            if (!list.length) return null;
            const isCollapsed = collapsed.has(key);
            const allSel = list.every((i) => selected.has(i.id));
            const selHere = list.filter((i) => selected.has(i.id)).length;
            return (
              <section className="att-sec" key={key}>
                <div className="att-sec-h">
                  <button className="att-sec-toggle" onClick={() => toggleSection(key)}>
                    <Icon name="ChevronRight" size={16} className={`att-chevron${isCollapsed ? '' : ' open'}`} />
                    <span className={`att-sec-title tone-${tone}`}><Icon name={icon} size={15} /> {label}</span>
                    <span className="att-count">{list.length}</span>
                    {selHere > 0 && <span className="att-selhere">{selHere} selected</span>}
                  </button>
                  <button className="att-selall" onClick={() => toggleGroup(list)}>{allSel ? 'Deselect all' : 'Select all'}</button>
                </div>
                {!isCollapsed && (
                  <div className="att-list">
                    {list.map((i) => (
                      <label className={`att-row${selected.has(i.id) ? ' on' : ''}`} key={i.id}>
                        <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                        <span className="att-name">{i.name}</span>
                        <span className="att-loc">{[i.location, i.subLocation].filter(Boolean).join(' › ')}</span>
                        <span className={`att-metric tone-${tone}`}>{metricFor(i, key)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>

      {openMenu && <div className="att-menu-backdrop" onClick={() => { setOpenMenu(null); setDDOpen(null); }} />}

      {selected.size > 0 && (
        <div className="att-bar">
          <span className="att-bar-count">{selected.size} selected</span>
          <div className="att-bar-actions">
            <button className="att-bar-ghost" onClick={() => setSelected(new Set())}>Clear</button>
            <button className="att-bar-alt" onClick={handleToggleHidden} disabled={hiding} title={showHidden ? 'Restore these to the list' : 'Hide these from this list (keeps their expiry)'}>
              <Icon name={showHidden ? 'Eye' : 'EyeOff'} size={15} /> {hiding ? 'Updating…' : (showHidden ? 'Unhide' : 'Hide from list')}
            </button>
            <button className="att-bar-prim" onClick={() => setShowPush(true)}>
              <Icon name="ShoppingCart" size={15} /> Push to provisioning
            </button>
          </div>
        </div>
      )}

      {showPush && (
        <PushToBoardModal
          items={selectedItems}
          onClose={() => setShowPush(false)}
          onDone={() => { setSelected(new Set()); }}
        />
      )}
    </div>
  );
};

export default InventoryAttention;

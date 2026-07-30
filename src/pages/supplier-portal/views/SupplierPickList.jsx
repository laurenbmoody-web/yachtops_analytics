// Pick list — pro-grade picking tool.
//
// The supplier's shelf-side view of one order. Two modes:
//   • List   — everything at a glance, grouped To-pick / Issues / Picked,
//              sortable (pick-path by shelf location, category, name, status)
//              and searchable.
//   • Guided — one line at a time, big touch targets, for a phone walking the
//              shelves. Pick full / short / skip / substitute, next-prev.
//
// Counting is by tap (✓ full), − / +, tap-to-type, or barcode scan. Shorts and
// substitutes carry a structured reason. A review step summarises exceptions
// before "Mark packed". Shelf locations are editable inline and persist on the
// catalogue, so the pick path improves every order.
//
// Scan-to-pick uses the native BarcodeDetector API where available.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { dateLocale } from '../../../utils/dateFormat';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ScanBarcode, PackageCheck, Check, List, Focus,
  ChevronLeft, ChevronRight, MapPin, Undo2, Search, X, SkipForward, Replace,
} from 'lucide-react';
import {
  fetchOrderById,
  fetchOrderItemsForPicking,
  setItemPicked,
  setCatalogueShelfLocation,
  updateOrderStatus,
} from '../utils/supplierStorage';
import { categoryHue } from '../../../utils/catalogueConstants';
import './pick-list.css';

const PICKABLE_STATUS = 'confirmed';

// Structured short-pick / substitute reasons — shown to the yacht.
const PICK_REASONS = [
  { code: 'out_of_stock', label: 'Out of stock' },
  { code: 'damaged',      label: 'Damaged' },
  { code: 'short_dated',  label: 'Short-dated' },
  { code: 'quality',      label: 'Quality issue' },
  { code: 'substituted',  label: 'Substitute sent' },
  { code: 'other',        label: 'Other' },
];
const reasonLabel = (code) => PICK_REASONS.find((r) => r.code === code)?.label || code;

const SORTS = [
  { key: 'path',     label: 'Pick path' },
  { key: 'category', label: 'Category' },
  { key: 'name',     label: 'Name' },
  { key: 'status',   label: 'Status' },
];

// Natural-ish compare for shelf codes ("A-2" before "A-10").
const cmpLoc = (a, b) => {
  const la = (a || '').toString(); const lb = (b || '').toString();
  if (!la && !lb) return 0;
  if (!la) return 1;           // unlocated sink to the bottom of the path
  if (!lb) return -1;
  return la.localeCompare(lb, undefined, { numeric: true, sensitivity: 'base' });
};

const lineState = (it) => {
  const qty = Number(it.quantity) || 0;
  const picked = it.picked_qty != null ? Number(it.picked_qty) : null;
  if (picked == null) return it.pick_skipped ? 'skipped' : 'todo';
  if (picked >= qty && !it.pick_exception) return 'full';
  return 'short'; // short covers partials, zeros, and exception picks
};

const SupplierPickList = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [packing, setPacking] = useState(false);
  const [flashId, setFlashId] = useState(null);

  const [view, setView] = useState('list');       // 'list' | 'guided'
  const [sortMode, setSortMode] = useState('path');
  const [query, setQuery] = useState('');
  const [guidedIdx, setGuidedIdx] = useState(0);
  const [editQtyId, setEditQtyId] = useState(null);
  const [reasonItem, setReasonItem] = useState(null); // item currently in the reason sheet
  const [reviewOpen, setReviewOpen] = useState(false);
  const historyRef = useRef([]);                   // undo stack of prior item snapshots
  const [canUndo, setCanUndo] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanSupported, setScanSupported] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);
  const lastScanRef = useRef({ code: null, at: 0 });

  useEffect(() => {
    setScanSupported(typeof window !== 'undefined' && 'BarcodeDetector' in window);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [o, lines] = await Promise.all([
          fetchOrderById(orderId),
          fetchOrderItemsForPicking(orderId),
        ]);
        if (!live) return;
        setOrder(o);
        setItems(lines);
        if (['confirmed', 'partially_confirmed'].includes(o.status)) {
          updateOrderStatus(orderId, 'picking').catch(() => {});
        }
      } catch (e) {
        if (live) setError(e.message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [orderId]);

  const pickable = useMemo(() => items.filter((i) => i.status === PICKABLE_STATUS), [items]);
  const others = useMemo(() => items.filter((i) => i.status !== PICKABLE_STATUS), [items]);

  // ── Sort + search ──────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const arr = [...pickable];
    arr.sort((a, b) => {
      switch (sortMode) {
        case 'path':     return cmpLoc(a.catalogue?.shelf_location, b.catalogue?.shelf_location)
                              || (a.item_name || '').localeCompare(b.item_name || '');
        case 'category': return (a.catalogue?.category || 'zzz').localeCompare(b.catalogue?.category || 'zzz')
                              || (a.item_name || '').localeCompare(b.item_name || '');
        case 'status': {
          const rank = { todo: 0, skipped: 1, short: 2, full: 3 };
          return (rank[lineState(a)] - rank[lineState(b)])
              || (a.item_name || '').localeCompare(b.item_name || '');
        }
        default:         return (a.item_name || '').localeCompare(b.item_name || '');
      }
    });
    return arr;
  }, [pickable, sortMode]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((i) =>
      (i.item_name || '').toLowerCase().includes(q)
      || (i.catalogue?.barcode || '').includes(q)
      || (i.catalogue?.shelf_location || '').toLowerCase().includes(q));
  }, [sorted, query]);

  // Grouped for the list view (respects sort + search).
  const groups = useMemo(() => {
    const todo = [], issues = [], done = [];
    for (const it of visible) {
      const s = lineState(it);
      if (s === 'full') done.push(it);
      else if (s === 'short') issues.push(it);
      else if (s === 'skipped') issues.push(it);
      else todo.push(it);
    }
    return { todo, issues, done };
  }, [visible]);

  // The guided queue: unresolved lines in sort order (todo + skipped).
  const queue = useMemo(
    () => sorted.filter((i) => i.picked_qty == null),
    [sorted],
  );

  // ── Counts ─────────────────────────────────────────────────────────────
  const totalLines = pickable.length;
  const resolvedLines = pickable.filter((i) => i.picked_qty != null).length;
  const shortLines = pickable.filter((i) => lineState(i) === 'short').length;
  const skippedLines = pickable.filter((i) => lineState(i) === 'skipped').length;
  const totalUnits = pickable.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  const pickedUnits = pickable.reduce(
    (s, i) => s + Math.min(Number(i.picked_qty) || 0, Number(i.quantity) || 0), 0);
  const allResolved = totalLines > 0 && resolvedLines === totalLines;
  const pct = totalLines ? Math.round((resolvedLines / totalLines) * 100) : 0;

  const patch = (updated) => setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)));

  const pushHistory = (item) => {
    historyRef.current.push({
      id: item.id,
      picked_qty: item.picked_qty ?? null,
      pick_note: item.pick_note ?? null,
      pick_exception: item.pick_exception ?? null,
      pick_skipped: item.pick_skipped ?? false,
    });
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(true);
  };

  // Central mutation — snapshots for undo, writes, patches.
  const commit = async (item, qty, opts = {}) => {
    pushHistory(item);
    try {
      const clamped = qty == null ? null : Math.max(0, qty);
      const updated = await setItemPicked(item.id, clamped, opts);
      patch(updated);
      return updated;
    } catch (e) {
      setError(e.message);
    }
  };

  const bump = (item, delta) => {
    const current = item.picked_qty != null ? Number(item.picked_qty) : 0;
    commit(item, current + delta, { skipped: false });
  };
  const pickAll = (item) => {
    const full = lineState(item) === 'full';
    commit(item, full ? null : Number(item.quantity), { exception: null, note: null, skipped: false });
  };
  const setTypedQty = (item, value) => {
    setEditQtyId(null);
    const n = value === '' || value == null ? null : Math.max(0, Math.min(Number(value) || 0, 9999));
    commit(item, n, { skipped: false });
  };
  const skip = (item) => commit(item, null, { skipped: true });
  const undo = async () => {
    const prev = historyRef.current.pop();
    setCanUndo(historyRef.current.length > 0);
    if (!prev) return;
    try {
      const updated = await setItemPicked(prev.id, prev.picked_qty, {
        note: prev.pick_note, exception: prev.pick_exception, skipped: prev.pick_skipped,
      });
      patch(updated);
    } catch (e) { setError(e.message); }
  };

  // ── Scan-to-pick ───────────────────────────────────────────────────────
  const stopScan = () => {
    if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };
  const startScan = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      setScanning(true);
      requestAnimationFrame(async () => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
        const loop = async () => {
          if (!streamRef.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length) handleScannedCode(codes[0].rawValue);
          } catch { /* frame not ready */ }
          scanLoopRef.current = requestAnimationFrame(loop);
        };
        loop();
      });
    } catch {
      setError('Camera unavailable — check permissions, or tap quantities instead.');
      setScanning(false);
    }
  };
  const handleScannedCode = (code) => {
    const now = Date.now();
    if (lastScanRef.current.code === code && now - lastScanRef.current.at < 1600) return;
    lastScanRef.current = { code, at: now };
    setItems((prev) => {
      const line = prev.find((i) => i.status === PICKABLE_STATUS && i.catalogue?.barcode === code);
      if (!line) return prev;
      const current = line.picked_qty != null ? Number(line.picked_qty) : 0;
      const next = Math.min(current + 1, Number(line.quantity));
      if (next !== current) {
        setFlashId(line.id);
        setTimeout(() => setFlashId(null), 1000);
        if (navigator.vibrate) navigator.vibrate(60);
        pushHistory(line);
        setItemPicked(line.id, next, { skipped: false }).catch(() => {});
        return prev.map((i) => (i.id === line.id
          ? { ...i, picked_qty: next, picked_at: new Date().toISOString(), pick_skipped: false } : i));
      }
      return prev;
    });
  };
  useEffect(() => () => stopScan(), []);

  // ── Shelf location (inline edit, persists on the catalogue) ─────────────
  const editShelf = async (item) => {
    if (!item.catalogue?.id) { setError('This line has no catalogue product to locate.'); return; }
    const loc = window.prompt('Shelf / bin location (e.g. A-12, Cold-3)', item.catalogue.shelf_location || '');
    if (loc === null) return;
    try {
      const updated = await setCatalogueShelfLocation(item.catalogue.id, loc);
      // Reflect on every line sharing this catalogue product.
      setItems((prev) => prev.map((i) => (i.catalogue?.id === updated.id
        ? { ...i, catalogue: { ...i.catalogue, shelf_location: updated.shelf_location } } : i)));
    } catch (e) { setError(e.message); }
  };

  const markPacked = async () => {
    setPacking(true);
    try {
      await updateOrderStatus(orderId, 'packed');
      navigate(`/supplier/orders/${orderId}`);
    } catch (e) {
      setError(e.message);
      setPacking(false);
    }
  };

  if (loading) {
    return <div className="sp-page"><div className="spk-loading">Loading pick list…</div></div>;
  }

  const deliverLine = (
    <>Deliver <b>{order?.delivery_date ? new Date(order.delivery_date).toLocaleDateString(dateLocale()) : 'TBC'}</b>
      {order?.delivery_time ? <> at <b>{String(order.delivery_time).slice(0, 5)}</b></> : null}
      {order?.delivery_port ? <> · <b>{order.delivery_port}</b></> : null}</>
  );

  return (
    <div className="sp-page spk-root">
      {/* Sticky top bar: back · progress · view toggle · scan */}
      <div className="spk-topbar">
        <button className="spk-back" onClick={() => navigate(`/supplier/orders/${orderId}`)}>
          <ArrowLeft size={13} /> Back to order
        </button>
        <div className="spk-progress-wrap">
          <div className="spk-progress-label">
            <span>{resolvedLines} of {totalLines} lines · {pickedUnits}/{totalUnits} units
              {shortLines ? ` · ${shortLines} short` : ''}{skippedLines ? ` · ${skippedLines} skipped` : ''}</span>
            <span>{pct}%</span>
          </div>
          <div className={`spk-progress ${allResolved ? 'done' : ''}`}>
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="spk-topbar-actions">
          <div className="spk-viewtoggle" role="tablist" aria-label="View">
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} role="tab" aria-selected={view === 'list'}>
              <List size={14} /> List
            </button>
            <button className={view === 'guided' ? 'on' : ''} onClick={() => { setView('guided'); setGuidedIdx(0); }} role="tab" aria-selected={view === 'guided'}>
              <Focus size={14} /> Guided
            </button>
          </div>
          {scanSupported && (
            <button className={`spk-scanbtn ${scanning ? 'active' : ''}`} onClick={scanning ? stopScan : startScan}>
              <ScanBarcode size={15} /> {scanning ? 'Stop' : 'Scan'}
            </button>
          )}
        </div>
      </div>

      <div className="sp-page-head spk-head">
        <div>
          <div className="sp-eyebrow">Picking</div>
          <h1 className="sp-page-title">Pick <em>{order?.vessel_name || 'order'}</em></h1>
          <p className="spk-meta">{deliverLine}</p>
        </div>
      </div>

      {error && <div className="spk-error" onClick={() => setError(null)}>{error} <X size={12} /></div>}

      {scanning && (
        <div className={`spk-scanner ${flashId ? 'spk-flash' : ''}`}>
          <video ref={videoRef} muted playsInline />
          <div className="spk-scanline" />
          <div className="spk-scanhint">Point at a product barcode — each scan picks one unit</div>
        </div>
      )}

      {/* List view */}
      {view === 'list' && (
        <>
          <div className="spk-controls">
            <div className="spk-sort">
              {SORTS.map((s) => (
                <button key={s.key} className={sortMode === s.key ? 'on' : ''} onClick={() => setSortMode(s.key)}>
                  {s.key === 'path' && <MapPin size={11} />}{s.label}
                </button>
              ))}
            </div>
            <div className="spk-search">
              <Search size={13} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an item, barcode or shelf…" />
              {query && <button onClick={() => setQuery('')} aria-label="Clear"><X size={12} /></button>}
            </div>
            <button className="spk-undo" onClick={undo} disabled={!canUndo}><Undo2 size={13} /> Undo</button>
          </div>

          <div className="spk-list">
            {groups.todo.length > 0 && <SectionHead label="To pick" count={groups.todo.length} />}
            {groups.todo.map((item) => (
              <PickRow key={item.id} item={item} flashId={flashId} editQtyId={editQtyId}
                onBump={bump} onPickAll={pickAll} onEditQty={setEditQtyId} onTypedQty={setTypedQty}
                onReason={() => setReasonItem(item)} onSkip={() => skip(item)} onShelf={() => editShelf(item)} />
            ))}

            {groups.issues.length > 0 && <SectionHead label="Issues" count={groups.issues.length} tone="warn" />}
            {groups.issues.map((item) => (
              <PickRow key={item.id} item={item} flashId={flashId} editQtyId={editQtyId}
                onBump={bump} onPickAll={pickAll} onEditQty={setEditQtyId} onTypedQty={setTypedQty}
                onReason={() => setReasonItem(item)} onSkip={() => skip(item)} onShelf={() => editShelf(item)} />
            ))}

            {groups.done.length > 0 && <SectionHead label="Picked" count={groups.done.length} tone="done" />}
            {groups.done.map((item) => (
              <PickRow key={item.id} item={item} flashId={flashId} editQtyId={editQtyId}
                onBump={bump} onPickAll={pickAll} onEditQty={setEditQtyId} onTypedQty={setTypedQty}
                onReason={() => setReasonItem(item)} onSkip={() => skip(item)} onShelf={() => editShelf(item)} />
            ))}

            {others.map((item) => (
              <div key={item.id} className="spk-line is-muted">
                <span className="spk-thumb-ph" style={{ background: '#CBD5E1' }}>{(item.item_name || '?').charAt(0).toUpperCase()}</span>
                <div className="spk-line-main">
                  <div className="spk-line-name">{item.item_name}</div>
                  <div className="spk-line-muted">
                    {item.status === 'unavailable' ? 'Marked unavailable — nothing to pick'
                      : item.status === 'substituted' ? `Substituted: ${item.substitute_description || 'see order'}`
                      : 'Awaiting confirmation — not on this pick'}
                  </div>
                </div>
              </div>
            ))}

            {totalLines === 0 && (
              <div className="spk-empty">No confirmed lines to pick yet — confirm lines on the order first.</div>
            )}
            {totalLines > 0 && visible.length === 0 && (
              <div className="spk-empty">Nothing matches “{query}”.</div>
            )}
          </div>
        </>
      )}

      {/* Guided view */}
      {view === 'guided' && (
        <GuidedPicker
          queue={queue}
          sorted={sorted}
          idx={guidedIdx}
          setIdx={setGuidedIdx}
          onBump={bump}
          onPickAll={pickAll}
          onTypedQty={setTypedQty}
          onReason={setReasonItem}
          onSkip={skip}
          onShelf={editShelf}
          allResolved={allResolved}
          onReview={() => setReviewOpen(true)}
        />
      )}

      {/* Footer — pack */}
      {totalLines > 0 && view === 'list' && (
        <div className="spk-foot">
          <span className="spk-foot-note">
            {allResolved
              ? (shortLines ? `Ready — ${shortLines} short pick${shortLines === 1 ? '' : 's'} will show on the delivery note.` : 'Everything picked in full.')
              : `${totalLines - resolvedLines} line${totalLines - resolvedLines === 1 ? '' : 's'} still to resolve.`}
          </span>
          <button className="spk-packed" disabled={!allResolved || packing} onClick={() => setReviewOpen(true)}>
            <PackageCheck size={15} /> Review &amp; pack
          </button>
        </div>
      )}

      {/* Reason / substitute sheet */}
      {reasonItem && (
        <ReasonSheet
          item={reasonItem}
          onClose={() => setReasonItem(null)}
          onApply={(qty, exception, note) => { commit(reasonItem, qty, { exception, note, skipped: false }); setReasonItem(null); }}
        />
      )}

      {/* Review & pack */}
      {reviewOpen && (
        <ReviewSheet
          pickable={pickable}
          totalLines={totalLines} resolvedLines={resolvedLines}
          shortLines={shortLines} skippedLines={skippedLines}
          pickedUnits={pickedUnits} totalUnits={totalUnits}
          allResolved={allResolved}
          packing={packing}
          onClose={() => setReviewOpen(false)}
          onConfirm={markPacked}
        />
      )}
    </div>
  );
};

// ── Section header ─────────────────────────────────────────────────────────
const SectionHead = ({ label, count, tone }) => (
  <div className={`spk-sec ${tone || ''}`}><span>{label}</span><span className="spk-sec-count">{count}</span></div>
);

// ── One pick row (list view) ────────────────────────────────────────────────
const PickRow = ({ item, flashId, editQtyId, onBump, onPickAll, onEditQty, onTypedQty, onReason, onSkip, onShelf }) => {
  const qty = Number(item.quantity);
  const picked = item.picked_qty != null ? Number(item.picked_qty) : null;
  const state = lineState(item);
  const cat = item.catalogue;
  const loc = cat?.shelf_location;
  const packBits = cat ? [cat.pack_size ? `${cat.pack_size} × ${cat.pack_unit || ''}`.trim() : null, cat.unit_size].filter(Boolean).join(' · ') : '';
  return (
    <div className={`spk-line state-${state} ${flashId === item.id ? 'flash' : ''}`}>
      <button className={`spk-loc ${loc ? '' : 'unset'}`} onClick={onShelf} title="Set shelf location">
        <MapPin size={11} />{loc || 'Set'}
      </button>
      {cat?.image_url
        ? <img className="spk-thumb" src={cat.image_url} alt="" loading="lazy" />
        : <span className="spk-thumb-ph" style={{ background: categoryHue(cat?.category) }}>{(item.item_name || '?').charAt(0).toUpperCase()}</span>}
      <div className="spk-line-main">
        <div className="spk-line-name">{item.item_name}</div>
        <div className="spk-line-sub">
          {[`${qty} ${item.unit || ''}`.trim(), packBits || null, cat?.barcode ? `EAN ${cat.barcode}` : null].filter(Boolean).join(' · ')}
        </div>
        {state === 'short' && (
          <div className="spk-line-note">
            {item.pick_exception ? reasonLabel(item.pick_exception) : 'Short'}
            {item.pick_note ? ` — ${item.pick_note}` : ''}{' '}
            <a onClick={onReason}>edit</a>
          </div>
        )}
        {state === 'skipped' && <div className="spk-line-note warn">Skipped — come back to this line</div>}
      </div>
      <div className="spk-counter">
        <button onClick={() => onBump(item, -1)} disabled={!picked} aria-label="Minus one">−</button>
        {editQtyId === item.id ? (
          <input
            className="spk-count-input" type="number" min="0" autoFocus defaultValue={picked ?? ''}
            onBlur={(e) => onTypedQty(item, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onTypedQty(item, e.target.value); if (e.key === 'Escape') onEditQty(null); }}
          />
        ) : (
          <button className={`spk-count ${state}`} onClick={() => onEditQty(item.id)} title="Tap to type a quantity">
            {picked != null ? picked : '—'}<small> / {qty}</small>
          </button>
        )}
        <button onClick={() => onBump(item, 1)} disabled={picked != null && picked >= qty} aria-label="Plus one">+</button>
      </div>
      <div className="spk-rowacts">
        <button className={`spk-pickall ${state === 'full' ? 'picked' : ''}`} onClick={() => onPickAll(item)}>
          {state === 'full' ? <><Check size={12} /> Picked</> : 'Pick all'}
        </button>
        <button className="spk-icoact" onClick={onReason} title="Short / substitute"><Replace size={13} /></button>
        {state !== 'skipped' && picked == null && (
          <button className="spk-icoact" onClick={onSkip} title="Skip for now"><SkipForward size={13} /></button>
        )}
      </div>
    </div>
  );
};

// ── Guided picker — one card at a time ───────────────────────────────────────
const GuidedPicker = ({ queue, sorted, idx, setIdx, onBump, onPickAll, onTypedQty, onReason, onSkip, onShelf, allResolved, onReview }) => {
  // When the queue empties, show the done state.
  if (queue.length === 0) {
    return (
      <div className="spk-guided-done">
        <div className="spk-guided-tick"><Check size={30} /></div>
        <div className="spk-guided-done-title">Every line resolved.</div>
        <p>Nothing left in the queue. Review the pick and pack the order.</p>
        <button className="spk-packed" disabled={!allResolved} onClick={onReview}><PackageCheck size={15} /> Review &amp; pack</button>
      </div>
    );
  }
  const pos = Math.min(idx, queue.length - 1);
  const item = queue[pos];
  const qty = Number(item.quantity);
  const picked = item.picked_qty != null ? Number(item.picked_qty) : 0;
  const cat = item.catalogue;
  const loc = cat?.shelf_location;
  const [typing, setTyping] = useState(false);
  const packBits = cat ? [cat.pack_size ? `${cat.pack_size} × ${cat.pack_unit || ''}`.trim() : null, cat.unit_size].filter(Boolean).join(' · ') : '';
  const next = () => setIdx((i) => Math.min(i + 1, queue.length - 1));
  const prev = () => setIdx((i) => Math.max(i - 1, 0));
  const overallPos = sorted.findIndex((s) => s.id === item.id) + 1;

  return (
    <div className="spk-guided">
      <div className="spk-guided-nav">
        <button onClick={prev} disabled={pos === 0} aria-label="Previous"><ChevronLeft size={18} /></button>
        <span>{pos + 1} of {queue.length} to do{overallPos ? ` · line ${overallPos} of ${sorted.length}` : ''}</span>
        <button onClick={next} disabled={pos >= queue.length - 1} aria-label="Next"><ChevronRight size={18} /></button>
      </div>

      <div className="spk-guided-card">
        <button className={`spk-loc big ${loc ? '' : 'unset'}`} onClick={() => onShelf(item)}>
          <MapPin size={14} />{loc ? `Shelf ${loc}` : 'Set shelf location'}
        </button>
        {cat?.image_url
          ? <img className="spk-guided-img" src={cat.image_url} alt="" />
          : <div className="spk-guided-img ph" style={{ background: categoryHue(cat?.category) }}>{(item.item_name || '?').charAt(0).toUpperCase()}</div>}
        <div className="spk-guided-name">{item.item_name}</div>
        <div className="spk-guided-sub">{[packBits || null, cat?.barcode ? `EAN ${cat.barcode}` : null].filter(Boolean).join(' · ')}</div>

        <div className="spk-guided-qtyrow">
          <button className="spk-guided-step" onClick={() => onBump(item, -1)} disabled={!picked} aria-label="Minus one">−</button>
          {typing ? (
            <input className="spk-guided-qtyinput" type="number" min="0" autoFocus defaultValue={item.picked_qty ?? ''}
              onBlur={(e) => { onTypedQty(item, e.target.value); setTyping(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { onTypedQty(item, e.target.value); setTyping(false); } if (e.key === 'Escape') setTyping(false); }} />
          ) : (
            <button className="spk-guided-qty" onClick={() => setTyping(true)} title="Tap to type">
              {item.picked_qty != null ? item.picked_qty : 0}<small> / {qty}</small>
            </button>
          )}
          <button className="spk-guided-step" onClick={() => onBump(item, 1)} disabled={picked >= qty} aria-label="Plus one">+</button>
        </div>

        <div className="spk-guided-actions">
          <button className="spk-guided-primary" onClick={() => { onPickAll(item); next(); }}>
            <Check size={16} /> Pick all {qty}
          </button>
          <div className="spk-guided-secondary">
            <button onClick={() => onReason(item)}><Replace size={14} /> Short / substitute</button>
            <button onClick={() => { onSkip(item); next(); }}><SkipForward size={14} /> Skip</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Reason / substitute sheet ────────────────────────────────────────────────
const ReasonSheet = ({ item, onClose, onApply }) => {
  const qty = Number(item.quantity);
  const [code, setCode] = useState(item.pick_exception || 'out_of_stock');
  const [note, setNote] = useState(item.pick_note || '');
  const [picked, setPicked] = useState(item.picked_qty != null ? Number(item.picked_qty) : 0);
  const isSub = code === 'substituted';
  return (
    <div className="spk-sheet-backdrop" onClick={onClose}>
      <div className="spk-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Short pick reason">
        <div className="spk-sheet-head">
          <div>
            <div className="spk-sheet-eyebrow">Short pick / substitute</div>
            <div className="spk-sheet-title">{item.item_name}</div>
          </div>
          <button className="spk-sheet-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="spk-sheet-label">Reason</div>
        <div className="spk-reasons">
          {PICK_REASONS.map((r) => (
            <button key={r.code} className={code === r.code ? 'on' : ''} onClick={() => setCode(r.code)}>{r.label}</button>
          ))}
        </div>

        <div className="spk-sheet-label">{isSub ? 'Quantity sent' : 'Quantity picked'}</div>
        <div className="spk-sheet-qty">
          <button onClick={() => setPicked((p) => Math.max(0, p - 1))} aria-label="Minus one">−</button>
          <input type="number" min="0" value={picked} onChange={(e) => setPicked(Math.max(0, Number(e.target.value) || 0))} />
          <button onClick={() => setPicked((p) => p + 1)} aria-label="Plus one">+</button>
          <span className="spk-sheet-of">of {qty}</span>
        </div>

        <div className="spk-sheet-label">{isSub ? 'What did you send instead?' : 'Note to the yacht (optional)'}</div>
        <textarea className="spk-sheet-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={isSub ? 'e.g. Sent Manuka honey in place of Provence acacia' : 'Anything the yacht should know'} />

        <div className="spk-sheet-actions">
          <button className="spk-sheet-cancel" onClick={onClose}>Cancel</button>
          <button className="spk-sheet-apply" onClick={() => onApply(picked, code, note.trim() || null)}>Save</button>
        </div>
      </div>
    </div>
  );
};

// ── Review & pack ────────────────────────────────────────────────────────────
const ReviewSheet = ({ pickable, totalLines, resolvedLines, shortLines, skippedLines, pickedUnits, totalUnits, allResolved, packing, onClose, onConfirm }) => {
  const shorts = pickable.filter((i) => lineState(i) === 'short');
  const skips = pickable.filter((i) => lineState(i) === 'skipped');
  return (
    <div className="spk-sheet-backdrop" onClick={onClose}>
      <div className="spk-sheet spk-review" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Review and pack">
        <div className="spk-sheet-head">
          <div>
            <div className="spk-sheet-eyebrow">Review &amp; pack</div>
            <div className="spk-sheet-title">{resolvedLines}/{totalLines} lines · {pickedUnits}/{totalUnits} units</div>
          </div>
          <button className="spk-sheet-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {!allResolved && (
          <div className="spk-review-block warn">
            {totalLines - resolvedLines} line{totalLines - resolvedLines === 1 ? '' : 's'} still unresolved
            {skippedLines ? ` (${skippedLines} skipped)` : ''}. Resolve them before packing.
          </div>
        )}

        {shorts.length > 0 && (
          <div className="spk-review-block">
            <div className="spk-review-h">Short picks ({shorts.length}) — shown on the delivery note</div>
            {shorts.map((i) => (
              <div key={i.id} className="spk-review-row">
                <span className="spk-review-name">{i.item_name}</span>
                <span className="spk-review-meta">
                  {i.picked_qty ?? 0}/{i.quantity} · {i.pick_exception ? reasonLabel(i.pick_exception) : 'short'}
                  {i.pick_note ? ` — ${i.pick_note}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {skips.length > 0 && (
          <div className="spk-review-block warn">
            <div className="spk-review-h">Skipped ({skips.length})</div>
            {skips.map((i) => <div key={i.id} className="spk-review-row"><span className="spk-review-name">{i.item_name}</span></div>)}
          </div>
        )}

        {allResolved && shorts.length === 0 && (
          <div className="spk-review-block ok">Everything picked in full — nothing to flag.</div>
        )}

        <div className="spk-sheet-actions">
          <button className="spk-sheet-cancel" onClick={onClose}>Keep picking</button>
          <button className="spk-packed" disabled={!allResolved || packing} onClick={onConfirm}>
            <PackageCheck size={15} /> {packing ? 'Packing…' : 'Mark packed'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SupplierPickList;

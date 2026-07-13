import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { showToast } from '../../../utils/toast';
import { supabase } from '../../../lib/supabaseClient';
import {
  receiveItems,
  findMatchingInventoryItem,
  pushReceivedSplitsToInventory,
  createInventoryItemFromProvItem,
  searchInventoryItems,
  fetchAllInventoryLocations,
  fetchVesselLocations,
  createDeliveryBatch,
  upsertItems,
  uploadInvoiceFile,
  createLedgerEntry,
  triggerCrossDepartmentMatch,
} from '../utils/provisioningStorage';
import { useAuth } from '../../../contexts/AuthContext';
import { UNIT_GROUPS } from './DetailTableCells';
import { logActivity } from '../../../utils/activityStorage';
import { sendNotification, NOTIFICATION_TYPES, SEVERITY } from '../../team-jobs-management/utils/notifications';
import '../delivery-inbox.css';
import '../../../styles/editorial.css';
import '../provisioning-dashboard.css';
import './receive-delivery-modal.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

const deriveStatus = (qty, ordered) => {
  if (!qty || qty <= 0) return 'not_received';
  if (qty >= ordered) return 'received';
  return 'partial';
};

// Best-confidence ranking — used when two OCR line_items map to the same
// board item (Bug P aggregation). Keeps the strongest signal of the two
// so the confidence chip reflects the better match, not the later one.
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1, none: 0 };
const bestConfidence = (a, b) => (CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b]) ? a : b;

// Robust upload media-type resolution. The old code defaulted to
// 'image/jpeg' when file.type was empty, which mislabelled PDFs from
// pickers that don't populate the MIME (some Linux desktops, certain
// email clients, cloud-storage drag-drops). The edge function then
// labelled the bytes wrong for Azure, which failed cryptically.
// Now: prefer file.type when it's a supported MIME, else infer from
// the filename extension, else return null and refuse the upload.
const SUPPORTED_MIME = {
  'pdf':  'application/pdf',
  'jpg':  'image/jpeg',
  'jpeg': 'image/jpeg',
  'png':  'image/png',
  'webp': 'image/webp',
  'heic': 'image/heic',
};
const SUPPORTED_MIME_VALUES = Object.values(SUPPORTED_MIME);
const resolveMediaType = (file) => {
  const fromType = (file?.type || '').toLowerCase();
  if (SUPPORTED_MIME_VALUES.includes(fromType)) return fromType;
  const ext = (file?.name?.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  return SUPPORTED_MIME[ext] || null;
};

// ── Hierarchical location picker ─────────────────────────────────────────────

const LocationPicker = ({ value, onChange, locations = [], placeholder = 'Select location…' }) => {
  const [open, setOpen] = useState(false);
  const [prefix, setPrefix] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setPrefix(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Build unique next-level segments under current prefix
  const items = (() => {
    const relevant = prefix ? locations.filter(p => p === prefix || p.startsWith(prefix + ' > ')) : locations;
    const seen = new Set();
    const out = [];
    for (const path of relevant) {
      const rest = prefix ? path.slice(prefix.length + 3) : path;
      if (!rest) continue;
      const seg = rest.split(' > ')[0];
      if (!seg || seen.has(seg)) continue;
      seen.add(seg);
      const full = prefix ? `${prefix} > ${seg}` : seg;
      const hasChildren = locations.some(p => p.startsWith(full + ' > '));
      out.push({ seg, full, hasChildren });
    }
    return out;
  })();

  const handleSelect = (path) => { onChange(path); setOpen(false); setPrefix(''); };
  const handleBack = () => { const parts = prefix.split(' > '); setPrefix(parts.slice(0, -1).join(' > ')); };

  return (
    <div ref={ref} className="rdm-picker">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setPrefix(''); }}
        className={`rdm-picker-trigger${open ? ' is-open' : ''}${!value ? ' is-placeholder' : ''}`}
      >
        <span className="rdm-picker-trigger-value">{value || placeholder}</span>
        <span className="rdm-picker-trigger-arrow">▾</span>
      </button>
      {open && (
        <div className="rdm-picker-popover">
          {prefix && (
            <div className="rdm-picker-breadcrumb">
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); handleBack(); }}
                className="rdm-picker-breadcrumb-segment"
              >‹ Back</button>
              <span className="rdm-picker-breadcrumb-segment is-current">{prefix}</span>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); handleSelect(prefix); }}
                className="rdm-picker-breadcrumb-segment"
                style={{ marginLeft: 'auto', color: 'var(--d-orange)', fontWeight: 700 }}
              >Select ✓</button>
            </div>
          )}
          {locations.length === 0 && <div className="rdm-picker-empty">No locations configured</div>}
          {items.map(({ seg, full, hasChildren }) => (
            <button
              key={full}
              type="button"
              onMouseDown={e => { e.preventDefault(); hasChildren ? setPrefix(full) : handleSelect(full); }}
              className="rdm-picker-item"
            >
              {hasChildren && <span className="rdm-picker-item-chevron">📁</span>}
              <span className="rdm-picker-item-name">{seg}</span>
              {hasChildren && <span className="rdm-picker-item-chevron">›</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Progressive category picker (inventory_locations hierarchy) ──────────────

const CategoryPicker = ({ paths = [], value = '', onChange, disabled = false }) => {
  const segments = value ? value.split(' > ') : [];

  const getLevelOptions = (level) => {
    const prefix = segments.slice(0, level).join(' > ');
    const relevant = prefix
      ? paths.filter(p => p === prefix || p.startsWith(prefix + ' > '))
      : paths;
    const seen = new Set();
    const opts = [];
    for (const path of relevant) {
      const seg = path.split(' > ')[level];
      if (seg && !seen.has(seg)) {
        seen.add(seg);
        opts.push(seg); // all entries in paths are folders; leaf folders are valid selections
      }
    }
    return opts;
  };

  const handleChange = (level, val) => {
    const newSegs = [...segments.slice(0, level), ...(val ? [val] : [])];
    onChange(newSegs.join(' > '));
  };

  const dropdowns = [];
  for (let level = 0; ; level++) {
    const opts = getLevelOptions(level);
    if (opts.length === 0) break;
    dropdowns.push({ level, opts, selected: segments[level] || '' });
    if (!segments[level]) break;
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {dropdowns.map(({ level, opts, selected }) => (
        <select
          key={level}
          value={selected}
          onChange={e => handleChange(level, e.target.value)}
          disabled={disabled}
          className="rdm-create-select"
          style={{ maxWidth: 160 }}
        >
          <option value="">Select…</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ))}
      {dropdowns.length === 0 && paths.length === 0 && (
        <span className="rdm-picker-empty" style={{ padding: 0 }}>No categories configured</span>
      )}
    </div>
  );
};

// ── Physical storage location picker (vessel_locations table) ────────────────

const VesselLocationPicker = ({ value, onChange, vesselLocations = [], placeholder = 'Select location…' }) => {
  const [open, setOpen] = useState(false);
  const [parentId, setParentId] = useState(null);   // null = root (deck level)
  const [breadcrumb, setBreadcrumb] = useState([]);  // [{id, name}] trail
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setParentId(null); setBreadcrumb([]); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const currentItems = vesselLocations.filter(l => (l.parent_id ?? null) === parentId);

  const handleSelect = (displayName) => {
    const path = [...breadcrumb.map(b => b.name), displayName].join(' > ');
    onChange(path);
    setOpen(false);
    setParentId(null);
    setBreadcrumb([]);
  };

  const handleDrillIn = (loc) => {
    setParentId(loc.id);
    setBreadcrumb(prev => [...prev, { id: loc.id, name: loc.name }]);
  };

  const handleBack = () => {
    const next = breadcrumb.slice(0, -1);
    setBreadcrumb(next);
    setParentId(next.length > 0 ? next[next.length - 1].id : null);
  };

  const breadcrumbPath = breadcrumb.map(b => b.name).join(' > ');

  return (
    <div ref={ref} className="rdm-picker">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setParentId(null); setBreadcrumb([]); }}
        className={`rdm-picker-trigger${open ? ' is-open' : ''}${!value ? ' is-placeholder' : ''}`}
      >
        <span className="rdm-picker-trigger-value">{value || placeholder}</span>
        <span className="rdm-picker-trigger-arrow">▾</span>
      </button>
      {open && (
        <div className="rdm-picker-popover">
          {/* Breadcrumb / back header */}
          {breadcrumb.length > 0 && (
            <div className="rdm-picker-breadcrumb">
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); handleBack(); }}
                className="rdm-picker-breadcrumb-segment"
              >‹ Back</button>
              <span className="rdm-picker-breadcrumb-segment is-current">{breadcrumbPath}</span>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); onChange(breadcrumbPath); setOpen(false); setParentId(null); setBreadcrumb([]); }}
                className="rdm-picker-breadcrumb-segment"
                style={{ marginLeft: 'auto', color: 'var(--d-orange)', fontWeight: 700 }}
              >Select ✓</button>
            </div>
          )}
          {vesselLocations.length === 0 && <div className="rdm-picker-empty">No vessel locations configured</div>}
          {currentItems.map(loc => {
            const hasChildren = vesselLocations.some(l => l.parent_id === loc.id);
            return (
              <button
                key={loc.id}
                type="button"
                onMouseDown={e => { e.preventDefault(); hasChildren ? handleDrillIn(loc) : handleSelect(loc.name); }}
                className="rdm-picker-item"
              >
                {hasChildren && <span className="rdm-picker-item-chevron">📁</span>}
                <span className="rdm-picker-item-name">{loc.name}</span>
                {hasChildren && <span className="rdm-picker-item-chevron">›</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Group checkbox (supports indeterminate state) ─────────────────────────────

const GroupCheckbox = ({ state, onChange }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.indeterminate = state === 'some';
    ref.current.checked = state === 'all';
  }, [state]);
  return (
    <input ref={ref} type="checkbox" onChange={e => onChange(e.target.checked)} className="rdm-group-checkbox" />
  );
};

// ── Step 1 ─ Receive checklist ────────────────────────────────────────────────

const ReceiveStep = ({
  items, receiving, onChange, onGroupChange, onReceiveAll, onNext, onClose, saving,
  deliveryNoteFile, noteStatus, noteError, parsedNote, noteAutoFillData, unmatchedItems,
  frozenOrder,
  onFileSelect, onRemoveNote, onAddUnmatched, onSkipUnmatched,
  multiBoard,
}) => {
  const [organiseBySupplier, setOrganiseBySupplier] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [unmatchedExpanded, setUnmatchedExpanded] = useState(false);
  // Per-supplier collapse state — Set of supplier names that the
  // chief has collapsed. All groups start expanded (matches the
  // current behaviour); the chevron lets a chief tucked into one
  // supplier's section skip past it to the next.
  const [collapsedSuppliers, setCollapsedSuppliers] = useState(() => new Set());
  const toggleSupplierCollapsed = (name) => setCollapsedSuppliers(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  // Three-tier render only: starts collapsed so the crew lands on
  // Needs review + Confirmed (the actionable tiers) without scrolling
  // past 80 untouched rows. Click to expand inline.
  const [untouchedExpanded, setUntouchedExpanded] = useState(false);
  // Index items by id for O(1) lookup during the three-tier render.
  // Built once per render — cheap (10s-100s of items typical).
  const itemsById = (() => {
    const m = new Map();
    items.forEach(i => m.set(i.id, i));
    return m;
  })();
  const noteCameraRef = useRef(null);
  const noteRollRef   = useRef(null);
  const noteFileRef   = useRef(null);

  const supplierGroups = (() => {
    const groups = {};
    items.forEach(item => {
      const key = multiBoard
        ? (item._boardTitle || 'Unknown board')
        : (item.supplier_name?.trim() || 'No supplier');
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return Object.entries(groups);
  })();

  const matchedCount = parsedNote?.line_items?.filter(l => l.matched_item_id && l.match_confidence !== 'none').length ?? 0;

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileSelect(file);
  };

  const renderItemRow = (item) => {
    const r = receiving[item.id] || { checked: false, qty: item.quantity_ordered || 0 };
    const ordered = parseFloat(item.quantity_ordered) || 0;
    const rcvQty = parseFloat(r.qty) || 0;
    const status = r.checked ? deriveStatus(rcvQty, ordered) : null;
    // OCR context for this row (Pass 2 — Features A, C, and Bug P visibility).
    // Map.get() returns undefined when no OCR data exists; treat as "no doc".
    const fillData = noteAutoFillData?.get(item.id);
    const fromNote = !!fillData;
    const conf = fillData?.confidence;             // 'high' | 'medium' | 'low' | 'added'
    const extractedQty = fillData?.extractedQty ?? 0;
    const lineCount = fillData?.lineCount ?? 1;
    // Feature A — confidence chip variant. Medium + low collapse into one
    // amber "check match" treatment so the crew has a binary signal:
    // trust it or eyeball it. 'added' is a separate sentinel for items
    // the crew manually pulled in from the unmatched section.
    const isDoubleCheck = conf === 'medium' || conf === 'low';
    const isAdded = conf === 'added';
    // Feature C — partial-receive remainder indicator. Only meaningful when
    // OCR actually auto-matched (confidence high/medium/low). 'added' items
    // don't trigger Tier-2 routing for the remainder; manually-added items
    // stay on the crew's board, so no "+N will be routed" message.
    const remainder = (fromNote && !isAdded && rcvQty < extractedQty && rcvQty >= 0)
      ? (extractedQty - rcvQty) : 0;
    const qtyClass = !r.checked ? '' : rcvQty >= ordered ? ' is-full' : rcvQty > 0 ? ' is-partial' : '';
    const rowClass = r.checked ? (fromNote ? ' is-matched' : ' is-checked') : '';
    return (
      <div key={item.id} className={`rdm-item-row${rowClass}`}>
        <input
          type="checkbox" checked={!!r.checked}
          onChange={e => onChange(item.id, 'checked', e.target.checked)}
          className="rdm-item-checkbox"
        />
        <div className="rdm-item-text">
          <p className="rdm-item-name">{item.name}</p>
          <p className="rdm-item-sub">
            {(item.brand || item.size) && <span>{[item.brand, item.size].filter(Boolean).join(' · ')}</span>}
            {fromNote && !isDoubleCheck && !isAdded && (
              <span title="Quantity set from document" className="rdm-match-badge">📄 match</span>
            )}
            {fromNote && isDoubleCheck && (
              <span title="OCR confidence is medium or low — verify before saving" className="rdm-match-badge is-doublecheck">
                ⚠ check match
              </span>
            )}
            {fromNote && isAdded && (
              <span title="Added from the delivery document" className="rdm-match-badge is-added">
                📄 from doc
              </span>
            )}
            {fromNote && lineCount > 1 && (
              <span title={`${lineCount} OCR lines merged into this row — qty summed`} className="rdm-match-badge is-merged">
                {lineCount} lines merged
              </span>
            )}
          </p>
          {remainder > 0 && r.checked && (
            <p className="rdm-item-remainder-note" title="The remainder will be offered to other departments or sent to the delivery inbox">
              +{remainder} will be routed onward
            </p>
          )}
        </div>
        <p className="rdm-item-ordered">
          {ordered}{item.unit ? <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--d-muted-soft)' }}>{item.unit}</span> : null}
        </p>
        <input
          type="number" min="0" value={r.qty} disabled={!r.checked}
          onChange={e => onChange(item.id, 'qty', e.target.value)}
          className={`rdm-item-qty-input${qtyClass}`}
        />
        <div className={`rdm-item-status${status ? ` is-${status === 'not_received' ? 'none' : status}` : ''}`}>
          {status === 'received' && 'Received'}
          {status === 'partial' && 'Partial'}
          {status === 'not_received' && 'Not received'}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Sub-header. When frozenOrder is active (post-OCR), the supplier/
          board toggle is replaced by a tier-count summary — the list is no
          longer grouped by supplier, so the toggle would be meaningless.
          The crew gets at-a-glance counts of what the doc covered instead. */}
      <div className="rdm-section" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <p className="rdm-section-sub" style={{ flex: 1, margin: 0 }}>Tick each item received and enter the quantity.</p>
        {frozenOrder ? (
          <p className="rdm-tier-summary">
            <strong>{frozenOrder.confirmed.length}</strong> confirmed
            <span className="rdm-tier-summary-sep"> · </span>
            <span className="is-review"><strong>{frozenOrder.needsReview.length}</strong> to review</span>
            <span className="rdm-tier-summary-sep"> · </span>
            <strong>{frozenOrder.untouched.length}</strong> untouched
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setOrganiseBySupplier(v => !v)}
            className={`rdm-organise-toggle-btn${organiseBySupplier ? ' is-active' : ''}`}
          >
            {multiBoard ? 'By board' : 'By supplier'}
          </button>
        )}
        <button type="button" onClick={onReceiveAll} className="rdm-btn rdm-btn-ghost">
          Receive all
        </button>
      </div>

      {/* Delivery note upload */}
      <div className="rdm-upload-block">
        {noteStatus === 'idle' ? (
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <p className="rdm-upload-label">
              Delivery note <span className="rdm-upload-label-hint">(optional · AI will match items)</span>
            </p>
            {/* Hidden file inputs — one per source */}
            <input ref={noteCameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onFileSelect(e.target.files[0])} />
            <input ref={noteRollRef}   type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onFileSelect(e.target.files[0])} />
            <input ref={noteFileRef}   type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onFileSelect(e.target.files[0])} />
            <div className="rdm-upload-buttons">
              {[
                { ref: noteCameraRef, label: 'Take photo',   icon: 'Camera' },
                { ref: noteRollRef,   label: 'Camera roll',  icon: 'Image'  },
                { ref: noteFileRef,   label: 'Upload file',  icon: 'FileUp' },
              ].map(src => (
                <button
                  key={src.label}
                  type="button"
                  onClick={() => src.ref.current?.click()}
                  className="rdm-upload-btn"
                  style={isDragging ? { borderColor: 'var(--d-orange)', background: 'var(--d-bg)' } : null}
                >
                  <Icon name={src.icon} className="rdm-upload-btn-icon" />
                  <span>{src.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (() => {
            const noMatch = noteStatus === 'done' && matchedCount === 0;
            // Editorial palette mapping: success = sage, warning = amber,
            // error = rust. Error STATE specifically pairs AlertCircle +
            // unmistakable copy because rust is also the brand accent.
            const stateClass = noteStatus === 'error' ? ' is-error'
              : noMatch ? ' is-warning'
              : noteStatus === 'done' ? ' is-success'
              : ' is-parsing';
            const iconName = noteStatus === 'parsing' ? 'Loader' : noteStatus === 'error' ? 'AlertCircle' : noMatch ? 'AlertTriangle' : 'CheckCircle';
            const subText = noteStatus === 'parsing' ? 'Extracting items with AI…'
              : noteStatus === 'error' ? (`Couldn't read this document — ${noteError || 'items unchanged. Try a clearer photo or upload manually.'}`)
              : noMatch ? (parsedNote?.document_type === 'receipt'
                  ? `No items matched your list — review items below to add or skip`
                  : `No matches${multiBoard ? ' on any board' : ' on your list'} · ${unmatchedItems.length} item${unmatchedItems.length !== 1 ? 's' : ''} will be routed to other departments`)
              : (() => {
                  if (multiBoard) {
                    const matchedBoardIds = new Set((parsedNote?.line_items || []).filter(l => l.matched_item_id && l.match_confidence !== 'none').map(l => items.find(i => i.id === l.matched_item_id)?._boardId).filter(Boolean));
                    return `✓ ${matchedCount} matched across ${matchedBoardIds.size || 1} board${matchedBoardIds.size !== 1 ? 's' : ''} · ${unmatchedItems.length} not on any board`;
                  }
                  return `✓ ${matchedCount} matched · ${unmatchedItems.length} not on board`;
                })();
            return (
              <div className={`rdm-upload-card${stateClass}`}>
                <div className="rdm-upload-card-icon">
                  <Icon name={iconName} style={{ width: 20, height: 20 }} />
                </div>
                <div className="rdm-upload-card-text">
                  <p className="rdm-upload-card-name">{deliveryNoteFile?.name}</p>
                  <p className="rdm-upload-card-msg">{subText}</p>
                </div>
                <button
                  type="button"
                  onClick={onRemoveNote}
                  disabled={noteStatus === 'parsing'}
                  className="rdm-upload-card-remove"
                  title="Remove"
                >
                  <Icon name="X" style={{ width: 14, height: 14 }} />
                </button>
              </div>
            );
          })()}
      </div>

      {/* Column header */}
      <div className="rdm-item-list-header">
        <div />
        <div className="rdm-item-list-header-cell">Item</div>
        <div className="rdm-item-list-header-cell">Ordered</div>
        <div className="rdm-item-list-header-cell">Received</div>
        <div className="rdm-item-list-header-cell">Status</div>
      </div>

      {/* Item rows.
          Two render modes:
          (a) frozenOrder active (post-OCR) — three frozen tiers: NEEDS
              REVIEW, CONFIRMED, and (collapsible) Not on this delivery.
              Sort frozen at OCR completion; no row-jumping on edits.
          (b) no OCR yet — fall through to the existing supplier/board
              grouping (the toggle pill above governs supplier vs board).
              This mode is reachable when crew opens the modal without
              uploading a doc — rare per Lauren but preserved as fallback.
      */}
      <div className="rdm-item-list" style={{ borderRadius: '0 0 10px 10px' }}>
        {frozenOrder ? (
          <>
            {frozenOrder.needsReview.length > 0 && (
              <>
                <div className="rdm-tier-head rdm-tier-head-review">
                  <span className="rdm-tier-head-label">Needs review</span>
                  <span className="rdm-tier-head-count">{frozenOrder.needsReview.length} item{frozenOrder.needsReview.length === 1 ? '' : 's'}</span>
                </div>
                {frozenOrder.needsReview.map(id => {
                  const item = itemsById.get(id);
                  return item ? renderItemRow(item) : null;
                })}
              </>
            )}
            {frozenOrder.confirmed.length > 0 && (
              <>
                <div className="rdm-tier-head rdm-tier-head-confirmed">
                  <span className="rdm-tier-head-label">Confirmed</span>
                  <span className="rdm-tier-head-count">{frozenOrder.confirmed.length} item{frozenOrder.confirmed.length === 1 ? '' : 's'}</span>
                </div>
                {frozenOrder.confirmed.map(id => {
                  const item = itemsById.get(id);
                  return item ? renderItemRow(item) : null;
                })}
              </>
            )}
            {frozenOrder.untouched.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setUntouchedExpanded(v => !v)}
                  className="rdm-tier-head rdm-tier-head-untouched"
                  aria-expanded={untouchedExpanded}
                >
                  <span className="rdm-tier-head-chevron">{untouchedExpanded ? '▾' : '▸'}</span>
                  <span className="rdm-tier-head-label">
                    {frozenOrder.untouched.length} item{frozenOrder.untouched.length === 1 ? '' : 's'} not on this delivery
                  </span>
                  <span className="rdm-tier-head-hint">(tick to add manually if OCR missed something)</span>
                </button>
                {untouchedExpanded && frozenOrder.untouched.map(id => {
                  const item = itemsById.get(id);
                  return item ? renderItemRow(item) : null;
                })}
              </>
            )}
          </>
        ) : organiseBySupplier ? (
          supplierGroups.map(([supplierName, groupItems]) => {
            const checkedCount = groupItems.filter(i => receiving[i.id]?.checked).length;
            const groupState = checkedCount === 0 ? 'none' : checkedCount === groupItems.length ? 'all' : 'some';
            const isCollapsed = collapsedSuppliers.has(supplierName);
            return (
              <div key={supplierName}>
                <div className="rdm-item-group-head" style={{ borderRadius: 0, border: 0, borderTop: '0.5px solid var(--d-border)', borderBottom: '0.5px solid var(--d-border)' }}>
                  <GroupCheckbox state={groupState} onChange={checked => onGroupChange(groupItems.map(i => i.id), checked)} />
                  {/* Chevron toggles the supplier's section
                      so a chief tucked into one supplier can
                      scroll past it to the next. Clicking the
                      name does the same — bigger click target,
                      same affordance. The checkbox stays its
                      own discrete control. */}
                  <button
                    type="button"
                    onClick={() => toggleSupplierCollapsed(supplierName)}
                    className="rdm-item-group-chevron"
                    aria-expanded={!isCollapsed}
                    aria-label={isCollapsed ? `Expand ${supplierName}` : `Collapse ${supplierName}`}
                    title={isCollapsed ? 'Expand section' : 'Collapse section'}
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSupplierCollapsed(supplierName)}
                    className="rdm-item-group-name rdm-item-group-name-toggle"
                  >
                    {supplierName}
                  </button>
                  <span className="rdm-item-group-count">{groupItems.length} item{groupItems.length !== 1 ? 's' : ''}</span>
                </div>
                {!isCollapsed && groupItems.map(item => renderItemRow(item))}
              </div>
            );
          })
        ) : (
          items.map(item => renderItemRow(item))
        )}

        {items.length === 0 && (
          <div className="rdm-empty">No items on this board.</div>
        )}
      </div>

      {/* Unmatched items from delivery note */}
      {unmatchedItems.length > 0 && (
        <div className="rdm-unmatched" style={{ marginTop: 16 }}>
          <button
            type="button"
            onClick={() => setUnmatchedExpanded(p => !p)}
            className="rdm-unmatched-head"
          >
            <Icon name="AlertTriangle" className="rdm-unmatched-head-icon" style={{ width: 16, height: 16 }} />
            <div className="rdm-unmatched-head-text">
              <p className="rdm-unmatched-title">
                {parsedNote?.document_type === 'receipt'
                  ? `Other items on this receipt (${unmatchedItems.length})`
                  : `Other items on this document (${unmatchedItems.length})`}
              </p>
              <p className="rdm-unmatched-sub">
                {parsedNote?.document_type === 'receipt'
                  ? 'Items to review — add to your board or skip'
                  : 'Will be checked against other departments on save'}
              </p>
            </div>
            <span style={{ color: 'var(--d-orange)', fontSize: 12 }}>{unmatchedExpanded ? '▾' : '▸'}</span>
          </button>
          {unmatchedExpanded && (
            <div className="rdm-unmatched-list">
              {unmatchedItems.map((li, idx) => (
                <div key={idx} className="rdm-unmatched-row">
                  <div className="rdm-unmatched-row-text">
                    <p className="rdm-unmatched-row-name">{li.raw_name}</p>
                    {li.original_name && (
                      <p className="rdm-unmatched-row-original">Receipt: {li.original_name}</p>
                    )}
                    <p className="rdm-unmatched-row-meta">
                      {[li.quantity && `×${li.quantity}`, li.unit, li.unit_price && `$${li.unit_price}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="rdm-unmatched-row-actions">
                    {!multiBoard && (
                      <button type="button" onClick={() => onAddUnmatched(li, idx)} className="rdm-btn rdm-btn-navy rdm-btn-sm">
                        + Add to board
                      </button>
                    )}
                    <button type="button" onClick={() => onSkipUnmatched(idx)} className="rdm-btn rdm-btn-quiet rdm-btn-sm">
                      Skip
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="rdm-footer">
        <div className="rdm-footer-left">
          {items.filter(i => receiving[i.id]?.checked).length === 0 && unmatchedItems.length > 0 ? (
            <p className="rdm-validation-text is-warning">
              {parsedNote?.document_type === 'receipt'
                ? 'No items matched your list — review items below to add or skip'
                : `No items matched ${multiBoard ? 'any board' : 'your list'} — will check other departments on save`}
            </p>
          ) : (
            <p className="rdm-validation-text">
              {items.filter(i => receiving[i.id]?.checked).length} of {items.length} items ticked
            </p>
          )}
        </div>
        <div className="rdm-footer-actions">
          <button type="button" onClick={onClose} className="rdm-btn rdm-btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={saving || (items.filter(i => receiving[i.id]?.checked).length === 0 && unmatchedItems.length === 0)}
            className="rdm-btn rdm-btn-rust"
          >
            {saving ? 'Saving…' : 'Save & Continue →'}
          </button>
        </div>
      </div>
    </>
  );
};

// ── Step 2 ─ Push to inventory ────────────────────────────────────────────────

const SplitQtyBtn = ({ onClick, children }) => (
  <button type="button" onClick={onClick} className="rdm-qty-btn">{children}</button>
);

// Shared label helper for create/link forms.
const FLD = ({ children }) => (
  <span className="rdm-fld">{children}</span>
);

const PushStep = ({
  items, receiving, matches,
  locationSplits, onSplitChange, onAddSplitLocation, onRemoveSplitLocation,
  noMatchChoices, inlineLinks, inlineSearch, allLocations, vesselLocations,
  onSetNoMatchChoice, onInlineSearchChange, onInlineLink,
  onUnlinkMatch, onUnlinkInline,
  newItemForms, onInitNewItemForm, onNewItemFormChange,
  onNewItemSplitChange, onNewItemAddSplit, onNewItemRemoveSplit,
  onPush, onBack, onComplete, pushing,
  routingSummary, onDismissRoutingSummary,
}) => {
  const receivedItems = items.filter(i => receiving[i.id]?.checked && (parseFloat(receiving[i.id]?.qty) || 0) > 0);

  // Shared split-rows UI (used for auto-matched, inline-linked, and create-new).
  const renderSplits = (itemId, qty, splits) => {
    const totalAllocated = splits.reduce((sum, s) => sum + (parseFloat(s.addQty) || 0), 0);
    const allocOk = Math.abs(totalAllocated - qty) < 0.001;
    return (
      <div className="rdm-splits">
        {splits.map((loc, idx) => (
          <div key={idx} className="rdm-split-row">
            <button
              type="button"
              onClick={() => onRemoveSplitLocation(itemId, idx)}
              className="rdm-split-delete"
              title="Remove location"
            >
              <Icon name="Trash2" style={{ width: 14, height: 14 }} />
            </button>
            <VesselLocationPicker
              value={loc.locationName}
              onChange={v => onSplitChange(itemId, idx, 'locationName', v)}
              vesselLocations={vesselLocations}
              placeholder="Select storage location…"
            />
            <span className={loc.currentQty > 0 ? 'rdm-split-now' : 'rdm-split-new-tag'}>
              {loc.currentQty > 0 ? `now: ${loc.currentQty}` : 'new'}
            </span>
            <div className="rdm-split-qty-controls">
              <SplitQtyBtn onClick={() => onSplitChange(itemId, idx, 'addQty', Math.max(0, (parseFloat(loc.addQty) || 0) - 1))}>−</SplitQtyBtn>
              <input
                type="number" min="0" value={loc.addQty}
                onChange={e => onSplitChange(itemId, idx, 'addQty', parseFloat(e.target.value) || 0)}
                className="rdm-split-qty-input"
              />
              <SplitQtyBtn onClick={() => onSplitChange(itemId, idx, 'addQty', (parseFloat(loc.addQty) || 0) + 1)}>+</SplitQtyBtn>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <button type="button" onClick={() => onAddSplitLocation(itemId)} className="rdm-split-add">
            + Add location
          </button>
          <span className={`rdm-split-summary${allocOk ? ' is-complete' : ' is-incomplete'}`}>
            {totalAllocated} of {qty} allocated{allocOk ? ' ✓' : ''}
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      <p className="rdm-section-sub" style={{ marginBottom: 14 }}>
        Confirm where each item goes in inventory. Split across multiple locations if needed.
      </p>

      {/* Feature D — routing summary. Persistent dismissable panel showing
          WHICH items routed WHERE (other boards / delivery inbox). Surfaces
          information that was previously only visible as a count toast. */}
      {routingSummary && (routingSummary.toOtherBoards.length > 0 || routingSummary.toDeliveryInbox.length > 0) && (
        <div className="rdm-routing-summary">
          <div className="rdm-routing-summary-head">
            <p className="rdm-routing-summary-title">Items sent elsewhere</p>
            <button
              type="button"
              onClick={onDismissRoutingSummary}
              className="rdm-icon-btn"
              aria-label="Dismiss routing summary"
              title="Dismiss"
            >
              <Icon name="X" style={{ width: 14, height: 14 }} />
            </button>
          </div>
          {routingSummary.toOtherBoards.length > 0 && (
            <div className="rdm-routing-summary-section">
              <p className="rdm-routing-summary-section-label">To other boards</p>
              <ul className="rdm-routing-summary-list">
                {routingSummary.toOtherBoards.map((r, i) => (
                  <li key={`b-${i}`} className="rdm-routing-summary-row">
                    <span className="rdm-routing-summary-item">{r.itemName}</span>
                    <span className="rdm-routing-summary-arrow">→</span>
                    <span className="rdm-routing-summary-target">{r.boardTitle}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {routingSummary.toDeliveryInbox.length > 0 && (
            <div className="rdm-routing-summary-section">
              <p className="rdm-routing-summary-section-label">To delivery inbox</p>
              <ul className="rdm-routing-summary-list">
                {routingSummary.toDeliveryInbox.map((r, i) => (
                  <li key={`i-${i}`} className="rdm-routing-summary-row">
                    <span className="rdm-routing-summary-item">{r.itemName}</span>
                    <span className="rdm-routing-summary-arrow">→</span>
                    <span className="rdm-routing-summary-target rdm-routing-summary-target-inbox">
                      No match on any board
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="rdm-route-list">
        {receivedItems.map(item => {
          const qty = parseFloat(receiving[item.id]?.qty) || 0;
          const match = matches[item.id];
          const isLoading = match === 'loading';
          const hasMatch = match && match !== 'loading';
          const splits = locationSplits[item.id] || [];
          const choice = noMatchChoices[item.id] || null;
          const inlineLink = inlineLinks[item.id] || null;
          const search = inlineSearch[item.id] || {};
          const newForm = newItemForms[item.id] || null;

          // Determine which route-card state class applies.
          const stateClass =
            isLoading ? ' is-loading'
            : hasMatch ? ' is-matched'
            : choice === 'skip' ? ' is-skipped'
            : choice === 'link' && inlineLink ? ' is-linked'
            : choice === 'link' ? ' is-searching'
            : choice === 'create' ? ' is-create'
            : ' is-nomatch';

          return (
            <div key={item.id} className={`rdm-route-card${stateClass}`}>
              {/* Common item header row */}
              <div className="rdm-route-head" style={{ marginBottom: isLoading ? 0 : 12 }}>
                <div className="rdm-route-head-icon">
                  {isLoading && <Icon name="Loader" style={{ width: 18, height: 18 }} />}
                  {hasMatch && <Icon name="CheckCircle" style={{ width: 18, height: 18 }} />}
                  {choice === 'skip' && <Icon name="MinusCircle" style={{ width: 18, height: 18 }} />}
                  {choice === 'link' && inlineLink && <Icon name="Link" style={{ width: 18, height: 18 }} />}
                  {choice === 'link' && !inlineLink && <Icon name="Search" style={{ width: 18, height: 18 }} />}
                  {choice === 'create' && <Icon name="PlusCircle" style={{ width: 18, height: 18 }} />}
                  {!isLoading && !hasMatch && !choice && <Icon name="AlertCircle" style={{ width: 18, height: 18 }} />}
                </div>
                <div className="rdm-route-head-text">
                  <p className="rdm-route-title">
                    {item.name}
                    {(item.brand || item.size) && (
                      <span className="rdm-route-sub" style={{ marginLeft: 8, display: 'inline' }}>
                        {[item.brand, item.size].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </p>
                  {isLoading && <p className="rdm-route-sub">Searching inventory…</p>}
                  {hasMatch && (
                    <p className="rdm-route-sub">
                      Matched → <strong style={{ color: 'var(--rdm-sage-deep)' }}>{match.name}</strong>
                      {match.cargo_item_id && <span className="rdm-route-cargoid">({match.cargo_item_id})</span>}
                      <span className="rdm-route-stock" style={{ marginLeft: 8 }}>· stock: {match.total_qty ?? 0}</span>
                    </p>
                  )}
                  {choice === 'link' && inlineLink && (
                    <p className="rdm-route-sub">
                      Linked → <strong style={{ color: 'var(--rdm-sage-deep)' }}>{inlineLink.name}</strong>
                      {inlineLink.cargo_item_id && <span className="rdm-route-cargoid">({inlineLink.cargo_item_id})</span>}
                      <span className="rdm-route-stock" style={{ marginLeft: 8 }}>· stock: {inlineLink.total_qty ?? 0}</span>
                    </p>
                  )}
                  {choice === 'link' && !inlineLink && <p className="rdm-route-sub">Link to inventory item</p>}
                  {choice === 'create' && <p className="rdm-route-sub">Create new inventory item</p>}
                  {choice === 'skip' && <p className="rdm-skipped-text" style={{ margin: '2px 0 0' }}>Skipped — not pushed to inventory</p>}
                  {!isLoading && !hasMatch && !choice && <p className="rdm-route-sub">No inventory match found</p>}
                </div>
                <div className="rdm-route-head-actions">
                  <strong style={{ fontFamily: 'Outfit, system-ui, sans-serif', fontSize: 14, color: 'var(--d-navy)', whiteSpace: 'nowrap' }}>
                    +{qty} {item.unit || ''}
                  </strong>
                  {hasMatch && (
                    <button type="button" onClick={() => onUnlinkMatch(item.id)} className="rdm-btn rdm-btn-quiet rdm-btn-sm">Unlink</button>
                  )}
                  {choice === 'link' && inlineLink && (
                    <button type="button" onClick={() => onUnlinkInline(item.id)} className="rdm-btn rdm-btn-quiet rdm-btn-sm">Unlink</button>
                  )}
                  {choice === 'skip' && (
                    <button type="button" onClick={() => onSetNoMatchChoice(item.id, null)} className="rdm-btn rdm-btn-ghost rdm-btn-sm">Undo</button>
                  )}
                  {(choice === 'link' && !inlineLink) || choice === 'create' ? (
                    <button type="button" onClick={() => onSetNoMatchChoice(item.id, null)} className="rdm-search-back">← Back</button>
                  ) : null}
                </div>
              </div>

              {/* Body — varies by state. Loading + skipped show no body. */}
              {hasMatch && renderSplits(item.id, qty, splits)}
              {choice === 'link' && inlineLink && renderSplits(item.id, qty, splits)}

              {choice === 'link' && !inlineLink && (
                <div style={{ position: 'relative' }}>
                  <input
                    value={search.query || ''}
                    onChange={e => onInlineSearchChange(item.id, e.target.value)}
                    placeholder="Search by name, brand, or CARGO code…"
                    className="rdm-search-input"
                  />
                  {search.loading && <div className="rdm-search-loading">Searching…</div>}
                  {(search.results || []).length > 0 && (
                    <div className="rdm-search-results">
                      {(search.results || []).map(inv => (
                        <button
                          key={inv.id}
                          type="button"
                          onMouseDown={e => { e.preventDefault(); onInlineLink(item.id, inv); }}
                          className="rdm-search-result"
                        >
                          <div className="rdm-search-result-name">{inv.name}</div>
                          <div className="rdm-search-result-meta">
                            {[inv.brand, inv.size, inv.cargo_item_id].filter(Boolean).join(' · ')}
                            {inv.total_qty != null ? ` · stock: ${inv.total_qty}` : ''}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {choice === 'create' && newForm && (
                <>
                  <div className="rdm-create-form">
                    <div className="rdm-create-field">
                      <FLD>Name <span style={{ color: 'var(--d-orange)' }}>*</span></FLD>
                      <input value={newForm.name} onChange={e => onNewItemFormChange(item.id, 'name', e.target.value)} className="rdm-create-input" />
                    </div>
                    <div className="rdm-create-field">
                      <FLD>Brand</FLD>
                      <input value={newForm.brand} onChange={e => onNewItemFormChange(item.id, 'brand', e.target.value)} className="rdm-create-input" />
                    </div>
                    <div className="rdm-create-field">
                      <FLD>Size</FLD>
                      <input value={newForm.size} onChange={e => onNewItemFormChange(item.id, 'size', e.target.value)} placeholder="e.g. 750ml" className="rdm-create-input" />
                    </div>
                    <div className="rdm-create-field">
                      <FLD>Unit <span style={{ color: 'var(--d-orange)' }}>*</span></FLD>
                      <select value={newForm.unit} onChange={e => onNewItemFormChange(item.id, 'unit', e.target.value)} className="rdm-create-select">
                        {UNIT_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.options.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>)}
                      </select>
                    </div>
                    <div className="rdm-create-field">
                      <FLD>Barcode</FLD>
                      <input value={newForm.barcode} onChange={e => onNewItemFormChange(item.id, 'barcode', e.target.value)} className="rdm-create-input" />
                    </div>
                    <div className="rdm-create-field is-full">
                      <FLD>Inventory category <span style={{ color: 'var(--d-orange)' }}>*</span></FLD>
                      <CategoryPicker
                        paths={allLocations}
                        value={newForm.categoryPath || ''}
                        onChange={v => onNewItemFormChange(item.id, 'categoryPath', v)}
                      />
                    </div>
                    <div className="rdm-create-field is-full">
                      <FLD>Storage locations <span style={{ color: 'var(--d-orange)' }}>*</span></FLD>
                      <div className="rdm-splits" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                        {(newForm.splits || []).map((s, idx) => (
                          <div key={idx} className="rdm-split-row">
                            <button
                              type="button"
                              onClick={() => onNewItemRemoveSplit(item.id, idx)}
                              className="rdm-split-delete"
                              title="Remove location"
                            >
                              <Icon name="Trash2" style={{ width: 14, height: 14 }} />
                            </button>
                            <VesselLocationPicker
                              value={s.locationName}
                              onChange={v => onNewItemSplitChange(item.id, idx, 'locationName', v)}
                              vesselLocations={vesselLocations}
                              placeholder="Select storage location…"
                            />
                            <span style={{ visibility: 'hidden' }} className="rdm-split-now">—</span>
                            <div className="rdm-split-qty-controls">
                              <SplitQtyBtn onClick={() => onNewItemSplitChange(item.id, idx, 'addQty', Math.max(0, (parseFloat(s.addQty) || 0) - 1))}>−</SplitQtyBtn>
                              <input
                                type="number" min="0" value={s.addQty}
                                onChange={e => onNewItemSplitChange(item.id, idx, 'addQty', parseFloat(e.target.value) || 0)}
                                className="rdm-split-qty-input"
                              />
                              <SplitQtyBtn onClick={() => onNewItemSplitChange(item.id, idx, 'addQty', (parseFloat(s.addQty) || 0) + 1)}>+</SplitQtyBtn>
                            </div>
                          </div>
                        ))}
                        {(() => {
                          const splits = newForm.splits || [];
                          const totalAllocated = splits.reduce((sum, s) => sum + (parseFloat(s.addQty) || 0), 0);
                          const allocOk = Math.abs(totalAllocated - qty) < 0.001;
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                              <button type="button" onClick={() => onNewItemAddSplit(item.id)} className="rdm-split-add">
                                + Add location
                              </button>
                              <span className={`rdm-split-summary${allocOk ? ' is-complete' : ' is-incomplete'}`}>
                                {totalAllocated} of {qty} allocated{allocOk ? ' ✓' : ''}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {!isLoading && !hasMatch && !choice && (
                <div className="rdm-route-actions-row">
                  <button
                    type="button"
                    onClick={() => onSetNoMatchChoice(item.id, 'link')}
                    className="rdm-btn rdm-btn-ghost"
                  >
                    <Icon name="Search" style={{ width: 13, height: 13, marginRight: 5 }} />
                    Link to inventory
                  </button>
                  <button
                    type="button"
                    onClick={() => { onSetNoMatchChoice(item.id, 'create'); onInitNewItemForm(item.id, item); }}
                    className="rdm-btn rdm-btn-rust"
                  >
                    + Create new item
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetNoMatchChoice(item.id, 'skip')}
                    className="rdm-btn rdm-btn-quiet"
                  >
                    Skip
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {receivedItems.length === 0 && (
          <div className="rdm-empty">No items to push to inventory</div>
        )}
      </div>

      <div className="rdm-footer">
        <div className="rdm-footer-left">
          <button type="button" onClick={onBack} className="rdm-btn rdm-btn-ghost">
            ← Back
          </button>
        </div>
        <div className="rdm-footer-actions">
          {receivedItems.length === 0 ? (
            <button type="button" onClick={onComplete} className="rdm-btn rdm-btn-rust">
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={onPush}
              disabled={pushing}
              className="rdm-btn rdm-btn-sage"
            >
              {pushing ? 'Pushing…' : `Push to Inventory (${receivedItems.length})`}
            </button>
          )}
        </div>
      </div>
    </>
  );
};

// ── Main modal ────────────────────────────────────────────────────────────────

const ReceiveDeliveryModal = ({ list, items, tenantId, onClose, onComplete, multiBoard = false, boards = [] }) => {
  const { user } = useAuth();
  const userId = user?.id;

  const [step, setStep] = useState(1);
  const [receiving, setReceiving] = useState({});
  // Delivery note upload + AI parsing
  const [deliveryNoteFile, setDeliveryNoteFile] = useState(null);
  const [noteStatus, setNoteStatus] = useState('idle'); // 'idle'|'parsing'|'done'|'error'
  const [noteError, setNoteError] = useState(null);
  const [parsedNote, setParsedNote] = useState(null);
  // Map<item.id, { extractedQty, confidence, lineCount }>. Set by the OCR
  // handler; consumed by ReceiveStep's renderItemRow for the confidence
  // chip (sage vs amber "check match"), the "N lines merged" indicator
  // (when Bug-P aggregation summed multiple OCR lines into one row), and
  // the partial-receive remainder indicator (Feature C — shown when the
  // crew's entered qty is less than the OCR extractedQty).
  const [noteAutoFillData, setNoteAutoFillData] = useState(new Map());
  const [unmatchedItems, setUnmatchedItems] = useState([]);
  const originalUnmatchedRef = React.useRef([]);
  const [addedItems, setAddedItems] = useState([]); // items added via "Add to board"
  // Feature D — routing summary surfaced on Step 2. Populated by
  // handleSaveReceiving when the Tier-2 cross-dept routing runs.
  // Shape: { toOtherBoards: [{ itemName, boardTitle }], toDeliveryInbox: [{ itemName }] }
  // Null when nothing was routed; resets when the modal closes.
  const [routingSummary, setRoutingSummary] = useState(null);
  // Step-1 list ordering after OCR. Null when no doc has been processed —
  // ReceiveStep falls back to its existing supplier/board grouping in
  // that case. When non-null, the list renders as three frozen tiers:
  //   needsReview: medium/low-confidence OCR matches (sorted alpha)
  //   confirmed:   high-confidence matches + crew-added items
  //                (alpha within auto-matches; crew-added appended in
  //                 insertion order with NO re-sort — see brief)
  //   untouched:   board items the doc didn't mention (sorted alpha;
  //                collapsed by default in the UI)
  // Frozen at OCR-completion; never recomputed on qty edits, checkbox
  // toggles, or confidence-tier transitions. Crew-added items are
  // appended to confirmed at insertion time; existing rows never shift.
  const [frozenOrder, setFrozenOrder] = useState(null);
  const [matches, setMatches] = useState({});              // {[id]: row | 'loading' | null}
  const [locationSplits, setLocationSplits] = useState({}); // {[id]: [{locationName, currentQty, addQty}]}
  const [noMatchChoices, setNoMatchChoices] = useState({}); // {[id]: 'link'|'create'|'skip'|null}
  const [inlineLinks, setInlineLinks] = useState({});      // {[id]: inventoryRow}
  const [inlineSearch, setInlineSearch] = useState({});    // {[id]: {query, results, loading}}
  const [allLocations, setAllLocations] = useState([]);    // inventory_locations paths (category hierarchy)
  const [vesselLocations, setVesselLocations] = useState([]); // vessel_locations rows (physical storage)
  const [newItemForms, setNewItemForms] = useState({});    // {[id]: {name, brand, size, unit, barcode, categoryPath, splits}}
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const inlineSearchTimers = useRef({});

  // Initialise receiving state from current item data
  useEffect(() => {
    const init = {};
    items.forEach(item => {
      const alreadyReceived = item.status === 'received' || item.status === 'partial';
      init[item.id] = {
        checked: alreadyReceived,
        qty: item.quantity_received ?? item.quantity_ordered ?? 0,
      };
    });
    setReceiving(init);
  }, [items]);

  // When entering step 2, run matching for all checked items + fetch locations
  useEffect(() => {
    if (step !== 2) return;
    const checkedItems = items.filter(i => receiving[i.id]?.checked && (parseFloat(receiving[i.id]?.qty) || 0) > 0);
    setMatches({});
    setNoMatchChoices({});
    setInlineLinks({});
    setInlineSearch({});
    fetchAllInventoryLocations(tenantId).then(locs => setAllLocations(locs || []));
    fetchVesselLocations(tenantId).then(locs => setVesselLocations(locs || []));
    checkedItems.forEach(item => {
      setMatches(prev => ({ ...prev, [item.id]: 'loading' }));
      const receivedQty = parseFloat(receiving[item.id]?.qty) || 0;
      findMatchingInventoryItem(item, tenantId).then(match => {
        setMatches(prev => ({ ...prev, [item.id]: match || null }));
        if (match) {
          // Build splits from existing stock_locations; default all qty into first location
          const existingLocs = Array.isArray(match.stock_locations) ? match.stock_locations : [];
          let splits;
          if (existingLocs.length > 0) {
            splits = existingLocs.map((loc, i) => ({
              locationName: loc.locationName || loc.name || '',
              currentQty: loc.qty ?? loc.quantity ?? 0,
              addQty: i === 0 ? receivedQty : 0,
            }));
          } else {
            splits = [{ locationName: match.location || '', currentQty: 0, addQty: receivedQty }];
          }
          setLocationSplits(prev => ({ ...prev, [item.id]: splits }));
        }
      });
    });
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (id, field, value) => {
    setReceiving(prev => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [field]: value,
        // Auto-fill qty when ticking a checkbox
        ...(field === 'checked' && value && { qty: items.find(i => i.id === id)?.quantity_ordered ?? 0 }),
      },
    }));
  };

  const handleReceiveAll = () => {
    const next = {};
    items.forEach(item => { next[item.id] = { checked: true, qty: item.quantity_ordered ?? 0 }; });
    setReceiving(next);
  };

  const handleGroupChange = (itemIds, checked) => {
    setReceiving(prev => {
      const next = { ...prev };
      itemIds.forEach(id => {
        const item = [...items, ...addedItems].find(i => i.id === id);
        next[id] = { ...(prev[id] || {}), checked, qty: checked ? (item?.quantity_ordered ?? 0) : 0 };
      });
      return next;
    });
  };

  const handleFileSelect = async (file) => {
    if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10 MB)', 'error'); return; }
    // Resolve mediaType BEFORE setting any state — refuse the upload up
    // front if we can't determine a supported type. The previous code
    // defaulted to 'image/jpeg' for files whose .type was empty, which
    // silently mislabelled PDFs and caused Azure OCR to fail cryptically.
    const mediaType = resolveMediaType(file);
    if (!mediaType) {
      showToast('Unsupported file type. Use PDF, JPG, PNG, WebP, or HEIC.', 'error');
      return;
    }
    setDeliveryNoteFile(file);
    setNoteStatus('parsing');
    setNoteError(null);
    setParsedNote(null);
    setNoteAutoFillData(new Map());
    setUnmatchedItems([]);
    setFrozenOrder(null);  // re-OCR rebuilds the order from scratch in the success branch below
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const allItems = [...items, ...addedItems];
      console.log('[DeliveryNote] Sending to parseDeliveryNote — file:', file.name, 'file.type:', file.type, 'resolved mediaType:', mediaType, 'base64 chars:', base64.length, 'board items:', allItems.length);

      const { data: result, error: fnError } = await supabase.functions.invoke('parseDeliveryNote', {
        body: { base64, mediaType, batchItems: allItems },
      });

      if (fnError) {
        const msg = fnError?.message || fnError?.context?.errorMessage || String(fnError);
        console.error('[DeliveryNote] Edge function error:', msg);
        throw new Error(msg);
      }

      console.log('[DeliveryNote] Parsed result — invoice_number:', result?.invoice_number, 'supplier:', result?.supplier_name, 'line_items:', result?.line_items?.length);
      setParsedNote(result);
      setNoteStatus('done');

      // ── Bug P fix: aggregate OCR line_items by matched_item_id ──────────
      // PRE-FIX: each OCR line_item that mapped to a board item ran its own
      // setReceiving with `qty: li.quantity` — the second line that landed
      // on the same matched_item_id silently OVERWROTE the first qty (e.g.
      // two "Rope 10m" lines qty 2 + qty 3 → recorded as qty 3, losing 2).
      // FIX: build a Map keyed by matched_item_id, SUM the qtys, KEEP the
      // best confidence (high > medium > low), and track lineCount so the
      // row can surface a "N lines merged" indicator. State commits in one
      // shot after aggregation.
      const matchedAgg = new Map();  // item_id → { qty, lineCount, confidence, extractedQty }
      const unmatched = [];
      (result.line_items || []).forEach(li => {
        if (li.matched_item_id && li.match_confidence !== 'none') {
          const lineQty = parseFloat(li.quantity) || 0;
          const existing = matchedAgg.get(li.matched_item_id);
          if (existing) {
            existing.qty += lineQty;
            existing.extractedQty += lineQty;
            existing.lineCount += 1;
            existing.confidence = bestConfidence(existing.confidence, li.match_confidence);
          } else {
            const boardItem = allItems.find(i => i.id === li.matched_item_id);
            const seedQty = lineQty || (parseFloat(boardItem?.quantity_ordered) || 0);
            matchedAgg.set(li.matched_item_id, {
              qty: seedQty,
              extractedQty: lineQty,  // pure OCR sum; used for partial-receive indicator
              lineCount: 1,
              confidence: li.match_confidence,
            });
          }
        } else {
          unmatched.push(li);
        }
      });

      // Apply aggregated qtys to receiving state in one setReceiving call.
      if (matchedAgg.size > 0) {
        setReceiving(prev => {
          const next = { ...prev };
          matchedAgg.forEach((agg, itemId) => {
            next[itemId] = { ...(next[itemId] || {}), checked: true, qty: agg.qty };
          });
          return next;
        });
      }

      // noteAutoFillData (Map) carries per-item OCR context for the row
      // renderer: confidence chip variant, "N lines merged" badge, and the
      // extractedQty used by the partial-receive remainder indicator.
      const fillData = new Map();
      matchedAgg.forEach((agg, itemId) => {
        fillData.set(itemId, {
          extractedQty: agg.extractedQty,
          confidence: agg.confidence,
          lineCount: agg.lineCount,
        });
      });
      setNoteAutoFillData(fillData);
      setUnmatchedItems(unmatched);
      originalUnmatchedRef.current = unmatched;

      // Freeze the Step-1 list ordering. Runs exactly ONCE per OCR
      // completion — never recomputed on qty edits, checkbox toggles,
      // or confidence-tier transitions. The crew's edits don't make
      // rows jump around mid-task. Crew-added items append to the
      // bottom of `confirmed` later in handleAddUnmatched.
      const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
      const needsReview = [];
      const confirmed = [];
      const untouched = [];
      for (const item of allItems) {
        const fill = fillData.get(item.id);
        if (!fill) {
          untouched.push(item);
        } else if (fill.confidence === 'medium' || fill.confidence === 'low') {
          needsReview.push(item);
        } else {
          // 'high' or 'added' — both go to Confirmed (Lauren's call: the
          // tier semantic is "no open decision", not "matched-against-board").
          confirmed.push(item);
        }
      }
      setFrozenOrder({
        needsReview: needsReview.sort(byName).map(i => i.id),
        confirmed:   confirmed.sort(byName).map(i => i.id),
        untouched:   untouched.sort(byName).map(i => i.id),
      });
    } catch (err) {
      console.error('[parseNote] error:', err);
      setNoteError(err.message || 'Unknown error');
      setNoteStatus('error');
    }
  };

  const handleRemoveNote = () => {
    setDeliveryNoteFile(null);
    setNoteStatus('idle');
    setNoteError(null);
    setParsedNote(null);
    setNoteAutoFillData(new Map());
    setUnmatchedItems([]);
    originalUnmatchedRef.current = [];
    setFrozenOrder(null);  // back to supplier-grouped alphabetical fallback
  };

  const handleAddUnmatched = async (li, idx) => {
    try {
      const [saved] = await upsertItems([{
        list_id: list?.id,
        name: li.raw_name,
        quantity_ordered: li.quantity || 1,
        unit: li.unit || 'each',
        estimated_unit_cost: li.unit_price || null,
        status: 'draft',
        source: 'manual',
      }]);
      if (!saved) return;
      setAddedItems(prev => [...prev, saved]);
      setReceiving(prev => ({ ...prev, [saved.id]: { checked: true, qty: li.quantity || 1 } }));
      // Manually-added items (from the unmatched section) get a sentinel
      // confidence='added' so the row renderer shows a "📄 from doc" chip
      // distinct from auto-matched items. lineCount=1 (no aggregation),
      // extractedQty=line's qty so the row can still surface a partial-
      // receive indicator if the crew enters less than the document said.
      setNoteAutoFillData(prev => {
        const next = new Map(prev);
        next.set(saved.id, {
          extractedQty: parseFloat(li.quantity) || 0,
          confidence: 'added',
          lineCount: 1,
        });
        return next;
      });
      // Append to the bottom of Confirmed in insertion order. No re-sort —
      // existing rows in the tier do not shift, preserving the freeze
      // semantic. Only relevant when frozenOrder is active (post-OCR).
      setFrozenOrder(prev => prev ? ({
        ...prev,
        confirmed: [...prev.confirmed, saved.id],
      }) : prev);
      setUnmatchedItems(prev => prev.filter((_, i) => i !== idx));
    } catch {
      showToast('Failed to add item to board', 'error');
    }
  };

  const handleSkipUnmatched = (idx) => {
    setUnmatchedItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSaveReceiving = async () => {
    // ── Bug E guard: multi-board orphan check ──────────────────────────────
    // In multi-board mode every checked item MUST carry a _boardId so we
    // can create its provisioning_deliveries batch and delivery_ledger
    // entry. Items lacking _boardId would otherwise have their
    // provisioning_items.status updated by receiveItems but get no batch
    // row and no ledger entry — silent data loss. Refuse to start any
    // writes; the modal can't recover, the parent component needs fixing.
    // Hard refuse + explicit toast over silent skip.
    if (multiBoard) {
      const checkedItems = [...items, ...addedItems].filter(i => receiving[i.id]?.checked);
      const orphans = checkedItems.filter(i => !i._boardId);
      if (orphans.length > 0) {
        const sample = orphans.slice(0, 3).map(i => i.name).filter(Boolean).join(', ');
        const more = orphans.length > 3 ? ` and ${orphans.length - 3} more` : '';
        const noun = orphans.length === 1 ? 'item is' : 'items are';
        showToast(
          `Can't save — ${orphans.length} ${noun} missing a board assignment (${sample}${more}). Close and reopen this receive from a specific board.`,
          'error'
        );
        return;
      }
    }

    setSaving(true);
    try {
      // Build full update list (includes items added via "Add to board" from delivery note)
      const updates = [...items, ...addedItems].map(item => {
        const r = receiving[item.id] || {};
        const qty = r.checked ? Math.max(0, parseFloat(r.qty) || 0) : 0;
        const ordered = parseFloat(item.quantity_ordered) || 0;
        return {
          id: item.id,
          quantity_received: qty,
          status: deriveStatus(qty, ordered),
          supplier_name: item.supplier_name || null,
          estimated_unit_cost: item.estimated_unit_cost,
          _boardId: item._boardId || list?.id || null,
        };
      });

      const receivedUpdates = updates.filter(u => u.quantity_received > 0);

      const today = new Date().toISOString().split('T')[0];
      let firstBatchId = null; // used for delivery note attachment

      if (multiBoard) {
        // Multi-board mode: one batch per board. The guard at the top of
        // handleSaveReceiving refuses to enter this code path if any
        // checked item lacks _boardId, so 'unknown' should never appear
        // here. The throw below is defence-in-depth — if a future refactor
        // weakens the guard, this fails LOUD instead of silently dropping
        // items into a no-batch / no-ledger black hole (the pre-Pass-2 bug).
        const byBoard = {};
        receivedUpdates.forEach(u => {
          const key = u._boardId || 'unknown';
          if (!byBoard[key]) byBoard[key] = [];
          byBoard[key].push(u);
        });

        for (const [boardId, boardItems] of Object.entries(byBoard)) {
          if (boardId === 'unknown') {
            throw new Error(`ReceiveDeliveryModal: ${boardItems.length} received item${boardItems.length === 1 ? '' : 's'} reached batch creation without a _boardId. The save-boundary guard should have caught this — please reload and try again.`);
          }
          const cost = boardItems.reduce(
            (sum, u) => sum + (parseFloat(u.estimated_unit_cost) || 0) * (u.quantity_received || 0), 0
          );
          const supplierName = parsedNote?.supplier_name || null;
          const batch = await createDeliveryBatch({
            listId: boardId, tenantId, userId,
            supplierName,
            totalCost: cost || null,
            portLocation: null,
            supplierPhone: parsedNote?.supplier_phone || null,
            supplierEmail: parsedNote?.supplier_email || null,
            supplierAddress: parsedNote?.supplier_address || null,
            orderRef: parsedNote?.order_ref || null,
            orderDate: parsedNote?.order_date || null,
            deliveryNoteRef: parsedNote?.invoice_number || null,
          });
          const batchId = batch?.id || null;
          if (!batchId) {
            console.error('[ReceiveDeliveryModal] batch creation failed for board:', boardId);
          }
          if (!firstBatchId && batchId) firstBatchId = batchId;

          await receiveItems(boardItems.map(u => ({
            id: u.id,
            quantity_received: u.quantity_received,
            status: u.status,
            ...(batchId ? { receive_batch_id: batchId } : {}),
          })));
        }
      } else {
        // Single-board mode: group by supplier, reusing existing same-day batches
        const bySupplier = {};
        receivedUpdates.forEach(u => {
          const key = u.supplier_name?.trim() || 'Manual receive';
          if (!bySupplier[key]) bySupplier[key] = [];
          bySupplier[key].push(u);
        });

        for (const [supplierName, supplierItems] of Object.entries(bySupplier)) {
          // Reuse existing batch for same supplier + same day
          const { data: existing } = await supabase
            ?.from('provisioning_deliveries')
            ?.select('id')
            ?.eq('list_id', list?.id)
            ?.eq('supplier_name', supplierName)
            ?.gte('received_at', `${today}T00:00:00Z`)
            ?.lt('received_at', `${today}T23:59:59Z`)
            ?.limit(1)
            ?.maybeSingle();

          let batchId = existing?.id || null;
          if (!batchId) {
            const cost = supplierItems.reduce(
              (sum, u) => sum + (parseFloat(u.estimated_unit_cost) || 0) * (u.quantity_received || 0), 0
            );
            const batch = await createDeliveryBatch({
              listId: list?.id, tenantId, userId,
              supplierName,
              totalCost: cost || null,
              portLocation: list?.port_location || null,
              supplierPhone: parsedNote?.supplier_phone || null,
              supplierEmail: parsedNote?.supplier_email || null,
              supplierAddress: parsedNote?.supplier_address || null,
              orderRef: parsedNote?.order_ref || null,
              orderDate: parsedNote?.order_date || null,
              deliveryNoteRef: parsedNote?.invoice_number || null,
            });
            batchId = batch?.id || null;
            if (!batchId) {
              console.error('[ReceiveDeliveryModal] batch creation failed for supplier:', supplierName);
              showToast(`Batch creation failed for "${supplierName}" — items saved without batch link`, 'error');
            }
          }

          if (!firstBatchId && batchId) firstBatchId = batchId;

          await receiveItems(supplierItems.map(u => ({
            id: u.id,
            quantity_received: u.quantity_received,
            status: u.status,
            ...(batchId ? { receive_batch_id: batchId } : {}),
          })));
        }
      }

      // Persist status for unchecked (not_received) items
      const nonReceived = updates.filter(u => u.quantity_received === 0);
      if (nonReceived.length > 0) {
        await receiveItems(nonReceived.map(u => ({
          id: u.id,
          quantity_received: u.quantity_received,
          status: u.status,
        })));
      }

      // Upload delivery note to first batch (non-blocking)
      let uploadedNoteUrl = null;
      if (firstBatchId && deliveryNoteFile) {
        try {
          const url = await uploadInvoiceFile(deliveryNoteFile, firstBatchId);
          if (url) {
            uploadedNoteUrl = url;
            await supabase?.from('provisioning_deliveries')
              ?.update({ invoice_file_url: url, parsed_data: parsedNote })
              ?.eq('id', firstBatchId);
          }
        } catch { /* non-fatal */ }
      }

      // ── Write to permanent delivery ledger (fire-and-forget) ──────────────
      createLedgerEntry({
        tenantId,
        sourceType:       parsedNote
          ? (parsedNote.document_type === 'receipt' ? 'receipt' : 'delivery')
          : 'manual',
        sourceBoardId:    multiBoard ? null : list?.id,
        sourceBatchId:    firstBatchId,
        supplierName:     parsedNote?.supplier_name || null,
        supplierPhone:    parsedNote?.supplier_phone || null,
        supplierEmail:    parsedNote?.supplier_email || null,
        supplierAddress:  parsedNote?.supplier_address || null,
        orderRef:         parsedNote?.order_ref || null,
        orderDate:        parsedNote?.order_date || null,
        invoiceNumber:    parsedNote?.invoice_number || null,
        deliveryNoteRef:  parsedNote?.invoice_number || null,
        documentUrl:      uploadedNoteUrl,
        documentType:     parsedNote?.document_type || null,
        totalAmount:      parsedNote?.total_amount || null,
        currency:         parsedNote?.currency || null,
        receivedBy:       user?.id,
        items: [
          ...receivedUpdates.map(u => ({
            raw_name:         u.name,
            quantity:         u.quantity_received,
            ordered_qty:      u.quantity_ordered ?? null,
            unit:             u.unit ?? null,
            unit_price:       u.estimated_unit_cost ?? null,
            line_total:       (u.estimated_unit_cost && u.quantity_received)
                                ? parseFloat(u.estimated_unit_cost) * parseFloat(u.quantity_received)
                                : null,
            claimed_board_id: u._boardId || list?.id || null,
            claimed_item_id:  u.id,
            match_confidence: 'high',
          })),
          ...(originalUnmatchedRef.current || []).map(li => ({
            raw_name:        li.raw_name,
            original_name:   li.original_name || null,
            item_reference:  li.item_reference || null,
            quantity:        li.quantity || 1,
            unit_price:      li.unit_price || null,
            line_total:      li.line_total || null,
            unit:            li.unit || null,
            match_confidence: 'none',
          })),
        ],
      }).catch(err => console.error('[ReceiveDeliveryModal] ledger write error:', err));

      // ── Tier 2+3: Route unmatched items to other departments / inbox ──
      const unmatchedForRouting = originalUnmatchedRef.current.filter(li => {
        // Exclude items the user already added to their own board
        return !addedItems.some(added => added.name?.toLowerCase() === li.raw_name?.toLowerCase());
      });

      // Skip cross-department routing for receipts — already logged in delivery history
      const isReceipt = parsedNote?.document_type === 'receipt';

      if (unmatchedForRouting.length > 0 && !isReceipt) {
        try {
          // Skip cross-dept matching if this batch already has matches (prevents duplicates on re-scan)
          let skipCrossDept = false;
          if (firstBatchId) {
            const { count } = await supabase
              ?.from('cross_department_matches')
              ?.select('id', { count: 'exact', head: true })
              ?.eq('delivery_batch_id', firstBatchId);
            if (count > 0) skipCrossDept = true;
          }
          if (!skipCrossDept) {
          const result = await triggerCrossDepartmentMatch({
            unmatchedItems: unmatchedForRouting.map(li => ({
              raw_name: li.raw_name,
              item_reference: li.item_reference || null,
              quantity: li.quantity || 1,
              ordered_qty: li.ordered_qty || null,
              unit_price: li.unit_price || null,
              unit: li.unit || null,
              line_total: li.line_total || null,
            })),
            tenantId: tenantId || list?.tenant_id,
            scannedBy: user?.id,
            scannerBoardIds: multiBoard
              ? [...new Set(items.map(i => i._boardId).filter(Boolean))]
              : [list?.id],
            deliveryBatchId: firstBatchId,
            supplierName: parsedNote?.supplier_name || null,
            supplierPhone: parsedNote?.supplier_phone || null,
            supplierEmail: parsedNote?.supplier_email || null,
            supplierAddress: parsedNote?.supplier_address || null,
            orderRef: parsedNote?.order_ref || null,
            orderDate: parsedNote?.order_date || null,
            deliveryNoteUrl: uploadedNoteUrl,
            deliveryNoteRef: parsedNote?.invoice_number || null,
          });
          if (result.crossMatched > 0) {
            showToast(`${result.crossMatched} item${result.crossMatched > 1 ? 's' : ''} matched other departments — HODs notified`, 'info');
            // Notify each matched board's target user
            try {
              const { data: newMatches } = await supabase
                ?.from('cross_department_matches')
                ?.select('target_user_id, matched_board_id, matched_board:provisioning_lists(id, title)')
                ?.eq('delivery_batch_id', firstBatchId)
                ?.eq('status', 'pending');
              const byBoard = {};
              (newMatches || []).forEach(m => {
                const bid = m.matched_board_id;
                if (!bid) return;
                if (!byBoard[bid]) byBoard[bid] = { title: m.matched_board?.title || 'a board', userIds: new Set() };
                if (m.target_user_id) byBoard[bid].userIds.add(m.target_user_id);
              });
              for (const [boardId, { title, userIds }] of Object.entries(byBoard)) {
                const ids = [...userIds];
                if (ids.length > 0) {
                  sendNotification(ids, {
                    type: NOTIFICATION_TYPES.DELIVERY_CROSS_MATCH,
                    title: 'Delivery items matched your board',
                    message: `${(newMatches || []).filter(m => m.matched_board_id === boardId).length} item${(newMatches || []).filter(m => m.matched_board_id === boardId).length !== 1 ? 's' : ''} from a scanned delivery match your "${title}" board`,
                    severity: SEVERITY.INFO,
                    actionUrl: `/provisioning/${boardId}`,
                  });
                }
              }
            } catch { /* non-fatal */ }
          }
          if (result.inboxed > 0) {
            showToast(`${result.inboxed} item${result.inboxed > 1 ? 's' : ''} unmatched — sent to Delivery Inbox`, 'warning');
            // Notify all tenant users about unclaimed inbox items
            try {
              const currentTenantId = tenantId || list?.tenant_id;
              if (currentTenantId) {
                const { data: profiles } = await supabase?.from('profiles')?.select('id')?.eq('tenant_id', currentTenantId);
                const userIds = (profiles || []).map(p => p.id).filter(Boolean);
                if (userIds.length > 0) {
                  sendNotification(userIds, {
                    type: NOTIFICATION_TYPES.DELIVERY_INBOX_ITEM,
                    title: 'Unclaimed delivery items',
                    message: `${result.inboxed} item${result.inboxed !== 1 ? 's' : ''} from a scanned delivery couldn't be matched to any board`,
                    severity: SEVERITY.WARN,
                    actionUrl: '/provisioning/inbox',
                  });
                }
              }
            } catch { /* non-fatal */ }
          }
          } // end if (!skipCrossDept)
        } catch (err) {
          console.error('[ReceiveDeliveryModal] cross-department match error:', err);
        }
      }

      // ── Tier 2+3: Route partial-receive remainders (received < extracted qty) ──
      if (parsedNote?.line_items?.length > 0) {
        const remainderItems = [];
        for (const li of parsedNote.line_items) {
          if (!li.matched_item_id || li.match_confidence === 'none') continue;
          const receivedUpdate = receivedUpdates.find(u => u.id === li.matched_item_id);
          if (!receivedUpdate) continue;
          const extractedQty = parseFloat(li.quantity) || 0;
          const receivedQty = receivedUpdate.quantity_received || 0;
          if (extractedQty > 0 && receivedQty < extractedQty) {
            remainderItems.push({
              raw_name: li.raw_name || li.description || li.name || 'Unknown item',
              item_reference: li.item_reference || null,
              quantity: extractedQty - receivedQty,
              ordered_qty: li.ordered_qty || null,
              unit_price: li.unit_price || null,
              unit: li.unit || null,
              line_total: li.line_total || null,
            });
          }
        }
        if (remainderItems.length > 0) {
          try {
            const remainderResult = await triggerCrossDepartmentMatch({
              unmatchedItems: remainderItems,
              tenantId: tenantId || list?.tenant_id,
              scannedBy: user?.id,
              scannerBoardIds: multiBoard
                ? [...new Set(items.map(i => i._boardId).filter(Boolean))]
                : [list?.id],
              deliveryBatchId: firstBatchId,
              supplierName: parsedNote?.supplier_name || null,
              supplierPhone: parsedNote?.supplier_phone || null,
              supplierEmail: parsedNote?.supplier_email || null,
              supplierAddress: parsedNote?.supplier_address || null,
              orderRef: parsedNote?.order_ref || null,
              orderDate: parsedNote?.order_date || null,
              deliveryNoteUrl: uploadedNoteUrl,
              deliveryNoteRef: parsedNote?.invoice_number || null,
            });
            if (remainderResult.crossMatched > 0) {
              showToast(`${remainderResult.crossMatched} partial shortfall${remainderResult.crossMatched !== 1 ? 's' : ''} routed to other departments`, 'info');
            } else if (remainderResult.inboxed > 0) {
              showToast(`${remainderResult.inboxed} partial shortfall${remainderResult.inboxed !== 1 ? 's' : ''} sent to Delivery Inbox`, 'warning');
            }
          } catch (err) {
            console.error('[ReceiveDeliveryModal] partial remainder routing error:', err);
          }
        }
      }

      // ── Feature D — capture routing summary for the Step 2 panel ──────────
      // Surfaces WHICH items routed WHERE — the existing toasts only show
      // counts. Queries cross_department_matches + delivery_inbox by the
      // shared delivery_batch_id, so it captures rows from BOTH the initial
      // unmatched-routing call and the partial-receive remainder call.
      // Non-fatal: if the queries fail we just don't show the panel; the
      // routing itself already happened.
      if (firstBatchId) {
        try {
          const [crossRes, inboxRes] = await Promise.all([
            supabase
              ?.from('cross_department_matches')
              ?.select('raw_name, matched_board:provisioning_lists(title)')
              ?.eq('delivery_batch_id', firstBatchId)
              ?.eq('status', 'pending'),
            supabase
              ?.from('delivery_inbox')
              ?.select('raw_name')
              ?.eq('delivery_batch_id', firstBatchId)
              ?.eq('status', 'pending'),
          ]);
          const toOtherBoards = (crossRes?.data || [])
            .filter(r => r.raw_name && r.matched_board?.title)
            .map(r => ({ itemName: r.raw_name, boardTitle: r.matched_board.title }));
          const toDeliveryInbox = (inboxRes?.data || [])
            .filter(r => r.raw_name)
            .map(r => ({ itemName: r.raw_name }));
          if (toOtherBoards.length > 0 || toDeliveryInbox.length > 0) {
            setRoutingSummary({ toOtherBoards, toDeliveryInbox });
          }
        } catch (err) {
          console.error('[ReceiveDeliveryModal] routing-summary capture failed:', err);
        }
      }

      // Log activity for this delivery receive
      logActivity({
        module: 'provisioning',
        action: 'PROVISION_DELIVERY_SCANNED',
        entityType: 'provisioning_list',
        entityId: multiBoard ? (boards[0]?.id || null) : list?.id,
        summary: `received a delivery${parsedNote?.supplier_name ? ` from ${parsedNote.supplier_name}` : ''} on "${multiBoard ? 'all boards' : list?.title}"`,
        meta: {
          board_id: multiBoard ? null : list?.id,
          board_title: multiBoard ? 'all boards' : list?.title,
          boards_count: multiBoard ? boards.length : 1,
          items_received: receivedUpdates.length,
          items_unmatched: originalUnmatchedRef.current.length,
          supplier: parsedNote?.supplier_name || null,
          delivery_batch_id: firstBatchId,
        },
      });

      setStep(2);
    } catch (err) {
      console.error('[ReceiveDeliveryModal] save error:', err);
      showToast('Failed to save receiving data', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSplitChange = (itemId, splitIdx, field, value) => {
    setLocationSplits(prev => {
      const splits = [...(prev[itemId] || [])];
      splits[splitIdx] = { ...splits[splitIdx], [field]: value };
      return { ...prev, [itemId]: splits };
    });
  };

  const handleAddSplitLocation = (itemId) => {
    setLocationSplits(prev => ({
      ...prev,
      [itemId]: [...(prev[itemId] || []), { locationName: '', currentQty: 0, addQty: 0 }],
    }));
  };

  const handleRemoveSplitLocation = (itemId, idx) => {
    setLocationSplits(prev => {
      const splits = [...(prev[itemId] || [])];
      splits.splice(idx, 1);
      return { ...prev, [itemId]: splits };
    });
  };

  const handleSetNoMatchChoice = (itemId, choice) => {
    setNoMatchChoices(prev => ({ ...prev, [itemId]: choice }));
  };

  const handleInlineSearchChange = (itemId, query) => {
    setInlineSearch(prev => ({ ...prev, [itemId]: { ...(prev[itemId] || {}), query, loading: true } }));
    clearTimeout(inlineSearchTimers.current[itemId]);
    if (!query.trim()) {
      setInlineSearch(prev => ({ ...prev, [itemId]: { query, results: [], loading: false } }));
      return;
    }
    inlineSearchTimers.current[itemId] = setTimeout(async () => {
      const results = await searchInventoryItems(query, tenantId);
      setInlineSearch(prev => ({ ...prev, [itemId]: { query, results: results || [], loading: false } }));
    }, 300);
  };

  const handleInlineLink = (itemId, invItem) => {
    setInlineLinks(prev => ({ ...prev, [itemId]: invItem }));
    setNoMatchChoices(prev => ({ ...prev, [itemId]: 'link' }));
    const receivedQty = parseFloat(receiving[itemId]?.qty) || 0;
    const existingLocs = Array.isArray(invItem.stock_locations) ? invItem.stock_locations : [];
    let splits;
    if (existingLocs.length > 0) {
      splits = existingLocs.map((loc, i) => ({
        locationName: loc.locationName || loc.name || '',
        currentQty: loc.qty ?? loc.quantity ?? 0,
        addQty: i === 0 ? receivedQty : 0,
      }));
    } else {
      splits = [{ locationName: invItem.location || '', currentQty: 0, addQty: receivedQty }];
    }
    setLocationSplits(prev => ({ ...prev, [itemId]: splits }));
  };

  const handleInitNewItemForm = (itemId, provItem) => {
    const qty = parseFloat(receiving[itemId]?.qty) || 0;
    setNewItemForms(prev => ({
      ...prev,
      [itemId]: {
        name: provItem.name || '',
        brand: provItem.brand || '',
        size: provItem.size || '',
        unit: provItem.unit || 'bottle',
        barcode: provItem.barcode || '',
        categoryPath: '',                                       // inventory hierarchy
        splits: [{ locationName: '', addQty: qty }],           // physical storage split rows
      },
    }));
  };

  const handleNewItemFormChange = (itemId, field, value) => {
    setNewItemForms(prev => ({ ...prev, [itemId]: { ...(prev[itemId] || {}), [field]: value } }));
  };

  const handleNewItemSplitChange = (itemId, idx, field, value) => {
    setNewItemForms(prev => {
      const form = { ...(prev[itemId] || {}) };
      const splits = [...(form.splits || [])];
      splits[idx] = { ...splits[idx], [field]: value };
      return { ...prev, [itemId]: { ...form, splits } };
    });
  };

  const handleNewItemAddSplit = (itemId) => {
    setNewItemForms(prev => {
      const form = { ...(prev[itemId] || {}) };
      return { ...prev, [itemId]: { ...form, splits: [...(form.splits || []), { locationName: '', addQty: 0 }] } };
    });
  };

  const handleNewItemRemoveSplit = (itemId, idx) => {
    setNewItemForms(prev => {
      const form = { ...(prev[itemId] || {}) };
      const splits = [...(form.splits || [])];
      splits.splice(idx, 1);
      return { ...prev, [itemId]: { ...form, splits } };
    });
  };

  // Unlink an auto-matched item → falls through to 3-option no-match panel
  const handleUnlinkMatch = (itemId) => {
    setMatches(prev => ({ ...prev, [itemId]: null }));
    setLocationSplits(prev => { const n = { ...prev }; delete n[itemId]; return n; });
    setNoMatchChoices(prev => ({ ...prev, [itemId]: null }));
  };

  // Unlink an inline-linked item → returns to search widget
  const handleUnlinkInline = (itemId) => {
    setInlineLinks(prev => { const n = { ...prev }; delete n[itemId]; return n; });
    setLocationSplits(prev => { const n = { ...prev }; delete n[itemId]; return n; });
    setNoMatchChoices(prev => ({ ...prev, [itemId]: 'link' }));  // stay in link mode but with no link selected
  };

  const handlePushToInventory = async () => {
    setPushing(true);
    const receivedItems = items.filter(i => receiving[i.id]?.checked && (parseFloat(receiving[i.id]?.qty) || 0) > 0);
    let pushed = 0, skipped = 0;

    for (const item of receivedItems) {
      const qty = parseFloat(receiving[item.id]?.qty) || 0;
      const match = matches[item.id];
      const choice = noMatchChoices[item.id] || null;
      const inlineLink = inlineLinks[item.id] || null;

      // Path 1: auto-matched to inventory item
      if (match && typeof match === 'object') {
        const splits = locationSplits[item.id] || [{ locationName: match.location || '', currentQty: 0, addQty: qty }];
        const ok = await pushReceivedSplitsToInventory({ inventoryItemId: match.id, splits, tenantId, provisioningItemId: item.id, listId: item.list_id || null, unit: item.unit, size: item.size });
        if (ok) {
          try { await supabase?.from('provisioning_items')?.update({ inventory_item_id: match.id })?.eq('id', item.id); } catch { /* non-fatal */ }
          pushed++;
        } else {
          skipped++;
        }
        continue;
      }

      // Path 2: user manually linked to inventory item
      if (choice === 'link' && inlineLink) {
        const splits = locationSplits[item.id] || [{ locationName: inlineLink.location || '', currentQty: 0, addQty: qty }];
        const ok = await pushReceivedSplitsToInventory({ inventoryItemId: inlineLink.id, splits, tenantId, provisioningItemId: item.id, listId: item.list_id || null, unit: item.unit, size: item.size });
        if (ok) {
          try { await supabase?.from('provisioning_items')?.update({ inventory_item_id: inlineLink.id })?.eq('id', item.id); } catch { /* non-fatal */ }
          pushed++;
        } else {
          skipped++;
        }
        continue;
      }

      // Path 3: create new inventory item
      if (choice === 'create') {
        const form = newItemForms[item.id];
        const hasSplits = (form?.splits || []).some(s => (s.locationName || '').trim() && (parseFloat(s.addQty) || 0) > 0);
        if (form?.name && (form?.categoryPath || hasSplits)) {
          const created = await createInventoryItemFromProvItem({
            provItem: { ...item, name: form.name, brand: form.brand || item.brand, size: form.size || item.size, unit: form.unit || item.unit, barcode: form.barcode || item.barcode },
            categoryPath: form.categoryPath || null,
            storageLocations: form.splits || [],
            qty,
            tenantId,
            userId,
          });
          if (created) pushed++;
          else skipped++;
        } else {
          skipped++;
        }
        continue;
      }

      // Path 4: skip
      skipped++;
    }

    setPushing(false);
    if (pushed > 0) showToast(`${pushed} item${pushed > 1 ? 's' : ''} pushed to inventory`, 'success');
    if (skipped > 0) showToast(`${skipped} item${skipped > 1 ? 's' : ''} skipped`, 'info');
    onComplete?.();
  };

  const checkedCount = items.filter(i => receiving[i.id]?.checked).length;

  // Dirty signal — user has progressed past the initial upload step, or
  // ticked / typed into any receiving row, or attached a delivery note,
  // or added an unmatched item.
  const isDirty = (
    step > 1 ||
    !!deliveryNoteFile ||
    addedItems.length > 0 ||
    Object.values(receiving || {}).some(r => r && (r.checked || (r.qty != null && r.qty !== '') || (r.notes || '').length > 0))
  );

  // Two-pill PRESENTATIONAL step indicator. Reads `step` from state;
  // does NOT navigate when clicked — the pills are <span>s, not buttons,
  // so the crew can't skip the save logic by jumping ahead.
  const stepConfig = [
    { n: 1, label: 'Receive' },
    { n: 2, label: 'Push to inventory' },
  ];

  return (
    <ModalShell
      onClose={onClose}
      isDirty={isDirty}
      isBusy={saving || pushing}
      panelClassName="pv-dashboard"
      panelStyle={{
        background: 'var(--d-bg)',
        borderRadius: 16,
        borderBottom: '5px solid var(--d-card-edge)',
        boxShadow: '0 24px 64px rgba(38, 42, 83, 0.18)',
        width: '100%', maxWidth: 720, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      <div className="rdm pv-dashboard" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        {/* Modal header — title block + presentational stepper + close */}
        <div style={{ padding: '22px 28px 0' }}>
          <div className="rdm-header">
            <div className="rdm-title-block">
              <p className="rdm-eyebrow">{multiBoard ? `All boards · ${items.length} items` : (list?.title || 'Receive')}</p>
              <h2 className="rdm-title">Receive items</h2>
            </div>
            <div className="rdm-stepper" aria-label={`Step ${step} of ${stepConfig.length}`}>
              {stepConfig.map(({ n, label }, idx) => {
                const isActive = step === n;
                const isDone = step > n;
                const cls = `rdm-step${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}`;
                return (
                  <React.Fragment key={n}>
                    <span className={cls} aria-current={isActive ? 'step' : undefined}>
                      <span className="rdm-step-num">{isDone ? '✓' : n}</span>
                      <span>{label}</span>
                    </span>
                    {idx < stepConfig.length - 1 && <span className="rdm-step-connector" aria-hidden="true" />}
                  </React.Fragment>
                );
              })}
            </div>
            <button onClick={onClose} className="rdm-icon-btn" aria-label="Close" style={{ alignSelf: 'flex-start' }}>
              <Icon name="X" style={{ width: 18, height: 18 }} />
            </button>
          </div>
        </div>

        {/* Step content — scrolls; footer-per-step is rendered inside each step */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px 24px' }}>
        {step === 1 ? (
          <ReceiveStep
            items={[...items, ...addedItems]}
            receiving={receiving}
            onChange={handleChange}
            onGroupChange={handleGroupChange}
            onReceiveAll={handleReceiveAll}
            onNext={handleSaveReceiving}
            onClose={onClose}
            saving={saving}
            deliveryNoteFile={deliveryNoteFile}
            noteStatus={noteStatus}
            parsedNote={parsedNote}
            noteAutoFillData={noteAutoFillData}
            frozenOrder={frozenOrder}
            unmatchedItems={unmatchedItems}
            noteError={noteError}
            onFileSelect={handleFileSelect}
            onRemoveNote={handleRemoveNote}
            onAddUnmatched={handleAddUnmatched}
            onSkipUnmatched={handleSkipUnmatched}
            multiBoard={multiBoard}
          />
        ) : (
          <PushStep
            items={items}
            receiving={receiving}
            matches={matches}
            locationSplits={locationSplits}
            onSplitChange={handleSplitChange}
            onAddSplitLocation={handleAddSplitLocation}
            onRemoveSplitLocation={handleRemoveSplitLocation}
            noMatchChoices={noMatchChoices}
            inlineLinks={inlineLinks}
            inlineSearch={inlineSearch}
            allLocations={allLocations}
            vesselLocations={vesselLocations}
            onSetNoMatchChoice={handleSetNoMatchChoice}
            onInlineSearchChange={handleInlineSearchChange}
            onInlineLink={handleInlineLink}
            onUnlinkMatch={handleUnlinkMatch}
            onUnlinkInline={handleUnlinkInline}
            newItemForms={newItemForms}
            onInitNewItemForm={handleInitNewItemForm}
            onNewItemFormChange={handleNewItemFormChange}
            onNewItemSplitChange={handleNewItemSplitChange}
            onNewItemAddSplit={handleNewItemAddSplit}
            onNewItemRemoveSplit={handleNewItemRemoveSplit}
            onPush={handlePushToInventory}
            onBack={() => setStep(1)}
            onComplete={onComplete}
            pushing={pushing}
            routingSummary={routingSummary}
            onDismissRoutingSummary={() => setRoutingSummary(null)}
          />
        )}
        </div>
      </div>
    </ModalShell>
  );
};

export default ReceiveDeliveryModal;

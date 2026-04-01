import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
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
} from '../utils/provisioningStorage';
import { useAuth } from '../../../contexts/AuthContext';
import { UNIT_GROUPS } from './DetailTableCells';

// ── Helpers ───────────────────────────────────────────────────────────────────

const deriveStatus = (qty, ordered) => {
  if (!qty || qty <= 0) return 'not_received';
  if (qty >= ordered) return 'received';
  return 'partial';
};

const STATUS_PILL = {
  received:     { label: 'Received',     bg: '#ECFDF5', color: '#047857' },
  partial:      { label: 'Partial',      bg: '#FEF3E2', color: '#B45309' },
  not_received: { label: 'Not received', bg: '#FEF2F2', color: '#DC2626' },
};

const ICON_BTN = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
  color: '#94A3B8', display: 'flex', alignItems: 'center',
};

// ── Hierarchical location picker ─────────────────────────────────────────────

const LocationPicker = ({ value, onChange, locations = [], borderColor = '#e2e8f0', placeholder = 'Select location…' }) => {
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
    <div ref={ref} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <button
        onClick={() => { setOpen(v => !v); setPrefix(''); }}
        style={{
          width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center',
          fontSize: 12, padding: '4px 8px', border: `1px solid ${borderColor}`, borderRadius: 6,
          background: 'white', color: value ? '#0F172A' : '#94A3B8', cursor: 'pointer', gap: 4,
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || placeholder}</span>
        <span style={{ color: '#CBD5E1', fontSize: 10, flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', marginTop: 2,
          maxHeight: 200, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {prefix && (
            <div style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', background: '#fafafa', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <button onMouseDown={e => { e.preventDefault(); handleBack(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4A90E2', fontSize: 16, lineHeight: 1, padding: '0 4px' }}>‹</button>
              <span style={{ fontSize: 11, color: '#64748B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prefix}</span>
              <button onMouseDown={e => { e.preventDefault(); handleSelect(prefix); }} style={{ fontSize: 10, fontWeight: 700, color: '#4A90E2', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>Select ✓</button>
            </div>
          )}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {locations.length === 0 && <div style={{ padding: '12px', fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>No locations configured</div>}
            {items.map(({ seg, full, hasChildren }) => (
              <div key={full} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f8fafc' }}>
                <button
                  onMouseDown={e => { e.preventDefault(); hasChildren ? setPrefix(full) : handleSelect(full); }}
                  style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  {hasChildren && <span style={{ color: '#CBD5E1', fontSize: 10, flexShrink: 0 }}>📁</span>}
                  {seg}
                </button>
                {hasChildren && (
                  <button
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handleSelect(full); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: '7px 10px', fontSize: 10, flexShrink: 0, whiteSpace: 'nowrap' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#4A90E2'}
                    onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
                    title="Select this level"
                  >✓</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Progressive category picker (inventory_locations hierarchy) ──────────────

const CategoryPicker = ({ paths = [], value = '', onChange, disabled = false, borderColor = '#e2e8f0' }) => {
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
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {dropdowns.map(({ level, opts, selected }) => (
        <select
          key={level}
          value={selected}
          onChange={e => handleChange(level, e.target.value)}
          disabled={disabled}
          style={{
            fontSize: 12, padding: '4px 6px', border: `1px solid ${borderColor}`, borderRadius: 6,
            background: 'white', color: selected ? '#0F172A' : '#94A3B8',
            cursor: disabled ? 'default' : 'pointer', outline: 'none', flexShrink: 0,
            maxWidth: 140, opacity: disabled ? 0.55 : 1,
          }}
        >
          <option value="">Select…</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ))}
      {dropdowns.length === 0 && paths.length === 0 && (
        <span style={{ fontSize: 12, color: '#CBD5E1' }}>No categories configured</span>
      )}
    </div>
  );
};

// ── Physical storage location picker (vessel_locations table) ────────────────

const VesselLocationPicker = ({ value, onChange, vesselLocations = [], borderColor = '#e2e8f0', placeholder = 'Select location…' }) => {
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
    <div ref={ref} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <button
        onClick={() => { setOpen(v => !v); setParentId(null); setBreadcrumb([]); }}
        style={{
          width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center',
          fontSize: 12, padding: '4px 8px', border: `1px solid ${borderColor}`, borderRadius: 6,
          background: 'white', color: value ? '#0F172A' : '#94A3B8', cursor: 'pointer', gap: 4,
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || placeholder}</span>
        <span style={{ color: '#CBD5E1', fontSize: 10, flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', marginTop: 2,
          maxHeight: 220, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Breadcrumb / back header */}
          {breadcrumb.length > 0 && (
            <div style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', background: '#fafafa', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <button onMouseDown={e => { e.preventDefault(); handleBack(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4A90E2', fontSize: 16, lineHeight: 1, padding: '0 4px' }}>‹</button>
              <span style={{ fontSize: 11, color: '#64748B', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{breadcrumbPath}</span>
              <button onMouseDown={e => { e.preventDefault(); onChange(breadcrumbPath); setOpen(false); setParentId(null); setBreadcrumb([]); }} style={{ fontSize: 10, fontWeight: 700, color: '#4A90E2', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>Select ✓</button>
            </div>
          )}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {vesselLocations.length === 0 && <div style={{ padding: '12px', fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>No vessel locations configured</div>}
            {currentItems.map(loc => {
              const hasChildren = vesselLocations.some(l => l.parent_id === loc.id);
              return (
                <div key={loc.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f8fafc' }}>
                  <button
                    onMouseDown={e => { e.preventDefault(); hasChildren ? handleDrillIn(loc) : handleSelect(loc.name); }}
                    style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: '7px 12px', cursor: 'pointer', fontSize: 12, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    {hasChildren && <span style={{ color: '#CBD5E1', fontSize: 10, flexShrink: 0 }}>📁</span>}
                    {loc.name}
                  </button>
                  {hasChildren && (
                    <button
                      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handleSelect(loc.name); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: '7px 10px', fontSize: 10, flexShrink: 0, whiteSpace: 'nowrap' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#4A90E2'}
                      onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
                      title="Select this level"
                    >✓</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Step 1 ─ Receive checklist ────────────────────────────────────────────────

const ReceiveStep = ({ items, receiving, onChange, onReceiveAll, onNext, onClose, saving, splitBySupplier, onToggleSplit }) => {
  const pendingCount = items.filter(i => !receiving[i.id]?.checked).length;

  return (
    <>
      {/* Sub-header */}
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#1E3A5F', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Step 1 of 2</p>
          <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0' }}>Tick each item that arrived and enter the received quantity</p>
        </div>
        {/* Split by supplier toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
          <div
            onClick={onToggleSplit}
            style={{
              width: 32, height: 18, borderRadius: 9, background: splitBySupplier ? '#1E3A5F' : '#CBD5E1',
              position: 'relative', transition: 'background 0.15s', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <div style={{
              position: 'absolute', top: 2, left: splitBySupplier ? 16 : 2,
              width: 14, height: 14, borderRadius: '50%', background: 'white',
              transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </div>
          <span style={{ fontSize: 11, color: '#64748B', whiteSpace: 'nowrap' }}>Split by supplier</span>
        </label>
        <button
          onClick={onReceiveAll}
          style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 7, cursor: 'pointer', background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1D4ED8', whiteSpace: 'nowrap' }}
        >
          Receive All
        </button>
      </div>

      {/* Item rows */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* Header row */}
        <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 80px 90px 56px', gap: 0, padding: '6px 20px', background: '#FAFAFA', borderBottom: '1px solid #F1F5F9' }}>
          <div />
          <p style={{ fontSize: 9, fontWeight: 700, color: '#CBD5E1', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>Item</p>
          <p style={{ fontSize: 9, fontWeight: 700, color: '#CBD5E1', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, textAlign: 'center' }}>Ordered</p>
          <p style={{ fontSize: 9, fontWeight: 700, color: '#CBD5E1', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, textAlign: 'center' }}>Received</p>
          <div />
        </div>

        {items.map(item => {
          const r = receiving[item.id] || { checked: false, qty: item.quantity_ordered || 0 };
          const ordered = parseFloat(item.quantity_ordered) || 0;
          const rcvQty = parseFloat(r.qty) || 0;
          const status = r.checked ? deriveStatus(rcvQty, ordered) : null;
          const pill = status ? STATUS_PILL[status] : null;
          const itemLabel = [item.name, item.brand, item.size].filter(Boolean).join(' · ');

          return (
            <div
              key={item.id}
              style={{
                display: 'grid', gridTemplateColumns: '28px 1fr 80px 90px 56px', gap: 0,
                padding: '10px 20px', borderBottom: '1px solid #F8FAFC',
                background: r.checked ? '#FAFCFF' : 'white', alignItems: 'center',
                transition: 'background 0.1s',
              }}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={!!r.checked}
                onChange={e => onChange(item.id, 'checked', e.target.checked)}
                style={{ width: 14, height: 14, accentColor: '#4A90E2', cursor: 'pointer', flexShrink: 0 }}
              />
              {/* Name */}
              <div style={{ minWidth: 0, paddingRight: 8 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: '#0F172A', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</p>
                {(item.brand || item.size) && (
                  <p style={{ fontSize: 11, color: '#94A3B8', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[item.brand, item.size].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              {/* Ordered */}
              <p style={{ fontSize: 13, color: '#64748B', textAlign: 'center', margin: 0 }}>
                {ordered} <span style={{ fontSize: 10, color: '#CBD5E1' }}>{item.unit || ''}</span>
              </p>
              {/* Received qty input */}
              <input
                type="number"
                min="0"
                value={r.qty}
                disabled={!r.checked}
                onChange={e => onChange(item.id, 'qty', e.target.value)}
                style={{
                  width: '100%', textAlign: 'center', fontSize: 13, fontWeight: 600,
                  padding: '4px 6px', border: '1px solid',
                  borderColor: !r.checked ? '#F1F5F9' : rcvQty < ordered ? '#FCA5A5' : '#86EFAC',
                  borderRadius: 6, outline: 'none', background: r.checked ? 'white' : '#FAFAFA',
                  color: r.checked ? '#0F172A' : '#CBD5E1',
                }}
              />
              {/* Status pill */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {pill && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: pill.bg, color: pill.color, whiteSpace: 'nowrap' }}>
                    {pill.label}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: '#94A3B8' }}>No items on this board.</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <p style={{ fontSize: 12, color: '#94A3B8', margin: 0 }}>
          {items.filter(i => receiving[i.id]?.checked).length} of {items.length} items ticked
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', background: 'white', border: '1px solid #E2E8F0', color: '#64748B' }}
          >
            Cancel
          </button>
          <button
            onClick={onNext}
            disabled={saving || items.filter(i => receiving[i.id]?.checked).length === 0}
            style={{ fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', background: '#1E3A5F', border: '1px solid #1E3A5F', color: 'white', opacity: saving ? 0.6 : 1 }}
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
  <button
    onClick={onClick}
    style={{ width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#16A34A', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}
  >{children}</button>
);

// Shared label style for create/link forms
const FLD = ({ children }) => (
  <span style={{ display: 'block', fontSize: 10, color: '#94A3B8', fontWeight: 500, marginBottom: 2 }}>{children}</span>
);

const PushStep = ({
  items, receiving, matches,
  locationSplits, onSplitChange, onAddSplitLocation, onRemoveSplitLocation,
  noMatchChoices, inlineLinks, inlineSearch, allLocations, vesselLocations,
  onSetNoMatchChoice, onInlineSearchChange, onInlineLink,
  onUnlinkMatch, onUnlinkInline,
  newItemForms, onInitNewItemForm, onNewItemFormChange,
  onNewItemSplitChange, onNewItemAddSplit, onNewItemRemoveSplit,
  onPush, onBack, pushing,
}) => {
  const receivedItems = items.filter(i => receiving[i.id]?.checked && (parseFloat(receiving[i.id]?.qty) || 0) > 0);

  // Shared split-rows UI (used for both auto-matched and inline-linked items)
  const renderSplits = (itemId, qty, splits, cardColor = '#F0FDF4', borderCol = '#BBF7D0') => {
    const totalAllocated = splits.reduce((sum, s) => sum + (parseFloat(s.addQty) || 0), 0);
    const allocOk = Math.abs(totalAllocated - qty) < 0.001;
    return (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {splits.map((loc, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {/* Trash */}
              <button
                onClick={() => onRemoveSplitLocation(itemId, idx)}
                style={{ ...ICON_BTN, color: '#CBD5E1', flexShrink: 0 }}
                onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
                onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
              >
                <Icon name="Trash2" style={{ width: 12, height: 12 }} />
              </button>
              {/* Physical storage location picker */}
              <VesselLocationPicker
                value={loc.locationName}
                onChange={v => onSplitChange(itemId, idx, 'locationName', v)}
                vesselLocations={vesselLocations}
                borderColor={borderCol}
                placeholder="Select storage location…"
              />
              {/* Current stock label */}
              <span style={{ fontSize: 10, color: '#94A3B8', whiteSpace: 'nowrap', flexShrink: 0, width: 44, textAlign: 'right' }}>
                {loc.currentQty > 0 ? `now: ${loc.currentQty}` : 'new'}
              </span>
              {/* Qty controls */}
              <SplitQtyBtn onClick={() => onSplitChange(itemId, idx, 'addQty', Math.max(0, (parseFloat(loc.addQty) || 0) - 1))}>−</SplitQtyBtn>
              <input
                type="number" min="0" value={loc.addQty}
                onChange={e => onSplitChange(itemId, idx, 'addQty', parseFloat(e.target.value) || 0)}
                style={{ width: 38, textAlign: 'center', fontSize: 12, padding: '3px 2px', border: `1px solid ${borderCol}`, borderRadius: 6, outline: 'none', flexShrink: 0 }}
              />
              <SplitQtyBtn onClick={() => onSplitChange(itemId, idx, 'addQty', (parseFloat(loc.addQty) || 0) + 1)}>+</SplitQtyBtn>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
          <button
            onClick={() => onAddSplitLocation(itemId)}
            style={{ fontSize: 11, fontWeight: 600, color: '#16A34A', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >+ Add location</button>
          <span style={{ fontSize: 11, fontWeight: 600, color: allocOk ? '#16A34A' : '#DC2626' }}>
            {totalAllocated} of {qty} allocated{allocOk ? ' ✓' : ''}
          </span>
        </div>
      </>
    );
  };

  return (
    <>
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid #F1F5F9' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#1E3A5F', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Step 2 of 2</p>
        <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0' }}>
          Confirm where each item goes in inventory. Split across multiple locations if needed.
        </p>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
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

          return (
            <div key={item.id} style={{ padding: '12px 20px', borderBottom: '1px solid #F8FAFC' }}>
              {/* Item header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{item.name}</span>
                {(item.brand || item.size) && <span style={{ fontSize: 11, color: '#94A3B8' }}>{[item.brand, item.size].filter(Boolean).join(' · ')}</span>}
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: '#1E3A5F' }}>+{qty} {item.unit || ''}</span>
              </div>

              {isLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94A3B8', fontSize: 12 }}>
                  <div style={{ width: 12, height: 12, border: '2px solid #CBD5E1', borderTopColor: '#4A90E2', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Searching inventory…
                </div>

              ) : hasMatch ? (
                /* ── Auto-matched ── */
                <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Icon name="CheckCircle" style={{ width: 13, height: 13, color: '#16A34A', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#15803D' }}>
                      Matched → {match.name}
                      {match.cargo_item_id && <span style={{ fontWeight: 400, color: '#4ADE80', marginLeft: 4 }}>({match.cargo_item_id})</span>}
                    </span>
                    <span style={{ fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }}>stock: {match.total_qty ?? 0}</span>
                    <button
                      onClick={() => onUnlinkMatch(item.id)}
                      style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7280', background: 'none', border: '1px solid #BBF7D0', cursor: 'pointer', padding: '1px 7px', borderRadius: 5, flexShrink: 0 }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#EF4444'; e.currentTarget.style.borderColor = '#FCA5A5'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#6B7280'; e.currentTarget.style.borderColor = '#BBF7D0'; }}
                    >Unlink</button>
                  </div>
                  {renderSplits(item.id, qty, splits)}
                </div>

              ) : choice === 'skip' ? (
                /* ── Skipped ── */
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '7px 12px' }}>
                  <span style={{ fontSize: 12, color: '#64748B', flex: 1 }}>Skipped — not pushed to inventory</span>
                  <button onClick={() => onSetNoMatchChoice(item.id, null)} style={{ fontSize: 11, color: '#4A90E2', background: 'none', border: 'none', cursor: 'pointer' }}>Undo</button>
                </div>

              ) : choice === 'link' && inlineLink ? (
                /* ── Inline-linked ── */
                <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Icon name="Link" style={{ width: 13, height: 13, color: '#16A34A', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#15803D' }}>
                      Linked → {inlineLink.name}
                      {inlineLink.cargo_item_id && <span style={{ fontWeight: 400, color: '#4ADE80', marginLeft: 4 }}>({inlineLink.cargo_item_id})</span>}
                    </span>
                    <span style={{ fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }}>stock: {inlineLink.total_qty ?? 0}</span>
                    <button
                      onClick={() => onUnlinkInline(item.id)}
                      style={{ marginLeft: 'auto', fontSize: 11, color: '#6B7280', background: 'none', border: '1px solid #BBF7D0', cursor: 'pointer', padding: '1px 7px', borderRadius: 5, flexShrink: 0 }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#EF4444'; e.currentTarget.style.borderColor = '#FCA5A5'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#6B7280'; e.currentTarget.style.borderColor = '#BBF7D0'; }}
                    >Unlink</button>
                  </div>
                  {renderSplits(item.id, qty, splits)}
                </div>

              ) : choice === 'link' ? (
                /* ── Inline search ── */
                <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Icon name="Search" style={{ width: 13, height: 13, color: '#3B82F6', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1D4ED8' }}>Link to inventory item</span>
                    <button onClick={() => onSetNoMatchChoice(item.id, null)} style={{ marginLeft: 'auto', fontSize: 11, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer' }}>← Back</button>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <input
                      value={search.query || ''}
                      onChange={e => onInlineSearchChange(item.id, e.target.value)}
                      placeholder="Search by name, brand, or CARGO code…"
                      style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '5px 8px', border: '1px solid #BFDBFE', borderRadius: 6, outline: 'none' }}
                    />
                    {search.loading && <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#94A3B8' }}>…</span>}
                    {(search.results || []).length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 20px rgba(0,0,0,0.1)', marginTop: 2, maxHeight: 160, overflowY: 'auto' }}>
                        {(search.results || []).map(inv => (
                          <button
                            key={inv.id}
                            onMouseDown={e => { e.preventDefault(); onInlineLink(item.id, inv); }}
                            style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '7px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', gap: 1 }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>{inv.name}</span>
                            <span style={{ fontSize: 11, color: '#94A3B8' }}>{[inv.brand, inv.size, inv.cargo_item_id].filter(Boolean).join(' · ')}{inv.total_qty != null ? ` · stock: ${inv.total_qty}` : ''}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

              ) : choice === 'create' ? (
                /* ── Create new item form ── */
                <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Icon name="PlusCircle" style={{ width: 13, height: 13, color: '#EA580C', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#C2410C' }}>Create new inventory item</span>
                    <button onClick={() => onSetNoMatchChoice(item.id, null)} style={{ marginLeft: 'auto', fontSize: 11, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer' }}>← Back</button>
                  </div>
                  {newForm ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {/* Item details grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        <div>
                          <FLD>Name *</FLD>
                          <input value={newForm.name} onChange={e => onNewItemFormChange(item.id, 'name', e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '4px 8px', border: '1px solid #FED7AA', borderRadius: 6, outline: 'none' }} />
                        </div>
                        <div>
                          <FLD>Brand</FLD>
                          <input value={newForm.brand} onChange={e => onNewItemFormChange(item.id, 'brand', e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '4px 8px', border: '1px solid #FED7AA', borderRadius: 6, outline: 'none' }} />
                        </div>
                        <div>
                          <FLD>Size</FLD>
                          <input value={newForm.size} onChange={e => onNewItemFormChange(item.id, 'size', e.target.value)} placeholder="e.g. 750ml" style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '4px 8px', border: '1px solid #FED7AA', borderRadius: 6, outline: 'none' }} />
                        </div>
                        <div>
                          <FLD>Unit *</FLD>
                          <select value={newForm.unit} onChange={e => onNewItemFormChange(item.id, 'unit', e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '4px 8px', border: '1px solid #FED7AA', borderRadius: 6, outline: 'none', background: 'white' }}>
                            {UNIT_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.options.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>)}
                          </select>
                        </div>
                        <div>
                          <FLD>Barcode</FLD>
                          <input value={newForm.barcode} onChange={e => onNewItemFormChange(item.id, 'barcode', e.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '4px 8px', border: '1px solid #FED7AA', borderRadius: 6, outline: 'none' }} />
                        </div>
                      </div>

                      {/* Inventory category — progressive hierarchy picker */}
                      <div>
                        <FLD>Inventory category *</FLD>
                        <CategoryPicker
                          paths={allLocations}
                          value={newForm.categoryPath || ''}
                          onChange={v => onNewItemFormChange(item.id, 'categoryPath', v)}
                          borderColor="#FED7AA"
                        />
                      </div>

                      {/* Physical storage locations with qty splits */}
                      <div>
                        <FLD>Storage locations *</FLD>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {(newForm.splits || []).map((s, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <button
                                onClick={() => onNewItemRemoveSplit(item.id, idx)}
                                style={{ ...ICON_BTN, color: '#CBD5E1', flexShrink: 0 }}
                                onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
                                onMouseLeave={e => e.currentTarget.style.color = '#CBD5E1'}
                              ><Icon name="Trash2" style={{ width: 12, height: 12 }} /></button>
                              <VesselLocationPicker
                                value={s.locationName}
                                onChange={v => onNewItemSplitChange(item.id, idx, 'locationName', v)}
                                vesselLocations={vesselLocations}
                                borderColor="#FED7AA"
                                placeholder="Select storage location…"
                              />
                              <SplitQtyBtn onClick={() => onNewItemSplitChange(item.id, idx, 'addQty', Math.max(0, (parseFloat(s.addQty) || 0) - 1))}>−</SplitQtyBtn>
                              <input
                                type="number" min="0" value={s.addQty}
                                onChange={e => onNewItemSplitChange(item.id, idx, 'addQty', parseFloat(e.target.value) || 0)}
                                style={{ width: 38, textAlign: 'center', fontSize: 12, padding: '3px 2px', border: '1px solid #FED7AA', borderRadius: 6, outline: 'none', flexShrink: 0 }}
                              />
                              <SplitQtyBtn onClick={() => onNewItemSplitChange(item.id, idx, 'addQty', (parseFloat(s.addQty) || 0) + 1)}>+</SplitQtyBtn>
                            </div>
                          ))}
                        </div>
                        {/* Add location row + total */}
                        {(() => {
                          const splits = newForm.splits || [];
                          const totalAllocated = splits.reduce((sum, s) => sum + (parseFloat(s.addQty) || 0), 0);
                          const allocOk = Math.abs(totalAllocated - qty) < 0.001;
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                              <button onClick={() => onNewItemAddSplit(item.id)} style={{ fontSize: 11, fontWeight: 600, color: '#EA580C', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>+ Add location</button>
                              <span style={{ fontSize: 11, fontWeight: 600, color: allocOk ? '#16A34A' : '#EA580C' }}>{totalAllocated} of {qty} allocated{allocOk ? ' ✓' : ''}</span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ) : null}
                </div>

              ) : (
                /* ── No match — choose action ── */
                <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Icon name="AlertCircle" style={{ width: 13, height: 13, color: '#EA580C' }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: '#C2410C' }}>No inventory match found</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => onSetNoMatchChoice(item.id, 'link')}
                      style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1D4ED8' }}
                    >🔍 Link to inventory</button>
                    <button
                      onClick={() => { onSetNoMatchChoice(item.id, 'create'); onInitNewItemForm(item.id, item); }}
                      style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: '#FFF7ED', border: '1px solid #FED7AA', color: '#EA580C' }}
                    >+ Create new item</button>
                    <button
                      onClick={() => onSetNoMatchChoice(item.id, 'skip')}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', background: 'white', border: '1px solid #E2E8F0', color: '#94A3B8' }}
                    >Skip</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {receivedItems.length === 0 && (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: '#94A3B8' }}>No received items to push.</p>
          </div>
        )}
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <button onClick={onBack} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', background: 'white', border: '1px solid #E2E8F0', color: '#64748B', display: 'flex', alignItems: 'center', gap: 5 }}>
          ← Back
        </button>
        <button
          onClick={onPush}
          disabled={pushing || receivedItems.length === 0}
          style={{ fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', background: '#15803D', border: '1px solid #15803D', color: 'white', opacity: pushing ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {pushing ? 'Pushing…' : `Push to Inventory (${receivedItems.length})`}
        </button>
      </div>
    </>
  );
};

// ── Main modal ────────────────────────────────────────────────────────────────

const ReceiveDeliveryModal = ({ list, items, tenantId, onClose, onComplete }) => {
  const { user } = useAuth();
  const userId = user?.id;

  const [step, setStep] = useState(1);
  const [receiving, setReceiving] = useState({});
  const [splitBySupplier, setSplitBySupplier] = useState(true);
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
      const alreadyReceived = item.status === 'received' || item.status === 'short_delivered';
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

  const handleSaveReceiving = async () => {
    setSaving(true);
    try {
      // Build full update list, carrying supplier_name + cost for batch grouping
      const updates = items.map(item => {
        const r = receiving[item.id] || {};
        const qty = r.checked ? Math.max(0, parseFloat(r.qty) || 0) : 0;
        const ordered = parseFloat(item.quantity_ordered) || 0;
        return {
          id: item.id,
          quantity_received: qty,
          status: deriveStatus(qty, ordered),
          supplier_name: item.supplier_name || null,
          estimated_unit_cost: item.estimated_unit_cost,
        };
      });

      const receivedUpdates = updates.filter(u => u.quantity_received > 0);

      // Group by supplier (or lump everything into one batch when toggle is off)
      const bySupplier = {};
      receivedUpdates.forEach(u => {
        const key = splitBySupplier ? (u.supplier_name || 'Manual receive') : 'Manual receive';
        if (!bySupplier[key]) bySupplier[key] = [];
        bySupplier[key].push(u);
      });

      // Create a batch per supplier group, then stamp each item
      for (const [supplierName, supplierItems] of Object.entries(bySupplier)) {
        const totalCost = supplierItems.reduce(
          (sum, u) => sum + (parseFloat(u.estimated_unit_cost) || 0) * (u.quantity_received || 0),
          0
        );
        const batch = await createDeliveryBatch({
          listId: list?.id,
          tenantId,
          userId,
          supplierName,
          totalCost: totalCost || null,
          portLocation: list?.port_location || null,
        });
        const batchId = batch?.id || null;
        if (!batchId) {
          console.error('[ReceiveDeliveryModal] batch creation failed for supplier:', supplierName, '— items will be received without a batch link. Check console for Supabase error details.');
          showToast(`Batch creation failed for "${supplierName}" — check browser console for the exact error (likely RLS policy or missing column)`, 'error');
        }

        await receiveItems(supplierItems.map(u => ({
          id: u.id,
          quantity_received: u.quantity_received,
          status: u.status,
          ...(batchId ? { receive_batch_id: batchId } : {}),
        })));
      }

      // Persist status for unchecked items (e.g. not_received)
      const nonReceived = updates.filter(u => u.quantity_received === 0);
      if (nonReceived.length > 0) {
        await receiveItems(nonReceived.map(u => ({
          id: u.id,
          quantity_received: u.quantity_received,
          status: u.status,
        })));
      }

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
        const ok = await pushReceivedSplitsToInventory({ inventoryItemId: match.id, splits, tenantId });
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
        const ok = await pushReceivedSplitsToInventory({ inventoryItemId: inlineLink.id, splits, tenantId });
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

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000, padding: 16 }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ background: 'white', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.18)', width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', margin: 0 }}>Receive Delivery</h2>
            <p style={{ fontSize: 12, color: '#94A3B8', margin: '3px 0 0' }}>{list?.title}</p>
          </div>
          {/* Step indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto', marginLeft: 24 }}>
            {[1, 2].map(n => (
              <React.Fragment key={n}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                  background: step === n ? '#1E3A5F' : step > n ? '#DCFCE7' : '#F1F5F9',
                  color: step === n ? 'white' : step > n ? '#15803D' : '#94A3B8',
                }}>
                  {step > n ? '✓' : n}
                </div>
                {n < 2 && <div style={{ width: 24, height: 2, background: step > n ? '#86EFAC' : '#F1F5F9', borderRadius: 1 }} />}
              </React.Fragment>
            ))}
          </div>
          <button onClick={onClose} style={{ ...ICON_BTN, marginLeft: 'auto' }}>
            <Icon name="X" style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* Step content */}
        {step === 1 ? (
          <ReceiveStep
            items={items}
            receiving={receiving}
            onChange={handleChange}
            onReceiveAll={handleReceiveAll}
            onNext={handleSaveReceiving}
            onClose={onClose}
            saving={saving}
            splitBySupplier={splitBySupplier}
            onToggleSplit={() => setSplitBySupplier(v => !v)}
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
            pushing={pushing}
          />
        )}
      </div>

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default ReceiveDeliveryModal;

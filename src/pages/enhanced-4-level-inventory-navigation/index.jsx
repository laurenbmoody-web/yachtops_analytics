import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { dateLocale, formatDate } from '../../utils/dateFormat';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import LogoSpinner from '../../components/LogoSpinner';
import { getAllItems, getItemsByLocation, getItemCountByLocation, deleteItem, saveItem, getFolderTree, createFolder, renameFolderInDB, deleteFolderFromDB, migrateLocalStorageFolderTree, moveFolderInDB, ensureDepartmentFolders, updateFolderVisibility, archiveFolder, duplicateFolder, moveFolderToTrash, moveItemToTrash, moveItemsToTrash, restoreFromTrash, listTrash, purgeTrashRecord, emptyTrash, updateItemStockLocations, bulkDeleteItemsByIds, bulkMoveItemsByIds, updateFolderAppearance, updateItemAppearance, updatePartialBottle } from '../inventory/utils/inventoryStorage';
import { getCurrentUser, DEPARTMENTS } from '../../utils/authStorage';
import { isDevMode } from '../../utils/devMode';
import { useAuth } from '../../contexts/AuthContext';
import AddEditItemModal from '../inventory/components/AddEditItemModal';
import UniformItemModal from '../inventory/components/UniformItemModal';
import UniformItemView from '../inventory/components/UniformItemView';
import ItemQuickViewPanel from '../inventory/components/ItemQuickViewPanel';
import PartialBottleModal from '../inventory/components/PartialBottleModal';
import { supabase } from '../../lib/supabaseClient';
import { markTutorialStep } from '../../utils/tutorialState';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ExportInventoryModal from './components/ExportInventoryModal';
import AzurePdfImportModal from './components/AzurePdfImportModal';
import { exportInventoryToPDF } from './utils/inventoryPdfExport';
import { exportInventoryToXLSX } from './utils/inventoryXlsxExport';

import ModalShell from '../../components/ui/ModalShell';
import '../../styles/editorial.css';
import './inventory-nav.css';
const SLASH_PLACEHOLDER = '__FWDSLASH__';

// ─── Folder Icon Suggestions ───────────────────────────────────────────────────
const ICON_KEYWORD_MAP = [
  { keywords: ['linen', 'towel', 'bedding', 'sheet', 'pillow', 'duvet', 'bed'], icon: 'Shirt' },
  { keywords: ['watersport', 'water sport', 'jetski', 'jet ski', 'surf', 'kayak', 'paddle', 'dive', 'snorkel', 'swim', 'wakeboard', 'kite'], icon: 'Waves' },
  { keywords: ['floral', 'flower', 'plant', 'garden', 'bouquet', 'bloom', 'botanical'], icon: 'Flower2' },
  { keywords: ['food', 'pantry', 'galley', 'kitchen', 'catering', 'cuisine', 'meal', 'dining', 'snack', 'provision', 'dry good'], icon: 'ChefHat' },
  { keywords: ['drink', 'beverage', 'wine', 'spirit', 'alcohol', 'bar', 'cellar', 'champagne', 'beer', 'cocktail', 'juice', 'water bottle'], icon: 'Wine' },
  { keywords: ['clean', 'laundry', 'hygiene', 'detergent', 'soap', 'polish', 'chemical', 'sanitise', 'sanitize', 'bleach', 'disinfect'], icon: 'Sparkles' },
  { keywords: ['tech', 'electronic', 'av', 'audio', 'video', 'media', 'entertainment', 'tv', 'screen', 'speaker', 'wifi', 'cable'], icon: 'Monitor' },
  { keywords: ['tool', 'maintenance', 'repair', 'engineering', 'engine', 'mechanical', 'hardware', 'bolt', 'screw', 'wrench'], icon: 'Wrench' },
  { keywords: ['safety', 'medical', 'first aid', 'health', 'emergency', 'rescue', 'fire', 'life jacket', 'ppe', 'protection'], icon: 'ShieldCheck' },
  { keywords: ['uniform', 'clothing', 'crew wear', 'apparel', 'shirt', 'jacket', 'hat', 'cap', 'polo', 'outfit'], icon: 'ShirtIcon' },
  { keywords: ['cabin', 'stateroom', 'bedroom', 'guest', 'room', 'suite', 'bathroom', 'toilet', 'shower'], icon: 'BedDouble' },
  { keywords: ['deck', 'exterior', 'outdoor', 'outside', 'teak', 'canvas', 'cover', 'awning', 'cushion', 'sunbed'], icon: 'Anchor' },
  { keywords: ['navigation', 'chart', 'map', 'compass', 'gps', 'instrument', 'bridge'], icon: 'Compass' },
  { keywords: ['sport', 'game', 'toy', 'recreation', 'leisure', 'fun', 'board game', 'fishing', 'golf', 'tennis'], icon: 'Trophy' },
  { keywords: ['tender', 'boat', 'dinghy', 'vessel', 'yacht', 'rib', 'craft'], icon: 'Sailboat' },
  { keywords: ['fuel', 'oil', 'lubricant', 'fluid', 'coolant', 'hydraulic', 'diesel', 'gas', 'petrol'], icon: 'Droplets' },
  { keywords: ['paper', 'stationery', 'office', 'document', 'print', 'ink', 'pen', 'notepad'], icon: 'FileText' },
  { keywords: ['photo', 'camera', 'image', 'picture', 'drone'], icon: 'Camera' },
  { keywords: ['music', 'instrument', 'audio', 'sound'], icon: 'Music' },
  { keywords: ['seasonal', 'holiday', 'christmas', 'decoration', 'festive', 'event', 'occasion'], icon: 'Star' },
  { keywords: ['spa', 'wellness', 'beauty', 'lotion', 'cream', 'toiletry', 'cosmetic', 'perfume'], icon: 'Heart' },
  { keywords: ['coffee', 'tea', 'espresso', 'cup', 'mug'], icon: 'Coffee' },
  { keywords: ['fruit', 'vegetable', 'fresh', 'produce', 'grocery'], icon: 'Apple' },
  { keywords: ['gift', 'welcome', 'amenity', 'present', 'souvenir', 'merchandise'], icon: 'Gift' },
  { keywords: ['storage', 'box', 'container', 'archive', 'spare'], icon: 'Package' },
];

const FOLDER_ICON_PALETTE = [
  // Folders & navigation
  'FolderOpen', 'Folder', 'MapPin', 'Map', 'Compass', 'Navigation',
  // Food & drink
  'ChefHat', 'UtensilsCrossed', 'Utensils', 'Wine', 'Beer', 'Coffee', 'Apple', 'Carrot', 'Fish', 'Beef', 'Cake',
  // Household & linen
  'Shirt', 'Layers', 'BedDouble', 'Bath', 'Sofa', 'Lamp', 'Paintbrush',
  // Outdoor & nautical
  'Waves', 'Anchor', 'Sailboat', 'Ship', 'Wind', 'Sun', 'Umbrella', 'Mountain',
  // Nature & garden
  'Flower2', 'Flower', 'Sprout', 'Leaf', 'TreePine',
  // Sport & recreation
  'Trophy', 'Dumbbell', 'Bike', 'Gamepad2', 'Target',
  // Tech & media
  'Monitor', 'Tv', 'Speaker', 'Headphones', 'Camera', 'Music', 'Radio', 'Wifi',
  // Tools & engineering
  'Wrench', 'Hammer', 'Settings', 'Gauge', 'Zap',
  // Safety & medical
  'ShieldCheck', 'Heart', 'HeartPulse', 'AlertTriangle', 'Flame',
  // Cleaning & hygiene
  'Sparkles', 'Droplets', 'Droplet',
  // Office & admin
  'FileText', 'ClipboardList', 'Package', 'Box', 'Archive', 'Star', 'Gift',
  // People & access
  'Users', 'Key', 'Lock', 'Tag',
];

const FOLDER_COLOR_PALETTE = [
  { label: 'Blue',   value: '#4A90E2' },
  { label: 'Navy',   value: '#1E3A5F' },
  { label: 'Teal',   value: '#0D9488' },
  { label: 'Green',  value: '#16A34A' },
  { label: 'Amber',  value: '#D97706' },
  { label: 'Red',    value: '#DC2626' },
  { label: 'Purple', value: '#7C3AED' },
  { label: 'Pink',   value: '#DB2777' },
  { label: 'Slate',  value: '#475569' },
  { label: 'Rose',   value: '#E11D48' },
];

const suggestIconForName = (name) => {
  if (!name) return null;
  const lower = name?.toLowerCase();
  for (const { keywords, icon } of ICON_KEYWORD_MAP) {
    if (keywords?.some(k => lower?.includes(k))) return icon;
  }
  return null;
};

// Default icon for a top-level department folder (used when the folder has no
// custom icon set) — so the root inventory page shows fitting icons, not pins.
const DEPARTMENT_ICON_MAP = {
  galley: 'ChefHat',
  interior: 'Sofa',
  bridge: 'Compass',
  deck: 'Anchor',
  engineering: 'Wrench',
  admin: 'ClipboardList',
  aviation: 'Plane',
  science: 'FlaskConical',
  medical: 'HeartPulse',
  security: 'ShieldCheck',
  spa: 'Flower2',
  unfiled: 'Inbox',
};
const departmentIcon = (name) =>
  DEPARTMENT_ICON_MAP?.[name?.trim()?.toLowerCase()] || suggestIconForName(name) || 'MapPin';

const encodeSegment = (s) =>
  encodeURIComponent(s?.replace(/\//g, SLASH_PLACEHOLDER));

const decodeSegment = (s) =>
  decodeURIComponent(s)?.replace(new RegExp(SLASH_PLACEHOLDER, 'g'), '/');

const pathKey = (segments) => segments?.join('|||');

/** Get sub-folders for a given path from a tree object */
const getSubFoldersFromTree = (tree, segments) => {
  const key = pathKey(segments);
  return tree?.[key]?.subFolders || [];
};

/** Get root-level location names from tree (DB-only, no hardcoded defaults) */
const getRootLocationsFromTree = (tree) => {
  const rootKey = pathKey([]);
  return tree?.[rootKey]?.subFolders || [];
};

/** Get all sub-folders for a path, merging DB-derived folders with tree */
const getMergedSubFoldersFromTree = (tree, segments, dbSubLocations = []) => {
  const key = pathKey(segments);
  const stored = tree?.[key]?.subFolders || [];
  const renamedMap = tree?.[key]?.renamedMap || {};
  const all = [...stored];
  dbSubLocations?.forEach(s => {
    const renamed = renamedMap?.[s] || s;
    if (!all?.includes(renamed) && !all?.includes(s)) all?.push(renamed);
  });
  return all;
};

// ─── Visibility label helpers ─────────────────────────────────────────────────
const VISIBILITY_OPTIONS = [
  { value: 'everyone', label: 'Everyone in department' },
  { value: 'chief_hod_command', label: 'Chief + HOD + Command' },
  { value: 'chief_command', label: 'Chief + Command only' },
  { value: 'command_only', label: 'Command only' },
];

// ─── Sort options ────────────────────────────────────────────────────────
const SORT_OPTIONS = [
  { value: 'name_asc', label: 'Name (A → Z)' },
  { value: 'name_desc', label: 'Name (Z → A)' },
  { value: 'qty_asc', label: 'Quantity (Low → High)' },
  { value: 'qty_desc', label: 'Quantity (High → Low)' },
  { value: 'recently_added', label: 'Recently Added' },
  { value: 'recently_updated', label: 'Recently Updated' },
  { value: 'expiry_asc', label: 'Expiry Date (Soonest First)' },
  { value: 'expiry_desc', label: 'Expiry Date (Latest First)' },
  { value: 'par_below', label: 'Par Level (Below Par First)' },
];

// ─── Apply sort to items ────────────────────────────────────────────────────
const applySortToItems = (items, sortBy) => {
  const arr = [...(items || [])];
  switch (sortBy) {
    case 'name_asc':
      return arr?.sort((a, b) => (a?.name || '')?.localeCompare(b?.name || ''));
    case 'name_desc':
      return arr?.sort((a, b) => (b?.name || '')?.localeCompare(a?.name || ''));
    case 'qty_asc':
      return arr?.sort((a, b) => ((a?.quantity ?? a?.totalQty ?? 0) - (b?.quantity ?? b?.totalQty ?? 0)));
    case 'qty_desc':
      return arr?.sort((a, b) => ((b?.quantity ?? b?.totalQty ?? 0) - (a?.quantity ?? a?.totalQty ?? 0)));
    case 'recently_added':
      return arr?.sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0));
    case 'recently_updated':
      return arr?.sort((a, b) => new Date(b?.updated_at || b?.created_at || 0) - new Date(a?.updated_at || a?.created_at || 0));
    case 'expiry_asc': case'expiry_desc': {
      const getExpiryTimestamp = (item) => {
        const raw = item?.expiry_date || item?.expiryDate || null;
        if (!raw) return null;
        const ts = Date.parse(raw);
        return isNaN(ts) ? null : ts;
      };
      const sorted = arr?.sort((a, b) => {
        const aTs = getExpiryTimestamp(a);
        const bTs = getExpiryTimestamp(b);
        // Null/invalid dates always go last regardless of direction
        if (aTs === null && bTs === null) return 0;
        if (aTs === null) return 1;
        if (bTs === null) return -1;
        return sortBy === 'expiry_asc' ? aTs - bTs : bTs - aTs;
      });
      // Debug log: show sorted order with raw expiry_date and parsed timestamp
      console.log('[Expiry Sort Debug]', sortBy, sorted?.map((item, idx) => ({
        order: idx + 1,
        name: item?.name,
        raw_expiry_date: item?.expiry_date || item?.expiryDate || null,
        parsed_timestamp: getExpiryTimestamp(item),
      })));
      return sorted;
    }
    case 'par_below':
      return arr?.sort((a, b) => {
        const aBelowPar = a?.restockEnabled && a?.restockLevel !== null && (a?.quantity ?? a?.totalQty ?? 0) <= a?.restockLevel;
        const bBelowPar = b?.restockEnabled && b?.restockLevel !== null && (b?.quantity ?? b?.totalQty ?? 0) <= b?.restockLevel;
        if (aBelowPar && !bBelowPar) return -1;
        if (!aBelowPar && bBelowPar) return 1;
        return (a?.name || '')?.localeCompare(b?.name || '');
      });
    default:
      return arr;
  }
};

// ─── Add Folder Modal ───────────────────────────────────────────────────────
const AddFolderModal = ({ parentPath, onClose, onSave }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [selectedIcon, setSelectedIcon] = useState(null);
  const [selectedColor, setSelectedColor] = useState(null);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [iconSearch, setIconSearch] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { setTimeout(() => inputRef?.current?.focus(), 100); }, []);

  const handleNameChange = (e) => {
    const val = e?.target?.value;
    setName(val);
    setError('');
    const suggested = suggestIconForName(val);
    if (suggested && !selectedIcon) setSelectedIcon(suggested);
  };

  const handleSave = () => {
    const trimmed = name?.trim();
    if (!trimmed) { setError('Please enter a name'); return; }
    onSave({ name: trimmed, icon: selectedIcon || null, color: selectedColor || null });
  };

  const parentLabel = parentPath?.length > 0 ? parentPath?.[parentPath?.length - 1] : null;
  const previewColor = selectedColor || '#4A90E2';
  const previewIcon = selectedIcon || 'FolderOpen';

  return (
    <ModalShell onClose={onClose} panelClassName="inv-modal">
      <div className="inv-modal-head">
        <div>
          <div className="inv-modal-eyebrow">New folder</div>
          <h2 className="inv-modal-title">Add sub-folder</h2>
        </div>
        <button onClick={onClose} className="inv-modal-close"><Icon name="X" size={18} /></button>
      </div>
      {parentLabel && (
        <p className="inv-modal-sub">Inside <b>{parentLabel}</b></p>
      )}

      {/* Name input */}
      <div className="inv-fieldwrap">
        <label className="inv-flabel">Folder name</label>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={handleNameChange}
          onKeyDown={(e) => { if (e?.key === 'Enter') handleSave(); if (e?.key === 'Escape') onClose(); }}
          placeholder="e.g. Linen & Towels"
          className="inv-field"
        />
        {error && <p className="inv-err">{error}</p>}
      </div>

      {/* Preview + Icon/Color selectors */}
      <div className="inv-fieldwrap">
        <label className="inv-flabel">Appearance</label>
        <div className="flex items-center gap-3">
          <div className="inv-preview" style={{ backgroundColor: previewColor + '22', border: `2px solid ${previewColor}44` }}>
            <Icon name={previewIcon} size={22} style={{ color: previewColor }} />
          </div>
          <div className="flex-1">
            <button type="button" onClick={() => setShowIconPicker(v => !v)} className="inv-picker-toggle">
              <span className="flex items-center gap-2">
                <Icon name={previewIcon} size={14} />
                <span>{previewIcon}</span>
              </span>
              <Icon name={showIconPicker ? 'ChevronUp' : 'ChevronDown'} size={14} />
            </button>
          </div>
        </div>

        {showIconPicker && (
          <div className="inv-picker-panel">
            <input
              type="text"
              value={iconSearch}
              onChange={e => setIconSearch(e?.target?.value)}
              placeholder="Search icons…"
              className="inv-field"
              style={{ marginBottom: 10, padding: '8px 11px', fontSize: 13 }}
            />
            <div className="inv-icongrid">
              {FOLDER_ICON_PALETTE?.filter(n => !iconSearch || n?.toLowerCase()?.includes(iconSearch?.toLowerCase()))?.map(iconName => (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => { setSelectedIcon(iconName); setShowIconPicker(false); setIconSearch(''); }}
                  className={`inv-iconopt${selectedIcon === iconName ? ' on' : ''}`}
                  title={iconName}
                >
                  <Icon name={iconName} size={14} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="inv-swatchrow">
          {FOLDER_COLOR_PALETTE?.map(c => (
            <button
              key={c?.value}
              type="button"
              onClick={() => setSelectedColor(selectedColor === c?.value ? null : c?.value)}
              className="inv-swatch-c"
              style={{ backgroundColor: c?.value, outlineColor: selectedColor === c?.value ? c?.value : 'transparent' }}
              title={c?.label}
            />
          ))}
          {selectedColor && (
            <button type="button" onClick={() => setSelectedColor(null)} className="inv-swatch-reset">Reset</button>
          )}
        </div>
        {name && suggestIconForName(name) && selectedIcon === suggestIconForName(name) && (
          <p className="inv-modal-sub" style={{ margin: '10px 0 0', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Icon name="Sparkles" size={10} /> Icon suggested from the folder name
          </p>
        )}
      </div>

      <div className="inv-modal-actions">
        <button onClick={onClose} className="inv-btn ghost">Cancel</button>
        <button onClick={handleSave} className="inv-btn primary">Create</button>
      </div>
    </ModalShell>
  );
};

// ─── Edit Folder Modal ────────────────────────────────────────────────────────
const EditFolderModal = ({ currentName, onClose, onSave }) => {
  const [name, setName] = useState(currentName || '');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { setTimeout(() => { inputRef?.current?.focus(); inputRef?.current?.select(); }, 100); }, []);

  const handleSave = () => {
    const trimmed = name?.trim();
    if (!trimmed) { setError('Please enter a name'); return; }
    if (trimmed === currentName) { onClose(); return; }
    onSave(trimmed);
  };

  return (
    <ModalShell onClose={onClose} panelClassName="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Rename Folder</h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
          <Icon name="X" size={18} />
        </button>
      </div>
      <div className="mb-4">
        <label className="block text-sm font-medium text-foreground mb-1.5">New name</label>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => { setName(e?.target?.value); setError(''); }}
          onKeyDown={(e) => { if (e?.key === 'Enter') handleSave(); if (e?.key === 'Escape') onClose(); }}
          className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground"
        />
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted rounded-xl hover:bg-muted/80 transition-colors">Cancel</button>
        <button onClick={handleSave} className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors">Save</button>
      </div>
    </ModalShell>
  );
};

// ─── Edit Folder Appearance Modal ────────────────────────────────────────────
const EditFolderAppearanceModal = ({ folderName, currentIcon, currentColor, onClose, onSave }) => {
  const [selectedIcon, setSelectedIcon] = useState(currentIcon || null);
  const [selectedColor, setSelectedColor] = useState(currentColor || null);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [iconSearch, setIconSearch] = useState('');

  const previewColor = selectedColor || '#4A90E2';
  const previewIcon = selectedIcon || 'FolderOpen';

  return (
    <ModalShell onClose={onClose} panelClassName="inv-modal">
      <div className="inv-modal-head">
        <div>
          <div className="inv-modal-eyebrow">Appearance</div>
          <h2 className="inv-modal-title">{folderName}</h2>
        </div>
        <button onClick={onClose} className="inv-modal-close"><Icon name="X" size={18} /></button>
      </div>

      {/* Preview + Icon toggle */}
      <div className="flex items-center gap-3" style={{ marginBottom: 14 }}>
        <div className="inv-preview" style={{ backgroundColor: previewColor + '22', border: `2px solid ${previewColor}44` }}>
          <Icon name={previewIcon} size={22} style={{ color: previewColor }} />
        </div>
        <button type="button" onClick={() => setShowIconPicker(v => !v)} className="inv-picker-toggle" style={{ flex: 1 }}>
          <span className="flex items-center gap-2">
            <Icon name={previewIcon} size={14} />
            <span>{previewIcon}</span>
          </span>
          <Icon name={showIconPicker ? 'ChevronUp' : 'ChevronDown'} size={14} />
        </button>
      </div>

      {showIconPicker && (
        <div className="inv-picker-panel" style={{ marginBottom: 14 }}>
          <input
            type="text"
            value={iconSearch}
            onChange={e => setIconSearch(e?.target?.value)}
            placeholder="Search icons…"
            className="inv-field"
            style={{ marginBottom: 10, padding: '8px 11px', fontSize: 13 }}
          />
          <div className="inv-icongrid">
            {FOLDER_ICON_PALETTE?.filter(n => !iconSearch || n?.toLowerCase()?.includes(iconSearch?.toLowerCase()))?.map(iconName => (
              <button
                key={iconName}
                type="button"
                onClick={() => { setSelectedIcon(iconName); setShowIconPicker(false); setIconSearch(''); }}
                className={`inv-iconopt${selectedIcon === iconName ? ' on' : ''}`}
                title={iconName}
              >
                <Icon name={iconName} size={14} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="inv-fieldwrap">
        <label className="inv-flabel">Colour</label>
        <div className="inv-swatchrow" style={{ marginTop: 0 }}>
          {FOLDER_COLOR_PALETTE?.map(c => (
            <button
              key={c?.value}
              type="button"
              onClick={() => setSelectedColor(selectedColor === c?.value ? null : c?.value)}
              className="inv-swatch-c"
              style={{ backgroundColor: c?.value, outlineColor: selectedColor === c?.value ? c?.value : 'transparent' }}
              title={c?.label}
            />
          ))}
          {selectedColor && (
            <button type="button" onClick={() => setSelectedColor(null)} className="inv-swatch-reset">Reset</button>
          )}
        </div>
      </div>

      <div className="inv-modal-actions">
        <button onClick={onClose} className="inv-btn ghost">Cancel</button>
        <button onClick={() => onSave({ icon: selectedIcon, color: selectedColor })} className="inv-btn primary">Save</button>
      </div>
    </ModalShell>
  );
};

// ─── Folder Settings Cog Modal ────────────────────────────────────────────────
const FolderSettingsModal = ({ folderName, parentSegments, currentVisibility, onClose, onRename, onMove, onDelete, onArchive, onVisibilityChange, onEditAppearance, canMove }) => {
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);

  const handleVisibility = async (value) => {
    setSavingVisibility(true);
    await onVisibilityChange(value);
    setSavingVisibility(false);
    setShowVisibilityMenu(false);
  };

  return (
    <ModalShell onClose={onClose} panelClassName="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
            <Icon name="Settings" size={16} className="text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Folder Settings</h2>
            <p className="text-xs text-muted-foreground">{folderName}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
          <Icon name="X" size={18} />
        </button>
      </div>

      <div className="space-y-1">
        {/* Rename */}
        <button
          onClick={() => { onClose(); onRename(); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-muted rounded-xl transition-colors text-left"
        >
          <Icon name="Pencil" size={15} className="text-muted-foreground" />
          Rename folder
        </button>

        {/* Edit Appearance */}
        {onEditAppearance && (
          <button
            onClick={() => { onClose(); onEditAppearance(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-muted rounded-xl transition-colors text-left"
          >
            <Icon name="Palette" size={15} className="text-muted-foreground" />
            Edit icon &amp; colour
          </button>
        )}

        {/* Move */}
        {canMove !== false && (
        <button
          onClick={() => { onClose(); onMove(); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-muted rounded-xl transition-colors text-left"
        >
          <Icon name="FolderInput" size={15} className="text-muted-foreground" />
          Move folder
        </button>
        )}

        {/* Visibility */}
        <div>
          <button
            onClick={() => setShowVisibilityMenu(prev => !prev)}
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-muted rounded-xl transition-colors text-left"
          >
            <div className="flex items-center gap-3">
              <Icon name="Eye" size={15} className="text-muted-foreground" />
              Visibility restriction
            </div>
            <Icon name={showVisibilityMenu ? 'ChevronUp' : 'ChevronDown'} size={14} className="text-muted-foreground" />
          </button>
          {showVisibilityMenu && (
            <div className="ml-6 mt-1 space-y-0.5">
              {VISIBILITY_OPTIONS?.map(opt => (
                <button
                  key={opt?.value}
                  onClick={() => handleVisibility(opt?.value)}
                  disabled={savingVisibility}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs rounded-lg transition-colors text-left ${
                    currentVisibility === opt?.value
                      ? 'bg-primary/10 text-primary font-medium' :'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {opt?.label}
                  {currentVisibility === opt?.value && <Icon name="Check" size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-px bg-border my-1" />

        {/* Archive */}
        <button
          onClick={() => { onClose(); onArchive(); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-amber-600 hover:bg-amber-50 rounded-xl transition-colors text-left"
        >
          <Icon name="Archive" size={15} className="text-amber-500" />
          Archive folder
        </button>

        {/* Delete */}
        <button
          onClick={() => { onClose(); onDelete(); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-xl transition-colors text-left"
        >
          <Icon name="Trash2" size={15} className="text-red-500" />
          Delete folder
        </button>
      </div>
    </ModalShell>
  );
};

// ─── Folder Tree Picker (drill-in navigator) ─────────────────────────────────
// A Finder-style destination picker: breadcrumb + one level of folders at a
// time + a global search. Replaces the old flat indented list, which was
// unusable with many folders or duplicate names (you couldn't tell two
// "General" folders apart). `onPick` reports the currently-browsed segments
// (or null at the root) so the parent can enable/disable "Move here".
const FolderTreePicker = ({ folderTree, onPick, disablePath, blockPath, isCommand, userDepartment }) => {
  const [browse, setBrowse] = useState([]);
  const [query, setQuery] = useState('');

  const childrenOf = (segments) => folderTree?.[segments?.join('|||')]?.subFolders || [];
  const metaOf = (segments, name) => folderTree?.[segments?.join('|||')]?.folderMeta?.[name] || {};

  const rootAllowed = (seg0) => isCommand || ((seg0 || '')?.toLowerCase() === (userDepartment || '')?.toLowerCase());
  const isBlocked = (path) => !!blockPath && (path === blockPath || path?.startsWith(blockPath + ' > '));

  const allFolders = useMemo(() => {
    const out = [];
    const walk = (segs) => {
      childrenOf(segs)?.forEach(name => {
        const s = [...segs, name];
        out?.push({ segments: s, name, path: s?.join(' > ') });
        walk(s);
      });
    };
    walk([]);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderTree]);

  const q = query?.trim()?.toLowerCase();
  const searchResults = q
    ? allFolders?.filter(f => f?.name?.toLowerCase()?.includes(q) && rootAllowed(f?.segments?.[0]) && !isBlocked(f?.path))
    : null;

  useEffect(() => {
    onPick(browse?.length > 0 ? browse : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browse?.join('|||')]);

  const rows = childrenOf(browse);

  const row = (name, segments) => {
    const path = segments?.join(' > ');
    const kids = childrenOf(segments)?.length;
    const blocked = isBlocked(path) || !rootAllowed(segments?.[0]);
    const isCurrent = path === disablePath;
    return (
      <div key={path} className={`inv-pickrow${blocked ? ' blocked' : ''}`}>
        <button
          className="inv-pickrow-main"
          disabled={blocked}
          onClick={() => setBrowse(segments)}
          title={blocked ? 'Not available' : `Open ${name}`}
        >
          <Icon name={metaOf(browse, name)?.icon || 'Folder'} size={15} />
          <span className="inv-pickrow-name">{name}</span>
          {isCurrent && <span className="inv-pickrow-tag">current</span>}
          {kids > 0 && <span className="inv-pickrow-count">{kids}</span>}
        </button>
        {kids > 0 && !blocked && (
          <button className="inv-pickrow-drill" onClick={() => setBrowse(segments)} title={`Open ${name}`}>
            <Icon name="ChevronRight" size={16} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="inv-picker">
      <div className="inv-picker-search">
        <Icon name="Search" size={14} />
        <input
          type="text"
          placeholder="Search all folders…"
          value={query}
          onChange={(e) => setQuery(e?.target?.value)}
          autoFocus
        />
        {query && <button onClick={() => setQuery('')}><Icon name="X" size={13} /></button>}
      </div>

      {!q && (
        <div className="inv-picker-crumbs">
          <button className="inv-picker-crumb" onClick={() => setBrowse([])}>
            <Icon name="Home" size={13} /> All
          </button>
          {browse?.map((seg, i) => (
            <React.Fragment key={i}>
              <Icon name="ChevronRight" size={13} />
              <button className="inv-picker-crumb" onClick={() => setBrowse(browse?.slice(0, i + 1))}>{seg}</button>
            </React.Fragment>
          ))}
        </div>
      )}

      <div className="inv-picker-list">
        {q ? (
          searchResults?.length > 0 ? (
            searchResults?.map(f => (
              <button key={f?.path} className="inv-pickrow-main search" onClick={() => { setBrowse(f?.segments); setQuery(''); }}>
                <Icon name="Folder" size={15} />
                <span className="inv-pickrow-name">{f?.name}</span>
                <span className="inv-pickrow-path">{f?.segments?.slice(0, -1)?.join(' › ') || 'Department'}</span>
              </button>
            ))
          ) : (
            <p className="inv-picker-empty">No folders match “{query}”</p>
          )
        ) : rows?.length > 0 ? (
          rows?.map(name => row(name, [...browse, name]))
        ) : (
          <p className="inv-picker-empty">{browse?.length === 0 ? 'No departments' : 'No sub-folders here'}</p>
        )}
      </div>
    </div>
  );
};

// ─── Move Folder Modal ────────────────────────────────────────────────────────
const MoveFolderModal = ({ folderName, currentPathSegments, folderTree, onClose, onMove, isCommand, isChief, isHOD, userDepartment }) => {
  const [target, setTarget] = useState(null);
  const [moving, setMoving] = useState(false);

  const selfPath = [...currentPathSegments, folderName]?.join(' > ');
  const parentPath = currentPathSegments?.join(' > ');
  const targetPath = target?.join(' > ') || '';
  const canMoveHere = !!target
    && targetPath !== selfPath
    && targetPath !== parentPath
    && !targetPath?.startsWith(selfPath + ' > ');

  const handleConfirm = async () => {
    if (!canMoveHere) return;
    setMoving(true);
    await onMove(currentPathSegments, target, folderName);
    setMoving(false);
    onClose();
  };

  return (
    <ModalShell onClose={onClose} panelClassName="inv-modal">
      <div className="inv-modal-head">
        <div>
          <div className="inv-modal-eyebrow">Move</div>
          <h2 className="inv-modal-title">Move {folderName}</h2>
        </div>
        <button onClick={onClose} className="inv-modal-close"><Icon name="X" size={18} /></button>
      </div>

      <label className="inv-flabel">Pick a destination — open a folder, then Move here</label>
      <FolderTreePicker
        folderTree={folderTree}
        onPick={setTarget}
        disablePath={parentPath}
        blockPath={selfPath}
        isCommand={isCommand}
        userDepartment={userDepartment}
      />

      <p className="inv-modal-sub" style={{ margin: '10px 0 0', minHeight: 18 }}>
        {target
          ? (canMoveHere
              ? <>Moving into <b>{target?.join(' › ')}</b></>
              : <span style={{ color: '#B14E16' }}>Can’t move here — pick a different folder</span>)
          : 'Open a folder to move into it'}
      </p>

      <div className="inv-modal-actions">
        <button onClick={onClose} className="inv-btn ghost">Cancel</button>
        <button onClick={handleConfirm} disabled={!canMoveHere || moving} className="inv-btn primary">
          {moving && <LogoSpinner size={14} />}
          {moving ? 'Moving…' : 'Move here'}
        </button>
      </div>
    </ModalShell>
  );
};

// ─── Bulk Move Items Modal ────────────────────────────────────────────────────
const BulkMoveItemsModal = ({ selectedCount, itemLabel, folderTree, currentPathSegments, onClose, onMove, isCommand, isChief, isHOD, userDepartment }) => {
  const [target, setTarget] = useState(null);
  const [moving, setMoving] = useState(false);

  const currentPath = currentPathSegments?.join(' > ');
  const targetPath = target?.join(' > ') || '';
  const canMoveHere = !!target && targetPath !== currentPath;

  const handleConfirm = async () => {
    if (!canMoveHere) return;
    setMoving(true);
    await onMove(target);
    setMoving(false);
    onClose();
  };

  const title = itemLabel ? `Move ${itemLabel}` : `Move ${selectedCount} item${selectedCount !== 1 ? 's' : ''}`;
  return (
    <ModalShell onClose={onClose} panelClassName="inv-modal">
      <div className="inv-modal-head">
        <div>
          <div className="inv-modal-eyebrow">Move</div>
          <h2 className="inv-modal-title">{title}</h2>
        </div>
        <button onClick={onClose} className="inv-modal-close"><Icon name="X" size={18} /></button>
      </div>

      <label className="inv-flabel">Pick a destination — open a folder, then Move here</label>
      <FolderTreePicker
        folderTree={folderTree}
        onPick={setTarget}
        disablePath={currentPath}
        isCommand={isCommand}
        userDepartment={userDepartment}
      />

      <p className="inv-modal-sub" style={{ margin: '10px 0 0', minHeight: 18 }}>
        {target
          ? (canMoveHere
              ? <>Moving into <b>{target?.join(' › ')}</b></>
              : <span style={{ color: '#B14E16' }}>Items are already here — pick another folder</span>)
          : 'Open a folder to move into it'}
      </p>

      <div className="inv-modal-actions">
        <button onClick={onClose} className="inv-btn ghost">Cancel</button>
        <button onClick={handleConfirm} disabled={!canMoveHere || moving} className="inv-btn primary">
          {moving && <LogoSpinner size={14} />}
          {moving ? 'Moving…' : 'Move here'}
        </button>
      </div>
    </ModalShell>
  );
};

// ─── Bulk Delete Confirm Modal ────────────────────────────────────────
const BulkDeleteConfirmModal = ({ selectedCount, onClose, onConfirm }) => {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
    onClose();
  };

  return (
    <ModalShell onClose={onClose} panelClassName="inv-modal">
      <div className="inv-modal-head">
        <div>
          <div className="inv-modal-eyebrow">Delete</div>
          <h2 className="inv-modal-title">Delete {selectedCount} item{selectedCount !== 1 ? 's' : ''}?</h2>
        </div>
        <button onClick={onClose} className="inv-modal-close"><Icon name="X" size={18} /></button>
      </div>
      <div className="inv-confirm">
        <div className="inv-confirm-icon danger"><Icon name="Trash2" size={18} /></div>
        <div>
          <p className="inv-confirm-title">Moves to Trash</p>
          <p className="inv-confirm-text"><b>{selectedCount} item{selectedCount !== 1 ? 's' : ''}</b> will be removed. You can restore from Trash for 30 days.</p>
        </div>
      </div>
      <div className="inv-modal-actions">
        <button onClick={onClose} className="inv-btn ghost">Cancel</button>
        <button onClick={handleConfirm} disabled={deleting} className="inv-btn danger">
          {deleting && <LogoSpinner size={14} />}
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </ModalShell>
  );
};

// ─── Add Dropdown Button ──────────────────────────────────────────────────────
const AddDropdownButton = ({ isRoot, onAddFolder, onAddItem }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => { if (ref?.current && !ref?.current?.contains(e?.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="inv-adddrop" ref={ref}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className="inv-btn primary"
      >
        <Icon name="Plus" size={15} />
        Add
        <Icon name="ChevronDown" size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="inv-addmenu">
          {!isRoot && (
            <button
              onClick={() => { setOpen(false); onAddFolder(); }}
              className="inv-addmenu-item"
            >
              <Icon name="FolderPlus" size={15} />
              Add Sub-folder
            </button>
          )}
          <button
            onClick={() => { setOpen(false); onAddItem(); }}
            className="inv-addmenu-item"
          >
            <Icon name="PackagePlus" size={15} />
            Add Item
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Quick Quantity Control ────────────────────────────────────────────────────
// Size-run helpers — a uniform item stores per-size stock in `variants`. The
// single Qty ± can't know which size to draw from, so the card expands to a
// per-size stepper; this persists a size change back into variants (+ the
// matching size inside each storage location) and recomputes the total.
const variantsOfItem = (item) => (item?.variants || []).filter((v) => v && (v.size || v.label));
const persistVariantQtys = async (item, vqtys) => {
  const bySize = new Map(vqtys.map((v) => [v.size, Number(v.qty) || 0]));
  const variants = (item?.variants || []).map((v) => {
    const s = v.size || v.label;
    return bySize.has(s) ? { ...v, qty: bySize.get(s) } : v;
  });
  const total = variants.reduce((a, v) => a + (Number(v.qty) || 0), 0);
  const stockLocations = (item?.stockLocations || []).map((sl) => {
    if (!Array.isArray(sl.sizes)) return sl;
    const sizes = sl.sizes.map((z) => (bySize.has(z.size) ? { ...z, qty: bySize.get(z.size) } : z));
    const q = sizes.reduce((a, z) => a + (Number(z.qty) || 0), 0);
    return { ...sl, sizes, quantity: q, qty: q };
  });
  await saveItem({ ...item, variants, totalQty: total, quantity: total, stockLocations }, { dedupe: false });
};

const QuickQtyControl = ({ item, onUpdate, locationQtys, setLocationQtys, showLocations, onToggleLocations, variantQtys, showSizes, onToggleSizes }) => {
  const [loading, setLoading] = useState(false);
  const [localQty, setLocalQty] = useState(item?.quantity ?? item?.totalQty ?? 0);
  const pendingUpdateRef = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const stockLocations = item?.stockLocations || [];
  const isMultiLocation = stockLocations?.length > 1;
  const hasVariants = variantsOfItem(item).length > 0;

  const variantTotal = (variantQtys?.length ? variantQtys : variantsOfItem(item).map((v) => ({ qty: Number(v.qty ?? v.quantity) || 0 })))
    .reduce((sum, v) => sum + (Number(v.qty) || 0), 0);
  const displayQty = hasVariants
    ? variantTotal
    : (isMultiLocation && locationQtys?.length > 0
      ? locationQtys?.reduce((sum, loc) => sum + (loc?.qty || 0), 0)
      : localQty);

  useEffect(() => {
    const total = stockLocations?.length > 0
      ? stockLocations?.reduce((sum, loc) => sum + (loc?.qty || 0), 0)
      : (item?.quantity ?? item?.totalQty ?? 0);
    setLocalQty(total);
    if (setLocationQtys) setLocationQtys(stockLocations?.map(loc => ({ ...loc })));
  }, [item]);

  useEffect(() => {
    return () => {
      if (pendingUpdateRef?.current) {
        onUpdateRef?.current?.();
      }
    };
  }, []);

  const adjustSingle = async (delta) => {
    setLoading(true);
    const newQty = Math.max(0, localQty + delta);
    setLocalQty(newQty);
    pendingUpdateRef.current = true;
    await saveItem({ ...item, quantity: newQty, totalQty: newQty });
    setLoading(false);
  };

  const adjustLocation = async (idx, delta) => {
    if (!locationQtys || !setLocationQtys) return;
    const updated = locationQtys?.map((loc, i) =>
      i === idx ? { ...loc, qty: Math.max(0, (loc?.qty || 0) + delta) } : loc
    );
    setLocationQtys(updated);
    const newTotal = updated?.reduce((sum, loc) => sum + (loc?.qty || 0), 0);
    setLocalQty(newTotal);
    pendingUpdateRef.current = true;
    await updateItemStockLocations(item?.id, updated);
  };

  // Variants take priority over locations: a size-run item expands per size.
  const expandable = hasVariants || isMultiLocation;
  const expanded = hasVariants ? showSizes : showLocations;

  const handleButtonClick = (e, delta) => {
    e?.stopPropagation();
    if (hasVariants) {
      onToggleSizes?.();
    } else if (isMultiLocation) {
      onToggleLocations?.();
    } else {
      adjustSingle(delta);
    }
  };

  return (
    <div className="inv-qty">
      <button
        onClick={(e) => handleButtonClick(e, -1)}
        disabled={loading || (!expandable && localQty <= 0)}
        className={`inv-qtybtn ${expandable ? 'neutral' : 'minus'}`}
        title={hasVariants ? 'Adjust stock by size' : undefined}
      >
        <Icon name={expandable ? (expanded ? 'ChevronUp' : 'ChevronDown') : 'Minus'} size={12} />
      </button>
      <span className="inv-qtyval">{displayQty}</span>
      <button
        onClick={(e) => handleButtonClick(e, 1)}
        disabled={loading}
        className={`inv-qtybtn ${expandable ? 'neutral' : 'plus'}`}
        title={hasVariants ? 'Adjust stock by size' : undefined}
      >
        <Icon name={expandable ? (expanded ? 'ChevronUp' : 'ChevronDown') : 'Plus'} size={12} />
      </button>
    </div>
  );
};

// Simple bottle silhouette icon — used for partial bottle tracking buttons
const BottleIconSvg = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 14 20" fill="currentColor" style={{ display: 'block' }}>
    <path d="M5.5,0 L8.5,0 L8.5,3 L11.5,5.5 L11.5,17.5 A2,2,0,0,1,9.5,19.5 L4.5,19.5 A2,2,0,0,1,2.5,17.5 L2.5,5.5 L5.5,3 Z" />
  </svg>
);

const getLastLocationSegment = (loc) => {
  const raw = loc?.locationName || loc?.location_name || loc?.location || loc?.name || '';
  if (!raw) return null;
  const parts = raw?.split(/[>\/\\|]/)?.map(s => s?.trim())?.filter(Boolean);
  return parts?.[parts?.length - 1] || raw;
};

const ALCOHOL_PATH_KEYWORDS = [
  'alcohol', 'wine', 'champagne', 'spirits', 'vodka', 'gin', 'whisky', 'whiskey',
  'rum', 'tequila', 'mezcal', 'brandy', 'cognac', 'beer', 'lager', 'ale', 'stout',
  'ipa', 'craft beer', 'liqueur', 'aperitif', 'digestif', 'vermouth', 'amaro',
  'prosecco', 'cava', 'sparkling', 'red wine', 'white wine', 'rosé', 'rose',
  'dessert wine',
];

const isAlcoholItem = (item) => {
  // Prefer the explicit DB flag set via the Add/Edit modal
  if (item?.isAlcohol != null) return !!item?.isAlcohol;
  // Fall back to keyword detection on the item's taxonomy/location path
  const pathText = [item?.subLocation, item?.location, item?.l3Name, item?.l2Name, item?.l1Name]
    .filter(Boolean).join(' ').toLowerCase();
  return ALCOHOL_PATH_KEYWORDS.some(kw => pathText.includes(kw));
};

// ─── Item Appearance Popover ───────────────────────────────────────────────────
const ITEM_COLOR_PRESETS = [
  '#4A90E2', '#1E3A5F', '#0D9488', '#16A34A', '#D97706',
  '#DC2626', '#7C3AED', '#DB2777', '#475569', '#E11D48',
  '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#F97316',
];

const ItemAppearancePopover = ({ item, anchorRect, onClose, onSave }) => {
  const [tab, setTab] = useState('icon');
  const [selectedIcon, setSelectedIcon] = useState(item?.icon || null);
  const [selectedColor, setSelectedColor] = useState(item?.color || null);
  const [iconSearch, setIconSearch] = useState('');
  const popoverRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => { if (popoverRef?.current && !popoverRef?.current?.contains(e?.target)) onClose(); };
    const handleKey = (e) => { if (e?.key === 'Escape') onClose(); };
    setTimeout(() => {
      document?.addEventListener('mousedown', handleClick);
      document?.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      document?.removeEventListener('mousedown', handleClick);
      document?.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const handleSave = async (icon, color) => {
    await updateItemAppearance(item?.id, icon, color);
    onSave({ ...item, icon, color });
  };

  // Position: below + left-aligned to anchor, clamped to viewport
  const style = (() => {
    if (!anchorRect) return { position: 'fixed', top: 120, left: 20 };
    const W = window?.innerWidth || 800;
    const H = window?.innerHeight || 600;
    let top = anchorRect?.bottom + 6;
    let left = anchorRect?.left;
    if (left + 296 > W - 8) left = W - 296 - 8;
    if (top + 320 > H - 8) top = anchorRect?.top - 326;
    return { position: 'fixed', top, left, zIndex: 'var(--z-overlay)', width: 296 };
  })();

  const filteredIcons = FOLDER_ICON_PALETTE?.filter(n => !iconSearch || n?.toLowerCase()?.includes(iconSearch?.toLowerCase()));

  return createPortal(
    <div ref={popoverRef} style={style} className="iap">
      <div className="iap-head">
        <div className="iap-tabs">
          {[{ id: 'icon', label: 'Icon' }, { id: 'color', label: 'Colour' }]?.map(t => (
            <button
              key={t?.id}
              onClick={() => setTab(t?.id)}
              className={`iap-tab${tab === t?.id ? ' on' : ''}`}
            >
              {t?.label}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="iap-x" aria-label="Close"><Icon name="X" size={15} /></button>
      </div>

      <div className="iap-body">
        {/* Preview strip */}
        <div className="iap-preview">
          <div
            className="iap-swatch"
            style={selectedColor ? { backgroundColor: selectedColor + '22', border: `1.5px solid ${selectedColor}55`, color: selectedColor } : {}}
          >
            <Icon name={selectedIcon || 'Package'} size={18} />
          </div>
          <div className="iap-preview-info">
            <p className="iap-preview-name">{item?.name}</p>
            <p className="iap-preview-sub">{selectedIcon || 'Default icon'}{selectedColor ? ` · ${selectedColor}` : ''}</p>
          </div>
          {(selectedIcon || selectedColor) && (
            <button
              onClick={() => { setSelectedIcon(null); setSelectedColor(null); handleSave(null, null); }}
              className="iap-clear"
            >
              Clear
            </button>
          )}
        </div>

        {tab === 'icon' && (
          <>
            <input
              type="text"
              value={iconSearch}
              onChange={e => setIconSearch(e?.target?.value)}
              placeholder="Search icons…"
              className="iap-search"
            />
            <div className="iap-icongrid">
              {filteredIcons?.map(iconName => (
                <button
                  key={iconName}
                  title={iconName}
                  onClick={() => { setSelectedIcon(iconName); handleSave(iconName, selectedColor); }}
                  className={`iap-icon${selectedIcon === iconName ? ' on' : ''}`}
                >
                  <Icon name={iconName} size={15} />
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'color' && (
          <>
            <div className="iap-swatches">
              {ITEM_COLOR_PRESETS?.map(hex => (
                <button
                  key={hex}
                  onClick={() => { setSelectedColor(hex); handleSave(selectedIcon, hex); }}
                  className={`iap-color${selectedColor === hex ? ' on' : ''}`}
                  style={{ backgroundColor: hex, '--sw': hex }}
                  title={hex}
                />
              ))}
            </div>
            <div className="iap-custom">
              <label>Custom</label>
              <input
                type="color"
                value={selectedColor || '#C65A1A'}
                onChange={e => setSelectedColor(e?.target?.value)}
                onBlur={e => handleSave(selectedIcon, e?.target?.value)}
                className="iap-colorinput"
              />
              {selectedColor && <span className="iap-hex">{selectedColor}</span>}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
};

// ─── Item Row (List View) ──────────────────────────────────────────────────────
// ─── Item actions menu (⋯) — mirrors the folder menu on item tiles ───────────────
const ItemActionsMenu = ({ item, onEdit, onAppearance, onMove, onClone, onDelete, size = 28 }) => {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (menuRef?.current?.contains(e?.target) || triggerRef?.current?.contains(e?.target)) return;
      setOpen(false);
    };
    const handleKey = (e) => { if (e?.key === 'Escape') setOpen(false); };
    const handleScroll = () => setOpen(false);
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open]);

  // Anchor the menu to the trigger with fixed positioning so a card's
  // overflow:hidden can't clip it (the old absolute dropdown was invisible).
  // Position is finalised in a layout effect once the real menu size is known,
  // so a flip near the viewport edge sits flush against the trigger.
  const toggle = (e) => {
    e?.stopPropagation();
    setOpen((o) => !o);
  };

  React.useLayoutEffect(() => {
    if (!open) { setMenuStyle(null); return; }
    const t = triggerRef?.current?.getBoundingClientRect();
    const m = menuRef?.current?.getBoundingClientRect();
    if (!t) return;
    const W = window?.innerWidth || 800;
    const H = window?.innerHeight || 600;
    const width = m?.width || 200;
    const height = m?.height || 240;
    let left = t.right - width;
    if (left < 8) left = 8;
    if (left + width > W - 8) left = W - width - 8;
    // Prefer below the trigger; flip flush above if it would overflow the bottom.
    let top = t.bottom + 6;
    if (top + height > H - 8) top = Math.max(8, t.top - height - 6);
    setMenuStyle({ position: 'fixed', top, left, right: 'auto', width: 200, zIndex: 'var(--z-overlay, 1000)' });
  }, [open, onAppearance]);

  const rowBtn = (iconName, label, fn, opts = {}) => (
    <button className={`inv-menuitem${opts?.danger ? ' danger' : ''}`} onClick={(e) => { e?.stopPropagation(); setOpen(false); fn?.(item); }}>
      <Icon name={iconName} size={15} /><span>{label}</span>
    </button>
  );

  return (
    <div className="inv-actionsmenu">
      <button ref={triggerRef} className="inv-menutrigger" title="Item actions" style={{ width: size, height: size }} onClick={toggle}>
        <Icon name="MoreHorizontal" size={16} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="inv-menu" style={menuStyle || { position: 'fixed', top: -9999, left: -9999, width: 200, visibility: 'hidden', zIndex: 'var(--z-overlay, 1000)' }} onClick={(e) => e?.stopPropagation()}>
          {item?.name && <div className="inv-menu-head" title={item?.name}>{item?.name}</div>}
          {onEdit && rowBtn('Pencil', 'Edit', onEdit)}
          {onAppearance && (
            <button className="inv-menuitem" onClick={(e) => { e?.stopPropagation(); const r = triggerRef?.current?.getBoundingClientRect(); setOpen(false); onAppearance?.(r); }}>
              <Icon name="Palette" size={15} /><span>Icon &amp; colour</span>
            </button>
          )}
          {onMove && rowBtn('FolderInput', 'Move', onMove)}
          {onClone && rowBtn('Copy', 'Duplicate', onClone)}
          {onDelete && (<><div className="inv-menu-sep" />{rowBtn('Trash2', 'Delete', onDelete, { danger: true })}</>)}
        </div>,
        document.body
      )}
    </div>
  );
};

const ItemDeleteModal = ({ item, onClose, onConfirm }) => (
  <ModalShell onClose={onClose} panelClassName="inv-modal">
    <div className="inv-modal-head">
      <div>
        <div className="inv-modal-eyebrow">Delete</div>
        <h2 className="inv-modal-title">Delete item?</h2>
      </div>
      <button onClick={onClose} className="inv-modal-close"><Icon name="X" size={18} /></button>
    </div>
    <div className="inv-confirm">
      <div className="inv-confirm-icon danger"><Icon name="Trash2" size={18} /></div>
      <div>
        <p className="inv-confirm-title">Moves to Trash</p>
        <p className="inv-confirm-text"><b>{item?.name}</b> will be removed. You can restore it from Trash for 30 days.</p>
      </div>
    </div>
    <div className="inv-modal-actions">
      <button onClick={onClose} className="inv-btn ghost">Cancel</button>
      <button onClick={onConfirm} className="inv-btn danger">Delete</button>
    </div>
  </ModalShell>
);

// ─── Trash (recently deleted) modal ─────────────────────────────────────────────
const TrashModal = ({ items, loading, onClose, onRestore, onPurge, onEmpty, canEmpty }) => (
  <ModalShell onClose={onClose} panelClassName="inv-modal inv-modal-lg">
    <div className="inv-modal-head">
      <div>
        <div className="inv-modal-eyebrow">Recently deleted</div>
        <h2 className="inv-modal-title">Trash</h2>
      </div>
      <button onClick={onClose} className="inv-modal-close"><Icon name="X" size={18} /></button>
    </div>
    <p className="inv-modal-sub">Deleted items and folders are kept for 30 days, then permanently removed.</p>
    {loading ? (
      <div style={{ padding: '34px 0', textAlign: 'center' }}><LogoSpinner size={20} /></div>
    ) : (items?.length === 0 ? (
      <div className="inv-trash-empty">
        <Icon name="Trash2" size={26} />
        <p>Trash is empty</p>
      </div>
    ) : (
      <div className="inv-trash-list">
        {items?.map(t => (
          <div key={t?.id} className="inv-trash-row">
            <div className="inv-trash-info">
              <div className="inv-trash-name">{t?.folder_name}</div>
              <div className="inv-trash-meta">
                {t?.folder_path && <span>{t?.folder_path}</span>}
                <span>{t?.item_count} item{t?.item_count !== 1 ? 's' : ''}</span>
                <span>deleted {formatDate(t?.deleted_at)}</span>
              </div>
            </div>
            <div className="inv-trash-actions">
              <button className="inv-selbtn primary" onClick={() => onRestore(t?.id)}><Icon name="Undo2" size={13} />Restore</button>
              <button className="inv-selbtn danger" onClick={() => onPurge(t?.id)} title="Delete permanently"><Icon name="Trash2" size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    ))}
    {canEmpty && items?.length > 0 && (
      <div className="inv-modal-actions">
        <button className="inv-btn ghost" onClick={onEmpty}>Empty trash</button>
      </div>
    )}
  </ModalShell>
);

const ItemRow = ({ item: itemProp, canEdit, onEdit, onDelete, onMove, onClone, onUpdate, onQuickView, isSelected, onToggleSelect, selectionMode = false, onAppearanceChange }) => {
  const [item, setItem] = useState(itemProp);
  useEffect(() => { setItem(itemProp); }, [itemProp]);

  const [appearanceAnchor, setAppearanceAnchor] = useState(null);
  // null=closed, -1=single-location/main, >=0=location index
  const [bottleModalLocIdx, setBottleModalLocIdx] = useState(null);

  const stockLocations = item?.stockLocations || [];
  const totalQty = stockLocations?.length > 0
    ? stockLocations?.reduce((sum, loc) => sum + (loc?.qty || 0), 0)
    : (item?.quantity ?? item?.totalQty ?? 0);
  const isLow = item?.restockEnabled && item?.restockLevel !== null && totalQty <= item?.restockLevel;
  const isMultiLocation = stockLocations?.length > 1;
  const [locationQtys, setLocationQtys] = useState(stockLocations?.map(loc => ({ ...loc })));
  const [showLocations, setShowLocations] = useState(false);
  const [showSizes, setShowSizes] = useState(false);
  const [variantQtys, setVariantQtys] = useState(variantsOfItem(item).map((v) => ({ size: v.size || v.label, qty: Number(v.qty ?? v.quantity) || 0 })));
  useEffect(() => { setVariantQtys(variantsOfItem(itemProp).map((v) => ({ size: v.size || v.label, qty: Number(v.qty ?? v.quantity) || 0 }))); }, [itemProp]);
  const pendingLocUpdateRef = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  useEffect(() => {
    return () => {
      if (pendingLocUpdateRef?.current) {
        onUpdateRef?.current?.();
      }
    };
  }, []);

  const singleLoc = (item?.stockLocations || []).length <= 1;
  const adjustSize = (idx, delta) => {
    if (!singleLoc) return;
    const updated = variantQtys.map((r, i) => (i === idx ? { ...r, qty: Math.max(0, (r.qty || 0) + delta) } : r));
    setVariantQtys(updated);
    pendingLocUpdateRef.current = true;
    persistVariantQtys(item, updated);
  };

  // Category label. NOTE: still reads DEPRECATED legacy l1..l3 names — this is the
  // last visible dependency on the old taxonomy. When retiring l1..l4, derive this
  // from the folder path instead. See docs/inventory-location-model.md.
  const categoryLabel = item?.l3Name || item?.l2Name || item?.l1Name || null;
  // Format expiry date — check both camelCase and snake_case field names
  const rawExpiry = item?.expiryDate || item?.expiry_date || null;
  const expiryLabel = rawExpiry ? (formatDate(rawExpiry) || rawExpiry) : null;

  const accentColor = item?.color || null;

  return (
    <>
    <div
      className={`inv-row${isSelected ? ' selected' : ''}`}
      style={accentColor ? { borderLeftColor: accentColor, borderLeftWidth: 3 } : {}}
    >
      <div className="inv-row-main">
        <button
          onClick={(e) => { e?.stopPropagation(); onToggleSelect?.(item); }}
          className={`inv-check${isSelected ? ' on' : ''}`}
          title={isSelected ? 'Deselect' : 'Select'}
        >
          {isSelected && <Icon name="Check" size={11} />}
        </button>

        {/* Colour/icon swatch — click to customise */}
        <button
          onClick={(e) => { e?.stopPropagation(); setAppearanceAnchor(e?.currentTarget?.getBoundingClientRect()); }}
          className="inv-swatch"
          style={accentColor
            ? { backgroundColor: accentColor + '25', borderColor: accentColor + '60', color: accentColor }
            : undefined
          }
          title="Customise icon & colour"
        >
          <Icon name={item?.icon || 'Palette'} size={13} />
        </button>

        {/* Item info: Name | Category | Code | Expiry */}
        <div className="inv-row-body">
          <div className="inv-row-nameline">
            <span
              className="inv-row-name"
              onClick={(e) => { e?.stopPropagation(); onQuickView?.(item); }}
              title="Quick view"
            >{item?.name}</span>
            {isLow && <span className="inv-badge-low">Low</span>}
          </div>
          <div className="inv-row-sub">
            {categoryLabel && (
              <span className="inv-metaitem">
                <Icon name="Tag" size={10} />
                <span className="truncate max-w-[120px]">{categoryLabel}</span>
              </span>
            )}
            {item?.cargoItemId && (
              <span className="inv-metaitem">
                <Icon name="Hash" size={10} />
                <span className="mono">{item?.cargoItemId}</span>
              </span>
            )}
            {expiryLabel && (
              <span className="inv-metaitem">
                <Icon name="Calendar" size={10} />
                <span>{expiryLabel}</span>
              </span>
            )}
          </div>
        </div>

        <div className="inv-row-right">
          <QuickQtyControl item={item} onUpdate={onUpdate} locationQtys={locationQtys} setLocationQtys={setLocationQtys} showLocations={showLocations} onToggleLocations={() => setShowLocations(v => !v)} variantQtys={variantQtys} showSizes={showSizes} onToggleSizes={() => setShowSizes(v => !v)} />
          {!isMultiLocation && isAlcoholItem(item) && (
            <button
              onClick={(e) => { e?.stopPropagation(); setBottleModalLocIdx(-1); }}
              title={item?.partialBottle != null ? `Partial bottle: ${item.partialBottle.toFixed(2)} — click to edit` : 'Track partial bottle'}
              style={{
                width: 28, height: 28, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 7, cursor: 'pointer', transition: 'all 0.15s',
                border: item?.partialBottle != null ? '1.5px solid #8B1538' : '1.5px dashed #CBD5E1',
                background: item?.partialBottle != null ? 'rgba(139,21,56,0.08)' : 'transparent',
                color: item?.partialBottle != null ? '#8B1538' : '#94A3B8',
              }}
            >
              <BottleIconSvg size={14} />
            </button>
          )}
          {canEdit && (
            <ItemActionsMenu item={item} onEdit={onEdit} onAppearance={(r) => setAppearanceAnchor(r)} onMove={onMove} onClone={onClone} onDelete={onDelete} />
          )}
        </div>
      </div>
      {variantQtys.length > 0 && showSizes && (
        <div className="inv-szgrid" style={{ padding: '4px 0 2px' }}>
          {variantQtys.map((r, idx) => (
            singleLoc ? (
              <span key={r.size} className="inv-szchip edit">
                <span className="s">{r.size}</span>
                <button onClick={(e) => { e?.stopPropagation(); adjustSize(idx, -1); }} disabled={r.qty <= 0} className="inv-szbtn minus" aria-label={`Less ${r.size}`}><Icon name="Minus" size={9} /></button>
                <span className="v">{r.qty}</span>
                <button onClick={(e) => { e?.stopPropagation(); adjustSize(idx, 1); }} className="inv-szbtn plus" aria-label={`More ${r.size}`}><Icon name="Plus" size={9} /></button>
              </span>
            ) : (
              <span key={r.size} className="inv-szchip"><span className="s">{r.size}</span><span className="v">{r.qty}</span></span>
            )
          ))}
          {!singleLoc && <p className="inv-szsplit">Split across locations — edit stock in the item.</p>}
        </div>
      )}
      {isMultiLocation && showLocations && locationQtys?.length > 0 && (
        <div className="inv-locexpand">
          {locationQtys?.map((loc, idx) => {
            const label = getLastLocationSegment(loc) || `Location ${idx + 1}`;
            const hasPartial = loc?.partial != null;
            return (
              <div key={idx} className="inv-locrow">
                <span className="inv-locname">{label}</span>
                <div className="flex items-center gap-1.5">
                  {isAlcoholItem(item) && (
                    <button
                      onClick={(e) => { e?.stopPropagation(); setBottleModalLocIdx(idx); }}
                      title={hasPartial ? `Partial: ${loc.partial.toFixed(2)} — click to edit` : 'Record partial bottle'}
                      style={{
                        width: 22, height: 22, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: 5, cursor: 'pointer', transition: 'all 0.15s',
                        border: hasPartial ? '1.5px solid #8B1538' : '1.5px dashed #CBD5E1',
                        background: hasPartial ? 'rgba(139,21,56,0.08)' : 'transparent',
                        color: hasPartial ? '#8B1538' : '#94A3B8',
                      }}
                    >
                      <BottleIconSvg size={11} />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e?.stopPropagation(); const updated = locationQtys?.map((l, i) => i === idx ? { ...l, qty: Math.max(0, (l?.qty || 0) - 1) } : l); setLocationQtys(updated); pendingLocUpdateRef.current = true; updateItemStockLocations(item?.id, updated); }}
                    disabled={loc?.qty <= 0}
                    className="inv-qtybtn minus" style={{ width: 24, height: 24 }}
                  >
                    <Icon name="Minus" size={10} />
                  </button>
                  <span className="min-w-[28px] text-center text-xs font-semibold text-foreground">
                    {hasPartial ? ((loc?.qty || 0) + loc.partial).toFixed(2).replace(/\.?0+$/, '') : (loc?.qty || 0)}
                  </span>
                  <button
                    onClick={(e) => { e?.stopPropagation(); const updated = locationQtys?.map((l, i) => i === idx ? { ...l, qty: (l?.qty || 0) + 1 } : l); setLocationQtys(updated); pendingLocUpdateRef.current = true; updateItemStockLocations(item?.id, updated); }}
                    className="inv-qtybtn plus" style={{ width: 24, height: 24 }}
                  >
                    <Icon name="Plus" size={10} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    {appearanceAnchor && (
      <ItemAppearancePopover
        item={item}
        anchorRect={appearanceAnchor}
        onClose={() => setAppearanceAnchor(null)}
        onSave={(updated) => { setItem(updated); onAppearanceChange?.(updated?.id, updated?.icon, updated?.color); }}
      />
    )}
    {bottleModalLocIdx !== null && (
      <PartialBottleModal
        itemName={item?.name}
        initialValue={bottleModalLocIdx >= 0 ? (locationQtys[bottleModalLocIdx]?.partial ?? null) : (item?.partialBottle ?? null)}
        onSave={async (fraction) => {
          const idx = bottleModalLocIdx;
          setBottleModalLocIdx(null);
          if (idx >= 0) {
            // Per-location partial: only touch this location, leave all others intact
            const updated = locationQtys?.map((l, i) => {
              if (i !== idx) return l;
              // Decrement qty only when setting a new partial (not editing an existing one)
              const newQty = l?.partial != null ? (l?.qty || 0) : Math.max(0, (l?.qty || 0) - 1);
              return { ...l, qty: newQty, partial: fraction };
            });
            setLocationQtys(updated);
            updateItemStockLocations(item?.id, updated);
          } else {
            // Single-location: persist to inventory_items.partial_bottle
            await updatePartialBottle(item?.id, fraction);
            setItem(prev => ({ ...prev, partialBottle: fraction }));
          }
          onUpdate?.();
        }}
        onClear={async () => {
          const idx = bottleModalLocIdx;
          setBottleModalLocIdx(null);
          if (idx >= 0) {
            // Per-location: only clear this location's partial, restore its qty
            const updated = locationQtys?.map((l, i) => {
              if (i !== idx) return l;
              const { partial: _p, ...rest } = l;
              return { ...rest, qty: l?.partial != null ? (l?.qty || 0) + 1 : (l?.qty || 0) };
            });
            setLocationQtys(updated);
            updateItemStockLocations(item?.id, updated);
          } else {
            await updatePartialBottle(item?.id, null);
            setItem(prev => ({ ...prev, partialBottle: null }));
          }
          onUpdate?.();
        }}
        onClose={() => setBottleModalLocIdx(null)}
      />
    )}
    </>
  );
};

// ─── Item Grid Card (Grid View) ────────────────────────────────────────────────
const ItemGridCard = ({ item: itemProp, canEdit, onEdit, onDelete, onMove, onClone, onUpdate, onQuickView, isSelected, onToggleSelect, selectionMode = false, onAppearanceChange, dragHandleProps, isDragging }) => {
  const [item, setItem] = useState(itemProp);
  useEffect(() => { setItem(itemProp); }, [itemProp]);
  const [appearanceAnchor, setAppearanceAnchor] = useState(null);
  // null=closed, -1=single-location/main, >=0=location index
  const [bottleModalLocIdx, setBottleModalLocIdx] = useState(null);
  const stockLocations = item?.stockLocations || [];
  const totalQty = stockLocations?.length > 0
    ? stockLocations?.reduce((sum, loc) => sum + (loc?.qty || 0), 0)
    : (item?.quantity ?? item?.totalQty ?? 0);
  const isLow = item?.restockEnabled && item?.restockLevel !== null && totalQty <= item?.restockLevel;
  const isMultiLocation = stockLocations?.length > 1;
  const [locationQtys, setLocationQtys] = useState(stockLocations?.map(loc => ({ ...loc })));
  const [showLocations, setShowLocations] = useState(false);
  const [showSizes, setShowSizes] = useState(false);
  const [variantQtys, setVariantQtys] = useState(variantsOfItem(item).map((v) => ({ size: v.size || v.label, qty: Number(v.qty ?? v.quantity) || 0 })));
  useEffect(() => { setVariantQtys(variantsOfItem(itemProp).map((v) => ({ size: v.size || v.label, qty: Number(v.qty ?? v.quantity) || 0 }))); }, [itemProp]);
  const pendingLocUpdateRef = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  useEffect(() => {
    return () => {
      if (pendingLocUpdateRef?.current) {
        onUpdateRef?.current?.();
      }
    };
  }, []);

  // Quick per-size edit is only unambiguous when the item lives in one place;
  // for split-across-locations stock the matrix is edited in the item modal.
  const singleLoc = (item?.stockLocations || []).length <= 1;
  const adjustSize = (idx, delta) => {
    if (!singleLoc) return;
    const updated = variantQtys.map((r, i) => (i === idx ? { ...r, qty: Math.max(0, (r.qty || 0) + delta) } : r));
    setVariantQtys(updated);
    pendingLocUpdateRef.current = true;
    persistVariantQtys(item, updated);
  };

  const [revealed, setRevealed] = useState(false); // touch: toggle the detail overlay
  const imageUrl = item?.imageUrl && !item?.imageUrl?.startsWith('blob:') ? item?.imageUrl : null;
  const accentColor = item?.color || null;
  const accentIcon = item?.icon || null;

  // Category label. NOTE: still reads DEPRECATED legacy l1..l3 names — this is the
  // last visible dependency on the old taxonomy. When retiring l1..l4, derive this
  // from the folder path instead. See docs/inventory-location-model.md.
  const categoryLabel = item?.l3Name || item?.l2Name || item?.l1Name || null;
  // Format expiry date — check both camelCase and snake_case field names
  const rawExpiry = item?.expiryDate || item?.expiry_date || null;
  const expiryLabel = rawExpiry ? (formatDate(rawExpiry) || rawExpiry) : null;

  return (
    <>
    <div
      className={`inv-card itemcard${isSelected ? ' selected' : ''}${isDragging ? ' itemdragging' : ''}${revealed ? ' revealed' : ''}`}
      style={accentColor ? { borderTopColor: accentColor, borderTopWidth: 3 } : {}}
    >
      <div
        className={`inv-card-media${dragHandleProps ? ' drag' : ''}`}
        style={accentColor && !imageUrl ? { backgroundColor: accentColor + '22' } : {}}
        onClick={() => onQuickView?.(item)}
        title={dragHandleProps ? 'Drag to move · click to view' : 'Quick view'}
        {...(dragHandleProps || {})}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={item?.name} />
        ) : (
          <span className="inv-placeholder">
            <Icon
              name={accentIcon || 'Package'}
              size={32}
              style={accentColor ? { color: accentColor } : undefined}
            />
          </span>
        )}
        {isLow && (
          <div className="inv-media-badge-low">Low</div>
        )}
        <button
          onClick={(e) => { e?.stopPropagation(); onToggleSelect?.(item); }}
          className={`inv-media-check${isSelected ? ' on' : ''}`}
          title={isSelected ? 'Deselect' : 'Select'}
        >
          {isSelected && <Icon name="Check" size={11} />}
        </button>
        {canEdit && (
          <div className="inv-card-media-bl inv-card-menu">
            <ItemActionsMenu item={item} onEdit={onEdit} onAppearance={(r) => setAppearanceAnchor(r)} onMove={onMove} onClone={onClone} onDelete={onDelete} size={28} />
          </div>
        )}
      </div>
      <button
        className="inv-card-reveal"
        onClick={(e) => { e?.stopPropagation(); setRevealed((v) => !v); }}
        title={revealed ? 'Hide details' : 'Show details'}
        aria-label={revealed ? 'Hide details' : 'Show details'}
        aria-expanded={revealed}
      >
        <Icon name={revealed ? 'ChevronDown' : 'Info'} size={15} />
      </button>
      <div className="inv-card-body">
        {/* Item Name */}
        <p
          className="inv-card-name"
          onClick={() => onQuickView?.(item)}
          title="Quick view"
        >{item?.name}</p>

        {/* Category */}
        {categoryLabel && (
          <div className="inv-card-meta">
            <Icon name="Tag" size={10} />
            <span className="truncate">{categoryLabel}</span>
          </div>
        )}

        {/* Code */}
        {item?.cargoItemId && (
          <div className="inv-card-meta">
            <Icon name="Hash" size={10} />
            <span className="mono truncate">{item?.cargoItemId}</span>
          </div>
        )}

        {/* Expiry Date */}
        {expiryLabel && (
          <div className="inv-card-meta">
            <Icon name="Calendar" size={10} />
            <span>{expiryLabel}</span>
          </div>
        )}

        {/* Quantity control */}
        <div className="inv-card-qty">
          <span className="inv-card-qty-label">Qty</span>
          <div className="flex items-center gap-1.5">
            {!isMultiLocation && isAlcoholItem(item) && (
              <button
                onClick={(e) => { e?.stopPropagation(); setBottleModalLocIdx(-1); }}
                title={item?.partialBottle != null ? `Partial bottle: ${Math.round(item.partialBottle * 100)}% — click to edit` : 'Record partial bottle'}
                style={{
                  width: 26, height: 26,
                  border: item?.partialBottle != null ? '1.5px solid #8B1538' : '1.5px dashed #CBD5E1',
                  background: item?.partialBottle != null ? 'rgba(139,21,56,0.08)' : 'transparent',
                  color: item?.partialBottle != null ? '#8B1538' : '#94A3B8',
                  borderRadius: 7, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <BottleIconSvg size={13} />
              </button>
            )}
            <QuickQtyControl item={item} onUpdate={onUpdate} locationQtys={locationQtys} setLocationQtys={setLocationQtys} showLocations={showLocations} onToggleLocations={() => setShowLocations(v => !v)} variantQtys={variantQtys} showSizes={showSizes} onToggleSizes={() => setShowSizes(v => !v)} />
          </div>
        </div>
        {variantQtys.length > 0 && showSizes && (
          <div className="inv-szgrid" style={{ padding: '8px 0 0' }}>
            {variantQtys.map((r, idx) => (
              singleLoc ? (
                <span key={r.size} className="inv-szchip edit">
                  <span className="s">{r.size}</span>
                  <button onClick={(e) => { e?.stopPropagation(); adjustSize(idx, -1); }} disabled={r.qty <= 0} className="inv-szbtn minus" aria-label={`Less ${r.size}`}><Icon name="Minus" size={9} /></button>
                  <span className="v">{r.qty}</span>
                  <button onClick={(e) => { e?.stopPropagation(); adjustSize(idx, 1); }} className="inv-szbtn plus" aria-label={`More ${r.size}`}><Icon name="Plus" size={9} /></button>
                </span>
              ) : (
                <span key={r.size} className="inv-szchip"><span className="s">{r.size}</span><span className="v">{r.qty}</span></span>
              )
            ))}
            {!singleLoc && <p className="inv-szsplit">Split across locations — edit stock in the item.</p>}
          </div>
        )}
        {isMultiLocation && showLocations && locationQtys?.length > 0 && (
          <div className="inv-locexpand" style={{ padding: '8px 0 0' }}>
            {locationQtys?.map((loc, idx) => {
              const label = getLastLocationSegment(loc) || `Location ${idx + 1}`;
              const hasPartial = loc?.partial != null;
              return (
                <div key={idx} className="inv-locrow">
                  <span className="inv-locname">{label}</span>
                  <div className="flex items-center gap-1">
                    {isAlcoholItem(item) && (
                      <button
                        onClick={(e) => { e?.stopPropagation(); setBottleModalLocIdx(idx); }}
                        title={hasPartial ? `Partial: ${loc.partial.toFixed(2)} — click to edit` : 'Record partial bottle'}
                        style={{
                          width: 20, height: 20, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          borderRadius: 5, cursor: 'pointer', transition: 'all 0.15s',
                          border: hasPartial ? '1.5px solid #8B1538' : '1.5px dashed #CBD5E1',
                          background: hasPartial ? 'rgba(139,21,56,0.08)' : 'transparent',
                          color: hasPartial ? '#8B1538' : '#94A3B8',
                        }}
                      >
                        <BottleIconSvg size={10} />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e?.stopPropagation(); const updated = locationQtys?.map((l, i) => i === idx ? { ...l, qty: Math.max(0, (l?.qty || 0) - 1) } : l); setLocationQtys(updated); pendingLocUpdateRef.current = true; updateItemStockLocations(item?.id, updated); }}
                      disabled={loc?.qty <= 0}
                      className="inv-qtybtn minus" style={{ width: 24, height: 24 }}
                    >
                      <Icon name="Minus" size={10} />
                    </button>
                    <span className="min-w-[28px] text-center text-xs font-semibold text-foreground">
                      {hasPartial ? ((loc?.qty || 0) + loc.partial).toFixed(2).replace(/\.?0+$/, '') : (loc?.qty || 0)}
                    </span>
                    <button
                      onClick={(e) => { e?.stopPropagation(); const updated = locationQtys?.map((l, i) => i === idx ? { ...l, qty: (l?.qty || 0) + 1 } : l); setLocationQtys(updated); pendingLocUpdateRef.current = true; updateItemStockLocations(item?.id, updated); }}
                      className="inv-qtybtn plus" style={{ width: 24, height: 24 }}
                    >
                      <Icon name="Plus" size={10} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
    {appearanceAnchor && (
      <ItemAppearancePopover
        item={item}
        anchorRect={appearanceAnchor}
        onClose={() => setAppearanceAnchor(null)}
        onSave={(updated) => { setItem(updated); onAppearanceChange?.(updated?.id, updated?.icon, updated?.color); }}
      />
    )}
    {bottleModalLocIdx !== null && (
      <PartialBottleModal
        itemName={item?.name}
        initialValue={bottleModalLocIdx >= 0 ? (locationQtys[bottleModalLocIdx]?.partial ?? null) : (item?.partialBottle ?? null)}
        onSave={async (fraction) => {
          const idx = bottleModalLocIdx;
          setBottleModalLocIdx(null);
          if (idx >= 0) {
            const updated = locationQtys?.map((l, i) => {
              if (i !== idx) return l;
              const newQty = l?.partial != null ? (l?.qty || 0) : Math.max(0, (l?.qty || 0) - 1);
              return { ...l, qty: newQty, partial: fraction };
            });
            setLocationQtys(updated);
            updateItemStockLocations(item?.id, updated);
          } else {
            await updatePartialBottle(item?.id, fraction);
            setItem(prev => ({ ...prev, partialBottle: fraction }));
          }
          onUpdate?.();
        }}
        onClear={async () => {
          const idx = bottleModalLocIdx;
          setBottleModalLocIdx(null);
          if (idx >= 0) {
            const updated = locationQtys?.map((l, i) => {
              if (i !== idx) return l;
              const { partial: _p, ...rest } = l;
              return { ...rest, qty: l?.partial != null ? (l?.qty || 0) + 1 : (l?.qty || 0) };
            });
            setLocationQtys(updated);
            updateItemStockLocations(item?.id, updated);
          } else {
            await updatePartialBottle(item?.id, null);
            setItem(prev => ({ ...prev, partialBottle: null }));
          }
          onUpdate?.();
        }}
        onClose={() => setBottleModalLocIdx(null)}
      />
    )}
    </>
  );
};

// ─── Folder actions menu (⋯) — consolidates all tile actions, touch-friendly ────
const FolderActionsMenu = ({ canEdit, showCog, canMove, onOpen, onRename, onAppearance, onMove, onPermissions, onDuplicate, onExport, onArchive, onDelete }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const handleClick = (e) => { if (ref?.current && !ref?.current?.contains(e?.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);
  const row = (iconName, label, fn, opts = {}) => (
    <button
      className={`inv-menuitem${opts?.danger ? ' danger' : ''}`}
      onClick={(e) => { e?.stopPropagation(); setOpen(false); fn?.(); }}
    >
      <Icon name={iconName} size={15} />
      <span>{label}</span>
    </button>
  );
  return (
    <div className="inv-actionsmenu" ref={ref}>
      <button
        className="inv-menutrigger"
        title="Folder actions"
        onClick={(e) => { e?.stopPropagation(); setOpen(o => !o); }}
      >
        <Icon name="MoreHorizontal" size={17} />
      </button>
      {open && (
        <div className="inv-menu" onClick={(e) => e?.stopPropagation()}>
          {onOpen && row('FolderOpen', 'Open', onOpen)}
          {canEdit && onRename && row('Pencil', 'Rename', onRename)}
          {canEdit && onAppearance && row('Palette', 'Icon & colour', onAppearance)}
          {canEdit && canMove && onMove && row('FolderInput', 'Move', onMove)}
          {canEdit && onDuplicate && row('Copy', 'Duplicate', onDuplicate)}
          {onExport && row('Download', 'Export', onExport)}
          {showCog && onPermissions && row('Users', 'Permissions', onPermissions)}
          {((canEdit && showCog && onArchive) || (canEdit && onDelete)) && <div className="inv-menu-sep" />}
          {canEdit && showCog && onArchive && row('Archive', 'Archive', onArchive)}
          {canEdit && onDelete && row('Trash2', 'Delete', onDelete, { danger: true })}
        </div>
      )}
    </div>
  );
};

// ─── Folder Card ───────────────────────────────────────────────────────────────
const FolderCard = ({ name, icon, color, itemCount, subFolderCount, depth, onClick, canEdit, onEdit, onRenameSubmit, onDelete, onCog, onPalette, onMove, onPermissions, onDuplicate, onExport, onArchive, onVisibilityChange, canMove, dragHandleProps, isDragging, isFolderDropTarget, isDropTargetReady, showCog, layout = 'grid' }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef(null);
  useEffect(() => { if (editing) { setDraft(name); setTimeout(() => inputRef?.current?.select(), 0); } }, [editing, name]);

  const startRename = () => setEditing(true);
  const commitRename = () => {
    const next = draft?.trim();
    setEditing(false);
    if (next && next !== name) onRenameSubmit?.(next);
  };
  const cancelRename = () => { setEditing(false); setDraft(name); };

  const gripEl = canEdit && dragHandleProps ? (
    <div
      {...dragHandleProps}
      onClick={(e) => e?.stopPropagation()}
      className="inv-grip"
      title="Drag to reorder or hold over a folder to move inside"
    >
      <Icon name="GripVertical" size={14} />
    </div>
  ) : null;

  const iconEl = (
    <div
      className={color ? 'inv-folder-icon' : 'inv-folder-icon plain'}
      style={color ? { backgroundColor: color + '22', border: `1.5px solid ${color}44` } : undefined}
    >
      <Icon
        name={icon || (depth === 0 ? 'MapPin' : 'FolderOpen')}
        size={20}
        style={color ? { color } : undefined}
      />
    </div>
  );

  const lead = (
    <div className="inv-folder-lead">
      {gripEl}
      {iconEl}
    </div>
  );

  const actions = (
    <div className="inv-folder-actions">
      {isFolderDropTarget && isDropTargetReady && (
        <span className="inv-moveinside">
          <Icon name="FolderInput" size={12} />
          <span>Move inside</span>
        </span>
      )}
      {!isFolderDropTarget && (
        <FolderActionsMenu
          canEdit={canEdit}
          showCog={showCog}
          canMove={canMove}
          onOpen={onClick}
          onRename={startRename}
          onAppearance={onPalette}
          onMove={onMove}
          onPermissions={onPermissions}
          onDuplicate={onDuplicate}
          onExport={onExport}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      )}
    </div>
  );

  const nameEl = editing ? (
    <input
      ref={inputRef}
      className="inv-folder-nameedit"
      value={draft}
      autoFocus
      onClick={(e) => e?.stopPropagation()}
      onChange={(e) => setDraft(e?.target?.value)}
      onKeyDown={(e) => {
        if (e?.key === 'Enter') { e?.preventDefault(); commitRename(); }
        else if (e?.key === 'Escape') { e?.preventDefault(); cancelRename(); }
      }}
      onBlur={commitRename}
    />
  ) : (
    <h3 className="inv-folder-name">{name}</h3>
  );

  const meta = (
    <div className="inv-folder-meta">
      <span>{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
      {subFolderCount > 0 && <span>· {subFolderCount} folder{subFolderCount !== 1 ? 's' : ''}</span>}
    </div>
  );

  const cls = [
    'inv-folder',
    layout === 'list' ? 'row' : 'square',
    isDragging ? 'dragging' : '',
    isFolderDropTarget && isDropTargetReady ? 'droptarget-ready' : isFolderDropTarget ? 'droptarget' : '',
  ]?.join(' ');

  // Whole tile is clickable to open — except while inline-editing the name.
  const handleTileClick = editing ? undefined : onClick;

  if (layout === 'list') {
    return (
      <div onClick={handleTileClick} className={cls}>
        {lead}
        <div className="inv-folder-body">
          {nameEl}
          {meta}
        </div>
        {actions}
      </div>
    );
  }

  // Grid → card tile with the SAME footprint as an item card, so folders and
  // items sit in one grid at identical sizes and the zoom slider scales both.
  const cardCls = [
    'inv-card', 'foldercard',
    isDragging ? 'dragging' : '',
    isFolderDropTarget && isDropTargetReady ? 'droptarget-ready' : isFolderDropTarget ? 'droptarget' : '',
  ]?.join(' ');
  return (
    <div onClick={handleTileClick} className={cardCls}>
      {gripEl}
      {actions}
      <div className="inv-foldercard-inner">
        <div className="inv-foldericon-lg">
          <Icon
            name={icon || (depth === 0 ? 'MapPin' : 'FolderOpen')}
            size={36}
            style={color ? { color } : undefined}
          />
        </div>
        {nameEl}
        {meta}
      </div>
    </div>
  );
};

// ─── Sortable Folder Card Wrapper ─────────────────────────────────────────────
const SortableFolderCard = ({ id, name, icon, color, itemCount, subFolderCount, depth, onClick, canEdit, onEdit, onRenameSubmit, onDelete, onCog, onPalette, onMove, onPermissions, onDuplicate, onExport, onArchive, canMove, showCog, folderDropTargetId, folderDropTargetReady, layout = 'grid' }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS?.Transform?.toString(transform),
    transition,
  };

  const isFolderDropTarget = folderDropTargetId === id;
  const isDropTargetReady = isFolderDropTarget && folderDropTargetReady;

  return (
    <div ref={setNodeRef} style={style}>
      <FolderCard
        name={name}
        icon={icon}
        color={color}
        itemCount={itemCount}
        subFolderCount={subFolderCount}
        depth={depth}
        onClick={onClick}
        canEdit={canEdit}
        onEdit={onEdit}
        onRenameSubmit={onRenameSubmit}
        onDelete={onDelete}
        onCog={onCog}
        onPalette={onPalette}
        onMove={onMove}
        onPermissions={onPermissions}
        onDuplicate={onDuplicate}
        onExport={onExport}
        onArchive={onArchive}
        canMove={canMove}
        showCog={showCog}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        isFolderDropTarget={isFolderDropTarget}
        isDropTargetReady={isDropTargetReady}
        onVisibilityChange={undefined}
        canMove={undefined}
        layout={layout}
      />
    </div>
  );
};

// ─── Sortable Item Card Wrapper (drag an item onto a folder to move it) ───────
const SortableItemCard = ({ item, draggable, ...props }) => {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: `item:${item?.id}`, disabled: !draggable });

  const style = { transform: CSS?.Transform?.toString(transform), transition };
  const dragHandleProps = draggable ? { ...attributes, ...listeners } : undefined;

  return (
    <div ref={setNodeRef} style={style}>
      <ItemGridCard item={item} dragHandleProps={dragHandleProps} isDragging={isDragging} {...props} />
    </div>
  );
};

// ─── Delete Folder Confirmation Modal ────────────────────────────────────────
const DeleteFolderModal = ({ folderName, onClose, onConfirm }) => (
  <ModalShell onClose={onClose} panelClassName="inv-modal">
    <div className="inv-modal-head">
      <div>
        <div className="inv-modal-eyebrow">Delete</div>
        <h2 className="inv-modal-title">Delete folder?</h2>
      </div>
      <button onClick={onClose} className="inv-modal-close"><Icon name="X" size={18} /></button>
    </div>
    <div className="inv-confirm">
      <div className="inv-confirm-icon danger"><Icon name="Trash2" size={18} /></div>
      <div>
        <p className="inv-confirm-title">Removes everything inside</p>
        <p className="inv-confirm-text"><b>{folderName}</b> and all its sub-folders and items will be removed. You'll have a few seconds to undo.</p>
      </div>
    </div>
    <div className="inv-modal-actions">
      <button onClick={onClose} className="inv-btn ghost">Cancel</button>
      <button onClick={onConfirm} className="inv-btn danger">Delete</button>
    </div>
  </ModalShell>
);

// ─── Archive Folder Confirmation Modal ────────────────────────────────────────
const ArchiveFolderModal = ({ folderName, onClose, onConfirm }) => (
  <ModalShell onClose={onClose} panelClassName="inv-modal">
    <div className="inv-modal-head">
      <div>
        <div className="inv-modal-eyebrow">Archive</div>
        <h2 className="inv-modal-title">Archive folder?</h2>
      </div>
      <button onClick={onClose} className="inv-modal-close"><Icon name="X" size={18} /></button>
    </div>
    <div className="inv-confirm">
      <div className="inv-confirm-icon warn"><Icon name="Archive" size={18} /></div>
      <div>
        <p className="inv-confirm-title">Hidden, not deleted</p>
        <p className="inv-confirm-text"><b>{folderName}</b> will be hidden from normal view. All data is preserved and can be restored.</p>
      </div>
    </div>
    <div className="inv-modal-actions">
      <button onClick={onClose} className="inv-btn ghost">Cancel</button>
      <button onClick={onConfirm} className="inv-btn warn">Archive</button>
    </div>
  </ModalShell>
);

// ─── Folder Visibility (Permissions) Modal — editorial ──────────────────────────
const FolderVisibilityModal = ({ folderName, currentVisibility, onClose, onSave }) => {
  const [value, setValue] = useState(currentVisibility || 'everyone');
  return (
    <ModalShell onClose={onClose} panelClassName="inv-modal">
      <div className="inv-modal-head">
        <div>
          <div className="inv-modal-eyebrow">Permissions</div>
          <h2 className="inv-modal-title">Who can see {folderName}?</h2>
        </div>
        <button onClick={onClose} className="inv-modal-close"><Icon name="X" size={18} /></button>
      </div>
      <div className="inv-radio-list">
        {VISIBILITY_OPTIONS?.map(opt => (
          <button
            key={opt?.value}
            className={`inv-radio${value === opt?.value ? ' on' : ''}`}
            onClick={() => setValue(opt?.value)}
          >
            <span className="inv-radio-dot" />
            <span>{opt?.label}</span>
          </button>
        ))}
      </div>
      <div className="inv-modal-actions">
        <button onClick={onClose} className="inv-btn ghost">Cancel</button>
        <button onClick={() => onSave(value)} className="inv-btn primary">Save</button>
      </div>
    </ModalShell>
  );
};

// ─── Health Summary ────────────────────────────────────────────────────────────
const HealthSummary = ({ items }) => {
  const lowStock = items?.filter(i => i?.restockEnabled && i?.restockLevel !== null && (i?.quantity ?? i?.totalQty ?? 0) <= i?.restockLevel);
  if (!items?.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-2xl font-bold text-foreground">{items?.length}</p>
        <p className="text-xs text-muted-foreground mt-0.5">Total Items</p>
      </div>
      <div className={`bg-card rounded-xl border p-4 ${lowStock?.length > 0 ? 'border-red-200 bg-red-50' : 'border-border'}`}>
        <p className={`text-2xl font-bold ${lowStock?.length > 0 ? 'text-red-600' : 'text-foreground'}`}>{lowStock?.length}</p>
        <p className="text-xs text-muted-foreground mt-0.5">Low Stock</p>
      </div>
    </div>
  );
};

// ─── Path encoding helpers defined at top of file ─────────────────────────────

const segmentsToUrl = (segments) =>
  '/inventory/location/' + segments?.map(encodeSegment)?.join('/');

const segmentsToStorageFields = (segments) => ({
  location: segments?.[0] || null,
  subLocation: segments?.length > 1 ? segments?.slice(1)?.join(' > ') : null,
});

// Drag ids: folders use their bare name, items use an `item:<id>` prefix.
const isItemDragId = (id) => typeof id === 'string' && id?.startsWith('item:');

// ─── Filter Panel ─────────────────────────────────────────────────────────────
const FilterPanel = ({ items, filters, onChange, onClose }) => {
  const availableTags = [...new Set(items?.flatMap(i => i?.tags || []))];
  const availableBrands = [...new Set(items?.map(i => i?.brand)?.filter(Boolean))];
  const availableSuppliers = [...new Set(items?.map(i => i?.supplier)?.filter(Boolean))];
  const availableLocations = [...new Set(items?.map(i => i?.vessel_location || i?.location_detail)?.filter(Boolean))];

  const toggle = (key, value) => {
    onChange({ ...filters, [key]: value });
  };

  const toggleTag = (tag) => {
    const current = filters?.tags || [];
    const next = current?.includes(tag) ? current?.filter(t => t !== tag) : [...current, tag];
    onChange({ ...filters, tags: next });
  };

  return (
    <div className="absolute top-full left-0 mt-2 w-80 bg-card border border-border rounded-2xl shadow-xl z-40 p-4 space-y-4 max-h-[80vh] overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Filters</h3>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
          <Icon name="X" size={16} />
        </button>
      </div>

      {availableTags?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {availableTags?.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-all ${
                  filters?.tags?.includes(tag)
                    ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {availableBrands?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Brand</p>
          <div className="flex flex-wrap gap-1.5">
            {availableBrands?.map(brand => (
              <button
                key={brand}
                onClick={() => toggle('brand', filters?.brand === brand ? null : brand)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-all ${
                  filters?.brand === brand
                    ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                }`}
              >
                {brand}
              </button>
            ))}
          </div>
        </div>
      )}

      {availableSuppliers?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Supplier</p>
          <div className="flex flex-wrap gap-1.5">
            {availableSuppliers?.map(supplier => (
              <button
                key={supplier}
                onClick={() => toggle('supplier', filters?.supplier === supplier ? null : supplier)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-all ${
                  filters?.supplier === supplier
                    ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                }`}
              >
                {supplier}
              </button>
            ))}
          </div>
        </div>
      )}

      {availableLocations?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Location</p>
          <div className="flex flex-wrap gap-1.5">
            {availableLocations?.map(loc => (
              <button
                key={loc}
                onClick={() => toggle('location', filters?.location === loc ? null : loc)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-all ${
                  filters?.location === loc
                    ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                }`}
              >
                {loc}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick Filters</p>
        {[
          { key: 'belowPar', label: 'Below Par', icon: 'TrendingDown' },
          { key: 'hasExpiry', label: 'Has Expiry Date', icon: 'Calendar' },
          { key: 'hasImage', label: 'Has Image', icon: 'Image' },
        ]?.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => toggle(key, !filters?.[key])}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-sm transition-all ${
              filters?.[key]
                ? 'bg-primary/10 border-primary/40 text-primary' :'bg-background border-border text-foreground hover:border-primary/30'
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon name={icon} size={14} className={filters?.[key] ? 'text-primary' : 'text-muted-foreground'} />
              {label}
            </div>
            {filters?.[key] && <Icon name="Check" size={14} className="text-primary" />}
          </button>
        ))}
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Expiring Soon</p>
        <div className="flex gap-2">
          {[7, 14, 30]?.map(days => (
            <button
              key={days}
              onClick={() => toggle('expiringSoon', filters?.expiringSoon === days ? null : days)}
              className={`flex-1 py-1.5 text-xs rounded-xl border transition-all ${
                filters?.expiringSoon === days
                  ? 'bg-amber-500 text-white border-amber-500' :'bg-background text-muted-foreground border-border hover:border-amber-400 hover:text-amber-600'
              }`}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Year (Wine)</p>
        <input
          type="number"
          placeholder="e.g. 2019"
          value={filters?.year || ''}
          onChange={(e) => toggle('year', e?.target?.value || null)}
          className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
          min="1900"
          max="2099"
        />
      </div>

      <button
        onClick={() => onChange({ tags: [] })}
        className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        Clear all filters
      </button>
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────────────────────────
const LocationFirstInventory = () => {
  const { '*': wildcard } = useParams();
  const navigate = useNavigate();
  const { session, loading: authLoading, currentUser: authCurrentUser, bootstrapComplete, tenantRole,
    isCommand: ctxIsCommand, isChief: ctxIsChief, isHOD: ctxIsHOD, activeTenantId: ctxActiveTenantId } = useAuth();

  const pathSegments = wildcard
    ? wildcard?.split('/')?.map(s => decodeSegment(s)?.trim())?.filter(Boolean)
    : [];

  const isRoot = pathSegments?.length === 0;
  const currentFolderName = pathSegments?.length > 0 ? pathSegments?.[pathSegments?.length - 1] : null;
  const parentSegments = pathSegments?.slice(0, -1);

  const [allItems, setAllItems] = useState([]);
  const [subFolders, setSubFolders] = useState([]);
  const [items, setItems] = useState([]);
  const [itemCounts, setItemCounts] = useState({});
  const [pageLoading, setPageLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showAddFolderModal, setShowAddFolderModal] = useState(false);
  const [editingFolderName, setEditingFolderName] = useState(null);
  const [deletingFolderName, setDeletingFolderName] = useState(null);
  const [archivingFolderName, setArchivingFolderName] = useState(null);
  const [quickViewItem, setQuickViewItem] = useState(null);
  const [cogFolderName, setCogFolderName] = useState(null);
  const [folderVisibilities, setFolderVisibilities] = useState({});
  const [folderTree, setFolderTree] = useState({});
  const [activeDragId, setActiveDragId] = useState(null);
  const [movingFolderName, setMovingFolderName] = useState(null);
  const [appearanceFolderName, setAppearanceFolderName] = useState(null);
  const [permsFolderName, setPermsFolderName] = useState(null);
  const [duplicatingFolder, setDuplicatingFolder] = useState(null);
  const [movingItem, setMovingItem] = useState(null);
  const [deletingItem, setDeletingItem] = useState(null);
  const [undoToast, setUndoToast] = useState(null); // { name, trashId }
  const undoTimerRef = useRef(null);
  const [showTrash, setShowTrash] = useState(false);
  const [trashItems, setTrashItems] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);

  const [selectedItemIds, setSelectedItemIds] = useState(new Set());
  const [showExportModal, setShowExportModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showAzureImportModal, setShowAzureImportModal] = useState(false);
  const [showBulkMoveModal, setShowBulkMoveModal] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);

  const [sortBy, setSortBy] = useState('name_asc');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [activeFilters, setActiveFilters] = useState({ tags: [] });
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('cargo_inventory_view_mode') || 'list'; } catch { return 'list'; }
  });
  // Whether the folder's "Items" section is collapsed. null = use the default
  // (collapsed when the folder also holds sub-folders, so folders lead the view).
  const [itemsCollapsedOverride, setItemsCollapsedOverride] = useState(null);
  // Grid tile size (min column width in px) — user-adjustable zoom. 160=small, 360=large.
  const [tileZoom, setTileZoom] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem('cargo_inventory_tile_zoom'), 10);
      return (v >= 160 && v <= 360) ? v : 300;
    } catch { return 300; }
  });
  const sortDropdownRef = useRef(null);
  const filterPanelRef = useRef(null);

  const [folderDropTargetId, setFolderDropTargetId] = useState(null);
  const [folderDropTargetReady, setFolderDropTargetReady] = useState(false);
  const folderHoverTimerRef = useRef(null);
  const folderHoverIdRef = useRef(null);
  const [isMovingFolder, setIsMovingFolder] = useState(false);

  const [showDevPanel, setShowDevPanel] = useState(false);
  const devMode = isDevMode();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    try { localStorage.setItem('cargo_inventory_view_mode', viewMode); } catch {}
  }, [viewMode]);

  useEffect(() => {
    try { localStorage.setItem('cargo_inventory_tile_zoom', String(tileZoom)); } catch {}
  }, [tileZoom]);

  useEffect(() => {
    const handleClick = (e) => {
      if (sortDropdownRef?.current && !sortDropdownRef?.current?.contains(e?.target)) setShowSortDropdown(false);
      if (filterPanelRef?.current && !filterPanelRef?.current?.contains(e?.target)) setShowFilterPanel(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const currentUser = authCurrentUser || getCurrentUser();
  const canEdit = !!(session);

  const profileReady = bootstrapComplete && !!(
    (currentUser?.permission_tier ||
    currentUser?.permissionTier ||
    currentUser?.effectiveTier ||
    currentUser?.tier || tenantRole)
  );

  const isCommand = ctxIsCommand || (bootstrapComplete && (tenantRole?.toUpperCase() === 'COMMAND'));
  const isChief   = !isCommand && (ctxIsChief || (bootstrapComplete && (tenantRole?.toUpperCase() === 'CHIEF')));
  const isHOD     = !isCommand && !isChief && (ctxIsHOD || (bootstrapComplete && (tenantRole?.toUpperCase() === 'HOD')));
  const userDepartment = currentUser?.department || '';

  // Managing items (edit / move / duplicate / delete) is for Command, Chief and
  // HOD only — crew get a read-only item list. Server RLS enforces the same.
  const canManageItems = isCommand || isChief || isHOD;
  // Trash (recovery) is Command + Chief only — HODs ask their Chief to restore.
  const canUseTrash = isCommand || isChief;

  console.log('[Inventory] Permission debug:', {
    bootstrapComplete,
    profileReady,
    tenantRole,
    'currentUser.role': currentUser?.role,
    'currentUser.roleTitle': currentUser?.roleTitle,
    'currentUser.department': currentUser?.department,
    'currentUser.permission_tier': currentUser?.permission_tier,
    'currentUser.permissionTier': currentUser?.permissionTier,
    'currentUser.effectiveTier': currentUser?.effectiveTier,
    'currentUser.tier': currentUser?.tier,
    ctxIsCommand,
    ctxIsChief,
    ctxIsHOD,
    isCommand,
    isChief,
    isHOD,
  });

  const shouldShowCog = (folderName) => {
    if (!canEdit) return false;
    if (isCommand) return true;
    if (isRoot) {
      return folderName?.toUpperCase() !== userDepartment?.toUpperCase() &&
        folderName?.toLowerCase() !== userDepartment?.toLowerCase();
    }
    return false;
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e?.key === 'Escape' && activeDragId) {
        clearFolderHoverTimer();
        setActiveDragId(null);
        setFolderDropTargetId(null);
        setFolderDropTargetReady(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeDragId]);

  const clearFolderHoverTimer = () => {
    if (folderHoverTimerRef?.current) {
      clearTimeout(folderHoverTimerRef?.current);
      folderHoverTimerRef.current = null;
    }
    folderHoverIdRef.current = null;
  };

  useEffect(() => {
    const runMigration = async () => {
      let attempts = 0;
      const tryMigrate = async () => {
        let tenantId = localStorage.getItem('cargo_active_tenant_id');
        if (tenantId) {
          await migrateLocalStorageFolderTree();
        } else if (attempts < 10) {
          attempts++;
          setTimeout(tryMigrate, 500);
        }
      };
      await tryMigrate();
    };
    runMigration();
  }, []);

  const loadFolderVisibilities = useCallback(async (folderNames, location) => {
    try {
      let tenantId = localStorage.getItem('cargo_active_tenant_id') || ctxActiveTenantId;
      if (!tenantId || !folderNames?.length) return;
      let query = supabase
        ?.from('inventory_locations')
        ?.select('location, sub_location, visibility')
        ?.eq('tenant_id', tenantId)
        ?.eq('is_archived', false);
      if (!location) {
        query = query?.is('sub_location', null);
      } else {
        query = query?.ilike('location', location);
      }
      const { data } = await query;
      const map = {};
      (data || [])?.forEach(row => {
        const key = row?.sub_location ? row?.sub_location?.split(' > ')?.pop() : row?.location;
        map[key] = row?.visibility || 'everyone';
      });
      setFolderVisibilities(map);
    } catch (err) {
      console.error('[LocationFirstInventory] loadFolderVisibilities error:', err?.message);
    }
  }, [ctxActiveTenantId]);

  // Helper: fetch tenant ID directly from Supabase as last resort
  const fetchTenantIdFallback = async () => {
    try {
      const { data: sessionData } = await supabase?.auth?.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) return null;
      const { data: memberships } = await supabase
        ?.from('tenant_members')
        ?.select('tenant_id')
        ?.eq('user_id', userId)
        ?.eq('active', true)
        ?.order('joined_at', { ascending: false })
        ?.limit(1);
      let tenantId = memberships?.[0]?.tenant_id || null;
      if (tenantId) {
        localStorage.setItem('cargo_active_tenant_id', tenantId);
      }
      return tenantId;
    } catch {
      return null;
    }
  };

  const loadData = useCallback(async () => {
    setPageLoading(true);
    try {
      if (isRoot) {
        let tenantId = localStorage.getItem('cargo_active_tenant_id') || ctxActiveTenantId;
        if (!tenantId) {
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 300));
            tenantId = localStorage.getItem('cargo_active_tenant_id') || ctxActiveTenantId;
            if (tenantId) break;
          }
        }
        // Last resort: fetch directly from Supabase
        if (!tenantId) {
          tenantId = await fetchTenantIdFallback();
        }

        // If tenantId came from context fallback, sync it to localStorage
        // so downstream storage functions (which read from localStorage) work correctly
        if (tenantId && !localStorage.getItem('cargo_active_tenant_id')) {
          localStorage.setItem('cargo_active_tenant_id', tenantId);
        }

        if (tenantId) {
          const { data: sessionData } = await supabase?.auth?.getSession();
          const userId = sessionData?.session?.user?.id || null;

          if (userId) {
            let departmentsToEnsure = null;
            try {
              const { data: allDeptData, error: allDeptErr } = await supabase?.rpc('get_all_departments');
              if (!allDeptErr && allDeptData?.length > 0) {
                departmentsToEnsure = allDeptData;
              }
            } catch (_) {}

            if (!departmentsToEnsure) {
              try {
                const { data: deptData, error: deptErr } = await supabase
                  ?.from('departments')
                  ?.select('id, name')
                  ?.order('name', { ascending: true });
                if (!deptErr && deptData?.length > 0) {
                  departmentsToEnsure = deptData;
                }
              } catch (_) {}
            }

            if (!departmentsToEnsure) {
              try {
                const { data: directDepts, error: directErr } = await supabase
                  ?.from('departments')
                  ?.select('id, name')
                  ?.order('name', { ascending: true });
                if (!directErr && directDepts?.length > 0) {
                  departmentsToEnsure = directDepts;
                }
              } catch (_) {}
            }

            if (!departmentsToEnsure) {
              console.warn('[LocationFirstInventory] All department sources failed — using DEPARTMENTS fallback');
              departmentsToEnsure = DEPARTMENTS?.map((name, idx) => ({ id: `fallback-${idx}`, name }));
            }

            await ensureDepartmentFolders(departmentsToEnsure);
          } else {
            const fallbackDepts = DEPARTMENTS?.map((name, idx) => ({ id: `fallback-${idx}`, name }));
            await ensureDepartmentFolders(fallbackDepts);
          }
        }
      }

      const tree = await getFolderTree();
      setFolderTree(tree);

      if (isRoot) {
        const [, all] = await Promise.all([
          getItemCountByLocation(),
          getAllItems(),
        ]);
        let rootFolders = getRootLocationsFromTree(tree);

        if (rootFolders?.length === 0) {
          try {
            const { data: deptData, error: deptErr } = await supabase
              ?.from('departments')
              ?.select('name')
              ?.order('name', { ascending: true });
            if (!deptErr && deptData?.length > 0) {
              rootFolders = deptData?.map(d => d?.name)?.filter(Boolean);
              console.warn('[LocationFirstInventory] inventory_locations empty — rendering from public.departments directly:', rootFolders);
            }
          } catch (_) {}
        }

        if (rootFolders?.length === 0) {
          rootFolders = DEPARTMENTS?.slice();
          console.warn('[LocationFirstInventory] public.departments also empty — using hardcoded DEPARTMENTS fallback');
        }

        if (!isCommand) {
          if (isChief) {
            // Chief sees all folders
          } else if (isHOD) {
            rootFolders = rootFolders?.filter(f =>
              f?.toUpperCase() === userDepartment?.toUpperCase() ||
              f?.toLowerCase() === userDepartment?.toLowerCase()
            );
          } else {
            rootFolders = rootFolders?.filter(f =>
              f?.toUpperCase() === userDepartment?.toUpperCase() ||
              f?.toLowerCase() === userDepartment?.toLowerCase()
            );
          }
        }

        // Ensure any location present in actual items is surfaced as a root folder,
        // even if it's missing from inventory_locations (e.g. "Medical" not in DEPARTMENTS).
        // This guarantees items are always reachable regardless of folder-tree state.
        const rootFolderNamesLower = new Set(rootFolders?.map(f => f?.toLowerCase()));
        const extraFolders = [];
        (all || [])?.forEach(item => {
          if (item?.location && !rootFolderNamesLower?.has(item?.location?.toLowerCase())) {
            extraFolders?.push(item?.location);
            rootFolderNamesLower?.add(item?.location?.toLowerCase());
          }
        });
        if (extraFolders?.length > 0) {
          rootFolders = [...rootFolders, ...extraFolders];
        }

        // Build case-insensitive count map keyed by lowercase location name.
        // Counting directly from allItems avoids any case-mismatch between
        // inventory_items.location and inventory_locations.location.
        const normCounts = {};
        (all || [])?.forEach(item => {
          if (item?.location) {
            const key = item?.location?.toLowerCase();
            normCounts[key] = (normCounts?.[key] || 0) + 1;
          }
        });
        // Build final counts keyed by the actual folder name (preserving original case)
        const totalCounts = {};
        rootFolders?.forEach(folderName => {
          const key = folderName?.toLowerCase();
          totalCounts[folderName] = normCounts?.[key] || 0;
        });

        setSubFolders(rootFolders);
        setItemCounts(totalCounts);
        setAllItems(all);
        await loadFolderVisibilities(rootFolders, null);

        try {
          const allForExport = await getAllItems();
          setAllItems(allForExport || []);
        } catch (_) { /* non-critical */ }
      } else {
        const { location, subLocation } = segmentsToStorageFields(pathSegments);
        // Wait for tenantId to be available (mirrors root branch retry loop)
        let tenantId = localStorage.getItem('cargo_active_tenant_id') || ctxActiveTenantId;
        if (!tenantId) {
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 300));
            tenantId = localStorage.getItem('cargo_active_tenant_id') || ctxActiveTenantId;
            if (tenantId) break;
          }
        }
        // Last resort: fetch directly from Supabase
        if (!tenantId) {
          tenantId = await fetchTenantIdFallback();
        }
        if (!tenantId) { setPageLoading(false); return; }

        // If tenantId came from context fallback, sync it to localStorage
        // so downstream storage functions (which read from localStorage) work correctly
        if (tenantId && !localStorage.getItem('cargo_active_tenant_id')) {
          localStorage.setItem('cargo_active_tenant_id', tenantId);
        }

        const allLocationItems = await getItemsByLocation(location);

        let locationItems;
        if (!subLocation) {
          locationItems = (allLocationItems || [])?.filter(item => !item?.subLocation);
        } else {
          const subLocationLower = subLocation?.trim()?.toLowerCase();
          const subLocationPrefix = subLocationLower + ' > ';

          // Exact match first
          const exactMatches = (allLocationItems || [])?.filter(
            item => (item?.subLocation || '')?.trim()?.toLowerCase() === subLocationLower
          );

          // Prefix match: items stored deeper under this path (e.g. "MSOS > Tender 2 > Dressings / Splints")
          const prefixMatches = (allLocationItems || [])?.filter(
            item => (item?.subLocation || '')?.trim()?.toLowerCase()?.startsWith(subLocationPrefix)
          );

          if (exactMatches?.length > 0 || prefixMatches?.length > 0) {
            locationItems = [...exactMatches, ...prefixMatches];
          } else {
            const targetSegments = subLocation?.trim()?.split(' > ') || [];
            let fallbackMatches = [];
            for (let n = targetSegments?.length; n >= 1; n--) {
              const suffix = targetSegments?.slice(targetSegments?.length - n)?.join(' > ');
              const suffixLower = suffix?.toLowerCase();
              const suffixPrefix = suffixLower + ' > ';
              fallbackMatches = (allLocationItems || [])?.filter(item => {
                const itemSub = (item?.subLocation || '')?.trim();
                const itemSubLower = itemSub?.toLowerCase();
                return (
                  itemSub === suffix ||
                  itemSubLower === suffixLower ||
                  itemSubLower?.endsWith(' > ' + suffixLower) ||
                  itemSubLower?.startsWith(suffixLower + ' > ') ||
                  itemSubLower?.startsWith(suffixPrefix)
                );
              });
              if (fallbackMatches?.length > 0) break;
            }

            // Last resort: direct DB query using ilike on sub_location
            if (fallbackMatches?.length === 0) {
              try {
                const directItems = await getItemsByLocation(location, subLocation?.trim());
                if (directItems && directItems?.length > 0) {
                  fallbackMatches = directItems;
                }
              } catch (_) { /* non-critical */ }
            }

            locationItems = fallbackMatches;
          }
        }
        setItems(locationItems);

        let dbSubs = [];
        const currentSubPath = pathSegments?.slice(1)?.join(' > ');
        if (tenantId) {
          let locQuery = supabase
            ?.from('inventory_locations')
            ?.select('sub_location')
            ?.eq('tenant_id', tenantId)
            ?.ilike('location', location)
            ?.eq('is_archived', false);
          if (pathSegments?.length === 1) {
            locQuery = locQuery?.not('sub_location', 'is', null);
          } else {
            locQuery = locQuery?.ilike('sub_location', `${currentSubPath} > %`);
          }
          const { data: locRows } = await locQuery;
          const childNames = new Set();
          (locRows || [])?.forEach(r => {
            if (!r?.sub_location) return;
            if (pathSegments?.length === 1) {
              if (!r?.sub_location?.includes(' > ')) {
                childNames?.add(r?.sub_location);
              }
            } else {
              const prefix = currentSubPath ? currentSubPath + ' > ' : '';
              const prefixLower = prefix?.toLowerCase();
              const subLoc = r?.sub_location || '';
              // Use case-insensitive prefix stripping
              const subLocLower = subLoc?.toLowerCase();
              let remainder = null;
              if (subLocLower?.startsWith(prefixLower)) {
                remainder = subLoc?.slice(prefix?.length);
              }
              if (remainder && !remainder?.includes(' > ')) {
                childNames?.add(remainder);
              }
            }
          });
          dbSubs = [...childNames];
        }

        // Also discover sub-folders directly from items in case inventory_locations is incomplete
        const itemDerivedSubs = new Set();
        (allLocationItems || [])?.forEach(item => {
          const itemSub = (item?.subLocation || '')?.trim();
          if (!itemSub) return;
          // Determine the immediate child name at this path level
          const prefix = currentSubPath ? currentSubPath + ' > ' : '';
          const prefixLower = prefix?.toLowerCase();
          const itemSubLower = itemSub?.toLowerCase();
          if (prefix && !itemSubLower?.startsWith(prefixLower)) return;
          let remainder = prefix ? itemSub?.slice(prefix?.length) : itemSub;
          if (!remainder) return;
          const firstSegment = remainder?.split(' > ')?.[0];
          if (firstSegment) itemDerivedSubs?.add(firstSegment);
        });
        // Merge item-derived subs into dbSubs
        itemDerivedSubs?.forEach(s => {
          if (!dbSubs?.some(d => d?.toLowerCase() === s?.toLowerCase())) {
            dbSubs?.push(s);
          }
        });

        const merged = getMergedSubFoldersFromTree(tree, pathSegments, dbSubs);

        const subCounts = {};
        (allLocationItems || [])?.forEach(item => {
          const itemSubLoc = item?.subLocation || '';
          merged?.forEach(childName => {
            const childSubPath = currentSubPath ? `${currentSubPath} > ${childName}` : childName;
            const isMatch = itemSubLoc === childSubPath || itemSubLoc?.startsWith(childSubPath + ' > ') ||
              itemSubLoc?.toLowerCase() === childSubPath?.toLowerCase() ||
              itemSubLoc?.toLowerCase()?.startsWith(childSubPath?.toLowerCase() + ' > ');
            if (isMatch) {
              subCounts[childName] = (subCounts?.[childName] || 0) + 1;
            }
          });
        });

        setSubFolders(merged);
        setItemCounts(subCounts);
        await loadFolderVisibilities(merged, location);

        try {
          const allForExport = await getAllItems();
          setAllItems(allForExport || []);
        } catch (_) { /* non-critical */ }
      }
    } catch (err) {
      console.error('[LocationFirstInventory] loadData error:', err);
    } finally {
      setPageLoading(false);
    }
  }, [pathSegments?.join('/'), isRoot, isCommand, isChief, isHOD, userDepartment, ctxActiveTenantId, bootstrapComplete]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    setSearchQuery('');
    setActiveTagFilter(null);
    setActiveFilters({ tags: [] });
    setSortBy('name_asc');
    setItemsCollapsedOverride(null);
  }, [pathSegments?.join('/')]);

  const handleBack = () => {
    if (pathSegments?.length === 0) return;
    if (pathSegments?.length === 1) navigate('/inventory');
    else navigate(segmentsToUrl(pathSegments?.slice(0, -1)));
  };

  const handleDeleteItem = async (item) => {
    if (!window.confirm(`Delete "${item?.name}"?`)) return;
    await deleteItem(item?.id);
    loadData();
  };

  const showUndoToast = (name, trashId) => {
    if (!trashId) return;
    if (undoTimerRef?.current) clearTimeout(undoTimerRef.current);
    setUndoToast({ name, trashId });
    undoTimerRef.current = setTimeout(() => setUndoToast(null), 9000);
  };

  const handleConfirmDeleteItem = async () => {
    const item = deletingItem;
    setDeletingItem(null);
    if (!item) return;
    const trashId = await moveItemToTrash(item?.id);
    await loadData();
    showUndoToast(item?.name, trashId);
  };

  // Duplicate a single item in place — fresh id + Cargo ID, name + " (copy)".
  const handleCloneItem = async (item) => {
    const { id, cargoItemId, ...rest } = item || {};
    await saveItem({ ...rest, name: `${item?.name || 'Item'} (copy)` });
    loadData();
  };

  const handleMoveItem = async (destinationSegments) => {
    const item = movingItem;
    if (!item) return;
    const { location, subLocation } = segmentsToStorageFields(destinationSegments);
    await bulkMoveItemsByIds([item?.id], location, subLocation);
    setMovingItem(null);
    loadData();
  };

  const handleModalClose = () => {
    setShowAddModal(false);
    setEditingItem(null);
    loadData();
  };

  const handleItemSaved = () => {
    markTutorialStep(session?.user?.id, 'inventory_done').catch(() => {});
    handleModalClose();
  };

  const handleAddFolder = async ({ name, icon, color }) => {
    await createFolder(pathSegments, name, icon, color);
    setShowAddFolderModal(false);
    loadData();
  };

  const handleRenameFolder = async (newName) => {
    await renameFolderInDB(pathSegments, editingFolderName, newName);
    setEditingFolderName(null);
    loadData();
  };

  // Who may delete a folder: department (root) folders → Command only;
  // sub-folders → Command, or the Chief/HOD of that department.
  const canDeleteFolder = (folderName) => {
    if (isRoot) return isCommand;
    if (isCommand) return true;
    if (isChief || isHOD) return (pathSegments?.[0] || '')?.toLowerCase() === (userDepartment || '')?.toLowerCase();
    return false;
  };

  const handleDeleteFolder = async () => {
    const folderToDelete = deletingFolderName;
    const deletePath = pathSegments;
    setDeletingFolderName(null);
    // Move to the recoverable Trash (snapshot + physical delete).
    const trashId = await moveFolderToTrash(deletePath, folderToDelete, deletePath?.join(' › ') || 'Inventory');
    if (!trashId) {
      console.error('[Inventory] handleDeleteFolder: moveFolderToTrash failed for', folderToDelete, 'at path', deletePath);
      alert(`Failed to delete "${folderToDelete}". Please check your connection and try again.`);
      await loadData();
      return;
    }
    await loadData();
    // Offer an instant undo for ~9s; it also stays in Trash for 30 days.
    if (undoTimerRef?.current) clearTimeout(undoTimerRef.current);
    setUndoToast({ name: folderToDelete, trashId });
    undoTimerRef.current = setTimeout(() => setUndoToast(null), 9000);
  };

  const handleUndoDelete = async () => {
    if (undoTimerRef?.current) clearTimeout(undoTimerRef.current);
    const toast = undoToast;
    setUndoToast(null);
    if (!toast?.trashId) return;
    await restoreFromTrash(toast.trashId);
    await loadData();
  };

  // ── Trash (recently deleted) ──────────────────────────────────────────────
  const openTrash = async () => {
    setShowTrash(true);
    setTrashLoading(true);
    setTrashItems(await listTrash());
    setTrashLoading(false);
  };
  const handleRestoreTrash = async (id) => {
    await restoreFromTrash(id);
    setTrashItems(prev => prev?.filter(t => t?.id !== id));
    await loadData();
  };
  const handlePurgeTrash = async (id) => {
    await purgeTrashRecord(id);
    setTrashItems(prev => prev?.filter(t => t?.id !== id));
  };
  const handleEmptyTrash = async () => {
    await emptyTrash();
    setTrashItems([]);
  };

  const handleArchiveFolder = async () => {
    await archiveFolder(pathSegments, archivingFolderName);
    setArchivingFolderName(null);
    loadData();
  };

  const handleMoveFolder = async (draggedSegments, targetSegments, draggedName) => {
    const success = await moveFolderInDB(draggedSegments, targetSegments, draggedName);
    if (success) {
      setMovingFolderName(null);
      await loadData();
    }
  };

  const handleVisibilityChange = async (folderName, visibility) => {
    await updateFolderVisibility(pathSegments, folderName, visibility);
    setFolderVisibilities(prev => ({ ...prev, [folderName]: visibility }));
  };

  const handleInlineRename = async (folderName, newName) => {
    const ok = await renameFolderInDB(pathSegments, folderName, newName);
    if (ok !== false) await loadData();
  };

  const handleDuplicateFolder = async (folderName) => {
    setDuplicatingFolder(folderName);
    try {
      const copyName = await duplicateFolder(pathSegments, folderName);
      if (copyName) await loadData();
    } finally {
      setDuplicatingFolder(null);
    }
  };

  // One-click export of a folder's whole subtree as a grouped PDF —
  // each sub-folder becomes a heading and drills down into its items.
  const handleExportFolder = async (folderSegments) => {
    setIsExporting(true);
    try {
      const loc = folderSegments?.[0];
      const subPath = folderSegments?.slice(1)?.join(' > ');
      const inSubtree = (it) => {
        if (it?.location !== loc) return false;
        if (!subPath) return true;
        const s = it?.subLocation || '';
        return s === subPath || s?.startsWith(subPath + ' > ');
      };
      const subtree = (allItems || [])?.filter(inSubtree);
      const groups = new Map();
      subtree?.forEach(it => {
        const parts = [it?.location, ...((it?.subLocation || '')?.split(' > ')?.filter(Boolean))];
        const full = parts?.join(' › ');
        if (!groups?.has(full)) groups?.set(full, { key: full, label: full, fullPath: full, items: [] });
        groups?.get(full)?.items?.push(it);
      });
      const foldersMeta = [...groups.values()]?.sort((a, b) => (a?.fullPath || '')?.localeCompare(b?.fullPath || ''));
      await exportInventoryToPDF({
        items: subtree,
        scope: 'selected',
        folderPath: folderSegments?.join(' › '),
        includeImages: false,
        selectedFoldersMeta: foldersMeta,
      });
    } catch (err) {
      console.error('[Export folder] error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveAppearance = async ({ icon, color }) => {
    if (!appearanceFolderName) return;
    await updateFolderAppearance(pathSegments, appearanceFolderName, icon, color);
    setAppearanceFolderName(null);
    loadData();
  };

  const handleItemAppearanceChange = useCallback((itemId, icon, color) => {
    setItems(prev => prev?.map(i => i?.id === itemId ? { ...i, icon, color } : i));
  }, []);

  const filteredItems = (() => {
    // On the root page there is no folder's item list; instead, search / filter
    // look across ALL inventory (a "find anything" launchpad). Only surface
    // results once a search or filter is active — otherwise root shows folders only.
    const anyRootFilter = !!searchQuery || !!activeTagFilter || (activeFilters && (
      (activeFilters?.tags?.length > 0) || activeFilters?.brand || activeFilters?.supplier ||
      activeFilters?.belowPar || activeFilters?.hasExpiry || activeFilters?.hasImage || activeFilters?.location));
    const baseList = isRoot ? (anyRootFilter ? (allItems || []) : []) : items;
    let result = baseList?.filter(item => {
      if (searchQuery) {
        const q = searchQuery?.toLowerCase();
        const matchesName = item?.name?.toLowerCase()?.includes(q);
        const matchesBrand = item?.brand?.toLowerCase()?.includes(q);
        const matchesTags = item?.tags?.some(t => t?.toLowerCase()?.includes(q));
        const matchesSupplier = item?.supplier?.toLowerCase()?.includes(q);
        const matchesBarcode = item?.barcode?.toLowerCase()?.includes(q);
        const matchesNotes = item?.notes?.toLowerCase()?.includes(q);
        if (!matchesName && !matchesBrand && !matchesTags && !matchesSupplier && !matchesBarcode && !matchesNotes) return false;
      }
      if (activeTagFilter && !item?.tags?.includes(activeTagFilter)) return false;
      if (activeFilters?.tags?.length > 0) {
        if (!activeFilters?.tags?.some(t => item?.tags?.includes(t))) return false;
      }
      if (activeFilters?.brand) {
        const matchesBrand = item?.brand?.toLowerCase()?.includes(activeFilters?.brand?.toLowerCase());
        if (!matchesBrand) return false;
      }
      if (activeFilters?.supplier) {
        const matchesSupplier = item?.supplier?.toLowerCase()?.includes(activeFilters?.supplier?.toLowerCase());
        if (!matchesSupplier) return false;
      }
      if (activeFilters?.belowPar) {
        const isBelowPar = item?.restockEnabled && item?.restockLevel !== null && (item?.quantity ?? item?.totalQty ?? 0) <= item?.restockLevel;
        if (!isBelowPar) return false;
      }
      if (activeFilters?.hasExpiry) {
        const hasExpiry = item?.expiry_date && !item?.expiry_date?.startsWith('blob:');
        if (!hasExpiry) return false;
      }
      if (activeFilters?.hasImage) {
        const hasImg = item?.image_url && !item?.image_url?.startsWith('blob:');
        if (!hasImg) return false;
      }
      if (activeFilters?.location) {
        const matchesLocation = item?.vessel_location || item?.location_detail;
        const matches = matchesLocation?.toLowerCase()?.includes(activeFilters?.location?.toLowerCase());
        if (!matches) return false;
      }
      if (activeFilters?.expiringSoon) {
        if (!item?.expiry_date) return false;
        const daysUntil = (new Date(item?.expiry_date) - new Date()) / (1000 * 60 * 60 * 24);
        const matches = daysUntil > 0 && daysUntil <= activeFilters?.expiringSoon;
        if (!matches) return false;
      }
      if (activeFilters?.year) {
        const itemYear = item?.vintage_year || item?.year;
        const matches = String(itemYear) === String(activeFilters?.year);
        if (!matches) return false;
      }
      return true;
    });
    return applySortToItems(result, sortBy);
  })();

  const handleToggleSelectItem = (item) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next?.has(item?.id)) next?.delete(item?.id);
      else next?.add(item?.id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedItemIds?.size === filteredItems?.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(filteredItems?.map(i => i?.id)));
    }
  };

  const handleClearSelection = () => {
    setSelectedItemIds(new Set());
  };

  const handleBulkMove = async (destinationSegments) => {
    const ids = [...selectedItemIds];
    if (!ids?.length || !destinationSegments?.length) return;
    const newLocation = destinationSegments?.[0] || '';
    const newSubLocation = destinationSegments?.slice(1)?.join(' > ') || null;
    const success = await bulkMoveItemsByIds(ids, newLocation, newSubLocation);
    if (success) {
      setSelectedItemIds(new Set());
      await loadData();
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedItemIds];
    if (!ids?.length) return;
    const count = ids.length;
    const trashId = await moveItemsToTrash(ids);
    if (trashId) {
      setSelectedItemIds(new Set());
      await loadData();
      showUndoToast(`${count} item${count !== 1 ? 's' : ''}`, trashId);
    }
  };

  const filteredSubFolders = searchQuery
    ? subFolders?.filter(f => f?.toLowerCase()?.includes(searchQuery?.toLowerCase()))
    : subFolders;

  const activeFilterChips = [];
  if (activeFilters?.tags?.length > 0) activeFilters?.tags?.forEach(t => activeFilterChips?.push({ key: 'tag', value: t, label: `Tag: ${t}` }));
  if (activeFilters?.brand) activeFilterChips?.push({ key: 'brand', value: activeFilters?.brand, label: `Brand: ${activeFilters?.brand}` });
  if (activeFilters?.supplier) activeFilterChips?.push({ key: 'supplier', value: activeFilters?.supplier, label: `Supplier: ${activeFilters?.supplier}` });
  if (activeFilters?.location) activeFilterChips?.push({ key: 'location', value: activeFilters?.location, label: `Location: ${activeFilters?.location}` });
  if (activeFilters?.expiringSoon) activeFilterChips?.push({ key: 'expiringSoon', value: activeFilters?.expiringSoon, label: `Expiring in ${activeFilters?.expiringSoon}d` });
  if (activeFilters?.year) activeFilterChips?.push({ key: 'year', value: activeFilters?.year, label: `Year: ${activeFilters?.year}` });

  const removeFilterChip = (chip) => {
    if (chip?.key === 'tag') {
      setActiveFilters(prev => ({ ...prev, tags: prev?.tags?.filter(t => t !== chip?.value) }));
    } else {
      setActiveFilters(prev => ({ ...prev, [chip?.key]: chip?.key === 'tags' ? [] : null }));
    }
  };

  const hasActiveFilters = activeFilterChips?.length > 0;
  const availableTags = [...new Set(items?.flatMap(i => i?.tags || []))];
  const currentSortLabel = SORT_OPTIONS?.find(o => o?.value === sortBy)?.label || 'Sort';

  const currentStorageFields = segmentsToStorageFields(pathSegments);

  // Split the folder's items into "direct" (pinned to THIS folder — shown as
  // tiles beside the sub-folders) and the recursive rollup (direct + every
  // descendant, in the collapsible "All Items" section). On the root search
  // launchpad or while a search/filter is active, skip the split and show one
  // flat result list instead.
  const flatItemsView = isRoot || !!searchQuery || hasActiveFilters;
  const currentSubLower = (currentStorageFields?.subLocation || '')?.trim()?.toLowerCase();
  const directItems = flatItemsView
    ? filteredItems
    : (filteredItems?.filter(it => (it?.subLocation || '')?.trim()?.toLowerCase() === currentSubLower) || []);
  const hasDeeperItems = !flatItemsView && (filteredItems?.length || 0) > (directItems?.length || 0);
  // The recursive "All Items" rollup is collapsed by default (its contents are
  // already visible as tiles / inside sub-folders); the header toggle overrides.
  const allItemsCollapsed = itemsCollapsedOverride ?? true;

  const isAllSelected = (list) => (list?.length || 0) > 0 && list?.every(i => selectedItemIds?.has(i?.id));
  const toggleSelectAllOf = (list) => {
    const ids = (list || [])?.map(i => i?.id);
    const allSel = isAllSelected(list);
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      ids?.forEach(id => { if (allSel) next?.delete(id); else next?.add(id); });
      return next;
    });
  };

  // Shared renderer for an item list (list rows or grid cards per viewMode).
  const renderItemList = (list) => (
    viewMode === 'list' ? (
      <div className="inv-items">
        {list?.map(item => (
          <ItemRow
            key={item?.id}
            item={item}
            canEdit={canEdit}
            onEdit={(i) => { setQuickViewItem(null); setEditingItem(i); setShowAddModal(true); }}
            onDelete={canManageItems ? (i) => setDeletingItem(i) : undefined}
            onMove={(i) => setMovingItem(i)}
            onClone={canManageItems ? handleCloneItem : undefined}
            onUpdate={loadData}
            onQuickView={(i) => setQuickViewItem(i)}
            isSelected={selectedItemIds?.has(item?.id)}
            onToggleSelect={handleToggleSelectItem}
            onAppearanceChange={handleItemAppearanceChange}
          />
        ))}
      </div>
    ) : (
      <div
        className="inv-grid"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileZoom}px, 1fr))` }}
      >
        {list?.map(item => (
          <ItemGridCard
            key={item?.id}
            item={item}
            canEdit={canEdit}
            onEdit={(i) => { setQuickViewItem(null); setEditingItem(i); setShowAddModal(true); }}
            onDelete={canManageItems ? (i) => setDeletingItem(i) : undefined}
            onMove={(i) => setMovingItem(i)}
            onClone={canManageItems ? handleCloneItem : undefined}
            onUpdate={loadData}
            onQuickView={(i) => setQuickViewItem(i)}
            isSelected={selectedItemIds?.has(item?.id)}
            onToggleSelect={handleToggleSelectItem}
            onAppearanceChange={handleItemAppearanceChange}
          />
        ))}
      </div>
    )
  );

  // Folders + this folder's own items share one SortableContext so either can
  // be dragged. Items are draggable in grid view only (list view uses rows).
  const unifiedSortableIds = viewMode === 'grid'
    ? [...(filteredSubFolders || []), ...(directItems || [])?.map(i => `item:${i?.id}`)]
    : [...(filteredSubFolders || [])];

  const pageTitle = currentFolderName || 'Inventory';
  const pageSubtitle = isRoot
    ? null
    : pathSegments?.length === 1
    ? 'Select an area or view items' : pathSegments?.join(' → ');

  // Canonical headline pattern: WORD, *qualifier*.
  // root → INVENTORY, *Onboard*.  ·  department → INTERIOR, *Stores*.
  // deeper → FOLDER, *Parent*.
  const headlineWord = isRoot ? 'Inventory' : currentFolderName;
  const headlineQualifier = isRoot
    ? 'Onboard'
    : pathSegments?.length === 1
    ? 'Stores'
    : pathSegments?.[pathSegments?.length - 2];

  // Back link target — Dashboard at root, else the parent folder page.
  const backLabel = isRoot
    ? 'Back to Dashboard'
    : `Back to ${pathSegments?.length === 1 ? 'Inventory' : pathSegments?.[pathSegments?.length - 2]}`;
  const handleBackNav = () => {
    if (isRoot) { navigate('/dashboard'); return; }
    navigate(segmentsToUrl(pathSegments?.slice(0, -1)));
  };

  // Value figures are sensitive — only Command / Chief see them.
  const canSeeValue = isCommand || isChief;
  const CURRENCY_SYMBOL = { USD: '$', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$' };

  // Root meta bar — live figures worth knowing across all departments.
  const rootMeta = React.useMemo(() => {
    const list = allItems || [];
    const qtyOf = (it) => {
      const locs = it?.stockLocations || [];
      if (locs?.length > 0) return locs?.reduce((s, l) => s + (l?.qty || 0), 0);
      return it?.quantity ?? it?.totalQty ?? 0;
    };
    let units = 0;
    let expiringSoon = 0;
    let lowStock = 0;
    let value = 0;
    const currencyTally = {};
    const now = Date.now();
    const in30 = now + 30 * 24 * 60 * 60 * 1000;
    list?.forEach(it => {
      const qty = Number(qtyOf(it)) || 0;
      units += qty;
      const raw = it?.expiryDate || it?.expiry_date;
      if (raw) {
        const t = new Date(raw)?.getTime();
        if (!Number.isNaN(t) && t >= now && t <= in30) expiringSoon += 1;
      }
      if (it?.restockEnabled && it?.restockLevel != null && qty <= it?.restockLevel) lowStock += 1;
      const cost = Number(it?.unitCost);
      if (!Number.isNaN(cost) && cost > 0) {
        value += cost * qty;
        const cur = it?.currency || 'USD';
        currencyTally[cur] = (currencyTally[cur] || 0) + 1;
      }
    });
    const domCur = Object.entries(currencyTally)?.sort((a, b) => b[1] - a[1])?.[0]?.[0] || 'USD';
    return {
      departments: subFolders?.length || 0,
      items: list?.length || 0,
      units,
      expiringSoon,
      lowStock,
      value,
      valueLabel: `${CURRENCY_SYMBOL[domCur] || ''}${Math.round(value)?.toLocaleString()}`,
    };
  }, [allItems, subFolders, isCommand, isChief]);


  const handleExport = async ({ scope, format, includeImages, selectedFolderItems, selectedFoldersMeta, allFoldersMeta }) => {
    setIsExporting(true);
    try {
      let exportItems = [];
      if (scope === 'selected' && selectedFolderItems) {
        exportItems = selectedFolderItems;
      } else if (scope === 'folder') {
        const folderLocation = pathSegments?.[0] || '';
        const folderSubPath = pathSegments?.slice(1)?.join(' > ');

        exportItems = allItems?.filter(item => {
          if (item?.location !== folderLocation) return false;
          if (!folderSubPath) {
            return true;
          }
          const itemSub = item?.subLocation || '';
          return itemSub === folderSubPath || itemSub?.startsWith(folderSubPath + ' > ');
        });
      } else {
        exportItems = allItems;
      }

      const folderPath = pathSegments?.join(' › ') || 'Entire Inventory';
      const exportedBy = currentUser?.full_name || currentUser?.name || currentUser?.email || 'Unknown';

      if (format === 'pdf') {
        await exportInventoryToPDF({
          items: exportItems,
          scope,
          folderPath,
          includeImages,
          allFoldersMeta,
        });
      } else {
        await exportInventoryToXLSX({
          items: exportItems,
          scope,
          folderPath,
          includeImages,
          exportedBy,
          allFoldersMeta,
        });
      }
      setShowExportModal(false);
    } catch (err) {
      console.error('[Export] Error during export:', err);
    } finally {
      setIsExporting(false);
    }
  };

  if (authLoading || !bootstrapComplete || pageLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center py-20">
          <LogoSpinner size={48} />
        </div>
      </div>
    );
  }

  const DevDebugPanel = () => {
    if (!devMode && !showDevPanel) return null;
    const rawUser = getCurrentUser();
    const debugData = {
      'bootstrapComplete': String(bootstrapComplete),
      'profileReady': String(profileReady),
      'permission_tier': rawUser?.permission_tier ?? '(missing)',
      'permissionTier': rawUser?.permissionTier ?? '(missing)',
      'effectiveTier': rawUser?.effectiveTier ?? '(missing)',
      'tier': rawUser?.tier ?? '(missing)',
      'role': rawUser?.role ?? '(missing)',
      'roleTitle': rawUser?.roleTitle ?? '(missing)',
      'department': rawUser?.department ?? '(missing)',
      'isCommand': String(isCommand),
      'isChief': String(isChief),
      'isHOD': String(isHOD),
      'userDepartment': userDepartment || '(empty)',
      'subFolders.length': String(subFolders?.length ?? 0),
      'subFolders': subFolders?.join(', ') || '(none)',
      'pathSegments': pathSegments?.join(' / ') || '(root)',
      'isRoot': String(isRoot),
      'session': session ? 'active' : 'null',
      'tenantId': localStorage.getItem('cargo_active_tenant_id') ?? ctxActiveTenantId ?? '(missing)',
    };
    return (
      <div className="fixed bottom-4 right-4 z-[var(--z-toast)] w-80 bg-gray-900 text-green-400 rounded-xl border border-green-500/40 shadow-2xl font-mono text-xs overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-green-500/30">
          <span className="font-bold text-green-300 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block"></span>
            DEV MODE — Inventory Debug
          </span>
          <button
            onClick={() => setShowDevPanel(false)}
            className="text-gray-400 hover:text-white transition-colors"
          >✕</button>
        </div>
        <div className="p-3 space-y-1 max-h-96 overflow-y-auto">
          {Object.entries(debugData)?.map(([key, val]) => (
            <div key={key} className="flex gap-2">
              <span className="text-gray-400 shrink-0 w-36">{key}:</span>
              <span className={
                val === '(missing)' || val === '(empty)' || val === 'null' || val === '(none)'
                  ? 'text-red-400'
                  : val === 'true' ?'text-green-300'
                  : val === 'false' ?'text-yellow-400' :'text-white'
              }>{val}</span>
            </div>
          ))}
        </div>
        <div className="px-3 py-2 bg-gray-800 border-t border-green-500/30 text-gray-500 text-[10px]">
          Enable: localStorage.setItem('cargo_dev_mode','1') or ?auth=0
        </div>
      </div>
    );
  };

  const handleDragStart = ({ active }) => {
    setActiveDragId(active?.id);
    setFolderDropTargetId(null);
    setFolderDropTargetReady(false);
    clearFolderHoverTimer();
  };

  const handleDragOver = ({ active, over }) => {
    const overId = over?.id;
    const overIsFolder = overId && subFolders?.includes(overId);

    if (!over || active?.id === over?.id || !overIsFolder) {
      if (folderHoverIdRef?.current !== null) {
        clearFolderHoverTimer();
        setFolderDropTargetId(null);
        setFolderDropTargetReady(false);
        folderHoverIdRef.current = null;
      }
      return;
    }

    if (folderHoverIdRef?.current === overId) return;

    // Dragging an item onto a folder → highlight immediately (drop = move in).
    // Dragging a folder onto a folder → require a 600ms hold to disambiguate
    // from a reorder.
    const draggingItem = isItemDragId(active?.id);
    clearFolderHoverTimer();
    setFolderDropTargetId(overId);
    folderHoverIdRef.current = overId;

    if (draggingItem) {
      setFolderDropTargetReady(true);
    } else {
      setFolderDropTargetReady(false);
      folderHoverTimerRef.current = setTimeout(() => {
        setFolderDropTargetReady(true);
      }, 600);
    }
  };

  const handleDragEnd = async ({ active, over }) => {
    clearFolderHoverTimer();
    setActiveDragId(null);
    setFolderDropTargetId(null);
    setFolderDropTargetReady(false);
    folderHoverIdRef.current = null;

    if (!over) return;

    // Dragging an item onto a folder tile → move the item into that folder.
    if (isItemDragId(active?.id)) {
      const itemId = String(active?.id)?.slice(5);
      const overId = over?.id;
      if (itemId && overId && subFolders?.includes(overId)) {
        const { location, subLocation } = segmentsToStorageFields([...pathSegments, overId]);
        try {
          await bulkMoveItemsByIds([itemId], location, subLocation);
          setSelectedItemIds(prev => { const n = new Set(prev); n?.delete(itemId); return n; });
        } catch (err) {
          console.error('[LocationFirstInventory] item drag-move error:', err?.message);
        }
        loadData();
      }
      return;
    }

    if (active?.id === over?.id) return;

    if (folderDropTargetReady && folderDropTargetId && folderDropTargetId !== active?.id) {
      setIsMovingFolder(true);
      await handleMoveFolder(pathSegments, [...pathSegments, folderDropTargetId], active?.id);
      setIsMovingFolder(false);
      return;
    }

    const oldIndex = subFolders?.indexOf(active?.id);
    const newIndex = subFolders?.indexOf(over?.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(subFolders, oldIndex, newIndex);
    setSubFolders(reordered);

    let tenantId = localStorage.getItem('cargo_active_tenant_id') || ctxActiveTenantId || '';
    if (!tenantId) return;

    try {
      for (let idx = 0; idx < reordered?.length; idx++) {
        const folderName = reordered?.[idx];
        const sort_order = idx;
        if (isRoot) {
          await supabase
            ?.from('inventory_locations')
            ?.update({ sort_order })
            ?.eq('tenant_id', tenantId)
            ?.eq('location', folderName)
            ?.is('sub_location', null);
        } else {
          const location = pathSegments?.[0];
          const parentSubPath = pathSegments?.slice(1)?.join(' > ');
          const sub_location = parentSubPath ? `${parentSubPath} > ${folderName}` : folderName;
          await supabase
            ?.from('inventory_locations')
            ?.update({ sort_order })
            ?.eq('tenant_id', tenantId)
            ?.eq('location', location)
            ?.eq('sub_location', sub_location);
        }
      }
    } catch (err) {
      console.error('[LocationFirstInventory] handleDragEnd sort_order update error:', err?.message);
    }
  };

  const handleDragCancel = () => {
    setActiveDragId(null);
    clearFolderHoverTimer();
    setFolderDropTargetId(null);
    setFolderDropTargetReady(false);
  };

  const isFolderReadOnly = (folderName) => {
    if (isCommand) return false;
    if (isRoot) {
      return folderName?.toUpperCase() !== userDepartment?.toUpperCase() &&
        folderName?.toLowerCase() !== userDepartment?.toLowerCase();
    }
    return false;
  };

  return (
    <div className="inv-page">
      <Header />
      <div className="inv-wrap">

        {/* Back link — Dashboard at root, else the parent folder page */}
        <button onClick={handleBackNav} className="inv-back">
          <Icon name="ArrowLeft" size={14} />
          {backLabel}
        </button>

        {/* Meta strip — canonical editorial inline data (root only) */}
        {isRoot && (
          <p className="editorial-meta inv-metastrip">
            <span className="dot">●</span>
            <span>{rootMeta?.departments} Departments</span>
            <span className="bar" />
            <span>{rootMeta?.items?.toLocaleString()} Items</span>
            <span className="bar" />
            <span className="muted">{rootMeta?.units?.toLocaleString()} Units in stock</span>
            <span className="bar" />
            <span style={rootMeta?.expiringSoon > 0 ? { color: '#C65A1A' } : undefined}>
              {rootMeta?.expiringSoon} Expiring ≤ 30d
            </span>
            {canSeeValue && (
              <>
                <span className="bar" />
                <span className="muted">{rootMeta?.valueLabel} Est. value</span>
              </>
            )}
          </p>
        )}

        {/* Header Row */}
        <div className="inv-header">
          <div>
            <h1 className="inv-headline">
              {String(headlineWord || 'Inventory').toUpperCase()}<span className="punc">,</span>{' '}
              <em>{headlineQualifier}</em><span className="punc">.</span>
            </h1>
            {pageSubtitle && <p className="inv-subtitle">{pageSubtitle}</p>}
          </div>
          <div className="inv-actions">
            {canUseTrash && (
              <button onClick={openTrash} className="inv-btn ghost" title="Recently deleted">
                <Icon name="Trash2" size={15} />
                <span className="hidden sm:inline">Trash</span>
              </button>
            )}
            <button
              onClick={() => setShowExportModal(true)}
              className="inv-btn ghost"
              title="Export inventory"
            >
              <Icon name="Download" size={15} />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              onClick={() => setShowAzureImportModal(true)}
              className="inv-btn accent"
              title="Import inventory from PDF / spreadsheet"
            >
              <Icon name="FileText" size={15} />
              <span className="hidden sm:inline">Import inventory</span>
            </button>
            {!isRoot && (
              <AddDropdownButton
                isRoot={isRoot}
                onAddFolder={() => setShowAddFolderModal(true)}
                onAddItem={() => { setEditingItem(null); setShowAddModal(true); }}
              />
            )}
          </div>
        </div>

        {/* Toolbar — search / filter / sort (root searches all inventory) */}
        <div className="inv-toolbar">
            <div className="inv-toolbar-row">
              <div className="inv-search">
                <Icon name="Search" size={15} />
                <input
                  type="text"
                  placeholder={isRoot ? 'Search all inventory — name, brand, tag, supplier, barcode…' : 'Search name, brand, tag, supplier, barcode…'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e?.target?.value)}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="inv-search-clear"
                  >
                    <Icon name="X" size={14} />
                  </button>
                )}
              </div>

              <div className="inv-sortwrap" ref={filterPanelRef}>
                <button
                  onClick={() => { setShowFilterPanel(prev => !prev); setShowSortDropdown(false); }}
                  className={`inv-tool${hasActiveFilters ? ' on' : ''}`}
                >
                  <Icon name="SlidersHorizontal" size={15} />
                  <span className="hidden sm:inline">Filter</span>
                  {hasActiveFilters && (
                    <span className="inv-tool-count">
                      {activeFilterChips?.length}
                    </span>
                  )}
                </button>
                {showFilterPanel && (
                  <FilterPanel
                    items={isRoot ? (allItems || []) : items}
                    filters={activeFilters}
                    onChange={setActiveFilters}
                    onClose={() => setShowFilterPanel(false)}
                  />
                )}
              </div>

              <div className="inv-sortwrap" ref={sortDropdownRef}>
                <button
                  onClick={() => { setShowSortDropdown(prev => !prev); setShowFilterPanel(false); }}
                  className="inv-tool"
                >
                  <Icon name="ArrowUpDown" size={15} />
                  <span className="hidden sm:inline max-w-[120px] truncate">{currentSortLabel}</span>
                  <Icon name="ChevronDown" size={13} className={`transition-transform ${showSortDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showSortDropdown && (
                  <div className="inv-sortmenu">
                    {SORT_OPTIONS?.map(opt => (
                      <button
                        key={opt?.value}
                        onClick={() => { setSortBy(opt?.value); setShowSortDropdown(false); }}
                        className={`inv-sortitem${sortBy === opt?.value ? ' on' : ''}`}
                      >
                        {opt?.label}
                        {sortBy === opt?.value && <Icon name="Check" size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {viewMode === 'grid' && (
                <div className="inv-zoom" title="Card size">
                  <button
                    className="inv-zoom-btn"
                    onClick={() => setTileZoom(z => Math.max(160, z - 40))}
                    title="Smaller cards"
                  >
                    <Icon name="Minus" size={14} />
                  </button>
                  <input
                    type="range"
                    min={160}
                    max={360}
                    step={10}
                    value={tileZoom}
                    onChange={(e) => setTileZoom(parseInt(e?.target?.value, 10))}
                    className="inv-zoom-range"
                    aria-label="Card size"
                  />
                  <button
                    className="inv-zoom-btn"
                    onClick={() => setTileZoom(z => Math.min(360, z + 40))}
                    title="Larger cards"
                  >
                    <Icon name="Plus" size={14} />
                  </button>
                </div>
              )}

              <div className="inv-viewtoggle">
                <button
                  onClick={() => setViewMode('list')}
                  title="List view"
                  className={`inv-viewbtn${viewMode === 'list' ? ' on' : ''}`}
                >
                  <Icon name="List" size={16} />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  title="Grid view"
                  className={`inv-viewbtn${viewMode === 'grid' ? ' on' : ''}`}
                >
                  <Icon name="LayoutGrid" size={16} />
                </button>
              </div>
            </div>
          </div>

        {/* Selection toolbar */}
        {!isRoot && selectedItemIds?.size > 0 && (
          <div className="inv-selbar">
            <button
              onClick={handleSelectAll}
              className="inv-selbar-toggle"
            >
              <div className={`inv-minicheck${selectedItemIds?.size === filteredItems?.length && filteredItems?.length > 0 ? ' on' : ''}`}>
                {selectedItemIds?.size === filteredItems?.length && filteredItems?.length > 0
                  ? <Icon name="Check" size={10} />
                  : <Icon name="Minus" size={10} />
                }
              </div>
              {selectedItemIds?.size === filteredItems?.length && filteredItems?.length > 0
                ? 'Deselect All' :'Select All'
              }
            </button>
            <span className="inv-selbar-count">
              {selectedItemIds?.size} item{selectedItemIds?.size !== 1 ? 's' : ''} selected
            </span>
            <div className="inv-selbar-spacer" />
            <button onClick={() => setShowBulkMoveModal(true)} className="inv-selbtn">
              <Icon name="FolderInput" size={13} />
              Move
            </button>
            {canManageItems && (
              <button onClick={() => setShowBulkDeleteModal(true)} className="inv-selbtn danger">
                <Icon name="Trash2" size={13} />
                Delete
              </button>
            )}
            <button onClick={() => setShowExportModal(true)} className="inv-selbtn primary">
              <Icon name="Download" size={13} />
              Export
            </button>
          </div>
        )}

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="inv-chips">
            {activeFilterChips?.map((chip, idx) => (
              <button
                key={idx}
                onClick={() => removeFilterChip(chip)}
                className="inv-chip"
              >
                {chip?.label}
                <Icon name="X" size={11} />
              </button>
            ))}
          </div>
        )}

        {/* Main content */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {/* One unified grid — folders and this folder's own items together,
              same-size tiles, no section titles. Drag a folder to reorder or
              hold it over another folder to move inside; drag an item onto a
              folder to move it there. */}
          <SortableContext items={unifiedSortableIds} strategy={rectSortingStrategy}>
            {(filteredSubFolders?.length > 0 || directItems?.length > 0) && (
              <div
                className={viewMode === 'list' ? 'inv-grid list' : 'inv-grid'}
                style={viewMode === 'grid' ? { gridTemplateColumns: `repeat(auto-fill, minmax(${tileZoom}px, 1fr))` } : undefined}
              >
                {filteredSubFolders?.map(folderName => {
                  const folderSegments = [...pathSegments, folderName];
                  const isReadOnly = isFolderReadOnly(folderName);
                  const showCog = shouldShowCog(folderName);
                  const meta = folderTree?.[pathKey(pathSegments)]?.folderMeta?.[folderName] || {};
                  const folderIcon = meta?.icon || (isRoot ? departmentIcon(folderName) : 'FolderOpen');
                  const folderColor = meta?.color || null;
                  return (
                    <SortableFolderCard
                      key={folderName}
                      id={folderName}
                      name={folderName}
                      icon={folderIcon}
                      color={folderColor}
                      itemCount={itemCounts?.[folderName] ?? 0}
                      subFolderCount={getSubFoldersFromTree(folderTree, folderSegments)?.length}
                      depth={pathSegments?.length}
                      onClick={() => navigate(segmentsToUrl(folderSegments))}
                      canEdit={canEdit && !isReadOnly}
                      onEdit={() => setEditingFolderName(folderName)}
                      onRenameSubmit={(newName) => handleInlineRename(folderName, newName)}
                      onDelete={canDeleteFolder(folderName) ? () => setDeletingFolderName(folderName) : undefined}
                      onCog={() => setCogFolderName(folderName)}
                      onPalette={canEdit && !isFolderReadOnly(folderName) ? () => setAppearanceFolderName(folderName) : undefined}
                      onMove={() => setMovingFolderName(folderName)}
                      onPermissions={() => setPermsFolderName(folderName)}
                      onDuplicate={() => handleDuplicateFolder(folderName)}
                      onExport={() => handleExportFolder(folderSegments)}
                      onArchive={() => setArchivingFolderName(folderName)}
                      canMove={!isRoot}
                      showCog={showCog}
                      folderDropTargetId={folderDropTargetId}
                      folderDropTargetReady={folderDropTargetReady}
                      layout={viewMode}
                    />
                  );
                })}
                {directItems?.map(item => (
                  viewMode === 'list' ? (
                    <ItemRow
                      key={item?.id}
                      item={item}
                      canEdit={canEdit}
                      onEdit={(i) => { setQuickViewItem(null); setEditingItem(i); setShowAddModal(true); }}
                      onDelete={canManageItems ? (i) => setDeletingItem(i) : undefined}
                      onMove={(i) => setMovingItem(i)}
                      onClone={canManageItems ? handleCloneItem : undefined}
                      onUpdate={loadData}
                      onQuickView={(i) => setQuickViewItem(i)}
                      isSelected={selectedItemIds?.has(item?.id)}
                      onToggleSelect={handleToggleSelectItem}
                      onAppearanceChange={handleItemAppearanceChange}
                    />
                  ) : (
                    <SortableItemCard
                      key={item?.id}
                      item={item}
                      draggable={canEdit}
                      canEdit={canEdit}
                      onEdit={(i) => { setQuickViewItem(null); setEditingItem(i); setShowAddModal(true); }}
                      onDelete={canManageItems ? (i) => setDeletingItem(i) : undefined}
                      onMove={(i) => setMovingItem(i)}
                      onClone={canManageItems ? handleCloneItem : undefined}
                      onUpdate={loadData}
                      onQuickView={(i) => setQuickViewItem(i)}
                      isSelected={selectedItemIds?.has(item?.id)}
                      onToggleSelect={handleToggleSelectItem}
                      onAppearanceChange={handleItemAppearanceChange}
                    />
                  )
                ))}
              </div>
            )}
          </SortableContext>

          <DragOverlay>
            {activeDragId && !isItemDragId(activeDragId) ? (
              <FolderCard
                name={activeDragId}
                icon={folderTree?.[pathKey(pathSegments)]?.folderMeta?.[activeDragId]?.icon || (isRoot ? departmentIcon(activeDragId) : 'FolderOpen')}
                color={folderTree?.[pathKey(pathSegments)]?.folderMeta?.[activeDragId]?.color || null}
                itemCount={itemCounts?.[activeDragId] ?? 0}
                subFolderCount={0}
                depth={pathSegments?.length}
                onClick={undefined}
                canEdit={false}
                onEdit={undefined}
                onDelete={undefined}
                onCog={undefined}
                onVisibilityChange={undefined}
                canMove={undefined}
                dragHandleProps={undefined}
                isDragging={true}
                isFolderDropTarget={false}
                isDropTargetReady={false}
                showCog={false}
                layout={viewMode}
              />
            ) : activeDragId && isItemDragId(activeDragId) ? (
              <div className="inv-dragchip">
                <Icon name="Package" size={14} />
                <span>{directItems?.find(i => `item:${i?.id}` === activeDragId)?.name || 'Item'}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Recursive rollup — everything inside this folder and every sub-folder */}
        {hasDeeperItems && (
          <div style={{ marginTop: 28 }}>
            <div className="inv-sectrow">
              <button
                className="inv-secttoggle"
                onClick={() => setItemsCollapsedOverride(!allItemsCollapsed)}
                title={allItemsCollapsed ? 'Show all items' : 'Hide all items'}
              >
                <Icon name="ChevronRight" size={15} className={`inv-sectchevron${allItemsCollapsed ? '' : ' open'}`} />
                <h2 className="inv-sectlabel">
                  All Items ({filteredItems?.length})
                </h2>
              </button>
              {!allItemsCollapsed && (
                <button
                  onClick={() => toggleSelectAllOf(filteredItems)}
                  className="inv-selbtn"
                >
                  <div className={`inv-minicheck${isAllSelected(filteredItems) ? ' on' : ''}`}>
                    {isAllSelected(filteredItems) ? <Icon name="Check" size={9} /> : null}
                  </div>
                  {isAllSelected(filteredItems) ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>
            {allItemsCollapsed ? null : renderItemList(filteredItems)}
          </div>
        )}

        {/* Empty state */}
        {!isRoot && filteredSubFolders?.length === 0 && filteredItems?.length === 0 && (
          <div className="inv-empty">
            <div className="inv-empty-icon">
              <Icon name="Package" size={28} />
            </div>
            <h3 className="inv-empty-title">
              {searchQuery ? 'No results found' : 'This folder is empty'}
            </h3>
            <p className="inv-empty-sub">
              {searchQuery
                ? `No items or folders match "${searchQuery}"`
                : 'Add items or sub-folders to get started'}
            </p>
            {!searchQuery && canEdit && (
              <div className="inv-empty-actions">
                <button
                  onClick={() => setShowAddFolderModal(true)}
                  className="inv-btn ghost"
                >
                  <Icon name="FolderPlus" size={15} />
                  Add Sub-folder
                </button>
                <button
                  onClick={() => { setEditingItem(null); setShowAddModal(true); }}
                  className="inv-btn primary"
                >
                  <Icon name="Plus" size={15} />
                  Add Item
                </button>
              </div>
            )}
          </div>
        )}

        {isRoot && subFolders?.length === 0 && (
          <div className="inv-empty">
            <div className="inv-empty-icon">
              <Icon name="FolderOpen" size={28} />
            </div>
            <h3 className="inv-empty-title">No department folders yet</h3>
            <p className="inv-empty-sub">Department folders will appear here once your account is set up.</p>
          </div>
        )}
      </div>
      {/* Modals */}
      {showAddModal && (() => {
        // Uniform is captured differently (size run, fit, branding, care) — an
        // item filed anywhere under a "Uniform" folder gets the uniform modal.
        const editSegs = editingItem
          ? [editingItem.location, ...String(editingItem.subLocation || '').split('>').map((s) => s.trim())]
          : pathSegments;
        const isUniform = (editSegs || []).some((s) => /(^|\b)uniform(\b|$)/i.test(String(s || '')));
        return isUniform ? (
          <UniformItemModal
            item={editingItem}
            defaultLocation={currentStorageFields?.location}
            defaultSubLocation={currentStorageFields?.subLocation}
            onClose={handleModalClose}
          />
        ) : (
          <AddEditItemModal
            item={editingItem}
            defaultLocation={currentStorageFields?.location}
            defaultSubLocation={currentStorageFields?.subLocation}
            onClose={handleModalClose}
            onSave={handleItemSaved}
          />
        );
      })()}
      {showAddFolderModal && (
        <AddFolderModal
          parentPath={pathSegments}
          onClose={() => setShowAddFolderModal(false)}
          onSave={handleAddFolder}
        />
      )}
      {editingFolderName && (
        <EditFolderModal
          currentName={editingFolderName}
          onClose={() => setEditingFolderName(null)}
          onSave={handleRenameFolder}
        />
      )}
      {deletingFolderName && (
        <DeleteFolderModal
          folderName={deletingFolderName}
          onClose={() => setDeletingFolderName(null)}
          onConfirm={handleDeleteFolder}
        />
      )}
      {archivingFolderName && (
        <ArchiveFolderModal
          folderName={archivingFolderName}
          onClose={() => setArchivingFolderName(null)}
          onConfirm={handleArchiveFolder}
        />
      )}
      {cogFolderName && (
        <FolderSettingsModal
          folderName={cogFolderName}
          parentSegments={pathSegments}
          currentVisibility={folderVisibilities?.[cogFolderName] || 'everyone'}
          onClose={() => setCogFolderName(null)}
          onRename={() => setEditingFolderName(cogFolderName)}
          onMove={() => setMovingFolderName(cogFolderName)}
          onDelete={() => setDeletingFolderName(cogFolderName)}
          onArchive={() => setArchivingFolderName(cogFolderName)}
          onVisibilityChange={(v) => handleVisibilityChange(cogFolderName, v)}
          onEditAppearance={() => setAppearanceFolderName(cogFolderName)}
          canMove={!isRoot}
        />
      )}
      {movingFolderName && (
        <MoveFolderModal
          folderName={movingFolderName}
          currentPathSegments={pathSegments}
          folderTree={folderTree}
          onClose={() => setMovingFolderName(null)}
          onMove={handleMoveFolder}
          isCommand={isCommand}
          isChief={isChief}
          isHOD={isHOD}
          userDepartment={userDepartment}
        />
      )}
      {permsFolderName && (
        <FolderVisibilityModal
          folderName={permsFolderName}
          currentVisibility={folderVisibilities?.[permsFolderName] || 'everyone'}
          onClose={() => setPermsFolderName(null)}
          onSave={(v) => { handleVisibilityChange(permsFolderName, v); setPermsFolderName(null); }}
        />
      )}
      {appearanceFolderName && (
        <EditFolderAppearanceModal
          folderName={appearanceFolderName}
          currentIcon={folderTree?.[pathKey(pathSegments)]?.folderMeta?.[appearanceFolderName]?.icon || null}
          currentColor={folderTree?.[pathKey(pathSegments)]?.folderMeta?.[appearanceFolderName]?.color || null}
          onClose={() => setAppearanceFolderName(null)}
          onSave={handleSaveAppearance}
        />
      )}
      {quickViewItem && (() => {
        // Uniform items get the editorial size-run drawer; everything else the
        // generic panel. Detect the same way the add/edit modal does — filed
        // anywhere under a "Uniform" folder (or flagged is_uniform).
        const qvSegs = [quickViewItem.location, ...String(quickViewItem.subLocation || '').split('>').map((s) => s.trim())];
        const qvUniform = quickViewItem.isUniform || qvSegs.some((s) => /(^|\b)uniform(\b|$)/i.test(String(s || '')));
        const onEditItem = (i) => { setQuickViewItem(null); setEditingItem(i); setShowAddModal(true); };
        return qvUniform ? (
          <UniformItemView
            item={quickViewItem}
            canEdit={canEdit}
            onEdit={onEditItem}
            onClose={() => setQuickViewItem(null)}
          />
        ) : (
          <ItemQuickViewPanel
            item={quickViewItem}
            onClose={() => setQuickViewItem(null)}
            onEdit={onEditItem}
            canEdit={canEdit}
          />
        );
      })()}
      {showExportModal && (
        <ExportInventoryModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          onExport={handleExport}
          isExporting={isExporting}
          currentPath={pathSegments}
          currentTaxonomyPath={pathSegments}
          currentItems={filteredItems}
          searchQuery={searchQuery}
          allItems={allItems}
          selectedItemIds={selectedItemIds}
        />
      )}
      {showAzureImportModal && (
        <AzurePdfImportModal
          isOpen={showAzureImportModal}
          onClose={() => { setShowAzureImportModal(false); loadData(); }}
          currentPathSegments={pathSegments}
          onImportComplete={() => { markTutorialStep(session?.user?.id, 'import_done').catch(() => {}); setShowAzureImportModal(false); loadData(); }}
        />
      )}
      {showBulkMoveModal && (
        <BulkMoveItemsModal
          selectedCount={selectedItemIds?.size}
          folderTree={folderTree}
          currentPathSegments={pathSegments}
          onClose={() => setShowBulkMoveModal(false)}
          onMove={handleBulkMove}
          isCommand={isCommand}
          isChief={isChief}
          isHOD={isHOD}
          userDepartment={userDepartment}
        />
      )}
      {showBulkDeleteModal && (
        <BulkDeleteConfirmModal
          selectedCount={selectedItemIds?.size}
          onClose={() => setShowBulkDeleteModal(false)}
          onConfirm={handleBulkDelete}
        />
      )}
      {movingItem && (
        <BulkMoveItemsModal
          selectedCount={1}
          itemLabel={movingItem?.name}
          folderTree={folderTree}
          currentPathSegments={pathSegments}
          onClose={() => setMovingItem(null)}
          onMove={handleMoveItem}
          isCommand={isCommand}
          isChief={isChief}
          isHOD={isHOD}
          userDepartment={userDepartment}
        />
      )}
      {deletingItem && (
        <ItemDeleteModal
          item={deletingItem}
          onClose={() => setDeletingItem(null)}
          onConfirm={handleConfirmDeleteItem}
        />
      )}
      {showTrash && (
        <TrashModal
          items={trashItems}
          loading={trashLoading}
          onClose={() => setShowTrash(false)}
          onRestore={handleRestoreTrash}
          onPurge={handlePurgeTrash}
          onEmpty={handleEmptyTrash}
          canEmpty={isCommand}
        />
      )}
      {undoToast && (
        <div className="inv-toast" role="status">
          <Icon name="Trash2" size={15} />
          <span>Deleted <b>{undoToast?.name}</b></span>
          <button className="inv-toast-undo" onClick={handleUndoDelete}>
            <Icon name="Undo2" size={14} /> Undo
          </button>
          <button className="inv-toast-close" onClick={() => { if (undoTimerRef?.current) clearTimeout(undoTimerRef.current); setUndoToast(null); }}>
            <Icon name="X" size={14} />
          </button>
        </div>
      )}
      {devMode && <DevDebugPanel />}
    </div>
  );
};

export default LocationFirstInventory;

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import { getAllItems, getItemsByLocation, getItemCountByLocation, deleteItem, saveItem, getFolderTree, createFolder, renameFolderInDB, deleteFolderFromDB, migrateLocalStorageFolderTree, moveFolderInDB, ensureDepartmentFolders, updateFolderVisibility, archiveFolder, updateItemStockLocations, bulkDeleteItemsByIds, bulkMoveItemsByIds, updateFolderAppearance, updateItemAppearance, updatePartialBottle } from '../inventory/utils/inventoryStorage';
import { getCurrentUser, DEPARTMENTS } from '../../utils/authStorage';
import { isDevMode } from '../../utils/devMode';
import { useAuth } from '../../contexts/AuthContext';
import AddEditItemModal from '../inventory/components/AddEditItemModal';
import ItemQuickViewPanel from '../inventory/components/ItemQuickViewPanel';
import PartialBottleModal from '../inventory/components/PartialBottleModal';
import { supabase } from '../../lib/supabaseClient';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Add Sub-folder</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
            <Icon name="X" size={18} />
          </button>
        </div>
        {parentLabel && (
          <p className="text-sm text-muted-foreground mb-3">Inside: <span className="font-medium text-foreground">{parentLabel}</span></p>
        )}

        {/* Name input */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-foreground mb-1.5">Folder name</label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={handleNameChange}
            onKeyDown={(e) => { if (e?.key === 'Enter') handleSave(); if (e?.key === 'Escape') onClose(); }}
            placeholder="e.g. Linen & Towels"
            className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground"
          />
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>

        {/* Preview + Icon/Color selectors */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-foreground mb-2">Appearance</label>
          <div className="flex items-center gap-3">
            {/* Preview circle */}
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: previewColor + '22', border: `2px solid ${previewColor}44` }}
            >
              <Icon name={previewIcon} size={22} style={{ color: previewColor }} />
            </div>

            {/* Icon picker toggle */}
            <div className="flex-1">
              <button
                type="button"
                onClick={() => setShowIconPicker(v => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm bg-background border border-border rounded-xl hover:border-primary/50 transition-colors text-foreground"
              >
                <div className="flex items-center gap-2">
                  <Icon name={previewIcon} size={14} className="text-muted-foreground" />
                  <span className="text-muted-foreground text-xs">{previewIcon}</span>
                </div>
                <Icon name={showIconPicker ? 'ChevronUp' : 'ChevronDown'} size={14} className="text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Icon grid */}
          {showIconPicker && (
            <div className="mt-2 p-3 bg-background border border-border rounded-xl">
              <input
                type="text"
                value={iconSearch}
                onChange={e => setIconSearch(e?.target?.value)}
                placeholder="Search icons…"
                className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30 text-foreground mb-2"
              />
              <div className="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
                {FOLDER_ICON_PALETTE?.filter(n => !iconSearch || n?.toLowerCase()?.includes(iconSearch?.toLowerCase()))?.map(iconName => (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => { setSelectedIcon(iconName); setShowIconPicker(false); setIconSearch(''); }}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      selectedIcon === iconName
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                    title={iconName}
                  >
                    <Icon name={iconName} size={14} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Color swatches */}
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {FOLDER_COLOR_PALETTE?.map(c => (
              <button
                key={c?.value}
                type="button"
                onClick={() => setSelectedColor(selectedColor === c?.value ? null : c?.value)}
                className="w-6 h-6 rounded-full transition-transform hover:scale-110 flex-shrink-0"
                style={{
                  backgroundColor: c?.value,
                  outline: selectedColor === c?.value ? `2px solid ${c?.value}` : '2px solid transparent',
                  outlineOffset: 2,
                }}
                title={c?.label}
              />
            ))}
            {selectedColor && (
              <button
                type="button"
                onClick={() => setSelectedColor(null)}
                className="text-xs text-muted-foreground hover:text-foreground ml-1 underline"
              >
                Reset
              </button>
            )}
          </div>
          {name && suggestIconForName(name) && selectedIcon === suggestIconForName(name) && (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <Icon name="Sparkles" size={10} />
              Icon suggested based on folder name
            </p>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted rounded-xl hover:bg-muted/80 transition-colors">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors">Create</button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm p-6">
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
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Edit Appearance</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
            <Icon name="X" size={18} />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{folderName}</p>

        {/* Preview + Icon toggle */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: previewColor + '22', border: `2px solid ${previewColor}44` }}
          >
            <Icon name={previewIcon} size={22} style={{ color: previewColor }} />
          </div>
          <button
            type="button"
            onClick={() => setShowIconPicker(v => !v)}
            className="flex-1 flex items-center justify-between gap-2 px-3 py-2 text-sm bg-background border border-border rounded-xl hover:border-primary/50 transition-colors text-foreground"
          >
            <div className="flex items-center gap-2">
              <Icon name={previewIcon} size={14} className="text-muted-foreground" />
              <span className="text-muted-foreground text-xs">{previewIcon}</span>
            </div>
            <Icon name={showIconPicker ? 'ChevronUp' : 'ChevronDown'} size={14} className="text-muted-foreground" />
          </button>
        </div>

        {showIconPicker && (
          <div className="mb-4 p-3 bg-background border border-border rounded-xl">
            <input
              type="text"
              value={iconSearch}
              onChange={e => setIconSearch(e?.target?.value)}
              placeholder="Search icons…"
              className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30 text-foreground mb-2"
            />
            <div className="grid grid-cols-8 gap-1 max-h-44 overflow-y-auto">
              {FOLDER_ICON_PALETTE?.filter(n => !iconSearch || n?.toLowerCase()?.includes(iconSearch?.toLowerCase()))?.map(iconName => (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => { setSelectedIcon(iconName); setShowIconPicker(false); setIconSearch(''); }}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    selectedIcon === iconName
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                  title={iconName}
                >
                  <Icon name={iconName} size={14} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-5">
          <p className="text-xs font-medium text-muted-foreground mb-2">Colour</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {FOLDER_COLOR_PALETTE?.map(c => (
              <button
                key={c?.value}
                type="button"
                onClick={() => setSelectedColor(selectedColor === c?.value ? null : c?.value)}
                className="w-6 h-6 rounded-full transition-transform hover:scale-110 flex-shrink-0"
                style={{
                  backgroundColor: c?.value,
                  outline: selectedColor === c?.value ? `2px solid ${c?.value}` : '2px solid transparent',
                  outlineOffset: 2,
                }}
                title={c?.label}
              />
            ))}
            {selectedColor && (
              <button
                type="button"
                onClick={() => setSelectedColor(null)}
                className="text-xs text-muted-foreground hover:text-foreground ml-1 underline"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted rounded-xl hover:bg-muted/80 transition-colors">Cancel</button>
          <button
            onClick={() => onSave({ icon: selectedIcon, color: selectedColor })}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm p-6">
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
      </div>
    </div>
  );
};

// ─── Move Folder Modal ────────────────────────────────────────────────────────
const MoveFolderModal = ({ folderName, currentPathSegments, folderTree, onClose, onMove, isCommand, isChief, isHOD, userDepartment }) => {
  const [selectedPath, setSelectedPath] = useState(null);
  const [moving, setMoving] = useState(false);

  // Build a flat list of all available destination folders from the tree
  const buildDestinations = () => {
    const destinations = [];
    const currentFullPath = [...currentPathSegments, folderName]?.join(' > ');
    const currentParentPath = currentPathSegments?.join(' > ');

    const traverse = (segments, depth) => {
      const key = segments?.join('|||');
      const children = folderTree?.[key]?.subFolders || [];
      children?.forEach(childName => {
        const childSegments = [...segments, childName];
        const childPath = childSegments?.join(' > ');
        const isSelf = childPath === currentFullPath;
        const isDescendant = childPath?.startsWith(currentFullPath + ' > ');
        const isCurrentParent = childPath === currentParentPath;

        let isAllowed = true;
        if (!isCommand && (isChief || isHOD)) {
          const rootSegment = childSegments?.[0] || '';
          isAllowed = rootSegment?.toLowerCase() === userDepartment?.toLowerCase();
        }

        if (!isSelf && !isDescendant && !isCurrentParent && isAllowed) {
          destinations?.push({ segments: childSegments, depth, label: childName, path: childPath });
        }
        traverse(childSegments, depth + 1);
      });
    };

    traverse([], 0);
    return destinations;
  };

  const destinations = buildDestinations();

  const handleConfirm = async () => {
    if (!selectedPath) return;
    setMoving(true);
    await onMove(currentPathSegments, selectedPath?.segments, folderName);
    setMoving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon name="FolderInput" size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Move Folder</h2>
              <p className="text-xs text-muted-foreground truncate max-w-[180px]">{folderName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
            <Icon name="X" size={18} />
          </button>
        </div>

        <p className="text-xs text-muted-foreground mb-3">Select a destination folder:</p>

        <div className="max-h-64 overflow-y-auto space-y-0.5 border border-border rounded-xl p-2 bg-background">
          {destinations?.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No other folders available</p>
          ) : (
            destinations?.map((dest) => {
              const isSelected = selectedPath?.path === dest?.path;
              return (
                <button
                  key={dest?.path}
                  onClick={() => setSelectedPath(dest)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors text-left ${
                    isSelected
                      ? 'bg-primary/10 text-primary font-medium' :'text-foreground hover:bg-muted'
                  }`}
                  style={{ paddingLeft: `${12 + dest?.depth * 16}px` }}
                >
                  <Icon
                    name={isSelected ? 'FolderOpen' : 'Folder'}
                    size={14}
                    className={isSelected ? 'text-primary' : 'text-muted-foreground'}
                  />
                  <span className="truncate">{dest?.label}</span>
                  {dest?.depth > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground truncate max-w-[100px]">
                      {dest?.segments?.slice(0, -1)?.join(' › ')}
                    </span>
                  )}
                  {isSelected && <Icon name="Check" size={13} className="ml-auto text-primary shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        {selectedPath && (
          <p className="text-xs text-muted-foreground mt-2">
            Moving to: <span className="font-medium text-foreground">{selectedPath?.segments?.join(' › ')}</span>
          </p>
        )}

        <div className="flex gap-2 justify-end mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted rounded-xl hover:bg-muted/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedPath || moving}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {moving && <Icon name="Loader2" size={14} className="animate-spin" />}
            {moving ? 'Moving…' : 'Move Here'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Bulk Move Items Modal ────────────────────────────────────────────────────
const BulkMoveItemsModal = ({ selectedCount, folderTree, currentPathSegments, onClose, onMove, isCommand, isChief, isHOD, userDepartment }) => {
  const [selectedPath, setSelectedPath] = useState(null);
  const [moving, setMoving] = useState(false);

  const buildDestinations = () => {
    const destinations = [];
    const currentFullPath = currentPathSegments?.join(' > ');

    const traverse = (segments, depth) => {
      const key = segments?.join('|||');
      const children = folderTree?.[key]?.subFolders || [];
      children?.forEach(childName => {
        const childSegments = [...segments, childName];
        const childPath = childSegments?.join(' > ');
        const isCurrent = childPath === currentFullPath;

        let isAllowed = true;
        if (!isCommand && (isChief || isHOD)) {
          const rootSegment = childSegments?.[0] || '';
          isAllowed = rootSegment?.toLowerCase() === userDepartment?.toLowerCase();
        }

        if (!isCurrent && isAllowed) {
          destinations?.push({ segments: childSegments, depth, label: childName, path: childPath });
        }
        traverse(childSegments, depth + 1);
      });
    };

    traverse([], 0);
    return destinations;
  };

  const destinations = buildDestinations();

  const handleConfirm = async () => {
    if (!selectedPath) return;
    setMoving(true);
    await onMove(selectedPath?.segments);
    setMoving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon name="FolderInput" size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Move Items</h2>
              <p className="text-xs text-muted-foreground">{selectedCount} item{selectedCount !== 1 ? 's' : ''} selected</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
            <Icon name="X" size={18} />
          </button>
        </div>

        <p className="text-xs text-muted-foreground mb-3">Select a destination folder:</p>

        <div className="max-h-64 overflow-y-auto space-y-0.5 border border-border rounded-xl p-2 bg-background">
          {destinations?.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No other folders available</p>
          ) : (
            destinations?.map((dest) => {
              const isSelected = selectedPath?.path === dest?.path;
              return (
                <button
                  key={dest?.path}
                  onClick={() => setSelectedPath(dest)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors text-left ${
                    isSelected
                      ? 'bg-primary/10 text-primary font-medium' :'text-foreground hover:bg-muted'
                  }`}
                  style={{ paddingLeft: `${12 + dest?.depth * 16}px` }}
                >
                  <Icon
                    name={isSelected ? 'FolderOpen' : 'Folder'}
                    size={14}
                    className={isSelected ? 'text-primary' : 'text-muted-foreground'}
                  />
                  <span className="truncate">{dest?.label}</span>
                  {dest?.depth > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground truncate max-w-[100px]">
                      {dest?.segments?.slice(0, -1)?.join(' › ')}
                    </span>
                  )}
                  {isSelected && <Icon name="Check" size={13} className="ml-auto text-primary shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        {selectedPath && (
          <p className="text-xs text-muted-foreground mt-2">
            Moving to: <span className="font-medium text-foreground">{selectedPath?.segments?.join(' › ')}</span>
          </p>
        )}

        <div className="flex gap-2 justify-end mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted rounded-xl hover:bg-muted/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedPath || moving}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {moving && <Icon name="Loader2" size={14} className="animate-spin" />}
            {moving ? 'Moving…' : 'Move Here'}
          </button>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
              <Icon name="Trash2" size={16} className="text-red-600" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Delete Items</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
            <Icon name="X" size={18} />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Are you sure you want to permanently delete <span className="font-semibold text-foreground">{selectedCount} item{selectedCount !== 1 ? 's' : ''}</span>? This cannot be undone.
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted rounded-xl hover:bg-muted/80 transition-colors">Cancel</button>
          <button onClick={handleConfirm} disabled={deleting} className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
            {deleting && <Icon name="Loader2" size={14} className="animate-spin" />}
            {deleting ? 'Deleting…' : `Delete ${selectedCount} item${selectedCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
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
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-all shadow-sm"
      >
        <Icon name="Plus" size={15} />
        Add
        <Icon name="ChevronDown" size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-48 bg-card border border-border rounded-xl shadow-lg z-30 overflow-hidden">
          {!isRoot && (
            <>
              <button
                onClick={() => { setOpen(false); onAddFolder(); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
              >
                <Icon name="FolderPlus" size={15} className="text-primary" />
                Add Sub-folder
              </button>
              <div className="h-px bg-border mx-3" />
            </>
          )}
          <button
            onClick={() => { setOpen(false); onAddItem(); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
          >
            <Icon name="PackagePlus" size={15} className="text-primary" />
            Add Item
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Quick Quantity Control ────────────────────────────────────────────────────
const QuickQtyControl = ({ item, onUpdate, locationQtys, setLocationQtys, showLocations, onToggleLocations }) => {
  const [loading, setLoading] = useState(false);
  const [localQty, setLocalQty] = useState(item?.quantity ?? item?.totalQty ?? 0);
  const pendingUpdateRef = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const stockLocations = item?.stockLocations || [];
  const isMultiLocation = stockLocations?.length > 1;

  const displayQty = isMultiLocation && locationQtys?.length > 0
    ? locationQtys?.reduce((sum, loc) => sum + (loc?.qty || 0), 0)
    : localQty;

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

  const handleButtonClick = (e, delta) => {
    e?.stopPropagation();
    if (isMultiLocation) {
      onToggleLocations?.();
    } else {
      adjustSingle(delta);
    }
  };

  return (
    <div className="relative flex items-center gap-1">
      <button
        onClick={(e) => handleButtonClick(e, -1)}
        disabled={loading || (!isMultiLocation && localQty <= 0)}
        className={`w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-40 transition-colors ${isMultiLocation ? 'bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary' : 'bg-red-100 text-red-600 hover:bg-red-200'}`}
      >
        <Icon name={isMultiLocation ? (showLocations ? 'ChevronUp' : 'ChevronDown') : 'Minus'} size={12} />
      </button>
      <span className="w-10 text-center text-sm font-semibold text-foreground">{displayQty}</span>
      <button
        onClick={(e) => handleButtonClick(e, 1)}
        disabled={loading || (!isMultiLocation && false)}
        className={`w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-40 transition-colors ${isMultiLocation ? 'bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary' : 'bg-green-100 text-green-600 hover:bg-green-200'}`}
      >
        <Icon name={isMultiLocation ? (showLocations ? 'ChevronUp' : 'ChevronDown') : 'Plus'} size={12} />
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
    return { position: 'fixed', top, left, zIndex: 9999, width: 296 };
  })();

  const filteredIcons = FOLDER_ICON_PALETTE?.filter(n => !iconSearch || n?.toLowerCase()?.includes(iconSearch?.toLowerCase()));

  return (
    <div ref={popoverRef} style={style} className="bg-card border border-border rounded-2xl shadow-xl overflow-hidden">
      {/* Header tabs */}
      <div className="flex border-b border-border">
        {[{ id: 'icon', label: 'Icon' }, { id: 'color', label: 'Colour' }]?.map(t => (
          <button
            key={t?.id}
            onClick={() => setTab(t?.id)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
              tab === t?.id ? 'text-primary border-b-2 border-primary bg-primary/5' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t?.label}
          </button>
        ))}
        <button onClick={onClose} className="px-3 text-muted-foreground hover:text-foreground">
          <Icon name="X" size={14} />
        </button>
      </div>

      <div className="p-3">
        {/* Preview strip */}
        <div className="flex items-center gap-2 mb-3 p-2 bg-muted/40 rounded-xl">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={selectedColor ? { backgroundColor: selectedColor + '25', border: `1.5px solid ${selectedColor}50` } : {}}
          >
            <Icon
              name={selectedIcon || 'Package'}
              size={18}
              style={selectedColor ? { color: selectedColor } : {}}
              className={!selectedColor ? 'text-muted-foreground' : ''}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{item?.name}</p>
            <p className="text-xs text-muted-foreground">{selectedIcon || 'Default icon'}{selectedColor ? ` · ${selectedColor}` : ''}</p>
          </div>
          {(selectedIcon || selectedColor) && (
            <button
              onClick={() => { setSelectedIcon(null); setSelectedColor(null); handleSave(null, null); }}
              className="text-xs text-muted-foreground hover:text-foreground underline flex-shrink-0"
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
              className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30 text-foreground mb-2"
            />
            <div className="grid grid-cols-8 gap-1 max-h-36 overflow-y-auto">
              {filteredIcons?.map(iconName => (
                <button
                  key={iconName}
                  title={iconName}
                  onClick={() => { setSelectedIcon(iconName); handleSave(iconName, selectedColor); }}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    selectedIcon === iconName ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon name={iconName} size={14} />
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'color' && (
          <>
            {/* Preset swatches */}
            <div className="grid grid-cols-5 gap-2 mb-3">
              {ITEM_COLOR_PRESETS?.map(hex => (
                <button
                  key={hex}
                  onClick={() => { setSelectedColor(hex); handleSave(selectedIcon, hex); }}
                  className="w-full aspect-square rounded-lg transition-transform hover:scale-110 flex-shrink-0"
                  style={{
                    backgroundColor: hex,
                    outline: selectedColor === hex ? `2.5px solid ${hex}` : '2.5px solid transparent',
                    outlineOffset: 2,
                  }}
                  title={hex}
                />
              ))}
            </div>
            {/* Full spectrum */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground flex-shrink-0">Custom</label>
              <input
                type="color"
                value={selectedColor || '#4A90E2'}
                onChange={e => setSelectedColor(e?.target?.value)}
                onBlur={e => handleSave(selectedIcon, e?.target?.value)}
                className="h-8 flex-1 rounded-lg border border-border cursor-pointer bg-background"
                style={{ padding: '2px 4px' }}
              />
              {selectedColor && (
                <span className="text-xs font-mono text-muted-foreground">{selectedColor}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Item Row (List View) ──────────────────────────────────────────────────────
const ItemRow = ({ item: itemProp, canEdit, onEdit, onDelete, onUpdate, onQuickView, isSelected, onToggleSelect, selectionMode = false, onAppearanceChange }) => {
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

  // Derive category label from taxonomy names
  const categoryLabel = item?.l3Name || item?.l2Name || item?.l1Name || null;
  // Format expiry date — check both camelCase and snake_case field names
  const rawExpiry = item?.expiryDate || item?.expiry_date || null;
  const expiryLabel = rawExpiry ? (() => {
    try { return new Date(rawExpiry)?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return rawExpiry; }
  })() : null;

  const accentColor = item?.color || null;

  return (
    <>
    <div
      className={`flex flex-col bg-card rounded-xl border transition-all group overflow-hidden ${isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}
      style={accentColor ? { borderLeftColor: accentColor, borderLeftWidth: 3 } : {}}
    >
      <div className="flex items-center gap-3 p-3">
        <button
          onClick={(e) => { e?.stopPropagation(); onToggleSelect?.(item); }}
          className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
            isSelected
              ? 'bg-primary border-primary' :'bg-background border-border hover:border-primary/60'
          }`}
          title={isSelected ? 'Deselect' : 'Select'}
        >
          {isSelected && <Icon name="Check" size={11} className="text-primary-foreground" />}
        </button>

        {/* Colour/icon swatch — click to customise */}
        <button
          onClick={(e) => { e?.stopPropagation(); setAppearanceAnchor(e?.currentTarget?.getBoundingClientRect()); }}
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:scale-110 border"
          style={accentColor
            ? { backgroundColor: accentColor + '25', borderColor: accentColor + '60', color: accentColor }
            : { backgroundColor: 'var(--color-muted)', borderColor: 'var(--color-border)', color: 'var(--color-muted-foreground)' }
          }
          title="Customise icon & colour"
        >
          <Icon name={item?.icon || 'Palette'} size={13} />
        </button>

        {/* Item info: Name | Category | Code | Expiry */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-medium text-foreground text-sm truncate cursor-pointer hover:text-primary transition-colors"
              onClick={(e) => { e?.stopPropagation(); onQuickView?.(item); }}
              title="Quick view"
            >{item?.name}</span>
            {isLow && <span className="px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded-full font-medium">Low</span>}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {categoryLabel && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Icon name="Tag" size={10} className="shrink-0" />
                <span className="truncate max-w-[120px]">{categoryLabel}</span>
              </span>
            )}
            {item?.cargoItemId && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="text-muted-foreground/50">|</span>
                <Icon name="Hash" size={10} className="shrink-0" />
                <span className="font-mono">{item?.cargoItemId}</span>
              </span>
            )}
            {expiryLabel && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="text-muted-foreground/50">|</span>
                <Icon name="Calendar" size={10} className="shrink-0" />
                <span>{expiryLabel}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <QuickQtyControl item={item} onUpdate={onUpdate} locationQtys={locationQtys} setLocationQtys={setLocationQtys} showLocations={showLocations} onToggleLocations={() => setShowLocations(v => !v)} />
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
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={(e) => { e?.stopPropagation(); onEdit?.(item); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                <Icon name="Pencil" size={14} />
              </button>
              <button onClick={(e) => { e?.stopPropagation(); onDelete?.(item); }} className="p-1.5 rounded-lg hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors">
                <Icon name="Trash2" size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
      {isMultiLocation && showLocations && locationQtys?.length > 0 && (
        <div className="border-t border-border px-3 pb-3 pt-2 flex flex-col gap-1.5">
          {locationQtys?.map((loc, idx) => {
            const label = getLastLocationSegment(loc) || `Location ${idx + 1}`;
            const hasPartial = loc?.partial != null;
            return (
              <div key={idx} className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground truncate flex-1">{label}</span>
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
                    className="w-6 h-6 rounded-full bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center disabled:opacity-40 transition-colors"
                  >
                    <Icon name="Minus" size={10} />
                  </button>
                  <span className="min-w-[28px] text-center text-xs font-semibold text-foreground">
                    {hasPartial ? ((loc?.qty || 0) + loc.partial).toFixed(2).replace(/\.?0+$/, '') : (loc?.qty || 0)}
                  </span>
                  <button
                    onClick={(e) => { e?.stopPropagation(); const updated = locationQtys?.map((l, i) => i === idx ? { ...l, qty: (l?.qty || 0) + 1 } : l); setLocationQtys(updated); pendingLocUpdateRef.current = true; updateItemStockLocations(item?.id, updated); }}
                    className="w-6 h-6 rounded-full bg-green-100 text-green-600 hover:bg-green-200 flex items-center justify-center transition-colors"
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
            // Multi-location: adjust this location qty -1, mark partial, clear others
            const updated = locationQtys?.map((l, i) => {
              const { partial: _p, ...rest } = l;
              if (i === idx) return { ...rest, qty: Math.max(0, (l?.qty || 0) - 1), partial: fraction };
              return rest;
            });
            setLocationQtys(updated);
            updateItemStockLocations(item?.id, updated);
          }
          await updatePartialBottle(item?.id, fraction);
          setItem(prev => ({ ...prev, partialBottle: fraction }));
          onUpdate?.();
        }}
        onClear={async () => {
          const idx = bottleModalLocIdx;
          setBottleModalLocIdx(null);
          if (idx >= 0) {
            // Restore qty +1 for location that had the partial
            const updated = locationQtys?.map((l, i) => {
              if (i === idx && l?.partial != null) {
                const { partial: _p, ...rest } = l;
                return { ...rest, qty: (l?.qty || 0) + 1 };
              }
              const { partial: _p, ...rest } = l;
              return rest;
            });
            setLocationQtys(updated);
            updateItemStockLocations(item?.id, updated);
          }
          await updatePartialBottle(item?.id, null);
          setItem(prev => ({ ...prev, partialBottle: null }));
          onUpdate?.();
        }}
        onClose={() => setBottleModalLocIdx(null)}
      />
    )}
    </>
  );
};

// ─── Item Grid Card (Grid View) ────────────────────────────────────────────────
const ItemGridCard = ({ item: itemProp, canEdit, onEdit, onDelete, onUpdate, onQuickView, isSelected, onToggleSelect, selectionMode = false, onAppearanceChange }) => {
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

  const imageUrl = item?.imageUrl && !item?.imageUrl?.startsWith('blob:') ? item?.imageUrl : null;
  const accentColor = item?.color || null;
  const accentIcon = item?.icon || null;

  // Derive category label from taxonomy names
  const categoryLabel = item?.l3Name || item?.l2Name || item?.l1Name || null;
  // Format expiry date — check both camelCase and snake_case field names
  const rawExpiry = item?.expiryDate || item?.expiry_date || null;
  const expiryLabel = rawExpiry ? (() => {
    try { return new Date(rawExpiry)?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return rawExpiry; }
  })() : null;

  return (
    <>
    <div
      className={`bg-card rounded-2xl border transition-all overflow-hidden group flex flex-col ${isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/30'}`}
      style={accentColor ? { borderTopColor: accentColor, borderTopWidth: 3 } : {}}
    >
      <div
        className="relative h-28 flex items-center justify-center overflow-hidden cursor-pointer bg-muted"
        style={accentColor && !imageUrl ? { backgroundColor: accentColor + '22' } : {}}
        onClick={() => onQuickView?.(item)}
        title="Quick view"
      >
        {imageUrl ? (
          <img src={imageUrl} alt={item?.name} className="w-full h-full object-cover" />
        ) : (
          <Icon
            name={accentIcon || 'Package'}
            size={32}
            style={accentColor ? { color: accentColor } : {}}
            className={!accentColor ? 'text-muted-foreground/30' : ''}
          />
        )}
        {/* Appearance edit button */}
        <button
          onClick={(e) => { e?.stopPropagation(); setAppearanceAnchor(e?.currentTarget?.getBoundingClientRect()); }}
          className="absolute bottom-2 right-2 w-7 h-7 rounded-lg bg-background/90 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-all opacity-0 group-hover:opacity-100"
          title="Customise icon & colour"
        >
          <Icon name="Palette" size={12} />
        </button>
        {isLow && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-xs font-bold shadow">Low</div>
        )}
        <button
          onClick={(e) => { e?.stopPropagation(); onToggleSelect?.(item); }}
          className={`absolute top-2 left-2 w-6 h-6 rounded border-2 flex items-center justify-center transition-all shadow ${
            isSelected
              ? 'bg-primary border-primary' :'bg-black/20 border-white/80'
          }`}
          title={isSelected ? 'Deselect' : 'Select'}
        >
          {isSelected && <Icon name="Check" size={11} className="text-white" />}
        </button>
        {canEdit && (
          <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e?.stopPropagation(); onEdit?.(item); }}
              className="w-7 h-7 rounded-lg bg-background/90 border border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon name="Pencil" size={12} />
            </button>
            <button
              onClick={(e) => { e?.stopPropagation(); onDelete?.(item); }}
              className="w-7 h-7 rounded-lg bg-background/90 border border-border flex items-center justify-center text-muted-foreground hover:text-red-600 transition-colors"
            >
              <Icon name="Trash2" size={12} />
            </button>
          </div>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1.5 flex-1">
        {/* Item Name */}
        <p
          className="font-semibold text-foreground text-sm leading-tight line-clamp-2 cursor-pointer hover:text-primary transition-colors"
          onClick={() => onQuickView?.(item)}
          title="Quick view"
        >{item?.name}</p>

        {/* Category */}
        {categoryLabel && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Icon name="Tag" size={10} className="shrink-0" />
            <span className="truncate">{categoryLabel}</span>
          </div>
        )}

        {/* Code */}
        {item?.cargoItemId && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Icon name="Hash" size={10} className="shrink-0" />
            <span className="font-mono truncate">{item?.cargoItemId}</span>
          </div>
        )}

        {/* Expiry Date */}
        {expiryLabel && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Icon name="Calendar" size={10} className="shrink-0" />
            <span>{expiryLabel}</span>
          </div>
        )}

        {/* Quantity control */}
        <div className="flex items-center justify-between mt-auto pt-1 border-t border-border/50">
          <span className="text-xs text-muted-foreground">Qty</span>
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
            <QuickQtyControl item={item} onUpdate={onUpdate} locationQtys={locationQtys} setLocationQtys={setLocationQtys} showLocations={showLocations} onToggleLocations={() => setShowLocations(v => !v)} />
          </div>
        </div>
        {isMultiLocation && showLocations && locationQtys?.length > 0 && (
          <div className="border-t border-border pt-2 flex flex-col gap-1.5">
            {locationQtys?.map((loc, idx) => {
              const label = getLastLocationSegment(loc) || `Location ${idx + 1}`;
              const hasPartial = loc?.partial != null;
              return (
                <div key={idx} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground truncate flex-1">{label}</span>
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
                      className="w-6 h-6 rounded-full bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center disabled:opacity-40 transition-colors"
                    >
                      <Icon name="Minus" size={10} />
                    </button>
                    <span className="min-w-[28px] text-center text-xs font-semibold text-foreground">
                      {hasPartial ? ((loc?.qty || 0) + loc.partial).toFixed(2).replace(/\.?0+$/, '') : (loc?.qty || 0)}
                    </span>
                    <button
                      onClick={(e) => { e?.stopPropagation(); const updated = locationQtys?.map((l, i) => i === idx ? { ...l, qty: (l?.qty || 0) + 1 } : l); setLocationQtys(updated); pendingLocUpdateRef.current = true; updateItemStockLocations(item?.id, updated); }}
                      className="w-6 h-6 rounded-full bg-green-100 text-green-600 hover:bg-green-200 flex items-center justify-center transition-colors"
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
              const { partial: _p, ...rest } = l;
              if (i === idx) return { ...rest, qty: Math.max(0, (l?.qty || 0) - 1), partial: fraction };
              return rest;
            });
            setLocationQtys(updated);
            updateItemStockLocations(item?.id, updated);
          }
          await updatePartialBottle(item?.id, fraction);
          setItem(prev => ({ ...prev, partialBottle: fraction }));
          onUpdate?.();
        }}
        onClear={async () => {
          const idx = bottleModalLocIdx;
          setBottleModalLocIdx(null);
          if (idx >= 0) {
            const updated = locationQtys?.map((l, i) => {
              if (i === idx && l?.partial != null) {
                const { partial: _p, ...rest } = l;
                return { ...rest, qty: (l?.qty || 0) + 1 };
              }
              const { partial: _p, ...rest } = l;
              return rest;
            });
            setLocationQtys(updated);
            updateItemStockLocations(item?.id, updated);
          }
          await updatePartialBottle(item?.id, null);
          setItem(prev => ({ ...prev, partialBottle: null }));
          onUpdate?.();
        }}
        onClose={() => setBottleModalLocIdx(null)}
      />
    )}
    </>
  );
};

// ─── Folder Card ───────────────────────────────────────────────────────────────
const FolderCard = ({ name, icon, color, itemCount, subFolderCount, depth, onClick, canEdit, onEdit, onDelete, onCog, onVisibilityChange, canMove, dragHandleProps, isDragging, isFolderDropTarget, isDropTargetReady, showCog }) => (
  <div
    onClick={onClick}
    className={[
      'bg-card rounded-2xl border transition-all cursor-pointer p-5 group relative',
      isDragging ? 'opacity-40 shadow-xl' : '',
      isFolderDropTarget && isDropTargetReady
        ? 'border-primary shadow-lg shadow-primary/20 bg-primary/5 scale-[1.02]'
        : isFolderDropTarget
        ? 'border-primary/50 bg-primary/3' : 'border-border hover:border-primary/40 hover:shadow-md',
    ]?.join(' ')}
  >
    {isFolderDropTarget && isDropTargetReady && (
      <div className="absolute inset-0 rounded-2xl border-2 border-primary animate-pulse pointer-events-none" />
    )}
    <div className="flex items-start justify-between mb-3">
      <div className="flex items-center gap-2">
        {canEdit && dragHandleProps && (
          <div
            {...dragHandleProps}
            onClick={(e) => e?.stopPropagation()}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted cursor-grab active:cursor-grabbing transition-colors flex-shrink-0"
            title="Drag to reorder or hold over a folder to move inside"
          >
            <Icon name="GripVertical" size={14} />
          </div>
        )}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={color
            ? { backgroundColor: color + '22', border: `1.5px solid ${color}44` }
            : depth === 0
              ? { backgroundColor: 'var(--color-primary-10, rgba(74,144,226,0.1))' }
              : { backgroundColor: 'var(--color-muted)' }
          }
        >
          <Icon
            name={icon || (depth === 0 ? 'MapPin' : 'FolderOpen')}
            size={20}
            style={color ? { color } : {}}
            className={!color ? (depth === 0 ? 'text-primary' : 'text-muted-foreground') : ''}
          />
        </div>
      </div>
      <div className="flex items-center gap-1">
        {isFolderDropTarget && isDropTargetReady && (
          <div className="flex items-center gap-1 px-2 py-1 bg-primary text-primary-foreground rounded-lg text-xs font-medium">
            <Icon name="FolderInput" size={12} />
            <span>Move inside</span>
          </div>
        )}
        {showCog && onCog && !isFolderDropTarget && (
          <button
            onClick={(e) => { e?.stopPropagation(); onCog?.(); }}
            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
            title="Folder settings"
          >
            <Icon name="Settings" size={14} />
          </button>
        )}
        {canEdit && onEdit && !showCog && !isFolderDropTarget && (
          <button
            onClick={(e) => { e?.stopPropagation(); onEdit?.(); }}
            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
            title="Rename folder"
          >
            <Icon name="Pencil" size={14} />
          </button>
        )}
        {canEdit && onDelete && !showCog && !isFolderDropTarget && (
          <button
            onClick={(e) => { e?.stopPropagation(); onDelete?.(); }}
            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-all"
            title="Delete folder"
          >
            <Icon name="Trash2" size={14} />
          </button>
        )}
        {onClick && !isFolderDropTarget && <Icon name="ChevronRight" size={18} className="text-muted-foreground group-hover:text-primary transition-colors" />}
      </div>
    </div>
    <h3 className="font-semibold text-foreground text-base mb-1">{name}</h3>
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span>{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
      {subFolderCount > 0 && <span>· {subFolderCount} folder{subFolderCount !== 1 ? 's' : ''}</span>}
    </div>
  </div>
);

// ─── Sortable Folder Card Wrapper ─────────────────────────────────────────────
const SortableFolderCard = ({ id, name, icon, color, itemCount, subFolderCount, depth, onClick, canEdit, onEdit, onDelete, onCog, showCog, folderDropTargetId, folderDropTargetReady }) => {
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
        onDelete={onDelete}
        onCog={onCog}
        showCog={showCog}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
        isFolderDropTarget={isFolderDropTarget}
        isDropTargetReady={isDropTargetReady}
        onVisibilityChange={undefined}
        canMove={undefined}
      />
    </div>
  );
};

// ─── Delete Folder Confirmation Modal ────────────────────────────────────────
const DeleteFolderModal = ({ folderName, onClose, onConfirm }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
    <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Delete Folder</h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
          <Icon name="X" size={18} />
        </button>
      </div>
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
          <Icon name="Trash2" size={18} className="text-red-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground mb-1">Delete folder and all its contents?</p>
          <p className="text-sm text-muted-foreground">"<span className="font-medium text-foreground">{folderName}</span>" and all its sub-folders and items will be permanently removed.</p>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted rounded-xl hover:bg-muted/80 transition-colors">Cancel</button>
        <button onClick={onConfirm} className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors">Delete</button>
      </div>
    </div>
  </div>
);

// ─── Archive Folder Confirmation Modal ────────────────────────────────────────
const ArchiveFolderModal = ({ folderName, onClose, onConfirm }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
    <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Archive Folder</h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
          <Icon name="X" size={18} />
        </button>
      </div>
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Icon name="Archive" size={18} className="text-amber-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground mb-1">Archive this folder?</p>
          <p className="text-sm text-muted-foreground">"<span className="font-medium text-foreground">{folderName}</span>" will be hidden from normal view. All data is preserved.</p>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted rounded-xl hover:bg-muted/80 transition-colors">Cancel</button>
        <button onClick={onConfirm} className="px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-xl hover:bg-amber-700 transition-colors">Archive</button>
      </div>
    </div>
  </div>
);

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

  const handleModalClose = () => {
    setShowAddModal(false);
    setEditingItem(null);
    loadData();
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

  const handleDeleteFolder = async () => {
    const folderToDelete = deletingFolderName;
    setDeletingFolderName(null);
    const success = await deleteFolderFromDB(pathSegments, folderToDelete);
    if (!success) {
      console.error('[Inventory] handleDeleteFolder: deleteFolderFromDB returned false for', folderToDelete, 'at path', pathSegments);
      alert(`Failed to delete "${folderToDelete}". Please check your connection and try again.`);
    }
    await loadData();
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
    let result = items?.filter(item => {
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
    const success = await bulkDeleteItemsByIds(ids);
    if (success) {
      setSelectedItemIds(new Set());
      await loadData();
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

  const pageTitle = currentFolderName || 'Inventory';
  const pageSubtitle = isRoot
    ? 'Department folders'
    : pathSegments?.length === 1
    ? 'Select an area or view items' : pathSegments?.join(' → ');

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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
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
      <div className="fixed bottom-4 right-4 z-[9999] w-80 bg-gray-900 text-green-400 rounded-xl border border-green-500/40 shadow-2xl font-mono text-xs overflow-hidden">
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
    if (!over || active?.id === over?.id) {
      if (folderHoverIdRef?.current !== null) {
        clearFolderHoverTimer();
        setFolderDropTargetId(null);
        setFolderDropTargetReady(false);
      }
      return;
    }

    const overId = over?.id;
    if (folderHoverIdRef?.current === overId) return;

    clearFolderHoverTimer();
    setFolderDropTargetReady(false);
    setFolderDropTargetId(overId);
    folderHoverIdRef.current = overId;

    folderHoverTimerRef.current = setTimeout(() => {
      setFolderDropTargetReady(true);
    }, 600);
  };

  const handleDragEnd = async ({ active, over }) => {
    clearFolderHoverTimer();
    setActiveDragId(null);
    setFolderDropTargetId(null);
    setFolderDropTargetReady(false);

    if (!over || active?.id === over?.id) return;

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
    <div className="min-h-screen bg-background">
      <Header />
      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground mb-4 flex-wrap">
          <button onClick={() => navigate('/dashboard')} className="hover:text-foreground transition-colors">Dashboard</button>
          <Icon name="ChevronRight" size={14} />
          <button onClick={() => navigate('/inventory')} className="hover:text-foreground transition-colors">Inventory</button>
          {pathSegments?.map((seg, idx) => (
            <React.Fragment key={idx}>
              <Icon name="ChevronRight" size={14} />
              {idx < pathSegments?.length - 1 ? (
                <button
                  onClick={() => navigate(segmentsToUrl(pathSegments?.slice(0, idx + 1)))}
                  className="hover:text-foreground transition-colors"
                >
                  {seg}
                </button>
              ) : (
                <span className="text-foreground font-medium">{seg}</span>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Header Row */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{pageTitle}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">{pageSubtitle}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowExportModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-card text-foreground border border-border rounded-xl hover:bg-muted transition-all shadow-sm"
              title="Export Inventory"
            >
              <Icon name="Download" size={15} className="text-muted-foreground" />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              onClick={() => setShowAzureImportModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-primary/10 text-primary border border-primary/20 rounded-xl hover:bg-primary/20 transition-all shadow-sm"
              title="Import from PDF / Document (Azure AI)"
            >
              <Icon name="FileText" size={15} className="text-primary" />
              <span className="hidden sm:inline">Import document</span>
            </button>
            <AddDropdownButton
              isRoot={isRoot}
              onAddFolder={() => setShowAddFolderModal(true)}
              onAddItem={() => { setEditingItem(null); setShowAddModal(true); }}
            />
            {!isRoot && (
              <button
                onClick={handleBack}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground bg-card border border-border rounded-xl hover:bg-muted transition-all"
              >
                <Icon name="ArrowLeft" size={15} />
                Back
              </button>
            )}
          </div>
        </div>

        {/* Toolbar */}
        {!isRoot && (
          <div className="sticky top-16 z-30 bg-background py-2 -mx-4 px-4 mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Icon name="Search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search name, brand, tag, supplier, barcode…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e?.target?.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm bg-card border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <Icon name="X" size={14} />
                  </button>
                )}
              </div>

              <div className="relative" ref={filterPanelRef}>
                <button
                  onClick={() => { setShowFilterPanel(prev => !prev); setShowSortDropdown(false); }}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border transition-all ${
                    hasActiveFilters
                      ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-foreground border-border hover:bg-muted'
                  }`}
                >
                  <Icon name="SlidersHorizontal" size={15} />
                  <span className="hidden sm:inline">Filter</span>
                  {hasActiveFilters && (
                    <span className="w-5 h-5 rounded-full bg-white/20 text-xs flex items-center justify-center font-bold">
                      {activeFilterChips?.length}
                    </span>
                  )}
                </button>
                {showFilterPanel && (
                  <FilterPanel
                    items={items}
                    filters={activeFilters}
                    onChange={setActiveFilters}
                    onClose={() => setShowFilterPanel(false)}
                  />
                )}
              </div>

              <div className="relative" ref={sortDropdownRef}>
                <button
                  onClick={() => { setShowSortDropdown(prev => !prev); setShowFilterPanel(false); }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-card text-foreground border border-border rounded-xl hover:bg-muted transition-all"
                >
                  <Icon name="ArrowUpDown" size={15} className="text-muted-foreground" />
                  <span className="hidden sm:inline max-w-[120px] truncate">{currentSortLabel}</span>
                  <Icon name="ChevronDown" size={13} className={`text-muted-foreground transition-transform ${showSortDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showSortDropdown && (
                  <div className="absolute right-0 top-full mt-1.5 w-52 bg-card border border-border rounded-xl shadow-xl z-40 overflow-hidden py-1">
                    {SORT_OPTIONS?.map(opt => (
                      <button
                        key={opt?.value}
                        onClick={() => { setSortBy(opt?.value); setShowSortDropdown(false); }}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors text-left ${
                          sortBy === opt?.value
                            ? 'bg-primary/10 text-primary font-medium' :'text-foreground hover:bg-muted'
                        }`}
                      >
                        {opt?.label}
                        {sortBy === opt?.value && <Icon name="Check" size={14} className="text-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap bg-card border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setViewMode('list')}
                  title="List view"
                  className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                >
                  <Icon name="List" size={16} />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  title="Grid view"
                  className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                >
                  <Icon name="LayoutGrid" size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Selection toolbar */}
        {!isRoot && selectedItemIds?.size > 0 && (
          <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-xl">
            <button
              onClick={handleSelectAll}
              className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                selectedItemIds?.size === filteredItems?.length && filteredItems?.length > 0
                    ? 'bg-primary border-primary' :'border-primary'
              }`}>
                {selectedItemIds?.size === filteredItems?.length && filteredItems?.length > 0
                  ? <Icon name="Check" size={10} className="text-white" />
                  : <Icon name="Minus" size={10} className="text-primary" />
                }
              </div>
              {selectedItemIds?.size === filteredItems?.length && filteredItems?.length > 0
                ? 'Deselect All' :'Select All'
              }
            </button>
            <span className="text-sm text-foreground font-medium">
              {selectedItemIds?.size} item{selectedItemIds?.size !== 1 ? 's' : ''} selected
            </span>
            <div className="flex-1" />
            <button
              onClick={() => setShowBulkMoveModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-card border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
            >
              <Icon name="FolderInput" size={13} />
              Move
            </button>
            <button
              onClick={() => setShowBulkDeleteModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-50 border border-red-200 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
            >
              <Icon name="Trash2" size={13} />
              Delete
            </button>
            <button
              onClick={() => setShowExportModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Icon name="Download" size={13} />
              Export
            </button>
          </div>
        )}

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-2 mb-4">
            {activeFilterChips?.map((chip, idx) => (
              <button
                key={idx}
                onClick={() => removeFilterChip(chip)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-primary/10 text-primary rounded-full border border-primary/20 hover:bg-primary/20 transition-colors"
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
          <SortableContext items={filteredSubFolders} strategy={rectSortingStrategy}>
            {filteredSubFolders?.length > 0 && (
              <div>
                {!isRoot && <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Folders</h2>}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  {filteredSubFolders?.map(folderName => {
                    const folderSegments = [...pathSegments, folderName];
                    const isReadOnly = isFolderReadOnly(folderName);
                    const showCog = shouldShowCog(folderName);
                    const meta = folderTree?.[pathKey(pathSegments)]?.folderMeta?.[folderName] || {};
                    const folderIcon = meta?.icon || (isRoot ? 'MapPin' : 'FolderOpen');
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
                        onDelete={() => setDeletingFolderName(folderName)}
                        onCog={() => setCogFolderName(folderName)}
                        showCog={showCog}
                        folderDropTargetId={folderDropTargetId}
                        folderDropTargetReady={folderDropTargetReady}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </SortableContext>

          <DragOverlay>
            {activeDragId ? (
              <FolderCard
                name={activeDragId}
                icon={folderTree?.[pathKey(pathSegments)]?.folderMeta?.[activeDragId]?.icon || (isRoot ? 'MapPin' : 'FolderOpen')}
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
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Items section */}
        {filteredItems?.length > 0 && (
          <div className={filteredSubFolders?.length > 0 ? 'mt-6' : ''}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Items ({filteredItems?.length})
              </h2>
              <button
                onClick={handleSelectAll}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-primary border border-primary/30 bg-primary/5 rounded-lg hover:bg-primary/10 transition-colors"
              >
                <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                  selectedItemIds?.size === filteredItems?.length && filteredItems?.length > 0
                    ? 'bg-primary border-primary' :'border-primary'
                }`}>
                  {selectedItemIds?.size === filteredItems?.length && filteredItems?.length > 0
                    ? <Icon name="Check" size={9} className="text-white" />
                    : null
                  }
                </div>
                {selectedItemIds?.size === filteredItems?.length && filteredItems?.length > 0
                  ? 'Deselect All' :'Select All'
                }
              </button>
            </div>
            {viewMode === 'list' ? (
              <div className="flex flex-col gap-2">
                {filteredItems?.map(item => (
                  <ItemRow
                    key={item?.id}
                    item={item}
                    canEdit={canEdit}
                    onEdit={(i) => { setQuickViewItem(null); setEditingItem(i); setShowAddModal(true); }}
                    onDelete={handleDeleteItem}
                    onUpdate={loadData}
                    onQuickView={(i) => setQuickViewItem(i)}
                    isSelected={selectedItemIds?.has(item?.id)}
                    onToggleSelect={handleToggleSelectItem}
                    onAppearanceChange={handleItemAppearanceChange}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredItems?.map(item => (
                  <ItemGridCard
                    key={item?.id}
                    item={item}
                    canEdit={canEdit}
                    onEdit={(i) => { setQuickViewItem(null); setEditingItem(i); setShowAddModal(true); }}
                    onDelete={handleDeleteItem}
                    onUpdate={loadData}
                    onQuickView={(i) => setQuickViewItem(i)}
                    isSelected={selectedItemIds?.has(item?.id)}
                    onToggleSelect={handleToggleSelectItem}
                    onAppearanceChange={handleItemAppearanceChange}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!isRoot && filteredSubFolders?.length === 0 && filteredItems?.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <Icon name="Package" size={28} className="text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {searchQuery ? 'No results found' : 'This folder is empty'}
            </h3>
            <p className="text-muted-foreground text-sm mb-6">
              {searchQuery
                ? `No items or folders match "${searchQuery}"`
                : 'Add items or sub-folders to get started'}
            </p>
            {!searchQuery && canEdit && (
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowAddFolderModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-card border border-border text-foreground rounded-xl hover:bg-muted transition-colors"
                >
                  <Icon name="FolderPlus" size={15} />
                  Add Sub-folder
                </button>
                <button
                  onClick={() => { setEditingItem(null); setShowAddModal(true); }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors"
                >
                  <Icon name="Plus" size={15} />
                  Add Item
                </button>
              </div>
            )}
          </div>
        )}

        {isRoot && subFolders?.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <Icon name="FolderOpen" size={28} className="text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No department folders yet</h3>
            <p className="text-muted-foreground text-sm">Department folders will appear here once your account is set up.</p>
          </div>
        )}
      </div>
      {/* Modals */}
      {showAddModal && (
        <AddEditItemModal
          item={editingItem}
          defaultLocation={currentStorageFields?.location}
          defaultSubLocation={currentStorageFields?.subLocation}
          onClose={handleModalClose}
          onSave={handleModalClose}
        />
      )}
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
      {appearanceFolderName && (
        <EditFolderAppearanceModal
          folderName={appearanceFolderName}
          currentIcon={folderTree?.[pathKey(pathSegments)]?.folderMeta?.[appearanceFolderName]?.icon || null}
          currentColor={folderTree?.[pathKey(pathSegments)]?.folderMeta?.[appearanceFolderName]?.color || null}
          onClose={() => setAppearanceFolderName(null)}
          onSave={handleSaveAppearance}
        />
      )}
      {quickViewItem && (
        <ItemQuickViewPanel
          item={quickViewItem}
          onClose={() => setQuickViewItem(null)}
          onEdit={(i) => { setQuickViewItem(null); setEditingItem(i); setShowAddModal(true); }}
          canEdit={canEdit}
        />
      )}
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
          onImportComplete={() => { setShowAzureImportModal(false); loadData(); }}
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
      {devMode && <DevDebugPanel />}
    </div>
  );
};

export default LocationFirstInventory;

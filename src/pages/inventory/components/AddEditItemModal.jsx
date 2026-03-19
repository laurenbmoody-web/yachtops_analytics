import React, { useState, useEffect, useRef, useCallback } from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';
import { saveItem, getFolderTree, createFolder } from '../utils/inventoryStorage';
import { supabase } from '../../../lib/supabaseClient';

const UNIT_OPTIONS = ['each', 'bottle', 'box', 'kg', 'litre', 'pack', 'case', 'bag', 'roll', 'pair', 'set', 'tin', 'jar', 'tube', 'sachet', 'piece'];

const SUGGESTED_TAGS = ['drinks', 'wine', 'cleaning', 'spares', 'linen', 'snacks', 'bar', 'medical', 'food', 'tools', 'safety', 'toiletries', 'laundry'];

const WINE_KEYWORDS = ['wine', 'vino', 'champagne', 'prosecco', 'cava', 'bordeaux', 'burgundy', 'rioja', 'chianti', 'merlot', 'cabernet', 'chardonnay', 'sauvignon', 'pinot', 'shiraz', 'syrah', 'riesling', 'viognier', 'rosé', 'rose'];

const pathKey = (segments) => segments?.join('|||');
const getSubFoldersFromTree = (tree, segments) => tree?.[pathKey(segments)]?.subFolders || [];
const buildFolderPath = (segments) => segments?.join(' > ');
const emptyLocationRow = () => ({ vesselLocationId: '', quantity: 0 });

const isWineFolder = (folderDisplay) => {
  if (!folderDisplay) return false;
  const lower = folderDisplay?.toLowerCase();
  return WINE_KEYWORDS?.some(kw => lower?.includes(kw));
};

// ─── Inventory Folder Picker ──────────────────────────────────────────────────
const InventoryFolderPicker = ({ tree, onSelect, onClose, onFolderCreated }) => {
  const [pathSegments, setPathSegments] = useState([]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [localTree, setLocalTree] = useState(tree);
  const inputRef = useRef(null);

  useEffect(() => { setLocalTree(tree); }, [tree]);

  const currentFolders = getSubFoldersFromTree(localTree, pathSegments);
  const currentPath = buildFolderPath(pathSegments);
  const hasSubFolders = (folderName) => {
    const childKey = pathKey([...pathSegments, folderName]);
    return (localTree?.[childKey]?.subFolders?.length || 0) > 0;
  };

  const handleDrillDown = (folderName) => {
    setPathSegments(prev => [...prev, folderName]);
    setCreatingFolder(false);
    setNewFolderName('');
    setCreateError('');
  };

  const handleBack = () => {
    setPathSegments(prev => prev?.slice(0, -1));
    setCreatingFolder(false);
    setNewFolderName('');
    setCreateError('');
  };

  const handleSelectCurrent = () => {
    if (pathSegments?.length === 0) return;
    onSelect({ path: pathSegments, displayPath: buildFolderPath(pathSegments) });
  };

  const handleSelectFolder = (folderName) => {
    const fullPath = [...pathSegments, folderName];
    onSelect({ path: fullPath, displayPath: buildFolderPath(fullPath) });
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName?.trim();
    if (!trimmed) { setCreateError('Please enter a folder name'); return; }
    setCreating(true);
    setCreateError('');
    try {
      const ok = await createFolder(pathSegments, trimmed);
      if (!ok) { setCreateError('Failed to create folder. Please try again.'); setCreating(false); return; }
      const { getFolderTree: fetchTree } = await import('../utils/inventoryStorage');
      const newTree = await fetchTree();
      setLocalTree(newTree || localTree);
      onFolderCreated?.(newTree || localTree);
      const fullPath = [...pathSegments, trimmed];
      onSelect({ path: fullPath, displayPath: buildFolderPath(fullPath) });
    } catch (err) {
      setCreateError(err?.message || 'Failed to create folder.');
      setCreating(false);
    }
  };

  useEffect(() => {
    if (creatingFolder) setTimeout(() => inputRef?.current?.focus(), 80);
  }, [creatingFolder]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md flex flex-col" style={{ maxHeight: '80vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {pathSegments?.length > 0 && (
              <button onClick={handleBack} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                <Icon name="ChevronLeft" size={18} />
              </button>
            )}
            <h3 className="text-base font-semibold text-foreground">Select Inventory Folder</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <Icon name="X" size={18} />
          </button>
        </div>

        {pathSegments?.length > 0 && (
          <div className="px-5 py-2.5 bg-muted/40 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground font-medium truncate flex-1">
                <span className="text-foreground/60">📁</span>{' '}{currentPath}
              </p>
              <button
                onClick={handleSelectCurrent}
                className="shrink-0 px-3 py-1 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors"
              >
                Select this folder
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-2">
          {currentFolders?.length === 0 && !creatingFolder && (
            <div className="px-5 py-8 text-center">
              <Icon name="FolderOpen" size={32} className="mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">No sub-folders here yet.</p>
              {pathSegments?.length > 0 && (
                <button
                  onClick={handleSelectCurrent}
                  className="mt-3 px-4 py-2 text-sm font-semibold text-primary-foreground bg-primary rounded-xl hover:bg-primary/90 transition-colors"
                >
                  Select "{pathSegments?.[pathSegments?.length - 1]}"
                </button>
              )}
              <p className="text-xs text-muted-foreground mt-3">Or create a sub-folder below.</p>
            </div>
          )}

          {currentFolders?.map((folder) => (
            <div key={folder} className="flex items-center px-3 mx-2 rounded-xl hover:bg-muted/60 transition-colors">
              <button
                onClick={() => handleDrillDown(folder)}
                className="flex-1 flex items-center gap-3 py-3.5 text-left"
              >
                <Icon name="Folder" size={18} className="text-primary/70 shrink-0" />
                <span className="text-sm font-medium text-foreground">{folder}</span>
                {hasSubFolders(folder) && (
                  <Icon name="ChevronRight" size={14} className="text-muted-foreground ml-auto shrink-0" />
                )}
              </button>
              <button
                onClick={() => handleSelectFolder(folder)}
                className="ml-2 shrink-0 px-3 py-1.5 text-xs font-semibold text-primary bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors"
              >
                Select
              </button>
            </div>
          ))}

          {creatingFolder ? (
            <div className="mx-3 mt-2 p-3 bg-muted/40 rounded-xl border border-border">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                New folder {pathSegments?.length > 0 ? `inside "${pathSegments?.[pathSegments?.length - 1]}"` : 'at root'}
              </p>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newFolderName}
                  onChange={(e) => { setNewFolderName(e?.target?.value); setCreateError(''); }}
                  onKeyDown={(e) => { if (e?.key === 'Enter') handleCreateFolder(); if (e?.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); } }}
                  placeholder="Folder name..."
                  className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button onClick={handleCreateFolder} disabled={creating} className="px-3 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
                  {creating ? '...' : 'Create'}
                </button>
                <button onClick={() => { setCreatingFolder(false); setNewFolderName(''); setCreateError(''); }} className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted rounded-lg hover:bg-muted/80 transition-colors">
                  Cancel
                </button>
              </div>
              {createError && <p className="text-xs text-red-500 mt-1.5">{createError}</p>}
            </div>
          ) : (
            <button
              onClick={() => setCreatingFolder(true)}
              className="flex items-center gap-2 mx-3 mt-2 px-3 py-2.5 w-[calc(100%-1.5rem)] text-sm font-medium text-primary border border-dashed border-primary/40 rounded-xl hover:bg-primary/5 transition-colors"
            >
              <Icon name="FolderPlus" size={16} />
              + Create new folder here
            </button>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border shrink-0">
          <button onClick={onClose} className="w-full py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Location Picker (progressive drill-down) ─────────────────────────────────
const LocationPicker = ({ vesselLocations, selectedId, onSelect, onClose }) => {
  const decks = vesselLocations?.filter(l => l?.level === 'deck') || [];
  const zones = vesselLocations?.filter(l => l?.level === 'zone') || [];
  const spaces = vesselLocations?.filter(l => l?.level === 'space') || [];

  const [selectedDeck, setSelectedDeck] = useState(null);
  const [selectedZone, setSelectedZone] = useState(null);

  useEffect(() => {
    if (!selectedId) return;
    const loc = vesselLocations?.find(l => l?.id === selectedId);
    if (!loc) return;
    if (loc?.level === 'space') {
      const zone = zones?.find(z => z?.id === loc?.parent_id);
      if (zone) {
        const deck = decks?.find(d => d?.id === zone?.parent_id);
        setSelectedDeck(deck || null);
        setSelectedZone(zone);
      }
    } else if (loc?.level === 'zone') {
      const deck = decks?.find(d => d?.id === loc?.parent_id);
      setSelectedDeck(deck || null);
      setSelectedZone(loc);
    } else if (loc?.level === 'deck') {
      setSelectedDeck(loc);
    }
  }, [selectedId]);

  const currentZones = selectedDeck ? zones?.filter(z => z?.parent_id === selectedDeck?.id) : [];
  const currentSpaces = selectedZone ? spaces?.filter(s => s?.parent_id === selectedZone?.id) : [];

  const buildLabel = (loc) => {
    if (loc?.level === 'deck') return loc?.name;
    if (loc?.level === 'zone') {
      const deck = decks?.find(d => d?.id === loc?.parent_id);
      return deck ? `${deck?.name} › ${loc?.name}` : loc?.name;
    }
    if (loc?.level === 'space') {
      const zone = zones?.find(z => z?.id === loc?.parent_id);
      const deck = zone ? decks?.find(d => d?.id === zone?.parent_id) : null;
      if (deck && zone) return `${deck?.name} › ${zone?.name} › ${loc?.name}`;
      if (zone) return `${zone?.name} › ${loc?.name}`;
      return loc?.name;
    }
    return loc?.name;
  };

  const handleSelectDeck = (deck) => {
    const deckZones = zones?.filter(z => z?.parent_id === deck?.id);
    if (deckZones?.length === 0) { onSelect({ id: deck?.id, label: deck?.name }); }
    else { setSelectedDeck(deck); setSelectedZone(null); }
  };

  const handleSelectZone = (zone) => {
    const zoneSpaces = spaces?.filter(s => s?.parent_id === zone?.id);
    if (zoneSpaces?.length === 0) { onSelect({ id: zone?.id, label: buildLabel(zone) }); }
    else { setSelectedZone(zone); }
  };

  const handleBack = () => {
    if (selectedZone) setSelectedZone(null);
    else if (selectedDeck) setSelectedDeck(null);
  };

  const level = selectedZone ? 'space' : selectedDeck ? 'zone' : 'deck';
  const items = level === 'space' ? currentSpaces : level === 'zone' ? currentZones : decks;
  const breadcrumb = selectedZone
    ? `${selectedDeck?.name} › ${selectedZone?.name}`
    : selectedDeck ? selectedDeck?.name : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-sm flex flex-col" style={{ maxHeight: '70vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {(selectedDeck || selectedZone) && (
              <button onClick={handleBack} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                <Icon name="ChevronLeft" size={18} />
              </button>
            )}
            <h3 className="text-base font-semibold text-foreground">Select Location</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <Icon name="X" size={18} />
          </button>
        </div>

        {breadcrumb && (
          <div className="px-5 py-2.5 bg-muted/40 border-b border-border shrink-0">
            <p className="text-xs text-muted-foreground font-medium truncate">
              <span className="text-foreground/60">📍</span>{' '}{breadcrumb}
            </p>
          </div>
        )}

        <div className="px-5 pt-3 pb-1 shrink-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {level === 'deck' ? 'Deck / Area' : level === 'zone' ? 'Zone' : 'Space'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto pb-3">
          {items?.length === 0 ? (
            <div className="px-5 py-6 text-center">
              <p className="text-sm text-muted-foreground">No locations found at this level.</p>
            </div>
          ) : (
            items?.map((loc) => {
              const isSelected = loc?.id === selectedId;
              const childCount = level === 'deck'
                ? zones?.filter(z => z?.parent_id === loc?.id)?.length
                : level === 'zone'
                ? spaces?.filter(s => s?.parent_id === loc?.id)?.length
                : 0;
              return (
                <button
                  key={loc?.id}
                  onClick={() => {
                    if (level === 'deck') handleSelectDeck(loc);
                    else if (level === 'zone') handleSelectZone(loc);
                    else onSelect({ id: loc?.id, label: buildLabel(loc) });
                  }}
                  className={`w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-muted/60 transition-colors ${isSelected ? 'bg-primary/10' : ''}`}
                >
                  <Icon
                    name={level === 'deck' ? 'Layers' : level === 'zone' ? 'MapPin' : 'Box'}
                    size={16}
                    className={isSelected ? 'text-primary' : 'text-muted-foreground'}
                  />
                  <span className={`flex-1 text-sm font-medium ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                    {loc?.name}
                  </span>
                  {childCount > 0 ? (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <span className="text-xs">{childCount}</span>
                      <Icon name="ChevronRight" size={14} />
                    </div>
                  ) : isSelected ? (
                    <Icon name="Check" size={14} className="text-primary" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        <div className="px-5 py-3 border-t border-border shrink-0">
          <button onClick={onClose} className="w-full py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Quantity Stepper ─────────────────────────────────────────────────────────
const QuantityStepper = ({ value, onChange }) => {
  const num = parseFloat(value) || 0;
  return (
    <div className="flex items-center border border-border rounded-xl overflow-hidden bg-background">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, num - 1))}
        className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
      >
        <Icon name="Minus" size={14} />
      </button>
      <input
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={(e) => onChange(e?.target?.value)}
        className="w-14 text-center text-sm font-medium text-foreground bg-transparent border-none focus:outline-none py-2"
      />
      <button
        type="button"
        onClick={() => onChange(num + 1)}
        className="w-9 h-9 flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
      >
        <Icon name="Plus" size={14} />
      </button>
    </div>
  );
};

// ─── Image Upload Section ─────────────────────────────────────────────────────
const ImageUploadSection = ({ imageUrl, onImageChange }) => {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const uploadToSupabase = async (file) => {
    setUploading(true);
    setUploadError('');
    try {
      const { data: ctx } = await supabase?.rpc('get_my_context');
      const tenantId = ctx?.[0]?.tenant_id;
      const ext = file?.name?.split('.')?.pop() || 'jpg';
      const path = `inventory/${tenantId}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase?.storage
        ?.from('item-images')
        ?.upload(path, file, { upsert: true });
      if (uploadErr) {
        setUploadError('Upload failed: ' + (uploadErr?.message || 'Please try again.'));
        setUploading(false);
        return;
      }
      const { data: urlData } = supabase?.storage?.from('item-images')?.getPublicUrl(path);
      onImageChange(urlData?.publicUrl || '');
    } catch (err) {
      setUploadError('Upload failed. Please try again.');
    }
    setUploading(false);
  };

  const handleFile = (e) => {
    const file = e?.target?.files?.[0];
    if (file) uploadToSupabase(file);
    e.target.value = '';
  };

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        Item Image <span className="text-muted-foreground font-normal">(optional)</span>
      </label>

      {imageUrl ? (
        <div className="relative w-full h-40 rounded-xl overflow-hidden border border-border bg-muted/30">
          <img src={imageUrl} alt="Item preview" className="w-full h-full object-cover" />
          <div className="absolute top-2 right-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef?.current?.click()}
              className="p-1.5 bg-black/60 text-white rounded-lg hover:bg-black/80 transition-colors"
              title="Replace image"
            >
              <Icon name="RefreshCw" size={14} />
            </button>
            <button
              type="button"
              onClick={() => onImageChange('')}
              className="p-1.5 bg-black/60 text-white rounded-lg hover:bg-red-600/80 transition-colors"
              title="Remove image"
            >
              <Icon name="X" size={14} />
            </button>
          </div>
          {uploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef?.current?.click()}
            disabled={uploading}
            className="flex-1 flex flex-col items-center justify-center gap-2 py-5 border-2 border-dashed border-border rounded-xl hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <Icon name="Upload" size={20} className="text-muted-foreground" />
            )}
            <span className="text-xs text-muted-foreground">{uploading ? 'Uploading...' : 'Upload image'}</span>
          </button>
        </div>
      )}

      {uploadError && <p className="mt-1 text-xs text-amber-500">{uploadError}</p>}

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  );
};

// ─── Barcode Field ────────────────────────────────────────────────────────────
const BarcodeField = ({ value, onChange }) => {
  const cameraInputRef = useRef(null);

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        Barcode / QR Code <span className="text-muted-foreground font-normal">(optional)</span>
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e?.target?.value)}
          placeholder="Enter or scan barcode..."
          className="flex-1 px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="button"
          onClick={() => cameraInputRef?.current?.click()}
          className="px-3 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Scan with camera"
        >
          <Icon name="ScanLine" size={18} />
        </button>
      </div>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          // Camera capture for barcode — value stored as file name hint
          // Full barcode decode would require a library; for now capture triggers camera
          e.target.value = '';
        }}
        className="hidden"
      />
    </div>
  );
};

// ─── Section Divider ──────────────────────────────────────────────────────────
const SectionLabel = ({ children }) => (
  <div className="pt-1 pb-0.5">
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{children}</p>
  </div>
);

// ─── Main Modal ───────────────────────────────────────────────────────────────
const AddEditItemModal = ({ item, defaultLocation, defaultSubLocation, onClose }) => {
  const isEdit = !!item;

  const [formData, setFormData] = useState({
    name: '',
    imageUrl: '',
    description: '',
    brand: '',
    supplier: '',
    unit: 'each',
    restockLevel: '',
    defaultLocationId: '',
    expiryDate: '',
    barcode: '',
    unitCost: '',
    tags: [],
    notes: '',
    year: '',
    tastingNotes: '',
    inventoryFolderPath: defaultLocation ? (defaultSubLocation ? [defaultLocation, defaultSubLocation] : [defaultLocation]) : [],
    inventoryFolderDisplay: defaultLocation ? (defaultSubLocation ? `${defaultLocation} > ${defaultSubLocation}` : defaultLocation) : '',
  });

  const [locationRows, setLocationRows] = useState([emptyLocationRow()]);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [folderTree, setFolderTree] = useState({});
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [vesselLocations, setVesselLocations] = useState([]);
  const [vesselLocationsLoading, setVesselLocationsLoading] = useState(false);
  const [pickingLocationRowIndex, setPickingLocationRowIndex] = useState(null);
  const [pickingDefaultLocation, setPickingDefaultLocation] = useState(false);
  const [defaultLocationLabel, setDefaultLocationLabel] = useState('');

  const showWineFields = isWineFolder(formData?.inventoryFolderDisplay);

  useEffect(() => {
    const load = async () => {
      const tree = await getFolderTree();
      setFolderTree(tree || {});
      await loadVesselLocations();
    };
    load();
  }, []);

  const loadVesselLocations = async () => {
    setVesselLocationsLoading(true);
    try {
      const { data: ctx } = await supabase?.rpc('get_my_context');
      const tenantId = ctx?.[0]?.tenant_id;
      if (!tenantId) { setVesselLocationsLoading(false); return; }
      const { data, error } = await supabase
        ?.from('vessel_locations')
        ?.select('id, name, level, parent_id')
        ?.eq('tenant_id', tenantId)
        ?.eq('is_archived', false)
        ?.order('sort_order', { ascending: true })
        ?.order('name', { ascending: true });
      if (!error && data) setVesselLocations(data);
    } catch (err) {
      console.error('[AddEditItemModal] loadVesselLocations error:', err?.message);
    }
    setVesselLocationsLoading(false);
  };

  const getVesselLocationLabel = useCallback((id) => {
    if (!id) return '';
    const loc = vesselLocations?.find(l => l?.id === id);
    if (!loc) return '';
    return loc?.name;
  }, [vesselLocations]);

  // Populate form when editing
  useEffect(() => {
    if (item) {
      let folderPath = [];
      let folderDisplay = '';
      if (item?.location) {
        folderPath = item?.subLocation ? [item?.location, item?.subLocation] : [item?.location];
        folderDisplay = item?.subLocation ? `${item?.location} > ${item?.subLocation}` : item?.location;
      }

      setFormData({
        id: item?.id,
        cargoItemId: item?.cargoItemId || null,
        name: item?.name || '',
        imageUrl: item?.imageUrl || '',
        description: item?.description || '',
        brand: item?.brand || '',
        supplier: item?.supplier || '',
        unit: item?.unit || 'each',
        restockLevel: item?.restockLevel ?? '',
        defaultLocationId: item?.defaultLocationId || '',
        expiryDate: item?.expiryDate || '',
        barcode: item?.barcode || '',
        unitCost: item?.unitCost ?? '',
        tags: item?.tags || [],
        notes: item?.notes || '',
        year: item?.year ?? '',
        tastingNotes: item?.tastingNotes || '',
        inventoryFolderPath: folderPath,
        inventoryFolderDisplay: folderDisplay,
      });

      if (item?.defaultLocationId) {
        setDefaultLocationLabel(getVesselLocationLabel(item?.defaultLocationId));
      }

      const stockLocs = item?.stockLocations;
      if (Array.isArray(stockLocs) && stockLocs?.length > 0) {
        setLocationRows(stockLocs?.map(sl => ({
          vesselLocationId: sl?.vesselLocationId || sl?.locationId || '',
          quantity: sl?.quantity ?? sl?.qty ?? 0,
          locationName: sl?.locationName || sl?.location_name || sl?.name || '',
        })));
      } else {
        setLocationRows([{ vesselLocationId: '', quantity: item?.quantity ?? item?.totalQty ?? 0, locationName: '' }]);
      }
    }
  }, [item]);

  // Update default location label when vesselLocations loads
  useEffect(() => {
    if (formData?.defaultLocationId && vesselLocations?.length > 0) {
      setDefaultLocationLabel(getVesselLocationLabel(formData?.defaultLocationId));
    }
  }, [vesselLocations, formData?.defaultLocationId, getVesselLocationLabel]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: null }));
  };

  const handleFolderSelect = ({ path, displayPath }) => {
    setFormData(prev => ({
      ...prev,
      inventoryFolderPath: path,
      inventoryFolderDisplay: displayPath,
    }));
    setErrors(prev => ({ ...prev, inventoryFolder: null }));
    setShowFolderPicker(false);
  };

  const handleFolderCreated = (newTree) => setFolderTree(newTree || {});

  // Location row management
  const updateRow = (index, field, value) => {
    setLocationRows(prev => prev?.map((row, i) => i === index ? { ...row, [field]: value } : row));
  };
  const addRow = () => setLocationRows(prev => [...prev, emptyLocationRow()]);
  const removeRow = (index) => setLocationRows(prev => prev?.filter((_, i) => i !== index));

  const handleLocationPicked = ({ id, label }) => {
    if (pickingDefaultLocation) {
      setFormData(prev => ({ ...prev, defaultLocationId: id }));
      setDefaultLocationLabel(label);
      setPickingDefaultLocation(false);
    } else if (pickingLocationRowIndex !== null) {
      updateRow(pickingLocationRowIndex, 'vesselLocationId', id);
      setPickingLocationRowIndex(null);
    }
  };

  // Tags
  const toggleTag = (tag) => {
    setFormData(prev => ({
      ...prev,
      tags: prev?.tags?.includes(tag) ? prev?.tags?.filter(t => t !== tag) : [...(prev?.tags || []), tag],
    }));
  };
  const addCustomTag = () => {
    const t = tagInput?.trim()?.toLowerCase();
    if (t && !formData?.tags?.includes(t)) setFormData(prev => ({ ...prev, tags: [...(prev?.tags || []), t] }));
    setTagInput('');
  };
  const removeTag = (tag) => setFormData(prev => ({ ...prev, tags: prev?.tags?.filter(t => t !== tag) }));

  const validate = () => {
    const errs = {};
    if (!formData?.name?.trim()) errs.name = 'Item name is required';
    setErrors(errs);
    return Object.keys(errs)?.length === 0;
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const stockLocations = locationRows
        ?.filter(row => row?.vesselLocationId || row?.quantity > 0)
        ?.map(row => {
          const label = getVesselLocationLabel(row?.vesselLocationId) || row?.locationName || '';
          return {
            vesselLocationId: row?.vesselLocationId || '',
            locationId: row?.vesselLocationId || '',
            locationName: label,
            location_name: label,
            subLocation: label,
            quantity: parseFloat(row?.quantity) || 0,
            qty: parseFloat(row?.quantity) || 0,
          };
        });

      const totalQty = stockLocations?.reduce((sum, sl) => sum + (sl?.quantity || 0), 0);
      let folderPath = formData?.inventoryFolderPath || [];
      const location = folderPath?.[0] || '';
      const subLocation = folderPath?.slice(1)?.join(' > ') || '';

      // ── Department-folder guard ───────────────────────────────────────────
      // Items must never be saved directly into a department-level folder.
      // A valid folder path must have at least 2 segments (department > subfolder).
      if (location && !subLocation) {
        setErrors({ submit: `Items cannot be saved directly in department folders. "${location}" is a top-level department folder. Please select a subfolder within it.` });
        setSaving(false);
        return;
      }
      // ─────────────────────────────────────────────────────────────────────

      const payload = {
        ...formData,
        location,
        subLocation,
        quantity: stockLocations?.[0]?.quantity ?? 0,
        totalQty,
        stockLocations,
        restockLevel: formData?.restockLevel !== '' ? parseFloat(formData?.restockLevel) : null,
        unitCost: formData?.unitCost !== '' ? parseFloat(formData?.unitCost) : null,
        year: formData?.year !== '' ? parseInt(formData?.year, 10) : null,
      };

      const result = await saveItem(payload);
      if (result) {
        onClose?.();
      } else {
        setErrors({ submit: 'Failed to save item. Please try again.' });
      }
    } catch (err) {
      setErrors({ submit: err?.message || 'An error occurred.' });
    } finally {
      setSaving(false);
    }
  };

  const hasMultipleRows = locationRows?.length > 1;
  const showLocationPicker = pickingLocationRowIndex !== null || pickingDefaultLocation;
  const pickerSelectedId = pickingDefaultLocation
    ? formData?.defaultLocationId
    : locationRows?.[pickingLocationRowIndex]?.vesselLocationId;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-card rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
            <h2 className="text-xl font-bold text-foreground">{isEdit ? 'Edit Item' : 'Add Item'}</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
              <Icon name="X" size={22} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">

            {/* ── Item Name ── */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Item Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData?.name}
                onChange={(e) => handleChange('name', e?.target?.value)}
                placeholder="e.g. Tignanello"
                className={`w-full px-3 py-2.5 text-sm bg-background border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                  errors?.name ? 'border-red-400' : 'border-border'
                }`}
              />
              {errors?.name && <p className="mt-1 text-xs text-red-500">{errors?.name}</p>}
            </div>

            {/* ── Item Image ── */}
            <ImageUploadSection
              imageUrl={formData?.imageUrl}
              onImageChange={(url) => handleChange('imageUrl', url)}
            />

            {/* ── Description ── */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <textarea
                value={formData?.description}
                onChange={(e) => handleChange('description', e?.target?.value)}
                placeholder="e.g. Sparkling mineral water 500ml glass bottles"
                rows={2}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>

            {/* ── Brand + Supplier ── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Brand <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={formData?.brand}
                  onChange={(e) => handleChange('brand', e?.target?.value)}
                  placeholder="e.g. San Pellegrino"
                  className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Supplier <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={formData?.supplier}
                  onChange={(e) => handleChange('supplier', e?.target?.value)}
                  placeholder="e.g. Metro Cash & Carry"
                  className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            {/* ── Inventory Folder ── */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Inventory Folder
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">(category in inventory tree)</span>
              </label>
              <button
                type="button"
                onClick={() => setShowFolderPicker(true)}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm bg-background border rounded-xl hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors text-left ${
                  errors?.inventoryFolder ? 'border-red-400' : 'border-border'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon name="Folder" size={16} className="text-primary/70 shrink-0" />
                  {formData?.inventoryFolderDisplay ? (
                    <span className="text-foreground truncate">{formData?.inventoryFolderDisplay}</span>
                  ) : (
                    <span className="text-muted-foreground">Select folder...</span>
                  )}
                </div>
                <Icon name="ChevronRight" size={16} className="text-muted-foreground shrink-0" />
              </button>
              {errors?.inventoryFolder && <p className="mt-1 text-xs text-red-500">{errors?.inventoryFolder}</p>}
            </div>

            {/* ── Year / Vintage ── */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Year / Vintage
              </label>
              <input
                type="number"
                value={formData?.year}
                onChange={(e) => handleChange('year', e?.target?.value)}
                placeholder="e.g. 2019"
                min="1900"
                max={new Date()?.getFullYear()}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* ── Wine-only fields ── */}
            {showWineFields && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">🍷</span>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Wine Details</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Tasting Notes <span className="text-muted-foreground font-normal">(Wine Only)</span>
                  </label>
                  <textarea
                    value={formData?.tastingNotes}
                    onChange={(e) => handleChange('tastingNotes', e?.target?.value)}
                    placeholder="e.g. Full-bodied red with notes of dark cherry and tobacco."
                    rows={2}
                    className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  />
                </div>
              </div>
            )}

            {/* ── Unit ── */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Unit</label>
              <div className="flex gap-2">
                <select
                  value={UNIT_OPTIONS?.includes(formData?.unit) ? formData?.unit : '__custom__'}
                  onChange={(e) => {
                    if (e?.target?.value !== '__custom__') handleChange('unit', e?.target?.value);
                  }}
                  className="flex-1 px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {UNIT_OPTIONS?.map(u => <option key={u} value={u}>{u}</option>)}
                  {!UNIT_OPTIONS?.includes(formData?.unit) && formData?.unit && (
                    <option value="__custom__">{formData?.unit}</option>
                  )}
                </select>
                <input
                  type="text"
                  value={UNIT_OPTIONS?.includes(formData?.unit) ? '' : formData?.unit}
                  onChange={(e) => handleChange('unit', e?.target?.value)}
                  placeholder="Custom unit..."
                  className="w-32 px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            {/* ── Restock Level ── */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Restock Level <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <p className="text-xs text-muted-foreground mb-1.5">Minimum quantity to keep in stock.</p>
              <input
                type="number"
                min="0"
                step="1"
                value={formData?.restockLevel}
                onChange={(e) => handleChange('restockLevel', e?.target?.value)}
                placeholder="e.g. 12"
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* ── Default Location ── */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Default Location <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <button
                type="button"
                onClick={() => setPickingDefaultLocation(true)}
                disabled={vesselLocationsLoading}
                className="w-full flex items-center justify-between px-3 py-2.5 text-sm bg-background border border-border rounded-xl hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors text-left disabled:opacity-50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon name="MapPin" size={16} className="text-muted-foreground shrink-0" />
                  {formData?.defaultLocationId ? (
                    <span className="text-foreground truncate">{defaultLocationLabel || getVesselLocationLabel(formData?.defaultLocationId)}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      {vesselLocationsLoading ? 'Loading...' : 'Select default location...'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {formData?.defaultLocationId && (
                    <button
                      type="button"
                      onClick={(e) => { e?.stopPropagation(); setFormData(prev => ({ ...prev, defaultLocationId: '' })); setDefaultLocationLabel(''); }}
                      className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Icon name="X" size={14} />
                    </button>
                  )}
                  <Icon name="ChevronRight" size={16} className="text-muted-foreground" />
                </div>
              </button>
            </div>

            {/* ── Locations with Quantity Stepper ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-foreground">
                  Locations
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">(physical storage onboard)</span>
                </label>
              </div>

              <div className="space-y-2">
                {locationRows?.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPickingLocationRowIndex(index)}
                      disabled={vesselLocationsLoading}
                      className="flex-1 min-w-0 flex items-center justify-between px-3 py-2.5 text-sm bg-background border border-border rounded-xl hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors text-left disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon name="MapPin" size={14} className="text-muted-foreground shrink-0" />
                        {row?.vesselLocationId ? (
                          <span className="text-foreground text-xs truncate">
                            {getVesselLocationLabel(row?.vesselLocationId)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            {vesselLocationsLoading ? 'Loading...' : 'Select location...'}
                          </span>
                        )}
                      </div>
                      <Icon name="ChevronRight" size={14} className="text-muted-foreground shrink-0" />
                    </button>

                    <QuantityStepper
                      value={row?.quantity}
                      onChange={(val) => updateRow(index, 'quantity', val)}
                    />

                    <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:block shrink-0 min-w-[2rem]">
                      {formData?.unit}
                    </span>

                    {hasMultipleRows && (
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        title="Remove this row"
                        className="p-2 text-muted-foreground hover:text-red-500 border border-border rounded-xl hover:border-red-300 transition-colors shrink-0"
                      >
                        <Icon name="Trash2" size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addRow}
                className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
              >
                <Icon name="Plus" size={14} />
                Add location
              </button>
            </div>

            {/* ── Expiry Date ── */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Expiry Date <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="date"
                value={formData?.expiryDate}
                onChange={(e) => handleChange('expiryDate', e?.target?.value)}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* ── Barcode / QR Code ── */}
            <BarcodeField
              value={formData?.barcode}
              onChange={(val) => handleChange('barcode', val)}
            />

            {/* ── Unit Cost ── */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Unit Cost <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData?.unitCost}
                  onChange={(e) => handleChange('unitCost', e?.target?.value)}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            {/* ── Tags ── */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Tags <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              {formData?.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {formData?.tags?.map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary rounded-full">
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-500 transition-colors">
                        <Icon name="X" size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {SUGGESTED_TAGS?.filter(t => !formData?.tags?.includes(t))?.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className="px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground rounded-full hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    + {tag}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e?.target?.value)}
                  onKeyDown={(e) => { if (e?.key === 'Enter') { e?.preventDefault(); addCustomTag(); } }}
                  placeholder="Add custom tag..."
                  className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={addCustomTag}
                  className="px-3 py-2 text-xs font-medium text-primary border border-primary/30 rounded-xl hover:bg-primary/5 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            {/* ── Notes ── */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Notes <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <textarea
                value={formData?.notes}
                onChange={(e) => handleChange('notes', e?.target?.value)}
                placeholder="Any additional notes..."
                rows={2}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>

            {/* ── Cargo Item ID (read-only, edit mode only) ── */}
            {isEdit && formData?.cargoItemId && (
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border border-border/60 rounded-xl">
                <Icon name="Hash" size={13} className="text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground">Cargo Item ID:</span>
                <span className="text-xs font-mono font-semibold text-foreground tracking-wide">{formData?.cargoItemId}</span>
              </div>
            )}

            {errors?.submit && (
              <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg">{errors?.submit}</p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
              <Button type="submit" disabled={saving} className="flex-1">
                {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Item'}
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* Inventory Folder Picker Modal */}
      {showFolderPicker && (
        <InventoryFolderPicker
          tree={folderTree}
          onSelect={handleFolderSelect}
          onClose={() => setShowFolderPicker(false)}
          onFolderCreated={handleFolderCreated}
        />
      )}

      {/* Location Picker Modal */}
      {showLocationPicker && (
        <LocationPicker
          vesselLocations={vesselLocations}
          selectedId={pickerSelectedId}
          onSelect={handleLocationPicked}
          onClose={() => {
            setPickingLocationRowIndex(null);
            setPickingDefaultLocation(false);
          }}
        />
      )}
    </>
  );
};

export default AddEditItemModal;
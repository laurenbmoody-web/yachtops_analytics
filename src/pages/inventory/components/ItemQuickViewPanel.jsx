import React, { useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';

// Resolve a location name from a loc object, falling back to vesselLocations lookup
const resolveLocationName = (loc, vesselLocations, idx) => {
  const extractLastSegment = (str) => {
    if (!str) return str;
    const parts = str?.split('›');
    return parts?.[parts?.length - 1]?.trim() || str;
  };
  if (loc?.locationName) return extractLastSegment(loc?.locationName);
  if (loc?.location_name) return extractLastSegment(loc?.location_name);
  if (loc?.name) return extractLastSegment(loc?.name);
  const locationId = loc?.vesselLocationId || loc?.locationId;
  if (locationId && Array.isArray(vesselLocations) && vesselLocations?.length > 0) {
    const found = vesselLocations?.find(vl => vl?.id === locationId);
    if (found) return extractLastSegment(found?.name);
  }
  return `Location ${idx + 1}`;
};

const ItemQuickViewPanel = ({ item, onClose, vesselLocations = [] }) => {
  const panelRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => { if (e?.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!item) return null;

  const photoSrc =
    item?.photo?.dataUrl ||
    (typeof item?.photo === 'string' ? item?.photo : null) ||
    item?.imageUrl ||
    null;

  const stockLocs = item?.stockLocations;
  const totalQuantity = (Array.isArray(stockLocs) && stockLocs?.length > 0)
    ? stockLocs?.reduce((sum, loc) => sum + (loc?.qty ?? loc?.quantity ?? 0), 0)
    : (item?.totalQty ?? item?.quantity ?? 0);

  const hasValue = (val) => {
    if (val === null || val === undefined) return false;
    if (typeof val === 'string' && val?.trim() === '') return false;
    if (Array.isArray(val) && val?.length === 0) return false;
    return true;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      if (isNaN(d?.getTime())) return dateStr;
      return d?.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const FieldRow = ({ label, value, children }) => {
    const displayValue = children !== undefined ? children : value;
    if (!hasValue(displayValue)) return null;
    return (
      <div className="py-2.5 border-b border-gray-100 last:border-b-0">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">{label}</p>
        {children ? (
          <div className="text-sm text-gray-900">{children}</div>
        ) : (
          <p className="text-sm text-gray-900">{value}</p>
        )}
      </div>
    );
  };

  const SectionHeader = ({ title }) => (
    <div className="pt-4 pb-1 mb-1">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">{title}</p>
      <div className="mt-1 h-px bg-gray-100" />
    </div>
  );

  // Gather custom_fields — support both camelCase and snake_case from DB
  const customFields = item?.customFields || item?.custom_fields || {};
  const customFieldEntries = Object.entries(customFields)?.filter(([, v]) => hasValue(v));

  // Known fields that are already shown explicitly — skip them in the "Additional Details" dump
  const KNOWN_CUSTOM_KEYS = new Set([
    'colour', 'color', 'batch_no', 'batch', 'expiry_date', 'module', 'module_colour', 'module_color',
    'bag_name', 'bag_colour', 'bag_color', 'subcategory', 'folder_path',
  ]);

  // Prettify a snake_case key to Title Case
  const prettifyKey = (key) =>
    key?.replace(/_/g, ' ')?.replace(/\b\w/g, c => c?.toUpperCase());

  // Pull specific custom fields
  const cfColour = customFields?.colour || customFields?.color;
  const cfBatchNo = customFields?.batch_no || customFields?.batch;
  const cfModule = customFields?.module;
  const cfModuleColour = customFields?.module_colour || customFields?.module_color;
  const cfBagName = customFields?.bag_name;
  const cfBagColour = customFields?.bag_colour || customFields?.bag_color;
  const cfSubcategory = customFields?.subcategory;
  const cfFolderPath = customFields?.folder_path;

  // Remaining custom fields not shown in dedicated rows
  const remainingCustomFields = customFieldEntries?.filter(([k]) => !KNOWN_CUSTOM_KEYS?.has(k));

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      {/* Slide-in Panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col overflow-hidden"
        style={{ animation: 'slideInRight 0.25s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900 truncate pr-4">{item?.name}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0"
            aria-label="Close quick view"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Image */}
          {photoSrc && (
            <div className="mb-5 rounded-xl overflow-hidden bg-gray-50 flex items-center justify-center" style={{ minHeight: 180 }}>
              <img src={photoSrc} alt={item?.name || 'Item'} className="max-w-full max-h-56 object-contain" />
            </div>
          )}

          {/* ── BASIC INFO ── */}
          <SectionHeader title="Basic Info" />
          {item?.cargoItemId && <FieldRow label="Cargo Item ID" value={item?.cargoItemId} />}
          <FieldRow label="Item Name" value={item?.name} />
          <FieldRow label="Brand" value={item?.brand} />
          <FieldRow label="Supplier" value={item?.supplier} />
          <FieldRow label="Description" value={item?.description} />
          <FieldRow label="Category / Type" value={
            (() => {
              const parts = [item?.l1Name, item?.l2Name]?.filter(Boolean);
              return parts?.length > 0 ? parts?.join(' › ') : null;
            })()
          } />
          {hasValue(cfSubcategory) && <FieldRow label="Subcategory" value={cfSubcategory} />}
          {hasValue(cfModule) && <FieldRow label="Module" value={cfModule} />}
          {hasValue(cfModuleColour) && <FieldRow label="Module Colour" value={cfModuleColour} />}
          {hasValue(cfBagName) && <FieldRow label="Bag Name" value={cfBagName} />}
          {hasValue(cfBagColour) && <FieldRow label="Bag Colour" value={cfBagColour} />}
          {hasValue(cfFolderPath) && <FieldRow label="Folder Path" value={cfFolderPath} />}

          {/* ── INVENTORY ── */}
          <SectionHeader title="Inventory" />
          <FieldRow
            label={`Quantity${Array.isArray(stockLocs) && stockLocs?.length > 1 ? ` (${stockLocs?.length} locations)` : ''}`}
            value={null}
          >
            <div>
              <span className="text-lg font-bold text-gray-900">{totalQuantity}</span>
              {item?.unit && <span className="text-sm text-gray-500 ml-1">{item?.unit}</span>}
              {Array.isArray(stockLocs) && stockLocs?.length > 1 && (
                <div className="mt-2 space-y-1.5">
                  {stockLocs?.map((loc, idx) => {
                    const locName = resolveLocationName(loc, vesselLocations, idx);
                    const locQty = loc?.qty ?? loc?.quantity ?? 0;
                    return (
                      <div key={loc?.locationId || loc?.vesselLocationId || idx} className="flex items-center justify-between text-sm">
                        <span className="text-gray-600 truncate pr-2">{locName}</span>
                        <span className="font-semibold text-gray-900 flex-shrink-0">{locQty}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </FieldRow>
          <FieldRow label="Unit" value={item?.unit} />
          <FieldRow label="Size" value={item?.size} />
          <FieldRow label="Barcode / Code" value={item?.barcode || item?.code} />
          {hasValue(item?.expiryDate || item?.expiry_date) && (
            <FieldRow label="Expiry Date" value={formatDate(item?.expiryDate || item?.expiry_date)} />
          )}
          {hasValue(cfBatchNo) && <FieldRow label="Batch Number" value={cfBatchNo} />}
          {hasValue(item?.parLevel) && item?.parLevel !== 0 && (
            <FieldRow label="Restock Level" value={`${item?.parLevel}${item?.unit ? ` ${item?.unit}` : ''}`} />
          )}
          {hasValue(item?.defaultLocation) && (
            <FieldRow label="Default Location" value={item?.defaultLocation} />
          )}

          {/* ── ADDITIONAL DETAILS ── */}
          {(
            hasValue(item?.year) ||
            hasValue(item?.tastingNotes) ||
            hasValue(item?.unitCost) ||
            hasValue(cfColour) ||
            hasValue(item?.notes) ||
            hasValue(item?.tags) ||
            remainingCustomFields?.length > 0
          ) && (
            <>
              <SectionHeader title="Additional Details" />
              {hasValue(cfColour) && <FieldRow label="Colour" value={cfColour} />}
              {hasValue(item?.year) && item?.year !== 0 && (
                <FieldRow label="Vintage Year" value={String(item?.year)} />
              )}
              <FieldRow label="Tasting Notes" value={item?.tastingNotes} />
              {hasValue(item?.unitCost) && item?.unitCost !== 0 && (
                <FieldRow label="Unit Cost" value={`$${parseFloat(item?.unitCost)?.toFixed(2)}`} />
              )}
              {/* Remaining custom fields */}
              {remainingCustomFields?.map(([key, value]) => (
                <FieldRow key={key} label={prettifyKey(key)} value={String(value)} />
              ))}
              {/* Tags */}
              {hasValue(item?.tags) && (
                <FieldRow label="Tags" value={null}>
                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                    {item?.tags?.map((tag, i) => (
                      <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </FieldRow>
              )}
              <FieldRow label="Notes" value={item?.notes} />
            </>
          )}
        </div>
      </div>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
};

export default ItemQuickViewPanel;

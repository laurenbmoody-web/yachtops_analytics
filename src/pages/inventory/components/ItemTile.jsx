import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../../utils/authStorage';

// Resolve a location name from a loc object, falling back to vesselLocations lookup
const resolveLocationName = (loc, vesselLocations, idx) => {
  // 1. Direct name keys (already normalized by rowToItem, but guard here too)
  if (loc?.locationName) return loc?.locationName;
  if (loc?.location_name) return loc?.location_name;
  if (loc?.name) return loc?.name;

  // 2. Resolve via vesselLocations using locationId / vesselLocationId
  const locationId = loc?.vesselLocationId || loc?.locationId;
  if (locationId && Array.isArray(vesselLocations) && vesselLocations?.length > 0) {
    const found = vesselLocations?.find(vl => vl?.id === locationId);
    if (found) {
      return found?.name;
    }
  }

  // 3. Last resort fallback
  return `Location ${idx + 1}`;
};

const ItemTile = ({ item, onEdit, onDelete, onQuantityChange, canEdit, canAdjustStock: canAdjustStockProp, selectionMode, isSelected, onToggleSelect, vesselLocations = [], onQuickView }) => {
  const [showLocationExpander, setShowLocationExpander] = useState(false);
  const navigate = useNavigate();
  const currentUser = getCurrentUser();

  // Fix: use (loc?.qty ?? loc?.quantity ?? 0) so items saved with only 'quantity' key are counted
  // Fix: guard empty array so reduce returning 0 falls back to item.totalQty
  const stockLocs = item?.stockLocations;
  const totalQuantity = (Array.isArray(stockLocs) && stockLocs?.length > 0)
    ? stockLocs?.reduce((sum, loc) => sum + (loc?.qty ?? loc?.quantity ?? 0), 0)
    : (item?.totalQty ?? item?.quantity ?? 0);

  const hasMultipleLocations = (item?.stockLocations?.length || 0) > 1;

  // If canAdjustStock is explicitly provided by parent (dept-aware), use it.
  // Otherwise fall back to role-based check for backward compatibility.
  const canAdjustStock = canAdjustStockProp !== undefined
    ? canAdjustStockProp
    : (canEdit || hasCommandAccess(currentUser) || hasChiefAccess(currentUser) || hasHODAccess(currentUser));

  const handleIncrement = (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!canAdjustStock) return;
    if (hasMultipleLocations) {
      setShowLocationExpander(prev => !prev);
    } else {
      const location = item?.stockLocations?.[0] || { locationId: 'loc-default', locationName: 'Main Storage', qty: 0 };
      const updatedLocations = [{ ...location, qty: (location?.qty ?? location?.quantity ?? 0) + 1 }];
      onQuantityChange?.(item?.id, updatedLocations);
    }
  };

  const handleDecrement = (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!canAdjustStock) return;
    if (hasMultipleLocations) {
      setShowLocationExpander(prev => !prev);
    } else {
      const location = item?.stockLocations?.[0] || { locationId: 'loc-default', locationName: 'Main Storage', qty: 0 };
      const newQty = Math.max(0, (location?.qty ?? location?.quantity ?? 0) - 1);
      const updatedLocations = [{ ...location, qty: newQty }];
      onQuantityChange?.(item?.id, updatedLocations);
    }
  };

  const handleLocationIncrement = (e, locIndex) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!canAdjustStock) return;
    const updatedLocations = item?.stockLocations?.map((loc, i) =>
      i === locIndex ? { ...loc, qty: (loc?.qty ?? loc?.quantity ?? 0) + 1 } : loc
    );
    onQuantityChange?.(item?.id, updatedLocations);
  };

  const handleLocationDecrement = (e, locIndex) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!canAdjustStock) return;
    const updatedLocations = item?.stockLocations?.map((loc, i) =>
      i === locIndex ? { ...loc, qty: Math.max(0, (loc?.qty ?? loc?.quantity ?? 0) - 1) } : loc
    );
    onQuantityChange?.(item?.id, updatedLocations);
  };

  const handleTileClick = (e) => {
    if (
      e?.target?.closest('button') ||
      e?.target?.closest('input[type="checkbox"]') ||
      e?.target?.closest('[data-checkbox-container]')
    ) return;
    navigate(`/inventory/item/${item?.id}`);
  };

  const handleQuickViewClick = (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    onQuickView?.(item);
  };

  const handleCheckboxClick = (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    onToggleSelect?.(item?.id);
  };

  const photoSrc =
    item?.photo?.dataUrl ||
    (typeof item?.photo === 'string' ? item?.photo : null) ||
    item?.imageUrl ||
    null;

  return (
    <div
      onClick={handleTileClick}
      className={`bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden transition-all duration-200 hover:shadow-md active:scale-[0.98] cursor-pointer flex flex-col relative ${
        isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : ''
      }`}
    >
      {/* Selection Checkbox */}
      {selectionMode && (
        <div
          data-checkbox-container
          className="absolute top-3 right-3 z-10 pointer-events-auto"
          onClick={handleCheckboxClick}
        >
          <input
            type="checkbox"
            checked={isSelected || false}
            readOnly
            className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
          />
        </div>
      )}

      {/* Title */}
      <div
        className="px-4 pt-4 pb-3 flex-shrink-0 cursor-pointer hover:text-blue-600 transition-colors"
        onClick={handleQuickViewClick}
        title="Quick view"
      >
        <h4 className="font-bold text-gray-900 text-base leading-tight line-clamp-2 hover:text-blue-600">
          {item?.name}
        </h4>
      </div>

      {/* Image */}
      <div
        className="flex-1 flex items-center justify-center px-4 py-2 min-h-[180px] cursor-pointer"
        onClick={handleQuickViewClick}
        title="Quick view"
      >
        <div className="w-full h-full flex items-center justify-center">
          {photoSrc ? (
            <img
              src={photoSrc}
              alt={item?.name || 'Item'}
              className="max-w-full max-h-full object-contain"
              loading="lazy"
            />
          ) : (
            <div className="w-16 h-16 flex items-center justify-center">
              <Icon name="Package" size={40} className="text-gray-300" />
            </div>
          )}
        </div>
      </div>

      {/* Quantity Controls */}
      <div className="px-4 pb-4 flex-shrink-0">
        <div className="flex items-center justify-center gap-4 pointer-events-auto" style={{ minHeight: '44px' }}>
          <button
            onClick={handleDecrement}
            disabled={!canAdjustStock}
            className={`flex-shrink-0 flex items-center justify-center transition-colors pointer-events-auto ${
              canAdjustStock
                ? 'text-gray-600 hover:text-gray-900 active:text-gray-700 cursor-pointer' : 'text-gray-300 cursor-not-allowed'
            }`}
            style={{ width: '44px', height: '44px' }}
            aria-label="Decrease quantity"
          >
            <Icon name="Minus" size={20} />
          </button>

          <div className="flex-shrink-0 min-w-[48px] text-center">
            <span className="text-lg font-bold text-gray-900">{totalQuantity}</span>
            <p className="text-[10px] text-gray-400 leading-none mt-0.5">total</p>
          </div>

          <button
            onClick={handleIncrement}
            disabled={!canAdjustStock}
            className={`flex-shrink-0 flex items-center justify-center transition-colors pointer-events-auto ${
              canAdjustStock
                ? 'text-gray-600 hover:text-gray-900 active:text-gray-700 cursor-pointer' : 'text-gray-300 cursor-not-allowed'
            }`}
            style={{ width: '44px', height: '44px' }}
            aria-label="Increase quantity"
          >
            <Icon name="Plus" size={20} />
          </button>
        </div>

        {/* Inline location expander for multi-location items */}
        {hasMultipleLocations && showLocationExpander && (
          <div
            className="mt-3 border-t border-gray-100 pt-3 space-y-2"
            onClick={e => e?.stopPropagation()}
          >
            {item?.stockLocations?.map((loc, idx) => (
              <div key={loc?.locationId || loc?.vesselLocationId || idx} className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-600 flex-1 truncate">
                  {resolveLocationName(loc, vesselLocations, idx)}
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={e => handleLocationDecrement(e, idx)}
                    disabled={!canAdjustStock}
                    className={`w-7 h-7 flex items-center justify-center rounded-full border transition-colors ${
                      canAdjustStock
                        ? 'border-gray-300 text-gray-600 hover:bg-gray-100 cursor-pointer' : 'border-gray-200 text-gray-300 cursor-not-allowed'
                    }`}
                    aria-label={`Decrease ${resolveLocationName(loc, vesselLocations, idx)}`}
                  >
                    <Icon name="Minus" size={12} />
                  </button>
                  <span className="text-sm font-semibold text-gray-900 w-6 text-center">
                    {loc?.qty ?? loc?.quantity ?? 0}
                  </span>
                  <button
                    onClick={e => handleLocationIncrement(e, idx)}
                    disabled={!canAdjustStock}
                    className={`w-7 h-7 flex items-center justify-center rounded-full border transition-colors ${
                      canAdjustStock
                        ? 'border-gray-300 text-gray-600 hover:bg-gray-100 cursor-pointer' : 'border-gray-200 text-gray-300 cursor-not-allowed'
                    }`}
                    aria-label={`Increase ${resolveLocationName(loc, vesselLocations, idx)}`}
                  >
                    <Icon name="Plus" size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ItemTile;
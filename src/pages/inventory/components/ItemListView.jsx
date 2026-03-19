import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { getCategoryL1ById, getCategoryL2ById } from '../utils/taxonomyStorage';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../../utils/authStorage';
import LocationStepperSheet from './LocationStepperSheet';

// Resolve a location name from a loc object, falling back to vesselLocations lookup
const resolveLocationName = (loc, vesselLocations, idx) => {
  if (loc?.locationName) return loc?.locationName;
  if (loc?.location_name) return loc?.location_name;
  if (loc?.name) return loc?.name;
  const locationId = loc?.vesselLocationId || loc?.locationId;
  if (locationId && Array.isArray(vesselLocations) && vesselLocations?.length > 0) {
    const found = vesselLocations?.find(vl => vl?.id === locationId);
    if (found) return found?.name;
  }
  return `Location ${idx + 1}`;
};

// Inline location popover for list view
const LocationPopover = ({ item, onUpdate, onClose, vesselLocations }) => {
  const [locations, setLocations] = useState(
    item?.stockLocations?.map(loc => ({ ...loc })) || []
  );
  const ref = useRef(null);

  const totalQuantity = locations?.reduce((sum, loc) => sum + (loc?.qty ?? loc?.quantity ?? 0), 0);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref?.current && !ref?.current?.contains(e?.target)) onClose?.();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleIncrement = (index) => {
    const updated = [...locations];
    updated[index] = { ...updated?.[index], qty: (updated?.[index]?.qty ?? updated?.[index]?.quantity ?? 0) + 1 };
    setLocations(updated);
    onUpdate?.(updated);
  };

  const handleDecrement = (index) => {
    const updated = [...locations];
    updated[index] = { ...updated?.[index], qty: Math.max(0, (updated?.[index]?.qty ?? updated?.[index]?.quantity ?? 0) - 1) };
    setLocations(updated);
    onUpdate?.(updated);
  };

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl min-w-[260px] overflow-hidden"
      onClick={e => e?.stopPropagation()}
    >
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">{item?.name}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <Icon name="X" size={16} />
        </button>
      </div>
      <div className="px-4 py-2 space-y-2 max-h-[240px] overflow-y-auto">
        {locations?.map((loc, index) => (
          <div key={loc?.locationId || loc?.vesselLocationId || index} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-gray-700 flex-1 truncate pr-3">
              {resolveLocationName(loc, vesselLocations, index)}
            </span>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => handleDecrement(index)}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
              >
                <Icon name="Minus" size={14} />
              </button>
              <span className="w-8 text-center text-sm font-semibold text-gray-900">{loc?.qty ?? loc?.quantity ?? 0}</span>
              <button
                onClick={() => handleIncrement(index)}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors"
              >
                <Icon name="Plus" size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
        <span className="text-xs text-gray-500 font-medium">Total</span>
        <span className="text-sm font-bold text-gray-900">{totalQuantity}</span>
      </div>
    </div>
  );
};

/**
 * Resolve the best category label for an item.
 * Priority: custom_fields.module > L2 name > L1 name > 'Uncategorized'
 */
const resolveCategoryLabel = (item) => {
  // If there's a module in custom_fields, use it
  const module = item?.customFields?.module || item?.custom_fields?.module;
  if (module) return module;
  const l2 = getCategoryL2ById(item?.l2Id);
  if (l2?.name) return l2?.name;
  const l1 = getCategoryL1ById(item?.l1Id);
  if (l1?.name) return l1?.name;
  return 'Uncategorized';
};

/**
 * Format a date string to a readable date, or return '—' if empty.
 */
const formatExpiryDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d?.getTime())) return '—';
    return d?.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
};

const ItemListView = ({ items, selectionMode, selectedItems, onToggleSelect, onQuantityChange, zoomLevel = 3, vesselLocations = [], onQuickView, sortField: sortFieldProp, sortDirection: sortDirectionProp, onSort, canAdjustStockForItem }) => {
  const navigate = useNavigate();
  const [sortFieldInternal, setSortFieldInternal] = useState('name');
  const [sortDirectionInternal, setSortDirectionInternal] = useState('asc');
  const [openPopoverId, setOpenPopoverId] = useState(null);
  const [showLocationSheetItem, setShowLocationSheetItem] = useState(null);
  const currentUser = getCurrentUser();
  // Default (global) stock adjust permission – used when no per-item function is provided
  const canAdjustStockDefault = hasCommandAccess(currentUser) || hasChiefAccess(currentUser) || hasHODAccess(currentUser);
  // Resolve whether stock can be adjusted for a given item
  const resolveCanAdjustStock = (item) =>
    canAdjustStockForItem ? canAdjustStockForItem(item) : canAdjustStockDefault;

  // Use controlled sort props if provided, otherwise fall back to internal state
  const sortField = sortFieldProp !== undefined ? sortFieldProp : sortFieldInternal;
  const sortDirection = sortDirectionProp !== undefined ? sortDirectionProp : sortDirectionInternal;

  const getRowHeight = () => {
    switch (zoomLevel) {
      case 1: return 'h-10';
      case 2: return 'h-12';
      case 3: return 'h-14';
      case 4: return 'h-16';
      case 5: return 'h-20';
      default: return 'h-14';
    }
  };

  const getImageSize = () => {
    switch (zoomLevel) {
      case 1: return 'w-8 h-8';
      case 2: return 'w-10 h-10';
      case 3: return 'w-10 h-10';
      case 4: return 'w-12 h-12';
      case 5: return 'w-14 h-14';
      default: return 'w-10 h-10';
    }
  };

  const handleSort = (field) => {
    if (onSort) {
      onSort(field);
    } else {
      if (sortFieldInternal === field) {
        setSortDirectionInternal(sortDirectionInternal === 'asc' ? 'desc' : 'asc');
      } else {
        setSortFieldInternal(field);
        setSortDirectionInternal('asc');
      }
    }
  };

  const sortedItems = [...items]?.sort((a, b) => {
    let aVal, bVal;
    switch (sortField) {
      case 'name':
        aVal = a?.name?.toLowerCase() || '';
        bVal = b?.name?.toLowerCase() || '';
        break;
      case 'category':
        aVal = resolveCategoryLabel(a)?.toLowerCase() || '';
        bVal = resolveCategoryLabel(b)?.toLowerCase() || '';
        break;
      case 'code':
        aVal = (a?.barcode || a?.code || '')?.toLowerCase();
        bVal = (b?.barcode || b?.code || '')?.toLowerCase();
        break;
      case 'expiry': {
        const aStr = a?.expiryDate || a?.expiry_date || '';
        const bStr = b?.expiryDate || b?.expiry_date || '';
        const aDate = aStr ? new Date(aStr) : null;
        const bDate = bStr ? new Date(bStr) : null;
        const aTime = aDate && !isNaN(aDate?.getTime()) ? aDate?.getTime() : null;
        const bTime = bDate && !isNaN(bDate?.getTime()) ? bDate?.getTime() : null;
        // Always push items with no expiry to the end
        if (aTime === null && bTime === null) return 0;
        if (aTime === null) return 1;
        if (bTime === null) return -1;
        return sortDirection === 'asc' ? aTime - bTime : bTime - aTime;
      }
      case 'quantity':
        aVal = (Array.isArray(a?.stockLocations) && a?.stockLocations?.length > 0)
          ? a?.stockLocations?.reduce((sum, loc) => sum + (loc?.qty ?? loc?.quantity ?? 0), 0)
          : (a?.totalQty ?? 0);
        bVal = (Array.isArray(b?.stockLocations) && b?.stockLocations?.length > 0)
          ? b?.stockLocations?.reduce((sum, loc) => sum + (loc?.qty ?? loc?.quantity ?? 0), 0)
          : (b?.totalQty ?? 0);
        break;
      default:
        return 0;
    }
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const handleRowClick = (item, e) => {
    if (
      e?.target?.closest('input[type="checkbox"]') ||
      e?.target?.closest('[data-checkbox-cell]') ||
      e?.target?.closest('[data-qty-controls]') ||
      e?.target?.closest('[data-quick-view]')
    ) return;
    navigate(`/inventory/item/${item?.id}`);
  };

  const handleCheckboxClick = (e, itemId) => {
    e?.stopPropagation();
    e?.preventDefault();
    onToggleSelect?.(itemId);
  };

  const handleDecrement = (e, item) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!resolveCanAdjustStock(item)) return;
    const hasMultiple = item?.stockLocations?.length > 1;
    if (hasMultiple) {
      setOpenPopoverId(openPopoverId === item?.id ? null : item?.id);
    } else {
      const location = item?.stockLocations?.[0] || { locationId: 'loc-default', locationName: 'Main Storage', qty: 0 };
      const newQty = Math.max(0, (location?.qty || 0) - 1);
      onQuantityChange?.(item?.id, [{ ...location, qty: newQty }]);
    }
  };

  const handleIncrement = (e, item) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!resolveCanAdjustStock(item)) return;
    const hasMultiple = item?.stockLocations?.length > 1;
    if (hasMultiple) {
      setOpenPopoverId(openPopoverId === item?.id ? null : item?.id);
    } else {
      const location = item?.stockLocations?.[0] || { locationId: 'loc-default', locationName: 'Main Storage', qty: 0 };
      onQuantityChange?.(item?.id, [{ ...location, qty: (location?.qty || 0) + 1 }]);
    }
  };

  const handlePopoverUpdate = (itemId, updatedLocations) => {
    onQuantityChange?.(itemId, updatedLocations);
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <Icon name="ChevronsUpDown" size={14} className="text-gray-400 flex-shrink-0" />;
    return sortDirection === 'asc'
      ? <Icon name="ChevronUp" size={14} className="text-blue-600 flex-shrink-0" />
      : <Icon name="ChevronDown" size={14} className="text-blue-600 flex-shrink-0" />;
  };

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {selectionMode && (
                  <th className="w-12 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={items?.length > 0 && selectedItems?.length === items?.length}
                      onChange={(e) => {
                        e?.stopPropagation();
                        if (e?.target?.checked) {
                          items?.forEach(item => onToggleSelect?.(item?.id));
                        } else {
                          selectedItems?.forEach(itemId => onToggleSelect?.(itemId));
                        }
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                )}
                {/* Item Name */}
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1.5">Item Name <SortIcon field="name" /></div>
                </th>
                {/* Category */}
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-36"
                  onClick={() => handleSort('category')}
                >
                  <div className="flex items-center gap-1.5">Category <SortIcon field="category" /></div>
                </th>
                {/* Code */}
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-32"
                  onClick={() => handleSort('code')}
                >
                  <div className="flex items-center gap-1.5">Code <SortIcon field="code" /></div>
                </th>
                {/* Expiry Date */}
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-36"
                  onClick={() => handleSort('expiry')}
                >
                  <div className="flex items-center gap-1.5">Expiry Date <SortIcon field="expiry" /></div>
                </th>
                {/* Quantity */}
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-36"
                  onClick={() => handleSort('quantity')}
                >
                  <div className="flex items-center gap-1.5">Quantity <SortIcon field="quantity" /></div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedItems?.map(item => {
                const isSelected = selectedItems?.includes(item?.id);
                const stockLocs = item?.stockLocations;
                const totalQty = (Array.isArray(stockLocs) && stockLocs?.length > 0)
                  ? stockLocs?.reduce((sum, loc) => sum + (loc?.qty ?? loc?.quantity ?? 0), 0)
                  : (item?.totalQty ?? item?.quantity ?? 0);

                const categoryLabel = resolveCategoryLabel(item);
                const codeVal = item?.barcode || item?.code || item?.customFields?.code || item?.custom_fields?.code || '';
                const expiryVal = item?.expiryDate || item?.expiry_date || item?.customFields?.expiry_date || item?.custom_fields?.expiry_date || '';

                return (
                  <tr
                    key={item?.id}
                    onClick={(e) => handleRowClick(item, e)}
                    className={`cursor-pointer transition-colors ${getRowHeight()} ${
                      isSelected ? 'bg-blue-50 ring-2 ring-inset ring-blue-500' : 'hover:bg-gray-50'
                    }`}
                  >
                    {selectionMode && (
                      <td className="px-4 py-3" data-checkbox-cell onClick={(e) => handleCheckboxClick(e, item?.id)}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                        />
                      </td>
                    )}

                    {/* Item Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          data-quick-view
                          className={`${getImageSize()} flex-shrink-0 bg-gray-100 rounded overflow-hidden cursor-pointer hover:opacity-80 transition-opacity`}
                          onClick={(e) => { e?.stopPropagation(); onQuickView?.(item); }}
                          title="Quick view"
                        >
                          {item?.photo?.dataUrl || item?.imageUrl ? (
                            <img
                              src={item?.photo?.dataUrl || item?.imageUrl}
                              alt={item?.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Icon name="Package" size={zoomLevel <= 2 ? 16 : 20} className="text-gray-400" />
                            </div>
                          )}
                        </div>
                        <span
                          data-quick-view
                          className="font-medium text-gray-900 cursor-pointer hover:text-blue-600 transition-colors"
                          onClick={(e) => { e?.stopPropagation(); onQuickView?.(item); }}
                          title="Quick view"
                        >
                          {item?.name}
                        </span>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="px-4 py-3 text-sm text-gray-600 w-36">
                      <span className="truncate block max-w-[130px]" title={categoryLabel}>{categoryLabel}</span>
                    </td>

                    {/* Code */}
                    <td className="px-4 py-3 text-sm text-gray-500 w-32">
                      {codeVal ? (
                        <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded truncate block max-w-[120px]" title={codeVal}>{codeVal}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Expiry Date */}
                    <td className="px-4 py-3 text-sm w-36">
                      {expiryVal && expiryVal !== '—' ? (
                        <span className={`text-gray-700 ${
                          new Date(expiryVal) < new Date() ? 'text-red-600 font-medium' :
                          new Date(expiryVal) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) ? 'text-amber-600 font-medium' : ''
                        }`}>
                          {formatExpiryDate(expiryVal)}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Quantity — minus | value | plus */}
                    <td className="px-4 py-3 w-36">
                      {(() => {
                        const itemCanAdjust = resolveCanAdjustStock(item);
                        return (
                          <div className="flex items-center gap-2" data-qty-controls onClick={e => e?.stopPropagation()}>
                            <button
                              onClick={(e) => handleDecrement(e, item)}
                              disabled={!itemCanAdjust}
                              className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors flex-shrink-0 ${
                                itemCanAdjust
                                  ? 'bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer' : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                              }`}
                              aria-label="Decrease quantity"
                            >
                              <Icon name="Minus" size={13} />
                            </button>
                            <div className="relative">
                              <div className="min-w-[36px] text-center">
                                <span className="text-sm font-bold text-gray-900">{totalQty}</span>
                              </div>
                              {openPopoverId === item?.id && (
                                <LocationPopover
                                  item={item}
                                  onUpdate={(updatedLocations) => handlePopoverUpdate(item?.id, updatedLocations)}
                                  onClose={() => setOpenPopoverId(null)}
                                  vesselLocations={vesselLocations}
                                />
                              )}
                            </div>
                            <button
                              onClick={(e) => handleIncrement(e, item)}
                              disabled={!itemCanAdjust}
                              className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors flex-shrink-0 ${
                                itemCanAdjust
                                  ? 'bg-blue-50 hover:bg-blue-100 text-blue-600 cursor-pointer' : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                              }`}
                              aria-label="Increase quantity"
                            >
                              <Icon name="Plus" size={13} />
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sortedItems?.length === 0 && (
          <div className="py-12 text-center text-gray-500">
            <Icon name="Package" size={48} className="mx-auto mb-3 text-gray-300" />
            <p>No items found</p>
          </div>
        )}
      </div>
      {showLocationSheetItem && (
        <LocationStepperSheet
          item={showLocationSheetItem}
          onClose={() => setShowLocationSheetItem(null)}
          onUpdate={(updatedLocations) => {
            handlePopoverUpdate(showLocationSheetItem?.id, updatedLocations);
          }}
        />
      )}
    </>
  );
};

export default ItemListView;
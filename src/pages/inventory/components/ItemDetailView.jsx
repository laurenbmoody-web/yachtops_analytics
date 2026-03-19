import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';

import AddEditItemModal from './AddEditItemModal';
import { getCategoryL1ById, getCategoryL2ById, getCategoryL3ById, getCategoryL4ById } from '../utils/taxonomyStorage';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../../utils/authStorage';

const ItemDetailView = ({ item, onClose, onUpdate }) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [imageZoomed, setImageZoomed] = useState(false);
  const navigate = useNavigate();
  const currentUser = getCurrentUser();

  // Resolve tier and department for this user
  const userTier = (
    currentUser?.permission_tier ||
    currentUser?.permissionTier ||
    currentUser?.effectiveTier ||
    currentUser?.tier ||
    ''
  )?.toUpperCase()?.trim();
  const userDept = currentUser?.department?.toUpperCase();
  const itemDept = item?.usageDepartment?.toUpperCase();

  // COMMAND: edit anything; CHIEF/HOD: only own dept; CREW/VIEW_ONLY: no edit
  const canEdit =
    userTier === 'COMMAND' ||
    ((userTier === 'CHIEF' || userTier === 'HOD') && itemDept === userDept);

  // CREW cannot delete; CHIEF/HOD only own dept; COMMAND unrestricted
  const canDelete =
    userTier === 'COMMAND' ||
    ((userTier === 'CHIEF' || userTier === 'HOD') && itemDept === userDept);

  // Get category names from IDs
  const l1Category = item?.l1Id ? getCategoryL1ById(item?.l1Id) : null;
  const l2Category = item?.l2Id ? getCategoryL2ById(item?.l2Id) : null;
  const l3Category = item?.l3Id ? getCategoryL3ById(item?.l3Id) : null;
  const l4Category = item?.l4Id ? getCategoryL4ById(item?.l4Id) : null;

  // Build category path
  const categoryPath = [
    l1Category?.name,
    l2Category?.name,
    l3Category?.name,
    l4Category?.name
  ]?.filter(Boolean)?.join(' → ');

  // Calculate total quantity
  const totalQuantity = item?.stockLocations?.reduce((sum, loc) => sum + (loc?.qty || 0), 0) || item?.totalQty || 0;

  // Determine photo source
  const photoSrc = item?.photo?.dataUrl || (typeof item?.photo === 'string' ? item?.photo : null) || item?.imageUrl || null;

  const handleEditClick = () => {
    setIsEditMode(true);
  };

  const handleEditClose = () => {
    setIsEditMode(false);
    onUpdate?.();
  };

  const handleImageClick = () => {
    if (photoSrc) {
      setImageZoomed(!imageZoomed);
    }
  };

  if (isEditMode) {
    return (
      <AddEditItemModal
        item={item}
        categoryL1Id={item?.l1Id}
        categoryL2Id={item?.l2Id}
        categoryL3Id={item?.l3Id}
        categoryL4Id={item?.l4Id}
        defaultLocation={item?.stockLocations?.[0]?.locationName || ''}
        defaultSubLocation={item?.stockLocations?.[0]?.subLocation || ''}
        onClose={handleEditClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[110] p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-20">
          <h2 className="text-2xl font-bold text-gray-900">{item?.name}</h2>
          <div className="flex items-center gap-3">
            {canEdit && (
              <button
                onClick={handleEditClick}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Edit item"
              >
                <Icon name="Pencil" size={20} className="text-gray-600" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Close"
            >
              <Icon name="X" size={20} className="text-gray-600" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Large Image */}
          <div 
            className={`relative bg-gray-50 rounded-xl overflow-hidden ${
              photoSrc ? 'cursor-zoom-in' : ''
            } ${imageZoomed ? 'fixed inset-0 z-50 bg-black bg-opacity-90 flex items-center justify-center' : 'h-80'}`}
            onClick={handleImageClick}
          >
            {photoSrc ? (
              <img
                src={photoSrc}
                alt={item?.name || 'Item'}
                className={`${
                  imageZoomed 
                    ? 'max-w-[95vw] max-h-[95vh] object-contain' 
                    : 'w-full h-full object-contain'
                }`}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Icon name="Package" size={80} className="text-gray-300" />
              </div>
            )}
            {imageZoomed && (
              <button
                className="absolute top-4 right-4 p-2 bg-white rounded-full shadow-lg"
                onClick={(e) => {
                  e?.stopPropagation();
                  setImageZoomed(false);
                }}
              >
                <Icon name="X" size={24} className="text-gray-900" />
              </button>
            )}
          </div>

          {/* Category Path */}
          {categoryPath && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Taxonomy</h3>
              <p className="text-base text-gray-900">{categoryPath}</p>
            </div>
          )}

          {/* Quantity per Location */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Stock Locations</h3>
            {item?.stockLocations && item?.stockLocations?.length > 0 ? (
              <div className="space-y-2">
                {item?.stockLocations?.map((loc, idx) => (
                  <div key={idx} className="flex items-center justify-between py-2 px-4 bg-gray-50 rounded-lg">
                    <span className="text-gray-900 font-medium">{loc?.locationName || 'Unknown Location'}</span>
                    <span className="text-lg font-bold text-gray-900">{loc?.qty || 0}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between py-3 px-4 bg-blue-50 rounded-lg border-2 border-blue-200 mt-3">
                  <span className="text-blue-900 font-bold">Total Onboard</span>
                  <span className="text-xl font-bold text-blue-900">{totalQuantity}</span>
                </div>
              </div>
            ) : (
              <p className="text-gray-500 italic">No stock locations assigned</p>
            )}
          </div>

          {/* Departments */}
          {item?.usageDepartment && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Department</h3>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                  {item?.usageDepartment}
                </span>
                {item?.maintenanceDepartment && (
                  <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                    Maintenance: {item?.maintenanceDepartment}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Restock Alert Section */}
          {(item?.restockEnabled || item?.restockLevel !== null) && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Restock Alert</h3>
              {item?.restockEnabled && item?.restockLevel !== null ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2 px-4 bg-gray-50 rounded-lg">
                    <span className="text-gray-700 font-medium">Restock Level</span>
                    <span className="text-lg font-bold text-gray-900">{item?.restockLevel}</span>
                  </div>
                  <div className="flex items-center justify-between py-2 px-4 bg-gray-50 rounded-lg">
                    <span className="text-gray-700 font-medium">Current Total Onboard</span>
                    <span className="text-lg font-bold text-gray-900">{totalQuantity}</span>
                  </div>
                  <div className={`flex items-center justify-between py-3 px-4 rounded-lg border-2 ${
                    totalQuantity > item?.restockLevel 
                      ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'
                  }`}>
                    <span className={`font-bold ${
                      totalQuantity > item?.restockLevel 
                        ? 'text-green-900' : 'text-orange-900'
                    }`}>Status</span>
                    <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                      totalQuantity > item?.restockLevel 
                        ? 'bg-green-200 text-green-900' : 'bg-orange-200 text-orange-900'
                    }`}>
                      {totalQuantity > item?.restockLevel ? 'OK' : 'Low'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 italic">Restock Alert: Off</p>
              )}
            </div>
          )}

          {/* Cost & Value Section */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Cost & Value</h3>
            {item?.unitCost !== null && item?.unitCost !== undefined && item?.unitCost > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between py-2 px-4 bg-gray-50 rounded-lg">
                  <span className="text-gray-700 font-medium">Unit Cost</span>
                  <span className="text-lg font-bold text-gray-900">
                    {item?.currency === 'USD' && '$'}
                    {item?.currency === 'EUR' && '€'}
                    {item?.currency === 'GBP' && '£'}
                    {item?.currency === 'AUD' && 'A$'}
                    {item?.currency === 'CAD' && 'C$'}
                    {item?.unitCost?.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-4 bg-gray-50 rounded-lg">
                  <span className="text-gray-700 font-medium">Total Onboard</span>
                  <span className="text-lg font-bold text-gray-900">{totalQuantity}</span>
                </div>
                <div className="flex items-center justify-between py-3 px-4 bg-blue-50 rounded-lg border-2 border-blue-200">
                  <span className="text-blue-900 font-bold">Total Value Onboard</span>
                  <span className="text-xl font-bold text-blue-900">
                    {item?.currency === 'USD' && '$'}
                    {item?.currency === 'EUR' && '€'}
                    {item?.currency === 'GBP' && '£'}
                    {item?.currency === 'AUD' && 'A$'}
                    {item?.currency === 'CAD' && 'C$'}
                    {(item?.unitCost * totalQuantity)?.toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg">
                <span className="text-gray-500 italic">Cost not set</span>
                {canEdit && (
                  <button
                    onClick={handleEditClick}
                    className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    Add cost
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Notes and Metadata */}
          {item?.notes && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</h3>
              <p className="text-gray-900 whitespace-pre-wrap">{item?.notes}</p>
            </div>
          )}

          {/* Additional Metadata */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200">
            {item?.unit && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Unit</h4>
                <p className="text-gray-900">{item?.unit}</p>
              </div>
            )}
            {item?.size && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Size</h4>
                <p className="text-gray-900">{item?.size}</p>
              </div>
            )}
            {item?.lowStockThreshold !== undefined && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Low Stock Alert</h4>
                <p className="text-gray-900">{item?.lowStockThreshold}</p>
              </div>
            )}
            {item?.bonded !== undefined && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Bonded</h4>
                <p className="text-gray-900">{item?.bonded ? 'Yes' : 'No'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ItemDetailView;
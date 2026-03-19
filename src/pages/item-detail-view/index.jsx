import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import { getItemById } from '../inventory/utils/inventoryStorage';
import {
  getCategoryL1ById,
  getCategoryL2ById,
  getCategoryL3ById,
  getCategoryL4ById
} from '../inventory/utils/taxonomyStorage';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../utils/authStorage';
import AddEditItemModal from '../inventory/components/AddEditItemModal';
import { canViewCost, formatCurrency, calculateTotalValue } from '../../utils/costPermissions';

const ItemDetailView = () => {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [item, setItem] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [photoZoom, setPhotoZoom] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentUser = getCurrentUser();
  const canEdit = hasCommandAccess(currentUser) || hasChiefAccess(currentUser) || hasHODAccess(currentUser);
  const canSeeCost = canViewCost();

  useEffect(() => {
    loadItem();
  }, [itemId]);

  const loadItem = () => {
    setLoading(true);
    const itemData = getItemById(itemId);
    setItem(itemData);
    setLoading(false);
  };

  const handleEditModalClose = () => {
    setShowEditModal(false);
    // Reload item to show updated values
    loadItem();
  };

  const handleBack = () => {
    // Navigate back to inventory with context
    if (location?.state?.from) {
      navigate(location?.state?.from);
    } else if (item?.l4Id) {
      navigate(`/inventory/l1/${item?.l1Id}/l2/${item?.l2Id}/l3/${item?.l3Id}/l4/${item?.l4Id}`);
    } else if (item?.l3Id) {
      navigate(`/inventory/l1/${item?.l1Id}/l2/${item?.l2Id}/l3/${item?.l3Id}`);
    } else if (item?.l2Id) {
      navigate(`/inventory/l1/${item?.l1Id}/l2/${item?.l2Id}`);
    } else if (item?.l1Id) {
      navigate(`/inventory/l1/${item?.l1Id}`);
    } else {
      navigate('/inventory');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="text-center py-12">
            <Icon name="Loader" size={48} className="mx-auto text-gray-400 mb-3 animate-spin" />
            <p className="text-gray-600">Loading item details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="text-center py-12">
            <Icon name="AlertCircle" size={48} className="mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600 mb-4">Item not found</p>
            <Button onClick={() => navigate('/inventory')}>Back to Inventory</Button>
          </div>
        </div>
      </div>
    );
  }

  // Get taxonomy labels
  const l1Category = item?.l1Id ? getCategoryL1ById(item?.l1Id) : null;
  const l2Category = item?.l2Id ? getCategoryL2ById(item?.l2Id) : null;
  const l3Category = item?.l3Id ? getCategoryL3ById(item?.l3Id) : null;
  const l4Category = item?.l4Id ? getCategoryL4ById(item?.l4Id) : null;

  // Calculate total quantity
  const totalQuantity = item?.locations?.reduce((sum, loc) => sum + (loc?.quantity || 0), 0) || 0;
  const hasMultipleLocations = item?.locations?.length > 1;

  // Status indicators
  const isBonded = item?.bonded === true;
  const isLowStock = totalQuantity > 0 && totalQuantity <= (item?.lowStockThreshold || 5);

  // Get photo URL (backward compatibility)
  const getPhotoUrl = () => {
    if (!item?.photo) return null;
    if (typeof item?.photo === 'string' && item?.photo?.startsWith('http')) {
      return item?.photo;
    }
    if (item?.photo?.dataUrl) {
      return item?.photo?.dataUrl;
    }
    return null;
  };

  const photoUrl = getPhotoUrl();

  // Department labels
  const getDepartmentLabel = (dept) => {
    const labels = {
      'INTERIOR': 'Interior',
      'GALLEY': 'Galley',
      'DECK': 'Deck',
      'ENGINEERING': 'Engineering',
      'MANAGEMENT': 'Management'
    };
    return labels?.[dept] || dept;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header with Back and Edit */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <Icon name="ChevronLeft" size={20} />
            <span className="font-medium">Back</span>
          </button>
          {canEdit && (
            <Button
              onClick={() => setShowEditModal(true)}
              iconName="Edit"
              size="sm"
            >
              Edit
            </Button>
          )}
        </div>

        {/* Main Content Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Photo Section */}
          {photoUrl && (
            <div className="relative bg-gray-50 p-8 flex items-center justify-center">
              <img
                src={photoUrl}
                alt={item?.name || 'Item photo'}
                className="max-w-md w-full h-auto object-contain rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => setPhotoZoom(true)}
              />
            </div>
          )}

          {/* Item Information */}
          <div className="p-6 space-y-6">
            {/* Title and Status Chips */}
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-3">{item?.name}</h1>
              {(isBonded || isLowStock || hasMultipleLocations) && (
                <div className="flex flex-wrap gap-2">
                  {isBonded && (
                    <span className="inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium bg-amber-50 text-amber-700 border border-amber-200">
                      <Icon name="Lock" size={14} className="mr-1" />
                      Bonded
                    </span>
                  )}
                  {isLowStock && (
                    <span className="inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200">
                      <Icon name="AlertTriangle" size={14} className="mr-1" />
                      Low Stock
                    </span>
                  )}
                  {hasMultipleLocations && (
                    <span className="inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200">
                      <Icon name="MapPin" size={14} className="mr-1" />
                      Multi-location
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Stock Information */}
            <div className="bg-gray-50 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Stock Information</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Total Quantity</span>
                  <span className="text-lg font-bold text-gray-900">{totalQuantity}</span>
                </div>
                {item?.unit && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Unit</span>
                    <span className="text-sm font-medium text-gray-900">{item?.unit}</span>
                  </div>
                )}
                {item?.size && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Size</span>
                    <span className="text-sm font-medium text-gray-900">{item?.size}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Cost & Value Section - Only visible to Command/Chief/HOD */}
            {canSeeCost && (
              <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Cost & Value</h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Unit Cost</span>
                    <span className="text-sm font-bold text-gray-900">
                      {item?.unitCost ? formatCurrency(item?.unitCost, item?.currency) : 'Not set'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Total Onboard</span>
                    <span className="text-sm font-medium text-gray-900">{totalQuantity}</span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-green-300">
                    <span className="text-sm font-semibold text-gray-700">Total Value</span>
                    <span className="text-lg font-bold text-green-700">
                      {item?.unitCost ? formatCurrency(calculateTotalValue(item?.unitCost, totalQuantity), item?.currency) : '—'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Location Details */}
            {item?.locations && item?.locations?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Locations</h3>
                <div className="space-y-2">
                  {item?.locations?.map((loc, index) => (
                    <div
                      key={index}
                      className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"
                    >
                      <span className="text-sm font-medium text-gray-900">{loc?.name || 'Default'}</span>
                      <span className="text-sm font-semibold text-gray-700">{loc?.quantity || 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Taxonomy */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Classification</h3>
              <div className="space-y-2">
                {l1Category && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">L1 Domain</span>
                    <span className="text-sm font-medium text-gray-900">{l1Category?.name}</span>
                  </div>
                )}
                {l2Category && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">L2 Category</span>
                    <span className="text-sm font-medium text-gray-900">{l2Category?.name}</span>
                  </div>
                )}
                {l3Category && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">L3 Subcategory</span>
                    <span className="text-sm font-medium text-gray-900">{l3Category?.name}</span>
                  </div>
                )}
                {l4Category && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">L4 Classification</span>
                    <span className="text-sm font-medium text-gray-900">{l4Category?.name}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Departments */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Departments</h3>
              <div className="space-y-2">
                {item?.usageDepartment && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Usage Department</span>
                    <span className="text-sm font-medium text-gray-900">
                      {getDepartmentLabel(item?.usageDepartment)}
                    </span>
                  </div>
                )}
                {item?.maintenanceDepartment && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Maintenance Department</span>
                    <span className="text-sm font-medium text-gray-900">
                      {getDepartmentLabel(item?.maintenanceDepartment)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            {item?.notes && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Notes</h3>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{item?.notes}</p>
              </div>
            )}

            {/* Metadata */}
            <div className="pt-4 border-t border-gray-200">
              <div className="grid grid-cols-2 gap-4 text-xs text-gray-500">
                {item?.createdAt && (
                  <div>
                    <span className="font-medium">Created:</span>{' '}
                    {new Date(item?.createdAt)?.toLocaleDateString()}
                  </div>
                )}
                {item?.updatedAt && (
                  <div>
                    <span className="font-medium">Updated:</span>{' '}
                    {new Date(item?.updatedAt)?.toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Photo Zoom Modal */}
      {photoZoom && photoUrl && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={() => setPhotoZoom(false)}
        >
          <button
            onClick={() => setPhotoZoom(false)}
            className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors"
          >
            <Icon name="X" size={32} />
          </button>
          <img
            src={photoUrl}
            alt={item?.name || 'Item photo'}
            className="max-w-full max-h-full object-contain"
          />
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <AddEditItemModal
          item={item}
          categoryL1Id={item?.l1Id}
          categoryL2Id={item?.l2Id}
          categoryL3Id={item?.l3Id}
          categoryL4Id={item?.l4Id}
          defaultLocation={item?.locations?.[0]?.name || ''}
          defaultSubLocation={item?.locations?.[0]?.subLocation || ''}
          onClose={handleEditModalClose}
        />
      )}
    </div>
  );
};

export default ItemDetailView;
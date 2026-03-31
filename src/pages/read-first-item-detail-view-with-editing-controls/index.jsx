import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import { getItemById } from '../inventory/utils/inventoryStorage';
import { getCategoryL1ById, getCategoryL2ById, getCategoryL3ById, getCategoryL4ById } from '../inventory/utils/taxonomyStorage';

import AddEditItemModal from '../inventory/components/AddEditItemModal';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../utils/authStorage';
import { canViewCost, formatCurrency } from '../../utils/costPermissions';

// ── Location breadcrumb helpers ───────────────────────────────────────────────
const SLASH_PLACEHOLDER = '__FWDSLASH__';
const encodeSegment = (s) => encodeURIComponent(s?.replace(/\//g, SLASH_PLACEHOLDER));

/** Build [{ label, url }] breadcrumb from an item's location + subLocation fields */
const buildLocationBreadcrumb = (item) => {
  if (!item?.location) return [];
  const topLevel = item.location;
  const subParts = item.subLocation ? item.subLocation.split(' > ').filter(Boolean) : [];
  const allSegments = [topLevel, ...subParts];
  return allSegments.map((label, idx) => {
    const segmentsSoFar = allSegments.slice(0, idx + 1);
    const url = '/inventory/location/' + segmentsSoFar.map(encodeSegment).join('/');
    return { label, url };
  });
};

const ReadFirstItemDetailView = () => {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(false);
  const currentUser = getCurrentUser();

  const canEdit = hasCommandAccess(currentUser) || hasChiefAccess(currentUser) || hasHODAccess(currentUser);
  const canSeeCost = canViewCost();

  useEffect(() => {
    loadItem();
  }, [itemId]);

  const loadItem = async () => {
    const loadedItem = await getItemById(itemId);
    if (!loadedItem) {
      navigate('/inventory');
      return;
    }
    setItem(loadedItem);
  };

  const getCategoryPath = () => {
    if (!item) return '';
    const parts = [];
    if (item?.l1Id) {
      const l1 = getCategoryL1ById(item?.l1Id);
      if (l1) parts?.push(l1?.name);
    }
    if (item?.l2Id) {
      const l2 = getCategoryL2ById(item?.l2Id);
      if (l2) parts?.push(l2?.name);
    }
    if (item?.l3Id) {
      const l3 = getCategoryL3ById(item?.l3Id);
      if (l3) parts?.push(l3?.name);
    }
    if (item?.l4Id) {
      const l4 = getCategoryL4ById(item?.l4Id);
      if (l4) parts?.push(l4?.name);
    }
    return parts?.join(' → ');
  };

  const getTotalQuantity = () => {
    return item?.stockLocations?.reduce((sum, loc) => sum + (loc?.qty || 0), 0) || item?.totalQty || 0;
  };

  const computeTotalOnboard = () => {
    if (typeof item?.totalQty === 'number') {
      return item?.totalQty;
    }
    if (Array.isArray(item?.stockLocations)) {
      return item?.stockLocations?.reduce((sum, loc) => sum + (loc?.qty || 0), 0);
    }
    return 0;
  };

  const getRestockStatus = () => {
    if (!item?.restockEnabled || item?.restockLevel == null) {
      return null;
    }
    const totalOnboard = computeTotalOnboard();
    return totalOnboard > item?.restockLevel ? 'OK' : 'Low';
  };

  const handleEditClick = () => {
    setShowEditModal(true);
  };

  const handleModalClose = () => {
    setShowEditModal(false);
    loadItem(); // Reload item after edit
  };

  const photoSrc = item?.photo?.dataUrl || (typeof item?.photo === 'string' ? item?.photo : null) || item?.imageUrl || null;

  if (!item) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="text-center py-12">
            <Icon name="AlertCircle" size={48} className="mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600">Item not found</p>
            <Button onClick={() => navigate('/inventory')} className="mt-4">
              Back to Inventory
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 ">
      <Header />
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header with Breadcrumb and Edit */}
        <div className="flex items-center justify-between mb-6">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 flex-wrap min-w-0">
            <button
              onClick={() => navigate('/inventory')}
              className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline transition-colors whitespace-nowrap"
            >
              Inventory
            </button>
            {buildLocationBreadcrumb(item).map(({ label, url }) => (
              <React.Fragment key={url}>
                <Icon name="ChevronRight" size={14} className="text-gray-400 flex-shrink-0" />
                <button
                  onClick={() => navigate(url)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline transition-colors whitespace-nowrap"
                >
                  {label}
                </button>
              </React.Fragment>
            ))}
          </nav>
          {canEdit && (
            <button
              onClick={handleEditClick}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors ml-4 flex-shrink-0"
            >
              <Icon name="Edit" size={18} />
              <span>Edit</span>
            </button>
          )}
        </div>

        {/* Main Content Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Large Image Section */}
          <div className="relative bg-gray-50 flex items-center justify-center" style={{ minHeight: '400px' }}>
            {photoSrc ? (
              <img
                src={photoSrc}
                alt={item?.name || 'Item'}
                className={`max-w-full transition-all duration-300 cursor-zoom-in ${
                  zoomedImage ? 'max-h-[600px] object-contain' : 'max-h-[400px] object-contain'
                }`}
                onClick={() => setZoomedImage(!zoomedImage)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-20">
                <Icon name="Package" size={80} className="text-gray-300 mb-4" />
                <p className="text-gray-500">No image available</p>
              </div>
            )}
            {photoSrc && (
              <div className="absolute top-4 right-4 bg-black bg-opacity-50 text-white px-3 py-1 rounded-full text-sm">
                Click to {zoomedImage ? 'zoom out' : 'zoom in'}
              </div>
            )}
          </div>

          {/* Item Details Section */}
          <div className="p-8 space-y-6">
            {/* Item Name */}
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{item?.name}</h1>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Icon name="Tag" size={16} />
                <span>{getCategoryPath()}</span>
              </div>
            </div>

            {/* Quantity Summary */}
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">Total Quantity</p>
                  <p className="text-3xl font-bold text-blue-600">{getTotalQuantity()}</p>
                </div>
                <Icon name="Package" size={40} className="text-blue-400" />
              </div>
            </div>

            {/* Stock Locations */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Icon name="MapPin" size={20} />
                Stock Locations
              </h3>
              <div className="space-y-2">
                {item?.stockLocations && item?.stockLocations?.length > 0 ? (
                  item?.stockLocations?.map((loc, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <span className="font-medium text-gray-900">{loc?.locationName}</span>
                      <span className="text-lg font-semibold text-gray-700">{loc?.qty} units</span>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-sm">No stock locations assigned</p>
                )}
              </div>
            </div>

            {/* Restock Alert */}
            {canEdit && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Icon name="AlertTriangle" size={20} />
                  Restock Alert
                </h3>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon name={item?.restockEnabled ? 'CheckCircle' : 'XCircle'} size={16} className={`text-${item?.restockEnabled ? 'green' : 'red'}`} />
                      <span className={`text-gray-900 font-medium ${item?.restockEnabled ? 'text-green-600' : 'text-red-600'}`}>
                        {item?.restockEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <span className="text-lg text-gray-700">{item?.restockLevel} units</span>
                  </div>
                  <div className="mt-2 text-sm text-gray-500">
                    Current total onboard: {computeTotalOnboard()} units
                  </div>
                  <div className="mt-2 text-sm text-gray-500">
                    Status: <span className={`inline-block px-2 py-1 text-xs rounded-full ${getRestockStatus() === 'OK' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>
                      {getRestockStatus() === 'OK' ? 'OK' : 'Low'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Cost & Value Section */}
            {canSeeCost && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Icon name="DollarSign" size={20} />
                  Cost & Value
                </h3>
                <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Unit Cost</span>
                    <span className="text-lg font-semibold text-gray-900">
                      {item?.unitCost && item?.currency
                        ? formatCurrency(item?.unitCost, item?.currency)
                        : 'Not set'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Total Onboard</span>
                    <span className="text-lg font-semibold text-gray-900">
                      {computeTotalOnboard()} units
                    </span>
                  </div>
                  <div className="pt-3 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-700 font-medium">Total Value</span>
                      <span className="text-xl font-bold text-blue-600">
                        {item?.unitCost && item?.currency
                          ? formatCurrency(item?.unitCost * computeTotalOnboard(), item?.currency)
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Departments */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Usage Department</h3>
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                  <Icon name="Users" size={16} className="text-gray-500" />
                  <span className="text-gray-900">{item?.usageDepartment || 'Not specified'}</span>
                </div>
              </div>
              {item?.maintenanceDepartment && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Maintenance Department</h3>
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                    <Icon name="Wrench" size={16} className="text-gray-500" />
                    <span className="text-gray-900">{item?.maintenanceDepartment}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Notes */}
            {item?.notes && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Icon name="FileText" size={20} />
                  Notes
                </h3>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-gray-700 whitespace-pre-wrap">{item?.notes}</p>
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="pt-4 border-t border-gray-200">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {item?.createdAt && (
                  <div>
                    <p className="text-gray-500">Created</p>
                    <p className="text-gray-900 font-medium">
                      {new Date(item?.createdAt)?.toLocaleDateString()}
                    </p>
                  </div>
                )}
                {item?.updatedAt && (
                  <div>
                    <p className="text-gray-500">Last Updated</p>
                    <p className="text-gray-900 font-medium">
                      {new Date(item?.updatedAt)?.toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Edit Modal */}
      {showEditModal && (
        <AddEditItemModal
          item={item}
          categoryL1Id={item?.l1Id}
          categoryL2Id={item?.l2Id}
          categoryL3Id={item?.l3Id}
          categoryL4Id={item?.l4Id}
          defaultLocation={item?.stockLocations?.[0]?.locationName || ''}
          defaultSubLocation={item?.stockLocations?.[0]?.subLocation || ''}
          onClose={handleModalClose}
        />
      )}
    </div>
  );
};

export default ReadFirstItemDetailView;
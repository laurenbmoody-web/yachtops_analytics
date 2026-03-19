import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import ItemTile from '../inventory/components/ItemTile';
import ItemListView from '../inventory/components/ItemListView';
import DepartmentFilterChips, { getDepartmentFilter, filterItemsByDepartment } from '../inventory/components/DepartmentFilterChips';
import BulkActionsModal from '../inventory/components/BulkActionsModal';
import AddEditItemModal from '../inventory/components/AddEditItemModal';
import { getAllCategoriesL1, getCategoriesL2ByL1, getCategoriesL3ByL2, getCategoryL1ById, getCategoryL2ById, getCategoryL3ById } from '../inventory/utils/taxonomyStorage';
import { getItemsByTaxonomy, saveItem } from '../inventory/utils/inventoryStorage';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../utils/authStorage';

const AdvancedInventoryManagement = () => {
  const { categoryId, subcategoryL2Id, subcategoryL3Id } = useParams();
  const navigate = useNavigate();
  
  const [categoriesL1, setCategoriesL1] = useState([]);
  const [categoriesL2, setCategoriesL2] = useState([]);
  const [categoriesL3, setCategoriesL3] = useState([]);
  const [items, setItems] = useState([]);
  const [filteredItems, setFilteredItems] = useState([]);
  const [currentL1, setCurrentL1] = useState(null);
  const [currentL2, setCurrentL2] = useState(null);
  const [currentL3, setCurrentL3] = useState(null);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Department filter state (persisted)
  const [departmentFilter, setDepartmentFilter] = useState(() => getDepartmentFilter());
  
  // View mode state (persisted)
  const [viewMode, setViewMode] = useState(() => {
    const stored = localStorage.getItem('cargo_inventory_view_mode');
    return stored || 'tile';
  });
  
  // Zoom level state (persisted)
  const [zoomLevel, setZoomLevel] = useState(() => {
    const stored = localStorage.getItem('cargo_inventory_zoom_level');
    return stored ? parseInt(stored) : 3;
  });
  
  // Selection mode state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [showBulkActionsModal, setShowBulkActionsModal] = useState(false);
  
  const currentUser = getCurrentUser();
  const canAddItem = hasCommandAccess(currentUser) || hasChiefAccess(currentUser) || hasHODAccess(currentUser);
  const canBulkActions = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);

  useEffect(() => {
    loadData();
  }, [categoryId, subcategoryL2Id, subcategoryL3Id]);

  useEffect(() => {
    // Apply department filter whenever items or filter changes
    const filtered = filterItemsByDepartment(items, departmentFilter, currentUser);
    setFilteredItems(filtered);
  }, [items, departmentFilter, currentUser]);

  const loadData = () => {
    if (!categoryId) {
      // Level 1: Show all L1 categories
      setCategoriesL1(getAllCategoriesL1());
      setItems([]);
    } else if (!subcategoryL2Id) {
      // Level 2: Show L2 subcategories for selected L1
      const l1Category = getCategoryL1ById(categoryId);
      if (!l1Category) {
        setCurrentL1(null);
        setCategoriesL2([]);
        return;
      }
      setCurrentL1(l1Category);
      setCategoriesL2(getCategoriesL2ByL1(categoryId));
      setItems([]);
    } else if (!subcategoryL3Id) {
      // Level 3 or Items
      const l1Category = getCategoryL1ById(categoryId);
      const l2Category = getCategoryL2ById(subcategoryL2Id);
      
      if (!l1Category || !l2Category || l2Category?.categoryL1Id !== categoryId) {
        setCurrentL1(null);
        setCurrentL2(null);
        setCategoriesL3([]);
        setItems([]);
        return;
      }
      
      setCurrentL1(l1Category);
      setCurrentL2(l2Category);
      
      const l3Categories = getCategoriesL3ByL2(categoryId, subcategoryL2Id);
      
      if (l3Categories?.length > 0) {
        setCategoriesL3(l3Categories);
        setItems([]);
      } else {
        setCategoriesL3([]);
        setItems(getItemsByTaxonomy(categoryId, subcategoryL2Id, null));
      }
    } else {
      // Show items filtered to L1+L2+L3
      const l1Category = getCategoryL1ById(categoryId);
      const l2Category = getCategoryL2ById(subcategoryL2Id);
      const l3Category = getCategoryL3ById(subcategoryL3Id);
      
      if (!l1Category || !l2Category || !l3Category ||
          l2Category?.categoryL1Id !== categoryId ||
          l3Category?.categoryL1Id !== categoryId ||
          l3Category?.categoryL2Id !== subcategoryL2Id) {
        setCurrentL1(null);
        setCurrentL2(null);
        setCurrentL3(null);
        setItems([]);
        return;
      }
      
      setCurrentL1(l1Category);
      setCurrentL2(l2Category);
      setCurrentL3(l3Category);
      setItems(getItemsByTaxonomy(categoryId, subcategoryL2Id, subcategoryL3Id));
    }
  };

  const handleCategoryClick = (category, level) => {
    if (level === 'L1') {
      navigate(`/advanced-inventory-management-with-filtering-and-bulk-actions/category/${category?.id}`);
    } else if (level === 'L2') {
      navigate(`/advanced-inventory-management-with-filtering-and-bulk-actions/category/${categoryId}/sub/${category?.id}`);
    } else if (level === 'L3') {
      navigate(`/advanced-inventory-management-with-filtering-and-bulk-actions/category/${categoryId}/sub/${subcategoryL2Id}/sub3/${category?.id}`);
    }
  };

  const handleBack = () => {
    if (subcategoryL3Id) {
      navigate(`/advanced-inventory-management-with-filtering-and-bulk-actions/category/${categoryId}/sub/${subcategoryL2Id}`);
    } else if (subcategoryL2Id) {
      navigate(`/advanced-inventory-management-with-filtering-and-bulk-actions/category/${categoryId}`);
    } else if (categoryId) {
      navigate('/advanced-inventory-management-with-filtering-and-bulk-actions');
    }
  };

  const handleDepartmentChange = (dept) => {
    setDepartmentFilter(dept);
  };

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
    localStorage.setItem('cargo_inventory_view_mode', mode);
  };

  const handleZoomChange = (level) => {
    setZoomLevel(level);
    localStorage.setItem('cargo_inventory_zoom_level', level?.toString());
  };

  const handleToggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    if (selectionMode) {
      setSelectedItems([]);
    }
  };

  const handleToggleSelect = (itemId, forceValue) => {
    if (forceValue !== undefined) {
      if (forceValue && !selectedItems?.includes(itemId)) {
        setSelectedItems([...selectedItems, itemId]);
      } else if (!forceValue && selectedItems?.includes(itemId)) {
        setSelectedItems(selectedItems?.filter(id => id !== itemId));
      }
    } else {
      if (selectedItems?.includes(itemId)) {
        setSelectedItems(selectedItems?.filter(id => id !== itemId));
      } else {
        setSelectedItems([...selectedItems, itemId]);
      }
    }
  };

  const handleBulkActionsClick = () => {
    if (selectedItems?.length === 0) {
      alert('Please select items first');
      return;
    }
    setShowBulkActionsModal(true);
  };

  const handleBulkActionsComplete = () => {
    setSelectedItems([]);
    setSelectionMode(false);
    loadData();
  };

  const handleQuantityChange = (itemId, updatedLocations) => {
    const item = items?.find(i => i?.id === itemId);
    if (item) {
      const totalQty = updatedLocations?.reduce((sum, loc) => sum + (loc?.qty || 0), 0);
      saveItem({ ...item, stockLocations: updatedLocations, totalQty });
      loadData();
    }
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setShowAddItemModal(true);
  };

  const handleModalClose = () => {
    setShowAddItemModal(false);
    setEditingItem(null);
    loadData();
  };

  // Calculate grid columns based on zoom level
  const getGridColumns = () => {
    switch (zoomLevel) {
      case 1: return 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6';
      case 2: return 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';
      case 3: return 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
      case 4: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
      case 5: return 'grid-cols-1 md:grid-cols-2';
      default: return 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
    }
  };

  const showingItems = items?.length > 0;
  const showingCategories = categoriesL1?.length > 0 || categoriesL2?.length > 0 || categoriesL3?.length > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-gray-600 hover:text-gray-900"
          >
            <Icon name="Home" size={20} />
          </button>
          {(categoryId || subcategoryL2Id || subcategoryL3Id) && (
            <button
              onClick={handleBack}
              className="flex items-center gap-2 text-blue-600 hover:text-blue-800"
            >
              <Icon name="ChevronLeft" size={20} />
              <span>Back</span>
            </button>
          )}
          <div className="flex items-center gap-2 text-gray-600">
            <span>Inventory</span>
            {currentL1 && (
              <>
                <Icon name="ChevronRight" size={16} />
                <span>{currentL1?.name}</span>
              </>
            )}
            {currentL2 && (
              <>
                <Icon name="ChevronRight" size={16} />
                <span>{currentL2?.name}</span>
              </>
            )}
            {currentL3 && (
              <>
                <Icon name="ChevronRight" size={16} />
                <span>{currentL3?.name}</span>
              </>
            )}
          </div>
        </div>

        {/* Header Controls */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6 space-y-4">
          {/* Department Filter Chips */}
          <DepartmentFilterChips
            selectedDepartment={departmentFilter}
            onDepartmentChange={handleDepartmentChange}
          />

          {/* View Controls */}
          {showingItems && (
            <div className="flex items-center justify-between flex-wrap gap-4">
              {/* View Mode Toggle */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleViewModeChange('tile')}
                  className={`p-2 rounded-lg transition-colors ${
                    viewMode === 'tile' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  aria-label="Tile view"
                >
                  <Icon name="Grid3x3" size={20} />
                </button>
                <button
                  onClick={() => handleViewModeChange('list')}
                  className={`p-2 rounded-lg transition-colors ${
                    viewMode === 'list' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  aria-label="List view"
                >
                  <Icon name="List" size={20} />
                </button>
              </div>

              {/* Zoom Density Slider */}
              {viewMode === 'tile' && (
                <div className="flex items-center gap-3">
                  <Icon name="ZoomOut" size={16} className="text-gray-400" />
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={zoomLevel}
                    onChange={(e) => handleZoomChange(parseInt(e?.target?.value))}
                    className="w-32"
                  />
                  <Icon name="ZoomIn" size={16} className="text-gray-400" />
                </div>
              )}

              {/* Selection & Bulk Actions */}
              <div className="flex items-center gap-2">
                {canBulkActions && (
                  <button
                    onClick={handleToggleSelectionMode}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      selectionMode
                        ? 'bg-blue-600 text-white' :'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {selectionMode ? 'Cancel Selection' : 'Select Items'}
                  </button>
                )}
                {canAddItem && (
                  <Button onClick={handleAddItem}>
                    <Icon name="Plus" size={20} className="mr-2" />
                    Add Item
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Categories Grid */}
        {showingCategories && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {categoriesL1?.map(cat => (
              <button
                key={cat?.id}
                onClick={() => handleCategoryClick(cat, 'L1')}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-all text-left"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Icon name="Folder" size={24} className="text-blue-600" />
                  <h3 className="font-bold text-gray-900">{cat?.name}</h3>
                </div>
              </button>
            ))}
            {categoriesL2?.map(cat => (
              <button
                key={cat?.id}
                onClick={() => handleCategoryClick(cat, 'L2')}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-all text-left"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Icon name="Folder" size={24} className="text-green-600" />
                  <h3 className="font-bold text-gray-900">{cat?.name}</h3>
                </div>
              </button>
            ))}
            {categoriesL3?.map(cat => (
              <button
                key={cat?.id}
                onClick={() => handleCategoryClick(cat, 'L3')}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-all text-left"
              >
                <div className="flex items-center gap-3 mb-2">
                  <Icon name="Folder" size={24} className="text-purple-600" />
                  <h3 className="font-bold text-gray-900">{cat?.name}</h3>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Items View */}
        {showingItems && (
          <>
            {viewMode === 'tile' ? (
              <div className={`grid ${getGridColumns()} gap-4`}>
                {filteredItems?.map(item => (
                  <ItemTile
                    key={item?.id}
                    item={item}
                    onQuantityChange={handleQuantityChange}
                    selectionMode={selectionMode}
                    isSelected={selectedItems?.includes(item?.id)}
                    onToggleSelect={handleToggleSelect}
                    onEdit={(item) => {
                      setEditingItem(item);
                      setShowAddItemModal(true);
                    }}
                    onDelete={(itemId) => {
                      // Delete functionality would go here
                      loadData();
                    }}
                    canEdit={canAddItem}
                    onQuickView={(item) => {
                      // Quick view functionality would go here
                    }}
                  />
                ))}
              </div>
            ) : (
              <ItemListView
                items={filteredItems}
                selectionMode={selectionMode}
                selectedItems={selectedItems}
                onToggleSelect={handleToggleSelect}
                onQuantityChange={handleQuantityChange}
                onQuickView={(item) => {
                  // Quick view functionality would go here
                }}
              />
            )}
          </>
        )}

        {/* Empty State */}
        {!showingCategories && !showingItems && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <Icon name="Package" size={64} className="mx-auto mb-4 text-gray-300" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No items found</h3>
            <p className="text-gray-600 mb-6">Get started by adding your first inventory item</p>
            {canAddItem && (
              <Button onClick={handleAddItem}>
                <Icon name="Plus" size={20} className="mr-2" />
                Add Item
              </Button>
            )}
          </div>
        )}
      </div>
      {/* Floating Action Bar (when items selected) */}
      {selectionMode && selectedItems?.length > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white rounded-full shadow-2xl px-6 py-4 flex items-center gap-4 z-40">
          <span className="font-semibold">{selectedItems?.length} selected</span>
          <div className="w-px h-6 bg-gray-600"></div>
          <button
            onClick={handleBulkActionsClick}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-full font-medium transition-colors"
          >
            Bulk Actions
          </button>
        </div>
      )}
      {/* Modals */}
      {showAddItemModal && (
        <AddEditItemModal
          item={editingItem}
          categoryL1Id={categoryId}
          categoryL2Id={subcategoryL2Id}
          categoryL3Id={subcategoryL3Id}
          categoryL4Id={null}
          defaultLocation={null}
          defaultSubLocation={null}
          onClose={handleModalClose}
        />
      )}
      {showBulkActionsModal && (
        <BulkActionsModal
          selectedItems={selectedItems}
          items={items}
          onClose={() => setShowBulkActionsModal(false)}
          onComplete={handleBulkActionsComplete}
        />
      )}
    </div>
  );
};

export default AdvancedInventoryManagement;
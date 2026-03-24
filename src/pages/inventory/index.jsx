import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import {
  getAllCategoriesL1,
  getCategoriesL2ByL1,
  getCategoriesL3ByL2,
  getCategoryL1ById,
  getCategoryL2ById,
  getCategoryL3ById,
  getItemCountForCategoryL1,
  getItemCountForCategoryL2,
  getItemCountForCategoryL3,
  migrateGuestCategories
} from './utils/taxonomyStorage';
import { getItemsByTaxonomy, deleteItem, bulkDeleteItems, updateItemStockLocations } from './utils/inventoryStorage';
import AddEditItemModal from './components/AddEditItemModal';
import ExcelImportModal from './components/ExcelImportModal';
import BulkDeleteConfirmationModal from './components/BulkDeleteConfirmationModal';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../utils/authStorage';
import { getDepartmentScope, setDepartmentScope } from '../../utils/departmentScopeStorage';
import { logBulkDelete } from './utils/activityLogger';
import ItemTile from './components/ItemTile';
import VirtualizedItemGrid from './components/VirtualizedItemGrid';
import ItemListView from './components/ItemListView';
import DepartmentFilterChips from './components/DepartmentFilterChips';
import BulkActionsModal from './components/BulkActionsModal';
import ExportInventoryModal from './components/ExportInventoryModal';
import ItemQuickViewPanel from './components/ItemQuickViewPanel';
import { supabase } from '../../lib/supabaseClient';

const Inventory = () => {
  const { categoryId, subcategoryL2Id, subcategoryL3Id } = useParams();
  const navigate = useNavigate();
  
  const [categoriesL1, setCategoriesL1] = useState([]);
  const [categoriesL2, setCategoriesL2] = useState([]);
  const [categoriesL3, setCategoriesL3] = useState([]);
  const [items, setItems] = useState([]);
  const [currentL1, setCurrentL1] = useState(null);
  const [currentL2, setCurrentL2] = useState(null);
  const [currentL3, setCurrentL3] = useState(null);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [showMoreActionsMenu, setShowMoreActionsMenu] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Department scope state (Command only)
  const [departmentScope, setDepartmentScopeState] = useState(() => getDepartmentScope());
  
  // View mode state
  const [viewMode, setViewMode] = useState('tile'); // 'tile' or 'list'
  const [zoomLevel, setZoomLevel] = useState(3); // 1-5 scale for density
  
  // Selection mode state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [showBulkActionsModal, setShowBulkActionsModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [quickViewItem, setQuickViewItem] = useState(null);

  // Sort state lifted here so it persists across re-renders (renderItemList is called inline)
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Vessel locations for resolving locationId → real name in ItemTile/ItemListView
  const [vesselLocations, setVesselLocations] = useState([]);

  const currentUser = getCurrentUser();
  const canImport = hasCommandAccess(currentUser) || hasChiefAccess(currentUser) || hasHODAccess(currentUser);
  const canAddItem = hasCommandAccess(currentUser) || hasChiefAccess(currentUser) || hasHODAccess(currentUser);
  const canBulkDelete = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);
  const canAccessSettings = hasCommandAccess(currentUser) || hasChiefAccess(currentUser);
  const canExport = hasCommandAccess(currentUser) || hasChiefAccess(currentUser) || hasHODAccess(currentUser);

  // Determine current view level
  const viewLevel = !categoryId ? 'L1' : !subcategoryL2Id ? 'L2' : !subcategoryL3Id ? 'L2_OR_L3_OR_ITEMS' : 'ITEMS';

  // Add this block - Move filteredItems before it's used
  const filteredItems = filterItemsByDepartment(items?.filter(item =>
    item?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase())
  ));

  useEffect(() => {
    loadData();
  }, [categoryId, subcategoryL2Id, subcategoryL3Id, departmentScope]);

  // Load vessel locations once on mount for location name resolution
  useEffect(() => {
    const loadVesselLocations = async () => {
      try {
        const { data: ctx } = await supabase?.rpc('get_my_context');
        const tenantId = ctx?.[0]?.tenant_id;
        if (!tenantId) return;
        const { data, error } = await supabase
          ?.from('vessel_locations')
          ?.select('id, name, level, parent_id')
          ?.eq('tenant_id', tenantId)
          ?.eq('is_archived', false)
          ?.order('sort_order', { ascending: true })
          ?.order('name', { ascending: true });
        if (!error && data) setVesselLocations(data);
      } catch (err) {
        console.error('[Inventory] loadVesselLocations error:', err?.message);
      }
    };
    loadVesselLocations();
  }, []);

  // Run migration on component mount (one-time)
  useEffect(() => {
    const migrationKey = 'cargo_guest_categories_migrated';
    const hasMigrated = localStorage.getItem(migrationKey);
    
    if (!hasMigrated) {
      const result = migrateGuestCategories();
      if (result?.migrated > 0) {
        console.log(result?.message);
      }
      localStorage.setItem(migrationKey, 'true');
    }
  }, []);

  /**
   * Load data based on current route parameters
   * 
   * ID-SAFE DATA LOADING:
   * - Uses categoryId, subcategoryL2Id, subcategoryL3Id from route params (IDs, not names)
   * - Calls getItemsByTaxonomy with IDs for filtering
   * - Category objects loaded via getCategoryL1ById, getCategoryL2ById, getCategoryL3ById
   * - Category names displayed from loaded objects (display only)
   * 
   * RESULT: Category renaming only affects display labels
   * - Route params remain stable (IDs)
   * - Queries use IDs for filtering
   * - Items remain correctly associated with categories
   */
  const loadData = () => {
    if (!categoryId) {
      // Level 1: Show all L1 categories
      setCategoriesL1(getAllCategoriesL1());
    } else if (!subcategoryL2Id) {
      // Level 2: Show L2 subcategories for selected L1 ONLY
      const l1Category = getCategoryL1ById(categoryId);
      if (!l1Category) {
        // Invalid categoryId - show empty state
        setCurrentL1(null);
        setCategoriesL2([]);
        return;
      }
      setCurrentL1(l1Category);
      setCategoriesL2(getCategoriesL2ByL1(categoryId));
    } else if (!subcategoryL3Id) {
      // Level 3 or Items: Validate both L1 and L2
      const l1Category = getCategoryL1ById(categoryId);
      const l2Category = getCategoryL2ById(subcategoryL2Id);
      
      if (!l1Category || !l2Category || l2Category?.categoryL1Id !== categoryId) {
        // Invalid params - show empty state
        setCurrentL1(null);
        setCurrentL2(null);
        setCategoriesL3([]);
        setItems([]);
        return;
      }
      
      setCurrentL1(l1Category);
      setCurrentL2(l2Category);
      
      // Get L3 categories filtered by BOTH L1 and L2
      const l3Categories = getCategoriesL3ByL2(categoryId, subcategoryL2Id);
      
      if (l3Categories?.length > 0) {
        // Show L3 subcategories
        setCategoriesL3(l3Categories);
        setItems([]);
      } else {
        // No L3, show items filtered to L1+L2
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
        // Invalid params - show empty state
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

  /**
   * Handle category navigation using ID-based routes
   * 
   * ID-SAFE NAVIGATION:
   * - Routes use category IDs, not names
   * - /inventory/category/:categoryId (uses L1 ID)
   * - /inventory/category/:categoryId/sub/:subcategoryL2Id (uses L1 + L2 IDs)
   * - /inventory/category/:categoryId/sub/:subcategoryL2Id/sub3/:subcategoryL3Id (uses L1 + L2 + L3 IDs)
   * 
   * RESULT: Renaming a category doesn't break navigation or URLs
   * - Category name changes only affect display labels
   * - Route IDs remain stable
   * - Bookmarks and deep links continue to work
   */
  const handleCategoryClick = (category, level) => {
    if (level === 'L1') {
      navigate(`/inventory/category/${category?.id}`);
    } else if (level === 'L2') {
      navigate(`/inventory/category/${categoryId}/sub/${category?.id}`);
    } else if (level === 'L3') {
      navigate(`/inventory/category/${categoryId}/sub/${subcategoryL2Id}/sub3/${category?.id}`);
    }
  };

  const handleBack = () => {
    if (subcategoryL3Id) {
      navigate(`/inventory/category/${categoryId}/sub/${subcategoryL2Id}`);
    } else if (subcategoryL2Id) {
      navigate(`/inventory/category/${categoryId}`);
    } else if (categoryId) {
      navigate('/inventory');
    }
  };

  const handleAddItem = () => {
    setEditingItem(null);
    setShowAddItemModal(true);
  };
  
  const handleAddItemWithContext = () => {
    setEditingItem(null);
    setShowAddItemModal(true);
  };

  const handleEditItem = (item) => {
    setEditingItem(item);
    setShowAddItemModal(true);
  };

  const handleDeleteItem = (itemId) => {
    if (window.confirm('Are you sure you want to delete this item?')) {
      deleteItem(itemId);
      loadData();
    }
  };

  const handleModalClose = () => {
    setShowAddItemModal(false);
    setEditingItem(null);
    loadData();
  };
  
  const handleImportSuccess = () => {
    loadData();
  };
  
  // Handle department scope change (Command only)
  const handleDepartmentScopeChange = (newScope) => {
    setDepartmentScope(newScope);
    setDepartmentScopeState(newScope);
  };

  // Filter items by department
  const filterItemsByDepartment = (itemsList) => {
    if (departmentScope === 'ALL') return itemsList;
    return itemsList?.filter(item => item?.usageDepartment?.toUpperCase() === departmentScope);
  };

  // Toggle selection mode
  const handleToggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    if (selectionMode) {
      setSelectedItems([]);
    }
  };

  // Toggle item selection
  const handleToggleItemSelect = (itemId) => {
    setSelectedItems(prev => {
      const isCurrentlySelected = prev?.includes(itemId);
      if (isCurrentlySelected) {
        return prev?.filter(id => id !== itemId);
      } else {
        return [...prev, itemId];
      }
    });
  };

  // Select all items
  const handleSelectAll = () => {
    const allItemIds = filteredItems?.map(item => item?.id);
    setSelectedItems(allItemIds);
  };

  // Clear selection
  const handleClearSelection = () => {
    setSelectedItems([]);
  };

  // Handle item click in list view
  const handleItemClick = (item) => {
    navigate(`/inventory/item/${item?.id}`);
  };

  const handleQuickView = (item) => {
    setQuickViewItem(item);
  };

  // Get grid columns based on zoom level
  const getGridColumns = () => {
    switch(zoomLevel) {
      case 1: return 'grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3';
      case 2: return 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4';
      case 3: return 'grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5';
      case 4: return 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6';
      case 5: return 'grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7';
      default: return 'grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5';
    }
  };

  // Get item count for current scope
  const getCurrentScopeItemCount = () => {
    if (subcategoryL3Id) {
      return getItemCountForCategoryL3(categoryId, subcategoryL2Id, subcategoryL3Id);
    } else if (subcategoryL2Id) {
      return getItemCountForCategoryL2(categoryId, subcategoryL2Id);
    } else if (categoryId) {
      return getItemCountForCategoryL1(categoryId);
    }
    return 0;
  };

  // Handle bulk delete
  const handleBulkDelete = () => {
    const itemCount = getCurrentScopeItemCount();
    if (itemCount === 0) return;
    
    setShowBulkDeleteModal(true);
    setShowMoreActionsMenu(false);
  };

  const handleBulkDeleteConfirm = () => {
    const scope = {
      categoryL1Name: currentL1?.name,
      categoryL2Name: currentL2?.name || null,
      categoryL3Name: currentL3?.name || null
    };
    
    const deletedCount = bulkDeleteItems(categoryId, subcategoryL2Id || null, subcategoryL3Id || null);
    
    // Log activity
    logBulkDelete(scope, deletedCount);
    
    // Close modal and refresh
    setShowBulkDeleteModal(false);
    loadData();
    
    // Show success message
    alert(`${deletedCount} item${deletedCount !== 1 ? 's' : ''} deleted successfully.`);
  };

  // Handle bulk action button clicks
  const handleBulkActionClick = (actionType) => {
    if (selectedItems?.length === 0) return;
    setShowBulkActionsModal(true);
  };

  const handleBulkActionsComplete = () => {
    setShowBulkActionsModal(false);
    setSelectedItems([]);
    setSelectionMode(false);
    loadData();
  };

  // Breadcrumb
  const renderBreadcrumb = () => {
    const parts = ['Inventory'];
    if (currentL1) parts?.push(currentL1?.name);
    if (currentL2) parts?.push(currentL2?.name);
    if (currentL3) parts?.push(currentL3?.name);
    
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-4">
        {parts?.map((part, index) => (
          <React.Fragment key={index}>
            {index > 0 && <Icon name="ChevronRight" size={14} />}
            <span className={index === parts?.length - 1 ? 'font-semibold text-gray-900' : ''}>
              {part}
            </span>
          </React.Fragment>
        ))}
      </div>
    );
  };

  // Widget Card Component
  const CategoryWidget = ({ category, level, count }) => (
    <div
      onClick={() => handleCategoryClick(category, level)}
      className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-all cursor-pointer p-6 border border-gray-100"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">{category?.name}</h3>
          <p className="text-sm text-gray-500">{count} items</p>
        </div>
        <Icon name="ChevronRight" size={20} className="text-gray-400" />
      </div>
    </div>
  );

  // Render more actions menu (⋯)
  const renderMoreActionsMenu = () => {
    const itemCount = getCurrentScopeItemCount();
    
    // Don't show if no items or user can't bulk delete
    if (!canBulkDelete || itemCount === 0) return null;
    
    // Only show at category/subcategory levels (not at root /inventory)
    if (!categoryId) return null;
    
    return (
      <div className="relative">
        <button
          onClick={() => setShowMoreActionsMenu(!showMoreActionsMenu)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="More actions"
        >
          <Icon name="MoreVertical" size={20} className="text-gray-600" />
        </button>
        
        {showMoreActionsMenu && (
          <>
            <div 
              className="fixed inset-0 z-10" 
              onClick={() => setShowMoreActionsMenu(false)}
            />
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-20 min-w-[180px]">
              <button
                onClick={handleBulkDelete}
                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
              >
                <Icon name="Trash2" size={16} />
                Bulk delete items
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  // Item List View
  const renderItemList = () => {
    const handleQuantityChange = (itemId, updatedLocations) => {
      // Optimistically update local state
      const allItemsRaw = localStorage.getItem('cargo_inventory_items');
      const allItems = allItemsRaw ? JSON.parse(allItemsRaw) : [];
      const itemIndex = allItems?.findIndex(i => i?.id === itemId);

      if (itemIndex !== -1) {
        // Calculate new totalQty
        const totalQty = updatedLocations?.reduce((sum, loc) => sum + (loc?.qty || 0), 0);

        allItems[itemIndex] = {
          ...allItems?.[itemIndex],
          stockLocations: updatedLocations,
          totalQty: totalQty,
          quantity: totalQty,
          updatedAt: new Date()?.toISOString()
        };
        localStorage.setItem('cargo_inventory_items', JSON.stringify(allItems));
        // Reload data to reflect changes
        loadData();
      }

      // Persist to Supabase
      updateItemStockLocations(itemId, updatedLocations)?.catch(err => {
        console.error('[Inventory] Failed to persist stock locations to Supabase:', err?.message);
      });
    };

    // Use virtualized grid for performance with large lists
    if (filteredItems?.length > 50) {
      return (
        <VirtualizedItemGrid
          items={filteredItems}
          onQuantityChange={handleQuantityChange}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onAddItem={handleAddItemWithContext}
        />
      );
    }

    // Render items with selection action bar
    return (
      <div className="space-y-4">
        {/* Selection Action Bar */}
        {selectionMode && selectedItems?.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium text-blue-900">
                {selectedItems?.length} item{selectedItems?.length !== 1 ? 's' : ''} selected
              </span>
              <button
                onClick={handleSelectAll}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Select All ({filteredItems?.length})
              </button>
              <button
                onClick={handleClearSelection}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => handleBulkActionClick('bulk')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <Icon name="Settings" size={16} />
                <span className="text-sm font-medium">Bulk Actions</span>
              </button>
            </div>
          </div>
        )}
        {filteredItems?.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-2xl">
            <Icon name="Package" size={48} className="mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600">No items found</p>
          </div>
        ) : viewMode === 'list' ? (
          <ItemListView
            items={filteredItems}
            selectionMode={selectionMode}
            selectedItems={selectedItems}
            onToggleSelect={handleToggleItemSelect}
            onItemClick={handleItemClick}
            onQuantityChange={handleQuantityChange}
            vesselLocations={vesselLocations}
            onQuickView={handleQuickView}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
          />
        ) : (
          <div className={`grid ${getGridColumns()} gap-4`}>
            {filteredItems?.map(item => (
              <ItemTile
                key={item?.id}
                item={item}
                onQuantityChange={handleQuantityChange}
                selectionMode={selectionMode}
                isSelected={selectedItems?.includes(item?.id)}
                onToggleSelect={handleToggleItemSelect}
                vesselLocations={vesselLocations}
                onEdit={handleEditItem}
                onDelete={handleDeleteItem}
                canEdit={canAddItem}
                onQuickView={handleQuickView}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 ">
      <Header />
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Page Header - Row 1: Breadcrumb, Title, and Action Buttons */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex-1">
              {/* Breadcrumb */}
              <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                <button onClick={() => navigate('/inventory')} className="hover:text-gray-900">
                  Inventory
                </button>
                {currentL1 && (
                  <>
                    <Icon name="ChevronRight" size={14} />
                    <button onClick={() => navigate(`/inventory/category/${currentL1?.id}`)} className="hover:text-gray-900">
                      {currentL1?.name}
                    </button>
                  </>
                )}
                {currentL2 && (
                  <>
                    <Icon name="ChevronRight" size={14} />
                    <button onClick={() => navigate(`/inventory/category/${currentL1?.id}/sub/${currentL2?.id}`)} className="hover:text-gray-900">
                      {currentL2?.name}
                    </button>
                  </>
                )}
                {currentL3 && (
                  <>
                    <Icon name="ChevronRight" size={14} />
                    <span className="text-gray-900 font-medium">{currentL3?.name}</span>
                  </>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {/* Settings Icon - Command/Chief Only */}
              {canAccessSettings && (
                <button
                  onClick={() => navigate('/inventory-category-settings')}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Category Settings"
                >
                  <Icon name="Settings" size={20} className="text-gray-600" />
                </button>
              )}

              {/* Search */}
              <div className="relative">
                <Icon
                  name="Search"
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e?.target?.value)}
                  className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
                />
              </div>

              {/* Import Button */}
              {canImport && (
                <Button onClick={() => setShowImportModal(true)} iconName="Upload" variant="outline">
                  Import
                </Button>
              )}

              {/* Add Item Button */}
              {canAddItem && (
                <Button onClick={handleAddItem} iconName="Plus">
                  Add Item
                </Button>
              )}

              {/* More Actions Menu (⋯) */}
              {renderMoreActionsMenu()}
            </div>
          </div>
          
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-3xl font-bold text-gray-900">
              {!categoryId ? 'Inventory' : currentL3?.name || currentL2?.name || currentL1?.name}
            </h1>
            
            {/* Department Filter Chips - Command Only */}
            {hasCommandAccess(currentUser) && items?.length > 0 && (
              <DepartmentFilterChips
                selectedDepartment={departmentScope}
                onDepartmentChange={handleDepartmentScopeChange}
              />
            )}
          </div>
        </div>
        
        {/* Content based on view level */}
        {viewLevel === 'L1' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {categoriesL1?.map(category => (
              <CategoryWidget
                key={category?.id}
                category={category}
                level="L1"
                count={getItemCountForCategoryL1(category?.id)}
              />
            ))}
          </div>
        )}

        {viewLevel === 'L2' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {categoriesL2?.length === 0 ? (
              <div className="col-span-full text-center py-12 bg-gray-50 rounded-2xl">
                <Icon name="AlertCircle" size={48} className="mx-auto text-gray-400 mb-3" />
                <p className="text-gray-600">No subcategories found for this category</p>
              </div>
            ) : (
              categoriesL2?.map(category => (
                <CategoryWidget
                  key={category?.id}
                  category={category}
                  level="L2"
                  count={getItemCountForCategoryL2(categoryId, category?.id)}
                />
              ))
            )}
          </div>
        )}

        {viewLevel === 'L2_OR_L3_OR_ITEMS' && categoriesL3?.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {categoriesL3?.map(category => (
              <CategoryWidget
                key={category?.id}
                category={category}
                level="L3"
                count={getItemCountForCategoryL3(categoryId, subcategoryL2Id, category?.id)}
              />
            ))}
          </div>
        )}

        {((viewLevel === 'L2_OR_L3_OR_ITEMS' && categoriesL3?.length === 0) || viewLevel === 'ITEMS') && renderItemList()}
        
        {/* Export Inventory Button - Bottom of Page (Command/Chief/HOD only) */}
        {canExport && (
          <div className="mt-6 flex justify-center">
            <Button
              onClick={() => setShowExportModal(true)}
              iconName="Download"
              variant="outline"
              className="min-w-[240px]"
            >
              Export Inventory (PDF)
            </Button>
          </div>
        )}
        
        {/* Floating Add Button (FAB) on Item Lists - Command/Chief/HOD Only */}
        {((viewLevel === 'L2_OR_L3_OR_ITEMS' && categoriesL3?.length === 0) || viewLevel === 'ITEMS') && canAddItem && (
          <button
            onClick={handleAddItemWithContext}
            className="fixed bottom-8 right-8 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 z-40"
            aria-label="Add Item"
          >
            <Icon name="Plus" size={24} />
          </button>
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
        
        {showImportModal && (
          <ExcelImportModal
            onClose={() => setShowImportModal(false)}
            onSuccess={handleImportSuccess}
          />
        )}
        
        {showBulkDeleteModal && (
          <BulkDeleteConfirmationModal
            scope={{
              categoryL1Name: currentL1?.name,
              categoryL2Name: currentL2?.name || null,
              categoryL3Name: currentL3?.name || null
            }}
            itemCount={getCurrentScopeItemCount()}
            onConfirm={handleBulkDeleteConfirm}
            onClose={() => setShowBulkDeleteModal(false)}
          />
        )}
        
        {showBulkActionsModal && (
          <BulkActionsModal
            selectedItems={selectedItems}
            items={filteredItems}
            onClose={() => setShowBulkActionsModal(false)}
            onComplete={handleBulkActionsComplete}
          />
        )}
        
        {/* Export Inventory Modal */}
        {showExportModal && (
          <ExportInventoryModal
            onClose={() => setShowExportModal(false)}
            currentTaxonomyPath={{
              l1Id: categoryId,
              l2Id: subcategoryL2Id,
              l3Id: subcategoryL3Id,
              l4Id: null
            }}
            currentItems={filteredItems}
            searchQuery={searchQuery}
          />
        )}

        {/* Item Quick View Panel */}
        {quickViewItem && (
          <ItemQuickViewPanel
            item={quickViewItem}
            onClose={() => setQuickViewItem(null)}
            vesselLocations={vesselLocations}
          />
        )}
      </div>
    </div>
  );
};

export default Inventory;
import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import { calculateTotalQuantity, deleteCategory } from '../inventory-management/utils/inventoryStorage';
import { getAllItems } from '../inventory/utils/inventoryStorage';
import { FOLDERS, getCategoriesGroupedByFolder } from '../inventory-management/utils/folderMapping';
import { getCurrentUser, hasCommandAccess } from '../../utils/authStorage';

// ---------------------------------------------------------------------------
// Colour palette — maps import colour labels to subtle, dark-mode-safe values
// ---------------------------------------------------------------------------
const COLOUR_PALETTE = {
  'Yellow':                  '#C9A227',
  'Light Blue':              '#4A9EBF',
  'Red':                     '#C0392B',
  'Dark Purple':             '#7B3FA0',
  'Mustard / Gold':          '#B8860B',
  'Green':                   '#2E8B57',
  'Cream / Beige':           '#A89070',
  'Light Purple / Lavender': '#9B72CF',
  'Teal / Turquoise':        '#2A9D8F',
  'Black':                   '#6B7280',
};

/**
 * Given an array of items, return the most common non-empty colour label
 * found in item.customFields.colour (or item.custom_fields?.colour).
 * Returns null if no colour is found.
 */
const getDominantColour = (items) => {
  if (!items?.length) return null;
  const tally = {};
  items?.forEach(item => {
    const colour =
      item?.customFields?.colour ||
      item?.customFields?.color ||
      item?.custom_fields?.colour ||
      item?.custom_fields?.color ||
      item?.metadata?.colour ||
      item?.metadata?.color ||
      item?.metadata?.Colour ||
      item?.metadata?.Color ||
      null;
    if (colour && typeof colour === 'string' && colour?.trim()) {
      const key = colour?.trim();
      tally[key] = (tally?.[key] || 0) + 1;
    }
  });
  const entries = Object.entries(tally);
  if (!entries?.length) return null;
  entries?.sort((a, b) => b?.[1] - a?.[1]);
  return entries?.[0]?.[0];
};

const FolderDetailView = () => {
  const navigate = useNavigate();
  const { folderId } = useParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState([]);
  const [folderInfo, setFolderInfo] = useState(null);
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false);
  const [showDeleteCategoryModal, setShowDeleteCategoryModal] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState(null);
  const [deleteCategoryOption, setDeleteCategoryOption] = useState('category-only');
  const currentUser = getCurrentUser();
  const isAdmin = hasCommandAccess(currentUser);

  // Get current asset scope
  const getCurrentAssetId = () => {
    return localStorage.getItem('current_asset_id') || 'default-asset';
  };

  useEffect(() => {
    loadFolderCategories();
  }, [folderId]);

  const loadFolderCategories = async () => {
    const assetId = getCurrentAssetId();
    const allItems = await getAllItems();
    const folderData = getCategoriesGroupedByFolder(allItems, assetId);

    // Find current folder
    const folder = FOLDERS?.find(f => f?.id === folderId);
    if (!folder) {
      navigate('/folder-based-inventory-dashboard');
      return;
    }

    setFolderInfo({
      ...folder,
      ...folderData?.[folderId]
    });

    // Get categories for this folder with low stock calculations
    const folderCategories = folderData?.[folderId]?.categories || [];
    
    // Calculate low stock for each category + extract dominant colour
    const categoriesWithStats = folderCategories?.map(category => {
      const categoryItems = allItems?.filter(item => {
        const itemCategory = (item?.category || 'imported')?.toLowerCase()?.trim();
        return itemCategory === category?.normalizedName && (!item?.assetId || item?.assetId === assetId);
      });

      const lowStockCount = categoryItems?.filter(item => {
        const parLevel = parseFloat(item?.parLevel);
        if (!parLevel || isNaN(parLevel)) return false;
        const totalQuantity = calculateTotalQuantity(item);
        return totalQuantity <= parLevel;
      })?.length;

      // Derive colour accent from item metadata
      const dominantColourLabel = getDominantColour(categoryItems);
      const accentColour = dominantColourLabel ? (COLOUR_PALETTE?.[dominantColourLabel] || null) : null;

      return {
        ...category,
        lowStockCount,
        accentColour,
      };
    });

    setCategories(categoriesWithStats);
  };

  const handleCategoryClick = (categoryName) => {
    navigate(`/inventory/${encodeURIComponent(categoryName)}`);
  };

  const handleDeleteCategoryClick = (e, category) => {
    e?.stopPropagation();
    setCategoryToDelete(category);
    setDeleteCategoryOption('category-only');
    setShowDeleteCategoryModal(true);
  };

  const handleConfirmDeleteCategory = () => {
    if (!categoryToDelete) return;

    const assetId = getCurrentAssetId();
    const deleteItems = deleteCategoryOption === 'category-and-items';
    
    const success = deleteCategory(categoryToDelete?.name, deleteItems, assetId);
    
    if (success) {
      setShowDeleteCategoryModal(false);
      setCategoryToDelete(null);
      loadFolderCategories();
    } else {
      alert('Failed to delete category. Please try again.');
    }
  };

  const handleDeleteFolder = () => {
    // In a real implementation, this would move all categories to "Vessel" folder
    // For now, just show confirmation
    alert('Folder deletion would move all categories to Vessel folder. This feature requires backend implementation.');
    setShowDeleteFolderModal(false);
  };

  const filteredCategories = categories?.filter(cat =>
    cat?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase())
  );

  if (!folderInfo) {
    return (
      <div className="min-h-screen bg-background transition-colors duration-300">
        <Header />
        <main className="p-6 max-w-[1400px] mx-auto">
          <p className="text-center text-muted-foreground">Loading...</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Header with Back Button */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate('/folder-based-inventory-dashboard')}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="ArrowLeft" size={24} className="text-foreground" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Icon name={folderInfo?.icon} size={24} className="text-primary" />
              </div>
              <h1 className="text-3xl font-semibold text-foreground font-heading">{folderInfo?.name}</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {folderInfo?.totalItems || 0} items across {folderInfo?.categoryCount || 0} categories
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowDeleteFolderModal(true)}
              className="p-2 hover:bg-error/10 rounded-lg transition-smooth"
              title="Delete Folder"
            >
              <Icon name="Trash2" size={20} className="text-error" />
            </button>
          )}
        </div>

        {/* Search Bar */}
        <div className="mb-8">
          <div className="relative max-w-2xl">
            <Icon
              name="Search"
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e?.target?.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
            />
          </div>
        </div>

        {/* Category Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredCategories?.map((category) => (
            <div
              key={category?.id}
              className="bg-card rounded-2xl p-5 shadow-sm hover:shadow-md transition-smooth cursor-pointer group relative"
              style={
                category?.accentColour
                  ? { border: `1.5px solid ${category?.accentColour}40` }
                  : { border: '1px solid var(--color-border, #e2e8f0)' }
              }
            >
              {/* Delete Button (Admin Only) */}
              {isAdmin && (
                <button
                  onClick={(e) => handleDeleteCategoryClick(e, category)}
                  className="absolute top-3 right-3 p-1.5 hover:bg-error/10 rounded-lg transition-smooth opacity-0 group-hover:opacity-100"
                  title="Delete Category"
                >
                  <Icon name="Trash2" size={16} className="text-error" />
                </button>
              )}

              <div onClick={() => handleCategoryClick(category?.name)}>
                {/* Category Icon with optional colour dot */}
                <div className="relative w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-smooth">
                  <Icon name={category?.icon} size={24} className="text-primary" />
                  {/* Colour dot — only shown when accent colour is present */}
                  {category?.accentColour && (
                    <span
                      className="absolute -top-1 -right-1 w-3 h-3 rounded-full ring-2 ring-card"
                      style={{ backgroundColor: category?.accentColour }}
                      aria-hidden="true"
                    />
                  )}
                </div>

                {/* Category Name */}
                <h3
                  className="text-lg font-semibold mb-2 font-heading"
                  style={{ color: category?.accentColour || 'var(--color-foreground)' }}
                >
                  {category?.name}
                </h3>

                {/* Statistics */}
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-2xl font-bold text-foreground">{category?.itemCount || 0}</p>
                    <p className="text-xs text-muted-foreground">{category?.itemCount === 1 ? 'item' : 'items'}</p>
                  </div>
                  {category?.lowStockCount > 0 && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-warning/10 rounded-lg">
                      <Icon name="AlertCircle" size={14} className="text-warning" />
                      <span className="text-xs font-medium text-warning">{category?.lowStockCount}</span>
                    </div>
                  )}
                </div>

                {/* Arrow */}
                <div className="flex items-center justify-end">
                  <Icon
                    name="ChevronRight"
                    size={16}
                    className="text-primary group-hover:translate-x-1 transition-smooth"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredCategories?.length === 0 && (
          <div className="text-center py-12">
            <Icon name="Package" size={48} className="text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">No categories in this folder yet</p>
            <Button
              variant="default"
              iconName="Plus"
              onClick={() => navigate('/inventory')}
              className="mt-4"
            >
              Add First Item
            </Button>
          </div>
        )}
      </main>
      {/* Delete Folder Confirmation Modal */}
      {showDeleteFolderModal && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowDeleteFolderModal(false)}
          />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-error/10 flex items-center justify-center flex-shrink-0">
                  <Icon name="AlertTriangle" size={24} className="text-error" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-2 font-heading">
                    Delete Folder?
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Deleting "{folderInfo?.name}" will move all {folderInfo?.categoryCount} categories to the Vessel folder. Items will not be deleted.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteFolderModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={handleDeleteFolder}
                  className="bg-error hover:bg-error/90"
                >
                  Delete Folder
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* Delete Category Confirmation Modal */}
      {showDeleteCategoryModal && categoryToDelete && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowDeleteCategoryModal(false)}
          />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center flex-shrink-0">
                  <Icon name="AlertTriangle" size={24} className="text-warning" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground mb-2 font-heading">
                    Delete Category?
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    You are about to delete "{categoryToDelete?.name}" with {categoryToDelete?.itemCount} items.
                  </p>
                  
                  {/* Delete Options */}
                  <div className="space-y-3">
                    <label className="flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer hover:bg-muted/50 transition-smooth">
                      <input
                        type="radio"
                        name="deleteOption"
                        value="category-only"
                        checked={deleteCategoryOption === 'category-only'}
                        onChange={(e) => setDeleteCategoryOption(e?.target?.value)}
                        className="mt-1"
                      />
                      <div>
                        <p className="text-sm font-medium text-foreground">Delete category only</p>
                        <p className="text-xs text-muted-foreground">Items will be moved to "Imported" category</p>
                      </div>
                    </label>
                    
                    <label className="flex items-start gap-3 p-3 border border-error/50 rounded-lg cursor-pointer hover:bg-error/5 transition-smooth">
                      <input
                        type="radio"
                        name="deleteOption"
                        value="category-and-items"
                        checked={deleteCategoryOption === 'category-and-items'}
                        onChange={(e) => setDeleteCategoryOption(e?.target?.value)}
                        className="mt-1"
                      />
                      <div>
                        <p className="text-sm font-medium text-error">Delete category and all items</p>
                        <p className="text-xs text-muted-foreground">This action cannot be undone</p>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 justify-end mt-6">
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteCategoryModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={handleConfirmDeleteCategory}
                  className={deleteCategoryOption === 'category-and-items' ? 'bg-error hover:bg-error/90' : ''}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default FolderDetailView;
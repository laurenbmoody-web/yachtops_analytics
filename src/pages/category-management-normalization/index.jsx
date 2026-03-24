import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import { getAllItems, deleteCategory } from '../inventory-management/utils/inventoryStorage';
import { normalizeCategoryName, getCategoryDisplayName, getFolderForCategory, FOLDERS } from '../inventory-management/utils/folderMapping';
import { getCurrentUser, hasCommandAccess } from '../../utils/authStorage';

const CategoryManagementNormalization = () => {
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const currentUser = getCurrentUser();
  const isAdmin = hasCommandAccess(currentUser);

  // Redirect non-admin users
  useEffect(() => {
    if (!isAdmin) {
      navigate('/dashboard');
    }
  }, [isAdmin, navigate]);

  // Get current asset scope
  const getCurrentAssetId = () => {
    return localStorage.getItem('current_asset_id') || 'default-asset';
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = () => {
    const assetId = getCurrentAssetId();
    const allItems = getAllItems();
    
    // Filter by asset
    const itemsForAsset = allItems?.filter(item => !item?.assetId || item?.assetId === assetId);
    
    // Group by raw category name (before normalization)
    const categoryMap = {};
    
    itemsForAsset?.forEach(item => {
      const rawCategory = item?.category || 'Imported';
      
      if (!categoryMap?.[rawCategory]) {
        categoryMap[rawCategory] = {
          rawName: rawCategory,
          normalizedName: normalizeCategoryName(rawCategory),
          displayName: getCategoryDisplayName(rawCategory),
          folderId: getFolderForCategory(rawCategory),
          itemCount: 0,
          items: []
        };
      }
      
      categoryMap[rawCategory].itemCount++;
      categoryMap?.[rawCategory]?.items?.push(item);
    });
    
    // Convert to array
    const categoryList = Object.values(categoryMap)?.map(cat => ({
      ...cat,
      needsNormalization: cat?.rawName?.toLowerCase() !== cat?.normalizedName,
      folderName: FOLDERS?.find(f => f?.id === cat?.folderId)?.name || 'Vessel'
    }));
    
    // Sort by item count descending
    categoryList?.sort((a, b) => b?.itemCount - a?.itemCount);
    
    setCategories(categoryList);
  };

  const handleSelectCategory = (categoryRawName) => {
    setSelectedCategories(prev => {
      if (prev?.includes(categoryRawName)) {
        return prev?.filter(c => c !== categoryRawName);
      } else {
        return [...prev, categoryRawName];
      }
    });
  };

  const handleBulkNormalize = () => {
    // Apply normalization to selected categories
    const assetId = getCurrentAssetId();
    const allItems = getAllItems();
    
    const updated = allItems?.map(item => {
      if (selectedCategories?.includes(item?.category)) {
        return {
          ...item,
          category: getCategoryDisplayName(item?.category)
        };
      }
      return item;
    });
    
    localStorage.setItem('cargo_inventory_items', JSON.stringify(updated));
    setSelectedCategories([]);
    loadCategories();
  };

  const handleMergeCategories = () => {
    if (selectedCategories?.length < 2) {
      alert('Please select at least 2 categories to merge');
      return;
    }
    setShowMergeModal(true);
  };

  const handleConfirmMerge = () => {
    if (!mergeTarget) {
      alert('Please select a target category');
      return;
    }
    
    const allItems = getAllItems();
    const updated = allItems?.map(item => {
      if (selectedCategories?.includes(item?.category)) {
        return {
          ...item,
          category: mergeTarget
        };
      }
      return item;
    });
    
    localStorage.setItem('cargo_inventory_items', JSON.stringify(updated));
    setShowMergeModal(false);
    setMergeTarget('');
    setSelectedCategories([]);
    loadCategories();
  };

  const handleDeleteCategory = (categoryRawName, itemCount) => {
    const confirmed = window.confirm(
      `Delete category "${categoryRawName}" with ${itemCount} items?\n\nItems will be moved to "Imported" category.`
    );
    
    if (confirmed) {
      const assetId = getCurrentAssetId();
      const success = deleteCategory(categoryRawName, false, assetId);
      
      if (success) {
        loadCategories();
      } else {
        alert('Failed to delete category');
      }
    }
  };

  const filteredCategories = categories?.filter(cat =>
    cat?.rawName?.toLowerCase()?.includes(searchQuery?.toLowerCase()) ||
    cat?.displayName?.toLowerCase()?.includes(searchQuery?.toLowerCase())
  );

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <button
              onClick={() => navigate('/folder-based-inventory-dashboard')}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="ArrowLeft" size={24} className="text-foreground" />
            </button>
            <div className="flex-1">
              <h1 className="text-4xl font-semibold text-foreground mb-2 font-heading">
                Category Management
              </h1>
              <p className="text-base text-muted-foreground">
                Normalize, merge, and organize inventory categories
              </p>
            </div>
          </div>
        </div>

        {/* Search and Actions */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
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
                  className="w-full pl-10 pr-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
            
            {/* Bulk Actions */}
            {selectedCategories?.length > 0 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  iconName="RefreshCw"
                  onClick={handleBulkNormalize}
                >
                  Normalize ({selectedCategories?.length})
                </Button>
                <Button
                  variant="outline"
                  iconName="Merge"
                  onClick={handleMergeCategories}
                  disabled={selectedCategories?.length < 2}
                >
                  Merge ({selectedCategories?.length})
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Category Table */}
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted border-b border-border">
                <tr>
                  <th className="text-left p-4 text-sm font-semibold text-foreground w-12">
                    <input
                      type="checkbox"
                      checked={selectedCategories?.length === filteredCategories?.length && filteredCategories?.length > 0}
                      onChange={(e) => {
                        if (e?.target?.checked) {
                          setSelectedCategories(filteredCategories?.map(c => c?.rawName));
                        } else {
                          setSelectedCategories([]);
                        }
                      }}
                      className="rounded"
                    />
                  </th>
                  <th className="text-left p-4 text-sm font-semibold text-foreground">Original Name</th>
                  <th className="text-left p-4 text-sm font-semibold text-foreground">Normalized Name</th>
                  <th className="text-left p-4 text-sm font-semibold text-foreground">Folder</th>
                  <th className="text-left p-4 text-sm font-semibold text-foreground">Items</th>
                  <th className="text-left p-4 text-sm font-semibold text-foreground">Status</th>
                  <th className="text-left p-4 text-sm font-semibold text-foreground w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCategories?.map((category, index) => (
                  <tr
                    key={category?.rawName}
                    className={`border-b border-border hover:bg-muted/50 transition-smooth ${
                      index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                    }`}
                  >
                    <td className="p-4">
                      <input
                        type="checkbox"
                        checked={selectedCategories?.includes(category?.rawName)}
                        onChange={() => handleSelectCategory(category?.rawName)}
                        className="rounded"
                      />
                    </td>
                    <td className="p-4">
                      <span className="text-sm text-foreground font-medium">{category?.rawName}</span>
                    </td>
                    <td className="p-4">
                      <span className="text-sm text-foreground">{category?.displayName}</span>
                    </td>
                    <td className="p-4">
                      <span className="text-sm text-muted-foreground">{category?.folderName}</span>
                    </td>
                    <td className="p-4">
                      <span className="text-sm font-medium text-foreground">{category?.itemCount}</span>
                    </td>
                    <td className="p-4">
                      {category?.needsNormalization ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-warning/10 text-warning text-xs font-medium rounded-lg">
                          <Icon name="AlertCircle" size={12} />
                          Needs normalization
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-success/10 text-success text-xs font-medium rounded-lg">
                          <Icon name="CheckCircle2" size={12} />
                          Normalized
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => handleDeleteCategory(category?.rawName, category?.itemCount)}
                        className="p-1.5 hover:bg-error/10 rounded-lg transition-smooth"
                        title="Delete Category"
                      >
                        <Icon name="Trash2" size={16} className="text-error" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Empty State */}
        {filteredCategories?.length === 0 && (
          <div className="text-center py-12">
            <Icon name="Package" size={48} className="text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">No categories found</p>
          </div>
        )}
      </main>
      {/* Merge Modal */}
      {showMergeModal && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowMergeModal(false)}
          />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
              <div className="mb-4">
                <h3 className="text-xl font-semibold text-foreground mb-2 font-heading">
                  Merge Categories
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Merging {selectedCategories?.length} categories. Select the target category:
                </p>
                
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {selectedCategories?.map(catName => {
                    const cat = categories?.find(c => c?.rawName === catName);
                    return (
                      <label
                        key={catName}
                        className="flex items-center gap-3 p-3 border border-border rounded-lg cursor-pointer hover:bg-muted/50 transition-smooth"
                      >
                        <input
                          type="radio"
                          name="mergeTarget"
                          value={catName}
                          checked={mergeTarget === catName}
                          onChange={(e) => setMergeTarget(e?.target?.value)}
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground">{catName}</p>
                          <p className="text-xs text-muted-foreground">{cat?.itemCount} items</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setShowMergeModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={handleConfirmMerge}
                  disabled={!mergeTarget}
                >
                  Merge Categories
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CategoryManagementNormalization;

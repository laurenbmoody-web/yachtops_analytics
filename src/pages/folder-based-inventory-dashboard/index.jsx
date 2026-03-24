import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import { getAllItems } from '../inventory/utils/inventoryStorage';
import { FOLDERS, getCategoriesGroupedByFolder } from '../inventory-management/utils/folderMapping';
import { getCurrentUser } from '../../utils/authStorage';
import { 
  getDepartmentScope, 
  setDepartmentScope, 
  isCommandRole, 
  DEPARTMENT_OPTIONS 
} from '../../utils/departmentScopeStorage';

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


const FolderBasedInventoryDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [folders, setFolders] = useState([]);
  const currentUser = getCurrentUser();
  
  // Department scope state (Command only)
  const [departmentScope, setDepartmentScopeState] = useState(() => getDepartmentScope());
  
  // Handle department scope change (Command only)
  const handleDepartmentScopeChange = (newScope) => {
    setDepartmentScope(newScope);
    setDepartmentScopeState(newScope);
  };

  // Get current asset scope
  const getCurrentAssetId = () => {
    return localStorage.getItem('current_asset_id') || 'default-asset';
  };

  // Load folders and items (enforcement now at data level)
  useEffect(() => {
    const load = async () => {
      const allItems = await getAllItems();
      const categoriesGrouped = getCategoriesGroupedByFolder(allItems);

      // Map to folder structure with counts
      const folderData = FOLDERS?.map(folder => {
        const folderInfo = categoriesGrouped?.[folder?.id] || { categories: [], totalItems: 0, categoryCount: 0 };
        const categories = folderInfo?.categories || [];
        const itemCount = categories?.reduce((sum, cat) => sum + (cat?.itemCount || 0), 0);

        // Derive accent colour from all items in this folder
        const folderItems = allItems?.filter(item =>
          categories?.some(cat =>
            (item?.category || 'imported')?.toLowerCase()?.trim() === cat?.normalizedName
          )
        );
        const dominantColourLabel = getDominantColour(folderItems);
        const accentColour = dominantColourLabel ? (COLOUR_PALETTE?.[dominantColourLabel] || null) : null;

        return {
          ...folder,
          itemCount,
          categories,
          totalItems: folderInfo?.totalItems || 0,
          categoryCount: folderInfo?.categoryCount || 0,
          accentColour,
        };
      });

      setFolders(folderData);
    };
    load();
  }, [departmentScope]);

  // Force refresh when navigating back from import
  useEffect(() => {
    if (location?.state?.refresh || location?.state?.fromImport) {
      loadFolders();
      window.history?.replaceState({}, document.title);
    }
  }, [location]);

  const loadFolders = async () => {
    const assetId = getCurrentAssetId();
    const allItems = await getAllItems();
    
    // Filter items by department scope
    const scopedItems = filterItemsByDepartmentScope(allItems);
    
    const folderData = getCategoriesGroupedByFolder(scopedItems, assetId);

    // Convert to array and add folder metadata
    const folderList = FOLDERS?.map(folder => {
      const folderInfo = folderData?.[folder?.id] || { categories: [], totalItems: 0, categoryCount: 0 };
      const categories = folderInfo?.categories || [];

      // Derive accent colour from all items in this folder
      const folderItems = scopedItems?.filter(item =>
        categories?.some(cat =>
          (item?.category || 'imported')?.toLowerCase()?.trim() === cat?.normalizedName
        )
      );
      const dominantColourLabel = getDominantColour(folderItems);
      const accentColour = dominantColourLabel ? (COLOUR_PALETTE?.[dominantColourLabel] || null) : null;

      return {
        ...folder,
        ...folderInfo,
        thumbnail: '/assets/images/no_image.png',
        accentColour,
      };
    });

    setFolders(folderList);
  };
  
  // Map categories to departments (same logic as inventory-management)
  const getCategoryDepartment = (categoryName) => {
    const normalized = categoryName?.toLowerCase();
    if (normalized?.includes('alcohol') || normalized?.includes('bar') || 
        normalized?.includes('pantry') || normalized?.includes('cold') || 
        normalized?.includes('galley')) {
      return 'GALLEY';
    }
    if (normalized?.includes('guest') || normalized?.includes('amenities') || 
        normalized?.includes('uniform')) {
      return 'INTERIOR';
    }
    if (normalized?.includes('spare') || normalized?.includes('parts') || 
        normalized?.includes('engineering')) {
      return 'ENGINEERING';
    }
    if (normalized?.includes('deck') || normalized?.includes('safety') || 
        normalized?.includes('compliance')) {
      return 'DECK';
    }
    return 'INTERIOR'; // Default
  };
  
  // Filter items by department scope
  const filterItemsByDepartmentScope = (items) => {
    if (!items) return [];
    
    // Command with 'ALL' scope sees everything
    if (isCommandRole(currentUser) && departmentScope === 'ALL') {
      return items;
    }
    
    // Command with specific department selected
    if (isCommandRole(currentUser) && departmentScope !== 'ALL') {
      return items?.filter(item => {
        const catDept = getCategoryDepartment(item?.category);
        return catDept === departmentScope;
      });
    }
    
    // Non-Command users: filter to their own department
    const userDept = currentUser?.department?.toUpperCase();
    return items?.filter(item => {
      const catDept = getCategoryDepartment(item?.category);
      return catDept === userDept;
    });
  };

  const handleFolderClick = (folderId) => {
    navigate(`/inventory/folder/${folderId}`);
  };

  const filteredFolders = folders?.filter(folder =>
    folder?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-semibold text-foreground mb-2 font-heading">Inventory</h1>
          <p className="text-base text-muted-foreground">Organized by operational folders</p>
        </div>

        {/* Department Scope Chip (Command Only) */}
        {isCommandRole(currentUser) && (
          <div className="mb-6 flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg w-fit">
            <span className="text-sm font-medium text-muted-foreground">Department:</span>
            <select
              value={departmentScope}
              onChange={(e) => handleDepartmentScopeChange(e?.target?.value)}
              className="text-sm font-medium text-foreground bg-transparent border-none outline-none cursor-pointer"
            >
              {DEPARTMENT_OPTIONS?.map(option => (
                <option key={option?.value} value={option?.value}>
                  {option?.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Global Search Bar */}
        <div className="mb-8">
          <div className="relative max-w-2xl">
            <Icon
              name="Search"
              size={20}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Search all inventory..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e?.target?.value)}
              className="w-full pl-12 pr-4 py-4 bg-card border border-border rounded-2xl text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-sm"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 mb-8">
          <Button
            variant="default"
            iconName="Plus"
            onClick={() => navigate('/inventory')}
          >
            Add Item
          </Button>
          <Button
            variant="outline"
            iconName="FileUp"
            onClick={() => navigate('/template-based-inventory-import')}
          >
            Import Inventory
          </Button>
          <Button
            variant="outline"
            iconName="ClipboardCheck"
            onClick={() => navigate('/inventory/stock-check')}
          >
            Stock Check
          </Button>
          <Button
            variant="outline"
            iconName="FolderTree"
            onClick={() => navigate('/category-management-normalization')}
          >
            Manage Categories
          </Button>
        </div>

        {/* Folder Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {filteredFolders?.map((folder) => (
            <div
              key={folder?.id}
              onClick={() => handleFolderClick(folder?.id)}
              className="bg-card rounded-2xl p-6 shadow-sm hover:shadow-md transition-smooth cursor-pointer group relative"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {/* Folder Icon */}
              <div className="relative w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-smooth">
                <Icon
                  name={folder?.icon}
                  size={28}
                  className="text-primary"
                />
              </div>

              {/* Folder Name */}
              <h3
                className="text-xl font-semibold mb-2 font-heading"
              >
                {folder?.name}
              </h3>

              {/* Statistics */}
              <div className="space-y-1">
                <p className="text-2xl font-bold text-foreground">
                  {folder?.totalItems || 0}
                </p>
                <p className="text-sm text-muted-foreground">
                  {folder?.totalItems === 1 ? 'item' : 'items'} across {folder?.categoryCount || 0} {folder?.categoryCount === 1 ? 'category' : 'categories'}
                </p>
              </div>

              {/* Arrow Icon */}
              <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
                <span className="text-sm text-primary font-medium">View Categories</span>
                <Icon
                  name="ChevronRight"
                  size={18}
                  className="text-primary group-hover:translate-x-1 transition-smooth"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredFolders?.length === 0 && (
          <div className="text-center py-12">
            <Icon name="FolderOpen" size={48} className="text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">No folders found</p>
          </div>
        )}

        {/* Quick Link to Old View */}
        <div className="mt-8 pt-8 border-t border-border">
          <button
            onClick={() => navigate('/inventory')}
            className="text-sm text-muted-foreground hover:text-foreground transition-smooth flex items-center gap-2"
          >
            <Icon name="List" size={16} />
            View flat category list
          </button>
        </div>
      </main>
    </div>
  );
};

export default FolderBasedInventoryDashboard;
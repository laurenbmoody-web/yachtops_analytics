import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import AddItemDrawer from './components/AddItemDrawer';
import { getAllItems } from './utils/inventoryStorage';
import { 
  getAllCategories, 
  getSubcategoriesL2ByCategory,
  getSubcategoriesL3ByL2,
  getItemCountForCategory,
  getItemCountForSubcategoryL2,
  getItemCountForSubcategoryL3,
  getCategoriesWithDepartmentScope,
  createPresetTaxonomy,
  isPresetInitialized
} from './utils/taxonomyStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { 
  getDepartmentScope, 
  setDepartmentScope, 
  isCommandRole, 
  DEPARTMENT_OPTIONS 
} from '../../utils/departmentScopeStorage';

const InventoryManagement = () => {
  const navigate = useNavigate();
  const { categoryId, subcategoryL2Id, subcategoryL3Id } = useParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [items, setItems] = useState([]);
  const currentUser = getCurrentUser();
  
  // Department scope state (Command only)
  const [departmentScope, setDepartmentScopeState] = useState(() => getDepartmentScope());
  
  // Initialize preset taxonomy on first load
  useEffect(() => {
    if (!isPresetInitialized()) {
      createPresetTaxonomy();
    }
  }, []);
  
  // Handle department scope change (Command only)
  const handleDepartmentScopeChange = (newScope) => {
    setDepartmentScope(newScope);
    setDepartmentScopeState(newScope);
  };
  
  // Determine current view level
  const viewLevel = useMemo(() => {
    if (subcategoryL3Id) return 'items';
    if (subcategoryL2Id) {
      // Check if L3 exists for this L2
      const l3Subs = getSubcategoriesL3ByL2(subcategoryL2Id);
      return l3Subs?.length > 0 ? 'l3' : 'items';
    }
    if (categoryId) return 'l2';
    return 'l1';
  }, [categoryId, subcategoryL2Id, subcategoryL3Id]);
  
  // Load data based on current level
  useEffect(() => {
    loadData();
  }, [categoryId, subcategoryL2Id, subcategoryL3Id, departmentScope]);
  
  const loadData = () => {
    if (viewLevel === 'items') {
      // Load items
      const allItems = getAllItems();
      let filtered = allItems;
      
      if (subcategoryL3Id) {
        filtered = allItems?.filter(item => 
          item?.categoryId === categoryId &&
          item?.subcategoryL2Id === subcategoryL2Id &&
          item?.subcategoryL3Id === subcategoryL3Id
        );
      } else if (subcategoryL2Id) {
        filtered = allItems?.filter(item => 
          item?.categoryId === categoryId &&
          item?.subcategoryL2Id === subcategoryL2Id &&
          !item?.subcategoryL3Id
        );
      }
      
      setItems(filtered);
    }
  };
  
  // Get current level data for display
  const getCurrentLevelData = () => {
    if (viewLevel === 'l1') {
      return getCategoriesWithDepartmentScope()?.map(cat => ({
        id: cat?.id,
        name: cat?.name,
        icon: cat?.icon,
        itemCount: getItemCountForCategory(cat?.id),
        type: 'category'
      }));
    }
    
    if (viewLevel === 'l2') {
      return getSubcategoriesL2ByCategory(categoryId)?.map(sub => ({
        id: sub?.id,
        name: sub?.name,
        icon: 'Folder',
        itemCount: getItemCountForSubcategoryL2(categoryId, sub?.id),
        type: 'subcategoryL2'
      }));
    }
    
    if (viewLevel === 'l3') {
      return getSubcategoriesL3ByL2(subcategoryL2Id)?.map(sub => ({
        id: sub?.id,
        name: sub?.name,
        icon: 'Folder',
        itemCount: getItemCountForSubcategoryL3(categoryId, subcategoryL2Id, sub?.id),
        type: 'subcategoryL3'
      }));
    }
    
    return [];
  };
  
  const handleCardClick = (card) => {
    if (card?.type === 'category') {
      navigate(`/inventory/category/${card?.id}`);
    } else if (card?.type === 'subcategoryL2') {
      const l3Subs = getSubcategoriesL3ByL2(card?.id);
      if (l3Subs?.length > 0) {
        navigate(`/inventory/category/${categoryId}/sub/${card?.id}`);
      } else {
        navigate(`/inventory/category/${categoryId}/sub/${card?.id}/items`);
      }
    } else if (card?.type === 'subcategoryL3') {
      navigate(`/inventory/category/${categoryId}/sub/${subcategoryL2Id}/sub3/${card?.id}/items`);
    }
  };
  
  const handleItemClick = (itemId) => {
    navigate(`/inventory/${categoryId}/${itemId}`);
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
  
  const getPageTitle = () => {
    if (viewLevel === 'items') {
      if (subcategoryL3Id) {
        const l3 = getSubcategoriesL3ByL2(subcategoryL2Id)?.find(s => s?.id === subcategoryL3Id);
        return l3?.name || 'Items';
      }
      const l2 = getSubcategoriesL2ByCategory(categoryId)?.find(s => s?.id === subcategoryL2Id);
      return l2?.name || 'Items';
    }
    if (viewLevel === 'l3') {
      const l2 = getSubcategoriesL2ByCategory(categoryId)?.find(s => s?.id === subcategoryL2Id);
      return l2?.name || 'Subcategories';
    }
    if (viewLevel === 'l2') {
      const cat = getAllCategories()?.find(c => c?.id === categoryId);
      return cat?.name || 'Subcategories';
    }
    return 'Inventory';
  };
  
  const currentLevelData = getCurrentLevelData();
  const filteredData = currentLevelData?.filter(item => 
    item?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase())
  );
  
  const filteredItems = items?.filter(item => 
    item?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          {(categoryId || subcategoryL2Id || subcategoryL3Id) && (
            <button
              onClick={handleBack}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="ArrowLeft" size={24} className="text-foreground" />
            </button>
          )}
          <div className="flex-1">
            <h1 className="text-3xl font-semibold text-foreground font-heading">{getPageTitle()}</h1>
            <p className="text-sm text-muted-foreground">
              {viewLevel === 'items' ? `${filteredItems?.length} items` : `${filteredData?.length} categories`}
            </p>
          </div>
          {viewLevel === 'items' && (
            <>
              <Button
                variant="default"
                iconName="Plus"
                onClick={() => setIsAddItemOpen(true)}
              >
                Add Item
              </Button>
              <Button
                variant="outline"
                iconName="FileUp"
                onClick={() => navigate('/template-based-inventory-import')}
              >
                Import CSV
              </Button>
            </>
          )}
        </div>
        
        {/* Department Scope Toggle (Command only) */}
        {isCommandRole(currentUser) && (
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 bg-card border border-border rounded-xl p-1.5 shadow-sm">
              <span className="text-sm font-medium text-muted-foreground px-2">Department:</span>
              {DEPARTMENT_OPTIONS?.map(option => (
                <button
                  key={option?.value}
                  onClick={() => handleDepartmentScopeChange(option?.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-smooth ${
                    departmentScope === option?.value
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  {option?.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-6">
          <div className="relative">
            <Icon
              name="Search"
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e?.target?.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Category/Subcategory Cards OR Item List */}
        {viewLevel !== 'items' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredData?.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <Icon name="Package" size={48} className="text-muted-foreground mx-auto mb-4" />
                <p className="text-lg text-muted-foreground">No categories found</p>
              </div>
            ) : (
              filteredData?.map((card) => (
                <div
                  key={card?.id}
                  onClick={() => handleCardClick(card)}
                  className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-smooth cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Icon name={card?.icon} size={24} className="text-primary" />
                    </div>
                    <Icon name="ChevronRight" size={20} className="text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">{card?.name}</h3>
                  <p className="text-sm text-muted-foreground">{card?.itemCount} items</p>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredItems?.length === 0 ? (
              <div className="text-center py-12">
                <Icon name="Package" size={48} className="text-muted-foreground mx-auto mb-4" />
                <p className="text-lg text-muted-foreground">No items found</p>
                <Button
                  variant="default"
                  iconName="Plus"
                  onClick={() => setIsAddItemOpen(true)}
                  className="mt-4"
                >
                  Add First Item
                </Button>
              </div>
            ) : (
              filteredItems?.map((item) => (
                <div
                  key={item?.id}
                  onClick={() => handleItemClick(item?.id)}
                  className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-smooth cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center overflow-hidden">
                      {item?.imageUrl ? (
                        <img src={item?.imageUrl} alt={item?.name} className="w-full h-full object-cover" />
                      ) : (
                        <Icon name="Package" size={24} className="text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-foreground">{item?.name}</h3>
                      <p className="text-sm text-muted-foreground">{item?.primaryLocation}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-foreground">{item?.quantity}</p>
                      <p className="text-sm text-muted-foreground">{item?.unit}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
      {/* Add Item Drawer */}
      {isAddItemOpen && (
        <AddItemDrawer
          isOpen={isAddItemOpen}
          onClose={() => setIsAddItemOpen(false)}
          mode="add"
          categoryId={categoryId}
          subcategoryL2Id={subcategoryL2Id}
          subcategoryL3Id={subcategoryL3Id}
          onSave={loadData}
        />
      )}
    </div>
  );
};

export default InventoryManagement;
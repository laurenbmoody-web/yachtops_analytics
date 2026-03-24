import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import { 
  getAllCategories, 
  getSubcategoriesL2ByCategory, 
  getSubcategoriesL3ByL2,
  getCategoryById,
  getSubcategoryL2ById,
  getSubcategoryL3ById,
  createPresetTaxonomy
} from '../inventory-management/utils/taxonomyStorage';
import { getAllItems } from '../inventory-management/utils/inventoryStorage';
import { useAuth } from '../../contexts/AuthContext';
import { 
  getDepartmentScope, 
  setDepartmentScope, 
  isCommandRole, 
  DEPARTMENT_OPTIONS 
} from '../../utils/departmentScopeStorage';

const HierarchicalInventoryManagement = () => {
  const navigate = useNavigate();
  const { categoryId, subcategoryL2Id, subcategoryL3Id } = useParams();
  const { currentUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState([]);
  const [subcategoriesL2, setSubcategoriesL2] = useState([]);
  const [subcategoriesL3, setSubcategoriesL3] = useState([]);
  const [items, setItems] = useState([]);
  const [currentLevel, setCurrentLevel] = useState('category'); // 'category', 'subcategoryL2', 'subcategoryL3', 'items'
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  
  // Department scope state (Command only)
  const [departmentScope, setDepartmentScopeState] = useState(() => getDepartmentScope());
  
  // Handle department scope change (Command only)
  const handleDepartmentScopeChange = (newScope) => {
    setDepartmentScope(newScope);
    setDepartmentScopeState(newScope);
    loadData(); // Reload data with new scope
  };
  
  useEffect(() => {
    // Initialize preset taxonomy if needed
    const existingCategories = getAllCategories();
    if (existingCategories?.length === 0) {
      createPresetTaxonomy();
    }
    
    loadData();
  }, [categoryId, subcategoryL2Id, subcategoryL3Id, departmentScope]);
  
  const loadData = () => {
    if (!categoryId) {
      // Level 1: Show all categories
      setCurrentLevel('category');
      const cats = getAllCategories();
      setCategories(cats);
      setBreadcrumbs([{ label: 'Inventory', path: '/hierarchical-inventory-management' }]);
    } else if (categoryId && !subcategoryL2Id) {
      // Level 2: Show subcategories L2 for selected category
      setCurrentLevel('subcategoryL2');
      const subs = getSubcategoriesL2ByCategory(categoryId);
      setSubcategoriesL2(subs);
      
      const category = getCategoryById(categoryId);
      setBreadcrumbs([
        { label: 'Inventory', path: '/hierarchical-inventory-management' },
        { label: category?.name || 'Category', path: `/hierarchical-inventory-management/category/${categoryId}` }
      ]);
    } else if (categoryId && subcategoryL2Id && !subcategoryL3Id) {
      // Check if L3 exists for this L2
      const subsL3 = getSubcategoriesL3ByL2(subcategoryL2Id);
      
      if (subsL3?.length > 0) {
        // Level 3: Show subcategories L3
        setCurrentLevel('subcategoryL3');
        setSubcategoriesL3(subsL3);
      } else {
        // No L3: Show items
        setCurrentLevel('items');
        loadItems(categoryId, subcategoryL2Id, null);
      }
      
      const category = getCategoryById(categoryId);
      const subL2 = getSubcategoryL2ById(subcategoryL2Id);
      setBreadcrumbs([
        { label: 'Inventory', path: '/hierarchical-inventory-management' },
        { label: category?.name || 'Category', path: `/hierarchical-inventory-management/category/${categoryId}` },
        { label: subL2?.name || 'Subcategory', path: `/hierarchical-inventory-management/category/${categoryId}/sub/${subcategoryL2Id}` }
      ]);
    } else if (categoryId && subcategoryL2Id && subcategoryL3Id) {
      // Level 4: Show items for L3
      setCurrentLevel('items');
      loadItems(categoryId, subcategoryL2Id, subcategoryL3Id);
      
      const category = getCategoryById(categoryId);
      const subL2 = getSubcategoryL2ById(subcategoryL2Id);
      const subL3 = getSubcategoryL3ById(subcategoryL3Id);
      setBreadcrumbs([
        { label: 'Inventory', path: '/hierarchical-inventory-management' },
        { label: category?.name || 'Category', path: `/hierarchical-inventory-management/category/${categoryId}` },
        { label: subL2?.name || 'Subcategory L2', path: `/hierarchical-inventory-management/category/${categoryId}/sub/${subcategoryL2Id}` },
        { label: subL3?.name || 'Subcategory L3', path: `/hierarchical-inventory-management/category/${categoryId}/sub/${subcategoryL2Id}/sub3/${subcategoryL3Id}` }
      ]);
    }
  };
  
  const loadItems = (catId, subL2Id, subL3Id) => {
    const allItems = getAllItems();
    const filtered = allItems?.filter(item => {
      const matchCategory = item?.categoryId === catId;
      const matchL2 = item?.subcategoryL2Id === subL2Id;
      const matchL3 = subL3Id ? item?.subcategoryL3Id === subL3Id : true;
      return matchCategory && matchL2 && matchL3;
    });
    setItems(filtered);
  };
  
  const handleCategoryClick = (category) => {
    navigate(`/hierarchical-inventory-management/category/${category?.id}`);
  };
  
  const handleSubcategoryL2Click = (subL2) => {
    navigate(`/hierarchical-inventory-management/category/${categoryId}/sub/${subL2?.id}`);
  };
  
  const handleSubcategoryL3Click = (subL3) => {
    navigate(`/hierarchical-inventory-management/category/${categoryId}/sub/${subcategoryL2Id}/sub3/${subL3?.id}`);
  };
  
  const handleItemClick = (item) => {
    navigate(`/inventory/${encodeURIComponent(item?.category)}/${item?.id}`);
  };
  
  const getItemCountForCategory = (catId) => {
    const allItems = getAllItems();
    return allItems?.filter(item => item?.categoryId === catId)?.length;
  };
  
  const getItemCountForSubL2 = (subL2Id) => {
    const allItems = getAllItems();
    return allItems?.filter(item => item?.subcategoryL2Id === subL2Id)?.length;
  };
  
  const getItemCountForSubL3 = (subL3Id) => {
    const allItems = getAllItems();
    return allItems?.filter(item => item?.subcategoryL3Id === subL3Id)?.length;
  };
  
  const getStockStatusForCategory = (catId) => {
    const allItems = getAllItems();
    const categoryItems = allItems?.filter(item => item?.categoryId === catId);
    const lowStockCount = categoryItems?.filter(item => {
      const qty = parseFloat(item?.quantity || 0);
      const reorder = parseFloat(item?.reorderPoint || 0);
      return qty <= reorder;
    })?.length;
    
    if (lowStockCount === 0) return 'healthy';
    if (lowStockCount < categoryItems?.length / 2) return 'low';
    return 'critical';
  };
  
  const filteredCategories = useMemo(() => {
    return categories?.filter(cat => 
      cat?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase())
    );
  }, [categories, searchQuery]);
  
  const filteredSubcategoriesL2 = useMemo(() => {
    return subcategoriesL2?.filter(sub => 
      sub?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase())
    );
  }, [subcategoriesL2, searchQuery]);
  
  const filteredSubcategoriesL3 = useMemo(() => {
    return subcategoriesL3?.filter(sub => 
      sub?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase())
    );
  }, [subcategoriesL3, searchQuery]);
  
  const filteredItems = useMemo(() => {
    return items?.filter(item => 
      item?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase())
    );
  }, [items, searchQuery]);
  
  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold text-foreground font-heading">Hierarchical Inventory</h1>
            <p className="text-sm text-muted-foreground mt-1">3-level taxonomy navigation</p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              iconName="Plus"
              onClick={() => navigate('/enhanced-add-edit-item-form')}
            >
              Add Item
            </Button>
          </div>
        </div>
        
        {/* Department Scope Toggle (Command Only) */}
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
        
        {/* Breadcrumb Navigation */}
        {breadcrumbs?.length > 1 && (
          <div className="flex items-center gap-2 mb-6 text-sm">
            {breadcrumbs?.map((crumb, index) => (
              <React.Fragment key={index}>
                {index > 0 && <Icon name="ChevronRight" size={16} className="text-muted-foreground" />}
                <button
                  onClick={() => navigate(crumb?.path)}
                  className={`${
                    index === breadcrumbs?.length - 1
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  } transition-smooth`}
                >
                  {crumb?.label}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}
        
        {/* Search Bar */}
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm mb-6">
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
        
        {/* Level 1: Categories */}
        {currentLevel === 'category' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {filteredCategories?.map(category => {
              const itemCount = getItemCountForCategory(category?.id);
              const stockStatus = getStockStatusForCategory(category?.id);
              
              return (
                <div
                  key={category?.id}
                  onClick={() => handleCategoryClick(category)}
                  className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-smooth cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-3 bg-primary/10 rounded-xl">
                      <Icon name={category?.icon || 'Package'} size={24} className="text-primary" />
                    </div>
                    <div className={`px-2 py-1 rounded-lg text-xs font-medium ${
                      stockStatus === 'healthy' ? 'bg-success/10 text-success' :
                      stockStatus === 'low'? 'bg-warning/10 text-warning' : 'bg-error/10 text-error'
                    }`}>
                      {stockStatus === 'healthy' ? 'Healthy' : stockStatus === 'low' ? 'Low Stock' : 'Critical'}
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">{category?.name}</h3>
                  <p className="text-sm text-muted-foreground">{itemCount} items</p>
                </div>
              );
            })}
          </div>
        )}
        
        {/* Level 2: Subcategories L2 */}
        {currentLevel === 'subcategoryL2' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {filteredSubcategoriesL2?.map(subL2 => {
              const itemCount = getItemCountForSubL2(subL2?.id);
              
              return (
                <div
                  key={subL2?.id}
                  onClick={() => handleSubcategoryL2Click(subL2)}
                  className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-smooth cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-3 bg-primary/10 rounded-xl">
                      <Icon name="FolderOpen" size={24} className="text-primary" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">{subL2?.name}</h3>
                  <p className="text-sm text-muted-foreground">{itemCount} items</p>
                </div>
              );
            })}
          </div>
        )}
        
        {/* Level 3: Subcategories L3 */}
        {currentLevel === 'subcategoryL3' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {filteredSubcategoriesL3?.map(subL3 => {
              const itemCount = getItemCountForSubL3(subL3?.id);
              
              return (
                <div
                  key={subL3?.id}
                  onClick={() => handleSubcategoryL3Click(subL3)}
                  className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-smooth cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="p-3 bg-primary/10 rounded-xl">
                      <Icon name="Folder" size={24} className="text-primary" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-1">{subL3?.name}</h3>
                  <p className="text-sm text-muted-foreground">{itemCount} items</p>
                </div>
              );
            })}
          </div>
        )}
        
        {/* Level 4: Items */}
        {currentLevel === 'items' && (
          <div className="space-y-4">
            {filteredItems?.length === 0 ? (
              <div className="text-center py-12">
                <Icon name="Package" size={48} className="text-muted-foreground mx-auto mb-4" />
                <p className="text-lg text-muted-foreground">No items found</p>
                <Button
                  variant="default"
                  iconName="Plus"
                  onClick={() => navigate('/enhanced-add-edit-item-form')}
                  className="mt-4"
                >
                  Add First Item
                </Button>
              </div>
            ) : (
              filteredItems?.map(item => (
                <div
                  key={item?.id}
                  onClick={() => handleItemClick(item)}
                  className="bg-card border border-border rounded-2xl p-5 shadow-sm hover:shadow-md transition-smooth cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-muted rounded-xl flex items-center justify-center">
                      {item?.imageUrl ? (
                        <img src={item?.imageUrl} alt={item?.name} className="w-full h-full object-cover rounded-xl" />
                      ) : (
                        <Icon name="Package" size={24} className="text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-foreground">{item?.name}</h3>
                      <p className="text-sm text-muted-foreground">{item?.primaryLocation}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-foreground">{item?.quantity} {item?.unit}</p>
                      <p className="text-sm text-muted-foreground">Par: {item?.parLevel || 'N/A'}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default HierarchicalInventoryManagement;
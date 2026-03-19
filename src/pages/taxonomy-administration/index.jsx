import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import { getAllCategories, getAllSubcategoriesL2, getAllSubcategoriesL3, saveCategory, deleteCategory, deleteSubcategoryL2, deleteSubcategoryL3, getItemCountForCategory, getItemCountForSubcategoryL2, getItemCountForSubcategoryL3 } from '../inventory-management/utils/taxonomyStorage';
import { getCurrentUser, hasCommandAccess } from '../../utils/authStorage';

const TaxonomyAdministration = () => {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const [categories, setCategories] = useState([]);
  const [subcategoriesL2, setSubcategoriesL2] = useState([]);
  const [subcategoriesL3, setSubcategoriesL3] = useState([]);
  const [expandedCategories, setExpandedCategories] = useState(new Set());
  const [expandedL2, setExpandedL2] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  
  // Create modals
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('Package');
  const [newCategoryDepartment, setNewCategoryDepartment] = useState('INTERIOR');
  
  // Check if user has Command access
  useEffect(() => {
    if (!hasCommandAccess(currentUser)) {
      navigate('/dashboard');
    }
  }, [currentUser, navigate]);
  
  useEffect(() => {
    loadTaxonomy();
  }, []);
  
  const loadTaxonomy = () => {
    setCategories(getAllCategories());
    setSubcategoriesL2(getAllSubcategoriesL2());
    setSubcategoriesL3(getAllSubcategoriesL3());
  };
  
  const toggleCategory = (categoryId) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded?.has(categoryId)) {
      newExpanded?.delete(categoryId);
    } else {
      newExpanded?.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };
  
  const toggleL2 = (l2Id) => {
    const newExpanded = new Set(expandedL2);
    if (newExpanded?.has(l2Id)) {
      newExpanded?.delete(l2Id);
    } else {
      newExpanded?.add(l2Id);
    }
    setExpandedL2(newExpanded);
  };
  
  const handleCreateCategory = () => {
    if (!newCategoryName?.trim()) {
      alert('Please enter a category name');
      return;
    }
    
    saveCategory({
      name: newCategoryName?.trim(),
      icon: newCategoryIcon,
      department: newCategoryDepartment
    });
    
    loadTaxonomy();
    setShowCreateCategory(false);
    setNewCategoryName('');
    setNewCategoryIcon('Package');
    setNewCategoryDepartment('INTERIOR');
  };
  
  const handleDeleteCategory = (categoryId) => {
    const itemCount = getItemCountForCategory(categoryId);
    if (itemCount > 0) {
      alert(`Cannot delete category with ${itemCount} items. Please reassign or delete items first.`);
      return;
    }
    
    if (confirm('Are you sure you want to archive this category?')) {
      deleteCategory(categoryId);
      loadTaxonomy();
    }
  };
  
  const handleDeleteL2 = (l2Id, categoryId) => {
    const itemCount = getItemCountForSubcategoryL2(categoryId, l2Id);
    if (itemCount > 0) {
      alert(`Cannot delete subcategory with ${itemCount} items. Please reassign or delete items first.`);
      return;
    }
    
    if (confirm('Are you sure you want to archive this subcategory?')) {
      deleteSubcategoryL2(l2Id);
      loadTaxonomy();
    }
  };
  
  const handleDeleteL3 = (l3Id, categoryId, l2Id) => {
    const itemCount = getItemCountForSubcategoryL3(categoryId, l2Id, l3Id);
    if (itemCount > 0) {
      alert(`Cannot delete subcategory with ${itemCount} items. Please reassign or delete items first.`);
      return;
    }
    
    if (confirm('Are you sure you want to archive this subcategory?')) {
      deleteSubcategoryL3(l3Id);
      loadTaxonomy();
    }
  };
  
  const iconOptions = [
    'Package', 'Wine', 'ChefHat', 'Snowflake', 'Sparkles', 'Droplet', 
    'Shirt', 'Wrench', 'Shield', 'Anchor', 'Home', 'Folder'
  ];
  
  const departmentOptions = [
    { value: 'GALLEY', label: 'Galley' },
    { value: 'INTERIOR', label: 'Interior' },
    { value: 'DECK', label: 'Deck' },
    { value: 'ENGINEERING', label: 'Engineering' }
  ];
  
  const filteredCategories = categories?.filter(cat => 
    cat?.name?.toLowerCase()?.includes(searchQuery?.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto pt-24">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate('/inventory')}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="ArrowLeft" size={24} className="text-foreground" />
          </button>
          <div className="flex-1">
            <h1 className="text-3xl font-semibold text-foreground font-heading">Taxonomy Administration</h1>
            <p className="text-sm text-muted-foreground">Manage inventory categories and subcategories</p>
          </div>
          <Button
            variant="default"
            iconName="Plus"
            onClick={() => setShowCreateCategory(true)}
          >
            Add Category
          </Button>
        </div>

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
              placeholder="Search categories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e?.target?.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Taxonomy Tree */}
        <div className="space-y-4">
          {filteredCategories?.length === 0 ? (
            <div className="text-center py-12">
              <Icon name="Package" size={48} className="text-muted-foreground mx-auto mb-4" />
              <p className="text-lg text-muted-foreground">No categories found</p>
            </div>
          ) : (
            filteredCategories?.map((category) => {
              const l2Subs = subcategoriesL2?.filter(sub => sub?.categoryId === category?.id);
              const isExpanded = expandedCategories?.has(category?.id);
              const itemCount = getItemCountForCategory(category?.id);
              
              return (
                <div key={category?.id} className="bg-card border border-border rounded-2xl shadow-sm">
                  {/* Category Level */}
                  <div className="p-5 flex items-center gap-4">
                    <button
                      onClick={() => toggleCategory(category?.id)}
                      className="p-2 hover:bg-muted rounded-lg transition-smooth"
                    >
                      <Icon 
                        name={isExpanded ? "ChevronDown" : "ChevronRight"} 
                        size={20} 
                        className="text-foreground" 
                      />
                    </button>
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Icon name={category?.icon} size={24} className="text-primary" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-foreground">{category?.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {l2Subs?.length} subcategories • {itemCount} items
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 rounded-lg bg-muted text-sm text-foreground">
                        {departmentOptions?.find(d => d?.value === category?.department)?.label}
                      </span>
                      <button
                        onClick={() => handleDeleteCategory(category?.id)}
                        className="p-2 text-error hover:bg-error/10 rounded-lg transition-smooth"
                      >
                        <Icon name="Trash2" size={18} />
                      </button>
                    </div>
                  </div>
                  {/* L2 Subcategories */}
                  {isExpanded && (
                    <div className="border-t border-border">
                      {l2Subs?.map((l2Sub) => {
                        const l3Subs = subcategoriesL3?.filter(sub => sub?.subcategoryL2Id === l2Sub?.id);
                        const isL2Expanded = expandedL2?.has(l2Sub?.id);
                        const l2ItemCount = getItemCountForSubcategoryL2(category?.id, l2Sub?.id);
                        
                        return (
                          <div key={l2Sub?.id} className="border-b border-border last:border-b-0">
                            {/* L2 Row */}
                            <div className="p-5 pl-20 flex items-center gap-4 bg-muted/30">
                              <button
                                onClick={() => toggleL2(l2Sub?.id)}
                                className="p-2 hover:bg-muted rounded-lg transition-smooth"
                              >
                                <Icon 
                                  name={isL2Expanded ? "ChevronDown" : "ChevronRight"} 
                                  size={18} 
                                  className="text-foreground" 
                                />
                              </button>
                              <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center">
                                <Icon name="Folder" size={20} className="text-primary" />
                              </div>
                              <div className="flex-1">
                                <h4 className="text-base font-medium text-foreground">{l2Sub?.name}</h4>
                                <p className="text-xs text-muted-foreground">
                                  {l3Subs?.length} subcategories • {l2ItemCount} items
                                </p>
                              </div>
                              <button
                                onClick={() => handleDeleteL2(l2Sub?.id, category?.id)}
                                className="p-2 text-error hover:bg-error/10 rounded-lg transition-smooth"
                              >
                                <Icon name="Trash2" size={16} />
                              </button>
                            </div>
                            {/* L3 Subcategories */}
                            {isL2Expanded && l3Subs?.length > 0 && (
                              <div className="bg-muted/50">
                                {l3Subs?.map((l3Sub) => {
                                  const l3ItemCount = getItemCountForSubcategoryL3(category?.id, l2Sub?.id, l3Sub?.id);
                                  
                                  return (
                                    <div key={l3Sub?.id} className="p-4 pl-32 flex items-center gap-4 border-b border-border last:border-b-0">
                                      <div className="w-8 h-8 rounded-lg bg-primary/5 flex items-center justify-center">
                                        <Icon name="Folder" size={16} className="text-primary" />
                                      </div>
                                      <div className="flex-1">
                                        <h5 className="text-sm font-medium text-foreground">{l3Sub?.name}</h5>
                                        <p className="text-xs text-muted-foreground">{l3ItemCount} items</p>
                                      </div>
                                      <button
                                        onClick={() => handleDeleteL3(l3Sub?.id, category?.id, l2Sub?.id)}
                                        className="p-2 text-error hover:bg-error/10 rounded-lg transition-smooth"
                                      >
                                        <Icon name="Trash2" size={14} />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </main>
      {/* Create Category Modal */}
      {showCreateCategory && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setShowCreateCategory(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
              <div className="p-6 border-b border-border">
                <h3 className="text-xl font-semibold text-foreground">Create Category</h3>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Category Name <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e?.target?.value)}
                    placeholder="e.g., Galley, Interior"
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Icon
                  </label>
                  <select
                    value={newCategoryIcon}
                    onChange={(e) => setNewCategoryIcon(e?.target?.value)}
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {iconOptions?.map(icon => (
                      <option key={icon} value={icon}>{icon}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Department
                  </label>
                  <select
                    value={newCategoryDepartment}
                    onChange={(e) => setNewCategoryDepartment(e?.target?.value)}
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {departmentOptions?.map(dept => (
                      <option key={dept?.value} value={dept?.value}>{dept?.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="p-6 border-t border-border flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowCreateCategory(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={handleCreateCategory}
                  className="flex-1"
                >
                  Create
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default TaxonomyAdministration;
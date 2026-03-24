import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import { 
  getAllCategories, 
  getSubcategoriesL2ByCategory, 
  getSubcategoriesL3ByL2,
  saveSubcategoryL2,
  saveSubcategoryL3
} from '../inventory-management/utils/taxonomyStorage';
import { saveItem } from '../inventory-management/utils/inventoryStorage';
import { useAuth } from '../../contexts/AuthContext';
import { hasHODAccess } from '../../utils/authStorage';

const EnhancedAddEditItemForm = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, isCommand, isChief, isHOD } = useAuth();
  const fileInputRef = useRef(null);
  
  // Check if user can create new subcategories
  const canCreateSubcategories = hasHODAccess(currentUser);
  
  // Form mode: 'add' or 'edit'
  const mode = location?.state?.mode || 'add';
  const initialData = location?.state?.item || null;
  
  // Form state
  const [formData, setFormData] = useState({
    id: initialData?.id || null,
    name: initialData?.name || '',
    categoryId: initialData?.categoryId || '',
    subcategoryL2Id: initialData?.subcategoryL2Id || '',
    subcategoryL3Id: initialData?.subcategoryL3Id || '',
    unit: initialData?.unit || 'each',
    primaryLocation: initialData?.primaryLocation || '',
    quantity: initialData?.quantity || '',
    parLevel: initialData?.parLevel || '',
    reorderPoint: initialData?.reorderPoint || '',
    imageUrl: initialData?.imageUrl || null,
    notes: initialData?.notes || '',
    supplier: initialData?.supplier || '',
    condition: initialData?.condition || '',
    // Legacy fields for backward compatibility
    category: initialData?.category || '',
    subcategory: initialData?.subcategory || ''
  });
  
  const [categories, setCategories] = useState([]);
  const [subcategoriesL2, setSubcategoriesL2] = useState([]);
  const [subcategoriesL3, setSubcategoriesL3] = useState([]);
  const [imagePreview, setImagePreview] = useState(initialData?.imageUrl || null);
  
  // Create new subcategory states
  const [showCreateL2, setShowCreateL2] = useState(false);
  const [showCreateL3, setShowCreateL3] = useState(false);
  const [newSubL2Name, setNewSubL2Name] = useState('');
  const [newSubL3Name, setNewSubL3Name] = useState('');
  
  useEffect(() => {
    loadCategories();
  }, []);
  
  useEffect(() => {
    if (formData?.categoryId) {
      loadSubcategoriesL2(formData?.categoryId);
    } else {
      setSubcategoriesL2([]);
      setSubcategoriesL3([]);
    }
  }, [formData?.categoryId]);
  
  useEffect(() => {
    if (formData?.subcategoryL2Id) {
      loadSubcategoriesL3(formData?.subcategoryL2Id);
    } else {
      setSubcategoriesL3([]);
    }
  }, [formData?.subcategoryL2Id]);
  
  const loadCategories = () => {
    const cats = getAllCategories();
    setCategories(cats);
  };
  
  const loadSubcategoriesL2 = (categoryId) => {
    const subs = getSubcategoriesL2ByCategory(categoryId);
    setSubcategoriesL2(subs);
  };
  
  const loadSubcategoriesL3 = (subcategoryL2Id) => {
    const subs = getSubcategoriesL3ByL2(subcategoryL2Id);
    setSubcategoriesL3(subs);
  };
  
  const handleInputChange = (field, value) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      // Reset dependent fields when parent changes
      if (field === 'categoryId') {
        updated.subcategoryL2Id = '';
        updated.subcategoryL3Id = '';
        setShowCreateL2(false);
        setShowCreateL3(false);
      }
      
      if (field === 'subcategoryL2Id') {
        updated.subcategoryL3Id = '';
        setShowCreateL3(false);
      }
      
      return updated;
    });
  };
  
  const handleCategoryChange = (e) => {
    const value = e?.target?.value;
    handleInputChange('categoryId', value);
  };
  
  const handleSubcategoryL2Change = (e) => {
    const value = e?.target?.value;
    
    if (value === '__create_new__') {
      setShowCreateL2(true);
      handleInputChange('subcategoryL2Id', '');
    } else {
      setShowCreateL2(false);
      handleInputChange('subcategoryL2Id', value);
    }
  };
  
  const handleSubcategoryL3Change = (e) => {
    const value = e?.target?.value;
    
    if (value === '__create_new__') {
      setShowCreateL3(true);
      handleInputChange('subcategoryL3Id', '');
    } else {
      setShowCreateL3(false);
      handleInputChange('subcategoryL3Id', value);
    }
  };
  
  const handleCreateSubL2 = () => {
    if (!newSubL2Name?.trim()) {
      alert('Please enter a subcategory name');
      return;
    }
    
    const newSubL2Id = saveSubcategoryL2({
      name: newSubL2Name?.trim(),
      categoryId: formData?.categoryId,
      sortOrder: subcategoriesL2?.length + 1
    });
    
    if (newSubL2Id) {
      // Reload subcategories and select the new one
      loadSubcategoriesL2(formData?.categoryId);
      handleInputChange('subcategoryL2Id', newSubL2Id);
      setShowCreateL2(false);
      setNewSubL2Name('');
    } else {
      alert('Failed to create subcategory');
    }
  };
  
  const handleCreateSubL3 = () => {
    if (!newSubL3Name?.trim()) {
      alert('Please enter a subcategory name');
      return;
    }
    
    const newSubL3Id = saveSubcategoryL3({
      name: newSubL3Name?.trim(),
      categoryId: formData?.categoryId,
      subcategoryL2Id: formData?.subcategoryL2Id,
      sortOrder: subcategoriesL3?.length + 1
    });
    
    if (newSubL3Id) {
      // Reload subcategories and select the new one
      loadSubcategoriesL3(formData?.subcategoryL2Id);
      handleInputChange('subcategoryL3Id', newSubL3Id);
      setShowCreateL3(false);
      setNewSubL3Name('');
    } else {
      alert('Failed to create subcategory');
    }
  };
  
  const handleImageUpload = (e) => {
    const file = e?.target?.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader?.result);
        handleInputChange('imageUrl', reader?.result);
      };
      reader?.readAsDataURL(file);
    }
  };
  
  const handleRemoveImage = () => {
    setImagePreview(null);
    handleInputChange('imageUrl', null);
    if (fileInputRef?.current) {
      fileInputRef.current.value = '';
    }
  };
  
  const handleSave = () => {
    // Validation
    if (!formData?.name || !formData?.categoryId || !formData?.subcategoryL2Id || !formData?.primaryLocation) {
      alert('Please fill in all required fields: Item name, Category, Subcategory L2, and Primary location');
      return;
    }
    
    // Get category name for legacy compatibility
    const selectedCategory = categories?.find(cat => cat?.id === formData?.categoryId);
    
    // Prepare data for save
    const itemData = {
      ...formData,
      category: selectedCategory?.name || formData?.category,
      assetId: localStorage.getItem('current_asset_id') || 'default-asset'
    };
    
    // Save to storage
    const success = saveItem(itemData);
    
    if (success) {
      navigate('/hierarchical-inventory-management');
    } else {
      alert('Failed to save item. Please try again.');
    }
  };
  
  const units = [
    'each', 'bottle', 'case', 'pack', 'litre', 'kg', 'g', 'ml', 'set', 'roll', 'box', 'other'
  ];
  
  const locations = [
    'Bar Storage',
    'Wine Cellar',
    'Pantry',
    'Cold Room',
    'Galley',
    'Crew Mess',
    'Guest Cabins',
    'Laundry Room',
    'Engine Room',
    'Deck Storage',
    'Other'
  ];
  
  const conditions = ['new', 'good', 'worn', 'damaged', 'needs repair'];
  
  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[900px] mx-auto">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold text-foreground font-heading">
              {mode === 'add' ? 'Add Item' : 'Edit Item'}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {mode === 'add' ? 'Add a new item with taxonomy selection' : 'Update item details'}
            </p>
          </div>
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={24} className="text-foreground" />
          </button>
        </div>
        
        {/* Form */}
        <div className="space-y-6">
          {/* Basic Information */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-foreground mb-4">Basic Information</h3>
            
            <div className="space-y-4">
              {/* Item Name */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Item Name <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={formData?.name}
                  onChange={(e) => handleInputChange('name', e?.target?.value)}
                  placeholder="Enter item name"
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              
              {/* Category (Level 1) - REQUIRED */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Category <span className="text-error">*</span>
                </label>
                <select
                  value={formData?.categoryId}
                  onChange={handleCategoryChange}
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select category...</option>
                  {categories?.map(cat => (
                    <option key={cat?.id} value={cat?.id}>{cat?.name}</option>
                  ))}
                </select>
              </div>
              
              {/* Subcategory L2 - REQUIRED */}
              {formData?.categoryId && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Subcategory Level 2 <span className="text-error">*</span>
                  </label>
                  <select
                    value={formData?.subcategoryL2Id}
                    onChange={handleSubcategoryL2Change}
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select subcategory...</option>
                    {subcategoriesL2?.map(sub => (
                      <option key={sub?.id} value={sub?.id}>{sub?.name}</option>
                    ))}
                    {canCreateSubcategories && (
                      <option value="__create_new__">+ Create new...</option>
                    )}
                  </select>
                  
                  {/* Inline Create L2 */}
                  {showCreateL2 && (
                    <div className="mt-3 p-3 bg-muted/50 border border-border rounded-lg">
                      <label className="block text-sm font-medium text-foreground mb-2">
                        New Subcategory Name
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newSubL2Name}
                          onChange={(e) => setNewSubL2Name(e?.target?.value)}
                          placeholder="Enter name"
                          className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <Button
                          variant="default"
                          onClick={handleCreateSubL2}
                        >
                          Create
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowCreateL2(false);
                            setNewSubL2Name('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Subcategory L3 - OPTIONAL */}
              {formData?.subcategoryL2Id && !showCreateL2 && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Subcategory Level 3 <span className="text-muted-foreground">(Optional)</span>
                  </label>
                  <select
                    value={formData?.subcategoryL3Id}
                    onChange={handleSubcategoryL3Change}
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">None</option>
                    {subcategoriesL3?.map(sub => (
                      <option key={sub?.id} value={sub?.id}>{sub?.name}</option>
                    ))}
                    {canCreateSubcategories && (
                      <option value="__create_new__">+ Create new...</option>
                    )}
                  </select>
                  
                  {/* Inline Create L3 */}
                  {showCreateL3 && (
                    <div className="mt-3 p-3 bg-muted/50 border border-border rounded-lg">
                      <label className="block text-sm font-medium text-foreground mb-2">
                        New Subcategory Name
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newSubL3Name}
                          onChange={(e) => setNewSubL3Name(e?.target?.value)}
                          placeholder="Enter name"
                          className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <Button
                          variant="default"
                          onClick={handleCreateSubL3}
                        >
                          Create
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowCreateL3(false);
                            setNewSubL3Name('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Inventory Details */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-foreground mb-4">Inventory Details</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Unit */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Unit</label>
                <select
                  value={formData?.unit}
                  onChange={(e) => handleInputChange('unit', e?.target?.value)}
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {units?.map(unit => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
              </div>
              
              {/* Primary Location */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Primary Location <span className="text-error">*</span>
                </label>
                <select
                  value={formData?.primaryLocation}
                  onChange={(e) => handleInputChange('primaryLocation', e?.target?.value)}
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select location...</option>
                  {locations?.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>
              
              {/* Quantity */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Quantity</label>
                <input
                  type="number"
                  value={formData?.quantity}
                  onChange={(e) => handleInputChange('quantity', e?.target?.value)}
                  placeholder="0"
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              
              {/* Par Level */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Par Level</label>
                <input
                  type="number"
                  value={formData?.parLevel}
                  onChange={(e) => handleInputChange('parLevel', e?.target?.value)}
                  placeholder="0"
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              
              {/* Reorder Point */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Reorder Point</label>
                <input
                  type="number"
                  value={formData?.reorderPoint}
                  onChange={(e) => handleInputChange('reorderPoint', e?.target?.value)}
                  placeholder="0"
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              
              {/* Condition */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Condition</label>
                <select
                  value={formData?.condition}
                  onChange={(e) => handleInputChange('condition', e?.target?.value)}
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select condition...</option>
                  {conditions?.map(cond => (
                    <option key={cond} value={cond}>{cond}</option>
                  ))}
                </select>
              </div>
            </div>
            
            {/* Notes */}
            <div className="mt-4">
              <label className="block text-sm font-medium text-foreground mb-2">Notes</label>
              <textarea
                value={formData?.notes}
                onChange={(e) => handleInputChange('notes', e?.target?.value)}
                placeholder="Additional notes..."
                rows={3}
                className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
          </div>
          
          {/* Image Upload */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-foreground mb-4">Image</h3>
            
            {imagePreview ? (
              <div className="relative w-full h-48 bg-muted rounded-xl overflow-hidden">
                <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                <button
                  onClick={handleRemoveImage}
                  className="absolute top-2 right-2 p-2 bg-error text-white rounded-lg hover:bg-error/90 transition-smooth"
                >
                  <Icon name="Trash2" size={18} />
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef?.current?.click()}
                className="w-full h-48 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-smooth"
              >
                <Icon name="Upload" size={32} className="text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Click to upload image</p>
              </div>
            )}
            
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>
          
          {/* Action Buttons */}
          <div className="flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleSave}
            >
              {mode === 'add' ? 'Add Item' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default EnhancedAddEditItemForm;
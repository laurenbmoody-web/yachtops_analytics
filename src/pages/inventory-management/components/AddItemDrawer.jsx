import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { saveItem } from '../utils/inventoryStorage';
import { 
  getAllCategories,
  getSubcategoriesL2ByCategory,
  getSubcategoriesL3ByL2,
  saveSubcategoryL2,
  saveSubcategoryL3
} from '../utils/taxonomyStorage';
import { getCurrentUser, hasHODAccess } from '../../../utils/authStorage';

const AddItemDrawer = ({ isOpen, onClose, mode = 'add', initialData = null, categoryId = null, subcategoryL2Id = null, subcategoryL3Id = null, onSave }) => {
  const fileInputRef = useRef(null);
  const currentUser = getCurrentUser();
  const canCreateTaxonomy = hasHODAccess(currentUser);
  
  // Form state
  const [formData, setFormData] = useState({
    id: initialData?.id || null,
    categoryId: categoryId || initialData?.categoryId || '',
    subcategoryL2Id: subcategoryL2Id || initialData?.subcategoryL2Id || '',
    subcategoryL3Id: subcategoryL3Id || initialData?.subcategoryL3Id || null,
    name: mode === 'duplicate' ? `${initialData?.name} (Copy)` : (initialData?.name || ''),
    unit: initialData?.unit || 'each',
    primaryLocation: initialData?.primaryLocation || '',
    quantity: mode === 'duplicate' ? '' : (initialData?.quantity || ''),
    parLevel: initialData?.parLevel || '',
    reorderPoint: initialData?.reorderPoint || '',
    imageUrl: initialData?.imageUrl || null,
    // Advanced fields
    additionalLocations: mode === 'duplicate' ? [] : (initialData?.additionalLocations || []),
    notes: initialData?.notes || '',
    supplier: initialData?.supplier || '',
    purchasePrice: initialData?.purchasePrice || '',
    purchaseDate: initialData?.purchaseDate || '',
    condition: initialData?.condition || '',
    // Variants
    hasVariants: initialData?.hasVariants || false,
    variantType: initialData?.variantType || '',
    variants: mode === 'duplicate' ? (initialData?.variants?.map(v => ({ ...v, quantity: '' })) || []) : (initialData?.variants || []),
    // Uniforms specific
    assignedTo: initialData?.assignedTo || '',
    uniformStatus: initialData?.uniformStatus || 'spare',
    gender: initialData?.gender || ''
  });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imagePreview, setImagePreview] = useState(initialData?.imageUrl || null);
  
  // Taxonomy state
  const [categories, setCategories] = useState([]);
  const [subcategoriesL2, setSubcategoriesL2] = useState([]);
  const [subcategoriesL3, setSubcategoriesL3] = useState([]);
  
  // Create new state
  const [showCreateL2, setShowCreateL2] = useState(false);
  const [newL2Name, setNewL2Name] = useState('');
  const [showCreateL3, setShowCreateL3] = useState(false);
  const [newL3Name, setNewL3Name] = useState('');
  
  // Load categories on mount
  useEffect(() => {
    const allCategories = getAllCategories();
    setCategories(allCategories);
  }, []);
  
  // Load L2 subcategories when category changes
  useEffect(() => {
    if (formData?.categoryId) {
      const l2Subs = getSubcategoriesL2ByCategory(formData?.categoryId);
      setSubcategoriesL2(l2Subs);
    } else {
      setSubcategoriesL2([]);
      setSubcategoriesL3([]);
    }
  }, [formData?.categoryId]);
  
  // Load L3 subcategories when L2 changes
  useEffect(() => {
    if (formData?.subcategoryL2Id) {
      const l3Subs = getSubcategoriesL3ByL2(formData?.subcategoryL2Id);
      setSubcategoriesL3(l3Subs);
    } else {
      setSubcategoriesL3([]);
    }
  }, [formData?.subcategoryL2Id]);

  // Reset form data when initialData, mode, or other props change
  useEffect(() => {
    setFormData({
      id: initialData?.id || null,
      categoryId: categoryId || initialData?.categoryId || '',
      subcategoryL2Id: subcategoryL2Id || initialData?.subcategoryL2Id || '',
      subcategoryL3Id: subcategoryL3Id || initialData?.subcategoryL3Id || null,
      name: mode === 'duplicate' ? `${initialData?.name} (Copy)` : (initialData?.name || ''),
      unit: initialData?.unit || 'each',
      primaryLocation: initialData?.primaryLocation || '',
      quantity: mode === 'duplicate' ? '' : (initialData?.quantity || ''),
      parLevel: initialData?.parLevel || '',
      reorderPoint: initialData?.reorderPoint || '',
      imageUrl: initialData?.imageUrl || null,
      // Advanced fields
      additionalLocations: mode === 'duplicate' ? [] : (initialData?.additionalLocations || []),
      notes: initialData?.notes || '',
      supplier: initialData?.supplier || '',
      purchasePrice: initialData?.purchasePrice || '',
      purchaseDate: initialData?.purchaseDate || '',
      condition: initialData?.condition || '',
      // Variants
      hasVariants: initialData?.hasVariants || false,
      variantType: initialData?.variantType || '',
      variants: mode === 'duplicate' ? (initialData?.variants?.map(v => ({ ...v, quantity: '' })) || []) : (initialData?.variants || []),
      // Uniforms specific
      assignedTo: initialData?.assignedTo || '',
      uniformStatus: initialData?.uniformStatus || 'spare',
      gender: initialData?.gender || ''
    });
    setImagePreview(initialData?.imageUrl || null);
  }, [initialData, mode, categoryId, subcategoryL2Id, subcategoryL3Id]);

  // Units of measure
  const units = [
    'each', 'bottle', 'case', 'pack', 'litre', 'kg', 'g', 'ml', 'set', 'roll', 'box', 'other'
  ];

  // Locations
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

  // Conditions
  const conditions = ['new', 'good', 'worn', 'damaged', 'needs repair'];

  // Variant types
  const variantTypes = ['Size', 'Bottle Size', 'Pack Size', 'Colour', 'Other'];

  // Uniform statuses
  const uniformStatuses = ['spare', 'issued'];

  const handleInputChange = (field, value) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      // Reset dependent fields when category changes
      if (field === 'categoryId') {
        updated.subcategoryL2Id = '';
        updated.subcategoryL3Id = null;
      }
      
      // Reset L3 when L2 changes
      if (field === 'subcategoryL2Id') {
        updated.subcategoryL3Id = null;
      }
      
      return updated;
    });
  };
  
  const handleL2SelectChange = (value) => {
    if (value === 'CREATE_NEW') {
      setShowCreateL2(true);
      setNewL2Name('');
    } else {
      handleInputChange('subcategoryL2Id', value);
    }
  };
  
  const handleCreateL2 = () => {
    if (!newL2Name?.trim()) {
      alert('Please enter a subcategory name');
      return;
    }
    
    const newL2 = saveSubcategoryL2({
      categoryId: formData?.categoryId,
      name: newL2Name?.trim()
    });
    
    if (newL2) {
      // Reload L2 list
      const l2Subs = getSubcategoriesL2ByCategory(formData?.categoryId);
      setSubcategoriesL2(l2Subs);
      
      // Auto-select the new L2
      handleInputChange('subcategoryL2Id', newL2?.id);
      
      // Reset create state
      setShowCreateL2(false);
      setNewL2Name('');
    }
  };
  
  const handleL3SelectChange = (value) => {
    if (value === 'CREATE_NEW') {
      setShowCreateL3(true);
      setNewL3Name('');
    } else if (value === '') {
      handleInputChange('subcategoryL3Id', null);
    } else {
      handleInputChange('subcategoryL3Id', value);
    }
  };
  
  const handleCreateL3 = () => {
    if (!newL3Name?.trim()) {
      alert('Please enter a subcategory name');
      return;
    }
    
    const newL3 = saveSubcategoryL3({
      categoryId: formData?.categoryId,
      subcategoryL2Id: formData?.subcategoryL2Id,
      name: newL3Name?.trim()
    });
    
    if (newL3) {
      // Reload L3 list
      const l3Subs = getSubcategoriesL3ByL2(formData?.subcategoryL2Id);
      setSubcategoriesL3(l3Subs);
      
      // Auto-select the new L3
      handleInputChange('subcategoryL3Id', newL3?.id);
      
      // Reset create state
      setShowCreateL3(false);
      setNewL3Name('');
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

  const addAdditionalLocation = () => {
    handleInputChange('additionalLocations', [
      ...formData?.additionalLocations,
      { location: '', quantity: '' }
    ]);
  };

  const updateAdditionalLocation = (index, field, value) => {
    const updated = [...formData?.additionalLocations];
    updated[index][field] = value;
    handleInputChange('additionalLocations', updated);
  };

  const removeAdditionalLocation = (index) => {
    const updated = formData?.additionalLocations?.filter((_, i) => i !== index);
    handleInputChange('additionalLocations', updated);
  };

  const addVariant = () => {
    handleInputChange('variants', [
      ...formData?.variants,
      { label: '', sku: '', quantity: '' }
    ]);
  };

  const updateVariant = (index, field, value) => {
    const updated = [...formData?.variants];
    updated[index][field] = value;
    handleInputChange('variants', updated);
  };

  const removeVariant = (index) => {
    const updated = formData?.variants?.filter((_, i) => i !== index);
    handleInputChange('variants', updated);
  };

  const handleSave = () => {
    // Validation
    if (!formData?.name || !formData?.categoryId || !formData?.subcategoryL2Id || !formData?.primaryLocation) {
      alert('Please fill in all required fields: Item name, Category, Subcategory Level 2, and Primary location');
      return;
    }

    // Prepare data for save
    const itemData = {
      ...formData,
      id: mode === 'duplicate' ? null : formData?.id
    };

    // Save to storage
    const success = saveItem(itemData);
    
    if (success) {
      if (onSave) {
        onSave();
      }
      onClose();
    } else {
      alert('Failed to save item. Please try again.');
    }
  };

  const isUniformsCategory = categories?.find(c => c?.id === formData?.categoryId)?.name === 'Uniforms';
  const isAlcoholCategory = categories?.find(c => c?.id === formData?.categoryId)?.name?.includes('Alcohol');

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full md:w-[600px] lg:w-[700px] bg-background z-50 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border p-6 z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-foreground font-heading">
                {mode === 'add' ? 'Add Item' : mode === 'duplicate' ? 'Duplicate Item' : 'Edit Item'}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {mode === 'add' ? 'Add a new item to inventory' : mode === 'duplicate' ? 'Create a copy with new quantities' : 'Update item details'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="X" size={24} className="text-foreground" />
            </button>
          </div>
        </div>

        {/* Form Content */}
        <div className="p-6 space-y-6">
          {/* Step 1: Essential Fields */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-foreground mb-4 font-heading">Essential Information</h3>
            
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
                  placeholder="e.g., Belvedere Vodka"
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Category (Level 1) */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Category <span className="text-error">*</span>
                </label>
                <select
                  value={formData?.categoryId}
                  onChange={(e) => handleInputChange('categoryId', e?.target?.value)}
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select category</option>
                  {categories?.map(cat => (
                    <option key={cat?.id} value={cat?.id}>{cat?.name}</option>
                  ))}
                </select>
              </div>

              {/* Subcategory Level 2 (REQUIRED) */}
              {formData?.categoryId && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Subcategory Level 2 <span className="text-error">*</span>
                  </label>
                  {showCreateL2 ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={newL2Name}
                        onChange={(e) => setNewL2Name(e?.target?.value)}
                        placeholder="Enter new subcategory name"
                        className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={handleCreateL2}
                        >
                          Create
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setShowCreateL2(false);
                            setNewL2Name('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <select
                      value={formData?.subcategoryL2Id}
                      onChange={(e) => handleL2SelectChange(e?.target?.value)}
                      className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Select subcategory</option>
                      {subcategoriesL2?.map(sub => (
                        <option key={sub?.id} value={sub?.id}>{sub?.name}</option>
                      ))}
                      {canCreateTaxonomy && (
                        <option value="CREATE_NEW">+ Create new...</option>
                      )}
                    </select>
                  )}
                </div>
              )}

              {/* Subcategory Level 3 (OPTIONAL) */}
              {formData?.subcategoryL2Id && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Subcategory Level 3 <span className="text-muted-foreground text-xs">(optional)</span>
                  </label>
                  {showCreateL3 ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={newL3Name}
                        onChange={(e) => setNewL3Name(e?.target?.value)}
                        placeholder="Enter new subcategory name"
                        className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={handleCreateL3}
                        >
                          Create
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setShowCreateL3(false);
                            setNewL3Name('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <select
                      value={formData?.subcategoryL3Id || ''}
                      onChange={(e) => handleL3SelectChange(e?.target?.value)}
                      className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">None</option>
                      {subcategoriesL3?.map(sub => (
                        <option key={sub?.id} value={sub?.id}>{sub?.name}</option>
                      ))}
                      {canCreateTaxonomy && (
                        <option value="CREATE_NEW">+ Create new...</option>
                      )}
                    </select>
                  )}
                </div>
              )}

              {/* Unit of Measure */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Unit of Measure <span className="text-error">*</span>
                </label>
                <select
                  value={formData?.unit}
                  onChange={(e) => handleInputChange('unit', e?.target?.value)}
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
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
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select location</option>
                  {locations?.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              {/* Quantity at Primary Location */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Quantity at Primary Location <span className="text-error">*</span>
                </label>
                <input
                  type="number"
                  step={isAlcoholCategory ? "0.01" : "1"}
                  value={formData?.quantity}
                  onChange={(e) => handleInputChange('quantity', e?.target?.value)}
                  placeholder="0"
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {isAlcoholCategory && (
                  <p className="text-xs text-muted-foreground mt-1">Decimals allowed for partial bottles</p>
                )}
              </div>

              {/* Par Level */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Par Level (Minimum) <span className="text-error">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData?.parLevel}
                  onChange={(e) => handleInputChange('parLevel', e?.target?.value)}
                  placeholder="0"
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Reorder Point */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Reorder Point <span className="text-error">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData?.reorderPoint}
                  onChange={(e) => handleInputChange('reorderPoint', e?.target?.value)}
                  placeholder="0"
                  className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Image Upload */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-foreground mb-4 font-heading">Item Image</h3>
            
            {imagePreview ? (
              <div className="relative">
                <img 
                  src={imagePreview} 
                  alt="Item preview" 
                  className="w-full h-48 object-cover rounded-lg"
                />
                <button
                  onClick={handleRemoveImage}
                  className="absolute top-2 right-2 p-2 bg-error text-white rounded-lg hover:bg-error/90 transition-smooth"
                >
                  <Icon name="Trash2" size={18} />
                </button>
              </div>
            ) : (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  id="image-upload"
                />
                <label
                  htmlFor="image-upload"
                  className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-border rounded-lg cursor-pointer hover:bg-muted/50 transition-smooth"
                >
                  <Icon name="Upload" size={32} className="text-muted-foreground mb-2" />
                  <span className="text-sm text-muted-foreground">Click to upload image</span>
                  <span className="text-xs text-muted-foreground mt-1">PNG, JPG up to 10MB</span>
                </label>
              </div>
            )}
          </div>

          {/* Variants Section */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground font-heading">Variants</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData?.hasVariants}
                  onChange={(e) => handleInputChange('hasVariants', e?.target?.checked)}
                  className="w-5 h-5 rounded border-border text-primary focus:ring-2 focus:ring-primary"
                />
                <span className="text-sm text-foreground">This item has variants</span>
              </label>
            </div>

            {formData?.hasVariants && (
              <div className="space-y-4">
                {/* Variant Type */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Variant Type
                  </label>
                  <select
                    value={formData?.variantType}
                    onChange={(e) => handleInputChange('variantType', e?.target?.value)}
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select variant type</option>
                    {variantTypes?.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>

                {/* Variant Options */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium text-foreground">Variant Options</label>
                    <Button
                      variant="outline"
                      size="sm"
                      iconName="Plus"
                      onClick={addVariant}
                    >
                      Add Variant
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {formData?.variants?.map((variant, index) => (
                      <div key={index} className="bg-muted p-4 rounded-lg">
                        <div className="grid grid-cols-12 gap-3">
                          <div className="col-span-4">
                            <input
                              type="text"
                              value={variant?.label}
                              onChange={(e) => updateVariant(index, 'label', e?.target?.value)}
                              placeholder="e.g., S, M, 700ml"
                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                          <div className="col-span-3">
                            <input
                              type="text"
                              value={variant?.sku}
                              onChange={(e) => updateVariant(index, 'sku', e?.target?.value)}
                              placeholder="SKU (optional)"
                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                          <div className="col-span-4">
                            <input
                              type="number"
                              step="0.01"
                              value={variant?.quantity}
                              onChange={(e) => updateVariant(index, 'quantity', e?.target?.value)}
                              placeholder="Quantity"
                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                          <div className="col-span-1 flex items-center justify-center">
                            <button
                              onClick={() => removeVariant(index)}
                              className="p-2 text-error hover:bg-error/10 rounded-lg transition-smooth"
                            >
                              <Icon name="Trash2" size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Uniforms Special Fields */}
          {isUniformsCategory && (
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-foreground mb-4 font-heading">Uniform Details</h3>
              
              <div className="space-y-4">
                {/* Assigned To */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Assigned To
                  </label>
                  <input
                    type="text"
                    value={formData?.assignedTo}
                    onChange={(e) => handleInputChange('assignedTo', e?.target?.value)}
                    placeholder="Crew member name"
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Status */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Status
                  </label>
                  <select
                    value={formData?.uniformStatus}
                    onChange={(e) => handleInputChange('uniformStatus', e?.target?.value)}
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {uniformStatuses?.map(status => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>

                {/* Gender */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Gender <span className="text-muted-foreground text-xs">(optional)</span>
                  </label>
                  <select
                    value={formData?.gender}
                    onChange={(e) => handleInputChange('gender', e?.target?.value)}
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Not specified</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="unisex">Unisex</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Advanced Fields - Collapsible */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between"
            >
              <h3 className="text-lg font-semibold text-foreground font-heading">More Details</h3>
              <Icon 
                name={showAdvanced ? "ChevronUp" : "ChevronDown"} 
                size={20} 
                className="text-foreground"
              />
            </button>

            {showAdvanced && (
              <div className="mt-6 space-y-4">
                {/* Additional Locations */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium text-foreground">Additional Locations</label>
                    <Button
                      variant="outline"
                      size="sm"
                      iconName="Plus"
                      onClick={addAdditionalLocation}
                    >
                      Add Location
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {formData?.additionalLocations?.map((loc, index) => (
                      <div key={index} className="bg-muted p-4 rounded-lg">
                        <div className="grid grid-cols-12 gap-3">
                          <div className="col-span-7">
                            <select
                              value={loc?.location}
                              onChange={(e) => updateAdditionalLocation(index, 'location', e?.target?.value)}
                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                              <option value="">Select location</option>
                              {locations?.map(location => (
                                <option key={location} value={location}>{location}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-4">
                            <input
                              type="number"
                              step="0.01"
                              value={loc?.quantity}
                              onChange={(e) => updateAdditionalLocation(index, 'quantity', e?.target?.value)}
                              placeholder="Quantity"
                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </div>
                          <div className="col-span-1 flex items-center justify-center">
                            <button
                              onClick={() => removeAdditionalLocation(index)}
                              className="p-2 text-error hover:bg-error/10 rounded-lg transition-smooth"
                            >
                              <Icon name="Trash2" size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Notes
                  </label>
                  <textarea
                    value={formData?.notes}
                    onChange={(e) => handleInputChange('notes', e?.target?.value)}
                    placeholder="Additional notes about this item..."
                    rows={4}
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                </div>

                {/* Supplier */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Supplier
                  </label>
                  <input
                    type="text"
                    value={formData?.supplier}
                    onChange={(e) => handleInputChange('supplier', e?.target?.value)}
                    placeholder="Supplier name"
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Purchase Price */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Purchase Price / Unit Cost
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData?.purchasePrice}
                    onChange={(e) => handleInputChange('purchasePrice', e?.target?.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Purchase Date */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Purchase Date
                  </label>
                  <input
                    type="date"
                    value={formData?.purchaseDate}
                    onChange={(e) => handleInputChange('purchaseDate', e?.target?.value)}
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Condition */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Condition
                  </label>
                  <select
                    value={formData?.condition}
                    onChange={(e) => handleInputChange('condition', e?.target?.value)}
                    className="w-full px-4 py-2.5 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select condition</option>
                    {conditions?.map(cond => (
                      <option key={cond} value={cond}>{cond}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 bg-background border-t border-border p-6">
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleSave}
              className="flex-1"
            >
              {mode === 'add' ? 'Add Item' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default AddItemDrawer;
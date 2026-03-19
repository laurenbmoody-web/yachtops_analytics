import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import { getCurrentUser } from '../../../utils/authStorage';
import { createDefect, DefectPriority, DefectDepartment, normalizeDept } from '../utils/defectsStorage';
import { getAllDecks, getZonesByDeck, getSpacesByZone } from '../../locations-management-settings/utils/locationsHierarchyStorage';
import { showToast } from '../../../utils/toast';
import { loadAllTypes, getSubtypesForType, addCustomType, addCustomSubtype, canAddCustom } from '../utils/defectTypeTaxonomy';

const ReportDefectModal = ({ onClose, onSuccess }) => {
  const currentUser = getCurrentUser();
  
  // SINGLE ROLE RESOLVER - Use ONLY this for all role checks in this modal
  const roleTierRaw = currentUser?.effectiveTier || currentUser?.roleTier || currentUser?.permissionTier || currentUser?.tier || '';
  const RESOLVED_ROLE = roleTierRaw?.trim()?.toUpperCase();
  
  // Department selection logic - ONLY based on RESOLVED_ROLE
  const canChooseDept = (RESOLVED_ROLE === 'COMMAND' || RESOLVED_ROLE === 'CHIEF');
  const isLockedToDept = !canChooseDept;
  
  const fileInputRef = useRef(null);
  
  // Normalize user's department for consistent matching
  const userDepartmentNormalized = normalizeDept(currentUser?.department || '');
  
  // Find matching department from DefectDepartment enum
  const getMatchingDepartment = () => {
    if (!userDepartmentNormalized) return '';
    
    // Find department that matches (case-insensitive)
    const matchingDept = Object.values(DefectDepartment)?.find(
      dept => normalizeDept(dept) === userDepartmentNormalized
    );
    
    return matchingDept || '';
  };
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    departmentOwner: '', // Will be set in useEffect
    priority: DefectPriority?.MEDIUM,
    locationDeckId: '',
    locationZoneId: '',
    locationSpaceId: '',
    locationFreeText: '',
    defectType: '',
    defectSubType: '',
    photos: []
  });
  
  const [decks, setDecks] = useState([]);
  const [zones, setZones] = useState([]);
  const [spaces, setSpaces] = useState([]);
  const [showFreeText, setShowFreeText] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [defectTypes, setDefectTypes] = useState([]);
  const [defectSubtypes, setDefectSubtypes] = useState([]);
  const [showTypeInput, setShowTypeInput] = useState(false);
  const [showSubtypeInput, setShowSubtypeInput] = useState(false);
  const [customTypeInput, setCustomTypeInput] = useState('');
  const [customSubtypeInput, setCustomSubtypeInput] = useState('');
  const canAddCustomTypes = canAddCustom(currentUser);
  
  // Set default department AFTER component mounts and currentUser is available
  useEffect(() => {
    if (currentUser?.department) {
      const defaultDept = getMatchingDepartment();
      if (defaultDept) {
        setFormData(prev => ({
          ...prev,
          departmentOwner: defaultDept
        }));
      }
    }
  }, [currentUser?.department]);
  
  useEffect(() => {
    const allDecks = getAllDecks(false);
    setDecks(allDecks);
    
    // Load defect types
    const types = loadAllTypes();
    setDefectTypes(types);
  }, []);
  
  useEffect(() => {
    if (formData?.locationDeckId) {
      const deckZones = getZonesByDeck(formData?.locationDeckId, false);
      setZones(deckZones);
      setFormData(prev => ({ ...prev, locationZoneId: '', locationSpaceId: '' }));
    } else {
      setZones([]);
      setSpaces([]);
    }
  }, [formData?.locationDeckId]);
  
  useEffect(() => {
    if (formData?.locationZoneId) {
      const zoneSpaces = getSpacesByZone(formData?.locationZoneId, false);
      setSpaces(zoneSpaces);
      setFormData(prev => ({ ...prev, locationSpaceId: '' }));
    } else {
      setSpaces([]);
    }
  }, [formData?.locationZoneId]);
  
  const handlePhotoUpload = (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    
    // Validate file type
    if (!file?.type?.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      return;
    }
    
    // Validate file size (max 5MB)
    if (file?.size > 5 * 1024 * 1024) {
      showToast('Image size must be less than 5MB', 'error');
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader?.result;
      setPhotoPreview(dataUrl);
      setFormData(prev => ({ ...prev, photos: [dataUrl] }));
    };
    reader?.readAsDataURL(file);
  };
  
  const handleRemovePhoto = () => {
    setPhotoPreview(null);
    setFormData(prev => ({ ...prev, photos: [] }));
    if (fileInputRef?.current) {
      fileInputRef.current.value = '';
    }
  };
  
  const handleSpaceChange = (spaceId) => {
    if (spaceId === 'other') {
      setShowFreeText(true);
      setFormData(prev => ({ ...prev, locationSpaceId: '' }));
    } else {
      setShowFreeText(false);
      setFormData(prev => ({ ...prev, locationSpaceId: spaceId, locationFreeText: '' }));
    }
  };
  
  const handleTypeChange = (value) => {
    if (value === '__add_new__') {
      setShowTypeInput(true);
      setCustomTypeInput('');
      setFormData(prev => ({ ...prev, defectType: '', defectSubType: '' }));
      setDefectSubtypes([]);
    } else {
      setShowTypeInput(false);
      setFormData(prev => ({ ...prev, defectType: value, defectSubType: '' }));
      
      // Load subtypes for selected type
      if (value) {
        const subtypes = getSubtypesForType(value);
        setDefectSubtypes(subtypes);
      } else {
        setDefectSubtypes([]);
      }
    }
  };
  
  const handleSubtypeChange = (value) => {
    if (value === '__add_new__') {
      setShowSubtypeInput(true);
      setCustomSubtypeInput('');
      setFormData(prev => ({ ...prev, defectSubType: '' }));
    } else {
      setShowSubtypeInput(false);
      setFormData(prev => ({ ...prev, defectSubType: value }));
    }
  };
  
  const handleAddCustomType = () => {
    if (!customTypeInput?.trim()) {
      showToast('Please enter a type name', 'error');
      return;
    }
    
    const newType = addCustomType(customTypeInput);
    if (!newType) {
      showToast('Type already exists or not allowed', 'error');
      return;
    }
    
    // Reload types and select the new one
    const types = loadAllTypes();
    setDefectTypes(types);
    setFormData(prev => ({ ...prev, defectType: newType?.name, defectSubType: '' }));
    setShowTypeInput(false);
    setCustomTypeInput('');
    
    // Load subtypes for new type
    const subtypes = getSubtypesForType(newType?.name);
    setDefectSubtypes(subtypes);
    
    showToast('Custom type added', 'success');
  };
  
  const handleAddCustomSubtype = () => {
    if (!customSubtypeInput?.trim()) {
      showToast('Please enter a sub-type name', 'error');
      return;
    }
    
    if (!formData?.defectType) {
      showToast('Please select a type first', 'error');
      return;
    }
    
    const newSubtype = addCustomSubtype(formData?.defectType, customSubtypeInput);
    if (!newSubtype) {
      showToast('Sub-type already exists or not allowed', 'error');
      return;
    }
    
    // Reload subtypes and select the new one
    const subtypes = getSubtypesForType(formData?.defectType);
    setDefectSubtypes(subtypes);
    setFormData(prev => ({ ...prev, defectSubType: newSubtype?.name }));
    setShowSubtypeInput(false);
    setCustomSubtypeInput('');
    
    showToast('Custom sub-type added', 'success');
  };
  
  const handleCancelCustomType = () => {
    setShowTypeInput(false);
    setCustomTypeInput('');
  };
  
  const handleCancelCustomSubtype = () => {
    setShowSubtypeInput(false);
    setCustomSubtypeInput('');
  };
  
  const handleSubmit = async (e) => {
    e?.preventDefault();
    
    // Validation
    if (!formData?.title?.trim()) {
      showToast('Title is required', 'error');
      return;
    }
    
    if (!formData?.defectType) {
      showToast('Type is required', 'error');
      return;
    }
    
    if (!formData?.locationDeckId) {
      showToast('Deck is required', 'error');
      return;
    }
    
    if (!formData?.locationZoneId) {
      showToast('Zone is required', 'error');
      return;
    }
    
    if (!formData?.departmentOwner) {
      showToast('Department is required', 'error');
      return;
    }
    
    if (showFreeText && !formData?.locationFreeText?.trim()) {
      showToast('Please describe the location', 'error');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Check if type/subtype are custom
      const typeObj = defectTypes?.find(t => t?.name === formData?.defectType);
      const subtypeObj = defectSubtypes?.find(s => s?.name === formData?.defectSubType);
      
      const defectData = {
        ...formData,
        defectTypeCustom: typeObj?.isCustom || false,
        defectSubTypeCustom: subtypeObj?.isCustom || false
      };
      
      createDefect(defectData);
      showToast('Defect reported successfully', 'success');
      onSuccess?.();
    } catch (error) {
      console.error('Error creating defect:', error);
      showToast('Failed to report defect', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">Report Defect</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Photo Upload */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Photo (optional)
            </label>
            {photoPreview ? (
              <div className="relative">
                <img
                  src={photoPreview}
                  alt="Defect preview"
                  className="w-full h-48 object-cover rounded-lg border border-border"
                />
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="absolute top-2 right-2 p-2 bg-error text-white rounded-lg hover:bg-error/90 transition-smooth"
                >
                  <Icon name="Trash2" size={16} />
                </button>
              </div>
            ) : (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                  id="defect-photo-upload"
                />
                <label
                  htmlFor="defect-photo-upload"
                  className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-border rounded-lg cursor-pointer hover:bg-muted/30 transition-smooth"
                >
                  <Icon name="Camera" size={32} className="text-muted-foreground mb-2" />
                  <span className="text-sm text-muted-foreground mb-1">Tap to add photo</span>
                  <span className="text-xs text-muted-foreground">Camera • Photo Library • Files</span>
                </label>
              </div>
            )}
          </div>
          
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Title <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={formData?.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e?.target?.value }))}
              placeholder="Brief description of the defect"
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>
          
          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Type <span className="text-error">*</span>
            </label>
            {showTypeInput ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={customTypeInput}
                  onChange={(e) => setCustomTypeInput(e?.target?.value)}
                  placeholder="Enter custom type name"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddCustomType}
                    className="px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth text-sm"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelCustomType}
                    className="px-3 py-1.5 border border-border text-foreground rounded-lg hover:bg-muted transition-smooth text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <select
                value={formData?.defectType}
                onChange={(e) => handleTypeChange(e?.target?.value)}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select type</option>
                {defectTypes?.map(type => (
                  <option key={type?.id} value={type?.name}>
                    {type?.name}{type?.isCustom ? ' (Custom)' : ''}
                  </option>
                ))}
                {canAddCustomTypes && (
                  <option value="__add_new__">+ Add new...</option>
                )}
              </select>
            )}
          </div>
          
          {/* Sub-Type */}
          {formData?.defectType && !showTypeInput && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Sub-Type (optional)
              </label>
              {showSubtypeInput ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={customSubtypeInput}
                    onChange={(e) => setCustomSubtypeInput(e?.target?.value)}
                    placeholder="Enter custom sub-type name"
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAddCustomSubtype}
                      className="px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth text-sm"
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelCustomSubtype}
                      className="px-3 py-1.5 border border-border text-foreground rounded-lg hover:bg-muted transition-smooth text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <select
                  value={formData?.defectSubType}
                  onChange={(e) => handleSubtypeChange(e?.target?.value)}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select sub-type (optional)</option>
                  {defectSubtypes?.map(subtype => (
                    <option key={subtype?.id} value={subtype?.name}>
                      {subtype?.name}{subtype?.isCustom ? ' (Custom)' : ''}
                    </option>
                  ))}
                  {canAddCustomTypes && (
                    <option value="__add_new__">+ Add new...</option>
                  )}
                </select>
              )}
            </div>
          )}
          
          {/* Location Picker */}
          <div className="space-y-4">
            <label className="block text-sm font-medium text-foreground">
              Location <span className="text-error">*</span>
            </label>
            
            {/* Deck */}
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Deck</label>
              <select
                value={formData?.locationDeckId}
                onChange={(e) => setFormData(prev => ({ ...prev, locationDeckId: e?.target?.value }))}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select deck</option>
                {decks?.map(deck => (
                  <option key={deck?.id} value={deck?.id}>{deck?.name}</option>
                ))}
              </select>
            </div>
            
            {/* Zone */}
            {formData?.locationDeckId && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Zone</label>
                <select
                  value={formData?.locationZoneId}
                  onChange={(e) => setFormData(prev => ({ ...prev, locationZoneId: e?.target?.value }))}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                >
                  <option value="">Select zone</option>
                  {zones?.map(zone => (
                    <option key={zone?.id} value={zone?.id}>{zone?.name}</option>
                  ))}
                </select>
              </div>
            )}
            
            {/* Space */}
            {formData?.locationZoneId && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Space (optional)</label>
                <select
                  value={showFreeText ? 'other' : formData?.locationSpaceId}
                  onChange={(e) => handleSpaceChange(e?.target?.value)}
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select space</option>
                  {spaces?.map(space => (
                    <option key={space?.id} value={space?.id}>{space?.name}</option>
                  ))}
                  <option value="other">Other / Not listed</option>
                </select>
              </div>
            )}
            
            {/* Free Text Location */}
            {showFreeText && (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Describe location</label>
                <input
                  type="text"
                  value={formData?.locationFreeText}
                  onChange={(e) => setFormData(prev => ({ ...prev, locationFreeText: e?.target?.value }))}
                  placeholder="e.g., Near the main staircase"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
            )}
          </div>
          
          {/* Department Owner */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Department <span className="text-error">*</span>
            </label>
            <div className="relative">
              <select
                value={formData?.departmentOwner}
                onChange={(e) => setFormData(prev => ({ ...prev, departmentOwner: e?.target?.value }))}
                className={`w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
                  isLockedToDept ? 'cursor-not-allowed opacity-60' : ''
                }`}
                disabled={isLockedToDept}
                required
              >
                {!formData?.departmentOwner && <option value="">Select department</option>}
                {Object.values(DefectDepartment)?.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
              {isLockedToDept && (
                <div className="absolute right-10 top-1/2 -translate-y-1/2 pointer-events-none">
                  <Icon name="Lock" size={16} className="text-muted-foreground" />
                </div>
              )}
            </div>
            {isLockedToDept && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Icon name="Info" size={12} />
                Locked to your department
              </p>
            )}
          </div>
          
          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Priority
            </label>
            <select
              value={formData?.priority}
              onChange={(e) => setFormData(prev => ({ ...prev, priority: e?.target?.value }))}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {Object.values(DefectPriority)?.map(priority => (
                <option key={priority} value={priority}>{priority}</option>
              ))}
            </select>
          </div>
          
          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Description / Notes (optional)
            </label>
            <textarea
              value={formData?.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e?.target?.value }))}
              placeholder="Additional details about the defect"
              rows={4}
              className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>
          
          {/* Actions */}
          <div className="flex items-center gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-border rounded-lg text-foreground hover:bg-muted transition-smooth"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ReportDefectModal;
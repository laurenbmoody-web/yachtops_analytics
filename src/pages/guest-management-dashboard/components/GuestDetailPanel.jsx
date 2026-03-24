import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { MaritalStatus, getMaritalStatusDisplay, getAvailableSpouseOptions, updateGuest, deleteGuest, reinstateGuest, getAvailableKidsOptions, getLinkedKids, linkKid, unlinkKid, uploadPassportDocument, deletePassportDocument, getPassportDocumentSignedUrl } from '../utils/guestStorage';
import { getCurrentUser } from '../../../utils/authStorage';

import { getAllDecks, getZonesByDeck, getSpacesByZone } from '../../locations-management-settings/utils/locationsHierarchyStorage';


// Helper function to format cabin display to show only Level 3 (final segment)
const formatCabinLevel3 = (cabinValue) => {
  if (!cabinValue) return 'Not assigned';
  const raw = String(cabinValue)?.trim();
  if (!raw) return 'Not assigned';
  const parts = raw?.split('>')?.map(p => p?.trim())?.filter(Boolean);
  if (parts?.length === 0) return 'Not assigned';
  return parts?.[parts?.length - 1];
};

const GuestDetailPanel = ({ guest, onEdit, onDelete, onReinstate, onClose, permissions }) => {
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState(guest);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);
  const [spouseOptions, setSpouseOptions] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  
  // NDA document upload state
  const [ndaUploading, setNdaUploading] = useState(false);
  const [ndaDocumentName, setNdaDocumentName] = useState('');
  const [ndaSignedUrl, setNdaSignedUrl] = useState(null);
  const ndaFileInputRef = useRef(null);
  
  // Kids linking state
  const [linkedKidIds, setLinkedKidIds] = useState([]);
  const [kidsOptions, setKidsOptions] = useState([]);
  const [showKidsModal, setShowKidsModal] = useState(false);
  const [kidsLoading, setKidsLoading] = useState(false);
  
  // Cabin location states
  const [cabinOptions, setCabinOptions] = useState([]);
  const [selectedCabinPath, setSelectedCabinPath] = useState('');
  const [cabinSearchQuery, setCabinSearchQuery] = useState('');
  const [showCabinDropdown, setShowCabinDropdown] = useState(false);
  const [cabinFreeText, setCabinFreeText] = useState('');
  const [locationNotFound, setLocationNotFound] = useState(false);
  
  // Add this block - Passport document state
  const [passportUploading, setPassportUploading] = useState(false);
  const [passportSignedUrl, setPassportSignedUrl] = useState(null);
  const passportFileInputRef = useRef(null);
  // End of added block
  
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const cabinDropdownRef = useRef(null);
  const currentUser = getCurrentUser();
  const canEdit = permissions?.canEdit || false;
  const canDelete = permissions?.canDelete || false;
  const isDeleted = guest?.isDeleted || false;

  useEffect(() => {
    const init = async () => {
      setFormData(guest);
      setIsEditing(false);

      // Build cabin options from Supabase vessel_locations (async)
      const options = [];
      try {
        const decks = await getAllDecks() || [];
        for (const deck of decks) {
          const zones = await getZonesByDeck(deck?.id) || [];
          for (const zone of zones) {
            const spaces = await getSpacesByZone(zone?.id) || [];
            for (const space of spaces) {
              options.push({
                path: `${deck?.name} > ${zone?.name} > ${space?.name}`,
                deckId: deck?.id,
                deckName: deck?.name,
                zoneId: zone?.id,
                zoneName: zone?.name,
                spaceId: space?.id,
                spaceName: space?.name,
              });
            }
          }
        }
      } catch (err) {
        console.error('[GuestDetailPanel] Failed to load cabin locations:', err);
      }

      setCabinOptions(options);

      // Parse existing cabin location
      if (guest?.cabinLocationPath) {
        const exists = options?.some(opt => opt?.path === guest?.cabinLocationPath);
        setSelectedCabinPath(guest?.cabinLocationPath);
        setLocationNotFound(!exists);
      } else if (guest?.cabinLocationLabel || guest?.cabinAllocated) {
        setCabinFreeText(guest?.cabinLocationLabel || guest?.cabinAllocated || '');
      }
    };
    init();
  }, [guest]);

  useEffect(() => {
    if (formData?.maritalStatus === MaritalStatus?.MARRIED) {
      const fetchSpouseOptions = async () => {
        const available = await getAvailableSpouseOptions(guest?.id);
        setSpouseOptions(Array.isArray(available) ? available : []);
      };
      fetchSpouseOptions();
    } else {
      setSpouseOptions([]);
    }
  }, [formData?.maritalStatus, guest?.id]);

  // Load linked kids on mount and when guest changes
  useEffect(() => {
    const fetchLinkedKids = async () => {
      const ids = await getLinkedKids(guest?.id);
      setLinkedKidIds(Array.isArray(ids) ? ids : []);
    };
    if (guest?.id) fetchLinkedKids();
  }, [guest?.id]);

  // Load passport signed URL on mount
  useEffect(() => {
    const fetchPassportUrl = async () => {
      if (guest?.passportDocumentUrl) {
        const url = await getPassportDocumentSignedUrl(guest?.passportDocumentUrl);
        setPassportSignedUrl(url);
      } else {
        setPassportSignedUrl(null);
      }
    };
    fetchPassportUrl();
  }, [guest?.passportDocumentUrl]);

  const handleActiveToggle = () => {
    const newActiveState = !formData?.isActiveOnTrip;
    setFormData(prev => ({ ...prev, isActiveOnTrip: newActiveState }));
    
    // Save immediately to guest storage
    const updated = updateGuest(guest?.id, { isActiveOnTrip: newActiveState });
    if (updated) {
      // Also update all trips that have this guest
      const allTrips = JSON.parse(localStorage.getItem('cargo.trips.v1') || '[]');
      let tripsUpdated = false;
      
      allTrips?.forEach(trip => {
        const guestIndex = trip?.guests?.findIndex(tg => tg?.guestId === guest?.id);
        if (guestIndex !== -1) {
          trip.guests[guestIndex].isActive = newActiveState;
          if (newActiveState) {
            trip.guests[guestIndex].activatedAt = new Date()?.toISOString();
          } else {
            trip.guests[guestIndex].deactivatedAt = new Date()?.toISOString();
          }
          tripsUpdated = true;
        }
      });
      
      if (tripsUpdated) {
        localStorage.setItem('cargo.trips.v1', JSON.stringify(allTrips));
      }
      
      showToast(`Guest ${newActiveState ? 'activated' : 'deactivated'} on current trip`, 'success');
      if (onEdit) {
        onEdit(guest?.id, { isActiveOnTrip: newActiveState });
      }
    } else {
      showToast('Failed to update guest status', 'error');
      // Revert on failure
      setFormData(prev => ({ ...prev, isActiveOnTrip: !newActiveState }));
    }
  };
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (cabinDropdownRef?.current && !cabinDropdownRef?.current?.contains(event?.target)) {
        setShowCabinDropdown(false);
      }
    };
    
    if (showCabinDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCabinDropdown]);

  const handleChange = (field, value) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      // Clear spouse link if marital status changes away from Married
      if (field === 'maritalStatus' && value !== MaritalStatus?.MARRIED) {
        updated.spouseGuestId = null;
      }
      
      return updated;
    });
  };
  
  const handleCabinSelect = (option) => {
    setSelectedCabinPath(option?.path);
    setFormData(prev => ({
      ...prev,
      cabinLocationPath: option?.path,
      cabinLocationIds: {
        deckId: option?.deckId,
        zoneId: option?.zoneId,
        spaceId: option?.spaceId
      }
    }));
    setCabinFreeText('');
    setCabinSearchQuery('');
    setShowCabinDropdown(false);
    setLocationNotFound(false);
  };
  
  const handleCabinSearchChange = (value) => {
    setCabinSearchQuery(value);
    setShowCabinDropdown(true);
  };
  
  const handleCabinFreeTextChange = (value) => {
    setCabinFreeText(value);
    setSelectedCabinPath('');
    setFormData(prev => ({
      ...prev,
      cabinLocationPath: '',
      cabinLocationIds: null
    }));
    setLocationNotFound(false);
  };
  
  const handleLocationHierarchyChange = async (level, value) => {
    const decks = await getAllDecks() || [];

    if (level === 'deck') {
      const selectedDeck = decks?.find(d => d?.id === value);
      setFormData(prev => ({
        ...prev,
        cabinLocationIds: { deckId: value, zoneId: '', spaceId: '' },
        cabinLocationPath: selectedDeck ? `${selectedDeck?.name}` : ''
      }));
      setLocationNotFound(false);
    } else if (level === 'zone') {
      const zones = await getZonesByDeck(formData?.cabinLocationIds?.deckId) || [];
      const selectedZone = zones?.find(z => z?.id === value);
      const selectedDeck = decks?.find(d => d?.id === formData?.cabinLocationIds?.deckId);
      setFormData(prev => ({
        ...prev,
        cabinLocationIds: { ...prev?.cabinLocationIds, zoneId: value, spaceId: '' },
        cabinLocationPath: selectedDeck && selectedZone ? `${selectedDeck?.name} > ${selectedZone?.name}` : ''
      }));
      setLocationNotFound(false);
    } else if (level === 'space') {
      const spaces = await getSpacesByZone(formData?.cabinLocationIds?.zoneId) || [];
      const selectedSpace = spaces?.find(s => s?.id === value);
      const zones = await getZonesByDeck(formData?.cabinLocationIds?.deckId) || [];
      const selectedZone = zones?.find(z => z?.id === formData?.cabinLocationIds?.zoneId);
      const selectedDeck = decks?.find(d => d?.id === formData?.cabinLocationIds?.deckId);
      setFormData(prev => ({
        ...prev,
        cabinLocationIds: { ...prev?.cabinLocationIds, spaceId: value },
        cabinLocationPath: selectedDeck && selectedZone && selectedSpace
          ? `${selectedDeck?.name} > ${selectedZone?.name} > ${selectedSpace?.name}`
          : ''
      }));
      setLocationNotFound(false);
    }
  };

  const filteredCabinOptions = cabinOptions?.filter(option => 
    option?.path?.toLowerCase()?.includes(cabinSearchQuery?.toLowerCase())
  );
  
  // Group options by deck
  const groupedOptions = filteredCabinOptions?.reduce((acc, option) => {
    if (!acc?.[option?.deckName]) {
      acc[option?.deckName] = [];
    }
    acc?.[option?.deckName]?.push(option);
    return acc;
  }, {});

  const handlePhotoUpload = (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;

    if (!file?.type?.startsWith('image/')) {
      showToast('Please select a valid image file', 'error');
      return;
    }

    if (file?.size > 5 * 1024 * 1024) {
      showToast('Image size must be less than 5MB', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const photoData = {
        fileName: file?.name,
        fileSize: file?.size,
        fileType: file?.type,
        dataUrl: event?.target?.result,
        uploadedAt: new Date()?.toISOString()
      };
      setFormData(prev => ({ ...prev, photo: photoData }));
      setShowPhotoPicker(false);
    };
    reader?.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setFormData(prev => ({ ...prev, photo: null }));
  };

  const handleSave = () => {
    // Validate required fields
    if (!formData?.firstName?.trim() || !formData?.lastName?.trim()) {
      showToast('First name and last name are required', 'error');
      return;
    }
    
    // Prepare data with backward compatibility
    const updateData = {
      ...formData,
      cabinAllocated: formData?.cabinLocationPath || cabinFreeText || '',
      cabinLocationLabel: formData?.cabinLocationPath || cabinFreeText || '',
      cabinFreeText: cabinFreeText || ''
    };

    const updated = updateGuest(guest?.id, updateData);
    if (updated) {
      showToast('Guest updated successfully', 'success');
      onEdit();
      setIsEditing(false);
    } else {
      showToast('Failed to update guest', 'error');
    }
  };

  const handleCancel = () => {
    setFormData(guest);
    setIsEditing(false);
    setShowPhotoPicker(false);
    setDeleteConfirmChecked(false);
  };

  const handleDelete = () => {
    if (!deleteConfirmChecked) {
      showToast('Please confirm deletion by checking the box', 'error');
      return;
    }
    
    const success = deleteGuest(guest?.id);
    if (success) {
      showToast('Guest deleted successfully', 'success');
      onDelete();
      setShowDeleteConfirm(false);
      setDeleteConfirmChecked(false);
    } else {
      showToast('Failed to delete guest', 'error');
    }
  };
  
  const handleReinstate = () => {
    const success = reinstateGuest(guest?.id);
    if (success) {
      showToast('Guest reinstated successfully', 'success');
      onReinstate();
    } else {
      showToast('Failed to reinstate guest', 'error');
    }
  };

  const handlePreferencesClick = () => {
    showToast('Preferences module coming soon', 'info');
  };

  const handleOpenPreferences = () => {
    navigate(`/guest/${guest?.id}/preferences`);
  };

  const getSpouseName = (spouseId) => {
    if (!spouseId) return 'Unlinked';
    const spouse = spouseOptions?.find(s => s?.id === spouseId);
    return spouse ? `${spouse?.firstName} ${spouse?.lastName}` : 'Unlinked';
  };
  
  // Get cabin display value
  const getCabinDisplay = () => {
    const cabinValue = guest?.cabinLocationPath || guest?.cabinFreeText || guest?.cabinLocationLabel || guest?.cabinAllocated;
    return formatCabinLevel3(cabinValue);
  };

  // Kids modal handlers
  const handleOpenKidsModal = async () => {
    setKidsLoading(true);
    setShowKidsModal(true);
    const options = await getAvailableKidsOptions(guest?.id);
    setKidsOptions(Array.isArray(options) ? options : []);
    setKidsLoading(false);
  };

  const handleToggleKid = async (kidId) => {
    const isLinked = linkedKidIds?.includes(kidId);
    if (isLinked) {
      const success = await unlinkKid(guest?.id, kidId);
      if (success) {
        setLinkedKidIds(prev => prev?.filter(id => id !== kidId));
        showToast('Child unlinked', 'success');
      } else {
        showToast('Failed to unlink child', 'error');
      }
    } else {
      const success = await linkKid(guest?.id, kidId);
      if (success) {
        setLinkedKidIds(prev => [...prev, kidId]);
        showToast('Child linked', 'success');
      } else {
        showToast('Failed to link child', 'error');
      }
    }
  };

  const getLinkedKidsDisplay = () => {
    if (linkedKidIds?.length === 0) return 'Unlinked';
    return `${linkedKidIds?.length} linked`;
  };

  const maritalStatusOptions = [
    { value: MaritalStatus?.SINGLE, label: 'Single' },
    { value: MaritalStatus?.MARRIED, label: 'Married' },
    { value: MaritalStatus?.PARTNERED, label: 'Partnered' },
    { value: MaritalStatus?.DIVORCED, label: 'Divorced' },
    { value: MaritalStatus?.WIDOWED, label: 'Widowed' },
    { value: MaritalStatus?.UNKNOWN, label: 'Prefer not to say' }
  ];

  const spouseSelectOptions = [
    { value: '', label: 'No spouse linked' },
    ...spouseOptions?.map(s => ({
      value: s?.id,
      label: `${s?.firstName} ${s?.lastName}${s?.cabinLocationPath ? ` (${formatCabinLevel3(s?.cabinLocationPath)})` : ''}`
    }))
  ];

  const handlePhotoPickerClick = () => {
    setShowPhotoPicker(!showPhotoPicker);
  };

  // Nationality options
  const nationalityOptions = [
    { value: '', label: 'Select nationality' },
    { value: 'American', label: 'American' },
    { value: 'Australian', label: 'Australian' },
    { value: 'British', label: 'British' },
    { value: 'Canadian', label: 'Canadian' },
    { value: 'French', label: 'French' },
    { value: 'German', label: 'German' },
    { value: 'Italian', label: 'Italian' },
    { value: 'Spanish', label: 'Spanish' },
    { value: 'Other', label: 'Other' },
  ];

  const relationshipOptions = [
    { value: '', label: 'Select relationship' },
    { value: 'Parent', label: 'Parent' },
    { value: 'Spouse', label: 'Spouse' },
    { value: 'Sibling', label: 'Sibling' },
    { value: 'Friend', label: 'Friend' },
    { value: 'Other', label: 'Other' },
  ];

  const clientTypeOptions = [
    { value: '', label: 'Select client type' },
    { value: 'Owner', label: 'Owner' },
    { value: 'Charter', label: 'Charter' },
    { value: 'Guest of Charter', label: 'Guest of Charter' },
    { value: 'Other', label: 'Other' },
  ];

  const currencyOptions = [
    { value: '', label: 'Select currency' },
    { value: 'USD', label: 'USD' },
    { value: 'EUR', label: 'EUR' },
    { value: 'GBP', label: 'GBP' },
    { value: 'AUD', label: 'AUD' },
    { value: 'Other', label: 'Other' },
  ];

  const privacyLevelOptions = [
    { value: 'Standard', label: 'Standard' },
    { value: 'High', label: 'High' },
    { value: 'Ultra', label: 'Ultra' },
  ];

  const photoPermissionOptions = [
    { value: 'Yes', label: 'Yes' },
    { value: 'No', label: 'No' },
    { value: 'Ask Each Time', label: 'Ask Each Time' },
  ];

  const shareInfoOptions = [
    { value: 'Full', label: 'Full' },
    { value: 'Limited', label: 'Limited' },
    { value: 'None', label: 'None' },
  ];

  const handlePassportUpload = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed?.includes(file?.type)) {
      showToast('Please select a PDF or image file', 'error');
      return;
    }
    if (file?.size > 10 * 1024 * 1024) {
      showToast('File size must be less than 10MB', 'error');
      return;
    }
    setPassportUploading(true);
    try {
      const path = await uploadPassportDocument(guest?.id, file);
      if (path) {
        const url = await getPassportDocumentSignedUrl(path);
        setPassportSignedUrl(url);
        setFormData(prev => ({ ...prev, passportDocumentUrl: path }));
        showToast('Passport document uploaded', 'success');
      } else {
        showToast('Upload failed', 'error');
      }
    } catch {
      showToast('Upload failed', 'error');
    } finally {
      setPassportUploading(false);
      if (passportFileInputRef?.current) passportFileInputRef.current.value = '';
    }
  };

  const handlePassportDelete = async () => {
    const path = formData?.passportDocumentUrl || guest?.passportDocumentUrl;
    if (!path) return;
    setPassportUploading(true);
    try {
      const success = await deletePassportDocument(guest?.id, path);
      if (success) {
        setPassportSignedUrl(null);
        setFormData(prev => ({ ...prev, passportDocumentUrl: null }));
        showToast('Passport document removed', 'success');
      } else {
        showToast('Failed to remove document', 'error');
      }
    } catch {
      showToast('Failed to remove document', 'error');
    } finally {
      setPassportUploading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-foreground">Guest Details</h2>
          {isDeleted && (
            <span className="px-3 py-1 text-xs font-medium bg-red-500/20 text-red-700 dark:text-red-400 rounded-full">
              Deleted
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && canEdit && !isDeleted && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
              iconName="Edit"
            >
              Edit
            </Button>
          )}
          {isEditing && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                iconName="Check"
              >
                Save
              </Button>
            </>
          )}
          {isDeleted && canDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReinstate}
              iconName="RotateCcw"
              className="text-green-600 border-green-600 hover:bg-green-600/10"
            >
              Reinstate
            </Button>
          )}
        </div>
      </div>
      {/* Content */}
      <div className="p-6 space-y-6 max-h-[calc(100vh-340px)] overflow-y-auto">
        {/* Photo and Basic Info */}
        <div className="flex items-start gap-6">
          {/* Photo */}
          <div className="flex-shrink-0">
            {isEditing ? (
              <div className="relative">
                {formData?.photo ? (
                  <div className="relative w-32 h-32 rounded-xl overflow-hidden border-2 border-border">
                    <img
                      src={formData?.photo?.dataUrl}
                      alt="Guest"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="absolute top-1 right-1 bg-error text-error-foreground rounded-full p-1 hover:bg-error/90 transition-colors"
                    >
                      <Icon name="X" size={16} />
                    </button>
                  </div>
                ) : (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowPhotoPicker(!showPhotoPicker)}
                      className="w-32 h-32 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 hover:border-primary transition-colors"
                    >
                      <Icon name="Camera" size={24} className="text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Add Photo</span>
                    </button>

                    {showPhotoPicker && (
                      <div className="absolute top-full left-0 mt-2 bg-card border border-border rounded-lg shadow-lg py-2 z-10 min-w-[200px]">
                        <button
                          type="button"
                          onClick={() => {
                            fileInputRef?.current?.click();
                            setShowPhotoPicker(false);
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                        >
                          <Icon name="Image" size={16} />
                          Photo Library
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            cameraInputRef?.current?.click();
                            setShowPhotoPicker(false);
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                        >
                          <Icon name="Camera" size={16} />
                          Take Photo
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            fileInputRef?.current?.click();
                            setShowPhotoPicker(false);
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                        >
                          <Icon name="Upload" size={16} />
                          Choose File
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </div>
            ) : (
              <div className="w-32 h-32 rounded-xl overflow-hidden bg-muted flex-shrink-0">
                {formData?.photo?.dataUrl ? (
                  <img
                    src={formData?.photo?.dataUrl}
                    alt={`${formData?.firstName} ${formData?.lastName}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-primary/20">
                    <Icon name="User" size={48} className="text-primary" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Basic Info */}
          <div className="flex-1 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">First Name *</label>
                {isEditing && !isDeleted ? (
                  <Input
                    value={formData?.firstName || ''}
                    onChange={(e) => handleChange('firstName', e?.target?.value)}
                    placeholder="First name"
                  />
                ) : (
                  <p className="text-foreground font-medium">{formData?.firstName || '-'}</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Last Name *</label>
                {isEditing && !isDeleted ? (
                  <Input
                    value={formData?.lastName || ''}
                    onChange={(e) => handleChange('lastName', e?.target?.value)}
                    placeholder="Last name"
                  />
                ) : (
                  <p className="text-foreground font-medium">{formData?.lastName || '-'}</p>
                )}
              </div>
            </div>

            {/* Active on Trip Toggle */}
            {canEdit && !isDeleted && (
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <button
                  onClick={handleActiveToggle}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData?.isActiveOnTrip ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      formData?.isActiveOnTrip ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <div>
                  <p className="text-sm font-medium text-foreground">Active on current trip</p>
                  <p className="text-xs text-muted-foreground">Enable to include in active guest lists</p>
                </div>
              </div>
            )}
            {(!canEdit || isDeleted) && (
              <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <div
                  className={`relative inline-flex h-6 w-11 items-center rounded-full opacity-50 ${
                    formData?.isActiveOnTrip ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white ${
                      formData?.isActiveOnTrip ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Active on current trip</p>
                  <p className="text-xs text-muted-foreground">{isDeleted ? 'Read-only (deleted)' : 'View only'}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section: Personal */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Icon name="User" size={18} />
            Personal
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Date of Birth</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="date"
                  value={formData?.dateOfBirth || ''}
                  onChange={(e) => handleChange('dateOfBirth', e?.target?.value)}
                />
              ) : (
                <p className="text-foreground">{formData?.dateOfBirth || '-'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Cake Preference</label>
              {isEditing && !isDeleted ? (
                <Input
                  value={formData?.cakePreference || ''}
                  onChange={(e) => handleChange('cakePreference', e?.target?.value)}
                  placeholder="e.g., Chocolate, Vanilla"
                />
              ) : (
                <p className="text-foreground">{formData?.cakePreference || '-'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Marital Status</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.maritalStatus || ''}
                  onChange={(value) => handleChange('maritalStatus', value)}
                  options={maritalStatusOptions}
                />
              ) : (
                <p className="text-foreground">{getMaritalStatusDisplay(formData?.maritalStatus)}</p>
              )}
            </div>
            {formData?.maritalStatus === MaritalStatus?.MARRIED && (
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Connect Spouse (optional)</label>
                {isEditing && !isDeleted ? (
                  <Select
                    value={formData?.spouseGuestId || ''}
                    onChange={(value) => handleChange('spouseGuestId', value)}
                    options={spouseSelectOptions}
                    searchable
                  />
                ) : (
                  <p className="text-foreground">{getSpouseName(formData?.spouseGuestId)}</p>
                )}
              </div>
            )}
            {/* Connect Kids */}
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Connect Kids (optional)</label>
              <button
                type="button"
                onClick={handleOpenKidsModal}
                className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <Icon name="Users" size={14} />
                <span>{getLinkedKidsDisplay()}</span>
                <Icon name="ChevronRight" size={14} className="text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>

        {/* Section: Contact */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Icon name="Mail" size={18} />
            Contact
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Email</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="email"
                  value={formData?.contactEmail || ''}
                  onChange={(e) => handleChange('contactEmail', e?.target?.value)}
                  placeholder="guest@example.com"
                />
              ) : (
                <p className="text-foreground">{formData?.contactEmail || '-'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Phone</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="tel"
                  value={formData?.contactPhone || ''}
                  onChange={(e) => handleChange('contactPhone', e?.target?.value)}
                  placeholder="+1 234 567 8900"
                />
              ) : (
                <p className="text-foreground">{formData?.contactPhone || '-'}</p>
              )}
            </div>
          </div>
        </div>

        {/* Section: Travel & Documents (NEW - after Contact, before Health) */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Icon name="FileText" size={18} />
            Travel &amp; Documents
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Passport Number</label>
              {isEditing && !isDeleted ? (
                <Input
                  value={formData?.passportNumber || ''}
                  onChange={(e) => handleChange('passportNumber', e?.target?.value)}
                  placeholder="e.g., AB1234567"
                />
              ) : (
                <p className="text-foreground">{formData?.passportNumber || '-'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Passport Nationality</label>
              {isEditing && !isDeleted ? (
                <div className="space-y-2">
                  <Select
                    value={formData?.passportNationality || ''}
                    onChange={(value) => handleChange('passportNationality', value)}
                    options={nationalityOptions}
                  />
                  {formData?.passportNationality === 'Other' && (
                    <Input
                      value={formData?.passportNationalityOther || ''}
                      onChange={(e) => handleChange('passportNationalityOther', e?.target?.value)}
                      placeholder="Specify nationality"
                    />
                  )}
                </div>
              ) : (
                <p className="text-foreground">
                  {formData?.passportNationality === 'Other'
                    ? formData?.passportNationalityOther || 'Other'
                    : formData?.passportNationality || '-'}
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Passport Expiry Date</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="date"
                  value={formData?.passportExpiryDate || ''}
                  onChange={(e) => handleChange('passportExpiryDate', e?.target?.value)}
                />
              ) : (
                <p className="text-foreground">{formData?.passportExpiryDate || '-'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Emergency Contact Name</label>
              {isEditing && !isDeleted ? (
                <Input
                  value={formData?.emergencyContactName || ''}
                  onChange={(e) => handleChange('emergencyContactName', e?.target?.value)}
                  placeholder="Full name"
                />
              ) : (
                <p className="text-foreground">{formData?.emergencyContactName || '-'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Emergency Contact Phone</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="tel"
                  value={formData?.emergencyContactPhone || ''}
                  onChange={(e) => handleChange('emergencyContactPhone', e?.target?.value)}
                  placeholder="+1 234 567 8900"
                />
              ) : (
                <p className="text-foreground">{formData?.emergencyContactPhone || '-'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Emergency Contact Relationship</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.emergencyContactRelationship || ''}
                  onChange={(value) => handleChange('emergencyContactRelationship', value)}
                  options={relationshipOptions}
                />
              ) : (
                <p className="text-foreground">{formData?.emergencyContactRelationship || '-'}</p>
              )}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1 block">Visa Notes</label>
            {isEditing && !isDeleted ? (
              <textarea
                value={formData?.visaNotes || ''}
                onChange={(e) => handleChange('visaNotes', e?.target?.value)}
                placeholder="Any visa requirements or notes..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            ) : (
              <p className="text-foreground whitespace-pre-wrap">{formData?.visaNotes || '-'}</p>
            )}
          </div>

          {/* Passport Document Upload */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">Passport Document</label>
            {(formData?.passportDocumentUrl || guest?.passportDocumentUrl) ? (
              <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border">
                <Icon name="FileText" size={18} className="text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {passportSignedUrl ? (
                    <a
                      href={passportSignedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline truncate block"
                    >
                      View Passport Document
                    </a>
                  ) : (
                    <span className="text-sm text-foreground">Passport document uploaded</span>
                  )}
                </div>
                {canEdit && !isDeleted && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => passportFileInputRef?.current?.click()}
                      disabled={passportUploading}
                      className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={handlePassportDelete}
                      disabled={passportUploading}
                      className="p-1 rounded text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                    >
                      <Icon name="X" size={14} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              canEdit && !isDeleted && (
                <button
                  type="button"
                  onClick={() => passportFileInputRef?.current?.click()}
                  disabled={passportUploading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-border hover:border-primary text-sm text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                >
                  {passportUploading ? (
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Icon name="Upload" size={16} />
                  )}
                  <span>{passportUploading ? 'Uploading...' : 'Upload Passport'}</span>
                </button>
              )
            )}
            <input
              ref={passportFileInputRef}
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp"
              onChange={handlePassportUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Section: Health */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Icon name="Heart" size={18} />
            Health
          </h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Health Conditions</label>
              {isEditing && !isDeleted ? (
                <textarea
                  value={formData?.healthConditions || ''}
                  onChange={(e) => handleChange('healthConditions', e?.target?.value)}
                  placeholder="Any health conditions to be aware of..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              ) : (
                <p className="text-foreground whitespace-pre-wrap">{formData?.healthConditions || '-'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Allergies</label>
              {isEditing && !isDeleted ? (
                <textarea
                  value={formData?.allergies || ''}
                  onChange={(e) => handleChange('allergies', e?.target?.value)}
                  placeholder="Any allergies to be aware of..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              ) : (
                <p className="text-foreground whitespace-pre-wrap">{formData?.allergies || '-'}</p>
              )}
            </div>
          </div>
        </div>

        {/* Section: Accommodation */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Icon name="Home" size={18} />
            Accommodation
          </h3>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Cabin</div>
            <div className="text-sm font-medium text-foreground">{getCabinDisplay()}</div>
          </div>

          {/* Cabin Allocation - Searchable Dropdown */}
          {isEditing && !isDeleted && (
            <div className="space-y-1">
              <label className="block text-sm font-medium text-foreground mb-1">
                Guest Cabin Allocated (Optional)
              </label>
              <div className="relative" ref={cabinDropdownRef}>
                <div className="relative">
                  <input
                    type="text"
                    value={cabinSearchQuery}
                    onChange={(e) => handleCabinSearchChange(e?.target?.value)}
                    onFocus={() => setShowCabinDropdown(true)}
                    placeholder={cabinOptions?.length === 0 ? "No locations configured" : "Search or select cabin..."}
                    disabled={cabinOptions?.length === 0}
                    className="w-full h-10 px-3 pr-10 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <Icon
                    name="ChevronDown"
                    size={18}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                </div>
                
                {locationNotFound && (
                  <div className="mt-1 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <Icon name="AlertTriangle" size={12} />
                    Previously selected location not found
                  </div>
                )}
                
                {showCabinDropdown && cabinOptions?.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {filteredCabinOptions?.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground text-center">
                        No matching cabins found
                      </div>
                    ) : (
                      Object.keys(groupedOptions)?.map(deckName => (
                        <div key={deckName}>
                          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted/30 sticky top-0">
                            {deckName}
                          </div>
                          {groupedOptions?.[deckName]?.map(option => (
                            <button
                              key={option?.path}
                              type="button"
                              onClick={() => handleCabinSelect(option)}
                              className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
                            >
                              {option?.path}
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                )}
                
                {cabinOptions?.length === 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    No locations configured. Add cabins in Location Management.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Free Text Cabin Fallback */}
          {isEditing && !isDeleted && (
            <div className="space-y-1">
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                OR Cabin (free text)
              </label>
              <Input
                value={cabinFreeText}
                onChange={(e) => handleCabinFreeTextChange(e?.target?.value)}
                placeholder="Enter cabin manually if not in dropdown"
              />
              {cabinFreeText && selectedCabinPath && (
                <div className="text-xs text-muted-foreground">
                  Note: Dropdown selection takes priority for automation
                </div>
              )}
            </div>
          )}
        </div>

        {/* Section: Payment & APA (NEW - after Accommodation, before History) */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Icon name="CreditCard" size={18} />
            Payment &amp; APA
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Client Type</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.clientType || ''}
                  onChange={(value) => handleChange('clientType', value)}
                  options={clientTypeOptions}
                />
              ) : (
                <p className="text-foreground">{formData?.clientType || '-'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Preferred Currency</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.preferredCurrency || ''}
                  onChange={(value) => handleChange('preferredCurrency', value)}
                  options={currencyOptions}
                />
              ) : (
                <p className="text-foreground">{formData?.preferredCurrency || '-'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Billing Contact Name</label>
              {isEditing && !isDeleted ? (
                <Input
                  value={formData?.billingContactName || ''}
                  onChange={(e) => handleChange('billingContactName', e?.target?.value)}
                  placeholder="Full name"
                />
              ) : (
                <p className="text-foreground">{formData?.billingContactName || '-'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Billing Contact Email</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="email"
                  value={formData?.billingContactEmail || ''}
                  onChange={(e) => handleChange('billingContactEmail', e?.target?.value)}
                  placeholder="billing@example.com"
                />
              ) : (
                <p className="text-foreground">{formData?.billingContactEmail || '-'}</p>
              )}
            </div>
          </div>
          {/* APA Required Toggle */}
          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
            {isEditing && !isDeleted ? (
              <button
                type="button"
                onClick={() => handleChange('apaRequired', !formData?.apaRequired)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  formData?.apaRequired ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    formData?.apaRequired ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            ) : (
              <div
                className={`relative inline-flex h-6 w-11 items-center rounded-full ${
                  formData?.apaRequired ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white ${
                    formData?.apaRequired ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </div>
            )}
            <p className="text-sm font-medium text-foreground">APA Required?</p>
          </div>
          {/* APA Amount - only visible when APA Required = true */}
          {formData?.apaRequired && (
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">APA Amount</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="number"
                  value={formData?.apaAmount || ''}
                  onChange={(e) => handleChange('apaAmount', e?.target?.value ? parseFloat(e?.target?.value) : null)}
                  placeholder="0.00"
                />
              ) : (
                <p className="text-foreground">{formData?.apaAmount != null ? formData?.apaAmount : '-'}</p>
              )}
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1 block">APA Notes</label>
            {isEditing && !isDeleted ? (
              <textarea
                value={formData?.apaNotes || ''}
                onChange={(e) => handleChange('apaNotes', e?.target?.value)}
                placeholder="APA notes..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            ) : (
              <p className="text-foreground whitespace-pre-wrap">{formData?.apaNotes || '-'}</p>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1 block">Payment Notes</label>
            {isEditing && !isDeleted ? (
              <textarea
                value={formData?.paymentNotes || ''}
                onChange={(e) => handleChange('paymentNotes', e?.target?.value)}
                placeholder="Payment notes..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            ) : (
              <p className="text-foreground whitespace-pre-wrap">{formData?.paymentNotes || '-'}</p>
            )}
          </div>
        </div>

        {/* Section: NDA & Privacy (NEW - after Payment & APA, before History) */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Icon name="Shield" size={18} />
            NDA &amp; Privacy
          </h3>
          {/* NDA Signed Toggle */}
          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
            {isEditing && !isDeleted ? (
              <button
                type="button"
                onClick={() => handleChange('ndaSigned', !formData?.ndaSigned)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  formData?.ndaSigned ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    formData?.ndaSigned ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            ) : (
              <div
                className={`relative inline-flex h-6 w-11 items-center rounded-full ${
                  formData?.ndaSigned ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white ${
                    formData?.ndaSigned ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </div>
            )}
            <p className="text-sm font-medium text-foreground">NDA Signed?</p>
          </div>
          {/* NDA Expiry Date - only visible when NDA Signed = true */}
          {formData?.ndaSigned && (
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">NDA Expiry Date</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="date"
                  value={formData?.ndaExpiryDate || ''}
                  onChange={(e) => handleChange('ndaExpiryDate', e?.target?.value)}
                />
              ) : (
                <p className="text-foreground">{formData?.ndaExpiryDate || '-'}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Privacy Level</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.privacyLevel || 'Standard'}
                  onChange={(value) => handleChange('privacyLevel', value)}
                  options={privacyLevelOptions}
                />
              ) : (
                <p className="text-foreground">{formData?.privacyLevel || 'Standard'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Photo Permission</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.photoPermission || 'Ask Each Time'}
                  onChange={(value) => handleChange('photoPermission', value)}
                  options={photoPermissionOptions}
                />
              ) : (
                <p className="text-foreground">{formData?.photoPermission || 'Ask Each Time'}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Share Guest Info With Crew</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.shareGuestInfoWithCrew || 'Limited'}
                  onChange={(value) => handleChange('shareGuestInfoWithCrew', value)}
                  options={shareInfoOptions}
                />
              ) : (
                <p className="text-foreground">{formData?.shareGuestInfoWithCrew || 'Limited'}</p>
              )}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1 block">Privacy Notes</label>
            {isEditing && !isDeleted ? (
              <textarea
                value={formData?.privacyNotes || ''}
                onChange={(e) => handleChange('privacyNotes', e?.target?.value)}
                placeholder="Privacy notes..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            ) : (
              <p className="text-foreground whitespace-pre-wrap">{formData?.privacyNotes || '-'}</p>
            )}
          </div>
        </div>

        {/* Section: Preferences */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Icon name="Star" size={18} />
            Preferences
          </h3>
          {/* Open Preferences navigation button */}
          <button
            onClick={handleOpenPreferences}
            className="w-full px-4 py-3 bg-primary/10 hover:bg-primary/20 rounded-lg text-left flex items-center justify-between transition-colors border border-primary/20"
          >
            <div className="flex items-center gap-2">
              <Icon name="ExternalLink" size={16} className="text-primary" />
              <span className="text-sm font-medium text-primary">Open Preferences</span>
            </div>
            <Icon name="ChevronRight" size={16} className="text-primary" />
          </button>
          {/* Preferences page link */}
        </div>

        {/* Section: History */}
        {guest?.historyLog && guest?.historyLog?.length > 0 && (
          <div className="space-y-4">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2 text-lg font-semibold text-foreground hover:text-primary transition-colors"
            >
              <Icon name={showHistory ? "ChevronDown" : "ChevronRight"} size={18} />
              History
            </button>
            {showHistory && (
              <div className="space-y-2">
                {[...guest?.historyLog]?.reverse()?.map((entry) => (
                  <div key={entry?.id} className="p-3 bg-muted/30 rounded-lg border border-border">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                            entry?.action === 'created' ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400' :
                            entry?.action === 'updated' ? 'bg-green-500/20 text-green-700 dark:text-green-400' :
                            entry?.action === 'deleted' ? 'bg-red-500/20 text-red-700 dark:text-red-400' :
                            entry?.action === 'reinstated'? 'bg-green-500/20 text-green-700 dark:text-green-400' : 'bg-gray-500/20 text-gray-700 dark:text-gray-400'
                          }`}>
                            {entry?.action?.toUpperCase()}
                          </span>
                          <span className="text-sm font-medium text-foreground">{entry?.actorName}</span>
                          <span className="text-xs text-muted-foreground">({entry?.actorTier})</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{entry?.message}</p>
                        {entry?.changes && Object.keys(entry?.changes)?.length > 0 && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            <span className="font-medium">Changes: </span>
                            {Object.keys(entry?.changes)?.slice(0, 3)?.join(', ')}
                            {Object.keys(entry?.changes)?.length > 3 && ` +${Object.keys(entry?.changes)?.length - 3} more`}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap ml-3">
                        {new Date(entry?.at)?.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Delete Button - COMMAND ONLY */}
        {canDelete && !isEditing && !isDeleted && (
          <div className="pt-6 border-t border-border">
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(true)}
              className="text-error border-error hover:bg-error/10"
              iconName="Trash2"
            >
              Delete Guest
            </Button>
          </div>
        )}
      </div>
      {/* Delete Confirmation Modal - COMMAND ONLY */}
      {showDeleteConfirm && canDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-error/20 flex items-center justify-center">
                <Icon name="AlertTriangle" size={24} className="text-error" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">Delete guest?</h3>
              </div>
            </div>
            <div className="space-y-3 mb-6">
              <p className="text-sm text-foreground">
                This will remove the guest profile from Guest Management.
              </p>
              <p className="text-sm text-muted-foreground">
                This cannot be undone unless restored from audit history.
              </p>
              <label className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={deleteConfirmChecked}
                  onChange={(e) => setDeleteConfirmChecked(e?.target?.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-border text-error focus:ring-2 focus:ring-error"
                />
                <span className="text-sm text-foreground">
                  I understand this will delete the guest profile.
                </span>
              </label>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmChecked(false);
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDelete}
                disabled={!deleteConfirmChecked}
                className="flex-1 bg-error hover:bg-error/90 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Delete guest
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Kids Linking Modal */}
      {showKidsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Link Children</h3>
              <button
                type="button"
                onClick={() => setShowKidsModal(false)}
                className="p-1 rounded-lg hover:bg-muted transition-colors"
              >
                <Icon name="X" size={18} className="text-muted-foreground" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Select existing guest profiles to link as children of {formData?.firstName} {formData?.lastName}.
            </p>
            {kidsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : kidsOptions?.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No other guests available to link.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {kidsOptions?.map(kid => {
                  const isLinked = linkedKidIds?.includes(kid?.id);
                  return (
                    <button
                      key={kid?.id}
                      type="button"
                      onClick={() => handleToggleKid(kid?.id)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors ${
                        isLinked
                          ? 'border-primary bg-primary/10 text-primary' :'border-border bg-muted/30 text-foreground hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                          <Icon name="User" size={14} className="text-primary" />
                        </div>
                        <span className="text-sm font-medium">{kid?.firstName} {kid?.lastName}</span>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        isLinked ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                      }`}>
                        {isLinked ? 'Linked' : 'Unlinked'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={() => setShowKidsModal(false)}>Done</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GuestDetailPanel;
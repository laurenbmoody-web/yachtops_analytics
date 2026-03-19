import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

import { createLaundryItem, OwnerType, LaundryPriority } from '../utils/laundryStorage';
import { showToast } from '../../../utils/toast';
import { getAllDecks, getZonesByDeck, getSpacesByZone } from '../../locations-management-settings/utils/locationsHierarchyStorage';
import { loadGuests } from '../../guest-management-dashboard/utils/guestStorage';
import { getActiveGuestsFromCurrentTrip } from '../../trips-management-dashboard/utils/tripStorage';
import { loadUsers, UserStatus } from '../../../utils/authStorage';

const AddLaundryModal = ({ onClose, onSuccess }) => {
  const fileInputRef = useRef(null);
  
  const [step, setStep] = useState(1); // 1: Owner Type, 2: Photo, 3: Details
  const [formData, setFormData] = useState({
    ownerType: '',
    photo: '',
    description: '',
    ownerName: '',
    ownerGuestId: null,
    ownerDisplayName: '',
    area: '',
    areaLocationId: null,
    tags: [],
    priority: LaundryPriority?.NORMAL
  });
  
  const [photoPreview, setPhotoPreview] = useState(null);
  const [customTag, setCustomTag] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Guest selection states
  const [activeGuests, setActiveGuests] = useState([]);
  const [guestSearchQuery, setGuestSearchQuery] = useState('');
  const [showGuestDropdown, setShowGuestDropdown] = useState(false);
  const [selectedGuest, setSelectedGuest] = useState(null);
  
  // Crew selection states
  const [activeCrew, setActiveCrew] = useState([]);
  const [crewSearchQuery, setCrewSearchQuery] = useState('');
  const [showCrewDropdown, setShowCrewDropdown] = useState(false);
  const [selectedCrew, setSelectedCrew] = useState(null);
  
  // Location hierarchy states
  const [decks, setDecks] = useState([]);
  const [zones, setZones] = useState([]);
  const [spaces, setSpaces] = useState([]);
  const [selectedDeck, setSelectedDeck] = useState('');
  const [selectedZone, setSelectedZone] = useState('');
  const [selectedSpace, setSelectedSpace] = useState('');
  
  const availableTags = ['DryClean', 'HandWash', 'Iron', 'StainTreat', 'Delicate', 'Express'];
  
  // Load active guests when owner type is Guest
  useEffect(() => {
    if (formData?.ownerType === OwnerType?.GUEST) {
      // Get active guest IDs from current active trip
      const activeGuestIds = getActiveGuestsFromCurrentTrip();
      
      // Load all guests and filter to only active ones
      const allGuests = loadGuests()?.filter(g => !g?.isDeleted);
      const activeGuestsData = allGuests?.filter(g => activeGuestIds?.includes(g?.id));
      
      setActiveGuests(activeGuestsData);
    }
  }, [formData?.ownerType]);
  
  // Load active crew when owner type is Crew
  useEffect(() => {
    if (formData?.ownerType === OwnerType?.CREW) {
      const allUsers = loadUsers();
      const activeCrewMembers = allUsers?.filter(user => user?.status === UserStatus?.ACTIVE);
      setActiveCrew(activeCrewMembers);
    }
  }, [formData?.ownerType]);
  
  // Load decks on mount
  useEffect(() => {
    const loadedDecks = getAllDecks();
    console.log('AddLaundryModal - Loaded decks:', loadedDecks);
    setDecks(loadedDecks || []);
  }, []);
  
  // Load zones when deck changes
  useEffect(() => {
    if (selectedDeck) {
      const loadedZones = getZonesByDeck(selectedDeck);
      console.log('AddLaundryModal - Loaded zones for deck', selectedDeck, ':', loadedZones);
      setZones(loadedZones || []);
      setSelectedZone('');
      setSelectedSpace('');
      setSpaces([]);
    } else {
      setZones([]);
      setSpaces([]);
    }
  }, [selectedDeck]);
  
  // Load spaces when zone changes
  useEffect(() => {
    if (selectedZone) {
      const loadedSpaces = getSpacesByZone(selectedZone);
      console.log('AddLaundryModal - Loaded spaces for zone', selectedZone, ':', loadedSpaces);
      setSpaces(loadedSpaces || []);
      setSelectedSpace('');
    } else {
      setSpaces([]);
    }
  }, [selectedZone]);
  
  // Update formData.area when location selection changes
  useEffect(() => {
    if (selectedDeck && selectedZone && selectedSpace) {
      const deck = decks?.find(d => d?.id === selectedDeck);
      const zone = zones?.find(z => z?.id === selectedZone);
      const space = spaces?.find(s => s?.id === selectedSpace);
      const locationString = `${deck?.name} → ${zone?.name} → ${space?.name}`;
      setFormData(prev => ({ ...prev, area: locationString, areaLocationId: selectedSpace }));
    }
  }, [selectedDeck, selectedZone, selectedSpace, decks, zones, spaces]);
  
  const handleOwnerTypeSelect = (type) => {
    setFormData(prev => ({ ...prev, ownerType: type }));
    setStep(2);
  };
  
  const handleGuestSelect = (guest) => {
    if (guest === 'unknown') {
      setSelectedGuest(null);
      setFormData(prev => ({
        ...prev,
        ownerGuestId: null,
        ownerDisplayName: 'Unknown',
        ownerName: 'Unknown',
        area: '',
        areaLocationId: null
      }));
      setGuestSearchQuery('Unknown');
      // Clear location selections
      setSelectedDeck('');
      setSelectedZone('');
      setSelectedSpace('');
    } else {
      setSelectedGuest(guest);
      setFormData(prev => ({
        ...prev,
        ownerGuestId: guest?.id,
        ownerDisplayName: `${guest?.firstName} ${guest?.lastName}`,
        ownerName: `${guest?.firstName} ${guest?.lastName}`,
        area: guest?.cabinLocationLabel || guest?.cabinAllocated || '',
        areaLocationId: guest?.cabinLocationId || null
      }));
      setGuestSearchQuery(`${guest?.firstName} ${guest?.lastName}`);
      
      // Auto-fill location if guest has cabin allocated
      if (guest?.cabinLocationId) {
        // Try to parse and set location hierarchy
        const parts = (guest?.cabinLocationLabel || '')?.split(' → ');
        if (parts?.length === 3) {
          const deck = decks?.find(d => d?.name === parts?.[0]);
          if (deck) {
            setSelectedDeck(deck?.id);
          }
        }
      }
    }
    setShowGuestDropdown(false);
  };
  
  const getFilteredGuests = () => {
    // Always include Unknown option at the top
    const unknownOption = { id: 'unknown', firstName: 'Unknown', lastName: '' };
    
    if (!guestSearchQuery?.trim()) {
      return [unknownOption, ...activeGuests];
    }
    
    const query = guestSearchQuery?.toLowerCase()?.trim();
    
    // Filter active guests
    const filtered = activeGuests?.filter(guest => {
      const fullName = `${guest?.firstName} ${guest?.lastName}`?.toLowerCase();
      return fullName?.includes(query);
    });
    
    // Check if "unknown" matches the query
    if ('unknown'?.includes(query)) {
      return [unknownOption, ...filtered];
    }
    
    return filtered;
  };
  
  const getFilteredCrew = () => {
    if (!crewSearchQuery?.trim()) {
      return activeCrew;
    }
    const query = crewSearchQuery?.toLowerCase()?.trim();
    return activeCrew?.filter(crew => {
      const fullName = crew?.fullName?.toLowerCase();
      const roleTitle = crew?.roleTitle?.toLowerCase() || '';
      return fullName?.includes(query) || roleTitle?.includes(query);
    });
  };
  
  const handleCrewSelect = (crew) => {
    setSelectedCrew(crew);
    setFormData(prev => ({
      ...prev,
      ownerName: crew?.fullName,
      ownerCrewUserId: crew?.id,
      ownerDisplayName: crew?.fullName
    }));
    setCrewSearchQuery(crew?.fullName);
    setShowCrewDropdown(false);
  };
  
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
    reader.onloadend = async () => {
      try {
        const dataUrl = reader?.result;
        
        // Compress image to reduce storage size
        const compressedDataUrl = await compressImageForStorage(dataUrl);
        
        setPhotoPreview(compressedDataUrl);
        setFormData(prev => ({ ...prev, photo: compressedDataUrl }));
        setStep(3);
      } catch (error) {
        console.error('Error processing image:', error);
        showToast('Failed to process image. Please try a smaller file.', 'error');
      }
    };
    reader?.readAsDataURL(file);
  };

  // Image compression helper
  const compressImageForStorage = (dataUrl, maxWidth = 800, quality = 0.7) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calculate new dimensions maintaining aspect ratio
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to JPEG with quality compression (reduces size by ~70-80%)
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    });
  };
  
  const handleRemovePhoto = () => {
    setPhotoPreview(null);
    setFormData(prev => ({ ...prev, photo: '' }));
    if (fileInputRef?.current) {
      fileInputRef.current.value = '';
    }
    setStep(2);
  };
  
  const handleToggleTag = (tag) => {
    setFormData(prev => ({
      ...prev,
      tags: prev?.tags?.includes(tag)
        ? prev?.tags?.filter(t => t !== tag)
        : [...prev?.tags, tag]
    }));
  };
  
  const handleAddCustomTag = () => {
    if (!customTag?.trim()) return;
    
    if (formData?.tags?.includes(customTag?.trim())) {
      showToast('Tag already added', 'error');
      return;
    }
    
    setFormData(prev => ({
      ...prev,
      tags: [...prev?.tags, customTag?.trim()]
    }));
    setCustomTag('');
  };
  
  const handleRemoveTag = (tag) => {
    setFormData(prev => ({
      ...prev,
      tags: prev?.tags?.filter(t => t !== tag)
    }));
  };
  
  const handleSubmit = async () => {
    // Validation
    if (!formData?.description?.trim()) {
      showToast('Please add a description', 'error');
      return;
    }

    // Guest-specific validation
    if (formData?.ownerType === OwnerType?.GUEST) {
      if (!formData?.ownerGuestId && formData?.ownerDisplayName !== 'Unknown') {
        showToast('Please select a guest', 'error');
        return;
      }

      // Unknown guest requires area
      if (formData?.ownerDisplayName === 'Unknown' && !formData?.area?.trim()) {
        showToast('Area is required when Guest is Unknown', 'error');
        return;
      }

      // Named guest with no cabin and no area
      if (formData?.ownerDisplayName !== 'Unknown' && !formData?.area?.trim()) {
        const selectedGuest = activeGuests?.find(g => g?.id === formData?.ownerGuestId);
        if (!selectedGuest?.cabinLocationLabel) {
          showToast('Select an area or set this guest\'s cabin in Guest Management', 'error');
          return;
        }
      }
    }

    // Crew-specific validation
    if (formData?.ownerType === OwnerType?.CREW) {
      if (!formData?.ownerCrewUserId) {
        showToast('Please select a crew member', 'error');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const newItem = createLaundryItem({
        ownerType: formData?.ownerType,
        ownerName: formData?.ownerName,
        ownerGuestId: formData?.ownerGuestId,
        ownerCrewUserId: formData?.ownerCrewUserId,
        ownerDisplayName: formData?.ownerDisplayName,
        area: formData?.area,
        areaLocationId: formData?.areaLocationId,
        photo: formData?.photo,
        description: formData?.description,
        priority: formData?.priority,
        tags: formData?.tags,
        notes: formData?.notes
      });

      showToast('Laundry item added successfully', 'success');
      onSuccess?.(newItem);
      onClose?.();
    } catch (error) {
      console.error('Error creating laundry item:', error);
      
      if (error?.message === 'QUOTA_EXCEEDED') {
        showToast(
          'Storage limit reached. Try removing old laundry items or use smaller photos.',
          'error'
        );
      } else {
        showToast('Failed to add laundry item. Please try again.', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Add Laundry</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {step === 1 && 'Step 1: Choose owner type'}
              {step === 2 && 'Step 2: Take or upload photo'}
              {step === 3 && 'Step 3: Add details'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} className="text-muted-foreground" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6">
          {/* Step 1: Owner Type Selection */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Who does this laundry belong to?</p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => handleOwnerTypeSelect(OwnerType?.GUEST)}
                  className="p-8 border-2 border-border rounded-xl hover:border-primary hover:bg-primary/5 transition-smooth flex flex-col items-center gap-3"
                >
                  <Icon name="User" size={48} className="text-primary" />
                  <span className="text-lg font-semibold text-foreground">Guest</span>
                </button>
                <button
                  onClick={() => handleOwnerTypeSelect(OwnerType?.CREW)}
                  className="p-8 border-2 border-border rounded-xl hover:border-primary hover:bg-primary/5 transition-smooth flex flex-col items-center gap-3"
                >
                  <Icon name="Users" size={48} className="text-primary" />
                  <span className="text-lg font-semibold text-foreground">Crew</span>
                </button>
              </div>
            </div>
          )}
          
          {/* Step 2: Photo Upload */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef?.current?.click()}
                  className="w-full p-12 border-2 border-dashed border-border rounded-xl hover:border-primary hover:bg-primary/5 transition-smooth flex flex-col items-center gap-4"
                >
                  <Icon name="Camera" size={64} className="text-muted-foreground" />
                  <div>
                    <p className="text-lg font-semibold text-foreground">Take or Upload Photo</p>
                    <p className="text-sm text-muted-foreground mt-1">Required • Max 5MB</p>
                  </div>
                </button>
              </div>
              <Button
                variant="ghost"
                onClick={() => setStep(1)}
                className="w-full"
              >
                <Icon name="ChevronLeft" size={16} className="mr-2" />
                Back
              </Button>
            </div>
          )}
          
          {/* Step 3: Details Form */}
          {step === 3 && (
            <div className="space-y-6">
              {/* Photo Preview */}
              {photoPreview && (
                <div className="relative">
                  <img
                    src={photoPreview}
                    alt="Laundry item preview"
                    className="w-full h-48 object-cover rounded-lg"
                  />
                  <button
                    onClick={handleRemovePhoto}
                    className="absolute top-2 right-2 p-2 bg-error text-white rounded-lg hover:bg-error/90 transition-smooth"
                  >
                    <Icon name="Trash2" size={16} />
                  </button>
                </div>
              )}
              
              {/* Owner Type Badge */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Owner type:</span>
                <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-medium">
                  {formData?.ownerType}
                </span>
              </div>
              
              {/* Description (Required) */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Description <span className="text-error">*</span>
                </label>
                <textarea
                  value={formData?.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e?.target?.value }))}
                  placeholder="Start with item + colour + instructions…"
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              
              {/* Owner Name / Guest Selection */}
              {formData?.ownerType === OwnerType?.GUEST ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Guest *</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search guest or select Unknown..."
                      value={guestSearchQuery}
                      onChange={(e) => {
                        setGuestSearchQuery(e?.target?.value);
                        setShowGuestDropdown(true);
                      }}
                      onFocus={() => setShowGuestDropdown(true)}
                      className="w-full h-10 px-4 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    
                    {/* Dropdown */}
                    {showGuestDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto z-10">
                        {/* Unknown Option - Always at top */}
                        <button
                          type="button"
                          onClick={() => handleGuestSelect('unknown')}
                          className="w-full px-4 py-2 text-left hover:bg-muted transition-colors border-b border-border"
                        >
                          <div className="font-medium text-foreground">Unknown</div>
                          <div className="text-xs text-muted-foreground">Guest identity not specified</div>
                        </button>
                        
                        {/* Active Guests */}
                        {getFilteredGuests()?.length > 0 ? (
                          getFilteredGuests()?.map(guest => (
                            <button
                              key={guest?.id}
                              type="button"
                              onClick={() => handleGuestSelect(guest)}
                              className="w-full px-4 py-2 text-left hover:bg-muted transition-colors"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium text-foreground">
                                    {guest?.firstName} {guest?.lastName}
                                  </div>
                                  {(guest?.cabinLocationLabel || guest?.cabinAllocated) && (
                                    <div className="text-xs text-muted-foreground">
                                      {guest?.cabinLocationLabel || guest?.cabinAllocated}
                                    </div>
                                  )}
                                </div>
                                <span className="px-2 py-0.5 text-xs font-medium bg-green-500/20 text-green-700 dark:text-green-400 rounded-full">
                                  Active
                                </span>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-6 text-center text-muted-foreground">
                            No active guests found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {formData?.ownerDisplayName && (
                    <div className="text-sm text-muted-foreground">
                      Selected: {formData?.ownerDisplayName}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Crew Member Name *</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search crew member..."
                      value={crewSearchQuery}
                      onChange={(e) => {
                        setCrewSearchQuery(e?.target?.value);
                        setShowCrewDropdown(true);
                      }}
                      onFocus={() => setShowCrewDropdown(true)}
                      className="w-full h-10 px-4 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    
                    {/* Crew Dropdown */}
                    {showCrewDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto z-10">
                        {getFilteredCrew()?.length > 0 ? (
                          getFilteredCrew()?.map(crew => (
                            <button
                              key={crew?.id}
                              type="button"
                              onClick={() => handleCrewSelect(crew)}
                              className="w-full px-4 py-2 text-left hover:bg-muted transition-colors"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium text-foreground">
                                    {crew?.fullName}
                                  </div>
                                  {crew?.roleTitle && (
                                    <div className="text-xs text-muted-foreground">
                                      {crew?.roleTitle} • {crew?.department}
                                    </div>
                                  )}
                                </div>
                                <span className="px-2 py-0.5 text-xs font-medium bg-green-500/20 text-green-700 dark:text-green-400 rounded-full">
                                  Active
                                </span>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-6 text-center text-muted-foreground">
                            No active crew members found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {formData?.ownerName && (
                    <div className="text-sm text-muted-foreground">
                      Selected: {formData?.ownerName}
                    </div>
                  )}
                </div>
              )}
              
              {/* Area / Location - Dropdown from Locations Management */}
              {/* Only show for Guest owner type */}
              {formData?.ownerType === OwnerType?.GUEST && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Area / Location
                  </label>
                  <div className="space-y-3">
                    {/* Deck Selection */}
                    <select
                      value={selectedDeck}
                      onChange={(e) => setSelectedDeck(e?.target?.value)}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">Select Deck</option>
                      {decks?.map(deck => (
                        <option key={deck?.id} value={deck?.id}>{deck?.name}</option>
                      ))}
                    </select>
                    
                    {/* Zone Selection */}
                    {selectedDeck && (
                      <select
                        value={selectedZone}
                        onChange={(e) => setSelectedZone(e?.target?.value)}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select Zone</option>
                        {zones?.map(zone => (
                          <option key={zone?.id} value={zone?.id}>{zone?.name}</option>
                        ))}
                      </select>
                    )}
                    
                    {/* Space Selection */}
                    {selectedZone && (
                      <select
                        value={selectedSpace}
                        onChange={(e) => setSelectedSpace(e?.target?.value)}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="">Select Space</option>
                        {spaces?.map(space => (
                          <option key={space?.id} value={space?.id}>{space?.name}</option>
                        ))}
                      </select>
                    )}
                    
                    {/* Display selected location */}
                    {formData?.area && (
                      <div className="px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg text-sm text-foreground">
                        <span className="font-medium">Selected: </span>{formData?.area}
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Tags (Optional) */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Tags</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {availableTags?.map(tag => (
                    <button
                      key={tag}
                      onClick={() => handleToggleTag(tag)}
                      className={`px-3 py-1 rounded-full text-sm font-medium transition-smooth ${
                        formData?.tags?.includes(tag)
                          ? 'bg-primary text-white' :'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                
                {/* Custom Tags */}
                {formData?.tags?.filter(t => !availableTags?.includes(t))?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {formData?.tags?.filter(t => !availableTags?.includes(t))?.map(tag => (
                      <span
                        key={tag}
                        className="px-3 py-1 bg-primary text-white rounded-full text-sm font-medium flex items-center gap-2"
                      >
                        {tag}
                        <button onClick={() => handleRemoveTag(tag)}>
                          <Icon name="X" size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                
                {/* Add Custom Tag */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customTag}
                    onChange={(e) => setCustomTag(e?.target?.value)}
                    onKeyPress={(e) => e?.key === 'Enter' && handleAddCustomTag()}
                    placeholder="Add custom tag"
                    className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <Button
                    variant="outline"
                    onClick={handleAddCustomTag}
                    disabled={!customTag?.trim()}
                  >
                    Add
                  </Button>
                </div>
              </div>
              
              {/* Urgent Toggle */}
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-sm font-medium text-foreground">Mark as Urgent</p>
                  <p className="text-xs text-muted-foreground mt-1">Priority handling required</p>
                </div>
                <button
                  onClick={() => setFormData(prev => ({
                    ...prev,
                    priority: prev?.priority === LaundryPriority?.URGENT
                      ? LaundryPriority?.NORMAL
                      : LaundryPriority?.URGENT
                  }))}
                  className={`relative w-12 h-6 rounded-full transition-smooth ${
                    formData?.priority === LaundryPriority?.URGENT ? 'bg-error' : 'bg-border'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      formData?.priority === LaundryPriority?.URGENT ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>
        
        {/* Footer */}
        {step === 3 && (
          <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 flex items-center justify-between rounded-b-2xl">
            <Button
              variant="ghost"
              onClick={() => setStep(2)}
            >
              <Icon name="ChevronLeft" size={16} className="mr-2" />
              Back
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !formData?.description?.trim()}
              loading={isSubmitting}
            >
              Save Laundry Item
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AddLaundryModal;
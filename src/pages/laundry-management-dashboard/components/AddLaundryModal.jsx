import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import '../laundry.css';

import { createLaundryItem, OwnerType, LaundryPriority } from '../utils/laundryStorage';
import { showToast } from '../../../utils/toast';
import { getAllDecks, getZonesByDeck, getSpacesByZone } from '../../locations-management-settings/utils/locationsHierarchyStorage';
import { loadGuests } from '../../guest-management-dashboard/utils/guestStorage';
import { getActiveGuestsFromCurrentTrip } from '../../trips-management-dashboard/utils/tripStorage';
import { loadUsers, UserStatus } from '../../../utils/authStorage';

import ModalShell from '../../../components/ui/ModalShell';
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
      const loadActiveGuests = async () => {
        const activeGuestIds = await getActiveGuestsFromCurrentTrip();
        const allGuests = await loadGuests();
        const filtered = (allGuests || []).filter(g => !g?.isDeleted);
        const activeGuestsData = filtered.filter(g => activeGuestIds?.includes(g?.id));
        setActiveGuests(activeGuestsData);
      };
      loadActiveGuests();
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
    const loadDecks = async () => {
      const loadedDecks = await getAllDecks();
      setDecks(loadedDecks || []);
    };
    loadDecks();
  }, []);

  // Load zones when deck changes
  useEffect(() => {
    if (selectedDeck) {
      const loadZones = async () => {
        const loadedZones = await getZonesByDeck(selectedDeck);
        setZones(loadedZones || []);
        setSelectedZone('');
        setSelectedSpace('');
        setSpaces([]);
      };
      loadZones();
    } else {
      setZones([]);
      setSpaces([]);
    }
  }, [selectedDeck]);

  // Load spaces when zone changes
  useEffect(() => {
    if (selectedZone) {
      const loadSpaces = async () => {
        const loadedSpaces = await getSpacesByZone(selectedZone);
        setSpaces(loadedSpaces || []);
        setSelectedSpace('');
      };
      loadSpaces();
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
  
  const stepLabel = step === 1 ? 'Step 1 of 3 · Owner' : step === 2 ? 'Step 2 of 3 · Photo' : 'Step 3 of 3 · Details';
  const customTags = formData?.tags?.filter((t) => !availableTags?.includes(t)) || [];

  return (
    <ModalShell onClose={onClose} panelClassName="alm-panel">
      {/* Header */}
      <div className="alm-head">
        <div>
          <div className="alm-eyebrow">{stepLabel}</div>
          <h2 className="alm-title">Add laundry</h2>
        </div>
        <button className="alm-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
      </div>

      {/* Content */}
      <div className="alm-body">
        {/* Step 1: Owner Type */}
        {step === 1 && (
          <>
            <p className="alm-q">Who does this laundry belong to?</p>
            <div className="alm-choices">
              <button type="button" className="alm-choice" onClick={() => handleOwnerTypeSelect(OwnerType?.GUEST)}>
                <Icon name="User" size={34} className="alm-choice-ic" />
                <span className="alm-choice-label">Guest</span>
              </button>
              <button type="button" className="alm-choice" onClick={() => handleOwnerTypeSelect(OwnerType?.CREW)}>
                <Icon name="Users" size={34} className="alm-choice-ic" />
                <span className="alm-choice-label">Crew</span>
              </button>
            </div>
          </>
        )}

        {/* Step 2: Photo */}
        {step === 2 && (
          <>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
            <button type="button" className="alm-drop" onClick={() => fileInputRef?.current?.click()}>
              <Icon name="Camera" size={44} className="alm-drop-ic" />
              <span className="alm-drop-title">Take or upload photo</span>
              <span className="alm-drop-sub">Optional · Max 5MB</span>
            </button>
            <div className="alm-step2-actions">
              <button type="button" className="alm-btn outline" onClick={() => setStep(1)}>
                <Icon name="ChevronLeft" size={16} /> Back
              </button>
              <button type="button" className="alm-btn outline accent" onClick={() => setStep(3)}>
                Skip photo <Icon name="ChevronRight" size={16} />
              </button>
            </div>
          </>
        )}

        {/* Step 3: Details */}
        {step === 3 && (
          <>
            {photoPreview && (
              <div className="alm-preview">
                <img src={photoPreview} alt="Laundry item preview" />
                <button type="button" onClick={handleRemovePhoto} aria-label="Remove photo"><Icon name="Trash2" size={15} /></button>
              </div>
            )}

            <div className="alm-ownerrow">
              <span className="alm-ownerrow-label">Owner type</span>
              <span className="alm-owner-pill">{formData?.ownerType}</span>
            </div>

            {/* Description */}
            <div className="alm-section">
              <label className="alm-label">Description <span className="alm-req">required</span></label>
              <textarea
                className="alm-field"
                value={formData?.description}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e?.target?.value }))}
                placeholder="Start with item + colour + instructions…"
                rows={3}
              />
            </div>

            {/* Owner / Guest or Crew search */}
            {formData?.ownerType === OwnerType?.GUEST ? (
              <div className="alm-section">
                <label className="alm-label">Guest <span className="alm-req">required</span></label>
                <div className="alm-combo">
                  <input
                    type="text"
                    className="alm-field"
                    placeholder="Search guest or select Unknown…"
                    value={guestSearchQuery}
                    onChange={(e) => { setGuestSearchQuery(e?.target?.value); setShowGuestDropdown(true); }}
                    onFocus={() => setShowGuestDropdown(true)}
                  />
                  {showGuestDropdown && (
                    <div className="alm-combo-menu">
                      <button type="button" className="alm-combo-opt" onClick={() => handleGuestSelect('unknown')}>
                        <span><span className="alm-combo-name">Unknown</span><span className="alm-combo-meta">Guest identity not specified</span></span>
                      </button>
                      {getFilteredGuests()?.filter((g) => g?.id !== 'unknown')?.length > 0 ? (
                        getFilteredGuests()?.filter((g) => g?.id !== 'unknown')?.map((guest) => (
                          <button key={guest?.id} type="button" className="alm-combo-opt" onClick={() => handleGuestSelect(guest)}>
                            <span style={{ minWidth: 0 }}>
                              <span className="alm-combo-name">{guest?.firstName} {guest?.lastName}</span>
                              {(guest?.cabinLocationLabel || guest?.cabinAllocated) && (
                                <span className="alm-combo-meta">{guest?.cabinLocationLabel || guest?.cabinAllocated}</span>
                              )}
                            </span>
                            <span className="alm-combo-active">Active</span>
                          </button>
                        ))
                      ) : (
                        <div className="alm-combo-empty">No active guests found</div>
                      )}
                    </div>
                  )}
                </div>
                {formData?.ownerDisplayName && <div className="alm-selected">Selected: {formData?.ownerDisplayName}</div>}
              </div>
            ) : (
              <div className="alm-section">
                <label className="alm-label">Crew member <span className="alm-req">required</span></label>
                <div className="alm-combo">
                  <input
                    type="text"
                    className="alm-field"
                    placeholder="Search crew member…"
                    value={crewSearchQuery}
                    onChange={(e) => { setCrewSearchQuery(e?.target?.value); setShowCrewDropdown(true); }}
                    onFocus={() => setShowCrewDropdown(true)}
                  />
                  {showCrewDropdown && (
                    <div className="alm-combo-menu">
                      {getFilteredCrew()?.length > 0 ? getFilteredCrew()?.map((crew) => (
                        <button key={crew?.id} type="button" className="alm-combo-opt" onClick={() => handleCrewSelect(crew)}>
                          <span style={{ minWidth: 0 }}>
                            <span className="alm-combo-name">{crew?.fullName}</span>
                            {crew?.roleTitle && <span className="alm-combo-meta">{crew?.roleTitle} · {crew?.department}</span>}
                          </span>
                          <span className="alm-combo-active">Active</span>
                        </button>
                      )) : (
                        <div className="alm-combo-empty">No active crew members found</div>
                      )}
                    </div>
                  )}
                </div>
                {formData?.ownerName && <div className="alm-selected">Selected: {formData?.ownerName}</div>}
              </div>
            )}

            {/* Area / Location (Guest only) */}
            {formData?.ownerType === OwnerType?.GUEST && (
              <div className="alm-section">
                <label className="alm-label">Area / Location <span className="alm-opt">optional</span></label>
                <div className="alm-stack">
                  <div className="alm-select-wrap">
                    <select className="alm-field" value={selectedDeck} onChange={(e) => setSelectedDeck(e?.target?.value)}>
                      <option value="">Select deck</option>
                      {decks?.map((deck) => <option key={deck?.id} value={deck?.id}>{deck?.name}</option>)}
                    </select>
                  </div>
                  {selectedDeck && (
                    <div className="alm-select-wrap">
                      <select className="alm-field" value={selectedZone} onChange={(e) => setSelectedZone(e?.target?.value)}>
                        <option value="">Select zone</option>
                        {zones?.map((zone) => <option key={zone?.id} value={zone?.id}>{zone?.name}</option>)}
                      </select>
                    </div>
                  )}
                  {selectedZone && (
                    <div className="alm-select-wrap">
                      <select className="alm-field" value={selectedSpace} onChange={(e) => setSelectedSpace(e?.target?.value)}>
                        <option value="">Select space</option>
                        {spaces?.map((space) => <option key={space?.id} value={space?.id}>{space?.name}</option>)}
                      </select>
                    </div>
                  )}
                  {formData?.area && <div className="alm-loc"><b>Selected:</b> {formData?.area}</div>}
                </div>
              </div>
            )}

            {/* Tags */}
            <div className="alm-section">
              <label className="alm-label">Tags <span className="alm-opt">optional</span></label>
              <div className="alm-tags">
                {availableTags?.map((tag) => (
                  <button key={tag} type="button" className={`alm-tag${formData?.tags?.includes(tag) ? ' on' : ''}`} onClick={() => handleToggleTag(tag)}>
                    {tag}
                  </button>
                ))}
              </div>
              {customTags.length > 0 && (
                <div className="alm-tags">
                  {customTags.map((tag) => (
                    <span key={tag} className="alm-custom-chip">
                      {tag}
                      <button type="button" onClick={() => handleRemoveTag(tag)} aria-label={`Remove ${tag}`}><Icon name="X" size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="alm-addtag">
                <input
                  type="text"
                  className="alm-field"
                  value={customTag}
                  onChange={(e) => setCustomTag(e?.target?.value)}
                  onKeyDown={(e) => { if (e?.key === 'Enter') { e.preventDefault(); handleAddCustomTag(); } }}
                  placeholder="Add a custom tag"
                />
                <button type="button" className="alm-btn outline" onClick={handleAddCustomTag} disabled={!customTag?.trim()}>Add</button>
              </div>
            </div>

            {/* Urgent */}
            <div className="alm-urgent">
              <div>
                <div className="alm-urgent-title">Mark as urgent</div>
                <div className="alm-urgent-sub">Priority handling required</div>
              </div>
              <button
                type="button"
                aria-pressed={formData?.priority === LaundryPriority?.URGENT}
                aria-label="Mark as urgent"
                className={`alm-switch${formData?.priority === LaundryPriority?.URGENT ? ' on' : ''}`}
                onClick={() => setFormData((prev) => ({
                  ...prev,
                  priority: prev?.priority === LaundryPriority?.URGENT ? LaundryPriority?.NORMAL : LaundryPriority?.URGENT,
                }))}
              />
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {step === 3 && (
        <div className="alm-foot">
          <button type="button" className="alm-linkbtn" onClick={() => setStep(2)}>
            <Icon name="ChevronLeft" size={16} /> Back
          </button>
          <button
            type="button"
            className="alm-btn primary"
            onClick={handleSubmit}
            disabled={isSubmitting || !formData?.description?.trim()}
          >
            {isSubmitting ? 'Saving…' : 'Save laundry item'}
          </button>
        </div>
      )}
    </ModalShell>
  );
};

export default AddLaundryModal;
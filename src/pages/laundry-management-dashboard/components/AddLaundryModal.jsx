import React, { useState, useRef, useEffect, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import '../laundry.css';

import { createLaundryItem, OwnerType, LaundryPriority } from '../utils/laundryStorage';
import { showToast } from '../../../utils/toast';
import { getAllDecks, getAllZones, getAllSpaces } from '../../locations-management-settings/utils/locationsHierarchyStorage';
import { loadGuests } from '../../guest-management-dashboard/utils/guestStorage';
import { getActiveGuestsFromCurrentTrip } from '../../trips-management-dashboard/utils/tripStorage';
import { loadUsers, UserStatus } from '../../../utils/authStorage';
import { useTenant } from '../../../contexts/TenantContext';
import { loadOnboardCrew } from '../utils/onboardCrew';
import ModalShell from '../../../components/ui/ModalShell';

const availableTags = ['DryClean', 'HandWash', 'Iron', 'StainTreat', 'Delicate', 'Express'];
const SpeechRec = (typeof window !== 'undefined') && (window.SpeechRecognition || window.webkitSpeechRecognition);

// Single-screen Add Laundry. Owner (segmented Guest/Crew, with Urgent far
// right) → identity fields → description (type or dictate) → photo → tags +
// notes. Guest: name + cabin, or Unknown + colour + area found. Crew: name +
// laundry number (± colour).
const AddLaundryModal = ({ onClose, onSuccess }) => {
  const { activeTenantId } = useTenant();
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);

  const [formData, setFormData] = useState({
    ownerType: OwnerType?.GUEST,
    photo: '',
    description: '',
    ownerName: '',
    ownerGuestId: null,
    ownerCrewUserId: null,
    ownerDisplayName: '',
    area: '',
    areaLocationId: null,
    colour: '',
    laundryNumber: '',
    notes: '',
    tags: [],
    priority: LaundryPriority?.NORMAL,
  });

  const [photoPreview, setPhotoPreview] = useState(null);
  const [customTag, setCustomTag] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  const [activeGuests, setActiveGuests] = useState([]);
  const [guestSearchQuery, setGuestSearchQuery] = useState('');
  const [showGuestDropdown, setShowGuestDropdown] = useState(false);
  const [activeCrew, setActiveCrew] = useState([]);
  const [crewSearchQuery, setCrewSearchQuery] = useState('');
  const [showCrewDropdown, setShowCrewDropdown] = useState(false);

  const [locations, setLocations] = useState([]);
  const [locationQuery, setLocationQuery] = useState('');
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);

  const isGuest = formData?.ownerType === OwnerType?.GUEST;
  const isUnknown = formData?.ownerDisplayName === 'Unknown';
  const isUrgent = formData?.priority === LaundryPriority?.URGENT;

  const clearError = (key) => setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  const setField = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!isGuest) return;
    (async () => {
      const activeGuestIds = await getActiveGuestsFromCurrentTrip();
      const allGuests = await loadGuests();
      const filtered = (allGuests || []).filter((g) => !g?.isDeleted);
      setActiveGuests(filtered.filter((g) => activeGuestIds?.includes(g?.id)));
    })();
  }, [isGuest]);

  // Crew picker: only members active AND on board for today (excludes leave /
  // rotation / medical / travelling), each with their berth cabin. Falls back
  // to the local user store when there's no Supabase tenant (sample/dev).
  useEffect(() => {
    if (isGuest) return undefined;
    let cancelled = false;
    (async () => {
      if (activeTenantId) {
        const crew = await loadOnboardCrew(activeTenantId, new Date());
        if (!cancelled) setActiveCrew(crew);
      } else {
        const allUsers = loadUsers();
        const mapped = (allUsers?.filter((u) => u?.status === UserStatus?.ACTIVE) || [])
          .map((u) => ({ id: u.id, fullName: u.fullName, roleTitle: u.roleTitle, department: u.department, cabin: '' }));
        if (!cancelled) setActiveCrew(mapped);
      }
    })();
    return () => { cancelled = true; };
  }, [isGuest, activeTenantId]);

  useEffect(() => {
    (async () => {
      try {
        const [decks, zones, spaces] = await Promise.all([getAllDecks(), getAllZones(), getAllSpaces()]);
        const deckName = new Map((decks || []).map((d) => [d?.id, d?.name]));
        const zoneById = new Map((zones || []).map((z) => [z?.id, z]));
        setLocations((spaces || []).map((s) => {
          const z = zoneById.get(s?.zoneId);
          const label = [z ? deckName.get(z?.deckId) : null, z?.name, s?.name].filter(Boolean).join(' → ');
          return { id: s?.id, label };
        }));
      } catch (e) {
        console.warn('[AddLaundryModal] locations load failed', e);
        setLocations([]);
      }
    })();
  }, []);

  // Stop dictation if the modal unmounts.
  useEffect(() => () => { try { recognitionRef.current?.stop(); } catch { /* noop */ } }, []);

  const toggleMic = () => {
    if (!SpeechRec) return;
    if (listening) { try { recognitionRef.current?.stop(); } catch { /* noop */ } setListening(false); return; }
    const rec = new SpeechRec();
    rec.lang = 'en-GB'; rec.interimResults = false; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0]?.transcript).join(' ').trim();
      if (text) { setFormData((prev) => ({ ...prev, description: prev.description ? `${prev.description} ${text}` : text })); clearError('description'); }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  };

  const chooseOwnerType = (type) => {
    setFormData((prev) => ({
      ...prev, ownerType: type,
      ownerGuestId: null, ownerCrewUserId: null, ownerName: '', ownerDisplayName: '',
      area: '', areaLocationId: null, colour: '', laundryNumber: '',
    }));
    setGuestSearchQuery(''); setCrewSearchQuery(''); setLocationQuery(''); setErrors({});
  };

  const handleGuestSelect = (guest) => {
    if (guest === 'unknown') {
      setFormData((prev) => ({ ...prev, ownerGuestId: null, ownerDisplayName: 'Unknown', ownerName: 'Unknown', area: '', areaLocationId: null }));
      setGuestSearchQuery('Unknown'); setLocationQuery('');
    } else {
      const name = `${guest?.firstName} ${guest?.lastName}`.trim();
      setFormData((prev) => ({
        ...prev, ownerGuestId: guest?.id, ownerDisplayName: name, ownerName: name,
        area: guest?.cabinLocationLabel || guest?.cabinAllocated || '', areaLocationId: guest?.cabinLocationId || null,
      }));
      setGuestSearchQuery(name);
      setLocationQuery(guest?.cabinLocationLabel || guest?.cabinAllocated || '');
    }
    setShowGuestDropdown(false); clearError('owner');
  };

  const handleCrewSelect = (crew) => {
    setFormData((prev) => ({
      ...prev,
      ownerName: crew?.fullName, ownerCrewUserId: crew?.id, ownerDisplayName: crew?.fullName,
      area: crew?.cabin || prev.area, areaLocationId: null,
      laundryNumber: crew?.laundryNumber || prev.laundryNumber,
      colour: crew?.laundryColour || prev.colour,
    }));
    setCrewSearchQuery(crew?.fullName); setShowCrewDropdown(false); clearError('owner');
  };

  const handleLocationSelect = (loc) => {
    setFormData((prev) => ({ ...prev, area: loc?.label, areaLocationId: loc?.id }));
    setLocationQuery(loc?.label); setShowLocationDropdown(false); clearError('area');
  };

  const getFilteredGuests = () => {
    const q = guestSearchQuery?.toLowerCase()?.trim();
    if (!q || q === 'unknown') return activeGuests;
    return activeGuests?.filter((g) => `${g?.firstName} ${g?.lastName}`.toLowerCase().includes(q));
  };
  const getFilteredCrew = () => {
    const q = crewSearchQuery?.toLowerCase()?.trim();
    if (!q) return activeCrew;
    return activeCrew?.filter((c) => c?.fullName?.toLowerCase()?.includes(q) || (c?.roleTitle || '').toLowerCase().includes(q));
  };
  const filteredLocations = useMemo(() => {
    const q = locationQuery?.toLowerCase()?.trim();
    if (!q) return locations.slice(0, 40);
    return locations.filter((l) => l?.label?.toLowerCase()?.includes(q)).slice(0, 40);
  }, [locations, locationQuery]);

  const compressImageForStorage = (dataUrl, maxWidth = 800, quality = 0.7) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxWidth) { height = (height * maxWidth) / width; width = maxWidth; }
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });

  const handlePhotoUpload = (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (!file?.type?.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
    if (file?.size > 5 * 1024 * 1024) { showToast('Image size must be less than 5MB', 'error'); return; }
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const compressed = await compressImageForStorage(reader?.result);
        setPhotoPreview(compressed); setField('photo', compressed);
      } catch (err) {
        console.error('Error processing image:', err);
        showToast('Failed to process image. Please try a smaller file.', 'error');
      }
    };
    reader?.readAsDataURL(file);
  };
  const handleRemovePhoto = () => {
    setPhotoPreview(null); setField('photo', '');
    if (fileInputRef?.current) fileInputRef.current.value = '';
  };

  const handleToggleTag = (tag) => setFormData((prev) => ({
    ...prev, tags: prev?.tags?.includes(tag) ? prev?.tags?.filter((t) => t !== tag) : [...prev?.tags, tag],
  }));
  const handleAddCustomTag = () => {
    const t = customTag?.trim();
    if (!t) return;
    if (formData?.tags?.includes(t)) { showToast('Tag already added', 'error'); return; }
    setFormData((prev) => ({ ...prev, tags: [...prev?.tags, t] })); setCustomTag('');
  };
  const handleRemoveTag = (tag) => setFormData((prev) => ({ ...prev, tags: prev?.tags?.filter((t) => t !== tag) }));

  const validate = () => {
    const next = {};
    if (!formData?.description?.trim()) next.description = 'Add a short description.';
    if (isGuest) {
      if (isUnknown) {
        if (!formData?.colour?.trim()) next.colour = 'Note a colour or item so it can be found again.';
        if (!formData?.area?.trim()) next.area = 'Where was it found?';
      } else if (!formData?.ownerGuestId) {
        next.owner = 'Select a guest, or choose Unknown.';
      }
    } else if (!formData?.ownerCrewUserId) {
      next.owner = 'Select a crew member.';
    }
    return next;
  };

  const handleSubmit = async () => {
    const next = validate();
    if (Object.keys(next).length) { setErrors(next); return; }
    setIsSubmitting(true);
    try {
      const newItem = await createLaundryItem({
        ownerType: formData?.ownerType,
        ownerName: formData?.ownerName,
        ownerGuestId: formData?.ownerGuestId,
        ownerCrewUserId: formData?.ownerCrewUserId,
        ownerDisplayName: formData?.ownerDisplayName,
        area: formData?.area,
        areaLocationId: formData?.areaLocationId,
        colour: formData?.colour,
        laundryNumber: formData?.laundryNumber,
        photo: formData?.photo,
        description: formData?.description,
        priority: formData?.priority,
        tags: formData?.tags,
        notes: formData?.notes,
      });
      onSuccess?.(newItem);
      onClose?.();
    } catch (error) {
      console.error('Error creating laundry item:', error);
      showToast(error?.message === 'QUOTA_EXCEEDED'
        ? 'Storage limit reached. Remove old items or use smaller photos.'
        : 'Failed to add laundry item. Please try again.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const customTags = formData?.tags?.filter((t) => !availableTags?.includes(t)) || [];

  // A plain JSX-returning helper (NOT a component) so typing doesn't remount
  // the input and drop focus. Only one location field is shown at a time.
  const locationCombo = (label, required) => (
    <>
      <label className="alm-label">{label} {required ? <span className="alm-req">required</span> : <span className="alm-opt">optional</span>}</label>
      <div className="alm-combo">
        <input
          type="text"
          className={`alm-field${errors.area ? ' invalid' : ''}`}
          placeholder="Search deck, zone or cabin…"
          value={locationQuery}
          onChange={(e) => { setLocationQuery(e?.target?.value); setShowLocationDropdown(true); setField('area', e?.target?.value); clearError('area'); }}
          onFocus={() => setShowLocationDropdown(true)}
          onBlur={() => setTimeout(() => setShowLocationDropdown(false), 150)}
        />
        {showLocationDropdown && filteredLocations.length > 0 && (
          <div className="alm-combo-menu">
            {filteredLocations.map((loc) => (
              <button key={loc.id} type="button" className="alm-combo-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => handleLocationSelect(loc)}>
                <span className="alm-combo-name">{loc.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {errors.area && <div className="alm-err">{errors.area}</div>}
    </>
  );

  return (
    <ModalShell onClose={onClose} panelClassName="alm-panel">
      <div className="alm-head">
        <div>
          <div className="alm-eyebrow">Housekeeping</div>
          <h2 className="alm-title">Add laundry</h2>
        </div>
        <button className="alm-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
      </div>

      <div className="alm-body">
        {/* Owner + urgent */}
        <div className="alm-section">
          <div className="alm-ownerbar">
            <div className="alm-seg" role="tablist">
              <button type="button" role="tab" aria-selected={isGuest} className={`alm-seg-btn${isGuest ? ' on' : ''}`} onClick={() => chooseOwnerType(OwnerType?.GUEST)}>
                <Icon name="User" size={15} /> Guest
              </button>
              <button type="button" role="tab" aria-selected={!isGuest} className={`alm-seg-btn${!isGuest ? ' on' : ''}`} onClick={() => chooseOwnerType(OwnerType?.CREW)}>
                <Icon name="Users" size={15} /> Crew
              </button>
            </div>
            <button
              type="button"
              className={`alm-urgent-toggle${isUrgent ? ' on' : ''}`}
              aria-pressed={isUrgent}
              onClick={() => setField('priority', isUrgent ? LaundryPriority?.NORMAL : LaundryPriority?.URGENT)}
            >
              <Icon name="Zap" size={13} /> Urgent
              <span className={`alm-switch sm${isUrgent ? ' on' : ''}`} />
            </button>
          </div>
        </div>

        {/* Identity — guest */}
        {isGuest ? (
          <>
            <div className="alm-section">
              <label className="alm-label">Guest <span className="alm-req">required</span></label>
              <div className="alm-combo">
                <input
                  type="text"
                  className={`alm-field${errors.owner ? ' invalid' : ''}`}
                  placeholder="Search guest or select Unknown…"
                  value={guestSearchQuery}
                  onChange={(e) => { setGuestSearchQuery(e?.target?.value); setShowGuestDropdown(true); }}
                  onFocus={() => setShowGuestDropdown(true)}
                  onBlur={() => setTimeout(() => setShowGuestDropdown(false), 150)}
                />
                {showGuestDropdown && (
                  <div className="alm-combo-menu">
                    <button type="button" className="alm-combo-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => handleGuestSelect('unknown')}>
                      <span><span className="alm-combo-name">Unknown</span><span className="alm-combo-meta">Identify by colour + where it was found</span></span>
                    </button>
                    {getFilteredGuests()?.length > 0 ? getFilteredGuests()?.map((guest) => (
                      <button key={guest?.id} type="button" className="alm-combo-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => handleGuestSelect(guest)}>
                        <span style={{ minWidth: 0 }}>
                          <span className="alm-combo-name">{guest?.firstName} {guest?.lastName}</span>
                          {(guest?.cabinLocationLabel || guest?.cabinAllocated) && (
                            <span className="alm-combo-meta">{guest?.cabinLocationLabel || guest?.cabinAllocated}</span>
                          )}
                        </span>
                        <span className="alm-combo-active">Active</span>
                      </button>
                    )) : <div className="alm-combo-empty">No active guests found</div>}
                  </div>
                )}
              </div>
              {errors.owner && <div className="alm-err">{errors.owner}</div>}
            </div>

            {isUnknown ? (
              <div className="alm-grid2">
                <div>
                  <label className="alm-label">Colour / item <span className="alm-req">required</span></label>
                  <input className={`alm-field${errors.colour ? ' invalid' : ''}`} value={formData.colour}
                    onChange={(e) => { setField('colour', e?.target?.value); clearError('colour'); }} placeholder="e.g. White polo shirt" />
                  {errors.colour && <div className="alm-err">{errors.colour}</div>}
                </div>
                <div>{locationCombo('Area found', true)}</div>
              </div>
            ) : (
              <div className="alm-section">{locationCombo('Cabin', false)}</div>
            )}
          </>
        ) : (
          <>
            <div className="alm-section">
              <label className="alm-label">Crew member <span className="alm-req">required</span></label>
              <div className="alm-combo">
                <input
                  type="text"
                  className={`alm-field${errors.owner ? ' invalid' : ''}`}
                  placeholder="Search crew member…"
                  value={crewSearchQuery}
                  onChange={(e) => { setCrewSearchQuery(e?.target?.value); setShowCrewDropdown(true); }}
                  onFocus={() => setShowCrewDropdown(true)}
                  onBlur={() => setTimeout(() => setShowCrewDropdown(false), 150)}
                />
                {showCrewDropdown && (
                  <div className="alm-combo-menu">
                    {getFilteredCrew()?.length > 0 ? getFilteredCrew()?.map((crew) => (
                      <button key={crew?.id} type="button" className="alm-combo-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => handleCrewSelect(crew)}>
                        <span style={{ minWidth: 0 }}>
                          <span className="alm-combo-name">{crew?.fullName}</span>
                          {(crew?.roleTitle || crew?.cabin) && <span className="alm-combo-meta">{[crew?.roleTitle, crew?.cabin].filter(Boolean).join(' · ')}</span>}
                        </span>
                        <span className="alm-combo-active">Aboard</span>
                      </button>
                    )) : <div className="alm-combo-empty">No crew on board found</div>}
                  </div>
                )}
              </div>
              {errors.owner && <div className="alm-err">{errors.owner}</div>}
            </div>
            <div className="alm-section">
              <label className="alm-label">Cabin <span className="alm-opt">optional</span></label>
              <input className="alm-field" value={formData.area} onChange={(e) => setField('area', e?.target?.value)} placeholder="Where to deliver back to" />
            </div>
            <div className="alm-grid2">
              <div>
                <label className="alm-label">Laundry number <span className="alm-opt">optional</span></label>
                <input className="alm-field" value={formData.laundryNumber} onChange={(e) => setField('laundryNumber', e?.target?.value)} placeholder="e.g. 14" />
              </div>
              <div>
                <label className="alm-label">Colour <span className="alm-opt">optional</span></label>
                <input className="alm-field" value={formData.colour} onChange={(e) => setField('colour', e?.target?.value)} placeholder="e.g. Navy" />
              </div>
            </div>
          </>
        )}

        {/* Description with dictation */}
        <div className="alm-section">
          <label className="alm-label">Description <span className="alm-req">required</span></label>
          <div className="alm-desc">
            <textarea
              className={`alm-field${errors.description ? ' invalid' : ''}`}
              value={formData?.description}
              onChange={(e) => { setField('description', e?.target?.value); clearError('description'); }}
              placeholder="Item + colour + instructions — type or tap the mic to dictate…"
              rows={3}
            />
            {SpeechRec && (
              <button type="button" className={`alm-mic${listening ? ' on' : ''}`} onClick={toggleMic} aria-label={listening ? 'Stop dictation' : 'Dictate description'}>
                <Icon name={listening ? 'Square' : 'Mic'} size={16} />
              </button>
            )}
          </div>
          {listening && <div className="alm-mic-hint">Listening… speak now</div>}
          {errors.description && <div className="alm-err">{errors.description}</div>}
        </div>

        {/* Photo (optional) */}
        <div className="alm-section">
          <label className="alm-label">Photo <span className="alm-opt">optional</span></label>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
          {photoPreview ? (
            <div className="alm-preview">
              <img src={photoPreview} alt="Laundry item preview" />
              <button type="button" onClick={handleRemovePhoto} aria-label="Remove photo"><Icon name="Trash2" size={15} /></button>
            </div>
          ) : (
            <button type="button" className="alm-drop compact" onClick={() => fileInputRef?.current?.click()}>
              <Icon name="Camera" size={22} className="alm-drop-ic" />
              <span className="alm-drop-title">Take or upload photo</span>
              <span className="alm-drop-sub">Max 5MB</span>
            </button>
          )}
        </div>

        {/* Tags */}
        <div className="alm-section">
          <label className="alm-label">Tags <span className="alm-opt">optional</span></label>
          <div className="alm-tags">
            {availableTags?.map((tag) => (
              <button key={tag} type="button" className={`alm-tag${formData?.tags?.includes(tag) ? ' on' : ''}`} onClick={() => handleToggleTag(tag)}>{tag}</button>
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

        {/* Notes */}
        <div className="alm-section" style={{ marginBottom: 0 }}>
          <label className="alm-label">Notes <span className="alm-opt">optional</span></label>
          <textarea
            className="alm-field"
            value={formData.notes}
            onChange={(e) => setField('notes', e?.target?.value)}
            placeholder="Anything the laundry team should know…"
            rows={2}
          />
        </div>
      </div>

      <div className="alm-foot">
        <button type="button" className="alm-linkbtn" onClick={onClose}>Cancel</button>
        <button type="button" className="alm-btn primary" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save laundry item'}
        </button>
      </div>
    </ModalShell>
  );
};

export default AddLaundryModal;

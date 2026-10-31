import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Icon from '../../../components/AppIcon';
import '../guest-detail-panel.css';
import { showToast } from '../../../utils/toast';
import { MaritalStatus, getMaritalStatusDisplay, getAvailableSpouseOptions, updateGuest, deleteGuest, reinstateGuest, getAvailableKidsOptions, getLinkedKids, linkKid, unlinkKid, uploadPassportDocument, deletePassportDocument, getPassportDocumentSignedUrl } from '../utils/guestStorage';
import { getCurrentUser } from '../../../utils/authStorage';
import { loadTrips, toggleGuestActiveStatus } from '../../trips-management-dashboard/utils/tripStorage';

import { getAllDecks, getZonesByDeck, getSpacesByZone } from '../../locations-management-settings/utils/locationsHierarchyStorage';


import ModalShell from '../../../components/ui/ModalShell';
import {
  fullName as guestFullName, initialsOf, cabinOf, rolesOf,
} from '../../../services/guestRoster';
// Helper function to format cabin display to show only Level 3 (final segment)
const formatCabinLevel3 = (cabinValue) => {
  if (!cabinValue) return 'Not assigned';
  const raw = String(cabinValue)?.trim();
  if (!raw) return 'Not assigned';
  const parts = raw?.split('>')?.map(p => p?.trim())?.filter(Boolean);
  if (parts?.length === 0) return 'Not assigned';
  return parts?.[parts?.length - 1];
};

// The record split into tabs. Confidential holds travel documents, payment and
// NDA — the three the guest_confidential table gates to Command and Chief — so
// the tab is hidden outright from anyone who could not read it anyway, rather
// than offered and then found empty.
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'prefs', label: 'Preferences' },
  { id: 'confidential', label: 'Confidential', commandOnly: true },
  { id: 'history', label: 'History' },
];


// One rendered value. A record where most fields are blank is the normal case
// here, and thirty rows of "-" is what made the panel unreadable — so a value
// that is empty marks itself, and the CSS folds its whole field away until the
// reader asks to see them.
const EMPTY = new Set(['', '-', '—', 'Not assigned', 'Not specified', 'Unknown']);
const V = ({ children, pre }) => {
  const text = Array.isArray(children) ? children.join('') : children;
  const blank = EMPTY.has(String(text ?? '').trim());
  const cls = ['gdp-v', pre ? 'is-pre' : '', blank ? 'is-empty' : ''].filter(Boolean).join(' ');
  return <p className={cls}>{blank ? '—' : children}</p>;
};

const GuestDetailPanel = ({ guest, onEdit, onDelete, onReinstate, onClose, permissions }) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [showEmpty, setShowEmpty] = useState(false);
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

  // Identity and the three key facts, read through the same helpers the roster
  // uses so the panel and the list can never disagree about a guest's cabin or
  // role.
  const fullName = guestFullName(guest);
  const initials = initialsOf(fullName);
  const roleLabel = (rolesOf([guest])[0]) || '';
  const cabinText = cabinOf(guest);
  const dietaryText = String(formData?.allergies || '').trim();

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

  // Option A fix from the audit-doc addendum.
  //
  // Pre-PR3 this directly mutated cargo.trips.v1 in localStorage, which
  // bypassed activity logging, did no tenant scoping, and produced
  // field-name divergence with tripStorage's writer (this path wrote
  // `deactivatedAt` while toggleGuestActiveStatus writes
  // `activatedByUserId`). Routing through the canonical helper fixes
  // all three: activity-feed entries fire, RLS scopes per trip,
  // single field-name shape.
  //
  // toggleGuestActiveStatus is async post-A3.5 and writes to
  // trip_guests (Supabase) + trip.guests[] (localStorage) atomically.
  // Each trip-membership flip emits its own activity entry. Failures
  // on individual trips are logged but don't block the others —
  // partial success is preferred over all-or-nothing rollback.
  const handleActiveToggle = async () => {
    const newActiveState = !formData?.isActiveOnTrip;
    setFormData(prev => ({ ...prev, isActiveOnTrip: newActiveState }));

    const updated = await updateGuest(guest?.id, { isActiveOnTrip: newActiveState });
    if (!updated) {
      showToast('Failed to update guest status', 'error');
      setFormData(prev => ({ ...prev, isActiveOnTrip: !newActiveState }));
      return;
    }

    // Sync per-trip membership for every trip the guest is on. If the
    // guest's per-trip flag already matches the new global state we
    // skip the toggle (no-op writes waste an RPC and an activity entry).
    try {
      const allTrips = await loadTrips();
      const tripsWithGuest = (allTrips || []).filter(t =>
        Array.isArray(t?.guests) && t.guests.some(g => g?.guestId === guest?.id)
      );
      await Promise.all(tripsWithGuest.map(async (t) => {
        const tg = t.guests.find(g => g?.guestId === guest?.id);
        if ((tg?.isActive ?? false) === newActiveState) return; // already aligned
        try {
          // toggleGuestActiveStatus flips, so we only call when state differs.
          await toggleGuestActiveStatus(t?.id, guest?.id);
        } catch (err) {
          console.warn('[GuestDetailPanel] toggleGuestActiveStatus failed for', t?.id, err);
        }
      }));
    } catch (err) {
      console.warn('[GuestDetailPanel] loadTrips failed during active-toggle sync:', err);
    }

    showToast(`Guest ${newActiveState ? 'activated on' : 'removed from'} current trip`, 'success');
    if (onEdit) onEdit(guest?.id, { isActiveOnTrip: newActiveState });
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

  const handleDelete = async () => {
    if (!deleteConfirmChecked) {
      showToast('Please confirm deletion by checking the box', 'error');
      return;
    }

    // deleteGuest is async. Without the await this tested the PROMISE for
    // truthiness, which it always is, so a delete that failed still reported
    // "Guest deleted successfully" and closed the panel.
    const success = await deleteGuest(guest?.id);
    if (success) {
      showToast('Guest deleted successfully', 'success');
      onDelete();
      setShowDeleteConfirm(false);
      setDeleteConfirmChecked(false);
    } else {
      showToast('Failed to delete guest', 'error');
    }
  };
  
  const handleReinstate = async () => {
    // Same bug as handleDelete: the promise was always truthy.
    const success = await reinstateGuest(guest?.id);
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
    <div className={isEditing ? 'gdp is-editing' : 'gdp'}>
      {/* Header. One avatar — the body's photo block is for EDITING a photo and
          is hidden while reading, which is why the same face was appearing
          twice. Cabin, dietary and aboard read as a meta line here rather than
          a boxed three-up band: it is the house pattern, and it stops a strip
          of mostly-empty values dominating the top of the record. */}
      <div className="gdp-head">
        <div className="gdp-head-l">
          {guest?.photo?.dataUrl
            ? <img className="gdp-head-avatar" src={guest.photo.dataUrl} alt="" />
            : <span className="gdp-head-avatar">{initials}</span>}
          <span className="gdp-head-ident">
            <h2 className="gdp-title">
              {fullName || 'Guest'}
              {roleLabel && <span className="gdp-role">{roleLabel}</span>}
              {isDeleted && <span className="gdp-chip warn">Deleted</span>}
            </h2>
            <p className="gdp-meta">
              <span className={cabinText ? '' : 'muted'}>{cabinText || 'No cabin'}</span>
              <span className="bar" />
              {dietaryText
                ? <span className="alert">{dietaryText}</span>
                : <span className="muted">No dietary needs</span>}
              <span className="bar" />
              <span className={formData?.isActiveOnTrip ? '' : 'muted'}>
                {formData?.isActiveOnTrip ? 'Aboard' : 'Ashore'}
              </span>
            </p>
          </span>
        </div>
        <div className="gdp-head-r">
          {/* Was a full-width tile with a switch in it. It says the same thing
              in a tenth of the space, next to the state it changes. */}
          {canEdit && !isDeleted && (
            <button
              type="button"
              className={formData?.isActiveOnTrip ? 'gdp-aboard is-on' : 'gdp-aboard'}
              aria-pressed={!!formData?.isActiveOnTrip}
              onClick={handleActiveToggle}
            >
              <span className="gdp-aboard-dot" />
              {formData?.isActiveOnTrip ? 'On this trip' : 'Not on a trip'}
            </button>
          )}
          {!isEditing && canEdit && !isDeleted && (
            <button type="button" className="gdp-btn ghost" onClick={() => setIsEditing(true)}>
              <Icon name="Edit2" size={14} /> Edit
            </button>
          )}
          {isEditing && (
            <>
              <button type="button" className="gdp-btn ghost" onClick={handleCancel}>
                Cancel
              </button>
              <button type="button" className="gdp-btn primary" onClick={handleSave}>
                <Icon name="Check" size={14} /> Save
              </button>
            </>
          )}
          {isDeleted && canDelete && (
            <button type="button" className="gdp-btn ghost gdp-reinstate" onClick={handleReinstate}>
              <Icon name="RotateCcw" size={14} /> Reinstate
            </button>
          )}
        </div>
      </div>
      {/* Tabs rather than one long scroll: adding passport or APA fields later
          widens a tab instead of lengthening the page. */}
      <div className="gdp-tabs" role="tablist">
        {TABS.filter((t) => !t.commandOnly || canEdit).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'gdp-tab is-on' : 'gdp-tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {/* Blank fields are folded away by default. Most of a guest record is
            usually empty, and thirty rows of "—" is what buried the handful of
            values that matter. */}
        <button
          type="button"
          className="gdp-emptytoggle"
          aria-pressed={showEmpty}
          onClick={() => setShowEmpty((v) => !v)}
        >
          {showEmpty ? 'Hide empty fields' : 'Show empty fields'}
        </button>
      </div>

      {/* Content */}
      <div className="gdp-body" data-tab={tab} data-empty={showEmpty ? 'show' : 'fold'}>
        {/* Photo and Basic Info */}
        <div className="gdp-identity" data-tab="overview">
          {/* Photo */}
          <div className="flex-shrink-0">
            {isEditing ? (
              <div className="relative">
                {formData?.photo ? (
                  <div className="gdp-photo">
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
                      className="gdp-photo-empty"
                    >
                      <Icon name="Camera" size={24} className="text-muted-foreground" />
                      <span className="gdp-note">Add Photo</span>
                    </button>

                    {showPhotoPicker && (
                      <div className="gdp-menu">
                        <button
                          type="button"
                          onClick={() => {
                            fileInputRef?.current?.click();
                            setShowPhotoPicker(false);
                          }}
                          className="gdp-opt"
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
                          className="gdp-opt"
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
                          className="gdp-opt"
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
              <div className="gdp-photo">
                {formData?.photo?.dataUrl ? (
                  <img
                    src={formData?.photo?.dataUrl}
                    alt={`${formData?.firstName} ${formData?.lastName}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="gdp-mini-avatar full">
                    <Icon name="User" size={48} className="gdp-accent" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Basic Info */}
          <div className="flex-1 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="gdp-l">First Name *</label>
                {isEditing && !isDeleted ? (
                  <Input
                    value={formData?.firstName || ''}
                    onChange={(e) => handleChange('firstName', e?.target?.value)}
                    placeholder="First name"
                  />
                ) : (
                  <V>{formData?.firstName || '-'}</V>
                )}
              </div>
              <div>
                <label className="gdp-l">Last Name *</label>
                {isEditing && !isDeleted ? (
                  <Input
                    value={formData?.lastName || ''}
                    onChange={(e) => handleChange('lastName', e?.target?.value)}
                    placeholder="Last name"
                  />
                ) : (
                  <V>{formData?.lastName || '-'}</V>
                )}
              </div>
            </div>

            {/* Active on Trip Toggle */}
            {canEdit && !isDeleted && (
              <div className="gdp-tile">
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
                  <V>Active on current trip</V>
                  <p className="gdp-note">Enable to include in active guest lists</p>
                </div>
              </div>
            )}
            {(!canEdit || isDeleted) && (
              <div className="gdp-tile">
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
                  <V>Active on current trip</V>
                  <p className="gdp-note">{isDeleted ? 'Read-only (deleted)' : 'View only'}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section: Personal */}
        <div className="gdp-sec" data-tab="overview">
          <h3 className="gdp-h">
            <Icon name="User" size={18} />
            Personal
          </h3>
          <div className="gdp-grid">
            <div>
              <label className="gdp-l">Date of Birth</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="date"
                  value={formData?.dateOfBirth || ''}
                  onChange={(e) => handleChange('dateOfBirth', e?.target?.value)}
                />
              ) : (
                <V>{formData?.dateOfBirth || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Cake Preference</label>
              {isEditing && !isDeleted ? (
                <Input
                  value={formData?.cakePreference || ''}
                  onChange={(e) => handleChange('cakePreference', e?.target?.value)}
                  placeholder="e.g., Chocolate, Vanilla"
                />
              ) : (
                <V>{formData?.cakePreference || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Marital Status</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.maritalStatus || ''}
                  onChange={(value) => handleChange('maritalStatus', value)}
                  options={maritalStatusOptions}
                />
              ) : (
                <V>{getMaritalStatusDisplay(formData?.maritalStatus)}</V>
              )}
            </div>
            {formData?.maritalStatus === MaritalStatus?.MARRIED && (
              <div>
                <label className="gdp-l">Connect Spouse (optional)</label>
                {isEditing && !isDeleted ? (
                  <Select
                    value={formData?.spouseGuestId || ''}
                    onChange={(value) => handleChange('spouseGuestId', value)}
                    options={spouseSelectOptions}
                    searchable
                  />
                ) : (
                  <V>{getSpouseName(formData?.spouseGuestId)}</V>
                )}
              </div>
            )}
            {/* Connect Kids */}
            <div>
              <label className="gdp-l">Connect Kids (optional)</label>
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
        <div className="gdp-sec" data-tab="overview">
          <h3 className="gdp-h">
            <Icon name="Mail" size={18} />
            Contact
          </h3>
          <div className="gdp-grid">
            <div>
              <label className="gdp-l">Email</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="email"
                  value={formData?.contactEmail || ''}
                  onChange={(e) => handleChange('contactEmail', e?.target?.value)}
                  placeholder="guest@example.com"
                />
              ) : (
                <V>{formData?.contactEmail || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Phone</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="tel"
                  value={formData?.contactPhone || ''}
                  onChange={(e) => handleChange('contactPhone', e?.target?.value)}
                  placeholder="+1 234 567 8900"
                />
              ) : (
                <V>{formData?.contactPhone || '-'}</V>
              )}
            </div>
          </div>
        </div>

        {/* Section: Travel & Documents (NEW - after Contact, before Health) */}
        <div className="gdp-sec" data-tab="confidential">
          <h3 className="gdp-h">
            <Icon name="FileText" size={18} />
            Travel &amp; Documents
          </h3>
          <div className="gdp-grid">
            <div>
              <label className="gdp-l">Passport Number</label>
              {isEditing && !isDeleted ? (
                <Input
                  value={formData?.passportNumber || ''}
                  onChange={(e) => handleChange('passportNumber', e?.target?.value)}
                  placeholder="e.g., AB1234567"
                />
              ) : (
                <V>{formData?.passportNumber || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Passport Nationality</label>
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
                <p className="gdp-v">
                  {formData?.passportNationality === 'Other'
                    ? formData?.passportNationalityOther || 'Other'
                    : formData?.passportNationality || '-'}
                </p>
              )}
            </div>
            <div>
              <label className="gdp-l">Passport Expiry Date</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="date"
                  value={formData?.passportExpiryDate || ''}
                  onChange={(e) => handleChange('passportExpiryDate', e?.target?.value)}
                />
              ) : (
                <V>{formData?.passportExpiryDate || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Emergency Contact Name</label>
              {isEditing && !isDeleted ? (
                <Input
                  value={formData?.emergencyContactName || ''}
                  onChange={(e) => handleChange('emergencyContactName', e?.target?.value)}
                  placeholder="Full name"
                />
              ) : (
                <V>{formData?.emergencyContactName || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Emergency Contact Phone</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="tel"
                  value={formData?.emergencyContactPhone || ''}
                  onChange={(e) => handleChange('emergencyContactPhone', e?.target?.value)}
                  placeholder="+1 234 567 8900"
                />
              ) : (
                <V>{formData?.emergencyContactPhone || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Emergency Contact Relationship</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.emergencyContactRelationship || ''}
                  onChange={(value) => handleChange('emergencyContactRelationship', value)}
                  options={relationshipOptions}
                />
              ) : (
                <V>{formData?.emergencyContactRelationship || '-'}</V>
              )}
            </div>
          </div>
          <div>
            <label className="gdp-l">Visa Notes</label>
            {isEditing && !isDeleted ? (
              <textarea
                value={formData?.visaNotes || ''}
                onChange={(e) => handleChange('visaNotes', e?.target?.value)}
                placeholder="Any visa requirements or notes..."
                rows={3}
                className="gdp-ta"
              />
            ) : (
              <V pre>{formData?.visaNotes || '-'}</V>
            )}
          </div>

          {/* Passport Document Upload */}
          <div>
            <label className="gdp-l">Passport Document</label>
            {(formData?.passportDocumentUrl || guest?.passportDocumentUrl) ? (
              <div className="gdp-tile">
                <Icon name="FileText" size={18} className="gdp-accent" />
                <div className="flex-1 min-w-0">
                  {passportSignedUrl ? (
                    <a
                      href={passportSignedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gdp-link"
                    >
                      View Passport Document
                    </a>
                  ) : (
                    <span className="gdp-v">Passport document uploaded</span>
                  )}
                </div>
                {canEdit && !isDeleted && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => passportFileInputRef?.current?.click()}
                      disabled={passportUploading}
                      className="gdp-btn ghost sm"
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
                  className="gdp-dashed"
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
        <div className="gdp-sec" data-tab="overview">
          <h3 className="gdp-h">
            <Icon name="Heart" size={18} />
            Health
          </h3>
          <div className="gdp-grid">
            <div>
              <label className="gdp-l">Health Conditions</label>
              {isEditing && !isDeleted ? (
                <textarea
                  value={formData?.healthConditions || ''}
                  onChange={(e) => handleChange('healthConditions', e?.target?.value)}
                  placeholder="Any health conditions to be aware of..."
                  rows={3}
                  className="gdp-ta"
                />
              ) : (
                <V pre>{formData?.healthConditions || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Allergies</label>
              {isEditing && !isDeleted ? (
                <textarea
                  value={formData?.allergies || ''}
                  onChange={(e) => handleChange('allergies', e?.target?.value)}
                  placeholder="Any allergies to be aware of..."
                  rows={3}
                  className="gdp-ta"
                />
              ) : (
                <V pre>{formData?.allergies || '-'}</V>
              )}
            </div>
          </div>
        </div>

        {/* Section: Accommodation */}
        <div className="gdp-sec" data-tab="overview">
          <h3 className="gdp-h">
            <Icon name="Home" size={18} />
            Accommodation
          </h3>
          <div className="space-y-1">
            <div className="gdp-note">Cabin</div>
            <div className="gdp-v">{getCabinDisplay()}</div>
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
                    className="gdp-in"
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
                  <div className="gdp-menu wide">
                    {filteredCabinOptions?.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground text-center">
                        No matching cabins found
                      </div>
                    ) : (
                      Object.keys(groupedOptions)?.map(deckName => (
                        <div key={deckName}>
                          <div className="gdp-opt-group">
                            {deckName}
                          </div>
                          {groupedOptions?.[deckName]?.map(option => (
                            <button
                              key={option?.path}
                              type="button"
                              onClick={() => handleCabinSelect(option)}
                              className="gdp-opt"
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
                <div className="gdp-note">
                  Note: Dropdown selection takes priority for automation
                </div>
              )}
            </div>
          )}
        </div>

        {/* Section: Payment & APA (NEW - after Accommodation, before History) */}
        <div className="gdp-sec" data-tab="confidential">
          <h3 className="gdp-h">
            <Icon name="CreditCard" size={18} />
            Payment &amp; APA
          </h3>
          <div className="gdp-grid">
            <div>
              <label className="gdp-l">Client Type</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.clientType || ''}
                  onChange={(value) => handleChange('clientType', value)}
                  options={clientTypeOptions}
                />
              ) : (
                <V>{formData?.clientType || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Preferred Currency</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.preferredCurrency || ''}
                  onChange={(value) => handleChange('preferredCurrency', value)}
                  options={currencyOptions}
                />
              ) : (
                <V>{formData?.preferredCurrency || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Billing Contact Name</label>
              {isEditing && !isDeleted ? (
                <Input
                  value={formData?.billingContactName || ''}
                  onChange={(e) => handleChange('billingContactName', e?.target?.value)}
                  placeholder="Full name"
                />
              ) : (
                <V>{formData?.billingContactName || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Billing Contact Email</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="email"
                  value={formData?.billingContactEmail || ''}
                  onChange={(e) => handleChange('billingContactEmail', e?.target?.value)}
                  placeholder="billing@example.com"
                />
              ) : (
                <V>{formData?.billingContactEmail || '-'}</V>
              )}
            </div>
          </div>
          {/* APA Required Toggle */}
          <div className="gdp-tile">
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
            <V>APA Required?</V>
          </div>
          {/* APA Amount - only visible when APA Required = true */}
          {formData?.apaRequired && (
            <div>
              <label className="gdp-l">APA Amount</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="number"
                  value={formData?.apaAmount || ''}
                  onChange={(e) => handleChange('apaAmount', e?.target?.value ? parseFloat(e?.target?.value) : null)}
                  placeholder="0.00"
                />
              ) : (
                <V>{formData?.apaAmount != null ? formData?.apaAmount : '-'}</V>
              )}
            </div>
          )}
          <div>
            <label className="gdp-l">APA Notes</label>
            {isEditing && !isDeleted ? (
              <textarea
                value={formData?.apaNotes || ''}
                onChange={(e) => handleChange('apaNotes', e?.target?.value)}
                placeholder="APA notes..."
                rows={3}
                className="gdp-ta"
              />
            ) : (
              <V pre>{formData?.apaNotes || '-'}</V>
            )}
          </div>
          <div>
            <label className="gdp-l">Payment Notes</label>
            {isEditing && !isDeleted ? (
              <textarea
                value={formData?.paymentNotes || ''}
                onChange={(e) => handleChange('paymentNotes', e?.target?.value)}
                placeholder="Payment notes..."
                rows={3}
                className="gdp-ta"
              />
            ) : (
              <V pre>{formData?.paymentNotes || '-'}</V>
            )}
          </div>
        </div>

        {/* Section: NDA & Privacy (NEW - after Payment & APA, before History) */}
        <div className="gdp-sec" data-tab="confidential">
          <h3 className="gdp-h">
            <Icon name="Shield" size={18} />
            NDA &amp; Privacy
          </h3>
          {/* NDA Signed Toggle */}
          <div className="gdp-tile">
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
            <V>NDA Signed?</V>
          </div>
          {/* NDA Expiry Date - only visible when NDA Signed = true */}
          {formData?.ndaSigned && (
            <div>
              <label className="gdp-l">NDA Expiry Date</label>
              {isEditing && !isDeleted ? (
                <Input
                  type="date"
                  value={formData?.ndaExpiryDate || ''}
                  onChange={(e) => handleChange('ndaExpiryDate', e?.target?.value)}
                />
              ) : (
                <V>{formData?.ndaExpiryDate || '-'}</V>
              )}
            </div>
          )}
          <div className="gdp-grid">
            <div>
              <label className="gdp-l">Privacy Level</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.privacyLevel || 'Standard'}
                  onChange={(value) => handleChange('privacyLevel', value)}
                  options={privacyLevelOptions}
                />
              ) : (
                <V>{formData?.privacyLevel || 'Standard'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Photo Permission</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.photoPermission || 'Ask Each Time'}
                  onChange={(value) => handleChange('photoPermission', value)}
                  options={photoPermissionOptions}
                />
              ) : (
                <V>{formData?.photoPermission || 'Ask Each Time'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Share Guest Info With Crew</label>
              {isEditing && !isDeleted ? (
                <Select
                  value={formData?.shareGuestInfoWithCrew || 'Limited'}
                  onChange={(value) => handleChange('shareGuestInfoWithCrew', value)}
                  options={shareInfoOptions}
                />
              ) : (
                <V>{formData?.shareGuestInfoWithCrew || 'Limited'}</V>
              )}
            </div>
          </div>
          <div>
            <label className="gdp-l">Privacy Notes</label>
            {isEditing && !isDeleted ? (
              <textarea
                value={formData?.privacyNotes || ''}
                onChange={(e) => handleChange('privacyNotes', e?.target?.value)}
                placeholder="Privacy notes..."
                rows={3}
                className="gdp-ta"
              />
            ) : (
              <V pre>{formData?.privacyNotes || '-'}</V>
            )}
          </div>
        </div>

        {/* Section: Preferences */}
        <div className="gdp-sec" data-tab="prefs">
          <h3 className="gdp-h">
            <Icon name="Star" size={18} />
            Preferences
          </h3>
          {/* Open Preferences navigation button */}
          <button
            onClick={handleOpenPreferences}
            className="gdp-cta"
          >
            <div className="flex items-center gap-2">
              <Icon name="ExternalLink" size={16} className="gdp-accent" />
              <span className="gdp-accent">Open Preferences</span>
            </div>
            <Icon name="ChevronRight" size={16} className="gdp-accent" />
          </button>
          {/* Preferences page link */}
        </div>

        {/* Section: History */}
        {guest?.historyLog && guest?.historyLog?.length > 0 && (
          <div className="gdp-sec" data-tab="history">
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
                  <div key={entry?.id} className="gdp-tile">
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
                          <span className="gdp-v">{entry?.actorName}</span>
                          <span className="gdp-note">({entry?.actorTier})</span>
                        </div>
                        <p className="gdp-note">{entry?.message}</p>
                        {entry?.changes && Object.keys(entry?.changes)?.length > 0 && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            <span className="font-medium">Changes: </span>
                            {Object.keys(entry?.changes)?.slice(0, 3)?.join(', ')}
                            {Object.keys(entry?.changes)?.length > 3 && ` +${Object.keys(entry?.changes)?.length - 3} more`}
                          </div>
                        )}
                      </div>
                      <span className="gdp-note">
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
          <div className="gdp-sec" data-tab="history">
            <button type="button" className="gdp-btn danger" onClick={() => setShowDeleteConfirm(true)}>
              <Icon name="Trash2" size={14} /> Delete guest
            </button>
          </div>
        )}
      </div>
      {/* Delete Confirmation Modal - COMMAND ONLY */}
      {showDeleteConfirm && canDelete && (
        <ModalShell onClose={() => setShowDeleteConfirm(false)} panelClassName="gdp-modal">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-error/20 flex items-center justify-center">
              <Icon name="AlertTriangle" size={24} className="text-error" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Delete guest?</h3>
            </div>
          </div>
          <div className="space-y-3 mb-6">
            <p className="gdp-v">
              This will remove the guest profile from Guest Management.
            </p>
            <p className="gdp-note">
              This cannot be undone unless restored from audit history.
            </p>
            <label className="gdp-tile pick">
              <input
                type="checkbox"
                checked={deleteConfirmChecked}
                onChange={(e) => setDeleteConfirmChecked(e?.target?.checked)}
                className="gdp-check"
              />
              <span className="gdp-v">
                I understand this will delete the guest profile.
              </span>
            </label>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              className="gdp-btn ghost"
              onClick={() => {
                setShowDeleteConfirm(false);
                setDeleteConfirmChecked(false);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="gdp-btn danger solid"
              onClick={handleDelete}
              disabled={!deleteConfirmChecked}
            >
              Delete guest
            </button>
          </div>
        </ModalShell>
      )}

      {/* Kids Linking Modal */}
      {showKidsModal && (
        <ModalShell onClose={() => setShowKidsModal(false)} panelClassName="gdp-modal">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Link Children</h3>
            <button
              type="button"
              onClick={() => setShowKidsModal(false)}
              className="gdp-iconbtn"
            >
              <Icon name="X" size={18} className="text-muted-foreground" />
            </button>
          </div>
          <p className="gdp-note">
            Select existing guest profiles to link as children of {formData?.firstName} {formData?.lastName}.
          </p>
          {kidsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : kidsOptions?.length === 0 ? (
            <p className="gdp-empty">No other guests available to link.</p>
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
                      <div className="gdp-mini-avatar">
                        <Icon name="User" size={14} className="gdp-accent" />
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
            <button type="button" className="gdp-btn primary" onClick={() => setShowKidsModal(false)}>Done</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
};

export default GuestDetailPanel;
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import EditorialSelect from '../../../components/editorial/EditorialSelect';
import EditorialDatePicker from '../../../components/editorial/EditorialDatePicker';
import Icon from '../../../components/AppIcon';
import '../guest-detail-panel.css';
import { showToast } from '../../../utils/toast';
import { MaritalStatus, getMaritalStatusDisplay, getAvailableSpouseOptions, updateGuest, deleteGuest, reinstateGuest, getAvailableKidsOptions, getLinkedKids, linkKid, unlinkKid, uploadPassportDocument, deletePassportDocument, getPassportDocumentSignedUrl } from '../utils/guestStorage';
import { getCurrentUser } from '../../../utils/authStorage';
import { loadTrips, toggleGuestActiveStatus } from '../../trips-management-dashboard/utils/tripStorage';

import { getAllDecks, getZonesByDeck, getSpacesByZone } from '../../locations-management-settings/utils/locationsHierarchyStorage';
import { getPreferencesByGuest } from '../../../utils/preferencesStorage';


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
// Audit actions carry a tone, not a colour — the chip classes decide the hue.
const ACTION_TONE = {
  created: 'accent',
  updated: 'ok',
  reinstated: 'ok',
  deleted: 'warn',
};

// dd/mm/yyyy hh:mm — the house date format, zero-padded.
const formatStamp = (value) => {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

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

  // Preferences read in place. They used to be a button that navigated to
  // another page, which lost the guest you were reading — so they load on
  // first visit to the tab and render here.
  const [prefs, setPrefs] = useState(null);
  const [prefsLoading, setPrefsLoading] = useState(false);

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

  // Fetched once per guest, the first time the tab is opened — a guest with
  // dozens of preferences should not cost a query for every row of the list.
  useEffect(() => { setPrefs(null); }, [guest?.id]);
  useEffect(() => {
    if (tab !== 'prefs' || prefs !== null || prefsLoading || !guest?.id) return;
    let live = true;
    setPrefsLoading(true);
    getPreferencesByGuest(guest.id)
      .then((rows) => { if (live) setPrefs(rows || []); })
      .catch(() => { if (live) setPrefs([]); })
      .finally(() => { if (live) setPrefsLoading(false); });
    return () => { live = false; };
  }, [tab, prefs, prefsLoading, guest?.id]);

  // Newest first, without mutating the guest's array.
  const historyEntries = useMemo(
    () => [...(guest?.historyLog || [])].reverse(),
    [guest?.historyLog],
  );

  // Grouped by category, in the order the categories first appear.
  const prefGroups = useMemo(() => {
    const groups = [];
    const byName = new Map();
    for (const p of prefs || []) {
      const name = String(p?.category || '').trim() || 'Other';
      let group = byName.get(name);
      if (!group) { group = { name, items: [] }; byName.set(name, group); groups.push(group); }
      group.items.push(p);
    }
    return groups;
  }, [prefs]);

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

  // The avatar IS the photo control — there is no separate "Add Photo" tile.
  // A photo change only lives in formData until Save, so clicking the avatar
  // while reading drops into edit mode first rather than appearing to save on
  // its own.
  const handlePhotoAvatarClick = () => {
    if (!isEditing) setIsEditing(true);
    setShowPhotoPicker(open => !open);
  };

  const pickPhoto = (ref) => {
    ref?.current?.click();
    setShowPhotoPicker(false);
  };

  const handleSave = async () => {
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

    // updateGuest is async. Without the await this tested the PROMISE for
    // truthiness — always true — so a save that failed still said it worked,
    // and onEdit() refetched BEFORE the write landed, so the panel reloaded the
    // old row and the edit appeared to vanish. The spouse link runs late in
    // that same chain, which is why it never reached the other guest either.
    const updated = await updateGuest(guest?.id, updateData);
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
          {canEdit && !isDeleted ? (
            <span className="gdp-photo-wrap">
              <button
                type="button"
                className="gdp-head-avatar is-editable"
                onClick={handlePhotoAvatarClick}
                aria-label={formData?.photo?.dataUrl ? 'Change photo' : 'Add photo'}
                title={formData?.photo?.dataUrl ? 'Change photo' : 'Add photo'}
              >
                {formData?.photo?.dataUrl
                  ? <img src={formData.photo.dataUrl} alt="" />
                  : <span className="gdp-head-initials">{initials}</span>}
                <span className="gdp-photo-hover">
                  <Icon name="Camera" size={16} />
                </span>
              </button>

              {showPhotoPicker && (
                <div className="gdp-menu">
                  <button type="button" className="gdp-opt" onClick={() => pickPhoto(fileInputRef)}>
                    <span className="gdp-opt-main"><Icon name="Image" size={15} /> Photo library</span>
                  </button>
                  <button type="button" className="gdp-opt" onClick={() => pickPhoto(cameraInputRef)}>
                    <span className="gdp-opt-main"><Icon name="Camera" size={15} /> Take photo</span>
                  </button>
                  {formData?.photo?.dataUrl && (
                    <button
                      type="button"
                      className="gdp-opt is-danger"
                      onClick={() => { handleRemovePhoto(); setShowPhotoPicker(false); }}
                    >
                      <span className="gdp-opt-main"><Icon name="Trash2" size={15} /> Remove photo</span>
                    </button>
                  )}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="gdp-hidden-input"
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoUpload}
                className="gdp-hidden-input"
              />
            </span>
          ) : formData?.photo?.dataUrl ? (
            <img className="gdp-head-avatar" src={formData.photo.dataUrl} alt="" />
          ) : (
            <span className="gdp-head-avatar">{initials}</span>
          )}
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
        {/* Names. The photo lives on the header avatar — one control, where the
            face already is, rather than a second tile repeating it. */}
        <div className="gdp-identity" data-tab="overview">
          <div className="gdp-grid gdp-names">
            <div>
              <label className="gdp-l">First name <em>required</em></label>
              <input
                type="text"
                className="gdp-in"
                value={formData?.firstName || ''}
                onChange={(e) => handleChange('firstName', e?.target?.value)}
                placeholder="First name"
                disabled={isDeleted}
              />
            </div>
            <div>
              <label className="gdp-l">Last name <em>required</em></label>
              <input
                type="text"
                className="gdp-in"
                value={formData?.lastName || ''}
                onChange={(e) => handleChange('lastName', e?.target?.value)}
                placeholder="Last name"
                disabled={isDeleted}
              />
            </div>
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
                <EditorialDatePicker
                  cool
                  value={formData?.dateOfBirth || ''}
                  onChange={(iso) => handleChange('dateOfBirth', iso)}
                  placeholder="dd/mm/yyyy"
                />
              ) : (
                <V>{formData?.dateOfBirth || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Cake Preference</label>
              {isEditing && !isDeleted ? (
                <input className="gdp-in"
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
                <EditorialSelect
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
                  <EditorialSelect
                    value={formData?.spouseGuestId || ''}
                    onChange={(value) => handleChange('spouseGuestId', value)}
                    options={spouseSelectOptions}
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
                className="gdp-link"
              >
                <Icon name="Users" size={14} />
                <span>{getLinkedKidsDisplay()}</span>
                <Icon name="ChevronRight" size={14} />
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
                <input className="gdp-in"
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
                <input className="gdp-in"
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
                <input className="gdp-in"
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
                <div className="gdp-field">
                  <EditorialSelect
                    value={formData?.passportNationality || ''}
                    onChange={(value) => handleChange('passportNationality', value)}
                    options={nationalityOptions}
                  />
                  {formData?.passportNationality === 'Other' && (
                    <input className="gdp-in"
                      value={formData?.passportNationalityOther || ''}
                      onChange={(e) => handleChange('passportNationalityOther', e?.target?.value)}
                      placeholder="Specify nationality"
                    />
                  )}
                </div>
              ) : (
                <V>
                  {formData?.passportNationality === 'Other'
                    ? formData?.passportNationalityOther || 'Other'
                    : formData?.passportNationality || '-'}
                </V>
              )}
            </div>
            <div>
              <label className="gdp-l">Passport Expiry Date</label>
              {isEditing && !isDeleted ? (
                <EditorialDatePicker
                  cool
                  value={formData?.passportExpiryDate || ''}
                  onChange={(iso) => handleChange('passportExpiryDate', iso)}
                  placeholder="dd/mm/yyyy"
                />
              ) : (
                <V>{formData?.passportExpiryDate || '-'}</V>
              )}
            </div>
            <div>
              <label className="gdp-l">Emergency Contact Name</label>
              {isEditing && !isDeleted ? (
                <input className="gdp-in"
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
                <input className="gdp-in"
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
                <EditorialSelect
                  value={formData?.emergencyContactRelationship || ''}
                  onChange={(value) => handleChange('emergencyContactRelationship', value)}
                  options={relationshipOptions}
                />
              ) : (
                <V>{formData?.emergencyContactRelationship || '-'}</V>
              )}
            </div>
          </div>
          <div className="gdp-field">
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
          <div className="gdp-field">
            <label className="gdp-l">Passport Document</label>
            {(formData?.passportDocumentUrl || guest?.passportDocumentUrl) ? (
              <div className="gdp-tile">
                <Icon name="FileText" size={18} className="gdp-accent" />
                <div className="gdp-grow">
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
                  <div className="gdp-inline">
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
                      className="gdp-iconbtn is-danger"
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
                    <div className="gdp-spin" />
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
              className="gdp-hidden-input"
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
          {/* Reading: one line. Editing: the two ways to set it, and NOT a
              third read-only copy of the answer above them — three stacked
              "Cabin" rows was the thing that made this section unreadable. */}
          {!(isEditing && !isDeleted) && (
            <div className="gdp-field">
              <label className="gdp-l">Cabin</label>
              <V>{getCabinDisplay()}</V>
            </div>
          )}

          {/* Cabin Allocation - Searchable Dropdown */}
          {isEditing && !isDeleted && (
            <div className="gdp-field">
              <label className="gdp-l">
                Cabin <em>from the deck plan</em>
              </label>
              <div className="gdp-anchor" ref={cabinDropdownRef}>
                <div className="gdp-anchor">
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
                    className="gdp-caret"
                  />
                </div>
                
                {locationNotFound && (
                  <p className="gdp-warn">
                    <Icon name="AlertTriangle" size={12} />
                    Previously selected location not found
                  </p>
                )}
                
                {showCabinDropdown && cabinOptions?.length > 0 && (
                  <div className="gdp-menu wide">
                    {filteredCabinOptions?.length === 0 ? (
                      <div className="gdp-empty">
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
                              {/* The cabin, then the route to it in smaller
                                  type — a raw "Bridge Deck > Interior - Crew >
                                  Captain Cabin" is a path, not a choice. */}
                              <span className="gdp-opt-main">
                                {String(option?.path || '').split('>').pop().trim()}
                              </span>
                              <span className="gdp-opt-path">
                                {String(option?.path || '').split('>').slice(0, -1).map((p) => p.trim()).join(' › ')}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                )}
                
              </div>
              <p className="gdp-note">
                {cabinOptions?.length === 0
                  ? 'No locations configured. Add cabins in Location Management.'
                  : `Currently ${getCabinDisplay()}.`}
              </p>
            </div>
          )}

          {/* Free Text Cabin Fallback */}
          {isEditing && !isDeleted && (
            <div className="gdp-field">
              <label className="gdp-l">
                Or type a cabin <em className="faint">optional</em>
              </label>
              <input className="gdp-in"
                value={cabinFreeText}
                onChange={(e) => handleCabinFreeTextChange(e?.target?.value)}
                placeholder="For a cabin that isn't on the deck plan"
              />
              <p className="gdp-note">
                {cabinFreeText && selectedCabinPath
                  ? 'A deck-plan cabin is set as well, and that one wins — automation follows the deck plan.'
                  : 'Only used when the deck plan has no matching cabin.'}
              </p>
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
                <EditorialSelect
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
                <EditorialSelect
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
                <input className="gdp-in"
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
                <input className="gdp-in"
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
            <span className="gdp-switch-l">APA Required?</span>
          </div>
          {/* APA Amount - only visible when APA Required = true */}
          {formData?.apaRequired && (
            <div>
              <label className="gdp-l">APA Amount</label>
              {isEditing && !isDeleted ? (
                <input className="gdp-in"
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
          <div className="gdp-field">
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
          <div className="gdp-field">
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
            <span className="gdp-switch-l">NDA Signed?</span>
          </div>
          {/* NDA Expiry Date - only visible when NDA Signed = true */}
          {formData?.ndaSigned && (
            <div>
              <label className="gdp-l">NDA Expiry Date</label>
              {isEditing && !isDeleted ? (
                <EditorialDatePicker
                  cool
                  value={formData?.ndaExpiryDate || ''}
                  onChange={(iso) => handleChange('ndaExpiryDate', iso)}
                  placeholder="dd/mm/yyyy"
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
                <EditorialSelect
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
                <EditorialSelect
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
                <EditorialSelect
                  value={formData?.shareGuestInfoWithCrew || 'Limited'}
                  onChange={(value) => handleChange('shareGuestInfoWithCrew', value)}
                  options={shareInfoOptions}
                />
              ) : (
                <V>{formData?.shareGuestInfoWithCrew || 'Limited'}</V>
              )}
            </div>
          </div>
          <div className="gdp-field">
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
          {prefsLoading && <p className="gdp-empty">Loading preferences…</p>}

          {!prefsLoading && prefGroups.length > 0 && (
            <div className="gdp-prefs">
              {prefGroups.map((group) => (
                <div key={group.name} className="gdp-pref-group">
                  <p>{group.name}</p>
                  {group.items.map((p) => (
                    <div key={p?.id} className="gdp-pref">
                      <span className="gdp-pref-k">{p?.key || '—'}</span>
                      <span className="gdp-pref-v">
                        {p?.value || '—'}
                        {p?.priority === 'critical' && <span className="gdp-chip warn">Critical</span>}
                        {p?.timeOfDay && <span className="gdp-chip">{p.timeOfDay}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {!prefsLoading && prefs !== null && prefGroups.length === 0 && (
            <p className="gdp-empty">No preferences recorded yet.</p>
          )}

          <button onClick={handleOpenPreferences} className="gdp-link gdp-pref-manage">
            Add or edit preferences
            <Icon name="ChevronRight" size={15} />
          </button>
        </div>

        {/* Section: History. Open on arrival — the tab exists to show the log,
            so collapsing it behind a toggle only costs a click. */}
        <div className="gdp-sec" data-tab="history">
          <h3 className="gdp-h">
            <Icon name="Clock" size={18} />
            Change history
          </h3>
          {historyEntries.length === 0 ? (
            <p className="gdp-empty">No changes recorded yet.</p>
          ) : (
            <div className="gdp-log">
              {historyEntries.map((entry) => {
                const changed = Object.keys(entry?.changes || {});
                return (
                  <div key={entry?.id} className="gdp-log-row">
                    <span className={`gdp-chip ${ACTION_TONE[entry?.action] || ''}`}>
                      {String(entry?.action || '').toUpperCase()}
                    </span>
                    <div className="gdp-log-body">
                      <p className="gdp-log-msg">{entry?.message}</p>
                      <p className="gdp-note">
                        {entry?.actorName}
                        {entry?.actorTier ? ` · ${entry.actorTier}` : ''}
                        {changed.length > 0 && ` · ${changed.slice(0, 3).join(', ')}`}
                        {changed.length > 3 && ` +${changed.length - 3} more`}
                      </p>
                    </div>
                    <span className="gdp-log-at">{formatStamp(entry?.at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Delete — Command only, kept off the Overview tab so it is never a
            stray click away from the fields people edit every day. */}
        {canDelete && !isEditing && !isDeleted && (
          <div className="gdp-sec gdp-danger" data-tab="history">
            <div>
              <h3 className="gdp-h"><Icon name="Trash2" size={18} />Delete guest</h3>
              <p>Removes the profile from Guest Management. The audit history is kept.</p>
            </div>
            <button type="button" className="gdp-btn danger" onClick={() => setShowDeleteConfirm(true)}>
              <Icon name="Trash2" size={14} /> Delete guest
            </button>
          </div>
        )}
      </div>
      {/* Delete Confirmation Modal - COMMAND ONLY */}
      {showDeleteConfirm && canDelete && (
        <ModalShell onClose={() => setShowDeleteConfirm(false)} panelClassName="gdp-modal">
          <h3>Delete {fullName || 'this guest'}?</h3>
          <p>
            This removes the guest profile from Guest Management. It cannot be undone
            unless restored from audit history.
          </p>
          <label className="gdp-confirm">
            <input
              type="checkbox"
              checked={deleteConfirmChecked}
              onChange={(e) => setDeleteConfirmChecked(e?.target?.checked)}
              className="gdp-check"
            />
            <span>I understand this will delete the guest profile.</span>
          </label>
          <div className="gdp-modal-actions">
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
          <div className="gdp-modal-head">
            <h3>Link children</h3>
            <button
              type="button"
              onClick={() => setShowKidsModal(false)}
              className="gdp-iconbtn"
              aria-label="Close"
            >
              <Icon name="X" size={18} />
            </button>
          </div>
          <p>
            Select existing guest profiles to link as children of {formData?.firstName} {formData?.lastName}.
          </p>
          {kidsLoading ? (
            <p className="gdp-empty">Loading guests…</p>
          ) : kidsOptions?.length === 0 ? (
            <p className="gdp-empty">No other guests available to link.</p>
          ) : (
            <div className="gdp-picklist">
              {kidsOptions?.map(kid => {
                const isLinked = linkedKidIds?.includes(kid?.id);
                return (
                  <button
                    key={kid?.id}
                    type="button"
                    onClick={() => handleToggleKid(kid?.id)}
                    className={isLinked ? 'gdp-pick is-on' : 'gdp-pick'}
                  >
                    <span className="gdp-mini-avatar">
                      {initialsOf(`${kid?.firstName || ''} ${kid?.lastName || ''}`)}
                    </span>
                    <span className="gdp-pick-name">{kid?.firstName} {kid?.lastName}</span>
                    <span className={isLinked ? 'gdp-chip accent' : 'gdp-chip'}>
                      {isLinked ? 'Linked' : 'Link'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="gdp-modal-actions">
            <button type="button" className="gdp-btn primary" onClick={() => setShowKidsModal(false)}>Done</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
};

export default GuestDetailPanel;
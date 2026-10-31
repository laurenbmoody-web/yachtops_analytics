import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { getAllDecks, getZonesByDeck, getSpacesByZone } from '../../locations-management-settings/utils/locationsHierarchyStorage';
import EditorialSelect from '../../../components/editorial/EditorialSelect';
import EditorialDatePicker from '../../../components/editorial/EditorialDatePicker';
import { MaritalStatus, GuestType, getAvailableSpouseOptions, getAvailableKidsOptions, getPassportDocumentSignedUrl } from '../utils/guestStorage';
import { getCurrentUser } from '../../../utils/authStorage';
import { supabase } from '../../../lib/supabaseClient';


import ModalShell from '../../../components/ui/ModalShell';
import '../add-guest-modal.css';
// A plain input in the editorial field style, keeping the one extra thing the
// old shared Input gave us: an `error` string that marks the field and prints
// underneath it. Everything else it added — its own label, description and
// colour tokens — is what made this modal look like a different product.
const AgInput = ({ error, className = '', ...rest }) => (
  <>
    <input className={`ag-in${error ? ' is-bad' : ''} ${className}`.trim()} {...rest} />
    {error && <p className="ag-err">{error}</p>}
  </>
);

const PASSPORT_NATIONALITIES = [
  'Afghan', 'Albanian', 'Algerian', 'American', 'Andorran', 'Angolan', 'Antiguan',
  'Argentine', 'Armenian', 'Australian', 'Austrian', 'Azerbaijani', 'Bahamian',
  'Bahraini', 'Bangladeshi', 'Barbadian', 'Belarusian', 'Belgian', 'Belizean',
  'Beninese', 'Bhutanese', 'Bolivian', 'Bosnian', 'Botswanan', 'Brazilian',
  'British', 'Bruneian', 'Bulgarian', 'Burkinabe', 'Burmese', 'Burundian',
  'Cambodian', 'Cameroonian', 'Canadian', 'Cape Verdean', 'Central African',
  'Chadian', 'Chilean', 'Chinese', 'Colombian', 'Comoran', 'Congolese',
  'Costa Rican', 'Croatian', 'Cuban', 'Cypriot', 'Czech', 'Danish', 'Djiboutian',
  'Dominican', 'Dutch', 'East Timorese', 'Ecuadorean', 'Egyptian', 'Emirian',
  'Equatorial Guinean', 'Eritrean', 'Estonian', 'Ethiopian', 'Fijian', 'Filipino',
  'Finnish', 'French', 'Gabonese', 'Gambian', 'Georgian', 'German', 'Ghanaian',
  'Greek', 'Grenadian', 'Guatemalan', 'Guinean', 'Guyanese', 'Haitian',
  'Honduran', 'Hungarian', 'Icelandic', 'Indian', 'Indonesian', 'Iranian',
  'Iraqi', 'Irish', 'Israeli', 'Italian', 'Ivorian', 'Jamaican', 'Japanese',
  'Jordanian', 'Kazakhstani', 'Kenyan', 'Kiribati', 'Kuwaiti', 'Kyrgyz',
  'Laotian', 'Latvian', 'Lebanese', 'Liberian', 'Libyan', 'Liechtensteiner',
  'Lithuanian', 'Luxembourger', 'Macedonian', 'Malagasy', 'Malawian', 'Malaysian',
  'Maldivian', 'Malian', 'Maltese', 'Marshallese', 'Mauritanian', 'Mauritian',
  'Mexican', 'Micronesian', 'Moldovan', 'Monacan', 'Mongolian', 'Montenegrin',
  'Moroccan', 'Mozambican', 'Namibian', 'Nauruan', 'Nepalese', 'New Zealander',
  'Nicaraguan', 'Nigerian', 'Nigerien', 'Norwegian', 'Omani', 'Pakistani',
  'Palauan', 'Panamanian', 'Papua New Guinean', 'Paraguayan', 'Peruvian',
  'Polish', 'Portuguese', 'Qatari', 'Romanian', 'Russian', 'Rwandan',
  'Saint Lucian', 'Salvadoran', 'Samoan', 'Saudi', 'Senegalese', 'Serbian',
  'Sierra Leonean', 'Singaporean', 'Slovak', 'Slovenian', 'Solomon Islander',
  'Somali', 'South African', 'South Korean', 'Spanish', 'Sri Lankan', 'Sudanese',
  'Surinamese', 'Swazi', 'Swedish', 'Swiss', 'Syrian', 'Taiwanese', 'Tajik',
  'Tanzanian', 'Thai', 'Togolese', 'Tongan', 'Trinidadian', 'Tunisian',
  'Turkish', 'Turkmen', 'Tuvaluan', 'Ugandan', 'Ukrainian', 'Uruguayan',
  'Uzbek', 'Vanuatuan', 'Venezuelan', 'Vietnamese', 'Yemeni', 'Zambian',
  'Zimbabwean', 'Other'
];

const EMERGENCY_RELATIONSHIPS = [
  'Spouse', 'Partner', 'Parent', 'Child', 'Sibling', 'Friend', 'Colleague',
  'Manager', 'Doctor', 'Lawyer', 'Other'
];

const CLIENT_TYPES = ['Owner', 'Charter', 'Guest of Charter', 'Other'];

const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'CHF', 'CNY', 'HKD', 'JPY',
  'NOK', 'NZD', 'SEK', 'SGD', 'ZAR'
];

const PRIVACY_LEVELS = ['Standard', 'High', 'Ultra'];
const PHOTO_PERMISSIONS = ['Yes', 'No', 'Ask Each Time'];
const SHARE_INFO_OPTIONS = ['Full', 'Limited', 'None'];


const AddGuestModal = ({ isOpen, onClose, onSave, editingGuest }) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    guestType: GuestType?.UNKNOWN,
    dateOfBirth: '',
    cakePreference: '',
    maritalStatus: '',
    spouseGuestId: null,
    contactEmail: '',
    contactPhone: '',
    healthConditions: '',
    allergies: '',
    cabinLocationPath: '',
    cabinLocationIds: null,
    isActiveOnTrip: false,
    preferencesSummary: '',
    photo: null,
    // Travel & Documents
    passportNumber: '',
    passportNationality: '',
    passportNationalityOther: '',
    passportExpiryDate: '',
    visaNotes: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
    // Payment & APA
    clientType: '',
    billingContactName: '',
    billingContactEmail: '',
    preferredCurrency: '',
    apaRequired: false,
    apaAmount: '',
    apaNotes: '',
    paymentNotes: '',
    // NDA & Privacy
    ndaSigned: false,
    ndaExpiryDate: '',
    ndaDocumentUrl: null,
    passportDocumentUrl: null,
    privacyLevel: 'Standard',
    photoPermission: 'Ask Each Time',
    shareGuestInfoWithCrew: 'Limited',
    privacyNotes: '',
  });
  const [errors, setErrors] = useState({});
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [spouseOptions, setSpouseOptions] = useState([]);
  
  // Kids linking state
  const [linkedKidIds, setLinkedKidIds] = useState([]);
  const [kidsOptions, setKidsOptions] = useState([]);
  const [showKidsModal, setShowKidsModal] = useState(false);
  const [kidsLoading, setKidsLoading] = useState(false);

  // NDA upload state
  const [ndaUploading, setNdaUploading] = useState(false);
  const [ndaFileName, setNdaFileName] = useState('');
  const ndaFileInputRef = useRef(null);

  // Passport upload state
  const [passportUploading, setPassportUploading] = useState(false);
  const [passportSignedUrl, setPassportSignedUrl] = useState(null);
  const passportFileInputRef = useRef(null);

  // Cabin location states
  const [locationNotFound, setLocationNotFound] = useState(false);
  const [showCabinDropdown, setShowCabinDropdown] = useState(false);
  const [selectedCabinPath, setSelectedCabinPath] = useState('');
  const [cabinSearchQuery, setCabinSearchQuery] = useState('');
  const [cabinOptions, setCabinOptions] = useState([]);
  
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const cabinDropdownRef = useRef(null);
  
  const currentUser = getCurrentUser();

  if (!isOpen) return null;
  
  // Build cabin options from Location Management hierarchy
  useEffect(() => {
    if (isOpen) {
      const decks = getAllDecks();
      
      // Populate form if editing
      if (editingGuest) {
        setFormData({
          firstName: editingGuest?.firstName || '',
          lastName: editingGuest?.lastName || '',
          guestType: editingGuest?.guestType || GuestType?.UNKNOWN,
          dateOfBirth: editingGuest?.dateOfBirth || '',
          cakePreference: editingGuest?.cakePreference || '',
          maritalStatus: editingGuest?.maritalStatus || '',
          spouseGuestId: editingGuest?.spouseGuestId || null,
          contactEmail: editingGuest?.contactEmail || '',
          contactPhone: editingGuest?.contactPhone || '',
          healthConditions: editingGuest?.healthConditions || '',
          allergies: editingGuest?.allergies || '',
          cabinLocationPath: editingGuest?.cabinLocationPath || '',
          cabinLocationIds: editingGuest?.cabinLocationIds || null,
          isActiveOnTrip: editingGuest?.isActiveOnTrip || false,
          preferencesSummary: editingGuest?.preferencesSummary || '',
          photo: editingGuest?.photo || null,
          // Travel & Documents
          passportNumber: editingGuest?.passportNumber || '',
          passportNationality: editingGuest?.passportNationality || '',
          passportNationalityOther: editingGuest?.passportNationalityOther || '',
          passportExpiryDate: editingGuest?.passportExpiryDate || '',
          visaNotes: editingGuest?.visaNotes || '',
          emergencyContactName: editingGuest?.emergencyContactName || '',
          emergencyContactPhone: editingGuest?.emergencyContactPhone || '',
          emergencyContactRelationship: editingGuest?.emergencyContactRelationship || '',
          // Payment & APA
          clientType: editingGuest?.clientType || '',
          billingContactName: editingGuest?.billingContactName || '',
          billingContactEmail: editingGuest?.billingContactEmail || '',
          preferredCurrency: editingGuest?.preferredCurrency || '',
          apaRequired: editingGuest?.apaRequired || false,
          apaAmount: editingGuest?.apaAmount || '',
          apaNotes: editingGuest?.apaNotes || '',
          paymentNotes: editingGuest?.paymentNotes || '',
          // NDA & Privacy
          ndaSigned: editingGuest?.ndaSigned || false,
          ndaExpiryDate: editingGuest?.ndaExpiryDate || '',
          ndaDocumentUrl: editingGuest?.ndaDocumentUrl || null,
          passportDocumentUrl: editingGuest?.passportDocumentUrl || null,
          privacyLevel: editingGuest?.privacyLevel || 'Standard',
          photoPermission: editingGuest?.photoPermission || 'Ask Each Time',
          shareGuestInfoWithCrew: editingGuest?.shareGuestInfoWithCrew || 'Limited',
          privacyNotes: editingGuest?.privacyNotes || '',
        });
        if (editingGuest?.ndaDocumentUrl) {
          const parts = editingGuest?.ndaDocumentUrl?.split('/');
          setNdaFileName(decodeURIComponent(parts?.[parts?.length - 1] || 'NDA Document'));
        }
        // Load passport signed URL if editing
        if (editingGuest?.passportDocumentUrl) {
          getPassportDocumentSignedUrl(editingGuest?.passportDocumentUrl)?.then(url => {
            setPassportSignedUrl(url);
          });
        } else {
          setPassportSignedUrl(null);
        }
        // Check if saved location still exists
        if (editingGuest?.cabinLocationPath && editingGuest?.cabinLocationIds) {
          const deckExists = decks?.some(d => d?.id === editingGuest?.cabinLocationIds?.deckId);
          if (!deckExists) {
            setLocationNotFound(true);
          } else {
            setLocationNotFound(false);
          }
        }
      } else {
        // Reset for new guest
        setLocationNotFound(false);
        setLinkedKidIds([]);
        setNdaFileName('');
        setPassportSignedUrl(null);
      }
    }
  }, [isOpen, editingGuest]);
  
  // Load spouse options when marital status is Married
  useEffect(() => {
    if (formData?.maritalStatus === MaritalStatus?.MARRIED) {
      getAvailableSpouseOptions(editingGuest?.id || null)?.then(available => {
        setSpouseOptions(Array.isArray(available) ? available : []);
      })?.catch(() => setSpouseOptions([]));
    } else {
      setSpouseOptions([]);
    }
  }, [formData?.maritalStatus, editingGuest?.id]);
  
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
      if (field === 'maritalStatus' && value !== MaritalStatus?.MARRIED) {
        updated.spouseGuestId = null;
      }
      if (field === 'ndaSigned' && !value) {
        updated.ndaExpiryDate = '';
      }
      return updated;
    });
    if (errors?.[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };
  
  const handleLocationHierarchyChange = (level, value) => {
    const decks = getAllDecks();
    
    if (level === 'deck') {
      const selectedDeck = decks?.find(d => d?.id === value);
      setFormData(prev => ({
        ...prev,
        cabinLocationIds: { deckId: value, zoneId: '', spaceId: '' },
        cabinLocationPath: selectedDeck ? `${selectedDeck?.name}` : ''
      }));
      setLocationNotFound(false);
    } else if (level === 'zone') {
      const zones = getZonesByDeck(formData?.cabinLocationIds?.deckId);
      const selectedZone = zones?.find(z => z?.id === value);
      const selectedDeck = decks?.find(d => d?.id === formData?.cabinLocationIds?.deckId);
      setFormData(prev => ({
        ...prev,
        cabinLocationIds: { ...prev?.cabinLocationIds, zoneId: value, spaceId: '' },
        cabinLocationPath: selectedDeck && selectedZone ? `${selectedDeck?.name} > ${selectedZone?.name}` : ''
      }));
      setLocationNotFound(false);
    } else if (level === 'space') {
      const spaces = getSpacesByZone(formData?.cabinLocationIds?.zoneId);
      const selectedSpace = spaces?.find(s => s?.id === value);
      const zones = getZonesByDeck(formData?.cabinLocationIds?.deckId);
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

  // Kids modal handlers
  const handleOpenKidsModal = async () => {
    setKidsLoading(true);
    setShowKidsModal(true);
    const options = await getAvailableKidsOptions(editingGuest?.id || null);
    setKidsOptions(Array.isArray(options) ? options : []);
    setKidsLoading(false);
  };

  const handleToggleKid = (kidId) => {
    setLinkedKidIds(prev =>
      prev?.includes(kidId) ? prev?.filter(id => id !== kidId) : [...prev, kidId]
    );
  };

  const getLinkedKidsDisplay = () => {
    if (linkedKidIds?.length === 0) return 'Unlinked';
    return `${linkedKidIds?.length} linked`;
  };

  // NDA document upload
  const handleNdaUpload = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (file?.size > 20 * 1024 * 1024) {
      showToast('File size must be less than 20MB', 'error');
      return;
    }
    setNdaUploading(true);
    try {
      const ext = file?.name?.split('.')?.pop();
      const path = `nda/${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}.${ext}`;
      const { data, error } = await supabase?.storage
        ?.from('guest-documents')
        ?.upload(path, file, { upsert: false });
      if (error) throw error;
      const { data: urlData } = supabase?.storage
        ?.from('guest-documents')
        ?.getPublicUrl(data?.path);
      setFormData(prev => ({ ...prev, ndaDocumentUrl: urlData?.publicUrl || data?.path }));
      setNdaFileName(file?.name);
      showToast('NDA document uploaded', 'success');
    } catch (err) {
      console.error('[AddGuestModal] NDA upload error:', err);
      showToast('Failed to upload NDA document', 'error');
    } finally {
      setNdaUploading(false);
      if (ndaFileInputRef?.current) ndaFileInputRef.current.value = '';
    }
  };

  const handleNdaRemove = () => {
    setFormData(prev => ({ ...prev, ndaDocumentUrl: null }));
    setNdaFileName('');
  };

  // Passport document upload
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
      const ext = file?.name?.split('.')?.pop();
      const path = `passport/${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}.${ext}`;
      const { data, error } = await supabase?.storage
        ?.from('guest-documents')
        ?.upload(path, file, { upsert: false });
      if (error) throw error;
      const url = await getPassportDocumentSignedUrl(data?.path);
      setPassportSignedUrl(url);
      setFormData(prev => ({ ...prev, passportDocumentUrl: data?.path }));
      showToast('Passport document uploaded', 'success');
    } catch (err) {
      console.error('[AddGuestModal] Passport upload error:', err);
      showToast('Failed to upload passport document', 'error');
    } finally {
      setPassportUploading(false);
      if (passportFileInputRef?.current) passportFileInputRef.current.value = '';
    }
  };

  const handlePassportRemove = () => {
    setFormData(prev => ({ ...prev, passportDocumentUrl: null }));
    setPassportSignedUrl(null);
  };

  const handlePhotoUpload = (e, source) => {
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

  const handleSubmit = (e) => {
    e?.preventDefault();
    const newErrors = {};
    if (!formData?.firstName?.trim()) newErrors.firstName = 'First name is required';
    if (!formData?.lastName?.trim()) newErrors.lastName = 'Last name is required';
    if (Object.keys(newErrors)?.length > 0) {
      setErrors(newErrors);
      return;
    }
    const guestData = {
      ...formData,
      firstName: formData?.firstName?.trim(),
      lastName: formData?.lastName?.trim(),
      _linkedKidIds: linkedKidIds,
    };
    onSave(guestData);
    handleClose();
  };

  const handleClose = () => {
    setFormData({
      firstName: '',
      lastName: '',
      guestType: GuestType?.UNKNOWN,
      dateOfBirth: '',
      cakePreference: '',
      maritalStatus: '',
      spouseGuestId: null,
      contactEmail: '',
      contactPhone: '',
      healthConditions: '',
      allergies: '',
      cabinLocationPath: '',
      cabinLocationIds: null,
      isActiveOnTrip: false,
      preferencesSummary: '',
      photo: null,
      passportNumber: '',
      passportNationality: '',
      passportNationalityOther: '',
      passportExpiryDate: '',
      visaNotes: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      emergencyContactRelationship: '',
      clientType: '',
      billingContactName: '',
      billingContactEmail: '',
      preferredCurrency: '',
      apaRequired: false,
      apaAmount: '',
      apaNotes: '',
      paymentNotes: '',
      ndaSigned: false,
      ndaExpiryDate: '',
      ndaDocumentUrl: null,
      passportDocumentUrl: null,
      privacyLevel: 'Standard',
      photoPermission: 'Ask Each Time',
      shareGuestInfoWithCrew: 'Limited',
      privacyNotes: '',
    });
    setErrors({});
    setShowPhotoPicker(false);
    setSelectedCabinPath('');
    setCabinSearchQuery('');
    setLocationNotFound(false);
    setShowCabinDropdown(false);
    setSpouseOptions([]);
    setLinkedKidIds([]);
    setKidsOptions([]);
    setShowKidsModal(false);
    setNdaFileName('');
    setPassportSignedUrl(null);
    onClose();
  };

  // Section header helper
  const SectionHeader = ({ icon, title }) => (
    <h3 className="ag-h">
      <Icon name={icon} size={14} />
      {title}
    </h3>
  );

  // Toggle component
  const Toggle = ({ checked, onChange, label }) => (
    <button
      type="button"
      className={checked ? 'ag-switch is-on' : 'ag-switch'}
      aria-pressed={!!checked}
      onClick={() => onChange(!checked)}
    >
      <span className="ag-switch-track"><span className="ag-switch-knob" /></span>
      {label && <span className="ag-switch-l">{label}</span>}
    </button>
  );

  return (
    <>
      <ModalShell onClose={handleClose} panelClassName="ag">
        {/* Header */}
        <div className="ag-head">
          <h2 >{editingGuest ? 'Edit Guest' : 'Add Guest'}</h2>
          <button
            onClick={handleClose}
            className="ag-x"
          >
            <Icon name="X" size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="ag-form">

          {/* ── Photo Upload ── */}
          <div className="ag-f">
            <label className="ag-l">Guest Photo</label>
            {formData?.photo ? (
              <div className="ag-photo">
                <img
                  src={formData?.photo?.dataUrl}
                  alt="Guest"
                  
                />
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="ag-photo-x"
                >
                  <Icon name="X" size={16} />
                </button>
              </div>
            ) : (
              <div className="ag-anchor">
                <button
                  type="button"
                  onClick={() => setShowPhotoPicker(!showPhotoPicker)}
                  className="ag-photo-empty"
                >
                  <Icon name="Camera" size={24} className="ag-note" />
                  <span className="ag-note">Add Photo</span>
                </button>
                {showPhotoPicker && (
                  <div className="ag-menu">
                    <button
                      type="button"
                      onClick={() => fileInputRef?.current?.click()}
                      className="ag-opt"
                    >
                      <Icon name="Upload" size={16} />
                      Upload from device
                    </button>
                    <button
                      type="button"
                      onClick={() => cameraInputRef?.current?.click()}
                      className="ag-opt"
                    >
                      <Icon name="Camera" size={16} />
                      Take photo
                    </button>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => handlePhotoUpload(e, 'file')} className="ag-hidden-input" />
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={(e) => handlePhotoUpload(e, 'camera')} className="ag-hidden-input" />
              </div>
            )}
          </div>

          {/* ── Personal Info ── */}
          <div className="ag-sec">
            <SectionHeader icon="User" title="Personal Information" />

            {/* Name */}
            <div className="ag-row">
              <div className="ag-f">
                <label className="ag-l">First Name *</label>
                <AgInput
                  value={formData?.firstName}
                  onChange={(e) => handleChange('firstName', e?.target?.value)}
                  placeholder="Enter first name"
                  error={errors?.firstName}
                />
              </div>
              <div className="ag-f">
                <label className="ag-l">Last Name *</label>
                <AgInput
                  value={formData?.lastName}
                  onChange={(e) => handleChange('lastName', e?.target?.value)}
                  placeholder="Enter last name"
                  error={errors?.lastName}
                />
              </div>
            </div>

            {/* Guest Type */}
            <div className="ag-f">
              <label className="ag-l">Guest Type</label>
              <EditorialSelect
                value={formData?.guestType}
                onChange={(value) => handleChange('guestType', value)}
                options={[
                  { value: GuestType?.OWNER, label: 'Owner' },
                  { value: GuestType?.CHARTER, label: 'Charter' },
                  { value: GuestType?.UNKNOWN, label: 'Unknown' }
                ]}
              />
            </div>

            {/* DOB & Cake */}
            <div className="ag-row">
              <div className="ag-f">
                <label className="ag-l">Date of Birth</label>
                <EditorialDatePicker cool value={formData?.dateOfBirth || ''} onChange={(iso) => handleChange('dateOfBirth', iso)} placeholder="dd/mm/yyyy" />
              </div>
              <div className="ag-f">
                <label className="ag-l">Cake Preference</label>
                <AgInput value={formData?.cakePreference} onChange={(e) => handleChange('cakePreference', e?.target?.value)} placeholder="e.g., Chocolate, Vanilla" />
              </div>
            </div>

            {/* Marital Status */}
            <div className="ag-f">
              <label className="ag-l">Marital Status</label>
              <EditorialSelect
                value={formData?.maritalStatus}
                onChange={(value) => handleChange('maritalStatus', value)}
                options={[
                  { value: MaritalStatus?.SINGLE, label: 'Single' },
                  { value: MaritalStatus?.MARRIED, label: 'Married' },
                  { value: MaritalStatus?.PARTNERED, label: 'Partnered' },
                  { value: MaritalStatus?.DIVORCED, label: 'Divorced' },
                  { value: MaritalStatus?.WIDOWED, label: 'Widowed' },
                  { value: MaritalStatus?.UNKNOWN, label: 'Prefer not to say' }
                ]}
              />
            </div>

            {/* Spouse Link */}
            {formData?.maritalStatus === MaritalStatus?.MARRIED && (
              <div className="ag-f">
                <label className="ag-l">Connect Spouse (optional)</label>
                <EditorialSelect
                  value={formData?.spouseGuestId || ''}
                  onChange={(value) => handleChange('spouseGuestId', value)}
                  options={[
                    { value: '', label: 'No spouse linked' },
                    ...spouseOptions?.map(guest => ({
                      value: guest?.id,
                      label: `${guest?.firstName} ${guest?.lastName}${guest?.cabinLocationPath ? ` (${guest?.cabinLocationPath})` : ''}`
                    }))
                  ]}
                />
              </div>
            )}

            {/* Connect Kids */}
            <div className="ag-f">
              <label className="ag-l">Connect Kids (optional)</label>
              <button
                type="button"
                onClick={handleOpenKidsModal}
                className="ag-link"
              >
                <Icon name="Users" size={14} />
                <span>{getLinkedKidsDisplay()}</span>
                <Icon name="ChevronRight" size={14} className="ag-note" />
              </button>
            </div>
          </div>

          {/* ── Contact Information ── */}
          <div className="ag-sec">
            <SectionHeader icon="Mail" title="Contact Information" />
            <div className="ag-f">
              <label className="ag-l">Email</label>
              <AgInput type="email" value={formData?.contactEmail} onChange={(e) => handleChange('contactEmail', e?.target?.value)} placeholder="guest@example.com" />
            </div>
            <div className="ag-f">
              <label className="ag-l">Phone</label>
              <AgInput type="tel" value={formData?.contactPhone} onChange={(e) => handleChange('contactPhone', e?.target?.value)} placeholder="+1 (555) 000-0000" />
            </div>
          </div>

          {/* ── Travel & Documents ── */}
          <div className="ag-sec">
            <SectionHeader icon="FileText" title="Travel & Documents" />

            <div className="ag-f">
              <label className="ag-l">Passport Number</label>
              <AgInput value={formData?.passportNumber} onChange={(e) => handleChange('passportNumber', e?.target?.value)} placeholder="e.g., AB1234567" />
            </div>

            <div className="ag-f">
              <label className="ag-l">Passport Nationality</label>
              <EditorialSelect
                value={formData?.passportNationality}
                onChange={(value) => handleChange('passportNationality', value)}
                options={[
                  { value: '', label: 'Select nationality' },
                  ...PASSPORT_NATIONALITIES?.map(n => ({ value: n, label: n }))
                ]}
              />
            </div>

            {formData?.passportNationality === 'Other' && (
              <div className="ag-f">
                <label className="ag-l">Nationality (specify)</label>
                <AgInput value={formData?.passportNationalityOther} onChange={(e) => handleChange('passportNationalityOther', e?.target?.value)} placeholder="Enter nationality" />
              </div>
            )}

            <div className="ag-f">
              <label className="ag-l">Passport Expiry Date</label>
              <EditorialDatePicker cool value={formData?.passportExpiryDate || ''} onChange={(iso) => handleChange('passportExpiryDate', iso)} placeholder="dd/mm/yyyy" />
            </div>

            <div className="ag-f">
              <label className="ag-l">Visa Notes</label>
              <textarea
                value={formData?.visaNotes}
                onChange={(e) => handleChange('visaNotes', e?.target?.value)}
                placeholder="Visa requirements, restrictions, notes..."
                rows={3}
                className="ag-ta"
              />
            </div>

            {/* Passport Document Upload */}
            <div>
              <label className="ag-l">Passport Document</label>
              {(formData?.passportDocumentUrl) ? (
                <div className="ag-doc">
                  <Icon name="FileText" size={18} className="ag-accent" />
                  <div className="ag-grow">
                    {passportSignedUrl ? (
                      <a
                        href={passportSignedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ag-filelink"
                      >
                        View Passport Document
                      </a>
                    ) : (
                      <span className="ag-val">Passport Document</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => passportFileInputRef?.current?.click()}
                    className="ag-btn ghost sm"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={handlePassportRemove}
                    className="ag-btn danger sm"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => passportFileInputRef?.current?.click()}
                  disabled={passportUploading}
                  className="ag-btn ghost"
                >
                  {passportUploading ? (
                    <div className="ag-spin" />
                  ) : (
                    <Icon name="Upload" size={16} />
                  )}
                  <span>{passportUploading ? 'Uploading...' : 'Upload Passport'}</span>
                </button>
              )}
              <input
                ref={passportFileInputRef}
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                onChange={handlePassportUpload}
                className="ag-hidden-input"
              />
            </div>

            <div className="ag-f">
              <p className="ag-l">Emergency Contact</p>
              <div className="ag-stack">
                <div className="ag-f">
                  <label className="ag-l">Name</label>
                  <AgInput value={formData?.emergencyContactName} onChange={(e) => handleChange('emergencyContactName', e?.target?.value)} placeholder="Full name" />
                </div>
                <div className="ag-f">
                  <label className="ag-l">Phone</label>
                  <AgInput type="tel" value={formData?.emergencyContactPhone} onChange={(e) => handleChange('emergencyContactPhone', e?.target?.value)} placeholder="+1 (555) 000-0000" />
                </div>
                <div className="ag-f">
                  <label className="ag-l">Relationship</label>
                  <EditorialSelect
                    value={formData?.emergencyContactRelationship}
                    onChange={(value) => handleChange('emergencyContactRelationship', value)}
                    options={[
                      { value: '', label: 'Select relationship' },
                      ...EMERGENCY_RELATIONSHIPS?.map(r => ({ value: r, label: r }))
                    ]}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Health Information ── */}
          <div className="ag-sec">
            <SectionHeader icon="Heart" title="Health Information" />
            <div className="ag-f">
              <label className="ag-l">Health Conditions</label>
              <AgInput value={formData?.healthConditions} onChange={(e) => handleChange('healthConditions', e?.target?.value)} placeholder="Any medical conditions to note" />
            </div>
            <div className="ag-f">
              <label className="ag-l">Allergies</label>
              <AgInput value={formData?.allergies} onChange={(e) => handleChange('allergies', e?.target?.value)} placeholder="Food or other allergies" />
            </div>
          </div>

          {/* ── Cabin Allocation ── */}
          <div className="ag-stack">
            <SectionHeader icon="Home" title="Cabin Allocation" />
            
            {locationNotFound && formData?.cabinLocationPath && (
              <div className="ag-callout warn">
                <span className="ag-strong">⚠ Previously selected cabin no longer exists.</span> Please select a new cabin.
              </div>
            )}
            
            {getAllDecks()?.length > 0 ? (
              <div className="ag-stack">
                <div>
                  <label className="ag-l">Deck</label>
                  <select
                    value={formData?.cabinLocationIds?.deckId || ''}
                    onChange={(e) => handleLocationHierarchyChange('deck', e?.target?.value)}
                    className="ag-in"
                  >
                    <option value="">Select deck</option>
                    {getAllDecks()?.map(deck => (
                      <option key={deck?.id} value={deck?.id}>{deck?.name}</option>
                    ))}
                  </select>
                </div>
                
                {/* Zone Dropdown */}
                <div>
                  <label className="ag-l">Zone</label>
                  <select
                    value={formData?.cabinLocationIds?.zoneId || ''}
                    onChange={(e) => handleLocationHierarchyChange('zone', e?.target?.value)}
                    className="ag-in"
                    disabled={!formData?.cabinLocationIds?.deckId}
                  >
                    <option value="">Select zone</option>
                    {getZonesByDeck(formData?.cabinLocationIds?.deckId)?.map(zone => (
                      <option key={zone?.id} value={zone?.id}>{zone?.name}</option>
                    ))}
                  </select>
                </div>
                
                {/* Space Dropdown */}
                <div>
                  <label className="ag-l">Space</label>
                  <select
                    value={formData?.cabinLocationIds?.spaceId || ''}
                    onChange={(e) => handleLocationHierarchyChange('space', e?.target?.value)}
                    className="ag-in"
                    disabled={!formData?.cabinLocationIds?.zoneId}
                  >
                    <option value="">Select space</option>
                    {getSpacesByZone(formData?.cabinLocationIds?.zoneId)?.map(space => (
                      <option key={space?.id} value={space?.id}>{space?.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="ag-callout">
                No locations configured. Add cabins in Location Management.
              </div>
            )}
            
            {/* Display selected location */}
            {formData?.cabinLocationPath && (
              <div className="ag-callout info">
                <span className="ag-strong">Selected: </span>{formData?.cabinLocationPath}
              </div>
            )}
          </div>

          {/* ── Payment & APA ── */}
          <div className="ag-sec">
            <SectionHeader icon="DollarSign" title="Payment & APA" />
            
            <div className="ag-f">
              <label className="ag-l">Client Type</label>
              <EditorialSelect
                value={formData?.clientType}
                onChange={(value) => handleChange('clientType', value)}
                options={[
                  { value: '', label: 'Select client type' },
                  ...CLIENT_TYPES?.map(t => ({ value: t, label: t }))
                ]}
              />
            </div>

            <div className="ag-f">
              <label className="ag-l">Billing Contact Name</label>
              <AgInput value={formData?.billingContactName} onChange={(e) => handleChange('billingContactName', e?.target?.value)} placeholder="Full name" />
            </div>

            <div className="ag-f">
              <label className="ag-l">Billing Contact Email</label>
              <AgInput type="email" value={formData?.billingContactEmail} onChange={(e) => handleChange('billingContactEmail', e?.target?.value)} placeholder="billing@example.com" />
            </div>

            <div className="ag-f">
              <label className="ag-l">Preferred Currency</label>
              <EditorialSelect
                value={formData?.preferredCurrency}
                onChange={(value) => handleChange('preferredCurrency', value)}
                options={[
                  { value: '', label: 'Select currency' },
                  ...CURRENCIES?.map(c => ({ value: c, label: c }))
                ]}
              />
            </div>

            <Toggle
              checked={formData?.apaRequired}
              onChange={(checked) => handleChange('apaRequired', checked)}
              label="APA Required"
            />

            {formData?.apaRequired && (
              <>
                <div className="ag-f">
                  <label className="ag-l">APA Amount</label>
                  <AgInput type="number" value={formData?.apaAmount} onChange={(e) => handleChange('apaAmount', e?.target?.value)} placeholder="0.00" />
                </div>
                <div className="ag-f">
                  <label className="ag-l">APA Notes</label>
                  <textarea
                    value={formData?.apaNotes}
                    onChange={(e) => handleChange('apaNotes', e?.target?.value)}
                    placeholder="APA terms, conditions, notes..."
                    rows={3}
                    className="ag-ta"
                  />
                </div>
              </>
            )}

            <div className="ag-f">
              <label className="ag-l">Payment Notes</label>
              <textarea
                value={formData?.paymentNotes}
                onChange={(e) => handleChange('paymentNotes', e?.target?.value)}
                placeholder="Payment terms, history, special arrangements..."
                rows={3}
                className="ag-ta"
              />
            </div>
          </div>

          {/* ── NDA & Privacy ── */}
          <div className="ag-sec">
            <SectionHeader icon="Shield" title="NDA &amp; Privacy" />

            <Toggle
              checked={formData?.ndaSigned}
              onChange={(checked) => handleChange('ndaSigned', checked)}
              label="NDA Signed"
            />

            {formData?.ndaSigned && (
              <>
                <div className="ag-f">
                  <label className="ag-l">NDA Expiry Date</label>
                  <EditorialDatePicker cool value={formData?.ndaExpiryDate || ''} onChange={(iso) => handleChange('ndaExpiryDate', iso)} placeholder="dd/mm/yyyy" />
                </div>

                <div className="ag-f">
                  <label className="ag-l">NDA Document</label>
                  {formData?.ndaDocumentUrl ? (
                    <div className="ag-doc">
                      <Icon name="FileText" size={16} className="ag-note" />
                      <span className="ag-filename">{ndaFileName}</span>
                      <button
                        type="button"
                        onClick={handleNdaRemove}
                        className="ag-iconbtn is-danger"
                      >
                        <Icon name="X" size={16} />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <input
                        ref={ndaFileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx"
                        onChange={handleNdaUpload}
                        className="ag-hidden-input"
                      />
                      <button className="ag-btn ghost" type="button" onClick={() => ndaFileInputRef?.current?.click()}
                        disabled={ndaUploading}
                      >
                        {ndaUploading ? 'Uploading...' : 'Upload NDA Document'}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="ag-f">
              <label className="ag-l">Privacy Level</label>
              <EditorialSelect
                value={formData?.privacyLevel}
                onChange={(value) => handleChange('privacyLevel', value)}
                options={PRIVACY_LEVELS?.map(p => ({ value: p, label: p }))}
              />
            </div>

            <div className="ag-f">
              <label className="ag-l">Photo Permission</label>
              <EditorialSelect
                value={formData?.photoPermission}
                onChange={(value) => handleChange('photoPermission', value)}
                options={PHOTO_PERMISSIONS?.map(p => ({ value: p, label: p }))}
              />
            </div>

            <div className="ag-f">
              <label className="ag-l">Share Guest Info with Crew</label>
              <EditorialSelect
                value={formData?.shareGuestInfoWithCrew}
                onChange={(value) => handleChange('shareGuestInfoWithCrew', value)}
                options={SHARE_INFO_OPTIONS?.map(o => ({ value: o, label: o }))}
              />
            </div>

            <div className="ag-f">
              <label className="ag-l">Privacy Notes</label>
              <textarea
                value={formData?.privacyNotes}
                onChange={(e) => handleChange('privacyNotes', e?.target?.value)}
                placeholder="Privacy preferences, restrictions, special considerations..."
                rows={3}
                className="ag-ta"
              />
            </div>
          </div>

          {/* Preferences Summary */}
          <div className="ag-sec">
            <h3 className="ag-h">
              <Icon name="Star" size={15} className="ag-note" />
              Preferences
            </h3>
            <button
              type="button"
              onClick={() => navigate('/preferences')}
              className="ag-cta"
            >
              <div className="ag-inline">
                <Icon name="Settings" size={16} className="ag-val" />
                <span className="ag-l">Preferences</span>
              </div>
              <Icon name="ChevronRight" size={16} className="ag-note" />
            </button>
          </div>

          {/* Active Status */}
          <div className="ag-switchrow">
            <input
              type="checkbox"
              id="isActiveOnTrip"
              checked={formData?.isActiveOnTrip}
              onChange={(e) => handleChange('isActiveOnTrip', e?.target?.checked)}
              className="ag-check"
            />
            <label htmlFor="isActiveOnTrip" className="ag-switch-l">
              Active on current trip
            </label>
          </div>

          {/* Action Buttons */}
          <div className="ag-actions">
            <button className="ag-btn ghost is-grow" type="button" onClick={handleClose}>
              Cancel
            </button>
            <button className="ag-btn primary is-grow" type="submit">
              {editingGuest ? 'Save Changes' : 'Add Guest'}
            </button>
          </div>
        </form>
      </ModalShell>
      {/* Kids Modal */}
      {showKidsModal && (
        <ModalShell onClose={() => setShowKidsModal(false)} panelClassName="ag is-narrow">
          <div className="ag-head">
            <h3 >Connect Kids</h3>
            <button
              onClick={() => setShowKidsModal(false)}
              className="ag-x"
            >
              <Icon name="X" size={20} />
            </button>
          </div>
          <div className="ag-form">
            {kidsLoading ? (
              <div className="ag-empty">Loading...</div>
            ) : kidsOptions?.length === 0 ? (
              <div className="ag-empty">No kids available to link</div>
            ) : (
              <div className="ag-f">
                {kidsOptions?.map(kid => (
                  <label
                    key={kid?.id}
                    className="ag-pick"
                  >
                    <input
                      type="checkbox"
                      checked={linkedKidIds?.includes(kid?.id)}
                      onChange={() => handleToggleKid(kid?.id)}
                      className="ag-check"
                    />
                    <div className="ag-grow">
                      <div className="ag-l">
                        {kid?.firstName} {kid?.lastName}
                      </div>
                      {kid?.cabinLocationPath && (
                        <div className="ag-note">{kid?.cabinLocationPath}</div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
            <div className="ag-foot">
              <button className="ag-btn primary" type="button" onClick={() => setShowKidsModal(false)}
                className="is-wide"
              >
                Done
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
};

export default AddGuestModal;
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { getAllDecks, getZonesByDeck, getSpacesByZone } from '../../locations-management-settings/utils/locationsHierarchyStorage';
import Select from '../../../components/ui/Select';
import { MaritalStatus, GuestType, getAvailableSpouseOptions, getAvailableKidsOptions, getPassportDocumentSignedUrl } from '../utils/guestStorage';
import { getCurrentUser } from '../../../utils/authStorage';
import { supabase } from '../../../lib/supabaseClient';


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
    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 pb-1 border-b border-border">
      <Icon name={icon} size={15} className="text-muted-foreground" />
      {title}
    </h3>
  );

  // Toggle component
  const Toggle = ({ checked, onChange, label }) => (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
      {label && <span className="text-sm font-medium text-foreground">{label}</span>}
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between rounded-t-2xl">
            <h2 className="text-xl font-semibold text-foreground">{editingGuest ? 'Edit Guest' : 'Add Guest'}</h2>
            <button
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon name="X" size={20} />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-8">

            {/* ── Photo Upload ── */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Guest Photo</label>
              {formData?.photo ? (
                <div className="relative w-32 h-32 rounded-lg overflow-hidden border-2 border-border">
                  <img
                    src={formData?.photo?.dataUrl}
                    alt="Guest"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="absolute top-2 right-2 bg-destructive text-destructive-foreground p-1.5 rounded-full hover:bg-destructive/90 transition-colors"
                  >
                    <Icon name="X" size={16} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowPhotoPicker(!showPhotoPicker)}
                    className="w-32 h-32 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-2 hover:border-primary transition-colors"
                  >
                    <Icon name="Camera" size={24} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Add Photo</span>
                  </button>
                  {showPhotoPicker && (
                    <div className="absolute top-full left-0 mt-2 bg-card border border-border rounded-lg shadow-lg p-2 z-10 space-y-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef?.current?.click()}
                        className="w-full px-4 py-2 text-sm text-left hover:bg-accent rounded flex items-center gap-2"
                      >
                        <Icon name="Upload" size={16} />
                        Upload from device
                      </button>
                      <button
                        type="button"
                        onClick={() => cameraInputRef?.current?.click()}
                        className="w-full px-4 py-2 text-sm text-left hover:bg-accent rounded flex items-center gap-2"
                      >
                        <Icon name="Camera" size={16} />
                        Take photo
                      </button>
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => handlePhotoUpload(e, 'file')} className="hidden" />
                  <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={(e) => handlePhotoUpload(e, 'camera')} className="hidden" />
                </div>
              )}
            </div>

            {/* ── Personal Info ── */}
            <div className="space-y-4">
              <SectionHeader icon="User" title="Personal Information" />

              {/* Name */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">First Name *</label>
                  <Input
                    value={formData?.firstName}
                    onChange={(e) => handleChange('firstName', e?.target?.value)}
                    placeholder="Enter first name"
                    error={errors?.firstName}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Last Name *</label>
                  <Input
                    value={formData?.lastName}
                    onChange={(e) => handleChange('lastName', e?.target?.value)}
                    placeholder="Enter last name"
                    error={errors?.lastName}
                  />
                </div>
              </div>

              {/* Guest Type */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Guest Type</label>
                <Select
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Date of Birth</label>
                  <Input type="date" value={formData?.dateOfBirth} onChange={(e) => handleChange('dateOfBirth', e?.target?.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Cake Preference</label>
                  <Input value={formData?.cakePreference} onChange={(e) => handleChange('cakePreference', e?.target?.value)} placeholder="e.g., Chocolate, Vanilla" />
                </div>
              </div>

              {/* Marital Status */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Marital Status</label>
                <Select
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
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Connect Spouse (optional)</label>
                  <Select
                    value={formData?.spouseGuestId || ''}
                    onChange={(value) => handleChange('spouseGuestId', value)}
                    options={[
                      { value: '', label: 'No spouse linked' },
                      ...spouseOptions?.map(guest => ({
                        value: guest?.id,
                        label: `${guest?.firstName} ${guest?.lastName}${guest?.cabinLocationPath ? ` (${guest?.cabinLocationPath})` : ''}`
                      }))
                    ]}
                    searchable
                  />
                </div>
              )}

              {/* Connect Kids */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Connect Kids (optional)</label>
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

            {/* ── Contact Information ── */}
            <div className="space-y-4">
              <SectionHeader icon="Mail" title="Contact Information" />
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Email</label>
                <Input type="email" value={formData?.contactEmail} onChange={(e) => handleChange('contactEmail', e?.target?.value)} placeholder="guest@example.com" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Phone</label>
                <Input type="tel" value={formData?.contactPhone} onChange={(e) => handleChange('contactPhone', e?.target?.value)} placeholder="+1 (555) 000-0000" />
              </div>
            </div>

            {/* ── Travel & Documents ── */}
            <div className="space-y-4">
              <SectionHeader icon="FileText" title="Travel & Documents" />

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Passport Number</label>
                <Input value={formData?.passportNumber} onChange={(e) => handleChange('passportNumber', e?.target?.value)} placeholder="e.g., AB1234567" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Passport Nationality</label>
                <Select
                  value={formData?.passportNationality}
                  onChange={(value) => handleChange('passportNationality', value)}
                  options={[
                    { value: '', label: 'Select nationality' },
                    ...PASSPORT_NATIONALITIES?.map(n => ({ value: n, label: n }))
                  ]}
                  searchable
                />
              </div>

              {formData?.passportNationality === 'Other' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Nationality (specify)</label>
                  <Input value={formData?.passportNationalityOther} onChange={(e) => handleChange('passportNationalityOther', e?.target?.value)} placeholder="Enter nationality" />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Passport Expiry Date</label>
                <Input type="date" value={formData?.passportExpiryDate} onChange={(e) => handleChange('passportExpiryDate', e?.target?.value)} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Visa Notes</label>
                <textarea
                  value={formData?.visaNotes}
                  onChange={(e) => handleChange('visaNotes', e?.target?.value)}
                  placeholder="Visa requirements, restrictions, notes..."
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              {/* Passport Document Upload */}
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-2 block">Passport Document</label>
                {(formData?.passportDocumentUrl) ? (
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
                        <span className="text-sm text-foreground">Passport Document</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => passportFileInputRef?.current?.click()}
                      className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={handlePassportRemove}
                      className="text-xs text-destructive hover:text-destructive/80 px-2 py-1 rounded border border-destructive/30 hover:bg-destructive/10 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => passportFileInputRef?.current?.click()}
                    disabled={passportUploading}
                    className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-sm rounded-lg border border-border transition-colors disabled:opacity-50"
                  >
                    {passportUploading ? (
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
                  className="hidden"
                />
              </div>

              <div className="pt-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Emergency Contact</p>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Name</label>
                    <Input value={formData?.emergencyContactName} onChange={(e) => handleChange('emergencyContactName', e?.target?.value)} placeholder="Full name" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Phone</label>
                    <Input type="tel" value={formData?.emergencyContactPhone} onChange={(e) => handleChange('emergencyContactPhone', e?.target?.value)} placeholder="+1 (555) 000-0000" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Relationship</label>
                    <Select
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
            <div className="space-y-4">
              <SectionHeader icon="Heart" title="Health Information" />
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Health Conditions</label>
                <Input value={formData?.healthConditions} onChange={(e) => handleChange('healthConditions', e?.target?.value)} placeholder="Any medical conditions to note" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Allergies</label>
                <Input value={formData?.allergies} onChange={(e) => handleChange('allergies', e?.target?.value)} placeholder="Food or other allergies" />
              </div>
            </div>

            {/* ── Cabin Allocation ── */}
            <div className="space-y-3">
              <SectionHeader icon="Home" title="Cabin Allocation" />
              
              {locationNotFound && formData?.cabinLocationPath && (
                <div className="px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                  <span className="font-medium">⚠ Previously selected cabin no longer exists.</span> Please select a new cabin.
                </div>
              )}
              
              {getAllDecks()?.length > 0 ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-900 mb-1">Deck</label>
                    <select
                      value={formData?.cabinLocationIds?.deckId || ''}
                      onChange={(e) => handleLocationHierarchyChange('deck', e?.target?.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">Select deck</option>
                      {getAllDecks()?.map(deck => (
                        <option key={deck?.id} value={deck?.id}>{deck?.name}</option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Zone Dropdown */}
                  <div>
                    <label className="block text-xs font-medium text-gray-900 mb-1">Zone</label>
                    <select
                      value={formData?.cabinLocationIds?.zoneId || ''}
                      onChange={(e) => handleLocationHierarchyChange('zone', e?.target?.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                    <label className="block text-xs font-medium text-gray-900 mb-1">Space</label>
                    <select
                      value={formData?.cabinLocationIds?.spaceId || ''}
                      onChange={(e) => handleLocationHierarchyChange('space', e?.target?.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600">
                  No locations configured. Add cabins in Location Management.
                </div>
              )}
              
              {/* Display selected location */}
              {formData?.cabinLocationPath && (
                <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-gray-700">
                  <span className="font-medium">Selected: </span>{formData?.cabinLocationPath}
                </div>
              )}
            </div>

            {/* ── Payment & APA ── */}
            <div className="space-y-4">
              <SectionHeader icon="DollarSign" title="Payment & APA" />
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Client Type</label>
                <Select
                  value={formData?.clientType}
                  onChange={(value) => handleChange('clientType', value)}
                  options={[
                    { value: '', label: 'Select client type' },
                    ...CLIENT_TYPES?.map(t => ({ value: t, label: t }))
                  ]}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Billing Contact Name</label>
                <Input value={formData?.billingContactName} onChange={(e) => handleChange('billingContactName', e?.target?.value)} placeholder="Full name" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Billing Contact Email</label>
                <Input type="email" value={formData?.billingContactEmail} onChange={(e) => handleChange('billingContactEmail', e?.target?.value)} placeholder="billing@example.com" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Preferred Currency</label>
                <Select
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
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">APA Amount</label>
                    <Input type="number" value={formData?.apaAmount} onChange={(e) => handleChange('apaAmount', e?.target?.value)} placeholder="0.00" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">APA Notes</label>
                    <textarea
                      value={formData?.apaNotes}
                      onChange={(e) => handleChange('apaNotes', e?.target?.value)}
                      placeholder="APA terms, conditions, notes..."
                      rows={3}
                      className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Payment Notes</label>
                <textarea
                  value={formData?.paymentNotes}
                  onChange={(e) => handleChange('paymentNotes', e?.target?.value)}
                  placeholder="Payment terms, history, special arrangements..."
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
            </div>

            {/* ── NDA & Privacy ── */}
            <div className="space-y-4">
              <SectionHeader icon="Shield" title="NDA &amp; Privacy" />

              <Toggle
                checked={formData?.ndaSigned}
                onChange={(checked) => handleChange('ndaSigned', checked)}
                label="NDA Signed"
              />

              {formData?.ndaSigned && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">NDA Expiry Date</label>
                    <Input type="date" value={formData?.ndaExpiryDate} onChange={(e) => handleChange('ndaExpiryDate', e?.target?.value)} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">NDA Document</label>
                    {formData?.ndaDocumentUrl ? (
                      <div className="flex items-center gap-2 px-3 py-2 bg-accent border border-border rounded-lg">
                        <Icon name="FileText" size={16} className="text-muted-foreground" />
                        <span className="text-sm text-foreground flex-1 truncate">{ndaFileName}</span>
                        <button
                          type="button"
                          onClick={handleNdaRemove}
                          className="text-destructive hover:text-destructive/80"
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
                          className="hidden"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => ndaFileInputRef?.current?.click()}
                          disabled={ndaUploading}
                        >
                          {ndaUploading ? 'Uploading...' : 'Upload NDA Document'}
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Privacy Level</label>
                <Select
                  value={formData?.privacyLevel}
                  onChange={(value) => handleChange('privacyLevel', value)}
                  options={PRIVACY_LEVELS?.map(p => ({ value: p, label: p }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Photo Permission</label>
                <Select
                  value={formData?.photoPermission}
                  onChange={(value) => handleChange('photoPermission', value)}
                  options={PHOTO_PERMISSIONS?.map(p => ({ value: p, label: p }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Share Guest Info with Crew</label>
                <Select
                  value={formData?.shareGuestInfoWithCrew}
                  onChange={(value) => handleChange('shareGuestInfoWithCrew', value)}
                  options={SHARE_INFO_OPTIONS?.map(o => ({ value: o, label: o }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Privacy Notes</label>
                <textarea
                  value={formData?.privacyNotes}
                  onChange={(e) => handleChange('privacyNotes', e?.target?.value)}
                  placeholder="Privacy preferences, restrictions, special considerations..."
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
            </div>

            {/* Preferences Summary */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 pb-1 border-b border-border">
                <Icon name="Star" size={15} className="text-muted-foreground" />
                Preferences
              </h3>
              <button
                type="button"
                onClick={() => navigate('/preferences')}
                className="w-full px-4 py-3 bg-muted/50 hover:bg-muted rounded-lg text-left flex items-center justify-between transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Icon name="Settings" size={16} className="text-foreground" />
                  <span className="text-sm font-medium text-foreground">Preferences</span>
                </div>
                <Icon name="ChevronRight" size={16} className="text-muted-foreground" />
              </button>
            </div>

            {/* Active Status */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isActiveOnTrip"
                checked={formData?.isActiveOnTrip}
                onChange={(e) => handleChange('isActiveOnTrip', e?.target?.checked)}
                className="w-4 h-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
              />
              <label htmlFor="isActiveOnTrip" className="text-sm font-medium text-foreground cursor-pointer">
                Active on current trip
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" onClick={handleClose} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" className="flex-1">
                {editingGuest ? 'Save Changes' : 'Add Guest'}
              </Button>
            </div>
          </form>
        </div>
      </div>
      {/* Kids Modal */}
      {showKidsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h3 className="text-lg font-semibold text-foreground">Connect Kids</h3>
              <button
                onClick={() => setShowKidsModal(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Icon name="X" size={20} />
              </button>
            </div>
            <div className="p-6">
              {kidsLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : kidsOptions?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">No kids available to link</div>
              ) : (
                <div className="space-y-2">
                  {kidsOptions?.map(kid => (
                    <label
                      key={kid?.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={linkedKidIds?.includes(kid?.id)}
                        onChange={() => handleToggleKid(kid?.id)}
                        className="w-4 h-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-foreground">
                          {kid?.firstName} {kid?.lastName}
                        </div>
                        {kid?.cabinLocationPath && (
                          <div className="text-xs text-muted-foreground">{kid?.cabinLocationPath}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
              <div className="mt-6">
                <Button
                  type="button"
                  onClick={() => setShowKidsModal(false)}
                  className="w-full"
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AddGuestModal;
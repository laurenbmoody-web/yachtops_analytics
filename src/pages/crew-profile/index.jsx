import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Icon from '../../components/AppIcon';
import QuickEntryModal from './components/QuickEntryModal';
import BreachNotesModal from './components/BreachNotesModal';
import { getCurrentUser, getDepartmentDisplayName } from '../../utils/authStorage';
import { getStatusLabel, getStatusBadgeClasses, getStatusDotClass } from '../../utils/crewStatus';
import { showToast } from '../../utils/toast';
import { addWorkEntries, getComplianceStatus, getMonthCalendarData, detectBreaches, getCrewWorkEntries, deleteWorkEntriesForDate, runAllHORTests, confirmMonth, getMonthStatus, isMonthEditable, detectBreachedDatesAfterSave, hasBreachNoteForDate } from './utils/horStorage';
import { useRole } from '../../contexts/RoleContext';
import { PermissionTier } from '../../utils/authStorage';
import VesselHORDashboard from './components/VesselHORDashboard';
import SeaTimeTracker from './components/SeaTimeTracker';
import { supabase } from '../../lib/supabaseClient';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';




const CrewProfile = () => {
  const navigate = useNavigate();
  const { crewId } = useParams();
  const { activeTenantId } = useTenant();
  const { session, loading: authLoading, isVesselAdmin } = useAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [crewMember, setCrewMember] = useState(null);
  const [activeSection, setActiveSection] = useState('personal');
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({});
  const [sameAsEmergency, setSameAsEmergency] = useState(false);
  const [showAccountNumber, setShowAccountNumber] = useState(false);
  const [showBankAddress, setShowBankAddress] = useState(false);
  const [cakeSurprise, setCakeSurprise] = useState(false);
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [selectedHORDates, setSelectedHORDates] = useState([]);
  const [horCurrentMonth, setHorCurrentMonth] = useState(new Date());
  const [horData, setHorData] = useState(null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);
  const [showEditDateModal, setShowEditDateModal] = useState(false);
  const { userRole } = useRole();
  const [horView, setHorView] = useState('my'); // 'my' or 'vessel'
  const [showBreachNotesModal, setShowBreachNotesModal] = useState(false);
  const [breachedDates, setBreachedDates] = useState([]);
  const [profileError, setProfileError] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [tenantMemberRole, setTenantMemberRole] = useState(null);
  const [currentUserPermissionTier, setCurrentUserPermissionTier] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const fileInputRef = React.useRef(null);

  // Fetch tenant member role for permission checks
  useEffect(() => {
    const fetchTenantMemberRole = async () => {
      if (!session?.user?.id || !activeTenantId) return;
      
      try {
        const { data, error } = await supabase
          ?.from('tenant_members')
          ?.select('role, permission_tier')
          ?.eq('user_id', session?.user?.id)
          ?.eq('tenant_id', activeTenantId)
          ?.eq('active', true)
          ?.single();

        if (!error && data) {
          setTenantMemberRole(data?.role);
          setCurrentUserPermissionTier(data?.permission_tier);
        }
      } catch (err) {
        console.error('Error fetching tenant member role:', err);
      }
    };
    
    fetchTenantMemberRole();
  }, [session, activeTenantId]);

  // Check authentication - no longer using getCurrentUser()
  useEffect(() => {
    // Authentication is handled by AuthContext and ProtectedRoute
    // No need to check getCurrentUser() here
  }, []);

  // Load crew member data from Supabase
  useEffect(() => {
    const loadCrewProfile = async () => {
      if (!crewId) {
        setProfileError('No crew ID provided');
        setProfileLoading(false);
        return;
      }

      console.log('PROFILE ROUTE crewId:', crewId);
      
      try {
        // Get current authenticated user
        const authResponse = await supabase?.auth?.getUser();
        const { data: { user } = {}, error: authError } = authResponse || {};
        if (authError) {
          console.error('PROFILE auth error:', authError);
        }
        const currentUserId = user?.id;
        console.log('PROFILE current user:', currentUserId);

        setProfileLoading(true);
        setProfileError(null);

        // Fetch profile from public.profiles using crewId as USER ID
        const { data: profileData, error: profileError } = await supabase?.from('profiles')?.select('id, full_name, email, last_active_tenant_id, avatar_url')?.eq('id', crewId)?.single();

        if (profileError) {
          console.error('PROFILE Supabase error:', profileError);
          console.error('PROFILE error details:', {
            code: profileError?.code,
            message: profileError?.message,
            details: profileError?.details,
            hint: profileError?.hint
          });
          
          if (profileError?.code === 'PGRST116') {
            // No rows returned
            setProfileError('Profile not found or you don\'t have access.');
          } else {
            setProfileError(`Failed to load profile: ${profileError?.message}`);
          }
          setProfileLoading(false);
          return;
        }

        if (!profileData) {
          console.warn('PROFILE: No profile data returned for crewId:', crewId);
          setProfileError('Profile not found or you don\'t have access.');
          setProfileLoading(false);
          return;
        }

        // Fetch tenant_members row for this crew member to get role, dept, status
        let membershipData = null;
        if (activeTenantId) {
          const { data: tmData } = await supabase
            ?.from('tenant_members')
            ?.select(`
              status,
              department_id,
              role:roles!role_id(name),
              custom_role:tenant_custom_roles!custom_role_id(name),
              departments(name)
            `)
            ?.eq('user_id', crewId)
            ?.eq('tenant_id', activeTenantId)
            ?.eq('active', true)
            ?.maybeSingle();
          membershipData = tmData;
        }

        console.log('PROFILE data loaded:', profileData);

        // Convert Supabase profile to crew member format for compatibility
        const crew = {
          id: profileData?.id,
          fullName: profileData?.full_name || 'Unknown',
          email: profileData?.email || '',
          firstName: profileData?.full_name?.split(' ')?.[0] || '',
          lastName: profileData?.full_name?.split(' ')?.slice(1)?.join(' ') || '',
          avatarUrl: profileData?.avatar_url || null,
          status: membershipData?.status || null,
          roleTitle: membershipData?.role?.name || membershipData?.custom_role?.name || null,
          department: membershipData?.departments?.name || null,
          // Initialize empty fields for sections that may not have data yet
          dateOfBirth: '',
          nationality: '',
          passportNumber: '',
          passportExpiry: '',
          homeAddress: '',
          phoneNumber: '',
          allergies: '',
          medicalConditions: '',
          emergencyContact: {},
          nextOfKin: {},
          bankAccountHolder: '',
          bankName: '',
          bankAccountNumber: '',
          bankSwiftBic: '',
          bankCurrency: 'USD',
          bankCountry: '',
          crewPreferences: {}
        };

        setCrewMember(crew);
        setAvatarPreview(crew?.avatarUrl);
        setProfileLoading(false);
        
        // Initialize form data
        setFormData({
          firstName: crew?.firstName,
          lastName: crew?.lastName,
          dateOfBirth: crew?.dateOfBirth,
          nationality: crew?.nationality,
          passportNumber: crew?.passportNumber,
          passportExpiry: crew?.passportExpiry,
          homeAddress: crew?.homeAddress,
          phoneNumber: crew?.phoneNumber,
          email: crew?.email,
          allergies: crew?.allergies,
          medicalConditions: crew?.medicalConditions,
          emergencyContactName: crew?.emergencyContact?.name || '',
          emergencyContactRelationship: crew?.emergencyContact?.relationship || '',
          emergencyContactPhone: crew?.emergencyContact?.phone || '',
          emergencyContactAddress: crew?.emergencyContact?.address || '',
          nextOfKinName: crew?.nextOfKin?.name || '',
          nextOfKinRelationship: crew?.nextOfKin?.relationship || '',
          nextOfKinPhone: crew?.nextOfKin?.phone || '',
          nextOfKinAddress: crew?.nextOfKin?.address || '',
          bankAccountHolder: crew?.bankAccountHolder,
          bankName: crew?.bankName,
          bankAccountNumber: crew?.bankAccountNumber,
          bankSwiftBic: crew?.bankSwiftBic,
          bankCurrency: crew?.bankCurrency,
          bankCountry: crew?.bankCountry,
          dietaryCategory: crew?.crewPreferences?.dietaryCategory || 'None / No restrictions',
          dietaryNotes: crew?.crewPreferences?.dietaryNotes || '',
          cakePreference: crew?.crewPreferences?.cakePreference || '',
          favouriteMeals: crew?.crewPreferences?.favouriteMeals || '',
          favouriteSnacks: crew?.crewPreferences?.favouriteSnacks || '',
          alcoholicPreference: crew?.crewPreferences?.alcoholicPreference || 'None',
          nonAlcoholicPreferences: crew?.crewPreferences?.nonAlcoholicPreferences || ''
        });
        
      } catch (err) {
        console.error('PROFILE unexpected error:', err);
        setProfileError('An unexpected error occurred while loading the profile.');
        setProfileLoading(false);
      }
    };

    loadCrewProfile();
  }, [crewId]);

  // Load HOR data when HOR section is active
  useEffect(() => {
    if (activeSection === 'hor' && crewId) {
      loadHORData();
    }
  }, [activeSection, crewId]);

  const loadHORData = () => {
    if (!crewId) return;
    
    const complianceStatus = getComplianceStatus(crewId);
    const calendarData = getMonthCalendarData(crewId, horCurrentMonth?.getFullYear(), horCurrentMonth?.getMonth());
    const breaches = detectBreaches(crewId);
    
    setHorData({
      last24HoursRest: complianceStatus?.last24HoursRest,
      last7DaysRest: complianceStatus?.last7DaysRest,
      isCompliant: complianceStatus?.isCompliant,
      calendarData,
      breaches
    });
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!crewMember) return;

    // Permission check: only allow editing own profile or if Command role
    const currentUserId = session?.user?.id;
    const isOwnProfile = currentUserId === crewId;
    const role = tenantMemberRole?.toUpperCase();
    const isCommandRole = role === 'CAPTAIN' || role === 'PURSER' || role === 'ADMIN' || role === 'CHIEF';

    if (!isOwnProfile && !isCommandRole) {
      console.error('PROFILE SAVE: Permission denied', {
        currentUserId,
        crewId,
        role,
        isOwnProfile,
        isCommandRole
      });
      showToast('You do not have permission to edit this profile', 'error');
      return;
    }

    console.log('PROFILE SAVE: Starting save', {
      crewId,
      currentUserId,
      isOwnProfile,
      role,
      isCommandRole
    });

    try {
      // Prepare full_name from firstName and lastName
      const fullName = `${formData?.firstName || ''} ${formData?.lastName || ''}`?.trim();
      
      // Update only full_name and email in Supabase profiles table
      const { data, error } = await supabase
        ?.from('profiles')
        ?.update({
          full_name: fullName,
          email: formData?.email
        })
        ?.eq('id', crewId)
        ?.select()
        ?.single();

      if (error) {
        console.error('PROFILE SAVE: Supabase error', {
          error,
          code: error?.code,
          message: error?.message,
          details: error?.details,
          hint: error?.hint
        });
        showToast(`Failed to save profile: ${error?.message || 'Unknown error'}`, 'error');
        return;
      }

      console.log('PROFILE SAVE: Success', data);
      showToast('Profile updated successfully', 'success');
      setIsEditing(false);

      // Re-fetch the profile to refresh UI
      const { data: refreshedProfile, error: refreshError } = await supabase
        ?.from('profiles')
        ?.select('id, full_name, email, last_active_tenant_id')
        ?.eq('id', crewId)
        ?.single();

      if (refreshError) {
        console.error('PROFILE SAVE: Error refreshing profile', refreshError);
        // Don't show error to user since save was successful
      } else if (refreshedProfile) {
        console.log('PROFILE SAVE: Profile refreshed', refreshedProfile);
        
        // Update crew member state with refreshed data
        const updatedCrew = {
          id: refreshedProfile?.id,
          fullName: refreshedProfile?.full_name || 'Unknown',
          email: refreshedProfile?.email || '',
          firstName: refreshedProfile?.full_name?.split(' ')?.[0] || '',
          lastName: refreshedProfile?.full_name?.split(' ')?.slice(1)?.join(' ') || ''
        };
        
        setCrewMember(updatedCrew);
        
        // Update form data to reflect saved changes
        setFormData(prev => ({
          ...prev,
          firstName: updatedCrew?.firstName,
          lastName: updatedCrew?.lastName,
          email: updatedCrew?.email
        }));
      }
    } catch (err) {
      console.error('PROFILE SAVE: Unexpected error', err);
      showToast(`Failed to save profile: ${err?.message || 'Unexpected error'}`, 'error');
    }
  };

  const handleSameAsEmergencyToggle = (checked) => {
    setSameAsEmergency(checked);
    if (checked) {
      // Auto-fill Next of Kin from Emergency Contact
      setFormData(prev => ({
        ...prev,
        nextOfKinName: prev?.emergencyContactName,
        nextOfKinRelationship: prev?.emergencyContactRelationship,
        nextOfKinPhone: prev?.emergencyContactPhone,
        nextOfKinAddress: prev?.emergencyContactAddress
      }));
    }
  };

const canEdit = (() => {
  const currentUserId = session?.user?.id;
  const isOwnProfile = currentUserId === crewId;

  // Command roles (Captain, Purser, Admin, Chief) can edit any profile
  const role = tenantMemberRole?.toUpperCase();
  const isCommandRole = role === 'CAPTAIN' || role === 'PURSER' || role === 'ADMIN' || role === 'CHIEF';

  // Console logs for debugging
  console.log('🔍 EDIT PERMISSION DEBUG:', {
    crewId,
    'session.user.id': currentUserId,
    tenantMemberRole: role,
    isOwnProfile,
    isCommandRole,
    canEdit: isOwnProfile || isCommandRole
  });

  return isOwnProfile || isCommandRole;
})();

  // Handle avatar click - trigger file input
  const handleAvatarClick = () => {
    if (canEdit && fileInputRef?.current) {
      fileInputRef?.current?.click();
    }
  };

  // Handle avatar upload
  const handleAvatarUpload = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file?.type?.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      return;
    }

    // Validate file size (5MB limit)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file?.size > maxSize) {
      showToast('Image size must be less than 5MB', 'error');
      return;
    }

    try {
      setAvatarUploading(true);

      // Show immediate preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader?.result);
      };
      reader?.readAsDataURL(file);

      // Upload to Supabase Storage
      const filePath = `${crewId}/${Date.now()}-${file?.name}`;
      const { data: uploadData, error: uploadError } = await supabase
        ?.storage
        ?.from('avatars')
        ?.upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        showToast('Failed to upload photo', 'error');
        setAvatarPreview(null);
        return;
      }

      // Get signed URL for private bucket
      const { data: urlData, error: urlError } = await supabase
        ?.storage
        ?.from('avatars')
        ?.createSignedUrl(filePath, 60 * 60 * 24 * 365); // 1 year expiry

      if (urlError) {
        console.error('URL generation error:', urlError);
        showToast('Failed to generate photo URL', 'error');
        setAvatarPreview(null);
        return;
      }

      const avatarUrl = urlData?.signedUrl;

      // Update profiles table with avatar_url
      const { error: updateError } = await supabase
        ?.from('profiles')
        ?.update({ avatar_url: avatarUrl })
        ?.eq('id', crewId);

      if (updateError) {
        console.error('Profile update error:', updateError);
        showToast('Failed to update profile photo', 'error');
        setAvatarPreview(null);
        return;
      }

      // Update local state
      setCrewMember(prev => ({
        ...prev,
        avatarUrl: avatarUrl
      }));

      showToast('Profile photo updated', 'success');
    } catch (err) {
      console.error('Avatar upload error:', err);
      showToast('Failed to upload photo', 'error');
      setAvatarPreview(null);
    } finally {
      setAvatarUploading(false);
      // Reset file input
      if (fileInputRef?.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Comprehensive list of nationalities
  const nationalityOptions = [
    { value: 'Afghan', label: 'Afghan' },
    { value: 'Albanian', label: 'Albanian' },
    { value: 'Algerian', label: 'Algerian' },
    { value: 'American', label: 'American' },
    { value: 'Andorran', label: 'Andorran' },
    { value: 'Angolan', label: 'Angolan' },
    { value: 'Argentinian', label: 'Argentinian' },
    { value: 'Armenian', label: 'Armenian' },
    { value: 'Australian', label: 'Australian' },
    { value: 'Austrian', label: 'Austrian' },
    { value: 'Azerbaijani', label: 'Azerbaijani' },
    { value: 'Bahamian', label: 'Bahamian' },
    { value: 'Bahraini', label: 'Bahraini' },
    { value: 'Bangladeshi', label: 'Bangladeshi' },
    { value: 'Barbadian', label: 'Barbadian' },
    { value: 'Belarusian', label: 'Belarusian' },
    { value: 'Belgian', label: 'Belgian' },
    { value: 'Belizean', label: 'Belizean' },
    { value: 'Beninese', label: 'Beninese' },
    { value: 'Bhutanese', label: 'Bhutanese' },
    { value: 'Bolivian', label: 'Bolivian' },
    { value: 'Bosnian', label: 'Bosnian' },
    { value: 'Brazilian', label: 'Brazilian' },
    { value: 'British', label: 'British' },
    { value: 'Bruneian', label: 'Bruneian' },
    { value: 'Bulgarian', label: 'Bulgarian' },
    { value: 'Burkinabe', label: 'Burkinabe' },
    { value: 'Burmese', label: 'Burmese' },
    { value: 'Burundian', label: 'Burundian' },
    { value: 'Cambodian', label: 'Cambodian' },
    { value: 'Cameroonian', label: 'Cameroonian' },
    { value: 'Canadian', label: 'Canadian' },
    { value: 'Cape Verdean', label: 'Cape Verdean' },
    { value: 'Central African', label: 'Central African' },
    { value: 'Chadian', label: 'Chadian' },
    { value: 'Chilean', label: 'Chilean' },
    { value: 'Chinese', label: 'Chinese' },
    { value: 'Colombian', label: 'Colombian' },
    { value: 'Comoran', label: 'Comoran' },
    { value: 'Congolese', label: 'Congolese' },
    { value: 'Costa Rican', label: 'Costa Rican' },
    { value: 'Croatian', label: 'Croatian' },
    { value: 'Cuban', label: 'Cuban' },
    { value: 'Cypriot', label: 'Cypriot' },
    { value: 'Czech', label: 'Czech' },
    { value: 'Danish', label: 'Danish' },
    { value: 'Djiboutian', label: 'Djiboutian' },
    { value: 'Dominican', label: 'Dominican' },
    { value: 'Dutch', label: 'Dutch' },
    { value: 'East Timorese', label: 'East Timorese' },
    { value: 'Ecuadorian', label: 'Ecuadorian' },
    { value: 'Egyptian', label: 'Egyptian' },
    { value: 'Emirati', label: 'Emirati' },
    { value: 'Equatorial Guinean', label: 'Equatorial Guinean' },
    { value: 'Eritrean', label: 'Eritrean' },
    { value: 'Estonian', label: 'Estonian' },
    { value: 'Ethiopian', label: 'Ethiopian' },
    { value: 'Fijian', label: 'Fijian' },
    { value: 'Filipino', label: 'Filipino' },
    { value: 'Finnish', label: 'Finnish' },
    { value: 'French', label: 'French' },
    { value: 'Gabonese', label: 'Gabonese' },
    { value: 'Gambian', label: 'Gambian' },
    { value: 'Georgian', label: 'Georgian' },
    { value: 'German', label: 'German' },
    { value: 'Ghanaian', label: 'Ghanaian' },
    { value: 'Greek', label: 'Greek' },
    { value: 'Grenadian', label: 'Grenadian' },
    { value: 'Guatemalan', label: 'Guatemalan' },
    { value: 'Guinean', label: 'Guinean' },
    { value: 'Guyanese', label: 'Guyanese' },
    { value: 'Haitian', label: 'Haitian' },
    { value: 'Honduran', label: 'Honduran' },
    { value: 'Hungarian', label: 'Hungarian' },
    { value: 'Icelandic', label: 'Icelandic' },
    { value: 'Indian', label: 'Indian' },
    { value: 'Indonesian', label: 'Indonesian' },
    { value: 'Iranian', label: 'Iranian' },
    { value: 'Iraqi', label: 'Iraqi' },
    { value: 'Irish', label: 'Irish' },
    { value: 'Israeli', label: 'Israeli' },
    { value: 'Italian', label: 'Italian' },
    { value: 'Ivorian', label: 'Ivorian' },
    { value: 'Jamaican', label: 'Jamaican' },
    { value: 'Japanese', label: 'Japanese' },
    { value: 'Jordanian', label: 'Jordanian' },
    { value: 'Kazakh', label: 'Kazakh' },
    { value: 'Kenyan', label: 'Kenyan' },
    { value: 'Kuwaiti', label: 'Kuwaiti' },
    { value: 'Kyrgyz', label: 'Kyrgyz' },
    { value: 'Laotian', label: 'Laotian' },
    { value: 'Latvian', label: 'Latvian' },
    { value: 'Lebanese', label: 'Lebanese' },
    { value: 'Liberian', label: 'Liberian' },
    { value: 'Libyan', label: 'Libyan' },
    { value: 'Liechtensteiner', label: 'Liechtensteiner' },
    { value: 'Lithuanian', label: 'Lithuanian' },
    { value: 'Luxembourgish', label: 'Luxembourgish' },
    { value: 'Macedonian', label: 'Macedonian' },
    { value: 'Malagasy', label: 'Malagasy' },
    { value: 'Malawian', label: 'Malawian' },
    { value: 'Malaysian', label: 'Malaysian' },
    { value: 'Maldivian', label: 'Maldivian' },
    { value: 'Malian', label: 'Malian' },
    { value: 'Maltese', label: 'Maltese' },
    { value: 'Marshallese', label: 'Marshallese' },
    { value: 'Mauritanian', label: 'Mauritanian' },
    { value: 'Mauritian', label: 'Mauritian' },
    { value: 'Mexican', label: 'Mexican' },
    { value: 'Micronesian', label: 'Micronesian' },
    { value: 'Moldovan', label: 'Moldovan' },
    { value: 'Monacan', label: 'Monacan' },
    { value: 'Mongolian', label: 'Mongolian' },
    { value: 'Montenegrin', label: 'Montenegrin' },
    { value: 'Moroccan', label: 'Moroccan' },
    { value: 'Mozambican', label: 'Mozambican' },
    { value: 'Namibian', label: 'Namibian' },
    { value: 'Nauruan', label: 'Nauruan' },
    { value: 'Nepalese', label: 'Nepalese' },
    { value: 'New Zealander', label: 'New Zealander' },
    { value: 'Nicaraguan', label: 'Nicaraguan' },
    { value: 'Nigerian', label: 'Nigerian' },
    { value: 'Nigerien', label: 'Nigerien' },
    { value: 'North Korean', label: 'North Korean' },
    { value: 'Norwegian', label: 'Norwegian' },
    { value: 'Omani', label: 'Omani' },
    { value: 'Pakistani', label: 'Pakistani' },
    { value: 'Palauan', label: 'Palauan' },
    { value: 'Palestinian', label: 'Palestinian' },
    { value: 'Panamanian', label: 'Panamanian' },
    { value: 'Papua New Guinean', label: 'Papua New Guinean' },
    { value: 'Paraguayan', label: 'Paraguayan' },
    { value: 'Peruvian', label: 'Peruvian' },
    { value: 'Polish', label: 'Polish' },
    { value: 'Portuguese', label: 'Portuguese' },
    { value: 'Qatari', label: 'Qatari' },
    { value: 'Romanian', label: 'Romanian' },
    { value: 'Russian', label: 'Russian' },
    { value: 'Rwandan', label: 'Rwandan' },
    { value: 'Saint Lucian', label: 'Saint Lucian' },
    { value: 'Salvadoran', label: 'Salvadoran' },
    { value: 'Samoan', label: 'Samoan' },
    { value: 'San Marinese', label: 'San Marinese' },
    { value: 'Sao Tomean', label: 'Sao Tomean' },
    { value: 'Saudi', label: 'Saudi' },
    { value: 'Senegalese', label: 'Senegalese' },
    { value: 'Serbian', label: 'Serbian' },
    { value: 'Seychellois', label: 'Seychellois' },
    { value: 'Sierra Leonean', label: 'Sierra Leonean' },
    { value: 'Singaporean', label: 'Singaporean' },
    { value: 'Slovak', label: 'Slovak' },
    { value: 'Slovenian', label: 'Slovenian' },
    { value: 'Solomon Islander', label: 'Solomon Islander' },
    { value: 'Somali', label: 'Somali' },
    { value: 'South African', label: 'South African' },
    { value: 'South Korean', label: 'South Korean' },
    { value: 'South Sudanese', label: 'South Sudanese' },
    { value: 'Spanish', label: 'Spanish' },
    { value: 'Sri Lankan', label: 'Sri Lankan' },
    { value: 'Sudanese', label: 'Sudanese' },
    { value: 'Surinamese', label: 'Surinamese' },
    { value: 'Swazi', label: 'Swazi' },
    { value: 'Swedish', label: 'Swedish' },
    { value: 'Swiss', label: 'Swiss' },
    { value: 'Syrian', label: 'Syrian' },
    { value: 'Taiwanese', label: 'Taiwanese' },
    { value: 'Tajik', label: 'Tajik' },
    { value: 'Tanzanian', label: 'Tanzanian' },
    { value: 'Thai', label: 'Thai' },
    { value: 'Togolese', label: 'Togolese' },
    { value: 'Tongan', label: 'Tongan' },
    { value: 'Trinidadian', label: 'Trinidadian' },
    { value: 'Tunisian', label: 'Tunisian' },
    { value: 'Turkish', label: 'Turkish' },
    { value: 'Turkmen', label: 'Turkmen' },
    { value: 'Tuvaluan', label: 'Tuvaluan' },
    { value: 'Ugandan', label: 'Ugandan' },
    { value: 'Ukrainian', label: 'Ukrainian' },
    { value: 'Uruguayan', label: 'Uruguayan' },
    { value: 'Uzbek', label: 'Uzbek' },
    { value: 'Vanuatuan', label: 'Vanuatuan' },
    { value: 'Venezuelan', label: 'Venezuelan' },
    { value: 'Vietnamese', label: 'Vietnamese' },
    { value: 'Yemeni', label: 'Yemeni' },
    { value: 'Zambian', label: 'Zambian' },
    { value: 'Zimbabwean', label: 'Zimbabwean' }
  ];

  const navigationSections = [
    { key: 'personal', label: 'Personal Details', icon: 'User' },
    { key: 'emergency', label: 'Emergency / Next of Kin', icon: 'Phone' },
    { key: 'banking', label: 'Banking', icon: 'CreditCard' },
    { key: 'preferences', label: 'Preferences', icon: 'Utensils' },
    { key: 'hor', label: 'Hours of Rest (HOR)', icon: 'Clock' },
    { key: 'seatime', label: 'Sea Time Tracker', icon: 'Ship' }
  ];

  const canEditStatus = isVesselAdmin || currentUserPermissionTier === 'COMMAND';

  const handleProfileStatusChange = async (newStatus) => {
    if (!activeTenantId || !crewId) return;
    const { error } = await supabase
      ?.from('tenant_members')
      ?.update({ status: newStatus })
      ?.eq('user_id', crewId)
      ?.eq('tenant_id', activeTenantId);
    if (error) { showToast(error?.message || 'Failed to update status', 'error'); return; }
    setCrewMember(prev => ({ ...prev, status: newStatus }));
  };

  const renderHeader = () => {
    if (!crewMember) return null;

    return (
      <div className="bg-card border border-border rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-6">
            {/* Profile Photo - Clickable Upload Area */}
            <div className="flex flex-col items-center gap-2">
              <div 
                onClick={handleAvatarClick}
                className={`w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden relative ${
                  canEdit ? 'cursor-pointer hover:ring-2 hover:ring-primary hover:ring-offset-2 hover:ring-offset-background transition-all' : ''
                }`}
              >
                {avatarUploading && (
                  <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
                    <Icon name="Loader2" size={24} className="text-primary animate-spin" />
                  </div>
                )}
                {avatarPreview || crewMember?.avatarUrl ? (
                  <img 
                    src={avatarPreview || crewMember?.avatarUrl} 
                    alt={crewMember?.fullName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Icon name="User" size={48} className="text-primary" />
                )}
              </div>
              {canEdit && (
                <p className="text-xs text-muted-foreground text-center max-w-[100px]">
                  Click to upload photo
                </p>
              )}
            </div>
            
            {/* Crew Info */}
            <div>
              <h2 className="text-3xl font-semibold text-foreground mb-2">
                {crewMember?.fullName}
              </h2>
              <div className="flex flex-wrap gap-3 mb-2">
                <span className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Role:</span>{' '}
                  {crewMember?.roleTitle || 'No role assigned'}
                </span>
                <span className="text-sm text-muted-foreground">•</span>
                <span className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Department:</span>{' '}
                  {crewMember?.department || 'No department assigned'}
                </span>
              </div>
              {crewMember?.status ? (
                canEditStatus ? (
                  <select
                    value={crewMember?.status}
                    onChange={e => handleProfileStatusChange(e.target.value)}
                    className={`text-xs font-medium px-3 py-1 rounded-full border-0 cursor-pointer ${getStatusBadgeClasses(crewMember?.status)}`}
                  >
                    {[
                      { value: 'active', label: 'Active' },
                      { value: 'on_leave', label: 'On Leave' },
                      { value: 'rotational_leave', label: 'On Rotational Leave' },
                      { value: 'medical_leave', label: 'Medical Leave' },
                      { value: 'training', label: 'Training' },
                      { value: 'invited', label: 'Invited' },
                    ].map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${getStatusBadgeClasses(crewMember?.status)}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${getStatusDotClass(crewMember?.status)}`} />
                    {getStatusLabel(crewMember?.status)}
                  </span>
                )
              ) : null}
            </div>
          </div>

          {/* Edit Button */}
          {canEdit && (
            <Button
              variant="outline"
              iconName="Edit"
              onClick={() => setIsEditing(!isEditing)}
            >
              {isEditing ? 'Cancel Edit' : 'Edit Profile'}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderPersonalDetails = () => {
    return (
      <div className="bg-card border border-border rounded-2xl p-6">
        <h3 className="text-xl font-semibold text-foreground mb-6">Personal Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Input
            label="First Names"
            value={formData?.firstName}
            onChange={(e) => handleInputChange('firstName', e?.target?.value)}
            disabled={!isEditing}
          />
          <Input
            label="Last Name"
            value={formData?.lastName}
            onChange={(e) => handleInputChange('lastName', e?.target?.value)}
            disabled={!isEditing}
          />
          <Input
            label="Date of Birth"
            type="date"
            value={formData?.dateOfBirth}
            onChange={(e) => handleInputChange('dateOfBirth', e?.target?.value)}
            disabled={!isEditing}
          />
          <Select
            label="Nationality"
            options={nationalityOptions}
            value={formData?.nationality}
            onChange={(value) => handleInputChange('nationality', value)}
            disabled={!isEditing}
            searchable={true}
            placeholder="Select nationality"
          />
          <Input
            label="Passport Number"
            value={formData?.passportNumber}
            onChange={(e) => handleInputChange('passportNumber', e?.target?.value)}
            disabled={!isEditing}
          />
          <Input
            label="Passport Expiry"
            type="date"
            value={formData?.passportExpiry}
            onChange={(e) => handleInputChange('passportExpiry', e?.target?.value)}
            disabled={!isEditing}
          />
          <Input
            label="Phone Number"
            value={formData?.phoneNumber}
            onChange={(e) => handleInputChange('phoneNumber', e?.target?.value)}
            disabled={!isEditing}
          />
          <Input
            label="Email"
            type="email"
            value={formData?.email}
            onChange={(e) => handleInputChange('email', e?.target?.value)}
            disabled={!isEditing}
          />
          <div className="md:col-span-2">
            <Input
              label="Home Address"
              value={formData?.homeAddress}
              onChange={(e) => handleInputChange('homeAddress', e?.target?.value)}
              disabled={!isEditing}
            />
          </div>
          <Input
            label="Allergies"
            value={formData?.allergies}
            onChange={(e) => handleInputChange('allergies', e?.target?.value)}
            disabled={!isEditing}
            description="Basic indicator only"
          />
          <Input
            label="Medical Conditions"
            value={formData?.medicalConditions}
            onChange={(e) => handleInputChange('medicalConditions', e?.target?.value)}
            disabled={!isEditing}
            description="Any relevant medical conditions"
          />
        </div>
        {isEditing && (
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </div>
        )}
      </div>
    );
  };

  const renderEmergencyContact = () => {
    return (
      <div className="bg-card border border-border rounded-2xl p-6">
        <h3 className="text-xl font-semibold text-foreground mb-6">Emergency / Next of Kin</h3>
        <div className="space-y-8">
          {/* Emergency Contact */}
          <div>
            <h4 className="text-base font-semibold text-foreground mb-4">Emergency Contact</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input
                label="Full Name"
                value={formData?.emergencyContactName}
                onChange={(e) => handleInputChange('emergencyContactName', e?.target?.value)}
                disabled={!isEditing}
                required
              />
              <Input
                label="Relationship"
                value={formData?.emergencyContactRelationship}
                onChange={(e) => handleInputChange('emergencyContactRelationship', e?.target?.value)}
                disabled={!isEditing}
              />
              <Input
                label="Phone / Contact Number"
                value={formData?.emergencyContactPhone}
                onChange={(e) => handleInputChange('emergencyContactPhone', e?.target?.value)}
                disabled={!isEditing}
                required
              />
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-foreground mb-2 block">Address</label>
                <textarea
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px]"
                  value={formData?.emergencyContactAddress}
                  onChange={(e) => handleInputChange('emergencyContactAddress', e?.target?.value)}
                  disabled={!isEditing}
                  placeholder="Enter full address"
                />
              </div>
            </div>
          </div>

          {/* Next of Kin */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-base font-semibold text-foreground">Next of Kin</h4>
              {isEditing && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sameAsEmergency}
                    onChange={(e) => handleSameAsEmergencyToggle(e?.target?.checked)}
                    className="rounded border-input text-primary focus:ring-primary"
                  />
                  <span>Same as Emergency Contact</span>
                </label>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input
                label="Full Name"
                value={formData?.nextOfKinName}
                onChange={(e) => handleInputChange('nextOfKinName', e?.target?.value)}
                disabled={!isEditing || sameAsEmergency}
              />
              <Input
                label="Relationship"
                value={formData?.nextOfKinRelationship}
                onChange={(e) => handleInputChange('nextOfKinRelationship', e?.target?.value)}
                disabled={!isEditing || sameAsEmergency}
              />
              <Input
                label="Phone / Contact Number"
                value={formData?.nextOfKinPhone}
                onChange={(e) => handleInputChange('nextOfKinPhone', e?.target?.value)}
                disabled={!isEditing || sameAsEmergency}
              />
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-foreground mb-2 block">Address</label>
                <textarea
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px]"
                  value={formData?.nextOfKinAddress}
                  onChange={(e) => handleInputChange('nextOfKinAddress', e?.target?.value)}
                  disabled={!isEditing || sameAsEmergency}
                  placeholder="Enter full address"
                />
              </div>
            </div>
          </div>
        </div>
        {isEditing && (
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </div>
        )}
      </div>
    );
  };

  const renderBanking = () => {
    const maskAccountNumber = (number) => {
      if (!number) return '••••••••';
      if (showAccountNumber || isEditing) return number;
      const lastFour = number?.slice(-4) || '1234';
      return `••••••${lastFour}`;
    };

    const currencyOptions = [
      { value: 'USD', label: 'USD - US Dollar' },
      { value: 'EUR', label: 'EUR - Euro' },
      { value: 'GBP', label: 'GBP - British Pound' },
      { value: 'AUD', label: 'AUD - Australian Dollar' },
      { value: 'CAD', label: 'CAD - Canadian Dollar' },
      { value: 'CHF', label: 'CHF - Swiss Franc' },
      { value: 'JPY', label: 'JPY - Japanese Yen' },
      { value: 'CNY', label: 'CNY - Chinese Yuan' },
      { value: 'INR', label: 'INR - Indian Rupee' },
      { value: 'SGD', label: 'SGD - Singapore Dollar' },
      { value: 'NZD', label: 'NZD - New Zealand Dollar' },
      { value: 'HKD', label: 'HKD - Hong Kong Dollar' },
      { value: 'SEK', label: 'SEK - Swedish Krona' },
      { value: 'NOK', label: 'NOK - Norwegian Krone' },
      { value: 'DKK', label: 'DKK - Danish Krone' },
      { value: 'ZAR', label: 'ZAR - South African Rand' },
      { value: 'AED', label: 'AED - UAE Dirham' },
      { value: 'SAR', label: 'SAR - Saudi Riyal' },
      { value: 'THB', label: 'THB - Thai Baht' },
      { value: 'MYR', label: 'MYR - Malaysian Ringgit' }
    ];

    const countryOptions = [
      { value: 'United Kingdom', label: 'United Kingdom' },
      { value: 'United States', label: 'United States' },
      { value: 'Australia', label: 'Australia' },
      { value: 'Canada', label: 'Canada' },
      { value: 'France', label: 'France' },
      { value: 'Germany', label: 'Germany' },
      { value: 'Italy', label: 'Italy' },
      { value: 'Spain', label: 'Spain' },
      { value: 'Netherlands', label: 'Netherlands' },
      { value: 'Switzerland', label: 'Switzerland' },
      { value: 'Belgium', label: 'Belgium' },
      { value: 'Austria', label: 'Austria' },
      { value: 'Sweden', label: 'Sweden' },
      { value: 'Norway', label: 'Norway' },
      { value: 'Denmark', label: 'Denmark' },
      { value: 'Finland', label: 'Finland' },
      { value: 'Ireland', label: 'Ireland' },
      { value: 'Portugal', label: 'Portugal' },
      { value: 'Greece', label: 'Greece' },
      { value: 'Poland', label: 'Poland' },
      { value: 'Czech Republic', label: 'Czech Republic' },
      { value: 'Hungary', label: 'Hungary' },
      { value: 'Romania', label: 'Romania' },
      { value: 'Bulgaria', label: 'Bulgaria' },
      { value: 'Croatia', label: 'Croatia' },
      { value: 'Slovenia', label: 'Slovenia' },
      { value: 'Slovakia', label: 'Slovakia' },
      { value: 'Luxembourg', label: 'Luxembourg' },
      { value: 'Malta', label: 'Malta' },
      { value: 'Cyprus', label: 'Cyprus' },
      { value: 'Iceland', label: 'Iceland' },
      { value: 'Japan', label: 'Japan' },
      { value: 'China', label: 'China' },
      { value: 'India', label: 'India' },
      { value: 'Singapore', label: 'Singapore' },
      { value: 'Hong Kong', label: 'Hong Kong' },
      { value: 'South Korea', label: 'South Korea' },
      { value: 'Thailand', label: 'Thailand' },
      { value: 'Malaysia', label: 'Malaysia' },
      { value: 'Indonesia', label: 'Indonesia' },
      { value: 'Philippines', label: 'Philippines' },
      { value: 'Vietnam', label: 'Vietnam' },
      { value: 'New Zealand', label: 'New Zealand' },
      { value: 'South Africa', label: 'South Africa' },
      { value: 'United Arab Emirates', label: 'United Arab Emirates' },
      { value: 'Saudi Arabia', label: 'Saudi Arabia' },
      { value: 'Qatar', label: 'Qatar' },
      { value: 'Kuwait', label: 'Kuwait' },
      { value: 'Bahrain', label: 'Bahrain' },
      { value: 'Oman', label: 'Oman' },
      { value: 'Israel', label: 'Israel' },
      { value: 'Turkey', label: 'Turkey' },
      { value: 'Brazil', label: 'Brazil' },
      { value: 'Mexico', label: 'Mexico' },
      { value: 'Argentina', label: 'Argentina' },
      { value: 'Chile', label: 'Chile' },
      { value: 'Colombia', label: 'Colombia' },
      { value: 'Peru', label: 'Peru' },
      { value: 'Russia', label: 'Russia' },
      { value: 'Ukraine', label: 'Ukraine' }
    ];

    const accountTypeOptions = [
      { value: 'Checking', label: 'Checking' },
      { value: 'Savings', label: 'Savings' },
      { value: 'Other', label: 'Other' }
    ];

    const showSortCode = formData?.bankCountry === 'United Kingdom';
    const showRoutingNumber = formData?.bankCountry === 'United States';

    const role = currentUser?.role?.toUpperCase();
    const canReveal = role === 'CAPTAIN' || role === 'PURSER' || role === 'ADMIN';

    return (
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-foreground">Banking Information</h3>
          {!isEditing && canReveal && (
            <Button
              variant="ghost"
              size="sm"
              iconName={showAccountNumber ? 'EyeOff' : 'Eye'}
              onClick={() => setShowAccountNumber(!showAccountNumber)}
            >
              {showAccountNumber ? 'Hide' : 'Reveal'}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Input
            label="Account Holder Name"
            value={formData?.bankAccountHolder}
            onChange={(e) => handleInputChange('bankAccountHolder', e?.target?.value)}
            disabled={!isEditing}
            required
          />
          <Input
            label="Bank Name"
            value={formData?.bankName}
            onChange={(e) => handleInputChange('bankName', e?.target?.value)}
            disabled={!isEditing}
            required
          />
          <Input
            label="Account Number / IBAN"
            value={maskAccountNumber(formData?.bankAccountNumber)}
            onChange={(e) => handleInputChange('bankAccountNumber', e?.target?.value)}
            disabled={!isEditing}
            required
            description="Masked for security"
          />
          <Input
            label="SWIFT / BIC"
            value={formData?.bankSwiftBic}
            onChange={(e) => handleInputChange('bankSwiftBic', e?.target?.value)}
            disabled={!isEditing}
          />
          <Select
            label="Currency"
            options={currencyOptions}
            value={formData?.bankCurrency}
            onChange={(value) => handleInputChange('bankCurrency', value)}
            disabled={!isEditing}
            searchable={true}
            required
          />
          <Select
            label="Country"
            options={countryOptions}
            value={formData?.bankCountry}
            onChange={(value) => {
              handleInputChange('bankCountry', value);
              // Auto-fill bank address country if empty
              if (!formData?.bankAddressCountry) {
                handleInputChange('bankAddressCountry', value);
              }
            }}
            disabled={!isEditing}
            searchable={true}
            required
          />
          <Select
            label="Account Type"
            options={accountTypeOptions}
            value={formData?.bankAccountType}
            onChange={(value) => handleInputChange('bankAccountType', value)}
            disabled={!isEditing}
            placeholder="Select account type (optional)"
          />
          {showSortCode && (
            <Input
              label="Sort Code"
              value={formData?.bankSortCode}
              onChange={(e) => handleInputChange('bankSortCode', e?.target?.value)}
              disabled={!isEditing}
              placeholder="XX-XX-XX"
              required
              description="Format: XX-XX-XX"
            />
          )}
          {showRoutingNumber && (
            <Input
              label="Routing Number (ABA)"
              value={formData?.bankRoutingNumber}
              onChange={(e) => handleInputChange('bankRoutingNumber', e?.target?.value)}
              disabled={!isEditing}
              placeholder="9-digit routing number"
              required
            />
          )}
        </div>

        {/* Optional Bank Address Section */}
        <div className="mt-6">
          <button
            onClick={() => setShowBankAddress(!showBankAddress)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-smooth mb-4"
            disabled={!isEditing}
          >
            <Icon name={showBankAddress ? 'ChevronDown' : 'ChevronRight'} size={16} />
            <span>Bank Address (Optional)</span>
          </button>
          {showBankAddress && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pl-6">
              <Input
                label="Address Line 1"
                value={formData?.bankAddressLine1}
                onChange={(e) => handleInputChange('bankAddressLine1', e?.target?.value)}
                disabled={!isEditing}
              />
              <Input
                label="Address Line 2"
                value={formData?.bankAddressLine2}
                onChange={(e) => handleInputChange('bankAddressLine2', e?.target?.value)}
                disabled={!isEditing}
                description="Optional"
              />
              <Input
                label="City"
                value={formData?.bankAddressCity}
                onChange={(e) => handleInputChange('bankAddressCity', e?.target?.value)}
                disabled={!isEditing}
              />
              <Select
                label="Country"
                options={countryOptions}
                value={formData?.bankAddressCountry}
                onChange={(value) => handleInputChange('bankAddressCountry', value)}
                disabled={!isEditing}
                searchable={true}
              />
            </div>
          )}
        </div>

        {/* Security Notice */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mt-6">
          <p className="text-sm text-blue-900 dark:text-blue-300 flex items-start gap-2">
            <Icon name="Lock" size={16} className="flex-shrink-0 mt-0.5" />
            <span>Banking information is encrypted and visible only to authorised personnel.</span>
          </p>
        </div>

        {isEditing && (
          <div className="flex justify-end gap-3 mt-6">
            <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </div>
        )}
      </div>
    );
  };

  const renderPreferences = () => {
    const dietaryOptions = [
      { value: 'None / No restrictions', label: 'None / No restrictions' },
      { value: 'Vegan', label: 'Vegan' },
      { value: 'Vegetarian', label: 'Vegetarian' },
      { value: 'Pescatarian', label: 'Pescatarian' },
      { value: 'Halal', label: 'Halal' },
      { value: 'Kosher', label: 'Kosher' },
      { value: 'Gluten-free', label: 'Gluten-free' },
      { value: 'Dairy-free / Lactose-free', label: 'Dairy-free / Lactose-free' },
      { value: 'Nut-free', label: 'Nut-free' },
      { value: 'Shellfish-free', label: 'Shellfish-free' },
      { value: 'Egg-free', label: 'Egg-free' },
      { value: 'Soy-free', label: 'Soy-free' },
      { value: 'Low carb / Keto', label: 'Low carb / Keto' },
      { value: 'Paleo', label: 'Paleo' },
      { value: 'Diabetic-friendly / Low sugar', label: 'Diabetic-friendly / Low sugar' },
      { value: 'Low sodium', label: 'Low sodium' },
      { value: 'Low FODMAP', label: 'Low FODMAP' },
      { value: 'Religious restriction (Other)', label: 'Religious restriction (Other)' },
      { value: 'Medical restriction (Other)', label: 'Medical restriction (Other)' },
      { value: 'Other (free text)', label: 'Other (free text)' }
    ];

    const alcoholicOptions = [
      { value: 'Wine', label: 'Wine' },
      { value: 'Spirits', label: 'Spirits' },
      { value: 'Beer', label: 'Beer' },
      { value: 'None', label: 'None' }
    ];

    const handleSurpriseMe = () => {
      handleInputChange('cakePreference', "Chef's choice");
      setCakeSurprise(true);
      setTimeout(() => setCakeSurprise(false), 2000);
    };

    return (
      <div className="space-y-6">
        {/* 1. Dietary Restrictions */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <h3 className="text-xl font-semibold text-foreground mb-6">Dietary Restrictions</h3>
          <div className="space-y-4">
            <Select
              label="Dietary category"
              options={dietaryOptions}
              value={formData?.dietaryCategory}
              onChange={(value) => handleInputChange('dietaryCategory', value)}
              disabled={!isEditing}
              searchable={true}
            />
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Additional notes</label>
              <textarea
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px]"
                value={formData?.dietaryNotes}
                onChange={(e) => handleInputChange('dietaryNotes', e?.target?.value)}
                disabled={!isEditing}
                placeholder="e.g. allergies, intolerances"
              />
            </div>
          </div>
        </div>

        {/* 2. Birthday Cake Preference */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold text-foreground">Birthday Cake Preference</h3>
            {isEditing && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSurpriseMe}
                iconName="Sparkles"
              >
                Surprise me
              </Button>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">Cake preference</label>
            <Input
              value={formData?.cakePreference}
              onChange={(e) => handleInputChange('cakePreference', e?.target?.value)}
              disabled={!isEditing}
              placeholder="e.g. Chocolate cake, vanilla sponge"
            />
            {cakeSurprise && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-2 flex items-center gap-1">
                <Icon name="Check" size={12} />
                Surprise option selected!
              </p>
            )}
          </div>
        </div>

        {/* 3. Favourite Meals */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <h3 className="text-xl font-semibold text-foreground mb-6">Favourite Meals</h3>
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">Favourite meals</label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[100px]"
              value={formData?.favouriteMeals}
              onChange={(e) => handleInputChange('favouriteMeals', e?.target?.value)}
              disabled={!isEditing}
              placeholder="e.g. Italian pasta, fresh seafood, Asian stir-fry"
            />
          </div>
        </div>

        {/* 4. Favourite Snacks */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <h3 className="text-xl font-semibold text-foreground mb-6">Favourite Snacks</h3>
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">Favourite snacks</label>
            <textarea
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[100px]"
              value={formData?.favouriteSnacks}
              onChange={(e) => handleInputChange('favouriteSnacks', e?.target?.value)}
              disabled={!isEditing}
              placeholder="e.g. Fresh fruit, nuts, chocolate"
            />
          </div>
        </div>

        {/* 5. Favourite Drinks */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <h3 className="text-xl font-semibold text-foreground mb-6">Favourite Drinks</h3>
          <div className="space-y-4">
            <Select
              label="Alcoholic preference"
              options={alcoholicOptions}
              value={formData?.alcoholicPreference}
              onChange={(value) => handleInputChange('alcoholicPreference', value)}
              disabled={!isEditing}
            />
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Non-alcoholic preferences</label>
              <textarea
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px]"
                value={formData?.nonAlcoholicPreferences}
                onChange={(e) => handleInputChange('nonAlcoholicPreferences', e?.target?.value)}
                disabled={!isEditing}
                placeholder="e.g. sparkling water brand, juices, teas, coffee order"
              />
            </div>
          </div>
        </div>

        {/* Single Save/Cancel buttons at bottom */}
        {isEditing && (
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </div>
        )}
      </div>
    );
  };

  const handleConfirmMonth = () => {
    if (!crewId) return;
    
    const year = horCurrentMonth?.getFullYear();
    const month = horCurrentMonth?.getMonth();
    
    const confirmed = confirmMonth(crewId, year, month);
    if (confirmed) {
      showToast('Month confirmed successfully', 'success');
      loadHORData();
    } else {
      showToast('Failed to confirm month', 'error');
    }
  };

  const renderHOR = () => {
    // Check if user is Command
    const isCommand = currentUser?.tier === PermissionTier?.COMMAND;

    // Use real data from storage
    const last24HoursRest = horData?.last24HoursRest || 24;
    const last7DaysRest = horData?.last7DaysRest || 168;
    const isCompliant = horData?.isCompliant !== false;

    const breaches = horData?.breaches || [];

    const getDaysInMonth = (date) => {
      const year = date?.getFullYear();
      const month = date?.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay?.getDate();
      const startingDayOfWeek = firstDay?.getDay();
      return { daysInMonth, startingDayOfWeek, year, month };
    };

    const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(horCurrentMonth);
    const monthName = horCurrentMonth?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const calendarData = horData?.calendarData || [];

    // Get month status
    const monthStatus = getMonthStatus(crewId, year, month);

    const handleDateClick = (day, dayData) => {
      const dateStr = dayData?.date;
      if (!dateStr) return;
      
      // Get work entries for this date
      const entries = getCrewWorkEntries(crewId);
      const dateEntries = entries?.filter(entry => entry?.date === dateStr);
      
      setSelectedCalendarDate({
        date: dateStr,
        day,
        restHours: dayData?.restHours || 24,
        workHours: 24 - (dayData?.restHours || 24),
        entries: dateEntries,
        status: dayData?.status
      });
    };

    const handleEditDate = () => {
      if (!selectedCalendarDate) return;
      // Open quick entry modal with this date pre-selected
      setShowEditDateModal(true);
    };

    const handleDeleteDate = () => {
      if (!selectedCalendarDate) return;
      
      // Confirm deletion
      const confirmed = window.confirm(
        `Are you sure you want to delete all work entries for ${new Date(selectedCalendarDate?.date)?.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        })}?\n\nThis action cannot be undone.`
      );
      
      if (!confirmed) return;
      
      // Delete entries for this date
      deleteWorkEntriesForDate(crewId, selectedCalendarDate?.date);
      
      // Reload HOR data
      loadHORData();
      
      // Clear selection
      setSelectedCalendarDate(null);
      
      showToast('Work entries deleted successfully', 'success');
    };

    const handleMonthChange = (direction) => {
      const newMonth = new Date(horCurrentMonth.getFullYear(), horCurrentMonth.getMonth() + direction, 1);
      setHorCurrentMonth(newMonth);
      setSelectedCalendarDate(null);
      // Reload data for new month
      setTimeout(() => loadHORData(), 100);
    };

    const handleSaveWorkEntries = (entries) => {
      if (!crewId || !entries || entries?.length === 0) return;

      // Get year and month from the first entry
      const firstDate = new Date(entries?.[0]?.date);
      const year = firstDate?.getFullYear();
      const month = firstDate?.getMonth();

      // Save work entries to storage
      addWorkEntries(crewId, entries);

      // Reload HOR data to reflect changes
      loadHORData();

      setShowQuickEntry(false);
      setShowEditDateModal(false);
      setSelectedHORDates([]);

      // Check for breached dates
      const savedDates = entries?.map(e => e?.date);
      const breaches = detectBreachedDatesAfterSave(crewId, savedDates, year, month);

      // Filter out dates that already have notes
      const breachesNeedingNotes = breaches?.filter(breach =>
        !hasBreachNoteForDate(crewId, breach?.date)
      );

      if (breachesNeedingNotes?.length > 0) {
        // Show breach notes modal
        setBreachedDates(breachesNeedingNotes);
        setShowBreachNotesModal(true);
      } else {
        showToast('Work entries saved successfully', 'success');
      }
    };

    const handleRunTests = () => {
      console.clear();
      const results = runAllHORTests(crewId);
      const totalTests = Object.keys(results)?.length;
      const passedTests = Object.values(results)?.filter(r => r)?.length;
      
      if (passedTests === totalTests) {
        showToast(`All ${totalTests} HOR validation tests passed!`, 'success');
      } else {
        showToast(`${passedTests}/${totalTests} tests passed. Check console for details.`, 'error');
      }
      
      // Reload data after tests
      setTimeout(() => loadHORData(), 500);
    };

    return (
      <div className="space-y-6">
        {/* Title */}
        <div>
          <h3 className="text-2xl font-semibold text-foreground">Hours of Rest (HOR)</h3>
          <p className="text-sm text-muted-foreground mt-1">Fast monitoring view of rest compliance</p>
        </div>
        {/* Command-Only Toggle */}
        {isCommand && (
          <div className="bg-card border border-border rounded-xl p-2 inline-flex gap-2">
            <button
              onClick={() => setHorView('my')}
              className={`px-6 py-2 rounded-lg text-sm font-medium transition-smooth ${
                horView === 'my' ?'bg-primary text-primary-foreground' :'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              My HOR
            </button>
            <button
              onClick={() => setHorView('vessel')}
              className={`px-6 py-2 rounded-lg text-sm font-medium transition-smooth ${
                horView === 'vessel' ?'bg-primary text-primary-foreground' :'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              Vessel HOR
            </button>
          </div>
        )}
        {/* Conditional Rendering */}
        {horView === 'vessel' && isCommand ? (
          <VesselHORDashboard 
            currentMonth={horCurrentMonth}
            onMonthChange={setHorCurrentMonth}
          />
        ) : (
          // My HOR View (existing)
          (<>
            {/* Month Status & Confirm Button */}
            <div className="flex items-center justify-between bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-foreground">Month Status:</span>
                <span className={`inline-block px-3 py-1.5 rounded-full text-xs font-semibold ${
                  monthStatus?.status === 'Locked' ? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400' :
                  monthStatus?.status === 'Confirmed by Crew'? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                }`}>
                  {monthStatus?.status}
                </span>
              </div>
              {!monthStatus?.confirmed && !monthStatus?.locked && (
                <Button onClick={handleConfirmMonth}>
                  <Icon name="CheckCircle" size={18} />
                  Confirm Month
                </Button>
              )}
            </div>
            {/* Top Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Card 1: Last 24 Hours Rest */}
              <div className="bg-card border border-border rounded-xl p-6">
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Last 24 Hours Rest</h4>
                <div className="text-4xl font-bold text-foreground mb-2">{last24HoursRest} hrs</div>
                <div className="flex items-center gap-2">
                  <Icon 
                    name={last24HoursRest >= 10 ? 'CheckCircle' : 'AlertCircle'} 
                    size={16} 
                    className={last24HoursRest >= 10 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
                  />
                  <span className={`text-sm font-medium ${
                    last24HoursRest >= 10 
                      ? 'text-green-600 dark:text-green-400' :'text-red-600 dark:text-red-400'
                  }`}>
                    {last24HoursRest >= 10 ? 'Compliant' : 'Breach'}
                  </span>
                </div>
              </div>

              {/* Card 2: Last 7 Days Rest */}
              <div className="bg-card border border-border rounded-xl p-6">
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Last 7 Days Rest</h4>
                <div className="text-4xl font-bold text-foreground mb-2">{last7DaysRest} hrs</div>
                <div className="flex items-center gap-2">
                  <Icon 
                    name={last7DaysRest >= 77 ? 'CheckCircle' : 'AlertCircle'} 
                    size={16} 
                    className={last7DaysRest >= 77 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}
                  />
                  <span className={`text-sm font-medium ${
                    last7DaysRest >= 77 
                      ? 'text-green-600 dark:text-green-400' :'text-red-600 dark:text-red-400'
                  }`}>
                    {last7DaysRest >= 77 ? 'Compliant' : 'Breach'}
                  </span>
                </div>
              </div>

              {/* Card 3: Compliance Status */}
              <div className="bg-card border border-border rounded-xl p-6">
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Compliance Status</h4>
                <div className="flex items-center justify-center h-[calc(100%-2rem)]">
                  <span className={`inline-block px-6 py-3 rounded-full text-lg font-bold ${
                    isCompliant 
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                  }`}>
                    {isCompliant ? 'COMPLIANT' : 'NON-COMPLIANT'}
                  </span>
                </div>
              </div>
            </div>
            {/* Calendar and Detail Section */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
              {/* Calendar Section */}
              <div className="bg-card border border-border rounded-xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <h4 className="text-lg font-semibold text-foreground">Calendar</h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleMonthChange(-1)}
                      className="p-2 hover:bg-muted rounded-lg transition-smooth"
                    >
                      <Icon name="ChevronLeft" size={18} className="text-foreground" />
                    </button>
                    <span className="text-sm font-medium text-foreground min-w-[140px] text-center">{monthName}</span>
                    <button
                      onClick={() => handleMonthChange(1)}
                      className="p-2 hover:bg-muted rounded-lg transition-smooth"
                    >
                      <Icon name="ChevronRight" size={18} className="text-foreground" />
                    </button>
                  </div>
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-2">
                  {/* Day Headers */}
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']?.map((day, index) => (
                    <div key={index} className="text-center text-xs font-semibold text-muted-foreground py-2">
                      {day}
                    </div>
                  ))}

                  {/* Empty cells for days before month starts */}
                  {Array.from({ length: startingDayOfWeek })?.map((_, index) => (
                    <div key={`empty-${index}`} className="aspect-square" />
                  ))}

                  {/* Calendar days */}
                  {Array.from({ length: daysInMonth })?.map((_, index) => {
                    const day = index + 1;
                    const dayData = calendarData?.find(d => d?.day === day);
                    const restHours = dayData?.restHours || 24;
                    const status = dayData?.status || 'compliant';
                    const isSelected = selectedCalendarDate?.day === day;

                    // Color based on status
                    let bgColor = 'bg-green-100 dark:bg-green-900/30';
                    let textColor = 'text-green-800 dark:text-green-400';
                    if (status === 'breach') {
                      bgColor = 'bg-red-100 dark:bg-red-900/30';
                      textColor = 'text-red-800 dark:text-red-400';
                    } else if (status === 'warning') {
                      bgColor = 'bg-amber-100 dark:bg-amber-900/30';
                      textColor = 'text-amber-800 dark:text-amber-400';
                    }

                    return (
                      <button
                        key={day}
                        onClick={() => handleDateClick(day, dayData)}
                        className={`${bgColor} rounded-lg p-3 text-center cursor-pointer hover:opacity-80 transition-smooth ${
                          isSelected ? 'ring-2 ring-primary ring-offset-2' : ''
                        }`}
                      >
                        <div className="text-xs font-semibold text-foreground mb-1">{day}</div>
                        <div className={`text-sm font-bold ${textColor}`}>{restHours?.toFixed(1)} hrs</div>
                      </button>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex items-center gap-6 mt-6 pt-4 border-t border-border">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800" />
                    <span className="text-xs text-muted-foreground">Compliant</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800" />
                    <span className="text-xs text-muted-foreground">Warning</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800" />
                    <span className="text-xs text-muted-foreground">Breach</span>
                  </div>
                </div>
              </div>

              {/* Date Detail / Breaches Panel */}
              <div className="bg-card border border-border rounded-xl p-6 flex flex-col">
                {selectedCalendarDate ? (
                  // Show selected date details
                  (<>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-lg font-semibold text-foreground">Date Details</h4>
                      <button
                        onClick={() => setSelectedCalendarDate(null)}
                        className="p-1.5 hover:bg-muted rounded-lg transition-smooth"
                      >
                        <Icon name="X" size={16} className="text-muted-foreground" />
                      </button>
                    </div>
                    <div className="space-y-4 flex-1">
                      {/* Date Info */}
                      <div className="bg-muted/30 rounded-lg p-4">
                        <div className="text-sm text-muted-foreground mb-1">Date</div>
                        <div className="text-lg font-semibold text-foreground">
                          {new Date(selectedCalendarDate?.date)?.toLocaleDateString('en-GB', { 
                            day: 'numeric', 
                            month: 'long', 
                            year: 'numeric' 
                          })}
                        </div>
                      </div>

                      {/* Rest Hours */}
                      <div className="bg-muted/30 rounded-lg p-4">
                        <div className="text-sm text-muted-foreground mb-1">Rest Hours</div>
                        <div className="text-2xl font-bold text-foreground">
                          {selectedCalendarDate?.restHours?.toFixed(1)} hrs
                        </div>
                      </div>

                      {/* Work Hours */}
                      <div className="bg-muted/30 rounded-lg p-4">
                        <div className="text-sm text-muted-foreground mb-1">Work Hours</div>
                        <div className="text-2xl font-bold text-foreground">
                          {selectedCalendarDate?.workHours?.toFixed(1)} hrs
                        </div>
                      </div>

                      {/* Status */}
                      <div className="bg-muted/30 rounded-lg p-4">
                        <div className="text-sm text-muted-foreground mb-2">Status</div>
                        <span className={`inline-block px-3 py-1.5 rounded-full text-xs font-semibold ${
                          selectedCalendarDate?.status === 'compliant' ?'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : selectedCalendarDate?.status === 'warning' ?'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' :'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                        }`}>
                          {selectedCalendarDate?.status === 'compliant' ? 'Compliant' :
                           selectedCalendarDate?.status === 'warning' ? 'Warning' : 'Breach'}
                        </span>
                      </div>
                    </div>
                    {/* Edit Button */}
                    <div className="mt-4 pt-4 border-t border-border">
                      <Button
                        variant="outline"
                        fullWidth
                        iconName="Edit"
                        onClick={handleEditDate}
                      >
                        Edit Date
                      </Button>
                      <Button
                        variant="outline"
                        fullWidth
                        iconName="Trash2"
                        onClick={handleDeleteDate}
                        className="mt-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        Delete All Entries
                      </Button>
                    </div>
                  </>)
                ) : (
                  // Show breaches list when no date selected
                  (<>
                    <h4 className="text-lg font-semibold text-foreground mb-4">Breaches</h4>
                    <div className="flex-1 space-y-3 overflow-y-auto max-h-[500px]">
                      {breaches?.length > 0 ? (
                        breaches?.map(breach => (
                          <div key={breach?.id} className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                              <Icon name="AlertCircle" size={18} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <div className="text-xs font-medium text-muted-foreground mb-1">
                                  Window: {breach?.windowStart} → {breach?.windowEnd}
                                </div>
                                <div className="text-sm font-semibold text-red-800 dark:text-red-300 mb-1">{breach?.type}</div>
                                <div className="text-xs text-muted-foreground">{breach?.note}</div>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-8">
                          <Icon name="CheckCircle" size={32} className="text-green-600 dark:text-green-400 mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">No breaches recorded</p>
                        </div>
                      )}
                    </div>
                    {/* Quick Entry Button */}
                    <div className="mt-4 pt-4 border-t border-border">
                      <Button 
                        variant="default" 
                        fullWidth 
                        iconName="Plus"
                        onClick={() => setShowQuickEntry(true)}
                      >
                        Add Entry
                      </Button>
                    </div>
                  </>)
                )}
              </div>
            </div>
          </>)
        )}
      </div>
    );
  };

  const renderSeaTime = () => {
    return (
      <SeaTimeTracker userId={crewId} currentUser={currentUser} />
    );
  };

  const renderContent = () => {
    switch (activeSection) {
      case 'personal':
        return renderPersonalDetails();
      case 'emergency':
        return renderEmergencyContact();
      case 'banking':
        return renderBanking();
      case 'preferences':
        return renderPreferences();
      case 'hor':
        return renderHOR();
      case 'seatime':
        return renderSeaTime();
      default:
        return renderPersonalDetails();
    }
  };

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />

      {import.meta.env.DEV && (
        <div className="bg-yellow-100 dark:bg-yellow-900/30 border-b border-yellow-300 dark:border-yellow-700 px-6 py-3">
          <div className="max-w-[1800px] mx-auto">
            <p className="text-sm font-mono text-yellow-900 dark:text-yellow-200">
              <strong>DEBUG:</strong> authLoading={String(authLoading)} | session.user.id={session?.user?.id || 'null'} | crewId={crewId || 'null'}
            </p>
          </div>
        </div>
      )}
      
      {/* Auth Loading State */}
      {authLoading && (
        <main className="p-6 max-w-[1800px] mx-auto">
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Checking authentication...</p>
            </div>
          </div>
        </main>
      )}

      {/* Signed Out State */}
      {!authLoading && !session?.user && (
        <main className="p-6 max-w-[1800px] mx-auto">
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center">
              <Icon name="AlertCircle" size={32} className="text-warning" />
            </div>
            <h2 className="text-2xl font-semibold text-foreground">Not Signed In</h2>
            <p className="text-muted-foreground text-center max-w-md">
              You need to be signed in to view this profile.
            </p>
            <Button
              onClick={() => navigate('/login-authentication')}
              variant="primary"
              className="mt-4"
            >
              <Icon name="LogIn" size={16} />
              Sign In
            </Button>
          </div>
        </main>
      )}
      
      {/* Error State - Show full page error without redirect */}
      {!authLoading && session?.user && profileError && (
        <main className="p-6 max-w-[1800px] mx-auto">
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center">
              <Icon name="AlertCircle" size={32} className="text-error" />
            </div>
            <h2 className="text-2xl font-semibold text-foreground">Profile Not Found</h2>
            <p className="text-muted-foreground text-center max-w-md">
              {profileError}
            </p>
            <Button
              onClick={() => navigate('/dashboard')}
              variant="primary"
              className="mt-4"
            >
              <Icon name="Home" size={16} />
              Return to Dashboard
            </Button>
          </div>
        </main>
      )}

      {/* Loading State */}
      {!authLoading && session?.user && !profileLoading && !profileError && crewMember && (
        <main className="p-6 max-w-[1800px] mx-auto">
          {/* Hidden File Input for Avatar Upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarUpload}
            className="hidden"
          />
          
          {/* Back Button */}
          <button
            onClick={() => navigate('/crew-management')}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-smooth"
          >
            <Icon name="ChevronLeft" size={16} />
            Back to Crew Management
          </button>

          {/* Header Area */}
          {renderHeader()}

          {/* Main Layout: Left Navigation + Content */}
          <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr] gap-6">
            {/* Left Navigation */}
            <div className="bg-card border border-border rounded-2xl p-4">
              <nav className="space-y-1">
                {navigationSections?.map(section => (
                  <button
                    key={section?.key}
                    onClick={() => {
                      setActiveSection(section?.key);
                      setIsEditing(false);
                    }}
                    className={`w-full flex items-start gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-smooth text-left ${
                      activeSection === section?.key
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    <Icon name={section?.icon} size={18} className="text-primary" />
                    <span className="leading-tight break-words">{section?.label}</span>
                  </button>
                ))}
              </nav>
            </div>

            {/* Main Content */}
            <div>
              {renderContent()}
            </div>
          </div>
          
          {/* Quick Entry Modal */}
          <QuickEntryModal
            isOpen={showQuickEntry}
            onClose={() => {
              setShowQuickEntry(false);
              setSelectedHORDates([]);
            }}
            selectedDates={selectedHORDates}
            initialDate={null}
            onSave={(entries) => {
              const year = horCurrentMonth?.getFullYear();
              const month = horCurrentMonth?.getMonth();
              
              // Check if month is editable
              if (!isMonthEditable(crewId, year, month)) {
                showToast('Cannot edit locked month', 'error');
                return;
              }
              
              // Save work entries
              addWorkEntries(crewId, entries);
              loadHORData();
              setShowQuickEntry(false);
              setSelectedHORDates([]);
              
              // Check for breached dates
              const savedDates = entries?.map(e => e?.date);
              const breaches = detectBreachedDatesAfterSave(crewId, savedDates, year, month);
              
              // Filter out dates that already have notes
              const breachesNeedingNotes = breaches?.filter(breach => 
                !hasBreachNoteForDate(crewId, breach?.date)
              );
              
              if (breachesNeedingNotes?.length > 0) {
                // Show breach notes modal
                setBreachedDates(breachesNeedingNotes);
                setShowBreachNotesModal(true);
              } else {
                showToast('Work entries saved successfully', 'success');
              }
            }}
          />
          {/* Edit Date Modal */}
          {showEditDateModal && selectedCalendarDate && (
            <QuickEntryModal
              isOpen={showEditDateModal}
              onClose={() => {
                setShowEditDateModal(false);
              }}
              onSave={handleSaveWorkEntries}
              initialDate={selectedCalendarDate?.date}
              crewId={crewId}
            />
          )}

          {/* Breach Notes Modal */}
          {showBreachNotesModal && (
            <BreachNotesModal
              isOpen={showBreachNotesModal}
              onClose={() => {
                setShowBreachNotesModal(false);
                setBreachedDates([]);
                showToast('Work entries saved successfully', 'success');
              }}
              breachedDates={breachedDates}
              userId={crewId}
              currentUserId={currentUser?.id}
            />
          )}
        </main>
      )}
    </div>
  );
};

export default CrewProfile;
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { Checkbox } from '../../components/ui/Checkbox';
import Icon from '../../components/AppIcon';
import { AlertCircle, Edit2, Upload } from 'lucide-react';
import LocationsManagementSettings from '../locations-management-settings';

import RoleManagement from '../crew-management/components/RoleManagement';
import { useAuth } from '../../contexts/AuthContext';
import { logActivity } from '../../utils/activityStorage';

const VesselSettings = () => {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();

  // Hub navigation state
  const [activeSection, setActiveSection] = useState('vessel-profile');

  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [vesselData, setVesselData] = useState(null);
  const [tenantId, setTenantId] = useState(null);
  const [userRole, setUserRole] = useState(null);
  
  const isSavingRef = useRef(false);
  
  // VIEW/EDIT MODE STATE
  const [viewMode, setViewMode] = useState(true);
  
  const [formInitialized, setFormInitialized] = useState(false);
  
  // Form state - expanded fields (mapped to vessels table)
  const [formState, setFormState] = useState({
    // Vessel Identity
    vessel_type_label: '',
    flag: '',
    port_of_registry: '',
    imo_number: '',
    official_number: '',
    loa_m: '',
    gt: '',
    year_built: '',
    year_refit: '',
    
    // Operational Profile
    commercial_status: '',
    certified_commercial: false,
    area_of_operation: '',
    operating_regions: '',
    seasonal_pattern: '',
    typical_guest_count: '',
    typical_crew_count: '',
    
    // Compliance & Structure
    ism_applicable: false,
    isps_applicable: false,
    
    // Cargo Configuration
    departments_in_use: [],
    bonded_stores_enabled: false,
    multi_location_storage: false,
    
    // Dashboard Hero Image
    hero_image_url: '',
    use_custom_hero: false
  });
  
  // Store last loaded data for Cancel functionality
  const lastLoadedVessel = useRef(null);

  // Vessel type options
  const vesselTypeOptions = [
    { value: 'Motor Yacht', label: 'Motor Yacht' },
    { value: 'Sailing Yacht', label: 'Sailing Yacht' },
    { value: 'Catamaran', label: 'Catamaran' },
    { value: 'Explorer', label: 'Explorer' },
    { value: 'Sport Yacht', label: 'Sport Yacht' },
    { value: 'Superyacht', label: 'Superyacht' }
  ];

  const commercialStatusOptions = [
    { value: 'Private', label: 'Private' },
    { value: 'Commercial', label: 'Commercial' },
    { value: 'Charter', label: 'Charter' },
    { value: 'Dual', label: 'Dual' }
  ];

  const areaOfOperationOptions = [
    { value: 'Coastal', label: 'Coastal' },
    { value: 'Near Coastal', label: 'Near Coastal' },
    { value: 'Unlimited', label: 'Unlimited' }
  ];

  const departmentOptions = [
    { value: 'Interior', label: 'Interior' },
    { value: 'Galley', label: 'Galley' },
    { value: 'Deck', label: 'Deck' },
    { value: 'Engineering', label: 'Engineering' },
    { value: 'Shore', label: 'Shore' }
  ];

  // Check if user has COMMAND role
  const role = userRole?.toUpperCase();
  const canEdit = role === 'COMMAND';

  useEffect(() => {
    loadVesselSettings();
  }, []);

  useEffect(() => {
    if (vesselData && !formInitialized) {
      console.log('[VESSEL SETTINGS] Loading vessel data:', vesselData);
      
      // Parse departments_in_use from text to array
      let departmentsArray = [];
      if (vesselData?.departments_in_use) {
        try {
          departmentsArray = JSON.parse(vesselData.departments_in_use);
        } catch {
          departmentsArray = vesselData.departments_in_use.split(',').map(d => d.trim()).filter(Boolean);
        }
      }

      const initialFormData = {
        vessel_type_label: vesselData?.vessel_type_label || '',
        flag: vesselData?.flag || '',
        port_of_registry: vesselData?.port_of_registry || '',
        imo_number: vesselData?.imo_number || '',
        official_number: vesselData?.official_number || '',
        loa_m: vesselData?.loa_m || '',
        gt: vesselData?.gt || '',
        year_built: vesselData?.year_built || '',
        year_refit: vesselData?.year_refit || '',
        commercial_status: vesselData?.commercial_status || '',
        certified_commercial: vesselData?.certified_commercial || false,
        area_of_operation: vesselData?.area_of_operation || '',
        operating_regions: vesselData?.operating_regions || '',
        seasonal_pattern: vesselData?.seasonal_pattern || '',
        typical_guest_count: vesselData?.typical_guest_count || '',
        typical_crew_count: vesselData?.typical_crew_count || '',
        ism_applicable: vesselData?.ism_applicable || false,
        isps_applicable: vesselData?.isps_applicable || false,
        departments_in_use: departmentsArray,
        bonded_stores_enabled: vesselData?.bonded_stores_enabled || false,
        multi_location_storage: vesselData?.multi_location_storage || false,
        hero_image_url: vesselData?.hero_image_url || '',
        use_custom_hero: vesselData?.use_custom_hero || false
      };

      console.log('[VESSEL SETTINGS] Initialized formState:', initialFormData);
      setFormState(initialFormData);
      lastLoadedVessel.current = initialFormData;
      setFormInitialized(true);
    }
  }, [vesselData, formInitialized]);

  const loadVesselSettings = async () => {
    try {
      setLoading(true);
      setSaveError('');
      
      // Step 1: Get session
      const { data: { session }, error: sessionError } = await supabase?.auth?.getSession();

      if (sessionError) {
        console.error('[VESSEL SETTINGS] Session error:', sessionError);
        setSaveError(`Session error: ${sessionError?.message || 'Unable to verify authentication'}`);
        setLoading(false);
        return;
      }

      if (!session || !session?.user?.id) {
        console.warn('[VESSEL SETTINGS] No active session');
        setSaveError('No active session. Please log in.');
        setLoading(false);
        return;
      }

      // Step 2: Get tenant context
      let contextData = null;
      try {
        const { data: rpcData, error: rpcError } = await supabase?.rpc('get_my_context');

        if (rpcError) {
          console.error('[VESSEL SETTINGS] RPC error:', rpcError);
          setSaveError(`Failed to load vessel context: ${rpcError?.message || 'Unknown error'}`);
          setLoading(false);
          return;
        }

        contextData = rpcData?.[0] || {};
      } catch (rpcException) {
        console.error('[VESSEL SETTINGS] RPC exception:', rpcException);
        setSaveError(`Error loading vessel context: ${rpcException?.message || 'Unexpected error'}`);
        setLoading(false);
        return;
      }

      const contextTenantId = contextData?.tenant_id;
      if (!contextTenantId) {
        console.warn('[VESSEL SETTINGS] No tenant_id in context');
        setSaveError('No active vessel access');
        setLoading(false);
        return;
      }

      const role = contextData?.role || 'CREW';
      setUserRole(role);
      setTenantId(contextTenantId);

      // Step 3: Fetch vessel row from public.vessels by tenant_id
      const { data: vesselRow, error: vesselFetchError } = await supabase
        ?.from('vessels')
        ?.select('*')
        ?.eq('tenant_id', contextTenantId)
        ?.maybeSingle();

      if (vesselFetchError) {
        console.error('[VESSEL SETTINGS] Vessel fetch error:', vesselFetchError);
        setSaveError(`Failed to load vessel: ${vesselFetchError?.message || 'Unknown error'}`);
        setLoading(false);
        return;
      }

      // Step 4: If no vessel row exists, create it silently with upsert BEFORE showing form
      if (!vesselRow) {
        console.log('[VESSEL SETTINGS] No vessel row found, creating one for tenant_id:', contextTenantId);
        
        const { data: upsertedRow, error: upsertError } = await supabase
          ?.from('vessels')
          ?.upsert({ tenant_id: contextTenantId }, { onConflict: 'tenant_id' })
          ?.select()
          ?.single();

        if (upsertError) {
          console.error('[VESSEL SETTINGS] Failed to create vessel row:', upsertError);
          setSaveError(`Failed to initialize vessel: ${upsertError?.message || 'Unknown error'}`);
          setLoading(false);
          return;
        }

        console.log('[VESSEL SETTINGS] Vessel row created:', upsertedRow);
        setVesselData(upsertedRow);
      } else {
        console.log('[VESSEL SETTINGS] Vessel record loaded:', vesselRow);
        setVesselData(vesselRow);
      }

      setLoading(false);
    } catch (err) {
      console.error('[VESSEL SETTINGS] Unexpected error:', err);
      setSaveError(`Unexpected error: ${err?.message || 'Something went wrong'}`);
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormState(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleDepartmentToggle = (dept) => {
    setFormState(prev => {
      const currentDepts = prev?.departments_in_use || [];
      const isSelected = currentDepts?.includes(dept);
      const newDepts = isSelected
        ? currentDepts?.filter(d => d !== dept)
        : [...currentDepts, dept];
      return { ...prev, departments_in_use: newDepts };
    });
  };

  const handleSave = async () => {
    if (isSavingRef.current) {
      console.log('[VESSEL SETTINGS] Save already in progress, ignoring duplicate call');
      return;
    }

    isSavingRef.current = true;
    setSaving(true);
    setSaveError('');

    try {
      console.log('[VESSEL SETTINGS] Starting save...');

      if (!tenantId) {
        setSaveError('No tenant ID available');
        setSaving(false);
        isSavingRef.current = false;
        return;
      }

      // Prepare payload
      const payload = {
        tenant_id: tenantId,
        vessel_type_label: formState?.vessel_type_label || null,
        flag: formState?.flag || null,
        port_of_registry: formState?.port_of_registry || null,
        imo_number: formState?.imo_number || null,
        official_number: formState?.official_number || null,
        loa_m: formState?.loa_m ? parseFloat(formState?.loa_m) : null,
        gt: formState?.gt ? parseInt(formState?.gt, 10) : null,
        year_built: formState?.year_built ? parseInt(formState?.year_built, 10) : null,
        year_refit: formState?.year_refit ? parseInt(formState?.year_refit, 10) : null,
        commercial_status: formState?.commercial_status || null,
        certified_commercial: formState?.certified_commercial || false,
        area_of_operation: formState?.area_of_operation || null,
        operating_regions: formState?.operating_regions || null,
        seasonal_pattern: formState?.seasonal_pattern || null,
        typical_guest_count: formState?.typical_guest_count ? parseInt(formState?.typical_guest_count, 10) : null,
        typical_crew_count: formState?.typical_crew_count ? parseInt(formState?.typical_crew_count, 10) : null,
        ism_applicable: formState?.ism_applicable || false,
        isps_applicable: formState?.isps_applicable || false,
        departments_in_use: JSON.stringify(formState?.departments_in_use || []),
        bonded_stores_enabled: formState?.bonded_stores_enabled || false,
        multi_location_storage: formState?.multi_location_storage || false,
        hero_image_url: formState?.hero_image_url || null,
        use_custom_hero: formState?.use_custom_hero || false
      };

      // Check if required fields are filled for onboarding completion
      const requiredFieldsFilled = 
        payload?.vessel_type_label &&
        payload?.flag &&
        payload?.port_of_registry &&
        (payload?.gt || payload?.loa_m);

      if (requiredFieldsFilled) {
        payload.onboarding_status = 'READY';
        payload.setup_completed_at = new Date().toISOString();
      } else {
        payload.onboarding_status = 'SETUP_REQUIRED';
      }

      console.log('[VESSEL UPSERT SENT]', payload);

      const { data, error } = await supabase
        ?.from('vessels')
        ?.upsert(payload, { onConflict: 'tenant_id' })
        ?.select()
        ?.single();

      if (error) {
        console.error('[VESSEL UPSERT FAILED]', error);
        setSaveError(`Save failed: ${error?.message || 'Unknown error'}`);
        setSaving(false);
        isSavingRef.current = false;
        return;
      }

      console.log('[VESSEL UPSERT OK]', data);
      setVesselData(data);
      lastLoadedVessel.current = { ...formState };
      setViewMode(true);

      // Log to activity feed
      logActivity({
        module: 'vessel_settings',
        action: 'VESSEL_SETTINGS_UPDATED',
        entityType: 'vessel',
        entityId: tenantId,
        summary: 'Vessel settings updated',
        meta: { vesselType: payload?.vessel_type_label, flag: payload?.flag }
      });

      setSaving(false);
      isSavingRef.current = false;
    } catch (err) {
      console.error('[VESSEL SETTINGS] Save exception:', err);
      setSaveError(`Unexpected error: ${err?.message || 'Something went wrong'}`);
      setSaving(false);
      isSavingRef.current = false;
    }
  };

  const handleCancel = () => {
    if (lastLoadedVessel.current) {
      setFormState({ ...lastLoadedVessel.current });
    }
    setViewMode(true);
    setSaveError('');
  };

  // Hero image upload state
  const [uploadingHero, setUploadingHero] = useState(false);
  const [heroUploadError, setHeroUploadError] = useState('');
  const heroFileInputRef = useRef(null);

  const handleHeroImageUpload = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes?.includes(file?.type)) {
      setHeroUploadError('Please upload a JPEG, PNG, or WebP image');
      return;
    }

    // Validate file size (5MB)
    if (file?.size > 5242880) {
      setHeroUploadError('Image must be smaller than 5MB');
      return;
    }

    setUploadingHero(true);
    setHeroUploadError('');

    try {
      // Generate file path: vessel_assets/{tenant_id}/hero.{ext}
      const fileExt = file?.name?.split('.')?.pop();
      const filePath = `${tenantId}/hero.${fileExt}`;

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase
        ?.storage
        ?.from('vessel-assets')
        ?.upload(filePath, file, {
          cacheControl: '3600',
          upsert: true // Replace existing hero image
        });

      if (uploadError) {
        console.error('[HERO UPLOAD ERROR]', uploadError);
        setHeroUploadError(`Upload failed: ${uploadError?.message || 'Unknown error'}`);
        setUploadingHero(false);
        return;
      }

      // Get public URL
      const { data: urlData } = supabase
        ?.storage
        ?.from('vessel-assets')
        ?.getPublicUrl(filePath);

      const publicUrl = urlData?.publicUrl;

      if (!publicUrl) {
        setHeroUploadError('Failed to get public URL');
        setUploadingHero(false);
        return;
      }

      console.log('[HERO UPLOAD SUCCESS]', publicUrl);

      // Update form state
      setFormState(prev => ({
        ...prev,
        hero_image_url: publicUrl,
        use_custom_hero: true
      }));

      // Save to database immediately
      const { error: updateError } = await supabase
        ?.from('vessels')
        ?.upsert({
          tenant_id: tenantId,
          hero_image_url: publicUrl,
          use_custom_hero: true
        }, { onConflict: 'tenant_id' });

      if (updateError) {
        console.error('[HERO DB UPDATE ERROR]', updateError);
        setHeroUploadError(`Failed to save: ${updateError?.message || 'Unknown error'}`);
      } else {
        // Reload vessel data to sync
        await loadVesselSettings();
      }

      setUploadingHero(false);
    } catch (err) {
      console.error('[HERO UPLOAD EXCEPTION]', err);
      setHeroUploadError(`Unexpected error: ${err?.message || 'Something went wrong'}`);
      setUploadingHero(false);
    }
  };

  const handleToggleCustomHero = async (enabled) => {
    if (!canEdit) return;

    try {
      setFormState(prev => ({ ...prev, use_custom_hero: enabled }));

      // Save to database immediately
      const { error: updateError } = await supabase
        ?.from('vessels')
        ?.upsert({
          tenant_id: tenantId,
          use_custom_hero: enabled
        }, { onConflict: 'tenant_id' });

      if (updateError) {
        console.error('[TOGGLE HERO ERROR]', updateError);
        setSaveError(`Failed to toggle: ${updateError?.message || 'Unknown error'}`);
        // Revert on error
        setFormState(prev => ({ ...prev, use_custom_hero: !enabled }));
      } else {
        await loadVesselSettings();
      }
    } catch (err) {
      console.error('[TOGGLE HERO EXCEPTION]', err);
      setSaveError(`Unexpected error: ${err?.message || 'Something went wrong'}`);
    }
  };

  const handleRevertToBlueprint = async () => {
    if (!canEdit) return;

    try {
      setFormState(prev => ({ ...prev, use_custom_hero: false }));

      // Save to database immediately
      const { error: updateError } = await supabase
        ?.from('vessels')
        ?.upsert({
          tenant_id: tenantId,
          use_custom_hero: false
        }, { onConflict: 'tenant_id' });

      if (updateError) {
        console.error('[REVERT HERO ERROR]', updateError);
        setSaveError(`Failed to revert: ${updateError?.message || 'Unknown error'}`);
        // Revert on error
        setFormState(prev => ({ ...prev, use_custom_hero: true }));
      } else {
        await loadVesselSettings();
      }
    } catch (err) {
      console.error('[REVERT HERO EXCEPTION]', err);
      setSaveError(`Unexpected error: ${err?.message || 'Something went wrong'}`);
    }
  };

  const sections = [
    { id: 'vessel-profile', label: 'Vessel Profile', icon: 'Ship' },
    { id: 'location-management', label: 'Location Management', icon: 'MapPin' },
    { id: 'role-management', label: 'Role Management', icon: 'Users' },
  ];

  const renderContent = () => {
    if (activeSection === 'vessel-profile') {
      return (
        <div className="space-y-6">
          {/* Permission Banner */}
          {!canEdit && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <p className="text-sm font-medium text-yellow-800">View-only access</p>
                <p className="text-xs text-yellow-700 mt-1">Only COMMAND can edit vessel settings</p>
              </div>
            </div>
          )}

          {/* Error Display */}
          {saveError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <p className="text-sm font-medium text-red-800">Error</p>
                <p className="text-xs text-red-700 mt-1">{saveError}</p>
              </div>
            </div>
          )}

          {/* Edit/Save/Cancel Controls */}
          {canEdit && (
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-foreground">Vessel Profile</h2>
              <div className="flex gap-2">
                {viewMode ? (
                  <Button onClick={() => setViewMode(false)} iconName="Edit2">
                    Edit
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" onClick={handleCancel} disabled={saving}>
                      Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? 'Saving...' : 'Save'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                <p className="text-sm text-muted-foreground">Loading vessel settings...</p>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Dashboard Hero Image Section */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="text-lg font-medium text-foreground mb-4">Dashboard Hero Image</h3>
                
                {/* Current Hero Preview */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-foreground mb-2">Current Hero Image</label>
                  <div className="border border-border rounded-lg overflow-hidden" style={{ maxWidth: '600px' }}>
                    {formState?.use_custom_hero && formState?.hero_image_url ? (
                      <img
                        src={formState?.hero_image_url}
                        alt="Custom vessel hero"
                        style={{
                          width: '100%',
                          height: 'auto',
                          display: 'block'
                        }}
                        onError={(e) => {
                          console.error('[HERO IMAGE LOAD ERROR]');
                          e.target.style.display = 'none';
                        }}
                      />
                    ) : (
                      <img
                        src="/assets/images/yacht_blueprint-1770460015354.png"
                        alt="Default yacht blueprint"
                        style={{
                          width: '100%',
                          height: 'auto',
                          display: 'block'
                        }}
                      />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {formState?.use_custom_hero && formState?.hero_image_url
                      ? 'Showing custom vessel image' :'Showing default Cargo blueprint'}
                  </p>
                </div>

                {/* Upload Button */}
                {canEdit && (
                  <div className="mb-4">
                    <input
                      ref={heroFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleHeroImageUpload}
                      style={{ display: 'none' }}
                    />
                    <Button
                      onClick={() => heroFileInputRef?.current?.click()}
                      disabled={uploadingHero}
                      variant="outline"
                    >
                      <Upload size={16} className="mr-2" />
                      {uploadingHero ? 'Uploading...' : 'Upload Vessel Image'}
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">
                      Accepts JPEG, PNG, or WebP. Max 5MB.
                    </p>
                    {heroUploadError && (
                      <p className="text-xs text-red-600 mt-2">{heroUploadError}</p>
                    )}
                  </div>
                )}

                {/* Toggle Switch */}
                {canEdit && formState?.hero_image_url && (
                  <div className="mb-4">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <Checkbox
                        checked={formState?.use_custom_hero}
                        onCheckedChange={handleToggleCustomHero}
                      />
                      <span className="text-sm font-medium text-foreground">
                        Use my vessel image on dashboard
                      </span>
                    </label>
                  </div>
                )}

                {/* Revert Button */}
                {canEdit && formState?.hero_image_url && formState?.use_custom_hero && (
                  <div>
                    <Button
                      onClick={handleRevertToBlueprint}
                      variant="outline"
                    >
                      Revert to Cargo Blueprint
                    </Button>
                  </div>
                )}
              </div>

              {/* Vessel Identity */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="text-lg font-medium text-foreground mb-4">Vessel Identity</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Vessel Type *</label>
                    <Select
                      value={formState?.vessel_type_label}
                      onChange={(e) => handleInputChange('vessel_type_label', e?.target?.value)}
                      options={vesselTypeOptions}
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Flag *</label>
                    <Input
                      value={formState?.flag}
                      onChange={(e) => handleInputChange('flag', e?.target?.value)}
                      placeholder="e.g., Cayman Islands"
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Port of Registry *</label>
                    <Input
                      value={formState?.port_of_registry}
                      onChange={(e) => handleInputChange('port_of_registry', e?.target?.value)}
                      placeholder="e.g., George Town"
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">IMO Number</label>
                    <Input
                      value={formState?.imo_number}
                      onChange={(e) => handleInputChange('imo_number', e?.target?.value)}
                      placeholder="e.g., IMO 1234567"
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Official Number</label>
                    <Input
                      value={formState?.official_number}
                      onChange={(e) => handleInputChange('official_number', e?.target?.value)}
                      placeholder="e.g., 123456"
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">LOA (meters) *</label>
                    <Input
                      type="number"
                      value={formState?.loa_m}
                      onChange={(e) => handleInputChange('loa_m', e?.target?.value)}
                      placeholder="e.g., 50.5"
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Gross Tonnage (GT) *</label>
                    <Input
                      type="number"
                      value={formState?.gt}
                      onChange={(e) => handleInputChange('gt', e?.target?.value)}
                      placeholder="e.g., 500"
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Year Built</label>
                    <Input
                      type="number"
                      value={formState?.year_built}
                      onChange={(e) => handleInputChange('year_built', e?.target?.value)}
                      placeholder="e.g., 2015"
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Year Refit</label>
                    <Input
                      type="number"
                      value={formState?.year_refit}
                      onChange={(e) => handleInputChange('year_refit', e?.target?.value)}
                      placeholder="e.g., 2020"
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                </div>
              </div>

              {/* Operational Profile */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="text-lg font-medium text-foreground mb-4">Operational Profile</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Commercial Status</label>
                    <Select
                      value={formState?.commercial_status}
                      onChange={(e) => handleInputChange('commercial_status', e?.target?.value)}
                      options={commercialStatusOptions}
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <Checkbox
                      checked={formState?.certified_commercial}
                      onCheckedChange={(checked) => handleInputChange('certified_commercial', checked)}
                      disabled={viewMode || !canEdit}
                    />
                    <label className="text-sm text-foreground">Certified Commercial</label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Area of Operation</label>
                    <Select
                      value={formState?.area_of_operation}
                      onChange={(e) => handleInputChange('area_of_operation', e?.target?.value)}
                      options={areaOfOperationOptions}
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Operating Regions</label>
                    <Input
                      value={formState?.operating_regions}
                      onChange={(e) => handleInputChange('operating_regions', e?.target?.value)}
                      placeholder="e.g., Mediterranean, Caribbean"
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Seasonal Pattern</label>
                    <Input
                      value={formState?.seasonal_pattern}
                      onChange={(e) => handleInputChange('seasonal_pattern', e?.target?.value)}
                      placeholder="e.g., Summer Med, Winter Caribbean"
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Typical Guest Count</label>
                    <Input
                      type="number"
                      value={formState?.typical_guest_count}
                      onChange={(e) => handleInputChange('typical_guest_count', e?.target?.value)}
                      placeholder="e.g., 12"
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Typical Crew Count</label>
                    <Input
                      type="number"
                      value={formState?.typical_crew_count}
                      onChange={(e) => handleInputChange('typical_crew_count', e?.target?.value)}
                      placeholder="e.g., 15"
                      disabled={viewMode || !canEdit}
                    />
                  </div>
                </div>
              </div>

              {/* Compliance & Structure */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="text-lg font-medium text-foreground mb-4">Compliance & Structure</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={formState?.ism_applicable}
                      onCheckedChange={(checked) => handleInputChange('ism_applicable', checked)}
                      disabled={viewMode || !canEdit}
                    />
                    <label className="text-sm text-foreground">ISM Code Applicable</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={formState?.isps_applicable}
                      onCheckedChange={(checked) => handleInputChange('isps_applicable', checked)}
                      disabled={viewMode || !canEdit}
                    />
                    <label className="text-sm text-foreground">ISPS Code Applicable</label>
                  </div>
                </div>
              </div>

              {/* Cargo Configuration */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="text-lg font-medium text-foreground mb-4">Cargo Configuration</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Departments in Use</label>
                    <div className="flex flex-wrap gap-2">
                      {departmentOptions?.map(dept => (
                        <button
                          key={dept?.value}
                          type="button"
                          onClick={() => !viewMode && canEdit && handleDepartmentToggle(dept?.value)}
                          disabled={viewMode || !canEdit}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-smooth ${
                            formState?.departments_in_use?.includes(dept?.value)
                              ? 'bg-primary text-white' :'bg-muted text-muted-foreground hover:bg-muted/80'
                          } ${(viewMode || !canEdit) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                        >
                          {dept?.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={formState?.bonded_stores_enabled}
                      onCheckedChange={(checked) => handleInputChange('bonded_stores_enabled', checked)}
                      disabled={viewMode || !canEdit}
                    />
                    <label className="text-sm text-foreground">Bonded Stores Enabled</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={formState?.multi_location_storage}
                      onCheckedChange={(checked) => handleInputChange('multi_location_storage', checked)}
                      disabled={viewMode || !canEdit}
                    />
                    <label className="text-sm text-foreground">Multi-Location Storage</label>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    } else if (activeSection === 'location-management') {
      return (
        <div>
          {!canEdit && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3 mb-6">
              <AlertCircle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <p className="text-sm font-medium text-yellow-800">View-only access</p>
                <p className="text-xs text-yellow-700 mt-1">Only COMMAND can edit location settings</p>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">Location Management</h2>
              <p className="text-sm text-muted-foreground mt-1">Manage vessel decks, zones, and spaces</p>
            </div>
          </div>
          <LocationsManagementSettings embedded={true} />
        </div>
      );
    } else if (activeSection === 'role-management') {
      return (
        <div>
          {!canEdit && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3 mb-6">
              <AlertCircle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <p className="text-sm font-medium text-yellow-800">View-only access</p>
                <p className="text-xs text-yellow-700 mt-1">Only COMMAND can edit roles</p>
              </div>
            </div>
          )}
          <RoleManagement />
        </div>
      );
    }
  };

  // Show loading state while auth or page data is loading
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="max-w-7xl mx-auto px-4 py-6 pt-24">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground">Vessel Hub</h1>
          <p className="text-muted-foreground mt-1">Manage vessel settings, locations, inventory, and roles</p>
        </div>

        {/* Hub Layout: Left Sidebar + Right Content */}
        <div className="flex gap-6">
          {/* Left Sidebar Navigation */}
          <div className="w-64 flex-shrink-0">
            <div className="bg-card border border-border rounded-lg p-2 sticky top-24">
              {sections?.map(section => (
                <button
                  key={section?.id}
                  onClick={() => setActiveSection(section?.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-smooth ${
                    activeSection === section?.id
                      ? 'bg-primary text-white' :'text-foreground hover:bg-muted'
                  }`}
                >
                  <Icon name={section?.icon} size={18} />
                  <span className="text-sm font-medium">{section?.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right Content Panel */}
          <div className="flex-1">
            <div className="bg-card border border-border rounded-lg p-6">
              {renderContent()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VesselSettings;
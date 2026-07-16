import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import ProvisioningApprovalSettings from './ProvisioningApprovalSettings';
import VesselProfileStack from './VesselProfileStack';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { FLAG_STATES } from '../../data/flagStates';
import { Checkbox } from '../../components/ui/Checkbox';
import Icon from '../../components/AppIcon';
import { AlertCircle, Edit2, Upload } from 'lucide-react';
import LocationsManagementSettings from '../locations-management-settings';

import RoleManagement from '../crew-management/components/RoleManagement';
import { useAuth } from '../../contexts/AuthContext';
import { logActivity } from '../../utils/activityStorage';
import '../../styles/editorial.css';
import './vessel-hub.css';

const VesselSettings = () => {
  const navigate = useNavigate();
  const { session, loading: authLoading, hasCommandAccess } = useAuth();

  // Hub navigation state
  const [searchParams] = useSearchParams();
  const [activeSection, setActiveSection] = useState(() => searchParams.get('section') || 'vessel-profile');
  const [locStats, setLocStats] = useState(null);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('vh-nav-collapsed') === '1'; } catch { return false; }
  });
  const toggleNav = () => setNavCollapsed((c) => {
    const next = !c;
    try { localStorage.setItem('vh-nav-collapsed', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

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
    call_sign: '',
    class_notation: '',
    company_name: '',
    company_address: '',
    company_email: '',
    company_phone: '',
    company_country: '',
    company_postcode: '',
    logo_url: '',
    loa_m: '',
    propulsion_kw: '',
    main_engine_type: '',
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
    operational_day_start_hour: 6,
    hor_day_basis: 'calendar',
    hor_confirmation_mode: 'require',
    hor_approver_tier: 'CHIEF',
    hor_management_company_name: '',
    hor_management_company_email: '',

    // Defects & repairs
    defect_quote_approver_tier: 'HOD',
    defect_quote_signoff_threshold: 1000,

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

  // departments_in_use stores department UUIDs, so the toggle options must
  // be keyed by id (not name). Source from the shared departments table.
  const [departmentOptions, setDepartmentOptions] = useState([]);

  // Edit access = COMMAND. Source from the app's authoritative permission_tier
  // (useAuth/hasCommandAccess) rather than get_my_context's `role`: that RPC
  // additionally filters on tenant_members.status = 'ACTIVE', so a COMMAND user
  // whose status isn't exactly 'ACTIVE' would otherwise be locked to view-only.
  // Keep the RPC role as a fallback.
  const role = userRole?.toUpperCase();
  const canEdit = (typeof hasCommandAccess === 'function' && hasCommandAccess()) || role === 'COMMAND';

  useEffect(() => {
    loadVesselSettings();
  }, []);

  // Load the department options (id → label) once the tenant is known.
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: rpcDepts, error: rpcError } = await supabase
          ?.rpc('get_tenant_departments', { p_tenant_id: tenantId });
        let rows = (!rpcError && Array.isArray(rpcDepts) && rpcDepts.length > 0)
          ? rpcDepts
          : null;
        if (!rows) {
          const { data: directDepts } = await supabase
            ?.from('departments')
            ?.select('id, name')
            ?.order('name', { ascending: true });
          rows = Array.isArray(directDepts) ? directDepts : [];
        }
        if (cancelled) return;
        setDepartmentOptions(
          rows
            .filter(d => d?.id && d?.name)
            .map(d => ({ value: d.id, label: d.name }))
        );
      } catch (err) {
        console.warn('[VESSEL SETTINGS] fetchDepartments error:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  useEffect(() => {
    if (vesselData && !formInitialized) {
      console.log('[VESSEL SETTINGS] Loading vessel data:', vesselData);
      
      // departments_in_use is a uuid[] — PostgREST returns it as a JS array
      const departmentsArray = vesselData?.departments_in_use ?? [];

      const initialFormData = {
        vessel_type_label: vesselData?.vessel_type_label || '',
        flag: vesselData?.flag || '',
        port_of_registry: vesselData?.port_of_registry || '',
        imo_number: vesselData?.imo_number || '',
        official_number: vesselData?.official_number || '',
        call_sign: vesselData?.call_sign || '',
        class_notation: vesselData?.class_notation || '',
        company_name: vesselData?.company_name || '',
        company_address: vesselData?.company_address || '',
        company_email: vesselData?.company_email || '',
        company_phone: vesselData?.company_phone || '',
        company_country: vesselData?.company_country || '',
        company_postcode: vesselData?.company_postcode || '',
        logo_url: vesselData?.logo_url || '',
        loa_m: vesselData?.loa_m || '',
        propulsion_kw: vesselData?.propulsion_kw ?? '',
        main_engine_type: vesselData?.main_engine_type || '',
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
        operational_day_start_hour: vesselData?.operational_day_start_hour ?? 6,
        hor_day_basis: vesselData?.hor_day_basis || 'calendar',
        hor_confirmation_mode: vesselData?.hor_confirmation_mode || 'require',
        hor_approver_tier: vesselData?.hor_approver_tier || 'CHIEF',
        defect_quote_approver_tier: vesselData?.defect_quote_approver_tier || 'HOD',
        defect_quote_signoff_threshold: vesselData?.defect_quote_signoff_threshold ?? 1000,
        hor_management_company_name: vesselData?.hor_management_company_name || '',
        hor_management_company_email: vesselData?.hor_management_company_email || '',
        ism_applicable: vesselData?.ism_applicable || false,
        isps_applicable: vesselData?.isps_applicable || false,
        departments_in_use: departmentsArray,
        bonded_stores_enabled: vesselData?.bonded_stores_enabled || false,
        multi_location_storage: vesselData?.multi_location_storage || false,
        hero_image_url: vesselData?.hero_image_url || '',
        use_custom_hero: vesselData?.use_custom_hero || false,
        feedback_widget_enabled: vesselData?.feedback_widget_enabled !== false
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

  // Coerce a single field to the shape the vessels column expects.
  const NUM_FLOAT = ['loa_m', 'propulsion_kw', 'defect_quote_signoff_threshold'];
  const NUM_INT = ['gt', 'year_built', 'year_refit', 'typical_guest_count', 'typical_crew_count'];
  const coerceForDb = (field, v) => {
    if (NUM_FLOAT.includes(field)) return (v === '' || v == null) ? null : parseFloat(v);
    if (NUM_INT.includes(field)) return (v === '' || v == null) ? null : parseInt(v, 10);
    if (field === 'operational_day_start_hour') return Math.min(23, Math.max(0, parseInt(v ?? 6, 10) || 0));
    if (Array.isArray(v)) return v;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.trim() || null;
    return v ?? null;
  };

  // Inline per-field save: optimistic local update, single-column upsert,
  // revert on failure. Keeps onboarding_status in sync with the required set.
  const saveField = async (field, rawValue) => {
    const prev = formState?.[field];
    const next = { ...formState, [field]: rawValue };
    setFormState(next);
    setSaveError('');
    try {
      if (!tenantId) return false;
      const payload = { tenant_id: tenantId, [field]: coerceForDb(field, rawValue) };
      const ready = next.vessel_type_label && next.flag && next.port_of_registry && (next.gt || next.loa_m);
      payload.onboarding_status = ready ? 'READY' : 'SETUP_REQUIRED';
      if (ready && !vesselData?.setup_completed_at) payload.setup_completed_at = new Date().toISOString();
      const { error } = await supabase?.from('vessels')?.upsert(payload, { onConflict: 'tenant_id' });
      if (error) {
        console.error('[VESSEL SAVE FIELD]', field, error);
        setFormState(p => ({ ...p, [field]: prev }));
        return false;
      }
      setVesselData(vd => ({ ...(vd || {}), [field]: coerceForDb(field, rawValue), onboarding_status: payload.onboarding_status }));
      return true;
    } catch (err) {
      console.error('[VESSEL SAVE FIELD] exception', err);
      setFormState(p => ({ ...p, [field]: prev }));
      return false;
    }
  };


  // Hero image upload state
  const [uploadingHero, setUploadingHero] = useState(false);
  const [heroUploadError, setHeroUploadError] = useState('');
  const heroFileInputRef = useRef(null);

  // Company logo upload state (embedded in generated contract headers)
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState('');
  const logoFileInputRef = useRef(null);

  const handleLogoUpload = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file?.type)) {
      setLogoUploadError('Logo must be a PNG or JPEG.');
      return;
    }
    if (file?.size > 5242880) {
      setLogoUploadError('Image must be smaller than 5MB');
      return;
    }
    setUploadingLogo(true);
    setLogoUploadError('');
    try {
      const fileExt = file?.type === 'image/png' ? 'png' : 'jpg';
      const filePath = `${tenantId}/logo.${fileExt}`;
      const { error: uploadError } = await supabase
        ?.storage?.from('vessel-assets')
        ?.upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (uploadError) {
        setLogoUploadError(`Upload failed: ${uploadError?.message || 'Unknown error'}`);
        setUploadingLogo(false);
        return;
      }
      const { data: urlData } = supabase?.storage?.from('vessel-assets')?.getPublicUrl(filePath);
      // Cache-bust so a replaced logo refreshes in the preview.
      const publicUrl = urlData?.publicUrl ? `${urlData.publicUrl}?v=${Date.now()}` : null;
      if (!publicUrl) {
        setLogoUploadError('Failed to get public URL');
        setUploadingLogo(false);
        return;
      }
      setFormState(prev => ({ ...prev, logo_url: publicUrl }));
      await supabase?.from('vessels')?.upsert({ tenant_id: tenantId, logo_url: publicUrl }, { onConflict: 'tenant_id' });
    } catch (err) {
      setLogoUploadError(`Unexpected error: ${err?.message || 'Something went wrong'}`);
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!canEdit) return;
    setFormState(prev => ({ ...prev, logo_url: '' }));
    await supabase?.from('vessels')?.upsert({ tenant_id: tenantId, logo_url: null }, { onConflict: 'tenant_id' });
  };

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

  const sections = [
    { id: 'vessel-profile', label: 'Vessel Profile', icon: 'Ship' },
    { id: 'location-management', label: 'Location Management', icon: 'MapPin' },
    { id: 'role-management', label: 'Role Management', icon: 'Users' },
    { id: 'provisioning-approval', label: 'Provisioning Approval', icon: 'CheckCircle' },
  ];

  const renderContent = () => {
    if (activeSection === 'vessel-profile') {
      return (
        <VesselProfileStack
          vesselData={vesselData}
          formState={formState}
          canEdit={canEdit}
          departmentOptions={departmentOptions}
          saveField={saveField}
          saveError={saveError}
          logoInputRef={logoFileInputRef}
          onLogoChange={handleLogoUpload}
          uploadingLogo={uploadingLogo}
          logoUploadError={logoUploadError}
          onRemoveLogo={handleRemoveLogo}
          heroInputRef={heroFileInputRef}
          onHeroChange={handleHeroImageUpload}
          uploadingHero={uploadingHero}
          heroUploadError={heroUploadError}
          onRevertHero={() => saveField('use_custom_hero', false)}
        />
      );
    } else if (activeSection === 'location-management') {
      return (
        <div>
          {!canEdit && (
            <p className="vh-note">View-only — only Command can edit locations.</p>
          )}
          <LocationsManagementSettings embedded={true} hideStats={true} onStats={setLocStats} />
        </div>
      );
    } else if (activeSection === 'role-management') {
      return (
        <div>
          {!canEdit && (
            <div className="vh-banner warn" style={{ marginBottom: 22 }}>
              <AlertCircle className="ic" size={18} />
              <div><span className="vh-banner-t">View-only</span> — only Command can edit roles.</div>
            </div>
          )}
          <RoleManagement />
        </div>
      );
    } else if (activeSection === 'provisioning-approval') {
      return (
        <ProvisioningApprovalSettings tenantId={vesselData?.id} />
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

  const activeMeta = sections?.find(s => s?.id === activeSection) || sections?.[0];
  const titleWords = (activeMeta?.label || 'Vessel Hub').split(' ');
  const titleAccent = titleWords.pop();
  const titleLead = titleWords.join(' ');

  return (
    <div className="vh-page min-h-screen">
      <Header />
      <div className="w-full" style={{ padding: '26px 40px 72px' }}>
        <button className="vh-back" onClick={() => navigate('/dashboard')}>
          <Icon name="ChevronLeft" size={16} /> Back to Dashboard
        </button>
        {/* Editorial masthead — hidden for vessel-profile, which brings its own
            vessel-name header via VesselProfileStack. */}
        {activeSection !== 'vessel-profile' && (
          <div className="vh-mast">
            {activeSection === 'location-management' && locStats && (
              <div className="editorial-meta">
                <span className="dot">•</span>
                <span>Scanned {locStats.scanned}/{locStats.total}</span>
                <span className="bar" /><span>{locStats.decks} Decks</span>
                <span className="bar" /><span>{locStats.zones} Zones</span>
                <span className="bar" /><span>{locStats.total} Spaces</span>
              </div>
            )}
            <h1 className="editorial-greeting vh-greeting">{titleLead ? <>{titleLead}<span className="period">,</span> </> : null}<em>{titleAccent}</em><span className="period">.</span></h1>
          </div>
        )}

        {/* Hub Layout — Settings-style rail (plain grouped nav) + content */}
        <div className="vh-layout">
          <aside className="vh-rail" aria-label="Vessel sections">
            <nav>
              <div className="vh-rail-grp">Vessel</div>
              {sections?.map(section => (
                <button
                  key={section?.id}
                  onClick={() => setActiveSection(section?.id)}
                  className={`vh-rail-it${activeSection === section?.id ? ' active' : ''}`}
                >
                  <Icon name={section?.icon} size={17} color={activeSection === section?.id ? '#C65A1A' : '#8B8478'} />
                  <span>{section?.label}</span>
                </button>
              ))}
            </nav>
          </aside>

          <div className="vh-content">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VesselSettings;
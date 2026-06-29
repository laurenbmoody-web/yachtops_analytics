import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Icon from '../../components/AppIcon';
import LogoSpinner from '../../components/LogoSpinner';
import QuickEntryModal from './components/QuickEntryModal';
import BreachNotesModal from './components/BreachNotesModal';
import HORHybridLog from './components/HORHybridLog';
import StatusHistoryTab from './components/StatusHistoryTab';
import StatusChangeModal from '../crew-management/components/StatusChangeModal';
import { getCurrentUser, getDepartmentDisplayName, getTierDisplayName } from '../../utils/authStorage';
import { getInitials } from '../../utils/profileHelpers';
import DocumentsTab from './components/DocumentsTab';
import IssuedKitTab from './components/IssuedKitTab';
import ProfileStatementTab from './components/ProfileStatementTab';
import { fetchCrewProfileData, profileDataToFormData, saveCrewProfileData, logBankingView } from './utils/crewProfileData';
import { ibanWarning, swiftWarning } from './utils/bankingValidation';
import { fetchCrewDocuments } from './utils/crewDocuments';
import DateInput from '../../components/ui/DateInput';
import EditorialDatePicker from '../../components/editorial/EditorialDatePicker';
import { crewContractStandard } from '../../data/flagStates';
import { nationalityOptions as NATIONALITY_OPTIONS } from '../../data/nationalities';
import { saveAs } from 'file-saver';
import ContractTemplateModal from './components/ContractTemplateModal';
import { fetchTemplates, templateFitsRole, buildContractTokens, generateContractBlob, isPdfTemplate, TEMPLATE_MIME } from './utils/contractTemplates';
import { uploadDocumentFile, saveCrewDocument } from './utils/crewDocuments';
import { computeProfileCompletion } from './utils/profileCompletion';
import { getStatusLabel, getStatusBadgeClasses, getStatusDotClass } from '../../utils/crewStatus';
import { showToast } from '../../utils/toast';
import { addWorkEntries, getComplianceStatus, getMonthCalendarData, detectBreaches, calculateLatestLongestStretch, getCrewWorkEntries, deleteWorkEntriesForDate, runAllHORTests, confirmMonth, getMonthStatus, isMonthEditable, detectBreachedDatesAfterSave, hasBreachNoteForDate, syncRotaBaselineEntries, setHorDbContext, hydrateActualsForMonth } from './utils/horStorage';
import { fetchWorkEntriesForMonth } from './utils/horWorkEntries';
import { fetchRotaBaselineForMonth } from './utils/horBaseline';
import { fetchVesselHorSettings, fetchMonthStatus, fetchActiveMemberTiers, submitMonth as submitMonthDb, approveMonth as approveMonthDb, reopenMonth as reopenMonthDb, lockMonth as lockMonthDb } from './utils/horMonthStatus';
import { archiveSignedHorRecordSafe } from './utils/horArchive';
import { sendDbNotification } from '../../lib/dbNotifications';

// HOR approver hierarchy (mirrors the DB _hor_tier_rank): COMMAND > CHIEF > HOD.
const HOR_TIER_RANK = { COMMAND: 3, CHIEF: 2, HOD: 1 };
const horRankOf = (tier) => HOR_TIER_RANK[String(tier || '').toUpperCase()] || 0;
import { fetchBreachReasonsForMonth, signOffBreachReason as signOffBreachReasonDb, unsignBreachReason as unsignBreachReasonDb } from './utils/horBreachReasons';
import { useRole } from '../../contexts/RoleContext';
import { PermissionTier } from '../../utils/authStorage';
import VesselHORDashboard from './components/VesselHORDashboard';
import SignOffModal from './components/SignOffModal';
import { getSignatureUrl } from './utils/horSignatures';
import SeaTimeTracker from './components/SeaTimeTracker';
import SeaTimeDashboard from './components/SeaTimeDashboard';
import { supabase } from '../../lib/supabaseClient';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import '../../styles/editorial.css';
import './crew-profile.css';




// Option C "index card" field wrapper — tracked-caps label + the control
// (Input/Select) rendered borderless inside a soft card. Module-level so
// its identity is stable across renders (a render-local component would
// remount the input on every keystroke and drop focus).
const Field = ({ label, required, full, hint, children }) => (
  <div className={`cp-field-card${required ? ' cp-accent' : ''}${full ? ' cp-field-full' : ''}`}>

    <div className="cp-field-label">
      <span>{label}</span>
    </div>
    {children}
    {hint && <p className="cp-field-hint">{hint}</p>}
  </div>
);

const PHONE_LABELS = ['Mobile', 'WhatsApp', 'Sat phone', 'Home', 'Work', 'Other'];

// Multiple phone entries (mobile / WhatsApp / sat phone). Reads as a list
// in view mode; rows of label + number in edit mode.
const PhonesEditor = ({ phones, disabled, onChange }) => {
  const rows = Array.isArray(phones) && phones.length ? phones : [{ label: 'Mobile', value: '' }];
  const update = (i, key, val) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  const add = () => onChange([...rows, { label: 'Mobile', value: '' }]);
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));

  if (disabled) {
    const filled = rows.filter((r) => r.value);
    if (!filled.length) return <div className="cp-static cp-empty">—</div>;
    return (
      <div className="cp-phone-list">
        {filled.map((r, i) => (
          <div key={i} className="cp-phone-read">
            <span className="cp-phone-tag">{r.label}</span>
            <span>{r.value}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="cp-phone-rows">
      {rows.map((r, i) => (
        <div key={i} className="cp-phone-row">
          <select className="cp-inline-select cp-phone-labelsel" value={r.label} onChange={(e) => update(i, 'label', e.target.value)}>
            {PHONE_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <input className="cp-inline-box" value={r.value} onChange={(e) => update(i, 'value', e.target.value)} placeholder="Number" />
          {rows.length > 1 && (
            <button type="button" className="cp-phone-remove" onClick={() => remove(i)} aria-label="Remove"><Icon name="X" size={14} /></button>
          )}
        </div>
      ))}
      <button type="button" className="cp-phone-add" onClick={add}>+ Add phone</button>
    </div>
  );
};

// Discrete-entry editor for allergies / medical conditions. Each item is a
// removable chip (add with Enter or comma); reads back as a comma-joined
// string, so it drops into the existing text columns with no schema change.
const TagInput = ({ value, disabled, onChange, placeholder }) => {
  const tags = String(value || '').split(',').map((t) => t.trim()).filter(Boolean);
  const [draft, setDraft] = useState('');
  const commit = (raw) => {
    const v = raw.trim().replace(/,$/, '').trim();
    setDraft('');
    if (!v || tags.some((t) => t.toLowerCase() === v.toLowerCase())) return;
    onChange([...tags, v].join(', '));
  };
  const remove = (t) => onChange(tags.filter((x) => x !== t).join(', '));

  if (disabled) {
    if (!tags.length) return <div className="cp-static cp-empty">—</div>;
    return <div className="cp-tags">{tags.map((t) => <span key={t} className="cp-tag">{t}</span>)}</div>;
  }
  return (
    <div className="cp-taginput">
      {tags.map((t) => (
        <span key={t} className="cp-tag">
          {t}
          <button type="button" onClick={() => remove(t)} aria-label={`Remove ${t}`}><Icon name="X" size={12} /></button>
        </span>
      ))}
      <input
        className="cp-tag-field"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(draft); }
          else if (e.key === 'Backspace' && !draft && tags.length) remove(tags[tags.length - 1]);
        }}
        onBlur={() => commit(draft)}
        placeholder={tags.length ? 'Add another…' : (placeholder || 'Type and press Enter')}
      />
    </div>
  );
};

// Spice tolerance — a 4-step scale shown as flame icons (lucide) that fill with
// terracotta up to the chosen level. Clickable in edit mode (click a flame to
// set that level; click the current top one again to clear); static in read.
const SPICE_LEVELS = ['Mild', 'Medium', 'Hot', 'Very hot'];
const Flame = ({ on }) => (
  <Icon name="Flame" size={19} strokeWidth={1.8}
    color={on ? '#C65A1A' : '#D6CCC2'} fill={on ? '#C65A1A' : 'none'} />
);
const SpiceField = ({ value, disabled, onChange }) => {
  const idx = SPICE_LEVELS.indexOf(value); // -1 when not set
  if (disabled) {
    if (idx < 0) return <div className="cp-static cp-empty">—</div>;
    return (
      <div className="cp-spice">
        <span className="cp-spice-row">
          {SPICE_LEVELS.map((_, i) => <Flame key={i} on={i <= idx} />)}
        </span>
        <span className="cp-spice-val">{value}</span>
      </div>
    );
  }
  return (
    <div className="cp-spice">
      <span className="cp-spice-row">
        {SPICE_LEVELS.map((lvl, i) => (
          <button
            type="button"
            key={lvl}
            className="cp-chilli-btn"
            title={lvl}
            aria-label={lvl}
            aria-pressed={i <= idx}
            onClick={() => onChange(i === idx ? '' : lvl)}
          >
            <Flame on={i <= idx} />
          </button>
        ))}
      </span>
      <span className={`cp-spice-val${idx < 0 ? ' is-empty' : ''}`}>{value || 'Not set'}</span>
    </div>
  );
};

// Human-readable allergy summary from the Personal Details fields. Shared so
// the Preferences section can cross-reference the SAME record (single source).
const allergiesReadText = (f) => {
  const conf = f?.allergiesConfirmedAt
    ? ` (confirmed ${new Date(f.allergiesConfirmedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })})`
    : '';
  switch (f?.allergiesStatus) {
    case 'no_known': return `No known allergies${conf}`;
    case 'not_provided': return 'Not yet provided';
    case 'has': return f?.allergies || 'Has allergies (details pending)';
    default: return f?.allergies || 'Not yet provided';
  }
};

// Read-only age from a date of birth (ISO). Returns null for missing/invalid
// dates or implausible ages so callers can simply skip rendering.
const computeAge = (iso) => {
  if (!iso) return null;
  const dob = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 && age < 140 ? age : null;
};

const CrewProfile = () => {
  const navigate = useNavigate();
  const { crewId } = useParams();
  const [searchParams] = useSearchParams();
  const { activeTenantId } = useTenant();
  const { session, loading: authLoading, isVesselAdmin } = useAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [crewMember, setCrewMember] = useState(null);
  const [activeSection, setActiveSection] = useState(() => searchParams.get('tab') || 'personal');
  // Sea Time held-certs drawer can jump to Documents and open Add with a preset.
  const [docPreset, setDocPreset] = useState(null);
  const handleAddCertificate = (grade) => { setDocPreset({ docType: 'coc', grade }); setActiveSection('documents'); };
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({});
  const [sameAsEmergency, setSameAsEmergency] = useState(false);
  const [showSecondEmergency, setShowSecondEmergency] = useState(false);
  const [showAccountNumber, setShowAccountNumber] = useState(false);
  const [showBankAddress, setShowBankAddress] = useState(false);
  const [showSecondAccount, setShowSecondAccount] = useState(false);
  const [cakeSurprise, setCakeSurprise] = useState(false);
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [selectedHORDates, setSelectedHORDates] = useState([]);
  // Initial HOR month honours a `?period=YYYY-MM` deep-link (e.g. month-end's
  // "Review & approve" opens the month being approved, not today's month).
  const [horCurrentMonth, setHorCurrentMonth] = useState(() => {
    const p = searchParams.get('period');
    const m = p && /^\d{4}-\d{2}$/.test(p) ? p.split('-').map(Number) : null;
    return m ? new Date(m[0], m[1] - 1, 1) : new Date();
  });
  const [horData, setHorData] = useState(null);
  const [dbMonthStatus, setDbMonthStatus] = useState(null);     // hor_month_status row (DB)
  const [horMemberTiers, setHorMemberTiers] = useState({});     // { user_id: permission_tier } — active members
  const [signOff, setSignOff] = useState(null);                 // sign-off modal config, or null
  const [sigUrls, setSigUrls] = useState({ submit: null, approve: null }); // re-signed signature image URLs
  const [vesselHorSettings, setVesselHorSettings] = useState(null); // { mode, approverTier }
  const [breachReasonsByDate, setBreachReasonsByDate] = useState({}); // { 'YYYY-MM-DD': hor_breach_reasons row }
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);
  const [showEditDateModal, setShowEditDateModal] = useState(false);
  const { userRole } = useRole();
  const [horView, setHorView] = useState('my'); // 'my' or 'vessel'
  const [showBreachNotesModal, setShowBreachNotesModal] = useState(false);
  const [breachedDates, setBreachedDates] = useState([]);
  // When the breach-notes modal was opened as part of a Confirm-Month attempt
  // (undocumented breaches blocked sign-off), this flag carries the user back
  // into the sign-off modal once the reasons are saved — rather than dropping
  // them on the grid to re-click "Confirm Month". Set only by handleConfirmMonth.
  const [signOffAfterBreach, setSignOffAfterBreach] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [tenantMemberRole, setTenantMemberRole] = useState(null);
  const [currentUserPermissionTier, setCurrentUserPermissionTier] = useState(null);
  const [permSaving, setPermSaving] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState(null);   // null until loaded
  const [notifSavingKey, setNotifSavingKey] = useState(null);
  // Contract / employment section
  const [empLoaded, setEmpLoaded] = useState(false);
  const [empForm, setEmpForm] = useState({});           // crew_employment fields
  const [compForm, setCompForm] = useState(null);       // crew_compensation (null = no access/none)
  const [empEditing, setEmpEditing] = useState(false);
  const [empSaving, setEmpSaving] = useState(false);
  const [vesselCompliance, setVesselCompliance] = useState(null);   // { name, flag, port_of_registry, imo_number, official_number, commercial_status, certified_commercial }
  const [templates, setTemplates] = useState([]);                   // contract templates for the tenant
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState(null);         // { updated_at, file_url, file_name }
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const fileInputRef = React.useRef(null);
  const [myProfile, setMyProfile] = useState(null);
  const [statusChangeModalOpen, setStatusChangeModalOpen] = useState(false);
  const [statusChangeSaving, setStatusChangeSaving] = useState(false);
  // Profile-completion dropdown — opened by clicking the % badge on the avatar.
  const [completionOpen, setCompletionOpen] = useState(false);
  const completionRef = useRef(null);
  useEffect(() => {
    if (!completionOpen) return undefined;
    const onDown = (e) => {
      if (completionRef.current && !completionRef.current.contains(e.target)) setCompletionOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [completionOpen]);

  // Re-sign the stored signature object paths into short-lived display URLs
  // whenever the month status row changes (paths outlive any single signed URL).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [submit, approve] = await Promise.all([
        getSignatureUrl(dbMonthStatus?.submit_signature_path),
        getSignatureUrl(dbMonthStatus?.approve_signature_path),
      ]);
      if (!cancelled) setSigUrls({ submit, approve });
    })();
    return () => { cancelled = true; };
  }, [dbMonthStatus?.submit_signature_path, dbMonthStatus?.approve_signature_path]);

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

  // Fetch current user's profile for changed_by_name in history inserts
  useEffect(() => {
    if (!session?.user?.id) return;
    supabase?.from('profiles')?.select('id, full_name')?.eq('id', session.user.id)?.single()
      .then(({ data }) => { if (data) setMyProfile(data); });
  }, [session?.user?.id]);

  // Check authentication - no longer using getCurrentUser()
  useEffect(() => {
    // Authentication is handled by AuthContext and ProtectedRoute
    // No need to check getCurrentUser() here
  }, []);

  // Editorial navy/terracotta skin. Toggled on <body> (not the page
  // wrapper) so the override reaches the HOR / Sea-Time modals and
  // drawers, which portal to document.body via ModalShell.
  useEffect(() => {
    document.body.classList.add('crew-profile-editorial');
    return () => document.body.classList.remove('crew-profile-editorial');
  }, []);

  // Documents drive part of the profile-completion meter.
  const [crewDocs, setCrewDocs] = useState([]);
  useEffect(() => {
    if (!crewId) return;
    fetchCrewDocuments(crewId).then(setCrewDocs).catch(() => {});
  }, [crewId]);

  // Audit: record when a non-owner (e.g. command) opens crew banking.
  useEffect(() => {
    if (activeSection !== 'banking' || !crewId || !session?.user?.id) return;
    if (session.user.id === crewId) return; // viewing own banking isn't audited
    logBankingView(crewId, { id: session.user.id, name: myProfile?.full_name || '' });
  }, [activeSection, crewId, session?.user?.id, myProfile?.full_name]);

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
              role_id,
              custom_role_id,
              department_id,
              status,
              permission_tier,
              permission_tier_override,
              rota_requires_acceptance,
              can_edit_rota,
              can_order_without_approval,
              can_confirm_quotes_without_approval,
              start_date,
              joined_at,
              departments(name),
              roles!tenant_members_role_id_fkey(name, default_permission_tier),
              custom_role:tenant_custom_roles(name, default_permission_tier)
            `)
            ?.eq('user_id', crewId)
            ?.eq('tenant_id', activeTenantId)
            ?.single();
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
          roleTitle: membershipData?.custom_role?.name || membershipData?.roles?.name || null,
          department: membershipData?.departments?.name || null,
          department_id: membershipData?.department_id || null,
          role_id: membershipData?.role_id || null,
          custom_role_id: membershipData?.custom_role_id || null,
          effectiveTier:
            membershipData?.roles?.default_permission_tier ||
            membershipData?.custom_role?.default_permission_tier ||
            membershipData?.permission_tier_override ||
            membershipData?.permission_tier ||
            null,
          rotaRequiresAcceptance: membershipData?.rota_requires_acceptance ?? null,
          canEditRota: membershipData?.can_edit_rota ?? null,
          canOrderWithoutApproval: membershipData?.can_order_without_approval ?? null,
          canConfirmQuotesWithoutApproval: membershipData?.can_confirm_quotes_without_approval ?? null,
          startDate: membershipData?.start_date || membershipData?.joined_at || null,
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

        // Merge persisted personal-details + banking over the defaults.
        try {
          const saved = await fetchCrewProfileData(crewId);
          if (saved?.personal || saved?.banking) {
            setFormData((prev) => ({ ...prev, ...profileDataToFormData(saved) }));
          }
        } catch (e) {
          console.warn('[profile] crew detail load failed', e);
        }

      } catch (err) {
        console.error('PROFILE unexpected error:', err);
        setProfileError('An unexpected error occurred while loading the profile.');
        setProfileLoading(false);
      }
    };

    loadCrewProfile();
  }, [crewId]);

  // Re-pull persisted Personal Details + banking into the form. Called after a
  // passport upload feeds new identity fields into Personal Details, so the
  // change is reflected without a full page reload.
  const refreshPersonalDetails = async () => {
    if (!crewId) return;
    try {
      const saved = await fetchCrewProfileData(crewId);
      if (saved?.personal || saved?.banking) {
        setFormData((prev) => ({ ...prev, ...profileDataToFormData(saved) }));
      }
    } catch (e) {
      console.warn('[profile] personal details refresh failed', e);
    }
  };

  // Load HOR data when HOR section is active (re-runs on month navigation so
  // the rota baseline is pulled for the month being viewed).
  useEffect(() => {
    if (activeSection === 'hor' && crewId) {
      loadHORData();
    }
  }, [activeSection, crewId, horCurrentMonth, activeTenantId]);

  // After breach reasons are documented from a Confirm-Month attempt, re-enter
  // the confirm flow (now unblocked) so the user lands in the sign-off modal
  // instead of back on the grid. Runs once the breach modal has closed AND the
  // refreshed reasons have loaded — the modal's onClose awaits the reload before
  // closing, so handleConfirmMonth here re-checks against up-to-date reasons.
  useEffect(() => {
    if (!signOffAfterBreach || showBreachNotesModal) return;
    setSignOffAfterBreach(false);
    handleConfirmMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signOffAfterBreach, showBreachNotesModal]);

  const loadHORData = async () => {
    if (!crewId) return;
    const year = horCurrentMonth?.getFullYear();
    const month = horCurrentMonth?.getMonth();

    // Tell horStorage which tenant to dual-write actuals to (Phase 5). Reset
    // the day-basis to calendar up front; the real vessel setting is applied
    // once fetchVesselHorSettings resolves below (so a failed/slow fetch can't
    // leave a stale operational anchor across month/tenant switches).
    setHorDbContext({ tenantId: activeTenantId, horDayStartHour: 0 });

    // Phase 5 — hydrate ACTUALS from the DB (system of record) into the cache,
    // then Phase 1 — fill the remaining days with the rota baseline. Order
    // matters: actuals first so the baseline only covers days with no actual.
    try {
      const [baseline, dbActuals] = await Promise.all([
        fetchRotaBaselineForMonth({ userId: crewId, tenantId: activeTenantId, year, month }),
        fetchWorkEntriesForMonth({ tenantId: activeTenantId, subjectUserId: crewId, year, jsMonth: month }),
      ]);
      hydrateActualsForMonth(crewId, year, month, dbActuals);
      // Only reconcile the rota baseline when the fetch authoritatively resolved
      // (object — possibly {} for "no shifts"). A `null` means the lookup failed
      // transiently; rebuilding from it would DROP the cached "from rota" rows
      // and leave nothing in their place (the bug where confirming a month or
      // navigating made the rota hours vanish). Preserve last-known instead.
      if (baseline) syncRotaBaselineEntries(crewId, year, month, baseline);
    } catch (e) {
      console.warn('[HOR] baseline/actuals hydrate failed:', e);
    }

    // Phase 3 — DB-backed month confirmation workflow. Best-effort: until the
    // migration is applied these resolve to defaults/null and the UI falls back
    // to the legacy localStorage status.
    try {
      const [settings, status, reasons, memberTiers] = await Promise.all([
        fetchVesselHorSettings(activeTenantId),
        fetchMonthStatus({ tenantId: activeTenantId, subjectUserId: crewId, year, jsMonth: month }),
        fetchBreachReasonsForMonth({ tenantId: activeTenantId, subjectUserId: crewId, year, jsMonth: month }),
        fetchActiveMemberTiers(activeTenantId),
      ]);
      setVesselHorSettings(settings);
      setHorMemberTiers(memberTiers);
      // Feed the vessel's day-basis to the compliance engine BEFORE the
      // assessment calls below, so the profile assesses the identical 24h day
      // as the rota/vessel record (calendar = no-op; operational re-anchors).
      setHorDbContext({
        tenantId: activeTenantId,
        horDayStartHour: settings?.dayBasis === 'operational' ? (settings?.operationalDayStartHour || 0) : 0,
      });
      setDbMonthStatus(status);
      const byDate = {};
      (reasons || []).forEach((r) => { byDate[r.breach_date] = r; });
      setBreachReasonsByDate(byDate);
    } catch (e) {
      console.warn('[HOR] month-status fetch failed:', e);
    }

    const complianceStatus = getComplianceStatus(crewId);
    const calendarData = getMonthCalendarData(crewId, year, month);
    const breaches = detectBreaches(crewId);

    setHorData({
      last24HoursRest: complianceStatus?.last24HoursRest,
      last7DaysRest: complianceStatus?.last7DaysRest,
      longestStretchHours: calculateLatestLongestStretch(crewId),
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

      // Persist the rest of the profile (personal details, contact, health,
      // emergency/next-of-kin, banking, preferences) to their own tables.
      try {
        const actorName = myProfile?.full_name || crewMember?.fullName || '';
        await saveCrewProfileData(crewId, formData, { id: session?.user?.id, name: actorName });
      } catch (e) {
        console.error('PROFILE SAVE: crew detail save error', e);
        showToast(`Failed to save profile details: ${e?.message || 'Unknown error'}`, 'error');
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
      // Auto-fill Next of Kin from Emergency Contact (full standard field set).
      setFormData(prev => ({
        ...prev,
        nextOfKinName: prev?.emergencyContactName,
        nextOfKinRelationship: prev?.emergencyContactRelationship,
        nextOfKinPhone: prev?.emergencyContactPhone,
        nextOfKinEmail: prev?.emergencyContactEmail,
        nextOfKinAddress: prev?.emergencyContactAddress,
        nextOfKinCountry: prev?.emergencyContactCountry,
        nextOfKinPreferredMethod: prev?.emergencyContactPreferredMethod,
        nextOfKinNotifyMedical: prev?.emergencyContactNotifyMedical,
        nextOfKinHandlesAffairs: prev?.emergencyContactHandlesAffairs,
      }));
    }
  };

// Own-profile flag at COMPONENT scope — the HOR month submit/approve UI in the
// render references isOwnProfile, so it must live here, not only inside the
// canEdit IIFE below (where it was trapped, causing the render ReferenceError).
const isOwnProfile = session?.user?.id === crewId;

const canEdit = (() => {
  const currentUserId = session?.user?.id;

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

  // Comprehensive list of nationalities — shared with the passport document
  // field via src/data/nationalities.js so the two never disagree.
  const nationalityOptions = NATIONALITY_OPTIONS;

  const navigationSections = [
    { key: 'personal', label: 'Personal Details', icon: 'User' },
    { key: 'statement', label: 'Profile statement', icon: 'PenLine' },
    { key: 'emergency', label: 'Emergency / Next of Kin', icon: 'Phone' },
    { key: 'documents', label: 'Documents', icon: 'FileText' },
    { key: 'banking', label: 'Banking', icon: 'CreditCard' },
    { key: 'preferences', label: 'Preferences', icon: 'Utensils' },
    { key: 'documents', label: 'Documents', icon: 'FileText' },
    { key: 'hor', label: 'Hours of Rest (HOR)', icon: 'Clock' },
    { key: 'seatime', label: 'Sea Time Tracker', icon: 'Ship' },
    { key: 'history', label: 'Activity', icon: 'Activity' },
    { key: 'contract', label: 'Contract / Employment', icon: 'FileSignature' },
    { key: 'kit', label: 'Issued Kit', icon: 'Shirt' },
    { key: 'permissions', label: 'Permissions', icon: 'ShieldCheck' },
    { key: 'notifications', label: 'Notifications', icon: 'Bell' },
  ];

  // Grouped left rail (Option C): items live under quiet section labels.
  const navGroups = [
    { label: 'Profile', keys: ['personal', 'statement', 'emergency', 'banking', 'preferences', 'documents'] },
    { label: 'Employment', keys: ['contract', 'kit'] },
    { label: 'Compliance', keys: ['hor', 'seatime'] },
    { label: 'Activity', keys: ['history'] },
    { label: 'Settings', keys: ['permissions', 'notifications'] },
  ];

  const canEditStatus = isVesselAdmin || currentUserPermissionTier === 'COMMAND';
  // Permissions are admin-only: COMMAND / vessel admin may set them. Everyone
  // else — including crew viewing their OWN profile — sees them read-only.
  const canEditPermissions = isVesselAdmin || currentUserPermissionTier === 'COMMAND';

  // Persist one or more per-user capability flags on tenant_members. RLS allows
  // only COMMAND to update tenant_members, matching canEditPermissions. `patch`
  // uses DB column names; `local` is the camelCase merge into crewMember.
  const updateCaps = async (patch, local, savingKey) => {
    if (!canEditPermissions || !crewId || !activeTenantId || permSaving) return;
    setPermSaving(savingKey || true);
    const prevSnapshot = crewMember;
    setCrewMember((prev) => ({ ...prev, ...local }));   // optimistic
    const { error } = await supabase
      .from('tenant_members')
      .update(patch)
      .eq('user_id', crewId)
      .eq('tenant_id', activeTenantId);
    setPermSaving(false);
    if (error) {
      setCrewMember(prevSnapshot);   // revert
      showToast(error?.message || 'Couldn’t update permission', 'error');
    }
  };

  // Notification preferences are personal: only the profile owner manages their
  // own (RLS scopes reads/writes to auth.uid()). Load once the section opens.
  // (isOwnProfile is already defined at the top of the component.)
  useEffect(() => {
    if (activeSection !== 'notifications' || !isOwnProfile || notifPrefs !== null) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (cancelled) return;
      // Missing row = all categories on (the table default).
      setNotifPrefs(data || {
        notify_rota_submissions: true,
        notify_rota_decisions: true,
        notify_hor_reminders: true,
        notify_provisioning_approvals: true,
        notify_document_expiry: true,
        notify_returns: true,
      });
    })();
    return () => { cancelled = true; };
  }, [activeSection, isOwnProfile, notifPrefs, session?.user?.id]);

  const handleToggleNotif = async (key) => {
    if (!isOwnProfile || notifSavingKey) return;
    const next = { ...notifPrefs, [key]: !notifPrefs?.[key] };
    setNotifPrefs(next);   // optimistic
    setNotifSavingKey(key);
    const { error } = await supabase
      .from('notification_preferences')
      .upsert(
        { user_id: session.user.id, [key]: next[key], updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    setNotifSavingKey(null);
    if (error) {
      setNotifPrefs((prev) => ({ ...prev, [key]: !next[key] }));   // revert
      showToast(error?.message || 'Couldn’t update notification preference', 'error');
    }
  };

  // Notification categories surfaced in the settings section.
  const NOTIF_CATEGORIES = [
    { key: 'notify_rota_submissions', label: 'Rota sent for acceptance', desc: 'A rota submitted to you for approval.', email: true },
    { key: 'notify_rota_decisions', label: 'Rota approved or sent back', desc: 'Decisions on a rota you submitted.', email: true },
    { key: 'notify_hor_reminders', label: 'Hours of rest reminders', desc: 'Unlogged days, sign-off due, and overdue months.', email: true },
    { key: 'notify_provisioning_approvals', label: 'Provisioning approvals', desc: 'Boards awaiting you, and decisions on yours.', email: false },
    { key: 'notify_document_expiry', label: 'Document expiries', desc: 'Certificates expiring within 90 days.', email: false },
    { key: 'notify_returns', label: 'Return confirmations', desc: 'When a return you’re involved in is confirmed.', email: false },
  ];

  // ── Contract / Employment ───────────────────────────────────────────────────
  // crew_employment is readable by the owner + COMMAND; crew_compensation is
  // COMMAND-only (separate table so pay can't leak to the owner via RLS). Both
  // are COMMAND-editable (canEditPermissions).
  const EMP_CONTRACT_TYPES = ['Permanent', 'Rotational', 'Seasonal', 'Temporary', 'Freelance', 'Daywork'];
  useEffect(() => {
    if (activeSection !== 'contract' || !crewId || !activeTenantId || empLoaded) return;
    let cancelled = false;
    (async () => {
      const { data: emp } = await supabase
        .from('crew_employment').select('*')
        .eq('tenant_id', activeTenantId).eq('user_id', crewId).maybeSingle();
      const { data: comp } = await supabase
        .from('crew_compensation').select('*')
        .eq('tenant_id', activeTenantId).eq('user_id', crewId).maybeSingle();
      // Vessel record — compliance (read-only) + the fields contract tokens need.
      const { data: vessel } = await supabase
        .from('vessels').select('name, flag, port_of_registry, imo_number, official_number, commercial_status, certified_commercial, company_name, company_address')
        .eq('tenant_id', activeTenantId).maybeSingle();
      // The captain is whoever holds the Captain role on this vessel — used to
      // fill {{captain_name}} on generated contracts (mirrors SeaTimeDashboard).
      const { data: cap } = await supabase
        .from('tenant_members')
        .select('user_id, profiles!tenant_members_user_id_fkey(full_name)')
        .eq('tenant_id', activeTenantId).eq('active', true).ilike('role', 'captain')
        .limit(1).maybeSingle();
      // Templates available + the crew member's most recent generated contract.
      let templates = [];
      try { templates = await fetchTemplates(activeTenantId); } catch { /* RLS / offline — leave empty */ }
      const { data: lastDoc } = await supabase
        .from('personal_documents')
        .select('updated_at, file_url, file_name')
        .eq('user_id', crewId).in('doc_type', ['generated_contract', 'employment_contract', 'Employment Contract'])
        .order('updated_at', { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      setEmpForm(emp || {});
      // null when the viewer can't read compensation (RLS) AND there's no row;
      // COMMAND always gets an object so the block renders for them.
      setCompForm(canEditPermissions ? (comp || {}) : (comp || null));
      setVesselCompliance({ ...(vessel || {}), captain_name: cap?.profiles?.full_name || '' });
      setTemplates(templates);
      setLastGenerated(lastDoc || null);
      setEmpLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [activeSection, crewId, activeTenantId, empLoaded, canEditPermissions]);

  const handleSaveEmployment = async () => {
    if (!canEditPermissions || empSaving) return;
    setEmpSaving(true);
    const empPatch = {
      tenant_id: activeTenantId, user_id: crewId,
      rank_held: empForm.rank_held || null,
      department: empForm.department || null,
      vessel_name: empForm.vessel_name || null,
      next_crew_change_date: empForm.next_crew_change_date || null,
      benefits: empForm.benefits || {},
      contract_type: empForm.contract_type || null,
      start_date: empForm.start_date || null,
      end_date: empForm.end_date || null,
      probation_end_date: empForm.probation_end_date || null,
      probation_period_days: empForm.probation_period_days == null || empForm.probation_period_days === ''
        ? null : Number(empForm.probation_period_days),
      rotation_pattern: empForm.rotation_pattern || null,
      leave_entitlement_days: empForm.leave_entitlement_days === '' || empForm.leave_entitlement_days == null
        ? null : Number(empForm.leave_entitlement_days),
      notice_period: empForm.notice_period || null,
      port_of_embarkation: empForm.port_of_embarkation || null,
      repatriation_destination: empForm.repatriation_destination || null,
      sea_reference: empForm.sea_reference || null,
      // flag_state / governing_law are now inherited from the vessel (read-only).
      updated_at: new Date().toISOString(),
    };
    const { error: empErr } = await supabase
      .from('crew_employment').upsert(empPatch, { onConflict: 'tenant_id,user_id' });
    let compErr = null;
    if (compForm) {
      const amt = compForm.salary_amount === '' || compForm.salary_amount == null ? null : Number(compForm.salary_amount);
      const period = compForm.salary_period === 'year' ? 'year' : 'month';
      // Day rate derives from the annualised salary / 365.
      const dayRate = amt != null ? Math.round((amt * (period === 'year' ? 1 : 12) / 365) * 100) / 100 : null;
      const compPatch = {
        tenant_id: activeTenantId, user_id: crewId,
        salary_amount: amt,
        salary_currency: compForm.salary_currency || null,
        salary_period: period,
        day_rate: dayRate,
        updated_at: new Date().toISOString(),
      };
      ({ error: compErr } = await supabase
        .from('crew_compensation').upsert(compPatch, { onConflict: 'tenant_id,user_id' }));
    }
    setEmpSaving(false);
    if (empErr || compErr) {
      showToast((empErr || compErr)?.message || 'Couldn’t save employment details', 'error');
      return;
    }
    setEmpEditing(false);
    showToast('Employment details saved', 'success');
  };

  // Fill the chosen template with this profile's data, download it, and file a
  // copy under the crew member's Documents. If no template is chosen yet, fall
  // back to the single role match (or open the picker when it's ambiguous).
  const handleGenerateContract = async (templateArg) => {
    if (generating) return;
    let template = templateArg || selectedTemplate;
    if (!template) {
      const fits = templates.filter((t) => templateFitsRole(t, crewMember?.roleTitle));
      const pool = fits.length ? fits : templates;
      if (pool.length === 1) template = pool[0];
      else { setTemplateModalOpen(true); return; }   // 0 or many → let them choose
    }
    setGenerating(true);
    try {
      // Personal particulars (DOB, nationality, address, phone) live in the
      // Personal Details form, not on the base crewMember — merge them in so
      // the contract tokens fill. Passport comes from an uploaded passport doc;
      // if none yet, it stays blank (renders a fill-in line).
      const crewForTokens = {
        ...crewMember,
        dateOfBirth: formData?.dateOfBirth || crewMember?.dateOfBirth,
        nationality: formData?.nationality || crewMember?.nationality,
        passportNumber: formData?.passportNumber || crewMember?.passportNumber,
        placeOfBirth: formData?.placeOfBirth || crewMember?.placeOfBirth,
        homeAddress: formData?.homeAddress || crewMember?.homeAddress,
        phoneNumber: formData?.phoneNumber || crewMember?.phoneNumber,
      };
      const tokens = buildContractTokens({ crewMember: crewForTokens, empForm, compForm, vessel: vesselCompliance });
      const blob = await generateContractBlob(template, tokens);
      const ext = isPdfTemplate(template) ? 'pdf' : 'docx';
      const mime = isPdfTemplate(template) ? 'application/pdf' : TEMPLATE_MIME;
      const safeName = (crewMember?.fullName || 'Contract').replace(/[^\w\s-]/g, '').trim();
      const fileName = `${safeName} — ${template.name}.${ext}`;
      // Download for the user…
      saveAs(blob, fileName);
      // A generated contract is a DRAFT, not the record of truth — it isn't filed
      // under Issued documents (that's for the signed-by-both version, uploaded
      // by COMMAND). We keep only the latest draft, hidden, for the re-download
      // link in "Last generated".
      const file = new File([blob], fileName, { type: mime });
      await supabase.from('personal_documents')
        .delete().eq('user_id', crewId).eq('doc_type', 'generated_contract');
      const uploaded = await uploadDocumentFile(crewId, file);
      const saved = await saveCrewDocument({
        userId: crewId, tenantId: activeTenantId, createdBy: session?.user?.id,
        category: 'generated', docType: 'generated_contract', title: template.name,
        fileUrl: uploaded.file_url, fileName: uploaded.file_name,
        mimeType: uploaded.mime_type, sizeBytes: uploaded.size_bytes,
      });
      setSelectedTemplate(template);
      setLastGenerated({ updated_at: saved?.updated_at || new Date().toISOString(), file_url: uploaded.file_url, file_name: fileName });
      showToast('Draft contract generated and downloaded. Upload the signed copy to Issued documents when ready.', 'success');
    } catch (e) {
      console.error('[contract] generation failed', e);
      showToast(e?.properties?.errors?.[0]?.message || e?.message || 'Could not generate the contract.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleProfileStatusChange = async (newStatus, notes, effectiveDate, effectiveTime = '00:00') => {
    if (!activeTenantId || !crewId) return;
    setStatusChangeSaving(true);

    const [ey, em, ed] = effectiveDate.split('-').map(Number);
    const [eh, emin] = (effectiveTime || '00:00').split(':').map(Number);
    const changedAt = new Date(ey, em - 1, ed, eh, emin).toISOString();
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    const isEffectiveNow = new Date(ey, em - 1, ed) <= todayMidnight;

    try {
      const { error: histErr } = await supabase.from('crew_status_history').insert({
        tenant_id:  activeTenantId,
        user_id:    crewId,
        old_status: crewMember?.status,
        new_status: newStatus,
        changed_by: session?.user?.id,
        changed_at: changedAt,
        notes:      notes || null,
      });
      if (histErr) { showToast(histErr.message || 'Failed to log status', 'error'); return; }

      if (isEffectiveNow) {
        const { error } = await supabase
          .from('tenant_members')
          .update({ status: newStatus })
          .eq('user_id', crewId)
          .eq('tenant_id', activeTenantId);
        if (error) { showToast(error?.message || 'Failed to update status', 'error'); return; }
        setCrewMember(prev => ({ ...prev, status: newStatus }));
      }
      setStatusChangeModalOpen(false);
    } finally {
      setStatusChangeSaving(false);
    }
  };

  const renderHeader = () => {
    if (!crewMember) return null;

    const headlineTitle = crewMember?.firstName || crewMember?.fullName || 'Crew';
    const headlineQualifier = crewMember?.lastName || 'Profile';
    const tierLabel = crewMember?.effectiveTier ? getTierDisplayName(crewMember?.effectiveTier) : null;
    const sinceLabel = crewMember?.startDate
      ? new Date(crewMember?.startDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
      : null;
    const completion = computeProfileCompletion({ formData, crewMember, docs: crewDocs });
    // Profile-completion ring drawn around the avatar (r=52 in a 112 viewBox).
    const RING_C = 2 * Math.PI * 52;
    const ringPct = Math.max(0, Math.min(100, Math.round(completion.percent || 0)));
    const ringComplete = ringPct >= 100;
    const ringOffset = RING_C * (1 - ringPct / 100);

    return (
      <div className="mb-8">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-6">
            {/* Profile Photo — clickable upload, wrapped in the completion ring */}
            <div className="flex flex-col items-center gap-2 cp-avatar-col" ref={completionRef}>
              <div className="cp-avatar-ring">
                <svg className="cp-avatar-ring-svg" viewBox="0 0 112 112" aria-hidden="true">
                  <circle className="track" cx="56" cy="56" r="52" />
                  <circle
                    className={`fill${ringComplete ? ' is-complete' : ''}`}
                    cx="56"
                    cy="56"
                    r="52"
                    transform="rotate(-90 56 56)"
                    strokeDasharray={RING_C}
                    strokeDashoffset={ringOffset}
                  />
                </svg>
                <div
                  onClick={handleAvatarClick}
                  className={`cp-avatar-photo w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden relative ${
                    canEdit ? 'cursor-pointer hover:ring-2 hover:ring-primary hover:ring-offset-2 hover:ring-offset-background transition-all' : ''
                  }`}
                >
                  {avatarUploading && (
                    <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
                      <LogoSpinner size={24} />
                    </div>
                  )}
                  {avatarPreview || crewMember?.avatarUrl ? (
                    <img
                      src={avatarPreview || crewMember?.avatarUrl}
                      alt={crewMember?.fullName}
                      className="w-full h-full object-cover"
                    />
                  ) : getInitials(crewMember?.fullName) ? (
                    <span className="text-primary font-semibold text-2xl tracking-wide">
                      {getInitials(crewMember?.fullName)}
                    </span>
                  ) : (
                    <Icon name="User" size={48} className="text-primary" />
                  )}
                </div>
                {ringComplete ? (
                  <span className="cp-avatar-pct is-complete" title="Profile complete">✓</span>
                ) : (
                  <button
                    type="button"
                    className={`cp-avatar-pct cp-avatar-pct-btn${completionOpen ? ' is-open' : ''}`}
                    onClick={() => setCompletionOpen((v) => !v)}
                    aria-expanded={completionOpen}
                    title={`${ringPct}% complete — ${completion.missing.length} to finish`}
                  >
                    {ringPct}%
                  </button>
                )}
              </div>
              {canEdit && (
                <p className="text-xs text-muted-foreground text-center max-w-[100px]">
                  Click to upload photo
                </p>
              )}

              {/* What's left to fill in — drops down from the % badge. */}
              {completionOpen && !ringComplete && completion.missing.length > 0 && (
                <div className="cp-completion-pop">
                  <div className="cp-completion-pop-head">
                    <span className="pct">{ringPct}% complete</span>
                    <span className="rem">{completion.missing.length} to finish</span>
                  </div>
                  <ul className="cp-completion-pop-list">
                    {completion.missing.map((m) => (
                      <li key={m.key}>
                        <button
                          type="button"
                          onClick={() => { setActiveSection(m.tab); setIsEditing(false); setCompletionOpen(false); }}
                        >
                          <span className="dot" />
                          <span className="lbl">{m.label}</span>
                          <span className="go">›</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Crew Info — canonical editorial headline */}
            <div className="pt-1">
              <div className="editorial-meta">
                <span className="dot">•</span>
                <span>{crewMember?.roleTitle || 'Crew'}</span>
                {crewMember?.department && (
                  <>
                    <span className="bar" />
                    <span>{crewMember?.department}</span>
                  </>
                )}
                {tierLabel && (
                  <>
                    <span className="bar" />
                    <span className="muted">{tierLabel}</span>
                  </>
                )}
                {sinceLabel && (
                  <>
                    <span className="bar" />
                    <span className="muted">Since {sinceLabel}</span>
                  </>
                )}
              </div>
              <h1 className="editorial-greeting">
                {headlineTitle}<span className="period">,</span>{' '}
                <em>{headlineQualifier}</em><span className="period">.</span>
              </h1>
              <div className="cp-completion-row">
                {crewMember?.status ? (
                  canEditStatus ? (
                    <button
                      onClick={() => setStatusChangeModalOpen(true)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity ${getStatusBadgeClasses(crewMember?.status)}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${getStatusDotClass(crewMember?.status)}`} />
                      {getStatusLabel(crewMember?.status)}
                      <Icon name="ChevronDown" size={10} />
                    </button>
                  ) : (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${getStatusBadgeClasses(crewMember?.status)}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${getStatusDotClass(crewMember?.status)}`} />
                      {getStatusLabel(crewMember?.status)}
                    </span>
                  )
                ) : null}
              </div>
            </div>
          </div>

          {/* Edit Button — only on the editable profile sections; the HOR,
              Documents, Sea Time and Status History tabs aren't edited here. */}
          {canEdit && ['personal', 'emergency', 'banking', 'preferences'].includes(activeSection) && (
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
    const dob_age = computeAge(formData?.dateOfBirth);
    const addressClasses = "flex w-full text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed";
    // Read-only passport mirror — single source of truth stays in Documents.
    const passportDoc = (crewDocs || []).find((d) => d.doc_type === 'passport');
    const passportSummary = passportDoc
      ? [
          passportDoc.document_number ? `••${String(passportDoc.document_number).slice(-4)}` : 'On file',
          passportDoc.expiry_date
            ? `expires ${new Date(`${String(passportDoc.expiry_date).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
            : null,
        ].filter(Boolean).join(' · ')
      : '';
    return (
      <div>
        <div className="cp-section-head">
          <span className="cp-section-num">01 /</span>
          <h3>Personal Details</h3>
        </div>

        {/* Identity */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Identity</span><span className="line" />
          </div>
          <div className="cp-grid">
          <div className="cp-field-full cp-name-row">
            <Field label="Prefix">
              {isEditing ? (
                <select
                  className="cp-inline-select"
                  value={formData?.prefix || ''}
                  onChange={(e) => handleInputChange('prefix', e?.target?.value)}
                >
                  <option value="">—</option>
                  {['Mr', 'Mrs', 'Ms', 'Miss', 'Mx', 'Dr', 'Capt', 'Chief', 'Sir', 'Dame'].map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <div className={`cp-static${formData?.prefix ? '' : ' cp-empty'}`}>{formData?.prefix || '—'}</div>
              )}
            </Field>
            <Field label="First Names" required>
              <Input
                value={formData?.firstName}
                onChange={(e) => handleInputChange('firstName', e?.target?.value)}
                disabled={!isEditing}
                placeholder="—"
              />
            </Field>
            <Field label="Last Name" required>
              <Input
                value={formData?.lastName}
                onChange={(e) => handleInputChange('lastName', e?.target?.value)}
                disabled={!isEditing}
                placeholder="—"
              />
            </Field>
          </div>
          <div className="cp-field-full cp-name-row">
            <Field label="Sex">
              {isEditing ? (
                <select
                  className="cp-inline-select"
                  value={formData?.sex || ''}
                  onChange={(e) => handleInputChange('sex', e?.target?.value)}
                >
                  <option value="">—</option>
                  {['Female', 'Male', 'Prefer not to say'].map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <div className={`cp-static${formData?.sex ? '' : ' cp-empty'}`}>{formData?.sex || '—'}</div>
              )}
            </Field>
            <Field label="Pronouns">
              {isEditing ? (
                <select
                  className="cp-inline-select"
                  value={formData?.pronouns || ''}
                  onChange={(e) => handleInputChange('pronouns', e?.target?.value)}
                >
                  <option value="">—</option>
                  {['she/her', 'he/him', 'they/them', 'she/they', 'he/they', 'Prefer not to say'].map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <div className={`cp-static${formData?.pronouns ? '' : ' cp-empty'}`}>{formData?.pronouns || '—'}</div>
              )}
            </Field>
            <Field label="Preferred Name">
              <Input
                value={formData?.preferredName}
                onChange={(e) => handleInputChange('preferredName', e?.target?.value)}
                disabled={!isEditing}
                placeholder="—"
              />
            </Field>
          </div>
          <Field label="Date of Birth">
            {isEditing ? (
              <EditorialDatePicker
                value={(formData?.dateOfBirth || '').slice(0, 10)}
                onChange={(iso) => handleInputChange('dateOfBirth', iso)}
                placeholder="dd/mm/yyyy"
              />
            ) : (
              <div className={`cp-static${formData?.dateOfBirth ? '' : ' cp-empty'}`}>
                {formData?.dateOfBirth ? (
                  <>
                    {new Date(`${String(formData.dateOfBirth).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    {dob_age != null && <span className="cp-age-inline">Age {dob_age}</span>}
                  </>
                ) : '—'}
              </div>
            )}
          </Field>
          <Field label="Place of Birth">
            <Input
              value={formData?.placeOfBirth}
              onChange={(e) => handleInputChange('placeOfBirth', e?.target?.value)}
              disabled={!isEditing}
              placeholder={isEditing ? 'e.g. Cape Town, South Africa' : '—'}
            />
          </Field>
          <Field label="Nationality">
            <Select
              options={nationalityOptions}
              value={formData?.nationality}
              onChange={(value) => handleInputChange('nationality', value)}
              disabled={!isEditing}
              searchable={true}
              placeholder="Select nationality"
            />
          </Field>
          <Field label="Second Nationality" hint={isEditing ? 'Optional' : undefined}>
            <Select
              options={nationalityOptions}
              value={formData?.secondNationality}
              onChange={(value) => handleInputChange('secondNationality', value)}
              disabled={!isEditing}
              searchable={true}
              placeholder="None"
            />
          </Field>
          <Field label="Passport">
            <div className="cp-static cp-birthday">
              {passportSummary
                ? <span>{passportSummary}</span>
                : <span className="cp-empty">Not added</span>}
              <button type="button" className="cp-allergy-jump" onClick={() => { setActiveSection('documents'); setIsEditing(false); }}>
                {passportDoc ? 'Documents' : 'Add in Documents'} ›
              </button>
            </div>
          </Field>
          <Field label="Dual Passport">
            {isEditing ? (
              <div className="cp-check-row">
                <label className="cp-inline-check">
                  <input
                    type="checkbox"
                    checked={!!formData?.dualPassport}
                    onChange={(e) => handleInputChange('dualPassport', e?.target?.checked)}
                  />
                  <span>Holds a second passport</span>
                </label>
              </div>
            ) : (
              <div className="cp-role-tags">
                {formData?.dualPassport
                  ? <span className="cp-tag">Dual passport</span>
                  : <span className="cp-static cp-empty">No</span>}
              </div>
            )}
          </Field>
          <Field label="Discharge Book № / SID" hint={isEditing ? "Seaman's Discharge Book or SID" : undefined}>
            <Input
              value={formData?.dischargeBookNumber}
              onChange={(e) => handleInputChange('dischargeBookNumber', e?.target?.value)}
              disabled={!isEditing}
              placeholder="—"
            />
          </Field>
          <Field label="Nautilus / PYA membership №" hint={isEditing ? 'Auto-fills your sea-service testimonial export' : undefined}>
            <Input
              value={formData?.verifierMembershipNumber}
              onChange={(e) => handleInputChange('verifierMembershipNumber', e?.target?.value)}
              disabled={!isEditing}
              placeholder="—"
            />
          </Field>
          </div>
        </div>

        {/* Contact */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Contact</span><span className="line" />
          </div>
          <div className="cp-grid">
          <Field label="Phone Numbers" full>
            <PhonesEditor
              phones={formData?.phones}
              disabled={!isEditing}
              onChange={(next) => handleInputChange('phones', next)}
            />
          </Field>
          <Field label="Email" required>
            <Input
              type="email"
              value={formData?.email}
              onChange={(e) => handleInputChange('email', e?.target?.value)}
              disabled={!isEditing}
              placeholder="—"
            />
          </Field>
          <Field label="Secondary Email">
            <Input
              type="email"
              value={formData?.secondaryEmail}
              onChange={(e) => handleInputChange('secondaryEmail', e?.target?.value)}
              disabled={!isEditing}
              placeholder="—"
            />
          </Field>
          <Field label="Home Address" full>
            <Input
              value={formData?.homeAddress}
              onChange={(e) => handleInputChange('homeAddress', e?.target?.value)}
              disabled={!isEditing}
              placeholder="—"
            />
          </Field>
          </div>
        </div>

        {/* Medical */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Medical</span><span className="line" />
          </div>
          <div className="cp-grid">
          <Field label="Allergies" full hint={isEditing ? 'Confirm status, then add detail if any' : undefined}>
            {isEditing ? (
              <>
                <select
                  className="cp-inline-select"
                  value={formData?.allergiesStatus || ''}
                  onChange={(e) => handleInputChange('allergiesStatus', e?.target?.value)}
                >
                  <option value="">— Select —</option>
                  <option value="no_known">No known allergies</option>
                  <option value="not_provided">Not yet provided</option>
                  <option value="has">Has allergies</option>
                </select>
                {formData?.allergiesStatus === 'has' && (
                  <div className="mt-2">
                    <TagInput
                      value={formData?.allergies}
                      onChange={(next) => handleInputChange('allergies', next)}
                      placeholder="Add an allergy, then Enter"
                    />
                  </div>
                )}
                {formData?.allergiesStatus === 'no_known' && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Confirmed on</span>
                    <EditorialDatePicker
                      value={(formData?.allergiesConfirmedAt || '').slice(0, 10)}
                      onChange={(iso) => handleInputChange('allergiesConfirmedAt', iso)}
                      placeholder="dd/mm/yyyy"
                    />
                  </div>
                )}
              </>
            ) : (
              <div className={`cp-static${(formData?.allergiesStatus || formData?.allergies) ? '' : ' cp-empty'}`}>
                {allergiesReadText(formData)}
              </div>
            )}
          </Field>
          <Field label="Medical Conditions" hint={isEditing ? 'Add each condition, then Enter' : undefined}>
            <TagInput
              value={formData?.medicalConditions}
              onChange={(next) => handleInputChange('medicalConditions', next)}
              disabled={!isEditing}
              placeholder="None recorded"
            />
          </Field>
          <Field label="Blood Type">
            {isEditing ? (
              <select
                className="cp-inline-select"
                value={formData?.bloodType || ''}
                onChange={(e) => handleInputChange('bloodType', e?.target?.value)}
              >
                <option value="">—</option>
                {['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−', 'Unknown'].map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            ) : (
              <div className={`cp-static${formData?.bloodType ? '' : ' cp-empty'}`}>{formData?.bloodType || '—'}</div>
            )}
          </Field>
          <Field label="Emergency Medications" full hint={isEditing ? 'Critical/regular meds first responders should know about' : undefined}>
            <textarea
              className={addressClasses}
              value={formData?.emergencyMedications}
              onChange={(e) => handleInputChange('emergencyMedications', e?.target?.value)}
              disabled={!isEditing}
              placeholder={isEditing ? 'e.g. Salbutamol inhaler (asthma); EpiPen — nut allergy' : '—'}
            />
          </Field>
          <Field label="Doctor / GP Name">
            <Input
              value={formData?.doctorContactName}
              onChange={(e) => handleInputChange('doctorContactName', e?.target?.value)}
              disabled={!isEditing}
              placeholder="—"
            />
          </Field>
          <Field label="Doctor / GP Phone">
            <Input
              value={formData?.doctorContactPhone}
              onChange={(e) => handleInputChange('doctorContactPhone', e?.target?.value)}
              disabled={!isEditing}
              placeholder="—"
            />
          </Field>
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

  const renderEmergencyContact = () => {
    const addressClasses = "flex w-full text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed";
    const CONTACT_METHODS = ['Call', 'WhatsApp', 'Text / SMS', 'Email', 'Any'];

    // Small read/edit select for "preferred contact method". Plain helper
    // (not an inner component) so React keeps the inputs mounted across renders.
    const methodField = (field, disabled = false) => (
      isEditing && !disabled ? (
        <select
          className="cp-inline-select"
          value={formData?.[field] || ''}
          onChange={(e) => handleInputChange(field, e?.target?.value)}
        >
          <option value="">—</option>
          {CONTACT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      ) : (
        <div className={`cp-static${formData?.[field] ? '' : ' cp-empty'}`}>{formData?.[field] || '—'}</div>
      )
    );

    // "Last verified" date + a gentle stale flag (>12 months → please reverify),
    // so old numbers get refreshed rather than silently rotting.
    const verifiedField = (field, disabled = false) => {
      const v = formData?.[field];
      const stale = v && (Date.now() - new Date(v).getTime()) > 365 * 24 * 60 * 60 * 1000;
      return (
        <Field label="Last Verified" hint={isEditing && !disabled ? 'Date you last confirmed these details' : undefined}>
          {isEditing && !disabled ? (
            <EditorialDatePicker
              value={(v || '').slice(0, 10)}
              onChange={(iso) => handleInputChange(field, iso)}
              placeholder="dd/mm/yyyy"
            />
          ) : (
            <div className={`cp-static${v ? '' : ' cp-empty'}`}>
              {v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not verified'}
              {stale && <span className="cp-stale-flag">⚠ please reverify</span>}
            </div>
          )}
        </Field>
      );
    };

    // Role tags (medical / handles-affairs) for any contact, keyed by prefix.
    const roleField = (prefix, disabled = false) => (
      <Field label="This contact's role" hint={isEditing && !disabled ? 'Flag what this person handles — they may differ' : undefined}>
        {isEditing && !disabled ? (
          <div className="cp-check-row">
            <label className="cp-inline-check">
              <input
                type="checkbox"
                checked={!!formData?.[`${prefix}NotifyMedical`]}
                onChange={(e) => handleInputChange(`${prefix}NotifyMedical`, e?.target?.checked)}
              />
              <span>Notify in a medical emergency</span>
            </label>
            <label className="cp-inline-check">
              <input
                type="checkbox"
                checked={!!formData?.[`${prefix}HandlesAffairs`]}
                onChange={(e) => handleInputChange(`${prefix}HandlesAffairs`, e?.target?.checked)}
              />
              <span>Handles affairs / decisions</span>
            </label>
          </div>
        ) : (
          <div className="cp-role-tags">
            {formData?.[`${prefix}NotifyMedical`] && <span className="cp-tag">Medical emergency</span>}
            {formData?.[`${prefix}HandlesAffairs`] && <span className="cp-tag">Handles affairs</span>}
            {!formData?.[`${prefix}NotifyMedical`] && !formData?.[`${prefix}HandlesAffairs`] && (
              <span className="cp-static cp-empty">No role flagged</span>
            )}
          </div>
        )}
      </Field>
    );

    // One shared contact field-set used by all three blocks (primary emergency,
    // second emergency, next of kin), keyed by a formData prefix. `disabled`
    // layers on top of !isEditing (e.g. next-of-kin "same as emergency").
    const contactFields = (prefix, { disabled = false, requiredName = false, requiredPhone = false } = {}) => {
      const dis = !isEditing || disabled;
      return (
        <>
          <Field label="Full Name" required={requiredName}>
            <Input value={formData?.[`${prefix}Name`]} onChange={(e) => handleInputChange(`${prefix}Name`, e?.target?.value)} disabled={dis} placeholder="—" />
          </Field>
          <Field label="Relationship">
            <Input value={formData?.[`${prefix}Relationship`]} onChange={(e) => handleInputChange(`${prefix}Relationship`, e?.target?.value)} disabled={dis} placeholder="—" />
          </Field>
          <Field label="Phone / Contact Number" required={requiredPhone}>
            <Input value={formData?.[`${prefix}Phone`]} onChange={(e) => handleInputChange(`${prefix}Phone`, e?.target?.value)} disabled={dis} placeholder="—" />
          </Field>
          <Field label="Email">
            <Input type="email" value={formData?.[`${prefix}Email`]} onChange={(e) => handleInputChange(`${prefix}Email`, e?.target?.value)} disabled={dis} placeholder="—" />
          </Field>
          <Field label="Country / Time Zone" hint={isEditing && !disabled ? "So crew know when it's a sensible hour to call" : undefined}>
            <Input value={formData?.[`${prefix}Country`]} onChange={(e) => handleInputChange(`${prefix}Country`, e?.target?.value)} disabled={dis} placeholder={dis ? '—' : 'e.g. UK (GMT/BST)'} />
          </Field>
          <Field label="Preferred Contact Method">
            {methodField(`${prefix}PreferredMethod`, disabled)}
          </Field>
          <Field label="Address" full>
            <textarea className={addressClasses} value={formData?.[`${prefix}Address`]} onChange={(e) => handleInputChange(`${prefix}Address`, e?.target?.value)} disabled={dis} placeholder="—" />
          </Field>
          {roleField(prefix, disabled)}
          {verifiedField(`${prefix}LastVerified`, disabled)}
        </>
      );
    };

    const hasSecond = !!(formData?.emergencyContact2Name || formData?.emergencyContact2Phone);
    const secondOpen = showSecondEmergency || hasSecond;

    return (
      <div>
        <div className="cp-section-head">
          <span className="cp-section-num">03 /</span>
          <h3>Emergency</h3>
        </div>

        {/* Emergency Contact (primary) */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Primary emergency contact</span><span className="line" />
          </div>
          <div className="cp-grid">
            {contactFields('emergencyContact', { requiredName: true, requiredPhone: true })}
          </div>
        </div>

        {/* Second emergency contact — the first is often unreachable mid-passage. */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Second emergency contact</span><span className="line" />
            {isEditing && !secondOpen && (
              <button type="button" className="cp-phone-add" onClick={() => setShowSecondEmergency(true)}>+ Add a backup contact</button>
            )}
          </div>
          {secondOpen && (
            <div className="cp-grid">
              {contactFields('emergencyContact2')}
            </div>
          )}
        </div>

        {/* Next of Kin */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Next of kin</span><span className="line" />
            {isEditing && (
              <label className="cp-inline-check">
                <input
                  type="checkbox"
                  checked={sameAsEmergency}
                  onChange={(e) => handleSameAsEmergencyToggle(e?.target?.checked)}
                />
                <span>Same as emergency contact</span>
              </label>
            )}
          </div>
          <div className="cp-grid">
            {contactFields('nextOfKin', { disabled: sameAsEmergency })}
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

    const hasSecondAccount = !!(formData?.bank2AccountHolder || formData?.bank2AccountNumber);
    const secondAccountOpen = showSecondAccount || hasSecondAccount;
    const show2SortCode = formData?.bank2Country === 'United Kingdom';
    const show2RoutingNumber = formData?.bank2Country === 'United States';

    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="cp-section-head">
              <span className="cp-section-num">04 /</span>
              <h3>Banking</h3>
            </div>
          </div>
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

        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Account</span><span className="line" />
          </div>
          <div className="cp-grid">
            <Field label="Account Holder Name" required>
              <Input
                value={formData?.bankAccountHolder}
                onChange={(e) => handleInputChange('bankAccountHolder', e?.target?.value)}
                disabled={!isEditing}
                placeholder="—"
              />
            </Field>
            <Field label="Bank Name" required>
              <Input
                value={formData?.bankName}
                onChange={(e) => handleInputChange('bankName', e?.target?.value)}
                disabled={!isEditing}
                placeholder="—"
              />
            </Field>
            <Field label="Account Number / IBAN" required hint="Masked for security">
              <Input
                value={maskAccountNumber(formData?.bankAccountNumber)}
                onChange={(e) => handleInputChange('bankAccountNumber', e?.target?.value)}
                disabled={!isEditing}
                placeholder="—"
              />
              {isEditing && ibanWarning(formData?.bankAccountNumber) && (
                <p className="cp-field-warn">{ibanWarning(formData?.bankAccountNumber)}</p>
              )}
            </Field>
            <Field label="SWIFT / BIC">
              <Input
                value={formData?.bankSwiftBic}
                onChange={(e) => handleInputChange('bankSwiftBic', e?.target?.value)}
                disabled={!isEditing}
                placeholder="—"
              />
              {isEditing && swiftWarning(formData?.bankSwiftBic) && (
                <p className="cp-field-warn">{swiftWarning(formData?.bankSwiftBic)}</p>
              )}
            </Field>
            <Field label="Currency" required>
              <Select
                options={currencyOptions}
                value={formData?.bankCurrency}
                onChange={(value) => handleInputChange('bankCurrency', value)}
                disabled={!isEditing}
                searchable={true}
              />
            </Field>
            <Field label="Country" required>
              <Select
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
              />
            </Field>
            <Field label="Account Type">
              <Select
                options={accountTypeOptions}
                value={formData?.bankAccountType}
                onChange={(value) => handleInputChange('bankAccountType', value)}
                disabled={!isEditing}
                placeholder="Select account type (optional)"
              />
            </Field>
            {showSortCode && (
              <Field label="Sort Code" required hint="Format: XX-XX-XX">
                <Input
                  value={formData?.bankSortCode}
                  onChange={(e) => handleInputChange('bankSortCode', e?.target?.value)}
                  disabled={!isEditing}
                  placeholder="XX-XX-XX"
                />
              </Field>
            )}
            {showRoutingNumber && (
              <Field label="Routing Number (ABA)" required>
                <Input
                  value={formData?.bankRoutingNumber}
                  onChange={(e) => handleInputChange('bankRoutingNumber', e?.target?.value)}
                  disabled={!isEditing}
                  placeholder="9-digit routing number"
                />
              </Field>
            )}
          </div>
        </div>

        {/* Optional Bank Address Section */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Bank address</span>
            <span className="t" style={{ fontSize: 13, color: '#9098B1' }}>· optional</span>
            <span className="line" />
            <button
              type="button"
              onClick={() => setShowBankAddress(!showBankAddress)}
              className="cp-collapse-toggle"
              disabled={!isEditing}
            >
              <Icon name={showBankAddress ? 'ChevronDown' : 'ChevronRight'} size={15} />
              <span>{showBankAddress ? 'Hide' : 'Add'}</span>
            </button>
          </div>
          {showBankAddress && (
            <div className="cp-grid">
              <Field label="Address Line 1">
                <Input
                  value={formData?.bankAddressLine1}
                  onChange={(e) => handleInputChange('bankAddressLine1', e?.target?.value)}
                  disabled={!isEditing}
                  placeholder="—"
                />
              </Field>
              <Field label="Address Line 2" hint="Optional">
                <Input
                  value={formData?.bankAddressLine2}
                  onChange={(e) => handleInputChange('bankAddressLine2', e?.target?.value)}
                  disabled={!isEditing}
                  placeholder="—"
                />
              </Field>
              <Field label="City">
                <Input
                  value={formData?.bankAddressCity}
                  onChange={(e) => handleInputChange('bankAddressCity', e?.target?.value)}
                  disabled={!isEditing}
                  placeholder="—"
                />
              </Field>
              <Field label="Country">
                <Select
                  options={countryOptions}
                  value={formData?.bankAddressCountry}
                  onChange={(value) => handleInputChange('bankAddressCountry', value)}
                  disabled={!isEditing}
                  searchable={true}
                />
              </Field>
            </div>
          )}
        </div>

        {/* Optional Second Account — split payments */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Second account</span>
            <span className="t" style={{ fontSize: 13, color: '#9098B1' }}>· split payment, optional</span>
            <span className="line" />
            {isEditing && !secondAccountOpen && (
              <button type="button" className="cp-phone-add" onClick={() => setShowSecondAccount(true)}>+ Add a second account</button>
            )}
          </div>
          {secondAccountOpen && (
            <div className="cp-grid">
              <Field label="Split" full hint={isEditing ? 'How pay is divided between the two accounts' : undefined}>
                {isEditing ? (
                  <div className="cp-split-row">
                    <select
                      className="cp-inline-select"
                      value={formData?.bankSplitType || ''}
                      onChange={(e) => handleInputChange('bankSplitType', e?.target?.value)}
                    >
                      <option value="">—</option>
                      <option value="percent">% of net to this account</option>
                      <option value="fixed">Fixed amount to this account</option>
                    </select>
                    {formData?.bankSplitType && (
                      <input
                        className="cp-inline-box"
                        type="number"
                        min="0"
                        step={formData?.bankSplitType === 'percent' ? '1' : '0.01'}
                        value={formData?.bankSplitValue || ''}
                        onChange={(e) => handleInputChange('bankSplitValue', e?.target?.value)}
                        placeholder={formData?.bankSplitType === 'percent' ? 'e.g. 30' : 'e.g. 500'}
                      />
                    )}
                    {formData?.bankSplitType === 'percent' && <span className="cp-split-unit">%</span>}
                    {formData?.bankSplitType === 'fixed' && <span className="cp-split-unit">{formData?.bank2Currency || formData?.bankCurrency || ''}</span>}
                  </div>
                ) : (
                  <div className={`cp-static${formData?.bankSplitType && formData?.bankSplitValue ? '' : ' cp-empty'}`}>
                    {formData?.bankSplitType === 'percent' && formData?.bankSplitValue
                      ? `${formData.bankSplitValue}% of net to this account`
                      : formData?.bankSplitType === 'fixed' && formData?.bankSplitValue
                        ? `${formData?.bank2Currency || formData?.bankCurrency || ''} ${formData.bankSplitValue} to this account`
                        : 'No split set'}
                  </div>
                )}
              </Field>
              <Field label="Account Holder Name">
                <Input value={formData?.bank2AccountHolder} onChange={(e) => handleInputChange('bank2AccountHolder', e?.target?.value)} disabled={!isEditing} placeholder="—" />
              </Field>
              <Field label="Bank Name">
                <Input value={formData?.bank2Name} onChange={(e) => handleInputChange('bank2Name', e?.target?.value)} disabled={!isEditing} placeholder="—" />
              </Field>
              <Field label="Account Number / IBAN" hint="Masked for security">
                <Input value={maskAccountNumber(formData?.bank2AccountNumber)} onChange={(e) => handleInputChange('bank2AccountNumber', e?.target?.value)} disabled={!isEditing} placeholder="—" />
                {isEditing && ibanWarning(formData?.bank2AccountNumber) && (
                  <p className="cp-field-warn">{ibanWarning(formData?.bank2AccountNumber)}</p>
                )}
              </Field>
              <Field label="SWIFT / BIC">
                <Input value={formData?.bank2SwiftBic} onChange={(e) => handleInputChange('bank2SwiftBic', e?.target?.value)} disabled={!isEditing} placeholder="—" />
                {isEditing && swiftWarning(formData?.bank2SwiftBic) && (
                  <p className="cp-field-warn">{swiftWarning(formData?.bank2SwiftBic)}</p>
                )}
              </Field>
              <Field label="Currency">
                <Select options={currencyOptions} value={formData?.bank2Currency} onChange={(value) => handleInputChange('bank2Currency', value)} disabled={!isEditing} searchable={true} />
              </Field>
              <Field label="Country">
                <Select options={countryOptions} value={formData?.bank2Country} onChange={(value) => handleInputChange('bank2Country', value)} disabled={!isEditing} searchable={true} />
              </Field>
              <Field label="Account Type">
                <Select options={accountTypeOptions} value={formData?.bank2AccountType} onChange={(value) => handleInputChange('bank2AccountType', value)} disabled={!isEditing} placeholder="Select account type (optional)" />
              </Field>
              {show2SortCode && (
                <Field label="Sort Code" hint="Format: XX-XX-XX">
                  <Input value={formData?.bank2SortCode} onChange={(e) => handleInputChange('bank2SortCode', e?.target?.value)} disabled={!isEditing} placeholder="XX-XX-XX" />
                </Field>
              )}
              {show2RoutingNumber && (
                <Field label="Routing Number (ABA)">
                  <Input value={formData?.bank2RoutingNumber} onChange={(e) => handleInputChange('bank2RoutingNumber', e?.target?.value)} disabled={!isEditing} placeholder="9-digit routing number" />
                </Field>
              )}
            </div>
          )}
        </div>

        {/* Security Notice */}
        <div className="bg-[#EEF0F4] dark:bg-[#262A53]/30 border border-[#D9DCE8] dark:border-[#3A3F6B] rounded-lg p-4 mt-6">
          <p className="text-sm text-[#262A53] dark:text-[#B9BDDD] flex items-start gap-2">
            <Icon name="Lock" size={16} className="flex-shrink-0 mt-0.5" />
            <span>Banking information is encrypted and visible only to authorised personnel.</span>
          </p>
        </div>

        {/* Audit note — high-risk payroll data */}
        {(formData?.bankingLastEditedByName || formData?.bankingLastViewedByName) && (
          <p className="text-xs text-muted-foreground mt-3 flex flex-wrap gap-x-2">
            {formData?.bankingLastEditedByName && (
              <span>Last edited by {formData.bankingLastEditedByName}{formData?.bankingUpdatedAt ? ` · ${new Date(formData.bankingUpdatedAt).toLocaleString('en-GB')}` : ''}.</span>
            )}
            {formData?.bankingLastViewedByName && (
              <span>Last viewed by {formData.bankingLastViewedByName}{formData?.bankingLastViewedAt ? ` · ${new Date(formData.bankingLastViewedAt).toLocaleString('en-GB')}` : ''}.</span>
            )}
          </p>
        )}

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

    const appetiteOptions = [
      { value: 'Light', label: 'Light' },
      { value: 'Average', label: 'Average' },
      { value: 'Hearty', label: 'Hearty' }
    ];

    // Birthday is held once in Personal Details (date of birth) and shown here
    // as day + month, so the galley knows when to bake without re-keying it.
    const birthdayText = (() => {
      const raw = formData?.dateOfBirth;
      if (!raw) return '';
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    })();

    const handleSurpriseMe = () => {
      handleInputChange('cakePreference', "Chef's choice");
      setCakeSurprise(true);
      setTimeout(() => setCakeSurprise(false), 2000);
    };

    const taClass = "flex w-full text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed";
    return (
      <div>
        <div className="cp-section-head">
          <span className="cp-section-num">05 /</span>
          <h3>Preferences</h3>
        </div>

        {/* ◆ Dietary & safety — allergies are cross-referenced from Personal
            Details (single source of truth), with the dietary line alongside. */}
        {(() => {
          const hasAllergy = formData?.allergiesStatus === 'has'
            || (Array.isArray(formData?.allergies) ? formData.allergies.length > 0 : !!formData?.allergies);
          const unset = !formData?.allergiesStatus && !formData?.allergies;
          const tone = hasAllergy ? 'is-alert' : unset ? 'is-unset' : 'is-ok';
          return (
            <div className="cp-group">
              <div className="cp-group-head">
                <span className="dia">◆</span><span className="t">Dietary &amp; safety</span><span className="line" />
              </div>
              <div className={`cp-allergy-ref ${tone}`}>
                <Icon name={hasAllergy ? 'AlertTriangle' : unset ? 'HelpCircle' : 'ShieldCheck'} size={18} className="ic" />
                <div className="body">
                  <div className="lbl">Allergies {hasAllergy && <span className="sev">medical safety</span>}</div>
                  <div className="val">{allergiesReadText(formData)}</div>
                </div>
                <button type="button" className="cp-allergy-jump" onClick={() => { setActiveSection('personal'); setIsEditing(false); }}>
                  {unset ? 'Add in Personal Details' : 'Manage in Personal Details'} ›
                </button>
              </div>
              <div className="cp-grid cp-grid-spaced">
                <Field label="Dietary">
                  <Select
                    options={dietaryOptions}
                    value={formData?.dietaryCategory}
                    onChange={(value) => handleInputChange('dietaryCategory', value)}
                    disabled={!isEditing}
                    searchable={true}
                  />
                </Field>
                <Field label="Additional notes">
                  <Input
                    value={formData?.dietaryNotes}
                    onChange={(e) => handleInputChange('dietaryNotes', e?.target?.value)}
                    disabled={!isEditing}
                    placeholder={isEditing ? 'e.g. intolerances, textures to avoid' : '—'}
                  />
                </Field>
              </div>
              <p className="cp-allergy-note">Allergies are held once in Personal Details so the galley and HODs always see the same record — update them there and they stay in sync here.</p>
            </div>
          );
        })()}

        {/* ◆ How you like to eat */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">How you like to eat</span><span className="line" />
          </div>
          <div className="cp-grid">
            <Field label="Appetite">
              {isEditing ? (
                <Select
                  options={appetiteOptions}
                  value={formData?.appetite}
                  onChange={(value) => handleInputChange('appetite', value)}
                  placeholder="Select"
                />
              ) : (
                <div className={`cp-static${formData?.appetite ? '' : ' cp-empty'}`}>
                  {formData?.appetite || '—'}
                </div>
              )}
            </Field>
            <Field label="Spice">
              <SpiceField
                value={formData?.spiceLevel}
                disabled={!isEditing}
                onChange={(value) => handleInputChange('spiceLevel', value)}
              />
            </Field>
            <Field label="Breakfast">
              <Input
                value={formData?.breakfast}
                onChange={(e) => handleInputChange('breakfast', e?.target?.value)}
                disabled={!isEditing}
                placeholder={isEditing ? 'e.g. Grab-and-go, full cooked' : '—'}
              />
            </Field>
            <Field label="Snacks">
              <Input
                value={formData?.favouriteSnacks}
                onChange={(e) => handleInputChange('favouriteSnacks', e?.target?.value)}
                disabled={!isEditing}
                placeholder={isEditing ? 'e.g. Salted nuts, dark chocolate' : '—'}
              />
            </Field>
          </div>
        </div>

        {/* ◆ Coffee & tea */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Coffee &amp; tea</span><span className="line" />
          </div>
          <div className="cp-grid">
            <Field label="Coffee order">
              <Input
                value={formData?.coffeeOrder}
                onChange={(e) => handleInputChange('coffeeOrder', e?.target?.value)}
                disabled={!isEditing}
                placeholder={isEditing ? 'e.g. Flat white, oat, no sugar' : '—'}
              />
            </Field>
            <Field label="Tea">
              <Input
                value={formData?.tea}
                onChange={(e) => handleInputChange('tea', e?.target?.value)}
                disabled={!isEditing}
                placeholder={isEditing ? 'e.g. Builders, splash of milk' : '—'}
              />
            </Field>
          </div>
        </div>

        {/* ◆ Tastes — Loves reuses the existing favouriteMeals store as a tag list. */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Tastes</span><span className="line" />
          </div>
          <div className="cp-grid">
            <Field label="Loves">
              <TagInput
                value={formData?.favouriteMeals}
                disabled={!isEditing}
                onChange={(value) => handleInputChange('favouriteMeals', value)}
                placeholder="Asian, fresh seafood… (Enter)"
              />
            </Field>
            <Field label="Rather avoid">
              <TagInput
                value={formData?.avoid}
                disabled={!isEditing}
                onChange={(value) => handleInputChange('avoid', value)}
                placeholder="Pork, mushrooms… (Enter)"
              />
            </Field>
            <Field label="Anything else" full>
              <textarea
                className={taClass}
                value={formData?.tasteNotes}
                onChange={(e) => handleInputChange('tasteNotes', e?.target?.value)}
                disabled={!isEditing}
                placeholder={isEditing ? 'e.g. Loves blue cheese · no pineapple on pizza' : '—'}
              />
            </Field>
          </div>
        </div>

        {/* ◆ A little about you */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">A little about you</span><span className="line" />
            {isEditing && (
              <Button variant="outline" size="sm" onClick={handleSurpriseMe} iconName="Sparkles">
                Surprise me
              </Button>
            )}
          </div>
          <div className="cp-grid">
            <Field label="Birthday">
              <div className="cp-static cp-birthday">
                {birthdayText
                  ? <span>{birthdayText}</span>
                  : <span className="cp-empty">Not set</span>}
                <button type="button" className="cp-allergy-jump" onClick={() => { setActiveSection('personal'); setIsEditing(false); }}>
                  {birthdayText ? 'Personal Details' : 'Add in Personal Details'} ›
                </button>
              </div>
            </Field>
            <Field label="Birthday cake">
              <Input
                value={formData?.cakePreference}
                onChange={(e) => handleInputChange('cakePreference', e?.target?.value)}
                disabled={!isEditing}
                placeholder={isEditing ? 'e.g. Chocolate, vanilla sponge' : '—'}
              />
            </Field>
            <Field label="Comfort food / pick-me-up" full>
              <Input
                value={formData?.comfortFood}
                onChange={(e) => handleInputChange('comfortFood', e?.target?.value)}
                disabled={!isEditing}
                placeholder={isEditing ? 'e.g. Mac & cheese after a rough watch' : '—'}
              />
            </Field>
          </div>
          {cakeSurprise && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-2 flex items-center gap-1">
              <Icon name="Check" size={12} />
              Surprise option selected!
            </p>
          )}
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

  const monthLabelFor = (d) => d?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Crew submits their own month — opens the sign-off modal; the actual submit
  // runs on confirm, carrying the captured drawn signature + audit trail. In
  // 'require' mode this awaits an approver; in 'trust' mode the RPC returns it
  // already confirmed.
  // Rank-aware sign-off. The required approver rank is the higher of the
  // subject's own rank and the vessel approver tier; if no OTHER active member
  // meets it, the subject is top-of-chain (e.g. the Master) and self-certifies
  // with a single signature — mirroring the hor_submit_month RPC.
  const horRosterLoaded = Object.keys(horMemberTiers).length > 0;
  const horRequiredRank = Math.max(
    horRankOf(horMemberTiers[crewId]),
    horRankOf(vesselHorSettings?.approverTier || 'COMMAND'),
  );
  const horSelfCertifies = horRosterLoaded && !Object.entries(horMemberTiers).some(
    ([uid, t]) => uid !== crewId && horRankOf(t) >= horRequiredRank,
  );

  // Breaches that fall in the viewed month — surfaced in the sign-off modal so
  // the signer (crew or approver) knowingly includes them. Pairs each breach
  // Gap-led descriptor per MLC rule, from the breach episode's code + worst
  // figure (e.g. "Daily rest 9h — 1h short of 10h min"). Covers all four rules,
  // incl. broken rest and the 14h stretch, which can breach even when daily
  // hours look fine.
  const BREACH_RULE_DESC = {
    REST_LT_10_IN_24H: (v) => `Daily rest ${Math.round(v)}h — ${Math.max(0, 10 - Math.round(v))}h short of 10h min`,
    REST_LT_77_IN_7D: (v) => `7-day rest ${Math.round(v)}h — ${Math.max(0, 77 - Math.round(v))}h short of 77h min`,
    NO_6H_CONTINUOUS_REST_IN_24H: (v) => `Longest rest ${Math.round(v)}h — ${Math.max(0, 6 - Math.round(v))}h short of 6h min`,
    WORK_GT_14H_CONTINUOUS: (v) => `On duty ${Math.round(v)}h — ${Math.max(0, Math.round(v) - 14)}h over 14h max`,
  };
  const BREACH_RULE_ORDER = ['REST_LT_10_IN_24H', 'REST_LT_77_IN_7D', 'NO_6H_CONTINUOUS_REST_IN_24H', 'WORK_GT_14H_CONTINUOUS'];

  // Map breach dates → ordered descriptor chips, from the live detection episodes
  // (horData.breaches), keeping the worst figure per rule on each day.
  const buildBreachChips = () => {
    const yr = horCurrentMonth?.getFullYear();
    const mo = horCurrentMonth?.getMonth();
    if (yr == null || mo == null) return {};
    const prefix = `${yr}-${String(mo + 1).padStart(2, '0')}-`;
    const worstByDate = {};
    (horData?.breaches || []).forEach((ep) => {
      if (!BREACH_RULE_DESC[ep?.code]) return;
      (ep?.affectedShipDates || []).forEach((ds) => {
        if (!String(ds).startsWith(prefix)) return;
        const m = (worstByDate[ds] || (worstByDate[ds] = {}));
        const prev = m[ep.code];
        // worst = lowest rest (or highest on-duty stretch)
        m[ep.code] = prev == null ? ep.worstValue
          : (ep.code === 'WORK_GT_14H_CONTINUOUS' ? Math.max(prev, ep.worstValue) : Math.min(prev, ep.worstValue));
      });
    });
    const out = {};
    Object.entries(worstByDate).forEach(([ds, m]) => {
      out[ds] = BREACH_RULE_ORDER.filter((c) => m[c] != null).map((c) => BREACH_RULE_DESC[c](m[c]));
    });
    return out;
  };

  // day with its documented reason + sign-off state, if any.
  const buildMonthBreaches = () => {
    const calendar = horData?.calendarData || [];
    const dates = calendar.filter((d) => d?.status === 'breach').map((d) => d?.date).filter(Boolean);
    return [...new Set(dates)].sort().map((date) => {
      const r = breachReasonsByDate[date];
      return { date, note: r?.note_text || '', documented: !!r, signed: !!r?.signed_off_at };
    });
  };

  const handleConfirmMonth = () => {
    if (!crewId) return;
    // Force a documented reason for every breach day before sign-off is allowed.
    // Undocumented breaches are routed into the breach-notes modal (which also
    // writes hor_breach_reasons); once reasons exist the signOffAfterBreach flag
    // carries the user straight back here into the sign-off modal.
    const undoc = buildMonthBreaches().filter((b) => !b.documented);
    if (undoc.length > 0) {
      const y = horCurrentMonth?.getFullYear();
      const m = horCurrentMonth?.getMonth();
      const undocSet = new Set(undoc.map((b) => b.date));
      const full = detectBreachedDatesAfterSave(crewId, [], y, m).filter((b) => undocSet.has(b.date));
      setBreachedDates(full.length ? full : undoc.map((b) => ({ date: b.date, breachTypes: [], restHours: 0, explanation: '' })));
      setSignOffAfterBreach(true);
      setShowBreachNotesModal(true);
      showToast(`Add a reason for ${undoc.length} breach day${undoc.length > 1 ? 's' : ''} before signing off`, 'error');
      return;
    }
    openMonthSignOff();
  };

  // Opens the month sign-off modal (crew submit / self-certify). Split out of
  // handleConfirmMonth so the post-breach continuation can re-enter it directly.
  const openMonthSignOff = () => {
    setSignOff({
      kind: 'submit',
      breaches: buildMonthBreaches(),
      title: horSelfCertifies ? 'Certify your Hours of Rest' : 'Sign off your Hours of Rest',
      confirmLabel: (vesselHorSettings?.mode === 'trust' || horSelfCertifies) ? 'Sign & confirm' : 'Sign & submit',
      declaration:
        'I confirm that the Hours of Rest recorded for this month are a true and accurate record of the rest I have taken, in accordance with MLC 2006 / STCW requirements.',
      periodLabel: monthLabelFor(horCurrentMonth),
      defaultName:
        crewMember?.fullName && crewMember.fullName !== 'Unknown'
          ? crewMember.fullName
          : myProfile?.full_name || '',
      onConfirm: async (signature) => {
        const year = horCurrentMonth?.getFullYear();
        const month = horCurrentMonth?.getMonth();
        const row = await submitMonthDb({ tenantId: activeTenantId, year, jsMonth: month, signature });
        // Mirror into the legacy localStorage store so existing PDF/exports stay coherent.
        confirmMonth(crewId, year, month);
        // In 'require' mode the month lands at 'submitted' and now waits on an
        // approver — notify everyone who can sign it off (COMMAND, or the vessel's
        // approver tier) so it doesn't sit unseen. 'trust'/self-cert skips this.
        if (row?.status === 'submitted') {
          const approverTier = vesselHorSettings?.approverTier || 'COMMAND';
          const who = (crewMember?.fullName && crewMember.fullName !== 'Unknown')
            ? crewMember.fullName : (myProfile?.full_name || 'A crew member');
          const period = `${year}-${String(month + 1).padStart(2, '0')}`;
          const recipients = Object.entries(horMemberTiers)
            .filter(([uid, tier]) => uid !== crewId && (tier === 'COMMAND' || tier === approverTier))
            .map(([uid]) => uid);
          // Flag non-conformities at the approval gate so the approver knows the
          // month carries rest breaches to review (not just a routine sign-off).
          const breachDays = buildMonthBreaches().length;
          await Promise.all(recipients.map((uid) => sendDbNotification(uid, {
            type: 'HOR_APPROVAL_PENDING',
            title: breachDays > 0 ? 'Hours of Rest — breaches to review' : 'Hours of Rest awaiting approval',
            message: breachDays > 0
              ? `${who} submitted ${monthLabelFor(horCurrentMonth)} Hours of Rest with ${breachDays} breach day${breachDays === 1 ? '' : 's'} to review.`
              : `${who} submitted ${monthLabelFor(horCurrentMonth)} Hours of Rest for approval.`,
            actionUrl: `/profile/${crewId}?tab=hor&period=${period}`,
            severity: breachDays > 0 ? 'urgent' : 'warn',
          })));
        }
        // Trust/self-cert lands at 'confirmed' in one step — file the signed
        // record in the vault straight away (require mode files it on approval).
        if (row?.status === 'confirmed') {
          await archiveSignedHorRecordSafe({ tenantId: activeTenantId, subjectUserId: row.subject_user_id || crewId, year, jsMonth: month });
        }
        showToast(row?.status === 'confirmed' ? 'Month confirmed' : 'Month submitted for approval', 'success');
        await loadHORData();
      },
    });
  };

  // Approver counter-signs the viewed crew member's submitted month — opens the
  // sign-off modal; the approve RPC (with the captain's signature) runs on confirm.
  const handleApproveMonth = () => {
    setSignOff({
      kind: 'approve',
      breaches: buildMonthBreaches(),
      title: 'Counter-sign Hours of Rest',
      confirmLabel: 'Sign & approve',
      declaration: `I have reviewed the Hours of Rest for ${
        crewMember?.fullName || 'this crew member'
      } for this period and, as Master, approve them as an accurate record.`,
      periodLabel: monthLabelFor(horCurrentMonth),
      defaultName: myProfile?.full_name || '',
      onConfirm: async (signature) => {
        const year = horCurrentMonth?.getFullYear();
        const month = horCurrentMonth?.getMonth();
        await approveMonthDb({ tenantId: activeTenantId, subjectUserId: crewId, year, jsMonth: month, signature });
        // Counter-signing is the terminal approver action, so finalise in one
        // step: auto-lock (Reopen still unlocks). Only COMMAND may lock; a
        // lower-tier approver simply lands at 'confirmed'.
        let locked = false;
        if (currentUserPermissionTier === 'COMMAND') {
          try {
            await lockMonthDb({ tenantId: activeTenantId, subjectUserId: crewId, year, jsMonth: month });
            locked = true;
          } catch (e) {
            console.error('[HOR] auto-lock after approve failed:', e);
          }
        }
        // Both signatures are now on the record — file the signed seafarer PDF
        // into the vault's month folder (best-effort; never blocks the approval).
        await archiveSignedHorRecordSafe({ tenantId: activeTenantId, subjectUserId: crewId, year, jsMonth: month });
        showToast(locked ? 'Month approved, counter-signed & locked' : 'Month approved & counter-signed', 'success');
        await loadHORData();
      },
    });
  };

  const handleReopenMonth = async () => {
    const year = horCurrentMonth?.getFullYear();
    const month = horCurrentMonth?.getMonth();
    try {
      await reopenMonthDb({ tenantId: activeTenantId, subjectUserId: crewId, year, jsMonth: month });
      showToast('Month reopened', 'success');
      await loadHORData();
    } catch (e) {
      showToast(e?.message || 'Failed to reopen month', 'error');
    }
  };

  const handleLockMonth = async () => {
    const year = horCurrentMonth?.getFullYear();
    const month = horCurrentMonth?.getMonth();
    try {
      await lockMonthDb({ tenantId: activeTenantId, subjectUserId: crewId, year, jsMonth: month });
      showToast('Month locked', 'success');
      await loadHORData();
    } catch (e) {
      showToast(e?.message || 'Failed to lock month', 'error');
    }
  };

  // Approver signs off / clears the sign-off on a documented breach reason.
  const handleSignOffBreach = async (date) => {
    try {
      await signOffBreachReasonDb({ tenantId: activeTenantId, subjectUserId: crewId, date });
      showToast('Breach reason signed off', 'success');
      await loadHORData();
    } catch (e) {
      showToast(e?.message || 'Failed to sign off breach', 'error');
    }
  };

  const handleUnsignBreach = async (date) => {
    try {
      await unsignBreachReasonDb({ tenantId: activeTenantId, subjectUserId: crewId, date });
      showToast('Sign-off cleared', 'success');
      await loadHORData();
    } catch (e) {
      showToast(e?.message || 'Failed to clear sign-off', 'error');
    }
  };

  const renderHOR = () => {
    // Check if user is Command
    const isCommand = currentUser?.tier === PermissionTier?.COMMAND;

    // Use real data from storage
    const last24HoursRest = horData?.last24HoursRest || 24;
    const last7DaysRest = horData?.last7DaysRest || 168;

    // Scope the Breaches panel to the viewed month — keyed by the breach date
    // (window-end), matching how the calendar, the "Breach days" KPI, sign-off
    // and the month's breach reasons are all already scoped. Without this the
    // list alone showed every prior month's breaches (e.g. May while June is
    // open), disagreeing with its own count.
    const monthPrefix = `${horCurrentMonth?.getFullYear()}-${String((horCurrentMonth?.getMonth() ?? 0) + 1).padStart(2, '0')}-`;
    const breaches = (horData?.breaches || []).filter((b) => String(b?.dateStr || '').startsWith(monthPrefix));

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

    // Editorial KPI tile tones + month-level aggregates. Presentation only —
    // derived from the existing per-day statuses, NOT the shared rest engine
    // (that wiring, incl. the marginal tier + vessel day-basis, lands later).
    // Daily marginal band mirrors the agreed language: amber at 10–11h rest.
    const dailyTone = last24HoursRest >= 11 ? '' : last24HoursRest >= 10 ? 'amber' : 'red';
    const weeklyTone = last7DaysRest >= 77 ? '' : 'red';
    // Rule 4 (≤14h continuous on-duty), rolling 7-day. Amber marginal band at
    // 13–14h mirrors the daily 10–11h amber; red once the 14h max is exceeded.
    const longestStretch = horData?.longestStretchHours || 0;
    const stretchDisplay = Number.isInteger(longestStretch) ? longestStretch : longestStretch.toFixed(1);
    const stretchTone = longestStretch <= 13 ? '' : longestStretch <= 14 ? 'amber' : 'red';
    const ratedDays = calendarData.filter(d => d?.status).length;
    const breachDayCount = calendarData.filter(d => d?.status === 'breach').length;
    const compliantDays = calendarData.filter(d => d?.status && d?.status !== 'breach').length;
    const monthCompliantPct = ratedDays > 0 ? Math.round((compliantDays / ratedDays) * 100) : 100;
    const monthTone = breachDayCount > 0 ? 'red' : monthCompliantPct === 100 ? '' : 'amber';

    // Today (local YYYY-MM-DD) — drives the "provisional / future" calendar
    // dash. A day still carried by the rota (not logged) reads as the final
    // HOR once it's in the past, so only FUTURE rota days render dashed.
    const _today = new Date();
    const todayStr = `${_today.getFullYear()}-${String(_today.getMonth() + 1).padStart(2, '0')}-${String(_today.getDate()).padStart(2, '0')}`;

    // A month can only be signed off once it has fully elapsed — you can't
    // certify rest for days that haven't happened yet. Sign-off opens on the
    // month's last calendar day (todayStr >= last day of the viewed month).
    const lastDayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    const monthComplete = todayStr >= lastDayStr;
    const monthEndLabel = new Date(year, month, daysInMonth).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    // Get month status
    const monthStatus = getMonthStatus(crewId, year, month);

    // Phase 3 — DB-backed workflow state for the chip + action buttons.
    const dbStatus = dbMonthStatus?.status || 'open';
    const approverTier = vesselHorSettings?.approverTier || 'COMMAND';
    const viewerTier = currentUserPermissionTier;
    // Rank-aware: an approver must be at/above the vessel tier AND not outranked
    // by the subject (no junior countersigning a senior). Mirrors the RPC.
    const viewerRank = horRankOf(horMemberTiers[session?.user?.id] || viewerTier);
    const subjectRank = horRankOf(horMemberTiers[crewId]);
    const requiredApproverRank = Math.max(subjectRank, horRankOf(approverTier));
    const canApprove = !isOwnProfile && viewerRank >= requiredApproverRank;
    const canLock = viewerTier === 'COMMAND';
    const submitLabel = (vesselHorSettings?.mode === 'trust' || horSelfCertifies) ? 'Confirm Month' : 'Submit for Approval';
    // A confirmed month with only the submitter's signature (no counter-sign,
    // confirmed by the submitter) is a self-certification (e.g. the Master).
    const isSelfCertified = dbStatus === 'confirmed'
      && !dbMonthStatus?.approve_signature_path
      && !!dbMonthStatus?.submitted_by
      && dbMonthStatus?.submitted_by === dbMonthStatus?.confirmed_by;
    const dbStatusLabel = { open: 'Open', submitted: 'Submitted', confirmed: 'Confirmed', locked: 'Locked' }[dbStatus] || 'Open';
    // Vessel-wide view has no single month, so it shows just the plain title.
    const isVesselView = isCommand && horView === 'vessel';

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
        status: dayData?.status,
        source: dayData?.source
      });
    };

    // Reset a logged day back to its rota baseline: drop the manual/edited
    // entry; the baseline re-pulls on the next load.
    const handleResetToBaseline = () => {
      if (!selectedCalendarDate?.date) return;
      deleteWorkEntriesForDate(crewId, selectedCalendarDate.date);
      setSelectedCalendarDate(null);
      showToast('Day reset to rota baseline', 'success');
      loadHORData();
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
      // The [horCurrentMonth] effect reloads for the new month. We deliberately
      // do NOT also schedule a reload here: the old setTimeout fired a SECOND
      // load whose closure captured the PREVIOUS month, racing the effect's
      // load on the shared cache — a source of the vanishing-rota glitches.
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

    // Crew clicks a breach day to add/edit its reason — only while the month is
    // still their own and open (not yet submitted). Reuses BreachNotesModal.
    const breachEditable = isOwnProfile && dbStatus === 'open';
    const openBreachReason = (ds, items) => {
      if (!breachEditable) return;
      setBreachedDates([{
        date: ds,
        breachTypes: items.map((b) => b?.breachType).filter(Boolean),
        restHours: items[0]?.restHours ?? 0,
        explanation: breachReasonsByDate[ds]?.note_text || '',
      }]);
      setShowBreachNotesModal(true);
    };

    return (
      <div className="space-y-6">
        {/* Header — editorial "HOR, <status>." (navy + terracotta serif),
            mirroring the LAUREN, Moody. name treatment, with the workflow action
            on the right. The vessel-wide view carries no month, so just a title. */}
        <div className="cp-hor-head">
          <div className="cp-section-head" style={{ marginBottom: 0 }}>
            <span className="cp-section-num">09 /</span>
            <h3>Hours of Rest</h3>
          </div>
          {!isVesselView && (
            <div className="cp-hor-actions">
              {/* Crew: submit own open month — only once the month has ended. */}
              {isOwnProfile && dbStatus === 'open' && monthComplete && (
                <button type="button" className="cp-hor-btn cp-hor-btn-primary" onClick={handleConfirmMonth}>
                  <Icon name="CheckCircle" size={16} />
                  {submitLabel}
                </button>
              )}
              {isOwnProfile && dbStatus === 'open' && !monthComplete && (
                <span className="cp-hor-await">Month in progress · sign-off opens {monthEndLabel}</span>
              )}
              {isOwnProfile && dbStatus === 'submitted' && (
                <span className="cp-hor-await">Awaiting approval</span>
              )}
              {/* Approver: act on a submitted month */}
              {canApprove && dbStatus === 'submitted' && (
                <>
                  <button type="button" className="cp-hor-btn cp-hor-btn-ghost" onClick={handleReopenMonth}>Send back</button>
                  <button type="button" className="cp-hor-btn cp-hor-btn-primary" onClick={handleApproveMonth}>
                    <Icon name="CheckCircle" size={16} />
                    Approve
                  </button>
                </>
              )}
              {/* Confirmed: reopen, and COMMAND can lock */}
              {canApprove && dbStatus === 'confirmed' && (
                <button type="button" className="cp-hor-btn cp-hor-btn-ghost" onClick={handleReopenMonth}>Reopen</button>
              )}
              {canLock && dbStatus === 'confirmed' && (
                <button type="button" className="cp-hor-btn cp-hor-btn-ghost" onClick={handleLockMonth}>
                  <Icon name="Lock" size={16} />
                  Lock
                </button>
              )}
            </div>
          )}
        </div>
        {/* Command-Only Toggle */}
        {isCommand && (
          <div className="cp-flatcard p-2 inline-flex gap-2">
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
            viewerTier={currentUserPermissionTier}
          />
        ) : (
          // My HOR View (existing)
          (<>
            {/* Signature receipt — the drawn signatures + audit trail captured
                at submit (crew) and approve (captain). Shown once a month has
                been signed; the image URLs are re-signed on each load. */}
            {(dbMonthStatus?.submit_signature_path || dbMonthStatus?.approve_signature_path) && (
              <div className={`cp-sigrcpt${dbMonthStatus?.submit_signature_path && dbMonthStatus?.approve_signature_path ? ' two' : ''}`}>
                {dbMonthStatus?.submit_signature_path && (
                  <div className="cp-sig">
                    <div className="cp-sig-label">{isSelfCertified ? 'Self-certified' : 'Signed by crew'}</div>
                    <div className="cp-sig-ink">
                      {sigUrls?.submit && <img src={sigUrls.submit} alt="Crew signature" />}
                    </div>
                    <div className="cp-sig-name">
                      {dbMonthStatus?.submit_signed_name || crewMember?.fullName || '—'}
                    </div>
                    {dbMonthStatus?.submitted_at && (
                      <div className="cp-sig-meta">{new Date(dbMonthStatus.submitted_at).toLocaleString('en-GB')}</div>
                    )}
                  </div>
                )}
                {dbMonthStatus?.approve_signature_path && (
                  <div className="cp-sig">
                    <div className="cp-sig-label">Counter-signed · Master</div>
                    <div className="cp-sig-ink">
                      {sigUrls?.approve && <img src={sigUrls.approve} alt="Master signature" />}
                    </div>
                    <div className="cp-sig-name">{dbMonthStatus?.approve_signed_name || '—'}</div>
                    {dbMonthStatus?.confirmed_at && (
                      <div className="cp-sig-meta">{new Date(dbMonthStatus.confirmed_at).toLocaleString('en-GB')}</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* Top Summary — editorial KPI tiles (match the rota rest-log strip
                + the approved hybrid mockup). */}
            <div className="cp-kpis">
              <div className={`cp-kpi${monthTone ? ` cp-kpi-${monthTone}` : ''}`}>
                <div className="cp-kpi-n">{monthCompliantPct}%</div>
                <div className="cp-kpi-l">Month compliant</div>
              </div>
              <div className={`cp-kpi ${breachDayCount > 0 ? 'cp-kpi-red' : 'cp-kpi-ink'}`}>
                <div className="cp-kpi-n">{breachDayCount}</div>
                <div className="cp-kpi-l">Breach days</div>
              </div>
              <div className={`cp-kpi${dailyTone ? ` cp-kpi-${dailyTone}` : ''}`}>
                <div className="cp-kpi-n">{last24HoursRest}h</div>
                <div className="cp-kpi-l">Last 24h rest</div>
              </div>
              <div className={`cp-kpi${weeklyTone ? ` cp-kpi-${weeklyTone}` : ''}`}>
                <div className="cp-kpi-n">{last7DaysRest}h</div>
                <div className="cp-kpi-l">Last 7-day rest</div>
              </div>
              <div className={`cp-kpi${stretchTone ? ` cp-kpi-${stretchTone}` : ''}`}>
                <div className="cp-kpi-n">{stretchDisplay}h</div>
                <div className="cp-kpi-l">Longest on-duty</div>
              </div>
            </div>

            {/* Approver review — a scannable summary for the master signing a
                submitted month: who submitted, the compliance headline, and the
                breach days WITH their documented reasons (what's being certified).
                The full day-by-day grid stays below for detail. */}
            {canApprove && dbStatus === 'submitted' && (
              <div className="cp-review">
                <div className="cp-section-head">
                  <span className="cp-section-kicker">For approval</span>
                  <h3>Review <em>{monthName}</em></h3>
                </div>
                <p className="cp-review-sub">
                  Submitted by {dbMonthStatus?.submit_signed_name || crewMember?.fullName || 'crew'}
                  {dbMonthStatus?.submitted_at ? ` on ${new Date(dbMonthStatus.submitted_at).toLocaleDateString('en-GB')}` : ''}
                  {' '}· {monthCompliantPct}% compliant · {breachDayCount} breach day{breachDayCount === 1 ? '' : 's'}.
                </p>
                {/* Whole month at a glance — a compliance heat strip: bar height
                    is rest hours, sage = compliant, terracotta = breach (any MLC
                    rule, flagged even when daily hours look fine), dashed line =
                    the 10h daily minimum. Plain HTML so it keeps a compact, fixed
                    height and crisp labels at any card width. */}
                {calendarData?.length > 0 && (
                  <div className="cp-revchart" aria-label="Month at a glance — rest hours per day">
                    <div className="cp-revchart-y">
                      <span className="cp-revy-24">24h</span>
                      <span className="cp-revy-10">10h</span>
                    </div>
                    <div className="cp-revchart-main">
                      <div className="cp-revplot">
                        <span className="cp-revline-10" aria-hidden="true" />
                        {calendarData.map((d) => {
                          const h = Math.max(0, Math.min(Number(d.restHours) || 0, 24));
                          const cls = d.status === 'breach' ? 'breach' : d.status === 'warning' ? 'warning' : 'compliant';
                          return (
                            <span className="cp-revcol" key={d.date} title={`${d.day} ${monthName} — ${Math.round(h)}h rest`}>
                              <span className={`cp-revbar ${cls}`} style={{ height: `${(h / 24) * 100}%` }} />
                            </span>
                          );
                        })}
                      </div>
                      <div className="cp-revaxis" aria-hidden="true">
                        {calendarData.map((d) => (
                          <span key={d.date}>{d.day}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div className="cp-revlegend">
                  <span><i style={{ background: '#BCCFBD' }} />Compliant</span>
                  <span><i style={{ background: '#E3B055' }} />Marginal</span>
                  <span><i style={{ background: '#C65A1A' }} />Breach</span>
                </div>
                {(() => {
                  const mb = buildMonthBreaches();
                  if (mb.length === 0) {
                    return <p className="cp-review-clean">No breaches this month — all logged days compliant.</p>;
                  }
                  const chipsByDate = buildBreachChips();
                  const undoc = mb.filter((b) => !b.documented).length;
                  return (
                    <>
                      <p className={`cp-review-gate${undoc ? ' open' : ''}`}>
                        {undoc
                          ? `${undoc} breach day${undoc > 1 ? 's' : ''} still need a reason.`
                          : `All ${mb.length} breach day${mb.length > 1 ? 's' : ''} have a logged reason.`}
                      </p>
                      <ul className="cp-review-breaches">
                        {mb.map((b) => {
                          const [yy, mm, dd] = String(b.date).split('-');
                          const chips = chipsByDate[b.date] || [];
                          return (
                            <li key={b.date} className="cp-review-brow">
                              <div className="cp-review-bhead">
                                <span className="cp-review-bdate">{dd}/{mm}/{yy}</span>
                                <span className="cp-review-bchips">
                                  {chips.map((c, idx) => <span key={idx} className="cp-review-chip">{c}</span>)}
                                </span>
                              </div>
                              {b.note
                                ? <div className="cp-review-bnote">Reason — {b.note}</div>
                                : <div className="cp-review-bnote none">No reason documented</div>}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  );
                })()}
                <p className="cp-review-hint">Day-by-day detail is below. Approve or send back using the buttons above.</p>
              </div>
            )}

            {/* Hybrid: compact calendar overview + inline-edit day list.
                Replaces the old wide calendar + per-date panel — per-day
                editing now happens inline in the list, on the shared engine. */}
            <HORHybridLog
              crewId={crewId}
              calendarData={calendarData}
              monthName={monthName}
              todayStr={todayStr}
              onMonthChange={handleMonthChange}
              onChanged={loadHORData}
            />

            {/* Breaches — editorial summary, mirroring the sign-off view. No red
                alerts; each day shows its documented reason and (for approvers)
                its sign-off state. Crew can click a day to add/edit the reason
                while the month is still open. */}
            <div className="cp-flatcard p-6 flex flex-col">
              <div className="cp-section-head cp-breach-head">
                <h3>COMPLIANCE, <em>breaches</em></h3>
              </div>
              {breaches?.length > 0 ? (
                <ul className="cp-brlist">
                  {(() => {
                    const byDate = {};
                    breaches.forEach((b) => { (byDate[b.dateStr] || (byDate[b.dateStr] = [])).push(b); });
                    return Object.keys(byDate).sort().map((ds) => {
                      const items = byDate[ds];
                      const reason = breachReasonsByDate[ds];
                      const documented = !!reason?.note_text;
                      const signed = !!reason?.signed_off_at;
                      const [yy, mm, dd] = ds.split('-');
                      return (
                        <li
                          key={ds}
                          className={`cp-brrow${breachEditable ? ' is-editable' : ''}`}
                          onClick={breachEditable ? () => openBreachReason(ds, items) : undefined}
                          role={breachEditable ? 'button' : undefined}
                          tabIndex={breachEditable ? 0 : undefined}
                          onKeyDown={breachEditable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBreachReason(ds, items); } } : undefined}
                        >
                          <div className="cp-brrow-main">
                            <div className="cp-brrow-date">{dd}/{mm}/{yy}</div>
                            <div className="cp-brrow-rule">{[...new Set(items.map((b) => b.type))].join('  ·  ')}</div>
                            {documented
                              ? <div className="cp-brrow-reason">{reason.note_text}</div>
                              : <div className="cp-brrow-reason none">{breachEditable ? 'Add a reason →' : 'No reason documented'}</div>}
                          </div>
                          <div className="cp-brrow-side">
                            <span className={`cp-brpill ${signed ? 'ok' : documented ? 'pending' : 'open'}`}>
                              {signed ? 'Signed off' : documented ? 'Awaiting sign-off' : 'Needs reason'}
                            </span>
                            {canApprove && documented && (
                              signed
                                ? <button type="button" className="cp-hor-btn cp-hor-btn-ghost" onClick={(e) => { e.stopPropagation(); handleUnsignBreach(ds); }}>Clear</button>
                                : <button type="button" className="cp-hor-btn cp-hor-btn-primary" onClick={(e) => { e.stopPropagation(); handleSignOffBreach(ds); }}>Sign off</button>
                            )}
                          </div>
                        </li>
                      );
                    });
                  })()}
                </ul>
              ) : (
                <p className="cp-brempty">No breaches recorded — every logged day meets the rest thresholds.</p>
              )}
              {breachEditable && (
                <button type="button" className="cp-hor-btn cp-hor-btn-ghost cp-braddentry" onClick={() => setShowQuickEntry(true)}>
                  <Icon name="Plus" size={16} /> Add entry
                </button>
              )}
            </div>
          </>)
        )}
      </div>
    );
  };

  const renderSeaTime = () => {
    // Countdown Sea Time Tracker (design-handoff recreation) driven by the
    // ported rules engine; live Supabase data with a sample fallback.
    return <SeaTimeDashboard userId={crewId} tenantId={activeTenantId} currentUser={currentUser} onAddCertificate={handleAddCertificate} canAttest={(tenantMemberRole || '').toUpperCase() === 'CAPTAIN' && !isOwnProfile} />;
  };

  // Placeholder until the document store is wired to this tab. Kept as a real
  // case so the Documents nav item doesn't fall through to Personal Details.
  const renderDocuments = () => (
    <div>
      <div className="cp-section-head">
        <span className="cp-section-num">06 /</span>
        <h3>Documents</h3>
      </div>
      <div className="cp-flatcard p-10 text-center">
        <Icon name="FileText" size={30} className="text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Document storage is coming to this tab.</p>
      </div>
    </div>
  );

  const renderSwitch = (checked, onClick, { disabled, busy, label } = {}) => (
    <div className="cp-set-side">
      {label && <span className="cp-switch-label">{checked ? 'On' : 'Off'}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label || 'Toggle'}
        disabled={disabled}
        onClick={onClick}
        className="cp-switch"
        style={busy ? { opacity: 0.6 } : undefined}
      >
        <span className="knob" />
      </button>
    </div>
  );

  const renderPermissions = () => {
    const memberTier = String(crewMember?.effectiveTier || '').toUpperCase();
    const tierLabel = memberTier ? getTierDisplayName(memberTier) : '—';
    const firstName = crewMember?.firstName || 'This person';
    const lockNote = !canEditPermissions ? <p className="cp-set-note">Only COMMAND can change this.</p> : null;

    // Effective capability values: explicit flag, else tier default.
    const canEditRota = crewMember?.canEditRota ?? ['COMMAND', 'CHIEF', 'HOD'].includes(memberTier);
    // "Publish without approval" is the inverse of rota_requires_acceptance.
    const publishNoApproval = canEditRota
      ? (crewMember?.rotaRequiresAcceptance != null ? !crewMember.rotaRequiresAcceptance : memberTier !== 'HOD')
      : false;
    const orderNoApproval = crewMember?.canOrderWithoutApproval ?? (memberTier === 'COMMAND');
    const confirmQuotesNoApproval = orderNoApproval
      ? (crewMember?.canConfirmQuotesWithoutApproval ?? (memberTier === 'COMMAND'))
      : false;

    const editDisabled = !canEditPermissions || !!permSaving;

    // Toggle handlers (with master→dependent cascades).
    const toggleCanEditRota = () => {
      const next = !canEditRota;
      // Turning editing off also removes direct-publish (needs approval = true).
      const patch = next
        ? { can_edit_rota: true }
        : { can_edit_rota: false, rota_requires_acceptance: true };
      const local = next
        ? { canEditRota: true }
        : { canEditRota: false, rotaRequiresAcceptance: true };
      updateCaps(patch, local);
    };
    const togglePublishNoApproval = () => {
      // ON → publishes directly (rota_requires_acceptance false); OFF → needs approval.
      const next = !publishNoApproval;
      updateCaps({ rota_requires_acceptance: !next }, { rotaRequiresAcceptance: !next });
    };
    const toggleOrderNoApproval = () => {
      const next = !orderNoApproval;
      const patch = next
        ? { can_order_without_approval: true }
        : { can_order_without_approval: false, can_confirm_quotes_without_approval: false };
      const local = next
        ? { canOrderWithoutApproval: true }
        : { canOrderWithoutApproval: false, canConfirmQuotesWithoutApproval: false };
      updateCaps(patch, local);
    };
    const toggleConfirmQuotes = () => {
      const next = !confirmQuotesNoApproval;
      updateCaps({ can_confirm_quotes_without_approval: next }, { canConfirmQuotesWithoutApproval: next });
    };

    const setRow = (label, desc, checked, onClick, { disabled, indent } = {}) => (
      <div className="cp-set-row" style={indent ? { paddingLeft: 18 } : undefined}>
        <div className="cp-set-main">
          <div className="cp-set-label">{label}</div>
          {desc && <p className="cp-set-desc">{desc}</p>}
        </div>
        {renderSwitch(checked, onClick, { disabled: editDisabled || disabled, busy: !!permSaving, label })}
      </div>
    );

    return (
      <div>
        <div className="cp-section-head">
          <span className="cp-section-num">★ /</span>
          <h3>Permissions</h3>
        </div>

        {/* Access — read-only context (department & role live in the meta bar) */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Access</span><span className="line" />
          </div>
          <div className="cp-set-row">
            <div className="cp-set-main">
              <div className="cp-set-label">Access level</div>
              <p className="cp-set-desc">Determines what {firstName === 'This person' ? 'this person' : firstName} can see and do across the vessel. Managed in Crew Management.</p>
            </div>
            <div className="cp-set-side"><span className="cp-set-pill accent">{tierLabel}</span></div>
          </div>
        </div>

        {/* Rota */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Rota</span><span className="line" />
          </div>
          {setRow(
            'Able to make rota edits',
            'Allows editing crew shifts on the rota. Off means view-only.',
            canEditRota, toggleCanEditRota,
          )}
          {setRow(
            'Able to publish rota edits without approval',
            canEditRota
              ? 'On publishes directly; off routes changes for approval first.'
              : 'Requires rota editing to be enabled first.',
            publishNoApproval, togglePublishNoApproval,
            { disabled: !canEditRota, indent: true },
          )}
          {lockNote}
        </div>

        {/* Supplier orders */}
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">Supplier orders</span><span className="line" />
          </div>
          {setRow(
            'Able to send supplier order requests without approval',
            'On sends orders straight to suppliers; off routes them for approval first.',
            orderNoApproval, toggleOrderNoApproval,
          )}
          {setRow(
            'Able to confirm supplier quotes without approval',
            orderNoApproval
              ? 'On confirms quotes directly; off routes them for approval first.'
              : 'Requires sending orders without approval to be enabled first.',
            confirmQuotesNoApproval, toggleConfirmQuotes,
            { disabled: !orderNoApproval, indent: true },
          )}
          {lockNote}
        </div>
      </div>
    );
  };

  const renderNotifications = () => {
    const firstName = crewMember?.firstName || 'This person';
    return (
      <div>
        <div className="cp-section-head">
          <span className="cp-section-num">★ /</span>
          <h3>Notifications</h3>
        </div>
        <div className="cp-group">
          <div className="cp-group-head">
            <span className="dia">◆</span><span className="t">In-app &amp; email alerts</span><span className="line" />
          </div>
          {!isOwnProfile ? (
            <p className="cp-set-note-empty">Notification preferences are personal — only {firstName} can manage these from their own profile.</p>
          ) : notifPrefs === null ? (
            <p className="cp-set-note-empty">Loading…</p>
          ) : (
            <>
              {NOTIF_CATEGORIES.map((c) => {
                const on = notifPrefs?.[c.key] !== false;
                return (
                  <div className="cp-set-row" key={c.key}>
                    <div className="cp-set-main">
                      <div className="cp-set-label">
                        {c.label}
                        <span className={`cp-chanchip ${on ? 'on' : ''}`}>Bell</span>
                        {c.email && <span className="cp-chanchip">Email</span>}
                      </div>
                      <p className="cp-set-desc">{c.desc}</p>
                    </div>
                    {renderSwitch(
                      on,
                      () => handleToggleNotif(c.key),
                      { disabled: notifSavingKey === c.key, busy: notifSavingKey === c.key, label: c.label },
                    )}
                  </div>
                );
              })}
              <p className="cp-set-note">
                Toggles control your in-app bell. Approval and reminder emails are still sent for time-critical items.
              </p>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderContract = () => {
    const editing = empEditing && canEditPermissions;
    const setE = (k, v) => setEmpForm((p) => ({ ...p, [k]: v }));
    const setC = (k, v) => setCompForm((p) => ({ ...(p || {}), [k]: v }));
    const ben = empForm.benefits || {};
    const setB = (k, v) => setEmpForm((p) => ({ ...p, benefits: { ...(p.benefits || {}), [k]: v } }));
    const benTxt = (key, ph = '') => (
      <input className="cp-inline-box" value={ben[key] || ''} placeholder={ph} onChange={(e) => setB(key, e.target.value)} />
    );
    const EMP_DEPARTMENTS = ['Deck', 'Engineering', 'Interior', 'Galley', 'Other'];
    const fmtDate = (d) => {
      if (!d) return '';
      const [y, m, day] = String(d).slice(0, 10).split('-');
      return `${day}/${m}/${y}`;
    };
    const cur = compForm?.salary_currency || '';
    const curSym = (code) => ({ EUR: '€', USD: '$', GBP: '£', AUD: 'A$', NZD: 'NZ$', CAD: 'C$', CHF: 'Fr', ZAR: 'R' }[code] || code || '');

    // A field card matching Personal Details: read = cp-static, edit = inline input.
    const fld = (label, readVal, editEl, { accent, full } = {}) => (
      <Field label={label} required={accent} full={full}>
        {editing
          ? editEl
          : <div className={`cp-static${(readVal ?? '') === '' ? ' cp-empty' : ''}`}>{(readVal ?? '') === '' ? '—' : readVal}</div>}
      </Field>
    );
    const txt = (key, ph = '') => (
      <input className="cp-inline-box" value={empForm[key] || ''} placeholder={ph}
        onChange={(e) => setE(key, e.target.value)} />
    );
    // Vessel-inherited, read-only field with a "from vessel" tag.
    const inheritedFld = (label, val, { full } = {}) => (
      <Field label={label} full={full}>
        <div className={`cp-static${val ? '' : ' cp-empty'}`}>
          {val || '—'}
          <span className="cp-chanchip" style={{ marginLeft: 8 }}>from vessel</span>
        </div>
      </Field>
    );
    // Editorial calendar (popover) bound to an ISO field.
    const dte = (key) => (
      <EditorialDatePicker
        value={(empForm[key] || '').slice(0, 10)}
        onChange={(iso) => setE(key, iso || null)}
        placeholder="dd/mm/yyyy"
      />
    );

    // Probation: the PERIOD is the source of truth — the end date derives from
    // start_date + period, and recomputes whenever the start date is set/changed.
    // Picking a custom end date clears the period.
    const PROBATION_DAYS = [7, 30, 60, 90];
    const addDaysIso = (iso, n) => {
      if (!iso) return null;
      const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const probPeriod = empForm.probation_period_days ?? null;
    const setStartDate = (iso) => setEmpForm((p) => ({
      ...p,
      start_date: iso || null,
      // Recompute probation end from the chosen period once a start date exists.
      probation_end_date: (p.probation_period_days != null && iso)
        ? addDaysIso(iso, p.probation_period_days)
        : p.probation_end_date,
    }));
    const setProbationPeriod = (n) => setEmpForm((p) => ({
      ...p,
      probation_period_days: n,
      probation_end_date: p.start_date ? addDaysIso(p.start_date, n) : p.probation_end_date,
    }));
    const setProbationCustom = (iso) => setEmpForm((p) => ({
      ...p, probation_end_date: iso || null, probation_period_days: null,
    }));

    // Common yacht payroll currencies.
    const CURRENCIES = ['EUR', 'USD', 'GBP', 'AUD', 'NZD', 'CAD', 'CHF', 'ZAR'];
    const money = (amt) => (amt != null && amt !== '' ? `${curSym(cur)}${Number(amt).toLocaleString('en-GB')}` : '');
    // Day rate auto-derives from the annualised salary / 365.
    const salaryPeriod = compForm?.salary_period === 'year' ? 'year' : 'month';
    const salaryAmt = (compForm?.salary_amount != null && compForm?.salary_amount !== '') ? Number(compForm.salary_amount) : null;
    const derivedDayRate = salaryAmt != null
      ? Math.round((salaryAmt * (salaryPeriod === 'year' ? 1 : 12) / 365) * 100) / 100
      : null;

    // Template the rail acts on: the explicit choice, else the single role match.
    const roleMatches = templates.filter((t) => templateFitsRole(t, crewMember?.roleTitle));
    const activeTemplate = selectedTemplate || (roleMatches.length === 1 ? roleMatches[0] : null);
    const hasTemplate = templates.length > 0;

    return (
      <div>
        <div className="cp-hor-head" style={{ marginBottom: 18, paddingBottom: 0, borderBottom: 'none' }}>
          <div className="cp-section-head" style={{ marginBottom: 0 }}>
            <span className="cp-section-num">07 /</span>
            <h3>Contract / Employment</h3>
          </div>
          {canEditPermissions && (
            editing ? (
              <div className="cp-hor-actions">
                <Button variant="outline" iconName="X" disabled={empSaving}
                  onClick={() => { setEmpEditing(false); setEmpLoaded(false); }}>Cancel Edit</Button>
                <Button iconName={empSaving ? 'Loader2' : 'Save'} disabled={empSaving}
                  onClick={handleSaveEmployment}>{empSaving ? 'Saving…' : 'Save'}</Button>
              </div>
            ) : (
              <div className="cp-hor-actions">
                <Button variant="outline" iconName="Edit" onClick={() => setEmpEditing(true)}>Edit employment</Button>
              </div>
            )
          )}
        </div>

        {!empLoaded ? (
          <p className="cp-set-note-empty">Loading…</p>
        ) : (
          <div className="cp-contract-split">
            {/* Left — field-card spec sheet (matches Personal Details) */}
            <div>
              <div className="cp-group">
                <div className="cp-group-head"><span className="dia">◆</span><span className="t">Role &amp; vessel</span><span className="line" /></div>
                <div className="cp-grid">
                  {fld('Rank held', empForm.rank_held, txt('rank_held', 'e.g. Chief Officer'))}
                  {fld('Department', empForm.department,
                    <select className="cp-inline-select" value={empForm.department || ''} onChange={(e) => setE('department', e.target.value)}>
                      <option value="">—</option>
                      {EMP_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>)}
                  {fld('Vessel', empForm.vessel_name, txt('vessel_name', 'e.g. M/Y Example'), { full: true })}
                </div>
              </div>

              <div className="cp-group">
                <div className="cp-group-head"><span className="dia">◆</span><span className="t">Contract</span><span className="line" /></div>
                <div className="cp-grid">
                  {fld('Contract type', empForm.contract_type,
                    <select className="cp-inline-select" value={empForm.contract_type || ''} onChange={(e) => setE('contract_type', e.target.value)}>
                      <option value="">—</option>
                      {EMP_CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>, { accent: true })}
                  <Field label="Probation">
                    {editing ? (
                      <>
                        <div className="cp-prob">
                          {PROBATION_DAYS.map((n) => (
                            <button
                              key={n}
                              type="button"
                              className={`cp-prob-chip${probPeriod === n ? ' active' : ''}`}
                              onClick={() => setProbationPeriod(n)}
                            >{n} days</button>
                          ))}
                          <span className="cp-prob-sep">or</span>
                          <span className="cp-prob-date">
                            <EditorialDatePicker
                              value={(empForm.probation_end_date || '').slice(0, 10)}
                              onChange={setProbationCustom}
                              placeholder="dd/mm/yyyy"
                            />
                          </span>
                        </div>
                        {probPeriod != null && !empForm.start_date && (
                          <p className="cp-prob-hint">Add a start date — the end date fills in automatically.</p>
                        )}
                      </>
                    ) : (
                      <div className={`cp-static${(probPeriod != null || empForm.probation_end_date) ? '' : ' cp-empty'}`}>
                        {probPeriod != null
                          ? `${probPeriod} days${empForm.probation_end_date ? ` · ends ${fmtDate(empForm.probation_end_date)}` : ' · start date needed'}`
                          : (empForm.probation_end_date ? fmtDate(empForm.probation_end_date) : '—')}
                      </div>
                    )}
                  </Field>
                  {fld('Start date', fmtDate(empForm.start_date),
                    <EditorialDatePicker
                      value={(empForm.start_date || '').slice(0, 10)}
                      onChange={setStartDate}
                      placeholder="dd/mm/yyyy"
                    />)}
                  {fld('End date', fmtDate(empForm.end_date), dte('end_date'))}
                  {fld('Port of embarkation', empForm.port_of_embarkation, txt('port_of_embarkation', 'e.g. Palma de Mallorca'))}
                  {fld('Repatriation destination', empForm.repatriation_destination, txt('repatriation_destination', 'e.g. United Kingdom'))}
                </div>
              </div>

              <div className="cp-group">
                <div className="cp-group-head"><span className="dia">◆</span><span className="t">Rotation &amp; leave</span><span className="line" /></div>
                <div className="cp-grid">
                  {fld('Rotation pattern', empForm.rotation_pattern, txt('rotation_pattern', 'e.g. 2:2'))}
                  {fld('Next crew change', fmtDate(empForm.next_crew_change_date), dte('next_crew_change_date'))}
                  {fld('Leave entitlement', empForm.leave_entitlement_days != null && empForm.leave_entitlement_days !== '' ? `${empForm.leave_entitlement_days} / days` : '',
                    <input className="cp-inline-box" type="number" min="0" placeholder="/ days" value={empForm.leave_entitlement_days ?? ''} onChange={(e) => setE('leave_entitlement_days', e.target.value)} />)}
                  {fld('Notice period', empForm.notice_period, txt('notice_period', 'e.g. 1 month'))}
                </div>
              </div>

              {compForm !== null && (
                <div className="cp-group">
                  <div className="cp-group-head"><span className="dia">◆</span><span className="t">Salary</span><span className="cp-chanchip" style={{ marginLeft: 6 }}>COMMAND only</span><span className="line" /></div>
                  <div className="cp-grid">
                    <Field label="Salary">
                      {editing ? (
                        <span style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', alignItems: 'center' }}>
                          <input className="cp-inline-box" type="number" min="0" step="0.01" placeholder="Amount" style={{ maxWidth: 90 }}
                            value={compForm?.salary_amount ?? ''} onChange={(e) => setC('salary_amount', e.target.value)} />
                          <Icon name="Coins" size={14} className="text-muted-foreground" />
                          <select className="cp-inline-select" style={{ maxWidth: 74 }} aria-label="Currency"
                            value={compForm?.salary_currency ?? ''} onChange={(e) => setC('salary_currency', e.target.value)}>
                            <option value="">—</option>
                            {CURRENCIES.map((c) => <option key={c} value={c}>{curSym(c)} {c}</option>)}
                          </select>
                          <select className="cp-inline-select" style={{ maxWidth: 104 }} aria-label="Salary period"
                            value={salaryPeriod} onChange={(e) => setC('salary_period', e.target.value)}>
                            <option value="month">per month</option>
                            <option value="year">per year</option>
                          </select>
                        </span>
                      ) : (
                        <div className={`cp-static${salaryAmt != null ? '' : ' cp-empty'}`}>
                          {salaryAmt != null ? `${money(salaryAmt)}${cur ? ` ${cur}` : ''} / ${salaryPeriod === 'year' ? 'yr' : 'mo'}` : '—'}
                        </div>
                      )}
                    </Field>
                    <Field label="Day rate">
                      <div className={`cp-static${derivedDayRate != null ? '' : ' cp-empty'}`}>
                        {derivedDayRate != null ? `${money(derivedDayRate)}${cur ? ` ${cur}` : ''}` : '—'}
                      </div>
                    </Field>
                  </div>
                </div>
              )}

              <div className="cp-group">
                <div className="cp-group-head"><span className="dia">◆</span><span className="t">Benefits</span><span className="line" /></div>
                <div className="cp-grid">
                  {fld('Travel allowance', ben.travelAllowance, benTxt('travelAllowance', 'e.g. 1 flight home per rotation'))}
                  {fld('Health insurance — provider', ben.healthInsuranceProvider, benTxt('healthInsuranceProvider', 'e.g. Pantaenius'))}
                  {fld('Health insurance — policy №', ben.healthInsurancePolicy, benTxt('healthInsurancePolicy', '—'))}
                  {fld('Pension', ben.pension, benTxt('pension', 'e.g. 5% employer contribution'))}
                  {fld('Bonus / tips structure', ben.bonus, benTxt('bonus', 'e.g. Discretionary, shared tips'))}
                  {fld('Flights', [ben.flightType, ben.flightsPerYear ? `${ben.flightsPerYear} / yr` : null].filter(Boolean).join(' · '),
                    <div className="cp-split-row">
                      <select className="cp-inline-select" value={ben.flightType || ''} onChange={(e) => setB('flightType', e.target.value)}>
                        <option value="">—</option>
                        <option value="Economy">Economy</option>
                        <option value="Premium economy">Premium economy</option>
                        <option value="Business">Business</option>
                        <option value="First">First</option>
                      </select>
                      <input className="cp-inline-box" type="number" min="0" placeholder="No." value={ben.flightsPerYear || ''} onChange={(e) => setB('flightsPerYear', e.target.value)} />
                      <span className="cp-split-unit">/ yr</span>
                    </div>)}
                </div>
              </div>

              <div className="cp-group">
                <div className="cp-group-head"><span className="dia">◆</span><span className="t">Compliance</span><span className="line" /></div>
                <div className="cp-grid">
                  {/* Flag (= governing law) drives the contract standard — paired. */}
                  {inheritedFld('Flag state', vesselCompliance?.flag)}
                  {inheritedFld('Crew contract standard', crewContractStandard({
                    flag: vesselCompliance?.flag,
                    commercialStatus: vesselCompliance?.commercial_status,
                    certifiedCommercial: vesselCompliance?.certified_commercial,
                  }))}
                  {/* SEA reference is per-crew (their individual agreement number). */}
                  <Field label="SEA reference" full hint={editing ? 'The crew member’s signed Seafarer Employment Agreement (SEA) number — enter when the signed SEA is filed' : undefined}>
                    {editing
                      ? txt('sea_reference', 'e.g. SEA-2026-014')
                      : <div className={`cp-static${empForm.sea_reference ? '' : ' cp-empty'}`}>{empForm.sea_reference || '—'}</div>}
                  </Field>
                </div>
                <p className="cp-set-note">SEA reference is the crew member’s individual Seafarer Employment Agreement number. Flag state (the governing law) is set once in Vessel Settings; the contract standard derives from the flag and whether the vessel is private or commercial.</p>
              </div>

              {!canEditPermissions && <p className="cp-set-note">Employment details are managed by COMMAND.</p>}
            </div>

            {/* Right — contract document rail */}
            {canEditPermissions && (
              <div className="cp-rail">
                <div className="cp-rail-card">
                  <div className="h">Contract document</div>
                  <p className="p">Upload or create a template to auto-generate a contract for this crew member.</p>
                  {activeTemplate && (
                    <div className="cp-rail-chosen">
                      <span className="cp-rail-chosen-label">Template</span>
                      <span className="cp-rail-chosen-name">{activeTemplate.name}</span>
                    </div>
                  )}
                  <button type="button" className="cp-rail-btn fill" disabled={generating}
                    onClick={() => handleGenerateContract()}>
                    {generating ? 'Generating…' : '✦ Generate contract'}
                  </button>
                  <button type="button" className="cp-rail-btn ghost" disabled={generating}
                    onClick={() => setTemplateModalOpen(true)}>
                    {activeTemplate ? 'Change template' : 'Choose template'}
                  </button>
                </div>
                <div className="cp-rail-card">
                  <div className="h sm">Status</div>
                  <div className="cp-rail-status"><span>Profile data</span><span className="cp-rail-badge ok">Ready</span></div>
                  <div className="cp-rail-status"><span>Template</span><span className={`cp-rail-badge ${hasTemplate ? 'ok' : 'warn'}`}>{hasTemplate ? `${templates.length} available` : 'None yet'}</span></div>
                  <div className="cp-rail-status">
                    <span>Last generated</span>
                    {lastGenerated ? (
                      lastGenerated.file_url
                        ? <a href={lastGenerated.file_url} target="_blank" rel="noreferrer" style={{ color: '#C65A1A', fontWeight: 600 }}>{fmtDate(lastGenerated.updated_at)}</a>
                        : <span>{fmtDate(lastGenerated.updated_at)}</span>
                    ) : <span style={{ color: '#AEB4C2' }}>—</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {templateModalOpen && (
          <ContractTemplateModal
            tenantId={activeTenantId}
            crewMember={crewMember}
            selectedId={activeTemplate?.id}
            canManage={canEditPermissions}
            createdBy={session?.user?.id}
            onSelect={(t) => { setSelectedTemplate(t); fetchTemplates(activeTenantId).then(setTemplates).catch(() => {}); }}
            onClose={() => { setTemplateModalOpen(false); fetchTemplates(activeTenantId).then(setTemplates).catch(() => {}); }}
          />
        )}
      </div>
    );
  };

  const renderContent = () => {
    switch (activeSection) {
      case 'contract':
        return renderContract();
      case 'permissions':
        return renderPermissions();
      case 'notifications':
        return renderNotifications();
      case 'personal':
        return renderPersonalDetails();
      case 'statement':
        return (
          <ProfileStatementTab
            userId={crewId}
            tenantId={activeTenantId}
            currentUserId={session?.user?.id}
            crewName={crewMember?.fullName}
            role={empForm?.rank_held || crewMember?.role || ''}
            nationality={formData?.nationality || crewMember?.nationality || ''}
            canEdit={isOwnProfile || isVesselAdmin || currentUserPermissionTier === 'COMMAND'}
            isOwnProfile={isOwnProfile}
          />
        );
      case 'emergency':
        return renderEmergencyContact();
      case 'documents':
        return (
          <DocumentsTab
            userId={crewId}
            tenantId={activeTenantId}
            createdBy={session?.user?.id}
            canEdit={canEdit}
            crewName={crewMember?.fullName}
            crewDob={formData?.dateOfBirth}
            openPreset={docPreset}
            onPresetHandled={() => setDocPreset(null)}
            onProfileSynced={refreshPersonalDetails}
          />
        );
      case 'kit':
        return (
          <IssuedKitTab
            userId={crewId}
            tenantId={activeTenantId}
            currentUserId={session?.user?.id}
            currentUserName={myProfile?.full_name || ''}
            crewName={crewMember?.fullName}
            crewSex={formData?.sex}
            vesselName={empForm?.vessel_name}
            canManage={isVesselAdmin || currentUserPermissionTier === 'COMMAND'}
            isOwnProfile={isOwnProfile}
          />
        );
      case 'banking':
        return renderBanking();
      case 'preferences':
        return renderPreferences();
      case 'hor':
        return renderHOR();
      case 'documents':
        return renderDocuments();
      case 'seatime':
        return renderSeaTime();
      case 'history':
        return (
          <StatusHistoryTab
            userId={crewId}
            tenantId={activeTenantId}
            canManage={isVesselAdmin || currentUserPermissionTier === 'COMMAND'}
            currentUserId={session?.user?.id}
            currentUserName={myProfile?.full_name || ''}
          />
        );
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
              <LogoSpinner size={48} className="mx-auto mb-4" />
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
        <main className="crew-profile-page p-6 max-w-[1800px] mx-auto">
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
            {/* Left Navigation — grouped editorial rail (flat, no 3D edge).
                self-start so the rail hugs its own content instead of
                stretching to the (much taller) content column. */}
            <div className="cp-flatcard p-3 self-start">
              <nav>
                {navGroups.map((group, gi) => (
                  <div key={group.label}>
                    <div className={`cp-nav-grp${gi === 0 ? ' first' : ''}`}>{group.label}</div>
                    {group.keys.map((key) => {
                      const section = navigationSections.find((s) => s.key === key);
                      if (!section) return null;
                      const isActive = activeSection === section.key;
                      return (
                        <button
                          key={section.key}
                          onClick={() => {
                            setActiveSection(section.key);
                            setIsEditing(false);
                          }}
                          className={`cp-nav-it${isActive ? ' active' : ''}`}
                        >
                          <Icon name={section.icon} size={18} />
                          <span className="leading-tight break-words">{section.label}</span>
                        </button>
                      );
                    })}
                  </div>
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
              onClose={async () => {
                setBreachedDates([]);
                // Refresh reasons BEFORE closing so the post-breach sign-off
                // continuation (the effect keyed on signOffAfterBreach) re-checks
                // against the just-saved reasons rather than stale state.
                await loadHORData();
                setShowBreachNotesModal(false);
                if (!signOffAfterBreach) showToast('Breach reasons saved', 'success');
              }}
              breachedDates={breachedDates}
              userId={crewId}
              currentUserId={currentUser?.id}
              tenantId={activeTenantId}
            />
          )}

          <StatusChangeModal
            isOpen={statusChangeModalOpen}
            onClose={() => setStatusChangeModalOpen(false)}
            onConfirm={handleProfileStatusChange}
            memberName={crewMember?.fullName}
            currentStatus={crewMember?.status}
            saving={statusChangeSaving}
          />

          {/* HOR month sign-off — drawn signature + audit trail (crew submit /
              master counter-sign). The transition RPC runs on confirm. */}
          {signOff && (
            <SignOffModal
              isOpen={!!signOff}
              onClose={() => setSignOff(null)}
              onConfirm={signOff.onConfirm}
              title={signOff.title}
              declaration={signOff.declaration}
              periodLabel={signOff.periodLabel}
              defaultName={signOff.defaultName}
              confirmLabel={signOff.confirmLabel}
              kind={signOff.kind}
              breaches={signOff.breaches}
            />
          )}
        </main>
      )}
    </div>
  );
};

export default CrewProfile;
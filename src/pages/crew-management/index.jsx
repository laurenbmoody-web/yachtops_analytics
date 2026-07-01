import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import LogoSpinner from '../../components/LogoSpinner';

import { Department, UserStatus, getTierDisplayName, hasCommandAccess, getCurrentUser } from '../../utils/authStorage';
import { getStatusLabel, CREW_STATUSES } from '../../utils/crewStatus';
import InviteCrewModal from './components/InviteCrewModal';
import PendingInvitesSection from './components/PendingInvitesSection';
import EditCrewModal from './components/EditCrewModal';
import ViewProfileModal from './components/ViewProfileModal';
import EditAssignmentModal from './components/EditAssignmentModal';
import EditEmploymentModal from './components/EditEmploymentModal';
import StatusChangeModal from './components/StatusChangeModal';
import CrewMovements from './components/CrewMovements';
import GuestBookExportModal from './components/GuestBookExportModal';
import { supabase } from '../../lib/supabaseClient';
import { getMyContext } from '../../utils/authHelpers';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { logActivity } from '../../utils/activityStorage';
import { fetchExpiringDocuments, getExpiryStatus, fetchCrewDocuments, groupDocumentVersions, findHistoricDocIds, getDocStatus, formatDocDate } from '../crew-profile/utils/crewDocuments';
import { getDocType } from '../crew-profile/documentTypes';
import { fetchCalendarEntries, saveCalendarEntry } from '../crew-profile/utils/crewCalendar';
import '../../styles/editorial.css';
import './crew-management.css';

// DEV_MODE constant
const DEV_MODE = true;

// Initials for the editorial avatar fallback.
const initials = (n) => String(n || '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '—';

// Avatar — real photo when one is on file, initials otherwise. Container styling
// comes from the passed className; the img fills it.
const Avatar = ({ user, className }) => (
  <span className={className}>
    {user?.photo
      ? <img src={user.photo} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      : initials(user?.fullName)}
  </span>
);

// Canonical yacht department order for grouping; anything else sorts after, with
// "no department" last.
const DEPT_ORDER = ['Bridge', 'Deck', 'Engineering', 'Interior', 'Galley', 'Spa', 'Security', 'Aviation', 'Shore / Management'];
const deptRank = (name) => {
  if (!name || name === '—') return 999;
  const i = DEPT_ORDER.indexOf(name);
  return i === -1 ? 500 : i;
};

// Status dot colours for the gallery / console / hierarchy views.
const STATUS_COLORS = {
  active: '#2E9E6B', on_leave: '#C0851F', rotational_leave: '#7C5CBF',
  medical_leave: '#C65A1A', training_leave: '#3B82F6', travelling: '#0F9C8E', invited: '#AEB4C2',
};
const statusColor = (s) => STATUS_COLORS[s] || '#AEB4C2';
const isAwayStatus = (s) => s && s !== 'active' && s !== 'invited';

// Role seniority within a department (lower = more senior) — used to pick the
// head of each branch in the hierarchy view. Heuristic, keyword-based.
const roleRank = (role) => {
  const s = String(role || '').toLowerCase();
  if (/capt|master/.test(s)) return 0;
  if (/chief officer|first officer|chief mate/.test(s)) return 1;
  if (/chief eng/.test(s)) return 1;
  if (/chief stew|head of (service|interior)|purser/.test(s)) return 1;
  if (/head chef|exec.* chef/.test(s)) return 1;
  if (/bosun/.test(s)) return 2;
  if (/2nd|second|first |1st/.test(s)) return 3;
  if (/3rd|third|sous/.test(s)) return 4;
  return 6;
};

// dd/mm/yyyy per the Cargo date convention.
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
};

// Days until the next birthday (0 = today), or null if no/!valid DOB.
const daysUntilBirthday = (dob) => {
  if (!dob) return null;
  const b = new Date(dob);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let next = new Date(now.getFullYear(), b.getMonth(), b.getDate());
  if (next < now) next = new Date(now.getFullYear() + 1, b.getMonth(), b.getDate());
  return Math.round((next - now) / 86400000);
};

// First phone value from the crew_personal_details.phones JSONB array.
const firstPhone = (phones) => {
  if (!Array.isArray(phones)) return null;
  const p = phones.find((x) => x?.value);
  return p?.value || null;
};

// Salary one-liner from a crew_compensation row.
const CUR_SYM = { EUR: '€', USD: '$', GBP: '£', AUD: 'A$', NZD: 'NZ$', CAD: 'C$', CHF: 'Fr', ZAR: 'R' };
const fmtSalary = (comp) => {
  if (!comp || comp.salary_amount == null || comp.salary_amount === '') return null;
  const sym = CUR_SYM[comp.salary_currency] || comp.salary_currency || '';
  const per = comp.salary_period === 'year' ? 'yr' : 'mo';
  return `${sym}${Number(comp.salary_amount).toLocaleString('en-GB')} / ${per}`;
};
const fmtDayRate = (comp) => {
  if (!comp || comp.day_rate == null || comp.day_rate === '') return null;
  const sym = CUR_SYM[comp.salary_currency] || comp.salary_currency || '';
  return `${sym}${Number(comp.day_rate).toLocaleString('en-GB')}`;
};

// Compact tenure from a start date — "3y 2m", "5m", or "new".
const tenure = (d) => {
  if (!d) return null;
  const start = new Date(d);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 1) return 'new';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y > 0 ? `${y}y${m ? ` ${m}m` : ''}` : `${m}m`;
};

// Add this block - showToast helper function
const showToast = (message, type = 'info') => {
  // Simple console fallback - replace with actual toast implementation if available
  console.log(`[${type?.toUpperCase()}] ${message}`);
};

const CrewManagement = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, isVesselAdmin } = useAuth();
  const { activeTenantId } = useTenant();
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserRole, setCurrentUserRole] = useState(null); // NEW: Store tenant_members.permission_tier
  const [users, setUsers] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showGuestBook, setShowGuestBook] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [showViewProfileModal, setShowViewProfileModal] = useState(false);
  const [showEditAssignmentModal, setShowEditAssignmentModal] = useState(false);
  const [viewingUserId, setViewingUserId] = useState(null);
  const [editingAssignmentMember, setEditingAssignmentMember] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ column: null, direction: null }); // null, 'asc', or 'desc'
  const [inviteRefreshTrigger, setInviteRefreshTrigger] = useState(0);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState(null);
  const timeoutRef = useRef(null);
  const [showEditEmploymentModal, setShowEditEmploymentModal] = useState(false);
  const [editingEmploymentMember, setEditingEmploymentMember] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  // Roster presentation: gallery (default) · console · hierarchy · calendar.
  const [rosterView, setRosterView] = useState('gallery');
  const [selectedUserId, setSelectedUserId] = useState(null); // console detail pane
  const [consoleDocs, setConsoleDocs] = useState([]);
  const [consoleDocsLoading, setConsoleDocsLoading] = useState(false);
  const [consoleEmp, setConsoleEmp] = useState(null); // crew_employment for the selected member
  const [consoleComp, setConsoleComp] = useState(null); // crew_compensation (COMMAND-only via RLS)
  const [consolePersonal, setConsolePersonal] = useState(null); // crew_personal_details (DOB, phones)
  const [consoleEntries, setConsoleEntries] = useState([]); // crew_calendar_entries (leave / travel)
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [flightPopover, setFlightPopover] = useState(null); // calendar entry shown in the popover
  const [hierDragId, setHierDragId] = useState(null); // crew id currently being dragged
  const [hierPos, setHierPos] = useState(null); // { x, y } viewport coords, for the drag ghost
  const [hierPlan, setHierPlan] = useState(null); // computed landing spot (row/col placeholder to render)
  const rowElRefs = useRef({}); // rowKey -> row band DOM element, for hit-testing during drag
  const orgContainerRef = useRef(null); // .cm-org element, for line-overlay coordinates
  const orgCardRefs = useRef({}); // crew id -> rendered card element, for line-overlay coordinates
  const [orgLines, setOrgLines] = useState([]); // connector lines between a card and its nearest-above neighbour
  const [statusChangeTarget, setStatusChangeTarget] = useState(null); // { userId, currentStatus, name }
  const [statusChangeSaving, setStatusChangeSaving] = useState(false);
  const [calendarRefresh, setCalendarRefresh] = useState(0);
  const [myProfile, setMyProfile] = useState(null);
  // Roster filters + enrichment (compliance + return-from-leave dates).
  const [deptFilter, setDeptFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null); // 'active' | 'away' | specific status | null
  const [docsFilter, setDocsFilter] = useState(null); // 30 | 60 | 90 | 'expired' | null
  const [needsAttention, setNeedsAttention] = useState(false);
  const [complianceByUser, setComplianceByUser] = useState({});
  const [returnByUser, setReturnByUser] = useState({});

  useEffect(() => {
    if (!session?.user?.id) return;
    supabase.from('profiles').select('full_name').eq('id', session.user.id).single()
      .then(({ data }) => setMyProfile(data));
  }, [session?.user?.id]);

  // DEBUG: Log when component mounts
  useEffect(() => {
    console.log('[CREW_MANAGEMENT] 🚀 Component mounted');
    console.log('[CREW_MANAGEMENT] 📍 Route:', location?.pathname);
    return () => {
      console.log('[CREW_MANAGEMENT] 💀 Component unmounted');
    };
  }, []);

  // Check authentication and authorization
  useEffect(() => {
    const fetchCurrentUserRole = async () => {
      if (!session?.user?.id || !activeTenantId) {
        setCurrentUserRole(null);
        return;
      }

      try {
        // Fetch current user's permission_tier from tenant_members for the active tenant
        const { data, error } = await supabase
          ?.from('tenant_members')
          ?.select('permission_tier')
          ?.eq('tenant_id', activeTenantId)
          ?.eq('user_id', session?.user?.id)
          ?.single();

        if (error) {
          console.error('[CREW] Error fetching current user permission tier:', error);
          setCurrentUserRole(null);
          return;
        }

        console.log('[CREW] Current user permission tier:', data?.permission_tier);
        setCurrentUserRole(data?.permission_tier);
      } catch (err) {
        console.error('[CREW] Failed to fetch current user role:', err);
        setCurrentUserRole(null);
      }
    };

    fetchCurrentUserRole();
  }, [session?.user?.id, activeTenantId]);

  useEffect(() => {
    const user = getCurrentUser();
    console.log('[CREW_MANAGEMENT] 👤 Current user check:', user);
    if (!user) {
      // DO NOT redirect or return null - let ProtectedRoute handle auth
      console.log('[CREW] No current user found');
      setCurrentUser(null);
      return;
    }
    console.log('[CREW_MANAGEMENT] ✅ User tier:', user?.tier);
    // Allow access - permission check is done via Supabase currentUserRole
    // Don't block based on localStorage tier which may be stale/missing
    setCurrentUser(user);
  }, []);

  useEffect(() => {
    console.log('[PAGE] Mounted /crew-management');
    // Don't fetch data here - let the second useEffect handle it
    return () => {
      if (timeoutRef?.current) {
        clearTimeout(timeoutRef?.current);
      }
    };
  }, []);

  const fetchCrewData = async (archived = false) => {
    console.log('[CREW] start fetch');
    setLoading(true);
    setTimedOut(false);
    setError(null);
    
    // Start 8-second timeout
    if (timeoutRef?.current) {
      clearTimeout(timeoutRef?.current);
    }
    timeoutRef.current = setTimeout(() => {
      console.log('[CREW] 8s timeout reached');
      setTimedOut(true);
    }, 8000);
    
    try {
      // Check if we have activeTenantId
      if (!activeTenantId) {
        // Allow in DEV_MODE
        if (DEV_MODE) {
          console.log('[CREW] DEV_MODE: rendering without tenant');
          setUsers([]);
          setLoading(false);
          return;
        }
        console.warn('[CREW] No activeTenantId, cannot fetch crew');
        setError('No tenant context (currentTenantId missing)');
        setUsers([]);
        return;
      }
      
      // Query tenant_members as base table filtered by tenant_id
      // Join profiles for display fields (email, full_name)
      // Join departments for department name
      // Join both roles and tenant_custom_roles — exactly one of role_id /
      // custom_role_id is populated on any given row, so roleTitle falls back
      // from the global role to the custom role below.
      const { data, error: fetchError } = await supabase?.from('tenant_members')?.select(`
          user_id,
          role_id,
          custom_role_id,
          permission_tier,
          permission_tier_override,
          rota_requires_acceptance,
          status,
          active,
          start_date,
          joined_at,
          org_order,
          org_row,
          reports_to,
          department_id,
          role:roles!role_id(name, default_permission_tier),
          custom_role:tenant_custom_roles!custom_role_id(name, default_permission_tier),
          departments(name),
          profiles!tenant_members_user_id_fkey(email, full_name, avatar_url)
        `)?.eq('tenant_id', activeTenantId)?.eq('active', !archived)?.order('joined_at', { ascending: false });
      
      if (fetchError) {
        // Handle AbortError specifically - this is normal when component unmounts or user navigates
        if (fetchError?.name === 'AbortError' || fetchError?.message?.includes('aborted')) {
          console.log('[CREW] Query aborted (normal - component unmounted or navigation)');
          setUsers([]);
          return;
        }

        console.error('[CREW] fetch error:', fetchError);
        
        // Surface specific error types
        if (fetchError?.code === '401' || fetchError?.code === 'PGRST301') {
          setError('Authentication error: ' + (fetchError?.message || 'Unauthorized'));
        } else if (fetchError?.code === '403' || fetchError?.code === 'PGRST302') {
          setError('Permission denied: ' + (fetchError?.message || 'Forbidden'));
        } else if (fetchError?.code === '406' || fetchError?.code === 'PGRST106') {
          setError('Query error: ' + (fetchError?.message || 'Not Acceptable'));
        } else if (fetchError?.code === '400' || fetchError?.code === 'PGRST100') {
          setError('Bad request: ' + (fetchError?.message || 'Invalid query'));
        } else {
          setError(fetchError?.message || 'Failed to load crew data');
        }
        
        console.log(`[CREW] Error: ${fetchError?.code} - ${fetchError?.message}`);
        setUsers([]);
        return;
      }
      
      console.log('[CREW] fetch success, rows:', data?.length || 0);
      
      // Transform data to match UI expectations
      const transformedData = (data || [])?.map(tm => {
        return {
          id: tm?.user_id,
          user_id: tm?.user_id,
          departmentId: tm?.department_id || '',
          roleId: tm?.role_id || '',
          rotaRequiresAcceptance: tm?.rota_requires_acceptance ?? null,
          tier: tm?.role?.default_permission_tier || tm?.custom_role?.default_permission_tier || tm?.permission_tier_override || tm?.permission_tier || null,
          effectiveTier: tm?.role?.default_permission_tier || tm?.custom_role?.default_permission_tier || tm?.permission_tier_override || tm?.permission_tier || null,
          status: tm?.status,
          active: tm?.active,
          start_date: tm?.start_date || null,
          joined_at: tm?.joined_at,
          orgOrder: tm?.org_order ?? null,
          orgRow: tm?.org_row ?? null,
          reportsTo: tm?.reports_to ?? null,
          email: tm?.profiles?.email || null,
          fullName: tm?.profiles?.full_name || null,
          full_name: tm?.profiles?.full_name || null,
          photo: tm?.profiles?.avatar_url || null,
          department: tm?.departments?.name || (tm?.department_id ? `Dept ${tm?.department_id?.substring(0, 8)}` : '—'),
          roleTitle: tm?.role?.name || tm?.custom_role?.name || 'No role',
        };
      });

      // Auto-transition: invited members whose start_date has arrived → active
      const today = new Date().toISOString().slice(0, 10);
      const toActivate = transformedData.filter(
        m => m.status === 'invited' && m.start_date && m.start_date <= today
      );
      if (toActivate.length > 0) {
        await Promise.all(toActivate.map(m =>
          supabase.from('tenant_members')
            .update({ status: 'active' })
            .eq('tenant_id', activeTenantId)
            .eq('user_id', m.user_id)
        ));
        toActivate.forEach(m => { m.status = 'active'; });
      }

      // Auto-transition: apply any future-dated status changes whose effective date has now arrived.
      // We find the most recent crew_status_history entry per member with changed_at <= now.
      // If that entry's new_status differs from tenant_members.status, the member has a pending
      // scheduled change that needs to be applied.
      const activatedIds = new Set(toActivate.map(m => m.user_id));
      const memberIds = transformedData.map(m => m.user_id).filter(Boolean);
      if (memberIds.length > 0) {
        const nowIso = new Date().toISOString();
        const { data: dueHistory } = await supabase
          .from('crew_status_history')
          .select('user_id, new_status')
          .eq('tenant_id', activeTenantId)
          .in('user_id', memberIds)
          .lte('changed_at', nowIso)
          .order('changed_at', { ascending: false });

        // Most recent due entry per user
        const mostRecentDue = {};
        for (const row of (dueHistory || [])) {
          if (!mostRecentDue[row.user_id]) mostRecentDue[row.user_id] = row;
        }

        const toApply = transformedData.filter(m =>
          !activatedIds.has(m.user_id) &&
          mostRecentDue[m.user_id] &&
          mostRecentDue[m.user_id].new_status !== m.status
        );
        if (toApply.length > 0) {
          await Promise.all(toApply.map(m =>
            supabase.from('tenant_members')
              .update({ status: mostRecentDue[m.user_id].new_status })
              .eq('tenant_id', activeTenantId)
              .eq('user_id', m.user_id)
          ));
          toApply.forEach(m => { m.status = mostRecentDue[m.user_id].new_status; });
        }
      }

      setUsers(transformedData);
    } catch (err) {
      console.error('[CREW] load failed', err);
      setError(err?.message || 'Failed to load crew data');
      setUsers([]);
    } finally {
      // CRITICAL: Always end loading state even on error
      if (timeoutRef?.current) {
        clearTimeout(timeoutRef?.current);
      }
      setLoading(false);
      console.log('[CREW] end fetch');
    }
  };

  // Load data - runs when activeTenantId, showArchived, or inviteRefreshTrigger changes
  useEffect(() => {
    if (activeTenantId || DEV_MODE) {
      fetchCrewData(showArchived);
    }
  }, [activeTenantId, inviteRefreshTrigger, showArchived]);

  // Enrich the roster with document compliance + return-from-leave dates. Runs
  // once the crew set is loaded; both are best-effort (failures leave the roster
  // unannotated rather than blocking it).
  useEffect(() => {
    const ids = (users || []).map(u => u?.user_id).filter(Boolean);
    if (!activeTenantId || ids.length === 0) { setComplianceByUser({}); setReturnByUser({}); return; }
    let cancelled = false;

    (async () => {
      // Compliance — current expiring/expired docs (version-grouped, advisory
      // excluded by the shared helper). Worst level wins per crew member.
      try {
        const expiring = await fetchExpiringDocuments(90);
        const map = {};
        for (const d of expiring || []) {
          const { level, days } = getExpiryStatus(d.expiry_date);
          const isExpired = level === 'expired';
          const cur = map[d.user_id] || { expired: 0, warning: 0, soonest: Infinity };
          if (isExpired) cur.expired += 1; else cur.warning += 1;
          if (typeof days === 'number') cur.soonest = Math.min(cur.soonest, days);
          map[d.user_id] = cur;
        }
        Object.values(map).forEach(v => { v.worst = v.expired ? 'expired' : 'warning'; });
        if (!cancelled) setComplianceByUser(map);
      } catch (e) {
        console.warn('[CREW] compliance enrich failed', e);
        if (!cancelled) setComplianceByUser({});
      }

      // Return-from-leave — soonest future status change per away crew member.
      try {
        const nowIso = new Date().toISOString();
        const { data } = await supabase
          .from('crew_status_history')
          .select('user_id, new_status, changed_at')
          .eq('tenant_id', activeTenantId)
          .in('user_id', ids)
          .gt('changed_at', nowIso)
          .order('changed_at', { ascending: true });
        const map = {};
        for (const row of (data || [])) {
          if (!map[row.user_id]) map[row.user_id] = { date: row.changed_at, status: row.new_status };
        }
        if (!cancelled) setReturnByUser(map);
      } catch (e) {
        console.warn('[CREW] return-date enrich failed', e);
        if (!cancelled) setReturnByUser({});
      }
    })();

    return () => { cancelled = true; };
  }, [activeTenantId, users]);

  // Console: default to the TOP crew member in the rail (department hierarchy
  // order — Bridge first), not the most-recently-joined.
  useEffect(() => {
    if (rosterView !== 'console') return;
    const ids = (users || []).map(u => u?.id);
    if (!selectedUserId || !ids.includes(selectedUserId)) {
      const top = [...(users || [])].sort((a, b) => deptRank(a?.department) - deptRank(b?.department))[0];
      setSelectedUserId(top?.id || ids[0] || null);
    }
  }, [rosterView, users]);

  // Console: load the selected crew member's documents, employment, compensation,
  // personal details (DOB/phone) and leave/travel entries for the detail pane.
  useEffect(() => {
    if (rosterView !== 'console' || !selectedUserId) {
      setConsoleDocs([]); setConsoleEmp(null); setConsoleComp(null); setConsolePersonal(null); setConsoleEntries([]);
      return;
    }
    let cancelled = false;
    setConsoleDocsLoading(true);
    setConsoleEmp(null); setConsoleComp(null); setConsolePersonal(null); setConsoleEntries([]); setDocsExpanded(false);
    (async () => {
      try {
        const docs = await fetchCrewDocuments(selectedUserId);
        const { currents } = groupDocumentVersions(docs || []);
        const historic = findHistoricDocIds(currents);
        // Worst-first: expired, then expiring soonest, then valid, then no-expiry.
        const sev = (d) => { const s = getDocStatus(d); return s.level === 'expired' ? -1e9 + (s.days ?? 0) : (s.days ?? 1e9); };
        const list = currents.filter(d => !historic.has(d.id)).sort((a, b) => sev(a) - sev(b));
        if (!cancelled) setConsoleDocs(list);
      } catch (e) {
        console.warn('[CREW] console docs failed', e);
        if (!cancelled) setConsoleDocs([]);
      } finally {
        if (!cancelled) setConsoleDocsLoading(false);
      }
      // Employment + compensation + personal + calendar — each best-effort.
      try {
        const { data } = await supabase
          .from('crew_employment')
          .select('contract_type, rotation_pattern, next_crew_change_date, port_of_embarkation, repatriation_destination, leave_entitlement_days, notice_period, cabin')
          .eq('tenant_id', activeTenantId).eq('user_id', selectedUserId).maybeSingle();
        if (!cancelled) setConsoleEmp(data || null);
      } catch { if (!cancelled) setConsoleEmp(null); }
      try {
        const { data } = await supabase
          .from('crew_compensation')
          .select('salary_amount, salary_currency, salary_period, day_rate')
          .eq('tenant_id', activeTenantId).eq('user_id', selectedUserId).maybeSingle();
        if (!cancelled) setConsoleComp(data || null);
      } catch { if (!cancelled) setConsoleComp(null); }
      try {
        const { data } = await supabase
          .from('crew_personal_details')
          .select('date_of_birth, phones')
          .eq('user_id', selectedUserId).maybeSingle();
        if (!cancelled) setConsolePersonal(data || null);
      } catch { if (!cancelled) setConsolePersonal(null); }
      try {
        const entries = await fetchCalendarEntries(selectedUserId);
        if (!cancelled) setConsoleEntries(entries || []);
      } catch { if (!cancelled) setConsoleEntries([]); }
    })();
    return () => { cancelled = true; };
  }, [rosterView, selectedUserId, activeTenantId]);

  const handleInviteSuccess = () => {
    // Trigger refresh of pending invites section AND crew list
    setInviteRefreshTrigger(prev => prev + 1);
    // Log crew invite to activity feed
    logActivity({
      module: 'crew',
      action: 'CREW_INVITED',
      entityType: 'crew_invite',
      entityId: null,
      summary: 'Crew member invited',
      meta: {}
    });
  };

  const handleEditSuccess = () => {
    // Reload users
    fetchCrewData();
    // Log crew update to activity feed
    logActivity({
      module: 'crew',
      action: 'CREW_UPDATED',
      entityType: 'crew_member',
      entityId: editingMember?.id || null,
      summary: `Crew member updated: ${editingMember?.fullName || ''}`,
      meta: { memberName: editingMember?.fullName }
    });
  };

  const handleEditClick = (user) => {
    setEditingMember(user);
    setShowEditModal(true);
  };

  const handleViewProfileClick = (user) => {
    setViewingUserId(user?.id);
    setShowViewProfileModal(true);
  };

  const handleEditAssignmentClick = (user) => {
    setEditingAssignmentMember(user);
    setShowEditAssignmentModal(true);
  };

  const handleEditAssignmentSuccess = () => {
    // Reload users
    fetchCrewData();
  };

  const handleEditEmploymentClick = (user) => {
    setEditingEmploymentMember(user);
    setShowEditEmploymentModal(true);
  };

  const handleEditEmploymentSuccess = () => {
    // Reload users
    fetchCrewData();
  };

  const loadPendingInvites = async () => {
    if (!currentUser?.id) return;

    try {
      // Use getMyContext() helper (same as crew list)
      const { tenantId } = await getMyContext();
      
      if (!tenantId) {
        console.warn('No active tenant for pending invites');
        setPendingInvites([]);
        return;
      }

      const { data: invites, error: invitesError } = await supabase
        ?.from('crew_invites')
        ?.select('*')
        ?.eq('tenant_id', tenantId)
        ?.in('status', ['PENDING', 'EXPIRED'])
        ?.order('created_at', { ascending: false });

      if (invitesError) {
        console.error('CREW invites error:', invitesError);
        // Do NOT block crew list if invites fail to load
        setPendingInvites([]);
        return;
      }

      setPendingInvites(invites || []);
    } catch (err) {
      console.error('CREW: Error loading invites:', err);
      // Do NOT block crew list if invites fail to load
      setPendingInvites([]);
    }
  };

  const handleRevokeInvite = async (inviteId) => {
    try {
      const { error } = await supabase
        ?.from('crew_invites')
        ?.update({ status: 'REVOKED' })
        ?.eq('id', inviteId);

      if (error) throw error;

      // Reload invites
      loadPendingInvites();
    } catch (err) {
      console.error('Error revoking invite:', err);
    }
  };

  const handleCopyInviteLink = (token) => {
    const baseUrl = window?.location?.origin;
    const link = `${baseUrl}/login-authentication?invite=${token}`;
    navigator?.clipboard?.writeText(link);
  };

  const handleArchiveCrew = async (userId) => {
    if (!window.confirm('Archive this crew member? They will no longer have access but their record will be preserved.')) {
      return;
    }

    try {
      const { data: { user: authUser } } = await supabase?.auth?.getUser();
      if (!authUser) {
        throw new Error('Not authenticated');
      }

      // Get tenant_id from RPC public.get_my_context()
      const { data: contextData, error: contextError } = await supabase?.rpc('get_my_context');

      if (contextError) throw contextError;
      if (!contextData || contextData?.length === 0) {
        throw new Error('No active tenant found');
      }

      const tenantId = contextData?.[0]?.tenant_id;

      console.log('ARCHIVE tenant_id', tenantId, 'user_id', userId);

      const { error: archiveError } = await supabase
        ?.from('tenant_members')
        ?.update({ active: false })
        ?.eq('tenant_id', tenantId)
        ?.eq('user_id', userId);

      if (archiveError) {
        console.error('ARCHIVE Supabase error:', archiveError);
        console.error('Full error object:', JSON.stringify(archiveError, null, 2));
        throw archiveError;
      }

      console.log('ARCHIVE success - Crew member archived');

      // Log crew removal to activity feed
      const archivedMember = users?.find(u => u?.id === userId);
      logActivity({
        module: 'crew',
        action: 'CREW_REMOVED',
        entityType: 'crew_member',
        entityId: userId,
        summary: `Crew member archived: ${archivedMember?.fullName || userId}`,
        meta: { memberName: archivedMember?.fullName, memberId: userId }
      });

      // Reload users
      fetchCrewData();
    } catch (err) {
      console.error('ARCHIVE error:', err);
      console.error('Full error object:', JSON.stringify(err, null, 2));
      alert(err?.message || 'Failed to archive crew member');
    }
  };

  const handleStatusChange = async (newStatus, notes, effectiveDate, effectiveTime = '00:00', travel = null) => {
    if (!statusChangeTarget) return;
    const { userId, currentStatus: oldStatus } = statusChangeTarget;
    setStatusChangeSaving(true);

    // Convert date+time → local timestamp for changed_at
    const [ey, em, ed] = effectiveDate.split('-').map(Number);
    const [eh, emin] = (effectiveTime || '00:00').split(':').map(Number);
    const changedAt = new Date(ey, em - 1, ed, eh, emin).toISOString();

    // Past/today = apply immediately; future = schedule only
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    const effectiveMidnight = new Date(ey, em - 1, ed);
    const isEffectiveNow = effectiveMidnight <= todayMidnight;

    try {
      const { error: histErr } = await supabase
        .from('crew_status_history')
        .insert({
          tenant_id:  activeTenantId,
          user_id:    userId,
          old_status: oldStatus,
          new_status: newStatus,
          changed_by: session?.user?.id,
          changed_at: changedAt,
          notes:      notes?.trim() || null,
        });
      if (histErr) throw histErr;

      if (isEffectiveNow) {
        const { error: updErr } = await supabase
          .from('tenant_members')
          .update({ status: newStatus })
          .eq('tenant_id', activeTenantId)
          .eq('user_id', userId);
        if (updErr) throw updErr;
        setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, status: newStatus } : u));
      }

      // Optional travel/leave detail → crew calendar (powers the console movement
      // strip + flight popover). Only when something was actually entered.
      if (travel && (travel.fromLocation || travel.toLocation || travel.transportNo || travel.transport || travel.departTime || travel.endDate)) {
        try {
          await saveCalendarEntry({
            userId, tenantId: activeTenantId, kind: newStatus,
            startDate: effectiveDate, endDate: travel.endDate || effectiveDate,
            fromLocation: travel.fromLocation, toLocation: travel.toLocation,
            transport: travel.transport, transportNo: travel.transportNo,
            departTime: travel.departTime, arriveTime: travel.arriveTime,
            actorId: session?.user?.id, actorName: myProfile?.full_name || null,
          });
          if (selectedUserId === userId) setConsoleEntries(await fetchCalendarEntries(userId));
        } catch (e) { console.warn('[CREW] calendar entry save failed', e); }
      }

      setStatusChangeTarget(null);
      setCalendarRefresh(n => n + 1);
    } catch (err) {
      console.error('[CREW] status update failed', err);
      alert(err?.message || 'Failed to update status');
    } finally {
      setStatusChangeSaving(false);
    }
  };

  const handleRestoreCrew = async (userId) => {
    const { error } = await supabase
      ?.from('tenant_members')
      ?.update({ active: true, status: 'active' })
      ?.eq('tenant_id', activeTenantId)
      ?.eq('user_id', userId);
    if (error) {
      alert(error?.message || 'Failed to restore crew member');
      return;
    }
    fetchCrewData(true); // refresh archived list
  };

  // Get role title
  const getRoleTitle = (roleId) => {
    // No longer needed - using joined data directly
    return roleId || '—';
  };

  // Get effective tier display
  const getEffectiveTierDisplay = (user) => {
    return getTierDisplayName(user?.effectiveTier || user?.tier) || '—';
  };

  // Enhanced search filter - searches across all fields
  const getSearchFilteredUsers = () => {
    if (!searchQuery?.trim()) {
      return users;
    }

    const query = searchQuery?.toLowerCase()?.trim();
    return users?.filter(user => {
      const name = user?.fullName?.toLowerCase() || '';
      const email = user?.email?.toLowerCase() || '';
      const department = user?.department?.toLowerCase() || '';
      const role = user?.roleTitle?.toLowerCase() || '';
      const tier = getEffectiveTierDisplay(user)?.toLowerCase() || '';
      const status = user?.status?.toLowerCase() || '';

      return name?.includes(query) ||
             email?.includes(query) ||
             department?.includes(query) ||
             role?.includes(query) ||
             tier?.includes(query) ||
             status?.includes(query);
    });
  };

  // Sort function
  const getSortedUsers = (usersToSort) => {
    if (!sortConfig?.column || !sortConfig?.direction) {
      return usersToSort;
    }

    const sorted = [...usersToSort]?.sort((a, b) => {
      let aValue, bValue;

      switch (sortConfig?.column) {
        case 'name':
          aValue = a?.fullName?.toLowerCase() || '';
          bValue = b?.fullName?.toLowerCase() || '';
          break;
        case 'email':
          aValue = a?.email?.toLowerCase() || '';
          bValue = b?.email?.toLowerCase() || '';
          break;
        case 'department':
          aValue = a?.department?.toLowerCase() || '';
          bValue = b?.department?.toLowerCase() || '';
          break;
        case 'role':
          aValue = a?.roleTitle?.toLowerCase() || '';
          bValue = b?.roleTitle?.toLowerCase() || '';
          break;
        case 'tier':
          aValue = getEffectiveTierDisplay(a)?.toLowerCase() || '';
          bValue = getEffectiveTierDisplay(b)?.toLowerCase() || '';
          break;
        case 'status':
          // ACTIVE before INACTIVE for ascending
          aValue = a?.status === UserStatus?.ACTIVE ? 0 : 1;
          bValue = b?.status === UserStatus?.ACTIVE ? 0 : 1;
          break;
        default:
          return 0;
      }

      if (sortConfig?.column === 'status') {
        // Numeric comparison for status
        return sortConfig?.direction === 'asc' ? aValue - bValue : bValue - aValue;
      } else {
        // String comparison for other fields
        if (aValue < bValue) return sortConfig?.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig?.direction === 'asc' ? 1 : -1;
        return 0;
      }
    });

    return sorted;
  };

  // Handle column header click for sorting
  const handleSort = (column) => {
    setSortConfig(prev => {
      if (prev?.column === column) {
        // Same column: toggle asc -> desc -> null
        if (prev?.direction === 'asc') {
          return { column, direction: 'desc' };
        } else if (prev?.direction === 'desc') {
          return { column: null, direction: null }; // Reset to no sort
        }
      }
      // New column: start with asc
      return { column, direction: 'asc' };
    });
  };

  // Render sort icon — editorial chevron stack, terracotta when active.
  const renderSortIcon = (column) => {
    const active = sortConfig?.column === column && sortConfig?.direction;
    if (active === 'asc') {
      return <span className="cm-sort-ico is-active"><Icon name="ChevronUp" size={12} /></span>;
    }
    if (active === 'desc') {
      return <span className="cm-sort-ico is-active"><Icon name="ChevronDown" size={12} /></span>;
    }
    return (
      <span className="cm-sort-ico">
        <Icon name="ChevronUp" size={11} className="-mb-0.5" />
        <Icon name="ChevronDown" size={11} />
      </span>
    );
  };

  // Apply the editorial roster filters (department chip, status from header stat
  // clicks, and the "needs attention" toggle) on top of search + sort.
  const applyRosterFilters = (list) => (list || []).filter((u) => {
    if (deptFilter && (u?.department || '—') !== deptFilter) return false;
    if (statusFilter === 'active' && u?.status !== 'active') return false;
    else if (statusFilter === 'away' && (u?.status === 'active' || u?.status === 'invited' || !u?.status)) return false;
    else if (statusFilter && statusFilter !== 'active' && statusFilter !== 'away' && u?.status !== statusFilter) return false;
    if (needsAttention && !complianceByUser[u?.user_id]) return false;
    if (docsFilter) {
      const comp = complianceByUser[u?.user_id];
      if (!comp) return false;
      if (docsFilter === 'expired') { if (!comp.expired) return false; }
      else if ((comp.soonest ?? Infinity) > Number(docsFilter)) return false;
    }
    return true;
  });

  const filteredAndSortedUsers = applyRosterFilters(getSortedUsers(getSearchFilteredUsers()));

  // Department chips — drawn from the whole loaded set so they stay stable.
  const deptList = [...new Set((users || []).map((u) => u?.department || '—'))]
    .sort((a, b) => deptRank(a) - deptRank(b) || a.localeCompare(b));

  // Group the visible roster by department for the editorial sectioned table.
  const groupedByDept = (() => {
    const m = new Map();
    for (const u of filteredAndSortedUsers) {
      const key = u?.department || '—';
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(u);
    }
    return [...m.entries()].sort((a, b) => deptRank(a[0]) - deptRank(b[0]) || a[0].localeCompare(b[0]));
  })();

  // Count of crew flagged for compliance attention (visible set).
  const attentionCount = filteredAndSortedUsers.filter((u) => complianceByUser[u?.user_id]).length;

  // Compliance badge — driven by the enriched expiry map. Absence of a flag means
  // nothing expiring inside 90 days (shown quietly, not as a green "valid").
  const renderCompliance = (user) => {
    const comp = complianceByUser[user?.user_id];
    if (!comp) return <span className="cm-comp ok">Clear</span>;
    const cls = comp.worst === 'expired' ? 'expired' : 'warn';
    const label = comp.expired
      ? `${comp.expired} expired`
      : `${comp.warning} expiring`;
    return (
      <button className={`cm-comp ${cls}`} title="View documents" onClick={() => navigate(`/profile/${user?.id}?tab=documents`)}>
        <Icon name="AlertTriangle" size={12} />
        {label}
      </button>
    );
  };

  const renderCrewRow = (user) => {
    const isAway = user?.status && user?.status !== 'active' && user?.status !== 'invited';
    const ret = returnByUser[user?.user_id];
    const since = user?.start_date || user?.joined_at;
    const ten = tenure(since);
    return (
      <tr key={user?.id}>
        <td>
          <div className="cm-person">
            <span className="cm-av">{initials(user?.fullName)}</span>
            <div style={{ minWidth: 0 }}>
              <div className="cm-name">{user?.fullName}</div>
              <div className="cm-sub">{user?.email}</div>
            </div>
          </div>
        </td>
        <td className="cm-cell-ink">{user?.roleTitle}</td>
        <td><span className="cm-pill cm-pill-perm">{getEffectiveTierDisplay(user)}</span></td>
        <td>
          <div className="cm-tenure">{fmtDate(since)}</div>
          {ten && <div className="cm-sub">{ten}</div>}
        </td>
        <td>
          {hasEditPermission ? (
            <button
              className="cm-pill cm-pill-status"
              onClick={() => setStatusChangeTarget({ userId: user?.id, currentStatus: user?.status, name: user?.fullName })}
            >
              <span className={`cm-dot s-${user?.status || 'unknown'}`} />
              {getStatusLabel(user?.status)}
              <Icon name="ChevronDown" size={11} className="cm-status-badge" />
            </button>
          ) : (
            <span className="cm-pill cm-pill-status">
              <span className={`cm-dot s-${user?.status || 'unknown'}`} />
              {getStatusLabel(user?.status)}
            </span>
          )}
          {isAway && ret && <div className="cm-sub is-accent">Back {fmtDate(ret.date)}</div>}
        </td>
        <td>{renderCompliance(user)}</td>
        <td>
          <div className="cm-acts">
            <button className="cm-iconbtn" onClick={() => navigate(`/profile/${user?.id}`)} title="View profile">
              <Icon name="Eye" size={16} />
            </button>
            {hasEditPermission && !showArchived && (
              <>
                <button className="cm-iconbtn" onClick={() => handleEditEmploymentClick(user)} title="Edit employment">
                  <Icon name="Edit" size={16} />
                </button>
                <button className="cm-iconbtn" onClick={() => handleArchiveCrew(user?.id)} title="Archive">
                  <Icon name="Archive" size={16} />
                </button>
              </>
            )}
            {showArchived && hasEditPermission && (
              <button className="cm-iconbtn" onClick={() => handleRestoreCrew(user?.id)} title="Restore">
                <Icon name="RotateCcw" size={16} />
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // ── Concept B — Crew gallery card ────────────────────────────────────────
  const renderGalleryCard = (user) => {
    const comp = complianceByUser[user?.user_id];
    const since = user?.start_date || user?.joined_at;
    const ten = tenure(since);
    const isAway = user?.status && user?.status !== 'active' && user?.status !== 'invited';
    const ret = returnByUser[user?.user_id];
    return (
      <div key={user?.id} className="cm-gcard" onClick={() => navigate(`/profile/${user?.id}`)}>
        {comp && (
          <span className={`cm-gribbon ${comp.worst === 'expired' ? 'exp' : 'warn'}`}>
            {comp.expired ? `${comp.expired} expired` : `${comp.warning} expiring`}
          </span>
        )}
        <Avatar user={user} className="cm-gph" />
        <div className="cm-gname">{user?.fullName}</div>
        <div className="cm-grole">{user?.roleTitle}</div>
        <div className="cm-gdept">{user?.department === '—' ? 'Unassigned' : user?.department}</div>
        <button
          className="cm-gstatus"
          onClick={(e) => { e.stopPropagation(); if (hasEditPermission) setStatusChangeTarget({ userId: user?.id, currentStatus: user?.status, name: user?.fullName }); }}
        >
          <span className="cm-dot" style={{ background: statusColor(user?.status) }} />
          {getStatusLabel(user?.status)}{isAway && ret ? ` · ${fmtDate(ret.date)}` : ''}
        </button>
        <div className="cm-gmeta">
          <div className="cm-gstat"><b>{ten || '—'}</b><span>Aboard</span></div>
          <div className={`cm-gstat${comp ? ' warn' : ''}`}><b>{comp ? (comp.expired || comp.warning) : '✓'}</b><span>{comp ? (comp.expired ? 'Expired' : 'Expiring') : 'Docs'}</span></div>
        </div>
      </div>
    );
  };

  // ── Concept C — Console (master / detail) ────────────────────────────────
  const renderConsole = () => {
    const sel = filteredAndSortedUsers.find(u => u?.id === selectedUserId) || filteredAndSortedUsers[0] || null;
    const since = sel ? (sel.start_date || sel.joined_at) : null;
    const ret = sel ? returnByUser[sel.user_id] : null;
    const comp = sel ? complianceByUser[sel.user_id] : null;
    const away = sel ? isAwayStatus(sel.status) : false;
    const todayIso = new Date().toISOString().slice(0, 10);

    // Leave / movement block — derived from the crew calendar. When away: the
    // entry covering today (its end = return). When aboard: the next upcoming
    // leave/travel entry (its start = next departure).
    const sortByStart = (a, b) => String(a.start_date).localeCompare(String(b.start_date));
    const current = (consoleEntries || []).filter(e => String(e.start_date).slice(0, 10) <= todayIso && todayIso <= String(e.end_date).slice(0, 10)).sort((a, b) => sortByStart(b, a))[0] || null;
    const upcoming = (consoleEntries || []).filter(e => String(e.start_date).slice(0, 10) > todayIso).sort(sortByStart)[0] || null;
    const moveEntry = away ? (current || upcoming) : upcoming;
    const moveLabel = away ? 'Returns' : 'Leaves';
    const moveDate = away
      ? (current?.end_date ? fmtDate(current.end_date) : (ret ? fmtDate(ret.date) : null))
      : (upcoming?.start_date ? fmtDate(upcoming.start_date) : null);
    const moveLoc = away
      ? (current?.to_location || current?.location || moveEntry?.to_location || null)
      : (upcoming?.location || upcoming?.from_location || upcoming?.to_location || null);

    const dob = consolePersonal?.date_of_birth || null;
    const bdayIn = daysUntilBirthday(dob);
    const bdaySoon = bdayIn != null && bdayIn <= 14;
    const phone = firstPhone(consolePersonal?.phones);
    const salary = fmtSalary(consoleComp);
    const dayRate = fmtDayRate(consoleComp);

    // Documents: collapsed shows only flagged (expired/expiring); expand shows all.
    const flagged = consoleDocs.filter((d) => ['expired', 'red', 'amber'].includes(getDocStatus(d).level));
    const docsShown = docsExpanded ? consoleDocs : (flagged.length ? flagged : consoleDocs.slice(0, 0));

    return (
      <div className="cm-console">
        <div className="cm-rail">
          {groupedByDept.map(([dept, members]) => (
            <div key={dept}>
              <div className="cm-rail-grp">{dept === '—' ? 'Unassigned' : dept}</div>
              {members.map((u) => (
                <div key={u?.id} className={`cm-li${sel && u?.id === sel.id ? ' is-on' : ''}`} onClick={() => setSelectedUserId(u?.id)}>
                  <Avatar user={u} className="cm-li-av" />
                  <div style={{ minWidth: 0 }}>
                    <div className="cm-li-nm">{u?.fullName}</div>
                    <div className="cm-li-rl">{u?.roleTitle}</div>
                  </div>
                  <span className="cm-li-dot" style={{ background: statusColor(u?.status) }} />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="cm-detail">
          {!sel ? (
            <div className="cm-dempty">Select a crew member.</div>
          ) : (
            <>
              <div className="cm-dhead">
                <Avatar user={sel} className="cm-dph" />
                <div className="cm-dident">
                  <div className="cm-dname">{sel.fullName}</div>
                  <div className="cm-drole">{sel.roleTitle} · {sel.department === '—' ? 'Unassigned' : sel.department} · {getEffectiveTierDisplay(sel)}</div>
                  <button
                    className="cm-pill cm-pill-status cm-dstatus"
                    disabled={!hasEditPermission}
                    onClick={() => hasEditPermission && setStatusChangeTarget({ userId: sel.id, currentStatus: sel.status, name: sel.fullName })}
                  >
                    <span className="cm-dot" style={{ background: statusColor(sel.status) }} />
                    {getStatusLabel(sel.status)}
                    {hasEditPermission && <Icon name="ChevronDown" size={11} className="cm-status-badge" />}
                  </button>
                </div>
                <div className="cm-dactions">
                  {bdaySoon && (
                    <span className="cm-bday" title={`Birthday ${bdayIn === 0 ? 'today' : `in ${bdayIn} day${bdayIn === 1 ? '' : 's'}`}`}>
                      <Icon name="Cake" size={16} />
                      {bdayIn === 0 ? 'Today' : `${bdayIn}d`}
                    </span>
                  )}
                  <button className="cm-btn cm-btn-primary" onClick={() => navigate(`/profile/${sel.id}`)}>Open profile</button>
                </div>
              </div>

              {/* Movement + cabin — leave/return with location (click for flight) */}
              <div className="cm-dmove">
                <button
                  className="cm-dmove-item"
                  disabled={!moveEntry}
                  onClick={() => moveEntry && setFlightPopover(moveEntry)}
                >
                  <span className="cm-dmove-k">{moveLabel}</span>
                  <span className="cm-dmove-v">
                    {moveDate || '—'}{moveLoc ? ` · ${moveLoc}` : ''}
                    {moveEntry && <Icon name="Plane" size={12} className="cm-dmove-ico" />}
                  </span>
                </button>
                <div className="cm-dmove-item is-static">
                  <span className="cm-dmove-k">Cabin</span>
                  <span className="cm-dmove-v">{consoleEmp?.cabin || '—'}</span>
                </div>
                <div className="cm-dmove-item is-static">
                  <span className="cm-dmove-k">Next of kin</span>
                  <button className="cm-dmove-link" onClick={() => navigate(`/profile/${sel.id}?tab=emergency`)}>View →</button>
                </div>
              </div>

              {/* Employment */}
              <div className="cm-dsec"><span>Employment</span><span className="cm-dsec-rule" /></div>
              <div className="cm-dgrid">
                <div className="cm-drow"><span className="k">Aboard since</span><span className="v">{fmtDate(since)}</span></div>
                <div className="cm-drow"><span className="k">Contract</span><span className="v">{consoleEmp?.contract_type || '—'}</span></div>
                <div className="cm-drow"><span className="k">Rotation</span><span className="v">{consoleEmp?.rotation_pattern || '—'}</span></div>
                <div className="cm-drow"><span className="k">Embarkation</span><span className="v">{consoleEmp?.port_of_embarkation || '—'}</span></div>
                <div className="cm-drow"><span className="k">Leave entitlement</span><span className="v">{consoleEmp?.leave_entitlement_days != null ? `${consoleEmp.leave_entitlement_days} days` : '—'}</span></div>
                <div className="cm-drow"><span className="k">Notice period</span><span className="v">{consoleEmp?.notice_period || '—'}</span></div>
                {salary && <div className="cm-drow"><span className="k">Salary</span><span className="v">{salary}</span></div>}
                {dayRate && <div className="cm-drow"><span className="k">Day rate</span><span className="v">{dayRate}</span></div>}
              </div>

              {/* Contact */}
              <div className="cm-dsec"><span>Contact</span><span className="cm-dsec-rule" /></div>
              <div className="cm-dgrid">
                <div className="cm-drow"><span className="k">Email</span><span className="v">{sel.email ? <a href={`mailto:${sel.email}`} className="cm-dlink">{sel.email}</a> : '—'}</span></div>
                <div className="cm-drow"><span className="k">Phone</span><span className="v">{phone ? <a href={`tel:${phone}`} className="cm-dlink">{phone}</a> : '—'}</span></div>
              </div>

              {/* Documents — flagged first, collapsible */}
              <div className="cm-dsec">
                <span>Documents &amp; certificates</span>
                <span className="cm-dsec-rule" />
                {consoleDocs.length > 0 && (
                  <button className="cm-dsec-link" onClick={() => setDocsExpanded((v) => !v)}>
                    {docsExpanded ? 'Collapse' : `Show all (${consoleDocs.length})`}
                  </button>
                )}
              </div>
              {consoleDocsLoading ? (
                <div className="cm-dempty">Loading…</div>
              ) : consoleDocs.length === 0 ? (
                <div className="cm-dempty">No documents on file yet.</div>
              ) : (
                <>
                  {!docsExpanded && flagged.length === 0 && (
                    <div className="cm-dempty">All {consoleDocs.length} in date.</div>
                  )}
                  <div className="cm-ddocs">
                    {docsShown.map((d) => {
                      const st = getDocStatus(d);
                      return (
                        <div key={d.id} className="cm-doc">
                          {getDocType(d.doc_type)?.label || d.title || d.doc_type}
                          <span className={`db ${st.level}`}>{d.expiry_date ? `${st.label} · ${formatDocDate(d.expiry_date)}` : 'On file'}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  // Apply a batch of { org_row, org_order, reports_to } patches (optimistic + best-effort save).
  const applyHierarchyPatch = async (patchMap) => {
    setUsers((prev) => prev.map((u) => {
      const p = patchMap.get(u.id);
      if (!p) return u;
      const next = { ...u, orgRow: p.org_row, orgOrder: p.org_order };
      if ('reports_to' in p) next.reportsTo = p.reports_to;
      return next;
    }));
    try {
      await Promise.all([...patchMap.entries()].map(([id, p]) =>
        supabase.from('tenant_members').update(p).eq('tenant_id', activeTenantId).eq('user_id', id)));
    } catch (e) { console.warn('[CREW] hierarchy save failed', e); }
  };

  // Default vertical level from role seniority (only used until someone drags).
  const defaultOrgRow = (u) => {
    const rr = roleRank(u.roleTitle);
    if (rr === 0) return 0;
    if (rr <= 2) return 1;
    if (rr <= 4) return 2;
    return 3;
  };

  // Connector lines for the hierarchy chart. Siblings placed CLOSE together
  // (much closer than the normal column spacing) read as a deliberate pair/team
  // — they share ONE trunk line down from whichever card is nearest above, with
  // short branches fanning out to each of them, rather than every card drawing
  // its own separate line. This groups cascade downward: a merged pair itself
  // becomes a single anchor point for the row below, so a team can sit under a
  // paired set of leads without attaching to just one of them. Measured from
  // real rendered positions so it always matches the current layout; recomputed
  // after layout settles, on any reorder, and on resize.
  // An explicit pair (dropped directly onto another card) always lands at
  // EXACTLY PAIR_GAP_PX (200) from it — a fixed, deterministic offset, not a
  // mouse-precision guess. This threshold just needs to comfortably include
  // that exact distance while excluding normal (220px) sibling spacing.
  const TIGHT_PX = 210;
  useEffect(() => {
    if (rosterView !== 'hierarchy') return;
    let cancelled = false;
    const recompute = () => {
      if (cancelled) return;
      const container = orgContainerRef.current;
      if (!container) return;
      const crect = container.getBoundingClientRect();
      const crew = (users || []).filter((u) => u?.status !== 'invited' && u?.fullName && u.id !== hierDragId);
      const withMeta = crew
        .map((u) => { const el = orgCardRefs.current[u.id]; return el ? { u, el } : null; })
        .filter(Boolean)
        .map(({ u, el }) => {
          const r = el.getBoundingClientRect();
          return {
            id: u.id,
            reportsTo: u.reportsTo || null,
            row: u.orgRow != null ? u.orgRow : defaultOrgRow(u),
            cx: r.left + r.width / 2 - crect.left,
            left: r.left - crect.left, right: r.right - crect.left,
            top: r.top - crect.top, bottom: r.bottom - crect.top,
          };
        });
      const rowKeys = [...new Set(withMeta.map((m) => m.row))].sort((a, b) => a - b);

      // Cluster a row's cards into groups wherever consecutive gaps are tight.
      const clusterRow = (nodes) => {
        const sorted = [...nodes].sort((a, b) => a.cx - b.cx);
        const groups = [];
        sorted.forEach((n) => {
          const last = groups[groups.length - 1];
          if (last && n.cx - last.nodes[last.nodes.length - 1].cx < TIGHT_PX) last.nodes.push(n);
          else groups.push({ nodes: [n] });
        });
        return groups.map((g) => ({
          nodes: g.nodes,
          anchorX: (g.nodes[0].cx + g.nodes[g.nodes.length - 1].cx) / 2,
          top: Math.min(...g.nodes.map((n) => n.top)),
          bottom: Math.max(...g.nodes.map((n) => n.bottom)),
        }));
      };

      // Family-tree style: every segment is strictly horizontal or vertical
      // (never diagonal) — a short "marriage bar" links a paired group at their
      // shared mid-height; a vertical trunk drops from the group/person down to
      // a horizontal bar spanning all their children, with vertical stems to each.
      const lines = [];
      let prevGroups = null;
      let prevNodeById = null;
      rowKeys.forEach((key) => {
        const rowNodes = withMeta.filter((m) => m.row === key);
        const groups = clusterRow(rowNodes);
        const nodeById = new Map(rowNodes.map((n) => [n.id, n]));

        // Pair link — a straight horizontal bar between consecutive members of a
        // group, at their shared vertical mid-height, from one card's edge to
        // the next's (never through the boxes themselves).
        groups.forEach((g) => {
          if (g.nodes.length < 2) return;
          const midY = (g.nodes[0].top + g.nodes[0].bottom) / 2;
          const sorted = [...g.nodes].sort((a, b) => a.cx - b.cx);
          for (let i = 0; i < sorted.length - 1; i++) {
            lines.push({ x1: sorted[i].right, y1: midY, x2: sorted[i + 1].left, y2: midY });
          }
        });

        if (prevGroups && prevGroups.length) {
          // Group by shared parent ANCHOR — using this row's own
          // TIGHT-CLUSTERED groups (not raw individual cards) as the CHILD
          // unit, so a paired group (already linked by its own marriage bar)
          // contributes exactly one shared stem down, not one per person.
          // The PARENT side is different: an explicit `reports_to` names one
          // specific person, so it anchors to THAT person's own card — even
          // when they're themselves paired with someone else — rather than
          // the pair's shared midpoint. Reporting to Sophie specifically (not
          // "the Sophie+Emma pair") has to visibly land on Sophie, not
          // between the two of them. Only falls back to the nearest whole
          // group, by position, for members who haven't been explicitly
          // assigned yet.
          const byParent = new Map();
          groups.forEach((g) => {
            let anchorKey = null; let anchor = null;
            for (const n of g.nodes) {
              const ancestor = n.reportsTo && prevNodeById.get(n.reportsTo);
              if (ancestor) { anchorKey = `p:${ancestor.id}`; anchor = { anchorX: ancestor.cx, bottom: ancestor.bottom, top: ancestor.top }; break; }
            }
            if (!anchor) {
              let nearest = prevGroups[0]; let best = Infinity;
              prevGroups.forEach((p) => { const d = Math.abs(p.anchorX - g.anchorX); if (d < best) { best = d; nearest = p; } });
              anchorKey = `g:${prevGroups.indexOf(nearest)}`; anchor = nearest;
            }
            if (!byParent.has(anchorKey)) byParent.set(anchorKey, { anchor, childGroups: [] });
            byParent.get(anchorKey).childGroups.push(g);
          });
          byParent.forEach(({ anchor, childGroups }) => {
            const childXs = childGroups.map((g) => g.anchorX);
            const barY = (anchor.bottom + Math.min(...childGroups.map((g) => g.top))) / 2;
            const leftX = Math.min(anchor.anchorX, ...childXs);
            const rightX = Math.max(anchor.anchorX, ...childXs);
            lines.push({ x1: anchor.anchorX, y1: anchor.bottom, x2: anchor.anchorX, y2: barY }); // trunk down from parent
            lines.push({ x1: leftX, y1: barY, x2: rightX, y2: barY }); // sibling bar
            childGroups.forEach((g) => lines.push({ x1: g.anchorX, y1: barY, x2: g.anchorX, y2: g.top })); // one stem per group (pair or single)
          });
        }
        prevGroups = groups;
        prevNodeById = nodeById;
      });
      if (!cancelled) setOrgLines(lines);
    };
    recompute();
    const raf = requestAnimationFrame(recompute); // catch late font/layout settle
    window.addEventListener('resize', recompute);
    return () => { cancelled = true; cancelAnimationFrame(raf); window.removeEventListener('resize', recompute); };
  }, [rosterView, users, hierDragId]);

  const COL_W = 220; // default (unpaired) spacing per slot
  const CARD_W = 178;
  const PAIR_GAP_PX = 200; // fixed, guaranteed-safe centre-to-centre distance for an explicit pair (just past the card's own width — never overlaps, by construction, not by mouse precision)

  // Safety net: if the browser ever fails to deliver pointerup/pointercancel to
  // the dragged card itself (lost pointer capture, tab-switch mid-drag, etc.),
  // this guarantees the drag state still clears on the next release anywhere —
  // otherwise a stuck hierDragId blocks every further drag until something else
  // happens to reset it. Applies no placement (a plain cancel), just unblocks.
  useEffect(() => {
    if (!hierDragId) return;
    const clear = () => { setHierDragId(null); setHierPos(null); setHierPlan(null); };
    const onKey = (e) => { if (e.key === 'Escape') clear(); };
    window.addEventListener('pointerup', clear);
    window.addEventListener('pointercancel', clear);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('pointercancel', clear);
      window.removeEventListener('keydown', onKey);
    };
  }, [hierDragId]);

  // ── Concept D — Free-position org chart (drag anywhere, COMMAND-editable) ──
  // Columns are GLOBAL: a card's horizontal slot is shared across every row, so
  // a person dropped near a specific card above lands in that SAME column and
  // renders directly under them — not centred independently per row.
  const renderHierarchy = () => {
    const canEdit = hasEditPermission;
    const crew = (users || []).filter((u) => u?.status !== 'invited' && u?.fullName);
    const crewById = new Map(crew.map((u) => [u.id, u]));
    const effRow = (u) => (u.orgRow != null ? u.orgRow : defaultOrgRow(u));

    const rowsMap = new Map();
    for (const u of crew) { const k = effRow(u); if (!rowsMap.has(k)) rowsMap.set(k, []); rowsMap.get(k).push(u); }
    const sortedRowKeys = [...rowsMap.keys()].sort((a, b) => a - b);

    // Default column: grouped by DEPARTMENT, not just centred per row — so a
    // newly added crew member (never dragged) lands in their own
    // department's column, under their own department's chief, instead of
    // being centred among everyone at that seniority level regardless of
    // which department they're actually in. Departments get a stable
    // left-to-right order (by their most senior member's rank, then name)
    // so the same department's column lines up row after row; within a
    // department+row cluster, members are spread by COL_STEP so two
    // adjacent defaults render one full slot apart.
    const COL_STEP = 10;
    const DEPT_STEP = 60;
    const deptOf = (u) => u.departmentId || u.department || '__none__';
    const deptSeniority = new Map();
    crew.forEach((u) => {
      if (roleRank(u.roleTitle) === 0) return; // the captain sits outside any one department
      const d = deptOf(u); const rr = roleRank(u.roleTitle);
      const cur = deptSeniority.get(d);
      if (!cur || rr < cur.rank) deptSeniority.set(d, { rank: rr, name: u.department || '' });
    });
    const deptOrder = [...deptSeniority.entries()]
      .sort((a, b) => a[1].rank - b[1].rank || a[1].name.localeCompare(b[1].name))
      .map(([d]) => d);
    const deptColBase = new Map(deptOrder.map((d, i) => [d, (i - (deptOrder.length - 1) / 2) * DEPT_STEP]));

    const defaultOrderMap = new Map();
    rowsMap.forEach((members) => {
      const byDept = new Map();
      members.forEach((u) => { const d = deptOf(u); if (!byDept.has(d)) byDept.set(d, []); byDept.get(d).push(u); });
      byDept.forEach((group, d) => {
        const base = deptColBase.get(d) ?? 0;
        const ordered = [...group].sort((a, b) => roleRank(a.roleTitle) - roleRank(b.roleTitle) || String(a.fullName).localeCompare(String(b.fullName)));
        const n = ordered.length;
        ordered.forEach((u, i) => defaultOrderMap.set(u.id, base + (i - (n - 1) / 2) * COL_STEP));
      });
    });
    const effOrder = (u) => (u.orgOrder != null ? u.orgOrder : defaultOrderMap.get(u.id));

    // Columns are CONTINUOUS values, not discrete ranks — how close two people's
    // values are directly controls how close they render. Two dragged right next
    // to each other (a small value gap) read as a deliberate pair sharing one
    // line from above; the default spacing (COL_STEP apart) reads as separate.
    const SCALE = COL_W / COL_STEP; // px per raw column-value unit
    const allCols = [...new Set(crew.map(effOrder))].sort((a, b) => a - b);
    const colMid = allCols.length ? (allCols[0] + allCols[allCols.length - 1]) / 2 : 0;
    const colOffsetPx = (value) => (value - colMid) * SCALE;

    const GAP_PAD = 22;
    const JOIN_SNAP_PX = 16; // drop almost exactly on a card's own centre → take/reorder that exact slot

    // Pure hit-test: given the raw cursor position, decide the target ROW
    // (existing row, or a brand-new level above/below/between) and the target
    // COLUMN (join an existing global column, or open a new one alongside it).
    // No hovering over a specific element required — this is arithmetic once
    // the target row's rect is known.
    const computeHover = (clientX, clientY) => {
      const rowRects = sortedRowKeys
        .map((k) => ({ key: k, el: rowElRefs.current[k] }))
        .filter((r) => r.el)
        .map((r) => ({ ...r, rect: r.el.getBoundingClientRect() }));
      if (!rowRects.length) return null;
      const containerRect = orgContainerRef.current?.getBoundingClientRect();
      const toLocalTop = (viewportY) => viewportY - (containerRect?.top || 0);

      let row = null;
      for (const r of rowRects) {
        if (clientY >= r.rect.top - GAP_PAD && clientY <= r.rect.bottom + GAP_PAD) { row = { type: 'join', rowKey: r.key, rect: r.rect }; break; }
      }
      if (!row) {
        const first = rowRects[0]; const last = rowRects[rowRects.length - 1];
        if (clientY < first.rect.top - GAP_PAD) row = { type: 'newrow', prevKey: null, nextKey: first.key, rect: first.rect, previewTop: toLocalTop(first.rect.top - GAP_PAD - 30) };
        else if (clientY > last.rect.bottom + GAP_PAD) row = { type: 'newrow', prevKey: last.key, nextKey: null, rect: last.rect, previewTop: toLocalTop(last.rect.bottom + GAP_PAD + 30) };
        else {
          for (let i = 0; i < rowRects.length - 1; i++) {
            const a = rowRects[i]; const b = rowRects[i + 1];
            if (clientY > a.rect.bottom + GAP_PAD && clientY < b.rect.top - GAP_PAD) {
              const left = Math.min(a.rect.left, b.rect.left); const right = Math.max(a.rect.right, b.rect.right);
              const midY = (a.rect.bottom + b.rect.top) / 2;
              row = { type: 'newrow', prevKey: a.key, nextKey: b.key, rect: { left, width: right - left }, previewTop: toLocalTop(midY) };
              break;
            }
          }
        }
        if (!row) {
          let nearest = rowRects[0]; let best = Infinity;
          rowRects.forEach((r) => { const d = Math.min(Math.abs(clientY - r.rect.top), Math.abs(clientY - r.rect.bottom)); if (d < best) { best = d; nearest = r; } });
          row = { type: 'join', rowKey: nearest.key, rect: nearest.rect };
        }
      }

      const targetRowOthers = row.type === 'join' ? (rowsMap.get(row.rowKey) || []).filter((m) => m.id !== hierDragId) : [];

      // Deterministic "report to" gesture: hovering directly over a specific
      // card in the row ABOVE the drop target names that person, specifically,
      // as the manager — e.g. Sophie can report to Marco alone even though
      // Emma sits right beside him. This overrides positional inference so the
      // line never has to guess between two candidates on the row above.
      let prevRowKey = null;
      if (row.type === 'join') {
        const idx = sortedRowKeys.indexOf(row.rowKey);
        prevRowKey = idx > 0 ? sortedRowKeys[idx - 1] : null;
      } else {
        prevRowKey = row.prevKey ?? null;
      }
      // Row-detection above already consumed the cursor's Y to place it in the
      // row BELOW the ancestor (that's the whole point — reporting to someone
      // means sitting underneath them), so this only tests X-alignment with
      // the ancestor's own card width — hovering literally on top of them
      // would instead register as THEIR row, triggering the pairing gesture.
      const prevRowMembers = prevRowKey != null ? (rowsMap.get(prevRowKey) || []).filter((m) => m.id !== hierDragId) : [];
      const prevRowRects = prevRowMembers
        .map((m) => { const el = orgCardRefs.current[m.id]; return el ? { m, r: el.getBoundingClientRect() } : null; })
        .filter(Boolean)
        .sort((a, b) => a.r.left - b.r.left);
      let reportsToId = null;
      for (const { m, r } of prevRowRects) {
        if (clientX >= r.left && clientX <= r.right) { reportsToId = m.id; break; }
      }
      // Lining up in the GAP between two tightly-linked ancestors (rather
      // than over either one's own card) is a distinct, deliberate gesture:
      // "report to the pair, together" — e.g. all three interior crew sharing
      // one line from a linked pair of Chief Stews, instead of splitting
      // across whichever specific one they happen to sit closest to.
      let reportsToPairIds = null;
      if (!reportsToId) {
        for (let i = 0; i < prevRowRects.length - 1; i++) {
          const a = prevRowRects[i]; const b = prevRowRects[i + 1];
          if (b.r.left - a.r.right < TIGHT_PX && clientX > a.r.right && clientX < b.r.left) {
            reportsToPairIds = [a.m.id, b.m.id];
            break;
          }
        }
      }

      // Deterministic pairing: if the cursor is literally hovering OVER another
      // card's own rendered box (not just "near" it), that's an explicit "sit
      // beside this person" gesture — not a proximity guess. The result is
      // always EXACTLY PAIR_GAP_PX from that card (left or right, whichever
      // half of the card the cursor is over), so it can never overlap, no
      // matter how imprecise the mouse. Falls back to nearest-card by distance
      // if the row is mid-drag-reflow and no card's rect exactly contains the
      // cursor (rare, but keeps the gesture forgiving).
      let hoveredCard = null;
      if (row.type === 'join') {
        for (const m of targetRowOthers) {
          const el = orgCardRefs.current[m.id];
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) { hoveredCard = { m, rect: r }; break; }
        }
      }

      let col; let pairWithId = null;
      if (hoveredCard) {
        const { m, rect } = hoveredCard;
        const side = clientX < rect.left + rect.width / 2 ? -1 : 1;
        let value = effOrder(m) + side * (PAIR_GAP_PX / SCALE);
        // Guaranteed clear of any THIRD card too — nudge outward in fixed steps
        // until the spot is actually free (bounded; cannot loop forever).
        for (let guard = 0; guard < 20; guard++) {
          const clash = targetRowOthers.some((o) => o.id !== m.id && Math.abs(effOrder(o) - value) * SCALE < PAIR_GAP_PX - 1);
          if (!clash) break;
          value += side * (PAIR_GAP_PX / SCALE);
        }
        col = { type: 'value', value };
        pairWithId = m.id;
      } else {
        const rowCenterX = row.rect.left + row.rect.width / 2;
        const rawValue = (clientX - rowCenterX) / SCALE + colMid;
        let nearestKey = null; let bestPx = Infinity;
        allCols.forEach((v) => { const d = Math.abs(v - rawValue) * SCALE; if (d < bestPx) { bestPx = d; nearestKey = v; } });
        const occupiedByOther = nearestKey !== null && targetRowOthers.some((m) => effOrder(m) === nearestKey);
        if (nearestKey !== null && bestPx < JOIN_SNAP_PX && !occupiedByOther) {
          col = { type: 'join', colKey: nearestKey };
        } else {
          // Free placement in genuinely empty space — but never so close to an
          // existing card that they'd render overlapping (that's what the
          // explicit hover-to-pair gesture above is for).
          let value = rawValue;
          if (nearestKey !== null && bestPx < PAIR_GAP_PX) {
            const dir = rawValue >= nearestKey ? 1 : -1;
            value = nearestKey + dir * (PAIR_GAP_PX / SCALE);
          }
          col = { type: 'value', value };
        }
      }

      const finalValue = col.type === 'join' ? col.colKey : col.value;
      return { row, col, pairWithId, reportsToId, reportsToPairIds, previewOffsetPx: (finalValue - colMid) * SCALE };
    };

    const finalize = (plan) => {
      if (!plan || !hierDragId) return;
      const patch = new Map();

      let finalRow;
      if (plan.row.type === 'join') finalRow = plan.row.rowKey;
      else {
        const { prevKey, nextKey } = plan.row;
        if (prevKey == null) finalRow = nextKey - 1;
        else if (nextKey == null) finalRow = prevKey + 1;
        else if (nextKey - prevKey > 1) finalRow = prevKey + 1;
        else {
          finalRow = nextKey;
          crew.forEach((u) => { if (u.id !== hierDragId && effRow(u) >= nextKey) patch.set(u.id, { org_row: effRow(u) + 1, org_order: effOrder(u) }); });
        }
      }

      const rawFinalCol = plan.col.type === 'join' ? plan.col.colKey : plan.col.value;

      // Hard backstop: never let the actual landing spot end up within
      // card-width distance of anyone else already in the destination row,
      // no matter how it was computed. (Column values are compared globally
      // across every row for "nearest" purposes, so two different rows can
      // legitimately hold nearly-identical values — that previously let a
      // drop snap essentially on top of someone in the SAME row when their
      // value happened to be a hair off from another row's occupant.)
      // Accounts for the row-shift above: a member being pushed out of
      // `finalRow` by this same drop no longer counts as an occupant of it.
      const destRowMembers = crew.filter((m) => {
        if (m.id === hierDragId) return false;
        const rowAfter = patch.has(m.id) ? patch.get(m.id).org_row : effRow(m);
        return rowAfter === finalRow;
      });
      let finalCol = rawFinalCol;
      for (let guard = 0; guard < 40; guard++) {
        const clash = destRowMembers.find((m) => Math.abs(effOrder(m) - finalCol) * SCALE < PAIR_GAP_PX - 1);
        if (!clash) break;
        const dir = finalCol >= effOrder(clash) ? 1 : -1;
        finalCol = effOrder(clash) + dir * (PAIR_GAP_PX / SCALE);
      }

      // Persist the explicit "reports to" gesture when used; otherwise clear
      // any earlier explicit assignment so this drop's position drives the
      // (positional-fallback) line instead of a now-stale manager.
      patch.set(hierDragId, { org_row: finalRow, org_order: finalCol, reports_to: plan.reportsToId || null });
      applyHierarchyPatch(patch);
    };

    const resetDrag = () => { setHierDragId(null); setHierPos(null); setHierPlan(null); };

    const cardProps = (u) => (canEdit ? {
      draggable: false, // pointer-based drag, not HTML5 DnD — works without hovering a specific drop target
      onPointerDown: (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setHierDragId(u.id); setHierPos({ x: e.clientX, y: e.clientY }); setHierPlan(null);
      },
      onPointerMove: (e) => {
        if (hierDragId !== u.id) return;
        setHierPos({ x: e.clientX, y: e.clientY });
        setHierPlan(computeHover(e.clientX, e.clientY));
      },
      onPointerUp: (e) => {
        if (hierDragId !== u.id) return;
        finalize(computeHover(e.clientX, e.clientY));
        resetDrag();
      },
      onPointerCancel: resetDrag,
    } : {});

    const dragged = hierDragId ? crewById.get(hierDragId) : null;
    const cardStyle = (key) => ({ left: `calc(50% + ${colOffsetPx(key) - 89}px)` }); // 89 = half card width (178/2)

    return (
      <div className={`cm-org${hierDragId ? ' is-dragging-any' : ''}`} ref={orgContainerRef}>
        {canEdit && (
          <div className="cm-hier-hint">
            <p className="cm-hier-hint-lead"><Icon name="Move" size={12} /> Drag anyone, anywhere to rebuild the team structure.</p>
            <ul className="cm-hier-hint-legend">
              <li><span className="cm-hier-swatch cm-hier-swatch-report" /><strong>Line up under one person above</strong> — report to them alone</li>
              <li><span className="cm-hier-swatch cm-hier-swatch-report" /><strong>Line up in the gap between a linked pair</strong> — report to both</li>
              <li><span className="cm-hier-swatch cm-hier-swatch-pair" /><strong>Drop right beside someone</strong> — pair under one shared line</li>
              <li><span className="cm-hier-swatch cm-hier-swatch-row" /><strong>Drop above, below or between rows</strong> — open a new level</li>
            </ul>
          </div>
        )}
        <svg className="cm-org-lines">
          {orgLines.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />)}
        </svg>
        {/* New-row preview — an absolute overlay, NOT a real flow row, so it
            never pushes other row bands around (that reflow was fighting the
            drag itself: shifting rows under the cursor mid-drag kept
            re-triggering a different hover result, an endless loop). */}
        {hierPlan?.row.type === 'newrow' && (
          <div
            className={`cm-onode cm-onode-placeholder cm-onode-placeholder-float${hierPlan.pairWithId ? ' is-pairing' : ''}`}
            style={{ top: hierPlan.row.previewTop, left: `calc(50% + ${hierPlan.previewOffsetPx - 89}px)` }}
          >
            {hierPlan.pairWithId && <Icon name="Link2" size={14} />}
          </div>
        )}
        <div className="cm-orows">
          {sortedRowKeys.map((rowKey) => {
            const members = rowsMap.get(rowKey) || [];
            const showJoinHere = hierPlan?.row.type === 'join' && hierPlan.row.rowKey === rowKey;
            return (
              <div
                key={rowKey}
                className="cm-orow-band"
                ref={(el) => { if (el) rowElRefs.current[rowKey] = el; else delete rowElRefs.current[rowKey]; }}
              >
                {members.map((u) => {
                  const isDragged = u.id === hierDragId;
                  const isPairTarget = showJoinHere && hierPlan.pairWithId === u.id;
                  const isReportTarget = hierPlan?.reportsToId === u.id || hierPlan?.reportsToPairIds?.includes(u.id);
                  return (
                    <div
                      key={u.id}
                      data-crew-id={u.id}
                      className={`cm-onode${canEdit ? ' is-draggable' : ''}${isDragged ? ' is-dragging' : ''}${isPairTarget ? ' is-pair-target' : ''}${isReportTarget ? ' is-report-target' : ''}`}
                      style={cardStyle(effOrder(u))}
                      ref={(el) => { if (el) orgCardRefs.current[u.id] = el; else delete orgCardRefs.current[u.id]; }}
                      {...cardProps(u)}
                    >
                      <span className="cm-onode-dot" style={{ background: statusColor(u.status) }} />
                      <Avatar user={u} className="cm-onode-av" />
                      <div className="cm-onode-nm">{u.fullName}</div>
                      <div className="cm-onode-rl">{u.roleTitle}</div>
                      {isReportTarget && (
                        <span className="cm-onode-reportbadge"><Icon name="ArrowDown" size={11} /></span>
                      )}
                    </div>
                  );
                })}
                {showJoinHere && (
                  <div
                    className={`cm-onode cm-onode-placeholder${hierPlan.pairWithId ? ' is-pairing' : ''}`}
                    style={{ left: `calc(50% + ${hierPlan.previewOffsetPx - 89}px)` }}
                  >
                    {hierPlan.pairWithId && <Icon name="Link2" size={14} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Drag ghost — follows the cursor; the source card stays in place (near-invisible, to keep receiving the pointer via capture). */}
        {dragged && hierPos && (
          <div className="cm-org-ghost" style={{ left: hierPos.x, top: hierPos.y }}>
            <Avatar user={dragged} className="cm-onode-av" />
            <div className="cm-onode-nm">{dragged.fullName}</div>
          </div>
        )}
      </div>
    );
  };

  // Editorial header stats — drawn from the loaded crew set.
  const crewStats = {
    total: users?.length || 0,
    onBoard: users?.filter(u => u?.status === 'active')?.length || 0,
    away: users?.filter(u => u?.status && u?.status !== 'active' && u?.status !== 'invited')?.length || 0,
    departments: new Set((users || []).map(u => u?.department).filter(d => d && d !== '—')).size,
  };

  // Check if user can invite (COMMAND or CHIEF)
  const canInvite = currentUser && (currentUser?.tier === 'COMMAND' || currentUser?.tier === 'CHIEF' || hasCommandAccess(currentUser));

  const hasEditPermission = isVesselAdmin || currentUserRole === 'COMMAND';

  // DEBUG: Log button render state
  useEffect(() => {
    console.log('[CREW_MANAGEMENT] 🔘 Invite button render check:', {
      currentUser: !!currentUser,
      tier: currentUser?.tier,
      canInvite,
      showInviteModal
    });
  }, [currentUser, canInvite, showInviteModal]);

  const handleInviteClick = () => {
    console.log('Invite Crew CLICK handler fired');
    console.log('tenantId', activeTenantId, 'role', currentUser?.role, 'userId', currentUser?.id);
    setShowInviteModal(true);
  };

  // CRITICAL: Always show button if user has loaded (even if permission check is pending)
  // This ensures the button is in the DOM for debugging
  const shouldShowInviteButton = currentUser || !loading;

  return (
    <div className="cm-page">
      <Header />
      <div className="cm-wrap">
        {/* Back to dashboard */}
        <button type="button" className="cm-back" onClick={() => navigate('/dashboard')}>
          <Icon name="ChevronLeft" size={16} /> Back to Dashboard
        </button>

        {/* Canonical Cargo editorial header — meta strip (crew stats folded in) +
            big uppercase greeting, primary actions on the right. */}
        <div className="cm-head">
          <p className="editorial-meta">
            <span className="dot">●</span>
            <span>Crew</span>
            <span className="bar" />
            <button type="button" className={`cm-metabtn${statusFilter === null && !deptFilter ? ' is-on' : ''}`} onClick={() => { setStatusFilter(null); setDeptFilter(null); }}>{crewStats.total} crew</button>
            <span className="bar" />
            <button type="button" className={`cm-metabtn${statusFilter === 'active' ? ' is-on' : ''}`} onClick={() => setStatusFilter(s => s === 'active' ? null : 'active')}>{crewStats.onBoard} on board</button>
            <span className="bar" />
            <button type="button" className={`cm-metabtn${statusFilter === 'away' ? ' is-on' : ''}`} onClick={() => setStatusFilter(s => s === 'away' ? null : 'away')}>{crewStats.away} away</button>
            <span className="bar" />
            <span className="muted">{crewStats.departments} departments</span>
          </p>
          <div className="cm-titlerow">
            <h1 className="editorial-greeting">
              Crew<span className="period">,</span> <em>management</em><span className="period">.</span>
            </h1>
            {shouldShowInviteButton && (
              <div className="cm-actions">
                {canInvite && (
                  <button type="button" onClick={() => setShowGuestBook(true)} className="cm-btn cm-btn-ghost" aria-label="Export guest book">
                    <Icon name="BookOpen" size={16} />
                    Export guest book
                  </button>
                )}
                <button type="button" onClick={handleInviteClick} className="cm-btn cm-btn-primary" aria-label="Invite Crew">
                  <Icon name="Mail" size={16} />
                  Invite crew
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Loading State */}
        {loading && !timedOut && (
          <div className="cm-state"><LogoSpinner size={32} /></div>
        )}

        {/* Timeout State */}
        {timedOut && loading && (
          <div className="cm-state">
            <div className="cm-state-ico warn"><Icon name="AlertTriangle" size={26} /></div>
            <h2>Still loading</h2>
            <p>Crew data is taking longer than expected to load.</p>
            <button onClick={fetchCrewData} className="cm-btn cm-btn-primary">Retry</button>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="cm-state">
            <div className="cm-state-ico err"><Icon name="AlertCircle" size={26} /></div>
            <h2>Access / data unavailable</h2>
            <p>{error}</p>
            <button onClick={fetchCrewData} className="cm-btn cm-btn-primary">Retry</button>
          </div>
        )}

        {/* Content */}
        {!loading && !error && (
          <>
            {/* Pending Invites Section */}
            <PendingInvitesSection refreshTrigger={inviteRefreshTrigger} />

            {/* Roster section */}
            <div className="cm-section">
              <div className="cm-sec-head">
                <span className="cm-sec-name">Roster</span>
                <span className="cm-sec-rule" />
                <span className="cm-sec-meta">{filteredAndSortedUsers?.length || 0} {showArchived ? 'archived' : 'crew'}</span>
              </div>

              {/* View switcher — Gallery (default) · Console · Hierarchy · Calendar */}
              <div className="cm-views">
                <button className={`cm-view${rosterView === 'gallery' ? ' is-on' : ''}`} onClick={() => setRosterView('gallery')}>
                  <Icon name="LayoutGrid" size={14} /> Gallery
                </button>
                <button className={`cm-view${rosterView === 'console' ? ' is-on' : ''}`} onClick={() => setRosterView('console')}>
                  <Icon name="PanelLeft" size={14} /> Console
                </button>
                <button className={`cm-view${rosterView === 'hierarchy' ? ' is-on' : ''}`} onClick={() => { setShowArchived(false); setRosterView('hierarchy'); }}>
                  <Icon name="Network" size={14} /> Hierarchy
                </button>
                <button className={`cm-view${rosterView === 'calendar' ? ' is-on' : ''}`} onClick={() => { setShowArchived(false); setRosterView('calendar'); }}>
                  <Icon name="CalendarDays" size={14} /> Movements
                </button>
              </div>

              {/* Search + filters — one line, gallery & console only */}
              {(rosterView === 'gallery' || rosterView === 'console') && (
                <div className="cm-toolbar">
                  <div className="cm-search">
                    <Icon name="Search" size={16} />
                    <input
                      placeholder="Search crew…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e?.target?.value)}
                    />
                  </div>
                  {deptList.length > 1 && (
                    <select className="cm-select" value={deptFilter || ''} onChange={(e) => setDeptFilter(e.target.value || null)}>
                      <option value="">All departments</option>
                      {deptList.map((d) => <option key={d} value={d}>{d === '—' ? 'Unassigned' : d}</option>)}
                    </select>
                  )}
                  <select className="cm-select" value={statusFilter || ''} onChange={(e) => setStatusFilter(e.target.value || null)}>
                    <option value="">All statuses</option>
                    <option value="active">On board</option>
                    <option value="away">Away (any)</option>
                    {CREW_STATUSES.filter(s => s.value !== 'active' && s.value !== 'invited').map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                  <select className="cm-select" value={docsFilter || ''} onChange={(e) => setDocsFilter(e.target.value ? (e.target.value === 'expired' ? 'expired' : Number(e.target.value)) : null)}>
                    <option value="">All documents</option>
                    <option value="expired">Expired</option>
                    <option value="30">Expiring ≤ 30 days</option>
                    <option value="60">Expiring ≤ 60 days</option>
                    <option value="90">Expiring ≤ 90 days</option>
                  </select>
                  <button className={`cm-chip${showArchived ? ' is-on' : ''}`} onClick={() => setShowArchived((v) => !v)}>
                    {showArchived ? 'Viewing archived' : 'Show archived'}
                  </button>
                </div>
              )}

              {/* Gallery (B) */}
              {rosterView === 'gallery' && (
                filteredAndSortedUsers?.length === 0 ? (
                  <div className="cm-empty">
                    <Icon name="Users" size={40} />
                    <h3>No crew members found</h3>
                    <p>{searchQuery || deptFilter || statusFilter || needsAttention ? 'Try adjusting your search or filters' : 'Start by inviting crew members'}</p>
                  </div>
                ) : (
                  <div className="cm-gallery">
                    {filteredAndSortedUsers.map((user) => renderGalleryCard(user))}
                  </div>
                )
              )}

              {/* Console (C) */}
              {rosterView === 'console' && (
                filteredAndSortedUsers?.length === 0 ? (
                  <div className="cm-empty">
                    <Icon name="Users" size={40} />
                    <h3>No crew members found</h3>
                    <p>{searchQuery || deptFilter || statusFilter || needsAttention ? 'Try adjusting your search or filters' : 'Start by inviting crew members'}</p>
                  </div>
                ) : renderConsole()
              )}

              {/* Hierarchy (D) */}
              {rosterView === 'hierarchy' && renderHierarchy()}

              {/* Movements — presence + cabins booking chart + configure */}
              {rosterView === 'calendar' && (
                <CrewMovements
                  members={users}
                  tenantId={activeTenantId}
                  currentUserId={session?.user?.id}
                  canManage={isVesselAdmin || ['COMMAND', 'CHIEF', 'HOD'].includes(currentUserRole)}
                  canNavigate={isVesselAdmin || currentUserRole === 'COMMAND'}
                />
              )}
            </div>
          </>
        )}
      </div>
      {/* Flight / travel details popover (console movement block) */}
      {flightPopover && (
        <div className="cm-flyover" onClick={() => setFlightPopover(null)}>
          <div className="cm-flycard" onClick={(e) => e.stopPropagation()}>
            <div className="cm-fly-head">
              <span>{flightPopover.kind === 'travelling' || flightPopover.transport ? 'Travel' : 'Leave'} details</span>
              <button className="cm-fly-x" onClick={() => setFlightPopover(null)}><Icon name="X" size={15} /></button>
            </div>
            <div className="cm-fly-route">
              {[flightPopover.from_location, flightPopover.to_location].filter(Boolean).join(' → ') || flightPopover.location || '—'}
            </div>
            <div className="cm-fly-grid">
              <div><span>Dates</span><b>{fmtDate(flightPopover.start_date)}{flightPopover.end_date && flightPopover.end_date !== flightPopover.start_date ? ` – ${fmtDate(flightPopover.end_date)}` : ''}</b></div>
              {(flightPopover.transport || flightPopover.transport_no) && <div><span>Transport</span><b>{[flightPopover.transport, flightPopover.transport_no].filter(Boolean).join(' ')}</b></div>}
              {flightPopover.depart_time && <div><span>Departs</span><b>{flightPopover.depart_time}</b></div>}
              {flightPopover.arrive_time && <div><span>Arrives</span><b>{flightPopover.arrive_time}</b></div>}
            </div>
            {flightPopover.note && <p className="cm-fly-note">{flightPopover.note}</p>}
            {!flightPopover.transport && !flightPopover.transport_no && !flightPopover.depart_time && (
              <p className="cm-fly-note">No flight details recorded yet.</p>
            )}
          </div>
        </div>
      )}
      {/* Invite Crew Modal - Render ONLY when showInviteModal is true */}
      {showInviteModal && (
        <InviteCrewModal
          isOpen={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          onSuccess={handleInviteSuccess}
        />
      )}
      {/* Guest-book export */}
      {showGuestBook && (
        <GuestBookExportModal
          open={showGuestBook}
          onClose={() => setShowGuestBook(false)}
          tenantId={activeTenantId}
          crew={users.filter((u) => u.status !== 'invited' && u.fullName)}
        />
      )}
      {/* Status Change Modal */}
      <StatusChangeModal
        isOpen={!!statusChangeTarget}
        onClose={() => setStatusChangeTarget(null)}
        onConfirm={handleStatusChange}
        memberName={statusChangeTarget?.name}
        currentStatus={statusChangeTarget?.currentStatus}
        saving={statusChangeSaving}
      />
      {/* Edit Crew Modal */}
      <EditCrewModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        member={editingMember}
        onSuccess={handleEditSuccess}
      />
      {/* View Profile Modal */}
      <ViewProfileModal
        isOpen={showViewProfileModal}
        onClose={() => setShowViewProfileModal(false)}
        userId={viewingUserId}
      />
      {/* Edit Assignment Modal */}
      <EditAssignmentModal
        isOpen={showEditAssignmentModal}
        onClose={() => setShowEditAssignmentModal(false)}
        member={editingAssignmentMember}
        onSuccess={handleEditAssignmentSuccess}
      />
      {/* Edit Employment Modal */}
      <EditEmploymentModal
        isOpen={showEditEmploymentModal}
        onClose={() => setShowEditEmploymentModal(false)}
        member={editingEmploymentMember}
        onSuccess={handleEditEmploymentSuccess}
      />
    </div>
  );
};

export default CrewManagement;
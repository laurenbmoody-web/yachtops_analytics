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
import CrewCalendar from './components/CrewCalendar';
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
  const [hierDrag, setHierDrag] = useState(null); // { id, dept } being dragged
  const [hierDrop, setHierDrop] = useState(null); // { dept, index } drop placeholder
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
          org_is_lead,
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
          isLead: tm?.org_is_lead ?? false,
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

  // Place a member under `parentId` (null = top / captain row) at position
  // `index` among `sibs`, renumbering that sibling row's org_order. Optimistic.
  const placeMember = async (draggedId, parentId, index, sibs) => {
    const without = (sibs || []).filter((s) => s.id !== draggedId);
    const clamp = Math.max(0, Math.min(index, without.length));
    const order = [...without.slice(0, clamp), { id: draggedId }, ...without.slice(clamp)];
    const idxMap = new Map(order.map((s, i) => [s.id, i]));
    setUsers((prev) => prev.map((u) => {
      let nu = u;
      if (u.id === draggedId) nu = { ...nu, reportsTo: parentId, isLead: parentId == null };
      if (idxMap.has(u.id)) nu = { ...nu, orgOrder: idxMap.get(u.id) };
      return nu;
    }));
    try {
      await Promise.all(order.map((s, i) => supabase.from('tenant_members').update(
        s.id === draggedId ? { reports_to: parentId, org_is_lead: parentId == null, org_order: i } : { org_order: i },
      ).eq('tenant_id', activeTenantId).eq('user_id', s.id)));
    } catch (e) { console.warn('[CREW] hierarchy save failed', e); }
  };

  // ── Concept D — Free-form org chart (drag-editable for COMMAND) ────────────
  const renderHierarchy = () => {
    const canEdit = hasEditPermission;
    const crew = (users || []).filter((u) => u?.status !== 'invited' && u?.fullName);
    const idSet = new Set(crew.map((u) => u.id));
    const ord = (u) => (u.orgOrder != null ? u.orgOrder : 1000 + roleRank(u.roleTitle));
    const captain = [...crew].sort((a, b) => roleRank(a.roleTitle) - roleRank(b.roleTitle))[0];
    const isCaptain = captain && roleRank(captain.roleTitle) === 0 ? captain : null;
    // Per-department senior (default parent for un-arranged crew).
    const deptSenior = {};
    for (const u of crew) {
      const k = u.department || '—';
      if (!deptSenior[k] || roleRank(u.roleTitle) < roleRank(deptSenior[k].roleTitle)) deptSenior[k] = u;
    }
    // Effective parent: explicit reports_to → explicit root (isLead) → derived
    // default (captain at top, dept seniors under captain, others under senior).
    const effParent = (m) => {
      if (m.reportsTo && idSet.has(m.reportsTo) && m.reportsTo !== m.id) return m.reportsTo;
      if (m.isLead) return null;
      if (isCaptain && m.id === isCaptain.id) return null;
      const ds = deptSenior[m.department || '—'];
      if (ds && m.id === ds.id) return isCaptain ? isCaptain.id : null;
      return ds ? ds.id : (isCaptain ? isCaptain.id : null);
    };
    const childrenOf = {};
    const roots = [];
    for (const m of crew) { const p = effParent(m); if (p) (childrenOf[p] ||= []).push(m); else roots.push(m); }
    const byOrder = (a, b) => ord(a) - ord(b) || String(a.fullName).localeCompare(String(b.fullName));
    roots.sort(byOrder);
    Object.values(childrenOf).forEach((arr) => arr.sort(byOrder));
    const descendants = (rootId) => { const out = new Set(); const stack = [...(childrenOf[rootId] || [])]; while (stack.length) { const n = stack.pop(); if (out.has(n.id)) continue; out.add(n.id); (childrenOf[n.id] || []).forEach((c) => stack.push(c)); } return out; };
    const canPlace = (draggedId, parentId) => parentId == null || (parentId !== draggedId && !descendants(draggedId).has(parentId));

    const dragProps = (u) => (canEdit ? {
      draggable: true,
      onDragStart: (e) => { setHierDrag({ id: u.id }); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', u.id); } catch { /* */ } },
      onDragEnd: () => { setHierDrag(null); setHierDrop(null); },
    } : {});

    // A slot between/around siblings — drop to insert left/right at `index`.
    const gap = (parentId, index, sibs) => {
      const key = parentId == null ? '__root' : parentId;
      const isDrop = hierDrop?.type === 'gap' && hierDrop.key === key && hierDrop.index === index;
      const active = canEdit && hierDrag && canPlace(hierDrag.id, parentId);
      return (
        <div
          className={`cm-gap${active ? ' is-active' : ''}${isDrop ? ' is-drop' : ''}`}
          onDragOver={(e) => { if (!active) return; e.preventDefault(); e.stopPropagation(); setHierDrop((p) => (p?.type === 'gap' && p.key === key && p.index === index) ? p : { type: 'gap', key, index }); }}
          onDrop={(e) => { if (!active) return; e.preventDefault(); e.stopPropagation(); placeMember(hierDrag.id, parentId, index, sibs); setHierDrag(null); setHierDrop(null); }}
        />
      );
    };

    const nodeDrop = (u) => (canEdit ? {
      onDragOver: (e) => {
        if (!hierDrag || hierDrag.id === u.id || !canPlace(hierDrag.id, u.id)) return;
        e.preventDefault(); e.stopPropagation();
        setHierDrop((p) => (p?.type === 'node' && p.id === u.id) ? p : { type: 'node', id: u.id });
      },
      onDrop: (e) => {
        if (!hierDrag || hierDrag.id === u.id || !canPlace(hierDrag.id, u.id)) return;
        e.preventDefault(); e.stopPropagation();
        const kids = childrenOf[u.id] || [];
        placeMember(hierDrag.id, u.id, kids.length, kids);
        setHierDrag(null); setHierDrop(null);
      },
    } : {});

    const renderRow = (parentId, sibs, depth, visited) => (
      <div className="cm-orow">
        {gap(parentId, 0, sibs)}
        {sibs.map((c, i) => (
          <React.Fragment key={c.id}>
            {renderSubtree(c, depth, visited)}
            {gap(parentId, i + 1, sibs)}
          </React.Fragment>
        ))}
      </div>
    );

    const renderSubtree = (u, depth, visited) => {
      if (visited.has(u.id)) return null;
      visited.add(u.id);
      const kids = childrenOf[u.id] || [];
      const dragging = hierDrag?.id === u.id;
      const isDrop = hierDrop?.type === 'node' && hierDrop.id === u.id;
      const cls = `cm-onode${depth === 0 ? ' is-root' : ''}${canEdit ? ' is-draggable' : ''}${dragging ? ' is-dragging' : ''}${isDrop ? ' is-drop' : ''}`;
      return (
        <div className="cm-onode-wrap">
          <div className={cls} {...dragProps(u)} {...nodeDrop(u)} onClick={() => { if (!hierDrag) navigate(`/profile/${u.id}`); }}>
            <span className="cm-onode-dot" style={{ background: statusColor(u.status) }} />
            <Avatar user={u} className="cm-onode-av" />
            <div className="cm-onode-nm">{u.fullName}</div>
            <div className="cm-onode-rl">{u.roleTitle}</div>
          </div>
          {kids.length > 0 && (<><div className="cm-ostem" />{renderRow(u.id, kids, depth + 1, visited)}</>)}
        </div>
      );
    };

    return (
      <div className={`cm-org${hierDrag ? ' is-dragging-any' : ''}`}>
        {canEdit && <p className="cm-hier-hint"><Icon name="Move" size={12} /> Drag anyone anywhere — drop onto a person to make them report to them, or into a gap to place them left/right (top row included)</p>}
        {renderRow(null, roots, 0, new Set())}
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
                  <Icon name="CalendarDays" size={14} /> Calendar
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

              {/* Calendar */}
              {rosterView === 'calendar' && (
                <div style={{ marginTop: '18px' }}>
                  <CrewCalendar
                    members={users}
                    tenantId={activeTenantId}
                    refreshToken={calendarRefresh}
                    canNavigate={isVesselAdmin || currentUserRole === 'COMMAND'}
                  />
                </div>
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
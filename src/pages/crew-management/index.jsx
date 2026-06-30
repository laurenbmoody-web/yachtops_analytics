import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import LogoSpinner from '../../components/LogoSpinner';

import { Department, UserStatus, getTierDisplayName, hasCommandAccess, getCurrentUser } from '../../utils/authStorage';
import { getStatusLabel } from '../../utils/crewStatus';
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
import { fetchExpiringDocuments, getExpiryStatus } from '../crew-profile/utils/crewDocuments';
import '../../styles/editorial.css';
import './crew-management.css';

// DEV_MODE constant
const DEV_MODE = true;

// Initials for the editorial avatar fallback.
const initials = (n) => String(n || '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '—';

// Canonical yacht department order for grouping; anything else sorts after, with
// "no department" last.
const DEPT_ORDER = ['Bridge', 'Deck', 'Engineering', 'Interior', 'Galley', 'Spa', 'Security', 'Aviation', 'Shore / Management'];
const deptRank = (name) => {
  if (!name || name === '—') return 999;
  const i = DEPT_ORDER.indexOf(name);
  return i === -1 ? 500 : i;
};

// dd/mm/yyyy per the Cargo date convention.
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
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
  const [showCalendar, setShowCalendar] = useState(false);
  const [statusChangeTarget, setStatusChangeTarget] = useState(null); // { userId, currentStatus, name }
  const [statusChangeSaving, setStatusChangeSaving] = useState(false);
  const [calendarRefresh, setCalendarRefresh] = useState(0);
  const [myProfile, setMyProfile] = useState(null);
  // Roster filters + enrichment (compliance + return-from-leave dates).
  const [deptFilter, setDeptFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null); // 'active' | 'away' | null
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
          department_id,
          role:roles!role_id(name, default_permission_tier),
          custom_role:tenant_custom_roles!custom_role_id(name, default_permission_tier),
          departments(name),
          profiles!tenant_members_user_id_fkey(email, full_name)
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
          email: tm?.profiles?.email || null,
          fullName: tm?.profiles?.full_name || null,
          full_name: tm?.profiles?.full_name || null,
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
          const { level } = getExpiryStatus(d.expiry_date);
          const isExpired = level === 'expired';
          const cur = map[d.user_id] || { expired: 0, warning: 0 };
          if (isExpired) cur.expired += 1; else cur.warning += 1;
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

  const handleStatusChange = async (newStatus, notes, effectiveDate, effectiveTime = '00:00') => {
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
    if (statusFilter === 'away' && (u?.status === 'active' || u?.status === 'invited' || !u?.status)) return false;
    if (needsAttention && !complianceByUser[u?.user_id]) return false;
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

              {/* Active / Archived / Calendar toggles */}
              <div className="cm-tabs">
                <button
                  onClick={() => { setShowArchived(false); setShowCalendar(false); }}
                  className={`cm-tab${!showArchived && !showCalendar ? ' is-on' : ''}`}
                >
                  Active crew
                </button>
                <button
                  onClick={() => { setShowArchived(true); setShowCalendar(false); }}
                  className={`cm-tab${showArchived ? ' is-on' : ''}`}
                >
                  Archived crew
                </button>
                <button
                  onClick={() => { setShowArchived(false); setShowCalendar(true); }}
                  className={`cm-tab${showCalendar ? ' is-on' : ''}`}
                  title="Crew availability calendar"
                >
                  <Icon name="CalendarDays" size={14} />
                  Calendar
                </button>
              </div>

              {/* Search */}
              {!showCalendar && (
                <div className="cm-search">
                  <Icon name="Search" size={16} />
                  <input
                    placeholder="Search crew by name, email, or role…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e?.target?.value)}
                  />
                </div>
              )}

              {/* Department chips + needs-attention toggle */}
              {!showCalendar && deptList.length > 1 && (
                <div className="cm-filters">
                  <button className={`cm-chip${!deptFilter ? ' is-on' : ''}`} onClick={() => setDeptFilter(null)}>All</button>
                  {deptList.map((d) => (
                    <button key={d} className={`cm-chip${deptFilter === d ? ' is-on' : ''}`} onClick={() => setDeptFilter((cur) => cur === d ? null : d)}>
                      {d === '—' ? 'Unassigned' : d}
                    </button>
                  ))}
                  {(attentionCount > 0 || needsAttention) && (
                    <button className={`cm-attn${needsAttention ? ' is-on' : ''}`} onClick={() => setNeedsAttention((v) => !v)}>
                      <Icon name="AlertTriangle" size={13} />
                      Needs attention{attentionCount ? ` · ${attentionCount}` : ''}
                    </button>
                  )}
                </div>
              )}

              {/* Calendar view */}
              {showCalendar && !showArchived && (
                <div style={{ marginTop: '18px' }}>
                  <CrewCalendar
                    members={users}
                    tenantId={activeTenantId}
                    refreshToken={calendarRefresh}
                    canNavigate={isVesselAdmin || currentUserRole === 'COMMAND'}
                  />
                </div>
              )}

              {/* Crew table — grouped by department, hidden in calendar view */}
              {!showCalendar && (filteredAndSortedUsers?.length === 0 ? (
                <div className="cm-empty">
                  <Icon name="Users" size={40} />
                  <h3>No crew members found</h3>
                  <p>{searchQuery || deptFilter || statusFilter || needsAttention ? 'Try adjusting your search or filters' : 'Start by inviting crew members'}</p>
                </div>
              ) : (
                <div className="cm-table-wrap">
                  <table className="cm-table">
                    <thead>
                      <tr>
                        <th className="cm-th-sort" onClick={() => handleSort('name')}>
                          <span className="cm-th-inner">Crew {renderSortIcon('name')}</span>
                        </th>
                        <th className="cm-th-sort" onClick={() => handleSort('role')}>
                          <span className="cm-th-inner">Role {renderSortIcon('role')}</span>
                        </th>
                        <th className="cm-th-sort" onClick={() => handleSort('tier')}>
                          <span className="cm-th-inner">Permission {renderSortIcon('tier')}</span>
                        </th>
                        <th>Since</th>
                        <th className="cm-th-sort" onClick={() => handleSort('status')}>
                          <span className="cm-th-inner">Status {renderSortIcon('status')}</span>
                        </th>
                        <th>Compliance</th>
                        <th className="cm-th-right">Actions</th>
                      </tr>
                    </thead>
                    {groupedByDept.map(([dept, members]) => (
                      <tbody key={dept}>
                        <tr className="cm-group-head">
                          <td colSpan={7}>
                            <div className="cm-group-inner">
                              <span className="cm-group-name">{dept === '—' ? 'Unassigned' : dept}</span>
                              <span className="cm-group-rule" />
                              <span className="cm-group-count">{members.length}</span>
                            </div>
                          </td>
                        </tr>
                        {members.map((user) => renderCrewRow(user))}
                      </tbody>
                    ))}
                  </table>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
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
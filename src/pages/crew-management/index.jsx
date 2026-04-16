import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';

import { Department, UserStatus, getTierDisplayName, hasCommandAccess, getCurrentUser } from '../../utils/authStorage';
import InviteCrewModal from './components/InviteCrewModal';
import PendingInvitesSection from './components/PendingInvitesSection';
import EditCrewModal from './components/EditCrewModal';
import ViewProfileModal from './components/ViewProfileModal';
import EditAssignmentModal from './components/EditAssignmentModal';
import EditEmploymentModal from './components/EditEmploymentModal';
import { supabase } from '../../lib/supabaseClient';
import { getMyContext } from '../../utils/authHelpers';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { logActivity } from '../../utils/activityStorage';

// DEV_MODE constant
const DEV_MODE = true;

// Add this block - showToast helper function
const showToast = (message, type = 'info') => {
  // Simple console fallback - replace with actual toast implementation if available
  console.log(`[${type?.toUpperCase()}] ${message}`);
};

const CrewManagement = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const { activeTenantId } = useTenant();
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserRole, setCurrentUserRole] = useState(null); // NEW: Store tenant_members.permission_tier
  const [users, setUsers] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
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

  const fetchCrewData = async () => {
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
          role,
          role_id,
          custom_role_id,
          permission_tier_override,
          status,
          active,
          joined_at,
          department_id,
          departments (name),
          roles (name),
          custom_role:tenant_custom_roles!tenant_members_custom_role_id_fkey (name),
          profiles!tenant_members_user_id_fkey (email, full_name)
        `)?.eq('tenant_id', activeTenantId)?.order('joined_at', { ascending: false });
      
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
          role: tm?.role || tm?.role_legacy, // Base role from tenant_members
          tier: tm?.permission_tier_override || tm?.permission_tier || tm?.role_legacy || 'Default', // Use permission_tier_override first, then permission_tier, then role_legacy
          effectiveTier: tm?.permission_tier_override || tm?.permission_tier || tm?.role_legacy || 'Default',
          status: tm?.status,
          active: tm?.active,
          joined_at: tm?.joined_at,
          email: tm?.profiles?.email || null,
          fullName: tm?.profiles?.full_name || null,
          full_name: tm?.profiles?.full_name || null,
          department: tm?.departments?.name || (tm?.department_id ? `Dept ${tm?.department_id?.substring(0, 8)}` : '—'),
          roleTitle: tm?.roles?.name || tm?.custom_role?.name || tm?.role || tm?.role_legacy || '—',
        };
      });

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

  // Load data - runs when activeTenantId changes or inviteRefreshTrigger changes
  useEffect(() => {
    if (activeTenantId || DEV_MODE) {
      fetchCrewData();
    }
  }, [activeTenantId, inviteRefreshTrigger]);

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

      // Archive the crew member: set active = false and status = 'INACTIVE'
      // Note: status constraint only allows INVITED/ACTIVE/INACTIVE, not ARCHIVED
      const { error: archiveError } = await supabase
        ?.from('tenant_members')
        ?.update({ 
          active: false,
          status: 'INACTIVE'
        })
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

  // Get role title
  const getRoleTitle = (roleId) => {
    // No longer needed - using joined data directly
    return roleId || '—';
  };

  // Get effective tier display
  const getEffectiveTierDisplay = (user) => {
    return getTierDisplayName(user?.effectiveTier || user?.tier);
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

  // Render sort icon
  const renderSortIcon = (column) => {
    if (sortConfig?.column !== column) {
      return (
        <div className="inline-flex flex-col ml-1 opacity-30">
          <Icon name="ChevronUp" size={12} className="-mb-1" />
          <Icon name="ChevronDown" size={12} />
        </div>
      );
    }

    if (sortConfig?.direction === 'asc') {
      return <Icon name="ChevronUp" size={14} className="inline ml-1 text-primary" />;
    } else if (sortConfig?.direction === 'desc') {
      return <Icon name="ChevronDown" size={14} className="inline ml-1 text-primary" />;
    }

    return null;
  };

  // Get final filtered and sorted users
  const filteredUsers = getSortedUsers(getSearchFilteredUsers());

  const filteredAndSortedUsers = getSortedUsers(getSearchFilteredUsers());

  // Check if user can invite (COMMAND or CHIEF)
  const canInvite = currentUser && (currentUser?.tier === 'COMMAND' || currentUser?.tier === 'CHIEF' || hasCommandAccess(currentUser));

  // NEW: Check if current user has Command or Management role
  const hasEditPermission = currentUserRole === 'COMMAND' || currentUserRole === 'MANAGEMENT';

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
    <div className="min-h-screen bg-background">
      <Header />
      {/* DEBUG: Route mounted indicator - ALWAYS VISIBLE */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed top-16 left-2 bg-yellow-200 text-yellow-900 px-2 py-1 text-xs font-mono rounded z-50">
          Route: {location?.pathname}
        </div>
      )}
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Page Header - Title and subtitle only */}
        <div className="flex items-center justify-between" style={{minHeight: '60px'}}>
          <div>
            <h1 className="text-3xl font-bold text-foreground" style={{fontSize: '30px', fontWeight: 'bold', marginBottom: '8px'}}>Crew Management</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage crew members, roles, and access permissions
            </p>
          </div>
        </div>

        {/* Loading State - Small inline loader */}
        {loading && !timedOut && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        )}

        {/* Timeout State - Still loading with retry */}
        {timedOut && loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
              <Icon name="AlertTriangle" size={32} className="text-yellow-600" />
            </div>
            <div className="text-center max-w-md">
              <h2 className="text-xl font-semibold text-foreground mb-2">Still Loading</h2>
              <p className="text-muted-foreground mb-6">
                Crew data is taking longer than expected to load.
              </p>
              <Button onClick={fetchCrewData}>
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <Icon name="AlertCircle" size={32} className="text-red-600" />
            </div>
            <div className="text-center max-w-md">
              <h2 className="text-xl font-semibold text-foreground mb-2">Access / Data Unavailable</h2>
              <p className="text-muted-foreground mb-6">
                {error}
              </p>
              <Button onClick={fetchCrewData}>
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Content - Show when not loading or when data exists */}
        {!loading && !error && (
          <>
            {/* INVITE CREW BUTTON - Moved here to sit above Pending Invites */}
            {shouldShowInviteButton && (
              <div className="flex justify-end mb-4">
                <button
                  type="button"
                  onClick={handleInviteClick}
                  aria-label="Invite Crew"
                  className="bg-gray-900 text-white hover:bg-gray-800 shadow-sm flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg transition-colors"
                  style={{
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                    zIndex: 10
                  }}
                >
                  <Icon name="Mail" size={18} />
                  Invite Crew
                </button>
              </div>
            )}

            {/* Pending Invites Section */}
            <PendingInvitesSection
              refreshTrigger={inviteRefreshTrigger}
            />

            {/* Search and Filters */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Input
                  placeholder="Search crew by name, email, or role..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e?.target?.value)}
                  iconName="Search"
                />
              </div>
            </div>

            {/* Crew Table */}
            {filteredAndSortedUsers?.length === 0 ? (
              <div className="text-center py-12">
                <Icon name="Users" size={48} className="mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No crew members found</h3>
                <p className="text-muted-foreground">
                  {searchQuery ? 'Try adjusting your search criteria' : 'Start by inviting crew members'}
                </p>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted/30 border-b border-border">
                      <tr>
                        <th 
                          className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
                          onClick={() => handleSort('name')}
                        >
                          <div className="flex items-center">
                            Name
                            {renderSortIcon('name')}
                          </div>
                        </th>
                        <th 
                          className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
                          onClick={() => handleSort('email')}
                        >
                          <div className="flex items-center">
                            Email
                            {renderSortIcon('email')}
                          </div>
                        </th>
                        <th 
                          className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
                          onClick={() => handleSort('department')}
                        >
                          <div className="flex items-center">
                            Department
                            {renderSortIcon('department')}
                          </div>
                        </th>
                        <th 
                          className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
                          onClick={() => handleSort('role')}
                        >
                          <div className="flex items-center">
                            Role
                            {renderSortIcon('role')}
                          </div>
                        </th>
                        <th 
                          className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
                          onClick={() => handleSort('tier')}
                        >
                          <div className="flex items-center">
                            Tier
                            {renderSortIcon('tier')}
                          </div>
                        </th>
                        <th 
                          className="text-left p-4 text-sm font-medium text-foreground cursor-pointer hover:bg-muted/50 transition-colors select-none"
                          onClick={() => handleSort('status')}
                        >
                          <div className="flex items-center">
                            Status
                            {renderSortIcon('status')}
                          </div>
                        </th>
                        <th className="text-right p-4 text-sm font-medium text-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAndSortedUsers?.map(user => (
                        <tr key={user?.id} className="border-b border-border hover:bg-muted/20 transition-smooth">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <Icon name="User" size={18} className="text-primary" />
                              </div>
                              <span className="text-sm font-medium text-foreground">{user?.fullName}</span>
                            </div>
                          </td>
                          <td className="p-4 text-sm text-muted-foreground">{user?.email}</td>
                          <td className="p-4 text-sm text-foreground">{user?.department}</td>
                          <td className="p-4 text-sm text-foreground">{user?.roleTitle}</td>
                          <td className="p-4">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                              {getEffectiveTierDisplay(user)}
                            </span>
                          </td>
                          <td className="p-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                              user?.status === UserStatus?.ACTIVE 
                                ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                user?.status === UserStatus?.ACTIVE ? 'bg-success' : 'bg-muted-foreground'
                              }`} />
                              {user?.status}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/profile/${user?.id}`)}
                                title="View Profile"
                              >
                                <Icon name="Eye" size={16} />
                              </Button>
                              
                              {hasEditPermission && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleEditEmploymentClick(user)}
                                    title="Edit Employment"
                                  >
                                    <Icon name="Edit" size={16} />
                                  </Button>
                                  
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleArchiveCrew(user?.id)}
                                    title="Archive"
                                  >
                                    <Icon name="Archive" size={16} />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../AppIcon';
import Image from '../AppImage';
import AcceptAdminBanner from './AcceptAdminBanner';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { getCurrentUser, clearCurrentUser, hasCommandAccess } from '../../utils/authStorage';
import { canAccessGuestManagement } from '../../pages/guest-management-dashboard/utils/guestPermissions';
import { canAccessTrips } from '../../pages/trips-management-dashboard/utils/tripPermissions';
import NotificationsDrawer from './NotificationsDrawer';
import SettingsModal from './SettingsModal';
import { getUnreadCount, checkDueAndOverdueJobs } from '../../pages/team-jobs-management/utils/notifications';
import { isDevMode } from '../../utils/devMode';


const Header = () => {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user: authUser, session } = useAuth();
  const [currentUser, setCurrentUser] = useState(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [tenantMemberRole, setTenantMemberRole] = useState(null);
  const menuRef = useRef(null);
  const alertRef = useRef(null);

  // New state for real data from Supabase
  const [profileData, setProfileData] = useState(null);
  const [tenantMemberData, setTenantMemberData] = useState(null);
  const [tenantName, setTenantName] = useState(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  
  // Debug state for last navigation
  const [lastNavPath, setLastNavPath] = useState('');

  // Load current user and fetch real data from Supabase
  useEffect(() => {
    const user = getCurrentUser();
    setCurrentUser(user);
    
    // Load tenant_members.role from sessionStorage
    const role = sessionStorage.getItem('cargo_tenant_member_role');
    setTenantMemberRole(role);
    
    // Check for due/overdue jobs on mount
    if (user?.id) {
      checkDueAndOverdueJobs(user?.id);
    }
  }, []);

  // Fetch real user data from Supabase when authenticated user is available
  useEffect(() => {
    if (authUser?.id && session) {
      fetchUserData();
    }
  }, [authUser, session]);

  // Fetch real user data from Supabase
  const fetchUserData = async () => {
    try {
      setIsLoadingData(true);

      // Use authenticated user from AuthContext (no need to call getUser())
      if (!authUser?.id) {
        console.log('Header: No authenticated user available');
        setIsLoadingData(false);
        return;
      }

      // Refresh session first to ensure token is valid before making requests
      const { data: { session: refreshedSession }, error: refreshError } = await supabase?.auth?.getSession();
      if (refreshError || !refreshedSession) {
        console.warn('Header: Session not available, skipping profile fetch');
        setIsLoadingData(false);
        return;
      }

      // Fetch profile data (full_name)
      const { data: profile, error: profileError } = await supabase
        ?.from('profiles')
        ?.select('id, full_name, email')
        ?.eq('id', authUser?.id)
        ?.single();

      if (profileError) {
        // "Load failed" is a network-level error (Safari/iOS) — not a data error, skip silently
        const isNetworkError = profileError?.message?.includes('Load failed') || 
                               profileError?.message?.includes('Failed to fetch') ||
                               profileError?.message?.includes('NetworkError');
        if (!isNetworkError) {
          console.error('Header: Error fetching profile', profileError);
        }
      } else {
        setProfileData(profile);
      }

      // Fetch tenant membership data (role, tenant_id)
      const { data: tenantMember, error: tenantMemberError } = await supabase
        ?.from('tenant_members')
        ?.select('id, tenant_id, role, active')
        ?.eq('user_id', authUser?.id)
        ?.eq('active', true)
        ?.limit(1)
        ?.single();

      if (tenantMemberError && tenantMemberError?.code !== 'PGRST116') {
        const isNetworkError = tenantMemberError?.message?.includes('Load failed') ||
                               tenantMemberError?.message?.includes('Failed to fetch') ||
                               tenantMemberError?.message?.includes('NetworkError');
        if (!isNetworkError) {
          console.error('Header: Error fetching tenant member', tenantMemberError);
        }
      } else if (tenantMember) {
        setTenantMemberData(tenantMember);

        // Fetch tenant name using tenant_id
        const { data: tenant, error: tenantError } = await supabase
          ?.from('tenants')
          ?.select('id, name')
          ?.eq('id', tenantMember?.tenant_id)
          ?.single();

        if (tenantError) {
          console.error('Header: Error fetching tenant', tenantError);
          // Fallback to hardcoded name for M/Y BELONGERS if tenants table doesn't exist or query fails
          setTenantName('M/Y BELONGERS');
        } else {
          setTenantName(tenant?.name || 'M/Y BELONGERS');
        }
      }

      setIsLoadingData(false);
    } catch (err) {
      console.error('Header: Error in fetchUserData', err);
      setIsLoadingData(false);
    }
  };

  // Update unread count
  useEffect(() => {
    if (currentUser?.id) {
      const count = getUnreadCount(currentUser?.id);
      setUnreadCount(count);
    }
  }, [currentUser, notificationsOpen]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef?.current && !menuRef?.current?.contains(event?.target)) {
        setUserMenuOpen(false);
      }
      if (alertRef?.current && !alertRef?.current?.contains(event?.target)) {
        setAlertsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      console.log('[NAV] Logging out');
      await supabase?.auth?.signOut();
      clearCurrentUser();
      // Navigate to login page after logout
      navigate('/login-authentication');
    } catch (err) {
      console.error('Header: Logout error', err);
      clearCurrentUser();
      // Navigate on error as fallback
      navigate('/login-authentication');
    }
  };

  // Clean navigation handler with debug logging
  const handleNavigation = (path, label) => {
    console.log(`Avatar nav -> ${path}`);
    setLastNavPath(path);
    setUserMenuOpen(false);
    navigate(path);
  };

  const handleMyProfileClick = () => {
    setUserMenuOpen(false);
    navigate('/my-profile');
  };

  // Normalize role to uppercase for consistent comparison
  // Use real data from tenantMemberData if available, fallback to sessionStorage
  const rawRole = tenantMemberData?.role || tenantMemberRole;
  const role = rawRole ? rawRole?.toUpperCase() : null;
  
  console.log('[HEADER] Role normalization:', {
    raw: rawRole,
    normalized: role
  });
  
  // Determine role-based permissions using normalized uppercase role
  // CRITICAL: All role constants are UPPERCASE
  const isCommandRole = role === 'COMMAND';
  const isChiefRole = role === 'CHIEF';
  const isCrewRole = role === 'CREW';
  const isHODRole = role === 'HOD';
  const isCommandOrChief = isCommandRole || isChiefRole;
  
  // For backward compatibility with other parts of the app that still use currentUser
  const isCommand = currentUser && hasCommandAccess(currentUser);
  const isChief = currentUser && currentUser?.isChief;
  
  // Check if user can access Guest Management (COMMAND, CHIEF, HOD)
  const canAccessGuests = canAccessGuestManagement(currentUser);
  const canAccessTripsMenu = canAccessTrips(currentUser);

  // Display values - prefer real data from Supabase
  const displayFullName = profileData?.full_name || currentUser?.full_name || '';
  const displayEmail = profileData?.email || currentUser?.email || '';
  const displayTenantName = tenantName || 'M/Y BELONGERS';
  const displayRole = role || 'CREW'; // Fallback to CREW if no role found
  
  return (
    <>
      {isDevMode() && (
        <div className="bg-yellow-500 text-black px-4 py-2 flex items-center gap-2 text-sm font-medium">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>DEV MODE: Auth bypass enabled</span>
        </div>
      )}
      <header className="nav-header">
        {/* LEFT ZONE: Logo + Brand */}
        <div 
          className="flex items-center gap-3 flex-shrink-0 cursor-pointer hover:opacity-80 transition-smooth"
          onClick={() => navigate('/dashboard')}
        >
          <Image
            src={theme === 'night' 
              ? "/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg" : "/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg"
            }
            alt="Company Logo"
            className="h-8 w-auto object-contain"
          />
          <div className="text-muted-foreground text-xl">|</div>
          <span className="text-lg font-semibold text-foreground font-branding">Cargo</span>
        </div>
        {/* CENTRE ZONE: Search Bar */}
        <div className="flex-1 flex justify-center px-8">
          <div className="relative w-full max-w-md">
            <Icon
              name="Search"
              size={18}
              color="var(--color-muted-foreground)"
              className="absolute left-3 top-1/2 -translate-y-1/2"
            />
            <input
              type="text"
              placeholder="Search..."
              className="w-full pl-10 pr-4 py-2 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
        {/* RIGHT ZONE: Icons + User */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <button 
            onClick={() => navigate('/activity')}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
            title="Activity Feed"
          >
            <Icon name="Activity" size={20} className="text-muted-foreground" />
          </button>
          
          <button 
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            className="relative p-2 hover:bg-muted rounded-lg transition-smooth"
            title="Notifications"
          >
            <Icon name="Bell" size={20} color="var(--color-foreground)" />
            {unreadCount > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] bg-error text-white text-xs font-semibold rounded-full flex items-center justify-center px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          <button 
            onClick={() => navigate('/settings/vessel')}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
            title="Vessel Settings"
          >
            <Icon name="Ship" size={20} color="var(--color-foreground)" />
          </button>

          <button 
            onClick={() => setSettingsOpen(true)}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
            title="System Settings"
          >
            <Icon name="Settings" size={20} color="var(--color-foreground)" />
          </button>

          <button
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'night' ? 'day' : 'night'} mode`}
            title="Theme Toggle"
          >
            <Icon
              name={theme === 'night' ? 'Moon' : 'Sun'}
              size={20}
              color="var(--color-foreground)"
            />
          </button>

          <div className="w-px h-6 bg-border mx-1" />

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-sm">
                {displayFullName?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <Icon name="ChevronDown" size={16} color="var(--color-foreground)" />
            </button>
            
            {/* Debug label - only in dev mode */}
            {isDevMode() && lastNavPath && (
              <div className="absolute top-full mt-1 right-0 text-xs text-muted-foreground bg-muted px-2 py-1 rounded border border-border whitespace-nowrap">
                Last nav: {lastNavPath}
              </div>
            )}

            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50" style={{ pointerEvents: 'auto' }}>
                {/* Header with full_name, tenant name, and role */}
                <div className="px-4 py-3 bg-muted/30 border-b border-border">
                  <p className="text-base font-semibold text-foreground mb-1">
                    {displayFullName}
                  </p>
                  <p className="text-xs font-medium text-primary uppercase tracking-wide mb-1">
                    {displayTenantName}
                  </p>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    {displayRole}
                  </p>
                </div>

                {/* Menu items - role-aware based on tenant_members.role */}
                <div className="py-2">
                  {/* My Profile - shown to all roles */}
                  <button
                    type="button"
                    onClick={() => handleNavigation(`/profile/${session?.user?.id}`, 'My Profile')}
                    className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-smooth flex items-center gap-3"
                  >
                    <Icon name="User" size={16} />
                    My Profile
                  </button>

                  {/* Crew Management - for COMMAND and CHIEF only */}
                  {(isCommandRole || isChiefRole) && (
                    <button
                      type="button"
                      onClick={() => handleNavigation('/crew-management', 'Crew Management')}
                      className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-smooth flex items-center gap-3"
                    >
                      <Icon name="Users" size={16} />
                      Crew Management
                    </button>
                  )}

                  {/* Guest Management - ONLY for COMMAND */}
                  {isCommandRole && (
                    <button
                      type="button"
                      onClick={() => handleNavigation('/guest-management-dashboard', 'Guest Management')}
                      className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-smooth flex items-center gap-3"
                    >
                      <Icon name="UserCheck" size={16} />
                      Guest Management
                    </button>
                  )}

                  {/* Trips - for COMMAND, CHIEF, and HOD */}
                  {(isCommandRole || isChiefRole || isHODRole) && (
                    <button
                      type="button"
                      onClick={() => handleNavigation('/trips-management-dashboard', 'Trips')}
                      className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-smooth flex items-center gap-3"
                    >
                      <Icon name="Calendar" size={16} />
                      Trips
                    </button>
                  )}

                  {/* Preferences - for COMMAND, CHIEF, and HOD */}
                  {(isCommandRole || isChiefRole || isHODRole) && (
                    <button
                      type="button"
                      onClick={() => handleNavigation('/preferences', 'Preferences')}
                      className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-smooth flex items-center gap-3"
                    >
                      <Icon name="Heart" size={16} />
                      Preferences
                    </button>
                  )}

                  <div className="my-2 border-t border-border" />

                  {/* Logout - shown to all roles with red styling */}
                  <button
                    type="button"
                    onClick={() => {
                      console.log('[NAV] Logging out');
                      handleLogout();
                      setUserMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-error hover:bg-muted transition-smooth flex items-center gap-3"
                  >
                    <Icon name="LogOut" size={16} className="text-error" />
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
      {/* Notifications Drawer */}
      <NotificationsDrawer 
        isOpen={notificationsOpen} 
        onClose={() => setNotificationsOpen(false)} 
      />
      {/* Accept Admin Banner */}
      <AcceptAdminBanner 
        onAccept={() => {}}
        onRefresh={() => {}}
      />
      {/* Settings Modal */}
      <SettingsModal 
        isOpen={settingsOpen} 
        onClose={() => setSettingsOpen(false)} 
      />
    </>
  );
};

export default Header;
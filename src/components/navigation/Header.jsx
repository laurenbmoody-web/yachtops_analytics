import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../AppIcon';
import VoiceSearchButton, { cleanVoiceQuery } from '../VoiceSearchButton';
import { searchInventoryLocations } from '../../utils/inventoryLocate';
import Image from '../AppImage';
import LogoSpinner from '../LogoSpinner';
import AcceptAdminBanner from './AcceptAdminBanner';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { useBasket } from '../../contexts/BasketContext';
import { supabase } from '../../lib/supabaseClient';
import { useInboxCount } from '../../hooks/useInboxCount';
import { getCurrentUser, clearCurrentUser, hasCommandAccess, loadUsers } from '../../utils/authStorage';
import { getInitials } from '../../utils/profileHelpers';
import { amIPlatformAdmin } from '../../pages/cargo-console/utils';
import { canAccessGuestManagement } from '../../pages/guest-management-dashboard/utils/guestPermissions';
import { canAccessTrips } from '../../pages/trips-management-dashboard/utils/tripPermissions';
import AlertsDrawer from './AlertsDrawer';
import VesselSwitcher from './VesselSwitcher';
import './header-search.css';
import { getUnreadCount, checkDueAndOverdueJobs } from '../../pages/team-jobs-management/utils/notifications';
import { fetchDbUnreadCount } from '../../lib/dbNotifications';
import { isDevMode } from '../../utils/devMode';
import { loadCards } from '../../pages/team-jobs-management/utils/cardStorage';
import { loadGuests } from '../../pages/guest-management-dashboard/utils/guestStorage';
import { loadTrips } from '../../pages/trips-management-dashboard/utils/tripStorage';


// ── Avatar-menu styling helpers ────────────────────────────────────────────
// Cargo editorial language (see CLAUDE.md): navy ink #1C1B3A, terracotta accent
// #C65A1A, warm hairlines/soft fields, cool-slate (#F8FAFC) header block to match
// the app ground. The item matching the current route is highlighted with the
// terracotta-tinted background + terracotta text only — no left bar, no added
// font weight. Token hexes are inlined because the editorial CSS vars aren't
// available on this surface.
const hexToRgba = (hex, alpha) => {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return `rgba(100,116,139,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const AvatarMenuSectionLabel = ({ label }) => (
  <div style={{
    padding: '6px 16px 3px', fontFamily: 'Outfit', fontWeight: 700,
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8B8478',
  }}>{label}</div>
);

const AvatarMenuDivider = () => (
  <div style={{ borderTop: '1px solid #F0F1F5', margin: '4px 0' }} />
);

const AvatarMenuItem = ({ icon, label, onClick, danger, active }) => {
  // Active (current-route) row: tinted terracotta background + terracotta text
  // only — deliberately no left bar and no extra font weight.
  const baseColor = danger ? '#DC2626' : active ? '#C65A1A' : '#1C1B3A';
  const iconColor = danger ? '#DC2626' : active ? '#C65A1A' : '#8B8478';
  const baseBg = active ? '#FBEFE9' : 'transparent';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 16px',
        background: baseBg, border: 'none', textAlign: 'left', cursor: 'pointer',
        fontSize: 13, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        color: baseColor, transition: 'background 100ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = active ? '#FBEFE9' : '#F6F5F2'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = baseBg; }}
    >
      <Icon name={icon} size={15} color={iconColor} />
      <span>{label}</span>
    </button>
  );
};

// Row used inside the consolidated header dropdowns (Alerts, Settings). Same
// editorial language as AvatarMenuItem, plus an optional terracotta count pill
// on the right for feeds that carry a pending count (reviews, notifications).
const Header = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user: authUser, session, hasAccountsAccess, hasOwnerReporting } = useAuth();
  const { noVesselAccess } = useTenant();
  // Between vessels: strip vessel-only chrome (inbox, admin menu) down to the
  // personal essentials — the only pages reachable are profile & settings.
  const unberthed = noVesselAccess === true;
  const [currentUser, setCurrentUser] = useState(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  // Collapse the mobile search bar whenever the route changes (e.g. after
  // picking a search result), so it doesn't linger over the new page.
  useEffect(() => { setMobileSearchOpen(false); }, [location.pathname]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertsTab, setAlertsTab] = useState('notifications');
  const [unreadCount, setUnreadCount] = useState(0);
  // Live count of pending review_items routed to the current user via
  // Phase 1 RLS. Polled at 30s; rendered as the inbox icon's badge.
  const inboxCount = useInboxCount();
  const { basketUnits } = useBasket();
  const [tenantMemberRole, setTenantMemberRole] = useState(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false); // Cargo reviewer — sees the internal Certificates link
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const menuRef = useRef(null);
  const userPopRef = useRef(null); // the portaled user dropdown (lives on <body>)
  const searchRef = useRef(null);
  const searchTimeout = useRef(null);

  // Is this user a Cargo reviewer? Gates the internal Certificates link.
  useEffect(() => {
    let live = true;
    if (!session) { setIsPlatformAdmin(false); return; }
    amIPlatformAdmin().then(ok => { if (live) setIsPlatformAdmin(ok); });
    return () => { live = false; };
  }, [session]);

  // New state for real data from Supabase
  const [profileData, setProfileData] = useState(null);
  const [tenantMemberData, setTenantMemberData] = useState(null);
  const [tenantName, setTenantName] = useState(null);
  const [deptColor, setDeptColor] = useState(null);
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
        ?.select('id, full_name, email, avatar_url')
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

      // Fetch tenant membership data (role, tenant_id, department_id)
      const { data: tenantMember, error: tenantMemberError } = await supabase
        ?.from('tenant_members')
        ?.select('id, tenant_id, permission_tier, role, active, department_id')
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

        // Resolve the member's department colour straight from the authoritative
        // department_id (not the localStorage name) so the avatar-menu role pill
        // is tinted to their department. Falls back to neutral grey when unset.
        if (tenantMember?.department_id) {
          const { data: dept } = await supabase
            ?.from('departments')
            ?.select('color')
            ?.eq('id', tenantMember?.department_id)
            ?.single();
          setDeptColor(dept?.color || null);
        } else {
          setDeptColor(null);
        }
      }

      setIsLoadingData(false);
    } catch (err) {
      console.error('Header: Error in fetchUserData', err);
      setIsLoadingData(false);
    }
  };

  // Update unread count — use Supabase auth UUID (authUser?.id) so it matches
  // the userId stored in notifications by sendNotification (which uses board.created_by,
  // also a Supabase UUID). currentUser?.id is a legacy localStorage ID that won't match.
  // Sums the legacy localStorage feed + the server-backed DB feed (rota
  // decisions, cross-device); polls on the same cadence as notification opens.
  useEffect(() => {
    if (!authUser?.id) return undefined;
    let cancelled = false;
    const refresh = async () => {
      const local = getUnreadCount(authUser?.id) || 0;
      const db = await fetchDbUnreadCount(authUser?.id);
      if (!cancelled) setUnreadCount(local + db);
    };
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [authUser, alertsOpen]);

  // Realtime: new notification rows for this user should bump the
  // badge immediately, not on the next 30s poll tick. INSERT fires the
  // "new row" event; the same listener also catches UPDATE so the
  // count drops the moment another tab marks something read.
  useEffect(() => {
    if (!authUser?.id) return undefined;
    const ch = supabase
      .channel(`notifications-badge-${authUser.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${authUser.id}` },
        async () => {
          const local = getUnreadCount(authUser.id) || 0;
          const db = await fetchDbUnreadCount(authUser.id);
          setUnreadCount(local + db);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [authUser?.id]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // The dropdown is portaled onto <body> (so it can sit above full-screen
      // overlays like the vessel map), so it's outside menuRef — check it too,
      // or clicking a menu item would close the menu before the click lands.
      if (
        menuRef?.current && !menuRef?.current?.contains(event?.target) &&
        (!userPopRef?.current || !userPopRef?.current?.contains(event?.target))
      ) {
        setUserMenuOpen(false);
      }
      if (searchRef?.current && !searchRef?.current?.contains(event?.target)) {
        setIsSearchOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const NAV_PAGES = [
    { label: 'Dashboard', path: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'Inventory', path: '/inventory', icon: 'Package' },
    { label: 'Laundry', path: '/laundry-management-dashboard', icon: 'Shirt' },
    { label: 'Trips', path: '/trips-management-dashboard', icon: 'Map' },
    { label: 'Provisioning', path: '/provisioning', icon: 'ShoppingBag' },
    { label: 'Guests', path: '/guest-management-dashboard', icon: 'Users' },
    { label: 'Crew', path: '/crew-management', icon: 'Users' },
    { label: 'Rota', path: '/crew', icon: 'CalendarClock' },
    { label: 'Jobs', path: '/team-jobs-management', icon: 'CheckSquare' },
    { label: 'Defects', path: '/defects', icon: 'AlertTriangle' },
    { label: 'Calendar', path: '/ops-vessel-calendar', icon: 'Calendar' },
    { label: 'Accounts', path: '/accounts', icon: 'DollarSign' },
    { label: 'Activity', path: '/activity', icon: 'Activity' },
    { label: 'Vessel Documents', path: '/vessel-documents', icon: 'FolderArchive' },
    { label: 'Settings', path: '/settings/vessel', icon: 'Settings' },
  ];

  const performSearch = useCallback(async (query) => {
    // Strip "show me / where is / find …" so a spoken or typed request locates
    // the thing itself (e.g. "show me champagne" → "champagne").
    const q = (cleanVoiceQuery(query) || query).toLowerCase().trim();
    if (!q) { setSearchResults([]); setIsSearching(false); return; }

    setIsSearching(true);
    const groups = [];

    // ── Sync / localStorage ──────────────────────────────────────────────────

    // Pages (static)
    const pages = NAV_PAGES.filter(p => p.label.toLowerCase().includes(q)).slice(0, 4);
    if (pages.length) groups.push({ category: 'Pages', items: pages });

    // Defects (localStorage)
    try {
      const defects = (JSON.parse(localStorage.getItem('cargo_defects_v1') || '[]'))
        .filter(d => (d?.title || '').toLowerCase().includes(q) || (d?.description || '').toLowerCase().includes(q))
        .slice(0, 3)
        .map(d => ({ label: d.title || 'Untitled defect', subtitle: d.status || '', path: '/defects', icon: 'AlertTriangle' }));
      if (defects.length) groups.push({ category: 'Defects', items: defects });
    } catch { /* skip */ }

    // Trips moved to the async Supabase wave below — loadTrips is now
    // async post-A3.1 (Supabase + localStorage merge). The category
    // appears in the search results as soon as the await resolves.

    // Laundry (localStorage)
    try {
      const laundry = (JSON.parse(localStorage.getItem('cargo_laundry_v1') || '[]'))
        .filter(l => (l?.description || '').toLowerCase().includes(q) || (l?.ownerName || '').toLowerCase().includes(q))
        .slice(0, 3)
        .map(l => ({ label: l.description || 'Laundry item', subtitle: l.ownerName || '', path: '/laundry-management-dashboard', icon: 'Shirt' }));
      if (laundry.length) groups.push({ category: 'Laundry', items: laundry });
    } catch { /* skip */ }

    // Show sync results immediately (keep the spinner until the async wave lands
    // so an empty sync set doesn't flash "No results" while inventory loads).
    setSearchResults([...groups]);

    // ── Supabase (parallel, appended as they arrive) ─────────────────────────
    const tenantId = localStorage.getItem('cargo_active_tenant_id');
    if (!tenantId) { setIsSearching(false); return; }

    const TIMEOUT = 5000;
    const race = (promise) => Promise.race([promise, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), TIMEOUT))]);

    const [crewRes, jobsRes, inventoryRes, guestsRes, tripsRes, locateRes] = await Promise.allSettled([
      // Crew — profiles scoped to this tenant via tenant_members
      race(
        supabase
          ?.from('profiles')
          ?.select('id, full_name, email, tenant_members!inner(role)')
          ?.eq('tenant_members.tenant_id', tenantId)
          ?.eq('tenant_members.active', true)
          ?.ilike('full_name', `%${q}%`)
          ?.limit(5)
      ),
      // Jobs
      race(
        supabase
          ?.from('team_jobs')
          ?.select('id, title, status')
          ?.eq('tenant_id', tenantId)
          ?.ilike('title', `%${q}%`)
          ?.limit(5)
      ),
      // Inventory items
      race(
        supabase
          ?.from('inventory_items')
          ?.select('id, name, location, sub_location, l1_name, l2_name, l3_name')
          ?.eq('tenant_id', tenantId)
          ?.ilike('name', `%${q}%`)
          ?.limit(5)
      ),
      // Guests
      race(loadGuests()),
      // Trips — loadTrips is async post-A3.1 (Supabase + LS merge)
      race(loadTrips()),
      // Where each matching item's stock physically lives (for "View on map")
      race(searchInventoryLocations(q)),
    ]);

    // itemId → best map target: prefer a scanned room (opens the 3D scan),
    // else a room placed on a deck plan (opens the plan).
    // Prefer the deck plan (locates + pulses the room) over jumping straight
    // into the 3D scan — from the plan the user can click into the scan.
    const mapById = {};
    if (locateRes?.status === 'fulfilled') {
      (locateRes.value || []).forEach((it) => {
        const placedIds = it.rooms.filter((r) => r.placed).map((r) => r.roomId);
        const scanned = it.rooms.find((r) => r.scanId);
        if (it.pin?.placed && it.pin.roomId) {
          // Pinned + on a plan: spotlight every room it lives in (the pinned one
          // first), carrying the pin so clicking through opens the scan with it.
          const ids = [it.pin.roomId, ...placedIds.filter((id) => id !== it.pin.roomId)];
          mapById[it.itemId] = { path: `/settings/vessel?section=location-management&locate=${ids.join(',')}&scan=${it.pin.scanId}&pin=${it.pin.hotspotId}`, room: it.pin.roomName };
        } else if (it.pin) {
          // Pinned but the room isn't on a plan — open the pin in the scan.
          mapById[it.itemId] = { path: `/vessel/map?scan=${it.pin.scanId}&pin=${it.pin.hotspotId}`, room: it.pin.roomName };
        } else if (placedIds.length) {
          // Spotlight every placed room the stock sits in.
          mapById[it.itemId] = { path: `/settings/vessel?section=location-management&locate=${placedIds.join(',')}`, room: it.rooms.find((r) => r.placed)?.roomName };
        } else if (scanned) {
          mapById[it.itemId] = { path: `/vessel/map?scan=${scanned.scanId}`, room: scanned.roomName };
        }
      });
    }

    setSearchResults(prev => {
      const updated = [...prev];
      const upsert = (category, items) => {
        if (!items?.length) return;
        const idx = updated.findIndex(g => g.category === category);
        if (idx >= 0) updated[idx] = { category, items };
        else updated.push({ category, items });
      };

      if (crewRes.status === 'fulfilled') {
        const items = (crewRes.value?.data || []).map(u => ({
          label: u.full_name || u.email || 'Crew member',
          subtitle: u.tenant_members?.[0]?.role || '',
          path: `/profile/${u.id}`,
          icon: 'User',
        }));
        upsert('Crew', items);
      }

      if (jobsRes.status === 'fulfilled') {
        const items = (jobsRes.value?.data || []).map(j => ({
          label: j.title || 'Untitled job',
          subtitle: j.status || '',
          path: '/team-jobs-management',
          icon: 'CheckSquare',
        }));
        upsert('Jobs', items);
      }

      if (inventoryRes.status === 'fulfilled') {
        const encSeg = (s) => encodeURIComponent(s?.replace(/\//g, '__FWDSLASH__'));
        const items = (inventoryRes.value?.data || []).map(item => {
          const segments = [
            item.location,
            ...(item.sub_location ? item.sub_location.split(' > ') : []),
          ].filter(Boolean);
          const path = segments.length > 0
            ? '/inventory/location/' + segments.map(encSeg).join('/')
            : '/inventory';
          const subtitle = segments.join(' › ') || [item.l1_name, item.l2_name, item.l3_name].filter(Boolean).join(' › ');
          const loc = mapById[item.id];
          return { label: item.name, subtitle, path, icon: 'Package', mapPath: loc?.path || null, mapRoom: loc?.room || null };
        });
        upsert('Inventory', items);
      }

      if (guestsRes.status === 'fulfilled') {
        const items = (guestsRes.value || [])
          .filter(g => `${g?.firstName || ''} ${g?.lastName || ''}`.toLowerCase().includes(q))
          .slice(0, 5)
          .map(g => ({
            label: `${g?.firstName || ''} ${g?.lastName || ''}`.trim() || 'Guest',
            subtitle: g?.guestType || 'Guest',
            path: '/guest-management-dashboard',
            icon: 'UserCheck',
          }));
        upsert('Guests', items);
      }

      if (tripsRes.status === 'fulfilled') {
        const items = (tripsRes.value || [])
          .filter(t => (t?.name || t?.title || '').toLowerCase().includes(q))
          .slice(0, 3)
          .map(t => ({
            label: t.name || t.title || 'Untitled trip',
            subtitle: t.status || '',
            path: '/trips-management-dashboard',
            icon: 'Map',
          }));
        upsert('Trips', items);
      }

      return updated;
    });
    setIsSearching(false);
  }, []);

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchQuery(value);
    setIsSearchOpen(true);
    clearTimeout(searchTimeout.current);
    if (!value.trim()) { setSearchResults([]); setIsSearching(false); return; }
    setIsSearching(true);
    searchTimeout.current = setTimeout(() => performSearch(value), 300);
  };

  const handleSearchSelect = (path) => {
    navigate(path);
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleSearchClear = () => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearchOpen(false);
  };

  const handleLogout = async () => {
    console.log('[NAV] Logging out');
    // Clear the local user up front so nothing depends on the network call.
    clearCurrentUser();
    try {
      // scope:'local' signs out THIS device only (leaves other devices — e.g. a
      // phone — logged in) and skips the server-side revoke that can hang and
      // block logout. Race a timeout so a slow/failed call never stalls the UI.
      await Promise.race([
        supabase?.auth?.signOut({ scope: 'local' }),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } catch (err) {
      console.error('Header: Logout error', err);
    }
    // Hard redirect so all in-memory auth/tenant state is torn down and the app
    // re-initialises against the cleared session (a React-Router navigate alone
    // can be bounced back by a still-warm auth context).
    window.location.assign('/login-authentication');
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
  const rawRole = tenantMemberData?.permission_tier || tenantMemberData?.role || tenantMemberRole;
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
  // Accounts: COMMAND always; CHIEF only with the per-member toggle on; CREW never.
  const accountsAccess = typeof hasAccountsAccess === 'function' ? hasAccountsAccess() : isCommandRole;
  const ownerReporting = typeof hasOwnerReporting === 'function' ? hasOwnerReporting() : accountsAccess;

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
        {/* LEFT ZONE: Logo + the vessel you're on */}
        <div className="flex items-center gap-3 flex-shrink-0 nav-brand">
          {/* Full "cargo" wordmark on desktop. On phones its embedded raster
              blurs when shrunk (and it crowds out the vessel name), so show the
              compact square mark instead. */}
          <Image
            src="/centered-logo.svg"
            alt="Cargo"
            className="h-8 w-auto object-contain cursor-pointer hover:opacity-80 transition-smooth hidden sm:block"
            onClick={() => navigate('/dashboard')}
          />
          <Image
            src="/cargo-mark.png"
            alt="Cargo"
            className="h-7 w-auto object-contain cursor-pointer hover:opacity-80 transition-smooth sm:hidden nav-logo-mark"
            onClick={() => navigate('/dashboard')}
          />
          {/* The divider has always implied a vessel name after it. A login with
              more than one boat — a management company, or crew covering a
              sister ship — can change vessel from here instead of signing out. */}
          {!unberthed && (
            <>
              <div className="text-muted-foreground text-xl">|</div>
              <VesselSwitcher />
            </>
          )}
        </div>
        {/* CENTRE ZONE: Search Bar — vessel-scoped, so hidden between vessels.
            The wrapper stays a flex-1 spacer (keeps the right-zone controls
            pushed right); `nav-search` hides just the input on phones so the
            bell/avatar don't get shoved off-screen. */}
        <div className={`flex-1 flex justify-center px-8 nav-search-wrap${mobileSearchOpen ? ' open' : ''}`}>
          {!unberthed && (
          <div className="relative w-full max-w-md nav-search" ref={searchRef}>
            <Icon
              name="Search"
              size={18}
              className="hsearch-ic"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              onFocus={() => { if (searchQuery.trim()) setIsSearchOpen(true); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { handleSearchClear(); return; }
                if (e.key === 'Enter' && searchQuery.trim()) {
                  clearTimeout(searchTimeout.current);
                  setIsSearchOpen(true);
                  setIsSearching(true);
                  performSearch(searchQuery);
                }
              }}
              placeholder="Search pages, crew, jobs, guests..."
              className="hsearch-input"
            />
            {searchQuery && (
              <button
                onClick={handleSearchClear}
                className="hsearch-clear"
                aria-label="Clear search"
              >
                <Icon name="X" size={14} />
              </button>
            )}
            <VoiceSearchButton
              className="hsearch-mic"
              size={17}
              onResult={(t) => handleSearchChange({ target: { value: t } })}
              title="Say what you're looking for"
            />

            {/* Results dropdown */}
            {isSearchOpen && searchQuery.trim() && (
              <div className="hsearch-pop" onMouseDown={e => e.preventDefault()}>
                {isSearching && searchResults.length === 0 ? (
                  <div className="hsearch-msg">
                    <LogoSpinner size={14} />
                    Searching...
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="hsearch-msg">
                    No results for &ldquo;{searchQuery}&rdquo;
                  </div>
                ) : (
                  searchResults.map((group) => (
                    <div key={group.category}>
                      <div className="hsearch-group-h">
                        {group.category}
                      </div>
                      {group.items.map((item, i) => (
                        <div key={i} className="hsearch-itemrow">
                          <button
                            onClick={() => handleSearchSelect(item.path)}
                            className="hsearch-item"
                          >
                            <Icon name={item.icon} size={15} className="hsearch-ico" />
                            <div className="hsearch-body">
                              <p className="hsearch-label">{item.label}</p>
                              {item.subtitle && (
                                <p className="hsearch-sub">{item.subtitle}</p>
                              )}
                            </div>
                            {!item.mapPath && <Icon name="ChevronRight" size={14} className="hsearch-chev" />}
                          </button>
                          {item.mapPath && (
                            <button
                              className="hsearch-map"
                              onClick={() => handleSearchSelect(item.mapPath)}
                              title={item.mapRoom ? `View on map · ${item.mapRoom}` : 'View on map'}
                            >
                              <Icon name="MapPin" size={13} /> Map
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          )}
        </div>
        {/* RIGHT ZONE: Icons + User */}
        <div className="flex items-center gap-3 flex-shrink-0 nav-right">
          {/* Mobile-only search toggle — the inline centre search is hidden on
              phones (it would shove these controls off-screen), so this reveals
              it as a full-width bar under the header. */}
          {!unberthed && (
            <button
              onClick={() => setMobileSearchOpen((o) => !o)}
              className="sm:hidden p-2 hover:bg-muted rounded-lg transition-smooth"
              title="Search"
              aria-label="Search"
              aria-expanded={mobileSearchOpen}
            >
              <Icon name={mobileSearchOpen ? 'X' : 'Search'} size={20} color="var(--color-foreground)" />
            </button>
          )}
          {/* Alerts — a single Bell icon opening the unified Inbox drawer
              (Notifications · Reviews · Activity). The badge sums the pending
              Reviews + Notification counts. */}
          {!unberthed && (() => {
            const alertCount = inboxCount + unreadCount;
            return (
              <button
                onClick={() => { setAlertsTab('notifications'); setAlertsOpen(true); }}
                className="relative p-2 hover:bg-muted rounded-lg transition-smooth"
                title="Inbox — notifications, reviews & activity"
                aria-label={alertCount > 0 ? `Inbox — ${alertCount} pending` : 'Inbox'}
              >
                <Icon name="Bell" size={20} color="var(--color-foreground)" />
                {alertCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] text-white text-xs font-semibold rounded-full flex items-center justify-center px-1" style={{ background: '#C65A1A' }}>
                    {alertCount > 99 ? '99+' : alertCount}
                  </span>
                )}
              </button>
            );
          })()}

          {basketUnits > 0 && (
            <button
              onClick={() => navigate('/provisioning/marketplace?counter=1')}
              className="relative p-2 hover:bg-muted rounded-lg transition-smooth"
              title={`The Counter — ${basketUnits} item${basketUnits === 1 ? '' : 's'} to add to a board`}
              aria-label={`The Counter — ${basketUnits} item${basketUnits === 1 ? '' : 's'}`}
            >
              <Icon name="ClipboardList" size={20} color="var(--color-foreground)" />
              <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] text-white text-xs font-semibold rounded-full flex items-center justify-center px-1" style={{ background: '#C65A1A' }}>
                {basketUnits > 99 ? '99+' : basketUnits}
              </span>
            </button>
          )}

          {/* Settings — single gear to the unified settings home (/settings),
              which hosts personal ("You") sections and, for command/chief, the
              vessel admin sections. */}
          <button
            onClick={() => navigate('/settings')}
            className="hidden sm:block p-2 hover:bg-muted rounded-lg transition-smooth"
            title="Settings"
            aria-label="Settings"
          >
            <Icon name="Settings" size={20} color="var(--color-foreground)" />
          </button>

          <div className="hidden sm:block w-px h-6 bg-border mx-1" />

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-sm overflow-hidden">
                {profileData?.avatar_url ? (
                  <img src={profileData?.avatar_url} alt={displayFullName || 'Profile'} className="w-full h-full object-cover" />
                ) : (
                  getInitials(displayFullName) || 'U'
                )}
              </div>
              <Icon name="ChevronDown" size={16} color="var(--color-foreground)" className="hidden sm:block" />
            </button>
            
            {/* Debug label - only in dev mode */}
            {isDevMode() && lastNavPath && (
              <div className="absolute top-full mt-1 right-0 text-xs text-muted-foreground bg-muted px-2 py-1 rounded border border-border whitespace-nowrap">
                Last nav: {lastNavPath}
              </div>
            )}

            {userMenuOpen && createPortal(
              <div ref={userPopRef} style={{
                position: 'fixed',
                top: (menuRef.current?.getBoundingClientRect().bottom ?? 64) + 8,
                right: Math.max(8, window.innerWidth - (menuRef.current?.getBoundingClientRect().right ?? window.innerWidth)),
                width: 320, background: '#FFFFFF', border: '1px solid #ECEAE3',
                borderRadius: 14, boxShadow: '0 24px 60px -16px rgba(28,27,58,0.32)',
                zIndex: 2000, overflow: 'hidden', pointerEvents: 'auto',
              }}>
                {/* Header block — avatar, name, email, workspace + department-tinted role pill */}
                <div style={{ padding: 16, background: '#F8FAFC', borderBottom: '1px solid #ECEAE3' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%', background: '#1C1B3A', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'Outfit', fontWeight: 700, fontSize: 15, flexShrink: 0, overflow: 'hidden',
                    }}>
                      {profileData?.avatar_url ? (
                        <img src={profileData?.avatar_url} alt={displayFullName || 'Profile'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        getInitials(displayFullName) || 'U'
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: 'Outfit', fontWeight: 700, fontSize: 14, color: '#1C1B3A', lineHeight: 1.2 }}>
                        {displayFullName}
                      </div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayEmail}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontFamily: 'Outfit', fontWeight: 700, fontSize: 10.5,
                      letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8B8478',
                    }}>{displayTenantName}</span>
                    <span style={{
                      fontFamily: 'Outfit', fontWeight: 700, fontSize: 10,
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                      padding: '2px 7px', borderRadius: 999,
                      background: hexToRgba(deptColor, 0.12),
                      color: deptColor || '#475569',
                    }}>{displayRole}</span>
                  </div>
                </div>

                {/* Menu items — role-aware based on tenant_members.role.
                    Section labels render only when ≥1 item under them is visible. */}
                <div style={{ padding: '4px 0' }}>
                  {(() => {
                    // The row whose target route matches the current location is
                    // highlighted. My Profile matches any /profile/* or /my-profile path.
                    const path = location?.pathname || '';
                    const isActive = (base) => base === '/my-profile'
                      ? (path.startsWith('/profile') || path === '/my-profile')
                      : path === base || path.startsWith(`${base}/`);
                    const sections = [
                      {
                        label: 'Personal',
                        items: [
                          { show: true, icon: 'User', label: 'My Profile', path: '/my-profile', onClick: () => handleNavigation(`/profile/${session?.user?.id}`, 'My Profile') },
                          { show: isCommandRole || isChiefRole || isHODRole, icon: 'Wallet', label: 'My money', path: '/accounts/my', onClick: () => handleNavigation('/accounts/my', 'My money') },
                          { show: true, icon: 'Settings', label: 'Settings', path: '/settings', onClick: () => handleNavigation('/settings', 'Settings') },
                        ],
                      },
                      {
                        label: 'Administration',
                        items: [
                          { show: isCommandRole || isChiefRole, icon: 'Users', label: 'Crew Management', path: '/crew-management', onClick: () => handleNavigation('/crew-management', 'Crew Management') },
                          { show: isCommandRole || isChiefRole, icon: 'CalendarCheck', label: 'Month-end', path: '/month-end', onClick: () => handleNavigation('/month-end', 'Month-end') },
                          // Single entry into the Accounts workspace — its own nav
                          // covers Overview, Cards, Check-off, Spending, Plan and the
                          // Owner report, so those no longer need their own menu rows.
                          // Gated on ownerReporting so an owner/viewer seat still gets
                          // in (/accounts redirects them straight to the report).
                          { show: ownerReporting, icon: 'Wallet', label: 'Accounts', path: '/accounts', onClick: () => handleNavigation('/accounts', 'Accounts') },
                          { show: isCommandRole || isChiefRole, icon: 'FolderArchive', label: 'Vessel Documents', path: '/vessel-documents', onClick: () => handleNavigation('/vessel-documents', 'Vessel Documents') },
                        ],
                      },
                      {
                        label: 'Operations',
                        items: [
                          { show: true, icon: 'MessageSquare', label: 'Supplier Messages', path: '/messages', onClick: () => handleNavigation('/messages', 'Supplier Messages') },
                          { show: isCommandRole, icon: 'UserCheck', label: 'Guest Management', path: '/guest-management-dashboard', onClick: () => handleNavigation('/guest-management-dashboard', 'Guest Management') },
                          { show: isCommandRole || isChiefRole || isHODRole, icon: 'Calendar', label: 'Trips', path: '/trips-management-dashboard', onClick: () => handleNavigation('/trips-management-dashboard', 'Trips') },
                          { show: isCommandRole || isChiefRole || isHODRole, icon: 'Heart', label: 'Preferences', path: '/preferences', onClick: () => handleNavigation('/preferences', 'Preferences') },
                        ],
                      },
                      {
                        label: 'Cargo internal',
                        items: [
                          { show: isPlatformAdmin, icon: 'ShieldCheck', label: 'Certificates', path: '/cargo/certifications', onClick: () => handleNavigation('/cargo/certifications', 'Certificates') },
                        ],
                      },
                    ];
                    // Between vessels, only the personal section is reachable —
                    // everything else routes to a "no vessel access" screen.
                    const shownSections = unberthed ? sections.filter(s => s.label === 'Personal') : sections;
                    let rendered = 0;
                    return shownSections.map((sec) => {
                      const visible = sec.items.filter(i => i.show);
                      if (visible.length === 0) return null;
                      const node = (
                        <React.Fragment key={sec.label}>
                          {rendered > 0 && <AvatarMenuDivider />}
                          <AvatarMenuSectionLabel label={sec.label} />
                          {visible.map(i => (
                            <AvatarMenuItem key={i.label} icon={i.icon} label={i.label} onClick={i.onClick} active={isActive(i.path)} />
                          ))}
                        </React.Fragment>
                      );
                      rendered += 1;
                      return node;
                    });
                  })()}

                  <AvatarMenuDivider />

                  {/* Logout - shown to all roles */}
                  <AvatarMenuItem
                    icon="LogOut"
                    label="Logout"
                    danger
                    onClick={() => {
                      console.log('[NAV] Logging out');
                      handleLogout();
                      setUserMenuOpen(false);
                    }}
                  />
                </div>
              </div>,
              document.body
            )}
          </div>
        </div>
      </header>
      {/* Spacer — pushes page content below the fixed header (h-16 = 64px) */}
      <div className="h-16" aria-hidden="true" />
      {/* Unified Inbox drawer — Notifications · Reviews · Activity */}
      <AlertsDrawer
        isOpen={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        initialTab={alertsTab}
        reviewsCount={inboxCount}
        notificationsCount={unreadCount}
      />
      {/* Accept Admin Banner */}
      <AcceptAdminBanner 
        onAccept={() => {}}
        onRefresh={() => {}}
      />
    </>
  );
};

export default Header;
import React, { useEffect, useState, useRef } from 'react';
import { BrowserRouter, Routes as RouterRoutes, Route, Navigate } from 'react-router-dom';
import ScrollToTop from 'components/ScrollToTop';
import ErrorBoundary from 'components/ErrorBoundary';

import Dashboard from './pages/dashboard';
import TeamJobsManagement from './pages/team-jobs-management';
import Accounts from './pages/accounts';
import LogsDeliveries from './pages/logs-deliveries';
import BlueprintVesselView from './pages/blueprint-vessel-view';
import DutySetsRotationManagement from './pages/duty-sets-rotation-management';
import OpsVesselCalendar from './pages/ops-vessel-calendar';
import LoginAuthentication from './pages/login-authentication';
import CrewManagement from './pages/crew-management';
import RoleManagement from './pages/crew-management/components/RoleManagement';
import GuestManagementDashboard from './pages/guest-management-dashboard';
import InventoryCategorySettings from './pages/inventory-category-settings';
import Enhanced4LevelInventoryNavigation from './pages/enhanced-4-level-inventory-navigation';
import SmartImportWithAutoAssignmentEngine from './pages/smart-import-with-auto-assignment-engine';
import ReadFirstItemDetailView from './pages/read-first-item-detail-view-with-editing-controls';
import InventoryAnalyticsDashboard from './pages/inventory-analytics-dashboard';
import ActivityFeedManagement from './pages/activity-feed-management';
import LocationsManagementSettings from './pages/locations-management-settings';
import DefectsDashboard from './pages/defects';
import LaundryManagementDashboard from './pages/laundry-management-dashboard';
import LaundryCalendarHistoryView from './pages/laundry-calendar-history-view';
import TripsManagementDashboard from './pages/trips-management-dashboard';
import TripDetailView from './pages/trip-detail-view-with-guest-allocation';
import TripPreferencesView from './pages/trip-preferences-view';
import TripPreferencesOverview from './pages/trip-preferences-overview';
import PreferencesDirectory from './pages/preferences-directory';
import GuestPreferenceProfile from './pages/guest-preference-profile';
import CrewProfile from './pages/crew-profile';
import PublicLandingPage from './pages/public-landing-page';
import HomePage from './marketing/pages/HomePage';
import ProductPage from './marketing/pages/ProductPage';
import FeaturesPage from './marketing/pages/FeaturesPage';
import WhoItsForPage from './marketing/pages/WhoItsForPage';
import AboutPage from './marketing/pages/AboutPage';
import FAQPage from './marketing/pages/FAQPage';
import PricingPage from './marketing/pages/PricingPage';
import CheckoutPage from './marketing/pages/CheckoutPage';
import WelcomePage from './marketing/pages/WelcomePage';
import ContactPage from './marketing/pages/ContactPage';
import VesselSignupFlowStep1 from './pages/vessel-signup-flow-step-1';
import VesselSettings from './pages/vessel-settings';
import Membership from './pages/membership';
import SettingsPage from './pages/settings';
import MyProfileManagement from './pages/NotFound';

import { getCurrentUser } from './utils/authStorage';
import { isDevMode } from './utils/devMode';

import ProvisioningWorkspace from './pages/provisioning';
import ProvisioningBoardDetail from './pages/provisioning/ProvisioningBoardDetail';
import ProvisioningSuppliers from './pages/provisioning/ProvisioningSuppliers';
import DeliveryInbox from './pages/provisioning/DeliveryInbox';
import DeliveryHistory from './pages/provisioning/DeliveryHistory';
import ReturnSlipPage from './pages/provisioning/ReturnSlipPage';
import ReturnConfirmPage from './pages/provisioning/ReturnConfirmPage';
import TripItineraryTimeline from './pages/trip-itinerary-timeline/index';
import InviteAcceptPage from './pages/invite-accept';
import ForgotPasswordRequest from './pages/forgot-password-request';
import ResetPassword from './pages/reset-password';
import { supabase } from './lib/supabaseClient';
import { useAuth, RouteChangeLogger } from './contexts/AuthContext';
import TodayDetailPage from './pages/today-detail/index';
import NotFound from './pages/NotFound';

// DEV_MODE constant for debugging
const DEV_MODE = import.meta.env?.DEV;

// Dev Mode Banner Component
const DevModeBanner = () => {
  if (!isDevMode()) {
    return null;
  }
  
  return (
    <div className="bg-yellow-500 text-black px-4 py-2 flex items-center justify-between gap-4 text-sm font-medium">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span>DEV MODE: Auth bypass enabled</span>
      </div>
    </div>
  );
};

// Redirect component for old invite routes
const InviteRedirect = () => {
  const location = window.location;
  const searchParams = new URLSearchParams(location.search);
  const token = searchParams?.get('token');
  
  // Preserve all query params
  const newUrl = token 
    ? `/invite-accept?token=${token}${location?.search?.includes('&') ? '&' + location?.search?.split('&')?.slice(1)?.join('&') : ''}`
    : '/invite-accept';
  
  return <Navigate to={newUrl} replace />;
};

// Fallback route component with authentication-based redirect
const FallbackRoute = () => {
  const currentUser = getCurrentUser();
  
  if (currentUser) {
    // User is authenticated, redirect to dashboard
    return <Navigate to="/dashboard" replace />;
  }
  
  // User is not authenticated, redirect to public landing page
  return <Navigate to="/public-landing-page" replace />;
};

// Protected Route wrapper - uses AuthContext for session state
const ProtectedRoute = ({ children, requiresTenant = true, requiredRoles = null }) => {
  // Check DEV MODE flag
  if (isDevMode()) {
    console.log('[ProtectedRoute] 🔧 DEV MODE: Bypassing all auth checks');
    return (
      <>
        <DevModeBanner />
        {children}
      </>
    );
  }
  
  const {
    session,
    loading: authLoading,
    user,
    tenantLoading: contextLoading,
    bootstrapComplete,
    activeTenantId: tenant_id,
    tenantRole: role,
    retryBootstrap
  } = useAuth();

  // Auto-retry once if bootstrap completed but found no tenant (transient failure on first login)
  const hasAutoRetried = useRef(false);
  useEffect(() => {
    if (bootstrapComplete && session && !tenant_id && !hasAutoRetried.current) {
      hasAutoRetried.current = true;
      console.log('[ProtectedRoute] tenant_id null after bootstrap — auto-retrying once');
      retryBootstrap();
    }
  }, [bootstrapComplete, session, tenant_id]);

  // Determine current path for debug display
  const currentPath = window.location?.pathname;
  
  // Show loading spinner until bootstrap is complete.
  // Steps 3/4 below handle null tenant_id / role after bootstrap finishes.
  const isContextLoading = contextLoading || !bootstrapComplete;
  
  // Determine decision state for debugging
  let decision = 'UNKNOWN';
  if (authLoading) {
    decision = 'AUTH_LOADING';
  } else if (isContextLoading) {
    decision = 'CONTEXT_LOADING';
  } else if (!session) {
    decision = 'NO_SESSION';
  } else if (requiresTenant && !tenant_id) {
    decision = 'NO_TENANT';
  } else if (requiresTenant && !role) {
    decision = 'NO_ROLE';
  } else if (requiredRoles && requiredRoles?.length > 0) {
    const normalizedRole = (role || '')?.toUpperCase()?.trim();
    const allowed = requiredRoles?.some(r => r?.toUpperCase() === normalizedRole);
    decision = allowed ? 'ALLOWED' : 'DENIED';
  } else {
    decision = 'ALLOWED';
  }
  
  // Console logs for debugging
  if (DEV_MODE) {
    console.log('[ProtectedRoute] Debug:', {
      path: currentPath,
      authLoading,
      contextLoading,
      bootstrapComplete,
      role,
      tenant_id,
      isContextLoading,
      decision
    });
  }
  
  // STEP 1: While auth OR context is loading, render full-page loading state
  // DO NOT redirect anywhere during loading
  if (!isDevMode() && (authLoading || isContextLoading)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        <div className="text-center">
          <p className="text-lg font-medium text-foreground mb-1">
            Loading your vessel access…
          </p>
          <p className="text-sm text-muted-foreground">
            Checking permissions
          </p>
        </div>
        
        {/* DEV MODE DEBUG PANEL */}
        {DEV_MODE && (
          <div className="mt-8 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-mono max-w-md w-full">
            <div className="font-bold mb-2 text-gray-700 dark:text-gray-300">🔧 DEV DEBUG</div>
            <div className="space-y-1 text-gray-600 dark:text-gray-400">
              <div><span className="font-semibold">path:</span> {currentPath}</div>
              <div><span className="font-semibold">session:</span> {session ? 'true' : 'false'}</div>
              <div><span className="font-semibold">tenant_id:</span> {tenant_id || 'null'}</div>
              <div><span className="font-semibold">role:</span> {role || 'null'}</div>
              <div><span className="font-semibold">authLoading:</span> {authLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">contextLoading:</span> {contextLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">bootstrapComplete:</span> {bootstrapComplete ? 'true' : 'false'}</div>
              <div><span className="font-semibold">isContextLoading:</span> {isContextLoading ? 'true' : 'false'}</div>
              <div className="pt-1 border-t border-gray-300 dark:border-gray-600 mt-2">
                <span className="font-semibold">decision:</span> <span className="font-bold">{decision}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  
  // STEP 2: After loading completes - check session
  // EXCEPTION: Allow /reset-password and /forgot-password to be accessed without session (public routes)
  // If no session => redirect to /login-authentication (ONLY ALLOWED REDIRECT)
  const publicRoutes = ['/reset-password', '/forgot-password'];
  if (!session && !publicRoutes?.includes(currentPath)) {
    return <Navigate to="/login-authentication" replace />;
  }
  
  // STEP 3: Check tenant requirement
  // If tenant_id is null AND route requires tenant => render "No active vessel access" (NO REDIRECT)
  if (requiresTenant && !tenant_id) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
        <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-foreground mb-2">No active vessel access</h2>
          <p className="text-muted-foreground mb-6">
            You're logged in but not linked to a vessel yet.
          </p>
          <a
            href="/dashboard"
            className="inline-block px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
        
        {/* DEV MODE DEBUG PANEL */}
        {DEV_MODE && (
          <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-mono max-w-md w-full">
            <div className="font-bold mb-2 text-gray-700 dark:text-gray-300">🔧 DEV DEBUG</div>
            <div className="space-y-1 text-gray-600 dark:text-gray-400">
              <div><span className="font-semibold">path:</span> {currentPath}</div>
              <div><span className="font-semibold">session:</span> {session ? 'true' : 'false'}</div>
              <div><span className="font-semibold">tenant_id:</span> {tenant_id || 'null'}</div>
              <div><span className="font-semibold">role:</span> {role || 'null'}</div>
              <div><span className="font-semibold">authLoading:</span> {authLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">contextLoading:</span> {contextLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">bootstrapComplete:</span> {bootstrapComplete ? 'true' : 'false'}</div>
              <div><span className="font-semibold">isContextLoading:</span> {isContextLoading ? 'true' : 'false'}</div>
              <div className="pt-1 border-t border-gray-300 dark:border-gray-600 mt-2">
                <span className="font-semibold">decision:</span> <span className="font-bold">{decision}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  
  // STEP 4: Check role requirement
  // If role is missing => render "Role unavailable" (NO REDIRECT)
  if (requiresTenant && !role) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
        <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-foreground mb-2">Role unavailable</h2>
          <p className="text-muted-foreground mb-6">
            Your role information is not available. Please contact your vessel administrator.
          </p>
          <a
            href="/dashboard"
            className="inline-block px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
        
        {/* DEV MODE DEBUG PANEL */}
        {DEV_MODE && (
          <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-mono max-w-md w-full">
            <div className="font-bold mb-2 text-gray-700 dark:text-gray-300">🔧 DEV DEBUG</div>
            <div className="space-y-1 text-gray-600 dark:text-gray-400">
              <div><span className="font-semibold">path:</span> {currentPath}</div>
              <div><span className="font-semibold">session:</span> {session ? 'true' : 'false'}</div>
              <div><span className="font-semibold">tenant_id:</span> {tenant_id || 'null'}</div>
              <div><span className="font-semibold">role:</span> {role || 'null'}</div>
              <div><span className="font-semibold">authLoading:</span> {authLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">contextLoading:</span> {contextLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">bootstrapComplete:</span> {bootstrapComplete ? 'true' : 'false'}</div>
              <div><span className="font-semibold">isContextLoading:</span> {isContextLoading ? 'true' : 'false'}</div>
              <div className="pt-1 border-t border-gray-300 dark:border-gray-600 mt-2">
                <span className="font-semibold">decision:</span> <span className="font-bold">{decision}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  
  // STEP 5: Permission gating based on requiredRoles
  // Use ONLY role returned by bootstrap (or stored tenant context)
  if (requiredRoles && requiredRoles?.length > 0) {
    const normalizedRole = (role || '')?.toUpperCase()?.trim();
    const allowed = requiredRoles?.some(r => r?.toUpperCase() === normalizedRole);
    
    // If user lacks permission: show Access Restricted screen with back link (NO REDIRECT)
    if (!allowed) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div className="text-center max-w-md">
            <h2 className="text-xl font-semibold text-foreground mb-2">Access Restricted</h2>
            <p className="text-muted-foreground mb-6">
              Your permission tier does not allow access to this page.
            </p>
            <a
              href="/dashboard"
              className="inline-block px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Back to Dashboard
            </a>
          </div>
          {/* DEV MODE DEBUG PANEL */}
          {DEV_MODE && (
            <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-mono max-w-md w-full">
              <div className="font-bold mb-2 text-gray-700 dark:text-gray-300">🔧 DEV DEBUG</div>
              <div className="space-y-1 text-gray-600 dark:text-gray-400">
                <div><span className="font-semibold">path:</span> {currentPath}</div>
                <div><span className="font-semibold">session:</span> {session ? 'true' : 'false'}</div>
                <div><span className="font-semibold">tenant_id:</span> {tenant_id || 'null'}</div>
                <div><span className="font-semibold">role:</span> {role || 'null'}</div>
                <div><span className="font-semibold">requiredRoles:</span> {requiredRoles?.join(', ')}</div>
                <div><span className="font-semibold">authLoading:</span> {authLoading ? 'true' : 'false'}</div>
                <div><span className="font-semibold">contextLoading:</span> {contextLoading ? 'true' : 'false'}</div>
                <div><span className="font-semibold">bootstrapComplete:</span> {bootstrapComplete ? 'true' : 'false'}</div>
                <div><span className="font-semibold">isContextLoading:</span> {isContextLoading ? 'true' : 'false'}</div>
                <div className="pt-1 border-t border-gray-300 dark:border-gray-600 mt-2">
                  <span className="font-semibold">decision:</span> <span className="font-bold">{decision}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
  }
  
  // Session valid, tenant context available, and permissions OK - render protected content
  return children;
};

// COMMAND-only Route wrapper
const CommandRoute = ({ children }) => {
  // Check DEV MODE flag
  if (isDevMode()) {
    console.log('[CommandRoute] 🔧 DEV MODE: Bypassing COMMAND check');
    return (
      <>
        <DevModeBanner />
        {children}
      </>
    );
  }
  
  const { 
    session, 
    loading: authLoading, 
    tenantLoading: contextLoading, 
    bootstrapComplete,
    activeTenantId: tenant_id, 
    tenantRole: role 
  } = useAuth();
  
  const currentPath = window.location?.pathname;
  
  // Treat null role/tenant as LOADING until bootstrap completes
  const isContextLoading = contextLoading || !bootstrapComplete || 
    (role === null || role === undefined || tenant_id === null || tenant_id === undefined);
  
  let decision = 'UNKNOWN';
  if (authLoading) {
    decision = 'AUTH_LOADING';
  } else if (isContextLoading) {
    decision = 'CONTEXT_LOADING';
  } else if (!session) {
    decision = 'NO_SESSION';
  } else if (!tenant_id) {
    decision = 'NO_TENANT';
  } else if (!role) {
    decision = 'NO_ROLE';
  } else {
    const normalizedRole = (role || '')?.toUpperCase()?.trim();
    decision = normalizedRole === 'COMMAND' ? 'ALLOWED' : 'DENIED';
  }
  
  // Wait for loading to complete
  if (!isDevMode() && (authLoading || isContextLoading)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        <div className="text-center">
          <p className="text-lg font-medium text-foreground mb-1">
            Loading your vessel access…
          </p>
          <p className="text-sm text-muted-foreground">
            Checking permissions
          </p>
        </div>
        
        {DEV_MODE && (
          <div className="mt-8 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-mono max-w-md w-full">
            <div className="font-bold mb-2 text-gray-700 dark:text-gray-300">🔧 DEV DEBUG</div>
            <div className="space-y-1 text-gray-600 dark:text-gray-400">
              <div><span className="font-semibold">path:</span> {currentPath}</div>
              <div><span className="font-semibold">session:</span> {session ? 'true' : 'false'}</div>
              <div><span className="font-semibold">tenant_id:</span> {tenant_id || 'null'}</div>
              <div><span className="font-semibold">role:</span> {role || 'null'}</div>
              <div><span className="font-semibold">authLoading:</span> {authLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">contextLoading:</span> {contextLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">bootstrapComplete:</span> {bootstrapComplete ? 'true' : 'false'}</div>
              <div><span className="font-semibold">isContextLoading:</span> {isContextLoading ? 'true' : 'false'}</div>
              <div className="pt-1 border-t border-gray-300 dark:border-gray-600 mt-2">
                <span className="font-semibold">decision:</span> <span className="font-bold">{decision}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  
  // Check session
  if (!session) {
    return <Navigate to="/login-authentication" replace />;
  }
  
  // Check tenant
  if (!tenant_id) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
        <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-foreground mb-2">No active vessel access</h2>
          <p className="text-muted-foreground mb-6">
            You're logged in but not linked to a vessel yet.
          </p>
          <a
            href="/dashboard"
            className="inline-block px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
        
        {DEV_MODE && (
          <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-mono max-w-md w-full">
            <div className="font-bold mb-2 text-gray-700 dark:text-gray-300">🔧 DEV DEBUG</div>
            <div className="space-y-1 text-gray-600 dark:text-gray-400">
              <div><span className="font-semibold">path:</span> {currentPath}</div>
              <div><span className="font-semibold">session:</span> {session ? 'true' : 'false'}</div>
              <div><span className="font-semibold">tenant_id:</span> {tenant_id || 'null'}</div>
              <div><span className="font-semibold">role:</span> {role || 'null'}</div>
              <div><span className="font-semibold">authLoading:</span> {authLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">contextLoading:</span> {contextLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">bootstrapComplete:</span> {bootstrapComplete ? 'true' : 'false'}</div>
              <div><span className="font-semibold">isContextLoading:</span> {isContextLoading ? 'true' : 'false'}</div>
              <div className="pt-1 border-t border-gray-300 dark:border-gray-600 mt-2">
                <span className="font-semibold">decision:</span> <span className="font-bold">{decision}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  
  // Check role - COMMAND only
  const normalizedRole = (role || '')?.toUpperCase()?.trim();
  if (normalizedRole !== 'COMMAND') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-foreground mb-2">Access Restricted</h2>
          <p className="text-muted-foreground mb-6">
            Your permission tier does not allow access to this page.
          </p>
          <a
            href="/dashboard"
            className="inline-block px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
        
        {DEV_MODE && (
          <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-mono max-w-md w-full">
            <div className="font-bold mb-2 text-gray-700 dark:text-gray-300">🔧 DEV DEBUG</div>
            <div className="space-y-1 text-gray-600 dark:text-gray-400">
              <div><span className="font-semibold">path:</span> {currentPath}</div>
              <div><span className="font-semibold">session:</span> {session ? 'true' : 'false'}</div>
              <div><span className="font-semibold">tenant_id:</span> {tenant_id || 'null'}</div>
              <div><span className="font-semibold">role:</span> {role || 'null'}</div>
              <div><span className="font-semibold">requiredRole:</span> COMMAND</div>
              <div><span className="font-semibold">authLoading:</span> {authLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">contextLoading:</span> {contextLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">bootstrapComplete:</span> {bootstrapComplete ? 'true' : 'false'}</div>
              <div><span className="font-semibold">isContextLoading:</span> {isContextLoading ? 'true' : 'false'}</div>
              <div className="pt-1 border-t border-gray-300 dark:border-gray-600 mt-2">
                <span className="font-semibold">decision:</span> <span className="font-bold">{decision}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  
  return children;
};

// COMMAND/CHIEF Route wrapper
const CommandChiefRoute = ({ children }) => {
  // Check DEV MODE flag
  if (isDevMode()) {
    console.log('[CommandChiefRoute] 🔧 DEV MODE: Bypassing COMMAND/CHIEF check');
    return (
      <>
        <DevModeBanner />
        {children}
      </>
    );
  }
  
  const { 
    session, 
    loading: authLoading, 
    tenantLoading: contextLoading, 
    bootstrapComplete,
    activeTenantId: tenant_id, 
    tenantRole: role 
  } = useAuth();
  
  const currentPath = window.location?.pathname;
  
  // Treat null role/tenant as LOADING until bootstrap completes
  const isContextLoading = contextLoading || !bootstrapComplete || 
    (role === null || role === undefined || tenant_id === null || tenant_id === undefined);
  
  let decision = 'UNKNOWN';
  if (authLoading) {
    decision = 'AUTH_LOADING';
  } else if (isContextLoading) {
    decision = 'CONTEXT_LOADING';
  } else if (!session) {
    decision = 'NO_SESSION';
  } else if (!tenant_id) {
    decision = 'NO_TENANT';
  } else if (!role) {
    decision = 'NO_ROLE';
  } else {
    const normalizedRole = (role || '')?.toUpperCase()?.trim();
    decision = (normalizedRole === 'COMMAND' || normalizedRole === 'CHIEF') ? 'ALLOWED' : 'DENIED';
  }
  
  // Wait for loading to complete
  if (!isDevMode() && (authLoading || isContextLoading)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 p-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        <div className="text-center">
          <p className="text-lg font-medium text-foreground mb-1">
            Loading your vessel access…
          </p>
          <p className="text-sm text-muted-foreground">
            Checking permissions
          </p>
        </div>
        
        {DEV_MODE && (
          <div className="mt-8 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-mono max-w-md w-full">
            <div className="font-bold mb-2 text-gray-700 dark:text-gray-300">🔧 DEV DEBUG</div>
            <div className="space-y-1 text-gray-600 dark:text-gray-400">
              <div><span className="font-semibold">path:</span> {currentPath}</div>
              <div><span className="font-semibold">session:</span> {session ? 'true' : 'false'}</div>
              <div><span className="font-semibold">tenant_id:</span> {tenant_id || 'null'}</div>
              <div><span className="font-semibold">role:</span> {role || 'null'}</div>
              <div><span className="font-semibold">authLoading:</span> {authLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">contextLoading:</span> {contextLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">bootstrapComplete:</span> {bootstrapComplete ? 'true' : 'false'}</div>
              <div><span className="font-semibold">isContextLoading:</span> {isContextLoading ? 'true' : 'false'}</div>
              <div className="pt-1 border-t border-gray-300 dark:border-gray-600 mt-2">
                <span className="font-semibold">decision:</span> <span className="font-bold">{decision}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  
  // Check session
  if (!session) {
    return <Navigate to="/login-authentication" replace />;
  }
  
  // Check tenant
  if (!tenant_id) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
        <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-foreground mb-2">No active vessel access</h2>
          <p className="text-muted-foreground mb-6">
            You're logged in but not linked to a vessel yet.
          </p>
          <a
            href="/dashboard"
            className="inline-block px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
        
        {DEV_MODE && (
          <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-mono max-w-md w-full">
            <div className="font-bold mb-2 text-gray-700 dark:text-gray-300">🔧 DEV DEBUG</div>
            <div className="space-y-1 text-gray-600 dark:text-gray-400">
              <div><span className="font-semibold">path:</span> {currentPath}</div>
              <div><span className="font-semibold">session:</span> {session ? 'true' : 'false'}</div>
              <div><span className="font-semibold">tenant_id:</span> {tenant_id || 'null'}</div>
              <div><span className="font-semibold">role:</span> {role || 'null'}</div>
              <div><span className="font-semibold">authLoading:</span> {authLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">contextLoading:</span> {contextLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">bootstrapComplete:</span> {bootstrapComplete ? 'true' : 'false'}</div>
              <div><span className="font-semibold">isContextLoading:</span> {isContextLoading ? 'true' : 'false'}</div>
              <div className="pt-1 border-t border-gray-300 dark:border-gray-600 mt-2">
                <span className="font-semibold">decision:</span> <span className="font-bold">{decision}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  
  // Check role - COMMAND or CHIEF
  const normalizedRole = (role || '')?.toUpperCase()?.trim();
  if (normalizedRole !== 'COMMAND' && normalizedRole !== 'CHIEF') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-foreground mb-2">Access Restricted</h2>
          <p className="text-muted-foreground mb-6">
            Your permission tier does not allow access to this page.
          </p>
          <a
            href="/dashboard"
            className="inline-block px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Back to Dashboard
          </a>
        </div>
        
        {DEV_MODE && (
          <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-mono max-w-md w-full">
            <div className="font-bold mb-2 text-gray-700 dark:text-gray-300">🔧 DEV DEBUG</div>
            <div className="space-y-1 text-gray-600 dark:text-gray-400">
              <div><span className="font-semibold">path:</span> {currentPath}</div>
              <div><span className="font-semibold">session:</span> {session ? 'true' : 'false'}</div>
              <div><span className="font-semibold">tenant_id:</span> {tenant_id || 'null'}</div>
              <div><span className="font-semibold">role:</span> {role || 'null'}</div>
              <div><span className="font-semibold">requiredRoles:</span> COMMAND, CHIEF</div>
              <div><span className="font-semibold">authLoading:</span> {authLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">contextLoading:</span> {contextLoading ? 'true' : 'false'}</div>
              <div><span className="font-semibold">bootstrapComplete:</span> {bootstrapComplete ? 'true' : 'false'}</div>
              <div><span className="font-semibold">isContextLoading:</span> {isContextLoading ? 'true' : 'false'}</div>
              <div className="pt-1 border-t border-gray-300 dark:border-gray-600 mt-2">
                <span className="font-semibold">decision:</span> <span className="font-bold">{decision}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
  
  return children;
};

// My Profile redirect component with profile creation
const MyProfileRedirect = () => {
  const { session, loading: authLoading } = useAuth();
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  
  useEffect(() => {
    const ensureProfileExists = async () => {
      // Wait for auth to complete
      if (authLoading) return;
      
      // Get real user from session
      const userId = session?.user?.id;
      if (!userId) return;
      
      try {
        setIsCreatingProfile(true);
        
        // Check if profile exists
        const { data: profile, error: profileError } = await supabase
          ?.from('profiles')
          ?.select('id')
          ?.eq('id', userId)
          ?.single();
        
        // If no profile, create it
        if (profileError && profileError?.code === 'PGRST116') {
          await supabase
            ?.from('profiles')
            ?.insert({
              id: userId,
              email: session?.user?.email,
              full_name: session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')?.[0]
            });
          
          console.log('Profile created for user:', userId);
        }
      } catch (err) {
        console.error('Error ensuring profile exists:', err);
      } finally {
        setIsCreatingProfile(false);
      }
    };
    
    ensureProfileExists();
  }, [session, authLoading]);
  
  // Show loading while auth is initializing
  if (authLoading || isCreatingProfile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  // Get real user ID from session
  const userId = session?.user?.id;
  
  // If no session, redirect to login
  if (!userId) {
    return <Navigate to="/login-authentication" replace />;
  }
  
  // Redirect to profile page with real user ID (works even when activeTenantId is null)
  return <Navigate to={`/profile/${userId}`} replace />;
};

const Routes = () => {
  return (
    <BrowserRouter>
      <ErrorBoundary>
      <RouteChangeLogger />
      <ScrollToTop />
      <RouterRoutes>
        {/* Marketing Routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/product" element={<ProductPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/who-its-for" element={<WhoItsForPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/faq" element={<FAQPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/contact" element={<ContactPage />} />

        {/* Public Routes */}
        <Route path="/public-landing-page" element={<PublicLandingPage />} />
        <Route path="/signup-vessel" element={<VesselSignupFlowStep1 />} />
        <Route path="/login-authentication" element={<LoginAuthentication />} />
        
        {/* Password Reset Routes - PUBLIC */}
        <Route path="/forgot-password" element={<ForgotPasswordRequest />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        
        {/* Invite Routes - PUBLIC (no ProtectedRoute wrapper) */}
        <Route path="/return-confirm" element={<ReturnConfirmPage />} />
        <Route path="/invite-accept" element={<InviteAcceptPage />} />
        <Route path="/invite" element={<InviteRedirect />} />
        <Route path="/accept-invite" element={<InviteRedirect />} />
        <Route path="/invite/accept" element={<InviteRedirect />} />
        <Route path="/crew-invite-acceptance-landing-v2" element={<InviteRedirect />} />
        <Route path="/crew-invite-acceptance-page" element={<InviteRedirect />} />
        <Route path="/lightweight-invite-acceptance-page" element={<InviteRedirect />} />
        
        {/* Protected Routes */}
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/safe-dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/today" element={<ProtectedRoute><TodayDetailPage /></ProtectedRoute>} />
        
        {/* Activity Feed */}
        <Route path="/activity" element={<ProtectedRoute><ActivityFeedManagement /></ProtectedRoute>} />
        
        {/* Inventory Routes - Location-First Navigation */}
        <Route path="/inventory" element={<ProtectedRoute><Enhanced4LevelInventoryNavigation /></ProtectedRoute>} />
        <Route path="/inventory/location/*" element={<ProtectedRoute><Enhanced4LevelInventoryNavigation /></ProtectedRoute>} />
        {/* Legacy taxonomy routes - kept for backward compat */}
        <Route path="/inventory/l1/:l1Id" element={<ProtectedRoute><Enhanced4LevelInventoryNavigation /></ProtectedRoute>} />
        <Route path="/inventory/l1/:l1Id/l2/:l2Id" element={<ProtectedRoute><Enhanced4LevelInventoryNavigation /></ProtectedRoute>} />
        <Route path="/inventory/l1/:l1Id/l2/:l2Id/l3/:l3Id" element={<ProtectedRoute><Enhanced4LevelInventoryNavigation /></ProtectedRoute>} />
        <Route path="/inventory/l1/:l1Id/l2/:l2Id/l3/:l3Id/l4/:l4Id" element={<ProtectedRoute><Enhanced4LevelInventoryNavigation /></ProtectedRoute>} />
        
        {/* Item Detail View */}
        <Route path="/inventory/item/:itemId" element={<ProtectedRoute><ReadFirstItemDetailView /></ProtectedRoute>} />

        {/* Inventory Category Settings - Command/Chief Only */}
        <Route path="/inventory-category-settings" element={<CommandChiefRoute><InventoryCategorySettings /></CommandChiefRoute>} />
        
        {/* Locations Management Settings - Command/Chief Only */}
        <Route path="/locations-settings" element={<CommandChiefRoute><LocationsManagementSettings /></CommandChiefRoute>} />
        
        {/* Vessel Settings - Command/Chief Only (granular role check inside component) */}
        <Route path="/settings/vessel" element={<CommandChiefRoute><VesselSettings /></CommandChiefRoute>} />
        
        {/* Settings Page - Protected Route */}
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        
        {/* Membership - Protected Route */}
        <Route path="/membership" element={<ProtectedRoute><Membership /></ProtectedRoute>} />
        
        {/* Defects Routes */}
        <Route path="/defects" element={<ProtectedRoute><DefectsDashboard /></ProtectedRoute>} />
        
        {/* Laundry Routes */}
        <Route path="/laundry-management-dashboard" element={<ProtectedRoute><LaundryManagementDashboard /></ProtectedRoute>} />
        <Route path="/laundry-calendar-history-view" element={<ProtectedRoute><LaundryCalendarHistoryView /></ProtectedRoute>} />
        
        {/* Trips Routes */}
        <Route path="/trips-management-dashboard" element={<ProtectedRoute><TripsManagementDashboard /></ProtectedRoute>} />
        <Route path="/trip/:tripId" element={<ProtectedRoute><TripDetailView /></ProtectedRoute>} />
        <Route path="/trip/:tripId/itinerary" element={<ProtectedRoute><TripItineraryTimeline /></ProtectedRoute>} />
        <Route path="/trip/:tripId/preferences" element={<ProtectedRoute><TripPreferencesView /></ProtectedRoute>} />
        <Route path="/trip/:tripId/preferences-overview" element={<ProtectedRoute><TripPreferencesOverview /></ProtectedRoute>} />
        
        {/* Preferences Routes */}
        <Route path="/preferences" element={<ProtectedRoute><PreferencesDirectory /></ProtectedRoute>} />
        
        {/* Guest Routes */}
        <Route path="/guest-management-dashboard" element={<ProtectedRoute><GuestManagementDashboard /></ProtectedRoute>} />
        <Route path="/guest/:guestId/preferences" element={<ProtectedRoute><GuestPreferenceProfile /></ProtectedRoute>} />
        
        {/* Crew Routes */}
        <Route path="/crew-management" element={<ProtectedRoute><CrewManagement /></ProtectedRoute>} />
        <Route path="/crew-management/roles" element={<CommandRoute><RoleManagement /></CommandRoute>} />
        <Route path="/profile/:crewId" element={<ProtectedRoute requiresTenant={false}><CrewProfile /></ProtectedRoute>} />
        <Route path="/my-profile" element={<MyProfileRedirect />} />
        <Route path="/my-profile-management" element={<ProtectedRoute><MyProfileManagement /></ProtectedRoute>} />
        
        {/* Jobs Routes */}
        <Route path="/team-jobs-management" element={<ProtectedRoute><TeamJobsManagement /></ProtectedRoute>} />
        <Route path="/duty-sets-rotation-management" element={<ProtectedRoute><DutySetsRotationManagement /></ProtectedRoute>} />
        
        {/* Calendar Routes */}
        <Route path="/ops-vessel-calendar" element={<ProtectedRoute><OpsVesselCalendar /></ProtectedRoute>} />
        
        {/* Blueprint Routes */}
        <Route path="/blueprint-vessel-view" element={<ProtectedRoute><BlueprintVesselView /></ProtectedRoute>} />
        
        {/* Inventory Analytics */}
        <Route path="/inventory-analytics-dashboard" element={<ProtectedRoute><InventoryAnalyticsDashboard /></ProtectedRoute>} />
        
        {/* Smart Import */}
        <Route path="/smart-import-with-auto-assignment-engine" element={<ProtectedRoute><SmartImportWithAutoAssignmentEngine /></ProtectedRoute>} />
        
        {/* Provisioning Routes */}
        <Route path="/provisioning" element={<ProtectedRoute><ProvisioningWorkspace /></ProtectedRoute>} />
        <Route path="/provisioning/suppliers" element={<ProtectedRoute><ProvisioningSuppliers /></ProtectedRoute>} />
        <Route path="/provisioning/inbox" element={<ProtectedRoute><DeliveryInbox /></ProtectedRoute>} />
        <Route path="/provisioning/history" element={<ProtectedRoute><DeliveryHistory /></ProtectedRoute>} />
        <Route path="/provisioning/return-slip" element={<ProtectedRoute><ReturnSlipPage /></ProtectedRoute>} />
        <Route path="/provisioning/:id" element={<ProtectedRoute><ProvisioningBoardDetail /></ProtectedRoute>} />

        {/* Accounts */}
        <Route path="/accounts" element={<ProtectedRoute><Accounts /></ProtectedRoute>} />
        
        {/* Logs/Deliveries */}
        <Route path="/logs-deliveries" element={<ProtectedRoute><LogsDeliveries /></ProtectedRoute>} />
        
        {/* Catch-all Fallback Route - Must be LAST */}
        <Route path="*" element={<NotFound />} />
      </RouterRoutes>
      </ErrorBoundary>
    </BrowserRouter>
  );
};

export default Routes;
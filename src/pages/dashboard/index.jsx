import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ErrorBoundary from '../../components/ErrorBoundary';
import Header from '../../components/navigation/Header';
import BlueprintNavigator from '../../components/dashboard/BlueprintNavigator';
import TeamJobListWidget from './components/TeamJobListWidget';
import TodaySnapshotWidget from './components/TodaySnapshotWidget';
import RecentActivityWidget from './components/RecentActivityWidget';
import AccountsWidget from './components/AccountsWidget';
import InventoryHealthWidget from './components/InventoryHealthWidget';
import QuickActionsCenter from './components/QuickActionsCenter';
import LaundryLogWidget from './components/LaundryLogWidget';
import ReportDefectModal from '../defects/components/ReportDefectModal';
import ComprehensiveJobModal from '../team-jobs-management/components/ComprehensiveJobModal';

import { supabase } from '../../lib/supabaseClient';


// DEV_MODE constant
const DEV_MODE = true;

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [showReportDefectModal, setShowReportDefectModal] = useState(false);
  const [showCreateJobModal, setShowCreateJobModal] = useState(false);
  const [vesselData, setVesselData] = useState(null);
  const [activeTenantId, setActiveTenantId] = useState(null);
  
  // Check session on mount
  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      const { data: { session: currentSession } } = await supabase?.auth?.getSession();
      
      if (!currentSession?.user) {
        navigate('/login-authentication', { replace: true });
        return;
      }
      
      setSession(currentSession);
      setUserEmail(currentSession?.user?.email);
      
      // Load active tenant ID
      const tenantId = localStorage.getItem('cargo_active_tenant_id');
      setActiveTenantId(tenantId);
      
      // Load tenant_members role and store in session
      await loadTenantMemberRole(currentSession?.user?.id, tenantId);
      
      // Load vessel data for hero image
      await loadVesselData(tenantId);
      
      setLoading(false);
    } catch (err) {
      console.error('Session check error:', err);
      setLoading(false);
    }
  };

  const loadTenantMemberRole = async (userId, tenantId) => {
    try {
      const { data: memberData, error } = await supabase?.from('tenant_members')?.select('permission_tier')?.eq('tenant_id', tenantId)?.eq('user_id', userId)?.eq('active', true)?.maybeSingle();

      if (error) {
        console.error('[DASHBOARD] Tenant member role fetch error:', error);
        return;
      }

      if (memberData?.permission_tier) {
        // Store permission_tier in lowercase for consistent comparison
        const tierLowercase = memberData?.permission_tier?.toLowerCase();
        sessionStorage.setItem('cargo_tenant_member_role', tierLowercase);
        console.log('[DASHBOARD] Loaded tenant_members.permission_tier:', tierLowercase);
      }
    } catch (err) {
      console.error('[DASHBOARD] Load tenant member role exception:', err);
    }
  };

  const loadVesselData = async (tenantId) => {
    try {
      const { data: vesselRow, error } = await supabase
        ?.from('vessels')
        ?.select('hero_image_url, use_custom_hero')
        ?.eq('tenant_id', tenantId)
        ?.maybeSingle();

      if (error) {
        console.error('[DASHBOARD] Vessel fetch error:', error);
        return;
      }

      setVesselData(vesselRow);
    } catch (err) {
      console.error('[DASHBOARD] Load vessel exception:', err);
    }
  };

  // Render loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // Render main vessel dashboard with 3-column layout
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background">
        <Header />
        
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 ">
          {/* 3-Column Grid Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT SIDEBAR - 3 columns */}
            <div className="lg:col-span-3 space-y-6">
              <TeamJobListWidget />
              <TodaySnapshotWidget />
              <RecentActivityWidget />
            </div>

            {/* CENTER AREA - 6 columns */}
            <div className="lg:col-span-6 space-y-6">
              {/* Yacht Visualization with blue glow */}
              <div className="bg-card border border-border rounded-xl shadow-sm" style={{
                boxShadow: '0 0 40px rgba(74, 144, 226, 0.15), 0 4px 6px rgba(0, 0, 0, 0.1)'
              }}>
                <BlueprintNavigator 
                  heroImageUrl={vesselData?.hero_image_url}
                  useCustomHero={vesselData?.use_custom_hero}
                />
              </div>

              {/* Laundry Widget */}
              <LaundryLogWidget />

              {/* Quick Actions */}
              <QuickActionsCenter
                onAddInventory={() => navigate('/folder-based-inventory-dashboard')}
                onLogDelivery={() => navigate('/logs-deliveries')}
                onReportDefect={() => setShowReportDefectModal(true)}
                onCreateJob={() => setShowCreateJobModal(true)}
              />
            </div>

            {/* RIGHT SIDEBAR - 3 columns */}
            <div className="lg:col-span-3 space-y-6">
              <AccountsWidget
                title="Charter Accounts"
                account={{ percentage: 68, spent: 34000, total: 50000, remaining: 16000, trend: -12, color: 'bg-primary' }}
              />
              <AccountsWidget
                title="Owner Accounts"
                account={{ percentage: 47, spent: 23500, total: 50000, remaining: 26500, trend: 8, color: 'bg-purple-500' }}
              />
              <InventoryHealthWidget />
            </div>
          </div>
        </div>

        {/* Modals */}
        {showReportDefectModal && (
          <ReportDefectModal
            isOpen={showReportDefectModal}
            onClose={() => setShowReportDefectModal(false)}
            onSuccess={() => {
              setShowReportDefectModal(false);
            }}
          />
        )}
        
        {showCreateJobModal && (
          <ComprehensiveJobModal
            isOpen={showCreateJobModal}
            onClose={() => setShowCreateJobModal(false)}
            mode="create"
            boards={[]}
            selectedDate={new Date()}
            defaultBoardId={null}
            activeTenantId={activeTenantId}
            currentUser={session?.user}
            onSuccess={() => {
              setShowCreateJobModal(false);
            }}
          />
        )}
      </div>
    </ErrorBoundary>
  );
};

export default Dashboard;
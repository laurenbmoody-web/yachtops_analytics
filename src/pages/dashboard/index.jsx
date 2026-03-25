import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { Settings2 } from 'lucide-react';

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
import SortableWidget from './components/SortableWidget';
import DashboardEditBar from './components/DashboardEditBar';
import ProvisioningWidget from './components/ProvisioningWidget';

import { useDashboardLayout } from './useDashboardLayout';
import { supabase } from '../../lib/supabaseClient';

const CHARTER_ACCOUNT = {
  percentage: 68, spent: 34000, total: 50000, remaining: 16000, trend: -12, color: 'bg-primary',
};
const OWNER_ACCOUNT = {
  percentage: 47, spent: 23500, total: 50000, remaining: 26500, trend: 8, color: 'bg-purple-500',
};

// Column container that is also a drop target (handles drops onto empty columns)
const DroppableColumn = ({ columnId, children, className }) => {
  const { setNodeRef } = useDroppable({ id: columnId });
  return (
    <div ref={setNodeRef} className={className}>
      {children}
    </div>
  );
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [vesselData, setVesselData] = useState(null);
  const [activeTenantId, setActiveTenantId] = useState(null);
  const [showReportDefectModal, setShowReportDefectModal] = useState(false);
  const [showCreateJobModal, setShowCreateJobModal] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [activeId, setActiveId] = useState(null); // widget being dragged

  const { layout, resetLayout, addWidget, removeWidget, moveWidget, hiddenWidgets } =
    useDashboardLayout();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

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
      const tenantId = localStorage.getItem('cargo_active_tenant_id');
      setActiveTenantId(tenantId);
      await loadTenantMemberRole(currentSession?.user?.id, tenantId);
      await loadVesselData(tenantId);
      setLoading(false);
    } catch (err) {
      console.error('Session check error:', err);
      setLoading(false);
    }
  };

  const loadTenantMemberRole = async (userId, tenantId) => {
    try {
      const { data: memberData } = await supabase
        ?.from('tenant_members')
        ?.select('permission_tier')
        ?.eq('tenant_id', tenantId)
        ?.eq('user_id', userId)
        ?.eq('active', true)
        ?.maybeSingle();
      if (memberData?.permission_tier) {
        sessionStorage.setItem('cargo_tenant_member_role', memberData.permission_tier.toLowerCase());
      }
    } catch (err) {
      console.error('[DASHBOARD] Load tenant member role exception:', err);
    }
  };

  const loadVesselData = async (tenantId) => {
    try {
      const { data: vesselRow } = await supabase
        ?.from('vessels')
        ?.select('hero_image_url, use_custom_hero')
        ?.eq('tenant_id', tenantId)
        ?.maybeSingle();
      setVesselData(vesselRow);
    } catch (err) {
      console.error('[DASHBOARD] Load vessel exception:', err);
    }
  };

  // ── Drag & Drop ──────────────────────────────────────────────────────────────

  const handleDragStart = ({ active }) => setActiveId(String(active.id));

  const handleDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    moveWidget(String(active.id), String(over.id));
  };

  // ── Widget renderer ──────────────────────────────────────────────────────────

  const renderWidget = (id) => {
    switch (id) {
      case 'teamJobs':
        return <TeamJobListWidget />;
      case 'todaySnapshot':
        return <TodaySnapshotWidget />;
      case 'recentActivity':
        return <RecentActivityWidget />;
      case 'vesselView':
        return (
          <div
            className="bg-card border border-border rounded-xl shadow-sm"
            style={{ boxShadow: '0 0 40px rgba(74,144,226,0.15), 0 4px 6px rgba(0,0,0,0.1)' }}
          >
            <BlueprintNavigator
              heroImageUrl={vesselData?.hero_image_url}
              useCustomHero={vesselData?.use_custom_hero}
            />
          </div>
        );
      case 'laundry':
        return <LaundryLogWidget />;
      case 'quickActions':
        return (
          <QuickActionsCenter
            onAddInventory={() => navigate('/folder-based-inventory-dashboard')}
            onLogDelivery={() => navigate('/logs-deliveries')}
            onReportDefect={() => setShowReportDefectModal(true)}
            onCreateJob={() => setShowCreateJobModal(true)}
          />
        );
      case 'charterAccounts':
        return <AccountsWidget title="Charter Accounts" account={CHARTER_ACCOUNT} />;
      case 'ownerAccounts':
        return <AccountsWidget title="Owner Accounts" account={OWNER_ACCOUNT} />;
      case 'inventoryHealth':
        return <InventoryHealthWidget />;
      case 'provisioning':
        return <ProvisioningWidget />;
      default:
        return null;
    }
  };

  // ── Column renderer ──────────────────────────────────────────────────────────

  const renderColumn = (columnId, spanClass) => (
    <div className={spanClass}>
      <DroppableColumn columnId={columnId} className="space-y-6 min-h-[80px]">
        <SortableContext items={layout[columnId]} strategy={verticalListSortingStrategy}>
          {layout[columnId].map((id) => (
            <SortableWidget key={id} id={id} isEditing={isEditing} onRemove={removeWidget}>
              {renderWidget(id)}
            </SortableWidget>
          ))}
        </SortableContext>

        {isEditing && layout[columnId].length === 0 && (
          <div className="h-24 border-2 border-dashed border-border rounded-xl flex items-center justify-center text-sm text-muted-foreground">
            Drop a widget here
          </div>
        )}
      </DroppableColumn>
    </div>
  );

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <ErrorBoundary>
      <div className={`min-h-screen bg-background ${isEditing ? 'pb-20' : ''}`}>
        <Header />

        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Top bar: Customise button */}
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setIsEditing((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                isEditing
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              <Settings2 className="w-4 h-4" />
              {isEditing ? 'Editing layout…' : 'Customise Layout'}
            </button>
          </div>

          {/* 3-Column Grid with DnD */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {renderColumn('left',   'lg:col-span-3')}
              {renderColumn('center', 'lg:col-span-6')}
              {renderColumn('right',  'lg:col-span-3')}
            </div>

            {/* Ghost preview while dragging */}
            <DragOverlay>
              {activeId ? (
                <div className="opacity-75 shadow-2xl rounded-xl">
                  {renderWidget(activeId)}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>

        {/* Edit mode bar */}
        {isEditing && (
          <DashboardEditBar
            hiddenWidgets={hiddenWidgets}
            onAdd={(id) => addWidget(id)}
            onReset={resetLayout}
            onDone={() => setIsEditing(false)}
          />
        )}

        {/* Modals */}
        {showReportDefectModal && (
          <ReportDefectModal
            isOpen={showReportDefectModal}
            onClose={() => setShowReportDefectModal(false)}
            onSuccess={() => setShowReportDefectModal(false)}
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
            onSuccess={() => setShowCreateJobModal(false)}
          />
        )}
      </div>
    </ErrorBoundary>
  );
};

export default Dashboard;

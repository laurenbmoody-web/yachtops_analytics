import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { Settings2, Compass } from 'lucide-react';

import ErrorBoundary from '../../components/ErrorBoundary';
import Header from '../../components/navigation/Header';
import BlueprintNavigator from '../../components/dashboard/BlueprintNavigator';
import TeamJobListWidget from './components/TeamJobListWidget';
import RotaWidget from './components/RotaWidget';
import HoursOfRestWidget from './components/HoursOfRestWidget';
import TodayWidget from './components/TodayWidget';
import RecentActivityWidget from './components/RecentActivityWidget';
import VesselStatusWidget from './components/VesselStatusWidget';
import AccountsWidget from './components/AccountsWidget';
import SignInOutWidget from './components/SignInOutWidget';
import InventoryHealthWidget from './components/InventoryHealthWidget';
import VesselDocRenewalsWidget from './components/VesselDocRenewalsWidget';
import QuickActionsCenter from './components/QuickActionsCenter';
import LaundryLogWidget from './components/LaundryLogWidget';
import QuickAddDefectModal from '../defects/components/QuickAddDefectModal';
import ComprehensiveJobModal from '../team-jobs-management/components/ComprehensiveJobModal';
import ItemFormModal from '../inventory/components/ItemFormModal';
import BarcodeScanModal from '../inventory/components/BarcodeScanModal';
import SortableWidget from './components/SortableWidget';
import DashboardEditBar from './components/DashboardEditBar';
import ProvisioningWidget from './components/ProvisioningWidget';
import PantryWidget from './components/PantryWidget';
import FridgeTempWidget from './components/FridgeTempWidget';
import SetupTasksWidget from './components/SetupTasksWidget';
import GuidedTour, { tourTargetExists } from '../../components/tour/GuidedTour';

import '../../styles/editorial-tokens.css';
import './dashboard-widgets.css';
import { useDashboardLayout } from './useDashboardLayout';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import LogoSpinner from '../../components/LogoSpinner';
import { TOUR_STEPS, visibleSteps, isTourDone, markTourDone } from '../../services/guidedTour';


const CHARTER_ACCOUNT = {
  percentage: 68, spent: 34000, total: 50000, remaining: 16000, trend: -12, color: 'ce-bar-navy',
};
const OWNER_ACCOUNT = {
  // Purple owner bar deferred — resolved with the other non-cool/purple accents next pass.
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
  const { isVesselAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [vesselData, setVesselData] = useState(null);
  const [activeTenantId, setActiveTenantId] = useState(null);
  const [showReportDefectModal, setShowReportDefectModal] = useState(false);
  const [showCreateJobModal, setShowCreateJobModal] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);

  // A scanned box/location QR encodes /inventory?loc=<id>&ln=<name>. Parse the id
  // out (from a full URL, a relative one, or a bare uuid) and jump straight to
  // that box's contents — no leaving the app to the phone camera.
  const handleScanDetect = (raw) => {
    setShowScanModal(false);
    const val = String(raw || '').trim();
    let loc = null, ln = '';
    try {
      if (/loc=/.test(val)) {
        const u = new URL(val, window.location.origin);
        loc = u.searchParams.get('loc'); ln = u.searchParams.get('ln') || '';
      } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
        loc = val;
      }
    } catch { /* not a URL */ }
    if (loc) navigate(`/inventory?loc=${encodeURIComponent(loc)}${ln ? `&ln=${encodeURIComponent(ln)}` : ''}`);
    else window.showToast?.('Unrecognised QR — expected a box or location label', 'error');
  };
  const [showAddInventoryModal, setShowAddInventoryModal] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [activeId, setActiveId] = useState(null); // widget being dragged

  // Hide the floating Feedback button while customising so it never overlaps
  // the edit bar's controls (Feedback watches for this body class).
  useEffect(() => {
    document.body.classList.toggle('dashboard-editing', isEditing);
    return () => document.body.classList.remove('dashboard-editing');
  }, [isEditing]);

  const { layout, resetLayout, addWidget, removeWidget, moveWidget, hiddenWidgets } =
    useDashboardLayout();

  const [taskCounts, setTaskCounts] = useState({ locations: 0, inventoryFolders: 0, inventoryItems: 0, crew: 0, openTasks: 0 });
  const [tenant, setTenant] = useState(null);

  // The guided tour: `steps` is resolved at START time, not render time, because
  // which steps are valid depends on what is actually mounted (see below).
  const [tourSteps, setTourSteps] = useState(null);

  // ctx passed to onboardingTasks helpers — mirrors column names in ONBOARDING_TASKS.isDone
  const ctx = {
    locationsCount:      taskCounts.locations,
    foldersCount:        taskCounts.inventoryFolders,
    inventoryItemsCount: taskCounts.inventoryItems,
    crewCount:           taskCounts.crew,
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    checkSession();
  }, []);

  const loadTaskCounts = async (tenantId) => {
    if (!tenantId) return;
    try {
      const [
        { count: locCount },
        { count: folderCount },
        { count: itemCount },
        { count: crewCount },
        { count: jobCount },
      ] = await Promise.all([
        supabase.from('vessel_locations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_archived', false),
        // Exclude auto-seeded department root folders (is_department_root = true) which are
        // created by ensureDepartmentFolders() on every /inventory visit and are invisible
        // to the user. Only count manually-created root-level folders (sub_location IS NULL).
        supabase.from('inventory_locations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_archived', false).is('sub_location', null).eq('is_department_root', false),
        supabase.from('inventory_items').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        supabase.from('tenant_members').select('user_id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('active', true),
        // team_jobs — open-job status values: 'OPEN' | 'open' | 'Open'
        supabase.from('team_jobs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('status', ['OPEN', 'open', 'Open']),
      ]);
      setTaskCounts({
        locations: locCount ?? 0,
        inventoryFolders: folderCount ?? 0,
        inventoryItems: itemCount ?? 0,
        crew: crewCount ?? 0,
        openTasks: jobCount ?? 0,
      });
    } catch (err) {
      console.warn('[dashboard] task counts load failed', err);
    }
  };

  // The tenant row is read for dismissed_tasks, which drives the setup widget's
  // skip / bring-back. The 30-day tutorial window and the profile-level dismissal
  // flag went with the onboarding slab — the tour tracks itself per user.
  const loadTenantRow = async (tenantId) => {
    try {
      // dismissed_tasks may not exist in older DBs — pre-migration resilience: if
      // the column is absent the query still succeeds and it reads as undefined.
      const { data: tenantRow } = await supabase
        .from('tenants').select('name, dismissed_tasks').eq('id', tenantId).maybeSingle();
      setTenant(tenantRow ?? null);
    } catch (err) {
      console.warn('[dashboard] tenant row load failed', err);
    }
  };

  const handleSkipTask = async (key) => {
    const newList = [...(tenant?.dismissed_tasks ?? []), key];
    setTenant((prev) => ({ ...prev, dismissed_tasks: newList }));
    try {
      await supabase.from('tenants').update({ dismissed_tasks: newList }).eq('id', activeTenantId);
    } catch (err) {
      console.warn('[dashboard] dismissed_tasks update failed', err);
    }
  };

  const handleUnskipTask = async (key) => {
    const newList = (tenant?.dismissed_tasks ?? []).filter((k) => k !== key);
    setTenant((prev) => ({ ...prev, dismissed_tasks: newList }));
    try {
      await supabase.from('tenants').update({ dismissed_tasks: newList }).eq('id', activeTenantId);
    } catch (err) {
      console.warn('[dashboard] dismissed_tasks update failed', err);
    }
  };

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
      await Promise.all([
        loadVesselData(tenantId),
        loadTenantRow(tenantId),
        loadTaskCounts(tenantId),
      ]);
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

  // ── Guided tour ──────────────────────────────────────────────────────────────

  // Steps are resolved here rather than in render because validity is a question
  // about the live DOM: the dashboard is user-arranged, widgets are permission-
  // gated, and a widget with nothing to show returns null. Anything whose anchor
  // isn't on the page is dropped, so the tour never pulses over empty canvas and
  // the "3 of 7" the crew reads matches the number of stops they'll actually get.
  const startTour = useCallback(() => {
    const steps = visibleSteps(TOUR_STEPS, {
      isAdmin: isVesselAdmin,
      exists: tourTargetExists,
    });
    if (steps.length) setTourSteps(steps);
  }, [isVesselAdmin]);

  const endTour = useCallback(() => {
    setTourSteps(null);
    markTourDone(session?.user?.id);
  }, [session?.user?.id]);

  // First dashboard after joining: run it once, unprompted. The delay lets the
  // widgets mount and fetch, so the step filter sees the page the crew sees —
  // measuring too early would drop every widget step.
  //
  // The ref matters: isVesselAdmin arrives from useAuth asynchronously, so this
  // effect re-runs after the role lands. Without the latch, that second run would
  // call startTour again and throw a crew member back to step one mid-tour.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (loading || !session?.user?.id || autoStarted.current) return undefined;
    if (isTourDone(session.user.id)) return undefined;
    const t = setTimeout(() => { autoStarted.current = true; startTour(); }, 900);
    return () => clearTimeout(t);
  }, [loading, session?.user?.id, startTour]);

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
      case 'setupTasks':
        return (
          <SetupTasksWidget
            isAdmin={isVesselAdmin}
            ctx={ctx}
            tenant={tenant}
            userId={session?.user?.id}
            onSkip={handleSkipTask}
            onUnskip={handleUnskipTask}
          />
        );
      case 'signInOut':
        return <SignInOutWidget />;
      case 'teamJobs':
        return <TeamJobListWidget />;
      case 'rota':
        return <RotaWidget />;
      case 'hoursOfRest':
        return <HoursOfRestWidget />;
      case 'todaySnapshot':
        return <TodayWidget />;
      case 'recentActivity':
        return <RecentActivityWidget />;
      case 'vesselStatus':
        return <VesselStatusWidget tenantId={activeTenantId} />;
      case 'vesselView':
        return (
          <div
            className="rounded-xl overflow-hidden"
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
            onScan={() => setShowScanModal(true)}
            onAddInventory={() => setShowAddInventoryModal(true)}
            onLogDelivery={() => navigate('/provisioning?receive=true')}
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
      case 'vesselDocRenewals':
        return <VesselDocRenewalsWidget />;
      case 'provisioning':
        return <ProvisioningWidget />;
      case 'pantry':
        return <PantryWidget />;
      case 'fridgeTemps':
        return <FridgeTempWidget />;
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
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="text-center">
          <LogoSpinner size={48} className="mx-auto mb-4" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <ErrorBoundary>
      <div className={`min-h-screen ${isEditing ? 'pb-20' : ''}`} style={{ backgroundColor: '#F8FAFC' }}>
        <Header />

        <div className="max-w-[1600px] mx-auto p-6">
          {/* 3-Column Grid with DnD */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="cargo-editorial grid grid-cols-1 lg:grid-cols-12 gap-6">
              {renderColumn('left',   'lg:col-span-3')}
              {renderColumn('center', 'lg:col-span-6')}
              {renderColumn('right',  'lg:col-span-3')}
            </div>

            {/* Ghost preview while dragging */}
            <DragOverlay>
              {activeId ? (
                /* cargo-editorial here too: the overlay clone renders
                   outside the grid's scope, so it'd lose the --d-* tokens
                   mid-drag without this. */
                <div className="cargo-editorial opacity-75 shadow-2xl rounded-xl">
                  {renderWidget(activeId)}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          {/* Customise Layout — bottom of page, right-aligned, with the tour
               alongside it so it can be re-run without hunting for a pill. */}
          <div className="flex justify-end gap-2 mt-8">
            <button
              onClick={startTour}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl border bg-card text-muted-foreground border-border hover:bg-muted transition-colors"
              title="Walk through the dashboard again"
            >
              <Compass className="w-4 h-4" />
              Take the tour
            </button>
            <button
              onClick={() => setIsEditing((v) => !v)}
              data-tour="customise"
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl border transition-colors ${
                isEditing
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              <Settings2 className="w-4 h-4" />
              {isEditing ? 'Editing layout…' : 'Customise Layout'}
            </button>
          </div>
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

        {tourSteps && (
          <GuidedTour steps={tourSteps} onFinish={endTour} onSkip={endTour} />
        )}

        {/* Modals */}
        {showAddInventoryModal && (
          <ItemFormModal quick onClose={() => setShowAddInventoryModal(false)} onSaved={() => setShowAddInventoryModal(false)} />
        )}
        {showScanModal && (
          <BarcodeScanModal onClose={() => setShowScanModal(false)} onDetect={handleScanDetect} />
        )}
        {showReportDefectModal && (
          <QuickAddDefectModal
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

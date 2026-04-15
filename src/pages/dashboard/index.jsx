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
import { Settings2, Anchor, Sparkles, X, Check, MapPin, FolderTree, Upload, ArrowRight, Wrench, Briefcase, ChevronRight } from 'lucide-react';

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
import AnchorChainProgress from '../../components/onboarding/AnchorChainProgress';

import { useDashboardLayout } from './useDashboardLayout';
import { supabase } from '../../lib/supabaseClient';

// ── Brand tokens (match onboarding Cargo palette) ────────────────────────────
const NAVY      = '#1E3A5F';
const ACCENT    = '#00A8CC';
const CHARCOAL  = '#1A202C';
const HEADING_FONT = "'Outfit', system-ui, sans-serif";
const BODY_FONT    = "'Plus Jakarta Sans', system-ui, sans-serif";
const PILL_FONT    = "'Archivo', system-ui, sans-serif";

// ── Tutorial data ─────────────────────────────────────────────────────────────
const TUTORIAL_ITEMS = [
  {
    id: 'locations_done',
    title: 'Set up vessel locations',
    desc: 'Map out your vessel — decks, cabins, storage rooms, lockers. Nest locations as needed. Everything in inventory sits under a location.',
    icon: MapPin,
    cta: 'Open Locations',
    route: '/locations-settings',
  },
  {
    id: 'inventory_done',
    title: 'Build your inventory folders',
    desc: 'Organise inventory into folders that mirror how your crew works — by department, usage, or physical zone.',
    icon: FolderTree,
    cta: 'Open Inventory',
    route: '/inventory',
  },
  {
    id: 'import_done',
    title: 'Upload your first inventory file',
    desc: "Got a spreadsheet from the last handover? Drop it in and Cargo will parse, de-dup, and auto-assign items into folders.",
    icon: Upload,
    cta: 'Import items',
    route: '/smart-import-with-auto-assignment-engine',
  },
];

const CARGO_FEATURES = [
  { icon: Wrench,    name: 'Defect Log',   blurb: 'Log issues before they snowball into costly repairs.' },
  { icon: Briefcase, name: 'Team Jobs',    blurb: 'Assign, track, and close vessel tasks with your crew.' },
  { icon: Upload,    name: 'Provisioning', blurb: 'Track stock levels and plan provisioning runs.' },
  { icon: MapPin,    name: 'Locations',    blurb: 'Map every space on your vessel with nested locations.' },
];

// ── Tutorial sub-components ───────────────────────────────────────────────────

const LivePercent = ({ percent }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const from = count;
    const duration = 1400;
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setCount(Math.round(from + (percent - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percent]);
  return <>{count}</>;
};


const TutorialCard = ({ item, done, onStart }) => {
  const ItemIcon = item.icon;
  return (
    <div
      className="relative rounded-2xl p-5 transition-all"
      style={{ backgroundColor: done ? '#ECFDF5' : 'white', border: `1px solid ${done ? '#A7F3D0' : '#E2E8F0'}` }}
    >
      <div className="flex items-start gap-4">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: done ? '#10B981' : NAVY }}
        >
          {done ? <Check size={20} color="white" /> : <ItemIcon size={20} color="white" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 style={{ fontFamily: HEADING_FONT, fontSize: 16, fontWeight: 700, color: CHARCOAL, textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.6 : 1 }}>{item.title}</h3>
          <p className="text-sm mt-1" style={{ color: '#64748B', fontFamily: BODY_FONT, lineHeight: 1.5 }}>{item.desc}</p>
          {!done && (
            <div className="mt-3">
              <button
                type="button"
                onClick={onStart}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-full border transition-colors"
                style={{ borderColor: NAVY, color: NAVY, fontFamily: BODY_FONT, fontWeight: 600 }}
              >
                {item.cta} <ArrowRight size={12} />
              </button>
            </div>
          )}
          {done && (
            <span
              className="mt-3 inline-flex items-center gap-1 text-xs px-3 py-1 rounded-full"
              style={{ backgroundColor: '#D1FAE5', color: '#065F46', fontFamily: PILL_FONT, fontWeight: 700, letterSpacing: '0.06em' }}
            >
              <Check size={11} /> Done
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

const FeatureTile = ({ feature }) => {
  const FIcon = feature.icon;
  return (
    <div className="rounded-xl p-4 transition-colors" style={{ backgroundColor: 'white', border: '1px solid #E2E8F0' }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ backgroundColor: '#F1F5F9', color: NAVY }}>
        <FIcon size={18} />
      </div>
      <h4 style={{ fontFamily: HEADING_FONT, fontSize: 14, fontWeight: 700, color: CHARCOAL }}>{feature.name}</h4>
      <p className="text-xs mt-1" style={{ color: '#64748B', fontFamily: BODY_FONT, lineHeight: 1.5 }}>{feature.blurb}</p>
    </div>
  );
};

const WelcomeToast = ({ onDismiss }) => (
  <div
    className="absolute top-4 right-4 max-w-sm rounded-xl p-4 flex items-start gap-3 z-10 cg-toast-in"
    style={{ backgroundColor: NAVY, color: 'white', boxShadow: '0 10px 40px rgba(30,58,95,0.35)' }}
  >
    <Sparkles size={18} color="#FDE68A" className="flex-shrink-0 mt-0.5" />
    <div className="flex-1 text-sm" style={{ fontFamily: BODY_FONT }}>
      <p style={{ fontFamily: HEADING_FONT, fontSize: 15, fontWeight: 700, marginBottom: 2 }}>You're all set.</p>
      <p style={{ color: '#CBD5E1' }}>Here's a quick tour. Finish these three to get the most out of Cargo.</p>
    </div>
    <button onClick={onDismiss} style={{ color: '#94A3B8' }}><X size={16} /></button>
  </div>
);

// Collapsible panel used inside the tutorial hero banner
const CollapsiblePanel = ({ title, badge, defaultOpen = false, pulse = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-4" style={{ borderTop: '1px solid #E2E8F0' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center py-4"
      >
        {/* Pulse applied only to the header row content — negative margin keeps tint from crossing divider */}
        <div className={`flex items-center justify-between w-full${!open && pulse ? ' cg-attention-pulse' : ''}`}>
          <div className="flex items-center gap-2">
            <span className="uppercase" style={{ fontFamily: PILL_FONT, fontSize: 11, fontWeight: 900, letterSpacing: '0.10em', color: '#94A3B8' }}>
              {title}
            </span>
            {!open && badge && (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: NAVY, color: 'white', fontFamily: PILL_FONT, fontWeight: 700 }}>
                {badge}
              </span>
            )}
          </div>
          <ChevronRight
            size={16}
            color="#94A3B8"
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 200ms ease' }}
          />
        </div>
      </button>
      {open && (
        <div className="pb-2 cg-anim-enter">
          {children}
        </div>
      )}
    </div>
  );
};

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

  const [vesselName, setVesselName] = useState('');
  const [showOnboardingTutorial, setShowOnboardingTutorial] = useState(false);
  const [tutorialDismissed, setTutorialDismissed] = useState(false);
  const [tutorialPillHidden, setTutorialPillHidden] = useState(
    () => localStorage.getItem('cg_tutorial_pill_hidden') === '1'
  );
  const [taskCounts, setTaskCounts] = useState({ locations: 0, inventoryFolders: 0, inventoryItems: 0 });
  const [showToast, setShowToast] = useState(true);

  // Derive task completion from real Supabase counts, not from click state
  const doneMap = {
    locations_done: taskCounts.locations > 0,
    inventory_done: taskCounts.inventoryFolders > 0,
    import_done: taskCounts.inventoryItems > 0,
  };
  const completed = TUTORIAL_ITEMS.filter((item) => doneMap[item.id]).length;
  const percent = Math.round((completed / TUTORIAL_ITEMS.length) * 100);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    checkSession();
  }, []);

  // Inject Cargo animation keyframes once
  useEffect(() => {
    const styleId = 'cargo-dashboard-anim';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes cgToastIn { from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: translateX(0); } }
        @keyframes cgFadeSlideUp { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: translateY(0); } }
        .cg-toast-in { animation: cgToastIn 350ms cubic-bezier(.2,.7,.2,1) both; }
        .cg-anim-enter { animation: cgFadeSlideUp 520ms cubic-bezier(.2,.7,.2,1) both; }
        .cg-stagger > * { animation-delay: calc(var(--i, 0) * 40ms); }
        @keyframes cgAttentionPulse { 0%,100% { background-color: rgba(0,168,204,0); } 50% { background-color: rgba(0,168,204,0.08); } }
        .cg-attention-pulse { animation: cgAttentionPulse 2400ms ease-in-out infinite; border-radius: 8px; padding: 6px 10px; margin: -6px -10px; transition: background-color 0.3s; }
        .cg-restore-pill { transition: background-color 150ms ease, color 150ms ease; }
        .cg-restore-pill:hover { background-color: #1E3A5F !important; color: white !important; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const loadTaskCounts = async (tenantId) => {
    if (!tenantId) return;
    try {
      const [{ count: locCount }, { count: folderCount }, { count: itemCount }] = await Promise.all([
        supabase.from('vessel_locations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_archived', false),
        supabase.from('inventory_locations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_archived', false),
        supabase.from('inventory_items').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      ]);
      setTaskCounts({
        locations: locCount ?? 0,
        inventoryFolders: folderCount ?? 0,
        inventoryItems: itemCount ?? 0,
      });
    } catch (err) {
      console.warn('[dashboard] task counts load failed', err);
    }
  };

  const loadTutorialData = async (userId, tenantId) => {
    try {
      const [{ data: profile }, { data: tenant }] = await Promise.all([
        supabase.from('profiles').select('dashboard_tutorial_dismissed_at').eq('id', userId).maybeSingle(),
        supabase.from('tenants').select('onboarding_completed_at, name').eq('id', tenantId).maybeSingle(),
      ]);
      if (tenant?.name) setVesselName(tenant.name);
      if (tenant?.onboarding_completed_at) {
        const msAgo = Date.now() - new Date(tenant.onboarding_completed_at).getTime();
        const within30days = msAgo < 30 * 24 * 60 * 60 * 1000;
        const dismissed = !!profile?.dashboard_tutorial_dismissed_at;
        setTutorialDismissed(within30days && dismissed);
        setShowOnboardingTutorial(within30days && !dismissed);
      }
    } catch (err) {
      console.warn('[dashboard] tutorial data load failed', err);
    }
  };

  const handleTutorialStart = (item) => {
    navigate(item.route);
  };

  const handleDismissTutorial = async () => {
    setShowOnboardingTutorial(false);
    setTutorialDismissed(true);
    setTutorialPillHidden(false);
    localStorage.removeItem('cg_tutorial_pill_hidden');
    try {
      await supabase.from('profiles').update({ dashboard_tutorial_dismissed_at: new Date().toISOString() }).eq('id', session?.user?.id);
    } catch (err) {
      console.warn('[dashboard] tutorial dismiss save failed', err);
    }
  };

  const handleRestoreTutorial = async () => {
    setTutorialDismissed(false);
    setShowOnboardingTutorial(true);
    try {
      await supabase.from('profiles').update({ dashboard_tutorial_dismissed_at: null }).eq('id', session?.user?.id);
    } catch (err) {
      console.warn('[dashboard] tutorial restore failed', err);
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
        loadTutorialData(currentSession?.user?.id, tenantId),
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
            onAddInventory={() => navigate('/folder-based-inventory-dashboard')}
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

        <div className="max-w-[1600px] mx-auto p-6">
          {/* Restore pill — shown when tutorial was dismissed (within 30-day window) */}
          {tutorialDismissed && !tutorialPillHidden && (
            <div className="flex justify-end mb-4">
              <div className="inline-flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={handleRestoreTutorial}
                  className="cg-restore-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border"
                  style={{ borderColor: NAVY, color: NAVY, fontFamily: PILL_FONT, fontWeight: 900, fontSize: 11, letterSpacing: '0.10em', textTransform: 'uppercase' }}
                >
                  <Anchor size={11} /> Show onboarding tour
                </button>
                <button
                  type="button"
                  onClick={() => { setTutorialPillHidden(true); localStorage.setItem('cg_tutorial_pill_hidden', '1'); }}
                  className="p-1 rounded-full hover:bg-slate-100 ml-0.5"
                  style={{ color: '#94A3B8' }}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}

          {/* Onboarding tutorial — shown for 30 days after completing onboarding */}
          {showOnboardingTutorial && (() => {
            const remaining = TUTORIAL_ITEMS.filter((item) => !doneMap[item.id]).length;
            return (
              <div className="mb-10">
                <div
                  className="rounded-2xl px-8 py-8"
                  style={{
                    position: 'relative',
                    overflow: 'visible',
                    backgroundColor: '#FFFFFF',
                    borderTop: `1px solid ${NAVY}`,
                    borderLeft: `1px solid ${NAVY}`,
                    borderRight: `1px solid ${NAVY}`,
                    borderBottom: `4px solid ${NAVY}`,
                  }}
                >
                  {showToast && <WelcomeToast onDismiss={() => setShowToast(false)} />}
                  {/* Top row: chain + heading + percent */}
                  <div className="flex gap-6 items-start">
                    <div className="flex-shrink-0">
                      <AnchorChainProgress percent={percent} width={140} height={340} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h1 style={{ fontFamily: HEADING_FONT, fontSize: 26, fontWeight: 700, color: CHARCOAL, letterSpacing: '-0.02em' }}>
                        {vesselName ? `Welcome aboard ${vesselName}` : 'Welcome, Captain'}
                      </h1>
                      <div className="mt-4 flex items-baseline gap-3">
                        <span className="uppercase" style={{ fontFamily: PILL_FONT, fontSize: 22, fontWeight: 900, letterSpacing: '0.10em', color: NAVY }}>
                          Onboarding
                        </span>
                        <span style={{ fontFamily: HEADING_FONT, fontSize: 22, fontWeight: 700, color: CHARCOAL }}>
                          <LivePercent percent={percent} />%
                        </span>
                      </div>
                      <p className="text-xs mt-1" style={{ color: '#64748B', fontFamily: BODY_FONT }}>
                        {percent === 100 ? 'Fully anchored.' : 'Only a few more shackles to go…'}
                      </p>
                      <button
                        type="button"
                        onClick={handleDismissTutorial}
                        className="mt-4 text-xs underline underline-offset-2"
                        style={{ color: '#94A3B8', fontFamily: BODY_FONT }}
                      >
                        Hide for now
                      </button>
                    </div>
                  </div>

                  {/* Collapsible: Finish setting up — open by default */}
                  <CollapsiblePanel
                    title="Finish setting up"
                    badge={remaining > 0 ? `${remaining} left` : null}
                    defaultOpen
                    pulse={remaining > 0}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 cg-stagger">
                      {TUTORIAL_ITEMS.map((item, i) => (
                        <div key={item.id} className="cg-anim-enter" style={{ '--i': i + 1 }}>
                          <TutorialCard item={item} done={doneMap[item.id]} onStart={() => handleTutorialStart(item)} />
                        </div>
                      ))}
                    </div>
                  </CollapsiblePanel>

                  {/* Collapsible: What else is in Cargo — collapsed by default */}
                  <CollapsiblePanel title="What else is in Cargo" defaultOpen={false} pulse>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 cg-stagger">
                      {CARGO_FEATURES.map((f, i) => (
                        <div key={f.name} className="cg-anim-enter" style={{ '--i': i + 4 }}>
                          <FeatureTile feature={f} />
                        </div>
                      ))}
                    </div>
                  </CollapsiblePanel>
                </div>
              </div>
            );
          })()}

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

          {/* Customise Layout — bottom of page, right-aligned */}
          <div className="flex justify-end mt-8">
            <button
              onClick={() => setIsEditing((v) => !v)}
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

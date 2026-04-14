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
import { Settings2, Anchor, Sparkles, X, Check, MapPin, FolderTree, Upload, ArrowRight, Wrench, Briefcase } from 'lucide-react';

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
    id: 'locations',
    title: 'Set up vessel locations',
    desc: 'Map out your vessel — decks, cabins, storage rooms, lockers. Nest locations as needed. Everything in inventory sits under a location.',
    icon: MapPin,
    cta: 'Open Locations',
    route: '/vessel-settings',
  },
  {
    id: 'folders',
    title: 'Build your inventory folders',
    desc: 'Organise inventory into folders that mirror how your crew works — by department, usage, or physical zone.',
    icon: FolderTree,
    cta: 'Open Inventory',
    route: '/folder-based-inventory-dashboard',
  },
  {
    id: 'upload',
    title: 'Upload your first inventory file',
    desc: "Got a spreadsheet from the last handover? Drop it in and Cargo will parse, de-dup, and auto-assign items into folders.",
    icon: Upload,
    cta: 'Import items',
    route: '/folder-based-inventory-dashboard',
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

const AnchorChainProgress = ({ percent }) => {
  const height = 180;
  const [dropped, setDropped] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDropped(percent), 120);
    return () => clearTimeout(t);
  }, [percent]);
  const anchorTop = Math.max(0, Math.min(100, dropped)) / 100 * (height - 40);
  return (
    <div className="relative" style={{ width: 48, height }}>
      <div
        className="absolute left-1/2 -translate-x-1/2 top-0 rounded-[3px]"
        style={{ width: 22, height: 10, backgroundColor: NAVY }}
      />
      {(() => {
        const linkCount = Math.max(0, Math.floor(anchorTop / 10));
        const chainH = linkCount * 10;
        return (
          <svg
            className="absolute left-1/2 -translate-x-1/2"
            style={{ top: 10, width: 14, height: chainH, transition: 'height 1400ms cubic-bezier(.34,1.2,.64,1)' }}
            viewBox={`0 0 14 ${Math.max(chainH, 1)}`}
            preserveAspectRatio="none"
          >
            {Array.from({ length: linkCount }).map((_, i) => (
              <ellipse key={i} cx="7" cy={i * 10 + 5} rx="4" ry="5" fill="none" stroke={NAVY} strokeWidth="1.6" />
            ))}
          </svg>
        );
      })()}
      <div
        className="absolute left-1/2 -translate-x-1/2 cg-anchor-sway flex items-start justify-center"
        style={{
          top: Math.max(0, Math.floor(anchorTop / 10) * 10) + 4,
          width: 40,
          height: 40,
          transition: 'top 1400ms cubic-bezier(.34,1.2,.64,1)',
          transformOrigin: 'top center',
        }}
      >
        <Anchor size={32} color={NAVY} strokeWidth={2.25} />
      </div>
    </div>
  );
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
          <h3 style={{ fontFamily: HEADING_FONT, fontSize: 16, fontWeight: 700, color: CHARCOAL }}>{item.title}</h3>
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
            <p
              className="mt-3 inline-flex items-center gap-1.5 text-xs"
              style={{ color: '#047857', fontFamily: PILL_FONT, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}
            >
              <Check size={12} /> Done
            </p>
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
    className="fixed top-4 right-4 max-w-sm rounded-xl p-4 flex items-start gap-3 z-50 cg-toast-in"
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
  const [tutorialState, setTutorialState] = useState({});
  const [showToast, setShowToast] = useState(true);

  const completed = Object.values(tutorialState).filter(Boolean).length;
  const percent = Math.round(((3 + completed) / 6) * 100);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    checkSession();
  }, []);

  // Inject Cargo animation keyframes once (sway + toast-in)
  useEffect(() => {
    const styleId = 'cargo-dashboard-anim';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes cgSway { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
        @keyframes cgToastIn { from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: translateX(0); } }
        @keyframes cgFadeSlideUp { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: translateY(0); } }
        .cg-anchor-sway { animation: cgSway 2800ms ease-in-out infinite; }
        .cg-toast-in { animation: cgToastIn 350ms cubic-bezier(.2,.7,.2,1) both; }
        .cg-anim-enter { animation: cgFadeSlideUp 520ms cubic-bezier(.2,.7,.2,1) both; }
        .cg-stagger > * { animation-delay: calc(var(--i, 0) * 40ms); }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const loadTutorialData = async (userId, tenantId) => {
    try {
      const [{ data: profile }, { data: tenant }] = await Promise.all([
        supabase.from('profiles').select('onboarding_tutorial_state, dashboard_tutorial_dismissed_at').eq('id', userId).maybeSingle(),
        supabase.from('tenants').select('onboarding_completed_at, name').eq('id', tenantId).maybeSingle(),
      ]);
      if (tenant?.name) setVesselName(tenant.name);
      if (tenant?.onboarding_completed_at) {
        const msAgo = Date.now() - new Date(tenant.onboarding_completed_at).getTime();
        const within30days = msAgo < 30 * 24 * 60 * 60 * 1000;
        const dismissed = !!profile?.dashboard_tutorial_dismissed_at;
        setShowOnboardingTutorial(within30days && !dismissed);
      }
      setTutorialState(profile?.onboarding_tutorial_state || {});
    } catch (err) {
      console.warn('[dashboard] tutorial data load failed', err);
    }
  };

  const handleTutorialStart = async (item) => {
    const newState = { ...tutorialState, [item.id]: true };
    setTutorialState(newState);
    try {
      await supabase.from('profiles').update({ onboarding_tutorial_state: newState }).eq('id', session?.user?.id);
    } catch (err) {
      console.warn('[dashboard] tutorial state save failed', err);
    }
    navigate(item.route);
  };

  const handleDismissTutorial = async () => {
    setShowOnboardingTutorial(false);
    try {
      await supabase.from('profiles').update({ dashboard_tutorial_dismissed_at: new Date().toISOString() }).eq('id', session?.user?.id);
    } catch (err) {
      console.warn('[dashboard] tutorial dismiss save failed', err);
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
      await loadVesselData(tenantId);
      await loadTutorialData(currentSession?.user?.id, tenantId);
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
          {/* Onboarding tutorial — shown for 30 days after completing onboarding */}
          {showOnboardingTutorial && (
            <div className="mb-10">
              {/* Hero card — 4px bottom border */}
              <div
                className="rounded-2xl px-8 py-8 flex gap-6 items-start mb-8"
                style={{
                  backgroundColor: '#FFFFFF',
                  borderTop: `1px solid ${NAVY}`,
                  borderLeft: `1px solid ${NAVY}`,
                  borderRight: `1px solid ${NAVY}`,
                  borderBottom: `4px solid ${NAVY}`,
                }}
              >
                <div className="flex-shrink-0">
                  <AnchorChainProgress percent={percent} />
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
                    Hide this section
                  </button>
                </div>
              </div>

              {/* Tutorial cards */}
              <p className="uppercase text-xs mb-4" style={{ fontFamily: PILL_FONT, fontWeight: 900, letterSpacing: '0.10em', color: '#94A3B8' }}>
                Finish setting up
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 cg-stagger mb-8">
                {TUTORIAL_ITEMS.map((item, i) => (
                  <div key={item.id} className="cg-anim-enter" style={{ '--i': i + 1 }}>
                    <TutorialCard item={item} done={!!tutorialState[item.id]} onStart={() => handleTutorialStart(item)} />
                  </div>
                ))}
              </div>

              {/* Feature tiles */}
              <p className="uppercase text-xs mb-4" style={{ fontFamily: PILL_FONT, fontWeight: 900, letterSpacing: '0.10em', color: '#94A3B8' }}>
                What else is in Cargo
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 cg-stagger">
                {CARGO_FEATURES.map((f, i) => (
                  <div key={f.name} className="cg-anim-enter" style={{ '--i': i + 4 }}>
                    <FeatureTile feature={f} />
                  </div>
                ))}
              </div>
            </div>
          )}

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

        {/* Welcome toast */}
        {showOnboardingTutorial && showToast && (
          <WelcomeToast onDismiss={() => setShowToast(false)} />
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

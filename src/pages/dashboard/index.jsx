import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
import { Settings2, Anchor, Sparkles, X, Check, MapPin, Upload, Wrench, Briefcase, ChevronRight } from 'lucide-react';

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
import { ONBOARDING_TASKS, getNextTask, getCurrentStep } from './onboardingTasks';
import { useAuth } from '../../contexts/AuthContext';
import CrewDashboardCard from './components/CrewDashboardCard';

// ── Brand tokens (match onboarding Cargo palette) ────────────────────────────
const NAVY      = '#1E3A5F';
const ACCENT    = '#00A8CC';
const CHARCOAL  = '#1A202C';
const HEADING_FONT = "'Outfit', system-ui, sans-serif";
const BODY_FONT    = "'Plus Jakarta Sans', system-ui, sans-serif";
const PILL_FONT    = "'Archivo', system-ui, sans-serif";

// ── Onboarding panel brand constants ─────────────────────────────────────────
const BRAND = { navy: '#1E3A5F', accent: '#00A8CC', mute: '#64748B' };

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


const StatTile = ({ label, value }) => (
  <div style={{ backgroundColor: '#F1F5F9', borderRadius: 10, padding: '12px 14px' }}>
    <div style={{ fontFamily: HEADING_FONT, fontSize: 22, fontWeight: 900, color: NAVY, letterSpacing: '-0.02em', lineHeight: 1 }}>
      {value}
    </div>
    <div style={{ fontFamily: PILL_FONT, fontSize: 10, fontWeight: 800, color: '#64748B', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 4 }}>
      {label}
    </div>
  </div>
);

// ── StatusPill ────────────────────────────────────────────────────────────────
const STATUS_STYLES = {
  done:    { background: '#DCFCE7', color: '#166534', label: 'Done' },
  skipped: { background: '#F1F5F9', color: '#64748B', label: 'Skipped' },
  todo:    { background: '#E0F2FE', color: '#0369A1', label: 'To do' },
};

const StatusPill = ({ status }) => {
  const s = STATUS_STYLES[status];
  return (
    <span
      style={{
        background: s.background,
        color: s.color,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: PILL_FONT,
        letterSpacing: '0.06em',
        padding: '3px 9px',
        borderRadius: 99,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {s.label}
    </span>
  );
};

// ── NextUp card — soft-blue wash (Option B) ───────────────────────────────────
const WASH_CONTAINER = {
  padding: '18px 22px',
  borderRadius: 12,
  background: 'linear-gradient(135deg, #F0F9FF 0%, #E0F2FE 100%)',
  border: '1px solid #BAE6FD',
};

const NextUp = ({ ctx, tenant, onSkip, onUnskip }) => {
  const [showAll, setShowAll] = useState(false);
  const next = getNextTask(ctx, tenant);

  // Expanded list view
  if (showAll) {
    return (
      <div style={{ marginTop: 18, ...WASH_CONTAINER }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: BRAND.mute,
            fontFamily: PILL_FONT,
            fontWeight: 800,
            marginBottom: 12,
          }}
        >
          All onboarding tasks
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ONBOARDING_TASKS.map((t) => {
            const Icon = t.icon;
            const isDone = t.isDone(ctx);
            const isSkipped = (tenant?.dismissed_tasks ?? []).includes(t.key);
            const status = isDone ? 'done' : isSkipped ? 'skipped' : 'todo';
            return (
              <div
                key={t.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  background: 'white',
                  borderRadius: 8,
                }}
              >
                <Icon size={18} color={BRAND.navy} strokeWidth={2} />
                <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: BRAND.navy, fontFamily: HEADING_FONT, minWidth: 0 }}>
                  {t.title}
                </div>
                <StatusPill status={status} />
                {status === 'todo' && (
                  <Link
                    to={t.href}
                    style={{ fontSize: 12, color: BRAND.accent, fontWeight: 700, textDecoration: 'none', fontFamily: PILL_FONT, flexShrink: 0 }}
                  >
                    Start &rarr;
                  </Link>
                )}
                {status === 'skipped' && (
                  <button
                    type="button"
                    onClick={() => onUnskip(t.key)}
                    style={{ fontSize: 12, color: BRAND.mute, background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontFamily: BODY_FONT, flexShrink: 0 }}
                  >
                    Bring back
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setShowAll(false)}
          style={{ marginTop: 12, background: 'none', border: 'none', color: BRAND.mute, fontSize: 12, textDecoration: 'underline', cursor: 'pointer', fontFamily: BODY_FONT }}
        >
          Focus next up
        </button>
      </div>
    );
  }

  // Nothing left to do — all tasks done or dismissed, and not showing expanded
  if (!next) return null;

  const Icon = next.icon;
  const { step, total } = getCurrentStep(next);

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ ...WASH_CONTAINER, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
          }}
        >
          <Icon size={22} color={BRAND.navy} strokeWidth={2.2} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: BRAND.mute,
              fontFamily: PILL_FONT,
              fontWeight: 800,
              marginBottom: 2,
            }}
          >
            Next up &middot; {step}/{total}
          </div>
          <div style={{ fontSize: 16, fontWeight: 900, color: BRAND.navy, letterSpacing: '-0.01em', fontFamily: HEADING_FONT }}>
            {next.title}
          </div>
        </div>

        <Link
          to={next.href}
          style={{
            background: BRAND.navy,
            color: 'white',
            padding: '10px 18px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 800,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            fontFamily: PILL_FONT,
          }}
        >
          {next.key === 'invite_crew' ? 'Invite' : 'Start'} &rarr;
        </Link>

        <button
          type="button"
          onClick={() => onSkip(next.key)}
          style={{
            background: 'transparent',
            border: 'none',
            color: BRAND.mute,
            fontSize: 12,
            textDecoration: 'underline',
            cursor: 'pointer',
            fontFamily: BODY_FONT,
            flexShrink: 0,
          }}
        >
          Skip
        </button>
      </div>

      <button
        type="button"
        onClick={() => setShowAll(true)}
        style={{ marginTop: 8, background: 'none', border: 'none', color: BRAND.mute, fontSize: 11, textDecoration: 'underline', cursor: 'pointer', fontFamily: BODY_FONT }}
      >
        Show all tasks
      </button>
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

// Capitalise the first letter of the vessel name, lowercasing the rest.
// Tenant names are often stored all-uppercase ("MADAME") — display as "Madame".
const displayVesselName = (name) => {
  if (!name) return '';
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
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

  const [isEditing, setIsEditing] = useState(false);
  const [activeId, setActiveId] = useState(null); // widget being dragged

  const { layout, resetLayout, addWidget, removeWidget, moveWidget, hiddenWidgets } =
    useDashboardLayout();

  const [vesselName, setVesselName] = useState('');
  const [showOnboardingTutorial, setShowOnboardingTutorial] = useState(false);
  const [tutorialDismissed, setTutorialDismissed] = useState(false);
  // Admin tutorial auto-hides 30 days after tenant onboarding completes.
  // Crew dismissal has no time window.
  const [adminTutorialWindowOpen, setAdminTutorialWindowOpen] = useState(false);
  const [tutorialPillHidden, setTutorialPillHidden] = useState(
    () => localStorage.getItem('cg_tutorial_pill_hidden') === '1'
  );
  const [taskCounts, setTaskCounts] = useState({ locations: 0, inventoryFolders: 0, inventoryItems: 0, crew: 0, openTasks: 0 });
  const [tenant, setTenant] = useState(null);
  const [showToast, setShowToast] = useState(true);

  // ctx passed to onboardingTasks helpers — mirrors column names in ONBOARDING_TASKS.isDone
  const ctx = {
    locationsCount:      taskCounts.locations,
    foldersCount:        taskCounts.inventoryFolders,
    inventoryItemsCount: taskCounts.inventoryItems,
    crewCount:           taskCounts.crew,
  };
  // Percent for the anchor chain uses how many tasks are genuinely done
  const doneTasks = ONBOARDING_TASKS.filter((t) => t.isDone(ctx)).length;
  const percent = Math.round((doneTasks / ONBOARDING_TASKS.length) * 100);

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
        // team_jobs — status values from TodaySnapshotWidget: 'OPEN' | 'open' | 'Open'
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

  const loadTutorialData = async (userId, tenantId) => {
    try {
      const [{ data: profile }, { data: tenantRow }] = await Promise.all([
        supabase.from('profiles').select('dashboard_tutorial_dismissed_at').eq('id', userId).maybeSingle(),
        // dismissed_tasks may not exist in older DBs — pre-migration resilience: if the column
        // is absent the query still succeeds and dismissed_tasks will be undefined (treated as []).
        supabase.from('tenants').select('onboarding_completed_at, name, dismissed_tasks').eq('id', tenantId).maybeSingle(),
      ]);
      if (tenantRow?.name) setVesselName(tenantRow.name);
      setTenant(tenantRow ?? null);
      // The admin onboarding card auto-hides after 30 days; crew dismissal is
      // sticky forever. Track both signals separately.
      const dismissed = !!profile?.dashboard_tutorial_dismissed_at;
      setTutorialDismissed(dismissed);
      if (tenantRow?.onboarding_completed_at) {
        const msAgo = Date.now() - new Date(tenantRow.onboarding_completed_at).getTime();
        const within30days = msAgo < 30 * 24 * 60 * 60 * 1000;
        setAdminTutorialWindowOpen(within30days);
        setShowOnboardingTutorial(within30days && !dismissed);
      }
    } catch (err) {
      console.warn('[dashboard] tutorial data load failed', err);
    }
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
          {/* Restore pill — shown when tutorial was dismissed AND restore will
               actually bring it back (admin: 30-day window; crew: always). */}
          {tutorialDismissed && !tutorialPillHidden && (isVesselAdmin ? adminTutorialWindowOpen : true) && (
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

          {/* Tutorial banner — admin sees it for 30 days after onboarding;
               crew sees it until they explicitly dismiss ("Hide for now"). */}
          {(isVesselAdmin ? showOnboardingTutorial : !tutorialDismissed) && (() => {
            // Anchor chain is tied to admin onboarding progress; for crew it's
            // purely decorative, so pin it at 100% ("fully anchored").
            const chainPercent = isVesselAdmin ? percent : 100;
            return (
              <div className="mb-10">
                <div
                  className="rounded-2xl px-7 py-5"
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
                  {isVesselAdmin && showToast && <WelcomeToast onDismiss={() => setShowToast(false)} />}
                  {/* Top row: chain + heading + progress/activity label */}
                  <div className="flex gap-6 items-start">
                    <div className="flex-shrink-0">
                      <AnchorChainProgress percent={chainPercent} width={80} height={180} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h1 style={{ fontFamily: HEADING_FONT, fontSize: 26, fontWeight: 700, color: CHARCOAL, letterSpacing: '-0.02em' }}>
                        {vesselName ? `Welcome aboard ${displayVesselName(vesselName)}` : 'Welcome, Captain'}
                      </h1>
                      {isVesselAdmin ? (
                        <>
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
                        </>
                      ) : (
                        <div className="mt-4">
                          <span className="uppercase" style={{ fontFamily: PILL_FONT, fontSize: 22, fontWeight: 900, letterSpacing: '0.10em', color: NAVY }}>
                            Your activity
                          </span>
                        </div>
                      )}
                      {/* At-a-glance stats — admin only. Crew sees their own
                           activity card below; vessel-wide counts aren't useful
                           to them in this banner. */}
                      {isVesselAdmin && (
                        <div className="mt-4 grid grid-cols-2 md:grid-cols-4" style={{ gap: 10 }}>
                          <StatTile label="Crew" value={taskCounts.crew} />
                          <StatTile label="Locations" value={taskCounts.locations} />
                          <StatTile label="Inventory" value={taskCounts.inventoryItems} />
                          <StatTile label="Open Tasks" value={taskCounts.openTasks} />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={handleDismissTutorial}
                        className="mt-3 text-xs underline underline-offset-2"
                        style={{ color: '#94A3B8', fontFamily: BODY_FONT }}
                      >
                        Hide for now
                      </button>
                    </div>
                  </div>

                  {/* Admin: next onboarding step stepper. Crew: hybrid activity card. */}
                  {isVesselAdmin ? (
                    <NextUp
                      ctx={ctx}
                      tenant={tenant}
                      onSkip={handleSkipTask}
                      onUnskip={handleUnskipTask}
                    />
                  ) : (
                    <CrewDashboardCard
                      userId={session?.user?.id}
                      tenantId={activeTenantId}
                    />
                  )}

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

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import Icon from '../AppIcon';
import {
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  clearReadNotifications,
  deleteNotification,
  NOTIFICATION_TYPES,
  SEVERITY,
} from '../../pages/team-jobs-management/utils/notifications';
import { fetchDerivedNotifications } from '../../lib/derivedNotifications';
import {
  fetchDbNotifications,
  markDbNotificationRead,
  markAllDbRead,
  clearDbRead,
  deleteDbNotification,
} from '../../lib/dbNotifications';
import { getActivityLast24Hours } from '../../utils/activityStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { useReviewItems } from '../../pages/reviews/useReviewItems';
import { useProvisioningApprovals } from '../../pages/reviews/useProvisioningApprovals';
import { useCrewRequests } from '../../pages/reviews/useCrewRequests';
import { useSeaTimeSignoffs } from '../../pages/reviews/useSeaTimeSignoffs';
import { fmtDateRange } from '../../pages/reviews/reviewFormat';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabaseClient';
import './alerts-drawer.css';

// AlertsDrawer — a single slide-out panel unifying the three feeds that used to
// live behind separate nav icons: Notifications, Reviews (every approval queue),
// and Activity. Built in the Cargo editorial language (see alerts-drawer.css).

const TAB_DEFS = [
  { key: 'notifications', label: 'Notifications' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'activity', label: 'Activity' },
];

const formatTimestamp = (ts) => {
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }); }
  catch { return 'Recently'; }
};
const absTime = (ts) => {
  try { return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};

// ── Day bucketing (Today / Yesterday / …) for the time-ordered feeds ─────────
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const dayBucketLabel = (ts) => {
  const today = startOfDay(new Date());
  const day = startOfDay(ts || Date.now());
  const diff = Math.round((today - day) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'Earlier this week';
  if (diff < 30) return 'Earlier this month';
  return 'Older';
};
const groupByDay = (items, tsKey = 'createdAt') => {
  const order = [];
  const map = new Map();
  for (const it of items) {
    const label = dayBucketLabel(it[tsKey]);
    if (!map.has(label)) { map.set(label, []); order.push(label); }
    map.get(label).push(it);
  }
  return order.map(l => ({ label: l, items: map.get(l) }));
};

// Longest common prefix of a set of titles — used to name a collapsed group
// ("HOR overdue — Anders" + "HOR overdue — Chief Stew" → "HOR overdue").
const commonPrefix = (strings) => {
  if (!strings.length) return '';
  let p = strings[0];
  for (const s of strings.slice(1)) {
    let i = 0;
    while (i < p.length && i < s.length && p[i] === s[i]) i += 1;
    p = p.slice(0, i);
    if (!p) break;
  }
  return p.replace(/[\s—–\-:•·]+$/, '').trim();
};

const TYPE_LABEL = {
  DOC_EXPIRY: 'Document expiries',
  VESSEL_DOC_EXPIRY: 'Vessel document expiries',
  HOR_REMINDER: 'Hours of Rest reminders',
  HOR_APPROVAL_PENDING: 'Hours of Rest approvals',
  PROVISIONING_APPROVAL_PENDING: 'Provisioning approvals',
};

const Loading = () => (
  <div className="ad-scroll" aria-busy="true" aria-label="Loading">
    {Array.from({ length: 5 }).map((_, i) => (
      <div className="ad-skrow" key={i}>
        <span className="ad-sk ad-sk-ico" />
        <span className="ad-sk-main">
          <span className="ad-sk ad-sk-line" style={{ width: `${70 - i * 6}%` }} />
          <span className="ad-sk ad-sk-line short" style={{ width: `${50 - i * 4}%` }} />
        </span>
      </div>
    ))}
  </div>
);

const EmptyState = ({ icon, label, hint }) => (
  <div className="ad-empty">
    <span className="ad-empty-ic"><Icon name={icon} size={20} color="#B7B1A5" /></span>
    <p>{label}</p>
    {hint && <p className="ad-empty-hint">{hint}</p>}
  </div>
);

// ── Notifications ────────────────────────────────────────────────────────────
const getNotificationIcon = (type) => {
  switch (type) {
    case 'ROTA_ACCEPTED': return 'CheckCircle';
    case 'ROTA_REJECTED': return 'XCircle';
    case 'ROTA_SUBMITTED': return 'Inbox';
    case 'RETURN_CONFIRMED': return 'PackageCheck';
    case 'DOC_EXPIRY': return 'FileWarning';
    case 'VESSEL_DOC_EXPIRY': return 'FileWarning';
    case 'PROVISIONING_APPROVAL_PENDING': return 'Send';
    case 'PROVISIONING_APPROVAL_DECIDED': return 'CheckCircle';
    case 'HOR_APPROVAL_PENDING': return 'ClipboardCheck';
    case NOTIFICATION_TYPES?.JOB_PENDING_ACCEPTANCE: return 'Clock';
    case NOTIFICATION_TYPES?.JOB_HANDOFF_ACCEPTED: return 'CheckCircle';
    case NOTIFICATION_TYPES?.JOB_HANDOFF_DECLINED: return 'XCircle';
    case NOTIFICATION_TYPES?.JOB_ASSIGNED_TO_YOU: return 'UserPlus';
    case NOTIFICATION_TYPES?.JOB_DUE_TODAY: return 'Calendar';
    case NOTIFICATION_TYPES?.JOB_OVERDUE: return 'AlertTriangle';
    case NOTIFICATION_TYPES?.INVENTORY_RESTOCK_ALERT: return 'Package';
    case NOTIFICATION_TYPES?.HOR_REMINDER: return 'Clock';
    case NOTIFICATION_TYPES?.DELIVERY_CROSS_MATCH: return 'PackageCheck';
    case NOTIFICATION_TYPES?.DELIVERY_INBOX_ITEM: return 'Inbox';
    default: return 'Bell';
  }
};
const getNotificationColor = (severity) => {
  switch (severity) {
    case SEVERITY?.URGENT: return '#C9544B';
    case SEVERITY?.WARN: return '#C68A1A';
    case SEVERITY?.INFO:
    default: return '#C65A1A';
  }
};

const NotifRow = ({ n, canAct, sub, onOpen, onMarkRead, onDismiss }) => (
  <div className={`ad-nrow${!n?.isRead ? ' is-unread' : ''}${sub ? ' is-sub' : ''}${canAct ? ' has-acts' : ''}`}>
    <button type="button" className="ad-row" onClick={() => onOpen(n)}>
      <span className="ad-ico"><Icon name={getNotificationIcon(n?.type)} size={16} color={getNotificationColor(n?.severity)} /></span>
      <span className="ad-main">
        <span className="ad-row-top">
          <span className="ad-row-title">{n?.title}</span>
          {!n?.isRead ? <span className="ad-udot" aria-label="Unread" /> : null}
          <span className="ad-time" title={absTime(n?.createdAt)}>{formatTimestamp(n?.createdAt)}</span>
        </span>
        {n?.message && <span className="ad-msg">{n.message}</span>}
      </span>
    </button>
    {canAct && (
      <span className="ad-rowacts">
        {!n?.isRead && (
          <button type="button" className="ad-act" title="Mark read" aria-label="Mark read" onClick={() => onMarkRead(n)}>
            <Icon name="Check" size={15} />
          </button>
        )}
        <button type="button" className="ad-act" title="Dismiss" aria-label="Dismiss" onClick={() => onDismiss(n)}>
          <Icon name="X" size={15} />
        </button>
      </span>
    )}
  </div>
);

const NotifGroup = ({ group, expanded, onToggle, rowProps }) => {
  const label = commonPrefix(group.items.map(i => i.title || '')) || TYPE_LABEL[group.type] || 'Notifications';
  const anyUnread = group.items.some(i => !i.isRead);
  const latest = group.items[0];
  return (
    <>
      <div className={`ad-nrow ad-group${anyUnread ? ' is-unread' : ''}`}>
        <button type="button" className="ad-row" onClick={onToggle} aria-expanded={expanded}>
          <span className="ad-ico"><Icon name={getNotificationIcon(group.type)} size={16} color={getNotificationColor(latest?.severity)} /></span>
          <span className="ad-main">
            <span className="ad-row-top">
              <span className="ad-row-title">{label}</span>
              <span className="ad-groupcount">{group.items.length}</span>
              {anyUnread ? <span className="ad-udot" aria-label="Unread" /> : null}
              <span className="ad-time">{formatTimestamp(latest?.createdAt)}</span>
            </span>
            <span className="ad-msg">{expanded ? 'Hide' : 'Show all'} · latest: {latest?.title}</span>
          </span>
          <span className={`ad-chev${expanded ? ' is-open' : ''}`}><Icon name="ChevronDown" size={16} color="#A29C90" /></span>
        </button>
      </div>
      {expanded && group.items.map(n => <NotifRow key={n.id} n={n} sub {...rowProps(n)} />)}
    </>
  );
};

const NotificationsTab = ({ userId, onNavigate }) => {
  const [filter, setFilter] = useState('unread'); // 'unread' | 'all'
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());

  const load = useCallback(async () => {
    if (!userId) { setItems([]); setLoading(false); return; }
    const unreadOnly = filter === 'unread';
    const local = getUserNotifications(userId, unreadOnly) || [];
    const db = await fetchDbNotifications(userId, { unreadOnly });
    const derived = await fetchDerivedNotifications(userId);
    const visibleDerived = unreadOnly ? derived.filter(d => !d.isRead) : derived;
    const merged = [...local, ...db, ...visibleDerived].sort(
      (a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0),
    );
    setItems(merged);
    setLoading(false);
  }, [userId, filter]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Live: poll + realtime so items arriving while the panel is open show up.
  useEffect(() => {
    if (!userId) return undefined;
    const id = setInterval(load, 30_000);
    const ch = supabase
      .channel(`ad-notif-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, load)
      .subscribe();
    return () => { clearInterval(id); supabase.removeChannel(ch); };
  }, [userId, load]);

  const patch = (id, changes) => setItems(prev => prev.map(n => (n.id === id ? { ...n, ...changes } : n)));
  const remove = (id) => setItems(prev => prev.filter(n => n.id !== id));
  const routeMark = (n) => { if (n._source === 'db') markDbNotificationRead(n.id); else if (n._source !== 'derived') markNotificationRead(n.id); };
  const routeDelete = (n) => { if (n._source === 'db') deleteDbNotification(n.id); else if (n._source !== 'derived') deleteNotification(n.id); };

  const onOpen = (n) => {
    if (!n.isRead) routeMark(n);
    if (n.actionUrl) { onNavigate(n.actionUrl); return; }
    if (!n.isRead) { filter === 'unread' ? remove(n.id) : patch(n.id, { isRead: true }); }
  };
  const onMarkRead = (n) => { routeMark(n); filter === 'unread' ? remove(n.id) : patch(n.id, { isRead: true }); };
  const onDismiss = (n) => { routeDelete(n); remove(n.id); };
  const rowProps = (n) => ({ canAct: n._source !== 'derived', onOpen, onMarkRead, onDismiss });

  const collapseByType = (list) => {
    const byType = new Map();
    for (const n of list) { const k = n.type || 'other'; if (!byType.has(k)) byType.set(k, []); byType.get(k).push(n); }
    const seen = new Set();
    const out = [];
    for (const n of list) {
      const k = n.type || 'other';
      if (seen.has(k)) continue;
      seen.add(k);
      const grp = byType.get(k);
      if (grp.length >= 3) out.push({ kind: 'group', type: k, items: grp });
      else grp.forEach(g => out.push({ kind: 'single', item: g }));
    }
    return out;
  };

  const sections = useMemo(
    () => groupByDay(items).map(b => ({ label: b.label, entries: collapseByType(b.items) })),
    [items],
  );
  const unreadTotal = useMemo(() => items.filter(n => !n.isRead).length, [items]);

  return (
    <>
      <div className="ad-toolbar">
        <div className="ad-seg" role="group" aria-label="Filter notifications">
          {['unread', 'all'].map(f => (
            <button key={f} className={`ad-seg-btn${filter === f ? ' is-active' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'unread' ? 'Unread' : 'All'}
            </button>
          ))}
        </div>
        <div className="ad-actions">
          <button className="ad-iconbtn" title="Mark all read" aria-label="Mark all read" onClick={async () => { markAllNotificationsRead(userId); await markAllDbRead(userId); load(); }} disabled={items.length === 0}>
            <Icon name="CheckCheck" size={16} />
          </button>
          <button className="ad-iconbtn" title="Clear read" aria-label="Clear read" onClick={async () => { clearReadNotifications(userId); await clearDbRead(userId); load(); }} disabled={items.length === 0}>
            <Icon name="Trash2" size={16} />
          </button>
        </div>
      </div>

      {loading ? <Loading />
        : items.length === 0 ? (
          <EmptyState icon={filter === 'unread' ? 'Check' : 'Bell'} label={filter === 'unread' ? "You're all caught up" : 'No notifications yet'} hint={filter === 'unread' ? 'No unread notifications.' : undefined} />
        ) : (
          <div className="ad-scroll">
            {filter === 'all' && <div className="ad-summary">{unreadTotal} unread · {items.length} total</div>}
            {sections.map(sec => (
              <div className="ad-section" key={sec.label}>
                <div className="ad-daylabel">{sec.label}</div>
                {sec.entries.map((e, i) => e.kind === 'group'
                  ? (
                    <NotifGroup
                      key={`${sec.label}:${e.type}`}
                      group={e}
                      expanded={expanded.has(`${sec.label}:${e.type}`)}
                      onToggle={() => setExpanded(prev => { const s = new Set(prev); const k = `${sec.label}:${e.type}`; s.has(k) ? s.delete(k) : s.add(k); return s; })}
                      rowProps={rowProps}
                    />
                  )
                  : <NotifRow key={e.item.id || i} n={e.item} {...rowProps(e.item)} />)}
              </div>
            ))}
          </div>
        )}
    </>
  );
};

// ── Reviews (unified: rotas + provisioning orders + sea-time sign-offs) ───────
const ReviewsTab = ({ onNavigate }) => {
  const { currentTenantMember, activeTenantId } = useTenant();
  const { user: authUser } = useAuth();
  const tier = currentTenantMember?.permission_tier;
  const tenantId = activeTenantId || currentTenantMember?.tenant_id || null;
  const signerName = currentTenantMember?.full_name || authUser?.user_metadata?.full_name || null;

  const rota = useReviewItems('pending');
  const prov = useProvisioningApprovals();
  const crew = useCrewRequests();
  const sea = useSeaTimeSignoffs(tier === 'COMMAND' ? tenantId : null, signerName);

  const loading = rota.loading || prov.loading || crew.loading || sea.loading;
  const items = useMemo(() => {
    const out = [];
    for (const it of rota.items || []) out.push({
      key: `rota:${it.id}`, cat: 'Rota', icon: 'ClipboardCheck', title: it.department_name || 'Rota', sub: it.rota_name || '',
      meta: [fmtDateRange(it.date_start, it.date_end) || `${it.day_count} day${it.day_count === 1 ? '' : 's'}`, `by ${it.submitter_name || 'crew'}${it.submitter_role ? ` · ${it.submitter_role}` : ''}`],
      time: it.created_at, nav: `/reviews/rotas?selected=${it.id}`,
    });
    for (const it of prov.items || []) out.push({
      key: `ord:${it.id}`, cat: 'Order', icon: 'ShoppingCart', title: it.board_title || 'Order', sub: it.primary_dept || '',
      meta: [it.is_re_approval ? 'Re-approval' : 'Approval', `by ${it.submitter_name || 'someone'}`],
      time: it.created_at, nav: `/reviews/orders?selected=${it.id}`,
    });
    for (const it of crew.items || []) out.push({
      key: `crew:${it.id}`, cat: 'Crew request', icon: 'UserCog', title: it.requester?.full_name || 'Crew member', sub: 'Notification email',
      meta: [`to ${it.requested_email}`],
      time: it.requested_at, nav: `/reviews/crew-requests?selected=${it.id}`,
    });
    for (const it of sea.items || []) out.push({
      key: `st:${it.id}`, cat: 'Sea-time', icon: 'Anchor', title: it.seafarer?.fullName || 'Seafarer', sub: it.unit?.name || it.unit?.vesselName || 'Sea service',
      meta: [`${it.unit?.periods?.length || 0} day${(it.unit?.periods?.length || 0) === 1 ? '' : 's'}`, it.unit?.cmdLabel || 'Sign-off'],
      time: it.requestedAt, nav: `/reviews/seatime?selected=${it.id}`,
    });
    return out.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
  }, [rota.items, prov.items, crew.items, sea.items]);

  return (
    <>
      {loading && items.length === 0 ? <Loading />
        : items.length === 0 ? (
          <EmptyState icon="Check" label="Nothing to review" hint="Approvals routed to you will appear here." />
        ) : (
          <div className="ad-scroll">
            {items.map((it) => (
              <button key={it.key} type="button" className="ad-row" onClick={() => onNavigate(it.nav)}>
                <span className="ad-ico"><Icon name={it.icon} size={16} color="#C65A1A" /></span>
                <span className="ad-main">
                  <span className="ad-row-top">
                    <span className="ad-titlewrap">
                      <span className="ad-row-title">{it.title}</span>
                      <span className="ad-cat">{it.cat}</span>
                    </span>
                    <span className="ad-time" title={absTime(it.time)}>{formatTimestamp(it.time)}</span>
                  </span>
                  {it.sub && <span className="ad-sub">{it.sub}</span>}
                  <span className="ad-meta">{it.meta.filter(Boolean).join('  ·  ')}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      <div className="ad-foot">
        <button className="ad-foot-link" onClick={() => onNavigate('/reviews')}>
          <span>Open Reviews</span>
          <Icon name="ChevronRight" size={16} />
        </button>
      </div>
    </>
  );
};

// ── Activity ─────────────────────────────────────────────────────────────────
const getActionIcon = (action) => {
  if (action?.includes('CREATED')) return 'Plus';
  if (action?.includes('UPDATED')) return 'Edit';
  if (action?.includes('DELETED')) return 'Trash2';
  if (action?.includes('COMPLETED')) return 'CheckCircle';
  if (action?.includes('ACCEPTED')) return 'Check';
  if (action?.includes('DECLINED')) return 'X';
  if (action?.includes('ASSIGNED')) return 'UserPlus';
  if (action?.includes('STOCK')) return 'TrendingUp';
  if (action?.includes('IMPORT')) return 'Upload';
  return 'Activity';
};
const MODULE_ROUTE = { jobs: '/team-jobs-management', inventory: '/inventory', defects: '/defects' };

const ActivityTab = ({ onNavigate }) => {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const user = getCurrentUser();
      const events = await getActivityLast24Hours(user, {}, true);
      setActivities((events || []).slice(0, 40));
    } catch (err) {
      console.error('[AlertsDrawer] activity load error:', err);
      setActivities([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { setLoading(true); load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);

  const sections = useMemo(() => groupByDay(activities, 'createdAt'), [activities]);

  return (
    <>
      {loading ? <Loading />
        : activities.length === 0 ? (
          <EmptyState icon="Activity" label="Nothing in the last 24 hours" hint="Jobs, inventory and defect changes show up here." />
        ) : (
          <div className="ad-scroll">
            {sections.map(sec => (
              <div className="ad-section" key={sec.label}>
                <div className="ad-daylabel">{sec.label}</div>
                {sec.items.map((a, i) => {
                  const route = MODULE_ROUTE[a?.module] || '/activity';
                  return (
                    <button key={`${a?.id}-${i}`} type="button" className="ad-row" onClick={() => onNavigate(route)}>
                      <span className="ad-ico"><Icon name={getActionIcon(a?.action)} size={16} color="#8B8478" /></span>
                      <span className="ad-main">
                        <span className="ad-row-title">{a?.summary}</span>
                        <span className="ad-meta">
                          <span className="ad-cap">{a?.module}</span>
                          <span className="ad-sep">·</span>
                          <span>{a?.actorName}</span>
                          <span className="ad-sep">·</span>
                          <span title={absTime(a?.createdAt)}>{formatTimestamp(a?.createdAt)}</span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      <div className="ad-foot">
        <button className="ad-foot-link" onClick={() => onNavigate('/activity')}>
          <span>View all activity</span>
          <Icon name="ChevronRight" size={16} />
        </button>
      </div>
    </>
  );
};

// ── Drawer shell (a11y: dialog, escape, focus trap/restore, roving tabs) ──────
const AlertsDrawer = ({ isOpen, onClose, initialTab = 'notifications', reviewsCount = 0, notificationsCount = 0 }) => {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab);
  const panelRef = useRef(null);
  const tablistRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => { if (isOpen) setActiveTab(initialTab); }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return undefined;
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    const t = setTimeout(() => {
      (panel?.querySelector('[data-autofocus]') || panel?.querySelector('button'))?.focus();
    }, 0);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key === 'Tab' && panel) {
        const list = Array.from(panel.querySelectorAll('button, [href], input, [tabindex]'))
          .filter(el => !el.disabled && el.offsetParent !== null && el.tabIndex !== -1);
        if (!list.length) return;
        const first = list[0]; const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      restoreRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  const handleNavigate = useCallback((path) => { navigate(path); onClose(); }, [navigate, onClose]);

  const onTabKeyDown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = TAB_DEFS.findIndex(t => t.key === activeTab);
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = TAB_DEFS[(idx + dir + TAB_DEFS.length) % TAB_DEFS.length];
    setActiveTab(next.key);
    tablistRef.current?.querySelector(`#ad-tab-${next.key}`)?.focus();
  };

  if (!isOpen) return null;
  const tabCount = { reviews: reviewsCount, notifications: notificationsCount };

  return (
    <div className="ad">
      <div className="ad-overlay" onClick={onClose} />
      <aside className="ad-panel" role="dialog" aria-modal="true" aria-label="Notifications, reviews and activity" ref={panelRef}>
        <div className="ad-tabs" role="tablist" aria-label="Inbox sections" ref={tablistRef} onKeyDown={onTabKeyDown}>
          <div className="ad-tabgroup">
            {TAB_DEFS.map(t => {
              const active = activeTab === t.key;
              const count = tabCount[t.key] || 0;
              return (
                <button
                  key={t.key}
                  id={`ad-tab-${t.key}`}
                  role="tab"
                  aria-selected={active}
                  aria-controls="ad-tabpanel"
                  tabIndex={active ? 0 : -1}
                  data-autofocus={active ? '' : undefined}
                  className={`ad-tab${active ? ' is-active' : ''}`}
                  onClick={() => setActiveTab(t.key)}
                >
                  <span>{t.label}</span>
                  {count > 0 && <span className="ad-tab-count">{count > 99 ? '99+' : count}</span>}
                </button>
              );
            })}
          </div>
          <button className="ad-x" onClick={onClose} aria-label="Close">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="ad-tabbody" id="ad-tabpanel" role="tabpanel" aria-labelledby={`ad-tab-${activeTab}`}>
          {activeTab === 'notifications' && <NotificationsTab userId={authUser?.id} onNavigate={handleNavigate} />}
          {activeTab === 'reviews' && <ReviewsTab onNavigate={handleNavigate} />}
          {activeTab === 'activity' && <ActivityTab onNavigate={handleNavigate} />}
        </div>
      </aside>
    </div>
  );
};

export default AlertsDrawer;

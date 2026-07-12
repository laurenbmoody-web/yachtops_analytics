import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import Icon from '../AppIcon';
import Button from '../ui/Button';
import LogoSpinner from '../LogoSpinner';
import {
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  clearReadNotifications,
  NOTIFICATION_TYPES,
  SEVERITY,
} from '../../pages/team-jobs-management/utils/notifications';
import { fetchDerivedNotifications } from '../../lib/derivedNotifications';
import {
  fetchDbNotifications,
  markDbNotificationRead,
  markAllDbRead,
  clearDbRead,
} from '../../lib/dbNotifications';
import { getActivityLast24Hours } from '../../utils/activityStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { useReviewItems } from '../../pages/reviews/useReviewItems';
import { fmtDateRange } from '../../pages/reviews/reviewFormat';
import { useAuth } from '../../contexts/AuthContext';

// AlertsDrawer — a single slide-out panel that unifies the three feeds that
// used to live behind separate nav icons: Notifications, Reviews (the approvals
// inbox), and the Activity feed. Tabs switch between them; each tab links out
// to its full page for the deeper workflow. Replaces NotificationsDrawer and
// the old Activity / Reviews nav buttons.

const TABS = [
  { key: 'notifications', label: 'Notifications', icon: 'Bell' },
  { key: 'reviews', label: 'Reviews', icon: 'Inbox' },
  { key: 'activity', label: 'Activity', icon: 'Activity' },
];

const formatTimestamp = (timestamp) => {
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return 'Recently';
  }
};

// ── Notifications tab ──────────────────────────────────────────────────────
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
    case SEVERITY?.URGENT: return 'var(--color-error)';
    case SEVERITY?.WARN: return 'var(--color-warning)';
    case SEVERITY?.INFO:
    default: return 'var(--color-primary)';
  }
};

const NotificationsTab = ({ userId, onNavigate }) => {
  const [filter, setFilter] = useState('unread'); // 'unread' | 'all'
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setNotifications([]); setLoading(false); return; }
    setLoading(true);
    const unreadOnly = filter === 'unread';
    const local = getUserNotifications(userId, unreadOnly) || [];
    const db = await fetchDbNotifications(userId, { unreadOnly });
    const derived = await fetchDerivedNotifications(userId);
    const visibleDerived = unreadOnly ? derived.filter(d => !d.isRead) : derived;
    const merged = [...local, ...db, ...visibleDerived].sort(
      (a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0),
    );
    setNotifications(merged);
    setLoading(false);
  }, [userId, filter]);

  useEffect(() => { load(); }, [load]);

  const handleClick = (n) => {
    if (!n?.isRead) {
      if (n?._source === 'db') markDbNotificationRead(n?.id);
      else markNotificationRead(n?.id);
    }
    if (n?.actionUrl) onNavigate(n.actionUrl);
  };

  const handleMarkAllRead = async () => {
    if (!userId) return;
    markAllNotificationsRead(userId);
    await markAllDbRead(userId);
    load();
  };

  const handleClearRead = async () => {
    if (!userId) return;
    clearReadNotifications(userId);
    await clearDbRead(userId);
    load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-1.5">
          {['unread', 'all'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-smooth ${
                filter === f ? 'text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
              style={filter === f ? { background: '#C65A1A' } : undefined}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={handleMarkAllRead} disabled={notifications.length === 0}>
            <Icon name="CheckCheck" size={15} />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClearRead} disabled={notifications.length === 0}>
            <Icon name="Trash2" size={15} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <LogoSpinner size={28} />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Icon name="Bell" size={40} color="var(--color-muted-foreground)" />
            <p className="text-muted-foreground mt-3 text-sm">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((n) => (
              <div
                key={n?.id}
                onClick={() => handleClick(n)}
                className={`p-4 cursor-pointer hover:bg-muted/50 transition-smooth ${!n?.isRead ? 'bg-primary/5' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <Icon name={getNotificationIcon(n?.type)} size={18} color={getNotificationColor(n?.severity)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{n?.title}</h3>
                      {!n?.isRead && <span className="flex-shrink-0 w-2 h-2 rounded-full mt-1" style={{ background: '#C65A1A' }} />}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{n?.message}</p>
                    <p className="text-xs text-muted-foreground mt-2">{formatTimestamp(n?.createdAt)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Reviews tab ────────────────────────────────────────────────────────────
const ReviewsTab = ({ onNavigate }) => {
  const { items, loading } = useReviewItems('pending');

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <LogoSpinner size={28} />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Icon name="Inbox" size={40} color="var(--color-muted-foreground)" />
            <p className="text-muted-foreground mt-3 text-sm">Nothing awaiting review</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => {
              const range = fmtDateRange(item.date_start, item.date_end);
              const mlc = item.mlc_override_count > 0 ? ` · ${item.mlc_override_count} MLC` : '';
              const counts = `${item.day_count} day${item.day_count === 1 ? '' : 's'} · ${item.shift_count} shift${item.shift_count === 1 ? '' : 's'}${mlc}`;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(`/reviews?selected=${item.id}`)}
                  className="w-full text-left p-4 cursor-pointer hover:bg-muted/50 transition-smooth"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      <Icon name="ClipboardCheck" size={18} color="#C65A1A" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-foreground truncate">
                          {item.department_name || 'Rota'}
                        </h3>
                        <span className="text-xs text-muted-foreground flex-shrink-0">{formatTimestamp(item.created_at)}</span>
                      </div>
                      {item.rota_name && (
                        <p className="text-sm text-muted-foreground mt-0.5 truncate">{item.rota_name}</p>
                      )}
                      <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                        <Icon name="Calendar" size={12} />
                        <span className="truncate">{range || counts}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        by {item.submitter_name || 'crew'}{item.submitter_role ? ` · ${item.submitter_role}` : ''}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="border-t border-border p-3">
        <button
          onClick={() => onNavigate('/reviews')}
          className="w-full py-2 rounded-lg text-sm font-medium text-white transition-smooth"
          style={{ background: '#C65A1A' }}
        >
          Open Reviews
        </button>
      </div>
    </div>
  );
};

// ── Activity tab ───────────────────────────────────────────────────────────
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

const ActivityTab = ({ onNavigate }) => {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const user = getCurrentUser();
        const events = await getActivityLast24Hours(user, {}, true);
        if (!cancelled) setActivities((events || []).slice(0, 30));
      } catch (err) {
        console.error('[AlertsDrawer] activity load error:', err);
        if (!cancelled) setActivities([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <LogoSpinner size={28} />
          </div>
        ) : activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Icon name="Activity" size={40} color="var(--color-muted-foreground)" />
            <p className="text-muted-foreground mt-3 text-sm">No activity in the last 24 hours</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {activities.map((a, i) => (
              <div key={`${a?.id}-${i}`} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5 p-2 rounded-lg bg-muted/60 text-muted-foreground">
                    <Icon name={getActionIcon(a?.action)} size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{a?.summary}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                      <span className="capitalize">{a?.module}</span>
                      <span>·</span>
                      <span>{a?.actorName}</span>
                      <span>·</span>
                      <span>{formatTimestamp(a?.createdAt)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-border p-3">
        <button
          onClick={() => onNavigate('/activity')}
          className="w-full py-2 rounded-lg text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-smooth"
        >
          View all activity
        </button>
      </div>
    </div>
  );
};

// ── Drawer shell ───────────────────────────────────────────────────────────
const AlertsDrawer = ({ isOpen, onClose, initialTab = 'notifications', reviewsCount = 0, notificationsCount = 0 }) => {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab);

  // Re-sync to the requested tab each time the drawer is (re)opened.
  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  const handleNavigate = useCallback((path) => {
    navigate(path);
    onClose();
  }, [navigate, onClose]);

  if (!isOpen) return null;

  const tabCount = { reviews: reviewsCount, notifications: notificationsCount };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-[var(--z-dropdown)] transition-opacity"
        onClick={onClose}
      />
      <div className="fixed right-0 top-16 h-[calc(100vh-4rem)] w-full sm:w-[420px] bg-card border-l border-border z-[var(--z-dropdown)] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Inbox</h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="X" size={20} color="var(--color-foreground)" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-stretch border-b border-border">
          {TABS.map(t => {
            const active = activeTab === t.key;
            const count = tabCount[t.key] || 0;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-smooth relative"
                style={{ color: active ? '#C65A1A' : 'var(--color-muted-foreground)' }}
              >
                <Icon name={t.icon} size={15} color={active ? '#C65A1A' : 'var(--color-muted-foreground)'} />
                <span>{t.label}</span>
                {count > 0 && (
                  <span
                    className="min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-semibold inline-flex items-center justify-center"
                    style={{ background: '#C65A1A' }}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
                {active && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full" style={{ background: '#C65A1A' }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0">
          {activeTab === 'notifications' && <NotificationsTab userId={authUser?.id} onNavigate={handleNavigate} />}
          {activeTab === 'reviews' && <ReviewsTab onNavigate={handleNavigate} />}
          {activeTab === 'activity' && <ActivityTab onNavigate={handleNavigate} />}
        </div>
      </div>
    </>
  );
};

export default AlertsDrawer;

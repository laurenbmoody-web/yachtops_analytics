import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import Icon from '../AppIcon';
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
import './alerts-drawer.css';

// AlertsDrawer — a single slide-out panel that unifies the three feeds that
// used to live behind separate nav icons: Notifications, Reviews (the approvals
// inbox), and the Activity feed. Tabs switch between them; each tab links out
// to its full page for the deeper workflow. Built in the Cargo editorial
// language (see alerts-drawer.css). Replaces NotificationsDrawer and the old
// Activity / Reviews nav buttons.

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

const EmptyState = ({ icon, label }) => (
  <div className="ad-empty">
    <span className="ad-empty-ic"><Icon name={icon} size={20} color="#B7B1A5" /></span>
    <p>{label}</p>
  </div>
);

const Loading = () => (
  <div className="ad-loading"><LogoSpinner size={28} /></div>
);

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
    case SEVERITY?.URGENT: return '#C9544B';
    case SEVERITY?.WARN: return '#C68A1A';
    case SEVERITY?.INFO:
    default: return '#C65A1A';
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
    <>
      <div className="ad-toolbar">
        <div className="ad-seg">
          {['unread', 'all'].map(f => (
            <button
              key={f}
              className={`ad-seg-btn${filter === f ? ' is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'unread' ? 'Unread' : 'All'}
            </button>
          ))}
        </div>
        <div className="ad-actions">
          <button className="ad-iconbtn" title="Mark all read" onClick={handleMarkAllRead} disabled={notifications.length === 0}>
            <Icon name="CheckCheck" size={16} />
          </button>
          <button className="ad-iconbtn" title="Clear read" onClick={handleClearRead} disabled={notifications.length === 0}>
            <Icon name="Trash2" size={16} />
          </button>
        </div>
      </div>

      <div className="ad-scroll">
        {loading ? <Loading />
          : notifications.length === 0 ? (
            <EmptyState icon="Bell" label={filter === 'unread' ? 'No unread notifications' : 'No notifications'} />
          ) : (
            notifications.map((n) => (
              <button
                type="button"
                key={n?.id}
                className={`ad-row${!n?.isRead ? ' is-unread' : ''}`}
                onClick={() => handleClick(n)}
              >
                <span className="ad-ico">
                  <Icon name={getNotificationIcon(n?.type)} size={16} color={getNotificationColor(n?.severity)} />
                </span>
                <span className="ad-main">
                  <span className="ad-row-top">
                    <span className="ad-row-title">{n?.title}</span>
                    {!n?.isRead ? <span className="ad-udot" /> : <span className="ad-time">{formatTimestamp(n?.createdAt)}</span>}
                  </span>
                  {n?.message && <span className="ad-msg">{n.message}</span>}
                  {!n?.isRead && <span className="ad-meta">{formatTimestamp(n?.createdAt)}</span>}
                </span>
              </button>
            ))
          )}
      </div>
    </>
  );
};

// ── Reviews tab ────────────────────────────────────────────────────────────
const ReviewsTab = ({ onNavigate }) => {
  const { items, loading } = useReviewItems('pending');

  return (
    <>
      <div className="ad-scroll">
        {loading ? <Loading />
          : items.length === 0 ? (
            <EmptyState icon="Inbox" label="Nothing awaiting review" />
          ) : (
            items.map((item) => {
              const range = fmtDateRange(item.date_start, item.date_end);
              const mlc = item.mlc_override_count > 0 ? ` · ${item.mlc_override_count} MLC` : '';
              const counts = `${item.day_count} day${item.day_count === 1 ? '' : 's'} · ${item.shift_count} shift${item.shift_count === 1 ? '' : 's'}${mlc}`;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="ad-row"
                  onClick={() => onNavigate(`/reviews?selected=${item.id}`)}
                >
                  <span className="ad-ico">
                    <Icon name="ClipboardCheck" size={17} color="#C65A1A" />
                  </span>
                  <span className="ad-main">
                    <span className="ad-row-top">
                      <span className="ad-row-title">{item.department_name || 'Rota'}</span>
                      <span className="ad-time">{formatTimestamp(item.created_at)}</span>
                    </span>
                    {item.rota_name && <span className="ad-sub">{item.rota_name}</span>}
                    <span className="ad-meta">
                      <Icon name="Calendar" size={12} />
                      <span>{range || counts}</span>
                      <span className="ad-sep">·</span>
                      <span>by {item.submitter_name || 'crew'}{item.submitter_role ? ` · ${item.submitter_role}` : ''}</span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
      </div>
      <div className="ad-foot">
        <button className="ad-foot-link" onClick={() => onNavigate('/reviews')}>
          <span>Open Reviews</span>
          <Icon name="ChevronRight" size={16} />
        </button>
      </div>
    </>
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
    <>
      <div className="ad-scroll">
        {loading ? <Loading />
          : activities.length === 0 ? (
            <EmptyState icon="Activity" label="No activity in the last 24 hours" />
          ) : (
            activities.map((a, i) => (
              <div key={`${a?.id}-${i}`} className="ad-row" style={{ cursor: 'default' }}>
                <span className="ad-ico">
                  <Icon name={getActionIcon(a?.action)} size={16} color="#8B8478" />
                </span>
                <span className="ad-main">
                  <span className="ad-row-title">{a?.summary}</span>
                  <span className="ad-meta">
                    <span className="ad-cap">{a?.module}</span>
                    <span className="ad-sep">·</span>
                    <span>{a?.actorName}</span>
                    <span className="ad-sep">·</span>
                    <span>{formatTimestamp(a?.createdAt)}</span>
                  </span>
                </span>
              </div>
            ))
          )}
      </div>
      <div className="ad-foot">
        <button className="ad-foot-link" onClick={() => onNavigate('/activity')}>
          <span>View all activity</span>
          <Icon name="ChevronRight" size={16} />
        </button>
      </div>
    </>
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
    <div className="ad">
      <div className="ad-overlay" onClick={onClose} />
      <aside className="ad-panel" role="dialog" aria-label="Inbox">
        <div className="ad-tabs">
          <div className="ad-tabgroup">
            {TABS.map(t => {
              const active = activeTab === t.key;
              const count = tabCount[t.key] || 0;
              return (
                <button
                  key={t.key}
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

        {activeTab === 'notifications' && <NotificationsTab userId={authUser?.id} onNavigate={handleNavigate} />}
        {activeTab === 'reviews' && <ReviewsTab onNavigate={handleNavigate} />}
        {activeTab === 'activity' && <ActivityTab onNavigate={handleNavigate} />}
      </aside>
    </div>
  );
};

export default AlertsDrawer;

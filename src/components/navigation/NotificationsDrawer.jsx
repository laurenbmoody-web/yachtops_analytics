import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../AppIcon';
import Button from '../ui/Button';
import { 
  getUserNotifications, 
  markNotificationRead, 
  markAllNotificationsRead,
  clearReadNotifications,
  NOTIFICATION_TYPES,
  SEVERITY
} from '../../pages/team-jobs-management/utils/notifications';
import { getCurrentUser } from '../../utils/authStorage';
import { formatDistanceToNow } from 'date-fns';

const NotificationsDrawer = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('unread');
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const user = getCurrentUser();
    setCurrentUser(user);
  }, []);

  useEffect(() => {
    if (currentUser?.id) {
      loadNotifications();
    }
  }, [currentUser, activeTab]);

  const loadNotifications = () => {
    if (!currentUser?.id) return;
    
    const unreadOnly = activeTab === 'unread';
    const userNotifications = getUserNotifications(currentUser?.id, unreadOnly);
    setNotifications(userNotifications);
  };

  const handleNotificationClick = (notification) => {
    // Mark as read
    if (!notification?.isRead) {
      markNotificationRead(notification?.id);
    }

    // Navigate to action URL
    if (notification?.actionUrl) {
      navigate(notification?.actionUrl);
      onClose();
    }
  };

  const handleMarkAllRead = () => {
    if (!currentUser?.id) return;
    markAllNotificationsRead(currentUser?.id);
    loadNotifications();
  };

  const handleClearRead = () => {
    if (!currentUser?.id) return;
    clearReadNotifications(currentUser?.id);
    loadNotifications();
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case NOTIFICATION_TYPES?.JOB_PENDING_ACCEPTANCE:
        return 'Clock';
      case NOTIFICATION_TYPES?.JOB_HANDOFF_ACCEPTED:
        return 'CheckCircle';
      case NOTIFICATION_TYPES?.JOB_HANDOFF_DECLINED:
        return 'XCircle';
      case NOTIFICATION_TYPES?.JOB_ASSIGNED_TO_YOU:
        return 'UserPlus';
      case NOTIFICATION_TYPES?.JOB_DUE_TODAY:
        return 'Calendar';
      case NOTIFICATION_TYPES?.JOB_OVERDUE:
        return 'AlertTriangle';
      case NOTIFICATION_TYPES?.INVENTORY_RESTOCK_ALERT:
        return 'Package';
      case NOTIFICATION_TYPES?.HOR_REMINDER:
        return 'Clock';
      case NOTIFICATION_TYPES?.DELIVERY_CROSS_MATCH:
        return 'PackageCheck';
      case NOTIFICATION_TYPES?.DELIVERY_INBOX_ITEM:
        return 'Inbox';
      default:
        return 'Bell';
    }
  };

  const getNotificationColor = (severity) => {
    switch (severity) {
      case SEVERITY?.URGENT:
        return 'var(--color-error)';
      case SEVERITY?.WARN:
        return 'var(--color-warning)';
      case SEVERITY?.INFO:
      default:
        return 'var(--color-primary)';
    }
  };

  const formatTimestamp = (timestamp) => {
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    } catch {
      return 'Recently';
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full sm:w-96 bg-card border-l border-border z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Notifications</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-smooth"
          >
            <Icon name="X" size={20} color="var(--color-foreground)" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <button
            onClick={() => setActiveTab('unread')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-smooth ${
              activeTab === 'unread' ?'bg-primary text-white' :'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            Unread
          </button>
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-smooth ${
              activeTab === 'all' ?'bg-primary text-white' :'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            All
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={notifications?.length === 0}
          >
            <Icon name="CheckCheck" size={16} />
            Mark all read
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearRead}
            disabled={notifications?.length === 0}
          >
            <Icon name="Trash2" size={16} />
            Clear read
          </Button>
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto">
          {notifications?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <Icon name="Bell" size={48} color="var(--color-muted-foreground)" />
              <p className="text-muted-foreground mt-4">
                {activeTab === 'unread' ? 'No unread notifications' : 'No notifications'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications?.map((notification) => (
                <div
                  key={notification?.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`p-4 cursor-pointer hover:bg-muted/50 transition-smooth ${
                    !notification?.isRead ? 'bg-primary/5' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className="flex-shrink-0 mt-0.5">
                      <Icon
                        name={getNotificationIcon(notification?.type)}
                        size={20}
                        color={getNotificationColor(notification?.severity)}
                      />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          {notification?.title}
                        </h3>
                        {!notification?.isRead && (
                          <span className="flex-shrink-0 w-2 h-2 bg-primary rounded-full mt-1" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {notification?.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {formatTimestamp(notification?.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default NotificationsDrawer;
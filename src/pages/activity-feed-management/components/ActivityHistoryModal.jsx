import React, { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { getActivityForEntity } from '../../../utils/activityStorage';
import { getCurrentUser } from '../../../utils/authStorage';

const ActivityHistoryModal = ({ isOpen, onClose, entityType, entityId, entityLabel, entityPath }) => {
  const [events, setEvents] = useState([]);
  const [displayedCount, setDisplayedCount] = useState(50);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (isOpen && entityType && entityId) {
      loadEntityHistory();
    }
  }, [isOpen, entityType, entityId]);
  
  const loadEntityHistory = async () => {
    setLoading(true);
    try {
      const currentUser = getCurrentUser();
      const entityEvents = await getActivityForEntity(entityType, entityId, currentUser);
      setEvents(entityEvents);
      setDisplayedCount(50);
    } catch (error) {
      console.error('Error loading entity history:', error);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };
  
  const handleLoadOlder = () => {
    setDisplayedCount(prev => prev + 50);
  };
  
  const getActionIcon = (action) => {
    if (action?.includes('CREATED')) return 'Plus';
    if (action?.includes('UPDATED') || action?.includes('EDITED')) return 'Edit';
    if (action?.includes('DELETED')) return 'Trash2';
    if (action?.includes('COMPLETED')) return 'CheckCircle';
    if (action?.includes('ACCEPTED')) return 'Check';
    if (action?.includes('DECLINED')) return 'X';
    if (action?.includes('ASSIGNED')) return 'UserPlus';
    if (action?.includes('UNASSIGNED')) return 'UserMinus';
    if (action?.includes('STOCK')) return 'TrendingUp';
    if (action?.includes('IMPORT')) return 'Upload';
    return 'Activity';
  };
  
  const getActionColor = (action) => {
    if (action?.includes('CREATED')) return 'text-success';
    if (action?.includes('COMPLETED')) return 'text-success';
    if (action?.includes('ACCEPTED')) return 'text-success';
    if (action?.includes('DELETED')) return 'text-error';
    if (action?.includes('DECLINED')) return 'text-error';
    if (action?.includes('UPDATED') || action?.includes('EDITED')) return 'text-primary';
    if (action?.includes('ASSIGNED')) return 'text-primary';
    if (action?.includes('STOCK')) return 'text-warning';
    if (action?.includes('IMPORT')) return 'text-primary';
    return 'text-muted-foreground';
  };
  
  const displayedEvents = events?.slice(0, displayedCount);
  const hasMore = displayedCount < events?.length;
  
  if (!isOpen) return null;
  
  const modalTitle = entityType === 'job' 
    ? `Job history — ${entityLabel}` 
    : `Item history — ${entityLabel}`;
  
  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-50 transition-opacity"
        onClick={onClose}
      />
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div 
          className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col pointer-events-auto"
          onClick={(e) => e?.stopPropagation()}
        >
          {/* Header */}
          <div className="p-6 border-b border-border flex-shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-foreground mb-1">
                  {modalTitle}
                </h2>
                {entityPath && (
                  <p className="text-sm text-muted-foreground">
                    {entityPath}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-muted rounded-lg transition-smooth flex-shrink-0"
              >
                <Icon name="X" size={20} className="text-muted-foreground" />
              </button>
            </div>
          </div>
          
          {/* Timeline Body */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <LogoSpinner size={32} />
              </div>
            ) : events?.length === 0 ? (
              <div className="text-center py-12">
                <Icon name="Activity" size={48} className="text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  No history found
                </h3>
                <p className="text-muted-foreground">
                  No activity events recorded for this {entityType === 'job' ? 'job' : 'item'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {displayedEvents?.map((event, index) => {
                  const isNewest = index === 0;
                  const relativeTime = formatDistanceToNow(new Date(event?.createdAt), { addSuffix: true });
                  const absoluteTime = new Date(event?.createdAt)?.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  });
                  const actionIcon = getActionIcon(event?.action);
                  const actionColor = getActionColor(event?.action);
                  
                  return (
                    <div key={event?.id} className="flex gap-4">
                      {/* Timeline Icon */}
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div className={`p-2.5 rounded-xl bg-muted/50 ${actionColor}`}>
                          <Icon name={actionIcon} size={18} />
                        </div>
                        {index < displayedEvents?.length - 1 && (
                          <div className="w-0.5 h-full bg-border mt-2" />
                        )}
                      </div>
                      
                      {/* Event Content */}
                      <div className="flex-1 pb-4">
                        <div className="flex items-start justify-between gap-4 mb-1">
                          <p className="text-sm font-medium text-foreground">
                            {event?.summary}
                          </p>
                          {isNewest && (
                            <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs font-medium rounded-full flex-shrink-0">
                              Newest
                            </span>
                          )}
                        </div>
                        
                        {/* Timestamp */}
                        <p className="text-xs text-muted-foreground mb-2">
                          {absoluteTime} • {relativeTime}
                        </p>
                        
                        {/* Metadata Tags */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs px-2 py-1 bg-muted/50 rounded-lg text-muted-foreground">
                            {event?.actorName}
                          </span>
                          <span className="text-xs px-2 py-1 bg-muted/50 rounded-lg text-muted-foreground capitalize">
                            {event?.departmentScope}
                          </span>
                          {event?.actorRoleTier && (
                            <span className="text-xs px-2 py-1 bg-muted/50 rounded-lg text-muted-foreground capitalize">
                              {event?.actorRoleTier}
                            </span>
                          )}
                        </div>
                        
                        {/* Additional Meta Info */}
                        {event?.meta && Object.keys(event?.meta)?.length > 0 && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            {event?.meta?.qtyDelta && (
                              <span>Quantity change: {event?.meta?.qtyDelta > 0 ? '+' : ''}{event?.meta?.qtyDelta}</span>
                            )}
                            {event?.meta?.locationName && (
                              <span> • Location: {event?.meta?.locationName}</span>
                            )}
                            {event?.meta?.statusFrom && event?.meta?.statusTo && (
                              <span> • Status: {event?.meta?.statusFrom} → {event?.meta?.statusTo}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          
          {/* Footer - Load Older Button */}
          {hasMore && (
            <div className="p-4 border-t border-border flex-shrink-0">
              <button
                onClick={handleLoadOlder}
                className="w-full px-4 py-2.5 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-smooth font-medium text-sm"
              >
                Load older ({events?.length - displayedCount} more)
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ActivityHistoryModal;
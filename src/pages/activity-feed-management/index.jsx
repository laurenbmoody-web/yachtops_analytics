import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { getActivityLast24Hours, getActivityEvents } from '../../utils/activityStorage';
import { getCurrentUser, hasCommandAccess } from '../../utils/authStorage';
import { getDepartmentScope, DEPARTMENT_OPTIONS } from '../../utils/departmentScopeStorage';
import ActivityHistoryModal from './components/ActivityHistoryModal';

const ActivityFeedManagement = () => {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const isCommand = hasCommandAccess(currentUser);
  
  const [moduleFilter, setModuleFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState(getDepartmentScope() || 'ALL');
  const [timeFilter, setTimeFilter] = useState('24h');
  const [showEveryUpdate, setShowEveryUpdate] = useState(false);
  const [activities, setActivities] = useState([]);
  const [displayedCount, setDisplayedCount] = useState(30);
  const [loading, setLoading] = useState(true);
  
  const [historyModal, setHistoryModal] = useState({
    isOpen: false,
    entityType: null,
    entityId: null,
    entityLabel: '',
    entityPath: ''
  });
  
  useEffect(() => {
    loadActivities();
  }, [moduleFilter, departmentFilter, timeFilter, showEveryUpdate]);
  
  const loadActivities = async () => {
    setLoading(true);
    try {
      const filters = {
        module: moduleFilter === 'all' ? null : moduleFilter,
        departmentScope: isCommand ? departmentFilter : null
      };
      
      let events = [];
      
      if (timeFilter === '24h') {
        events = await getActivityLast24Hours(currentUser, filters, !showEveryUpdate);
      } else if (timeFilter === '7d') {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        events = await getActivityEvents(currentUser, {
          ...filters,
          timeFrom: sevenDaysAgo?.toISOString(),
          timeTo: now?.toISOString()
        });
        
        if (!showEveryUpdate) {
          const seen = new Map();
          const deduped = [];
          for (const event of events) {
            const key = `${event?.entityType}:${event?.entityId}`;
            if (!seen?.has(key)) {
              seen?.set(key, true);
              deduped?.push(event);
            }
          }
          events = deduped;
        }
      } else {
        events = await getActivityEvents(currentUser, filters);
        
        if (!showEveryUpdate) {
          const seen = new Map();
          const deduped = [];
          for (const event of events) {
            const key = `${event?.entityType}:${event?.entityId}`;
            if (!seen?.has(key)) {
              seen?.set(key, true);
              deduped?.push(event);
            }
          }
          events = deduped;
        }
      }
      
      setActivities(events);
      setDisplayedCount(30);
    } catch (err) {
      console.error('[ActivityFeed] loadActivities error:', err);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  };
  
  const handleLoadMore = () => {
    setDisplayedCount(prev => prev + 30);
  };
  
  const handleActivityClick = (activity) => {
    const entityLabel = activity?.summary?.split(': ')?.[1] || activity?.summary;
    const entityPath = activity?.module === 'jobs' 
      ? `Jobs • ${activity?.departmentScope}` 
      : `Inventory • ${activity?.departmentScope}`;
    
    setHistoryModal({
      isOpen: true,
      entityType: activity?.entityType,
      entityId: activity?.entityId,
      entityLabel,
      entityPath
    });
  };
  
  const handleOpenClick = (e, activity) => {
    e?.stopPropagation();
    if (activity?.module === 'jobs') {
      navigate('/jobs');
    } else if (activity?.module === 'inventory') {
      navigate('/inventory');
    }
  };
  
  const closeHistoryModal = () => {
    setHistoryModal({
      isOpen: false,
      entityType: null,
      entityId: null,
      entityLabel: '',
      entityPath: ''
    });
  };
  
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
  
  const getActionColor = (action) => {
    if (action?.includes('CREATED')) return 'text-success';
    if (action?.includes('COMPLETED')) return 'text-success';
    if (action?.includes('ACCEPTED')) return 'text-success';
    if (action?.includes('DELETED')) return 'text-error';
    if (action?.includes('DECLINED')) return 'text-error';
    if (action?.includes('UPDATED')) return 'text-primary';
    if (action?.includes('ASSIGNED')) return 'text-primary';
    if (action?.includes('STOCK')) return 'text-warning';
    if (action?.includes('IMPORT')) return 'text-primary';
    return 'text-muted-foreground';
  };
  
  const displayedActivities = activities?.slice(0, displayedCount);
  const hasMore = displayedCount < activities?.length;
  
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto pt-24">
        {/* Page Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => navigate('/dashboard')}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
            >
              <Icon name="ArrowLeft" size={20} className="text-muted-foreground" />
            </button>
            <h1 className="text-3xl font-bold text-foreground">Activity</h1>
          </div>
          <p className="text-muted-foreground ml-14">
            Real-time operational activity across Jobs and Inventory
          </p>
        </div>
        
        {/* Filters */}
        <div className="bg-card border border-border rounded-2xl p-6 mb-6 shadow-sm">
          <div className="flex flex-col gap-4">
            {/* Top Row: Module Filter + Time Filter + Show Every Update Toggle */}
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
              {/* Module Filter */}
              <div className="flex-1">
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Module
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setModuleFilter('all')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth ${
                      moduleFilter === 'all' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setModuleFilter('jobs')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth flex items-center gap-2 ${
                      moduleFilter === 'jobs' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    <Icon name="Briefcase" size={16} />
                    Jobs
                  </button>
                  <button
                    onClick={() => setModuleFilter('inventory')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth flex items-center gap-2 ${
                      moduleFilter === 'inventory' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    <Icon name="Package" size={16} />
                    Inventory
                  </button>
                  <button
                    onClick={() => setModuleFilter('defects')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth flex items-center gap-2 ${
                      moduleFilter === 'defects' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    <Icon name="AlertTriangle" size={16} />
                    Defects
                  </button>
                </div>
              </div>
              
              {/* Time Filter */}
              <div className="flex-1">
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Time Range
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTimeFilter('24h')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth ${
                      timeFilter === '24h' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    Last 24h
                  </button>
                  <button
                    onClick={() => setTimeFilter('7d')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth ${
                      timeFilter === '7d' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    7 Days
                  </button>
                  <button
                    onClick={() => setTimeFilter('all')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth ${
                      timeFilter === 'all' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    All Time
                  </button>
                </div>
              </div>
              
              {/* Show Every Update Toggle */}
              <div className="flex items-center gap-3 lg:ml-auto">
                <label className="text-sm font-medium text-foreground">
                  Show every update
                </label>
                <button
                  onClick={() => setShowEveryUpdate(!showEveryUpdate)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    showEveryUpdate ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      showEveryUpdate ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
            
            {/* Department Filter (Command only) */}
            {isCommand && (
              <div>
                <label className="text-sm font-medium text-foreground mb-2 block">
                  Department
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setDepartmentFilter('ALL')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth ${
                      departmentFilter === 'ALL' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    All Departments
                  </button>
                  {DEPARTMENT_OPTIONS?.filter(d => d?.value !== 'ALL')?.map(dept => (
                    <button
                      key={dept?.value}
                      onClick={() => setDepartmentFilter(dept?.value)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-smooth ${
                        departmentFilter === dept?.value
                          ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      {dept?.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {/* Activity Count */}
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-semibold text-foreground">{displayedActivities?.length}</span> of{' '}
              <span className="font-semibold text-foreground">{activities?.length}</span> activities
              {!showEveryUpdate && <span className="text-xs ml-2">(latest state per entity)</span>}
            </p>
          </div>
        </div>
        
        {/* Activity Feed */}
        <div className="bg-card border border-border rounded-2xl shadow-sm">
          {loading ? (
            <div className="p-12 text-center">
              <Icon name="Loader2" size={40} className="text-muted-foreground mx-auto mb-4 animate-spin" />
              <p className="text-muted-foreground">Loading activity...</p>
            </div>
          ) : displayedActivities?.length === 0 ? (
            <div className="p-12 text-center">
              <Icon name="Activity" size={48} className="text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                No activity found
              </h3>
              <p className="text-muted-foreground">
                {timeFilter === '24h' ? 'No activity in the last 24 hours'
                  : timeFilter === '7d' ? 'No activity in the last 7 days' : 'No activity to display'}
              </p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-border">
                {displayedActivities?.map((activity, index) => {
                  const relativeTime = formatDistanceToNow(new Date(activity?.createdAt), { addSuffix: true });
                  const actionIcon = getActionIcon(activity?.action);
                  const actionColor = getActionColor(activity?.action);
                  const moduleColor = activity?.module === 'jobs' ? 'bg-primary/10 text-primary' : 'bg-success/10 text-success';
                  
                  return (
                    <div
                      key={`${activity?.id}-${index}`}
                      className="p-6 hover:bg-muted/30 transition-smooth cursor-pointer"
                      onClick={() => handleActivityClick(activity)}
                    >
                      <div className="flex items-start gap-4">
                        {/* Icon */}
                        <div className={`p-3 rounded-xl bg-muted/50 ${actionColor} flex-shrink-0`}>
                          <Icon name={actionIcon} size={20} />
                        </div>
                        
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <p className="text-base text-foreground font-medium">
                              {activity?.summary}
                            </p>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className="text-sm text-muted-foreground whitespace-nowrap">
                                {relativeTime}
                              </span>
                              <button
                                onClick={(e) => handleOpenClick(e, activity)}
                                className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs font-medium transition-smooth flex items-center gap-1.5"
                              >
                                <span>Open</span>
                                <Icon name="ExternalLink" size={14} />
                              </button>
                            </div>
                          </div>
                          
                          {/* Metadata */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-xs px-2 py-1 rounded-lg font-medium capitalize ${moduleColor}`}>
                              {activity?.module}
                            </span>
                            <span className="text-xs px-2 py-1 bg-muted/50 rounded-lg text-muted-foreground">
                              {activity?.actorName}
                            </span>
                            <span className="text-xs px-2 py-1 bg-muted/50 rounded-lg text-muted-foreground capitalize">
                              {activity?.departmentScope}
                            </span>
                            {activity?.actorRoleTier && (
                              <span className="text-xs px-2 py-1 bg-muted/50 rounded-lg text-muted-foreground capitalize">
                                {activity?.actorRoleTier}
                              </span>
                            )}
                          </div>
                          
                          {/* Additional Meta Info */}
                          {activity?.meta && Object.keys(activity?.meta)?.length > 0 && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              {activity?.meta?.qtyDelta && (
                                <span>Quantity change: {activity?.meta?.qtyDelta > 0 ? '+' : ''}{activity?.meta?.qtyDelta}</span>
                              )}
                              {activity?.meta?.locationName && (
                                <span> • Location: {activity?.meta?.locationName}</span>
                              )}
                              {activity?.meta?.statusFrom && activity?.meta?.statusTo && (
                                <span> • Status: {activity?.meta?.statusFrom} → {activity?.meta?.statusTo}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Load More Button */}
              {hasMore && (
                <div className="p-6 border-t border-border">
                  <button
                    onClick={handleLoadMore}
                    className="w-full px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-smooth font-medium"
                  >
                    Load more ({activities?.length - displayedCount} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {/* Activity History Modal */}
      <ActivityHistoryModal
        isOpen={historyModal?.isOpen}
        onClose={closeHistoryModal}
        entityType={historyModal?.entityType}
        entityId={historyModal?.entityId}
        entityLabel={historyModal?.entityLabel}
        entityPath={historyModal?.entityPath}
      />
    </div>
  );
};

export default ActivityFeedManagement;

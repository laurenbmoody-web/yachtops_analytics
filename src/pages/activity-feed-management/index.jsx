import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import LogoSpinner from '../../components/LogoSpinner';
import { getActivityLast24Hours, getActivityEvents } from '../../utils/activityStorage';
import { getCurrentUser, hasCommandAccess } from '../../utils/authStorage';
import { getDepartmentScope, DEPARTMENT_OPTIONS } from '../../utils/departmentScopeStorage';
import ActivityHistoryModal from './components/ActivityHistoryModal';
import '../../styles/editorial.css';
import './activity.css';

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
  
  const pill = (on) => `af-pill${on ? ' on' : ''}`;
  const ddmmyyyy = (d) => {
    const x = new Date(d);
    return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
  };
  const timeLabel = { '24h': 'LAST 24H', '7d': 'LAST 7 DAYS', all: 'ALL TIME' }[timeFilter];

  return (
    <div className="af-page">
      <Header />
      <main className="af-wrap">
        <button type="button" className="af-back" onClick={() => navigate('/dashboard')}>
          <Icon name="ArrowLeft" size={15} /> Back to dashboard
        </button>
        <p className="editorial-meta">
          <span className="dot">●</span>ACTIVITY<span className="bar" /><span className="muted">{timeLabel}</span><span className="bar" /><span className="muted">{activities?.length || 0} EVENTS</span>
        </p>
        <h1 className="editorial-greeting">ACTIVITY<span className="period">,</span> <em>on board</em><span className="period">.</span></h1>

        {/* Filters — tracked-caps labels over rounded pills; wrap on phones. */}
        <section className="af-filters">
          <div className="af-group">
            <span className="af-label">Module</span>
            <div className="af-pills">
              <button type="button" className={pill(moduleFilter === 'all')} onClick={() => setModuleFilter('all')}>All</button>
              <button type="button" className={pill(moduleFilter === 'jobs')} onClick={() => setModuleFilter('jobs')}><Icon name="Briefcase" size={13} /> Jobs</button>
              <button type="button" className={pill(moduleFilter === 'inventory')} onClick={() => setModuleFilter('inventory')}><Icon name="Package" size={13} /> Inventory</button>
              <button type="button" className={pill(moduleFilter === 'defects')} onClick={() => setModuleFilter('defects')}><Icon name="AlertTriangle" size={13} /> Defects</button>
            </div>
          </div>
          <div className="af-group">
            <span className="af-label">Time range</span>
            <div className="af-pills">
              <button type="button" className={pill(timeFilter === '24h')} onClick={() => setTimeFilter('24h')}>Last 24h</button>
              <button type="button" className={pill(timeFilter === '7d')} onClick={() => setTimeFilter('7d')}>7 days</button>
              <button type="button" className={pill(timeFilter === 'all')} onClick={() => setTimeFilter('all')}>All time</button>
            </div>
          </div>
          {isCommand && (
            <div className="af-group">
              <span className="af-label">Department</span>
              <div className="af-pills">
                <button type="button" className={pill(departmentFilter === 'ALL')} onClick={() => setDepartmentFilter('ALL')}>All</button>
                {DEPARTMENT_OPTIONS?.filter(d => d?.value !== 'ALL')?.map(dept => (
                  <button type="button" key={dept?.value} className={pill(departmentFilter === dept?.value)} onClick={() => setDepartmentFilter(dept?.value)}>
                    {dept?.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="af-foot">
            <span className="af-count">
              Showing <b>{displayedActivities?.length}</b> of <b>{activities?.length}</b>
              {!showEveryUpdate && <span className="af-faint"> · latest state per item</span>}
            </span>
            <label className="af-toggle">
              <span>Show every update</span>
              <button type="button" role="switch" aria-checked={showEveryUpdate} className={`af-switch${showEveryUpdate ? ' on' : ''}`} onClick={() => setShowEveryUpdate(!showEveryUpdate)} />
            </label>
          </div>
        </section>

        {/* Feed — hairline-separated rows, no boxed cards. */}
        <section className="af-feed">
          {loading ? (
            <div className="af-empty">
              <LogoSpinner size={36} className="mx-auto mb-3" />
              <p>Loading activity…</p>
            </div>
          ) : displayedActivities?.length === 0 ? (
            <div className="af-empty">
              <Icon name="Activity" size={32} />
              <h3>Nothing yet.</h3>
              <p>
                {timeFilter === '24h' ? 'No activity in the last 24 hours'
                  : timeFilter === '7d' ? 'No activity in the last 7 days' : 'No activity to display'}
              </p>
            </div>
          ) : (
            <>
              {displayedActivities?.map((activity, index) => {
                const when = new Date(activity?.createdAt);
                const recent = Date.now() - when.getTime() < 7 * 24 * 3600 * 1000;
                const tone = getActionColor(activity?.action).replace('text-', '');
                return (
                  <div key={`${activity?.id}-${index}`} className="af-row" onClick={() => handleActivityClick(activity)}>
                    <span className={`af-ico tone-${tone}`}><Icon name={getActionIcon(activity?.action)} size={17} /></span>
                    <div className="af-body">
                      <div className="af-top">
                        <p className="af-summary">{activity?.summary}</p>
                        <span className="af-when">{recent ? formatDistanceToNow(when, { addSuffix: true }) : ddmmyyyy(when)}</span>
                      </div>
                      <div className="af-tags">
                        <span className="af-tag accent">{activity?.module}</span>
                        {activity?.actorName && <span className="af-tag">{activity?.actorName}</span>}
                        {activity?.departmentScope && <span className="af-tag">{String(activity?.departmentScope).toLowerCase()}</span>}
                        {activity?.actorRoleTier && <span className="af-tag">{String(activity?.actorRoleTier).toLowerCase()}</span>}
                        <button type="button" className="af-open" onClick={(e) => handleOpenClick(e, activity)}>Open <Icon name="ArrowUpRight" size={13} /></button>
                      </div>
                      {activity?.meta && Object.keys(activity?.meta)?.length > 0 && (activity?.meta?.qtyDelta || activity?.meta?.locationName || activity?.meta?.statusTo) && (
                        <p className="af-meta">
                          {activity?.meta?.qtyDelta ? <span>Quantity {activity?.meta?.qtyDelta > 0 ? '+' : ''}{activity?.meta?.qtyDelta}</span> : null}
                          {activity?.meta?.locationName && <span> · {activity?.meta?.locationName}</span>}
                          {activity?.meta?.statusFrom && activity?.meta?.statusTo && <span> · {activity?.meta?.statusFrom} → {activity?.meta?.statusTo}</span>}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              {hasMore && (
                <button type="button" className="af-more" onClick={handleLoadMore}>
                  Load more ({activities?.length - displayedCount} remaining)
                </button>
              )}
            </>
          )}
        </section>
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

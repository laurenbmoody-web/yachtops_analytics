import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import { supabase } from '../../lib/supabaseClient';
import { getCurrentUser } from '../../utils/authStorage';

const getActiveTenantId = () => localStorage.getItem('cargo_active_tenant_id') || null;

const getTodayLocalRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    todayStr: start?.toISOString()?.split('T')?.[0],
    startISO: start?.toISOString(),
    endISO: end?.toISOString(),
    displayDate: start?.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  };
};

const formatTime = (isoString) => {
  if (!isoString) return '';
  try {
    return new Date(isoString)?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return ''; }
};

const ACTION_ICON_MAP = {
  JOB_CREATED: { icon: 'Plus', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950' },
  JOB_COMPLETED: { icon: 'CheckCircle', color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950' },
  JOB_ASSIGNED: { icon: 'UserCheck', color: 'text-indigo-500', bg: 'bg-indigo-50 dark:bg-indigo-950' },
  JOB_ACCEPTED: { icon: 'ThumbsUp', color: 'text-teal-500', bg: 'bg-teal-50 dark:bg-teal-950' },
  JOB_DECLINED: { icon: 'ThumbsDown', color: 'text-red-400', bg: 'bg-red-50 dark:bg-red-950' },
  JOB_EDITED: { icon: 'Edit2', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950' },
  JOB_DUE_DATE_CHANGED: { icon: 'Calendar', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950' },
  JOB_PRIORITY_CHANGED: { icon: 'AlertTriangle', color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950' },
  JOB_DELETED: { icon: 'Trash2', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950' },
  JOB_SENT_FOR_ACCEPTANCE: { icon: 'Send', color: 'text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950' },
  JOB_UNASSIGNED: { icon: 'UserMinus', color: 'text-gray-500', bg: 'bg-gray-50 dark:bg-gray-900' },
  STOCK_ADJUSTED: { icon: 'Package', color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-950' },
  STOCK_RECEIVED: { icon: 'PackagePlus', color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950' },
  STOCK_CONSUMED: { icon: 'PackageMinus', color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950' },
  ITEM_CREATED: { icon: 'PlusSquare', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950' },
  ITEM_UPDATED: { icon: 'RefreshCw', color: 'text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950' },
  DEFECT_CREATED: { icon: 'AlertCircle', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950' },
  DEFECT_CLOSED: { icon: 'CheckSquare', color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950' },
  DEFECT_STATUS_CHANGED: { icon: 'Activity', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950' },
  DEFAULT: { icon: 'Zap', color: 'text-muted-foreground', bg: 'bg-muted' }
};

const getActionMeta = (action) => ACTION_ICON_MAP?.[action] || ACTION_ICON_MAP?.DEFAULT;

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'due', label: 'Due Today' },
  { key: 'completed', label: 'Completed' },
  { key: 'activity', label: 'Activity' }
];

const TodayDetailPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [dueJobs, setDueJobs] = useState([]);
  const [completedJobs, setCompletedJobs] = useState([]);
  const [activityEvents, setActivityEvents] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');

  const { todayStr, startISO, endISO, displayDate } = getTodayLocalRange();

  useEffect(() => {
    fetchTodayData();
  }, []);

  const fetchTodayData = async () => {
    setLoading(true);
    try {
      const currentUser = getCurrentUser();
      const tenantId = getActiveTenantId();
      if (!currentUser?.id || !tenantId) {
        setLoading(false);
        return;
      }

      // 1. Jobs due today
      const { data: due } = await supabase
        ?.from('team_jobs')
        ?.select('id, title, due_date, status, priority, department, created_at')
        ?.eq('tenant_id', tenantId)
        ?.eq('assigned_to', currentUser?.id)
        ?.eq('due_date', todayStr)
        ?.in('status', ['OPEN', 'open', 'Open']);

      setDueJobs(due || []);

      // 2. Jobs completed today
      const { data: completed } = await supabase
        ?.from('team_jobs')
        ?.select('id, title, completion_date, completed_at, priority, department')
        ?.eq('tenant_id', tenantId)
        ?.eq('assigned_to', currentUser?.id)
        ?.in('status', ['COMPLETED', 'completed', 'Completed'])
        ?.or(`completion_date.eq.${todayStr},completed_at.gte.${startISO}`);

      setCompletedJobs(completed || []);

      // 3. Activity events today
      const { data: events } = await supabase
        ?.from('activity_events')
        ?.select('id, action, summary, created_at, module, entity_type, entity_id, meta')
        ?.eq('tenant_id', tenantId)
        ?.eq('actor_user_id', currentUser?.id)
        ?.gte('created_at', startISO)
        ?.lt('created_at', endISO)
        ?.order('created_at', { ascending: false });

      setActivityEvents(events || []);
    } catch (err) {
      console.error('[TodayDetailPage] fetch error:', err?.message);
    } finally {
      setLoading(false);
    }
  };

  const getPriorityBadge = (priority) => {
    const p = (priority || '')?.toUpperCase();
    if (p === 'HIGH' || p === 'URGENT') return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">{priority}</span>;
    if (p === 'MEDIUM') return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">{priority}</span>;
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{priority || 'Normal'}</span>;
  };

  const totalCount = dueJobs?.length + completedJobs?.length + activityEvents?.length;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Back + Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate('/dashboard')}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <Icon name="ArrowLeft" className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Today</h1>
            <p className="text-sm text-muted-foreground">{displayDate}</p>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-amber-500">{dueJobs?.length}</div>
            <div className="text-xs text-muted-foreground mt-1">Due Today</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-green-500">{completedJobs?.length}</div>
            <div className="text-xs text-muted-foreground mt-1">Completed</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-primary">{activityEvents?.length}</div>
            <div className="text-xs text-muted-foreground mt-1">Activity Events</div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
          {FILTERS?.map(f => (
            <button
              key={f?.key}
              onClick={() => setActiveFilter(f?.key)}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeFilter === f?.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {f?.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-16 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin" />
          </div>
        ) : totalCount === 0 ? (
          <div className="py-16 text-center">
            <Icon name="Calendar" className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Nothing recorded for today yet.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Due Today Section */}
            {(activeFilter === 'all' || activeFilter === 'due') && dueJobs?.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Icon name="Clock" className="w-4 h-4 text-amber-500" />
                  <h2 className="text-sm font-semibold text-foreground">Due Today</h2>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{dueJobs?.length}</span>
                </div>
                <div className="space-y-2">
                  {dueJobs?.map(job => (
                    <div key={job?.id} className="bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950 flex items-center justify-center flex-shrink-0">
                          <Icon name="Clock" className="w-4 h-4 text-amber-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{job?.title || 'Untitled job'}</p>
                          {job?.department && (
                            <p className="text-xs text-muted-foreground mt-0.5">{job?.department}</p>
                          )}
                        </div>
                      </div>
                      {job?.priority && getPriorityBadge(job?.priority)}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Completed Today Section */}
            {(activeFilter === 'all' || activeFilter === 'completed') && completedJobs?.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Icon name="CheckCircle" className="w-4 h-4 text-green-500" />
                  <h2 className="text-sm font-semibold text-foreground">Completed Today</h2>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{completedJobs?.length}</span>
                </div>
                <div className="space-y-2">
                  {completedJobs?.map(job => (
                    <div key={job?.id} className="bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-green-50 dark:bg-green-950 flex items-center justify-center flex-shrink-0">
                          <Icon name="CheckCircle" className="w-4 h-4 text-green-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{job?.title || 'Untitled job'}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {job?.department && <p className="text-xs text-muted-foreground">{job?.department}</p>}
                            {job?.completed_at && (
                              <p className="text-xs text-muted-foreground">{formatTime(job?.completed_at)}</p>
                            )}
                          </div>
                        </div>
                      </div>
                      {job?.priority && getPriorityBadge(job?.priority)}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Activity Events Section */}
            {(activeFilter === 'all' || activeFilter === 'activity') && activityEvents?.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Icon name="Activity" className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">Activity</h2>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{activityEvents?.length}</span>
                </div>
                <div className="space-y-2">
                  {activityEvents?.map(event => {
                    const meta = getActionMeta(event?.action);
                    return (
                      <div key={event?.id} className="bg-card border border-border rounded-xl p-4">
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-lg ${meta.bg} flex items-center justify-center flex-shrink-0`}>
                            <Icon name={meta.icon} className={`w-4 h-4 ${meta.color}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground leading-snug">{event?.summary || event?.action}</p>
                            <div className="flex items-center gap-2 mt-1">
                              {event?.module && (
                                <span className="text-xs text-muted-foreground capitalize">{event?.module}</span>
                              )}
                              <span className="text-xs text-muted-foreground">{formatTime(event?.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Empty state for active filter */}
            {activeFilter !== 'all' && (
              (activeFilter === 'due' && dueJobs?.length === 0) ||
              (activeFilter === 'completed' && completedJobs?.length === 0) ||
              (activeFilter === 'activity' && activityEvents?.length === 0)
            ) && (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground">No {FILTERS?.find(f => f?.key === activeFilter)?.label?.toLowerCase()} items for today.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TodayDetailPage;

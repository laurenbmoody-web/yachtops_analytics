import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { supabase } from '../../../lib/supabaseClient';
import { getCurrentUser } from '../../../utils/authStorage';

const getActiveTenantId = () => localStorage.getItem('cargo_active_tenant_id') || null;

const formatTime = (isoString) => {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return '';
  }
};

const getTodayLocalRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    todayStr: start?.toISOString()?.split('T')?.[0],
    startISO: start?.toISOString(),
    endISO: end?.toISOString()
  };
};

const ACTION_ICON_MAP = {
  JOB_CREATED: { icon: 'Plus', color: 'text-blue-500' },
  JOB_COMPLETED: { icon: 'CheckCircle', color: 'text-green-500' },
  JOB_ASSIGNED: { icon: 'UserCheck', color: 'text-indigo-500' },
  JOB_ACCEPTED: { icon: 'ThumbsUp', color: 'text-teal-500' },
  JOB_DECLINED: { icon: 'ThumbsDown', color: 'text-red-400' },
  JOB_EDITED: { icon: 'Edit2', color: 'text-amber-500' },
  JOB_DUE_DATE_CHANGED: { icon: 'Calendar', color: 'text-amber-500' },
  JOB_PRIORITY_CHANGED: { icon: 'AlertTriangle', color: 'text-orange-500' },
  JOB_DELETED: { icon: 'Trash2', color: 'text-red-500' },
  STOCK_ADJUSTED: { icon: 'Package', color: 'text-purple-500' },
  STOCK_RECEIVED: { icon: 'PackagePlus', color: 'text-green-500' },
  STOCK_CONSUMED: { icon: 'PackageMinus', color: 'text-orange-500' },
  ITEM_CREATED: { icon: 'PlusSquare', color: 'text-blue-500' },
  ITEM_UPDATED: { icon: 'RefreshCw', color: 'text-blue-400' },
  DEFECT_CREATED: { icon: 'AlertCircle', color: 'text-red-500' },
  DEFECT_CLOSED: { icon: 'CheckSquare', color: 'text-green-500' },
  DEFECT_STATUS_CHANGED: { icon: 'Activity', color: 'text-amber-500' },
  DEFAULT: { icon: 'Zap', color: 'text-muted-foreground' }
};

const getActionMeta = (action) => ACTION_ICON_MAP?.[action] || ACTION_ICON_MAP?.DEFAULT;

const TodaySnapshotWidget = () => {
  const navigate = useNavigate();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const currentUser = getCurrentUser();
        const tenantId = getActiveTenantId();
        if (!currentUser?.id || !tenantId) {
          setActivities([]);
          setLoading(false);
          return;
        }

        const { todayStr, startISO, endISO } = getTodayLocalRange();
        const items = [];

        // 1. Jobs due today (status = OPEN, due_date = today, assigned_to = current user)
        const { data: dueJobs } = await supabase?.from('team_jobs')?.select('id, title, due_date, created_at, status')?.eq('tenant_id', tenantId)?.eq('assigned_to', currentUser?.id)?.eq('due_date', todayStr)?.in('status', ['OPEN', 'open', 'Open']);

        (dueJobs || [])?.forEach((job) => {
          items?.push({
            sortKey: job?.due_date + 'T00:00:00',
            time: 'Due today',
            icon: 'Clock',
            color: 'text-amber-500',
            title: job?.title || 'Untitled job'
          });
        });

        // 2. Jobs completed today (status = completed, completion_date = today, assigned_to = current user)
        const { data: completedJobs } = await supabase?.from('team_jobs')?.select('id, title, completion_date, completed_at')?.eq('tenant_id', tenantId)?.eq('assigned_to', currentUser?.id)?.in('status', ['COMPLETED', 'completed', 'Completed'])?.or(`completion_date.eq.${todayStr},completed_at.gte.${startISO}`);

        (completedJobs || [])?.forEach((job) => {
          const ts = job?.completed_at || (job?.completion_date ? job?.completion_date + 'T00:00:00' : null);
          items?.push({
            sortKey: ts || startISO,
            time: job?.completed_at ? formatTime(job?.completed_at) : 'Today',
            icon: 'CheckCircle',
            color: 'text-green-500',
            title: `Completed: ${job?.title || 'Untitled job'}`
          });
        });

        // 3. Recent activity events today for current user
        const { data: activityRows } = await supabase?.from('activity_events')?.select('id, action, summary, created_at')?.eq('tenant_id', tenantId)?.eq('actor_user_id', currentUser?.id)?.gte('created_at', startISO)?.lt('created_at', endISO)?.order('created_at', { ascending: false })?.limit(20);

        (activityRows || [])?.forEach((event) => {
          const meta = getActionMeta(event?.action);
          items?.push({
            sortKey: event?.created_at,
            time: formatTime(event?.created_at),
            icon: meta.icon,
            color: meta.color,
            title: event?.summary || event?.action || 'Activity'
          });
        });

        // Sort all items chronologically (earliest first)
        items?.sort((a, b) => new Date(a.sortKey) - new Date(b.sortKey));

        setActivities(items);
      } catch (err) {
        console.error('[TodaySnapshotWidget] fetch error:', err?.message);
        setActivities([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <div
      className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer hover:border-primary/30"
      onClick={() => navigate('/today')}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e?.key === 'Enter' && navigate('/today')}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Today snapshot</h3>
        <div className="flex items-center gap-1.5">
          <Icon name="Calendar" className="w-4 h-4 text-muted-foreground" />
          <Icon name="ChevronRight" className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      </div>
      {loading ? (
        <div className="py-8 flex items-center justify-center">
          <LogoSpinner size={20} />
        </div>
      ) : activities?.length > 0 ? (
        <div className="space-y-3">
          {activities?.map((activity, index) => (
            <div key={index} className="flex items-start gap-3">
              <div className="flex-shrink-0 w-16 text-xs text-muted-foreground font-medium pt-0.5">
                {activity?.time}
              </div>
              <div className="flex-1">
                <div className="flex items-start gap-2">
                  <Icon name={activity?.icon} className={`w-4 h-4 flex-shrink-0 mt-0.5 ${activity?.color}`} />
                  <span className="text-sm text-foreground leading-snug">{activity?.title}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing scheduled for today.</p>
        </div>
      )}
    </div>
  );
};

export default TodaySnapshotWidget;
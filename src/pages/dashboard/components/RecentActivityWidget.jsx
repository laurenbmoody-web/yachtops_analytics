import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useNavigate } from 'react-router-dom';
import { getRecentActivity } from '../../../utils/activityStorage';
import { formatDistanceToNow } from 'date-fns';

const getActionIcon = (action) => {
  if (action?.includes('CREATED')) return 'Plus';
  if (action?.includes('COMPLETED')) return 'CheckCircle';
  if (action?.includes('DELETED')) return 'Trash2';
  if (action?.includes('ACCEPTED')) return 'Check';
  if (action?.includes('DECLINED')) return 'X';
  if (action?.includes('ASSIGNED')) return 'UserPlus';
  if (action?.includes('STOCK')) return 'TrendingUp';
  if (action?.includes('UPDATED') || action?.includes('EDITED')) return 'Edit';
  return 'Activity';
};

const getActionColor = (action) => {
  if (action?.includes('CREATED')) return 'text-success';
  if (action?.includes('COMPLETED')) return 'text-success';
  if (action?.includes('ACCEPTED')) return 'text-success';
  if (action?.includes('DELETED')) return 'text-error';
  if (action?.includes('DECLINED')) return 'text-error';
  return 'text-primary';
};

const RecentActivityWidget = () => {
  const navigate = useNavigate();
  const [activities, setActivities] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const events = await getRecentActivity(10);
        setActivities(events);
      } catch (err) {
        console.error('[RecentActivityWidget] load error:', err);
        setActivities([]);
      }
    };
    load();
  }, []);

  return (
    <div
      className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => navigate('/activity')}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Recent activity</h3>
        <span className="text-xs text-primary hover:underline">
          View all activity
        </span>
      </div>
      
      {activities?.length > 0 ? (
        <div className="space-y-3">
          {activities?.map((activity, index) => (
            <div key={activity?.id || index} className="flex items-start gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
              <Icon
                name={getActionIcon(activity?.action)}
                className={`w-4 h-4 ${getActionColor(activity?.action)} flex-shrink-0 mt-0.5`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground line-clamp-2">
                  {activity?.summary}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {activity?.createdAt
                    ? formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })
                    : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No recent activity
          </p>
        </div>
      )}
    </div>
  );
};

export default RecentActivityWidget;
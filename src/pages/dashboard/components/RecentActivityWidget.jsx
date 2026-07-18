import React, { useEffect, useState, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { useNavigate } from 'react-router-dom';
import { getRecentActivity } from '../../../utils/activityStorage';
import { formatDistanceToNow } from 'date-fns';
import './recent-activity.css';

const MAX = 6;

// Icon + semantic tint from the action (and summary, which carries the verb).
const actionMeta = (action = '', summary = '') => {
  const a = `${action} ${summary}`.toUpperCase();
  if (a.includes('DELETED') || a.includes('REMOVED') || a.includes('DECLINED')) return { icon: 'Trash2', kind: 'delete' };
  if (a.includes('ASSIGNED')) return { icon: 'UserPlus', kind: 'assign' };
  if (a.includes('COMPLETED') || a.includes('ACCEPTED') || a.includes('DELIVERED')) return { icon: 'Check', kind: 'create' };
  if (a.includes('CREATED') || a.includes('ADDED')) return { icon: 'Plus', kind: 'create' };
  if (a.includes('STOCK') || a.includes('QTY') || a.includes('QUANTITY') || a.includes('UPDATED') || a.includes('EDITED') || a.includes('CHANGED')) return { icon: 'Edit', kind: 'update' };
  return { icon: 'Activity', kind: '' };
};

// Collapse repeated events on the same entity — keep only the most recent (the
// feed is newest-first). Events without an entity stay distinct.
const dedupe = (events) => {
  const seen = new Set();
  const out = [];
  for (const ev of events || []) {
    const key = ev?.entityId ? `${ev.entityType}:${ev.entityId}` : `id:${ev?.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
};

const RecentActivityWidget = () => {
  const navigate = useNavigate();
  const [activities, setActivities] = useState([]);

  const load = useCallback(async () => {
    try {
      // Over-fetch so there's enough left to fill MAX after collapsing.
      const events = await getRecentActivity(24);
      setActivities(dedupe(events).slice(0, MAX));
    } catch (err) {
      console.error('[RecentActivityWidget] load error:', err);
      setActivities([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const statusText = activities.length > 0
    ? `${activities.length} recent event${activities.length === 1 ? '' : 's'}`
    : 'No recent activity';

  return (
    <div className="ce-card ra rounded-xl p-5">
      <div className="ra-head">
        <div>
          <h3 className="ce-title">Recent activity</h3>
          <p className="ce-status">{statusText}</p>
        </div>
        <button type="button" className="ce-link" onClick={() => navigate('/activity')}>View all activity</button>
      </div>

      {activities.length > 0 ? (
        <div className="ra-list">
          {activities.map((a, i) => {
            const m = actionMeta(a?.action, a?.summary);
            return (
              <div key={a?.id || i} className="ra-row">
                <span className="ra-ico" data-kind={m.kind}><Icon name={m.icon} size={15} /></span>
                <span className="ra-txt">
                  <span className="ra-sum">{a?.summary}</span>
                  <span className="ra-time">{a?.createdAt ? formatDistanceToNow(new Date(a.createdAt), { addSuffix: true }) : ''}</span>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="ra-empty">No recent activity yet.</p>
      )}
    </div>
  );
};

export default RecentActivityWidget;

import React, { useEffect, useState, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { useNavigate } from 'react-router-dom';
import { getRecentActivity } from '../../../utils/activityStorage';
import { formatDistanceToNow } from 'date-fns';
import './recent-activity.css';

const MAX = 6;

// Icon reads the *subject* (which part of the app), so the feed varies by what
// happened, not just whether it was a create.
const MODULE_ICON = {
  jobs: 'Briefcase', trips: 'Route', guests: 'Users', provisioning: 'ShoppingCart',
  inventory: 'Package', preferences: 'Star', laundry: 'Shirt', calendar: 'CalendarDays',
  sea_time: 'Clock', crew: 'UserRound', profile: 'UserRound', hor: 'Moon', defects: 'AlertTriangle',
};
const ENTITY_ICON = {
  job: 'Briefcase', trip: 'Route', guest: 'Users', provisioning_list: 'ShoppingCart',
  preference: 'Star', defect: 'AlertTriangle', crew_member: 'UserRound', crew_invite: 'UserPlus',
  profile: 'UserRound', sea_service_entry: 'Clock', hor_entry: 'Moon', ops_event: 'CalendarDays',
};
const KIND_ICON = { create: 'Plus', update: 'Edit', delete: 'Trash2', assign: 'UserPlus' };

// Colour tint reads the *action* — green = created/done, amber = changed,
// red = removed, blue = assigned.
const kindFor = (action = '', summary = '') => {
  const a = `${action} ${summary}`.toUpperCase();
  if (a.includes('DELETED') || a.includes('REMOVED') || a.includes('DECLINED')) return 'delete';
  if (a.includes('ASSIGNED')) return 'assign';
  if (a.includes('STOCK') || a.includes('QTY') || a.includes('QUANTITY') || a.includes('UPDATED') || a.includes('EDITED') || a.includes('CHANGED')) return 'update';
  if (a.includes('CREATED') || a.includes('ADDED') || a.includes('COMPLETED') || a.includes('ACCEPTED') || a.includes('DELIVERED')) return 'create';
  return '';
};

const iconFor = (module, entityType, kind) =>
  MODULE_ICON[String(module || '').toLowerCase()]
  || ENTITY_ICON[String(entityType || '').toLowerCase()]
  || KIND_ICON[kind]
  || 'Activity';

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
            const kind = kindFor(a?.action, a?.summary);
            const icon = iconFor(a?.module, a?.entityType, kind);
            return (
              <div key={a?.id || i} className="ra-row">
                <span className="ra-ico" data-kind={kind}><Icon name={icon} size={15} /></span>
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

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { supabase } from '../../../lib/supabaseClient';
import { loadTrips } from '../../trips-management-dashboard/utils/tripStorage';
import { getBoardStatusConfig } from '../../provisioning/data/statusConfig';
import './provisioning-widget.css';

const VISIBLE = 4; // hard cap on rows shown; the rest roll into "+N more"

const ProvisioningWidget = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const [pending, setPending] = useState({ rows: [], count: 0 });
  const [attention, setAttention] = useState({ rows: [], count: 0 });
  const [unprovisionedTrip, setUnprovisionedTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const userTier = (user?.permission_tier || user?.effectiveTier || '').toUpperCase();
  const isCommandChief = ['COMMAND', 'CHIEF'].includes(userTier);

  const load = useCallback(async () => {
    if (!activeTenantId) { setLoading(false); return; }
    setLoading(true);
    setError(false);
    try {
      // count:'exact' gives the true total so "+N more" is accurate even though
      // we only fetch a handful of rows to display.
      const [pendingRes, attnRes] = await Promise.all([
        supabase.from('provisioning_lists').select('id, title, trip_id', { count: 'exact' })
          .eq('tenant_id', activeTenantId).eq('status', 'pending_approval')
          .order('created_at', { ascending: false }).limit(VISIBLE),
        supabase.from('provisioning_lists').select('id, title, status', { count: 'exact' })
          .eq('tenant_id', activeTenantId).in('status', ['partially_delivered', 'delivered_with_discrepancies'])
          .order('updated_at', { ascending: false }).limit(VISIBLE),
      ]);
      if (pendingRes.error) throw pendingRes.error;
      if (attnRes.error) throw attnRes.error;

      const trips = (await loadTrips()) || [];
      const tripMap = Object.fromEntries(trips.map((t) => [t.id, t.name || t.title]));

      setPending({
        rows: (pendingRes.data || []).map((l) => ({ ...l, trip_name: l.trip_id ? tripMap[l.trip_id] : null })),
        count: pendingRes.count ?? (pendingRes.data || []).length,
      });
      setAttention({ rows: attnRes.data || [], count: attnRes.count ?? (attnRes.data || []).length });

      // Next upcoming trip with no provisioning list. Always resolves to a value
      // (or null) so a stale prompt can't linger from a previous fetch.
      const now = new Date();
      const upcoming = trips
        .filter((t) => t.status === 'upcoming' && t.startDate && new Date(t.startDate) > now)
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
      let unplanned = null;
      if (upcoming.length > 0) {
        const { data: allLists } = await supabase.from('provisioning_lists')
          .select('trip_id').eq('tenant_id', activeTenantId).not('trip_id', 'is', null);
        const covered = new Set((allLists || []).map((l) => l.trip_id));
        const first = upcoming.find((t) => !covered.has(t.id));
        if (first) unplanned = { ...first, daysUntil: Math.ceil((new Date(first.startDate) - now) / 86400000) };
      }
      setUnprovisionedTrip(unplanned);
    } catch (err) {
      console.error('[ProvisioningWidget] fetch error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  // One unified feed — approvals first, then attention, then the unplanned trip.
  const items = [];
  pending.rows.forEach((l) => items.push({
    key: `p-${l.id}`, dot: 'terra', title: l.title,
    sub: `Awaiting approval${l.trip_name ? ` · ${l.trip_name}` : ''}`,
    cta: isCommandChief ? 'Approve' : 'View', primary: isCommandChief,
    onClick: () => navigate(`/provisioning/${l.id}`),
  }));
  attention.rows.forEach((l) => items.push({
    key: `a-${l.id}`, dot: 'amber', title: l.title,
    sub: getBoardStatusConfig(l.status)?.label || 'Needs attention',
    cta: 'View', primary: false, onClick: () => navigate(`/provisioning/${l.id}`),
  }));
  if (unprovisionedTrip) items.push({
    key: 'trip', dot: 'terra', title: `${unprovisionedTrip.name || unprovisionedTrip.title} — no list`,
    sub: `Starts in ${unprovisionedTrip.daysUntil} day${unprovisionedTrip.daysUntil !== 1 ? 's' : ''}`,
    cta: isCommandChief ? 'Create' : null, primary: false,
    onClick: () => navigate(`/provisioning/new?trip_id=${unprovisionedTrip.id}`),
  });

  const totalActionable = pending.count + attention.count + (unprovisionedTrip ? 1 : 0);
  const shown = items.slice(0, VISIBLE);
  const moreCount = totalActionable - shown.length;
  const allClear = !loading && !error && totalActionable === 0;

  let statusText = 'All up to date';
  let statusAttention = false;
  if (loading) statusText = 'Loading…';
  else if (error) statusText = 'Couldn’t load';
  else if (totalActionable > 0) { statusText = `${totalActionable} need${totalActionable === 1 ? 's' : ''} a hand`; statusAttention = true; }

  return (
    <div className="ce-card rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="ce-title">Provisioning</h3>
          <p className={`ce-status${statusAttention ? ' is-attention' : ''}`}>{statusText}</p>
        </div>
        <button type="button" onClick={() => navigate('/provisioning')} className="ce-link">View all</button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <div key={i} className="h-10 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : error ? (
        <div className="prov-err">
          <Icon name="AlertTriangle" size={16} /> Couldn’t load provisioning.
          <button type="button" className="prov-retry" onClick={load}>Retry</button>
        </div>
      ) : allClear ? (
        <div className="prov-clear">
          <Icon name="Check" size={18} /> Nothing needs a hand right now
        </div>
      ) : (
        <div className="prov-list">
          {shown.map((it) => (
            <div key={it.key} className="prov-row">
              <span className={`prov-dot ${it.dot}`} />
              <div className="prov-main">
                <div className="prov-t">{it.title}</div>
                <div className="prov-s">{it.sub}</div>
              </div>
              {it.cta && (
                <button type="button" className={it.primary ? 'prov-approve' : 'prov-view'} onClick={it.onClick}>{it.cta}</button>
              )}
            </div>
          ))}
          {moreCount > 0 && (
            <button type="button" className="prov-more" onClick={() => navigate('/provisioning')}>+{moreCount} more in provisioning</button>
          )}
        </div>
      )}

      {isCommandChief && (
        <div className="mt-4 pt-3 border-t border-border">
          <button type="button" onClick={() => navigate('/provisioning/new')} className="ce-action w-full text-xs">
            <Icon name="Plus" className="w-3.5 h-3.5" />
            New Provisioning List
          </button>
        </div>
      )}
    </div>
  );
};

export default ProvisioningWidget;

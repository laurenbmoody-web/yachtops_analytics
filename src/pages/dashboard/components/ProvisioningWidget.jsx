import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { supabase } from '../../../lib/supabaseClient';
import { loadTrips } from '../../trips-management-dashboard/utils/tripStorage';
import { getBoardStatusConfig } from '../../provisioning/data/statusConfig';
import './provisioning-widget.css';

const VISIBLE = 5; // active boards shown; the rest roll into "+N more"
const ATTENTION = new Set(['pending_approval', 'partially_delivered', 'delivered_with_discrepancies']);

// Status dot colour — semantic (attention amber/red, done green, in-flight
// terracotta), falling back to the board status config's own hex.
const dotColor = (status) => {
  if (status === 'delivered_with_discrepancies') return '#B23A2E';
  if (status === 'pending_approval' || status === 'partially_delivered' || status === 'partially_confirmed') return '#A8791C';
  if (status === 'delivered' || status === 'confirmed') return '#5C9B6A';
  if (status === 'draft') return '#C3C7D0';
  return getBoardStatusConfig(status)?.color || '#AEB4C2';
};

const ProvisioningWidget = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const [boards, setBoards] = useState([]);
  const [total, setTotal] = useState(0);
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
      // Active (non-archived) boards, most-recently-touched first.
      const boardsRes = await supabase.from('provisioning_lists')
        .select('id, title, status, trip_id, updated_at', { count: 'exact' })
        .eq('tenant_id', activeTenantId)
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(VISIBLE);
      if (boardsRes.error) throw boardsRes.error;

      const trips = (await loadTrips()) || [];
      const tripMap = Object.fromEntries(trips.map((t) => [t.id, t.name || t.title]));

      setBoards((boardsRes.data || []).map((b) => ({ ...b, trip_name: b.trip_id ? tripMap[b.trip_id] : null })));
      setTotal(boardsRes.count ?? (boardsRes.data || []).length);

      // Next upcoming trip with no provisioning list (always resolves, so a
      // stale prompt can't linger).
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

  const attentionCount = boards.filter((b) => ATTENTION.has(b.status)).length;
  const moreCount = total - boards.length;

  let statusText = '';
  let statusAttention = false;
  if (loading) statusText = 'Loading…';
  else if (error) statusText = 'Couldn’t load';
  else if (total === 0) statusText = 'No lists yet';
  else if (attentionCount > 0) { statusText = `${attentionCount} need${attentionCount === 1 ? 's' : ''} attention`; statusAttention = true; }
  else statusText = `${total} active list${total === 1 ? '' : 's'}`;

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
      ) : (
        <>
          {boards.length > 0 ? (
            <div className="prov-list">
              {boards.map((b) => {
                const label = getBoardStatusConfig(b.status)?.label || b.status;
                const canApprove = b.status === 'pending_approval' && isCommandChief;
                return (
                  <div key={b.id} className="prov-row">
                    <span className="prov-dot" style={{ background: dotColor(b.status) }} />
                    <div className="prov-main">
                      <div className="prov-t" title={b.title}>{b.title}</div>
                      <div className="prov-s">{label}{b.trip_name ? ` · ${b.trip_name}` : ''}</div>
                    </div>
                    {canApprove ? (
                      <button type="button" className="prov-approve" onClick={() => navigate(`/provisioning/${b.id}`)}>Approve</button>
                    ) : (
                      <button type="button" className="prov-view" onClick={() => navigate(`/provisioning/${b.id}`)}>View</button>
                    )}
                  </div>
                );
              })}
              {moreCount > 0 && (
                <button type="button" className="prov-more" onClick={() => navigate('/provisioning')}>+{moreCount} more in provisioning</button>
              )}
            </div>
          ) : (
            <p className="prov-empty">No provisioning lists yet.</p>
          )}

          {unprovisionedTrip && (
            <div className="prov-trip">
              <Icon name="AlertTriangle" size={16} />
              <span className="prov-trip-t">
                <b>{unprovisionedTrip.name || unprovisionedTrip.title}</b> in {unprovisionedTrip.daysUntil} day{unprovisionedTrip.daysUntil !== 1 ? 's' : ''} — no list yet
              </span>
              {isCommandChief && (
                <button type="button" className="prov-trip-btn" onClick={() => navigate(`/provisioning/new?trip_id=${unprovisionedTrip.id}`)}>Create</button>
              )}
            </div>
          )}
        </>
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

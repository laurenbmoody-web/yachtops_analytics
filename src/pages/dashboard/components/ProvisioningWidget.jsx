import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';
import { supabase } from '../../../lib/supabaseClient';
import { loadTrips } from '../../trips-management-dashboard/utils/tripStorage';

const ProvisioningWidget = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const [pendingLists, setPendingLists] = useState([]);
  const [attentionLists, setAttentionLists] = useState([]);
  const [unprovisionedTrip, setUnprovisionedTrip] = useState(null);
  const [loading, setLoading] = useState(true);

  const userTier = (user?.permission_tier || user?.effectiveTier || '').toUpperCase();
  const isCommandChief = ['COMMAND', 'CHIEF'].includes(userTier);

  useEffect(() => {
    if (!activeTenantId) return;
    fetchData();
  }, [activeTenantId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [pendingResult, attentionResult] = await Promise.allSettled([
        supabase
          ?.from('provisioning_lists')
          ?.select('id, title, trip_id')
          ?.eq('vessel_id', activeTenantId)
          ?.eq('status', 'pending_approval')
          ?.order('created_at', { ascending: false })
          ?.limit(3),
        supabase
          ?.from('provisioning_lists')
          ?.select('id, title, status')
          ?.eq('vessel_id', activeTenantId)
          ?.in('status', ['partially_delivered', 'delivered_with_discrepancies'])
          ?.order('updated_at', { ascending: false })
          ?.limit(3),
      ]);

      const pending = pendingResult.status === 'fulfilled' ? (pendingResult.value.data || []) : [];
      const attention = attentionResult.status === 'fulfilled' ? (attentionResult.value.data || []) : [];

      // Enrich pending with trip names
      const trips = loadTrips() || [];
      const tripMap = Object.fromEntries(trips.map(t => [t.id, t.name || t.title]));

      setPendingLists(pending.map(l => ({ ...l, trip_name: l.trip_id ? tripMap[l.trip_id] : null })));
      setAttentionLists(attention);

      // Find next upcoming trip with no provisioning list
      const now = new Date();
      const upcomingTrips = trips
        .filter(t => t.status === 'upcoming' && t.startDate && new Date(t.startDate) > now)
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

      if (upcomingTrips.length > 0) {
        // Fetch all provisioning list trip IDs for this vessel
        const { data: allLists } = await supabase
          ?.from('provisioning_lists')
          ?.select('trip_id')
          ?.eq('vessel_id', activeTenantId)
          ?.not('trip_id', 'is', null);

        const coveredTripIds = new Set((allLists || []).map(l => l.trip_id));
        const first = upcomingTrips.find(t => !coveredTripIds.has(t.id));

        if (first) {
          const daysUntil = Math.ceil((new Date(first.startDate) - now) / 86400000);
          setUnprovisionedTrip({ ...first, daysUntil });
        } else {
          setUnprovisionedTrip(null);
        }
      }
    } catch (err) {
      console.warn('[ProvisioningWidget] fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const allClear = !loading && pendingLists.length === 0 && attentionLists.length === 0 && !unprovisionedTrip;

  const STATUS_LABELS = {
    partially_delivered: { label: 'Partial delivery', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
    delivered_with_discrepancies: { label: 'Discrepancies', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Provisioning</h3>
        <button onClick={() => navigate('/provisioning')} className="text-xs text-primary hover:underline">View all</button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-10 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : allClear ? (
        <div className="flex items-center gap-2 py-3">
          <div className="w-7 h-7 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center shrink-0">
            <Icon name="Check" className="w-3.5 h-3.5 text-green-600" />
          </div>
          <p className="text-sm text-muted-foreground">All provisioning up to date</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Pending Approval */}
          {pendingLists.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pending Approval</p>
              {pendingLists.map(list => (
                <div key={list.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/50 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{list.title}</p>
                    {list.trip_name && <p className="text-xs text-muted-foreground">{list.trip_name}</p>}
                  </div>
                  {isCommandChief && (
                    <button
                      onClick={() => navigate(`/provisioning/${list.id}`)}
                      className="shrink-0 px-2.5 py-1 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors"
                    >
                      Approve
                    </button>
                  )}
                  {!isCommandChief && (
                    <button onClick={() => navigate(`/provisioning/${list.id}`)} className="shrink-0 text-xs text-primary hover:underline">View</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Needs Attention */}
          {attentionLists.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Needs Attention</p>
              {attentionLists.map(list => {
                const cfg = STATUS_LABELS[list.status] || { label: list.status, className: 'bg-muted text-muted-foreground' };
                return (
                  <div key={list.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/50 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{list.title}</p>
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full mt-0.5 ${cfg.className}`}>{cfg.label}</span>
                    </div>
                    <button onClick={() => navigate(`/provisioning/${list.id}`)} className="shrink-0 text-xs text-primary hover:underline">View</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Upcoming trip prompt */}
          {unprovisionedTrip && (
            <div className="flex items-start gap-2 py-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg px-3">
              <Icon name="AlertCircle" className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  <strong>{unprovisionedTrip.name || unprovisionedTrip.title}</strong> in {unprovisionedTrip.daysUntil} day{unprovisionedTrip.daysUntil !== 1 ? 's' : ''} — no provisioning list yet
                </p>
              </div>
              {isCommandChief && (
                <button
                  onClick={() => navigate(`/provisioning/new?trip_id=${unprovisionedTrip.id}`)}
                  className="shrink-0 text-xs text-amber-700 dark:text-amber-400 hover:underline font-medium"
                >
                  + Create
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {isCommandChief && (
        <div className="mt-4 pt-3 border-t border-border">
          <button
            onClick={() => navigate('/provisioning/new')}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
          >
            <Icon name="Plus" className="w-3.5 h-3.5" />
            New Provisioning List
          </button>
        </div>
      )}
    </div>
  );
};

export default ProvisioningWidget;

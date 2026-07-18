import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { useNavigate } from 'react-router-dom';
import { getInventoryHealthStats } from '../../inventory/utils/inventoryStorage';

const EMPTY = { healthy: 0, lowStock: 0, outOfStock: 0, total: 0, expiringSoon: 0, expired: 0 };

const InventoryHealthWidget = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const data = await getInventoryHealthStats();
      setStats(data || EMPTY);
    } catch (err) {
      console.error('[InventoryHealthWidget] error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const hasItems = stats?.total > 0;
  const attentionCount = (stats?.outOfStock || 0) + (stats?.lowStock || 0) + (stats?.expired || 0) + (stats?.expiringSoon || 0);
  const isHealthy = hasItems && attentionCount === 0;

  // Attention rows — stock first, then freshness. Coloured only when non-zero.
  const rows = [
    { label: 'Out of stock', count: stats?.outOfStock, sev: 'red' },
    { label: 'Low stock', count: stats?.lowStock, sev: 'amber' },
    { label: 'Expiring ≤ 30d', count: stats?.expiringSoon, sev: 'amber' },
    { label: 'Expired', count: stats?.expired, sev: 'red' },
  ];

  // Status subline — most urgent first.
  let statusText = 'All healthy';
  let statusAttention = false;
  if (loading) statusText = 'Loading…';
  else if (error) statusText = 'Couldn’t load';
  else if (!hasItems) statusText = 'Nothing tracked yet';
  else if (stats?.expired > 0) { statusText = `${stats.expired} expired`; statusAttention = true; }
  else if (stats?.outOfStock > 0) { statusText = `${stats.outOfStock} out of stock`; statusAttention = true; }
  else if (stats?.expiringSoon > 0) { statusText = `${stats.expiringSoon} expiring soon`; statusAttention = true; }
  else if (stats?.lowStock > 0) { statusText = `${stats.lowStock} low stock`; statusAttention = true; }

  const sevColor = (sev, on) => (on ? (sev === 'red' ? '#B23A2E' : '#A8791C') : '#D6D8E0');

  return (
    <div
      className="ce-card rounded-xl p-5 cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={() => navigate('/inventory')}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/inventory'); } }}
    >
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="ce-title">Inventory health</h3>
          <p className={`ce-status${statusAttention ? ' is-attention' : ''}`}>{statusText}</p>
        </div>
        <span className="ce-link">View all</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10"><LogoSpinner size={32} /></div>
      ) : error ? (
        <div className="flex items-center gap-2 py-8 justify-center text-sm" style={{ color: '#9A2B12' }}>
          <Icon name="AlertTriangle" size={16} /> Couldn’t load inventory.
          <button type="button" onClick={(e) => { e.stopPropagation(); load(); }} className="font-bold underline">Retry</button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-center py-4 mb-4">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center ${
              isHealthy ? 'ce-bg-success' : hasItems ? 'ce-bg-warn' : 'bg-muted'
            }`}>
              <Icon
                name={isHealthy ? 'CheckCircle' : hasItems ? 'AlertTriangle' : 'Package'}
                className={`w-10 h-10 ${isHealthy ? 'ce-fg-success' : hasItems ? 'ce-fg-warn' : 'text-muted-foreground'}`}
              />
            </div>
          </div>

          <div className="text-center mb-4">
            {!hasItems ? (
              <>
                <p className="ce-title">Nothing tracked yet.</p>
                <p className="ce-status is-attention mt-1">Begin the inventory →</p>
              </>
            ) : (
              <>
                <p className={`text-lg font-semibold ${isHealthy ? 'ce-fg-success' : 'ce-fg-warn'}`}>
                  {isHealthy ? 'Healthy' : 'Needs attention'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {`${stats?.total} item${stats?.total !== 1 ? 's' : ''} tracked`}
                </p>
              </>
            )}
          </div>

          {hasItems && (
            <div className="space-y-1.5">
              {rows.map((r) => {
                const on = (r.count || 0) > 0;
                return (
                  <div key={r.label} className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ background: '#FAFAF8' }}>
                    <span className="flex items-center gap-2 text-xs" style={{ color: '#6B7280' }}>
                      <span className="rounded-full" style={{ width: 6, height: 6, background: sevColor(r.sev, on) }} />
                      {r.label}
                    </span>
                    <span className="text-sm font-bold" style={{ color: on ? sevColor(r.sev, true) : '#1C1B3A' }}>{r.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default InventoryHealthWidget;

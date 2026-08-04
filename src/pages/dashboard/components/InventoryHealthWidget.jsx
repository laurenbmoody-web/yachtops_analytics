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
  // When anything needs attention, jump to the actionable board; otherwise browse.
  const target = attentionCount > 0 ? '/inventory/attention' : '/inventory';

  // KPI tiles — stock first, then freshness. Tinted only when non-zero.
  const tiles = [
    { label: 'Out of stock', count: stats?.outOfStock || 0, fg: '#B23A2E', bg: 'rgba(178,58,46,0.08)' },
    { label: 'Low stock', count: stats?.lowStock || 0, fg: '#A8791C', bg: 'rgba(168,121,28,0.10)' },
    { label: 'Expiring ≤ 30d', count: stats?.expiringSoon || 0, fg: '#1C6DB4', bg: 'rgba(28,109,180,0.09)' },
    { label: 'Expired', count: stats?.expired || 0, fg: '#B23A2E', bg: 'rgba(178,58,46,0.08)' },
  ];
  // Health bar: green (healthy) · amber (low + expiring) · red (out + expired).
  const healthyN = Math.max(0, (stats?.total || 0) - attentionCount);
  const amberN = (stats?.lowStock || 0) + (stats?.expiringSoon || 0);
  const redN = (stats?.outOfStock || 0) + (stats?.expired || 0);
  const pct = (n) => (stats?.total > 0 ? (n / stats.total) * 100 : 0);

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

  return (
    <div
      className="ce-card rounded-xl p-5 cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={() => navigate(target)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(target); } }}
    >
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="ce-title">Inventory health</h3>
          <p className={`ce-status${statusAttention ? ' is-attention' : ''}`}>{statusText}</p>
        </div>
        <span className="ce-link">{attentionCount > 0 ? 'Review' : 'View all'}</span>
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
          {!hasItems ? (
            <div className="text-center py-6">
              <p className="ce-title">Nothing tracked yet.</p>
              <p className="ce-status is-attention mt-1">Begin the inventory →</p>
            </div>
          ) : (
            <>
              {/* headline + health bar */}
              <div className="mb-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold" style={{ color: isHealthy ? '#5C9B6A' : '#A8791C', lineHeight: 1 }}>
                    {isHealthy ? 'All good' : attentionCount}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {isHealthy ? `${stats?.total} tracked` : `need attention · ${stats?.total} tracked`}
                  </span>
                </div>
                <div className="flex w-full rounded-full overflow-hidden mt-3" style={{ height: 10, background: '#EEF0F4' }}>
                  {healthyN > 0 && <div style={{ width: `${pct(healthyN)}%`, background: '#5C9B6A' }} title={`${healthyN} healthy`} />}
                  {amberN > 0 && <div style={{ width: `${pct(amberN)}%`, background: '#D69A2D' }} title={`${amberN} low / expiring`} />}
                  {redN > 0 && <div style={{ width: `${pct(redN)}%`, background: '#B23A2E' }} title={`${redN} out / expired`} />}
                </div>
              </div>

              {/* KPI stat tiles */}
              <div className="grid grid-cols-2 gap-2">
                {tiles.map((t) => {
                  const on = t.count > 0;
                  return (
                    <div key={t.label} className="rounded-lg px-3 py-2.5" style={{ background: on ? t.bg : '#FAFAF8' }}>
                      <div className="text-2xl font-bold" style={{ color: on ? t.fg : '#1C1B3A', lineHeight: 1 }}>{t.count}</div>
                      <div className="mt-1.5 flex items-center gap-1.5" style={{ fontSize: 11, color: '#6B7280' }}>
                        <span className="rounded-full" style={{ width: 6, height: 6, background: on ? t.fg : '#D6D8E0' }} />
                        {t.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default InventoryHealthWidget;

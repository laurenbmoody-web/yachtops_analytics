import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { useNavigate } from 'react-router-dom';
import { getInventoryHealthStats } from '../../inventory/utils/inventoryStorage';

const InventoryHealthWidget = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ healthy: 0, lowStock: 0, outOfStock: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const data = await getInventoryHealthStats();
        setStats(data);
      } catch (err) {
        console.error('[InventoryHealthWidget] error:', err);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, []);

  // Uniform calm indicators — outline circle, muted tone, no per-status colour.
  // Tint is applied to the row's icon wrapper (.ce-ico-muted) so the lucide
  // stroke inherits it via currentColor — colouring the <svg> directly does
  // not reliably tint lucide strokes in this app.
  const healthStats = [
    { label: 'Healthy', count: stats?.healthy, icon: 'Circle' },
    { label: 'Low stock', count: stats?.lowStock, icon: 'Circle' },
    { label: 'Out of stock', count: stats?.outOfStock, icon: 'Circle' }
  ];

  const isHealthy = stats?.total > 0 && stats?.lowStock === 0 && stats?.outOfStock === 0;
  const hasItems = stats?.total > 0;

  // Live status subline — orange-italic on low/out-of-stock, navy otherwise.
  let statusText = 'All healthy';
  let statusAttention = false;
  if (loading) {
    statusText = 'Loading…';
  } else if (!hasItems) {
    statusText = 'Nothing tracked yet';
  } else if (stats?.outOfStock > 0) {
    statusText = `${stats.outOfStock} out of stock`;
    statusAttention = true;
  } else if (stats?.lowStock > 0) {
    statusText = `${stats.lowStock} low stock`;
    statusAttention = true;
  }

  return (
    <div
      className="ce-card rounded-xl p-5 cursor-pointer"
      onClick={() => navigate('/inventory')}
    >
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="ce-title">Inventory health</h3>
          <p className={`ce-status${statusAttention ? ' is-attention' : ''}`}>{statusText}</p>
        </div>
        <span className="ce-link">
          View all
        </span>
      </div>
      <div className="flex items-center justify-center py-6 mb-5">
        <div className="relative">
          {loading ? (
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
              <LogoSpinner size={32} />
            </div>
          ) : (
            <div className={`w-20 h-20 rounded-full flex items-center justify-center ${
              isHealthy ? 'ce-bg-success' : hasItems ? 'ce-bg-warn' : 'bg-muted'
            }`}>
              <Icon
                name={isHealthy ? 'CheckCircle' : hasItems ? 'AlertTriangle' : 'Package'}
                className={`w-10 h-10 ${
                  isHealthy ? 'ce-fg-success' : hasItems ? 'ce-fg-warn' : 'text-muted-foreground'
                }`}
              />
            </div>
          )}
        </div>
      </div>
      <div className="text-center mb-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !hasItems ? (
          <>
            <p className="ce-title">Nothing tracked yet.</p>
            <p className="ce-status is-attention mt-1">Begin the inventory →</p>
          </>
        ) : (
          <>
            <p className={`text-lg font-semibold ${
              isHealthy ? 'ce-fg-success' : 'ce-fg-warn'
            }`}>
              {isHealthy ? 'Healthy' : 'Needs attention'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {`${stats?.total} item${stats?.total !== 1 ? 's' : ''} tracked`}
            </p>
          </>
        )}
      </div>
      <div className="space-y-2">
        {healthStats?.map((stat, index) => (
          <div 
            key={index} 
            className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30"
          >
            <div className="flex items-center gap-2 ce-ico-muted">
              <Icon name={stat?.icon} className="w-4 h-4" />
              <span className="text-xs text-foreground">{stat?.label}</span>
            </div>
            <span className="text-sm font-bold text-foreground">
              {loading ? '—' : stat?.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InventoryHealthWidget;
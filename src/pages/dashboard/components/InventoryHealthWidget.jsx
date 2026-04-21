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

  const healthStats = [
    { label: 'Healthy', count: stats?.healthy, icon: 'CheckCircle', color: 'text-success' },
    { label: 'Low stock', count: stats?.lowStock, icon: 'AlertTriangle', color: 'text-warning' },
    { label: 'Out of stock', count: stats?.outOfStock, icon: 'AlertCircle', color: 'text-error' }
  ];

  const isHealthy = stats?.total > 0 && stats?.lowStock === 0 && stats?.outOfStock === 0;
  const hasItems = stats?.total > 0;

  return (
    <div
      className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => navigate('/inventory')}
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold text-foreground">Inventory health</h3>
        <span className="text-xs text-primary hover:underline">
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
              isHealthy ? 'bg-success/10' : hasItems ? 'bg-warning/10' : 'bg-muted'
            }`}>
              <Icon 
                name={isHealthy ? 'CheckCircle' : hasItems ? 'AlertTriangle' : 'Package'} 
                className={`w-10 h-10 ${
                  isHealthy ? 'text-success' : hasItems ? 'text-warning' : 'text-muted-foreground'
                }`} 
              />
            </div>
          )}
        </div>
      </div>
      <div className="text-center mb-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <p className={`text-lg font-semibold ${
              isHealthy ? 'text-success' : hasItems ? 'text-warning' : 'text-muted-foreground'
            }`}>
              {isHealthy ? 'Healthy' : hasItems ? 'Needs attention' : 'No items tracked'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {hasItems
                ? `${stats?.total} item${stats?.total !== 1 ? 's' : ''} tracked`
                : 'Start tracking inventory'}
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
            <div className="flex items-center gap-2">
              <Icon name={stat?.icon} className={`w-4 h-4 ${stat?.color}`} />
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
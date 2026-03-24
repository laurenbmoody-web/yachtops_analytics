import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';

const LogsDeliveries = () => {
  const navigate = useNavigate();
  const [filterType, setFilterType] = useState('all');
  const [dateRange, setDateRange] = useState('7days');

  // Mock logs data
  const logs = [
    { id: 1, type: 'delivery', timestamp: '2026-01-05 12:00', description: 'Bonded Delivery', details: 'Premium spirits and wines - 24 bottles', loggedBy: 'Sarah', location: 'Bar Storage' },
    { id: 2, type: 'maintenance', timestamp: '2026-01-05 14:30', description: 'Engine service check', details: 'Routine engine maintenance completed - all systems operational', loggedBy: 'John', location: 'Engineering' },
    { id: 3, type: 'accounting', timestamp: '2026-01-05 16:00', description: 'APA reconciliation', details: 'Charter APA reconciliation - $2,400 approved', loggedBy: 'Admin', location: 'Office' },
    { id: 4, type: 'delivery', timestamp: '2026-01-05 09:00', description: 'Provisions delivery', details: 'Fresh seafood and produce - 45kg total', loggedBy: 'Georgina', location: 'Galley' },
    { id: 5, type: 'maintenance', timestamp: '2026-01-05 11:00', description: 'HVAC inspection', details: 'HVAC systems inspected and filters replaced', loggedBy: 'Mike', location: 'Engineering' },
    { id: 6, type: 'delivery', timestamp: '2026-01-04 15:30', description: 'Cleaning supplies', details: 'Premium cleaning products and linens', loggedBy: 'Lisa', location: 'Housekeeping' },
    { id: 7, type: 'accounting', timestamp: '2026-01-04 10:00', description: 'Fuel invoice approved', details: 'Fuel Direct invoice - $8,200 approved', loggedBy: 'Admin', location: 'Office' },
    { id: 8, type: 'delivery', timestamp: '2026-01-03 13:00', description: 'Safety equipment', details: 'Life jackets and emergency supplies restocked', loggedBy: 'John', location: 'Safety Locker' },
    { id: 9, type: 'maintenance', timestamp: '2026-01-03 08:00', description: 'Bilge pump service', details: 'Bilge pump serviced and tested - operational', loggedBy: 'Mike', location: 'Engineering' },
    { id: 10, type: 'delivery', timestamp: '2026-01-02 16:00', description: 'Gourmet provisions', details: 'Wagyu beef, caviar, and premium ingredients', loggedBy: 'Georgina', location: 'Galley' },
    { id: 11, type: 'accounting', timestamp: '2026-01-02 11:30', description: 'Marina fees paid', details: 'Port Authority docking fees - $650', loggedBy: 'Admin', location: 'Office' },
    { id: 12, type: 'maintenance', timestamp: '2026-01-01 14:00', description: 'Navigation system calibration', details: 'Navigation systems calibrated and updated', loggedBy: 'John', location: 'Bridge' }
  ];

  const getTypeIcon = (type) => {
    switch (type) {
      case 'delivery':
        return 'Package';
      case 'maintenance':
        return 'Wrench';
      case 'accounting':
        return 'Coins';
      default:
        return 'FileText';
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'delivery':
        return 'text-primary';
      case 'maintenance':
        return 'text-warning';
      case 'accounting':
        return 'text-success';
      default:
        return 'text-muted-foreground';
    }
  };

  const getTypeBg = (type) => {
    switch (type) {
      case 'delivery':
        return 'bg-primary/10';
      case 'maintenance':
        return 'bg-warning/10';
      case 'accounting':
        return 'bg-success/10';
      default:
        return 'bg-muted/10';
    }
  };

  const filteredLogs = logs?.filter(log => {
    return filterType === 'all' || log?.type === filterType;
  });

  const logStats = [
    { label: 'Total Logs', value: logs?.length, icon: 'FileText', color: 'primary' },
    { label: 'Deliveries', value: logs?.filter(l => l?.type === 'delivery')?.length, icon: 'Package', color: 'primary' },
    { label: 'Maintenance', value: logs?.filter(l => l?.type === 'maintenance')?.length, icon: 'Wrench', color: 'warning' },
    { label: 'Accounting', value: logs?.filter(l => l?.type === 'accounting')?.length, icon: 'Coins', color: 'success' }
  ];

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold text-foreground mb-2">Logs & Deliveries</h1>
            <p className="text-sm text-muted-foreground">Immutable operational log for traceability and trust</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" iconName="Download">
              Export
            </Button>
            <Button variant="default" iconName="Plus">
              Log Delivery
            </Button>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-4 gap-5 mb-6">
          {logStats?.map((stat, idx) => (
            <div key={idx} className="bg-card rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-center justify-between mb-2">
                <Icon name={stat?.icon} size={24} className={`text-${stat?.color}`} />
                <span className="text-2xl font-bold text-foreground">{stat?.value}</span>
              </div>
              <div className="text-sm text-muted-foreground">{stat?.label}</div>
            </div>
          ))}
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-4 gap-5">
          {/* Filters Sidebar */}
          <div className="space-y-5">
            <div className="bg-card rounded-xl border border-border shadow-sm p-5">
              <h3 className="text-base font-semibold text-foreground mb-4">Filters</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">Log Type</label>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e?.target?.value)}
                    className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground"
                  >
                    <option value="all">All Types</option>
                    <option value="delivery">Delivery</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="accounting">Accounting</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">Date Range</label>
                  <select
                    value={dateRange}
                    onChange={(e) => setDateRange(e?.target?.value)}
                    className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground"
                  >
                    <option value="today">Today</option>
                    <option value="7days">Last 7 Days</option>
                    <option value="30days">Last 30 Days</option>
                    <option value="90days">Last 90 Days</option>
                    <option value="all">All Time</option>
                  </select>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  fullWidth 
                  onClick={() => {
                    setFilterType('all');
                    setDateRange('7days');
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            </div>

            {/* Info Card */}
            <div className="bg-card rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-start gap-2 mb-3">
                <Icon name="Info" size={20} className="text-accent" />
                <h3 className="text-base font-semibold text-foreground">About Logs</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Logs are read-only once created. They provide an immutable record of all operational activities for traceability and compliance.
              </p>
            </div>
          </div>

          {/* Logs Timeline */}
          <div className="col-span-3">
            <div className="bg-card rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-foreground">Chronological Log ({filteredLogs?.length})</h3>
                <div className="text-sm text-muted-foreground">Most recent first</div>
              </div>

              <div className="space-y-3">
                {filteredLogs?.map((log, idx) => (
                  <div key={log?.id} className="relative">
                    {/* Timeline connector */}
                    {idx !== filteredLogs?.length - 1 && (
                      <div className="absolute left-6 top-12 bottom-0 w-0.5 bg-border" />
                    )}
                    
                    <div className="flex gap-4 p-4 hover:bg-muted/30 rounded-lg transition-smooth">
                      {/* Icon */}
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${getTypeBg(log?.type)}`}>
                        <Icon name={getTypeIcon(log?.type)} size={20} className={getTypeColor(log?.type)} />
                      </div>
                      
                      {/* Content */}
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="text-base font-semibold text-foreground">{log?.description}</h4>
                            <p className="text-sm text-muted-foreground mt-1">{log?.details}</p>
                          </div>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${getTypeBg(log?.type)} ${getTypeColor(log?.type)} capitalize`}>
                            {log?.type}
                          </span>
                        </div>
                        <div className="flex items-center gap-6 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Icon name="Clock" size={12} />
                            <span>{log?.timestamp}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Icon name="User" size={12} />
                            <span>{log?.loggedBy}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Icon name="MapPin" size={12} />
                            <span>{log?.location}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {filteredLogs?.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Icon name="FileText" size={48} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No logs match your filters</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default LogsDeliveries;
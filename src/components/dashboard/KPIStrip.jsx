import React from 'react';
import Icon from '../AppIcon';

const KPIStrip = () => {
  const kpis = [
    {
      id: 1,
      label: 'Fleet Operational Status',
      value: '92%',
      trend: '+3.2%',
      trendDirection: 'up',
      icon: 'Ship',
      description: '23 of 25 vessels operational'
    },
    {
      id: 2,
      label: 'Average Fuel Efficiency',
      value: '18.4',
      unit: 'L/nm',
      trend: '-2.1%',
      trendDirection: 'down',
      icon: 'Fuel',
      description: 'Fleet-wide consumption rate'
    },
    {
      id: 3,
      label: 'Active Maintenance Tasks',
      value: '47',
      trend: '+12',
      trendDirection: 'up',
      icon: 'Wrench',
      description: 'Scheduled and unscheduled'
    },
    {
      id: 4,
      label: 'Critical Alerts',
      value: '3',
      trend: '-2',
      trendDirection: 'down',
      icon: 'AlertTriangle',
      description: 'Requiring immediate attention'
    }
  ];

  return (
    <div className="kpi-strip">
      {kpis?.map((kpi) => (
        <div key={kpi?.id} className="kpi-card">
          <div className="flex items-start justify-between mb-4">
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
              <Icon name={kpi?.icon} size={24} color="var(--color-primary)" />
            </div>
            <div
              className={`kpi-trend ${
                kpi?.trendDirection === 'up' ?'kpi-trend-positive' :'kpi-trend-negative'
              }`}
            >
              <Icon
                name={kpi?.trendDirection === 'up' ? 'TrendingUp' : 'TrendingDown'}
                size={16}
              />
              <span className="font-medium">{kpi?.trend}</span>
            </div>
          </div>

          <div className="kpi-label">{kpi?.label}</div>
          <div className="kpi-value">
            {kpi?.value}
            {kpi?.unit && <span className="text-lg ml-1">{kpi?.unit}</span>}
          </div>
          <p className="text-sm text-muted-foreground">{kpi?.description}</p>
        </div>
      ))}
    </div>
  );
};

export default KPIStrip;
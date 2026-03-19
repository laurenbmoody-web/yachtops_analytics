import React, { useState } from 'react';
import Icon from '../AppIcon';
import Button from '../ui/Button';

const AlertPanel = ({ isOpen, onClose }) => {
  const [alerts] = useState([
    {
      id: 1,
      type: 'critical',
      title: 'Engine Temperature Critical',
      message: 'Neptune Star - Port engine temperature exceeds safe operating limits',
      time: '2026-01-04 17:15:23',
      yacht: 'Neptune Star',
      actions: ['View Details', 'Acknowledge']
    },
    {
      id: 2,
      type: 'warning',
      title: 'Fuel Level Low',
      message: 'Ocean Majesty - Fuel reserves below 25% threshold',
      time: '2026-01-04 16:45:12',
      yacht: 'Ocean Majesty',
      actions: ['Schedule Refuel', 'Dismiss']
    },
    {
      id: 3,
      type: 'info',
      title: 'Maintenance Due',
      message: 'Azure Horizon - Scheduled maintenance window approaching in 48 hours',
      time: '2026-01-04 15:30:45',
      yacht: 'Azure Horizon',
      actions: ['View Schedule', 'Dismiss']
    },
    {
      id: 4,
      type: 'warning',
      title: 'Weather Advisory',
      message: 'Crystal Voyager - Severe weather conditions forecasted in current route',
      time: '2026-01-04 14:20:18',
      yacht: 'Crystal Voyager',
      actions: ['View Forecast', 'Acknowledge']
    },
    {
      id: 5,
      type: 'info',
      title: 'Crew Change Scheduled',
      message: 'Serenity Wave - Crew rotation scheduled for next port arrival',
      time: '2026-01-04 13:10:55',
      yacht: 'Serenity Wave',
      actions: ['View Details', 'Dismiss']
    },
    {
      id: 6,
      type: 'critical',
      title: 'Navigation System Error',
      message: 'Neptune Star - Primary navigation system reporting calibration errors',
      time: '2026-01-04 12:05:33',
      yacht: 'Neptune Star',
      actions: ['Diagnose', 'Contact Support']
    }
  ]);

  const handleAction = (alertId, action) => {
    console.log(`Action ${action} triggered for alert ${alertId}`);
  };

  const getAlertIcon = (type) => {
    switch (type) {
      case 'critical':
        return 'AlertTriangle';
      case 'warning':
        return 'AlertCircle';
      case 'info':
        return 'Info';
      default:
        return 'Bell';
    }
  };

  return (
    <div
      className={`alert-panel ${
        isOpen ? '' : 'alert-panel-hidden'
      } lg:block`}
    >
      <div className="alert-panel-header">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="alert-panel-title">Operational Alerts</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {alerts?.length} active notifications
            </p>
          </div>
          <button
            className="lg:hidden p-2 hover:bg-muted rounded-lg transition-smooth"
            onClick={onClose}
          >
            <Icon name="X" size={20} color="var(--color-foreground)" />
          </button>
        </div>
      </div>
      <div className="alert-panel-content">
        {alerts?.map((alert) => (
          <div
            key={alert?.id}
            className={`alert-item alert-item-${alert?.type}`}
          >
            <div className="alert-item-header">
              <div className="flex items-start gap-3 flex-1">
                <Icon
                  name={getAlertIcon(alert?.type)}
                  size={20}
                  color={
                    alert?.type === 'critical' ?'var(--color-error)'
                      : alert?.type === 'warning' ?'var(--color-warning)' :'var(--color-accent)'
                  }
                />
                <div className="flex-1">
                  <h3 className="alert-item-title">{alert?.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {alert?.yacht}
                  </p>
                </div>
              </div>
              <span className="alert-item-time">{alert?.time}</span>
            </div>

            <p className="alert-item-message">{alert?.message}</p>

            <div className="alert-item-actions">
              {alert?.actions?.map((action, index) => (
                <Button
                  key={index}
                  variant={index === 0 ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleAction(alert?.id, action)}
                >
                  {action}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AlertPanel;
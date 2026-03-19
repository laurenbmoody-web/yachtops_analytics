import React from 'react';
import Icon from '../../../components/AppIcon';

const ConnectionStatusIndicator = ({ status }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'connected':
        return {
          icon: 'Wifi',
          color: 'var(--color-success)',
          bgColor: 'bg-success/10',
          label: 'Connected',
          pulse: false
        };
      case 'connecting':
        return {
          icon: 'Loader',
          color: 'var(--color-warning)',
          bgColor: 'bg-warning/10',
          label: 'Connecting',
          pulse: true
        };
      case 'disconnected':
        return {
          icon: 'WifiOff',
          color: 'var(--color-error)',
          bgColor: 'bg-error/10',
          label: 'Disconnected',
          pulse: false
        };
      default:
        return {
          icon: 'Wifi',
          color: 'var(--color-muted-foreground)',
          bgColor: 'bg-muted',
          label: 'Unknown',
          pulse: false
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${config?.bgColor}`}>
      <div className="relative">
        <Icon
          name={config?.icon}
          size={16}
          color={config?.color}
          className={config?.pulse ? 'animate-spin' : ''}
        />
        {config?.pulse && (
          <span className="absolute inset-0 rounded-full animate-ping opacity-75">
            <Icon name={config?.icon} size={16} color={config?.color} />
          </span>
        )}
      </div>
      <span className="text-xs font-medium hidden md:inline" style={{ color: config?.color }}>
        {config?.label}
      </span>
    </div>
  );
};

export default ConnectionStatusIndicator;
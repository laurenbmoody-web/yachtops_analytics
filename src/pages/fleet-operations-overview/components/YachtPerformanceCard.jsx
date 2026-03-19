import React from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import Button from '../../../components/ui/Button';

const YachtPerformanceCard = ({ yacht, onViewDetails }) => {
  const getStatusColor = (status) => {
    switch (status) {
      case 'operational':
        return 'text-success';
      case 'warning':
        return 'text-warning';
      case 'critical':
        return 'text-error';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusBgColor = (status) => {
    switch (status) {
      case 'operational':
        return 'bg-success/10';
      case 'warning':
        return 'bg-warning/10';
      case 'critical':
        return 'bg-error/10';
      default:
        return 'bg-muted';
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden hover:shadow-elevation-md transition-smooth">
      <div className="relative h-32 sm:h-40 md:h-48 overflow-hidden">
        <Image
          src={yacht?.image}
          alt={yacht?.imageAlt}
          className="w-full h-full object-cover"
        />
        <div className={`absolute top-3 right-3 px-3 py-1 rounded-full ${getStatusBgColor(yacht?.status)}`}>
          <span className={`text-xs font-medium ${getStatusColor(yacht?.status)}`}>
            {yacht?.status?.charAt(0)?.toUpperCase() + yacht?.status?.slice(1)}
          </span>
        </div>
      </div>
      <div className="p-4 md:p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base md:text-lg font-semibold text-foreground mb-1">
              {yacht?.name}
            </h3>
            <p className="text-xs md:text-sm text-muted-foreground flex items-center gap-1">
              <Icon name="MapPin" size={14} color="var(--color-muted-foreground)" />
              {yacht?.location}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="Activity" size={14} color="var(--color-primary)" />
              <span className="text-xs text-muted-foreground">Utilization</span>
            </div>
            <div className="text-lg md:text-xl font-semibold text-foreground data-text">
              {yacht?.utilization}%
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="Wrench" size={14} color="var(--color-primary)" />
              <span className="text-xs text-muted-foreground">Active Jobs</span>
            </div>
            <div className="text-lg md:text-xl font-semibold text-foreground data-text">
              {yacht?.activeJobs}
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="Package" size={14} color="var(--color-primary)" />
              <span className="text-xs text-muted-foreground">Inventory</span>
            </div>
            <div className="text-lg md:text-xl font-semibold text-foreground data-text">
              {yacht?.inventoryStatus}%
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="Fuel" size={14} color="var(--color-primary)" />
              <span className="text-xs text-muted-foreground">Efficiency</span>
            </div>
            <div className="text-lg md:text-xl font-semibold text-foreground data-text">
              {yacht?.efficiency}
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          fullWidth
          iconName="ArrowRight"
          iconPosition="right"
          onClick={() => onViewDetails(yacht)}
        >
          View Details
        </Button>
      </div>
    </div>
  );
};

export default YachtPerformanceCard;